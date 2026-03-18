"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "newhire", label: "New Hires" },
  { id: "paf", label: "PAFs" },
];

export default function AdminQueue({ bootstrapData, Formatter, showToast, openConfirm }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [undoItem, setUndoItem] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const undoTimerRef = useRef(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/people?action=admin-queue`);
      const data = await res.json();
      if (data.success) setQueue(data.queue);
    } catch (e) {
      showToast("Failed to load queue", "error");
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // Filter logic
  const filtered = queue.filter((item) => {
    if (filter !== "all" && item.type !== filter) return false;
    if (locFilter !== "all" && !item.location.includes(locFilter)) return false;
    return true;
  });

  // Unique locations for dropdown
  const locations = [...new Set(queue.map((q) => q.location))].sort();

  // ── Approve with undo ──
  const handleApprove = (item) => {
    setUndoItem({ ...item, action: "approve" });
    // Remove from visible queue
    setQueue((prev) => prev.filter((q) => q.id !== item.id));

    // Start 3.5s timer
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      commitAction(item.id, "approve", "");
      setUndoItem(null);
    }, 3500);
  };

  // ── Undo ──
  const handleUndo = () => {
    if (!undoItem) return;
    clearTimeout(undoTimerRef.current);
    setQueue((prev) => [...prev, undoItem].sort((a, b) => new Date(a.date) - new Date(b.date)));
    setUndoItem(null);
    showToast("↩ Action undone", "info");
  };

  // ── Reject ──
  const handleReject = (item) => {
    setRejectTarget(item);
    setRejectReason("");
  };

  const confirmReject = () => {
    if (!rejectTarget) return;
    commitAction(rejectTarget.id, "reject", rejectReason);
    setQueue((prev) => prev.filter((q) => q.id !== rejectTarget.id));
    setRejectTarget(null);
    setRejectReason("");
  };

  // ── Commit to server ──
  const commitAction = async (itemId, adminAction, reason) => {
    try {
      await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin-process",
          itemId,
          adminAction,
          reason,
          adminEmail: bootstrapData.userEmail,
        }),
      });
      showToast(adminAction === "approve" ? "✅ Approved" : "❌ Rejected", adminAction === "approve" ? "success" : "error");
    } catch (e) {
      showToast("Error processing: " + e.message, "error");
    }
  };

  // Parse details
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

  const progress = queue.length > 0 ? ((queue.length - filtered.length) / queue.length) * 100 : 100;

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-master-card" style={{ borderTop: "6px solid #7c3aed" }}>
        {/* Workload bar */}
        <div className="pp-workload-bar">
          <div className="pp-workload-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="pp-master-header" style={{ display: "block" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <h3 className="pp-card-title" style={{ margin: 0, fontSize: 18 }}>Approvals Queue</h3>
              <p className="pp-card-desc" style={{ margin: 0, fontSize: 12 }}>
                {loading ? "Syncing..." : `${filtered.length} item${filtered.length !== 1 ? "s" : ""} pending`}
              </p>
            </div>
            <button className="pp-btn pp-btn--ghost" onClick={loadQueue} style={{ padding: "6px 16px", height: 32, fontSize: 12 }}>
              Refresh ↻
            </button>
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

        {/* Undo banner */}
        {undoItem && (
          <div className="pp-undo-row">
            <div className="pp-undo-content">
              <span style={{ fontSize: 13, fontWeight: 600 }}>✅ Approved: {undoItem.title}</span>
              <button className="pp-btn-undo-action" onClick={handleUndo}>↩ UNDO</button>
            </div>
            <div className="pp-undo-timer" style={{ animation: "pp-shrink 3.5s linear forwards" }} />
          </div>
        )}

        {/* Queue items */}
        <div className="pp-admin-queue">
          {loading && (
            <div className="pp-empty-state"><p style={{ color: "#94a3b8" }}>Loading queue...</p></div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="pp-empty-state">
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
              <p style={{ color: "#94a3b8", fontWeight: 600 }}>Queue is empty. Nice work!</p>
            </div>
          )}
          {filtered.map((item) => {
            const metric = getMetric(item);
            const isNH = item.type === "newhire";
            return (
              <div key={item.id} className="pp-list-row pp-row-pending">
                {/* Avatar */}
                <div className="pp-avatar">
                  {isNH ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0f3057" }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{item.subtitle}</div>
                </div>

                {/* Location badge */}
                <div className="pp-badge-loc">
                  <span className="pp-badge-key">{item.location.split(" - ")[0]}</span>
                </div>

                {/* Metric */}
                {metric && (
                  <div className="pp-metric-primary">{metric}</div>
                )}

                {/* Action buttons */}
                <div className="pp-hover-actions">
                  <button className="pp-btn-icon pp-btn-icon-approve" onClick={(e) => { e.stopPropagation(); handleApprove(item); }} title="Approve">✓</button>
                  <button className="pp-btn-icon pp-btn-icon-reject" onClick={(e) => { e.stopPropagation(); handleReject(item); }} title="Reject">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reject modal */}
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
              <textarea className="pp-textarea" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Please specify what needs to be corrected..." />
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn pp-btn--ghost" onClick={() => setRejectTarget(null)}>Cancel</button>
              <button className="pp-btn" style={{ background: "#dc2626", color: "white" }} onClick={confirmReject}>Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}