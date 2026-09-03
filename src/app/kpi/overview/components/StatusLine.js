"use client";
// src/app/kpi/overview/components/StatusLine.js
//
// Kevin ruling 2026-09-03 (top-simplify): the status line collapses
// to a pill. Kevin ruling final-presentation (2026-09-03): the pill
// is followed by the horizon line - the answer to "as of when" that
// an operator needs before they trust a percentage. Server ships
// `range_labels.horizon` (produced by R-63 in the resolver); this
// component renders it beside the pill.
//
// Horizon copy:
//   open   -> "through week 3 · 08/24 – 08/30"
//   closed -> "P8 · closed and verified" / "P1-P8 · closed and verified"
//
// Payload contract:
//   statusLine: { state, state_copy, tone }
//   rangeLabels.horizon: string | null

const TONE_CLASS = {
  good:    "kpi-ov-status-good",
  bad:     "kpi-ov-status-bad",
  neutral: "kpi-ov-status-neutral",
};

export default function StatusLine({ statusLine, rangeLabels }) {
  if (!statusLine || !statusLine.state) return null;
  const toneClass = TONE_CLASS[statusLine.tone] || TONE_CLASS.neutral;
  const horizon = rangeLabels?.horizon || null;

  return (
    <div className="kpi-ov-statusrow" data-kpi-ov="status-line">
      <div
        className={`kpi-ov-status kpi-ov-status-pill ${toneClass}`}
        data-kpi-ov-state={statusLine.state}
        data-kpi-ov-tone={statusLine.tone}
      >
        <span className="kpi-ov-status-st" data-kpi-ov="status-state">
          {statusLine.state_copy}
        </span>
      </div>
      {horizon && (
        <span className="kpi-ov-status-horizon" data-kpi-ov="status-horizon">
          {horizon}
        </span>
      )}
    </div>
  );
}
