// src/app/kpi/labor/lib/board.js
//
// Server-computed board payload. All money numbers on the board come
// from here; the client never recomputes dollars (V8-5).
//
// Board applies to hourly accounts that have a resolvable budget for
// the selected range. Salaried-only + envelope accounts get null so
// the client renders the omission state, not zeros (V8-19).
//
// Range interpretations:
//   single_period_in_progress - full board including V8-2 projection,
//                               V21-11 weekly_allowance, V8-4 unapproved per week.
//   single_period_closed      - variance + weeks (all closed strict-sign);
//                               projection + allowance omitted.
//   multi_period              - variance across periods; per-week strip
//                               uses closed-week rules only; projection +
//                               allowance omitted.
//   no_budget                 - null; the client renders the omission
//                               state.

import {
  periodStartISO,
  periodEndISO,
  weekStartsInRange,
  inferRangeSelection,
  periodOf,
} from "./periods.js";
import { countDistinctPeople } from "../../../../lib/labor/personCount.js";

const MS_PER_DAY = 86400000;
const WEEKS_PER_PERIOD = 4;

// V32-12..V32-15 - scale-free measures for the prior-period comparison
// strip. Six ratios / per-week rates so mid-period totals stay
// comparable to closed-period totals (P9 at 1.29 weeks vs P8 at 4).
// Returns null when the input row-set is empty (no comparable period).
export function computePeriodMeasures(actuals, elapsedWeeks) {
  if (!actuals || actuals.length === 0 || !elapsedWeeks || elapsedWeeks <= 0) return null;
  let spend = 0, hours = 0, ot = 0;
  const workerIds = new Set();
  for (const r of actuals) {
    spend += Number(r.amount || 0);
    hours += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
    ot += Number(r.hours_overtime || 0);
    if (r.worker_id) workerIds.add(r.worker_id);
  }
  const workers = workerIds.size;
  if (hours <= 0 || workers <= 0) return null;
  return {
    blended_rate:    Math.round((spend / hours) * 100) / 100,
    overtime_pct:    Math.round((ot / hours) * 10000) / 100,
    crew_size:       workers,
    spend_per_week:  Math.round((spend / elapsedWeeks) * 100) / 100,
    hours_per_week:  Math.round((hours / elapsedWeeks) * 100) / 100,
    cost_per_worker: Math.round((spend / elapsedWeeks / workers) * 100) / 100,
  };
}

// V9-4 - per-week budget resolution for the table's `vs budget` cell.
// Each fiscal week in the enumerated range gets the resolved period
// budget / weeks-in-period; weeks whose period has no budget yield a
// null amount (the table renders a muted dash, never 0).
//
// Single-account: pass this account's budget_periods.
// Aggregate: pass the summed budget_periods (server already sums
// member budgets per period) - the resulting per-week amount is the
// aggregate weekly budget.
export function buildWeekBudgets({ start, end, budget_periods }) {
  const weekStarts = weekStartsInRange(start, end);
  const byPeriod = new Map((budget_periods || []).map(b => [b.period_no, Number(b.amount)]));
  return weekStarts.map(week_start => {
    const p = periodOf(week_start);
    const periodAmount = p != null ? byPeriod.get(p) : null;
    const amount = periodAmount != null ? Math.round((periodAmount / WEEKS_PER_PERIOD) * 100) / 100 : null;
    return { week_start, period_no: p, amount };
  });
}

// V9-4 aggregate variant - per-week amount is the SUM of member
// per-week budgets. Members with no budget for a period contribute 0
// (not the whole aggregate week amount). Envelope + salaried members
// contribute nothing. `member_budgets` is a Map<accountKey,
// budget_periods[]> already resolved per playbook 4.5.
export function buildAggregateWeekBudgets({ start, end, member_budgets }) {
  const weekStarts = weekStartsInRange(start, end);
  const memberByPeriod = new Map();
  for (const [m, list] of member_budgets) {
    const byPeriod = new Map((list || []).map(b => [b.period_no, Number(b.amount)]));
    memberByPeriod.set(m, byPeriod);
  }
  return weekStarts.map(week_start => {
    const p = periodOf(week_start);
    const per_member = {};
    let total = 0;
    let anyHasBudget = false;
    for (const [m, byPeriod] of memberByPeriod) {
      const periodAmount = p != null ? byPeriod.get(p) : null;
      if (periodAmount != null) {
        const w = Math.round((periodAmount / WEEKS_PER_PERIOD) * 100) / 100;
        per_member[m] = w;
        total += w;
        anyHasBudget = true;
      }
    }
    return {
      week_start,
      period_no: p,
      amount: anyHasBudget ? Math.round(total * 100) / 100 : null,
      per_member,
    };
  });
}

