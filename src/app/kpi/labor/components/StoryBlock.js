"use client";
// src/app/kpi/labor/components/StoryBlock.js
//
// V21 board simplification. Left panel is the spend card (rebuilt in
// C3). Right panel is the week strip; tier renderers untouched. Legend
// pills, $/hrs lens toggle, ? help control retired per V21-4. Dollars
// only from here.
//
// The strip is range-adaptive (V8-21):
//   Tier A (<= 6 weeks)  - per-week columns with captions, one shared
//                          scale, one continuous target line (rebuilt
//                          in C3).
//   Tier B (7-13 weeks)  - single-row compact bars with a shared
//                          scale, a stepped dashed weekly budget line,
//                          alternating axis labels, hover tooltip.
//   Tier C (> 13 weeks)  - grain changes to one bar per fiscal period.
//                          Header title switches to
//                          `THE RANGE · PERIOD BY PERIOD`.

import { useRef, useState } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting.js";

// ── TIER A: per-week columns with captions ────────────────────────
function daysElapsed(weekStartISO) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  const now = Date.now();
  const days = Math.floor((now - start) / 86400000) + 1;
  return Math.max(1, Math.min(7, days));
}

function TierAWeekBar({ w, weeklyOriginal, weeklyAllowance, scale }) {
  const value = w.state === "not_started"
    ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
    : (w.spent || 0);
  const target = w.state === "not_started"
    ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
    : (w.original_target ?? weeklyOriginal ?? 0);
  const barPct = w.state === "not_started" ? 0 : Math.max(0, Math.min(100, (value / scale) * 90));
  const targetPct = target != null ? Math.max(0, Math.min(100, (target / scale) * 90)) : null;
  const isNotStarted = w.state === "not_started";
  const isInProgress = w.state === "in_progress";
  const isClosed = w.state === "closed";
  const barCls = isInProgress
    ? "kpi-wb-bar kpi-wb-bar-prog"
    : isClosed
      ? `kpi-wb-bar ${w.delta_sign === "over" ? "kpi-wb-bar-over" : "kpi-wb-bar-under"}`
      : "";
  const dashCls = isNotStarted ? "kpi-wb-target kpi-wb-target-roll" : "kpi-wb-target";
  const captionValue = isInProgress && w.unapproved_flag ? `≥ ${fmt$(value)}` : fmt$(value);
  let statusLine;
  if (isClosed && w.delta_vs_original != null) {
    const arrow = w.delta_sign === "under" ? "▼" : w.delta_sign === "over" ? "▲" : "•";
    const cls = w.delta_sign === "under" ? "kpi-wb-d-good" : w.delta_sign === "over" ? "kpi-wb-d-bad" : "kpi-wb-d-mute";
    statusLine = <span className={`kpi-wb-d ${cls}`}>{arrow} {fmt$(Math.abs(w.delta_vs_original))} {w.delta_sign}</span>;
  } else if (isInProgress) {
    if (w.unapproved_flag && w.unapproved_hours > 0) {
      statusLine = <span className="kpi-wb-warn">⚠ {fmtHrs(w.unapproved_hours)} hrs awaiting approval</span>;
    } else {
      const days = daysElapsed(w.week_start);
      statusLine = <span className="kpi-wb-d kpi-wb-d-mute">{days} of 7 days</span>;
    }
  } else if (isNotStarted) {
    statusLine = <span className="kpi-wb-d kpi-wb-d-mute">to stay on budget</span>;
  }
  const captionCls = isNotStarted ? "kpi-wb-cap-value kpi-wb-cap-roll" : "kpi-wb-cap-value";
  return (
    <div className="kpi-wb">
      <div className="kpi-wb-plot">
        {targetPct != null && <span className={dashCls} style={{ bottom: `${targetPct}%` }} />}
        {isNotStarted ? (
          <div className="kpi-wb-basel" />
        ) : (
          <div className={barCls} style={{ height: `${Math.max(barPct, 2)}%` }} />
        )}
      </div>
      <div className="kpi-wb-cap">
        <b className={captionCls}>{captionValue}</b>
        <span className="kpi-wb-dates">{fmtDate(w.week_start)} – {fmtDate(w.week_end)}{isInProgress ? " · in progress" : ""}</span>
        {statusLine}
      </div>
    </div>
  );
}

