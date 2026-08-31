// src/lib/kpi/overview/flags.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// Payload flags the render consumes to decorate cards + rows:
//   - planned       : open-period revenue on a per-meal account, not-live
//   - contractual   : fee account (2400.1 recognition schedule)
//   - pass_through  : cost model = pass_through (billed back, no verdict)
//   - seeded        : per-meal + rev_source=sc + account has known
//                     seed-burst pattern (R888-6, six accounts). Overview
//                     ticker prints "seeded test data" note when this
//                     fires.
//   - packaging_gap : the two accounts with the 3400 mapping gap
//                     (CIN - KY $1,385 + STL - FL $10,991 finance vs $0
//                     ours; R898-2). Statement + lever rows render
//                     "mapping gap" chip.
//
// One tiny module so the resolver doesn't need to remember the account
// lists in its top-level file; edits to the seed list or the packaging-
// gap list happen in one place with a comment trail.

import { costModelFor } from "@/lib/accountModels.js";

// R888-6: seven accounts carry the 2026-06-15/16 seed burst. Six of
// them are the seeded set (CIN - OH is small-but-real per R888-6 so
// only the six render the test-data note).
const SEEDED_ACCOUNTS = new Set([
  "CIN - AZ",
  "STL - FL",
  "TBJ - FL",
  "TBR - FL",
  "TXR - AZ",
  "TXR - TX - H",
]);

// R898-2: two accounts with the 3400 packaging mapping gap. Finance
// carries a figure and our side has $0.
const PACKAGING_GAP_ACCOUNTS = new Set([
  "CIN - KY",
  "STL - FL",
]);

export function isPackagingGapAccount(accountKey) {
  return PACKAGING_GAP_ACCOUNTS.has(accountKey);
}

export function isSeededAccount(accountKey) {
  return SEEDED_ACCOUNTS.has(accountKey);
}

/**
 * Compose the flags block for a resolved account + range + source.
 *
 * Inputs:
 *   accountKey    - single account key OR one of the pseudo keys
 *                   ('ALL' / 'EAST' / 'WEST') for aggregate rollups.
 *   members       - members list (for aggregate flag rollups)
 *   revSource     - 'planned' | 'sc'
 *   scLive        - true when this account (or ALL members) have
 *                   sc_revenue_live=true; false otherwise
 *   revenueModel  - the resolveRevenueSource model string
 *
 * Returns:
 *   {
 *     planned: bool,
 *     contractual: bool,
 *     pass_through: bool,
 *     seeded: bool,
 *     packaging_gap: bool,
 *   }
 *
 * For aggregate keys, `packaging_gap` fires if ANY member has the gap;
 * `seeded` fires if the mode is 'sc' AND any member is seeded (the
 * ticker note is per-account in the render but a rolled-up view still
 * has a truthful "some of these are test data" signal).
 */
export function composeFlags({ accountKey, members = [], revSource = "planned", scLive = false, revenueModel = null }) {
  const isAggregate = ["ALL", "EAST", "WEST"].includes(accountKey);
  const set = isAggregate ? new Set(members) : new Set([accountKey]);

  const planned = revenueModel === "planned";
  const contractual = revenueModel === "contractual";
  // pass_through as a payload flag: fires when the SINGLE account is
  // pass_through, or on aggregates when EVERY member is pass_through
  // (rare - the three pass_through accounts are all East, so EAST
  // itself is not all-pass-through). Aggregate reads render the flag
  // as a hint only, not a verdict on the whole.
  let pass_through = false;
  if (!isAggregate) {
    try { pass_through = costModelFor(accountKey) === "pass_through"; }
    catch { pass_through = false; }
  }
  // Seeded: fires when rev_source=sc AND the (single account is
  // seeded) OR (aggregate has any seeded member). Only meaningful
  // when the render is showing SC data.
  let seeded = false;
  if (revSource === "sc") {
    for (const m of set) {
      if (SEEDED_ACCOUNTS.has(m)) { seeded = true; break; }
    }
  }
  // Packaging gap: fires when any account in the scope has it.
  let packaging_gap = false;
  for (const m of set) {
    if (PACKAGING_GAP_ACCOUNTS.has(m)) { packaging_gap = true; break; }
  }
  return { planned, contractual, pass_through, seeded, packaging_gap };
}
