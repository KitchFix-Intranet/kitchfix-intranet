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
// §9B ONE-SOURCE BINDING (Fix 3, PR 2 round 1):
//   For every rendered week, bar height and caption value resolve
//   from the SAME `slot` object. The slot's `value` field is either
//   a real number (draw the bar to that height and print that number
//   in the caption) or null (no bar, caption prints no $ value).
//   The target dashed line is REFERENCE geometry, never a bar. The
//   assertion at the bottom of the map fires in development if any
//   rendered week has one without the other.
//
// Props:
//   weekAmounts    - array of numbers (weekly $ spent, in order)
//   weekLabels     - array of { date, note } for the caption
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

// Build the per-week render slot. ONE object per week - bar height
// and caption value derive from `slot.value` so they cannot disagree.
//
// Contract:
//   slot.value === null    -> no bar, caption shows no $ figure
//   slot.value >= 0        -> bar height driven by |value|, caption
//                             shows fmt$(value) as the primary figure
//
// The dashed target line is REFERENCE geometry off `original`/`adjusted`
// - never a bar. Future weeks with no spend get slot.value=null and
// render a baseline, meeting the "no value -> no bar" invariant.
function buildSlot({ raw, running, finished, closed, orig, adj, isPassThrough }) {
  const v = Number(raw || 0);
  const hasSpend = Math.abs(v) > 0.005;
  if (running) {
    // Running week. Caption's primary VALUE and bar height come from
    // `v`. No spend yet -> caption still says "in progress" but the
    // primary line is em-dash (no $ number) and bar is baseline. Any
    // spend -> bar and "≥ $X" caption agree.
    if (!hasSpend) {
      return {
        value:   null,
        caption: { val: "—", note: "in progress", tone: "a" },
      };
    }
    return {
      value:   v,
      caption: { val: "≥ " + fmt$(v), note: "in progress", tone: "a" },
    };
  }
  if (finished) {
    if (!hasSpend) {
      // Finished week with no spend - baseline + "no spend" caption.
      // Value line is em-dash to match the "no value -> no bar"
      // invariant; "no spend" note is text-only.
      return {
        value:   null,
        caption: { val: "—", note: "no spend", tone: "n" },
      };
    }
    if (orig === 0) {
      // Finished week with spend but no per-week target - neutral tone.
      return {
        value:   v,
        caption: { val: fmt$(v), note: null, tone: "n" },
      };
    }
    // Finished week with spend and a target - delta arrow.
    const delta = v - orig;
    return {
      value:   v,
      caption: { val: fmt$(v), delta, tone: delta > 0 ? "r" : "g" },
    };
  }
  // Future week: caption has NO $ value; bar is baseline. The dashed
  // adjusted-target line still shows on the plot as reference.
  if (isPassThrough) {
    return {
      value:   null,
      caption: { val: "—", note: "no data yet", tone: "b" },
    };
  }
  if (adj != null) {
    // Adjusted target exists - text-only reference in the caption.
    // fmt$ appears in the note text, not as the primary VALUE line,
    // so a caller cannot mistake it for the week's actual figure.
    return {
      value:   null,
      caption: { val: "—", note: `aim for ${fmt$(adj)}`, tone: "b" },
    };
  }
  return {
    value:   null,
    caption: { val: "—", note: null, tone: "n" },
  };
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

  // Precompute per-week slots so the render loop reads bar height and
  // caption value from the SAME object. Any drift between the two is
  // impossible at the JSX layer.
  const slots = (weekAmounts || []).map((raw, i) => {
    const running = !closed && runningWeekIdx === i;
    const finished = closed
      ? true
      : (runningWeekIdx != null ? i < runningWeekIdx : false);
    return buildSlot({ raw, running, finished, closed, orig, adj, isPassThrough });
  });

  // Dev-only §9B assertion: every rendered week's bar and caption
  // MUST derive from the same value. Contract:
  //   slot.value === null  -> baseline (no bar), caption VALUE is not
  //                            a $ figure (may be "—" or "$0.00" is
  //                            forbidden because "$0.00" IS a $ figure).
  //   slot.value >= 0.005  -> bar renders to that height, caption VALUE
  //                            contains fmt$(value) as its primary line.
  // A finished $0 week uses value=null and caption val="—" + text note
  // "no spend"; the running/future no-spend case is the same. Any
  // $-showing caption without a matching bar is exactly the §9B
  // class defect and throws in development.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      const hasBar = s.value != null && Math.abs(Number(s.value)) > 0.005;
      const capV = s.caption && typeof s.caption.val === "string" ? s.caption.val : "";
      const captionHasDollar = capV.includes("$");
      if (hasBar && !captionHasDollar) {
        // eslint-disable-next-line no-console
        console.error("[WeekChart §9B] week", i, "has a bar but caption has no $ value:", s);
        throw new Error(`WeekChart §9B: bar without caption value at week ${i + 1}`);
      }
      if (!hasBar && captionHasDollar) {
        // eslint-disable-next-line no-console
        console.error("[WeekChart §9B] week", i, "caption shows a $ value but no bar:", s);
        throw new Error(`WeekChart §9B: caption without bar at week ${i + 1}`);
      }
    }
  }

  return (
    <div className="kpi-p-wks">
      {slots.map((slot, i) => {
        const running = !closed && runningWeekIdx === i;
        const finished = closed
          ? true
          : (runningWeekIdx != null ? i < runningWeekIdx : false);
        const v = slot.value != null ? Number(slot.value) : 0;

        // Bar height reads from the SAME slot object as the caption.
        const showBar = slot.value != null && Math.abs(v) > 0.005;
        const stateClass = running
          ? "st-run"
          : (finished && v > orig ? "st-over" : "");
        const heightPct = showBar
          ? Math.min(97, (Math.abs(v) / maxSample) * 100).toFixed(1)
          : 0;

        // Target line: finished + closed weeks show original; running
        // + future weeks show adjusted (open period only).
        const lineType = closed
          ? (finished ? "orig" : null)
          : (finished ? "orig" : (isPassThrough ? null : "adj"));
        const lineValue = lineType === "orig" ? orig : (lineType === "adj" ? (adj || 0) : null);

        const cap = slot.caption;
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
              <span className="kpi-p-v num">{cap.val}</span>
              <span className="kpi-p-d">
                Wk {i + 1}
                {weekLabels && weekLabels[i]?.date ? ` · ${weekLabels[i].date}` : ""}
              </span>
              {cap.note && typeof cap.note === "string" && (
                <span className={`kpi-p-x ${cap.tone}`}>{cap.note}</span>
              )}
              {cap.delta != null && (
                <ArrowNote amount={cap.delta} tone={cap.tone} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
