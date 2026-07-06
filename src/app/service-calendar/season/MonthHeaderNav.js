"use client";

// MonthHeaderNav - drill-in header for the month scope (parallel to
// PeriodHeaderNav from PR #323). Renders in the chrome bar's drillNav
// slot when the user drills into a calendar month from the Calendar
// overview. Deliberately period-header-agnostic: no phase segment (a
// calendar month spans phases) and a month stepper clamped Jan-Dec of
// the current year.
//
// PRESENTATIONAL. The parent (ServiceCalendar) supplies handlers +
// clamps. The Today chip on the right is the shared PeriodTodayChip
// (see PeriodHeaderNav.js) - reused with a month-scoped onTodayJump.

import { ChevronLeft, ChevronRight } from "../Icons";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function MonthHeaderNav({
  monthKey,          // "YYYY-MM"
  monthRange,        // { start, end }
  canPrev,
  canNext,
  onClimbToSeason,
  onPrevMonth,
  onNextMonth,
}) {
  const monthNum = monthKey ? Number(monthKey.slice(5, 7)) : 0;
  const monthLabel = (monthNum >= 1 && monthNum <= 12) ? MONTH_NAMES[monthNum - 1] : "";
  const range = monthRange ? fmtDateRange(monthRange.start, monthRange.end) : "";

  return (
    <div className="sc-chrome-drill" aria-label="Month navigation">
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
          onClick={onPrevMonth}
          aria-label="Previous month"
        >
          <ChevronLeft size="sm" />
        </button>
        <span className="sc-chrome-drill-period">{monthLabel}</span>
        <button
          type="button"
          className="sc-chrome-drill-step-btn"
          disabled={!canNext}
          onClick={onNextMonth}
          aria-label="Next month"
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
      {/* Phase intentionally omitted - a calendar month spans phases. */}
    </div>
  );
}

function fmtDateRange(startStr, endStr) {
  const s = new Date(startStr + "T12:00:00");
  const e = new Date(endStr   + "T12:00:00");
  const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${monthShort[s.getMonth()]} ${s.getDate()} - ${monthShort[e.getMonth()]} ${e.getDate()}`;
}
