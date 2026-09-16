"use client";
// src/app/kpi/overview/components/CurrentPeriodTable.js
//
// R-112 · Current period · two intersecting elements (Kevin 2026-09-16).
// Render of record: docs/renders/current-period-v2.html
//
// Structural restyle of the R-109 one-table view. The header row and
// the label column each start at grid-row/column 2 - the corner (col 1
// row 1) is nothing at all. Header bar + label bar + body panel are
// three separately-shadowed pieces. The current-week column lifts in a
// lighter blue (#24508C) than the command bar (#0A2548), with 12px
// clearance above so the range selector opens unobstructed.
//
// Section A ships in this PR: markup + CSS. No figure moves. The
// Rolling toggle from Section B lands in PR 2.
//
// Data sourcing (unchanged from R-109/R-111):
//   week revenue per week      week_rail.weeks[i].week_revenue
//   revenue basis              week_rail.weeks[i].revenue_basis
//   week state                 week_rail.weeks[i].state
//   period projection          cards[0].projected_period_revenue
//   period confirmed           cards[0].hero_actual
//   line target ratio          statement_rows[line].target_pct / 100
//   line adjusted (batr)       statement_rows[line].budget_at_this_revenue
//   3100 per-week landed       labor.board.weeks[i].spent
//   3200/3400 per-week landed  purchasing weekly[] + pending cards
//   today                      overview.todayISO (#1124)
//
// Guard 0: every new class name in this file's CSS carries the
// `.kpi-ov-cp-` prefix (probe: scripts/probes/_probe_cp_css_prefix.mjs).

import "../../current-period.css";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { rollingOf, summaryFor } from "./currentPeriodRolling";

const dollar0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");

function daysSinceStart(startISO, todayISO) {
  const t = new Date(todayISO + "T00:00:00Z").getTime();
  const s = new Date(startISO + "T00:00:00Z").getTime();
  return Math.floor((t - s) / 86400000) + 1;
}

// A2 · pill state derives from the week's state on the week rail
// plus the revenue basis flag (partly-confirmed forecast weeks).
function pillFor(w) {
  const st = w.state || "";
  if (st === "closed") return { cls: "kpi-ov-cp-pill-closed", label: "closed" };
  if (st === "in_progress") return { cls: "kpi-ov-cp-pill-current", label: "current" };
  if (w.revenue_basis === "partial") return { cls: "kpi-ov-cp-pill-pending", label: "pending" };
  return { cls: "kpi-ov-cp-pill-forecast", label: "forecast" };
}

// State drives the class on hcell/cell for shading (past/ahead/per).
function stateClass(w) {
  const st = w.state || "";
  if (st === "closed") return "kpi-ov-cp-past";
  if (st === "in_progress") return "";
  return "kpi-ov-cp-ahead";
}

// A4 · Revenue cell body. Confirmed/partial/forecast basis word leads
// the figure; Service Calendar and Service fee subs; partial-week
// footer prints "N of X services" when present.
function RevCellBody({ w, amount, labor, i }) {
  const basis = w.revenue_basis || "";
  const lbWk = (labor?.board?.weeks || [])[i] || null;
  const meals = Number(lbWk?.meal_revenue ?? w.meal_revenue ?? 0);
  const fee   = Number(lbWk?.fee_prorate  ?? w.fee_prorate  ?? 0);
  const conf  = Number(lbWk?.confirmed_services || 0);
  const totl  = Number(lbWk?.total_services || 0);
  const noteText = (basis === "partial" && totl > 0) ? `${conf} of ${totl} confirmed` : null;
  return (
    <>
      <div className="kpi-ov-cp-big"><span className="kpi-ov-cp-pre">{basis}</span>{dollar0(amount)}</div>
      <div className="kpi-ov-cp-sub">Service Calendar: <b>{dollar0(meals)}</b></div>
      <div className="kpi-ov-cp-sub" style={{ marginTop: 2 }}>Service fee: <b>{dollar0(fee)}</b></div>
      {noteText && <div className="kpi-ov-cp-vd kpi-ov-cp-mute">{noteText}</div>}
    </>
  );
}

