"use client";
// src/app/kpi/purchasing/components/PurchasingTable.js
//
// PR 4 - drill-down table.
//
// Sits below Card purchases on the at-risk board. Same tier ladder as
// the week strip via `classifyTier`:
//
//   Tier A (<=6 weeks)  - week rows, expand -> bill rows
//   Tier B (7-13 weeks) - week rows, expand -> bill rows
//   Tier C (>13 weeks)  - period bands (collapsed by default),
//                         expand -> weeks, expand -> bill rows
//
// Tier C collapsed by default is the point: an ALL / FYTD range is
// nine band rows, not thirty-five week rows.
//
// Columns (spec + prompt): Food · Packaging & supplies · Vehicle ·
// Equipment · Repair & maintenance · Total.
//
// Data flow:
//   - Aggregate cells come from `weekly` (already in the mount payload
//     - never fetches anything on mount)
//   - Bill rows load ON EXPAND via a scoped GET
//     `/api/kpi/purchasing?account=&start=&end=&drill=lines` where
//     (start, end) is the band's or week's own bounds. Cached by key.
//   - SHOW filter (All / Bills only / Cards only) at the aggregate
//     level requires source-split data - fires a LAZY fetch with
//     `?table=1` on the first switch to Bills or Cards, cached.
//     Aggregate cells then read from `weekly_by_source` filtered by
//     the selected source. Bill drill rows filter directly on
//     `source`. `All` uses the mount payload untouched.
//
// **Footer totals equal bucket card heroes** (check 1 - the gate).
// Assert in dev; log in prod. Same defect class as R4 Part A + Check
// 9 - hero-vs-detail drift has now shown up seven times on this
// project. Bind them.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt$, fmtPct } from "../lib/board";
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";

// Column set for the at-risk board (default).  Pass-through swaps this
// for a 13xx-family set so we don't show three empty columns (owner
// ruling 2026-08-28, R16 P1: "restoring Food / Packaging / Vehicle
// there would show three empty columns, which is worse than no table").
const COLUMNS_AT_RISK = [
  { key: "food",      label: "Food",                 sub: "3200" },
  { key: "packaging", label: "Packaging & supplies", sub: "3400" },
  { key: "vehicle",   label: "Vehicle",              sub: "3500" },
  { key: "equipment", label: "Equipment",            sub: "5002.5" },
  { key: "repair",    label: "R&M",                  sub: "5002.1" },
];
// Pass-through column set - single Reimbursable column that aggregates
// every 13xx GL code.  MVP: one column.  Kevin can rule on a finer
// per-family split (1385 vs 1374 vs .1 vs .2) later; at STL-MO right
// now there are 8 distinct 13xx codes, at TBJ-FL the count differs,
// so a variable per-account column set would drift table shape between
// accounts.  Fixed 1-column is legible everywhere.
const COLUMNS_PASS_THROUGH = [
  { key: "reimbursable", label: "Reimbursable", sub: "13xx" },
];

// Column derivation matches the server-side `columnFor` shape.  Selects
// the correct rule set based on the passthrough flag.
function makeColumnForRow(isPassThrough) {
  if (isPassThrough) {
    return (r) => {
      const s = String(r.gl_line_code || "");
      if (s.startsWith("13")) return "reimbursable";
      return null;
    };
  }
  return (r) => {
    if (r.gl_line_code === "5002.5") return "equipment";
    if (r.gl_line_code === "5002.1") return "repair";
    const s = String(r.gl_line_code || "");
    if (s.startsWith("3200")) return "food";
    if (s.startsWith("3400")) return "packaging";
    if (s.startsWith("3500")) return "vehicle";
    return null;
  };
}
// Legacy export retained for the at-risk consumer.
function columnForRow(r) { return makeColumnForRow(false)(r); }

// A cell display: em-dash when null (missing), $0.00 when genuinely
// zero, formatted currency otherwise. `—` renders in muted color +
// normal weight; $0.00 in normal color + normal weight; a real value
// in normal color + tabular; distinct across all three per rule
// (`— for missing, $0.00 for genuinely zero, distinct in weight and
// colour`).
function Cell({ value, isFooter }) {
  if (value == null) {
    return <td className="kpi-p-tbl-cell kpi-p-tbl-dash" aria-label="no data">—</td>;
  }
  const zero = Math.abs(value) < 0.005;
  return (
    <td
      className={`kpi-p-tbl-cell num${zero ? " kpi-p-tbl-zero" : ""}${isFooter ? " kpi-p-tbl-footcell" : ""}`}
    >
      {fmt$(value)}
    </td>
  );
}

