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

// Kevin 2026-09-02 language pass: labels come from payload.range_labels
// (the server-side helper). PR-B item 1 (2026-09-03) added the
// `actuals` field to distinguish "Final P8" (single_closed) from
// "thru P8" (FYTD) - use it verbatim, uppercase-first for the header.
function labelPtd(rangeLabels, periodState) {
  const actuals = rangeLabels?.actuals || rangeLabels?.through || "period to date";
  return actuals.charAt(0).toUpperCase() + actuals.slice(1);
}

function labelBudget(rangeLabels, rng) {
  const last = rangeLabels?.period_last;
  if (last) return `${last} budget`;
  return "Period budget";
}

function Row({ row, totalRevenue, showBudgetToDate, showPeriodBudget }) {
  const isInactive = Array.isArray(row.flags) && row.flags.includes("inactive");
  const isScAbsent = Array.isArray(row.flags) && row.flags.includes("sc_counts_without_dollars");
  const actualPct = row.reported && totalRevenue ? (row.actual / totalRevenue) * 100 : null;
  // Kevin ruling final-presentation (2026-09-03) item 3: plan cells
  // carry the band class from header through total. Sub-header on
  // revenue reads "Forecast" (single plan col); actual sub-headers
  // "Received" + "% of rev".
  const notReportedText = <span className="kpi-ov-nb kpi-ov-not-reported">not reported</span>;
  return (
    <tr data-kpi-ov="revenue-line-row" data-kpi-ov-line-code={row.line_code}>
      <td className="l">
        <span className="kpi-ov-glc kpi-ov-num">{row.line_code}</span>
        <span className="kpi-ov-cl-lbl">{row.label}</span>
      </td>
      {showBudgetToDate && (
        <td className="kpi-ov-num kpi-ov-nb plan plan-first plan-last">
          {isInactive ? "—" : (row.budget_to_date != null ? fmtMoney(row.budget_to_date) : "—")}
        </td>
      )}
      {showPeriodBudget && (
        <td className="kpi-ov-num kpi-ov-nb plan plan-first plan-last">
          {isInactive ? "—" : (row.period_budget != null ? fmtMoney(row.period_budget) : "—")}
        </td>
      )}
      <td className="kpi-ov-num">
        {isInactive ? <span className="kpi-ov-notactive">not active</span>
          : isScAbsent ? <span className="kpi-ov-nb">—</span>
          : row.reported ? fmtMoney(row.actual)
          : notReportedText}
      </td>
      <td className="kpi-ov-num kpi-ov-nb">
        {isInactive || actualPct == null ? "—" : fmtPct(actualPct)}
      </td>
    </tr>
  );
}

