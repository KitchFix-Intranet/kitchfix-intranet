"use client";

// ════════════════════════════════════════════════════════════════════════════
// AdminPanel — system viewer admin surface
//
// Module: People Portal · Leadership Dugout
// Sprint: 1 (preview)  →  Sprint 2 (WOW generation)  →  Sprint 6 (full admin)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import WowPlanGenerate from "@/components/people/leadership-dugout/WowPlanGenerate";

export default function AdminPanel({ ldugBootstrap, showToast, currentUserEmail }) {
  const chainPreview = ldugBootstrap?.full_chain_preview || [];
  const [showWowGenerate, setShowWowGenerate] = useState(false);

  return (
    <div className="pp-ldug-admin">
      <div className="pp-ldug-section-header">
        <h2 className="pp-ldug-section-title">Admin</h2>
        <p className="pp-ldug-section-desc">
          Performance Chain, Cycle Calendar, system configuration. System viewers only.
        </p>
      </div>

      <div className="pp-ldug-admin-stats">
        <div className="pp-ldug-admin-stat">
          <span className="pp-ldug-admin-stat-label">Active leaders in chain</span>
          <span className="pp-ldug-admin-stat-value">{chainPreview.length}</span>
        </div>
      </div>

      {/* WOW Plan generation */}
      {!showWowGenerate ? (
        <div className="pp-ldug-admin-action-card">
          <div>
            <h3 className="pp-ldug-admin-action-title">Generate a WOW Plan</h3>
            <p className="pp-ldug-admin-action-desc">
              Create a 90-day plan for a new hire, promotion, or lateral move.
            </p>
          </div>
          <button
            className="pp-card-cta pp-card-cta--primary"
            onClick={() => setShowWowGenerate(true)}
          >
            Generate
          </button>
        </div>
      ) : (
        <div className="pp-ldug-admin-action-expanded">
          <button className="pp-ldug-link" onClick={() => setShowWowGenerate(false)}>
            ← Cancel
          </button>
          <WowPlanGenerate
            chainPreview={chainPreview}
            currentUserEmail={currentUserEmail}
            onCreated={(planId) => {
              showToast?.({ msg: `WOW Plan ${planId.slice(0, 8)} created.`, type: "success" });
              setShowWowGenerate(false);
            }}
            showToast={showToast}
          />
        </div>
      )}

      <div className="pp-ldug-empty-state">
        <h3 className="pp-ldug-empty-title">More admin controls land in later sprints</h3>
        <p className="pp-ldug-empty-desc">
          Cycle Calendar publication, MLB per-account auto-open overrides, audit log viewer,
          and chain edit UI all arrive in Sprint 6. For now, edit Performance_Chain,
          Cycle_Calendar, and Performance_System_Config directly in the HUB sheet.
        </p>
      </div>
    </div>
  );
}