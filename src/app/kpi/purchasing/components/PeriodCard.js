"use client";
// src/app/kpi/purchasing/components/PeriodCard.js
//
// Row 1 of the at-risk board (spec §6.1).
//
// Left half:
//   Card title       "Period N · MM/DD - MM/DD"
//   Meta             "week X of 4 · N% elapsed" / "closed"
//   Pill + Provisional/Final
//   Hero             Spent (KPI line: food + packaging + vehicle)
//   Secondary        Remaining (open) / Vs budget (closed)
//   Sub rows         Bills · Cards · Pending · Projected close (open)
//                    Actual · Budget · Variance (closed)
//
// Right half:
//   Week chart of the KPI line only (§4.1). Equipment + R&M stay off
//   this card and off its chart.
//
// EVERY reading pill / hero / chart comes from a single stateOf() call
// downstream of resolveCardState(). §9B one-source rule.

import { Pill, FinalPill, ProvisionalPill } from "./Pill";
import { WeekChart } from "./WeekChart";
import { fmt$, fmtPct, moneyArrow, resolveCardState } from "../lib/board";
// PR 2 R8 Gap 1 - shared HelpPop portal-renders at document.body so it
// escapes every card's `position: relative` stacking context. Import
// only, never fork.
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { PERIOD_BODY, WEEK_STRIP_BODY } from "./PurchasingHelpPops";

