"use client";
// src/app/kpi/overview/components/CardsRow.js
//
// Element 4. Three cards in P&L order: Revenue, Cost of goods sold,
// Gross margin. Every dollar / percent / direction word arrives
// formatted on the payload's cards[] array (server-side per §9B).
//
// PR 2 polish (2026-09-01) layout of record: see
// docs/renders/overview-polish-LOCKED.html:262-272.
//
//   Revenue     - hero ($amount period to date) · sub "vs $X P9 budget"
//                 (B5: dropped the "expected by today" figure, it was
//                 the same number as the hero while revenue was planned)
//   COGS        - heroline "$X · N% of revenue" (dollars + pct side by
//                 side with a divider) · sub "56.2% target · $Y budget
//                 to date" (B7: two rows collapsed to one hero + one
//                 sub); pill carries the gap (B6, server-side)
//   Gross marg  - same heroline + sub shape as COGS (B7). Dollar delta
//                 dropped - the pill already says "10.4% AHEAD".

import HelpPop from "@/app/kpi/labor/components/HelpPop";
import DashOrValue from "./DashOrValue";

const PILL_TONE = {
  good: "kpi-ov-pill-good",
  warn: "kpi-ov-pill-warn",
  bad: "kpi-ov-pill-bad",
  neutral: "kpi-ov-pill-neutral",
};

const CARD_BORDER = {
  revenue: "kpi-ov-card-rev",
  cogs: "kpi-ov-card-cogs",
  gross_margin: "kpi-ov-card-gm",
};

const HELP_BODIES = {
  revenue: {
    title: "Revenue",
    body: <p>What this account bills for the food and service delivered. Every cost below is judged as a percent of this number.</p>,
  },
  cogs: {
    title: "Cost of goods sold",
    body: <p>Labor, food purchased, packaging and supplies, vehicle - the lines the operator controls. Finance calls this COGS. Judged as a percent of revenue.</p>,
  },
  gross_margin: {
    title: "Gross margin",
    body: <p>Revenue minus cost of goods sold. This is the account-level measure. Stops here - SG&A is not part of it, so this is not profit.</p>,
  },
};

function Pill({ pill }) {
  if (!pill) return null;
  const tone = PILL_TONE[pill.tone] || "kpi-ov-pill-neutral";
  return (
    <span
      className={`kpi-ov-pill ${tone}`}
      data-kpi-ov="pill"
      data-kpi-ov-tone={pill.tone}
    >
      {pill.label}
    </span>
  );
}

// B5 (2026-09-01): revenue card sub-line reads "vs $118,130 P9 budget".
// Drops the "expected by today" figure - it was the same number as the
// hero while revenue was planned (0.5x zero relationship = same).
//   Open period: "vs $118,130 P9 budget"
//   FYTD:        "vs $1,572,700 full-year budget"
//   Closed:      "vs $121,930 budget"
function RevenueCard({ card, range }) {
  const isFytd = range?.kind === "fytd";
  const isClosed = range?.period_state === "verified" || range?.period_state === "closed_awaiting";
  // "P9 budget" copy for the open-period case. The payload's range
  // carries period_no as a number; the card copy prefers "P9" over
  // "period 9" to match the command bar's Range chip vocabulary
  // ("This period · P9 · 08/10 – 09/06").
  const periodLabel = range?.period_no != null ? `P${range.period_no}` : null;

  const subLine = (() => {
    if (isClosed) {
      const closedBudget = card.budget_full_period_display || card.budget_to_date_display;
      if (!closedBudget) return null;
      return (
        <div className="kpi-ov-sub" data-kpi-ov="revenue-sub">
          vs <b className="kpi-ov-num">{closedBudget}</b> budget
        </div>
      );
    }
    if (isFytd) {
      const horizon = card.budget_full_year_display;
      if (!horizon) return null;
      return (
        <div className="kpi-ov-sub" data-kpi-ov="revenue-sub">
          vs <b className="kpi-ov-num">{horizon}</b> full-year budget
        </div>
      );
    }
    // Open period (default): "vs $X P9 budget" with the period label
    // pulled from the range meta when present.
    const horizon = card.budget_full_period_display;
    if (!horizon) return null;
    const suffix = periodLabel ? `${periodLabel} budget` : "period budget";
    return (
      <div className="kpi-ov-sub" data-kpi-ov="revenue-sub">
        vs <b className="kpi-ov-num">{horizon}</b> {suffix}
      </div>
    );
  })();

  return (
    <div className={`kpi-ov-card ${CARD_BORDER.revenue}`} data-kpi-ov="card-revenue">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id="overview-card-revenue" title={HELP_BODIES.revenue.title} body={HELP_BODIES.revenue.body} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-hero kpi-ov-num" data-kpi-ov="hero-revenue">
          <DashOrValue value={card.hero_actual_display} reported={card.hero_reported} />
          <small>period to date</small>
        </div>
        {subLine}
      </div>
    </div>
  );
}

