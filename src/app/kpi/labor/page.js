"use client";
// /kpi/labor
//
// KPI Dashboard - Labor section.
//
// D2 (Push 1): three-zone shell landed. Chrome, folio rail (account
// navigation), scope band (dates + presets + workers + views), quick
// panel (counts + copy + export + hide-names) extracted into components
// under ./components. Formatters + account roster in ./lib. Middle
// content (metrics, table) and the rest of the right rail remain
// inline here - Push 2 replaces the middle (hero + 8-card grid + trend
// + inline drill), Push 3 replaces states + rail lower + motion + B*.
//
// Persistent shape from C4: URL state (?account, ?start, ?end, ?workers,
// ?redact, ?view), saved views CRUD, dirty detection, three modal
// dialogs (Save / Edit / Delete-confirm).

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { resolveViewDates, addDaysISO } from "@/lib/kpi/dateResolve";
import { fmt$, fmtHrs, hoursSinceISO, fmtTimestamp } from "./lib/formatting";
import { ACCOUNTS, FY_START } from "./lib/accounts";
import { periodOf, fiscalYearOf, currentPeriodNo as periodOfDate, weekOfPeriod, inferRangeSelection } from "./lib/periods";
import { Shell } from "./components/Shell";
import { FolioRail, PSEUDO_KEYS } from "./components/FolioRail";
import { ScopeBand, buildVdefLine } from "./components/ScopeBand";
import { Hero } from "./components/Hero";
import { MetricGrid } from "./components/MetricGrid";
import { TrendChart } from "./components/TrendChart";
import { WeekTable } from "./components/WeekTable";
import { ContextRail } from "./components/ContextRail";
import {
  StateLoading, StateEmptyFirstRun, StateEmptyFiltered, StateEmptyRange, StateError,
  StateStale, StateSalaried, StateNotAuthorized, StateSessionExpired,
  errorCode,
} from "./components/StateBoxes";
import { ToastHost } from "./components/Toast";
import "../kpi.css";

// B15 last-viewed account key (localStorage). Read once on client mount
// only; server render always uses the URL/default. Never leaks data.
const LAST_ACCOUNT_KEY = "kpi:labor:lastAccount";
// V6-8 - last committed range persistence (kpi.range). Stores just
// { startISO, endISO } - the selection type is inferable from those
// via inferRangeSelection so we do not duplicate state.
const LAST_RANGE_KEY = "kpi:labor:lastRange";

function workerLabel(meta, worker_id, redact) {
  const num = meta?.number != null ? `#${meta.number}` : `#${String(worker_id).slice(0, 6)}`;
  if (redact || !meta?.display_name) {
    const title = meta?.title ? ` · ${meta.title}` : "";
    return `${num}${title}`;
  }
  return `${meta.display_name} (${num})`;
}

