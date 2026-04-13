"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";

const INVOICE_ADMIN_USERS = [
  "k.fietek@kitchfix.com",
  "a.wasserman@kitchfix.com",
  "britt@kitchfix.com",
  "joe@kitchfix.com",
  "josh@kitchfix.com",
  "s.lynch@kitchfix.com",
  "s.castro@kitchfix.com",
];

const fmt$ = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REASON_CHIPS = ["Invoice #", "Date", "Total", "GL codes", "Wrong vendor", "Bad scan"];

export function isInvoiceAdmin(email) {
  return INVOICE_ADMIN_USERS.includes(email?.toLowerCase());
}

export default function InvoiceAdmin({ config, showToast }) {
  const userEmail = config?.userEmail || "";
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | returned
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("week");

  // Reject dialog state
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReasons, setRejectReasons] = useState([]);
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // Load all submissions
  const loadSubmissions = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops?action=invoice-admin-list&period=${period}`);
      const data = await res.json();
      if (data.success) setSubmissions(data.submissions || []);
    } catch (err) {
      console.error("[InvoiceAdmin] Load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  // Stats
  const stats = useMemo(() => {
    const sent = submissions.filter((s) => s.status === "sent" || s.status === "pending").length;
    const returned = submissions.filter((s) => s.status === "returned").length;
    const corrected = submissions.filter((s) => s.status === "corrected").length;
    const total = submissions.reduce((sum, s) => sum + Math.abs(s.totalAmount), 0);
    return { sent, returned, corrected, total };
  }, [submissions]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = submissions;
    if (filter === "returned") list = list.filter((s) => s.status === "returned");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        s.vendor?.toLowerCase().includes(q) ||
        s.invoiceNumber?.toLowerCase().includes(q) ||
        s.account?.toLowerCase().includes(q) ||
        s.userEmail?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [submissions, filter, search]);

  // Handle reject submission
  const handleReject = useCallback(async () => {
    if (!rejectTarget || !rejectNote.trim()) {
      showToast("Please add a note explaining what needs to be fixed", "error");
      return;
    }
    setRejecting(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invoice-reject",
          uuid: rejectTarget.uuid,
          reasons: rejectReasons,
          note: rejectNote.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Returned to ${rejectTarget.userEmail}`, "success");
        setRejectTarget(null);
        setRejectReasons([]);
        setRejectNote("");
        loadSubmissions();
      } else {
        showToast(data.error || "Failed to return invoice", "error");
      }
    } catch {
      showToast("Network error — try again", "error");
    } finally {
      setRejecting(false);
    }
  }, [rejectTarget, rejectReasons, rejectNote, showToast, loadSubmissions]);

  function toggleReason(r) {
    setRejectReasons((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  }

  function getStatusBadge(s) {
    if (s.status === "returned") return <span className="oh-inv-adm-badge oh-inv-adm-badge--returned">Returned</span>;
    if (s.status === "corrected") return <span className="oh-inv-adm-badge oh-inv-adm-badge--corrected">Corrected</span>;
    return <span className="oh-inv-adm-badge oh-inv-adm-badge--sent">Sent</span>;
  }

  function formatDate(d) {
    if (!d) return "—";
    try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
    catch { return d; }
  }

  function formatTimestamp(ts) {
    if (!ts) return "";
    try { return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
    catch { return ""; }
  }

  if (loading) {
    return (
      <div className="oh-inv-adm-card">
        <div className="oh-inv-adm-header">
          <div><div className="oh-inv-adm-title">Invoice review — AP</div></div>
        </div>
        <div className="oh-inv-adm-loading">
          <div className="oh-spinner-sm" style={{ width: 20, height: 20 }} />
          Loading submissions...
        </div>
      </div>
    );
  }

  return (
    <div className="oh-inv-adm-card">
      {/* Header */}
      <div className="oh-inv-adm-header">
        <div>
          <div className="oh-inv-adm-title">Invoice review — AP</div>
          <div className="oh-inv-adm-subtitle">Review and return submissions to operators</div>
        </div>
        <div className="oh-inv-adm-header-actions">
          <select
            className="oh-inv-adm-period-select"
            value={period}
            onChange={(e) => { setPeriod(e.target.value); setLoading(true); }}
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="oh-inv-adm-stats">
        <div className="oh-inv-adm-stat">
          <div className="oh-inv-adm-stat-label">Sent</div>
          <div className="oh-inv-adm-stat-value">{stats.sent}</div>
        </div>
        <div className="oh-inv-adm-stat">
          <div className="oh-inv-adm-stat-label">Returned</div>
          <div className="oh-inv-adm-stat-value oh-inv-adm-stat-value--red">{stats.returned}</div>
        </div>
        <div className="oh-inv-adm-stat">
          <div className="oh-inv-adm-stat-label">Corrected</div>
          <div className="oh-inv-adm-stat-value oh-inv-adm-stat-value--green">{stats.corrected}</div>
        </div>
        <div className="oh-inv-adm-stat">
          <div className="oh-inv-adm-stat-label">Period total</div>
          <div className="oh-inv-adm-stat-value">${stats.total >= 1000 ? `${(stats.total / 1000).toFixed(1)}k` : fmt$(stats.total)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="oh-inv-adm-filters">
        <div className="oh-inv-adm-pills">
          <button className={`oh-inv-adm-pill${filter === "all" ? " oh-inv-adm-pill--active" : ""}`} onClick={() => setFilter("all")}>All ({submissions.length})</button>
          <button className={`oh-inv-adm-pill${filter === "returned" ? " oh-inv-adm-pill--active" : ""}`} onClick={() => setFilter("returned")}>Returned ({stats.returned})</button>
        </div>
        <div className="oh-inv-adm-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" className="oh-inv-adm-search-icon"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="text" className="oh-inv-adm-search" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* List */}
      <div className="oh-inv-adm-list">
        {filtered.length === 0 ? (
          <div className="oh-inv-adm-empty">No submissions match your filters</div>
        ) : (
          filtered.map((s) => (
            <div key={s.uuid} className={`oh-inv-adm-row${s.status === "returned" ? " oh-inv-adm-row--returned" : ""}`}>
              <div className="oh-inv-adm-row-dot" style={{ background: s.status === "returned" ? "#ef4444" : s.status === "corrected" ? "#10b981" : "#3b82f6" }} />
              <div className="oh-inv-adm-row-body">
                <div className="oh-inv-adm-row-top">
                  <span className="oh-inv-adm-row-vendor">{s.vendor}</span>
                  <span className="oh-inv-adm-row-inv">#{s.invoiceNumber}</span>
                  <span className="oh-inv-adm-row-acct">{s.account}</span>
                  {getStatusBadge(s)}
                </div>
                <div className="oh-inv-adm-row-meta">
                  {s.userEmail?.split("@")[0]} · {formatDate(s.invoiceDate)} · {s.pageCount} page{s.pageCount !== 1 ? "s" : ""}
                  {s.glBreakdown ? (() => {
                    try { return " · " + JSON.parse(s.glBreakdown).map((g) => g.code).join(", "); } catch { return ""; }
                  })() : ""}
                </div>
                {s.status === "returned" && s.rejectionNote && (
                  <div className="oh-inv-adm-row-rejection">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    {s.rejectionNote}
                  </div>
                )}
              </div>
              <div className="oh-inv-adm-row-amount">${fmt$(Math.abs(s.totalAmount))}</div>
              <div className="oh-inv-adm-row-actions">
                {s.rawDriveUrl && (
                  <a href={s.rawDriveUrl} target="_blank" rel="noopener noreferrer" className="oh-inv-adm-action-btn" title="View raw PDF">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  </a>
                )}
                {s.driveUrls && (
                  <a href={(() => { try { const urls = JSON.parse(s.driveUrls); return urls[0] || "#"; } catch { return s.driveUrls; } })()} target="_blank" rel="noopener noreferrer" className="oh-inv-adm-action-btn" title="View stamped PDF">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  </a>
                )}
                {s.status !== "returned" && (
                  <button className="oh-inv-adm-action-btn oh-inv-adm-action-btn--reject" title="Return to operator" onClick={() => { setRejectTarget(s); setRejectReasons([]); setRejectNote(""); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Reject Dialog */}
      {rejectTarget && (
        <div className="oh-inv-adm-reject-overlay" onClick={() => { if (!rejecting) setRejectTarget(null); }}>
          <div className="oh-inv-adm-reject-modal" onClick={(e) => e.stopPropagation()}>
            <div className="oh-inv-adm-reject-header">Return to operator</div>
            <div className="oh-inv-adm-reject-body">
              <div className="oh-inv-adm-reject-invoice">
                <div className="oh-inv-adm-reject-invoice-name">{rejectTarget.vendor} #{rejectTarget.invoiceNumber}</div>
                <div className="oh-inv-adm-reject-invoice-meta">{rejectTarget.userEmail?.split("@")[0]} · {rejectTarget.account} · ${fmt$(Math.abs(rejectTarget.totalAmount))}</div>
              </div>
              <div className="oh-inv-adm-reject-field">
                <label>What needs to be fixed?</label>
                <div className="oh-inv-adm-reject-chips">
                  {REASON_CHIPS.map((r) => (
                    <button
                      key={r}
                      className={`oh-inv-adm-reject-chip${rejectReasons.includes(r) ? " oh-inv-adm-reject-chip--active" : ""}`}
                      onClick={() => toggleReason(r)}
                    >{r}</button>
                  ))}
                </div>
              </div>
              <div className="oh-inv-adm-reject-field">
                <label>Note to operator <span style={{ color: "#ef4444" }}>*</span></label>
                <textarea
                  className="oh-inv-adm-reject-textarea"
                  placeholder="e.g. Invoice number should be 56412350, not 56412530"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <div className="oh-inv-adm-reject-footer">
              <button className="oh-inv-adm-reject-cancel" onClick={() => setRejectTarget(null)} disabled={rejecting}>Cancel</button>
              <button className="oh-inv-adm-reject-submit" onClick={handleReject} disabled={rejecting || !rejectNote.trim()}>
                {rejecting ? <><div className="oh-spinner-sm" style={{ width: 14, height: 14 }} />Returning...</> : "Return to operator"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}