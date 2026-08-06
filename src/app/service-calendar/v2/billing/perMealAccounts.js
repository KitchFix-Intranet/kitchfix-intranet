// SC per-meal billing accounts - the pilot six for the SC -> QBO
// billing arc.
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC.md §2. The finalize state,
// invoice builder, and QBO adapter all key on this set. Fee accounts
// (STL - FL and the four MLB fee accounts) are STRUCTURALLY excluded -
// they never enter this pipeline; their money is sc_fee_schedule, not
// sc_daily_revenue.
//
// Naming discipline (same shape as MLB_HOMESTAND_SURFACE_ACCOUNTS in
// v2/pilots.js and HOME_DINING_AWAY_OPPONENTS in v2/homeDiningAwayOpponents.js):
// explicit Set, NEVER a derived property. Adding an account here is
// a deliberate code edit backed by a documented operational finding
// and Sebastian's confirm. Do NOT derive per-meal-ness by inverting
// billingModel === 'flat_fee' - the fee-shape and the billing-arc-
// membership are distinct concerns, and the derivation has failed
// twice on this codebase already (docs/GOTCHAS mentions the pattern).
//
// Cadence (per K-17, spec §3):
//   TXR - AZ, TBJ - FL, TBR - FL   - weekly, Mon-Sun, invoiced Tuesday
//   CIN - AZ                        - bi-weekly, TWO Mon-Sun weeks
//                                     combined into one invoice pair on
//                                     the closing Sunday
//   CIN - KY, TBJ - NY              - weekly by SERVICE (invoiced only
//                                     for weeks with service); still
//                                     Mon-Sun grain, still Tuesday
//
// The finalize state machine operates identically for all six -
// cadence differences live in per-account config (sc_qbo_account_map,
// PR-B), NOT in this set.
//
// History:
//   - PR-A (2026-08-06, this file's arrival): pilot set locked at
//     six per K-17, ruled by Kevin 2026-08-06. TXR - AZ + CIN - AZ
//     are the pilot pair (spec §5, ruled 2026-08-06); the other four
//     join at their cutover turn.

export const PER_MEAL_BILLING_ACCOUNTS = Object.freeze(new Set([
  "CIN - AZ",   // Cincinnati Reds AZ complex, bi-weekly
  "TXR - AZ",   // Texas Rangers AZ complex, weekly
  "TBJ - FL",   // Dunedin Blue Jays, weekly
  "TBR - FL",   // Tampa Bay Rays FL complex, weekly
  "CIN - KY",   // Louisville Bats, weekly-by-service
  "TBJ - NY",   // Buffalo Bisons, weekly-by-service
]));

// Query helper - single-call test. Keeps the Set's shape encapsulated
// in one place so consumers do not repeat the `.has(...)` idiom.
// Trims + case-matches account keys exactly as stored (matches
// sc_daily_actuals.account_key discipline).
export function isPerMealBillingAccount(accountKey) {
  if (!accountKey || typeof accountKey !== "string") return false;
  return PER_MEAL_BILLING_ACCOUNTS.has(accountKey);
}
