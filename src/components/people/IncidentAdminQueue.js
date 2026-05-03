"use client";
import { useState, useEffect, useCallback } from "react";
import {
  INCIDENT_TYPES,
  SEVERITY_TIERS,
  STATUS_FLOW,
  STATUS_LABELS,
} from "@/lib/incidentSchema";

// ═══════════════════════════════════════════════════════════════
// INCIDENT ADMIN QUEUE - Mariela's split-panel
// Lives at view === "incident-admin" inside /people/page.js
// Mirrors the AdminQueue.js split-panel pattern (pp-adm-*)
// ═══════════════════════════════════════════════════════════════

// Type icons (matches IncidentCenter.js exactly - kept inline for self-containment)
const ICONS = {
  employee_injury: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 12H3" /><path d="M16 6H3" /><path d="M16 18H3" /><path d="M18 9v6" /><path d="M21 12h-6" /></svg>,
  vehicle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" /></svg>,
  allergen_reaction: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="5" /><circle cx="15" cy="15" r="5" /></svg>,
  foodborne_illness: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2v8.5a2.5 2.5 0 0 1-5 0V2" /><path d="M7 2v20" /><path d="M21 16V2H17a4 4 0 0 0 0 8h4" /><path d="M17 12v10" /></svg>,
  food_safety: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" /></svg>,
  property_damage: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>,
  non_employee_injury: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  near_miss: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>,
  security_altercation: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>,
};

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function IncidentAdminQueue({ bootstrapData, showToast }) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active"); // active | s1 | submitted | investigating | closed | all
  const [siteFilter, setSiteFilter] = useState("all");
  const [advancing, setAdvancing] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [showNote, setShowNote] = useState(false);

  const adminEmail = bootstrapData?.userEmail || "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/people?action=incident-list`);
      const data = await res.json();
      if (data.success) {
        setIncidents(data.incidents || []);
        // Keep selection if still in list, else clear
        if (selectedId && !data.incidents.find((i) => i.incident_id === selectedId)) {
          setSelectedId(null);
        }
      }
    } catch (err) {
      console.error("[IncidentAdminQueue] refresh failed:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Background poll every 60s
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!document.hidden) refresh();
    }, 60000);
    return () => clearInterval(intervalId);
  }, [refresh]);

  // ─── Filtering ───
  const filtered = incidents.filter((i) => {
    if (statusFilter === "active" && i.status === "closed") return false;
    if (statusFilter === "s1" && i.severity !== "S1") return false;
    if (statusFilter === "submitted" && i.status !== "submitted") return false;
    if (statusFilter === "investigating" && i.status !== "investigating") return false;
    if (statusFilter === "closed" && i.status !== "closed") return false;
    if (siteFilter !== "all" && i.site_code !== siteFilter) return false;
    return true;
  });

  // Sort: S1 first, then by submitted_at desc
  filtered.sort((a, b) => {
    const sevOrder = { S1: 0, S2: 1, S3: 2, S4: 3 };
    const sa = sevOrder[a.severity] ?? 4;
    const sb = sevOrder[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
  });

  const selected = incidents.find((i) => i.incident_id === selectedId);
  const sites = Array.from(new Set(incidents.map((i) => i.site_code))).sort();

  // ─── Status update ───
  const updateStatus = async (newStatus) => {
    if (!selected) return;
    setAdvancing(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "incident-status-update",
          incidentId: selected.incident_id,
          newStatus,
          adminEmail,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (showToast) showToast(`✅ Status: ${STATUS_LABELS[newStatus]}`);
        await refresh();
      } else {
        if (showToast) showToast(`⚠️ ${data.error || "Update failed"}`, "error");
      }
    } catch (err) {
      if (showToast) showToast(`⚠️ Error: ${err.message}`, "error");
    } finally {
      setAdvancing(false);
    }
  };

  const addNote = async () => {
    if (!selected || !noteText.trim()) return;
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "incident-add-note",
          incidentId: selected.incident_id,
          note: noteText.trim(),
          adminEmail,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (showToast) showToast("✅ Note added");
        setNoteText("");
        setShowNote(false);
        await refresh();
      } else {
        if (showToast) showToast(`⚠️ ${data.error || "Note failed"}`, "error");
      }
    } catch (err) {
      if (showToast) showToast(`⚠️ Error: ${err.message}`, "error");
    }
  };

  // ─── Render ───
  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-card pp-card--form">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h2 className="pp-card-title" style={{ margin: 0 }}>Incident Admin Queue</h2>
          <button className="pp-btn pp-btn--ghost" onClick={refresh} disabled={loading} style={{ padding: "6px 12px", fontSize: 12 }}>
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
        </div>

        {/* Filter toolbar */}
        <div className="pp-inc-admin-toolbar">
          {[
            { id: "active", label: "Active" },
            { id: "s1", label: "S1 only" },
            { id: "submitted", label: "Submitted" },
            { id: "investigating", label: "Investigating" },
            { id: "closed", label: "Closed" },
            { id: "all", label: "All" },
          ].map((f) => (
            <button
              key={f.id}
              className={`pp-inc-admin-filter${statusFilter === f.id ? " pp-inc-admin-filter--active" : ""}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <select
            className="pp-inc-admin-filter"
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            style={{ marginLeft: "auto" }}
          >
            <option value="all">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Split panel */}
        <div className="pp-adm-split">
          {/* Left: list */}
          <div className="pp-adm-list-col">
            {loading && (
              <div className="pp-adm-list-empty">
                <p style={{ color: "#94a3b8" }}>Loading queue...</p>
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="pp-adm-list-empty">
                <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
                <p style={{ color: "#94a3b8", fontWeight: 500 }}>No incidents match this filter.</p>
              </div>
            )}
            {filtered.map((item) => {
              const t = INCIDENT_TYPES.find((x) => x.id === item.incident_type);
              const isActive = selectedId === item.incident_id;
              const sevColor = SEVERITY_TIERS.find((x) => x.id === item.severity)?.color || "#94a3b8";
              return (
                <div
                  key={item.incident_id}
                  className={`pp-inc-admin-item${isActive ? " pp-inc-admin-item--selected" : ""}`}
                  style={{ borderLeftColor: sevColor }}
                  onClick={() => setSelectedId(item.incident_id)}
                >
                  <div className="pp-inc-admin-avatar" style={{ background: t?.color || "#6b7280" }}>
                    {ICONS[item.incident_type]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 9.5, color: "#94a3b8" }}>
                      {item.incident_id}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 500, lineHeight: 1.3, margin: "2px 0",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {t?.label || item.incident_type}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b" }}>
                      <span>{item.site_code}</span>
                      <span style={{ color: sevColor, fontWeight: 500 }}>
                        {item.severity} · {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: detail */}
          <div className="pp-adm-detail-col">
            {!selected && (
              <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "40px 20px" }}>
                Select an incident to view details.
              </div>
            )}
            {selected && (
              <IncidentDetail
                incident={selected}
                onAdvance={updateStatus}
                onAddNote={addNote}
                noteText={noteText}
                setNoteText={setNoteText}
                showNote={showNote}
                setShowNote={setShowNote}
                advancing={advancing}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// INCIDENT DETAIL PANE
// ─────────────────────────────────────────────
function IncidentDetail({ incident, onAdvance, onAddNote, noteText, setNoteText, showNote, setShowNote, advancing }) {
  const t = INCIDENT_TYPES.find((x) => x.id === incident.incident_type);
  const sev = SEVERITY_TIERS.find((x) => x.id === incident.severity);
  const stIdx = STATUS_FLOW.indexOf(incident.status);
  const nextStatus = stIdx >= 0 && stIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[stIdx + 1] : null;

  // Parse type-specific data
  let tsData = {};
  try {
    tsData = typeof incident.type_specific_data === "string" && incident.type_specific_data
      ? JSON.parse(incident.type_specific_data)
      : (incident.type_specific_data || {});
  } catch {
    tsData = {};
  }

  return (
    <div style={{ padding: "8px 4px" }}>
      {/* Header */}
      <div style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        borderBottom: "1px solid #f1f5f9", paddingBottom: 12, marginBottom: 14,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: t?.color || "#6b7280", color: "white",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ width: 20, height: 20, display: "inline-flex" }}>{ICONS[incident.incident_type]}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 3px", lineHeight: 1.3 }}>{t?.label || incident.incident_type}</h3>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#64748b" }}>
            {incident.incident_id} · {incident.site_code}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 4, letterSpacing: "0.04em",
          background: sev ? `${sev.color}22` : "#f1f5f9",
          color: sev?.color || "#475569",
          flexShrink: 0,
        }}>
          {incident.severity}
        </span>
      </div>

      {/* Status flow */}
      <div style={{ display: "flex", gap: 3, marginBottom: 16 }}>
        {STATUS_FLOW.map((s, i) => (
          <div key={s} style={{
            flex: 1, textAlign: "center", fontSize: 9, fontWeight: 500,
            padding: "5px 4px", borderRadius: 4, letterSpacing: "0.04em", textTransform: "uppercase",
            background: i < stIdx ? "#d1fae5" : i === stIdx ? "#7c3aed" : "#f1f5f9",
            color: i < stIdx ? "#065f46" : i === stIdx ? "white" : "#94a3b8",
          }}>
            {STATUS_LABELS[s]}
          </div>
        ))}
      </div>

      {/* Fields */}
      <DetailRow l="Submitted by" v={`${incident.submitted_by_name || ""} <${incident.submitted_by_email}>`} />
      <DetailRow l="Submitted at" v={formatDateTime(incident.submitted_at)} />
      <DetailRow l="Incident" v={`${incident.incident_date} ${incident.incident_time}`} />
      <DetailRow l="Location" v={incident.location_detail || "—"} />
      <DetailRow l="Manager aware" v={incident.manager_aware_date} />
      <div style={{ display: "flex", padding: "6px 0", fontSize: 12 }}>
        <div style={{ color: "#64748b", width: 110, flexShrink: 0 }}>What happened</div>
        <div style={{ color: "#0f3057", flex: 1, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{incident.what_happened}</div>
      </div>
      {incident.witnesses && (
        <div style={{ display: "flex", padding: "3px 0", fontSize: 12 }}>
          <div style={{ color: "#64748b", width: 110, flexShrink: 0 }}>Witnesses</div>
          <div style={{ color: "#0f3057", flex: 1, whiteSpace: "pre-wrap" }}>{incident.witnesses}</div>
        </div>
      )}

      {/* Type-specific */}
      {Object.keys(tsData).length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
          <div style={{
            fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
            textTransform: "uppercase", color: "#94a3b8", marginBottom: 6,
          }}>Type-specific details</div>
          {Object.entries(tsData).filter(([, v]) => v).map(([k, v]) => (
            <DetailRow key={k} l={prettify(k)} v={String(v)} />
          ))}
        </div>
      )}

      {/* Drive folder */}
      {incident.drive_folder_url && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
          <a
            href={incident.drive_folder_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#7c3aed", fontSize: 12, fontWeight: 500, textDecoration: "none" }}
          >
            📂 Open Drive folder ({incident.attachment_count || 0} attachments) ↗
          </a>
        </div>
      )}

      {/* Check-in due */}
      {incident.employee_check_in_due && !incident.employee_check_in_completed_at && (
        <div style={{
          marginTop: 12, padding: "8px 12px", background: "#fef3c7", borderRadius: 8,
          fontSize: 11, color: "#92400e",
        }}>
          ⏰ Employee 30-day check-in due: <strong>{incident.employee_check_in_due}</strong>
        </div>
      )}

      {/* Internal notes */}
      {incident.internal_notes && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
          <div style={{
            fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
            textTransform: "uppercase", color: "#94a3b8", marginBottom: 6,
          }}>Internal notes</div>
          <div style={{ fontSize: 12, color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {incident.internal_notes}
          </div>
        </div>
      )}

      {/* Add note inline */}
      {showNote && (
        <div style={{ marginTop: 12 }}>
          <textarea
            className="pp-input"
            rows={2}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add an internal note..."
            style={{ minHeight: 60, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="pp-btn pp-btn--primary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onAddNote}>
              Save note
            </button>
            <button className="pp-btn pp-btn--ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => { setShowNote(false); setNoteText(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{
        display: "flex", gap: 6, marginTop: 16,
        paddingTop: 12, borderTop: "0.5px solid #f1f5f9",
        alignItems: "center", flexWrap: "wrap",
      }}>
        {nextStatus && (
          <button
            className="pp-btn pp-btn--primary"
            style={{ padding: "7px 14px", fontSize: 12 }}
            onClick={() => onAdvance(nextStatus)}
            disabled={advancing}
          >
            {advancing ? "..." : `Advance to ${STATUS_LABELS[nextStatus]}`}
          </button>
        )}
        <select
          className="pp-select"
          style={{ width: "auto", minWidth: 130, padding: "7px 10px", fontSize: 12 }}
          value=""
          onChange={(e) => { if (e.target.value) onAdvance(e.target.value); }}
          disabled={advancing}
        >
          <option value="">Set status...</option>
          {STATUS_FLOW.map((s) => (
            <option key={s} value={s} disabled={s === incident.status}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        {!showNote && (
          <button className="pp-btn pp-btn--ghost" style={{ padding: "7px 12px", fontSize: 12 }} onClick={() => setShowNote(true)}>
            Add note
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function DetailRow({ l, v }) {
  return (
    <div style={{ display: "flex", padding: "3px 0", fontSize: 12 }}>
      <div style={{ color: "#64748b", width: 110, flexShrink: 0 }}>{l}</div>
      <div style={{ color: "#0f3057", flex: 1 }}>{v}</div>
    </div>
  );
}

function prettify(k) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}