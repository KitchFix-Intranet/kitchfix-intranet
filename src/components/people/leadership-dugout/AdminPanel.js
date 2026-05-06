"use client";

// ════════════════════════════════════════════════════════════════════════════
// AdminPanel — system viewer admin surface
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 7 — test mode + impersonation)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import WowPlanGenerate from "@/components/people/leadership-dugout/WowPlanGenerate";
import { ldugFetch } from "@/components/people/leadership-dugout/ldugFetch";

export default function AdminPanel({ ldugBootstrap, showToast, currentUserEmail, actualEmail }) {
  const chainPreview = ldugBootstrap?.full_chain_preview || [];
  const testMode = ldugBootstrap?.test_mode || false;
  const realEmail = actualEmail || currentUserEmail;
  const [showWowGenerate, setShowWowGenerate] = useState(false);
  const [togglingTest, setTogglingTest] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [impersonateValue, setImpersonateValue] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setImpersonateValue(localStorage.getItem("kf_ldug_impersonate") || "");
    }
  }, []);

  const handleToggleTest = async () => {
    setTogglingTest(true);
    try {
      const res = await ldugFetch("/api/people/leadership-dugout", {
        method: "POST",
        body: JSON.stringify({
          action: "admin-toggle-test-mode",
          email: realEmail,
          enabled: !testMode,
        }),
      }).then((r) => r.json());

      if (res?.ok) {
        showToast?.({
          msg: `Test mode ${res.test_mode ? "ENABLED" : "disabled"}. Reloading…`,
          type: "success",
        });
        setTimeout(() => window.location.reload(), 800);
      } else {
        showToast?.({ msg: res?.error || "Toggle failed", type: "error" });
      }
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setTogglingTest(false);
    }
  };

  const handleSetImpersonate = (val) => {
    if (typeof window === "undefined") return;
    if (val) {
      localStorage.setItem("kf_ldug_impersonate", val);
    } else {
      localStorage.removeItem("kf_ldug_impersonate");
    }
    setImpersonateValue(val);
    showToast?.({
      msg: val ? `Now acting as ${val}. Reloading…` : "Impersonation cleared. Reloading…",
      type: "info",
    });
    setTimeout(() => window.location.reload(), 800);
  };

  const handleWipeTestData = async () => {
    if (!confirm("Wipe ALL test data? This deletes every row in COLL__* tabs where last_action_by starts with [TEST]. Real data is untouched. Cannot be undone.")) return;
    setWiping(true);
    try {
      const res = await ldugFetch("/api/people/leadership-dugout", {
        method: "POST",
        body: JSON.stringify({ action: "admin-wipe-test-data", email: realEmail }),
      }).then((r) => r.json());
      if (res?.ok) {
        const counts = res.wiped || {};
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        showToast?.({
          msg: `Wiped ${total} test rows (${counts.wow_plans_header || 0} wow plans, ${counts.audit_log || 0} audit log).`,
          type: "success",
        });
      } else {
        showToast?.({ msg: res?.error || "Wipe failed", type: "error" });
      }
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="pp-ldug-admin">
      <div className="pp-ldug-section-header">
        <h2 className="pp-ldug-section-title">Admin</h2>
        <p className="pp-ldug-section-desc">
          Performance Chain, system configuration, test controls. System viewers only.
        </p>
      </div>

      {/* ── TEST MODE PANEL ── */}
      <div className={`pp-ldug-test-panel ${testMode ? "pp-ldug-test-panel--on" : ""}`}>
        <div className="pp-ldug-test-panel-header">
          <div>
            <span className="pp-ldug-test-pill">{testMode ? "● TEST MODE ON" : "○ TEST MODE OFF"}</span>
            <h3 className="pp-ldug-admin-action-title" style={{ marginTop: 6 }}>Test mode + impersonation</h3>
            <p className="pp-ldug-admin-action-desc">
              {testMode
                ? "Slack posts get [TEST] tag. Calendar invites only go to your test recipient. Audit log entries get [TEST] actor prefix. Impersonation enabled."
                : "Production-safe. Toggle ON to walk a full WOW Plan as multiple roles without alerting real people."}
            </p>
          </div>
          <button
            className="pp-card-cta pp-card-cta--primary"
            disabled={togglingTest}
            onClick={handleToggleTest}
          >
            {togglingTest ? "Toggling…" : (testMode ? "Disable test mode" : "Enable test mode")}
          </button>
        </div>

        {testMode && (
          <div className="pp-ldug-test-panel-body">
            <div className="pp-ldug-form-row">
              <label className="pp-ldug-form-label">Act as (impersonation)</label>
              <p className="pp-ldug-form-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Pick any chain email. The app treats you as that user for all role gating.
                Currently acting as: <strong>{impersonateValue || `${realEmail} (yourself)`}</strong>
              </p>
              <select
                className="pp-ldug-form-select"
                value={impersonateValue}
                onChange={(e) => handleSetImpersonate(e.target.value)}
              >
                <option value="">— act as myself ({realEmail}) —</option>
                {chainPreview.map((c) => (
                  <optgroup key={c.leader_email} label={`${c.leader_name} chain`}>
                    <option value={c.leader_email}>
                      As Reviewed Party: {c.leader_name} ({c.role} · {c.account})
                    </option>
                    <option value={c.reviewer_email}>
                      As Reviewer: {c.reviewer_name || c.reviewer_email}
                    </option>
                    <option value={c.oversight_email}>
                      As Oversight: {c.oversight_name || c.oversight_email}
                    </option>
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="pp-ldug-test-panel-actions">
              <button
                className="pp-ldug-cr-outcome-btn pp-ldug-cr-outcome-btn--sendback"
                disabled={wiping}
                onClick={handleWipeTestData}
              >
                {wiping ? "Wiping…" : "Wipe test data"}
              </button>
              <span className="pp-ldug-form-hint" style={{ marginLeft: 10 }}>
                Removes every row where last_action_by starts with [TEST]. Real data untouched.
              </span>
            </div>
          </div>
        )}
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
        <h3 className="pp-ldug-empty-title">More admin controls land in later iterations</h3>
        <p className="pp-ldug-empty-desc">
          Cycle Calendar publication, audit log viewer, and chain edit UI arrive once the
          Cycle Review backend ships. For now, edit Performance_Chain and
          Performance_System_Config directly in the HUB sheet.
        </p>
      </div>
    </div>
  );
}