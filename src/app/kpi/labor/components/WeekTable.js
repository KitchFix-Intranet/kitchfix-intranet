"use client";
// src/app/kpi/labor/components/WeekTable.js
//
// V9 week table. Period bands are data rows (V9-8); the "Period N
// subtotal" row is retired (V9-9). Coverage becomes exception-only
// via edge + tint + flag chip (V9-1..V9-3). Every row has a `vs
// budget` cell built from server-computed weekly budgets (V9-4/V9-5)
// - the client never divides a period budget itself.
//
// Column set (V9-17):
//   single account  = Week / vs budget / Hours / OT / Rate / Dollars
//                     (Holiday + Unpriced surface only when nonzero
//                     across the range)
//   aggregate       = Week / vs budget / Hours / OT / Unpriced /
//                     Rate / Dollars (Holiday adaptive)
//
// Sticky discipline (V9-11): column header top:0, period bands stick
// beneath it, TOTAL row pins to the scroll container bottom.
//
// All prose moves out of the tbody into the ? popover (V9-19).

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting.js";
import { periodOf, periodStartISO, periodEndISO } from "../lib/periods.js";

const DENSITY_KEY = "kpi:table:density";
const WEEKS_PER_PERIOD = 4;

function workerLabel(meta, worker_id, redact) {
  const num = meta?.number != null ? `#${meta.number}` : `#${String(worker_id).slice(0, 6)}`;
  if (redact || !meta?.display_name) {
    const title = meta?.title ? ` ${meta.title}` : "";
    return `${num}${title}`;
  }
  return `${meta.display_name} (${num})`;
}

