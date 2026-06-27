"use client";

// StateLegend - the day-cell state key (Design Batch 1 created; Batch 2
// extended to one-line + info button).
//
// The audit's non-negotiable #1: a visible legend whenever cells carry
// meaning by color + glyph. The line below is ALWAYS visible and never
// hidden behind a button. The info button next to it opens
// LegendInfoPopup with the FULLER detail (account-specific meaning,
// loading / failed states, MiLB day/night).
//
// Account-aware: only renders the states the current account actually
// renders. MLB-fee accounts omit needs-entry / overdue (no per-meal
// actuals expected). MiLB adds day/night.

import { useRef, useState } from "react";
import LegendInfoPopup from "./LegendInfoPopup";
import "./stateLegend.css";

export default function StateLegend({
  hasHomestandSchedule = false,
  isFeeAccount = false,
  isMilb = false,
}) {
  // The one-line key keeps the IN-USE states for the current account
  // (rubric non-negotiable #1: always visible). The fuller cell-state
  // taxonomy lives in the popup behind the info button.
  const items = [];
  if (hasHomestandSchedule) {
    items.push({ mod: "entered", icon: "", label: "Game day entered" });
    items.push({ mod: "upcoming", icon: "○", label: "Scheduled" });
    items.push({ mod: "off", icon: "—", label: "Prep / between" });
  } else if (isFeeAccount) {
    items.push({ mod: "entered", icon: "", label: "Entered" });
    items.push({ mod: "needs-entry", icon: "✎", label: "Needs entry" });
    items.push({ mod: "overdue", icon: "!", label: "Overdue" });
    items.push({ mod: "upcoming", icon: "○", label: "Upcoming" });
  } else if (isMilb) {
    items.push({ mod: "entered", icon: "", label: "Entered" });
    items.push({ mod: "needs-entry", icon: "✎", label: "Needs entry" });
    items.push({ mod: "overdue", icon: "!", label: "Overdue" });
    items.push({ mod: "upcoming", icon: "○", label: "Upcoming" });
    items.push({ mod: "milb-day", icon: "", label: "Day" });
    items.push({ mod: "milb-night", icon: "", label: "Night" });
  } else {
    items.push({ mod: "entered", icon: "", label: "Entered" });
    items.push({ mod: "needs-entry", icon: "✎", label: "Needs entry" });
    items.push({ mod: "overdue", icon: "!", label: "Overdue" });
    items.push({ mod: "upcoming", icon: "○", label: "Upcoming" });
  }
  // Universal trailer on every account. Off-season is back on the
  // line (Mobile Overhaul E2 / recon #2) so the hatched fill is
  // decodable without opening the popup.
  items.push({ mod: "off-season", icon: "—", label: "Off-season" });
  items.push({ mod: "today", icon: "", label: "Today" });

  const [popupOpen, setPopupOpen] = useState(false);
  const infoBtnRef = useRef(null);

  return (
    <>
      <div className="sc-state-legend" role="group" aria-label="Day cell legend">
        <span className="sc-state-legend-title">Legend</span>
        <ul className="sc-state-legend-list">
          {items.map((it) => (
            <li key={it.mod} className="sc-state-legend-item">
              <LegendSwatch mod={it.mod} icon={it.icon} />
              <span className="sc-state-legend-label">{it.label}</span>
            </li>
          ))}
        </ul>
        <button
          ref={infoBtnRef}
          type="button"
          className="sc-state-legend-info"
          onClick={() => setPopupOpen(true)}
          aria-label="Open legend detail"
          title="What do these mean?"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </button>
      </div>
      <LegendInfoPopup
        open={popupOpen}
        onClose={() => setPopupOpen(false)}
        triggerRef={infoBtnRef}
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        isMilb={isMilb}
      />
    </>
  );
}

// Each swatch is a miniature of the atom's fill + glyph for the state.
// MiLB day / night swatches are pill dots, not status fills.
// Today is a navy ring around a neutral tile (the atom's ring chrome).
function LegendSwatch({ mod, icon }) {
  if (mod === "milb-day" || mod === "milb-night") {
    return (
      <span className={`sc-state-legend-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
        <span className="sc-state-legend-pill-dot" />
      </span>
    );
  }
  return (
    <span className={`sc-state-legend-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
      {icon}
    </span>
  );
}
