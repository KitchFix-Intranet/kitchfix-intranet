"use client";
// src/app/kpi/labor/components/ContextRail.js
//
// D2 P8 - right rail card stack.
//
// Order per v5 + spec §3.10:
//   Alarms - EMPTY container when healthy (RL-01). Header only shows
//            when there is a problem to name. Freshness/stale alarms +
//            unknown-week alarm.
//   Coverage - counts by state, merged legend, worker-weeks unit note.
//   OT watch - top-5 workers by OT hours in range, F16 rate titles.
//   Pipeline ▸ - disclosure button with one-word summary (F4). Body
//                shows orphan facts / unmapped types / presence age /
//                derive time / nightly walk. Empty by default.

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
  const nd = Number(totals?.hours_without_dollars || 0);

  const ot = computeOTWatch(filteredActuals, 5);

  const CoverageBadge = ({ state, label }) => (
    <span className={`kpi-bdg kpi-bdg-${state === "hours_only" ? "unpriced" : state === "no_labor" ? "zero" : state}`}>
      <span aria-hidden="true">{state === "complete" ? "✓" : state === "partial" ? "!" : state === "hours_only" ? "◷" : state === "unknown" ? "?" : "—"}</span>
      {label}
    </span>
  );

  const covDesc = {
    complete:   "every entry has dollars",
    partial:    "some entries lack dollars",
    hours_only: "before the 04-20 floor or payroll in progress",
    unknown:    "no successful presence walk",
    no_labor:   "no derived rows in range",
  };
  const covLabel = {
    complete:   "Complete",
    partial:    "Partial",
    hours_only: "Unpriced",
    unknown:    "Unknown",
    no_labor:   "No labor",
  };

  return (
    <>
      {/* Alarms - empty container when healthy (RL-01). Never renders an
          "All clear" pill; the empty column IS the healthy state. */}
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

      {/* Coverage card */}
      <div>
        <div className="kpi-rl-h">Coverage · worker-weeks in range</div>
        <div className="kpi-rl-card">
          {Object.keys(covLabel).filter(s => (coverageCounts?.[s] || 0) > 0).map(s => (
            <div key={s} className="kpi-cov-row-v5">
              <b>{coverageCounts[s]}</b>
              <CoverageBadge state={s} label={covLabel[s]} />
              <span className="kpi-cov-desc-v5">{covDesc[s]}</span>
            </div>
          ))}
          {nd > 0.004 && (
            <div className="kpi-rl-note">{fmtHrs(nd)} unpriced hrs in range · mostly the pre-04/20 floor</div>
          )}
          <div className="kpi-rl-note">Counts are worker-weeks, not table rows.</div>
        </div>
      </div>

      {/* OT watch - top 5 real */}
      {ot.length > 0 && (
        <div>
          <div className="kpi-rl-h">OT watch · range</div>
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

      {/* Pipeline health disclosure - closed by default, one-word summary */}
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
          Pipeline health
          <span className="kpi-pipesum">{alarms.some(a => a.kind === "danger") ? "stale" : (data?.unmapped_names?.length || data?.unattributed?.length ? "attention" : "healthy")}</span>
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
