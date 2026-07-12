// ══════════════════════════════════════════════════════════════
// Game-time formatter for the day/night ghost pill.
//
// sc-15 stored MLB first-pitch as TIMESTAMPTZ (UTC). The pill on
// the atom must show venue-local time - e.g. a Reds 7:10pm ET game
// stored as `2026-06-05T23:10:00Z` renders as "7:10 ET", not "23:10"
// or "11:10".
//
// Approach: read-time conversion using a per-account timezone map.
// Only HOME games show the pill and each account's home ballpark
// has a fixed timezone, so a 4-entry map is sufficient. No new
// migration - the raw TIMESTAMPTZ stays authoritative and the
// per-account tz is presentational.
//
// Timezone abbreviation stays stable ("ET"/"CT") year-round even
// though the underlying zone flips between EDT/EST etc. across DST.
// MLB season is Mar-Sep so this is almost all daylight time anyway;
// the label stays constant for consistency (Kevin's ruling).
// ══════════════════════════════════════════════════════════════

// Per-account home-ballpark timezone. Extend when new MLB fee
// accounts land - each account's home stadium has one canonical tz.
const ACCOUNT_HOME_TZ = {
  "CIN - OH":     { tz: "America/New_York", abbrev: "ET" }, // Great American Ball Park
  "STL - MO":     { tz: "America/Chicago",  abbrev: "CT" }, // Busch Stadium
  "TXR - TX - H": { tz: "America/Chicago",  abbrev: "CT" }, // Globe Life Field
  "TXR - TX - V": { tz: "America/Chicago",  abbrev: "CT" }, // Globe Life Field
  // sc-16 (2026-07-11): MiLB AAA parity. Louisville + Buffalo both sit in
  // the ET label year-round per Kevin's ruling. The venue tz is what the
  // Intl formatter converts UTC into; the abbrev is presentational.
  "CIN - KY":     { tz: "America/New_York", abbrev: "ET" }, // Louisville Slugger Field
  "TBJ - NY":     { tz: "America/New_York", abbrev: "ET" }, // Sahlen Field
  // sc-17 (2026-07-11): FSL Palm Beach Cardinals home-game overlay.
  // Roger Dean Chevrolet Stadium, Jupiter FL. ET year-round matches
  // the simple-label rule (avoids EDT/EST toggling on tile labels).
  "STL - FL":     { tz: "America/New_York", abbrev: "ET" }, // Roger Dean Chevrolet Stadium
};

// Format an MLB HOME game_time (ISO TIMESTAMPTZ from PG) as
// "H:MM TZ" in the account's home-park local time. AM/PM omitted
// - the paired day/night glyph disambiguates. Returns null when
// the input is missing / unparseable / unmapped so the caller can
// gracefully render the glyph alone.
export function formatMlbHomeGameTime(isoUtc, accountKey) {
  if (!isoUtc || !accountKey) return null;
  const entry = ACCOUNT_HOME_TZ[accountKey];
  if (!entry) return null;
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    hour:     "numeric",
    minute:   "2-digit",
    hour12:   true,        // request 12h, but we drop the AM/PM part below
    timeZone: entry.tz,
  }).formatToParts(d);
  const hour   = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  if (!hour || !minute) return null;
  return `${hour}:${minute} ${entry.abbrev}`;
}

// MiLB game_time is a manually-entered TEXT field on sc_day_metadata,
// already in venue-local (per convention). Light cleanup: strip
// AM/PM tokens (the glyph disambiguates), collapse whitespace. Falls
// back to null on empty/missing so the pill can render glyph-only.
// If the operator's format is "7:05 PM" the result is "7:05".
export function formatMilbHomeGameTime(rawText) {
  if (!rawText) return null;
  const cleaned = String(rawText)
    .replace(/\s*(AM|PM|a\.m\.|p\.m\.)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

// Public accessor for tests / debug: returns the mapped tz meta or
// null. Not currently consumed elsewhere but exported so we can
// verify the map without importing internals.
export function getAccountHomeTz(accountKey) {
  return ACCOUNT_HOME_TZ[accountKey] || null;
}
