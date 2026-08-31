"use client";
// src/app/kpi/overview/components/PnlStatement.js
//
// Element 8. Full profit and loss, collapsed by default; opens on
// Summary, Full one click. Per §5.4 anatomy 8 + R-27.
//
// Payload contract: statement_rows[] with { line_code, section,
// label, reported, actual, budget_to_date, period_budget, variance,
// variance_pct, sources, flags[] }.
//
// Dash-vs-zero cells:
//   - reported=false + actual null       -> "-" (missing)
//   - actual != null + budget null       -> "no budget" in budget cell
//   - reported=true + actual=0 + bt=0    -> "not active" spanning
//   - fee-account 2400.1 flag=contractual -> "contractual" chip
//
// Numbers arrive from the resolver; the client only picks a cell state
// and renders. `formatMoneyWhole` is called via helper for consistency
// but the resolver already ships display-friendly numbers via
// cards + levers - we format statement_rows locally because the
// resolver ships them as raw numbers per statement_rows contract.

import { useState } from "react";
import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return null;
  const abs = Math.abs(Math.round(Number(n)));
  const s = "$" + abs.toLocaleString("en-US");
  return n < 0 ? "-" + s : s;
}

// Render one statement row. Cells mirror the prototype layout:
//   Line | [Period budget] [Budget to date] Actual to date
//        | Variance | Actual % | Target %
// The three-column budget span (Period budget · Budget to date · Actual
// to date) is R-25/R-26 vocabulary. Closed periods drop Period budget.
//
// **Actual % / Target % on statement rows:** the resolver ships raw
// `actual_pct` / `target_pct` per statement row (engine follow-up PR
// #919 added these to revenue rows; levers[] carries the COGS pcts).
// This client formats absence per the dash-vs-zero contract:
//   - null                           -> DashOrValue missing (dash)
//   - 0                              -> "0.0%"
//   - number                         -> "N.N%"
// Sub-line rows (3100.1 / 3100.2 salary reveal, per Phase 4 R-28)
// carry `parent_line_code` and render indented under their parent
// with no pct cells (totals are always the 3100 aggregate).
function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n).toFixed(1) + "%";
}

function StatementRow({ row, isOpen, leverPctByLine, indent = false }) {
  const isFee = Array.isArray(row.flags) && row.flags.includes("contractual");
  const isPassThrough = Array.isArray(row.flags) && row.flags.includes("pass_through");
  const isPackagingGap = Array.isArray(row.flags) && row.flags.includes("packaging_gap");
  const isSubLine = !!row.parent_line_code;

  const actual = row.actual;
  const bt = row.budget_to_date;
  const pb = row.period_budget;

  // Both nullish + reported false -> not active
  const notActive = (actual == null || actual === 0) && (bt == null || bt === 0) && (pb == null || pb === 0) && !row.reported;

  // Per-line pct comes from the row itself when the resolver ships it
  // (revenue rows since #919 + lever rows always). Fall back to
  // leverPctByLine for legacy paths where a row omits the pct fields.
  const leverPct = leverPctByLine[row.line_code];
  const rowActualPct = row.actual_pct != null ? row.actual_pct : (leverPct?.actual_pct ?? null);
  const rowTargetPct = row.target_pct != null ? row.target_pct : (leverPct?.target_pct ?? null);
  const actualPct = fmtPct(rowActualPct);
  const targetPct = fmtPct(rowTargetPct);

  const trClass = [
    isSubLine ? "sub" : "",
    indent ? "ind" : "",
  ].filter(Boolean).join(" ");

  return (
    <tr data-kpi-ov="statement-row" data-kpi-ov-line-code={row.line_code} data-kpi-ov-sub={isSubLine ? "1" : undefined} className={trClass}>
      <td className="l" style={isSubLine ? { paddingLeft: 24 } : undefined}>
        <span className="kpi-ov-glc kpi-ov-num">{row.line_code}</span>
        {row.label}
        {isFee && (
          <span className="kpi-ov-chip-fixed" style={{ marginLeft: 8 }} data-kpi-ov="chip-contractual">
            contractual
          </span>
        )}
        {isPassThrough && (
          <span className="kpi-ov-chip-fixed" style={{ marginLeft: 8 }} data-kpi-ov="chip-pass-through">
            billed back
          </span>
        )}
        {isPackagingGap && (
          <span className="kpi-ov-chip-absent" style={{ marginLeft: 8 }} data-kpi-ov="chip-mapping-gap">
            mapping gap
          </span>
        )}
      </td>
      {isOpen && (
        <td className="kpi-ov-num kpi-ov-nb">
          {notActive ? <DashOrValue state="not_active" /> : <DashOrValue value={fmtMoney(pb)} reported={pb != null} />}
        </td>
      )}
      <td className="kpi-ov-num">
        {notActive ? <DashOrValue state="not_active" /> : <DashOrValue value={fmtMoney(bt)} reported={bt != null} />}
      </td>
      <td className="kpi-ov-num">
        {notActive ? <DashOrValue state="not_active" /> : <DashOrValue value={fmtMoney(actual)} reported={row.reported} />}
      </td>
      <td className="kpi-ov-num">
        {isFee ? (
          <span className="kpi-ov-chip-fixed">contractual</span>
        ) : row.variance != null ? (
          <span className={row.section === "revenue" ? (row.variance >= 0 ? "kpi-ov-good" : "kpi-ov-bad") : (row.variance <= 0 ? "kpi-ov-good" : "kpi-ov-bad")}>
            {fmtMoney(Math.abs(row.variance))} {row.section === "revenue" ? (row.variance >= 0 ? "above" : "below") : (row.variance <= 0 ? "under" : "over")}
          </span>
        ) : (
          <DashOrValue value={null} reported={false} />
        )}
      </td>
      <td className="kpi-ov-num">
        <DashOrValue value={actualPct} reported={actualPct != null} />
      </td>
      <td className="kpi-ov-num kpi-ov-nb">
        <DashOrValue value={targetPct} reported={targetPct != null} />
      </td>
    </tr>
  );
}

