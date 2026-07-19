"use client";

// ChromeBar - the unified Service Calendar chrome (Design Batch 2,
// audit P1-5). One horizontal band at the top of the SC, replacing
// the scattered sc-header layout.
//
// Contents, left to right:
//   account dropdown -> category tag -> Calendar/Period toggle ->
//   spacer -> Today / Period / Week / Recorded stats
//
// The stats cluster is the redesign Bundle 1 (Section B) promotion of
// the old InfoCard ContextBand into the chrome's freed-by-Admin slot,
// gated on showStats so it only renders in operator year view.
//
// The Admin entry lives in the hero's top-right corner (redesign PR
// 1A) - the sc-hero-admin lock button rendered by ServiceCalendar.js.
//
// The as-of timestamp pill was relocated out of the bar into the
// hero's bottom-right corner so the bar can stay on one row at
// desktop widths. AsOf is named-exported so ServiceCalendar can
// render it in the hero with a sc-hero-asof modifier; formatAsOf
// stays local to this module.
//
// The global Ops Hub notification bell lives in the page-wide TopNav
// above this bar; not part of the SC chrome, not relocated.
//
// PRESENTATIONAL: takes resolved props in, emits onClick out.

import "./chromeBar.css";

export default function ChromeBar({
  // account picker
  accountDropdown,             // <AccountDropdown ... /> rendered by the parent (keeps state local there)
  category,                    // "PDC" | "MLB" | "MiLB" | "AAA" | ...
  // view toggle
  view,                        // "calendar" | "period"
  onViewChange,                // (next: "calendar" | "period") => void
  showToggle,                  // hide when in admin view or periodworkspace
  // Chrome stats cluster (was InfoCard ContextBand). The action signal
  // (per-meal urgency counts / fee contract status) is folded in here
  // too, replacing the standalone InfoCard band.
  showStats,                   // gate - only render in operator year view
  todayLabel,                  // "Jun 28"
  periodNum,                   // "7" | null
  weekNum,                     // "2" | null (omits the Week segment when falsy)
  isFeeAccount = false,        // fee accounts show a contract stat, not urgency counts
  needsEntry = 0,              // per-meal: count of days needing entry (clickable)
  overdue = 0,                 // per-meal: count of overdue days (clickable)
  gameDaysEntered = 0,         // fee: game days recorded
  totalGameDays = 0,           // fee: total game days
  onJumpToNeeds,               // () => void; jump to first needs-entry day
  onJumpToOverdue,             // () => void; jump to first overdue day
  // Drill-in slots (filled by PeriodHeaderNav / PeriodTodayChip in the
  // period workspace). Both render only when truthy - the year view
  // passes null / undefined and the bar behaves as before.
  drillNav,
  drillNavEnd,
  // Optional export CTA slot (render J2). Renders inside the right
  // cluster, positioned immediately LEFT of the Today chip in both
  // overview and drill scopes. Parent supplies <ExportControl ... />.
  exportControl,
  // misc
  className,
}) {
  return (
    <div className={`sc-chrome-bar ${className || ""}`.trim()}>
      <div className="sc-chrome-bar-left">
        {accountDropdown}
        {category && (
          <span className={`sc-cat sc-cat--${String(category).toLowerCase()}`}>{category}</span>
        )}
        {drillNav}
        {showToggle && (
          <div className="sc-chrome-bar-toggle" role="group" aria-label="View by">
            <button
              type="button"
              className={`sc-chrome-bar-toggle-btn ${view === "calendar" ? "sc-chrome-bar-toggle-btn--active" : ""}`}
              aria-pressed={view === "calendar"}
              onClick={() => onViewChange?.("calendar")}
            >
              Calendar
            </button>
            <button
              type="button"
              className={`sc-chrome-bar-toggle-btn ${view === "period" ? "sc-chrome-bar-toggle-btn--active" : ""}`}
              aria-pressed={view === "period"}
              onClick={() => onViewChange?.("period")}
            >
              Period
            </button>
          </div>
        )}
      </div>

      <div className="sc-chrome-bar-right">
        {exportControl}
        {drillNavEnd}
        {showStats && (
          <ChromeStats
            todayLabel={todayLabel}
            periodNum={periodNum}
            weekNum={weekNum}
            isFeeAccount={isFeeAccount}
            needsEntry={needsEntry}
            overdue={overdue}
            gameDaysEntered={gameDaysEntered}
            totalGameDays={totalGameDays}
            onJumpToNeeds={onJumpToNeeds}
            onJumpToOverdue={onJumpToOverdue}
          />
        )}
      </div>
    </div>
  );
}

