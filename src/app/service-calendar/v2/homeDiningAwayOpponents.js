// Away games we serve at home - opponent allow-list per account.
//
// The operational fact this encodes: some accounts serve meals at
// home even when the team is on the road, because the opponent's
// venue is close enough that the players return to the PDC to eat
// before departure or after return. Palm Beach shares Roger Dean
// Stadium with Jupiter and St. Lucie is a short bus ride; those
// two opponent series are service days that the pre-sc-28 schedule
// table did not know about.
//
// A row exists in `sc_homestand_schedule` for every away game
// (loaded by sc-28 as `day_type='AWAY'`). The overlay path
// (`loadScheduleOverlay`) reads `day_type='GAME'` OR
// (`day_type='AWAY'` AND (account, opponent_team_id) is in this
// map). Non-qualifying away games stay invisible - the pill does
// not fire on Daytona, Bradenton, etc.
//
// Naming discipline: same shape as `MLB_HOMESTAND_SURFACE_ACCOUNTS`
// in pilots.js. Explicit set, not a derived property. Adding an
// (account, opponent_id) pair is a deliberate code edit backed by
// a documented operational finding.
//
// Team ID over abbreviation:
//   Values are Sets of MLB Stats API numeric team identifiers, NOT
//   3-letter abbreviations. The API contract for `abbreviation` can
//   change (rename, rebrand); `id` is the row's primary key on the
//   API side and is stable across seasons. A code constant tied to
//   `"JUP"` would silently mis-match the day MLB reclubs; keyed to
//   `479`, the mapping survives whatever the API calls Jupiter next.
//   The abbreviation still appears in the pill copy at render time
//   because operators know the club by that name.
//
// History:
//   - sc-28 (2026-08-05, PR #TBD): pilot = { STL - FL -> {479, 507} }.
//     Owner-confirmed dining fact for Palm Beach at Jupiter and
//     St. Lucie away games. sc-17's 2026-07-11 HOME-ONLY hard rule
//     revisited with a dated append; the concern the ruling
//     addressed is met because non-qualifying AWAY rows remain
//     invisible via this map.

// Map: account_key -> Set of opponent team_ids that trigger the
// meals-at-home pill + copper marker on AWAY rows.
export const HOME_DINING_AWAY_OPPONENTS = new Map([
  ["STL - FL", new Set([
    479, // Jupiter Hammerheads (JUP)  - stadium share
    507, // St. Lucie Mets (SLU)       - short bus, team returns to eat
  ])],
]);

// Query helper - single-call test used by loadScheduleOverlay and the
// render layer. Keeps the map's shape encapsulated in one place so
// consumers do not repeat the `.get(...)?.has(...)` idiom.
export function isHomeDiningAwayOpponent(accountKey, opponentTeamId) {
  if (!accountKey || opponentTeamId == null) return false;
  const set = HOME_DINING_AWAY_OPPONENTS.get(accountKey);
  return set ? set.has(Number(opponentTeamId)) : false;
}
