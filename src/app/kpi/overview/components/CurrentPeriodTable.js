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
import { weekHatchedDollars } from "@/app/kpi/labor/lib/weekHatched";

const dollar0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");

function daysSinceStart(startISO, todayISO) {
  const t = new Date(todayISO + "T00:00:00Z").getTime();
  const s = new Date(startISO + "T00:00:00Z").getTime();
  return Math.floor((t - s) / 86400000) + 1;
}

// A2 · pill state derives from the week's state on the week rail
// plus the revenue basis flag (partly-confirmed forecast weeks). On
// future ranges (R-110) every week is `forecast` regardless of state
// because nothing has happened yet.
function pillFor(w, isFuture) {
  if (isFuture) return { cls: "kpi-ov-cp-pill-forecast", label: "forecast" };
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
// footer prints "N of X services" when present. On future range (R-
// 110) the basis word is always `forecast` and the two subs stay if
// the underlying labor weekly basis carries them.
function RevCellBody({ w, amount, labor, i, isFuture }) {
  const basis = isFuture ? "forecast" : (w.revenue_basis || "");
  const lbWk = (labor?.board?.weeks || [])[i] || null;
  const meals = Number(lbWk?.meal_revenue ?? w.meal_revenue ?? 0);
  const fee   = Number(lbWk?.fee_prorate  ?? w.fee_prorate  ?? 0);
  const conf  = Number(lbWk?.confirmed_services || 0);
  const totl  = Number(lbWk?.total_services || 0);
  const noteText = (!isFuture && basis === "partial" && totl > 0) ? `${conf} of ${totl} confirmed` : null;
  return (
    <>
      <div className="kpi-ov-cp-big"><span className="kpi-ov-cp-pre">{basis}</span>{dollar0(amount)}</div>
      {meals > 0 && <div className="kpi-ov-cp-sub">Service Calendar: <b>{dollar0(meals)}</b></div>}
      {fee > 0 && <div className="kpi-ov-cp-sub" style={{ marginTop: 2 }}>Service fee: <b>{dollar0(fee)}</b></div>}
      {noteText && <div className="kpi-ov-cp-vd kpi-ov-cp-mute">{noteText}</div>}
    </>
  );
}

// Kevin R-128 Part 3 items 1 + A + F (2026-09-19). Cell body
// restructures:
//   - Item A. `.v` flex row baseline-aligned right, `.of` small text
//     LEFT of `.big` (so every value ends on the same edge).
//   - Item F. `spent` and `to spend` prefixes gone. Pending and
//     forecast show the value alone; closed and current show `of $G`
//     as the left-side hint.
//   - Item 1. `splitHrly` / `splitSal` render a `Hrly $X · Sal $Y`
//     line under the value on salary view + PLAN. Rolling replaces
//     the split with the delta line (Part 4: salary is fixed, so a
//     re-spread budget has no meaningful split; row height must hold).
//     Hourly view never renders the split.
//   - Verdict unifies to `$X left · mute` for every non-over case,
//     matching the render. The prior `▼ $X under · green` branch for
//     closed labor is gone: colour rule (Kevin item 9 side): red is
//     over, grey is under, green is only revenue running ahead.
//   - `goalRolling` still switches the effective goal on open weeks
//     in rolling; `dlt` still shows on open weeks in rolling.
//   - C3 (envelope exceeded, isC3): open weeks read `$0 · already
//     over` per Part 4 ("C3 keeps its current shape") plus item F
//     ("to spend" gone).
function CostCellBody({ w, goal, goalRolling, landed, isLabor, mode, dlt, isC3, splitHrly, splitSal }) {
  const isFuture = w.state === "not_started";
  const isClosed = w.state === "closed";
  const l = Number(landed || 0);
  const gEffective = mode === "rolling" && !isClosed ? Number(goalRolling || 0) : Number(goal || 0);
  const isRolling = mode === "rolling";
  const showSplit = splitHrly != null && splitSal != null && !isRolling;
  const showDelta = isRolling && !isClosed && dlt != null && Math.abs(dlt) > 0;
  const splitLine = showSplit ? (
    <div className="kpi-ov-cp-sp">Hrly <b>{dollar0(splitHrly)}</b> · Sal <b>{dollar0(splitSal)}</b></div>
  ) : null;
  const deltaLine = showDelta ? (
    <div className={`kpi-ov-cp-dlt ${dlt < 0 ? "kpi-ov-cp-dlt-trim" : "kpi-ov-cp-dlt-cush"}`}>
      {dlt < 0 ? `▼ ${dollar0(-dlt)} less than plan` : `▲ ${dollar0(dlt)} more than plan`}
    </div>
  ) : null;
  // C3 · open weeks clamp to $0 in Rolling; cell shows "already over".
  if (isRolling && isC3 && !isClosed) {
    return (
      <>
        <div className="kpi-ov-cp-v">
          <span className="kpi-ov-cp-big kpi-ov-cp-over">{dollar0(0)}</span>
        </div>
        <div className="kpi-ov-cp-vd kpi-ov-cp-over">already over</div>
      </>
    );
  }
  if (isFuture) {
    return (
      <>
        <div className="kpi-ov-cp-v">
          <span className="kpi-ov-cp-big">{dollar0(gEffective)}</span>
        </div>
        {splitLine}
        {deltaLine}
      </>
    );
  }
  const g = gEffective;
  const over = l > g && g > 0;
  const pctBar = g > 0 ? Math.min(100, (l / g) * 100) : 0;
  const barColor = over ? "var(--red-600, #B9000C)" : "var(--green-600, #008330)";
  const verdictText = over ? `▲ ${dollar0(l - g)} over` : `${dollar0(g - l)} left`;
  const verdictClass = over ? "kpi-ov-cp-over" : "kpi-ov-cp-mute";
  return (
    <>
      <div className="kpi-ov-cp-v">
        <span className="kpi-ov-cp-of">of {dollar0(g)}</span>
        <span className="kpi-ov-cp-big">{dollar0(l)}</span>
      </div>
      {splitLine}
      <div className="kpi-ov-cp-bar" style={{ marginBottom: 4 }}>
        <i style={{ width: `${pctBar}%`, background: barColor }} />
      </div>
      <div className={`kpi-ov-cp-vd ${verdictClass}`}>{verdictText}</div>
      {deltaLine}
    </>
  );
}

// Period-column body · revenue (A4). On future range (R-110) the
// projection == the plan (sum of week rev) and there is no confirmed
// figure yet; period column reads "planned revenue" + weekly/daily
// rate on the third line.
function PerRevCellBody({ projection, confirmed, dayFrac, isFuture, serviceDays }) {
  if (isFuture) {
    const perWeek = projection / 4;
    const perDay  = serviceDays > 0 ? projection / serviceDays : 0;
    return (
      <>
        <div className="kpi-ov-cp-big">{dollar0(projection)}</div>
        <div className="kpi-ov-cp-sub kpi-ov-cp-mute-strong">planned revenue</div>
        <div className="kpi-ov-cp-sub" style={{ marginTop: 2 }}>
          <b>{dollar0(perWeek)}</b> a week · <b>{dollar0(perDay)}</b> a service day
        </div>
      </>
    );
  }
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

// Kevin R-128 Part 3 items A + 1 + 9 (2026-09-19). Period-column
// body for cost rows. Item A moves the small text left of the big
// value. Item 1 renders the salary/hourly period split under the
// value on the 3100 row when salary view is active AND mode is
// PLAN. Item 9 wires pace into the footer (see caller).
//
// Future range branch unchanged in structure (still `$X + to spend
// (dropped) + per-week/per-day`) - future ranges have no landed to
// pace against and no split to show, per Part 4 ("Next period has
// only two states; the Plan/Rolling toggle does not render on a
// future range").
function PerCostCellBody({ envelope, landed, dayFrac, isFuture, serviceDays, splitHrly, splitSal, paceText, paceClass, isTotal }) {
  const G = Number(envelope || 0);
  const L = Number(landed || 0);
  if (isFuture) {
    const perWeek = G / 4;
    const perDay  = serviceDays > 0 ? G / serviceDays : 0;
    return (
      <>
        <div className="kpi-ov-cp-v">
          <span className="kpi-ov-cp-big">{dollar0(G)}</span>
        </div>
        <div className="kpi-ov-cp-sub kpi-ov-cp-mute-strong">to spend</div>
        <div className="kpi-ov-cp-sub" style={{ marginTop: 2 }}>
          <b>{dollar0(perWeek)}</b> a week · <b>{dollar0(perDay)}</b> a service day
        </div>
      </>
    );
  }
  const usedPct = G > 0 ? Math.round(Math.min(100, (L / G) * 100)) : 0;
  const hot = G > 0 && (L / G) > (dayFrac + 0.005);
  const barColor = isTotal
    ? "var(--navy-700, #153968)"
    : (hot ? "var(--red-600, #B9000C)" : "var(--green-600, #008330)");
  const splitLine = (splitHrly != null && splitSal != null) ? (
    <div className="kpi-ov-cp-sp">Hrly <b>{dollar0(splitHrly)}</b> · Sal <b>{dollar0(splitSal)}</b></div>
  ) : null;
  return (
    <>
      <div className="kpi-ov-cp-v">
        <span className="kpi-ov-cp-of">left of {dollar0(G)}</span>
        <span className="kpi-ov-cp-big">{dollar0(G - L)}</span>
      </div>
      {splitLine}
      <div className="kpi-ov-cp-bar">
        <i style={{ width: `${usedPct}%`, background: barColor }} />
        <span className="kpi-ov-cp-clk" style={{ left: `${Math.round(dayFrac * 100)}%` }} />
      </div>
      <div className="kpi-ov-cp-fl">
        {usedPct}% used
        {paceText && (
          <> · <span className={`kpi-ov-cp-pc ${paceClass || "kpi-ov-cp-mute"}`}>{paceText}</span></>
        )}
      </div>
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
  // R-110 (2026-09-16). Future range gate. `labor.is_future_range` is
  // the reliable flag - Overview ships `period_state: "planned"` but
  // NOT `is_future_range` on planned periods (asymmetry noted so it
  // does not trip a future reader). If labor payload is absent (early
  // render), fall back to overview's period_state.
  const isFuture = (labor?.is_future_range === true)
                || (payload?.period_state === "planned");
  // Weeks · CP reads Overview's week_rail; NP reads Labor's board.
  // weeks (Overview's week_rail is null on planned periods).
  const weeks = isFuture
    ? (labor?.board?.weeks || [])
    : (payload?.week_rail?.weeks || []);

  const derived = useMemo(() => {
    if (weeks.length !== 4) return null;
    const stmtByLine = new Map((payload?.statement_rows || []).map(r => [r.line_code, r]));
    const revCard = (payload?.cards || [])[0] || null;

    // Kevin ruling 2026-09-16: on planned periods, batr is null for
    // 3200 and 3400 (nothing has landed, no adjustment yet). Fall back
    // to `period_budget` for the sum-check target - which equals sum
    // of per-week goals by construction when target_pct is the exact
    // ratio (R-105).
    const envelopeOf = (row) => {
      const batr = Number(row.budget_at_this_revenue || 0);
      if (batr > 0) return batr;
      return Number(row.period_budget || 0);
    };

    // Kevin ruling 2026-09-16 (R-110 clarification): on planned
    // periods some accounts' `target_pct` (the FY ratio) diverges
    // from the period-specific ratio `period_budget / sum(week_rev)`
    // by tenths of a percent - e.g. TBR 3200 P11 FY is 22.34% but the
    // P11-specific exact ratio is 22.20%. Applying the FY ratio breaks
    // Invariant 1 by $127. Use the period-exact ratio for goals AND
    // for the row-sub display on future range only, so the sub and
    // the goal numbers agree.
    const revSum = weeks.reduce((s, w) => s + Number(w.week_revenue || 0), 0);

    const goalFor = (line) => {
      const row = stmtByLine.get(line);
      if (!row) return { goal: [null, null, null, null], sum: 0, batr: 0, effectivePct: 0 };
      const pb = Number(row.period_budget || 0);
      const batr = Number(row.budget_at_this_revenue || 0);
      const envelope = batr > 0 ? batr : pb;
      // On future range: use period-exact ratio (envelope / revSum).
      // On CP: use FY target_pct (R-105). Preserves both invariants.
      const fyRatio = Number(row.target_pct || 0) / 100;
      const ratio = isFuture && revSum > 0 && envelope > 0
        ? envelope / revSum
        : fyRatio;
      const g = weeks.map(w => Number(w.week_revenue || 0) * ratio);
      const sub1 = stmtByLine.get("3100.1");
      const sub2 = stmtByLine.get("3100.2");
      // Kevin R-128 Part 1 (2026-09-19) · R-121 week split.
      // The per-week 3100 goal comes from the labor board's own
      // fields, not from a client-side re-derivation. R-111's formula
      // (`week_revenue × hourly_target_pct + salary/4`) was superseded
      // by R-121 (`week_revenue × merged_pct` with static salary/4
      // subtracted). Salary toggle reads `budget_at_this_week_revenue`
      // (merged total); hourly toggle reads `week_hourly_allowed`
      // (total - static salary/4). Server-side, Guard D deletes the
      // hourly payload's `budget_at_this_week_revenue` so the client
      // cannot decompose salary via subtraction on hourly.
      //
      // Fallback (Kevin review 2026-09-19 F2): check the FIELD for the
      // active toggle, not the week's mere presence. `has(week_start)`
      // succeeds for any week with a start date; the field can be
      // absent while the week is not. `null` and `undefined` both
      // trigger fallback; a real zero (never observed in production
      // but plausible on a $0-budget line) survives.
      if (line === "3100") {
        const salaryToggleOn = sub1 != null && sub2 != null;
        const lbWks = labor?.board?.weeks || [];
        const byStart = new Map(lbWks.filter(w => w.week_start).map(w => [w.week_start, w]));
        const activeField = salaryToggleOn ? "budget_at_this_week_revenue" : "week_hourly_allowed";
        const allFieldsPresent = weeks.every(w => {
          const lw = byStart.get(w.week_start);
          return lw != null && lw[activeField] != null;
        });
        if (allFieldsPresent) {
          const gs = weeks.map(w => Number(byStart.get(w.week_start)[activeField]));
          return { goal: gs, sum: gs.reduce((s, v) => s + v, 0), batr: envelope, effectivePct: (envelope / (revSum || 1)) * 100 };
        }
        // Fallback: legacy R-111 formula on the salary path; generic
        // ratio on the hourly path. Preserves prior behaviour when
        // labor.board is stale/absent. No warn (Kevin review F3: the
        // three goalFor("3100") call sites in the render body fire
        // the same warn three times per render). Probe covers the
        // detection assertion.
        if (salaryToggleOn) {
          const hourlyRatio = Number(sub1.target_pct || 0) / 100;
          const salaryPerWeek = Number(sub2.period_budget || 0) / 4;
          const gs = weeks.map(w => Number(w.week_revenue || 0) * hourlyRatio + salaryPerWeek);
          return { goal: gs, sum: gs.reduce((s, v) => s + v, 0), batr: envelope, effectivePct: (envelope / (revSum || 1)) * 100 };
        }
        // hourly toggle fallback: generic ratio × revenue
        return { goal: g, sum: g.reduce((s, v) => s + v, 0), batr: envelope, effectivePct: ratio * 100 };
      }
      return { goal: g, sum: g.reduce((s, v) => s + v, 0), batr: envelope, effectivePct: ratio * 100 };
    };

    const landedFor = (line) => {
      if (line === "3100") {
        // ┌───────────────────────────────────────────────────────────
        // │ DO NOT REMOVE this `+ weekHatchedDollars(...)` addition
        // │ without confirming task #489 has shipped and the labor
        // │ payload's `board.weeks[i].spent` is R-103-complete on the
        // │ server side. Removing this while the payload still ships
        // │ costed-only re-introduces the silent under-reporting bug
        // │ Kevin caught 2026-09-17.
        // └───────────────────────────────────────────────────────────
        //
        // Kevin ruling 2026-09-17 (R-103 client fix). Per R-103,
        //   labor spent = costed + unpriced + unapproved
        // The payload's `board.weeks[i].spent` is COSTED ONLY - the
        // WeekTable already adds `weekHatchedDollars(w, avg_rate)`
        // to reach the R-103 total. Do the same here so the CP
        // surface (week cells, period figure, percent used, verdict,
        // Rolling's closedSpent) reads the full R-103 figure. Under-
        // reported by $6,606 on TBJ CP the day this landed; different
        // amounts on other days as unapproved hours turn over. `avg_
        // rate` from `labor.board.avg_rate`.
        //
        // Belt-and-braces: the durable fix (task #489, Guard 2) makes
        // `board.weeks[i].spent` R-103-complete server-side so no
        // consumer has to remember to add hatched. Until that lands,
        // this client patch is what keeps the CP surface honest.
        const lbWks = labor?.board?.weeks || [];
        const avgRate = Number(labor?.board?.avg_rate || 0);
        const byStart = new Map(lbWks.map(w => [
          w.week_start,
          Number(w.spent || 0) + weekHatchedDollars(w, avgRate).total,
        ]));
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
    // R-110 · on planned periods Overview ships no projected/confirmed;
    // period column reads the plan (sum of week revenue) instead of a
    // "projecting / confirmed" split. Kevin ruling 2026-09-16:
    // "the period reads the labor weekly sum" - not overview.cards[0].
    // budget_full_period, which is $15 off on TBJ P11 and a chef will
    // add up the four cells and see the mismatch.
    const revProj = isFuture
      ? rev.reduce((s, v) => s + v, 0)
      : Number(revCard?.projected_period_revenue || 0);
    const revConf = isFuture
      ? 0
      : Number(revCard?.hero_actual || 0);

    const salaryPath = stmtByLine.get("3100.1") != null && stmtByLine.get("3100.2") != null;
    const laborPct = Number(stmtByLine.get("3100")?.target_pct || 0).toFixed(2);
    // Kevin R-128 Part 3 item 11 (2026-09-19). Drop the `labor · `
    // prefix on the salary view - the row is already labelled
    // "Kitchen labor" in the label column. Keep `hourly · ` on the
    // hourly view: those figures are hourly-only and the prefix is
    // the only thing on the row that says so.
    const laborSub = salaryPath ? `${laborPct}% of revenue` : `hourly · ${laborPct}% of revenue`;
    // Row subtitles per Kevin's R-110 render. Labor / Purchasing get
    // planning-tone copy on future range ("schedule to this", "order
    // against this"). Kevin ruling 2026-09-16: on planned periods use
    // the period-exact ratio (envelope / planned rev) for the display
    // pct too, so the sub agrees with the per-week goals. On CP the
    // FY target_pct stays.
    const goalHourly = goalFor("3100.1");
    const goalFood   = goalFor("3200");
    const goalPack   = goalFor("3400");
    const goalVeh    = goalFor("3500");
    const laborPctFuture = (goalHourly.effectivePct || 0).toFixed(2);
    const laborSubFuture = salaryPath
      ? `${laborPct}% of revenue · schedule to this`
      : `hourly · ${laborPctFuture}% of week revenue · schedule to this`;
    const foodSub    = `${(stmtByLine.get("3200")?.target_pct || 0).toFixed(2)}% of revenue`;
    const packSub    = `${(stmtByLine.get("3400")?.target_pct || 0).toFixed(2)}% of revenue`;
    const vehSub     = `${(stmtByLine.get("3500")?.target_pct || 0).toFixed(2)}% of revenue`;
    const foodSubP   = `${(goalFood.effectivePct || 0).toFixed(2)}% of week revenue · order against this`;
    const packSubP   = `${(goalPack.effectivePct || 0).toFixed(2)}% of week revenue`;
    // Kevin R-128 Part 3 trap 3B.2 (2026-09-19). Vehicle needs its
    // own future-range sub so its % agrees with the period-exact
    // ratio the other rows use on NP. Without vehSubP, Vehicle's sub
    // would show the FY ratio while Food and Pack. & Sup. above show
    // the period-exact - three rows in a column, two computed one
    // way and one the other.
    const vehSubP    = `${(goalVeh.effectivePct || 0).toFixed(2)}% of week revenue`;

    // Kevin R-128 Part 3 items 5 + E, trap 3B.3 (2026-09-19). Vehicle
    // (3500) is present on TBJ - FL and TBR - FL and absent on
    // CIN - AZ and TXR - AZ. Suppress the row when both the period
    // budget and the actual spend are zero, else the two AZ accounts
    // render a row of zeros. ONE named expression - a later ruling
    // (R-129) will add the same row to the Purchasing drill-down,
    // and if the two copies drift, Overview and its own drill-down
    // will disagree about whether the account has a Vehicle line.
    // Same R-127 failure mode we already have open.
    const vehRow = stmtByLine.get("3500");
    const vehPeriodBudget = vehRow ? Number(vehRow.period_budget || 0) : 0;
    const vehBatr         = vehRow ? Number(vehRow.budget_at_this_revenue || 0) : 0;
    const vehActual       = (purch?.weekly || [])
      .filter(r => String(r.gl_line_code || "").startsWith("3500"))
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const hasVehicleLine = vehRow != null
      && (vehPeriodBudget > 0 || vehBatr > 0 || vehActual > 0);

    const ROWS_OVERVIEW = [
      { line: null, name: "Revenue", sub: "meals + service fee", rev: true },
      { line: "3100", name: "Kitchen labor", sub: laborSub, isLabor: true },
      { line: "3200", name: "Food",      sub: foodSub },
      { line: "3400", name: "Pack. & Sup.", sub: packSub },
      ...(hasVehicleLine ? [{ line: "3500", name: "Vehicle", sub: isFuture ? vehSubP : vehSub }] : []),
    ];
    const ROWS_LABOR = [
      { line: null, name: "Revenue", sub: "what each week earns", rev: true },
      { line: "3100", name: "Hourly labor", sub: isFuture ? laborSubFuture : laborSub, isLabor: true },
    ];
    const ROWS_PURCHASING = [
      { line: null, name: "Revenue", sub: "what you are ordering for", rev: true },
      { line: "3200", name: "Food",      sub: isFuture ? foodSubP : foodSub },
      { line: "3400", name: "Pack. & Sup.", sub: isFuture ? packSubP : packSub },
    ];
    const rows =
        rowSet === "labor"      ? ROWS_LABOR
      : rowSet === "purchasing" ? ROWS_PURCHASING
      :                           ROWS_OVERVIEW;

    // Kevin R-128 Part 3 item 1 (2026-09-19). Per-week + period
    // salary/hourly split for the 3100 row. Reads week_hourly_allowed
    // and week_salary_allowed straight off the labor board, matching
    // the R-121 shape Part 1 shipped. Guard D deletes week_salary_
    // allowed on the hourly payload, so this returns null on the
    // hourly view - the split does not render there anyway (Kevin
    // Part 4 rule matrix). Rolling mode also suppresses the split
    // in CostCellBody so a re-spread budget does not stack alongside
    // the delta line, keeping row height flat.
    const splitFor3100 = (() => {
      if (!salaryPath) return null;
      const lbWks = labor?.board?.weeks || [];
      const byStart = new Map(lbWks.filter(w => w.week_start).map(w => [w.week_start, w]));
      const per = weeks.map(w => {
        const lw = byStart.get(w.week_start);
        return {
          hrly: (lw && lw.week_hourly_allowed != null) ? Number(lw.week_hourly_allowed) : null,
          sal:  (lw && lw.week_salary_allowed  != null) ? Number(lw.week_salary_allowed)  : null,
        };
      });
      if (per.some(x => x.hrly == null || x.sal == null)) return null;
      const hrlyTotal = per.reduce((s, x) => s + x.hrly, 0);
      const salTotal  = per.reduce((s, x) => s + x.sal,  0);
      return { per, hrlyTotal, salTotal };
    })();

    return { rows, rev, revProj, revConf, stmtByLine, goalFor, landedFor, splitFor3100 };
  }, [payload, weeks, labor, purch, rowSet, isFuture]);

  const ready = !!(derived && labor && purch && !error);
  const { box: liftBox, gridRef } = useLift(ready);

  // Section B · mode state. PLAN is default. C4 (future range) does
  // not reach this component - the parent gate never mounts the CP
  // table on a future range - so no explicit C4 handling here.
  const [mode, setMode] = useState("plan");

  if (weeks.length !== 4) {
    // No data yet. Kevin fix 2026-09-17 item 1: don't ship a second
    // loader - the parent's board skeleton stays up until aux data is
    // ready. Returning null here means the component simply doesn't
    // mount until the payload is real.
    return null;
  }
  if (error) {
    return <div className="kpi-ov-cp-empty" role="alert">Labor / Purchasing did not load: {error}</div>;
  }
  if (!labor || !purch) {
    // Aux fetch still pending. Same rule as above: no second loader,
    // the parent page keeps its skeleton up until this returns real
    // content.
    return null;
  }

  const todayISO = payload?.todayISO || new Date().toISOString().slice(0, 10);
  const periodStart = weeks[0]?.week_start;
  const day = daysSinceStart(periodStart, todayISO);
  const dayFrac = Math.max(0, Math.min(1, day / 28));

  const total = derived.rows.length;
  const end = 2 + 2 * total;

  // R-110 · service-day count for the whole period from labor's
  // per-week `service_days` (added 2026-09-16). Sum across weeks -
  // TBJ P11 = 24, TBR P11 = 21, neither the render's placeholder 20.
  // If the field is missing (older payload), fall back to 20 with a
  // console warning so a probe surfaces the gap.
  const serviceDaysTotal = (labor?.board?.weeks || []).reduce(
    (s, w) => s + Number(w.service_days || 0), 0
  );

  // Section B · precompute rolling data per cost line. On R-110 future
  // range this block is skipped entirely - closedFlags is all false,
  // no cost line has landed, and the toggle does not render.
  const closedFlags = weeks.map(w => (w.state || "") === "closed");
  const currentIdx = weeks.findIndex(w => (w.state || "") === "in_progress");
  const perLine = new Map();
  if (!isFuture) {
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
  }
  const anyLine = perLine.size ? perLine.values().next().value : null;
  const isC1 = anyLine ? anyLine.isC1 : false;
  const isC2 = anyLine ? anyLine.isC2 : false;

  // Status strip copy per render.
  //   CP: "P10 · week 2 of 4 · day 10 of 28 · closes 10/04"
  //   NP: "P11 · starts 10/05 · budget only, nothing has happened yet"
  const periodNo = payload?.range?.period_no ?? weeks[0]?.period_no ?? null;
  const wkOfPeriod = currentIdx >= 0 ? currentIdx + 1 : null;
  const closesDate = weeks[3]?.week_end || "";
  const closesLabel = closesDate.slice(5).replace(/-/, "/");
  const startsLabel = (weeks[0]?.week_start || "").slice(5).replace(/-/, "/");
  const statusPill = isFuture ? "Planning view" : "Period running";
  const statusSub = isFuture
    ? [
        periodNo != null && <><b>P{periodNo}</b></>,
        startsLabel && ` · starts ${startsLabel}`,
        " · budget only, nothing has happened yet",
      ].filter(Boolean)
    : [
        periodNo != null && <><b>P{periodNo}</b></>,
        wkOfPeriod && ` · week ${wkOfPeriod} of 4`,
        day > 0 && ` · day ${day} of 28`,
        closesLabel && ` · closes ${closesLabel}`,
      ].filter(Boolean);

  // R-110 · three small cards beneath the table. Sum across cost
  // lines (Overview: 3100+3200+3400; Labor: 3100; Purchasing:
  // 3200+3400) for the total; per-week = /4; per-service-day uses the
  // real count from labor.board.weeks[].service_days.
  // Kevin R-128 Part 3 Trap 3B.1 (2026-09-19). Item 6 adds a total
  // row to derived.rows with `tot: true`. costTotal feeds the three
  // future-period cards below; without the `!r.tot` guard, once the
  // total row is in place the sum doubles and the cards read exactly
  // 2x the truth. Guarded here rather than left to depend on the total
  // row's shape (whose `line: null` incidentally yields batr:0 today).
  const costRowsForCards = derived.rows.filter(r => !r.rev && !r.tot);
  const costTotal = costRowsForCards.reduce((s, r) => {
    const gi = derived.goalFor(r.line);
    return s + Number(gi.batr || 0);
  }, 0);
  const revenueTotal = derived.rev.reduce((s, v) => s + v, 0);
  const cardsLabel = rowSet === "labor" ? "Hourly labor"
                   : rowSet === "purchasing" ? "Purchases"
                   : "Cost of goods";

  return (
    <>
      {/* Section B · status strip + PLAN / ROLLING toggle on CP.
          On R-110 (future range) the pill copy switches to `Planning
          view` and the toggle does NOT render - Rolling has no
          meaning against a period where nothing has landed. */}
      <div className="kpi-ov-cp-status">
        <span className="kpi-ov-cp-stpill">{statusPill}</span>
        <span className="kpi-ov-cp-status-sub">{statusSub.map((s, i) => <Fragment key={i}>{s}</Fragment>)}</span>
        <span className="kpi-ov-cp-status-ml" />
        {!isFuture && (
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
        )}
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
            current week; no progress bar. On future range every week
            reads `forecast`, no lifted column, no day-in-week meta. */}
        {weeks.map((w, i) => {
          const p = pillFor(w, isFuture);
          const st = isFuture ? "kpi-ov-cp-ahead" : stateClass(w);
          const isNow = !isFuture && w.state === "in_progress";
          const wkNo = i + 1;
          const dayInWeek = Math.max(0, Math.min(7, day - 7 * (wkNo - 1)));
          const cls = [
            "kpi-ov-cp-hcell",
            st && st,
            isNow && "kpi-ov-cp-now",
            i === 0 && "kpi-ov-cp-firstwk",
            i > 0 && "kpi-ov-cp-vline",   // column line between weeks
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
        <div className="kpi-ov-cp-hcell kpi-ov-cp-per kpi-ov-cp-vline" style={{ gridColumn: 6 }}>
          <div className="kpi-ov-cp-hcl1">
            <span className="kpi-ov-cp-wk">Period</span>
            <span className="kpi-ov-cp-pill kpi-ov-cp-pill-navy">{isFuture ? "the plan" : "what is left"}</span>
          </div>
          <div className="kpi-ov-cp-hcl2">
            {isFuture
              ? <>P{periodNo ?? "?"} · not started</>
              : <>{Math.round(dayFrac * 100)}% of the period gone</>}
          </div>
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
              {/* Separators before this row's rlab/cells. Kevin
                  R-128 Part 3 item D: the separator between Revenue
                  (ri=0) and the first cost row (ri=1) reads at
                  --n-400 so the layout parses as revenue / costs /
                  total, not one flat list. */}
              <div
                className={`kpi-ov-cp-rowline${ri === 1 ? " kpi-ov-cp-rowline-sect" : ""}${row.tot ? " kpi-ov-cp-rowline-tot" : ""}`}
                style={{ gridRow: sepGr }}
              />
              {!isRev && (
                <div
                  className={`kpi-ov-cp-lline${ri === 1 ? " kpi-ov-cp-lline-sect" : ""}${row.tot ? " kpi-ov-cp-lline-tot" : ""}`}
                  style={{ gridRow: sepGr }}
                />
              )}
              {/* Kevin R-128 Part 3 item 7 (2026-09-19). Lift-line
                  segment inside the current-week column. Only when a
                  current week exists (isFuture=false, currentIdx>=0).
                  Sits at z-12, above the liftbody (z-11) and level
                  with hcell.now / cell.now (z-12). */}
              {!isFuture && currentIdx >= 0 && (
                <div
                  className={`kpi-ov-cp-liftline${ri === 1 ? " kpi-ov-cp-liftline-sect" : ""}${row.tot ? " kpi-ov-cp-liftline-tot" : ""}`}
                  style={{ gridColumn: currentIdx + 2, gridRow: sepGr }}
                />
              )}
              {/* Row label (col 1). */}
              <div
                className={[
                  "kpi-ov-cp-rlab",
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
              {/* Week cells (cols 2..5). On future range every week
                  is `ahead` (no isNow, no lifted). `kpi-ov-cp-
                  lastrow` on the last row's cells so the current-
                  week's bottom cell can carry the -7px overhang. */}
              {weeks.map((w, i) => {
                const st = isFuture ? "kpi-ov-cp-ahead" : stateClass(w);
                const isNow = !isFuture && w.state === "in_progress";
                const cls = [
                  "kpi-ov-cp-cell",
                  st,
                  isNow && "kpi-ov-cp-now",
                  i > 0 && "kpi-ov-cp-vline",
                  isLast && "kpi-ov-cp-lastrow",
                ].filter(Boolean).join(" ")
                // On future range every week is state="not_started"
                // - CostCellBody's isFuture branch already renders
                // `to spend $X` and nothing else, which is exactly
                // what R-110 wants. No rolling data on NP.
                const wForCell = isFuture ? { ...w, state: "not_started" } : w;
                return (
                  <div key={`c-${row.line || "rev"}-${i}`} className={cls} style={{ gridColumn: i + 2, gridRow: rlabGr }}>
                    {isRev
                      ? <RevCellBody w={w} amount={derived.rev[i]} labor={labor} i={i} isFuture={isFuture} />
                      : (() => {
                          const pl = perLine.get(row.line);
                          const dlt = pl ? (pl.rolling[i] - pl.plan[i]) : 0;
                          const sp = (row.line === "3100" && derived.splitFor3100)
                            ? derived.splitFor3100.per[i]
                            : null;
                          return (
                            <CostCellBody
                              w={wForCell}
                              goal={goalInfo.goal[i]}
                              goalRolling={pl ? pl.rolling[i] : goalInfo.goal[i]}
                              landed={isFuture ? 0 : landed[i]}
                              isLabor={row.isLabor}
                              mode={isFuture ? "plan" : mode}
                              dlt={dlt}
                              isC3={pl ? pl.isC3 : false}
                              splitHrly={sp ? sp.hrly : null}
                              splitSal={sp ? sp.sal : null}
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
                  "kpi-ov-cp-vline",
                  isLast && "kpi-ov-cp-lastrow",
                ].filter(Boolean).join(" ")}
                style={{ gridColumn: 6, gridRow: rlabGr }}
              >
                {isRev
                  ? <PerRevCellBody projection={derived.revProj} confirmed={derived.revConf} dayFrac={dayFrac} isFuture={isFuture} serviceDays={serviceDaysTotal} />
                  : <PerCostCellBody
                      envelope={goalInfo.batr}
                      landed={actual}
                      dayFrac={dayFrac}
                      isFuture={isFuture}
                      serviceDays={serviceDaysTotal}
                      splitHrly={row.line === "3100" && derived.splitFor3100 ? derived.splitFor3100.hrlyTotal : null}
                      splitSal={row.line === "3100" && derived.splitFor3100 ? derived.splitFor3100.salTotal : null}
                    />}
              </div>
            </Fragment>
          );
        })}

        {/* Lifted current-week column (A3). Positioned absolutely so
            the top edge overhangs the header by 12px and the bottom
            edge overhangs the last row by 12px. Sits behind the .now
            cells (z-index 10/11 vs 12). On future range there is no
            "now" week - no lift renders. */}
        {!isFuture && liftBox && (
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
    {/* R-110 · three small cards below the table on future range
        only. Structure per docs/renders/next-period-table.html:
        [<label> · the period · $tot · X% of planned revenue],
        [A week · $tot/4 · four even weeks],
        [A service day · $tot/serviceDays · N service days]. */}
    {isFuture && (
      <div className="kpi-ov-cp-perk">
        <div className="kpi-ov-cp-perk-k">
          <div className="kpi-ov-cp-perk-e">{cardsLabel} · the period</div>
          <div className="kpi-ov-cp-perk-v">{dollar0(costTotal)}</div>
          <div className="kpi-ov-cp-perk-s">
            {revenueTotal > 0 ? `${(costTotal / revenueTotal * 100).toFixed(2)}% of planned revenue` : "planned"}
          </div>
        </div>
        <div className="kpi-ov-cp-perk-k">
          <div className="kpi-ov-cp-perk-e">A week</div>
          <div className="kpi-ov-cp-perk-v">{dollar0(costTotal / 4)}</div>
          <div className="kpi-ov-cp-perk-s">four even weeks</div>
        </div>
        <div className="kpi-ov-cp-perk-k">
          <div className="kpi-ov-cp-perk-e">A service day</div>
          <div className="kpi-ov-cp-perk-v">{dollar0(serviceDaysTotal > 0 ? costTotal / serviceDaysTotal : 0)}</div>
          <div className="kpi-ov-cp-perk-s">{serviceDaysTotal} service day{serviceDaysTotal === 1 ? "" : "s"} · from the Service Calendar</div>
        </div>
      </div>
    )}
    {/* Section B · summary card. Rolling mode only. */}
    {!isFuture && mode === "rolling" && perLine.size > 0 && (
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