// Chrome stats cluster - Today / Period / Week, then the folded action
// signal. The old InfoCard band is gone: per-meal accounts surface
// clickable urgency counts here (UrgencyStats), fee accounts surface
// contract status here (FeeStat). Recorded % was removed - per-meal
// reads the grid, fee reads the game-days stat. Week omits gracefully
// when falsy. Presentational.
function ChromeStats({
  todayLabel, periodNum, weekNum,
  isFeeAccount, needsEntry, overdue, gameDaysEntered, totalGameDays,
  onJumpToNeeds, onJumpToOverdue,
}) {
  // SC-008 (2026-07-08): urgent chips lead the row so the primary
  // action wins visual hierarchy. Overdue outranks needs-entry because
  // it's the harder deadline; both are pill buttons via the CSS below.
  const hasUrgency = !isFeeAccount && ((overdue || 0) > 0 || (needsEntry || 0) > 0);
  return (
    <div className="sc-chrome-bar-stats" aria-label="Today context">
      {hasUrgency && (
        <>
          <UrgencyStats
            needsEntry={needsEntry}
            overdue={overdue}
            onJumpToNeeds={onJumpToNeeds}
            onJumpToOverdue={onJumpToOverdue}
          />
          <span className="sc-chrome-bar-stats-sep" aria-hidden="true" />
        </>
      )}
      <span className="sc-chrome-bar-stats-segment">
        <span className="sc-chrome-bar-stats-label">Today</span>
        <span className="sc-chrome-bar-stats-value">{todayLabel || "-"}</span>
      </span>
      <span className="sc-chrome-bar-stats-sep" aria-hidden="true" />
      <span className="sc-chrome-bar-stats-segment">
        <span className="sc-chrome-bar-stats-label">Period</span>
        <span className="sc-chrome-bar-stats-value">{periodNum || "-"}</span>
      </span>
      {weekNum && (
        <>
          <span className="sc-chrome-bar-stats-sep" aria-hidden="true" />
          <span className="sc-chrome-bar-stats-segment">
            <span className="sc-chrome-bar-stats-label">Week</span>
            <span className="sc-chrome-bar-stats-value">{weekNum}</span>
          </span>
        </>
      )}
      {isFeeAccount && (
        <FeeStat gameDaysEntered={gameDaysEntered} totalGameDays={totalGameDays} />
      )}
    </div>
  );
}

// Per-meal action signal folded into the chrome. Each pill jumps to
// the first day of its status. Renders nothing when caught up -
// absence is the all-clear signal. Overdue leads because it carries
// the harder deadline. Colored via the same status-* tokens the
// legend and day tiles use, so the toolbar, key, and grid all agree.
// Pill styling + :active pressed feedback live in chromeBar.css.
function UrgencyStats({ needsEntry, overdue, onJumpToNeeds, onJumpToOverdue }) {
  const hasNeeds = (needsEntry || 0) > 0;
  const hasOverdue = (overdue || 0) > 0;
  if (!hasNeeds && !hasOverdue) return null;
  return (
    <>
      {hasOverdue && (
        <button
          type="button"
          className="sc-chrome-bar-stats-count sc-chrome-bar-stats-count--overdue"
          onClick={onJumpToOverdue}
          aria-label={`Jump to first of ${overdue} overdue days`}
        >
          <span className="sc-chrome-bar-stats-count-num">{overdue}</span>
          <span className="sc-chrome-bar-stats-count-label">Overdue</span>
        </button>
      )}
      {hasNeeds && (
        <button
          type="button"
          className="sc-chrome-bar-stats-count sc-chrome-bar-stats-count--needs"
          onClick={onJumpToNeeds}
          aria-label={`Jump to first of ${needsEntry} days needing entry`}
        >
          <span className="sc-chrome-bar-stats-count-num">{needsEntry}</span>
          <span className="sc-chrome-bar-stats-count-label">Needs entry</span>
        </button>
      )}
    </>
  );
}

// Fee-account contract signal folded into the chrome (replaces the
// InfoCard FeeBand). Shows game-days-recorded when the schedule has
// game days. Fee accounts carry no per-day urgency, so there are no
// jump counts here.
//
// SC-025 (2026-07-08): the "on track" marker was hardcoded - it read
// as reassuring status regardless of the actual gameDaysEntered ratio
// (0/81 said "on track" as loudly as 81/81). Removed until a real
// business rule defines what "on track" means (per-account contract
// threshold, calendar-position vs entered ratio, etc.).
function FeeStat({ gameDaysEntered, totalGameDays }) {
  const hasGameDays = (totalGameDays || 0) > 0;
  if (!hasGameDays) return null;
  return (
    <>
      <span className="sc-chrome-bar-stats-sep" aria-hidden="true" />
      <span className="sc-chrome-bar-stats-segment">
        <span className="sc-chrome-bar-stats-label">Game days</span>
        <span className="sc-chrome-bar-stats-value">{gameDaysEntered}/{totalGameDays}</span>
      </span>
    </>
  );
}

// As-of timestamp pill. Format examples:
//   "as of 4:51 PM"            - today
//   "as of Jun 25, 4:51 PM"    - yesterday or older
// The optional refresh button is shown only when onRefresh is wired.
//
// Named export: ServiceCalendar.js relocates this into the hero's
// bottom-right corner via the sc-hero-asof modifier so the chrome bar
// can sit on one row at desktop widths.
export function AsOf({ asOf, onRefresh, className, fetchState = "fresh" }) {
  /* V3 §9.6 - as-of pill states: fresh (default) / stale / failed.
     `fetchState` is the parent-supplied signal; caller decides when
     to flip it (e.g., "stale" past a refresh interval, "failed" on
     retry-exhausted fetch). CSS in overview.css keys on
     `data-fetch-state` and swaps the pill background/dot tone. */
  const label = formatAsOf(asOf);
  return (
    <span
      className={`sc-chrome-bar-asof ${className || ""}`.trim()}
      title={asOf.toLocaleString()}
      data-fetch-state={fetchState}
    >
      <span aria-hidden="true" className="sc-chrome-bar-asof-dot" />
      <span>{label}</span>
      {onRefresh && (
        <button
          type="button"
          className="sc-chrome-bar-asof-refresh"
          onClick={onRefresh}
          aria-label="Refresh data"
          title="Refresh data"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      )}
    </span>
  );
}

function formatAsOf(d) {
  if (!(d instanceof Date)) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `as of ${time}`;
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `as of ${MON[d.getMonth()]} ${d.getDate()}, ${time}`;
}
