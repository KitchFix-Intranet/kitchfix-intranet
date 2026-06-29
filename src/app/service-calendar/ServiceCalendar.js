"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DayDetail from "./DayDetail";
import SeasonShell from "./season/SeasonShell";
import PeriodWorkspace from "./season/PeriodWorkspace";
import ChromeBar from "./season/ChromeBar";
import StickyContext from "./season/StickyContext";
import { isScAdmin } from "@/lib/admin";
import AdminPanel from "./admin/AdminPanel";
import { computeInitialView } from "./computeInitialView";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

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
  // Initial scope=year so the SeasonShell skeleton renders during
  // the brief mount-to-accounts-loaded window; computeInitialView
  // overrides this once roles arrive (floor users land on Period).
  const [scope, setScope] = useState("year");
  const [lens, setLens]   = useState("calendar");
  const [isAdminView, setIsAdminView] = useState(false);
  const [adminView, setAdminView] = useState({ mode: "overview" });
  const [data, setData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [yearToday, setYearToday] = useState(null);
  // Period lens state.
  //   periodKey   = which period ("P7") the user is viewing.
  //   monthCache  = { "2026-06": <sc-load payload>, ... } - already-
  //                 fetched calendar months, merged 1-2 into a period
  //                 view without refetching.
  //   periodRanges = [{ period, start, end }, ...] from sc-year-summary;
  //                  drives prev/next period nav + period -> calendar-
  //                  month derivation.
  //   partialError = null | { failedMonth: "2026-07" } for the honest
  //                  partial-data state.
  const [periodKey, setPeriodKey] = useState(null);
  const [monthCache, setMonthCache] = useState({});
  const [periodRanges, setPeriodRanges] = useState(null);
  const [partialError, setPartialError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [focusDay, setFocusDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Design Batch 2: data-freshness timestamp. Tracks when the year
  // summary (the SC's primary data anchor) last landed. Rendered as
  // "as of <time>" in the chrome bar (rubric Part 3 data-freshness).
  const [asOf, setAsOf] = useState(null);

  // Admin gate (client-side - just controls whether the toggle + body
  // RENDER, not authorization). Server-side isScAdmin checks on every
  // admin POST action in route.js remain the security boundary.
  const isAdmin = isScAdmin(session?.user?.email);

  // Derived view booleans - pure functions of (scope, lens, isAdminView).
  // Use these for render conditions; effects must depend on the
  // underlying scope/lens state so they don't over-fire.
  // Year is lens-agnostic at scope=year (SeasonShell's internal toggle
  // handles the calendar/period sub-view). Period scope only renders
  // when lens=period.
  const isYearView   = !isAdminView && scope === "year"   && (lens === "calendar" || lens === "period");
  const isPeriodView = !isAdminView && scope === "period" && lens === "period";

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
        // Mount default: routed through computeInitialView() so the
        // role-conditional landing (floor -> Period workspace at the
        // current period; leadership -> Season overview) is one body
        // edit in the helper, not a scatter here.
        //
        // Role activation: sc-accounts now returns `roles[]` from
        // contacts.role for the requesting user. A user can have
        // multiple contacts rows (one per role/account combo, per
        // sc-3 seed), so we pass the array - the helper applies the
        // floor-wins tiebreaker (tierFromRoles). Empty/missing roles
        // resolve to "unknown" tier -> Season default (no regression).
        const initialView = computeInitialView({
          urlView: searchParams?.get("view"),
          urlPeriod: searchParams?.get("period"),
          isAdmin,
          roles: d.roles || [],
        });
        setScope(initialView.scope);
        setLens(initialView.lens);
        setIsAdminView(initialView.isAdminView);
        if (initialView.periodKey) setPeriodKey(initialView.periodKey);
        // landOnCurrentPeriod handled by the periodRanges-init effect
        // below: when a floor role lands and periodRanges arrives,
        // periodKey gets set to the period containing today. The
        // existing init effect already does this for the no-periodKey
        // case, so the floor landing piggybacks on it for free.
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
    setPeriodRanges(null);
    setPartialError(null);
  }, [selectedAccount]);

  const mk = `${year}-${String(month+1).padStart(2,"0")}`;
  useEffect(() => {
    if (!selectedAccount) return;
    const controller = new AbortController();
    setLoading(true); setFocusDay(null); setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false);
    fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}&clientToday=${encodeURIComponent(today)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); else { showToast(d.error || "Failed", "error"); setData(null); } })
      .catch(e => { if (e.name !== "AbortError") { showToast("Network error", "error"); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedAccount, mk, showToast, reloadKey, today]);

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
    fetch(`/api/service-calendar?action=sc-year-summary&account=${selectedAccount}&clientToday=${encodeURIComponent(today)}`)
      .then(r => r.json()).then(d => {
        if (!d.success) return;
        setYearData(d.months);
        setYearToday(d.today || null);
        if (d.periodRanges) setPeriodRanges(d.periodRanges);
        // Design Batch 2: stamp the load time once data lands.
        setAsOf(new Date());
      }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, lens, isAdminView, selectedAccount, reloadKey, today]);

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
      fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}&clientToday=${encodeURIComponent(today)}`, { signal: controller.signal })
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
  }, [lens, selectedAccount, periodKey, periodRanges, reloadKey, today]);

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

  // periodHomestandMap: merge the per-month homestandMap entries across
  // the 1-2 calendar months the period spans. The route's sc-load
  // returns homestandMap scoped to ONE calendar month; monthCache stores
  // each fetched month's full payload (route.js:390 includes
  // responsePayload.homestandMap). When a fiscal period crosses a month
  // boundary (e.g. Period 9 = Jun 22 - Jul 19), the second-month days
  // need the second-month's map for opponent + day_type. Without this
  // merge, days in the off-data month look up an absent key and render
  // blank (the symptom audited in docs/SC_DATA_AUDIT.md PART B).
  //
  // Per-meal accounts have no homestandMap in their payloads, so the
  // merged result is {} (same as today's data.homestandMap fallback).
  const periodHomestandMap = useMemo(() => {
    if (lens !== "period" || !periodKey || !periodRanges) return null;
    const range = periodRanges.find((r) => r.period === periodKey);
    if (!range) return null;
    const monthsNeeded = monthsBetween(range.start, range.end);
    const merged = {};
    for (const mk of monthsNeeded) {
      const m = monthCache[mk];
      if (m?.homestandMap) Object.assign(merged, m.homestandMap);
    }
    return merged;
  }, [lens, periodKey, periodRanges, monthCache]);

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
        fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}&clientToday=${encodeURIComponent(today)}`, { signal: controller.signal })
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
  }, [lens, selectedAccount, periodKey, periodRanges, monthCache, reloadKey, today]);

  // Account-level mode classification (consumed by SeasonShell and
  // PeriodWorkspace via props). Three display modes per spec section 6
  // (the two-axis polymorphism: operational shape x financial frame):
  //   1. hasHomestandSchedule              -> homestand-fee (MLB fee)
  //   2. !hasHomestandSchedule && isFeeAccount -> operational-only (STL-FL)
  //   3. !isFeeAccount                     -> per-meal (everyone else)
  // MiLB is hybrid: per-meal financially + schedule rhythm operationally.
  const isFeeAccount = data?.account?.billingModel === "flat_fee";
  const hasHomestandSchedule = !!data?.homestandMap;
  const homestandMap = data?.homestandMap || {};
  const isMilb = data?.account?.category === "MiLB";

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

  // DayDetail focus-day data + nav. After Stage 6 the day-detail overlay
  // only opens from the Period workspace, so periodDays is the canonical
  // day-list. dayMap stays as a fallback for the rare case the focused
  // day isn't yet in periodDays (e.g. mid-fetch race).
  const focusDayData = focusDay
    ? (periodDays?.find(d => d.date === focusDay) || dayMap[focusDay] || null)
    : null;
  const dayList = periodDays
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

  // Design Batch 2: jump-to-next-needing-entry. Finds the soonest
  // (earliest service_date) day in yearData with status needs-entry
  // or overdue. Returns { date, period } so the click handler can
  // navigate to the right period workspace and focus the day. Pure
  // memo over yearData + periodRanges; no fetch, no engine touch.
  const jumpTarget = useMemo(() => {
    if (!yearData) return null;
    let earliest = null;
    for (const m of yearData) {
      if (!m.days) continue;
      for (const d of m.days) {
        if (d.status !== "needs-entry" && d.status !== "overdue") continue;
        if (!earliest || d.date < earliest.date) {
          earliest = { date: d.date, status: d.status };
        }
      }
    }
    if (!earliest) return null;
    if (!periodRanges?.length) return earliest;
    const range = periodRanges.find(r => earliest.date >= r.start && earliest.date <= r.end);
    return { ...earliest, period: range?.period || null };
  }, [yearData, periodRanges]);

  const handleJumpToNext = useCallback(() => {
    if (!jumpTarget) return;
    if (jumpTarget.period) {
      setPeriodKey(jumpTarget.period);
      setLens("period");
      setScope("period");
    }
    setFocusDay(jumpTarget.date);
  }, [jumpTarget]);

  // The chrome bar's Calendar | Period toggle controls the Season
  // shell's SUB-view (year-of-months grid vs 4x3-periods grid),
  // matching the legacy CalendarPeriodToggle that used to live inside
  // SeasonShell. It does NOT drive the Season-vs-Workspace switch -
  // that's driven by drilling (month-card or period-card click).
  // We lift the sub-view here so the chrome bar can host the toggle.
  const [seasonView, setSeasonView] = useState("calendar");
  const handleSeasonViewChange = useCallback((next) => {
    setSeasonView(next === "period" ? "period" : "calendar");
  }, []);

  const handleRefresh = useCallback(() => {
    setReloadKey(k => k + 1);
  }, []);

  const handleAdminToggle = useCallback(() => {
    if (isAdminView) {
      setIsAdminView(false);
    } else {
      setIsAdminView(true);
      setFocusDay(null);
      setBulkMode(false);
    }
  }, [isAdminView]);

  // Design Batch 2: the chrome bar holds the picker / toggle / Admin
  // (the controls that used to be scattered) and the as-of timestamp.
  // The compressed hero sits below it. Both render in every view
  // (Season + Period + admin) so they don't flash on toggle.
  const accountDropdown = isAdminView ? (
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
    <AccountDropdown accounts={accounts} value={selectedAccount} onChange={setSelectedAccount} />
  );

  return (
    <div className="sc-root" data-density="compact" data-billing={isFeeAccount ? "flat_fee" : "per_meal"} data-category={data?.account?.category || ""}>
      <ChromeBar
        accountDropdown={accountDropdown}
        category={!isAdminView ? category : null}
        view={seasonView}
        onViewChange={handleSeasonViewChange}
        showToggle={!isAdminView && isYearView}
        asOf={asOf}
        onRefresh={handleRefresh}
        isAdmin={isAdmin}
        isAdminView={isAdminView}
        onAdminToggle={handleAdminToggle}
      />

      {!isAdminView && (
        <StickyContext
          accountKey={selectedAccount}
          todayLabel={yearBannerStats?.todayLabel}
          periodNum={yearToday?.period ? (String(yearToday.period).match(/\d+/)?.[0] ?? null) : null}
          weekNum={yearToday?.week ? (String(yearToday.week).match(/\d+/)?.[0] ?? null) : null}
          pctRecorded={hasHomestandSchedule
            ? (yearBannerStats?.totalGameDays > 0
                ? Math.round((yearBannerStats.gameDaysEntered / yearBannerStats.totalGameDays) * 100)
                : null)
            : (yearBannerStats?.totalDays > 0
                ? Math.round((yearBannerStats.daysRecorded / yearBannerStats.totalDays) * 100)
                : null)
          }
          isFeeAccount={isFeeAccount}
          needsEntry={yearBannerStats?.needsEntry || 0}
          overdue={yearBannerStats?.overdue || 0}
          gameDaysEntered={yearBannerStats?.gameDaysEntered || 0}
          totalGameDays={yearBannerStats?.totalGameDays || 0}
        />
      )}

      <div className="sc-body">
        {isYearView && (
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
            // Calendar month-card drill: jump to the Period workspace
            // for the period containing the month's midpoint. Spec 6:
            // a month is just a slice of a period - clicking it drills
            // DOWN into the operational scope, not sideways into a
            // deprecated month view. Midpoint heuristic picks the
            // period that owns the larger share of the month.
            onMonthClick={(mi) => {
              const target = `${year}-${String(mi + 1).padStart(2, "0")}-15`;
              const containing = periodRanges?.find(r => target >= r.start && target <= r.end);
              const fallback = periodRanges?.find(r => today >= r.start && today <= r.end) || periodRanges?.[0];
              const next = containing || fallback;
              if (!next) return;
              setPeriodKey(next.period);
              setLens("period");
              setScope("period");
              setFocusDay(null);
              setBulkMode(false);
            }}
            periodRanges={periodRanges}
            onPeriodClick={(periodLabel) => {
              setPeriodKey(periodLabel);
              setLens("period");
              setScope("period");
            }}
            // Design Batch 2 - lifted view + info-card props
            view={seasonView}
            onViewChange={handleSeasonViewChange}
            onJumpToNext={handleJumpToNext}
            hasJumpTarget={!!jumpTarget}
          />
        )}


        {isPeriodView && (
          <PeriodWorkspace
            account={data?.account}
            year={year}
            periodKey={periodKey}
            periodRange={periodRanges?.find(r => r.period === periodKey) || null}
            periodRanges={periodRanges}
            periodDays={periodDays}
            periodMetrics={periodMetrics}
            hasHomestandSchedule={hasHomestandSchedule}
            isFeeAccount={isFeeAccount}
            isMilb={isMilb}
            homestandMap={periodHomestandMap || homestandMap}
            today={today}
            loading={loading && !periodDays}
            partialError={partialError}
            onClimbToSeason={() => { setLens("calendar"); setScope("year"); setFocusDay(null); setBulkMode(false); setBulkSelected(new Set()); }}
            onPrevPeriod={() => {
              if (!periodRanges?.length) return;
              const idx = periodRanges.findIndex(r => r.period === periodKey);
              if (idx > 0) setPeriodKey(periodRanges[idx - 1].period);
            }}
            onNextPeriod={() => {
              if (!periodRanges?.length) return;
              const idx = periodRanges.findIndex(r => r.period === periodKey);
              if (idx >= 0 && idx < periodRanges.length - 1) setPeriodKey(periodRanges[idx + 1].period);
            }}
            onTodayJump={() => {
              if (!periodRanges?.length) return;
              const containingToday = periodRanges.find(r => today >= r.start && today <= r.end);
              if (containingToday) setPeriodKey(containingToday.period);
            }}
            onDayClick={(date) => setFocusDay(date)}
            bulkMode={bulkMode}
            onBulkModeToggle={(next) => { setBulkMode(next); if (!next) setBulkSelected(new Set()); }}
            bulkSelected={bulkSelected}
            onBulkTileClick={toggleBulkSelect}
            onBulkOpenPanel={() => setBulkPanelOpen(true)}
            onBulkConfirmAsProjected={handleBulkConfirm}
            onBulkCancel={() => { setBulkMode(false); setBulkSelected(new Set()); setBulkPanelOpen(false); }}
            saving={saving}
          />
        )}

        {/* Admin in-page view mode. Renders ONLY for
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
          since the focused day may belong to a calendar month different
          from `data` (a period can span two months). */}
      {focusDay && focusDayData && (data?.serviceGroups || periodServiceGroups) && (
        <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setFocusDay(null); }}>
          <div className="sc-overlay-card" data-density="comfortable">
            <DayDetail day={focusDayData} serviceGroups={data?.serviceGroups || periodServiceGroups}
              overrides={data?.overrides?.filter(o => o.date === focusDay) || []}
              onSave={handleSave} onConfirmAsProjected={handleConfirmAsProjected} saving={saving}
              dayIndex={focusIdx} totalDays={dayList.length}
              monthRevenue={periodMetrics?.actRev || periodMetrics?.projRev || 0}
              scopeLabel="period"
              accountName={acctObj?.name || ""}
              isFeeAccount={isFeeAccount} homestandContext={(periodHomestandMap || homestandMap)[focusDay] || null}
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
