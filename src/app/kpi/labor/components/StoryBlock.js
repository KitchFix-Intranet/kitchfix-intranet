"use client";
// src/app/kpi/labor/components/StoryBlock.js
//
// V21 board simplification (V21-5..V21-10, V21-13). Left panel is the
// spend card: header (period + dates + verdict pill) / equal-height
// split block (spent | left-to-spend | under | over | muted dash) /
// budget footer. Right panel is the week strip; Tier A carries a
// single continuous target line and amber running / navy allowance
// treatment. Tier B and Tier C are untouched.

import { useRef, useState } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting.js";

// V8-7 verdict label + variant. One source of truth for the pill in
// the spend card header (was in the retired sentence card's helper).
function verdictDisplay(verdict) {
  if (verdict === "on_track") return { label: "ON TRACK", cls: "good" };
  if (verdict === "watch")    return { label: "WATCH",    cls: "warn" };
  if (verdict === "over")     return { label: "OVER BUDGET", cls: "bad" };
  return null;
}

// ── Spend card (V21-5..V21-9 + V29-5..V29-6) ─────────────────────
// V29-6: BUDGET LEADS. Order is eyebrow -> BUDGET hero card -> paired
// (Spent so far | Left to spend). Budget is the dominant figure; spent
// and left are secondary. Closed periods keep the under/over treatment
// on the right cell of the pair.
function SpendCard({ board, eyebrowLabel, dateRange }) {
  const budget = board?.period_budget || board?.range_budget || null;
  const spent = board?.spent_to_date ?? 0;
  const variance = board?.variance ?? null;
  const kind = board?.kind;
  const noBudget = !budget || kind === "no_budget";
  const isPeriod = kind === "single_period_in_progress" || kind === "single_period_closed";

  // V29-5 verdict pill: STATE WORD ONLY. The dollar figure was in the
  // pill text under V21-5; V29-5 removes it - the money is already on
  // the Over/Under signal card and the budget card sub-line.
  const vd = verdictDisplay(board?.verdict);

  // Left-cell (Spent so far) sub. Always the % of budget.
  const spentPct = budget > 0 ? Math.round((spent / budget) * 100) : null;

  // Right-cell state (V29-6). In-progress -> Left to spend (navy tint);
  // closed/multi with variance -> Under/Over budget; no-budget -> muted.
  const right = (() => {
    if (noBudget) {
      const reason = kind === "no_budget"
        ? "no budget"
        : board?.reason === "envelope" ? "envelope-based" : "no budget";
      return { variantCls: "kpi-spend-cell-mute", label: reason, value: "—", sub: "" };
    }
    if (kind === "single_period_in_progress") {
      const left = Math.max(0, (budget || 0) - spent);
      const denom = (board?.in_progress_week_start ? 1 : 0) + (board?.not_started_weeks_count || 0);
      return {
        variantCls: "kpi-spend-cell-nav",
        label: "Left to spend",
        value: fmt$(left),
        sub: `${denom} week${denom === 1 ? "" : "s"} remaining`,
      };
    }
    // Closed period or multi-period range with a resolved budget.
    if (variance != null && variance > 0.5) {
      return {
        variantCls: "kpi-spend-cell-over",
        label: "Over budget",
        value: fmt$(Math.abs(variance)),
        sub: "vs budget",
      };
    }
    return {
      variantCls: "kpi-spend-cell-under",
      label: "Under budget",
      value: variance != null ? fmt$(Math.abs(variance)) : "—",
      sub: "vs budget",
    };
  })();

  // V29-6 budget-card sub line. V29-14: `period closed` becomes `range
  // closed` on non-period ranges.
  const budgetSub = (() => {
    if (noBudget) return "no budget for this range";
    const prefix = isPeriod ? "FY2026 budget" : "FY2026 range budget";
    if (kind === "single_period_in_progress") {
      const p = board?.elapsed_pct;
      return `${prefix} · ${p != null ? `${Math.round(p)}% of period gone` : ""}`;
    }
    if (isPeriod) return `${prefix} · period closed`;
    return `${prefix} · range closed`;
  })();

  return (
    <div className="kpi-spend">
      {/* Header row: period + dates + verdict pill (V29-5: state word). */}
      <div className="kpi-spend-h">
        <div className="kpi-spend-h-left">
          <span className="kpi-spend-h-title">{eyebrowLabel}</span>
          {dateRange && <span className="kpi-spend-h-dates">{dateRange}</span>}
        </div>
        {vd && (
          <span className={`kpi-vpill kpi-vpill-${vd.cls}`}>
            <span className="kpi-vpill-dot" aria-hidden="true" />
            {vd.label}
          </span>
        )}
      </div>

      {/* V29-6 BUDGET LEADS - hero-size budget card with navy accent.
          V29-2: hero > 11 chars falls back to VALUE size so a millions
          figure ($1,637,503.83 = 13 chars) renders complete. */}
      {(() => {
        const budgetText = noBudget ? "—" : fmt$(budget);
        const isLong = budgetText.length > 11;
        return (
          <div className="kpi-spend-budget">
            <span className="kpi-spend-budget-accent" aria-hidden="true" />
            <div className="kpi-spend-budget-lab">Budget</div>
            <div className="kpi-spend-budget-val num" data-long={isLong ? "true" : "false"}>{budgetText}</div>
            <div className="kpi-spend-budget-sub">{budgetSub}</div>
          </div>
        );
      })()}

      {/* V29-6 paired secondary cells: Spent so far | (Left / Under / Over). */}
      <div className="kpi-spend-pair">
        <div className="kpi-spend-cell">
          <div className="kpi-spend-cell-lab">Spent so far</div>
          <div className="kpi-spend-cell-val num">{fmt$(spent)}</div>
          <div className="kpi-spend-cell-sub">{spentPct != null ? `${spentPct}% of budget` : ""}</div>
        </div>
        <div className={`kpi-spend-cell ${right.variantCls}`}>
          <div className="kpi-spend-cell-lab">{right.label}</div>
          <div className="kpi-spend-cell-val num">{right.value}</div>
          <div className="kpi-spend-cell-sub">{right.sub}</div>
        </div>
      </div>
    </div>
  );
}

