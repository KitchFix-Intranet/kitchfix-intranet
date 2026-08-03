"use client";
// SaveConfirmation - the stamp shown after a clean save (owner-approved
// option C render, 2026-08-03).
//
// Lives entirely inside the modal. No coordinator, no cross-surface
// refs, no phase machine - the Handoff flight failed on that shape
// and this deliberately does not replicate any of it.
//
// Non-negotiables per the ticket:
//   - Fires on clean save only. Not queued, not failed, not
//     mark-no-service. That gate is enforced at the call site
//     (DayEntryV2.executeConfirm); this component just renders.
//   - Numbers must be the SERVER-echoed savedMeals / savedRevenue
//     (route.js:988). Caller passes them via props; this component
//     does not compute totals.
//   - Fee shape drops the money. Caller passes revenue=null on fee
//     accounts; the money line does not render.
//   - Reduced motion collapses to the end state via the SAME markup
//     at frame zero. The base CSS positions every element at its
//     resting state; @keyframes only add the arrival/burst/fade
//     motion. Under RM (via CSS media block on the animation
//     shorthand), animations do not play and the base positions
//     render immediately.
//   - Never blocks. No button, no dismiss, no focus trap. Pointer
//     events pass through the wrapper.
//   - Announce it once, politely, for AT users. Visual body is
//     aria-hidden; a dedicated SR-only region carries the spoken
//     confirmation. Meal count + money only, matching the visible.

import { fmt$ } from "../../season/format";

export default function SaveConfirmation({ meals, revenue }) {
  const showMoney = revenue != null;
  const mealsLabel = `${(meals ?? 0).toLocaleString()} meal${meals === 1 ? "" : "s"}`;
  const moneyLabel = showMoney ? fmt$(revenue) : "";
  const srSentence = showMoney
    ? `Saved. ${mealsLabel}. ${moneyLabel}.`
    : `Saved. ${mealsLabel}.`;

  return (
    <div className="sc-v2-entry-save-confirm">
      {/* Visual: entirely decorative. aria-hidden keeps it out of the
          accessibility tree so AT does not narrate the stamp glyph or
          the numbers twice. */}
      <div className="sc-v2-entry-save-confirm-visual" aria-hidden="true">
        <div className="sc-v2-entry-save-confirm-scrim" />
        <div className="sc-v2-entry-save-confirm-body">
          <div className="sc-v2-entry-save-confirm-burst">
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                className="sc-v2-entry-save-confirm-burst-dot"
                style={{ "--sc-burst-i": i }}
              />
            ))}
          </div>
          <div className="sc-v2-entry-save-confirm-stamp">
            <svg
              className="sc-v2-entry-save-confirm-check"
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="7 16 14 23 25 10" />
            </svg>
          </div>
          <div className="sc-v2-entry-save-confirm-count">{mealsLabel}</div>
          {showMoney && (
            <div className="sc-v2-entry-save-confirm-money">{moneyLabel}</div>
          )}
        </div>
      </div>
      {/* Announcement: single polite live region. `role="status"` gives
          us aria-live=polite by default; the explicit attribute is
          belt-and-suspenders. Rendered as SR-only via CSS. */}
      <span
        className="sc-v2-entry-save-confirm-sr"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {srSentence}
      </span>
    </div>
  );
}
