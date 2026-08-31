// Shared labor loaders extracted 2026-08-31 for Overview Phase 2 to
// consume without route bloat. Same functions the labor route calls -
// this file is a pure move out of src/app/api/kpi/labor/route.js
// (Overview Phase 2 PR-1). Zero behaviour change: identical function
// signatures, identical internal logic, identical return shapes and
// error paths. The labor route imports and calls these functions
// afterward with no duplicate definitions.
//
// Exports:
//   V37_REVENUE_FLEX_ACCOUNTS - reserved for resolveMemberBudget's
//     basis-word decision; also read by the labor route's single-account
//     branch for the same purpose (route imports the same constant).
//   paginateActuals             - PostgREST offset-paginate over
//     labor_actuals_latest with deterministic ordering.
//   resolveMemberBudget         - kpi_budgets 3100.1 + sc_labor_budgets
//     merge per playbook 4.5.
//   buildPriorPeriodComparison  - V32-12..V32-15 comparison payload.

import {
  periodStartISO as fyPeriodStart,
  periodEndISO as fyPeriodEnd,
  inferRangeSelection as fyInferRange,
} from "@/app/kpi/labor/lib/periods.js";
import { computePeriodMeasures } from "@/app/kpi/labor/lib/board.js";

// V37 - revenue-flex accounts (TXR - TX - V) budget on a forecast
// envelope: hourly_budget = revenue_forecast x accounts.labor_ratio,
// stored per period in sc_labor_budgets. They participate in the
// board the same way every other account does (playbook 4.5); the
// only difference is the sub-line basis word - 'envelope' vs 'pnl' -
// so the client can label how the number was reached. There is no
// aggregate exclusion any more (V37-5).
export const V37_REVENUE_FLEX_ACCOUNTS = new Set(["TXR - TX - V"]);

const V6_PAGE_DEFAULT = 1000;   // PostgREST default response cap

// Paginate through a labor_actuals_latest filter, .range() loop,
// deterministic ordering, single flat array return.
//
// Step 2 column trim 2026-08-29 (PR #892 sibling). Six columns dropped
// from the wire select - no consumer for any of them across the read
// path (server body assembly, buildBoard, salaryBoard merge, client
// page.js weekAggregates, WeekTable, StoryBlock, HomestandBoard,
// weekTableModels, SignalCards). The dropped set:
//
//   line_code        - only used in salaryBoard.shapeSalaryRow as a
//                      constant '3100.2' marker on synthetic salary
//                      rows; nothing reads r.line_code back from
//                      labor_actuals_latest rows.
//   period_no        - client explicitly derives via periodOf(week_start)
//                      per page.js:392-395: "H1: derive period client
//                      -side. Payload period_no is null on backfill
//                      rows; we NEVER trust it."
//   week_source      - table-level 'sc_day_metadata' floor query stays
//                      (route.js:484); no per-row r.week_source read.
//   segment_count    - read from labor_actuals_daily in dailyRangeBody
//                      but NOT from labor_actuals_latest rows.
//   entry_count      - only referenced in the derive script's bucket
//                      builder; no reader on the response path.
//   source_run       - no consumer anywhere.
//
// Not dropped (reading confirmed a consumer):
//   fiscal_year      - page.js:394 fallback in weekAggregates
//                      (`fiscalYearOf(r.week_start) ?? r.fiscal_year ?? 2026`)
//   week_label       - page.js:391 stored on the weekAggregate object.
//
// .order() chain preserved on week_start, account_key, worker_id even
// though none of those three left the select. PostgREST accepts unselected
// columns in .order(); dropping the tiebreak on purchasing PR #892
// cost $595.45 of page-boundary drift on ties (rehold note in Step 2
// brief). This paginator uses .range()-offset (not keyset), so no
// cursor column is read from the returned rows.
//
// The export path (src/app/api/kpi/labor/export/route.js:151) keeps its
// own wider select for CSV output; that path is out-of-scope for Step 2.
// buildPriorPeriodComparison's aggregate branch calls this function, so
// the trim rides down the prior-period read for free on aggregate paths.
// Its single-account inline .select() at line 282 is already narrow
// (9 columns) and unchanged.
export async function paginateActuals(supa, { members, start, end, pageSize }) {
  const PS = pageSize && pageSize > 0 && pageSize <= V6_PAGE_DEFAULT ? pageSize : V6_PAGE_DEFAULT;
  const out = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, worker_id, week_label, week_start, week_end, fiscal_year, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, coverage_state, draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h, approved_hours, oldest_draft_date, still_costing_hours, derived_at")
      .in("account_key", members)
      .lte("week_start", end)
      .gte("week_end", start)
      .order("week_start", { ascending: true })
      .order("account_key", { ascending: true })
      .order("worker_id", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) return { error: q.error };
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < PS) break;
    from += PS;
  }
  return { data: out };
}

