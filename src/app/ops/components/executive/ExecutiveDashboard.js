"use client";
import { useState, useEffect } from "react";
import ExecDonutChart from "@/app/ops/components/executive/ExecDonutChart";
import ExecSVGTrend from "@/app/ops/components/executive/ExecSVGTrend";
import ExecRevenueVsCost from "@/app/ops/components/executive/ExecRevenueVsCost";
import ExecSparkline from "@/app/ops/components/executive/ExecSparkline";
import ExecDivisionCard from "@/app/ops/components/executive/ExecDivisionCard";

export default function ExecutiveDashboard({ data, onSelectAccount }) {
  const [sousState, setSousState] = useState("idle");
  const [sousBullets, setSousBullets] = useState([]);
  const [sousTone, setSousTone] = useState("neutral");
  const [sousVisible, setSousVisible] = useState(0);
  const [sousError, setSousError] = useState("");

  useEffect(() => {
    if (sousState === "done" && sousVisible < sousBullets.length) {
      const t = setTimeout(() => setSousVisible((v) => v + 1), 400);
      return () => clearTimeout(t);
    }
  }, [sousState, sousVisible, sousBullets.length]);

  if (!data || data.length === 0) {
    return <div className="oh-card" style={{ textAlign: "center", padding: 40 }}><p className="oh-card-desc">No account data available.</p></div>;
  }

  const mlb = data.filter((a) => a.level === "MLB");
  const pdc = data.filter((a) => a.level === "PDC");
  const milb = data.filter((a) => a.level === "MILB" || a.level === "AAA");

  const port = {
    revBudget: data.reduce((s, a) => s + (a.seasonRevenue || 0), 0),
    revActual: data.reduce((s, a) => s + (a.revenueActualTotal || 0), 0),
    laborBudget: data.reduce((s, a) => s + (a.seasonBudget || 0), 0),
    laborActual: data.reduce((s, a) => s + (a.budgetUsed || 0), 0),
    salaryBudget: data.reduce((s, a) => s + (a.salaryBudget || 0), 0),
    foodBudget: data.reduce((s, a) => s + (a.totalFoodBudget || 0), 0),
    foodActual: data.reduce((s, a) => s + (a.foodActualTotal || 0), 0),
    packBudget: data.reduce((s, a) => s + (a.totalPackagingBudget || 0), 0),
    packActual: data.reduce((s, a) => s + (a.packagingActualTotal || 0), 0),
    netVariance: data.reduce((s, a) => s + (a.cumulativeVariance || 0), 0),
    completed: data.reduce((s, a) => s + (a.completed || 0), 0),
    total: data.reduce((s, a) => s + (a.total || 0), 0),
  };
  port.cogsBudget = port.laborBudget + port.foodBudget + port.packBudget;
  port.cogsActual = port.laborActual + port.foodActual + port.packActual;
  port.laborVar = port.laborBudget - port.laborActual;
  port.foodVar = port.foodBudget - port.foodActual;
  port.packVar = port.packBudget - port.packActual;

  const allPeriodNames = new Set();
  const periodReporting = {};
  data.forEach((a) => {
    (a.periodData || []).forEach((p) => {
      allPeriodNames.add(p.period);
      if (!periodReporting[p.period]) periodReporting[p.period] = { reported: 0, total: 0 };
      periodReporting[p.period].total++;
      if (p.completed) periodReporting[p.period].reported++;
    });
  });
  const periodNames = [...allPeriodNames].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, "")) || 0;
    const nb = parseInt(b.replace(/\D/g, "")) || 0;
    return na - nb;
  });
  const totalPeriods = periodNames.length;

  let currentPeriod = periodNames[0] || "P1";
  let periodsCompleted = 0;
  for (const pn of periodNames) {
    const pr = periodReporting[pn];
    if (pr && pr.reported > 0) {
      currentPeriod = pn;
      if (pr.reported === pr.total) periodsCompleted++;
    }
  }
  const currentPR = periodReporting[currentPeriod] || { reported: 0, total: data.length };
  const acctReporting = currentPR.reported;
  const acctTotal = currentPR.total || data.length;
  const periodsWithData = periodNames.filter(pn => periodReporting[pn]?.reported > 0).length;
  const seasonPctElapsed = totalPeriods > 0 ? Math.round((periodsWithData / totalPeriods) * 100) : 0;

  const cpPL = { revBudget: 0, revActual: 0, laborBudget: 0, laborActual: 0, foodBudget: 0, foodActual: 0, packBudget: 0, packActual: 0, salaryBudget: 0 };
  const cpSites = [];
  data.forEach((a) => {
    const p = (a.periodData || []).find(pd => pd.period === currentPeriod);
    if (p && p.completed) {
      cpPL.revBudget += p.revenueBudget || 0;
      cpPL.revActual += p.revenueActual || 0;
      cpPL.laborBudget += p.laborBudget || 0;
      cpPL.laborActual += p.laborActual || 0;
      cpPL.foodBudget += p.foodBudget || 0;
      cpPL.foodActual += p.foodActual || 0;
      cpPL.packBudget += p.packBudget || 0;
      cpPL.packActual += p.packActual || 0;
      cpPL.salaryBudget += p.salaryBudget || 0;
      cpSites.push({
        key: a.key, label: a.label || a.name, level: a.level,
        revBudget: p.revenueBudget || 0, revActual: p.revenueActual || 0,
        laborBudget: p.laborBudget || 0, laborActual: p.laborActual || 0,
        foodBudget: p.foodBudget || 0, foodActual: p.foodActual || 0,
        packBudget: p.packBudget || 0, packActual: p.packActual || 0,
      });
    }
  });
  cpSites.sort((a, b) => b.revActual - a.revActual);
  cpPL.cogsBudget = cpPL.laborBudget + cpPL.foodBudget + cpPL.packBudget;
  cpPL.cogsActual = cpPL.laborActual + cpPL.foodActual + cpPL.packActual;
  cpPL.revVar = cpPL.revActual - cpPL.revBudget;
  cpPL.cogsVar = cpPL.cogsBudget - cpPL.cogsActual;
  cpPL.gmBudget = cpPL.revBudget - cpPL.cogsBudget;
  cpPL.gmActual = cpPL.revActual - cpPL.cogsActual;
  cpPL.gmVar = cpPL.gmActual - cpPL.gmBudget;
  cpPL.gmPctBudget = cpPL.revBudget > 0 ? (cpPL.gmBudget / cpPL.revBudget * 100) : 0;
  cpPL.gmPctActual = cpPL.revActual > 0 ? (cpPL.gmActual / cpPL.revActual * 100) : 0;
  cpPL.cogsPctBudget = cpPL.revBudget > 0 ? (cpPL.cogsBudget / cpPL.revBudget * 100) : 0;
  cpPL.cogsPctActual = cpPL.revActual > 0 ? (cpPL.cogsActual / cpPL.revActual * 100) : 0;

  const periodMap = {};
  data.forEach((a) => {
    (a.periodData || []).forEach((p) => {
      if (!p.completed) return;
      if (!periodMap[p.period]) periodMap[p.period] = { period: p.period, variance: 0, revBudget: 0, revActual: 0, cogs: 0, labor: 0, food: 0, pack: 0, count: 0 };
      periodMap[p.period].variance += p.variance;
      periodMap[p.period].revBudget += p.revenueBudget || 0;
      periodMap[p.period].revActual += p.revenueActual;
      periodMap[p.period].cogs += p.totalActual;
      periodMap[p.period].labor += p.laborActual;
      periodMap[p.period].food += p.foodActual;
      periodMap[p.period].pack += p.packActual;
      periodMap[p.period].count++;
    });
  });
  const periodTrend = Object.values(periodMap).sort((a, b) => a.period.localeCompare(b.period));

  const accountHealth = data.map((a) => {
    const laborPct = a.seasonBudget > 0 ? ((a.budgetUsed - a.seasonBudget) / a.seasonBudget * 100) : 0;
    const foodPct = a.totalFoodBudget > 0 ? ((a.foodActualTotal - a.totalFoodBudget) / a.totalFoodBudget * 100) : 0;
    const packPct = a.totalPackagingBudget > 0 ? ((a.packagingActualTotal - a.totalPackagingBudget) / a.totalPackagingBudget * 100) : 0;
    const gradeCategory = (pct) => { if (pct <= 0) return "green"; if (pct <= 10) return "amber"; return "red"; };
    const laborGrade = a.completed === 0 ? "none" : gradeCategory(laborPct);
    const foodGrade = a.completed === 0 ? "none" : gradeCategory(foodPct);
    const packGrade = a.completed === 0 ? "none" : gradeCategory(packPct);
    return { ...a, laborPct: Math.round(laborPct), foodPct: Math.round(foodPct), packPct: Math.round(packPct), laborGrade, foodGrade, packGrade };
  });

  const sorted = [...data].filter(a => a.completed > 0).sort((a, b) => a.cumulativeVariance - b.cumulativeVariance);
  const maxAbsVar = Math.max(...sorted.map(a => Math.abs(a.cumulativeVariance)), 1);

  const watchlist = accountHealth.filter(
    (a) => a.completed > 0 && (a.laborGrade === "red" || a.foodGrade === "red" || a.packGrade === "red")
  );

  const runPortfolioAnalysis = async () => {
    setSousState("thinking");
    setSousError("");
    try {
      const redFlags = [];
      watchlist.forEach((a) => {
        if (a.laborGrade === "red") redFlags.push(`${a.label}: Hourly labor ${a.laborPct}% over budget ($${Math.abs(a.budgetUsed - a.seasonBudget).toLocaleString()} overage)`);
        if (a.foodGrade === "red") redFlags.push(`${a.label}: Food ${a.foodPct}% over budget ($${Math.abs(a.foodActualTotal - a.totalFoodBudget).toLocaleString()} overage)`);
      });
      const res = await fetch("/api/ops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sous-portfolio",
          portfolioData: {
            totalAccounts: data.length, mlbCount: mlb.length, pdcCount: pdc.length, milbCount: milb.length,
            totalRevenueBudget: port.revBudget, totalRevenueActual: port.revActual, totalSalaryBudget: port.salaryBudget,
            totalCogsBudget: port.cogsBudget, totalCogsActual: port.cogsActual,
            totalLaborBudget: port.laborBudget, totalLaborActual: port.laborActual,
            totalFoodBudget: port.foodBudget, totalFoodActual: port.foodActual,
            totalPackBudget: port.packBudget, totalPackActual: port.packActual,
            netVariance: port.netVariance, periodsCompleted: periodsWithData, periodsTotal: totalPeriods,
            currentPeriod, acctReporting,
            accountSummaries: data.map(a => ({ name: a.label || a.name, level: a.level, variance: a.cumulativeVariance, completed: a.completed, total: a.total })),
            redFlags,
          },
        }),
      });
      const result = await res.json();
      if (result.success && result.bullets?.length > 0) {
        setSousBullets(result.bullets); setSousTone(result.tone || "neutral"); setSousVisible(0); setSousState("done");
      } else { setSousError(result.error || "No analysis returned"); setSousState("error"); }
    } catch { setSousError("Network error — try again"); setSousState("error"); }
  };

  const fmtDollars = (n) => `$${Math.round(n).toLocaleString()}`;
  const fmtShort = (n) => {
    if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };
  const fmtVar = (n) => { const sign = n >= 0 ? "+" : "-"; return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`; };

  return (
    <div className="oh-exec">
      <div className="oh-exec-header">
        <div>
          <h3 className="oh-exec-title">Portfolio Command Center</h3>
          <p className="oh-exec-subtitle">{data.length} accounts · {currentPeriod} · {acctReporting}/{acctTotal} reporting · {periodsWithData}/{totalPeriods} periods with data</p>
        </div>
      </div>

      {cpPL.revActual > 0 ? (
        <div className="oh-exec-pnl">
          <div className="oh-exec-pnl-header">
            <div>
              <span className="oh-exec-pnl-period">{currentPeriod}</span>
              <span className="oh-exec-pnl-context">{acctReporting}/{acctTotal} accounts reporting</span>
            </div>
            <div className="oh-exec-pnl-annual"><span className="oh-exec-pnl-annual-label">Annual Budget</span></div>
          </div>
          <div className="oh-exec-pnl-table">
            <div className="oh-exec-pnl-row oh-exec-pnl-row--header">
              <span className="oh-exec-pnl-col-name"></span>
              <span className="oh-exec-pnl-col">Budget</span>
              <span className="oh-exec-pnl-col">Actual</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--rev">% Rev</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--var">Fav/{`<Unfav>`}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--pct">%</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--annual">Annual</span>
            </div>
            {cpSites.map((s) => {
              const rv = s.revActual - s.revBudget;
              return (
                <div key={`rev-${s.key}`} className="oh-exec-pnl-row oh-exec-pnl-row--sub" onClick={() => onSelectAccount(s.key)}>
                  <span className="oh-exec-pnl-col-name oh-exec-pnl-sub-name">{s.label}</span>
                  <span className="oh-exec-pnl-col">{fmtDollars(s.revBudget)}</span>
                  <span className="oh-exec-pnl-col">{fmtDollars(s.revActual)}</span>
                  <span className="oh-exec-pnl-col oh-exec-pnl-col--rev"></span>
                  <span className={`oh-exec-pnl-col oh-exec-pnl-col--var ${rv >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{rv >= 0 ? fmtDollars(rv) : `(${fmtDollars(Math.abs(rv))})`}</span>
                  <span className={`oh-exec-pnl-col oh-exec-pnl-col--pct ${rv >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{s.revBudget > 0 ? `${(rv / s.revBudget * 100).toFixed(1)}%` : ""}</span>
                  <span className="oh-exec-pnl-col oh-exec-pnl-col--annual"></span>
                </div>
              );
            })}
            <div className="oh-exec-pnl-row oh-exec-pnl-row--subtotal">
              <span className="oh-exec-pnl-col-name">Total Revenue</span>
              <span className="oh-exec-pnl-col">{fmtDollars(cpPL.revBudget)}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--bold">{fmtDollars(cpPL.revActual)}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--rev"></span>
              <span className={`oh-exec-pnl-col oh-exec-pnl-col--var ${cpPL.revVar >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{cpPL.revVar >= 0 ? fmtDollars(cpPL.revVar) : `(${fmtDollars(Math.abs(cpPL.revVar))})`}</span>
              <span className={`oh-exec-pnl-col oh-exec-pnl-col--pct ${cpPL.revVar >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{cpPL.revBudget > 0 ? `${(cpPL.revVar / cpPL.revBudget * 100).toFixed(1)}%` : ""}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--annual">{fmtShort(port.revBudget)}</span>
            </div>
            <div className="oh-exec-pnl-spacer" />
            {[
              { label: "Hourly Labor", budget: cpPL.laborBudget, actual: cpPL.laborActual, annual: port.laborBudget },
              { label: "Food", budget: cpPL.foodBudget, actual: cpPL.foodActual, annual: port.foodBudget },
              { label: "Pkg & Supplies", budget: cpPL.packBudget, actual: cpPL.packActual, annual: port.packBudget },
            ].map((cat) => {
              const v = cat.budget - cat.actual;
              const revPct = cpPL.revActual > 0 ? (cat.actual / cpPL.revActual * 100) : 0;
              return (
                <div key={cat.label} className="oh-exec-pnl-row oh-exec-pnl-row--sub">
                  <span className="oh-exec-pnl-col-name oh-exec-pnl-sub-name">{cat.label}</span>
                  <span className="oh-exec-pnl-col">{fmtDollars(cat.budget)}</span>
                  <span className="oh-exec-pnl-col">{fmtDollars(cat.actual)}</span>
                  <span className="oh-exec-pnl-col oh-exec-pnl-col--rev">{revPct.toFixed(1)}%</span>
                  <span className={`oh-exec-pnl-col oh-exec-pnl-col--var ${v >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{v >= 0 ? fmtDollars(v) : `(${fmtDollars(Math.abs(v))})`}</span>
                  <span className={`oh-exec-pnl-col oh-exec-pnl-col--pct ${v >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{cat.budget > 0 ? `${(Math.abs(v) / cat.budget * 100).toFixed(1)}%` : ""}</span>
                  <span className="oh-exec-pnl-col oh-exec-pnl-col--annual">{fmtShort(cat.annual)}</span>
                </div>
              );
            })}
            <div className="oh-exec-pnl-row oh-exec-pnl-row--subtotal">
              <span className="oh-exec-pnl-col-name">Total COGS <span className="oh-exec-pnl-note">(tracked)</span></span>
              <span className="oh-exec-pnl-col">{fmtDollars(cpPL.cogsBudget)}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--bold">{fmtDollars(cpPL.cogsActual)}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--rev">{cpPL.cogsPctActual.toFixed(1)}%</span>
              <span className={`oh-exec-pnl-col oh-exec-pnl-col--var ${cpPL.cogsVar >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{cpPL.cogsVar >= 0 ? fmtDollars(cpPL.cogsVar) : `(${fmtDollars(Math.abs(cpPL.cogsVar))})`}</span>
              <span className={`oh-exec-pnl-col oh-exec-pnl-col--pct ${cpPL.cogsVar >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{cpPL.cogsBudget > 0 ? `${(Math.abs(cpPL.cogsVar) / cpPL.cogsBudget * 100).toFixed(1)}%` : ""}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--annual">{fmtShort(port.cogsBudget)}</span>
            </div>
            <div className="oh-exec-pnl-row oh-exec-pnl-row--total">
              <span className="oh-exec-pnl-col-name">Gross Margin <span className="oh-exec-pnl-note">(tracked)</span></span>
              <span className="oh-exec-pnl-col">{cpPL.gmBudget >= 0 ? fmtDollars(cpPL.gmBudget) : `(${fmtDollars(Math.abs(cpPL.gmBudget))})`}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--bold">{cpPL.gmActual >= 0 ? fmtDollars(cpPL.gmActual) : `(${fmtDollars(Math.abs(cpPL.gmActual))})`}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--rev">{cpPL.gmPctActual.toFixed(1)}%</span>
              <span className={`oh-exec-pnl-col oh-exec-pnl-col--var ${cpPL.gmVar >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{cpPL.gmVar >= 0 ? fmtDollars(cpPL.gmVar) : `(${fmtDollars(Math.abs(cpPL.gmVar))})`}</span>
              <span className={`oh-exec-pnl-col oh-exec-pnl-col--pct ${cpPL.gmVar >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{cpPL.gmBudget !== 0 ? `${(Math.abs(cpPL.gmVar) / Math.abs(cpPL.gmBudget) * 100).toFixed(1)}%` : ""}</span>
              <span className="oh-exec-pnl-col oh-exec-pnl-col--annual"></span>
            </div>
          </div>
          <div className="oh-exec-pnl-footer">
            <span>Tracked COGS = hourly labor + food + packaging. Excludes salary{cpPL.salaryBudget > 0 ? ` (${fmtDollars(cpPL.salaryBudget)} ${currentPeriod} budget)` : ""}, SG&A, and overhead.</span>
          </div>
        </div>
      ) : (
        <div className="oh-exec-scoreboard">
          <div className="oh-exec-kpi"><div className="oh-exec-kpi-label">Annual Revenue</div><div className="oh-exec-kpi-value">{fmtDollars(port.revBudget)}</div><div className="oh-exec-kpi-sub">budget · all accounts · awaiting {currentPeriod} actuals</div></div>
          <div className="oh-exec-kpi"><div className="oh-exec-kpi-label">Tracked Ops Costs</div><div className="oh-exec-kpi-value">{fmtDollars(port.cogsBudget)}</div><div className="oh-exec-kpi-sub">hourly labor + food + pkg</div></div>
          <div className="oh-exec-kpi"><div className="oh-exec-kpi-label">Current Period</div><div className="oh-exec-kpi-value">{currentPeriod}<span className="oh-exec-kpi-denom"> of {totalPeriods}</span></div><div className="oh-exec-kpi-sub">{acctReporting}/{acctTotal} accounts reported</div></div>
        </div>
      )}

      <div className="oh-exec-section">
        <h4 className="oh-exec-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Cost Composition — Tracked Ops Costs</h4>
        <div className="oh-exec-cost-split">
          <ExecDonutChart labor={port.laborActual} food={port.foodActual} packaging={port.packActual} />
          <div className="oh-exec-cost-bars">
            {[
              { label: "Hourly Labor", budget: port.laborBudget, actual: port.laborActual, variance: port.laborVar, color: "#2563eb" },
              { label: "Food", budget: port.foodBudget, actual: port.foodActual, variance: port.foodVar, color: "#f59e0b" },
              { label: "Pkg & Supplies", budget: port.packBudget, actual: port.packActual, variance: port.packVar, color: "#8b5cf6" },
            ].map((cat) => {
              const pct = cat.budget > 0 ? (cat.actual / cat.budget * 100) : 0;
              return (
                <div key={cat.label} className="oh-exec-cost-card">
                  <div className="oh-exec-cost-header"><span className="oh-exec-cost-dot" style={{ background: cat.color }} /><span className="oh-exec-cost-label">{cat.label}</span><span className={`oh-exec-cost-var ${cat.variance >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`}>{fmtVar(cat.variance)}</span></div>
                  <div className="oh-exec-cost-bar-track"><div className="oh-exec-cost-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: cat.color, opacity: 0.85 }} />{pct > 100 && <div className="oh-exec-cost-bar-over" style={{ width: `${Math.min(pct - 100, 50)}%`, left: "100%", background: "#ef4444" }} />}</div>
                  <div className="oh-exec-cost-meta"><span>{fmtDollars(cat.actual)} of {fmtDollars(cat.budget)} annual</span><span>{acctReporting > 0 ? `${pct.toFixed(0)}% of annual · ${currentPeriod}` : "no actuals yet"}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="oh-exec-section">
          <h4 className="oh-exec-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg> Ops Variance by Account</h4>
          <div className="oh-exec-var-chart">
            {sorted.map((a) => {
              const pct = maxAbsVar > 0 ? (Math.abs(a.cumulativeVariance) / maxAbsVar) * 100 : 0;
              const isPos = a.cumulativeVariance >= 0;
              return (
                <div key={a.key} className="oh-exec-var-row" onClick={() => onSelectAccount(a.key)}>
                  <span className="oh-exec-var-name">{a.label || a.name}</span>
                  <span className="oh-exec-var-badge">{a.level}</span>
                  <div className="oh-exec-var-track"><div className="oh-exec-var-center" />{isPos ? <div className="oh-exec-var-bar oh-exec-var-bar--pos" style={{ width: `${pct / 2}%`, left: "50%" }} /> : <div className="oh-exec-var-bar oh-exec-var-bar--neg" style={{ width: `${pct / 2}%`, right: "50%" }} />}</div>
                  <span className={`oh-exec-var-val ${isPos ? "oh-exec-pos" : "oh-exec-neg"}`}>{fmtVar(a.cumulativeVariance)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {periodTrend.length > 0 && (
        <div className="oh-exec-section">
          <h4 className="oh-exec-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg> Period Ops Variance Trend</h4>
          <ExecSVGTrend data={periodTrend} />
        </div>
      )}

      {periodTrend.length > 0 && periodTrend.some(p => p.revActual > 0) && (
        <div className="oh-exec-section">
          <h4 className="oh-exec-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Revenue vs Tracked Ops Costs by Period</h4>
          <ExecRevenueVsCost data={periodTrend} />
        </div>
      )}

      {(mlb.length > 0 || pdc.length > 0 || milb.length > 0) && (
        <div className="oh-exec-div-row">
          {mlb.length > 0 && <ExecDivisionCard label="MLB Clubhouses" color="#2563eb" accounts={mlb} fmtDollars={fmtDollars} fmtVar={fmtVar} onSelectAccount={onSelectAccount} />}
          {pdc.length > 0 && <ExecDivisionCard label="Player Development" color="#f59e0b" accounts={pdc} fmtDollars={fmtDollars} fmtVar={fmtVar} onSelectAccount={onSelectAccount} />}
          {milb.length > 0 && <ExecDivisionCard label="Minor League" color="#8b5cf6" accounts={milb} fmtDollars={fmtDollars} fmtVar={fmtVar} onSelectAccount={onSelectAccount} />}
        </div>
      )}

      <div className="oh-exec-section">
        <h4 className="oh-exec-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v6l4 2"/></svg> Account Health Matrix</h4>
        <div className="oh-exec-health-table">
          <div className="oh-exec-health-header">
            <span className="oh-exec-health-col-name">Account</span><span className="oh-exec-health-col">Type</span><span className="oh-exec-health-col">Rev</span><span className="oh-exec-health-col">Hourly</span><span className="oh-exec-health-col">Food</span><span className="oh-exec-health-col">Pkg</span><span className="oh-exec-health-col">Ops Var</span><span className="oh-exec-health-col">Progress</span><span className="oh-exec-health-col oh-exec-health-col-spark">Trend</span>
          </div>
          {accountHealth.map((a) => (
            <div key={a.key} className="oh-exec-health-row" onClick={() => onSelectAccount(a.key)}>
              <span className="oh-exec-health-col-name oh-exec-health-name">{a.label || a.name}</span>
              <span className="oh-exec-health-col"><span className={`oh-exec-type-badge oh-exec-type-badge--${a.level.toLowerCase()}`}>{a.level}</span></span>
              <span className="oh-exec-health-col" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{a.revenueActualTotal > 0 ? fmtDollars(a.revenueActualTotal) : "—"}</span>
              <span className="oh-exec-health-col"><span className={`oh-exec-dot-${a.laborGrade}`}>{a.laborGrade === "none" ? "—" : "●"}</span></span>
              <span className="oh-exec-health-col"><span className={`oh-exec-dot-${a.foodGrade}`}>{a.foodGrade === "none" ? "—" : "●"}</span></span>
              <span className="oh-exec-health-col"><span className={`oh-exec-dot-${a.packGrade}`}>{a.packGrade === "none" ? "—" : "●"}</span></span>
              <span className={`oh-exec-health-col ${a.cumulativeVariance >= 0 ? "oh-exec-pos" : "oh-exec-neg"}`} style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{a.completed > 0 ? fmtVar(a.cumulativeVariance) : "—"}</span>
              <span className="oh-exec-health-col oh-exec-health-progress"><div className="oh-exec-mini-bar"><div className="oh-exec-mini-fill" style={{ width: `${a.total > 0 ? (a.completed / a.total * 100) : 0}%` }} /></div><span>{a.completed}/{a.total}</span></span>
              <span className="oh-exec-health-col oh-exec-health-col-spark"><ExecSparkline periodData={a.periodData} /></span>
            </div>
          ))}
        </div>
        <div className="oh-exec-health-legend">
          <span><span className="oh-exec-dot-green">●</span> On/Under Budget</span>
          <span><span className="oh-exec-dot-amber">●</span> 1-10% Over</span>
          <span><span className="oh-exec-dot-red">●</span> &gt;10% Over</span>
          <span style={{ color: "#94a3b8" }}>— No Data</span>
        </div>
      </div>

      {watchlist.length > 0 && (
        <div className="oh-exec-section oh-exec-section--alert">
          <h4 className="oh-exec-section-title oh-exec-section-title--alert"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Watchlist — Immediate Attention</h4>
          <div className="oh-exec-watchlist">
            {watchlist.map((a) => {
              const issues = [];
              if (a.laborGrade === "red") issues.push(`Hourly labor ${a.laborPct}% over ($${Math.abs(a.budgetUsed - a.seasonBudget).toLocaleString()} overage)`);
              if (a.foodGrade === "red") issues.push(`Food ${a.foodPct}% over ($${Math.abs(a.foodActualTotal - a.totalFoodBudget).toLocaleString()} overage)`);
              if (a.packGrade === "red") issues.push(`Packaging ${a.packPct}% over ($${Math.abs(a.packagingActualTotal - a.totalPackagingBudget).toLocaleString()} overage)`);
              return (
                <div key={a.key} className="oh-exec-watch-item" onClick={() => onSelectAccount(a.key)}>
                  <div className="oh-exec-watch-name"><span className="oh-exec-watch-pulse" />{a.label || a.name}<span className={`oh-exec-type-badge oh-exec-type-badge--${a.level.toLowerCase()}`}>{a.level}</span></div>
                  <div className="oh-exec-watch-issues">{issues.map((issue, i) => <span key={i} className="oh-exec-watch-issue">{issue}</span>)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="oh-exec-section">
        <h4 className="oh-exec-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg> Hourly Labor Burn Rate</h4>
        <p className="oh-exec-section-desc">{currentPeriod} of {totalPeriods} ({seasonPctElapsed}% through season) — bars show hourly labor spend vs annual hourly budget.</p>
        <div className="oh-exec-burn-list">
          {data.filter(a => a.seasonBudget > 0).sort((a, b) => { const aPct = a.budgetUsed / a.seasonBudget; const bPct = b.budgetUsed / b.seasonBudget; return bPct - aPct; }).map((a) => {
            const burnPct = a.seasonBudget > 0 ? (a.budgetUsed / a.seasonBudget * 100) : 0;
            const isOver = burnPct > seasonPctElapsed + 15;
            return (
              <div key={a.key} className="oh-exec-burn-row" onClick={() => onSelectAccount(a.key)}>
                <span className="oh-exec-burn-name">{a.label || a.name}</span>
                <div className="oh-exec-burn-track"><div className="oh-exec-burn-fill" style={{ width: `${Math.min(burnPct, 100)}%`, background: isOver ? "#ef4444" : burnPct > seasonPctElapsed ? "#f59e0b" : "#10b981" }} /><div className="oh-exec-burn-marker" style={{ left: `${Math.min(seasonPctElapsed, 100)}%` }} /></div>
                <span className="oh-exec-burn-pct" style={{ color: isOver ? "#ef4444" : "#64748b" }}>{burnPct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="oh-exec-section">
        <div className="oh-sous-card oh-sous-card--exec">
          <div className="oh-sous-header">
            <div className="oh-sous-brand"><div className="oh-sous-icon">{"\u{1F52A}"}</div><div><span className="oh-sous-name">Sous AI</span><span className="oh-sous-tagline">executive portfolio brief</span></div></div>
            <div className="oh-sous-actions">
              {sousState === "idle" && <button className="oh-sous-btn" onClick={runPortfolioAnalysis}>Generate Executive Brief</button>}
              {sousState === "done" && <button className="oh-sous-regen" onClick={() => { setSousState("idle"); setSousBullets([]); setSousVisible(0); }}>{"\u21BB"} Regenerate</button>}
              {sousState === "error" && <button className="oh-sous-regen" onClick={runPortfolioAnalysis}>Retry</button>}
            </div>
          </div>
          {sousState === "thinking" && (
            <div className="oh-sous-thinking"><div className="oh-sous-dots"><span className="oh-sous-dot" style={{ animationDelay: "0s" }} /><span className="oh-sous-dot" style={{ animationDelay: "0.2s" }} /><span className="oh-sous-dot" style={{ animationDelay: "0.4s" }} /></div><span>Sous is analyzing the full portfolio...</span></div>
          )}
          {sousState === "error" && <div className="oh-sous-error">{sousError}</div>}
          {sousState === "done" && sousBullets.length > 0 && (
            <div className="oh-sous-result" style={{ background: sousTone === "positive" ? "#f0fdf4" : sousTone === "caution" ? "#fffbeb" : sousTone === "negative" ? "#fef2f2" : "#f8fafc", borderColor: sousTone === "positive" ? "#bbf7d0" : sousTone === "caution" ? "#fef3c7" : sousTone === "negative" ? "#fecaca" : "#e2e8f0" }}>
              {sousBullets.map((b, i) => { const icons = ["\u{1F4CA}", "\u26A0\uFE0F", "\u{1F6A8}", "\u{1F4A1}"]; return (<div key={i} className={`oh-sous-bullet${i < sousVisible ? " oh-sous-bullet--visible" : ""}`}><span className="oh-sous-bullet-icon">{icons[i] || "\u{1F4CA}"}</span><span className={i === 3 ? "oh-sous-bullet-text oh-sous-bullet-text--action" : "oh-sous-bullet-text"}>{b}</span></div>); })}
              <div className="oh-sous-footer"><span>Sous AI · portfolio-wide analysis · {data.length} accounts</span><span>Powered by Claude</span></div>
            </div>
          )}
        </div>
      </div>

      <p className="oh-exec-footnote">Click any account to view detailed KPI dashboard. Data reflects submitted actuals only. Variances are revenue-adjusted. Salary, SG&A, and fixed costs are tracked in the full P&L.</p>
    </div>
  );
}