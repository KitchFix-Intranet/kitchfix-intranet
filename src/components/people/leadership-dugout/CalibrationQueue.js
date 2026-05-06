"use client";

// ════════════════════════════════════════════════════════════════════════════
// CalibrationQueue — Oversight + system viewer queue surface
//
// Module: People Portal · Leadership Dugout
// Sprint: 1 (placeholder, gated)  →  Sprint 5 (full queue + split-pane)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// CSS prefix: pp-ldug-
//
// Visible only to: Oversight (anyone who has Oversight role on at least one
// leader) OR system viewers (k.fietek, joe, ma.chavez).
// Gating enforced in LeadershipDugoutTool segment filter.
// ════════════════════════════════════════════════════════════════════════════

export default function CalibrationQueue({ ldugBootstrap }) {
  const overseen = ldugBootstrap?.leaders_overseen || [];

  return (
    <div className="pp-ldug-calibration">
      <div className="pp-ldug-section-header">
        <h2 className="pp-ldug-section-title">Calibration Queue</h2>
        <p className="pp-ldug-section-desc">
          Manager drafts awaiting your calibration before delivery.
        </p>
      </div>

      <div className="pp-ldug-context-strip">
        <div className="pp-ldug-context-pill">
          <span className="pp-ldug-context-label">You oversee</span>
          <span className="pp-ldug-context-value">
            {overseen.length} {overseen.length === 1 ? "leader" : "leaders"}
          </span>
        </div>
      </div>

      <div className="pp-ldug-empty-state">
        <h3 className="pp-ldug-empty-title">Queue empty</h3>
        <p className="pp-ldug-empty-desc">
          Calibration items will appear here when manager drafts submit.
          The full split-pane calibration view ships in Sprint 5 alongside
          the Cycle Review instrument.
        </p>
      </div>
    </div>
  );
}