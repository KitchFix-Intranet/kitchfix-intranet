"use client";
// src/app/kpi/overview/components/RevenueLines.js
//
// PR-2 items 9/11/12 companion. Compact revenue-lines table in the
// right column, beneath the pace panel. Renders every revenue line
// the account runs (2200 catering, 2300 service charges, 2400.1 meal
// service (home), 2400.2 meal service (away), 2600 consulting) with
// its period-to-date actual, its period budget (collapsed to one
// budget column on closed periods per item 11), and its % of revenue.
//
// Payload contract: reads payload.statement_rows where section ===
// "revenue". Server already flags inactive rows (E17), contractual
// on fee accounts, and sc_counts_without_dollars absence (PR-1 item 6).
//
// Vocabulary (item 9): "Period to date" on open ranges,
// "Year to date" on FYTD, "Final" on verified closed periods. Never
// a bare "To date" or "Actual". Header + budget column label
// derived from range shape.

import HelpPop from "@/app/kpi/labor/components/HelpPop";

function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  const abs = Math.abs(Math.round(v));
  const s = "$" + abs.toLocaleString("en-US");
  return v < 0 ? "-" + s : s;
}
function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `${Number(n).toFixed(1)}%`;
}

function labelPtd(rangeKind, periodState) {
  if (rangeKind === "fytd") return "Year to date";
  if (periodState === "verified") return "Final";
  return "Period to date";
}

function labelBudget(rangeKind, rng, periodState) {
  if (rangeKind === "fytd") return "Year budget";
  if (rng?.period_no != null) return `P${rng.period_no} budget`;
  return "Period budget";
}

function Row({ row, totalRevenue, isRevOpen, showBudgetToDate, budgetLabel }) {
  const isContractual = Array.isArray(row.flags) && row.flags.includes("contractual");
  const isInactive = Array.isArray(row.flags) && row.flags.includes("inactive");
  const isScAbsent = Array.isArray(row.flags) && row.flags.includes("sc_counts_without_dollars");
  const actualPct = row.reported && totalRevenue ? (row.actual / totalRevenue) * 100 : null;
  return (
    <tr data-kpi-ov="revenue-line-row" data-kpi-ov-line-code={row.line_code}>
      <td className="l">
        <span className="kpi-ov-glc kpi-ov-num">{row.line_code}</span>
        <span className="kpi-ov-cl-lbl">{row.label}</span>
      </td>
      <td className="kpi-ov-num">
        {isInactive ? <span className="kpi-ov-notactive">not active</span>
          : isScAbsent ? <span className="kpi-ov-nb">—</span>
          : row.reported ? fmtMoney(row.actual)
          : <span className="kpi-ov-nb">—</span>}
      </td>
      {showBudgetToDate && (
        <td className="kpi-ov-num kpi-ov-nb">
          {isInactive ? "—" : (row.budget_to_date != null ? fmtMoney(row.budget_to_date) : "—")}
        </td>
      )}
      <td className="kpi-ov-num kpi-ov-nb">
        {isInactive ? "—" : (row.period_budget != null ? fmtMoney(row.period_budget) : "—")}
      </td>
      <td className="kpi-ov-num kpi-ov-nb">
        {isInactive || actualPct == null ? "—" : fmtPct(actualPct)}
      </td>
    </tr>
  );
}

export default function RevenueLines({ payload }) {
  if (!payload?.statement_rows) return null;
  const rows = payload.statement_rows.filter(r => r.section === "revenue");
  if (rows.length === 0) return null;
  const totalRevenue = payload.cards?.find(c => c.key === "revenue")?.hero_actual;
  const revBudTd = payload.statement_totals?.revenue?.budget_to_date;
  const revBudFull = payload.statement_totals?.revenue?.period_budget;
  const rangeKind = payload.range?.kind;
  const rng = payload.range;
  const periodState = payload.period_state;
  const isRevOpen = periodState === "open";
  const isRevPlanned = payload.revenue_source_state === "planned";
  // Item 11: collapse to one budget column when budget-to-date equals
  // period_budget - true on closed periods (period fully elapsed).
  // FYTD keeps both because the running period changes budget-to-date.
  const showBudgetToDate = periodState !== "verified";
  const ptdLabel = labelPtd(rangeKind, periodState);
  const pdLabel = labelBudget(rangeKind, rng, periodState);

  return (
    <div className="kpi-ov-card kpi-ov-card-rev" data-kpi-ov="revenue-lines">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Revenue lines</span>
        <HelpPop
          id="overview-revenue-lines"
          title="Revenue lines"
          body={
            <p>
              What makes up the revenue figure. Every line is shown against
              its budget, then as a percent of total revenue for this range.
              Lines the account does not run read &ldquo;not active&rdquo;.
            </p>
          }
        />
        <span className={`kpi-ov-pill ${isRevPlanned ? "kpi-ov-pill-neutral" : "kpi-ov-pill-good"}`}>
          {isRevPlanned ? "Planned" : (periodState === "verified" ? "Verified" : "Live")}
        </span>
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-revlines" data-kpi-ov="revenue-lines-table">
          <thead>
            <tr>
              <th className="l">Line</th>
              <th>{ptdLabel}</th>
              {showBudgetToDate && <th>Budget to date</th>}
              <th>{pdLabel}</th>
              <th style={{ width: 60 }}>% of rev</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <Row
                key={r.line_code}
                row={r}
                totalRevenue={totalRevenue}
                isRevOpen={isRevOpen}
                showBudgetToDate={showBudgetToDate}
                budgetLabel={pdLabel}
              />
            ))}
            <tr className="kpi-ov-cl-tot" data-kpi-ov="revenue-lines-total">
              <td className="l">Total revenue</td>
              <td className="kpi-ov-num">
                {totalRevenue != null ? fmtMoney(totalRevenue) : <span className="kpi-ov-nb">—</span>}
              </td>
              {showBudgetToDate && (
                <td className="kpi-ov-num kpi-ov-nb">{revBudTd != null ? fmtMoney(revBudTd) : "—"}</td>
              )}
              <td className="kpi-ov-num kpi-ov-nb">{revBudFull != null ? fmtMoney(revBudFull) : "—"}</td>
              <td className="kpi-ov-num kpi-ov-nb">{totalRevenue != null ? "100%" : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
