// src/lib/kpi/shared/financeCloseAdjustment.js
//
// Kevin ruling 2026-09-18. A verified period reads finance for cost.
//
// Rule (verbatim from the ruling doc):
//   period state        cost lines read
//   future              budget                       unchanged
//   open                the feeds                    unchanged
//   closed_awaiting     the feeds                    unchanged (R-113 unaudited)
//   verified            pnl_actuals                  THE CHANGE
//
// This module owns the switch. It receives per-period feed totals plus
// pnl_actuals rows and returns, per parent cost line, the adjusted
// actual and the reconciling amount ("finance close adjustment").
//
// Feed detail stays intact. Sub-line rows and the inventory rows keep
// their feed-derived figures. The adjustment lands as a single synthetic
// row per parent, so the group still sums (parent = sub-lines + INVJE +
// FIN_CLOSE). Guard J - the parent is computed once, either by direct
// substitution (this module's caller does that at the composition site)
// or by summing children (never both). Every child-summing consumer was
// enumerated in the pre-build report and none derives a parent from its
// children today; the seeded failure case in
// scripts/probes/_probe_finance_close_no_double_count.mjs asserts that
// invariant on every parent with a non-zero adjustment.

import { isDescendantOfLine } from "@/lib/purchasing/glRollup.js";
import { derivePeriodState } from "@/lib/kpi/overview/pnl-loader.js";
import {
  FINANCE_CLOSE_PARENT_LINES,
  buildFinanceCloseRow,
  absorbFinanceCloseIntoSubLines,
} from "./financeCloseAbsorb.js";

// Kevin R-126 (2026-09-18): pure helpers moved to financeCloseAbsorb.js
// so probes can import them under plain Node without pulling this
// file's @/ alias chain. Re-exported here for backwards compatibility
// with existing importers.
export {
  FINANCE_CLOSE_PARENT_LINES,
  buildFinanceCloseRow,
  absorbFinanceCloseIntoSubLines,
};

// Roll pnl_actuals sub-lines to a parent for one (account_key, period_no).
// Input `pnlMap` matches the resolver's shape:
//   Map<account_key, Map<period_no, Map<line_code, {actual, budget}>>>
// R-116 rollup rule: line matches parent OR startsWith(parent + '.').
function sumPnlForParentPeriod({ pnlMap, accountKey, periodNo, parent }) {
  const byAcct = pnlMap?.get?.(accountKey);
  if (!byAcct) return 0;
  const byPeriod = byAcct.get(periodNo);
  if (!byPeriod) return 0;
  let s = 0;
  for (const [lineCode, row] of byPeriod) {
    if (!isDescendantOfLine(lineCode, parent)) continue;
    if (row && row.actual != null) s += Number(row.actual);
  }
  return Math.round(s * 100) / 100;
}

