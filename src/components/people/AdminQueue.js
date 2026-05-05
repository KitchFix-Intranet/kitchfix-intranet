"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import IncidentDetailPane, { INCIDENT_ICONS } from "@/components/people/IncidentDetailPane";
import { INCIDENT_TYPES, SEVERITY_TIERS } from "@/lib/incidentSchema";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "newhire", label: "New Hires" },
  { id: "paf", label: "PAFs" },
  { id: "incident", label: "Incidents" },
];

// ── Human-readable label map ──
const LABEL_MAP = {
  isRehire: "Rehire",
  personalEmail: "Personal Email",
  locationName: "Operation",
  manager: "Manager",
  jobTitle: "Job Title",
  payType: "Pay Type",
  payRate: "Pay Rate",
  isFullTime: "Full-Time",
  startDate: "Start Date",
  needsCard: "Company Card",
  needsEmail: "Email Account",
  needsLaptop: "Laptop",
  needsCell: "Cell Phone",
  effectiveDate: "Effective Date",
lastDayWorked: "Last Day Worked",
  separationReason: "Separation Reason",
    rehireEligible: "Rehire Eligible",
  explanation: "Notes",
  oldRate: "Current Rate",
  newRate: "New Rate",
  oldTitle: "Current Title",
  newTitle: "New Title",
  reclassChangeRate: "Rate Change",
  statusChangeDirection: "Direction",
  reclassFrom: "From Account",
  reclassTo: "To Account",
  reclassTitleChange: "Title Change",
  cellFrequency: "Frequency",
  travelStartDate: "Travel Start",
  travelEndDate: "Travel End",
  perDiemTotal: "Per Diem Total",
  travelGrandTotal: "Grand Total",
  travelSupplementEnabled: "Supplement",
  businessPurpose: "Business Purpose",
  amount: "Amount",
  actionGroup: "Type",
};

// ── New hire: grouped display sections ──
const NH_SECTIONS = [
  {
    label: "Identity",
    fields: ["isRehire", "personalEmail"],
  },
  {
    label: "Role & Assignment",
    fields: ["locationName", "manager", "jobTitle"],
  },
  {
    label: "Compensation & Tools",
    fields: [
      "payType", "payRate", "isFullTime", "startDate",
      "needsCard", "needsEmail", "needsLaptop", "needsCell",
    ],
  },
];

// ── PAF: fields relevant to each action type ──
const PAF_DISPLAY_FIELDS = {
separation: ["effectiveDate", "lastDayWorked", "actionGroup", "separationReason", "rehireEligible", "explanation"],
  rate_change: ["effectiveDate", "oldRate", "newRate", "explanation"],
  title_change: ["effectiveDate", "oldTitle", "newTitle", "reclassChangeRate", "newRate", "explanation"],
  status_change: ["effectiveDate", "statusChangeDirection"],
  reclassification: ["effectiveDate", "reclassFrom", "reclassTo", "reclassTitleChange", "oldTitle", "newTitle", "reclassChangeRate", "newRate", "explanation"],
  add_cell_phone: ["effectiveDate", "cellFrequency", "explanation"],
  travel_reimbursement: ["effectiveDate", "travelStartDate", "travelEndDate", "perDiemTotal", "travelGrandTotal", "explanation"],
  add_bonus: ["effectiveDate", "amount", "explanation"],
  add_deduction: ["effectiveDate", "amount", "explanation"],
  add_gratuity: ["effectiveDate", "amount", "explanation"],
  other_reimbursement: ["effectiveDate", "amount", "explanation"],
};

// ── Format display values ──
function formatValue(key, value, Formatter) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "" || s === "-" || s === "undefined" || s === "null") return null;

  if (value === true || s === "true") return "Yes";
  if (value === false || s === "false") return "No";

  if (/rate|pay|salary|amount|total|cost|price/i.test(key) && !isNaN(value) && s !== "0") {
    return Formatter.toMoney(value);
  }

  if (/date/i.test(key)) {
    return Formatter.toDate(value);
  }

  return s;
}

