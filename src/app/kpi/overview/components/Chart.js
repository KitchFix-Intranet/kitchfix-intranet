"use client";
// src/app/kpi/overview/components/Chart.js
//
// Element 6. Cost of goods sold vs budget.
//
//   - Bars are spend. Dashed line is budget. Below the line is green.
//   - FYTD (grain='period'): one bar per fiscal period; running period
//     hatched; hover shows Spent / Budget / Under-or-Over.
//   - Single period (grain='week'): one bar per fiscal week; unstarted
//     week renders as a dashed placeholder (never a $0); running week
//     hatched or a small filled bar depending on state.
//
// Payload contract (§5.4 anatomy 6 + resolver §17):
//   chart.grain: 'period' | 'week'
//   chart.series[]: [{ period_no|week_start, state, spent, budget }]
//   chart.weekly_budget: number|null (week grain only)
//
// Numbers arrive raw from the payload; the client only formats them
// for display and picks bar sizing. This is presentation, not compute.

import HelpPop from "@/app/kpi/labor/components/HelpPop";

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return null;
  const abs = Math.abs(Math.round(Number(n)));
  const s = "$" + abs.toLocaleString("en-US");
  return n < 0 ? "-" + s : s;
}

// Kevin 2026-09-02 language pass Item 13: hover tooltip removed
// from the chart entirely. The axis labels + bar height carry the
// signal; a tooltip that duplicates them is noise.

function ChartPeriodGrain({ series, revenueModel, bare = false }) {
  // Kevin PR-B item 10 (2026-09-03): caption + tooltip vary by
  // revenue model. SC-driven + sales-based accounts draw dashes at
  // ADJUSTED budget; management-fee accounts draw them at PERIOD
  // budget (revenue is contractual, no adjustment applies).
  const isManagementFee = revenueModel === "management_fee";
  const captionSuffix = isManagementFee ? "period budget" : "adjusted budget";
  const helpBody = isManagementFee
    ? <p>Each period&rsquo;s cost of goods sold against its period budget. Revenue is contractual on this account, so no revenue adjustment applies. Below the line is under budget. The running period is hatched.</p>
    : <p>Each period&rsquo;s cost of goods sold against its adjusted budget (revenue times the target cost percentage). Below the line is under budget. The running period is hatched.</p>;
  // Kevin 2026-09-02 language pass Item 15: each period's dash is
  // that period's ADJUSTED budget (period actual revenue × target
  // cost pct). Falls back to the static `budget` when adjusted is
  // null (a period with $0 revenue can't be adjusted; use the plan).
  const dashValue = (s) => {
    const adj = s.adjusted_budget;
    if (adj != null) return Number(adj);
    return Number(s.budget || 0);
  };
  const spends = series.map(s => Number(s.spent || 0));
  const dashes = series.map(s => Number(dashValue(s) || 0));
  // Kevin ruling 2026-09-02: the scale is the maximum of EVERYTHING
  // drawn, never a subset of it. Bars AND dashes both contribute to
  // mx so a period whose adjusted budget exceeds spend still fits
  // inside the plot area. Same rule as the earlier bar-clipping fix.
  // Permanent probe: scripts/probes/_probe_chart_scale.mjs asserts
  // every bar + dash lands in [0,100]% of the plot area, and its
  // seeded axis fires when the max is computed from bars alone.
  const mx = Math.max(...spends, ...dashes, 1) * 1.16;

  // Kevin ruling 2026-09-03 (simplified-layout): `bare` mode skips
  // the outer .kpi-ov-card + .kpi-ov-ch header when the caller (the
  // fold shell in Chart's default export) provides them. Portfolio
  // scope still renders the full card.
  const bars = (
    <div className="kpi-ov-bars kpi-ov-bars-inset">
      {series.map((s, i) => {
        const val = Number(s.spent || 0);
        const bud = Number(dashValue(s) || 0);
        const hgt = val > 0 ? Math.max(2, Math.round((val / mx) * 100)) : 2;
        const classSuffix =
          s.state === "in_progress" ? "kpi-ov-bar-hatch"
          : s.state === "not_started" ? "kpi-ov-bar-dash"
          : val <= bud ? "kpi-ov-bar-good"
          : "kpi-ov-bar-over";
        // Kevin ruling cleanup (2026-09-03) item 1 (DEFECT): the dash
        // sits at budget/mx of the plot height. Relative to a bar
        // whose own height is spend/mx, that is exactly (budget/spend)
        // × 100% of the bar. A budget above its spend gives > 100%
        // and the dash renders above the bar. Prior formula used a
        // rounded hgt in the denominator, which shifted the dash 1-2%
        // higher on the bar than the true budget position - producing
        // Kevin's live measurement of 6 of 8 dashes sitting AT the
        // bar top on TBJ - FL FYTD when only P3 (the actual overspend)
        // should have had its dash inside its bar.
        //
        // Assertion (permanent probe): dash_top < bar_top iff bud > val.
        const dashBottomPct = val > 0 && bud >= 0 ? (bud / val) * 100 : null;
        return (
          <i
            key={i}
            className={`kpi-ov-bar ${classSuffix}`}
            style={{ height: `${hgt}%` }}
            data-kpi-ov-bar-state={s.state}
            data-kpi-ov-period={s.period_no}
            data-kpi-ov-bar-val={val}
            data-kpi-ov-bar-bud={bud}
          >
            {dashBottomPct != null && (
              <span
                className="kpi-ov-bar-perbud"
                style={{
                  left: "-5%",
                  right: "-5%",
                  bottom: `${dashBottomPct}%`,
                }}
                aria-hidden="true"
                data-kpi-ov="bar-budget-dash"
                data-kpi-ov-dash-val={bud}
              />
            )}
          </i>
        );
      })}
    </div>
  );
  const axis = (
    <div className="kpi-ov-axis">
      {series.map((s, i) => (
        <span key={i}>
          P{s.period_no}
          <span className={`kpi-ov-amt ${s.state === "in_progress" || s.state === "not_started" ? "kpi-ov-nb" : (Number(s.spent || 0) <= Number(dashValue(s) || 0) ? "kpi-ov-good" : "kpi-ov-bad")}`}>
            {s.state === "in_progress" ? "running" : s.state === "not_started" ? "not started" : fmtMoney(Number(s.spent || 0))}
          </span>
        </span>
      ))}
    </div>
  );
  // Kevin ruling cleanup (2026-09-03) item 1 tail: legend shows only
  // the states present in the range. Prior legend hard-coded
  // "running" on FYTD where every period is closed - a legend entry
  // for a state that appears on zero bars.
  const hasClosedGood = series.some(s => s.state !== "in_progress" && s.state !== "not_started" && Number(s.spent || 0) <= Number(dashValue(s) || 0));
  const hasClosedOver = series.some(s => s.state !== "in_progress" && s.state !== "not_started" && Number(s.spent || 0) > Number(dashValue(s) || 0));
  const hasRunning = series.some(s => s.state === "in_progress");
  const legend = (
    <div className="kpi-ov-legend">
      {hasClosedGood && <span><i className="kpi-ov-bar-good" />under budget</span>}
      {hasClosedOver && <span><i className="kpi-ov-bar-over" />over budget</span>}
      {hasRunning && <span><i className="kpi-ov-bar-hatch" />running</span>}
    </div>
  );
  if (bare) {
    return (
      <div className="kpi-ov-cb" data-kpi-ov="chart" data-kpi-ov-grain="period">
        {bars}{axis}{legend}
      </div>
    );
  }
  return (
    <div className="kpi-ov-card kpi-ov-card-cogs kpi-ov-mt" data-kpi-ov="chart" data-kpi-ov-grain="period">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Cost of goods sold, period by period</span>
        <span className="kpi-ov-gl">bars are spend · line is {captionSuffix}</span>
        <HelpPop
          id="overview-chart-period"
          title="Cost of goods sold by period"
          body={helpBody}
        />
        <span className="kpi-ov-pill kpi-ov-pill-neutral">{series.length} periods</span>
      </div>
      <div className="kpi-ov-cb">
        {bars}{axis}{legend}
      </div>
    </div>
  );
}

