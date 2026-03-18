"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import F from "@/app/ops/components/shared/F";
import CostGauge from "@/app/ops/components/shared/CostGauge";
import ProgressRingMini from "@/app/ops/components/shared/ProgressRingMini";
import PeriodCard from "@/app/ops/components/labor/PeriodCard";
import PeriodSnapshot from "@/app/ops/components/labor/PeriodSnapshot";
import ExecutiveDashboard from "@/app/ops/components/executive/ExecutiveDashboard";

// ── API base — proxies through /api/financial → /api/ops backend
// Change to '/api/financial' once financial/route.js is deployed
const API = '/api/ops';

export default function FinancialTool({ showToast, openConfirm }) {
  const [account, setAccount]             = useState("");
  const [laborData, setLaborData]         = useState(null);
  const [plannerData, setPlannerData]     = useState(null);
  const [crossAccount, setCrossAccount]   = useState(null);
  const [mlbAccounts, setMlbAccounts]     = useState([]);
  const [pdcAccounts, setPdcAccounts]     = useState([]);
  const [milbAccounts, setMilbAccounts]   = useState([]);
  const [laborAccounts, setLaborAccounts] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [acctLoading, setAcctLoading]     = useState(false);
  const [expandedHS, setExpandedHS]       = useState(null);
  const [subView, setSubView]             = useState("timeline");
  const [isAdmin, setIsAdmin]             = useState(false);

  const currentAcctInfo  = laborAccounts.find((a) => a.key === account);
  const acctLevel        = currentAcctInfo?.level || "";
  const isPDC            = acctLevel === "PDC";
  const isMLB            = acctLevel === "MLB";
  const isMiLB           = acctLevel === "MILB" || acctLevel === "AAA";
  const isSeasonal       = isMLB || isMiLB;
  const accountFlags     = laborData?.accountFlags || {};
  const isRevenueFixed   = accountFlags.isRevenueFixed || false;
  const hasHourlyLabor   = accountFlags.hasHourlyLabor !== false;
  const budgetLabel      = isSeasonal ? "Season" : "Annual";

  /* ── Bootstrap: account lists + cross-account summary ── */
  useEffect(() => {
    setLoading(true);
    fetch(`${API}?action=labor-bootstrap`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setMlbAccounts(d.mlbAccounts   || []);
          setPdcAccounts(d.pdcAccounts   || []);
          setMilbAccounts(d.milbAccounts || []);
          setLaborAccounts(d.laborAccounts || []);
          setCrossAccount(d.crossAccount || []);
          setIsAdmin(d.isAdmin || false);
          if (d.isAdmin && !account) setSubView("overview");
        }
      })
      .catch(() => showToast?.("Failed to load financial data", "error"))
      .finally(() => setLoading(false));
  }, []);

  /* ── Account-specific data (Dashboard tab) ── */
  useEffect(() => {
    if (!account) return;
    setLaborData(null);
    setPlannerData(null);
    setAcctLoading(true);
    // If switching account while on snapshot, reset plannerData
    fetch(`${API}?action=labor-bootstrap&account=${encodeURIComponent(account)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.laborData) {
          setLaborData(d.laborData);
          const items = d.laborData.periodCards || [];
          const next  = items.find((x) =>
            x.status === "in_progress" || x.status === "actuals_due" || x.status === "upcoming"
          );
          setExpandedHS(next?.id || null);
        }
      })
      .catch(() => showToast?.("Failed to load account data", "error"))
      .finally(() => setAcctLoading(false));
  }, [account]);

  /* ── Snapshot (reconciliation) data — lazy load ── */
  useEffect(() => {
    if (subView !== "reconciliation" || !account || plannerData) return;
    fetch(`${API}?action=labor-bootstrap&account=${encodeURIComponent(account)}&view=snapshot`)
      .then((r) => r.json())
      .then((d) => { if (d.success && d.plannerData) setPlannerData(d.plannerData); })
      .catch(() => showToast?.("Failed to load snapshot data", "error"));
  }, [subView, account, plannerData]);

  const handleRefresh = useCallback(() => {
    if (!account) return;
    setLaborData(null);
    setAcctLoading(true);
    fetch(`${API}?action=labor-bootstrap&account=${encodeURIComponent(account)}`)
      .then((r) => r.json())
      .then((d) => { if (d.success && d.laborData) setLaborData(d.laborData); })
      .finally(() => setAcctLoading(false));
  }, [account]);

  /* ── Loading spinner ── */
  if (loading) {
    return (
      <div className="oh-view" style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <div className="oh-spinner" />
      </div>
    );
  }

  const sm           = laborData?.seasonMetrics;
  const periodCards  = laborData?.periodCards || [];
  const acctLabel    = laborAccounts.find((a) => a.key === account)?.label || account;

  /* ════════════════════════════════════════
     RENDER
  ════════════════════════════════════════ */
  return (
    <div className="oh-view" style={{ animation: "oh-slideUp 0.4s ease" }}>
      <div className="oh-tool-shell">

        {/* ── Toolbar: tabs left, account selector right ── */}
        <div className="oh-tool-toolbar">
          <div className="oh-tool-tabs">
            {[
              { key: "timeline",       label: "Dashboard" },
              { key: "reconciliation", label: "Snapshot"  },
              ...(isAdmin ? [{ key: "overview", label: "Portfolio" }] : []),
            ].map((t) => (
              <button
                key={t.key}
                className={`oh-subnav-btn${subView === t.key ? " oh-subnav-active" : ""}`}
                onClick={() => setSubView(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="oh-tool-acct">
            <select
              className="oh-select oh-select-compact"
              value={account}
              onChange={(e) => { setAccount(e.target.value); setSubView("timeline"); }}
            >
              <option value="" disabled>Select account…</option>
              {mlbAccounts.length > 0 && (
                <optgroup label="MLB">
                  {mlbAccounts.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </optgroup>
              )}
              {pdcAccounts.length > 0 && (
                <optgroup label="Player Development">
                  {pdcAccounts.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </optgroup>
              )}
              {milbAccounts.length > 0 && (
                <optgroup label="Minor League">
                  {milbAccounts.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </optgroup>
              )}
            </select>
            <button className="oh-btn-refresh" onClick={handleRefresh} title="Refresh">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
        </div>

        {/* ══════════════════════════════════
            DASHBOARD TAB
        ══════════════════════════════════ */}
        {subView === "timeline" && (
          <div className="oh-tool-body">
            {!account ? (
              <div className="oh-tool-empty">
                <div className="oh-tool-empty-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5">
                    <path d="M3 3h7l2 2h9v14H3V3z" /><path d="M12 11v4" /><path d="M12 17h.01" />
                  </svg>
                </div>
                <h3 className="oh-tool-empty-title">Select your account</h3>
                <p className="oh-tool-empty-desc">
                  Choose an account from the dropdown above to see your KPI dashboard, cost breakdowns, and period activity.
                </p>
              </div>
            ) : (
              <>
                {/* ── KPI Widget ── */}
                {sm && (() => {
                  const items = periodCards;
                  const periodResultsArr = [];
                  const sparklineArr     = [];

                  for (const item of items) {
                    if (!item.plan && item.status !== "completed") continue;
                    const plan = item.plan;
                    if (!plan) continue;
                    const ra = plan.revenueActual || 0;
                    const rf = item.revenue        || 0;
                    let pVar;
                    if (ra > 0 && rf > 0) {
                      const ratio = ra / rf;
                      const lb = item.hourlyBudget   || item.budgetEnvelope || 0;
                      const fb = item.foodBudget     || 0;
                      const pb = item.packagingBudget || 0;
                      const lt = Math.round(lb * ratio);
                      const ft = Math.round(fb * ratio);
                      const pt = Math.round(pb * ratio);
                      pVar = (lt + ft + pt) - (plan.actualSpent + (plan.actualFood || 0) + (plan.actualPackaging || 0));
                    } else {
                      pVar = plan.variance;
                    }
                    periodResultsArr.push({ id: item.id, var: pVar });
                    sparklineArr.push(pVar);
                  }

                  const totalActualCosts  = sm.budgetUsed + (sm.foodActualTotal || 0) + (sm.packagingActualTotal || 0);
                  const totalActualRev    = sm.revenueActualTotal || 0;
                  const costToRevPct      = totalActualRev > 0 ? (totalActualCosts / totalActualRev) * 100 : 0;
                  const totalBudgetCosts  = sm.seasonBudgetTotal + (sm.totalFoodBudget || 0) + (sm.totalPackagingBudget || 0);
                  const totalForecastRev  = sm.seasonRevenue || 0;
                  const budgetRatioPct    = totalForecastRev > 0 ? (totalBudgetCosts / totalForecastRev) * 100 : 0;
                  const hasRevData        = totalActualRev > 0;
                  const hasCompletedPeriods = sm.completedCount > 0;

                  let completedForecastRev = 0;
                  for (const item of items) {
                    if (item.plan) completedForecastRev += item.revenue || 0;
                  }

                  let gaugeBudgetPct = budgetRatioPct;
                  if (hasRevData && completedForecastRev > 0) {
                    let completedBudgetCosts = 0;
                    for (const item of items) {
                      if (item.plan) {
                        completedBudgetCosts += (item.hourlyBudget || item.budgetEnvelope || 0)
                          + (item.foodBudget || 0)
                          + (item.packagingBudget || 0);
                      }
                    }
                    gaugeBudgetPct = (completedBudgetCosts / completedForecastRev) * 100;
                  }

                  const gaugeActualPct = hasRevData ? costToRevPct : 0;
                  const gaugeIsOnTarget = sm.cumulativeVariance >= 0;

                  const activeItem = items.find((x) => x.status === "in_progress" || x.status === "active");
                  let currentPeriodLabel = null;
                  if (activeItem) {
                    const startD   = new Date(activeItem.startDate);
                    const dayNum   = Math.max(1, Math.ceil((Date.now() - startD) / 86400000));
                    const totalDays = activeItem.totalDays || activeItem.days?.length || 28;
                    currentPeriodLabel = `${activeItem.id}: Day ${dayNum} of ${totalDays}`;
                  }

                  let cpLaborBudget = 0, cpFoodBudget = 0, cpPkgBudget = 0;
                  for (const item of items) {
                    if (item.plan) {
                      cpLaborBudget += item.hourlyBudget  || item.budgetEnvelope || 0;
                      cpFoodBudget  += item.foodBudget    || 0;
                      cpPkgBudget   += item.packagingBudget || 0;
                    }
                  }

                  let nudgeMsg = null;
                  if (hasRevData && hasCompletedPeriods && completedForecastRev > 0) {
                    const laborPct        = (sm.budgetUsed / totalActualRev) * 100;
                    const foodPct         = ((sm.foodActualTotal || 0) / totalActualRev) * 100;
                    const packPct         = ((sm.packagingActualTotal || 0) / totalActualRev) * 100;
                    const laborBudgetPct  = cpLaborBudget > 0 ? (cpLaborBudget / completedForecastRev) * 100 : 0;
                    const foodBudgetPct   = cpFoodBudget  > 0 ? (cpFoodBudget  / completedForecastRev) * 100 : 0;
                    const packBudgetPct   = cpPkgBudget   > 0 ? (cpPkgBudget   / completedForecastRev) * 100 : 0;
                    const gaps = [
                      { label: "Labor",     gap: laborPct - laborBudgetPct },
                      { label: "Food cost", gap: foodPct  - foodBudgetPct  },
                      { label: "Packaging", gap: packPct  - packBudgetPct  },
                    ].filter((g) => g.gap > 0.5);
                    gaps.sort((a, b) => b.gap - a.gap);
                    if (gaps.length > 0) {
                      nudgeMsg = `📌 ${gaps[0].label} is running ${gaps[0].gap.toFixed(1)}% above target — largest controllable gap`;
                    } else if (sm.cumulativeVariance > 0) {
                      nudgeMsg = `✅ All cost lines within target — ${sm.currentStreak > 1 ? `${sm.currentStreak} in a row` : "keep it up"}`;
                    }
                  }

                  const catLabor = { label: "Labor",         actual: sm.budgetUsed,               budget: cpLaborBudget || sm.seasonBudgetTotal };
                  const catFood  = { label: "Food",          actual: sm.foodActualTotal || 0,      budget: cpFoodBudget  || (sm.totalFoodBudget  || 0) };
                  const catPkg   = { label: "Pkg & Supplies", actual: sm.packagingActualTotal || 0, budget: cpPkgBudget   || (sm.totalPackagingBudget || 0) };
                  const costCategories = [catLabor];
                  if (catFood.budget > 0 || catFood.actual > 0) costCategories.push(catFood);
                  if (catPkg.budget  > 0 || catPkg.actual  > 0) costCategories.push(catPkg);

                  if (!hasCompletedPeriods) {
                    return (
                      <div className="oh-kpi-empty">
                        <div className="oh-kpi-empty-gauge">
                          <CostGauge actual={0} budget={Math.round(budgetRatioPct * 10) / 10} />
                        </div>
                        <div className="oh-kpi-empty-text">
                          <span className="oh-kpi-label" style={{ fontSize: 13, letterSpacing: 0 }}>
                            {currentPeriodLabel
                              ? `🕐 ${currentPeriodLabel}`
                              : `${budgetLabel} Budget: $${sm.seasonBudgetTotal.toLocaleString()}`}
                          </span>
                          <span style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>
                            Submit period actuals to activate your dashboard
                          </span>
                        </div>
                      </div>
                    );
                  }

                  const revDelta    = totalActualRev - completedForecastRev;
                  const revDeltaPct = completedForecastRev > 0 ? Math.round((revDelta / completedForecastRev) * 100) : 0;

                  return (
                    <div className="oh-kpi-widget">
                      <div className="oh-kpi-hero-top">
                        <div className="oh-kpi-hero-gauge">
                          {hasRevData ? (
                            <CostGauge
                              actual={Math.round(gaugeActualPct * 10) / 10}
                              budget={Math.round(gaugeBudgetPct * 10) / 10}
                              verdict={gaugeIsOnTarget}
                            />
                          ) : (
                            <div style={{ textAlign: "center", padding: "8px 0" }}>
                              <span className="oh-kpi-label">{budgetLabel} Budget</span>
                              <div className="oh-kpi-value" style={{ fontSize: 22 }}>
                                ${sm.seasonBudgetTotal.toLocaleString()}
                              </div>
                              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                                ${sm.budgetRemaining.toLocaleString()} left
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="oh-kpi-hero-variance">
                          <span className="oh-kpi-label">Savings vs Budget</span>
                          <span
                            className="oh-kpi-value"
                            style={{ color: sm.cumulativeVariance >= 0 ? "#16a34a" : "#dc2626" }}
                          >
                            {sm.cumulativeVariance >= 0 ? "+" : "-"}${Math.abs(sm.cumulativeVariance).toLocaleString()}
                          </span>
                          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                            {sm.completedCount === 1
                              ? `${items.find(x => x.plan)?.id || "P1"} only`
                              : `across ${sm.completedCount} completed periods`}
                          </span>
                        </div>

                        {currentPeriodLabel && (
                          <div className="oh-kpi-period-badge">
                            <span className="oh-kpi-period-badge-dot" />
                            {currentPeriodLabel}
                          </div>
                        )}
                      </div>

                      <div className="oh-kpi-hero-footer">
                        {hasRevData && (
                          <>
                            <div className="oh-kpi-ctx-item">
                              <span className="oh-kpi-label">Revenue</span>
                              <span style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>
                                ${Math.round(totalActualRev / 1000)}K
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: revDelta >= 0 ? "#16a34a" : "#dc2626" }}>
                                {revDelta >= 0 ? "+" : ""}{Math.round(revDelta / 1000)}K vs forecast ({revDeltaPct >= 0 ? "+" : ""}{revDeltaPct}%)
                              </span>
                            </div>
                            <div className="oh-kpi-ctx-divider" />
                          </>
                        )}
                        <div className="oh-kpi-ctx-item">
                          <span className="oh-kpi-label">Input Streak</span>
                          <div className="oh-kpi-ctx-streak">
                            <ProgressRingMini
                              completed={sm.completedCount}
                              total={sm.totalHomestands}
                              results={periodResultsArr}
                            />
                            <span style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
                              {sm.completedCount}/{sm.totalHomestands}
                            </span>
                            {sm.currentStreak > 0
                              ? <span style={{ fontSize: 11, fontWeight: 800, color: "#92400e" }}>🔥 {sm.currentStreak} on target</span>
                              : sm.completedCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>no streak</span>
                            }
                          </div>
                        </div>
                        <div className="oh-kpi-ctx-divider" />
                        <div className="oh-kpi-ctx-item">
                          <span className="oh-kpi-label">{budgetLabel} Cost Budget</span>
                          <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                            ${sm.seasonBudgetTotal.toLocaleString()}
                          </span>
                          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                            ${sm.budgetRemaining.toLocaleString()} remaining
                          </span>
                        </div>
                      </div>

                      {costCategories.length > 1 && hasRevData && (
                        <div className="oh-kpi-costs-section">
                          {costCategories.map((cat) => {
                            const actualPct = totalActualRev > 0 ? (cat.actual / totalActualRev) * 100 : 0;
                            const targetPct = completedForecastRev > 0 ? (cat.budget / completedForecastRev) * 100 : 0;
                            const ok     = actualPct <= targetPct + 0.5;
                            const barMax = Math.max(actualPct, targetPct, 1) * 1.3;
                            return (
                              <div key={cat.label} className="oh-kpi-cost-item">
                                <div className="oh-kpi-cost-header">
                                  <span className="oh-kpi-cost-name">{cat.label}</span>
                                  <span className={`oh-kpi-cost-pct ${ok ? "oh-sc-green-text" : "oh-sc-amber-text"}`}>
                                    {actualPct.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="oh-kpi-cost-bar-bg">
                                  <div
                                    className="oh-kpi-cost-bar-fill"
                                    style={{
                                      width: `${Math.min((actualPct / barMax) * 100, 100)}%`,
                                      background: ok
                                        ? "linear-gradient(90deg, #86efac, #22c55e)"
                                        : "linear-gradient(90deg, #fca5a5, #ef4444)",
                                    }}
                                  />
                                  <div
                                    className="oh-kpi-cost-bar-marker"
                                    style={{ left: `${Math.min((targetPct / barMax) * 100, 100)}%` }}
                                  />
                                </div>
                                <div className="oh-kpi-cost-footer">
                                  <span>${(cat.actual / 1000).toFixed(1)}K</span>
                                  <span>
                                    target {targetPct.toFixed(1)}%
                                    {!ok && (
                                      <span style={{ color: "#dc2626", fontWeight: 800 }}>
                                        {" "}(+{(actualPct - targetPct).toFixed(1)})
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {nudgeMsg && <div className="oh-kpi-nudge">{nudgeMsg}</div>}
                    </div>
                  );
                })()}

                {/* ── Period Activity Label ── */}
                {!acctLoading && laborData && (
                  <div className="oh-timeline-label">
                    <span>Period Activity</span>
                    <div className="oh-timeline-label-line" />
                  </div>
                )}

                {/* ── Period Cards ── */}
                {acctLoading || !laborData ? (
                  <div className="oh-timeline">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="oh-hs-card oh-hs-skeleton">
                        <div className="oh-skel-bar oh-skel-short" />
                        <div className="oh-skel-bar oh-skel-long"  />
                        <div className="oh-skel-bar oh-skel-med"   />
                      </div>
                    ))}
                  </div>
                ) : periodCards.length === 0 ? (
                  <div className="oh-card" style={{ textAlign: "center", padding: 40 }}>
                    <p className="oh-card-desc">No period data found for this account.</p>
                  </div>
                ) : (
                  <>
                    {sm && sm.completedCount === 0 && periodCards.every((p) => p.status === "upcoming") && (
                      <div className="oh-preseason-msg">
                        <span>📋</span>
                        <span>
                          {budgetLabel} starts{" "}
                          <strong>
                            {F.dateShort(
                              periodCards.find(
                                (p) => p.hourlyBudget > 0 || p.foodBudget > 0 || p.revenue > 0
                              )?.startDate || periodCards[0]?.startDate
                            )}
                          </strong>{" "}
                          — expand a period to plan ahead.
                        </span>
                      </div>
                    )}
                    <div className="oh-timeline">
                      {periodCards.map((pc, idx) => (
                        <PeriodCard
                          key={pc.id}
                          pc={pc}
                          idx={idx}
                          expanded={expandedHS === pc.id}
                          onToggle={() => setExpandedHS(expandedHS === pc.id ? null : pc.id)}
                          showToast={showToast}
                          openConfirm={openConfirm}
                          account={account}
                          onRefresh={handleRefresh}
                          prevPC={idx > 0 ? periodCards[idx - 1] : null}
                          accountFlags={accountFlags}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════
            SNAPSHOT TAB
        ══════════════════════════════════ */}
        {subView === "reconciliation" && (
          <div className="oh-tool-body">
            <PeriodSnapshot
              data={laborData}
              plannerData={plannerData}
              acctLabel={acctLabel}
              acctLevel={acctLevel}
            />
          </div>
        )}

        {/* ══════════════════════════════════
            PORTFOLIO TAB (admin only)
        ══════════════════════════════════ */}
        {subView === "overview" && (
          <div className="oh-tool-body">
            <ExecutiveDashboard
              data={crossAccount}
              onSelectAccount={(key) => { setAccount(key); setSubView("timeline"); }}
            />
          </div>
        )}

      </div>
    </div>
  );
}