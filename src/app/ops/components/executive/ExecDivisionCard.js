"use client";

export default function ExecDivisionCard({ label, color, accounts, fmtDollars, fmtVar, onSelectAccount }) {
  const totalRev = accounts.reduce((s, a) => s + (a.revenueActualTotal || 0), 0);
  const totalOps = accounts.reduce((s, a) => s + (a.budgetUsed || 0) + (a.foodActualTotal || 0) + (a.packagingActualTotal || 0), 0);
  const totalVar = accounts.reduce((s, a) => s + (a.cumulativeVariance || 0), 0);
  const onTrack = accounts.filter(a => a.cumulativeVariance >= 0).length;
  const opsRatio = totalRev > 0 ? ((totalOps / totalRev) * 100) : null;

  return (
    <div className="oh-exec-div-card">
      <div className="oh-exec-div-header">
        <span className="oh-exec-div-dot" style={{ background: color }} />
        <h4 className="oh-exec-div-title">{label}</h4>
        <span className="oh-exec-div-count">{accounts.length} accounts</span>
      </div>
      <div className="oh-exec-div-metrics">
        <div className="oh-exec-div-metric">
          <span className="oh-exec-div-m-label">Revenue</span>
          <span className="oh-exec-div-m-value">{fmtDollars(totalRev)}</span>
        </div>
        <div className="oh-exec-div-metric">
          <span className="oh-exec-div-m-label">Ops Costs</span>
          <span className="oh-exec-div-m-value">{fmtDollars(totalOps)}</span>
        </div>
        <div className="oh-exec-div-metric">
          <span className="oh-exec-div-m-label">Ops Var</span>
          <span className="oh-exec-div-m-value" style={{ color: totalVar >= 0 ? "#166534" : "#dc2626" }}>{fmtVar(totalVar)}</span>
        </div>
        <div className="oh-exec-div-metric">
          <span className="oh-exec-div-m-label">Cost Ratio</span>
          <span className="oh-exec-div-m-value">{opsRatio !== null ? `${opsRatio.toFixed(1)}%` : "—"}</span>
        </div>
      </div>
      <div className="oh-exec-div-health">
        <div className="oh-exec-div-health-bar">
          <div className="oh-exec-div-health-fill" style={{ width: `${accounts.length > 0 ? (onTrack / accounts.length * 100) : 0}%` }} />
        </div>
        <span className="oh-exec-div-health-label">{onTrack}/{accounts.length} on track</span>
      </div>
    </div>
  );
}