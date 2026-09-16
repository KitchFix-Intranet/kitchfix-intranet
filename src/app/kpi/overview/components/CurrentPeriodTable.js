"use client";
// src/app/kpi/overview/components/CurrentPeriodTable.js
//
// R-109 · the one-table Current period view. Renders on the Overview
// under the running-period gate `data.range?.kind === "period" &&
// data.period_state === "open"`. Replaces the three cards, four week
// cards, cost-lines table, and full P&L on CP only.
//
// Render of record: docs/renders/current-period-final.html
//
// The Overview version of this table carries three cost rows per
// Kevin's ruling 3 (2026-09-15): Revenue + 3100 Kitchen labor +
// 3200 Food + 3400 Packaging. No Vehicle row, no total row.
//
// Data sourcing (Kevin's mapping + rulings 1 + 2):
//   week revenue per week      week_rail.weeks[i].week_revenue
//   revenue basis              week_rail.weeks[i].revenue_basis
//   week state                 week_rail.weeks[i].state
//   period projection          cards[0].projected_period_revenue
//   period confirmed           cards[0].hero_actual
//   line target ratio          statement_rows[line].target_pct / 100
//   line adjusted (batr)       statement_rows[line].budget_at_this_revenue
//   line period actual         statement_rows[line].actual        // 3100 only
//   3100 per-week landed       labor.board.weeks[i].spent          // fetched
//   3200/3400 per-week landed  purchasing weekly[] + pending cards // fetched
//                              (Kevin ruling 2: coded + pending, matches bucket)
//   today                      overview.todayISO                   // #1124
//
// Goal formula (Kevin ruling 1, cent-exact by construction):
//   goal[i] = week_revenue[i] × (line_plan / revenue_plan)
//   line_plan / revenue_plan == statement_rows[line].target_pct / 100
//   sum(goal) == statement_rows[line].budget_at_this_revenue

import { Fragment, useMemo } from "react";

const dollar0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");

// Days since period start (inclusive of today) - server ships todayISO
// (#1124) and each week has week_start; the header + "day X of 28"
// derive from these instead of `new Date()` client-side (prompt § 2).
function daysSinceStart(startISO, todayISO) {
  const t = new Date(todayISO + "T00:00:00Z").getTime();
  const s = new Date(startISO + "T00:00:00Z").getTime();
  return Math.floor((t - s) / 86400000) + 1;
}

// Cost row cell for a single week. State drives the shape - render
// spec § 3 (verdict rules). Closed weeks with labor keep the verdict
// (payroll is final); closed weeks with purchasing show "invoices
// still landing" and never a green tick. Current-week shows "left
// this week" or "over"; future weeks show only the goal.
function CostCell({ landed, goal, state, isLabor, isNow, isLastRow, sep }) {
  const isFuture = state === "not_started";
  const isClosed = state === "closed";
  const l = Number(landed || 0);
  const g = Number(goal || 0);
  const over = l > g && g > 0;
  const pctBar = g > 0 ? Math.min(100, (l / g) * 100) : 0;

  const cellClasses = [
    "kpi-ov-cp-cell",
    isNow && "kpi-ov-cp-now",
    isLastRow && isNow && "kpi-ov-cp-now-last",
    isFuture && "kpi-ov-cp-ahead",
    sep && "kpi-ov-cp-sep",
  ].filter(Boolean).join(" ");

  if (isFuture) {
    return (
      <div className={cellClasses}>
        <div className="kpi-ov-cp-a">{dollar0(g)}</div>
        <div className="kpi-ov-cp-b">to spend</div>
        <div className="kpi-ov-cp-v kpi-ov-cp-mute">&nbsp;</div>
      </div>
    );
  }

  const barColor = over ? "var(--red-600)" : "var(--green-600)";
  let verdictText, verdictClass;
  if (over) {
    verdictText = `▲ ${dollar0(l - g)} over`;
    verdictClass = "kpi-ov-cp-over";
  } else if (isNow) {
    verdictText = `${dollar0(g - l)} left this week`;
    verdictClass = "kpi-ov-cp-good";
  } else if (isClosed && !isLabor) {
    verdictText = `${dollar0(g - l)} left · still landing`;
    verdictClass = "kpi-ov-cp-mute";
  } else {
    verdictText = `▼ ${dollar0(g - l)} under`;
    verdictClass = "kpi-ov-cp-good";
  }

  return (
    <div className={cellClasses}>
      <div className={`kpi-ov-cp-a${over ? " kpi-ov-cp-over" : ""}`}>{dollar0(l)}</div>
      <div className="kpi-ov-cp-b">of {dollar0(g)}</div>
      <div className="kpi-ov-cp-bar">
        <i style={{ width: `${pctBar}%`, background: barColor }} />
      </div>
      <div className={`kpi-ov-cp-v ${verdictClass}`}>{verdictText}</div>
    </div>
  );
}

