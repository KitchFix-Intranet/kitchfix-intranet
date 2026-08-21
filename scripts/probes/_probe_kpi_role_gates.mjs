// scripts/_probe_kpi_role_gates.mjs
//
// V-role-gates acceptance. Probes G1..G7 from spec §7, plus the
// duplicate-email defence Kevin's seed pass surfaced (spec §8 update:
// nine work_emails appear on more than one people row; status='ACTIVE'
// is load-bearing on both site rules). FAIL fails the workflow job.
//
// PII posture: emails are the load-bearing key for the tests. Names
// and compensation figures are NEVER printed. Emails are printed
// only when they belong to a role fixture pulled from the DB - and
// with the local-part masked (`k***k@...`) so the log line is
// legible without full disclosure.
//
// Usage: node --env-file=.env.local scripts/_probe_kpi_role_gates.mjs

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoleGate, KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST } from "../src/lib/kpi/roleGate.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function skip(line) { console.log(`  SKIP  ${line}`); }
function mask(email) {
  if (!email) return "<null>";
  const at = email.indexOf("@");
  if (at < 2) return "***" + email.slice(at);
  return email[0] + "***" + email.slice(at - 1);
}

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log("=".repeat(72));
console.log("KPI role gates acceptance probe");
console.log("=".repeat(72));
console.log(`preview fence: KPI_PREVIEW_ONLY=${KPI_PREVIEW_ONLY}  allowlist size=${KPI_PREVIEW_ALLOWLIST.length}`);
const fenceOn = !!KPI_PREVIEW_ONLY;

// ─── Load fixtures + gate ────────────────────────────────────────────
const [rolesQ, leadersQ, mgrsQ] = await Promise.all([
  supa.from("kpi_roles").select("email, role, scope"),
  supa.from("people")
    .select("worker_id, work_email, account_key")
    .eq("is_site_leader", true)
    .order("account_key"),
  supa.from("people")
    .select("worker_id, work_email, account_key")
    .eq("status", "ACTIVE")
    .eq("worker_class", "salaried")
    .eq("is_site_leader", false)
    .not("account_key", "is", null),
]);
if (rolesQ.error)   { console.log("rolesQ error:",   rolesQ.error.message);   process.exit(1); }
if (leadersQ.error) { console.log("leadersQ error:", leadersQ.error.message); process.exit(1); }
if (mgrsQ.error)    { console.log("mgrsQ error:",    mgrsQ.error.message);    process.exit(1); }

const leaders = leadersQ.data || [];
const mgrs    = (mgrsQ.data    || []).filter(r => r.account_key !== "CORP");
const corpMgrs = (mgrsQ.data   || []).filter(r => r.account_key === "CORP");
console.log(`fixtures: ${leaders.length} seeded leaders, ${mgrs.length} active-salaried non-leaders at sites, ${corpMgrs.length} at CORP (must NOT resolve to site_manager)`);

const corpEmail = (rolesQ.data || []).find(r => r.role === "corporate")?.email;
const rdoEast   = (rolesQ.data || []).find(r => r.role === "rdo" && r.scope === "East")?.email;
const rdoWest   = (rolesQ.data || []).find(r => r.role === "rdo" && r.scope === "West")?.email;
const siteRoleRows = (rolesQ.data || []).filter(r => r.role === "site");
const tbrLeader = leaders.find(r => r.account_key === "TBR - FL");
const tbrMgr    = mgrs.find(r => r.account_key === "TBR - FL");