function TierAStrip({ board }) {
  const weeks = board?.weeks || [];
  const weeklyOriginal = board?.weekly_original_target;
  const weeklyAllowance = board?.weekly_allowance;
  const scale = (() => {
    let max = 1;
    for (const w of weeks) {
      const value = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.spent || 0);
      const target = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.original_target ?? weeklyOriginal ?? 0);
      const local = Math.max(value, target || 0);
      if (local > max) max = local;
    }
    return max * 1.10;
  })();
  return (
    <div
      className="kpi-wbars"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, weeks.length)}, minmax(0, 1fr))` }}
    >
      {weeks.map(w => (
        <TierAWeekBar
          key={w.week_start}
          w={w}
          weeklyOriginal={weeklyOriginal}
          weeklyAllowance={weeklyAllowance}
          scale={scale}
        />
      ))}
    </div>
  );
}

// ── TIER B: 7-13 weeks, one row of compact bars ────────────────────
function TierBStrip({ board }) {
  const weeks = board?.weeks || [];
  const [tip, setTip] = useState(null);
  const rootRef = useRef(null);

  const values = weeks.map(w => {
    const actual = w.spent || 0;
    const budget = w.original_target ?? 0;
    return { w, actual, budget };
  });
  const maxScale = Math.max(...values.map(v => Math.max(v.actual, v.budget || 0)), 1) * 1.12;

  const stepPath = (() => {
    if (!values.some(v => v.budget)) return null;
    const n = values.length;
    const stepW = 100 / n;
    let d = "";
    values.forEach((v, i) => {
      const y = v.budget ? 100 - (v.budget / maxScale) * 100 : 100;
      const x0 = i * stepW;
      const x1 = (i + 1) * stepW;
      d += (i === 0 ? `M${x0} ${y}` : ` L${x0} ${y}`) + ` L${x1} ${y}`;
    });
    return d;
  })();

  return (
    <div className="kpi-stripB" ref={rootRef}>
      <div className="kpi-plotB">
        {values.map((v) => {
          const isProg = v.w.state === "in_progress";
          const isClosed = v.w.state === "closed";
          const over = isClosed && v.budget > 0 && v.actual > v.budget;
          const cls = isProg
            ? "kpi-bB kpi-bB-prog"
            : over
              ? "kpi-bB kpi-bB-over"
              : "kpi-bB kpi-bB-under";
          const h = Math.max(0.5, (v.actual / maxScale) * 100);
          return (
            <button
              key={v.w.week_start}
              type="button"
              className={cls}
              style={{ height: `${h}%` }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const parent = rootRef.current?.getBoundingClientRect();
                if (!parent) return;
                setTip({
                  left: rect.left - parent.left + rect.width / 2,
                  top: rect.top - parent.top - 8,
                  actual: v.actual,
                  budget: v.budget,
                  week: v.w,
                });
              }}
              onMouseLeave={() => setTip(null)}
              onFocus={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const parent = rootRef.current?.getBoundingClientRect();
                if (!parent) return;
                setTip({ left: rect.left - parent.left + rect.width / 2, top: rect.top - parent.top - 8, actual: v.actual, budget: v.budget, week: v.w });
              }}
              onBlur={() => setTip(null)}
              aria-label={`Week of ${fmtDate(v.w.week_start)}: ${fmt$(v.actual)}`}
            />
          );
        })}
        {stepPath && (
          <svg className="kpi-stripB-line" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
            <path d={stepPath} fill="none" stroke="var(--amber-600)" strokeWidth="1.4" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <div className="kpi-axisB" aria-hidden="true">
        {values.map((v, i) => (
          <span key={v.w.week_start}>{i % 2 === 0 ? fmtDate(v.w.week_start).slice(0, 5) : ""}</span>
        ))}
      </div>
      {tip && <TierBTip tip={tip} />}
    </div>
  );
}

function TierBTip({ tip }) {
  const { actual, budget, week } = tip;
  const isClosed = week.state === "closed";
  const isProg = week.state === "in_progress";
  const delta = budget ? actual - budget : null;
  const arrow = delta == null ? "" : delta < 0 ? "▼" : "▲";
  const cls = delta == null ? "" : delta < 0 ? "kpi-wb-d-good" : "kpi-wb-d-bad";
  return (
    <div className="kpi-stripB-tip" style={{ left: `${tip.left}px`, top: `${tip.top}px` }}>
      <b>{fmt$(actual)}</b>
      <span>week of {fmtDate(week.week_start)}</span>
      {budget != null && budget > 0 && (
        <span>budget {fmt$(budget)}</span>
      )}
      {isProg && <span className="kpi-wb-d-mute">in progress</span>}
      {isClosed && delta != null && (
        <span className={cls}>{arrow} {fmt$(Math.abs(delta))} {delta < 0 ? "under" : "over"}</span>
      )}
    </div>
  );
}

// ── TIER C: > 13 weeks, one bar per fiscal period ──────────────────
function TierCStrip({ board, budgetPeriods }) {
  const weeks = board?.weeks || [];
  const budgetByPeriod = new Map((budgetPeriods || []).map(b => [b.period_no, Number(b.amount)]));

  const perPeriod = new Map();
  for (const w of weeks) {
    const p = w.period_no;
    if (p == null) continue;
    const cur = perPeriod.get(p) || { period_no: p, spent: 0, hours: 0, weeks: [] };
    cur.spent += w.spent || 0;
    cur.hours += w.hours || 0;
    cur.weeks.push(w);
    perPeriod.set(p, cur);
  }
  const periods = [...perPeriod.values()].sort((a, b) => a.period_no - b.period_no);
  for (const pp of periods) {
    pp.budget = budgetByPeriod.has(pp.period_no) ? budgetByPeriod.get(pp.period_no) : null;
    const anyInProgress = pp.weeks.some(w => w.state === "in_progress" || w.state === "not_started");
    pp.in_progress = anyInProgress;
  }

  const maxScale = Math.max(
    ...periods.map(p => Math.max(p.spent, p.budget || 0)),
    1,
  ) * 1.1;

  return (
    <div className="kpi-stripC">
      <div className="kpi-plotC">
        {periods.map(p => {
          const value = p.spent;
          const h = Math.max(0.5, (value / maxScale) * 100);
          const over = !p.in_progress && p.budget != null && value > p.budget;
          const cls = p.in_progress
            ? "kpi-pcol-bar kpi-pcol-bar-prog"
            : over
              ? "kpi-pcol-bar kpi-pcol-bar-over"
              : "kpi-pcol-bar kpi-pcol-bar-under";
          const budPct = p.budget != null ? Math.min(100, (p.budget / maxScale) * 100) : null;
          return (
            <div key={p.period_no} className="kpi-pcol">
              <div className={cls} style={{ height: `${h}%` }} />
              {budPct != null && <span className="kpi-pcol-bud" style={{ bottom: `${budPct}%` }} />}
            </div>
          );
        })}
      </div>
      <div className="kpi-axisC" aria-hidden="true">
        {periods.map(p => {
          const delta = p.budget != null && !p.in_progress ? p.spent - p.budget : null;
          const arrow = delta == null ? null : delta < 0 ? "▼" : "▲";
          const dCls = delta == null ? "" : delta < 0 ? "kpi-wb-d-good" : "kpi-wb-d-bad";
          return (
            <div key={p.period_no} className="kpi-axisC-cell">
              <div className="kpi-axisC-p">P{p.period_no}</div>
              <div className="kpi-axisC-v">{fmtCompact(p.spent)}</div>
              {p.in_progress ? (
                <div className="kpi-axisC-d kpi-wb-d-mute">in progress</div>
              ) : delta != null ? (
                <div className={`kpi-axisC-d ${dCls}`}>{arrow} {fmtCompact(Math.abs(delta))}</div>
              ) : (
                <div className="kpi-axisC-d kpi-wb-d-mute">no budget</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtCompact(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 10000) return `$${(v / 1000).toFixed(1)}k`;
  return "$" + Math.round(v).toLocaleString("en-US");
}

// ── Story block main ───────────────────────────────────────────────
function classifyTier(weekCount) {
  if (weekCount <= 6) return "A";
  if (weekCount <= 13) return "B";
  return "C";
}

export function StoryBlock({ board, account, rangeLabel, budgetPeriods, todayISO }) {
  const eyebrowLabel = board?.kind === "single_period_in_progress" || board?.kind === "single_period_closed"
    ? `PERIOD ${board.period_no}`
    : (rangeLabel || "").toUpperCase();
  const dateRange = board?.period_start && board?.period_end
    ? `${fmtDate(board.period_start)} – ${fmtDate(board.period_end)}`
    : "";

  const weekCount = (board?.weeks || []).length;
  const tier = classifyTier(weekCount);
  const stripTitle = tier === "C" ? "THE RANGE · PERIOD BY PERIOD" : (tier === "A" ? "THE PERIOD · WEEK BY WEEK" : "THE RANGE · WEEK BY WEEK");

  return (
    <div className="kpi-story">
      <div className="kpi-story-left">
        <div className="kpi-story-eye">
          <span className="kpi-story-eye-1">{eyebrowLabel}</span>
          {dateRange && <span className="kpi-story-eye-2">{dateRange}</span>}
        </div>
        {/* C3 lands the split block + budget footer here (V21-5..V21-9). */}
      </div>

      <div className="kpi-story-right">
        <div className="kpi-wh">
          <span className="kpi-wh-t">{stripTitle}</span>
          <span className="kpi-wh-sp" aria-hidden="true" />
          {/* C3 lands the weekly target label here (V21-10). */}
        </div>

        {tier === "A" && <TierAStrip board={board} />}
        {tier === "B" && <TierBStrip board={board} />}
        {tier === "C" && <TierCStrip board={board} budgetPeriods={budgetPeriods} todayISO={todayISO} />}
      </div>
    </div>
  );
}