function RevCell({ amount, basis, state, isNow, servicesLabel, sep }) {
  const isFuture = state === "not_started";
  const cellClasses = [
    "kpi-ov-cp-cell",
    isNow && "kpi-ov-cp-now",
    isFuture && "kpi-ov-cp-ahead",
    sep && "kpi-ov-cp-sep",
  ].filter(Boolean).join(" ");
  return (
    <div className={cellClasses}>
      <div className="kpi-ov-cp-a">{dollar0(amount)}</div>
      <div className="kpi-ov-cp-b">{basis || " "}</div>
      <div className="kpi-ov-cp-v kpi-ov-cp-mute">{servicesLabel || " "}</div>
    </div>
  );
}

// Period cell for revenue - shows projection with confirmed share.
function PerRevCell({ projection, confirmed, dayFrac, sep }) {
  const p = projection > 0 ? Math.min(100, (confirmed / projection) * 100) : 0;
  return (
    <div className={`kpi-ov-cp-cell kpi-ov-cp-per${sep ? " kpi-ov-cp-sep" : ""}`}>
      <div className="kpi-ov-cp-a">{dollar0(projection)}</div>
      <div className="kpi-ov-cp-b">projecting · <b className="kpi-ov-cp-good">{dollar0(confirmed)}</b> confirmed</div>
      <div className="kpi-ov-cp-bar">
        <i style={{ width: `${p}%`, background: "var(--green-600)" }} />
        <span className="kpi-ov-cp-clk" style={{ left: `${Math.round(dayFrac * 100)}%` }} />
      </div>
      <div className="kpi-ov-cp-v kpi-ov-cp-good">{Math.round(p)}% confirmed · ahead</div>
    </div>
  );
}

function PerCostCell({ goal, landed, dayFrac, sep }) {
  const G = Number(goal || 0);
  const L = Number(landed || 0);
  const p = G > 0 ? Math.min(100, (L / G) * 100) : 0;
  const hot = G > 0 && (L / G) > (dayFrac + 0.005);
  const barColor = hot ? "var(--red-600)" : "var(--green-600)";
  return (
    <div className={`kpi-ov-cp-cell kpi-ov-cp-per${sep ? " kpi-ov-cp-sep" : ""}`}>

      <div className={`kpi-ov-cp-a${hot ? " kpi-ov-cp-over" : ""}`}>{dollar0(G - L)}</div>
      <div className="kpi-ov-cp-b">left of {dollar0(G)} · <b>{dollar0(L)}</b> landed</div>
      <div className="kpi-ov-cp-bar">
        <i style={{ width: `${p}%`, background: barColor }} />
        <span className="kpi-ov-cp-clk" style={{ left: `${Math.round(dayFrac * 100)}%` }} />
      </div>
      <div className={`kpi-ov-cp-v ${hot ? "kpi-ov-cp-over" : "kpi-ov-cp-good"}`}>
        {Math.round(p)}% used · {hot ? "running hot" : "on pace"}
      </div>
    </div>
  );
}

// Header row: bucket eyebrow + four week columns + period column.
function HeaderRow({ weeks, todayISO, periodStart }) {
  const day = daysSinceStart(periodStart, todayISO);
  return (
    <>
      <div className="kpi-ov-cp-ch kpi-ov-cp-ch-l">
        <div className="kpi-ov-cp-wk">Bucket</div>
        <div className="kpi-ov-cp-dt kpi-ov-cp-mute-strong">by week</div>
      </div>
      {weeks.map((w, i) => {
        const isNow = w.state === "in_progress";
        const isDone = w.state === "closed";
        const isFuture = w.state === "not_started";
        const cls = ["kpi-ov-cp-ch"];
        if (isNow) cls.push("kpi-ov-cp-now");
        if (isFuture) cls.push("kpi-ov-cp-ahead");
        const wkOfPeriod = i + 1;
        const dayInWeek = Math.max(0, Math.min(7, day - 7 * (wkOfPeriod - 1)));
        let pill = null;
        if (isDone) pill = <span className="kpi-ov-cp-pill kpi-ov-cp-pill-n">closed</span>;
        else if (isNow) pill = <span className="kpi-ov-cp-pill kpi-ov-cp-pill-here">you are here</span>;
        else if (w.revenue_basis === "partial") pill = <span className="kpi-ov-cp-pill kpi-ov-cp-pill-amb">partly confirmed</span>;
        else pill = <span className="kpi-ov-cp-pill kpi-ov-cp-pill-line">forecast</span>;
        const wkLabel = `Wk ${wkOfPeriod}`;
        const dateLabel = `${(w.week_start || "").slice(5).replace(/-/, "/")} – ${(w.week_end || "").slice(5).replace(/-/, "/")}`;
        return (
          <div key={w.week_start} className={cls.join(" ")}>
            <div className="kpi-ov-cp-wk">{wkLabel}</div>
            <div className="kpi-ov-cp-dt">{dateLabel}</div>
            {pill}
            {isNow && (
              <>
                <div className="kpi-ov-cp-prog">
                  <i style={{ width: `${Math.round((dayInWeek / 7) * 100)}%` }} />
                </div>
                <div className="kpi-ov-cp-pd">day {dayInWeek} of 7</div>
              </>
            )}
          </div>
        );
      })}
      <div className="kpi-ov-cp-ch kpi-ov-cp-per">
        <div className="kpi-ov-cp-wk">Period</div>
        <div className="kpi-ov-cp-dt">{Math.round((day / 28) * 100)}% of the period gone</div>
        <span className="kpi-ov-cp-pill kpi-ov-cp-pill-navy">what is left</span>
      </div>
    </>
  );
}

