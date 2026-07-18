"use client";

// SC v2 Ribbon - the navy identity band that replaces the v1 hero.
//
// Fuses page title + welcome + AsOf pill + admin lock + density toggle
// into a single slim band above the (restyled) ChromeBar. Together the
// two rows form one navy region at the top of the SC surface per
// Render Section 0.
//
// Rehomes (audit Q9):
//   - AsOf pill (was bottom-right of hero) - reuses AsOf from ChromeBar
//     verbatim; only the containing element and styling change
//   - admin lock button (was top-right of hero) - identical wire to
//     handleAdminToggle; renders enter/exit states via isAdminView
//
// The heroImage prop stays unused in v2 (retirement happens at W9).
//
// PRESENTATIONAL: consumes resolved props, emits onClick.

import { AsOf } from "../season/ChromeBar";

export default function Ribbon({
  firstName,
  asOf,
  onRefresh,
  isAdmin,
  isAdminView,
  onAdminToggle,
  density,
  onDensityChange,
}) {
  return (
    <div className="sc-ribbon" role="banner">
      <div className="sc-ribbon-brand">
        <h1 className="sc-ribbon-title">Service Calendar</h1>
        {/* V3 §3.2 - "Welcome back" string DELETED from DOM per spec.
            firstName prop retained on the component signature so
            callers don't break during the sweep; unused here. */}
      </div>

      <div className="sc-ribbon-right">
        {asOf && (
          <AsOf asOf={asOf} onRefresh={onRefresh} className="sc-ribbon-asof" />
        )}
        <DensityToggle value={density} onChange={onDensityChange} />
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
      </div>
    </div>
  );
}

// Density toggle - V3 §S4.1 two-segment control (Standard / Comfortable).
// Legacy Compact recalibrated INTO Standard - no third mode. Value is
// a controlled prop; parent owns the useDensity() state. Keyboard
// navigable via native <button>; each side reports its pressed state
// via aria-pressed for the SR announcement.
function DensityToggle({ value, onChange }) {
  return (
    <div className="sc-ribbon-density" role="group" aria-label="View density">
      <button
        type="button"
        className={`sc-ribbon-density-btn ${value === "standard" ? "sc-ribbon-density-btn--active" : ""}`}
        aria-pressed={value === "standard"}
        onClick={() => onChange?.("standard")}
        title="Standard (denser, enterprise default)"
      >
        Standard
      </button>
      <button
        type="button"
        className={`sc-ribbon-density-btn ${value === "comfortable" ? "sc-ribbon-density-btn--active" : ""}`}
        aria-pressed={value === "comfortable"}
        onClick={() => onChange?.("comfortable")}
        title="Comfortable (larger spacing)"
      >
        Comfortable
      </button>
    </div>
  );
}
