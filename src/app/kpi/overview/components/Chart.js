"use client";
// src/app/kpi/overview/components/Chart.js
//
// Element 6. Cost of goods sold vs budget.
//
//   - Bars are spend. Bar colour carries the comparison to budget:
//     green under, red over. The week grain also draws a horizontal
//     weekly-budget line inside its plot.
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
  // revenue model. SC-driven + sales-based accounts compare to
  // ADJUSTED budget; management-fee accounts compare to PERIOD
  // budget (revenue is contractual, no adjustment applies).
  //
  // Kevin ruling 2026-09-08 item 4: the dashed per-period budget
  // line is removed - Kevin measured that the line did not fall
  // accurately enough on the bars. Bar colouring (green under, red
  // over, against the same budget) stays; the colour carries the
  // comparison and the legend names it. Caption drops the "line is
  // adjusted budget" clause. Help body reworded so it stops
  // referencing a line that is no longer drawn.
  const isManagementFee = revenueModel === "management_fee";
  const helpBody = isManagementFee
    ? <p>Each period&rsquo;s cost of goods sold against its period budget. Revenue is contractual on this account, so no revenue adjustment applies. Green bars are under budget; red are over. The running period is hatched.</p>
    : <p>Each period&rsquo;s cost of goods sold against its adjusted budget (revenue times the target cost percentage). Green bars are under budget; red are over. The running period is hatched.</p>;
  // dashValue still feeds the bar-colour comparison + the axis
  // amount colour, so it stays. Each period's comparator is that
  // period's ADJUSTED budget (period actual revenue × target cost
  // pct). Falls back to the static `budget` when adjusted is null
  // (a period with $0 revenue can't be adjusted; use the plan).
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
        // Kevin ruling 2026-09-09 (post-#1094 follow-up). Same rule
        // the week grain got: a closed period whose invoices are
        // still arriving hatches, whatever its variance. Fires on
        // 09/14 when R-93 pulls P9 into Current year - without the
        // hatch the P9 bar would render solid while invoices are
        // still landing. Server-side `invoices_landed` is true for
        // verified periods (finance signed off) OR closed_awaiting
        // periods where today's fiscal period is 2+ periods past
        // the target, matching the week grain's 2-unit rule.
        const invoicesStillArriving = s.state === "closed" && s.invoices_landed === false;
        const classSuffix =
          s.state === "in_progress" ? "kpi-ov-bar-hatch"
          : s.state === "not_started" ? "kpi-ov-bar-dash"
          : invoicesStillArriving ? "kpi-ov-bar-hatch"
          : val <= bud ? "kpi-ov-bar-good"
          : "kpi-ov-bar-over";
        // Kevin ruling 2026-09-08 item 4: per-period dashed budget
        // line removed. bud is still consumed by the bar-colour
        // classSuffix compare above; the dash render below is gone.
        // Kevin walkthrough sweep addendum F (2026-09-07). Hatched
        // slice for the unapproved-labor portion within the bar,
        // matching Labor Tier A. Ratio = unapproved_labor_$ / spent
        // clamped to 100; slice sits at the TOP of the bar in the
        // same height envelope, so the bar total is unchanged and
        // the reader sees "same lever, different state." Uses the
        // grey-hatched .kpi-ov-bar-unapp treatment.
        const unappD = Number(s.unapproved_labor_dollars || 0);
        const unappRatio = (unappD > 0 && val > 0.5) ? Math.min(1, unappD / val) : 0;
        const unappPctOfBar = unappRatio > 0 ? unappRatio * 100 : 0;
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
            {unappPctOfBar > 0 && (
              <span
                className="kpi-ov-bar-unapp"
                style={{
                  height: `${unappPctOfBar}%`,
                  bottom: `${100 - unappPctOfBar}%`,
                }}
                title={`~${Math.round(unappD).toLocaleString("en-US")} labor $ awaiting approval`}
                aria-label={`${Math.round(unappD).toLocaleString("en-US")} dollars of labor awaiting approval`}
                data-kpi-ov="bar-unapp-slice"
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
        <span className="kpi-ov-gl">bars are spend</span>
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
  //
  // Kevin CC prompt 2026-09-10 item 3. Dashed target line + "budget
  // $X / wk" legend removed - Kevin's ruling matches the period-
  // grain removal from #1073: bar height and bar colour carry the
  // verdict on their own axis, and the line has no shared scale
  // with the bars so it reads as misleading. `wkB` (weekly budget)
  // stays in scope - the per-bar good/bad classSuffix below still
  // compares to it as the numeric target; only the visual line +
  // its legend are gone.
  const bars = (
    <div className="kpi-ov-bars kpi-ov-bars-inset">
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
        // Kevin CC prompt 2026-09-09 item 1. A closed week whose
        // invoices are still arriving hatches, whatever its variance
        // vs budget. The bar treatment must not disagree with the
        // WeekRail card's "Invoices still arriving" caveat under the
        // same week - the two answer the same question. Rule (in
        // resolver.js): closed week && (today's fiscal-week Monday -
        // week Monday) >= 14 days. On Current period + Next period
        // this reduces to `running_week_no - week_no >= 2` by
        // construction; on Last period + Current year it correctly
        // hatches the just-closed week whose invoices are still
        // landing (P9 week 4 on 2026-09-09).
        const invoicesStillArriving = s.state === "closed" && s.invoices_landed === false;
        const classSuffix =
          s.state === "in_progress" ? "kpi-ov-bar-hatch"
          : invoicesStillArriving ? "kpi-ov-bar-hatch"
          : val <= wkB ? "kpi-ov-bar-good"
          : "kpi-ov-bar-over";
        return (
          <i
            key={i}
            className={`kpi-ov-bar ${classSuffix}`}
            style={{ height: `${hgt}%` }}
            data-kpi-ov-bar-state={s.state}
            data-kpi-ov-bar-invoices-landed={s.invoices_landed ? "1" : "0"}
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
          {/* Kevin Prompt 1 item 1d (2026-09-04): the in-progress week
              shows its live figure with "so far" rather than the word
              "running" - the operator already reads the running week
              separately, so show what it says. Not-started weeks still
              render the dash placeholder. Closed weeks render their
              spend with the good/bad verdict. */}
          <span className={`kpi-ov-amt ${s.state === "closed" ? (Number(s.spent || 0) <= (wkB || 0) ? "kpi-ov-good" : "kpi-ov-bad") : "kpi-ov-nb"}`}>
            {s.state === "not_started" ? "- starts later"
              : s.state === "in_progress" ? (
                <>{fmtMoney(Number(s.spent || 0))} <i className="kpi-ov-chart-sofar" data-kpi-ov="chart-week-sofar">so far</i></>
              )
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
        {bars}
        {axis}
      </div>
    );
  }
  return (
    <div className="kpi-ov-card kpi-ov-card-cogs kpi-ov-mt" data-kpi-ov="chart" data-kpi-ov-grain="week">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Cost of goods sold, week by week</span>
        {/* Kevin CC prompt 2026-09-10 item 3. Dashed weekly-budget
            line + its "line is the weekly budget" caption removed
            (matches the period-grain removal from #1073). Subtitle
            names the source; the help body no longer references a
            line that isn't drawn. */}
        <span className="kpi-ov-gl">labour and purchases, live to date</span>
        <HelpPop
          id="overview-chart-week"
          title="Cost of goods sold by week"
          body={
            <p>
              Green is under the weekly budget, red is over. Unstarted weeks show a dash, not a zero - a week that has not begun cannot be judged. Weeks in progress are hatched.
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
        <span className="kpi-ov-gl">
          {chart.grain === "period"
            ? "bars are spend"
            : "bars are spend · line is the budget"}
        </span>
        <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
      </button>
      {open && body}
    </div>
  );
}
