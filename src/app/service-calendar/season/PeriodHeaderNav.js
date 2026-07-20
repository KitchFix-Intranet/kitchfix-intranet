"use client";

// PeriodHeaderNav - consolidated drill-in header for the chrome bar
// (PR 3 of the SC drill-in alignment). Replaces PeriodWorkspace's
// standalone NavRow + <header> pair with one band inside ChromeBar:
// account/badge (owned by ChromeBar) + Season back + Period stepper
// + range + phase dot-and-label, plus a Today chip on the right.
//
// PRESENTATIONAL. Phase + range are derived from props; the parent
// (ServiceCalendar) lifts the four nav handlers.

import { useMemo } from "react";
import { derivePhaseTimeline, derivePeriodPhase, rangeIntersectsSpring } from "./phaseDerivation";
import { CANONICAL_PHASES } from "./phaseCalendar";
import { ChevronLeft, ChevronRight } from "../Icons";

export default function PeriodHeaderNav({
  account,
  year,
  periodKey,
  periodRange,
  canPrev,
  canNext,
  onClimbToSeason,
  onPrevPeriod,
  onNextPeriod,
  isLoading = false,          // periodRanges hasn't landed yet - render a
                              // loading affordance (skeleton range/phase +
                              // pulsing disabled arrows) so the operator
                              // reads "still loading," not "broken."
}) {
  const phaseTimeline = useMemo(
    () => derivePhaseTimeline(account?.key, account?.category, year),
    [account?.key, account?.category, year]
  );
  const phaseAssignment = useMemo(
    () => derivePeriodPhase(periodRange, phaseTimeline),
    [periodRange, phaseTimeline]
  );
  const phaseMeta = phaseAssignment?.primary
    ? CANONICAL_PHASES[phaseAssignment.primary]
    : null;

  // sc-19 (2026-07-12): "Spring Training" chrome rider. Fires when
  // the period's range intersects ANY spring-training block (not just
  // when spring is the majority phase). Copper color, following the
  // existing "· Off-season" dot+label pattern. Displaces the
  // majority-phase pill ONLY when that pill would ALSO be Spring
  // Training (avoid double-rendering "Spring Training" twice).
  const inSpring = useMemo(
    () => rangeIntersectsSpring(phaseTimeline, periodRange?.start, periodRange?.end),
    [phaseTimeline, periodRange?.start, periodRange?.end]
  );
  const showMajorityPhasePill = phaseMeta && !(inSpring && phaseAssignment?.primary === "spring-training");

  const periodNum = periodKey ? String(periodKey).replace(/^P/i, "") : "";
  const range = periodRange
    ? fmtDateRange(periodRange.start, periodRange.end)
    : "";

  return (
    <div className="sc-chrome-drill" aria-label="Period navigation">
      <span className="sc-chrome-drill-sep" aria-hidden="true" />
      <button
        type="button"
        className="sc-chrome-drill-back"
        onClick={onClimbToSeason}
        aria-label="Back to Season"
      >
        <ChevronLeft size="sm" />
        Season
      </button>
      <span className="sc-chrome-drill-sep" aria-hidden="true" />
      <div className="sc-chrome-drill-step" aria-busy={isLoading || undefined}>
        <button
          type="button"
          className="sc-chrome-drill-step-btn"
          disabled={!canPrev}
          onClick={onPrevPeriod}
          aria-label="Previous period"
        >
          <ChevronLeft size="sm" />
        </button>
        <span className="sc-chrome-drill-period">Period {periodNum}</span>
        <button
          type="button"
          className="sc-chrome-drill-step-btn"
          disabled={!canNext}
          onClick={onNextPeriod}
          aria-label="Next period"
        >
          <ChevronRight size="sm" />
        </button>
      </div>
      {isLoading ? (
        <>
          <span className="sc-chrome-drill-dot" aria-hidden="true">·</span>
          <span className="sc-chrome-drill-skel" aria-hidden="true" />
        </>
      ) : (
        <>
          {range && (
            <>
              <span className="sc-chrome-drill-dot" aria-hidden="true">·</span>
              <span className="sc-chrome-drill-range">{range}</span>
            </>
          )}
          {showMajorityPhasePill && (
            <>
              <span className="sc-chrome-drill-dot" aria-hidden="true">·</span>
              {/* SC-044: visual label stays abbreviated for width, but
                  the accessible name + hover title carry the full phase
                  name so operators / SR users can decode "Complex" as
                  "Complex League phase". */}
              <span
                className="sc-chrome-drill-phase"
                title={`${phaseMeta.label} phase`}
                aria-label={`${phaseMeta.label} phase`}
              >
                <span
                  className="sc-chrome-drill-phase-dot"
                  style={{ background: phaseMeta.tint }}
                  aria-hidden="true"
                />
                {chromePhaseLabel(phaseMeta.label)}
              </span>
            </>
          )}
          {inSpring && (
            <>
              {/* sc-19 (2026-07-12): copper Spring Training rider - full
                  label + copper dot, distinct from the pale-blue
                  spring-training tint the majority-phase pill would use.
                  When the majority phase IS spring, that pill is
                  suppressed above to avoid double-rendering. */}
              <span className="sc-chrome-drill-dot" aria-hidden="true">·</span>
              <span
                className="sc-chrome-drill-phase sc-chrome-drill-phase--spring"
                title="Spring Training phase"
                aria-label="Spring Training phase"
              >
                <span
                  className="sc-chrome-drill-phase-dot sc-chrome-drill-phase-dot--spring"
                  aria-hidden="true"
                />
                Spring Training
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function PeriodTodayChip({ today, isCurrentPeriod, onTodayJump }) {
  // Design review 2026-07-11 (Kevin): the pill reads "Today" only.
  // The date range already lives to the left in the header, so the
  // "· {date}" trailer was carrying redundant information at the
  // expense of horizontal space at Period 13 + long ranges. Applies
  // to both PERIOD and MONTH drill-in headers (this same component
  // is threaded from both ServiceCalendar.js sites - see :1914,
  // :1920 - so one edit covers both views). `today` param retained
  // for the aria-label narrative and future re-widening if the
  // ChromeBar reflows around it.
  const content = (
    <>
      <TargetIcon />
      Today
    </>
  );
  if (isCurrentPeriod) {
    return (
      <span
        className="sc-chrome-drill-today sc-chrome-drill-today--here"
        aria-current="true"
      >
        {content}
      </span>
    );
  }
  const ariaLabel = today ? `Jump to ${formatHumanDate(today)}` : "Jump to today";
  return (
    <button
      type="button"
      className="sc-chrome-drill-today"
      onClick={onTodayJump}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  );
}

// HF-7 (2026-07-20) - overview ribbon Today-jump. Scrolls the current-
// month card into view + pulses it briefly. Rendered inside the
// overview ribbon's Today-group (same visual as PeriodTodayChip's
// button variant, same .sc-chrome-drill-today class). If the current-
// month card cannot be located (e.g. viewing a non-current year, or
// off-season with no [data-state="current"] card), the component
// returns null - hidden rather than present-but-dead per owner ruling.
export function OverviewTodayChip({ hasCurrentMonth, onTodayJump }) {
  if (!hasCurrentMonth) return null;
  return (
    <button
      type="button"
      className="sc-chrome-drill-today"
      onClick={onTodayJump}
      aria-label="Jump to the current month"
    >
      <TargetIcon />
      Today
    </button>
  );
}

// Local target glyph - Icons.js has no target concept yet; stroke 1.75
// matches the Icons.js vocabulary.
function TargetIcon() {
  return (
    <svg
      style={{ width: "var(--icon-sm)", height: "var(--icon-sm)" }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

// Chrome-only display form of a CANONICAL_PHASES label. Trims trailing
// " League" / " Training" so the chrome row keeps the drill Today chip
// pinned without wrapping. Full labels are still used on cards + the
// phase timeline; `CANONICAL_PHASES[...].label` is not mutated.
function chromePhaseLabel(label) {
  if (!label) return "";
  return label.replace(/ (League|Training)$/, "");
}

function fmtDateRange(startStr, endStr) {
  const s = new Date(startStr + "T12:00:00");
  const e = new Date(endStr   + "T12:00:00");
  const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${monthShort[s.getMonth()]} ${s.getDate()} - ${monthShort[e.getMonth()]} ${e.getDate()}`;
}

function formatHumanDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${dow} ${monthShort[d.getMonth()]} ${d.getDate()}`;
}
