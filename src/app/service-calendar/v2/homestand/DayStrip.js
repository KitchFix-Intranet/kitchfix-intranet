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
  // M-2 Round 2 owner reversal (2026-07-29): the block's own
  // boundaries are the authority for prep. Server's
  // buildM2Homestands walks every date in [startDate, endDate] and
  // pushes non-GAME dates into prepSet by construction. So inside
  // a block span this branch is EXPECTED UNREACHABLE - a cell here
  // means the trap §11.2 (vanishing GAME row) invariant fired on
  // the server (block.gameCount != gamesInSpan). The payload's
  // hasScheduleGap flag names that state; the visible dashed
  // "no data" tile is the operator's signal that the schedule
  // itself, not the derivation, dropped a row.
  //
  // Outside the span the only cell is the leading pre-day at
  // startDate - 1. It reaches this branch only when the leading
  // pre-day was blocked (record shows EXHIBITION per M27) AND the
  // caller did not push it into prepSet. That's a real state
  // reachable at M-4 for TXR openers; the M-2 pilot (CIN-OH) never
  // hits it.
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

// Monday starts the payroll week (owner ruling 2026-07-30). A
// divider falls BETWEEN a Sunday cell and the next Monday cell so
// a chef sees where the overtime week breaks inside the strip.
// Noon anchor sidesteps DST.
function dayOfWeek(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.getDay();   // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
}
function isSundayToMondaySeam(prevIso, iso) {
  if (!prevIso || !iso) return false;
  return dayOfWeek(prevIso) === 0 && dayOfWeek(iso) === 1;
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
    const monthBreak = prevIso && monthOf(iso) !== monthOf(prevIso);
    if (monthBreak) {
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

    // Payroll-week divider BETWEEN a Sunday and the next Monday.
    // Owner ruling 2026-07-30: Monday-Sunday payroll week. Budget
    // includes overtime at 1.5x over 40 hours per week, so a chef
    // scheduling an eleven-day homestand needs to see where the
    // seven-day and four-day slices break. Quiet hairline - if it
    // competes with the month-boundary marker it is too loud
    // (owner). Skip when:
    //   - the seam already carries a month break (avoid doubling)
    //   - the seam is the very first (leading pre-day to first
    //     game day), because the pre-day is contextual scaffolding
    //     rather than part of the payroll week's work
    if (!monthBreak && i > 1 && isSundayToMondaySeam(prevIso, iso)) {
      nodes.push(
        <div
          key={`wbrk-${iso}`}
          className="sc-daystrip-weekbreak"
          role="separator"
          aria-label={`New payroll week ${labelFor(iso)}`}
        />
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
