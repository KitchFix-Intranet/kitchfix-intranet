// src/lib/kpi/shared/periodBasis.js
//
// The ONE owner of a period's basis - revenue-by-line, target percent,
// adjusted budget, state, contributes-to-total. Every surface that
// computes any of these MUST call from here.
//
// Kevin ruling 2026-09-07 (post-#1049 sweep). Prior to this module,
// six surfaces computed a period's revenue basis or adjusted budget
// for themselves and they disagreed:
//
//   panel    vs  table         which periods count        (item 3)
//   panel    vs  week cards    the revenue base           (item 5b)
//   panel    vs  table         which budget               (item 5c)
//   caption  vs  colouring     which budget               (item 6a)
//   chart    vs  single-period the adjusted budget        (item 6b)
//
// #1049 flagged one duplication and predicted more; the sweep found
// four more. This module ends the class of drift by putting the
// derivation in one place. Every consumer here delegates.
//
// TWO RULES that were broken across surfaces and are enforced here:
//
//   1. Contractual revenue (2200 / 2300 / 2600) accrues per week
//      (R-67: budget × completeWeeks/4). It belongs in each week's
//      basis, not only the period total. Panel/week-card disagreement
//      on TBJ - FL P9 ($132,080 vs $107k) came from Labor's week
//      cards using meal revenue only.
//
//   2. A period's target percent is ITS OWN ratio (period_line_budget
//      / period_revenue_budget), never the annual ratio applied per
//      period. Overview's chart used the annual ratio - P6 rendered
//      green while being over on its own budget.
//
// This module folds in the prior `src/lib/kpi/shared/batr.js` so
// there is exactly one shared home for the derivation - two would
// create the same drift class this exists to end.

import {
  REVENUE_LINE_CODES,
  loadPnlActuals,
  loadOverviewBudgets,
  loadScDailyRevenue,
  loadPeriodStatus,
  loadAccountFlags,
  derivePeriodState,
} from "@/lib/kpi/overview/pnl-loader.js";
import { resolveRevenueSource, assertScReadAllowed } from "@/lib/kpi/overview/revenue-source.js";
import { periodStartISO, periodEndISO, endOfLastCompleteWeek } from "@/app/kpi/labor/lib/periods.js";

// Re-export so consumers only import from this file.
export {
  REVENUE_LINE_CODES,
  loadPnlActuals,
  loadOverviewBudgets,
  loadScDailyRevenue,
  loadPeriodStatus,
  loadAccountFlags,
  derivePeriodState,
  resolveRevenueSource,
};

export const CONTRACTUAL_ACCRUAL_LINES = new Set(["2200", "2300", "2600"]);
const FISCAL_YEAR = 2026;

// ─── Formulas (folded in from batr.js) ─────────────────────────────
//
// budget_at_this_revenue = actualRevenue × (lineBudget / revenueBudgetFullPeriod)
//
// R-77 (Kevin 2026-09-04): percent is the KPI. The target does not
// move when revenue moves; the account is held to a percentage of
// whatever revenue arrives. Guards return null when the formula
// cannot be evaluated honestly.

export function budgetAtThisRevenue({
  actualRevenue,
  lineBudget,
  revenueBudgetFullPeriod,
  hasTarget = true,
}) {
  if (!hasTarget) return null;
  if (actualRevenue == null || Number.isNaN(Number(actualRevenue))) return null;
  if (lineBudget == null || Number.isNaN(Number(lineBudget))) return null;
  if (!revenueBudgetFullPeriod) return null;
  const lineTargetPct = Number(lineBudget) / Number(revenueBudgetFullPeriod);
  const raw = Number(actualRevenue) * lineTargetPct;
  return Math.round(raw * 100) / 100;
}

// envelope_delta = budgetToDate - budgetAtThisRevenue
// Positive means the envelope shrank (revenue short of plan).
export function envelopeDelta(budgetToDate, batr) {
  if (budgetToDate == null || batr == null) return null;
  const raw = Number(budgetToDate) - Number(batr);
  return Math.round(raw * 100) / 100;
}

