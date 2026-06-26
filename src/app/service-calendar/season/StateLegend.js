"use client";

// StateLegend - the day-cell state key (Design Batch 1, audit P0-1).
//
// The audit's non-negotiable #1: a visible legend whenever cells carry
// meaning by color + glyph. Absence of a key was the canonical Stage 6
// regression - the legacy .sc-month-legend / .sc-year-legend rules
// were deleted with the legacy chrome and never replaced. This is the
// replacement: ONE legend, account-aware, sticky at the top of the
// scrollable grid, lives in the Season shell + the Period workspace.
//
// Account-aware: only renders the states the current account actually
// renders. The MLB-fee accounts don't show "needs entry" or "overdue"
// (no per-meal actuals expected). MiLB adds the day/night game cue.
// The legend is the CONTRACT for the visual system: if a state isn't
// in here, the atom shouldn't render it.
//
// Placement: between the Calendar/Period toggle and the cell grid in
// SeasonShell, and at the top of the workspace in PeriodWorkspace.
// Sticky on scroll so it stays visible while the user scans.

import "./stateLegend.css";

export default function StateLegend({
  hasHomestandSchedule = false,
  isFeeAccount = false,
  isMilb = false,
}) {
  // Resolve the in-use states per account type. Order matches the
  // typical scan flow: entered first (the calm done state), action
  // states next (needs-entry, overdue) so they read as the salient
  // entries, upcoming, off-season, today, failed.
  const items = [];
  if (hasHomestandSchedule) {
    // MLB fee accounts: schedule-driven. No needs-entry / overdue
    // because per-meal actuals aren't expected.
    items.push({ mod: "entered", icon: "", label: "Game day entered" });
    items.push({ mod: "upcoming", icon: "○", label: "Scheduled game day" });
    items.push({ mod: "off", icon: "—", label: "Prep / between games" });
  } else if (isFeeAccount) {
    // Operational-only (STL-FL): per-meal mechanics, no $ in cell.
    items.push({ mod: "entered", icon: "", label: "Entered" });
    items.push({ mod: "needs-entry", icon: "✎", label: "Needs entry" });
    items.push({ mod: "overdue", icon: "!", label: "Overdue" });
    items.push({ mod: "upcoming", icon: "○", label: "Upcoming" });
  } else if (isMilb) {
    // MiLB hybrid: per-meal + day/night game cue.
    items.push({ mod: "entered", icon: "", label: "Entered" });
    items.push({ mod: "needs-entry", icon: "✎", label: "Needs entry" });
    items.push({ mod: "overdue", icon: "!", label: "Overdue" });
    items.push({ mod: "upcoming", icon: "○", label: "Upcoming" });
    items.push({ mod: "milb-day", icon: "", label: "Day game" });
    items.push({ mod: "milb-night", icon: "", label: "Night game" });
  } else {
    // Per-meal default (PDC year-round).
    items.push({ mod: "entered", icon: "", label: "Entered" });
    items.push({ mod: "needs-entry", icon: "✎", label: "Needs entry" });
    items.push({ mod: "overdue", icon: "!", label: "Overdue" });
    items.push({ mod: "upcoming", icon: "○", label: "Upcoming" });
  }

  // Universal trailer applied to every account:
  //   off-season    - outside the season window
  //   today         - the today ring
  //   failed        - fetch errored (rubric non-negotiable #2)
  items.push({ mod: "off-season", icon: "—", label: "Off-season" });
  items.push({ mod: "today", icon: "", label: "Today" });
  items.push({ mod: "failed", icon: "⚠", label: "Could not load" });

  return (
    <div className="sc-state-legend" role="group" aria-label="Day cell legend">
      <span className="sc-state-legend-title">Legend</span>
      <ul className="sc-state-legend-list">
        {items.map((it) => (
          <li key={it.mod} className="sc-state-legend-item">
            <LegendSwatch mod={it.mod} icon={it.icon} />
            <span className="sc-state-legend-label">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Each swatch is a miniature of the atom's fill + glyph for the state.
// MiLB day / night swatches are pill dots, not status fills.
// Today is a navy ring around a neutral tile (the atom's ring chrome).
function LegendSwatch({ mod, icon }) {
  if (mod === "milb-day" || mod === "milb-night") {
    return (
      <span className={`sc-state-legend-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
        <span className="sc-state-legend-pill-dot" />
      </span>
    );
  }
  return (
    <span className={`sc-state-legend-swatch sc-state-legend-swatch--${mod}`} aria-hidden="true">
      {icon}
    </span>
  );
}
