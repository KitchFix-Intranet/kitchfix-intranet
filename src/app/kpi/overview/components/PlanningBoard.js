"use client";
// src/app/kpi/overview/components/PlanningBoard.js
//
// Kevin Prompt 2 PR-B (2026-09-04). Renders when payload.period_state
// === "planned" - a future period the picker's Next-period preset
// opens under R-62. The board's job changes from "how am I doing"
// to "what have I got", so the card furniture is the same as This
// period but the roles are swapped:
//
//   TOP (hero, big)         Budgeted    $X
//   BOTTOM (grey reference) Actual      not started   (italic)
//
// Every cost figure carries its weekly + daily rate (a period budget
// is an abstraction; $16,142 a week is a shopping decision).
//
// No verdict anywhere on the top three cards - nothing has happened
// yet and the board says so.
//
// Loss case (Kevin R-75, TBR - FL P13): if the period is budgeted at
// a loss (cogs > revenue), the margin card drops the percentage past
// -100% (a ratio against near-nil revenue conveys nothing) and shows
// the planned shortfall instead. A callout above the cards names it
// as intent, not defect. NOTHING renders red on a budgeted loss - red
// is reserved for missing a target, never for the target itself.
//
// Item 10 "To land the year on target" is deferred to a follow-up PR
// because it needs an annual-projection block computed in the resolver
// (not shipped in this PR - review would benefit from being scoped to
// just that compute).

import HelpPop from "@/app/kpi/labor/components/HelpPop";

