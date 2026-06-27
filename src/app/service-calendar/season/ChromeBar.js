"use client";

// ChromeBar - the unified Service Calendar chrome (Design Batch 2,
// audit P1-5). One horizontal band at the top of the SC, replacing
// the scattered sc-header layout.
//
// Contents, left to right:
//   account dropdown -> category tag -> Calendar/Period toggle ->
//   spacer -> as-of timestamp -> Admin button
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
  // data freshness
  asOf,                        // Date | null
  onRefresh,                   // optional () => void to trigger a refresh
  // admin
  isAdmin,                     // boolean - render admin button at all?
  isAdminView,
  onAdminToggle,
  adminLabel,                  // optional override label inside Admin mode
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
        {asOf && (
          <AsOf asOf={asOf} onRefresh={onRefresh} />
        )}
        {isAdmin && (
          <button
            type="button"
            className={`sc-admin-esc ${isAdminView ? "sc-admin-esc--active" : ""}`}
            onClick={onAdminToggle}
            title={isAdminView ? "Return to the calendar" : "Service Calendar admin (corporate only)"}
            aria-pressed={isAdminView}
          >
            {isAdminView ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
                {adminLabel || "Calendar"}
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
    </div>
  );
}

// As-of timestamp pill. Format examples:
//   "as of 4:51 PM"            - today
//   "as of Jun 25, 4:51 PM"    - yesterday or older
// The optional refresh button is shown only when onRefresh is wired.
function AsOf({ asOf, onRefresh }) {
  const label = formatAsOf(asOf);
  return (
    <span className="sc-chrome-bar-asof" title={asOf.toLocaleString()}>
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
