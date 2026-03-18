"use client";
import { useState, useMemo } from "react";
import F from "@/app/ops/components/shared/F";

/**
 * SeasonPlanner v4.1 — Mini viz fingerprints + Revenue Flex (TXR-V)
 *
 * v4 features preserved:
 *   - MiniViz fingerprint strips on collapsed cards
 *   - Expand/collapse with chevron, one-at-a-time
 *   - Auto-expand for active/due, force-open
 *   - "Up next" distinct state with navy border
 *   - Completed as locked slim one-liners
 *   - Heavy homestand detection
 *   - Keyboard accessibility
 *
 * Added in v4.1:
 *   - Revenue flex detection (TXR-V): sold revenue input adjusts budget
 *   - Two-field actuals entry for revenue flex (final revenue + labor)
 *   - Budget subtext: "forecast · updates with sales" / "adjusted from sales"
 *   - Revenue note on completed flex cards
 */
export default function SeasonPlanner({ plannerData, account, showToast, openConfirm, onRefresh }) {
  const homestands = plannerData?.homestands || [];
  const seasonMetrics = plannerData?.seasonMetrics || {};

  const autoExpandId = useMemo(() => {
    const active = homestands.find(
      (h) => h.status === "in_progress" || (h.status === "actuals_due" && !h.plan)
    );
    return active?.id || null;
  }, [homestands]);

  const nextId = useMemo(() => {
    const next = homestands.find(
      (h) => h.status !== "completed" && !h.plan
    );
    return next?.id || null;
  }, [homestands]);

  const [expandedId, setExpandedId] = useState(autoExpandId);

  const handleToggle = (id, isCompleted) => {
    if (isCompleted) return;
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (homestands.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 48, color: "#64748b", fontSize: 14 }}>
        No homestand schedule found. Check the homestand_schedule tab in the HUB spreadsheet.
      </div>
    );
  }

  const completedHS = homestands.filter((h) => h.plan);
  const totalBudget = seasonMetrics.seasonBudgetTotal || 0;
  const cumulativeVar = completedHS.reduce((s, h) => s + (h.plan.variance || 0), 0);

  // Revenue flex tracking (TXR-V)
  const isRevenueFlex = homestands.some((h) => h.isRevenueFlex);
  const totalForecastRevenue = isRevenueFlex ? homestands.reduce((s, h) => s + (h.revenue || 0), 0) : 0;
  const trackedHS = isRevenueFlex ? homestands.filter((h) => h.soldRevenue > 0 || (h.plan && h.plan.revenueActual > 0)) : [];
  const totalTrackedRevenue = trackedHS.reduce((s, h) => {
    if (h.plan && h.plan.revenueActual > 0) return s + h.plan.revenueActual;
    if (h.soldRevenue > 0) return s + h.soldRevenue;
    return s;
  }, 0);
  const revenuePct = totalForecastRevenue > 0 ? Math.round((totalTrackedRevenue / totalForecastRevenue) * 100) : 0;
  const revenueDelta = totalTrackedRevenue - totalForecastRevenue;
  const revenueAhead = totalTrackedRevenue > totalForecastRevenue;

  const firstUpcomingId = homestands.find(
    (h) => h.status === "upcoming" || h.status === "in_progress" || (h.status === "actuals_due" && !h.plan)
  )?.id;

  return (
    <div className="oh-sp">
      <div className="oh-sp-header">
        <div className="oh-sp-header-left">
          <span className="oh-sp-header-label">Season labor budget</span>
          <span className="oh-sp-header-total">${totalBudget.toLocaleString()}</span>
        </div>
        {completedHS.length > 0 && (
          <div className={`oh-sp-banner${cumulativeVar >= 0 ? " oh-sp-banner--pos" : " oh-sp-banner--neg"}`}>
            {completedHS.length} of {homestands.length} homestands complete
            <span className="oh-sp-banner-var">
              {cumulativeVar >= 0 ? "+" : ""}${Math.abs(cumulativeVar).toLocaleString()} {cumulativeVar >= 0 ? "under" : "over"} budget
            </span>
          </div>
        )}

        {/* Revenue tracker strip — revenue flex accounts only */}
        {isRevenueFlex && (
          <div className={`oh-sp-revstrip${trackedHS.length === homestands.length && revenueAhead ? " oh-sp-revstrip--ahead" : ""}`}>
            <div className="oh-sp-revstrip-top">
              <span className="oh-sp-revstrip-label">Season revenue</span>
              <span className="oh-sp-revstrip-count">{trackedHS.length} of {homestands.length} homestands tracked</span>
            </div>
            <div className="oh-sp-revstrip-row">
              <div className="oh-sp-revstrip-col">
                <span className="oh-sp-revstrip-sub">Forecast</span>
                <span className="oh-sp-revstrip-num oh-sp-revstrip-num--muted">${totalForecastRevenue.toLocaleString()}</span>
              </div>
              <div className="oh-sp-revstrip-col">
                <span className="oh-sp-revstrip-sub">Tracked</span>
                <span className="oh-sp-revstrip-num">${totalTrackedRevenue.toLocaleString()}</span>
              </div>
              <div className="oh-sp-revstrip-bar-wrap">
                <div className="oh-sp-revstrip-bar">
                  <div className="oh-sp-revstrip-bar-fill" style={{ width: `${Math.min(revenuePct, 100)}%` }} />
                </div>
                <span className="oh-sp-revstrip-bar-label">
                  {trackedHS.length > 0 ? `${revenuePct}% of season forecast` : "No revenue tracked yet"}
                </span>
              </div>
              {trackedHS.length > 0 && trackedHS.length === homestands.length && revenueDelta !== 0 && (
                <span className={`oh-sp-revstrip-delta${revenueAhead ? " oh-sp-revstrip-delta--pos" : " oh-sp-revstrip-delta--neg"}`}>
                  {revenueAhead ? "+" : ""}${revenueDelta.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="oh-sp-cards">
        {homestands.map((hs) => {
          const isCompleted = hs.status === "completed" || !!hs.plan;
          const isDue = hs.status === "actuals_due" && !hs.plan;
          const isActive = hs.status === "in_progress";
          const forceOpen = isActive || isDue;
          const expanded = forceOpen || expandedId === hs.id;
          const isNext = hs.id === nextId && !isActive && !isDue;

          return (
            <HomestandCard
              key={hs.id}
              hs={hs}
              account={account}
              showToast={showToast}
              openConfirm={openConfirm}
              onRefresh={onRefresh}
              expanded={expanded}
              onToggle={() => handleToggle(hs.id, isCompleted)}
              isFirstUpcoming={hs.id === firstUpcomingId}
              isNext={isNext}
            />
          );
        })}
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════
   HomestandCard
   ════════════════════════════════════════════════ */

function HomestandCard({ hs, account, showToast, openConfirm, onRefresh, expanded, onToggle, isFirstUpcoming, isNext }) {
  const [laborInput, setLaborInput] = useState("");
  const [revenueInput, setRevenueInput] = useState(hs.soldRevenue ? String(hs.soldRevenue) : "");
  const [finalRevenueInput, setFinalRevenueInput] = useState(hs.soldRevenue ? String(hs.soldRevenue) : "");
  const [submitting, setSubmitting] = useState(false);
  const [revSubmitting, setRevSubmitting] = useState(false);
  const [editingRevenue, setEditingRevenue] = useState(false);

  const isRevenueFlex = hs.isRevenueFlex;
  const budget = hs.adjustedEnvelope ?? hs.budgetEnvelope;
  const hasRevenueAdjustment = isRevenueFlex && hs.adjustedEnvelope != null;
  const isCompleted = hs.status === "completed" || !!hs.plan;
  const isDue = hs.status === "actuals_due" && !hs.plan;
  const isActive = hs.status === "in_progress";
  const canExpand = !isCompleted;
  const isHeavy = hs.totalDays >= 10 || budget >= 10000;

  const laborRatio = hs.laborRatio || 0;
  const laborRatioPct = laborRatio > 0 ? (laborRatio * 100).toFixed(1) : "0";

  // Day breakdown
  const parts = [];
  if (hs.gameDays > 0) parts.push(`${hs.gameDays} game`);
  if (hs.prepDays > 0) parts.push(`${hs.prepDays} prep`);
  if (hs.openDays > 0) parts.push(`${hs.openDays} open`);
  if (hs.closeDays > 0) parts.push(`${hs.closeDays} close`);
  if (hs.cleanDays > 0) parts.push(`${hs.cleanDays} clean`);
  const dayText = `${hs.totalDays} days: ${parts.join(", ")}`;
  const opponents = hs.opponents?.length > 0 ? ` · vs ${hs.opponents.join(", ")}` : "";

  // Payroll week info
  const weeks = hs.allWeeks || [];
  const hasOT = hs.otExposure;
  const showViz = (hs.days?.length || 0) >= 2;

  // Status
  const statusLabel = isCompleted ? "Completed"
    : isDue ? "Actuals due"
    : isActive ? "In progress"
    : isNext ? "Up next"
    : "Upcoming";
  const statusClass = isCompleted ? "oh-sp-pill--done"
    : isDue ? "oh-sp-pill--due"
    : isActive ? "oh-sp-pill--active"
    : isNext ? "oh-sp-pill--next"
    : "oh-sp-pill--upcoming";

  // OT context — only when actual OT risk
  const otContext = (() => {
    if (!hasOT) return null;
    const weekNotes = weeks.map((w, i) => {
      const otCertain = w.workingDays >= 6;
      const otLikely = w.workingDays >= 5;
      if (otCertain) return `Wk ${i + 1}: ${w.workingDays} days — OT certain`;
      if (otLikely) return `Wk ${i + 1}: ${w.workingDays} days — OT likely`;
      return `Wk ${i + 1}: ${w.workingDays} days — no OT`;
    });
    if (weeks.length >= 3) {
      const otWeeks = weeks.filter((w) => w.workingDays >= 5).length;
      const summary = otWeeks === weeks.length
        ? "OT expected every week"
        : `OT expected in ${otWeeks} of ${weeks.length} weeks`;
      return `${weekNotes.join(". ")}. ${summary}. Budget includes OT at 1.5× for hours over 40/wk.`;
    }
    return weekNotes.join(". ") + ". Budget includes OT at 1.5× for hours over 40/wk.";
  })();

  // Rippling note — only first upcoming/active
  const ripplingNote = isFirstUpcoming
    ? `Schedule ${hs.totalDays} days in Rippling. Target total: $${budget.toLocaleString()} or less.`
    : null;

  // Budget subtext for revenue flex
  const budgetSubtext = isRevenueFlex
    ? (hasRevenueAdjustment ? "adjusted from sales" : "forecast · updates with sales")
    : null;

  // ── Submit sold revenue ──
  const handleSubmitRevenue = async () => {
    const rev = parseFloat(String(revenueInput).replace(/[^0-9.]/g, "")) || 0;
    if (rev <= 0) { showToast?.("Enter sold revenue", "error"); return; }
    setRevSubmitting(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit-sold-revenue", account, homestandId: hs.id, soldRevenue: rev }),
      });
      const data = await res.json();
      if (data.success) { showToast?.("Revenue saved — budget updated"); onRefresh?.(); }
      else { showToast?.(data.error || "Failed to save", "error"); }
    } catch { showToast?.("Network error", "error"); }
    finally { setRevSubmitting(false); }
  };

  // ── Submit actuals (standard) ──
  const handleSubmit = async () => {
    const actual = parseFloat(String(laborInput).replace(/[^0-9.]/g, "")) || 0;
    if (actual <= 0) { showToast?.("Enter the labor amount", "error"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-labor-actuals", account, homestandId: hs.id,
          budgetEnvelope: budget, carryForward: 0, actualSpent: actual,
          notes: "", revenueActual: 0, actualFood: 0, actualPackaging: 0,
        }),
      });
      const data = await res.json();
      if (data.success) { showToast?.("Actuals saved"); onRefresh?.(); }
      else { showToast?.(data.error || "Submission failed", "error"); }
    } catch { showToast?.("Network error", "error"); }
    finally { setSubmitting(false); }
  };

  // ── Submit actuals (revenue flex — includes final revenue) ──
  const handleSubmitFlex = async () => {
    const actual = parseFloat(String(laborInput).replace(/[^0-9.]/g, "")) || 0;
    const finalRev = parseFloat(String(finalRevenueInput).replace(/[^0-9.]/g, "")) || 0;
    if (actual <= 0) { showToast?.("Enter the labor amount", "error"); return; }
    setSubmitting(true);
    try {
      if (finalRev > 0 && finalRev !== hs.soldRevenue) {
        await fetch("/api/ops", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "submit-sold-revenue", account, homestandId: hs.id, soldRevenue: finalRev }),
        });
      }
      const adjBudget = finalRev > 0 && laborRatio > 0 ? Math.round(finalRev * laborRatio) : budget;
      const res = await fetch("/api/ops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-labor-actuals", account, homestandId: hs.id,
          budgetEnvelope: adjBudget, carryForward: 0, actualSpent: actual,
          notes: "", revenueActual: finalRev, actualFood: 0, actualPackaging: 0,
        }),
      });
      const data = await res.json();
      if (data.success) { showToast?.("Actuals saved"); onRefresh?.(); }
      else { showToast?.(data.error || "Submission failed", "error"); }
    } catch { showToast?.("Network error", "error"); }
    finally { setSubmitting(false); }
  };

  const cardClass = [
    "oh-sp-card",
    isCompleted && "oh-sp-card--done",
    isDue && "oh-sp-card--due",
    isActive && "oh-sp-card--active",
    isNext && "oh-sp-card--next",
    isHeavy && !isCompleted && "oh-sp-card--heavy",
    !expanded && canExpand && "oh-sp-card--collapsed",
    expanded && canExpand && "oh-sp-card--expanded",
    !canExpand && "oh-sp-card--locked",
  ].filter(Boolean).join(" ");

  return (
    <div className={cardClass}>
      {/* Header row */}
      <div
        className={`oh-sp-card-top${canExpand ? " oh-sp-card-top--click" : ""}`}
        onClick={canExpand ? onToggle : undefined}
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onKeyDown={canExpand ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      >
        <div className="oh-sp-card-info">
          <span className={`oh-sp-pill ${statusClass}`}>{statusLabel}</span>
          <h3 className="oh-sp-card-title">
            {hs.id} · {F.dateShort(hs.startDate)} – {F.dateShort(hs.endDate)}
          </h3>
          <p className="oh-sp-card-meta">{dayText}{opponents}</p>

          {/* Mini viz strip — collapsed non-completed cards only */}
          {!expanded && canExpand && showViz && (
            <MiniViz days={hs.days} weeks={weeks} />
          )}
        </div>
        <div className="oh-sp-card-right">
          <div className="oh-sp-card-budget">
            {isCompleted && hs.plan ? (
              <div className="oh-sp-done-budget">
                <span className="oh-sp-done-budgetnum">${budget.toLocaleString()}</span>
                {isRevenueFlex && hs.plan.revenueActual > 0 && (
                  <span className="oh-sp-card-rev-note">from ${hs.plan.revenueActual.toLocaleString()} rev</span>
                )}
                <div className="oh-sp-done-row">
                  <span className="oh-sp-done-label">spent</span>
                  <span className="oh-sp-done-spent">${hs.plan.actualSpent.toLocaleString()}</span>
                  <span className={`oh-sp-done-var${hs.plan.variance >= 0 ? " oh-sp-done-var--pos" : " oh-sp-done-var--neg"}`}>
                    {hs.plan.variance >= 0 ? "+" : ""}${Math.abs(hs.plan.variance).toLocaleString()}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <span className="oh-sp-card-budgetnum">
                  ${budget.toLocaleString()}
                </span>
                {budgetSubtext && expanded && (
                  <span className={`oh-sp-card-budget-sub${hasRevenueAdjustment ? " oh-sp-card-budget-sub--adjusted" : ""}`}>
                    {budgetSubtext}
                  </span>
                )}
              </>
            )}
          </div>
          {canExpand && (
            <svg
              className={`oh-sp-chev${expanded ? " oh-sp-chev--open" : ""}`}
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && canExpand && (
        <div className="oh-sp-detail">

          {/* Revenue flex: sold revenue section (before/during homestand) */}
          {isRevenueFlex && !isDue && (
            <div className="oh-sp-rev-section">
              {hasRevenueAdjustment && !editingRevenue ? (
                <div className="oh-sp-rev-confirmed">
                  <div className="oh-sp-rev-confirmed-top">
                    <p className="oh-sp-rev-confirmed-eq">
                      Sold <strong>${hs.soldRevenue.toLocaleString()}</strong>
                      <span className="oh-sp-rev-sep">&times;</span>
                      {laborRatioPct}%
                      <span className="oh-sp-rev-sep">=</span>
                      <strong>${hs.adjustedEnvelope.toLocaleString()}</strong> labor
                    </p>
                    <button className="oh-sp-rev-update-btn" onClick={() => {
                      setRevenueInput(String(hs.soldRevenue));
                      setEditingRevenue(true);
                    }}>
                      Update sales
                    </button>
                  </div>
                  {hs.revenue > 0 && hs.soldRevenue !== hs.revenue && (
                    <p className="oh-sp-rev-delta">
                      {hs.soldRevenue > hs.revenue
                        ? `+$${(hs.adjustedEnvelope - hs.budgetEnvelope).toLocaleString()} more labor budget vs forecast`
                        : `-$${(hs.budgetEnvelope - hs.adjustedEnvelope).toLocaleString()} less labor budget vs forecast`}
                    </p>
                  )}
                </div>
              ) : (
                <div className="oh-sp-rev-entry">
                  <div className="oh-sp-rev-entry-top">
                    <div>
                      <p className="oh-sp-rev-entry-title">{editingRevenue ? "Update sold revenue" : "Sold revenue"}</p>
                      <p className="oh-sp-rev-entry-hint">Updates your labor budget at {laborRatioPct}% of revenue</p>
                    </div>
                    <div className="oh-sp-rev-entry-forecast">
                      <span className="oh-sp-rev-entry-forecast-label">{editingRevenue ? "Current" : "Forecast"}</span>
                      <span className="oh-sp-rev-entry-forecast-num">${editingRevenue ? (hs.soldRevenue || 0).toLocaleString() : (hs.revenue || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="oh-sp-rev-entry-row">
                    <div className="oh-sp-actuals-wrap">
                      <span className="oh-sp-actuals-prefix">$</span>
                      <input
                        className="oh-sp-actuals-input oh-sp-actuals-input--rev"
                        type="text"
                        inputMode="decimal"
                        placeholder={editingRevenue ? "New revenue" : "Enter sold revenue"}
                        value={revenueInput}
                        onChange={(e) => setRevenueInput(e.target.value.replace(/[^0-9.,]/g, ""))}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <button
                      className="oh-btn oh-btn--blue"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rev = parseFloat(String(revenueInput).replace(/[^0-9.]/g, "")) || 0;
                        if (rev <= 0) { showToast?.("Enter sold revenue", "error"); return; }
                        const nb = Math.round(rev * laborRatio);
                        openConfirm?.("Update Budget", `Save $${rev.toLocaleString()} as sold revenue? Labor budget adjusts to $${nb.toLocaleString()}.`, "Save", () => {
                          handleSubmitRevenue();
                          setEditingRevenue(false);
                        });
                      }}
                      disabled={revSubmitting || !revenueInput}
                    >
                      {revSubmitting ? "Saving..." : "Update budget"}
                    </button>
                    {editingRevenue && (
                      <button className="oh-sp-rev-cancel-btn" onClick={() => setEditingRevenue(false)}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {showViz && <DayViz days={hs.days} weeks={weeks} />}

          {!isCompleted && (
            <div className="oh-sp-instruction">
              <div className="oh-sp-instruction-top">
                <p className="oh-sp-instruction-text">
                  {isRevenueFlex && hasRevenueAdjustment
                    ? <>Budget updated from sales. Schedule <strong>{hs.totalDays} days</strong> in Rippling. Keep your total at or below:</>
                    : <>Schedule <strong>{hs.totalDays} days</strong> in Rippling. Keep your schedule total at or below:</>
                  }
                </p>
                <span className="oh-sp-instruction-target">${budget.toLocaleString()}</span>
              </div>
              {otContext && <p className="oh-sp-instruction-ot">{otContext}</p>}
            </div>
          )}

          {/* Actuals entry: STANDARD (non-revenue-flex) */}
          {isDue && !isRevenueFlex && (
            <div className="oh-sp-actuals">
              <p className="oh-sp-actuals-prompt">How much did you actually spend on labor?</p>
              <p className="oh-sp-actuals-hint">Pull your total labor cost from Rippling for this homestand.</p>
              <div className="oh-sp-actuals-row">
                <div className="oh-sp-actuals-wrap">
                  <span className="oh-sp-actuals-prefix">$</span>
                  <input
                    className="oh-sp-actuals-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={laborInput}
                    onChange={(e) => setLaborInput(e.target.value.replace(/[^0-9.,]/g, ""))}
                  />
                </div>
                <button
                  className="oh-btn oh-btn--blue"
                  onClick={() => {
                    const actual = parseFloat(String(laborInput).replace(/[^0-9.]/g, "")) || 0;
                    if (actual <= 0) { showToast?.("Enter the labor amount", "error"); return; }
                    openConfirm?.(
                      "Submit Actuals",
                      `Submit $${actual.toLocaleString()} as labor spend for ${hs.id}?`,
                      "Submit",
                      handleSubmit
                    );
                  }}
                  disabled={submitting || !laborInput}
                >
                  {submitting ? "Saving..." : "Submit"}
                </button>
              </div>
            </div>
          )}

          {/* Actuals entry: REVENUE FLEX (TXR-V) — two fields */}
          {isDue && isRevenueFlex && (
            <div className="oh-sp-actuals">
              <p className="oh-sp-actuals-prompt">Final numbers for this homestand</p>
              <p className="oh-sp-actuals-hint">Update final revenue if it changed, then enter your labor actual from Rippling.</p>
              <div className="oh-sp-flex-grid">
                <div>
                  <label className="oh-sp-flex-label">Final revenue</label>
                  <div className="oh-sp-actuals-wrap">
                    <span className="oh-sp-actuals-prefix">$</span>
                    <input
                      className="oh-sp-actuals-input oh-sp-actuals-input--half"
                      type="text"
                      inputMode="decimal"
                      placeholder={hs.soldRevenue ? String(hs.soldRevenue) : "0"}
                      value={finalRevenueInput}
                      onChange={(e) => setFinalRevenueInput(e.target.value.replace(/[^0-9.,]/g, ""))}
                    />
                  </div>
                </div>
                <div>
                  <label className="oh-sp-flex-label">Actual labor (Rippling)</label>
                  <div className="oh-sp-actuals-wrap">
                    <span className="oh-sp-actuals-prefix">$</span>
                    <input
                      className="oh-sp-actuals-input oh-sp-actuals-input--half"
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={laborInput}
                      onChange={(e) => setLaborInput(e.target.value.replace(/[^0-9.,]/g, ""))}
                    />
                  </div>
                </div>
              </div>
              <button
                className="oh-btn oh-btn--blue"
                style={{ width: "100%", marginTop: 10 }}
                onClick={() => {
                  const actual = parseFloat(String(laborInput).replace(/[^0-9.]/g, "")) || 0;
                  if (actual <= 0) { showToast?.("Enter the labor amount", "error"); return; }
                  const finalRev = parseFloat(String(finalRevenueInput).replace(/[^0-9.]/g, "")) || 0;
                  const adjBudget = finalRev > 0 && laborRatio > 0 ? Math.round(finalRev * laborRatio) : budget;
                  openConfirm?.(
                    "Submit Actuals",
                    `Submit $${actual.toLocaleString()} labor${finalRev > 0 ? ` against $${finalRev.toLocaleString()} revenue (target: $${adjBudget.toLocaleString()})` : ""} for ${hs.id}?`,
                    "Submit",
                    handleSubmitFlex
                  );
                }}
                disabled={submitting || !laborInput}
              >
                {submitting ? "Saving..." : "Submit actuals"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ════════════════════════════════════════════════
   MiniViz — tiny bar strip for collapsed cards
   ════════════════════════════════════════════════ */

const MINI_COLORS = {
  GAME:  "#0f3057",
  PREP:  "#fef3c7",
  OPEN:  "#dbeafe",
  CLOSE: "#e2e8f0",
  CLEAN: "#f0fdf4",
};
const MINI_DEFAULT = "#f1f5f9";

function MiniViz({ days, weeks }) {
  if (!days || days.length < 2) return null;

  const weekStarts = new Set();
  if (weeks && weeks.length > 1) {
    weeks.forEach((w, i) => { if (i > 0) weekStarts.add(w.weekOf); });
  }

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const items = [];

  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    if (weekStarts.has(d.date)) {
      items.push({ type: "reset" });
    }
    if (i > 0) {
      const prev = new Date(sorted[i - 1].date + "T12:00:00");
      const curr = new Date(d.date + "T12:00:00");
      const diff = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diff === 2) {
        const gapDate = new Date(prev);
        gapDate.setDate(gapDate.getDate() + 1);
        const gapStr = gapDate.toISOString().split("T")[0];
        if (weekStarts.has(gapStr)) items.push({ type: "reset" });
        items.push({ type: "gap" });
      }
    }
    const isGame = d.dayType === "GAME";
    items.push({
      type: "day",
      color: MINI_COLORS[d.dayType] || MINI_DEFAULT,
      height: isGame ? 16 : 10,
    });
  }

  return (
    <div className="oh-sp-mini">
      {items.map((item, i) => {
        if (item.type === "reset") return <div key={`r${i}`} className="oh-sp-mini-reset" />;
        if (item.type === "gap") return <div key={`g${i}`} className="oh-sp-mini-gap" />;
        return (
          <div
            key={`d${i}`}
            className="oh-sp-mini-bar"
            style={{ height: item.height, background: item.color }}
          />
        );
      })}
    </div>
  );
}


/* ════════════════════════════════════════════════
   DayViz — full bar chart (expanded state)
   ════════════════════════════════════════════════ */

function DayViz({ days, weeks }) {
  if (!days || days.length === 0) return null;

  const dayTypes = {
    GAME:  { color: "#0f3057", textColor: "#fff", height: 56 },
    PREP:  { color: "#fef3c7", textColor: "#92400e", height: 38 },
    OPEN:  { color: "#dbeafe", textColor: "#1e40af", height: 42 },
    CLOSE: { color: "#e2e8f0", textColor: "#475569", height: 42 },
    CLEAN: { color: "#f0fdf4", textColor: "#166534", height: 34 },
  };
  const defaultType = { color: "#f1f5f9", textColor: "#64748b", height: 28 };

  const weekStarts = new Set();
  if (weeks && weeks.length > 1) {
    weeks.forEach((w, i) => { if (i > 0) weekStarts.add(w.weekOf); });
  }

  const items = [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    if (weekStarts.has(d.date)) items.push({ type: "reset" });

    if (i > 0) {
      const prev = new Date(sorted[i - 1].date + "T12:00:00");
      const curr = new Date(d.date + "T12:00:00");
      const diff = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diff === 2) {
        const gapDate = new Date(prev);
        gapDate.setDate(gapDate.getDate() + 1);
        const gapStr = gapDate.toISOString().split("T")[0];
        if (weekStarts.has(gapStr)) items.push({ type: "reset" });
        items.push({
          type: "gap",
          dow: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][gapDate.getDay()],
          dateShort: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][gapDate.getMonth()]} ${gapDate.getDate()}`,
        });
      }
    }

    const dt = new Date(d.date + "T12:00:00");
    items.push({
      type: "day",
      dayType: d.dayType,
      opponent: d.opponent || "",
      date: d.date,
      dow: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()],
      dateShort: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()]} ${dt.getDate()}`,
    });
  }

  const weekSummaries = (weeks || []).map((w, i) => {
    const otCertain = w.workingDays >= 6;
    const otLikely = w.workingDays >= 5;
    return {
      label: `Wk ${i + 1}: ${w.workingDays} days`,
      cls: otCertain ? "oh-sp-wk--danger" : otLikely ? "oh-sp-wk--warn" : "",
      text: otCertain ? "OT certain" : otLikely ? "OT likely" : "no OT",
    };
  });

  return (
    <div className="oh-sp-viz">
      <div className="oh-sp-viz-row">
        {items.map((item, i) => {
          if (item.type === "reset") {
            return <div key={`r${i}`} className="oh-sp-viz-reset"><span className="oh-sp-viz-reset-lbl">OT reset</span></div>;
          }
          if (item.type === "gap") {
            return (
              <div key={`g${i}`} className="oh-sp-viz-day oh-sp-viz-day--gap">
                <div className="oh-sp-viz-bar" style={{ height: 14, background: "#f1f5f9" }}>
                  <span className="oh-sp-viz-txt" style={{ color: "#94a3b8", fontSize: 7 }}>off</span>
                </div>
                <span className="oh-sp-viz-dow">{item.dow}</span>
                <span className="oh-sp-viz-date">{item.dateShort}</span>
              </div>
            );
          }
          const cfg = dayTypes[item.dayType] || defaultType;
          const label = item.dayType === "GAME" ? (item.opponent || "GAME") : item.dayType;
          return (
            <div key={item.date} className="oh-sp-viz-day">
              <div className="oh-sp-viz-bar" style={{ height: cfg.height, background: cfg.color }}>
                <span className="oh-sp-viz-txt" style={{ color: cfg.textColor }}>{label}</span>
              </div>
              <span className="oh-sp-viz-dow">{item.dow}</span>
              <span className="oh-sp-viz-date">{item.dateShort}</span>
            </div>
          );
        })}
      </div>
      {weekSummaries.length > 1 && (
        <div className="oh-sp-viz-weeks">
          {weekSummaries.map((ws, i) => (
            <span key={i} className={`oh-sp-wk ${ws.cls}`}>{ws.label} · {ws.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}