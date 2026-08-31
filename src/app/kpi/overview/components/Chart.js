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

function BarTip({ title, rows, res }) {
  return (
    <span className="kpi-ov-bt">
      <div className="kpi-ov-bt-h">{title}</div>
      {rows.map((r, i) => (
        <div key={i} className="kpi-ov-bt-r">
          <span>{r[0]}</span>
          <b>{r[1]}</b>
        </div>
      ))}
      {res && (
        <div className="kpi-ov-bt-r res">
          <span>{res[0]}</span>
          <b>{res[1]}</b>
        </div>
      )}
    </span>
  );
}

function ChartPeriodGrain({ series }) {
  const spends = series.map(s => Number(s.spent || 0));
  const budgets = series.map(s => Number(s.budget || 0));
  const mx = Math.max(...spends, ...budgets, 1);

  return (
    <div className="kpi-ov-card kpi-ov-card-cogs kpi-ov-mt" data-kpi-ov="chart" data-kpi-ov-grain="period">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Cost of goods sold, period by period</span>
        <span className="kpi-ov-gl">bars are spend · line is budget</span>
        <HelpPop
          id="overview-chart-period"
          title="Cost of goods sold by period"
          body={<p>Each period's cost of goods sold against its budget. Below the line is under budget. The running period is hatched. Hover a bar for the numbers.</p>}
        />
        <span className="kpi-ov-pill kpi-ov-pill-neutral">{series.length} periods</span>
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-bars">
          {series.map((s, i) => {
            const val = Number(s.spent || 0);
            const bud = Number(s.budget || 0);
            const hgt = val > 0 ? Math.max(2, Math.round((val / mx) * 100)) : 2;
            const over = val - bud;
            const classSuffix =
              s.state === "in_progress" ? "kpi-ov-bar-hatch"
              : s.state === "not_started" ? "kpi-ov-bar-dash"
              : val <= bud ? "kpi-ov-bar-good"
              : "kpi-ov-bar-over";
            return (
              <i
                key={i}
                className={`kpi-ov-bar ${classSuffix}`}
                style={{ height: `${hgt}%` }}
                data-kpi-ov-bar-state={s.state}
                data-kpi-ov-period={s.period_no}
              >
                <BarTip
                  title={`P${s.period_no}${s.state === "in_progress" ? " · running" : ""}`}
                  rows={[
                    ["Spent", val > 0 || s.state !== "not_started" ? fmtMoney(val) : "-"],
                    ["Budget", fmtMoney(bud) || "-"],
                  ]}
                  res={s.state === "in_progress" || s.state === "not_started" ? null : [over <= 0 ? "Under" : "Over", fmtMoney(Math.abs(over))]}
                />
              </i>
            );
          })}
        </div>
        <div className="kpi-ov-axis">
          {series.map((s, i) => (
            <span key={i}>
              P{s.period_no}
              <span className={`kpi-ov-amt ${s.state === "in_progress" || s.state === "not_started" ? "kpi-ov-nb" : (Number(s.spent || 0) <= Number(s.budget || 0) ? "kpi-ov-good" : "kpi-ov-bad")}`}>
                {s.state === "in_progress" ? "running" : s.state === "not_started" ? "not started" : fmtMoney(Number(s.spent || 0))}
              </span>
            </span>
          ))}
        </div>
        <div className="kpi-ov-legend">
          <span><i className="kpi-ov-bar-good" />under budget</span>
          <span><i className="kpi-ov-bar-over" />over budget</span>
          <span><i className="kpi-ov-bar-hatch" />running</span>
        </div>
      </div>
    </div>
  );
}

function ChartWeekGrain({ series, weeklyBudget }) {
  const wkB = Number(weeklyBudget || 0);
  const spends = series.map(s => Number(s.spent || 0));
  const mx = Math.max(wkB, ...spends, 1);
  const totalWeeks = series.length;
  const closedCount = series.filter(s => s.state === "closed").length;

  const fmtWeekLabel = (ws, we) => {
    const [wy, wm, wd] = ws.split("-");
    const [ey, em, ed] = we.split("-");
    return `${wm}/${wd} - ${em}/${ed}`;
  };

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
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-bars">
          {wkB > 0 && (
            <div className="kpi-ov-tgt" style={{ bottom: `${Math.round((wkB / mx) * 100)}%` }}>
              <em>budget {fmtMoney(wkB)} / wk</em>
            </div>
          )}
          {series.map((s, i) => {
            const val = Number(s.spent || 0);
            if (s.state === "not_started") {
              return (
                <i key={i} className="kpi-ov-bar kpi-ov-bar-dash" data-kpi-ov-bar-state="not_started" data-kpi-ov-week-start={s.week_start}>
                  <BarTip
                    title={`Week ${i + 1} · ${fmtWeekLabel(s.week_start, s.week_end)}`}
                    rows={[["Not started", "no data yet"]]}
                  />
                </i>
              );
            }
            const hgt = val > 0 ? Math.max(2, Math.round((val / mx) * 100)) : 2;
            const over = val - wkB;
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
              >
                <BarTip
                  title={`Week ${i + 1} · ${fmtWeekLabel(s.week_start, s.week_end)}${s.state === "in_progress" ? " · running" : ""}`}
                  rows={[
                    ["Spent", fmtMoney(val)],
                    ["Budget", fmtMoney(wkB) || "-"],
                  ]}
                  res={s.state === "in_progress" ? null : [over <= 0 ? "Under" : "Over", fmtMoney(Math.abs(over))]}
                />
              </i>
            );
          })}
        </div>
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
      </div>
    </div>
  );
}

export default function Chart({ chart }) {
  if (!chart || !Array.isArray(chart.series) || chart.series.length === 0) {
    return null;
  }
  if (chart.grain === "period") {
    return <ChartPeriodGrain series={chart.series} />;
  }
  return <ChartWeekGrain series={chart.series} weeklyBudget={chart.weekly_budget} />;
}
