"use client";
// src/app/kpi/purchasing/components/FunMoneyCard.js
//
// PR 3 - STL - FL Fun Money card (spec §2.3).
//
// **The one genuinely at-risk figure at a pass_through account.**
// 3200.2 Resale Food is KitchFix-borne - $25K annual budget, direct
// P&L exposure. Owner ruling: it gets a real verdict, full state.
//
// Renders only at STL - FL. Reads route.mgmt_fee.fun_money which the
// route computes independent of the pass_through short-circuit that
// null-variances everything else at these accounts.
//
// Same shape as a small at-risk card: hero Spent (state coloured),
// secondary Remaining/Over-by, verdict pill on top.
//
// Kept as its own tiny component (~ 80 lines) rather than reusing
// LedgerCard/BucketCard so the shared-component-no-fork rule stays
// honoured for this PR. If future work adds a second Fun-Money-like
// exception, promote to a shared "SingleGlCard".

import { Pill } from "./Pill";
import { fmt$, fmtPct, moneyArrow, resolveCardState } from "../lib/board";

export function FunMoneyCard({
  funMoney,           // { gl_line_code, label, sub, budget, spent, variance }
  elapsedFrac,
  closed,
  isFutureRange = false,
}) {
  if (!funMoney) return null;
  const spent  = Number(funMoney.spent  || 0);
  const budget = Number(funMoney.budget || 0);
  const cs = resolveCardState({
    spent,
    budget,
    elapsedFrac,
    hasBills: spent > 0,
    closed,
  });
  const rem = budget - spent;
  const varz = Number(funMoney.variance || 0);
  const usedPct = budget > 0 ? spent / budget : null;

  return (
    <div className="kpi-p-card kpi-p-funmoney" data-card="fun-money">
      <div className="kpi-p-head">
        <div className="kpi-p-head-body">
          <span className="kpi-p-cardtitle">
            {funMoney.label || "Fun Money"}
          </span>
          <span className="kpi-p-cardsub">
            {funMoney.sub || `Resale food · ${funMoney.gl_line_code}`} · KitchFix-borne
          </span>
        </div>
        <div className="kpi-p-pillrow">
          {!isFutureRange && <Pill tone={cs.pillTone} label={cs.pillLabel} />}
        </div>
      </div>

      <div className={`kpi-p-nums${!isFutureRange && budget === 0 ? " kpi-p-nums-solo" : ""}`}>
        <div className="kpi-p-stk">
          <span className="kpi-p-label">Spent</span>
          <span className={`kpi-p-hero num ${isFutureRange ? "" : cs.heroClass}`}>
            {fmt$(spent)}
          </span>
          <span className="kpi-p-subline">
            of <b>{fmt$(budget)}</b>
            {!isFutureRange && usedPct != null && (
              <>{" "}· <b>{fmtPct(usedPct)}</b> used</>
            )}
            {budget === 0 && (
              <><span aria-hidden="true"> · </span><b>no budget</b></>
            )}
          </span>
        </div>
        {isFutureRange ? (
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Budget</span>
            <span className="kpi-p-value num">{fmt$(budget)}</span>
            <span className="kpi-p-subline">this range has not started</span>
          </div>
        ) : budget === 0 ? null : (
          <div className="kpi-p-stk">
            <span className="kpi-p-label">
              {closed ? "Vs budget" : (rem < 0 ? "Over by" : "Remaining")}
            </span>
            {closed ? (
              <span className={`kpi-p-value num ${varz > 0 ? "r" : "g"}`}>{moneyArrow(varz)}</span>
            ) : rem < 0 ? (
              <span className="kpi-p-value num r">{fmt$(-rem)}</span>
            ) : (
              <span className="kpi-p-value num">{fmt$(rem)}</span>
            )}
            <span className="kpi-p-subline">
              {closed ? "period closed" : "every purchase counts"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
