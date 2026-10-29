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
// the account roster is big enough that a hand-maintained allowlist
// becomes a hazard.
//
// ─── Current state (2026-10-29) ───────────────────────────────────
//
// The stub returns 'live' for accounts on LIVE_ACCOUNTS and 'test'
// for everything else (default-deny). Four accounts are live as of
// this PR: TBJ - FL, CIN - AZ, TXR - AZ, and TBR - FL. CIN - AZ and
// TXR - AZ were already live in sc_qbo_account_map (and pushing real
// invoices on the server) when this stub was still returning 'test'
// for them; the 2026-10-16 PR closed that pre-existing badge drift.
// TBR - FL (QBO customer 17860) flipped live in Studio on 2026-10-29
// and is added here in the same hand.
//
// The allowlist MUST be kept in sync with each Studio flip of
// sc_qbo_account_map.qbo_mode: if an account is flipped to live in
// the DB but not added here, the badge will show TEST MODE over a
// real server-side push - a cosmetic lie that could trick an
// operator into finalizing on the wrong screen. The server-side
// fence + resolver still route correctly per the DB truth even when
// this stub drifts, but the point of this file is to prevent the
// drift. PR-F.1 is the eventual replacement.

// Accounts whose DB qbo_mode has been flipped to 'live' in
// sc_qbo_account_map. This client allowlist is cosmetic (it drives
// the overlay badge + destination row only); the server reads the DB
// directly. Keep in sync with each Studio flip - see the file header.
const LIVE_ACCOUNTS = new Set([
  "TBJ - FL",
  "CIN - AZ",
  "TXR - AZ",
  "TBR - FL",
]);

/**
 * @param {string} accountKey  e.g. "TBJ - FL"
 * @returns {"test" | "live"}  Cosmetic badge signal only.
 */
export function getQboMode(accountKey) {
  if (typeof accountKey !== "string" || accountKey.length === 0) return "test";
  if (LIVE_ACCOUNTS.has(accountKey)) return "live";
  // Default-deny discipline: anything not on the live allowlist reads
  // as 'test' so the badge never claims 'live' for a row we have not
  // explicitly flipped.
  return "test";
}

// Names exposed for the overlay's destination row + test-mode badge.
export const TEST_DESTINATION = "ZZ TEST - KitchFix Intranet";

// Live-account display names for the overlay's "Invoice goes to" row,
// keyed to the QBO customer the server-side fence actually routes to
// (sc_qbo_account_map.qbo_customer_id). Keep in sync with LIVE_ACCOUNTS
// and the DB.
const LIVE_DESTINATIONS = {
  "TBJ - FL": "Rogers Blue Jays Baseball Partnership", // QBO customer 16971
  "CIN - AZ": "Cincinnati Reds (Goodyear, AZ)",        // QBO customer 17752
  "TXR - AZ": "Texas Rangers - Surprise, AZ",          // QBO customer 19000
  "TBR - FL": "Tampa Bay Rays MiLB/MLB",               // QBO customer 17860
};

/**
 * Destination string for the overlay's "Invoice goes to" row.
 * Test accounts show the ZZ TEST literal. Live accounts show the caller-
 * supplied name if present, else the mapped live customer name, else the
 * account key (never ZZ TEST).
 */
export function getInvoiceDestination(accountKey, liveCustomerName) {
  if (getQboMode(accountKey) === "test") return TEST_DESTINATION;
  return liveCustomerName || LIVE_DESTINATIONS[accountKey] || accountKey;
}
