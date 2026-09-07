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

import { budgetAtThisRevenue as sharedBatr } from "@/lib/kpi/shared/batr.js";
import { REVENUE_LINE_CODES } from "@/lib/kpi/overview/pnl-loader.js";
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

  // Bucket by (week_start, service_date). For each day: was any
  // service on that day confirmed (has_actuals)? Sum the revenue.
  const byWeek = new Map();  // week_start -> { byDate: Map<date, {hasActual, actualRev, projRev}> }
  for (const w of weekStarts) byWeek.set(w, { byDate: new Map() });
  for (const r of rows) {
    const ws = weekStartFor(r.service_date);
    if (!ws || !byWeek.has(ws)) continue;
    const bucket = byWeek.get(ws);
    const d = bucket.byDate.get(r.service_date) || { hasActual: false, actualRev: 0, projRev: 0 };
    if (r.has_actuals) {
      d.hasActual = true;
      d.actualRev += Number(r.actual_revenue || 0);
    } else if (r.has_projection) {
      d.projRev += Number(r.projected_revenue || 0);
    }
    bucket.byDate.set(r.service_date, d);
  }

  // Emit per-week records with basis classification.
  //
  // A week is "confirmed" when ANY served day has has_actuals -
  // Kevin's item 5 treats confirmed as the single tile treatment
  // covering closed / running / confirmed sub-states. "Forecast"
  // when no served day has actuals (the pure fallback path).
  //
  // This is the branch condition Kevin ruled to weight equally -
  // no "if (!confirmedDays) fallback = ..." phrasing here.
  const data = weekStarts.map(ws => {
    const bucket = byWeek.get(ws);
    const wEnd = new Date(new Date(ws + "T00:00:00Z").getTime() + 6 * MS_PER_DAY).toISOString().slice(0, 10);

    let confirmedDays = 0;
    let projectedDays = 0;
    let actualRev = 0;
    let projectedRev = 0;
    for (const [, d] of bucket.byDate) {
      if (d.hasActual) {
        confirmedDays += 1;
        actualRev += d.actualRev;
      } else if (d.projRev > 0) {
        projectedDays += 1;
        projectedRev += d.projRev;
      }
    }
    const emptyDays = 7 - confirmedDays - projectedDays;

    const isConfirmed = confirmedDays > 0;
    return {
      week_start: ws,
      week_end: wEnd,
      basis: isConfirmed ? "confirmed" : "forecast",
      temporal: weekTemporalState(ws, today),
      confirmed_days: confirmedDays,
      projected_days: projectedDays,
      empty_days: emptyDays < 0 ? 0 : emptyDays,
      actual_revenue: Math.round(actualRev * 100) / 100,
      projected_revenue: Math.round(projectedRev * 100) / 100,
      revenue: isConfirmed
        ? Math.round((actualRev + projectedRev) * 100) / 100  // confirmed weeks may still carry projected tail (running week)
        : Math.round(projectedRev * 100) / 100,               // pure forecast weeks read only projected
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
export function attachWeeklyBasisToBoard(board, weeklyBasisData, { lineTargetPctByPeriod, todayISO }) {
  if (!board || board.applies === false) return board;
  if (!Array.isArray(board.weeks)) return board;
  if (!weeklyBasisData || !Array.isArray(weeklyBasisData.data)) return board;

  const byStart = new Map();
  for (const w of weeklyBasisData.data) {
    byStart.set(w.week_start, w);
  }

  for (const w of board.weeks) {
    const basis = byStart.get(w.week_start);
    if (!basis) continue;
    w.revenue_basis = basis.basis;
    w.revenue_basis_temporal = basis.temporal;
    w.confirmed_days = basis.confirmed_days;
    w.projected_days = basis.projected_days;
    w.empty_days = basis.empty_days;
    w.week_actual_revenue = basis.actual_revenue;
    w.week_projected_revenue = basis.projected_revenue;
    w.week_revenue = basis.revenue;

    const periodNo = periodOf(w.week_start);
    const pct = periodNo != null ? lineTargetPctByPeriod?.get?.(periodNo) : null;
    if (pct != null && basis.revenue != null) {
      const raw = Number(basis.revenue) * Number(pct);
      w.budget_at_this_week_revenue = Math.round(raw * 100) / 100;
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
