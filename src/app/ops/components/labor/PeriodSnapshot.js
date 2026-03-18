"use client";
import { useState } from "react";
import F from "@/app/ops/components/shared/F";
import SousAI from "@/app/ops/components/labor/SousAI";

export default function PeriodSnapshot({ data, plannerData, acctLabel, acctLevel }) {
  const [selectedIdx, setSelectedIdx] = useState(null);

  if (!data?.periodSummary || !data?.periodCards) {
    return <div className="oh-card" style={{ textAlign: "center", padding: 40 }}><p className="oh-card-desc">Select an account first.</p></div>;
  }

  const ps = data.periodSummary;
  const cards = data.periodCards || [];
  const sm = data.seasonMetrics || {};
  const homestands = plannerData?.homestands || [];
  const isPDC = acctLevel === "PDC";
  const isMLB = acctLevel === "MLB";
  const isMiLB = acctLevel === "MILB" || acctLevel === "AAA";
  const isSeasonal = isMLB || isMiLB;

  const periods = ps.map((p) => {
    const card = cards.find((c) => c.id === p.period);
    const hasPlan = card?.plan != null;
    const status = card?.status || "upcoming";
    const startDate = card?.startDate || "";
    const endDate = card?.endDate || "";
    const calendarDays = card?.calendarDays || 28;

    let daysElapsed = 0;
    if (status === "in_progress" && startDate) {
      const start = new Date(startDate + "T00:00:00");
      const now = new Date();
      daysElapsed = Math.max(1, Math.round((now - start) / (1000 * 60 * 60 * 24)) + 1);
      daysElapsed = Math.min(daysElapsed, calendarDays);
    }

    let gameDays = 0;
    if (isSeasonal && homestands.length > 0) {
      homestands.forEach((hs) => {
        if (hs.days) {
          hs.days.forEach((d) => {
            if (d.period === p.period && d.dayType === "GAME") gameDays++;
          });
        }
      });
    }

    return {
      ...p, hasPlan, status, startDate, endDate, calendarDays, daysElapsed, gameDays,
      revActual: p.revenueActual || 0, actLabor: p.actualLabor || 0, actFood: p.actualFood || 0, actPkg: p.actualPackaging || 0,
    };
  });

  const autoIdx = (() => {
    const ip = periods.findIndex((p) => p.status === "in_progress");
    if (ip >= 0) return ip;
    const lastActual = periods.reduce((last, p, i) => (p.hasPlan ? i : last), -1);
    return lastActual >= 0 ? lastActual : 0;
  })();
  const activeIdx = selectedIdx !== null ? selectedIdx : autoIdx;
  const period = periods[activeIdx];

  if (!period) {
    return <div className="oh-card" style={{ textAlign: "center", padding: 40 }}><p className="oh-card-desc">No period data available for this account yet.</p></div>;
  }

  const hasActuals = period.hasPlan;
  const isOpen = period.status === "in_progress";
  const b = { labor: period.budget, food: period.foodBudget || 0, pkg: period.packagingBudget || 0, revenue: period.revenue };
  const a = { labor: period.actLabor, food: period.actFood, pkg: period.actPkg, revenue: period.revActual || period.revenue };

  const revRatio = a.revenue > 0 && b.revenue > 0 ? a.revenue / b.revenue : 1;
  const laborTarget = b.labor * revRatio;
  const foodTarget = b.food * revRatio;
  const pkgTarget = b.pkg * revRatio;
  const laborVar = hasActuals ? Math.round(laborTarget - a.labor) : 0;
  const foodVar = hasActuals ? Math.round(foodTarget - a.food) : 0;
  const pkgVar = hasActuals ? Math.round(pkgTarget - a.pkg) : 0;
  const totalVar = laborVar + foodVar + pkgVar;

  const pacing = isOpen && hasActuals && period.daysElapsed > 0 ? {
    through: period.daysElapsed / period.calendarDays,
    daysLeft: period.calendarDays - period.daysElapsed,
    laborBurn: a.labor / b.labor,
    foodBurn: a.food / b.food,
    pkgBurn: b.pkg > 0 ? a.pkg / b.pkg : 0,
    laborProj: (a.labor / period.daysElapsed) * period.calendarDays,
    foodProj: (a.food / period.daysElapsed) * period.calendarDays,
    pkgProj: b.pkg > 0 ? (a.pkg / period.daysElapsed) * period.calendarDays : 0,
  } : null;

  const trendPeriods = periods.filter((p) => p.hasPlan);
  const laborPctTrend = trendPeriods.map((p) => p.actLabor / (p.revActual || p.revenue));
  const revenueTrend = trendPeriods.map((p) => p.revActual || 0);

  const unitLabel = isSeasonal ? "game day" : "working day";
  const unitDays = isSeasonal ? (period.gameDays || period.workingDays) : period.workingDays;
  const laborPerUnit = hasActuals && unitDays > 0 ? a.labor / unitDays : 0;
  const budgetPerUnit = unitDays > 0 ? b.labor / unitDays : 0;
  const laborPerUnitTrend = trendPeriods.map((p) => {
    const ud = isSeasonal ? (p.gameDays || p.workingDays) : p.workingDays;
    return ud > 0 ? p.actLabor / ud : 0;
  });

  const ytdB = { labor: 0, food: 0, pkg: 0, revenue: 0 };
  const ytdA = { labor: 0, food: 0, pkg: 0, revenue: 0 };
  const seasonB = { labor: 0, food: 0, pkg: 0, revenue: 0 };
  let ytdPeriodCount = 0;
  periods.forEach((p) => {
    seasonB.labor += p.budget; seasonB.food += p.foodBudget || 0;
    seasonB.pkg += p.packagingBudget || 0; seasonB.revenue += p.revenue;
    if (p.hasPlan) {
      ytdPeriodCount++;
      ytdB.labor += p.budget; ytdB.food += p.foodBudget || 0;
      ytdB.pkg += p.packagingBudget || 0; ytdB.revenue += p.revenue;
      ytdA.labor += p.actLabor; ytdA.food += p.actFood;
      ytdA.pkg += p.actPkg; ytdA.revenue += p.revActual || 0;
    }
  });

  const periodHSData = isMLB ? homestands.filter((hs) =>
    hs.periodsTouched && hs.periodsTouched.includes(period.period)
  ).map((hs) => {
    const daysInPeriod = hs.days ? hs.days.filter((d) => d.period === period.period).length : 0;
    const gameDaysInPeriod = hs.days ? hs.days.filter((d) => d.period === period.period && d.dayType === "GAME").length : 0;
    const ratio = hs.totalDays > 0 ? daysInPeriod / hs.totalDays : 0;
    const laborBudget = hs.budgetEnvelope ? Math.round(hs.budgetEnvelope * ratio) : 0;
    const laborActual = hs.plan ? Math.round(hs.plan.actualSpent * ratio) : 0;
    return { name: hs.id, days: daysInPeriod, gameDays: gameDaysInPeriod, laborBudget, laborActual, hasActual: hs.plan != null, status: hs.status };
  }) : [];

  const fmt = (v) => {
    if (v == null) return "\u2014";
    const neg = v < 0;
    const abs = Math.abs(Math.round(v));
    return (neg ? "-$" : "$") + abs.toLocaleString();
  };
  const pctFmt = (v) => v == null ? "\u2014" : Math.round(v * 100) + "%";

  const Spark = ({ data: d, color, w = 120, h = 32 }) => {
    if (!d || d.length < 2) return null;
    const mn = Math.min(...d) * 0.9, mx = Math.max(...d) * 1.1, rng = mx - mn || 1;
    const pts = d.map((v, i) => `${(i / (d.length - 1)) * w},${h - ((v - mn) / rng) * h}`);
    return (
      <svg width={w} height={h} style={{ display: "block" }}>
        <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {d.map((v, i) => {
          const x = (i / (d.length - 1)) * w, y = h - ((v - mn) / rng) * h;
          return <circle key={i} cx={x} cy={y} r={i === d.length - 1 ? 3 : 2} fill={i === d.length - 1 ? color : "#fff"} stroke={color} strokeWidth="1.5" />;
        })}
      </svg>
    );
  };

  const Bar = ({ value, max, color = "#3b82f6" }) => {
    const w = max > 0 ? Math.min((value / max) * 100, 110) : 0;
    const c = w > 100 ? "#dc2626" : w > 85 ? "#f59e0b" : color;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 90 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#e2e8f0", overflow: "hidden" }}>
          <div style={{ width: `${Math.min(w, 100)}%`, height: "100%", borderRadius: 3, background: c, transition: "width 0.4s" }} />
        </div>
        <span className="oh-snap-mono" style={{ minWidth: 32, textAlign: "right", color: c }}>{Math.round(w)}%</span>
      </div>
    );
  };

  const Pill = ({ value }) => {
    if (value == null) return null;
    const pos = value >= 0;
    return (
      <span className="oh-snap-pill" style={{ color: pos ? "#16a34a" : "#dc2626", background: pos ? "#f0fdf4" : "#fef2f2" }}>
        {value > 0 ? "+" : ""}{fmt(value)}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="oh-snap-header">
        <div>
          <h3 className="oh-snap-title">Period Snapshot</h3>
          <span className="oh-snap-subtitle">{acctLabel}</span>
        </div>
        <select className="oh-snap-period-select" value={activeIdx} onChange={(e) => setSelectedIdx(Number(e.target.value))}>
          {periods.map((p, i) => (
            <option key={p.period} value={i}>
              {p.period}{p.hasPlan ? " \u2713" : ""}{p.status === "in_progress" ? " (current)" : ""}
            </option>
          ))}
        </select>
      </div>

      {!hasActuals ? (
        <div className="oh-snap-card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{"\u{1F4C5}"}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#64748b" }}>No actuals yet for {period.period}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
            Budget: {fmt(b.revenue)} revenue {"\u00B7"} {fmt(b.labor)} labor {"\u00B7"} {unitDays} {isSeasonal ? "game" : "working"} days
          </div>
        </div>
      ) : (
        <div className="oh-snap-stack">
          <div className="oh-snap-card">
            <div className="oh-snap-section-head">
              <span>{"\u{1F4CA}"} Period Scoreboard</span>
              <span className="oh-snap-section-sub">
                {period.period} {"\u00B7"} {period.status === "completed" || (!isOpen && hasActuals) ? "Closed" : `${Math.round((pacing?.through || 0) * 100)}% through`}
              </span>
            </div>
            <div className="oh-snap-metric-row">
              <div className="oh-snap-metric">
                <span className="oh-snap-metric-label">Revenue</span>
                <span className="oh-snap-metric-value">{fmt(a.revenue)}</span>
                <span className="oh-snap-metric-sub">vs {fmt(b.revenue)} budget</span>
              </div>
              <div className="oh-snap-metric">
                <span className="oh-snap-metric-label">Total Spend</span>
                <span className="oh-snap-metric-value">{fmt(a.labor + a.food + a.pkg)}</span>
                <span className="oh-snap-metric-sub">vs {fmt(b.labor + b.food + b.pkg)} budget</span>
              </div>
              <div className="oh-snap-metric">
                <span className="oh-snap-metric-label">Net Variance</span>
                <span className="oh-snap-metric-value" style={{ color: totalVar >= 0 ? "#16a34a" : "#dc2626" }}>
                  {totalVar > 0 ? "+" : ""}{fmt(totalVar)}
                </span>
                <span className="oh-snap-metric-sub">revenue-adjusted</span>
              </div>
              <div className="oh-snap-metric">
                <span className="oh-snap-metric-label">Gross Margin</span>
                <span className="oh-snap-metric-value">{pctFmt(a.revenue > 0 ? 1 - (a.labor + a.food + a.pkg) / a.revenue : 0)}</span>
                <span className="oh-snap-metric-sub">vs {pctFmt(1 - (b.labor + b.food + b.pkg) / b.revenue)} target</span>
              </div>
            </div>
          </div>

          {pacing && (
            <div className="oh-snap-card">
              <div className="oh-snap-section-head">
                <span>{"\u{1F525}"} Budget Burn</span>
                <span className="oh-snap-section-sub">{Math.round(pacing.through * 100)}% through {"\u00B7"} {pacing.daysLeft} days left</span>
              </div>
              <div className="oh-snap-burn-grid">
                {[
                  { label: "Labor", actual: a.labor, budget: b.labor, proj: pacing.laborProj },
                  { label: "Food", actual: a.food, budget: b.food, proj: pacing.foodProj },
                  { label: "Pkg & Supplies", actual: a.pkg, budget: b.pkg, proj: pacing.pkgProj },
                ].filter((r) => r.budget > 0).map((row) => {
                  const projOver = row.proj > row.budget;
                  const overPace = (row.actual / row.budget) > pacing.through + 0.05;
                  return (
                    <div key={row.label} className="oh-snap-burn-row">
                      <span className="oh-snap-burn-label">{row.label}</span>
                      <Bar value={row.actual} max={row.budget} color={overPace ? "#f59e0b" : "#3b82f6"} />
                      <span className="oh-snap-mono oh-snap-burn-actual">{fmt(row.actual)}</span>
                      <span className="oh-snap-burn-left">{fmt(row.budget - row.actual)} left</span>
                      <span className={`oh-snap-burn-proj${projOver ? " oh-snap-burn-proj--over" : ""}`}>
                        {projOver ? "\u26A0 " : ""}Proj: {fmt(row.proj)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="oh-snap-burn-callout">
                {(() => {
                  const over = pacing.laborProj > b.labor;
                  return <>{"\u{1F4A1}"} At current pace, labor closes at <strong>{fmt(pacing.laborProj)}</strong> ({over ? fmt(pacing.laborProj - b.labor) + " over" : fmt(b.labor - pacing.laborProj) + " under"} budget)</>;
                })()}
              </div>
            </div>
          )}

          <div className="oh-snap-card">
            <div className="oh-snap-section-head">
              <span>{"\u{1F3AF}"} Cost as % of Revenue</span>
              <span className="oh-snap-section-sub">Actual vs budget target</span>
            </div>
            <div className="oh-snap-pct-row">
              {[
                { label: "Labor", actual: a.labor / a.revenue, target: b.labor / b.revenue, color: "#6366f1" },
                { label: "Food", actual: a.food / a.revenue, target: b.food / b.revenue, color: "#f59e0b" },
                ...(b.pkg > 0 ? [{ label: "Pkg", actual: a.pkg / a.revenue, target: b.pkg / b.revenue, color: "#06b6d4" }] : []),
              ].map((cat) => {
                const diff = cat.actual - cat.target;
                const over = diff > 0.005;
                return (
                  <div key={cat.label} className="oh-snap-pct-card">
                    <span className="oh-snap-pct-label">{cat.label}</span>
                    <span className="oh-snap-pct-value" style={{ color: cat.color }}>{pctFmt(cat.actual)}</span>
                    <span className={`oh-snap-pct-diff${over ? " oh-snap-pct-diff--over" : ""}`}>
                      {over ? "\u25B2" : "\u25BC"} {pctFmt(Math.abs(diff))} vs {pctFmt(cat.target)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="oh-snap-card">
            <div className="oh-snap-section-head">
              <span>{"\u{1F4D0}"} Revenue-Adjusted Variance</span>
              <span className="oh-snap-section-sub">Positive = saved {"\u00B7"} Negative = overspent</span>
            </div>
            <div className="oh-snap-var-stack">
              {[
                { label: "Labor", v: laborVar, color: "#6366f1" },
                { label: "Food", v: foodVar, color: "#f59e0b" },
                ...(b.pkg > 0 ? [{ label: "Pkg & Supplies", v: pkgVar, color: "#06b6d4" }] : []),
              ].sort((x, y) => x.v - y.v).map((cat) => (
                <div key={cat.label} className={`oh-snap-var-bar${cat.v < 0 ? " oh-snap-var-bar--neg" : ""}`}>
                  <div className="oh-snap-var-dot" style={{ background: cat.color }} />
                  <span className="oh-snap-var-label">{cat.label}</span>
                  <Pill value={cat.v} />
                </div>
              ))}
            </div>
          </div>

          <div className="oh-snap-card">
            <div className="oh-snap-section-head">
              <span>{isSeasonal ? "\u26BE" : "\u{1F3ED}"} Labor Cost per {isSeasonal ? "Game Day" : "Production Day"}</span>
              <span className="oh-snap-section-sub">{unitDays} {isSeasonal ? "game" : "working"} days this period</span>
            </div>
            <div className="oh-snap-metric-row">
              <div className="oh-snap-metric">
                <span className="oh-snap-metric-label">This Period</span>
                <span className="oh-snap-metric-value" style={{ fontSize: 22 }}>{fmt(laborPerUnit)}</span>
                <span className="oh-snap-metric-sub">per {unitLabel}</span>
              </div>
              <div className="oh-snap-metric">
                <span className="oh-snap-metric-label">Budget Target</span>
                <span className="oh-snap-metric-value" style={{ fontSize: 22 }}>{fmt(budgetPerUnit)}</span>
                <span className="oh-snap-metric-sub">per {unitLabel}</span>
              </div>
              {laborPerUnitTrend.length > 1 && (
                <div className="oh-snap-metric" style={{ alignItems: "flex-end" }}>
                  <span className="oh-snap-metric-label">Trend</span>
                  <Spark data={laborPerUnitTrend} color="#6366f1" w={140} h={36} />
                  <span className="oh-snap-metric-sub">{trendPeriods.map((p) => p.period).join(" \u2192 ")}</span>
                </div>
              )}
            </div>
          </div>

          {isMLB && periodHSData.length > 0 && (
            <div className="oh-snap-card">
              <div className="oh-snap-section-head">
                <span>{"\u{1F3DF}\uFE0F"} Homestand Performance</span>
                <span className="oh-snap-section-sub">Labor budget vs actual per homestand</span>
              </div>
              <div className="oh-snap-table">
                <div className="oh-snap-table-head">
                  <span>Stand</span><span>Days</span><span>Burn</span>
                  <span style={{ textAlign: "right" }}>Budget</span>
                  <span style={{ textAlign: "right" }}>Actual</span>
                  <span style={{ textAlign: "right" }}>Var</span>
                </div>
                {periodHSData.map((hs) => (
                  <div key={hs.name} className={`oh-snap-table-row${!hs.hasActual ? " oh-snap-table-row--dim" : ""}`}>
                    <span className="oh-snap-table-name">{hs.name}</span>
                    <span className="oh-snap-table-days">{hs.days}d</span>
                    {hs.hasActual ? (
                      <Bar value={hs.laborActual} max={hs.laborBudget} color="#6366f1" />
                    ) : (
                      <span className="oh-snap-table-upcoming">upcoming</span>
                    )}
                    <span className="oh-snap-mono" style={{ textAlign: "right", color: "#94a3b8" }}>{fmt(hs.laborBudget)}</span>
                    <span className="oh-snap-mono" style={{ textAlign: "right", color: hs.hasActual ? "#334155" : "#cbd5e1" }}>
                      {hs.hasActual ? fmt(hs.laborActual) : "\u2014"}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      {hs.hasActual ? <Pill value={hs.laborBudget - hs.laborActual} /> : <span style={{ color: "#cbd5e1" }}>{"\u2014"}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="oh-snap-card">
            <div className="oh-snap-section-head">
              <span>{"\u{1F4C8}"} {isPDC ? "Year" : "Season"}-to-Date</span>
              <span className="oh-snap-section-sub">{ytdPeriodCount} of {periods.length} periods reporting</span>
            </div>
            <div className="oh-snap-ytd-row">
              {[
                { label: "Revenue", actual: ytdA.revenue, budget: ytdB.revenue, rev: true },
                { label: "Labor", actual: ytdA.labor, budget: ytdB.labor },
                { label: "Food", actual: ytdA.food, budget: ytdB.food },
                ...(ytdB.pkg > 0 ? [{ label: "Pkg", actual: ytdA.pkg, budget: ytdB.pkg }] : []),
              ].map((cat) => {
                const v = cat.rev ? cat.actual - cat.budget : cat.budget - cat.actual;
                return (
                  <div key={cat.label} className="oh-snap-ytd-card">
                    <span className="oh-snap-ytd-label">{cat.label}</span>
                    <span className="oh-snap-ytd-value">{fmt(cat.actual)}</span>
                    <div className="oh-snap-ytd-bottom">
                      <span className="oh-snap-ytd-vs">vs {fmt(cat.budget)}</span>
                      <Pill value={v} />
                    </div>
                  </div>
                );
              })}
            </div>
            {laborPctTrend.length > 1 && (
              <div className="oh-snap-trend-row">
                <div>
                  <span className="oh-snap-metric-label">Labor % of Revenue</span>
                  <Spark data={laborPctTrend} color="#6366f1" w={180} h={40} />
                  <div className="oh-snap-trend-labels">
                    {trendPeriods.map((p, i) => <span key={p.period}>{p.period}: {pctFmt(laborPctTrend[i])}</span>)}
                  </div>
                </div>
                <div>
                  <span className="oh-snap-metric-label">Revenue</span>
                  <Spark data={revenueTrend} color="#16a34a" w={180} h={40} />
                  <div className="oh-snap-trend-labels">
                    {trendPeriods.map((p, i) => <span key={p.period}>{p.period}: {fmt(revenueTrend[i])}</span>)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {pacing && trendPeriods.length > 0 && (
            <div className="oh-snap-card oh-snap-card--dark">
              <div className="oh-snap-section-head">
                <span>{"\u{1F52E}"} {isPDC ? "Annual" : "Season"} Projection</span>
                <span className="oh-snap-section-sub" style={{ color: "rgba(255,255,255,0.5)" }}>If current spending patterns continue</span>
              </div>
              <div className="oh-snap-proj-row">
                {[
                  { label: `Projected ${isPDC ? "Annual" : "Season"} Labor`, actual: ytdA.labor, budget: seasonB.labor },
                  { label: `Projected ${isPDC ? "Annual" : "Season"} Food`, actual: ytdA.food, budget: seasonB.food },
                ].map((proj) => {
                  const tpDays = trendPeriods.reduce((s, p) => s + (p.workingDays || p.calendarDays), 0);
                  const allDays = periods.reduce((s, p) => s + (p.workingDays || p.calendarDays), 0);
                  const projected = tpDays > 0 ? (proj.actual / tpDays) * allDays : 0;
                  const delta = proj.budget - projected;
                  return (
                    <div key={proj.label} className="oh-snap-proj-card">
                      <span className="oh-snap-proj-label">{proj.label}</span>
                      <span className="oh-snap-proj-value">{fmt(projected)}</span>
                      <span className="oh-snap-proj-delta" style={{ color: delta >= 0 ? "#4ade80" : "#fca5a5" }}>
                        {delta >= 0 ? `${fmt(delta)} under budget` : `${fmt(Math.abs(delta))} over budget`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hasActuals && (
            <SousAI
              periodId={period.period}
              periodData={{
                period: period.period, account: acctLabel,
                status: period.status === "in_progress" ? "in progress" : isOpen ? "in progress" : "closed",
                revActual: a.revenue, revBudget: b.revenue, laborActual: a.labor, laborBudget: b.labor,
                foodActual: a.food, foodBudget: b.food, pkgActual: a.pkg, pkgBudget: b.pkg,
                laborVar, foodVar, pkgVar, totalVar,
                grossMargin: a.revenue > 0 ? Math.round((1 - (a.labor + a.food + a.pkg) / a.revenue) * 100) + "%" : "N/A",
                grossMarginTarget: pctFmt(1 - (b.labor + b.food + b.pkg) / b.revenue),
                unitDays, unitLabel, laborPerUnit: Math.round(laborPerUnit), laborPerUnitTarget: Math.round(budgetPerUnit),
                pacing: pacing ? { through: Math.round(pacing.through * 100) + "%", laborProj: Math.round(pacing.laborProj), foodProj: Math.round(pacing.foodProj), daysLeft: pacing.daysLeft } : null,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}