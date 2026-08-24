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
import { estimateUnpricedDollars } from "@/lib/labor/estimateUnpricedDollars";
import { classifyTier } from "@/lib/kpi/classifyTier";

// PR-B - MM/DD/YY from ISO for the "range closed through DATE"
// suffix. Same convention signalCardModels.js uses.
function fmtMMDDYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${m}/${d}/${y.slice(2)}`;
}

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
function SpendCard({ board, eyebrowLabel, dateRange, salary, salaryAvailable }) {
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
  // closed` on non-period ranges. V37-4 - append `· envelope` or
  // `· pnl` when board.budget_basis names one.
  //
  // PR-B (owner ruling 2026-08-24) - two edits on the in-progress /
  // closed-range branches:
  //   1. "43% of period gone" flips to "57% of period remains"
  //      COMPUTED as (100 - elapsedPct), not the same number with a
  //      new label. Owner's specific warning: "That is the kind of
  //      change that looks done and is wrong."
  //   2. "range closed" (multi_period fully closed) gains "through
  //      MM/DD/YY" using board.range_end_iso. Multi_period with a
  //      running week keeps the current "range closed" for now
  //      (owner did not address it in this pass; will surface if
  //      wrong on prod).
  const budgetSub = (() => {
    if (noBudget) return "no budget for this range";
    const prefix = isPeriod ? "FY2026 budget" : "FY2026 range budget";
    let core;
    if (kind === "single_period_in_progress") {
      const p = board?.elapsed_pct;
      const remaining = p != null ? Math.max(0, Math.round(100 - p)) : null;
      core = `${prefix} · ${remaining != null ? `${remaining}% of period remains` : ""}`;
    } else if (isPeriod) {
      core = `${prefix} · period closed`;
    } else {
      // multi_period: append "through MM/DD/YY" when the range is
      // fully closed. If a running week is in the range, fall back to
      // the plain "range closed" (owner spec was for the closed case).
      const inProgressWeekStart = board?.in_progress_week_start;
      const rangeEnd = board?.range_end_iso;
      if (!inProgressWeekStart && rangeEnd) {
        core = `${prefix} · range closed through ${fmtMMDDYY(rangeEnd)}`;
      } else {
        core = `${prefix} · range closed`;
      }
    }
    // Salary PR 3 C2 - when salary is on, the sub-line names the
    // combined basis so the reader knows the budget hero includes
    // 3100.2 not just 3100.1. Overrides the envelope/pnl basis word
    // - a merged budget is neither; the basis is the composition.
    if (salary) return `${core} · hourly + salary`;
    return board?.budget_basis ? `${core} · ${board.budget_basis}` : core;
  })();

  return (
    <div className="kpi-spend">
      {/* Header row: period + dates + verdict pill (V29-5: state word)
          + scope pill (Homestand PR-2 audit 2026-08-21). Scope pill
          moved off the command-bar title into the first card, beside
          the on-track / over-budget pill, at the card's pill scale.
          Renders whenever the caller can toggle salary (regardless of
          on/off state), so a printed / screenshotted board always
          states which pool of workers it counted. */}
      <div className="kpi-spend-h">
        <div className="kpi-spend-h-left">
          <span className="kpi-spend-h-title">{eyebrowLabel}</span>
          {dateRange && <span className="kpi-spend-h-dates">{dateRange}</span>}
        </div>
        <div className="kpi-spend-h-right">
          {vd && (
            <span className={`kpi-vpill kpi-vpill-${vd.cls}`}>
              <span className="kpi-vpill-dot" aria-hidden="true" />
              {vd.label}
            </span>
          )}
          {salaryAvailable && (
            <span
              className={"kpi-vpill kpi-vpill-scope " + (salary ? "kpi-vpill-scope-on" : "kpi-vpill-scope-off")}
              aria-label={salary ? "Salary included" : "Hourly labor only"}
              data-scope-pill
            >{salary ? "+ SALARY" : "HOURLY ONLY"}</span>
          )}
        </div>
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

      {/* PR-B (owner ruling 2026-08-24) - "Spent so far" gets a
          kind-aware label so the copy names what the figure IS:
            - single_period_in_progress / single_period_closed
              -> "Spent in Period"
            - multi_period (FYTD / Last-4-Weeks / custom range)
              -> "Spend to date"
          Same figure (board.spent_to_date), different noun for the
          scope it summarises. */}
      <div className="kpi-spend-pair">
        <div className="kpi-spend-cell">
          <div className="kpi-spend-cell-lab">{isPeriod ? "Spent in Period" : "Spend to date"}</div>
          <div className="kpi-spend-cell-val num">{fmt$(spent)}</div>
          <div className="kpi-spend-cell-sub">{spentPct != null ? `${spentPct}% of budget` : ""}</div>
        </div>
        <div className={`kpi-spend-cell ${right.variantCls}`}>
          <div className="kpi-spend-cell-lab">{right.label}</div>
          <div className="kpi-spend-cell-val num">{right.value}</div>
          <div className="kpi-spend-cell-sub">{right.sub}</div>
        </div>
      </div>

      {/* Salary PR 3 C3 - salary vacancy line. States the arithmetic;
          never guesses the cause (spec is explicit: "under budget can
          be an unfilled role, a mid-period departure, or a role filled
          below budget - the board cannot tell them apart"). Three
          shapes: at-budget (== budget), under-budget (< budget),
          over-budget (> budget). Roles-filled clause omitted here -
          we do not carry a budgeted-headcount on the wire, and
          salary_summary.workers is filled count only. */}
      {salary && salary.vacancy && (() => {
        const rows = salary.vacancy.filter(v => v.budget > 0 || v.actual > 0);
        if (rows.length === 0) return null;
        const budgetSum = rows.reduce((s, v) => s + Number(v.budget || 0), 0);
        const actualSum = rows.reduce((s, v) => s + Number(v.actual || 0), 0);
        if (budgetSum <= 0 && actualSum <= 0) return null;
        const pct = budgetSum > 0 ? Math.round((actualSum / budgetSum) * 100) : null;
        const cls = actualSum > budgetSum ? "kpi-spend-salary-over"
                  : Math.abs(actualSum - budgetSum) < 0.5 ? "kpi-spend-salary-at"
                  : "kpi-spend-salary-under";
        return (
          <div className={`kpi-spend-salary ${cls}`}>
            salary <b>{fmt$(actualSum)}</b> of <b>{fmt$(budgetSum)}</b>
            {pct != null && <> · {pct}%</>}
          </div>
        );
      })()}
    </div>
  );
}

