"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DayDetail from "./DayDetail";
import LensBar from "./LensBar";
import PeriodLensView from "./PeriodLensView";
import SeasonShell from "./season/SeasonShell";
import { isScAdmin } from "@/lib/admin";
import AdminPanel from "./admin/AdminPanel";
import { computeInitialView } from "./computeInitialView";
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

// "2026-06-29" + "2026-07-26" -> ["2026-06", "2026-07"]. Returns the
// 1 or 2 calendar months a fiscal period spans, used to drive the
// period-data fetch in lens=period.
function monthsBetween(startStr, endStr) {
  if (!startStr || !endStr) return [];
  const out = [];
  const [sy, sm] = startStr.split("-").map(Number);
  const [ey, em] = endStr.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2,"0")}`);
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 3) break; // defensive: a fiscal period never spans >2 months
  }
  return out;
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
  // View state - two orthogonal axes plus a parallel admin surface.
  // PR-A internal rename of the legacy viewMode tri-state. PR-B/D extend
  // these without changing the shape further.
  //   scope  = altitude within a lens. PR-A ships only year/month under
  //            lens=calendar; the enum includes period/week/day for future
  //            stages. day is reserved for an explicit day-scope mode;
  //            today the day-detail overlay sits orthogonal as focusDay.
  //   lens   = how time is carved. PR-B1 ships only "calendar" (the
  //            year-of-months grid + single-month grid surfaces). PR-B2
  //            adds "period" with its own scope hierarchy. The lens used
  //            to be called "month"; renamed to "calendar" in B1.1 so it
  //            does not collide with the "Month" scope segment.
  //   isAdminView = the in-page admin parallel surface. NOT a lens or
  //            scope. Flipping it on suppresses (scope, lens) rendering
  //            and shows AdminPanel; flipping it off restores scope +
  //            lens to whatever they were underneath.
  // Server-side isScAdmin still gates every admin POST action in
  // route.js - the boolean here is render-only.
  const [scope, setScope] = useState("month");
  const [lens, setLens]   = useState("calendar");
  const [isAdminView, setIsAdminView] = useState(false);
  const [adminView, setAdminView] = useState({ mode: "overview" });
  const [data, setData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [yearToday, setYearToday] = useState(null);
  // PR-B2: period lens state.
  //   periodKey   = which period ("P7") the user is viewing.
  //   weekKey     = which week ("W2") within the period is active.
  //   monthCache  = { "2026-06": <sc-load payload>, ... } - the
  //                 already-fetched calendar months, used to merge
  //                 1-2 months into a period view without refetching.
  //                 Week-switch is 0ms because periodDays is memoized
  //                 over (periodKey, monthCache), not weekKey.
  //   periodRanges = [{ period, start, end }, ...] from sc-year-
  //                 summary; drives prev/next period nav + period
  //                 -> calendar-month derivation.
  //   partialError = null | { failedMonth: "2026-07" } for the
  //                 honest partial-data state.
  const [periodKey, setPeriodKey] = useState(null);
  const [weekKey, setWeekKey] = useState(null);
  const [monthCache, setMonthCache] = useState({});
  const [periodRanges, setPeriodRanges] = useState(null);
  const [partialError, setPartialError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [focusDay, setFocusDay] = useState(null);
  // One-shot guard for goToToday. Raised before goToToday changes
  // month synchronously; read-and-cleared inside the sc-load effect
  // so the effect's own setFocusDay(null) skips exactly once - the
  // landing focusDay survives instead of being racing-cleared.
  const todayLandingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Admin gate (client-side - just controls whether the toggle + body
  // RENDER, not authorization). Server-side isScAdmin checks on every
  // admin POST action in route.js remain the security boundary.
  const isAdmin = isScAdmin(session?.user?.email);

  // Derived view booleans - pure functions of (scope, lens, isAdminView).
  // Use these for render conditions; effects must depend on the
  // underlying scope/lens state so they don't over-fire (these are
  // re-created every render and would change reference identity).
  // Year is lens-agnostic at scope=year: under either lens, scope=year
  // shows the existing year grid. The lens-specific divergence happens
  // at sub-year altitudes. (A 13-period year grid is Stage 3, not B2.)
  const isYearView   = !isAdminView && scope === "year"   && (lens === "calendar" || lens === "period");
  const isMonthView  = !isAdminView && scope === "month"  && lens === "calendar";
  const isPeriodView = !isAdminView && scope === "period" && lens === "period";

  // URL ?view=admin sync (App Router shallow update).
  const router = useRouter();
  const searchParams = useSearchParams();

  // PR-SC-Redesign Stage 1: ?legacy=year selects the legacy year body
  // (the trusted heatmap render in this file) instead of the new Season
  // shell. Default is the new shell. Pure URL read; no state, no effect.
  const legacyYearView = searchParams?.get("legacy") === "year";

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
        // Mount default: routed through computeInitialView() so PR-D can
        // extend the body with role-conditional landing (floor -> their
        // account's current month; leadership -> year overview) without
        // editing the mount call sites here. PR-A keeps the helper at
        // today's exact default: year/month for everyone, with admin
        // honored only via ?view=admin deep-link + isAdmin gate.
        const initialView = computeInitialView({
          urlView: searchParams?.get("view"),
          urlPeriod: searchParams?.get("period"),
          isAdmin,
        });
        setScope(initialView.scope);
        setLens(initialView.lens);
        setIsAdminView(initialView.isAdminView);
        if (initialView.periodKey) setPeriodKey(initialView.periodKey);
      })
      .catch(() => showToast("Failed to load accounts", "error"));
    // searchParams + isAdmin captured at mount only; subsequent URL
    // updates are driven by the sync effect below (router.replace), not
    // by this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  // Today's date key. Declared here (high in the component) so the
  // PR-B2 period effects below can use it without TDZ. Computed every
  // render but the value is stable across the day - no perf cost.
  const today = dateKey(new Date());

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
    setYearToday(null);
    // PR-B2: also clear period state on account-switch. monthCache
    // is per-account; without clearing it a switch would render the
    // PRIOR account's period days briefly. periodRanges is also
    // per-account (the year-summary refetch will repopulate).
    setMonthCache({});
    setPeriodKey(null);
    setWeekKey(null);
    setPeriodRanges(null);
    setPartialError(null);
  }, [selectedAccount]);

  const mk = `${year}-${String(month+1).padStart(2,"0")}`;
  useEffect(() => {
    if (!selectedAccount) return;
    const controller = new AbortController();
    setLoading(true); if (!todayLandingRef.current) setFocusDay(null); todayLandingRef.current = false; setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); else { showToast(d.error || "Failed", "error"); setData(null); } })
      .catch(e => { if (e.name !== "AbortError") { showToast("Network error", "error"); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedAccount, mk, showToast, reloadKey]);

  useEffect(() => {
    // Depend on the underlying scope/lens state (PRIMARY state pieces),
    // not on the derived isYearView boolean. isYearView is a per-render
    // constant whose reference changes every render - depending on it
    // would re-fire this effect on every render and trigger extra
    // network calls. The guard inside handles the short-circuit.
    //
    // PR-B2: also fires for lens=period to capture periodRanges (the
    // [{ period, start, end }, ...] aggregation added in the dataStore
    // extension). One endpoint, two consumers - the year heatmap and
    // the period nav both feed from sc-year-summary.
    const needsYearData = isYearView;
    const needsPeriodRanges = lens === "period";
    if (!selectedAccount || (!needsYearData && !needsPeriodRanges)) return;
    // reloadKey is in the dep array so a save in the month view also
    // refreshes the year heatmap on next visit; without it, the heatmap
    // showed stale grey dots after data flipped to "entered" in PG.
    fetch(`/api/service-calendar?action=sc-year-summary&account=${selectedAccount}`)
      .then(r => r.json()).then(d => {
        if (!d.success) return;
        setYearData(d.months);
        setYearToday(d.today || null);
        if (d.periodRanges) setPeriodRanges(d.periodRanges);
      }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, lens, isAdminView, selectedAccount, reloadKey]);

  // PR-B2 period-data effect. Derives the 1-2 calendar months the
  // current period spans and fetches only the missing months in
  // parallel, merging them into monthCache. Deps are PRIMARY state
  // (lens / account / periodKey / periodRanges / reloadKey) - NEVER
  // the derived isPeriodView (would over-fire). monthCache is read
  // via the functional setMonthCache(prev=>...) form so it doesn't
  // need to be in deps; if it were the effect would loop.
  useEffect(() => {
    if (lens !== "period" || !selectedAccount || !periodKey || !periodRanges) return;
    const range = periodRanges.find(r => r.period === periodKey);
    if (!range) return;
    const monthsNeeded = monthsBetween(range.start, range.end);
    const missing = monthsNeeded.filter(mk => !monthCache[mk]);
    if (missing.length === 0) { setPartialError(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setPartialError(null);
    Promise.allSettled(missing.map(mk =>
      fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}`, { signal: controller.signal })
        .then(r => r.json())
        .then(d => d.success ? { mk, payload: d } : Promise.reject({ mk, error: d.error || "Failed" }))
    ))
      .then(results => {
        if (controller.signal.aborted) return;
        const ok = []; let failed = null;
        for (const r of results) {
          if (r.status === "fulfilled") ok.push(r.value);
          else if (!failed && r.reason?.mk) failed = r.reason.mk;
        }
        if (ok.length > 0) {
          setMonthCache(prev => {
            const next = { ...prev };
            for (const { mk, payload } of ok) next[mk] = payload;
            return next;
          });
        }
        setPartialError(failed ? { failedMonth: failed } : null);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // monthCache intentionally NOT in deps - read via functional set
    // form so this effect doesn't loop when the cache populates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, selectedAccount, periodKey, periodRanges, reloadKey]);

  // PR-B2 periodKey initialization. When entering lens=period and
  // periodRanges arrives, land on the period containing today (or the
  // first period if today is outside the year's coverage). Preserves
  // an existing periodKey if it's still valid (so prev/next nav
  // doesn't get clobbered by a periodRanges refresh).
  useEffect(() => {
    if (lens !== "period" || !periodRanges?.length) return;
    if (periodKey && periodRanges.some(r => r.period === periodKey)) return;
    const containingToday = periodRanges.find(r => today >= r.start && today <= r.end);
    setPeriodKey(containingToday ? containingToday.period : periodRanges[0].period);
  }, [lens, periodRanges, periodKey, today]);

  // PR-B2 weekKey initialization. When periodDays land (or periodKey
  // changes), default to the week containing today; fall back to the
  // first week present in the period if today is outside the period
  // OR if no week metadata is present on today.
  // Note: this effect depends on monthCache because periodDays is
  // re-derived from it via useMemo below; we recompute the same here.
  useEffect(() => {
    if (lens !== "period" || !periodKey || !periodRanges?.length) return;
    const range = periodRanges.find(r => r.period === periodKey);
    if (!range) return;
    const monthsNeeded = monthsBetween(range.start, range.end);
    if (monthsNeeded.some(mk => !monthCache[mk])) return; // wait for full payload
    // Walk monthCache for the period's days to find today's week.
    let todaysWeek = null; let firstWeek = null;
    for (const mk of monthsNeeded) {
      for (const d of monthCache[mk]?.days || []) {
        if (d.meta?.period !== periodKey) continue;
        if (!firstWeek && d.meta?.week) firstWeek = d.meta.week;
        if (d.date === today && d.meta?.week) { todaysWeek = d.meta.week; break; }
      }
      if (todaysWeek) break;
    }
    // Don't clobber a deliberate user week-switch unless we don't have
    // one yet (initial landing) or the current weekKey is not in this
    // period (came from a different period).
    const allWeeks = new Set();
    for (const mk of monthsNeeded) {
      for (const d of monthCache[mk]?.days || []) {
        if (d.meta?.period === periodKey && d.meta?.week) allWeeks.add(d.meta.week);
      }
    }
    if (!weekKey || !allWeeks.has(weekKey)) {
      setWeekKey(todaysWeek || firstWeek || "W1");
    }
  }, [lens, periodKey, periodRanges, monthCache, today, weekKey]);

  // URL sync: when isAdminView flips, update the query param so deep-
  // links are bookmarkable and the back-button works. Shallow
  // router.replace - no full navigation, scroll preserved. The early-
  // return guard prevents an infinite loop with searchParams in deps.
  // isAdminView is PRIMARY state (not derived), so the read/write
  // cycle cannot loop.
  useEffect(() => {
    const currentParam = searchParams?.get("view") || null;
    if (isAdminView && currentParam !== "admin") {
      router.replace("/service-calendar?view=admin", { scroll: false });
    } else if (!isAdminView && currentParam === "admin") {
      router.replace("/service-calendar", { scroll: false });
    }
  }, [isAdminView, router, searchParams]);

  // PR-B2 save invalidation. When a save fires reloadKey, clear the
  // monthCache so the period-data effect re-fetches the affected
  // month(s) on its next run - the period view reflects the save
  // without needing per-handler invalidation. reloadKey=0 is the
  // initial value; only clear after a real save bumps it.
  useEffect(() => {
    if (reloadKey === 0) return;
    setMonthCache({});
  }, [reloadKey]);

  // PR-B2 URL ?period= sync. Mirrors the ?view=admin pattern but
  // defensively preserves other params via URLSearchParams. periodKey
  // is PRIMARY state so the read/write cycle cannot loop.
  useEffect(() => {
    const currentParam = searchParams?.get("period") || null;
    const want = lens === "period" && periodKey ? periodKey : null;
    if (currentParam === want) return;
    const params = new URLSearchParams(searchParams);
    if (want) params.set("period", want);
    else params.delete("period");
    const qs = params.toString();
    router.replace(qs ? `/service-calendar?${qs}` : "/service-calendar", { scroll: false });
  }, [lens, periodKey, router, searchParams]);

  const dayMap = useMemo(() => { const m = {}; if (data?.days) data.days.forEach(d => { m[d.date] = d; }); return m; }, [data]);
  const priceLookup = useMemo(() => { const p = {}; if (data?.serviceGroups) data.serviceGroups.forEach(g => g.services.forEach(s => { p[s.colIndex] = s.price; })); return p; }, [data]);

  // PR-B2 periodDays: merge the 1-2 needed calendar months from
  // monthCache, dedupe by date, filter to meta.period === periodKey,
  // sort. Returns NULL if any needed month is missing (-> the
  // partial-data path renders the skeleton header instead of a wrong
  // total from half data). Memo keyed on (periodKey, periodRanges,
  // monthCache) - intentionally NOT on weekKey so week switch is
  // a 0ms visible-slice of already-loaded data, not a re-render.
  const periodDays = useMemo(() => {
    if (lens !== "period" || !periodKey || !periodRanges) return null;
    const range = periodRanges.find(r => r.period === periodKey);
    if (!range) return null;
    const monthsNeeded = monthsBetween(range.start, range.end);
    if (monthsNeeded.some(mk => !monthCache[mk])) return null;
    const merged = [];
    const seen = new Set();
    for (const mk of monthsNeeded) {
      for (const d of monthCache[mk].days || []) {
        if (!seen.has(d.date) && d.meta?.period === periodKey) {
          seen.add(d.date);
          merged.push(d);
        }
      }
    }
    return merged.sort((a, b) => a.date.localeCompare(b.date));
  }, [lens, periodKey, periodRanges, monthCache]);

  // PR-B2 periodServiceGroups: pulled from the first available month
  // in monthCache. serviceGroups is the same shape across months for
  // a given account (it describes the account's service catalog,
  // not the month's days), so either month's payload works. Required
  // by DayDetail when a day-tile in the period view is clicked.
  const periodServiceGroups = useMemo(() => {
    if (!monthCache) return null;
    const first = Object.values(monthCache)[0];
    return first?.serviceGroups || null;
  }, [monthCache]);

  // PR-B2 periodMetrics: mirrors the month metrics, scoped to
  // periodDays, with per-week subtotals for the sub-nav. Revenue
  // reads from day.totals.actualRevenue / projectedRevenue (the
  // #257-corrected sc_daily_revenue source - NEVER recomputed
  // client-side; that drift was the bug that pricing-fix landed).
  const periodMetrics = useMemo(() => {
    if (!periodDays) return null;
    const out = {
      projMeals: 0, actMeals: 0,
      projRev: 0, actRev: 0,
      complete: 0, needsEntry: 0, overdue: 0,
      total: 0,
      weeks: {},
    };
    for (const day of periodDays) {
      if (day.hasActuals) out.complete++;
      else if (day.isPast && day.isLocked) out.overdue++;
      else if (day.isPast) out.needsEntry++;
      out.projRev += day.totals?.projectedRevenue || 0;
      if (day.hasActuals) out.actRev += day.totals?.actualRevenue || 0;
      for (const ci of Object.keys(day.projected || {})) {
        const pv = day.projected[ci];
        if (pv != null) out.projMeals += pv;
        if (day.hasActuals && day.actual?.[ci] != null) out.actMeals += day.actual[ci];
      }
      const wk = day.meta?.week || "W?";
      if (!out.weeks[wk]) out.weeks[wk] = { actRev: 0, projRev: 0, actMeals: 0, complete: 0, total: 0, needsEntry: 0, overdue: 0 };
      const w = out.weeks[wk];
      w.total++;
      w.projRev += day.totals?.projectedRevenue || 0;
      if (day.hasActuals) {
        w.complete++;
        w.actRev += day.totals?.actualRevenue || 0;
        for (const ci of Object.keys(day.actual || {})) {
          const av = day.actual[ci];
          if (av != null) w.actMeals += av;
        }
      } else if (day.isPast && day.isLocked) w.overdue++;
      else if (day.isPast) w.needsEntry++;
    }
    out.total = periodDays.length;
    return out;
  }, [periodDays]);

  // PR-B2 next-service-period for the off-season empty state's
  // jump button. Picks the next period after the current periodKey
  // that has at least one service day (heuristic: any future period
  // in periodRanges is fine since periodRanges only includes periods
  // that have sc_day_metadata rows).
  const nextServicePeriod = useMemo(() => {
    if (!periodRanges?.length || !periodKey) return null;
    const idx = periodRanges.findIndex(r => r.period === periodKey);
    if (idx === -1) return periodRanges[0]?.period || null;
    return periodRanges[idx + 1]?.period || null;
  }, [periodRanges, periodKey]);

  // PR-B2b keyboard navigation. Arrow-left/right shifts the active
  // week within the period; Cmd/Ctrl + arrow shifts the period within
  // periodRanges. Guards:
  //   - only fires when in period view AND no DayDetail is open
  //     (focusDay null) - the modal owns arrow-nav when open.
  //   - skips when typing in an input/textarea (standard guard).
  // periodDays + weekKey + periodKey + periodRanges read via refs so
  // the listener attaches once per (lens/scope/admin/focus) combo
  // and reads the latest state without re-attaching on every memo
  // recompute. Effect deps stay on PRIMARY state - the PR-A lesson.
  const kbdRef = useRef({});
  kbdRef.current = { periodKey, weekKey, periodRanges, periodDays };
  useEffect(() => {
    if (lens !== "period" || scope !== "period" || isAdminView || focusDay) return;
    const handler = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tgt = e.target;
      if (tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable) return;
      const { periodKey: pk, weekKey: wk, periodRanges: prs, periodDays: pds } = kbdRef.current;
      const periodNav = e.metaKey || e.ctrlKey;
      e.preventDefault();
      if (periodNav) {
        if (!prs?.length || !pk) return;
        const idx = prs.findIndex(r => r.period === pk);
        if (idx === -1) return;
        const target = e.key === "ArrowRight" ? prs[idx + 1] : prs[idx - 1];
        if (target) setPeriodKey(target.period);
      } else {
        if (!pds?.length || !wk) return;
        const allWeeks = [...new Set(pds.map(d => d.meta?.week).filter(Boolean))].sort();
        const idx = allWeeks.indexOf(wk);
        if (idx === -1) return;
        const target = e.key === "ArrowRight" ? allWeeks[idx + 1] : allWeeks[idx - 1];
        if (target) setWeekKey(target);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lens, scope, isAdminView, focusDay]);

  // PR-B2b idle-prefetch. After the current period renders, fetch the
  // calendar months for the PREV and NEXT periods on idle so the
  // prev/next period buttons feel instant. Best-effort + silent: a
  // prefetch failure does NOT surface the partial banner or any
  // error - that's only for the ACTIVE period's fetch.
  //
  // Early-return when no neighbor months are missing prevents the
  // effect from looping after the prefetch lands (monthCache is in
  // deps and changes when the prefetch updates it, but on the next
  // run `needed` is empty and the effect exits).
  useEffect(() => {
    if (lens !== "period" || !selectedAccount || !periodKey || !periodRanges?.length) return;
    const idx = periodRanges.findIndex(r => r.period === periodKey);
    if (idx === -1) return;
    const neighbors = [
      idx > 0 ? periodRanges[idx - 1] : null,
      idx < periodRanges.length - 1 ? periodRanges[idx + 1] : null,
    ].filter(Boolean);
    const needed = [];
    for (const n of neighbors) {
      for (const mk of monthsBetween(n.start, n.end)) {
        if (!monthCache[mk] && !needed.includes(mk)) needed.push(mk);
      }
    }
    if (needed.length === 0) return;
    const controller = new AbortController();
    const schedule = typeof window !== "undefined" && window.requestIdleCallback
      ? window.requestIdleCallback
      : (cb) => setTimeout(cb, 250);
    const cancel = typeof window !== "undefined" && window.cancelIdleCallback
      ? window.cancelIdleCallback
      : clearTimeout;
    const idleId = schedule(() => {
      if (controller.signal.aborted) return;
      Promise.allSettled(needed.map(mk =>
        fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}`, { signal: controller.signal })
          .then(r => r.json())
          .then(d => (d && d.success) ? { mk, payload: d } : null)
          .catch(() => null)
      )).then(results => {
        if (controller.signal.aborted) return;
        const ok = results
          .filter(r => r.status === "fulfilled" && r.value)
          .map(r => r.value);
        if (ok.length === 0) return;
        setMonthCache(prev => {
          const next = { ...prev };
          for (const { mk, payload } of ok) {
            if (!next[mk]) next[mk] = payload;
          }
          return next;
        });
      }).catch(() => { /* silent: prefetch failures are best-effort */ });
    });
    return () => {
      try { cancel(idleId); } catch { /* ignore */ }
      controller.abort();
    };
  }, [lens, selectedAccount, periodKey, periodRanges, monthCache, reloadKey]);

  // Period ribbon derivation. Walks the visible-month days and buckets by
  // meta.period; each bucket becomes a segment with its first/last in-month
  // date. Days with no meta.period (past the seeded fiscal range) simply
  // don't contribute - the ribbon renders only the populated stretch and
  // hides entirely when no day in the month carries a period. Segment
  // flex-grow is set to the day count so a period spanning most of the
  // month visually dominates without rendering as a precise gantt.
  // ribbonToday carries today's period/week for the highlight + chip; null
  // when today is not in the visible month or has no metadata.
  const periodRibbon = useMemo(() => {
    if (!data?.days?.length) return { segments: [], today: null };
    const byPeriod = new Map();
    for (const d of data.days) {
      const p = d?.meta?.period;
      if (!p) continue;
      if (!byPeriod.has(p)) byPeriod.set(p, { period: p, start: d.date, end: d.date, days: 0 });
      const seg = byPeriod.get(p);
      if (d.date < seg.start) seg.start = d.date;
      if (d.date > seg.end)   seg.end   = d.date;
      seg.days += 1;
    }
    const segments = [...byPeriod.values()].sort((a, b) => a.start.localeCompare(b.start));
    const t = dayMap[today];
    const ribbonToday = (t?.meta?.period)
      ? { date: today, period: t.meta.period, week: t.meta.week || null }
      : null;
    return { segments, today: ribbonToday };
  }, [data, dayMap, today]);

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
  const todayMonth = new Date().getMonth();
  // PR-B2: today's period + week for goToToday's lens-aware landing
  // under lens=period. periodRanges drives the period; periodDays
  // (when loaded) drives the week. Falls back to "W1" if today is
  // outside the period or no week metadata is present.
  const todayPeriod = useMemo(() => {
    if (!periodRanges?.length) return null;
    return periodRanges.find(r => today >= r.start && today <= r.end)?.period || null;
  }, [periodRanges, today]);

  // Raise the one-shot ref BEFORE setMonth so the sc-load effect's
  // re-fire (keyed on mk) sees the flag and skips its own focusDay
  // clear. focusDay is then set synchronously - no setTimeout race.
  //
  // PR-B2: lens-aware. Under lens=period the goToToday lands at
  // scope=period + periodKey=currentPeriod + focusDay=today. The
  // weekKey lazily initializes (via the weekKey-init effect) once
  // periodDays land - we don't need to set it here. Under lens=
  // calendar the original behavior holds.
  const goToToday = useCallback(() => {
    todayLandingRef.current = true;
    setMonth(todayMonth);
    setIsAdminView(false);
    if (lens === "period") {
      setScope("period");
      if (todayPeriod) setPeriodKey(todayPeriod);
    } else {
      setScope("month");
      setLens("calendar");
    }
    setFocusDay(today);
  }, [todayMonth, today, lens, todayPeriod]);

  // PR-B2 focus-day data + nav extended to the period view. When
  // lens=period, focusDayData first checks periodDays (which may
  // include days from a calendar month different from `data`); the
  // day-list (used by DayDetail's prev/next nav) is the period's
  // sorted days. Under lens=calendar the original month-view source
  // holds (data.days via dayMap).
  const inPeriodView = lens === "period" && scope === "period" && !isAdminView;
  const focusDayData = focusDay
    ? (inPeriodView && periodDays
        ? (periodDays.find(d => d.date === focusDay) || dayMap[focusDay] || null)
        : (dayMap[focusDay] || null))
    : null;
  const dayList = inPeriodView && periodDays
    ? periodDays.map(d => d.date)
    : (data?.days?.map(d => d.date) || []);
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
            {isAdminView ? (
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
          <LensBar
            scope={scope}
            lens={lens}
            isAdminView={isAdminView}
            isAdmin={isAdmin}
            onScopeChange={(nextScope) => {
              setScope(nextScope);
              setIsAdminView(false);
              setFocusDay(null);
              setBulkMode(false);
            }}
            // PR-B2 lens switch. Scope-reset to the lens's default
            // sub-year altitude; year is shared and stays. This is
            // the invalid-combo guard at the source - SEGMENTS_BY_LENS
            // determines which segments render, and this reset keeps
            // scope inside that set.
            onLensChange={(nextLens) => {
              setLens(nextLens);
              setIsAdminView(false);
              setFocusDay(null);
              setBulkMode(false);
              if (scope !== "year") {
                setScope(nextLens === "period" ? "period" : "month");
              }
            }}
            onTodayClick={goToToday}
            // B1.1: admin button toggles. Entering admin clears focus +
            // bulk; exiting just flips the flag and the prior (scope,
            // lens) re-renders underneath (PR-A preserves them).
            onAdminClick={() => {
              if (isAdminView) {
                setIsAdminView(false);
              } else {
                setIsAdminView(true);
                setFocusDay(null);
                setBulkMode(false);
              }
            }}
          />
        </div>
        <div className="sc-subheader">
          <div className="sc-date-nav">
            {isMonthView && (
              <>
                <button className="sc-date-btn" onClick={() => setMonth(p => Math.max(0, p-1))}>&#8249;</button>
                <span className="sc-date-label">{MONTHS[month]} {year}</span>
                <button className="sc-date-btn" onClick={() => setMonth(p => Math.min(11, p+1))}>&#8250;</button>
              </>
            )}
            {isYearView && <span className="sc-date-label">{year}</span>}
            {isPeriodView && periodRanges && (() => {
              const idx = periodRanges.findIndex(r => r.period === periodKey);
              const cur = idx >= 0 ? periodRanges[idx] : null;
              const prev = idx > 0 ? periodRanges[idx - 1] : null;
              const next = idx >= 0 && idx < periodRanges.length - 1 ? periodRanges[idx + 1] : null;
              return (
                <>
                  <button
                    className="sc-date-btn"
                    onClick={() => prev && setPeriodKey(prev.period)}
                    disabled={!prev}
                    aria-label="Previous period"
                  >&#8249;</button>
                  <span className="sc-date-label">
                    {cur ? `Period ${cur.period.replace(/^P/, "")}` : (periodKey ? `Period ${periodKey.replace(/^P/, "")}` : "Period")}
                  </span>
                  <button
                    className="sc-date-btn"
                    onClick={() => next && setPeriodKey(next.period)}
                    disabled={!next}
                    aria-label="Next period"
                  >&#8250;</button>
                </>
              );
            })()}
          </div>
        </div>

        {isMonthView && (
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
                {periodRibbon.segments.length > 0 && (
                  <div className="sc-month-ribbon" aria-label="Fiscal period overview">
                    <div className="sc-month-ribbon-track">
                      {periodRibbon.segments.map((seg) => {
                        const isCurrent = periodRibbon.today?.period === seg.period;
                        const startD = new Date(seg.start + "T12:00:00");
                        const endD   = new Date(seg.end   + "T12:00:00");
                        const startLabel = `${MONTHS[startD.getMonth()].slice(0,3)} ${startD.getDate()}`;
                        const endLabel   = `${MONTHS[endD.getMonth()].slice(0,3)} ${endD.getDate()}`;
                        const range = seg.start === seg.end ? startLabel : `${startLabel} - ${endLabel}`;
                        return (
                          <div key={seg.period}
                            className={`sc-month-ribbon-segment ${isCurrent ? "sc-month-ribbon-segment--current" : ""}`}
                            style={{ flexGrow: seg.days, flexBasis: 0 }}>
                            <span className="sc-month-ribbon-period">Period {seg.period}</span>
                            <span className="sc-month-ribbon-range">{range}</span>
                          </div>
                        );
                      })}
                    </div>
                    {periodRibbon.today && (
                      <div className="sc-month-ribbon-today">
                        Today: Period {periodRibbon.today.period}{periodRibbon.today.week ? ` · ${periodRibbon.today.week}` : ""}
                      </div>
                    )}
                  </div>
                )}

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

        {/* PR-SC-Redesign Stage 1: the new Season shell becomes the
            default year-landing render. The legacy `.sc-year-body`
            below remains intact behind `?legacy=year` so the working
            fallback survives through Stage 6 (spec 11.4). Both branches
            consume the SAME yearData/yearToday/yearBannerStats; no data
            fork. The new shell delegates month-card clicks to the
            existing month-drill so wiring continues to work today. */}
        {isYearView && !legacyYearView && (
          <SeasonShell
            account={data?.account}
            year={year}
            yearData={yearData}
            yearToday={yearToday}
            yearBannerStats={yearBannerStats}
            hasHomestandSchedule={hasHomestandSchedule}
            isFeeAccount={isFeeAccount}
            isMilb={isMilb}
            loading={loading || !data || !yearData}
            onMonthClick={(mi) => { setMonth(mi); setScope("month"); setLens("calendar"); }}
            /* Stage 2: Period side of the toggle drills into the
               existing PeriodLensView (lens=period, scope=period) as
               the stub target. Stage 3 replaces it with the new
               Period workspace. periodRanges already flows through
               the existing year-summary effect. */
            periodRanges={periodRanges}
            onPeriodClick={(periodLabel) => {
              setPeriodKey(periodLabel);
              setLens("period");
              setScope("period");
            }}
          />
        )}

        {isYearView && legacyYearView && (
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
                {yearToday?.period && (
                  <span className="sc-year-banner-period">Period {yearToday.period}{yearToday.week ? ` · ${yearToday.week}` : ""}</span>
                )}
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
                    onClick={() => { setMonth(mi); setScope("month"); setLens("calendar"); }}>
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

        {isPeriodView && (
          <PeriodLensView
            data={data}
            periodDays={periodDays}
            periodMetrics={periodMetrics}
            periodKey={periodKey}
            periodRange={periodRanges?.find(r => r.period === periodKey) || null}
            weekKey={weekKey}
            onWeekChange={setWeekKey}
            onDayClick={(date) => setFocusDay(date)}
            isFeeAccount={isFeeAccount}
            hasHomestandSchedule={hasHomestandSchedule}
            homestandMap={homestandMap}
            isMilb={isMilb}
            today={today}
            loading={loading && !periodDays}
            partialError={partialError}
            onRetryPartial={() => setReloadKey(k => k + 1)}
            STATUS={STATUS}
            dayStatus={dayStatus}
            daySummary={daySummary}
            nextServicePeriod={nextServicePeriod}
            onJumpToNextPeriod={() => { if (nextServicePeriod) setPeriodKey(nextServicePeriod); }}
          />
        )}

        {/* Admin in-page view mode (Bundle 2 follow-up). Renders ONLY for
            isAdmin - the API server-side gates on every admin POST action
            remain the security boundary; this gate is just about not
            showing a control to non-admins (and not rendering the body
            if a non-admin somehow lands on ?view=admin). */}
        {isAdminView && isAdmin && (
          <div className="sc-admin-body sc-fade-in">
            <AdminPanel
              view={adminView}
              onViewChange={setAdminView}
              showToast={showToast}
            />
          </div>
        )}
      </div>

      {/* Day detail overlay. serviceGroups fall back to periodServiceGroups
          when in period view, since the focused day may belong to a calendar
          month different from `data` (a period can span two months). */}
      {focusDay && focusDayData && (data?.serviceGroups || periodServiceGroups) && (
        <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setFocusDay(null); }}>
          <div className="sc-overlay-card" data-density="comfortable">
            <DayDetail day={focusDayData} serviceGroups={data?.serviceGroups || periodServiceGroups}
              overrides={data?.overrides?.filter(o => o.date === focusDay) || []}
              onSave={handleSave} onConfirmAsProjected={handleConfirmAsProjected} saving={saving}
              dayIndex={focusIdx} totalDays={dayList.length}
              monthRevenue={inPeriodView ? (periodMetrics?.actRev || periodMetrics?.projRev || 0) : (metrics.actRev || metrics.projRev)}
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