// src/lib/labor/workerWeekRates.js
//
// Resolve a per-worker-per-fiscal-week HOURLY RATE from the stamp
// Rippling writes on each pay segment. Used by the labor route to
// feed WeekTable's rate column so the number is a read of the rate
// in force on the shift, not a client-side division of dollars by
// clipped hours.
//
// Why not divide. `labor_actuals.{hours_*}` is numeric(10,2), so
// `segment_duration_hours` is the true duration clipped to 2 dp.
// `estimated_amount` is `estimated_hourly_rate x true duration`,
// unclipped. Dividing the clipped hours into the full-precision
// dollars overshoots or undershoots the real rate by up to a cent
// per segment and the drift compounds across a week. The segment
// rate IS the rate - no reconstruction needed.
//
// Why not rippling_raw_compensations_latest. That table is current
// state only. Two workers in the live corpus already carry a
// compensation wage that is above the rate applied to their older
// shifts, so a July week would render an August rate. The segment
// rate is stamped on the shift and stays correct for the era it
// describes.
//
// Why not overtime_multiplier. Null on `Holiday Double Rate`, per
// rule D37 in deriveActuals.js. Any detector that keys on it misses
// the holiday case that ruling exists to correct.
//
// Why key against labor_actuals' own week_start. The derive routes
// each segment through `resolveWeek(account_key, segment_date)` which
// uses sc_day_metadata when present and isoWeekBounds as fallback -
// different accounts can carry different week_starts for the same
// calendar date. If this helper computed its own week_start from
// segment_date, the rate map's keys would miss labor_actuals rows
// whenever the two conventions disagree. Using the actuals rows'
// own (worker_id, week_start, week_end) ranges as the join target
// guarantees the keys line up by construction.

import { dedupePaySegments } from "./paySegmentDedupe.js";

// Which earning-type labels count as the worker's REGULAR hourly rate.
// `Regular` is the current post-cutover label; `Base Pay` is the
// pre-cutover label still present on history (same semantic). Not a
// bucket lookup through earning_type_map because the map's `regular`
// bucket also captures a few variants we deliberately want to exclude
// from the rate basis (holiday-rate relabels, premium pay).
const REGULAR_ET_NAMES = new Set(["Regular", "Base Pay"]);

function keyOf(workerId, weekStart) {
  return `${workerId}|${weekStart}`;
}

/**
 * Build a Map<"workerId|weekStart", rate> for every worker-week in
 * `actualsRows` whose live regular segments resolve a rate. The
 * (worker_id, week_start) keys match labor_actuals exactly, so
 * WeekTable can look up `rates.get("workerId|w.week_start")`.
 *
 * Mid-week-raise rule (Kevin ruling 2026-10-06). 7 of 1,537 worker-
 * weeks in the current corpus carry two distinct regular rates (a
 * raise mid-week, dated to a Monday or elsewhere). The rate that
 * covers the MOST regular hours in that week wins. Rendering the
 * higher of the two would over-report; the lower would under-report;
 * the time-weighted winner matches what the worker was paid for the
 * bulk of the week. Comment the choice so a future reader does not
 * swap it for a different tie-break.
 *
 * No rate resolves -> the key is absent. The client renders a dash.
 * Never a computed fallback and never a constant.
 */
export async function loadWorkerWeekRates(supa, { actualsRows }) {
  // Build the (worker_id -> [{week_start, week_end}]) lookup from
  // actualsRows FIRST so the segment join can key by labor_actuals'
  // own week_start convention.
  const workerWeeks = new Map();
  for (const a of actualsRows || []) {
    if (!a?.worker_id || !a.week_start) continue;
    let list = workerWeeks.get(a.worker_id);
    if (!list) { list = []; workerWeeks.set(a.worker_id, list); }
    list.push({ week_start: a.week_start, week_end: a.week_end || a.week_start });
  }
  // Early exit when the board has no worker-weeks to resolve. This
  // handles aggregate pseudo-views and empty-period ranges without
  // reading pay_segments.
  if (workerWeeks.size === 0) {
    return { rates: new Map(), mixedRaiseWeeks: 0, workerWeeksCount: 0 };
  }

  // Load presence + raw pay_segments + dedupe. One source of truth
  // (dedupePaySegments) so this helper cannot drift from the derive.
  const presenceSet = new Set();
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const q = await supa.from("rippling_current_presence")
        .select("rippling_id").eq("kind", "pay_segments").range(from, from + PAGE - 1);
      if (q.error) throw new Error(`loadWorkerWeekRates presence: ${q.error.message}`);
      const rows = q.data || [];
      for (const r of rows) presenceSet.add(r.rippling_id);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  const raw = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const q = await supa
        .from("rippling_raw_pay_segments")
        .select("rippling_id, payload")
        .range(from, from + PAGE - 1);
      if (q.error) throw new Error(`loadWorkerWeekRates raw: ${q.error.message}`);
      const rows = q.data || [];
      for (const r of rows) raw.push(r);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  const dedupe = dedupePaySegments(raw, presenceSet);
  const segs = dedupe.segments;

  // Group segments by (worker, week_start, rate) accumulating true-
  // duration regular hours. For each segment, find the labor_actuals
  // week whose [week_start, week_end] range contains segment_date for
  // that worker - this is the join that keeps keys aligned with the
  // actuals table even when sc_day_metadata hands the derive a non-
  // Monday week_start.
  // Shape: workerHoursByWeekAndRate.get("worker|week") = Map<rate, hrs>
  const workerHoursByWeekAndRate = new Map();
  for (const s of segs) {
    const p = s.payload || {};
    const workerId = p.owner_role?.id;
    if (!workerId) continue;
    const weeks = workerWeeks.get(workerId);
    if (!weeks) continue;
    const et = p.merged_earning_type_name;
    if (!REGULAR_ET_NAMES.has(et)) continue;
    const segDate = p.segment_date;
    if (!segDate) continue;
    const bucket = weeks.find(w => w.week_start <= segDate && segDate <= w.week_end);
    if (!bucket) continue;
    const rate = Number(p.estimated_hourly_rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const hrs = Number(p.segment_duration_hours);
    if (!Number.isFinite(hrs) || hrs <= 0) continue;

    const key = keyOf(workerId, bucket.week_start);
    let perRate = workerHoursByWeekAndRate.get(key);
    if (!perRate) {
      perRate = new Map();
      workerHoursByWeekAndRate.set(key, perRate);
    }
    perRate.set(rate, (perRate.get(rate) || 0) + hrs);
  }

  const out = new Map();
  let mixedRaiseWeeks = 0;
  for (const [key, perRate] of workerHoursByWeekAndRate) {
    if (perRate.size > 1) mixedRaiseWeeks += 1;
    let bestRate = null, bestHrs = -1;
    for (const [rate, hrs] of perRate) {
      if (hrs > bestHrs) { bestRate = rate; bestHrs = hrs; }
    }
    if (bestRate != null) out.set(key, Math.round(bestRate * 100) / 100);
  }
  return { rates: out, mixedRaiseWeeks, workerWeeksCount: workerHoursByWeekAndRate.size };
}

// Caller-side key helper so WeekTable + any other consumer don't
// reinvent the keying rule.
export function workerWeekRateKey(workerId, weekStart) {
  return keyOf(workerId, weekStart);
}
