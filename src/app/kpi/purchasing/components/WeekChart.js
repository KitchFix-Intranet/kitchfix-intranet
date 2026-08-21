"use client";
// src/app/kpi/purchasing/components/WeekChart.js
//
// Four-column week strip for a card. Bars carry identity color (§7
// rule 1); state adds a pattern overlay - never replaces the hue.
//
// The shape is passed IN. This component never computes elapsed or
// pace - the caller derived those from a single stateOf() call
// upstream so pill / hero / chart cannot drift. §9B one-source rule.
//
// Props:
//   weekAmounts    - array of 4 numbers (weekly $ spent, in order)
//   weekLabels     - array of 4 { date, note } for the caption
//   original       - dashed line: original weekly target
//   adjusted       - dashed line: adjusted target (null when closed)
//   identity       - 'food' | 'pkg' | 'veh' | 'equip' | 'rm'
//   state          - resolved card state (only affects the caption tones)
//   closed         - period lifecycle marker
//   runningWeekIdx - 0..3 index of the running week (null when closed)
//   emptyMessage   - override for the "no budget and no spend" panel
//
// A week with zero spend renders a baseline + "no spend" caption, per
// §7 rule 8. Never a green under-arrow at zero.

import { fmt$ } from "../lib/board";

function ArrowNote({ amount, tone }) {
  if (amount == null) return null;
  if (amount === 0) return <span className="kpi-p-x n">no spend</span>;
  const glyph = amount < 0 ? "▼" : "▲";
  return (
    <span className={`kpi-p-x ${tone}`}>
      {glyph} {fmt$(Math.abs(amount))}
    </span>
  );
}

export function WeekChart({
  weekAmounts,
  weekLabels,
  original,
  adjusted,
  identity,
  state,
  closed,
  runningWeekIdx,
  emptyMessage,
  isPassThrough,
}) {
  const totalBudget = original != null && weekAmounts && weekAmounts.length
    ? original * weekAmounts.length
    : 0;
  const spent = (weekAmounts || []).reduce((s, v) => s + Number(v || 0), 0);
  if (!spent && !totalBudget) {
    return (
      <div className="kpi-p-emptybucket">
        {emptyMessage || "No budget and no spend at this account."}
      </div>
    );
  }

  // Compute plot y-scale. Everything shares one denominator so bars
  // and the target lines sit on the same axis.
  const maxSample = Math.max(
    original || 0,
    adjusted || 0,
    ...(weekAmounts || []).map(v => Math.abs(Number(v || 0)) * 1.15),
    1,
  );

  const orig = original || 0;
  const adj  = adjusted;
  const periodOver = state === "over";

  return (
    <div className="kpi-p-wks">
      {(weekAmounts || []).map((raw, i) => {
        const v = Number(raw || 0);
        const running = !closed && runningWeekIdx === i;
        const finished = closed
          ? true
          : (runningWeekIdx != null ? i < runningWeekIdx : false);

        // Bar
        const showBar = Math.abs(v) > 0.005;
        const stateClass = running
          ? "st-run"
          : (finished && v > orig ? "st-over" : "");
        const heightPct = showBar
          ? Math.min(97, (Math.abs(v) / maxSample) * 100).toFixed(1)
          : 0;

        // Caption
        let val;
        let note;
        let tone;
        if (running) {
          val = "≥ " + fmt$(v);
          note = "in progress";
          tone = "a";
        } else if (finished) {
          val = fmt$(v);
          if (v === 0 && orig === 0) {
            note = "no spend";
            tone = "n";
          } else if (v === 0) {
            note = null; // "no spend" via ArrowNote below with amount=0
            tone = "n";
          } else if (orig === 0) {
            note = null;
            tone = "n";
          } else {
            const delta = v - orig;
            tone = delta > 0 ? "r" : "g";
            note = { delta };
          }
        } else if (isPassThrough) {
          val = "—";
          note = "no data yet";
          tone = "b";
        } else if (adj != null) {
          val = fmt$(adj);
          note = "to stay on budget";
          tone = "b";
        } else {
          val = "—";
          note = null;
          tone = "n";
        }

        // Target line: finished + closed weeks show original; running
        // + future weeks show adjusted (open period only).
        const lineType = closed
          ? (finished ? "orig" : null)
          : (finished ? "orig" : (isPassThrough ? null : "adj"));
        const lineValue = lineType === "orig" ? orig : (lineType === "adj" ? (adj || 0) : null);

        return (
          <div key={i} className="kpi-p-wc">
            <div className="kpi-p-plot">
              {lineType != null && lineValue != null && lineValue > 0 && (
                <span
                  className={`kpi-p-ln ${lineType}`}
                  style={{ bottom: `${Math.min(97, (lineValue / maxSample) * 100).toFixed(1)}%` }}
                  aria-hidden="true"
                />
              )}
              {showBar ? (
                <div
                  className={`kpi-p-bar i-${identity} ${stateClass}`}
                  style={{ height: `${heightPct}%` }}
                  aria-hidden="true"
                />
              ) : (
                <span className="kpi-p-base" aria-hidden="true" />
              )}
            </div>
            <div className="kpi-p-cap">
              <span className="kpi-p-v num">{val}</span>
              <span className="kpi-p-d">
                Wk {i + 1}
                {weekLabels && weekLabels[i]?.date ? ` · ${weekLabels[i].date}` : ""}
              </span>
              {note && typeof note === "string" && (
                <span className={`kpi-p-x ${tone}`}>{note}</span>
              )}
              {note && typeof note === "object" && (
                <ArrowNote amount={note.delta} tone={tone} />
              )}
              {!note && v === 0 && finished && (
                <span className="kpi-p-x n">no spend</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