// A4 · Cost cell body. Weeks not yet started: `to spend $X`. Started
// weeks: `spent $L of $G` on one line, then the bar, then the verdict
// line. "running hot" is gone - the red bar carries the verdict.
//
// Section B additions (Kevin § B, Kevin § C):
//   - `goalRolling` is the rolling budget for THIS week (differs from
//     `goal` when mode === "rolling" AND week is open); shown in the
//     "of $G" position on open weeks so the cell figure changes with
//     the toggle.
//   - `dlt` is the per-week delta (rolling[i] - plan[i]); rendered
//     as a fourth line "▼ $X less than plan" (trim red) or "▲ $Y
//     more than plan" (cushion green) on open weeks only, mode ===
//     "rolling" only.
//   - C3 (envelope exceeded, isC3): open weeks read "$0 to spend ·
//     already over" in red; plan-mode display is unchanged.
function CostCellBody({ w, goal, goalRolling, landed, isLabor, mode, dlt, isC3 }) {
  const isFuture = w.state === "not_started";
  const isClosed = w.state === "closed";
  const isNow = w.state === "in_progress";
  const l = Number(landed || 0);
  const gEffective = mode === "rolling" && !isClosed ? Number(goalRolling || 0) : Number(goal || 0);
  // C3 · open weeks clamp to $0 in Rolling; cell shows "already over".
  if (mode === "rolling" && isC3 && !isClosed) {
    return (
      <>
        <div className="kpi-ov-cp-big kpi-ov-cp-over">
          <span className="kpi-ov-cp-pre">to spend</span>{dollar0(0)}
        </div>
        <div className="kpi-ov-cp-vd kpi-ov-cp-over">already over</div>
      </>
    );
  }
  if (isFuture) {
    return (
      <>
        <div className="kpi-ov-cp-big"><span className="kpi-ov-cp-pre">to spend</span>{dollar0(gEffective)}</div>
        {mode === "rolling" && dlt != null && Math.abs(dlt) > 0 && (
          <div className={`kpi-ov-cp-dlt ${dlt < 0 ? "kpi-ov-cp-dlt-trim" : "kpi-ov-cp-dlt-cush"}`}>
            {dlt < 0 ? `▼ ${dollar0(-dlt)} less than plan` : `▲ ${dollar0(dlt)} more than plan`}
          </div>
        )}
      </>
    );
  }
  const g = gEffective;
  const over = l > g && g > 0;
  const pctBar = g > 0 ? Math.min(100, (l / g) * 100) : 0;
  const barColor = over ? "var(--red-600, #B9000C)" : "var(--green-600, #008330)";
  let verdictText, verdictClass;
  if (over) { verdictText = `▲ ${dollar0(l - g)} over`; verdictClass = "kpi-ov-cp-over"; }
  else if (isNow) { verdictText = `${dollar0(g - l)} left this week`; verdictClass = "kpi-ov-cp-good"; }
  else if (isClosed && !isLabor) { verdictText = `${dollar0(g - l)} left · still landing`; verdictClass = "kpi-ov-cp-mute"; }
  else { verdictText = `▼ ${dollar0(g - l)} under`; verdictClass = "kpi-ov-cp-good"; }
  return (
    <>
      <div className="kpi-ov-cp-big">
        <span className="kpi-ov-cp-pre">spent</span>{dollar0(l)}<small>of {dollar0(g)}</small>
      </div>
      <div className="kpi-ov-cp-bar" style={{ marginBottom: 4 }}>
        <i style={{ width: `${pctBar}%`, background: barColor }} />
      </div>
      <div className={`kpi-ov-cp-vd ${verdictClass}`}>{verdictText}</div>
      {mode === "rolling" && !isClosed && dlt != null && Math.abs(dlt) > 0 && (
        <div className={`kpi-ov-cp-dlt ${dlt < 0 ? "kpi-ov-cp-dlt-trim" : "kpi-ov-cp-dlt-cush"}`}>
          {dlt < 0 ? `▼ ${dollar0(-dlt)} less than plan` : `▲ ${dollar0(dlt)} more than plan`}
        </div>
      )}
    </>
  );
}

