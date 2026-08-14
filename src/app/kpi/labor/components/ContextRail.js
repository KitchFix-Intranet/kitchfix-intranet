"use client";
// src/app/kpi/labor/components/ContextRail.js
//
// D2 P8 - right rail card stack. V6 makes three renames + a copy
// rewrite; the underlying data flow is unchanged.
//
// V6-14 - Coverage card renamed PAYROLL DATA CHECK; content shape
//   becomes `<complete> of <total>` big-ok + status badge + one
//   plain-language sentence per dominant state + the In-view kv row
//   moved here from the retired rail-top panel. Copy is normative and
//   ships verbatim (spec §G).
// V6-15 - OT card `OVERTIME WATCH · RANGE`.
// V6-16 - Pipeline card `Nightly data feed` + status badge; the
//   existing disclosure detail is intact (no functional change).
//
// K3 vocabulary stands - Unpriced / Coverage remain the INTERNAL
// terms; only the operator-facing card TITLE was renamed.

import { useState } from "react";
import { fmtHrs, fmtTimestamp } from "../lib/formatting";

// Return top-N (worker_id, ot_hours) sorted desc, filtered to workers
// with any OT in the range. Uses real labor_actuals detail; no synth.
function computeOTWatch(actuals, N = 5) {
  const byWorker = new Map();
  for (const r of actuals) {
    const ot = Number(r.hours_overtime || 0);
    if (ot <= 0.004) continue;
    byWorker.set(r.worker_id, (byWorker.get(r.worker_id) || 0) + ot);
  }
  return [...byWorker.entries()]
    .map(([id, ot]) => ({ id, ot }))
    .sort((a, b) => b.ot - a.ot)
    .slice(0, N);
}

function workerLabel(meta, worker_id, redact) {
  const num = meta?.number != null ? `#${meta.number}` : `#${String(worker_id).slice(0, 6)}`;
  if (redact || !meta?.display_name) {
    const title = meta?.title ? ` · ${meta.title}` : "";
    return `${num}${title}`;
  }
  return `${meta.display_name} (${num})`;
}

function rateTitle(baseLabel, rangeTotals, workerId) {
  const t = rangeTotals?.[workerId];
  if (!t || t.hoursWorked <= 0 || t.dollarsTotal <= 0) return baseLabel;
  const rate = t.dollarsTotal / t.hoursWorked;
  return `${baseLabel} · ~$${rate.toFixed(2)}/hr avg in range`;
}

// V6-14 - severity ladder for the dominant-state sentence. Higher
// number = more severe. Mixed ranges lead with the most severe
// present. Copy is normative; do not rephrase.
const DATA_CHECK_COPY = {
  complete:   { rank: 0, badge: "COMPLETE", tone: "ok",   line: "Every shift in this range has priced hours. Nothing is missing from payroll." },
  hours_only: { rank: 1, badge: "HOURS IN", tone: "warn", line: "Hours are in, pay data has not landed yet." },
  partial:    { rank: 2, badge: "PARTIAL",  tone: "warn", line: "Some shifts are missing pay data - dollars for those weeks are incomplete." },
  no_labor:   { rank: 3, badge: "NO LABOR", tone: "muted",line: "No labor recorded in this range." },
  unknown:    { rank: 4, badge: "UNKNOWN",  tone: "bad",  line: "The data feed has not covered part of this range." },
};

function dominantState(coverageCounts) {
  const present = Object.keys(DATA_CHECK_COPY).filter(k => (coverageCounts?.[k] || 0) > 0);
  if (present.length === 0) return "complete";
  present.sort((a, b) => DATA_CHECK_COPY[b].rank - DATA_CHECK_COPY[a].rank);
  return present[0];
}