function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(Math.round(v));
  const s = "$" + abs.toLocaleString("en-US");
  return v < 0 ? "-" + s : s;
}
function fmtPct(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(digits)}%`;
}
function weekCount(startISO, endISO) {
  if (!startISO || !endISO) return 4;
  const d0 = new Date(startISO + "T00:00:00Z");
  const d1 = new Date(endISO   + "T00:00:00Z");
  const days = Math.round((d1 - d0) / 86400000) + 1;
  return Math.max(1, Math.round(days / 7));
}
function dayCount(startISO, endISO) {
  if (!startISO || !endISO) return 28;
  const d0 = new Date(startISO + "T00:00:00Z");
  const d1 = new Date(endISO   + "T00:00:00Z");
  return Math.max(1, Math.round((d1 - d0) / 86400000) + 1);
}
function fmtDateShort(iso) {
  if (!iso) return "";
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

function RateStrip({ periodBudget, weeks, days, priorLabel, priorAmount }) {
  if (periodBudget == null) return null;
  const perWeek = periodBudget / weeks;
  const perDay = periodBudget / days;
  const stepPct = (priorAmount != null && priorAmount !== 0)
    ? ((periodBudget - priorAmount) / Math.abs(priorAmount)) * 100
    : null;
  return (
    <div className="kpi-ov-pln-rate" data-kpi-ov="pln-rate-strip">
      <div>a week<b className="kpi-ov-num">{fmtMoney(perWeek)}</b></div>
      <div>a day<b className="kpi-ov-num">{fmtMoney(perDay)}</b></div>
      {stepPct != null && priorLabel && (
        <div>vs {priorLabel}<b className="kpi-ov-num">{stepPct >= 0 ? "+" : ""}{stepPct.toFixed(1)}%</b></div>
      )}
    </div>
  );
}

function PlanningCard({ eyebrow, tone, tipTitle, tipBody, budget, budgetSuffix, refLabel, refText, weeks, days, priorLabel, priorAmount, id }) {
  const toneCls = tone === "revenue" ? "kpi-ov-card-rev"
    : tone === "cogs" ? "kpi-ov-card-cogs"
    : "kpi-ov-card-gm";
  return (
    <div className={`kpi-ov-card ${toneCls}`} data-kpi-ov={`planning-card-${tone}`}>
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{eyebrow}</span>
        <HelpPop id={id} title={tipTitle} body={<p>{tipBody}</p>} />
        <span className="kpi-ov-pill kpi-ov-pill-neutral">Budget</span>
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-pair" data-kpi-ov="card-actual">
          <span className="kpi-ov-pair-k">Budgeted</span>
          <span className="kpi-ov-pair-v kpi-ov-num">
            {fmtMoney(budget)}
            {budgetSuffix && <small className="kpi-ov-pair-sub">{budgetSuffix}</small>}
          </span>
        </div>
        <div className="kpi-ov-pair-rule" aria-hidden="true" />
        <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="card-reference">
          <span className="kpi-ov-pair-k">{refLabel}</span>
          <span className="kpi-ov-pln-notstarted" data-kpi-ov="pln-not-started">{refText}</span>
        </div>
        <RateStrip periodBudget={budget} weeks={weeks} days={days} priorLabel={priorLabel} priorAmount={priorAmount} />
      </div>
    </div>
  );
}

function LossCallout({ periodLabel, revenueBudget, cogsBudget, laborBudget }) {
  return (
    <div className="kpi-ov-pln-callout" data-kpi-ov="pln-loss-callout">
      <b>{periodLabel} is budgeted at a loss, and that is the plan.</b>{" "}
      {fmtMoney(revenueBudget)} of revenue against {fmtMoney(cogsBudget)} of cost.
      {laborBudget != null && (
        <> The facility winds down at the end of the season but salaried labour continues - {fmtMoney(laborBudget)} of the {fmtMoney(cogsBudget)} is kitchen labour, and the business carries that through the off season.</>
      )}{" "}
      <b>Landing on this number is the target.</b> The margin percentage is not shown because a ratio against {fmtMoney(revenueBudget)} of revenue conveys nothing.
    </div>
  );
}

function PlanningRevenueTable({ rows, totalBudget, periodLabel, weeks }) {
  return (
    <div className="kpi-ov-card kpi-ov-card-rev" data-kpi-ov="planning-revenue-lines">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Revenue by line</span>
        <HelpPop
          id="planning-revenue-lines"
          title="Revenue by line"
          body={<p>What makes up the budgeted revenue above. Budget only - the period has not started.</p>}
        />
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-lev kpi-ov-tband" data-kpi-ov="planning-revenue-lines-table">
          <thead>
            <tr>
              <th className="l">Line</th>
              <th className="plan plan-first plan-last">{periodLabel} budget</th>
              <th>a week</th>
              <th style={{ width: 80 }}>% of rev</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.line_code} data-kpi-ov="planning-revenue-row" data-kpi-ov-line-code={r.line_code}>
                <td className="l">
                  <span className="kpi-ov-glc kpi-ov-num">{r.line_code}</span>
                  <span className="kpi-ov-cl-lbl">{r.label}</span>
                </td>
                <td className="kpi-ov-num kpi-ov-nb plan plan-first plan-last">{fmtMoney(r.period_budget)}</td>
                <td className="kpi-ov-num kpi-ov-nb">{r.period_budget != null ? fmtMoney(r.period_budget / weeks) : "—"}</td>
                <td className="kpi-ov-num kpi-ov-nb">{(r.period_budget != null && totalBudget) ? fmtPct(r.period_budget / totalBudget * 100) : "—"}</td>
              </tr>
            ))}
            <tr className="kpi-ov-cl-tot" data-kpi-ov="planning-revenue-lines-total">
              <td className="l">Total revenue</td>
              <td className="kpi-ov-num kpi-ov-nb plan plan-first plan-last">{fmtMoney(totalBudget)}</td>
              <td className="kpi-ov-num kpi-ov-nb">{totalBudget != null ? fmtMoney(totalBudget / weeks) : "—"}</td>
              <td className="kpi-ov-num kpi-ov-nb">{totalBudget != null ? "100%" : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanningCostTable({ rows, totalBudget, totalRevenue, periodLabel, weeks }) {
  return (
    <div className="kpi-ov-card kpi-ov-card-cogs" data-kpi-ov="planning-cost-lines">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Where the money is planned</span>
        <HelpPop
          id="planning-cost-lines"
          title="Where the money is planned"
          body={<p>Each cost line&rsquo;s budget for the period, its weekly rate, and its share of budgeted revenue. No actuals - nothing has been spent.</p>}
        />
      </div>
      <div className="kpi-ov-cb">
        <table className="kpi-ov-lev kpi-ov-tband" data-kpi-ov="planning-cost-lines-table">
          <thead>
            <tr>
              <th className="l">Line</th>
              <th className="plan plan-first">{periodLabel} budget</th>
              <th className="plan plan-last">a week</th>
              <th style={{ width: 80 }}>% of rev</th>
              <th style={{ width: "34%" }}>share of envelope</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const share = (r.period_budget != null && totalBudget)
                ? (r.period_budget / totalBudget * 100)
                : 0;
              return (
                <tr key={r.line_code} data-kpi-ov="planning-cost-row" data-kpi-ov-line-code={r.line_code}>
                  <td className="l">
                    <span className="kpi-ov-glc kpi-ov-num">{r.line_code}</span>
                    <span className="kpi-ov-cl-lbl">{r.label}</span>
                  </td>
                  <td className="kpi-ov-num kpi-ov-nb plan plan-first">{fmtMoney(r.period_budget)}</td>
                  <td className="kpi-ov-num kpi-ov-nb plan plan-last">{r.period_budget != null ? fmtMoney(r.period_budget / weeks) : "—"}</td>
                  <td className="kpi-ov-num kpi-ov-nb">{(r.period_budget != null && totalRevenue) ? fmtPct(r.period_budget / totalRevenue * 100) : "—"}</td>
                  <td>
                    <div className="kpi-ov-pln-meter" aria-hidden="true">
                      <i style={{ width: `${share.toFixed(1)}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="kpi-ov-cl-tot" data-kpi-ov="planning-cost-lines-total">
              <td className="l">Total cost of goods</td>
              <td className="kpi-ov-num kpi-ov-nb plan plan-first">{fmtMoney(totalBudget)}</td>
              <td className="kpi-ov-num kpi-ov-nb plan plan-last">{totalBudget != null ? fmtMoney(totalBudget / weeks) : "—"}</td>
              <td className="kpi-ov-num kpi-ov-nb">{(totalBudget != null && totalRevenue) ? fmtPct(totalBudget / totalRevenue * 100) : "—"}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PlanningBoard({ payload }) {
  if (!payload) return null;

  const range = payload.range || {};
  const start = range.start;
  const end = range.end;
  const periodNo = range.period_no;
  const periodLabel = periodNo != null ? `P${periodNo}` : "Next period";
  const priorPeriodLabel = periodNo != null && periodNo > 1 ? `P${periodNo - 1}` : null;
  const weeks = weekCount(start, end);
  const days = dayCount(start, end);
  const dateRange = `${fmtDateShort(start)} – ${fmtDateShort(end)}`;

  // Cards - all three carry budget_full_period today.
  const revCard  = (payload.cards || []).find(c => c.key === "revenue");
  const cogCard  = (payload.cards || []).find(c => c.key === "cogs");
  const gmCard   = (payload.cards || []).find(c => c.key === "gross_margin");
  const revBud   = revCard?.budget_full_period ?? payload.statement_totals?.revenue?.period_budget ?? null;
  const cogBud   = cogCard?.budget_full_period ?? payload.statement_totals?.cogs?.period_budget ?? null;
  const gmBud    = (gmCard?.budget_full_period != null)
                     ? gmCard.budget_full_period
                     : (revBud != null && cogBud != null ? revBud - cogBud : null);

  // Loss detection: cost > revenue for the period.
  const isLoss = (revBud != null && cogBud != null && cogBud > revBud);
  const gmPct  = (revBud && revBud > 0 && gmBud != null) ? (gmBud / revBud) * 100 : null;
  const showGmPct = gmPct != null && gmPct > -100;

  // Line rows for the two tables. Reads statement_rows - resolver
  // already emits period_budget per row (Prompt 1's work).
  const revenueRows = (payload.statement_rows || [])
    .filter(r => r.section === "revenue" && !(Array.isArray(r.flags) && r.flags.includes("inactive")));
  const costRows = (payload.statement_rows || [])
    .filter(r => r.section === "cogs" && !r.parent_line_code && /^3(1|2|4|5)00$/.test(r.line_code))
    .sort((a, b) => Number(a.line_code) - Number(b.line_code));
  const laborBudget = costRows.find(r => r.line_code === "3100")?.period_budget ?? null;

  const account = payload.filters?.account || "";

  return (
    <div data-kpi-ov="planning-board">
      <div className="kpi-ov-statusrow" data-kpi-ov="planning-statusrow">
        <span className={`kpi-ov-pln-pill ${isLoss ? "kpi-ov-pln-pill-loss" : "kpi-ov-pln-pill-plan"}`}>
          {isLoss ? "Planning view · budgeted loss" : "Planning view"}
        </span>
        <span className="kpi-ov-pln-through">
          {periodLabel} · {dateRange} · budget only, nothing has happened yet
        </span>
      </div>

      {isLoss && (
        <LossCallout
          periodLabel={periodLabel}
          revenueBudget={revBud}
          cogsBudget={cogBud}
          laborBudget={laborBudget}
        />
      )}

      <div className="kpi-ov-cards" data-kpi-ov="planning-cards-row">
        <PlanningCard
          id={`planning-card-revenue-${periodLabel}`}
          eyebrow={`Revenue ${periodLabel}`}
          tone="revenue"
          tipTitle="Revenue"
          tipBody={`What ${account || "this account"} is budgeted to bill in ${periodLabel}. Every cost below is planned as a percent of this number.`}
          budget={revBud}
          refLabel="Actual"
          refText="not started"
          weeks={weeks}
          days={days}
          priorLabel={priorPeriodLabel}
          priorAmount={null}
        />
        <PlanningCard
          id={`planning-card-cogs-${periodLabel}`}
          eyebrow={`Cost of goods ${periodLabel}`}
          tone="cogs"
          tipTitle="Cost of goods"
          tipBody={`The envelope for labour, food, packaging and vehicle in ${periodLabel}. Set at budget and does not move with revenue on a future period.`}
          budget={cogBud}
          budgetSuffix={(revBud && cogBud != null) ? `${fmtPct(cogBud / revBud * 100)} of revenue` : null}
          refLabel="Spent"
          refText="not started"
          weeks={weeks}
          days={days}
          priorLabel={priorPeriodLabel}
          priorAmount={null}
        />
        {isLoss ? (
          <div className="kpi-ov-card kpi-ov-card-gm" data-kpi-ov="planning-card-gross_margin">
            <div className="kpi-ov-ch">
              <span className="kpi-ov-eb">Gross margin {periodLabel}</span>
              <HelpPop
                id={`planning-card-gm-${periodLabel}`}
                title="Gross margin"
                body={<p>Budgeted revenue minus budgeted cost of goods. On a period budgeted at a loss the percentage is suppressed - a ratio against near-nil revenue conveys nothing.</p>}
              />
              <span className="kpi-ov-pill kpi-ov-pill-neutral">Budgeted loss</span>
            </div>
            <div className="kpi-ov-cb">
              <div className="kpi-ov-pair" data-kpi-ov="card-actual">
                <span className="kpi-ov-pair-k">Budgeted</span>
                <span className="kpi-ov-pair-v kpi-ov-num">{fmtMoney(gmBud)}</span>
              </div>
              <div className="kpi-ov-pair-rule" aria-hidden="true" />
              <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="card-reference">
                <span className="kpi-ov-pair-k">Actual</span>
                <span className="kpi-ov-pln-notstarted">not started</span>
              </div>
              <div className="kpi-ov-pln-rate">
                <div>planned shortfall<b className="kpi-ov-num">{fmtMoney(Math.abs(gmBud || 0))}</b></div>
                <div>a week<b className="kpi-ov-num">{gmBud != null ? fmtMoney(gmBud / weeks) : "—"}</b></div>
              </div>
            </div>
          </div>
        ) : (
          <PlanningCard
            id={`planning-card-gm-${periodLabel}`}
            eyebrow={`Gross margin ${periodLabel}`}
            tone="gm"
            tipTitle="Gross margin"
            tipBody="Budgeted revenue minus budgeted cost of goods. On a period budgeted at a loss the percentage is suppressed."
            budget={gmBud}
            budgetSuffix={showGmPct ? `${fmtPct(gmPct)} of revenue` : null}
            refLabel="Actual"
            refText="not started"
            weeks={weeks}
            days={days}
            priorLabel={priorPeriodLabel}
            priorAmount={null}
          />
        )}
      </div>

      <div className="kpi-ov-split" data-kpi-ov="planning-split">
        <div className="kpi-ov-split-left">
          <PlanningRevenueTable
            rows={revenueRows}
            totalBudget={revBud}
            periodLabel={periodLabel}
            weeks={weeks}
          />
        </div>
        <div className="kpi-ov-split-right">
          <PlanningCostTable
            rows={costRows}
            totalBudget={cogBud}
            totalRevenue={revBud}
            periodLabel={periodLabel}
            weeks={weeks}
          />
        </div>
      </div>
    </div>
  );
}