// ─── R-78: contributes to a multi-period total ─────────────────────
//
// closed_awaiting counts (P9 is in This year even though finance has
// not posted). Running (open) and planned do not (P10 renders on the
// chart but does not enter the total).
//
// Prior surfaces implemented this inconsistently: Overview's chart
// excluded the running period, Labor's grand-total row included it,
// panel captions said "N of M closed · running not counted" while
// the number itself included the running period. One helper, one
// answer, everywhere.

export function contributesToTotal(periodState) {
  return periodState === "verified" || periodState === "closed_awaiting";
}

// ─── Per-period target percent ─────────────────────────────────────
//
// Kevin ruling 2026-09-07: a period's target percent is ITS OWN
// ratio, never the annual one. Spring training and off season are
// budgeted differently (R-59). Overview's chart used
// `cogsBudget / revenue_budget_full_period` (annual) and applied
// it to every period - P9 rendered at 51.5% when its own budget
// says 60%, an $11,229 gap on TBJ - FL P9.
//
// Returns null when either budget is missing/zero for the period.

export function computePeriodTargetPct({ members, period, lineCode, overviewBudgets }) {
  if (!overviewBudgets) return null;
  const perLine = overviewBudgets.get(lineCode);
  if (!perLine) return null;
  let lineBud = 0;
  let anyLine = false;
  for (const m of members) {
    const byAcct = perLine.get(m);
    if (!byAcct) continue;
    const v = byAcct.get(period);
    if (v != null) { lineBud += Number(v); anyLine = true; }
  }
  if (!anyLine || lineBud === 0) return null;

  let revBud = 0;
  let anyRev = false;
  for (const rline of REVENUE_LINE_CODES) {
    const perR = overviewBudgets.get(rline);
    if (!perR) continue;
    for (const m of members) {
      const byAcct = perR.get(m);
      if (!byAcct) continue;
      const v = byAcct.get(period);
      if (v != null) { revBud += Number(v); anyRev = true; }
    }
  }
  if (!anyRev || revBud === 0) return null;
  return lineBud / revBud;
}

// Convenience: per-period target percent for a bundle of cost lines.
// Sums the numerators (line budgets) against the same revenue
// denominator. Used for the COGS chart bar target (labor +
// purchasing lines against period revenue budget).
export function computePeriodTargetPctForLines({ members, period, lineCodes, overviewBudgets }) {
  if (!overviewBudgets || !lineCodes?.length) return null;
  let linesBud = 0;
  let anyLine = false;
  for (const line of lineCodes) {
    const perLine = overviewBudgets.get(line);
    if (!perLine) continue;
    for (const m of members) {
      const byAcct = perLine.get(m);
      if (!byAcct) continue;
      const v = byAcct.get(period);
      if (v != null) { linesBud += Number(v); anyLine = true; }
    }
  }
  if (!anyLine) return null;

  let revBud = 0;
  let anyRev = false;
  for (const rline of REVENUE_LINE_CODES) {
    const perR = overviewBudgets.get(rline);
    if (!perR) continue;
    for (const m of members) {
      const byAcct = perR.get(m);
      if (!byAcct) continue;
      const v = byAcct.get(period);
      if (v != null) { revBud += Number(v); anyRev = true; }
    }
  }
  if (!anyRev || revBud === 0) return null;
  return linesBud / revBud;
}

