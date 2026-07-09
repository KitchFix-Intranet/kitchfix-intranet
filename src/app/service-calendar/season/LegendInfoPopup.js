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
import "./legendInfoPopup.css";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function LegendInfoPopup({
  open,
  onClose,
  triggerRef,
  hasHomestandSchedule = false,
  isFeeAccount = false,
  isMilb = false,
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
          <Section title={accountSectionTitle(hasHomestandSchedule, isFeeAccount, isMilb)}>
            {hasHomestandSchedule ? (
              <>
                <Row mod="entered" label="Entered">
                  Actuals recorded. Includes game days (any recorded meal count, zero counts as a
                  cancelled game) and non-game days where meals were served.
                </Row>
                <Row mod="upcoming" label="Scheduled game day">
                  An upcoming game on the homestand schedule.
                </Row>
                <Row mod="off" label="Non Game day">
                  Prep, open, close, or off-day between homestands.
                </Row>
              </>
            ) : isFeeAccount ? (
              <>
                <Row mod="entered" label="Entered">
                  Service confirmed - actuals recorded.
                </Row>
                <Row mod="needs-entry" label="Needs entry" icon="✎">
                  Past day with no actuals yet - action required.
                </Row>
                <Row mod="overdue" label="Overdue" icon="!">
                  Past entry deadline - escalated action.
                </Row>
                <Row mod="upcoming" label="Upcoming" icon="○">
                  Future service day; nothing required yet.
                </Row>
              </>
            ) : isMilb ? (
              <>
                <Row mod="entered" label="Entered">
                  Service confirmed - actuals recorded.
                </Row>
                <Row mod="needs-entry" label="Needs entry" icon="✎">
                  Past day with no actuals yet.
                </Row>
                <Row mod="overdue" label="Overdue" icon="!">
                  Past entry deadline - escalated.
                </Row>
                <Row mod="upcoming" label="Upcoming" icon="○">
                  Future service day.
                </Row>
                <MilbRow type="day" label="Day game" />
                <MilbRow type="night" label="Night game" />
              </>
            ) : (
              <>
                <Row mod="entered" label="Entered">
                  Actuals recorded.
                </Row>
                <Row mod="needs-entry" label="Needs entry" icon="✎">
                  Past day with no actuals yet - action required.
                </Row>
                <Row mod="overdue" label="Overdue" icon="!">
                  Past entry deadline - escalated.
                </Row>
                <Row mod="upcoming" label="Upcoming" icon="○">
                  Future service day; nothing required yet.
                </Row>
              </>
            )}
          </Section>

          <Section title="Figures">
            {/* SC-041: key the est./~/bare encoding operators see on
                the drill-in tiles. Per-meal + MiLB carry $; fee variants
                get the ~ line only (they encode projected meals, not $). */}
            {hasHomestandSchedule || isFeeAccount ? (
              <FigureRow chip="~180 meals" label="Projected" desc="Upcoming day - counts are the plan, no actuals yet." />
            ) : (
              <>
                <FigureRow chip="~$3K" label="Projected" desc="Upcoming day - the figure is the plan, no actuals yet." />
                <FigureRow chip="est. $3K" label="Estimate" desc="Past day awaiting entry - the figure is the estimate the tile carries until you save actuals." />
                <FigureRow chip="$3K" label="Entered" desc="Actuals recorded. Bare figure means the number is the operator-recorded truth." />
              </>
            )}
          </Section>

          <Section title="Calendar context">
            <Row mod="today" label="Today">
              Today's date carries a navy outer ring.
            </Row>
          </Section>

          <Section title="Data states">
            <Row mod="failed" label="Could not load" icon="⚠">
              The data fetch errored. The cell never falls back to a silent zero - this dashed treatment surfaces the failure.
            </Row>
            <Row mod="loading" label="Loading">
              Data fetch in flight; no number rendered until it lands.
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}

function accountSectionTitle(hasHomestand, isFeeAccount, isMilb) {
  if (hasHomestand) return "Homestand-fee account";
  if (isFeeAccount) return "Operational-only account";
  if (isMilb) return "MiLB hybrid account";
  return "Per-meal account";
}

function Section({ title, children }) {
  return (
    <section className="sc-legend-popup-section">
      <h3 className="sc-legend-popup-section-title">{title}</h3>
      <dl className="sc-legend-popup-rows">{children}</dl>
    </section>
  );
}

// SC-041: text-only row for the Figures section. The "swatch" is the
// figure notation itself; no color to inherit, no glyph. Same DOM
// shape as Row so it slots into the popup's dl/row grid.
function FigureRow({ chip, label, desc }) {
  return (
    <div className="sc-legend-popup-row">
      <span className="sc-legend-popup-swatch sc-legend-popup-swatch--figure" aria-hidden="true">
        {chip}
      </span>
      <div className="sc-legend-popup-row-text">
        <dt className="sc-legend-popup-row-label">{label}</dt>
        <dd className="sc-legend-popup-row-desc">{desc}</dd>
      </div>
    </div>
  );
}

function Row({ mod, label, icon = "", children }) {
  return (
    <div className="sc-legend-popup-row">
      <span className={`sc-legend-popup-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
        {icon}
      </span>
      <div className="sc-legend-popup-row-text">
        <dt className="sc-legend-popup-row-label">{label}</dt>
        <dd className="sc-legend-popup-row-desc">{children}</dd>
      </div>
    </div>
  );
}

function MilbRow({ type, label }) {
  return (
    <div className="sc-legend-popup-row">
      <span className={`sc-legend-popup-swatch sc-state-legend-swatch--milb-${type}`} aria-hidden="true">
        {type === "day" ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
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
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </span>
      <div className="sc-legend-popup-row-text">
        <dt className="sc-legend-popup-row-label">{label}</dt>
        <dd className="sc-legend-popup-row-desc">
          {type === "day" ? "Day game - amber sun on the homestand day." : "Night game - navy moon on the homestand day."}
        </dd>
      </div>
    </div>
  );
}
