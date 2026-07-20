"use client";

// SC v2 -> V3 Ribbon - Drill P1 rebuild: single navy row combining
// identity, account, view/scope controls, meta readout, and the right
// cluster (as-of, admin, export). Drill scope now folds Season-back /
// period stepper / phase pill / Today-jump into the Ribbon too, so
// ChromeBar suppresses on scv2 drill (DP1-02). PR-D month-scope
// grouping is independent from this file.
//
// PRESENTATIONAL: takes resolved props in, emits onClick out.
//
// Layout (left -> right):
//   "Service Calendar" | account | kind chip | scope-toggle-or-drillNav
//   | Today-group (readout · | ⊙ Today) | ..spacer.. as-of | admin | export
//
// Responsive:
//   <=1360: readout inner separators drop (labels stay).
//   <=1280: as-of pill compacts (refresh button hides; status dot stays
//   so failed state remains visible).

import { AsOf } from "../season/ChromeBar";

export default function Ribbon({
  asOf,
  onRefresh,
  fetchState = "fresh",
  isAdmin,
  isAdminView,
  onAdminToggle,
  accountDropdown,
  category,
  view,
  onViewChange,
  showToggle = false,
  todayLabel,
  periodNum,
  weekNum,
  /* G4 (2026-07-19): fee/homestand accounts render "TODAY | GAME DAYS
     {n}/{m}" instead of TODAY | PERIOD | WEEK. */
  hasHomestandSchedule = false,
  gameDaysEntered,
  totalGameDays,
  /* Drill P1 PR-A (2026-07-20) DP1-02: drill scope controls that ChromeBar
     used to host now render here so ChromeBar can suppress on scv2 drill.
     drillNav = PeriodHeaderNav / MonthHeaderNav JSX (Season back + stepper
     + phase pill); drillNavEnd = PeriodTodayChip JSX (Today jump). */
  drillNav,
  drillNavEnd,
  exportControl,
}) {
  const isDrill = !!drillNav;
  return (
    <div className="sc-ribbon" role="banner">
      <div className="sc-ribbon-left">
        <h1 className="sc-ribbon-title">Service Calendar</h1>
        <RibbonSep />
        {accountDropdown && (
          <div className="sc-ribbon-account">
            {accountDropdown}
          </div>
        )}
        {category && (
          <span className={`sc-cat sc-cat--${String(category).toLowerCase()}`}>{category}</span>
        )}
        {showToggle && (
          <div className="sc-ribbon-toggle" role="group" aria-label="View by">
            <button
              type="button"
              className={`sc-ribbon-toggle-btn ${view === "calendar" ? "sc-ribbon-toggle-btn--active" : ""}`}
              aria-pressed={view === "calendar"}
              onClick={() => onViewChange?.("calendar")}
            >
              Calendar
            </button>
            <button
              type="button"
              className={`sc-ribbon-toggle-btn ${view === "period" ? "sc-ribbon-toggle-btn--active" : ""}`}
              aria-pressed={view === "period"}
              onClick={() => onViewChange?.("period")}
            >
              Period
            </button>
          </div>
        )}
        {/* Drill P1 DP1-02 - drill-scope nav slot. Renders BETWEEN the
            toggle slot (which showToggle-gates itself away on drill) and
            the Today-group. Its own component ships the Season back +
            stepper + phase pill markup that ChromeBar used to host. */}
        {drillNav && (
          <div className="sc-ribbon-drillnav">{drillNav}</div>
        )}
        <RibbonSep />
        {/* DP1-05 Today-group - one bordered container. Left: passive
            readout (spans, not buttons, non-focusable). Right: Today-jump
            (real button, hover) - the drillNavEnd slot. Divider between. */}
        <div className={`sc-ribbon-today-group${isDrill ? " sc-ribbon-today-group--drill" : ""}`}>
          <RibbonMeta
            todayLabel={todayLabel}
            periodNum={periodNum}
            weekNum={weekNum}
            hasHomestandSchedule={hasHomestandSchedule}
            gameDaysEntered={gameDaysEntered}
            totalGameDays={totalGameDays}
          />
          {drillNavEnd && (
            <>
              <span className="sc-ribbon-today-group-divider" aria-hidden="true" />
              <div className="sc-ribbon-today-jump">{drillNavEnd}</div>
            </>
          )}
        </div>
      </div>

      <div className="sc-ribbon-right">
        {asOf && (
          <AsOf asOf={asOf} onRefresh={onRefresh} className="sc-ribbon-asof" fetchState={fetchState} />
        )}
        {isAdmin && (
          <button
            type="button"
            className="sc-ribbon-admin"
            onClick={onAdminToggle}
            aria-label={isAdminView ? "Return to the calendar" : "Service Calendar admin (corporate only)"}
            title={isAdminView ? "Return to the calendar" : "Service Calendar admin (corporate only)"}
            aria-pressed={isAdminView}
          >
            {isAdminView ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </button>
        )}
        {exportControl && (
          <div className="sc-ribbon-export">
            {exportControl}
          </div>
        )}
      </div>
    </div>
  );
}

// Thin vertical separator ("|") - white, low-opacity per spec.
function RibbonSep() {
  return <span className="sc-ribbon-sep" aria-hidden="true" />;
}

// TODAY {date} PERIOD {n} WEEK {n} meta cluster (per-meal), OR
// TODAY {date} | GAME DAYS {n}/{m} (fee / homestand) per G4.
// All spans, no buttons - non-focusable readout per DP1-05.
function RibbonMeta({
  todayLabel,
  periodNum,
  weekNum,
  hasHomestandSchedule,
  gameDaysEntered,
  totalGameDays,
}) {
  return (
    <div className="sc-ribbon-meta" aria-label="Current context readout">
      <span className="sc-ribbon-meta-seg">
        <span className="sc-ribbon-meta-label">TODAY</span>
        <span className="sc-ribbon-meta-value">{todayLabel || "-"}</span>
      </span>
      {hasHomestandSchedule ? (
        (totalGameDays || 0) > 0 && (
          <>
            <span className="sc-ribbon-meta-sep" aria-hidden="true" />
            <span className="sc-ribbon-meta-seg">
              <span className="sc-ribbon-meta-label">GAME DAYS</span>
              <span className="sc-ribbon-meta-value">
                {gameDaysEntered || 0}/{totalGameDays}
              </span>
            </span>
          </>
        )
      ) : (
        <>
          <span className="sc-ribbon-meta-sep" aria-hidden="true" />
          <span className="sc-ribbon-meta-seg">
            <span className="sc-ribbon-meta-label">PERIOD</span>
            <span className="sc-ribbon-meta-value">{periodNum || "-"}</span>
          </span>
          {weekNum && (
            <>
              <span className="sc-ribbon-meta-sep" aria-hidden="true" />
              <span className="sc-ribbon-meta-seg">
                <span className="sc-ribbon-meta-label">WEEK</span>
                <span className="sc-ribbon-meta-value">{weekNum}</span>
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}