// Aggregate weekly rows into per-week per-column cells.  Column set is
// dynamic (columns prop): the at-risk board uses the P&L 5-column set,
// pass-through uses the 13xx reimbursable single-column set.  Rows
// without a column mapping (uncoded card charges at at-risk; 5002 rows
// at pass-through) drop out of the table but the raw amount stays
// visible on other cards.
function makeEmptyCell(columns) {
  const cell = {};
  for (const c of columns) cell[c.key] = 0;
  cell.total = 0;
  return cell;
}
function buildWeeklyCells({ weekly, weekly_by_source, showFilter, weeks, columns, columnFor }) {
  const cellsByWeek = new Map();
  for (const iso of weeks) cellsByWeek.set(iso, makeEmptyCell(columns));
  if (showFilter === "all") {
    for (const r of weekly || []) {
      const col = columnFor(r);
      if (!col) continue;
      const cell = cellsByWeek.get(r.week_start);
      if (!cell) continue;
      const amt = Number(r.amount || 0);
      cell[col] += amt;
      cell.total += amt;
    }
  } else if (Array.isArray(weekly_by_source)) {
    const wantSource = showFilter === "bills" ? "billcom" : "rippling_spend";
    // weekly_by_source ships with `column` keys from the at-risk P&L
    // mapping - the source-split lookup isn't wired for pass-through yet.
    // Skip when the column isn't in our set (safer than double-counting).
    const columnKeys = new Set(columns.map(c => c.key));
    for (const r of weekly_by_source) {
      if (r.source !== wantSource) continue;
      if (!columnKeys.has(r.column)) continue;
      const cell = cellsByWeek.get(r.week_start);
      if (!cell) continue;
      const amt = Number(r.amount || 0);
      cell[r.column] += amt;
      cell.total += amt;
    }
  }
  return cellsByWeek;
}

// Sum week cells into period bands from decoratedPeriods bounds.
function buildPeriodBands({ decoratedPeriods, cellsByWeek, weeks, columns }) {
  return decoratedPeriods.map(p => {
    const bandCell = makeEmptyCell(columns);
    const weeksIn = weeks.filter(w => w >= p.start && w <= p.end);
    const keys = [...columns.map(c => c.key), "total"];
    for (const w of weeksIn) {
      const c = cellsByWeek.get(w);
      if (!c) continue;
      for (const col of keys) bandCell[col] += c[col];
    }
    return { period: p, weeks: weeksIn, cell: bandCell };
  });
}

function BillRows({ scopeKey, drillState, isAggregate, showFilter, columns, columnFor }) {
  const state = drillState.get(scopeKey);
  if (!state || state.status === "loading") {
    return (
      <tr className="kpi-p-tbl-billload"><td colSpan={7}>Loading bills&hellip;</td></tr>
    );
  }
  if (state.status === "error") {
    return (
      <tr className="kpi-p-tbl-billload"><td colSpan={7}>Could not load bills: {state.error || "unknown error"}</td></tr>
    );
  }
  const rows = state.rows || [];
  // Filter by SHOW at the row level (works even without weekly_by_source
  // because each actual row carries its own source).
  const filtered = showFilter === "all"
    ? rows
    : rows.filter(r => r.source === (showFilter === "bills" ? "billcom" : "rippling_spend"));
  if (filtered.length === 0) {
    return (
      <tr className="kpi-p-tbl-billload"><td colSpan={7}>
        {showFilter === "all"
          ? "No bills or card charges recorded in this range."
          : `No ${showFilter === "bills" ? "bills" : "card charges"} in this range.`}
      </td></tr>
    );
  }
  return filtered.slice(0, 100).map((r, i) => {
    const col = columnFor(r);
    const amt = Number(r.amount || 0);
    return (
      <tr key={`${r.id || r.source_line_id || i}`} className="kpi-p-tbl-bill">
        <td className="kpi-p-tbl-billlbl">
          <span className="kpi-p-tbl-billsrc">{r.source === "rippling_spend" ? "card" : "bill.com"}</span>
          <span className={`kpi-p-tbl-billv${r.vendor ? "" : " kpi-p-tbl-billv-unresolved"}`}>
            {r.vendor
              ? r.vendor
              : (r.source === "billcom" ? "unresolved vendor" : "—")}
          </span>
          <span className="kpi-p-tbl-billmeta">
            {r.gl_line_code || "—"}{r.txn_date ? ` · ${r.txn_date.slice(5).replace("-", "/")}` : ""}
            {isAggregate && r.account_key ? ` · ${r.account_key}` : ""}
          </span>
        </td>
        {columns.map(c => (
          <Cell key={c.key} value={c.key === col ? amt : null} />
        ))}
        <td className="kpi-p-tbl-cell num kpi-p-tbl-footcell">{fmt$(amt)}</td>
      </tr>
    );
  });
}

