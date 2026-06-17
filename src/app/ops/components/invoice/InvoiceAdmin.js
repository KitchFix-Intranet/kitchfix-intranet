"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { formatCompactDollar } from "@/lib/opsUtils";

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
const REASON_CHIPS = ["Invoice #", "Date", "Total", "GL codes", "Wrong vendor", "Bad scan", "Duplicate"];

export function isInvoiceAdmin(email) {
  return INVOICE_ADMIN_USERS.includes(email?.toLowerCase());
}

export default function InvoiceAdmin({ config, showToast, onStatsReady }) {
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("week");
  const [statusFilter, setStatusFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("__all__");
  const [search, setSearch] = useState("");
  const [expandedUuid, setExpandedUuid] = useState(null);
  const [visibleCount, setVisibleCount] = useState(20);

  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReasons, setRejectReasons] = useState([]);
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);

  // Load ALL submissions once, filter client-side for period (no reload flicker)
  const loadSubmissions = useCallback(async () => {
    try {
      const res = await fetch("/api/ops?action=invoice-admin-list&period=all");
      const data = await res.json();
      if (data.success) setAllSubmissions(data.submissions || []);
    } catch (err) { console.error("[InvoiceAdmin] Load failed:", err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  // Client-side period filter
  const submissions = useMemo(() => {
    if (period === "all") return allSubmissions;
    const cutoff = new Date(Date.now() - (period === "month" ? 30 : 7) * 86400000);
    return allSubmissions.filter((s) => new Date(s.timestamp) >= cutoff);
  }, [allSubmissions, period]);

  const accountOptions = useMemo(() => {
    return [...new Set(submissions.map((s) => s.account).filter(Boolean))].sort();
  }, [submissions]);

  // Duplicate detection — respects persistent dupeOverride, excludes corrected/resubmit pairs
  const duplicateSet = useMemo(() => {
    const counts = {};
    for (const s of submissions) {
      if (!s.invoiceNumber || s.dupeOverride === "not_duplicate") continue;
      if (s.status === "corrected" || s.correctedFromUuid) continue;
      const key = `${s.vendor}||${s.invoiceNumber}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    const dupes = new Set();
    for (const s of submissions) {
      if (!s.invoiceNumber || s.dupeOverride === "not_duplicate") continue;
      if (s.status === "corrected" || s.correctedFromUuid) continue;
      if (counts[`${s.vendor}||${s.invoiceNumber}`] > 1) dupes.add(s.uuid);
    }
    return dupes;
  }, [submissions]);

  // Report actionable count to parent for tab badge (dupes needing review)
  useEffect(() => {
    if (!onStatsReady || allSubmissions.length === 0) return;
    const dupeCount = allSubmissions.filter((s) => duplicateSet.has(s.uuid)).length;
    onStatsReady({ actionable: dupeCount });
  }, [allSubmissions, onStatsReady, duplicateSet]);

  const accountScoped = useMemo(() => {
    return accountFilter === "__all__" ? submissions : submissions.filter((s) => s.account === accountFilter);
  }, [submissions, accountFilter]);

  const stats = useMemo(() => {
    const sent = accountScoped.filter((s) => s.status === "sent" || s.status === "pending").length;
    const returned = accountScoped.filter((s) => s.status === "returned").length;
    const corrected = accountScoped.filter((s) => s.status === "corrected").length;
    const archived = accountScoped.filter((s) => s.status === "archived").length;
    const total = accountScoped.reduce((sum, s) => sum + Math.abs(s.totalAmount), 0);
    const dupes = accountScoped.filter((s) => duplicateSet.has(s.uuid)).length;
    return { sent, returned, corrected, archived, total, count: accountScoped.length, dupes };
  }, [accountScoped, duplicateSet]);

  const filtered = useMemo(() => {
    let list = accountScoped;
    // Archived always hidden from default views; user must explicitly select
    // the Archived pill to see them.
    if (statusFilter !== "archived") list = list.filter((s) => s.status !== "archived");
    if (statusFilter === "returned") list = list.filter((s) => s.status === "returned");
    else if (statusFilter === "corrected") list = list.filter((s) => s.status === "corrected");
    else if (statusFilter === "archived") list = list.filter((s) => s.status === "archived");
    else if (statusFilter === "dupes") list = list.filter((s) => duplicateSet.has(s.uuid));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        s.vendor?.toLowerCase().includes(q) || s.invoiceNumber?.toLowerCase().includes(q) ||
        s.account?.toLowerCase().includes(q) || s.userEmail?.toLowerCase().includes(q)
      );
    }
    // Returned always on top
    list = [...list].sort((a, b) => (a.status === "returned" ? 0 : 1) - (b.status === "returned" ? 0 : 1));
    return list;
  }, [accountScoped, statusFilter, search, duplicateSet]);

  // Reset pagination on filter change
  useEffect(() => { setVisibleCount(20); }, [period, statusFilter, accountFilter, search]);

  const handleReject = useCallback(async () => {
    if (!rejectTarget || !rejectNote.trim()) { showToast("Please add a note explaining what needs to be fixed", "error"); return; }
    setRejecting(true);
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-reject", uuid: rejectTarget.uuid, reasons: rejectReasons, note: rejectNote.trim() }) });
      const data = await res.json();
      if (data.success) {
        showToast(`Returned to ${rejectTarget.userEmail?.split("@")[0]}`, "success");
        setRejectTarget(null); setRejectReasons([]); setRejectNote(""); setExpandedUuid(null);
        loadSubmissions();
      } else { showToast(data.error || "Failed to return invoice", "error"); }
    } catch { showToast("Network error — try again", "error"); }
    finally { setRejecting(false); }
  }, [rejectTarget, rejectReasons, rejectNote, showToast, loadSubmissions]);

  const handleUnreject = useCallback(async (s) => {
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-unreject", uuid: s.uuid }) });
      const data = await res.json();
      if (data.success) {
        showToast(`Return undone for ${s.vendor} #${s.invoiceNumber}`, "success");
        setExpandedUuid(null);
        loadSubmissions();
      } else { showToast(data.error || "Failed to undo return", "error"); }
    } catch { showToast("Network error — try again", "error"); }
  }, [showToast, loadSubmissions]);

  const handleDismissDupe = useCallback(async (s) => {
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-dismiss-dupe", uuid: s.uuid }) });
      const data = await res.json();
      if (data.success) {
        showToast("Duplicate flag dismissed", "success");
        loadSubmissions();
      } else { showToast(data.error || "Failed to dismiss", "error"); }
    } catch { showToast("Network error", "error"); }
  }, [showToast, loadSubmissions]);

  const handleDeleteDupe = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-delete-dupe", uuid: deleteTarget.uuid, vendor: deleteTarget.vendor, invoiceNumber: deleteTarget.invoiceNumber, totalAmount: deleteTarget.totalAmount }) });
      const data = await res.json();
      if (data.success) {
        showToast(`Deleted duplicate: ${deleteTarget.vendor} #${deleteTarget.invoiceNumber}`, "success");
        setDeleteTarget(null); setExpandedUuid(null);
        loadSubmissions();
      } else { showToast(data.error || "Failed to delete", "error"); }
    } catch { showToast("Network error — try again", "error"); }
    finally { setDeleting(false); }
  }, [deleteTarget, showToast, loadSubmissions]);

  const handleArchive = useCallback((submission) => {
    setArchiveTarget(submission);
  }, []);

  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    const uuid = archiveTarget.uuid;
    setArchiving(true);
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-archive", uuid }) });
      const data = await res.json();
      if (data.success) {
        showToast("Invoice archived", "success");
        setAllSubmissions((prev) => prev.map((s) => s.uuid === uuid ? { ...s, status: "archived" } : s));
        setArchiveTarget(null);
      } else { showToast(data.error || "Failed to archive", "error"); }
    } catch { showToast("Network error — try again", "error"); }
    finally { setArchiving(false); }
  }, [archiveTarget, showToast]);

  const handleUnarchive = useCallback(async (uuid) => {
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-unarchive", uuid }) });
      const data = await res.json();
      if (data.success) {
        showToast("Invoice restored from archive", "success");
        setAllSubmissions((prev) => prev.map((s) => s.uuid === uuid ? { ...s, status: "sent" } : s));
      } else { showToast(data.error || "Failed to restore", "error"); }
    } catch { showToast("Network error — try again", "error"); }
  }, [showToast]);

  function toggleReason(r) { setRejectReasons((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]); }

  function formatDate(d) {
    if (!d) return "—";
    try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return d; }
  }

  function formatTimestamp(ts) {
    if (!ts) return "";
    try { return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; }
  }

  const periodLabel = period === "month" ? "30 days" : period === "week" ? "7 days" : "all time";

  if (loading) {
    return <div className="oh-inv-history-panel" style={{ padding: "40px 24px" }}><div className="oh-inv-loading-pill"><div className="oh-spinner-sm" style={{ width: 14, height: 14 }} /> Loading submissions...</div></div>;
  }

  return (
    <div className="oh-inv-history-panel">
      <div className="oh-inv-hist-acct-bar">
        <label className="oh-inv-hist-acct-label">Account</label>
        <select className="oh-inv-hist-acct-select" value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setExpandedUuid(null); }}>
          <option value="__all__">All Accounts</option>
          {accountOptions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="oh-inv-history-controls">
        <div className="oh-inv-history-search-wrap">
          <svg className="oh-inv-history-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="text" className="oh-inv-history-search" placeholder="Search vendor, invoice #, user..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="oh-inv-history-search-clear" onClick={() => setSearch("")}>×</button>}
        </div>
        <div className="oh-inv-history-periods">
          {[["week","7 Days"],["month","30 Days"],["all","All Time"]].map(([val, label]) => (
            <button key={val} className={`oh-inv-period-pill${period === val ? " oh-inv-period-pill--active" : ""}`}
              onClick={() => setPeriod(val)}>{label}</button>
          ))}
          <span className="oh-inv-pill-divider" />
          <button className={`oh-inv-period-pill${statusFilter === "all" ? " oh-inv-period-pill--active" : ""}`} onClick={() => setStatusFilter("all")}>All</button>
          <button className={`oh-inv-period-pill${statusFilter === "returned" ? " oh-inv-period-pill--active" : ""}`}
            style={statusFilter !== "returned" && stats.returned > 0 ? { borderColor: "#fca5a5", color: "#991b1b" } : {}}
            onClick={() => setStatusFilter("returned")}>Returned{stats.returned > 0 ? ` (${stats.returned})` : ""}</button>
          <button className={`oh-inv-period-pill${statusFilter === "corrected" ? " oh-inv-period-pill--active" : ""}`} onClick={() => setStatusFilter("corrected")}>Corrected</button>
          <button className={`oh-inv-period-pill${statusFilter === "archived" ? " oh-inv-period-pill--active" : ""}`}
            style={statusFilter !== "archived" ? { borderColor: "#cbd5e1", color: "#64748b" } : {}}
            onClick={() => setStatusFilter("archived")}>Archived{stats.archived > 0 ? ` (${stats.archived})` : ""}</button>
          {stats.dupes > 0 && (
            <button className={`oh-inv-period-pill${statusFilter === "dupes" ? " oh-inv-period-pill--active" : ""}`}
              style={statusFilter !== "dupes" ? { borderColor: "#fde68a", color: "#92400e", background: "#fffbeb" } : {}}
              onClick={() => setStatusFilter("dupes")}>Dupes ({stats.dupes})</button>
          )}
        </div>
        <div className="oh-inv-history-periods-mobile">
          <select className="oh-inv-history-period-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="week">7 Days</option>
            <option value="month">30 Days</option>
            <option value="all">All Time</option>
          </select>
          <select className="oh-inv-history-period-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="returned">Returned{stats.returned > 0 ? ` (${stats.returned})` : ""}</option>
            <option value="corrected">Corrected</option>
            <option value="archived">Archived{stats.archived > 0 ? ` (${stats.archived})` : ""}</option>
            {stats.dupes > 0 && <option value="dupes">Dupes ({stats.dupes})</option>}
          </select>
        </div>
      </div>

      <div className="oh-inv-weekly-summary oh-inv-weekly-summary--admin">
        <strong>{stats.sent}</strong><span>sent</span><span>·</span>
        <strong className={stats.returned > 0 ? "oh-inv-stat--returned" : ""}>{stats.returned}</strong><span>returned</span><span>·</span>
        <strong className={stats.corrected > 0 ? "oh-inv-stat--corrected" : ""}>{stats.corrected}</strong><span>corrected</span><span>·</span>
        <strong>{formatCompactDollar(stats.total)}</strong>
      </div>

      {filtered.length === 0 ? (
        <div className="oh-inv-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <p className="oh-inv-empty-title">No submissions found</p>
          <p className="oh-inv-empty-desc">{statusFilter !== "all" ? `No ${statusFilter} invoices in ${periodLabel}.` : `No submissions in ${periodLabel}.`} Try a different filter or time period.</p>
        </div>
      ) : (
        <div className="oh-inv-history-list">
          {filtered.slice(0, visibleCount).map((s) => {
            const isExpanded = expandedUuid === s.uuid;
            const isDupe = duplicateSet.has(s.uuid);
            let glRows = []; try { glRows = JSON.parse(s.glBreakdown || "[]"); } catch {}
            const driveUrls = (() => { try { return JSON.parse(s.driveUrls || "[]"); } catch { return []; } })();
            const statusLabel = s.status === "returned" ? "Returned" : s.status === "corrected" ? "Corrected" : s.status === "archived" ? "Archived" : "Sent";
            const statusColor = s.status === "returned" ? { bg: "#fef2f2", color: "#991b1b" } : s.status === "corrected" ? { bg: "#ecfdf5", color: "#065f46" } : s.status === "archived" ? { bg: "#f1f5f9", color: "#64748b" } : { bg: "#eff6ff", color: "#1e40af" };

            return (
              <div key={s.uuid} className={`oh-inv-history-row oh-inv-hist-row--expandable${isExpanded ? " oh-inv-hist-row--open" : ""}${s.status === "returned" ? " oh-inv-hist-row--returned" : ""}${isDupe ? " oh-inv-adm-row--dupe" : ""}`}>
                <div className="oh-inv-hist-summary" role="button" tabIndex={0} aria-expanded={isExpanded}
                  onClick={() => setExpandedUuid(isExpanded ? null : s.uuid)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedUuid(isExpanded ? null : s.uuid); } }}>
                  <div className="oh-inv-history-left">
                    <span className="oh-inv-history-vendor" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {s.vendor}
                      <span className="oh-inv-hist-status" style={{ background: statusColor.bg, color: statusColor.color }}>{statusLabel}</span>
                      {isDupe && <span className="oh-inv-hist-dupe-badge">Dupe?</span>}
                    </span>
                    <span className="oh-inv-history-meta">#{s.invoiceNumber || "—"} · {formatDate(s.invoiceDate)} · {s.pageCount} pg · {s.account} · {s.userEmail?.split("@")[0]}</span>
                  </div>
                  <div className="oh-inv-history-right">
                    <span className={`oh-inv-history-amount${Number(s.totalAmount) < 0 ? " oh-inv-credit" : ""}`}>{Number(s.totalAmount) < 0 ? "−" : ""}${fmt$(Math.abs(Number(s.totalAmount)))}</span>
                    <svg className={`oh-inv-hist-chevron${isExpanded ? " oh-inv-hist-chevron--open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="oh-inv-hist-detail">
                    {s.status === "returned" && s.rejectionNote && (
                      <div className="oh-inv-hist-reject-banner">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, marginBottom: 2 }}>Returned: {s.rejectionNote}</div>
                          {s.rejectionReason && <div style={{ fontSize: 10, color: "#92400e" }}>Reason: {s.rejectionReason}</div>}
                          <div style={{ fontSize: 10, color: "#92400e" }}>By {s.rejectedBy?.split("@")[0] || "AP"}{s.rejectedAt ? ` · ${formatTimestamp(s.rejectedAt)}` : ""}</div>
                        </div>
                        <button className="oh-inv-hist-undo-btn" onClick={(e) => { e.stopPropagation(); handleUnreject(s); }}>
                          Undo Return
                        </button>
                      </div>
                    )}

                    <div className="oh-inv-hist-info-grid">
                      <div className="oh-inv-hist-info-item"><span className="oh-inv-hist-info-label">Submitted</span><span className="oh-inv-hist-info-value">{formatTimestamp(s.timestamp)}</span></div>
                      <div className="oh-inv-hist-info-item"><span className="oh-inv-hist-info-label">By</span><span className="oh-inv-hist-info-value">{s.userEmail || "—"}</span></div>
                      <div className="oh-inv-hist-info-item"><span className="oh-inv-hist-info-label">Invoice Date</span><span className="oh-inv-hist-info-value">{formatDate(s.invoiceDate)}</span></div>
                      <div className="oh-inv-hist-info-item"><span className="oh-inv-hist-info-label">Type</span><span className="oh-inv-hist-info-value">{s.type === "credit" ? "Credit Memo" : "Invoice"}</span></div>
                    </div>

                    {glRows.length > 0 && (
                      <div className="oh-inv-hist-gl">
                        <div className="oh-inv-hist-gl-title">GL Breakdown</div>
                        {glRows.filter((g) => g.code && Number(g.amount) > 0).map((g, i) => (
                          <div key={i} className="oh-inv-hist-gl-row">
                            <span><span className="oh-inv-gl-code-tag">{g.code}</span> {g.name || g.code}</span>
                            <span className="oh-inv-hist-gl-amt">${fmt$(Number(g.amount))}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="oh-inv-hist-actions">
                      {driveUrls.length > 0 && <a href={typeof driveUrls[0] === "string" ? driveUrls[0] : "#"} target="_blank" rel="noopener noreferrer" className="oh-inv-hist-action-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>Stamped PDF</a>}
                      {s.rawDriveUrl && <a href={s.rawDriveUrl} target="_blank" rel="noopener noreferrer" className="oh-inv-hist-action-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>Raw PDF</a>}
                      {s.status !== "returned" && (
                        <button className="oh-inv-hist-action-btn oh-inv-hist-action-btn--fix" onClick={(e) => { e.stopPropagation(); setRejectTarget(s); setRejectReasons([]); setRejectNote(""); }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>Return to Operator
                        </button>
                      )}
                      {isDupe && (
                        <button className="oh-inv-hist-action-btn" onClick={(e) => { e.stopPropagation(); handleDismissDupe(s); }}
                          style={{ borderColor: "#fde68a", color: "#92400e" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>Not a Duplicate
                        </button>
                      )}
                      {isDupe && (
                        <button className="oh-inv-hist-action-btn oh-inv-hist-action-btn--delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>Delete Duplicate
                        </button>
                      )}
                      {s.status !== "archived" && (
                        <button className="oh-inv-hist-action-btn oh-inv-hist-action-btn--archive" onClick={(e) => { e.stopPropagation(); handleArchive(s); }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>Archive
                        </button>
                      )}
                      {s.status === "archived" && (
                        <button className="oh-inv-hist-action-btn" onClick={(e) => { e.stopPropagation(); handleUnarchive(s.uuid); }}>
                          Restore from Archive
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length > 0 && (
            <>
            <div className="oh-inv-history-footer">
              Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} submission{filtered.length !== 1 ? "s" : ""}{search || statusFilter !== "all" ? " (filtered)" : ""}
            </div>
            {visibleCount < filtered.length && (
              <button className="oh-inv-hist-show-more" onClick={() => setVisibleCount((c) => c + 20)}>
                Show more ({filtered.length - visibleCount} remaining)
              </button>
            )}
            </>
          )}
        </div>
      )}

      {rejectTarget && (
        <div className="oh-inv-adm-reject-overlay" onClick={() => { if (!rejecting) setRejectTarget(null); }}>
          <div className="oh-inv-adm-reject-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="oh-inv-adm-reject-header">Return to operator</div>
            <div className="oh-inv-adm-reject-body">
              <div className="oh-inv-adm-reject-invoice">
                <div className="oh-inv-adm-reject-invoice-name">{rejectTarget.vendor} #{rejectTarget.invoiceNumber}</div>
                <div className="oh-inv-adm-reject-invoice-meta">{rejectTarget.userEmail?.split("@")[0]} · {rejectTarget.account} · ${fmt$(Math.abs(rejectTarget.totalAmount))}</div>
              </div>
              <div className="oh-inv-adm-reject-field">
                <label>What needs to be fixed?</label>
                <div className="oh-inv-adm-reject-chips">
                  {REASON_CHIPS.map((r) => <button key={r} className={`oh-inv-adm-reject-chip${rejectReasons.includes(r) ? " oh-inv-adm-reject-chip--active" : ""}`} onClick={() => toggleReason(r)}>{r}</button>)}
                </div>
              </div>
              <div className="oh-inv-adm-reject-field">
                <label>Note to operator <span style={{ color: "#ef4444" }}>*</span></label>
                <textarea className="oh-inv-adm-reject-textarea" placeholder="e.g. Invoice number should be 56412350, not 56412530" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} />
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

      {deleteTarget && (
        <div className="oh-inv-adm-reject-overlay" onClick={() => { if (!deleting) setDeleteTarget(null); }}>
          <div className="oh-inv-adm-reject-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="oh-inv-adm-reject-header" style={{ color: "#991b1b" }}>Delete Duplicate</div>
            <div className="oh-inv-adm-reject-body">
              <div className="oh-inv-adm-reject-invoice">
                <div className="oh-inv-adm-reject-invoice-name">{deleteTarget.vendor} #{deleteTarget.invoiceNumber}</div>
                <div className="oh-inv-adm-reject-invoice-meta">{deleteTarget.userEmail?.split("@")[0]} · {deleteTarget.account} · ${fmt$(Math.abs(deleteTarget.totalAmount))}</div>
              </div>
              <div className="oh-inv-adm-delete-warn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                <span>This permanently deletes the submission from the sheet. This cannot be undone. The stamped and raw PDFs in Drive will remain.</span>
              </div>
            </div>
            <div className="oh-inv-adm-reject-footer">
              <button className="oh-inv-adm-reject-cancel" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button className="oh-inv-adm-reject-submit" style={{ background: "#dc2626" }} onClick={handleDeleteDupe} disabled={deleting}>
                {deleting ? <><div className="oh-spinner-sm" style={{ width: 14, height: 14 }} />Deleting...</> : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div className="oh-inv-adm-reject-overlay" onClick={() => { if (!archiving) setArchiveTarget(null); }}>
          <div className="oh-inv-adm-reject-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="oh-inv-adm-reject-header" style={{ background: "#f8fafc", borderColor: "#cbd5e1", color: "#475569" }}>Archive Invoice</div>
            <div className="oh-inv-adm-reject-body">
              <div className="oh-inv-adm-reject-invoice">
                <div className="oh-inv-adm-reject-invoice-name">{archiveTarget.vendor} #{archiveTarget.invoiceNumber}</div>
                <div className="oh-inv-adm-reject-invoice-meta">{archiveTarget.userEmail?.split("@")[0]} · {archiveTarget.account} · ${fmt$(Math.abs(archiveTarget.totalAmount))}</div>
              </div>
              <div className="oh-inv-adm-delete-warn" style={{ background: "#f8fafc", borderColor: "#cbd5e1" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>
                <span>This invoice will be hidden from default views. You can restore it anytime from the Archived filter.</span>
              </div>
            </div>
            <div className="oh-inv-adm-reject-footer">
              <button className="oh-inv-adm-reject-cancel" onClick={() => setArchiveTarget(null)} disabled={archiving}>Cancel</button>
              <button className="oh-inv-adm-reject-submit" style={{ background: "#64748b" }} onClick={confirmArchive} disabled={archiving}>
                {archiving ? <><div className="oh-spinner-sm" style={{ width: 14, height: 14 }} />Archiving...</> : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}