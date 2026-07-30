// M-4b (2026-07-30): resolveSpringDateSet - the data source for the
// copper spring-training corner wedge on MLB day tiles.
//
// Owner ruling 2026-07-30, superseding the M22 empty-scope
// suppression: the full twelve-month overview stays on MLB
// accounts. And on that full-year view, mark the weeks when the
// organization's affiliate complex is running spring training,
// because an MLB chef may be pulled into it.
//
// The corner-wedge affordance is already plumbed end to end:
//   - DaySquare renders the wedge when isSpringPhase is true
//     (adds sc-daysq--spring; appends "· spring training" to the
//     accessible name)
//   - MonthCard + PeriodCard both receive springDateSet and pass
//     the per-cell prop
//   - collectSpringDates(timeline) enumerates the dates from a
//     PDC timeline's spring-training blocks
//
// The ONLY gap on MLB was the data source: derivePhaseTimeline
// returns a degraded { status: "non-pdc", blocks: [] } for
// category !== "PDC", so MLB accounts got an empty Set. This
// module redirects MLB accounts to their PDC sibling's timeline
// for the spring set alone. Every other consumer of the account's
// own phaseTimeline (tints, PhaseStrip, ribbon rider) is
// untouched.
//
// Sibling map. Hardcoded per owner discipline - the same shape as
// DERIVE_HOMESTANDS_ACCOUNTS. Admitting an account here is a
// deliberate code edit. Do NOT infer siblings from a key prefix:
// TXR - TX - H and TXR - TX - V both map to one PDC account, and
// a prefix rule would also match TXR - AZ to itself.

import { derivePhaseTimeline, collectSpringDates } from "./phaseDerivation";

const MLB_TO_PDC_SIBLING = new Map([
  ["CIN - OH",     "CIN - AZ"],
  ["STL - MO",     "STL - FL"],
  ["TXR - TX - H", "TXR - AZ"],
  ["TXR - TX - V", "TXR - AZ"],
]);

// Returns the Set<YYYY-MM-DD> of spring-training dates that should
// paint the corner wedge on this account's tiles.
//
// For an MLB account with a mapped PDC sibling: reads the sibling's
// phase timeline. For every other account: reads the account's own
// timeline (pre-M-4b behavior, byte-identical). Non-PDC without a
// sibling returns an empty Set so callers `.has(date)` without
// null-guarding.
//
// Verified live 2026-07-30 against phaseCalendar.js:
//   CIN - OH      -> CIN - AZ  spring window Feb 9 - Apr 1  (52 days)
//   STL - MO      -> STL - FL  spring window Feb 9 - Mar 22 (42 days)
//   TXR - TX - H  -> TXR - AZ  spring window Feb 9 - Mar 22 (42 days)
//   TXR - TX - V  -> TXR - AZ  same 42 days as sibling
export function resolveSpringDateSet(accountKey, category, year) {
  const siblingKey = MLB_TO_PDC_SIBLING.get(accountKey);
  if (siblingKey) {
    return collectSpringDates(derivePhaseTimeline(siblingKey, "PDC", year));
  }
  return collectSpringDates(derivePhaseTimeline(accountKey, category, year));
}
