"use client";
// src/app/kpi/overview/components/StatusLine.js
//
// Kevin ruling 2026-09-03 (top-simplify): the status line becomes a
// single pill. Every sentence segment it used to render (GM vs target,
// biggest lever, "N of M weeks closed" / "8 of 9 periods verified")
// was a restatement of what the three cards immediately beneath the
// pill already say. Gross margin is card three; the biggest lever is
// the top row of the cost-lines table.
//
// The pill carries `state_copy` colored by `tone`:
//   PERIOD CLOSED · OFF TARGET / ON TARGET      (closed ranges)
//   OFF TARGET / ON TARGET / At risk / etc.     (open ranges)
//   No target                                   (rolling windows)
//
// Payload contract shrunk in resolver.js buildStatusLine:
//   { state, state_copy, tone }
// gm_actual_display, gm_target_display, biggest_lever, progress_display
// and gm_tone were removed - no other consumers.

const TONE_CLASS = {
  good:    "kpi-ov-status-good",
  bad:     "kpi-ov-status-bad",
  neutral: "kpi-ov-status-neutral",
};

export default function StatusLine({ statusLine }) {
  if (!statusLine || !statusLine.state) return null;
  const toneClass = TONE_CLASS[statusLine.tone] || TONE_CLASS.neutral;

  return (
    <div
      className={`kpi-ov-status kpi-ov-status-pill ${toneClass}`}
      data-kpi-ov="status-line"
      data-kpi-ov-state={statusLine.state}
      data-kpi-ov-tone={statusLine.tone}
    >
      <span className="kpi-ov-status-st" data-kpi-ov="status-state">
        {statusLine.state_copy}
      </span>
    </div>
  );
}