function ChartWeekGrain({ series, weeklyBudget, periodNo, runningWeekNo, bare = false }) {
  const wkB = Number(weeklyBudget || 0);
  const spends = series.map(s => Number(s.spent || 0));
  // PR-2 item 17 (2026-09-02): scale to max * 1.16. See period-grain
  // Chart for the reasoning; week-grain applies the same rule.
  const mx = Math.max(wkB, ...spends, 1) * 1.16;
  const totalWeeks = series.length;
  const closedCount = series.filter(s => s.state === "closed").length;
  const hasRunning = series.some(s => s.state === "in_progress");

  const fmtWeekLabel = (ws, we) => {
    const [wy, wm, wd] = ws.split("-");
    const [ey, em, ed] = we.split("-");
    return `${wm}/${wd} – ${em}/${ed}`;
  };

  // Item 13 (Kevin 2026-09-02 language pass): tooltip removed. The
  // axis + bar colour carry the signal.

  // Kevin ruling 2026-09-03 (simplified-layout): `bare` mode drops
  // the outer card + header when the fold shell owns them.
  const budgetLabelStrip = wkB > 0 ? (
    <div className="kpi-ov-tgt-label" data-kpi-ov="chart-budget-label">
      budget {fmtMoney(wkB)} / wk
    </div>
  ) : null;
  const bars = (
    <div className="kpi-ov-bars kpi-ov-bars-inset">
      {wkB > 0 && (
        <div className="kpi-ov-tgt" style={{ bottom: `${Math.round((wkB / mx) * 100)}%` }} aria-hidden="true" />
      )}
      {series.map((s, i) => {
        const val = Number(s.spent || 0);
        if (s.state === "not_started") {
          return (
            <i
              key={i}
              className="kpi-ov-bar kpi-ov-bar-dash"
              data-kpi-ov-bar-state="not_started"
              data-kpi-ov-week-start={s.week_start}
            />
          );
        }
        const hgt = val > 0 ? Math.max(2, Math.round((val / mx) * 100)) : 2;
        const classSuffix =
          s.state === "in_progress" ? "kpi-ov-bar-hatch"
          : val <= wkB ? "kpi-ov-bar-good"
          : "kpi-ov-bar-over";
        return (
          <i
            key={i}
            className={`kpi-ov-bar ${classSuffix}`}
            style={{ height: `${hgt}%` }}
            data-kpi-ov-bar-state={s.state}
            data-kpi-ov-week-start={s.week_start}
          />
        );
      })}
    </div>
  );
  const axis = (
    <div className="kpi-ov-axis">
      {series.map((s, i) => (
        <span key={i}>
          Week {i + 1}
          <small>{fmtWeekLabel(s.week_start, s.week_end)}</small>
          <span className={`kpi-ov-amt ${s.state === "closed" ? (Number(s.spent || 0) <= (wkB || 0) ? "kpi-ov-good" : "kpi-ov-bad") : "kpi-ov-nb"}`}>
            {s.state === "not_started" ? "- starts later"
              : s.state === "in_progress" ? "running"
              : fmtMoney(Number(s.spent || 0))}
          </span>
        </span>
      ))}
    </div>
  );
  const runningNote = hasRunning && runningWeekNo != null ? (
    <div className="kpi-ov-gl" data-kpi-ov="chart-running-note">
      week {runningWeekNo} in progress, not yet counted
    </div>
  ) : null;
  if (bare) {
    return (
      <div className="kpi-ov-cb" data-kpi-ov="chart" data-kpi-ov-grain="week">
        {runningNote}
        {budgetLabelStrip}
        {bars}
        {axis}
      </div>
    );
  }
  return (
    <div className="kpi-ov-card kpi-ov-card-cogs kpi-ov-mt" data-kpi-ov="chart" data-kpi-ov-grain="week">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Cost of goods sold, week by week</span>
        <span className="kpi-ov-gl">bars are spend · line is the weekly budget</span>
        <HelpPop
          id="overview-chart-week"
          title="Cost of goods sold by week"
          body={
            <p>
              Below the line is under budget. Unstarted weeks show a dash, not a zero - a week that has not begun cannot be judged. Weeks in progress are hatched.
            </p>
          }
        />
        <span className={`kpi-ov-pill ${closedCount < totalWeeks ? "kpi-ov-pill-warn" : "kpi-ov-pill-neutral"}`}>
          {closedCount} of {totalWeeks} weeks closed
        </span>
        {hasRunning && runningWeekNo != null && (
          <span className="kpi-ov-gl" data-kpi-ov="chart-running-note">
            week {runningWeekNo} in progress, not yet counted
          </span>
        )}
      </div>
      <div className="kpi-ov-cb">
        {budgetLabelStrip}
        {bars}
        {axis}
      </div>
    </div>
  );
}

