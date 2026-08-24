// src/lib/labor/rangeResolver.js
//
// PR-2 range resolver. ONE function that decides which grain the KPI
// labor route serves a given (start, end) request from. Kevin ruling
// 2026-08-20: one source per answer, never both. Cross-grain rollup
// artifacts (measured: 76/156 account-weeks drift ~0.5c each,
// $0.88 total, structural to 2dp vs 4dp storage) are why.
//
// Routing (grain first, era second)
// ──────────────────────────────────
//   Range aligns to whole fiscal weeks (any era, incl. spanning the
//   floor) -> weekly. Today's board, unchanged.
//
//   Range has a partial week AND is entirely at or after 2026-04-20
//   (the daily floor from labor_actuals.week_source='sc_day_metadata')
//   -> daily.
//
//   Range has a partial week AND starts before 2026-04-20
//   -> REFUSAL. Underlying weekly rows for the pre-floor era were
//      backfilled from a Rippling Excel report (totals-only, no
//      per-day segments, retention already passed for the segments
//      underneath). A partial-week answer at day grain there is
//      impossible; a partial-week answer at week grain would blend
//      grains and Kevin's rule forbids that. User-facing copy names
//      both ways out.
//
// This module is pure - no DB, no fetches. Callers (the labor route)
// hand it the resolved daily floor and range endpoints.

// Fiscal week starts land on a Monday (spec §periods.js: FY_START is
// 2025-12-29, a Monday). A range aligns to whole fiscal weeks iff its
// start is a Monday and its end is a Sunday (start + N*7 - 1 days,
// N >= 1).
function isFiscalWeekMonday(iso) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.getUTCDay() === 1;
}
function isFiscalWeekSunday(iso) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.getUTCDay() === 0;
}
function daysBetween(startISO, endISO) {
  const s = new Date(`${startISO}T00:00:00.000Z`).getTime();
  const e = new Date(`${endISO}T00:00:00.000Z`).getTime();
  return Math.round((e - s) / 86400000) + 1;   // inclusive
}

// Per spec: 1-31 day span is legal for daily grain. Longer ranges
// keep the existing week-grain board even if they include a partial
// week - matches the spec's "keep the existing week-grain board" cut
// for multi-period requests. We route those to weekly regardless of
// alignment.
//
// 2026-08-24: raised from 21 to 31. The original 21 came from an
// early "1 day to 3 weeks" spec, before calendar months were a
// requirement. A calendar month is 28-31 days, so at 21 every month
// silently widened to the whole-week board that STRADDLED it. Live
// symptom: July on CIN - OH returned $21,555.27 (weekly widening
// 06/29 - 08/02) when July actually cost $18,714.03. 15% overstate,
// with nothing on screen naming that the range moved.
//
// At 31, calendar months land inside the daily path and inherit
// exact per-day actuals + the pro-rated budget label + the
// width-derived day-strip density already built for the daily
// surface. Whole-week ranges keep routing to weekly (isWholeWeeks
// runs first at line 89), so nothing that already routed to weekly
// shifts paths.
export const MAX_DAILY_SPAN_DAYS = 31;

// User-facing refusal copy (kevin owner ruling 2026-08-20). The
// client renders this verbatim in the refusal state box.
export const REFUSAL_MESSAGE_PARTIAL_BEFORE_FLOOR = (floorISO) => {
  const [Y, M, D] = floorISO.split("-");
  const yy = Y.slice(2);
  return `Daily detail starts ${M}/${D}/${yy}. Pick a range on or after that date, or use whole weeks.`;
};

/**
 * Decide which grain answers a (start, end) request.
 *
 * @param {object} args
 * @param {string} args.startISO   inclusive start, YYYY-MM-DD
 * @param {string} args.endISO     inclusive end,   YYYY-MM-DD
 * @param {string} args.dailyFloorISO   min work_date the daily table can serve
 * @returns {{
 *   source:  'weekly' | 'daily' | null,
 *   reason:  string,
 *   isWholeWeeks: boolean,
 *   isPartialWeek: boolean,
 *   spanDays: number,
 *   refused: boolean,
 *   refusalMessage?: string,
 * }}
 */
export function resolveRangeSource({ startISO, endISO, dailyFloorISO }) {
  const spanDays = daysBetween(startISO, endISO);
  const startsOnMonday = isFiscalWeekMonday(startISO);
  const endsOnSunday   = isFiscalWeekSunday(endISO);
  const isWholeWeeks   = startsOnMonday && endsOnSunday && spanDays % 7 === 0 && spanDays > 0;
  const isPartialWeek  = !isWholeWeeks;

  // Grain first: whole-week ranges (any era, including spanning the
  // floor) route to weekly. Preserves the current board unchanged.
  if (isWholeWeeks) {
    return {
      source: "weekly",
      reason: "whole_weeks",
      isWholeWeeks: true,
      isPartialWeek: false,
      spanDays,
      refused: false,
    };
  }

  // Multi-period partial ranges route to weekly too - daily is
  // designed for 1..21 day spans per spec. Anything larger keeps the
  // legacy period-oriented board even with a partial week at the edge.
  if (spanDays > MAX_DAILY_SPAN_DAYS) {
    return {
      source: "weekly",
      reason: "span_exceeds_daily_max",
      isWholeWeeks: false,
      isPartialWeek: true,
      spanDays,
      refused: false,
    };
  }

  // Era second: partial-week + start >= floor -> daily.
  if (startISO >= dailyFloorISO) {
    return {
      source: "daily",
      reason: "partial_week_post_floor",
      isWholeWeeks: false,
      isPartialWeek: true,
      spanDays,
      refused: false,
    };
  }

  // Partial-week + start < floor -> refuse. Two ways out are named
  // in the message so the user does not have to guess.
  return {
    source: null,
    reason: "range_partial_before_floor",
    isWholeWeeks: false,
    isPartialWeek: true,
    spanDays,
    refused: true,
    refusalMessage: REFUSAL_MESSAGE_PARTIAL_BEFORE_FLOOR(dailyFloorISO),
  };
}
