// Estimator model-gate assertions.
//
// Owner ruling 2026-08-27 (#850 defect 1). The estimator has three
// stand states, each with its own model:
//
//   games not started       -> base rates
//   part played             -> base rates          (the fix)
//   all games played        -> historical distribution
//   pre-floor               -> historical distribution (weeks are complete)
//
// Two assertions:
//
//   A1) On any stand that is not fully played yet (future OR in-progress)
//       AND not pre-floor, total === sum(count_by_type × base_rate) to
//       the cent. If A1 fails, the historical branch is running on a
//       stand whose weeks are not complete - which redistributes partial
//       actuals into the "plan" and produces plan == actual by construction
//       (the Vs the plan card would report 100% accuracy forever).
//
//   A2) On any fully-played stand (not pre-floor, game_end < today), the
//       plan MUST NOT equal the actual to the cent. If A2 fails on a
//       stand, historical is redistributing THIS stand's own weekly
//       actuals back into its "plan" - the same defect A1 catches, one
//       state along.
//
// A2 is EXPECTED TO FAIL against current data as of 2026-08-27 - many
// played stands cleanly contain their own weeks, so historical
// distribution deterministically returns the weekTotal that IS the
// actual. Surfaces the follow-on defect: historical-on-played needs a
// different definition (moving baseline, or base rates on played too)
// before Vs the plan is meaningful on played stands. Kevin's call.

import { createClient } from "@supabase/supabase-js";
import { listHomestands, actualsByStand } from "../../src/lib/labor/homestandResolver.js";
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

const ACCOUNTS = ["CIN - OH", "STL - MO", "TXR - TX - H", "TXR - TX - V"];
const TODAY = new Date().toISOString().slice(0, 10);
const DAILY_FLOOR_ISO = "2026-04-20";

let a1Failures = 0;
let a2Failures = 0;
let a1Checked = 0;
let a2Checked = 0;

function countByType(perDay, type) {
  return (perDay || []).filter(p => p.day_type === type).length;
}

console.log("=== estimator model-gate (base rates vs historical distribution) ===");

for (const account of ACCOUNTS) {
  console.log(`\n[${account}]`);
  const raw = await listHomestands(supa, account);
  if (!raw || raw.length === 0) {
    console.log(`  no homestands - skipping`);
    continue;
  }
  const folded = await foldPreFloorEstimates(supa, account, raw, DAILY_FLOOR_ISO, TODAY);
  const dailyQ = await supa.from("labor_actuals_daily")
    .select("work_date, amount")
    .eq("account_key", account);
  if (dailyQ.error) throw new Error(`labor_actuals_daily (${account}): ${dailyQ.error.message}`);
  const actMap = actualsByStand(folded, dailyQ.data || []);

  for (const h of folded) {
    if (h.pre_floor) continue;
    if (h.actual_estimated == null) continue;

    const isNotFullyPlayed = h.game_end >= TODAY;
    const perDay = h.estimator_meta?.per_day || [];
    const br = h.estimator_meta?.base_rates || { night: 0, day: 0, prep: 0 };
    const nights = countByType(perDay, "night");
    const days   = countByType(perDay, "day");
    const preps  = countByType(perDay, "prep");
    const brSum = nights * br.night + days * br.day + preps * br.prep;

    if (isNotFullyPlayed) {
      // A1: total === base-rates × count to the cent.
      a1Checked++;
      const planCents = Math.round(h.actual_estimated * 100);
      const brCents   = Math.round(brSum * 100);
      const ok = planCents === brCents;
      if (!ok) a1Failures++;
      const state = h.game_start > TODAY ? "future " : "in_prog";
      console.log(`  A1  HS ${String(h.index).padStart(2)} ${state}  plan=${h.actual_estimated.toFixed(2).padStart(9)}  base_rates=${brSum.toFixed(2).padStart(9)}  ${ok ? "✓" : "✗"}`);
    } else {
      // A2: plan MUST NOT equal actual to the cent.
      const actX = actMap.get(h.game_start);
      if (actX == null) continue;
      a2Checked++;
      const actual = actX / 10000;
      const planCents = Math.round(h.actual_estimated * 100);
      const actCents  = Math.round(actual * 100);
      const equalToCent = planCents === actCents;
      if (equalToCent) a2Failures++;
      console.log(`  A2  HS ${String(h.index).padStart(2)} played   plan=${h.actual_estimated.toFixed(2).padStart(9)}  actual=${actual.toFixed(2).padStart(9)}  ${equalToCent ? "✗ PLAN == ACTUAL to cent" : "✓"}`);
    }
  }
}

console.log(`\n---`);
console.log(`A1  (not-fully-played uses base rates):  ${a1Checked - a1Failures}/${a1Checked} pass`);
console.log(`A2  (played plan != actual to cent):     ${a2Checked - a2Failures}/${a2Checked} pass  (${a2Failures} fail)`);

if (a1Failures > 0) {
  console.log(`\nA1 FAILED. Not-fully-played stands are running the historical branch. Estimator gate is broken.`);
  process.exit(1);
}
if (a2Failures > 0) {
  console.log(`\nA2 FAILED. Historical distribution on played stands is returning plan == actual to the cent - the "Vs the plan" card would report 100% accuracy on these stands permanently. Historical-on-played needs a different definition (moving baseline, or base rates on played too). Owner ruling required.`);
  process.exit(1);
}
console.log(`\nboth assertions pass.`);