export function PurchasingTable({
  account,
  start,
  end,
  tier,
  weeks,               // ISO[] fiscal-week starts in range
  decoratedPeriods,    // [{period_no, start, end, running, finished, ...}]
  weekly,              // route.weekly - always present on mount
  heroTotals,          // { food, packaging, vehicle, equipment, repair, total } from page.js board
  isAggregate,
  weeksInRange,
  // R15 F - per-vendor rollup for the By vendor row mode; when absent
  // the mode toggle is hidden and only P&L rows render.  Shape:
  //   { rows: [{ vendor_id, name, resolved, spend, line_count, gl_split }],
  //     total_count, total_amount }
  vendorRollup,
  // R15 F - default row mode. Pass "vendor" from pass-through boards.
  defaultRowMode = "pnl",
  // R16 P1 (owner ruling 2026-08-28): pass-through board renders this
  // table with a single Reimbursable (13xx) column instead of the
  // at-risk 5 columns.  Reimbursable is what a management-fee account
  // actually spends against; Food / Packaging / Vehicle would land as
  // three empty columns and that's worse than no table.
  isPassThrough = false,
}) {
  const COLUMNS = isPassThrough ? COLUMNS_PASS_THROUGH : COLUMNS_AT_RISK;
  const columnFor = makeColumnForRow(isPassThrough);
  const [showFilter, setShowFilter] = useState("all");            // 'all' | 'bills' | 'cards'
  const [rowMode, setRowMode] = useState(defaultRowMode);         // 'pnl' | 'vendor'
  const [expandedPeriods, setExpandedPeriods] = useState(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  // Lazy-fetched source-split aggregate for SHOW=Bills/Cards.
  const [sourceSplit, setSourceSplit] = useState(null);           // null | { status, rows?, error? }
  // Per-scope drill cache: key = `${start}|${end}` -> { status, rows?, error? }
  const [drillState, setDrillState] = useState(() => new Map());
  const drillStateRef = useRef(drillState);
  drillStateRef.current = drillState;

  // Lazy fetch of source-split aggregate on first switch to Bills/Cards.
  useEffect(() => {
    if (showFilter === "all") return;
    if (sourceSplit && sourceSplit.status === "ok") return;
    if (sourceSplit && sourceSplit.status === "loading") return;
    let cancelled = false;
    setSourceSplit({ status: "loading" });
    const params = new URLSearchParams({ account, start, end, table: "1" });
    fetch(`/api/kpi/purchasing?${params.toString()}`, { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setSourceSplit({ status: "error", error: body?.error || `HTTP ${r.status}` });
          return;
        }
        setSourceSplit({ status: "ok", rows: body.weekly_by_source || [] });
      })
      .catch(e => {
        if (cancelled) return;
        setSourceSplit({ status: "error", error: String(e?.message || e) });
      });
    return () => { cancelled = true; };
  }, [showFilter, account, start, end, sourceSplit]);

  // Reset caches when the range/account changes.
  useEffect(() => {
    setExpandedPeriods(new Set());
    setExpandedWeeks(new Set());
    setSourceSplit(null);
    setDrillState(new Map());
  }, [account, start, end]);

  const cellsByWeek = useMemo(
    () => buildWeeklyCells({
      weekly,
      weekly_by_source: sourceSplit?.rows,
      showFilter,
      weeks,
      columns: COLUMNS,
      columnFor,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekly, sourceSplit, showFilter, weeks, isPassThrough],
  );

  const bands = useMemo(
    () => tier === "C" ? buildPeriodBands({ decoratedPeriods, cellsByWeek, weeks, columns: COLUMNS }) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tier, decoratedPeriods, cellsByWeek, weeks, isPassThrough],
  );

  // Footer totals - sum of aggregate cells across the columns in play.
  const footTotals = useMemo(() => {
    const t = makeEmptyCell(COLUMNS);
    for (const c of cellsByWeek.values()) {
      for (const col of Object.keys(t)) t[col] += c[col];
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsByWeek, isPassThrough]);

  // R15 F - vendor-mode footer totals.  Only wired for at-risk (the
  // vendor rollup's gl_split carries the P&L 5-column breakdown).  At
  // pass-through we skip - Kevin can rule whether to build a reimb-only
  // vendor rollup shape later.
  const vendorFootTotals = useMemo(() => {
    const t = makeEmptyCell(COLUMNS);
    if (isPassThrough) return t;
    for (const v of (vendorRollup?.rows || [])) {
      const g = v.gl_split || {};
      t.food      += Number(g.food || 0);
      t.packaging += Number(g.packaging || 0);
      t.vehicle   += Number(g.vehicle || 0);
      t.equipment += Number(g.equipment || 0);
      t.repair    += Number(g.repair || 0);
      t.total     += Number(v.spend || 0);
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorRollup, isPassThrough]);

  // Check 1 - THE GATE. Aggregate cells (footer) MUST equal the bucket
  // card heroes above. Dev throws on mismatch; prod warns. Same one-
  // source discipline the LedgerCard Check 9 gate uses. Skipped when
  // SHOW is filtered (heroes reflect ALL bills+cards; filtered footer
  // legitimately differs), when in By vendor row mode, or when in the
  // pass-through table (heroTotals shape is at-risk-only; the pass-
  // through reimbursable hero binds via LedgerCard Check 9 on the reimb
  // ledger card directly).
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && rowMode === "pnl" && showFilter === "all" && heroTotals && !isPassThrough) {
    const CENTS_TOLERANCE = 0.02;
    for (const col of ["food", "packaging", "vehicle"]) {
      const foot = Math.round(footTotals[col] * 100) / 100;
      const hero = Math.round(Number(heroTotals[col] || 0) * 100) / 100;
      if (Math.abs(foot - hero) > CENTS_TOLERANCE) {
        // eslint-disable-next-line no-console
        console.error(`[PurchasingTable Check 1] ${col} footer $${foot.toFixed(2)} != hero $${hero.toFixed(2)}`);
        throw new Error(
          `PurchasingTable Check 1: ${col} footer $${foot.toFixed(2)} != hero $${hero.toFixed(2)} (delta $${(foot - hero).toFixed(2)})`,
        );
      }
    }
  }

  const fetchDrillFor = useCallback((sliceStart, sliceEnd) => {
    const key = `${sliceStart}|${sliceEnd}`;
    if (drillStateRef.current.has(key)) return;
    setDrillState(prev => {
      const next = new Map(prev);
      next.set(key, { status: "loading" });
      return next;
    });
    const params = new URLSearchParams({ account, start: sliceStart, end: sliceEnd, drill: "lines" });
    fetch(`/api/kpi/purchasing?${params.toString()}`, { credentials: "include" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        setDrillState(prev => {
          const next = new Map(prev);
          if (!r.ok) {
            next.set(key, { status: "error", error: body?.error || `HTTP ${r.status}` });
          } else {
            next.set(key, { status: "ok", rows: body.actuals || [] });
          }
          return next;
        });
      })
      .catch(e => {
        setDrillState(prev => {
          const next = new Map(prev);
          next.set(key, { status: "error", error: String(e?.message || e) });
          return next;
        });
      });
  }, [account]);

  const togglePeriod = (periodNo, sliceStart, sliceEnd) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev);
      if (next.has(periodNo)) next.delete(periodNo);
      else next.add(periodNo);
      return next;
    });
    // No drill fetch on period band expand - weeks nest inside; bill
    // drill fires when a week inside the band is expanded.
  };
  const toggleWeek = (weekStart, weekEnd) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekStart)) next.delete(weekStart);
      else next.add(weekStart);
      return next;
    });
    fetchDrillFor(weekStart, weekEnd);
  };
  const expandAll = () => {
    if (tier !== "C") return;
    setExpandedPeriods(new Set(decoratedPeriods.map(p => p.period_no)));
  };
  const collapseAll = () => {
    if (tier !== "C") return;
    setExpandedPeriods(new Set());
    setExpandedWeeks(new Set());
  };

  const showFilterActive = showFilter !== "all";
  const sourceSplitPending = showFilterActive && sourceSplit?.status !== "ok";

  const renderWeekRow = (weekStart, weekEnd, cell) => {
    const open = expandedWeeks.has(weekStart);
    const key = `${weekStart}|${weekEnd}`;
    // PR 2 R9 P3-8 - a row summing to $0.00 has nothing to drill into
    // (a chevron that opens nothing is broken affordance). Render the
    // date as plain text; no chevron, no click, no aria-expanded.
    // Aggregate total is the observable signal - a row with real
    // netted-out activity (e.g. $100 - $100) is rare and would still
    // read $0.00, but the drill fetches nothing meaningful there
    // either.
    const isEmpty = !cell || Math.abs(Number(cell.total || 0)) < 0.005;
    return (
      <tr key={`w-${weekStart}`} className={`kpi-p-tbl-week ${open ? "kpi-p-tbl-week-open" : ""}${isEmpty ? " kpi-p-tbl-week-empty" : ""}`}>
        <td>
          {isEmpty ? (
            <span className="kpi-p-tbl-weeklab">
              {weekStart.slice(5).replace("-", "/")}
            </span>
          ) : (
            <button
              type="button"
              className="kpi-p-tbl-weekbtn"
              onClick={() => toggleWeek(weekStart, weekEnd)}
              aria-expanded={open ? "true" : "false"}
            >
              <span className="kpi-p-tbl-chev">{open ? "⌄" : "›"}</span>
              {weekStart.slice(5).replace("-", "/")}
            </button>
          )}
        </td>
        {COLUMNS.map(c => (<Cell key={c.key} value={cell[c.key]} />))}
        <Cell value={cell.total} isFooter />
      </tr>
    );
  };

  return (
    <div className="kpi-p-card kpi-p-tbl-container" data-card="drill-table">
      <div className="kpi-p-tbl-toolbar">
        <div className="kpi-p-tbl-tbg">
          <span className="kpi-p-cardtitle">{rowMode === "vendor" ? "By vendor" : "By P&L line"}</span>
          {" "}<HelpPop id="qDrillTable" title="The drill-down table" body={
            <>
              Every fiscal week in the range, split across the five P&amp;L
              columns bill.com and coded card charges land on.
              <br /><br />
              <b>Expand a week to see the individual bills and card
              charges</b> that make up its numbers - loaded on demand,
              scoped to the range you clicked.
              <span className="kpi-hs-pop-foot">
                The footer row sums the columns and must match the bucket
                cards above. Any drift trips a build-time assert.
              </span>
            </>
          } />
        </div>
        {rowMode === "pnl" && tier === "C" && (
          <div className="kpi-p-tbl-tbg">
            <button type="button" className="kpi-p-tbl-tbbtn" onClick={expandAll}>Expand all</button>
            <button type="button" className="kpi-p-tbl-tbbtn" onClick={collapseAll}>Collapse all</button>
          </div>
        )}
        <span className="kpi-p-tbl-tbspacer" aria-hidden="true" />
        {/* R15 F - rows toggle (only when vendor rollup is present). */}
        {vendorRollup?.rows && (
          <div className="kpi-p-tbl-tbg" role="group" aria-label="Row mode">
            <span className="kpi-p-tbl-tblab">Rows</span>
            <span className="kpi-p-tbl-seg">
              <button type="button" className={rowMode === "pnl" ? "on" : ""} onClick={() => setRowMode("pnl")} aria-pressed={rowMode === "pnl"}>By P&amp;L line</button>
              <button type="button" className={rowMode === "vendor" ? "on" : ""} onClick={() => setRowMode("vendor")} aria-pressed={rowMode === "vendor"}>By vendor</button>
            </span>
          </div>
        )}
        {rowMode === "pnl" && (
          <div className="kpi-p-tbl-tbg" role="group" aria-label="Show filter">
            <span className="kpi-p-tbl-tblab">Show</span>
            <span className="kpi-p-tbl-seg">
              <button type="button" className={showFilter === "all" ? "on" : ""} onClick={() => setShowFilter("all")} aria-pressed={showFilter === "all"}>All</button>
              <button type="button" className={showFilter === "bills" ? "on" : ""} onClick={() => setShowFilter("bills")} aria-pressed={showFilter === "bills"}>Bills only</button>
              <button type="button" className={showFilter === "cards" ? "on" : ""} onClick={() => setShowFilter("cards")} aria-pressed={showFilter === "cards"}>Cards only</button>
            </span>
          </div>
        )}
      </div>

      {sourceSplitPending && (
        <div className="kpi-p-tbl-notice" role="status">Loading source-split data&hellip;</div>
      )}

      <div className="kpi-p-tbl-scroll">
        <table className="kpi-p-tbl">
          <thead>
            <tr>
              <th className="kpi-p-tbl-lcol">
                {rowMode === "vendor" ? "Vendor" : (tier === "C" ? "Period" : "Week starting")}
              </th>
              {COLUMNS.map(c => (
                <th key={c.key}>{c.label}<span className="kpi-p-tbl-hsub">{c.sub}</span></th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {/* R15 F - By vendor rows: one row per vendor, columns are
                the same five P&L splits.  Card charges are not vendor-
                keyed (no vendor_id on rippling_spend), so vendor mode
                shows only bill.com spend - the mode note in the header
                already sets that expectation. */}
            {rowMode === "vendor" ? (
              <VendorRows rows={vendorRollup?.rows || []} isAggregate={isAggregate} />
            ) : tier === "C" ? (
              bands.map(({ period, weeks: bandWeeks, cell }) => {
                const open = expandedPeriods.has(period.period_no);
                return (
                  <FragmentBand
                    key={`p-${period.period_no}`}
                    period={period}
                    bandCell={cell}
                    bandWeeks={bandWeeks}
                    open={open}
                    onToggle={() => togglePeriod(period.period_no, period.start, period.end)}
                    expandedWeeks={expandedWeeks}
                    cellsByWeek={cellsByWeek}
                    renderWeekRow={renderWeekRow}
                    drillState={drillState}
                    isAggregate={isAggregate}
                    showFilter={showFilter}
                    columns={COLUMNS}
                    columnFor={columnFor}
                  />
                );
              })
            ) : (
              weeks.map((wIso, i) => {
                const cell = cellsByWeek.get(wIso) || makeEmptyCell(COLUMNS);
                const weekEnd = weeks[i + 1] ? isoMinus1(weeks[i + 1]) : end;
                const open = expandedWeeks.has(wIso);
                const key = `${wIso}|${weekEnd}`;
                return (
                  <Fragment key={`wk-${wIso}`}>
                    {renderWeekRow(wIso, weekEnd, cell)}
                    {open && (
                      <BillRows
                        scopeKey={key}
                        drillState={drillState}
                        isAggregate={isAggregate}
                        showFilter={showFilter}
                        columns={COLUMNS}
                        columnFor={columnFor}
                      />
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="kpi-p-tbl-total">
              <td>
                Range total
                {" "}<HelpPop id="qDrillTableFooter" title="Range total" body={
                  <>
                    Always the full range total, even when the SHOW
                    filter above narrows to bills only or cards only.
                    <br /><br />
                    <b>The footer must equal the bucket card heroes</b>
                    on the same range, and those heroes always count
                    bill.com and coded cards together. Filtering
                    changes which rows show; it does NOT re-scope this
                    total.
                    <span className="kpi-hs-pop-foot">
                      A filtered footer that changed with the filter
                      would break the one-source rule (§9B) and let
                      the table quietly disagree with the cards above.
                    </span>
                  </>
                } />
                {showFilterActive && rowMode === "pnl" && (
                  <span className="kpi-p-tbl-weeksub">
                    {showFilter === "bills" ? "bill.com only" : "cards only"}
                  </span>
                )}
                {rowMode === "vendor" && (
                  <span className="kpi-p-tbl-weeksub">bill.com only · card charges excluded</span>
                )}
              </td>
              {COLUMNS.map(c => (
                <Cell key={c.key} value={(rowMode === "vendor" ? vendorFootTotals : footTotals)[c.key]} isFooter />
              ))}
              <Cell value={(rowMode === "vendor" ? vendorFootTotals : footTotals).total} isFooter />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function FragmentBand({
  period,
  bandCell,
  bandWeeks,
  open,
  onToggle,
  expandedWeeks,
  cellsByWeek,
  renderWeekRow,
  drillState,
  isAggregate,
  showFilter,
  columns,
  columnFor,
}) {
  const runFlag = period.running ? "in progress" : period.finished ? "closed" : "not started";
  return (
    <>
      <tr className={`kpi-p-tbl-band ${open ? "kpi-p-tbl-band-open" : ""}`}>
        <td>
          <button
            type="button"
            className="kpi-p-tbl-bandbtn"
            onClick={onToggle}
            aria-expanded={open ? "true" : "false"}
          >
            <span className="kpi-p-tbl-chev">{open ? "⌄" : "›"}</span>
            <span className="kpi-p-tbl-bandlbl">{`PERIOD ${period.period_no}`}</span>
            <span className="kpi-p-tbl-bandsub">{`${bandWeeks.length} wk${bandWeeks.length === 1 ? "" : "s"} · ${runFlag}`}</span>
          </button>
        </td>
        {columns.map(c => (<Cell key={c.key} value={bandCell[c.key]} />))}
        <Cell value={bandCell.total} isFooter />
      </tr>
      {open && bandWeeks.map((wIso, i) => {
        const emptyCell = {};
        for (const cc of columns) emptyCell[cc.key] = 0;
        emptyCell.total = 0;
        const cell = cellsByWeek.get(wIso) || emptyCell;
        const weekEnd = bandWeeks[i + 1] ? isoMinus1(bandWeeks[i + 1]) : period.end;
        const open2 = expandedWeeks.has(wIso);
        const key = `${wIso}|${weekEnd}`;
        return (
          <Fragment key={`bwk-${wIso}`}>
            {renderWeekRow(wIso, weekEnd, cell)}
            {open2 && (
              <BillRows
                scopeKey={key}
                drillState={drillState}
                isAggregate={isAggregate}
                showFilter={showFilter}
                columns={COLUMNS}
                columnFor={columnFor}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function isoMinus1(iso) {
  const t = new Date(iso + "T00:00:00Z").getTime();
  return new Date(t - 86400000).toISOString().slice(0, 10);
}

// R15 F - By vendor row body.  One row per vendor, sorted server-side
// by |spend| desc.  Same five P&L columns as the P&L row mode; the
// footer sums vendor gl_split for a per-column total.  Unresolved
// vendor ids (rare after the resolve view) render as an em-dash label.
function VendorRows({ rows, isAggregate }) {
  if (!rows || rows.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="kpi-p-tbl-notice">
          No vendor bills in this range.
        </td>
      </tr>
    );
  }
  return rows.map((v, i) => {
    const g = v.gl_split || {};
    return (
      <tr key={v.vendor_id || `unresolved-${i}`} className="kpi-p-tbl-vendorrow">
        <td>
          <span className="kpi-p-tbl-vendorname">{v.name || "—"}</span>
          <span className="kpi-p-tbl-weeksub">
            {v.line_count} line{v.line_count === 1 ? "" : "s"}
            {v.resolved ? "" : " · unresolved id"}
          </span>
        </td>
        <Cell value={g.food} />
        <Cell value={g.packaging} />
        <Cell value={g.vehicle} />
        <Cell value={g.equipment} />
        <Cell value={g.repair} />
        <Cell value={v.spend} isFooter />
      </tr>
    );
  });
}
