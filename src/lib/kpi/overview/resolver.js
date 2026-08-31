// src/lib/kpi/overview/resolver.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// Top-level orchestrator. Composes labor + purchasing engines as
// LIBRARY CALLS (never re-queries labor_actuals, never re-buckets
// purchasing rows) and folds the pnl / period / flag layer on top to
// produce the Overview payload described in §5.4-§5.8 of
// KPI_MASTER_SCOPE.md v4.
//
// Rule enforcement in code:
//   - Cost lines come exclusively from labor's buildBoard (3100) +
//     purchasing's buildPurchasingBoard (3200 / 3400 / 3500 buckets +
//     tracked 5002.1 / 5002.5 / 5017.3).
//   - Revenue lines come from resolveRevenueSource, which picks
//     pnl_actuals / kpi_budgets / sc_daily_revenue per §5.5.
//   - budget_to_date_days for cost lines comes from
//     board.budget_to_date_days + totals.buckets_budget_to_date_days
//     (Phase B rider on the drill boards). Revenue budget_to_date_days
//     uses the pure computeBudgetToDateForLine from budget-to-date.js.
//   - Absence contract propagates: statement rows carry
//     `reported: true|false`, and `actual` is null when reported=false.
//
// Instrumentation:
//   - Every loader call is timed via performance.now(). The `?debug=
//     timing` param on the route returns an `_debug` block with the
//     per-loader wall-time attribution (Phase E of the brief).

import { performance } from "node:perf_hooks";

// Labor + purchasing engines (library-call, no HTTP hop).
import { buildBoard } from "@/app/kpi/labor/lib/board.js";
import { paginateActuals as paginateLaborActuals, resolveMemberBudget } from "@/lib/labor/loaders.js";
import { resolveWorkerMeta } from "@/lib/kpi/resolveWorkerMeta.js";
import { buildWorkerToEmail } from "@/lib/labor/personCount.js";

import { buildPurchasingBoard } from "@/app/kpi/purchasing/lib/resolver.js";
import {
  paginateActuals as paginatePurchasingActuals,
  paginateWeekly as paginatePurchasingWeekly,
  loadPending as loadPurchasingPending,
  loadPurchasingBudgets,
  fetchMembers,
} from "@/lib/purchasing/loaders.js";

// Overview owned modules.
import {
  REVENUE_LINE_CODES,
  ALSO_TRACKED_LINE_CODES,
  loadPeriodStatus,
  loadAccountFlags,
  loadPnlActuals,
  loadOverviewBudgets,
  loadScDailyRevenue,
  derivePeriodState,
} from "./pnl-loader.js";
import { resolveRevenueSource, classifyForRevenue, assertScReadAllowed } from "./revenue-source.js";
import {
  computeBudgetToDateForLine,
  computeFullPeriodBudget,
  computeFullYearBudget,
} from "./budget-to-date.js";
import { computeTicker } from "./ticker.js";
import {
  formatMoneyWhole,
  formatPct,
  pctOf,
  gapDollarsCost,
  gapDollarsRevenue,
  gapDollarsMargin,
  gapPointsCost,
  gapPointsRevenue,
  gapPointsMargin,
  directionOfDelta,
} from "./formatting.js";
import { resolvePosture, resolveIncludeSalary } from "./posture.js";
import { composeFlags, isPackagingGapAccount, isSeededAccount } from "./flags.js";

import { periodOf, periodStartISO, periodEndISO, weekStartsInRange } from "@/app/kpi/labor/lib/periods.js";
import { PURCHASING_ENVELOPE_EXCLUSIONS } from "@/lib/accountModels.js";

const FISCAL_YEAR = 2026;

// ─── Helpers ────────────────────────────────────────────────────────

function r2(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(Number(n) * 100) / 100;
}

// Sum a specific line's budgets across members (returns Map<period, amount>).
function sumBudgetByPeriodForLine({ overviewBudgets, lineCode, members }) {
  const perLine = overviewBudgets.get(lineCode);
  if (!perLine) return new Map();
  const out = new Map();
  for (const m of members) {
    if (PURCHASING_ENVELOPE_EXCLUSIONS.has(m)) continue;
    const byAcct = perLine.get(m);
    if (!byAcct) continue;
    for (const [pn, amt] of byAcct) {
      out.set(pn, (out.get(pn) || 0) + Number(amt));
    }
  }
  return out;
}

// Sum a line's actuals across members + periods from pnl_actuals.
// Returns { amount, reported_period_count, absent_period_count }.
// Absent periods do NOT contribute to `amount` (null = not reported).
function sumPnlForLine({ pnl, lineCode, members, periods }) {
  let amount = 0;
  let reported = 0;
  let absent = 0;
  let anyReported = false;
  for (const m of members) {
    const byAcct = pnl.get(m);
    for (const p of periods) {
      const perPeriod = byAcct?.get(p);
      const row = perPeriod?.get(lineCode);
      if (row && row.actual != null) {
        amount += Number(row.actual);
        reported += 1;
        anyReported = true;
      } else {
        absent += 1;
      }
    }
  }
  return {
    amount: anyReported ? r2(amount) : null,
    reported_period_count: reported,
    absent_period_count: absent,
  };
}

// SC daily revenue -> sum across members + periods. Sums are cumulative.
// scByAcct: Map<account, Map<serviceDate, amount>>
function sumScDailyRevenue({ scByAcct, members, start, end }) {
  let amount = 0;
  let any = false;
  for (const m of members) {
    const byDate = scByAcct.get(m);
    if (!byDate) continue;
    for (const [day, amt] of byDate) {
      if (day >= start && day <= end) {
        amount += Number(amt);
        any = true;
      }
    }
  }
  return { amount: any ? r2(amount) : null, present: any };
}

// Resolve the members list for a top-level account key.
async function resolveMembers(supa, account) {
  if (account === "ALL" || account === "EAST" || account === "WEST") {
    const q = await fetchMembers(supa, account);
    if (q.error) return { error: q.error, scope: "members" };
    return { data: q.members };
  }
  return { data: [account] };
}

