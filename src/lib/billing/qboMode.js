// ═══════════════════════════════════════════════════════════════════
// qboMode - per-account test/live switch.
// PR-D placeholder; PR-F swaps this to the real read from
// sc_qbo_account_map.qbo_mode.
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5.
//
// The mode flag lives per account and defaults to 'test'. In test
// mode the finalize experience shows the TEST MODE badge, the
// destination row reads "ZZ TEST - KitchFix Intranet", the adapter
// posts to customer 22463 with 2029 TxnDate + loud memos, and the
// recipient resolver returns Kevin only.
//
// PR-D uses this stub so UI can be reviewed with the badge working
// end to end. PR-F introduces sc-35 (`qbo_mode` column on
// sc_qbo_account_map, default 'test'), the resolver's structural
// override, and replaces this file's body with a single-line read.
//
// The two pilot accounts (TXR - AZ, CIN - AZ) are in 'test' in this
// stub. Every other account also returns 'test' so that ANY caller
// wired to this accessor before PR-F ships defaults safely, with
// zero chance of a stub-returned 'live' before the resolver + fence
// are wired together.

const TEST_ACCOUNTS = new Set([
  "TXR - AZ",
  "CIN - AZ",
]);

/**
 * @param {string} accountKey  e.g. "TXR - AZ"
 * @returns {"test" | "live"}
 */
export function getQboMode(accountKey) {
  if (typeof accountKey !== "string" || accountKey.length === 0) return "test";
  if (TEST_ACCOUNTS.has(accountKey)) return "test";
  // Default-deny discipline: unknown accounts are test-mode. PR-F's
  // real DB read returns whatever sc_qbo_account_map holds; the
  // sc-35 column default is 'test' so the DB default is aligned.
  return "test";
}

// Names exposed for the overlay's destination row + test-mode badge.
// Kept here so PR-F can add a getInvoiceDestination(accountKey) that
// reads the live account map and returns the real customer name when
// mode='live'.
export const TEST_DESTINATION = "ZZ TEST - KitchFix Intranet";

/**
 * Destination string for the overlay's "Invoice goes to" row.
 * PR-D returns the test-mode literal for every account (all pilots
 * are test). PR-F reads the real customer name from
 * sc_qbo_account_map.qbo_customer_name when mode='live'.
 *
 * @param {string} accountKey
 * @param {string} [liveCustomerName]  optional live-mode customer name
 * @returns {string}
 */
export function getInvoiceDestination(accountKey, liveCustomerName) {
  if (getQboMode(accountKey) === "test") return TEST_DESTINATION;
  return liveCustomerName || accountKey;
}