export default function PnlStatement({ payload, open, onToggle }) {
  const [dense, setDense] = useState("sum"); // 'sum' | 'full'

  if (!payload?.statement_rows) return null;

  const rows = payload.statement_rows;
  const isOpen = payload.period_state === "open";
  const revenueRows = rows.filter(r => r.section === "revenue");
  const cogsRows = rows.filter(r => r.section === "cogs");
  const revenueCard = payload.cards?.find(c => c.key === "revenue");
  const cogsCard = payload.cards?.find(c => c.key === "cogs");
  const gmCard = payload.cards?.find(c => c.key === "gross_margin");

  // Build a lookup of pct info from levers[] keyed by line_code so
  // the statement can render Actual % / Target % on the four COGS
  // lines without a client-side computation.
  const leverPctByLine = {};
  (payload.levers || []).forEach(l => {
    leverPctByLine[l.line_code] = l;
  });

  return (
    <>
      <button
        type="button"
        className="kpi-ov-fold"
        data-kpi-ov="fold-pnl"
        onClick={onToggle}
        aria-expanded={open ? "true" : "false"}
      >
        <span className="kpi-ov-eb">Full profit and loss</span>
        <span className="kpi-ov-gl">every line the way finance sees it, with percent of revenue</span>
        <span className="kpi-ov-fold-cv">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="kpi-ov-card kpi-ov-card-cogs kpi-ov-mt" data-kpi-ov="statement">
          <div className="kpi-ov-ch">
            <span className="kpi-ov-eb">Profit and loss</span>
            <span className="kpi-ov-gl">
              {payload.filters?.account} · {payload.range?.start} – {payload.range?.end}
            </span>
            <HelpPop
              id="overview-pnl"
              title="Profit and loss"
              body={<p>The statement the way finance builds it. Percent of revenue is on every line - that is how each cost is judged, not the dollar alone.</p>}
            />
            <span className="kpi-ov-seg">
              <button
                type="button"
                className={dense === "full" ? "on" : ""}
                onClick={() => setDense("full")}
                data-kpi-ov="dense-full"
              >Full</button>
              <button
                type="button"
                className={dense === "sum" ? "on" : ""}
                onClick={() => setDense("sum")}
                data-kpi-ov="dense-sum"
              >Summary</button>
            </span>
          </div>
          <div className="kpi-ov-cb">
            <table className="kpi-ov-stmt">
              <thead>
                <tr>
                  <th className="l">Line</th>
                  {isOpen && <th>Period budget</th>}
                  <th>{isOpen ? "Budget to date" : "Budget"}</th>
                  <th>{isOpen ? "Actual to date" : "Actual"}</th>
                  <th>Variance</th>
                  <th style={{ width: 66 }}>Actual %</th>
                  <th style={{ width: 90 }}>Target %</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sect"><td colSpan={isOpen ? 7 : 6}>Revenue</td></tr>
                {revenueRows
                  .filter(r => dense === "full" || ["2200", "2300", "2400.1"].includes(r.line_code))
                  .map(r => (
                    <StatementRow
                      key={r.line_code}
                      row={r}
                      isOpen={isOpen}
                      leverPctByLine={leverPctByLine}
                      indent={dense === "full" && ["2400.2", "2600"].includes(r.line_code)}
                    />
                  ))}
                {/* Revenue total row */}
                {revenueCard && (
                  <tr className="tot" data-kpi-ov="statement-revenue-total">
                    <td className="l">Total revenue</td>
                    {isOpen && (
                      <td className="kpi-ov-num kpi-ov-nb">
                        <DashOrValue value={revenueCard.budget_full_period_display} reported={revenueCard.budget_full_period != null} />
                      </td>
                    )}
                    <td className="kpi-ov-num">
                      <DashOrValue value={revenueCard.budget_to_date_display} reported={revenueCard.budget_to_date != null} />
                    </td>
                    <td className="kpi-ov-num">
                      <DashOrValue value={revenueCard.hero_actual_display} reported={revenueCard.hero_reported} />
                    </td>
                    <td className="kpi-ov-num">
                      {revenueCard.pill?.label === "Contractual" ? (
                        <span className="kpi-ov-chip-fixed">contractual</span>
                      ) : revenueCard.delta_display ? (
                        <span className={revenueCard.delta_direction === "good" ? "kpi-ov-good" : "kpi-ov-bad"}>
                          {revenueCard.delta_display}
                        </span>
                      ) : (
                        <DashOrValue value={null} reported={false} />
                      )}
                    </td>
                    <td className="kpi-ov-num">100%</td>
                    <td className="kpi-ov-num kpi-ov-nb">100%</td>
                  </tr>
                )}

                <tr className="sect"><td colSpan={isOpen ? 7 : 6}>Cost of goods sold</td></tr>
                {cogsRows
                  /* Sub-line rows (parent_line_code set) render only
                     in Full mode - Summary keeps the four totals
                     line clean. The salary reveal (3100.1 / 3100.2)
                     is a Full-mode disclosure per §5.9 / R-28. */
                  .filter(r => dense === "full" || !r.parent_line_code)
                  .map(r => (
                    <StatementRow
                      key={r.line_code}
                      row={r}
                      isOpen={isOpen}
                      leverPctByLine={leverPctByLine}
                      indent={!!r.parent_line_code}
                    />
                  ))}
                {/* COGS total row */}
                {cogsCard && (
                  <tr className="tot" data-kpi-ov="statement-cogs-total">
                    <td className="l">Total cost of goods sold</td>
                    {isOpen && <td className="kpi-ov-num kpi-ov-nb"><DashOrValue value={null} reported={false} /></td>}
                    <td className="kpi-ov-num">
                      <DashOrValue value={cogsCard.budget_to_date_display} reported={cogsCard.budget_to_date != null} />
                    </td>
                    <td className="kpi-ov-num">
                      <DashOrValue value={cogsCard.hero_actual_display} reported={cogsCard.hero_reported} />
                    </td>
                    <td className={`kpi-ov-num ${cogsCard.delta_direction === "good" ? "kpi-ov-good" : cogsCard.delta_direction === "bad" ? "kpi-ov-bad" : ""}`}>
                      {cogsCard.delta_display || <DashOrValue value={null} reported={false} />}
                    </td>
                    <td className="kpi-ov-num">
                      <DashOrValue value={cogsCard.pct_of_revenue_display} reported={cogsCard.pct_of_revenue != null} />
                    </td>
                    <td className="kpi-ov-num kpi-ov-nb">
                      <DashOrValue value={cogsCard.target_pct_display} reported={cogsCard.target_pct_of_revenue != null} />
                    </td>
                  </tr>
                )}

                {/* Gross margin row */}
                {gmCard && (
                  <tr className="gm" data-kpi-ov="statement-gm-total">
                    <td className="l">Gross margin</td>
                    {isOpen && <td className="kpi-ov-num kpi-ov-nb"><DashOrValue value={null} reported={false} /></td>}
                    <td className="kpi-ov-num">
                      <DashOrValue value={gmCard.budget_to_date_display} reported={gmCard.budget_to_date != null} />
                    </td>
                    <td className="kpi-ov-num">
                      <DashOrValue value={gmCard.hero_actual_display} reported={gmCard.hero_reported} />
                    </td>
                    <td className={`kpi-ov-num ${gmCard.delta_direction === "good" ? "kpi-ov-good" : gmCard.delta_direction === "bad" ? "kpi-ov-bad" : ""}`}>
                      {gmCard.delta_display || <DashOrValue value={null} reported={false} />}
                    </td>
                    <td className="kpi-ov-num">
                      <DashOrValue value={gmCard.pct_of_revenue_display} reported={gmCard.pct_of_revenue != null} />
                    </td>
                    <td className="kpi-ov-num kpi-ov-nb">
                      <DashOrValue value={gmCard.target_pct_display} reported={gmCard.target_pct_of_revenue != null} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="kpi-ov-note">
              <b>Food purchased</b> is what was bought in this range. Finance adjusts food cost for inventory at close, so the closed number can differ.
              {payload.flags?.packaging_gap && (
                <> <b>Packaging on this account has a known mapping gap</b> - our figure is incomplete.</>
              )}
              {payload.flags?.planned && (
                <> <b>Revenue for the open period is planned</b> until this site's meal counts are live in the Service Calendar; closed periods use finance actuals.</>
              )}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
