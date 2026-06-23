"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DayDetail from "./DayDetail";
import { isScAdmin } from "@/lib/admin";
import AdminPanel from "./admin/AdminPanel";
import {
  OperationalMetricsStrip,
  OperationalTileBody,
  OperationalWeekSummary,
  OperationalMonthFooter,
  OperationalYearCardStats,
  isOperationalNoService,
} from "./OperationalView";

// Brand palette - exported for sibling display modules (OperationalView
// imports GREEN + AMBER for the operational-only metrics strip).
// One source of truth.
export const GREEN = "#0F6E56";
export const AMBER = "#EF9F27";
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

// Format a Date into "Mon Jun 23" - used by the year heatmap dot tooltips.
const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDotDate(d) {
  return `${DOW_SHORT[d.getDay()]} ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

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
  // year is hardcoded to the active season; month initializes from the
  // CLIENT's local clock, not the server's. The calendar fetch below
  // always sends ?month=YYYY-MM explicitly, so the server-side UTC
  // fallback in route.js sc-load is never reached in practice.
  // Operators span CT/ET/AZ; a server-side default would land the
  // wrong month for an evening operator near a month boundary. Keep
  // this client-local.
  const [year] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth());
  // viewMode: "month" | "year" | "admin". Admin is a fourth in-page view
  // mode, gated client-side by isAdmin (the API actions carry their own
  // server-side isScAdmin gate - that is the real security boundary).
  const [viewMode, setViewMode] = useState("month");
  const [adminView, setAdminView] = useState({ mode: "overview" });
  const [data, setData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [focusDay, setFocusDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Admin gate (client-side - just controls whether the toggle + body
  // RENDER, not authorization). Server-side isScAdmin checks on every
  // admin POST action in route.js remain the security boundary.
  const isAdmin = isScAdmin(session?.user?.email);

  // URL ?view=admin sync (App Router shallow update).
  const router = useRouter();
  const searchParams = useSearchParams();

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkValues, setBulkValues] = useState({});

  useEffect(() => {
    fetch("/api/service-calendar?action=sc-accounts")
      .then(r => r.json())
      .then(d => {
        if (!d.success || !d.accounts?.length) return;
        const sorted = d.accounts.sort((a, b) => (CAT_ORDER[a.category]||9) - (CAT_ORDER[b.category]||9) || a.key.localeCompare(b.key));
        setAccounts(sorted);
        // Account-selection fallback chain:
        //   1. user's mapped account (defaultAccount from user_accounts)
        //   2. CIN-AZ (corp/admin/unmapped operator default)
        //   3. first account in the sorted list
        // The match-against-list check guards against a mapping pointing
        // at an account that isn't currently imported (e.g. CORP rows
        // from the contacts seed; CORP has no sc_services so it's not in
        // the dropdown).
        const fallbacks = [d.defaultAccount, "CIN - AZ"].filter(Boolean);
        let initial = sorted[0].key;
        for (const f of fallbacks) {
          if (sorted.find(a => a.key === f)) { initial = f; break; }
        }
        setSelectedAccount(initial);
        // Mount default: year view ("season-at-a-glance" is the right
        // first read; operators can dropdown into the month for entry).
        // EXCEPT: if the URL deep-links to ?view=admin AND the user is
        // isAdmin, honor the link. Belt-and-suspenders: a shared
        // ?view=admin link opened by a non-admin (e.g. a site lead once
        // the tool widens) falls through to the year default - we
        // never render admin for a non-admin even via a crafted URL.
        const urlView = searchParams?.get("view");
        const startInAdmin = urlView === "admin" && isAdmin;
        setViewMode(startInAdmin ? "admin" : "year");
      })
      .catch(() => showToast("Failed to load accounts", "error"));
    // searchParams + isAdmin captured at mount only; subsequent URL
    // updates are driven by the sync effect below (router.replace), not
    // by this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  // Clear cached data the instant the account changes. Without this,
  // switching accounts on the year view briefly rendered the NEW
  // account's yearData (light fetch, returns first) under the OLD
  // account's data-billing / data-category attribute (heavier sc-load,
  // returns second) - so PDC dots would flash through fee-account
  // CSS overrides for ~200ms before snapping into place. Clearing
  // both forces the year body's "is everything loaded?" gate to fail
  // until BOTH responses land for the new account.
  useEffect(() => {
    setData(null);
    setYearData(null);
  }, [selectedAccount]);

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

  // URL sync: when viewMode flips into or out of "admin", update the
  // query param so deep-links are bookmarkable and the back-button works.
  // Shallow router.replace - no full navigation, scroll preserved. The
  // early-return guard prevents an infinite loop with searchParams in deps.
  useEffect(() => {
    const currentParam = searchParams?.get("view") || null;
    if (viewMode === "admin" && currentParam !== "admin") {
      router.replace("/service-calendar?view=admin", { scroll: false });
    } else if (viewMode !== "admin" && currentParam === "admin") {
      router.replace("/service-calendar", { scroll: false });
    }
  }, [viewMode, router, searchParams]);

  const dayMap = useMemo(() => { const m = {}; if (data?.days) data.days.forEach(d => { m[d.date] = d; }); return m; }, [data]);
  const priceLookup = useMemo(() => { const p = {}; if (data?.serviceGroups) data.serviceGroups.forEach(g => g.services.forEach(s => { p[s.colIndex] = s.price; })); return p; }, [data]);

  const metrics = useMemo(() => {
    if (!data?.days?.length) return { projMeals: 0, actMeals: 0, projRev: 0, actRev: 0, complete: 0, needsEntry: 0, overdue: 0, total: 0 };
    let projMeals = 0, actMeals = 0, projRev = 0, actRev = 0, complete = 0, needsEntry = 0, overdue = 0;
    for (const day of data.days) {
      if (day.hasActuals) complete++;
      else if (day.isPast && day.isLocked) overdue++;
      else if (day.isPast) needsEntry++;
      // Revenue: view-sourced day.totals (effective-dated per-day price
      // from sc_daily_revenue). Replaces the prior pv * priceLookup
      // recompute which used a single as-of-today price for every day
      // and drifted post a mid-period price change. day.totals is
      // guaranteed present per loadMonthDataPostgres:608.
      projRev += day.totals.projectedRevenue || 0;
      if (day.hasActuals) {
        actRev += day.totals.actualRevenue || 0;
      }
      // Counts still sum from the per-service maps - those are the
      // count surface and are not affected by price drift.
      for (const ci of Object.keys(day.projected)) {
        const pv = day.projected[ci];
        if (pv != null) projMeals += pv;
        if (day.hasActuals && day.actual[ci] != null) actMeals += day.actual[ci];
      }
    }
    return { projMeals, actMeals, projRev, actRev, complete, needsEntry, overdue, total: data.days.length };
  }, [data]);

  const completionPct = metrics.total > 0 ? Math.round(metrics.complete / metrics.total * 100) : 0;

  // Calendar display mode classification - SPLIT into two predicates per
  // Bundle 1 Stage 1c.
  //
  // isFeeAccount        = "no $ on the calendar." Structural classification
  //                       by billing model. STL-FL ($1.4M flat fee, no
  //                       homestand schedule) hits this. The 4 MLB fee
  //                       accounts also hit this.
  // hasHomestandSchedule = "use the homestand-driven display layer."
  //                       The 4 MLB fee accounts have homestand rows
  //                       (game-day rhythm, prep tiles, opponent labels,
  //                       off-season returns). STL-FL has flat_fee
  //                       billing but no homestand rows, so this is
  //                       false for it - the calendar uses the per-meal
  //                       classify path for status, but still suppresses
  //                       $ figures via isFeeAccount.
  //
  // The two predicates together give the calendar three display modes:
  //   1. hasHomestandSchedule              -> homestand fee (MLB fee)
  //   2. !hasHomestandSchedule && isFeeAccount -> operational only (STL-FL)
  //   3. !isFeeAccount                     -> per-meal with $ (everyone else)
  //
  // Declared HERE (not at the bottom of the component) because the
  // feeMetrics + dayStatus hooks below reference them in their
  // dependency arrays - JavaScript TDZ otherwise.
  const isFeeAccount = data?.account?.billingModel === "flat_fee";
  const hasHomestandSchedule = !!data?.homestandMap;
  const homestandMap = data?.homestandMap || {};

  // MiLB hybrid: per-meal mechanics + schedule rhythm. Game-day rhythm
  // surfaces via DAY/NIGHT border accent; OFF days recess visually so
  // the active homestand week pops. Out-of-season month cards show a
  // neutral caption instead of "0/0 entered $0" which reads as a failure
  // state for months that aren't expected to have data.
  const isMilb = data?.account?.category === "MiLB";

  // Homestand metrics: count game-day completion + identify the
  // homestand the month is sitting in. Only computed when the account
  // has a homestand schedule (the 4 MLB fee accounts). STL-FL is fee
  // but has no homestand schedule, so this skips. Per-meal accounts
  // also skip.
  const feeMetrics = useMemo(() => {
    if (!hasHomestandSchedule || !data?.days?.length) {
      return { gameDays: 0, gameDaysEntered: 0, homestandCount: 0, currentHomestand: null, currentHomestandRange: null, currentHomestandGameDays: 0, currentHomestandGameDaysEntered: 0 };
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
      homestandCount: Object.keys(byHs).length,
      currentHomestand,
      currentHomestandRange,
      currentHomestandGameDays: cur?.gameDays || 0,
      currentHomestandGameDaysEntered: cur?.gameDaysEntered || 0,
    };
  }, [hasHomestandSchedule, data, homestandMap]);

  const dayStatus = useCallback((day) => {
    if (!day) return "off";
    // Homestand-driven schedule branch. Mirrors the orchestrator's
    // classify() exactly. Accounts with a homestand schedule never had
    // an actuals-entry requirement, so a past unentered game day is
    // just an unentered scheduled day - returns "future" (clean
    // schedule), not "needs-entry" or "overdue" (false urgency).
    // STL-FL is fee but has no homestand schedule; it falls through to
    // the per-meal branch below.
    if (hasHomestandSchedule) {
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
  }, [hasHomestandSchedule, homestandMap]);

  const daySummary = useCallback((day) => {
    if (!day) return { meals: 0, revenue: 0 };
    // Revenue: view-sourced day.totals (effective-dated). Falls back to
    // projected when no actuals are entered yet. Matches sc_daily_revenue
    // exactly - was previously a pv * priceLookup recompute that
    // mis-priced any day before the latest price change.
    const revenue = day.hasActuals
      ? (day.totals.actualRevenue    || 0)
      : (day.totals.projectedRevenue || 0);
    let meals = 0;
    for (const ci of Object.keys(day.projected)) {
      const val = day.hasActuals && day.actual[ci] != null ? day.actual[ci] : day.projected[ci];
      if (val != null) meals += val;
    }
    return { meals, revenue };
  }, []);

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
      // spreadsheetId + sheetRow dropped (Sheets-era leftovers, PG route ignores).
      const res = await fetch("/api/service-calendar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-submit-day", accountKey: data.account.key, date: day.date, entries }) });
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

  // Year-view banner stats. Aggregates across yearData (months[]):
  // per-meal/MiLB get days-recorded + needs/overdue counts + meals YTD;
  // fee accounts get game-days-recorded + meals YTD only (no urgency).
  // Status names match classify() output - we count days[] across all
  // months for the urgency tallies; days[].status === "needs-entry" |
  // "overdue" only appear on per-meal/MiLB classify paths so the same
  // count loop works for both.
  const yearBannerStats = useMemo(() => {
    if (!yearData) return null;
    let daysRecorded = 0, totalDays = 0, needsEntry = 0, overdue = 0, mealsYTD = 0;
    let gameDaysEntered = 0, totalGameDays = 0;
    // NOTE: route.js re-keys the orchestrator output before responding:
    //   totalServiceDays -> totalDays, totalActualMeals -> actualCovers,
    //   totalProjectedMeals -> projectedCovers. Read the response shape,
    //   not the orchestrator shape. (First version of this loop read the
    //   orchestrator names and rendered "169 of 0 days recorded".)
    for (const m of yearData) {
      daysRecorded += m.daysWithActuals || 0;
      totalDays += m.totalDays || 0;
      mealsYTD += m.actualCovers || 0;
      if (m.homestandSummary) {
        gameDaysEntered += m.homestandSummary.gameDaysEntered || 0;
        totalGameDays += m.homestandSummary.gameDays || 0;
      }
      if (m.days) {
        for (const d of m.days) {
          if (d.status === "needs-entry") needsEntry++;
          else if (d.status === "overdue") overdue++;
        }
      }
    }
    const now = new Date();
    const shortMonth = MONTHS[now.getMonth()].slice(0, 3);
    const todayLabel = `${shortMonth} ${now.getDate()}`;
    return { todayLabel, daysRecorded, totalDays, needsEntry, overdue, mealsYTD, gameDaysEntered, totalGameDays };
  }, [yearData]);

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
    <div className="sc-root" data-density="compact" data-billing={isFeeAccount ? "flat_fee" : "per_meal"} data-category={data?.account?.category || ""}>
      <div className="sc-card">
        <div className="sc-header">
          <div className="sc-header-account">
            {viewMode === "admin" ? (
              // Admin mode owns the selector slot. The account dropdown does
              // NOT drive the admin all-accounts overview; showing a stale
              // single account here would mislead. When drilled into a
              // specific account, the selector keeps the Admin label and
              // exposes "Overview" as the back affordance - the dropdown
              // never names the drilled account (the AccountEditor's own
              // "All accounts" link is the drill-up).
              <div className="sc-header-admin-label">
                <span className="sc-admin-mode-chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {adminView.mode === "overview" ? "Admin · all accounts" : "Admin"}
                </span>
                {adminView.mode !== "overview" && (
                  <button
                    type="button"
                    className="sc-admin-overview-back"
                    onClick={() => setAdminView({ mode: "overview" })}
                  >
                    ← Overview
                  </button>
                )}
              </div>
            ) : (
              <>
                <AccountDropdown accounts={accounts} value={selectedAccount} onChange={setSelectedAccount} />
                {category && <span className={`sc-cat sc-cat--${category.toLowerCase()}`}>{category}</span>}
              </>
            )}
          </div>
          <div className="sc-mode-group">
            {["year","month"].map(v => (
              <button key={v} className={`sc-mode-btn ${viewMode === v ? "sc-mode-btn--active" : ""}`} onClick={() => { setViewMode(v); setFocusDay(null); setBulkMode(false); }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
            <div className="sc-mode-divider" />
            <button className="sc-mode-btn sc-mode-btn--today" onClick={goToToday}>Today</button>
            {isAdmin && (
              <>
                <div className="sc-mode-divider" />
                <button
                  className={`sc-mode-btn sc-mode-btn--admin ${viewMode === "admin" ? "sc-mode-btn--active" : ""}`}
                  onClick={() => { setViewMode("admin"); setFocusDay(null); setBulkMode(false); }}
                  title="Service Calendar admin (corporate only)"
                >
                  Admin
                </button>
              </>
            )}
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
                {hasHomestandSchedule ? (
                  // Mode 1: homestand-fee metrics strip. Schedule-forward.
                  // Lead with current homestand, then game-day completion,
                  // then meals as supporting context. No $ figures.
                  <div className="sc-metrics">
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
                    <div className="sc-metric-divider" />
                    <div className="sc-metric-block">
                      <div className="sc-metric-label">Game days</div>
                      <div className="sc-metric-row">
                        <span className="sc-metric-hero" style={{ color: feeMetrics.gameDays === 0 ? "#9ca3af" : (feeMetrics.gameDaysEntered < feeMetrics.gameDays ? "#1e3a8a" : GREEN) }}>{feeMetrics.gameDaysEntered}</span>
                        <span className="sc-metric-context">/ {feeMetrics.gameDays} this month</span>
                      </div>
                      <div className="sc-progress-bar"><div className="sc-progress-fill" style={{ width: (feeMetrics.gameDays > 0 ? Math.round(feeMetrics.gameDaysEntered / feeMetrics.gameDays * 100) : 0) + "%", background: feeMetrics.gameDaysEntered < feeMetrics.gameDays ? "#1e3a8a" : GREEN }} /></div>
                      {feeMetrics.homestandCount > 0 && <div className="sc-metric-context" style={{ fontSize: 11, marginTop: 4 }}>across {feeMetrics.homestandCount} {feeMetrics.homestandCount === 1 ? "homestand" : "homestands"}</div>}
                    </div>
                    <div className="sc-metric-divider" />
                    <div className="sc-metric-block">
                      <div className="sc-metric-label">Meals</div>
                      <div className="sc-metric-row"><span className="sc-metric-hero">{metrics.actMeals.toLocaleString()}</span><span className="sc-metric-context">delivered this month</span></div>
                    </div>
                  </div>
                ) : isFeeAccount ? (
                  // Mode 2: operational-only (STL-FL). Meal counts + days
                  // complete, no $ figures. Helper enforces the no-$
                  // discipline structurally.
                  <OperationalMetricsStrip
                    metrics={metrics}
                    completionPct={completionPct}
                    onBulkOpen={() => { setBulkMode(true); setFocusDay(null); }}
                  />
                ) : (
                  <div className="sc-metrics">
                    <div className="sc-metric-block">
                      <div className="sc-metric-label">Meals</div>
                      <div className="sc-metric-row"><span className="sc-metric-hero">{metrics.actMeals.toLocaleString()}</span><span className="sc-metric-context">of {metrics.projMeals.toLocaleString()} projected</span></div>
                    </div>
                    <div className="sc-metric-divider" />
                    <div className="sc-metric-block">
                      <div className="sc-metric-label">Revenue</div>
                      <div className="sc-metric-row"><span className="sc-metric-hero sc-metric-hero--green">{fmt$(metrics.actRev)}</span><span className="sc-metric-context">billed to date</span></div>
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
                          const hs = hasHomestandSchedule ? homestandMap[dk] : null;
                          const gameType = dd.meta?.gameType || "";
                          const gt = (gameType || "").toLowerCase();

                          // MiLB DAY/NIGHT pill - replaces the left-border
                          // amber/navy accent. Renders inline in the tile
                          // body for genuine game days; OFF days fall to
                          // the off-day class.
                          let milbPill = null;
                          if (isMilb) {
                            if (gt.includes("day")) milbPill = "day";
                            else if (gt.includes("night")) milbPill = "night";
                          }

                          // Homestand-driven off-season days render as
                          // unclickable off tiles (no homestand activity).
                          // "off-season" status only emits from the
                          // homestand-driven dayStatus branch.
                          if (hasHomestandSchedule && status === "off-season") {
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

                          // State signal: bg tint via sc-tile-state--${status}
                          // (CSS owns the per-status colors and the fee/MiLB
                          // overrides via data-billing / data-category).
                          // Icon stays via .sc-badge so the signal is never
                          // color-alone. Today / focused / bulk-selected
                          // stack via separate visual channels (box-shadow
                          // ring / border / outer ring respectively).
                          return (
                            <div key={di}
                              className={`sc-tile sc-tile--active sc-tile-state--${status} ${isFocused ? "sc-tile--focused" : ""} ${isToday ? "sc-tile--today" : ""} ${isBulkSelected ? "sc-tile--bulk-selected" : ""} ${bulkMode && !dd.hasActuals ? "sc-tile--bulk-selectable" : ""} ${hasHomestandSchedule && status === "prep" ? "sc-tile--prep" : ""} ${status === "no-service" ? "sc-tile--no-service" : ""} ${(gameType || "").toUpperCase() === "OFF" ? "sc-tile--off-day" : ""}`}
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
                              {hasHomestandSchedule ? (
                                // Mode 1: homestand-fee tile body. Opponent
                                // + HS for game days, label-only for
                                // prep/open/close.
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
                              ) : isFeeAccount ? (
                                // Mode 2: operational-only (STL-FL). Meal
                                // count, no $ figure. dd.hasActuals is the
                                // same source the per-meal branch reads
                                // so the two paths agree on day state.
                                <OperationalTileBody
                                  meals={meals}
                                  gameType={gameType}
                                  milbPill={milbPill}
                                  status={status}
                                  hasActuals={dd.hasActuals}
                                />
                              ) : (
                                // Mode 3: per-meal with $ figure.
                                <>
                                  {gameType && (
                                    <div className="sc-tile-game">
                                      {milbPill ? (
                                        <span className={`sc-mlb-pill sc-mlb-pill--${milbPill}`}>
                                          <span className="sc-mlb-pill-dot" />
                                          {milbPill === "day" ? "Day" : "Night"}
                                        </span>
                                      ) : gameType}
                                    </div>
                                  )}
                                  {status === "no-service" ? (
                                    <div className="sc-tile-noservice">No service</div>
                                  ) : (
                                    <>
                                      <div className={`sc-tile-meals ${dd.hasActuals ? "" : "sc-tile-meals--proj"}`}>{meals.toLocaleString()} meals</div>
                                      <div className={`sc-tile-rev ${dd.hasActuals ? "sc-tile-rev--actual" : status === "future" ? "sc-tile-rev--future" : "sc-tile-rev--projected"}`}>
                                        {!dd.hasActuals && status !== "future" ? "est. " : ""}{status === "future" ? "~" : ""}{fmt$(revenue)}
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
                          {hasHomestandSchedule ? (() => {
                            // Mode 1: homestand-fee week summary. Count game
                            // days in this week, entered = game day with
                            // actuals.
                            const wGame = wDays.filter((d) => homestandMap[d.date]?.dayType === "GAME");
                            const wGameEntered = wGame.filter((d) => d.hasActuals);
                            return (
                              <>
                                <span className="sc-week-progress">{wGameEntered.length}/{wGame.length} game days</span>
                              </>
                            );
                          })() : isFeeAccount ? (
                            // Mode 2: operational-only week summary. Same
                            // entered/total counts as per-meal, just no
                            // right-side $ figure. wEntered/wDays read
                            // from the same source the per-meal branch
                            // uses.
                            <OperationalWeekSummary entered={wEntered.length} total={wDays.length} />
                          ) : (
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

                {/* Inline color legend below the grid. Mode-aware shape;
                    swatches reuse the year-view dot classes so the month
                    and year share one color vocabulary. */}
                <div className="sc-month-legend">
                  {hasHomestandSchedule ? (
                    <>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Entered</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--future" />Game day</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--prep" />Prep / open / close</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-season" />Off</span>
                    </>
                  ) : isMilb ? (
                    <>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Entered</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--upcoming-game" />Upcoming</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-day" />Off</span>
                      <span className="sc-legend-item"><span className="sc-mlb-pill-dot sc-mlb-pill-dot--legend-day" />Day game</span>
                      <span className="sc-legend-item"><span className="sc-mlb-pill-dot sc-mlb-pill-dot--legend-night" />Night game</span>
                    </>
                  ) : (
                    <>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Entered</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--needs" />Needs entry</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--future-service" />Upcoming</span>
                      <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-day" />No service</span>
                    </>
                  )}
                </div>

                {/* Bulk entry panel */}

                {hasHomestandSchedule ? (
                  // Mode 1: homestand-fee month footer. Current homestand
                  // context + month-wide game day completion. No $.
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
                ) : isFeeAccount ? (
                  // Mode 2: operational-only month footer. Same entered/
                  // needs/upcoming counts as per-meal, just no right-side
                  // $ figure. All counts read from the same metrics
                  // object the per-meal branch uses.
                  <OperationalMonthFooter
                    monthLabel={MONTHS[month]}
                    complete={metrics.complete}
                    needsEntry={metrics.needsEntry}
                    overdue={metrics.overdue}
                    total={metrics.total}
                    done={metrics.complete === metrics.total && metrics.total > 0}
                    warn={(metrics.needsEntry + metrics.overdue) > 0}
                  />
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
            {(loading || !data || !yearData) ? (
              <div className="sc-loading"><div className="oh-spinner" /><p>Loading...</p></div>
            ) : (
            <>
            {/* At-a-glance stats banner. Per-meal + MiLB share the urgency-
                aware shape (recorded / needs / overdue); fee accounts use
                the schedule-only shape (game-days recorded). Meals YTD is
                shared across all three modes. */}
            {yearBannerStats && (
              <div className="sc-year-banner">
                <span className="sc-year-banner-item">Today: {yearBannerStats.todayLabel}</span>
                {hasHomestandSchedule ? (
                  <>
                    <span className="sc-year-banner-sep">|</span>
                    <span className="sc-year-banner-item">{yearBannerStats.gameDaysEntered.toLocaleString("en-US")} of {yearBannerStats.totalGameDays.toLocaleString("en-US")} game days recorded</span>
                    <span className="sc-year-banner-sep">|</span>
                    <span className="sc-year-banner-item">{yearBannerStats.mealsYTD.toLocaleString("en-US")} meals recorded YTD</span>
                  </>
                ) : (
                  <>
                    <span className="sc-year-banner-sep">|</span>
                    <span className="sc-year-banner-item">{yearBannerStats.daysRecorded.toLocaleString("en-US")} of {yearBannerStats.totalDays.toLocaleString("en-US")} days recorded</span>
                    <span className="sc-year-banner-sep">|</span>
                    <span className="sc-year-banner-item">{yearBannerStats.needsEntry.toLocaleString("en-US")} need entry</span>
                    <span className="sc-year-banner-sep">|</span>
                    <span className="sc-year-banner-item">{yearBannerStats.overdue.toLocaleString("en-US")} overdue</span>
                    <span className="sc-year-banner-sep">|</span>
                    <span className="sc-year-banner-item">{yearBannerStats.mealsYTD.toLocaleString("en-US")} meals recorded YTD</span>
                  </>
                )}
              </div>
            )}

            <div className="sc-year-grid">
              {MONTHS.map((name, mi) => {
                const mKey = `${year}-${String(mi+1).padStart(2,"0")}`;
                const md = yearData?.find(m => m.month === mKey);
                const isCurrent = mi === new Date().getMonth();
                // Per-meal completion %; fee accounts override below.
                const pct = md && md.totalDays > 0 ? Math.round(md.daysWithActuals / md.totalDays * 100) : 0;

                // noService gate (three-way per Bundle 1):
                //   - hasHomestandSchedule: empty/missing homestandSummary
                //   - operational-only (isFeeAccount, no schedule):
                //     count-based via isOperationalNoService - STL-FL's
                //     $0 prices would make every month read "no service"
                //     under the per-meal revenue===0 gate
                //   - MiLB: totalDays === 0 (out-of-season months)
                //   - per-meal: both projected and actual revenue zero
                const hs = md?.homestandSummary;
                const noService = hasHomestandSchedule
                  ? !hs || (hs.gameDays === 0 && hs.prepDays === 0)
                  : isFeeAccount
                    ? isOperationalNoService(md)
                    : isMilb
                      ? !md || md.totalDays === 0
                      : (md && md.projectedRevenue === 0 && md.actualRevenue === 0 && md.totalDays > 0);

                // Build mini calendar + day lookup
                const mWeeks = getCalendarWeeks(year, mi);
                const dayLookup = {};
                if (md?.days) md.days.forEach(d => { dayLookup[d.date] = d; });

                // Per-meal-only revenue display values.
                const hasActuals = md && md.daysWithActuals > 0;
                const displayRev = hasActuals ? md.actualRevenue : (md?.projectedRevenue || 0);

                // Homestand-fee completion% = game days entered / total.
                // Only computed when there's a homestand schedule;
                // operational-only and per-meal cards use pct above.
                const feePct = hasHomestandSchedule && hs && hs.gameDays > 0
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

                            // Build the hover tooltip. Always shows the date;
                            // appends " - N meals" when actuals were entered.
                            // Uses dayInfo.actualMeals (sum across services from
                            // the orchestrator) so the year view tooltip lines
                            // up with the month/day detail surface.
                            const meals = dayInfo?.actualMeals || 0;
                            const tip = meals > 0
                              ? `${fmtDotDate(d)} — ${meals.toLocaleString("en-US")} meals`
                              : fmtDotDate(d);

                            // Fee accounts: status comes straight from
                            // the orchestrator classify (entered / needs-
                            // entry / future / prep / off-season). Off-
                            // season days render transparent. No game-
                            // type ring overlay - homestand dayType is
                            // already encoded in the status (prep) and
                            // border is added via attribute selector.
                            // TODAY indicator: amber ring on the day-of dot, applied
                            // to every account mode (fee/MiLB/per-meal). Renders as
                            // an extra class on top of the status color.
                            const isTodayDot = dk === today;
                            const todayClass = isTodayDot ? "sc-dot--today" : "";

                            if (hasHomestandSchedule) {
                              // Homestand-driven heatmap rendering. In-month
                              // days with no homestand schedule entry (and
                              // no projection/actual data) render as grey
                              // blocks like explicit off-season days, so
                              // empty months read as a full calendar grid
                              // instead of a blank stencil.
                              if (!dayInfo) return <div key={di} className={`sc-dot sc-dot--off-season ${todayClass}`} title={tip} />;
                              if (dayInfo.status === "off-season") return <div key={di} className={`sc-dot sc-dot--off-season ${todayClass}`} title={tip} />;
                              return <div key={di} className={`sc-dot sc-dot--${dayInfo.status} ${todayClass}`} title={tip} />;
                            }

                            // Universal: in-month days without homestand/projection/
                            // actual data render as off-day grey blocks regardless of
                            // weekday vs weekend. Completes the calendar grid - was
                            // missing Sat/Sun dots before.
                            if (!dayInfo) {
                              return <div key={di} className={`sc-dot sc-dot--off-day ${todayClass}`} title={tip} />;
                            }
                            const gameType = dayInfo?.gameType?.toLowerCase() || "";

                            // Status remap for future days:
                            //   - MiLB with scheduled gameType (DAY/NIGHT) -> "upcoming-game" (sky blue)
                            //   - Non-homestand non-MiLB (PDC + STL-FL) -> "future-service" (light green),
                            //     so the upcoming service schedule reads as a separate signal from
                            //     off-days without data. STL-FL now hits this branch (fee but no
                            //     homestand schedule) and gets the light-green upcoming dots.
                            // Homestand accounts are handled above; MiLB OFF and per-meal off days
                            // (without dayInfo) already render as grey via earlier branches.
                            let resolvedStatus = dayInfo.status;
                            if (isMilb && dayInfo.status === "future" &&
                                (gameType.includes("day") || gameType.includes("night")) &&
                                gameType !== "off") {
                              resolvedStatus = "upcoming-game";
                            } else if (!hasHomestandSchedule && !isMilb && dayInfo.status === "future") {
                              resolvedStatus = "future-service";
                            }

                            let gameClass = "";
                            if (gameType.includes("home")) gameClass = "sc-dot--home";
                            else if (gameType.includes("away")) gameClass = "sc-dot--away";
                            else if (gameType === "off") gameClass = "sc-dot--day-off";
                            return <div key={di} className={`sc-dot sc-dot--${resolvedStatus} ${gameClass} ${todayClass}`} title={tip} />;
                          })}
                        </div>
                      ))}
                    </div>

                    {noService ? (
                      <div className="sc-year-card-noservice">Off-season</div>
                    ) : hasHomestandSchedule ? (
                      <>
                        <div className="sc-year-card-stats">
                          <span>{hs?.gameDaysEntered || 0}/{hs?.gameDays || 0} game days</span>
                          <span className="sc-year-card-rev">{hs?.homestandIds?.length || 0} {(hs?.homestandIds?.length || 0) === 1 ? "homestand" : "homestands"}</span>
                        </div>
                        {/* Hide the bar entirely at 0% so empty tracks don't read
                            as UI debris on months with no entries yet. */}
                        {feePct > 0 && (
                          <div className="sc-year-bar">
                            <div className={`sc-year-bar-fill ${feePct === 100 ? "sc-year-bar-fill--complete" : "sc-year-bar-fill--progress"}`} style={{ width: feePct + "%" }} />
                          </div>
                        )}
                      </>
                    ) : isFeeAccount ? (
                      // Mode 2: operational-only year card stats. Same
                      // entered/total count as per-meal, no right-side $
                      // figure. The progress bar still renders since pct
                      // is count-based (daysWithActuals / totalDays).
                      <>
                        <OperationalYearCardStats md={md} />
                        {pct > 0 && (
                          <div className="sc-year-bar">
                            <div className={`sc-year-bar-fill ${pct === 100 ? "sc-year-bar-fill--complete" : "sc-year-bar-fill--progress"}`} style={{ width: pct + "%" }} />
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="sc-year-card-stats">
                          <span>{md?.daysWithActuals || 0}/{md?.totalDays || 0} entered</span>
                          <span className={`sc-year-card-rev ${hasActuals ? "sc-year-card-rev--actual" : ""}`}>
                            {displayRev > 0 ? fmtK(displayRev) : "$0"}
                          </span>
                        </div>
                        {pct > 0 && (
                          <div className="sc-year-bar">
                            <div className={`sc-year-bar-fill ${pct === 100 ? "sc-year-bar-fill--complete" : "sc-year-bar-fill--progress"}`} style={{ width: pct + "%" }} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Color legend moved below the grid - reference key after
                you've scanned the year, not chrome at the top. Per-meal
                gets the urgency legend; MiLB hybrid layers scheduled
                game-day on top; fee account drops urgency entirely. */}
            <div className="sc-year-legend">
              {hasHomestandSchedule ? (
                <>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Game day entered</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--future" />Scheduled game day</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--prep" />Prep / open / close</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-season" />Away / off</span>
                </>
              ) : isMilb ? (
                <>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Entered</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--needs" />Needs entry</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--overdue" />Overdue</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--upcoming-game" />Scheduled game day</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-day" />Off day</span>
                </>
              ) : (
                <>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--entered" />Entered</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--needs" />Needs entry</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--overdue" />Overdue</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--future-service" />Upcoming service</span>
                  <span className="sc-legend-item"><span className="sc-legend-dot sc-legend-dot--off-day" />Off day</span>
                </>
              )}
            </div>
            </>
            )}
          </div>
        )}

        {/* Admin in-page view mode (Bundle 2 follow-up). Renders ONLY for
            isAdmin - the API server-side gates on every admin POST action
            remain the security boundary; this gate is just about not
            showing a control to non-admins (and not rendering the body
            if a non-admin somehow lands on ?view=admin). */}
        {viewMode === "admin" && isAdmin && (
          <div className="sc-admin-body sc-fade-in">
            <AdminPanel
              view={adminView}
              onViewChange={setAdminView}
              showToast={showToast}
            />
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
              accountName={acctObj?.name || ""}
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

    </div>
  );
}