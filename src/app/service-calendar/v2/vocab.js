// Phase 2B (2026-07-25; polish rounds 1-3 collapsed 2026-08-01) -
// fee-no-dollar shape predicate.
//
// KEY: the fee-no-dollar shape = billingModel === "flat_fee" AND no
// homestand schedule. MLB fee accounts (CIN-OH, STL-MO, TXR-TX-H,
// TXR-TX-V) are ALSO flat_fee but carry has_homestand_schedule=true
// and never match this predicate. STL - FL is the only account that
// matches today. Keying on shape rather than account key means a
// future flat-fee-without-homestand account inherits the payload
// fence + display rules automatically.
//
// Was: this module also exported unitLabelCap / verbLabel /
// verbLabelPast / verbLabelPastUpper - vocabulary swap helpers for
// a Phase-2B design where the fee shape said "Confirm"/"served" and
// per-meal said "Enter"/"meals". R3-1 reversed the swap: every
// rendered site now says "meals" regardless of shape, and the verb
// labels the retired helpers produced are inlined at their few
// remaining sites. The helpers were kept as dead exports; the
// 2026-08-01 cleanup pass removed them.
//
// unitLabel(account) is retained pending a separate ruling on the
// one live caller (DayEntryV2.js NoServiceConfirm mount at :1204,
// which passes to a `unit` prop the component no longer reads).

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
