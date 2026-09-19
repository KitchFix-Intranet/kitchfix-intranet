"use client";
// src/app/kpi/overview/components/SkeletonBoard.js
//
// PR-2 item 20b (Kevin, 2026-09-02): the cold-load skeleton matches
// the loaded shape. Card bounding boxes are in the same positions in
// both. A page that paints as stacked bands and then jumps into two
// columns reads as broken on first impression.
//
// Kevin R-128 Part 3 item 8 (2026-09-19): a third shape for the
// Current / Next period surfaces. Prior versions rendered the
// closed-period layout under every state, so CP and NP visibly
// reflowed on load (classic 3-KPI-cards + two-column skeleton -> six-
// column week grid). Now the `state` prop drives the shape:
//   state="portfolio" -> portfolio-scope skeleton (ALL / EAST / WEST)
//   state="cp"        -> week-grid-shaped skeleton (CP or NP)
//   state omitted     -> closed-period layout (previous behaviour)
// Callers who still pass `portfolio={true}` are honoured (back-
// compat) via the fallback below.

import { Fragment } from "react";

function Bar({ w = "60%", h = 14, mt = 0, mb = 0 }) {
  return (
    <div
      className="kpi-ov-skel-bar"
      style={{ width: w, height: h, marginTop: mt, marginBottom: mb }}
      aria-hidden="true"
    />
  );
}

function CardSkel({ variant = "default", children }) {
  return (
    <div className={`kpi-ov-skel-card kpi-ov-skel-${variant}`} aria-hidden="true">
      {children}
    </div>
  );
}

function PortfolioSkel() {
  return (
    <div data-kpi-ov="skel" data-kpi-ov-scope="portfolio">
      <div className="kpi-ov-skel" style={{ marginBottom: 12 }}>
        <div className="kpi-ov-skel-bar" style={{ width: "40%" }} />
      </div>
      <div className="kpi-ov-skel" style={{ marginBottom: 12 }}>
        <div className="kpi-ov-skel-bar kpi-ov-skel-hero" />
        <div className="kpi-ov-skel-bar" style={{ width: "50%" }} />
      </div>
      <div className="kpi-ov-cards" style={{ marginBottom: 12 }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="kpi-ov-skel">
            <div className="kpi-ov-skel-bar" style={{ width: "30%" }} />
            <div className="kpi-ov-skel-bar kpi-ov-skel-hero" />
            <div className="kpi-ov-skel-bar" style={{ width: "70%" }} />
            <div className="kpi-ov-skel-bar" style={{ width: "50%" }} />
          </div>
        ))}
      </div>
      <div className="kpi-ov-skel" style={{ minHeight: 220 }}>
        <div className="kpi-ov-skel-bar" style={{ width: "35%" }} />
        <div className="kpi-ov-skel-bar" style={{ width: "20%", height: 90 }} />
      </div>
    </div>
  );
}

