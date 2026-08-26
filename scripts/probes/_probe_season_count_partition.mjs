// Season-count partition assertion.
//
// Owner directive 2026-08-26 (post-verify): the three buckets on the
// homestand season card - finished · to come · estimated - must
// PARTITION the homestands list. Their sum equals the total, with no
// overlap and no stand missed.
//
// This probe would have caught STL - MO reading 9 · 2 · 3 = 14
// against 13 total (HS 13 was counted in both "to come" and
// "estimated" because is_estimated is set on any future stand with
// a forecast, not just on pre-floor stands). The fix filters
// estimated to pre-floor only; this probe asserts the partition
// holds for every MLB clubhouse account.
//
// Runs listHomestands + foldPreFloorEstimates + computeHomestandBank
// against live DB per account, then asserts:
//   finishedCount + remainingCount + estimatedCount === homestands.length
// on every account.

import { createClient } from "@supabase/supabase-js";
import { listHomestands, computeHomestandBank } from "../../src/lib/labor/homestandResolver.js";
import { foldPreFloorEstimates } from "../../src/lib/labor/preFloorEstimator.js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`env ${k}: ABSENT`); process.exit(1); }
}
console.error("env: PRESENT");

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// The six MLB clubhouse accounts that carry homestand data. Per
// homestandResolver.js and prior scoping - if you add a new MLB
// account, add it here so the partition assertion covers it.
const ACCOUNTS = ["CIN - OH", "STL - MO", "TXR - TX - H", "TXR - TX - V", "CIN - KY", "TBJ - NY"];
const TODAY = new Date().toISOString().slice(0, 10);
const DAILY_FLOOR_ISO = "2026-04-20";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra) console.log(extra);
}

console.log("=== season-count partition (finished + to come + estimated === total) ===\n");

for (const account of ACCOUNTS) {
  console.log(`\n[${account}]`);
  const raw = await listHomestands(supa, account);
  if (!raw || raw.length === 0) {
    console.log(`  no homestands (non-MLB or empty schedule) - skipping`);
    continue;
  }
  const homestands = await foldPreFloorEstimates(supa, account, raw, DAILY_FLOOR_ISO, TODAY);
  const bank = computeHomestandBank(homestands, TODAY);

  const finishedCount   = Number(bank?.stands_finished || 0);
  const remainingCount  = Number(bank?.stands_remaining || 0);
  // MATCHES THE CLIENT: pre-floor AND is_estimated. Any future stand
  // that also carries is_estimated is NOT counted here (it lives in
  // "to come"); that's the partition ruling.
  const estimatedCount = homestands.filter(h => h?.pre_floor === true && h?.is_estimated === true).length;
  const total          = homestands.length;

  console.log(`  finished:  ${finishedCount}`);
  console.log(`  to come:   ${remainingCount}`);
  console.log(`  estimated: ${estimatedCount}   (pre-floor && is_estimated)`);
  console.log(`  --------`);
  console.log(`  sum:       ${finishedCount + remainingCount + estimatedCount}`);
  console.log(`  total:     ${total}`);

  assert(
    `${account}: finished + to come + estimated === homestands.length`,
    finishedCount + remainingCount + estimatedCount === total,
    `  sum=${finishedCount + remainingCount + estimatedCount}, total=${total}, delta=${finishedCount + remainingCount + estimatedCount - total}`,
  );

  // Additional check for informational value: enumerate any stand
  // that carries is_estimated but is NOT pre-floor. Those are the
  // future-with-forecast stands that live in "to come" per the
  // partition ruling, and it's worth seeing them named so a future
  // reader understands why they don't appear in the estimated count.
  const futureWithEstimate = homestands.filter(h => h?.is_estimated === true && h?.pre_floor !== true);
  if (futureWithEstimate.length > 0) {
    console.log(`  future stands with is_estimated (counted under "to come", NOT under "estimated"):`);
    for (const h of futureWithEstimate) {
      console.log(`    HS ${h.index}  ${h.window_start} - ${h.window_end}`);
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} account(s) fail the partition invariant.`);
  process.exit(1);
}
console.log(`\nall ${ACCOUNTS.length} accounts satisfy the partition.`);
