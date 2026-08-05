"use client";

// LegendInfoPopup - the verbose detail behind the legend "i" button
// (Design Batch 2). The always-visible legend strip (StateLegend.js)
// remains the rubric non-negotiable. This popup adds supplementary
// depth:
//   - account-specific meaning of each state
//   - loading + failed cell chrome (Batch 1)
//   - MiLB day / night game cue
//
// Accessibility (rubric Part 1, Nielsen #3):
//   - role=dialog + aria-modal
//   - focus trap inside the panel
//   - Esc closes; focus returns to the trigger
//   - clicking the backdrop closes
//   - prefers-reduced-motion drops the fade

import { useEffect, useRef } from "react";
import { SunGlyph, MoonGlyph, MessageSquare, PlaneGlyph } from "../Icons";
import { getLegendItems, MILB_DAY_NIGHT, NOTE_INDICATOR } from "./legendItems";
import "./legendInfoPopup.css";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function LegendInfoPopup({
  open,
  onClose,
  triggerRef,
  hasHomestandSchedule = false,
  isFeeAccount = false,
  isMilb = false,
  hasAwayHomeDining = false,
}) {
  const panelRef = useRef(null);

  // Focus management: trap focus inside the panel, return on close.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll(FOCUSABLE);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    // Move focus into the panel.
    const onMount = setTimeout(() => {
      (first || panel).focus({ preventScroll: true });
    }, 0);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(onMount);
      document.removeEventListener("keydown", onKey);
      // Return focus to the trigger.
      triggerRef?.current?.focus({ preventScroll: true });
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div
      className="sc-legend-popup-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        className="sc-legend-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-legend-popup-title"
        tabIndex={-1}
      >
        <div className="sc-legend-popup-header">
          <h2 id="sc-legend-popup-title" className="sc-legend-popup-title">Day cell legend</h2>
          <button
            type="button"
            className="sc-legend-popup-close"
            onClick={onClose}
            aria-label="Close legend"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="sc-legend-popup-body">
          {/* Bundle B (2026-07-21): single flat list under one title.
              #14 collapsed the four prior Sections (per-account state
              list, Figures, Calendar context, Data states) into ONE
              consolidated list titled "Service Calendar Icons".
              #15 removed the Figures section outright (redundant - the
              always-visible legend bar already carries the figures key).
              #16 folded Today + Has-notes into the main list and
              deleted the "Calendar context" wrapper.
              #17-popup dropped the Game day + Spring Training legend
              entries from the popup - tile rendering of those markers
              is UNCHANGED (this is popup copy only). The filter on
              getLegendItems below drops the "game-day-mark" +
              "spring-mark" entries that HOMESTAND / FEE / PER_MEAL
              arrays append; StateLegend.js (the always-visible bar)
              consumes the same source and still receives them.
              Data states (failed / loading) survive as a subtle
              trailing group because they're a system-pipeline signal,
              not a calendar icon - keeping them titled maintains the
              distinction. */}
          <Section title="Service Calendar Icons">
            {getLegendItems({ hasHomestandSchedule, isFeeAccount, isMilb, hasAwayHomeDining })
              .filter(it => it.mod !== "game-day-mark" && it.mod !== "spring-mark")
              .map(it => (
                <Row
                  key={it.mod}
                  mod={it.mod}
                  label={it.labelLong || it.label}
                  icon={it.icon}
                >
                  {it.description}
                </Row>
              ))}
            {/* sc-15 (2026-07-11): widen the day/night popup gate to MLB
                fee accounts too - MLB home cells now render the same
                sun/moon glyph as MiLB. */}
            {(hasHomestandSchedule || (isMilb && !isFeeAccount)) && MILB_DAY_NIGHT.map(it => (
              <MilbRow
                key={it.mod}
                type={it.type}
                label={it.labelLong}
                description={it.description}
              />
            ))}
            <Row mod="today" label="Today">
              Navy outer ring on today's date.
            </Row>
            <NoteRow />
          </Section>

          <Section title="Data states">
            <Row mod="failed" label="Could not load" icon="⚠">
              Data fetch errored; the tile never falls back to a silent zero.
            </Row>
            <Row mod="loading" label="Loading">
              Data fetch in flight, no number rendered until it lands.
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="sc-legend-popup-section">
      <h3 className="sc-legend-popup-section-title">{title}</h3>
      <dl className="sc-legend-popup-rows">{children}</dl>
    </section>
  );
}

function Row({ mod, label, icon = "", children }) {
  // sc-13 (2026-07-10): AWAY swatch renders the plane glyph inside the
  // swatch so the popup + strip + tile all read the same shape.
  // sc-28 (2026-08-05): away-home-dining swatch renders the U+2302
  // HOUSE glyph in the copper family.
  const swatchContent = mod === "away"
    ? <PlaneGlyph size={12} />
    : (mod === "away-home-dining" ? "⌂" : icon);
  return (
    <div className="sc-legend-popup-row">
      <span className={`sc-legend-popup-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
        {swatchContent}
      </span>
      <div className="sc-legend-popup-row-text">
        <dt className="sc-legend-popup-row-label">{label}</dt>
        <dd className="sc-legend-popup-row-desc">{children}</dd>
      </div>
    </div>
  );
}

// P2 (item 3, R3): note-indicator row for LegendInfoPopup. Same row
// shape as the account-shape state rows so the popup's list grid
// stays consistent. Swatch renders the same 12px MessageSquare glyph
// the tile carries (11px + ~50% opacity, but the legend swatch reads
// at full opacity so the shape is unambiguous).
function NoteRow() {
  return (
    <div className="sc-legend-popup-row">
      <span className="sc-legend-popup-swatch sc-legend-popup-swatch--notebubble" aria-hidden="true">
        <MessageSquare size="12px" />
      </span>
      <div className="sc-legend-popup-row-text">
        <dt className="sc-legend-popup-row-label">{NOTE_INDICATOR.labelLong}</dt>
        <dd className="sc-legend-popup-row-desc">{NOTE_INDICATOR.description}</dd>
      </div>
    </div>
  );
}

function MilbRow({ type, label, description }) {
  return (
    <div className="sc-legend-popup-row">
      <span className={`sc-legend-popup-swatch sc-state-legend-swatch--milb-${type}`} aria-hidden="true">
        {type === "day" ? <SunGlyph size={12} /> : <MoonGlyph size={12} />}
      </span>
      <div className="sc-legend-popup-row-text">
        <dt className="sc-legend-popup-row-label">{label}</dt>
        <dd className="sc-legend-popup-row-desc">{description}</dd>
      </div>
    </div>
  );
}
