"use client";
// src/app/kpi/overview/components/StatusLine.js
//
// A3+A4 (2026-09-01). Retires the ticker. One sentence, fixed shape,
// every account: state block, then GM vs target · biggest lever · weeks
// closed. No account-model notes - the Revenue card's CONTRACTUAL pill
// and the billed-back tags on the statement rows carry the account
// facts, and the longest note ("Food billed back to the client - labor
// is the main lever") forced the ticker to wrap on fee accounts.
//
// Payload contract: `status_line` (resolver.js buildStatusLine):
//   { state, state_copy,
//     gm_actual_display, gm_target_display,     // "42.6%" / "44.2%"
//     biggest_lever: {                          // may be null
//       label, dev_display, direction: "under"|"over",
//     },
//     progress_display,                          // "3 of 4 weeks closed" or null
//   }

const STATE_CLASS = {
  ahead: "kpi-ov-status-ahead",
  on_track_above: "kpi-ov-status-ontrack",
  on_track_below: "kpi-ov-status-ontrack",
  behind: "kpi-ov-status-behind",
  critical: "kpi-ov-status-critical",
};

export default function StatusLine({ statusLine }) {
  if (!statusLine || !statusLine.state) return null;
  const stateClass = STATE_CLASS[statusLine.state] || "kpi-ov-status-ontrack";

  const gm = (statusLine.gm_actual_display && statusLine.gm_target_display) ? (
    <span data-kpi-ov="status-gm">
      Gross margin <b>{statusLine.gm_actual_display}</b> vs {statusLine.gm_target_display} target
    </span>
  ) : null;

  const lever = statusLine.biggest_lever ? (
    <span data-kpi-ov="status-lever">
      {statusLine.biggest_lever.label} is{" "}
      <b>
        {statusLine.biggest_lever.dev_display} {statusLine.biggest_lever.direction}
      </b>{" "}
      its target
    </span>
  ) : null;

  const progress = statusLine.progress_display ? (
    <span data-kpi-ov="status-progress">{statusLine.progress_display}</span>
  ) : null;

  const segments = [gm, lever, progress].filter(Boolean);

  return (
    <div
      className={`kpi-ov-status ${stateClass}`}
      data-kpi-ov="status-line"
      data-kpi-ov-state={statusLine.state}
    >
      <span className="kpi-ov-status-st" data-kpi-ov="status-state">
        {statusLine.state_copy}
      </span>
      <span className="kpi-ov-status-say">
        {segments.map((seg, i) => (
          <span key={i}>
            {i > 0 && <span className="kpi-ov-status-sep" aria-hidden="true"> · </span>}
            {seg}
          </span>
        ))}
      </span>
    </div>
  );
}
