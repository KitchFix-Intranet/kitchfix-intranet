"use client";

// LensBar - the Option 4 control for the Service Calendar header.
//
// Renders the scope segmented control (the dynamic-per-lens
// altitude buttons), the Today shortcut, the quiet "Viewing by"
// lens dropdown, and the admin escape button at the right edge.
//
// PR-B2 activates the Period lens. Both Calendar and Period are
// selectable. SEGMENTS_BY_LENS provides the per-lens scope segments.
// The scope-reset-on-lens-switch lives in the parent's onLensChange
// handler so an invalid (lens, scope) combo cannot be reached.
//
// Pure presentation. All state lives in ServiceCalendar.js and is
// passed in via props; companion side-effects (clearing focusDay,
// exiting bulk mode, toggling admin) live in the parent's handlers,
// not here.

const SEGMENTS_BY_LENS = {
  calendar: [
    { scope: "year",  label: "Year"  },
    { scope: "month", label: "Month" },
  ],
  // B2 activates this set when lens=period.
  period: [
    { scope: "year",   label: "Year"   },
    { scope: "period", label: "Period" },
  ],
};

export default function LensBar({
  scope,
  lens,
  isAdminView,
  isAdmin,
  onScopeChange,
  onLensChange,
  onTodayClick,
  onAdminClick,
}) {
  const segments = SEGMENTS_BY_LENS[lens] || SEGMENTS_BY_LENS.calendar;
  return (
    <div className="sc-lens-bar">
      <div className="sc-lens-bar-controls">
        <div className="sc-mode-group">
          {segments.map((seg) => (
            <button
              key={seg.scope}
              type="button"
              className={`sc-mode-btn ${!isAdminView && scope === seg.scope ? "sc-mode-btn--active" : ""}`}
              onClick={() => onScopeChange(seg.scope)}
            >
              {seg.label}
            </button>
          ))}
          <div className="sc-mode-divider" />
          <button
            type="button"
            className="sc-mode-btn sc-mode-btn--today"
            onClick={onTodayClick}
          >
            Today
          </button>
        </div>
        <label className="sc-lens-dropdown">
          <span className="sc-lens-dropdown-label">Viewing by</span>
          <select
            className="sc-lens-dropdown-select"
            value={lens}
            onChange={(e) => onLensChange(e.target.value)}
            aria-label="Lens"
          >
            <option value="calendar">Calendar</option>
            <option value="period">Period</option>
          </select>
        </label>
      </div>
      {isAdmin && (
        <button
          type="button"
          className={`sc-admin-esc ${isAdminView ? "sc-admin-esc--active" : ""}`}
          onClick={onAdminClick}
          title={isAdminView ? "Return to the calendar" : "Service Calendar admin (corporate only)"}
          aria-pressed={isAdminView}
        >
          {isAdminView ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
              Calendar
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Admin
            </>
          )}
        </button>
      )}
    </div>
  );
}
