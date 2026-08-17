// src/app/kpi/labor/lib/boardCopy.js
//
// Copy helpers for the board. Sentence templates + pluralizations only;
// the money numbers themselves come from board (server-computed).

import { fmt$ } from "./formatting.js";

// V8-6 sentence templates. `board` is the server payload; `account`
// is the display key ("CIN - AZ" or "ALL"); `rangeLabel` is the client's
// resolved range label used only for the multi-period template.
export function verdictVerb(board) {
  // Returns { verb, amount } where verb is "under" | "over" | "on pace with".
  // amount is the absolute variance for the numeric formatter, or null.
  const v = board?.variance;
  if (v == null) return { verb: null, amount: null };
  if (Math.abs(v) < 0.5) return { verb: "on pace with", amount: null };
  if (v < 0) return { verb: "under", amount: Math.abs(v) };
  return { verb: "over", amount: Math.abs(v) };
}

function periodLabel(n) { return `Period ${n}`; }

// Return the sentence fragments so the caller can bold the money and
// the fraction. Structure: { pre, verdictBold, mid, fractionBold?, post }
export function buildSentence({ board, account, rangeLabel }) {
  if (!board || board.applies === false) {
    return {
      pre: `${account} - `,
      verdictBold: null,
      mid: rangeLabel ? rangeLabel : "range",
      post: "",
      hasVerdict: false,
      reason: board?.reason || "no_budget",
    };
  }
  if (board.kind === "no_budget") {
    return {
      pre: `${account} has no budget for `,
      verdictBold: null,
      mid: rangeLabel || "this range",
      post: ".",
      hasVerdict: false,
      reason: "no_budget",
    };
  }
  const { verb, amount } = verdictVerb(board);
  const verdictBold = verb === "on pace with" ? "on pace with" : (amount != null ? `${fmt$(amount)} ${verb}` : verb);
  if (board.kind === "single_period_in_progress") {
    const closed = board.closed_weeks_count || 0;
    const inProg = board.in_progress_week_start ? 1 : 0;
    const done = closed + inProg;
    const label = periodLabel(board.period_no);
    return {
      pre: `${account} is `,
      verdictBold,
      mid: ` its ${label} labor budget with `,
      fractionBold: `${done} of ${board.weeks_in_period} weeks`,
      post: " in.",
      hasVerdict: true,
    };
  }
  if (board.kind === "single_period_closed") {
    const label = periodLabel(board.period_no);
    return {
      pre: `${account} finished `,
      verdictBold,
      mid: ` its ${label} labor budget.`,
      post: "",
      hasVerdict: true,
    };
  }
  if (board.kind === "multi_period") {
    // Prefer the semantic range label ("May 2026", "the last 4 weeks",
    // "fiscal year to date") when the client resolved one; otherwise
    // fall back to the period span. Never emit an ISO-range fallback
    // as the sentence body - use the span instead.
    const isSemantic = rangeLabel && !/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(rangeLabel);
    const span = isSemantic
      ? rangeLabel
      : (board.period_span
        ? (board.period_span.first === board.period_span.last
          ? `Period ${board.period_span.first}`
          : `P${board.period_span.first}-P${board.period_span.last}`)
        : "this range");
    return {
      pre: `${account} is `,
      verdictBold,
      mid: ` budget across ${span}.`,
      post: "",
      hasVerdict: true,
    };
  }
  return { pre: `${account}`, verdictBold: null, mid: rangeLabel || "", post: "", hasVerdict: false };
}

// V8-7 - map verdict token to display copy + CSS class.
export function verdictDisplay(verdict) {
  if (verdict === "on_track") return { label: "ON TRACK", cls: "good" };
  if (verdict === "watch") return { label: "WATCH", cls: "warn" };
  if (verdict === "over") return { label: "OVER", cls: "bad" };
  return null;
}
