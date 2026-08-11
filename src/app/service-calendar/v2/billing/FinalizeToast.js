"use client";

// FinalizeToast - the "done" moment.
// PR-D of the SC -> QBO billing arc.
//
// Spec authority: addendum §A1 Done row + render flow's toast block.
// The toast carries the moment; the row settles to a quiet caption.
// Copy is fixed: "Week finalized" / "AP has the invoice for review."
// No link, no destination call-to-action - operators have no QBO
// access (addendum §A7).
//
// Auto-dismisses after 5s. Dismissible before that via click.
// prefers-reduced-motion is honored at the CSS token layer via
// --duration-* remapping.

import { useEffect } from "react";

const DEFAULT_LIFETIME_MS = 5200;

export default function FinalizeToast({ open, onDismiss, lifetimeMs }) {
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
        <div className="sc-finalize-toast-sub">AP has the invoice for review.</div>
      </div>
    </div>
  );
}
