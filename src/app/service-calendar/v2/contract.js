// Phase 2B (2026-07-25) - code-owned contract facts, keyed by account.
// Cited references to canonical doc figures, NOT computed values.
//
// Why this exists: the fee-account rail (BillRailFee) renders a
// contract block ("Annual fee $2,300,000 · Billing: Flat fee · Counts
// are planning only" per the owner-approved RENDER_STL_FL.html). The
// account payload from PostgREST carries billingModel and
// hasHomestandSchedule but NOT the fee amount - accounts.annual_fee
// does not exist as a column. This module fills the gap client-side
// with a cited reference to the docs, consistent with the never-
// compute-client-side rule (a stored constant is not a computation).
//
// STL - FL $2,300,000 provenance (both citations required so a future
// reader can trace the figure):
//
//   docs/ACCOUNT_SERVICES_BRIEF.md:564
//     | STL - FL | Flat Total Annual Fee | $2,300,000 | ...
//     canonical contracts brief; owner-approved figure.
//
//   docs/SC_CONTRACT_BILLING_SUMMARY.md:82
//     $1,400,000 Florida Services fee. Note in the same row:
//     "$900K food passthrough excluded".
//
//   $1.4M services + $0.9M food passthrough = $2.3M total.
//   The RENDER_STL_FL.html spec displays the TOTAL ($2,300,000
//   labeled "Annual fee"), matching ACCOUNT_SERVICES_BRIEF.md.
//
// Escape hatch to server-side (Phase 4 trigger): when the four MLB fee
// accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) join v2, five
// consumers of contract data with per-season variance justify a real
// `accounts.annual_fee_amount` column + migration. At that point:
//   1. Add the column, backfill from this file.
//   2. Thread through route.js's account payload.
//   3. Read `data.account.annualFee` in BillRailFee.
//   4. Delete this module - single call site to update.
// Not now: one static row does not justify a migration-gated schema
// change.
//
// Shape: { annualFee: number, model: string, note: string } keyed by
// canonical account key with spaces around the hyphen. Consumers read
// via `getContractInfo(accountKey)` to keep the module surface small.
export const CONTRACT_INFO = {
  "STL - FL": {
    annualFee: 2300000,
    model: "Flat fee",
    note: "Counts are planning only",
  },
};

export function getContractInfo(accountKey) {
  if (!accountKey) return null;
  return CONTRACT_INFO[accountKey] || null;
}
