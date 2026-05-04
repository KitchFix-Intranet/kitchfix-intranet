"use client";
import { useState, useEffect, useMemo } from "react";
import IncidentDetailPane, { INCIDENT_ICONS } from "@/components/people/IncidentDetailPane";
import { INCIDENT_TYPES, SEVERITY_TIERS, STATUS_LABELS } from "@/lib/incidentSchema";

// ═══════════════════════════════════════════════════════════════
// INCIDENT HISTORY - Submitter's own past incidents (read-only)
// Calls /api/people?action=incident-list and filters to the
// current user's submissions only. Renders the same split-panel
// layout as the admin queue, but with IncidentDetailPane in
// readOnly mode (no investigation editing, no internal notes,
// no status actions — just submission summary + status + Drive folder).
// ═══════════════════════════════════════════════════════════════

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];

export default function IncidentHistory({ bootstrapData, showToast }) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  const userEmail = String(bootstrapData?.userEmail || "").toLowerCase();

  // ─── Load + filter to user's own submissions ───
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/people?action=incident-list");
      const data = await res.json();
      if (data.success) {
        const mine = (data.incidents || []).filter(
          (i) => String(i.submitted_by_email || "").toLowerCase() === userEmail
        );
        setIncidents(mine);
      } else {
        setError(data.error || "Failed to load");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userEmail) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // ─── Filter ───
  const filtered = useMemo(() => {
    let list = incidents;
    if (statusFilter === "open") list = list.filter((i) => i.status !== "closed");
    if (statusFilter === "closed") list = list.filter((i) => i.status === "closed");
    // Newest first
    return [...list].sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
  }, [incidents, statusFilter]);

  const counts = useMemo(() => ({
    all: incidents.length,
    open: incidents.filter((i) => i.status !== "closed").length,
    closed: incidents.filter((i) => i.status === "closed").length,
  }), [incidents]);

  const selected = filtered.find((i) => i.incident_id === selectedId) || null;

  // Auto-select first item
  useEffect(() => {
    if (filtered.length > 0 && (!selected || !filtered.find((i) => i.incident_id === selectedId))) {
      setSelectedId(filtered[0].incident_id);
    } else if (filtered.length === 0) {
      setSelectedId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  return (
    <div className="pp-master-card" style={{ marginTop: 0 }}>
      {/* Header */}
      <div className="pp-master-header" style={{ display: "block" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <h3 className="pp-card-title" style={{ margin: 0 }}>My Incident History</h3>
            <p className="pp-card-desc" style={{ margin: "2px 0 0", fontSize: 12 }}>
              Read-only. Incidents stay on file once submitted.
            </p>
          </div>
          <button
            className="pp-btn pp-btn--ghost"
            onClick={refresh}
            disabled={loading}
            style={{ padding: "6px 12px", fontSize: 12 }}
          >
            {loading ? "Loading..." : "Refresh ↻"}
          </button>
        </div>

        <div className="pp-toggle-container" style={{ marginTop: 14 }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`pp-pill${statusFilter === f.id ? " pp-pill-primary active" : ""}`}
              onClick={() => { setStatusFilter(f.id); setSelectedId(null); }}
            >
              <span className="pp-pill-label">{f.label}</span>
              <span className="pp-pill-count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Split panel */}
      <div className={`pp-adm-split${mobileDetail ? " pp-adm-split--detail-open" : ""}`}>
        {/* Left: list */}
        <div className="pp-adm-list-col">
          {loading && (
            <div className="pp-adm-list-empty">
              <p style={{ color: "#94a3b8" }}>Loading...</p>
            </div>
          )}

          {!loading && error && (
            <div className="pp-adm-list-empty">
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
              <p style={{ color: "#94a3b8" }}>Couldn't load history</p>
              <p style={{ color: "#94a3b8", fontSize: 11 }}>{error}</p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="pp-adm-list-empty">
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <p style={{ color: "#94a3b8", fontWeight: 500 }}>
                {incidents.length === 0
                  ? "You haven't submitted any incidents yet."
                  : "No incidents match this filter."}
              </p>
            </div>
          )}

          {!loading && !error && filtered.map((item) => {
            const t = INCIDENT_TYPES.find((x) => x.id === item.incident_type);
            const sevColor = SEVERITY_TIERS.find((s) => s.id === item.severity)?.color || "#94a3b8";
            const isActive = selectedId === item.incident_id;
            const submittedDate = item.submitted_at
              ? new Date(item.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "";

            return (
              <div
                key={item.incident_id}
                className={`pp-adm-list-item${isActive ? " active" : ""}`}
                style={{ borderLeft: `3px solid ${sevColor}` }}
                onClick={() => { setSelectedId(item.incident_id); setMobileDetail(true); }}
              >
                <div
                  className="pp-adm-list-avatar"
                  style={{ background: t?.color || "#6b7280" }}
                >
                  {INCIDENT_ICONS[item.incident_type] || (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <path d="M12 9v4" /><path d="M12 17h.01" />
                    </svg>
                  )}
                </div>
                <div className="pp-adm-list-info">
                  <div className="pp-adm-list-name">{t?.label || item.incident_type}</div>
                  <div className="pp-adm-list-sub">
                    <span style={{ color: sevColor, fontWeight: 700, marginRight: 6 }}>{item.severity}</span>
                    {item.site_code} · {STATUS_LABELS[item.status] || item.status}
                  </div>
                </div>
                <div className="pp-adm-list-right">
                  <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {submittedDate}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                    {item.incident_id}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: detail (read-only) */}
        <div className="pp-adm-detail-col">
          <button className="pp-adm-mobile-back" onClick={() => setMobileDetail(false)}>
            ← Back to list
          </button>
          {!selected && (
            <div className="pp-adm-detail-empty">
              <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.4 }}>←</div>
              <p>Select an incident to view details</p>
            </div>
          )}
          {selected && (
            <IncidentDetailPane
              key={selected.incident_id}
              incident={selected}
              bootstrapData={bootstrapData}
              showToast={showToast}
              onRefresh={refresh}
              readOnly={true}
            />
          )}
        </div>
      </div>
    </div>
  );
}