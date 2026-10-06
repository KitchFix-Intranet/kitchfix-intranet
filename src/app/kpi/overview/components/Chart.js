"use client";
// src/app/kpi/overview/components/Chart.js
//
// Element 6. Cost of goods sold vs budget. **Period grain only** as
// of Kevin ruling 2026-10-06. The week-grain variant was retired
// because WeekRail.js above it already renders an honest week-by-
// week cost view that reads per-week target from each week's own
// revenue, hatches the trailing week with an explicit invoice-lag
// rule, and marks not-yet-landed weeks - all four things the week-
// grain chart lacked. Two surfaces computing the same idea from
// different inputs and disagreeing was the fracture GOTCHAS.md §9B
// names.
//
//   - Bars are spend. Bar colour carries the comparison to budget:
//     green under, red over.
//   - Multi-period / FYTD (grain='period'): one bar per fiscal
//     period; running period hatched.
//   - Single-period views emit chart=null from the resolver and this
//     component renders nothing.
//
// Payload contract (resolver §17):
//   chart === null                    on single-period ranges
//   chart.grain: 'period'             on multi-period / FYTD ranges
//   chart.series[]: [{ period_no, state, spent, budget }]
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

// Kevin ruling 2026-09-03 (simplified-layout): the chart moves to
// the bottom of the board and renders as a fold. Both P&L + Chart
// are folds; neither is open by default. `open` + `onToggle` optional
// so the portfolio branch (no fold state wired) still renders inline.
export default function Chart({ chart, revenueModel, open, onToggle }) {
  // Single-period ranges now emit chart=null from the resolver (Kevin
  // ruling 2026-10-06, week-grain retirement). The resolver's non-null
  // chart is always grain='period', so this component always renders
  // the period-grain variant and only needs to guard against empty
  // / missing series.
  if (!chart || !Array.isArray(chart.series) || chart.series.length === 0) {
    return null;
  }
  if (typeof onToggle !== "function") {
    // Portfolio branch: self-contained card.
    return <ChartPeriodGrain series={chart.series} revenueModel={revenueModel} />;
  }
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
        <span className="kpi-ov-eb">Cost of goods sold, period by period</span>
        <span className="kpi-ov-gl">bars are spend</span>
        <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
      </button>
      {open && <ChartPeriodGrain series={chart.series} revenueModel={revenueModel} bare />}
    </div>
  );
}
