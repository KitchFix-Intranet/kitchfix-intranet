"use client";

export default function TeamWidget({ mod }) {
  const name = mod?.name || "Team Directory";
  const role = mod?.role || "Manager of the Day";
  const image = mod?.image || "";

  return (
    <div className="kf-smart-card kf-card-directory">
      <div className="kf-sc-header">
        <svg className="kf-sc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span className="kf-sc-title">Team Directory</span>
      </div>
      <div className="kf-dir-body">
        <div className="kf-dir-avatar-box">
          <div
            className="kf-dir-img"
            style={image ? { backgroundImage: `url('${image}')` } : {}}
          />
          <div className="kf-dir-status" />
        </div>
        <div style={{ textAlign: "center" }}>
          <div className="kf-dir-name">{name}</div>
          <div className="kf-dir-role">
            {mod?.found ? role : "Manager of the Day"}
          </div>
        </div>
      </div>
      <div className="kf-dir-footer">
        <span className="kf-dir-cta">Click for Team Directory</span>
      </div>
    </div>
  );
}