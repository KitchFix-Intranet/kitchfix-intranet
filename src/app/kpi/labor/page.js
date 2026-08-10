"use client";
// /kpi/labor
//
// KPI Dashboard shell + Labor section. Per-account, three navigation
// layers (top nav in TopNav.js, module command bar here, in-page tabs).
//
// Access gate: OPS_LEADERSHIP_EMAILS (six-person leadership list per
// D30, ruled 2026-08-10). The nav item is visible to everyone;
// non-allowlisted users see the Coming Soon screen. Route-level
// enforcement in /api/kpi/labor/route.js is independent - a client
// gate is decoration, the server call is what matters.
//
// URL convention (follows Service Calendar's ?account=X&month=Y):
//   /kpi/labor?account=CIN+-+OH&tab=labor&start=2026-06-01&end=2026-08-31
//
// Only `labor` tab implemented in this PR. Overview + other tabs render
// a placeholder + `soon` chip per spec §2 / §13.

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

// ── Formatters ─────────────────────────────────────────────────
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

// ── Cell renderers respecting §5 empty-marker taxonomy ────────
// "—" = bucket empty this week (not zero)
// "0.00" = genuinely zero
// "?" = unknown (no basis for a figure)
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

// ── Coverage badge ─────────────────────────────────────────────
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

