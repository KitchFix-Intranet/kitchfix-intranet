// src/lib/labor/salaryProRate.js
//
// PR-3a - salary pro-rate for the daily-source range response.
// labor_salary_actuals is week-grain (per-worker-per-week amount =
// annual / 52). Kevin ruling 2026-08-20: daily salary is the cleanest
// pro-rate we have because annual / 52 / 7 is how salary actually
// accrues. Slice each overlapped week by days_in_range / 7 and sum
// per worker.
//
// LRM discipline mirrors budgetProRate.js: total is the load-bearing
// figure (rounded from the unrounded sum), per-worker slices are
// redistributed via largest-remainder so sum(workers[].slice) equals
// total to the cent. Same principle the weekly derive uses on
// sub-buckets vs amount (see deriveActuals.js).
//
// Label grammar matches budgetProRate exactly so a client renders
// one consistent string for the whole range's pro-rate posture.

const MS_PER_DAY = 86400000;
function parseISO(iso) { return new Date(`${iso}T00:00:00.000Z`); }
function toISO(d) { return d.toISOString().slice(0, 10); }
function addDaysISO(iso, days) {
  const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + days); return toISO(d);
}
function fmtMMDD(iso) { const [ , M, D] = iso.split("-"); return `${M}/${D}`; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * Pro-rate labor_salary_actuals to a day range.
 *
 * @param {object} args
 * @param {string} args.startISO   inclusive
 * @param {string} args.endISO     inclusive
 * @param {Array<{worker_id: string, account_key: string, week_start: string, amount: number, annual_comp_at_time?: number}>} args.salaryRows
 *   per-worker-per-week rows from labor_salary_actuals (loadSalaryActuals output)
 * @returns {{
 *   workers: Array<{worker_id: string, account_key: string, days_in_range: number, weeks_touched: number, slice: number}>,
 *   total: number,
 *   overlapped_weeks: number,
 *   overlapped_days: number,
 *   label: string | null,
 * }}
 */
export function salaryProRate({ startISO, endISO, salaryRows }) {
  // Aggregate per (worker, account) - accumulate unrounded 4dp
  // integers (myriadths) to preserve sub-cent precision through the
  // sum, mirroring the weekly derive's integer-cent accumulator.
  const perWorker = new Map();   // key: worker_id|account_key
  const weeksTouched = new Set();
  let totalUnroundedX10000 = 0;
  for (const r of (salaryRows || [])) {
    const wStart = r.week_start;
    const wEnd   = addDaysISO(wStart, 6);
    const oStart = wStart > startISO ? wStart : startISO;
    const oEnd   = wEnd   < endISO   ? wEnd   : endISO;
    if (oStart > oEnd) continue;
    const daysInRange = Math.round(
      (parseISO(oEnd).getTime() - parseISO(oStart).getTime()) / MS_PER_DAY,
    ) + 1;
    weeksTouched.add(wStart);
    const weekAmount = Number(r.amount) || 0;
    const sliceX10000 = Math.round(weekAmount * daysInRange / 7 * 10000);
    totalUnroundedX10000 += sliceX10000;
    const k = `${r.worker_id}|${r.account_key}`;
    const cur = perWorker.get(k) || {
      worker_id: r.worker_id, account_key: r.account_key,
      sliceX10000: 0, weeks_touched: 0, days_in_range: 0,
    };
    cur.sliceX10000 += sliceX10000;
    cur.weeks_touched++;
    cur.days_in_range += daysInRange;
    perWorker.set(k, cur);
  }
  const workers = [...perWorker.values()];
  const totalCents = Math.round(totalUnroundedX10000 / 100);
  // LRM: floor each worker to cents, distribute residual to largest
  // remainders. Deterministic tiebreak by worker_id.
  const buckets = workers.map((w, i) => ({
    i, key: w.worker_id,
    floorCents: Math.floor(w.sliceX10000 / 100),
    remainder: (w.sliceX10000 / 100) - Math.floor(w.sliceX10000 / 100),
  }));
  let residual = totalCents - buckets.reduce((s, b) => s + b.floorCents, 0);
  if (residual > 0) {
    buckets.sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
    for (let i = 0; i < residual; i++) buckets[i].floorCents++;
  } else if (residual < 0) {
    buckets.sort((a, b) => a.remainder - b.remainder || a.key.localeCompare(b.key));
    for (let i = 0; i < -residual; i++) buckets[i].floorCents--;
  }
  const finalCentsByI = new Map(buckets.map(b => [b.i, b.floorCents]));

  const overlappedWeeks = [...weeksTouched].sort();
  const totalOverlappedDays = daysInRangeAcrossWeeks(startISO, endISO, overlappedWeeks);

  const workersOut = workers.map((w, i) => ({
    worker_id: w.worker_id,
    account_key: w.account_key,
    weeks_touched: w.weeks_touched,
    days_in_range: w.days_in_range,
    slice: finalCentsByI.get(i) / 100,
  }));
  return {
    workers: workersOut,
    total: totalCents / 100,
    overlapped_weeks: overlappedWeeks.length,
    overlapped_days: totalOverlappedDays,
    label: labelFor(overlappedWeeks, totalOverlappedDays, startISO, endISO),
  };
}

function daysInRangeAcrossWeeks(startISO, endISO, weekStarts) {
  let total = 0;
  for (const wStart of weekStarts) {
    const wEnd = addDaysISO(wStart, 6);
    const oStart = wStart > startISO ? wStart : startISO;
    const oEnd   = wEnd   < endISO   ? wEnd   : endISO;
    if (oStart > oEnd) continue;
    total += Math.round((parseISO(oEnd).getTime() - parseISO(oStart).getTime()) / MS_PER_DAY) + 1;
  }
  return total;
}

function labelFor(overlappedWeeks, overlappedDays, startISO, endISO) {
  if (overlappedWeeks.length === 0) return null;
  if (overlappedWeeks.length === 1) {
    if (overlappedDays === 7) return null;   // whole week - un-labeled
    return `pro-rated, ${overlappedDays} of 7 days of wk ${fmtMMDD(overlappedWeeks[0])}`;
  }
  return `pro-rated across ${overlappedDays} days`;
}
