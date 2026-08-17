"use client";
// src/app/kpi/labor/components/StoryBlock.js
//
// V8-8..V8-12 + V8-21..V8-25 (range-adaptive addendum). One card, two
// panels: left = the money, right = the strip. V8-23: the two panels
// no longer bottom-align; the left panel sizes to its own content.
//
// The strip is range-adaptive (V8-21):
//   Tier A (<= 6 weeks)  - per-week columns with captions + verdicts
//                          + rolling target + in-progress treatment
//                          (rolling / projection / in-progress apply
//                          to Tier A only per V8-24).
//   Tier B (7-13 weeks)  - single-row compact bars with a shared
//                          scale, a stepped dashed weekly budget line,
//                          alternating axis labels, hover tooltip.
//   Tier C (> 13 weeks)  - grain changes to one bar per fiscal period.
//                          Header title switches to
//                          `THE RANGE · PERIOD BY PERIOD`.

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting.js";

const LENS_KEY = "kpi:board:lens";

function useLens() {
  const [lens, setLens] = useState("$");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { const v = localStorage.getItem(LENS_KEY); if (v === "$" || v === "hrs") setLens(v); } catch {}
  }, []);
  const commit = (v) => {
    setLens(v);
    try { localStorage.setItem(LENS_KEY, v); } catch {}
  };
  return [lens, commit];
}

function Help({ children }) {
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
    <span className="kpi-help-anchor" ref={rootRef}>
      <button
        type="button"
        className="kpi-help"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label="Show explanation"
        onClick={() => setOpen(o => !o)}
      >?</button>
      {open && <div className="kpi-help-pop" role="dialog">{children}</div>}
    </span>
  );
}

function BudgetTrack({ board }) {
  const budget = board.period_budget || board.range_budget;
  if (!budget || budget <= 0) return null;
  const spentPct = Math.max(0, Math.min(100, (board.spent_to_date / budget) * 100));
  const elapsedPct = board.elapsed_pct != null ? Math.max(0, Math.min(100, board.elapsed_pct)) : null;
  const projectedPct = board.projected_period_end != null
    ? Math.max(0, Math.min(100, (board.projected_period_end / budget) * 100))
    : null;
  const projExtra = projectedPct != null ? Math.max(0, projectedPct - spentPct) : 0;
  return (
    <div className="kpi-track">
      <div className="kpi-track-rail" role="img" aria-label={`Spent ${board.spent_to_date != null ? fmt$(board.spent_to_date) : "—"} of ${fmt$(budget)}`}>
        <span className="kpi-track-spent" style={{ width: `${spentPct}%` }} />
        {projectedPct != null && (
          <span className="kpi-track-proj" style={{ left: `${spentPct}%`, width: `${projExtra}%` }} />
        )}
        {elapsedPct != null && (
          <span className="kpi-track-today" style={{ left: `${elapsedPct}%` }}>
            <span className="kpi-track-today-lab">TODAY</span>
          </span>
        )}
        {projectedPct != null && (
          <span className="kpi-track-projend" style={{ left: `${projectedPct}%` }}>PROJECTED PERIOD END</span>
        )}
      </div>
      <div className="kpi-track-keys">
        <div><i className="kpi-key-spent" />spent <b>{fmt$(board.spent_to_date || 0)}</b></div>
        {projectedPct != null && (
          <div><i className="kpi-key-proj" />projected <b>{fmt$(board.projected_period_end || 0)}</b></div>
        )}
        <div>budget <b>{fmt$(budget)}</b></div>
      </div>
    </div>
  );
}

// ── TIER A: per-week columns with captions (unchanged from v8.7) ──
function daysElapsed(weekStartISO) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  const now = Date.now();
  const days = Math.floor((now - start) / 86400000) + 1;
  return Math.max(1, Math.min(7, days));
}

