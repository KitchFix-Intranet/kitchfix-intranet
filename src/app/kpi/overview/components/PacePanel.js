"use client";
// src/app/kpi/overview/components/PacePanel.js
//
// PR-2 items 14-16 (Kevin, 2026-09-02). "Will the budget last" -
// one hero, one sentence. Retires the two-cell row + progress bar
// previously carried by WhatIsLeft on the open path.
//
// Three variants, keyed on payload state:
//
//   Open range (This period + FYTD, has_target) - the runway
//     variant. Hero = days-of-spend-left; sentence = "$X left at
//     $Y/day. That covers all N days - the period closes around
//     $Z against a $W budget." Amber when runway < days remaining
//     (runs out early).
//
//   Verified range (Last period) - the "How it closed" variant.
//     Two-cell row (Cost of goods, Revenue) with variance vs
//     period budget. Then a runway box naming the final margin
//     percent + which side moved it. Then a used bar with 100%
//     of the period gone.
//
//   sc_counts_without_dollars - the counts-arrived-dollars-havent
//     variant (item 15b). NOT the pace path per se - the revenue
//     card handles the em-dash hero - but this panel names the
//     absence explicitly: "Revenue not yet reporting - N service
//     days on the calendar for this period but no meal counts
//     entered. Pace waits on dollars."
//
// Payload contract:
//   payload.what_is_left            - open-range payload from PR-1
//   payload.statement_totals.cogs   - verified variance math
//   payload.statement_totals.revenue - verified variance math
//   payload.sc_counts_without_dollars - {row_count, dates_covered}
//   payload.cards[cogs/gm/revenue]  - dollar/pct labels

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
function fmtDatesCovered(dc) {
  if (!dc || !dc.first || !dc.last) return null;
  const m = (iso) => {
    const [y, mo, d] = String(iso).slice(0, 10).split("-");
    return `${mo}/${d}`;
  };
  return `${m(dc.first)}-${m(dc.last)}`;
}

