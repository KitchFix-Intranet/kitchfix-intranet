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
import { fmt$, resolveCardDisplay, stateOf, chartUnit, BUCKET_DEFS } from "../lib/board";
// PR 2 R8 Gap 1 - shared HelpPop portal-renders at document.body so it
// escapes the card's `position: relative` stacking context.
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { FOOD_BODY, PACKAGING_BODY, VEHICLE_BODY } from "./PurchasingHelpPops";

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
  // INV-P21 structural fix (owner ruling 2026-08-26).  Resolver owns
  // every displayed value + every caption.  The component reads
  // formatted strings and colour classes off `d`; it cannot compute
  // anything.  Pending never enters a bucket (structural: pending has
  // no gl_line_code and can't attribute to a bucket).
  //
  // Tier-C caption gate (INV-P21 Part B2 item 2): `aim for $X / wk`
  // hides on tier C.  Previous state suppressed it on the period-card
  // legend but not on the bucket's caption - two decisions in the
  // codebase, one implemented.  Resolver decides once.
  const d = resolveCardDisplay({
    cardKind: "bucket",
    spent: Number(spent || 0),
    budget: Number(budget || 0),
    elapsedFrac,
    closed,
    isFutureRange,
    tier,
    original,
    adjusted,
    budgetSpent,
    // R13 P2-8 - chart header names its bucket ("Each week · food").
    // Sourced from BUCKET_DEFS so a rename in one place propagates.
    identityLabel: (BUCKET_DEFS.find(b => b.key === bucketKey)?.label || "").toLowerCase(),
  });

  // Bills / coded-cards source consistency check (Part A).  Inputs to
  // the derive, not resolver outputs; stays here.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    const heroSpent = Number(spent || 0);
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
            {!isFutureRange && <Pill tone={d.pillTone} label={d.pillLabel} />}
          </div>
        </div>

        {/* Numbers + variance + tier-gated caption all resolver-owned. */}
        <div className={`kpi-p-nums${!d.showRemainingBlock && !isFutureRange ? " kpi-p-nums-solo" : ""}`}>
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Spent</span>
            <span className={`kpi-p-hero num ${d.heroClass}`}>{d.heroValueText}</span>
            <span className="kpi-p-subline">
              of <b>{d.subLineOfBudgetText}</b>
              {d.subLinePctText && (<>{" "}· <b>{d.subLinePctText}</b> used</>)}
              {d.subLineNoBudgetText && (<><span aria-hidden="true"> · </span><b>{d.subLineNoBudgetText}</b></>)}
            </span>
          </div>
          {d.showFutureBudgetBlock ? (
            <div className="kpi-p-stk">
              <span className="kpi-p-label">Budget</span>
              <span className="kpi-p-value num">{d.subLineOfBudgetText}</span>
              <span className="kpi-p-subline">this range has not started</span>
            </div>
          ) : d.showRemainingBlock ? (
            <div className="kpi-p-stk">
              <span className="kpi-p-label">{d.remainingLabel}</span>
              <span className={`kpi-p-value num ${d.remainingClass}`}>{d.remainingValueText}</span>
              <span className="kpi-p-subline">{d.remainingCaption}</span>
            </div>
          ) : null}
        </div>

        {/* PR 2 R8 - future range has no bills, no cards. Suppress the
            split rather than render four $0.00 lines. */}
        {!isFutureRange && (
        <div className="kpi-p-subs">
          {closed ? (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Actual<small>as closed on the P&amp;L</small></span>
                <span className={`kpi-p-v num ${d.remainingClass}`}>{d.heroValueText}</span>
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
                and orients the reader. R9 stripped the label; R11
                restored it as `Each week` (static); R12 item 1 makes
                it tier-aware via `chartUnit(tier)` so a tier-C range
                (period bars) reads `Each period`, not `EACH WEEK`.
                Same `chartUnit()` fuels PeriodCard's fuller label -
                one source for tier ↔ cadence per §9B. */}
            {/* R13 P2-8 - chart header names its bucket so it stops
                reading as "Each week" on four cards in a row.  Bucket
                label sourced from BUCKET_DEFS via the resolver's
                weekStripLabel field. */}
            {d.weekStripLabel || `Each ${chartUnit(tier)}`}
            {/* R13 P2-6 - the ? that used to live here is removed.
                ONE trigger per screen - qPurchPeriod on the period
                card, whose body (PERIOD_BODY) covers the weekly
                mechanic in a single popover. */}
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
