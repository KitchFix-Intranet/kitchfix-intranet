"use client";
import { useState, useEffect } from "react";

const AVATAR_COLORS = ["bg-blue", "bg-green", "bg-purple", "bg-orange"];

export default function KudosSpotlight() {
  const [kudo, setKudo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reactions, setReactions] = useState({ hand: 0, rocket: 0, heart: 0 });

  useEffect(() => {
    fetch("/api/kudos/spotlight")
      .then((r) => r.json())
      .then((d) => {
        if (d.kudo) {
          setKudo(d.kudo);
          setReactions(d.kudo.reactions || { hand: 0, rocket: 0, heart: 0 });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleReaction = (type) => {
    setReactions((prev) => ({ ...prev, [type]: prev[type] + 1 }));
    fetch("/api/kudos/reaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: kudo?.id, type }),
    }).catch(() => {});
  };

  // Avatar initials + color
  const getInitials = (name) => {
    if (!name) return "KF";
    const parts = name.split(" ");
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
  };

  const getColor = (name) => AVATAR_COLORS[(name?.length || 0) % AVATAR_COLORS.length];

  return (
    <div className="kf-widget-card">
      <div className="kf-card-header">
        <div className="kf-card-title">
          <span style={{ fontSize: "16px" }}>❤️</span>
          <span>KitchKudos Spotlight</span>
        </div>
      </div>

      {loading ? (
        <div className="kf-spotlight-placeholder">Loading...</div>
      ) : !kudo ? (
        <div className="kf-spotlight-placeholder">Recognize a win today!</div>
      ) : (
        <div className="kf-feed-card" style={{ animation: "fadeUp 0.6s ease-out" }}>
          {/* Header: Avatar | Name+Role | Meta */}
          <div className="kf-feed-header">
            <div className={`kf-avatar-circle ${getColor(kudo.recipient)}`}>
              {getInitials(kudo.recipient)}
            </div>
            <div className="kf-header-content">
              <div className="kf-recipient-name">{kudo.recipient}</div>
              <div className="kf-feed-role">{kudo.role || "Team Member"}</div>
            </div>
            <div className="kf-header-meta">
              {kudo.isNew && <span className="kf-new-badge">NEW</span>}
              <div className="kf-time-badge">{kudo.timeAgo}</div>
            </div>
          </div>

          {/* Story Quote */}
          <div className="kf-story-quote">
            &ldquo;{kudo.story}&rdquo;
          </div>

          {/* Footer: Submitter + Reactions */}
          <div className="kf-card-footer-group">
            <div className="kf-submitter-label">From {kudo.submitter}</div>
            <div className="kf-reaction-bar">
              <button className="kf-rx-btn" onClick={() => handleReaction("hand")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                  <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                  <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                  <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                </svg>
                <span>{reactions.hand}</span>
              </button>
              <button className="kf-rx-btn" onClick={() => handleReaction("rocket")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                  <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                </svg>
                <span>{reactions.rocket}</span>
              </button>
              <button className="kf-rx-btn" onClick={() => handleReaction("heart")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                </svg>
                <span>{reactions.heart}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}