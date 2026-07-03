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
import { derivePhaseTimeline, derivePeriodPhase } from "./phaseDerivation";
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
      <div className="sc-chrome-drill-step">
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
      {range && (
        <>
          <span className="sc-chrome-drill-dot" aria-hidden="true">·</span>
          <span className="sc-chrome-drill-range">{range}</span>
        </>
      )}
      {phaseMeta && (
        <>
          <span className="sc-chrome-drill-dot" aria-hidden="true">·</span>
          <span className="sc-chrome-drill-phase">
            <span
              className="sc-chrome-drill-phase-dot"
              style={{ background: phaseMeta.tint }}
              aria-hidden="true"
            />
            {phaseMeta.label}
          </span>
        </>
      )}
    </div>
  );
}

export function PeriodTodayChip({ today, isCurrentPeriod, onTodayJump }) {
  const label = today ? formatHumanDate(today) : "";
  const content = (
    <>
      <TargetIcon />
      Today · {label}
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
  return (
    <button
      type="button"
      className="sc-chrome-drill-today"
      onClick={onTodayJump}
      aria-label="Jump to current period"
    >
      {content}
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