export default function RevenueLines({ payload }) {
  if (!payload?.statement_rows) return null;
  // Kevin 2026-09-02 language pass Item 16: hide inactive lines
  // entirely. A service the account does not run (no data + no
  // budget) is removed from the table, not rendered as "not active".
  // On TBJ - FL this removes 2400.2 (Meal service (away)). The
  // resolver already sets flags:["inactive"] on such rows - we just
  // filter them out here. sc_counts_without_dollars stays (it's an
  // absence-of-data on an ACTIVE line, still worth showing).
  const rows = payload.statement_rows.filter(r => {
    if (r.section !== "revenue") return false;
    const flags = Array.isArray(r.flags) ? r.flags : [];
    if (flags.includes("inactive")) return false;
    return true;
  });
  if (rows.length === 0) return null;
  const totalRevenue = payload.cards?.find(c => c.key === "revenue")?.hero_actual;
  // Kevin ruling final-presentation (2026-09-03) item 5: unreported
  // lines must not contribute to the totals. On TBJ - FL P9, service
  // charges are unreported (SC counts not yet entered / not yet
  // rolled up); the total must be the meal-service figure alone, NOT
  // meal-service actual plus a forecast for a line the table just
  // told the operator has not landed. Sum the FORECAST + PERIOD
  // BUDGET across reported rows only. Actual already comes from the
  // revenue card's hero_actual, which the resolver derives from
  // reported actuals.
  const revBudTd = rows.reduce((acc, r) => acc + (r.reported && r.budget_to_date != null ? Number(r.budget_to_date) : 0), 0);
  const revBudFull = rows.reduce((acc, r) => acc + (r.reported && r.period_budget != null ? Number(r.period_budget) : 0), 0);
  const anyReportedBudTd = rows.some(r => r.reported && r.budget_to_date != null);
  const anyReportedBudFull = rows.some(r => r.reported && r.period_budget != null);
  const rangeKind = payload.range?.kind;
  const rng = payload.range;
  const periodState = payload.period_state;
  const isRevPlanned = payload.revenue_source_state === "planned";
  // Kevin 2026-09-02 blocker Item 2: on a range containing more than
  // one kind of period the LIVE / VERIFIED / PLANNED pill lied - it
  // named the SINGLE source picker for the range but never disclosed
  // that eight of nine periods were verified while one was live.
  // range_composition is the single source of truth; render its
  // counts. Bare LIVE only survives on a range whose EVERY period is
  // live; bare VERIFIED only on a range whose every period is verified.
  // Kevin 2026-09-02 PR-1 of language pass: FYTD is now closed-only,
  // so range_composition on FYTD reads verified=N with live=0 and
  // planned=0 - a single-kind multi-period range. Kevin's ruling:
  // "The pill reads `8 verified`". So the composition pill fires on
  // every multi-period range regardless of kind mix; only true
  // single-period ranges (periods_total===1) fall through to the
  // bare "Verified" / "Live" / "Planned" pill.
  const rc = payload.range_composition;
  const compositionPill = (() => {
    if (!rc || rc.periods_total <= 1) return null;
    const parts = [];
    if (rc.verified.count) parts.push(`${rc.verified.count} verified`);
    if (rc.live.count) parts.push(`${rc.live.count} live`);
    if (rc.planned.count) parts.push(`${rc.planned.count} planned`);
    if (parts.length === 0) return null;
    return parts.join(" · ");
  })();
  const flatPill = isRevPlanned ? "Planned" : (periodState === "verified" ? "Verified" : "Live");
  const pillText = compositionPill || flatPill;
  const pillToneCls = compositionPill
    ? "kpi-ov-pill-neutral"
    : (isRevPlanned ? "kpi-ov-pill-neutral" : "kpi-ov-pill-good");
  // Item 11: on a closed period btd equals period_budget - collapse
  // to one budget column. Open single-period ranges show both btd
  // and the period budget.
  //
  // 2026-09-02 (Kevin): on FYTD the "Year budget" column previously
  // shown here was the SUM of period_budget across periods in range
  // (P1-P9 on FYTD) - not the full-year budget the CARD displays
  // as "Year budget". Two figures labelled the same on one screen,
  // and the card's % recognised was derived from this table's
  // figure. Drop the column on FYTD entirely - the card carries
  // year budget with its % recognised now; the table stays honest
  // with just budget-to-date + % of rev.
  // Kevin 2026-09-02 language pass Item 17: "Budget thru P8" column
  // renders on FYTD as well as open ranges. FYTD is now closed-only
  // and its budget-to-date sum equals the period-budget sum, but the
  // column is still a meaningful "Budget thru P8" comparison Kevin
  // wants visible.
  const showBudgetToDate = periodState !== "verified" || rangeKind === "fytd";
  const showPeriodBudget = rangeKind !== "fytd";
  const rangeLabels = payload.range_labels;
  const ptdLabel = labelPtd(rangeLabels, periodState);
  const pdLabel = labelBudget(rangeLabels, rng);
  // Item 17: "Budget to date" -> "Budget thru P8" (or "Budget period
  // to date" on single-open).
  const budgetToDateLabel = rangeLabels?.through
    ? `Budget ${rangeLabels.through}`
    : "Budget to date";

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
              Lines the account does not run are omitted.
            </p>
          }
        />
        <span
          className={`kpi-ov-pill ${pillToneCls}`}
          data-kpi-ov="revenue-lines-pill"
        >
          {pillText}
        </span>
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-revlines kpi-ov-tband" data-kpi-ov="revenue-lines-table">
          <thead>
            {/* Kevin ruling final-presentation (2026-09-03) item 3:
                Plan / Actual band. Group header on the band; sub-
                header "Forecast" on the plan side (not "Actual" -
                that would stack with the actual sub-header and read
                ACTUAL / ACTUAL). Actual sub-headers: "Received" +
                "% of rev". */}
            <tr className="kpi-ov-tband-grp" data-kpi-ov="tband-group">
              <th className="l"></th>
              {(showBudgetToDate || showPeriodBudget) && (
                <th
                  colSpan={(showBudgetToDate ? 1 : 0) + (showPeriodBudget ? 1 : 0)}
                  className="plan plan-first plan-last kpi-ov-tband-plan"
                >
                  Plan
                </th>
              )}
              <th colSpan={2} className="kpi-ov-tband-act">Actual</th>
            </tr>
            <tr>
              <th className="l">Line</th>
              {showBudgetToDate && (
                <th className={`plan plan-first ${showPeriodBudget ? "" : "plan-last"}`}>Forecast</th>
              )}
              {showPeriodBudget && (
                <th className={`plan plan-last ${showBudgetToDate ? "" : "plan-first"}`}>{pdLabel}</th>
              )}
              <th>Received</th>
              <th style={{ width: 60 }}>% of rev</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <Row
                key={r.line_code}
                row={r}
                totalRevenue={totalRevenue}
                showBudgetToDate={showBudgetToDate}
                showPeriodBudget={showPeriodBudget}
              />
            ))}
            <tr className="kpi-ov-cl-tot" data-kpi-ov="revenue-lines-total">
              <td className="l">Total revenue</td>
              {showBudgetToDate && (
                <td className={`kpi-ov-num kpi-ov-nb plan plan-first ${showPeriodBudget ? "" : "plan-last"}`}>
                  {anyReportedBudTd ? fmtMoney(revBudTd) : "—"}
                </td>
              )}
              {showPeriodBudget && (
                <td className={`kpi-ov-num kpi-ov-nb plan plan-last ${showBudgetToDate ? "" : "plan-first"}`}>
                  {anyReportedBudFull ? fmtMoney(revBudFull) : "—"}
                </td>
              )}
              <td className="kpi-ov-num">
                {totalRevenue != null ? fmtMoney(totalRevenue) : <span className="kpi-ov-nb">—</span>}
              </td>
              <td className="kpi-ov-num kpi-ov-nb">{totalRevenue != null ? "100%" : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
