// Homestand derivation - the SeasonStepper's data source.
//
// PURE function. No React, no fetches, no engine call. Reads the
// per-month per-day records from sc-year-summary's response shape
// (each day carries homestandId / opponent / dayType for the 4 MLB-fee
// accounts; the dataStore writes those onto the day records server-
// side in serviceCalendar.js loadYearSummary). Groups by homestandId
// across the entire year, ordering by start date, and emits the
// stepper's input shape:
//
//   [
//     {
//       homestandId,                  // "HS1"
//       opponents: ["ARI", "MIA"],    // deduped, ordered by date
//       startDate: "2026-06-22",
//       endDate:   "2026-06-28",
//       gameCount: 7,                 // GAME day_type rows
//       gameEntered: 4,               // GAME with status === "entered"
//       dayTypes: { GAME: 7, PREP: 0, ... },
//       status: "done" | "now" | "next",
//     },
//     ...
//   ]
//
// status rules (matching the audit non-negotiable: missing/zero/now
// must be distinguishable):
//   "done"  - endDate <  today
//   "now"   - startDate <= today <= endDate
//   "next"  - startDate >  today
//
// No engine touch. Same pattern as the #275 client-side merge.

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Sortable homestand-id key. HS1, HS2, ..., HS13 should sort numerically,
// not lexicographically ("HS10" must come AFTER "HS9", not between HS1
// and HS2).
function hsKey(id) {
  if (!id) return Infinity;
  const n = parseInt(String(id).replace(/^HS/i, ""), 10);
  return Number.isFinite(n) ? n : Infinity;
}

export function deriveHomestandSegments(yearData, todayDate) {
  if (!yearData || !Array.isArray(yearData)) return [];
  // Pass 1: bucket per-day records by homestandId.
  const buckets = new Map();
  for (const month of yearData) {
    if (!month?.days) continue;
    for (const d of month.days) {
      if (!d.homestandId) continue;
      let bucket = buckets.get(d.homestandId);
      if (!bucket) {
        bucket = {
          homestandId: d.homestandId,
          dates: [],
          opponents: [],
          opponentSet: new Set(),
          dayTypes: {},
          gameCount: 0,
          gameEntered: 0,
        };
        buckets.set(d.homestandId, bucket);
      }
      bucket.dates.push(d.date);
      if (d.dayType) {
        bucket.dayTypes[d.dayType] = (bucket.dayTypes[d.dayType] || 0) + 1;
        if (d.dayType === "GAME") {
          bucket.gameCount += 1;
          if (d.status === "entered") bucket.gameEntered += 1;
        }
      }
      if (d.opponent && d.dayType === "GAME") {
        if (!bucket.opponentSet.has(d.opponent)) {
          bucket.opponentSet.add(d.opponent);
          bucket.opponents.push(d.opponent);
        }
      }
    }
  }

  // Pass 2: finalize each segment with status + date range.
  const segments = [];
  for (const bucket of buckets.values()) {
    if (bucket.dates.length === 0) continue;
    bucket.dates.sort();
    const startDate = bucket.dates[0];
    const endDate   = bucket.dates[bucket.dates.length - 1];
    let status = "next";
    if (todayDate) {
      if (endDate < todayDate) status = "done";
      else if (startDate <= todayDate && todayDate <= endDate) status = "now";
    } else {
      status = "next";
    }
    segments.push({
      homestandId: bucket.homestandId,
      opponents: bucket.opponents,
      startDate,
      endDate,
      gameCount: bucket.gameCount,
      gameEntered: bucket.gameEntered,
      dayTypes: bucket.dayTypes,
      status,
    });
  }

  // Order by start date (homestand_id usually correlates but defensive).
  segments.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    return hsKey(a.homestandId) - hsKey(b.homestandId);
  });

  return segments;
}

// Returns the current (status === "now") segment, or - if none -
// the next upcoming. Used by the stepper caption and the spotlight.
export function pickFocusSegment(segments) {
  if (!segments?.length) return null;
  const now = segments.find((s) => s.status === "now");
  if (now) return { segment: now, kind: "now" };
  const next = segments.find((s) => s.status === "next");
  if (next) return { segment: next, kind: "next" };
  const done = [...segments].reverse().find((s) => s.status === "done");
  if (done) return { segment: done, kind: "done" };
  return null;
}

// "Jun 22 - Jun 28" / "Jun 28 - Jul 5" - the date-range caption used
// by the stepper + spotlight. Returns "Jun 28" alone when the range
// is a single day.
export function formatHomestandRange(startDate, endDate) {
  if (!startDate) return "";
  const s = new Date(startDate + "T12:00:00");
  const startLabel = `${MON_SHORT[s.getMonth()]} ${s.getDate()}`;
  if (!endDate || endDate === startDate) return startLabel;
  const e = new Date(endDate + "T12:00:00");
  const endLabel =
    e.getMonth() === s.getMonth()
      ? `${e.getDate()}`
      : `${MON_SHORT[e.getMonth()]} ${e.getDate()}`;
  return `${startLabel} - ${endLabel}`;
}
