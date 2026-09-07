// src/lib/labor/labor-batr.js
//
// Labor's attachment layer for the shared period-basis module. This
// file used to duplicate the picker + accrual + revenue-sum logic
// (see #1049); those are now in src/lib/kpi/shared/periodBasis.js
// and this file is a thin consumer.
//
// Two exports remain:
//
//   loadRangeRevenueBasis(supa, {...})
//     Wraps the shared loader + revenue computation. Returns
//     { totalRevenue, revenueBudgetFullPeriod } - the operand set
//     the batr formula needs.
//
//   attachBatrToBoard(board, revenueBasis, {...})
//     Writes budget_at_this_revenue, closed_spent_to_date,
//     closed_variance, and recomputes verdict against the adjusted
//     budget so the pill agrees with the card (Kevin post-1049
//     sweep item 5a).
//
//   periodsClosedBefore(periods, todayISO)
//     Pure calendar helper. R-63: This year excludes running period.

import {
  budgetAtThisRevenue as sharedBatr,
  loadPeriodBasisInputs,
  computePeriodRevenueByLine,
  sumPeriodRevenue,
  REVENUE_LINE_CODES,
} from "@/lib/kpi/shared/periodBasis.js";
import { periodEndISO, periodOf } from "@/app/kpi/labor/lib/periods.js";

const FISCAL_YEAR = 2026;

// Kevin Labor PR-A item 8 (2026-09-04). Given a set of periods,
// return the subset whose end date is strictly before today
// (calendar-closed). Batr uses this so both boards restrict to the
// same period set - "This year is P1 through the last closed period.
// The running period renders hatched and does not enter the total."
export function periodsClosedBefore(periods, todayISO) {
  return (periods || []).filter(p => {
    const end = periodEndISO(p);
    return end && end < todayISO;
  });
}

// Sum revenue budget across REVENUE_LINE_CODES × members × periods.
// Shared derivation kept local because it operates on the same
// overviewBudgets map the shared module already loads; extracting a
// third helper for a two-liner isn't worth the surface area.
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
        if (v != null) { total += Number(v); any = true; }
      }
    }
  }
  return any ? total : null;
}

/**
 * Load the range's revenue basis via the shared module. Returns
 *   { totalRevenue, revenueBudgetFullPeriod }
 * using the same picker Overview uses so both boards agree cent-
 * exact. Kevin's item 2 closes by construction.
 *
 * Prior implementation duplicated computePeriodRevenueByLine inline
 * (#1049). Consolidated 2026-09-07 - see periodBasis.js header for
 * the drift-prevention reasoning.
 */
export async function loadRangeRevenueBasis(supa, { members, periods, start, end, today }) {
  if (!members || members.length === 0) return { totalRevenue: null, revenueBudgetFullPeriod: null };
  if (!periods || periods.length === 0) return { totalRevenue: null, revenueBudgetFullPeriod: null };

  const inputs = await loadPeriodBasisInputs(supa, { members, periods, start, end, today });
  if (inputs.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: inputs.error.scope, message: inputs.error.error?.message || String(inputs.error.error) } };

  // Same picker + rules Overview uses. revSource fixed to "sc"
  // because Labor is always the SC-aware side.
  const perPeriodRevenue = computePeriodRevenueByLine({
    members,
    periods,
    periodStatus: inputs.periodStatus,
    accountFlags: inputs.accountFlags,
    todayISO: today,
    overviewBudgets: inputs.overviewBudgets,
    pnl: inputs.pnl,
    scByAcct: inputs.scByAcct,
    revSource: "sc",
  });

  let totalRevenue = 0;
  let anyReported = false;
  for (const [, entry] of perPeriodRevenue) {
    for (const line of REVENUE_LINE_CODES) {
      const rec = entry[line];
      if (rec?.reported && rec.amount != null) {
        totalRevenue += Number(rec.amount);
        anyReported = true;
      }
    }
  }
  const revenueBudgetFullPeriod = sumRevenueBudget(inputs.overviewBudgets, { members, periods });
  return {
    totalRevenue: anyReported ? Math.round(totalRevenue * 100) / 100 : null,
    revenueBudgetFullPeriod,
  };
}

/**
 * Attach budget_at_this_revenue + closed-only spend + verdict to a
 * labor board.
 *
 * Kevin post-1049 sweep item 5a (2026-09-07): verdict recomputed
 * against the adjusted budget (batr) rather than the raw range
 * budget lib/board.js set. Prior code: pill fired OVER (spent > raw)
 * while the card showed UNDER $3,857 (spent < batr). Pill now agrees
 * with the card by construction.
 */
export function attachBatrToBoard(board, revenueBasis, { hasTarget = true, closedLaborBudget = null, closedPeriods = null } = {}) {
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

  if (Array.isArray(board.weeks) && Array.isArray(closedPeriods)) {
    const closedSet = new Set(closedPeriods);
    let closedSpent = 0;
    let closedWeeks = 0;
    for (const w of board.weeks) {
      const wPeriod = w.week_start ? periodOf(w.week_start) : null;
      if (wPeriod != null && closedSet.has(wPeriod) && w.spent != null) {
        closedSpent += Number(w.spent);
        closedWeeks += 1;
      }
    }
    board.closed_spent_to_date = Math.round(closedSpent * 100) / 100;
    board.closed_weeks_in_range = closedWeeks;
    board.closed_variance = (batr != null)
      ? Math.round((closedSpent - batr) * 100) / 100
      : null;
  }

  // Kevin post-1049 sweep item 5a: recompute verdict against batr,
  // not raw. Prior lib/board.js verdict used raw range_budget →
  // pill said OVER while the panel card said UNDER $3,857. Same
  // pace-points band rule as verdictBand; kept literal here to
  // avoid a cross-module import for one function.
  if (batr != null && batr > 0) {
    const spentForVerdict = board.closed_spent_to_date != null
      ? board.closed_spent_to_date
      : board.spent_to_date;
    if (spentForVerdict != null) {
      const pacePct = (Number(spentForVerdict) / batr) * 100;
      const pacePoints = pacePct - 100;
      board.verdict = pacePoints >= 3 ? "over"
        : pacePoints >= 0.5 ? "watch"
        : "on_track";
      board.variance = Math.round((Number(spentForVerdict) - batr) * 100) / 100;
    }
  }
  return board;
}
