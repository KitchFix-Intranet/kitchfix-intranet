"use client";

export default function CelebrationBar({ celebrations, standard }) {
  const hasCelebrations = celebrations && celebrations.length > 0;
  const title = hasCelebrations ? "Today's Celebrations" : "Today's Motivation";
  const activeStandard = standard || "Consistency is the secret sauce.";

  return (
    <div className="kf-widget-card">
      <div className="kf-card-header">
        <div className="kf-header-row">
          <div className="kf-card-title">
            <svg className="kf-card-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              {hasCelebrations ? (
                <path d="M12 2v4m6.36.64l-2.83 2.83M20 12h-4M17.66 17.66l-2.83-2.83M12 20v-4M6.34 17.66l2.83-2.83M4 12h4M6.34 6.34l2.83 2.83" />
              ) : (
                <path d="M9 21h6M12 18v3M12 3a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-1.26C6.19 14.47 5 12.38 5 10a7 7 0 0 1 7-7z" />
              )}
            </svg>
            <span>{title}</span>
          </div>
          {hasCelebrations && celebrations.length > 2 && (
            <div className="kf-picket-controls">
              <button className="kf-picket-btn" onClick={() => scrollPicket("left")}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button className="kf-picket-btn" onClick={() => scrollPicket("right")}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {hasCelebrations ? (
        <div className="kf-celebration-picket" id="celebration-container">
          {celebrations.map((c, i) => {
            const typeClass = c.type?.toLowerCase() === "birthday" ? "birthday" : "anniversary";
            const iconBg = typeClass === "birthday" ? "rgba(124, 58, 237, 0.1)" : "rgba(16, 185, 129, 0.1)";
            const iconColor = typeClass === "birthday" ? "#7c3aed" : "#10b981";

            return (
              <div key={i} className={`kf-card-celebration-tile ${typeClass}`}>
                <div className="kf-cel-tile-icon" style={{ background: iconBg }}>
                  {typeClass === "birthday" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
                      <path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2-1 2-1" />
                      <path d="M2 21h20" />
                      <path d="M7 8v3" /><path d="M12 8v3" /><path d="M17 8v3" />
                      <circle cx="7" cy="6" r="1" fill={iconColor} stroke="none" />
                      <circle cx="12" cy="4" r="1" fill={iconColor} stroke="none" />
                      <circle cx="17" cy="6" r="1" fill={iconColor} stroke="none" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  )}
                </div>
                <div className="kf-cel-tile-content">
                  <div className="kf-cel-tile-name">{c.firstName}</div>
                  <div className="kf-cel-tile-label">{c.subLabel}</div>
                </div>
              </div>
            );
          })}
          {/* Museum rope "check back" tile */}
          <div className="kf-card-celebration-tile museum-rope" style={{ cursor: "default", opacity: 0.6, borderStyle: "dashed" }}>
            <div className="kf-cel-tile-icon" style={{ background: "#f1f5f9" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="kf-cel-tile-content">
              <div className="kf-cel-tile-name">Check Back...</div>
              <div className="kf-cel-tile-label">Tomorrow for more</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="kf-motivation-tile">
          <div className="kf-motivation-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
              <path d="M9 21h6M12 18v3M12 3a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-1.26C6.19 14.47 5 12.38 5 10a7 7 0 0 1 7-7z" />
            </svg>
          </div>
          <div>
            <div className="kf-motivation-label">The KitchFix Way</div>
            <div className="kf-motivation-quote">&ldquo;{activeStandard}&rdquo;</div>
          </div>
        </div>
      )}
    </div>
  );
}

function scrollPicket(direction) {
  const container = document.getElementById("celebration-container");
  if (!container) return;
  const amount = direction === "left" ? -200 : 200;
  container.scrollBy({ left: amount, behavior: "smooth" });
}