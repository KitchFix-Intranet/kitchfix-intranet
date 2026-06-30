// MLB parent-club season phases for the homestand-fee accounts
// (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V). These render as grey-italic
// LABELS on the month + period cards - they are NOT the PDC phase-tint
// system (CANONICAL_PHASES / derivePhaseTimeline). MLB carries only
// three coarse off-field phases; the regular season shows the
// game-days / homestands footer instead of a phase label.
//
// Month labels use the explicit month -> phase map (February reads
// "Spring Training" even though ST starts Feb 20; October reads
// "Post Season"). Period labels use the date windows against the
// period-range midpoint, since a period is a ~28-day range that can
// straddle a window edge.

// Spring Training: Feb 20 - Mar 24. Post Season: Sep 29 - Oct 31.
const ST_WINDOW = { startMonth: 2, startDay: 20, endMonth: 3, endDay: 24 };
const PS_WINDOW = { startMonth: 9, startDay: 29, endMonth: 10, endDay: 31 };

// monthIndex: 0 = January ... 11 = December.
export function mlbMonthPhaseLabel(monthIndex) {
  switch (monthIndex) {
    case 0:   // January
    case 10:  // November
    case 11:  // December
      return "Off-season";
    case 1:   // February
      return "Spring Training";
    case 9:   // October
      return "Post Season";
    default:  // March - September: regular season, no label
      return null;
  }
}

// periodRange: { period, start: "YYYY-MM-DD", end: "YYYY-MM-DD" }.
export function mlbPeriodPhaseLabel(periodRange) {
  if (!periodRange?.start || !periodRange?.end) return null;
  const start = Date.parse(`${periodRange.start}T00:00:00Z`);
  const end = Date.parse(`${periodRange.end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const mid = new Date((start + end) / 2);
  const month = mid.getUTCMonth() + 1; // 1 - 12
  const day = mid.getUTCDate();

  if (inWindow(month, day, ST_WINDOW)) return "Spring Training";
  if (inWindow(month, day, PS_WINDOW)) return "Post Season";
  // Off-season wraps the year end: Nov 1 - Feb 19.
  if (month === 11 || month === 12 || month === 1 || (month === 2 && day <= 19)) {
    return "Off-season";
  }
  return null; // regular season (Mar 25 - Sep 28)
}

function inWindow(month, day, w) {
  const onOrAfterStart = month > w.startMonth || (month === w.startMonth && day >= w.startDay);
  const onOrBeforeEnd = month < w.endMonth || (month === w.endMonth && day <= w.endDay);
  return onOrAfterStart && onOrBeforeEnd;
}