// Overview Phase 2 PR-3 · §11 B-11 rollout: budget-to-date by DAYS
// through YESTERDAY. Exported so both drill boards (labor here + the
// purchasing resolver) and the Overview resolver read the same
// implementation - one place, one number.
//
// Contract:
//   - Closed periods in range: full period budget contributes.
//   - The current period (contains today) in range: period budget
//     x (days_elapsed_through_yesterday / days_in_period).
//   - Future periods in range: nothing.
//   - Days count period-start through yesterday INCLUSIVE. On the
//     first day of a period this returns 0 (nothing elapsed yet
//     through yesterday). On the last day of a period this returns
//     full period budget - period end is yesterday.
//
// The rule is period-scoped, not fiscal-week-scoped: the Overview
// prototype's PRO factor is `(P9_ELAPSED_DAYS / 28)`. Weeks are the
// rendering grain; days-through-yesterday is the money grain for
// budget_to_date.
//
// budget_periods carries per-period amounts already summed across
// members (aggregate case) or the single member's own budget (single-
// account case). One implementation covers both.
//
// Signature:
//   computeBudgetToDateDays({ budget_periods, start, end, today })
//   -> { amount: number | null, days_elapsed_current: number | null,
//        days_in_current: number | null, current_period_no: number | null,
//        closed_period_nos: number[] }
//
// amount is null when there is no budget in the range OR when the
// range enumerates zero fiscal weeks (empty range). Callers surface
// the null; NEVER 0 (0 is a valid amount when nothing has elapsed +
// no closed periods have budget).
export function computeBudgetToDateDays({ budget_periods, start, end, today }) {
  const weeks = weekStartsInRange(start, end);
  if (weeks.length === 0) {
    return { amount: null, days_elapsed_current: null, days_in_current: null, current_period_no: null, closed_period_nos: [] };
  }
  const periodsTouched = [...new Set(weeks.map(w => periodOf(w)).filter(p => p != null))].sort((a, b) => a - b);
  const budgetByPeriod = new Map((budget_periods || []).map(b => [Number(b.period_no), Number(b.amount)]));
  if (budgetByPeriod.size === 0) {
    return { amount: null, days_elapsed_current: null, days_in_current: null, current_period_no: null, closed_period_nos: [] };
  }
  const todayD = parseISO(today);
  if (!todayD) {
    return { amount: null, days_elapsed_current: null, days_in_current: null, current_period_no: null, closed_period_nos: [] };
  }
  let total = 0;
  let anyContribution = false;
  const closed = [];
  let currentPeriodNo = null;
  let daysElapsedCurrent = null;
  let daysInCurrent = null;
  for (const p of periodsTouched) {
    const pStart = parseISO(periodStartISO(p));
    const pEnd = parseISO(periodEndISO(p));
    if (!pStart || !pEnd) continue;
    const amt = budgetByPeriod.get(p);
    // Closed: period_end < today (strictly earlier than today's date).
    // Open (current): period_start <= today <= period_end.
    // Future: period_start > today.
    if (pEnd < todayD) {
      // Closed period. Full period budget contributes if present.
      closed.push(p);
      if (amt != null) {
        total += amt;
        anyContribution = true;
      }
    } else if (pStart <= todayD && todayD <= pEnd) {
      // Current period. days_elapsed_through_yesterday inclusive.
      // On day 1 of the period, yesterday is BEFORE pStart -> 0 days.
      // On day D of the period, yesterday is D-1 days after pStart.
      currentPeriodNo = p;
      const daysInclusive = Math.floor((pEnd.getTime() - pStart.getTime()) / MS_PER_DAY) + 1;
      daysInCurrent = daysInclusive;
      const daysThroughYesterday = Math.max(0, Math.floor((todayD.getTime() - pStart.getTime()) / MS_PER_DAY));
      daysElapsedCurrent = Math.min(daysThroughYesterday, daysInclusive);
      if (amt != null) {
        const prorated = amt * (daysElapsedCurrent / daysInclusive);
        total += prorated;
        anyContribution = true;
      }
    }
    // Future periods: no contribution.
  }
  if (!anyContribution) {
    return {
      amount: null,
      days_elapsed_current: daysElapsedCurrent,
      days_in_current: daysInCurrent,
      current_period_no: currentPeriodNo,
      closed_period_nos: closed,
    };
  }
  return {
    amount: r2(total),
    days_elapsed_current: daysElapsedCurrent,
    days_in_current: daysInCurrent,
    current_period_no: currentPeriodNo,
    closed_period_nos: closed,
  };
}

// Verdict bands (V8-7 canonical). One source of truth for every
// colored element on the page.
export function verdictBand(pacePctPoints) {
  // pacePctPoints = (spend% - elapsed%). Negative = ahead of pace / under.
  if (pacePctPoints == null || Number.isNaN(pacePctPoints)) return null;
  if (pacePctPoints > 5)  return "over";
  if (pacePctPoints > 2)  return "watch";
  return "on_track";
}

function r2(v) { return Math.round(Number(v || 0) * 100) / 100; }

