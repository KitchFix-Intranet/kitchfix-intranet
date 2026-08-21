"use client";
// src/app/kpi/purchasing/components/BucketCard.js
//
// Rows 2 - 4 of the at-risk board (spec §6.2).
//
// Left half:
//   Title + subtitle
//   Pill (state)
//   Hero Spent (color follows state - §7 rule 3)
//   Secondary Remaining (open) / Vs budget (closed)
//   From bills / From cards (open)
//   Actual / Budget (closed)
//
// Right half:
//   Week chart of this bucket's spend
//
// §3.4 - bucket state uses BILLS ONLY. Pending is never in a bucket.
// Pending stays on the period card + Projected close.

import { Pill } from "./Pill";
import { WeekChart } from "./WeekChart";
import { fmt$, fmtPct, moneyArrow, resolveCardState } from "../lib/board";

export function BucketCard({
  bucketKey,          // 'food' | 'packaging' | 'vehicle'
  label,
  sub,
  strokeClass,        // 'kpi-p-b-food' etc.
  identity,           // WeekChart identity: 'food' | 'pkg' | 'veh'
  budget,
  spent,              // bills-only for state; bills + coded cards for hero total? per §3.4 bills only
  bills,
  cardsCoded,
  elapsedFrac,
  closed,
  weekAmounts,        // 4 bars, bills-only per-week for this bucket
  weekLabels,
  runningWeekIdx,
  original,
  adjusted,
}) {
  // Bucket-card total = bills + coded cards; state uses bills-only per
  // spec §3.4. Both derive from ONE resolveCardState() call so pill /
  // hero-tone / chart-state cannot drift.
  const total = Number(bills || 0) + Number(cardsCoded || 0);
  const cs = resolveCardState({
    spent: Number(bills || 0),    // §3.4: bills-only
    budget: Number(budget || 0),
    elapsedFrac,
    hasBills: Number(bills || 0) > 0,
    closed,
  });

  const rem = Number(budget || 0) - total;
  const varz = total - Number(budget || 0);   // closed variance
  const usedPct = Number(budget || 0) > 0 ? total / Number(budget || 0) : null;

  return (
    <div className="kpi-p-row" data-card={`bucket-${bucketKey}`}>
      {/* LEFT */}
      <div className={`kpi-p-card ${strokeClass}`}>
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle">{label}</span>
            <span className="kpi-p-cardsub">{sub}</span>
          </div>
          <div className="kpi-p-pillrow">
            <Pill tone={cs.pillTone} label={cs.pillLabel} />
          </div>
        </div>

        <div className="kpi-p-nums">
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Spent</span>
            <span className={`kpi-p-hero num ${cs.heroClass}`}>{fmt$(total)}</span>
            <span className="kpi-p-subline">
              of <b>{fmt$(budget)}</b>
              {usedPct != null && (
                <>
                  {" "}· <b>{fmtPct(usedPct)}</b> used
                </>
              )}
              {Number(budget || 0) === 0 && (<><span aria-hidden="true"> · </span><b>no budget</b></>)}
            </span>
          </div>
          <div className="kpi-p-stk">
            <span className="kpi-p-label">{closed ? "Vs budget" : "Remaining"}</span>
            {closed ? (
              <span className={`kpi-p-value num ${varz > 0 ? "r" : "g"}`}>
                {Number(budget || 0) === 0 ? "—" : moneyArrow(varz)}
              </span>
            ) : (
              <span className={`kpi-p-value num ${rem < 0 ? "r" : "b"}`}>
                {Number(budget || 0) === 0 ? "—" : (rem < 0 ? moneyArrow(-rem) : fmt$(rem))}
              </span>
            )}
            <span className="kpi-p-subline">
              {closed ? "period closed" : (adjusted != null ? `aim for ${fmt$(adjusted)} / wk` : "—")}
            </span>
          </div>
        </div>

        <div className="kpi-p-subs">
          {closed ? (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Actual<small>as closed on the P&amp;L</small></span>
                <span className={`kpi-p-v num ${varz > 0 ? "r" : "g"}`}>{fmt$(total)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Budget<small>FY2026 plan</small></span>
                <span className="kpi-p-v num">{fmt$(budget)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
            </>
          ) : (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">From bills<small>bill.com</small></span>
                <span className="kpi-p-v num">{fmt$(bills)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">From cards<small>coded in Rippling</small></span>
                <span className="kpi-p-v num">{fmt$(cardsCoded)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* RIGHT */}
      <div className="kpi-p-card">
        <div className="kpi-p-lh">
          <span className="kpi-p-label">By week</span>
          <span className="kpi-p-legs">
            {original != null && (
              <span className="kpi-p-leg orig">
                <span className="kpi-p-dash" aria-hidden="true" />
                target {fmt$(original)}
              </span>
            )}
            {!closed && adjusted != null && (
              <span className="kpi-p-leg adj">
                <span className="kpi-p-dash" aria-hidden="true" />
                adjusted {fmt$(adjusted)}
              </span>
            )}
          </span>
        </div>
        <WeekChart
          weekAmounts={weekAmounts}
          weekLabels={weekLabels}
          original={original}
          adjusted={adjusted}
          identity={identity}
          state={cs.state}
          closed={closed}
          runningWeekIdx={runningWeekIdx}
          emptyMessage="No budget and no spend in this bucket at this account."
        />
      </div>
    </div>
  );
}
