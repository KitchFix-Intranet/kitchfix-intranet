// src/lib/kpi/rangeSnap.js
//
// Cross-board range-alignment guard (Kevin, 2026-09-02).
//
// Rule shipped in the "retire custom and rolling ranges" PR: every
// range the KPI platform resolves must be either FYTD or aligned to
// fiscal-period boundaries. A range that partly overlaps a closed
// period reports revenue at period grain (pnl_actuals is period-
// grain) while labor + purchasing count in-range days - the two-
// horizon defect that produced 65.7% gross margin on TBR - FL for
// 08/03-08/30.
//
// This helper is the ONE place that decides:
//   - "is (start, end) aligned to period boundaries?"
//   - "what do we snap it to when it is not?"
//
// All three routes (Overview, Labor, Purchasing) call this after
// reading the URL and before touching data. The client is the front
// door; this is the load-bearing gate.
//
// Snap policy (from the prompt):
//   "A URL carrying start/end that do not match a period boundary or
//    FYTD resolves to the period containing `end`, and the chip
//    names what happened."
//
// A range is considered aligned iff:
//   1. (start, end) == FY_START, today            -> FYTD
//   2. start == periodStartISO(A) AND end == periodEndISO(B)
//      for some A, B in [1..13] with A <= B       -> single or multi-period
//
// Otherwise: snap to the fiscal period containing `end`. Non-fiscal
// bounds outside FY26 are clamped to the containing period at the
// boundary (e.g., end > FY_END_ISO snaps to P13).
//
// Response shape:
//   {
//     start, end,                    // resolved boundaries (post-snap)
//     kind: "fytd" | "period" | "periods",
//     period_no: number | null,      // set on single-period
//     start_period_no: number | null,// set on multi-period
//     end_period_no: number | null,  // set on multi-period
//     snapped: boolean,
//     snapped_from: null | { start, end }  // original when snapped
//   }

import {
  FY_START_ISO,
  FY_END_ISO,
  periodStartISO,
  periodEndISO,
} from "@/app/kpi/labor/lib/periods";

const PERIODS = Array.from({ length: 13 }, (_, i) => i + 1);

// Which period contains an arbitrary ISO date. Returns null if the
// date is outside FY26 boundaries.
export function periodContainingDate(iso) {
  if (!iso) return null;
  for (const p of PERIODS) {
    const s = periodStartISO(p);
    const e = periodEndISO(p);
    if (s && e && iso >= s && iso <= e) return p;
  }
  // Outside FY: clamp to end period if too late, first if too early.
  if (iso < FY_START_ISO) return 1;
  if (iso > FY_END_ISO) return 13;
  return null;
}

// Match a start ISO to a period_no whose start equals it (exact).
function periodStartingAt(iso) {
  for (const p of PERIODS) if (periodStartISO(p) === iso) return p;
  return null;
}
// Match an end ISO to a period_no whose end equals it (exact).
function periodEndingAt(iso) {
  for (const p of PERIODS) if (periodEndISO(p) === iso) return p;
  return null;
}

/**
 * Resolve a URL-supplied (start, end) pair to an aligned range,
 * snapping when necessary. `today` is required to distinguish
 * "FYTD" (FY_START to today) from an aligned multi-period range
 * that happens to end today.
 *
 * @param {string} start   ISO YYYY-MM-DD
 * @param {string} end     ISO YYYY-MM-DD
 * @param {string} today   ISO YYYY-MM-DD (request date)
 * @returns {object}       shape per file-header comment
 */
export function snapRange(start, end, today) {
  if (!start || !end) {
    // Empty inputs default to FYTD - matches labor's + purchasing's
    // prior URL-fallback behavior.
    return {
      start: FY_START_ISO, end: today,
      kind: "fytd", period_no: null,
      start_period_no: null, end_period_no: null,
      snapped: false, snapped_from: null,
    };
  }

  // 1. FYTD: FY_START to today exactly. This is the ONE non-period
  // aligned range that survives the retirement.
  if (start === FY_START_ISO && end === today) {
    return {
      start, end,
      kind: "fytd", period_no: null,
      start_period_no: null, end_period_no: null,
      snapped: false, snapped_from: null,
    };
  }

  // 2. Aligned to period boundaries. Start must match SOME period's
  // start; end must match SOME period's end; start_period <= end_period.
  const startP = periodStartingAt(start);
  const endP = periodEndingAt(end);
  if (startP != null && endP != null && startP <= endP) {
    if (startP === endP) {
      return {
        start, end,
        kind: "period", period_no: startP,
        start_period_no: startP, end_period_no: endP,
        snapped: false, snapped_from: null,
      };
    }
    return {
      start, end,
      kind: "periods", period_no: null,
      start_period_no: startP, end_period_no: endP,
      snapped: false, snapped_from: null,
    };
  }

  // 3. Snap to the period containing `end` (per Kevin's rule 4).
  // This makes a bookmarked custom URL land on a plausible period
  // rather than a blank board or (worse) a computed grain-mismatch.
  const p = periodContainingDate(end) || periodContainingDate(start) || 1;
  return {
    start: periodStartISO(p),
    end: periodEndISO(p),
    kind: "period", period_no: p,
    start_period_no: p, end_period_no: p,
    snapped: true,
    snapped_from: { start, end },
  };
}