// Open runway variant. Hero: days of spend left. Sentence: what's
// left at what daily rate, whether it covers, where the period closes.
//
// Three states:
//   good  - runway >= days_remaining. Green.
//   tight - runway < days_remaining but cogs_left > 0. Amber.
//   past  - cogs_left <= 0 already. The whole "days-of-spend-left"
//           framing inverts: no negative dollar in a "left" slot.
//           Hero becomes the dollar past budget; sentence names how
//           much past and where the period will close (Kevin 2026-
//           09-02 Fix A).
//
// Budget-name disambiguation (Kevin 2026-09-02 Fix B): the cost-
// lines total row shows BATR ($63,779 on TBJ - FL P9), the pace
// card historically read "$62,980 budget" - two nearby figures with
// the same word. Pace card now names it "P9 budget" (or "period
// budget" on ranges without a numeric period).
function RunwayPanel({ payload }) {
  const wil = payload.what_is_left;
  const cogsBudgetFullPeriod = payload.statement_totals?.cogs?.period_budget;
  const cogsActual = payload.statement_totals?.cogs?.actual;
  if (!wil || cogsBudgetFullPeriod == null || cogsActual == null) return null;
  const { cogs_left, per_day_so_far, days_remaining, days_in_period } = wil;
  // Runway = days the current daily-so-far rate would burn through
  // what's left. When per_day_so_far is 0 (nothing spent yet), the
  // ratio is undefined; treat as "many more days than remaining"
  // (safe green).
  const runway = (per_day_so_far != null && per_day_so_far > 0 && cogs_left != null)
    ? Math.max(0, cogs_left / per_day_so_far)
    : null;
  // Projected close: what we would land at if the current daily rate
  // continued for the days remaining.
  const projClose = (cogsActual != null && per_day_so_far != null && days_remaining != null)
    ? cogsActual + per_day_so_far * days_remaining
    : null;
  const past = cogs_left != null && cogs_left <= 0;
  const tight = !past && runway != null && days_remaining != null && runway < days_remaining;
  const daysEarly = tight ? (days_remaining - runway) : 0;
  const runwayDisplay = runway != null ? runway.toFixed(1) : "—";
  const overBy = past ? Math.abs(cogs_left) : null;
  const projOverBudget = (projClose != null && cogsBudgetFullPeriod != null)
    ? projClose - cogsBudgetFullPeriod
    : null;
  const periodBudgetLabel = payload.range?.period_no != null
    ? `P${payload.range.period_no} budget`
    : "period budget";
  const toneCls = past ? "kpi-ov-card-pace-past"
    : tight ? "kpi-ov-card-pace-tight"
    : "kpi-ov-card-pace-good";
  const pillTone = past || tight ? "kpi-ov-pill-bad" : "kpi-ov-pill-good";
  const pillText = past ? "Past budget" : `${days_remaining} days left`;

  return (
    <div
      className={`kpi-ov-card ${toneCls} kpi-ov-pace`}
      data-kpi-ov="pace-panel"
      data-kpi-ov-pace-variant={past ? "past" : "runway"}
    >
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Will the budget last</span>
        <HelpPop
          id="overview-pace-runway"
          title="Will the budget last"
          body={
            <p>
              What is left of the period&rsquo;s cost-of-goods budget, and
              whether the current daily spend covers the days remaining. If
              it runs out early, the sentence names when. Once spend passes
              the period budget the framing flips: the hero names how far
              past, and the projection names where the period closes.
            </p>
          }
        />
        <span className={`kpi-ov-pill ${pillTone}`}>
          {pillText}
        </span>
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-heroline">
          {past ? (
            <>
              <span className="kpi-ov-hero kpi-ov-num kpi-ov-bad">
                {fmtMoney(overBy)}
              </span>
              <span className="kpi-ov-htd">past the {periodBudgetLabel}</span>
            </>
          ) : (
            <>
              <span className={`kpi-ov-hero kpi-ov-num ${tight ? "kpi-ov-bad" : "kpi-ov-good"}`}>
                {runwayDisplay}
              </span>
              <span className="kpi-ov-htd">days of spend left</span>
            </>
          )}
        </div>
        <div className="kpi-ov-pace-say" data-kpi-ov="pace-sentence">
          {past ? (
            <>
              <b className="kpi-ov-bad">{fmtMoney(overBy)} past the {periodBudgetLabel}</b> with
              {" "}<b>{days_remaining} days</b> still to run. At <b>{fmtMoney(per_day_so_far)}</b> a day
              {" "}the period closes around <b>{fmtMoney(projClose)}</b>
              {projOverBudget != null && projOverBudget > 0 ? (
                <> - <b className="kpi-ov-bad">{fmtMoney(projOverBudget)} over</b>.</>
              ) : "."}
            </>
          ) : tight ? (
            <>
              <b>{fmtMoney(cogs_left)}</b> left at <b>{fmtMoney(per_day_so_far)}</b> a day.
              {" "}That runs out <b className="kpi-ov-bad">{daysEarly.toFixed(1)} days early</b>
              {" "}- the period closes around <b>{fmtMoney(projClose)}</b> against the
              {" "}<b>{fmtMoney(cogsBudgetFullPeriod)} {periodBudgetLabel}</b>.
            </>
          ) : (
            <>
              <b>{fmtMoney(cogs_left)}</b> left at <b>{fmtMoney(per_day_so_far)}</b> a day.
              {" "}That covers all <b className="kpi-ov-good">{days_remaining} days</b>
              {" "}- the period closes around <b>{fmtMoney(projClose)}</b> against the
              {" "}<b>{fmtMoney(cogsBudgetFullPeriod)} {periodBudgetLabel}</b>.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Verified variant. "How it closed" - the two-cell row + margin box.
function HowItClosedPanel({ payload }) {
  const totals = payload.statement_totals;
  const cogsPB = totals?.cogs?.period_budget;
  const cogsActual = totals?.cogs?.actual;
  const revPB = totals?.revenue?.period_budget;
  const revActual = totals?.revenue?.actual;
  const gmCard = payload.cards?.find(c => c.key === "gross_margin");
  if (cogsPB == null || cogsActual == null || revPB == null || revActual == null) return null;
  const cogsVariance = cogsActual - cogsPB;       // positive = over, bad
  const revVariance = revActual - revPB;          // positive = above, good
  const cogsGood = cogsVariance <= 0;
  const revGood = revVariance >= 0;
  const gmActualPct = gmCard?.pct_of_revenue;
  const gmTargetPct = gmCard?.target_pct_of_revenue;
  const gmDev = (gmActualPct != null && gmTargetPct != null) ? gmActualPct - gmTargetPct : null;
  const gmAhead = gmDev != null && gmDev >= 0;
  // Which moved margin: the side with the larger absolute variance
  // when expressed as % of budget.
  const cogsMagPct = cogsPB > 0 ? Math.abs(cogsVariance / cogsPB) : 0;
  const revMagPct = revPB > 0 ? Math.abs(revVariance / revPB) : 0;
  const revenueMoved = revMagPct >= cogsMagPct;
  const usedPct = cogsPB > 0 ? Math.min(100, (cogsActual / cogsPB) * 100) : 0;

  // Compose the "and which of the two moved the margin" sentence.
  const cogsClause = cogsGood ? "Costs came in under" : "Costs came in over";
  const revClause = revGood ? `revenue landed ${fmtMoney(revVariance)} long` : `revenue landed ${fmtMoney(Math.abs(revVariance))} short`;
  const moverClause = revenueMoved
    ? `the revenue ${revGood ? "run-up" : "miss"} is what moved the margin.`
    : `the cost ${cogsGood ? "restraint" : "overrun"} is what moved the margin.`;

  return (
    <div
      className={`kpi-ov-card ${gmAhead ? "kpi-ov-card-pace-good" : "kpi-ov-card-pace-tight"} kpi-ov-pace`}
      data-kpi-ov="pace-panel"
      data-kpi-ov-pace-variant="verified"
    >
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">How it closed</span>
        <HelpPop
          id="overview-pace-closed"
          title="How it closed"
          body={
            <p>
              The final result for this period. Verdict is settled - cost
              variance is settled spend, revenue variance is finance-verified.
              Says which of costs or revenue moved the margin.
            </p>
          }
        />
        <span className="kpi-ov-pill kpi-ov-pill-good">Verified</span>
      </div>
      <div className="kpi-ov-pace-row2">
        <div className="kpi-ov-pace-cell">
          <div className="kpi-ov-pace-cell-k">Cost of goods</div>
          <div className={`kpi-ov-pace-cell-v kpi-ov-num ${cogsGood ? "kpi-ov-good" : "kpi-ov-bad"}`}>
            {gapDollars(cogsVariance, "under", "over")}
          </div>
          <div className="kpi-ov-pace-cell-n">
            {fmtMoney(cogsActual)} of {fmtMoney(cogsPB)} period budget
          </div>
        </div>
        <div className="kpi-ov-pace-cell">
          <div className="kpi-ov-pace-cell-k">Revenue</div>
          <div className={`kpi-ov-pace-cell-v kpi-ov-num ${revGood ? "kpi-ov-good" : "kpi-ov-bad"}`}>
            {gapDollars(-revVariance, "above", "below")}
          </div>
          <div className="kpi-ov-pace-cell-n">
            {fmtMoney(revActual)} of {fmtMoney(revPB)} period budget
          </div>
        </div>
      </div>
      <div className={`kpi-ov-pace-runwaybox ${gmAhead ? "kpi-ov-pace-runwaybox-good" : "kpi-ov-pace-runwaybox-bad"}`} data-kpi-ov="pace-margin-box">
        <div className="kpi-ov-pace-runwaybox-k">Gross margin closed at</div>
        <div className="kpi-ov-pace-runwaybox-v">{fmtPct(gmActualPct)}</div>
        <div className="kpi-ov-pace-runwaybox-n">
          Against a {fmtPct(gmTargetPct)} target - <b>{gmDev != null ? `${Math.abs(gmDev).toFixed(1)}% ${gmAhead ? "ahead" : "behind"}` : "—"}</b>.
          {" "}{cogsClause}; {revClause}, and {moverClause}
        </div>
      </div>
      <div className="kpi-ov-pace-usedbar" data-kpi-ov="pace-used-bar">
        <i style={{ width: `${usedPct}%`, background: "var(--green-500)" }} aria-hidden="true" />
        <span className="kpi-ov-pace-usedbar-tk" style={{ left: "100%" }} aria-hidden="true" />
      </div>
      <div className="kpi-ov-pace-usedbar-lab">
        <span><b>{fmtPct(usedPct)}</b> of period budget used</span>
        <span><b>100%</b> of the period gone</span>
      </div>
    </div>
  );
}

// sc_counts_without_dollars variant (item 15b). The revenue card
// already renders the em dash; this panel names the absence
// explicitly on the pace surface so the operator sees the
// diagnostic, not a blank pace card.
function CountsWithoutDollarsPanel({ payload }) {
  const sc = payload.sc_counts_without_dollars;
  if (!sc) return null;
  const dates = fmtDatesCovered(sc.dates_covered);
  return (
    <div
      className="kpi-ov-card kpi-ov-card-pace-neutral kpi-ov-pace"
      data-kpi-ov="pace-panel"
      data-kpi-ov-pace-variant="counts-without-dollars"
    >
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Will the budget last</span>
        <HelpPop
          id="overview-pace-counts-without-dollars"
          title="Will the budget last"
          body={
            <p>
              Meal counts on the Service Calendar drive revenue for this
              account. Without counts the board has no dollars to pace
              against - once counts land, the runway math will resume on
              the next fetch.
            </p>
          }
        />
        <span className="kpi-ov-pill kpi-ov-pill-neutral">Waiting on counts</span>
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-heroline">
          <span className="kpi-ov-hero kpi-ov-num kpi-ov-nb">—</span>
          <span className="kpi-ov-htd">no dollars to pace against yet</span>
        </div>
        <div className="kpi-ov-pace-say" data-kpi-ov="pace-sentence">
          <b>{sc.row_count} service days</b>{dates ? ` (${dates})` : ""} on the calendar
          for this period but no meal counts entered. Pace waits on dollars.
        </div>
      </div>
    </div>
  );
}

export default function PacePanel({ payload }) {
  if (!payload) return null;
  // Item 15b takes precedence: the sc_counts_without_dollars state
  // is a diagnostic about the account, not a period-state variant.
  if (payload.sc_counts_without_dollars) {
    return <CountsWithoutDollarsPanel payload={payload} />;
  }
  const state = payload.period_state;
  if (state === "verified") {
    return <HowItClosedPanel payload={payload} />;
  }
  // Open range: runway needs a period boundary. FYTD's what_is_left
  // is null on portfolio scope + closed periods; when null we render
  // nothing rather than a fabricated runway.
  if (state === "open" && payload.what_is_left) {
    return <RunwayPanel payload={payload} />;
  }
  return null;
}
