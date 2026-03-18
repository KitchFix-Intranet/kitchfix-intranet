"use client";
import { useState } from "react";
import F from "@/app/ops/components/shared/F";

export default function PeriodCard({ pc, idx, expanded, onToggle, showToast, openConfirm, account, onRefresh, prevPC, accountFlags = {} }) {
  const isRevenueFixed = accountFlags.isRevenueFixed || false;
  const hasHourlyLabor = accountFlags.hasHourlyLabor !== false;
  const [laborInput, setLaborInput] = useState("");
  const [foodInput, setFoodInput] = useState("");
  const [packagingInput, setPackagingInput] = useState("");
  const [revenueInput, setRevenueInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scorecard, setScorecard] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  const isActive = pc.status === "in_progress";
  const isActualsDue = pc.status === "actuals_due";
  const isCompleted = pc.status === "completed";
  const isMaintenance = pc.isMaintenance;

  const carryForward = prevPC?.plan ? prevPC.plan.variance : 0;
  const adjustedBudget = pc.hourlyBudget + carryForward;

  function calcVariance(plan, revActual) {
    const revForecast = pc.revenue;
    const laborActual = plan.actualSpent || 0;
    const foodActual = plan.actualFood || 0;
    const packActual = plan.actualPackaging || 0;
    const ra = revActual || plan.revenueActual || 0;
    const laborBudget = pc.hourlyBudget;
    const foodBudget = pc.foodBudget;
    const packBudget = pc.packagingBudget;
    if (ra > 0 && revForecast > 0) {
      const ratio = ra / revForecast;
      const laborTarget = Math.round(laborBudget * ratio);
      const foodTarget = Math.round(foodBudget * ratio);
      const packTarget = Math.round(packBudget * ratio);
      return {
        laborVar: laborTarget - laborActual, foodVar: foodTarget - foodActual, packVar: packTarget - packActual,
        total: (laborTarget + foodTarget + packTarget) - (laborActual + foodActual + packActual),
        laborTarget, foodTarget, packTarget, laborBudget, foodBudget, packBudget,
        ratio, revActual: ra, revForecast, isAdjusted: true,
      };
    }
    return {
      laborVar: laborBudget - laborActual, foodVar: foodBudget - foodActual, packVar: packBudget - packActual,
      total: (laborBudget + foodBudget + packBudget) - (laborActual + foodActual + packActual),
      laborTarget: laborBudget, foodTarget: foodBudget, packTarget: packBudget,
      laborBudget, foodBudget, packBudget, ratio: 1, revActual: 0, revForecast, isAdjusted: false,
    };
  }

  const statusConfig = {
    upcoming: { label: "Upcoming", cls: "oh-status-upcoming" },
    in_progress: { label: "Active", cls: "oh-status-active" },
    actuals_due: { label: "Actuals Due", cls: "oh-status-due" },
    completed: { label: "Completed", cls: "oh-status-done" },
  };
  const statusInfo = statusConfig[pc.status] || statusConfig.upcoming;

  const handleSubmitActuals = async () => {
    const labor = F.num(laborInput) || 0;
    const food = F.num(foodInput) || 0;
    const packaging = F.num(packagingInput) || 0;
    if (hasHourlyLabor && pc.hourlyBudget > 0 && labor <= 0) { showToast("Enter a valid labor amount", "error"); return; }
    if (!hasHourlyLabor && food <= 0 && packaging <= 0) { showToast("Enter food or packaging actuals", "error"); return; }
    setSubmitting(true);
    try {
      const revActual = isRevenueFixed ? pc.revenue : (F.num(revenueInput) || 0);
      const res = await fetch("/api/ops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-labor-actuals", account, homestandId: pc.id,
          budgetEnvelope: adjustedBudget, carryForward,
          actualSpent: labor, notes: notesInput.trim(),
          revenueActual: revActual, actualFood: food, actualPackaging: packaging,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const mockPlan = { actualSpent: labor, actualFood: food, actualPackaging: packaging, revenueActual: revActual };
        const v = calcVariance(mockPlan, revActual);
        setScorecard({ labor, food, packaging, revActual, revForecast: pc.revenue, v, cumulative: data.cumulativeVariance, streak: data.streak });
      } else { showToast(data.error || "Submission failed", "error"); }
    } catch { showToast("Network error", "error"); }
    finally { setSubmitting(false); }
  };

  const headerVariance = isCompleted && pc.plan ? calcVariance(pc.plan, null) : null;
  const pct = (n, d) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : "—";

  const renderScorecard = (v, plan, revActual, revForecast, streak, cumulative, notes) => {
    const totalBudget = v.laborBudget + v.foodBudget + v.packBudget;
    const totalTarget = v.laborTarget + v.foodTarget + v.packTarget;
    const totalActual = plan.actualSpent + (plan.actualFood || 0) + (plan.actualPackaging || 0);
    const ra = revActual || 0;
    return (
    <div className="oh-scorecard">
      <div className="oh-scorecard-inner">
        <div className="oh-sc-verdict-row">
          <div className={`oh-scorecard-badge ${v.total >= 0 ? "oh-sc-green" : "oh-sc-amber"}`}>{v.total >= 0 ? "✅ On Target" : "⚠️ Over Target"}</div>
          {ra > 0 && !isRevenueFixed && (
            <div className="oh-sc-rev-context">
              <div className="oh-sc-rev-context-item"><span className="oh-sc-rev-context-label">Projected</span><span className="oh-sc-rev-context-val">${revForecast.toLocaleString()}</span></div>
              <span className="oh-sc-rev-context-arrow">→</span>
              <div className="oh-sc-rev-context-item"><span className="oh-sc-rev-context-label">Actual Revenue</span><span className="oh-sc-rev-context-val oh-sc-rev-context-val-bold">${ra.toLocaleString()}</span></div>
              <div className={`oh-sc-rev-context-delta ${v.ratio >= 1 ? "oh-sc-rev-delta-up" : "oh-sc-rev-delta-down"}`}>{v.ratio >= 1 ? "↑" : "↓"}{Math.abs(Math.round((v.ratio - 1) * 100))}%</div>
            </div>
          )}
        </div>
        <div className="oh-sc-kpi-table">
          <div className={`oh-sc-kpi-row oh-sc-kpi-header ${v.isAdjusted ? "oh-sc-kpi-header-wide" : ""}`}>
            <div className="oh-sc-kpi-cell"></div>
            <div className="oh-sc-kpi-cell"><span className="oh-sc-label">Budget</span></div>
            {v.isAdjusted && <div className="oh-sc-kpi-cell"><span className="oh-sc-label">Target</span></div>}
            <div className="oh-sc-kpi-cell"><span className="oh-sc-label">Actual</span></div>
            <div className="oh-sc-kpi-cell"><span className="oh-sc-label">Var</span></div>
            {ra > 0 && <div className="oh-sc-kpi-cell"><span className="oh-sc-label">% Rev</span></div>}
          </div>
          <div className={`oh-sc-kpi-row ${v.isAdjusted ? "oh-sc-kpi-row-wide" : ""}`}>
            <div className="oh-sc-kpi-cell"><span className="oh-sc-label">Labor</span></div>
            <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted">${v.laborBudget.toLocaleString()}</span></div>
            {v.isAdjusted && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${v.laborTarget.toLocaleString()}</span></div>}
            <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${plan.actualSpent.toLocaleString()}</span></div>
            <div className="oh-sc-kpi-cell"><span className={`oh-sc-val-sm ${v.laborVar >= 0 ? "oh-sc-green-text" : "oh-sc-amber-text"}`}>{v.laborVar >= 0 ? "+" : "-"}${Math.abs(v.laborVar).toLocaleString()}</span></div>
            {ra > 0 && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted">{pct(plan.actualSpent, ra)}</span></div>}
          </div>
          {(plan.actualFood > 0 || pc.foodBudget > 0) && (
            <div className={`oh-sc-kpi-row ${v.isAdjusted ? "oh-sc-kpi-row-wide" : ""}`}>
              <div className="oh-sc-kpi-cell"><span className="oh-sc-label">Food</span></div>
              <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted">${v.foodBudget.toLocaleString()}</span></div>
              {v.isAdjusted && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${v.foodTarget.toLocaleString()}</span></div>}
              <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${(plan.actualFood || 0).toLocaleString()}</span></div>
              <div className="oh-sc-kpi-cell"><span className={`oh-sc-val-sm ${v.foodVar >= 0 ? "oh-sc-green-text" : "oh-sc-amber-text"}`}>{v.foodVar >= 0 ? "+" : "-"}${Math.abs(v.foodVar).toLocaleString()}</span></div>
              {ra > 0 && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted">{pct(plan.actualFood || 0, ra)}</span></div>}
            </div>
          )}
          {(plan.actualPackaging > 0 || pc.packagingBudget > 0) && (
            <div className={`oh-sc-kpi-row ${v.isAdjusted ? "oh-sc-kpi-row-wide" : ""}`}>
              <div className="oh-sc-kpi-cell"><span className="oh-sc-label">Pkg & Supplies</span></div>
              <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted">${v.packBudget.toLocaleString()}</span></div>
              {v.isAdjusted && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${v.packTarget.toLocaleString()}</span></div>}
              <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${(plan.actualPackaging || 0).toLocaleString()}</span></div>
              <div className="oh-sc-kpi-cell"><span className={`oh-sc-val-sm ${v.packVar >= 0 ? "oh-sc-green-text" : "oh-sc-amber-text"}`}>{v.packVar >= 0 ? "+" : "-"}${Math.abs(v.packVar).toLocaleString()}</span></div>
              {ra > 0 && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted">{pct(plan.actualPackaging || 0, ra)}</span></div>}
            </div>
          )}
          <div className={`oh-sc-kpi-row oh-sc-kpi-total ${v.isAdjusted ? "oh-sc-kpi-row-wide" : ""}`}>
            <div className="oh-sc-kpi-cell"><span className="oh-sc-label" style={{ fontWeight: 800 }}>Total</span></div>
            <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted">${totalBudget.toLocaleString()}</span></div>
            {v.isAdjusted && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${totalTarget.toLocaleString()}</span></div>}
            <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm">${totalActual.toLocaleString()}</span></div>
            <div className="oh-sc-kpi-cell"><span className={`oh-sc-val-sm ${v.total >= 0 ? "oh-sc-green-text" : "oh-sc-amber-text"}`} style={{ fontWeight: 800 }}>{v.total >= 0 ? "+" : "-"}${Math.abs(v.total).toLocaleString()}</span></div>
            {ra > 0 && <div className="oh-sc-kpi-cell"><span className="oh-sc-val-sm oh-sc-val-muted" style={{ fontWeight: 800 }}>{pct(totalActual, ra)}</span></div>}
          </div>
        </div>
        {notes && <p className="oh-hs-notes">"{notes}"</p>}
      </div>
    </div>
    );
  };

  return (
    <div className={`oh-hs-card ${isActive ? "oh-hs-active" : ""} ${isActualsDue ? "oh-hs-due" : ""} ${isCompleted ? "oh-hs-done" : ""}`}>
      <div className="oh-hs-header" onClick={onToggle}>
        <div className="oh-hs-header-left">
          <span className="oh-hs-id">{pc.id}</span>
          <div className="oh-hs-header-info">
            <div className="oh-hs-dates">{F.dateShort(pc.startDate)} — {F.dateShort(pc.endDate)}</div>
            <div className="oh-hs-meta">
              <span className="oh-hs-days">{pc.calendarDays}d · {pc.weeksInPeriod}wk</span>
              {pc.isPeakSeason && <span className="oh-hs-peak">⚡ Peak</span>}
            </div>
          </div>
        </div>
        <div className="oh-hs-header-right">
          {!isCompleted && <span className="oh-hs-budget">${(pc.hourlyBudget + (pc.foodBudget || 0) + (pc.packagingBudget || 0)).toLocaleString()}</span>}
          <span className={`oh-hs-status ${statusInfo.cls}`}>{statusInfo.label}</span>
          {headerVariance && (
            <span className={`oh-hs-result ${headerVariance.total >= 0 ? "oh-hs-result-good" : "oh-hs-result-over"}`}>
              {headerVariance.total >= 0 ? "✅" : "⚠️"} Ops Var: {headerVariance.total >= 0 ? "+$" : "-$"}{Math.abs(headerVariance.total).toLocaleString()}
            </span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0, color: "#94a3b8" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="oh-hs-detail" style={{ animation: "oh-slideUp 0.2s ease" }}>
          {scorecard && (() => {
            const plan = { actualSpent: scorecard.labor, actualFood: scorecard.food, actualPackaging: scorecard.packaging, revenueActual: scorecard.revActual };
            return (
              <>
                {renderScorecard(scorecard.v, plan, scorecard.revActual, scorecard.revForecast, scorecard.streak, scorecard.cumulative, null)}
                <button className="oh-btn-ghost" onClick={() => { setScorecard(null); onRefresh(); }} style={{ width: "100%", marginTop: 8 }}>Done</button>
              </>
            );
          })()}

          {!scorecard && (
            <>
              {isCompleted && pc.plan && !isEditing && (() => {
                const v = calcVariance(pc.plan, null);
                return (
                  <>
                    {renderScorecard(v, pc.plan, pc.plan.revenueActual, pc.revenue, pc.plan.streakCount, pc.plan.cumulativeVariance, pc.plan.notes)}
                    <button className="oh-btn-ghost" onClick={() => {
                      setIsEditing(true);
                      setLaborInput(F.comma(String(pc.plan.actualSpent)));
                      setFoodInput(pc.plan.actualFood ? F.comma(String(pc.plan.actualFood)) : "");
                      setPackagingInput(pc.plan.actualPackaging ? F.comma(String(pc.plan.actualPackaging)) : "");
                      setRevenueInput(pc.plan.revenueActual ? F.comma(String(pc.plan.revenueActual)) : "");
                      setNotesInput(pc.plan.notes || "");
                    }} style={{ width: "100%", marginTop: 8 }}>✏️ Edit Actuals</button>
                  </>
                );
              })()}

              {(!isCompleted || isEditing) && (
                <div className="oh-hs-section">
                  <h4 className="oh-hs-section-title">Period Budget</h4>
                  <div className="oh-budget-math">
                    {pc.revenue > 0 && (
                      <div className="oh-budget-line"><span>Revenue Forecast</span><span className="oh-budget-line-val" style={{ fontWeight: 800 }}>${pc.revenue.toLocaleString()}</span></div>
                    )}
                    <div className="oh-budget-line"><span>Hourly Labor</span><span className="oh-budget-line-val">${pc.hourlyBudget.toLocaleString()}</span></div>
                    {pc.foodBudget > 0 && <div className="oh-budget-line"><span>Food Cost</span><span className="oh-budget-line-val">${pc.foodBudget.toLocaleString()}</span></div>}
                    {pc.packagingBudget > 0 && <div className="oh-budget-line"><span>Packaging & Supplies</span><span className="oh-budget-line-val">${pc.packagingBudget.toLocaleString()}</span></div>}
                    {(pc.foodBudget > 0 || pc.packagingBudget > 0) && (
                      <div className="oh-budget-line oh-budget-adjusted"><span>Total Controllable</span><span>${(pc.hourlyBudget + pc.foodBudget + pc.packagingBudget).toLocaleString()}</span></div>
                    )}
                    <div className="oh-budget-line" style={{ fontSize: 12, color: "#94a3b8" }}>
                      <span>Labor Daily Rate: ${pc.dailyRate.toLocaleString()}/day × {pc.calendarDays}d</span>
                    </div>
                  </div>
                </div>
              )}

              {pc.isPeakSeason && !isCompleted && (
                <div className="oh-hs-ot-detail" style={{ borderColor: "#c084fc" }}>
                  <span className="oh-hs-ot-icon">⚡</span>
                  <div><strong style={{ color: "#7c3aed" }}>Peak Season</strong><span> — plan for 3–5× normal crew levels this period.</span></div>
                </div>
              )}

              {((isActualsDue || isActive) && !isCompleted) || isEditing ? (
                <div className="oh-hs-section oh-actuals-section">
                  <h4 className="oh-hs-section-title">{isEditing ? "Update Actuals" : "Enter Actuals"}</h4>
                  {isRevenueFixed && pc.revenue > 0 ? (
                    <div className="oh-kpi-input-group">
                      <label className="oh-kpi-input-label">Period Revenue <span style={{ color: "#16a34a", fontWeight: 700 }}>(set)</span></label>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", padding: "8px 0" }}>${pc.revenue.toLocaleString()}</div>
                    </div>
                  ) : pc.revenue > 0 ? (
                    <div className="oh-kpi-input-group">
                      <label className="oh-kpi-input-label">Revenue Actual <span style={{ color: "#94a3b8", fontWeight: 400 }}>Forecast: ${pc.revenue.toLocaleString()}</span></label>
                      <div className="oh-input-box" style={{ width: "100%" }}>
                        <span className="oh-prefix">$</span>
                        <input type="text" inputMode="decimal" className="oh-cost-input" placeholder={pc.revenue.toLocaleString()} value={revenueInput}
                          onChange={(e) => setRevenueInput(F.comma(e.target.value))} />
                      </div>
                    </div>
                  ) : null}
                  {hasHourlyLabor && pc.hourlyBudget > 0 && (
                    <div className="oh-kpi-input-group">
                      <label className="oh-kpi-input-label">Hourly Labor <span style={{ color: "#94a3b8", fontWeight: 400 }}>Budget: ${pc.hourlyBudget.toLocaleString()}</span></label>
                      <div className="oh-input-box" style={{ width: "100%" }}>
                        <span className="oh-prefix">$</span>
                        <input type="text" inputMode="decimal" className="oh-cost-input" placeholder="0.00" value={laborInput}
                          onChange={(e) => setLaborInput(F.comma(e.target.value))} />
                      </div>
                    </div>
                  )}
                  {pc.foodBudget > 0 && (
                    <div className="oh-kpi-input-group">
                      <label className="oh-kpi-input-label">Food Cost <span style={{ color: "#94a3b8", fontWeight: 400 }}>Budget: ${pc.foodBudget.toLocaleString()}</span></label>
                      <div className="oh-input-box" style={{ width: "100%" }}>
                        <span className="oh-prefix">$</span>
                        <input type="text" inputMode="decimal" className="oh-cost-input" placeholder="0.00" value={foodInput}
                          onChange={(e) => setFoodInput(F.comma(e.target.value))} />
                      </div>
                    </div>
                  )}
                  {pc.packagingBudget > 0 && (
                    <div className="oh-kpi-input-group">
                      <label className="oh-kpi-input-label">Packaging & Supplies <span style={{ color: "#94a3b8", fontWeight: 400 }}>Budget: ${pc.packagingBudget.toLocaleString()}</span></label>
                      <div className="oh-input-box" style={{ width: "100%" }}>
                        <span className="oh-prefix">$</span>
                        <input type="text" inputMode="decimal" className="oh-cost-input" placeholder="0.00" value={packagingInput}
                          onChange={(e) => setPackagingInput(F.comma(e.target.value))} />
                      </div>
                    </div>
                  )}
                  <textarea className="oh-textarea" placeholder="Notes about this period (optional)" value={notesInput} onChange={(e) => setNotesInput(e.target.value)} rows={2} maxLength={300} style={{ marginTop: 12 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {isEditing && <button className="oh-btn-ghost" onClick={() => setIsEditing(false)} style={{ flex: 1 }}>Cancel</button>}
                    <button className="oh-btn oh-btn--blue" onClick={() => {
                      const labor = F.num(laborInput);
                      const food = F.num(foodInput) || 0;
                      const packaging = F.num(packagingInput) || 0;
                      if (hasHourlyLabor && pc.hourlyBudget > 0 && (!labor || labor <= 0)) { showToast("Enter a valid labor amount", "error"); return; }
                      if (!hasHourlyLabor && food <= 0 && packaging <= 0) { showToast("Enter food or packaging actuals", "error"); return; }
                      openConfirm(
                        isEditing ? "Update Actuals" : "Submit Actuals",
                        `${isEditing ? "Update" : "Submit"} ${pc.id} actuals —${labor > 0 ? ` Labor: $${labor.toLocaleString()}` : ""}${food > 0 ? ` Food: $${food.toLocaleString()}` : ""}${packaging > 0 ? ` Pkg: $${packaging.toLocaleString()}` : ""}?`,
                        isEditing ? "Update" : "Submit",
                        handleSubmitActuals
                      );
                    }} disabled={submitting || (hasHourlyLabor && pc.hourlyBudget > 0 && !laborInput) || (!hasHourlyLabor && !foodInput && !packagingInput)}
                      style={{ flex: isEditing ? 2 : 1, width: isEditing ? "auto" : "100%" }}>
                      {submitting && <span className="oh-btn-spinner" />}
                      {submitting ? "Submitting..." : isEditing ? `Update ${pc.id} Actuals` : `Submit ${pc.id} Actuals`}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}