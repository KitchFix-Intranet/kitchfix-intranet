"use client";

// FinalizeToast - the "done" moment.
// PR-D of the SC -> QBO billing arc.
//
// Spec authority: addendum §A1 Done row + render flow's toast block.
// The toast carries the moment; the row settles to a quiet caption.
// Copy is dynamic on count: 1 invoice -> "AP has the invoice for review.",
// N > 1 -> "AP has {N} invoices for review." (sc-38 2026-09-02: TBJ
// finalize produces 3-8 invoices per week; the toast reflects the actual
// count from the finalize response).
// No link, no destination call-to-action - operators have no QBO
// access (addendum §A7).
//
// Auto-dismisses after 5s. Dismissible before that via click.
// prefers-reduced-motion is honored at the CSS token layer via
// --duration-* remapping.

import { useEffect } from "react";

const DEFAULT_LIFETIME_MS = 5200;

export default function FinalizeToast({ open, onDismiss, lifetimeMs, invoiceCount }) {
  const count = Number.isFinite(invoiceCount) && invoiceCount > 0 ? invoiceCount : 1;
  const subCopy = count === 1
    ? "AP has the invoice for review."
    : `AP has ${count} invoices for review.`;
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => onDismiss?.(), lifetimeMs ?? DEFAULT_LIFETIME_MS);
    return () => clearTimeout(t);
  }, [open, onDismiss, lifetimeMs]);

  if (!open) return null;

  return (
    <div
      className="sc-finalize-toast"
      role="status"
      aria-live="polite"
      data-open="true"
      onClick={onDismiss}
    >
      <span className="sc-finalize-toast-tick" aria-hidden="true">&#10003;</span>
      <div className="sc-finalize-toast-copy">
        <div className="sc-finalize-toast-title">Week finalized</div>
        <div className="sc-finalize-toast-sub">{subCopy}</div>
      </div>
    </div>
  );
}
