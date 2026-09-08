"use client";
// src/app/kpi/overview/components/PnlStatement.js
//
// Kevin ruling final-P&L (2026-09-03). The full P&L renders as three
// zones - Plan · Actual · Variance - not seven flat columns. Plan is
// a banded group (background #F7F9FC, box-shadow ±1px hairlines, NOT
// borders because borders leave gaps between rows and step the band)
// spanning the group header through the gross-margin row. A group
// header row above the sub-header names the zones with a rule
// beneath: grey under Plan and Variance, navy under Actual.
//
// Columns (7):
//   Line · [Budget · Target % · Adjusted*] · [Actual · % of rev] · vs adjusted
//   ─┬─   ─┬─────────────────────────────  ─┬─────────────────  ─┬─
//    l              Plan (banded, 600 n-700)   Actual (800 n-900)  Variance
//
// Cells where a concept does not apply are HATCHED (`.na-cell`),
// per Kevin's ruling over a dash:
//   revenue rows           - Adjusted (revenue is not adjusted by revenue)
//   salary sub-rows        - Target % and Adjusted (not % of revenue)
//   tracked lines          - Target % and Adjusted (not measured on % of rev)
// One absence marker, used consistently. `not active` rows keep their
// italic text.
//
// Item 3 defect: 3100.1 hourly + 3100.2 salary must equal parent
// 3100. Prior sub-rows read pnl_actuals directly while the parent
// came from the labour engine; resolver now sources both sub-rows
// from the same engine (laborActuals + salaryRows) so they sum by
// construction.
//
// Item 6: gross-margin Adjusted is DERIVED as actual revenue -
// adjusted cost. Never hard-coded. Assertion probe verifies
// gross_margin.variance == -cogs.variance to the cent.
//
// Full / Summary toggle:
//   Full     - inactive lines, salary + hourly sub-rows, tracked band
//   Summary  - drops inactive, sub-rows, tracked band
// The two views must never disagree on any figure they both show
// (probe asserts).

import { useState } from "react";
import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

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

// Variance cell renderer. Positive delta means over/above.
// axis="rev": positive = above budget (good). Revenue variance
//             measures actual - budget.
// axis="cost": positive = over adjusted (bad). Cost variance
//             measures actual - adjusted.
// Under a dollar reads "on budget" per Kevin's item 7.
function VarCell({ actual, ref, axis }) {
  if (actual == null || ref == null) {
    return <td className="kpi-ov-pnl-var nb">—</td>;
  }
  const d = actual - ref;
  if (Math.abs(d) < 1) return <td className="kpi-ov-pnl-var nb">on budget</td>;
  const up = d > 0;
  const good = axis === "rev" ? up : !up;
  const arrow = up ? "↑" : "↓";
  const dir = axis === "rev" ? (up ? "above" : "below") : (up ? "over" : "under");
  return (
    <td className={`kpi-ov-pnl-var ${good ? "kpi-ov-good" : "kpi-ov-bad"}`}>
      <span aria-hidden="true">{arrow}</span> {fmtMoney(Math.abs(d))}
      <span className="kpi-ov-sr-only" aria-label={`${fmtMoney(Math.abs(d))} ${dir}`}></span>
    </td>
  );
}

