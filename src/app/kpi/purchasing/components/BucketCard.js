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
import { fmt$, fmtPct, moneyArrow, resolveCardState, stateOf } from "../lib/board";

export function BucketCard({
  bucketKey,          // 'food' | 'packaging' | 'vehicle'
  label,
  sub,
  strokeClass,        // 'kpi-p-b-food' etc.
  identity,           // WeekChart identity: 'food' | 'pkg' | 'veh'
  budget,
  spent,              // bills + coded cards - the fuller number, single source
                      // for hero, %-used, pill state, and bar/chart state.
  bills,
  cardsCoded,
  elapsedFrac,
  closed,
  // PR 2 R3 Part B - tier-aware strip. `tier`+`units` replace the old
  // fixed-length weekAmounts/weekLabels. `units` is the full fiscal
  // enumeration (weeks for A/B, periods for C); WeekChart asserts on
  // rendered count == units.length so nothing gets silently dropped.
  tier,               // 'A' | 'B' | 'C'
  units,              // array of unit objects for WeekChart
  original,
  adjusted,
  budgetSpent,        // PR-2 R2 Fix 2: adjusted is clamped to 0 upstream
                      //   when budget - finishedSpend <= 0. This flag
                      //   swaps the "aim for $X / wk" caption for the
                      //   "budget spent" wording. Never negative on screen.
}) {
  // §9B ONE-SOURCE (PR-2 R2 Fix 1 revision, owner ruling 2026-08-24):
  // hero, %-used, pill state, and bar/chart state ALL resolve from the
  // SAME `spent` number - which is bills + coded cards.
  //
  // Prior state (R1) fed bills-only into both the hero and the pill
  // citing §3.4. §3.4 was written BEFORE G3 mapped card spend to real
  // buckets; taking the hero to bills-only dropped $141,550.30 of food
  // card spend off the food card. Owner ruling 2026-08-24: hero and
  // pill BOTH come from bills + coded cards (one source, the fuller
  // number). The "From bills" and "From cards" sub-rows keep showing
  // the split for auditability. The assertion below still fires on any
  // future drift.
  const heroSpent = Number(spent || 0);
  const cs = resolveCardState({
    spent: heroSpent,              // bills + coded cards; hero same source
    budget: Number(budget || 0),
    elapsedFrac,
    hasBills: Number(bills || 0) > 0,
    closed,
  });

  // Dev-only assertion (§9B, R2 Fix 1 revision): hero and pill MUST
  // resolve from the same `spent`. Any future edit that reintroduces
  // two sources trips this in development. `stateOf` on the hero-driving
  // `heroSpent` (bills + coded) must match `cs.state`; if not, the
  // resolver is being called with a different input somewhere and the
  // card is lying.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    const heroDerivedState = stateOf({
      spent: heroSpent,
      budget: Number(budget || 0),
      elapsedFrac,
      hasBills: Number(bills || 0) > 0,
      closed,
    });
    if (heroDerivedState !== cs.state) {
      // eslint-disable-next-line no-console
      console.error(
        "[BucketCard §9B] hero vs pill drift:",
        { bucketKey, heroSpent, csSpent: heroSpent, heroDerivedState, csState: cs.state },
      );
      throw new Error(
        `BucketCard §9B: hero (${heroDerivedState}) and pill (${cs.state}) resolved from different spent`,
      );
    }
  }

  const rem = Number(budget || 0) - heroSpent;
  const varz = heroSpent - Number(budget || 0);   // closed variance
  const usedPct = Number(budget || 0) > 0 ? heroSpent / Number(budget || 0) : null;

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
            <span className={`kpi-p-hero num ${cs.heroClass}`}>{fmt$(heroSpent)}</span>
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
            {/* PR-2 R2 Fix 3 - owner ruling 2026-08-21: `Remaining` is a
                quantity, plain, no arrow, no colour. When over budget the
                label CHANGES to `Over by` and the number is a variance,
                which may carry colour. "Remaining ▲" is a contradiction
                in terms and has been removed.
                Closed periods keep the existing `Vs budget` variance. */}
            <span className="kpi-p-label">
              {closed ? "Vs budget" : (rem < 0 ? "Over by" : "Remaining")}
            </span>
            {closed ? (
              <span className={`kpi-p-value num ${varz > 0 ? "r" : "g"}`}>
                {Number(budget || 0) === 0 ? "—" : moneyArrow(varz)}
              </span>
            ) : rem < 0 ? (
              <span className="kpi-p-value num r">
                {Number(budget || 0) === 0 ? "—" : fmt$(-rem)}
              </span>
            ) : (
              <span className="kpi-p-value num">
                {Number(budget || 0) === 0 ? "—" : fmt$(rem)}
              </span>
            )}
            <span className="kpi-p-subline">
              {closed
                ? "period closed"
                : (budgetSpent
                    ? "budget spent"
                    : (adjusted != null ? `aim for ${fmt$(adjusted)} / wk` : "—"))}
            </span>
          </div>
        </div>

        <div className="kpi-p-subs">
          {closed ? (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Actual<small>as closed on the P&amp;L</small></span>
                <span className={`kpi-p-v num ${varz > 0 ? "r" : "g"}`}>{fmt$(heroSpent)}</span>
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

      {/* RIGHT - strip title follows tier; §B3 owner ruling 2026-08-24. */}
      <div className="kpi-p-card">
        <div className="kpi-p-lh">
          <span className="kpi-p-label">
            {tier === "C"
              ? "THE RANGE · PERIOD BY PERIOD"
              : (tier === "A" ? "THE PERIOD · WEEK BY WEEK" : "THE RANGE · WEEK BY WEEK")}
          </span>
          <span className="kpi-p-legs">
            {/* Weekly-target legend only in tiers A and B (spec §B4 -
                a single weekly target across a period-spanning range is
                meaningless, was the divisor that produced the negative
                adjusted bug PR 2 R2 clamped). Tier C carries per-period
                budget on each bar's line, no top-of-strip legend. */}
            {tier !== "C" && original != null && (
              <span className="kpi-p-leg orig">
                <span className="kpi-p-dash" aria-hidden="true" />
                target {fmt$(original)}
              </span>
            )}
            {tier === "A" && !closed && adjusted != null && !budgetSpent && (
              <span className="kpi-p-leg adj">
                <span className="kpi-p-dash" aria-hidden="true" />
                adjusted {fmt$(adjusted)}
              </span>
            )}
            {tier === "A" && !closed && budgetSpent && (
              <span className="kpi-p-leg adj">budget spent</span>
            )}
          </span>
        </div>
        <WeekChart
          tier={tier}
          units={units}
          identity={identity}
          emptyMessage="No budget and no spend in this bucket at this account."
        />
      </div>
    </div>
  );
}
