// src/lib/labor/labor-week-basis.js
//
// Kevin Labor PR-B (2026-09-07). Per-week revenue basis + per-week
// adjusted budget for This period.
//
// Two responsibilities:
//   1. Load the revenue basis for each week in a range - confirmed
//      (any served day has has_actuals) or forecast (only projections).
//   2. Attach per-week fields to a labor board: revenue_basis,
//      revenue_basis_temporal, week_revenue, budget_at_this_week_revenue,
//      confirmed_days, projected_days, days_left_in_week.
//
// The per-week budget uses the same formula the range-level batr uses
// (shared/batr.js), applied per week against that week's revenue basis
// and the containing period's line_target_pct (labor_budget[period] /
// revenue_budget[period]). A chef schedules against next week's real
// number, not a quarter of the period plan.
//
// The distinction drives the tile treatment (solid vs dashed grey),
// the state label ("confirmed" / "closed" / "running" vs "forecast"),
// the revenue-row label ("Confirmed revenue" vs "Forecast revenue"),
// and whether the budget carries a "plan" tag.
//
// KEVIN'S RULING · fallback is the main path, not the exception.
// Today the confirmed path only exercises on TBR - FL and TBJ - FL
// (the two accounts with a trustworthy Service Calendar). On the
// other nine accounts every week falls back to forecast. That ratio
// inverts as seeding completes - which means the forecast path will
// be under-tested exactly when it starts mattering less, and
// over-relied-on right now. Both branches are written and named as
// equal peers here; no "if no confirmed, fall back" phrasing.
//
// Data source: sc_daily_revenue view, same table the Overview
// resolver reads. Fields consumed per row:
//   service_date · has_actuals · actual_revenue · projected_revenue
//   is_non_revenue
// Filters: NOT is_non_revenue (matches Overview's per-line rule).
//
// Week bucketing: FY2026 weeks are Sunday-aligned, step 7 days from
// FY_START (2025-12-29). See src/app/kpi/labor/lib/periods.js for
// the weekStartsInRange helper.

// Kevin ruling 2026-09-07: shared periodBasis.js owns REVENUE_LINE_CODES,
// batr formula, and CONTRACTUAL_ACCRUAL_LINES. Import from there so
// this file has no locally-owned duplication.
import { REVENUE_LINE_CODES, CONTRACTUAL_ACCRUAL_LINES } from "@/lib/kpi/shared/periodBasis.js";
import { periodOf } from "@/app/kpi/labor/lib/periods.js";

const IN_CHUNK = 60;
const PS_DEFAULT = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Bucket a service_date into the Sunday-aligned fiscal week_start
// containing it. Copies the periods.js logic to avoid a route-side
// dependency on the client-lib import path from a lib/ module.
const FY_START_ISO = "2025-12-29";
function weekStartFor(serviceDateISO) {
  const svc = new Date(serviceDateISO + "T00:00:00Z");
  const fy = new Date(FY_START_ISO + "T00:00:00Z");
  if (!svc || !fy || isNaN(svc) || isNaN(fy) || svc < fy) return null;
  const days = Math.floor((svc.getTime() - fy.getTime()) / MS_PER_DAY);
  const weekIdx = Math.floor(days / 7);
  const ws = new Date(fy.getTime() + weekIdx * 7 * MS_PER_DAY);
  return ws.toISOString().slice(0, 10);
}

// Enumerate the Sunday-aligned week_start dates whose 7-day window
// overlaps [start, end]. Same rule as weekStartsInRange in
// app/kpi/labor/lib/periods.js.
function weekStartsInRange(startISO, endISO) {
  const rs = new Date(startISO + "T00:00:00Z");
  const re = new Date(endISO + "T00:00:00Z");
  const fy = new Date(FY_START_ISO + "T00:00:00Z");
  if (isNaN(rs) || isNaN(re) || isNaN(fy) || rs > re) return [];
  const rsMs = rs.getTime();
  const reMs = re.getTime();
  const fyMs = fy.getTime();
  const idxStart = Math.max(0, Math.floor((rsMs - 6 * MS_PER_DAY - fyMs) / (7 * MS_PER_DAY)));
  const out = [];
  for (let i = idxStart; ; i += 1) {
    const wStartMs = fyMs + i * 7 * MS_PER_DAY;
    if (wStartMs > reMs) break;
    const wEndMs = wStartMs + 6 * MS_PER_DAY;
    if (wEndMs >= rsMs) {
      out.push(new Date(wStartMs).toISOString().slice(0, 10));
    }
  }
  return out;
}

