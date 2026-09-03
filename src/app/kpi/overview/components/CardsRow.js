"use client";
// src/app/kpi/overview/components/CardsRow.js
//
// Three KPI cards in P&L order: Revenue, COGS, Gross margin.
//
// PR-2 items 12+13 (Kevin, 2026-09-02):
//   Revenue - hero = dollars + "period to date"; sub-pair = revenue
//     budget to date + pace (open), and period budget + % recognised.
//     Hero appears exactly once (an earlier render repeated it).
//   COGS    - percent LEADS the hero. Heroline: pct + "of revenue ..."
//     · divider · dollars + "spent". Sub-pair: Target percent + "does
//     not move with revenue"; Budget at this revenue + envelope delta.
//   GM      - percent leads the same way. Sub-pair: Target percent;
//     Amount ahead/behind ($ leading, % as context).
//
// PR-1 item 6 preserved: sc_counts_without_dollars flips revenue
// hero to an em-dash with an "N service days ..." sub-line.

import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

const PILL_TONE = {
  good: "kpi-ov-pill-good",
  warn: "kpi-ov-pill-warn",
  bad: "kpi-ov-pill-bad",
  neutral: "kpi-ov-pill-neutral",
};

const HELP_BODIES = {
  revenue: <p>What this account bills for the food and service delivered. Every cost below is judged as a percent of this number.</p>,
  cogs: <p>Labor, food purchased, packaging and supplies, vehicle - the lines the operator controls. Judged as a percent of revenue. Target percent is set at budget and does not move when revenue moves.</p>,
  gross_margin: <p>Revenue minus cost of goods sold. This is the account-level measure. Stops here - SG&A is not part of it, so this is not profit.</p>,
};

function Pill({ pill }) {
  if (!pill) return null;
  const tone = PILL_TONE[pill.tone] || "kpi-ov-pill-neutral";
  return (
    <span className={`kpi-ov-pill ${tone}`} data-kpi-ov="pill" data-kpi-ov-tone={pill.tone}>
      {pill.label}
    </span>
  );
}

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

// Kevin 2026-09-02 language pass Items 5, 8, 12: hero descriptor
// reads range_labels.through verbatim ("thru P8" on FYTD + single
// verified, "period to date" on single open). No per-surface
// rewrite; the server helper owns the string.
//
// Kevin R-60 / PR-B items 1-3 (2026-09-03): fork by callsite. Revenue
// hero uses `actuals` ("Final P8" on single_closed); COGS/GM heroline
// uses `through` ("of revenue in P8" on single_closed). Same
// horizon, different preposition/noun.
function labelActuals(rangeLabels, periodState) {
  const actuals = rangeLabels?.actuals;
  if (actuals) return actuals;
  if (periodState === "verified") return "final";
  return "period to date";
}
function labelThrough(rangeLabels, periodState) {
  const through = rangeLabels?.through;
  if (through) return through;
  if (periodState === "verified") return "final";
  return "period to date";
}
// The right-hand budget label on the Revenue card. Item 7: `Year
// budget` stays on FYTD (full-year context is still useful). Item 6
// applies to the LEFT sub-pair (below).
function labelBudget(range, periodState) {
  if (range?.kind === "fytd") return "Year budget";
  if (range?.period_no != null) return `P${range.period_no} budget`;
  return "Period budget";
}

