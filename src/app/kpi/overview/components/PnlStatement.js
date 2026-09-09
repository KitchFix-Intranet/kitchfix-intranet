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
//
// Kevin CC prompt 2026-09-08 (P&L one-table). Running-period overrides
// let the same LineRow serve running P10 without a separate component.
// When `runningAdjusted` and/or `runningLanded` are provided, they
// take precedence over the row's budget_at_this_revenue / actual
// (statement_rows revenue actuals are null on TP per R-92; the values
// come from week_rail via the caller). `isRunning` flips the last
// cell from variance to Left-to-spend and the Landed cell renders
// the running value even when row.reported === false.
function LineRow({
  row,
  variant = "line",
  hatchTarget = false,
  hatchAdjusted = false,
  axis,
  refField,
  totalRevenue,
  isRunning = false,
  runningAdjusted = null,
  runningLanded = null,
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
  // Running-period overrides: caller may pass a projected-revenue-
  // derived Adjusted and a week_rail-derived Landed. Fall back to the
  // row's own fields (closed-range shape).
  const effectiveAdjusted = runningAdjusted != null ? runningAdjusted : row.budget_at_this_revenue;
  const effectiveActual   = runningLanded   != null ? runningLanded   : row.actual;
  const adjustedText = fmtMoney(effectiveAdjusted);
  const actualText = fmtMoney(effectiveActual);
  const actualPct = row.actual_pct != null
    ? row.actual_pct
    : (row.reported && totalRevenue ? (Number(row.actual) / totalRevenue) * 100 : null);
  const refValue = refField === "adjusted" ? effectiveAdjusted : row.budget_to_date;
  const hatchTargetFinal = hatchTarget || notApplicable;
  const hatchAdjustedFinal = hatchAdjusted || notApplicable;
  // On running, the last column is "Left to spend" = adjusted - landed
  // (cost lines; positive = money still available). Revenue rows on
  // running also render adjusted - landed (positive = fee not yet
  // accrued for future weeks; SC not yet confirmed). Hatched when
  // either input is null. GM's running-last-cell is hatched by the
  // caller directly since Landed is intentionally absent on GM.
  const leftToSpend = (effectiveAdjusted != null && effectiveActual != null)
    ? Number(effectiveAdjusted) - Number(effectiveActual)
    : null;
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
        {isRunning
          ? (actualText != null ? actualText : "—")
          : (row.reported === false
              ? <span className="kpi-ov-pnl-notrep">not reported</span>
              : (actualText != null ? actualText : "—"))}
      </td>
      <td className="kpi-ov-num nb">
        {actualPct != null && (isRunning || row.reported !== false) ? fmtPct(actualPct) : "—"}
      </td>
      {isRunning ? (
        <td className="kpi-ov-pnl-var nb">
          {leftToSpend != null ? fmtMoney(leftToSpend) : "—"}
        </td>
      ) : (
        <VarCell actual={row.actual} ref={refValue} axis={axis} />
      )}
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

// Kevin CC prompt 2026-09-08 (P&L one-table). RunningPeriodPnl was
// folded back into PnlStatement as a variant of the same skeleton.
// Only three cells differ on a running period: group header + column
// header both read "Landed" instead of "Actual", and the last column
// reads "Left to spend" instead of "vs adjusted". Everything else -
// plan band, sub-lines, hatching, Full/Summary toggle, Also-tracked
// section - shared verbatim. The old isolated component + Guard-2
// early-return removed with this PR.
export default function PnlStatement({ payload, open, onToggle }) {
  // Kevin R-68 item 1 (2026-09-04): the P&L Full view was LOCKED
  // when the caller had no salary access - Full reveals 3100.1
  // hourly vs 3100.2 salary, the split managers below site-leader
  // must not see. R-98 (Kevin 2026-09-09) narrows the lock: on
  // Current period + Next period the lock incorrectly hid 3200.1 /
  // 3200.2 (food + packaging sub-lines), which have nothing to do
  // with salary. On those two ranges the server-side R-98 gate
  // ensures the 3100 parent already carries hourly-only figures and
  // the 3100.1 / 3100.2 sub-rows are not emitted at all - so
  // opening Full on hourly reveals food + packaging subs but no
  // salary. On closed ranges (CY / LP) keep the lock: those payloads
  // still emit 3100.1 / 3100.2 when include_salary=true, so Full on
  // hourly there is still capable of revealing the split.
  const includeSalary = !!payload?.filters?.include_salary;
  const [dense, setDense] = useState("sum"); // 'sum' | 'full'
  const isPeriodicSingle = payload?.range?.kind === "period"
    && (payload?.period_state === "open" || payload?.period_state === "planned");
  const effectiveDense = (includeSalary || isPeriodicSingle) ? dense : "sum";

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

  // Kevin CC prompt 2026-09-08 (P&L one-table). Running-period variant
  // of the same skeleton. All Adjusted values struck against projRev
  // (sum of week_rail week revenues = SC forecast+actual + full period
  // fee); Landed for revenue rows comes from week_rail (statement_rows
  // revenue actuals are null on TP per R-92); Landed for cost rows +
  // Also tracked comes from statement_rows.actual (populated). Every
  // Adjusted derivation matches the cost-lines table's `Adjusted now`
  // column - one number, both places.
  const isRunning = payload.range?.kind === "period" && payload.period_state === "open";
  const weekRailWeeks = payload.week_rail?.weeks || [];
  const feePerWeek = Number(weekRailWeeks[0]?.fee_prorate || 0);
  const feePeriod = feePerWeek * 4;
  const projSC = weekRailWeeks.reduce((s, w) => s + Number(w.meal_revenue || 0), 0);
  const projRev = projSC + feePeriod;
  const confirmedWeeksCount = revenueCard?.confirmed_weeks_count ?? 0;
  const scConfirmedLanded = weekRailWeeks
    .filter(w => w.revenue_basis === "confirmed")
    .reduce((s, w) => s + Number(w.meal_revenue || 0), 0);
  const feeLanded = feePerWeek * confirmedWeeksCount;
  // Running-period revenue rendering is scoped to the 2300 fee +
  // 2400.1 SC rows only. Other revenue lines (2200, 2400.2, 2600)
  // don't carry meaningful data on a running per-meal account; they
  // render as "not reported" today but Kevin's spec shows only 2300 +
  // 2400.1 on the running P&L.
  const revenueRowsForRunning = revenueRowsAll.filter(r => r.line_code === "2300" || r.line_code === "2400.1");
  // Adjusted overrides per revenue row. 2300 = fee itself (contractual,
  // doesn't move with volume). 2400.1 = projSC (SC sum, no fee).
  const revenueRunningView = (r) => {
    if (r.line_code === "2300") return { runningAdjusted: feePeriod, runningLanded: feeLanded };
    if (r.line_code === "2400.1") return { runningAdjusted: projSC, runningLanded: scConfirmedLanded };
    return { runningAdjusted: null, runningLanded: null };
  };
  // Cost adjusted = projRev × target_pct / 100. Landed = row.actual
  // (statement_rows carries cost actuals on TP; only revenue rows are
  // nulled per R-92).
  const costAdjustedFor = (targetPct) => (targetPct != null && projRev > 0)
    ? projRev * (Number(targetPct) / 100)
    : null;
  // Totals + GM running values.
  const totalCogsTargetPct = totals?.cogs?.target_pct;
  const totalCogsAdjustedRunning = costAdjustedFor(totalCogsTargetPct);
  const gmAdjustedRunning = totalCogsAdjustedRunning != null ? projRev - totalCogsAdjustedRunning : null;
  const revenueLandedRunning = Number(revenueCard?.hero_actual ?? 0);
  const cogsLandedRunning = Number(cogsCard?.hero_actual ?? 0);

  const actualHeaderLabel = isRunning ? "Landed" : "Actual";
  const lastColHeaderLabel = isRunning ? "Left to spend" : "vs adjusted";

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
        {open && (includeSalary || isPeriodicSingle) && (
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
              {/* Kevin ruling 2026-09-08 (post-#1080). Column widths
                  declared via <colgroup> so every row obeys the same
                  per-column sizing under table-layout: fixed. Label
                  col has no width and receives the remainder of the
                  table's 100%. See .kpi-ov-pnl in overview.css for
                  the numeric-column widths. */}
              <colgroup>
                <col />
                <col className="kpi-ov-pnl-col-budget" />
                <col className="kpi-ov-pnl-col-target" />
                <col className="kpi-ov-pnl-col-adjusted" />
                <col className="kpi-ov-pnl-col-actual" />
                <col className="kpi-ov-pnl-col-pctrev" />
                <col className="kpi-ov-pnl-col-var" />
              </colgroup>
              <thead>
                {/* Group header row. Kevin ruling 2026-09-08 (P&L one-
                    table): the 7th cell is empty (was "Variance"); on
                    a running period the Actual group label reads
                    "Landed" to match the last-column swap below. */}
                <tr className="kpi-ov-pnl-grp" data-kpi-ov="pnl-group">
                  <th className="l"></th>
                  <th colSpan={3} className="plan plan-first plan-last kpi-ov-pnl-grp-plan">Plan</th>
                  <th colSpan={2} className="kpi-ov-pnl-grp-act">{actualHeaderLabel}</th>
                  <th className="kpi-ov-pnl-grp-var"></th>
                </tr>
                <tr>
                  <th className="l">Line</th>
                  <th className="plan plan-first">Budget</th>
                  <th className="plan">Target %</th>
                  <th className="plan plan-last">Adjusted</th>
                  <th>{actualHeaderLabel}</th>
                  <th>% of rev</th>
                  <th>{lastColHeaderLabel}</th>
                </tr>
              </thead>
              <tbody>
                {/* Revenue section. Closed range: rows hatch Adjusted
                    (revenue is not adjusted by revenue), variance
                    measured against Budget. Running: 2300 + 2400.1
                    only (other revenue lines don't render on a running
                    per-meal account), Adjusted comes from week_rail
                    (fee: contractual = fee; SC: projSC), Landed from
                    week_rail (fee: fee × conf / 4; SC: confirmed sum),
                    last column = Left to spend. */}
                <SectionRow label="Revenue" />
                {(isRunning ? revenueRowsForRunning : revenueRows).map(r => {
                  const rv = isRunning ? revenueRunningView(r) : null;
                  return (
                    <LineRow
                      key={r.line_code}
                      row={r}
                      variant="line"
                      hatchAdjusted={!isRunning}
                      axis="rev"
                      refField="budget"
                      totalRevenue={totalRevenue}
                      isRunning={isRunning}
                      runningAdjusted={rv?.runningAdjusted ?? null}
                      runningLanded={rv?.runningLanded ?? null}
                    />
                  );
                })}
                {/* Total revenue. On running, Adjusted = projRev and
                    Landed = revenueCard.hero_actual (fee + SC sum,
                    per step 1 of the current-period rebuild). Last
                    cell renders Left to spend = projRev - hero_actual
                    (positive = revenue yet to earn in the period). */}
                <tr className="kpi-ov-pnl-tot" data-kpi-ov="pnl-total-revenue">
                  <td className="l">Total revenue</td>
                  <td className="kpi-ov-num plan plan-first">
                    {fmtMoney(totals.revenue?.budget_to_date) || "—"}
                  </td>
                  <td className="kpi-ov-num plan nb">100%</td>
                  {isRunning ? (
                    <td className="kpi-ov-num plan plan-last">{fmtMoney(projRev) || "—"}</td>
                  ) : (
                    <td className="kpi-ov-num plan plan-last kpi-ov-pnl-na-cell"></td>
                  )}
                  <td className="kpi-ov-num">
                    {isRunning
                      ? (fmtMoney(revenueLandedRunning) || "—")
                      : (fmtMoney(totals.revenue?.actual) || "—")}
                  </td>
                  <td className="kpi-ov-num nb">
                    {isRunning
                      ? (revenueLandedRunning > 0 ? "100%" : "—")
                      : (totals.revenue?.actual != null ? "100%" : "—")}
                  </td>
                  {isRunning ? (
                    <td className="kpi-ov-pnl-var nb">
                      {fmtMoney(projRev - revenueLandedRunning) || "—"}
                    </td>
                  ) : (
                    <VarCell actual={totals.revenue?.actual} ref={totals.revenue?.budget_to_date} axis="rev" />
                  )}
                </tr>

                {/* Cost of goods sold section. Closed range: variance
                    against Adjusted; sub-rows only in Full; salary
                    hatches Target % and Adjusted. Running: Adjusted
                    = projRev × target_pct / 100 for both parent and
                    non-salary subs; Landed reads statement_rows.actual
                    verbatim (populated on TP for cost lines). */}
                <SectionRow label="Cost of goods sold" />
                {cogsRowsAll.map(parent => {
                  const subs = cogsSubsByParent.get(parent.line_code) || [];
                  // R-98 (Kevin 2026-09-09). The 3100 parent already
                  // carries hourly-only figures on CP+NP+hourly (see
                  // resolver.js at the labor3100_hourly_swap_applies
                  // gate) so we render `parent` verbatim - no client-
                  // side field swap. Server-side gate is the access
                  // decision: on hourly the salary numbers are never
                  // in the payload; a devtools reader gets nothing to
                  // subtract from. Sub-rows for 3100 also do not exist
                  // on hourly (resolver emits them only when
                  // includeSalary+role) so the map below naturally
                  // renders zero subs under 3100 on hourly.
                  const parentRunningAdj = isRunning ? costAdjustedFor(parent.target_pct) : null;
                  const parentRunningLanded = isRunning ? Number(parent.actual ?? 0) : null;
                  return (
                    <>
                      <LineRow
                        key={parent.line_code}
                        row={parent}
                        variant="line"
                        axis="cost"
                        refField="adjusted"
                        totalRevenue={totalRevenue}
                        isRunning={isRunning}
                        runningAdjusted={parentRunningAdj}
                        runningLanded={parentRunningLanded}
                      />
                      {showSubs && subs.map(sub => {
                        const isSalary = Array.isArray(sub.flags) && sub.flags.includes("not_applicable_target_pct");
                        const subRunningAdj = (isRunning && !isSalary) ? costAdjustedFor(sub.target_pct) : null;
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
                            isRunning={isRunning}
                            runningAdjusted={subRunningAdj}
                            runningLanded={isRunning ? Number(sub.actual ?? 0) : null}
                          />
                        );
                      })}
                    </>
                  );
                })}
                {/* Total COGS. Running: Adjusted = projRev × total
                    target_pct / 100 (same as sum of per-line rounded).
                    Landed = cogsCard.hero_actual. Last cell = Adjusted
                    - Landed. */}
                <tr className="kpi-ov-pnl-tot" data-kpi-ov="pnl-total-cogs">
                  <td className="l">Total cost of goods sold</td>
                  <td className="kpi-ov-num plan plan-first">{fmtMoney(totals.cogs?.budget_to_date) || "—"}</td>
                  <td className="kpi-ov-num plan">{fmtPct(totals.cogs?.target_pct) || "—"}</td>
                  <td className="kpi-ov-num plan plan-last">
                    {fmtMoney(isRunning ? totalCogsAdjustedRunning : totals.cogs?.budget_at_this_revenue) || "—"}
                  </td>
                  <td className="kpi-ov-num">
                    {fmtMoney(isRunning ? cogsLandedRunning : totals.cogs?.actual) || "—"}
                  </td>
                  <td className="kpi-ov-num nb">{fmtPct(totals.cogs?.actual_pct) || "—"}</td>
                  {isRunning ? (
                    <td className="kpi-ov-pnl-var nb">
                      {totalCogsAdjustedRunning != null
                        ? (fmtMoney(totalCogsAdjustedRunning - cogsLandedRunning) || "—")
                        : "—"}
                    </td>
                  ) : (
                    <VarCell actual={totals.cogs?.actual} ref={totals.cogs?.budget_at_this_revenue} axis="cost" />
                  )}
                </tr>

                {/* Gross margin - weight above the rest per the render.
                    Closed range: Adjusted DERIVED from server
                    (margin_at_this_revenue = revenue × target_margin_pct,
                    algebraically = actual_revenue - adjusted_cost),
                    variance ties to -cogs.variance by construction.
                    Running: Adjusted = projRev - totalCogsAdjusted,
                    Landed absent, last cell hatched (verdict on an
                    unfinished period is wrong). */}
                <tr className="kpi-ov-pnl-gm" data-kpi-ov="pnl-total-gm">
                  <td className="l">Gross margin</td>
                  <td className="kpi-ov-num plan plan-first">{fmtMoney(totals.gross_margin?.budget_to_date) || "—"}</td>
                  <td className="kpi-ov-num plan">{fmtPct(totals.gross_margin?.target_pct) || "—"}</td>
                  <td className="kpi-ov-num plan plan-last">
                    {fmtMoney(isRunning ? gmAdjustedRunning : gmAdjusted) || "—"}
                  </td>
                  {isRunning ? (
                    <td className="kpi-ov-num kpi-ov-pnl-na-cell"></td>
                  ) : (
                    <td className="kpi-ov-num">{fmtMoney(totals.gross_margin?.actual) || "—"}</td>
                  )}
                  {isRunning ? (
                    <td className="kpi-ov-num kpi-ov-pnl-na-cell"></td>
                  ) : (
                    <td className="kpi-ov-num nb">{fmtPct(totals.gross_margin?.actual_pct) || "—"}</td>
                  )}
                  {isRunning ? (
                    <td className="kpi-ov-pnl-var kpi-ov-pnl-na-cell"></td>
                  ) : (
                    <VarCell actual={totals.gross_margin?.actual} ref={gmAdjusted} axis="rev" />
                  )}
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
            {/* Kevin ruling 2026-09-08 (P&L one-table): footnote
                paragraph removed. Render of record does not carry it
                and the Adjusted* asterisk it referenced was dropped
                too. Semantics live in the render's page-level notes,
                not per-table copy. */}
            {/* R-98 (Kevin CC prompt 2026-09-08). Running-period
                hourly view carries a note under the table: the 3100
                row shows hourly wages only, but the total and gross
                margin stay salary-inclusive - the lines will not
                sum to the total by construction. Kevin: "That is
                Kevin's ruling and it is deliberate." Scoped to TP;
                CY + LP keep R-68 (no swap, no note). */}
            {isRunning && !includeSalary && (
              <p className="kpi-ov-pnl-note-hourly" data-kpi-ov="pnl-hourly-note">
                <b>Hourly view.</b> Kitchen labor shows hourly wages only. Cost of goods sold and gross margin are the full figures.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
