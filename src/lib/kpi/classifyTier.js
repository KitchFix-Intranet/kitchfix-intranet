// src/lib/kpi/classifyTier.js
//
// Tier classifier shared by KPI trackers (labor + purchasing). Called
// with the number of fiscal WEEKS in the range; returns:
//   'A' -> THE PERIOD  WEEK BY WEEK    (<= 6 weeks)
//   'B' -> THE RANGE   WEEK BY WEEK    (<= bWeekMax)
//   'C' -> THE RANGE   PERIOD BY PERIOD (>  bWeekMax)
//
// Owner ruling 2026-08-24 (PR 2 R3 Part B): the labor board has always
// used these boundaries; purchasing was silently truncating longer
// ranges to a four-slot strip and mislabeling ordinals. Lifting the
// classifier here means one source of truth across trackers - importing
// from a labor COMPONENT was worse than importing from a labor lib, so
// this lives under src/lib/kpi. Labor imports from here.
//
// PR-2 R11 item 6b (owner ruling 2026-08-25): purchasing switches to
// period-bars at 10 weeks instead of 14. A 13-week strip of one-bar-
// per-week is thirteen 15-20px bars with captions that overlap - the
// bars are already unreadable long before they scroll. Adding an
// optional `bWeekMax` argument (default 13, labor's existing boundary)
// lets purchasing pass 9 without changing labor's behaviour. Any
// unupdated call site keeps the labor-classic boundary.
//
// The function is deliberately terse and dependency-free so any caller
// can use it in a client component or a route handler.

export function classifyTier(weekCount, bWeekMax = 13) {
  if (weekCount <= 6) return "A";
  if (weekCount <= bWeekMax) return "B";
  return "C";
}
