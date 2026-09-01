"use client";
// src/app/kpi/overview/components/CardsRow.js
//
// Element 4. Three cards in P&L order: Revenue, Cost of goods sold,
// Gross margin. Every dollar / percent / direction word arrives
// formatted on the payload's cards[] array (server-side per §9B).
//
// Card structure per §5.4 anatomy 4 + prototype v5:
//   - eyebrow (label) + optional GL codes (corporate posture) + ? + pill (R-7)
//   - hero (formatted dollar; may be null when unreported)
//   - kpi2 line (revenue: budget-to-date + full period/year;
//                cogs: %-of-rev vs target · direction word;
//                gm:   same)
//   - mini breakdown line (labels + amounts)

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

// R-40 (2026-09-01): one revenue-card sub-line rhythm for every role.
// Bold horizon budget, grey descriptor, matching COGS + GM rhythm.
//   Open period: "$118,130 budget this period · $88,598 expected by today"
//   FYTD:        "$1,572,700 full year budget · $1,371,266 expected by today"
//   Closed:      "$121,930 budget"
// GL codes are no longer rendered on card headers - they live in the
// statement (one fold away). Kevin flagged this as reversible in the
// R-40 report if he misses them.
function RevenueCard({ card, range }) {
  const isFytd = range?.kind === "fytd";
  const isClosed = range?.period_state === "verified" || range?.period_state === "closed_awaiting";

  const subLine = (() => {
    if (isClosed) {
      const closedBudget = card.budget_full_period_display || card.budget_to_date_display;
      if (!closedBudget) return null;
      return (
        <div className="kpi-ov-kpi2">
          <span>
            <b style={{ fontSize: "var(--kpi-t-body)" }}>{closedBudget}</b>
            {" "}budget
          </span>
        </div>
      );
    }
    const horizon = isFytd
      ? card.budget_full_year_display
      : card.budget_full_period_display;
    const horizonLabel = isFytd ? "full year budget" : "budget this period";
    if (!horizon) return null;
    return (
      <div className="kpi-ov-kpi2">
        <span>
          <b style={{ fontSize: "var(--kpi-t-body)" }}>{horizon}</b>
          {" "}{horizonLabel}
        </span>
        {card.budget_to_date_display && (
          <span>· {card.budget_to_date_display} expected by today</span>
        )}
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
        </div>
        {subLine}
      </div>
    </div>
  );
}

// R-40: no posture branch. GL codes dropped from the card header
// (they live in the statement, one fold away). Mini breakdown
// dropped - labor + food dollars each appear once, carried by the
// drill buttons downstream. Applies to every role.
function CogsCard({ card }) {
  return (
    <div className={`kpi-ov-card ${CARD_BORDER.cogs}`} data-kpi-ov="card-cogs">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id="overview-card-cogs" title={HELP_BODIES.cogs.title} body={HELP_BODIES.cogs.body} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div
          className={`kpi-ov-hero kpi-ov-num ${card.pill?.tone === "good" ? "kpi-ov-good" : card.pill?.tone === "bad" ? "kpi-ov-bad" : ""}`}
          data-kpi-ov="hero-cogs"
        >
          <DashOrValue value={card.hero_actual_display} reported={card.hero_reported} />
          <small>spent</small>
        </div>
        {card.pct_of_revenue_display && card.target_pct_display && (
          <div className="kpi-ov-kpi2">
            <b>{card.pct_of_revenue_display}</b>
            <span>of revenue vs {card.target_pct_display} target</span>
            {card.delta_pct_display && (
              <span className={card.delta_direction === "good" ? "kpi-ov-good" : card.delta_direction === "bad" ? "kpi-ov-bad" : "kpi-ov-nb"} style={{ fontWeight: 800 }}>
                {card.delta_pct_display}
              </span>
            )}
          </div>
        )}
        {card.budget_to_date_display && (
          <div className="kpi-ov-kpi2" style={{ marginTop: 6 }}>
            <span>
              <b style={{ fontSize: "var(--kpi-t-body)" }}>{card.budget_to_date_display}</b>
              {" "}budget to date
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function GrossMarginCard({ card, range }) {
  const rangeIsOpen = range?.period_state === "open" || range?.kind === "fytd";
  return (
    <div className={`kpi-ov-card ${CARD_BORDER.gross_margin}`} data-kpi-ov="card-gm">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        <HelpPop id="overview-card-gm" title={HELP_BODIES.gross_margin.title} body={HELP_BODIES.gross_margin.body} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-hero kpi-ov-num" data-kpi-ov="hero-gm">
          <DashOrValue value={card.hero_actual_display} reported={card.hero_reported} />
        </div>
        {card.pct_of_revenue_display && card.target_pct_display && (
          <div className="kpi-ov-kpi2">
            <b>{card.pct_of_revenue_display}</b>
            <span>of revenue vs {card.target_pct_display} target</span>
            {card.delta_pct_display && (
              <span className={card.delta_direction === "good" ? "kpi-ov-good" : card.delta_direction === "bad" ? "kpi-ov-bad" : "kpi-ov-nb"} style={{ fontWeight: 800 }}>
                {card.delta_pct_display}
              </span>
            )}
          </div>
        )}
        {card.budget_to_date_display && (
          <div className="kpi-ov-kpi2" style={{ marginTop: 6 }}>
            <span>
              <b style={{ fontSize: "var(--kpi-t-body)" }}>{card.budget_to_date_display}</b>
              {" "}budget{rangeIsOpen ? " to date" : ""}
            </span>
            {card.delta_display && (
              <span className={card.delta_direction === "good" ? "kpi-ov-good" : card.delta_direction === "bad" ? "kpi-ov-bad" : "kpi-ov-nb"}>
                · {card.delta_display}
              </span>
            )}
          </div>
        )}
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
      {gm      && <GrossMarginCard card={gm} range={rangeMeta} />}
    </div>
  );
}
