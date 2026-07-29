// SC pilot allow-lists - non-hook module.
//
// Kept separate from v2/flags.js because flags.js is "use client" and
// carries useEffect/useState. Importing it from the server dataStore
// path (lib/dataStore/serviceCalendar.js) would pull React into a
// server module. This file holds only plain constants so both the
// client render layer AND the server payload builder can gate off the
// same source.
//
// Naming discipline: each pilot set decides which accounts SEE a
// specific new surface. Do NOT confuse these with
// DERIVE_HOMESTANDS_ACCOUNTS in season/homestandDerivation.js, which
// decides which accounts DERIVE homestand blocks (all four MLB). The
// derivation is a data-plane fact; a pilot set is a surface-plane
// fence.

// M-2 pilot: which accounts see the homestand scope + detail surface.
// Per scope A3, CIN-OH pilots from M-2 onward; the three non-pilot
// MLB accounts (STL-MO, TXR-TX-H, TXR-TX-V) join at M-4. Adding a key
// here is a deliberate code edit, not a data-driven signal.
//
// Enforcement points:
//   - server payload emit (loadYearSummaryPostgres): the `homestands`
//     key is present in the response only for accounts in this set.
//     Every non-pilot MLB account plus every non-MLB account gets a
//     byte-identical pre-M-2 payload.
//   - client route (SeasonShell.handleSegmentClick): the strip's
//     block click retargets to the homestand scope only for pilot
//     accounts; non-pilot accounts preserve the pre-M-2 period-map
//     behavior.
//   - client mount (ServiceCalendar.js): scope === "homestand" only
//     mounts the detail surface when the current account is in this
//     set. An unknown key or a wrong-account URL falls to the Season
//     overview with no scope side effects.
export const M2_HOMESTAND_ACCOUNTS = new Set([
  "CIN - OH",
]);