// Chunk helper for .in() clauses under Supabase's row cap.
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Classify a week's temporal state relative to today. Kevin's item 5
// naming: closed / running / confirmed / forecast. Sub-state
// disambiguation belongs on the confirmed side (the same tile
// treatment covers all three); forecast is its own state.
function weekTemporalState(weekStartISO, todayISO) {
  if (!weekStartISO || !todayISO) return "unknown";
  const wStart = new Date(weekStartISO + "T00:00:00Z");
  const wEnd = new Date(wStart.getTime() + 6 * MS_PER_DAY);
  const today = new Date(todayISO + "T00:00:00Z");
  if (wEnd < today) return "closed";       // fully in the past
  if (wStart > today) return "future";     // fully ahead
  return "running";                         // contains today
}

/**
 * Load per-week revenue basis for a range.
 *
 * @param {object} supa                    Supabase client
 * @param {object} opts
 * @param {string[]} opts.members           account keys in scope
 * @param {string} opts.start               range start ISO
 * @param {string} opts.end                 range end ISO
 * @param {string} opts.today               today ISO for temporal
 *                                          state classification
 * @returns {{ data: Array<{
 *   week_start: string,           // Sunday-aligned ISO
 *   week_end: string,             // week_start + 6d
 *   basis: "confirmed" | "forecast",
 *   temporal: "closed" | "running" | "future",
 *   confirmed_days: number,       // days with any has_actuals
 *   projected_days: number,       // days with only projections
 *   empty_days: number,           // days with no service scheduled
 *   revenue: number,              // basis-appropriate week revenue
 *   actual_revenue: number,       // sum of actual_revenue where has_actuals
 *   projected_revenue: number,    // sum of projected_revenue where !has_actuals
 * }> }}
 */
export async function loadWeeklyRevenueBasis(supa, { members, start, end, today }) {
  if (!members || members.length === 0) return { data: [] };
  if (!start || !end) return { data: [] };
  const weekStarts = weekStartsInRange(start, end);
  if (weekStarts.length === 0) return { data: [] };

  // Query sc_daily_revenue for the whole range, then bucket client-
  // side by week. Same filter Overview applies: NOT is_non_revenue.
  const rows = [];
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("sc_daily_revenue")
        .select("account_key, service_date, service_id, actual_revenue, projected_revenue, has_actuals, has_projection")
        .in("account_key", memberChunk)
        .gte("service_date", start)
        .lte("service_date", end)
        .not("is_non_revenue", "is", true)
        .order("account_key")
        .order("service_date")
        .order("service_id")
        .range(from, from + PS_DEFAULT - 1);
      if (q.error) return { error: q.error, scope: "sc_daily_revenue" };
      const data = q.data || [];
      rows.push(...data);
      if (data.length < PS_DEFAULT) break;
      from += PS_DEFAULT;
    }
  }

  // Kevin walkthrough item 3 (2026-09-07, corrected). Basis is
  // service-level. Original rule counted every row in the denominator,
  // which turned complete weeks into "120 of 133" partial because
  // sc_daily_revenue carries EMPTY CALENDAR SLOTS (`has_projection`
  // rows with `projected_revenue = 0`) alongside real projected
  // services. TBJ - FL P9 W1 had 13 zero-projection slots on 08/16
  // (a non-service day), which is what turned "12 of 12 confirmed"
  // into "120 of 133 partial" under the naive count.
  //
  // Corrected rule: **only services with a non-zero projection are
  // in the denominator.** An actual service always counts as
  // confirmed (has_actuals=true regardless of projected_revenue).
  // A row with has_projection=true AND projected_revenue=0 AND
  // !has_actuals is an empty calendar slot - excluded entirely.
  //
  // Three states:
  //   confirmed  every projected (non-zero) service has a count
  //   partial    some do, some don't
  //   forecast   none do
  //
  // Revenue for partial + confirmed: sum(actual $ where has_actuals)
  //   + sum(projected $ where !has_actuals). Partial and confirmed
  //   both include the actual + projected mix; forecast is projected
  //   only. Zero-projection slots contribute $0 to either side, so
  //   they never affect the revenue number - only the classification.
  const byWeek = new Map();
  for (const w of weekStarts) byWeek.set(w, {
    confirmedSvcs: 0, projectedSvcs: 0, emptySlotSvcs: 0,
    actualRev: 0, projectedRev: 0,
    daysWithService: new Set(),
    daysWithConfirmedSvc: new Set(),
  });
  for (const r of rows) {
    const ws = weekStartFor(r.service_date);
    if (!ws || !byWeek.has(ws)) continue;
    const bucket = byWeek.get(ws);
    bucket.daysWithService.add(r.service_date);
    if (r.has_actuals) {
      // Confirmed service. Counts in denominator regardless of what
      // was projected (a service that was served is a real service).
      bucket.confirmedSvcs += 1;
      bucket.actualRev += Number(r.actual_revenue || 0);
      bucket.daysWithConfirmedSvc.add(r.service_date);
    } else if (r.has_projection && Number(r.projected_revenue || 0) > 0) {
      // Real projected service - client planned to serve, hasn't been
      // confirmed yet. Counts in denominator.
      bucket.projectedSvcs += 1;
      bucket.projectedRev += Number(r.projected_revenue || 0);
    } else if (r.has_projection) {
      // Empty calendar slot - has_projection=true but projected_revenue=0.
      // Excluded from denominator per Kevin's ruling; tracked so the
      // probe can name why a week is confirmed at "12 of 12" when
      // sc_daily_revenue has 80 rows for the week.
      bucket.emptySlotSvcs += 1;
    }
  }

  const data = weekStarts.map(ws => {
    const bucket = byWeek.get(ws);
    const wEnd = new Date(new Date(ws + "T00:00:00Z").getTime() + 6 * MS_PER_DAY).toISOString().slice(0, 10);

    const { confirmedSvcs, projectedSvcs, emptySlotSvcs, actualRev, projectedRev } = bucket;
    const totalSvcs = confirmedSvcs + projectedSvcs;       // meaningful denominator
    const basis = totalSvcs === 0
      ? "forecast"                                         // no meaningful services -> nothing to compare
      : projectedSvcs === 0
        ? "confirmed"                                      // every projected service has a count
        : confirmedSvcs === 0
          ? "forecast"                                     // none confirmed - pure forecast
          : "partial";                                     // some of each

    // Day counts retained for backwards compat + client copy. A day
    // with any confirmed service counts on the confirmed side; days
    // with only projections count on the projected side; the diff
    // to 7 is `empty_days`.
    const confirmedDays = bucket.daysWithConfirmedSvc.size;
    const projectedDays = bucket.daysWithService.size - confirmedDays;
    const emptyDays = 7 - bucket.daysWithService.size;

    return {
      week_start: ws,
      week_end: wEnd,
      basis,
      temporal: weekTemporalState(ws, today),
      confirmed_days: confirmedDays,
      projected_days: projectedDays,
      empty_days: emptyDays < 0 ? 0 : emptyDays,
      confirmed_services: confirmedSvcs,
      projected_services: projectedSvcs,
      total_services: totalSvcs,                            // meaningful denominator (non-zero projected + confirmed)
      empty_slot_services: emptySlotSvcs,                   // excluded from denominator; kept for the probe
      actual_revenue: Math.round(actualRev * 100) / 100,
      projected_revenue: Math.round(projectedRev * 100) / 100,
      revenue: basis === "forecast"
        ? Math.round(projectedRev * 100) / 100             // pure forecast: projections only
        : Math.round((actualRev + projectedRev) * 100) / 100, // confirmed or partial: mix
    };
  });
  return { data };
}

