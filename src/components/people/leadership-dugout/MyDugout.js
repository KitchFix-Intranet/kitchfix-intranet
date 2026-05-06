"use client";

// ════════════════════════════════════════════════════════════════════════════
// MyDugout — hybrid landing surface (status hero + adaptive body)
//
// Module: People Portal · Leadership Dugout
// Sprint: 1 (placeholder)  →  Sprint 3 (full hybrid build)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// CSS prefix: pp-ldug-
//
// v1: shows the user's chain context + roadmap to what's coming.
// Sprint 3 will replace this with the hybrid status-card + adaptive body.
// ════════════════════════════════════════════════════════════════════════════

export default function MyDugout({ ldugBootstrap, onNavigate }) {
  const chain = ldugBootstrap?.chain;
  const firstName = chain?.leader_name?.split(" ")[0] || "there";

  return (
    <div className="pp-ldug-mydugout">
      {/* ── Welcome card ── */}
      <div className="pp-ldug-welcome">
        <h2 className="pp-ldug-welcome-title">Hey {firstName} — your dugout</h2>
        {chain ? (
          <p className="pp-ldug-welcome-sub">
            {chain.role} · {chain.account} · {chain.contract_type} cycle
          </p>
        ) : (
          <p className="pp-ldug-welcome-sub">
            Chain not configured — speak with Kevin or Joe to get added to the Performance Chain.
          </p>
        )}
      </div>

      {/* ── Sprint roadmap (will be replaced by hybrid hero in Sprint 3) ── */}
      <div className="pp-ldug-roadmap">
        <div className="pp-ldug-roadmap-header">
          <span className="pp-ldug-roadmap-tag">Coming soon</span>
          <p className="pp-ldug-roadmap-desc">
            This surface will become your action hero — what you owe, where you are in the
            operating year, your trajectory, and your top 3 priorities. For now, use the
            tabs above to access what's live.
          </p>
        </div>

        <div className="pp-ldug-roadmap-grid">
          <button className="pp-ldug-roadmap-card" onClick={() => onNavigate("library")}>
            <span className="pp-ldug-roadmap-card-tag pp-ldug-tag-live">Live</span>
            <h4>Library</h4>
            <p>The playbook — PB-001, SOP-001, scorecard templates.</p>
          </button>
          <button className="pp-ldug-roadmap-card" onClick={() => onNavigate("active-work")}>
            <span className="pp-ldug-roadmap-card-tag pp-ldug-tag-live">Live</span>
            <h4>Active Work</h4>
            <p>What's open on you — reviews, plans, scorecards.</p>
          </button>
          <div className="pp-ldug-roadmap-card pp-ldug-roadmap-card--locked">
            <span className="pp-ldug-roadmap-card-tag pp-ldug-tag-soon">Sprint 2</span>
            <h4>Scorecards</h4>
            <p>Monthly G/A/R period snapshots that feed Cycle Reviews.</p>
          </div>
          <div className="pp-ldug-roadmap-card pp-ldug-roadmap-card--locked">
            <span className="pp-ldug-roadmap-card-tag pp-ldug-tag-soon">Sprint 4</span>
            <h4>WOW Plans</h4>
            <p>90-day onboarding instrument with Day 30/60/90 checkpoints.</p>
          </div>
          <div className="pp-ldug-roadmap-card pp-ldug-roadmap-card--locked">
            <span className="pp-ldug-roadmap-card-tag pp-ldug-tag-soon">Sprint 5</span>
            <h4>Cycle Reviews</h4>
            <p>Six themes, three composites, calibration, sign-off.</p>
          </div>
        </div>
      </div>
    </div>
  );
}