// Period-column body · revenue (A4).
function PerRevCellBody({ projection, confirmed, dayFrac }) {
  const p = projection > 0 ? Math.min(100, (confirmed / projection) * 100) : 0;
  return (
    <>
      <div className="kpi-ov-cp-big">{dollar0(projection)}<small>projecting</small></div>
      <div className="kpi-ov-cp-bar">
        <i style={{ width: `${p}%`, background: "var(--green-600, #008330)" }} />
        <span className="kpi-ov-cp-clk" style={{ left: `${Math.round(dayFrac * 100)}%` }} />
      </div>
      <div className="kpi-ov-cp-sub"><b>{dollar0(confirmed)}</b> confirmed · {Math.round(p)}% of period</div>
    </>
  );
}

// Period-column body · cost (A4). Prompt: `$X left of $Y` leads, then
// the bar, then `Z% used · $L landed`. `running hot` is gone; the bar
// colour carries the verdict.
function PerCostCellBody({ envelope, landed, dayFrac }) {
  const G = Number(envelope || 0);
  const L = Number(landed || 0);
  const usedPct = G > 0 ? Math.round(Math.min(100, (L / G) * 100)) : 0;
  const hot = G > 0 && (L / G) > (dayFrac + 0.005);
  const barColor = hot ? "var(--red-600, #B9000C)" : "var(--green-600, #008330)";
  return (
    <>
      <div className={`kpi-ov-cp-big${hot ? " kpi-ov-cp-over" : ""}`}>
        {dollar0(G - L)}<small>left of {dollar0(G)}</small>
      </div>
      <div className="kpi-ov-cp-bar">
        <i style={{ width: `${usedPct}%`, background: barColor }} />
        <span className="kpi-ov-cp-clk" style={{ left: `${Math.round(dayFrac * 100)}%` }} />
      </div>
      <div className={`kpi-ov-cp-sub${hot ? " kpi-ov-cp-over" : ""}`}>{usedPct}% used · <b>{dollar0(L)}</b> landed</div>
    </>
  );
}