// Range resolution. `range` inputs:
//   - { kind: 'fytd' }
//   - { kind: 'period', period_no: N }
//   - { kind: 'explicit', start, end }
function resolveRange({ range, today }) {
  if (!range || range.kind === "fytd") {
    return {
      start: "2025-12-29",
      end: today,
      kind: "fytd",
      period_no: null,
    };
  }
  if (range.kind === "period") {
    const s = periodStartISO(range.period_no);
    const e = periodEndISO(range.period_no);
    if (!s || !e) {
      throw new Error(`overview-range: unknown period_no ${range.period_no}`);
    }
    return {
      start: s,
      end: e,
      kind: "period",
      period_no: range.period_no,
    };
  }
  if (range.kind === "explicit") {
    return {
      start: range.start,
      end: range.end,
      kind: "explicit",
      period_no: null,
    };
  }
  throw new Error(`overview-range: unknown range.kind ${range?.kind}`);
}

// Enumerate the fiscal periods the range's weeks touch.
function periodsInRangeFor(start, end) {
  const weeks = weekStartsInRange(start, end);
  return [...new Set(weeks.map(w => periodOf(w)).filter(p => p != null))].sort((a, b) => a - b);
}

// Compute per-period revenue: pick the source per period and produce
// { amount, reported: bool, source, model } for each period.
function computePeriodRevenueByLine({
  members,
  periods,
  periodStatus,
  accountFlags,
  todayISO,
  overviewBudgets,
  pnl,
  scByAcct,
  revSource,
  scope,   // { accountKey, kind: 'single' | 'aggregate' }
}) {
  // Per-period, per-member picker. For an aggregate, we roll UP the
  // per-member picks (source per member because per-meal vs fee can
  // mix across members in ALL / EAST / WEST).
  const perPeriod = new Map();  // period -> { line_code -> { amount, reported, sources[] } }
  for (const p of periods) {
    const statusRow = periodStatus.get(p) || null;
    const state = derivePeriodState({ periodNo: p, todayISO, periodStatusRow: statusRow });
    if (!perPeriod.has(p)) perPeriod.set(p, { state });
    const perP = perPeriod.get(p);
    const memberContribs = new Map();  // line_code -> {amount, reported, sources[]}
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
        // Pick the number:
        //   source = pnl_actuals_verified  -> pnl_actuals row's `actual`
        //   source = sc_daily_revenue      -> sum sc_daily_revenue for this
        //                                     member across period days
        //   source = kpi_budgets_*         -> budget-to-date proration by
        //                                     day for the current period,
        //                                     full budget for closed
        //                                     (contractual / estimate /
        //                                     planned / tracked all use
        //                                     kpi_budgets amount)
        if (src.source === "pnl_actuals_verified") {
          const row = pnl.get(m)?.get(p)?.get(line);
          if (row && row.actual != null) {
            bucket.amount += Number(row.actual);
            bucket.any_actual = true;
          }
          // Absent = not reported. Don't contribute.
          bucket.sources.add("pnl_actuals");
        } else if (src.source === "sc_daily_revenue") {
          // Guard - belt-and-suspenders (picker already checked).
          try { assertScReadAllowed({ accountKey: m, revSource, accountFlags: flags }); }
          catch (e) { throw e; }
          // For SC, we only credit line 2400.1 (the per-meal service line;
          // sc_daily_revenue represents meal-service revenue only).
          if (line === "2400.1") {
            const byDate = scByAcct.get(m);
            if (byDate) {
              const pStart = periodStartISO(p);
              const pEnd = periodEndISO(p);
              // The period runs pStart..pEnd; SC data through
              // yesterday is what the render displays "through DATA_
              // THRU". Sum EVERY sc day in the period that we have
              // (up to today; the resolver crops if end > today).
              for (const [day, amt] of byDate) {
                if (day >= pStart && day <= pEnd) {
                  bucket.amount += Number(amt);
                  bucket.any_actual = true;
                }
              }
            }
            bucket.sources.add("sc_daily_revenue");
          }
        } else {
          // kpi_budgets_* (contractual / estimate / planned / tracked).
          // For a CLOSED period => full budget. For OPEN period =>
          // budget-to-date by days. Compute here.
          const byAcct = overviewBudgets.get(line)?.get(m);
          const amtRaw = byAcct?.get(p);
          if (amtRaw != null) {
            if (state === "open") {
              const pStart = periodStartISO(p);
              const pEnd = periodEndISO(p);
              // Days elapsed through yesterday inclusive.
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
                bucket.any_actual = true;   // budget contributes (planned or contractual)
              }
            } else {
              // Closed - full period budget (fee accounts get contract;
              // per-meal closed_awaiting gets budget as estimate).
              bucket.amount += Number(amtRaw);
              bucket.any_actual = true;
            }
          }
          bucket.sources.add(src.source);
        }
      }
    }
    // Fold member contribs -> period contribs.
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

// Sum per-period contributions into range totals per line.
function sumRangeRevenueByLine({ perPeriod, lineCodes }) {
  const out = {};
  for (const line of lineCodes) {
    let amount = 0;
    let anyReported = false;
    const sources = new Set();
    for (const [_, byLine] of perPeriod) {
      const b = byLine[line];
      if (b) {
        if (b.reported) {
          amount += b.amount;
          anyReported = true;
        }
        for (const s of b.sources) sources.add(s);
      }
    }
    out[line] = {
      amount: anyReported ? r2(amount) : null,
      reported: anyReported,
      sources: [...sources],
    };
  }
  return out;
}

// ─── Loader independence audit ──────────────────────────────────────
//
// This audit is proven BY READING each loader's inputs, per Kevin's
// rule. See PR body for the table. The three top-level parallel
// loaders in this resolver are:
//   - loadPeriodStatus (supa, fiscalYear)      - global
//   - loadAccountFlags (supa)                  - global
//   - resolveMembers (supa, accountKey)        - independent of the two above
// Once members is resolved, all downstream loaders read only
// (supa, members, start, end, fiscal_year). None reads any other's
// output. The single downstream parallel block is safe.

// ─── The top-level resolve ──────────────────────────────────────────