// ── Main page ──────────────────────────────────────────────────
export default function KpiLaborPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = session?.user?.email?.toLowerCase().trim() || "";
  const isAllowed = OPS_LEADERSHIP_EMAILS.includes(email);

  // URL state
  const account = searchParams.get("account") || "CIN - OH";
  const tab = searchParams.get("tab") || "labor";
  const today = new Date().toISOString().slice(0, 10);
  const start = searchParams.get("start") || "2025-12-29";
  const end = searchParams.get("end") || today;

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      const body = document.body;
      if (!body) return;
      if (mq.matches) body.setAttribute("data-density", "compact");
      else body.removeAttribute("data-density");
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
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoadState("ok");
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadState("error");
        setErrorMsg(String(e.message || e).slice(0, 200));
      });
    return () => { cancelled = true; };
  }, [status, isAllowed, account, start, end]);

  const setParam = (key, value) => {
    const p = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") p.delete(key);
    else p.set(key, value);
    router.push(`/kpi/labor?${p.toString()}`);
  };

  const grouped = useMemo(() => {
    if (!data?.actuals) return [];
    const byWeek = new Map();
    for (const r of data.actuals) {
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
    // Worst-of coverage: unknown > partial > hours_only > complete
    for (const w of byWeek.values()) {
      if (w.coverage_states.has("unknown")) w.coverage_state = "unknown";
      else if (w.coverage_states.has("partial")) w.coverage_state = "partial";
      else if (w.coverage_states.has("hours_only")) w.coverage_state = "hours_only";
      else w.coverage_state = "complete";
    }
    const sortedWeeks = [...byWeek.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
    const groups = [];
    for (const w of sortedWeeks) {
      const key = `${w.fiscal_year || "?"}|${w.period_no || "?"}`;
      let g = groups.find(x => x.key === key);
      if (!g) {
        g = { key, fiscal_year: w.fiscal_year, period_no: w.period_no, weeks: [], subtotal: null };
        groups.push(g);
      }
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
  }, [data]);

  const totals = useMemo(() => {
    const t = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, amount: 0, hours_without_dollars: 0 };
    if (data?.actuals) {
      for (const r of data.actuals) {
        t.hours_regular += Number(r.hours_regular || 0);
        t.hours_overtime += Number(r.hours_overtime || 0);
        t.hours_double_time += Number(r.hours_double_time || 0);
        t.amount += Number(r.amount || 0);
        t.hours_without_dollars += Number(r.hours_without_dollars || 0);
      }
    }
    return t;
  }, [data]);

  const coverageCounts = useMemo(() => {
    const c = { complete: 0, partial: 0, hours_only: 0, unknown: 0, no_labor: 0 };
    if (data?.actuals) {
      for (const r of data.actuals) c[r.coverage_state] = (c[r.coverage_state] || 0) + 1;
    }
    return c;
  }, [data]);

  const freshness = data?.derive_freshness;
  const freshnessH = hoursSinceISO(freshness?.last_walk_at);

  // ── auth loading / unauthed ────────────────────────────
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

  // ── not-allowlisted: Coming Soon (leaks nothing) ─────
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

  return (
    <div className="kpi-app">
      <div className="kpi-wrap">
        {/* Module command bar */}
        <div className="kpi-cmd" role="banner">
          <div className="kpi-cmd-title">KPI Dashboard</div>
          <div className="kpi-cmd-div" aria-hidden="true" />
          <label className="sr-only" htmlFor="kpi-account">Account</label>
          <select
            id="kpi-account"
            className="kpi-cmd-select"
            value={account}
            onChange={(e) => setParam("account", e.target.value)}
          >
            {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="kpi-cmd-div" aria-hidden="true" />
          <div className="kpi-cmd-ctx">
            <span>Range</span><b>{start}</b><span>→</span><b>{end}</b>
          </div>
          <div className="kpi-cmd-r">
            <span className="kpi-cmd-chip" title={freshness?.last_walk_at || "no successful walk"}>
              <span className={`kpi-cmd-chip-dot ${freshnessTint(freshnessH)}`} aria-hidden="true" />
              {freshnessH != null ? `${freshnessH.toFixed(1)}h ago` : "no data"}
            </span>
          </div>
        </div>

        {/* Tab strip */}
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

        {/* Content */}
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
              {/* Metric cards */}
              <div className="kpi-metrics">
                <div className="kpi-metric">
                  <div className="kpi-metric-label">FY-to-date labor</div>
                  <div className="kpi-metric-value">{fmt$(totals.amount)}</div>
                  <div className="kpi-metric-sub">across {data?.actuals?.length || 0} worker-weeks</div>
                </div>
                <div className="kpi-metric">
                  <div className="kpi-metric-label">Regular hours</div>
                  <div className="kpi-metric-value">{fmtHrs(totals.hours_regular)}</div>
                  <div className="kpi-metric-sub">40-hr threshold: reg + holiday</div>
                </div>
                <div className="kpi-metric">
                  <div className="kpi-metric-label">Overtime hours</div>
                  <div className="kpi-metric-value">{fmtHrs(totals.hours_overtime)}</div>
                  <div className="kpi-metric-sub">1.5x rate</div>
                </div>
                <div className="kpi-metric kpi-metric-soon">
                  <div className="kpi-metric-label">Budget / variance</div>
                  <div className="kpi-metric-value">—</div>
                  <div className="kpi-metric-sub">reserved (spec §8.5)</div>
                </div>
              </div>

              {/* Data body */}
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
              ) : !data?.actuals?.length ? (
                <div className="kpi-state">
                  <div className="kpi-state-title">No labor rows in range</div>
                  <div className="kpi-state-desc">{account} has no labor_actuals rows between {start} and {end}.</div>
                </div>
              ) : (
                <div className="kpi-table-wrap">
                  <table className="kpi-table" role="table" aria-label={`Labor for ${account}`}>
                    <thead>
                      <tr>
                        <th scope="col">Week</th>
                        <th scope="col">Coverage</th>
                        <th scope="col" className="kpi-num">Regular</th>
                        <th scope="col" className="kpi-num">OT 1.5x</th>
                        <th scope="col" className="kpi-num">Holiday 2x</th>
                        <th scope="col" className="kpi-num kpi-col-nodol">No $</th>
                        <th scope="col" className="kpi-num">Dollars</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.map((g) => (
                        <Fragment key={g.key}>
                          <tr className="kpi-period-header">
                            <td colSpan={7}>FY{g.fiscal_year || "?"} · Period {g.period_no || "?"}</td>
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
                                <tr className={`kpi-row ${rowClass}`}>
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
                                        const displayId = meta?.number ? `#${meta.number}` : `worker-${String(wr.worker_id).slice(0, 6)}`;
                                        return (
                                          <div key={wr.worker_id} style={{ display: "flex", gap: 12, padding: "4px 0", flexWrap: "wrap" }}>
                                            <span style={{ minWidth: 100, fontWeight: 600 }}>{displayId}</span>
                                            <span>reg {fmtHrs(wr.hours_regular)}</span>
                                            <span>ot {fmtHrs(wr.hours_overtime)}</span>
                                            <span>hol {fmtHrs(wr.hours_double_time)}</span>
                                            <span>no$ {fmtHrs(wr.hours_without_dollars)}</span>
                                            <span>{fmt$(wr.amount)}</span>
                                            <span style={{ marginLeft: "auto", opacity: 0.7 }}>{wr.coverage_state}</span>
                                          </div>
                                        );
                                      })}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          <tr className="kpi-period-subtotal">
                            <td data-label="Subtotal" colSpan={2}>Period {g.period_no} subtotal</td>
                            <td data-label="Regular"    className="kpi-num">{fmtHrs(g.subtotal.hours_regular)}</td>
                            <td data-label="OT 1.5x"    className="kpi-num">{fmtHrs(g.subtotal.hours_overtime)}</td>
                            <td data-label="Holiday 2x" className="kpi-num">{fmtHrs(g.subtotal.hours_double_time)}</td>
                            <td data-label="No dollars" className="kpi-num kpi-col-nodol">{g.subtotal.hours_without_dollars > 0 ? fmtHrs(g.subtotal.hours_without_dollars) : "—"}</td>
                            <td data-label="Dollars"    className="kpi-num">{fmt$(g.subtotal.amount)}</td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="kpi-state"><div className="kpi-state-title">Section coming soon</div></div>
          )}

          {/* Right rail */}
          {tab === "labor" && loadState === "ok" && data.account_state !== "salaried_only" && (
            <aside className="kpi-rail" aria-label="Summary rail">
              <div className="kpi-rail-card">
                <div className="kpi-rail-title">FY-to-date</div>
                <div className="kpi-rail-big">{fmt$(totals.amount)}</div>
                <div className="kpi-rail-sub">{account} · {data.actuals.length} worker-weeks in range</div>
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
                <div className="kpi-rail-title">Coverage (spec §8.4 merged legend)</div>
                <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.complete}</span><CoverageBadge state="complete" /><span className="kpi-cov-desc">every entry has dollars</span></div>
                <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.partial}</span><CoverageBadge state="partial" /><span className="kpi-cov-desc">some entries lack dollars</span></div>
                <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.hours_only}</span><CoverageBadge state="hours_only" /><span className="kpi-cov-desc">before 2026-04-20 floor (D35)</span></div>
                <div className="kpi-cov-row"><span className="kpi-cov-count">{coverageCounts.unknown}</span><CoverageBadge state="unknown" /><span className="kpi-cov-desc">no successful presence walk</span></div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
