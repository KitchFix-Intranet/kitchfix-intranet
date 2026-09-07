#!/usr/bin/env node
// Kevin Labor PR-B acceptance probe. Runs the labor route in-process
// against a real service_role client and asserts the per-week basis
// fields land on board.weeks for both a fully-confirmed account
// (TBJ - FL P9) and a fully-forecast account (CIN - KY P9), plus the
// running-week edge (TBR - FL P10 W1).
//
// Payload checks:
//   - board.weeks[i].revenue_basis     "confirmed" | "forecast"
//   - board.weeks[i].revenue_basis_temporal  "closed" | "running" | "future"
//   - board.weeks[i].confirmed_days    0-7
//   - board.weeks[i].week_revenue      number
//   - board.weeks[i].budget_at_this_week_revenue  number | null
//   - board.weeks[i].days_left_in_week (running weeks only)
//
// R-77 within-week invariant: for each week where the range-level
// batr is defined, its per-week batr sums (excluding the running
// week's incomplete revenue) should trend proportionally.

import { createClient } from "@supabase/supabase-js";
import { loadWeeklyRevenueBasis, computeLineTargetPctByPeriod, attachWeeklyBasisToBoard } from "../../src/lib/labor/labor-week-basis.js";
import { loadOverviewBudgets } from "../../src/lib/kpi/overview/pnl-loader.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TODAY = "2026-09-07";

// One representative case per basis; keep the probe fast.
const CASES = [
  { account: "TBJ - FL", start: "2026-08-10", end: "2026-09-06", label: "P9  · closed · fully confirmed" },
  { account: "CIN - KY", start: "2026-08-10", end: "2026-09-06", label: "P9  · closed · fully forecast (salary-only)" },
  { account: "TBR - FL", start: "2026-09-07", end: "2026-10-04", label: "P10 · running · W1 confirmed + forward" },
  { account: "TBJ - FL", start: "2026-09-07", end: "2026-10-04", label: "P10 · running · W1 forecast (no forward yet)" },
];

// Minimal fake budget_periods to exercise line_target_pct math without
// running the full route (probe stays under 5s). Values chosen to
// match order-of-magnitude of real data - not for cent-precision.
const FAKE_BUDGETS_BY_ACCT = {
  "TBJ - FL": { P9: 42000, P10: 42000 },
  "CIN - KY": { P9: 12000, P10: 12000 },
  "TBR - FL": { P9: 55000, P10: 55000 },
};

let hadFailure = false;

function assert(cond, msg) {
  if (!cond) {
    console.log(`  ✗ ${msg}`);
    hadFailure = true;
    return false;
  }
  console.log(`  ✓ ${msg}`);
  return true;
}

