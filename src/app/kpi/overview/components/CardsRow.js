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
  // Kevin R-94 (2026-09-09). Amber "Provisional" pill on cost +
  // margin cards when the period is closed but not yet verified.
  wait: "kpi-ov-pill-wait",
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

// Kevin post-1060 sweep (2026-09-09). Variance footer under each of
// the three Overview cards. Render of record:
// docs/renders/overview-cards-variance-footer.html. Kevin's rulings:
//
// - Label per card: cost "Over/Under target", margin "Ahead of/Behind
//   target", revenue "Above/Below projection".
// - Arrow tracks the ARITHMETIC direction (▲ if delta > 0, ▼ if
//   delta < 0). Colour follows the MEANING per axis: cost over = bad
//   red, margin over = good green, revenue over = good green. Wiring
//   colour to the sign would render a good margin red - the defect
//   the prior sweep removed from the other board.
// - No footer where there is no target - TP day 1, contractual
//   accounts, rolling window ("No target"). Detected via pill tone
//   neutral OR the operand missing.
//
// Cost + margin variance is measured against budget_at_this_revenue
// (batr) to agree with the pill's under/over verdict. Prior draft
// used card.delta_dollars which is against budget_to_date_days for
// cost - the two diverge on periods where revenue overshot plan (LP
// TBJ - FL: pill said "under budget" while delta_dollars said "over
// $6,965" because batr $79,227 differs from budget_to_date $62,980).
// Revenue uses card.delta_dollars (actual vs projection); no batr
// applies on revenue.
// Kevin R-92 (2026-09-09). Copy block that names WHY the cost or
// margin card is holding its percentage on This period. Cost: name
// the percent it WOULD show so a reader sees why it's suppressed.
// Margin: name the missing side. Render of record:
// docs/renders/overview-this-period-sc-revenue.html.
function HoldReason({ card, kind }) {
  const isCogs = kind === "cogs";
  const spent = Number(card?.hero_actual || 0);
  const revenue = null;   // deliberately unused; server holds pct off
  let text;
  if (isCogs) {
    // Kevin ruling 2026-09-08 item 3 (current-period rebuild). New
    // cost-side wording names both delayed inputs (labor + invoices)
    // rather than invoices alone. No "would-read percent" clause;
    // R-92 holds - no percentages on the running-period cost card.
    text = (
      <>
        <b>No percentage yet.</b> Revenue is confirmed ahead of the week; labor is pending confirmation and invoices are still landing.
      </>
    );
  } else {
    // Kevin ruling 2026-09-08 item 3. Gross margin sub-note names
    // the three systems an operator goes to act - Service Calendar
    // for revenue, Invoice Capture for cost, Rippling for labor.
    // Bolded so a reader sees the three action surfaces at a glance.
    text = (
      <>
        Margin pending as revenue is confirmed through the <b>Service Calendar</b>, invoices are uploaded through <b>Invoice Capture</b> and labor is approved in <b>Rippling</b>.
      </>
    );
  }
  return (
    <div className="kpi-ov-hold" data-kpi-ov={`hold-${kind}`}>
      {text}
    </div>
  );
}

function VarianceFoot({ card, kind, awaiting = false }) {
  if (!card) return null;
  const tone = card.pill?.tone;
  if (tone === "neutral") return null;
  let delta;
  if (kind === "revenue") {
    delta = card.delta_dollars;
  } else {
    // cogs + gross_margin: variance against batr, matching the pill.
    const actual = card.hero_actual;
    const target = card.budget_at_this_revenue;
    if (actual == null || target == null) return null;
    delta = Number(actual) - Number(target);
  }
  if (delta == null || !Number.isFinite(Number(delta))) return null;
  if (Math.abs(Number(delta)) < 1) return null;   // "on target" - no arrow/amount
  const positive = Number(delta) > 0;
  const arrow = positive ? "▲" : "▼";
  const abs = Math.abs(Math.round(Number(delta)));
  const amount = "$" + abs.toLocaleString("en-US");
  let label;
  let dir;   // "good" | "bad" per axis-aware meaning
  if (kind === "cogs") {
    label = positive ? "Over target" : "Under target";
    dir = positive ? "bad" : "good";
  } else if (kind === "gross_margin") {
    label = positive ? "Ahead of target" : "Behind target";
    dir = positive ? "good" : "bad";
  } else {
    label = positive ? "Above projection" : "Below projection";
    dir = positive ? "good" : "bad";
  }
  // Kevin R-94 (2026-09-09): awaiting-verification cost + margin
  // footers render amber. The variance is still true and worth
  // seeing; the colour carries the caveat that it will move.
  const toneCls = awaiting
    ? "kpi-ov-foot-wait"
    : dir === "good" ? "kpi-ov-foot-good" : "kpi-ov-foot-bad";
  return (
    <div className={`kpi-ov-foot ${toneCls}`} data-kpi-ov={`foot-${kind}`}>
      <span className="kpi-ov-foot-k">{label}</span>
      <span className="kpi-ov-foot-v">{arrow} {amount}</span>
    </div>
  );
}

