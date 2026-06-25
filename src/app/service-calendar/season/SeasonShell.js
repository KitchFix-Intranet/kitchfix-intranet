"use client";

// SeasonShell - the redesigned Season-level container (Stage 1).
// Spec section 4: top to bottom = account context + persistent
// operational strip + Calendar/Period toggle + 4x3 month grid.
//
// Stage 1 scope:
//   - The shell renders. Calendar is the active side of the toggle;
//     Period is DISABLED (Stage 2 enables it).
//   - The Calendar grid reproduces the trusted year heatmap's
//     information using the Stage 0 atom as the SINGLE day renderer.
//   - The phase strip renders a SHAPE PLACEHOLDER (PhaseStrip.js
//     comment explains why - no engine change to add phase data).
//   - The month-card click delegates to the parent (the orchestrator)
//     which drives the legacy month-view drill so the wiring works
//     today; Stage 3+ replaces the drill target with the new
//     Period workspace.
//
// The shell is PRESENTATIONAL - it takes resolved props and emits
// onClick. State + data effects live in ServiceCalendar.js. The
// legacy lens/scope path remains intact alongside this new shell
// (spec 11.4).

import { useMemo } from "react";
import "./season.css";
import PhaseStrip from "./PhaseStrip";
import MonthCard from "./MonthCard";
import { resolveDayKind } from "../dayResolvers";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function SeasonShell({
  account,                  // { key, name, category, billingModel }
  year,                     // number (the active season year)
  yearData,                 // months[] from sc-year-summary
  yearToday,                // { date, period, week } from sc-year-summary
  yearBannerStats,          // existing computed stats from ServiceCalendar.js
  hasHomestandSchedule,
  isFeeAccount,
  isMilb,
  loading,
  onMonthClick,             // (monthIndex) => void
}) {
  // Stage 1: Period is disabled. We track the toggle state but
  // selecting Period is a no-op for now (Stage 2 wires it).
  const view = "calendar";

  const kind = useMemo(
    () => resolveDayKind({
      billingModel: account?.billingModel,
      category: account?.category,
      hasHomestandSchedule,
    }),
    [account?.billingModel, account?.category, hasHomestandSchedule]
  );

  const todayDate = yearToday?.date || null;

  // Loading skeleton matches the new shape so the layout doesn't
  // shift when data lands. Spec section 4 + GOTCHAS skeleton rule.
  if (loading || !yearData) {
    return (
      <div className="sc-season sc-season-shell sc-fade-in">
        <YearBanner stats={null} yearToday={null} isFeeAccount={isFeeAccount} hasHomestandSchedule={hasHomestandSchedule} />
        <PhaseStrip category={account?.category} today={null} year={year} />
        <CalendarPeriodToggle view={view} />
        <div className="sc-season-grid sc-season-grid--loading" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="sc-season-month-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sc-season sc-season-shell sc-fade-in">
      <YearBanner
        stats={yearBannerStats}
        yearToday={yearToday}
        isFeeAccount={isFeeAccount}
        hasHomestandSchedule={hasHomestandSchedule}
      />

      <PhaseStrip
        category={account?.category}
        today={yearToday}
        year={year}
      />

      <CalendarPeriodToggle view={view} />

      <div className="sc-season-grid" role="list" aria-label={`${year} months`}>
        {MONTH_SHORT.map((_, monthIndex) => {
          const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
          const monthSummary = yearData.find(m => m.month === monthKey) || null;
          return (
            <div role="listitem" key={monthIndex}>
              <MonthCard
                year={year}
                monthIndex={monthIndex}
                monthSummary={monthSummary}
                todayDate={todayDate}
                kind={kind}
                hasHomestandSchedule={hasHomestandSchedule}
                isFeeAccount={isFeeAccount}
                isMilb={isMilb}
                onClick={onMonthClick}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Top banner. Mirrors the existing year-banner's information density:
// today's date + period/week chip + per-account stats. Uses the SAME
// yearBannerStats the legacy year body computes (passed in by the
// orchestrator), so the numbers match the trusted view exactly.
function YearBanner({ stats, yearToday, isFeeAccount, hasHomestandSchedule }) {
  // Skeleton state.
  if (!stats) {
    return (
      <div className="sc-season-banner sc-season-banner--loading" aria-hidden="true">
        <span className="sc-season-banner-skel" style={{ width: 80 }} />
        <span className="sc-season-banner-skel" style={{ width: 120 }} />
        <span className="sc-season-banner-skel" style={{ width: 180 }} />
      </div>
    );
  }
  return (
    <div className="sc-season-banner">
      <span className="sc-season-banner-today">
        Today: <strong>{stats.todayLabel}</strong>
      </span>
      {yearToday?.period && (
        <span className="sc-season-banner-period">
          Period {yearToday.period}
          {yearToday.week ? ` · ${yearToday.week}` : ""}
        </span>
      )}
      <span className="sc-season-banner-sep" aria-hidden="true">|</span>
      {hasHomestandSchedule ? (
        <>
          <span className="sc-season-banner-stat">
            <strong>{stats.gameDaysEntered.toLocaleString("en-US")}</strong> of {stats.totalGameDays.toLocaleString("en-US")} game days recorded
          </span>
          <span className="sc-season-banner-sep" aria-hidden="true">|</span>
          <span className="sc-season-banner-stat">
            <strong>{stats.mealsYTD.toLocaleString("en-US")}</strong> meals YTD
          </span>
        </>
      ) : (
        <>
          <span className="sc-season-banner-stat">
            <strong>{stats.daysRecorded.toLocaleString("en-US")}</strong> of {stats.totalDays.toLocaleString("en-US")} days recorded
          </span>
          {!isFeeAccount && (
            <>
              <span className="sc-season-banner-sep" aria-hidden="true">|</span>
              <span className={`sc-season-banner-stat ${stats.needsEntry > 0 ? "sc-season-banner-stat--warn" : ""}`}>
                <strong>{stats.needsEntry.toLocaleString("en-US")}</strong> need entry
              </span>
              <span className="sc-season-banner-sep" aria-hidden="true">|</span>
              <span className={`sc-season-banner-stat ${stats.overdue > 0 ? "sc-season-banner-stat--alert" : ""}`}>
                <strong>{stats.overdue.toLocaleString("en-US")}</strong> overdue
              </span>
            </>
          )}
          <span className="sc-season-banner-sep" aria-hidden="true">|</span>
          <span className="sc-season-banner-stat">
            <strong>{stats.mealsYTD.toLocaleString("en-US")}</strong> meals YTD
          </span>
        </>
      )}
    </div>
  );
}

// Calendar/Period toggle. Stage 1: Calendar is the only active side;
// Period is disabled with a "Period view lands in Stage 2" affordance.
// The toggle is purely visual at this stage (no state change), since
// the segment lights up but nothing happens on click.
function CalendarPeriodToggle({ view }) {
  return (
    <div className="sc-season-toggle" role="group" aria-label="View by">
      <button
        type="button"
        className={`sc-season-toggle-btn ${view === "calendar" ? "sc-season-toggle-btn--active" : ""}`}
        aria-pressed={view === "calendar"}
      >
        Calendar
      </button>
      <button
        type="button"
        className="sc-season-toggle-btn sc-season-toggle-btn--disabled"
        disabled
        aria-disabled="true"
        title="Period view lands in Stage 2"
      >
        Period
        <span className="sc-season-toggle-soon">soon</span>
      </button>
    </div>
  );
}
