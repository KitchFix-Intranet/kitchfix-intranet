"use client";

// ════════════════════════════════════════════════════════════════════════════
// LeadershipDugoutTool — sub-nav wrapper for the Leadership Dugout
//
// Module: People Portal · Leadership Dugout
// Sprint: 1 + Chunk 7 (test mode banner + impersonation header)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import MyDugout from "@/components/people/leadership-dugout/MyDugout";
import ActiveWork from "@/components/people/leadership-dugout/ActiveWork";
import Library from "@/components/people/leadership-dugout/Library";
import CalibrationQueue from "@/components/people/leadership-dugout/CalibrationQueue";
import AdminPanel from "@/components/people/leadership-dugout/AdminPanel";
import { ldugFetch } from "@/components/people/leadership-dugout/ldugFetch";

const ALL_SEGMENTS = [
  { id: "my-dugout", label: "My Dugout", gate: null },
  { id: "active-work", label: "Active Work", gate: null },
  { id: "library", label: "Library", gate: null },
  { id: "calibration", label: "Calibration", gate: "oversight" },
  { id: "admin", label: "Admin", gate: "system-viewer" },
];

export default function LeadershipDugoutTool({ bootstrapData, onNavigate, showToast }) {
  const [subView, setSubView] = useState("my-dugout");
  const [ldugBootstrap, setLdugBootstrap] = useState(null);
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false);

  useEffect(() => {
    const email =
      bootstrapData?.email ||
      (typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "");

    if (!email) {
      console.log("[ldug] no user email available, skipping bootstrap");
      setBootstrapLoaded(true);
      return;
    }
    console.log("[ldug] bootstrapping for email:", email);

    ldugFetch("/api/people/leadership-dugout", {
      method: "POST",
      body: JSON.stringify({ action: "bootstrap", email }),
    })
      .then((r) => r.json())
      .then((data) => {
        console.log("[ldug] bootstrap response:", data);
        if (data?.ok) setLdugBootstrap(data);
      })
      .catch((err) => console.error("[ldug] bootstrap failed:", err))
      .finally(() => setBootstrapLoaded(true));
  }, []);

  if (!bootstrapLoaded) {
    return (
      <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
        <div className="pp-master-card pp-ldug-tool-card" data-density="compact">
          <div className="pp-ldug-tool-header">
            <div className="pp-ldug-tool-title">
              <div className="pp-ldug-tool-title-icon" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
              </div>
              <div className="pp-ldug-tool-title-text">
                <h3>Leadership Dugout</h3>
                <p>Performance reviews, WOW plans, and the playbook</p>
              </div>
            </div>
          </div>
          <div className="pp-ldug-tool-body">
            <div className="pp-ldug-loading">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  const isSystemViewer = ldugBootstrap?.is_system_viewer || false;
  const isOversight = (ldugBootstrap?.leaders_overseen?.length || 0) > 0;

  // ─── Coming-soon landing for users without access ────────────────────────
  if (!isSystemViewer) {
    const firstName = bootstrapData?.firstName || "there";
    return (
      <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
        <div className="pp-master-card pp-ldug-tool-card" data-density="compact">
          <div className="pp-ldug-tool-header">
            <div className="pp-ldug-tool-title">
              <div className="pp-ldug-tool-title-icon" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
              </div>
              <div className="pp-ldug-tool-title-text">
                <h3>Leadership Dugout</h3>
                <p>Performance reviews, WOW plans, and the playbook</p>
              </div>
            </div>
          </div>

          <div className="pp-ldug-tool-body">
            <div className="pp-ldug-welcome">
              <h2 className="pp-ldug-welcome-title">Hey {firstName} — your dugout</h2>
              <p className="pp-ldug-welcome-sub">Coming soon to your role</p>
            </div>

            <div className="pp-ldug-comingsoon">
              <div className="pp-ldug-comingsoon-tag">In phased rollout</div>
              <h3 className="pp-ldug-comingsoon-title">
                The Leadership Dugout is launching in phases
              </h3>
              <p className="pp-ldug-comingsoon-desc">
                Performance reviews, WOW Plans, scorecards, and the leadership
                playbook are launching for the leadership team in phases starting
                Q3 2026. You'll see this come alive once it's released to your role.
              </p>

              <div className="pp-ldug-comingsoon-grid">
                <div className="pp-ldug-comingsoon-card">
                  <h4>The Library</h4>
                  <p>PB-001 Leadership OS, SOP-001 Performance System, scorecard templates.</p>
                </div>
                <div className="pp-ldug-comingsoon-card">
                  <h4>Scorecards</h4>
                  <p>Monthly G/A/R period snapshots that feed into Cycle Reviews.</p>
                </div>
                <div className="pp-ldug-comingsoon-card">
                  <h4>WOW Plans</h4>
                  <p>90-day onboarding instrument with Day 30/60/90 checkpoints.</p>
                </div>
                <div className="pp-ldug-comingsoon-card">
                  <h4>Cycle Reviews</h4>
                  <p>Six themes, three composites, calibration, and conversation.</p>
                </div>
              </div>

              <p className="pp-ldug-comingsoon-meta">
                Questions? Ping Kevin, Joe, or Mariela.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Full tool for system viewers ────────────────────────────────────────
  const segments = ALL_SEGMENTS.filter((s) => {
    if (!s.gate) return true;
    if (s.gate === "system-viewer") return isSystemViewer;
    if (s.gate === "oversight") return isOversight || isSystemViewer;
    return false;
  });

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      {ldugBootstrap?.test_mode && (
        <div className="pp-ldug-test-banner">
          <span className="pp-ldug-test-banner-dot">●</span>
          <strong>TEST MODE</strong>
          {ldugBootstrap?.is_impersonating && (
            <span className="pp-ldug-test-banner-meta">
              {" — "}acting as <strong>{ldugBootstrap.email}</strong> (real: {ldugBootstrap.actual_email})
            </span>
          )}
          <span className="pp-ldug-test-banner-meta" style={{ marginLeft: "auto" }}>
            Slack [TEST]-tagged · Calendar → test recipient · Audit log [TEST]-prefixed
          </span>
        </div>
      )}
      <div className="pp-master-card pp-ldug-tool-card" data-density="compact">
        <div className="pp-ldug-tool-header">
          <div className="pp-ldug-tool-title">
            <div className="pp-ldug-tool-title-icon" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            </div>
            <div className="pp-ldug-tool-title-text">
              <h3>Leadership Dugout</h3>
              <p>Performance reviews, WOW plans, and the playbook</p>
            </div>
          </div>

          <div className="pp-ldug-tool-segmented" role="tablist" aria-label="Leadership Dugout views">
            {segments.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={subView === s.id}
                className={`pp-ldug-tool-segment${subView === s.id ? " pp-ldug-tool-segment--active" : ""}`}
                onClick={() => setSubView(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`pp-ldug-tool-body pp-ldug-tool-body--${subView}`}>
          {subView === "my-dugout" && (
            <MyDugout
              bootstrapData={bootstrapData}
              ldugBootstrap={ldugBootstrap}
              onNavigate={(v) => setSubView(v)}
              showToast={showToast}
            />
          )}
          {subView === "active-work" && (
            <ActiveWork
              ldugBootstrap={ldugBootstrap}
              onNavigate={(v) => setSubView(v)}
              showToast={showToast}
            />
          )}
          {subView === "library" && (
            <Library
              ldugBootstrap={ldugBootstrap}
              showToast={showToast}
            />
          )}
          {subView === "calibration" && (isOversight || isSystemViewer) && (
            <CalibrationQueue
              ldugBootstrap={ldugBootstrap}
              showToast={showToast}
            />
          )}
          {subView === "admin" && isSystemViewer && (
            <AdminPanel
              ldugBootstrap={ldugBootstrap}
              currentUserEmail={ldugBootstrap?.email || bootstrapData?.email || ""}
              actualEmail={ldugBootstrap?.actual_email || ldugBootstrap?.email || bootstrapData?.email || ""}
              showToast={showToast}
            />
          )}
        </div>
      </div>
    </div>
  );
}