function ClosedSkel() {
  return (
    <div className="kpi-ov-skel-board" data-kpi-ov="skel" data-kpi-ov-scope="single">
      {/* Status bar */}
      <div className="kpi-ov-skel-status" aria-hidden="true">
        <div className="kpi-ov-skel-status-state" />
        <div className="kpi-ov-skel-status-say" />
      </div>
      {/* Three KPI cards */}
      <div className="kpi-ov-skel-cards" aria-hidden="true">
        <CardSkel variant="rev"><Bar w="35%" /><Bar w="60%" h={28} mt={12} /><Bar w="80%" mt={10} /></CardSkel>
        <CardSkel variant="cogs"><Bar w="40%" /><Bar w="70%" h={28} mt={12} /><Bar w="85%" mt={10} /></CardSkel>
        <CardSkel variant="gm"><Bar w="30%" /><Bar w="65%" h={28} mt={12} /><Bar w="80%" mt={10} /></CardSkel>
      </div>
      {/* Two-column split */}
      <div className="kpi-ov-skel-split" aria-hidden="true">
        <div className="kpi-ov-skel-col-left">
          <CardSkel variant="chart">
            <Bar w="45%" />
            <div className="kpi-ov-skel-chart-bars">
              <div /><div /><div /><div />
            </div>
          </CardSkel>
          <CardSkel variant="costlines">
            <Bar w="35%" />
            <Bar w="90%" mt={10} h={22} />
            <Bar w="90%" mt={8} h={22} />
            <Bar w="90%" mt={8} h={22} />
            <Bar w="90%" mt={8} h={22} />
            <Bar w="90%" mt={12} h={22} />
          </CardSkel>
        </div>
        <div className="kpi-ov-skel-col-right">
          <CardSkel variant="pace">
            <Bar w="60%" />
            <Bar w="40%" h={28} mt={12} />
            <Bar w="90%" mt={10} />
          </CardSkel>
          <CardSkel variant="revlines">
            <Bar w="45%" />
            <Bar w="90%" mt={10} h={18} />
            <Bar w="90%" mt={6} h={18} />
            <Bar w="90%" mt={6} h={18} />
          </CardSkel>
          <CardSkel variant="tracked">
            <Bar w="45%" />
            <Bar w="90%" mt={10} h={18} />
            <Bar w="90%" mt={6} h={18} />
            <Bar w="90%" mt={6} h={18} />
          </CardSkel>
        </div>
      </div>
      {/* Full-width P&L fold placeholder */}
      <div className="kpi-ov-skel-fold" aria-hidden="true">
        <Bar w="40%" />
      </div>
    </div>
  );
}

// Kevin R-128 Part 3 item 8 (2026-09-19). Week-grid-shaped skeleton
// for the CurrentPeriodTable surface. Matches the loaded shape at the
// bounding-box level: status strip, then a 6-column grid with a
// header row + 6 data rows (Revenue + 4 cost rows + Total). WK 2
// carries the lift marker so the raised current-week silhouette
// pre-mounts. Bars inside each cell approximate value + split + bar
// + verdict lines so cell heights land close to the loaded state
// and the page does not visibly reflow when data arrives.
function CpSkel() {
  const ROWS = 6; // Revenue + 4 cost rows + Total
  return (
    <div data-kpi-ov="skel" data-kpi-ov-scope="cp">
      <div className="kpi-ov-cp-skel-status" aria-hidden="true">
        <Bar w="120px" h={22} />
        <Bar w="220px" h={14} mt={0} />
      </div>
      <div className="kpi-ov-cp-skel-grid" aria-hidden="true">
        {/* Header cells */}
        <div className="kpi-ov-cp-skel-corner" />
        {[0, 1, 2, 3, 4].map(i => (
          <div key={`h-${i}`} className={`kpi-ov-cp-skel-hcell${i === 1 ? " kpi-ov-cp-skel-now" : ""}${i === 4 ? " kpi-ov-cp-skel-per" : ""}`}>
            <Bar w="70%" h={12} />
            <Bar w="85%" h={10} mt={5} />
          </div>
        ))}
        {/* Data rows */}
        {Array.from({ length: ROWS }).map((_, ri) => (
          <Fragment key={`r-${ri}`}>
            <div className="kpi-ov-cp-skel-rlab">
              <Bar w="75%" h={13} />
              <Bar w="55%" h={10} mt={4} />
            </div>
            {[0, 1, 2, 3, 4].map(ci => (
              <div key={`c-${ri}-${ci}`} className={`kpi-ov-cp-skel-cell${ci === 1 ? " kpi-ov-cp-skel-now" : ""}${ci === 4 ? " kpi-ov-cp-skel-per" : ""}`}>
                <Bar w="60%" h={16} />
                <Bar w="80%" h={4} mt={8} />
                <Bar w="45%" h={10} mt={5} />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export default function SkeletonBoard({ state, portfolio = false } = {}) {
  // Back-compat: honour `portfolio={true}` from callers not yet
  // migrated to the `state` prop.
  const s = state || (portfolio ? "portfolio" : "closed");
  if (s === "portfolio") return <PortfolioSkel />;
  if (s === "cp") return <CpSkel />;
  return <ClosedSkel />;
}
