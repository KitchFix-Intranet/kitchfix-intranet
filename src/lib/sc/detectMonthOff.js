// ═══════════════════════════════════════════════════════════════════
// detectMonthOff - the single "is this month off" predicate.
// 2026-09-08.
// ═══════════════════════════════════════════════════════════════════
//
// Ships as the ONE implementation both surfaces call:
//   season/MonthCard.js       - the calendar-grid month tile
//   v2/overviewDerive.js      - the season list rail row
//
// Prior state: each surface carried its own predicate. MonthCard's
// used a category-branching rule that checked sc_homestand_schedule
// for MLB fee + AAA MiLB accounts. overviewDerive's was a category-
// blind revenue/covers check. They disagreed on 40 (account, month)
// pairs out of 132 in the FY2026 scan - roughly 1 in 3 - all going
// the same direction: MonthCard rendered as OFF (quiet card) months
// that SeasonRail correctly showed as IN-SERVICE.
//
// Root cause of the MonthCard bug: `detectNoService` short-circuited
// on `hs.gameDays === 0 && hs.prepDays === 0` for homestand accounts.
// sc_homestand_schedule is populated month-by-month as home games get
// scheduled; future months (and CIN-KY / TBJ-NY, which source their
// homestand from a different place) show gameDays=0 EVEN WHEN the
// account has real projections and real actuals. The worst case was
// CIN-KY April 2026: $27K actual revenue, 1,140 covers served, 11
// days of real service - rendered as OFF (quiet card, no numbers)
// because sc_homestand_schedule showed zero games that month.
//
// ─── The rule ─────────────────────────────────────────────────────
//
//   A schedule is a plan; revenue and covers are facts. A month
//   with actuals is a month that happened, regardless of what any
//   schedule says.
//
// A month is OFF only when there is no service data of any kind - no
// revenue on either side, no covers on either side. Four checks,
// all about SERVICE (not the calendar - every real month has days).
//
// ─── What this rule does NOT check ────────────────────────────────
//
//   - totalDays / calendar days. Every real month has 28-31 days;
//     that's a calendar property, not a service signal.
//   - homestand schedule. The bug this ships to fix.
//   - account category flags (isFee / isMilb / hasHomestandSchedule).
//     Category-blind by design - the same "was there service" answer
//     serves every account shape.

/**
 * Is a month "off" (no service to display)?
 *
 * @param {object|null|undefined} monthSummary Aggregated month
 *   totals. Both callers pre-aggregate before calling; the predicate
 *   works on totals, never on raw day arrays. Fields consulted:
 *   `projectedRevenue`, `actualRevenue`, `projectedCovers`,
 *   `actualCovers` (all Number-coerced with 0 fallback).
 * @returns {boolean} true when the month should render as OFF.
 */
export function detectMonthOff(monthSummary) {
  if (!monthSummary) return true;
  const projRev    = Number(monthSummary.projectedRevenue) || 0;
  const actRev     = Number(monthSummary.actualRevenue)    || 0;
  const projCovers = Number(monthSummary.projectedCovers)  || 0;
  const actCovers  = Number(monthSummary.actualCovers)     || 0;
  return projRev === 0 && actRev === 0 && projCovers === 0 && actCovers === 0;
}
