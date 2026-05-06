"use client";

// ════════════════════════════════════════════════════════════════════════════
// AdminPanel — system viewer admin surface
//
// Module: People Portal · Leadership Dugout
// Sprint: 1 (read-only chain preview)  →  Sprint 6 (full admin controls)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// CSS prefix: pp-ldug-
//
// Visible only to system viewers (k.fietek, joe, ma.chavez).
// Sprint 6 will add: chain edit, cycle publication, MLB cycle override,
// audit log viewer, manual PDF render.
// ════════════════════════════════════════════════════════════════════════════

export default function AdminPanel({ ldugBootstrap }) {
  const chainPreview = ldugBootstrap?.full_chain_preview || [];

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

      <div className="pp-ldug-empty-state">
        <h3 className="pp-ldug-empty-title">Full admin controls land in Sprint 6</h3>
        <p className="pp-ldug-empty-desc">
          For now, edit Performance_Chain, Cycle_Calendar, and Performance_System_Config
          directly in the HUB sheet. Sprint 6 will add the in-app admin UI for chain edits,
          cycle publication, and MLB per-account auto-open overrides.
        </p>
      </div>
    </div>
  );
}