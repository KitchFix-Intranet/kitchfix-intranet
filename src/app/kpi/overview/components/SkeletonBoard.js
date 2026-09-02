"use client";
// src/app/kpi/overview/components/SkeletonBoard.js
//
// PR-2 item 20b (Kevin, 2026-09-02): the cold-load skeleton matches
// the loaded shape. Card bounding boxes are in the same positions in
// both. A page that paints as stacked bands and then jumps into two
// columns reads as broken on first impression.
//
// Structure (single-account scope):
//   status bar (full width)
//   3 KPI cards (grid)
//   two-column split:
//     left  - chart, cost lines
//     right - pace, revenue lines, also tracked
//   full-width P&L fold placeholder
//
// Portfolio scope (ALL / EAST / WEST) keeps the old skeleton - a
// different layout served by a different code path in page.js.

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

export default function SkeletonBoard({ portfolio = false } = {}) {
  if (portfolio) {
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
