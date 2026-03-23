"use client";
import { useState, useMemo } from "react";

const FILTERS = [
  { id: "action", label: "Action" },
  { id: "pending", label: "Pending" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
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
  employeeName: "Employee",
};

// ── New hire: grouped display sections ──
const NH_SECTIONS = [
  { label: "Identity", fields: ["isRehire", "personalEmail"] },
  { label: "Role & Assignment", fields: ["locationName", "manager", "jobTitle"] },
  {
    label: "Compensation & Tools",
    fields: ["payType", "payRate", "isFullTime", "startDate", "needsCard", "needsEmail", "needsLaptop", "needsCell"],
  },
];

// ── PAF: fields relevant to each action type ──
const PAF_DISPLAY_FIELDS = {
  separation: ["effectiveDate", "employeeName", "actionGroup", "separationReason", "rehireEligible", "explanation"],
  rate_change: ["effectiveDate", "employeeName", "oldRate", "newRate", "explanation"],
  title_change: ["effectiveDate", "employeeName", "oldTitle", "newTitle", "reclassChangeRate", "newRate", "explanation"],
  status_change: ["effectiveDate", "employeeName", "statusChangeDirection"],
  reclassification: ["effectiveDate", "employeeName", "reclassFrom", "reclassTo", "reclassTitleChange", "oldTitle", "newTitle", "reclassChangeRate", "newRate", "explanation"],
  add_cell_phone: ["effectiveDate", "employeeName", "cellFrequency", "explanation"],
  travel_reimbursement: ["effectiveDate", "employeeName", "travelStartDate", "travelEndDate", "perDiemTotal", "travelGrandTotal", "explanation"],
  add_bonus: ["effectiveDate", "employeeName", "amount", "explanation"],
  add_deduction: ["effectiveDate", "employeeName", "amount", "explanation"],
  add_gratuity: ["effectiveDate", "employeeName", "amount", "explanation"],
  other_reimbursement: ["effectiveDate", "employeeName", "amount", "explanation"],
};

// ── Format display values ──
function formatValue(key, value, Formatter) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "" || s === "-" || s === "undefined" || s === "null") return null;
  if (value === true || s === "true") return "Yes";
  if (value === false || s === "false") return "No";
  if (/rate|pay|salary|amount|total|cost|price/i.test(key) && !isNaN(value) && s !== "0") return Formatter.toMoney(value);
  if (/date/i.test(key)) return Formatter.toDate(value);
  return s;
}

