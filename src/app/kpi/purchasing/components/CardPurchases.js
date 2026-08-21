"use client";
// src/app/kpi/purchasing/components/CardPurchases.js
//
// Row 6a of the at-risk board (spec §6.4).
//
// Two columns. Stats left - past deadline, due Friday, total pending,
// `Open Rippling`. Every charge right, scrolling.
//
// Card charge detail (per-charge vendor/date/category) is NOT in this
// route's default response - the route only ships `pending.amount` and
// `pending.line_count` (§3.5: "A dollar sum, never a count"). Per-line
// charge listing arrives with PR 4 via the /items route or the drill
// param. Until then this card renders the summary stats and a summary
// "N charges pending" line rather than a fabricated list. Nothing
// behind a disclosure - the summary is the honest surface.

import { fmt$ } from "../lib/board";

export function CardPurchases({
  pendingAmount,          // number
  pendingLineCount,       // integer
  closed,                 // hide entirely when the period is closed (no action to take)
}) {
  if (closed) return null;
  const n = Number(pendingLineCount || 0);
  return (
    <div className="kpi-p-card kpi-p-cp" data-card="card-purchases">
      <div className="kpi-p-cpstats">
        <div>
          <span className="kpi-p-cardtitle">Card purchases</span>
          <span className="kpi-p-cardsub">card charges not yet coded to a P&amp;L line</span>
        </div>
        <div className="kpi-p-cpstat">
          <span className="kpi-p-l">Total pending</span>
          <span className="kpi-p-n">{fmt$(pendingAmount)}</span>
          <span className="kpi-p-s">
            {n === 0
              ? "no charges awaiting a code"
              : `${n} charge${n === 1 ? "" : "s"} · need a P&L line or location`}
          </span>
        </div>
        <a
          className="kpi-p-cpact"
          href="https://app.rippling.com/expenses"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Rippling
        </a>
      </div>
      <div className="kpi-p-cplist">
        <div className="kpi-p-txnhead">
          <span className="kpi-p-k">Every charge</span>
          <span style={{ flex: 1 }} aria-hidden="true" />
          <span className="kpi-p-k">amount</span>
        </div>
        <div className="kpi-p-txnlist" role="status">
          <div style={{
            padding: "var(--kpi-sp-4) 0",
            textAlign: "center",
            fontSize: "var(--kpi-t-meta)",
            color: "var(--n-500)",
            fontWeight: 500,
          }}>
            Per-charge detail lands with PR 4 (drill route). The route
            currently reports total pending {fmt$(pendingAmount)} across
            {" "}{n} line{n === 1 ? "" : "s"}.
          </div>
        </div>
      </div>
    </div>
  );
}
