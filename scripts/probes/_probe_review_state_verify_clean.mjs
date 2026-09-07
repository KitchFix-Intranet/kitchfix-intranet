// _probe_review_state_verify_clean.mjs - post-probe verifier.
//
// After _probe_review_state_roundtrip.mjs runs, confirm nothing was
// left behind:
//   1. The synthetic (SYN, 1970-01-02) row is gone.
//   2. No sc_day_metadata row anywhere carries review_status set
//      (i.e. the DB matches sc-42 Block B Query 3's zero-rows
//      expectation).
//   3. No row has been touched in a way that would seed a real day
//      with a real operator's name.
//
// Run:
//   node --env-file=.env.local scripts/probes/_probe_review_state_verify_clean.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("env: ABSENT"); process.exit(2); }
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let failed = 0;
function ok(m)   { console.log(`  OK  ${m}`); }
function fail(m) { console.error(`  FAIL ${m}`); failed++; }
function h(m)    { console.log(`\n[${m}]`); }

// STEP 1: synthetic row gone.
h("STEP 1 - synthetic (SYN, 1970-01-02) row is gone");
const s1 = await supa
  .from("sc_day_metadata")
  .select("account_key, service_date, review_status, reviewed_by, reviewed_at, created_by, created_at")
  .eq("account_key", "SYN")
  .eq("service_date", "1970-01-02")
  .maybeSingle();
if (s1.error) fail(`query error: ${s1.error.message}`);
else if (s1.data) fail(`synthetic row NOT deleted: ${JSON.stringify(s1.data)}`);
else ok("synthetic row absent");

// STEP 2: any SYN rows at all (shouldn't be - never used elsewhere).
h("STEP 2 - no SYN account rows anywhere");
const s2 = await supa
  .from("sc_day_metadata")
  .select("service_date, review_status, reviewed_by")
  .eq("account_key", "SYN");
if (s2.error) fail(`query error: ${s2.error.message}`);
else if (s2.data.length > 0) {
  fail(`SYN residue: ${s2.data.length} row(s): ${JSON.stringify(s2.data)}`);
} else {
  ok("no SYN rows anywhere");
}

// STEP 3: nothing anywhere in sc_day_metadata carries review markers.
//     Same query as sc-42 Block B Query 3 (paginated - >1000 possible).
h("STEP 3 - zero rows with review_status set anywhere in sc_day_metadata");
let offset = 0;
let carryingReview = [];
while (true) {
  const q = await supa
    .from("sc_day_metadata")
    .select("account_key, service_date, review_status, reviewed_by, reviewed_at")
    .or("review_status.not.is.null,reviewed_by.not.is.null,reviewed_at.not.is.null")
    .order("account_key", { ascending: true })
    .order("service_date", { ascending: true })
    .range(offset, offset + 999);
  if (q.error) { fail(`query error: ${q.error.message}`); break; }
  carryingReview = carryingReview.concat(q.data || []);
  if (!q.data || q.data.length < 1000) break;
  offset += 1000;
  if (offset > 20000) { fail("pagination runaway"); break; }
}
if (carryingReview.length === 0) {
  ok(`zero rows carry review_status / reviewed_by / reviewed_at across ${offset + (carryingReview.length % 1000)} scanned`);
} else {
  fail(`${carryingReview.length} row(s) carry review markers - PROBE LEFT SEED DATA:`);
  for (const r of carryingReview.slice(0, 20)) {
    console.error(`    ${r.account_key} ${r.service_date} status=${r.review_status} by=${r.reviewed_by} at=${r.reviewed_at}`);
  }
  if (carryingReview.length > 20) console.error(`    ...and ${carryingReview.length - 20} more`);
}

// STEP 4: rows created by the probe actor.
h("STEP 4 - no rows created_by the probe actor");
const s4 = await supa
  .from("sc_day_metadata")
  .select("account_key, service_date, created_by, created_at")
  .in("created_by", ["probe@kitchfix.com", "flagger@kitchfix.com"]);
if (s4.error) fail(`query error: ${s4.error.message}`);
else if (s4.data.length > 0) {
  fail(`probe actors left ${s4.data.length} rows behind:`);
  for (const r of s4.data) console.error(`    ${r.account_key} ${r.service_date} created_by=${r.created_by} at=${r.created_at}`);
} else {
  ok("no rows carry probe actor as created_by");
}

if (failed > 0) {
  console.error(`\n[verify] ${failed} check(s) FAILED - operator may see phantom approvals`);
  process.exit(1);
}
console.log("\n[verify] all checks passed - probe left nothing behind");