// Kevin ruling 2026-09-03 (simplified-layout): the chart moves to
// the bottom of the board and renders as a fold. Both P&L + Chart
// are folds; neither is open by default. `open` + `onToggle` optional
// so the portfolio branch (no fold state wired) still renders inline.
export default function Chart({ chart, revenueModel, open, onToggle }) {
  if (!chart || !Array.isArray(chart.series) || chart.series.length === 0) {
    return null;
  }
  // Portfolio branch (no fold props): render the full self-contained
  // card, unchanged from pre-2026-09-03.
  if (typeof onToggle !== "function") {
    return chart.grain === "period"
      ? <ChartPeriodGrain series={chart.series} revenueModel={revenueModel} />
      : <ChartWeekGrain series={chart.series} weeklyBudget={chart.weekly_budget} periodNo={chart.period_no} runningWeekNo={chart.running_week_no} />;
  }
  const body = chart.grain === "period"
    ? <ChartPeriodGrain series={chart.series} revenueModel={revenueModel} bare />
    : <ChartWeekGrain series={chart.series} weeklyBudget={chart.weekly_budget} periodNo={chart.period_no} runningWeekNo={chart.running_week_no} bare />;

  const grainLabel = chart.grain === "period"
    ? "period by period"
    : "week by week";
  return (
    <div
      className={`kpi-ov-card kpi-ov-card-cogs kpi-ov-mt kpi-ov-fold-card${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="chart-fold"
      data-kpi-ov-open={open ? "1" : "0"}
    >
      <button
        type="button"
        className="kpi-ov-fold-trigger"
        data-kpi-ov="fold-chart"
        onClick={onToggle}
        aria-expanded={open ? "true" : "false"}
      >
        <span className="kpi-ov-eb">Cost of goods sold, {grainLabel}</span>
        <span className="kpi-ov-gl">bars are spend · line is the budget</span>
        <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
      </button>
      {open && body}
    </div>
  );
}
