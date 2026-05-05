"use client";
import { useState } from "react";
import {
  INCIDENT_TYPES,
  SEVERITY_TIERS,
  STATUS_FLOW,
  STATUS_LABELS,
  formatAttachmentLabel,
} from "@/lib/incidentSchema";

// ═══════════════════════════════════════════════════════════════
// INCIDENT DETAIL PANE
// Reusable detail view for incidents — used by AdminQueue (full
// edit/triage view) and ActionCenter (read-only view via readOnly prop).
// Manages its own state (investigation form, advancing, notes) and
// API calls. Parent provides: incident, bootstrapData, showToast, onRefresh.
//
// Re-mounts on selection change via key={incident.incident_id} from parent.
// Local state safe to initialize from props.
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

export default function IncidentDetailPane({
  incident,
  bootstrapData,
  showToast,
  onRefresh,
  readOnly = false,    // submitter side passes true → hides investigation pane + status actions + internal notes
}) {
const [advancing, setAdvancing] = useState(false);
  const [savingInvestigation, setSavingInvestigation] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [showNote, setShowNote] = useState(false);
  // W2 — investigation save feedback (timestamp of last successful save)
  const [lastInvSavedAt, setLastInvSavedAt] = useState(null);
  // W3 — status change visual confirmation (holds new status for ~3s after change)
  const [statusFlash, setStatusFlash] = useState(null);

  const adminEmail = bootstrapData?.userEmail || "";

  const t = INCIDENT_TYPES.find((x) => x.id === incident.incident_type);
  const sev = SEVERITY_TIERS.find((x) => x.id === incident.severity);
  const stIdx = STATUS_FLOW.indexOf(incident.status);
  const nextStatus = stIdx >= 0 && stIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[stIdx + 1] : null;

  // Investigation form state — editable in pane, persists via incident-update-investigation
  const [invForm, setInvForm] = useState({
    root_cause: incident.root_cause || "",
    corrective_action: incident.corrective_action || "",
    corrective_action_owner: incident.corrective_action_owner || "",
    corrective_action_due: incident.corrective_action_due || "",
    preventive_action: incident.preventive_action || "",
    preventive_action_owner: incident.preventive_action_owner || "",
    preventive_action_completed_at: incident.preventive_action_completed_at || "",
  });
  const setInv = (k, v) => setInvForm((f) => ({ ...f, [k]: v }));

  // Closure gating (SOP §8.4) — uses LIVE form values for hint;
  // server-side block uses persisted values.
  const caFilled = !!String(invForm.corrective_action || "").trim();
  const paFilled = !!String(invForm.preventive_action || "").trim();
  const persistedCaFilled = !!String(incident.corrective_action || "").trim();
  const persistedPaFilled = !!String(incident.preventive_action || "").trim();
  const canClose = persistedCaFilled && persistedPaFilled;
  const canCloseAfterSave = caFilled && paFilled;

  // Parse type-specific data
  let tsData = {};
  try {
    tsData = typeof incident.type_specific_data === "string" && incident.type_specific_data
      ? JSON.parse(incident.type_specific_data)
      : (incident.type_specific_data || {});
  } catch {
    tsData = {};
  }

  const sla = computeSLAStatus(incident);
  const rcOverdue = isOverdue(incident.root_cause_due_at, incident.root_cause);
  const caOverdue = isOverdue(incident.corrective_action_due_at, incident.corrective_action);

  // ─── Status update ───
  const updateStatus = async (newStatus) => {
    // SOP §8.4 - client-side guard (server will also reject)
    if (newStatus === "closed") {
      const ca = String(incident.corrective_action || "").trim();
      const pa = String(incident.preventive_action || "").trim();
      if (!ca || !pa) {
        const missing = [];
        if (!ca) missing.push("corrective action");
        if (!pa) missing.push("preventive action");
        if (showToast) showToast(`⚠️ Fill in ${missing.join(" and ")} below first (SOP §8.4)`, "error");
        return;
      }
    }
    setAdvancing(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "incident-status-update",
          incidentId: incident.incident_id,
          newStatus,
          adminEmail,
        }),
      });
