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
function actualLabel(periodState, throughWkLabel) {
  // Kevin Prompt 1 item 1c (2026-09-04): "Actual to date" -> "Actuals
  // wk 1 – wk N" so the operator sees the week count they're already
  // reading, not a generic to-date phrase. Falls back to the plain
  // form when the range label doesn't carry a week count (aggregate
  // ranges, portfolio scope).
  if (periodState !== "open") return "Actual";
  return throughWkLabel ? `Actuals ${throughWkLabel}` : "Actual to date";
}
function forecastLabel(periodState, throughWkLabel) {
  if (periodState !== "open") return "Forecast";
  return throughWkLabel ? `Forecast ${throughWkLabel}` : "Forecast to date";
}

// Kevin Prompt 1 item 1a (2026-09-04): third block under each card,
// below the dashed rule, separated by a hairline. Shows the whole-
// period budget + how much is left (or "to earn" on the margin card),
// with a gauge below - fill is spend against period budget, notch is
// where complete weeks over total weeks should put you.
//
// Suppressed on closed ranges (a finished period has no "left") and
// when the period_budget is null/zero.
//
// `variant` values:
//   "cost"     over = red/bad,  under = green/good, label "left"/"over"
//   "revenue"  over = green/good (overshooting revenue is good), label "over"/"left"
//   "margin"   fill is purple, label is "to earn" (margin is earned not spent)
function PeriodBlock({ label, spent, budget, weeksDone, weeksTotal, variant }) {
  if (budget == null || Math.abs(budget) < 1) return null;
  if (spent == null) return null;
  const left = budget - spent;
  const over = left < 0;
  const pct = Math.min(100, Math.max(0, (Math.abs(spent) / Math.abs(budget)) * 100));
  const notchPct = (weeksTotal && weeksTotal > 0)
    ? Math.min(100, Math.max(0, (weeksDone / weeksTotal) * 100))
    : null;
  let leftTone, leftWord, fillColor;
  if (variant === "margin") {
    leftTone = "kpi-ov-nb";  // grey - margin has no over/under valence on the card
    leftWord = "to earn";
    fillColor = "var(--kpi-purple, #7c3aed)";
  } else if (variant === "revenue") {
    leftTone = over ? "kpi-ov-good" : "kpi-ov-nb";
    leftWord = over ? "over" : "left";
    fillColor = over ? "var(--green-600)" : "var(--navy-700)";
  } else {
    // cost (default)
    leftTone = over ? "kpi-ov-bad" : "kpi-ov-good";
    leftWord = over ? "over" : "left";
    fillColor = over ? "var(--red-600)" : "var(--navy-700)";
  }
  const dispAmount = Math.abs(Math.round(left));
  const leftText = "$" + dispAmount.toLocaleString("en-US");
  const budgetText = fmtMoney(budget);
  return (
    <div className="kpi-ov-perb" data-kpi-ov="card-period-block">
      <span className="kpi-ov-perb-k">{label}</span>
      <span className="kpi-ov-perb-v kpi-ov-num" data-kpi-ov="perb-budget">{budgetText}</span>
      <span className={`kpi-ov-perb-left kpi-ov-num ${leftTone}`} data-kpi-ov="perb-left">{leftText}</span>
      <span className="kpi-ov-perb-lw">{leftWord}</span>
      <div className="kpi-ov-perb-gauge" data-kpi-ov="perb-gauge">
        <i style={{ width: `${pct}%`, background: fillColor }} data-kpi-ov="perb-gauge-fill" />
        {notchPct != null && (
          <span className="kpi-ov-perb-gauge-mark" style={{ left: `${notchPct}%` }} data-kpi-ov="perb-gauge-mark" />
        )}
      </div>
    </div>
  );
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

// Kevin Prompt 1 item 1c (2026-09-04): "Actuals wk 1 – wk N" wording
// derived from the same range_labels.spanHeader / horizon fields the
// resolver already emits. Returns a lowercase phrase ("wk 1 – wk 3")
// for card + table labels. Null when the range doesn't carry a week
// count (closed / aggregate / portfolio scope).
function throughWkPhrase(rangeLabels, periodState) {
  if (periodState !== "open") return null;
  // range_labels.spanHeader is "WK 1 – WK 3" or "WK 1" - already the
  // form we want, just case-transform. Fallback via horizon regex if
  // spanHeader is absent.
  const raw = rangeLabels?.spanHeader || rangeLabels?.actuals_header || null;
  if (raw) {
    // "WK 1 – WK 3 ACTUALS" -> "WK 1 – WK 3", then lowercase "wk"
    return raw.replace(/\s+ACTUALS\s*$/i, "").toLowerCase().replace(/^wk/, "wk");
  }
  // Fallback: parse from horizon "through week 3 · 08/10 – 08/30"
  const m = /through week (\d+)/i.exec(rangeLabels?.horizon || "");
  if (m) {
    const n = parseInt(m[1], 10);
    return n === 1 ? "wk 1" : `wk 1 – wk ${n}`;
  }
  return null;
}
// Weeks-done / weeks-total for the gauge notch. Standard KPI period
// is 4 weeks; open period range gives weeksDone from horizon.
function weekCountFrom(rangeLabels, rangeMeta) {
  if (rangeMeta?.kind !== "period") return { done: null, total: null };
  const m = /through week (\d+)/i.exec(rangeLabels?.horizon || "");
  if (!m) return { done: null, total: 4 };
  return { done: parseInt(m[1], 10), total: 4 };
}
// Period-total label - matches render "P9 budget total" / "P9 forecast".
function periodTotalLabel(rangeMeta, kind) {
  const n = rangeMeta?.period_no;
  const pfx = n != null ? `P${n} ` : "";
  return kind === "revenue" ? `${pfx}forecast total` : `${pfx}budget total`;
}

// Revenue card - dollars. Top row = Actual, bottom = Budget.
// The reference figure on Revenue is the range-appropriate budget:
//   open   -> budget_to_date       ("Budget to date $X")
//   closed -> budget_full_period   ("Budget $X")   for single_closed
//   FYTD closed -> budget_to_date  (FYTD budget through last-closed)
function RevenueCard({ card, range, periodState, rangeLabels, scCountsWithoutDollars, periodBudget, weeksDone, weeksTotal, throughWkLabel }) {
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
          <span className="kpi-ov-pair-k">{actualLabel(periodState, throughWkLabel)}</span>
          <span className={`kpi-ov-pair-v kpi-ov-num ${actualToneCls}`} data-kpi-ov="hero-revenue">
            <DashOrValue value={actualText} reported={card.hero_reported} />
          </span>
        </div>
        <div className="kpi-ov-pair-rule" aria-hidden="true" />
        <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="card-reference">
          <span className="kpi-ov-pair-k">{forecastLabel(periodState, throughWkLabel)}</span>
          <span className="kpi-ov-pair-v kpi-ov-num">
            {budgetRefText != null ? budgetRefText : "—"}
          </span>
        </div>
        {/* Kevin Prompt 1 item 1a (2026-09-04): third block below the
            dashed rule with period-total budget + how much is left.
            Suppressed on closed ranges (finished period has no left)
            and when period_budget is null/0. On revenue over-budget
            is GOOD (booking more than planned), so the "over" state
            uses the good tone. */}
        {periodState === "open" && (
          <PeriodBlock
            label={periodTotalLabel(range, "revenue")}
            spent={card.hero_actual}
            budget={periodBudget}
            weeksDone={weeksDone}
            weeksTotal={weeksTotal}
            variant="revenue"
          />
        )}
      </div>
    </div>
  );
}

