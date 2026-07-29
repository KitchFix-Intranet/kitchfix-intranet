"use client";

// M-2 (2026-07-29): homestand detail day strip. Linear cell layout,
// one cell per day from (block.startDate - 1) through block.endDate.
//
// NOT DaySquare-based and NOT PeriodWorkspace-based. Both render a
// 7-wide DOW-aligned grid, which cannot express a linear strip with
// inline dividers (owner ruling, prompt §4.4). Presentational: takes
// a resolved day map + prep set + block bounds; emits no state, runs
// no effects.
//
// M-2 FENCE (prompt §9): this component ships without overtime week
// dividers and without week summaries. The payroll week convention
// is open (Kitchfix's Rippling payroll-week start day - Round 1 Q1
// went to the owner and has not returned). A wrong overtime read on
// a screen that tells a chef how to schedule is worse than an absent
// one, and placeholders on this project have a habit of shipping.
// A clean seam exists between adjacent cells for a future
// <WeekDivider /> component; no `--pw-*` or `--calendarWeek` stub
// ships this round.
//
// Cell classes (three, plus the month-boundary marker):
//   .sc-daystrip-cell--game       filled, opponent code
//   .sc-daystrip-cell--prep       outlined dim, "prep" label (derived
//                                  proposal per scope B3; no stored
//                                  adjustment surface in M-2)
//   .sc-daystrip-cell--exception  red-family, opponent code + "no
//                                  service" label (game day marked
//                                  no-service via the existing tile
//                                  action)
//
// A game day whose payload status is "entered" gets a subtle border
// treatment (.sc-daystrip-cell--served) additive on top of --game so
// the served vs unentered distinction is legible at a glance. This
// mirrors the DaySquare state spine so a chef reading either surface
// gets the same signal.

import "./homestand.css";

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Noon anchor sidesteps DST-boundary bumping (see homestandDerivation.js
// spanInclusiveDays for the same discipline).
function isoAddDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function enumerateInclusive(startIso, endIso) {
  const out = [];
  if (!startIso || !endIso || endIso < startIso) return out;
  let cur = startIso;
  while (cur <= endIso) {
    out.push(cur);
    cur = isoAddDays(cur, 1);
  }
  return out;
}

function classifyCell(iso, dayMap, prepSet) {
  const d = dayMap ? dayMap.get(iso) : null;
  if (d && d.dayType === "GAME") {
    if (d.status === "no-service") {
      return { kind: "exception", opponent: d.opponent || "", entered: false };
    }
    return {
      kind: "game",
      opponent: d.opponent || "",
      entered: d.status === "entered",
    };
  }
  if (prepSet && prepSet.has(iso)) return { kind: "prep" };
  // M-2 defect 2 (2026-07-29 owner ruling): missing data is honest
  // missing, never a positive claim. A cell whose date has no
  // schedule record AND is not in the prep proposal set renders
  // as "unknown" - visually distinct from prep so a chef reading
  // the strip can tell a proposed-prep day (chef's job to schedule)
  // from an unknown day (data gap, not the chef's problem to fill).
  return { kind: "missing" };
}

function labelFor(iso) {
  const d = new Date(iso + "T12:00:00");
  return `${MON_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function monthOf(iso) {
  return iso.slice(0, 7);
}

function monthName(iso) {
  const d = new Date(iso + "T12:00:00");
  return MON_SHORT[d.getMonth()];
}

export default function DayStrip({
  domainStart,   // ISO, inclusive - block.startDate - 1
  domainEnd,     // ISO, inclusive - block.endDate
  dayMap,        // Map<isoDate, dayEntry> - dayType / opponent / status
  prepSet,       // Set<isoDate> - leading pre-day + internal off-days
}) {
  const cells = enumerateInclusive(domainStart, domainEnd);
  if (cells.length === 0) return null;

  const nodes = [];
  for (let i = 0; i < cells.length; i++) {
    const iso = cells[i];
    const prevIso = i > 0 ? cells[i - 1] : null;

    // Month-boundary marker BETWEEN two cells where the month changes.
    // Renders a thin vertical rule with the incoming month labeled
    // above it so both sides are named (owner ruling, prompt §4.4).
    if (prevIso && monthOf(iso) !== monthOf(prevIso)) {
      nodes.push(
        <div
          key={`brk-${iso}`}
          className="sc-daystrip-monthbreak"
          role="separator"
          aria-label={`Enters ${monthName(iso)}`}
        >
          <span className="sc-daystrip-monthbreak-label">{monthName(iso)}</span>
        </div>
      );
    }

    const c = classifyCell(iso, dayMap, prepSet);
    const dateLabel = labelFor(iso);
    const classes = ["sc-daystrip-cell", `sc-daystrip-cell--${c.kind}`];
    if (c.kind === "game" && c.entered) classes.push("sc-daystrip-cell--served");

    // aria-label carries a full spoken description so screen readers
    // read "Jul 3 game versus PIT, served" without the visual glyphs.
    // Missing cells read as "unknown" so the honest state is spoken,
    // matching the visible dashed-empty treatment.
    let ariaLabel = `${dateLabel} ${c.kind === "missing" ? "unknown" : c.kind}`;
    if (c.opponent) ariaLabel += ` versus ${c.opponent}`;
    if (c.kind === "game" && c.entered) ariaLabel += ", served";
    if (c.kind === "exception") ariaLabel += ", no service";

    nodes.push(
      <div
        key={iso}
        className={classes.join(" ")}
        role="listitem"
        aria-label={ariaLabel}
      >
        <div className="sc-daystrip-cell-date">{dateLabel}</div>
        {c.opponent && (
          <div className="sc-daystrip-cell-opponent">{c.opponent}</div>
        )}
        {c.kind === "prep" && (
          <div className="sc-daystrip-cell-marker">prep</div>
        )}
        {c.kind === "exception" && (
          <div className="sc-daystrip-cell-marker">no service</div>
        )}
        {c.kind === "missing" && (
          <div className="sc-daystrip-cell-marker">no data</div>
        )}
      </div>
    );
  }

  return (
    <div
      className="sc-daystrip"
      role="list"
      aria-label="Homestand day strip"
    >
      {nodes}
    </div>
  );
}
