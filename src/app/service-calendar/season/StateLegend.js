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
  showDayNight = false,
}) {
  // The one-line key keeps the IN-USE states for the current account
  // (rubric non-negotiable #1: always visible). The fuller cell-state
  // taxonomy lives in the popup behind the info button.
  const items = [];
  if (hasHomestandSchedule) {
    items.push({ mod: "entered", icon: "", label: "Game day entered" });
    items.push({ mod: "upcoming", icon: "○", label: "Scheduled" });
    items.push({ mod: "off", icon: "", label: "Non Game day" });
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
    // Sun / moon read across both year + drill-in surfaces now that
    // the tile uses the same glyphs (P6). showDayNight prop is
    // retained on the signature for compat, but no longer gates.
    items.push({ mod: "milb-day", icon: "", label: "Day" });
    items.push({ mod: "milb-night", icon: "", label: "Night" });
  } else {
    items.push({ mod: "entered", icon: "", label: "Entered" });
    items.push({ mod: "needs-entry", icon: "✎", label: "Needs entry" });
    items.push({ mod: "overdue", icon: "!", label: "Overdue" });
    items.push({ mod: "upcoming", icon: "○", label: "Upcoming" });
  }
  // Universal trailer. Off-season dropped from the line - it's now flat
  // grey and self-evident (still explained in the info popup). Today
  // stays; the navy ring is worth calling out.
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
// MiLB day / night carry the same sun / moon glyphs used on the tile
// (P6), so the legend and the tiles read the same language.
// Today is a navy ring around a neutral tile (the atom's ring chrome).
function LegendSwatch({ mod, icon }) {
  if (mod === "upcoming") {
    // SC-001: swatch mirrors the tile's ring element instead of the
    // "○" text glyph so the legend and cells share one language.
    return (
      <span className="sc-state-legend-swatch sc-state-legend-swatch--upcoming" aria-hidden="true">
        <span className="sc-state-legend-swatch-ring" />
      </span>
    );
  }
  if (mod === "milb-day") {
    return (
      <span className="sc-state-legend-swatch sc-state-legend-swatch--milb-day" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
            <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
            <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
            <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
          </g>
        </svg>
      </span>
    );
  }
  if (mod === "milb-night") {
    return (
      <span className="sc-state-legend-swatch sc-state-legend-swatch--milb-night" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`sc-state-legend-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
      {icon}
    </span>
  );
}
