"use client";
// src/app/kpi/overview/components/CostLines.js
//
// PR-2 items 5-8 (Kevin, 2026-09-02). The new primary surface. The
// four cost lines were on no board at all before this - Vehicle
// running 87.7% over its target was invisible. Table sits in the
// left column below the chart.
//
// Columns:
//   Line · Spent period to date · Budget at this revenue
//        · % of rev · Target % · vs target (pt gap over $ delta)
//
// Rows are clickable. Labor (3100) navigates to /kpi/labor; food,
// packaging and vehicle (3200/3400/3500) navigate to /kpi/purchasing.
// Both carry account, start, end, preview (item 6). Every row
// navigates - billed-back and inactive rows too. A row that renders
// is a row that clicks (Kevin's rule).
//
// Meter per row: fill = actual / max(actual, batr); dark notch at
// batr; second grey notch at period_budget only on open ranges
// (item 7). On a closed period the two coincide and a doubled notch
// is noise.
//
// Sum-to-total agreement (item 8): the rows must sum to the total
// row on every range, to the cent. Permanent probe with seed axis
// covers this - Kevin's first render failed exactly here.

import Link from "next/link";
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
function gapDollars(delta, goodWord, badWord) {
  const abs = fmtMoney(Math.abs(delta));
  return `${abs} ${delta <= 0 ? goodWord : badWord}`;
}

