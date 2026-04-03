"use client";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import GLCodeTable from "@/app/ops/components/invoice/GLCodeTable";
import VendorSetup from "@/app/ops/components/invoice/VendorSetup";
import InvoicePreview from "@/app/ops/components/invoice/InvoicePreview";

const fmt$ = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DRAFT_KEY = "kf_invoice_draft";
const LAST_ACCT_KEY = "kf_inv_last_account";
const QUEUE_KEY = "kf_invoice_offline_queue";
const RECENT_VENDORS_KEY = "kf_inv_recent_vendors";
const GL_USAGE_KEY = "kf_inv_gl_usage";

// ═══════════════════════════════════════
// CompletionBar
// ═══════════════════════════════════════
function CompletionBar({ account, photosReady, hasVendor, hasDetails, glBalanced, done }) {
  const steps = [
    { label: "Account", done: !!account },
    { label: "Photo",   done: photosReady },
    { label: "Vendor",  done: hasVendor },
    { label: "Details", done: hasDetails },
    { label: "GL",      done: glBalanced },
  ];
  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  if (done) {
    return (
      <div className="oh-inv-progress oh-inv-progress--submitted">
        <div className="oh-inv-progress-bar">
          <div className="oh-inv-progress-fill oh-inv-progress-fill--complete" style={{ width: "100%" }} />
        </div>
        <div className="oh-inv-progress-meta">
          <span className="oh-inv-progress-label oh-inv-progress-label--done">✓ Submitted!</span>
          <span className="oh-inv-progress-pct">100%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="oh-inv-progress">
      <div className="oh-inv-progress-bar">
        <div className="oh-inv-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="oh-inv-progress-steps">
        {steps.map((s, i) => (
          <div key={i} className={`oh-inv-progress-step${s.done ? " oh-inv-progress-step--done" : i === completed ? " oh-inv-progress-step--next" : ""}`}>
            <div className="oh-inv-progress-dot">
              {s.done && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
            </div>
            <span className="oh-inv-progress-step-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// VendorTypeAhead
// ═══════════════════════════════════════
function VendorTypeAhead({ vendors, value, onChange, onAddNew, hasError, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return vendors;
    return vendors.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()));
  }, [vendors, query]);

useEffect(() => {
    const handler = (e) => {
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inWrap && !inDropdown) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);
    return (
    <div className={`oh-inv-typeahead${hasError ? " oh-inv-error" : ""}`} ref={wrapRef}>
      <div className="oh-inv-typeahead-input-row">
        <input type="text" className="oh-inv-typeahead-input" value={open ? query : (value?.name || "")}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(""); }}
          placeholder="Search or select vendor..." disabled={disabled} />
        <button className="oh-inv-typeahead-toggle" onClick={() => setOpen(!open)} disabled={disabled} tabIndex={-1}>
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {open && !disabled && (
<div className="oh-inv-typeahead-dropdown" ref={dropdownRef}>
            {filtered.length > 0 ? filtered.map((v) => (
            <button key={v.vendorId} className={`oh-inv-typeahead-option${value?.vendorId === v.vendorId ? " oh-inv-typeahead-option--selected" : ""}`}
              onClick={() => { onChange(v); setOpen(false); setQuery(""); }}>
              <span>{v.name}</span>
              {v.category && <span className="oh-inv-typeahead-cat">{v.category}</span>}
            </button>
          )) : <div className="oh-inv-typeahead-empty">No vendors matching &ldquo;{query}&rdquo;</div>}
          <button className="oh-inv-typeahead-add" onClick={() => { setOpen(false); onAddNew(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add New Vendor
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// PhotoLightbox
// ═══════════════════════════════════════
function PhotoLightbox({ src, rotation, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="oh-inv-lightbox" onClick={onClose}>
      <button className="oh-inv-lightbox-close" onClick={onClose}>✕</button>
      <img src={src} alt="Invoice" style={{ transform: `rotate(${rotation || 0}deg)` }} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// ═══════════════════════════════════════
// Receipt HTML generator
// ═══════════════════════════════════════
function generateReceiptHTML(s) {
  let glRows = [];
  try { glRows = JSON.parse(s.glBreakdown || "[]"); } catch {}
  const isCredit = Number(s.totalAmount) < 0;
  const absTotal = Math.abs(Number(s.totalAmount));

  return `<!DOCTYPE html><html><head><title>${isCredit ? "Credit Memo" : "Invoice"} Receipt — ${s.invoiceNumber || "N/A"}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:32px 24px;color:#1a1a2e;line-height:1.5}.receipt-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${isCredit?"#6366f1":"#d97706"};padding-bottom:16px;margin-bottom:24px}.receipt-brand h1{font-size:22px;font-weight:700;color:#0f3057;margin-bottom:2px}.receipt-brand p{font-size:13px;color:#6b7280}.receipt-type{text-align:right}.receipt-type span{display:inline-block;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.5px;background:${isCredit?"#eef2ff":"#fffbeb"};color:${isCredit?"#4338ca":"#92400e"}}.receipt-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px}.receipt-field{background:#f8fafc;padding:12px 16px;border-radius:10px;border:1px solid #f1f5f9}.receipt-field-label{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px}.receipt-field-value{font-size:15px;font-weight:600;color:#1e293b}.receipt-total .receipt-field-value{font-size:24px;color:${isCredit?"#4338ca":"#0f3057"}}.receipt-gl{margin:20px 0}.receipt-gl h3{font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px}.receipt-gl table{width:100%;border-collapse:collapse}.receipt-gl th{text-align:left;font-size:11px;font-weight:600;color:#9ca3af;padding:8px 12px;border-bottom:2px solid #e5e7eb}.receipt-gl th:last-child{text-align:right}.receipt-gl td{padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151}.receipt-gl td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}.receipt-gl tfoot td{border-top:2px solid #e5e7eb;font-weight:700;color:#0f3057}.receipt-footer{margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af}.receipt-footer p{margin-bottom:4px}.receipt-badges{display:flex;gap:8px;margin-top:8px}.receipt-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}.badge-green{background:#ecfdf5;color:#065f46}.badge-blue{background:#eff6ff;color:#1e40af}.badge-grey{background:#f1f5f9;color:#475569}@media print{body{padding:16px 12px}}</style>
</head><body>
<div class="receipt-header"><div class="receipt-brand"><h1>KitchFix</h1><p>${s.account}</p></div><div class="receipt-type"><span>${isCredit?"CREDIT MEMO":"INVOICE RECEIPT"}</span></div></div>
<div class="receipt-grid">
  <div class="receipt-field"><div class="receipt-field-label">Vendor</div><div class="receipt-field-value">${s.vendor}</div></div>
  <div class="receipt-field"><div class="receipt-field-label">${isCredit?"Credit Memo #":"Invoice #"}</div><div class="receipt-field-value">${s.invoiceNumber||"—"}</div></div>
  <div class="receipt-field"><div class="receipt-field-label">Invoice Date</div><div class="receipt-field-value">${s.invoiceDate}</div></div>
  <div class="receipt-field receipt-total"><div class="receipt-field-label">${isCredit?"Credit Amount":"Total"}</div><div class="receipt-field-value">${isCredit?"−":""}$${absTotal.toLocaleString("en-US",{minimumFractionDigits:2})}</div></div>
</div>
${glRows.length>0?`<div class="receipt-gl"><h3>GL Coding</h3><table><thead><tr><th>Code</th><th>Description</th><th>Amount</th></tr></thead><tbody>${glRows.map(r=>`<tr><td>${r.code||""}</td><td>${r.name||""}</td><td>$${Number(r.amount||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="2">Total</td><td>$${glRows.reduce((s,r)=>s+(Number(r.amount)||0),0).toLocaleString("en-US",{minimumFractionDigits:2})}</td></tr></tfoot></table></div>`:""}
<div class="receipt-footer">
  <p>Submitted by ${s.userEmail} · ${new Date(s.timestamp).toLocaleString()}</p>
  <p>${s.pageCount||1} page${(s.pageCount||1)>1?"s":""} uploaded</p>
  <div class="receipt-badges">
    ${s.emailSent?'<span class="receipt-badge badge-green">✉️ Email Sent</span>':'<span class="receipt-badge badge-grey">✉️ Email Pending</span>'}
    ${s.aiScanStatus==="complete"?'<span class="receipt-badge badge-blue">🤖 AI Scanned</span>':s.aiScanStatus==="pending"?'<span class="receipt-badge badge-grey">⏳ Scan Pending</span>':""}
  </div>
</div>
</body></html>`;
}

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════
export default function InvoiceTool({ config, showToast, openConfirm, onNavigate }) {
  // ——— Core State ———
  const [account, setAccount] = useState(() => typeof window !== "undefined" ? localStorage.getItem(LAST_ACCT_KEY) || "" : "");
  const [vendor, setVendor] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [totalAmount, setTotalAmount] = useState("");
  const [glRows, setGlRows] = useState([{ code: "", name: "", amount: "" }]);
  const [pages, setPages] = useState([]);
  const [apNote, setApNote] = useState("");
  const [showNoteField, setShowNoteField] = useState(false);
  const [formType, setFormType] = useState("invoice");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastSubmission, setLastSubmission] = useState(null);

  // ═══ Page ordering + consistency state ═══
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedPageIdx, setSelectedPageIdx] = useState(null);
  const [consistencyIssues, setConsistencyIssues] = useState([]);
  const [consistencyChecking, setConsistencyChecking] = useState(false);

  // Bootstrap
  const [vendors, setVendors] = useState([]);
  const [vendorMaster, setVendorMaster] = useState([]);
  const [glCodes, setGlCodes] = useState([]);
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [initialReady, setInitialReady] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem(LAST_ACCT_KEY);
  });

  // UI
  const [activeTab, setActiveTab] = useState("form");
  const [showVendorSetup, setShowVendorSetup] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [draftSavedAgo, setDraftSavedAgo] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState("all");
  const [stepComplete, setStepComplete] = useState(false);

  // OCR
  const [ocrStatus, setOcrStatus] = useState("idle");
  const [ocrResult, setOcrResult] = useState(null);

  // Offline
  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState([]);

  // Validation
  const [errors, setErrors] = useState({});
  const fileInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const formRef = useRef(null);
  const consistencyCheckKeyRef = useRef("");

  const accounts = config?.accounts || [];

  // ——— Derived state ———
  const isCreditMemo = formType === "credit";
  const hasAccount = !!account;
  const hasPhotos = pages.length > 0;
  const hasVendor = !!vendor;

  const gateScanning = pages.some((p) => p.gate === "scanning");
  const gateFailedPages = pages.filter((p) => p.gate === "fail");
  const gateWarnPages = pages.filter((p) => p.gate === "warn");
  const gateAllCleared = hasPhotos && pages.every((p) => p.gate === "pass" || p.gate === "warn");
  const photosReady = hasPhotos && gateAllCleared && !gateScanning;

const glTotalRaw = glRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const glTotal = Math.round(glTotalRaw * 100) / 100;
  const invoiceTotal = Math.round(Number(totalAmount) * 100) / 100;
  const glBalanceDiff = invoiceTotal > 0 ? invoiceTotal - glTotal : 0;
    const hasDetails = !!(invoiceDate && Number(totalAmount) > 0 && invoiceNumber);
  const glBalanced = Number(totalAmount) > 0 && glRows.some((r) => r.code && Number(r.amount) > 0) && Math.abs(glBalanceDiff) <= 0.01;

  const hasUnsavedChanges = useMemo(() => {
    return !!(vendor || invoiceNumber || totalAmount || pages.length > 0 || glRows.some((r) => r.code || r.amount));
  }, [vendor, invoiceNumber, totalAmount, pages, glRows]);

  const [recentVendorIds, setRecentVendorIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_VENDORS_KEY) || "[]"); } catch { return []; }
  });
  const recentVendors = useMemo(() => {
    return recentVendorIds.map((id) => vendors.find((v) => v.vendorId === id)).filter(Boolean).slice(0, 3);
  }, [recentVendorIds, vendors]);

  const trackRecentVendor = useCallback((vendorId) => {
    const updated = [vendorId, ...recentVendorIds.filter((id) => id !== vendorId)].slice(0, 5);
    setRecentVendorIds(updated);
    try { localStorage.setItem(RECENT_VENDORS_KEY, JSON.stringify(updated)); } catch {}
  }, [recentVendorIds]);

  const trackGLUsage = useCallback((code) => {
    try {
      const usage = JSON.parse(localStorage.getItem(GL_USAGE_KEY) || "{}");
      usage[code] = (usage[code] || 0) + 1;
      localStorage.setItem(GL_USAGE_KEY, JSON.stringify(usage));
    } catch {}
  }, []);

  const drainOfflineQueueRef = useRef(null);
  const tryOCRScanRef = useRef(null);
  const handleSubmitRef = useRef(null);

  // ——— Online/Offline ———
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); drainOfflineQueueRef.current?.(); };
    const handleOffline = () => setIsOnline(false);
    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      try { setOfflineQueue(JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]")); } catch {}
    }
    return () => { if (typeof window !== "undefined") { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); } };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSubmitRef.current?.(); }
      if (e.key === "Escape" && showVendorSetup) setShowVendorSetup(false);
      if (e.key === "Escape" && lightboxIdx !== null) setLightboxIdx(null);
      if (e.key === "Escape" && reorderMode) { setReorderMode(false); setSelectedPageIdx(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showVendorSetup, lightboxIdx, reorderMode]);

  const originalOnNavigate = onNavigate;
  const guardedNavigate = useCallback((target) => {
    if (hasUnsavedChanges && activeTab === "form") {
      openConfirm("Unsaved Changes", "You have an invoice in progress. Discard changes?", "Discard", () => { resetForm(); originalOnNavigate(target); });
    } else {
      originalOnNavigate(target);
    }
  }, [hasUnsavedChanges, activeTab, openConfirm, originalOnNavigate]);

  useEffect(() => {
    if (typeof window !== "undefined") window.__kf_inv_navigate = guardedNavigate;
    return () => { if (typeof window !== "undefined") delete window.__kf_inv_navigate; };
  }, [guardedNavigate]);

  // ——— Bootstrap ———
  const loadBootstrap = useCallback(async (acct) => {
    if (!acct) return;
    setBootstrapLoading(true);
    try {
      const res = await fetch(`/api/ops?action=invoice-bootstrap&account=${encodeURIComponent(acct)}`);
      const data = await res.json();
      if (data.success) {
        setVendors(data.vendors || []);
        setVendorMaster(data.vendorMaster || []);
        setGlCodes(data.glCodes || []);
        setRecentSubmissions(data.recentSubmissions || []);
      }
    } catch (err) { console.error("[Invoice] Bootstrap error:", err); }
    finally { setBootstrapLoading(false); setInitialReady(true); }
  }, []);

  useEffect(() => {
    if (account) {
      localStorage.setItem(LAST_ACCT_KEY, account);
      loadBootstrap(account);
      setVendor(null);
    }
  }, [account, loadBootstrap]);

  // ——— Draft save/restore ———
  const saveDraft = useCallback(() => {
    if (!account) return;
    const draft = { account, vendor, invoiceNumber, invoiceDate, totalAmount, glRows, pages, apNote, formType, ts: Date.now() };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); setDraftSavedAgo(0); } catch {}
  }, [account, vendor, invoiceNumber, invoiceDate, totalAmount, glRows, pages, apNote, formType]);

  useEffect(() => { saveDraft(); }, [saveDraft]);

  useEffect(() => {
    if (draftSavedAgo === null) return;
    const timer = setInterval(() => setDraftSavedAgo((p) => (p !== null ? p + 1 : null)), 1000);
    return () => clearInterval(timer);
  }, [draftSavedAgo !== null]);

  const draftLabel = useMemo(() => {
    if (draftSavedAgo === null || !hasAccount) return null;
    if (draftSavedAgo < 3) return "Draft saved just now";
    if (draftSavedAgo < 60) return `Draft saved ${draftSavedAgo}s ago`;
    return `Draft saved ${Math.floor(draftSavedAgo / 60)}m ago`;
  }, [draftSavedAgo, hasAccount]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Date.now() - d.ts > 86400000) { localStorage.removeItem(DRAFT_KEY); return; }
      if (d.vendor) setVendor(d.vendor);
      if (d.invoiceNumber) setInvoiceNumber(d.invoiceNumber);
      if (d.invoiceDate) setInvoiceDate(d.invoiceDate);
      if (d.totalAmount) setTotalAmount(d.totalAmount);
      if (d.glRows?.length) setGlRows(d.glRows);
if (d.pages?.length) {
        const restoredPages = d.pages.map((p, i) => ({ ...p, pid: p.pid || `draft_${i}`, gate: "scanning", gateResult: null, pageNumber: null, totalPages: null, pageNumberConfidence: "none" }));
        setPages(restoredPages);
        // Re-run photo gate on each restored page (non-blocking)
        restoredPages.forEach((p) => {
          if (p.data) runPhotoGate(p.pid, p.data);
        });
      }
            if (d.apNote) { setApNote(d.apNote); setShowNoteField(true); }
      if (d.formType && d.formType !== "cc_receipt") setFormType(d.formType);
    } catch {}
  }, []);

  // ═══════════════════════════════════════
  // PHOTO GATE
  // ═══════════════════════════════════════
  const runPhotoGate = useCallback(async (pageId, imageData, overrideFormType) => {
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-photo-gate", image: imageData, formType: overrideFormType || formType }),
      });
      const data = await res.json();
      setPages((prev) => prev.map((p) =>
        p.pid === pageId ? {
          ...p,
          gate: data.pass ? (data.isWarning ? "warn" : "pass") : "fail",
          gateResult: data,
          pageNumber: data.pageNumber ?? null,
          totalPages: data.totalPages ?? null,
          pageNumberConfidence: data.pageNumberConfidence || "none",
        } : p
      ));
      if (!data.pass) showToast(data.message || "Photo didn't pass quality check", "error");
      else if (data.isWarning) showToast(data.message || "Photo has quality issues — you can still proceed", "info");
    } catch {
      setPages((prev) => prev.map((p) =>
        p.pid === pageId ? { ...p, gate: "pass", gateResult: null, pageNumber: null, totalPages: null, pageNumberConfidence: "none" } : p
      ));
    }
  }, [formType, showToast]);

  // ═══════════════════════════════════════
  // CONSISTENCY CHECK
  // ═══════════════════════════════════════
  const runConsistencyCheck = useCallback(async (pagesSnap) => {
    if (pagesSnap.length < 2) return;
    const checkKey = [...pagesSnap].map((p) => p.pid).sort().join(",");
    if (checkKey === consistencyCheckKeyRef.current) return;
    consistencyCheckKeyRef.current = checkKey;
    setConsistencyChecking(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invoice-consistency-check",
          pages: pagesSnap.map((p) => ({ pid: p.pid, data: p.data })),
          vendor: vendor?.name || "",
          invoiceNumber,
          invoiceDate,
        }),
      });
      const data = await res.json();
      const issues = data.roguePages || [];
      setConsistencyIssues(issues);
      if (issues.length > 0) {
        const pageNums = issues.map((r) => pagesSnap.findIndex((p) => p.pid === r.pid) + 1).filter((n) => n > 0);
        showToast(`Page ${pageNums.join(", ")} may not belong to this invoice`, "info");
      }
    } catch {
      // non-blocking
    } finally {
      setConsistencyChecking(false);
    }
  }, [vendor, invoiceNumber, invoiceDate, showToast]);

  // ═══════════════════════════════════════
  // AUTO-SORT + CONSISTENCY TRIGGER
  // ═══════════════════════════════════════
  const gateCompleteKey = pages.length >= 2 && !pages.some((p) => p.gate === "scanning")
    ? pages.map((p) => `${p.pid}:${p.gate}`).sort().join(",")
    : "scanning";

  useEffect(() => {
    if (gateCompleteKey === "scanning" || pages.length < 2) return;
    let finalPages = pages;
    const allHighConf = pages.every((p) => p.pageNumber != null && p.pageNumberConfidence === "high");
    if (allHighConf) {
      const sorted = [...pages].sort((a, b) => (a.pageNumber || 99) - (b.pageNumber || 99));
      const inOrder = sorted.every((p, i) => p.pid === pages[i].pid);
      if (!inOrder) {
        setPages(sorted);
        finalPages = sorted;
        showToast("Pages auto-sorted to match document order ✓", "info");
      }
    }
    runConsistencyCheck(finalPages);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateCompleteKey]);

  // ═══════════════════════════════════════
  // TAP-TO-REORDER
  // ═══════════════════════════════════════
  const handlePageTap = useCallback((i) => {
    if (!reorderMode) {
      setLightboxIdx(i);
      return;
    }
    if (selectedPageIdx === null) {
      setSelectedPageIdx(i);
    } else if (selectedPageIdx === i) {
      setSelectedPageIdx(null);
    } else {
      setPages((prev) => {
        const next = [...prev];
        const [moved] = next.splice(selectedPageIdx, 1);
        next.splice(i, 0, moved);
        return next;
      });
      setSelectedPageIdx(null);
      setConsistencyIssues([]);
      consistencyCheckKeyRef.current = "";
    }
  }, [reorderMode, selectedPageIdx]);

  // ——— File Handling ———
  const nextPid = useRef(0);
  const makePid = () => `p_${Date.now()}_${++nextPid.current}`;

  const processImageFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxW = 1200;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const pid = makePid();
setPages((prev) => [...prev, {
          data: dataUrl, rotation: 0, type: "image", pid,
          gate: "scanning", gateResult: null,
          pageNumber: null, totalPages: null, pageNumberConfidence: "none",
        }]);
        runPhotoGate(pid, dataUrl);
            };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }, [invoiceNumber, runPhotoGate]);

  const processPDFFile = useCallback(async (file) => {
    try {
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            resolve();
          };
          script.onerror = () => reject(new Error("Failed to load PDF library"));
          document.head.appendChild(script);
        });
      }
      showToast("Processing PDF...", "info");
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPdfPages = pdf.numPages;
const availableSlots = 15 - pages.length;
      const pagesToRender = Math.min(totalPdfPages, availableSlots);
      if (totalPdfPages > availableSlots) showToast(`PDF has ${totalPdfPages} pages — importing first ${pagesToRender} (${availableSlots} slots left)`, "info");
      let lastPageDataUrl = null;
      for (let i = 1; i <= pagesToRender; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const maxW = 1200;
        let dataUrl;
        if (canvas.width > maxW) {
          const resized = document.createElement("canvas");
          const scale = maxW / canvas.width;
          resized.width = maxW; resized.height = canvas.height * scale;
          resized.getContext("2d").drawImage(canvas, 0, 0, resized.width, resized.height);
          dataUrl = resized.toDataURL("image/jpeg", 0.85);
        } else {
          dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        }
        lastPageDataUrl = dataUrl;
        const pid = makePid();
        setPages((prev) => [...prev, {
          data: dataUrl, rotation: 0, type: "pdf", pid,
          gate: "pass", gateResult: null,
          pageNumber: i, totalPages: totalPdfPages, pageNumberConfidence: "high",
        }]);
      }
showToast(`${pagesToRender} page${pagesToRender > 1 ? "s" : ""} imported from PDF`, "success");
    } catch (err) {
      console.error("[PDF] Processing error:", err);
      showToast("Couldn't read PDF — try a photo instead", "error");
    }
  }, [pages, showToast, invoiceNumber]);

  const processFiles = useCallback((files) => {
    const fileArr = Array.from(files);
if (pages.length + fileArr.length > 15) { showToast("Maximum 15 pages per invoice", "error"); return; }
    fileArr.forEach((file) => {
      if (file.type === "application/pdf") processPDFFile(file); else processImageFile(file);
    });
  }, [pages, showToast, processImageFile, processPDFFile]);

  // ═══════════════════════════════════════
  // OCR Scan
  // ═══════════════════════════════════════
  const tryOCRScan = useCallback(async (imageData) => {
setOcrStatus("scanning");
    try {
      const downsample = (dataUrl) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 800; const scale = Math.min(1, maxW / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = img.width * scale; canvas.height = img.height * scale;
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.75));
        };
        img.src = dataUrl;
      });
      const scanImage = await downsample(imageData);
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-ocr", image: scanImage, account }),
      });
      const data = await res.json();
      if (data.rejected) { setOcrStatus("rejected"); setOcrResult(data); showToast("Photo couldn't be read — see suggestions below", "error"); return; }
if (data.success) {
        setOcrStatus("success");
        setOcrResult((prev) => {
          // Merge: keep prior detections, add new ones
          if (!prev) return data;
          return {
            ...prev,
            ...data,
            invoiceNumber: prev.invoiceNumber || data.invoiceNumber,
            invoiceDate: prev.invoiceDate || data.invoiceDate,
            totalAmount: prev.totalAmount || data.totalAmount,
            vendorName: prev.vendorName || data.vendorName,
            vendorMatch: prev.vendorMatch || data.vendorMatch,
            confidence: data.confidence,
          };
        });
        const filled = [];
        if (data.invoiceNumber && !invoiceNumber) { setInvoiceNumber(data.invoiceNumber); filled.push("invoice #"); }
if (data.invoiceDate) { setInvoiceDate(data.invoiceDate); filled.push("date"); }
        if (data.totalAmount && !totalAmount) { setTotalAmount(String(data.totalAmount)); filled.push("total"); }
        if (data.vendorMatch?.bestMatch && !vendor) {
          const matchedVendor = vendors.find((v) => v.vendorId === data.vendorMatch.bestMatch.vendorId);
          if (matchedVendor && data.vendorMatch.confidence !== "low") { setVendor(matchedVendor); trackRecentVendor(matchedVendor.vendorId); filled.push("vendor"); }
        }
        if (filled.length > 0) showToast(`Auto-detected: ${filled.join(", ")} ${data.confidence === "high" ? "✓" : "(verify)"}`, "info");
      } else { setOcrStatus("idle"); }
        } catch { setOcrStatus("idle"); }
  }, [account, invoiceNumber, vendors, vendor, showToast, trackRecentVendor]);

// ═══ Progressive OCR: scan each new page for missing fields ═══
  const prevPageCountRef = useRef(0);
  const pdfBatchScanRef = useRef(false);
  useEffect(() => {
    const prevCount = prevPageCountRef.current;
    prevPageCountRef.current = pages.length;

    // No new page was added (or pages were removed) — skip
    if (pages.length <= prevCount || pages.length === 0) return;

    // First page: always scan (ocrStatus will be "idle")
    if (prevCount === 0 && ocrStatus === "idle") {
      const newestPage = pages[pages.length - 1];
      if (!newestPage?.data) return;
      // If a multi-page PDF was added all at once, scan second-to-last page
      // (last page is often blank trailing page from browser print)
      if (pages.length > 2 && pages[pages.length - 1].type === "pdf") {
        pdfBatchScanRef.current = true;
        tryOCRScanRef.current?.(pages[pages.length - 2].data);
      } else {
        tryOCRScanRef.current?.(newestPage.data);
      }
      return;
    }

    // Subsequent pages: only re-scan if total is still missing
    if (prevCount > 0 && !totalAmount && ocrStatus !== "scanning") {
      const newestPage = pages[pages.length - 1];
      if (!newestPage?.data) return;
      tryOCRScanRef.current?.(newestPage.data);
    }
  }, [pages, ocrStatus, totalAmount]);

  const handlePhotoCapture = useCallback((e) => { processFiles(e.target.files || []); if (fileInputRef.current) fileInputRef.current.value = ""; }, [processFiles]);
  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files); }, [processFiles]);

  const removePage = useCallback((idx) => {
    setPages((prev) => {
      const removedPid = prev[idx]?.pid;
      const next = prev.filter((_, i) => i !== idx);
      if (removedPid) setConsistencyIssues((ci) => ci.filter((i) => i.pid !== removedPid));
      if (next.length === 0) {
        setOcrStatus("idle"); setOcrResult(null);
        setInvoiceNumber(""); setInvoiceDate(new Date().toISOString().split("T")[0]);
        setTotalAmount(""); setVendor(null);
        setGlRows([{ code: "", name: "", amount: "" }]);
        setApNote(""); setShowNoteField(false); setErrors({});
        setReorderMode(false); setSelectedPageIdx(null);
        consistencyCheckKeyRef.current = "";
      } else if (idx === 0) { setOcrStatus("idle"); setOcrResult(null); }
      return next;
    });
  }, []);

  const rotatePage = useCallback((idx) => {
    setPages((prev) => prev.map((p, i) => i === idx ? { ...p, rotation: (p.rotation + 90) % 360 } : p));
  }, []);
  
  // ——— Validation ———
  const validate = useCallback(() => {
    const errs = {};
    if (!account) errs.account = true;
    if (!vendor) errs.vendor = true;
    if (!invoiceNumber) errs.invoiceNumber = true;
    if (!invoiceDate) errs.invoiceDate = true;
    if (!totalAmount || Number(totalAmount) <= 0) errs.totalAmount = true;
    if (pages.length === 0) errs.pages = true;
    if (!glRows.some((r) => r.code && Number(r.amount) > 0)) errs.glRows = true;
    const glT = glRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
const roundedGlT = Math.round(glT * 100) / 100;
    const roundedTotal = Math.round(Number(totalAmount) * 100) / 100;
    if (Math.abs(roundedGlT - roundedTotal) > 0.01 && roundedTotal > 0) errs.glBalance = true;
        setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const el = document.querySelector(`[data-field="${Object.keys(errs)[0]}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return Object.keys(errs).length === 0;
  }, [account, vendor, invoiceNumber, invoiceDate, totalAmount, pages, glRows]);

  // ——— Submit ———
  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    try {
      const dupRes = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice-duplicate-check", vendor: vendor.name, invoiceNumber, invoiceDate, totalAmount: Number(totalAmount) }) });
      const dupData = await dupRes.json();
      if (dupData.isDuplicate) {
        const proceed = await new Promise((resolve) => {
          openConfirm("Possible Duplicate", `This invoice may already have been submitted by ${dupData.existingInvoice?.userEmail}. Submit anyway?`, "Submit Anyway", () => resolve(true));
          setTimeout(() => resolve(false), 30000);
        });
        if (!proceed) return;
      }
    } catch {}
    setSubmitting(true);
    glRows.filter((r) => r.code).forEach((r) => trackGLUsage(r.code));
    if (vendor?.vendorId) trackRecentVendor(vendor.vendorId);
const payload = {
      action: "invoice-submit", formType, account,
      vendor: vendor.name, vendorId: vendor.vendorId || "",
      invoiceNumber, invoiceDate,
      totalAmount: isCreditMemo ? -Math.abs(Number(totalAmount)) : Number(totalAmount),
      glRows: glRows.filter((r) => r.code && Number(r.amount) > 0),
pages: pages.map((p) => ({ data: p.data, rotation: p.rotation || 0, type: p.type || "image" })),
      isCreditMemo, apNote: apNote.trim() || null,
      ocrVendorName: ocrResult?.vendorName || null,
    };
        if (!navigator.onLine) {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      queue.push({ ...payload, queuedAt: Date.now() });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      setOfflineQueue(queue); setSubmitting(false);
      showToast("📡 Saved offline — will submit when connected", "info");
resetForm(); return;
    }
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        setLastSubmission({ vendor: vendor?.name, invoiceNumber, total: isCreditMemo ? -Math.abs(Number(totalAmount)) : Number(totalAmount), formType });
        setShowSuccess(true); setStepComplete(true); setSessionCount((c) => c + 1);
        setTimeout(() => setShowSuccess(false), 3200);
        setTimeout(() => setStepComplete(false), 2400);
loadBootstrap(account); resetForm();
      } else { showToast(data.error || "Submission failed", "error"); }
    } catch { showToast("Network error — try again", "error"); }
    finally { setSubmitting(false); }
  }, [account, vendor, invoiceNumber, invoiceDate, totalAmount, glRows, pages, apNote, formType, isCreditMemo, validate, openConfirm, showToast, loadBootstrap, trackGLUsage, trackRecentVendor]);

  const drainOfflineQueue = useCallback(async () => {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    if (queue.length === 0) return;
    let ok = 0; const remaining = [];
    for (const item of queue) {
      try {
        const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
        const data = await res.json();
        if (data.success) ok++; else remaining.push(item);
      } catch { remaining.push(item); }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    setOfflineQueue(remaining);
    if (ok > 0) showToast(`✓ ${ok} queued invoice${ok > 1 ? "s" : ""} submitted`, "success");
  }, [showToast]);

  useEffect(() => { drainOfflineQueueRef.current = drainOfflineQueue; }, [drainOfflineQueue]);
  useEffect(() => { handleSubmitRef.current = handleSubmit; }, [handleSubmit]);
  useEffect(() => { tryOCRScanRef.current = tryOCRScan; }, [tryOCRScan]);

const resetForm = useCallback(() => {
      setInvoiceNumber(""); setInvoiceDate(new Date().toISOString().split("T")[0]);
    setTotalAmount(""); setGlRows([{ code: "", name: "", amount: "" }]);
    setPages([]); setApNote(""); setShowNoteField(false);
    setErrors({}); setDraftSavedAgo(null); localStorage.removeItem(DRAFT_KEY);
    setOcrStatus("idle"); setOcrResult(null);
setReorderMode(false); setSelectedPageIdx(null);
    setConsistencyIssues([]); consistencyCheckKeyRef.current = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
    setVendor(null); setFormType("invoice");
    }, []);

  const filteredSubmissions = useMemo(() => {
    let list = recentSubmissions;
    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      list = list.filter((s) => s.vendor.toLowerCase().includes(q) || (s.invoiceNumber || "").toLowerCase().includes(q));
    }
    if (historyPeriod === "week") list = list.filter((s) => new Date(s.timestamp) >= new Date(Date.now() - 7 * 86400000));
    else if (historyPeriod === "month") list = list.filter((s) => new Date(s.timestamp) >= new Date(Date.now() - 30 * 86400000));
    return list;
  }, [recentSubmissions, historySearch, historyPeriod]);

  const weeklySummary = useMemo(() => {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const thisWeek = recentSubmissions.filter((s) => new Date(s.timestamp) >= weekAgo);
    return { count: thisWeek.length, total: thisWeek.reduce((sum, s) => sum + Math.abs(Number(s.totalAmount || 0)), 0) };
  }, [recentSubmissions]);

  const exportReceipt = useCallback((submission) => {
    const html = generateReceiptHTML(submission);
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => { try { win.print(); } catch {} }, 600); }
    else showToast("Please allow popups to export receipts", "error");
  }, [showToast]);

  // ═══════════════════════════════════════
  // Partial-confidence sort suggestion
  // ═══════════════════════════════════════
  const partialConfidenceSuggestion = useMemo(() => {
    if (pages.length < 2 || gateScanning) return null;
    const pagesWithNums = pages.filter((p) => p.pageNumber != null);
    if (pagesWithNums.length === 0) return null;
    const allHighConf = pagesWithNums.every((p) => p.pageNumberConfidence === "high");
    if (allHighConf && pagesWithNums.length === pages.length) return null;
    if (pagesWithNums.length < 2) return null;
    const sorted = [...pages].sort((a, b) => (a.pageNumber || 99) - (b.pageNumber || 99));
    const inOrder = sorted.every((p, i) => p.pid === pages[i].pid);
    if (inOrder) return null;
    return { sorted, label: sorted.map((p) => p.pageNumber ? `p.${p.pageNumber}${p.pageNumberConfidence !== "high" ? "?" : ""}` : "?").join(" → ") };
  }, [pages, gateScanning]);

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════

  const SkeletonLoader = () => (
    <div className="oh-inv-skeleton" aria-hidden="true">
      <div className="oh-inv-skeleton-tabs"><div className="oh-inv-skeleton-pill oh-inv-skeleton-pill--active" /><div className="oh-inv-skeleton-pill" /></div>
      <div className="oh-inv-skeleton-steps">{[1,2,3,4].map(i => (<React.Fragment key={i}>{i > 1 && <div className="oh-inv-skeleton-line" />}<div className="oh-inv-skeleton-circle" /></React.Fragment>))}</div>
      <div className="oh-inv-skeleton-group"><div className="oh-inv-skeleton-label" /><div className="oh-inv-skeleton-input" /></div>
      <div className="oh-inv-skeleton-group"><div className="oh-inv-skeleton-label" style={{width:"40%"}} /><div className="oh-inv-skeleton-photo-zone" /></div>
      <div className="oh-inv-skeleton-group"><div className="oh-inv-skeleton-label" style={{width:"25%"}} /><div className="oh-inv-skeleton-input" /></div>
      <div className="oh-inv-skeleton-row-2">
        <div className="oh-inv-skeleton-group" style={{flex:1}}><div className="oh-inv-skeleton-label" style={{width:"50%"}} /><div className="oh-inv-skeleton-input" /></div>
        <div className="oh-inv-skeleton-group" style={{flex:1}}><div className="oh-inv-skeleton-label" style={{width:"50%"}} /><div className="oh-inv-skeleton-input" /></div>
      </div>
      <div className="oh-inv-skeleton-group"><div className="oh-inv-skeleton-label" style={{width:"30%"}} /><div className="oh-inv-skeleton-gl-row" /><div className="oh-inv-skeleton-gl-row" style={{opacity:0.5}} /></div>
      <div className="oh-inv-skeleton-btn" />
    </div>
  );

  return (
    <div className="oh-view" style={{ animation: "oh-slideUp 0.4s ease" }}>
      {!isOnline && (
        <div className="oh-inv-offline-banner">
          <span>📡 You&apos;re offline — invoices will queue and submit when reconnected</span>
          {offlineQueue.length > 0 && <span className="oh-inv-offline-count">{offlineQueue.length} queued</span>}
        </div>
      )}

      {showSuccess && lastSubmission && (
        <div className="oh-inv-success-overlay">
          <div className="oh-inv-success-check">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={lastSubmission.formType === "credit" ? "#6366f1" : "#10b981"} strokeWidth="2.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <p className="oh-inv-success-text">{lastSubmission.formType === "credit" ? "Credit Memo Submitted!" : "Invoice Submitted!"}</p>
          <div className="oh-inv-success-details">
            <span className="oh-inv-success-vendor">{lastSubmission.vendor}</span>
            {lastSubmission.invoiceNumber && <span className="oh-inv-success-num">#{lastSubmission.invoiceNumber}</span>}
            <span className="oh-inv-success-total">{lastSubmission.total < 0 ? "−$" : "$"}{fmt$(Math.abs(lastSubmission.total))}</span>
          </div>
          <p className="oh-inv-success-sub">Sent to AP ✓</p>
        </div>
      )}

      {lightboxIdx !== null && pages[lightboxIdx] && !reorderMode && (
        <PhotoLightbox src={pages[lightboxIdx].data} rotation={pages[lightboxIdx].rotation} onClose={() => setLightboxIdx(null)} />
      )}

      {sessionCount > 0 && <div className="oh-inv-session-counter">✓ {sessionCount} submission{sessionCount > 1 ? "s" : ""} this session</div>}

      <div className="oh-card oh-inv-card" ref={formRef}>
        {/* Header */}
        <div className="oh-inv-header">
          <div className="oh-inv-header-left">
            <div className="oh-icon-box oh-icon-mustard">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            </div>
            <div>
              <h3 className="oh-card-title" style={{ margin: 0 }}>Invoice Capture</h3>
              <p className="oh-card-desc" style={{ margin: 0 }}>
                Snap, code &amp; submit to AP.
                {draftLabel && <span className="oh-inv-draft-label"> · {draftLabel}</span>}
              </p>
            </div>
          </div>
          <div className="oh-inv-header-right">
            {hasUnsavedChanges && (
<button className="oh-inv-reset-btn" onClick={() => openConfirm("Reset Form", "Clear all fields and start over?", "Reset", () => resetForm())} title="Clear form">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                Reset
              </button>
            )}
          </div>
        </div>

        {!initialReady ? <SkeletonLoader /> : (
        <>
          <div className="oh-inv-tabs">
            <button className={`oh-inv-tab${activeTab === "form" ? " oh-inv-tab--active" : ""}`} onClick={() => setActiveTab("form")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              New Invoice
            </button>
            <button className={`oh-inv-tab${activeTab === "history" ? " oh-inv-tab--active" : ""}`} onClick={() => setActiveTab("history")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              History
              {recentSubmissions.length > 0 && <span className="oh-inv-tab-count">{recentSubmissions.length}</span>}
            </button>
          </div>

          {/* ════ HISTORY TAB ════ */}
          {activeTab === "history" && (
            <div className="oh-inv-history-panel">
              <div className="oh-inv-history-controls">
                <div className="oh-inv-history-search-wrap">
                  <svg className="oh-inv-history-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input type="text" className="oh-inv-history-search" placeholder="Search vendor or invoice #..." value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} />
                  {historySearch && <button className="oh-inv-history-search-clear" onClick={() => setHistorySearch("")}>×</button>}
                </div>
                <div className="oh-inv-history-periods">
                  {[["all","All"],["week","7 Days"],["month","30 Days"]].map(([val, label]) => (
                    <button key={val} className={`oh-inv-period-pill${historyPeriod === val ? " oh-inv-period-pill--active" : ""}`} onClick={() => setHistoryPeriod(val)}>{label}</button>
                  ))}
                </div>
              </div>
              {weeklySummary.count > 0 && historyPeriod === "all" && (
                <div className="oh-inv-weekly-summary">
                  <span>This week:</span>
                  <strong>{weeklySummary.count} invoice{weeklySummary.count > 1 ? "s" : ""}</strong>
                  <span>·</span>
                  <strong>${weeklySummary.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
                </div>
              )}
              {recentSubmissions.length === 0 ? (
                <div className="oh-inv-empty-state">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <p className="oh-inv-empty-title">No Submissions Yet</p>
                  <p className="oh-inv-empty-desc">Invoices you submit will appear here.</p>
                  <button className="oh-inv-empty-cta" onClick={() => setActiveTab("form")}>Submit Your First Invoice →</button>
                </div>
              ) : filteredSubmissions.length === 0 ? (
                <div className="oh-inv-empty-state oh-inv-empty-state--search">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <p className="oh-inv-empty-title">No results</p>
                  <p className="oh-inv-empty-desc">Try a different search or time period.</p>
                  <button className="oh-inv-empty-cta" onClick={() => { setHistorySearch(""); setHistoryPeriod("all"); }}>Clear filters</button>
                </div>
              ) : (
                <div className="oh-inv-history-list">
                  {filteredSubmissions.map((s) => (
                    <div key={s.uuid} className="oh-inv-history-row">
                      <div className="oh-inv-history-left">
                        <span className="oh-inv-history-vendor">{s.vendor}</span>
                        <span className="oh-inv-history-meta">{s.invoiceNumber ? `#${s.invoiceNumber} · ` : ""}{s.invoiceDate}{s.formType === "credit" ? " · Credit" : ""}</span>
                      </div>
                      <div className="oh-inv-history-right">
                        <span className={`oh-inv-history-amount${Number(s.totalAmount) < 0 ? " oh-inv-credit" : ""}`}>
                          {Number(s.totalAmount) < 0 ? "−" : ""}${Math.abs(Number(s.totalAmount)).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                        <div className="oh-inv-history-badges">
                          {s.emailSent && <span className="oh-inv-status-chip oh-inv-status-chip--green"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 7L2 7" /></svg>Sent</span>}
                          {s.aiScanStatus === "complete" && <span className="oh-inv-status-chip oh-inv-status-chip--blue"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>AI Scan</span>}
                          {s.aiScanStatus === "pending" && <span className="oh-inv-status-chip oh-inv-status-chip--grey"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>Scanning</span>}
                          <button className="oh-inv-status-chip oh-inv-status-chip--export" onClick={(e) => { e.stopPropagation(); exportReceipt(s); }} title="Export receipt">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            Export
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredSubmissions.length > 0 && (
                    <div className="oh-inv-history-footer">{filteredSubmissions.length} result{filteredSubmissions.length !== 1 ? "s" : ""}{historySearch || historyPeriod !== "all" ? " (filtered)" : ""}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ════ FORM TAB ════ */}
          {activeTab === "form" && (
            <div className={`oh-inv-form${formType === "invoice" ? " oh-inv-form--invoice" : ""}${isCreditMemo ? " oh-inv-form--credit" : ""}`}>
              <CompletionBar account={account} photosReady={photosReady} hasVendor={hasVendor} hasDetails={hasDetails} glBalanced={glBalanced} done={stepComplete} />

              {/* Two-way type toggle */}
              <div className="oh-inv-type-toggle">
                <button
                  className={`oh-inv-type-btn${formType === "invoice" ? " oh-inv-type-btn--active" : ""}`}
                  onClick={() => {
                    setFormType("invoice");
                    setPages((prev) => prev.map((p) => p.gateResult === null && p.gate === "pass" ? { ...p, gate: "scanning", gateResult: null } : p));
                    pages.forEach((p) => { if (p.gateResult === null && p.gate === "pass") runPhotoGate(p.pid, p.data); });
                  }}
                >Vendor Invoice</button>
                <button
                  className={`oh-inv-type-btn oh-inv-type-btn--credit${formType === "credit" ? " oh-inv-type-btn--active" : ""}`}
                  onClick={() => {
                    setFormType("credit");
                    setPages((prev) => prev.map((p) => p.gateResult === null && p.gate === "pass" ? { ...p, gate: "scanning", gateResult: null } : p));
                    pages.forEach((p) => { if (p.gateResult === null && p.gate === "pass") runPhotoGate(p.pid, p.data); });
                  }}
                >Credit / Return</button>
              </div>

              {formType === "invoice" && (
                <div className="oh-inv-invoice-notice">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                  <span>Standard vendor invoice — select vendor, enter invoice # and GL coding.</span>
                </div>
              )}
              {isCreditMemo && (
                <div className="oh-inv-credit-notice">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  <span>Credit mode — total will be submitted as a <strong>negative amount</strong> to offset a prior invoice.</span>
                </div>
              )}

              {/* ══ SECTION 1: ACCOUNT ══ */}
              <div className="oh-inv-section">
                <div className={`oh-inv-field-group${hasAccount ? " oh-inv-field--done" : ""}`} data-field="account">
                  <label className="oh-inv-label">Account <span className="oh-inv-req">*</span></label>
                  <select className={`oh-inv-select${errors.account ? " oh-inv-error" : ""}`} value={account} onChange={(e) => setAccount(e.target.value)}>
                    <option value="">Select Account...</option>
                    {accounts.map((a) => <option key={a.key} value={a.key}>{a.label || a.key}</option>)}
                  </select>
                </div>
              </div>

              {/* ══ SECTION 2: EVIDENCE ══ */}
              <div className="oh-inv-section">
                <div className="oh-inv-section-head">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                  <span>Evidence</span>
                </div>

                <div className={`oh-inv-field-group${!hasAccount ? " oh-inv-field--disabled" : ""}${photosReady ? " oh-inv-field--done" : ""}`} data-field="pages">

                  {/* ─── Label row: label left, reorder button right ─── */}
                  <div className="oh-inv-label-row">
                    <label className="oh-inv-label">
                      Invoice Photo{pages.length > 1 ? "s" : ""} / PDF <span className="oh-inv-req">*</span>
{pages.length > 0 && <span className="oh-inv-label-hint">{pages.length}/15 pages {gateScanning ? "⏳" : gateAllCleared ? "✓" : ""}</span>}
                    </label>
                    {pages.length >= 2 && (
                      <button
                        className={`oh-inv-reorder-btn${reorderMode ? " oh-inv-reorder-btn--active" : ""}`}
                        onClick={() => { setReorderMode(!reorderMode); setSelectedPageIdx(null); }}
                        title={reorderMode ? "Done reordering" : "Reorder pages"}
                      >
                        {reorderMode ? (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                            Done
                          </>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="5" x2="21" y2="5" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="19" x2="21" y2="19" /></svg>
                            Reorder
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Fixed-height hint strip — reserves space, prevents layout shift */}
                  <div className="oh-inv-reorder-hint-strip">
                    {reorderMode && (
                      <span className={`oh-inv-reorder-hint${selectedPageIdx !== null ? " oh-inv-reorder-hint--active" : ""}`}>
                        {selectedPageIdx !== null ? "Tap another page to place it there" : "Tap a page to pick it up"}
                      </span>
                    )}
                    {consistencyChecking && !reorderMode && (
                      <span className="oh-inv-consistency-indicator">
                        <div className="oh-spinner-sm" style={{ width: 11, height: 11 }} />
                        Checking pages...
                      </span>
                    )}
                  </div>

                  <div className={`oh-inv-page-strip${pages.length === 0 ? " oh-inv-page-strip--empty" : ""}${reorderMode ? " oh-inv-page-strip--reorder" : ""}`}>
                    {pages.map((p, i) => {
                      const isRogue = consistencyIssues.some((iss) => iss.pid === p.pid);
                      const isSelected = reorderMode && selectedPageIdx === i;
                      const isPickTarget = reorderMode && selectedPageIdx !== null && selectedPageIdx !== i;

                      return (
                        <div
                          key={p.pid || i}
                          className={[
                            "oh-inv-page-card",
                            p.gate === "fail" ? "oh-inv-page-card--fail" : "",
                            p.gate === "warn" ? "oh-inv-page-card--warn" : "",
                            p.gate === "scanning" ? "oh-inv-page-card--scanning" : "",
                            isRogue ? "oh-inv-page-card--rogue" : "",
                            isSelected ? "oh-inv-page-card--selected" : "",
                            isPickTarget ? "oh-inv-page-card--pick-target" : "",
                            reorderMode && !isSelected ? "oh-inv-page-card--reorderable" : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => handlePageTap(i)}
                        >
                          <img src={p.data} alt={`Page ${i + 1}`} style={{ transform: `rotate(${p.rotation}deg)` }} />
                          <div className="oh-inv-page-badge">{p.type === "pdf" ? "PDF" : "IMG"} · {i + 1}</div>

                          {/* Page number badge */}
                          {p.pageNumber != null && (
                            <div className={`oh-inv-page-num-badge${p.pageNumberConfidence === "high" ? " oh-inv-page-num-badge--confident" : " oh-inv-page-num-badge--uncertain"}`}>
                              p.{p.pageNumber}{p.pageNumberConfidence !== "high" ? "?" : ""}
                            </div>
                          )}

                          {/* Selected: floating grip badge with page number */}
                          {isSelected && (
                            <div className="oh-inv-page-grip-badge">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="9" cy="6" r="1.5" fill="currentColor" />
                                <circle cx="15" cy="6" r="1.5" fill="currentColor" />
                                <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                                <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                                <circle cx="9" cy="18" r="1.5" fill="currentColor" />
                                <circle cx="15" cy="18" r="1.5" fill="currentColor" />
                              </svg>
                              {(selectedPageIdx ?? 0) + 1}
                            </div>
                          )}

                          {/* Drop target: pulsing amber insertion line on left edge */}
                          {isPickTarget && (
                            <div className="oh-inv-page-insert-line" />
                          )}

                          {/* Gate status badges */}
                          {p.gate === "scanning" && <div className="oh-inv-gate-badge oh-inv-gate-badge--scanning"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" opacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" /></svg></div>}
                          {p.gate === "pass" && <div className="oh-inv-gate-badge oh-inv-gate-badge--pass"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>}
                          {p.gate === "warn" && <div className="oh-inv-gate-badge oh-inv-gate-badge--warn"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div>}
                          {p.gate === "fail" && <div className="oh-inv-gate-badge oh-inv-gate-badge--fail"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></div>}

                          {/* Page actions — hidden in reorder mode */}
                          {!reorderMode && (
                            <div className="oh-inv-page-actions">
                              <button className="oh-inv-page-action" onClick={(e) => { e.stopPropagation(); rotatePage(i); }} title="Rotate">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /></svg>
                              </button>
                              <button className="oh-inv-page-action oh-inv-page-action--remove" onClick={(e) => { e.stopPropagation(); removePage(i); }} title="Remove">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

{pages.length < 15 && !reorderMode && (
                        <>
                        {pages.length === 0 ? (
                          <div className={`oh-inv-add-card oh-inv-add-card--first${errors.pages ? " oh-inv-error" : ""}${dragOver ? " oh-inv-add-card--drag" : ""}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                            <div className="oh-inv-add-card-icon">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                            </div>
                            <span className="oh-inv-add-card-text">{dragOver ? "Drop here" : "Capture or upload invoice"}</span>
                            <div className="oh-inv-capture-btns">
                              <button className="oh-inv-capture-btn oh-inv-capture-btn--camera" disabled={!hasAccount} onClick={(e) => { e.stopPropagation(); hasAccount && fileInputRef.current?.click(); }} type="button">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                                Take Photo
                              </button>
                              <button className="oh-inv-capture-btn oh-inv-capture-btn--gallery" disabled={!hasAccount} onClick={(e) => { e.stopPropagation(); hasAccount && galleryInputRef.current?.click(); }} type="button">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                Upload / PDF
                              </button>
                            </div>
                          </div>
) : (
  <div
    className={`oh-inv-add-card${errors.pages ? " oh-inv-error" : ""}${dragOver ? " oh-inv-add-card--drag" : ""}`}
    onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
    onClick={() => hasAccount && galleryInputRef.current?.click()}
  >
    <div className="oh-inv-add-card-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></div>
    <span className="oh-inv-add-card-text">{dragOver ? "Drop here" : "Add page"}</span>
  </div>                        )}
                      </>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoCapture} style={{ display: "none" }} />
                    <input ref={galleryInputRef} type="file" accept="image/*,application/pdf" multiple onChange={handlePhotoCapture} style={{ display: "none" }} />
                  </div>

                  {/* ═══ NOTICES (priority order) ═══ */}
                  {(() => {
                    // PRIORITY 1: Rogue page detected
                    if (consistencyIssues.length > 0) {
                      return (
                        <div className="oh-inv-notice oh-inv-notice--warn">
                          <div className="oh-inv-notice-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                          </div>
                          <div className="oh-inv-notice-body">
                            {consistencyIssues.map((issue) => {
                              const pageIdx = pages.findIndex((p) => p.pid === issue.pid);
                              if (pageIdx === -1) return null;
                              return <p key={issue.pid} className="oh-inv-notice-msg"><strong>Page {pageIdx + 1}</strong> may not belong — {issue.reason}</p>;
                            })}
                          </div>
                          <div className="oh-inv-notice-actions-col">
                            {consistencyIssues.map((issue) => {
                              const pageIdx = pages.findIndex((p) => p.pid === issue.pid);
                              if (pageIdx === -1) return null;
                              return (
                                <button key={issue.pid} className="oh-inv-notice-action oh-inv-notice-action--remove" onClick={() => removePage(pageIdx)}>
                                  Remove p.{pageIdx + 1}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    // PRIORITY 2: Partial confidence sort suggestion
                    if (partialConfidenceSuggestion) {
                      return (
                        <div className="oh-inv-notice oh-inv-notice--warn">
                          <div className="oh-inv-notice-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                          </div>
                          <div className="oh-inv-notice-body">
                            <p className="oh-inv-notice-msg">AI detected page order: <strong>{partialConfidenceSuggestion.label}</strong></p>
                          </div>
                          <button className="oh-inv-notice-action oh-inv-notice-action--switch" onClick={() => {
                            setPages(partialConfidenceSuggestion.sorted);
                            setConsistencyIssues([]); consistencyCheckKeyRef.current = "";
                            showToast("Pages sorted ✓", "info");
                          }}>Sort</button>
                        </div>
                      );
                    }

                    // PRIORITY 3: Gate-detected type mismatch
                    const anyTypeMismatch = pages.find((p) => p.gateResult?.typeMismatch && p.gateResult?.documentType !== "not_document");
                    if (anyTypeMismatch?.gateResult) {
                      const detected = anyTypeMismatch.gateResult.detectedTypeLabel;
                      const suggested = anyTypeMismatch.gateResult.suggestedType;
                      const supportedSwitch = suggested === "invoice" || suggested === "credit";
                      return (
                        <div className="oh-inv-notice oh-inv-notice--warn">
                          <div className="oh-inv-notice-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                          </div>
                          <div className="oh-inv-notice-body">
                            <p className="oh-inv-notice-msg">This appears to be a <strong>{detected}</strong>. Move to {detected} submission?</p>
                          </div>
                          {supportedSwitch && (
                            <button className="oh-inv-notice-action oh-inv-notice-action--switch" onClick={() => {
                              setFormType(suggested);
                              setPages((prev) => prev.map((pg) => ({ ...pg, gate: "pass", gateResult: { ...pg.gateResult, typeMismatch: false } })));
                              setOcrStatus("idle"); setOcrResult(null);
                            }}>Switch</button>
                          )}
                        </div>
                      );
                    }

                    // PRIORITY 4: Hard block — non-document
                    if (gateFailedPages.length > 0 && ocrStatus !== "scanning") {
                      const p = gateFailedPages[0];
                      const isNotDoc = p.gateResult?.documentType === "not_document";
                      const isObstructed = p.gateResult?.documentType === "obstructed";
                      const msg = p.gateResult?.message || (isNotDoc ? "This doesn't look like a financial document — please photograph an invoice or credit memo." : isObstructed ? "Something is blocking the document. Remove any objects covering the page and retake." : "The document couldn't be read clearly. Lay it flat on a solid surface, ensure good lighting, and retake.");
                      return (
                        <div className="oh-inv-notice oh-inv-notice--block">
                          <div className="oh-inv-notice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg></div>
                          <div className="oh-inv-notice-body"><p className="oh-inv-notice-msg">{msg}</p></div>
                          <button className="oh-inv-notice-action" onClick={() => { removePage(pages.indexOf(p)); setTimeout(() => fileInputRef.current?.click(), 100); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                            Retake
                          </button>
                        </div>
                      );
                    }

                    // PRIORITY 5: Quality warning
                    if (gateWarnPages.length > 0) {
                      const msg = gateWarnPages[0].gateResult?.message || "Photo quality could be better — AP may ask for a clearer copy.";
                      return (
                        <div className="oh-inv-notice oh-inv-notice--warn">
                          <div className="oh-inv-notice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg></div>
                          <div className="oh-inv-notice-body"><p className="oh-inv-notice-msg">{msg}</p></div>
                        </div>
                      );
                    }

                    // PRIORITY 6: OCR rejection
                    if (ocrStatus === "rejected" && ocrResult) {
                      return (
                        <div className="oh-inv-notice oh-inv-notice--block">
                          <div className="oh-inv-notice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg></div>
                          <div className="oh-inv-notice-body">
                            <p className="oh-inv-notice-msg">{ocrResult.reason}</p>
                            {ocrResult.suggestion && <p className="oh-inv-notice-hint">{ocrResult.suggestion}</p>}
                          </div>
                          <button className="oh-inv-notice-action" onClick={() => { setPages([]); setOcrStatus("idle"); setOcrResult(null); setTimeout(() => fileInputRef.current?.click(), 100); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                            Retake
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {ocrStatus === "scanning" && (
                    <div className="oh-inv-ocr-scanning">
                      <div className="oh-spinner-sm" style={{ width: 16, height: 16 }} />
                      <span>Scanning invoice for auto-fill...</span>
                    </div>
                  )}

                  {ocrStatus === "success" && ocrResult && (
                    <div className="oh-inv-ocr-result">
                      <div className="oh-inv-ocr-result-header">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        <span className="oh-inv-ocr-result-title">Auto-detected from scan</span>
                        {ocrResult.confidence !== "high" && <span className="oh-inv-ocr-verify">verify below</span>}
                      </div>
                      <div className="oh-inv-ocr-pills">
                        {ocrResult.invoiceNumber && <div className="oh-inv-ocr-pill"><span className="oh-inv-ocr-pill-label">Invoice #</span><span className="oh-inv-ocr-pill-value">{ocrResult.invoiceNumber}</span></div>}
                        {ocrResult.totalAmount && <div className="oh-inv-ocr-pill oh-inv-ocr-pill--money"><span className="oh-inv-ocr-pill-label">Total</span><span className="oh-inv-ocr-pill-value">${Number(ocrResult.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>}
                        {ocrResult.vendorName && <div className="oh-inv-ocr-pill"><span className="oh-inv-ocr-pill-label">Vendor</span><span className="oh-inv-ocr-pill-value">{ocrResult.vendorName}</span></div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>{/* end SECTION 2 */}

              {/* ══ SECTION 3: DETAILS ══ */}
              <div className="oh-inv-section">
                <div className={`oh-inv-section-head${hasVendor && totalAmount ? " oh-inv-section-head--done" : ""}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <span>Details &amp; Coding</span>
                </div>

                {/* Vendor */}
                <div className={`oh-inv-field-group${!hasAccount ? " oh-inv-field--disabled" : ""}${vendor ? " oh-inv-field--done" : ""}`} data-field="vendor">
                  <label className="oh-inv-label">Vendor <span className="oh-inv-req">*</span></label>
                  {ocrStatus === "success" && ocrResult?.vendorName && !vendor && ocrResult.vendorMatch?.bestMatch && (
                    <div className="oh-inv-vendor-detected">
                      <div className="oh-inv-vendor-detected-header">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        <span>Match found for <strong>{ocrResult.vendorName}</strong></span>
                      </div>
                      <button className="oh-inv-vendor-detected-confirm" onClick={() => {
                        const mv = vendors.find((v) => v.vendorId === ocrResult.vendorMatch.bestMatch.vendorId);
                        if (mv) { setVendor(mv); trackRecentVendor(mv.vendorId); showToast(`Vendor set: ${mv.name}`, "info"); }
                      }}>
                        <span className="oh-inv-vendor-detected-name">{ocrResult.vendorMatch.bestMatch.name}</span>
                        <span className="oh-inv-vendor-detected-action">Tap to confirm →</span>
                      </button>
                      {ocrResult.vendorMatch.alternatives?.length > 0 && (
                        <div className="oh-inv-vendor-detected-alts">
                          <span className="oh-inv-vendor-detected-alts-label">Not right?</span>
                          {ocrResult.vendorMatch.alternatives.map((alt) => (
                            <button key={alt.vendorId} className="oh-inv-vendor-detected-alt-pill" onClick={() => {
                              const mv = vendors.find((v) => v.vendorId === alt.vendorId);
                              if (mv) { setVendor(mv); trackRecentVendor(mv.vendorId); }
                            }}>{alt.name}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {ocrStatus === "success" && ocrResult?.vendorName && !vendor && !ocrResult.vendorMatch?.bestMatch && (
                    <div className="oh-inv-vendor-detected oh-inv-vendor-detected--new">
                      <div className="oh-inv-vendor-detected-header">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        <span>Detected <strong>{ocrResult.vendorName}</strong> — not in your vendor list yet</span>
                      </div>
                      <button className="oh-inv-vendor-detected-confirm oh-inv-vendor-detected-confirm--create" onClick={() => setShowVendorSetup(true)}>
                        <span className="oh-inv-vendor-detected-name">+ Add {ocrResult.vendorName}</span>
                        <span className="oh-inv-vendor-detected-action">Set up this vendor →</span>
                      </button>
                    </div>
                  )}
                  {hasAccount && !vendor && recentVendors.length > 0 && (
                    <div className="oh-inv-recent-vendors">
                      <span className="oh-inv-recent-label">Recent:</span>
                      {recentVendors.map((v) => <button key={v.vendorId} className="oh-inv-recent-pill" onClick={() => { setVendor(v); trackRecentVendor(v.vendorId); }}>{v.name}</button>)}
                    </div>
                  )}
                  {bootstrapLoading ? (
                    <div className="oh-inv-loading-pill"><div className="oh-spinner-sm" style={{ width: 14, height: 14 }} /> Loading vendors...</div>
                  ) : hasAccount && vendors.length === 0 && !(ocrStatus === "success" && ocrResult?.vendorName) ? (
                    <div className="oh-inv-vendor-empty" onClick={() => setShowVendorSetup(true)}>
                      <div className="oh-inv-vendor-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></div>
                      <div className="oh-inv-vendor-empty-text"><span className="oh-inv-vendor-empty-title">No vendors for this account</span><span className="oh-inv-vendor-empty-desc">Tap to add your first vendor</span></div>
                    </div>
                  ) : !vendor && vendors.length > 0 && (
                    <div className="oh-inv-vendor-row">
                      <VendorTypeAhead vendors={vendors} value={vendor} onChange={(v) => { setVendor(v); trackRecentVendor(v.vendorId); }} onAddNew={() => setShowVendorSetup(true)} hasError={errors.vendor} disabled={!hasAccount} />
                    </div>
                  )}
                  {vendor && (
                    <div className="oh-inv-vendor-card">
                      <div className="oh-inv-vendor-card-header">
                        <span className="oh-inv-vendor-card-name">{vendor.name}</span>
                        {vendor.category && <span className="oh-inv-vendor-card-cat">{vendor.category}</span>}
                        <div className="oh-inv-vendor-card-actions">
                          {vendor.portalUrl && <a href={vendor.portalUrl} target="_blank" rel="noopener noreferrer" className="oh-inv-vendor-portal-btn" title="Open ordering portal" onClick={(e) => e.stopPropagation()}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg></a>}
                          <button className="oh-inv-vendor-card-clear" onClick={() => setVendor(null)} title="Change vendor"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
                        </div>
                      </div>
<div className="oh-inv-vendor-card-details">
                        {vendor.customerAccountNum && <span className="oh-inv-vendor-detail"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="18" rx="2" /><line x1="2" y1="9" x2="22" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>Acct# {vendor.customerAccountNum}</span>}
                        {vendor.deliveryDays && <span className="oh-inv-vendor-detail"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>{vendor.deliveryDays}</span>}
                                                {vendor.paymentTerms && <span className="oh-inv-vendor-detail"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>{vendor.paymentTerms}</span>}
                        {vendor.salesRepName && <span className="oh-inv-vendor-detail"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>{vendor.salesRepName}</span>}
                        {vendor.deliveryMethod && <span className="oh-inv-vendor-detail"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>{vendor.deliveryMethod}</span>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Invoice # + Date */}
                <div className={`oh-inv-row-2col${!hasVendor ? " oh-inv-field--disabled" : ""}`}>
                  <div className="oh-inv-field-group" data-field="invoiceNumber">
                    <label className="oh-inv-label">{isCreditMemo ? "Credit Memo #" : "Invoice #"} <span className="oh-inv-req">*</span></label>
                    <div className="oh-inv-input-wrap">
                      <input type="text" className={`oh-inv-input${errors.invoiceNumber ? " oh-inv-error" : ""}${ocrStatus === "success" && ocrResult?.invoiceNumber && invoiceNumber === ocrResult.invoiceNumber ? " oh-inv-input--autofilled" : ""}`} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder={isCreditMemo ? "CM-001" : "INV-001"} disabled={!hasVendor} />
                      {ocrStatus === "success" && ocrResult?.invoiceNumber && invoiceNumber === ocrResult.invoiceNumber && <span className="oh-inv-autofill-badge">AI</span>}
                    </div>
                  </div>
                  <div className="oh-inv-field-group" data-field="invoiceDate">
                    <label className="oh-inv-label">Date <span className="oh-inv-req">*</span></label>
                    <input type="date" className={`oh-inv-input${errors.invoiceDate ? " oh-inv-error" : ""}`} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={!hasVendor} />
                  </div>
                </div>

                {/* Total */}
                <div className={`oh-inv-field-group${!hasVendor ? " oh-inv-field--disabled" : ""}${Number(totalAmount) > 0 ? " oh-inv-field--done" : ""}`} data-field="totalAmount">
                  <label className="oh-inv-label">{isCreditMemo ? "Credit Amount" : "Invoice Total"} <span className="oh-inv-req">*</span></label>
                  <div className="oh-inv-money-input">
                    <span className={`oh-inv-money-prefix${isCreditMemo ? " oh-inv-money-prefix--credit" : ""}`}>{isCreditMemo ? "−$" : "$"}</span>
                    <input type="number" className={`oh-inv-input oh-inv-input-money${errors.totalAmount ? " oh-inv-error" : ""}${isCreditMemo ? " oh-inv-input--credit" : ""}${ocrStatus === "success" && ocrResult?.totalAmount && totalAmount === ocrResult.totalAmount ? " oh-inv-input--autofilled" : ""}`} value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} onBlur={(e) => { if (e.target.value) setTotalAmount(parseFloat(e.target.value).toFixed(2)); }} placeholder="0.00" step="0.01" min="0" disabled={!hasVendor} style={{ paddingLeft: isCreditMemo ? 36 : 30 }} />
                    {ocrStatus === "success" && ocrResult?.totalAmount && totalAmount === ocrResult.totalAmount && <span className="oh-inv-autofill-badge oh-inv-autofill-badge--money">AI</span>}
                  </div>
                </div>

                {/* GL Coding */}
                <div className={`oh-inv-field-group${!hasVendor ? " oh-inv-field--disabled" : ""}${glRows.some(r => r.code && Number(r.amount) > 0) ? " oh-inv-field--done" : ""}`} data-field="glRows">
                  <label className="oh-inv-label">GL Coding <span className="oh-inv-req">*</span></label>
                  <div className="oh-inv-gl-container">
                    <GLCodeTable glCodes={glCodes} rows={glRows} onChange={setGlRows} hasError={errors.glRows} disabled={!hasVendor} />
                    {Number(totalAmount) > 0 && (
                      <div data-field="glBalance" className={`oh-inv-gl-balance${Math.abs(glBalanceDiff) > 0.01 ? " oh-inv-gl-balance--warn" : " oh-inv-gl-balance--ok"}${errors.glBalance ? " oh-inv-gl-balance--error" : ""}`}>
                        <div className="oh-inv-gl-balance-track">
                          <div className={`oh-inv-gl-balance-fill${Math.abs(glBalanceDiff) <= 0.01 ? " oh-inv-gl-balance-fill--full" : glTotal > Number(totalAmount) ? " oh-inv-gl-balance-fill--over" : ""}`} style={{ width: `${Math.min(100, Number(totalAmount) > 0 ? (glTotal / Number(totalAmount)) * 100 : 0)}%` }} />
                        </div>
                        <div className="oh-inv-gl-balance-text">
                          <span className="oh-inv-gl-balance-total">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                            GL: ${fmt$(glTotal)} / ${fmt$(totalAmount)}
                          </span>
                          {Math.abs(glBalanceDiff) > 0.01 ? (
                            <span className="oh-inv-gl-diff">{glBalanceDiff > 0 ? `$${fmt$(glBalanceDiff)} remaining` : `$${fmt$(Math.abs(glBalanceDiff))} over`}</span>
                          ) : (
                            <span className="oh-inv-gl-match"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>Balanced</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stamp Preview */}
                {pages.length > 0 && hasVendor && invoiceNumber && (
                  <div className="oh-inv-field-group">
                    <InvoicePreview page={pages[0].data} account={account} vendor={vendor?.name || ""} invoiceNumber={invoiceNumber} invoiceDate={invoiceDate} totalAmount={totalAmount} glRows={glRows} />
                  </div>
                )}
              </div>{/* end SECTION 3 */}

              {/* Validation Summary */}
              {Object.keys(errors).length > 0 && (
                <div className="oh-inv-validation-summary">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <div className="oh-inv-validation-summary-body">
                    <strong>Fix before submitting:</strong>
                    <ul>
                      {errors.account      && <li>No account selected</li>}
                      {errors.pages        && <li>No invoice photo or PDF attached</li>}
                      {errors.vendor       && <li>No vendor selected</li>}
                      {errors.invoiceNumber && <li>Invoice # is required</li>}
                      {errors.invoiceDate  && <li>Invoice date is required</li>}
                      {errors.totalAmount  && <li>Invoice total must be greater than $0</li>}
                      {errors.glRows       && <li>At least one GL code with an amount is required</li>}
                      {errors.glBalance    && <li>GL total {glBalanceDiff > 0 ? `is $${fmt$(glBalanceDiff)} short` : `is $${fmt$(Math.abs(glBalanceDiff))} over`} — must match invoice total of ${fmt$(totalAmount)}</li>}
                    </ul>
                  </div>
                </div>
              )}

              {/* Submit Footer */}
              <div className="oh-inv-submit-footer">
                {showNoteField && (
                  <div className="oh-inv-note-field">
                    <textarea className="oh-inv-textarea" value={apNote} onChange={(e) => setApNote(e.target.value)} placeholder="Note for AP — rush, credit memo context, etc." rows={2} />
                  </div>
                )}
                <div className="oh-inv-submit-options">
                  <button className={`oh-inv-option-toggle${showNoteField ? " oh-inv-option-toggle--active" : ""}`} onClick={() => { setShowNoteField(!showNoteField); if (showNoteField) setApNote(""); }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    Note
                  </button>
                  <span className="oh-inv-shortcut-hint">⌘ Enter</span>
                </div>
                <button
                  className={`oh-inv-submit-btn${submitting ? " oh-inv-submitting" : ""}${isCreditMemo ? " oh-inv-submit-btn--credit" : ""}`}
                  onClick={handleSubmit} disabled={submitting || !hasVendor}
                >
                  {submitting ? (
                    <><div className="oh-spinner-sm" />Uploading {pages.length} page{pages.length !== 1 ? "s" : ""}...</>
                  ) : (
                    <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>{isCreditMemo ? "Submit Credit Memo" : "Submit Invoice"}</>
                  )}
                </button>
              </div>
            </div>
          )}
        </>
        )}
      </div>

      {showVendorSetup && (
        <VendorSetup account={account} vendorMaster={vendorMaster}
          onClose={() => setShowVendorSetup(false)}
          onCreated={(newVendor) => { setShowVendorSetup(false); setVendor(newVendor); loadBootstrap(account); showToast(`${newVendor.name || "Vendor"} added ✓`, "success"); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}