// Compare two arrays as sets. Empty/null/missing equivalence:
//   both null/undefined OR both empty -> equal
//   otherwise, set equality of contents
function sameWorkerSet(a, b) {
  const A = Array.isArray(a) && a.length ? new Set(a) : null;
  const B = Array.isArray(b) && b.length ? new Set(b) : null;
  if (A === null && B === null) return true;
  if (A === null || B === null) return false;
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

export default function KpiLaborPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = session?.user?.email?.toLowerCase().trim() || "";
  const isAllowed = OPS_LEADERSHIP_EMAILS.includes(email);

  // B15: default account resolution. URL wins. Otherwise on first client
  // mount we adopt the last-viewed account from localStorage; if none,
  // fall back to "CIN - OH" (the sentinel account).
  const urlAccount = searchParams.get("account");
  const account = urlAccount || "CIN - OH";
  const tab = searchParams.get("tab") || "labor";
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlAccount) {
      // Remember whatever the user is actually on.
      try { localStorage.setItem(LAST_ACCOUNT_KEY, urlAccount); } catch {}
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(LAST_ACCOUNT_KEY); } catch {}
    // V6 - accept pseudo-keys ALL / EAST / WEST alongside real
    // account team_keys in the last-account persistence.
    if (saved && saved !== "CIN - OH" && (ACCOUNTS.includes(saved) || PSEUDO_KEYS.has(saved))) {
      const p = new URLSearchParams(searchParams.toString());
      p.set("account", saved);
      router.replace(`/kpi/labor?${p.toString()}`);
    }
  }, [urlAccount, router, searchParams]);

  const today = new Date().toISOString().slice(0, 10);
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  const start = urlStart || FY_START;
  const end = urlEnd || today;
  const redact = searchParams.get("redact") === "1";
  const workersParam = (searchParams.get("workers") || "").trim();
  const selectedWorkers = useMemo(
    () => (workersParam ? new Set(workersParam.split(",").filter(Boolean)) : null),
    [workersParam]
  );
  // V6-5/V6-7 - inference computed EARLY so the grouped memo can key
  // its grouping mode on it (month vs period). Downstream aliases
  // (selectedPeriodNo, selectedMonth, rangeSelection) are declared
  // near the RangeMenu wiring for readability.
  const rangeSelectionEarly = useMemo(() => inferRangeSelection(start, end), [start, end]);
  const viewIdParam = searchParams.get("view");
  const activeViewId = viewIdParam ? parseInt(viewIdParam, 10) : null;
  // Track how the current dates were arrived at (last preset click).
  // Used when serializing "save as new / update" to preserve preset
  // intent instead of freezing a resolved range.
  const [lastPreset, setLastPreset] = useState(null);

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);
  const [errCode, setErrCode] = useState(null);
  const [authError, setAuthError] = useState(null); // "expired" (401) | "forbidden" (403) | null

  // P10 / P11 toast + B10 live region. One toast at a time.
  const [toast, setToast] = useState(null);
  // B10 live region text - kept separate so we can announce without a
  // visible toast (e.g., account switch, filter change).
  const [liveMsg, setLiveMsg] = useState("");
  // B1 undo state: remember the last deleted view for 6s. If undo fires
  // we POST it back; otherwise it silently drops.
  const [pendingUndo, setPendingUndo] = useState(null);
  // B10: focus-to-hero handle after account switch or filter clear.
  const heroRef = useRef(null);
  const focusHero = useCallback(() => {
    const el = heroRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, []);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [expandedPeriods, setExpandedPeriods] = useState(new Set());
  const [views, setViews] = useState([]);
  const [viewsLoaded, setViewsLoaded] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [viewError, setViewError] = useState(null);
  // Modal / dialog state for saved views UX
  const [saveDialog, setSaveDialog] = useState(null);   // { mode: "new" | "update", initialName }
  const [editDialog, setEditDialog] = useState(null);   // view object being edited
  const [confirmDelete, setConfirmDelete] = useState(null);   // view object being deleted

  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      const body = document.body;
      if (mq.matches) { body?.setAttribute("data-density", "compact"); setIsCompact(true); }
      else            { body?.removeAttribute("data-density");         setIsCompact(false); }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ── Fetch labor data ──────────────────────────────────
  // B14 timing marks: performance.mark bracketing the fetch to make
  // p95 measurable in devtools. See spec §5 initial ≤1.5s budget.
  //
  // 08/13 wedge hotfix - three defenses layered here:
  //   (a) AbortController: cleanup ABORTS the in-flight fetch instead of
  //       relying on a `cancelled` flag that stale closures still resolve.
  //       Prior pattern let two fetches race and both no-op their state
  //       transitions when their cleanup fired before their .then.
  //   (b) 15s hard timeout: if the network is quiet-but-stuck (extension,
  //       flaky VPN, ISP hiccup), the fetch transitions to an error state
  //       with a Retry CTA rather than spinning skeleton forever.
  //   (c) session status "loading" does NOT block a fetch we're already
  //       able to run. If we've been authenticated once (isAllowed was
  //       true) and status flaps back to "loading" (authjs refresh
  //       failure), we keep the last-good `data` on screen and don't
  //       reset back to skeleton.
  useEffect(() => {
    if (status !== "authenticated" || !isAllowed) return;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(new Error("timeout_15s")), 15000);
    setLoadState("loading");
    setErrorMsg(null);
    setErrCode(null);
    setAuthError(null);
    const params = new URLSearchParams({ account, start, end });
    const markBase = `kpi-labor-fetch-${account}`;
    try { performance.mark(`${markBase}-start`); } catch {}
    fetch(`/api/kpi/labor?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        // B4: auth states off the real fetch. 401 -> session-expired,
        // 403 -> not-authorized. Both render StateBoxes; zero data leak.
        if (r.status === 401) { setAuthError("expired"); throw new Error("session_expired"); }
        if (r.status === 403) { setAuthError("forbidden"); throw new Error("forbidden"); }
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setData(d); setLoadState("ok");
        try {
          performance.mark(`${markBase}-end`);
          performance.measure(markBase, `${markBase}-start`, `${markBase}-end`);
        } catch {}
      })
      .catch((e) => {
        // AbortError from cleanup: silent (a newer effect is inbound).
        // AbortError from our timeout: visible error with retry.
        if (e?.name === "AbortError" && String(ctrl.signal.reason?.message || "") !== "timeout_15s") {
          return;
        }
        if (String(e?.message) === "session_expired" || String(e?.message) === "forbidden") {
          setLoadState("auth");
          return;
        }
        const msg = e?.name === "AbortError" || String(ctrl.signal.reason?.message || "") === "timeout_15s"
          ? "Request took longer than 15 seconds. The API is reachable but the browser tab did not receive a response - retry, or check for a blocking extension."
          : String(e?.message || e).slice(0, 200);
        setLoadState("error");
        setErrorMsg(msg);
        setErrCode(errorCode("labor", e));
      })
      .finally(() => clearTimeout(to));
    return () => { clearTimeout(to); ctrl.abort(); };
  }, [status, isAllowed, account, start, end]);

  // ── Fetch saved views ─────────────────────────────────
  const refetchViews = useCallback(async () => {
    if (status !== "authenticated" || !isAllowed) return;
    setViewError(null);
    try {
      const r = await fetch(`/api/kpi/labor/views?account=${encodeURIComponent(account)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setViews(body.views || []);
    } catch (e) {
      setViewError(String(e.message || e).slice(0, 160));
      setViews([]);
    }
    setViewsLoaded(true);
  }, [status, isAllowed, account]);

  useEffect(() => { refetchViews(); }, [refetchViews]);

  const activeView = useMemo(
    () => (activeViewId ? views.find(v => v.id === activeViewId) : null) || null,
    [activeViewId, views]
  );

  // Resolve active view's dates against today + account_periods
  const resolvedActiveRange = useMemo(() => {
    if (!activeView) return null;
    return resolveViewDates(activeView, { today, accountPeriods: data?.account_periods || [] });
  }, [activeView, data, today]);

  // ── Auto-apply active view to URL on load ───────────
  // When view is present in URL but URL has no other params, resolve
  // and push. Runs when the view finishes loading OR when the account
  // periods arrive (last_period/this_period needs periods).
  useEffect(() => {
    if (!activeView) return;
    const resolved = resolvedActiveRange;
    if (!resolved) return;
    // Only push if URL params are absent (freshly-loaded view link).
    if (urlStart == null && urlEnd == null && !workersParam) {
      const p = new URLSearchParams(searchParams.toString());
      p.set("start", resolved.start);
      p.set("end",   resolved.end);
      if (activeView.worker_ids && activeView.worker_ids.length > 0) {
        p.set("workers", activeView.worker_ids.join(","));
      }
      if (activeView.redact) p.set("redact", "1");
      router.replace(`/kpi/labor?${p.toString()}`);
    }
  }, [activeView, resolvedActiveRange, urlStart, urlEnd, workersParam, router, searchParams]);

  // ── Dirty detection ──────────────────────────────────
  const isDirty = useMemo(() => {
    if (!activeView) return false;
    if (!resolvedActiveRange) return false;
    if (resolvedActiveRange.start !== start) return true;
    if (resolvedActiveRange.end   !== end) return true;
    if (!sameWorkerSet(activeView.worker_ids, workersParam ? workersParam.split(",") : null)) return true;
    if ((!!activeView.redact) !== redact) return true;
    return false;
  }, [activeView, resolvedActiveRange, start, end, workersParam, redact]);

  // ── URL setters ──────────────────────────────────────
  const setParam = (key, value) => {
    const p = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") p.delete(key);
    else p.set(key, value);
    router.push(`/kpi/labor?${p.toString()}`);
  };
  const setParams = (patch) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    router.push(`/kpi/labor?${p.toString()}`);
  };

  // ── Actuals filtering (worker set) ────────────────────
  const filteredActuals = useMemo(() => {
    if (!data?.actuals) return [];
    if (!selectedWorkers || selectedWorkers.size === 0) return data.actuals;
    return data.actuals.filter(r => selectedWorkers.has(r.worker_id));
  }, [data, selectedWorkers]);

  // ── weeksInRange: unique week_start values, sorted desc ──────
  // H3 fix - this is the ONE canonical week count. Hero, MetricGrid,
  // Hero, MetricGrid, budget-for-range, pace calc, coverage caption all read
  // this. Never read grouped.length as "week count" (that's period
  // count). Never read filteredActuals.length as "week count" (that's
  // worker-week rows).
  const weekAggregates = useMemo(() => {
    if (!filteredActuals?.length) return [];
    const byWeek = new Map();
    for (const r of filteredActuals) {
      const wk = r.week_start;
      if (!byWeek.has(wk)) {
        byWeek.set(wk, {
          week_start: r.week_start, week_end: r.week_end,
          week_label: r.week_label,
          // H1: derive period client-side. Payload period_no is null on
          // backfill rows; we NEVER trust it.
          fiscal_year: fiscalYearOf(r.week_start) ?? r.fiscal_year ?? 2026,
          period_no: periodOf(r.week_start),
          hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
          dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
          amount: 0, hours_without_dollars: 0,
          worker_rows: [], coverage_states: new Set(),
        });
      }
      const w = byWeek.get(wk);
      w.hours_regular       += Number(r.hours_regular       || 0);
      w.hours_overtime      += Number(r.hours_overtime      || 0);
      w.hours_double_time   += Number(r.hours_double_time   || 0);
      w.hours_premium_other += Number(r.hours_premium_other || 0);
      w.dollars_regular       += Number(r.dollars_regular       || 0);
      w.dollars_overtime      += Number(r.dollars_overtime      || 0);
      w.dollars_double_time   += Number(r.dollars_double_time   || 0);
      w.dollars_premium_other += Number(r.dollars_premium_other || 0);
      w.amount                += Number(r.amount                || 0);
      w.hours_without_dollars += Number(r.hours_without_dollars || 0);
      w.worker_rows.push(r);
      w.coverage_states.add(r.coverage_state);
    }
    for (const w of byWeek.values()) {
      const states = [...w.coverage_states];
      w.coverage_state = states.length === 1 ? states[0] : "partial";
      if ((w.coverage_state === "unknown" || w.coverage_state === "hours_only") && w.amount > 0.01) {
        console.warn(`kpi-labor: collapsed row ${w.week_start} has amount=$${w.amount.toFixed(2)}; demoting to partial`);
        w.coverage_state = "partial";
      }
    }
    // Sort desc so the newest week (P9 today) appears first.
    return [...byWeek.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
  }, [filteredActuals]);

  const weeksInRange = weekAggregates.length; // canonical week count

  const grouped = useMemo(() => {
    if (!weekAggregates.length) return [];
    // V6-5 - grouping mode implied by selection. Month selection
    // groups by calendar month (weeks belong to the month their
    // MONDAY falls in - the same rule fiscalMonthsWithWeeks uses,
    // so a week never straddles). Every other selection groups by
    // fiscal period. No standalone group-by control.
    const groupByMonth = rangeSelectionEarly?.kind === "month";
    const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
    const groups = [];
    for (const w of weekAggregates) {
      const fy = w.fiscal_year ?? 2026;
      let key, sortKey, groupLabel, groupHint;
      if (groupByMonth) {
        // Parse week_start UTC-safe (Mondays).
        const [yy, mm] = w.week_start.split("-").map(Number);
        const year = yy;
        const monthIndex = mm - 1;
        key = `M-${year}-${monthIndex}`;
        sortKey = year * 100 + monthIndex;
        groupLabel = `${MONTH_NAMES[monthIndex]} ${year}`;
        groupHint = { kind: "month", year, monthIndex };
      } else {
        const p = w.period_no ?? 0;
        key = `P-${fy}|${p}`;
        sortKey = -(fy * 100 + p);  // period desc (existing convention)
        groupHint = { kind: "period", period_no: p, fiscal_year: fy };
      }
      let g = groups.find(x => x.key === key);
      if (!g) {
        g = { key, fiscal_year: fy, period_no: w.period_no ?? 0, weeks: [], subtotal: null, groupLabel, groupHint, sortKey };
        groups.push(g);
      }
      g.weeks.push(w);
    }
    // Month mode - sort ascending (Jan first). Period mode retains
    // the descending-by-period convention D2 shipped.
    if (groupByMonth) {
      groups.sort((a, b) => a.sortKey - b.sortKey);
    } else {
      groups.sort((a, b) => a.sortKey - b.sortKey);
    }
    // Month group headers append "· N fiscal wks" per V6-5.
    if (groupByMonth) {
      for (const g of groups) {
        g.groupLabel = `${g.groupLabel} · ${g.weeks.length} fiscal wk${g.weeks.length === 1 ? "" : "s"}`;
      }
    }
    for (const g of groups) {
      const s = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0, amount: 0, hours_without_dollars: 0 };
      for (const w of g.weeks) {
        s.hours_regular       += w.hours_regular;
        s.hours_overtime      += w.hours_overtime;
        s.hours_double_time   += w.hours_double_time;
        s.hours_premium_other += w.hours_premium_other;
        s.amount              += w.amount;
        s.hours_without_dollars += w.hours_without_dollars;
      }
      g.subtotal = s;
    }
    return groups;
  }, [weekAggregates, rangeSelectionEarly]);

  const totals = useMemo(() => {
    const t = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, amount: 0, hours_without_dollars: 0 };
    for (const r of filteredActuals) {
      t.hours_regular += Number(r.hours_regular || 0);
      t.hours_overtime += Number(r.hours_overtime || 0);
      t.hours_double_time += Number(r.hours_double_time || 0);
      t.amount += Number(r.amount || 0);
      t.hours_without_dollars += Number(r.hours_without_dollars || 0);
    }
    return t;
  }, [filteredActuals]);

  const coverageCounts = useMemo(() => {
    const c = { complete: 0, partial: 0, hours_only: 0, unknown: 0, no_labor: 0 };
    for (const r of filteredActuals) c[r.coverage_state] = (c[r.coverage_state] || 0) + 1;
    return c;
  }, [filteredActuals]);

  const freshness = data?.derive_freshness;
  const freshnessH = hoursSinceISO(freshness?.last_walk_at);

  const workerRoster = useMemo(() => {
    if (!data?.actuals) return [];
    const ids = [...new Set(data.actuals.map(r => r.worker_id))];
    return ids
      .map(id => ({ id, label: workerLabel(data.workers?.[id], id, redact), meta: data.workers?.[id] }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, redact]);

  const totalWorkersInRange = data?.actuals ? new Set(data.actuals.map(r => r.worker_id)).size : 0;
  const shownWorkers = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : totalWorkersInRange;

  const grand = useMemo(() => {
    if (!grouped.length) return null;
    const g = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, amount: 0, hours_without_dollars: 0 };
    for (const period of grouped) {
      g.hours_regular       += period.subtotal.hours_regular;
      g.hours_overtime      += period.subtotal.hours_overtime;
      g.hours_double_time   += period.subtotal.hours_double_time;
      g.amount              += period.subtotal.amount;
      g.hours_without_dollars += period.subtotal.hours_without_dollars;
    }
    return g;
  }, [grouped]);

  const periodsIsAllHoursOnly = useMemo(() => {
    const set = new Set();
    for (const g of grouped) if (g.weeks.every(w => w.coverage_state === "hours_only")) set.add(g.key);
    return set;
  }, [grouped]);

  const grandLabel = grouped.length > 0
    ? `Range total (${grouped.length} period${grouped.length === 1 ? "" : "s"} with labor)`
    : "Range total";

  const isSalaried = data?.account_state === "salaried_only";

  // Auto-open current + previous period on first grouped load (v5 default:
  // §3.7). Only fires when nothing is open yet, so navigating back doesn't
  // stomp user's manual collapses.
  useEffect(() => {
    if (!grouped.length || expandedPeriods.size > 0) return;
    // Open first two groups by default. V6-5 - key varies by grouping
    // mode (period_no in period mode, month-index in month mode).
    const openKey = (g) => g?.groupHint?.kind === "month" ? g.groupHint.monthIndex : g?.period_no;
    const next = new Set();
    const k0 = openKey(grouped[0]);
    const k1 = openKey(grouped[1]);
    if (k0 != null) next.add(k0);
    if (k1 != null) next.add(k1);
    if (next.size > 0) setExpandedPeriods(next);
  }, [grouped, expandedPeriods.size]);

  // F16 - per-worker range totals for the rate-on-hover title. Cheap;
  // derived from filteredActuals which is already memo'd.
  const workerRangeTotals = useMemo(() => {
    const m = {};
    for (const r of filteredActuals) {
      const id = r.worker_id;
      if (!m[id]) m[id] = { hoursWorked: 0, dollarsTotal: 0 };
      m[id].hoursWorked += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
      m[id].dollarsTotal += Number(r.amount || 0);
    }
    return m;
  }, [filteredActuals]);

  // Current period for hero preset labels (P5). Derived client-side so
  // it holds even before /api/kpi/labor account_periods lands.
  const currentPeriodNo = useMemo(() => periodOfDate(today), [today]);

  // H3 - infer preset from (start, end, today) so hero suffix and
  // preset chip highlight even on a fresh page load (URL has no
  // preset param; user landed with FY defaults). If no preset matches
  // the resolved range, resolvedPreset is null and hero falls back to
  // "· MM/DD/YY – MM/DD/YY".
  const resolvedPreset = useMemo(() => {
    if (lastPreset) return lastPreset; // user clicked one this session
    if (start === FY_START && end === today) return "fytd";
    if (start === addDaysISO(today, -27)  && end === today) return "last_4wk";
    if (start === addDaysISO(today, -90)  && end === today) return "last_13wk";
    // this_period / last_period rely on account_periods bounds
    const periods = data?.account_periods || [];
    if (periods.length) {
      const past = periods.filter(p => p.start && p.end && p.start <= today)
        .sort((a, b) => a.start.localeCompare(b.start));
      const cur = past[past.length - 1];
      const prev = past[past.length - 2];
      if (cur && start === cur.start && end === cur.end) return "this_period";
      if (prev && start === prev.start && end === prev.end) return "last_period";
    }
    return null;
  }, [lastPreset, start, end, today, data]);

  function applyPreset(kind) {
    const t = today;
    setLastPreset(kind);
    if (kind === "last_4wk")  return setParams({ start: addDaysISO(t, -27), end: t });
    if (kind === "last_13wk") return setParams({ start: addDaysISO(t, -90), end: t });
    if (kind === "fytd")      return setParams({ start: FY_START,           end: t });
    const periods = data?.account_periods || [];
    if (!periods.length) return;
    const withStart = periods.filter(p => p.start && p.end).sort((a, b) => a.start.localeCompare(b.start));
    const past = withStart.filter(p => p.start <= t);
    if (kind === "this_period") {
      const cur = past[past.length - 1];
      if (cur) setParams({ start: cur.start, end: cur.end });
    } else if (kind === "last_period") {
      const prev = past[past.length - 2];
      if (prev) setParams({ start: prev.start, end: prev.end });
    }
  }

  // V6-3/V6-8 - RangeMenu commit path. selection: { kind, value? }
  //   preset -> setLastPreset(value); rely on inferred label
  //   period -> setLastPreset(null); the URL start/end resolves to
  //             "PERIOD n" via inferRangeSelection
  //   month  -> setLastPreset(null); resolves to "<MONTH> <year>"
  //   custom -> setLastPreset(null); no inference match -> "custom"
  // Also writes { startISO, endISO } to localStorage (kpi.range).
  function onRangeCommit(startISO, endISO, selection) {
    if (selection?.kind === "preset" && selection.value) {
      setLastPreset(selection.value);
    } else {
      setLastPreset(null);
    }
    setParams({ start: startISO, end: endISO });
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(LAST_RANGE_KEY, JSON.stringify({ startISO, endISO }));
      }
    } catch {}
    setLiveMsg("Range updated.");
  }

  // V6-7 - inferred selection consumed by the RangeMenu label + folio/
  // hero echo + V6-5 month grouping. Returns { kind: 'period'|'month',
  // value } when start/end matches; else null. Preset key is separately
  // tracked via resolvedPreset. Also used above in the grouped memo.
  // (See earlier declaration of rangeSelectionEarly for the grouped
  // dependency; this line is intentionally a re-export for readers.)
  const selectedPeriodNo = rangeSelectionEarly?.kind === "period" ? rangeSelectionEarly.value : null;
  const selectedMonth    = rangeSelectionEarly?.kind === "month"  ? rangeSelectionEarly.value : null;
  const rangeSelection = rangeSelectionEarly;

  function exportHref() {
    const p = new URLSearchParams({ account, start, end });
    if (selectedWorkers && selectedWorkers.size > 0) p.set("workers", [...selectedWorkers].join(","));
    if (redact) p.set("redact", "1");
    if (activeView && !isDirty) {
      p.set("view_name", activeView.name);
      p.set("view_date_mode", activeView.date_mode);
    }
    return `/api/kpi/labor/export?${p.toString()}`;
  }

  // ── Saved-view actions ───────────────────────────────
  const serializeCurrent = () => {
    // Build the "intent" payload for save-as-new / update. If the user
    // arrived at the current dates via a preset AND the resolved range
    // still matches, save as preset; otherwise save as absolute.
    const periods = data?.account_periods || [];
    let mode = "absolute";
    let preset = null;
    if (lastPreset) {
      const resolved = (function () {
        // Duplicate of resolvePreset logic here to avoid circular
        // dependency; kept small enough to be obvious.
        if (lastPreset === "last_4wk")  return { start: addDaysISO(today, -27), end: today };
        if (lastPreset === "last_13wk") return { start: addDaysISO(today, -90), end: today };
        if (lastPreset === "fytd")      return { start: FY_START,               end: today };
        const past = periods.filter(p => p.start && p.end).sort((a, b) => a.start.localeCompare(b.start))
          .filter(p => p.start <= today);
        if (!past.length) return null;
        return lastPreset === "this_period" ? past[past.length - 1]
             : lastPreset === "last_period" ? past[past.length - 2] || null
             : null;
      })();
      if (resolved && resolved.start === start && resolved.end === end) {
        mode = "preset"; preset = lastPreset;
      }
    }
    return {
      account_key: account,
      tab: "labor",
      date_mode: mode,
      date_preset: mode === "preset" ? preset : null,
      date_from:   mode === "absolute" ? start : null,
      date_to:     mode === "absolute" ? end   : null,
      worker_ids:  selectedWorkers && selectedWorkers.size > 0 ? [...selectedWorkers] : null,
      redact,
      is_shared: false,
    };
  };

  async function createView(name, is_shared) {
    setSavingView(true); setViewError(null);
    const body = { ...serializeCurrent(), name, is_shared: !!is_shared };
    try {
      const r = await fetch("/api/kpi/labor/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail?.join?.(", ") || j.error || `HTTP ${r.status}`);
      await refetchViews();
      // Navigate to the new view
      const p = new URLSearchParams(searchParams.toString());
      p.set("view", String(j.view.id));
      router.push(`/kpi/labor?${p.toString()}`);
      // M2: save success toast (spec §7 "auto-hide 6s").
      setToast({ message: `Saved view "${name}".`, tone: "info", durationMs: 6000 });
      setLiveMsg(`Saved view ${name}.`);
    } catch (e) {
      setViewError(String(e.message || e).slice(0, 200));
    }
    setSavingView(false);
  }

  async function updateActiveView() {
    if (!activeView || !activeView.is_owner) return;
    setSavingView(true); setViewError(null);
    const body = { ...serializeCurrent() };
    // name stays the same on Update
    delete body.account_key; // account cannot be changed on a view
    delete body.tab;
    // B7 optimistic concurrency: pass the timestamp we opened with so
    // the server can 409 if someone else edited between.
    if (activeView.updated_at) body.expected_updated_at = activeView.updated_at;
    try {
      const r = await fetch(`/api/kpi/labor/views/${activeView.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) {
        setViewError(j.error || "This view changed since you opened it - reload to see the current version, or save yours as new.");
        setSavingView(false);
        return;
      }
      if (!r.ok) throw new Error(j.detail?.join?.(", ") || j.error || `HTTP ${r.status}`);
      await refetchViews();
      setToast({ message: `Saved ${activeView.name}.`, tone: "info", durationMs: 4000 });
      setLiveMsg(`Saved view ${activeView.name}.`);
    } catch (e) {
      setViewError(String(e.message || e).slice(0, 200));
    }
    setSavingView(false);
  }

  // B1: delete a saved view with 6s undo. The DELETE is idempotent - if
  // undo fires we POST the same shape back. During the undo window the
  // view is removed from the local list so it disappears immediately.
  async function deleteView(view) {
    setSavingView(true); setViewError(null);
    // Snapshot for undo
    const snapshot = {
      name: view.name,
      account_key: view.account_key,
      tab: view.tab,
      date_mode: view.date_mode,
      date_preset: view.date_preset,
      date_from: view.date_from,
      date_to: view.date_to,
      worker_ids: view.worker_ids,
      redact: view.redact,
      is_shared: view.is_shared,
    };
    try {
      const r = await fetch(`/api/kpi/labor/views/${view.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      // If it was the active view, drop it from the URL
      if (activeView?.id === view.id) {
        const p = new URLSearchParams(searchParams.toString());
        p.delete("view");
        router.push(`/kpi/labor?${p.toString()}`);
      }
      await refetchViews();
      setConfirmDelete(null);
      // B1 undo window
      setPendingUndo(snapshot);
      setToast({
        message: `Deleted "${view.name}".`,
        tone: "info",
        durationMs: 6000,
        actions: [{
          label: "Undo",
          emphasis: "primary",
          onClick: async () => {
            try {
              await fetch("/api/kpi/labor/views", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(snapshot),
              });
              await refetchViews();
              setLiveMsg(`Restored view ${view.name}.`);
            } catch {}
            setPendingUndo(null);
          },
        }],
      });
      setLiveMsg(`Deleted view ${view.name}. Undo available for 6 seconds.`);
    } catch (e) {
      setViewError(String(e.message || e).slice(0, 200));
    }
    setSavingView(false);
  }

  async function renameView(view, newName, newShared) {
    setSavingView(true); setViewError(null);
    try {
      const r = await fetch(`/api/kpi/labor/views/${view.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName, is_shared: newShared }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      await refetchViews();
      setEditDialog(null);
    } catch (e) {
      setViewError(String(e.message || e).slice(0, 200));
    }
    setSavingView(false);
  }

  // ── Auth screens (P9 · nine states 1-3) ─────────────
  if (status === "loading") {
    return (<div className="kpi-app"><div className="kpi-wrap"><StateLoading /></div></div>);
  }
  if (status === "unauthenticated") {
    return (<div className="kpi-app"><div className="kpi-wrap"><StateSessionExpired /></div></div>);
  }
  if (!isAllowed) {
    return (<div className="kpi-app"><div className="kpi-wrap"><StateNotAuthorized /></div></div>);
  }

  const hasData = !isSalaried && loadState === "ok" && (data?.actuals?.length || 0) > 0;

  // Extract account list from data for the folio (D3 will replace with
  // server aggregate). For D2 the roster is the ACCOUNTS constant.
  // B10: announce switch + focus-to-hero for keyboard users.
  const onPickAccount = (a) => {
    setParams({ account: a, workers: "", view: "" });
    setLiveMsg(`Switched to ${a}.`);
    // Let the render complete before we grab focus.
    setTimeout(focusHero, 60);
  };

  const workersOnChangeSet = (nextSet) => {
    if (nextSet == null) return setParam("workers", "");
    if (nextSet.size === 0) return setParam("workers", "__none__");
    if (nextSet.size === workerRoster.length) return setParam("workers", "");
    setParam("workers", [...nextSet].join(","));
  };

  const vdefLine = buildVdefLine({
    start, end,
    resolvedActiveRange, activeView,
    workerRoster, selectedWorkers, redact,
  });

  // V6-1 fiscal context - TODAY (MM/DD), PERIOD n (from account_periods
  // when present, else client-derived via periodOf), WEEK w where w is
  // week-of-period (1..4) via periods.js weekOfPeriod().
  const fiscalCtx = (() => {
    const past = (data?.account_periods || [])
      .filter(p => p.start && p.end)
      .sort((a, b) => a.start.localeCompare(b.start))
      .filter(p => p.start <= today);
    const cur = past[past.length - 1];
    return {
      today: today.slice(5).replace("-", "/"),
      period: cur?.period_no ?? periodOfDate(today),
      week: weekOfPeriod(today),
    };
  })();

  // ── Middle content (Hero · MetricGrid · Trend · Table + 9 states) ──
  const mainContent = (
    <>
      {/* C5.5 name-availability banner. */}
      {!isSalaried && loadState === "ok" && data?.name_availability && data.name_availability.total > 0 && data.name_availability.resolved < data.name_availability.total && (
        <div className="kpi-note-info" role="status">
          {data.name_availability.resolved === 0
            ? data.name_availability.reason === "users_table_empty_or_unreachable"
              ? <>Names unavailable: the users walk has not populated <code>rippling_raw_users</code> for the {data.name_availability.total} workers in scope. Falling back to numbers and titles. This resolves on the next successful users walk.</>
              : <>Names unavailable: none of the {data.name_availability.total} workers in scope have a canonical name field. Falling back to numbers and titles.</>
            : <>{data.name_availability.total - data.name_availability.resolved} of {data.name_availability.total} workers do not resolve to a canonical name and render as numbers.</>}
        </div>
      )}

      {!isSalaried && loadState === "ok" && (data?.actuals?.length || 0) > 0 && (
        <>
          <div ref={heroRef} tabIndex={-1} style={{ outline: "none" }}>
            <Hero
              account={account}
              totals={totals}
              weekCount={weeksInRange}
              workerWeekCount={filteredActuals.length}
              lastPreset={resolvedPreset}
              start={start}
              end={end}
              today={today}
              currentPeriodNo={currentPeriodNo}
              budgetPeriods={data.budget_periods || []}
              budgetMode={data.budget_mode || "static"}
            />
          </div>
          <MetricGrid
            account={account}
            totals={totals}
            weekCount={weeksInRange}
            lastPreset={resolvedPreset}
            start={start}
            end={end}
            today={today}
            currentPeriodNo={currentPeriodNo}
            budgetPeriods={data.budget_periods || []}
            budgetMode={data.budget_mode || "static"}
          />
          <TrendChart
            account={account}
            weeks={weekAggregates}
            openWeeks={expandedWeeks}
            budgetPeriods={data.budget_periods || []}
            budgetMode={data.budget_mode || "static"}
            onBarClick={(wk) => {
              // M7 jump: open week + its period
              const g = grouped.find(gg => gg.weeks.some(w => w.week_start === wk));
              if (g && g.period_no != null) setExpandedPeriods(prev => new Set([...prev, g.period_no]));
              setExpandedWeeks(prev => new Set([...prev, wk]));
              setTimeout(() => {
                const el = document.querySelector(`[data-wk="${wk}"]`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  const tr = el.closest("tr");
                  if (tr) {
                    tr.classList.add("kpi-landed");
                    setTimeout(() => tr.classList.remove("kpi-landed"), 400);
                  }
                }
              }, 80);
            }}
          />
        </>
      )}

      {loadState === "auth" && authError === "expired" ? (
        <StateSessionExpired />
      ) : loadState === "auth" && authError === "forbidden" ? (
        <StateNotAuthorized />
      ) : loadState === "ok" && data.account_state === "salaried_only" ? (
        <StateSalaried account={account} message={data.account_state_message} />
      ) : loadState === "loading" ? (
        <StateLoading />
      ) : loadState === "error" ? (
        <StateError
          code={errCode}
          category={errorMsg}
          onRetry={() => setParam("_r", Date.now())}
        />
      ) : loadState === "ok" && !filteredActuals.length ? (
        // Fix 4 (D2.1) - three-way branch per spec 3.9 + v5 line ~1052:
        //   worker filter active   -> StateEmptyFiltered
        //   pipeline never derived -> StateEmptyFirstRun (keyed off
        //                             derive_freshness.last_derive_at,
        //                             not row count - the range being
        //                             empty is a filter, not a pipeline
        //                             failure)
        //   otherwise              -> StateEmptyRange (the date range
        //                             is a filter; one-tap Use FYTD)
        selectedWorkers && selectedWorkers.size > 0 ? (
          <StateEmptyFiltered
            workerCount={selectedWorkers.size}
            onClear={() => { setParam("workers", ""); setLiveMsg("Worker filter cleared."); setTimeout(focusHero, 60); }}
          />
        ) : !data?.derive_freshness?.last_derive_at ? (
          <StateEmptyFirstRun />
        ) : (
          <StateEmptyRange
            onUseFYTD={() => {
              applyPreset("fytd");
              setLiveMsg("Range set to fiscal year to date.");
              setTimeout(focusHero, 60);
            }}
          />
        )
      ) : loadState === "ok" && filteredActuals.length ? (
        <WeekTable
          account={account}
          grouped={grouped}
          grandTotal={grand}
          workers={data.workers}
          redact={redact}
          onToggleRedact={(next) => {
            setParam("redact", next ? "1" : "");
            setLiveMsg(next ? "Names hidden on screen and in export." : "Names shown.");
          }}
          expandedPeriods={expandedPeriods}
          onTogglePeriod={(p) => {
            setExpandedPeriods(prev => {
              const next = new Set(prev);
              if (next.has(p)) next.delete(p); else next.add(p);
              return next;
            });
          }}
          expandedWeeks={expandedWeeks}
          onToggleWeek={(w) => {
            setExpandedWeeks(prev => {
              const next = new Set(prev);
              if (next.has(w)) next.delete(w); else next.add(w);
              return next;
            });
          }}
          onExpandAll={() => {
            // V6-5 - key varies by grouping mode: period_no in period
            // mode, month-index in month mode. Both live in the same
            // expandedPeriods Set; grouping-mode alignment is enforced
            // upstream by the group's openKey computation.
            const all = new Set(grouped.map(g => g.groupHint?.kind === "month" ? g.groupHint.monthIndex : g.period_no));
            setExpandedPeriods(all);
          }}
          onCollapseAll={() => {
            setExpandedPeriods(new Set());
            setExpandedWeeks(new Set());
          }}
          onJumpPeriod={(p) => {
            setExpandedPeriods(prev => new Set([...prev, p]));
            setTimeout(() => {
              // Try period anchor first, then month anchor.
              const el = document.getElementById(`kpi-per${p}`) || document.getElementById(`kpi-permo${p}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }}
          onEscape={() => setExpandedWeeks(new Set())}
          todayISO={today}
          workerRangeTotals={workerRangeTotals}
        />
      ) : null}
      {/* V6-5 - one-line grouping note beneath the table, states
          active grouping and that it follows the selection. */}
      {loadState === "ok" && filteredActuals.length > 0 && (
        <div className="kpi-table-note">
          {rangeSelectionEarly?.kind === "month"
            ? "Grouping: calendar months (implied by the selection)."
            : "Grouping: fiscal periods. Select a month in the Range menu to group by calendar month."}
        </div>
      )}
    </>
  );

  // ── Right rail content ──
  // ContextRail: alarms (empty when healthy) · coverage (merged
  // legend + worker-weeks unit note) · OT watch · Pipeline ▸ disclosure.
  const railStack = tab === "labor" && loadState === "ok" && data?.account_state !== "salaried_only" ? (
    <ContextRail
      filteredActuals={filteredActuals}
      totals={totals}
      coverageCounts={coverageCounts}
      freshness={freshness}
      freshnessHours={freshnessH}
      data={data}
      workers={data?.workers}
      workerRangeTotals={workerRangeTotals}
      redact={redact}
    />
  ) : null;

  return (
    <div className="kpi-app" data-density={isCompact ? "compact" : undefined}>
      <div className="kpi-wrap">
        <Shell
          account={account}
          fiscal={fiscalCtx}
          freshness={freshness}
          dataLoading={loadState === "loading" || loadState === "idle"}
          activeTab={tab}
          onTabClick={(k) => setParam("tab", k)}
          printScopeText={vdefLine}
          onCopyLink={() => setLiveMsg("Copied link to this exact view to clipboard.")}
          exportHref={loadState === "ok" && data?.account_state !== "salaried_only" ? exportHref() : null}
          onExport={() => {
            setToast({
              message: redact ? "Export ready · names redacted." : "Export ready.",
              tone: "info",
              durationMs: 4000,
            });
            setLiveMsg(redact ? "Export downloading with names redacted." : "Export downloading.");
          }}
          exportRedact={redact}
          folioRail={
            <FolioRail
              activeAccount={account}
              onPickAccount={onPickAccount}
              accountsDirectory={data?.accounts_directory}
              regionalDirectorsDisplay={data?.regional_directors_display}
            />
          }
          scopeBand={
            // Fix 4 (D2.1) - band persists through empty and error
            // states so the user can widen dates / clear filters / pick
            // a view without dead-ending. Salaried gate unchanged.
            !isSalaried && loadState === "ok" ? (
              <ScopeBand
                start={start}
                end={end}
                today={today}
                resolvedPreset={resolvedPreset}
                selectedPeriodNo={selectedPeriodNo}
                selectedMonth={selectedMonth}
                hasPeriods={!!data?.account_periods?.length}
                accountPeriods={data?.account_periods || []}
                onRangeCommit={onRangeCommit}
                workerRoster={workerRoster}
                selectedWorkers={selectedWorkers}
                onWorkersChange={workersOnChangeSet}
                views={views}
                activeView={activeView}
                onPickView={(id) => setParams({ view: id ? String(id) : "", start: "", end: "", workers: "", redact: "" })}
                onSaveView={() => setSaveDialog({ mode: "new", initialName: "" })}
                vdefLine={vdefLine}
              />
            ) : null
          }
          main={
            tab === "overview" ? (
              <div className="kpi-state">
                <div className="kpi-state-title">Overview</div>
                <div className="kpi-state-desc">Overview design is an open ruling (spec §13.4). Placeholder for now.</div>
              </div>
            ) : tab === "labor" ? mainContent : (
              <div className="kpi-state"><div className="kpi-state-title">Section coming soon</div></div>
            )
          }
          rail={
            <>
              {/* V6-13 - rail-top panel retired. Copy/Export moved to
                  the command bar (Shell); the In-view counts row
                  lives inside ContextRail's PAYROLL DATA CHECK card
                  (C3). */}
              {railStack}
              {activeView && isDirty && (
                <div className="kpi-view-active">
                  <span className="kpi-view-active-name">{activeView.name}</span>
                  <span className="kpi-view-dirty-actions">
                    <span className="kpi-view-dirty-tag">unsaved</span>
                    {activeView.is_owner && (
                      <button type="button" className="kpi-btn-secondary" onClick={updateActiveView} disabled={savingView}>Update</button>
                    )}
                    <button type="button" className="kpi-btn-secondary" onClick={() => setSaveDialog({ mode: "new", initialName: `${activeView.name} (copy)` })} disabled={savingView}>Save as new</button>
                  </span>
                  {activeView.is_owner && (
                    <>
                      <button type="button" className="kpi-view-linkbtn" onClick={() => setEditDialog(activeView)}>Edit</button>
                      <button type="button" className="kpi-view-linkbtn kpi-view-linkbtn-danger" onClick={() => setConfirmDelete(activeView)}>Delete</button>
                    </>
                  )}
                </div>
              )}
            </>
          }
        />

      </div>

      {/* ── Save view dialog ─────────────────────────────── */}
      {saveDialog && (
        <SaveViewDialog
          initialName={saveDialog.initialName}
          existingNames={new Set(views.filter(v => v.is_owner).map(v => v.name))}
          onCancel={() => setSaveDialog(null)}
          saving={savingView}
          onSave={async (name, shared) => {
            await createView(name, shared);
            setSaveDialog(null);
          }}
        />
      )}
      {/* ── Edit view dialog (rename + share toggle) ────── */}
      {editDialog && (
        <EditViewDialog
          view={editDialog}
          existingNames={new Set(views.filter(v => v.is_owner && v.id !== editDialog.id).map(v => v.name))}
          onCancel={() => setEditDialog(null)}
          saving={savingView}
          onSave={async (name, shared) => {
            await renameView(editDialog, name, shared);
          }}
        />
      )}
      {/* ── Confirm delete ───────────────────────────────── */}
      {/* B1: the confirm shows anyway but the actual delete flow raises
          an undo toast for 6s. */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete saved view?"
          message={<>Delete <strong>{confirmDelete.name}</strong>? You can undo for 6 seconds.</>}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteView(confirmDelete)}
          danger
          disabled={savingView}
        />
      )}

      {/* ── B10 live region · always mounted, silent when empty ── */}
      <div aria-live="polite" aria-atomic="true" className="kpi-sr-live">{liveMsg}</div>

      {/* ── P10/P11 toast host (M2 save, M4 export, B1 undo) ─── */}
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// ── Dialog components (kept in-file - one-off UI, no reuse elsewhere) ──

