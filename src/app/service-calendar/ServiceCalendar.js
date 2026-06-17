"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import DayDetail from "./DayDetail";
import ServiceConfig from "./ServiceConfig";

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
  const [reloadKey, setReloadKey] = useState(0);
  const [showConfig, setShowConfig] = useState(false);

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkValues, setBulkValues] = useState({});

  useEffect(() => {
    fetch("/api/service-calendar?action=sc-accounts")
      .then(r => r.json())
      .then(d => { if (d.success && d.accounts?.length) { const sorted = d.accounts.sort((a, b) => (CAT_ORDER[a.category]||9) - (CAT_ORDER[b.category]||9) || a.key.localeCompare(b.key)); setAccounts(sorted); setSelectedAccount(sorted[0].key); } })
      .catch(() => showToast("Failed to load accounts", "error"));
  }, [showToast]);

  const mk = `${year}-${String(month+1).padStart(2,"0")}`;
  useEffect(() => {
    if (!selectedAccount) return;
    const controller = new AbortController();
    setLoading(true); setFocusDay(null); setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); else { showToast(d.error || "Failed", "error"); setData(null); } })
      .catch(e => { if (e.name !== "AbortError") { showToast("Network error", "error"); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedAccount, mk, showToast, reloadKey]);

  useEffect(() => {
    if (viewMode !== "year" || !selectedAccount) return;
    // reloadKey is in the dep array so a save in the month view also
    // refreshes the year heatmap on next visit; without it, the heatmap
    // showed stale grey dots after data flipped to "entered" in PG.
    fetch(`/api/service-calendar?action=sc-year-summary&account=${selectedAccount}`)
      .then(r => r.json()).then(d => { if (d.success) setYearData(d.months); }).catch(() => {});
  }, [viewMode, selectedAccount, reloadKey]);

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

  // Fee-account fork: triggers only for flat_fee accounts that HAVE
  // homestand data. STL-FL is flat_fee but has zero rows in
  // sc_homestand_schedule, so isFeeAccount is false for it and the
  // per-meal display renders (Kevin's decision: STL-FL operators are
  // required to use actuals, same UI as PDC accounts). Per the route's
  // sc-load action, homestandMap is omitted when empty.
  //
  // Declared HERE (not at the bottom of the component) because the
  // feeMetrics + dayStatus hooks below reference them in their
  // dependency arrays - JavaScript TDZ otherwise.
  const isFeeAccount =
    data?.account?.billingModel === "flat_fee" && !!data?.homestandMap;
  const homestandMap = data?.homestandMap || {};

  // Fee-account metrics: count game-day completion + identify the
  // homestand the month is sitting in. Only computed when isFeeAccount;
  // ignored for per-meal display.
  const feeMetrics = useMemo(() => {
    if (!isFeeAccount || !data?.days?.length) {
      return { gameDays: 0, gameDaysEntered: 0, currentHomestand: null, currentHomestandRange: null, currentHomestandGameDays: 0, currentHomestandGameDaysEntered: 0 };
    }
    let gameDays = 0, gameDaysEntered = 0;
    for (const d of data.days) {
      const hs = homestandMap[d.date];
      if (hs?.dayType === "GAME") {
        gameDays++;
        if (d.hasActuals) gameDaysEntered++;
      }
    }
    // Identify "current" homestand: the one containing today's date, or
    // if today is between homestands, the next upcoming one in the
    // currently-viewed month. Falls back to first homestand in month.
    const todayStr = dateKey(new Date());
    const hsToday = homestandMap[todayStr];
    let currentHomestand = hsToday?.homestandId || null;

    // Build per-HS day ranges (from homestandMap entries in this month)
    // so we can show "HS3 — Apr 3 to Apr 9" + "(opponent)" context.
    const byHs = {};
    for (const d of data.days) {
      const hs = homestandMap[d.date];
      if (!hs) continue;
      if (!byHs[hs.homestandId]) byHs[hs.homestandId] = { dates: [], opponents: new Set(), gameDays: 0, gameDaysEntered: 0 };
      byHs[hs.homestandId].dates.push(d.date);
      if (hs.opponent) byHs[hs.homestandId].opponents.add(hs.opponent);
      if (hs.dayType === "GAME") {
        byHs[hs.homestandId].gameDays++;
        if (d.hasActuals) byHs[hs.homestandId].gameDaysEntered++;
      }
    }

    if (!currentHomestand) {
      // Today is not in any homestand. Find the most recent past or
      // first upcoming homestand in this month.
      const hsIds = Object.keys(byHs).sort();
      for (const id of hsIds) {
        const dates = byHs[id].dates;
        if (dates[0] >= todayStr) { currentHomestand = id; break; }
      }
      if (!currentHomestand && hsIds.length > 0) currentHomestand = hsIds[hsIds.length - 1];
    }

    const cur = currentHomestand ? byHs[currentHomestand] : null;
    const currentHomestandRange = cur ? { start: cur.dates[0], end: cur.dates[cur.dates.length - 1], opponents: [...cur.opponents] } : null;
    return {
      gameDays,
      gameDaysEntered,
      currentHomestand,
      currentHomestandRange,
      currentHomestandGameDays: cur?.gameDays || 0,
      currentHomestandGameDaysEntered: cur?.gameDaysEntered || 0,
    };
  }, [isFeeAccount, data, homestandMap]);

  const dayStatus = useCallback((day) => {
    if (!day) return "off";
    // Fee-account branch: homestand-driven schedule view. Mirrors the
    // orchestrator's classify() exactly. Fee accounts never had an
    // actuals-entry requirement, so a past unentered game day is just
    // an unentered scheduled day - returns "future" (clean schedule),
    // not "needs-entry" or "overdue" (false urgency).
    if (isFeeAccount) {
      const hs = homestandMap[day.date];
      if (!hs) return "off-season";
      if (hs.dayType !== "GAME") return "prep";
      if (day.hasActuals) return "entered";
      return "future";
    }
    // Per-meal branch (unchanged).
    // Status describes what was ACTUALLY served, not what was projected.
    // A day where projections were all zero but operators recorded service
    // (e.g. unexpected catering, flat-fee items like Coffee/Fountain Bev
    // showing up on a Battery Camp Sunday) is "entered", not "no-service".
    // A day where actuals were entered but all values are 0 is the real
    // "no-service" - the operator confirmed nothing was served.
    if (day.hasActuals) {
      const allZeroActuals = Object.values(day.actual).every(v => v == null || v === 0);
      return allZeroActuals ? "no-service" : "entered";
    }
    if (day.isPast && day.isLocked) return "overdue";
    if (day.isPast) return "needs-entry";
    return "future";
  }, [isFeeAccount, homestandMap]);

  const daySummary = useCallback((day) => {
    if (!day) return { meals: 0, revenue: 0 };
    let meals = 0, rev = 0;
    for (const ci of Object.keys(day.projected)) {
      const val = day.hasActuals && day.actual[ci] != null ? day.actual[ci] : day.projected[ci];
      if (val != null) { meals += val; rev += val * (priceLookup[ci] || 0); }
    }
    return { meals, revenue: rev };
  }, [priceLookup]);

  // P0-2: returns the API result ({ success, error? }) so DayDetail's
  // executeSave can gate the success screen on a confirmed write. Empty
  // entries are guarded upstream (DayDetail won't even call onSave).
  const handleSave = useCallback(async (day, entries) => {
    if (!data?.account) return { success: false, error: "No account loaded" };
    setSaving(true);
    try {
      // spreadsheetId + sheetRow were leftover from the Sheets-era route;
      // the PG route ignores them. Dropped to keep the payload honest.
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, date: day.date, entries }) });
      const result = await res.json();
      if (result.success) {
        showToast(`Actuals saved for ${day.date}`, "success");
        setReloadKey(k => k + 1);
        return result;
      }
      showToast(result.error || "Save failed", "error");
      return result;
    } catch {
      showToast("Network error", "error");
      return { success: false, error: "Network error" };
    } finally {
      setSaving(false);
    }
  }, [data, showToast]);

  const handleConfirmAsProjected = useCallback(async (day) => {
    if (!data?.account || !data?.serviceGroups) return;
    const entries = []; for (const g of data.serviceGroups) { for (const s of g.services) { entries.push({ colIndex: s.colIndex, value: day.projected[s.colIndex] ?? 0 }); } }
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, spreadsheetId: data.account.spreadsheetId, date: day.date, sheetRow: day.sheetRow, entries }) });
      const result = await res.json();
      if (result.success) { showToast("Confirmed as projected", "success"); setReloadKey(k => k + 1); }
      else showToast(result.error || "Save failed", "error");
    } catch { showToast("Network error", "error"); } finally { setSaving(false); }
  }, [data, showToast]);

  // ── Bulk save: writes same values to all selected days ──
  const handleBulkSave = useCallback(async () => {
    if (!data?.account || !data?.serviceGroups || bulkSelected.size === 0) return;
    // P0-1: only include services where the chef actually typed a value.
    // An untouched bulk input means "leave this service alone for each day"
    // - we must NOT write 0 to it (would zero out existing actuals).
    const entries = [];
    for (const g of data.serviceGroups) {
      for (const s of g.services) {
        const val = bulkValues[s.colIndex];
        if (val !== undefined && val !== "") {
          entries.push({ colIndex: s.colIndex, value: Number(val) });
        }
      }
    }
    if (entries.length === 0) {
      showToast("Enter at least one value before bulk saving", "error");
      return;
    }
    setSaving(true);
    let successCount = 0;
    for (const dk of bulkSelected) {
      const day = dayMap[dk];
      if (!day) continue;
      try {
        // spreadsheetId + sheetRow dropped (Sheets-era leftovers, PG route ignores).
        const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, date: day.date, entries }) });
        const result = await res.json();
        if (result.success) successCount++;
      } catch { /* continue */ }
    }
    setSaving(false);
    showToast(`Saved actuals for ${successCount} of ${bulkSelected.size} days`, "success");
    setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    setReloadKey(k => k + 1);
  }, [data, dayMap, bulkSelected, bulkValues, showToast]);

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
        // spreadsheetId + sheetRow dropped (Sheets-era leftovers, PG route ignores).
        const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, date: day.date, entries }) });
        const result = await res.json();
        if (result.success) successCount++;
      } catch { /* continue */ }
    }
    setSaving(false);
    showToast(`Confirmed ${successCount} days as projected`, "success");
    setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    setReloadKey(k => k + 1);
  }, [data, dayMap, bulkSelected, showToast]);

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
    // Fee-account-only statuses (PR feat/sc-fee-account-display).
    // prep = PREP/OPEN/CLOSE/CLEAN days within a homestand; not actionable
    // for meal entry but part of the season.
    // off-season = no homestand row for this date; rendered invisible on
    // the heatmap and as "off" on month tiles.
    "prep": { icon: "·", className: "sc-badge--prep" },
    "off-season": { icon: "", className: "sc-badge--offseason" },
  };

  return (
    <div className="sc-root" data-density="compact" data-billing={isFeeAccount ? "flat_fee" : "per_meal"}>
      <div className="sc-card">
        <div className="sc-header">
          <div className="sc-header-account">
            <AccountDropdown accounts={accounts} value={selectedAccount} onChange={setSelectedAccount} />
            {category && <span className={`sc-cat sc-cat--${category.toLowerCase()}`}>{category}</span>}
            <button className="sc-cfg-gear" onClick={() => setShowConfig(true)} title="Service config">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
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
                {isFeeAccount ? (
                  // Fee-account metrics: 3 blocks (Meals / Game Days /
                  // Homestand). Revenue + variance + days-complete are
                  // dropped - $0 prices make them noise, and the homestand
                  // axis is the operator's mental model for these accounts.
                  <div className="sc-metrics">
                    <div className="sc-metric-block">
                      <div className="sc-metric-label">Meals</div>
                      <div className="sc-metric-row"><span className="sc-metric-hero">{metrics.actMeals.toLocaleString()}</span><span className="sc-metric-context">delivered this month</span></div>
                    </div>
                    <div className="sc-metric-divider" />
                    <div className="sc-metric-block">
                      <div className="sc-metric-label">Game days</div>
                      <div className="sc-metric-row">
                        <span className="sc-metric-hero" style={{ color: feeMetrics.gameDays === 0 ? "#9ca3af" : (feeMetrics.gameDaysEntered < feeMetrics.gameDays ? AMBER : GREEN) }}>{feeMetrics.gameDaysEntered}</span>
                        <span className="sc-metric-context">/ {feeMetrics.gameDays} this month</span>
                      </div>
                      <div className="sc-progress-bar"><div className="sc-progress-fill" style={{ width: (feeMetrics.gameDays > 0 ? Math.round(feeMetrics.gameDaysEntered / feeMetrics.gameDays * 100) : 0) + "%", background: feeMetrics.gameDaysEntered < feeMetrics.gameDays ? AMBER : GREEN }} /></div>
                    </div>
                    <div className="sc-metric-divider" />
                    <div className="sc-metric-block">
                      <div className="sc-metric-label">Homestand</div>
                      {feeMetrics.currentHomestand ? (
                        <>
                          <div className="sc-metric-row"><span className="sc-metric-hero">{feeMetrics.currentHomestand}</span>{feeMetrics.currentHomestandRange?.opponents?.length > 0 && <span className="sc-metric-context">vs {feeMetrics.currentHomestandRange.opponents.join(" / ")}</span>}</div>
                          {feeMetrics.currentHomestandRange && <div className="sc-metric-context" style={{ fontSize: "11px", marginTop: 2 }}>{feeMetrics.currentHomestandRange.start} → {feeMetrics.currentHomestandRange.end}</div>}
                        </>
                      ) : (
                        <div className="sc-metric-hero" style={{ fontSize: 14, color: "#9ca3af" }}>Between homestands</div>
                      )}
                    </div>
                  </div>
                ) : (
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
                )}

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
                          const hs = isFeeAccount ? homestandMap[dk] : null;

                          // Fee accounts: navy schedule with green when
                          // entered. No urgency colors - the schedule view
                          // shows "here's your season at a glance", not
                          // "here's everything you're behind on". Per-meal
                          // keeps the original entered/overdue/needs logic.
                          let borderColor;
                          if (isFeeAccount) {
                            if (status === "off-season") borderColor = "transparent";
                            else if (status === "prep") borderColor = "#cbd5e1";   // very muted prep
                            else if (status === "entered") borderColor = GREEN;     // operator logged
                            else borderColor = "#1e3a8a";                            // navy game day schedule
                          } else {
                            borderColor = status === "entered" || status === "no-service" ? GREEN : status === "overdue" ? RED : status === "needs-entry" ? AMBER : "#e5e7eb";
                          }
                          const bg = isBulkSelected ? "#E1F5EE" : status === "overdue" ? "#fef2f2" : status === "needs-entry" ? "#fffbeb" : isFocused ? "#f0fdf4" : "#fff";
                          const gameType = dd.meta?.gameType || "";

                          // Fee account: off-season days render as
                          // unclickable off tiles (no homestand activity).
                          if (isFeeAccount && status === "off-season") {
                            return (
                              <div key={di} className={`sc-tile sc-tile--off sc-tile--between-homestands ${isWeekend ? "sc-tile--weekend" : ""}`}>
                                <div className="sc-tile-date">{d.getDate()}</div>
                              </div>
                            );
                          }

                          const handleTileClick = () => {
                            if (bulkMode) { if (!dd.hasActuals) toggleBulkSelect(dk); }
                            else setFocusDay(isFocused ? null : dk);
                          };

                          return (
                            <div key={di}
                              className={`sc-tile sc-tile--active ${isFocused ? "sc-tile--focused" : ""} ${isToday ? "sc-tile--today" : ""} ${isBulkSelected ? "sc-tile--bulk-selected" : ""} ${bulkMode && !dd.hasActuals ? "sc-tile--bulk-selectable" : ""} ${isFeeAccount && status === "prep" ? "sc-tile--prep" : ""}`}
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
                              {isFeeAccount ? (
                                // Fee-account tile body: opponent + HS for
                                // game days, label-only for prep/open/close.
                                hs?.dayType === "GAME" ? (
                                  <>
                                    {hs.opponent && <div className="sc-tile-game">vs {hs.opponent}</div>}
                                    <div className="sc-tile-meals">{hs.homestandId}</div>
                                    {dd.hasActuals && <div className="sc-tile-rev sc-tile-rev--actual">{meals.toLocaleString()} meals</div>}
                                  </>
                                ) : (
                                  <>
                                    <div className="sc-tile-game">{hs?.dayType || "OFF"}</div>
                                    <div className="sc-tile-noservice">{hs?.homestandId || ""}</div>
                                  </>
                                )
                              ) : (
                                <>
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
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {wDays.length > 0 && !bulkPanelOpen && (
                        <div className="sc-week-summary">
                          {isFeeAccount ? (() => {
                            // Fee accounts: count game days in this week,
                            // entered = game day with actuals.
                            const wGame = wDays.filter((d) => homestandMap[d.date]?.dayType === "GAME");
                            const wGameEntered = wGame.filter((d) => d.hasActuals);
                            return (
                              <>
                                <span className="sc-week-progress">{wGameEntered.length}/{wGame.length} game days</span>
                              </>
                            );
                          })() : (
                            <>
                              <span className="sc-week-progress">{wEntered.length}/{wDays.length} entered</span>
                              <span className="sc-week-rev">{fmt$(wRev)}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Bulk entry panel */}

                {isFeeAccount ? (
                  // Fee-account month footer: surface the current
                  // homestand (or "between homestands") + month-wide game
                  // day completion. Drops the revenue total.
                  <div className={`sc-month-footer ${feeMetrics.gameDays > 0 && feeMetrics.gameDaysEntered === feeMetrics.gameDays ? "sc-month-footer--done" : feeMetrics.gameDays > feeMetrics.gameDaysEntered ? "sc-month-footer--warn" : ""}`}>
                    <span>
                      {feeMetrics.currentHomestand ? (
                        <>{feeMetrics.currentHomestand} {feeMetrics.currentHomestandRange ? `· ${feeMetrics.currentHomestandRange.start} → ${feeMetrics.currentHomestandRange.end}` : ""} · {feeMetrics.currentHomestandGameDaysEntered} of {feeMetrics.currentHomestandGameDays} entered</>
                      ) : (
                        <>{MONTHS[month]} · between homestands</>
                      )}
                    </span>
                    <span className="sc-month-footer-rev" style={{ fontSize: 14 }}>{feeMetrics.gameDaysEntered}/{feeMetrics.gameDays} game days this month</span>
                  </div>
                ) : (
                  <div className={`sc-month-footer ${metrics.complete === metrics.total && metrics.total > 0 ? "sc-month-footer--done" : (metrics.needsEntry + metrics.overdue) > 0 ? "sc-month-footer--warn" : ""}`}>
                    <span>{MONTHS[month]} · {metrics.complete} entered · {metrics.needsEntry + metrics.overdue} need entry · {metrics.total - metrics.complete - metrics.needsEntry - metrics.overdue} upcoming</span>
                    <span className="sc-month-footer-rev">{fmt$(metrics.actRev || metrics.projRev)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {viewMode === "year" && (
          <div className="sc-year-body sc-fade-in">
            {/* Color legend - fee accounts get a homestand-centric variant */}
            <div className="sc-year-legend">
              {isFeeAccount ? (
                <>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Game day entered</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--future" />Game day scheduled</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--prep" />Prep / open / close</span>
                </>
              ) : (
                <>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Entered</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--needs" />Needs entry</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--overdue" />Overdue</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--future" />Future</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-day" />Off day</span>
                </>
              )}
            </div>

            <div className="sc-year-grid">
              {MONTHS.map((name, mi) => {
                const mKey = `${year}-${String(mi+1).padStart(2,"0")}`;
                const md = yearData?.find(m => m.month === mKey);
                const isCurrent = mi === new Date().getMonth();
                // Per-meal completion %; fee accounts override below.
                const pct = md && md.totalDays > 0 ? Math.round(md.daysWithActuals / md.totalDays * 100) : 0;

                // Fee account: month has no homestand activity if the
                // pre-aggregated homestandSummary is missing or empty.
                // Per-meal account: "no services" requires both rev =0.
                const hs = md?.homestandSummary;
                const noService = isFeeAccount
                  ? !hs || (hs.gameDays === 0 && hs.prepDays === 0)
                  : (md && md.projectedRevenue === 0 && md.actualRevenue === 0 && md.totalDays > 0);

                // Build mini calendar + day lookup
                const mWeeks = getCalendarWeeks(year, mi);
                const dayLookup = {};
                if (md?.days) md.days.forEach(d => { dayLookup[d.date] = d; });

                // Per-meal-only revenue display values.
                const hasActuals = md && md.daysWithActuals > 0;
                const displayRev = hasActuals ? md.actualRevenue : (md?.projectedRevenue || 0);

                // Fee account: completion% = game days entered / total
                const feePct = isFeeAccount && hs && hs.gameDays > 0
                  ? Math.round(hs.gameDaysEntered / hs.gameDays * 100) : 0;

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

                            // Fee accounts: status comes straight from
                            // the orchestrator classify (entered / needs-
                            // entry / future / prep / off-season). Off-
                            // season days render transparent. No game-
                            // type ring overlay - homestand dayType is
                            // already encoded in the status (prep) and
                            // border is added via attribute selector.
                            if (isFeeAccount) {
                              if (!dayInfo) return <div key={di} className="sc-dot sc-dot--empty" />;
                              if (dayInfo.status === "off-season") return <div key={di} className="sc-dot sc-dot--off-season" />;
                              return <div key={di} className={`sc-dot sc-dot--${dayInfo.status}`} />;
                            }

                            // Per-meal: original behavior preserved.
                            if (!dayInfo) {
                              if (isWeekend) return <div key={di} className="sc-dot sc-dot--empty" />;
                              return <div key={di} className="sc-dot sc-dot--off-day" />;
                            }
                            const gameType = dayInfo?.gameType?.toLowerCase() || "";
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
                      <div className="sc-year-card-noservice">{isFeeAccount ? "No homestands this month" : "No services this month"}</div>
                    ) : isFeeAccount ? (
                      <>
                        <div className="sc-year-card-stats">
                          <span>{hs?.gameDaysEntered || 0}/{hs?.gameDays || 0} game days</span>
                          <span className="sc-year-card-rev">{hs?.homestandIds?.length || 0} HS</span>
                        </div>
                        <div className="sc-year-bar"><div className="sc-year-bar-fill" style={{ width: feePct + "%" }} /></div>
                      </>
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
          <div className="sc-overlay-card" data-density="comfortable">
            <DayDetail day={focusDayData} serviceGroups={data.serviceGroups}
              overrides={data.overrides?.filter(o => o.date === focusDay) || []}
              onSave={handleSave} onConfirmAsProjected={handleConfirmAsProjected} saving={saving}
              dayIndex={focusIdx} totalDays={dayList.length} monthRevenue={metrics.actRev || metrics.projRev}
              isFeeAccount={isFeeAccount} homestandContext={homestandMap[focusDay] || null}
              onPrev={canPrev ? () => navDay(-1) : null} onNext={canNext ? () => navDay(1) : null}
              onClose={() => setFocusDay(null)} />
          </div>
        </div>
      )}

      {/* Bulk entry overlay */}
      {bulkPanelOpen && data?.serviceGroups && (
        <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setBulkPanelOpen(false); }}>
          <div className="sc-overlay-card" data-density="comfortable">
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

      {/* Service config overlay */}
      {showConfig && data?.serviceGroups && (
        <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowConfig(false); }}>
          <div className="sc-overlay-card" data-density="comfortable">
            <ServiceConfig
              account={data.account}
              serviceGroups={data.serviceGroups}
              session={session}
              showToast={showToast}
              onClose={() => setShowConfig(false)}
              onConfigChanged={() => { setShowConfig(false); setReloadKey(k => k + 1); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}