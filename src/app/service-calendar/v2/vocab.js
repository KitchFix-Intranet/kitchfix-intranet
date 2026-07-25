// Phase 2B (2026-07-25) - vocabulary helpers for the fee-no-dollar
// account shape. Two vocabularies in the product is a DELIBERATE owner
// decision (not drift): "confirm" reads truer than "enter" for an
// account where the operator verifies headcounts rather than driving
// an invoice; "served" reads truer than "meals" when there is no per-
// meal billing.
//
// KEY: the fee-no-dollar shape (flat_fee AND no homestand schedule),
// NOT `billingModel === "flat_fee"` alone. MLB fee accounts (CIN-OH,
// STL-MO, TXR-TX-H, TXR-TX-V) are ALSO flat_fee but they render on v1
// today (Phase 4 fenced) - and even after Phase 4 they carry a real
// homestand-driven per-game context that keeps "meals" and "enter"
// truthful. The fee-no-dollar predicate isolates the single account
// (STL-FL) where the vocabulary swap applies.
//
// Keying on shape rather than account key means the helper stays
// correct without a per-account allow-list: STL-FL is the only
// flat_fee-without-homestand today, but if another such account is
// ever onboarded it would inherit the vocabulary automatically. MLB
// accounts NEVER match this predicate.
//
// Usage:
//   import { unitLabel, verbLabel, isFeeNoDollar } from "../vocab";
//   const unit = unitLabel(account);  // "meals" | "served"
//   const verb = verbLabel(account);  // "Enter" | "Confirm"
//
// The account object is what the mount site already has in scope
// (data.account carries billingModel + hasHomestandSchedule). Helper
// tolerates null/undefined for the pre-hydration case - returns the
// per-meal default so no flash of fee copy on a stale/absent account.

export function isFeeNoDollar(account) {
  if (!account) return false;
  return account.billingModel === "flat_fee" && !account.hasHomestandSchedule;
}

// Primary noun for a count of served portions.
//   fee-no-dollar (STL-FL): "served"
//   everything else (per-meal + MLB fee): "meals"
export function unitLabel(account) {
  return isFeeNoDollar(account) ? "served" : "meals";
}

// Capitalized variant when the word opens a sentence or a stat label.
export function unitLabelCap(account) {
  return isFeeNoDollar(account) ? "Served" : "Meals";
}

// Verb the operator does when logging a day.
//   fee-no-dollar: "Confirm" - verifies headcounts, no invoice driver
//   everything else: "Enter"
export function verbLabel(account) {
  return isFeeNoDollar(account) ? "Confirm" : "Enter";
}

// Past-tense form for status labels and progress meta.
export function verbLabelPast(account) {
  return isFeeNoDollar(account) ? "confirmed" : "entered";
}

// SHOUTY variant for the rail label (matches the existing "ENTERED" /
// "PROJECTED" cadence).
export function verbLabelPastUpper(account) {
  return isFeeNoDollar(account) ? "CONFIRMED" : "ENTERED";
}
