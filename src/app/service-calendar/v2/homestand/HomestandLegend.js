"use client";

// M-2 defect fix (2026-07-29 owner ruling, live-gate bounce):
// dedicated legend for the homestand day strip. Covers ONLY what
// DayStrip.js paints. Vocabulary:
//   - Game day       (.sc-daystrip-cell--game)
//   - Served         (.sc-daystrip-cell--game.sc-daystrip-cell--served)
//   - Prep proposal  (.sc-daystrip-cell--prep)
//   - No service     (.sc-daystrip-cell--exception)
//   - New month      (.sc-daystrip-monthbreak marker)
//
// Deliberately NOT reusing `StateLegend` from season/StateLegend.js.
// That component's vocabulary belongs to the day-tile surface and
// carries nine keys (Entered / Needs entry / Overdue / Upcoming /
// Non Game day / EXH / Away / Game day / Today) - eight of which
// the day strip does not paint and one of which (Prep) it does not
// name. Reusing it teaches the wrong vocabulary; owner rule §16
// legend audit calls out this exact failure mode.
//
// Not included:
//   - `missing` cell (.sc-daystrip-cell--missing): expected
//     unreachable inside a block span per the trap §11.2 invariant
//     in buildM2Homestands (server pushes every non-GAME span date
//     into prepSet by construction). If it paints, the operator
//     sees a dashed "no data" tile that is self-describing; the
//     legend does not teach a vocabulary for a state that only
//     appears when something else has already failed.
//
// Shape decision: dedicated legend, not a shared framework. The
// strip's vocabulary is small enough (5 keys) that a per-surface
// component is honest scope. If a future M-N adds more homestand-
// like surfaces with similar vocabulary needs, revisit and consider
// a shared `<Legend items={...}>` primitive at that point.

import "./homestand.css";

export default function HomestandLegend() {
  return (
    <div
      className="sc-hs-legend"
      role="list"
      aria-label="Homestand day strip legend"
    >
      <div className="sc-hs-legend-item" role="listitem">
        <span
          className="sc-hs-legend-swatch sc-hs-legend-swatch--game"
          aria-hidden="true"
        />
        <span className="sc-hs-legend-label">Game day</span>
      </div>
      <div className="sc-hs-legend-item" role="listitem">
        <span
          className="sc-hs-legend-swatch sc-hs-legend-swatch--served"
          aria-hidden="true"
        />
        <span className="sc-hs-legend-label">Served</span>
      </div>
      <div className="sc-hs-legend-item" role="listitem">
        <span
          className="sc-hs-legend-swatch sc-hs-legend-swatch--prep"
          aria-hidden="true"
        />
        <span className="sc-hs-legend-label">Prep proposal</span>
      </div>
      <div className="sc-hs-legend-item" role="listitem">
        <span
          className="sc-hs-legend-swatch sc-hs-legend-swatch--exception"
          aria-hidden="true"
        />
        <span className="sc-hs-legend-label">No service</span>
      </div>
      <div className="sc-hs-legend-item" role="listitem">
        <span
          className="sc-hs-legend-swatch sc-hs-legend-swatch--monthbreak"
          aria-hidden="true"
        />
        <span className="sc-hs-legend-label">New month</span>
      </div>
    </div>
  );
}
