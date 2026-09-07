"use client";
// ═══════════════════════════════════════════════════════════════════
// BulkResetConfirm - confirmation modal for the bulk-reset action.
// 2026-09-07 (owner ruling).
// ═══════════════════════════════════════════════════════════════════
//
// Voice matches ResetConfirm (DayEntryV2.js) and ArchiveGroupModal
// (AdminModals.js) - names what happens, not "are you sure":
//   - Day count + span in the title
//   - Body says all counts clear, days return to needing entry, and
//     a Ledger note posts per day (Kevin's audit-trail promise)
//   - Amber warning accent rail (same as ResetConfirm / NoServiceConfirm)
//   - Cancel on the left, primary destructive on the right
//   - Cancel focused by default so a stray Enter doesn't fire the reset
//
// Kevin ruling 2026-09-07: N=1 routes through this same confirm; the
// copy collapses cleanly ("Reset 1 day · Fri Aug 29?") and the code
// path is single. Two implementations of the same operation is how
// they drift.
//
// Uses the shared .sc-overlay-* + .sc-btn primitives so no new CSS
// lands with this component - just JSX + the existing token layer.

import { useEffect, useRef } from "react";

// Formats an ISO date to "Mon Aug 25". Local to this component so we
// do not couple to season/format's fmt$ + friends.
function fmtDayShort(iso) {
  if (!iso) return "";
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return String(iso);
  }
}

export default function BulkResetConfirm({ open, dates, onCancel, onConfirm }) {
  const cancelBtnRef = useRef(null);
  useEffect(() => {
    if (open) cancelBtnRef.current?.focus();
  }, [open]);
  if (!open) return null;
  const sorted = [...(dates || [])].sort();
  const dayCount = sorted.length;
  if (dayCount === 0) return null;
  const spanLabel = dayCount === 1
    ? `Reset 1 day · ${fmtDayShort(sorted[0])}?`
    : `Reset ${dayCount} days · ${fmtDayShort(sorted[0])} to ${fmtDayShort(sorted[dayCount - 1])}?`;
  const primaryLabel = dayCount === 1 ? "Reset 1 day" : `Reset ${dayCount} days`;
  return (
    <div
      className="sc-overlay-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sc-bulk-reset-confirm-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="sc-overlay-card sc-ar--top sc-ar--warning" style={{ maxWidth: 440 }}>
        <div style={{ padding: "20px 24px" }}>
          <h4
            id="sc-bulk-reset-confirm-title"
            style={{ margin: "0 0 8px", fontSize: "1.05rem", fontWeight: 700 }}
          >
            {spanLabel}
          </h4>
          <p style={{ margin: "0 0 16px", fontSize: "0.95rem", lineHeight: 1.4 }}>
            All recorded counts for {dayCount === 1 ? "this day go" : `these ${dayCount} days go`} away.
            Each day returns to its projections and needs entry again.
            A reset entry is added to the Ledger for every day.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              ref={cancelBtnRef}
              type="button"
              className="sc-btn sc-btn--outline"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sc-btn sc-btn--primary"
              onClick={onConfirm}
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
