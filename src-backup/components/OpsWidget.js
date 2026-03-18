"use client";

export default function OpsWidget({ ops }) {
  const found = ops?.found || false;
  const label = ops?.label || "Off Season";
  const week = ops?.week || 0;
  const days = ops?.daysUntilInv ?? 99;
  const progress = ops?.progress || 0;

  // Badge text: "P2 • WK 4" or "OFF SEASON"
  const badge = found ? `${label} • WK ${week}` : "OFF SEASON";

  // Color class for countdown
  let valClass = "kf-time-val";
  if (days <= 3) valClass += " crit";
  else if (days <= 7) valClass += " warn";
  else valClass += " safe";

  return (
    <div className="kf-smart-card kf-card-time">
      <div className="kf-sc-header">
        <svg className="kf-sc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
        <span className="kf-sc-title">OPS HUB</span>
        {found && <div className="kf-live-dot" />}
      </div>
      <div className="kf-time-pill">{badge}</div>
      <div className="kf-time-hero">
        <div className="kf-time-label">Inventory In</div>
        <div className={valClass}>{days}</div>
        <div className="kf-time-label">{days === 1 ? "Day" : "Days"}</div>
      </div>
      <div className="kf-time-footer">
        <div className="kf-fuse-track">
          <div className="kf-fuse-fill" style={{ width: `${Math.round(progress)}%` }} />
        </div>
      </div>
    </div>
  );
}