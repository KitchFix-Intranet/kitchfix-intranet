"use client";
import { useState } from "react";
import IncidentCenter from "@/components/people/IncidentCenter";
import IncidentLibrary from "@/components/people/IncidentLibrary";

// ═══════════════════════════════════════════════════════════════
// INCIDENT TOOL - Sub-nav wrapper (Direction C: Segmented + Title)
// Mounted at view === "incidents". Holds 2 segments:
//   - Report: existing wizard (default)
//   - Library: SOPs, forms, postings (Reference Cards)
// History segment removed - Action Center already shows submitter's
// own incident submissions, no duplicate history needed.
// Pattern mirrors Ops Hub VendorPortal: single outer card, header
// inside, sub-nav inside, content directly inline.
// ═══════════════════════════════════════════════════════════════

const SEGMENTS = [
  { id: "report",  label: "Report" },
  { id: "library", label: "Library" },
];

export default function IncidentTool({ bootstrapData, onNavigate, showToast, refreshHistory }) {
  const [subView, setSubView] = useState("report");

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-master-card pp-inc-tool-card">

        {/* ── Header: title block left + segmented control right ── */}
        <div className="pp-inc-tool-header">
          <div className="pp-inc-tool-title">
            <div className="pp-inc-tool-title-icon" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="pp-inc-tool-title-text">
              <h3>Incident Center</h3>
              <p>Report or look up the rules</p>
            </div>
          </div>

          <div className="pp-inc-tool-segmented" role="tablist" aria-label="Incident tool views">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={subView === s.id}
                className={`pp-inc-tool-segment${subView === s.id ? " pp-inc-tool-segment--active" : ""}`}
                onClick={() => setSubView(s.id)}
              >
                {s.id === "report" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                )}
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content area ── */}
        <div className={`pp-inc-tool-body pp-inc-tool-body--${subView}`}>
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
        </div>
      </div>
    </div>
  );
}