export function PeriodCard({
  periodNo,
  rangeLabel,       // "07/13/26 - 08/09/26"
  weekOfPeriod,     // 1..N week ordinal inside the range (null when closed)
  weeksInPeriod,    // range denominator (4 for single-period, weeks_in_range for FYTD/custom)
  elapsedFrac,      // 0..1
  closed,
  provisional,
  // PR 2 R8 - server flag from /api/kpi/purchasing?...&start=<future>.
  // True when the range has not begun. Suppresses the verdict pill,
  // hero state colour, remaining / over-by variance, projected close
  // row, and swaps the "% elapsed" header for "hasn't started". Budget
  // still shows (it is a fact).
  isFutureRange = false,
  // Money
  spent,            // KPI-line spent (bills + coded cards)
  budget,           // KPI-line budget
  bills,            // KPI-line bills only
  cards,            // KPI-line coded card spend
  cardsThroughLabel,// PR-2 R4 Part E - MM/DD of max(txn_date) on
                    //   rippling_spend; rendered on the Cards subrow
                    //   so the header pill and the row that carries
                    //   the figure agree.
  pending,          // whole-range pending (no bucket split)
  // Chart - tier-aware (PR 2 R3 Part B). `tier`+`units` replace the
  // old fixed-length weekAmounts/weekLabels; WeekChart asserts
  // rendered_units == units.length so silent truncation is caught.
  tier,             // 'A' | 'B' | 'C'
  units,            // array of unit objects (weeks for A/B, periods for C)
  original,
  adjusted,
  budgetSpent,      // PR-2 R2 Fix 2: adjusted clamped upstream when
                    //   budget - finishedSpend <= 0. Swap the target
                    //   legend for "budget spent"; never negative.
  projectedClose,
  // Card title (PR 2 R3 Part B, §B3): follows the RANGE preset like
  // labor's does - "PERIOD 9", "THE LAST 4 WEEKS", "THE LAST 13
  // WEEKS", "FISCAL YEAR TO DATE", or a MM/DD - MM/DD range for a
  // custom pick. Purchasing was rendering "PERIOD -" with a blank
  // where the number goes on every multi-period range.
  cardTitle,
}) {
  // ONE stateOf call - pill / hero / chart / secondary all read from it.
  const cs = resolveCardState({
    spent: Number(spent || 0) + Number(pending || 0),
    budget: Number(budget || 0),
    elapsedFrac,
    hasBills: Number(spent || 0) + Number(pending || 0) > 0,
    closed,
  });

  // PR-2 R4 Part A: period-card hero MUST equal Bills + Cards for the
  // same fiscal-week footprint. Same failure mode as BucketCard - if the
  // three values come from different date conventions, the card lies.
  // Assertion trips in development on any future drift. Skipped when
  // both source values are absent (loading / partial payload).
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    const heroR = Math.round(Number(spent || 0) * 100) / 100;
    const billsN = Number(bills || 0);
    const cardsN = Number(cards || 0);
    const sourcesSum = Math.round((billsN + cardsN) * 100) / 100;
    if ((billsN > 0 || cardsN > 0) && Math.abs(heroR - sourcesSum) > 0.01) {
      // eslint-disable-next-line no-console
      console.error(
        "[PeriodCard Part A] hero != bills + cards for same range:",
        { heroR, billsN, cardsN, sourcesSum, delta: heroR - sourcesSum },
      );
      throw new Error(
        `PeriodCard Part A: hero $${heroR.toFixed(2)} != bills + cards $${sourcesSum.toFixed(2)} (delta $${(heroR - sourcesSum).toFixed(2)})`,
      );
    }
  }

  const rem = Number(budget || 0) - Number(spent || 0) - Number(pending || 0);
  const showOverArrow = rem < 0;
  const varz = Number(spent || 0) - Number(budget || 0);   // closed variance

  const spentUsed = Number(budget || 0) > 0 ? Number(spent || 0) / Number(budget || 0) : null;

  return (
    <div className="kpi-p-row" data-card="period">
      {/* LEFT */}
      <div className="kpi-p-card kpi-p-b-per">
        <div className="kpi-p-head">
          <div className="kpi-p-head-body">
            <span className="kpi-p-cardtitle">
              {cardTitle || (periodNo != null ? `PERIOD ${periodNo}` : "PERIOD -")}
              {" "}<HelpPop id="qPurchPeriod" title="Period summary" body={PERIOD_BODY} />
            </span>
            {rangeLabel && <span className="kpi-p-cardsub">{rangeLabel}</span>}
            <div>
              <span className="kpi-p-cardmeta">
                {(() => {
                  // Denominator: 4 for a single-period range, weeks_in_range
                  // for a longer range. Fall back to 4 when unknown so the
                  // header does not break on partial payloads.
                  const denom = Number(weeksInPeriod) > 0 ? Number(weeksInPeriod) : 4;
                  if (isFutureRange) return `${denom} weeks · `;
                  if (closed) return `${denom} of ${denom} weeks · `;
                  return weekOfPeriod ? `week ${weekOfPeriod} of ${denom} · ` : "";
                })()}
              </span>
              <span
                style={{
                  fontSize: "var(--kpi-t-body)",
                  fontWeight: 800,
                  color: "var(--navy-700)",
                }}
              >
                {/* PR 2 R8 - "% elapsed" on a future range is a lie
                    (the range hasn't started). "hasn't started" is
                    the labor equivalent copy. */}
                {isFutureRange
                  ? "hasn't started"
                  : (closed
                      ? "closed"
                      : (elapsedFrac != null ? `${(elapsedFrac * 100).toFixed(0)}% elapsed` : "in progress"))}
              </span>
            </div>
          </div>
          <div className="kpi-p-pillrow">
            {/* PR 2 R8 - no verdict pill on a future range. Broader
                rule: no spend means no verdict. */}
            {!isFutureRange && <Pill tone={cs.pillTone} label={cs.pillLabel} />}
            {closed ? <FinalPill label="Final" /> : (provisional ? <ProvisionalPill /> : null)}
          </div>
        </div>

        <div className="kpi-p-nums">
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Spent</span>
            {/* PR 2 R8 - hero drops state colour on a future range. `$0.00`
                on a range that hasn't started is a fact, not a verdict. */}
            <span className={`kpi-p-hero num ${isFutureRange ? "" : cs.heroClass}`}>{fmt$(spent)}</span>
            <span className="kpi-p-subline">
              of <b>{fmt$(budget)}</b>
              {!isFutureRange && spentUsed != null && (
                <>
                  {" "}· <b>{fmtPct(spentUsed)}</b> used
                </>
              )}
            </span>
          </div>
          <div className="kpi-p-stk">
            {/* PR-2 R2 Fix 3 - owner ruling 2026-08-21: `Remaining` is a
                quantity, no arrow, no colour. `Over by` takes over when
                the number is a variance (may carry colour). Closed reads
                `Vs budget` unchanged.
                PR 2 R8 - on a future range the second stack is the plain
                budget number - no over/under, no variance. */}
            <span className="kpi-p-label">
              {isFutureRange ? "Budget" : (closed ? "Vs budget" : (showOverArrow ? "Over by" : "Remaining"))}
            </span>
            {isFutureRange ? (
              <span className="kpi-p-value num">{fmt$(budget)}</span>
            ) : closed ? (
              <span className={`kpi-p-value num ${varz > 0 ? "r" : "g"}`}>{moneyArrow(varz)}</span>
            ) : showOverArrow ? (
              <span className="kpi-p-value num r">{fmt$(-rem)}</span>
            ) : (
              <span className="kpi-p-value num">{fmt$(rem)}</span>
            )}
            <span className="kpi-p-subline">
              {isFutureRange
                ? "this range has not started"
                : (closed ? "period closed" : "net of pending")}
            </span>
          </div>
        </div>

        {/* PR 2 R8 - a future range has no bills, no cards, no pending,
            no projection. Rendering four $0.00 rows and a projected-close
            arrow on a range that hasn't started is exactly the false
            verdict the labor brief predicted. Drop the block entirely. */}
        {!isFutureRange && (
        <div className="kpi-p-subs">
          {closed ? (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Actual<small>as closed on the P&amp;L</small></span>
                <span className="kpi-p-v num">{fmt$(spent)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Budget<small>FY2026 plan</small></span>
                <span className="kpi-p-v num">{fmt$(budget)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Variance<small>actual less budget</small></span>
                <span className={`kpi-p-v num ${varz > 0 ? "r" : "g"}`}>{fmt$(Math.abs(varz))}</span>
                <span className={`kpi-p-x ${varz > 0 ? "r" : "g"}`}>{varz > 0 ? "over" : "under"}</span>
              </div>
            </>
          ) : (
            <>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Bills<small>entered in bill.com</small></span>
                <span className="kpi-p-v num">{fmt$(bills)}</span>
                <span className="kpi-p-x">at least</span>
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">
                  Cards
                  <small>
                    coded to a P&amp;L line
                    {cardsThroughLabel ? ` · through ${cardsThroughLabel}` : ""}
                  </small>
                </span>
                <span className="kpi-p-v num">{fmt$(cards)}</span>
                <span className="kpi-p-x" aria-hidden="true" />
              </div>
              <div className="kpi-p-sub">
                <span className="kpi-p-k">Pending<small>card · not yet coded</small></span>
                <span className="kpi-p-v num a">{fmt$(pending)}</span>
                <span className="kpi-p-x a">not on a P&amp;L line</span>
              </div>
              {projectedClose != null && (
                <div className="kpi-p-sub">
                  <span className="kpi-p-k">Projected close<small>if this pace holds</small></span>
                  <span className={`kpi-p-v num ${projectedClose > Number(budget || 0) ? "r" : ""}`}>
                    {fmt$(projectedClose)}
                  </span>
                  <span className={`kpi-p-x ${projectedClose > Number(budget || 0) ? "r" : "g"}`}>
                    {projectedClose > Number(budget || 0) ? "▲ " : "▼ "}
                    {fmt$(Math.abs(projectedClose - Number(budget || 0)))}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </div>

      {/* RIGHT - tier-aware strip. §B3 owner ruling 2026-08-24. */}
      <div className="kpi-p-card">
        <div className="kpi-p-lh">
          <span className="kpi-p-label">
            {tier === "C"
              ? "THE RANGE · PERIOD BY PERIOD"
              : (tier === "A" ? "THE PERIOD · WEEK BY WEEK" : "THE RANGE · WEEK BY WEEK")}
            {" "}<HelpPop id="qPurchWeekStrip" title="Each week strip" body={WEEK_STRIP_BODY} />
          </span>
          <span className="kpi-p-legs">
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
            <span
              className="kpi-p-cardmeta"
              style={{ marginLeft: "auto" }}
            >
              food + packaging + vehicle
            </span>
          </span>
        </div>
        <WeekChart
          tier={tier}
          units={units}
          identity="food"
        />
      </div>
    </div>
  );
}