/**
 * Compute line_target_pct per period for the requested account(s).
 *
 * line_target_pct[p] = labor_budget[p] / revenue_budget[p]
 *
 * Labor budget comes from budget_periods (the salary-inclusive amount
 * when the caller has passed the merged board's budget_periods; the
 * hourly-only amount otherwise - matches whatever attachBatrToBoard
 * received). Revenue budget comes from the same overviewBudgets map
 * the range-level batr uses, so per-week and range-level agree by
 * construction under R-68 (salary inclusion) and R-77 (adjusted
 * budget as the KPI).
 *
 * Returns Map<period_no, pct>. Periods with either budget missing are
 * omitted - the caller renders a plain per-week bar with no adjusted
 * budget, same as the range-level batr returning null.
 */
export function computeLineTargetPctByPeriod({ budgetPeriods, overviewBudgets, members, periods }) {
  const out = new Map();
  if (!Array.isArray(budgetPeriods)) return out;
  if (!overviewBudgets) return out;
  const byPeriodLabor = new Map();
  for (const bp of budgetPeriods) {
    if (bp?.period_no != null && bp.amount != null) {
      byPeriodLabor.set(Number(bp.period_no), Number(bp.amount));
    }
  }
  for (const p of periods) {
    const laborBud = byPeriodLabor.get(p);
    if (laborBud == null) continue;
    let revBud = 0;
    let anyRev = false;
    for (const line of REVENUE_LINE_CODES) {
      const perLine = overviewBudgets.get(line);
      if (!perLine) continue;
      for (const m of members) {
        const byAcct = perLine.get(m);
        if (!byAcct) continue;
        const v = byAcct.get(p);
        if (v != null) {
          revBud += Number(v);
          anyRev = true;
        }
      }
    }
    if (!anyRev || revBud === 0) continue;
    out.set(p, laborBud / revBud);
  }
  return out;
}