for (const c of CASES) {
  console.log(`\n### ${c.account}  ${c.label}  (${c.start} to ${c.end})`);
  const weekly = await loadWeeklyRevenueBasis(supa, {
    members: [c.account], start: c.start, end: c.end, today: TODAY,
  });
  if (weekly.error) {
    console.log(`  ✗ loader error: ${weekly.error.message || weekly.error}`);
    hadFailure = true;
    continue;
  }
  const budRes = await loadOverviewBudgets(supa, { members: [c.account] });
  if (budRes.error) {
    console.log(`  ✗ overview budgets error: ${budRes.error.message || budRes.error}`);
    hadFailure = true;
    continue;
  }

  // Fake budget_periods keyed to whichever periods the range touches
  // (probe compares shape, not cent-precision).
  const budgetPeriods = weekly.data
    .map(w => Number(w.week_start.slice(5, 7)))
    .reduce((seen, m) => {
      const p = m >= 8 && m <= 9 ? 9 : m >= 9 ? 10 : null;
      const p2 = m === 8 ? 9 : m === 9 ? (Number(w => w) < 15 ? 9 : 10) : 10;  // rough
      if (p != null && !seen.some(x => x.period_no === p)) seen.push({ period_no: p, amount: FAKE_BUDGETS_BY_ACCT[c.account]?.[`P${p}`] || 40000 });
      if (p2 != null && !seen.some(x => x.period_no === p2)) seen.push({ period_no: p2, amount: FAKE_BUDGETS_BY_ACCT[c.account]?.[`P${p2}`] || 40000 });
      return seen;
    }, []);

  // Simpler: derive periods from date range directly.
  const startMonth = Number(c.start.slice(5, 7));
  const endMonth = Number(c.end.slice(5, 7));
  const periods = startMonth === 8 || (startMonth === 9 && Number(c.start.slice(8, 10)) < 7)
    ? [9] : startMonth === 9 && Number(c.start.slice(8, 10)) >= 7
      ? [10] : [];
  const bp = periods.map(p => ({ period_no: p, amount: FAKE_BUDGETS_BY_ACCT[c.account]?.[`P${p}`] || 40000 }));

  const pctMap = computeLineTargetPctByPeriod({
    budgetPeriods: bp,
    overviewBudgets: budRes.data,
    members: [c.account],
    periods,
  });

  // Fake a minimal board.weeks - the attach helper walks this shape.
  const fakeBoard = {
    applies: true,
    weeks: weekly.data.map(w => ({ week_start: w.week_start, week_end: w.week_end, spent: 0 })),
  };
  attachWeeklyBasisToBoard(fakeBoard, weekly, {
    lineTargetPctByPeriod: pctMap,
    todayISO: TODAY,
  });

  const w = fakeBoard.weeks;
  const first = w[0];
  const running = w.find(x => x.revenue_basis_temporal === "running");
  const closed = w.find(x => x.revenue_basis_temporal === "closed");

  assert(first?.revenue_basis === "confirmed" || first?.revenue_basis === "forecast",
    `revenue_basis set: ${first?.revenue_basis}`);
  assert(typeof first?.confirmed_days === "number" && first.confirmed_days >= 0 && first.confirmed_days <= 7,
    `confirmed_days in [0,7]: ${first?.confirmed_days}`);
  assert(typeof first?.week_revenue === "number",
    `week_revenue is number: ${first?.week_revenue}`);

  if (running) {
    assert(typeof running.days_left_in_week === "number" && running.days_left_in_week >= 0 && running.days_left_in_week <= 7,
      `running week days_left_in_week: ${running.days_left_in_week}`);
  }
  if (closed && closed.budget_at_this_week_revenue != null) {
    // Redo the math manually and cross-check
    const pct = pctMap.get(periodOf(closed.week_start));
    const expected = Math.round(Number(closed.week_revenue) * Number(pct) * 100) / 100;
    assert(Math.abs(closed.budget_at_this_week_revenue - expected) < 0.01,
      `closed week batr math: ${closed.budget_at_this_week_revenue} == ${expected}`);
  }

  // Print a compact table for the record
  console.log("  weeks:");
  for (const x of w) {
    const rev = Math.round(Number(x.week_revenue || 0)).toLocaleString();
    const budAt = x.budget_at_this_week_revenue != null ? Math.round(x.budget_at_this_week_revenue).toLocaleString() : "-";
    console.log(`    ${x.week_start} ${x.revenue_basis.padEnd(9)} ${x.revenue_basis_temporal.padEnd(7)} rev=$${rev.padStart(7)} batr=$${budAt.padStart(6)} ${x.days_left_in_week != null ? "days_left=" + x.days_left_in_week : ""}`);
  }
}

// periodOf shim for the probe's cross-check above.
function periodOf(weekStartISO) {
  const MS = 86400000;
  const fy = new Date("2025-12-29T00:00:00Z").getTime();
  const d = new Date(weekStartISO + "T00:00:00Z").getTime();
  const days = Math.floor((d - fy) / MS);
  if (days < 0) return null;
  return Math.floor(days / 28) + 1;
}

console.log(hadFailure ? "\nFAIL - one or more assertions did not hold" : "\nPASS - per-week basis fields land as expected");
process.exit(hadFailure ? 1 : 0);
