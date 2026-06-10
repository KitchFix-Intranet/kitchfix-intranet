// PR B commit 1: shared routing + labeling helpers for the Review Queue.
//
// Single source of truth for "what action is this row?" and "what does this
// reason mean in human language?" so the row component and the screen
// component agree on bucket counts + UI affordances.

// Canonical actions a row can support. Every row maps to exactly one.
//
//   INLINE_QTY    arithmetic_fail with a live ai_line_items row - operator
//                 corrects the qty inline. Ambiguity still disables Resolve
//                 (B-1 ambiguity guard).
//   MATCH_CONFIRM the row has a suggested catalog match (any reason, or even
//                 blank reason). Operator confirms / picks different / creates
//                 new in the Match-Confirm Modal (built in commit 2).
//   SKIP_ONLY     no actionable path - no math failure, no suggested match.
//                 Operator can skip; B-2 may later add inline catalog search.
export function canonicalActionFor(item) {
  if (item.reason === "arithmetic_fail") return "INLINE_QTY";
  if (item.suggestedMatchName) return "MATCH_CONFIRM";
  return "SKIP_ONLY";
}

// Human-readable label for the row header pill.
//
// The 55 blank-reason rows in the live queue all carry a suggestedMatchName at
// 80-85% confidence (recon finding) - they read the same as
// low_match_confidence semantically, so we treat them as such here.
export function reasonLabelFor(item) {
  const conf = Number(item.confidence) > 0 ? ` (${Math.round(Number(item.confidence))}%)` : "";
  switch (item.reason) {
    case "arithmetic_fail":             return "Math doesn't reconcile";
    case "low_match_confidence":        return `Match suggested${conf}`;
    case "possible_new":                return `Possibly new item${conf}`;
    case "overcount_suspect_reextract": return "Invoice-level hold";  // filtered out before list - belt + suspenders
    case "":
    case undefined:
    case null:
      return item.suggestedMatchName ? `Match suggested${conf}` : "Needs review";
    default:
      return item.reason;
  }
}

// Three-bucket counts for the dashboard stats bar. Built from the same
// canonical-action rules used to render rows.
export function bucketCounts(items) {
  let inlineQty = 0, matchConfirm = 0, skipOnly = 0;
  for (const it of items) {
    const a = canonicalActionFor(it);
    if (a === "INLINE_QTY") inlineQty++;
    else if (a === "MATCH_CONFIRM") matchConfirm++;
    else skipOnly++;
  }
  return { inlineQty, matchConfirm, skipOnly };
}