// Resolve the (member) account's budget_periods per playbook 4.5.
// V37 - revenue-flex accounts (TXR - TX - V) use the same 4.5
// resolution as every other account. Their sc_labor_budgets rows
// carry hourly_budget = revenue_forecast x accounts.labor_ratio; the
// only downstream difference is the `basis` word on each period,
// which the sub-line surfaces.
// Empty on truly no rows. Never selects 3100.2 or any group total (8.2).
export async function resolveMemberBudget(supa, accountKey) {
  const [pnlQ, scQ] = await Promise.all([
    supa
      .from("kpi_budgets")
      .select("period_no, amount")
      .eq("account_key", accountKey)
      .eq("line_code", "3100.1")
      .eq("fiscal_year", 2026),
    supa
      .from("sc_labor_budgets")
      .select("period, hourly_budget, reason")
      .eq("account_key", accountKey)
      .is("superseded_at", null),
  ]);
  if (pnlQ.error) return { error: pnlQ.error, scope: "kpi_budgets_3100_1" };
  if (scQ.error)  return { error: scQ.error,  scope: "sc_labor_budgets" };

  const isRevenueFlex = V37_REVENUE_FLEX_ACCOUNTS.has(accountKey);
  const pnlByPeriod = new Map(
    (pnlQ.data || []).map(r => [Number(r.period_no), Number(r.amount)])
  );
  // sc_labor_budgets.period is TEXT bare-numeric ('5' not 5) per
  // sc-20 + sc-21 convention.
  const scByPeriod = new Map(
    (scQ.data || []).map(r => [parseInt(String(r.period), 10), {
      amount: Number(r.hourly_budget),
      reason: r.reason || null,
    }])
  );

  const out = [];
  for (let p = 1; p <= 13; p += 1) {
    const sc = scByPeriod.get(p);
    const pnl = pnlByPeriod.get(p);
    if (sc != null && Number.isFinite(sc.amount)) {
      const pnlDiffers = pnl != null && Math.abs(pnl - sc.amount) > 0.01;
      out.push({
        period_no: p,
        amount: Math.round(sc.amount * 100) / 100,
        source: "supersede",
        basis: isRevenueFlex ? "envelope" : "pnl",
        superseded: pnlDiffers,
        ...(sc.reason ? { reason: sc.reason } : {}),
        ...(pnlDiffers ? { pnl_amount: Math.round(pnl * 100) / 100 } : {}),
      });
    } else if (pnl != null && Number.isFinite(pnl)) {
      out.push({
        period_no: p,
        amount: Math.round(pnl * 100) / 100,
        source: "pnl",
        basis: "pnl",
        superseded: false,
      });
    }
    // else: no row - omit.
  }
  return { data: out };
}

// V32-12..V32-15 - prior-period comparison payload for the context
// strip. Renders only when the range is a SINGLE fiscal period
// (rangeSelection.kind === "period") with a prior period in FY2026.
// Returns { applies: false, reason } otherwise; the client renders
// nothing (no partial fallback per V32-15).
export async function buildPriorPeriodComparison({ supa, rangeStart, rangeEnd, today, isAggregate, members, account, currentActuals, pageSize }) {
  const selection = fyInferRange(rangeStart, rangeEnd);
  if (!selection || selection.kind !== "period") {
    return { applies: false, reason: "range_not_single_period" };
  }
  const currentPeriodNo = selection.value;
  if (currentPeriodNo <= 1) return { applies: false, reason: "no_prior_period" };

  const priorPeriodNo = currentPeriodNo - 1;
  const priorStart = fyPeriodStart(priorPeriodNo);
  const priorEnd = fyPeriodEnd(priorPeriodNo);
  if (!priorStart || !priorEnd) return { applies: false, reason: "no_prior_range" };

  // Current elapsed weeks - closed periods use 4, in-progress uses the
  // fractional elapsed. computePeriodMeasures floors 0 so a not-yet-
  // started period returns null (client hides the strip).
  const currentPeriodEnd = fyPeriodEnd(currentPeriodNo);
  const isClosed = currentPeriodEnd < today;
  let currentElapsedWeeks;
  if (isClosed) {
    currentElapsedWeeks = 4;
  } else {
    const currentStart = fyPeriodStart(currentPeriodNo);
    const todayDate = new Date(today).getTime();
    const startDate = new Date(currentStart).getTime();
    const daysIn = Math.max(0, Math.floor((todayDate - startDate) / 86400000) + 1);
    currentElapsedWeeks = Math.max(0.01, Math.min(4, daysIn / 7));
  }

  // Prior actuals - V37-5 aggregates include every member (revenue-
  // flex accounts no longer excluded); population is now defined by
  // the members list alone.
  let priorActuals;
  if (isAggregate) {
    const rolled = members || [];
    if (rolled.length === 0) return { applies: false, reason: "no_rollup_members" };
    const q = await paginateActuals(supa, { members: rolled, start: priorStart, end: priorEnd, pageSize });
    // 2026-08-28 swallowing-catch fix: prior code returned
    // `{ applies: false, reason: "query_error" }`; the client
    // (ComparisonStrip.js:89) then rendered null on !pp.applies, so
    // a DB error silently vanished the VS PERIOD widget from the
    // board with no operator signal. The `reason` string was written
    // and never read. Return an error field the caller surfaces
    // via safeError.
    if (q.error) return { error: q.error, scope: "labor_actuals_prior_aggregate" };
    priorActuals = q.data;
  } else {
    const q = await supa.from("labor_actuals_latest")
      .select("account_key, worker_id, week_start, week_end, hours_regular, hours_overtime, hours_double_time, hours_premium_other, amount")
      .eq("account_key", account)
      .lte("week_start", priorEnd).gte("week_end", priorStart);
    if (q.error) return { error: q.error, scope: "labor_actuals_prior_single" };
    priorActuals = q.data;
  }

  const prior = computePeriodMeasures(priorActuals, 4);
  const now = computePeriodMeasures(currentActuals, currentElapsedWeeks);
  if (!prior || !now) return { applies: false, reason: "insufficient_data" };

  return {
    applies: true,
    current_period_no: currentPeriodNo,
    prior_period_no: priorPeriodNo,
    now,
    prior,
  };
}