// P0 — Phase 1: relative-time formatter for incident list cards.
// Renders "12m ago" / "3h ago" / "2d ago" / "May 5" — graceful at any age.
function formatRelativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return d.toLocaleDateString([], { month: "short", day: "numeric" }); // future-dated, just show date
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getLabel(key) {
  return LABEL_MAP[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

// ── Icons ──
const UserIconSm = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const DocIconSm = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);

// Generic warning icon for incidents in list
const IncidentIconSm = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);

export default function AdminQueue({ bootstrapData, Formatter, showToast, openConfirm }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
const [filter, setFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  // W4 — toggle between active queue and closed-incidents history
  const [view, setView] = useState("open"); // "open" | "closed"
  //   //   const [locFilter, setLocFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const approveTimerRef = useRef(null);
  const rejectTimerRef = useRef(null);

const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      // W4 — pick endpoint based on current view (open queue vs closed history)
      const endpoint = view === "closed" ? "admin-queue-closed" : "admin-queue";
      const res = await fetch(`/api/people?action=${endpoint}`);
      const data = await res.json();
      if (data.success) setQueue(data.queue);
    } catch (e) {
      showToast("Failed to load queue", "error");
    }
    setLoading(false);
  }, [showToast, view]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // Background polling (30s) — pauses during animations
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden || approvingId || rejectingId) return;
      // W4 — match current view in polling too
      const endpoint = view === "closed" ? "admin-queue-closed" : "admin-queue";
      fetch(`/api/people?action=${endpoint}`)
        .then((r) => r.json())
        .then((data) => { if (data.success) setQueue(data.queue); })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [approvingId, rejectingId, view]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (approveTimerRef.current) clearTimeout(approveTimerRef.current);
      if (rejectTimerRef.current) clearTimeout(rejectTimerRef.current);
    };
  }, []);

  // ── Filter logic ──
  const filtered = queue.filter((item) => {
    if (filter !== "all" && item.type !== filter) return false;
    if (locFilter !== "all" && !item.location.includes(locFilter)) return false;
    return true;
  });

  const locations = [...new Set(queue.map((q) => q.location))].sort();

  // Auto-select first item (skip during animations)
  useEffect(() => {
    if (approvingId || rejectingId) return;
    if (filtered.length > 0 && (!selectedId || !filtered.find((i) => i.id === selectedId))) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId, approvingId, rejectingId]);

  const selectedItem = filtered.find((i) => i.id === selectedId) || null;

  // ── Parse details ──
  const parseDetails = (item) => {
    try { return JSON.parse(item.details); } catch (e) { return {}; }
  };

  // ── Metric for list display ──
  const getMetric = (item) => {
    try {
      const d = JSON.parse(item.details);
      if (d.payRate) return Formatter.toMoney(d.payRate);
      if (d.newRate) return Formatter.toMoney(d.newRate);
      if (d.amount) return Formatter.toMoney(d.amount);
      if (d.travelGrandTotal) return Formatter.toMoney(d.travelGrandTotal);
    } catch (e) {}
    return null;
  };

  // ── Approve (animated) ──
  const handleApprove = (item) => {
    if (approvingId || rejectingId) return;

    setApprovingId(item.id);

    // Fire API in background
    fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "admin-process",
        itemId: item.id,
        adminAction: "approve",
        reason: "",
        adminEmail: bootstrapData?.userEmail,
      }),
    }).catch(() => {});

    // After animation, remove and advance
    approveTimerRef.current = setTimeout(() => {
      setQueue((prev) => prev.filter((q) => q.id !== item.id));
      setApprovingId(null);
      setSelectedId(null);
      showToast("✅ Approved", "success");
    }, 900);
  };

  // ── Reject (open modal) ──
  const handleReject = (item) => {
    setRejectTarget(item);
    setRejectReason("");
  };

  // ── Confirm reject (animated) ──
  const confirmReject = () => {
    if (!rejectTarget) return;
    const targetId = rejectTarget.id;
    const reason = rejectReason;

    // Close modal and start animation
    setRejectTarget(null);
    setRejectReason("");
    setRejectingId(targetId);

    // Fire API in background
    fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "admin-process",
        itemId: targetId,
        adminAction: "reject",
        reason: reason,
        adminEmail: bootstrapData?.userEmail,
      }),
    }).catch(() => {});

    // After animation, remove and advance
    rejectTimerRef.current = setTimeout(() => {
      setQueue((prev) => prev.filter((q) => q.id !== targetId));
      setRejectingId(null);
      setSelectedId(null);
      showToast("❌ Rejected", "error");
    }, 900);
  };

  // ── Render field ──
  const renderField = (key, details) => {
    const raw = details[key];
    const display = formatValue(key, raw, Formatter);
    if (!display) return null;
    return (
      <div key={key} className="pp-adm-field">
        <div className="pp-adm-field-label">{getLabel(key)}</div>
        <div className="pp-adm-field-value">{display}</div>
      </div>
    );
  };

  // ── Detail pane ──
  const renderDetail = () => {
    // ── Reject success overlay ──
    if (rejectingId && rejectingId === selectedId) {
      return (
        <div className="pp-adm-approve-success">
          <div className="pp-adm-approve-circle" style={{ background: "#fee2e2", color: "#dc2626" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <p className="pp-adm-approve-label" style={{ color: "#dc2626" }}>Rejected</p>
        </div>
      );
    }

    // ── Approve success overlay ──
    if (approvingId && approvingId === selectedId) {
      return (
        <div className="pp-adm-approve-success">
          <div className="pp-adm-approve-circle">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="pp-adm-approve-label">Approved</p>
        </div>
      );
    }

    if (!selectedItem) {
      return (
        <div className="pp-adm-detail-empty">
          <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.4 }}>←</div>
          <p>Select an item to review</p>
        </div>
      );
    }

    // ─── Incident: render full investigation/triage pane ───
    if (selectedItem.type === "incident" && selectedItem.incident) {
      return (
        <IncidentDetailPane
          key={selectedItem.id}
          incident={selectedItem.incident}
          bootstrapData={bootstrapData}
          showToast={showToast}
          onRefresh={loadQueue}
          readOnly={false}
        />
      );
    }

    const details = parseDetails(selectedItem);
    const isNH = selectedItem.type === "newhire";
    const submitter = details.submitterEmail || "—";
    const submittedDate = selectedItem.date ? Formatter.toDate(selectedItem.date) : "—";

    return (
      <div className="pp-adm-detail-inner" style={{ animation: "pp-slideUp 0.2s ease" }}>
        {/* Header */}
        <div className="pp-adm-detail-header">
          <div>
            <h3 className="pp-adm-detail-name">{selectedItem.title}</h3>
            <p className="pp-adm-detail-type">{Formatter.toTitleCase(selectedItem.subtitle)}</p>
          </div>
          <div className="pp-adm-detail-badge">{selectedItem.location}</div>
        </div>

        {/* Meta */}
        <div className="pp-adm-meta-row">
          <div className="pp-adm-meta-item"><strong>Submitted by:</strong> {submitter}</div>
          <div className="pp-adm-meta-item"><strong>Submitted:</strong> {submittedDate}</div>
        </div>

        {/* Fields */}
        {isNH ? (
          NH_SECTIONS.map((section) => {
            const renderedFields = section.fields.map((key) => renderField(key, details)).filter(Boolean);
            if (renderedFields.length === 0) return null;
            return (
              <div key={section.label}>
                <div className="pp-adm-section-label">{section.label}</div>
                <div className="pp-adm-fields-grid">{renderedFields}</div>
              </div>
            );
          })
        ) : (
          <>
            <div className="pp-adm-section-label">Details</div>
            <div className="pp-adm-fields-grid">
              {(PAF_DISPLAY_FIELDS[details.actionType] || []).map((key) => renderField(key, details)).filter(Boolean)}
            </div>
          </>
        )}

{/* Action buttons — only in OPEN view (closed items are terminal) */}
        {view === "open" ? (
          <div className="pp-adm-detail-actions">
            <button
              className="pp-btn pp-adm-btn-approve"
              onClick={() => handleApprove(selectedItem)}
              disabled={!!approvingId || !!rejectingId || !!processing}
            >
              ✓ Approve
            </button>
            <button
              className="pp-btn pp-adm-btn-reject"
              onClick={() => handleReject(selectedItem)}
              disabled={!!approvingId || !!rejectingId || !!processing}
            >
              ✕ Reject
            </button>
          </div>
        ) : (
          // W4 — closed view: show terminal status badge in place of action buttons
          <div className="pp-adm-detail-actions" style={{ justifyContent: "flex-start" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: /reject/i.test(selectedItem.closedStatus || "") ? "#fee2e2" : "#dcfce7",
              color: /reject/i.test(selectedItem.closedStatus || "") ? "#991b1b" : "#166534",
            }}>
              {/reject/i.test(selectedItem.closedStatus || "") ? "✕" : "✓"}
              {" "}
              {selectedItem.closedStatus || "Closed"}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-master-card" style={{ borderTop: "4px solid var(--pp-purple)" }}>
{/* Header */}
        <div className="pp-master-header" style={{ display: "block" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <h3 className="pp-card-title" style={{ margin: 0, fontSize: 18 }}>
                {view === "closed" ? "Closed Incidents" : "Approvals Queue"}
              </h3>
              <p className="pp-card-desc" style={{ margin: 0, fontSize: 12 }}>
                {loading
                  ? "Syncing..."
                  : view === "closed"
                    ? `${filtered.length} closed incident${filtered.length !== 1 ? "s" : ""}`
                    : `${filtered.length} item${filtered.length !== 1 ? "s" : ""} pending`}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* W4 — Open / Closed toggle */}
              <div style={{ display: "inline-flex", border: "1px solid #e2e8f0", borderRadius: 999, padding: 2, background: "#f8fafc" }}>
                <button
                  className="pp-btn"
                  onClick={() => setView("open")}
                  style={{
                    padding: "5px 12px", fontSize: 12, borderRadius: 999, border: "none",
                    background: view === "open" ? "var(--pp-purple)" : "transparent",
                    color: view === "open" ? "white" : "#64748b",
                    fontWeight: view === "open" ? 600 : 400,
                  }}
                >
                  Open
                </button>
                <button
                  className="pp-btn"
                  onClick={() => setView("closed")}
                  style={{
                    padding: "5px 12px", fontSize: 12, borderRadius: 999, border: "none",
                    background: view === "closed" ? "#0f3057" : "transparent",
                    color: view === "closed" ? "white" : "#64748b",
                    fontWeight: view === "closed" ? 600 : 400,
                  }}
                >
                  Closed
                </button>
              </div>
              <button className="pp-btn pp-btn--ghost" onClick={loadQueue} style={{ padding: "6px 16px", height: 32, fontSize: 12 }}>
                Refresh ↻
              </button>
            </div>
          </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div className="pp-toggle-container" style={{ flex: 1 }}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`pp-pill${filter === f.id ? " pp-pill-primary active" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  <span className="pp-pill-label">{f.label}</span>
                  <span className="pp-pill-count">
                    {f.id === "all" ? queue.length : queue.filter((q) => q.type === f.id).length}
                  </span>
                </button>
              ))}
            </div>
            <select className="pp-select" value={locFilter} onChange={(e) => setLocFilter(e.target.value)} style={{ width: "auto", minWidth: 150, fontSize: 13 }}>
              <option value="all">All Locations</option>
              {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          </div>
        </div>

        {/* ═══ Split panel ═══ */}
        <div className={`pp-adm-split${mobileDetail ? " pp-adm-split--detail-open" : ""}`}>
          {/* Left: scrollable list */}
          <div className="pp-adm-list-col">
            {loading && (
              <div className="pp-adm-list-empty">
                <p style={{ color: "#94a3b8" }}>Loading queue...</p>
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="pp-adm-list-empty">
                <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
                <p style={{ color: "#94a3b8", fontWeight: 600 }}>Queue is empty. Nice work!</p>
              </div>
            )}
            {filtered.map((item) => {
              const metric = getMetric(item);
              const isNH = item.type === "newhire";
              const isIncident = item.type === "incident";
              const isActive = selectedId === item.id;
              const isExiting = approvingId === item.id || rejectingId === item.id;
              const teamAbbr = item.location.split(" - ")[0];
              const sevColor = isIncident
                ? (SEVERITY_TIERS.find((s) => s.id === item.severity)?.color || "#94a3b8")
                : null;

              return (
                <div
                  key={item.id}
                  className={`pp-adm-list-item${isActive ? " active" : ""} ${isNH ? "type-nh" : isIncident ? "type-inc" : "type-paf"}${isExiting ? " pp-adm-list-item--exiting" : ""}`}
                  style={isIncident ? { borderLeft: `3px solid ${sevColor}` } : {}}
                  onClick={() => {
                    if (approvingId || rejectingId) return;
                    setSelectedId(item.id);
                    setMobileDetail(true);
                  }}
                >
                  <div
                    className={`pp-adm-list-avatar ${isNH ? "nh" : isIncident ? "inc" : "paf"}`}
                    style={isIncident ? { background: item.typeColor || "#6b7280" } : {}}
                  >
                    {isNH ? <UserIconSm /> : isIncident ? (INCIDENT_ICONS[item.incidentType] || <IncidentIconSm />) : <DocIconSm />}
                  </div>
<div className="pp-adm-list-info">
                    <div className="pp-adm-list-name">{item.title}</div>
                    <div className="pp-adm-list-sub">{Formatter.toTitleCase(item.subtitle)}</div>
                    {/* P0 — Phase 1: incidents need a distinguishing line so two
                        adjacent same-type/same-site incidents are tellable apart.
                        Relative time is the cheapest signal that's always different. */}
                    {isIncident && item.date && (
                      <div className="pp-adm-list-time">{formatRelativeTime(item.date)}</div>
                    )}
                  </div>
                                    <div className="pp-adm-list-right">
                    <div className="pp-adm-list-badge">{teamAbbr}</div>
                    {isIncident ? (
                      <div style={{
                        fontSize: 9, fontWeight: 700, marginTop: 2,
                        padding: "1px 6px", borderRadius: 4,
                        background: `${sevColor}22`,
                        color: sevColor,
                        letterSpacing: "0.04em",
                      }}>{item.severity}</div>
                    ) : (
                      metric && <div className="pp-adm-list-metric">{metric}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: detail pane */}
          <div className="pp-adm-detail-col">
            <button className="pp-adm-mobile-back" onClick={() => setMobileDetail(false)}>
              ← Back to list
            </button>
            {renderDetail()}
          </div>
        </div>
      </div>

      {/* ═══ Reject modal ═══ */}
      {rejectTarget && (
        <div className="pp-modal-overlay" onClick={() => setRejectTarget(null)}>
          <div className="pp-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon" style={{ background: "#fee2e2", color: "#dc2626" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <h3 className="pp-card-title">Reject: {rejectTarget.title}</h3>
            </div>
            <div style={{ padding: "0 24px 24px" }}>
              <label className="pp-label">Reason for Rejection</label>
              <textarea
                className="pp-textarea"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please specify what needs to be corrected..."
              />
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn pp-btn--ghost" onClick={() => setRejectTarget(null)}>Cancel</button>
              <button
                className="pp-btn"
                style={{
                  background: !rejectReason.trim() ? "#fca5a5" : "#dc2626",
                  color: "white",
                  transition: "background 0.2s",
                }}
                onClick={confirmReject}
                disabled={!rejectReason.trim()}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}