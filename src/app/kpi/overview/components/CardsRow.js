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

function RevenueCard({ card, posture, range }) {
  const isPeriod = range?.kind === "period";
  const rangeIsOpen = range?.period_state === "open" || range?.kind === "fytd";
  return (
    <div className={`kpi-ov-card ${CARD_BORDER.revenue}`} data-kpi-ov="card-revenue">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        {posture === "corporate" && card.gl_codes && (
          <span className="kpi-ov-gl">{card.gl_codes}</span>
        )}
        <HelpPop id="overview-card-revenue" title={HELP_BODIES.revenue.title} body={HELP_BODIES.revenue.body} />
        <Pill pill={card.pill} />
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-hero kpi-ov-num" data-kpi-ov="hero-revenue">
          <DashOrValue value={card.hero_actual_display} reported={card.hero_reported} />
        </div>
        <div className="kpi-ov-kpi2">
          {card.budget_to_date_display && (
            <>
              <span>
                <b style={{ fontSize: "var(--kpi-t-body)" }}>{card.budget_to_date_display}</b>
                {" "}budget{rangeIsOpen ? " to date" : ""}
              </span>
              <span>
                ·{" "}
                {range?.kind === "fytd" && card.budget_full_year_display
                  ? `${card.budget_full_year_display} full year`
                  : card.budget_full_period_display
                    ? `${card.budget_full_period_display} period budget`
                    : ""}
              </span>
            </>
          )}
          {card.delta_display && (
            <span className={card.delta_direction === "good" ? "kpi-ov-good" : card.delta_direction === "bad" ? "kpi-ov-bad" : "kpi-ov-nb"}>
              · {card.delta_display}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CogsCard({ card, posture }) {
  return (
    <div className={`kpi-ov-card ${CARD_BORDER.cogs}`} data-kpi-ov="card-cogs">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">{card.label}</span>
        {posture === "corporate" && card.gl_codes && (
          <span className="kpi-ov-gl">{card.gl_codes}</span>
        )}
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
        {card.mini && card.mini.length > 0 && (
          <div className="kpi-ov-mini">
            {card.mini.map((m) => (
              <span key={m.label}>
                {m.label} <b><DashOrValue value={m.display} reported={m.actual != null} /></b>
              </span>
            ))}
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

export default function CardsRow({ cards, posture, rangeMeta }) {
  if (!Array.isArray(cards)) return null;
  const revenue = cards.find(c => c.key === "revenue");
  const cogs    = cards.find(c => c.key === "cogs");
  const gm      = cards.find(c => c.key === "gross_margin");
  return (
    <div className="kpi-ov-cards" data-kpi-ov="cards-row">
      {revenue && <RevenueCard card={revenue} posture={posture} range={rangeMeta} />}
      {cogs    && <CogsCard    card={cogs}    posture={posture} />}
      {gm      && <GrossMarginCard card={gm} range={rangeMeta} />}
    </div>
  );
}
