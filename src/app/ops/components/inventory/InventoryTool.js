"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import F from "@/app/ops/components/shared/F";
import { ClipboardIcon } from "@/app/ops/components/shared/Icons";
import CostInput from "@/app/ops/components/inventory/CostInput";
import HistoryEntry from "@/app/ops/components/inventory/HistoryEntry";

const CACHE_KEY = "kf_inv_draft";
const LAST_ACC_KEY = "kf_ops_last_account";
const PERIOD_SEEN_KEY = "kf_inv_period_seen";

export default function InventoryTool({ config, showToast, openConfirm, onNavigate, refreshConfig }) {
  const [account, setAccount] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(LAST_ACC_KEY) || "" : ""
  );
  const [food, setFood] = useState("");
  const [packaging, setPackaging] = useState("");
  const [supplies, setSupplies] = useState("");
  const [snacks, setSnacks] = useState("");
  const [beverages, setBeverages] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [existingEntry, setExistingEntry] = useState(null);
  const [periodPop, setPeriodPop] = useState(false);
  const [manualPeriod, setManualPeriod] = useState(null);
  const [focusedRow, setFocusedRow] = useState(null);
  const [displayTotal, setDisplayTotal] = useState(0);
  const [locationPop, setLocationPop] = useState(false);
  const [activeTab, setActiveTab] = useState("form");
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [undoData, setUndoData] = useState(null);
  const [undoTimer, setUndoTimer] = useState(null);
  const [showPeriodGlow, setShowPeriodGlow] = useState(false);

  const foodRef = useRef(null);
  const packRef = useRef(null);
  const suppRef = useRef(null);
  const snackRef = useRef(null);
  const bevRef = useRef(null);
  const inputRefs = useMemo(() => [foodRef, packRef, suppRef, snackRef, bevRef], []);
  const popRef = useRef(null);
  const locPopRef = useRef(null);

  const accounts = config?.accounts || [];
  const allPeriods = config?.periods || [];
  const currentPeriod = config?.currentPeriod;
  const inventoryLog = config?.inventoryLog || [];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(PERIOD_SEEN_KEY);
    if (!seen) {
      setShowPeriodGlow(true);
      const t = setTimeout(() => {
        setShowPeriodGlow(false);
        localStorage.setItem(PERIOD_SEEN_KEY, "1");
      }, 3000);
      return () => clearTimeout(t);
    }
  }, []);

  const accountLevel = useMemo(() => {
    if (!account) return "";
    const acct = accounts.find((a) => a.label === account);
    return acct?.level || "";
  }, [account, accounts]);

  const isSeasonal = accountLevel === "MLB" || accountLevel === "MILB" || accountLevel === "AAA";

  const accountActivePeriods = useMemo(() => {
    if (!account) return new Set();
    const acct = accounts.find((a) => a.label === account);
    if (!acct || !acct.activePeriods || acct.activePeriods.length === 0) return new Set();
    return new Set(acct.activePeriods);
  }, [account, accounts]);

  const periods = useMemo(() => {
    if (!account) return allPeriods;
    if (accountActivePeriods.size > 0) {
      return allPeriods.filter((p) => accountActivePeriods.has(p.name));
    }
    return allPeriods;
  }, [account, allPeriods, accountActivePeriods]);

  const activePeriodObj = useMemo(() => {
    if (manualPeriod) {
      return periods.find((p) => p.name === manualPeriod) || currentPeriod || periods[0];
    }
    if (account && periods.length > 0) {
      for (const p of periods) {
        const hasSubmission = inventoryLog.some((e) => e.account === account && e.period === p.name);
        if (!hasSubmission) return p;
      }
      return periods[periods.length - 1];
    }
    return currentPeriod || (periods.length > 0 ? periods[0] : null);
  }, [account, periods, inventoryLog, currentPeriod, manualPeriod]);

  const activePeriod = activePeriodObj?.name || "P1";
  const daysLeft = F.daysUntil(activePeriodObj?.due);
  const progress = F.periodProgress(activePeriodObj?.start, activePeriodObj?.end);

  const prevEntry = useMemo(() => {
    if (!account || !activePeriod) return null;
    const periodIdx = periods.findIndex((p) => p.name === activePeriod);
    if (periodIdx <= 0) return null;
    const prevPeriodName = periods[periodIdx - 1]?.name;
    return inventoryLog.find((e) => e.account === account && e.period === prevPeriodName) || null;
  }, [account, activePeriod, periods, inventoryLog]);

  useEffect(() => {
    if (account && activePeriod) {
      const existing = inventoryLog.find((e) => e.account === account && e.period === activePeriod);
      setExistingEntry(existing || null);
      if (existing) {
        setFood(F.comma(existing.food));
        setPackaging(F.comma(existing.packaging));
        setSupplies(F.comma(existing.supplies));
        setSnacks(F.comma(existing.snacks));
        setBeverages(F.comma(existing.beverages));
        setNotes(existing.notes || "");
      } else {
        restoreCache();
      }
    } else {
      setExistingEntry(null);
    }
  }, [account, activePeriod, inventoryLog]);

  useEffect(() => {
    if (account && typeof window !== "undefined") localStorage.setItem(LAST_ACC_KEY, account);
  }, [account]);

  const cacheKey = `${CACHE_KEY}_${account}_${activePeriod}`;

  const saveCache = useCallback(() => {
    if (!account || existingEntry) return;
    const draft = { food, packaging, supplies, snacks, beverages, notes, ts: Date.now() };
    try {
      localStorage.setItem(cacheKey, JSON.stringify(draft));
      setLastSaved(new Date());
    } catch {}
  }, [cacheKey, food, packaging, supplies, snacks, beverages, notes, account, existingEntry]);

  const restoreCache = useCallback(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Date.now() - d.ts > 86400000) { localStorage.removeItem(cacheKey); return; }
      if (d.food) setFood(d.food);
      if (d.packaging) setPackaging(d.packaging);
      if (d.supplies) setSupplies(d.supplies);
      if (d.snacks) setSnacks(d.snacks);
      if (d.beverages) setBeverages(d.beverages);
      if (d.notes) setNotes(d.notes);
      setLastSaved(new Date(d.ts));
    } catch {}
  }, [cacheKey]);

  useEffect(() => { saveCache(); }, [saveCache]);

  const total = F.num(food) + F.num(packaging) + F.num(supplies) + F.num(snacks) + F.num(beverages);

  const tickerRef = useRef({ start: 0, target: 0, raf: null });
  useEffect(() => {
    const t = tickerRef.current;
    t.start = displayTotal;
    t.target = total;
    if (t.raf) cancelAnimationFrame(t.raf);
    const startTime = performance.now();
    const duration = 400;
    function tick(now) {
      const p = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplayTotal(t.start + (t.target - t.start) * ease);
      if (p < 1) t.raf = requestAnimationFrame(tick);
    }
    t.raf = requestAnimationFrame(tick);
    return () => { if (t.raf) cancelAnimationFrame(t.raf); };
  }, [total]);

  useEffect(() => {
    if (!periodPop && !locationPop) return;
    const handler = (e) => {
      if (periodPop && popRef.current && !popRef.current.contains(e.target)) setPeriodPop(false);
      if (locationPop && locPopRef.current && !locPopRef.current.contains(e.target)) setLocationPop(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [periodPop, locationPop]);

  const loadHistory = useCallback(() => {
    if (history) return;
    setHistoryLoading(true);
    fetch("/api/ops?action=inventory-history")
      .then((r) => r.json())
      .then((d) => setHistory(d.success ? d.history : []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [history]);

  useEffect(() => {
    if (activeTab === "history") loadHistory();
  }, [activeTab, loadHistory]);

  const handleInput = (setter) => (val) => { setter(F.comma(val)); };
  const handleEnter = (e, nextRef) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (nextRef?.current) nextRef.current.focus();
      else e.target.blur();
    }
  };

  const validate = () => {
    if (!account) { showToast("Select a location first", "error"); return false; }
    if (!food && !packaging && !supplies) { showToast("Enter at least one primary cost", "error"); return false; }
    return true;
  };

  const handleReview = () => { if (validate()) setShowReview(true); };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-inventory", account, period: activePeriod,
          food: F.num(food), packaging: F.num(packaging), supplies: F.num(supplies),
          snacks: F.num(snacks), beverages: F.num(beverages), total, notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowReview(false);
        setShowSuccess(true);
        try { localStorage.removeItem(cacheKey); } catch {}
        refreshConfig();
        setHistory(null);
      } else {
        showToast(data.error || "Submission failed", "error");
      }
    } catch { showToast("Network error", "error"); }
    finally { setSubmitting(false); }
  };

  const handleClear = () => {
    const backup = { food, packaging, supplies, snacks, beverages, notes };
    const hasData = food || packaging || supplies || snacks || beverages || notes;
    if (!hasData) return;
    setUndoData(backup);
    setFood(""); setPackaging(""); setSupplies(""); setSnacks(""); setBeverages(""); setNotes("");
    setFocusedRow(null);
    setLastSaved(null);
    try { localStorage.removeItem(cacheKey); } catch {}
    showToast("Values cleared — tap Undo to restore", "info");
    if (undoTimer) clearTimeout(undoTimer);
    const timer = setTimeout(() => { setUndoData(null); }, 8000);
    setUndoTimer(timer);
  };

  const handleUndo = () => {
    if (!undoData) return;
    setFood(undoData.food || "");
    setPackaging(undoData.packaging || "");
    setSupplies(undoData.supplies || "");
    setSnacks(undoData.snacks || "");
    setBeverages(undoData.beverages || "");
    setNotes(undoData.notes || "");
    setUndoData(null);
    if (undoTimer) clearTimeout(undoTimer);
    showToast("Values restored", "info");
  };

  const handleReset = () => {
    setFood(""); setPackaging(""); setSupplies(""); setSnacks(""); setBeverages("");
    setNotes("");
    setExistingEntry(null); setManualPeriod(null); setFocusedRow(null);
    setLastSaved(null);
    try { localStorage.removeItem(cacheKey); } catch {}
  };

  const handleFinish = () => { setShowSuccess(false); handleReset(); onNavigate("home"); };
  const handleCountAnother = () => {
    setShowSuccess(false);
    handleReset();
    setAccount("");
    setActiveTab("form");
  };

  const isLocked = !!existingEntry;
  const allSubmitted = account && periods.length > 0 && periods.every((p) =>
    inventoryLog.some((e) => e.account === account && e.period === p.name)
  );

  const smartTitle = !account ? "Start Count"
    : isLocked && allSubmitted ? "Kitchen's Closed"
    : isLocked ? "Count Secured ✓"
    : total > 0 ? `Counting ${activePeriod}...`
    : "Start Count";

  const getPeriodStatus = (p) => {
    if (!account) return { status: "open", label: `Due ${F.dateNum(p.due)}` };
    const entry = inventoryLog.find((e) => e.account === account && e.period === p.name);
    if (entry) return { status: "done", label: `${F.dateNum(entry.date || "")} ✓` };
    const d = F.daysUntil(p.due);
    if (d !== null && d < 0) return { status: "overdue", label: "Past Due" };
    return { status: "open", label: `Due ${F.dateNum(p.due)}` };
  };

  const primaryDone = !!(food && packaging && supplies);
  const secondaryDone = !!(F.num(snacks) > 0 && F.num(beverages) > 0);

  const draftTimeLabel = useMemo(() => {
    if (!lastSaved || isLocked || !account) return null;
    const seconds = Math.round((Date.now() - lastSaved.getTime()) / 1000);
    if (seconds < 5) return "Draft saved just now";
    if (seconds < 60) return `Draft saved ${seconds}s ago`;
    const mins = Math.round(seconds / 60);
    return `Draft saved ${mins}m ago`;
  }, [lastSaved, isLocked, account]);

  const [, setDraftTick] = useState(0);
  useEffect(() => {
    if (!lastSaved) return;
    const iv = setInterval(() => setDraftTick((t) => t + 1), 10000);
    return () => clearInterval(iv);
  }, [lastSaved]);

  const groupedAccounts = useMemo(() => {
    const pdc = accounts.filter((a) => a.level === "PDC");
    const mlb = accounts.filter((a) => a.level === "MLB");
    const milb = accounts.filter((a) => a.level === "MILB" || a.level === "AAA");
    const corp = accounts.filter((a) => a.level === "CORP" || (!a.level && a.key?.startsWith("CORP")));
    const other = accounts.filter((a) =>
      !["MLB", "PDC", "MILB", "AAA", "CORP"].includes(a.level) && !a.key?.startsWith("CORP")
    );
    return { pdc, mlb, milb, corp, other };
  }, [accounts]);

  const completedPeriodsSummary = useMemo(() => {
    if (!allSubmitted || !account) return [];
    return periods.map((p) => {
      const entry = inventoryLog.find((e) => e.account === account && e.period === p.name);
      return { period: p.name, total: entry?.total || 0, date: entry?.date || "" };
    });
  }, [allSubmitted, account, periods, inventoryLog]);

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════
  return (
    <div className="oh-view" style={{ animation: "oh-slideUp 0.4s ease" }}>
      <div className="oh-widget">

        {/* ── Loading Skeleton ── */}
        {!config && (
          <div className="oh-inv-skeleton">
            <div className="oh-inv-skeleton-bar oh-inv-skeleton-bar--wide" />
            <div className="oh-inv-skeleton-row">
              <div className="oh-inv-skeleton-bar oh-inv-skeleton-bar--icon" />
              <div className="oh-inv-skeleton-bar oh-inv-skeleton-bar--title" />
            </div>
            <div className="oh-inv-skeleton-bar oh-inv-skeleton-bar--control" />
            <div className="oh-inv-skeleton-bar oh-inv-skeleton-bar--progress" />
            <div className="oh-inv-skeleton-bar oh-inv-skeleton-bar--seg" />
            {[1,2,3].map(i => (
              <div key={i} className="oh-inv-skeleton-bar oh-inv-skeleton-bar--input" />
            ))}
          </div>
        )}

        {/* ── Main Content ── */}
        {config && (
          <>
            <div className="oh-widget-header">
              <div className="oh-widget-meta">
                <span className="oh-widget-meta-range">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {activePeriodObj ? `${activePeriod}: from ${F.dateNum(activePeriodObj.start)}` : activePeriod}
                </span>
                <span className="oh-widget-meta-right">
                  <span className={`oh-widget-due oh-due-${F.daysUrgency(daysLeft)}`}>
                    DUE: {F.dateNum(activePeriodObj?.due)}
                  </span>
                  {undoData ? (
                    <button className="oh-btn-undo oh-btn-undo--pulse" onClick={handleUndo}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M1 4v6h6" /><path d="M3.51 15A9 9 0 1 0 5.64 5.64L1 10" /></svg>
                      Undo Clear
                    </button>
                  ) : (
                    <button className="oh-btn-refresh" onClick={handleClear}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                      Clear
                    </button>
                  )}
                </span>
              </div>

              <div className="oh-widget-hero-row">
                <div style={{ position: "relative" }} ref={popRef}>
                  <button className={`oh-widget-icon-circle oh-icon-btn${showPeriodGlow ? " oh-period-glow" : ""}`} onClick={() => setPeriodPop(!periodPop)} aria-label="Select Period">
                    <ClipboardIcon />
                  </button>
                  <span className="oh-period-icon-label">{activePeriod} ▾</span>
                  {periodPop && (
                    <div className="oh-popover oh-popover--scrollable">
                      <div className="oh-popover-header">Select Period</div>
                      <div className="oh-popover-body">
                        {periods.map((p) => {
                          const ps = getPeriodStatus(p);
                          const isCurrent = p.name === activePeriod;
                          return (
                            <div key={p.name} className={`oh-pop-item${isCurrent ? " oh-pop-current" : ""}${ps.status === "overdue" ? " oh-pop-past" : ""}`}
                              onClick={() => { setManualPeriod(p.name); setPeriodPop(false); }}>
                              <span style={{ fontWeight: 700 }}>{p.name}</span>
                              <span className={`oh-pop-status oh-pop-status--${ps.status}`}>{ps.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="oh-widget-hero-text">
                  <h2 className="oh-widget-title">{smartTitle}</h2>
                  <div className="oh-widget-controls">
                    <div style={{ position: "relative", flex: 1, maxWidth: 260 }} ref={locPopRef}>
                      <button className={`oh-location-select${account ? " oh-location-select--filled" : ""}`} onClick={() => setLocationPop(!locationPop)} type="button">
                        <span className="oh-location-select-text">{account || "Select Location"}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, transition: "transform 0.2s", transform: locationPop ? "rotate(180deg)" : "none" }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {locationPop && (
                        <div className="oh-popover oh-popover--location">
                          <div className="oh-popover-header">Select Location</div>
                          <div className="oh-popover-body">
                            {groupedAccounts.pdc.length > 0 && (<>
                              <div className="oh-pop-group-label">Player Development</div>
                              {groupedAccounts.pdc.map((a) => (
                                <div key={a.key} className={`oh-pop-item${a.label === account ? " oh-pop-current" : ""}`}
                                  onClick={() => { setAccount(a.label); setManualPeriod(null); handleReset(); setLocationPop(false); }}>
                                  <span>{a.label}</span>{a.label === account && <span className="oh-pop-check">✓</span>}
                                </div>
                              ))}
                            </>)}
                            {groupedAccounts.mlb.length > 0 && (<>
                              <div className="oh-pop-group-label">MLB</div>
                              {groupedAccounts.mlb.map((a) => (
                                <div key={a.key} className={`oh-pop-item${a.label === account ? " oh-pop-current" : ""}`}
                                  onClick={() => { setAccount(a.label); setManualPeriod(null); handleReset(); setLocationPop(false); }}>
                                  <span>{a.label}</span>{a.label === account && <span className="oh-pop-check">✓</span>}
                                </div>
                              ))}
                            </>)}
                            {groupedAccounts.milb.length > 0 && (<>
                              <div className="oh-pop-group-label">Minor League</div>
                              {groupedAccounts.milb.map((a) => (
                                <div key={a.key} className={`oh-pop-item${a.label === account ? " oh-pop-current" : ""}`}
                                  onClick={() => { setAccount(a.label); setManualPeriod(null); handleReset(); setLocationPop(false); }}>
                                  <span>{a.label}</span>{a.label === account && <span className="oh-pop-check">✓</span>}
                                </div>
                              ))}
                            </>)}
                            {groupedAccounts.corp.length > 0 && (<>
                              <div className="oh-pop-group-label">Corporate</div>
                              {groupedAccounts.corp.map((a) => (
                                <div key={a.key} className={`oh-pop-item${a.label === account ? " oh-pop-current" : ""}`}
                                  onClick={() => { setAccount(a.label); setManualPeriod(null); handleReset(); setLocationPop(false); }}>
                                  <span>{a.label}</span>{a.label === account && <span className="oh-pop-check">✓</span>}
                                </div>
                              ))}
                            </>)}
                            {groupedAccounts.other.map((a) => (
                              <div key={a.key} className={`oh-pop-item${a.label === account ? " oh-pop-current" : ""}`}
                                onClick={() => { setAccount(a.label); setManualPeriod(null); handleReset(); setLocationPop(false); }}>
                                <span>{a.label}</span>{a.label === account && <span className="oh-pop-check">✓</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <span className={`oh-urgency-badge oh-urgency-${isLocked ? "safe" : F.daysUrgency(daysLeft)}`}>
                      {isLocked ? `Completed ${F.dateNum(existingEntry?.date)} ✓` : F.daysLabel(daysLeft)}
                    </span>
                  </div>
                </div>
              </div>

              {draftTimeLabel && !isLocked && (
                <div className="oh-draft-indicator">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  {draftTimeLabel}
                </div>
              )}

              <div className="oh-progress-bar">
                <div className="oh-progress-fill" style={{ width: `${isLocked ? 100 : progress}%`, backgroundColor: isLocked ? "#10b981" : undefined }} />
              </div>
            </div>

            <div className="oh-seg-wrap">
              <div className="oh-seg-track">
                <div className="oh-seg-slider" style={{ transform: activeTab === "history" ? "translateX(100%)" : "translateX(0)" }} />
                <button className={`oh-seg-btn${activeTab === "form" ? " oh-seg-btn--active" : ""}`} onClick={() => setActiveTab("form")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  Count
                </button>
                <button className={`oh-seg-btn${activeTab === "history" ? " oh-seg-btn--active" : ""}`} onClick={() => setActiveTab("history")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  History
                </button>
              </div>
            </div>

            {activeTab === "form" && (
              <>
                {allSubmitted && account ? (
                  <div className="oh-kitchen-closed">
                    <div className="oh-kitchen-closed-hero">
                      <div className="oh-kitchen-closed-icon">🍳</div>
                      <h3 className="oh-kitchen-closed-title">Kitchen's Closed</h3>
                      <p className="oh-kitchen-closed-desc">All {periods.length} periods counted for <strong>{account}</strong>. Nothing left on the pass.</p>
                    </div>
                    <div className="oh-kitchen-closed-grid">
                      {completedPeriodsSummary.map((s) => (
                        <div key={s.period} className="oh-kitchen-closed-badge">
                          <span className="oh-kcb-period">{s.period}</span>
                          <span className="oh-kcb-total">{F.money(s.total)}</span>
                        </div>
                      ))}
                    </div>
                    <button className="oh-btn-ghost" style={{ width: "100%", marginTop: 20 }} onClick={() => { setAccount(""); handleReset(); }}>Switch Location</button>
                  </div>
                ) : (
                  <>
                    {!account ? (
                      <div className="oh-empty-prompt">
                        <div className="oh-empty-prompt-icon">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                          </svg>
                        </div>
                        <h3 className="oh-empty-prompt-title">Select a Location</h3>
                        <p className="oh-empty-prompt-desc">Choose your kitchen above to begin your inventory count.</p>
                      </div>
                    ) : (
                      <>
                        <div className={`oh-widget-body${focusedRow ? " oh-dim-mode" : ""}`}>
                          <div className={`oh-group-card${primaryDone ? " oh-group-complete" : ""}`}>
                            <div className="oh-group-header">
                              <span className="oh-group-title">Primary Costs</span>
                              {primaryDone && <span className="oh-group-check oh-check-pop">✓</span>}
                            </div>
                            <CostInput id="food" label="Food Cost" value={food} onChange={handleInput(setFood)} required disabled={isLocked}
                              focused={focusedRow === "food"} onFocus={() => setFocusedRow("food")} onBlur={() => setFocusedRow(null)}
                              inputRef={foodRef} onEnter={(e) => handleEnter(e, packRef)}
                              prevValue={prevEntry?.food} prevPeriod={prevEntry ? periods[periods.findIndex((p) => p.name === activePeriod) - 1]?.name : null} />
                            <CostInput id="pack" label="Packaging" value={packaging} onChange={handleInput(setPackaging)} required disabled={isLocked}
                              focused={focusedRow === "pack"} onFocus={() => setFocusedRow("pack")} onBlur={() => setFocusedRow(null)}
                              inputRef={packRef} onEnter={(e) => handleEnter(e, suppRef)}
                              prevValue={prevEntry?.packaging} prevPeriod={prevEntry ? periods[periods.findIndex((p) => p.name === activePeriod) - 1]?.name : null} />
                            <CostInput id="supp" label="Supplies" value={supplies} onChange={handleInput(setSupplies)} required disabled={isLocked}
                              focused={focusedRow === "supp"} onFocus={() => setFocusedRow("supp")} onBlur={() => setFocusedRow(null)}
                              inputRef={suppRef} onEnter={(e) => handleEnter(e, snackRef)}
                              prevValue={prevEntry?.supplies} prevPeriod={prevEntry ? periods[periods.findIndex((p) => p.name === activePeriod) - 1]?.name : null} />
                          </div>

                          <div className={`oh-group-card${secondaryDone ? " oh-group-complete" : ""}`} style={{ marginTop: 16 }}>
                            <div className="oh-group-header">
                              <span className="oh-group-title">Secondary</span>
                              {secondaryDone && <span className="oh-group-check oh-check-pop">✓</span>}
                            </div>
                            <CostInput id="snack" label="Snacks" value={snacks} onChange={handleInput(setSnacks)} disabled={isLocked}
                              focused={focusedRow === "snack"} onFocus={() => setFocusedRow("snack")} onBlur={() => setFocusedRow(null)}
                              inputRef={snackRef} onEnter={(e) => handleEnter(e, bevRef)}
                              prevValue={prevEntry?.snacks} prevPeriod={prevEntry ? periods[periods.findIndex((p) => p.name === activePeriod) - 1]?.name : null} />
                            <CostInput id="bev" label="Beverages" value={beverages} onChange={handleInput(setBeverages)} disabled={isLocked}
                              focused={focusedRow === "bev"} onFocus={() => setFocusedRow("bev")} onBlur={() => setFocusedRow(null)}
                              inputRef={bevRef} onEnter={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); setFocusedRow(null); } }}
                              prevValue={prevEntry?.beverages} prevPeriod={prevEntry ? periods[periods.findIndex((p) => p.name === activePeriod) - 1]?.name : null} />
                          </div>

                          {!isLocked && (
                            <div className="oh-group-card" style={{ marginTop: 16 }}>
                              <div className="oh-group-header">
                                <span className="oh-group-title">Notes</span>
                                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>Optional</span>
                              </div>
                              <div style={{ padding: "12px 16px 16px" }}>
                                <textarea className="oh-notes-input" placeholder="Large shipment received, seasonal ramp-up, etc."
                                  value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
                              </div>
                            </div>
                          )}

                          {isLocked && (
                            <div className="oh-group-card" style={{ marginTop: 16 }}>
                              <div className="oh-group-header">
                                <span className="oh-group-title">Notes</span>
                              </div>
                              <div style={{ padding: "0 16px 16px" }}>
                                <p style={{ margin: 0, fontSize: 13, color: existingEntry?.notes ? "#64748b" : "#94a3b8", fontStyle: "italic" }}>
                                  {existingEntry?.notes || "No notes recorded"}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="oh-widget-footer">
                          <div className={`oh-footer-row oh-footer-row--animated${total > 0 ? " oh-footer-visible" : ""}`}>
                            <span className="oh-footer-label">Total Value</span>
                            <span className="oh-footer-total">{F.moneyShort(displayTotal)}</span>
                          </div>
                          {total > 0 && (() => {
                            const cats = [
                              { label: "Food", value: F.num(food), color: "#f59e0b" },
                              { label: "Pkg", value: F.num(packaging), color: "#3b82f6" },
                              { label: "Sup", value: F.num(supplies), color: "#8b5cf6" },
                              { label: "Snk", value: F.num(snacks), color: "#10b981" },
                              { label: "Bev", value: F.num(beverages), color: "#ec4899" },
                            ].filter((c) => c.value > 0);
                            return (
                              <div className="oh-breakdown-bar-wrap">
                                <div className="oh-breakdown-bar">
                                  {cats.map((c) => (
                                    <div key={c.label} className="oh-breakdown-seg" style={{ width: `${(c.value / total) * 100}%`, backgroundColor: c.color }}
                                      title={`${c.label}: $${c.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
                                  ))}
                                </div>
                                <div className="oh-breakdown-legend">
                                  {cats.map((c) => (
                                    <span key={c.label} className="oh-breakdown-legend-item">
                                      <span className="oh-breakdown-dot" style={{ backgroundColor: c.color }} />
                                      {c.label} {Math.round((c.value / total) * 100)}%
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                          {isLocked ? (
                            <div className="oh-locked-msg">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                              <span><strong>Locked Record.</strong> {allSubmitted ? "All periods submitted for this account." : `${activePeriod} has been counted. Contact AP to amend.`}</span>
                            </div>
                          ) : (
                            <button className="oh-btn oh-btn--primary" onClick={handleReview} disabled={!account} style={{ width: "100%" }}>Submit Count</button>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {activeTab === "history" && (
              <div className="oh-history-panel">
                {historyLoading ? (
                  <div style={{ textAlign: "center", padding: 48 }}><div className="oh-spinner" style={{ margin: "0 auto" }} /></div>
                ) : (() => {
                  const filtered = (history || []).filter((h) => !account || h.account === account);
                  return filtered.length === 0 ? (
                    <div className="oh-history-empty">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ marginBottom: 12 }}>
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                      {account ? `No submissions yet for ${account}.` : "No submissions yet."}<br />
                      Your history will appear here after your first count.
                    </div>
                  ) : (
                    <div className="oh-history-timeline">
                      {filtered.map((h, i) => (
                        <HistoryEntry key={i} h={h} showAccount={!account}
                          prevTotal={i < filtered.length - 1 ? filtered[i + 1]?.total : null} isFirst={i === 0} />
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {showReview && (
        <div className="oh-modal-overlay" onClick={() => setShowReview(false)}>
          <div className="oh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="oh-modal-icon-circle oh-modal-icon--info">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <h3 className="oh-modal-title">Confirm Count</h3>
            <p className="oh-modal-subtitle">Review values before securing.</p>
            <div className="oh-ticket">
              <div className="oh-ticket-meta"><span>{account}</span><span>{activePeriod}</span></div>
              {(() => {
                const prevPeriodName = prevEntry ? periods[periods.findIndex((p) => p.name === activePeriod) - 1]?.name : null;
                const items = [
                  { l: "Food Cost", v: food, pv: prevEntry?.food },
                  { l: "Packaging", v: packaging, pv: prevEntry?.packaging },
                  { l: "Supplies", v: supplies, pv: prevEntry?.supplies },
                  { l: "Snacks", v: snacks, pv: prevEntry?.snacks },
                  { l: "Beverages", v: beverages, pv: prevEntry?.beverages },
                ].filter((f) => f.v);
                const anomalies = items.filter((f) => {
                  if (!f.pv || f.pv === 0) return false;
                  return Math.abs((F.num(f.v) - f.pv) / f.pv) > 0.4;
                });
                return (
                  <>
                    {items.map((f) => {
                      const pctChange = f.pv > 0 ? ((F.num(f.v) - f.pv) / f.pv * 100) : null;
                      return (
                        <div key={f.l} className="oh-ticket-row">
                          <span>{f.l}</span>
                          <div className="oh-ticket-val-group">
                            <span className="oh-ticket-val">{F.money(F.num(f.v))}</span>
                            {f.pv > 0 && pctChange !== null && Math.round(pctChange) !== 0 && (
                              <span className={`oh-ticket-delta ${Math.abs(pctChange) > 40 ? "oh-ticket-delta--warn" : ""}`}>
                                vs {prevPeriodName}: {pctChange >= 0 ? "+" : ""}{Math.round(pctChange)}%
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="oh-ticket-divider" />
                    <div className="oh-ticket-total"><span>Grand Total</span><span>{F.money(total)}</span></div>
                    {anomalies.length > 0 && (
                      <div className="oh-ticket-warning">
                        <span>⚠️</span>
                        <span>{anomalies.map((a) => a.l).join(", ")} {anomalies.length === 1 ? "is" : "are"} 40%+ different from {prevPeriodName} — please verify.</span>
                      </div>
                    )}
                    {notes.trim() && (
                      <div className="oh-ticket-notes">
                        <span style={{ fontWeight: 600, fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Notes</span>
                        <span style={{ fontSize: 13, color: "#334155", fontStyle: "italic" }}>{notes.trim()}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="oh-modal-actions">
              <button className="oh-btn-ghost" onClick={() => setShowReview(false)}>Edit</button>
              <button className="oh-btn oh-btn--primary" onClick={handleSubmit} disabled={submitting} style={{ flex: 2 }}>
                {submitting && <span className="oh-btn-spinner" />}{submitting ? "Securing..." : "Confirm & Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="oh-modal-overlay">
          <div className="oh-modal oh-modal--success">
            <div className="oh-confetti-container">
              {[...Array(20)].map((_, i) => <div key={i} className="oh-confetti-piece"
                style={{ "--i": i, "--x": `${Math.random() * 100}%`, "--d": `${0.6 + Math.random() * 0.8}s`, "--r": `${Math.random() * 360}deg` }} />)}
            </div>
            <div className="oh-success-circle">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></svg>
            </div>
            <h3 className="oh-modal-title">Inventory Secured 🔒</h3>
            <p className="oh-modal-subtitle">Your {activePeriod} count of <strong>{F.money(total)}</strong> has been logged and leadership notified.</p>
            <div className="oh-success-actions">
              <button className="oh-btn oh-btn--primary" onClick={handleCountAnother} style={{ width: "100%" }}>Count Another Location →</button>
              <button className="oh-btn-ghost" onClick={handleFinish} style={{ width: "100%", marginTop: 8 }}>Back to Home</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}