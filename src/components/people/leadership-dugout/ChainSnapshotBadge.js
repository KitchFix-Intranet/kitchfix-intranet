"use client";

// ════════════════════════════════════════════════════════════════════════════
// ChainSnapshotBadge — shows the chain captured on this instance
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
// CSS prefix: pp-ldug-
//
// Chain is captured at instrument creation and immutable for the life of the
// instance even if the underlying Performance_Chain changes mid-cycle.
// ════════════════════════════════════════════════════════════════════════════

export default function ChainSnapshotBadge({
  leaderName,
  reviewerName,
  oversightName,
  compact = false,
}) {
  if (compact) {
    return (
      <div className="pp-ldug-chain-badge pp-ldug-chain-badge--compact">
        <span><strong>{leaderName}</strong></span>
        <span aria-hidden>→</span>
        <span>{reviewerName}</span>
        <span aria-hidden>→</span>
        <span>{oversightName}</span>
      </div>
    );
  }
  return (
    <div className="pp-ldug-chain-badge">
      <div className="pp-ldug-chain-row">
        <span className="pp-ldug-chain-label">Reviewed Party</span>
        <span className="pp-ldug-chain-name">{leaderName}</span>
      </div>
      <div className="pp-ldug-chain-row">
        <span className="pp-ldug-chain-label">Reviewer</span>
        <span className="pp-ldug-chain-name">{reviewerName}</span>
      </div>
      <div className="pp-ldug-chain-row">
        <span className="pp-ldug-chain-label">Oversight</span>
        <span className="pp-ldug-chain-name">{oversightName}</span>
      </div>
    </div>
  );
}