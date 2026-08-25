"use client";
// src/app/kpi/purchasing/components/PassThroughPeriodCard.js
//
// PR 2 R9 P0 - the pass-through period card.
//
// **What this replaces and why.** At pass-through accounts the shared
// PeriodCard was being fed only the KPI-line spend (food + packaging
// + vehicle) which is essentially Fun Money for these sites, since
// bill.com books everything else through 13xx reimbursable. That
// left the card titled `PERIOD N` reading $0.00 when the account had
// spent $11k+ on the client's behalf that period - anyone reading it
// concluded the site did nothing.
//
// It also duplicated the Fun Money card immediately below - the same
// pair of figures ($0.00 / $1,766.35) rendered under two names, one
// wrong.
//
// **Kevin ruling 2026-08-24 - Option 1.** A card titled `PERIOD n`
// at a site tells you what happened at that site this period.
// Reimbursable + Fun Money is the total activity; the card sums
// them into the hero and shows the split in sub-rows. Fun Money
// keeps its own card as the VERDICT surface (real state on 3200.2);
// the period card is the SUMMARY surface.
//
// No chart. The management-fee card above already carries the
// 8-period trend; a per-week chart on this card would double it.
// Kept structurally close to PeriodCard so a stakeholder scanning
// past both cards on the same board reads the same shape.

import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { fmt$, fmtPct } from "../lib/board";
import { PERIOD_BODY } from "./PurchasingHelpPops";

export function PassThroughPeriodCard({
  cardTitle,          // "PERIOD 9 · 07/27 - 08/23" style, computed upstream
  rangeLabel,         // "07/27/26 - 08/23/26"
  weekOfPeriod,       // 1..N ordinal inside the period (null when closed)
  weeksInPeriod,
  elapsedFrac,        // 0..1
  closed,
  provisional,
  isFutureRange = false,
  // Money
  reimbursableSpent,  // range-scoped 13xx total (data.totals.reimbursable.spent)
  funMoneySpent,      // range-scoped 3200.2 spent (data.mgmt_fee.fun_money?.spent)
  funMoneyBudget,     // range-scoped 3200.2 budget
  pending,            // whole-range pending (uncoded cards)
  cardsThroughLabel,  // MM/DD of max(txn_date) on rippling_spend
}) {
  const reimb = Number(reimbursableSpent || 0);
  const fun   = Number(funMoneySpent || 0);
  const funBud = Number(funMoneyBudget || 0);
  const totalActivity = reimb + fun;

  // Elapsed-fraction display: same rule as at-risk PeriodCard.
  const pctElapsed = elapsedFrac != null && Number.isFinite(Number(elapsedFrac))
    ? Math.round(Number(elapsedFrac) * 1000) / 10
    : null;

  return (
    <div className="kpi-p-card kpi-p-b-per kpi-p-per-passthru" data-card="period-passthru">
      <div className="kpi-p-head">
        <div className="kpi-p-head-body">
          <span className="kpi-p-cardtitle">
            {cardTitle || rangeLabel}
            {" "}<HelpPop id="qPurchPeriodPassthru" title="This period" body={PERIOD_BODY} />
          </span>
          <span className="kpi-p-cardsub">
            {isFutureRange
              ? "hasn't started"
              : closed
                ? "closed"
                : (weekOfPeriod != null && weeksInPeriod
                    ? `week ${weekOfPeriod} of ${weeksInPeriod}${pctElapsed != null ? ` · ${pctElapsed}% elapsed` : ""}`
                    : (pctElapsed != null ? `${pctElapsed}% elapsed` : ""))}
          </span>
        </div>
        <div className="kpi-p-pillrow">
          {!isFutureRange && (
            <span className="kpi-p-pill n" data-hs-pill="passthru">
              <i />Billed to client
            </span>
          )}
          {provisional && !closed && !isFutureRange && (
            <span className="kpi-p-pill n"><i />Provisional</span>
          )}
          {closed && !isFutureRange && (
            <span className="kpi-p-pill f"><i />Final</span>
          )}
        </div>
      </div>

      <div className="kpi-p-nums kpi-p-nums-solo">
        <div className="kpi-p-stk">
          <span className="kpi-p-label">Total activity</span>
          <span className="kpi-p-hero num">{fmt$(totalActivity)}</span>
          <span className="kpi-p-subline">
            billed back + KitchFix-borne combined
          </span>
        </div>
      </div>

      <div className="kpi-p-subs">
        <div className="kpi-p-sub">
          <span className="kpi-p-k">
            Reimbursable
            <small>billed to client · 13xx</small>
          </span>
          <span className="kpi-p-v num">{fmt$(reimb)}</span>
          <span className="kpi-p-x">no budget</span>
        </div>
        <div className="kpi-p-sub">
          <span className="kpi-p-k">
            Fun Money
            <small>KitchFix-borne · 3200.2</small>
          </span>
          <span className="kpi-p-v num">{fmt$(fun)}</span>
          <span className="kpi-p-x">
            {funBud > 0 ? <>of <b>{fmt$(funBud)}</b>{funBud > 0 && fun >= 0 ? <> · {fmtPct(fun / funBud)}</> : null}</> : "no budget"}
          </span>
        </div>
        {Number(pending || 0) > 0 && (
          <div className="kpi-p-sub">
            <span className="kpi-p-k">
              Pending
              <small>card · not yet coded{cardsThroughLabel ? ` · through ${cardsThroughLabel}` : ""}</small>
            </span>
            <span className="kpi-p-v num">{fmt$(pending)}</span>
            <span className="kpi-p-x">not on a P&amp;L line</span>
          </div>
        )}
      </div>
    </div>
  );
}
