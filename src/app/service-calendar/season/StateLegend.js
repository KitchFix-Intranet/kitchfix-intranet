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
import { SunGlyph, MoonGlyph, PlaneGlyph } from "../Icons";
import { getLegendItems, MILB_DAY_NIGHT } from "./legendItems";
import "./stateLegend.css";

export default function StateLegend({
  hasHomestandSchedule = false,
  isFeeAccount = false,
  isMilb = false,
  showDayNight = false,
  // DP2-05 (2026-07-20): compact FIGURES trailer in the drill legend
  // bar. Off by default (v1 + overview call sites don't set it);
  // scv2 drill mounts opt in. Matches the tile figure grammar the
  // popup already teaches (LegendInfoPopup.js:125-138): per-meal /
  // MiLB carry the $ triad ($3K entered · est. $3K awaiting · ~$3K
  // projected); fee/homestand carry just ~180 meals projected
  // (fee tiles encode meals, not $). DP1-20's popup-side scoping
  // deferral is separate; this addition targets the always-visible
  // bar per the DP1-20 owner ask.
  showFigures = false,
}) {
  // The one-line key keeps the IN-USE states for the current account
  // (rubric non-negotiable #1: always visible). The fuller cell-state
  // taxonomy lives in the popup behind the info button. Source:
  // ./legendItems.js (shared with LegendInfoPopup).
  const items = getLegendItems({ hasHomestandSchedule, isFeeAccount, isMilb }).map(it => ({
    mod: it.mod, icon: it.icon, label: it.label,
  }));
  // sc-15 (2026-07-11): widen the day/night legend gate to MLB fee
  // accounts too. MLB home cells now carry the same sun/moon glyph
  // as MiLB (backfilled from MLB Stats API dayNight into
  // sc_homestand_schedule.day_night), so both account shapes need
  // the day/night pair in the compact strip.
  if (hasHomestandSchedule || (isMilb && !isFeeAccount)) {
    items.push(...MILB_DAY_NIGHT.map(it => ({ mod: it.mod, icon: "", label: it.label })));
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
        {showFigures && (
          <span className="sc-state-legend-figures" aria-label="Tile figures key">
            <span className="sc-state-legend-figures-title">Figures</span>
            {(hasHomestandSchedule || isFeeAccount) ? (
              <span className="sc-state-legend-figures-item">
                <span className="sc-state-legend-figures-chip">~180 meals</span>
                <span className="sc-state-legend-figures-word">projected</span>
              </span>
            ) : (
              <>
                <span className="sc-state-legend-figures-item">
                  <span className="sc-state-legend-figures-chip">$3K</span>
                  <span className="sc-state-legend-figures-word">entered</span>
                </span>
                <span className="sc-state-legend-figures-item">
                  <span className="sc-state-legend-figures-chip">est. $3K</span>
                  <span className="sc-state-legend-figures-word">awaiting</span>
                </span>
                <span className="sc-state-legend-figures-item">
                  <span className="sc-state-legend-figures-chip">~$3K</span>
                  <span className="sc-state-legend-figures-word">projected</span>
                </span>
              </>
            )}
          </span>
        )}
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
  if (mod === "milb-day") {
    return (
      <span className="sc-state-legend-swatch sc-state-legend-swatch--milb-day" aria-hidden="true">
        <SunGlyph size={10} />
      </span>
    );
  }
  if (mod === "milb-night") {
    return (
      <span className="sc-state-legend-swatch sc-state-legend-swatch--milb-night" aria-hidden="true">
        <MoonGlyph size={10} />
      </span>
    );
  }
  // sc-13 (2026-07-10): AWAY swatch carries the plane glyph the atom
  // renders top-right on the tile, so the legend and the cell read the
  // same shape at a glance (colorblind-safe alongside the muted hue).
  if (mod === "away") {
    return (
      <span className="sc-state-legend-swatch sc-state-legend-swatch--away" aria-hidden="true">
        <PlaneGlyph size={10} />
      </span>
    );
  }
  // OV-3 F9: game-day / spring markers show the SAME notch
  // construction as tiles - no glyph inside; the corner brackets are
  // drawn by CSS via ::before/::after on the swatch itself (see
  // stateLegend.css: F9 rules).
  if (mod === "game-day-mark" || mod === "spring-mark") {
    return (
      <span
        className={`sc-state-legend-swatch sc-state-legend-swatch--${mod}`}
        aria-hidden="true"
      />
    );
  }
  return (
    <span className={`sc-state-legend-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
      {icon}
    </span>
  );
}
