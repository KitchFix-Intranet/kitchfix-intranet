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

// Build the destination href for a cost line. Kevin ruling R-68
// (2026-09-04): the 3100 row is ALWAYS salary-inclusive on the
// Overview (labor's parent total never moves by toggle - the toggle
// gates disclosure only). So the drill URL always passes
// include_salary=1 for 3100, regardless of the payload's toggle
// state. Otherwise the row shows salary-inclusive $896k and the
// drill target opens hourly-only $780k - the exact defect item 4
// of this-period was written to prevent.
//
// Also carries end=range_effective_end so the drill queries the
// same R-63 window the row reads.
function rowHref({ lineCode, filters, previewAccount, rangeEffectiveEnd }) {
  const params = new URLSearchParams();
  if (filters?.account) params.set("account", filters.account);
  if (filters?.range?.start) params.set("start", filters.range.start);
  const endToUse = rangeEffectiveEnd || filters?.range?.end;
  if (endToUse) params.set("end", endToUse);
  if (previewAccount) params.set("preview", previewAccount);
  if (lineCode === "3100") params.set("include_salary", "1");
  const base = lineCode === "3100" ? "/kpi/labor" : "/kpi/purchasing";
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// Kevin ruling cleanup (2026-09-03) item 7: Meter component removed.
// The red/green bar beneath each cost line was noise - the percentages
// and the verdict colour on % of rev already carry the story.

function CostRow({ row, hasTarget, isOpenRange, filters, previewAccount, revBudFull, rangeEffectiveEnd, showPeriodCols }) {
  const href = rowHref({ lineCode: row.line_code, filters, previewAccount, rangeEffectiveEnd });
  const isBilledBack = Array.isArray(row.flags) && row.flags.includes("billed_back");
  const isInactive = Array.isArray(row.flags) && row.flags.includes("inactive");
  const actualPctText = fmtPct(row.actual_pct);
  const targetPctText = fmtPct(row.target_pct);
  const batrText = fmtMoney(row.budget_at_this_revenue);
  const actualText = fmtMoney(row.actual);
  // vs-target cell (Kevin ruling 2026-09-02): percent-point gap on
  // top, dollar VARIANCE VS BATR beneath.
  //
  // The operand matters. Two prior attempts were wrong:
  //   (a) envelope_delta (btd - batr) - a card-level concept that
  //       flipped sign relative to the row's own percent verdict.
  //   (b) actual - budget_to_date - a real per-row variance but
  //       against a denominator the CELL isn't showing (the column
  //       to the left is "Budget at this revenue", not "Budget to
  //       date") and semantically disagreed with the percent gap
  //       on revenue-shortfall periods.
  //
  // Correct operand: actual - budget_at_this_revenue. Algebraically
  // this equals (percent_gap * revenue) - the same comparison
  // expressed in dollars. Sign-agreement with the percent gap holds
  // by construction. And it says the right thing operationally:
  // "$27,506 over what your revenue earned you", not "$X under your
  // original budget" - on a shortfall period the first is the fact
  // that matters.
  const suppressVerdict = isBilledBack || isInactive || !hasTarget;
  const varianceVsBatr = (row.actual != null && row.budget_at_this_revenue != null)
    ? row.actual - row.budget_at_this_revenue
    : null;
  const over = varianceVsBatr != null && varianceVsBatr > 0;
  const varPctText = row.variance_pct != null
    ? `${Math.abs(Number(row.variance_pct)).toFixed(1)}% ${row.variance_pct <= 0 ? "under" : "over"}`
    : null;
  const varianceText = varianceVsBatr != null
    ? gapDollars(varianceVsBatr, "under", "over")
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
        {/* Kevin R-68 item 4 (2026-09-04): vehicle insurance +
            repair-and-maintenance are corporate allocations posted
            straight to the P&L, not visible on bill.com or Rippling.
            An operator comparing to the P&L should find the
            explanation on the board, not assume the number is wrong. */}
        {row.line_code === "3500" && (
          <HelpPop
            id="overview-cost-line-3500"
            title="Vehicle"
            body={
              <p>
                Vehicle insurance and repair &amp; maintenance are billed
                centrally as corporate allocations posted straight to the
                P&amp;L. They do not appear in bill.com invoices or Rippling
                card charges, so they are not visible on this board or on
                the purchasing board it opens.
              </p>
            }
          />
        )}
        {/* Kevin addendum 2026-09-04: replaces the italic derivation
            sub-line that used to shout the invoiced/credits/inventory
            arithmetic on every row of every range. The P&L below the
            fold carries credits + inventory as real sub-rows; the
            explanation an operator needs when the food figure is
            lower than what they were invoiced lives here in the
            tooltip instead. */}
        {row.line_code === "3200" && (
          <HelpPop
            id="overview-cost-line-3200"
            title="Food purchased"
            body={
              <p>
                The figure shown is the adjusted actual - invoiced food, less
                vendor credits (short deliveries, quarterly rebates), plus or
                minus the period&rsquo;s inventory adjustment. Each piece
                appears on its own line in the P&amp;L below.
              </p>
            }
          />
        )}
        {row.line_code === "3400" && (
          <HelpPop
            id="overview-cost-line-3400"
            title="Packaging and supplies"
            body={
              <p>
                The figure shown is the adjusted actual - invoiced packaging
                and supplies, less vendor credits, plus or minus the
                period&rsquo;s inventory adjustment. Each piece appears on
                its own line in the P&amp;L below.
              </p>
            }
          />
        )}
      </td>
      {/* Kevin ruling final-presentation (2026-09-03) item 3: Plan
          band. Order becomes:
            Line · [Budget* · Target %] · [Spent · % of rev]
          Target % moves INSIDE the plan half so the two percentages
          sit adjacent across the group boundary. */}
      <td className="kpi-ov-num kpi-ov-nb plan plan-first" data-kpi-ov="cost-line-budget">
        {isBilledBack ? <span className="kpi-ov-chip-fixed">billed back</span>
          : isInactive ? <span className="kpi-ov-notactive">not active</span>
          : batrText != null ? batrText : "—"}
      </td>
      <td className="kpi-ov-num kpi-ov-nb plan plan-last" data-kpi-ov="cost-line-target-pct">
        {suppressVerdict ? "—" : (targetPctText != null ? targetPctText : "—")}
      </td>
      {/* Kevin addendum 2026-09-04: the italic "$X invoiced - $Y
          credits - $Z inventory = $W" derivation sub-line is removed.
          The P&L below the fold now carries credits + inventory as
          real sub-rows on their own lines, so the summary above must
          not repeat. Same reasoning as the Labor cards Kevin cut this
          session - if the table below has it, the summary above does
          not repeat. Arithmetic unchanged; only the inline string
          goes. The `?` tooltip on 3200 + 3400 keeps the explanation
          (added below in the label cell). */}
      <td className="kpi-ov-num" data-kpi-ov="cost-line-actual">
        {actualText == null ? <span className="kpi-ov-nb">—</span>
          : <span data-kpi-ov="actual-adjusted">{actualText}</span>}
      </td>
      <td className={`kpi-ov-num ${showPeriodCols ? "prev" : ""} ${suppressVerdict ? "" : (over ? "kpi-ov-bad" : "kpi-ov-good")}`} data-kpi-ov="cost-line-actual-pct">
        {isBilledBack || isInactive ? <span className="kpi-ov-nb">—</span>
          : actualPctText != null ? actualPctText : <span className="kpi-ov-nb">—</span>}
      </td>
      {/* Kevin Prompt 1 item 1b (2026-09-04): period columns render
          only on open ranges. Two cells: P9 budget + Left. Left cell
          takes the good/bad tone (over = red on a cost line). Row
          reads period_budget from the payload the resolver already
          emits per statement-row; no resolver change needed. */}
      {showPeriodCols && (() => {
        const pb = row.period_budget;
        const suppressPeriod = isBilledBack || isInactive || pb == null;
        const leftAmt = (pb != null && row.actual != null) ? (pb - row.actual) : null;
        const leftOver = leftAmt != null && leftAmt < 0;
        const leftAbs = leftAmt != null ? fmtMoney(Math.abs(leftAmt)) : null;
        const leftToneCls = suppressPeriod ? ""
          : leftOver ? "kpi-ov-bad"
          : "kpi-ov-good";
        return (
          <>
            <td className="kpi-ov-num kpi-ov-nb period period-first" data-kpi-ov="cost-line-period-budget">
              {suppressPeriod ? <span className="kpi-ov-nb">—</span>
                : (fmtMoney(pb) || <span className="kpi-ov-nb">—</span>)}
            </td>
            <td className={`kpi-ov-num period period-last ${leftToneCls}`} data-kpi-ov="cost-line-period-left">
              {suppressPeriod || leftAmt == null ? <span className="kpi-ov-nb">—</span>
                : <>{leftAbs}{leftOver ? " over" : ""}</>}
            </td>
          </>
        );
      })()}
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
function TotalRow({ rows, hasTarget, cogsCard, totalLabel, showPeriodCols }) {
  const isSuppressed = (r) => {
    const flags = Array.isArray(r.flags) ? r.flags : [];
    return flags.includes("billed_back") || flags.includes("inactive");
  };
  // Sum SCORED actual + BATR. The total's dollar variance is
  // (scored_actual - scored_batr), same operand as the per-row cell
  // (Kevin ruling 2026-09-02). Full-payload actual displays on the
  // Spent column includes billed-back rows.
  let sumActualAll = 0;
  let sumActualScored = 0;
  let sumBatr = 0;
  for (const r of rows) {
    if (r.actual != null) sumActualAll += Number(r.actual);
    if (!isSuppressed(r)) {
      if (r.actual != null) sumActualScored += Number(r.actual);
      if (r.budget_at_this_revenue != null) sumBatr += Number(r.budget_at_this_revenue);
    }
  }
  const totalActual = fmtMoney(sumActualAll);
  const totalBatr = sumBatr > 0 ? fmtMoney(sumBatr) : null;
  const totalVarianceVsBatr = sumBatr > 0 ? sumActualScored - sumBatr : null;
  const cogsPct = cogsCard?.pct_of_revenue;
  const cogsTargetPct = cogsCard?.target_pct_of_revenue;
  const varPct = (cogsPct != null && cogsTargetPct != null) ? (cogsPct - cogsTargetPct) : null;
  const over = totalVarianceVsBatr != null && totalVarianceVsBatr > 0;
  const varPctText = varPct != null
    ? `${Math.abs(varPct).toFixed(1)}% ${varPct <= 0 ? "under" : "over"}`
    : null;
  const varianceText = totalVarianceVsBatr != null ? gapDollars(totalVarianceVsBatr, "under", "over") : null;
  return (
    <tr className="kpi-ov-cl-tot" data-kpi-ov="cost-lines-total">
      <td className="l">{totalLabel || "Total cost of goods sold"}</td>
      {/* Plan half: Budget* then Target %. */}
      <td className="kpi-ov-num kpi-ov-nb plan plan-first" data-kpi-ov="cost-lines-total-budget">
        {hasTarget && totalBatr ? totalBatr : "—"}
      </td>
      <td className="kpi-ov-num kpi-ov-nb plan plan-last" data-kpi-ov="cost-lines-total-target-pct">
        {hasTarget ? (fmtPct(cogsTargetPct) || "—") : "—"}
      </td>
      {/* Actual half: Spent (with dollar gap beneath) then % of rev. */}
      <td className="kpi-ov-num" data-kpi-ov="cost-lines-total-actual">
        <div>{totalActual || "—"}</div>
        {hasTarget && varianceText && (
          <div
            className={`kpi-ov-cl-tot-gap ${over ? "kpi-ov-bad" : "kpi-ov-good"}`}
            data-kpi-ov="cost-lines-total-gap"
          >
            {varianceText}
          </div>
        )}
      </td>
      <td className={`kpi-ov-num ${showPeriodCols ? "prev" : ""} ${hasTarget ? (over ? "kpi-ov-bad" : "kpi-ov-good") : ""}`} data-kpi-ov="cost-lines-total-actual-pct">
        {fmtPct(cogsPct) || "—"}
      </td>
      {/* Kevin ruling Prompt 1 item 1b (2026-09-04): period cells on
          the total row are EMPTY - the card block above already
          carries the period total, and repeating it in the table is
          the same figure twice. Cells still emit the `period` class
          so the band background + border render cleanly across them;
          `.period-first` / `.period-last` on the last tbody row close
          the band's bottom radius. */}
      {showPeriodCols && (
        <>
          <td className="period period-first" data-kpi-ov="cost-lines-total-period-budget" aria-hidden="true"></td>
          <td className="period period-last" data-kpi-ov="cost-lines-total-period-left" aria-hidden="true"></td>
        </>
      )}
    </tr>
  );
}

// Kevin CC prompt 2026-09-08 item 5. Running-single-period cost
// table gains an envelope row + "Adjusted now" column so the cost
// envelope reads against the revenue the period is projecting, not
// the plan. Render of record: docs/renders/current-period-hybrid.html.
//
// projRev = sum(week_rail.weeks[i].week_revenue) = SC forecast+
// actual for all 4 weeks + full period fee. planRev =
// revenue_budget_full_period.
//
// Colour rule (Kevin ruling): "Adjusted now" is coloured by the
// direction the revenue moved, NOT by a per-line comparison. Every
// line carries the SAME colour - green when projRev > planRev,
// red when below. Do not colour per-line vs per-line-plan; that
// produces the same result today and the wrong one the moment a
// line's target% changes. The envelope row's ▲/▼ keeps the same
// direction - one signal repeated.
function SimpleCostLinesTable({ cogsRows, periodNo, weekRail, revenueBudgetFullPeriod, cogsCard, gmCard, statementTotals, includeSalary, filters, previewAccount, rangeEffectiveEnd }) {
  // R-98 (Kevin 2026-09-09). On CP running + hourly the 3100 row
  // carries hourly-only figures (server swap at resolver.js), so a
  // straight sum-of-visible-rows would show a total LOWER than the
  // salary-inclusive Total cost of goods. Kevin: "Total cost of
  // goods and Gross margin on both tables. Full figures, both
  // states." Source the totals from statement_totals.cogs (server
  // side, salary-inclusive) so the total row keeps the full figure
  // while the 3100 row reads hourly. Visible-lines-vs-total
  // mismatch is deliberate - Kevin: "an unspoken rule between
  // corporate and the site leader." On +salary the two agree; the
  // guard here is unconditional so the total is always the server
  // figure - one source of truth on both toggle states.
  const totalSpent = statementTotals?.cogs?.actual != null
    ? Number(statementTotals.cogs.actual)
    : cogsRows.reduce((s, r) => s + Number(r.actual || 0), 0);
  const totalBudget = statementTotals?.cogs?.period_budget != null
    ? Number(statementTotals.cogs.period_budget)
    : cogsRows.reduce((s, r) => s + Number(r.period_budget || 0), 0);
  const totalTargetPct = statementTotals?.cogs?.target_pct != null
    ? Number(statementTotals.cogs.target_pct)
    : cogsRows.reduce((s, r) => s + Number(r.target_pct || 0), 0);
  const periodBudgetHeader = periodNo != null ? `P${periodNo} budget` : "Period budget";
  // Envelope compute: projRev + planRev + delta.
  const planRev = Number(revenueBudgetFullPeriod || 0);
  const weeks = weekRail?.weeks || [];
  const projRev = weeks.reduce((s, w) => s + Number(w.week_revenue || 0), 0);
  const delta = projRev - planRev;
  const pct = planRev > 0 ? (delta / planRev) * 100 : null;
  // Kevin single-direction colour rule. Every adjusted cell (and
  // the envelope ▲/▼) use the SAME class - one signal repeated.
  const envToneCls = delta === 0
    ? ""
    : delta > 0 ? "kpi-ov-good" : "kpi-ov-bad";
  const confirmedWeeks = weeks.filter(w => w.revenue_basis === "confirmed").length;
  const totalWeeks = weeks.length;
  const settled = totalWeeks > 0 && confirmedWeeks >= totalWeeks;
  // "N wks confirmed + M forecast, plus the full service fee" clause.
  const srcClause = totalWeeks > 0
    ? `${confirmedWeeks} wk${confirmedWeeks === 1 ? "" : "s"} confirmed + ${totalWeeks - confirmedWeeks} forecast, plus the full service fee`
    : null;
  // Row's Adjusted = projRev × target_pct / 100.
  const adjustedFor = (targetPct) => (targetPct != null && projRev > 0)
    ? projRev * (Number(targetPct) / 100)
    : null;
  const totalAdjusted = adjustedFor(totalTargetPct);
  // GM at target row.
  const gmTargetPct = totalTargetPct != null ? 100 - Number(totalTargetPct) : null;
  const gmPlanBudget = (planRev > 0 && totalBudget != null) ? (planRev - totalBudget) : null;
  const gmAdjusted = (gmTargetPct != null && projRev > 0) ? projRev * (gmTargetPct / 100) : null;
  return (
    <div className="kpi-ov-card kpi-ov-mt" data-kpi-ov="cost-lines">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Where the money is going</span>
        <span className="kpi-ov-gl">click a line to open it</span>
        {settled && (
          <span className="kpi-ov-pill kpi-ov-pill-good" data-kpi-ov="cost-lines-pill-final">
            targets final
          </span>
        )}
      </div>
      <div className="kpi-ov-cb">
        {/* Envelope row: Revenue this period · $plan planned → $proj
            projected · ▲/▼ delta · pct. Same signal that colours
            every Adjusted cell below. */}
        {planRev > 0 && (
          <div className="kpi-ov-envrow" data-kpi-ov="cost-envelope-row">
            <span className="kpi-ov-envrow-k">Revenue this period</span>
            <span className="kpi-ov-envrow-e">
              <b>{fmtMoney(planRev)}</b> planned
            </span>
            <span className="kpi-ov-envrow-arw" aria-hidden="true">→</span>
            <span className="kpi-ov-envrow-e">
              <b className={envToneCls}>{fmtMoney(projRev)}</b> projected
            </span>
            {delta !== 0 && pct != null && (
              <span className={`kpi-ov-envrow-chg ${envToneCls}`} data-kpi-ov="cost-envelope-delta">
                {delta > 0 ? "▲" : "▼"} {fmtMoney(Math.abs(delta))} · {pct >= 0 ? pct.toFixed(1) : Math.abs(pct).toFixed(1)}%
              </span>
            )}
            {srcClause && (
              <span className="kpi-ov-envrow-src">{srcClause}</span>
            )}
          </div>
        )}
        {/* Kevin ruling 2026-09-08 item 2. Two-tier header + banded
            plan columns, same shape as Last period's .kpi-ov-cl.
            Group header groups the Plan half (budget + target %) so
            the reader lands on "planned vs happening" instead of a
            flat six-column strip. Same tband + plan classes so the
            band background + corner radii inherit from
            .kpi-ov-tband CSS rules already in overview.css. */}
        <table className="kpi-ov-cl kpi-ov-tband" data-kpi-ov="cost-lines-table">
          <thead>
            <tr className="kpi-ov-tband-grp" data-kpi-ov="tband-group">
              <th className="l"></th>
              <th colSpan={2} className="plan plan-first plan-last kpi-ov-tband-plan">Plan</th>
              <th colSpan={3} className="kpi-ov-tband-act">Now</th>
            </tr>
            <tr>
              <th className="l">Line</th>
              <th className="plan plan-first">{periodBudgetHeader}</th>
              <th className="plan plan-last" style={{ width: 68 }}>Target %</th>
              <th>Adjusted now</th>
              <th>Landed</th>
              <th style={{ width: 84 }}>Left to spend</th>
            </tr>
          </thead>
          <tbody>
            {cogsRows.map(r => {
              const adj = adjustedFor(r.target_pct);
              const landed = Number(r.actual || 0);
              const left = adj != null ? adj - landed : null;
              // Kevin CC prompt 2026-09-09. Restore the shared row
              // markup - Link.kpi-ov-cl-linkarea wrapping span.kpi-ov-glc
              // + span.kpi-ov-cl-lbl + span.kpi-ov-cl-go - the pattern
              // every other range uses via CostRow above. Uses the same
              // rowHref helper so drill destination is identical:
              // 3100 -> /kpi/labor?include_salary=1 (parent stays
              // salary-inclusive per R-68), other codes -> /kpi/purchasing.
              const href = rowHref({ lineCode: r.line_code, filters, previewAccount, rangeEffectiveEnd });
              return (
                <tr key={r.line_code} className="kpi-ov-cl-row" data-kpi-ov-line-code={r.line_code}>
                  <td className="l kpi-ov-cl-line">
                    <Link
                      href={href}
                      className="kpi-ov-cl-linkarea"
                      data-kpi-ov="cost-line-link"
                      aria-label={`Open ${r.label} detail`}
                    >
                      <span className="kpi-ov-glc kpi-ov-num">{r.line_code}</span>
                      <span className="kpi-ov-cl-lbl">{r.label}</span>
                      <span className="kpi-ov-cl-go" aria-hidden="true">→</span>
                    </Link>
                  </td>
                  <td className="kpi-ov-num kpi-ov-nb plan plan-first" data-kpi-ov="cost-line-period-budget">
                    {fmtMoney(r.period_budget) || "—"}
                  </td>
                  <td className="kpi-ov-num kpi-ov-nb plan plan-last" data-kpi-ov="cost-line-target-pct">
                    {fmtPct(r.target_pct) || "—"}
                  </td>
                  <td className={`kpi-ov-num ${envToneCls}`} data-kpi-ov="cost-line-adjusted-now">
                    {adj != null ? fmtMoney(adj) : "—"}
                  </td>
                  <td className="kpi-ov-num" data-kpi-ov="cost-line-landed">
                    {fmtMoney(landed) || "—"}
                  </td>
                  <td className="kpi-ov-num kpi-ov-nb" data-kpi-ov="cost-line-left">
                    {left != null ? fmtMoney(left) : "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="kpi-ov-cl-tot" data-kpi-ov="cost-lines-total">
              <td className="l">Total cost of goods</td>
              <td className="kpi-ov-num kpi-ov-nb plan plan-first">{fmtMoney(totalBudget) || "—"}</td>
              <td className="kpi-ov-num kpi-ov-nb plan plan-last">{fmtPct(totalTargetPct) || "—"}</td>
              <td className={`kpi-ov-num ${envToneCls}`} data-kpi-ov="cost-total-adjusted">
                {totalAdjusted != null ? fmtMoney(totalAdjusted) : "—"}
              </td>
              <td className="kpi-ov-num">{fmtMoney(totalSpent) || "—"}</td>
              <td className="kpi-ov-num kpi-ov-nb">
                {totalAdjusted != null ? fmtMoney(totalAdjusted - totalSpent) : "—"}
              </td>
            </tr>
            {gmTargetPct != null && gmPlanBudget != null && gmAdjusted != null && (
              <tr className="kpi-ov-cl-tot kpi-ov-cl-tot-gm" data-kpi-ov="cost-lines-total-gm">
                <td className="l">Gross margin at target</td>
                <td className="kpi-ov-num kpi-ov-nb plan plan-first">{fmtMoney(gmPlanBudget)}</td>
                <td className="kpi-ov-num kpi-ov-nb plan plan-last">{fmtPct(gmTargetPct)}</td>
                <td className={`kpi-ov-num ${envToneCls}`} data-kpi-ov="cost-gm-adjusted">
                  {fmtMoney(gmAdjusted)}
                </td>
                <td className="kpi-ov-num kpi-ov-nb">—</td>
                <td className="kpi-ov-num kpi-ov-nb">—</td>
              </tr>
            )}
          </tbody>
        </table>
        {/* Kevin CC prompt 2026-09-08 item 5 · the envelope note.
            Two states: weeks-outstanding (targets still move) vs
            all-four-confirmed (targets final for the period). */}
        {planRev > 0 && (
          <div className="kpi-ov-cl-envnote" data-kpi-ov="cost-envelope-note">
            {settled ? (
              <>
                <b>All four weeks are confirmed, so these targets are final for the period.</b>{" "}
                The period earned {fmtMoney(projRev)} against a plan of {fmtMoney(planRev)}.{" "}
                What is left to spend is what is left - it will not move again.
              </>
            ) : (
              <>
                <b>Your cost envelope moves with revenue.</b> The plan assumed {fmtMoney(planRev)}.{" "}
                With {confirmedWeeks} of {totalWeeks} weeks confirmed the period is projecting {fmtMoney(projRev)}.{" "}
                <b>Targets move each time a week confirms.</b>{" "}
                Be aware of your projections for future weeks - if you know they are going to be lower than budget, you need to prepare for those adjustments.
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CostLines({ payload, previewAccount = null }) {
  if (!payload?.statement_rows) return null;
  const filters = payload.filters;
  const hasTarget = !!payload.has_target;
  const isOpenRange = payload.period_state === "open";
  const rangeEffectiveEnd = payload.range_effective_end || null;
  const cogsRows = payload.statement_rows
    .filter(r => r.section === "cogs" && !r.parent_line_code)
    .sort((a, b) => Number(a.line_code) - Number(b.line_code));
  if (cogsRows.length === 0) return null;
  const cogsCard = payload.cards?.find(c => c.key === "cogs");

  // Kevin R-92 PR-3 follow-up (2026-09-09). On This period (single
  // running period), the cost card holds its percentage (no verdict
  // until invoices land). The cost lines TABLE was rendering option
  // B - full Actuals / % of rev / Left / Total variance - which
  // contradicted the option A cards four lines above ("A percentage
  // now would read 8.2% and mean nothing") by printing 8.2% five
  // times and "$26,217 under" on the total row.
  //
  // Fix: on TP running, render a SIMPLIFIED table (four columns:
  // Line, Spent so far, P10 budget, Target %) with no percentage
  // and no variance. Every other range keeps the existing table
  // exactly as it is.
  const isRunningSinglePeriod = payload.range?.kind === "period" && payload.period_state === "open";
  if (isRunningSinglePeriod) {
    return (
      <SimpleCostLinesTable
        cogsRows={cogsRows}
        periodNo={payload.range?.period_no}
        weekRail={payload.week_rail}
        revenueBudgetFullPeriod={cogsCard?.hero_budget_full_period ?? payload.statement_totals?.revenue?.period_budget ?? null}
        cogsCard={cogsCard}
        gmCard={payload.cards?.find(c => c.key === "gross_margin")}
        statementTotals={payload.statement_totals}
        includeSalary={!!payload.filters?.include_salary}
        filters={filters}
        previewAccount={previewAccount}
        rangeEffectiveEnd={rangeEffectiveEnd}
      />
    );
  }
  // Kevin Prompt 1 item 1b (2026-09-04): period columns render only
  // on open ranges (a closed period has no "left"). Column labels
  // come from the same range_labels the resolver already emits -
  // "wk 1 – wk N" for the actuals-header rename (item 1c) and the
  // period-number prefix for "P{N} budget" / "Left".
  const showPeriodCols = isOpenRange;
  const rl = payload.range_labels;
  // Kevin table-width ruling 2026-09-04 item 3: "Actuals wk 1 – wk 3"
  // -> "Actuals". The wk range is stated three times on the page
  // today (status line, group header, column header); once is enough
  // and the status line is the right place. Falls back to "Spent"
  // on closed ranges where no period columns render.
  const actualsHeader = showPeriodCols ? "Actuals" : "Spent";
  const periodNo = payload.range?.period_no;
  const periodBudgetHeader = periodNo != null
    ? `P${periodNo} budget`
    : "Period budget";
  // Kevin table-width ruling 2026-09-04 item 3: "Total cost of goods
  // sold period to date" -> "Total cost of goods". "Period to date"
  // is the range chip's job; repeating it in the row label crowds
  // the column that already houses the longest labels (3400
  // Packaging and supplies). Same rule the column headers now
  // follow.
  const totalLabel = "Total cost of goods";
  // Header "N of M over" count uses the SAME dollar operand the
  // rows show: actual - budget_at_this_revenue. > 0 = over. This
  // agrees with the per-row percent verdict by construction (Kevin
  // ruling 2026-09-02).
  const overCount = cogsRows.filter(r => {
    const flags = Array.isArray(r.flags) ? r.flags : [];
    if (flags.includes("billed_back") || flags.includes("inactive")) return false;
    if (r.actual == null || r.budget_at_this_revenue == null) return false;
    return (r.actual - r.budget_at_this_revenue) > 0;
  }).length;
  // Kevin walkthrough sweep item 7 (2026-09-07). "all under" fires
  // on 3 of 4 zero-spend lines - true and useless. Count rows that
  // actually have material spend (> $0.50) so the pill only reads
  // "all under" when there's real spending under budget across the
  // scope. On day 1 of a period only labor may have spend; the pill
  // reads "nothing spent yet" instead of a verdict.
  const rowsWithSpend = cogsRows.filter(r => {
    const flags = Array.isArray(r.flags) ? r.flags : [];
    if (flags.includes("billed_back") || flags.includes("inactive")) return false;
    return r.actual != null && Number(r.actual) > 0.5;
  }).length;

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
        <span
          className={`kpi-ov-pill ${overCount > 0 ? "kpi-ov-pill-bad" : rowsWithSpend > 0 ? "kpi-ov-pill-good" : "kpi-ov-pill-neutral"}`}
          data-kpi-ov="cost-lines-pill"
        >
          {overCount > 0
            ? `${overCount} of ${cogsRows.length} over`
            : rowsWithSpend > 0
              ? "all under"
              : "nothing spent yet"}
        </span>
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-cl kpi-ov-tband" data-kpi-ov="cost-lines-table">
          <thead>
            {/* Kevin ruling final-presentation (2026-09-03) item 3 +
                Prompt 1 item 1b (2026-09-04): Plan / Actual / Period
                band. Period band only renders on open ranges (a closed
                period has no "left" to render). Period-band cells carry
                the warm #FBF7F1 tint via the .period class; the corner
                8px radii bind to thead tr:first-child / tbody tr:last-child
                via the CSS rules in overview.css. */}
            <tr className="kpi-ov-tband-grp" data-kpi-ov="tband-group">
              <th className="l"></th>
              <th colSpan={2} className="plan plan-first plan-last kpi-ov-tband-plan">Plan</th>
              <th colSpan={2} className={showPeriodCols ? "kpi-ov-tband-act prev" : "kpi-ov-tband-act"}>Actual</th>
              {showPeriodCols && (
                <th colSpan={2} className="period period-first period-last kpi-ov-tband-period">Period</th>
              )}
            </tr>
            <tr>
              <th className="l">Line</th>
              <th className="plan plan-first">
                Budget<sup className="kpi-ov-cl-fn-mark">*</sup>
              </th>
              <th className="plan plan-last" style={{ width: 68 }}>Target %</th>
              <th>{actualsHeader}</th>
              <th className={showPeriodCols ? "prev" : ""} style={{ width: 68 }}>% of rev</th>
              {showPeriodCols && (
                <>
                  <th className="period period-first">{periodBudgetHeader}</th>
                  <th className="period period-last" style={{ width: 84 }}>Left</th>
                </>
              )}
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
                rangeEffectiveEnd={rangeEffectiveEnd}
                revBudFull={payload.statement_totals?.revenue?.period_budget}
                showPeriodCols={showPeriodCols}
              />
            ))}
            <TotalRow rows={cogsRows} hasTarget={hasTarget} cogsCard={cogsCard} totalLabel={totalLabel} showPeriodCols={showPeriodCols} />
          </tbody>
        </table>
        {/* Kevin ruling 2026-09-03 (simplified-layout): footnote below
            the table explains what the * on "Budget" refers to. The
            longer explanation still lives in the COGS card tooltip. */}
        <p
          className="kpi-ov-cl-footnote"
          data-kpi-ov="cost-lines-footnote"
        >
          <sup>*</sup> Adjusted — what the target percent buys at the revenue actually earned.
        </p>
      </div>
    </div>
  );
}