// Build the destination href for a cost line. Mirrors the carry set
// buildSectionHref uses (account, start, end, preview) so a
// preview-mode operator clicking a cost row stays in preview on the
// destination board.
function rowHref({ lineCode, filters, previewAccount }) {
  const params = new URLSearchParams();
  if (filters?.account) params.set("account", filters.account);
  if (filters?.range?.start) params.set("start", filters.range.start);
  if (filters?.range?.end) params.set("end", filters.range.end);
  if (previewAccount) params.set("preview", previewAccount);
  const base = lineCode === "3100" ? "/kpi/labor" : "/kpi/purchasing";
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// Meter per line. Fill green when at or under, red when over.
// Dark notch at budget-at-this-revenue; second grey notch at
// period_budget (open range only) since on a closed period btr and
// period_budget coincide.
function Meter({ actual, batr, periodBudget, isOpenRange, over }) {
  const maxVal = Math.max(actual || 0, batr || 0, periodBudget || 0, 1);
  const fillPct = actual != null ? Math.min(100, (actual / maxVal) * 100) : 0;
  const batrPct = batr != null ? Math.min(100, (batr / maxVal) * 100) : null;
  const pdPct = (isOpenRange && periodBudget != null) ? Math.min(100, (periodBudget / maxVal) * 100) : null;
  const fillColor = over ? "var(--red-500)" : "var(--green-500)";
  return (
    <div className="kpi-ov-meter" data-kpi-ov="cost-line-meter">
      <i style={{ width: `${fillPct}%`, background: fillColor }} aria-hidden="true" />
      {batrPct != null && (
        <span className="kpi-ov-meter-tk" style={{ left: `${batrPct}%` }} aria-hidden="true" />
      )}
      {pdPct != null && (
        <span className="kpi-ov-meter-tk kpi-ov-meter-tk-pd" style={{ left: `${pdPct}%` }} aria-hidden="true" />
      )}
    </div>
  );
}

function CostRow({ row, hasTarget, isOpenRange, filters, previewAccount, revBudFull }) {
  const href = rowHref({ lineCode: row.line_code, filters, previewAccount });
  const isBilledBack = Array.isArray(row.flags) && row.flags.includes("billed_back");
  const isInactive = Array.isArray(row.flags) && row.flags.includes("inactive");
  const actualPctText = fmtPct(row.actual_pct);
  const targetPctText = fmtPct(row.target_pct);
  const batrText = fmtMoney(row.budget_at_this_revenue);
  const actualText = fmtMoney(row.actual);
  // vs target cell (Kevin, 2026-09-02): percent-point gap on top,
  // dollar VARIANCE beneath - actual vs budget-to-date, matching
  // the sign of variance_pct. Earlier I was rendering
  // -envelope_delta here, which is a different concept (budget-to-
  // date vs budget-at-this-revenue) and produced "under on percent,
  // over in dollars" on the same row. envelope_delta belongs on
  // the COGS card only; per-row this cell shows how much the LINE
  // spent vs its own budget-to-date.
  const suppressVerdict = isBilledBack || isInactive || !hasTarget;
  const over = row.variance != null && row.variance > 0;
  const varPctText = row.variance_pct != null
    ? `${Math.abs(Number(row.variance_pct)).toFixed(1)}% ${row.variance_pct <= 0 ? "under" : "over"}`
    : null;
  const varianceText = row.variance != null
    ? gapDollars(row.variance, "under", "over")
    : null;

  return (
    <tr
      className="kpi-ov-cl-row"
      data-kpi-ov="cost-line-row"
      data-kpi-ov-line-code={row.line_code}
      data-kpi-ov-billed-back={isBilledBack ? "1" : undefined}
      data-kpi-ov-inactive={isInactive ? "1" : undefined}
    >
      <td className="l kpi-ov-cl-line">
        <Link
          href={href}
          className="kpi-ov-cl-linkarea"
          data-kpi-ov="cost-line-link"
          aria-label={`Open ${row.label} detail`}
        >
          <span className="kpi-ov-glc kpi-ov-num">{row.line_code}</span>
          <span className="kpi-ov-cl-lbl">{row.label}</span>
          <span className="kpi-ov-cl-go" aria-hidden="true">→</span>
        </Link>
        <Meter
          actual={row.actual}
          batr={row.budget_at_this_revenue}
          periodBudget={row.period_budget}
          isOpenRange={isOpenRange}
          over={over}
        />
      </td>
      <td className="kpi-ov-num">
        {actualText != null ? actualText : <span className="kpi-ov-nb">—</span>}
      </td>
      <td className="kpi-ov-num kpi-ov-nb">
        {isBilledBack ? <span className="kpi-ov-chip-fixed">billed back</span>
          : isInactive ? <span className="kpi-ov-notactive">not active</span>
          : batrText != null ? batrText : "—"}
      </td>
      <td className={`kpi-ov-num ${suppressVerdict ? "" : (over ? "kpi-ov-bad" : "kpi-ov-good")}`}>
        {isBilledBack || isInactive ? <span className="kpi-ov-nb">—</span>
          : actualPctText != null ? actualPctText : <span className="kpi-ov-nb">—</span>}
      </td>
      <td className="kpi-ov-num kpi-ov-nb">
        {suppressVerdict ? "—" : (targetPctText != null ? targetPctText : "—")}
      </td>
      <td className={`kpi-ov-num kpi-ov-cl-vs ${suppressVerdict ? "kpi-ov-nb" : (over ? "kpi-ov-bad" : "kpi-ov-good")}`}>
        {suppressVerdict ? (
          <span className="kpi-ov-nb">—</span>
        ) : (
          <>
            <div className="kpi-ov-cl-vs-pct">{varPctText || "—"}</div>
            <div className="kpi-ov-cl-vs-usd">{varianceText || ""}</div>
          </>
        )}
      </td>
    </tr>
  );
}

// Total row (item 8 - the load-bearing check). Sums the SCORED
// visible rows client-side so the total reads the same numbers the
// operator sees on screen. Rows tagged billed_back or inactive
// carry null btd/batr - they're excluded from the visible-row sum
// so the total must exclude them too. Server-side
// statement_totals.cogs.{budget_to_date, budget_at_this_revenue}
// include the full-line sum for card-level math; those totals
// don't drive this row.
//
// actual: even suppressed rows show a $ value (billed_back rows can
// have $37 packaging etc.), so total.actual sums ALL rows.
function TotalRow({ rows, hasTarget, cogsCard }) {
  const isSuppressed = (r) => {
    const flags = Array.isArray(r.flags) ? r.flags : [];
    return flags.includes("billed_back") || flags.includes("inactive");
  };
  // Sum SCORED-row actuals + budget-to-date so the total's dollar
  // variance is (scored_actual - scored_btd). Same rule as the per-
  // row cell: variance = actual - budget_to_date, positive = over.
  // envelope_delta (btd - batr) is a card-level concept and lives on
  // the COGS card, not here.
  let sumActualScored = 0;
  let sumActualAll = 0;
  let sumBtd = 0;
  let sumBatr = 0;
  for (const r of rows) {
    if (r.actual != null) sumActualAll += Number(r.actual);
    if (!isSuppressed(r)) {
      if (r.actual != null) sumActualScored += Number(r.actual);
      if (r.budget_to_date != null) sumBtd += Number(r.budget_to_date);
      if (r.budget_at_this_revenue != null) sumBatr += Number(r.budget_at_this_revenue);
    }
  }
  const totalActual = fmtMoney(sumActualAll);
  const totalBatr = sumBatr > 0 ? fmtMoney(sumBatr) : null;
  const totalVariance = sumBtd > 0 ? sumActualScored - sumBtd : null;
  const cogsPct = cogsCard?.pct_of_revenue;
  const cogsTargetPct = cogsCard?.target_pct_of_revenue;
  const varPct = (cogsPct != null && cogsTargetPct != null) ? (cogsPct - cogsTargetPct) : null;
  const over = totalVariance != null && totalVariance > 0;
  const varPctText = varPct != null
    ? `${Math.abs(varPct).toFixed(1)}% ${varPct <= 0 ? "under" : "over"}`
    : null;
  const varianceText = totalVariance != null ? gapDollars(totalVariance, "under", "over") : null;
  return (
    <tr className="kpi-ov-cl-tot" data-kpi-ov="cost-lines-total">
      <td className="l">Total cost of goods sold</td>
      <td className="kpi-ov-num">{totalActual || "—"}</td>
      <td className="kpi-ov-num kpi-ov-nb">{hasTarget && totalBatr ? totalBatr : "—"}</td>
      <td className={`kpi-ov-num ${hasTarget ? (over ? "kpi-ov-bad" : "kpi-ov-good") : ""}`}>
        {fmtPct(cogsPct) || "—"}
      </td>
      <td className="kpi-ov-num kpi-ov-nb">{hasTarget ? (fmtPct(cogsTargetPct) || "—") : "—"}</td>
      <td className={`kpi-ov-num kpi-ov-cl-vs ${hasTarget ? (over ? "kpi-ov-bad" : "kpi-ov-good") : "kpi-ov-nb"}`}>
        {hasTarget ? (
          <>
            <div className="kpi-ov-cl-vs-pct">{varPctText || "—"}</div>
            <div className="kpi-ov-cl-vs-usd">{varianceText || ""}</div>
          </>
        ) : "—"}
      </td>
    </tr>
  );
}

export default function CostLines({ payload, previewAccount = null }) {
  if (!payload?.statement_rows) return null;
  const filters = payload.filters;
  const hasTarget = !!payload.has_target;
  const isOpenRange = payload.period_state === "open";
  const cogsRows = payload.statement_rows
    .filter(r => r.section === "cogs" && !r.parent_line_code)
    .sort((a, b) => Number(a.line_code) - Number(b.line_code));
  if (cogsRows.length === 0) return null;
  const cogsCard = payload.cards?.find(c => c.key === "cogs");
  // Header "N of M over" counts LINES over their own budget (variance
  // > 0) - matches the sign of what the vs-target cell shows on each
  // row. Prior version counted envelope_delta < 0, which is a card-
  // level concept and disagreed with the per-row verdict.
  const overCount = cogsRows.filter(r =>
    r.variance != null && r.variance > 0
    && !(Array.isArray(r.flags) && (r.flags.includes("billed_back") || r.flags.includes("inactive")))
  ).length;

  return (
    <div
      className={`kpi-ov-card ${overCount > 0 ? "kpi-ov-card-cost-over" : "kpi-ov-card-cost-under"} kpi-ov-mt`}
      data-kpi-ov="cost-lines"
    >
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Where the money is going</span>
        <span className="kpi-ov-gl">click a line to open it</span>
        <HelpPop
          id="overview-cost-lines"
          title="Cost lines"
          body={
            <p>
              Each line as a percent of revenue against its budget percent.
              The target percent is the budgeted line as a share of budgeted
              revenue - it does not move when revenue moves. Budget at this
              revenue is what that percent buys at the revenue you have
              actually made.
            </p>
          }
        />
        <span className={`kpi-ov-pill ${overCount > 0 ? "kpi-ov-pill-bad" : "kpi-ov-pill-good"}`} data-kpi-ov="cost-lines-pill">
          {overCount > 0 ? `${overCount} of ${cogsRows.length} over` : "all under"}
        </span>
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-cl" data-kpi-ov="cost-lines-table">
          <thead>
            <tr>
              <th className="l">Line</th>
              <th>Spent period to date</th>
              <th>Budget at this revenue</th>
              <th style={{ width: 68 }}>% of rev</th>
              <th style={{ width: 68 }}>Target %</th>
              <th style={{ width: 108 }}>vs target</th>
            </tr>
          </thead>
          <tbody>
            {cogsRows.map(r => (
              <CostRow
                key={r.line_code}
                row={r}
                hasTarget={hasTarget}
                isOpenRange={isOpenRange}
                filters={filters}
                previewAccount={previewAccount}
                revBudFull={payload.statement_totals?.revenue?.period_budget}
              />
            ))}
            <TotalRow rows={cogsRows} hasTarget={hasTarget} cogsCard={cogsCard} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
