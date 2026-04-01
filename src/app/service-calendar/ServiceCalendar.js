"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import DayDetail from "./DayDetail";

const GREEN = "#0F6E56";
const AMBER = "#EF9F27";
const RED = "#dc2626";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function fmt$(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
function fmtK(n) { return n >= 1000 ? "$" + Math.round(n/1000) + "K" : "$" + Math.round(n); }

function getCalendarWeeks(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let start = new Date(first);
  const dow = start.getDay();
  start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));
  const weeks = [];
  let cur = new Date(start);
  while (weeks.length < 7) {
    const week = [];
    for (let i = 0; i < 7; i++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    weeks.push(week);
    if (cur > last && cur.getDay() === 1) break;
  }
  return weeks;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const CAT_ORDER = { PDC: 1, MLB: 2, MiLB: 3 };
const CAT_LABELS = { PDC: "Player Development", MLB: "Major League", MiLB: "Minor League" };

function AccountDropdown({ accounts, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = accounts.find(a => a.key === value);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const grouped = {};
  accounts.forEach(a => { const cat = a.category || "Other"; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(a); });
  const catOrder = Object.keys(grouped).sort((a, b) => (CAT_ORDER[a]||9) - (CAT_ORDER[b]||9));
  return (
    <div className="sc-dropdown" ref={ref}>
      <button className="sc-dropdown-trigger" onClick={() => setOpen(!open)}>
        <span className="sc-dropdown-val">{selected ? `${selected.key} — ${selected.name}` : "Select..."}</span>
        <svg className={`sc-dropdown-arrow ${open ? "sc-dropdown-arrow--open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="sc-dropdown-menu">
          {catOrder.map(cat => (
            <div key={cat}>
              <div className="sc-dropdown-cat">{CAT_LABELS[cat] || cat}</div>
              {grouped[cat].map(a => (
                <button key={a.key} className={`sc-dropdown-item ${a.key === value ? "sc-dropdown-item--active" : ""}`}
                  onClick={() => { onChange(a.key); setOpen(false); }}>
                  <span>{a.key} — {a.name}</span>
                  {a.key === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ServiceCalendar({ showToast, session }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [year] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth());
  const [viewMode, setViewMode] = useState("month");
  const [data, setData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [focusDay, setFocusDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const focusRef = useRef(null);

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkValues, setBulkValues] = useState({});
  const bulkRef = useRef(null);

  useEffect(() => {
    fetch("/api/service-calendar?action=sc-accounts")
      .then(r => r.json())
      .then(d => { if (d.success && d.accounts?.length) { const sorted = d.accounts.sort((a, b) => (CAT_ORDER[a.category]||9) - (CAT_ORDER[b.category]||9) || a.key.localeCompare(b.key)); setAccounts(sorted); setSelectedAccount(sorted[0].key); } })
      .catch(() => showToast("Failed to load accounts", "error"));
  }, [showToast]);

  const mk = `${year}-${String(month+1).padStart(2,"0")}`;
  const loadData = useCallback(() => {
    if (!selectedAccount) return;
    setLoading(true); setFocusDay(null); setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); else { showToast(d.error || "Failed", "error"); setData(null); } })
      .catch(() => { showToast("Network error", "error"); setData(null); })
      .finally(() => setLoading(false));
  }, [selectedAccount, mk, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (viewMode !== "year" || !selectedAccount) return;
    fetch(`/api/service-calendar?action=sc-year-summary&account=${selectedAccount}`)
      .then(r => r.json()).then(d => { if (d.success) setYearData(d.months); }).catch(() => {});
  }, [viewMode, selectedAccount]);

  const dayMap = useMemo(() => { const m = {}; if (data?.days) data.days.forEach(d => { m[d.date] = d; }); return m; }, [data]);
  const priceLookup = useMemo(() => { const p = {}; if (data?.serviceGroups) data.serviceGroups.forEach(g => g.services.forEach(s => { p[s.colIndex] = s.price; })); return p; }, [data]);

  const metrics = useMemo(() => {
    if (!data?.days?.length) return { projMeals: 0, actMeals: 0, projRev: 0, actRev: 0, complete: 0, needsEntry: 0, overdue: 0, total: 0 };
    let projMeals = 0, actMeals = 0, projRev = 0, actRev = 0, complete = 0, needsEntry = 0, overdue = 0;
    for (const day of data.days) {
      if (day.hasActuals) complete++;
      else if (day.isPast && day.isLocked) overdue++;
      else if (day.isPast) needsEntry++;
      for (const ci of Object.keys(day.projected)) {
        const price = priceLookup[ci] || 0; const pv = day.projected[ci];
        if (pv != null) { projMeals += pv; projRev += pv * price; }
        if (day.hasActuals && day.actual[ci] != null) { actMeals += day.actual[ci]; actRev += day.actual[ci] * price; }
      }
    }
    return { projMeals, actMeals, projRev, actRev, complete, needsEntry, overdue, total: data.days.length };
  }, [data, priceLookup]);

  const variance = metrics.actRev - metrics.projRev;
  const completionPct = metrics.total > 0 ? Math.round(metrics.complete / metrics.total * 100) : 0;

  const dayStatus = useCallback((day) => {
    if (!day) return "off";
    const allZero = Object.values(day.projected).every(v => v === null || v === 0);
    if (day.hasActuals && allZero) return "no-service";
    if (day.hasActuals) return "entered";
    if (day.isPast && day.isLocked) return "overdue";
    if (day.isPast) return "needs-entry";
    return "future";
  }, []);

  const daySummary = useCallback((day) => {
    if (!day) return { meals: 0, revenue: 0 };
    let meals = 0, rev = 0;
    for (const ci of Object.keys(day.projected)) {
      const val = day.hasActuals && day.actual[ci] != null ? day.actual[ci] : day.projected[ci];
      if (val != null) { meals += val; rev += val * (priceLookup[ci] || 0); }
    }
    return { meals, revenue: rev };
  }, [priceLookup]);

  const handleSave = useCallback(async (day, entries) => {
    if (!data?.account) return; setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, spreadsheetId: data.account.spreadsheetId, date: day.date, sheetRow: day.sheetRow, entries }) });
      const result = await res.json();
      if (result.success) { showToast(`Actuals saved for ${day.date}`, "success"); loadData(); }
      else showToast(result.error || "Save failed", "error");
    } catch { showToast("Network error", "error"); } finally { setSaving(false); }
  }, [data, showToast, loadData]);

  const handleConfirmAsProjected = useCallback(async (day) => {
    if (!data?.account || !data?.serviceGroups) return;
    const entries = []; for (const g of data.serviceGroups) { for (const s of g.services) { entries.push({ colIndex: s.colIndex, value: day.projected[s.colIndex] ?? 0 }); } }
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, spreadsheetId: data.account.spreadsheetId, date: day.date, sheetRow: day.sheetRow, entries }) });
      const result = await res.json();
      if (result.success) { showToast("Confirmed as projected", "success"); loadData(); }
      else showToast(result.error || "Save failed", "error");
    } catch { showToast("Network error", "error"); } finally { setSaving(false); }
  }, [data, showToast, loadData]);

  // ── Bulk save: writes same values to all selected days ──
  const handleBulkSave = useCallback(async () => {
    if (!data?.account || !data?.serviceGroups || bulkSelected.size === 0) return;
    const entries = [];
    for (const g of data.serviceGroups) {
      for (const s of g.services) {
        const val = bulkValues[s.colIndex];
        entries.push({ colIndex: s.colIndex, value: val !== undefined && val !== "" ? Number(val) : 0 });
      }
    }
    setSaving(true);
    let successCount = 0;
    for (const dk of bulkSelected) {
      const day = dayMap[dk];
      if (!day) continue;
      try {
        const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, spreadsheetId: data.account.spreadsheetId, date: day.date, sheetRow: day.sheetRow, entries }) });
        const result = await res.json();
        if (result.success) successCount++;
      } catch { /* continue */ }
    }
    setSaving(false);
    showToast(`Saved actuals for ${successCount} of ${bulkSelected.size} days`, "success");
    setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    loadData();
  }, [data, dayMap, bulkSelected, bulkValues, showToast, loadData]);

  // Bulk confirm as projected for all selected
  const handleBulkConfirm = useCallback(async () => {
    if (!data?.account || !data?.serviceGroups || bulkSelected.size === 0) return;
    setSaving(true);
    let successCount = 0;
    for (const dk of bulkSelected) {
      const day = dayMap[dk];
      if (!day) continue;
      const entries = [];
      for (const g of data.serviceGroups) { for (const s of g.services) { entries.push({ colIndex: s.colIndex, value: day.projected[s.colIndex] ?? 0 }); } }
      try {
        const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, spreadsheetId: data.account.spreadsheetId, date: day.date, sheetRow: day.sheetRow, entries }) });
        const result = await res.json();
        if (result.success) successCount++;
      } catch { /* continue */ }
    }
    setSaving(false);
    showToast(`Confirmed ${successCount} days as projected`, "success");
    setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    loadData();
  }, [data, dayMap, bulkSelected, showToast, loadData]);

  const toggleBulkSelect = useCallback((dk) => {
    setBulkSelected(prev => { const next = new Set(prev); if (next.has(dk)) next.delete(dk); else next.add(dk); return next; });
  }, []);

  const weeks = useMemo(() => getCalendarWeeks(year, month), [year, month]);
  const today = dateKey(new Date());
  const todayMonth = new Date().getMonth();
  const goToToday = useCallback(() => { setMonth(todayMonth); setViewMode("month"); setTimeout(() => setFocusDay(today), 100); }, [todayMonth, today]);

  const focusDayData = focusDay ? dayMap[focusDay] : null;
  const dayList = data?.days?.map(d => d.date) || [];
  const focusIdx = focusDay ? dayList.indexOf(focusDay) : -1;
  const canPrev = focusIdx > 0; const canNext = focusIdx < dayList.length - 1;
  const navDay = useCallback((dir) => { const ni = focusIdx + dir; if (ni >= 0 && ni < dayList.length) setFocusDay(dayList[ni]); }, [focusIdx, dayList]);

  const acctObj = accounts.find(a => a.key === selectedAccount);
  const category = acctObj?.category || "";

  // Init bulk values from first selected day's projections
  useEffect(() => {
    if (bulkPanelOpen && data?.serviceGroups) {
      const vals = {};
      for (const g of data.serviceGroups) { for (const s of g.services) { vals[s.colIndex] = ""; } }
      setBulkValues(vals);
    }
  }, [bulkPanelOpen, data]);

  const STATUS = {
    "entered": { icon: "✓", className: "sc-badge--entered" },
    "no-service": { icon: "—", className: "sc-badge--noservice" },
    "needs-entry": { icon: "✎", className: "sc-badge--needs" },
    "overdue": { icon: "!", className: "sc-badge--overdue" },
    "future": { icon: "○", className: "sc-badge--future" },
  };

  return (
    <div className="sc-root">
      <div className="sc-card">
        <div className="sc-header">
          <div className="sc-header-account">
            <AccountDropdown accounts={accounts} value={selectedAccount} onChange={setSelectedAccount} />
            {category && <span className={`sc-cat sc-cat--${category.toLowerCase()}`}>{category}</span>}
          </div>
          <div className="sc-mode-group">
            {["year","month"].map(v => (
              <button key={v} className={`sc-mode-btn ${viewMode === v ? "sc-mode-btn--active" : ""}`} onClick={() => { setViewMode(v); setFocusDay(null); setBulkMode(false); }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
            <div className="sc-mode-divider" />
            <button className="sc-mode-btn sc-mode-btn--today" onClick={goToToday}>Today</button>
          </div>
          <div className="sc-date-nav">
            {viewMode === "month" && (
              <>
                <button className="sc-date-btn" onClick={() => setMonth(p => Math.max(0, p-1))}>&#8249;</button>
                <span className="sc-date-label">{MONTHS[month]} {year}</span>
                <button className="sc-date-btn" onClick={() => setMonth(p => Math.min(11, p+1))}>&#8250;</button>
              </>
            )}
            {viewMode === "year" && <span className="sc-date-label">{year}</span>}
          </div>
        </div>

        {viewMode === "month" && (
          <div className="sc-month-body sc-fade-in">
            {data && !loading && (
              <>
                <div className="sc-metrics">
                  <div className="sc-metric-block">
                    <div className="sc-metric-label">Meals</div>
                    <div className="sc-metric-row"><span className="sc-metric-hero">{metrics.actMeals.toLocaleString()}</span><span className="sc-metric-context">of {metrics.projMeals.toLocaleString()} projected</span></div>
                  </div>
                  <div className="sc-metric-divider" />
                  <div className="sc-metric-block">
                    <div className="sc-metric-label">Revenue</div>
                    <div className="sc-metric-row"><span className="sc-metric-hero sc-metric-hero--green">{fmt$(metrics.actRev)}</span><span className="sc-metric-context">of {fmt$(metrics.projRev)}</span></div>
                  </div>
                  <div className="sc-metric-divider" />
                  <div className="sc-metric-block">
                    <div className="sc-metric-label">Variance</div>
                    <div className={`sc-metric-hero ${variance >= 0 ? "sc-metric-hero--green" : "sc-metric-hero--red"}`}>{variance >= 0 ? "+" : ""}{fmt$(variance)}</div>
                  </div>
                  <div className="sc-metric-divider" />
                  <div className="sc-metric-block">
                    <div className="sc-metric-label">Days complete</div>
                    <div className="sc-metric-row"><span className="sc-metric-hero" style={{ color: (metrics.needsEntry + metrics.overdue) > 0 ? AMBER : GREEN }}>{metrics.complete}</span><span className="sc-metric-context">/ {metrics.total}</span></div>
                    <div className="sc-progress-bar"><div className="sc-progress-fill" style={{ width: completionPct + "%", background: (metrics.needsEntry + metrics.overdue) > 0 ? AMBER : GREEN }} /></div>
                    {metrics.complete < metrics.total && <div className="sc-metric-warn sc-metric-warn--link" onClick={() => { setBulkMode(true); setFocusDay(null); }}>{metrics.total - metrics.complete} days remaining →</div>}
                  </div>
                </div>

                {/* Bulk mode action bar — only visible when active */}
                {bulkMode && (
                  <div className="sc-bulk-bar">
                    <div className="sc-bulk-active">
                      <span className="sc-bulk-count">{bulkSelected.size} day{bulkSelected.size !== 1 ? "s" : ""} selected</span>
                      <div className="sc-bulk-actions">
                        {bulkSelected.size > 0 && (
                          <>
                            <button className="sc-btn sc-btn--outline" disabled={saving} onClick={handleBulkConfirm}>{saving ? "Saving..." : "All match projections"}</button>
                            <button className="sc-btn sc-btn--primary" disabled={saving} onClick={() => setBulkPanelOpen(true)}>Enter custom values</button>
                          </>
                        )}
                        <button className="sc-bulk-cancel" onClick={() => { setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false); }}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {loading && <div className="sc-loading"><div className="oh-spinner" /><p>Loading...</p></div>}

            {!loading && data && (
              <>
                <div className="sc-grid-header">{DOW_LABELS.map(d => <div key={d} className="sc-dow">{d}</div>)}</div>

                {weeks.map((week, wi) => {
                  const inMonth = week.filter(d => d.getMonth() === month);
                  const wDays = inMonth.map(d => dayMap[dateKey(d)]).filter(Boolean);
                  const wEntered = wDays.filter(d => d.hasActuals);
                  const wRev = wDays.reduce((s, d) => s + daySummary(d).revenue, 0);

                  return (
                    <div key={wi}>
                      <div className="sc-week-row">
                        {week.map((d, di) => {
                          const inM = d.getMonth() === month;
                          const dk = dateKey(d);
                          const dd = inM ? dayMap[dk] : null;
                          const isToday = dk === today;
                          const isFocused = !bulkMode && dk === focusDay;
                          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                          const isBulkSelected = bulkMode && bulkSelected.has(dk);

                          if (!inM) return <div key={di} className="sc-tile sc-tile--empty" />;
                          if (!dd) return (
                            <div key={di} className={`sc-tile sc-tile--off ${isWeekend ? "sc-tile--weekend" : ""}`}>
                              <div className="sc-tile-date">{d.getDate()}</div>
                              {isWeekend && <div className="sc-tile-off-label">off</div>}
                            </div>
                          );

                          const status = dayStatus(dd);
                          const { meals, revenue } = daySummary(dd);
                          const st = STATUS[status] || STATUS["future"];
                          const borderColor = status === "entered" || status === "no-service" ? GREEN : status === "overdue" ? RED : status === "needs-entry" ? AMBER : "#e5e7eb";
                          const bg = isBulkSelected ? "#E1F5EE" : status === "overdue" ? "#fef2f2" : status === "needs-entry" ? "#fffbeb" : isFocused ? "#f0fdf4" : "#fff";
                          const gameType = dd.meta?.gameType || "";

                          const handleTileClick = () => {
                            if (bulkMode) { if (!dd.hasActuals) toggleBulkSelect(dk); }
                            else setFocusDay(isFocused ? null : dk);
                          };

                          return (
                            <div key={di}
                              className={`sc-tile sc-tile--active ${isFocused ? "sc-tile--focused" : ""} ${isToday ? "sc-tile--today" : ""} ${isBulkSelected ? "sc-tile--bulk-selected" : ""} ${bulkMode && !dd.hasActuals ? "sc-tile--bulk-selectable" : ""}`}
                              style={{ borderLeftColor: borderColor, background: bg }}
                              onClick={handleTileClick}>
                              <div className="sc-tile-top">
                                <span className={`sc-tile-date ${isToday ? "sc-tile-date--today" : ""}`}>
                                  {d.getDate()}
                                  {isToday && <span className="sc-today-pill">TODAY</span>}
                                </span>
                                {bulkMode && !dd.hasActuals ? (
                                  <span className={`sc-bulk-check ${isBulkSelected ? "sc-bulk-check--on" : ""}`}>{isBulkSelected ? "✓" : ""}</span>
                                ) : (
                                  <span className={`sc-badge ${st.className}`}>{st.icon}</span>
                                )}
                              </div>
                              {gameType && <div className="sc-tile-game">{gameType}</div>}
                              {status === "no-service" ? (
                                <div className="sc-tile-noservice">No service</div>
                              ) : (
                                <>
                                  <div className={`sc-tile-meals ${dd.hasActuals ? "" : "sc-tile-meals--proj"}`}>{meals.toLocaleString()} meals</div>
                                  <div className={`sc-tile-rev ${dd.hasActuals ? "sc-tile-rev--actual" : status === "future" ? "sc-tile-rev--future" : "sc-tile-rev--projected"}`}>
                                    {!dd.hasActuals && status !== "future" ? "est. " : ""}{status === "future" ? "~" : ""}{fmtK(revenue)}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {wDays.length > 0 && !bulkPanelOpen && (
                        <div className="sc-week-summary">
                          <span className="sc-week-progress">{wEntered.length}/{wDays.length} entered</span>
                          <span className="sc-week-rev">{fmt$(wRev)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Bulk entry panel */}

                <div className={`sc-month-footer ${metrics.complete === metrics.total && metrics.total > 0 ? "sc-month-footer--done" : (metrics.needsEntry + metrics.overdue) > 0 ? "sc-month-footer--warn" : ""}`}>
                  <span>{MONTHS[month]} · {metrics.complete} entered · {metrics.needsEntry + metrics.overdue} need entry · {metrics.total - metrics.complete - metrics.needsEntry - metrics.overdue} upcoming</span>
                  <span className="sc-month-footer-rev">{fmt$(metrics.actRev || metrics.projRev)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {viewMode === "year" && (
          <div className="sc-year-body sc-fade-in">
            {/* Color legend */}
            <div className="sc-year-legend">
              <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Entered</span>
              <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--needs" />Needs entry</span>
              <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--overdue" />Overdue</span>
              <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--future" />Future</span>
              <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-day" />Off day</span>
            </div>

            <div className="sc-year-grid">
              {MONTHS.map((name, mi) => {
                const mKey = `${year}-${String(mi+1).padStart(2,"0")}`;
                const md = yearData?.find(m => m.month === mKey);
                const isCurrent = mi === new Date().getMonth();
                const pct = md && md.totalDays > 0 ? Math.round(md.daysWithActuals / md.totalDays * 100) : 0;
                const noService = md && md.projectedRevenue === 0 && md.totalDays > 0;

                // Build mini calendar + day lookup
                const mWeeks = getCalendarWeeks(year, mi);
                const dayLookup = {};
                if (md?.days) md.days.forEach(d => { dayLookup[d.date] = d; });

                // Revenue: show actual when available, projected otherwise
                const hasActuals = md && md.daysWithActuals > 0;
                const displayRev = hasActuals ? md.actualRevenue : (md?.projectedRevenue || 0);

                return (
                  <div key={mi} className={`sc-year-card ${isCurrent ? "sc-year-card--current" : ""}`}
                    style={{ animationDelay: `${mi * 40}ms` }}
                    onClick={() => { setMonth(mi); setViewMode("month"); }}>
                    <div className="sc-year-card-header">
                      <span className="sc-year-card-name">{name}</span>
                      <span className="sc-year-card-cue">View →</span>
                    </div>

                    {/* DOW headers */}
                    <div className="sc-heatmap-header">
                      {["M","T","W","T","F","S","S"].map((d,i) => <span key={i} className="sc-heatmap-dow">{d}</span>)}
                    </div>

                    {/* Heatmap dot grid */}
                    <div className="sc-heatmap">
                      {mWeeks.slice(0, 6).map((week, wi) => (
                        <div key={wi} className="sc-heatmap-row">
                          {week.map((d, di) => {
                            const inM = d.getMonth() === mi;
                            if (!inM) return <div key={di} className="sc-dot sc-dot--empty" />;
                            const dk = dateKey(d);
                            const dayInfo = dayLookup[dk];
                            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                            const gameType = dayInfo?.gameType?.toLowerCase() || "";

                            // No data for this day
                            if (!dayInfo) {
                              if (isWeekend) return <div key={di} className="sc-dot sc-dot--empty" />;
                              return <div key={di} className="sc-dot sc-dot--off-day" />;
                            }

                            // MLB game type borders
                            let gameClass = "";
                            if (gameType.includes("home")) gameClass = "sc-dot--home";
                            else if (gameType.includes("away")) gameClass = "sc-dot--away";
                            else if (gameType === "off") gameClass = "sc-dot--day-off";

                            return <div key={di} className={`sc-dot sc-dot--${dayInfo.status} ${gameClass}`} />;
                          })}
                        </div>
                      ))}
                    </div>

                    {noService ? (
                      <div className="sc-year-card-noservice">No services this month</div>
                    ) : (
                      <>
                        <div className="sc-year-card-stats">
                          <span>{md?.daysWithActuals || 0}/{md?.totalDays || 0} entered</span>
                          <span className={`sc-year-card-rev ${hasActuals ? "sc-year-card-rev--actual" : ""}`}>
                            {displayRev > 0 ? fmtK(displayRev) : "$0"}
                          </span>
                        </div>
                        <div className="sc-year-bar"><div className="sc-year-bar-fill" style={{ width: pct + "%" }} /></div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Day detail overlay */}
      {focusDay && focusDayData && data?.serviceGroups && (
        <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setFocusDay(null); }}>
          <div className="sc-overlay-card">
            <DayDetail day={focusDayData} serviceGroups={data.serviceGroups}
              overrides={data.overrides?.filter(o => o.date === focusDay) || []}
              onSave={handleSave} onConfirmAsProjected={handleConfirmAsProjected} saving={saving}
              dayIndex={focusIdx} totalDays={dayList.length} monthRevenue={metrics.actRev || metrics.projRev}
              onPrev={canPrev ? () => navDay(-1) : null} onNext={canNext ? () => navDay(1) : null}
              onClose={() => setFocusDay(null)} />
          </div>
        </div>
      )}

      {/* Bulk entry overlay */}
      {bulkPanelOpen && data?.serviceGroups && (
        <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setBulkPanelOpen(false); }}>
          <div className="sc-overlay-card">
            <div className="sc-day">
              <div className="sc-day-header">
                <div>
                  <h3 className="sc-day-title">Bulk entry — {bulkSelected.size} days</h3>
                </div>
                <button className="sc-day-close" onClick={() => setBulkPanelOpen(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="sc-day-coaching" style={{ background: "#f9fafb", borderColor: "#e5e7eb", color: "#6b7280" }}>
                Enter values once, apply to all {bulkSelected.size} selected days.
              </div>
              <div className="sc-day-body">
                {data.serviceGroups.map(group => (
                  <div key={group.name} className="sc-day-group">
                    <div className="sc-day-group-header">
                      <span className="sc-day-group-name">{group.name}</span>
                      <span className="sc-day-group-price">${Number(group.services[0]?.price || 0).toFixed(2)}/plate</span>
                    </div>
                    {group.services.map(svc => (
                      <div key={svc.colIndex} className="sc-day-row">
                        <div className="sc-day-row-left">
                          <span className="sc-day-row-name">{svc.name}</span>
                        </div>
                        <div className="sc-day-row-right">
                          <input type="text" inputMode="numeric" pattern="[0-9]*"
                            className="sc-day-input sc-day-input--ghost"
                            placeholder="0" value={bulkValues[svc.colIndex] || ""}
                            onChange={e => setBulkValues(prev => ({ ...prev, [svc.colIndex]: e.target.value.replace(/[^0-9]/g, "") }))} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="sc-day-footer">
                <div className="sc-day-actions">
                  <button className="sc-btn sc-btn--outline" onClick={() => setBulkPanelOpen(false)}>Cancel</button>
                  <button className="sc-btn sc-btn--primary" disabled={saving} onClick={handleBulkSave}>
                    {saving ? "Saving..." : `Save to ${bulkSelected.size} days`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}