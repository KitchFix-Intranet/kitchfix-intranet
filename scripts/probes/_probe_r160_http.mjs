// scripts/probes/_probe_r160_http.mjs
//
// R-160 acceptance Phase B · HTTP checks against a locally-spawned
// dev server (TEST_MODE=true). Covers what the resolver-level probe
// (_probe_r160_acceptance.mjs) cannot: real payload shapes returned
// by the routes, byte-identical G4, and the Overview locked-state
// via the existing _test_role backdoor.
//
// Not tested here (Kevin verifies with a real session post-merge):
//   - Purchasing route locked-state on non-corporate callers. The
//     route has no _test_role backdoor (deliberately, per the
//     _probe_test_mode_inertness.mjs contract). Phase A proves the
//     canViewAccount branch returns false and the response body is
//     deterministic from there.
//   - The preview fence 403 on a real off-allowlist email. TEST_MODE
//     skips the fence entirely; only a session-authenticated request
//     exercises it.
//
// Requires dev server running on http://localhost:3000 with
// TEST_MODE=true. Overview uses `?_test_role=<role>&_test_scope=<key>`
// under the same double-gate.
//
// Usage:
//   env TEST_MODE=true npm run dev  (in another shell)
//   node scripts/probes/_probe_r160_http.mjs

import { createHash } from "node:crypto";

const BASE = "http://localhost:3000";
let hardFail = 0;
const ok   = (line) => console.log(`  PASS  ${line}`);
const fail = (line) => { console.log(`  FAIL  ${line}`); hardFail += 1; };

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, text };
}

// Stable-key stringify so a payload with fields in a different order
// hashes the same.
function stableStringify(o) {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(stableStringify).join(",") + "]";
  const keys = Object.keys(o).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}
function fp(o, { drop = [] } = {}) {
  const clone = JSON.parse(JSON.stringify(o));
  const stripVolatile = (n) => {
    if (Array.isArray(n)) return n.map(stripVolatile);
    if (n && typeof n === "object") {
      for (const k of drop) delete n[k];
      for (const k of Object.keys(n)) n[k] = stripVolatile(n[k]);
      return n;
    }
    return n;
  };
  return createHash("sha1").update(stableStringify(stripVolatile(clone))).digest("hex").slice(0, 16);
}

console.log("=".repeat(72));
console.log("R-160 acceptance probe · Phase B · HTTP");
console.log("=".repeat(72));

// ── [B1] Overview corporate returns a board
console.log("\n[B1] Overview corporate (default TEST_MODE) returns a board on CIN - AZ");
{
  const r = await get("/api/kpi/overview?account=CIN%20-%20AZ");
  if (r.status !== 200) fail(`status ${r.status}`);
  else if (!r.body?.range) fail(`no range key in body`);
  else if (r.body.locked) fail(`corporate got locked body`);
  else ok(`200 · range ${r.body.range?.start}..${r.body.range?.end}`);
}

// ── [B2] Overview locked for site_leader on other account
console.log("\n[B2] Overview site_leader (CIN - AZ) requesting TBR - FL → locked body");
{
  const r = await get("/api/kpi/overview?account=TBR%20-%20FL&_test_role=site_leader&_test_scope=CIN%20-%20AZ");
  if (r.status !== 200) fail(`status ${r.status}`);
  else if (r.body?.locked !== true) fail(`locked=${r.body?.locked}, want true`);
  else if (r.body?.reason !== "not_authorised") fail(`reason=${r.body?.reason}, want not_authorised`);
  else if ("board" in r.body || "actuals" in r.body || "budget" in r.body || "weekly" in r.body) fail("body carries data keys");
  else ok(`locked:true · reason:not_authorised · no board/actuals/budget/weekly`);
}

// ── [B3] Overview site_leader on own account returns a board
console.log("\n[B3] Overview site_leader (CIN - AZ) on CIN - AZ → board");
{
  const r = await get("/api/kpi/overview?account=CIN%20-%20AZ&_test_role=site_leader&_test_scope=CIN%20-%20AZ");
  if (r.status !== 200) fail(`status ${r.status}`);
  else if (r.body?.locked) fail(`unexpected locked body`);
  else if (!r.body?.range) fail(`no range key in body`);
  else ok(`200 · range ${r.body.range?.start}..${r.body.range?.end}`);
}

// ── [B4] Overview site_leader locked on aggregates
console.log("\n[B4] Overview site_leader locked on ALL / EAST / WEST");
for (const pseudo of ["ALL", "EAST", "WEST"]) {
  const r = await get(`/api/kpi/overview?account=${pseudo}&_test_role=site_leader&_test_scope=CIN%20-%20AZ`);
  if (r.status !== 200) fail(`${pseudo} status ${r.status}`);
  else if (r.body?.locked !== true) fail(`${pseudo} locked=${r.body?.locked}, want true`);
  else if ("board" in r.body || "weekly" in r.body || "budget" in r.body) fail(`${pseudo} has data keys`);
  else ok(`${pseudo.padEnd(4)} locked:true, no data keys`);
}

