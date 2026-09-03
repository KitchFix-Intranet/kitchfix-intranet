"use client";
// src/app/kpi/overview/components/CardsRow.js
//
// Three KPI cards in P&L order: Revenue, COGS, Gross margin.
//
// Kevin ruling 2026-09-03 (top-simplify). Each card renders exactly
// two figures + a pill:
//
//   Card           TOP (Actual, coloured)   BOTTOM (Reference, grey)   PILL
//   Revenue        Actual $1,702,872        Budget $1,575,515          Above / Below
//   Cost of goods  Actual 52.6%             Target 50.9%               1.7% over / under
//   Gross margin   Actual 47.4%             Target 49.1%               1.7% below / above
//
// The reference row sits one size smaller and grey so the eye lands
// on the result. The pill carries the gap so the number is not stated
// twice. Revenue reads dollars; cost + margin read percent.
//
// Horizon (item 4):
//   Closed range - rows read "Actual" and "Budget" plainly
//   Open range   - rows read "Actual to date" and "Budget to date"
//   Target row keeps "Target" (no time dimension).
//
// Note on ordering (write once, don't let a future reader "fix" it):
// the CARDS now read actual-first. The TABLES still read budget-first
// (item 3 of the column-order PR). Deliberate. A table is scanned
// across many rows and needs a stable reference column on the left;
// a card is one comparison seen at once, where the eye lands rather
// than scans. Different reading mode, different order.
//
// Two pieces of context moved into the ? tooltips rather than out of
// existence: the envelope-delta sentence lives inside the COGS ?, and
// the full-year budget lives inside the Revenue ? on FYTD. Both
// consume live payload figures.

import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