export function ContextRail({
  filteredActuals,
  totals,               // { hours_regular, hours_overtime, hours_double_time, hours_without_dollars, amount }
  coverageCounts,       // { complete, partial, hours_only, unknown, no_labor }
  freshness,            // { last_walk_at }
  freshnessHours,       // number | null
  data,                 // { unmapped_names, unattributed, derive_freshness }
  workers,              // { [worker_id]: { display_name, number, title } }
  workerRangeTotals,    // { [id]: { hoursWorked, dollarsTotal } }
  redact,
  weeksInRange,         // V6-13/V6-14 - canonical calendar week count, echoed in `In view` row
}) {
  const [pipeOpen, setPipeOpen] = useState(false);

  // Build alarms list - empty when healthy (RL-01).
  const alarms = [];
  if (freshnessHours != null && freshnessHours >= 54) {
    alarms.push({
      kind: "danger",
      title: `No successful derive in ${freshnessHours.toFixed(0)} hours.`,
      desc: `Last synced ${fmtTimestamp(freshness?.last_walk_at) || "—"} · figures were true then and will not include this week.`,
    });
  } else if (freshnessHours != null && freshnessHours >= 30) {
    alarms.push({
      kind: "warning",
      title: `Derive age ${freshnessHours.toFixed(1)}h`,
      desc: `Last synced ${fmtTimestamp(freshness?.last_walk_at) || "—"}.`,
    });
  } else if (freshnessHours == null) {
    alarms.push({
      kind: "danger",
      title: "No successful pay-segments walk on record.",
      desc: "The nightly ingest has not landed. Check the workflow.",
    });
  }
  const unkWeeks = coverageCounts?.unknown || 0;
  if (unkWeeks > 0) {
    alarms.push({
      kind: "warning",
      title: `${unkWeeks} week${unkWeeks > 1 ? "s" : ""} unknown.`,
      desc: `No presence walk covers ${unkWeeks > 1 ? "them" : "it"}.`,
    });
  }

  const ot = computeOTWatch(filteredActuals, 5);

  // V6-14 - PAYROLL DATA CHECK card.
  const total = Object.values(coverageCounts || {}).reduce((s, n) => s + Number(n || 0), 0);
  const complete = Number(coverageCounts?.complete || 0);
  const dominant = dominantState(coverageCounts);
  const copy = DATA_CHECK_COPY[dominant];
  const workerWeekCount = filteredActuals.length;

  return (
    <>
      {/* Alarms - empty container when healthy (RL-01). */}
      {alarms.length > 0 && (
        <div className="kpi-alarms">
          {alarms.map((a, i) => (
            <div key={i} className={`kpi-alarm-v5 kpi-alarm-${a.kind}`} role="alert">
              <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1" fill="currentColor" />
              </svg>
              <span><b>{a.title}</b>{" "}{a.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* V6-14 - PAYROLL DATA CHECK */}
      <div>
        <div className="kpi-rl-h">PAYROLL DATA CHECK</div>
        <div className="kpi-rl-card">
          <div className="kpi-rl-bigok">
            <b className="kpi-mono">{complete} of {total}</b>
            <span className={`kpi-rl-badge kpi-rl-badge-${copy.tone}`}>{dominant === "complete" ? "✓ " : ""}{copy.badge}</span>
          </div>
          <div className="kpi-rl-plain">{copy.line}</div>
          {weeksInRange != null && (
            <div className="kpi-pipe-row" style={{ marginTop: 10, borderTopStyle: "dashed" }}>
              <span>In view</span>
              <b className="kpi-mono">{weeksInRange} weeks · {workerWeekCount} worker-weeks</b>
            </div>
          )}
        </div>
      </div>

      {/* V6-15 - OVERTIME WATCH · RANGE */}
      {ot.length > 0 && (
        <div>
          <div className="kpi-rl-h">OVERTIME WATCH · RANGE</div>
          <div className="kpi-rl-card">
            {ot.map(x => {
              const label = workerLabel(workers?.[x.id], x.id, redact);
              const title = rateTitle(label, workerRangeTotals, x.id);
              return (
                <div key={x.id} className="kpi-cov-row-v5">
                  <b>{fmtHrs(x.ot)}</b>
                  <span className="kpi-cov-desc-v5" title={title}>{label}</span>
                </div>
              );
            })}
            <div className="kpi-rl-note">OT 1.5x hours in range · watch for threshold creep.</div>
          </div>
        </div>
      )}

      {/* V6-16 - Nightly data feed disclosure */}
      <div>
        <button
          type="button"
          className="kpi-disc-btn"
          aria-expanded={pipeOpen ? "true" : "false"}
          onClick={() => setPipeOpen(o => !o)}
        >
          <svg className="kpi-i kpi-chev" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Nightly data feed
          <span className={`kpi-rl-badge kpi-rl-badge-${alarms.some(a => a.kind === "danger") ? "bad" : (data?.unmapped_names?.length || data?.unattributed?.length ? "warn" : "ok")}`}>
            {alarms.some(a => a.kind === "danger") ? "STALE" : (data?.unmapped_names?.length || data?.unattributed?.length ? "ATTENTION" : "HEALTHY")}
          </span>
        </button>
        {pipeOpen && (
          <div className="kpi-rl-card">
            {[
              ["Orphan facts",           data?.unattributed?.length ?? 0],
              ["Unmapped earning types", data?.unmapped_names?.length ?? 0],
              ["Last derive",            data?.derive_freshness?.last_derive_at ? fmtTimestamp(data.derive_freshness.last_derive_at) : "—"],
              ["Last pay-seg walk",      data?.derive_freshness?.last_walk_at ? fmtTimestamp(data.derive_freshness.last_walk_at) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="kpi-pipe-row">
                <span>{k}</span><b>{v}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
