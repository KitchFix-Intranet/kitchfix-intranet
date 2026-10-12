// scripts/probes/admin-consumer-verify.mjs
//
// Bidirectional parity between the hardcoded allowlists in
// src/lib/admin.js, src/lib/notifications/getManagerChain.js,
// and src/lib/opdAcl.js, and the matching columns on `people`.
// Also walks contacts.is_site_leader against people.is_site_leader.
//
// Independent of consumer rewires - checks the data layer only. Can
// be re-run any time; a FAIL means the hardcoded list and the DB
// column drifted (someone was added/removed via the admin panel
// without an admin.js update, or the Stage 1 seed missed a row).
//
// Usage:
//   node --env-file=.env.local scripts/probes/admin-consumer-verify.mjs
//
// Exit codes:
//   0 - all checks pass
//   1 - any check failed (prints the specific diff)
//   3 - env or connection error

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("ABSENT: SUPABASE_URL"); process.exit(3); }
if (!SB_KEY) { console.error("ABSENT: SUPABASE_SERVICE_ROLE_KEY"); process.exit(3); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ─── Hardcoded truth (mirrors admin.js / getManagerChain.js / opdAcl.js) ──
const OPS_LEADERSHIP = [
  "k.fietek@kitchfix.com", "a.wasserman@kitchfix.com", "britt@kitchfix.com",
  "joe@kitchfix.com", "josh@kitchfix.com", "m.chavez@kitchfix.com",
].map((e) => e.toLowerCase());

const SC_ADMINS = [
  "k.fietek@kitchfix.com", "joe@kitchfix.com", "josh@kitchfix.com",
  "s.castro@kitchfix.com", "m.chavez@kitchfix.com", "r.moore@kitchfix.com",
  "j.trible@kitchfix.com", "m.decanio@kitchfix.com", "e.randall@kitchfix.com",
  "a.lacy@kitchfix.com", "a.hughes@kitchfix.com",
].map((e) => e.toLowerCase());

const SC_ADMIN_EMAILS = [
  "k.fietek@kitchfix.com", "josh@kitchfix.com", "joe@kitchfix.com",
  "britt@kitchfix.com", "m.chavez@kitchfix.com", "s.castro@kitchfix.com",
  "r.moore@kitchfix.com", "s.lynch@kitchfix.com",
].map((e) => e.toLowerCase());

const SC_LOCK_OVERRIDE = [
  "k.fietek@kitchfix.com", "joe@kitchfix.com", "s.castro@kitchfix.com",
].map((e) => e.toLowerCase());

const ALWAYS_CC = [
  "k.fietek@kitchfix.com", "m.chavez@kitchfix.com",
  "joe@kitchfix.com", "a.wasserman@kitchfix.com",
].map((e) => e.toLowerCase());

const PLAYBOOK_OWNER = "k.fietek@kitchfix.com".toLowerCase();

const REGIONAL_DIRECTOR = {
  East: "s.lynch@kitchfix.com",
  West: "r.moore@kitchfix.com",
  CORP: null,  // no regional director for CORP
};

console.log("ADMIN CONSUMER VERIFY");
console.log("=====================");

const results = [];
function record(name, ok, detail = "") {
  const pad = (name + ":").padEnd(26, " ");
  console.log(`${pad}${ok ? "PASS ✓" : "FAIL ✗"}  ${detail}`);
  results.push({ name, ok, detail });
}
function diffSets(name, hardSet, dbSet) {
  const extraInDb   = [...dbSet].filter((e) => !hardSet.has(e));
  const missingInDb = [...hardSet].filter((e) => !dbSet.has(e));
  const detail = [];
  if (missingInDb.length) detail.push(`hardcoded has but DB does not: ${missingInDb.join(", ")}`);
  if (extraInDb.length)   detail.push(`DB has but hardcoded does not: ${extraInDb.join(", ")}`);
  record(name, detail.length === 0, detail.length === 0 ? `${hardSet.size} in both directions` : detail.join(" | "));
}

// ─── Paginated full read of people ────────────────────────────────────
// 1,100+ rows, PostgREST caps at 1000. Paginate so Kevin, Joe, and
// Mariela (who sat past row 1000 in the Stage 1 probe) are seen.
const people = [];
{
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("people")
      .select("work_email, is_ops_leadership, is_sc_access, is_sc_admin, is_sc_lock_override, paf_always_cc, is_playbook_owner, is_site_leader, region")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`people read failed at offset ${from}: ${error.message}`);
      process.exit(3);
    }
    people.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
}
console.log(`  (loaded ${people.length} people rows)`);
console.log("");

