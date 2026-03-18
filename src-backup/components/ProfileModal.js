"use client";

export default function ProfileModal({ user, isOpen, onClose }) {
  if (!isOpen || !user) return null;

  return (
    <div className="kf-modal-overlay" onClick={onClose}>
      <div className="kf-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="kf-modal-close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Stadium header */}
        <div
          className="kf-profile-header"
          style={user.stadiumImg ? { backgroundImage: `url('${user.stadiumImg}')` } : {}}
        />

        <div className="kf-profile-main">
          <div className="kf-modal-avatar">{user.initials}</div>
          <h2 className="kf-modal-name">{user.name}</h2>
          <div className="kf-modal-role-badge">
            <div className="kf-modal-status-dot" />
            <span>{user.role}</span>
          </div>
        </div>

        <div className="kf-profile-stats">
          <div className="kf-stat-box">
            <span className="kf-stat-label">Impact Streak</span>
            <div className="kf-stat-val text-green-500">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12,2 C12,2 6,8 6,13 C6,16.3 8.7,19 12,19 C15.3,19 18,16.3 18,13 C18,9 15,5 12,2 Z" />
              </svg>
              <span>{user.streak || 0}</span>
            </div>
          </div>
          <div className="kf-stat-box" style={{ opacity: 0.5 }}>
            <span className="kf-stat-label">Badges Earned</span>
            <div className="kf-stat-val text-purple-500">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1 3-6z" />
              </svg>
              <span>--</span>
            </div>
          </div>
        </div>

        <div className="kf-profile-footer">
          <div className="kf-q4-notice">
            <span>🚀</span>
            <span>Achievements Coming Q4</span>
          </div>
        </div>
      </div>
    </div>
  );
}