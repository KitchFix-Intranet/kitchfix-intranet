"use client";

// ════════════════════════════════════════════════════════════════════════════
// ActiveWork — list of in-flight instruments for current user
//
// Module: People Portal · Leadership Dugout
// Sprint: 1 (empty-state only)  →  Sprint 3 (full list + filters)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// CSS prefix: pp-ldug-
//
// Shows everything the user is on the hook for: self-assessments due,
// manager drafts to write, calibrations to review, checkpoints scheduled.
// Sprint 1: empty state explaining what will appear here.
// ════════════════════════════════════════════════════════════════════════════

export default function ActiveWork({ ldugBootstrap }) {
  const chain = ldugBootstrap?.chain;
  const leadersReviewed = ldugBootstrap?.leaders_reviewed || [];
  const leadersOverseen = ldugBootstrap?.leaders_overseen || [];

  return (
    <div className="pp-ldug-active">
      <div className="pp-ldug-section-header">
        <h2 className="pp-ldug-section-title">Active Work</h2>
        <p className="pp-ldug-section-desc">
          Everything open on you — reviews, plans, scorecards, calibrations.
        </p>
      </div>

      {/* ── Role context strip ── */}
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

      {/* ── Empty state — Sprint 1 ── */}
      <div className="pp-ldug-empty-state">
        <div className="pp-ldug-empty-icon" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
            <path d="M9 16l2 2 4-4" />
          </svg>
        </div>
        <h3 className="pp-ldug-empty-title">Nothing active yet</h3>
        <p className="pp-ldug-empty-desc">
          Cycle Reviews open at the start of each cycle. WOW Plans are generated
          when a leader enters a new role. Scorecards are filed monthly.
          Items appear here as they're triggered.
        </p>
        <p className="pp-ldug-empty-meta">
          The first scorecards open in Sprint 2. The first WOW Plans in Sprint 4.
          The first Cycle Reviews in Sprint 5.
        </p>
      </div>
    </div>
  );
}