const byEmailLc = new Map();
for (const p of people) {
  const e = String(p.work_email || "").toLowerCase().trim();
  if (e) byEmailLc.set(e, p);
}

// ─── Check 1: OPS_LEADERSHIP ↔ is_ops_leadership ────────────────────
{
  const dbSet = new Set();
  for (const p of people) if (p.is_ops_leadership && p.work_email) dbSet.add(String(p.work_email).toLowerCase().trim());
  diffSets("OPS_LEADERSHIP", new Set(OPS_LEADERSHIP), dbSet);
}

// ─── Check 2: SC_ADMINS ↔ is_sc_access ─────────────────────────────
{
  const dbSet = new Set();
  for (const p of people) if (p.is_sc_access && p.work_email) dbSet.add(String(p.work_email).toLowerCase().trim());
  diffSets("SC_ADMINS/is_sc_access", new Set(SC_ADMINS), dbSet);
}

// ─── Check 3: SC_ADMIN_EMAILS ↔ is_sc_admin ────────────────────────
{
  const dbSet = new Set();
  for (const p of people) if (p.is_sc_admin && p.work_email) dbSet.add(String(p.work_email).toLowerCase().trim());
  diffSets("SC_ADMIN_EMAILS", new Set(SC_ADMIN_EMAILS), dbSet);
}

// ─── Check 4: SC_LOCK_OVERRIDE ↔ is_sc_lock_override ───────────────
{
  const dbSet = new Set();
  for (const p of people) if (p.is_sc_lock_override && p.work_email) dbSet.add(String(p.work_email).toLowerCase().trim());
  diffSets("SC_LOCK_OVERRIDE", new Set(SC_LOCK_OVERRIDE), dbSet);
}

// ─── Check 5: ALWAYS_CC ↔ paf_always_cc ────────────────────────────
{
  const dbSet = new Set();
  for (const p of people) if (p.paf_always_cc && p.work_email) dbSet.add(String(p.work_email).toLowerCase().trim());
  diffSets("ALWAYS_CC", new Set(ALWAYS_CC), dbSet);
}

// ─── Check 6: PLAYBOOK_OWNER ↔ is_playbook_owner ───────────────────
{
  const dbOwners = people.filter((p) => p.is_playbook_owner).map((p) => String(p.work_email || "").toLowerCase().trim()).filter(Boolean);
  const hardSet = new Set([PLAYBOOK_OWNER]);
  const dbSet = new Set(dbOwners);
  diffSets("PLAYBOOK_OWNER", hardSet, dbSet);
}

// ─── Check 7: REGIONAL_DIRECTOR ↔ people.region ───────────────────
{
  const problems = [];
  for (const [region, email] of Object.entries(REGIONAL_DIRECTOR)) {
    if (!email) continue;
    const row = byEmailLc.get(email);
    if (!row) { problems.push(`${region} director ${email} missing from people`); continue; }
    if (row.region !== region) problems.push(`${email} region=${row.region} (expected ${region})`);
  }
  record("REGIONAL_DIRECTOR", problems.length === 0, problems.length === 0 ? "Shane=East, Ryan=West verified" : problems.join(" | "));
}

// ─── Check 8: contacts.is_site_leader ↔ people.is_site_leader ─────
// Not a strict set-equality - contacts has team_key scoping that
// people lacks. We check that every contacts site-leader email is
// present in people with is_site_leader=TRUE. Reverse direction
// (every people site-leader must have a contacts row) is NOT
// enforced because new people-driven leaders may not be in contacts.
{
  const { data: contactLeaders, error: cErr } = await supa
    .from("contacts")
    .select("email, team_key, is_site_leader")
    .eq("is_site_leader", true);
  if (cErr) {
    record("contacts/people site_leader", false, `contacts read failed: ${cErr.message}`);
  } else {
    const peopleLeaderSet = new Set(
      people
        .filter((p) => p.is_site_leader && p.work_email)
        .map((p) => String(p.work_email).toLowerCase().trim())
    );
    const missing = [];
    for (const c of contactLeaders || []) {
      const e = String(c.email || "").toLowerCase().trim();
      if (e && !peopleLeaderSet.has(e)) missing.push(`${c.email} (team_key=${c.team_key})`);
    }
    const detail = missing.length === 0
      ? `${(contactLeaders || []).length} contacts leaders, all present in people`
      : `contacts leaders missing from people: ${missing.join(", ")}`;
    record("contacts/people site_leader", missing.length === 0, detail);
  }
}

// ─── Verdict ──────────────────────────────────────────────────────────
console.log("");
const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  console.log("RESULT: ALL PASS");
  process.exit(0);
}
console.log(`RESULT: FAIL (${failed.length} check(s) failed)`);
for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
process.exit(1);
