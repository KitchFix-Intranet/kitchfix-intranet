"use client";
// /kpi/labor
//
// KPI Dashboard shell + Labor section. Per-account, three navigation
// layers (top nav in TopNav.js, module command bar here, in-page tabs).
//
// Access gate: OPS_LEADERSHIP_EMAILS. Route-level enforcement in
// /api/kpi/labor/route.js is authoritative; the client gate is decoration.
//
// URL convention:
//   /kpi/labor?account=CIN+-+OH&tab=labor&start=YYYY-MM-DD&end=YYYY-MM-DD
//
// PR C3 additions:
//   - C3.2 date controls: From/To inputs + presets (this period, last
//     period, last 4 weeks, last 13 weeks, FYTD). URL-addressable.
//   - C3.3 worker multi-select: filters table, cards, rail, export
//     together. "N of M workers" chip when filtered.
//   - C3.4 report builder: opens the /api/kpi/labor/export route with
//     current filter shape.
//   - Redaction toggle: swaps names to numbers-only (session-scoped;
//     persists via URL flag for shareability).
//   - C3.1 names: use canonical `display_name` from server (may be null
//     when Rippling's ingested payload lacks a name field, which is the
//     current state). Never mangle emails. Fall back to `#N · Title`.

import { useState, useEffect, useMemo, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
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

function fmt$(v) {
  if (v == null) return "—";
  return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtHrs(v) {
  if (v == null) return "—";
  const n = Number(v);
  return n.toFixed(2);
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
function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Empty-marker cell renderers (§5)
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

// Display label for a worker respecting the redaction toggle.
// Server hands back display_name=null when Rippling's payload lacks a
// canonical name; falling back to `#N · Title` is honest.
function workerLabel(meta, worker_id, redact) {
  const num = meta?.number != null ? `#${meta.number}` : `#${String(worker_id).slice(0, 6)}`;
  if (redact || !meta?.display_name) {
    const title = meta?.title ? ` · ${meta.title}` : "";
    return `${num}${title}`;
  }
  return `${meta.display_name} (${num})`;
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
  const start = searchParams.get("start") || FY_START;
  const end = searchParams.get("end") || today;
  const redact = searchParams.get("redact") === "1";
  const workersParam = (searchParams.get("workers") || "").trim();
  const selectedWorkers = useMemo(
    () => (workersParam ? new Set(workersParam.split(",").filter(Boolean)) : null),
    [workersParam]
  );

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());

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

  // C3.3 filter: applied to actuals BEFORE grouping so all derivatives
  // (table, metrics, rail, grand total) tie to the selected worker set.
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
          worker_rows: [],
          coverage_states: new Set(),
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
      if (states.length === 1) w.coverage_state = states[0];
      else                     w.coverage_state = "partial";
      if ((w.coverage_state === "unknown" || w.coverage_state === "hours_only") && w.amount > 0.01) {
        if (typeof console !== "undefined") {
          console.warn(`kpi-labor: collapsed row ${w.week_start} has amount=$${w.amount.toFixed(2)}; demoting to partial`);
        }
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

  // Worker roster for the multi-select: derived from currently-loaded
  // actuals so it reflects the account+range in view.
  const workerRoster = useMemo(() => {
    if (!data?.actuals) return [];
    const ids = [...new Set(data.actuals.map(r => r.worker_id))];
    return ids
      .map(id => ({
        id,
        label: workerLabel(data.workers?.[id], id, redact),
        meta: data.workers?.[id],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, redact]);

  // Presets: this period / last period / last 4 wk / last 13 wk / FYTD.
  // Period boundaries come from server (account_periods), so account
  // switches respect that account's fiscal calendar.
  function applyPreset(kind) {
    const t = today;
    if (kind === "l4")    return setParams({ start: addDaysISO(t, -27), end: t });
    if (kind === "l13")   return setParams({ start: addDaysISO(t, -90), end: t });
    if (kind === "fytd")  return setParams({ start: FY_START, end: t });
    const periods = data?.account_periods || [];
    if (!periods.length) return;
    const withStart = periods.filter(p => p.start && p.end);
    const past = withStart.filter(p => p.start <= t);
    if (kind === "thisp") {
      const cur = past[past.length - 1];
      if (cur) setParams({ start: cur.start, end: cur.end });
    } else if (kind === "lastp") {
      const prev = past[past.length - 2];
      if (prev) setParams({ start: prev.start, end: prev.end });
    }
  }

  if (status === "loading") {
    return (
      <div className="kpi-app"><div className="kpi-wrap">
        <div className="kpi-state"><div className="kpi-state-title">Loading...</div></div>
      </div></div>
    );
  }
  if (status === "unauthenticated") {
    return (
      <div className="kpi-app"><div className="kpi-wrap">
        <div className="kpi-state">
          <div className="kpi-state-title">Sign in required</div>
          <div className="kpi-state-desc">The KPI Dashboard requires an active session.</div>
        </div>
      </div></div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="kpi-app"><div className="kpi-wrap">
        <div className="kpi-coming">
          <div className="kpi-coming-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 9h6M9 13h6M9 17h4" />
            </svg>
          </div>
          <h1 className="kpi-coming-title">KPI Dashboard</h1>
          <p className="kpi-coming-desc">A per-account financial dashboard is in development. Check back soon.</p>
        </div>
      </div></div>
    );
  }

  const isSalaried = data?.account_state === "salaried_only";

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
    for (const g of grouped) {
      if (g.weeks.every(w => w.coverage_state === "hours_only")) set.add(g.key);
    }
    return set;
  }, [grouped]);

  const totalWorkersInRange = data?.actuals ? new Set(data.actuals.map(r => r.worker_id)).size : 0;
  const shownWorkers = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : totalWorkersInRange;

  // Grand total wording (Kevin's P4 note): explain when the periods
  // shown are fewer than the periods spanned by the range.
  const grandLabel = grouped.length > 0
    ? `Range total (${grouped.length} period${grouped.length === 1 ? "" : "s"} with labor)`
    : "Range total";

  function exportHref() {
    const p = new URLSearchParams({ account, start, end });
    if (selectedWorkers && selectedWorkers.size > 0) p.set("workers", [...selectedWorkers].join(","));
    if (redact) p.set("redact", "1");
    return `/api/kpi/labor/export?${p.toString()}`;
  }

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
            onChange={(e) => setParams({ account: e.target.value, workers: "" })}
          >
            {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="kpi-cmd-div" aria-hidden="true" />
          {/* C3.2: real date inputs replace the read-only display. */}
          <label className="sr-only" htmlFor="kpi-start">Start date</label>
          <input
            id="kpi-start"
            type="date"
            className="kpi-cmd-date"
            value={start}
            max={end}
            onChange={(e) => setParam("start", e.target.value)}
          />
          <span aria-hidden="true" className="kpi-cmd-arrow">→</span>
          <label className="sr-only" htmlFor="kpi-end">End date</label>
          <input
            id="kpi-end"
            type="date"
            className="kpi-cmd-date"
            value={end}
            min={start}
            onChange={(e) => setParam("end", e.target.value)}
          />
          <div className="kpi-cmd-presets">
            <button type="button" className="kpi-cmd-preset" onClick={() => applyPreset("thisp")} disabled={!data?.account_periods?.length}>This period</button>
            <button type="button" className="kpi-cmd-preset" onClick={() => applyPreset("lastp")} disabled={!data?.account_periods?.length}>Last period</button>
            <button type="button" className="kpi-cmd-preset" onClick={() => applyPreset("l4")}>Last 4 wk</button>
            <button type="button" className="kpi-cmd-preset" onClick={() => applyPreset("l13")}>Last 13 wk</button>
            <button type="button" className="kpi-cmd-preset" onClick={() => applyPreset("fytd")}>FYTD</button>
          </div>
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
              {/* C3.3 + C3.4 filter row */}
              {!isSalaried && loadState === "ok" && (data?.actuals?.length || 0) > 0 && (
                <div className="kpi-filterbar" role="group" aria-label="Filters and export">
                  <details className="kpi-filter-workers">
                    <summary>
                      Workers · {shownWorkers === totalWorkersInRange
                        ? `all ${totalWorkersInRange}`
                        : `${shownWorkers} of ${totalWorkersInRange}`}
                    </summary>
                    <div className="kpi-filter-workers-body">
                      <div className="kpi-filter-actions">
                        <button type="button" className="kpi-cmd-preset" onClick={() => setParam("workers", "")}>All</button>
                        <button type="button" className="kpi-cmd-preset" onClick={() => setParam("workers", "__none__")}>None</button>
                      </div>
                      <div className="kpi-filter-list">
                        {workerRoster.map(w => {
                          const checked = !selectedWorkers || selectedWorkers.has(w.id);
                          return (
                            <label key={w.id} className="kpi-filter-item">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const cur = new Set(selectedWorkers && selectedWorkers.size > 0 && [...selectedWorkers][0] !== "__none__"
                                    ? selectedWorkers
                                    : (e.target.checked ? [] : workerRoster.map(x => x.id)));
                                  if (e.target.checked) cur.add(w.id);
                                  else                  cur.delete(w.id);
                                  const value = cur.size === 0 ? "__none__" : cur.size === workerRoster.length ? "" : [...cur].join(",");
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
                  <label className="kpi-toggle">
                    <input
                      type="checkbox"
                      checked={redact}
                      onChange={(e) => setParam("redact", e.target.checked ? "1" : "")}
                    />
                    <span>Hide names</span>
                  </label>
                  <a className="kpi-btn-primary" href={exportHref()} download>
                    Export xlsx
                  </a>
                </div>
              )}

              {/* C3.1 name-availability banner */}
              {!isSalaried && loadState === "ok" && data?.name_availability && data.name_availability.total > 0 && !data.name_availability.has_names && (
                <div className="kpi-note-info" role="status">
                  Names unavailable: the ingested Rippling workers payload does not carry a name field for any of the {data.name_availability.total} workers in scope. Displaying employee numbers and titles only.
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
                                    <td colSpan={5} className="kpi-row-spanning" data-label="Status">
                                      No presence walk covers this week.
                                    </td>
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
    </div>
  );
}
