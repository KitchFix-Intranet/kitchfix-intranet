"use client";
// src/app/kpi/purchasing/components/FailureCard.js
//
// PR 5 - the failure state (spec §5). CHECK 6 GATE.
//
// **A broken sync must never look like zero spend.** That has
// governed this board since the engine gates - missing, failed and
// zero are three different things and they render three different
// ways. A blank board and a genuinely quiet week are not the same
// fact, and this card is what makes the difference visible.
//
// The copy is written for someone reading it at 6am who needs to
// know whether to act - not for a developer. Terse, plain, honest:
//
//   1. What failed - "the data could not be loaded", NOT "an error
//      occurred".
//   2. When it last worked - REAL freshness timestamp from the last
//      successful sync. Never hardcoded. If freshness is absent
//      (fetch never completed on this page load), the card says so
//      instead of lying.
//   3. That these are NOT the numbers - explicit sentence: "This is
//      not a period with no spend." The eye-friendly cousin of
//      Kevin's rule that a zero cell must render distinctly from a
//      missing cell.
//   4. A retry - a real button that refires the fetch.
//
// Visual register: warm amber-left stripe on white card (matches the
// existing PassThrough placeholder and STL - MO Fun Money caution
// tokens - amber-600, amber-50). Distinct from every other card on
// the board - no bucket identity stripe, no verdict pill, no chart.
// If you see this you know the board did not load; you cannot
// misread it as a real number.

import { fmt$ } from "../lib/board";

// Format an ISO timestamp for human reading. "2026-08-24T09:15:00Z"
// -> "2026-08-24 at 09:15 UTC". Never renders "Never" without a
// caveat - null means we do not know, not "it has never worked".
function fmtWhen(iso) {
  if (!iso) return null;
  const s = String(iso);
  const t = new Date(s);
  if (!Number.isFinite(t.getTime())) return s;
  const d = t.toISOString().slice(0, 10);
  const hm = t.toISOString().slice(11, 16);
  return `${d} at ${hm} UTC`;
}

export function FailureCard({
  errorMsg,           // string | null - route error, HTTP code, timeout, etc.
  freshness,          // { last_billcom_sync, last_rippling_sync, last_derive_at } | null
  onRetry,            // () => void
}) {
  const billcomAt  = fmtWhen(freshness?.last_billcom_sync);
  const ripplingAt = fmtWhen(freshness?.last_rippling_sync);
  const deriveAt   = fmtWhen(freshness?.last_derive_at);

  return (
    <div className="kpi-p-board" role="alert" aria-live="assertive">
      <div className="kpi-p-card kpi-p-fail" data-card="board-failed">
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle kpi-p-ct-fail">
              The data could not be loaded
            </span>
            <span className="kpi-p-cardsub">
              This board is showing you the failure, not a period.
            </span>
          </div>
        </div>

        <p className="kpi-p-fail-body">
          <b>This is not a period with no spend.</b> The board could not
          reach the numbers on this attempt, so nothing you see below is
          real. Retry, and if it keeps failing, tell whoever runs the
          syncs.
        </p>

        <dl className="kpi-p-fail-when">
          <dt>When the derive last ran</dt>
          <dd>{deriveAt || "unknown"}</dd>
          <dt>Last successful bill.com sync</dt>
          <dd>{billcomAt || "unknown"}</dd>
          <dt>Last successful Rippling sync</dt>
          <dd>{ripplingAt || "unknown"}</dd>
        </dl>

        {errorMsg && (
          <p className="kpi-p-fail-tech">
            Technical detail (for whoever fixes this):
            <code className="kpi-p-fail-code">{String(errorMsg)}</code>
          </p>
        )}

        <div className="kpi-p-fail-actions">
          <button
            type="button"
            className="kpi-p-fail-retry"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
