"use client";

// SC v2 -> V3 Ribbon - OV-3 rebuild: ONE navy row combining identity,
// account selection, view toggle, TODAY/PERIOD/WEEK meta, and the
// right cluster (as-of pill, admin lock, export).
//
// Comfortable density removed in OV-3 - Standard is the only scale.
// The two-segment density control is gone; useDensity is deleted.
//
// PRESENTATIONAL: takes resolved props in, emits onClick out.
//
// Layout (left -> right):
//   "Service Calendar" | account | kind chip | Calendar|Period | TODAY .. PERIOD .. WEEK ..
//   ..spacer..  as-of pill | admin lock | export
//
// Responsive:
//   <=1360: TODAY/PERIOD/WEEK inner separators drop (labels stay).
//   <=1280: as-of pill collapses to dot + time (item 22 acceptance -
//   failed state remains visible via the red-tinted status dot).

import { AsOf } from "../season/ChromeBar";

export default function Ribbon({
  asOf,
  onRefresh,
  fetchState = "fresh",
  isAdmin,
  isAdminView,
  onAdminToggle,
  /* NEW OV-3 chrome props (moved off ChromeBar into the single row) */
  accountDropdown,
  category,
  view,
  onViewChange,
  showToggle = false,
  todayLabel,
  periodNum,
  weekNum,
  /* G4 (2026-07-19): fee / homestand accounts render "TODAY | GAME
     DAYS {n}/{m}" instead of TODAY | PERIOD | WEEK. When
     hasHomestandSchedule=true, RibbonMeta swaps to the game-days
     variant. Per-meal accounts pass hasHomestandSchedule=false
     (default) and see the calendar meta unchanged. */
  hasHomestandSchedule = false,
  gameDaysEntered,
  totalGameDays,
  exportControl,
}) {
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
        <RibbonSep />
        <RibbonMeta
          todayLabel={todayLabel}
          periodNum={periodNum}
          weekNum={weekNum}
          hasHomestandSchedule={hasHomestandSchedule}
          gameDaysEntered={gameDaysEntered}
          totalGameDays={totalGameDays}
        />
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
// Internal separators collapse at <=1360; labels + values readable.
function RibbonMeta({
  todayLabel,
  periodNum,
  weekNum,
  hasHomestandSchedule,
  gameDaysEntered,
  totalGameDays,
}) {
  return (
    <div className="sc-ribbon-meta">
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