function TierAWeekBar({ w, lens, weeklyOriginal, rollingTarget }) {
  const value = lens === "$"
    ? (w.state === "not_started" ? (w.rolling_target ?? rollingTarget ?? 0) : (w.spent || 0))
    : (w.hours || 0);
  const target = lens === "$"
    ? (w.state === "not_started" ? (w.rolling_target ?? rollingTarget ?? 0) : (w.original_target ?? weeklyOriginal ?? 0))
    : null;
  const stackMax = Math.max(value, target || 0);
  const scale = stackMax > 0 ? stackMax : 1;
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
  let captionValue;
  if (lens === "$") {
    captionValue = isInProgress && w.unapproved_flag ? `≥ ${fmt$(value)}` : fmt$(value);
  } else {
    captionValue = fmtHrs(value);
  }
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

function TierAStrip({ board, lens }) {
  return (
    <div className="kpi-wbars">
      {(board?.weeks || []).map(w => (
        <TierAWeekBar
          key={w.week_start}
          w={w}
          lens={lens}
          weeklyOriginal={board.weekly_original_target}
          rollingTarget={board.rolling_weekly_target}
        />
      ))}
    </div>
  );
}

// ── TIER B: 7-13 weeks, one row of compact bars ────────────────────
// Shared vertical scale; stepped dashed weekly budget line; alternating
// axis labels; hover tooltip carrying week dates + actual + budget +
// delta. Per V8-24 rolling/projection/in-progress treatment is off; a
// week ending today or later renders as hatched-progress, closed weeks
// as strict-sign green/red.
function TierBStrip({ board, lens }) {
  const weeks = board?.weeks || [];
  const [tip, setTip] = useState(null);
  const rootRef = useRef(null);

  const values = weeks.map(w => {
    const actual = lens === "$" ? (w.spent || 0) : (w.hours || 0);
    const budget = lens === "$" ? (w.original_target ?? 0) : null;
    return { w, actual, budget };
  });
  const maxScale = Math.max(...values.map(v => Math.max(v.actual, v.budget || 0)), 1) * 1.12;

  // Stepped budget path across the entire strip. SVG spans 100x100
  // (preserveAspectRatio=none), so x = index * (100/n), y = 100 - (bud
  // /maxScale)*100. Path stays flat within a period and steps at
  // period boundaries.
  const stepPath = (() => {
    if (lens !== "$") return null;
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
        {values.map((v, i) => {
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
                  lens,
                });
              }}
              onMouseLeave={() => setTip(null)}
              onFocus={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const parent = rootRef.current?.getBoundingClientRect();
                if (!parent) return;
                setTip({ left: rect.left - parent.left + rect.width / 2, top: rect.top - parent.top - 8, actual: v.actual, budget: v.budget, week: v.w, lens });
              }}
              onBlur={() => setTip(null)}
              aria-label={`Week of ${fmtDate(v.w.week_start)}: ${lens === "$" ? fmt$(v.actual) : fmtHrs(v.actual)}`}
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
  const { actual, budget, week, lens } = tip;
  const isClosed = week.state === "closed";
  const isProg = week.state === "in_progress";
  const delta = budget ? actual - budget : null;
  const arrow = delta == null ? "" : delta < 0 ? "▼" : "▲";
  const cls = delta == null ? "" : delta < 0 ? "kpi-wb-d-good" : "kpi-wb-d-bad";
  return (
    <div className="kpi-stripB-tip" style={{ left: `${tip.left}px`, top: `${tip.top}px` }}>
      <b>{lens === "$" ? fmt$(actual) : fmtHrs(actual)}</b>
      <span>week of {fmtDate(week.week_start)}</span>
      {budget != null && budget > 0 && lens === "$" && (
        <span>budget {fmt$(budget)}</span>
      )}
      {isProg && <span className="kpi-wb-d-mute">in progress</span>}
      {isClosed && delta != null && lens === "$" && (
        <span className={cls}>{arrow} {fmt$(Math.abs(delta))} {delta < 0 ? "under" : "over"}</span>
      )}
    </div>
  );
}

// ── TIER C: > 13 weeks, one bar per fiscal period ──────────────────
// Grain switches; the week detail lives in the table below. Groups
// board.weeks by period_no, sums spent/hours per period, reads period
// budget from budgetPeriods. Marks the last-touching-today period as
// in-progress (hatched) so a partial period does not read as a red
// wall against a full-period budget.
function TierCStrip({ board, lens, budgetPeriods, todayISO }) {
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
    ...periods.map(p => Math.max(lens === "$" ? p.spent : p.hours, p.budget || 0)),
    1,
  ) * 1.1;

  return (
    <div className="kpi-stripC">
      <div className="kpi-plotC">
        {periods.map(p => {
          const value = lens === "$" ? p.spent : p.hours;
          const h = Math.max(0.5, (value / maxScale) * 100);
          const over = !p.in_progress && p.budget != null && value > p.budget;
          const cls = p.in_progress
            ? "kpi-pcol-bar kpi-pcol-bar-prog"
            : over
              ? "kpi-pcol-bar kpi-pcol-bar-over"
              : "kpi-pcol-bar kpi-pcol-bar-under";
          const budPct = p.budget != null && lens === "$" ? Math.min(100, (p.budget / maxScale) * 100) : null;
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
              <div className="kpi-axisC-v">{lens === "$" ? fmtCompact(p.spent) : fmtHrs(p.hours)}</div>
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
  const [lens, setLens] = useLens();
  const budget = board?.period_budget || board?.range_budget;
  const eyebrowLabel = board?.kind === "single_period_in_progress" || board?.kind === "single_period_closed"
    ? `PERIOD ${board.period_no}`
    : (rangeLabel || "").toUpperCase();
  const dateRange = board?.period_start && board?.period_end
    ? `${fmtDate(board.period_start)} – ${fmtDate(board.period_end)}`
    : "";
  const workers = board?.distinct_workers ?? 0;
  const hours = board?.hours ?? 0;
  const avgRate = board?.avg_rate;

  const weekCount = (board?.weeks || []).length;
  const tier = classifyTier(weekCount);
  const stripTitle = tier === "C" ? "THE RANGE · PERIOD BY PERIOD" : (tier === "A" ? "THE PERIOD · WEEK BY WEEK" : "THE RANGE · WEEK BY WEEK");

  // Legend + help pill layout per V8-24. Tier A carries rolling +
  // original; Tier B a weekly budget marker; Tier C a period budget
  // marker.
  const legend = (() => {
    if (tier === "A") {
      return (
        <>
          {board?.weekly_original_target != null && (
            <span className="kpi-lpill kpi-lpill-a">
              <span className="kpi-lpill-dash" aria-hidden="true" />
              original <b>{fmt$(board.weekly_original_target)}</b>
            </span>
          )}
          {board?.rolling_weekly_target != null && !board.budget_exhausted && (
            <span className="kpi-lpill kpi-lpill-n">
              <span className="kpi-lpill-dash" aria-hidden="true" />
              rolling <b>{fmt$(board.rolling_weekly_target)}</b>
            </span>
          )}
          {board?.budget_exhausted && (
            <span className="kpi-lpill kpi-lpill-n">
              <span className="kpi-lpill-dash" aria-hidden="true" />
              rolling <b>{fmt$(0)}</b> · budget exhausted
            </span>
          )}
        </>
      );
    }
    if (tier === "B") {
      return (
        <span className="kpi-lpill kpi-lpill-a">
          <span className="kpi-lpill-dash" aria-hidden="true" />
          weekly budget
        </span>
      );
    }
    return (
      <span className="kpi-lpill kpi-lpill-a">
        <span className="kpi-lpill-dash" aria-hidden="true" />
        period budget
      </span>
    );
  })();

  return (
    <div className="kpi-story">
      <div className="kpi-story-left">
        <div className="kpi-story-eye">
          <span className="kpi-story-eye-1">{eyebrowLabel}</span>
          {dateRange && <span className="kpi-story-eye-2">{dateRange}</span>}
        </div>
        <div className="kpi-story-headline">
          <span className="kpi-story-hn num">{fmt$(board?.spent_to_date || 0)}</span>
          <span className="kpi-story-hlab">Total labor spent</span>
        </div>
        <div className="kpi-story-rail3">
          <div className="kpi-story-s"><span className="kpi-story-v num">{workers}</span><span className="kpi-story-k">Workers</span></div>
          <div className="kpi-story-s"><span className="kpi-story-v num">{fmtHrs(hours)}</span><span className="kpi-story-k">Hours</span></div>
          <div className="kpi-story-s"><span className="kpi-story-v num">{avgRate != null ? `$${avgRate.toFixed(2)}` : "—"}</span><span className="kpi-story-k">Avg&nbsp;rate</span></div>
        </div>
        {budget > 0 && <BudgetTrack board={board} />}
      </div>

      <div className="kpi-story-right">
        <div className="kpi-wh">
          <span className="kpi-wh-t">{stripTitle}</span>
          <span className="kpi-wh-sp" aria-hidden="true" />
          {legend}
          <span className="kpi-seg" role="group" aria-label="Lens">
            <button type="button" className={lens === "$" ? "on" : ""} onClick={() => setLens("$")} aria-pressed={lens === "$"}>$</button>
            <button type="button" className={lens === "hrs" ? "on" : ""} onClick={() => setLens("hrs")} aria-pressed={lens === "hrs"}>hrs</button>
          </span>
          <Help>
            <h5>HOW THIS STRIP WORKS</h5>
            {tier === "A" && (
              <>
                <b>Original</b> is the flat weekly budget - the period budget divided by four. Closed weeks keep it, because that is what they were judged against.
                {board?.rolling_weekly_target != null && (
                  <div className="kpi-help-calc">
                    Rolling = (budget − closed spend − in-progress spend) ÷ weeks left = <b>{fmt$(board.rolling_weekly_target)}</b>
                  </div>
                )}
                <b>Rolling</b> replaces it on upcoming weeks: what each remaining week can spend and still land on budget.
              </>
            )}
            {tier === "B" && (
              <>
                One bar per week, shared vertical scale. Hover a bar for its actual, its weekly budget, and the delta. The dashed line steps at period boundaries where the weekly budget changes.
              </>
            )}
            {tier === "C" && (
              <>
                Above 13 weeks the strip aggregates to one bar per fiscal period. Each bar carries its own period budget as a dashed line. Week-level detail lives in the table below.
              </>
            )}
          </Help>
        </div>

        {tier === "A" && <TierAStrip board={board} lens={lens} />}
        {tier === "B" && <TierBStrip board={board} lens={lens} />}
        {tier === "C" && <TierCStrip board={board} lens={lens} budgetPeriods={budgetPeriods} todayISO={todayISO} />}
      </div>
    </div>
  );
}
