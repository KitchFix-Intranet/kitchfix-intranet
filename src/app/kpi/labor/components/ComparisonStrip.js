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

import { fmt$ } from "../lib/formatting.js";
import HelpPop from "./HelpPop.js";

// PR-E - "Compared to last period" popover copy per kitchfix-help-copy
// (section "Period board · other regions"). Verbatim; replaces the
// prior per-measure explanation block, which was accurate but read as
// reference documentation rather than the "how to read this" voice
// the doc adopted.
const VS_PREV_BODY = (
  <>
    How this period is running against the last <b>closed</b> one - only complete periods, so you are never comparing a half-finished period to a whole one.
    <br /><br />
    <b>Down and green is better on every measure here.</b> A lower blended rate, less overtime, less spend per week.
    <br /><br />
    <b>Spend per week and hours per week are the honest comparison</b> when the periods are different lengths. Totals are not.
  </>
);

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

// V33 P0 - every strip value renders ABSOLUTE; the arrow carries
// direction (V29-18). Prior fmt for delta$ passed a "-" sign alongside
// the arrow, producing `▼ -$1.21` (double negative).
function fmtDelta(now, prior, unit) {
  if (now == null || prior == null) return { text: "—", arrow: null };
  if (unit === "delta$") {
    const d = now - prior;
    if (Math.abs(d) < 0.005) return { text: `$${now.toFixed(2)}`, arrow: null };
    return { text: `$${Math.abs(d).toFixed(2)}`, delta: d, arrow: d < 0 ? "▼" : "▲" };
  }
  if (unit === "points") {
    const d = now - prior;
    if (Math.abs(d) < 0.05) return { text: `${Math.abs(d).toFixed(1)} pts`, arrow: null };
    return { text: `${Math.abs(d).toFixed(1)} pts`, delta: d, arrow: d < 0 ? "▼" : "▲" };
  }
  if (unit === "workers") {
    const d = now - prior;
    if (d === 0) return { text: "0", arrow: null };
    return { text: `${Math.abs(d)}`, delta: d, arrow: d < 0 ? "▼" : "▲" };
  }
  const base = prior === 0 ? 1 : prior;
  const dPct = ((now - prior) / base) * 100;
  if (Math.abs(dPct) < 0.05) return { text: `${Math.abs(dPct).toFixed(1)}%`, arrow: null };
  return { text: `${Math.abs(dPct).toFixed(1)}%`, delta: dPct, arrow: dPct < 0 ? "▼" : "▲" };
}

function toneFor(delta, betterDown) {
  if (delta == null || Math.abs(delta) < 1e-9) return undefined;
  if (betterDown == null) return undefined;
  const down = delta < 0;
  return (betterDown ? down : !down) ? "good" : "bad";
}

export function ComparisonStrip({ prior_period_comparison, salaryIncluded }) {
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
      <div className="kpi-cmp-source">PERIOD {pp.prior_period_no} · 4 wks closed</div>
      <div className="kpi-cmp-help-wrap">
        <HelpPop
          id="qVsPrev"
          title="Compared to last period"
          body={salaryIncluded
            ? (<>{VS_PREV_BODY}<span className="kpi-hs-pop-foot">Salary figures are base only; bonuses and one-time payments are not included.</span></>)
            : VS_PREV_BODY}
        />
      </div>
    </div>
  );
}
