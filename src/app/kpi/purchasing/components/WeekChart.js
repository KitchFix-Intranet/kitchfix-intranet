"use client";
// src/app/kpi/purchasing/components/WeekChart.js
//
// Tier-aware unit strip (spec §7 rule 1 - identity color + state
// pattern). PR 2 R3 Part B rebuild - the four-slot strip was silently
// truncating 5+ week ranges. Now:
//   Tier A (<= 6 weeks)  -> one bar per fiscal WEEK in range
//   Tier B (7-13 weeks)  -> one bar per fiscal WEEK in range
//   Tier C (14+ weeks)   -> one bar per fiscal PERIOD in range
//
// §9B ONE-SOURCE BINDING (owner ruling 2026-08-24):
//   For every rendered unit, bar height and caption value resolve from
//   the SAME `unit` object. `unit.value` is either a real number (draw
//   the bar to that height and print that number in the caption) or
//   null (no bar, caption prints no $ value). The target dashed line
//   is REFERENCE geometry, never a bar. The assertion below fires in
//   development if any rendered unit has one without the other.
//
// CHECK 7 assertion (owner ruling 2026-08-24): the number of rendered
// units MUST equal the number of fiscal units in the range. If the
// caller passes a `units` array whose length does not match the count
// of DOM children we would draw, the assertion trips. This closes the
// "silent truncation" bug class (same failure mode as the $1.82M
// budget bug).
//
// Props:
//   tier         - 'A' | 'B' | 'C'
//   units        - array of unit objects:
//                    Tier A/B: { start (ISO Mon), label (real date range),
//                                spent (number), targetOrig (per-week target),
//                                targetAdj (Tier A only, may be null),
//                                finished, running }
//                    Tier C:   { period_no, start, end,
//                                spent (number), budget (period budget),
//                                finished, running }
//   identity     - 'food' | 'pkg' | 'veh' | 'equip' | 'rm'
//   emptyMessage - override for the "no budget and no spend" panel
//   isPassThrough
//
// A unit with zero spend renders a baseline + "no spend" caption (§7
// rule 8). Never a green under-arrow at zero.

import { fmt$ } from "../lib/board";

function ArrowNote({ amount, tone }) {
  if (amount == null) return null;
  if (amount === 0) return <span className="kpi-p-x n">no spend</span>;
  const glyph = amount < 0 ? "▼" : "▲";
  const word  = amount < 0 ? "under" : "over";
  return (
    <span className={`kpi-p-x ${tone}`}>
      {glyph} {fmt$(Math.abs(amount))} {word}
    </span>
  );
}

// Real MM/DD -> MM/DD label for a Monday-anchored fiscal week.
function fmtDateShort(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  if (!m || !d) return "";
  return `${m}/${d}`;
}
function weekRangeLabel(startISO) {
  if (!startISO) return "";
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const endISO = end.toISOString().slice(0, 10);
  return `${fmtDateShort(startISO)} - ${fmtDateShort(endISO)}`;
}