export default function CurrentPeriodTable({ payload, labor, purch, error, rowSet = "overview" }) {
  const weeks = payload?.week_rail?.weeks || [];

  const derived = useMemo(() => {
    if (weeks.length !== 4) return null;
    const stmtByLine = new Map((payload?.statement_rows || []).map(r => [r.line_code, r]));
    const revCard = (payload?.cards || [])[0] || null;

    // Kevin ruling 1: goal uses exact ratio = target_pct / 100 (the
    // payload carries the unrounded value; display two decimals).
    const goalFor = (line) => {
      const row = stmtByLine.get(line);
      if (!row) return { goal: [null, null, null, null], sum: 0, batr: 0 };
      const ratio = Number(row.target_pct || 0) / 100;
      const g = weeks.map(w => Number(w.week_revenue || 0) * ratio);
      // Salary composition: 3100 on +salary path composes hourly + flat
      // salary $. Sub-row 3100.2's period_budget is the salary portion;
      // split across 4 weeks for the flat allocation. Sub-row 3100.1's
      // target_pct is the hourly-only ratio; when it's present, prefer
      // it over the composed row's target_pct so sum(goal) == batr
      // cent-exact on both toggles.
      const sub1 = stmtByLine.get("3100.1");
      const sub2 = stmtByLine.get("3100.2");
      if (line === "3100" && sub1 && sub2) {
        const hourlyRatio = Number(sub1.target_pct || 0) / 100;
        const salaryPerWeek = Number(sub2.period_budget || 0) / 4;
        const gs = weeks.map(w => Number(w.week_revenue || 0) * hourlyRatio + salaryPerWeek);
        return { goal: gs, sum: gs.reduce((s, v) => s + v, 0), batr: Number(row.budget_at_this_revenue || 0) };
      }
      return { goal: g, sum: g.reduce((s, v) => s + v, 0), batr: Number(row.budget_at_this_revenue || 0) };
    };

    // Landed sources per Kevin ruling 2:
    // - 3100: labor board weeks[i].spent (R-103 definition includes hatched)
    // - 3200/3400: purchasing bucket spent per week (coded + pending)
    //   Coded rows sit in purch.weekly[]; pending card charges have txn_date
    //   and null gl_line_code - attributed by week_start containment.
    const landedFor = (line) => {
      if (line === "3100") {
        const lbWks = labor?.board?.weeks || [];
        const byStart = new Map(lbWks.map(w => [w.week_start, Number(w.spent || 0)]));
        return weeks.map(w => Number(byStart.get(w.week_start) || 0));
      }
      // Purchasing coded per-week per-bucket.
      const wkStartSet = weeks.map(w => w.week_start);
      const codedByWeek = new Array(weeks.length).fill(0);
      for (const row of (purch?.weekly || [])) {
        const gl = String(row.gl_line_code || "");
        if (!gl.startsWith(line)) continue;
        const idx = wkStartSet.indexOf(row.week_start);
        if (idx >= 0) codedByWeek[idx] += Number(row.amount || 0);
      }
      // Pending card charges (gl_line_code null) - route ships them
      // under `card_charges.rows`. Attribute to week by txn_date within
      // the week [week_start, week_end] span. Kevin ruling 2: pending
      // is money spent; include on the landed figure.
      // Uncoded cards don't carry a bucket assignment - only include
      // in 3200 for now per Kevin's Vio-Brands / TBJ 3200 example
      // ($790 = -$13 coded + $803 pending → all on food row). PR 2/3
      // may need finer attribution once Labor + Purchasing land.
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

    // Kevin 2026-09-15 label ruling (PR 2). On the +salary path
    // (3100.1 + 3100.2 sub-rows present), the 3100 row's target_pct
    // is the COMBINED figure - saying "hourly · 33.29%" is wrong
    // because 33.29% is not the hourly rate. Read "labor · 33.29%"
    // on salary, "hourly · 18.20%" on hourly (where the row's pct
    // IS the hourly rate).
    const salaryPath = stmtByLine.get("3100.1") != null && stmtByLine.get("3100.2") != null;
    const laborPct = Number(stmtByLine.get("3100")?.target_pct || 0).toFixed(2);
    const laborSub = salaryPath ? `labor · ${laborPct}% of revenue` : `hourly · ${laborPct}% of revenue`;

    // Row set drives which board this renders on. Kevin 2026-09-15:
    // Overview shows Revenue + 3100 + 3200 + 3400. Labor shows only
    // Revenue + Hourly labor (the header reads "Hourly labor" on the
    // Labor board per the prompt's § 0 shape, versus "Kitchen labor"
    // on the Overview). Purchasing shows Revenue + 3200 + 3400. Same
    // component; caller picks the row set.
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
  const dayFrac = day / 28;

  return (
    <div className="kpi-ov-cp-card kpi-ov-cp-t-navy">
      <div className="kpi-ov-cp-grid">
        <HeaderRow weeks={weeks} todayISO={todayISO} periodStart={periodStart} />
        {derived.rows.map((row, ri) => {
          const sep = ri === 1 ? " kpi-ov-cp-sep" : "";
          const lastRow = ri === derived.rows.length - 1;
          // Kevin 2026-09-15 layout fix. Prior structure wrapped each
          // cell in an extra div (a grid child), so the cell's own
          // min-height didn't drive the row - the wrapper's chrome
          // (padding + border) sat outside the cell and stacked on top,
          // making rows 107px tall and leaving vertical gaps between
          // consecutive lifted cells. New structure: each cell is the
          // direct grid child (via display: contents on the rowfrag
          // fragment), the cell owns its padding/border, min-height
          // drives the row, and align-self: stretch keeps consecutive
          // lifted cells flush.
          const sepFlag = ri === 1;
          if (row.rev) {
            return (
              <Fragment key="rev-row">
                <div className={`kpi-ov-cp-rh${sepFlag ? " kpi-ov-cp-sep" : ""}`} style={{ background: "var(--green-50)" }}>
                  <div className="kpi-ov-cp-n">{row.name}</div>
                  <div className="kpi-ov-cp-g">{row.sub}</div>
                </div>
                {weeks.map((w, i) => {
                  // Kevin 2026-09-15 follow-up 3. Services count lives on
                  // labor.board.weeks[i]; Overview's week_rail doesn't ship
                  // the counts. Read from labor which we already fetch on
                  // CP so partial weeks show "N of X services".
                  const lbWk = (labor?.board?.weeks || [])[i] || null;
                  const conf = Number(lbWk?.confirmed_services || 0);
                  const totl = Number(lbWk?.total_services || 0);
                  const servicesLabel = w.revenue_basis === "partial" && totl > 0
                    ? `${conf} of ${totl} services`
                    : null;
                  return (
                    <RevCell
                      key={`rev-${i}`}
                      amount={derived.rev[i]}
                      basis={w.revenue_basis}
                      state={w.state}
                      isNow={w.state === "in_progress"}
                      servicesLabel={servicesLabel}
                      sep={sepFlag}
                    />
                  );
                })}
                <PerRevCell projection={derived.revProj} confirmed={derived.revConf} dayFrac={dayFrac} sep={sepFlag} />
              </Fragment>
            );
          }
          const { goal, batr } = derived.goalFor(row.line);
          const landed = derived.landedFor(row.line);
          const actual = landed.reduce((s, v) => s + v, 0);
          return (
            <Fragment key={row.line}>
              <div className={`kpi-ov-cp-rh${sepFlag ? " kpi-ov-cp-sep" : ""}`}>
                <div className="kpi-ov-cp-n">
                  {row.line && <span className="kpi-ov-cp-glc">{row.line}</span>}{row.name}
                </div>
                <div className="kpi-ov-cp-g">{row.sub}</div>
              </div>
              {weeks.map((w, i) => (
                <CostCell
                  key={`${row.line}-${i}`}
                  landed={landed[i]}
                  goal={goal[i]}
                  state={w.state}
                  isLabor={row.isLabor}
                  isNow={w.state === "in_progress"}
                  isLastRow={lastRow}
                  sep={sepFlag}
                />
              ))}
              <PerCostCell goal={batr} landed={actual} dayFrac={dayFrac} sep={sepFlag} />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
