// Actionable-day predicates for the "X of Y entered" counters
// (Kevin's ruling, design review 2026-07-11).
//
// PROBLEM (pre-fix):
//   Numerator = days with status IN {entered, no-service}.
//   Denominator = ALL days in the range.
//   -> an untouched future month showed "5 of 31 entered" (16%) because
//      5 Sundays auto-classified as no-service inflated the numerator,
//      and the denominator counted AWAY / EXHIBITION / off-season days
//      that the operator was never expected to touch.
//
// RULING (locked 2026-07-11):
//   Both numerator and denominator count ACTIONABLE days only.
//   Actionable = the operator is expected to record actuals here.
//     Numerator   = actionable days with actuals recorded (status="entered").
//     Denominator = all actionable days in the range.
//
//   Non-actionable statuses (excluded from BOTH):
//     - no-service   auto or manual off day, nothing to enter
//     - off-season   outside the operational arc
//     - away         team on the road (schedule accounts, incl. MiLB
//                    post-sc-16 where CIN-KY / TBJ-NY have real AWAY rows)
//     - exhibition   billed as separate catering, outside the contract
//     - prep         fee-account non-game homestand day (PREP/OPEN/CLOSE/CLEAN)
//
// EXPECTED READINGS:
//   Untouched per-meal month (5 no-service Sundays, 26 future service days):
//     was: "5 of 31 entered", 16%
//     now: "0 of 26 entered",  0%
//
//   MLB month with 12 game days entered + 15 away + 4 exhibition:
//     was: "12 of 31 entered", ~39%
//     now: "12 of 12 entered", 100%
//
//   Fully-entered past month:
//     was: "N of N entered", 100%
//     now: "N of N entered", 100%    (unchanged)
//
// This helper is the SINGLE aggregation-layer source of truth. Every
// consumer (MonthCard, PeriodCard, yearBannerStats, FullSeasonCard)
// reads through these functions - no per-label patching.

const NON_ACTIONABLE_STATUSES = new Set([
  "no-service",
  "off-season",
  "away",
  "exhibition",
  "prep",
]);

// True when the day requires operator entry (or has already received it).
// Days without a status field (loading / failed / undefined) do NOT
// count as actionable - the counter should not race ahead of the fetch.
export function isActionableDay(day) {
  if (!day || !day.status) return false;
  return !NON_ACTIONABLE_STATUSES.has(day.status);
}

// Denominator: actionable days in the range.
export function countActionableDays(days) {
  if (!Array.isArray(days)) return 0;
  let n = 0;
  for (const d of days) if (isActionableDay(d)) n++;
  return n;
}

// Numerator: actionable days that carry recorded actuals.
// Kevin's ruling excludes no-service from the numerator (was previously
// widened to include it via P1 item 4 - that rule is superseded here).
// A day only counts as "entered" now if the operator actually saved
// actuals to it. Fee accounts don't emit no-service; the change is a
// no-op for them numerically.
export function countEnteredActionable(days) {
  if (!Array.isArray(days)) return 0;
  let n = 0;
  for (const d of days) if (d?.status === "entered") n++;
  return n;
}

// Zero-actionable-day edge case guard. Used by consumers that render a
// percent (denominator = 0 would divide by zero). Also useful for
// choosing between the normal counter and a neutral / off-season
// treatment when the entire range is non-actionable.
export function hasNoActionableDays(days) {
  return countActionableDays(days) === 0;
}
