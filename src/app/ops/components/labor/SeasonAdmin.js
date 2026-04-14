"use client";
import { useState, useEffect } from "react";

function fmt(n) { return "$" + Math.round(n).toLocaleString(); }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

export default function SeasonAdmin({ mlbAccounts, showToast, onSelectAccount }) {
  const [accountData, setAccountData] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mlbAccounts || mlbAccounts.length === 0) return;
    setLoading(true);
    Promise.all(mlbAccounts.map((a) =>
      fetch(`/api/ops?action=labor-bootstrap&account=${encodeURIComponent(a.key)}&view=planner`)
        .then((r) => r.json())
        .then((d) => ({ key: a.key, label: a.label, data: d.success ? d.plannerData : null }))
        .catch(() => ({ key: a.key, label: a.label, data: null }))
    )).then((results) => {
      const map = {};
      results.forEach((r) => { map[r.key] = r; });
      setAccountData(map);
      setLoading(false);
    });
  }, [mlbAccounts]);

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="oh-spinner" /></div>;
  }

  const accounts = mlbAccounts.map((a) => {
    const d = accountData[a.key]?.data;
    if (!d) return { key: a.key, label: a.label, loaded: false };
    const sm = d.seasonMetrics || {};
    const hs = d.homestands || [];
    const completed = hs.filter((h) => h.plan);
    const dueCount = hs.filter((h) => h.status === "actuals_due" && !h.plan).length;
    const activeCount = hs.filter((h) => h.status === "in_progress").length;
    const upcomingCount = hs.length - completed.length - dueCount - activeCount;
    const isRevFlex = d.isRevenueFlex;
    let revForecast = 0, revTracked = 0, revTrackedCount = 0;
    if (isRevFlex) {
      revForecast = hs.reduce((s, h) => s + (h.revenue || 0), 0);
      hs.forEach((h) => {
        if (h.soldRevenue > 0 || (h.plan && h.plan.revenueActual > 0)) {
          revTrackedCount++;
          revTracked += h.plan?.revenueActual > 0 ? h.plan.revenueActual : h.soldRevenue;
        }
      });
    }
    return {
      key: a.key, label: a.label, loaded: true,
      seasonBudget: sm.seasonBudgetTotal || 0, budgetUsed: sm.budgetUsed || 0,
      budgetRemaining: sm.budgetRemaining || 0, variance: sm.cumulativeVariance || 0,
      completedCount: completed.length, totalHomestands: hs.length,
      dueCount, activeCount, upcomingCount,
      isRevFlex, revForecast, revTracked, revTrackedCount, homestands: hs,
    };
  }).filter((a) => a.loaded);

  const pBudget = accounts.reduce((s, a) => s + a.seasonBudget, 0);
  const pSpent = accounts.reduce((s, a) => s + a.budgetUsed, 0);
  const pVar = accounts.reduce((s, a) => s + a.variance, 0);
  const pDone = accounts.reduce((s, a) => s + a.completedCount, 0);
  const pTotal = accounts.reduce((s, a) => s + a.totalHomestands, 0);
  const pDue = accounts.reduce((s, a) => s + a.dueCount, 0);
  const maxHS = Math.max(...accounts.map((a) => a.totalHomestands), 0);

  const seasonStart = new Date("2026-03-23");
  const seasonEnd = new Date("2026-09-27");
  const now = new Date();
  const daysSince = Math.max(0, Math.floor((now - seasonStart) / 86400000));
  const totalDays = Math.floor((seasonEnd - seasonStart) / 86400000);
  const week = Math.floor(daysSince / 7) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);
  const seasonPct = Math.min(100, Math.round((daysSince / totalDays) * 100));

  return (
    <div className="oh-sp-admin">
      <div className="oh-sp-admin-portfolio">
        <div className="oh-sp-admin-context">
          Week {week} of {totalWeeks} · Season {seasonPct}% elapsed
        </div>
        <div className="oh-sp-admin-portfolio-row">
          <div className="oh-sp-admin-stat">
            <span className="oh-sp-admin-stat-label">Portfolio Labor Budget</span>
            <span className="oh-sp-admin-stat-val">{fmt(pBudget)}</span>
          </div>
          <div className="oh-sp-admin-stat">
            <span className="oh-sp-admin-stat-label">Spent</span>
            <span className="oh-sp-admin-stat-val">{fmt(pSpent)}</span>
          </div>
          <div className="oh-sp-admin-stat">
            <span className="oh-sp-admin-stat-label">Variance</span>
            <span className={`oh-sp-admin-stat-val ${pVar >= 0 ? "oh-sp-admin-stat--pos" : "oh-sp-admin-stat--neg"}`}>
              {pVar >= 0 ? "+" : ""}{fmt(pVar)}
            </span>
          </div>
          <div className="oh-sp-admin-stat">
            <span className="oh-sp-admin-stat-label">Progress</span>
            <span className="oh-sp-admin-stat-val oh-sp-admin-stat-val--inline">{pDone} of {pTotal} homestands</span>
          </div>
          {pDue > 0 && (
            <div className="oh-sp-admin-stat oh-sp-admin-stat--alert">
              <span className="oh-sp-admin-stat-label">Action Needed</span>
              <span className="oh-sp-admin-stat-val">{pDue} actuals due</span>
            </div>
          )}
        </div>
      </div>

      <div className="oh-sp-admin-grid">
        {accounts.map((a) => (
          <AccountCard key={a.key} account={a} onSelect={() => onSelectAccount?.(a.key)} />
        ))}
      </div>

      <div className="oh-sp-admin-section">
        <h3 className="oh-sp-admin-section-title">Homestand Status</h3>
        <div className="oh-sp-admin-hs-grid">
          <div className="oh-sp-admin-hs-header">
            <span className="oh-sp-admin-hs-cell oh-sp-admin-hs-cell--acct">Account</span>
            {Array.from({ length: maxHS }).map((_, i) => (
              <span key={i} className="oh-sp-admin-hs-cell oh-sp-admin-hs-cell--hs">HS{i + 1}</span>
            ))}
          </div>
          {accounts.map((a) => (
            <div key={a.key} className="oh-sp-admin-hs-row">
              <span className="oh-sp-admin-hs-cell oh-sp-admin-hs-cell--acct oh-sp-admin-hs-cell--link" onClick={() => onSelectAccount?.(a.key)}>{a.key}</span>
              {a.homestands.map((h, i) => {
                const st = h.plan ? "done" : h.status === "actuals_due" ? "due" : h.status === "in_progress" ? "active" : "upcoming";
                const tip = h.plan ? `${h.id}: ${h.plan.variance >= 0 ? "+" : ""}${fmt(h.plan.variance)}` : `${h.id}: ${st}`;
                return <span key={i} className={`oh-sp-admin-hs-cell oh-sp-admin-hs-dot oh-sp-admin-hs-dot--${st}`} title={tip} onClick={() => onSelectAccount?.(a.key)} style={{ cursor: "pointer" }} />;
              })}
              {Array.from({ length: maxHS - a.totalHomestands }).map((_, i) => (
                <span key={`p${i}`} className="oh-sp-admin-hs-cell oh-sp-admin-hs-dot oh-sp-admin-hs-dot--empty" />
              ))}
            </div>
          ))}
          <div className="oh-sp-admin-hs-legend">
            <span className="oh-sp-admin-hs-legend-item"><span className="oh-sp-admin-hs-dot oh-sp-admin-hs-dot--done" /> Complete</span>
            <span className="oh-sp-admin-hs-legend-item"><span className="oh-sp-admin-hs-dot oh-sp-admin-hs-dot--due" /> Actuals Due</span>
            <span className="oh-sp-admin-hs-legend-item"><span className="oh-sp-admin-hs-dot oh-sp-admin-hs-dot--active" /> In Progress</span>
            <span className="oh-sp-admin-hs-legend-item"><span className="oh-sp-admin-hs-dot oh-sp-admin-hs-dot--upcoming" /> Upcoming</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ account: a, onSelect }) {
  const spentPct = pct(a.budgetUsed, a.seasonBudget);
  const isOver = a.variance < 0;
  return (
    <div className={`oh-sp-admin-card${a.dueCount > 0 ? " oh-sp-admin-card--alert" : ""}`} onClick={onSelect} style={{ cursor: "pointer" }}>
      <div className="oh-sp-admin-card-header">
        <h4 className="oh-sp-admin-card-title">{a.label}</h4>
        <span className="oh-sp-admin-card-progress">{a.completedCount}/{a.totalHomestands}</span>
      </div>
      <div className="oh-sp-admin-bar-section">
        <div className="oh-sp-admin-bar-labels"><span>Budget: {fmt(a.seasonBudget)}</span><span>Spent: {fmt(a.budgetUsed)}</span></div>
        <div className="oh-sp-admin-bar-track"><div className={`oh-sp-admin-bar-fill${isOver ? " oh-sp-admin-bar-fill--over" : ""}`} style={{ width: `${Math.min(spentPct, 100)}%` }} /></div>
        <div className="oh-sp-admin-bar-labels">
          <span className={isOver ? "oh-sp-admin-text--neg" : "oh-sp-admin-text--pos"}>{a.variance >= 0 ? "+" : ""}{fmt(a.variance)} variance</span>
          <span>{fmt(a.budgetRemaining)} remaining</span>
        </div>
      </div>
      {a.isRevFlex && (
        <div className="oh-sp-admin-rev">
          <div className="oh-sp-admin-rev-row"><span className="oh-sp-admin-rev-label">Revenue</span><span className="oh-sp-admin-rev-count">{a.revTrackedCount}/{a.totalHomestands} tracked</span></div>
          <div className="oh-sp-admin-bar-labels"><span>Forecast: {fmt(a.revForecast)}</span><span>Tracked: {fmt(a.revTracked)}</span></div>
          <div className="oh-sp-admin-bar-track"><div className="oh-sp-admin-bar-fill oh-sp-admin-bar-fill--rev" style={{ width: `${Math.min(pct(a.revTracked, a.revForecast), 100)}%` }} /></div>
        </div>
      )}
      <div className="oh-sp-admin-card-badges">
        {a.dueCount > 0 && <span className="oh-sp-admin-badge oh-sp-admin-badge--due">{a.dueCount} due</span>}
        {a.activeCount > 0 && <span className="oh-sp-admin-badge oh-sp-admin-badge--active">{a.activeCount} active</span>}
        {a.upcomingCount > 0 && <span className="oh-sp-admin-badge oh-sp-admin-badge--upcoming">{a.upcomingCount} upcoming</span>}
      </div>
    </div>
  );
}