function RevenueCard({ card, range, periodState, revenuePacePct, scCountsWithoutDollars, rangeComposition, rangeLabels }) {
  // Item 1 (Kevin 2026-09-03): Revenue hero uses `actuals` -
  // "Final P8" on single_closed, "thru P8" on FYTD, "period to
  // date" on single_open.
  const ptd = labelActuals(rangeLabels, periodState);
  const budgetLabel = labelBudget(range, periodState);
  // Item 4: eyebrow "Revenue actuals P1-P8" on FYTD; on a single
  // period "Revenue actuals P8"; on single open (no period suffix
  // makes sense) keep the classic "Revenue" label from card.label.
  const eyebrowLabel = (rangeLabels?.kind === "fytd" || rangeLabels?.kind === "single_closed")
    ? (rangeLabels.period_span ? `Revenue actuals ${rangeLabels.period_span}` : card.label)
    : card.label;
  // Item 6: LEFT sub-pair "Revenue budget P1-P8" replacing "Revenue
  // budget to date". On single closed: "Revenue budget P8". On
  // single open: "Revenue budget period to date".
  const leftBudgetLabel = rangeLabels?.period_span
    ? `Revenue budget ${rangeLabels.period_span}`
    : (rangeLabels?.through ? `Revenue budget ${rangeLabels.through}` : "Revenue budget to date");
  const dates = scCountsWithoutDollars?.dates_covered;
  const scRowCount = scCountsWithoutDollars?.row_count;
  const isOpenRange = periodState === "open";
  const paceDirection = revenuePacePct != null ? (revenuePacePct >= 100 ? "good" : "bad") : null;
  const paceMag = revenuePacePct != null ? Math.abs(revenuePacePct - 100).toFixed(1) : null;
  const paceWord = revenuePacePct != null ? (revenuePacePct >= 100 ? "over" : "under") : null;
  const revBudTd = card.budget_to_date;
  const revBudFull = card.budget_full_period;
  const revBudFullYear = card.budget_full_year;
  const revActual = card.hero_actual;
  // Kevin ruling 2026-09-02: pctRecognised must be computed against
  // the SAME figure the card displays as its denominator. On FYTD
  // the card shows budget_full_year ($1.92M on TBJ - FL) but the
  // percent was previously derived from budget_full_period ($1.68M),
  // giving 106.5% recognised when the honest ratio is 93.1%. Pick
  // the denominator to match what the card shows.
  const pctRecognisedDenom = range?.kind === "fytd" ? revBudFullYear : revBudFull;
  const pctRecognised = (revActual != null && pctRecognisedDenom != null && pctRecognisedDenom > 0)
    ? (revActual / pctRecognisedDenom) * 100 : null;
  // Item 12: closed period collapses to one budget column (period_
  // budget only); open period + FYTD carry both budget-to-date and
  // full-period. FYTD (now closed-only) still shows the LEFT sub-
  // pair because the "Revenue budget P1-P8" label + "Year budget"
  // are two distinct comparisons Kevin wants side-by-side (Item 6
  // vs Item 7).
  const showBudgetToDate = periodState !== "verified" || range?.kind === "fytd";
  // FYTD: right budget cell is "Year budget"; open period: period
  // budget. Content the same shape.

  // sc_counts_without_dollars: hero em dash, sub names row count +
  // dates (item 15b).
  if (scCountsWithoutDollars) {
    return (
      <div className="kpi-ov-card kpi-ov-card-rev" data-kpi-ov="card-revenue">
        <div className="kpi-ov-ch">
          <span className="kpi-ov-eb">{eyebrowLabel}</span>
          <HelpPop id="overview-card-revenue" title="Revenue" body={HELP_BODIES.revenue} />
          <Pill pill={card.pill} />
        </div>
        <div className="kpi-ov-cb">
          <div className="kpi-ov-hero kpi-ov-num kpi-ov-nb" data-kpi-ov="hero-revenue">
            <span>—</span>
            <small>{ptd}</small>
          </div>
          <div className="kpi-ov-sub" data-kpi-ov="revenue-sub-sc-absent">
            <b>{scRowCount}</b> service days
            {dates?.first && dates?.last && (
              <> ({String(dates.first).slice(5)} – {String(dates.last).slice(5)})</>
            )}
            {" "}on the calendar; no meal counts entered yet.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kpi-ov-card kpi-ov-card-rev" data-kpi-ov="card-revenue">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{eyebrowLabel}</span>
        <HelpPop id="overview-card-revenue" title="Revenue" body={HELP_BODIES.revenue} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-hero kpi-ov-num" data-kpi-ov="hero-revenue">
          <DashOrValue value={card.hero_actual_display} reported={card.hero_reported} />
          <small>{ptd}</small>
        </div>
        <div className={`kpi-ov-hz ${showBudgetToDate ? "" : "kpi-ov-hz-one"}`} data-kpi-ov="card-hz">
          {showBudgetToDate && (
            <div>
              <div className="kpi-ov-hz-k">{leftBudgetLabel}</div>
              <div className="kpi-ov-hz-v kpi-ov-num">
                {revBudTd != null ? fmtMoney(revBudTd) : "—"}
                {paceMag != null && (
                  <span className={paceDirection === "good" ? " kpi-ov-good" : " kpi-ov-bad"}>
                    {" · "}{paceMag}% {paceWord}
                  </span>
                )}
              </div>
            </div>
          )}
          <div>
            <div className="kpi-ov-hz-k">{budgetLabel}</div>
            <div className="kpi-ov-hz-v kpi-ov-num">
              {range?.kind === "fytd"
                ? (revBudFullYear != null ? fmtMoney(revBudFullYear) : "—")
                : (revBudFull != null ? fmtMoney(revBudFull) : "—")}
              {/* Kevin PR-B item 8 (2026-09-03): "N.N% recognised" is
                  finance jargon on an operator surface. Show the
                  dollar gap and the direction word instead - that's
                  what the operator acts on; the percentage is
                  derivable. Kevin proposed "$4,193 under the P8
                  budget"; wording rules with him. */}
              {pctRecognised != null && pctRecognisedDenom != null && (() => {
                const delta = revActual - pctRecognisedDenom;
                if (Math.abs(delta) < 1) return null;
                const dir = delta < 0 ? "under" : "over";
                return (
                  <span className="kpi-ov-hz-note">
                    {" · "}{fmtMoney(Math.abs(delta))} {dir} the {budgetLabel.toLowerCase()}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
        {/* Kevin 2026-09-02 blocker Item 3: composition summary. Beneath
            the budget pair; absent on single-period ranges (where it
            would restate the pill). Reads range_composition.summary
            verbatim - server owns the sentence, so the four surfaces
            can't drift. */}
        {rangeComposition && rangeComposition.periods_total > 1 && rangeComposition.summary && (
          <div
            className="kpi-ov-sub kpi-ov-rev-composition"
            data-kpi-ov="revenue-composition-summary"
          >
            {rangeComposition.summary}
          </div>
        )}
      </div>
    </div>
  );
}

// COGS + GM share a heroline shape: pct leads, dollars trail after
// a divider. Sub-pair varies by card.
function PercentLeadCard({ card, range, periodState, kind, extra, rangeLabels }) {
  // Items 2+3 (Kevin 2026-09-03): COGS/GM heroline "of revenue
  // {through}" - "of revenue thru P8" on FYTD, "of revenue in P8"
  // on single_closed, "of revenue period to date" on single_open.
  const ptd = labelThrough(rangeLabels, periodState);
  const heroPctText = card.pct_of_revenue_display;
  const heroActualText = card.hero_actual_display;
  const isCogs = kind === "cogs";
  const hasTarget = extra?.hasTarget;
  const targetPctText = card.target_pct_display;
  const batrText = fmtMoney(card.budget_at_this_revenue);
  const envDelta = card.envelope_delta;
  const revenueIsPlanned = extra?.revenueIsPlanned;
  // heroClass: percent color derived from delta_direction; the pct is
  // the hero on both cards.
  const heroColorClass = hasTarget
    ? (card.pill?.tone === "good" ? "kpi-ov-good" : card.pill?.tone === "bad" ? "kpi-ov-bad" : "")
    : "";
  // GM sub-pair "Amount ahead/behind" - dollars leading, percent as
  // context. Read from delta_display (dollars) + card.pct_of_revenue -
  // card.target_pct_of_revenue.
  const gmDev = (!isCogs && card.pct_of_revenue != null && card.target_pct_of_revenue != null)
    ? card.pct_of_revenue - card.target_pct_of_revenue : null;
  const gmAhead = gmDev != null && gmDev >= 0;
  const gmDollarText = (!isCogs && gmDev != null && card.hero_actual != null)
    ? fmtMoney(Math.abs((gmDev / 100) * (card.hero_actual / (card.pct_of_revenue || 1) * 100)))
    : null;
  // Simpler: dollar amount ahead/behind = |delta_dollars| when
  // available on the card. Fall back to the derived form above.
  const gmDollarPreferred = (!isCogs && card.delta_dollars != null)
    ? fmtMoney(Math.abs(card.delta_dollars)) : gmDollarText;

  return (
    <div className={`kpi-ov-card ${isCogs ? "kpi-ov-card-cogs" : "kpi-ov-card-gm"}`} data-kpi-ov={`card-${kind}`}>
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id={`overview-card-${kind}`} title={card.label} body={HELP_BODIES[kind]} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-heroline">
          <span className={`kpi-ov-hero kpi-ov-num ${heroColorClass}`} data-kpi-ov={`hero-${kind}`}>
            {heroPctText || "—"}
          </span>
          <span className="kpi-ov-htd">of revenue {ptd}</span>
          <span className="kpi-ov-heroline-dv" aria-hidden="true">·</span>
          <span className="kpi-ov-heroline-sec kpi-ov-num">
            {heroActualText || "—"}
            {/* Item 9 (Kevin 2026-09-03): "margin" -> "gross margin" -
                the account-level noun the P&L uses. */}
            <small>{isCogs ? "spent" : "gross margin"}</small>
          </span>
        </div>
        <div className="kpi-ov-hz" data-kpi-ov="card-hz">
          <div>
            <div className="kpi-ov-hz-k">Target percent</div>
            <div className="kpi-ov-hz-v kpi-ov-num">
              {hasTarget ? (
                <>
                  {targetPctText || "—"}
                  <span className="kpi-ov-hz-note"> does not move with revenue</span>
                </>
              ) : (
                <span className="kpi-ov-nb">no target on this range</span>
              )}
            </div>
          </div>
          <div>
            {isCogs ? (
              <>
                {/* Item 9: "Budget at this revenue" -> "Adjusted budget".
                    Item 10: envelope delta is NEUTRAL, not a verdict -
                    render in purple with a direction arrow and the word
                    more or less. Revenue moving the envelope is a
                    consequence, not performance. */}
                <div className="kpi-ov-hz-k">Adjusted budget</div>
                <div className="kpi-ov-hz-v kpi-ov-num">
                  {!hasTarget ? <span className="kpi-ov-nb">—</span>
                    : batrText == null ? "—"
                    : (
                      <>
                        {batrText}
                        {envDelta != null && Math.abs(envDelta) >= 1 && (
                          <span
                            className="kpi-ov-envelope-note"
                            data-kpi-ov="envelope-delta"
                          >
                            {" · "}{envDelta < 0 ? "↑" : "↓"} {fmtMoney(Math.abs(envDelta))} {envDelta < 0 ? "more" : "less"}
                          </span>
                        )}
                        {envDelta != null && Math.abs(envDelta) < 1 && revenueIsPlanned && (
                          <span className="kpi-ov-hz-note"> matches plan · revenue is planned</span>
                        )}
                      </>
                    )}
                </div>
              </>
            ) : (
              <>
                <div className="kpi-ov-hz-k">{hasTarget ? `Amount ${gmAhead ? "ahead" : "behind"}` : "Margin made"}</div>
                <div className={`kpi-ov-hz-v kpi-ov-num ${hasTarget ? (gmAhead ? "kpi-ov-good" : "kpi-ov-bad") : ""}`}>
                  {hasTarget && gmDollarPreferred != null ? (
                    <>
                      {gmDollarPreferred}
                      {gmDev != null && (
                        <span className="kpi-ov-hz-note"> · {Math.abs(gmDev).toFixed(1)}% of revenue</span>
                      )}
                    </>
                  ) : (
                    <>{heroActualText || "—"}<span className="kpi-ov-hz-note"> · no target to compare</span></>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CardsRow({ cards, rangeMeta, scCountsWithoutDollars, hasTarget, revenuePacePct, revenueSourceState, rangeComposition, rangeLabels }) {
  if (!Array.isArray(cards)) return null;
  const revenue = cards.find(c => c.key === "revenue");
  const cogs    = cards.find(c => c.key === "cogs");
  const gm      = cards.find(c => c.key === "gross_margin");
  const periodState = rangeMeta?.period_state;
  const revenueIsPlanned = revenueSourceState === "planned";
  return (
    <div className="kpi-ov-cards" data-kpi-ov="cards-row">
      {revenue && (
        <RevenueCard
          card={revenue}
          range={rangeMeta}
          periodState={periodState}
          revenuePacePct={revenuePacePct}
          scCountsWithoutDollars={scCountsWithoutDollars}
          rangeComposition={rangeComposition}
          rangeLabels={rangeLabels}
        />
      )}
      {cogs && (
        <PercentLeadCard
          card={cogs}
          range={rangeMeta}
          periodState={periodState}
          kind="cogs"
          extra={{ hasTarget, revenueIsPlanned }}
          rangeLabels={rangeLabels}
        />
      )}
      {gm && (
        <PercentLeadCard
          card={gm}
          range={rangeMeta}
          periodState={periodState}
          kind="gross_margin"
          extra={{ hasTarget }}
          rangeLabels={rangeLabels}
        />
      )}
    </div>
  );
}
