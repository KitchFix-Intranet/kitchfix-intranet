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
// PR 2 R8 Gap 1 - shared HelpPop portal-renders at document.body so it
// escapes the card's `position: relative` stacking context.
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { FOOD_BODY, PACKAGING_BODY, VEHICLE_BODY, WEEK_STRIP_BODY } from "./PurchasingHelpPops";

const BUCKET_HELP = {
  food:      { id: "qPurchFood",      title: "Food",                 body: FOOD_BODY      },
  packaging: { id: "qPurchPackaging", title: "Packaging & supplies", body: PACKAGING_BODY },
  vehicle:   { id: "qPurchVehicle",   title: "Vehicle",              body: VEHICLE_BODY   },
};

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
  // PR 2 R8 - server `is_future_range` flag. When true, suppress the
  // pill, hero state colour, and Remaining / Over-by verdict - no spend
  // means no verdict.
  isFutureRange = false,
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
    // R10 (owner ruling 2026-08-25) - hasBills MUST mirror the hero's
    // `spent` source. Prior state read bills-only which mismatched the
    // combined hero for every bucket with card spend but no bill spend
    // (Vehicle at ALL / STL - FL / TBJ - FL / TBR - FL / TXR - TX - H
    // / TXR - TX - V on closed P8 all rendered "No spend" pills over
    // real hero dollars). Bind to the same source the hero uses.
    hasBills: heroSpent > 0,
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
    // PR-2 R4 Part A: bucket hero MUST equal bills + coded cards for the
    // same range. Two ways to fail: (a) the two are read from different
    // range-filter conventions - the 07/28 case that produced this fix -
    // or (b) a future edit lets one of the three drift. Either trips the
    // assertion in development. Tolerance is 1c to absorb per-line cent
    // rounding across bill.com aggregation. The assertion is skipped for
    // pass-through accounts (variance disabled by definition).
    const billsN = Number(bills || 0);
    const cardsN = Number(cardsCoded || 0);
    const sourcesSum = Math.round((billsN + cardsN) * 100) / 100;
    const heroR = Math.round(heroSpent * 100) / 100;
    if (Math.abs(heroR - sourcesSum) > 0.01) {
      // eslint-disable-next-line no-console
      console.error(
        "[BucketCard Part A] hero != bills + cards for same range:",
        { bucketKey, heroR, billsN, cardsN, sourcesSum, delta: heroR - sourcesSum },
      );
      throw new Error(
        `BucketCard Part A: hero ${fmt$(heroR)} != bills ${fmt$(billsN)} + cards ${fmt$(cardsN)} (delta ${fmt$(heroR - sourcesSum)})`,
      );
    }
  }

  const rem = Number(budget || 0) - heroSpent;
  // R10 - closed variance now reads from cs. Same source as pill and
  // hero. Prior state computed heroSpent - budget independently which
  // was fine when hasBills matched (heroSpent>0 = budget-nonzero
  // pill-firing case) but is bound explicitly here to prevent the
  // exact drift class this round fixed.
  const varz = cs.variance;
  const usedPct = Number(budget || 0) > 0 ? heroSpent / Number(budget || 0) : null;

  // R10 dev-only assertion. Fires only on genuine contradiction -
  // hero=green while VS BUDGET=red (or the mirror). Neutral vs
  // coloured (variance ~0) is not a contradiction; the closed
  // resolver returns 'under' on spent==budget which colours the
  // hero green while the VS BUDGET row legitimately has no colour.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    if (closed && Number(budget || 0) > 0 && !isFutureRange) {
      const heroC = cs.heroClass;
      const vsC   = cs.signClass;
      const contradicts = (heroC === "r" && vsC === "g") || (heroC === "g" && vsC === "r");
      if (contradicts) {
        // eslint-disable-next-line no-console
        console.error(
          "[BucketCard §R10] hero/VS BUDGET colour contradiction:",
          { bucketKey, heroSpent, budget, state: cs.state, heroClass: heroC, signClass: vsC, variance: cs.variance },
        );
        throw new Error(
          `BucketCard R10 (${bucketKey}): hero '${heroC}' contradicts VS BUDGET '${vsC}' (state=${cs.state}, variance=${cs.variance})`,
        );
      }
    }
  }

  return (
    <div className="kpi-p-row" data-card={`bucket-${bucketKey}`}>
      {/* LEFT */}
      <div className={`kpi-p-card ${strokeClass}`}>
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle">
              {label}
              {BUCKET_HELP[bucketKey] && (
                <>{" "}<HelpPop {...BUCKET_HELP[bucketKey]} /></>
              )}
            </span>
            <span className="kpi-p-cardsub">{sub}</span>
          </div>
          <div className="kpi-p-pillrow">
            {/* PR 2 R8 - no verdict pill on a future range. */}
            {!isFutureRange && <Pill tone={cs.pillTone} label={cs.pillLabel} />}
          </div>
        </div>

        {/* PR 2 R7 Fix 4 - zero-budget cards drop the entire second
            stack. Prior state rendered `Over by —` or `Remaining —` on
            zero-budget buckets - a label that claims a verdict against
            a value that is nil. The `no budget` subline on the hero
            already carries the state; a second stack MUST NOT appear.
            Future range keeps a plain `Budget` presenter. */}
        <div className={`kpi-p-nums${!isFutureRange && Number(budget || 0) === 0 ? " kpi-p-nums-solo" : ""}`}>
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Spent</span>
            {/* PR 2 R8 - hero drops state colour on a future range. */}
            <span className={`kpi-p-hero num ${isFutureRange ? "" : cs.heroClass}`}>{fmt$(heroSpent)}</span>
            <span className="kpi-p-subline">
              of <b>{fmt$(budget)}</b>
              {!isFutureRange && usedPct != null && (
                <>
                  {" "}· <b>{fmtPct(usedPct)}</b> used
                </>
              )}
              {Number(budget || 0) === 0 && (<><span aria-hidden="true"> · </span><b>no budget</b></>)}
            </span>
          </div>
          {isFutureRange ? (
            <div className="kpi-p-stk">
              <span className="kpi-p-label">Budget</span>
              <span className="kpi-p-value num">{fmt$(budget)}</span>
              <span className="kpi-p-subline">this range has not started</span>
            </div>
          ) : Number(budget || 0) === 0 ? (
            null
          ) : (
            <div className="kpi-p-stk">
              {/* PR-2 R2 Fix 3 - owner ruling 2026-08-21: `Remaining` is a
                  quantity, plain, no arrow, no colour. When over budget
                  the label CHANGES to `Over by` and the number is a
                  variance, which may carry colour. Closed periods keep
                  the existing `Vs budget` variance. */}
              <span className="kpi-p-label">
                {closed ? "Vs budget" : (rem < 0 ? "Over by" : "Remaining")}
              </span>
              {closed ? (
                /* R10 - VS BUDGET colour reads from cs.signClass. One
                   source shared with the pill and hero above. */
                <span className={`kpi-p-value num ${cs.signClass || (varz > 0 ? "r" : "g")}`}>{moneyArrow(varz)}</span>
              ) : rem < 0 ? (
                <span className="kpi-p-value num r">{fmt$(-rem)}</span>
              ) : (
                <span className="kpi-p-value num">{fmt$(rem)}</span>
              )}
              <span className="kpi-p-subline">
                {closed
                  ? "period closed"
                  : (budgetSpent
                      ? "budget spent"
                      : (adjusted != null ? `aim for ${fmt$(adjusted)} / wk` : "no target this range"))}
              </span>
            </div>
          )}
        </div>

        {/* PR 2 R8 - future range has no bills, no cards. Suppress the
            split rather than render four $0.00 lines. */}
        {!isFutureRange && (
        <div className="kpi-p-subs">
          {closed ? (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Actual<small>as closed on the P&amp;L</small></span>
                <span className={`kpi-p-v num ${cs.signClass || (varz > 0 ? "r" : "g")}`}>{fmt$(heroSpent)}</span>
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
        )}
      </div>

      {/* RIGHT - strip title follows tier; §B3 owner ruling 2026-08-24. */}
      <div className="kpi-p-card">
        <div className="kpi-p-lh">
          <span className="kpi-p-label">
            {/* PR 2 R9 P3-7 - THE PERIOD · WEEK BY WEEK repeated four
                times on one page (once per bucket) added noise, since
                the bucket card's own title already names the bucket
                and orients the reader. R9 stripped the label; PR 2 R11
                item 5 restores a short `Each week` label because the
                bare `?` floating alone on every bucket card is worse
                than a repeated-but-short label. Period card's chart
                still carries the fuller tier label since it is the
                only one there. */}
            Each week
            {" "}<HelpPop id={`qPurchStrip-${bucketKey}`} title="Each week strip" body={WEEK_STRIP_BODY} />
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
