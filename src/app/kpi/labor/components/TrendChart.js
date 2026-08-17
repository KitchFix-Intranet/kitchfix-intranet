"use client";
// src/app/kpi/labor/components/TrendChart.js
//
// D2 P6 - weekly labor trend chart.
//
//   - $ lens (default): navy bars scaled by dollars. Production stacks
//     the $ lens too, from real per-bucket dollars per spec §3.5.
//   - hrs lens: stacked composition - regular navy-300, OT navy-600,
//     holiday --chart-hol (F14 violet), unpriced fill-needs cap.
//   - unpriced weeks in $ lens: short amber stubs (never fake height).
//   - unknown weeks: red-outline stub.
//   - Weekly dashed budget line - STEPPED by fiscal period, sourced
//     from the labor route's budget_periods (Playbook 4.5). Each week
//     draws at its period's amount / 4. Named better-than-v5 deviation:
//     v5 rendered a single flat line at a placeholder rate; the real
//     per-period data makes each period-jump visible on the chart.
//   - Collapsible, state remembered per user (localStorage `kpi.trendOpen`).
//   - Lens toggle remembered (localStorage `kpi.trendMode`).
//   - Bar click (account mode) jumps + opens the week with M7 landing
//     tint via `onBarClick(week_start)`.

import { useState, useEffect, useMemo } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting";
import { periodOf } from "../lib/periods";

const H = 120;
const PAD = 14;
const BAR_W = 12;
const BAR_STRIDE = 16;