// B7 (2026-09-01): COGS + GM cards use a heroline (dollars + pct side
// by side with a divider) + one sub-line ("56.2% target · $52,165
// budget to date"). GM drops the dollar-gap sub - the pill states it.
function HeroLineWithPct({ card, dataAttr, colorHero }) {
  const heroColor = colorHero
    ? (card.pill?.tone === "good" ? "kpi-ov-good" : card.pill?.tone === "bad" ? "kpi-ov-bad" : "")
    : "";
  return (
    <div className="kpi-ov-heroline" data-kpi-ov={dataAttr}>
      <span className={`kpi-ov-hero kpi-ov-num ${heroColor}`}>
        <DashOrValue value={card.hero_actual_display} reported={card.hero_reported} />
      </span>
      {card.pct_of_revenue_display && (
        <>
          <span className="kpi-ov-heroline-dv" aria-hidden="true">·</span>
          <span className="kpi-ov-heroline-sec kpi-ov-num">
            {card.pct_of_revenue_display}
            <small>of revenue</small>
          </span>
        </>
      )}
    </div>
  );
}

function TargetAndBudgetLine({ card }) {
  const targetTxt = card.target_pct_display ? `${card.target_pct_display} target` : null;
  const budgetTxt = card.budget_to_date_display ? `${card.budget_to_date_display} budget to date` : null;
  if (!targetTxt && !budgetTxt) return null;
  return (
    <div className="kpi-ov-sub" data-kpi-ov="card-sub">
      {targetTxt}
      {targetTxt && budgetTxt && <span className="kpi-ov-sub-sep"> · </span>}
      {budgetTxt}
    </div>
  );
}

function CogsCard({ card }) {
  return (
    <div className={`kpi-ov-card ${CARD_BORDER.cogs}`} data-kpi-ov="card-cogs">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id="overview-card-cogs" title={HELP_BODIES.cogs.title} body={HELP_BODIES.cogs.body} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <HeroLineWithPct card={card} dataAttr="hero-cogs" colorHero />
        <TargetAndBudgetLine card={card} />
      </div>
    </div>
  );
}

function GrossMarginCard({ card }) {
  return (
    <div className={`kpi-ov-card ${CARD_BORDER.gross_margin}`} data-kpi-ov="card-gm">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id="overview-card-gm" title={HELP_BODIES.gross_margin.title} body={HELP_BODIES.gross_margin.body} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <HeroLineWithPct card={card} dataAttr="hero-gm" colorHero={false} />
        <TargetAndBudgetLine card={card} />
      </div>
    </div>
  );
}

export default function CardsRow({ cards, rangeMeta }) {
  if (!Array.isArray(cards)) return null;
  const revenue = cards.find(c => c.key === "revenue");
  const cogs    = cards.find(c => c.key === "cogs");
  const gm      = cards.find(c => c.key === "gross_margin");
  return (
    <div className="kpi-ov-cards" data-kpi-ov="cards-row">
      {revenue && <RevenueCard card={revenue} range={rangeMeta} />}
      {cogs    && <CogsCard    card={cogs} />}
      {gm      && <GrossMarginCard card={gm} />}
    </div>
  );
}
