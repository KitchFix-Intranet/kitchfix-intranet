"use client";
import { useState, useEffect } from "react";

const TOOLS_CONFIG = [
  { id: "gh", name: "Greenhouse", color: "#00B388", url: "https://app4.greenhouse.io/dashboard", icon: "plant" },
  { id: "rip", name: "Rippling", color: "#FFB81C", url: "https://app.rippling.com/dashboard", icon: "waves" },
  { id: "avy", name: "Avery Labels", color: "#E60012", url: "https://www.avery.com/templates", icon: "tag" },
  { id: "gmail", name: "Gmail", color: "#EA4335", url: "https://mail.google.com/mail/u/0/#inbox", icon: "mail" },
  { id: "drive", name: "Google Drive", color: "#34A853", url: "https://drive.google.com/drive/u/0/my-drive", icon: "folder" },
  { id: "cal", name: "Calendar", color: "#4285F4", url: "https://calendar.google.com/calendar/", icon: "calendar" },
  { id: "slack", name: "Slack", color: "#4A154B", url: "https://slack.com/workspace-signin", icon: "hash" },
  { id: "kf", name: "KitchFix.com", color: "#0F3057", url: "https://kitchfix.com/", icon: "chef" },
  { id: "gal", name: "Galley", color: "#FF6B00", url: "https://production-galley.us.auth0.com/u/login", icon: "book" },
];

const ICON_MAP = {
  plant: <><path d="M7 20h10" /><path d="M10 20c5.5-2.5 8-7 8-14" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /></>,
  waves: <><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /></>,
  tag: <><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" /><path d="M7 7h.01" /></>,
  mail: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  folder: <><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></>,
  calendar: <><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  hash: <><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></>,
  chef: <><rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><path d="M17 2H7a5 5 0 0 0 0 10h10a5 5 0 0 0 0-10z" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
};

export default function ToolsGrid() {
  const [pinned, setPinned] = useState([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("kf_pinned_tools");
      if (saved) setPinned(JSON.parse(saved));
    } catch (e) {}
  }, []);

  const togglePin = (e, toolId) => {
    e.preventDefault();
    e.stopPropagation();
    setPinned((prev) => {
      const next = prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId];
      try { localStorage.setItem("kf_pinned_tools", JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };

  // Sort: pinned tools first, then original order
  const sorted = [...TOOLS_CONFIG].sort((a, b) => {
    const aPin = pinned.includes(a.id) ? 0 : 1;
    const bPin = pinned.includes(b.id) ? 0 : 1;
    return aPin - bPin;
  });

  return (
    <div className="kf-widget-card">
      <div className="kf-card-header">
        <div className="kf-card-title">
          <svg className="kf-card-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          <span>External Tools</span>
        </div>
      </div>
      <div className="kf-tools-grid">
        {sorted.map((tool) => {
          const isPinned = pinned.includes(tool.id);
          return (
            <div key={tool.id} className="kf-tool-wrapper">
              <a
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`kf-tool-btn${isPinned ? " pinned" : ""}`}
                style={{ "--tool-color": tool.color }}
              >
                <div className="kf-tool-icon-box">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {ICON_MAP[tool.icon]}
                  </svg>
                </div>
                <span className="kf-tool-label">{tool.name}</span>
                <svg className="kf-tool-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="7 7 17 7 17 17" />
                  <line x1="7" y1="17" x2="17" y2="7" />
                </svg>
              </a>
              <button
                className={`kf-tool-star${isPinned ? " pinned" : ""}`}
                onClick={(e) => togglePin(e, tool.id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}