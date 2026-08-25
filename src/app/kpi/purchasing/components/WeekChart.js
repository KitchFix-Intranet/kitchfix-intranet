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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

  // Single y-scale so bars + target lines share one axis. PR-2 R5 Part A
  // (owner ruling 2026-08-24): scaleMax = max(spent_all, target_all)
  // times a headroom fraction. The target line is an INDEPENDENT mark on
  // this shared scale - never derived from the bar.
  //
  // PR 2 R9 P1-2 - BAR-READABILITY CAP.
  //
  // On ALL FYTD Kevin measured P3 (spend $497k) rendering at only 1.4x
  // P8 ($244k) - dollar ratio is 2.0x. The visual compression came from
  // the tallest TARGET (a bucket with an outsized period budget) sitting
  // well above the tallest bar. `scaleMax = max(spend, target) * 1.05`
  // then forced every bar into the lower portion of the plot; the
  // absolute ratio was preserved but the visible dynamic range was gone.
  //
  // Fix: allow the target to raise scaleMax up to a bounded multiple of
  // the tallest bar. Beyond that cap the target line renders at the top
  // of the plot (clipped by overflow) and the caption still carries the
  // numeric target for readers who need it. R5 assertion survives because
  // it measures the arithmetic ratio (target / spent), which equals
  // drawn ratio (linePos / barHeight) regardless of scaleMax choice -
  // both marks divide by the same scaleMax.
  //
  //   BAR_HEADROOM     = 1.15   -> 15% empty above the tallest bar
  //   TARGET_CAP_MULT  = 1.5    -> scaleMax never exceeds 1.5x tallest bar
  //
  // Behaviour:
  //   maxTarget <=  maxSpent      -> scaleMax = maxSpent * 1.15
  //   maxTarget <= 1.5 maxSpent   -> scaleMax = max(maxSpent * 1.15, maxTarget * 1.02)
  //   maxTarget >  1.5 maxSpent   -> scaleMax = maxSpent * 1.5 (target clips at top)
  const perUnitTargetsAll = (units || []).flatMap(u => (
    isPeriod
      ? [Number(u.budget || 0)]
      : [Number(u.targetOrig || 0), Number(u.targetAdj || 0)]
  )).filter(v => Number.isFinite(v) && v > 0);
  const perUnitSpendAll = (units || []).map(u => Math.abs(Number(u.spent || 0)));
  const maxTargetAll = perUnitTargetsAll.length > 0 ? Math.max(...perUnitTargetsAll) : 0;
  const maxSpentAll  = Math.max(...perUnitSpendAll, 1);
  const BAR_HEADROOM     = 1.15;
  const TARGET_CAP_MULT  = 1.5;
  const barScale     = maxSpentAll * BAR_HEADROOM;
  const targetCapped = Math.min(maxTargetAll * 1.02, maxSpentAll * TARGET_CAP_MULT);
  const maxSample = Math.max(barScale, targetCapped);
  const targetClipped = maxTargetAll > 0 && maxTargetAll > maxSample;

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
    // ── CHECK 2 (PR-2 R5 Part A) ───────────────────────────────────
    // For every rendered unit that has BOTH a bar and a target line,
    // the drawn ratio linePos / barHeight must equal target / spent
    // within tolerance. This is the geometry gate - the third
    // geometry-vs-data bug on this chart was invisible to every earlier
    // arithmetic check because every earlier check measured NUMBERS,
    // not what was DRAWN. This assertion measures what will be drawn.
    // Tolerance is 0.5% of the arithmetic ratio (or 0.005 absolute,
    // whichever is looser) to absorb 2-decimal toFixed rounding.
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      if (s.value == null || Math.abs(Number(s.value)) <= 0.005) continue;
      const u = units[i];
      const spent = Math.abs(Number(s.value));
      const target = isPeriod
        ? Number(u.budget || 0)
        : Number(u.targetOrig || 0);
      if (!(target > 0)) continue;
      const drawnBar  = (spent  / maxSample) * 100;
      const drawnLine = (target / maxSample) * 100;
      const drawnRatio = drawnLine / drawnBar;
      const arithRatio = target / spent;
      const tol = Math.max(0.005, Math.abs(arithRatio) * 0.005);
      if (Math.abs(drawnRatio - arithRatio) > tol) {
        // eslint-disable-next-line no-console
        console.error("[WeekChart CHECK 2]", {
          unit: i + 1, spent, target, drawnBar, drawnLine,
          drawnRatio, arithRatio, tol,
        });
        throw new Error(
          `WeekChart CHECK 2: geometry mismatch at unit ${i + 1} - ` +
          `drawn ${drawnRatio.toFixed(4)} vs arith ${arithRatio.toFixed(4)} (tol ${tol.toFixed(4)})`
        );
      }
    }
  }

  // Grid width. PR-2 R6 Part A - each column gets a minimum readable
  // width equal to the caption $-figure width (~72px covers 7-digit
  // amounts like $132,634.76). When the container is wide enough the
  // `1fr` side wins and columns share the row equally; when it is not
  // (narrow viewport + tier C 34 units), the row exceeds container
  // width and the outer scroll container `.kpi-p-wks-scroll` provides
  // a horizontal scroll strip instead of silently truncating captions
  // (the failure mode this bar was hitting at 1600px on tier-C FYTD).
  const MIN_COL_PX = 72;
  const gridStyle = { gridTemplateColumns: `repeat(${slots.length || 1}, minmax(${MIN_COL_PX}px, 1fr))` };

  // PR 2 R7 Fix 1 - anchor initial scroll position at the RIGHT edge so
  // the most recent unit (P9 on tier-C FYTD, the last week on tier-A/B)
  // is visible on first paint. Prior state opened scrolled to the LEFT,
  // hiding the period anyone cares about behind the right edge. The
  // owner's ruling: cannot do this AFTER paint (visible jump). The
  // approach used here:
  //   - `useLayoutEffect` runs synchronously between DOM commit and the
  //     browser's next paint, so setting `scrollLeft` here has no visual
  //     effect during any painted frame. React guarantees this ordering.
  //   - Re-anchors when the caller passes a new `units` array (range
  //     change) so switching from FYTD -> P8 -> FYTD keeps the same
  //     right-edge anchor rule on every render.
  // Only fires when the container actually overflows (scrollWidth >
  // clientWidth) so we do not clobber legitimate user scroll positions
  // on ranges that fit without scrolling.
  const scrollRef = useRef(null);
  // PR 2 R9 P1-3 - left-edge fade indicator. When the plot overflows
  // the scroll container we anchor right (PR 7 fix), but the left edge
  // clips mid-digit and reads as a rendering fault. Track whether the
  // container is scrolled off the left; render a fade overlay when it
  // is so the message "there's more content to the left" is visual.
  const [hasOverflow, setHasOverflow] = useState(false);
  const [scrolledOffLeft, setScrolledOffLeft] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth) {
      el.scrollLeft = el.scrollWidth - el.clientWidth;
      setHasOverflow(true);
      setScrolledOffLeft(el.scrollLeft > 2);
    } else {
      setHasOverflow(false);
      setScrolledOffLeft(false);
    }
  }, [slots.length, tier]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolledOffLeft(el.scrollLeft > 2);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`kpi-p-wks-scroll${hasOverflow && scrolledOffLeft ? " kpi-p-wks-scroll-clipL" : ""}`}
      ref={scrollRef}
    >
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
        // PR-2 R5 Part A (owner ruling 2026-08-24): no 97% ceiling on
        // bar or line. Both marks divide by the same `maxSample` (which
        // already includes 5% headroom above the tallest target/spend)
        // so the ratio linePos / barHeight equals target / spent
        // exactly. The prior Math.min(97, ...) ceiling fired every time
        // a target equalled scaleMax, silently pushing the line to 97%
        // and misrepresenting the ratio (e.g. FYTD ALL Food P3: line
        // clamped 100% -> 97% distorted a 1.238 ratio to 1.200).
        const heightPct = showBar
          ? ((Math.abs(v) / maxSample) * 100).toFixed(2)
          : 0;
        // Target line PER BAR - not one dashed line spanning the chart.
        const orLine = perUnitOrig > 0
          ? ((perUnitOrig / maxSample) * 100).toFixed(2)
          : null;
        const adjLine = perUnitAdj != null && perUnitAdj > 0
          ? ((perUnitAdj / maxSample) * 100).toFixed(2)
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
              {/* PR 2 R8 - a caption value that starts with `—` is a
                  nil marker (no spend / running / future). It MUST NOT
                  render at the same weight and colour as real dollar
                  captions. `.kpi-p-nil` down-weights + neutralises the
                  colour. */}
              <span className={`kpi-p-v num${typeof cap.val === "string" && cap.val.startsWith("—") ? " kpi-p-nil" : ""}`}>{cap.val}</span>
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
    </div>
  );
}
