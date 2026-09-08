// ═══════════════════════════════════════════════════════════════════
// invoiceMemo - client-visible CustomerMemo text.
// 2026-09-09 (go-live recon Item 1b).
// ═══════════════════════════════════════════════════════════════════
//
// Sebastian's ask (2026-09-08 meeting): drop the old client-specific
// notes, replace with one uniform note naming the week of service on
// every invoice.
//
// This module is the ONE PLACE the copy lives. When Sebastian sends
// the final wording, edit MEMO_WEEKLY_TEMPLATE + MEMO_BIWEEKLY_TEMPLATE
// below and nothing else. The builder imports buildInvoiceMemo and
// emits its output as `payload.CustomerMemo.value`.
//
// Two shapes are handled:
//   Weekly account (TXR-AZ, TBJ-FL, TBR-FL, CIN-KY, TBJ-NY):
//     one Monday-Sunday week. weekStart === weekEnd - 6 days.
//   Biweekly account (CIN-AZ):
//     two Monday-Sunday weeks paired into one billing event.
//     weekStart === weekEnd - 13 days. The invoice is one document
//     for the pair, so the memo must name both weeks or the span.
//
// Placeholder wording lands as of 2026-09-09; Kevin will swap once
// Sebastian confirms. Do NOT hardcode copy anywhere else - importers
// call buildInvoiceMemo({ weekStart, weekEnd, isBiweekly }).
//
// Field mechanics: CustomerMemo is the QBO field that renders on the
// client-facing invoice ("Message displayed on invoice" in the QBO
// UI). NOT PrivateNote (internal only). NOT the payment-instructions
// block (a QBO template concern).
//
// Test-mode override: the adapter (qboAdapter.markPayloadAsTest) still
// stamps CustomerMemo with the "TEST" marker on test-mode drafts. The
// live-path memo emitted here only lands on live-mode invoices.

// ─── Date formatter ────────────────────────────────────────────────
// "Aug 25, 2026" style - matches the tone of an invoice memo.
// timeZone: UTC because ISO date strings are date-only, not local
// timestamps; without UTC, JS parses at local midnight and can shift
// the day when server tz != US.
function formatMemoDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month:    "short",
    day:      "numeric",
    year:     "numeric",
    timeZone: "UTC",
  });
}

// ─── Templates ─────────────────────────────────────────────────────
// EDIT THESE TWO STRINGS when Sebastian sends final wording. Every
// import of this module reads through buildInvoiceMemo below.
//
// Placeholder wording chosen 2026-09-09:
//   Weekly:  "Service week: <startDate> - <endDate>"
//   Biweekly: "Service period: <startDate> - <endDate>"
//
// The difference between "week" and "period" makes the biweekly case
// self-descriptive on its own. If Sebastian prefers uniform "period"
// or uniform "weeks" or explicit "Weeks 1-2 of Period N", edit the
// templates below and nothing else.
export function MEMO_WEEKLY_TEMPLATE(startFormatted, endFormatted) {
  return `Service week: ${startFormatted} - ${endFormatted}`;
}

export function MEMO_BIWEEKLY_TEMPLATE(startFormatted, endFormatted) {
  return `Service period: ${startFormatted} - ${endFormatted}`;
}

// ─── Public entrypoint ────────────────────────────────────────────
/**
 * Build the CustomerMemo string for an invoice.
 *
 * @param {object}  opts
 * @param {string}  opts.weekStart   ISO YYYY-MM-DD, Monday of the week
 *                                   (weekly) or first Monday of the
 *                                   pair (biweekly).
 * @param {string}  opts.weekEnd     ISO YYYY-MM-DD, Sunday closing the
 *                                   week (weekly) or Sunday closing the
 *                                   pair (biweekly).
 * @param {boolean} opts.isBiweekly  From accountMap.cadence === "biweekly".
 * @returns {string} The memo text ready to drop into CustomerMemo.value.
 */
export function buildInvoiceMemo({ weekStart, weekEnd, isBiweekly }) {
  const start = formatMemoDate(weekStart);
  const end   = formatMemoDate(weekEnd);
  return isBiweekly
    ? MEMO_BIWEEKLY_TEMPLATE(start, end)
    : MEMO_WEEKLY_TEMPLATE(start, end);
}