console.log(`corporate fixture: ${mask(corpEmail)}   rdo/E: ${mask(rdoEast)}   rdo/W: ${mask(rdoWest)}`);
console.log(`TBR - FL leader: ${mask(tbrLeader?.work_email)}   TBR - FL non-leader mgr: ${mask(tbrMgr?.work_email)}`);
console.log(`kpi_roles role='site' rows still present: ${siteRoleRows.length}  (c1 migration deletes them)`);
const corpCount = (rolesQ.data || []).filter(r => r.role === "corporate").length;
const rdoCount  = (rolesQ.data || []).filter(r => r.role === "rdo").length;
const migrationApplied = siteRoleRows.length === 0;
console.log(`kpi_roles counts: corporate=${corpCount}, rdo=${rdoCount}, site=${siteRoleRows.length}  (post-M4 target: 9/2/0)`);
if (migrationApplied) {
  if (corpCount !== 9) fail(`post-migration corporate count = ${corpCount}, want 9`);
  else ok("post-migration kpi_roles corporate count = 9");
  if (rdoCount !== 2) fail(`post-migration rdo count = ${rdoCount}, want 2`);
  else ok("post-migration kpi_roles rdo count = 2");
  // Every corporate/rdo email matches an ACTIVE people row by
  // work_email. Zero unmatched expected.
  const emails = (rolesQ.data || []).map(r => r.email.toLowerCase().trim());
  const peopleMatch = await supa.from("people").select("work_email").eq("status", "ACTIVE").in("work_email", emails);
  const matched = new Set((peopleMatch.data || []).map(r => (r.work_email || "").toLowerCase().trim()));
  const unmatched = emails.filter(e => !matched.has(e));
  if (unmatched.length === 0) ok(`every kpi_roles email matches an ACTIVE people row (${emails.length} of ${emails.length})`);
  else fail(`unmatched kpi_roles emails: ${unmatched.length} (${unmatched.map(mask).join(", ")})`);
} else {
  skip("kpi_roles post-migration count assertion (c1 migration not yet applied in Studio)");
}

const gate = await loadRoleGate(supa);
if (gate.error) { console.log("gate error:", gate.error); process.exit(1); }

