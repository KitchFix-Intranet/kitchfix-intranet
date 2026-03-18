"use client";

const FACE_COLORS = ["face-1", "face-2", "face-3"];

export default function KudosWidget({ kudos }) {
  const total = kudos?.companyTotal || 0;
  const personal = kudos?.personalSent || 0;
  const recent = kudos?.recent || [];

  return (
    <div className="kf-smart-card kf-card-trophy">
      <div className="kf-sc-header">
        <svg className="kf-sc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 15C14.4853 15 16.5 12.9853 16.5 10.5C16.5 8.01472 14.4853 6 12 6C9.51472 6 7.5 8.01472 7.5 10.5C7.5 12.9853 9.51472 15 12 15Z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7.5 10.5L3 5.25H21L16.5 10.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="kf-sc-title">Kudos</span>
      </div>
      <div className="kf-trophy-body">
        <div className="kf-trophy-label">Weekly Wins</div>
        <div className="kf-trophy-combined-row">
          <div className="kf-trophy-val">{total}</div>
          {recent.length > 0 && (
            <div className="kf-face-pile">
              {recent.map((initials, i) => (
                <div key={i} className={`kf-face-chip ${FACE_COLORS[i] || "face-1"}`}>
                  {initials}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="kf-trophy-footer">
        <span style={{ color: "#64748b" }}>Your Recognitions:</span>
        <span className="kf-my-score">{personal}</span>
      </div>
    </div>
  );
}