// ─── Per-period contractual accrual (R-67) ─────────────────────────
//
// Returns Map<period_no, total_dollars> summing budgets for the
// contractual lines (2200/2300/2600) across members. Consumers that
// attribute revenue per week (Labor's week cards) divide this by 4
// per closed week to include the accrual in each week's basis - the
// panel/week-card $8,509 gap on TBJ - FL P9 came from the week cards
// missing this share.
//
// R-67 formula for a period: budget × completeWeeks / 4. Per week
// (when closed): budget / 4.
export function computeContractualAccrualByPeriod({ overviewBudgets, members, periods }) {
  const out = new Map();
  if (!overviewBudgets) return out;
  for (const p of periods) {
    let sum = 0;
    for (const line of CONTRACTUAL_ACCRUAL_LINES) {
      const perLine = overviewBudgets.get(line);
      if (!perLine) continue;
      for (const m of members) {
        const byAcct = perLine.get(m);
        if (!byAcct) continue;
        const v = byAcct.get(p);
        if (v != null) sum += Number(v);
      }
    }
    if (sum > 0) out.set(p, sum);
  }
  return out;
}

// ─── Per-(member, period) revenue by line ──────────────────────────
//
// Moved from resolver.js. Every consumer that computes revenue for
// a period MUST call this. The picker (resolveRevenueSource) decides
// source per state; the loaders provide the data; this function
// applies the rules.
//
// Precedence (Kevin revenue-fallback prompt, corrected):
//   1. pnl_actuals verified                         when finance posted
//   2. sc_daily_revenue for count-derived lines     when sc_revenue_live
//   3. R-67 contractual accrual (2200/2300/2600)    every account, per line
//   4. not_reported                                  never budget-as-actual

export function computePeriodRevenueByLine({
  members,
  periods,
  periodStatus,
  accountFlags,
  todayISO,
  overviewBudgets,
  pnl,
  scByAcct,
  revSource,
}) {
  const perPeriod = new Map();
  for (const p of periods) {
    const statusRow = periodStatus.get(p) || null;
    const state = derivePeriodState({ periodNo: p, todayISO, periodStatusRow: statusRow });
    if (!perPeriod.has(p)) perPeriod.set(p, { state });
    const perP = perPeriod.get(p);
    const memberContribs = new Map();
    for (const m of members) {
      const flags = accountFlags.get(m) || null;
      const src = resolveRevenueSource({
        accountKey: m,
        periodState: state,
        revSource,
        accountFlags: flags,
      });
      for (const line of src.line_codes) {
        if (!memberContribs.has(line)) {
          memberContribs.set(line, { amount: 0, reported: false, sources: new Set(), any_actual: false });
        }
        const bucket = memberContribs.get(line);
        if (src.source === "pnl_actuals_verified") {
          const row = pnl.get(m)?.get(p)?.get(line);
          if (row && row.actual != null) {
            bucket.amount += Number(row.actual);
            bucket.any_actual = true;
          }
          bucket.sources.add("pnl_actuals");
        } else if (src.source === "sc_daily_revenue") {
          try { assertScReadAllowed({ accountKey: m, revSource, accountFlags: flags }); }
          catch (e) { throw e; }
          if (line === "2400.1") {
            const byDate = scByAcct.get(m);
            if (byDate) {
              const pStart = periodStartISO(p);
              const pEnd = periodEndISO(p);
              for (const [day, amt] of byDate) {
                if (day >= pStart && day <= pEnd) {
                  bucket.amount += Number(amt);
                  bucket.any_actual = true;
                }
              }
            }
            bucket.sources.add("sc_daily_revenue");
          } else if (CONTRACTUAL_ACCRUAL_LINES.has(line)) {
            // R-67: EVERY account, per line. budget × completeWeeks/4.
            // Closed period => 4/4 = full budget.
            const pStart = periodStartISO(p);
            const pEnd = periodEndISO(p);
            const amtRaw = overviewBudgets.get(line)?.get(m)?.get(p);
            if (amtRaw != null && Number(amtRaw) > 0) {
              const wk = endOfLastCompleteWeek(pStart, pEnd, todayISO);
              const weeksComplete = wk ? wk.weekNo : 0;
              if (weeksComplete > 0) {
                bucket.amount += Number(amtRaw) * (weeksComplete / 4);
                bucket.any_actual = true;
                bucket.sources.add("kpi_budgets_contractual_accrual");
              }
            }
          }
        } else if (src.source === "not_reported") {
          bucket.sources.add("not_reported");
        } else {
          // kpi_budgets_* (contractual for fee / tracked / planned).
          const byAcct = overviewBudgets.get(line)?.get(m);
          const amtRaw = byAcct?.get(p);
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
              const pS = parseISOUTC(pStart), pE = parseISOUTC(pEnd), tD = parseISOUTC(todayISO);
              if (pS && pE && tD) {
                const daysIn = Math.floor((pE.getTime() - pS.getTime()) / MSD) + 1;
                const elapsed = Math.min(daysIn, Math.max(0, Math.floor((tD.getTime() - pS.getTime()) / MSD)));
                bucket.amount += Number(amtRaw) * (elapsed / daysIn);
                bucket.any_actual = true;
              }
            } else {
              bucket.amount += Number(amtRaw);
              bucket.any_actual = true;
            }
          }
          bucket.sources.add(src.source);
        }
      }
    }
    for (const [line, b] of memberContribs) {
      if (!perP[line]) perP[line] = { amount: 0, reported: false, sources: [] };
      if (b.any_actual) {
        perP[line].amount += b.amount;
        perP[line].reported = true;
      }
      perP[line].sources.push(...[...b.sources]);
    }
  }
  return perPeriod;
}

