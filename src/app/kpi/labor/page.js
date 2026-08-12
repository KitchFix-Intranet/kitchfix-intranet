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

import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { PRESET_LABELS, resolveViewDates, addDaysISO } from "@/lib/kpi/dateResolve";
import { DOLLAR_COVERAGE_FLOOR } from "@/lib/kpi/floors";
import { fmt$, fmtHrs, fmtDate, hoursSinceISO, fmtTimestamp, freshnessTint } from "./lib/formatting";
import { ACCOUNTS, TABS, PRESET_KEYS, FY_START, SALARIED_ONLY } from "./lib/accounts";
import { Shell } from "./components/Shell";
import { FolioRail } from "./components/FolioRail";
import { ScopeBand, buildVdefLine } from "./components/ScopeBand";
import { QuickPanel } from "./components/QuickPanel";
import { Hero } from "./components/Hero";
import { MetricGrid } from "./components/MetricGrid";
import { TrendChart } from "./components/TrendChart";
import { WeekTable } from "./components/WeekTable";
import "../kpi.css";

function CellHours({ v, coverage_state, forceEmpty = false }) {
  if (coverage_state === "unknown") return <span aria-label="unknown">?</span>;
  if (forceEmpty || v == null) return <span aria-label="not applicable">—</span>;
  return <span className="kpi-num">{fmtHrs(v)}</span>;
}
function CellDollars({ v, coverage_state, forceEmpty = false }) {
  if (coverage_state === "unknown") return <span aria-label="unknown">?</span>;
  if (forceEmpty || v == null) return <span aria-label="not applicable">—</span>;
  return <span className="kpi-num">{fmt$(v)}</span>;
}
function CoverageBadge({ state }) {
  const cfg = {
    complete:   { label: "Complete",   cls: "kpi-badge-complete",   symbol: "✓" },
    partial:    { label: "Partial",    cls: "kpi-badge-partial",    symbol: "!" },
    hours_only: { label: "Unpriced", cls: "kpi-badge-hours-only", symbol: "◷" },
    unknown:    { label: "Unknown",    cls: "kpi-badge-unknown",    symbol: "?" },
    no_labor:   { label: "No labor",   cls: "kpi-badge-no-labor",   symbol: "—" },
  }[state] || { label: state, cls: "kpi-badge-no-labor", symbol: "?" };
  return (
    <span className={`kpi-badge ${cfg.cls}`} aria-label={`Coverage: ${cfg.label}`}>
      <span aria-hidden="true">{cfg.symbol}</span> {cfg.label}
    </span>
  );
}

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

  const account = searchParams.get("account") || "CIN - OH";
  const tab = searchParams.get("tab") || "labor";
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
  const viewIdParam = searchParams.get("view");
  const activeViewId = viewIdParam ? parseInt(viewIdParam, 10) : null;
  // Track how the current dates were arrived at (last preset click).
  // Used when serializing "save as new / update" to preserve preset
  // intent instead of freezing a resolved range.
  const [lastPreset, setLastPreset] = useState(null);

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);
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
  useEffect(() => {
    if (status !== "authenticated" || !isAllowed) return;
    let cancelled = false;
    setLoadState("loading");
    setErrorMsg(null);
    const params = new URLSearchParams({ account, start, end });
    fetch(`/api/kpi/labor?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => { if (!cancelled) { setData(d); setLoadState("ok"); } })
      .catch((e) => { if (!cancelled) { setLoadState("error"); setErrorMsg(String(e.message || e).slice(0, 200)); } });
    return () => { cancelled = true; };
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

  const grouped = useMemo(() => {
    if (!filteredActuals?.length) return [];
    const byWeek = new Map();
    for (const r of filteredActuals) {
      const wk = r.week_start;
      if (!byWeek.has(wk)) {
        byWeek.set(wk, {
          week_start: r.week_start, week_end: r.week_end,
          week_label: r.week_label, fiscal_year: r.fiscal_year, period_no: r.period_no,
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
    const sortedWeeks = [...byWeek.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
    const groups = [];
    for (const w of sortedWeeks) {
      const key = `${w.fiscal_year || "?"}|${w.period_no || "?"}`;
      let g = groups.find(x => x.key === key);
      if (!g) { g = { key, fiscal_year: w.fiscal_year, period_no: w.period_no, weeks: [], subtotal: null }; groups.push(g); }
      g.weeks.push(w);
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
  }, [filteredActuals]);

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
    const periods = grouped.map(g => g.period_no).filter(p => p != null);
    const next = new Set();
    if (periods[0] != null) next.add(periods[0]);
    if (periods[1] != null) next.add(periods[1]);
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

  // Current period for hero preset labels (P5).
  const currentPeriodNo = useMemo(() => {
    if (!data?.account_periods?.length) return null;
    const past = data.account_periods
      .filter(p => p.start && p.end && p.start <= today)
      .sort((a, b) => a.start.localeCompare(b.start));
    return past.length > 0 ? past[past.length - 1].period_no : null;
  }, [data, today]);

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
    try {
      const r = await fetch(`/api/kpi/labor/views/${activeView.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail?.join?.(", ") || j.error || `HTTP ${r.status}`);
      await refetchViews();
    } catch (e) {
      setViewError(String(e.message || e).slice(0, 200));
    }
    setSavingView(false);
  }

  async function deleteView(view) {
    setSavingView(true); setViewError(null);
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

  // ── Auth screens ────────────────────────────────────
  if (status === "loading") {
    return (<div className="kpi-app"><div className="kpi-wrap"><div className="kpi-state"><div className="kpi-state-title">Loading...</div></div></div></div>);
  }
  if (status === "unauthenticated") {
    return (<div className="kpi-app"><div className="kpi-wrap"><div className="kpi-state"><div className="kpi-state-title">Sign in required</div><div className="kpi-state-desc">The KPI Dashboard requires an active session.</div></div></div></div>);
  }
  if (!isAllowed) {
    return (
      <div className="kpi-app"><div className="kpi-wrap">
        <div className="kpi-coming">
          <div className="kpi-coming-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6M9 13h6M9 17h4" />
            </svg>
          </div>
          <h1 className="kpi-coming-title">KPI Dashboard</h1>
          <p className="kpi-coming-desc">A per-account financial dashboard is in development. Check back soon.</p>
        </div>
      </div></div>
    );
  }

  const hasData = !isSalaried && loadState === "ok" && (data?.actuals?.length || 0) > 0;

  // Extract account list from data for the folio (D3 will replace with
  // server aggregate). For D2 the roster is the ACCOUNTS constant.
  const onPickAccount = (a) => setParams({ account: a, workers: "", view: "" });

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

  // Today's fiscal context - lightweight from data.
  const fiscalCtx = data?.account_periods?.length
    ? (() => {
        const past = data.account_periods
          .filter(p => p.start && p.end)
          .sort((a, b) => a.start.localeCompare(b.start))
          .filter(p => p.start <= today);
        const cur = past[past.length - 1];
        return { today: today.slice(5).replace("-", "/"), period: cur?.period_no, week: null };
      })()
    : { today: today.slice(5).replace("-", "/"), period: null, week: null };

  // ── Middle content (metrics + table + state screens) ──
  // Push 2 replaces this whole block with Hero + 8-card grid + Trend +
  // rebuilt table with inline drill. Keeping the C1-C6 render for now
  // so Push 1 ships a working checkpoint.
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
          <Hero
            account={account}
            totals={totals}
            weekCount={grouped.length}
            workerWeekCount={filteredActuals.length}
            lastPreset={lastPreset}
            start={start}
            end={end}
            today={today}
            currentPeriodNo={currentPeriodNo}
          />
          <MetricGrid
            account={account}
            totals={totals}
            weekCount={grouped.length}
            lastPreset={lastPreset}
            start={start}
            end={end}
            today={today}
            currentPeriodNo={currentPeriodNo}
          />
          <TrendChart
            account={account}
            weeks={filteredActuals}
            openWeeks={expandedWeeks}
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

      {loadState === "ok" && data.account_state === "salaried_only" ? (
        <div className="kpi-state">
          <div className="kpi-state-title">Salaried-only account</div>
          <div className="kpi-state-desc">{data.account_state_message}</div>
        </div>
      ) : loadState === "loading" ? (
        <div className="kpi-state"><div className="kpi-state-title">Loading labor data...</div></div>
      ) : loadState === "error" ? (
        <div className="kpi-state">
          <div className="kpi-state-title">Could not load labor data</div>
          <div className="kpi-state-desc">Nothing changed. Category: {errorMsg}</div>
          <button className="kpi-state-cta" onClick={() => setParam("_r", Date.now())}>Retry</button>
        </div>
      ) : !filteredActuals.length ? (
        <div className="kpi-state">
          <div className="kpi-state-title">No labor rows in range</div>
          <div className="kpi-state-desc">
            {selectedWorkers && selectedWorkers.size > 0
              ? `Selected workers have no rows in the current range. Try clearing the worker filter or widening the dates.`
              : `${account} has no labor_actuals rows between ${start} and ${end}.`}
          </div>
        </div>
      ) : (
        <WeekTable
          account={account}
          grouped={grouped}
          grandTotal={grand}
          workers={data.workers}
          redact={redact}
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
            const all = new Set(grouped.map(g => g.period_no).filter(p => p != null));
            setExpandedPeriods(all);
          }}
          onCollapseAll={() => {
            setExpandedPeriods(new Set());
            setExpandedWeeks(new Set());
          }}
          onJumpPeriod={(p) => {
            setExpandedPeriods(prev => new Set([...prev, p]));
            setTimeout(() => {
              const el = document.getElementById(`kpi-per${p}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }}
          onEscape={() => setExpandedWeeks(new Set())}
          todayISO={today}
          workerRangeTotals={workerRangeTotals}
        />
      )}
    </>
  );

  // ── Right rail content (below QuickPanel) ──
  // Existing alarms / coverage / pipeline. Push 3 refines and adds OT
  // watch. QuickPanel sits at the top of the rail (rendered inline via
  // Shell's rail prop).
  const railBelowQuickPanel = tab === "labor" && loadState === "ok" && data.account_state !== "salaried_only" ? (
    <>
      <div className="kpi-rail-card">
        <div className="kpi-rail-title">Range total</div>
        <div className="kpi-rail-big">{fmt$(totals.amount)}</div>
        <div className="kpi-rail-sub">
          {account} · {filteredActuals.length} worker-weeks
          {selectedWorkers && selectedWorkers.size > 0 && totalWorkersInRange > 0 && (
            <span> · {shownWorkers} of {totalWorkersInRange} workers</span>
          )}
        </div>
      </div>
      <div className="kpi-rail-card">
        <div className="kpi-rail-title">Alarms</div>
        <div className={`kpi-alarm ${freshnessH != null && freshnessH < 30 ? "kpi-alarm-ok" : freshnessH != null && freshnessH < 54 ? "kpi-alarm-warning" : "kpi-alarm-danger"}`}>
          <div className="kpi-alarm-title">Data freshness</div>
          <div className="kpi-alarm-desc">
            {freshnessH != null ? `${freshnessH.toFixed(1)}h since last successful pay-segments walk` : "no successful walk on record"}
          </div>
        </div>
        {coverageCounts.unknown > 0 && (
          <div className="kpi-alarm kpi-alarm-danger">
            <div className="kpi-alarm-title">Unknown weeks</div>
            <div className="kpi-alarm-desc">{coverageCounts.unknown} rows in the unknown state (presence stale)</div>
          </div>
        )}
        {totals.hours_without_dollars > 0 && (
          <div className="kpi-alarm kpi-alarm-warning">
            <div className="kpi-alarm-title">Unpriced hours</div>
            <div className="kpi-alarm-desc">{fmtHrs(totals.hours_without_dollars)} hrs known but no pay-segment coverage</div>
          </div>
        )}
      </div>
      <div className="kpi-rail-card">
        <div className="kpi-rail-title">Pipeline health</div>
        {data.unmapped_names?.length > 0 && (
          <div className="kpi-alarm kpi-alarm-warning">
            <div className="kpi-alarm-title">Unmapped earning types: {data.unmapped_names.length}</div>
            <div className="kpi-alarm-desc">D37 signal - inspect earning_type_unmapped.</div>
          </div>
        )}
        {(data.unattributed?.length || 0) > 0 && (
          <div className="kpi-alarm kpi-alarm-warning">
            <div className="kpi-alarm-title">Unattributed groups: {data.unattributed.length}</div>
            <div className="kpi-alarm-desc">Portfolio-wide segments with no account attribution (N5).</div>
          </div>
        )}
        {!data.unmapped_names?.length && !data.unattributed?.length && (
          <div className="kpi-alarm kpi-alarm-ok">
            <div className="kpi-alarm-title">All clear</div>
            <div className="kpi-alarm-desc">Zero unmapped earning types, zero unattributed groups.</div>
          </div>
        )}
      </div>
      <div className="kpi-rail-card">
        <div className="kpi-rail-title">Coverage (worker-weeks in range)</div>
        <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.complete}</span><CoverageBadge state="complete" /><span className="kpi-cov-desc">every entry has dollars</span></div>
        <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.partial}</span><CoverageBadge state="partial" /><span className="kpi-cov-desc">some entries lack dollars</span></div>
        <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.hours_only}</span><CoverageBadge state="hours_only" /><span className="kpi-cov-desc">before 2026-04-20 floor (D35)</span></div>
        <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.unknown}</span><CoverageBadge state="unknown" /><span className="kpi-cov-desc">no successful presence walk</span></div>
        <div className="kpi-cov-note">Counts are labor_actuals rows (worker-weeks), not aggregated table rows on screen.</div>
      </div>
    </>
  ) : null;

  return (
    <div className="kpi-app" data-density={isCompact ? "compact" : undefined}>
      <div className="kpi-wrap">
        <Shell
          account={account}
          fiscal={fiscalCtx}
          freshness={freshness}
          activeTab={tab}
          onTabClick={(k) => setParam("tab", k)}
          folioRail={<FolioRail activeAccount={account} onPickAccount={onPickAccount} />}
          scopeBand={
            !isSalaried && loadState === "ok" && (data?.actuals?.length || 0) > 0 ? (
              <ScopeBand
                start={start}
                end={end}
                lastPreset={lastPreset}
                onDateChange={(which, iso) => { setLastPreset(null); setParam(which, iso); }}
                onPresetClick={applyPreset}
                hasPeriods={!!data?.account_periods?.length}
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
              {tab === "labor" && loadState === "ok" && data.account_state !== "salaried_only" && (
                <QuickPanel
                  weekCount={grouped.length}
                  workerWeekCount={filteredActuals.length}
                  redact={redact}
                  onToggleRedact={(next) => setParam("redact", next ? "1" : "")}
                  exportHref={exportHref()}
                />
              )}
              {railBelowQuickPanel}
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
      {confirmDelete && (
        <ConfirmDialog
          title="Delete saved view?"
          message={<>Delete <strong>{confirmDelete.name}</strong>? This cannot be undone.</>}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteView(confirmDelete)}
          danger
          disabled={savingView}
        />
      )}
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
