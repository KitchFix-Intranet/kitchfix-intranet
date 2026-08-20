// src/lib/labor/budgetProRate.js
//
// PR-2 budget pro-rate. Actuals are exact at any grain; budget is
// not - it exists per fiscal week (28d period / 4), and a partial-
// week request must pro-rate honestly.
//
// Owner ruling: pro-rate by days AND label it. Never show a
// projection, a pace, a weekly allowance, or a "lands at" figure in
// custom mode - all four assume a period. Emitting them would be
// arithmetic on a fiction.
//
// Labels
//   single week partial:     "pro-rated, 4 of 7 days of wk MM/DD"
//   multi-week partial:      "pro-rated across N days"
//   whole weeks (should not enter this helper) -> no label (helper
//   returns null in that case; caller renders the un-labeled figure).

const MS_PER_DAY = 86400000;

function parseISO(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}
function toISO(d) {
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso, days) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}
function fmtMMDD(iso) {
  const [ , M, D] = iso.split("-");
  return `${M}/${D}`;
}

/**
 * Compute a pro-rated budget for a (start, end) request over a set
 * of fiscal-week budgets. Each overlapped week contributes
 * `week_budget * days_in_range / 7`, summed.
 *
 * @param {object} args
 * @param {string} args.startISO   inclusive
 * @param {string} args.endISO     inclusive
 * @param {Array<{week_start: string, amount: number}>} args.weekBudgets
 *   the same shape route.js already computes via buildWeekBudgets
 * @returns {{
 *   periods: Array<{week_start: string, week_end: string,
 *                   days_in_week: 7, days_in_range: number,
 *                   week_budget: number, budget_slice: number}>,
 *   total: number,
 *   label: string | null,
 * }}
 */
export function proRateBudget({ startISO, endISO, weekBudgets }) {
  // Compute each slice at full FP precision + track un-rounded.
  // Total = rounded sum of unrounded slices (the load-bearing
  // number - what the actual reconciles against). Individual slices
  // are then redistributed via largest-remainder so sum(slices) ==
  // total EXACTLY, same principle as the weekly derive's
  // integer-cent LRM (see src/lib/labor/deriveActuals.js). This
  // keeps internal consistency between the total and any per-week
  // detail readout.
  const raw = [];
  let totalUnrounded = 0;
  for (const wb of (weekBudgets || [])) {
    const wStart = wb.week_start;
    const wEnd   = addDaysISO(wStart, 6);
    const oStart = wStart > startISO ? wStart : startISO;
    const oEnd   = wEnd   < endISO   ? wEnd   : endISO;
    if (oStart > oEnd) continue;
    const daysInRange = Math.round(
      (parseISO(oEnd).getTime() - parseISO(oStart).getTime()) / MS_PER_DAY,
    ) + 1;
    const weekBudget = Number(wb.amount) || 0;
    const sliceUnrounded = weekBudget * daysInRange / 7;
    totalUnrounded += sliceUnrounded;
    raw.push({ wStart, wEnd, daysInRange, weekBudget, sliceUnrounded });
  }
  const totalCents = Math.round(totalUnrounded * 100);
  // LRM: floor each slice to cents, distribute residual to largest
  // remainders. Deterministic tiebreak by index.
  const buckets = raw.map((r, i) => ({
    i,
    floorCents: Math.floor(r.sliceUnrounded * 100),
    remainder: (r.sliceUnrounded * 100) - Math.floor(r.sliceUnrounded * 100),
  }));
  let residual = totalCents - buckets.reduce((s, b) => s + b.floorCents, 0);
  if (residual > 0) {
    buckets.sort((a, b) => b.remainder - a.remainder || a.i - b.i);
    for (let i = 0; i < residual; i++) buckets[i].floorCents++;
  } else if (residual < 0) {
    buckets.sort((a, b) => a.remainder - b.remainder || a.i - b.i);
    for (let i = 0; i < -residual; i++) buckets[i].floorCents--;
  }
  const finalCentsByIndex = new Map(buckets.map(b => [b.i, b.floorCents]));
  const overlapped = raw.map((r, i) => ({
    week_start: r.wStart,
    week_end:   r.wEnd,
    days_in_week: 7,
    days_in_range: r.daysInRange,
    week_budget: r2(r.weekBudget),
    budget_slice: finalCentsByIndex.get(i) / 100,
  }));
  const label = labelFor(overlapped);
  return { periods: overlapped, total: totalCents / 100, label };
}

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function labelFor(overlapped) {
  if (overlapped.length === 0) return null;
  // Single overlapped week that is not a full 7-day slice.
  if (overlapped.length === 1) {
    const p = overlapped[0];
    if (p.days_in_range === 7) return null;   // whole week - un-labeled
    return `pro-rated, ${p.days_in_range} of 7 days of wk ${fmtMMDD(p.week_start)}`;
  }
  // Multi-week partial. Sum of overlapped days.
  const totalDays = overlapped.reduce((s, p) => s + p.days_in_range, 0);
  return `pro-rated across ${totalDays} days`;
}