const data = await res.json();
      if (data.success) {
        if (showToast) showToast(`✅ Status: ${STATUS_LABELS[newStatus]}`);
        // W3 — flash the new status in the dropdown for 3 seconds so the
        // change is visible inline (separate from the toast that disappears).
        setStatusFlash(newStatus);
        setTimeout(() => setStatusFlash(null), 3000);
        if (onRefresh) await onRefresh();
      } else {
        if (showToast) showToast(`⚠️ ${data.error || "Update failed"}`, "error");
      }
    } catch (err) {
      if (showToast) showToast(`⚠️ Error: ${err.message}`, "error");
    } finally {
      setAdvancing(false);
    }
  };

  // ─── Investigation save ───
  const handleSaveInvestigation = async () => {
    setSavingInvestigation(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "incident-update-investigation",
          incidentId: incident.incident_id,
          fields: invForm,
          adminEmail,
        }),
      });
const data = await res.json();
      if (data.success) {
        if (showToast) showToast("✅ Investigation saved");
        // W2 — Record save time so we can show "Last saved at HH:MM" near the button.
        setLastInvSavedAt(new Date());
        if (onRefresh) await onRefresh();
      } else {
        if (showToast) showToast(`⚠️ ${data.error || "Save failed"}`, "error");
      }
    } catch (err) {
      if (showToast) showToast(`⚠️ Error: ${err.message}`, "error");
    } finally {
      setSavingInvestigation(false);
    }
  };

  // ─── Add note ───
  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "incident-add-note",
          incidentId: incident.incident_id,
          note: noteText.trim(),
          adminEmail,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (showToast) showToast("✅ Note added");
        setNoteText("");
        setShowNote(false);
        if (onRefresh) await onRefresh();
      } else {
        if (showToast) showToast(`⚠️ ${data.error || "Note failed"}`, "error");
      }
    } catch (err) {
      if (showToast) showToast(`⚠️ Error: ${err.message}`, "error");
    }
  };

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

      {/* SLA badge — admin only (HR-internal compliance signal) */}
      {!readOnly && sla && (
        <div style={{
          marginBottom: 12, padding: "6px 10px", borderRadius: 6,
          fontSize: 11, fontWeight: 500,
          background: sla.met ? "#d1fae5" : "#fee2e2",
          color: sla.color,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          {sla.met ? "✓" : "⚠"} {sla.label}
        </div>
      )}

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
      {incident.immediate_actions_taken && (
        <div style={{ display: "flex", padding: "3px 0", fontSize: 12 }}>
          <div style={{ color: "#64748b", width: 110, flexShrink: 0 }}>Immediate actions</div>
          <div style={{ color: "#0f3057", flex: 1, whiteSpace: "pre-wrap" }}>{incident.immediate_actions_taken}</div>
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

      {/* Drive folder — visible to both admin and submitter */}
      {incident.drive_folder_url && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
<a
            href={incident.drive_folder_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#7c3aed", fontSize: 12, fontWeight: 500, textDecoration: "none" }}
          >
            📂 Open {formatAttachmentLabel(incident.attachment_count)} ↗
          </a>
                  </div>
      )}

      {/* Check-in due — admin only */}
      {!readOnly && incident.employee_check_in_due && !incident.employee_check_in_completed_at && (
        <div style={{
          marginTop: 12, padding: "8px 12px", background: "#fef3c7", borderRadius: 8,
          fontSize: 11, color: "#92400e",
        }}>
          ⏰ Employee 30-day check-in due: <strong>{incident.employee_check_in_due}</strong>
        </div>
      )}

      {/* Investigation & Closure pane — admin only */}
      {!readOnly && (
        <div className="pp-inc-invpane">
          <div className="pp-inc-invpane-header">
            <span>Investigation &amp; Closure</span>
            <span className="pp-inc-invpane-help">SOP §8.3 cadence · §8.4 requires both fields to close</span>
          </div>

          {/* Root cause + due */}
          <div className="pp-inc-invpane-field">
            <div className="pp-inc-invpane-label">
              Root cause
              {incident.root_cause_due_at && (
                <span className={`pp-inc-invpane-due${rcOverdue ? " pp-inc-invpane-due--overdue" : ""}`}>
                  {rcOverdue ? "⚠ Overdue · " : "Due "}
                  {formatDateOnly(incident.root_cause_due_at)}
                </span>
              )}
            </div>
            <textarea
              className="pp-input"
              rows={2}
              value={invForm.root_cause}
              onChange={(e) => setInv("root_cause", e.target.value)}
              placeholder="What conditions allowed this to happen? (Ask 'why' five times.)"
              style={{ minHeight: 50, resize: "vertical" }}
            />
          </div>

          {/* Corrective action group */}
          <div className="pp-inc-invpane-field">
            <div className="pp-inc-invpane-label">
              Corrective action <span style={{ color: "#dc2626" }}>*</span>
              {incident.corrective_action_due_at && (
                <span className={`pp-inc-invpane-due${caOverdue ? " pp-inc-invpane-due--overdue" : ""}`}>
                  {caOverdue ? "⚠ Overdue · " : "Due "}
                  {formatDateOnly(incident.corrective_action_due_at)}
                </span>
              )}
            </div>
            <textarea
              className="pp-input"
              rows={2}
              value={invForm.corrective_action}
              onChange={(e) => setInv("corrective_action", e.target.value)}
              placeholder="What fixes THIS incident?"
              style={{ minHeight: 50, resize: "vertical" }}
            />
            <div className="pp-inc-invpane-row">
              <div>
                <div className="pp-inc-invpane-sublabel">Owner</div>
                <input
                  className="pp-input"
                  value={invForm.corrective_action_owner}
                  onChange={(e) => setInv("corrective_action_owner", e.target.value)}
                  placeholder="email or name"
                />
              </div>
              <div>
                <div className="pp-inc-invpane-sublabel">Target completion</div>
                <input
                  type="date"
                  className="pp-input"
                  value={invForm.corrective_action_due}
                  onChange={(e) => setInv("corrective_action_due", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Preventive action group */}
          <div className="pp-inc-invpane-field">
            <div className="pp-inc-invpane-label">
              Preventive action <span style={{ color: "#dc2626" }}>*</span>
            </div>
            <textarea
              className="pp-input"
              rows={2}
              value={invForm.preventive_action}
              onChange={(e) => setInv("preventive_action", e.target.value)}
              placeholder="What prevents the NEXT one?"
              style={{ minHeight: 50, resize: "vertical" }}
            />
            <div className="pp-inc-invpane-row">
              <div>
                <div className="pp-inc-invpane-sublabel">Owner</div>
                <input
                  className="pp-input"
                  value={invForm.preventive_action_owner}
                  onChange={(e) => setInv("preventive_action_owner", e.target.value)}
                  placeholder="email or name"
                />
              </div>
              <div>
                <div className="pp-inc-invpane-sublabel">Completed at</div>
                <input
                  type="datetime-local"
                  className="pp-input"
                  value={invForm.preventive_action_completed_at}
                  onChange={(e) => setInv("preventive_action_completed_at", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Closure readiness hint */}
          {!canCloseAfterSave && (
            <div className="pp-inc-invpane-hint">
              Both Corrective and Preventive must be filled to advance status to Closed (SOP §8.4).
            </div>
          )}

<div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
            <button
              className="pp-btn pp-btn--primary"
              style={{ padding: "7px 14px", fontSize: 12 }}
              onClick={handleSaveInvestigation}
              disabled={savingInvestigation}
            >
              {savingInvestigation ? "Saving..." : "Save investigation"}
            </button>
            {/* W2 — Last-saved indicator. Visible after first successful save in this session. */}
            {lastInvSavedAt && !savingInvestigation && (
              <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 500 }}>
                ✓ Saved at {lastInvSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      )}

{/* W9 — Internal notes section (admin only)
          Single self-contained card: header + Add Note button + (optional) textarea + body.
          Previously the Add Note button lived in the status action bar far below the notes
          themselves, which created a disconnected feel — clicking the button caused content
          to appear in a different region of the screen. Now it's all colocated. */}
      {!readOnly && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: "1px solid #f1f5f9",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showNote ? 8 : 6 }}>
            <div style={{
              fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "#94a3b8",
            }}>
              Internal notes
              {incident.internal_notes && (
                <span style={{ marginLeft: 6, color: "#64748b", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
                  · {(incident.internal_notes.match(/\[/g) || []).length || 1}
                </span>
              )}
            </div>
            {!showNote && (
              <button
                className="pp-btn pp-btn--ghost"
                style={{ padding: "4px 10px", fontSize: 11, height: "auto" }}
                onClick={() => setShowNote(true)}
              >
                + Add note
              </button>
            )}
          </div>

          {/* Inline composer — appears at top of the section so it's adjacent to the button */}
          {showNote && (
            <div style={{ marginBottom: 10, padding: 10, background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <textarea
                className="pp-input"
                rows={2}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add an internal note..."
                style={{ minHeight: 56, resize: "vertical", background: "white" }}
                autoFocus
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button className="pp-btn pp-btn--primary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={addNote}>
                  Save note
                </button>
                <button
                  className="pp-btn pp-btn--ghost"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() => { setShowNote(false); setNoteText(""); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Notes body OR empty-state */}
          {incident.internal_notes ? (
            <div style={{ fontSize: 12, color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {incident.internal_notes}
            </div>
          ) : (
            !showNote && (
              <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic" }}>
                No internal notes yet.
              </div>
            )
          )}
        </div>
      )}
            {/* Status actions — admin only */}
      {!readOnly && (
        <div style={{
          display: "flex", gap: 6, marginTop: 16,
          paddingTop: 12, borderTop: "0.5px solid #f1f5f9",
          alignItems: "center", flexWrap: "wrap",
        }}>
          {nextStatus && (
            <button
              className="pp-btn pp-btn--primary"
              style={{ padding: "7px 14px", fontSize: 12 }}
              onClick={() => updateStatus(nextStatus)}
              disabled={advancing || (nextStatus === "closed" && !canClose)}
              title={nextStatus === "closed" && !canClose ? "Save corrective + preventive action first" : ""}
            >
              {advancing ? "..." : `Advance to ${STATUS_LABELS[nextStatus]}`}
            </button>
          )}
{/* P1 — Phase 2: dropdown is a secondary escape hatch (skip ahead, jump back).
              Was visually equal-weight to "Advance to X" primary. Now tighter, lower-contrast,
              with clear "Other status" framing. Primary remains the obvious choice. */}
          <select
            className="pp-select"
            style={{
              width: "auto", minWidth: 110, padding: "5px 8px", fontSize: 11,
              background: "transparent", borderColor: "#e2e8f0", color: "#64748b",
              // W3 — when flash is active, give the dropdown a green tint to confirm change
              ...(statusFlash ? { background: "#dcfce7", color: "#166534", borderColor: "#86efac" } : {}),
            }}
            value=""
            onChange={(e) => { if (e.target.value) updateStatus(e.target.value); }}
            disabled={advancing}
          >
            {/* W3 — flash the most recent change for 3s before reverting */}
            <option value="">{statusFlash ? `✓ Now: ${STATUS_LABELS[statusFlash]}` : "Other status…"}</option>
            {STATUS_FLOW.map((s) => {
              const blocked = s === "closed" && !canClose;
              return (
                <option key={s} value={s} disabled={s === incident.status || blocked}>
                  {STATUS_LABELS[s]}{blocked ? " · need CA + PA" : ""}
                </option>
              );
            })}
          </select>
                  </div>
      )}

      {/* Read-only footer note (submitter side) */}
      {readOnly && (
        <div style={{
          marginTop: 16, paddingTop: 12, borderTop: "0.5px solid #f1f5f9",
          fontSize: 11, color: "#94a3b8", textAlign: "center",
        }}>
          Once submitted, incidents stay on file. HR will follow up if more information is needed.
        </div>
      )}
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

function formatDateOnly(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

// SOP §06 Documentation SLA — measured from "moment of identification"
// (manager_aware_date if filled, else incident_date+time) to submitted_at.
const SLA_HOURS = { S1: 4, S2: 12, S3: 24, S4: 24 };

function computeSLAStatus(incident) {
  if (!incident?.submitted_at) return null;
  const slaHours = SLA_HOURS[incident.severity];
  if (!slaHours) return null;

  let identifiedAt = null;
  if (incident.manager_aware_date) {
    identifiedAt = new Date(`${incident.manager_aware_date}T00:00:00`);
  } else if (incident.incident_date) {
    const time = incident.incident_time || "00:00";
    identifiedAt = new Date(`${incident.incident_date}T${time}`);
  }
  if (!identifiedAt || isNaN(identifiedAt.getTime())) return null;

  const submittedAt = new Date(incident.submitted_at);
  const deltaMs = submittedAt.getTime() - identifiedAt.getTime();
  if (deltaMs < 0) return null; // identification after submit — bad data, skip

  const deltaHours = deltaMs / (1000 * 60 * 60);
  const met = deltaHours <= slaHours;

  const fmt = (h) => {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  };

  return {
    met,
    label: met
      ? `SLA met · filed in ${fmt(deltaHours)} (limit ${slaHours}h)`
      : `SLA missed · ${fmt(deltaHours - slaHours)} late (${fmt(deltaHours)} vs ${slaHours}h limit)`,
    color: met ? "#065f46" : "#991b1b",
  };
}

// Bucket D2 - field is overdue when its deadline has passed AND the
// associated value is still empty.
function isOverdue(dueIso, currentValue) {
  if (!dueIso) return false;
  if (String(currentValue || "").trim()) return false;
  try {
    return new Date(dueIso).getTime() < Date.now();
  } catch {
    return false;
  }
}

// Export icons map for parent list rendering
export const INCIDENT_ICONS = ICONS;