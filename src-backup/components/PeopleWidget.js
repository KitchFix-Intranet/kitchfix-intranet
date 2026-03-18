"use client";

export default function PeopleWidget({ metrics }) {
  const pending = metrics?.pending || 0;
  const rejected = metrics?.rejected || 0;
  const done = metrics?.completedTotal || 0;

  const hasAlert = rejected > 0;
  const pillClass = hasAlert ? "kf-hub-pill alert kf-pulse-8s" : "kf-hub-pill safe";
  const pillText = hasAlert ? `Review Request: ${rejected}` : "All Caught Up!";

  return (
    <div className="kf-smart-card kf-card-hub" onClick={() => window.location.href = '/people'} style={{ cursor: 'pointer' }}>
      <div className="kf-sc-header">
        <svg className="kf-sc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span className="kf-sc-title">People</span>
      </div>
      <div className="kf-hub-top">
        <div className={pillClass}>
          {hasAlert && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
          <span>{pillText}</span>
        </div>
      </div>
      <div className="kf-hub-bottom">
        <div className="kf-hub-stat">
          <span className="kf-hub-val-lg text-blue">{pending}</span>
          <span className="kf-hub-lbl-sm">Pending</span>
        </div>
        <div className="kf-hub-stat">
          <span className="kf-hub-val-lg text-green">{done}</span>
          <span className="kf-hub-lbl-sm">Done</span>
        </div>
      </div>
    </div>
  );
}