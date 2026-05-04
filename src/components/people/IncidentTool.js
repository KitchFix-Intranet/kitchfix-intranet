"use client";
import { useState } from "react";
import IncidentCenter from "@/components/people/IncidentCenter";
import IncidentLibrary from "@/components/people/IncidentLibrary";
import IncidentHistory from "@/components/people/IncidentHistory";

// ═══════════════════════════════════════════════════════════════
// INCIDENT TOOL - Sub-nav wrapper
// Mounted at view === "incidents". Holds three tabs:
//   - Report Incident: existing wizard (default)
//   - Library: SOPs, forms, postings (Direction B - Reference Cards)
//   - History: read-only list of user's own past submissions
// ═══════════════════════════════════════════════════════════════

const SUBTABS = [
  { id: "report", label: "Report Incident" },
  { id: "library", label: "Library" },
  { id: "history", label: "History" },
];

export default function IncidentTool({ bootstrapData, onNavigate, showToast, refreshHistory }) {
  const [subView, setSubView] = useState("report");

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      {/* Sub-nav */}
      <div className="pp-inc-subnav">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`pp-inc-subnav-item${subView === t.id ? " pp-inc-subnav-item--active" : ""}`}
            onClick={() => setSubView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {subView === "report" && (
        <IncidentCenter
          bootstrapData={bootstrapData}
          onNavigate={onNavigate}
          showToast={showToast}
          refreshHistory={refreshHistory}
        />
      )}

      {subView === "library" && (
        <IncidentLibrary
          bootstrapData={bootstrapData}
          showToast={showToast}
        />
      )}

      {subView === "history" && (
        <IncidentHistory
          bootstrapData={bootstrapData}
          showToast={showToast}
        />
      )}
    </div>
  );
}