const PILL_TONE = {
  good: "kpi-ov-pill-good",
  warn: "kpi-ov-pill-warn",
  bad: "kpi-ov-pill-bad",
  neutral: "kpi-ov-pill-neutral",
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

// Item 4: horizon in the row labels. Open range means the two figures
// carry a time dimension; closed range does not.
//
// Kevin ruling 2026-09-03 follow-up: the Revenue card's reference row
// reads Forecast (not Budget), on every account and every range. Cost
// and margin cards still measure against a Target, so this rename
// only applies to Revenue.
function actualLabel(periodState) {
  return periodState === "open" ? "Actual to date" : "Actual";
}
function forecastLabel(periodState) {
  return periodState === "open" ? "Forecast to date" : "Forecast";
}

// Static tooltip fragments. Envelope + full-year live figures merged
// in per-card below because they need payload values.
const HELP_BODIES = {
  revenue_base:
    "What this account bills for the food and service delivered. Every cost below is judged as a percent of this number.",
  cogs_base_sc:
    "Labor, food purchased, packaging and supplies, vehicle - the lines the operator controls. Judged as a percent of revenue. Target percent is set at budget and does not move when revenue moves.",
  cogs_base_fee:
    "Labor, food purchased, packaging and supplies, vehicle - the lines the operator controls. Judged as a percent of revenue. Revenue on this account is contractual, so the period budget is fixed - the target percent buys the same dollars every period.",
  gross_margin:
    "Revenue minus cost of goods sold. This is the account-level measure. Stops here - SG&A is not part of it, so this is not profit.",
};

// Kevin 2026-09-03: envelope-delta was the "$64,845 more" note on the
// COGS card. Off the card face; concept still load-bearing (R-45)
// because it explains why Adjusted Budget in the tables differs from
// the plan. Moved into the COGS tooltip with the live figure.
function cogsTooltip({ isManagementFee, envelopeDelta, hasTarget }) {
  const base = isManagementFee ? HELP_BODIES.cogs_base_fee : HELP_BODIES.cogs_base_sc;
  if (isManagementFee || !hasTarget || envelopeDelta == null || Math.abs(envelopeDelta) < 1) {
    return <p>{base}</p>;
  }
  // envelope_delta sign: negative = revenue ran ABOVE plan (envelope
  // is BIGGER); positive = revenue ran BELOW plan (envelope is
  // SMALLER). See resolver.js envelopeDelta.
  const bigger = envelopeDelta < 0;
  const magnitude = fmtMoney(Math.abs(envelopeDelta));
  const sentence = bigger
    ? `Adjusted budget is what your target percent buys at the revenue you actually made. Revenue is running above plan, so the envelope is ${magnitude} more than the original budget allowed.`
    : `Adjusted budget is what your target percent buys at the revenue you actually made. Revenue is running below plan, so the envelope is ${magnitude} less than the original budget allowed.`;
  return (
    <>
      <p>{base}</p>
      <p style={{ marginTop: 8 }} data-kpi-ov="cogs-tip-envelope">{sentence}</p>
    </>
  );
}

// Kevin 2026-09-03: full-year budget was the "$1,921,966" number on
// the Revenue card's FYTD render. Off the card face; still worth
// telling an operator on FYTD what the year's number is. Moved into
// the Revenue tooltip with the live figure.
function revenueTooltip({ rangeKind, budgetFullYear, rangeLabels }) {
  const base = HELP_BODIES.revenue_base;
  if (rangeKind !== "fytd" || budgetFullYear == null) {
    return <p>{base}</p>;
  }
  const span = rangeLabels?.period_span || null;
  const spanText = span ? `Revenue actuals for ${span.replace("-", " through ")}, measured against the budget for those same periods.` : null;
  const yearText = `The full-year budget is ${fmtMoney(budgetFullYear)}.`;
  return (
    <>
      <p>{base}</p>
      <p style={{ marginTop: 8 }} data-kpi-ov="revenue-tip-year">
        {spanText ? `${spanText} ` : ""}{yearText}
      </p>
    </>
  );
}

// Revenue card - dollars. Top row = Actual, bottom = Budget.
// The reference figure on Revenue is the range-appropriate budget:
//   open   -> budget_to_date       ("Budget to date $X")
//   closed -> budget_full_period   ("Budget $X")   for single_closed
//   FYTD closed -> budget_to_date  (FYTD budget through last-closed)
function RevenueCard({ card, range, periodState, rangeLabels, scCountsWithoutDollars }) {
  const isOpen = periodState === "open";
  const budgetRef = isOpen
    ? card.budget_to_date
    : (range?.kind === "fytd" ? card.budget_to_date : card.budget_full_period);
  const budgetRefText = fmtMoney(budgetRef);
  const actualText = card.hero_actual_display;
  const eyebrowLabel = (rangeLabels?.kind === "fytd" || rangeLabels?.kind === "single_closed")
    ? (rangeLabels.period_span ? `Revenue actuals ${rangeLabels.period_span}` : card.label)
    : card.label;
  const actualToneCls = card.delta_direction === "good" ? "kpi-ov-good"
    : card.delta_direction === "bad" ? "kpi-ov-bad"
    : "";

  const helpBody = revenueTooltip({
    rangeKind: range?.kind,
    budgetFullYear: card.budget_full_year,
    rangeLabels,
  });

  // sc_counts_without_dollars: revenue is an absence, not a zero.
  // Hero em-dash + service-days sub-line, unchanged behaviour.
  if (scCountsWithoutDollars) {
    const dates = scCountsWithoutDollars?.dates_covered;
    const scRowCount = scCountsWithoutDollars?.row_count;
    return (
      <div className="kpi-ov-card kpi-ov-card-rev" data-kpi-ov="card-revenue">
        <div className="kpi-ov-ch">
          <span className="kpi-ov-eb">{eyebrowLabel}</span>
          <HelpPop id="overview-card-revenue" title="Revenue" body={helpBody} />
          <Pill pill={card.pill} />
        </div>
        <div className="kpi-ov-cb">
          <div className="kpi-ov-hero kpi-ov-num kpi-ov-nb" data-kpi-ov="hero-revenue">
            <span>—</span>
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
        <HelpPop id="overview-card-revenue" title="Revenue" body={helpBody} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-pair" data-kpi-ov="card-actual">
          <span className="kpi-ov-pair-k">{actualLabel(periodState)}</span>
          <span className={`kpi-ov-pair-v kpi-ov-num ${actualToneCls}`} data-kpi-ov="hero-revenue">
            <DashOrValue value={actualText} reported={card.hero_reported} />
          </span>
        </div>
        <div className="kpi-ov-pair-rule" aria-hidden="true" />
        <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="card-reference">
          <span className="kpi-ov-pair-k">{forecastLabel(periodState)}</span>
          <span className="kpi-ov-pair-v kpi-ov-num">
            {budgetRefText != null ? budgetRefText : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

// COGS + GM card - percent. Top = Actual %, bottom = Target %.
// Pill carries the gap. Actual takes verdict colour; target stays
// neutral grey.
function PercentLeadCard({ card, range, periodState, kind, extra, rangeLabels, revenueModel }) {
  const isCogs = kind === "cogs";
  const isManagementFee = revenueModel === "management_fee";
  const hasTarget = extra?.hasTarget;
  const actualText = card.pct_of_revenue_display;
  const targetText = card.target_pct_display;
  const actualToneCls = card.pill?.tone === "good" ? "kpi-ov-good"
    : card.pill?.tone === "bad" ? "kpi-ov-bad"
    : "";

  // Kevin ruling final-presentation (2026-09-03) item 2: the percent
  // stays the hero; a small grey dollar sits after it. Both cards
  // read the same shape.
  //   COGS   actual $ = hero_actual_display, target $ = budget_at_this_revenue_display
  //   GM     actual $ = hero_actual_display, target $ = budget_at_this_revenue_display
  //          (GM's batr = revenue - cogs_batr, shipped by resolver)
  const actualDollarText = card.hero_actual_display;
  const targetDollarText = card.budget_at_this_revenue_display;

  const helpBody = isCogs
    ? cogsTooltip({
        isManagementFee,
        envelopeDelta: card.envelope_delta,
        hasTarget,
      })
    : <p>{HELP_BODIES.gross_margin}</p>;

  return (
    <div className={`kpi-ov-card ${isCogs ? "kpi-ov-card-cogs" : "kpi-ov-card-gm"}`} data-kpi-ov={`card-${kind}`}>
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id={`overview-card-${kind}`} title={card.label} body={helpBody} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-pair" data-kpi-ov="card-actual">
          <span className="kpi-ov-pair-k">{actualLabel(periodState)}</span>
          <span className={`kpi-ov-pair-v kpi-ov-num ${actualToneCls}`} data-kpi-ov={`hero-${kind}`}>
            {actualText || "—"}
            {actualDollarText && (
              <small className="kpi-ov-pair-sub" data-kpi-ov={`hero-${kind}-dollar`}>{actualDollarText}</small>
            )}
          </span>
        </div>
        <div className="kpi-ov-pair-rule" aria-hidden="true" />
        <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="card-reference">
          <span className="kpi-ov-pair-k">Target</span>
          <span className="kpi-ov-pair-v kpi-ov-num">
            {hasTarget ? (
              <>
                {targetText || "—"}
                {targetDollarText && (
                  <small className="kpi-ov-pair-sub" data-kpi-ov={`target-${kind}-dollar`}>{targetDollarText}</small>
                )}
              </>
            ) : <span className="kpi-ov-nb">—</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function CardsRow({ cards, rangeMeta, scCountsWithoutDollars, hasTarget, revenueSourceState, rangeLabels, revenueModel }) {
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
          scCountsWithoutDollars={scCountsWithoutDollars}
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
          revenueModel={revenueModel}
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
          revenueModel={revenueModel}
        />
      )}
    </div>
  );
}