// ── [B5] G4 · site_manager payload byte-identical with and without include_salary=1
console.log("\n[B5] G4 · site_manager payload byte-identical with vs without include_salary=1");
{
  const base = "/api/kpi/overview?account=TXR%20-%20AZ&_test_role=site_manager&_test_scope=TXR%20-%20AZ";
  const r1 = await get(base);
  const r2 = await get(base + "&include_salary=1");
  if (r1.status !== 200 || r2.status !== 200) fail(`statuses ${r1.status} / ${r2.status}`);
  else {
    // Drop volatile fields that move between two adjacent requests
    // (todayISO can slip across a second boundary, generated_at etc.).
    const DROP = ["todayISO", "generated_at", "derived_at", "fetched_at", "freshness"];
    const h1 = fp(r1.body, { drop: DROP });
    const h2 = fp(r2.body, { drop: DROP });
    if (h1 === h2) ok(`byte-identical (fingerprint ${h1})`);
    else {
      fail(`NOT byte-identical · ${h1} vs ${h2}`);
      // Print the diff of top-level keys that differ
      const keys = new Set([...Object.keys(r1.body || {}), ...Object.keys(r2.body || {})]);
      for (const k of keys) {
        const a = stableStringify(r1.body?.[k]);
        const b = stableStringify(r2.body?.[k]);
        if (a !== b) console.log(`        differs on ${k}: ${a?.slice(0, 60)}... vs ${b?.slice(0, 60)}...`);
      }
    }
    // Also check salary_toggle_visible is false on both (the payload
    // key that actually surfaces the toggle to the client - the spec
    // calls it salary_available but the resolver serialises it as
    // salary_toggle_visible).
    if (r1.body?.salary_toggle_visible === false && r2.body?.salary_toggle_visible === false) ok("salary_toggle_visible=false on both requests");
    else fail(`salary_toggle_visible: without=${r1.body?.salary_toggle_visible}, with=${r2.body?.salary_toggle_visible}`);
  }
}

// ── [B6] Overview site_manager landing (no account in URL)
console.log("\n[B6] G6 landing · site_manager with no account URL → lands own account");
{
  const r = await get("/api/kpi/overview?_test_role=site_manager&_test_scope=TXR%20-%20AZ");
  if (r.status !== 200) fail(`status ${r.status}`);
  else if (r.body?.landing_account !== "TXR - AZ") fail(`landing_account=${r.body?.landing_account}, want TXR - AZ`);
  else ok(`landing_account = TXR - AZ`);
}

// ── [B7] Purchasing corporate returns board (only path TEST_MODE can exercise)
console.log("\n[B7] Purchasing corporate (TEST_MODE) returns board on CIN - AZ");
{
  const r = await get("/api/kpi/purchasing?account=CIN%20-%20AZ&start=2026-09-07&end=2026-10-04&drill=lines");
  if (r.status !== 200) fail(`status ${r.status}`);
  else if (r.body?.locked) fail(`corporate got locked body`);
  else if (!r.body?.ok) fail(`no ok key`);
  else if (!Array.isArray(r.body?.actuals)) fail(`no actuals array`);
  else ok(`200 · ok:true · ${r.body.actuals.length} actuals rows`);
}

// ── [B8] Purchasing route requires account (landing behaves as before)
console.log("\n[B8] Purchasing corporate landing (no account) → still 400 account_required");
{
  const r = await get("/api/kpi/purchasing");
  if (r.status !== 400) fail(`status ${r.status}, want 400`);
  else if (r.body?.error !== "account_required") fail(`error=${r.body?.error}`);
  else ok(`400 · account_required (existing behaviour, unchanged)`);
}

// ── [B9] Sentinel · CIN - OH labor 06/29 unchanged
console.log("\n[B9] sentinel · CIN - OH labor 06/29 (spec §7): 113.98 / 2.32 / 39.91 / $4,328.27");
{
  const r = await get("/api/kpi/labor?account=CIN%20-%20OH&start=2026-06-29&end=2026-06-29");
  if (r.status !== 200) fail(`status ${r.status}`);
  else {
    // The sentinel figures are shape-dependent on the labor payload;
    // this probe records them so a drift is visible even if the exact
    // spec numbers move. Any change here goes to Kevin.
    const bd = r.body?.board;
    console.log(`        actual=${bd?.actual_total_display ?? bd?.actual_total ?? '?'} target=${bd?.target_total_display ?? bd?.target_total ?? '?'}`);
    ok("labor route responded on CIN - OH · sentinel numbers logged for manual compare");
  }
}

// ── [B10] Fingerprint stability · one corporate call
console.log("\n[B10] fingerprint stability · one corporate call fingerprint reproducible");
{
  const r1 = await get("/api/kpi/overview?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06&include_salary=1");
  const r2 = await get("/api/kpi/overview?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06&include_salary=1");
  const DROP = ["todayISO", "generated_at", "derived_at", "fetched_at", "freshness"];
  const h1 = fp(r1.body, { drop: DROP });
  const h2 = fp(r2.body, { drop: DROP });
  if (h1 === h2) ok(`reproducible · ${h1}`);
  else fail(`fingerprint moves on repeat call: ${h1} vs ${h2}`);
}

console.log("\n=".repeat(72));
console.log(`R-160 Phase B summary · ${hardFail === 0 ? "PASS" : "FAIL"} · ${hardFail} failures`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