function getLabel(key) {
  return LABEL_MAP[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function statusMatch(status, filter) {
  if (filter === "all") return true;
  if (filter === "action") return /Rejected|Action/i.test(status);
  if (filter === "pending") return /Pending/i.test(status);
  if (filter === "done") return /Complete|Approved|Withdrawn|Cancelled/i.test(status);
  return true;
}

function StatusChip({ status }) {
  const s = String(status).toLowerCase();
  let cls = "pp-chip-pending";
  let label = status;
  if (/complete|approved/i.test(s)) { cls = "pp-chip-success"; label = "Complete"; }
  if (/rejected|action/i.test(s)) { cls = "pp-chip-danger"; label = "Action Required"; }
  if (/withdrawn/i.test(s)) { cls = "pp-chip-withdrawn"; label = "Withdrawn"; }
  if (/cancelled/i.test(s)) { cls = "pp-chip-withdrawn"; label = "Cancelled"; }
  return <span className={`pp-status-chip ${cls}`}>{label}</span>;
}

// ── List item border color ──
function getBorderClass(status) {
  if (/Rejected|Action/i.test(status)) return "pp-ac-item--rejected";
  if (/Pending/i.test(status)) return "pp-ac-item--pending";
  return "pp-ac-item--done";
}

export default function ActionCenter({ history, onResumeEdit, onRefresh, userEmail, Formatter, showToast }) {
  const [filter, setFilter] = useState("action");
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { item, type: "withdraw" | "cancel" }
  const [processing, setProcessing] = useState(false);

  const filtered = useMemo(
    () => history.filter((h) => h.status !== "Archived" && statusMatch(h.status, filter)),
    [history, filter]
  );

  const filterCounts = useMemo(() => {
    const c = { action: 0, pending: 0, done: 0 };
    history.forEach((h) => {
      if (h.status === "Archived") return;
      if (/Rejected|Action/i.test(h.status)) c.action++;
      else if (/Pending/i.test(h.status)) c.pending++;
      else if (/Complete|Approved|Withdrawn|Cancelled/i.test(h.status)) c.done++;
    });
    return c;
  }, [history]);

  // Auto-select first item
  const selectedItem = filtered.find((i) => i.id === selectedId) || null;
  if (filtered.length > 0 && !selectedItem && !mobileDetail) {
    setTimeout(() => setSelectedId(filtered[0].id), 0);
  }

  // ── Withdraw / Cancel handler ──
  const handleConfirmAction = async () => {
    if (!confirmModal) return;
    setProcessing(true);
    const { item, type } = confirmModal;
    const apiAction = type === "cancel" ? "cancel-submission" : "withdraw-submission";
    const label = type === "cancel" ? "cancelled" : "withdrawn";
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: apiAction,
          itemId: item.id,
          email: userEmail,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (showToast) showToast(`${item.title} ${label}`, "success");
        setConfirmModal(null);
        setSelectedId(null);
        if (onRefresh) onRefresh();
      }
    } catch (e) {
      console.error(`[ActionCenter] ${type} failed:`, e);
    } finally {
      setProcessing(false);
    }
  };

  // ── Parse payload ──
  const parsePayload = (item) => {
    try { return JSON.parse(item.payload); } catch (e) { return {}; }
  };

  // ── Render field ──
  const renderField = (key, payload) => {
    const display = formatValue(key, payload[key], Formatter);
    if (!display) return null;
    return (
      <div key={key}>
        <div className="pp-adm-field-label">{getLabel(key)}</div>
        <div className="pp-adm-field-value">{display}</div>
      </div>
    );
  };

  // ── Detail pane ──
  const renderDetail = () => {
    if (!selectedItem) {
      return (
        <div className="pp-adm-detail-empty">
          <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.4 }}>←</div>
          <p>Select an item to review</p>
        </div>
      );
    }

    const payload = parsePayload(selectedItem);
    const isNH = selectedItem.module === "newhire";
    const isRejected = /Rejected|Action/i.test(selectedItem.status);
    const isPending = /Pending/i.test(selectedItem.status);
    const isWithdrawn = /Withdrawn/i.test(selectedItem.status);
    const isCancelled = /Cancelled/i.test(selectedItem.status);

    return (
      <div className="pp-adm-detail-inner" style={{ animation: "pp-slideUp 0.2s ease" }}>
        {/* Header */}
        <div className="pp-adm-detail-header">
          <div>
            <h3 className="pp-adm-detail-name">{selectedItem.title}</h3>
            <p className="pp-adm-detail-type">{Formatter.toTitleCase(selectedItem.subtitle)}</p>
          </div>
          <StatusChip status={selectedItem.status} />
        </div>

        {/* Meta */}
        <div className="pp-adm-meta-row">
          <div className="pp-adm-meta-item">
            <strong>Submitted:</strong> {Formatter.toDate(selectedItem.date)}
          </div>
        </div>

        {/* Fields — grouped for NH, flat section for PAF */}
        {isNH ? (
          NH_SECTIONS.map((section) => {
            const fields = section.fields.map((key) => renderField(key, payload)).filter(Boolean);
            if (fields.length === 0) return null;
            return (
              <div key={section.label}>
                <div className="pp-adm-section-label">{section.label}</div>
                <div className="pp-adm-fields-grid">{fields}</div>
              </div>
            );
          })
        ) : (
          (() => {
            const actionType = payload.actionType || "";
            const allowedFields = PAF_DISPLAY_FIELDS[actionType];
            const fieldKeys = allowedFields || Object.keys(payload).filter((k) => !["firstName", "lastName", "submitterEmail", "isEdit", "rowIndex", "_v", "dateOfSubmission", "locationKey", "actionType", "actionGroup", "showTravelHelp", "uploadData", "uploadFileName"].includes(k));
            const fields = fieldKeys.map((key) => renderField(key, payload)).filter(Boolean);
            if (fields.length === 0) return null;
            return (
              <>
                <div className="pp-adm-section-label">Details</div>
                <div className="pp-adm-fields-grid">{fields}</div>
              </>
            );
          })()
        )}

        {/* Rejection reason */}
        {isRejected && selectedItem.notes && (
          <div className="pp-reject-reason" style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Rejection Reason</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#991b1b", lineHeight: 1.4 }}>{selectedItem.notes}</div>
          </div>
        )}

        {/* Withdrawn / Cancelled note */}
        {(isWithdrawn || isCancelled) && (
          <div style={{ marginTop: 16, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
              {isCancelled ? "Cancelled" : "Withdrawn"}
            </div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              This request was {isCancelled ? "cancelled" : "withdrawn"} and no further action is needed.
            </div>
          </div>
        )}

        {/* Action buttons — rejected items: Fix & Resubmit + Withdraw */}
        {isRejected && (
          <div className="pp-adm-detail-actions" style={{ display: "flex", gap: 10 }}>
            <button
              className="pp-btn"
              style={{
                background: "#dc2626",
                color: "white",
                borderRadius: 50,
                padding: "10px 28px",
                fontSize: 14,
                fontWeight: 700,
                flex: 1,
                textAlign: "center",
                boxShadow: "0 2px 5px rgba(220, 38, 38, 0.3)",
              }}
              onClick={() => onResumeEdit(selectedItem)}
            >
              Fix & Resubmit
            </button>
            <button
              className="pp-btn"
              style={{
                background: "white",
                color: "#64748b",
                border: "1.5px solid #e2e8f0",
                borderRadius: 50,
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "center",
                cursor: "pointer",
              }}
              onClick={() => setConfirmModal({ item: selectedItem, type: "withdraw" })}
            >
              Withdraw
            </button>
          </div>
        )}

        {/* Action button — pending items: Cancel Request */}
        {isPending && (
          <div className="pp-adm-detail-actions" style={{ display: "flex", gap: 10 }}>
            <button
              className="pp-btn"
              style={{
                background: "white",
                color: "#64748b",
                border: "1.5px solid #e2e8f0",
                borderRadius: 50,
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "center",
                cursor: "pointer",
                flex: 1,
              }}
              onClick={() => setConfirmModal({ item: selectedItem, type: "cancel" })}
            >
              Cancel Request
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Modal config by type ──
  const modalConfig = confirmModal ? {
    withdraw: {
      icon: "🗑️",
      title: "Withdraw this request?",
      description: `will be moved to Done and no further action will be taken.`,
      confirmLabel: "Yes, Withdraw",
      confirmBg: "#64748b",
    },
    cancel: {
      icon: "✕",
      title: "Cancel this request?",
      description: `will be cancelled. The admin will not see it in their queue.`,
      confirmLabel: "Yes, Cancel Request",
      confirmBg: "#dc2626",
    },
  }[confirmModal.type] : null;

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-master-card">
        {/* Header */}
        <div className="pp-master-header" style={{ display: "block" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 className="pp-card-title" style={{ margin: 0 }}>Action Center</h3>
          </div>
          <div className="pp-toggle-container">
            {FILTERS.map((f) => {
              const count = filterCounts[f.id];
              const isZero = f.id !== "all" && count === 0;
              return (
                <button
                  key={f.id}
                  className={`pp-pill${filter === f.id ? " pp-pill-primary active" : ""}`}
                  onClick={() => { setFilter(f.id); setSelectedId(null); }}
                  style={isZero && filter !== f.id ? { opacity: 0.45 } : {}}
                >
                  <span className="pp-pill-label">{f.label}</span>
                  {f.id !== "all" && <span className="pp-pill-count">{count || 0}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══ Split panel ═══ */}
        <div className={`pp-adm-split${mobileDetail ? " pp-adm-split--detail-open" : ""}`}>
          {/* Left: scrollable list */}
          <div className="pp-adm-list-col">
            {filtered.length === 0 && (
              <div className="pp-adm-list-empty">
                <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                <p style={{ color: "#94a3b8", fontWeight: 600 }}>No items match this filter.</p>
              </div>
            )}
            {filtered.map((item) => {
              const isActive = selectedId === item.id;
              const isNH = item.module === "newhire";
              const isRejected = /Rejected|Action/i.test(item.status);
              const borderCls = getBorderClass(item.status);

              return (
                <div
                  key={item.id}
                  className={`pp-adm-list-item ${borderCls}${isActive ? " active" : ""}`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setMobileDetail(true);
                  }}
                >
                  <div className={`pp-adm-list-avatar ${isRejected ? "rejected" : isNH ? "nh" : "paf"}`}>
                    {isNH ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                    )}
                  </div>
                  <div className="pp-adm-list-info">
                    <div className="pp-adm-list-name">{item.title}</div>
                    <div className="pp-adm-list-sub">{Formatter.toTitleCase(item.subtitle)}</div>
                  </div>
                  <div className="pp-adm-list-right">
                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {Formatter.toDate(item.date)}
                    </div>
                    {isRejected && (
                      <div style={{ fontSize: 9, fontWeight: 800, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, padding: "1px 5px", marginTop: 2 }}>ACTION</div>
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

      {/* ═══ Confirm Modal (Withdraw + Cancel) ═══ */}
      {confirmModal && modalConfig && (
        <div className="pp-modal-overlay" onClick={() => !processing && setConfirmModal(null)}>
          <div className="pp-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, textAlign: "center", padding: "32px 28px" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: confirmModal.type === "cancel" ? "#fef2f2" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: confirmModal.type === "cancel" ? 20 : 24 }}>
              {confirmModal.type === "cancel" ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ) : (
                "🗑️"
              )}
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#0f3057" }}>
              {modalConfig.title}
            </h3>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
              <strong>{confirmModal.item.title}</strong> ({Formatter.toTitleCase(confirmModal.item.subtitle)}) {modalConfig.description}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="pp-btn"
                style={{
                  flex: 1,
                  background: "white",
                  color: "#475569",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 50,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                onClick={() => setConfirmModal(null)}
                disabled={processing}
              >
                Go Back
              </button>
              <button
                className="pp-btn"
                style={{
                  flex: 1,
                  background: modalConfig.confirmBg,
                  color: "white",
                  border: "none",
                  borderRadius: 50,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: processing ? "wait" : "pointer",
                  opacity: processing ? 0.7 : 1,
                }}
                onClick={handleConfirmAction}
                disabled={processing}
              >
                {processing ? "Processing..." : modalConfig.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}