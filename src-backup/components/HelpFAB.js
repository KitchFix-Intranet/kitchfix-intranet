"use client";
import { useState } from "react";

export default function HelpFAB() {
  const [open, setOpen] = useState(false);

  return (
    <div className="kf-help-wrapper">
      <div className={`kf-help-menu ${open ? "active" : ""}`}>
        <div className="kf-help-menu-header">
          <span>OPS SUPPORT</span>
          <span style={{ fontSize: "10px", color: "#94a3b8" }}>v5.0</span>
        </div>
        <div className="kf-help-list">
          <a href="mailto:support@kitchfix.com" className="kf-help-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Email IT Support
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); alert("Slack: @OpsTeam"); }} className="kf-help-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" />
              <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
              <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" />
              <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" />
            </svg>
            Slack #Ops-Channel
          </a>
        </div>
      </div>
      <button className="kf-help-fab" onClick={() => setOpen(!open)}>
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Need Ops Help?
      </button>
    </div>
  );
}