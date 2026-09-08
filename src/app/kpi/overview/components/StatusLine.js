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
  // Kevin R-94 (2026-09-09). Awaiting-verification tone. Amber,
  // higher-contrast fill than the other tones (Kevin ruling: filled
  // pill with leading indicator dot signals "still moving"), so the
  // reader sees the state at a glance without reading the text.
  wait:    "kpi-ov-status-wait",
  // Kevin ruling 2026-09-08. Period-running tone. Navy filled pill
  // with a leading dot - names the state ("Period running") on the
  // running single-period surface. Same dot treatment as `wait`;
  // different palette (navy = neutral/live, not amber = still
  // moving).
  run:     "kpi-ov-status-run",
};

export default function StatusLine({ statusLine, rangeLabels, awaiting = null }) {
  if (!statusLine || !statusLine.state) return null;
  const toneClass = TONE_CLASS[statusLine.tone] || TONE_CLASS.neutral;
  const horizon = rangeLabels?.horizon || null;
  const showLeadingDot = statusLine.tone === "wait" || statusLine.tone === "run";

  // Kevin ruling 2026-09-08. Awaiting pill sits beside the status
  // pill on This year while a period is past its end and before its
  // R-93 settle date. Amber, filled with a leading dot - same
  // treatment as the closed-awaiting status pill on Last period.
  // Renders only when the parent passes awaiting != null.
  let awaitingCopy = null;
  if (awaiting?.period_no != null && awaiting.settle_iso) {
    const [, mo, da] = awaiting.settle_iso.split("-");
    awaitingCopy = `P${awaiting.period_no} awaiting verification · closes ${Number(mo)}/${Number(da)}`;
  }

  return (
    <div className="kpi-ov-statusrow" data-kpi-ov="status-line">
      <div
        className={`kpi-ov-status kpi-ov-status-pill ${toneClass}`}
        data-kpi-ov-state={statusLine.state}
        data-kpi-ov-tone={statusLine.tone}
      >
        {showLeadingDot && <span className="kpi-ov-status-dot" aria-hidden="true" />}
        <span className="kpi-ov-status-st" data-kpi-ov="status-state">
          {statusLine.state_copy}
        </span>
      </div>
      {awaitingCopy && (
        <div
          className={`kpi-ov-status kpi-ov-status-pill ${TONE_CLASS.wait}`}
          data-kpi-ov-state="awaiting_period"
          data-kpi-ov-tone="wait"
          data-kpi-ov="status-awaiting-pill"
        >
          <span className="kpi-ov-status-dot" aria-hidden="true" />
          <span className="kpi-ov-status-st">{awaitingCopy}</span>
        </div>
      )}
      {horizon && (
        <span className="kpi-ov-status-horizon" data-kpi-ov="status-horizon">
          {horizon}
        </span>
      )}
    </div>
  );
}