// Hook · position .kpi-ov-cp-lift and .kpi-ov-cp-liftbody so the lifted
// current-week column overhangs the header top by 12px and the last
// row bottom by 12px, with 7px of horizontal breathing room per side.
// Runs on layout mount + on window resize; ResizeObserver watches the
// grid so a font-load reflow re-runs it.
function useLift(ready) {
  const [box, setBox] = useState(null);
  // Callback ref so we can re-run compute whenever the grid actually
  // mounts. The component returns an empty-state div before labor +
  // purch land, so gridRef.current is null on first render; useLayout
  // Effect keyed on a static ref does not re-run when the grid finally
  // mounts. `ready` is the payload/labor/purch-loaded flag - when it
  // flips true and the grid renders, this effect re-runs.
  const gridRef = useRef(null);
  useLayoutEffect(() => {
    const g = gridRef.current;
    if (!g || !ready) { setBox(null); return; }
    const compute = () => {
      const h = g.querySelector(".kpi-ov-cp-hcell.kpi-ov-cp-now");
      const cs = g.querySelectorAll(".kpi-ov-cp-cell.kpi-ov-cp-now");
      if (!h || cs.length === 0) { setBox(null); return; }
      const last = cs[cs.length - 1];
      const gr = g.getBoundingClientRect();
      const hr = h.getBoundingClientRect();
      const lr = last.getBoundingClientRect();
      const L = hr.left - gr.left - 7;
      const W = hr.width + 14;
      const T = hr.top - gr.top - 12;
      const B = lr.bottom - gr.top + 12;
      const bodyTop = hr.bottom - gr.top;
      const bodyHeight = B - bodyTop - 7;
      setBox({ L, W, T, H: B - T, bodyTop, bodyHeight });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(g);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [ready]);
  return { box, gridRef };
}

export default function CurrentPeriodTable({ payload, labor, purch, error, rowSet = "overview" }) {
  const weeks = payload?.week_rail?.weeks || [];

  const derived = useMemo(() => {
    if (weeks.length !== 4) return null;
    const stmtByLine = new Map((payload?.statement_rows || []).map(r => [r.line_code, r]));
    const revCard = (payload?.cards || [])[0] || null;

    const goalFor = (line) => {
      const row = stmtByLine.get(line);
      if (!row) return { goal: [null, null, null, null], sum: 0, batr: 0 };
      const ratio = Number(row.target_pct || 0) / 100;
      const g = weeks.map(w => Number(w.week_revenue || 0) * ratio);
      const sub1 = stmtByLine.get("3100.1");
      const sub2 = stmtByLine.get("3100.2");
      if (line === "3100" && sub1 && sub2) {
        // R-111 · per-week goal for 3100 in the salary view is
        // `week_revenue × 3100.1 target_pct + 3100.2 period_budget / 4`,
        // never the composed 3100 target_pct times revenue. That combined
        // percent is a display figure - multiplying it against per-week
        // revenue bakes a fixed cost into a proportional calc.
        const hourlyRatio = Number(sub1.target_pct || 0) / 100;
        const salaryPerWeek = Number(sub2.period_budget || 0) / 4;
        const gs = weeks.map(w => Number(w.week_revenue || 0) * hourlyRatio + salaryPerWeek);
        return { goal: gs, sum: gs.reduce((s, v) => s + v, 0), batr: Number(row.budget_at_this_revenue || 0) };
      }
      return { goal: g, sum: g.reduce((s, v) => s + v, 0), batr: Number(row.budget_at_this_revenue || 0) };
    };

    const landedFor = (line) => {
      if (line === "3100") {
        const lbWks = labor?.board?.weeks || [];
        const byStart = new Map(lbWks.map(w => [w.week_start, Number(w.spent || 0)]));
        return weeks.map(w => Number(byStart.get(w.week_start) || 0));
      }
      const wkStartSet = weeks.map(w => w.week_start);
      const codedByWeek = new Array(weeks.length).fill(0);
      for (const row of (purch?.weekly || [])) {
        const gl = String(row.gl_line_code || "");
        if (!gl.startsWith(line)) continue;
        const idx = wkStartSet.indexOf(row.week_start);
        if (idx >= 0) codedByWeek[idx] += Number(row.amount || 0);
      }
      if (line === "3200") {
        const pending = purch?.card_charges?.rows || [];
        for (const c of pending) {
          const t = String(c.txn_date || "");
          const idx = weeks.findIndex(w => t >= (w.week_start || "") && t <= (w.week_end || ""));
          if (idx >= 0) codedByWeek[idx] += Number(c.amount || 0);
        }
      }
      return codedByWeek;
    };

    const rev = weeks.map(w => Number(w.week_revenue || 0));
    const revProj = Number(revCard?.projected_period_revenue || 0);
    const revConf = Number(revCard?.hero_actual || 0);

    const salaryPath = stmtByLine.get("3100.1") != null && stmtByLine.get("3100.2") != null;
    const laborPct = Number(stmtByLine.get("3100")?.target_pct || 0).toFixed(2);
    const laborSub = salaryPath ? `labor · ${laborPct}% of revenue` : `hourly · ${laborPct}% of revenue`;

    const ROWS_OVERVIEW = [
      { line: null, name: "Revenue", sub: "meals + service fee", rev: true },
      { line: "3100", name: "Kitchen labor", sub: laborSub, isLabor: true },
      { line: "3200", name: "Food",      sub: `${(stmtByLine.get("3200")?.target_pct || 0).toFixed(2)}% of revenue` },
      { line: "3400", name: "Packaging", sub: `${(stmtByLine.get("3400")?.target_pct || 0).toFixed(2)}% of revenue` },
    ];
    const ROWS_LABOR = [
      { line: null, name: "Revenue", sub: "what each week earns", rev: true },
      { line: "3100", name: "Hourly labor", sub: laborSub, isLabor: true },
    ];
    const ROWS_PURCHASING = [
      { line: null, name: "Revenue", sub: "what you are ordering for", rev: true },
      { line: "3200", name: "Food",      sub: `${(stmtByLine.get("3200")?.target_pct || 0).toFixed(2)}% of revenue` },
      { line: "3400", name: "Packaging", sub: `${(stmtByLine.get("3400")?.target_pct || 0).toFixed(2)}% of revenue` },
    ];
    const rows =
        rowSet === "labor"      ? ROWS_LABOR
      : rowSet === "purchasing" ? ROWS_PURCHASING
      :                           ROWS_OVERVIEW;

    return { rows, rev, revProj, revConf, stmtByLine, goalFor, landedFor };
  }, [payload, weeks, labor, purch, rowSet]);

  const ready = !!(derived && labor && purch && !error);
  const { box: liftBox, gridRef } = useLift(ready);

  // Section B · mode state. PLAN is default. C4 (future range) does
  // not reach this component - the parent gate never mounts the CP
  // table on a future range - so no explicit C4 handling here.
  const [mode, setMode] = useState("plan");

  if (weeks.length !== 4) {
    return <div className="kpi-ov-cp-empty" role="status">Waiting for week rail…</div>;
  }
  if (error) {
    return <div className="kpi-ov-cp-empty" role="alert">Labor / Purchasing did not load: {error}</div>;
  }
  if (!labor || !purch) {
    return <div className="kpi-ov-cp-empty" role="status">Loading board figures…</div>;
  }

  const todayISO = payload?.todayISO || new Date().toISOString().slice(0, 10);
  const periodStart = weeks[0]?.week_start;
  const day = daysSinceStart(periodStart, todayISO);
  const dayFrac = Math.max(0, Math.min(1, day / 28));

  const total = derived.rows.length;
  const end = 2 + 2 * total;

  // Section B · precompute rolling data per cost line. `closedFlags`
  // and `weekRev` are shared across every line. `perLine[line]` gives
  // { plan, rolling, landed, envelope, summary, isC1, isC2, isC3 };
  // the map runs in both PLAN and ROLLING modes so the summary card
  // has the same numbers to display in either state (though it only
  // renders in ROLLING). C1 renders the same figures in both modes
  // by definition (no closed weeks -> rolling == plan).
  const closedFlags = weeks.map(w => (w.state || "") === "closed");
  const currentIdx = weeks.findIndex(w => (w.state || "") === "in_progress");
  const perLine = new Map();
  for (const row of derived.rows) {
    if (row.rev) continue;
    const gi = derived.goalFor(row.line);
    const landed = derived.landedFor(row.line);
    const rr = rollingOf(gi.goal, landed, gi.batr, closedFlags, derived.rev);
    const sm = summaryFor(gi.goal, rr.rolling, closedFlags, currentIdx);
    perLine.set(row.line, {
      plan: gi.goal,
      rolling: rr.rolling,
      landed,
      envelope: gi.batr,
      actual: landed.reduce((s, v) => s + v, 0),
      isC1: rr.isC1,
      isC2: rr.isC2,
      isC3: rr.isC3,
      totalDelta: sm.totalDelta,
      thisWeekDelta: sm.thisWeekDelta,
      trim: sm.trim,
      name: row.name,
      isLabor: row.isLabor,
    });
  }
  // All cost lines share the same closed/open pattern; pick any line's
  // isC1/isC2 for card-level decisions (the status strip and the
  // rollcard's empty-state fallback).
  const anyLine = perLine.size ? perLine.values().next().value : null;
  const isC1 = anyLine ? anyLine.isC1 : false;
  const isC2 = anyLine ? anyLine.isC2 : false;

  // Period metadata for the status strip ("P10 · week 2 of 4 · day 10
  // of 28 · closes 10/04"). Week number reads the current-week index
  // + 1; closes date is the last week's week_end.
  const periodNo = payload?.range?.period_no ?? weeks[0]?.period_no ?? null;
  const wkOfPeriod = currentIdx >= 0 ? currentIdx + 1 : null;
  const closesDate = weeks[3]?.week_end || "";
  const closesLabel = closesDate.slice(5).replace(/-/, "/");
  const statusSub = [
    periodNo != null && <><b>P{periodNo}</b></>,
    wkOfPeriod && ` · week ${wkOfPeriod} of 4`,
    day > 0 && ` · day ${day} of 28`,
    closesLabel && ` · closes ${closesLabel}`,
  ].filter(Boolean);

  return (
    <>
      {/* Section B · status strip + PLAN / ROLLING toggle. PLAN
          default. Toggle stays enabled on C1 (Kevin: "a chef
          switching to it and finding it greyed out learns nothing"). */}
      <div className="kpi-ov-cp-status">
        <span className="kpi-ov-cp-stpill">Period running</span>
        <span className="kpi-ov-cp-status-sub">{statusSub.map((s, i) => <Fragment key={i}>{s}</Fragment>)}</span>
        <span className="kpi-ov-cp-status-ml" />
        <span className="kpi-ov-cp-seg" role="group" aria-label="Budget mode">
          <button
            type="button"
            className={mode === "plan" ? "kpi-ov-cp-seg-on" : ""}
            onClick={() => setMode("plan")}
            aria-pressed={mode === "plan"}
          >PLAN</button>
          <button
            type="button"
            className={mode === "rolling" ? "kpi-ov-cp-seg-on" : ""}
            onClick={() => setMode("rolling")}
            aria-pressed={mode === "rolling"}
          >ROLLING</button>
        </span>
      </div>
    <div className="kpi-ov-cp-card kpi-ov-cp-t-navy" data-r112-card="1">
      <div
        ref={gridRef}
        className="kpi-ov-cp-grid"
        style={{ gridTemplateRows: `auto repeat(${2 * total}, auto)` }}
      >
        {/* Backgrounds. The corner (col 1, row 1) is intentionally
            empty - the page shows through. Hit-test at corner must
            return the page, not a table element. */}
        <div className="kpi-ov-cp-hbar" />
        <div className="kpi-ov-cp-lbar" style={{ gridRow: `2 / ${end}` }} />
        <div className="kpi-ov-cp-bpanel" style={{ gridRow: `2 / ${end}` }} />

        {/* Header row (A2). WK N + pill + date + `day n of 7` on the
            current week; no progress bar. */}
        {weeks.map((w, i) => {
          const p = pillFor(w);
          const st = stateClass(w);
          const isNow = w.state === "in_progress";
          const wkNo = i + 1;
          const dayInWeek = Math.max(0, Math.min(7, day - 7 * (wkNo - 1)));
          const cls = [
            "kpi-ov-cp-hcell",
            st && st,
            isNow && "kpi-ov-cp-now",
            i === 0 && "kpi-ov-cp-firstwk",
          ].filter(Boolean).join(" ");
          const dt = `${(w.week_start || "").slice(5).replace(/-/, "/")} – ${(w.week_end || "").slice(5).replace(/-/, "/")}`;
          return (
            <div key={`h-${w.week_start}`} className={cls} style={{ gridColumn: i + 2 }}>
              <div className="kpi-ov-cp-hcl1">
                <span className="kpi-ov-cp-wk">WK {wkNo}</span>
                <span className={`kpi-ov-cp-pill ${p.cls}`}>{p.label}</span>
              </div>
              <div className="kpi-ov-cp-hcl2">{dt}{isNow && dayInWeek > 0 ? <> · <b>day {dayInWeek} of 7</b></> : null}</div>
            </div>
          );
        })}
        <div className="kpi-ov-cp-hcell kpi-ov-cp-per" style={{ gridColumn: 6 }}>
          <div className="kpi-ov-cp-hcl1">
            <span className="kpi-ov-cp-wk">Period</span>
            <span className="kpi-ov-cp-pill kpi-ov-cp-pill-navy">what is left</span>
          </div>
          <div className="kpi-ov-cp-hcl2">{Math.round(dayFrac * 100)}% of the period gone</div>
        </div>

        {/* Data rows. Row separators run full width across the label
            column and the body panel (rowline + lline at the same
            grid-row for cost rows; revenue only gets the rowline
            because the label column has no separator above row 1). */}
        {derived.rows.map((row, ri) => {
          const isRev = ri === 0;
          const isLast = ri === derived.rows.length - 1;
          const rlabGr = 3 + 2 * ri;
          const sepGr = rlabGr - 1;
          const goalInfo = isRev ? null : derived.goalFor(row.line);
          const landed  = isRev ? null : derived.landedFor(row.line);
          const actual  = isRev ? 0 : landed.reduce((s, v) => s + v, 0);
          return (
            <Fragment key={row.line || "rev"}>
              {/* Separators before this row's rlab/cells. */}
              <div className="kpi-ov-cp-rowline" style={{ gridRow: sepGr }} />
              {!isRev && <div className="kpi-ov-cp-lline" style={{ gridRow: sepGr }} />}
              {/* Row label (col 1). */}
              <div
                className={[
                  "kpi-ov-cp-rlab",
                  isRev && "kpi-ov-cp-rlab-rev",
                  ri === 0 && "kpi-ov-cp-firstrow",
                  isLast && "kpi-ov-cp-lastrow",
                ].filter(Boolean).join(" ")}
                style={{ gridRow: rlabGr }}
              >
                <div className="kpi-ov-cp-rn">
                  {row.line && <span className="kpi-ov-cp-glc">{row.line}</span>}{row.name}
                </div>
                <div className="kpi-ov-cp-rg">{row.sub}</div>
              </div>
              {/* Week cells (cols 2..5). */}
              {weeks.map((w, i) => {
                const st = stateClass(w);
                const isNow = w.state === "in_progress";
                const cls = [
                  "kpi-ov-cp-cell",
                  st,
                  isNow && "kpi-ov-cp-now",
                ].filter(Boolean).join(" ");
                return (
                  <div key={`c-${row.line || "rev"}-${i}`} className={cls} style={{ gridColumn: i + 2, gridRow: rlabGr }}>
                    {isRev
                      ? <RevCellBody w={w} amount={derived.rev[i]} labor={labor} i={i} />
                      : (() => {
                          const pl = perLine.get(row.line);
                          const dlt = pl ? (pl.rolling[i] - pl.plan[i]) : 0;
                          return (
                            <CostCellBody
                              w={w}
                              goal={goalInfo.goal[i]}
                              goalRolling={pl ? pl.rolling[i] : goalInfo.goal[i]}
                              landed={landed[i]}
                              isLabor={row.isLabor}
                              mode={mode}
                              dlt={dlt}
                              isC3={pl ? pl.isC3 : false}
                            />
                          );
                        })()}
                  </div>
                );
              })}
              {/* Period cell (col 6). */}
              <div
                className={[
                  "kpi-ov-cp-cell",
                  "kpi-ov-cp-per",
                  isLast && "kpi-ov-cp-lastrow",
                ].filter(Boolean).join(" ")}
                style={{ gridColumn: 6, gridRow: rlabGr }}
              >
                {isRev
                  ? <PerRevCellBody projection={derived.revProj} confirmed={derived.revConf} dayFrac={dayFrac} />
                  : <PerCostCellBody envelope={goalInfo.batr} landed={actual} dayFrac={dayFrac} />}
              </div>
            </Fragment>
          );
        })}

        {/* Lifted current-week column (A3). Positioned absolutely so
            the top edge overhangs the header by 12px and the bottom
            edge overhangs the last row by 12px. Sits behind the .now
            cells (z-index 10/11 vs 12). */}
        {liftBox && (
          <>
            <div
              className="kpi-ov-cp-lift"
              style={{ left: liftBox.L, top: liftBox.T, width: liftBox.W, height: liftBox.H }}
            />
            <div
              className="kpi-ov-cp-liftbody"
              style={{ left: liftBox.L, top: liftBox.bodyTop, width: liftBox.W, height: liftBox.bodyHeight, borderRadius: "0 0 13px 13px" }}
            />
          </>
        )}
      </div>
    </div>
    {/* Section B · summary card. Rolling mode only. Sits below the
        table + above `Needs review today`. One column per cost line
        (Overview 3, Labor 1, Purchasing 2). C1 replaces the columns
        with a single line reading "nothing to redistribute yet".
        C2 (one open week) prints only the total, since of-it-this-
        week equals the total by construction. C3 (envelope over)
        prints "already past the envelope · nothing left to spend"
        in red. */}
    {mode === "rolling" && perLine.size > 0 && (
      <div className="kpi-ov-cp-rollcard">
        <div className="kpi-ov-cp-rollcard-t">To land the period on budget</div>
        <div className="kpi-ov-cp-rollcard-lead">
          Each open week now carries <b>its share of what is left</b>, not its own plan. Closed weeks do not move.
        </div>
        {isC1 ? (
          <div className="kpi-ov-cp-rollcard-empty">
            <b>Nothing to redistribute yet</b> · week 1 is still running.
          </div>
        ) : (
          <div
            className="kpi-ov-cp-rollcard-lines"
            style={{ gridTemplateColumns: `repeat(${perLine.size}, minmax(0, 1fr))` }}
          >
            {[...perLine.values()].map((pl, i) => {
              if (pl.isC3) {
                return (
                  <div key={pl.name + "-" + i} className="kpi-ov-cp-rollcard-ln">
                    <div className="kpi-ov-cp-rollcard-ln-nm">{pl.name}</div>
                    <div className="kpi-ov-cp-rollcard-ln-v kpi-ov-cp-rollcard-ln-v-trim">
                      ▼ {dollar0(-pl.totalDelta)} over the period
                    </div>
                    <div className="kpi-ov-cp-rollcard-ln-s">
                      already past the envelope · nothing left to spend
                    </div>
                  </div>
                );
              }
              const trim = pl.trim;
              const arrow = trim ? "▼" : "▲";
              const totalAbs = Math.abs(pl.totalDelta);
              const thisAbs = Math.abs(pl.thisWeekDelta);
              return (
                <div key={pl.name + "-" + i} className="kpi-ov-cp-rollcard-ln">
                  <div className="kpi-ov-cp-rollcard-ln-nm">{pl.name}</div>
                  <div className={`kpi-ov-cp-rollcard-ln-v ${trim ? "kpi-ov-cp-rollcard-ln-v-trim" : "kpi-ov-cp-rollcard-ln-v-cush"}`}>
                    {arrow} {dollar0(totalAbs)}
                  </div>
                  {isC2 ? (
                    <div className="kpi-ov-cp-rollcard-ln-s">
                      {trim ? "to trim across" : "of cushion across"} the open week
                    </div>
                  ) : (
                    <div className="kpi-ov-cp-rollcard-ln-s">
                      {trim ? "to trim" : "of cushion"} across the open weeks · <b>{dollar0(thisAbs)}</b> of it this week
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}
    </>
  );
}
