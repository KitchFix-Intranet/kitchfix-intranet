// src/lib/kpi/classifyTier.js
//
// Tier classifier shared by KPI trackers (labor + purchasing). Called
// with the number of fiscal WEEKS in the range; returns:
//   'A' -> THE PERIOD  WEEK BY WEEK   (<= 6 weeks)
//   'B' -> THE RANGE   WEEK BY WEEK   (<= 13 weeks)
//   'C' -> THE RANGE   PERIOD BY PERIOD (>= 14 weeks)
//
// Owner ruling 2026-08-24 (PR 2 R3 Part B): the labor board has always
// used these boundaries; purchasing was silently truncating longer
// ranges to a four-slot strip and mislabeling ordinals. Lifting the
// classifier here means one source of truth across trackers - importing
// from a labor COMPONENT was worse than importing from a labor lib, so
// this lives under src/lib/kpi. Labor imports from here.
//
// The function is deliberately terse and dependency-free so any caller
// can use it in a client component or a route handler.

export function classifyTier(weekCount) {
  if (weekCount <= 6) return "A";
  if (weekCount <= 13) return "B";
  return "C";
}