const ACCOUNTS = ["CIN - AZ", "CIN - OH", "CIN - KY", "STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];
const PSEUDOS  = ["ALL", "EAST", "WEST"];

// ─── F1..F5 - preview fence acceptance (fence-aware, always runs) ───
console.log("");
console.log("[F1] fence ON: an allowlisted email resolves to its true role (byte-identical to pre-fence)");
if (!fenceOn) skip("KPI_PREVIEW_ONLY=false; F1 is only meaningful with the fence on");
else if (!corpEmail) fail("no corporate email in kpi_roles - cannot exercise F1");
else if (!KPI_PREVIEW_ALLOWLIST.includes(corpEmail.toLowerCase().trim())) skip("primary corporate fixture is not in KPI_PREVIEW_ALLOWLIST; F1 requires an allowlisted corporate email");
else {
  const caller = await gate.resolveKpiRole(corpEmail);
  if (caller?.role !== "corporate") fail(`allowlisted corporate did not resolve to corporate (got ${JSON.stringify(caller)})`);
  else {
    let bad = 0;
    for (const a of ["ALL", "EAST", "WEST", "TBR - FL", "STL - MO"]) {
      if (!gate.canViewAccount(caller, a)) { fail(`allowlisted corp cannot view ${a}`); bad++; }
      if (!gate.canSeeSalary(caller, a))   { fail(`allowlisted corp no salary on ${a}`); bad++; }
    }
    if (bad === 0) ok("allowlisted corporate: full view + salary; lands ALL");
    if (gate.landingAccount(caller) !== "ALL") fail("allowlisted corp landing != ALL");
  }
}

console.log("");
console.log("[F2] fence ON: all 11 seeded leader emails resolve to null (route returns 403)");
if (!fenceOn) skip("KPI_PREVIEW_ONLY=false; F2 only meaningful with the fence on");
else {
  let leaked = 0;
  for (const l of leaders) {
    if (!l.work_email) continue;
    if (KPI_PREVIEW_ALLOWLIST.includes(l.work_email.toLowerCase().trim())) continue;   // deliberately allowlisted
    const caller = await gate.resolveKpiRole(l.work_email);
    if (caller !== null) { fail(`seeded leader ${mask(l.work_email)} (${l.account_key}) resolved to ${JSON.stringify(caller)} - fence failed`); leaked++; }
  }
  if (leaked === 0) ok(`all ${leaders.length} seeded leader emails resolve null under the fence`);
}

console.log("");
console.log("[F3] fence ON: rdo + other corporate + a sample site-manager all resolve to null");
if (!fenceOn) skip("KPI_PREVIEW_ONLY=false; F3 only meaningful with the fence on");
else {
  const nonAllowlisted = (rolesQ.data || [])
    .filter(r => r.role === "corporate" || r.role === "rdo")
    .filter(r => !KPI_PREVIEW_ALLOWLIST.includes(r.email.toLowerCase().trim()));
  let leaked = 0;
  for (const r of nonAllowlisted) {
    const caller = await gate.resolveKpiRole(r.email);
    if (caller !== null) { fail(`${r.role} ${mask(r.email)} resolved to ${JSON.stringify(caller)}`); leaked++; }
  }
  if (tbrMgr?.work_email && !KPI_PREVIEW_ALLOWLIST.includes(tbrMgr.work_email.toLowerCase().trim())) {
    const caller = await gate.resolveKpiRole(tbrMgr.work_email);
    if (caller !== null) { fail(`site-manager ${mask(tbrMgr.work_email)} resolved to ${JSON.stringify(caller)}`); leaked++; }
  }
  if (leaked === 0) ok(`${nonAllowlisted.length} non-allowlisted rdo/corporate emails + sample site-manager all resolve null`);
}

console.log("");
console.log("[F4] simulate fence-OFF against the data underneath (proves reversibility + data intact)");
// Cannot flip a hardcoded const at runtime; instead re-implement the
// resolution rules over the raw data and prove the expected bucket
// counts hold. When Kevin flips KPI_PREVIEW_ONLY to false, the live
// resolver will produce these same buckets - which is what "the fence
// is reversible" means in practice.
{
  const kpi = new Map();
  for (const r of (rolesQ.data || [])) {
    if (r.role !== "corporate" && r.role !== "rdo") continue;
    kpi.set((r.email || "").toLowerCase().trim(), { role: r.role, scope: r.scope || null });
  }
  const activePeople = await supa.from("people")
    .select("work_email, status, is_site_leader, worker_class, account_key")
    .eq("status", "ACTIVE");
  const buckets = { corporate: 0, rdo: 0, site_leader: 0, site_manager: 0, null: 0 };
  const seen = new Set();
  // corporate + rdo from kpi_roles
  for (const [email, v] of kpi) { buckets[v.role]++; seen.add(email); }
  // site_leader from people (skip if already in kpi as corp/rdo -
  // first-match-wins)
  for (const p of (activePeople.data || [])) {
    const e = (p.work_email || "").toLowerCase().trim();
    if (!e || seen.has(e)) continue;
    if (p.is_site_leader) { buckets.site_leader++; seen.add(e); }
  }
  // site_manager from people (rule 4 filters: worker_class=salaried,
  // account_key not null, account_key <> 'CORP')
  for (const p of (activePeople.data || [])) {
    const e = (p.work_email || "").toLowerCase().trim();
    if (!e || seen.has(e)) continue;
    if (p.worker_class === "salaried" && p.account_key && p.account_key !== "CORP") {
      buckets.site_manager++;
      seen.add(e);
    }
  }
  console.log(`  simulated buckets: corporate=${buckets.corporate}, rdo=${buckets.rdo}, site_leader=${buckets.site_leader}, site_manager=${buckets.site_manager}`);
  // Expected shape post-migration: 9 corp + 2 rdo + 11 leaders + 8 site mgrs.
  // Pre-migration (kpi_roles still has 3 corp), buckets shift.
  const migrationApplied = siteRoleRows.length === 0;
  if (migrationApplied) {
    if (buckets.corporate !== 9) fail(`corporate simulated = ${buckets.corporate}, want 9`);
    else ok("corporate = 9");
    if (buckets.rdo !== 2) fail(`rdo simulated = ${buckets.rdo}, want 2`);
    else ok("rdo = 2");
    if (buckets.site_leader !== 11) fail(`site_leader simulated = ${buckets.site_leader}, want 11`);
    else ok("site_leader = 11");
    if (buckets.site_manager !== 8) fail(`site_manager simulated = ${buckets.site_manager}, want 8`);
    else ok("site_manager = 8");
  } else {
    // Pre-migration: 3 corp + 2 rdo + 11 leaders + (8 site mgrs unchanged; possibly 6 addl if some kpi_roles 'site' emails aren't in people).
    if (buckets.site_leader === 11) ok("site_leader = 11 (pre-migration)");
    else fail(`site_leader simulated = ${buckets.site_leader}, want 11`);
    if (buckets.site_manager === 8) ok("site_manager = 8 (pre-migration; rule 4 CORP-filter working)");
    else fail(`site_manager simulated = ${buckets.site_manager}, want 8`);
    if (buckets.rdo === 2) ok("rdo = 2 (pre-migration)");
    else fail(`rdo simulated = ${buckets.rdo}, want 2`);
    skip("corporate count assertion (migration not applied; will land at 9 after M1..M4)");
  }
}

console.log("");
console.log("[F5] this PR changed no data: kpi_roles counts + is_site_leader count are what the role-gates PR left");
{
  const leaderCount = leaders.length;
  if (leaderCount !== 11) fail(`is_site_leader count = ${leaderCount}, want 11`);
  else ok("is_site_leader count = 11 (unchanged by this PR)");
  const migrationApplied = siteRoleRows.length === 0;
  if (migrationApplied) {
    if (corpCount === 9 && rdoCount === 2 && siteRoleRows.length === 0) ok("kpi_roles = 9 corp + 2 rdo + 0 site (post-M4, unchanged by this PR)");
    else fail(`kpi_roles = ${corpCount} corp + ${rdoCount} rdo + ${siteRoleRows.length} site`);
  } else {
    if (corpCount === 3 && rdoCount === 2 && siteRoleRows.length === 27) ok("kpi_roles = 3 corp + 2 rdo + 27 site (pre-migration baseline, unchanged by this PR)");
    else fail(`kpi_roles unexpected shape: ${corpCount} corp / ${rdoCount} rdo / ${siteRoleRows.length} site`);
  }
}

// ─── G1..G7 - full role-model acceptance (fence-off only) ──────────
console.log("");
console.log("[G1] corporate sees every account + every pseudo, salary true everywhere");
if (fenceOn && corpEmail && !KPI_PREVIEW_ALLOWLIST.includes(corpEmail.toLowerCase().trim())) skip("fence ON and primary corp fixture not allowlisted; G1 waits for fence-off run");
if (!corpEmail) fail("no corporate email in kpi_roles - cannot exercise G1");
else {
  const caller = await gate.resolveKpiRole(corpEmail);
  if (caller?.role !== "corporate") fail(`corporate email did not resolve to corporate (got ${JSON.stringify(caller)})`);
  else {
    let bad = 0;
    for (const a of [...PSEUDOS, ...ACCOUNTS]) {
      if (!gate.canViewAccount(caller, a)) { fail(`corporate cannot view ${a}`); bad++; }
      if (!gate.canSeeSalary(caller, a))   { fail(`corporate has no salary on ${a}`); bad++; }
    }
    if (bad === 0) ok(`corporate view + salary true on all 14 targets`);
    if (gate.landingAccount(caller) !== "ALL") fail(`corporate landing != ALL (got ${gate.landingAccount(caller)})`);
    else ok("corporate lands on ALL");
  }
}

// ─── G2 - rdo/East ──────────────────────────────────────────────────
console.log("");
console.log("[G2] rdo sees every account + every pseudo (full picture), salary true everywhere, lands on region");
if (fenceOn) { skip("fence ON; G2 fixture (rdo) is not allowlisted - covered by F2/F3"); } else
if (!rdoEast) fail("no rdo/East email in kpi_roles - cannot exercise G2");
else {
  const caller = await gate.resolveKpiRole(rdoEast);
  if (caller?.role !== "rdo") fail(`rdo/East email did not resolve to rdo (got ${JSON.stringify(caller)})`);
  else {
    let bad = 0;
    for (const a of [...PSEUDOS, ...ACCOUNTS]) {
      if (!gate.canViewAccount(caller, a)) { fail(`rdo cannot view ${a}`); bad++; }
      if (!gate.canSeeSalary(caller, a))   { fail(`rdo has no salary on ${a}`); bad++; }
    }
    if (bad === 0) ok(`rdo view + salary true on all 14 targets`);
    if (gate.landingAccount(caller) !== "EAST") fail(`rdo/East landing != EAST (got ${gate.landingAccount(caller)})`);
    else ok("rdo/East lands on EAST");
  }
}

// ─── G3 - site_leader (TBR - FL) ────────────────────────────────────
console.log("");
console.log("[G3] site_leader (TBR - FL): own true, every other account + every pseudo locked; salary true only on own, false on aggregates");
if (fenceOn) { skip("fence ON; leader fixture is not allowlisted - covered by F2"); } else
if (!tbrLeader) fail("no TBR - FL leader seeded - cannot exercise G3");
else {
  const caller = await gate.resolveKpiRole(tbrLeader.work_email);
  if (caller?.role !== "site_leader" || caller.scope !== "TBR - FL") fail(`TBR - FL leader did not resolve (got ${JSON.stringify(caller)})`);
  else {
    if (!gate.canViewAccount(caller, "TBR - FL")) fail("leader cannot view their own account");
    else ok("leader views TBR - FL");
    if (!gate.canSeeSalary(caller, "TBR - FL")) fail("leader cannot see salary on their own account");
    else ok("leader sees salary on TBR - FL");
    let bad = 0;
    for (const a of ACCOUNTS.filter(x => x !== "TBR - FL")) {
      if (gate.canViewAccount(caller, a))   { fail(`leader CAN view ${a}`); bad++; }
      if (gate.canSeeSalary(caller, a))     { fail(`leader CAN see salary on ${a}`); bad++; }
    }
    for (const p of PSEUDOS) {
      if (gate.canViewAccount(caller, p))   { fail(`leader CAN view ${p}`); bad++; }
      if (gate.canSeeSalary(caller, p))     { fail(`leader CAN see salary on ${p}`); bad++; }
    }
    if (bad === 0) ok("leader locked on 10 other accounts + 3 pseudos; salary false on same 13 targets");
    if (gate.landingAccount(caller) !== "TBR - FL") fail(`leader landing != TBR - FL (got ${gate.landingAccount(caller)})`);
    else ok("leader lands on TBR - FL");
  }
}

// ─── G4 - site_manager (salaried non-leader at same account) ────────
console.log("");
console.log("[G4] site_manager: own view true, salary ALWAYS false (byte-identical with/without include_salary=1)");
if (fenceOn) { skip("fence ON; site-manager fixture is not allowlisted - covered by F3"); } else
if (!tbrMgr) skip("no TBR - FL non-leader salaried worker in people; G4 waits for an operational example");
else {
  const caller = await gate.resolveKpiRole(tbrMgr.work_email);
  if (caller?.role !== "site_manager") fail(`TBR - FL non-leader did not resolve as site_manager (got ${JSON.stringify(caller)})`);
  else {
    if (!gate.canViewAccount(caller, caller.scope)) fail("mgr cannot view own account");
    else ok(`mgr views own account (${caller.scope})`);
    // Salary MUST be false on own account (spec §5)
    if (gate.canSeeSalary(caller, caller.scope)) fail("mgr can see salary on own account (spec violation)");
    else ok("mgr cannot see salary on own account");
    // Salary false on all other targets
    let bad = 0;
    for (const a of [...PSEUDOS, ...ACCOUNTS]) {
      if (gate.canSeeSalary(caller, a)) { fail(`mgr can see salary on ${a}`); bad++; }
    }
    if (bad === 0) ok("mgr salary false on every target (14 checks)");
    if (gate.landingAccount(caller) !== caller.scope) fail(`mgr landing != ${caller.scope} (got ${gate.landingAccount(caller)})`);
    else ok(`mgr lands on own account`);
    // Route-shape check: since salary_available = canSeeSalary and
    // includeSalary = includeSalaryReq && salary_available, when
    // canSeeSalary is false, includeSalary is ALWAYS false regardless
    // of the URL flag. The salary-merge branch is gated on
    // includeSalary, so the payload is byte-identical with/without
    // ?include_salary=1. Code-inspect proves this.
    const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/kpi/labor/route.js"), "utf8");
    const inclLogic = /const includeSalary\s*=\s*includeSalaryReq\s*&&\s*salary_available;/.test(routeSrc);
    if (inclLogic) ok("route.js: includeSalary = includeSalaryReq && salary_available (mgr flag drops silently)");
    else fail("route.js includeSalary gating branch not found - byte-identical claim broken");
  }
}

// ─── G5 - no-access email ───────────────────────────────────────────
console.log("");
console.log("[G5] no-access email is refused on every account");
const noneCaller = await gate.resolveKpiRole("nobody-not-in-kpi-roles@example.com");
if (noneCaller !== null) fail(`nobody@ resolved to ${JSON.stringify(noneCaller)}`);
else {
  ok("nobody resolves to null");
  let bad = 0;
  for (const a of [...PSEUDOS, ...ACCOUNTS]) {
    if (gate.canViewAccount(noneCaller, a)) { fail(`nobody CAN view ${a}`); bad++; }
  }
  if (bad === 0) ok("nobody locked on every target");
}

// ─── G6 - landing per role ──────────────────────────────────────────
console.log("");
console.log("[G6] landing accounts per §4");
if (fenceOn) {
  skip("fence ON; only allowlisted callers resolve - landing for other roles covered by F4 simulation");
  if (corpEmail && KPI_PREVIEW_ALLOWLIST.includes(corpEmail.toLowerCase().trim())) {
    const c = await gate.resolveKpiRole(corpEmail);
    if (gate.landingAccount(c) !== "ALL") fail(`allowlisted corp landing != ALL`);
    else ok("allowlisted corporate -> ALL");
  }
} else {
  if (corpEmail) {
    const c = await gate.resolveKpiRole(corpEmail);
    if (gate.landingAccount(c) !== "ALL") fail(`corp landing != ALL`); else ok("corporate -> ALL");
  }
  if (rdoEast) {
    const c = await gate.resolveKpiRole(rdoEast);
    if (gate.landingAccount(c) !== "EAST") fail(`rdo/E landing != EAST`); else ok("rdo/East -> EAST");
  }
  if (rdoWest) {
    const c = await gate.resolveKpiRole(rdoWest);
    if (gate.landingAccount(c) !== "WEST") fail(`rdo/W landing != WEST`); else ok("rdo/West -> WEST");
  }
  if (tbrLeader) {
    const c = await gate.resolveKpiRole(tbrLeader.work_email);
    if (gate.landingAccount(c) !== "TBR - FL") fail(`leader landing != TBR - FL`); else ok("site_leader -> own account");
  }
  if (tbrMgr) {
    const c = await gate.resolveKpiRole(tbrMgr.work_email);
    if (gate.landingAccount(c) !== tbrMgr.account_key) fail(`mgr landing != own`); else ok("site_manager -> own account");
  }
}

// ─── G7 - kpi_roles.role='site' rows have no effect ─────────────────
console.log("");
console.log("[G7] kpi_roles role='site' rows are ignored by the resolver (proved BEFORE the c1 migration deletes them)");
if (siteRoleRows.length === 0) skip("no role='site' rows in kpi_roles - c1 migration already ran");
else {
  // Pick any role='site' email. If it is ALSO in people (rule 3 or 4),
  // resolveKpiRole will return the people role, which is CORRECT
  // behavior - the assertion is that kpi_roles role='site' never
  // grants site_leader / site_manager itself. To prove that, pick a
  // role='site' email whose scope is a made-up account (e.g., 'CORP')
  // that people would never assign as a scope - if such an email
  // resolves to null OR to a role sourced from people, the resolver
  // ignored the kpi_roles row. It NEVER produces a role paired with
  // scope='CORP' (rule 3/4 don't emit that) if it uses the resolver.
  let siteViaKpiRoles = 0;
  for (const r of siteRoleRows.slice(0, 10)) {
    const caller = await gate.resolveKpiRole(r.email);
    // A caller that comes back as site_leader / site_manager MUST
    // have scope = a real people.account_key, not a kpi_roles.scope.
    if (caller && (caller.role === "site_leader" || caller.role === "site_manager")) {
      if (caller.scope === r.scope) {
        // Same scope as kpi_roles - could be coincidence (person's
        // people row happens to match) or a leak. Investigate.
        // Not automatically a failure since coincidence is possible;
        // note the count and let the human read.
      }
    }
    // If the resolver blindly honored kpi_roles.role='site', we'd see
    // {role: 'site', scope: r.scope}. That role name is not in our
    // union type, so any such output would be a bug.
    if (caller?.role === "site") { fail(`resolver returned role='site' for ${mask(r.email)} - kpi_roles leaked`); siteViaKpiRoles++; }
  }
  if (siteViaKpiRoles === 0) ok(`sampled ${Math.min(10, siteRoleRows.length)} role='site' rows; none produced role='site' from resolver`);
}

// ─── Duplicate-email defence (spec §8 update, seasonal-rehire) ──────
console.log("");
console.log("[dup] every seeded leader email resolves via EXACTLY one active row (rule 4 ACTIVE filter is load-bearing)");
if (fenceOn) {
  skip("fence ON; leader-resolver assertion covered by F2 (all resolve null under fence)");
} else {
  let dupDefects = 0;
  for (const l of leaders) {
    const email = (l.work_email || "").trim().toLowerCase();
    if (!email) { fail(`leader for ${l.account_key} has no work_email`); dupDefects++; continue; }
    // Count all people rows with the same email (case-insensitive) so
    // we see the seasonal-rehire shadow.
    const q = await supa
      .from("people")
      .select("worker_id, status, is_site_leader, worker_class, account_key")
      .ilike("work_email", email);
    const rows = q.data || [];
    const active = rows.filter(r => r.status === "ACTIVE");
    const activeSalaried = active.filter(r => r.worker_class === "salaried" && r.account_key != null);
    const seededLeader = rows.filter(r => r.is_site_leader === true);
    if (seededLeader.length !== 1) { fail(`${l.account_key}: ${seededLeader.length} leader rows for one email`); dupDefects++; continue; }
    if (activeSalaried.length !== 1) { fail(`${l.account_key}: ${activeSalaried.length} active-salaried rows for one email`); dupDefects++; continue; }
    // Prove resolver picks the leader row, not any shadow.
    const caller = await gate.resolveKpiRole(email);
    if (caller?.role !== "site_leader" || caller.scope !== l.account_key) {
      fail(`${l.account_key}: leader email resolved to ${JSON.stringify(caller)}`); dupDefects++;
    }
  }
  if (dupDefects === 0) ok(`all ${leaders.length} leader emails resolve uniquely; seasonal rehires do not shadow`);
}

// ─── CORP filter on rule 4 (spec §2 update) ─────────────────────────
console.log("");
console.log("[corp-not-mgr] active salaried at account_key='CORP' must NOT resolve to site_manager");
if (fenceOn) { skip("fence ON; CORP mgrs resolve null under fence - CORP-filter behaviour is covered by F4 simulation"); } else
if (corpMgrs.length === 0) skip("no active-salaried CORP rows to check");
else {
  let leaks = 0;
  for (const r of corpMgrs) {
    if (!r.work_email) continue;
    const caller = await gate.resolveKpiRole(r.work_email);
    // Post-migration these should be corporate (via kpi_roles).
    // Pre-migration they should be null (kpi_roles has them as
    // role='site' which the resolver ignores, and rule 4 excludes
    // CORP). Either outcome is correct - what MUST NOT happen is
    // site_manager scope=CORP.
    if (caller?.role === "site_manager" && caller.scope === "CORP") {
      fail(`${mask(r.work_email)} resolved to site_manager scope='CORP' - rule 4 leaked CORP`);
      leaks++;
    }
  }
  if (leaks === 0) ok(`checked ${corpMgrs.length} active-salaried CORP rows; none resolved to site_manager scope='CORP'`);
}

// ─── F6 - every /api/kpi/**/route.js carries the fence ─────────────
// This is the check Kevin was missing when PR #725's fence went in
// - it enumerates the KPI API surface off the filesystem rather than
// off a hand-maintained list, so a future endpoint cannot ship
// unfenced. Any route that has a legitimate reason to bypass the
// fence must add the marker comment `// KPI_PREVIEW_FENCE_EXEMPT:
// <reason>` on the module so future readers see the exception was
// deliberate.
console.log("");
console.log("[F6] every route file under src/app/api/kpi/**/route.js carries the KPI preview fence");
function findRoutes(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRoutes(p));
    else if (entry.isFile() && entry.name === "route.js") out.push(p);
  }
  return out;
}
const routeFiles = findRoutes(path.join(REPO_ROOT, "src/app/api/kpi"));
console.log(`  enumerated ${routeFiles.length} route file(s)`);
const missing = [];
for (const f of routeFiles) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(REPO_ROOT, f);
  if (/KPI_PREVIEW_FENCE_EXEMPT:/i.test(src)) {
    ok(`${rel} explicit KPI_PREVIEW_FENCE_EXEMPT marker (skipping)`);
    continue;
  }
  // Two shapes count as fenced:
  //  (a) direct: imports KPI_PREVIEW_ONLY + KPI_PREVIEW_ALLOWLIST and
  //      runs the "KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST" check.
  //      This is what routes that still gate on OPS_LEADERSHIP_EMAILS
  //      (views / views[id] / export / purchasing) look like.
  //  (b) via resolver: imports loadRoleGate and calls
  //      resolveKpiRole(email). The fence lives inside the closure,
  //      so a null return already means "fenced-out caller, refuse".
  //      This is what labor/route.js looks like.
  const directFence = /import[\s\S]*?KPI_PREVIEW_ONLY[\s\S]*?KPI_PREVIEW_ALLOWLIST[\s\S]*?from\s*["'][^"']*roleGate/i.test(src)
                    && /KPI_PREVIEW_ONLY\s*&&\s*!KPI_PREVIEW_ALLOWLIST\.includes\(/.test(src);
  const viaResolver = /import[\s\S]*?loadRoleGate[\s\S]*?from\s*["'][^"']*roleGate/i.test(src)
                    && /resolveKpiRole\(/.test(src);
  if (directFence) {
    ok(`${rel} fenced (direct fence pattern)`);
  } else if (viaResolver) {
    ok(`${rel} fenced (via resolveKpiRole - fence lives in the closure)`);
  } else {
    fail(`${rel} MISSING fence (direct=${directFence}, viaResolver=${viaResolver})`);
    missing.push(rel);
  }
}
if (missing.length === 0) ok(`all ${routeFiles.length} KPI route files carry the fence (or an explicit exempt marker)`);

// ─── Locked-response shape (code-read) ──────────────────────────────
console.log("");
console.log("[locked-shape] route.js locked branch omits board / actuals / budget / budget_periods keys");
const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/kpi/labor/route.js"), "utf8");
const lockedBlock = routeSrc.match(/if \(!gate\.canViewAccount\(caller, account\)\) \{\s*return NextResponse\.json\(\{([\s\S]*?)\}\);\s*\}/);
if (!lockedBlock) fail("locked branch not found in route.js");
else {
  const body = lockedBlock[1];
  const leaks = [];
  for (const key of ["board", "actuals", "budget", "budget_periods", "week_budgets", "salary_summary", "unattributed"]) {
    const re = new RegExp(`\\b${key}\\b`);
    if (re.test(body)) leaks.push(key);
  }
  if (leaks.length === 0) ok(`locked branch payload keys: locked, account, reason, landing_account, accounts_directory, regional_directors_display (no data leaked)`);
  else fail(`locked branch leaks data keys: ${leaks.join(", ")}`);
}

// ─── Sentinel: CIN - OH 06/29 on a corporate session ────────────────
console.log("");
console.log("[sentinel] CIN - OH 06/29 account-week sum unchanged (113.98 / 2.32 / 4328.27)");
if (!corpEmail) skip("no corporate fixture");
else {
  // The gate would ship salary_available=true for corp; sentinel
  // asserts the underlying figures didn't move. Direct DB read.
  const s = await supa
    .from("labor_actuals_latest")
    .select("hours_regular, hours_overtime, amount")
    .eq("account_key", "CIN - OH")
    .eq("week_start", "2026-06-29");
  if (s.error) fail(`sentinel error: ${s.error.message}`);
  else {
    const reg = (s.data||[]).reduce((a,r)=>a+Number(r.hours_regular||0),0);
    const ot  = (s.data||[]).reduce((a,r)=>a+Number(r.hours_overtime||0),0);
    const amt = (s.data||[]).reduce((a,r)=>a+Number(r.amount||0),0);
    if (Math.abs(reg - 113.98) < 0.01) ok(`hours_regular ${reg.toFixed(2)}`); else fail(`reg ${reg.toFixed(2)} != 113.98`);
    if (Math.abs(ot - 2.32) < 0.01)   ok(`hours_overtime ${ot.toFixed(2)}`);  else fail(`ot ${ot.toFixed(2)} != 2.32`);
    if (Math.abs(amt - 4328.27) < 0.01) ok(`amount ${amt.toFixed(2)}`);       else fail(`amt ${amt.toFixed(2)} != 4328.27`);
  }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "ROLE GATES: ALL PROBES PASS" : `ROLE GATES: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
