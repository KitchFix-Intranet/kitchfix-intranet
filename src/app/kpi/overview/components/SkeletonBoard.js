"use client";
// src/app/kpi/overview/components/SkeletonBoard.js
//
// Cold-load skeleton mirroring the final layout: sources line, ticker
// stripe, three cards, chart, lever table, drill row, statement fold.
// Per Phase E of the brief.

export default function SkeletonBoard() {
  return (
    <div data-kpi-ov="skeleton" aria-label="Loading Overview">
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
      <div className="kpi-ov-skel" style={{ marginBottom: 12, minHeight: 220 }}>
        <div className="kpi-ov-skel-bar" style={{ width: "35%" }} />
        <div className="kpi-ov-skel-bar" style={{ width: "20%", height: 90 }} />
      </div>
      <div className="kpi-ov-skel" style={{ minHeight: 100 }}>
        <div className="kpi-ov-skel-bar" style={{ width: "30%" }} />
        <div className="kpi-ov-skel-bar" style={{ width: "80%" }} />
        <div className="kpi-ov-skel-bar" style={{ width: "80%" }} />
      </div>
    </div>
  );
}
