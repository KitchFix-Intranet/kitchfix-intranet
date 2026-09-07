#!/usr/bin/env node
// Kevin Labor PR-B forecast rendering probe (R-82 scope).
//
// Hard-tests the FORECAST path across ALL 11 accounts - the majority
// path today, and the one CIN - AZ's operators will see the moment
// they are seeded but before a week confirms. Kevin ruling:
//   "The board behaves the same on every account. No test-data
//   special case. No flag, no banner, no suppression."
//
// This probe asserts the payload SHAPE the forecast path emits;
// it does not assert on the dollar values of the 9 test-data
// accounts (per R-82: "asserting on the others tests the test data,
// not the board"). Numbers are printed for the record but not
// compared.
//
// Payload-shape assertions (per account, per week):
//   - revenue_basis in {"confirmed","forecast"}
//   - revenue_basis_temporal in {"closed","running","future"}
//   - confirmed_days + projected_days + empty_days sum to 7
//   - budget_at_this_week_revenue is a number OR null (never NaN)
//   - forecast weeks with revenue > 0 produce a batr (not silently null)
//   - running weeks carry days_left_in_week
//   - no week renders a variance in the running-week case
//     (verified structurally: the temporal state is exposed on the
//     wire so the client renders R-80 fraction)

import { createClient } from "@supabase/supabase-js";
import { loadWeeklyRevenueBasis, computeLineTargetPctByPeriod, attachWeeklyBasisToBoard } from "../../src/lib/labor/labor-week-basis.js";
import { loadOverviewBudgets } from "../../src/lib/kpi/overview/pnl-loader.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TODAY = "2026-09-07";

const ACCOUNTS = [
  "TBR - FL", "TBJ - FL",
  "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO",
  "TBJ - NY", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

const RANGES = [
  { name: "P9  · this period", start: "2026-08-10", end: "2026-09-06", periods: [9] },
  { name: "P10 · next period", start: "2026-09-07", end: "2026-10-04", periods: [10] },
];

let failures = 0;
let checks = 0;

function assert(cond, msg) {
  checks += 1;
  if (!cond) {
    console.log(`      ✗ ${msg}`);
    failures += 1;
  }
}

// Rough labor-budget stubs so line_target_pct produces a number.
// Not cent-precise - probe measures SHAPE, not the dollar value.
const FAKE_BUDGET = 40000;

console.log(`# Labor PR-B forecast render probe  ·  today = ${TODAY}\n`);
console.log("Payload-shape assertions across all 11 accounts × 2 ranges (88 week cells).");
console.log("No dollar-value assertions on unseeded accounts (R-82).\n");

let confirmedCount = 0, forecastCount = 0;
let runningCount = 0, closedCount = 0, futureCount = 0;
let batrPresentOnForecast = 0, batrPresentOnConfirmed = 0;

for (const range of RANGES) {
  console.log(`\n## ${range.name}`);
  for (const acct of ACCOUNTS) {
    const [weekly, budRes] = await Promise.all([
      loadWeeklyRevenueBasis(supa, { members: [acct], start: range.start, end: range.end, today: TODAY }),
      loadOverviewBudgets(supa, { members: [acct] }),
    ]);
    if (weekly.error || budRes.error) {
      console.log(`  ${acct.padEnd(14)} ✗ loader/budget error`);
      failures += 1;
      continue;
    }

    const bp = range.periods.map(p => ({ period_no: p, amount: FAKE_BUDGET }));
    const pctMap = computeLineTargetPctByPeriod({
      budgetPeriods: bp,
      overviewBudgets: budRes.data,
      members: [acct],
      periods: range.periods,
    });

    const fakeBoard = {
      applies: true,
      weeks: weekly.data.map(w => ({ week_start: w.week_start, week_end: w.week_end, spent: 0 })),
    };
    attachWeeklyBasisToBoard(fakeBoard, weekly, {
      lineTargetPctByPeriod: pctMap,
      todayISO: TODAY,
    });

    const badges = [];
    for (const w of fakeBoard.weeks) {
      assert(w.revenue_basis === "confirmed" || w.revenue_basis === "forecast",
        `${acct} ${w.week_start} basis in {confirmed,forecast}`);
      assert(w.revenue_basis_temporal === "closed" || w.revenue_basis_temporal === "running" || w.revenue_basis_temporal === "future",
        `${acct} ${w.week_start} temporal in {closed,running,future}`);
      assert(typeof w.confirmed_days === "number" && typeof w.projected_days === "number" && typeof w.empty_days === "number",
        `${acct} ${w.week_start} day counts are numbers`);
      assert(w.confirmed_days + w.projected_days + w.empty_days === 7,
        `${acct} ${w.week_start} day counts sum to 7 (got ${w.confirmed_days}+${w.projected_days}+${w.empty_days})`);
      assert(w.budget_at_this_week_revenue === null || (typeof w.budget_at_this_week_revenue === "number" && !Number.isNaN(w.budget_at_this_week_revenue)),
        `${acct} ${w.week_start} batr is number or null (not NaN)`);
      if (w.revenue_basis_temporal === "running") {
        assert(typeof w.days_left_in_week === "number" && w.days_left_in_week >= 0 && w.days_left_in_week <= 7,
          `${acct} ${w.week_start} running week days_left_in_week in [0,7] (got ${w.days_left_in_week})`);
      }
      if (w.revenue_basis === "forecast" && w.week_revenue > 0) {
        assert(w.budget_at_this_week_revenue != null,
          `${acct} ${w.week_start} forecast with revenue produces batr`);
      }
      // Tallies
      if (w.revenue_basis === "confirmed") confirmedCount += 1; else forecastCount += 1;
      if (w.revenue_basis_temporal === "closed") closedCount += 1;
      else if (w.revenue_basis_temporal === "running") runningCount += 1;
      else futureCount += 1;
      if (w.budget_at_this_week_revenue != null) {
        if (w.revenue_basis === "forecast") batrPresentOnForecast += 1;
        else batrPresentOnConfirmed += 1;
      }
      badges.push(`${w.revenue_basis[0].toUpperCase()}·${w.revenue_basis_temporal[0]}`);
    }
    console.log(`  ${acct.padEnd(14)}  ${badges.join("  ")}`);
  }
}

console.log(`\n## Rollup`);
console.log(`  Weeks total:         ${confirmedCount + forecastCount}`);
console.log(`  Confirmed / Forecast: ${confirmedCount} / ${forecastCount}`);
console.log(`  Closed / Running / Future: ${closedCount} / ${runningCount} / ${futureCount}`);
console.log(`  Weeks with batr:      ${batrPresentOnConfirmed + batrPresentOnForecast} (${batrPresentOnConfirmed} confirmed + ${batrPresentOnForecast} forecast)`);
console.log(`\n## Assertions`);
console.log(`  Checks: ${checks}  ·  Failures: ${failures}`);
console.log(failures === 0 ? "\nPASS - forecast render path holds shape across all 11 accounts" : "\nFAIL");
process.exit(failures === 0 ? 0 : 1);
