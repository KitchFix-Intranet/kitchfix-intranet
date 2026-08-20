// src/lib/labor/dayRangeAggregate.js
//
// Pure helpers the DayStrip component uses to build its per-day
// buckets. Extracted so the day-collapse probe can assert row-to-day
// aggregation directly against a real API response without a jsdom
// render, and so a silent truncation (rows outside the bucket window
// dropped, or fewer buckets than span_days) can never hide.

const MS_PER_DAY = 86400000;

/**
 * Inclusive ISO day list between two dates. UTC-anchored so DST does
 * not shift day boundaries.
 */
export function isoRange(startISO, endISO) {
  const out = [];
  let cur = new Date(`${startISO}T00:00:00.000Z`).getTime();
  const end = new Date(`${endISO}T00:00:00.000Z`).getTime();
  while (cur <= end) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += MS_PER_DAY;
  }
  return out;
}

/**
 * Aggregate worker-day rows (actuals_daily) into per-calendar-day
 * totals. Rows with a work_date outside `days` are recorded in
 * `droppedOutsideWindow`; the probe asserts this is always zero (the
 * server route filters on [start, end], so any non-zero drop would
 * mean a bug moved the window boundary).
 *
 * Integer-cent accumulator preserves the per-day cent-exact sum
 * across FP-summation - matches the server's dailyRangeBody discipline.
 */
export function aggregatePerDay(actualsDaily, days) {
  const bucket = new Map(days.map(d => [d, 0]));
  let droppedOutsideWindow = 0;
  for (const r of (actualsDaily || [])) {
    if (!bucket.has(r.work_date)) { droppedOutsideWindow++; continue; }
    bucket.set(r.work_date, bucket.get(r.work_date) + Math.round(Number(r.amount || 0) * 10000));
  }
  return {
    perDay: days.map(d => ({ workDate: d, amountX10000: bucket.get(d) })),
    droppedOutsideWindow,
  };
}