export function TrendChart({
  account,
  weeks,         // [{ week_start, week_end, hours_regular, hours_overtime, hours_double_time, hours_without_dollars, amount, coverage_state }]
  openWeeks,     // Set<string> - which week_starts are open in the table
  onBarClick,    // (week_start) => void
  budgetPeriods, // from labor route, per Playbook 4.5. Empty on envelope mode (no budget line).
  budgetMode,    // 'static' | 'envelope' - envelope hides the budget line.
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState("$");

  // Load persisted preferences.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const c = window.localStorage.getItem("kpi.trendOpen");
      if (c === "0") setCollapsed(true);
      const m = window.localStorage.getItem("kpi.trendMode");
      if (m === "hrs" || m === "$") setMode(m);
    } catch {}
  }, []);

  const persist = (key, value) => {
    try { if (typeof window !== "undefined") window.localStorage.setItem(key, value); } catch {}
  };
  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      persist("kpi.trendOpen", next ? "0" : "1");
      return next;
    });
  };
  const setLens = (m) => {
    setMode(m);
    persist("kpi.trendMode", m);
  };

  // H4 - aggregate to one entry per week_start, always. The caller may
  // pass raw labor_actuals rows (one per worker-week) or already-aggregated
  // week rows; this component owns the invariant "one bar per week".
  const asc = useMemo(() => {
    const src = weeks || [];
    if (!src.length) return [];
    const byWeek = new Map();
    for (const r of src) {
      const k = r.week_start;
      if (!k) continue;
      if (!byWeek.has(k)) {
        byWeek.set(k, {
          week_start: r.week_start, week_end: r.week_end,
          hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
          dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
          amount: 0, hours_without_dollars: 0,
          coverage_states: new Set(),
        });
      }
      const w = byWeek.get(k);
      w.hours_regular       += Number(r.hours_regular       || 0);
      w.hours_overtime      += Number(r.hours_overtime      || 0);
      w.hours_double_time   += Number(r.hours_double_time   || 0);
      w.hours_premium_other += Number(r.hours_premium_other || 0);
      w.dollars_regular       += Number(r.dollars_regular       || 0);
      w.dollars_overtime      += Number(r.dollars_overtime      || 0);
      w.dollars_double_time   += Number(r.dollars_double_time   || 0);
      w.dollars_premium_other += Number(r.dollars_premium_other || 0);
      w.amount                += Number(r.amount                || 0);
      w.hours_without_dollars += Number(r.hours_without_dollars || 0);
      if (r.coverage_state) w.coverage_states.add(r.coverage_state);
    }
    // Collapse coverage_states set to single label.
    for (const w of byWeek.values()) {
      const cs = [...w.coverage_states];
      w.coverage_state = cs.length === 1 ? cs[0] : "partial";
    }
    return [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));
  }, [weeks]);
  const hrsMode = mode === "hrs";
  // Real per-period budget map from the labor route. Undefined until
  // data lands; envelope mode ships no budget line at all.
  const isEnvelope = budgetMode === "envelope";
  const budByPeriod = useMemo(() => {
    const m = new Map();
    if (!isEnvelope && Array.isArray(budgetPeriods)) {
      for (const bp of budgetPeriods) {
        if (bp && Number.isFinite(Number(bp.amount))) m.set(Number(bp.period_no), Number(bp.amount));
      }
    }
    return m;
  }, [budgetPeriods, isEnvelope]);
  const weekBudget = (weekStartISO) => {
    if (isEnvelope) return 0;
    const p = periodOf(weekStartISO);
    if (p == null) return 0;
    const amt = budByPeriod.get(p);
    return amt == null ? 0 : amt / 4;
  };

  const value = (w) => {
    if (hrsMode) {
      return (Number(w.hours_regular || 0) + Number(w.hours_overtime || 0) + Number(w.hours_double_time || 0) + Number(w.hours_without_dollars || 0));
    }
    // $ lens: full amount plus stacks of per-bucket dollars are computed inline
    return Number(w.amount || 0);
  };
  // Include the max weekly budget in the y-axis max so the dashed
  // budget line always sits inside the chart, not above the top edge.
  const budMax = asc.reduce((m, w) => Math.max(m, weekBudget(w.week_start)), 0);
  const max = Math.max(...asc.map(value), budMax, 1);
  const W = Math.max(120, asc.length * BAR_STRIDE);

  const bars = asc.map((w, i) => {
    const x = i * BAR_STRIDE + 2;
    const hot = openWeeks?.has(w.week_start) ? " hot" : "";
    const clickable = onBarClick != null;
    const clickProps = clickable
      ? { onClick: () => onBarClick(w.week_start), style: { cursor: "pointer" } }
      : {};
    if (w.coverage_state === "unknown") {
      return (
        <rect key={w.week_start} className="kpi-trend-ukb"
          x={x} y={H - PAD - 4} width={BAR_W} height={4} rx="1"
          {...clickProps}
        ><title>{fmtDate(w.week_start)} · unknown - no presence walk</title></rect>
      );
    }
    if (hrsMode) {
      const tot = value(w);
      if (tot <= 0) return null;
      const scale = (H - PAD - 6) / max;
      const segs = [
        ["kpi-trend-seg-r", Number(w.hours_regular || 0),      "regular"],
        ["kpi-trend-seg-o", Number(w.hours_overtime || 0),     "OT 1.5x"],
        ["kpi-trend-seg-h", Number(w.hours_double_time || 0),  "holiday 2x"],
        ["kpi-trend-seg-u", Number(w.hours_without_dollars || 0), "unpriced"],
      ];
      let y = H - PAD;
      return (
        <g key={w.week_start}>
          {segs.map(([cls, v, l], si) => {
            if (v <= 0.004) return null;
            const hh = v * scale;
            y -= hh;
            const yPos = y;
            return (
              <rect key={si} className={cls} x={x} y={yPos.toFixed(1)} width={BAR_W} height={hh.toFixed(1)} rx="1" {...clickProps}>
                <title>{fmtDate(w.week_start)} · {fmtHrs(v)} hrs {l}</title>
              </rect>
            );
          })}
        </g>
      );
    }
    // $ lens - stacked per-bucket dollars if we have them, else fall back to a single bar
    const dr = Number(w.dollars_regular || 0);
    const doo = Number(w.dollars_overtime || 0);
    const dh = Number(w.dollars_double_time || 0);
    const dpo = Number(w.dollars_premium_other || 0);
    const stackTotal = dr + doo + dh + dpo;
    if (stackTotal > 0) {
      const scale = (H - PAD - 6) / max;
      const segs = [
        ["kpi-trend-seg-r", dr,  "regular"],
        ["kpi-trend-seg-o", doo, "OT 1.5x"],
        ["kpi-trend-seg-h", dh,  "holiday 2x"],
        ["kpi-trend-seg-p", dpo, "other premium"],
      ];
      let y = H - PAD;
      return (
        <g key={w.week_start}>
          {segs.map(([cls, v, l], si) => {
            if (v <= 0.004) return null;
            const hh = v * scale;
            y -= hh;
            const yPos = y;
            return (
              <rect key={si} className={`${cls}${hot}`} x={x} y={yPos.toFixed(1)} width={BAR_W} height={hh.toFixed(1)} rx="1" {...clickProps}>
                <title>{fmtDate(w.week_start)} · {fmt$(v)} {l}</title>
              </rect>
            );
          })}
        </g>
      );
    }
    // Unpriced week in $ lens - short amber stub (never fake height)
    if ((Number(w.hours_without_dollars || 0)) > 0) {
      return (
        <rect key={w.week_start} className="kpi-trend-unb"
          x={x} y={H - PAD - 7} width={BAR_W} height={7} rx="2"
          {...clickProps}
        ><title>{fmtDate(w.week_start)} · {fmtHrs(Number(w.hours_without_dollars || 0))} hrs unpriced - no dollar height to show</title></rect>
      );
    }
    return null;
  });

  // Budget line - STEPPED (kpi-2). Each week is drawn at
  // period_amount / 4; the line steps at fiscal-period boundaries
  // (P4 -> P5 -> P6 etc). Hidden in hrs mode and envelope mode. When
  // budgetPeriods is empty for the range (missing budget), nothing
  // renders - callers see the dashed line simply absent.
  const budLineSegments = (!hrsMode && !isEnvelope && budMax > 0) ? asc.map((w, i) => {
    const wk = weekBudget(w.week_start);
    if (wk <= 0) return null;
    const x1 = i * BAR_STRIDE;
    const x2 = x1 + BAR_STRIDE;
    const y  = H - PAD - ((wk / max) * (H - PAD - 6));
    return (
      <line
        key={w.week_start}
        className="kpi-trend-bud"
        x1={x1} x2={x2} y1={y.toFixed(1)} y2={y.toFixed(1)}
      >
        <title>{fmtDate(w.week_start)} · weekly budget {fmt$(wk)} (period amount / 4)</title>
      </line>
    );
  }) : null;

  const legend = hrsMode ? (
    <span className="kpi-legend">
      <span><i className="kpi-legend-r" />reg</span>
      <span><i className="kpi-legend-o" />OT</span>
      <span><i className="kpi-legend-h" />hol</span>
      <span><i className="kpi-legend-u" />unpriced</span>
    </span>
  ) : (
    <em>peak {hrsMode ? `${fmtHrs(max)} hrs` : fmt$(max)}{!isEnvelope && budMax > 0 ? " · dashed = weekly budget" : ""}</em>
  );

  return (
    <div className={`kpi-trend ${collapsed ? "kpi-trend-collapsed" : ""}`}>
      <div className="kpi-trend-h">
        <button type="button" className="kpi-trend-toggle" onClick={toggle} aria-expanded={!collapsed}>
          <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Weekly labor · range
        </button>
        <span style={{ display: "inline-flex", gap: "var(--space-3)", alignItems: "center" }}>
          {legend}
          <span className="kpi-tgl" role="group" aria-label="Trend units">
            <button type="button" className={mode === "$" ? "on" : ""} onClick={() => setLens("$")}>$</button>
            <button type="button" className={mode === "hrs" ? "on" : ""} onClick={() => setLens("hrs")}>hrs</button>
          </span>
        </span>
      </div>
      {!collapsed && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Weekly labor">
            {budLineSegments}
            {bars}
          </svg>
          {!hrsMode && (
            <div className="kpi-trend-note">Composition by bucket lives in the hrs lens; $ bars stack from per-bucket amounts.</div>
          )}
        </>
      )}
    </div>
  );
}
