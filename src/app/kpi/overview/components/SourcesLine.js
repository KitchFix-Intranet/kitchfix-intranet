"use client";
// src/app/kpi/overview/components/SourcesLine.js
//
// Element 2 of the Overview anatomy (KPI_MASTER_SCOPE §5.4).
//
// Reads sources block from the payload:
//   sources.labor.label
//   sources.purchases.label
//   sources.sc_revenue?.label
//   sources.period_state (open | closed_awaiting | verified)
//   sources.period_state_display
//
// Plus freshness.cards_through - the chip goes AMBER when the cards
// through-date is more than 3 days behind today (F-9 signal per the
// alignment audit Q5). No computation, just a distance check.
//
// The period-state chip carries a native title tooltip with the three
// state definitions. The scope §5.6 says "hover defines all three";
// this rendering shows the active one and the tooltip carries the
// dictionary of all three so an operator learns the vocabulary.

import HelpPop from "@/app/kpi/labor/components/HelpPop";

const STATE_CLASS = {
  open: "kpi-ov-stc-open",
  closed_awaiting: "kpi-ov-stc-wait",
  verified: "kpi-ov-stc-ver",
};

const STATE_TOOLTIP = {
  open:            "Numbers update nightly from labor, purchasing and the Service Calendar. Nothing is final until the period closes and is verified against the finance P&L.",
  closed_awaiting: "The period has closed. Our numbers are final on our side, but finance has not yet issued the P&L, so they are not yet verified.",
  verified:        "Closed, and Kevin has matched these figures against the finance P&L. This is the confirmed record.",
};

function daysBetween(a, b) {
  if (!a || !b) return null;
  const pa = new Date(a + "T00:00:00Z");
  const pb = new Date(b + "T00:00:00Z");
  if (Number.isNaN(pa.getTime()) || Number.isNaN(pb.getTime())) return null;
  return Math.round((pb.getTime() - pa.getTime()) / 86400000);
}

export default function SourcesLine({ sources, freshness }) {
  if (!sources) return null;
  const cardsThru = freshness?.cards_through;
  const today = freshness?.today;
  const gap = daysBetween(cardsThru, today);
  const cardsLag = gap != null && gap > 3;

  const state = sources.period_state;
  const stateClass = STATE_CLASS[state] || "kpi-ov-stc-wait";
  const stateDisplay = sources.period_state_display || state || "";

  return (
    <div className="kpi-ov-sources" data-kpi-ov="sources-line">
      {sources.labor?.label && (
        <span data-kpi-ov="src-labor">{sources.labor.label}</span>
      )}
      {sources.purchases?.label && (
        <span
          data-kpi-ov="src-purchases"
          className={cardsLag ? "kpi-ov-sources-lag" : undefined}
          title={cardsLag ? `Cards last synced ${cardsThru}; ${gap} days behind today (${today}).` : undefined}
        >
          {sources.purchases.label}
        </span>
      )}
      {sources.sc_revenue?.label && (
        <span data-kpi-ov="src-sc">{sources.sc_revenue.label}</span>
      )}
      <span className="kpi-ov-sources-state" data-kpi-ov="src-state">
        <span
          className={`kpi-ov-stc ${stateClass}`}
          title={STATE_TOOLTIP[state]}
          data-kpi-ov-state={state}
        >
          {stateDisplay}
        </span>
        <HelpPop
          id="overview-period-state"
          title="Period states"
          body={
            <>
              <p><b>Open · live estimate</b> - numbers update nightly. Not final until the period closes and is verified against the finance P&L.</p>
              <p style={{ marginTop: 6 }}><b>Closed · awaiting finance</b> - our numbers are final on our side, but finance has not yet issued the P&L.</p>
              <p style={{ marginTop: 6 }}><b>Verified against P&L</b> - closed, and matched against the finance P&L. Confirmed record.</p>
            </>
          }
        />
      </span>
    </div>
  );
}