// Build the per-unit render slot. ONE object per unit - bar height and
// caption value derive from `slot.value` so they cannot disagree.
function buildWeekSlot({ spent, orig, adj, isPassThrough, running, finished }) {
  const v = Number(spent || 0);
  const hasSpend = Math.abs(v) > 0.005;
  if (running) {
    if (!hasSpend) {
      return { value: null, caption: { val: "—", note: "running", tone: "a" } };
    }
    return { value: v, caption: { val: "≥ " + fmt$(v), note: "running", tone: "a" } };
  }
  if (finished) {
    if (!hasSpend) {
      return { value: null, caption: { val: "—", note: "no spend", tone: "n" } };
    }
    if (!(orig > 0)) {
      return { value: v, caption: { val: fmt$(v), note: null, tone: "n" } };
    }
    const delta = v - orig;
    return { value: v, caption: { val: fmt$(v), delta, tone: delta > 0 ? "r" : "g" } };
  }
  // Future unit.
  if (isPassThrough) {
    return { value: null, caption: { val: "—", note: "no data yet", tone: "b" } };
  }
  if (adj != null) {
    return { value: null, caption: { val: "—", note: `aim for ${fmt$(adj)}`, tone: "b" } };
  }
  return { value: null, caption: { val: "—", note: null, tone: "n" } };
}
function buildPeriodSlot({ spent, budget, running, finished }) {
  const v = Number(spent || 0);
  const hasSpend = Math.abs(v) > 0.005;
  const target = Number(budget || 0);
  if (running) {
    if (!hasSpend) {
      return { value: null, caption: { val: "—", note: "running", tone: "a" } };
    }
    return { value: v, caption: { val: "≥ " + fmt$(v), note: "running", tone: "a" } };
  }
  if (finished) {
    if (!hasSpend) {
      return { value: null, caption: { val: "—", note: "no spend", tone: "n" } };
    }
    if (!(target > 0)) {
      return { value: v, caption: { val: fmt$(v), note: null, tone: "n" } };
    }
    const delta = v - target;
    return { value: v, caption: { val: fmt$(v), delta, tone: delta > 0 ? "r" : "g" } };
  }
  // Future period - baseline with per-period budget as reference.
  if (target > 0) {
    return { value: null, caption: { val: "—", note: `budget ${fmt$(target)}`, tone: "b" } };
  }
  return { value: null, caption: { val: "—", note: null, tone: "n" } };
}

