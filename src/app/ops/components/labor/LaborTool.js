"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import SeasonPlanner from "@/app/ops/components/labor/SeasonPlanner";
import SeasonAdmin from "@/app/ops/components/labor/SeasonAdmin";

const ADMIN_EMAILS = [
  "k.fietek@kitchfix.com",
  "a.wasserman@kitchfix.com",
  "britt@kitchfix.com",
  "joe@kitchfix.com",
  "josh@kitchfix.com",
  "m.chavez@kitchfix.com",
  "s.lynch@kitchfix.com",
  "s.castro@kitchfix.com",
];

// ── Helpers for landing-card display ──
function nextLabelFor(nh) {
  if (!nh) return { text: "Season complete", tone: "neutral" };
  if (nh.status === "in_progress") return { text: "Active now", tone: "active" };
  if (nh.status === "actuals_due") return { text: "Actuals due", tone: "alert" };
  if (nh.status === "upcoming") return { text: `Next: ${nh.dates}`, tone: "upcoming" };
  return { text: `Next: ${nh.dates || nh.id || ""}`, tone: "upcoming" };
}

export default function LaborTool({ config, showToast, openConfirm, onNavigate }) {
  const { data: session } = useSession();
  const [account, setAccount]               = useState("");
  const [mlbAccounts, setMlbAccounts]       = useState([]);
  const [crossAccount, setCrossAccount]      = useState([]);
  const [loading, setLoading]               = useState(true);
  const [plannerData, setPlannerData]        = useState(null);
  const [plannerLoading, setPlannerLoading]  = useState(false);
  const [adminView, setAdminView]           = useState(false);

  // Track which account the current plannerData belongs to
  const plannerAccountRef = useRef("");
  // Abort controller for in-flight planner fetches
  const abortRef = useRef(null);

  const userEmail = session?.user?.email || "";
  const isAdmin = ADMIN_EMAILS.includes(userEmail);

  // Initial load — get MLB account list
  useEffect(() => {
    setLoading(true);
    fetch("/api/ops?action=labor-bootstrap")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setMlbAccounts(d.mlbAccounts || []);
          setCrossAccount(d.crossAccount || []);
        }
      })
      .catch(() => showToast?.("Failed to load accounts", "error"))
      .finally(() => setLoading(false));
  }, []);

  // Fetch planner data when account changes (only in chef view)
  useEffect(() => {
    // Abort any in-flight fetch
    if (abortRef.current) abortRef.current.abort();

    if (!account || adminView) return;

    // If we already have data for this account, skip the loading spinner
    const isStale = plannerAccountRef.current !== account;
    if (isStale) {
      setPlannerData(null);
    }
    setPlannerLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(
      `/api/ops?action=labor-bootstrap&account=${encodeURIComponent(account)}&view=planner`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.plannerData) {
          setPlannerData(d.plannerData);
          plannerAccountRef.current = account;
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          showToast?.("Failed to load planner", "error");
        }
      })
      .finally(() => setPlannerLoading(false));

    return () => controller.abort();
  }, [account, adminView]);

  const handleRefresh = useCallback(() => {
    if (!account) return;
    if (abortRef.current) abortRef.current.abort();

    setPlannerLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(
      `/api/ops?action=labor-bootstrap&account=${encodeURIComponent(account)}&view=planner`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.plannerData) {
          setPlannerData(d.plannerData);
          plannerAccountRef.current = account;
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          showToast?.("Failed to refresh", "error");
        }
      })
      .finally(() => setPlannerLoading(false));
  }, [account]);

  // Click-through from admin dashboard
  const handleSelectFromAdmin = useCallback((acctKey) => {
    // Clear stale data if switching to a different account
    if (plannerAccountRef.current !== acctKey) {
      setPlannerData(null);
      plannerAccountRef.current = "";
    }
    setAccount(acctKey);
    setAdminView(false);
  }, []);

  if (loading) {
    return <div className="oh-view" style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="oh-spinner" /></div>;
  }

  // Determine chef view body content
  const showPlanner = !adminView && account && plannerData && plannerAccountRef.current === account;
  const showPlannerLoading = !adminView && account && (plannerLoading || !plannerData || plannerAccountRef.current !== account);

  return (
    <div className="oh-view" style={{ animation: "oh-slideUp 0.4s ease" }}>
      <div className="oh-tool-shell">

        {/* Toolbar */}
        <div className="oh-tool-toolbar">
          <div className="oh-sp-toolbar-left">
            <span className="oh-tool-toolbar-title">Season Tracker</span>
            {isAdmin && (
              <div className="oh-sp-view-toggle">
                <button
                  className={`oh-sp-toggle-btn${!adminView ? " oh-sp-toggle-btn--active" : ""}`}
                  onClick={() => setAdminView(false)}
                >
                  Chef View
                </button>
                <button
                  className={`oh-sp-toggle-btn${adminView ? " oh-sp-toggle-btn--active" : ""}`}
                  onClick={() => setAdminView(true)}
                >
                  Admin
                </button>
              </div>
            )}
          </div>
          {!adminView && (
            <div className="oh-tool-acct">
              <select
                className="oh-select oh-select-compact"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="" disabled>Select account…</option>
                {mlbAccounts.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
              {account && (
                <button className="oh-btn-refresh" onClick={handleRefresh} title="Refresh">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="oh-tool-body">
          {adminView ? (
            <SeasonAdmin mlbAccounts={mlbAccounts} showToast={showToast} onSelectAccount={handleSelectFromAdmin} />
          ) : !account ? (() => {
            // Landing: grid of MLB accounts with live summary from crossAccount.
            // Falls back to a minimal empty state if crossAccount is unavailable.
            const mlbCards = (crossAccount || []).filter((a) => a.level === "MLB");
            if (mlbCards.length === 0) {
              return (
                <div className="oh-tool-empty">
                  <h3 className="oh-tool-empty-title">No MLB accounts</h3>
                  <p className="oh-tool-empty-desc">Nothing to track this season.</p>
                </div>
              );
            }
            return (
              <div className="oh-st-landing">
                <div className="oh-st-landing-head">
                  <h3 className="oh-st-landing-title">Pick an account to open its season</h3>
                  <p className="oh-st-landing-sub">Homestand budgets, labor spend, and actuals - organized by account.</p>
                </div>
                <div className="oh-st-landing-grid">
                  {mlbCards.map((a) => {
                    const variance = Number(a.cumulativeVariance || 0);
                    const isHealthy = a.completed > 0 && variance >= 0;
                    const isOver = a.completed > 0 && variance < 0;
                    const isAlert = (a.nextHomestand && a.nextHomestand.status === "actuals_due");
                    const accent = isAlert ? "alert" : isHealthy ? "healthy" : isOver ? "over" : "neutral";
                    const next = nextLabelFor(a.nextHomestand);
                    const footText = a.completed > 0
                      ? `${a.completed} of ${a.total} homestands`
                      : `${a.total} homestands planned`;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        className={`oh-st-acct-card oh-st-acct-card--${accent}`}
                        onClick={() => setAccount(a.key)}
                      >
                        <div className="oh-st-acct-card-head">
                          <span className="oh-st-acct-card-key">{a.key}</span>
                          <span className="oh-st-acct-card-name">{a.name || ""}</span>
                        </div>

                        <div className={`oh-st-acct-card-next oh-st-acct-card-next--${next.tone}`}>
                          {next.text}
                        </div>

                        <div className="oh-st-acct-card-foot">
                          {footText}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })() : showPlannerLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="oh-spinner" /></div>
          ) : showPlanner ? (
            <SeasonPlanner
              plannerData={plannerData}
              account={account}
              showToast={showToast}
              openConfirm={openConfirm}
              onRefresh={handleRefresh}
              isAdmin={isAdmin}
            />
          ) : (
            <div className="oh-tool-empty">
              <div className="oh-tool-empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h3 className="oh-tool-empty-title">Couldn't load data</h3>
              <p className="oh-tool-empty-desc">Try refreshing or selecting a different account.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}