function WorkersFilter({ workerRoster, selectedWorkers, onWorkersChange }) {
  const [open, setOpen] = useState(false);
  const total = workerRoster.length;
  const shown = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : total;
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
    <div className="kpi-workers" ref={rootRef}>
      {/* V25-12 - Workers loses its pill shape and joins the button family. */}
      <button
        type="button"
        className={`kpi-tbar-btn kpi-tbar-btn-dd ${open ? "on" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen(o => !o)}
      >
        <svg className="kpi-i" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="1.75" />
        </svg>
        <span>{shown === total ? `All ${total} workers` : `${shown} of ${total} workers`}</span>
      </button>
      {open && (
        <div className="kpi-pop kpi-pop-workers open">
          <div className="kpi-pop-head">
            <span className="kpi-pop-title">Workers</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" className="kpi-btn kpi-btn-sm" onClick={() => onWorkersChange?.(null)}>All</button>
              <button type="button" className="kpi-btn kpi-btn-sm" onClick={() => onWorkersChange?.(new Set())}>None</button>
            </span>
          </div>
          <div className="kpi-wk-list">
            {workerRoster.map(w => {
              const checked = !selectedWorkers || selectedWorkers.size === 0 || selectedWorkers.has(w.id);
              return (
                <label key={w.id} className="kpi-wk-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      let next;
                      if (!selectedWorkers || selectedWorkers.size === 0) {
                        next = new Set(workerRoster.map(x => x.id));
                      } else {
                        next = new Set(selectedWorkers);
                      }
                      if (e.target.checked) next.add(w.id);
                      else next.delete(w.id);
                      onWorkersChange?.(next);
                    }}
                  />
                  <span>{w.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HelpPop() {
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
    <div className="kpi-help-anchor" ref={rootRef}>
      <button
        type="button"
        className="kpi-help"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label="About this table"
        onClick={() => setOpen(o => !o)}
      >?</button>
      {open && (
        <div className="kpi-help-pop kpi-help-pop-table" role="dialog">
          <h5>ABOUT THIS TABLE</h5>
          <p><b>Coverage</b> appears only when something is wrong - a clean row means every entry has priced hours.</p>
          <p><b>vs budget</b> compares each row against its own budget: a week against the weekly budget, a period against the period budget. The tick is the budget line; the bar is what was spent.</p>
          <p><b>Rate</b> is blended - dollars divided by hours. Dollars come from Rippling pay segments, never hours &times; rate.</p>
          <p>Columns with no values anywhere in the range are hidden.</p>
        </div>
      )}
    </div>
  );
}

// V9-5 vs budget lockup: 58px bar + 72px delta. Tick at 80%.
function VsBudget({ spent, budget, mode }) {
  // mode: "closed" | "in_progress" | "muted"
  if (mode === "muted" || budget == null) {
    return <span className="kpi-vb"><span className="kpi-vb-bar" /><span className="kpi-vb-d kpi-vb-d-mute">–</span></span>;
  }
  if (mode === "in_progress") {
    // Percent used at 80% tick basis: bar fill = spent/budget * 80%.
    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    const fillPct = Math.max(0, Math.min(100, (spent / budget) * 80));
    return (
      <span className="kpi-vb">
        <span className="kpi-vb-bar">
          <i style={{ width: `${fillPct}%` }} />
          <span className="kpi-vb-tick" />
        </span>
        <span className="kpi-vb-d kpi-vb-d-neut">{Math.round(pct)}% used</span>
      </span>
    );
  }
  // closed
  const budgetOr1 = budget > 0 ? budget : 1;
  const pct80 = Math.max(0, Math.min(80, (spent / budgetOr1) * 80));
  const over = spent > budget;
  const overageDollars = over ? spent - budget : 0;
  // Over-segment width capped at 20% (the overflow zone). Delta text
  // still shows the true dollar figure.
  const overPct = over ? Math.min(20, (overageDollars / budgetOr1) * 80) : 0;
  const delta = Math.round(spent - budget);
  const sign = delta < 0 ? "▼" : delta > 0 ? "▲" : "—";
  const dCls = delta < 0 ? "kpi-vb-d-good" : delta > 0 ? "kpi-vb-d-bad" : "kpi-vb-d-neut";
  return (
    <span className="kpi-vb">
      <span className="kpi-vb-bar">
        <i style={{ width: `${pct80}%` }} className={over ? "kpi-vb-fill-over" : ""} />
        {over && <i className="kpi-vb-over" style={{ left: "80%", width: `${overPct}%` }} />}
        <span className="kpi-vb-tick" />
      </span>
      <span className={`kpi-vb-d ${dCls}`}>{sign} ${Math.abs(delta).toLocaleString("en-US")}</span>
    </span>
  );
}

// V9-2 severity ranking: unknown > partial/hours_only > complete
const SEV_RANK = { unknown: 3, partial: 2, hours_only: 2, no_labor: 1, complete: 0 };
function worstSeverity(states) {
  let best = "complete";
  for (const s of states) {
    if ((SEV_RANK[s] || 0) > (SEV_RANK[best] || 0)) best = s;
  }
  return best;
}

function flagForSeverity(s) {
  if (s === "unknown") return { label: "not covered", cls: "kpi-flag-warn" };
  if (s === "partial" || s === "hours_only") return { label: "unpriced", cls: "kpi-flag-warn" };
  if (s === "no_labor") return { label: "no labor", cls: "kpi-flag-mute" };
  return null;
}

function weekSeverity(week) {
  return worstSeverity(week.coverage_states || [week.coverage_state]);
}

// V9-17 adaptive columns
function computeVisibleColumns({ grouped, mode }) {
  let anyHoliday = false;
  let anyUnpriced = false;
  let anyOT = false;
  for (const g of grouped) {
    for (const w of g.weeks) {
      if ((w.hours_double_time || 0) > 0.004) anyHoliday = true;
      if ((w.hours_without_dollars || 0) > 0.004) anyUnpriced = true;
      if ((w.hours_overtime || 0) > 0.004) anyOT = true;
    }
  }
  return {
    holiday: anyHoliday,
    // Unpriced default: on in aggregate view, adaptive in single.
    unpriced: mode === "aggregate" ? true : anyUnpriced,
    // OT column always renders per V9-17 spec (single = Rate + Dollars,
    // aggregate = Unpriced + Rate + Dollars, both include OT).
    ot: true,
    // Rate column always renders per V9-15 (every tier).
    rate: true,
  };
}

function blendedRate({ dollars, hours }) {
  if (!hours || hours <= 0) return null;
  return dollars / hours;
}

// V9-16 OT flag on a row containing OT hours.
function OTTag({ ot }) {
  if (!ot || ot <= 0.004) return null;
  return <span className="kpi-tbl-otflag" aria-label="Overtime hours in this row">OT</span>;
}

// V9-2 exception rendering: flag chip beside the row label. Rendered
// for week/period rows whose worst coverage is not complete.
function ExceptionChip({ severity }) {
  const f = flagForSeverity(severity);
  if (!f) return null;
  return <span className={`kpi-tbl-flag ${f.cls}`}>⚠ {f.label}</span>;
}

function ParentExceptionChip({ count, unit }) {
  if (!count || count <= 0) return null;
  return <span className="kpi-tbl-flag kpi-flag-warn">⚠ {count} {unit}{count === 1 ? "" : "s"} unpriced</span>;
}

// Aggregate child rows: group actuals by account_key per week.
function aggregateChildrenForWeek(week, weekBudgetsByWeekStart, memberByWeekAndAcct) {
  const byAcct = memberByWeekAndAcct.get(week.week_start) || new Map();
  const perMemberBudget = weekBudgetsByWeekStart.get(week.week_start)?.per_member || {};
  const rows = [];
  for (const [account_key, agg] of byAcct) {
    rows.push({
      kind: "account",
      account_key,
      hours: agg.hours,
      hours_ot: agg.ot,
      hours_holiday: agg.hol,
      hours_unpriced: agg.unpriced,
      amount: agg.amount,
      coverage_state: worstSeverity(agg.states),
      week_budget: perMemberBudget[account_key] ?? null,
    });
  }
  rows.sort((a, b) => b.amount - a.amount);
  return rows;
}

// Single-account child rows: worker-week rows for this week, sorted
// by amount desc.
function workerChildrenForWeek(week, workers) {
  return [...week.worker_rows]
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .map(r => ({
      kind: "worker",
      worker_id: r.worker_id,
      title: workers?.[r.worker_id]?.title || null,
      number: workers?.[r.worker_id]?.number,
      display_name: workers?.[r.worker_id]?.display_name,
      hours: Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0),
      hours_ot: Number(r.hours_overtime || 0),
      hours_holiday: Number(r.hours_double_time || 0),
      hours_unpriced: Number(r.hours_without_dollars || 0),
      amount: Number(r.amount || 0),
      coverage_state: r.coverage_state,
    }));
}

export function WeekTable({
  account,
  grouped,               // period-grouped weeks (from page.js)
  grandTotal,
  workers,
  redact,
  onToggleRedact,
  workerRoster,
  selectedWorkers,
  onWorkersChange,
  expandedPeriods,
  onTogglePeriod,
  expandedWeeks,
  onToggleWeek,
  onExpandAll,
  onCollapseAll,
  onJumpPeriod,
  onEscape,
  todayISO,
  aggregateMode,
  budgetPeriods,         // [{ period_no, amount }]
  weekBudgets,           // [{ week_start, amount, per_member? }]
  onPickAccount,         // (accountKey) => void   only for aggregate
  rangeSelection,        // { kind, value } from client
  resolvedPreset,
  rolledUpMembers = [],           // V25-2 members in the aggregate roll-up
  aggregateExcludedMembers = [],  // V25-2 envelope members excluded from the roll-up
}) {
  const excludedSet = useMemo(() => new Set(aggregateExcludedMembers), [aggregateExcludedMembers]);
  const rolledUpCount = rolledUpMembers.length;
  const wrapRef = useRef(null);
  const [dense, setDense] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { const v = localStorage.getItem(DENSITY_KEY); if (v === "1") setDense(true); } catch {}
  }, []);
  const commitDense = (v) => {
    setDense(v);
    try { localStorage.setItem(DENSITY_KEY, v ? "1" : "0"); } catch {}
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && expandedWeeks.size > 0) onEscape?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedWeeks, onEscape]);

  // Jump chips (V6-22 preserved)
  const chips = grouped.map(g => {
    if (g.groupHint?.kind === "month") {
      const M = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
      return { key: g.key, jumpKey: g.groupHint.monthIndex, label: M[g.groupHint.monthIndex] };
    }
    return { key: g.key, jumpKey: g.period_no, label: g.period_no ? `P${g.period_no}` : "prior" };
  });
  const showChips = chips.length >= 2;

  const mode = aggregateMode ? "aggregate" : "single";
  const columns = useMemo(() => computeVisibleColumns({ grouped, mode }), [grouped, mode]);

  // Aggregate-mode child pre-aggregation: for every week, group actuals
  // by account_key. Server ships raw actuals rows; each row still has
  // account_key. This is a group-by, not a money computation.
  const memberByWeekAndAcct = useMemo(() => {
    const out = new Map();
    if (mode !== "aggregate") return out;
    for (const g of grouped) {
      for (const w of g.weeks) {
        const per = new Map();
        for (const r of w.worker_rows || []) {
          const key = r.account_key;
          const cur = per.get(key) || { amount: 0, hours: 0, ot: 0, hol: 0, unpriced: 0, states: [] };
          cur.amount += Number(r.amount || 0);
          cur.hours += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
          cur.ot += Number(r.hours_overtime || 0);
          cur.hol += Number(r.hours_double_time || 0);
          cur.unpriced += Number(r.hours_without_dollars || 0);
          cur.states.push(r.coverage_state);
          per.set(key, cur);
        }
        out.set(w.week_start, per);
      }
    }
    return out;
  }, [grouped, mode]);

  // Weekly budget lookup by week_start.
  const weekBudgetsByWeekStart = useMemo(() => {
    const m = new Map();
    for (const wb of weekBudgets || []) m.set(wb.week_start, wb);
    return m;
  }, [weekBudgets]);

  // Budget by period_no from server.
  const budgetByPeriod = useMemo(() => {
    const m = new Map();
    for (const b of budgetPeriods || []) m.set(b.period_no, Number(b.amount));
    return m;
  }, [budgetPeriods]);

  // Per-period totals (aggregation of the weeks in the band). Used for
  // period-band data row (V9-8).
  const periodTotals = useMemo(() => grouped.map(g => {
    const t = { hours: 0, ot: 0, hol: 0, unpriced: 0, amount: 0 };
    const states = [];
    let periodBudget = null;
    let weeksInBand = 0;
    for (const w of g.weeks) {
      t.hours += (w.hours_regular || 0) + (w.hours_overtime || 0) + (w.hours_double_time || 0);
      t.ot += w.hours_overtime || 0;
      t.hol += w.hours_double_time || 0;
      t.unpriced += w.hours_without_dollars || 0;
      t.amount += w.amount || 0;
      states.push(w.coverage_state);
      weeksInBand += 1;
    }
    if (g.groupHint?.kind === "period" && g.period_no != null) {
      periodBudget = budgetByPeriod.has(g.period_no) ? budgetByPeriod.get(g.period_no) : null;
    } else if (g.groupHint?.kind === "month") {
      // Month bands: sum of weekly budgets for the weeks in the month.
      let sum = 0, any = false;
      for (const w of g.weeks) {
        const wb = weekBudgetsByWeekStart.get(w.week_start);
        if (wb?.amount != null) { sum += wb.amount; any = true; }
      }
      periodBudget = any ? Math.round(sum * 100) / 100 : null;
    }
    return { g, totals: t, states, periodBudget, weeksInBand };
  }), [grouped, budgetByPeriod, weekBudgetsByWeekStart]);

  // In-progress period detection.
  //
  // Prior attempts failed for the same reason from different angles:
  //   Round 1: read `g.weeks[last-index]` - but grouped weeks are
  //     sorted week_start DESC, so last-index is the OLDEST week.
  //     Any period past its first week returned false.
  //   Round 2: `g.weeks.some(w => today between w bounds)` - but
  //     g.weeks only contains weeks that HAVE LABOR ROWS. For an
  //     in-progress period like CIN - AZ P9 whose only recorded week
  //     is the closed 08/10-08/16, the predicate returned false and
  //     the band + total rendered a closed-week delta instead of
  //     `<n>% used`.
  //
  // Correct: test today against the PERIOD's own bounds, not against
  // the weeks that happen to carry rows. periodStartISO / periodEndISO
  // compute the period range from the FY calendar - deterministic,
  // independent of actuals presence. Fallback: if period_no is out of
  // FY2026 (periodStartISO returns null), treat as not-in-progress.
  // Month bands never trigger this rule.
  function isPeriodInProgress(g, today) {
    if (g.groupHint?.kind !== "period" || g.period_no == null) return false;
    const start = periodStartISO(g.period_no);
    const end = periodEndISO(g.period_no);
    if (!start || !end) return false;
    return start <= today && today <= end;
  }

  // Grand row description. V25-2: aggregate rows carry the roll-up
  // account count (`N ACCOUNTS`) so the reader can see the population
  // the roll-up covers matches the population in the vs-budget compare.
  const acctSuffix = aggregateMode && rolledUpCount > 0
    ? ` · ${rolledUpCount} ACCOUNT${rolledUpCount === 1 ? "" : "S"}`
    : "";
  const totalDesc = (() => {
    if (grouped.length === 0) return `TOTAL${acctSuffix}`;
    if (grouped.length === 1) {
      const g = grouped[0];
      if (g.groupHint?.kind === "period") {
        const base = isPeriodInProgress(g, todayISO)
          ? `TOTAL · PERIOD ${g.period_no} TO DATE`
          : `TOTAL · PERIOD ${g.period_no}`;
        return `${base}${acctSuffix}`;
      }
      if (g.groupHint?.kind === "month") {
        return `TOTAL · ${g.groupLabel}${acctSuffix}`;
      }
    }
    const totalWeeks = grouped.reduce((n, g) => n + g.weeks.length, 0);
    const isMonth = grouped[0]?.groupHint?.kind === "month";
    return `TOTAL · ${grouped.length} ${isMonth ? "MONTH" : "PERIOD"}${grouped.length === 1 ? "" : "S"} · ${totalWeeks} WEEK${totalWeeks === 1 ? "" : "S"}${acctSuffix}`;
  })();

  // V25-2 scope note. Renders above the table on aggregate views where
  // one or more members are excluded from the roll-up (today: envelope-
  // based accounts). Reader learns why the two sides of the compare use
  // the same population before they read a variance.
  const scopeNote = aggregateMode && aggregateExcludedMembers.length > 0 && rolledUpCount > 0
    ? `Portfolio figures cover ${rolledUpCount} accounts. ${aggregateExcludedMembers.join(", ")} is envelope-based and is excluded from both spend and budget so the two sides compare like with like.`
    : null;

  // Grand budget = sum of period budgets covered by the range.
  const grandBudget = (() => {
    let sum = 0, any = false;
    for (const pt of periodTotals) {
      if (pt.periodBudget != null) { sum += pt.periodBudget; any = true; }
    }
    return any ? Math.round(sum * 100) / 100 : null;
  })();
  const rangeAllInProgress = grouped.length === 1 && isPeriodInProgress(grouped[0], todayISO);

  // Column count for adaptive
  const showHoliday = !!columns.holiday;
  const showUnpriced = !!columns.unpriced;
  const showRate = !!columns.rate;

  // V25-6 Share column - separate from Dollars; renders in aggregate
  // mode only (worker rows carry no share). Kept in every row so the
  // column reads as one column top to bottom.
  const showShare = aggregateMode;

  const numCols = 2 /* label + vs budget */
                + (showShare ? 1 : 0)
                + 1 /* hours */
                + 1 /* OT */
                + (showHoliday ? 1 : 0)
                + (showUnpriced ? 1 : 0)
                + (showRate ? 1 : 0)
                + 1 /* dollars */;

  return (
    <>
      {/* V25-12 - table control bar. One 28px control height, one 7px
          radius, one label style, two gap values (6 in-group / 18
          between groups), hairline rules between right-side clusters. */}
      <div className="kpi-tbar">
        {showChips && (
          <div className="kpi-tbar-grp" aria-label="Jump to group">
            <span className="kpi-tbar-lbl">Jump to</span>
            {chips.map(c => (
              <button
                key={c.key}
                type="button"
                className={`kpi-tbar-chip ${expandedPeriods?.has(c.jumpKey) ? "on" : ""}`}
                onClick={() => onJumpPeriod?.(c.jumpKey)}
              >{c.label}</button>
            ))}
          </div>
        )}
        <div className="kpi-tbar-grp">
          <button type="button" className="kpi-tbar-btn" onClick={onExpandAll}>Expand all</button>
          <button type="button" className="kpi-tbar-btn" onClick={onCollapseAll}>Collapse all</button>
        </div>
        <span className="kpi-tbar-spacer" aria-hidden="true" />
        {onWorkersChange && workerRoster && workerRoster.length > 0 && (
          <div className="kpi-tbar-grp">
            <WorkersFilter workerRoster={workerRoster} selectedWorkers={selectedWorkers} onWorkersChange={onWorkersChange} />
          </div>
        )}
        {onToggleRedact && (
          <>
            <span className="kpi-tbar-rule" aria-hidden="true" />
            <div className="kpi-empdisp">
              <span className="kpi-empdisp-lab">Show</span>
              <span className="kpi-seg" role="group" aria-label="Employee display">
                <button type="button" className={!redact ? "on" : ""} onClick={() => redact && onToggleRedact(false)} aria-pressed={!redact}>Names</button>
                <button type="button" className={redact ? "on" : ""} onClick={() => !redact && onToggleRedact(true)} aria-pressed={redact}>Numbers</button>
              </span>
            </div>
          </>
        )}
        <span className="kpi-tbar-rule" aria-hidden="true" />
        <div className="kpi-empdisp">
          {/* V25-12 - `Density` relabelled `Rows` (what it actually controls). */}
          <span className="kpi-empdisp-lab">Rows</span>
          <span className="kpi-seg" role="group" aria-label="Row density">
            <button type="button" className={!dense ? "on" : ""} onClick={() => commitDense(false)} aria-pressed={!dense}>Comfortable</button>
            <button type="button" className={dense ? "on" : ""} onClick={() => commitDense(true)} aria-pressed={dense}>Dense</button>
          </span>
        </div>
        <span className="kpi-tbar-rule" aria-hidden="true" />
        <HelpPop />
      </div>

      {scopeNote && (
        <div className="kpi-tbl-scope" role="note">{scopeNote}</div>
      )}
      <div className={`kpi-tbl-wrap ${dense ? "kpi-tbl-dense" : ""}`} ref={wrapRef}>
        <div className="kpi-tbl-scroll">
          <table className="kpi-tbl">
            <thead>
              <tr>
                <th className="kpi-tbl-lcol">
                  Week
                  {/* V25-19 - `Names hidden` chip sits on the WEEK header when
                      the table is in Numbers mode and worker rows are actually
                      visible. Clickable to restore names. Neutral treatment,
                      never amber. */}
                  {redact && mode === "single" && expandedWeeks.size > 0 && (
                    <button
                      type="button"
                      className="kpi-tbl-names-hidden"
                      onClick={() => onToggleRedact?.(false)}
                      aria-label="Names hidden - click to restore"
                    >Names hidden</button>
                  )}
                </th>
                <th className="kpi-tbl-vbcol">vs budget</th>
                {showShare && <th className="kpi-tbl-shrcol">Share</th>}
                <th>Hours</th>
                <th>OT 1.5&times;</th>
                {showHoliday && <th>Holiday 2&times;</th>}
                {showUnpriced && <th>Unpriced</th>}
                {showRate && <th>Rate</th>}
                <th>Dollars</th>
              </tr>
            </thead>
            <tbody>
              {periodTotals.map(({ g, totals, states, periodBudget, weeksInBand }) => {
                const inProgress = isPeriodInProgress(g, todayISO);
                const isMonth = g.groupHint?.kind === "month";
                const periodOpen = expandedPeriods.has(isMonth ? g.groupHint.monthIndex : g.period_no);
                const bandSeverity = worstSeverity(states);
                // Count of weeks with an exception (V9-3).
                const exceptionWeekCount = g.weeks.filter(w => weekSeverity(w) !== "complete").length;
                // `wk` / `wks` pluralization - defect: `1 wks` shipped
                // when a period had exactly one week of labor rows.
                const wkUnit = (n) => `${n} ${n === 1 ? "wk" : "wks"}`;
                // In-progress fraction: count period weeks whose bounds
                // are already closed vs today, +1 for the in-progress
                // week itself. For periods the divisor is always 4 (V8-9);
                // for months use weeksInBand (rows present in the range).
                const bandSubLabel = (() => {
                  if (inProgress) {
                    const totalWeeks = g.groupHint?.kind === "period" ? 4 : weeksInBand;
                    const closedCount = Math.max(0, Math.floor((new Date(todayISO) - new Date(periodStartISO(g.period_no))) / (7 * 86400000)));
                    const done = Math.min(totalWeeks, closedCount + 1);
                    return `in progress · ${done} of ${wkUnit(totalWeeks)}`;
                  }
                  return periodBudget != null
                    ? `${wkUnit(weeksInBand)} · budget ${fmt$(periodBudget)}`
                    : wkUnit(weeksInBand);
                })();
                const bandVs = periodBudget == null
                  ? { mode: "muted" }
                  : inProgress
                    ? { mode: "in_progress", spent: totals.amount, budget: periodBudget }
                    : { mode: "closed", spent: totals.amount, budget: periodBudget };
                const rate = blendedRate({ dollars: totals.amount, hours: totals.hours });
                const bandLabel = isMonth ? g.groupLabel : `FY2026 · PERIOD ${g.period_no}`;
                return (
                  <FragmentRows
                    key={g.key}
                    band={{
                      groupKey: g.key, isMonth, period_no: g.period_no,
                      monthIndex: g.groupHint?.kind === "month" ? g.groupHint.monthIndex : null,
                      label: bandLabel, subLabel: bandSubLabel,
                      totals, rate,
                      periodBudget, vs: bandVs,
                      exceptionWeekCount, inProgress, bandSeverity,
                    }}
                    weeks={g.weeks}
                    weekBudgetsByWeekStart={weekBudgetsByWeekStart}
                    memberByWeekAndAcct={memberByWeekAndAcct}
                    mode={mode}
                    workers={workers}
                    todayISO={todayISO}
                    expandedPeriods={expandedPeriods}
                    onTogglePeriod={onTogglePeriod}
                    expandedWeeks={expandedWeeks}
                    onToggleWeek={onToggleWeek}
                    onPickAccount={onPickAccount}
                    columns={{ showHoliday, showUnpriced, showRate, showShare }}
                    excludedSet={excludedSet}
                  />
                );
              })}
              <tr className="kpi-tbl-total">
                <td>{totalDesc}</td>
                <td>
                  <VsBudget
                    spent={grandTotal?.amount || 0}
                    budget={grandBudget}
                    mode={grandBudget == null ? "muted" : rangeAllInProgress ? "in_progress" : "closed"}
                  />
                </td>
                {showShare && <td className="kpi-tbl-shrcol" />}
                <td className="num">{fmtHrs((grandTotal?.hours_regular || 0) + (grandTotal?.hours_overtime || 0) + (grandTotal?.hours_double_time || 0))}</td>
                <td className="num">{(grandTotal?.hours_overtime || 0) > 0.004 ? fmtHrs(grandTotal.hours_overtime) : "–"}</td>
                {showHoliday && (
                  <td className="num">{(grandTotal?.hours_double_time || 0) > 0.004 ? fmtHrs(grandTotal.hours_double_time) : "–"}</td>
                )}
                {showUnpriced && (
                  <td className="num">{(grandTotal?.hours_without_dollars || 0) > 0.004 ? fmtHrs(grandTotal.hours_without_dollars) : "–"}</td>
                )}
                {showRate && (
                  <td className="num">{(() => {
                    const hrs = (grandTotal?.hours_regular || 0) + (grandTotal?.hours_overtime || 0) + (grandTotal?.hours_double_time || 0);
                    const r = blendedRate({ dollars: grandTotal?.amount || 0, hours: hrs });
                    return r != null ? `$${r.toFixed(2)}` : "–";
                  })()}</td>
                )}
                <td className="num">{fmt$(grandTotal?.amount || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// One period band + its weeks (+ their expanded children). Kept as a
// helper so periodTotals stays declarative.
function FragmentRows({
  band, weeks,
  weekBudgetsByWeekStart, memberByWeekAndAcct,
  mode, workers, todayISO,
  expandedPeriods, onTogglePeriod,
  expandedWeeks, onToggleWeek,
  onPickAccount,
  columns,
  excludedSet,
}) {
  const bandKey = band.isMonth ? band.monthIndex : band.period_no;
  const periodOpen = expandedPeriods.has(bandKey);
  const { showHoliday, showUnpriced, showRate, showShare } = columns;
  const rate = band.rate;

  return (
    <>
      <tr className="kpi-tbl-band">
        <td>
          <button
            type="button"
            className="kpi-tbl-bandbtn"
            onClick={() => onTogglePeriod?.(bandKey)}
            aria-expanded={periodOpen ? "true" : "false"}
          >
            <span className="kpi-tbl-chev">{periodOpen ? "⌄" : "›"}</span>
            {band.label}
            <span className="kpi-tbl-bandsub">{band.subLabel}</span>
            {band.exceptionWeekCount > 0 && (
              <span className="kpi-tbl-flag kpi-flag-warn">⚠ {band.exceptionWeekCount} week{band.exceptionWeekCount === 1 ? "" : "s"} unpriced</span>
            )}
          </button>
        </td>
        <td>
          <VsBudget spent={band.vs.spent} budget={band.vs.budget} mode={band.vs.mode} />
        </td>
        {showShare && <td className="kpi-tbl-shrcol" />}
        <td className="num">{fmtHrs(band.totals.hours)}</td>
        <td className={`num ${band.totals.ot > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{band.totals.ot > 0.004 ? fmtHrs(band.totals.ot) : "–"}</td>
        {showHoliday && <td className={`num ${band.totals.hol > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{band.totals.hol > 0.004 ? fmtHrs(band.totals.hol) : "–"}</td>}
        {showUnpriced && <td className={`num ${band.totals.unpriced > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{band.totals.unpriced > 0.004 ? fmtHrs(band.totals.unpriced) : "–"}</td>}
        {showRate && <td className="num">{rate != null ? `$${rate.toFixed(2)}` : "–"}</td>}
        <td className="num">{fmt$(band.totals.amount)}</td>
      </tr>
      {periodOpen && weeks.map(w => {
        const sev = weekSeverity(w);
        // V25-7 - in AGGREGATE mode, the week is an ancestor row: it
        // summarises the exception with a count chip and never carries
        // the amber edge itself. In SINGLE mode, the week IS the owning
        // row for its coverage exception, so it keeps the edge + chip.
        const isAttn = mode === "single" && sev !== "complete" && sev !== "no_labor";
        // Count member accounts in exception this week (aggregate mode).
        const perMember = memberByWeekAndAcct.get(w.week_start);
        let exceptionMemberCount = 0;
        if (mode === "aggregate" && perMember) {
          for (const [, agg] of perMember) {
            const memberSev = worstSeverity(agg.states);
            if (memberSev !== "complete" && memberSev !== "no_labor") exceptionMemberCount += 1;
          }
        }
        const inProgress = w.week_end >= todayISO && w.week_start <= todayISO;
        const isClosed = w.week_end < todayISO;
        const weekBudget = weekBudgetsByWeekStart.get(w.week_start)?.amount ?? null;
        const vs = weekBudget == null
          ? { mode: "muted" }
          : inProgress
            ? { mode: "in_progress", spent: w.amount, budget: weekBudget }
            : { mode: "closed", spent: w.amount, budget: weekBudget };
        const hrs = (w.hours_regular || 0) + (w.hours_overtime || 0) + (w.hours_double_time || 0);
        const rate = blendedRate({ dollars: w.amount, hours: hrs });
        const weekOpen = expandedWeeks.has(w.week_start);
        return (
          <>
            <tr key={w.week_start} className={`kpi-tbl-week ${isAttn ? "kpi-tbl-attn" : ""}`}>
              <td>
                <button
                  type="button"
                  className="kpi-tbl-weekbtn"
                  onClick={() => onToggleWeek?.(w.week_start)}
                  aria-expanded={weekOpen ? "true" : "false"}
                  data-wk={w.week_start}
                >
                  <span className="kpi-tbl-chev">{weekOpen ? "⌄" : "›"}</span>
                  {fmtDate(w.week_start)} – {fmtDate(w.week_end)}
                  <OTTag ot={w.hours_overtime} />
                  {mode === "single" && <ExceptionChip severity={sev} />}
                  {mode === "aggregate" && exceptionMemberCount > 0 && (
                    <span className="kpi-tbl-flag kpi-flag-warn">⚠ {exceptionMemberCount} site{exceptionMemberCount === 1 ? "" : "s"} unpriced</span>
                  )}
                </button>
              </td>
              <td><VsBudget spent={vs.spent} budget={vs.budget} mode={vs.mode} /></td>
              {showShare && <td className="kpi-tbl-shrcol" />}
              <td className="num">{fmtHrs(hrs)}</td>
              <td className={`num ${w.hours_overtime > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{w.hours_overtime > 0.004 ? fmtHrs(w.hours_overtime) : "–"}</td>
              {showHoliday && <td className={`num ${w.hours_double_time > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{w.hours_double_time > 0.004 ? fmtHrs(w.hours_double_time) : "–"}</td>}
              {showUnpriced && <td className={`num ${w.hours_without_dollars > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{w.hours_without_dollars > 0.004 ? fmtHrs(w.hours_without_dollars) : "–"}</td>}
              {showRate && <td className="num">{rate != null ? `$${rate.toFixed(2)}` : "–"}</td>}
              <td className="num">{fmt$(w.amount)}</td>
            </tr>
            {weekOpen && mode === "single" && workerChildrenForWeek(w, workers).map(c => (
              <ChildRow
                key={`${w.week_start}-${c.worker_id}`}
                child={c}
                weekAmount={w.amount}
                mode="worker"
                columns={columns}
                onPickAccount={null}
              />
            ))}
            {weekOpen && mode === "aggregate" && aggregateChildrenForWeek(w, weekBudgetsByWeekStart, memberByWeekAndAcct).map(c => (
              <ChildRow
                key={`${w.week_start}-${c.account_key}`}
                child={c}
                weekAmount={w.amount}
                mode="account"
                columns={columns}
                onPickAccount={onPickAccount}
                excludedFromRollup={excludedSet?.has(c.account_key)}
                weekInProgress={inProgress}
              />
            ))}
          </>
        );
      })}
    </>
  );
}

function ChildRow({ child, weekAmount, mode, columns, onPickAccount, excludedFromRollup, weekInProgress }) {
  const { showHoliday, showUnpriced, showRate, showShare } = columns;
  const sharePct = weekAmount > 0 ? Math.max(0, Math.min(100, (child.amount / weekAmount) * 100)) : 0;
  const rate = blendedRate({ dollars: child.amount, hours: child.hours });
  const label = mode === "worker"
    ? `#${child.number ?? ""} ${child.title || ""}`.trim()
    : child.account_key;
  const sev = child.coverage_state;
  const showExceptionChip = sev !== "complete" && sev !== "no_labor";
  // V25-5 - account rows carry a REAL vs-budget lockup, resolved per
  // member. Budget lives on the child in `week_budget` (from
  // `week_budgets[week].per_member`). Excluded rows (V25-2) read
  // `not budgeted` in muted text; rows with no budget for the range
  // read a muted `no budget` (no ghost bar - reads as zero).
  let vsBudgetCell;
  if (mode === "account") {
    if (excludedFromRollup) {
      vsBudgetCell = <td><span className="kpi-vb-d kpi-vb-d-mute kpi-tbl-notbudgeted">not budgeted</span></td>;
    } else if (child.week_budget != null && child.week_budget > 0) {
      const vs = weekInProgress
        ? { mode: "in_progress", spent: child.amount, budget: child.week_budget }
        : { mode: "closed", spent: child.amount, budget: child.week_budget };
      vsBudgetCell = <td><VsBudget spent={vs.spent} budget={vs.budget} mode={vs.mode} /></td>;
    } else {
      vsBudgetCell = <td><span className="kpi-vb-d kpi-vb-d-mute kpi-tbl-notbudgeted">no budget</span></td>;
    }
  } else {
    // Worker rows in single mode do not carry per-row vs-budget.
    vsBudgetCell = <td className="kpi-tbl-nil"><span className="kpi-vb-d kpi-vb-d-mute">–</span></td>;
  }
  // V25-7 - only the OWNING row carries the amber edge + warm tint.
  // In aggregate mode the child (account) IS the owning row for its
  // coverage exception. In single mode the child (worker) is a leaf
  // that doesn't carry an exception concept, so no tint on worker rows.
  const isOwningException = mode === "account" && showExceptionChip;
  return (
    <tr className={`kpi-tbl-child ${isOwningException ? "kpi-tbl-attn" : ""} ${excludedFromRollup ? "kpi-tbl-child-excluded" : ""}`}>
      <td>
        {mode === "account" && onPickAccount ? (
          <button type="button" className="kpi-tbl-accountbtn" onClick={() => onPickAccount?.(child.account_key)}>
            <span className="kpi-tbl-cchild-key">{child.account_key}</span>
            {showExceptionChip && <ExceptionChip severity={sev} />}
          </button>
        ) : (
          <span className="kpi-tbl-cchild-label">
            {label}
            <OTTag ot={child.hours_ot} />
            {showExceptionChip && <ExceptionChip severity={sev} />}
          </span>
        )}
      </td>
      {vsBudgetCell}
      {/* V25-6 Share column lives here, separate from Dollars. Filled
          only on account rows (worker rows in single mode leave it
          empty so the column alignment stays intact top to bottom). */}
      {showShare && (
        mode === "account" ? (
          <td className="kpi-tbl-shrcol">
            <span className="kpi-tbl-share2" aria-hidden="true"><i style={{ width: `${sharePct}%` }} /></span>
          </td>
        ) : (
          <td className="kpi-tbl-shrcol" />
        )
      )}
      <td className="num">{fmtHrs(child.hours)}</td>
      <td className={`num ${child.hours_ot > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{child.hours_ot > 0.004 ? fmtHrs(child.hours_ot) : "–"}</td>
      {showHoliday && <td className={`num ${child.hours_holiday > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{child.hours_holiday > 0.004 ? fmtHrs(child.hours_holiday) : "–"}</td>}
      {showUnpriced && <td className={`num ${child.hours_unpriced > 0.004 ? "kpi-tbl-ot" : "kpi-tbl-nil"}`}>{child.hours_unpriced > 0.004 ? fmtHrs(child.hours_unpriced) : "–"}</td>}
      {showRate && <td className="num">{rate != null ? `$${rate.toFixed(2)}` : "–"}</td>}
      <td className="num">{fmt$(child.amount)}</td>
    </tr>
  );
}
