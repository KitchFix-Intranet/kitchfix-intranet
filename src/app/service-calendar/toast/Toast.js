"use client";
// ═══════════════════════════════════════════════════════════════════
// Toast - the single confirmation shape for the Service Calendar.
// PR-K (2026-08-18). Design authority: docs/design/
// KF_TOAST_SYSTEM_AND_MATRIX_POLISH.html.
// ═══════════════════════════════════════════════════════════════════
//
// Supersedes three prior SC confirmation surfaces:
//   1. SubmissionToast (green pill + progress bar) - page.js:174
//   2. SaveConfirmation (white centred stamp overlay) - ServiceCalendar
//      :4042; hoisted out of the modal because the modal unmounts on
//      post-save refetch. Same hoist pattern applies here.
//   3. Cream "No service recorded" block inside the day modal -
//      DayEntryV2.js:1378-1388 (justSaved + noService).
//
// Also absorbs ResetToast (day-cleared subtle pill) so all four
// post-action confirmations in SC speak the same shape.
//
// SCOPE FENCE: this component is SC-scoped per Kevin ruling
// 2026-08-18. oh-toast remains the primitive on Financial and Ops
// pages until they get their own polish pass. Documented in
// GOTCHAS as a deliberate inconsistency.
//
// Contract:
//   - Bottom-centre, dark surface, single shape.
//   - Icon carries state (ok / warn / bad). Kevin ruling: state-by-
//     shape + colour so a colour-blind operator distinguishes success
//     from failure by the glyph (check / bang) alone.
//   - Auto-dismiss at 5s. PAUSES on hover; timer restarts on unhover.
//     Early dismiss via close (x) button.
//   - Undo REPLACES close on reversible variants (marked no service,
//     day cleared). Undo actually reverses the action via a caller-
//     supplied onAction that re-POSTs through sc-submit-day - NEVER a
//     client-side visual revert. Kevin explicit fence.
//   - Progress bar renders only on the bulk variant. A month-completion
//     bar on a single-day save is noise (Kevin).
//   - Live-region role: polite for success / caution, assertive for
//     failure.
//   - Respects prefers-reduced-motion via CSS media block.

import { useEffect, useRef, useState } from "react";

const ICON_TIER = {
  ok:   { path: "M20 6L9 17l-5-5", swClass: "sc-toast-icon--ok"   }, // check
  warn: { path: null, glyph: "!",  swClass: "sc-toast-icon--warn" }, // exclamation
  bad:  { path: null, glyph: "!",  swClass: "sc-toast-icon--bad"  }, // exclamation red
};

const DEFAULT_LIFETIME_MS = 5000;

export default function Toast({
  title,                   // "Day saved" etc.
  detail = null,           // second-line copy
  tier = "ok",             // "ok" | "warn" | "bad"
  progress = null,         // { pct, label } - bulk variant only
  actionLabel = null,      // "Undo" | "Try again"
  onAction = null,         // async () => void - the reversing POST
  onDismiss,               // () => void - required
  lifetimeMs = DEFAULT_LIFETIME_MS,
}) {
  const [hovered, setHovered] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Auto-dismiss timer. Pauses while hovered - a re-render with
  // hovered=true clears the timer and the effect re-arms on unhover.
  useEffect(() => {
    if (hovered || actionPending) return;
    const id = setTimeout(() => dismissRef.current?.(), lifetimeMs);
    return () => clearTimeout(id);
  }, [hovered, actionPending, lifetimeMs]);

  const iconMeta = ICON_TIER[tier] || ICON_TIER.ok;
  // Live-region role. Failure needs immediate AT announcement so a
  // pilot doesn't miss "Save failed" while typing the next entry;
  // success and caution announce politely.
  const liveRole = tier === "bad" ? "alert" : "status";
  const liveAria = tier === "bad" ? "assertive" : "polite";

  const handleAction = async () => {
    if (!onAction || actionPending) return;
    setActionPending(true);
    try {
      await onAction();
    } finally {
      // On success the caller typically dismisses this toast and
      // fires a follow-up (e.g. "Undo saved" or the failure variant).
      // On failure the toast stays so the operator can retry.
      setActionPending(false);
    }
  };

  return (
    <div
      className={`sc-toast sc-toast--${tier}`}
      role={liveRole}
      aria-live={liveAria}
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      <span className={`sc-toast-icon ${iconMeta.swClass}`} aria-hidden="true">
        {iconMeta.path ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={iconMeta.path} />
          </svg>
        ) : (
          <span className="sc-toast-icon-glyph">{iconMeta.glyph}</span>
        )}
      </span>

      <div className="sc-toast-body">
        <div className="sc-toast-title">{title}</div>
        {detail && <div className="sc-toast-detail">{detail}</div>}
        {progress && (
          <>
            <div
              className="sc-toast-bar"
              role="progressbar"
              aria-valuenow={Number.isFinite(progress.pct) ? Math.round(progress.pct) : 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className="sc-toast-bar-fill"
                style={{ width: `${Number.isFinite(progress.pct) ? Math.round(progress.pct) : 0}%` }}
              />
            </div>
            {progress.label && (
              <div className="sc-toast-detail sc-toast-detail--muted">{progress.label}</div>
            )}
          </>
        )}
        {actionLabel && onAction && (
          <button
            type="button"
            className="sc-toast-action"
            onClick={handleAction}
            disabled={actionPending}
          >
            {actionPending ? "..." : actionLabel}
          </button>
        )}
      </div>

      <button
        type="button"
        className="sc-toast-x"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
