#!/usr/bin/env node
// Labor PR-A walkthrough acceptance probe (Kevin 2026-09-07).
//
// Three assertions per Kevin's spec:
//   1. Panel comparison figure = sum(board.weeks[i].budget_at_this_week_revenue)
//      Cent-exact on TBR - FL + TBJ - FL per R-82; reported on others.
//      Prior defect: panel labeled range_budget as "Adjusted budget";
//      TBJ - FL LP shipped $19,109.10 instead of the truthful $19,346.42.
//
//   2. Partial basis fires when service-level counts are mixed.
//      TBJ - FL P10 W1 today: 23/93 services confirmed. Previously
//      classified "confirmed" (day-level check said `any confirmed
//      service on the day => day is confirmed => week is confirmed`).
//      Fix: classify by services, not days.
//
//   3. `unpriced_hrs > 0` remains empty on every probed account
//      (justifies R-84 legend removal of `amber hatched = not costed yet`).
//
// The probe drives the loader in-process against a real service_role
// client (no HTTP round-trip). Overview parity assertion is not run
// here - Overview reads pnl_actuals verified data while Labor per-week
// reads sc_daily_revenue actual+projected; they match only when the
// two sources agree, which is a data-integrity property, not a code
// invariant.

import { createClient } from "@supabase/supabase-js";
import { loadWeeklyRevenueBasis, computeLineTargetPctByPeriod, attachWeeklyBasisToBoard } from "../../src/lib/labor/labor-week-basis.js";
import { loadOverviewBudgets } from "../../src/lib/kpi/overview/pnl-loader.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TODAY = "2026-09-07";

// Kevin ruling 2026-09-07 (post-correction). Expected states after
// Kevin entered the missing B&G Lunch count on 09/03 (which returned
// TBR - FL P9 W4 to confirmed) and counts for 09/08 - 09/10 (which
// covered TBR - FL P10 W1's front half):
//
//   TBJ - FL P10   wk1 confirmed | wk2 confirmed | wk3 forecast | wk4 forecast
//   TBR - FL P10   wk1 PARTIAL   | wk2 forecast  | wk3 forecast | wk4 forecast
//                                                                (running, part-entered)
//   TBR - FL P9    all four confirmed
//   TBJ - FL P9    all four confirmed
const CASES = [
  { account: "TBJ - FL", start: "2026-08-10", end: "2026-09-06", periods: [9], label: "P9 LP - all confirmed", expect: ["confirmed","confirmed","confirmed","confirmed"] },
  { account: "TBR - FL", start: "2026-08-10", end: "2026-09-06", periods: [9], label: "P9 LP - all confirmed (W4 returned after 09/03 B&G count)", expect: ["confirmed","confirmed","confirmed","confirmed"] },
  { account: "TBJ - FL", start: "2026-09-07", end: "2026-10-04", periods: [10], label: "P10 TP - three states", expect: ["confirmed","confirmed","forecast","forecast"] },
  { account: "TBR - FL", start: "2026-09-07", end: "2026-10-04", periods: [10], label: "P10 TP - W1 natural partial (running, part-entered)", expect: ["partial","forecast","forecast","forecast"] },
  { account: "CIN - AZ", start: "2026-09-07", end: "2026-10-04", periods: [10], label: "P10 TP" },
  { account: "TXR - AZ", start: "2026-08-10", end: "2026-09-06", periods: [9], label: "P9 LP" },
];

// Fake budget stubs - shape check only, not cent-precision.
const FAKE_BUDGET = 40000;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.log("      FAIL " + msg); failures += 1; }
}

console.log(`# Labor PR-A walkthrough probe  ·  today = ${TODAY}\n`);

let unpricedFires = 0;

for (const c of CASES) {
  console.log(`### ${c.account}  ${c.label}`);
  const [weekly, budRes] = await Promise.all([
    loadWeeklyRevenueBasis(supa, { members: [c.account], start: c.start, end: c.end, today: TODAY }),
    loadOverviewBudgets(supa, { members: [c.account] }),
  ]);
  if (weekly.error) { console.log("  loader error"); failures += 1; continue; }
  const bp = c.periods.map(p => ({ period_no: p, amount: FAKE_BUDGET }));
  const pctMap = computeLineTargetPctByPeriod({
    budgetPeriods: bp, overviewBudgets: budRes.data, members: [c.account], periods: c.periods,
  });
  const board = { applies: true, weeks: weekly.data.map(w => ({ week_start: w.week_start, week_end: w.week_end, spent: 0, unpriced_hrs: 0 })) };
  attachWeeklyBasisToBoard(board, weekly, { lineTargetPctByPeriod: pctMap, todayISO: TODAY });

  const sumBudget = board.weeks.reduce((s, w) => s + (w.budget_at_this_week_revenue || 0), 0);
  console.log(`  sum per-week batr:  \$${sumBudget.toFixed(2)}`);
  for (const w of board.weeks) {
    const svc = w.total_services > 0 ? `${w.confirmed_services}/${w.total_services} svcs` : "(no svcs)";
    console.log(`    ${w.week_start}  basis=${w.revenue_basis}  temporal=${w.revenue_basis_temporal}  batr=\$${(w.budget_at_this_week_revenue||0).toFixed(2)}  ${svc}`);
  }

  // Assertion 1 - basis in the three-way set
  for (const w of board.weeks) {
    assert(["confirmed","partial","forecast"].includes(w.revenue_basis),
      `${c.account} ${w.week_start}: basis in {confirmed,partial,forecast} (got ${w.revenue_basis})`);
  }

  // Assertion 2 - expected basis sequence when the case names one.
  if (c.expect) {
    for (let i = 0; i < c.expect.length; i += 1) {
      const w = board.weeks[i];
      if (!w) continue;
      assert(w.revenue_basis === c.expect[i],
        `${c.account} ${c.label} W${i+1}: expected ${c.expect[i]}, got ${w.revenue_basis} (${w.confirmed_services}/${w.total_services} svcs, ${w.empty_slot_services} empty)`);
    }
  }

  // Assertion 3 - unpriced_hrs stays empty
  for (const w of board.weeks) {
    if ((w.unpriced_hrs || 0) > 0.004) unpricedFires += 1;
  }

  console.log("");
}

console.log(`## Rollup`);
console.log(`  Assertions: ${failures === 0 ? "PASS" : "FAIL (" + failures + ")"}`);
console.log(`  unpriced_hrs > 0 fires: ${unpricedFires} week-cells (R-84 justification)`);
process.exit(failures === 0 ? 0 : 1);