// One-row renderer. Handles line rows, sub-rows, and tracked rows
// via the `variant` prop.
//   variant: "line" | "sub" | "tracked"
// `hatchTarget`, `hatchAdjusted` control the na-cell hatch overlay
// per row (revenue rows hatch Adjusted; salary + tracked hatch both).
// `axis` picks the variance sign convention.
// `refField` picks which field the variance measures against
// ("adjusted" for cost, "budget" for revenue).
function LineRow({
  row,
  variant = "line",
  hatchTarget = false,
  hatchAdjusted = false,
  axis,
  refField,
  totalRevenue,
}) {
  const isInactive = Array.isArray(row.flags) && row.flags.includes("inactive");
  const notApplicable = Array.isArray(row.flags) && row.flags.includes("not_applicable_target_pct");
  const cls = variant === "sub" ? "kpi-ov-pnl-sub" : "";
  if (isInactive) {
    // "not active" applies to every value cell. Italic per Kevin's
    // one-absence-marker rule.
    return (
      <tr className={cls} data-kpi-ov="pnl-line-row" data-kpi-ov-line-code={row.line_code}>
        <td className="l"><span className="kpi-ov-pnl-glc">{row.line_code}</span> {row.label}</td>
        <td className="kpi-ov-num plan plan-first"><span className="kpi-ov-pnl-na">not active</span></td>
        <td className="kpi-ov-num plan"><span className="kpi-ov-pnl-na">not active</span></td>
        <td className="kpi-ov-num plan plan-last"><span className="kpi-ov-pnl-na">not active</span></td>
        <td className="kpi-ov-num"><span className="kpi-ov-pnl-na">not active</span></td>
        <td className="kpi-ov-num"><span className="kpi-ov-pnl-na">not active</span></td>
        <td className="kpi-ov-pnl-var"><span className="kpi-ov-pnl-na">not active</span></td>
      </tr>
    );
  }
  const budgetText = fmtMoney(row.budget_to_date);
  const targetPctText = fmtPct(row.target_pct);
  const adjustedText = fmtMoney(row.budget_at_this_revenue);
  const actualText = fmtMoney(row.actual);
  const actualPct = row.actual_pct != null
    ? row.actual_pct
    : (row.reported && totalRevenue ? (Number(row.actual) / totalRevenue) * 100 : null);
  const refValue = refField === "adjusted" ? row.budget_at_this_revenue : row.budget_to_date;
  const hatchTargetFinal = hatchTarget || notApplicable;
  const hatchAdjustedFinal = hatchAdjusted || notApplicable;
  return (
    <tr className={cls} data-kpi-ov="pnl-line-row" data-kpi-ov-line-code={row.line_code} data-kpi-ov-variant={variant}>
      <td className="l">
        <span className="kpi-ov-pnl-glc">{row.line_code}</span> {row.label}
      </td>
      <td className="kpi-ov-num plan plan-first">
        {budgetText != null ? budgetText : "—"}
      </td>
      <td className={`kpi-ov-num plan ${hatchTargetFinal ? "kpi-ov-pnl-na-cell" : ""}`}>
        {hatchTargetFinal ? "" : (targetPctText != null ? targetPctText : "—")}
      </td>
      <td className={`kpi-ov-num plan plan-last ${hatchAdjustedFinal ? "kpi-ov-pnl-na-cell" : ""}`}>
        {hatchAdjustedFinal ? "" : (adjustedText != null ? adjustedText : "—")}
      </td>
      <td className="kpi-ov-num">
        {row.reported === false
          ? <span className="kpi-ov-pnl-notrep">not reported</span>
          : (actualText != null ? actualText : "—")}
      </td>
      <td className="kpi-ov-num nb">
        {actualPct != null && row.reported !== false ? fmtPct(actualPct) : "—"}
      </td>
      <VarCell actual={row.actual} ref={refValue} axis={axis} />
    </tr>
  );
}

function SectionRow({ label }) {
  return (
    <tr className="kpi-ov-pnl-sect">
      <td className="l">{label}</td>
      <td className="plan plan-first"></td>
      <td className="plan"></td>
      <td className="plan plan-last"></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  );
}