// ── TIER A: per-week columns with captions ────────────────────────
// V29-7 - each week carries ONLY the target line that applies to it:
//   closed / in-progress -> AMBER original weekly target
//   not-started          -> LIGHT BLUE adjusted target (weekly allowance)
// V29-14 - a zero-spend week renders a baseline rule only, with NO
// floating target line, so it does not read as broken.
function TierAWeekBar({ w, weeklyOriginal, weeklyAllowance, scale, rate }) {
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
  // V42 REVISED (C2) - hatched cap. Estimated dollars for hours with
  // no covering pay-segment yet - "this bar will grow when payroll
  // processes those hours." Signal is unpriced_hrs (aggregate of
  // hours_without_dollars), NOT draft_hours: priced drafts are
  // already in the solid bar, so capping by draft_hours would
  // double-count. Owner correction 2026-08-20 after TXR - AZ 08/10
  // measurement (173.93 draft hrs, 0.00 unpriced, $3,430.45 priced).
  //
  // Cap renders on any week where unpriced_hrs > 0, closed or in
  // progress. Reuses existing kpi-wb-bar-prog (45deg amber gradient) -
  // no new pattern, no new colour token. Clamp: total (bar + cap)
  // cannot exceed plot; cap gets at least 0.5% so it never scales
  // to zero when it is real.
  const capDollars = estimateUnpricedDollars(w.unpriced_hrs, rate);
  const capPctRaw = capDollars != null ? (capDollars / scale) * 90 : 0;
  const capHeadroom = Math.max(0, 90 - barPct);
  const capPct = capDollars != null
    ? Math.max(0.5, Math.min(capHeadroom, capPctRaw))
    : 0;
  // PR-C hatch gap fix (owner ruling 2026-08-24). When a cap is
  // present, remove the bar's rounded top so bar + cap merge cleanly.
  // Prior state: both elements carried `border-radius: 4px 4px 0 0`;
  // the bar's rounded top curved down at the corners while the cap's
  // flat bottom left a triangular gap. `.kpi-wb-bar-capped` overrides
  // border-radius to 0 so the pair reads as one column.
  const barClsFinal = (barCls && capPct > 0) ? `${barCls} kpi-wb-bar-capped` : barCls;
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

  // V42 REVISED - `≥` prefix on the caption fires when the bar will
  // grow (unpriced money signal), not when there are drafts.
  const hasUnpriced = (w.unpriced_hrs || 0) > 0.004;
  const captionValue = hasUnpriced ? `≥ ${fmt$(value)}` : fmt$(value);
  let statusLine;
  if (isClosed && w.delta_vs_original != null) {
    const arrow = w.delta_sign === "under" ? "▼" : w.delta_sign === "over" ? "▲" : "•";
    const cls = w.delta_sign === "under" ? "kpi-wb-d-good" : w.delta_sign === "over" ? "kpi-wb-d-bad" : "kpi-wb-d-mute";
    statusLine = <span className={`kpi-wb-d ${cls}`}>{arrow} {fmt$(Math.abs(w.delta_vs_original))} {w.delta_sign}</span>;
  } else if (isInProgress) {
    // V42 REVISED (State 1 informational) - current week with drafts
    // reads "running · N hrs not yet approved". PR-C (owner ruling
    // 2026-08-24): the running-week caption now reads AMBER
    // (kpi-wb-d-warn) so it matches the amber solid bar above; the
    // muted grey used previously read as "not-started" which conflicts
    // with the state.
    //
    // PR-C multi_period fix: when weekly_allowance is null (multi_period
    // does not compute an allowance, that's a single-period concept),
    // fall back to w.original_target so the running week on FYTD shows
    // its own per-week budget instead of just "running" with nothing to
    // compare. Caption reads "running · $X budget" on multi to name the
    // basis distinctly from single-period's "allowance".
    const allow = w.weekly_allowance ?? weeklyAllowance;
    const perWeekBudget = w.original_target ?? weeklyOriginal;
    const draftHrs = Number(w.draft_hours || 0);
    if (draftHrs > 0.004) {
      statusLine = <span className="kpi-wb-d kpi-wb-d-warn">running · <b>{fmtHrs(draftHrs)}</b>{" "}hrs not yet approved</span>;
    } else if (allow != null) {
      statusLine = <span className="kpi-wb-d kpi-wb-d-warn">running · <b>{fmt$(allow)}</b>{" "}allowance</span>;
    } else if (perWeekBudget != null) {
      statusLine = <span className="kpi-wb-d kpi-wb-d-warn">running · <b>{fmt$(perWeekBudget)}</b>{" "}budget</span>;
    } else {
      statusLine = <span className="kpi-wb-d kpi-wb-d-warn">running</span>;
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
          <div className={barClsFinal} style={{ height: `${Math.max(barPct, 2)}%` }} />
        )}
        {/* V42 REVISED - hatched cap. Sits ON TOP of the solid bar,
            visually stacked via `bottom` position. Hatch is unique
            to this element after the PR-B render fix; the in-progress
            bar itself is now solid amber, so the legend reads true:
            hatched means exactly one thing (pay data pending). */}
        {capPct > 0 && (
          <div
            className="kpi-wb-bar kpi-wb-cap-est"
            style={{ height: `${capPct}%`, bottom: `${barPct}%` }}
            title={capDollars != null ? `Estimated ~${fmt$(capDollars)} pending pay data` : undefined}
            aria-label="pay data pending, estimated"
          />
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

function TierAStrip({ board, salary }) {
  const weeks = board?.weeks || [];
  const weeklyOriginal = board?.weekly_original_target;
  const weeklyAllowance = board?.weekly_allowance;
  // V42 REVISED - rate for the hatched cap. Same source the Payroll
  // Data card reads (SignalCards.js) so bar + card cannot disagree.
  const rate = salary?.blended_rate_hourly ?? board?.avg_rate ?? null;
  // Shared scale across the strip so both target lines and every bar
  // reference the same plot band. V42: include the hatched cap in
  // the scale so a large cap does not clip the bar it sits on top of.
  const scale = (() => {
    let max = 1;
    for (const w of weeks) {
      const v = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.spent || 0);
      const t = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.original_target ?? weeklyOriginal ?? 0);
      const cap = estimateUnpricedDollars(w.unpriced_hrs, rate) || 0;
      const local = Math.max(v + cap, t || 0);
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
          rate={rate}
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
// PR-C - target-line legend for Tier C. Owner ruling 2026-08-24: the
// dashed target on Tier C has no key. Uses the same .kpi-wh-tgt shape
// Tier A already renders so the visual treatment is consistent across
// tiers.
function TierCHeader() {
  return (
    <div className="kpi-wh kpi-wh-c">
      <span className="kpi-wh-sp" aria-hidden="true" />
      <span className="kpi-wh-tgt">
        <span className="kpi-wh-tgt-dash" aria-hidden="true" />
        Target
      </span>
    </div>
  );
}

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
// classifyTier lifted to src/lib/kpi/classifyTier.js so purchasing can
// import it too. PR 2 R3 Part B (2026-08-24).

export function StoryBlock({ board, account, rangeLabel, budgetPeriods, todayISO, salary, salaryAvailable }) {
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
        <SpendCard board={board} eyebrowLabel={eyebrowLabel} dateRange={dateRange} salary={salary} salaryAvailable={salaryAvailable} />
      </div>

      <div className="kpi-story-right">
        <div className="kpi-wh">
          <span className="kpi-wh-t">{stripTitle}</span>
          <span className="kpi-wh-sp" aria-hidden="true" />
          {showOriginalLabel && (
            <span className="kpi-wh-tgt">
              <span className="kpi-wh-tgt-dash" aria-hidden="true" />
              {/* V33 item 4d - `original` only means something when an
                  adjusted line renders alongside it. On closed periods
                  (no adjusted) label it plainly `weekly target`. */}
              {showAdjustedLabel ? "original" : "weekly target"} <b>{fmt$(board.weekly_original_target)}</b>
            </span>
          )}
          {showAdjustedLabel && (
            <span className="kpi-wh-tgt kpi-wh-tgt-adj">
              <span className="kpi-wh-tgt-dash" aria-hidden="true" />
              adjusted <b>{fmt$(board.weekly_allowance)}</b>
            </span>
          )}
          {/* Salary PR 3 C2 - name the basis on the legend when
              salary is on so the target reads as combined not
              hourly-only. */}
          {salary && showOriginalLabel && (
            <span className="kpi-wh-tgt-basis">· hourly + salary</span>
          )}
          {/* V42 REVISED (C2 legend) - name the hatched cap that
              stacks on top of any bar with unpriced hours. Standing
              rule: every tracker screen carries a visible state key;
              never ship an unexplained pattern. */}
          {tier === "A" && (
            <span className="kpi-wh-tgt kpi-wh-tgt-cap">
              <span className="kpi-wh-cap-swatch" aria-hidden="true" />
              hatched = pay data pending, estimated
            </span>
          )}
        </div>

        {tier === "A" && <TierAStrip board={board} salary={salary} />}
        {tier === "B" && <TierBStrip board={board} />}
        {tier === "C" && (
          <>
            <TierCHeader />
            <TierCStrip board={board} budgetPeriods={budgetPeriods} todayISO={todayISO} />
          </>
        )}
      </div>
    </div>
  );
}