// ─── Per-period revenue total (sum across revenue lines) ──────────
//
// Convenience wrapper for consumers that want a single number per
// period. `perPeriodRevenue` from `computePeriodRevenueByLine` is
// the input; this folds across REVENUE_LINE_CODES.

export function sumPeriodRevenue(perPeriodEntry) {
  if (!perPeriodEntry) return 0;
  let sum = 0;
  for (const line of REVENUE_LINE_CODES) {
    const rec = perPeriodEntry[line];
    if (rec?.reported && rec.amount != null) sum += Number(rec.amount);
  }
  return sum;
}

// ─── Bundled loader ────────────────────────────────────────────────
//
// Every consumer needs the same five reads. One call, one set of
// results, no drift on filter shape or ordering.

export async function loadPeriodBasisInputs(supa, { members, periods, start, end, today }) {
  if (!members?.length || !periods?.length) {
    return { pnl: new Map(), overviewBudgets: new Map(), scByAcct: new Map(), periodStatus: new Map(), accountFlags: new Map() };
  }
  const [pnlRes, budRes, scRes, statusRes, flagsRes] = await Promise.all([
    loadPnlActuals(supa, { members, periods, fiscalYear: FISCAL_YEAR }),
    loadOverviewBudgets(supa, { members, fiscalYear: FISCAL_YEAR }),
    loadScDailyRevenue(supa, { members, start, end, today }),
    loadPeriodStatus(supa, FISCAL_YEAR),
    loadAccountFlags(supa),
  ]);
  const errs = [];
  if (pnlRes?.error) errs.push({ scope: pnlRes.scope || "pnl_actuals", error: pnlRes.error });
  if (budRes?.error) errs.push({ scope: budRes.scope || "kpi_budgets_overview", error: budRes.error });
  if (scRes?.error) errs.push({ scope: scRes.scope || "sc_daily_revenue", error: scRes.error });
  if (statusRes?.error) errs.push({ scope: statusRes.scope || "pnl_period_status", error: statusRes.error });
  if (flagsRes?.error) errs.push({ scope: flagsRes.scope || "kpi_account_flags", error: flagsRes.error });
  if (errs.length > 0) return { error: errs[0] };
  return {
    pnl: pnlRes.data || new Map(),
    overviewBudgets: budRes.data || new Map(),
    scByAcct: scRes.data || new Map(),
    periodStatus: statusRes.data || new Map(),
    accountFlags: flagsRes.data || new Map(),
  };
}
