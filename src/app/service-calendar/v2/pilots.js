// SC pilot allow-lists - non-hook module.
//
// Kept separate from v2/flags.js because flags.js is "use client" and
// carries useEffect/useState. Importing it from the server dataStore
// path (lib/dataStore/serviceCalendar.js) would pull React into a
// server module. This file holds only plain constants so both the
// client render layer AND the server payload builder can gate off the
// same source.
//
// Naming discipline: each set decides which accounts SEE a specific
// surface. Do NOT confuse these with DERIVE_HOMESTANDS_ACCOUNTS in
// season/homestandDerivation.js, which decides which accounts DERIVE
// homestand blocks (all four MLB). The derivation is a data-plane
// fact; the surface set is a surface-plane fence. In principle the
// two can diverge (e.g. a derived MLB account that should not yet see
// the surface); today they carry the same four members but the names
// preserve the intent.

// MLB homestand-surface set. Which accounts see the homestand scope +
// detail surface (rail, tracker, close-out panel).
//
// History:
//   - M-2 (2026-07-29): pilot = { CIN - OH }. Was named
//     M2_HOMESTAND_ACCOUNTS.
//   - M-4a (2026-07-29): widened to all four MLB and renamed to
//     MLB_HOMESTAND_SURFACE_ACCOUNTS. "M2" was a phase, not a
//     scope - keeping the phase name locked in the constant lied
//     about what the fence is for.
//
// Adding a key here is a deliberate code edit, not a data-driven
// signal.
//
// Enforcement points:
//   - server payload emit (loadYearSummaryPostgres): the `homestands`
//     key is present in the response only for accounts in this set.
//     Every non-MLB account gets a byte-identical pre-M-2 payload.
//   - client route (SeasonShell.handleSegmentClick): the strip's
//     block click retargets to the homestand scope only for accounts
//     in this set; non-MLB accounts preserve the pre-M-2 period-map
//     behavior.
//   - client mount (ServiceCalendar.js): scope === "homestand" only
//     mounts the detail surface when the current account is in this
//     set. An unknown key or a wrong-account URL falls to the Season
//     overview with no scope side effects.
export const MLB_HOMESTAND_SURFACE_ACCOUNTS = new Set([
  "CIN - OH",
  "STL - MO",
  "TXR - TX - H",
  "TXR - TX - V",
]);
