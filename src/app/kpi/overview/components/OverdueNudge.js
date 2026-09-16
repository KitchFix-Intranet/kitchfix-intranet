"use client";
// src/app/kpi/overview/components/OverdueNudge.js
//
// Kevin ruling 2026-09-17. Sibling of SettlingStrip. That strip fires
// while a closed period is still moving (pre-R-93 settle boundary);
// this one fires AFTER the settle boundary while Finance still hasn't
// posted the P&L. One turns off exactly when the other turns on.
//
// Payload contract:
//   overdue_periods: [{ period_no, period_end_iso, days_since_close }]
// Empty array (or missing) -> nothing renders.

export default function OverdueNudge({ overduePeriods }) {
  if (!overduePeriods || !overduePeriods.length) return null;
  return (
    <div className="kpi-ov-overdue" data-kpi-ov="overdue-nudge">
      {overduePeriods.map(p => (
        <span
          key={p.period_no}
          className="kpi-ov-overdue-it"
          data-kpi-ov="overdue-nudge-it"
          data-kpi-ov-period={p.period_no}
        >
          <b>P{p.period_no}</b>
          {" closed "}
          {p.days_since_close} {p.days_since_close === 1 ? "day" : "days"} ago
          {" · no finance P&L loaded"}
        </span>
      ))}
    </div>
  );
}
