// Homestand derivation - the SeasonStepper's data source.
//
// M-0 (2026-08-04): derivation switched from grouping by
// `sc_homestand_schedule.homestand_id` (vestigial - seeded from a
// deprecated sheet before the MLB Stats API load and never refreshed;
// STL-MO's stored HS8 spans 32 days because a June 25 game was
// postponed to July 23 and the tag travelled with it) to grouping
// GAME rows into maximal runs split by AWAY rows. The stored column
// stops being read; it is NOT dropped or backfilled (Phase 5 work).
//
// MLB-only. The set at DERIVE_HOMESTANDS_ACCOUNTS below carries the
// four accounts whose (a) MLB Stats API load populates full GAME +
// AWAY coverage and (b) `has_homestand_schedule=true`. Non-MLB
// accounts return [] - the SAME output the pre-M-0 derivation gave
// them (CIN-KY and TBJ-NY carry empty stored homestand_id and were
// already receiving []; STL-FL and TBJ-FL never mount this code
// through their outer gates). MiLB AAA homestand rendering is
// tracked as a separate design decision on its own merits.
//
// PURE function. No React, no fetches, no engine call. Reads the
// per-month per-day records from sc-year-summary's response shape
// (each day carries dayType / opponent / status for the 4 MLB-fee
// accounts; the dataStore writes those onto the day records server-
// side in serviceCalendar.js loadYearSummary). Groups GAME rows into
// blocks by walking the date-ordered stream and closing a block on
// any AWAY row. Emits the stepper's input shape:
//
//   [
//     {
//       homestandId,                  // "HS1" - DERIVED ordinal label
//       key,                          // stable key: first game's
//                                     // gamePk, else its date
//       opponents: ["ARI", "MIA"],    // deduped, ordered by first
//                                     // appearance
//       startDate: "2026-06-22",
//       endDate:   "2026-06-28",
//       gameCount: 6,                 // GAME rows in the block
//       gameEntered: 4,               // GAME with status === "entered"
//       meals: N,                     // sum of GAME actualMeals
//       dayTypes: { GAME: 6 },        // day-type census (GAME only
//                                     // under M-0; PREP/OPEN/CLOSE
//                                     // rows do not live in PG post-
//                                     // sc-13, so the census carries
//                                     // GAME only)
//       status: "done" | "now" | "next",
//     },
//     ...
//   ]
//
// status rules (unchanged from pre-M-0):
//   "done"  - endDate <  today
//   "now"   - startDate <= today <= endDate
//   "next"  - startDate >  today
//
// Self-guard: without an AWAY row in the stream there is no split
// signal - return []. Without enough games or too many days in a
// derived block, the coverage has degraded (AWAY rows missing or
// EXHIBITION mistagged) - return [] for the WHOLE account, not a
// partial result. A surface showing nothing is honest; a surface
// showing one six-month homestand is a lie. Warnings fire under
// NODE_ENV !== "production" so silent refusal gets caught fast.

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// M-0 gate. Explicit set (ENTRY_V2_ACCOUNTS-style curation) rather
// than a `level==="MLB"` predicate: the derivation's correctness
// depends on complete GAME + AWAY coverage from the MLB Stats API,
// and any future account promoted to MLB level would need to prove
// AWAY coverage before it is safe to derive here. Adding an entry
// is a deliberate code edit, not an accidental effect of an
// accounts-table update.
export const DERIVE_HOMESTANDS_ACCOUNTS = new Set([
  "CIN - OH",
  "STL - MO",
  "TXR - TX - H",
  "TXR - TX - V",
]);

// Sanity thresholds. Reasoning (from probe data, 2026 season):
//   - Max span 14 days. Empirical max across the 4 MLB accounts is
//     11 days (STL-MO HS6, CIN-OH HS10). A ceiling of 14 leaves
//     headroom for a legitimately-long homestand while catching the
//     failure mode (32-day stale-tag block, or AWAY rows silently
//     absent).
//   - Min 3 games. Empirical min is 3 (STL-MO HS3, HS7; CIN-OH HS5,
//     HS8; TXR-TX-H HS5, TXR-TX-V HS5). Anything shorter is either
//     a mid-homestand postponement mistagged, or a coverage gap.
const MAX_BLOCK_DAYS = 14;
const MIN_BLOCK_GAMES = 3;

