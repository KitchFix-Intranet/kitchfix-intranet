// src/lib/labor/labor-batr.js
//
// Loads the revenue basis (totalRevenue + revenueBudgetFullPeriod)
// the Labor board needs to compute budget_at_this_revenue for the
// 3100 lever, then hands it to the shared batr formula.
//
// R-77 fix (Kevin 2026-09-04). Labor was built pre-R-44 + R-45 and
// compared to the raw dollar budget. Overview compares to the
// adjusted budget - the R-77 defect where the two boards give
// opposite verdicts on the same account.
//
// Data source: pnl_actuals for verified revenue actuals, kpi_budgets
// (via loadOverviewBudgets) for revenue budgets. Both are the same
// tables the Overview resolver reads - if a source changes, both
// boards move together. The formula lives in the shared module so
// the invariant holds by construction.
//
// PR-A scope: closed ranges only (This year + Last period). Returns
// null when has_target is false, when no periods have revenue budget,
// or when the range is not closed (Overview would return null too).

import { budgetAtThisRevenue as sharedBatr } from "@/lib/kpi/shared/batr.js";
import { REVENUE_LINE_CODES, loadPnlActuals, loadOverviewBudgets } from "@/lib/kpi/overview/pnl-loader.js";
import { periodEndISO } from "@/app/kpi/labor/lib/periods.js";

const FISCAL_YEAR = 2026;

// Kevin Labor PR-A item 8 (2026-09-04): "This year is P1 through the
// last closed period. The running period renders hatched and does not
// enter the total." Same rule as the Overview chart.
//
// Explicitly named so a future reader sees the rule and does not
// silently revert it. The exclusion is what takes TBJ - FL from
// $365,398 (P1-P9) to $341,586 (P1-P8) - the change most likely to
// look like a bug to someone who does not know the rule.
//
// Given a set of periods, returns the subset whose end date is
// strictly before today (calendar-closed). Verified-vs-awaiting is
// the Overview's authoritative distinction elsewhere; for batr the
// calendar boundary matches the R-63 rule that both boards must
// share.
export function periodsClosedBefore(periods, todayISO) {
  return (periods || []).filter(p => {
    const end = periodEndISO(p);
    return end && end < todayISO;
  });
}

// Sum actual_revenue across REVENUE_LINE_CODES for the requested
// members + periods. Filters non-revenue lines the same way Overview
// does: NOT is_non_revenue on the read (pnl_actuals is already
// filtered - the guard here is defence-in-depth for downstream
// callers that pass unfiltered rows).
function sumRevenueActuals(pnl, { members, periods }) {
  let total = 0;
  let anyReported = false;
  for (const m of members) {
    const byAcct = pnl.get(m);
    if (!byAcct) continue;
    for (const p of periods) {
      const perPeriod = byAcct.get(p);
      if (!perPeriod) continue;
      for (const line of REVENUE_LINE_CODES) {
        const row = perPeriod.get(line);
        if (row && row.actual != null) {
          total += Number(row.actual);
          anyReported = true;
        }
      }
    }
  }
  return anyReported ? total : null;
}

// Sum budget across REVENUE_LINE_CODES × members × periods.
// Overview's `revenue_budget_full_period` is the same sum expressed
// per-line then summed; the ordering doesn't matter for the total.
function sumRevenueBudget(overviewBudgets, { members, periods }) {
  let total = 0;
  let any = false;
  for (const line of REVENUE_LINE_CODES) {
    const perLine = overviewBudgets.get(line);
    if (!perLine) continue;
    for (const m of members) {
      const byAcct = perLine.get(m);
      if (!byAcct) continue;
      for (const p of periods) {
        const v = byAcct.get(p);
        if (v != null) {
          total += Number(v);
          any = true;
        }
      }
    }
  }
  return any ? total : null;
}

/**
 * Load the range's revenue basis (totalRevenue + revenueBudgetFullPeriod)
 * once, so the caller can compute batr against different labor
 * budgets - hourly-only, hourly + salary - without re-querying.
 *
 * Same query shape Overview uses (pnl_actuals + kpi_budgets, same
 * members + period set + filter rules). Under identical inputs the
 * two boards read identical revenue numbers by construction. If they
 * ever disagree, one side is either filtering or ordering differently
 * from the other and the parity gate surfaces it.
 */
export async function loadRangeRevenueBasis(supa, { members, periods }) {
  if (!members || members.length === 0) return { totalRevenue: null, revenueBudgetFullPeriod: null };
  if (!periods || periods.length === 0) return { totalRevenue: null, revenueBudgetFullPeriod: null };
  const [pnlRes, budRes] = await Promise.all([
    loadPnlActuals(supa, { members, periods, fiscalYear: FISCAL_YEAR }),
    loadOverviewBudgets(supa, { members, fiscalYear: FISCAL_YEAR }),
  ]);
  if (pnlRes?.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: pnlRes.scope || "pnl_actuals", message: pnlRes.error.message || String(pnlRes.error) } };
  if (budRes?.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: budRes.scope || "kpi_budgets_overview", message: budRes.error.message || String(budRes.error) } };
  const totalRevenue = sumRevenueActuals(pnlRes.data || new Map(), { members, periods });
  const revenueBudgetFullPeriod = sumRevenueBudget(budRes.data || new Map(), { members, periods });
  return { totalRevenue, revenueBudgetFullPeriod };
}

/**
 * Attach budget_at_this_revenue to a labor board object. Idempotent -
 * safe to call again on a board that already carries the field (e.g.,
 * after withSalary merges hourly + salary and rebuilds the board with
 * a new range_budget).
 *
 * Kevin Labor PR-A item 8 (2026-09-04): when the range spans a
 * running period, the labor lineBudget passed to sharedBatr uses the
 * CLOSED-only subset - not board.range_budget which includes the
 * running period's budget. Overview does the same on its side (batr
 * against last-closed revenue + last-closed budget), so the R-77
 * assertion holds only when both sides restrict to the same period
 * set. `closed_range_budget` is exposed on the board so a probe can
 * verify the exclusion happened.
 *
 * Uses the FINAL board's range_budget as the source of "labor budget
 * per period touched by the range" - salary-inclusive when the
 * caller has passed the merged board. Falls back to range_budget
 * itself when no closed subset is available (e.g., single closed
 * period - Last period P8 - where range_budget already IS closed).
 */
export function attachBatrToBoard(board, revenueBasis, { hasTarget = true, closedLaborBudget = null } = {}) {
  if (!board || board.applies === false) return board;
  const laborBudgetForBatr = closedLaborBudget != null ? closedLaborBudget : board.range_budget;
  const batr = sharedBatr({
    actualRevenue: revenueBasis.totalRevenue,
    lineBudget: laborBudgetForBatr,
    revenueBudgetFullPeriod: revenueBasis.revenueBudgetFullPeriod,
    hasTarget,
  });
  board.budget_at_this_revenue = batr;
  board.total_revenue_for_batr = revenueBasis.totalRevenue;
  board.revenue_budget_for_batr = revenueBasis.revenueBudgetFullPeriod;
  board.closed_range_budget = laborBudgetForBatr;
  return board;
}