/**
 * Resolve the Overview payload for one request.
 *
 * @param {object} args
 * @param {object} args.supa               Supabase service client
 * @param {string} args.accountKey         'ALL' | 'EAST' | 'WEST' | single account
 * @param {object} args.range              { kind: 'fytd' | 'period' | 'explicit', ... }
 * @param {string} args.revSource          'planned' | 'sc'
 * @param {boolean} args.includeSalary
 * @param {object} args.caller             { role, scope, can_see_salary }
 * @param {string} args.today              ISO YYYY-MM-DD
 * @param {boolean} [args.debugTiming]     when true, includes _debug.timings
 *
 * @returns {Promise<object>} payload
 */
export async function resolveOverview({
  supa,
  accountKey,
  range,
  revSource = "planned",
  includeSalary = false,
  caller,
  today,
  debugTiming = false,
}) {
  const t0 = performance.now();
  const timings = {};
  const timeIt = async (label, fn) => {
    const t = performance.now();
    const v = await fn();
    timings[label] = Math.round((performance.now() - t) * 10) / 10;
    return v;
  };

  // 1. Range resolution + members resolution (single hop each, independent).
  const rng = resolveRange({ range, today });
  const mResp = await timeIt("resolveMembers", () => resolveMembers(supa, accountKey));
  if (mResp.error) return { error: mResp.error, scope: mResp.scope };
  const members = mResp.data;
  if (!members || members.length === 0) {
    return { error: { message: `no members for ${accountKey}` }, scope: "members" };
  }

  const isAggregate = accountKey === "ALL" || accountKey === "EAST" || accountKey === "WEST";
  const posture = resolvePosture({ caller, salaryAvailable: caller?.can_see_salary === true });

  // Corp-only rev toggle: if a non-corp caller passes rev_source=sc,
  // silently ignore (mirrors labor's include_salary silent-drop).
  const effRevSource = posture.revenue_toggle_visible && revSource === "sc" ? "sc" : "planned";

  // 2. Layer-1 loaders. Fire in parallel - all read (supa, members)
  //    or (supa) or (supa, members, start, end).
  //
  // Loader independence audit (proven by reading):
  //   - loadPeriodStatus(supa, FY)                              - (supa) global
  //   - loadAccountFlags(supa)                                  - (supa) global
  //   - loadOverviewBudgets(supa, {members, FY})                - (supa, members)
  //   - loadPnlActuals(supa, {members, periods, FY})            - (supa, members, periods)
  //     periods enumerated from range (URL param), NOT from any loader
  //   - loadScDailyRevenue(supa, {members, start, end})         - (supa, members, range)
  //   - LABOR: paginateLaborActuals(supa, {members, start, end}) - (supa, members, range)
  //   - LABOR: resolveMemberBudget(supa, m) per member          - (supa, m)
  //   - PURCH: paginatePurchasingWeekly(supa, {members, start, end}) - (supa, members, range)
  //   - PURCH: paginatePurchasingActuals(supa, {members, start, end}) - (supa, members, range)
  //   - PURCH: loadPurchasingPending(supa, {members, start, end}) - (supa, members, range)
  //   - PURCH: loadPurchasingBudgets(supa, members, FY)         - (supa, members, FY)
  //
  // None reads another loader's output. Fire all in one Promise.all.
  //
  // resolveWorkerMeta needs actualsRows[].worker_id from paginateLaborActuals -
  // that IS a dependency, so it runs AFTER Layer 1 in Layer 2.
  const periods = periodsInRangeFor(rng.start, rng.end);

  const layer1 = await timeIt("layer1_parallel", async () => Promise.all([
    loadPeriodStatus(supa, FISCAL_YEAR),
    loadAccountFlags(supa),
    loadOverviewBudgets(supa, { members, fiscalYear: FISCAL_YEAR }),
    loadPnlActuals(supa, { members, periods, fiscalYear: FISCAL_YEAR }),
    // SC daily revenue always read (cheap; per-account narrow). The
    // guard is what prevents contamination from surfacing in the
    // per-account picker. Aggregates that don't need it just pass
    // through zero-summed maps.
    loadScDailyRevenue(supa, { members, start: rng.start, end: rng.end }),
    paginateLaborActuals(supa, { members, start: rng.start, end: rng.end }),
    Promise.all(members.map(m => resolveMemberBudget(supa, m))),
    paginatePurchasingWeekly(supa, { members, start: rng.start, end: rng.end }),
    paginatePurchasingActuals(supa, { members, start: rng.start, end: rng.end }),
    loadPurchasingPending(supa, { members, start: rng.start, end: rng.end }),
    loadPurchasingBudgets(supa, members, FISCAL_YEAR),
  ]));
  const [
    periodStatusResp, accountFlagsResp, overviewBudgetsResp, pnlResp,
    scResp, laborActualsResp, memberBudgetResults,
    purchWeeklyResp, purchActualsResp, purchPendingResp, purchBudgetsResp,
  ] = layer1;

  const errs = [];
  if (periodStatusResp.error) errs.push({ scope: "kpi_period_status", error: periodStatusResp.error });
  if (accountFlagsResp.error) errs.push({ scope: "kpi_account_flags", error: accountFlagsResp.error });
  if (overviewBudgetsResp.error) errs.push({ scope: "kpi_budgets_overview", error: overviewBudgetsResp.error });
  if (pnlResp.error) errs.push({ scope: "pnl_actuals", error: pnlResp.error });
  if (scResp.error) errs.push({ scope: "sc_daily_revenue", error: scResp.error });
  if (laborActualsResp.error) errs.push({ scope: "labor_actuals", error: laborActualsResp.error });
  for (const r of memberBudgetResults || []) {
    if (r.error) errs.push({ scope: r.scope || "member_budget", error: r.error });
  }
  if (purchWeeklyResp.error) errs.push({ scope: "v_purchasing_by_site_week", error: purchWeeklyResp.error });
  if (purchActualsResp.error) errs.push({ scope: "purchasing_actuals", error: purchActualsResp.error });
  if (purchPendingResp.error) errs.push({ scope: "purchasing_pending", error: purchPendingResp.error });
  if (purchBudgetsResp.error) errs.push({ scope: "kpi_budgets_purchasing", error: purchBudgetsResp.error });
  if (errs.length > 0) {
    return { error: errs[0].error, scope: errs[0].scope, all_errors: errs };
  }

  const periodStatus = periodStatusResp.data;
  const accountFlags = accountFlagsResp.data;
  const overviewBudgets = overviewBudgetsResp.data;
  const pnl = pnlResp.data;
  const scByAcct = scResp.data;
  const laborActuals = laborActualsResp.data;
  const memberBudgets = new Map();
  for (let i = 0; i < members.length; i += 1) {
    memberBudgets.set(members[i], memberBudgetResults[i].data);
  }
  const purchWeekly = purchWeeklyResp.data;
  const purchActuals = purchActualsResp.data;
  const purchPending = purchPendingResp.data;
  const purchBudgets = purchBudgetsResp.data;

  // 3. Layer-2: workerToEmail from laborActuals (dependency).
  const workerIds = [...new Set((laborActuals || []).map(r => r.worker_id))];
  const workerMeta = await timeIt("resolveWorkerMeta", () => resolveWorkerMeta(supa, workerIds));
  const workerToEmail = buildWorkerToEmail(workerMeta.workerMeta);

  // 4. Aggregate labor budget_periods across members (mirrors labor
  //    route's aggregate branch's per-period sum). Also handles
  //    single-account case (memberBudgets has one entry).
  const laborBudgetSumMap = new Map();  // p -> amount
  for (const [, list] of memberBudgets) {
    for (const bp of list || []) {
      laborBudgetSumMap.set(bp.period_no, (laborBudgetSumMap.get(bp.period_no) || 0) + Number(bp.amount));
    }
  }
  const laborBudgetPeriods = [...laborBudgetSumMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([p, amt]) => ({ period_no: p, amount: r2(amt) }));

  // 5. Call labor buildBoard as a library call. account_state we
  //    determine from members - if all members are salaried_only
  //    (CIN - KY, TBJ - NY only) buildBoard returns not-applicable.
  //    For the Overview's aggregate ALL, at least one hourly member
  //    exists so hourly_ok is correct. For a single salaried_only
  //    account, we still call buildBoard for shape parity but expect
  //    applies:false; costs come from purchasing only.
  const laborBoard = await timeIt("buildBoard(labor)", async () => buildBoard({
    account: accountKey,
    start: rng.start,
    end: rng.end,
    today,
    actuals: laborActuals,
    budget_periods: laborBudgetPeriods,
    account_state: "hourly_ok",
    workerToEmail,
  }));

  // 6. Call purchasing buildPurchasingBoard as a library call.
  const purchBoard = await timeIt("buildBoard(purchasing)", async () => buildPurchasingBoard({
    members,
    start: rng.start,
    end: rng.end,
    today,
    actualsRows: purchActuals,
    weeklyRows: purchWeekly,
    pendingRow: purchPending,
    budgetMap: purchBudgets,
  }));

  // 7. Compute per-period revenue by line + range totals.
  const perPeriodRevenue = computePeriodRevenueByLine({
    members,
    periods,
    periodStatus,
    accountFlags,
    todayISO: today,
    overviewBudgets,
    pnl,
    scByAcct,
    revSource: effRevSource,
    scope: { accountKey, kind: isAggregate ? "aggregate" : "single" },
  });
  const revenueByLine = sumRangeRevenueByLine({
    perPeriod: perPeriodRevenue,
    lineCodes: REVENUE_LINE_CODES,
  });

  // 8. Revenue TOTAL: sum across the 5 revenue lines. reported = any
  //    line reported. sources = union of sources across lines.
  let totalRevenueAmount = 0;
  let totalRevReported = false;
  const totalRevSources = new Set();
  for (const line of REVENUE_LINE_CODES) {
    const r = revenueByLine[line];
    if (r?.reported) {
      totalRevenueAmount += r.amount;
      totalRevReported = true;
    }
    for (const s of r?.sources || []) totalRevSources.add(s);
  }
  const totalRevenue = totalRevReported ? r2(totalRevenueAmount) : null;

  // 9. Revenue BUDGET to date + full-period + full-year. Sum over the
  //    5 revenue lines' budgets. Fee accounts + tracked accounts only
  //    have 2400.1 populated; per-meal have multiple.
  let revBudgetToDate = 0;
  let revBudgetFullPeriod = 0;
  let revBudgetFullYear = 0;
  let anyRevBudget = false;
  for (const line of REVENUE_LINE_CODES) {
    const byPeriod = sumBudgetByPeriodForLine({ overviewBudgets, lineCode: line, members });
    if (byPeriod.size === 0) continue;
    const bto = computeBudgetToDateForLine({ budgetByPeriod: byPeriod, periodsInRange: periods, today });
    if (bto.amount != null) {
      revBudgetToDate += bto.amount;
      anyRevBudget = true;
    }
    const fp = computeFullPeriodBudget({ budgetByPeriod: byPeriod, periodsInRange: periods });
    if (fp != null) revBudgetFullPeriod += fp;
    const fy = computeFullYearBudget({ budgetByPeriod: byPeriod });
    if (fy != null) revBudgetFullYear += fy;
  }
  const revenue_budget_to_date = anyRevBudget ? r2(revBudgetToDate) : null;
  const revenue_budget_full_period = anyRevBudget ? r2(revBudgetFullPeriod) : null;
  const revenue_budget_full_year = anyRevBudget ? r2(revBudgetFullYear) : null;

  // 10. Cost lines - pull from the engines.
  //    Labor (3100): board.spent_to_date + board.range_budget +
  //      board.budget_to_date_days
  //    Purchasing buckets (3200/3400/3500): purchBoard.buckets +
  //      purchBoard.totals.buckets_budget +
  //      purchBoard.totals.buckets_budget_to_date_days
  //    Purchasing tracked (5002.1/5002.5/5017.3): purchBoard.tracked +
  //      purchBoard.totals.tracked_budget_to_date_days

  const labor3100_actual = laborBoard?.applies ? r2(laborBoard.spent_to_date) : null;
  const labor3100_budget = laborBoard?.applies ? (laborBoard.range_budget ?? null) : null;
  const labor3100_budget_to_date_days = laborBoard?.applies
    ? (laborBoard.budget_to_date_days?.amount ?? null)
    : null;

  const food_actual = purchBoard.buckets["3200"]?.period_total ?? null;
  const food_budget = purchBoard.buckets["3200"]?.budget ?? null;
  const packaging_actual = purchBoard.buckets["3400"]?.period_total ?? null;
  const packaging_budget = purchBoard.buckets["3400"]?.budget ?? null;
  const vehicle_actual = purchBoard.buckets["3500"]?.period_total ?? null;
  const vehicle_budget = purchBoard.buckets["3500"]?.budget ?? null;

  // Budget-to-date-days for the buckets aggregate. purchBoard's
  // totals block ships buckets_budget_to_date_days as an aggregate;
  // per-bucket day-budget is a Phase-6 deliverable, not shipped here.
  const buckets_budget_to_date_days = purchBoard.totals.buckets_budget_to_date_days;

  const rm_actual = purchBoard.tracked["5002.1"]?.period_total ?? null;
  const rm_budget = purchBoard.tracked["5002.1"]?.budget ?? null;
  const equip_actual = purchBoard.tracked["5002.5"]?.period_total ?? null;
  const equip_budget = purchBoard.tracked["5002.5"]?.budget ?? null;
  const perks_actual = purchBoard.tracked["5017.3"]?.period_total ?? null;
  const perks_budget = purchBoard.tracked["5017.3"]?.budget ?? null;

  // Total COGS actual + budget = labor + food + packaging + vehicle.
  // A null on any line means "not applicable" (e.g., labor on a
  // salaried-only single account). Substitute 0 for math when null,
  // but the payload preserves the null in each line.
  const cogsActual = (labor3100_actual || 0) + (food_actual || 0) + (packaging_actual || 0) + (vehicle_actual || 0);
  const cogsBudget = (labor3100_budget || 0) + (food_budget || 0) + (packaging_budget || 0) + (vehicle_budget || 0);
  const cogsBudgetToDateDays = (labor3100_budget_to_date_days || 0) + (buckets_budget_to_date_days?.amount || 0);

  // 11. Gross margin.
  const grossMargin = totalRevenue != null ? r2(totalRevenue - cogsActual) : null;
  const grossMarginBudget = totalRevenue != null ? r2((revenue_budget_to_date || 0) - cogsBudgetToDateDays) : null;
  const gmPctActual = pctOf(grossMargin, totalRevenue);
  const gmPctBudget = pctOf(grossMarginBudget, revenue_budget_to_date);

  // 12. Period state chip - the range's chip is the state of the
  //     current period in the range, or the terminal period for a
  //     closed range. FYTD uses the current period.
  let displayPeriodNo = null;
  let displayPeriodState = "open";
  if (rng.kind === "period") {
    displayPeriodNo = rng.period_no;
  } else if (rng.kind === "fytd") {
    displayPeriodNo = periods.length > 0 ? periods[periods.length - 1] : null;
  } else if (rng.kind === "explicit") {
    displayPeriodNo = periods.length > 0 ? periods[periods.length - 1] : null;
  }
  if (displayPeriodNo != null) {
    displayPeriodState = derivePeriodState({
      periodNo: displayPeriodNo,
      todayISO: today,
      periodStatusRow: periodStatus.get(displayPeriodNo) || null,
    });
  }

  // 13. Flags block.
  // Determine if the display period's per-meal revenue is planned
  // (has at least one per-meal member on planned mode).
  const perMealMembers = members.filter(m => classifyForRevenue(m) === "per_meal");
  const perMealPlanned = displayPeriodState === "open" && perMealMembers.length > 0 && !(
    effRevSource === "sc" && perMealMembers.every(m => accountFlags.get(m)?.sc_revenue_live === true)
  );
  const scLiveAny = perMealMembers.some(m => accountFlags.get(m)?.sc_revenue_live === true);
  const flags = composeFlags({
    accountKey,
    members,
    revSource: effRevSource,
    scLive: scLiveAny,
    revenueModel: (() => {
      if (isAggregate) return null;
      const rs = resolveRevenueSource({
        accountKey,
        periodState: displayPeriodState,
        revSource: effRevSource,
        accountFlags: accountFlags.get(accountKey) || null,
      });
      return rs.model;
    })(),
  });
  // Override `planned` to reflect display-period planned semantics for
  // aggregates too.
  flags.planned = perMealPlanned;

  // 14. Ticker.
  const isFeeAccount = !isAggregate && classifyForRevenue(accountKey) === "fee";
  const isPassThrough = flags.pass_through;
  const cogsLinesForTicker = [
    { line_code: "3100", label: "Kitchen labor",           actual_pct: pctOf(labor3100_actual, totalRevenue), target_pct: pctOf(labor3100_budget, revenue_budget_to_date) },
    { line_code: "3200", label: "Food purchased",          actual_pct: pctOf(food_actual, totalRevenue),      target_pct: pctOf(food_budget, revenue_budget_to_date) },
    { line_code: "3400", label: "Packaging and supplies",  actual_pct: pctOf(packaging_actual, totalRevenue), target_pct: pctOf(packaging_budget, revenue_budget_to_date) },
    { line_code: "3500", label: "Vehicle",                 actual_pct: pctOf(vehicle_actual, totalRevenue),   target_pct: pctOf(vehicle_budget, revenue_budget_to_date) },
  ].filter(l => l.actual_pct != null && l.target_pct != null);

  // Weeks-closed for the through segment (single-period ranges).
  let weeks_closed = null;
  let weeks_total = null;
  if (rng.kind === "period" && laborBoard?.applies) {
    weeks_closed = laborBoard.closed_weeks_count ?? null;
    weeks_total = laborBoard.weeks_in_period ?? null;
  }

  const ticker = computeTicker({
    gm_pct_actual: gmPctActual,
    gm_pct_target: gmPctBudget,
    cogs_lines: cogsLinesForTicker,
    period_state: displayPeriodState,
    data_thru_date: today,
    weeks_closed,
    weeks_total,
    is_fee_account: isFeeAccount,
    is_pass_through: isPassThrough,
    revenue_is_planned: flags.planned,
    sc_mode_test_data: effRevSource === "sc" && flags.seeded && posture.posture === "corporate",
  });

  // 15. Cards (Revenue, COGS, Gross margin). Server-side formatting.
  const revenueDelta = totalRevenue != null && revenue_budget_to_date != null
    ? r2(totalRevenue - revenue_budget_to_date) : null;
  const cogsDelta = cogsActual - cogsBudgetToDateDays;
  const gmDelta = grossMargin != null && grossMarginBudget != null
    ? r2(grossMargin - grossMarginBudget) : null;

  const cards = [
    {
      key: "revenue",
      label: "Revenue",
      gl_codes: "2200 · 2300 · 2400",
      hero_actual: totalRevenue,
      hero_actual_display: formatMoneyWhole(totalRevenue),
      hero_reported: totalRevReported,
      budget_to_date: revenue_budget_to_date,
      budget_to_date_display: formatMoneyWhole(revenue_budget_to_date),
      budget_full_period: revenue_budget_full_period,
      budget_full_period_display: formatMoneyWhole(revenue_budget_full_period),
      budget_full_year: revenue_budget_full_year,
      budget_full_year_display: formatMoneyWhole(revenue_budget_full_year),
      delta_dollars: revenueDelta,
      delta_display: revenueDelta != null ? gapDollarsRevenue(revenueDelta) : null,
      delta_direction: revenueDelta != null ? directionOfDelta(revenueDelta, "revenue") : null,
      pill: (() => {
        if (isFeeAccount) return { label: "Contractual", tone: "neutral" };
        if (flags.planned) return { label: "Planned", tone: "warn" };
        if (revenueDelta == null) return { label: "No data", tone: "neutral" };
        return revenueDelta >= 0
          ? { label: "Above budget", tone: "good" }
          : { label: "Below budget", tone: "bad" };
      })(),
      sources: [...totalRevSources],
    },
    {
      key: "cogs",
      label: "Cost of goods sold",
      gl_codes: "3100 – 3500",
      hero_actual: r2(cogsActual),
      hero_actual_display: formatMoneyWhole(cogsActual),
      // COGS is derived from live labor + live purchasing engines - it
      // is always reported (never null in-scope).
      hero_reported: true,
      budget_to_date: r2(cogsBudgetToDateDays),
      budget_to_date_display: formatMoneyWhole(cogsBudgetToDateDays),
      pct_of_revenue: pctOf(cogsActual, totalRevenue),
      pct_of_revenue_display: formatPct(pctOf(cogsActual, totalRevenue)),
      target_pct_of_revenue: pctOf(cogsBudget, revenue_budget_to_date),
      target_pct_display: formatPct(pctOf(cogsBudget, revenue_budget_to_date)),
      delta_dollars: r2(cogsDelta),
      delta_display: gapDollarsCost(cogsDelta),
      delta_direction: directionOfDelta(cogsDelta, "cost"),
      delta_pct_display: gapPointsCost(pctOf(cogsActual, totalRevenue) - pctOf(cogsBudget, revenue_budget_to_date)),
      pill: (() => {
        const pa = pctOf(cogsActual, totalRevenue);
        const pt = pctOf(cogsBudget, revenue_budget_to_date);
        if (pa == null || pt == null) return { label: "No data", tone: "neutral" };
        return pa <= pt
          ? { label: "Under target", tone: "good" }
          : { label: "Over target", tone: "bad" };
      })(),
      mini: [
        { label: "Labor",     actual: labor3100_actual, display: formatMoneyWhole(labor3100_actual) },
        { label: "Food",      actual: food_actual,      display: formatMoneyWhole(food_actual) },
        { label: "Packaging", actual: packaging_actual, display: formatMoneyWhole(packaging_actual) },
        { label: "Vehicle",   actual: vehicle_actual,   display: formatMoneyWhole(vehicle_actual) },
      ],
    },
    {
      key: "gross_margin",
      label: "Gross margin",
      hero_actual: grossMargin,
      hero_actual_display: formatMoneyWhole(grossMargin),
      hero_reported: totalRevReported,
      budget_to_date: grossMarginBudget,
      budget_to_date_display: formatMoneyWhole(grossMarginBudget),
      pct_of_revenue: gmPctActual,
      pct_of_revenue_display: formatPct(gmPctActual),
      target_pct_of_revenue: gmPctBudget,
      target_pct_display: formatPct(gmPctBudget),
      delta_dollars: gmDelta,
      delta_display: gmDelta != null ? gapDollarsMargin(gmDelta) : null,
      delta_direction: gmDelta != null ? directionOfDelta(gmDelta, "margin") : null,
      delta_pct_display: (gmPctActual != null && gmPctBudget != null) ? gapPointsMargin(gmPctActual - gmPctBudget) : null,
      pill: (() => {
        if (gmPctActual == null || gmPctBudget == null) return { label: "No data", tone: "neutral" };
        return gmPctActual >= gmPctBudget
          ? { label: "Ahead", tone: "good" }
          : { label: "Behind", tone: "warn" };
      })(),
    },
  ];

  // 16. Levers - the four COGS lines with actual + budget + variance +
  //     pct-of-rev + target-pct + vs-target.
  const buildLever = (label, code, actual, budget) => {
    const actualPct = pctOf(actual, totalRevenue);
    const targetPct = pctOf(budget, revenue_budget_to_date);
    const dv = actual != null && budget != null ? r2(actual - budget) : null;
    return {
      line_code: code,
      label,
      actual,
      actual_display: formatMoneyWhole(actual),
      budget,
      budget_display: formatMoneyWhole(budget),
      variance_dollars: dv,
      variance_display: dv != null ? gapDollarsCost(dv) : null,
      actual_pct: actualPct,
      actual_pct_display: formatPct(actualPct),
      target_pct: targetPct,
      target_pct_display: formatPct(targetPct),
      variance_pct: (actualPct != null && targetPct != null) ? r2(actualPct - targetPct) : null,
      variance_pct_display: (actualPct != null && targetPct != null) ? gapPointsCost(actualPct - targetPct) : null,
      direction: dv != null ? directionOfDelta(dv, "cost") : null,
      flag: code === "3400" && flags.packaging_gap ? "mapping_gap" : null,
    };
  };
  const levers = [
    buildLever("Kitchen labor",          "3100", labor3100_actual,  labor3100_budget),
    buildLever("Food purchased",         "3200", food_actual,       food_budget),
    buildLever("Packaging and supplies", "3400", packaging_actual,  packaging_budget),
    buildLever("Vehicle",                "3500", vehicle_actual,    vehicle_budget),
  ];

  // 17. Chart series. Period grain for FYTD; week grain for a single
  //     period. Weeks come from the purchasing weekly view + labor
  //     week aggregates.
  let chart;
  if (rng.kind === "period") {
    // Week grain. Iterate the weeks in the period and read from both
    // engines' per-week outputs where present.
    const laborWeeks = new Map();
    for (const w of laborBoard?.weeks || []) {
      laborWeeks.set(w.week_start, Number(w.spent || 0));
    }
    // Purchasing weekly per bucket already; sum food+packaging+vehicle
    // for the aggregate COGS view.
    const purchWeekMap = new Map();
    for (const key of ["3200", "3400", "3500"]) {
      const bucket = purchBoard.buckets[key];
      if (!bucket?.week_series) continue;
      for (const w of bucket.week_series) {
        purchWeekMap.set(w.week_start, (purchWeekMap.get(w.week_start) || 0) + Number(w.amount || 0));
      }
    }
    const weekStarts = weekStartsInRange(rng.start, rng.end);
    const wkBudget = laborBoard?.applies && laborBoard.range_budget != null
      ? r2((laborBoard.range_budget + (purchBoard.totals.buckets_budget || 0)) / weekStarts.length)
      : null;
    const series = weekStarts.map(ws => {
      const laborS = laborWeeks.get(ws) || 0;
      const purchS = purchWeekMap.get(ws) || 0;
      const total = r2(laborS + purchS);
      const wEnd = new Date(new Date(ws + "T00:00:00Z").getTime() + 6 * 86400000).toISOString().slice(0, 10);
      const state = wEnd < today ? "closed" : (ws <= today && today <= wEnd) ? "in_progress" : "not_started";
      return {
        week_start: ws,
        week_end: wEnd,
        state,
        spent: state === "not_started" ? null : total,
        budget: wkBudget,
      };
    });
    chart = { grain: "week", series, weekly_budget: wkBudget };
  } else {
    // Period grain for FYTD or explicit range - build one point per
    // fiscal period in the range.
    const laborByPeriod = new Map();
    for (const w of laborBoard?.weeks || []) {
      const p = periodOf(w.week_start);
      if (p != null) laborByPeriod.set(p, (laborByPeriod.get(p) || 0) + Number(w.spent || 0));
    }
    const purchByPeriod = new Map();
    for (const key of ["3200", "3400", "3500"]) {
      const bucket = purchBoard.buckets[key];
      if (!bucket?.week_series) continue;
      for (const w of bucket.week_series) {
        const p = periodOf(w.week_start);
        if (p != null) purchByPeriod.set(p, (purchByPeriod.get(p) || 0) + Number(w.amount || 0));
      }
    }
    const series = periods.map(p => {
      const pStart = periodStartISO(p);
      const pEnd = periodEndISO(p);
      const state = pEnd < today ? "closed" : (pStart <= today && today <= pEnd) ? "in_progress" : "not_started";
      // Period budget = sum of member budget + purchasing bucket
      // budget for this one period.
      const laborBudP = laborBudgetSumMap.get(p) || 0;
      // Purchasing per-period budget: sum through kpi_budgets purchase
      // lines. Not directly available on purchBoard.totals per-period,
      // but we can compute from purchBudgets map for the three
      // buckets.
      let purchBudP = 0;
      const purchLineKeys = typeof purchBudgets?.keys === "function" ? [...purchBudgets.keys()] : Object.keys(purchBudgets || {});
      for (const gl of purchLineKeys) {
        const glStr = String(gl);
        if (!(glStr.startsWith("3200") || glStr.startsWith("3400") || glStr.startsWith("3500"))) continue;
        const perLine = typeof purchBudgets.get === "function" ? purchBudgets.get(gl) : purchBudgets[gl];
        if (!perLine) continue;
        for (const m of members) {
          if (PURCHASING_ENVELOPE_EXCLUSIONS.has(m)) continue;
          const byAcct = typeof perLine.get === "function" ? perLine.get(m) : perLine[m];
          if (!byAcct) continue;
          const v = typeof byAcct.get === "function" ? byAcct.get(p) : (byAcct[p] ?? byAcct[String(p)]);
          if (v != null) purchBudP += Number(v);
        }
      }
      return {
        period_no: p,
        state,
        spent: state === "not_started" ? null : r2((laborByPeriod.get(p) || 0) + (purchByPeriod.get(p) || 0)),
        budget: r2(laborBudP + purchBudP),
      };
    });
    chart = { grain: "period", series };
  }

  // 18. Statement rows (per-line P&L) and also-tracked rows.
  const statementRows = [];
  // Revenue section
  for (const line of REVENUE_LINE_CODES) {
    const rev = revenueByLine[line];
    const byPeriod = sumBudgetByPeriodForLine({ overviewBudgets, lineCode: line, members });
    const bto = computeBudgetToDateForLine({ budgetByPeriod: byPeriod, periodsInRange: periods, today });
    const fp = computeFullPeriodBudget({ budgetByPeriod: byPeriod, periodsInRange: periods });
    statementRows.push({
      line_code: line,
      section: "revenue",
      label: labelForLine(line),
      reported: rev.reported,
      actual: rev.reported ? rev.amount : null,
      budget_to_date: bto.amount,
      period_budget: fp,
      variance: (rev.reported && bto.amount != null) ? r2(rev.amount - bto.amount) : null,
      variance_pct: (rev.reported && bto.amount != null && bto.amount > 0) ? r2(((rev.amount - bto.amount) / bto.amount) * 100) : null,
      sources: rev.sources,
      flags: isFeeAccount && line === "2400.1" ? ["contractual"] : [],
    });
  }
  // COGS section
  statementRows.push({
    line_code: "3100",
    section: "cogs",
    label: "Kitchen labor",
    reported: laborBoard?.applies === true,
    actual: labor3100_actual,
    budget_to_date: labor3100_budget_to_date_days,
    period_budget: labor3100_budget,
    variance: (labor3100_actual != null && labor3100_budget_to_date_days != null) ? r2(labor3100_actual - labor3100_budget_to_date_days) : null,
    variance_pct: null,
    sources: ["labor_actuals"],
    flags: [],
  });
  statementRows.push({
    line_code: "3200",
    section: "cogs",
    label: "Food purchased",
    reported: true,
    actual: food_actual,
    budget_to_date: null, // per-bucket day budget not shipped in Phase 2; kept null explicitly
    period_budget: food_budget,
    variance: (food_actual != null && food_budget != null) ? r2(food_actual - food_budget) : null,
    variance_pct: null,
    sources: ["purchasing_actuals"],
    flags: isPassThrough ? ["pass_through"] : [],
  });
  statementRows.push({
    line_code: "3400",
    section: "cogs",
    label: "Packaging and supplies",
    reported: true,
    actual: packaging_actual,
    budget_to_date: null,
    period_budget: packaging_budget,
    variance: (packaging_actual != null && packaging_budget != null) ? r2(packaging_actual - packaging_budget) : null,
    variance_pct: null,
    sources: ["purchasing_actuals"],
    flags: flags.packaging_gap ? ["packaging_gap"] : (isPassThrough ? ["pass_through"] : []),
  });
  statementRows.push({
    line_code: "3500",
    section: "cogs",
    label: "Vehicle",
    reported: true,
    actual: vehicle_actual,
    budget_to_date: null,
    period_budget: vehicle_budget,
    variance: (vehicle_actual != null && vehicle_budget != null) ? r2(vehicle_actual - vehicle_budget) : null,
    variance_pct: null,
    sources: ["purchasing_actuals"],
    flags: [],
  });

  // Also-tracked rows
  const alsoTracked = [
    { line_code: "5002.1", label: "General repair and maintenance", actual: rm_actual, budget: rm_budget },
    { line_code: "5002.5", label: "Equipment",                     actual: equip_actual, budget: equip_budget },
    { line_code: "5017.3", label: "Perks",                         actual: perks_actual, budget: perks_budget },
  ].map(r => ({
    line_code: r.line_code,
    label: r.label,
    reported: r.actual != null && r.actual > 0,
    actual: r.actual,
    actual_display: formatMoneyWhole(r.actual),
    budget: r.budget,
    budget_display: formatMoneyWhole(r.budget),
    variance: (r.actual != null && r.budget != null) ? r2(r.actual - r.budget) : null,
    note: r.line_code === "5017.3" ? "Rippling card spend on perks" : null,
  }));

  // 19. Sources line. Data-through dates for each source.
  const sourcesLine = {
    labor: {
      through_date: today,  // placeholder - labor route has more precise; Overview echoes today
      label: `Labor through ${today}`,
    },
    purchases: {
      through_date: today,
      label: `Purchases through ${today}`,
    },
    sc_revenue: (effRevSource === "sc" && scLiveAny) ? {
      through_date: today,
      label: `Revenue from Service Calendar through ${today}`,
    } : null,
    period_state: displayPeriodState,
    period_state_display: (() => {
      switch (displayPeriodState) {
        case "open":            return "open · live estimate";
        case "closed_awaiting": return "closed · awaiting finance";
        case "verified": {
          const row = periodStatus.get(displayPeriodNo);
          const va = row?.verified_at;
          if (va) return `verified against P&L · ${String(va).slice(5, 10).replace("-", "/")}`;
          return "verified against P&L";
        }
        default: return null;
      }
    })(),
  };

  // 20. Freshness echo (freshness sub-object mirrors what the labor
  //     + purchasing routes return; kept minimal here so consumers
  //     have a single object to read; deeper freshness is out of scope
  //     for Phase 2).
  const freshness = {
    today,
    cards_through: today,
  };

  // 21. Payload assembly.
  const payload = {
    ok: true,
    filters: {
      account: accountKey,
      range: { start: rng.start, end: rng.end, kind: rng.kind, period_no: rng.period_no },
      rev_source: effRevSource,
      include_salary: !!includeSalary,
    },
    account: accountKey,
    range: {
      start: rng.start,
      end: rng.end,
      kind: rng.kind,
      period_no: rng.period_no,
      periods_in_range: periods,
    },
    posture: posture.posture,
    posture_details: posture,
    period_state: displayPeriodState,
    period_state_details: {
      period_no: displayPeriodNo,
      status_row: displayPeriodNo != null ? (periodStatus.get(displayPeriodNo) || null) : null,
    },
    ticker,
    cards,
    levers,
    chart,
    statement_rows: statementRows,
    also_tracked: alsoTracked,
    sources: sourcesLine,
    flags,
    freshness,
    // Preview-mode + landing propagation (mirrors labor route echoes).
    preview_account: null,
    landing_account: null,
    // Instrumentation.
    ...(debugTiming ? { _debug: { timings, total_ms: Math.round((performance.now() - t0) * 10) / 10 } } : {}),
  };

  return payload;
}

function labelForLine(code) {
  switch (code) {
    case "2200":  return "Catering revenue";
    case "2300":  return "Service charges";
    case "2400.1": return "Meal service (home)";
    case "2400.2": return "Meal service (away)";
    case "2600":  return "Consulting";
    case "3100":  return "Kitchen labor";
    case "3200":  return "Food purchased";
    case "3400":  return "Packaging and supplies";
    case "3500":  return "Vehicle";
    default:      return code;
  }
}
