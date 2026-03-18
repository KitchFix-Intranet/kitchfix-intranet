"use client";
import { useState, useEffect, useCallback } from "react";
import SeasonPlanner from "@/app/ops/components/labor/SeasonPlanner";

/**
 * LaborTool v3.2 — Season Planner shell
 *
 * Simplified toolbar: just the account selector, no orphan tab.
 */
export default function LaborTool({ config, showToast, openConfirm, onNavigate }) {
  const [account, setAccount]             = useState("");
  const [mlbAccounts, setMlbAccounts]     = useState([]);
  const [loading, setLoading]             = useState(true);
  const [plannerData, setPlannerData]     = useState(null);
  const [plannerLoading, setPlannerLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/ops?action=labor-bootstrap")
      .then((r) => r.json())
      .then((d) => { if (d.success) setMlbAccounts(d.mlbAccounts || []); })
      .catch(() => showToast?.("Failed to load accounts", "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!account) { setPlannerData(null); return; }
    setPlannerLoading(true);
    fetch(`/api/ops?action=labor-bootstrap&account=${encodeURIComponent(account)}&view=planner`)
      .then((r) => r.json())
      .then((d) => { if (d.success && d.plannerData) setPlannerData(d.plannerData); })
      .catch(() => showToast?.("Failed to load planner", "error"))
      .finally(() => setPlannerLoading(false));
  }, [account]);

  const handleRefresh = useCallback(() => {
    if (!account) return;
    setPlannerLoading(true);
    setPlannerData(null);
    fetch(`/api/ops?action=labor-bootstrap&account=${encodeURIComponent(account)}&view=planner`)
      .then((r) => r.json())
      .then((d) => { if (d.success && d.plannerData) setPlannerData(d.plannerData); })
      .catch(() => showToast?.("Failed to refresh", "error"))
      .finally(() => setPlannerLoading(false));
  }, [account]);

  if (loading) {
    return (
      <div className="oh-view" style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <div className="oh-spinner" />
      </div>
    );
  }

  return (
    <div className="oh-view" style={{ animation: "oh-slideUp 0.4s ease" }}>
      <div className="oh-tool-shell">
        <div className="oh-tool-toolbar">
          <span className="oh-tool-toolbar-title">Season Tracker</span>
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
        </div>

        <div className="oh-tool-body">
          {!account ? (
            <div className="oh-tool-empty">
              <div className="oh-tool-empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h3 className="oh-tool-empty-title">Select an MLB account</h3>
              <p className="oh-tool-empty-desc">
                Choose your account to see homestand budgets and track labor spend.
              </p>
            </div>
          ) : plannerLoading || !plannerData ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
              <div className="oh-spinner" />
            </div>
          ) : (
            <SeasonPlanner
              plannerData={plannerData}
              account={account}
              showToast={showToast}
              openConfirm={openConfirm}
              onRefresh={handleRefresh}
            />
          )}
        </div>
      </div>
    </div>
  );
}