"use client";
// src/app/kpi/labor/components/ComparisonStrip.js
//
// V32-12..V32-15 - context strip beneath the signal row. Six
// SCALE-FREE measures compared to the prior period, at context weight
// (tinted ground, no card chrome, no shadow). It is not a fifth card:
// a card implies "act on this"; a comparison implies "is this normal".
//
// V32-13 measures:
//   Blended rate   ($/hr, signed $)
//   Overtime       (percentage points, signed)
//   Crew size      (workers, signed integer)
//   Spend / week   (signed % change)
//   Hours / week   (signed % change)
//   Cost / worker  (signed % change; dollars per person per week)
//
// V32-15 - renders NOTHING when there is no comparable prior period.

import { useEffect, useRef, useState } from "react";
import { fmt$ } from "../lib/formatting.js";

const MEASURE_META = {
  blended_rate:    { label: "Blended rate",   unit: "delta$",  betterDown: true  },
  overtime_pct:    { label: "Overtime",       unit: "points",  betterDown: true  },
  crew_size:       { label: "Crew size",      unit: "workers", betterDown: null  },
  spend_per_week:  { label: "Spend / week",   unit: "pct",     betterDown: true  },
  hours_per_week:  { label: "Hours / week",   unit: "pct",     betterDown: true  },
  cost_per_worker: { label: "Cost / worker",  unit: "pct",     betterDown: true  },
};

const MEASURE_ORDER = [
  "blended_rate", "overtime_pct", "crew_size",
  "spend_per_week", "hours_per_week", "cost_per_worker",
];

const DEF_LINES = {
  blended_rate:    "Blended rate = spend / hours ($/hr). Cheaper is greener.",
  overtime_pct:    "Overtime = OT hours / total hours worked (percentage points). Less is greener.",
  crew_size:       "Crew size = distinct workers with paid hours in the range. No direction; context only.",
  spend_per_week:  "Spend / week = spend / elapsed weeks. Percentage change vs prior. Less is greener.",
  hours_per_week:  "Hours / week = hours / elapsed weeks. Percentage change vs prior. Less is greener.",
  cost_per_worker: "Cost / worker = spend / elapsed weeks / distinct workers ($/person/week). Percentage change vs prior. Less is greener.",
};

function fmtDelta(now, prior, unit) {
  if (now == null || prior == null) return { text: "—", tone: undefined, arrow: null };
  if (unit === "delta$") {
    const d = now - prior;
    if (Math.abs(d) < 0.005) return { text: `$${now.toFixed(2)}`, tone: undefined, arrow: null };
    return { text: `${d < 0 ? "-" : ""}$${Math.abs(d).toFixed(2)}`, delta: d, arrow: d < 0 ? "▼" : "▲" };
  }
  if (unit === "points") {
    const d = now - prior;
    if (Math.abs(d) < 0.05) return { text: `${d.toFixed(1)} pts`, arrow: null };
    return { text: `${Math.abs(d).toFixed(1)} pts`, delta: d, arrow: d < 0 ? "▼" : "▲" };
  }
  if (unit === "workers") {
    const d = now - prior;
    if (d === 0) return { text: `${d}`, arrow: null };
    return { text: `${Math.abs(d)}`, delta: d, arrow: d < 0 ? "▼" : "▲" };
  }
  // pct
  const base = prior === 0 ? 1 : prior;
  const dPct = ((now - prior) / base) * 100;
  if (Math.abs(dPct) < 0.05) return { text: `${dPct.toFixed(1)}%`, arrow: null };
  return { text: `${Math.abs(dPct).toFixed(1)}%`, delta: dPct, arrow: dPct < 0 ? "▼" : "▲" };
}

function toneFor(delta, betterDown) {
  if (delta == null || Math.abs(delta) < 1e-9) return undefined;
  if (betterDown == null) return undefined;
  const down = delta < 0;
  return (betterDown ? down : !down) ? "good" : "bad";
}

function HelpButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="kpi-cmp-help-anchor" ref={rootRef}>
      <button
        type="button"
        className="kpi-cmp-help"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label="About the comparison strip"
        onClick={() => setOpen(o => !o)}
      >?</button>
      {open && (
        <div className="kpi-cmp-help-pop" role="dialog">
          <h5>COMPARISON</h5>
          {MEASURE_ORDER.map(k => (
            <div key={k} className="kpi-cmp-help-row">
              <b>{MEASURE_META[k].label}</b>{" "}{DEF_LINES[k]}
            </div>
          ))}
          <div className="kpi-cmp-help-foot">
            Only rates and ratios appear here because the current period is part-run. Raw totals are not comparable until both periods are closed.
          </div>
        </div>
      )}
    </span>
  );
}

export function ComparisonStrip({ prior_period_comparison }) {
  const pp = prior_period_comparison;
  if (!pp || !pp.applies) return null;

  const items = MEASURE_ORDER.map(k => {
    const meta = MEASURE_META[k];
    const d = fmtDelta(pp.now[k], pp.prior[k], meta.unit);
    const tone = toneFor(d.delta, meta.betterDown);
    return { key: k, label: meta.label, delta: d, tone };
  });

  return (
    <div className="kpi-cmp" role="region" aria-label={`vs Period ${pp.prior_period_no}`}>
      <div className="kpi-cmp-title">
        <span className="kpi-cmp-title-lab">VS PERIOD {pp.prior_period_no}</span>
      </div>
      <div className="kpi-cmp-items">
        {items.map(it => (
          <div key={it.key} className="kpi-cmp-item">
            <div className="kpi-cmp-item-lab">{it.label}</div>
            <div className={`kpi-cmp-item-val ${it.tone ? `kpi-cmp-item-val-${it.tone}` : ""}`}>
              {it.delta.arrow && <span className="kpi-cmp-arr" aria-hidden="true">{it.delta.arrow}</span>}
              {it.delta.text}
            </div>
          </div>
        ))}
      </div>
      <HelpButton />
    </div>
  );
}
