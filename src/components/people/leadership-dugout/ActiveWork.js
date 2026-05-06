"use client";

// ════════════════════════════════════════════════════════════════════════════
// ActiveWork — list of in-flight instruments for current user
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (WOW Plans live)  →  Sprint 5 (+ Cycle Reviews)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import WowPlanWorkspace from "@/components/people/leadership-dugout/WowPlanWorkspace";

export default function ActiveWork({ ldugBootstrap, showToast }) {
  const chain = ldugBootstrap?.chain;
  const leadersReviewed = ldugBootstrap?.leaders_reviewed || [];
  const leadersOverseen = ldugBootstrap?.leaders_overseen || [];
  const currentUserEmail = ldugBootstrap?.email || "";

  const [items, setItems] = useState(null);
  const [activePlanId, setActivePlanId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentUserEmail) return;
    fetch("/api/people/leadership-dugout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list-active-instruments", email: currentUserEmail }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setItems(data.items || []);
        else setError(data?.error || "Failed to load");
      })
      .catch((err) => setError(err.message));
  }, [currentUserEmail]);

  // Drill-down to a single plan
  if (activePlanId) {
    return (
      <WowPlanWorkspace
        planId={activePlanId}
        currentUserEmail={currentUserEmail}
        onBack={() => setActivePlanId(null)}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="pp-ldug-active">
      <div className="pp-ldug-section-header">
        <h2 className="pp-ldug-section-title">Active Work</h2>
        <p className="pp-ldug-section-desc">
          Everything open on you — WOW Plans, Cycle Reviews, calibrations.
        </p>
      </div>

      <div className="pp-ldug-context-strip">
        {chain && (
          <div className="pp-ldug-context-pill">
            <span className="pp-ldug-context-label">As Reviewed Party</span>
            <span className="pp-ldug-context-value">{chain.role} · {chain.account}</span>
          </div>
        )}
        {leadersReviewed.length > 0 && (
          <div className="pp-ldug-context-pill">
            <span className="pp-ldug-context-label">As Reviewer</span>
            <span className="pp-ldug-context-value">{leadersReviewed.length} {leadersReviewed.length === 1 ? "leader" : "leaders"}</span>
          </div>
        )}
        {leadersOverseen.length > 0 && (
          <div className="pp-ldug-context-pill">
            <span className="pp-ldug-context-label">As Oversight</span>
            <span className="pp-ldug-context-value">{leadersOverseen.length} {leadersOverseen.length === 1 ? "leader" : "leaders"}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="pp-ldug-empty-state">
          <h3 className="pp-ldug-empty-title">Couldn't load active work</h3>
          <p className="pp-ldug-empty-desc">{error}</p>
        </div>
      )}

      {!error && items === null && <div className="pp-ldug-loading">Loading…</div>}

      {!error && items && items.length === 0 && (
        <div className="pp-ldug-empty-state">
          <div className="pp-ldug-empty-icon" aria-hidden>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
              <path d="M9 16l2 2 4-4" />
            </svg>
          </div>
          <h3 className="pp-ldug-empty-title">Nothing active yet</h3>
          <p className="pp-ldug-empty-desc">
            WOW Plans appear when a leader enters a new role. Cycle Reviews
            open at the start of each cycle. Items appear here as they're triggered.
          </p>
        </div>
      )}

      {!error && items && items.length > 0 && (
        <div className="pp-ldug-active-list">
          {items.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              className="pp-ldug-active-row"
              onClick={() => item.type === "WowPlan" && setActivePlanId(item.id)}
            >
              <div className="pp-ldug-active-row-main">
                <div className="pp-ldug-active-row-type">{item.type === "WowPlan" ? "WOW Plan" : item.type}</div>
                <div className="pp-ldug-active-row-title">{item.leader_name}</div>
                <div className="pp-ldug-active-row-meta">
                  Day 1: {item.day1_date} · Day 90: {item.day90_date} · Status: {item.status}
                </div>
              </div>
              <span className="pp-ldug-active-row-arrow" aria-hidden>→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}