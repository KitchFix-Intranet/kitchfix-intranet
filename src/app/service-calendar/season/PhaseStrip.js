"use client";

// PhaseStrip - the persistent operational strip (spec section 4.2).
//
// PDC accounts -> phase timeline. MLB/MiLB -> homestand arc.
// Per-meal corporate (no operational structure) -> minimal.
//
// Stage 1 reality (spec 11.5): phases are RECORDED for 3/5 PDCs and
// INFERRED for 2/5; no `sc_phases` table exists; the year-summary
// response does NOT carry per-day phase labels OR year-wide homestand
// ranges. So Stage 1's strip renders a SHAPE PLACEHOLDER for every
// account: a 12-month axis + today marker + a "operational arc lands
// in Stage 2" affordance. No hardcoded phase data, no fake data, no
// special-case branches by account.
//
// Stage 2 fills in:
//   - PDC accounts (CIN-AZ, TXR-AZ, TBR-FL): clean phase ranges
//   - PDC accounts (TBJ-FL, STL-FL): inferred phase ranges
//   - MLB/MiLB fee accounts: year-wide homestand ranges
//   - per-meal corporate / fee corporate: stays minimal
//
// Component contract for Stage 1: receives the account category and
// today's date; renders the shape; never crashes if data is missing.

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function PhaseStrip({ category, today, year }) {
  // today.date is YYYY-MM-DD when present; we read month + day-of-year
  // so the marker lines up to a fractional offset across the strip.
  const todayDate = today?.date ? new Date(today.date + "T12:00:00") : null;
  const todayFraction = todayDate ? dayOfYearFraction(todayDate, year) : null;

  const operationalKind = pickOperationalKind(category);

  return (
    <section className="sc-season-strip" aria-label="Operational strip">
      <div className="sc-season-strip-frame">
        <div className="sc-season-strip-rail">
          {/* Month tick marks across the year axis. */}
          <div className="sc-season-strip-ticks">
            {MONTH_SHORT.map((m, i) => (
              <span key={m} className="sc-season-strip-tick">
                <span className="sc-season-strip-tick-label">{m}</span>
              </span>
            ))}
          </div>

          {/* Today marker - a small navy vertical line that lands at
              today's fractional position across the year. Hidden when
              today is outside the season (year != current year). */}
          {todayFraction != null && (
            <div
              className="sc-season-strip-today"
              style={{ left: `${todayFraction * 100}%` }}
              aria-label={`Today: ${formatDateLabel(todayDate)}`}
            >
              <span className="sc-season-strip-today-dot" aria-hidden="true" />
              <span className="sc-season-strip-today-label">Today</span>
            </div>
          )}
        </div>

        {/* Tag rail - identifies the operational shape this account has
            without faking content. Stage 2 replaces this with the
            phase/homestand timeline that the strip's container makes
            room for. */}
        <div className="sc-season-strip-tag">
          <span className="sc-season-strip-tag-kind">{operationalKind.label}</span>
          <span className="sc-season-strip-tag-pending">Detail lands in Stage 2</span>
        </div>
      </div>
    </section>
  );
}

// Map account category to the operational shape this strip eventually
// displays. The label here ships in Stage 1 as informational; the
// arrangement Stage 2 fills in stays consistent with this label.
function pickOperationalKind(category) {
  switch (category) {
    case "PDC":   return { label: "Phase timeline" };
    case "MLB":   return { label: "Homestand arc" };
    case "MiLB":  return { label: "Homestand arc" };
    case "CORP":  return { label: "No operational arc" };
    default:      return { label: "Operational arc" };
  }
}

// Returns 0-1 fraction of the year as of `date`. Used to position the
// today marker across the strip axis. Anchors at midnight local on
// Jan 1 of `year`; OK if `year` differs from `date`'s year - returns
// out-of-range values cleanly (the caller hides them).
function dayOfYearFraction(date, year) {
  const start = new Date(year, 0, 1).getTime();
  const end   = new Date(year + 1, 0, 1).getTime();
  const here  = date.getTime();
  if (here < start || here >= end) return null;
  return (here - start) / (end - start);
}

function formatDateLabel(d) {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}
