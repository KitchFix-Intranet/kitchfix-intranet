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
import { fmt$, resolveCardDisplay, chartUnit } from "../lib/board";
// PR 2 R8 Gap 1 - shared HelpPop portal-renders at document.body so it
// escapes every card's `position: relative` stacking context. Import
// only, never fork.
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { PERIOD_BODY } from "./PurchasingHelpPops";

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
  // PR 3 (spec §2) - pass-through accounts short-circuit stateOf to
  // 'passthru' (pill reads "Billed to client"). Additive prop, default
  // false; at-risk callers unchanged. Threads into the ONE stateOf
  // call so pill / hero / chart all agree, per §9B one-source rule.
  isPassThrough = false,
  // R13 P0-1 - closed-card comparison payload from route.period_history.
  //   { prior: { period_no, spent, label }, sparkline: [{period_no,spent}] }
  // null on any non-closed-single-period range.
  periodHistory = null,
}) {
  // INV-P21 structural fix (owner ruling 2026-08-26).  Resolver owns
  // every displayed value + every caption.  The component reads
  // formatted strings and colour classes off `d`; it cannot compute
  // anything.  ESLint gate `no-purchasing-arithmetic` enforces this.
  //
  // Owner ruling on pending (2026-08-26, Option 2):
  //   - Pending stays in the LIVE verdict (pill + variance).
  //   - Pending stays out of CLOSED verdicts.
  //   - Hero stays coded-only in this PR - rule 2 (no figure changes).
  //     Follow-up (Option 3, deferred): move hero to spent+pending on
  //     live to close the class properly.
  //
  // Sign-gated caption below the variance:
  //   under (Remaining)      -> "net of pending"
  //   over  (Over by)        -> "includes uncoded pending"
  //   closed                 -> "period closed"
  const d = resolveCardDisplay({
    cardKind: "period",
    spent: Number(spent || 0),
    budget: Number(budget || 0),
    pending: Number(pending || 0),
    elapsedFrac,
    closed,
    isPassThrough,
    isFutureRange,
    projectedClose,
    tier,
    // R13 P0-1: comparison block inputs.  Resolver formats; component
    // renders what it's told.
    periodNo,
    priorPeriod: periodHistory?.prior || null,
    sparkline:   periodHistory?.sparkline || null,
    // R13 P2-8: chart header names its bucket.  Period card carries
    // food + packaging + vehicle (the aggregate identity).
    identityLabel: "food + packaging + vehicle",
  });

  // PR-2 R4 Part A: bill / card source consistency check.  Bills and
  // cards are input signatures (not resolver outputs), so this stays
  // alongside the resolver call - it verifies the props passed in
  // match the derive path.  No arithmetic on `spent`/`budget` at
  // render time.
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
            {/* PR 2 R8 - no verdict pill on a future range. */}
            {!isFutureRange && <Pill tone={d.pillTone} label={d.pillLabel} />}
            {closed ? <FinalPill label="Final" /> : (provisional ? <ProvisionalPill /> : null)}
          </div>
        </div>

        {/* Numbers block.  Every value + caption below comes from `d`
            (resolveCardDisplay) so hero, sub-line, remaining label,
            remaining value, remaining colour, and remaining caption
            cannot be computed from different subsets of pending. */}
        <div className={`kpi-p-nums${!d.showRemainingBlock && !isFutureRange ? " kpi-p-nums-solo" : ""}`}>
          <div className="kpi-p-stk">
            <span className="kpi-p-label">Spent</span>
            <span className={`kpi-p-hero num ${d.heroClass}`}>{d.heroValueText}</span>
            <span className="kpi-p-subline">
              of <b>{d.subLineOfBudgetText}</b>
              {d.subLinePctText && (
                <>{" "}· <b>{d.subLinePctText}</b> used</>
              )}
              {d.subLineNoBudgetText && (
                <><span aria-hidden="true"> · </span><b>{d.subLineNoBudgetText}</b></>
              )}
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
              {/* R13 P1-2 - the right column earns its sub-line on live
                  over cases: `<b>4.5%</b> of the range budget`.  Closed
                  uses `remainingCaption` = "as closed on the P&L".
                  Only one of the two is non-empty. */}
              <span className="kpi-p-subline">
                {d.remainingSubLineText ? (
                  <><b>{d.remainingSubLineText}</b> of the range budget</>
                ) : d.remainingCaption}
              </span>
            </div>
          ) : null}
        </div>

        {/* R13 P0-1 - closed period comparison block replaces the old
            Actual / Budget / Variance sub-block.  The old block was
            tautological: three values, each printed twice, with two
            different labels for the same number.  Prior-period tells
            an operator what the top of the card cannot: whether the
            period was normal.  Rendered on closed only.

            R13 P1-1 - live sub-rows: Bills / Cards / Pending have an
            empty third column (they're components that sum to the
            hero, no qualifier needed).  Projected close is promoted
            below a rule into its own row - it's a forecast, not a
            component. */}
        {!isFutureRange && (closed ? (
          d.showPriorPeriodBlock ? (
            <div className="kpi-p-per-cmp">
              <div className="kpi-p-per-cmp-row">
                <span className="kpi-p-k">
                  {d.priorPeriodLabelText}
                  <small>{d.priorPeriodDescription}</small>
                </span>
                <span className="kpi-p-v num">{d.priorPeriodValueText}</span>
                <span className={`kpi-p-x ${d.priorPeriodDeltaClass}`}>
                  {d.priorPeriodDeltaArrow}
                  {d.priorPeriodDeltaText}
                </span>
              </div>
              {d.sparklineHeights.length > 0 && (
                <>
                  <div className="kpi-p-spark" aria-hidden="true">
                    {d.sparklineHeights.map((h, i) => (
                      <i
                        key={i}
                        className={i === d.sparklineCurrentIdx ? "now" : ""}
                        style={{ height: `${(h * 100).toFixed(0)}%` }}
                      />
                    ))}
                  </div>
                  <span className="kpi-p-cardmeta">
                    {d.sparklineNote}
                    {isPassThrough || (periodNo == null) ? "" : " · this rollup"}
                  </span>
                </>
              )}
            </div>
          ) : null
        ) : (
          <div className="kpi-p-subs">
            <div className="kpi-p-sub">
              <span className="kpi-p-k">Bills<small>entered in bill.com</small></span>
              <span className="kpi-p-v num">{fmt$(bills)}</span>
              <span className="kpi-p-x" aria-hidden="true" />
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
              <span className="kpi-p-x" aria-hidden="true" />
            </div>
          </div>
        ))}

        {/* R13 P1-1 - projected close promoted out of the sub-rows into
            its own row with its own variance.  It's a forecast, not a
            component of hero-spend; its variance is often bigger than
            the hero variance itself, and it belongs at its own
            weight.  Rendered on live period cards only. */}
        {!isFutureRange && !closed && d.showProjectedClose && (
          <div className="kpi-p-per-proj">
            <span className="kpi-p-k">Projected close<small>if this pace holds</small></span>
            <span className={`kpi-p-v num ${d.projectedCloseValueClass}`}>
              {d.projectedCloseValueText}
            </span>
            <span className={`kpi-p-x ${d.projectedCloseAnnotationClass}`}>
              {d.projectedCloseArrow}
              {d.projectedCloseDeltaText}
            </span>
          </div>
        )}
      </div>

      {/* RIGHT - tier-aware strip. §B3 owner ruling 2026-08-24. */}
      <div className="kpi-p-card">
        <div className="kpi-p-lh">
          <span className="kpi-p-label">
            {/* R12 item 1 - cadence axis pulled from chartUnit() so
                BucketCard and PeriodCard cannot disagree.  Scope axis
                (`THE PERIOD` vs `THE RANGE`) is period-card-only.
                R13 P2-6 - the ? that used to live here (and on every
                bucket chart) is removed.  ONE trigger per screen -
                the `qPurchPeriod` at the card title above, whose body
                (PERIOD_BODY) now covers the weekly mechanic + Bills-
                is-a-floor + Pending + sub-rows in a single popover. */}
            {(() => {
              const unit = chartUnit(tier);
              const cadence = `${unit.toUpperCase()} BY ${unit.toUpperCase()}`;
              return `THE ${tier === "A" ? "PERIOD" : "RANGE"} · ${cadence}`;
            })()}
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
