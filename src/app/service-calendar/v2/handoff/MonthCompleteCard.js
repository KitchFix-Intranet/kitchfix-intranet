"use client";
// ═══════════════════════════════════════════════════════════════════
// MonthCompleteCard (Phase 3-B, 2026-07-28)
// ═══════════════════════════════════════════════════════════════════
//
// Fires when a save completes the drill month. Bright green #25a866
// (owner pick: amber reserved for needs-attention). closeRing 1.15s +
// check draw .5s @1s per the render's beat table (RENDER_HANDOFF_
// BLENDED.html:150-158). Actions: "Stay in July" / "Back to season"
// (labels adapt to the active scope).
//
// Trigger: coordinator's `monthComplete` state, set via startHandoff's
// `monthComplete` payload from the caller (ServiceCalendar computes
// whether the save completes the month by comparing periodMetrics
// pre-save vs post-save; when complete becomes total, fire the card).
//
// Dismissal:
//   "Stay" -> dismissMonthComplete() only; drill stays where it is.
//   "Back to season" -> dismissMonthComplete() + router push (via
//                       onBackToSeason prop from ServiceCalendar).

import { useHandoffSafe } from "./coordinator";

export default function MonthCompleteCard({ onBackToSeason, scopeLabel = "period" }) {
  const { monthComplete, dismissMonthComplete } = useHandoffSafe();
  if (!monthComplete) return null;
  const stayLabel = monthComplete.stayLabel || `Stay in ${scopeLabel}`;
  return (
    <div
      className="sc-monthcomplete-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sc-monthcomplete-title"
      onClick={(e) => { if (e.target === e.currentTarget) dismissMonthComplete(); }}
    >
      <div className="sc-monthcomplete-card">
        <div className="sc-monthcomplete-ring" aria-hidden="true">
          <svg viewBox="0 0 112 112">
            <circle className="sc-monthcomplete-ring-bg" cx="56" cy="56" r="48" />
            <circle
              className="sc-monthcomplete-ring-fg"
              cx="56"
              cy="56"
              r="48"
            />
          </svg>
          <div className="sc-monthcomplete-check">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
        <h3 id="sc-monthcomplete-title" className="sc-monthcomplete-title">
          {monthComplete.title || "Month cleared"}
        </h3>
        <p className="sc-monthcomplete-body">
          {monthComplete.body || "Every day this month is entered. Nothing left in this scope."}
        </p>
        <div className="sc-monthcomplete-actions">
          <button
            type="button"
            className="sc-btn sc-btn--outline"
            onClick={dismissMonthComplete}
          >
            {stayLabel}
          </button>
          <button
            type="button"
            className="sc-btn sc-btn--primary"
            onClick={() => {
              dismissMonthComplete();
              onBackToSeason?.();
            }}
          >
            Back to season
          </button>
        </div>
      </div>
    </div>
  );
}