function SaveViewDialog({ initialName, existingNames, onSave, onCancel, saving }) {
  const [name, setName] = useState(initialName || "");
  const [shared, setShared] = useState(false);
  const err = name.trim().length < 1 ? "Name required"
            : name.trim().length > 80 ? "Name too long (80 chars max)"
            : existingNames.has(name.trim()) ? "You already have a view with that name"
            : null;
  return (
    <div className="kpi-modal-scrim" onClick={onCancel}>
      <div className="kpi-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="kpi-save-title">
        <h2 id="kpi-save-title" className="kpi-modal-title">Save view</h2>
        <label className="kpi-modal-label">
          Name
          <input
            type="text" className="kpi-modal-input"
            value={name} onChange={(e) => setName(e.target.value)}
            autoFocus maxLength={80}
            placeholder="e.g. Joe's monthly"
          />
        </label>
        <label className="kpi-modal-check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <span>Share with the leadership team (read-only for others)</span>
        </label>
        {err && <div className="kpi-modal-err">{err}</div>}
        <div className="kpi-modal-actions">
          <button type="button" className="kpi-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="kpi-btn-primary" disabled={!!err || saving} onClick={() => onSave(name.trim(), shared)}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditViewDialog({ view, existingNames, onSave, onCancel, saving }) {
  const [name, setName] = useState(view.name);
  const [shared, setShared] = useState(!!view.is_shared);
  const err = name.trim().length < 1 ? "Name required"
            : name.trim().length > 80 ? "Name too long (80 chars max)"
            : existingNames.has(name.trim()) ? "Another view has that name"
            : null;
  return (
    <div className="kpi-modal-scrim" onClick={onCancel}>
      <div className="kpi-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="kpi-edit-title">
        <h2 id="kpi-edit-title" className="kpi-modal-title">Edit view</h2>
        <label className="kpi-modal-label">
          Name
          <input type="text" className="kpi-modal-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="kpi-modal-check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <span>Share with the leadership team</span>
        </label>
        {err && <div className="kpi-modal-err">{err}</div>}
        <div className="kpi-modal-actions">
          <button type="button" className="kpi-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="kpi-btn-primary" disabled={!!err || saving} onClick={() => onSave(name.trim(), shared)}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, danger, disabled }) {
  return (
    <div className="kpi-modal-scrim" onClick={onCancel}>
      <div className="kpi-modal" onClick={(e) => e.stopPropagation()} role="alertdialog">
        <h2 className="kpi-modal-title">{title}</h2>
        <div className="kpi-modal-msg">{message}</div>
        <div className="kpi-modal-actions">
          <button type="button" className="kpi-btn-secondary" onClick={onCancel} disabled={disabled}>Cancel</button>
          <button
            type="button"
            className={danger ? "kpi-btn-danger" : "kpi-btn-primary"}
            onClick={onConfirm}
            disabled={disabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
