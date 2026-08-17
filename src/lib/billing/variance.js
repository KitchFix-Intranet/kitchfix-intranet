// ═══════════════════════════════════════════════════════════════════
// variance - the entry-ledger "digit-drop" advisory.
// PR-H of the SC -> QBO billing arc (2026-08-17).
// ═══════════════════════════════════════════════════════════════════
//
// One pure function; no DOM, no side effects. Fires ONLY when all
// FIVE conditions hold:
//
//   1. entered > 0                    (zero is no-service or unentered,
//                                      never a typo)
//   2. entered < projected            (overshoot is a projections
//                                      problem, not an entry error)
//   3. entered * 10 <= projected      (the digit-drop shape specifically)
//   4. projected >= 30                (small services yield noisy math)
//   5. !isFlatFee                     (Coffee Service, Fountain Bev,
//                                      etc.: a 1-to-2 change is real)
//
// Rule authority: Kevin's ruling 2026-08-17. The design's first cut
// (gap >= 15 AND pct > 40%) fired 325 times across the pilot history
// (~6 per week); operators would train themselves to ignore it. The
// narrower rule targets the ORDER-OF-MAGNITUDE keystroke error - a
// missing digit on an invoice line - not "much lower than expected."
// 110 -> 60 is a travel day; 110 -> 11 is a missing digit and a 10x
// error on an invoice line.
//
// ADVISORY ONLY. The check MUST NOT block, disable, or gate the save
// button in any state. The component wired to this fn renders the copy
// beneath the row and leaves save enabled.

export const VARIANCE_MIN_PROJECTED = 30;   // condition 4
export const VARIANCE_DIGIT_DROP_MULT = 10; // condition 3 multiplier

/**
 * Decide whether a row should carry the digit-drop advisory.
 *
 * @param {Object} args
 * @param {number} args.projected  Projected count for the service+day.
 * @param {number} args.entered    Entered count from the input.
 * @param {boolean} args.isFlatFee `s.isFlatFee` from the service catalog.
 * @returns {{message: string} | null}
 *   `null` when quiet. `{ message }` when the flag fires. Copy shape:
 *   `"Projected 110, entered 11 - is a digit missing?"` (per Kevin's
 *   ruling 2026-08-17).
 */
export function shouldFlagVariance({ projected, entered, isFlatFee }) {
  if (isFlatFee) return null;
  if (!Number.isFinite(projected) || projected < VARIANCE_MIN_PROJECTED) return null;
  if (!Number.isFinite(entered) || entered <= 0) return null;
  if (entered >= projected) return null;
  if (entered * VARIANCE_DIGIT_DROP_MULT > projected) return null;
  return { message: `Projected ${projected}, entered ${entered} - is a digit missing?` };
}