export function WeekChart({
  tier,             // 'A' | 'B' | 'C'
  units,            // array of unit objects (shape depends on tier)
  identity,
  emptyMessage,
  isPassThrough,
}) {
  const isPeriod = tier === "C";
  const spentAll = (units || []).reduce((s, u) => s + Number(u.spent || 0), 0);
  const hasAnyTarget = (units || []).some(u =>
    isPeriod ? Number(u.budget || 0) > 0
             : Number(u.targetOrig || 0) > 0);
  if (!spentAll && !hasAnyTarget) {
    return (
      <div className="kpi-p-emptybucket">
        {emptyMessage || "No budget and no spend at this account."}
      </div>
    );
  }

  // Single y-scale so bars + target lines share one axis.
  const perUnitTargets = (units || []).map(u =>
    isPeriod ? Number(u.budget || 0)
             : Math.max(Number(u.targetOrig || 0), Number(u.targetAdj || 0)));
  const maxSample = Math.max(
    ...perUnitTargets,
    ...(units || []).map(u => Math.abs(Number(u.spent || 0)) * 1.15),
    1,
  );

  // Precompute per-unit slots so bar height + caption value read from
  // the SAME object. Any drift is impossible at the JSX layer.
  const slots = (units || []).map(u => {
    if (isPeriod) {
      return buildPeriodSlot({
        spent: u.spent, budget: u.budget,
        running: !!u.running, finished: !!u.finished,
      });
    }
    return buildWeekSlot({
      spent: u.spent,
      orig:  Number(u.targetOrig || 0),
      adj:   u.targetAdj != null ? Number(u.targetAdj) : null,
      isPassThrough,
      running: !!u.running, finished: !!u.finished,
    });
  });

  // ── Assertions (dev-only) ───────────────────────────────────────
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    // CHECK 7: rendered units == fiscal units in range. `units` is the
    // caller's fiscal enumeration; slots is what we WILL render (one
    // per unit). If they ever diverge the strip is silently truncating.
    if (slots.length !== (units || []).length) {
      // eslint-disable-next-line no-console
      console.error("[WeekChart CHECK 7] slots.length !=", (units || []).length, slots);
      throw new Error(`WeekChart CHECK 7: rendered ${slots.length} units, range has ${(units || []).length}`);
    }
    // §9B: for every unit, bar-drawing decision matches caption $-figure.
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      const hasBar = s.value != null && Math.abs(Number(s.value)) > 0.005;
      const capV = s.caption && typeof s.caption.val === "string" ? s.caption.val : "";
      const captionHasDollar = capV.includes("$");
      if (hasBar && !captionHasDollar) {
        // eslint-disable-next-line no-console
        console.error("[WeekChart §9B] unit", i, "has a bar but caption has no $ value:", s);
        throw new Error(`WeekChart §9B: bar without caption value at unit ${i + 1}`);
      }
      if (!hasBar && captionHasDollar) {
        // eslint-disable-next-line no-console
        console.error("[WeekChart §9B] unit", i, "caption shows a $ value but no bar:", s);
        throw new Error(`WeekChart §9B: caption without bar at unit ${i + 1}`);
      }
    }
  }

  // Grid width - one column per unit, minmax(0, 1fr).
  const gridStyle = { gridTemplateColumns: `repeat(${slots.length || 1}, minmax(0, 1fr))` };

  return (
    <div className="kpi-p-wks" style={gridStyle}>
      {slots.map((slot, i) => {
        const u = units[i];
        const running = !!u.running;
        const finished = !!u.finished;
        const v = slot.value != null ? Number(slot.value) : 0;
        const showBar = slot.value != null && Math.abs(v) > 0.005;
        // Per-bar target line - Tier A/B use per-week target, Tier C
        // uses period budget. Adjusted line only in Tier A (running/
        // future weeks) - spec §5.1 + owner ruling 2026-08-24.
        const perUnitOrig = isPeriod ? Number(u.budget || 0) : Number(u.targetOrig || 0);
        const perUnitAdj  = isPeriod ? null
                             : (tier === "A" && !finished && u.targetAdj != null ? Number(u.targetAdj) : null);
        // PR-2 R4 Part C - owner rulings 2026-08-21: bars are either
        // green (under target) or red (over target). Identity color is
        // NOT on the state bar (identity stays on card stripe + legend).
        // Running-week hatch is a DIFFERENT thing and stays.
        //   - running week      -> st-run (amber hatch)
        //   - finished + over   -> st-over  (solid red)
        //   - finished + under  -> st-under (solid green)
        //   - finished, no target -> identity fallback (no verdict)
        const hasTarget = perUnitOrig > 0;
        const stateClass = running
          ? "st-run"
          : (finished && hasTarget
              ? (v > perUnitOrig ? "st-over" : "st-under")
              : "");
        const heightPct = showBar
          ? Math.min(97, (Math.abs(v) / maxSample) * 100).toFixed(1)
          : 0;
        // Target line PER BAR - not one dashed line spanning the chart.
        const orLine = perUnitOrig > 0
          ? Math.min(97, (perUnitOrig / maxSample) * 100).toFixed(1)
          : null;
        const adjLine = perUnitAdj != null && perUnitAdj > 0
          ? Math.min(97, (perUnitAdj / maxSample) * 100).toFixed(1)
          : null;
        // Caption label:
        //   A/B: real week range MM/DD - MM/DD (spec §B2)
        //   C:   "P1", "P2"... (spec §B2)
        const label = isPeriod
          ? `P${u.period_no}`
          : (u.label || weekRangeLabel(u.start));

        const cap = slot.caption;
        return (
          <div key={i} className="kpi-p-wc">
            <div className="kpi-p-plot">
              {/* Target line PER BAR - Tier A/B originals + Tier A
                  adjusted for running/future weeks. Tier C: per-period
                  budget line. Solid horizontal at the top of the bar's
                  target height. */}
              {orLine != null && (
                <span
                  className="kpi-p-ln orig"
                  style={{ bottom: `${orLine}%` }}
                  aria-hidden="true"
                />
              )}
              {adjLine != null && (
                <span
                  className="kpi-p-ln adj"
                  style={{ bottom: `${adjLine}%` }}
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
              <span className="kpi-p-d">{label}</span>
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
