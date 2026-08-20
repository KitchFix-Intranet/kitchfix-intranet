// src/lib/labor/customPickerGate.js
//
// PR-3a picker guard - pure predicate governing which calendar cells
// are selectable in RangeMenu's inline Custom picker. Kept as a pure
// function so scripts/_probe_daily_picker_guard.mjs can assert every
// interesting case (Monday/Sunday, non-boundary, too-short end) in
// Node without a jsdom render.
//
// The guard's job is to prevent the picker from emitting partial-week
// or pre-floor ranges until PR-3b lands the day strip + refusal panel
// that make those ranges legible. Whole-week ranges (start on Monday,
// end on the Sunday of that week or a later week's Sunday) route to
// the weekly branch on the server unchanged and render the normal
// board - so those cells stay selectable.
//
// Discipline
//   - no clamp, no snap: the predicate refuses invalid clicks; it
//     never silently rewrites the selection. Silent widening is the
//     failure mode this arc exists to remove.
//   - Custom stays enabled; only the invalid cells go grey.
//
// JS DOW convention: 0 = Sunday, 1 = Monday.

const MS_PER_DAY = 86400000;

/**
 * Should this calendar cell be selectable given the picker's current
 * staging state?
 *
 * @param {Date}    date            candidate cell (local-time Date)
 * @param {object}  staging
 * @param {Date|null} staging.customPending  first-click endpoint, awaiting a second
 * @param {{start:Date,end:Date}|null} staging.customStaged  both endpoints picked
 * @returns {boolean}
 */
export function isCustomCellSelectable(date, { customPending, customStaged }) {
  const dow = date.getDay();
  // Staging start: next click sets a fresh Monday. Two cases feed here:
  //   1. nothing picked yet (customPending null, customStaged null)
  //   2. both picked, next click resets to a new start (customStaged set)
  if (customStaged || !customPending) return dow === 1;
  // Staging end: next click sets a Sunday, AND that Sunday must be at
  // least six days after the pending start so the resulting range is
  // one full fiscal week (Monday-Sunday) or longer.
  if (dow !== 0) return false;
  const minEnd = new Date(customPending.getTime() + 6 * MS_PER_DAY);
  return date >= minEnd;
}