// COGS + GM card - percent. Top = Actual %, bottom = Target %.
// Pill carries the gap. Actual takes verdict colour; target stays
// neutral grey.
function PercentLeadCard({ card, range, periodState, kind, extra, rangeLabels, revenueModel, periodBudget, weeksDone, weeksTotal, throughWkLabel }) {
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
          <span className="kpi-ov-pair-k">{actualLabel(periodState, throughWkLabel)}</span>
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
        {/* Kevin Prompt 1 item 1a (2026-09-04): third block on cost +
            margin cards. COGS uses "left/over" language with the
            standard cost tone (over = red); margin uses "to earn"
            with a neutral tone (margin is earned not spent, and red
            is reserved for missing a target - Kevin's R-75 rule). */}
        {periodState === "open" && (
          <PeriodBlock
            label={periodTotalLabel(range, kind)}
            spent={card.hero_actual}
            budget={periodBudget}
            weeksDone={weeksDone}
            weeksTotal={weeksTotal}
            variant={isCogs ? "cost" : "margin"}
          />
        )}
      </div>
    </div>
  );
}

export default function CardsRow({ cards, rangeMeta, scCountsWithoutDollars, hasTarget, revenueSourceState, rangeLabels, revenueModel, statementTotals }) {
  if (!Array.isArray(cards)) return null;
  const revenue = cards.find(c => c.key === "revenue");
  const cogs    = cards.find(c => c.key === "cogs");
  const gm      = cards.find(c => c.key === "gross_margin");
  const periodState = rangeMeta?.period_state;
  const revenueIsPlanned = revenueSourceState === "planned";
  // Kevin Prompt 1 item 1a (2026-09-04): period-total budgets are
  // already emitted by the resolver at statement_totals.*.period_budget
  // - no resolver change needed. Read them here and pass to each card
  // for the third block. GM's period_budget is derived (revenue_pb
  // minus cogs_pb) since the resolver doesn't ship a top-level
  // gross_margin.period_budget.
  const revPb = statementTotals?.revenue?.period_budget ?? null;
  const cogPb = statementTotals?.cogs?.period_budget ?? null;
  const gmPb  = (revPb != null && cogPb != null) ? (revPb - cogPb) : null;
  const throughWkLabel = throughWkPhrase(rangeLabels, periodState);
  const { done: weeksDone, total: weeksTotal } = weekCountFrom(rangeLabels, rangeMeta);
  return (
    <div className="kpi-ov-cards" data-kpi-ov="cards-row">
      {revenue && (
        <RevenueCard
          card={revenue}
          range={rangeMeta}
          periodState={periodState}
          scCountsWithoutDollars={scCountsWithoutDollars}
          rangeLabels={rangeLabels}
          periodBudget={revPb}
          weeksDone={weeksDone}
          weeksTotal={weeksTotal}
          throughWkLabel={throughWkLabel}
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
          periodBudget={cogPb}
          weeksDone={weeksDone}
          weeksTotal={weeksTotal}
          throughWkLabel={throughWkLabel}
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
          periodBudget={gmPb}
          weeksDone={weeksDone}
          weeksTotal={weeksTotal}
          throughWkLabel={throughWkLabel}
        />
      )}
    </div>
  );
}
