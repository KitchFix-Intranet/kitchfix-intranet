// src/app/kpi/labor/lib/rangeLabel.js
//
// Range PR-2 (multi-select ranges). Owner ruling 2026-08-24: the
// range chip labels the SELECTION - "P1 - P3", "July 2026",
// "Jan - Apr 2026" - not the resolved date range. An operator who
// picks a month and sees dates cannot tell whether they got the
// month they asked for.
//
// URL contract: `?start` and `?end` stay authoritative. `?label` is
// an OPTIONAL display hint. If the label does not resolve back to
// the same (start, end) it names, the chip renders the date range.
// A label that lies is worse than no label.
//
// URL serialization (unambiguous over pretty; nobody reads these):
//   P<n>            single period, e.g. P3
//   P<n>-P<m>       multi-period, e.g. P1-P3
//   <YYYY>-<MM>     single fiscal month, e.g. 2026-07
//   <YYYY>-<MM>_<YYYY>-<MM>   multi-month, e.g. 2026-01_2026-04
//                             (underscore separator so 2026-01-2026-04
//                              cannot be misparsed as a period range)
//
// Display formatting:
//   period single   "PERIOD 3"          (matches pre-PR-2 shape)
//   period multi    "P1 - P3"
//   month single    "July 2026"         (full month name)
//   month multi     "Jan - Apr 2026"    (same year: year on end only)
//                   "Nov 2026 - Feb 2027" (cross-year: year on both;
//                                          FY2026 straddles calendar
//                                          years so this is not
//                                          hypothetical - FY starts
//                                          2025-12-29)

// Range PR-2 follow-up 2026-08-24: month labels resolve to CALENDAR
// month (rangeForCalendarMonth) not fiscal month. Aligns the label
// semantics with PR-1's "calendar months are exact" promise so a
// picker click AND a hand-crafted URL both round-trip through
// validateLabel. See rangeForCalendarMonth for the FY clamp.
//
// Range selector redesign 2026-09-03 (Kevin ruling): multi-period
// selection retired. The client no longer emits `kind: "periods"`;
// the P1-P3 shift-click path is gone. `parseLabel` still recognises
// legacy `P1-P3` URLs and REJECTS them (returns null) so the server
// snap-or-refuse path handles stale bookmarks. `formatSelection` +
// `serializeSelection` no longer carry a periods branch. Server-side
// `rng.kind === "periods"` handling in the resolver stays defensive
// for anything the range-snap module still emits.
import { rangeForPeriod, rangeForCalendarMonth } from "./periods.js";

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parse a URL label string into a structured selection.
 * Returns null if the label does not match any known shape.
 *
 * Redesign 2026-09-03: multi-period `P1-P3` shape is intentionally
 * NOT recognised. Legacy URLs carrying it fall through to null and
 * the server's range-snap path decides what the range resolves to.
 *
 * @param {string|null|undefined} label
 * @returns {null | {kind: "period", value: number}
 *              | {kind: "month", value: {year: number, monthIndex: number}}
 *              | {kind: "months", start: {year, monthIndex}, end: {year, monthIndex}}}
 */
export function parseLabel(label) {
  if (!label || typeof label !== "string") return null;
  const s = label.trim();
  if (!s) return null;

  const mpSingle = s.match(/^P(\d{1,2})$/);
  if (mpSingle) {
    const n = parseInt(mpSingle[1], 10);
    if (n < 1 || n > 13) return null;
    return { kind: "period", value: n };
  }

  const mmMulti = s.match(/^(\d{4})-(\d{2})_(\d{4})-(\d{2})$/);
  if (mmMulti) {
    const start = { year: parseInt(mmMulti[1], 10), monthIndex: parseInt(mmMulti[2], 10) - 1 };
    const end = { year: parseInt(mmMulti[3], 10), monthIndex: parseInt(mmMulti[4], 10) - 1 };
    if (!validMonth(start) || !validMonth(end)) return null;
    // Order: end must be >= start.
    if (end.year < start.year || (end.year === start.year && end.monthIndex < start.monthIndex)) return null;
    if (start.year === end.year && start.monthIndex === end.monthIndex) {
      return { kind: "month", value: start };
    }
    return { kind: "months", start, end };
  }

  const mmSingle = s.match(/^(\d{4})-(\d{2})$/);
  if (mmSingle) {
    const value = { year: parseInt(mmSingle[1], 10), monthIndex: parseInt(mmSingle[2], 10) - 1 };
    if (!validMonth(value)) return null;
    return { kind: "month", value };
  }

  return null;
}
function validMonth(m) {
  return Number.isInteger(m.year) && m.year >= 2020 && m.year <= 2100
      && Number.isInteger(m.monthIndex) && m.monthIndex >= 0 && m.monthIndex <= 11;
}

/**
 * Given a parsed selection, resolve to a {startISO, endISO} range.
 * Returns null when any component cannot be resolved (e.g. a period
 * outside FY, a month with no fiscal weeks assigned).
 */
export function labelToRange(parsed) {
  if (!parsed) return null;
  if (parsed.kind === "period") return rangeForPeriod(parsed.value);
  if (parsed.kind === "month") {
    return rangeForCalendarMonth(parsed.value.year, parsed.value.monthIndex);
  }
  if (parsed.kind === "months") {
    const a = rangeForCalendarMonth(parsed.start.year, parsed.start.monthIndex);
    const b = rangeForCalendarMonth(parsed.end.year, parsed.end.monthIndex);
    if (!a || !b) return null;
    return { startISO: a.startISO, endISO: b.endISO };
  }
  return null;
}

/**
 * Validate a URL label against the actual (start, end). Returns the
 * parsed selection when the label resolves back to the same range,
 * else null. A URL that carries `?label=P1-P3` with dates that are
 * not P1-P3 gets null - caller falls back to the date range display.
 * The dates remain authoritative; the label is a hint.
 */
export function validateLabel(label, startISO, endISO) {
  const parsed = parseLabel(label);
  if (!parsed) return null;
  const range = labelToRange(parsed);
  if (!range) return null;
  if (range.startISO === startISO && range.endISO === endISO) return parsed;
  return null;
}

/**
 * Format a validated selection for display in the range chip.
 */
export function formatSelection(sel) {
  if (!sel) return null;
  if (sel.kind === "period") return `PERIOD ${sel.value}`;
  if (sel.kind === "month") {
    return `${MONTH_LONG[sel.value.monthIndex]} ${sel.value.year}`;
  }
  if (sel.kind === "months") {
    const { start, end } = sel;
    const startAbbr = MONTH_ABBR[start.monthIndex];
    const endAbbr = MONTH_ABBR[end.monthIndex];
    if (start.year === end.year) {
      return `${startAbbr} - ${endAbbr} ${start.year}`;
    }
    return `${startAbbr} ${start.year} - ${endAbbr} ${end.year}`;
  }
  return null;
}

/**
 * Serialize a selection back to the URL label form.
 */
export function serializeSelection(sel) {
  if (!sel) return null;
  if (sel.kind === "period") return `P${sel.value}`;
  if (sel.kind === "month") {
    const mm = String(sel.value.monthIndex + 1).padStart(2, "0");
    return `${sel.value.year}-${mm}`;
  }
  if (sel.kind === "months") {
    const s = sel.start, e = sel.end;
    const sm = String(s.monthIndex + 1).padStart(2, "0");
    const em = String(e.monthIndex + 1).padStart(2, "0");
    return `${s.year}-${sm}_${e.year}-${em}`;
  }
  return null;
}
