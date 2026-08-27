// Estimator model-gate assertions.
//
// Owner ruling 2026-08-27 (#850 defect 1 A'). The estimator has one
// model for every non-pre-floor stand:
//
//   pre-floor               -> historical distribution
//   every other stand       -> base rates
//
// A' rejected B' (rolling baseline that shifts as other stands close -
// a retrospective that moves) and C' (drop the accuracy comparison
// entirely). The plan answers "what would a typical low-OT stand of
// this shape cost", not "what did we forecast at the time". Base rates
// are independent of the actual, so the accuracy comparison is honest.
//
// Two assertions:
//
//   A1) On any stand that is not fully played yet (future OR in-progress)
//       AND not pre-floor, total === sum(count_by_type × base_rate) to
//       the cent. A1 proves the gate is right for the not-yet-played
//       side.
//
//   A2) On any fully-played stand (not pre-floor, game_end < today), the
//       plan MUST NOT equal the actual to the cent. If A2 fails, the
//       historical branch is running on a played stand and redistributing
//       THIS stand's own weekly actuals into its "plan" - Vs the plan
//       reports ~100% accuracy on that stand permanently.
//
// A2 was EXPECTED TO FAIL against pre-A' data (15/36 stands where the
// window cleanly contained its own weeks). Under A', A2 must pass on
// all played stands too - the plan is base rates × count, independent
// of the actual by construction.

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

const a1FailingStands = [];
const a2FailingStands = [];
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
      if (!ok) a1FailingStands.push({ account, index: h.index, plan: h.actual_estimated, expected: brSum });
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
      if (equalToCent) a2FailingStands.push({ account, index: h.index, plan: h.actual_estimated, actual });
      console.log(`  A2  HS ${String(h.index).padStart(2)} played   plan=${h.actual_estimated.toFixed(2).padStart(9)}  actual=${actual.toFixed(2).padStart(9)}  ${equalToCent ? "✗ PLAN == ACTUAL to cent" : "✓"}`);
    }
  }
}

console.log(`\n---`);
console.log(`A1  (not-fully-played uses base rates):  ${a1Checked - a1FailingStands.length}/${a1Checked} pass`);
console.log(`A2  (played plan != actual to cent):     ${a2Checked - a2FailingStands.length}/${a2Checked} pass  (${a2FailingStands.length} fail)`);

if (a1FailingStands.length > 0) {
  console.log(`\nA1 FAILED. These stands did not match base rates × count:`);
  for (const f of a1FailingStands) {
    console.log(`  ${f.account}  HS ${f.index}  plan=${f.plan.toFixed(2)}  expected=${f.expected.toFixed(2)}  diff=${(f.plan - f.expected).toFixed(2)}`);
  }
  process.exit(1);
}
if (a2FailingStands.length > 0) {
  console.log(`\nA2 FAILED. These played stands returned plan == actual to the cent:`);
  for (const f of a2FailingStands) {
    console.log(`  ${f.account}  HS ${f.index}  plan=${f.plan.toFixed(2)}  actual=${f.actual.toFixed(2)}`);
  }
  console.log(`\nThe historical branch is running on played stands and marking its own homework. Vs the plan reports ~100% accuracy on these stands permanently. The gate in preFloorEstimator.js needs to route non-pre-floor stands to base rates (defect 1 A' fix).`);
  process.exit(1);
}
console.log(`\nboth assertions pass.`);