// Compute per-parent finance-close adjustment for a range.
//
// Inputs:
//   accountKeys  string[]                                     member accounts
//   periods      number[]                                     period_no list in range
//   periodStatus Map<periodNo, {verified_at, closed_at}>      row per period
//   todayISO     string                                       for derivePeriodState
//   pnlMap       Map<acct, Map<period, Map<line_code, row>>>  pnl_actuals in map form
//   feedByParentPeriod Map<parent, Map<period, number>>       feeds side per parent × period
//
// Returns:
//   { verified_periods: number[],
//     has_any_verified: boolean,
//     per_parent: Map<parent, {
//       parent,
//       feed_total,                          full-range feed sum
//       feed_total_on_verified_periods,      feed sum on verified only
//       finance_total,                       pnl_actuals sum on verified only
//       adjustment,                          finance_total - feed_total_on_verified_periods
//       after_actual,                        feed_total + adjustment  (i.e. feed on non-verified + finance on verified)
//       by_period: [{period_no, feed, finance, amount}]  verified periods only
//     }>
//   }
export function resolveFinanceCloseAdjustment({
  accountKeys,
  periods,
  periodStatus,
  todayISO,
  pnlMap,
  feedByParentPeriod,
}) {
  const verifiedPeriods = [];
  for (const p of periods) {
    const state = derivePeriodState({
      periodNo: p,
      todayISO,
      periodStatusRow: periodStatus?.get?.(p) || null,
    });
    if (state === "verified") verifiedPeriods.push(p);
  }

  const perParent = new Map();
  for (const parent of FINANCE_CLOSE_PARENT_LINES) {
    const parentFeeds = feedByParentPeriod?.get?.(parent);
    let feedTotal = 0;
    if (parentFeeds) {
      for (const [, amt] of parentFeeds) feedTotal += Number(amt || 0);
    }
    feedTotal = Math.round(feedTotal * 100) / 100;

    let financeTotal = 0;
    let feedOnVerified = 0;
    const byPeriod = [];
    for (const p of verifiedPeriods) {
      let periodFinance = 0;
      for (const acct of accountKeys) {
        periodFinance += sumPnlForParentPeriod({ pnlMap, accountKey: acct, periodNo: p, parent });
      }
      periodFinance = Math.round(periodFinance * 100) / 100;
      financeTotal += periodFinance;
      const feedThisPeriod = Number(parentFeeds?.get?.(p) ?? 0);
      feedOnVerified += feedThisPeriod;
      byPeriod.push({
        period_no: p,
        finance: periodFinance,
        feed: Math.round(feedThisPeriod * 100) / 100,
        amount: Math.round((periodFinance - feedThisPeriod) * 100) / 100,
      });
    }
    financeTotal = Math.round(financeTotal * 100) / 100;
    feedOnVerified = Math.round(feedOnVerified * 100) / 100;
    const adjustment = Math.round((financeTotal - feedOnVerified) * 100) / 100;
    const afterActual = Math.round((feedTotal + adjustment) * 100) / 100;
    perParent.set(parent, {
      parent,
      feed_total: feedTotal,
      feed_total_on_verified_periods: feedOnVerified,
      finance_total: financeTotal,
      adjustment,
      after_actual: afterActual,
      by_period: byPeriod,
    });
  }
  return {
    verified_periods: verifiedPeriods,
    has_any_verified: verifiedPeriods.length > 0,
    per_parent: perParent,
  };
}

// Mutate a labor board (from buildBoard) to apply the finance-close
// adjustment on the 3100 parent line. Kevin ruling 2026-09-18 · Guard K
// says weeks[] keeps its shape - no synthetic entries there. The
// adjustment lands on a dedicated field.
//
// Preconditions:
//   - board is a labor board (has .spent_to_date and .weeks[]).
//   - `financeClose.per_parent.get("3100")` is the resolveFinanceClose-
//     Adjustment result for 3100.
//
// Side effects on board:
//   board.spent_to_date_feeds  = feeds-only spent (previous board.spent_to_date)
//   board.spent_to_date        = feeds + adjustment
//   board.finance_close_adjustment = { total, by_period[] }
//
// Guard L (adjustment before verdict): the caller must run this helper
// BEFORE any recomputeVerdictFromPanel call so the verdict picks up
// the adjusted spent.
export function applyFinanceCloseToLaborBoard(board, financeClose) {
  if (!board || board.applies === false) return board;
  const info = financeClose?.per_parent?.get?.("3100");
  const adjustment = info?.adjustment ?? 0;
  const verifiedPeriods = financeClose?.verified_periods || [];
  // Kevin ruling 2026-09-18 · Guard A: open + planned periods byte-
  // identical. When the range has no verified periods (running / future
  // only), do not touch board.spent_to_date and do not add new fields.
  // Assignment happens only when the switch has something to do.
  if (verifiedPeriods.length === 0) return board;
  const feedsSpent = Number(board.spent_to_date ?? 0);
  board.spent_to_date_feeds = Math.round(feedsSpent * 100) / 100;
  if (adjustment !== 0) {
    board.spent_to_date = Math.round((feedsSpent + adjustment) * 100) / 100;
  }
  board.finance_close_adjustment = {
    total: Math.round(adjustment * 100) / 100,
    by_period: (info?.by_period || []).map(b => ({ period_no: b.period_no, amount: b.amount })),
    verified_periods: verifiedPeriods,
  };
  return board;
}

// buildFinanceCloseRow + absorbFinanceCloseIntoSubLines now live in
// financeCloseAbsorb.js and are re-exported at the top of this file.
