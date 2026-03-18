"use client";

export default function WasteWidget({ waste }) {
  const streak = waste?.streak || 0;
  const diff = waste?.diff ?? 99;

  const isLit = diff <= 1;
  const flameClass = `kf-flame-icon${isLit ? " lit" : ""}`;

  // Streak value display
  let streakDisplay = streak === 0 ? "Log Waste" : streak;
  let streakFontSize = streak === 0 ? "14px" : undefined;

  // Value color class
  let valClass = "kf-waste-val";
  if (streak === 0) valClass += " broken";
  else if (diff > 3) valClass += " risk";

  // Footer text
  let footerText = "Checking...";
  let footerColor = "#64748b";
  if (diff === 0) {
    footerText = "Last Entry: Today";
    footerColor = "#10b981";
  } else if (diff === 1) {
    footerText = "Last Entry: Yesterday";
  } else {
    footerText = `Last Entry: ${diff} Days Ago`;
  }

  return (
    <div className="kf-smart-card kf-card-waste">
      <div className="kf-sc-header">
        <svg className="kf-sc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12,2 C12,2 6,8 6,13 C6,16.3 8.7,19 12,19 C15.3,19 18,16.3 18,13 C18,9 15,5 12,2 Z" />
        </svg>
        <span className="kf-sc-title">WasteNot</span>
      </div>
      <div className="kf-waste-body">
        <div className="kf-waste-row">
          <svg className={flameClass} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2 C12,2 6,8 6,13 C6,16.3 8.7,19 12,19 C15.3,19 18,16.3 18,13 C18,9 15,5 12,2 Z" />
          </svg>
          <div className={valClass} style={streakFontSize ? { fontSize: streakFontSize } : {}}>
            {streakDisplay}
          </div>
        </div>
        <div className="kf-waste-label">Day Streak</div>
      </div>
      <div className="kf-waste-footer">
        <span style={{ color: footerColor }}>{footerText}</span>
      </div>
    </div>
  );
}