function isDev() {
  return typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
}

function warn(msg) {
  if (!isDev()) return;
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function spanInclusiveDays(startISO, endISO) {
  const a = new Date(startISO + "T00:00:00");
  const b = new Date(endISO + "T00:00:00");
  return Math.round((b - a) / 86400000) + 1;
}

export function deriveHomestandSegments(yearData, todayDate, opts = {}) {
  const { accountKey } = opts;
  // MLB-only gate. Non-MLB accounts fall through to []; matches the
  // pre-M-0 behavior for CIN-KY / TBJ-NY (empty stored ids ->
  // homestandDerivation already returned []).
  if (!accountKey || !DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) return [];
  if (!yearData || !Array.isArray(yearData)) return [];

  // Flatten yearData into a single date-sorted GAME|AWAY stream.
  // EXHIBITION rows are excluded from blocks entirely per owner
  // ruling (separately-billed catering, calendar display only).
  const stream = [];
  for (const month of yearData) {
    if (!month?.days) continue;
    for (const d of month.days) {
      if (d.dayType === "GAME" || d.dayType === "AWAY") stream.push(d);
    }
  }
  stream.sort((a, b) => a.date.localeCompare(b.date));

  // Self-guard 1: without AWAY there is no split signal. Empty rather
  // than emit one giant block.
  const hasAnyAway = stream.some(d => d.dayType === "AWAY");
  if (!hasAnyAway) {
    warn(`[homestandDerivation] ${accountKey}: no AWAY rows in yearData - returning [] (no split signal)`);
    return [];
  }

  // Walk the stream: a block is a maximal run of GAME days bounded
  // by AWAY (or by the ends of the stream).
  const rawBlocks = [];
  let curr = null;
  for (const d of stream) {
    if (d.dayType === "GAME") {
      if (!curr) curr = { games: [] };
      curr.games.push(d);
    } else {
      if (curr) { rawBlocks.push(curr); curr = null; }
    }
  }
  if (curr) rawBlocks.push(curr);

  // Format + enforce sanity. Fail HARD (whole account -> []) if any
  // block trips the guard: a partial result would look plausible
  // and mislead. Sort by first-game date; assign ordinal labels
  // HS1..HSN AFTER the sort so labels line up with date order.
  const blocks = [];
  for (const rb of rawBlocks) {
    const dates = rb.games.map(g => g.date);
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    const gameCount = rb.games.length;
    const spanDays = spanInclusiveDays(startDate, endDate);
    if (spanDays > MAX_BLOCK_DAYS || gameCount < MIN_BLOCK_GAMES) {
      warn(`[homestandDerivation] ${accountKey}: block sanity fail (span=${spanDays}d, games=${gameCount}, ${startDate}..${endDate}) - returning [] for the whole account`);
      return [];
    }
    const opponents = [];
    const oppSet = new Set();
    let gameEntered = 0;
    let meals = 0;
    for (const g of rb.games) {
      if (g.opponent && !oppSet.has(g.opponent)) {
        oppSet.add(g.opponent);
        opponents.push(g.opponent);
      }
      if (g.status === "entered") gameEntered += 1;
      if (g.actualMeals != null) meals += Number(g.actualMeals) || 0;
    }
    let status = "next";
    if (todayDate) {
      if (endDate < todayDate) status = "done";
      else if (startDate <= todayDate && todayDate <= endDate) status = "now";
    }
    blocks.push({
      // Stable key: first game's gamePk if the loader emitted it,
      // else the block's startDate. NEVER an ordinal - ordinals
      // shift on schedule changes, keys must not.
      key: rb.games[0].gamePk || startDate,
      opponents,
      startDate,
      endDate,
      gameCount,
      gameEntered,
      meals,
      dayTypes: { GAME: gameCount },
      status,
    });
  }

  blocks.sort((a, b) => a.startDate.localeCompare(b.startDate));
  // Derived ordinal label. Consumers displaying "HS10" continue to
  // work; the number is now the block's position in the date-ordered
  // list rather than a stored column.
  blocks.forEach((b, i) => { b.homestandId = `HS${i + 1}`; });
  return blocks;
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
