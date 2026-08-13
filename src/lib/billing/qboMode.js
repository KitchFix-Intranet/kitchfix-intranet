// ═══════════════════════════════════════════════════════════════════
// qboMode - client-side stub for the overlay's TEST MODE badge +
// destination row. Server-side reads the authoritative value from
// sc_qbo_account_map.qbo_mode directly (sc-35, PR-F).
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5.
//
// ─── Where the real read lives ────────────────────────────────────
//
// PR-F wires the SERVER-side finalize path
// (`src/lib/scWeekFinalize.js runFinalizeEffects`) to read
// `accountMap.qbo_mode` directly from the row loaded by that
// function. The mode is then threaded through:
//   - postInvoiceDraft(ctx.qboMode + ctx.accountMap)  - per-mode fence
//   - fireN1 / fireN2 (qboMode)                        - resolver override
//
// Both server-side paths are the load-bearing ones - they gate the
// POST + the email. This client-side accessor is cosmetic: it drives
// the overlay's TEST MODE badge + the "Invoice goes to" destination
// line so operators can see which mode they are in.
//
// ─── Why the client is a stub ─────────────────────────────────────
//
// The overlay renders synchronously (no async state hook available
// at the badge site) and cannot query the DB directly from the
// browser. Making the client fully authoritative requires either
// (a) extending an existing SC endpoint to include qbo_mode in its
// response, (b) prefetching modes on page load, or (c) a small
// dedicated fetcher with useEffect. All three land as PR-F.1 when
// Kevin flips a pilot to live and the badge would otherwise show
// stale copy.
//
// Until then: both pilots stay 'test' per sc-35's seed, the stub
// returns 'test' for both, and the badge is accurate by convention.
// If Kevin flips one pilot to live via Studio, the badge will still
// show "Test mode" until the client accessor is updated. That is a
// cosmetic drift only - the SERVER-side fence + resolver still
// route correctly per the DB truth.

const TEST_ACCOUNTS = new Set([
  "TXR - AZ",
  "CIN - AZ",
]);

/**
 * @param {string} accountKey  e.g. "TXR - AZ"
 * @returns {"test" | "live"}  Cosmetic badge signal only.
 */
export function getQboMode(accountKey) {
  if (typeof accountKey !== "string" || accountKey.length === 0) return "test";
  if (TEST_ACCOUNTS.has(accountKey)) return "test";
  // Default-deny discipline: unknown accounts read as 'test' so the
  // badge never claims 'live' for a row whose real DB mode we have
  // not yet confirmed.
  return "test";
}

// Names exposed for the overlay's destination row + test-mode badge.
export const TEST_DESTINATION = "ZZ TEST - KitchFix Intranet";

/**
 * Destination string for the overlay's "Invoice goes to" row.
 * Returns the test-mode literal for every account until an account
 * is authoritatively flipped to live via the server-side path.
 */
export function getInvoiceDestination(accountKey, liveCustomerName) {
  if (getQboMode(accountKey) === "test") return TEST_DESTINATION;
  return liveCustomerName || accountKey;
}