// Kevin item 6 - running week shows a fraction, not a variance. To
// render "N days left" the client needs the count of days from today
// through week_end (inclusive of today, exclusive of past days). Only
// meaningful for the running week; closed and future weeks return 0
// and 7 respectively.
function daysLeftInRunningWeek(weekStartISO, todayISO) {
  if (!weekStartISO || !todayISO) return null;
  const wStart = new Date(weekStartISO + "T00:00:00Z");
  const wEnd = new Date(wStart.getTime() + 6 * MS_PER_DAY);
  const today = new Date(todayISO + "T00:00:00Z");
  if (today > wEnd) return 0;
  if (today < wStart) return 7;
  const diff = Math.floor((wEnd.getTime() - today.getTime()) / MS_PER_DAY);
  return diff + 1;  // include today
}

/**
 * Attach per-week revenue basis + adjusted budget to a labor board.
 *
 * For each week in board.weeks:
 *   - revenue_basis         "confirmed" | "forecast"
 *   - revenue_basis_temporal "closed" | "running" | "future"
 *   - confirmed_days        int 0-7
 *   - projected_days        int 0-7
 *   - week_revenue          basis-appropriate revenue for the week
 *   - week_actual_revenue   raw actual sum (confirmed days)
 *   - week_projected_revenue raw projected sum
 *   - budget_at_this_week_revenue  week_revenue × line_target_pct[period]
 *   - days_left_in_week     for running week (null otherwise)
 *
 * Idempotent - callers on the salary-merge path re-invoke after the
 * rebuild same as attachBatrToBoard does. When line_target_pct is
 * unknown for a week's period (missing revenue budget), the batr
 * fields are left null; the rest of the per-week basis still lands.
 *
 * Weeks not present in weeklyBasisData (defensive - the loader is
 * called against the same range) get no attach.
 */
export function attachWeeklyBasisToBoard(board, weeklyBasisData, { lineTargetPctByPeriod, todayISO, contractualAccrualByPeriod = null }) {
  if (!board || board.applies === false) return board;
  if (!Array.isArray(board.weeks)) return board;
  if (!weeklyBasisData || !Array.isArray(weeklyBasisData.data)) return board;

  const byStart = new Map();
  for (const w of weeklyBasisData.data) {
    byStart.set(w.week_start, w);
  }

  // Kevin post-1049 sweep item 4/5b (2026-09-07). Sum of per-week
  // batr must equal the panel's range-level batr. Panel uses total
  // revenue = SC + R-67 contractual accrual (precedence #3). Per
  // week must include the same accrual split evenly across the 4
  // weeks of a period. Only CLOSED weeks accrue - running/future
  // haven't earned their share. contractualAccrualByPeriod is a
  // Map<period_no, total_dollars> from shared
  // computeContractualAccrualByPeriod; empty when caller doesn't
  // pass it (early callers pre-fix).
  const accrualByPeriod = contractualAccrualByPeriod || new Map();

  for (const w of board.weeks) {
    const basis = byStart.get(w.week_start);
    if (!basis) continue;
    w.revenue_basis = basis.basis;
    w.revenue_basis_temporal = basis.temporal;
    w.confirmed_days = basis.confirmed_days;
    w.projected_days = basis.projected_days;
    w.empty_days = basis.empty_days;
    w.confirmed_services = basis.confirmed_services;
    w.projected_services = basis.projected_services;
    w.total_services = basis.total_services;
    w.empty_slot_services = basis.empty_slot_services;
    w.week_actual_revenue = basis.actual_revenue;
    w.week_projected_revenue = basis.projected_revenue;

    // Per-week contractual accrual: 1/4 of period total for CLOSED
    // weeks. Zero for running / future. Kept unrounded here so
    // sum(4 weeks) = period_total exactly - Kevin's acceptance:
    // "the panel's budget equals the sum of the week-card budgets".
    // Rounding per week breaks the identity by 2¢. Consumers round
    // at display; server storage stays at full JS precision.
    const periodNo = periodOf(w.week_start);
    const periodAccrual = periodNo != null ? Number(accrualByPeriod.get(periodNo) || 0) : 0;
    const weekAccrual = (basis.temporal === "closed" && periodAccrual > 0)
      ? periodAccrual / 4
      : 0;
    w.week_contractual_accrual = weekAccrual;
    const revenueWithAccrual = Number(basis.revenue || 0) + weekAccrual;
    w.week_revenue = revenueWithAccrual;

    const pct = periodNo != null ? lineTargetPctByPeriod?.get?.(periodNo) : null;
    if (pct != null) {
      w.budget_at_this_week_revenue = revenueWithAccrual * Number(pct);
    } else {
      w.budget_at_this_week_revenue = null;
    }

    if (basis.temporal === "running") {
      w.days_left_in_week = daysLeftInRunningWeek(w.week_start, todayISO);
    } else {
      w.days_left_in_week = null;
    }
  }
  return board;
}
