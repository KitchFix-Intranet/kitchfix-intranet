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
import {
  REVENUE_LINE_CODES,
  loadPnlActuals,
  loadOverviewBudgets,
  loadScDailyRevenue,
  loadPeriodStatus,
  loadAccountFlags,
  derivePeriodState,
} from "@/lib/kpi/overview/pnl-loader.js";
import { resolveRevenueSource } from "@/lib/kpi/overview/revenue-source.js";
import { periodEndISO, periodStartISO, periodOf, endOfLastCompleteWeek } from "@/app/kpi/labor/lib/periods.js";

const FISCAL_YEAR = 2026;

// Kevin revenue-fallback prompt (2026-09-07, corrected). R-67
// applies to EVERY account for contractual lines - service fees are
// real revenue that belongs alongside SC counts. Same constant
// resolver.js uses; kept in sync manually until the shared extraction
// lands. If this drifts, the parity check will fail loudly.
const CONTRACTUAL_ACCRUAL_LINES = new Set(["2200", "2300", "2600"]);

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
 * using the SAME picker + sources Overview uses. Corrected per
 * Kevin's revenue-fallback prompt (2026-09-07):
 *   1. finance actual        pnl_actuals when verified
 *   2. Service Calendar      actual_revenue for count-derived lines
 *   3. contractual accrual   R-67, EVERY account, contractual lines
 *   4. nothing               never the budget
 *
 * Prior implementation read pnl_actuals only, which returned null for
 * closed_awaiting periods and made Labor's batr disagree with Overview
 * whenever finance had not posted. Item 2 of Kevin's walkthrough sweep
 * closes by construction now that both boards apply the same rules.
 */
export async function loadRangeRevenueBasis(supa, { members, periods, start, end, today }) {
  if (!members || members.length === 0) return { totalRevenue: null, revenueBudgetFullPeriod: null };
  if (!periods || periods.length === 0) return { totalRevenue: null, revenueBudgetFullPeriod: null };
  const [pnlRes, budRes, scRes, statusRes, flagsRes] = await Promise.all([
    loadPnlActuals(supa, { members, periods, fiscalYear: FISCAL_YEAR }),
    loadOverviewBudgets(supa, { members, fiscalYear: FISCAL_YEAR }),
    loadScDailyRevenue(supa, { members, start, end, today }),
    loadPeriodStatus(supa, FISCAL_YEAR),
    loadAccountFlags(supa),
  ]);
  if (pnlRes?.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: pnlRes.scope || "pnl_actuals", message: pnlRes.error.message || String(pnlRes.error) } };
  if (budRes?.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: budRes.scope || "kpi_budgets_overview", message: budRes.error.message || String(budRes.error) } };
  if (scRes?.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: scRes.scope || "sc_daily_revenue", message: scRes.error.message || String(scRes.error) } };
  if (statusRes?.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: statusRes.scope || "pnl_period_status", message: statusRes.error.message || String(statusRes.error) } };
  if (flagsRes?.error) return { totalRevenue: null, revenueBudgetFullPeriod: null, error: { scope: flagsRes.scope || "kpi_account_flags", message: flagsRes.error.message || String(flagsRes.error) } };

  const pnl = pnlRes.data || new Map();
  const overviewBudgets = budRes.data || new Map();
  const scByAcct = scRes.data || new Map();
  const periodStatus = statusRes.data || new Map();
  const accountFlags = flagsRes.data || new Map();

  // Mirror computePeriodRevenueByLine's per-(member, period, line) picker
  // so Labor's total matches Overview's total to the cent. `revSource`
  // fixed to "sc" because Labor is always the SC-aware side.
  let totalRevenue = 0;
  let anyReported = false;
  for (const p of periods) {
    const statusRow = periodStatus.get(p) || null;
    const state = derivePeriodState({ periodNo: p, todayISO: today, periodStatusRow: statusRow });
    for (const m of members) {
      const flags = accountFlags.get(m) || null;
      const src = resolveRevenueSource({
        accountKey: m,
        periodState: state,
        revSource: "sc",
        accountFlags: flags,
      });
      for (const line of src.line_codes) {
        if (src.source === "pnl_actuals_verified") {
          const row = pnl.get(m)?.get(p)?.get(line);
          if (row?.actual != null) { totalRevenue += Number(row.actual); anyReported = true; }
        } else if (src.source === "sc_daily_revenue") {
          if (line === "2400.1") {
            const byDate = scByAcct.get(m);
            if (byDate) {
              const pStart = periodStartISO(p);
              const pEnd = periodEndISO(p);
              for (const [day, amt] of byDate) {
                if (day >= pStart && day <= pEnd) {
                  totalRevenue += Number(amt);
                  anyReported = true;
                }
              }
            }
          } else if (CONTRACTUAL_ACCRUAL_LINES.has(line)) {
            // R-67 accrual - Kevin's precedence #3, EVERY account.
            const pStart = periodStartISO(p);
            const pEnd = periodEndISO(p);
            const amtRaw = overviewBudgets.get(line)?.get(m)?.get(p);
            if (amtRaw != null && Number(amtRaw) > 0) {
              const wk = endOfLastCompleteWeek(pStart, pEnd, today);
              const weeksComplete = wk ? wk.weekNo : 0;
              if (weeksComplete > 0) {
                totalRevenue += Number(amtRaw) * (weeksComplete / 4);
                anyReported = true;
              }
            }
          }
        } else if (src.source === "not_reported") {
          // Precedence #4 - nothing.
        } else {
          // kpi_budgets_* for fee accounts (contractual) + tracked.
          const amtRaw = overviewBudgets.get(line)?.get(m)?.get(p);
          if (amtRaw != null) {
            if (state === "open") {
              const pStart = periodStartISO(p);
              const pEnd = periodEndISO(p);
              const parseISOUTC = (iso) => {
                const mm = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (!mm) return null;
                return new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3]));
              };
              const MSD = 86400000;
              const pS = parseISOUTC(pStart), pE = parseISOUTC(pEnd), tD = parseISOUTC(today);
              if (pS && pE && tD) {
                const daysIn = Math.floor((pE.getTime() - pS.getTime()) / MSD) + 1;
                const elapsed = Math.min(daysIn, Math.max(0, Math.floor((tD.getTime() - pS.getTime()) / MSD)));
                totalRevenue += Number(amtRaw) * (elapsed / daysIn);
                anyReported = true;
              }
            } else {
              totalRevenue += Number(amtRaw);
              anyReported = true;
            }
          }
        }
      }
    }
  }

  const revenueBudgetFullPeriod = sumRevenueBudget(overviewBudgets, { members, periods });
  return {
    totalRevenue: anyReported ? Math.round(totalRevenue * 100) / 100 : null,
    revenueBudgetFullPeriod,
  };
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

  // Kevin Labor PR-A item 8 UI (2026-09-04): the hero must show
  // spent for CLOSED periods only, not the whole range including
  // the running period. Sum board.weeks filtered to closed periods.
  // Kevin: "the payload now carries closed_range_budget at $413,283
  // while the screen still shows $365,398 - right number, wrong
  // surface. A site lead reading the board today still sees the
  // wrong figure." This adds the matching closed_spent_to_date so
  // the UI can display the correct actual.
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
  return board;
}