// Kevin CC prompt 2026-09-08 item 6, Guard 2 · isolated running-
// period P&L component. Renders when payload.range.kind === "period"
// && payload.period_state === "open". Path A per Kevin ruling:
// early return in the default export, closed-range PnlStatement body
// entirely untouched.
//
// Grammar matches the cost-lines table's Adjusted-column shape:
//   Line · P{n} plan · Target % · Adjusted · Landed so far · Left to spend
// Variance column dropped - "↓ $57,395" on day 2 is a false shortfall
// that shrinks to nothing as the period runs.
//
// Adjusted derivation (Kevin binding · one number, both places):
//   Cost rows:      projRev × target_pct / 100
//   Total revenue:  projRev
//   2300 fee row:   fee itself (contractual, does not move with vol)
//   2400.1 SC row:  projSC (SC forecast + actual sum, no fee)
//   GM row:         projRev - totalCogsAdjusted
//
// projRev = sum(week_rail.weeks[i].week_revenue). Same figure the
// money table above renders in its envelope row.
function RunningPeriodPnl({ payload, open, onToggle }) {
  const rows = payload?.statement_rows || [];
  const cogsRowsAll = rows.filter(r => r.section === "cogs" && !r.parent_line_code)
    .sort((a, b) => Number(a.line_code) - Number(b.line_code));
  const revenueCard = payload.cards?.find(c => c.key === "revenue");
  const cogsCard = payload.cards?.find(c => c.key === "cogs");
  const totals = payload.statement_totals || {};
  const periodNo = payload.range?.period_no;

  // Envelope inputs derived from week_rail (Kevin's answer to
  // question 2: compute per-line landed from the same source the
  // money table uses; statement_rows is deliberately null on TP).
  const weeks = payload.week_rail?.weeks || [];
  const feePerWeek = Number(weeks[0]?.fee_prorate || 0);
  const feePeriod = feePerWeek * 4;
  const projSC = weeks.reduce((s, w) => s + Number(w.meal_revenue || 0), 0);
  const projRev = projSC + feePeriod;
  const planRev = Number(totals?.revenue?.period_budget || 0);
  const planFeeShare = feePeriod;
  const planSC = planRev - feePeriod;
  const confirmedWeeksCount = revenueCard?.confirmed_weeks_count ?? 0;
  const totalWeeksCount = revenueCard?.total_weeks_count ?? weeks.length ?? 4;
  const scConfirmed = weeks
    .filter(w => w.revenue_basis === "confirmed")
    .reduce((s, w) => s + Number(w.meal_revenue || 0), 0);
  const feeLanded = feePerWeek * confirmedWeeksCount;

  const revenueDelta = projRev - planRev;
  const envToneCls = revenueDelta === 0
    ? "" : revenueDelta > 0 ? "kpi-ov-good" : "kpi-ov-bad";

  // Cost per-line adjusted uses projRev × target_pct / 100. Total
  // adjusted = sum(row adjusted) which by algebra equals projRev ×
  // totalTargetPct / 100 (rounding aside).
  const adjustedFor = (targetPct) => (targetPct != null && projRev > 0)
    ? projRev * (Number(targetPct) / 100)
    : null;
  const totalCogsPlan = cogsRowsAll.reduce((s, r) => s + Number(r.period_budget || 0), 0);
  const totalCogsTargetPct = cogsRowsAll.reduce((s, r) => s + Number(r.target_pct || 0), 0);
  const totalCogsAdjusted = adjustedFor(totalCogsTargetPct);
  const totalCogsLanded = Number(cogsCard?.hero_actual || 0);

  const gmPlanBudget = planRev > 0 ? planRev - totalCogsPlan : null;
  const gmTargetPct = totalCogsTargetPct != null ? 100 - Number(totalCogsTargetPct) : null;
  const gmAdjusted = totalCogsAdjusted != null ? projRev - totalCogsAdjusted : null;

  const planHeader = periodNo != null ? `P${periodNo} plan` : "Period plan";

  return (
    <div
      className={`kpi-ov-card kpi-ov-card-cogs kpi-ov-mt kpi-ov-fold-card${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="statement"
      data-kpi-ov-open={open ? "1" : "0"}
      data-kpi-ov-running="1"
    >
      <button
        type="button"
        className="kpi-ov-fold-trigger"
        data-kpi-ov="fold-pnl"
        onClick={onToggle}
        aria-expanded={open ? "true" : "false"}
      >
        <span className="kpi-ov-eb">Full profit and loss</span>
        <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <div className="kpi-ov-fold-meta">
            <HelpPop
              id="overview-pnl-running"
              title="Profit and loss · running period"
              body={<p>Every line is measured against the revenue this period is projecting, not the original plan. Margin lands when cost does - revenue is confirmed ahead of the week and invoices arrive behind it.</p>}
            />
            <span className="kpi-ov-gl" data-kpi-ov="pnl-scope">
              {payload.filters?.account} · {payload.range_labels?.horizon || `${payload.range?.start} – ${payload.range?.end}`}
            </span>
          </div>
          <div className="kpi-ov-cb">
            <table className="kpi-ov-cl" data-kpi-ov="pnl-running-table">
              <thead>
                <tr>
                  <th className="l">Line</th>
                  <th className="kpi-ov-num">{planHeader}</th>
                  <th className="kpi-ov-num" style={{ width: 68 }}>Target %</th>
                  <th className="kpi-ov-num">Adjusted</th>
                  <th className="kpi-ov-num">Landed so far</th>
                  <th className="kpi-ov-num">Left to spend</th>
                </tr>
              </thead>
              <tbody>
                <tr className="kpi-ov-pnl-grp" data-kpi-ov="pnl-grp-revenue">
                  <td className="l" colSpan={6}>Revenue</td>
                </tr>
                {/* 2300 fee row · Adjusted = fee (contractual, does
                    not move with volume). Landed = fee × confirmed /
                    4. Sub caption names the proration state. */}
                <tr className="kpi-ov-cl-row">
                  <td className="l kpi-ov-cl-line">
                    <span className="kpi-ov-cl-code">2300</span>
                    <span className="kpi-ov-cl-lbl">Service charges</span>
                    <span className="kpi-ov-pnl-sub">prorated · {confirmedWeeksCount}/{totalWeeksCount} wks</span>
                  </td>
                  <td className="kpi-ov-num kpi-ov-nb">{fmtMoney(planFeeShare) || "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">{planRev > 0 ? fmtPct((planFeeShare / planRev) * 100) : "—"}</td>
                  <td className="kpi-ov-num">{fmtMoney(feePeriod) || "—"}</td>
                  <td className="kpi-ov-num">{fmtMoney(feeLanded) || "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">—</td>
                </tr>
                {/* 2400.1 meal-service row · Adjusted = projSC. Landed
                    = confirmed SC sum. Sub caption names the confirm
                    state. */}
                <tr className="kpi-ov-cl-row">
                  <td className="l kpi-ov-cl-line">
                    <span className="kpi-ov-cl-code">2400.1</span>
                    <span className="kpi-ov-cl-lbl">Meal service</span>
                    <span className="kpi-ov-pnl-sub">{confirmedWeeksCount} of {totalWeeksCount} weeks confirmed</span>
                  </td>
                  <td className="kpi-ov-num kpi-ov-nb">{fmtMoney(planSC) || "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">{planRev > 0 ? fmtPct((planSC / planRev) * 100) : "—"}</td>
                  <td className={`kpi-ov-num ${envToneCls}`}>{fmtMoney(projSC) || "—"}</td>
                  <td className="kpi-ov-num">{fmtMoney(scConfirmed) || "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">—</td>
                </tr>
                <tr className="kpi-ov-cl-tot kpi-ov-pnl-sub-tot" data-kpi-ov="pnl-total-revenue">
                  <td className="l">Total revenue</td>
                  <td className="kpi-ov-num kpi-ov-nb">{fmtMoney(planRev) || "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">100%</td>
                  <td className={`kpi-ov-num ${envToneCls}`} data-kpi-ov="pnl-total-revenue-adjusted">
                    {fmtMoney(projRev) || "—"}
                  </td>
                  <td className="kpi-ov-num">
                    {fmtMoney(Number(revenueCard?.hero_actual || 0)) || "—"}
                  </td>
                  <td className="kpi-ov-num kpi-ov-nb">—</td>
                </tr>
                <tr className="kpi-ov-pnl-grp" data-kpi-ov="pnl-grp-cogs">
                  <td className="l" colSpan={6}>Cost of goods sold</td>
                </tr>
                {cogsRowsAll.map(r => {
                  const adj = adjustedFor(r.target_pct);
                  const landed = Number(r.actual || 0);
                  const left = adj != null ? adj - landed : null;
                  return (
                    <tr key={r.line_code} className="kpi-ov-cl-row">
                      <td className="l kpi-ov-cl-line">
                        <span className="kpi-ov-cl-code">{r.line_code}</span>
                        <span className="kpi-ov-cl-lbl">{r.label}</span>
                      </td>
                      <td className="kpi-ov-num kpi-ov-nb">{fmtMoney(r.period_budget) || "—"}</td>
                      <td className="kpi-ov-num kpi-ov-nb">{fmtPct(r.target_pct) || "—"}</td>
                      <td className={`kpi-ov-num ${envToneCls}`}>{adj != null ? fmtMoney(adj) : "—"}</td>
                      <td className="kpi-ov-num">{fmtMoney(landed) || "—"}</td>
                      <td className="kpi-ov-num kpi-ov-nb">{left != null ? fmtMoney(left) : "—"}</td>
                    </tr>
                  );
                })}
                <tr className="kpi-ov-cl-tot kpi-ov-pnl-sub-tot" data-kpi-ov="pnl-total-cogs">
                  <td className="l">Total cost of goods</td>
                  <td className="kpi-ov-num kpi-ov-nb">{fmtMoney(totalCogsPlan) || "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">{fmtPct(totalCogsTargetPct) || "—"}</td>
                  <td className={`kpi-ov-num ${envToneCls}`} data-kpi-ov="pnl-total-cogs-adjusted">
                    {totalCogsAdjusted != null ? fmtMoney(totalCogsAdjusted) : "—"}
                  </td>
                  <td className="kpi-ov-num">{fmtMoney(totalCogsLanded) || "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">
                    {totalCogsAdjusted != null ? fmtMoney(totalCogsAdjusted - totalCogsLanded) : "—"}
                  </td>
                </tr>
                {gmAdjusted != null && (
                  <tr className="kpi-ov-cl-tot kpi-ov-cl-tot-gm" data-kpi-ov="pnl-total-gm">
                    <td className="l">Gross margin</td>
                    <td className="kpi-ov-num kpi-ov-nb">{fmtMoney(gmPlanBudget) || "—"}</td>
                    <td className="kpi-ov-num kpi-ov-nb">{fmtPct(gmTargetPct) || "—"}</td>
                    <td className={`kpi-ov-num ${envToneCls}`}>{fmtMoney(gmAdjusted) || "—"}</td>
                    <td className="kpi-ov-num kpi-ov-nb">—</td>
                    <td className="kpi-ov-num kpi-ov-nb">—</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="kpi-ov-cl-envnote" data-kpi-ov="pnl-running-note">
              Every line is measured against <b>the revenue this period is projecting</b>, not the original plan. Margin lands when cost does - <b>revenue is confirmed ahead of the week and invoices arrive behind it.</b>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function PnlStatement({ payload, open, onToggle }) {
  // Guard 2 · Kevin CC prompt 2026-09-08. Running single-period gets
  // an isolated component (Path A). Every other range keeps the
  // closed-range table below untouched.
  if (payload?.range?.kind === "period" && payload?.period_state === "open") {
    return <RunningPeriodPnl payload={payload} open={open} onToggle={onToggle} />;
  }
  // Kevin R-68 item 1 (2026-09-04): the P&L Full view is LOCKED when
  // the caller has no salary access. Salary-inclusive totals appear
  // everywhere already (labor is always composed with salary); Full
  // is the surface that reveals 3100.1 hourly vs 3100.2 salary, and
  // that split is exactly what managers below site-leader must not
  // see. When include_salary=false, the segment control is hidden
  // and the dense state is forced to Summary.
  const includeSalary = !!payload?.filters?.include_salary;
  const [dense, setDense] = useState("sum"); // 'sum' | 'full'
  const effectiveDense = includeSalary ? dense : "sum";

  if (!payload?.statement_rows) return null;

  const rows = payload.statement_rows;
  const revenueRowsAll = rows.filter(r => r.section === "revenue" && !r.parent_line_code);
  const cogsRowsAll = rows.filter(r => r.section === "cogs" && !r.parent_line_code);
  const cogsSubs = rows.filter(r => r.section === "cogs" && r.parent_line_code);
  const cogsSubsByParent = new Map();
  for (const s of cogsSubs) {
    if (!cogsSubsByParent.has(s.parent_line_code)) cogsSubsByParent.set(s.parent_line_code, []);
    cogsSubsByParent.get(s.parent_line_code).push(s);
  }
  const tracked = payload.also_tracked || [];
  const totals = payload.statement_totals || {};
  const revenueCard = payload.cards?.find(c => c.key === "revenue");
  const cogsCard = payload.cards?.find(c => c.key === "cogs");
  const gmCard = payload.cards?.find(c => c.key === "gross_margin");
  const totalRevenue = revenueCard?.hero_actual;

  // Summary drops: inactive lines, sub-rows, tracked band.
  const showInactive = effectiveDense === "full";
  const showSubs = effectiveDense === "full";
  const showTracked = effectiveDense === "full";

  const revenueRows = showInactive
    ? revenueRowsAll
    : revenueRowsAll.filter(r => !(Array.isArray(r.flags) && r.flags.includes("inactive")));

  // GM Adjusted DERIVED (item 6): actual revenue - adjusted cost.
  // Server ships statement_totals.gross_margin.margin_at_this_revenue
  // which is (revenue × target_margin_pct) - algebraically identical
  // per the item-6 tie: rev*target_margin_pct = rev - cogs_batr =
  // rev_actual - cost_adjusted (when totalRevenue == rev_actual, which
  // is always true by construction). Use the server value verbatim.
  const gmAdjusted = totals?.gross_margin?.margin_at_this_revenue ?? null;

  return (
    <div
      className={`kpi-ov-card kpi-ov-card-cogs kpi-ov-mt kpi-ov-fold-card${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="statement"
      data-kpi-ov-open={open ? "1" : "0"}
      data-kpi-ov-dense={effectiveDense}
    >
      <button
        type="button"
        className="kpi-ov-fold-trigger"
        data-kpi-ov="fold-pnl"
        onClick={onToggle}
        aria-expanded={open ? "true" : "false"}
      >
        <span className="kpi-ov-eb">Full profit and loss</span>
        {open && includeSalary && (
          <span className="kpi-ov-seg" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={effectiveDense === "full" ? "on" : ""}
              onClick={(e) => { e.stopPropagation(); setDense("full"); }}
              data-kpi-ov="dense-full"
            >Full</button>
            <button
              type="button"
              className={effectiveDense === "sum" ? "on" : ""}
              onClick={(e) => { e.stopPropagation(); setDense("sum"); }}
              data-kpi-ov="dense-sum"
            >Summary</button>
          </span>
        )}
        <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <div className="kpi-ov-fold-meta">
            <HelpPop
              id="overview-pnl"
              title="Profit and loss"
              body={<p>The statement the way finance builds it. Percent of revenue is on every line - that is how each cost is judged, not the dollar alone.</p>}
            />
            <span className="kpi-ov-gl" data-kpi-ov="pnl-scope">
              {payload.filters?.account} · {payload.range_labels?.horizon || `${payload.range?.start} – ${payload.range?.end}`}
            </span>
          </div>
          <div className="kpi-ov-cb">
            <table className="kpi-ov-pnl" data-kpi-ov="pnl-table">
              <thead>
                {/* Group header row: Plan (3) · Actual (2) · Variance (1). */}
                <tr className="kpi-ov-pnl-grp" data-kpi-ov="pnl-group">
                  <th className="l"></th>
                  <th colSpan={3} className="plan plan-first plan-last kpi-ov-pnl-grp-plan">Plan</th>
                  <th colSpan={2} className="kpi-ov-pnl-grp-act">Actual</th>
                  <th className="kpi-ov-pnl-grp-var">Variance</th>
                </tr>
                <tr>
                  <th className="l">Line</th>
                  <th className="plan plan-first">Budget</th>
                  <th className="plan">Target %</th>
                  <th className="plan plan-last">
                    Adjusted<sup className="kpi-ov-pnl-fn-mark">*</sup>
                  </th>
                  <th>Actual</th>
                  <th style={{ width: 66 }}>% of rev</th>
                  <th style={{ width: 130 }}>vs adjusted</th>
                </tr>
              </thead>
              <tbody>
                {/* Revenue section. Revenue rows hatch Adjusted (revenue
                    is not adjusted by revenue). Variance measured
                    against Budget. */}
                <SectionRow label="Revenue" />
                {revenueRows.map(r => (
                  <LineRow
                    key={r.line_code}
                    row={r}
                    variant="line"
                    hatchAdjusted
                    axis="rev"
                    refField="budget"
                    totalRevenue={totalRevenue}
                  />
                ))}
                {/* Total revenue */}
                <tr className="kpi-ov-pnl-tot" data-kpi-ov="pnl-total-revenue">
                  <td className="l">Total revenue</td>
                  <td className="kpi-ov-num plan plan-first">
                    {fmtMoney(totals.revenue?.budget_to_date) || "—"}
                  </td>
                  <td className="kpi-ov-num plan nb">100%</td>
                  <td className="kpi-ov-num plan plan-last kpi-ov-pnl-na-cell"></td>
                  <td className="kpi-ov-num">
                    {fmtMoney(totals.revenue?.actual) || "—"}
                  </td>
                  <td className="kpi-ov-num nb">{totals.revenue?.actual != null ? "100%" : "—"}</td>
                  <VarCell actual={totals.revenue?.actual} ref={totals.revenue?.budget_to_date} axis="rev" />
                </tr>

                {/* Cost of goods sold section. Cost rows measure
                    variance against Adjusted. Sub-rows only in Full;
                    salary hatches Target % and Adjusted. */}
                <SectionRow label="Cost of goods sold" />
                {cogsRowsAll.map(parent => {
                  const subs = cogsSubsByParent.get(parent.line_code) || [];
                  return (
                    <>
                      <LineRow
                        key={parent.line_code}
                        row={parent}
                        variant="line"
                        axis="cost"
                        refField="adjusted"
                        totalRevenue={totalRevenue}
                      />
                      {showSubs && subs.map(sub => {
                        const isSalary = Array.isArray(sub.flags) && sub.flags.includes("not_applicable_target_pct");
                        return (
                          <LineRow
                            key={sub.line_code}
                            row={sub}
                            variant="sub"
                            hatchTarget={isSalary}
                            hatchAdjusted={isSalary}
                            axis="cost"
                            refField={isSalary ? "budget" : "adjusted"}
                            totalRevenue={totalRevenue}
                          />
                        );
                      })}
                    </>
                  );
                })}
                {/* Total COGS */}
                <tr className="kpi-ov-pnl-tot" data-kpi-ov="pnl-total-cogs">
                  <td className="l">Total cost of goods sold</td>
                  <td className="kpi-ov-num plan plan-first">{fmtMoney(totals.cogs?.budget_to_date) || "—"}</td>
                  <td className="kpi-ov-num plan">{fmtPct(totals.cogs?.target_pct) || "—"}</td>
                  <td className="kpi-ov-num plan plan-last">{fmtMoney(totals.cogs?.budget_at_this_revenue) || "—"}</td>
                  <td className="kpi-ov-num">{fmtMoney(totals.cogs?.actual) || "—"}</td>
                  <td className="kpi-ov-num nb">{fmtPct(totals.cogs?.actual_pct) || "—"}</td>
                  <VarCell actual={totals.cogs?.actual} ref={totals.cogs?.budget_at_this_revenue} axis="cost" />
                </tr>

                {/* Gross margin - weight above the rest per the render.
                    Adjusted DERIVED from server (margin_at_this_revenue
                    = revenue × target_margin_pct, algebraically =
                    actual_revenue - adjusted_cost). Variance ties to
                    -cogs.variance by construction (probe asserts). */}
                <tr className="kpi-ov-pnl-gm" data-kpi-ov="pnl-total-gm">
                  <td className="l">Gross margin</td>
                  <td className="kpi-ov-num plan plan-first">{fmtMoney(totals.gross_margin?.budget_to_date) || "—"}</td>
                  <td className="kpi-ov-num plan">{fmtPct(totals.gross_margin?.target_pct) || "—"}</td>
                  <td className="kpi-ov-num plan plan-last">{fmtMoney(gmAdjusted) || "—"}</td>
                  <td className="kpi-ov-num">{fmtMoney(totals.gross_margin?.actual) || "—"}</td>
                  <td className="kpi-ov-num nb">{fmtPct(totals.gross_margin?.actual_pct) || "—"}</td>
                  <VarCell actual={totals.gross_margin?.actual} ref={gmAdjusted} axis="rev" />
                </tr>

                {/* Also tracked band. Full only. Target % + Adjusted
                    hatched (not measured on % of revenue). Variance
                    measured against Budget (like revenue), not Adjusted. */}
                {showTracked && tracked.length > 0 && (
                  <>
                    <SectionRow label="Also tracked · outside gross margin" />
                    {tracked.map(t => {
                      const shim = {
                        line_code: t.line_code,
                        label: t.label,
                        budget_to_date: t.budget,
                        budget_at_this_revenue: null,
                        actual: t.actual,
                        actual_pct: (t.actual != null && totalRevenue) ? (Number(t.actual) / totalRevenue) * 100 : null,
                        target_pct: null,
                        reported: t.actual != null,
                        flags: [],
                      };
                      return (
                        <LineRow
                          key={t.line_code}
                          row={shim}
                          variant="tracked"
                          hatchTarget
                          hatchAdjusted
                          axis="cost"
                          refField="budget"
                          totalRevenue={totalRevenue}
                        />
                      );
                    })}
                  </>
                )}
              </tbody>
            </table>
            <p className="kpi-ov-pnl-foot" data-kpi-ov="pnl-footnote">
              <b><sup>*</sup>Adjusted</b> — the target percent applied to the revenue actually earned. It sits at the right edge of the plan group because it is the bridge: a planned <i>rate</i> against an actual <i>revenue</i>. It is the figure Actual is measured against, so the two sit side by side. The hatched cells carry none: revenue is not adjusted by revenue, and salary and tracked lines are not measured on a percent of it. <b>Variance</b> is measured against the adjusted budget on cost lines and against budget on revenue, so the dollar and the percent always agree in direction. <b>Food purchased</b> is what was used, not what was bought — inventory movement is folded in at close.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
