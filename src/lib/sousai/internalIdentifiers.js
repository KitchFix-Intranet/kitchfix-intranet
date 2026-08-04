// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/internalIdentifiers.js
// SousAI · shared no-plumbing identifier lists
// ─────────────────────────────────────────────────────────────────────────────
//
// Round 0b (2026-08-04) extracted these lists from the harness so both the
// harness Tier 2 no-plumbing guard AND the runtime L12 self-check pass
// consume the same source of truth. The prior duplication (harness had the
// only copy) meant a runtime strip could silently diverge from what the
// harness flags. Same principle as receiptCheck.js: one definition, shared.
//
// Semantics:
//   INTERNAL_IDENTIFIERS_BODY_ONLY - tool names. Sanctioned on the Source
//     line for data answers per spec §8.4 (data-provenance grammar);
//     plumbing anywhere in the body ("I called sc_account_window..."). Any
//     appearance in body-prose fails the guard / gets stripped.
//
//   INTERNAL_IDENTIFIERS_ALWAYS - tables, views, RPCs, env-var prefixes.
//     Never sanctioned anywhere in user-facing prose. Any appearance fails
//     the guard / gets stripped, including on Source lines.
// ─────────────────────────────────────────────────────────────────────────────

export const INTERNAL_IDENTIFIERS_BODY_ONLY = [
  "sc_account_window", "sc_homestand_detail", "sc_service_price", "sc_orientation",
  "sc_portfolio_window",
  "spend_summary", "spend_vendor_history", "spend_top_vendors",
  "find_contact", "list_accounts", "list_contacts_by_role", "get_account_team",
  "search_documents", "get_document", "list_documents",
];

export const INTERNAL_IDENTIFIERS_ALWAYS = [
  "match_document_chunks",
  "sc_daily_revenue", "sc_month_summary", "sc_config_changelog", "sc_day_metadata",
  "v_invoice_submissions_current", "ai_line_items", "vendor_aliases",
  "TOOL_BUDGET", "SOUSAI_", "SUPABASE_", "ANTHROPIC_",
];

// Match a Source-shaped line (mirrors agent.js SOURCE_LINE_RE - kept
// separate to avoid a cross-file import for a two-line regex).
export const SOURCE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?source(?:s)?(?:\*\*)?\s*:/i;

/**
 * Split answer text into { body, sourceLines } so callers can apply the
 * per-zone plumbing rule (body vs Source line).
 */
export function splitAnswerZones(answerText) {
  const lines = String(answerText || "").split("\n");
  const body = [];
  const sourceLines = [];
  for (const line of lines) {
    (SOURCE_LINE_RE.test(line) ? sourceLines : body).push(line);
  }
  return { body: body.join("\n"), sourceLines: sourceLines.join("\n") };
}