function parseISO(iso) {
  const m = String(iso || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

// Sum rows for a slice of the actuals array.
// 2026-08-28 person-key fix: takes workerToEmail so worker_count +
// approval_people dedupe by person (email) not spell (worker_id).
// Empty map preserves legacy worker_id-based count.
function sumRows(rows, workerToEmail = new Map()) {
  let amount = 0, hours = 0, ot = 0, unpriced_hrs = 0;
  let complete = 0, total = 0;
  // R-38 (2026-09-01): the OT card was rebuilt from fiscal-year-avg
  // to this-week-vs-last-week in hours. Per-week aggregates now carry
  // ot_cost (1.5x dollars) and ot_workers (rows collected for
  // person-key dedupe via workerToEmail). Range folds also carry
  // them so the FY supporting line has the same numbers it had
  // before the rebuild.
  let ot_cost = 0;
  const otRows = [];
  // V42 REVISED (C1 state model). Sum status-based approval signals
  // separately from the coverage-based unpriced_hrs. draft_hours can
  // include priced drafts and is NOT the money signal; the client
  // uses it for the current-week informational render only.
  let draft_entries = 0, draft_hours = 0;
  let anomaly_no_clockout = 0, anomaly_under_1h = 0, anomaly_over_16h = 0;
  // v43-1 approvals - completes the two-dimensional model V42 opened.
  // approved_hours + draft_hours == total in-scope time entry hours
  // (probe: _probe_approvals_four_state.mjs asserts this and the
  // still_costing <= approved_hours subset invariant). oldest_draft
  // is MIN across rows (a bucket-level MIN of DRAFT start_times),
  // NOT a sum. approval_workers is distinct workers with any draft
  // in range - the "N people" figure the card's sub-line uses.
  let approved_hours = 0, still_costing_hours = 0;
  let oldest_draft_date = null;   // ISO date string or null
  // 2026-08-28 person-key fix - collect the ROWS driving each
  // person-count instead of collecting worker_ids directly. Then
  // countDistinctPeople dedupes by email (person key) via workerToEmail.
  // Falls back to worker_id-based count when workerToEmail is empty,
  // preserving legacy behavior for callers that do not pass a map.
  const approvalRows = [];
  for (const r of rows) {
    total += 1;
    amount += Number(r.amount || 0);
    hours += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
    ot += Number(r.hours_overtime || 0);
    unpriced_hrs += Number(r.hours_without_dollars || 0);
    draft_entries       += Number(r.draft_entry_count   || 0);
    draft_hours         += Number(r.draft_hours         || 0);
    anomaly_no_clockout += Number(r.anomaly_no_clockout || 0);
    anomaly_under_1h    += Number(r.anomaly_under_1h    || 0);
    anomaly_over_16h    += Number(r.anomaly_over_16h    || 0);
    approved_hours      += Number(r.approved_hours      || 0);
    still_costing_hours += Number(r.still_costing_hours || 0);
    // MIN-fold oldest_draft_date across rows. NULL on a row means
    // "no drafts in this row" - skip; do NOT treat NULL as "0" or
    // "all clear" (that would be the exact defect owner flagged for
    // the client absent-on-premise-fail rule, one layer up).
    if (r.oldest_draft_date && (oldest_draft_date === null || r.oldest_draft_date < oldest_draft_date)) {
      oldest_draft_date = r.oldest_draft_date;
    }
    if (Number(r.draft_hours || 0) > 0.004 && r.worker_id) approvalRows.push(r);
    if (r.coverage_state === "complete") complete += 1;
    ot_cost += Number(r.dollars_overtime || 0);
    if (Number(r.hours_overtime || 0) > 0.004 && r.worker_id) otRows.push(r);
  }
  return {
    amount: r2(amount), hours: r2(hours), ot: r2(ot), unpriced_hrs: r2(unpriced_hrs),
    complete, total, worker_count: countDistinctPeople(rows, workerToEmail),
    draft_entry_count: draft_entries,
    draft_hours: r2(draft_hours),
    anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h,
    approved_hours: r2(approved_hours),
    still_costing_hours: r2(still_costing_hours),
    oldest_draft_date,   // pass-through - MIN across rows, null when no drafts
    approval_people: countDistinctPeople(approvalRows, workerToEmail),
    // R-38 additions: 1.5x OT cost sum + distinct OT-earning people
    // (person-key dedupe via workerToEmail, matches approval_people).
    ot_cost: r2(ot_cost),
    ot_people: countDistinctPeople(otRows, workerToEmail),
  };
}

// Build the per-week aggregates for [start, end]. Returns array in
// week_start ASC order; missing weeks (no actuals) appear as zero-rows.
function buildWeekAggregates(actuals, weekStarts, workerToEmail = new Map()) {
  const byWeek = new Map();
  for (const w of weekStarts) byWeek.set(w, { rows: [] });
  for (const r of actuals) {
    if (!byWeek.has(r.week_start)) continue;
    byWeek.get(r.week_start).rows.push(r);
  }
  const out = [];
  for (const wStart of weekStarts) {
    const rows = byWeek.get(wStart).rows;
    const s = sumRows(rows, workerToEmail);
    const week_end = new Date(parseISO(wStart).getTime() + 6 * MS_PER_DAY).toISOString().slice(0, 10);
    out.push({
      week_start: wStart, week_end,
      amount: s.amount, hours: s.hours, ot_hours: s.ot,
      // R-38 per-week additions (2026-09-01). Additive; existing
      // consumers (chart, StoryBlock) untouched.
      ot_cost: s.ot_cost,
      ot_people: s.ot_people,
      unpriced_hrs: s.unpriced_hrs,
      complete_ww: s.complete, total_ww: s.total, worker_count: s.worker_count,
      coverage_states: [...new Set(rows.map(r => r.coverage_state))],
      // V42 REVISED - status-based approval signals + anomaly counts
      // per week. The client's four-state model (StoryBlock TierAWeekBar
      // + WeekTable) reads these; the OLD unapproved_flag/unapproved_hours
      // fields below stay for backward-compatible surfaces but are no
      // longer the source of truth for the flag or the cap.
      draft_entry_count:   s.draft_entry_count,
      draft_hours:         s.draft_hours,
      anomaly_no_clockout: s.anomaly_no_clockout,
      anomaly_under_1h:    s.anomaly_under_1h,
      anomaly_over_16h:    s.anomaly_over_16h,
      anomaly_total:       s.anomaly_no_clockout + s.anomaly_under_1h + s.anomaly_over_16h,
      // v43-1 approvals - propagate through so rangeTotals can fold
      // and the pinned block sees them at range level. oldest_draft_date
      // and approval_people are aggregates, not row-level per-week
      // splits (a week can carry drafts from multiple people; both
      // fields describe the week as a unit).
      approved_hours:      s.approved_hours,
      still_costing_hours: s.still_costing_hours,
      oldest_draft_date:   s.oldest_draft_date,
      approval_people:     s.approval_people,
    });
  }
  return out;
}

// Classify a fiscal week against today.
//   closed       -> week_end < today
//   in_progress  -> week_start <= today <= week_end
//   not_started  -> week_start > today
function weekState(week_start, week_end, today) {
  if (week_end < today) return "closed";
  if (week_start > today) return "not_started";
  return "in_progress";
}

// Elapsed weeks as a float: closed weeks count as 1 each; the in-progress
// week contributes (days from week_start to today, inclusive) / 7.
function computeElapsedWeeks(weeks, today) {
  let elapsed = 0;
  for (const w of weeks) {
    const state = weekState(w.week_start, w.week_end, today);
    if (state === "closed") elapsed += 1;
    else if (state === "in_progress") {
      const t = parseISO(today), ws = parseISO(w.week_start);
      if (t && ws) {
        const daysInclusive = Math.floor((t.getTime() - ws.getTime()) / MS_PER_DAY) + 1;
        elapsed += Math.max(0, Math.min(7, daysInclusive)) / 7;
      }
    }
  }
  return r2(elapsed);
}

// Public: build the board object for one account+range.
//
// budgetForRange returns { amount, source } summing budget_periods
// entries within the selected period span. Returns null if nothing
// budgeted for the range.
export function buildBoard({
  account,              // team_key or pseudo-key ("ALL"/"EAST"/"WEST")
  start,                // range start ISO
  end,                  // range end ISO
  today,                // ISO YYYY-MM-DD
  actuals,              // all worker-week rows in [start, end]
  budget_periods,       // [{ period_no, amount, ... }]  (may be empty)
  account_state,        // "hourly_ok" | "salaried_only" | "envelope"
  ot_thresholds = { watch_pct: 0, alarm_pct: 8 },
  // 2026-08-28 person-key fix - workerToEmail Map (worker_id -> email)
  // built from resolveWorkerMeta. When present, distinct-people counts
  // (worker_count, approval_people, distinct_workers) dedupe by email
  // instead of by worker_id. Absent/empty preserves the legacy
  // worker_id-based count (unmapped ids count as themselves). See
  // src/lib/labor/personCount.js.
  workerToEmail = new Map(),
}) {
  if (account_state === "salaried_only" || account_state === "envelope") {
    return {
      applies: false,
      kind: "not_applicable",
      reason: account_state,
      account,
    };
  }
  const selection = inferRangeSelection(start, end);
  const isSinglePeriod = selection && selection.kind === "period";
  // Multi-period detection - the range spans multiple fiscal periods.
  const weeksInRange = weekStartsInRange(start, end);
  if (weeksInRange.length === 0) {
    return { applies: false, kind: "empty_range", account };
  }
  const periodsTouched = [...new Set(weeksInRange.map(w => periodOf(w)).filter(p => p != null))].sort((a, b) => a - b);

  // Determine budget for the range. Sum of member period budgets that
  // fall inside the range's period span. If none, no verdict possible.
  const budgetByPeriod = new Map((budget_periods || []).map(b => [b.period_no, Number(b.amount)]));
  // V37-4 - per-period basis flag ('envelope' | 'pnl') so the client
  // can label the sub-line. For a single-period range this is the
  // basis of that one period; for a multi-period range it is left
  // null unless every touched period agrees.
  const basisByPeriod = new Map((budget_periods || []).map(b => [b.period_no, b.basis || null]));
  let rangeBudget = 0;
  let periodsWithBudget = 0;
  for (const p of periodsTouched) {
    if (budgetByPeriod.has(p)) {
      rangeBudget += budgetByPeriod.get(p);
      periodsWithBudget += 1;
    }
  }
  const hasBudget = periodsWithBudget > 0;
  rangeBudget = hasBudget ? r2(rangeBudget) : null;

  // Weekly aggregates across the whole range.
  const weekAggs = buildWeekAggregates(actuals, weeksInRange, workerToEmail);
  // Range totals from weekly aggregates (avoids double-counting).
  // HS FB1 hotfix 2026-08-25: draft_hours added alongside unpriced.
  // Two distinct approval questions per Kevin's V42-clarified ruling:
  //   "how much will this number grow?"  -> unpriced (bar cap)
  //   "is everything approved?"          -> draft_hours (status pill,
  //                                                      Payroll card)
  // TBR - FL week 08/17 fixture: draft_hours 122.98 across 10 draft
  // entries, all PRICED so unpriced_hrs = 0. Pre-fix, the Payroll Data
  // card read "FINAL · Unapproved: none" - a priced draft is still
  // unapproved, and this range total surface owed the client the truth.
  const rangeTotals = weekAggs.reduce((acc, w) => {
    acc.amount += w.amount;
    acc.hours += w.hours;
    acc.ot += w.ot_hours;
    acc.unpriced += w.unpriced_hrs;
    acc.draft_hours += Number(w.draft_hours || 0);
    acc.complete += w.complete_ww;
    acc.total += w.total_ww;
    for (const id of w.worker_count ? [] : []) {} // placeholder
    return acc;
  }, { amount: 0, hours: 0, ot: 0, unpriced: 0, draft_hours: 0, complete: 0, total: 0 });
  // v43-1 approvals - range-level fold uses sumRows(actuals) directly
  // rather than reducing from weekAggs. Reasons: (1) approval_people
  // is a DISTINCT-worker count and per-week values do not sum (a
  // worker with drafts in two weeks counts once at range level, twice
  // by naive sum); (2) oldest_draft_date is MIN across all rows, not
  // a summation. sumRows already carries the correct semantics for
  // both. approved_hours + still_costing_hours DO sum row-wise, so
  // sumRows on the full actuals gives the same answer as a per-week
  // reduce - one call kept for consistency of the source.
  const rangeApprovals = sumRows(actuals, workerToEmail);
  // Distinct PEOPLE across the range (V8-9: people, not worker-weeks).
  // 2026-08-28 person-key fix: dedupes by email through workerToEmail so
  // a seasonal rehire (multiple worker_ids, one person) counts as one.
  const distinctWorkers = countDistinctPeople(actuals, workerToEmail);

  // Determine kind.
  let kind;
  if (isSinglePeriod) {
    const period_no = selection.value;
    const pEnd = periodEndISO(period_no);
    kind = pEnd < today ? "single_period_closed" : "single_period_in_progress";
  } else {
    kind = "multi_period";
  }

  if (!hasBudget) {
    return {
      applies: true, kind: "no_budget", account,
      period_span: { first: periodsTouched[0], last: periodsTouched[periodsTouched.length - 1] },
      spent_to_date: r2(rangeTotals.amount),
      distinct_workers: distinctWorkers,
      hours: r2(rangeTotals.hours),
      weeks: weekAggs.map(w => ({
        ...w,
        state: weekState(w.week_start, w.week_end, today),
      })),
    };
  }

  // Common fields.
  const spent_to_date = r2(rangeTotals.amount);
  const budget = rangeBudget;

  // Per-week enrichment (state + strict-sign delta + unapproved flag).
  const weekly_original_target = kind.startsWith("single_period") && hasBudget
    ? r2(budget / WEEKS_PER_PERIOD)
    : null;

  const weeksOut = weekAggs.map(w => {
    const state = weekState(w.week_start, w.week_end, today);
    // HS FB1 hotfix 2026-08-25: approval keys off draft_hours, NOT
    // unpriced_hrs. Reproducer: TBR - FL week 08/17 with 122.98 draft
    // hours across 10 draft entries, all PRICED so unpriced_hrs = 0 -
    // pre-fix, this flag stayed FALSE and the Payroll Data card read
    // "FINAL · Unapproved: none" against a truly-unapproved week.
    //
    // V42's "always key off hours_without_dollars, never draft_hours"
    // ruling was for the BAR CAP question ("how much will this number
    // grow?") - a priced draft won't grow the figure, so unpriced is
    // right there. Wrong for approval status - a priced draft is
    // still unapproved. Two questions, two signals.
    //
    // Also DROPPED the state !== "closed" gate. Approval status does
    // not expire when a week closes; a closed week with drafts is
    // still unapproved and the card owes the operator that signal.
    let unapproved_flag = false;
    let unapproved_hours = 0;
    if (w.draft_hours > 0) {
      unapproved_flag = true;
      unapproved_hours = r2(w.draft_hours);
    }
    // Per-week original target: for multi-period, use each week's own
    // period budget / 4; for single-period, weekly_original_target.
    const wPeriod = periodOf(w.week_start);
    const wBudget = budgetByPeriod.get(wPeriod);
    const original_target = wBudget != null ? r2(wBudget / WEEKS_PER_PERIOD) : null;
    let delta_vs_original = null, delta_sign = null;
    if (state === "closed" && original_target != null) {
      delta_vs_original = r2(w.amount - original_target);
      delta_sign = delta_vs_original < 0 ? "under" : delta_vs_original > 0 ? "over" : "flat";
    }
    return {
      week_start: w.week_start,
      week_end: w.week_end,
      period_no: wPeriod,
      state,
      spent: w.amount,
      hours: w.hours,
      ot_hours: w.ot_hours,
      // R-38 (2026-09-01) per-week OT cost + distinct OT people
      // (person-key deduped). Additive; existing week consumers keep
      // reading spent/hours/ot_hours as before.
      ot_cost: w.ot_cost,
      ot_people: w.ot_people,
      unpriced_hrs: w.unpriced_hrs,
      complete_ww: w.complete_ww,
      total_ww: w.total_ww,
      worker_count: w.worker_count,
      unapproved_flag,
      unapproved_hours,
      // V42 REVISED - status-based approval signals + anomaly counts
      // per week. Drives the four-state model in StoryBlock TierAWeekBar
      // and WeekTable's flagForV42State. See src/lib/labor/estimateUnpricedDollars.js
      // for the hatched-cap dollars estimator (uses unpriced_hrs, NOT
      // draft_hours - priced drafts are already in the solid bar).
      draft_entry_count:   w.draft_entry_count,
      draft_hours:         w.draft_hours,
      anomaly_no_clockout: w.anomaly_no_clockout,
      anomaly_under_1h:    w.anomaly_under_1h,
      anomaly_over_16h:    w.anomaly_over_16h,
      anomaly_total:       w.anomaly_total,
      original_target,
      delta_vs_original,
      delta_sign,
    };
  });

  // Single-period fields.
  let projected_period_end = null;
  let weekly_allowance = null;
  let budget_exhausted = false;
  let closed_weeks_count = 0;
  let in_progress_week_start = null;
  let not_started_weeks_count = 0;
  let elapsed_weeks = null;
  let spent_closed = null;
  let spent_in_progress = null;

  // PR-A - week-state counters (closed_weeks_count, in_progress_week_start,
  // not_started_weeks_count) fire for BOTH single_period_in_progress AND
  // multi_period. Owner ruling 2026-08-24: SignalCards on multi_period
  // needs these to compute "Of budget used", "Left unspent", per-week /
  // per-worker hours facts, and the "N of M weeks closed" sub-line.
  // The prior single_period_in_progress-only guard was the root cause of
  // five separate "shows a dash" complaints on FYTD + Last-4-Weeks.
  if (kind === "single_period_in_progress" || kind === "multi_period") {
    for (const w of weeksOut) {
      if (w.state === "closed") closed_weeks_count += 1;
      if (w.state === "in_progress") in_progress_week_start = w.week_start;
      if (w.state === "not_started") not_started_weeks_count += 1;
    }
  }
  if (kind === "single_period_in_progress") {
    elapsed_weeks = computeElapsedWeeks(weeksOut, today);
    for (const w of weeksOut) {
      if (w.state === "closed") spent_closed = (spent_closed || 0) + w.spent;
      if (w.state === "in_progress") spent_in_progress = w.spent;
    }
    spent_closed = spent_closed != null ? r2(spent_closed) : 0;
    spent_in_progress = spent_in_progress != null ? r2(spent_in_progress) : 0;

    if (elapsed_weeks > 0) {
      projected_period_end = r2((spent_to_date / elapsed_weeks) * WEEKS_PER_PERIOD);
    }
    // V21-11: denominator is weeks-NOT-FINISHED = 1 (if in-progress) +
    // count(not_started). The prior denominator (not_started only) treats
    // the running week as if it will cost nothing, overstating allowance.
    // Identity that MUST hold when !budget_exhausted:
    //   spent_to_date + denominator * weekly_allowance == period_budget
    const denominator = (in_progress_week_start ? 1 : 0) + not_started_weeks_count;
    if (denominator > 0) {
      const remaining = budget - spent_to_date;
      if (remaining < 0) {
        weekly_allowance = 0;
        budget_exhausted = true;
      } else {
        weekly_allowance = r2(remaining / denominator);
      }
    }
    // Fill per-not-started-week weekly_allowance on weeksOut. V21-10:
    // in-progress week's status line also reads the allowance; we set
    // it on that week too so consumers do not divide again.
    for (const w of weeksOut) {
      if (weekly_allowance != null && (w.state === "not_started" || w.state === "in_progress")) {
        w.weekly_allowance = weekly_allowance;
      }
    }
  }

  // Variance + verdict.
  // In-progress: compare pace (spend%) with elapsed% -> band.
  //              Variance = spent - budget * elapsed_frac (signed).
  // Closed:      Variance = spent - budget. Verdict from same band
  //              with elapsed% = 100.
  // Multi:       Variance = spent - budget. Verdict from same band
  //              with elapsed% = spent%/100 clamped 100.
  let elapsed_pct = null, pace_pct = null, pace_points = null, variance = null, verdict = null;
  const spend_pct = budget > 0 ? (spent_to_date / budget) * 100 : null;
  if (kind === "single_period_in_progress") {
    elapsed_pct = r2((elapsed_weeks / WEEKS_PER_PERIOD) * 100);
    pace_pct = spend_pct != null ? r2(spend_pct) : null;
    pace_points = (pace_pct != null && elapsed_pct != null) ? r2(pace_pct - elapsed_pct) : null;
    variance = r2(spent_to_date - budget * (elapsed_weeks / WEEKS_PER_PERIOD));
  } else if (kind === "single_period_closed" || kind === "multi_period") {
    elapsed_pct = 100;
    pace_pct = spend_pct != null ? r2(spend_pct) : null;
    pace_points = (pace_pct != null) ? r2(pace_pct - 100) : null;
    variance = r2(spent_to_date - budget);
  }
  verdict = verdictBand(pace_points);

  // Signals. V32-5 threshold rule: 0% = on target (state === "clear"),
  // above 0% up to watch bound = "watch" (amber), above alarm bound =
  // "alarm" (red). Strict > comparisons so 0.00% renders as green.
  const ot_pct = rangeTotals.hours > 0 ? r2((rangeTotals.ot / rangeTotals.hours) * 100) : 0;
  const ot_state = ot_pct > ot_thresholds.alarm_pct ? "alarm"
                : ot_pct > ot_thresholds.watch_pct ? "watch"
                : "clear";
  // V32-6 - OT facts: 1.5x $ cost, workers with any OT, and the week
  // with the highest OT hours. Iterate actuals rows once for cost + a
  // per-worker set; iterate week aggregates for the longest week.
  let ot_cost = 0;
  const otWorkerIds = new Set();
  for (const r of actuals) {
    ot_cost += Number(r.dollars_overtime || 0);
    if (Number(r.hours_overtime || 0) > 0.004 && r.worker_id) otWorkerIds.add(r.worker_id);
  }
  ot_cost = r2(ot_cost);
  let longest_ot_week = null;
  for (const w of weekAggs) {
    if (!longest_ot_week || (w.ot_hours || 0) > (longest_ot_week.hours || 0)) {
      longest_ot_week = { week_start: w.week_start, hours: r2(w.ot_hours || 0) };
    }
  }
  if (longest_ot_week && longest_ot_week.hours < 0.004) longest_ot_week = null;

  // R-38 (2026-09-01): most recent CLOSED week within the selected
  // range, plus the prior CLOSED week for comparison. Weeks are
  // already scoped to [start, end] via weekStartsInRange up top;
  // filter to state==='closed' and take the last two by week_start.
  // Per R-36 the board stays period-organised but this card is the
  // documented exception - overtime is a weekly scheduling decision.
  //
  // Salaried-only accounts return early above (line 413); this block
  // only runs on hourly boards. Zero OT in the most recent week is a
  // real zero (0.0 hrs) - the render distinguishes it from "no closed
  // weeks in range" via applicable_reason.
  const closedWeeks = weeksOut.filter(w => w.state === "closed");
  const recentWeek = closedWeeks.length > 0 ? closedWeeks[closedWeeks.length - 1] : null;
  const priorWeek  = closedWeeks.length >= 2 ? closedWeeks[closedWeeks.length - 2] : null;

  // Format helpers scoped to this block. Server-side per §9B: the
  // client renders these strings unchanged, never computes a delta.
  const fmt$Whole = (n) => n == null ? null
    : `$${Math.abs(Math.round(Number(n))).toLocaleString("en-US")}${n < 0 ? " (credit)" : ""}`;
  const fmtHrs1 = (n) => n == null ? null : `${Number(n).toFixed(1)} hrs`;
  const fmtDateShort = (iso) => {
    if (!iso) return null;
    const [, m, d] = iso.split("-");
    return `${m}/${d}`;
  };
  const fmtWeekLabel = (w) => {
    if (!w) return null;
    return `${fmtDateShort(w.week_start)} – ${fmtDateShort(w.week_end)}`;
  };

  const recentPayload = recentWeek ? {
    week_start: recentWeek.week_start,
    week_end:   recentWeek.week_end,
    period_no:  recentWeek.period_no,
    ot_hours:   r2(recentWeek.ot_hours || 0),
    ot_hours_display: fmtHrs1(recentWeek.ot_hours || 0),
    ot_cost:    r2(recentWeek.ot_cost || 0),
    ot_cost_display: fmt$Whole(recentWeek.ot_cost || 0),
    ot_people:  recentWeek.ot_people || 0,
    workers_total: recentWeek.worker_count || 0,
    date_label: fmtWeekLabel(recentWeek),
  } : null;

  const priorPayload = priorWeek ? {
    week_start: priorWeek.week_start,
    week_end:   priorWeek.week_end,
    period_no:  priorWeek.period_no,
    ot_hours:   r2(priorWeek.ot_hours || 0),
    ot_hours_display: fmtHrs1(priorWeek.ot_hours || 0),
    date_label: fmtWeekLabel(priorWeek),
  } : null;

  // Direction word + delta. Kevin's rule: "no signed numbers"; delta
  // is expressed as absolute magnitude paired with a direction word.
  let deltaPayload = null;
  if (recentPayload && priorPayload) {
    const d = r2((recentPayload.ot_hours || 0) - (priorPayload.ot_hours || 0));
    const direction = d > 0.05 ? "up" : d < -0.05 ? "down" : "flat";
    const absMag = Math.abs(d);
    deltaPayload = {
      hours: d,
      abs_hours: r2(absMag),
      direction,
      // "up 8.3 hrs from 4.1" / "down 2.2 hrs from 14.6" / "flat vs 4.1"
      display: direction === "flat"
        ? `flat vs ${priorPayload.ot_hours_display}`
        : `${direction} ${absMag.toFixed(1)} hrs from ${priorPayload.ot_hours_display.replace(" hrs", "")}`,
    };
  }

  // Applicable + reason. Client renders one of:
  //   - full card (recent + prior + delta)
  //   - "no prior week to compare" (recent only)
  //   - "no closed weeks in range yet" (recent null)
  // Salaried-only accounts don't reach this code path (buildBoard
  // returns early at line 413); nothing renders here for them.
  let applicable = true;
  let applicable_reason = null;
  if (!recentPayload) {
    applicable = false;
    applicable_reason = "no_closed_weeks";
  } else if (!priorPayload) {
    applicable = true;
    applicable_reason = "no_prior_week";
  }

  // Neutral state until Kevin rules on the week-over-week thresholds.
  // Prompt: "Until Kevin rules, ship the chip as neutral with the
  // movement stated in words." The state key stays for downstream
  // consumers; the client renders "movement" (direction word) instead
  // of a good/bad tone.
  const wow_state = "neutral";
  const wow_state_copy = deltaPayload
    ? (deltaPayload.direction === "flat" ? "Flat vs last week" : `${deltaPayload.direction === "up" ? "Up" : "Down"} vs last week`)
    : (applicable_reason === "no_prior_week" ? "First closed week in range" : "No closed weeks in range yet");

  // V32-10 - payroll data. Weeks affected = count of weeks with any
  // unapproved hours (drafts in Rippling, priced or not).
  // HS FB1 hotfix 2026-08-25: keys off draft_hours per the same ruling
  // that fixed the per-week flag above. Priced drafts still count -
  // approval status is independent of pricing status.
  let unapproved_weeks = 0;
  for (const w of weekAggs) if ((w.draft_hours || 0) > 0.004) unapproved_weeks += 1;

  // Budgeted hours - derive from budget and observed avg rate. Only
  // meaningful when we have both a budget and a rate observation.
  const avg_rate = rangeTotals.hours > 0 ? spent_to_date / rangeTotals.hours : null;
  const budgeted_hours = budget > 0 && avg_rate != null && avg_rate > 0 ? Math.round(budget / avg_rate) : null;

  const board = {
    applies: true,
    kind,
    account,
    period_span: { first: periodsTouched[0], last: periodsTouched[periodsTouched.length - 1] },
    // Range shape
    period_no: isSinglePeriod ? selection.value : null,
    period_start: isSinglePeriod ? periodStartISO(selection.value) : null,
    period_end: isSinglePeriod ? periodEndISO(selection.value) : null,
    weeks_in_period: isSinglePeriod ? WEEKS_PER_PERIOD : null,
    // PR-A - total weeks in the requested range (multi_period gets a
    // denominator so "N of M weeks closed" can render on FYTD /
    // Last-4-Weeks / any multi-period selection). single_period ranges
    // still key their "N of M" off weeks_in_period per the existing
    // contract; both fields coexist.
    weeks_in_range: weeksOut.length,
    // PR-A - range boundaries as ISO strings so multi_period pace-card
    // sub-line can render "range closed through MM/DD/YY" when the
    // range is fully closed.
    range_start_iso: start,
    range_end_iso: end,
    // Money
    period_budget: isSinglePeriod ? budget : null,
    range_budget: budget,
    // Overview Phase 2 PR-3 · §11 B-11 rider (approved by Kevin at
    // Phase 0). New field, additive - `range_budget` above stays
    // unchanged (byte-identical across the PR-3 change per the parity
    // capture). Overview reads this; labor board's own surfaces keep
    // reading range_budget for backward compatibility. The rollout
    // for §11 B-11 is Phase 6; this ships the value only.
    //
    // amount is null when there is no budget in the range OR the
    // range enumerates zero fiscal weeks. Callers surface the null.
    // See computeBudgetToDateDays above for the exact contract.
    budget_to_date_days: computeBudgetToDateDays({
      budget_periods, start, end, today,
    }),
    // V37-4 - basis of the money above. Single period reads its one
    // basis; multi-period agrees only if every touched period has
    // the same basis (else null so the sub-line can drop the word).
    budget_basis: (() => {
      if (!hasBudget) return null;
      const seen = new Set();
      for (const p of periodsTouched) {
        const b = basisByPeriod.get(p);
        if (b) seen.add(b);
      }
      return seen.size === 1 ? [...seen][0] : null;
    })(),
    spent_to_date,
    variance,
    verdict,
    pace_pct,
    elapsed_pct,
    // Distinct people (V8-9)
    distinct_workers: distinctWorkers,
    hours: r2(rangeTotals.hours),
    ot_hours: r2(rangeTotals.ot),
    avg_rate: avg_rate != null ? r2(avg_rate) : null,
    // Coverage
    priced_ww: rangeTotals.complete,
    total_ww: rangeTotals.total,
    unpriced_hours: r2(rangeTotals.unpriced),
    // Single-period in-progress specifics
    elapsed_weeks,
    closed_weeks_count,
    in_progress_week_start,
    not_started_weeks_count,
    spent_closed,
    spent_in_progress,
    projected_period_end,
    weekly_allowance,
    budget_exhausted,
    weekly_original_target,
    // Signals
    overtime: {
      hours: r2(rangeTotals.ot),
      pct: ot_pct,
      watch_pct: ot_thresholds.watch_pct,
      alarm_pct: ot_thresholds.alarm_pct,
      state: ot_state,
      // V32-6 additions
      cost: ot_cost,
      workers: otWorkerIds.size,
      workers_total: distinctWorkers,
      longest_week: longest_ot_week,
      // R-38 (2026-09-01) rebuild - hero is week-over-week hours,
      // FY figures above become the demoted supporting line. Every
      // display string is formatted server-side (§9B). Client does
      // NOT compute the delta.
      recent_week: recentPayload,
      prior_week:  priorPayload,
      wow_delta:   deltaPayload,
      applicable,
      applicable_reason,
      wow_state,
      wow_state_copy,
      // Supporting line: "1.3% of hours this year · peak week 03/09
      // at 32.33 hrs" - assembled here so the client is presentational.
      // Peak-week phrase drops when longest_week is null.
      supporting_line: (() => {
        const parts = [];
        parts.push(`${ot_pct.toFixed(1)}% of hours this range`);
        if (longest_ot_week) {
          const iso = longest_ot_week.week_start;
          const [, m, d] = iso.split("-");
          parts.push(`peak week ${m}/${d} at ${Number(longest_ot_week.hours).toFixed(1)} hrs`);
        }
        return parts.join(" · ");
      })(),
    },
    hours_vs_budget: {
      worked: r2(rangeTotals.hours),
      budgeted: budgeted_hours,
      pct: budgeted_hours != null && budgeted_hours > 0 ? r2((rangeTotals.hours / budgeted_hours) * 100) : null,
    },
    payroll_data: {
      priced_ww: rangeTotals.complete,
      total_ww: rangeTotals.total,
      unpriced_hours: r2(rangeTotals.unpriced),
      // HS FB1 hotfix 2026-08-25: draft_hours is the approval-status
      // signal, distinct from unpriced_hours (the money-cap signal).
      // Client's Payroll Data card reads draft_hours for hasUnapproved
      // + the "Unapproved hrs" fact; unpriced_hours stays for the
      // "Will rise" cap (V42 correct - a priced draft won't grow the
      // number).
      draft_hours: r2(rangeTotals.draft_hours),
      // V32-10 - how many weeks have any unapproved hours (drives
      // action-card "Weeks affected" fact). Now keys off draft_hours.
      unapproved_weeks,
      // v43-1 approvals - the other three fields the Approvals card
      // reads (owner ruling 2026-08-26). oldest_draft_date is a MIN
      // across in-scope actuals rows and CAN BE NULL when no drafts -
      // client's absent-on-premise-fail rule renders the Oldest shift
      // fact absent (not "—", not green ALL CLEAR). approval_people
      // is distinct workers with any draft in range - client uses in
      // sub-line "across N people". still_costing_hours is APPROVED
      // entries whose Rippling cost-hop returned empty - resolves on
      // its own, shown as a muted fact so operators know where the
      // hours are without acting on them.
      approved_hours:      rangeApprovals.approved_hours,
      still_costing_hours: rangeApprovals.still_costing_hours,
      oldest_draft_date:   rangeApprovals.oldest_draft_date,
      approval_people:     rangeApprovals.approval_people,
    },
    // Per-week
    weeks: weeksOut,
  };
  return board;
}
