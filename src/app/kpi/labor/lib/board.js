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

const MS_PER_DAY = 86400000;
const WEEKS_PER_PERIOD = 4;

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
function sumRows(rows) {
  let amount = 0, hours = 0, ot = 0, unpriced_hrs = 0;
  let complete = 0, total = 0;
  const workerIds = new Set();
  for (const r of rows) {
    total += 1;
    amount += Number(r.amount || 0);
    hours += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
    ot += Number(r.hours_overtime || 0);
    unpriced_hrs += Number(r.hours_without_dollars || 0);
    if (r.coverage_state === "complete") complete += 1;
    if (r.worker_id) workerIds.add(r.worker_id);
  }
  return { amount: r2(amount), hours: r2(hours), ot: r2(ot), unpriced_hrs: r2(unpriced_hrs), complete, total, worker_count: workerIds.size };
}

// Build the per-week aggregates for [start, end]. Returns array in
// week_start ASC order; missing weeks (no actuals) appear as zero-rows.
function buildWeekAggregates(actuals, weekStarts) {
  const byWeek = new Map();
  for (const w of weekStarts) byWeek.set(w, { rows: [] });
  for (const r of actuals) {
    if (!byWeek.has(r.week_start)) continue;
    byWeek.get(r.week_start).rows.push(r);
  }
  const out = [];
  for (const wStart of weekStarts) {
    const rows = byWeek.get(wStart).rows;
    const s = sumRows(rows);
    const week_end = new Date(parseISO(wStart).getTime() + 6 * MS_PER_DAY).toISOString().slice(0, 10);
    out.push({
      week_start: wStart, week_end,
      amount: s.amount, hours: s.hours, ot_hours: s.ot,
      unpriced_hrs: s.unpriced_hrs,
      complete_ww: s.complete, total_ww: s.total, worker_count: s.worker_count,
      coverage_states: [...new Set(rows.map(r => r.coverage_state))],
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
  const weekAggs = buildWeekAggregates(actuals, weeksInRange);
  // Range totals from weekly aggregates (avoids double-counting).
  const rangeTotals = weekAggs.reduce((acc, w) => {
    acc.amount += w.amount;
    acc.hours += w.hours;
    acc.ot += w.ot_hours;
    acc.unpriced += w.unpriced_hrs;
    acc.complete += w.complete_ww;
    acc.total += w.total_ww;
    for (const id of w.worker_count ? [] : []) {} // placeholder
    return acc;
  }, { amount: 0, hours: 0, ot: 0, unpriced: 0, complete: 0, total: 0 });
  // Distinct worker count across the range (V8-9: people, not worker-weeks).
  const distinctWorkers = new Set(actuals.map(r => r.worker_id)).size;

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
    let unapproved_flag = false;
    let unapproved_hours = 0;
    if (state !== "closed" && (w.unpriced_hrs > 0 || w.coverage_states.some(s => s === "partial" || s === "hours_only"))) {
      unapproved_flag = true;
      unapproved_hours = r2(w.unpriced_hrs);
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
      unpriced_hrs: w.unpriced_hrs,
      complete_ww: w.complete_ww,
      total_ww: w.total_ww,
      worker_count: w.worker_count,
      unapproved_flag,
      unapproved_hours,
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

  if (kind === "single_period_in_progress") {
    elapsed_weeks = computeElapsedWeeks(weeksOut, today);
    for (const w of weeksOut) {
      if (w.state === "closed") { closed_weeks_count += 1; spent_closed = (spent_closed || 0) + w.spent; }
      if (w.state === "in_progress") { in_progress_week_start = w.week_start; spent_in_progress = w.spent; }
      if (w.state === "not_started") not_started_weeks_count += 1;
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

  // V32-10 - payroll data. Weeks affected = count of weeks with any
  // unpriced hours (someone's timesheet hasn't been approved yet).
  let unapproved_weeks = 0;
  for (const w of weekAggs) if ((w.unpriced_hrs || 0) > 0.004) unapproved_weeks += 1;

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
    // Money
    period_budget: isSinglePeriod ? budget : null,
    range_budget: budget,
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
      // V32-10 - how many weeks have any unapproved hours (drives
      // action-card "Weeks affected" fact).
      unapproved_weeks,
    },
    // Per-week
    weeks: weeksOut,
  };
  return board;
}
