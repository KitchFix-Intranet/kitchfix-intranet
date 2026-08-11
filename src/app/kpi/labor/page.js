"use client";
// /kpi/labor
//
// KPI Dashboard - Labor section.
//
// PR C4 additions:
//   - Saved views (pill row above the parameter strip). URL-addressable
//     via ?view=<id>. Personal-by-default; is_shared makes a view
//     readable by other OPS_LEADERSHIP_EMAILS users. Only the owner
//     may edit / rename / delete.
//   - Consolidated parameter strip: dates, presets, workers, redaction,
//     row count, and export button in ONE row directly under the
//     command bar. Account stays in the command bar (scopes the page).
//   - Workers dropdown flows INLINE (no absolute overlay) so it never
//     covers the metric cards.
//   - Redaction is an icon toggle.
//   - Export becomes secondary, right-aligned beside the row count.
//   - Active-view line shows the resolved range so a named pill never
//     hides its own definition. Editing marks the view "dirty" and
//     surfaces Update / Save as new instead of silently overwriting.

import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { PRESET_LABELS, resolveViewDates, addDaysISO } from "@/lib/kpi/dateResolve";
import "../kpi.css";

const ACCOUNTS = [
  "CIN - AZ", "CIN - OH", "CIN - KY",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const TABS = [
  { key: "overview", label: "Overview", enabled: true },
  { key: "labor",    label: "Labor",    enabled: true },
  { key: "food",     label: "Food",     enabled: false },
  { key: "other",    label: "Other COGS", enabled: false },
  { key: "revenue",  label: "Revenue",  enabled: false },
  { key: "pnl",      label: "P&L",      enabled: false },
];
const FY_START = "2025-12-29";
const PRESET_KEYS = ["this_period", "last_period", "last_4wk", "last_13wk", "fytd"];

function fmt$(v) {
  if (v == null) return "—";
  return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtHrs(v) {
  if (v == null) return "—";
  return Number(v).toFixed(2);
}
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y.slice(2)}`;
}
function hoursSinceISO(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}
function freshnessTint(hrs) {
  if (hrs == null) return "kpi-chip-stale";
  if (hrs < 30) return "kpi-chip-fresh";
  if (hrs < 54) return "kpi-chip-warm";
  return "kpi-chip-stale";
}

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
    hours_only: { label: "Hours only", cls: "kpi-badge-hours-only", symbol: "◷" },
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

  return (
    <div className="kpi-app" data-density={isCompact ? "compact" : undefined}>
      <div className="kpi-wrap">
        <div className="kpi-cmd" role="banner">
          <div className="kpi-cmd-title">KPI Dashboard</div>
          <div className="kpi-cmd-div" aria-hidden="true" />
          <label className="sr-only" htmlFor="kpi-account">Account</label>
          <select
            id="kpi-account"
            className="kpi-cmd-select"
            value={account}
            onChange={(e) => setParams({ account: e.target.value, workers: "", view: "" })}
          >
            {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="kpi-cmd-r">
            <span className="kpi-cmd-chip" title={freshness?.last_walk_at || "no successful walk"}>
              <span className={`kpi-cmd-chip-dot ${freshnessTint(freshnessH)}`} aria-hidden="true" />
              {freshnessH != null ? `${freshnessH.toFixed(1)}h ago` : "no data"}
            </span>
          </div>
        </div>

        <nav className="kpi-tabs" role="tablist" aria-label="KPI sections">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === tab}
              className={`kpi-tab ${t.key === tab ? "kpi-tab-active" : ""} ${!t.enabled ? "kpi-tab-soon" : ""}`}
              disabled={!t.enabled}
              onClick={() => t.enabled && setParam("tab", t.key)}
            >
              {t.label}
              {!t.enabled && <span className="kpi-tab-soon-chip">soon</span>}
            </button>
          ))}
        </nav>

        <div className="kpi-content">
          {tab === "overview" ? (
            <div>
              <div className="kpi-state">
                <div className="kpi-state-title">Overview</div>
                <div className="kpi-state-desc">Overview design is an open ruling (spec §13.4). Placeholder for now.</div>
              </div>
            </div>
          ) : tab === "labor" ? (
            <div>
              {/* ── C4.3 saved-view pill row ──────────────── */}
              {!isSalaried && viewsLoaded && (
                <div className="kpi-view-pills" role="toolbar" aria-label="Saved views">
                  {views.length === 0 && (
                    <span className="kpi-view-empty">No saved views for {account} yet.</span>
                  )}
                  {views.map(v => {
                    const isActive = v.id === activeViewId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`kpi-view-pill ${isActive ? "kpi-view-pill-active" : ""} ${isActive && isDirty ? "kpi-view-pill-dirty" : ""}`}
                        onClick={() => setParams({ view: String(v.id), start: "", end: "", workers: "", redact: "" })}
                        title={v.is_shared ? `Shared by ${v.owner_email}` : "Personal view"}
                      >
                        {v.name}
                        {isActive && isDirty && <span className="kpi-view-pill-dirty-dot" aria-label="unsaved changes">•</span>}
                        {v.is_shared && !v.is_owner && <span className="kpi-view-pill-shared" aria-label="shared">↝</span>}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="kpi-view-pill kpi-view-pill-save"
                    onClick={() => setSaveDialog({ mode: "new", initialName: "" })}
                    disabled={!hasData}
                  >
                    + Save
                  </button>
                  {viewError && <span className="kpi-view-error">{viewError}</span>}
                </div>
              )}

              {/* Active view line: resolved range + edit + dirty actions */}
              {activeView && resolvedActiveRange && (
                <div className="kpi-view-active">
                  <span className="kpi-view-active-name">{activeView.name}</span>
                  <span className="kpi-view-active-sep">·</span>
                  <span className="kpi-view-active-mode">
                    {activeView.date_mode === "preset"
                      ? `${PRESET_LABELS[activeView.date_preset] || activeView.date_preset} (${fmtDate(resolvedActiveRange.start)} – ${fmtDate(resolvedActiveRange.end)})`
                      : `Fixed (${fmtDate(activeView.date_from)} – ${fmtDate(activeView.date_to)})`}
                  </span>
                  <span className="kpi-view-active-sep">·</span>
                  <span>{activeView.worker_ids ? `${activeView.worker_ids.length} workers` : "all workers"}</span>
                  <span className="kpi-view-active-sep">·</span>
                  <span>{activeView.redact ? "names off" : "names on"}</span>
                  {activeView.is_shared && <><span className="kpi-view-active-sep">·</span><span>shared</span></>}
                  {activeView.is_owner && (
                    <button type="button" className="kpi-view-linkbtn" onClick={() => setEditDialog(activeView)}>
                      Edit
                    </button>
                  )}
                  {activeView.is_owner && (
                    <button type="button" className="kpi-view-linkbtn kpi-view-linkbtn-danger" onClick={() => setConfirmDelete(activeView)}>
                      Delete
                    </button>
                  )}
                  {isDirty && (
                    <span className="kpi-view-dirty-actions">
                      <span className="kpi-view-dirty-tag">unsaved changes</span>
                      {activeView.is_owner && (
                        <button type="button" className="kpi-btn-secondary" onClick={updateActiveView} disabled={savingView}>
                          Update
                        </button>
                      )}
                      <button type="button" className="kpi-btn-secondary" onClick={() => setSaveDialog({ mode: "new", initialName: `${activeView.name} (copy)` })} disabled={savingView}>
                        Save as new
                      </button>
                    </span>
                  )}
                </div>
              )}

              {/* ── C4.1 consolidated parameter strip ──────── */}
              {!isSalaried && loadState === "ok" && (data?.actuals?.length || 0) > 0 && (
                <div className="kpi-param-strip" role="group" aria-label="Report parameters">
                  <div className="kpi-param-dates">
                    <label className="sr-only" htmlFor="kpi-start">Start</label>
                    <input
                      id="kpi-start" type="date" className="kpi-param-date"
                      value={start} max={end}
                      onChange={(e) => { setLastPreset(null); setParam("start", e.target.value); }}
                    />
                    <span aria-hidden="true" className="kpi-param-arrow">→</span>
                    <label className="sr-only" htmlFor="kpi-end">End</label>
                    <input
                      id="kpi-end" type="date" className="kpi-param-date"
                      value={end} min={start}
                      onChange={(e) => { setLastPreset(null); setParam("end", e.target.value); }}
                    />
                  </div>
                  <div className="kpi-param-presets">
                    {PRESET_KEYS.map(k => (
                      <button
                        key={k} type="button"
                        className={`kpi-preset ${lastPreset === k ? "kpi-preset-active" : ""}`}
                        onClick={() => applyPreset(k)}
                        disabled={(k === "this_period" || k === "last_period") && !data?.account_periods?.length}
                      >
                        {PRESET_LABELS[k]}
                      </button>
                    ))}
                  </div>
                  <details className="kpi-param-workers">
                    <summary>
                      Workers · {shownWorkers === totalWorkersInRange
                        ? `all ${totalWorkersInRange}`
                        : `${shownWorkers} of ${totalWorkersInRange}`}
                    </summary>
                    <div className="kpi-param-workers-body">
                      <div className="kpi-param-workers-actions">
                        <button type="button" className="kpi-preset" onClick={() => setParam("workers", "")}>All</button>
                        <button type="button" className="kpi-preset" onClick={() => setParam("workers", "__none__")}>None</button>
                      </div>
                      <div className="kpi-param-workers-list">
                        {workerRoster.map(w => {
                          const checked = !selectedWorkers || (selectedWorkers.size === 0) || selectedWorkers.has(w.id);
                          const currentSet = () => {
                            if (!selectedWorkers) return new Set(workerRoster.map(x => x.id));
                            if (selectedWorkers.size === 0 || [...selectedWorkers][0] === "__none__") return new Set();
                            return new Set(selectedWorkers);
                          };
                          return (
                            <label key={w.id} className="kpi-param-workers-item">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const cur = currentSet();
                                  if (e.target.checked) cur.add(w.id);
                                  else                  cur.delete(w.id);
                                  const value = cur.size === 0 ? "__none__"
                                              : cur.size === workerRoster.length ? ""
                                              : [...cur].join(",");
                                  setParam("workers", value);
                                }}
                              />
                              <span>{w.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                  <button
                    type="button"
                    className={`kpi-redact-toggle ${redact ? "kpi-redact-on" : ""}`}
                    aria-pressed={redact}
                    onClick={() => setParam("redact", redact ? "" : "1")}
                    title={redact ? "Names hidden - click to show" : "Names shown - click to hide"}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {redact ? (
                        <>
                          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.66 19.66 0 0 1 5.11-5.94"/>
                          <path d="M9.9 4.24A10.83 10.83 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-2.16 3.19"/>
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </>
                      )}
                    </svg>
                    <span>{redact ? "Names hidden" : "Names shown"}</span>
                  </button>
                  <div className="kpi-param-spacer" />
                  <span className="kpi-param-rowcount" aria-live="polite">
                    {filteredActuals.length} row{filteredActuals.length === 1 ? "" : "s"}
                  </span>
                  <a className="kpi-btn-secondary" href={exportHref()} download>
                    Export
                  </a>
                </div>
              )}

              {/* C5.5 name-availability banner. Silent when all workers
                  resolve. States the actual missing count when some do
                  not - implying-none-do is misleading once /users lands. */}
              {!isSalaried && loadState === "ok" && data?.name_availability && data.name_availability.total > 0 && data.name_availability.resolved < data.name_availability.total && (
                <div className="kpi-note-info" role="status">
                  {data.name_availability.resolved === 0
                    ? data.name_availability.reason === "users_table_empty_or_unreachable"
                      ? <>Names unavailable: the users walk has not populated <code>rippling_raw_users</code> for the {data.name_availability.total} workers in scope. Falling back to numbers and titles. This resolves on the next successful users walk.</>
                      : <>Names unavailable: none of the {data.name_availability.total} workers in scope have a canonical name field. Falling back to numbers and titles.</>
                    : <>{data.name_availability.total - data.name_availability.resolved} of {data.name_availability.total} workers do not resolve to a canonical name and render as numbers.</>}
                </div>
              )}

              <div className="kpi-metrics">
                <div className="kpi-metric">
                  <div className="kpi-metric-label">Worker-weeks</div>
                  <div className="kpi-metric-value">{isSalaried ? "—" : (filteredActuals.length || 0)}</div>
                  <div className="kpi-metric-sub">rows in range</div>
                </div>
                <div className="kpi-metric">
                  <div className="kpi-metric-label">Hours toward OT threshold</div>
                  <div className="kpi-metric-value">{isSalaried ? "—" : fmtHrs(totals.hours_regular + totals.hours_double_time)}</div>
                  <div className="kpi-metric-sub">reg + holiday (per week: cap 40 before OT triggers)</div>
                </div>
                <div className="kpi-metric">
                  <div className="kpi-metric-label">Overtime hours</div>
                  <div className="kpi-metric-value">{isSalaried ? "—" : fmtHrs(totals.hours_overtime)}</div>
                  <div className="kpi-metric-sub">1.5x rate</div>
                </div>
                <div className="kpi-metric kpi-metric-soon">
                  <div className="kpi-metric-label">Budget / variance</div>
                  <div className="kpi-metric-value">—</div>
                  <div className="kpi-metric-sub">reserved (spec §8.5)</div>
                </div>
              </div>

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
                <div className="kpi-table-wrap">
                  <table className="kpi-table" role="table" aria-label={`Labor for ${account}`}>
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col" role="columnheader">Week</th>
                        <th scope="col" role="columnheader">Coverage</th>
                        <th scope="col" role="columnheader" className="kpi-num">Regular</th>
                        <th scope="col" role="columnheader" className="kpi-num">OT 1.5x</th>
                        <th scope="col" role="columnheader" className="kpi-num">Holiday 2x</th>
                        <th scope="col" role="columnheader" className="kpi-num kpi-col-nodol">No $</th>
                        <th scope="col" role="columnheader" className="kpi-num">Dollars</th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {grouped.map((g) => (
                        <Fragment key={g.key}>
                          <tr className="kpi-period-header" role="row">
                            <td colSpan={7} role="cell">
                              FY{g.fiscal_year || "?"} · Period {g.period_no || "?"}
                              {periodsIsAllHoursOnly.has(g.key) && (
                                <span className="kpi-period-note">
                                  Dollars begin at the 2026-04-20 pay run (D35). Earlier periods are hours-only by design; the P&L upload is authoritative for these dollars.
                                </span>
                              )}
                            </td>
                          </tr>
                          {g.weeks.map((w) => {
                            const isUnknown = w.coverage_state === "unknown";
                            const isHoursOnly = w.coverage_state === "hours_only";
                            const rowClass =
                              w.coverage_state === "complete"   ? "kpi-row-complete" :
                              w.coverage_state === "partial"    ? "kpi-row-partial"  :
                              w.coverage_state === "hours_only" ? "kpi-row-hours-only" :
                              w.coverage_state === "unknown"    ? "kpi-row-unknown" :
                                                                  "kpi-row-no-labor";
                            const isExpanded = expandedWeeks.has(w.week_start);
                            return (
                              <Fragment key={`w-${w.week_start}`}>
                                <tr className={`kpi-row ${rowClass}`} role="row">
                                  <td data-label="Week">
                                    <button
                                      type="button"
                                      className="kpi-row-btn"
                                      aria-expanded={isExpanded}
                                      aria-controls={`detail-${w.week_start}`}
                                      onClick={() => {
                                        const next = new Set(expandedWeeks);
                                        if (isExpanded) next.delete(w.week_start); else next.add(w.week_start);
                                        setExpandedWeeks(next);
                                      }}
                                    >
                                      <span className="kpi-row-caret" aria-hidden="true">›</span>
                                      {fmtDate(w.week_start)} – {fmtDate(w.week_end)}
                                    </button>
                                  </td>
                                  <td data-label="Coverage"><CoverageBadge state={w.coverage_state} /></td>
                                  {isUnknown ? (
                                    <td colSpan={5} className="kpi-row-spanning" data-label="Status">No presence walk covers this week.</td>
                                  ) : isHoursOnly ? (
                                    <td colSpan={5} className="kpi-row-spanning" data-label="Status">
                                      Hours known, dollars not available. {fmtHrs(w.hours_without_dollars)} hrs unpriced.
                                    </td>
                                  ) : (
                                    <>
                                      <td data-label="Regular" className="kpi-num"><CellHours v={w.hours_regular} coverage_state={w.coverage_state} /></td>
                                      <td data-label="OT 1.5x" className="kpi-num"><CellHours v={w.hours_overtime} coverage_state={w.coverage_state} /></td>
                                      <td data-label="Holiday 2x" className="kpi-num"><CellHours v={w.hours_double_time} coverage_state={w.coverage_state} /></td>
                                      <td data-label="No dollars" className="kpi-num kpi-col-nodol"><CellHours v={w.hours_without_dollars > 0 ? w.hours_without_dollars : null} coverage_state={w.coverage_state} /></td>
                                      <td data-label="Dollars" className="kpi-num"><CellDollars v={w.amount} coverage_state={w.coverage_state} /></td>
                                    </>
                                  )}
                                </tr>
                                {isExpanded && (
                                  <tr id={`detail-${w.week_start}`} className="kpi-detail-row">
                                    <td colSpan={7}>
                                      {w.worker_rows.map((wr) => {
                                        const meta = data.workers?.[wr.worker_id];
                                        const label = workerLabel(meta, wr.worker_id, redact);
                                        return (
                                          <div key={wr.worker_id} className="kpi-worker-row">
                                            <span className="kpi-worker-name">{label}</span>
                                            <span>reg {fmtHrs(wr.hours_regular)}</span>
                                            <span>ot {fmtHrs(wr.hours_overtime)}</span>
                                            <span>hol {fmtHrs(wr.hours_double_time)}</span>
                                            <span>no$ {fmtHrs(wr.hours_without_dollars)}</span>
                                            <span>{fmt$(wr.amount)}</span>
                                            <span className="kpi-worker-cov">{wr.coverage_state}</span>
                                          </div>
                                        );
                                      })}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          <tr className="kpi-period-subtotal" role="row">
                            <td data-label="Subtotal" colSpan={2} role="cell">Period {g.period_no} subtotal</td>
                            <td data-label="Regular"    className="kpi-num" role="cell">{fmtHrs(g.subtotal.hours_regular)}</td>
                            <td data-label="OT 1.5x"    className="kpi-num" role="cell">{fmtHrs(g.subtotal.hours_overtime)}</td>
                            <td data-label="Holiday 2x" className="kpi-num" role="cell">{fmtHrs(g.subtotal.hours_double_time)}</td>
                            <td data-label="No dollars" className="kpi-num kpi-col-nodol" role="cell">{g.subtotal.hours_without_dollars > 0 ? fmtHrs(g.subtotal.hours_without_dollars) : "—"}</td>
                            <td data-label="Dollars"    className="kpi-num" role="cell">{fmt$(g.subtotal.amount)}</td>
                          </tr>
                        </Fragment>
                      ))}
                      {grand && (
                        <tr className="kpi-grand-total" role="row">
                          <td data-label="Grand total" colSpan={2} role="cell"><strong>{grandLabel}</strong></td>
                          <td data-label="Regular"    className="kpi-num" role="cell"><strong>{fmtHrs(grand.hours_regular)}</strong></td>
                          <td data-label="OT 1.5x"    className="kpi-num" role="cell"><strong>{fmtHrs(grand.hours_overtime)}</strong></td>
                          <td data-label="Holiday 2x" className="kpi-num" role="cell"><strong>{fmtHrs(grand.hours_double_time)}</strong></td>
                          <td data-label="No dollars" className="kpi-num kpi-col-nodol" role="cell"><strong>{grand.hours_without_dollars > 0 ? fmtHrs(grand.hours_without_dollars) : "—"}</strong></td>
                          <td data-label="Dollars"    className="kpi-num" role="cell"><strong>{fmt$(grand.amount)}</strong></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="kpi-state"><div className="kpi-state-title">Section coming soon</div></div>
          )}

          {tab === "labor" && loadState === "ok" && data.account_state !== "salaried_only" && (
            <aside className="kpi-rail" aria-label="Summary rail">
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
                    <div className="kpi-alarm-title">Hours without dollars</div>
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
            </aside>
          )}
        </div>
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