// ── TIER A: per-week columns with captions ────────────────────────
// V29-7 - each week carries ONLY the target line that applies to it:
//   closed / in-progress -> AMBER original weekly target
//   not-started          -> LIGHT BLUE adjusted target (weekly allowance)
// V29-14 - a zero-spend week renders a baseline rule only, with NO
// floating target line, so it does not read as broken.
function TierAWeekBar({ w, weeklyOriginal, weeklyAllowance, scale }) {
  const isNotStarted = w.state === "not_started";
  const isInProgress = w.state === "in_progress";
  const isClosed = w.state === "closed";
  const value = isNotStarted
    ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
    : (w.spent || 0);
  const isZero = !isNotStarted && (!value || value <= 0.5);
  const barPct = isNotStarted ? 0 : Math.max(0, Math.min(100, (value / scale) * 90));
  const barCls = isInProgress
    ? "kpi-wb-bar kpi-wb-bar-prog"
    : isClosed
      ? `kpi-wb-bar ${w.delta_sign === "over" ? "kpi-wb-bar-over" : "kpi-wb-bar-under"}`
      : "";
  // V29-7 per-week target line. Amber for closed/in-progress at the
  // week's ORIGINAL weekly target; light blue for not-started at the
  // ADJUSTED target (weekly allowance). Omitted for zero-spend weeks
  // (V29-14) and when no target is available.
  const perWeekTarget = isNotStarted
    ? (w.weekly_allowance ?? weeklyAllowance)
    : (w.original_target ?? weeklyOriginal);
  const targetPct = (!isZero && perWeekTarget != null && perWeekTarget > 0)
    ? Math.max(0, Math.min(100, (perWeekTarget / scale) * 90))
    : null;
  const targetCls = isNotStarted ? "kpi-wb-target kpi-wb-target-blue" : "kpi-wb-target";

  const captionValue = isInProgress && w.unapproved_flag ? `≥ ${fmt$(value)}` : fmt$(value);
  let statusLine;
  if (isClosed && w.delta_vs_original != null) {
    const arrow = w.delta_sign === "under" ? "▼" : w.delta_sign === "over" ? "▲" : "•";
    const cls = w.delta_sign === "under" ? "kpi-wb-d-good" : w.delta_sign === "over" ? "kpi-wb-d-bad" : "kpi-wb-d-mute";
    statusLine = <span className={`kpi-wb-d ${cls}`}>{arrow} {fmt$(Math.abs(w.delta_vs_original))} {w.delta_sign}</span>;
  } else if (isInProgress) {
    // V21-10 status line uses the allowance. V29-12 fix: explicit space
    // token between the money and the "allowance" word so the render
    // never elides it.
    const allow = w.weekly_allowance ?? weeklyAllowance;
    if (w.unapproved_flag && w.unapproved_hours > 0) {
      statusLine = <span className="kpi-wb-warn">⚠ {fmtHrs(w.unapproved_hours)} hrs awaiting approval</span>;
    } else if (allow != null) {
      statusLine = <span className="kpi-wb-d kpi-wb-d-mute">running · <b>{fmt$(allow)}</b>{" "}allowance</span>;
    } else {
      statusLine = <span className="kpi-wb-d kpi-wb-d-mute">running</span>;
    }
  } else if (isNotStarted) {
    statusLine = <span className="kpi-wb-d kpi-wb-d-mute">to stay on budget</span>;
  }
  const captionCls = isNotStarted ? "kpi-wb-cap-value kpi-wb-cap-roll" : "kpi-wb-cap-value";
  return (
    <div className="kpi-wb">
      <div className="kpi-wb-plot">
        {targetPct != null && (
          <span className={targetCls} style={{ bottom: `${targetPct}%` }} />
        )}
        {isNotStarted || isZero ? (
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
  // Shared scale across the strip so both target lines and every bar
  // reference the same plot band.
  const scale = (() => {
    let max = 1;
    for (const w of weeks) {
      const v = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.spent || 0);
      const t = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.original_target ?? weeklyOriginal ?? 0);
      const local = Math.max(v, t || 0);
      if (local > max) max = local;
    }
    if (weeklyOriginal) max = Math.max(max, weeklyOriginal);
    if (weeklyAllowance) max = Math.max(max, weeklyAllowance);
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

// ── TIER B: 7-13 weeks, one row of compact bars (untouched V21-10) ─
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

// ── TIER C: > 13 weeks, one bar per fiscal period (untouched V21-10) ─
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
  // V29-7 - Tier A strip header labels each line ONCE. Amber ORIGINAL
  // for closed / in-progress weeks; light-blue ADJUSTED for not-started
  // weeks (only rendered when the allowance applies - single-period
  // in-progress ranges with weeks not yet started).
  const showOriginalLabel = tier === "A" && board?.weekly_original_target != null;
  const showAdjustedLabel = tier === "A"
    && board?.weekly_allowance != null
    && (board?.not_started_weeks_count || 0) > 0;

  return (
    <div className="kpi-story">
      <div className="kpi-story-left">
        <SpendCard board={board} eyebrowLabel={eyebrowLabel} dateRange={dateRange} />
      </div>

      <div className="kpi-story-right">
        <div className="kpi-wh">
          <span className="kpi-wh-t">{stripTitle}</span>
          <span className="kpi-wh-sp" aria-hidden="true" />
          {showOriginalLabel && (
            <span className="kpi-wh-tgt">
              <span className="kpi-wh-tgt-dash" aria-hidden="true" />
              original <b>{fmt$(board.weekly_original_target)}</b>
            </span>
          )}
          {showAdjustedLabel && (
            <span className="kpi-wh-tgt kpi-wh-tgt-adj">
              <span className="kpi-wh-tgt-dash" aria-hidden="true" />
              adjusted <b>{fmt$(board.weekly_allowance)}</b>
            </span>
          )}
        </div>

        {tier === "A" && <TierAStrip board={board} />}
        {tier === "B" && <TierBStrip board={board} />}
        {tier === "C" && <TierCStrip board={board} budgetPeriods={budgetPeriods} todayISO={todayISO} />}
      </div>
    </div>
  );
}