// Item 4: horizon in the row labels. Open range means the two figures
// carry a time dimension; closed range does not.
//
// Kevin ruling 2026-09-03 follow-up: the Revenue card's reference row
// reads Projection (not Budget), on every account and every range.
// Cost and margin cards still measure against a Target, so this rename
// only applies to Revenue.
//
// Kevin walkthrough sweep addendum A (2026-09-07): renamed from
// Forecast to Projection everywhere in revenue context. The word
// `forecast` still means the counts-not-yet-confirmed state on
// Labor's week tiles (a different concept) and stays there.
function actualLabel(periodState, throughWkLabel) {
  // Kevin Prompt 1 item 1c (2026-09-04): "Actual to date" -> "Actuals
  // wk 1 – wk N" so the operator sees the week count they're already
  // reading, not a generic to-date phrase. Falls back to the plain
  // form when the range label doesn't carry a week count.
  if (periodState !== "open") return "Actual";
  return throughWkLabel ? `Actuals ${throughWkLabel}` : "Actual to date";
}
function forecastLabel(periodState, throughWkLabel) {
  if (periodState !== "open") return "Projection";
  return throughWkLabel ? `Projection ${throughWkLabel}` : "Projection to date";
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
    const stripped = raw.replace(/\s+ACTUALS\s*$/i, "").replace(/\s+PROJECTION\s*$/i, "").trim();
    // Kevin walkthrough sweep item 5 (2026-09-07): on day one of a
    // new period, actuals_header is just "ACTUALS" (no span prefix).
    // Stripping ACTUALS leaves "", which the caller concatenated to
    // "Actuals " with a trailing space (and rendered "Actuals actuals"
    // when a wrapper prepended the word). Fall through to the horizon
    // fallback OR the null return so the caller uses "Actual to date".
    if (stripped) {
      return stripped.toLowerCase().replace(/^wk/, "wk");
    }
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
// Period-total label - "P9 projection total" / "P9 budget total".
// Kevin walkthrough sweep addendum A - Forecast renamed to Projection
// on revenue.
function periodTotalLabel(rangeMeta, kind) {
  const n = rangeMeta?.period_no;
  const pfx = n != null ? `P${n} ` : "";
  return kind === "revenue" ? `${pfx}projection total` : `${pfx}budget total`;
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
  // Kevin R-92 PR-3 follow-up (2026-09-09). On This period the
  // revenue actual is a RUNNING TOTAL (confirmed weeks so far), not
  // a settled figure. The card's pill reads "Confirmed so far"
  // green; the hero must match that colour rather than deriving red
  // from delta_direction ("bad" because $51K partial < $108K full
  // projection). Prefer pill tone whenever confirmed_weeks_count is
  // set - anchors the two elements to the same signal.
  const actualToneCls = card.confirmed_weeks_count != null
    ? (card.pill?.tone === "good" ? "kpi-ov-good"
        : card.pill?.tone === "bad" ? "kpi-ov-bad"
        : "")
    : (card.delta_direction === "good" ? "kpi-ov-good"
        : card.delta_direction === "bad" ? "kpi-ov-bad"
        : "");

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
          <span className="kpi-ov-pair-k">{card.confirmed_weeks_count != null ? "Confirmed" : actualLabel(periodState, throughWkLabel)}</span>
          <span className={`kpi-ov-pair-v kpi-ov-num ${actualToneCls}`} data-kpi-ov="hero-revenue">
            <DashOrValue value={actualText} reported={card.hero_reported} />
          </span>
        </div>
        <div className="kpi-ov-pair-rule" aria-hidden="true" />
        <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="card-reference">
          <span className="kpi-ov-pair-k">
            {card.confirmed_weeks_count != null
              ? `P${range?.period_no ?? ""} projection`
              : forecastLabel(periodState, throughWkLabel)}
          </span>
          <span className="kpi-ov-pair-v kpi-ov-num">
            {budgetRefText != null ? budgetRefText : "—"}
          </span>
        </div>
        {/* Kevin R-92 (2026-09-09). This period · confirmed-weeks
            caption. Names the count so a chef sees the actual is
            partial. The rest of the period is forecast (SC counts
            not yet entered); as counts land the number firms up. */}
        {card.confirmed_weeks_count != null ? (
          <div className="kpi-ov-hold" data-kpi-ov="revenue-confirmed-note">
            <b>{card.confirmed_weeks_count} of {card.total_weeks_count} weeks confirmed</b> in the Service Calendar. The service fee prorates by the same weeks. The rest is forecast and will firm up as counts land.
          </div>
        ) : (
          <VarianceFoot card={card} kind="revenue" />
        )}
        {/* Kevin Prompt 1 item 1a (2026-09-04): third block below the
            dashed rule with period-total budget + how much is left.
            Suppressed on closed ranges (finished period has no left)
            and when period_budget is null/0. On revenue over-budget
            is GOOD (booking more than planned), so the "over" state
            uses the good tone.
            Kevin R-92 (2026-09-09): suppressed when the confirmed-
            weeks caption is shown - the caption is the third block. */}
        {periodState === "open" && card.confirmed_weeks_count == null && (
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

// COGS + GM card - dollars first, percent beside. Actual + target
// rows both carry dollars-big + percent-small; actual takes the
// verdict colour on both figures; target stays neutral grey.
// Variance footer sits below with the dollar delta + arrow.
//
// Kevin post-1060 sweep (2026-09-09): the panel was percent-first
// per an earlier ruling; render of record
// docs/renders/overview-cards-variance-footer.html flips it. Dollars
// are the amount answer; percent is the "is that right for the
// revenue we earned" answer. Kevin's rule: "the amount leads and
// the percentage sits beside it, both in the verdict colour."
function PercentLeadCard({ card, range, periodState, kind, extra, rangeLabels, revenueModel, periodBudget, weeksDone, weeksTotal, throughWkLabel, awaiting = false, held = false }) {
  const isCogs = kind === "cogs";
  const isManagementFee = revenueModel === "management_fee";
  const hasTarget = extra?.hasTarget;
  // Kevin post-1060 sweep (2026-09-09): swap - the dollar figure is
  // the hero and the percent sits beside it as a small span.
  const actualText = card.hero_actual_display;
  const targetText = card.budget_at_this_revenue_display;
  const actualPctText = card.pct_of_revenue_display;
  const targetPctText = card.target_pct_display;
  // Kevin R-94 (2026-09-09): when the period is closed but not yet
  // finance-verified, cost + margin cards read "Provisional" in AMBER
  // instead of the settled verdict pill. The numbers, target and
  // footer all stay - a chef still reads $69,945 against $79,227 and
  // the footer still shows the variance in amber rather than green.
  // A reading, not a result. Revenue does not go amber: Service
  // Calendar counts are complete for a closed period.
  const actualToneCls = awaiting
    ? "kpi-ov-wait"
    : card.pill?.tone === "good" ? "kpi-ov-good"
    : card.pill?.tone === "bad" ? "kpi-ov-bad"
    : "";

  const helpBody = isCogs
    ? cogsTooltip({
        isManagementFee,
        envelopeDelta: card.envelope_delta,
        hasTarget,
      })
    : <p>{HELP_BODIES.gross_margin}</p>;

  return (
    <div className={`kpi-ov-card ${isCogs ? "kpi-ov-card-cogs" : "kpi-ov-card-gm"}${awaiting ? " kpi-ov-card-awaiting" : ""}`} data-kpi-ov={`card-${kind}`}>
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id={`overview-card-${kind}`} title={card.label} body={helpBody} />
        {awaiting
          ? <Pill pill={{ label: "Provisional", tone: "wait" }} />
          : <Pill pill={card.pill} />
        }
      </div>
      <div className="kpi-ov-cb">
        {held ? (
          // Kevin R-92 (2026-09-09). This period · option A. Cost +
          // margin cards HOLD their percentages until cost catches
          // up with the confirmed revenue. Revenue is confirmed
          // ahead of the week; invoices arrive weeks later - a
          // percent now reads 8.3% and means nothing. Numbers stay,
          // percent doesn't, footer doesn't, progress bar doesn't.
          // Copy names the reason.
          //
          // Cost:   Spent so far $X / P10 budget $Y (Z.Z% target) /
          //         "No percentage yet. Revenue is confirmed ahead
          //          of the week; invoices arrive weeks later. A
          //          percentage now would read X.X% and mean
          //          nothing."
          // Margin: Actual - / P10 budget $Y (Z.Z% target) /
          //         "Margin needs both sides. Revenue is confirmed,
          //          cost is not."
          <>
            <div className="kpi-ov-pair" data-kpi-ov="card-actual">
              <span className="kpi-ov-pair-k">{isCogs ? "Spent so far" : "Actual"}</span>
              <span className="kpi-ov-pair-v kpi-ov-num" data-kpi-ov={`hero-${kind}`}>
                {isCogs ? (actualText || "—") : "—"}
              </span>
            </div>
            <div className="kpi-ov-pair-rule" aria-hidden="true" />
            <div className="kpi-ov-pair kpi-ov-pair-ref" data-kpi-ov="card-reference">
              <span className="kpi-ov-pair-k">{`${periodTotalLabel(range, kind).replace(/(budget|projection) total$/i, "budget")}`}</span>
              <span className="kpi-ov-pair-v kpi-ov-num">
                {(() => {
                  const pb = periodBudget != null ? "$" + Math.abs(Math.round(Number(periodBudget))).toLocaleString("en-US") : "—";
                  return (
                    <>
                      {pb}
                      {targetPctText && (
                        <small className="kpi-ov-pair-sub" data-kpi-ov={`target-${kind}-pct`}>{targetPctText} target</small>
                      )}
                    </>
                  );
                })()}
              </span>
            </div>
            <HoldReason card={card} kind={kind} />
          </>
        ) : (
          <>
            <div className="kpi-ov-pair" data-kpi-ov="card-actual">
              <span className="kpi-ov-pair-k">{actualLabel(periodState, throughWkLabel)}</span>
              <span className={`kpi-ov-pair-v kpi-ov-num ${actualToneCls}`} data-kpi-ov={`hero-${kind}`}>
                {actualText || "—"}
                {actualPctText && (
                  <small className="kpi-ov-pair-sub" data-kpi-ov={`hero-${kind}-pct`}>{actualPctText}</small>
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
                    {targetPctText && (
                      <small className="kpi-ov-pair-sub" data-kpi-ov={`target-${kind}-pct`}>{targetPctText}</small>
                    )}
                  </>
                ) : <span className="kpi-ov-nb">—</span>}
              </span>
            </div>
            <VarianceFoot card={card} kind={kind} awaiting={awaiting} />
          </>
        )}

        {/* Kevin Prompt 1 item 1a (2026-09-04): third block on cost +
            margin cards. COGS uses "left/over" language with the
            standard cost tone (over = red); margin uses "to earn"
            with a neutral tone (margin is earned not spent, and red
            is reserved for missing a target - Kevin's R-75 rule).
            Kevin R-92 (2026-09-09): suppressed on This period - the
            progress bar against a period budget with no comparable
            cost is noise. Held state renders the "hold" body above
            instead. */}
        {periodState === "open" && !held && (
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

export default function CardsRow({ cards, rangeMeta, scCountsWithoutDollars, hasTarget, revenueSourceState, rangeLabels, revenueModel, statementTotals, awaiting = false }) {
  // Kevin R-92 (2026-09-09). Cost + margin HOLD on This period
  // (single running period). Detected via rangeMeta - server pill
  // copy also updates to name the hold state, but the layout gate
  // is client-owned so the "hold body" (Spent so far / P10 budget /
  // caption) sits close to the render.
  const isRunningSinglePeriod = rangeMeta?.kind === "period" && rangeMeta?.period_state === "open";
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
          awaiting={awaiting}
          held={isRunningSinglePeriod}
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
          awaiting={awaiting}
          held={isRunningSinglePeriod}
        />
      )}
    </div>
  );
}
