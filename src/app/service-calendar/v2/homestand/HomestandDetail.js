"use client";

// M-2 (2026-07-29): homestand detail surface. Owner scope C3.1 - the
// screen the build exists for. M-3 adds the close-out surface below
// the scheduling instruction; the rail can lead with spend once a
// labor_actual exists.
//
// STRUCTURE:
//   - breadcrumb: "< Season - < July - < HS9 >" (hyphens per §5)
//   - header: ordinal, date range, day/game counts, opponents, status
//   - day strip
//   - scheduling instruction (VERBATIM copy per prompt §4.4)
//   - close-out panel (M-3)
//   - rail (BUDGET + spend when closeout exists)
//   - state legend (visible; non-negotiable for tracker screens)
//
// STATUS ENUM (M-3, 2026-08-XX):
//   upcoming    - block not yet started
//   in-progress - today inside span
//   actuals-due - past block, no live closeout
//   closed-out  - live closeout row exists
//
// The M-2 `ended` status retires. Server never emits it once M-3
// lands.

import { useMemo } from "react";
import DayStrip from "./DayStrip";
import CloseoutPanel, { VarianceCell, varianceClass } from "./CloseoutPanel";
// M-2 defect fix (2026-07-29 owner ruling, live-gate bounce):
// dedicated legend for the day strip's vocabulary. StateLegend
// belongs to the day-tile surface and would teach a nine-key
// vocabulary the strip cannot paint - the exact §16 legend audit
// failure. See HomestandLegend.js for the rationale.
import HomestandLegend from "./HomestandLegend";
import { fmt$ } from "../../season/format";

const MON_LONG = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// M-4a (2026-07-29): month-boundary explainer helper. Returns
// { crosses, monthAName, monthBName, monthARange, monthBRange,
// spanDays } when the block straddles a calendar month boundary,
// or null otherwise. Sole reader is CrossMonthExplainer below.
function computeCrossMonth(startIso, endIso) {
  if (!startIso || !endIso) return null;
  if (startIso.slice(0, 7) === endIso.slice(0, 7)) return null;
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  // Last day of the start month = first-of-next-month minus one.
  const firstOfNextMonth = new Date(s.getFullYear(), s.getMonth() + 1, 1);
  const lastOfStartMonth = new Date(firstOfNextMonth.getTime() - 86400000);
  const monthAName = MON_LONG[s.getMonth()];
  const monthAShort = MON_SHORT[s.getMonth()];
  const monthBName = MON_LONG[e.getMonth()];
  const monthBShort = MON_SHORT[e.getMonth()];
  // Single-day sides render as one date, not "N-N". Fires on blocks
  // that start on the last day of a month (start side collapses) or
  // spill exactly one day into the next month (end side collapses).
  // Both are common: any month ending on the last day of a homestand
  // hits the start-side collapse, and any Sunday-ending month
  // produces the end-side collapse. HS1 (Mar 26 - Apr 1) is the
  // end-side pilot; HS12 (Aug 31 - Sep 6) is the start-side pilot.
  const startDay = s.getDate();
  const lastDay = lastOfStartMonth.getDate();
  const endDay = e.getDate();
  const monthARange = startDay === lastDay
    ? `${monthAShort} ${startDay}`
    : `${monthAShort} ${startDay}-${lastDay}`;
  const monthBRange = endDay === 1
    ? `${monthBShort} 1`
    : `${monthBShort} 1-${endDay}`;
  const spanDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return { monthAName, monthBName, monthARange, monthBRange, spanDays };
}

// "P6 + P7" from a budget breakdown. Preserves the array order the
// derivation emitted (chronological by period number). Returns null
// when the breakdown is empty so the caller can skip the clause.
function formatDrawsFrom(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;
  return breakdown.map((b) => `P${b.period}`).join(" + ");
}

// Two independent locators. First tries strict === (numeric game_pk
// paths). Falls back to string compare because the URL always
// stringifies. Guards against a URL carrying "24812345" matching a
// numeric 24812345 in the payload.
function findBlockByKey(list, key) {
  if (!Array.isArray(list) || !key) return null;
  const strict = list.find((b) => b.key === key);
  if (strict) return strict;
  const strKey = String(key);
  return list.find((b) => String(b.key) === strKey) || null;
}

// Noon anchor sidesteps DST-boundary bumping.
function isoAddDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function formatRangeCaption(startIso, endIso) {
  if (!startIso) return "";
  const s = new Date(startIso + "T12:00:00");
  const startLabel = `${MON_SHORT[s.getMonth()]} ${s.getDate()}`;
  if (!endIso || endIso === startIso) return startLabel;
  const e = new Date(endIso + "T12:00:00");
  const endLabel = e.getMonth() === s.getMonth()
    ? `${e.getDate()}`
    : `${MON_SHORT[e.getMonth()]} ${e.getDate()}`;
  return `${startLabel} - ${endLabel}`;
}

// Map yearData months[].days[] into a date-keyed lookup for the
// strip. Preserves dayType / opponent / status - the three fields
// the strip's classifier reads. Any date missing from the map is
// treated as a prep by the classifier.
function buildDayMap(yearData) {
  const m = new Map();
  if (!Array.isArray(yearData)) return m;
  for (const month of yearData) {
    if (!month?.days) continue;
    for (const d of month.days) {
      if (d?.date) m.set(d.date, d);
    }
  }
  return m;
}

// Breadcrumb month label. Reads the block's start-month for the middle
// crumb ("< July"). July is the containing month of HS9's first game,
// which matches the mental model of a chef navigating up from a
// homestand into the month it lives in.
function monthLabelForBlock(block) {
  if (!block?.startDate) return null;
  const d = new Date(block.startDate + "T12:00:00");
  return {
    long: MON_LONG[d.getMonth()],
    monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
  };
}

// M-4a defect 3: homestand rail progress bar. Reads spend vs budget
// and paints a proportional fill. Clamps to 100% for visual (the
// numeric variance still tells the truth about over-budget). Uses
// existing CSS variables so no new px literals ship. Grayscale-safe
// via the aria-label carrying the ratio verbally.
function SpendProgress({ spent, budget, label }) {
  if (!Number.isFinite(spent) || !Number.isFinite(budget) || budget <= 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round((spent / budget) * 100)));
  const overBudget = spent > budget;
  return (
    <div
      className={`sc-homestand-rail-progress ${overBudget ? "sc-homestand-rail-progress--over" : "sc-homestand-rail-progress--under"}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${label}, ${pct} percent`}
    >
      <div
        className="sc-homestand-rail-progress-fill"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function HomestandDetail({
  account,
  year,                 // reserved for future season-scoped nav
  homestandKey,
  homestands,           // array from sc-year-summary; may be null
  yearData,             // months[] from sc-year-summary; may be null
  todayIso,
  loadState,            // "idle" | "loading" | "loaded" | "failed"
  onClimbToSeason,
  onNavHomestand,       // (segmentKey) => void
  // M-3 (2026-08-XX): close-out plumbing. showToast surfaces the
  // "closed out" / "reopened" confirmations; onReload bumps the
  // parent's reloadKey after a successful confirm so the payload
  // (including status transitions) refetches.
  showToast,
  onReload,
}) {
  // Hooks-first (rules-of-hooks): every useMemo runs on every render,
  // regardless of the early-return branches below. `block` may be
  // null; each memo tolerates it and returns a benign default so the
  // early returns can still render an empty state without breaking
  // the hook order between renders.
  const block = findBlockByKey(homestands, homestandKey);
  const dayMap = useMemo(() => buildDayMap(yearData), [yearData]);
  const prepSet = useMemo(
    () => new Set(block?.prepDays || []),
    [block?.prepDays]
  );

  // Season-to-date rollup for the §5.5 rail. Reads `homestands` only,
  // NOT `block`, so it survives when the URL points at an unknown key.
  // Hoisted above the early returns to preserve hook order between
  // loading -> loaded transitions - the exact rule the top-of-function
  // comment warns about and the reason M-2's dayMap + prepSet live up
  // here. Adding a hook below the early returns is a client-side
  // crash on every mount.
  const seasonToDate = useMemo(() => {
    if (!Array.isArray(homestands)) return null;
    let actual = 0;
    let budget = 0;
    let count = 0;
    let anyBudgetMissing = false;
    for (const b of homestands) {
      if (b?.laborActual == null) continue;
      actual += Number(b.laborActual);
      if (b.budgetSnapshotAtCloseout != null) {
        budget += Number(b.budgetSnapshotAtCloseout);
      } else {
        anyBudgetMissing = true;
      }
      count += 1;
    }
    if (count === 0) return null;
    return {
      count,
      actual,
      budget: anyBudgetMissing ? null : budget,
      variance: anyBudgetMissing ? null : actual - budget,
    };
  }, [homestands]);

  // Loading + failed short-circuit. A homestand surface with an empty
  // day strip and no budget reads as "0 game days, no budget yet",
  // which is a lie during regular season. Same missing-vs-zero rule
  // the payload discipline carries.
  if (loadState === "loading" || !homestands) {
    return (
      <div className="sc-homestand">
        <div className="sc-homestand-empty" role="status" aria-live="polite">
          Loading homestand.
        </div>
      </div>
    );
  }
  if (loadState === "failed") {
    return (
      <div className="sc-homestand">
        <div className="sc-homestand-empty" role="alert">
          This homestand could not be loaded. Try refreshing.
        </div>
      </div>
    );
  }

  if (!block) {
    // Unknown key (deep-link stale after a reschedule, or a wrong-
    // account URL that got past the mount gate). Empty state with a
    // path back to the Season, mirroring the pattern in the period
    // workspace for an unknown ?period=.
    return (
      <div className="sc-homestand">
        <nav className="sc-homestand-breadcrumb" aria-label="Homestand navigation">
          <button
            type="button"
            className="sc-homestand-breadcrumb-link"
            onClick={onClimbToSeason}
          >
            &lt; Season
          </button>
        </nav>
        <div className="sc-homestand-empty" role="status">
          Homestand not found. It may have been rescheduled or removed.
        </div>
      </div>
    );
  }

  const idx = homestands.findIndex((b) => b.key === block.key);
  const prev = idx > 0 ? homestands[idx - 1] : null;
  const next = idx >= 0 && idx < homestands.length - 1 ? homestands[idx + 1] : null;

  const monthLabel = monthLabelForBlock(block);
  const domainStart = isoAddDays(block.startDate, -1);
  const domainEnd = block.endDate;

  // Scheduling instruction pieces.
  //
  // "Schedule N days in Rippling. Keep your total at or below $X."
  //
  // N = block gameCount + prepDays.length. `prepDays` on the payload
  // is the derived proposal per B3 (leading pre-day + internal off-
  // days), so this sum matches the visible day strip's cell count.
  // Both numbers are derived on the same feed; if a future edge
  // desynchronizes them, the day strip is the source of truth
  // (owner instruction Q6 item 3 - stop and report rather than
  // reconciling).
  const scheduleDays = (block.gameCount || 0) + (block.prepDays?.length || 0);

  // Budget for the rail figure. Present -> dollar figure; missing ->
  // reason string. Never $0.
  const budgetAmount = block.budget?.amount ?? null;
  const budgetBreakdown = block.budget?.breakdown || [];
  const budgetReason = block.budgetReason;

  // §5.5 (M-3): once a live close-out exists, the rail leads with
  // SPENT and shows variance against the budget snapshot the confirm
  // froze. Falls back to the BUDGET-only shape for upcoming /
  // in-progress / actuals-due. `laborActual` and
  // `budgetSnapshotAtCloseout` are emitted by
  // buildHomestandsPayload ONLY when a live closeout row exists, so
  // presence of laborActual is the correct branch key.
  const closeoutSpent = block.laborActual;
  const closeoutBudget = block.budgetSnapshotAtCloseout;
  const hasCloseout = closeoutSpent != null;
  const closeoutVariance = (closeoutSpent != null && closeoutBudget != null)
    ? closeoutSpent - closeoutBudget
    : null;

  // seasonToDate is hoisted above the early returns (see top of function).

  return (
    <div className="sc-homestand">
      <nav className="sc-homestand-breadcrumb" aria-label="Homestand navigation">
        <button
          type="button"
          className="sc-homestand-breadcrumb-link"
          onClick={onClimbToSeason}
        >
          &lt; Season
        </button>
        {monthLabel && (
          <>
            <span className="sc-homestand-breadcrumb-sep">-</span>
            <span className="sc-homestand-breadcrumb-current">
              {monthLabel.long}
            </span>
          </>
        )}
        <span className="sc-homestand-breadcrumb-sep">-</span>
        <span className="sc-homestand-breadcrumb-current">{block.ordinal}</span>
      </nav>

      <div className="sc-homestand-body">
        <div className="sc-homestand-main">
          <header className="sc-homestand-header">
            <div className="sc-homestand-header-row">
              <h1 className="sc-homestand-title">{block.ordinal}</h1>
              <span className="sc-homestand-daterange">
                {formatRangeCaption(block.startDate, block.endDate)}
              </span>
              <span className={`sc-homestand-status sc-homestand-status--${block.status}`}>
                {block.status === "in-progress" ? "in progress"
                  : block.status === "actuals-due" ? "actuals due"
                  : block.status === "closed-out" ? "closed out"
                  : block.status}
              </span>
            </div>
            <div className="sc-homestand-meta">
              <span className="sc-homestand-meta-item">
                <span className="sc-homestand-meta-value">{block.gameCount}</span>
                {block.gameCount === 1 ? " game" : " games"}
              </span>
              <span className="sc-homestand-meta-item">
                <span className="sc-homestand-meta-value">{block.dayCount}</span>
                {block.dayCount === 1 ? " day" : " days"}
              </span>
              {block.opponents?.length > 0 && (
                <span className="sc-homestand-meta-item">
                  vs {block.opponents.join(", ")}
                </span>
              )}
            </div>
          </header>

          <DayStrip
            domainStart={domainStart}
            domainEnd={domainEnd}
            dayMap={dayMap}
            prepSet={prepSet}
          />

          {/* Scheduling instruction. Verbatim copy per prompt §4.4:
              the disambiguation sentence is fixed and MUST NOT be
              reworded. Owner instruction: "If you think this reads
              wrong, say so rather than changing it." */}
          <section
            className="sc-homestand-instruction"
            aria-labelledby="sc-homestand-instruction-head"
          >
            <div
              className="sc-homestand-instruction-head"
              id="sc-homestand-instruction-head"
            >
              Scheduling
            </div>
            <div className="sc-homestand-instruction-figure">
              Schedule {scheduleDays} days in Rippling.
              {budgetAmount != null && (
                <> Keep your total at or below {fmt$(budgetAmount)}.</>
              )}
            </div>
            <div className="sc-homestand-instruction-note">
              Schedule days include the prep day before the homestand.
              The budget is calculated on game days only.
            </div>
            {/* M-4a: budget-detail line - the designed home for the
                overtime + period-source facts. Owner note: this also
                closes an M-3 rail regression - the rail dropped the
                period breakdown once a block closed out because it
                only lived in the budget branch. Hosting the source
                list here means it fires for open AND closed blocks.
                Skips when no budget exists (missing-vs-zero on copy). */}
            {budgetAmount != null && (() => {
              const drawsFrom = formatDrawsFrom(budgetBreakdown);
              return (
                <div className="sc-homestand-instruction-detail">
                  Budget includes overtime at 1.5x for hours over 40/wk
                  {drawsFrom && (
                    <> · draws from {drawsFrom}</>
                  )}.
                </div>
              );
            })()}
          </section>

          {/* M-4a: month-boundary explainer. Renders only when the
              block straddles a calendar month boundary (e.g. HS10
              Jul 27 - Aug 6). The month cards will show partial
              spans (Jul 27-31 in July, Aug 1-6 in August), so the
              homestand scope carrying all N days needs a plain-
              English note that this is by design, not a rendering
              bug. Sits under the instruction so it is one glance
              from the scheduling copy that already talks about
              days. */}
          {(() => {
            const cm = computeCrossMonth(block.startDate, block.endDate);
            if (!cm) return null;
            return (
              <section
                className="sc-homestand-crossmonth"
                aria-label="Homestand crosses a month boundary"
              >
                This homestand crosses a month boundary. {cm.monthAName} shows {cm.monthARange}, {cm.monthBName} shows {cm.monthBRange}. All {cm.spanDays} days appear here because a homestand is its own scope.
              </section>
            );
          })()}

          {/* M-3 close-out panel. Rendering is state-driven inside
              CloseoutPanel:
                upcoming    -> nothing
                in-progress -> disabled "opens after..." note
                actuals-due -> active confirm form
                closed-out  -> summary + reopen (or reopen form) */}
          <CloseoutPanel
            account={account}
            block={block}
            dayMap={dayMap}
            todayIso={todayIso}
            showToast={showToast}
            onSaved={onReload}
          />
        </div>

        <aside
          className="sc-homestand-rail"
          aria-label="Homestand summary"
        >
          {/* §5.5 (M-3): rail leads with SPENT + variance once the
              close-out has written a labor actual. Budget appears as
              context under the spend figure. Falls back to the
              BUDGET-only shape (below) when no close-out exists.

              M-4a (2026-07-29): adds a progress bar under the SPENT
              figure so the ratio reads without decoding numbers. */}
          {hasCloseout ? (
            <section className="sc-homestand-rail-section">
              <div className="sc-homestand-rail-label">Spent</div>
              <div className="sc-homestand-rail-figure">
                {fmt$(closeoutSpent)}
              </div>
              <div className="sc-homestand-rail-vs-budget">
                vs {closeoutBudget != null ? fmt$(closeoutBudget) : "no budget snapshot"} budget
              </div>
              {closeoutBudget != null && closeoutBudget > 0 && (
                <SpendProgress
                  spent={closeoutSpent}
                  budget={closeoutBudget}
                  label="Homestand spend against budget"
                />
              )}
              {closeoutVariance != null && (
                <div
                  className={`sc-homestand-rail-variance ${varianceClass(closeoutVariance)}`}
                >
                  <VarianceCell variance={closeoutVariance} showCarryToSeason={false} />
                </div>
              )}
            </section>
          ) : (
            <section className="sc-homestand-rail-section">
              <div className="sc-homestand-rail-label">Budget</div>
              {budgetAmount != null ? (
                <>
                  <div className="sc-homestand-rail-figure">
                    {fmt$(budgetAmount)}
                  </div>
                  {budgetBreakdown.length > 1 && (
                    <div
                      className="sc-homestand-rail-breakdown"
                      aria-label="Budget breakdown by period"
                    >
                      {budgetBreakdown.map((b) => (
                        <div
                          key={b.period}
                          className="sc-homestand-rail-breakdown-row"
                        >
                          <span>Period {b.period}</span>
                          <span>{fmt$(b.subtotal)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="sc-homestand-rail-figure sc-homestand-rail-figure--missing">
                  {budgetReason || "No budget recorded yet."}
                </div>
              )}
            </section>
          )}

          <section className="sc-homestand-rail-section">
            <div className="sc-homestand-rail-label">Service</div>
            {/* F3 (2026-07-29 owner ruling): servedDays + exceptionDays
                can be less than gameCount for an actuals-due block -
                a past game day never entered classifies as overdue or
                needs-entry and lands in neither bucket. Surface the
                unentered count explicitly on actuals-due blocks so
                the rail does not read as though the block is fully
                accounted for.
                M-3 (2026-08-XX): status enum change - `ended` retires;
                `actuals-due` is the new "past + not closed" state.
                A closed-out block cannot have unentered game days by
                construction (the confirm wrote counts for every
                non-exception day), so the unentered branch cannot
                paint on `closed-out`. */}
            <div className="sc-homestand-rail-served">
              {block.servedDays} of {block.gameCount} game days served
              {block.exceptionDays > 0 && (
                <> ({block.exceptionDays} exception{block.exceptionDays === 1 ? "" : "s"})</>
              )}.
              {(() => {
                const unentered = (block.gameCount || 0) - (block.servedDays || 0) - (block.exceptionDays || 0);
                if (unentered > 0 && block.status === "actuals-due") {
                  return <> {unentered} not entered.</>;
                }
                return null;
              })()}
            </div>
          </section>

          {/* Season-to-date - pinned near the bottom (M-4a defect 2)
              so the block's own SPENT figure stays the hero. Only
              paints when at least one homestand has closed out.
              Dedupe (M-4a defect 1): when only ONE homestand has
              closed out AND that one is the currently-viewed block,
              the season-to-date row would repeat the SPENT figure
              and variance verbatim. Hide in that case. */}
          {seasonToDate && !(hasCloseout && seasonToDate.count === 1) && (
            <section
              className="sc-homestand-rail-section"
              aria-label="Season to date"
            >
              <div className="sc-homestand-rail-label">Season to date</div>
              <div className="sc-homestand-rail-std-figure">
                {fmt$(seasonToDate.actual)}
              </div>
              <div className="sc-homestand-rail-std-context">
                across {seasonToDate.count} closed-out homestand{seasonToDate.count === 1 ? "" : "s"}
                {seasonToDate.budget != null && (
                  <> vs {fmt$(seasonToDate.budget)} budget</>
                )}
              </div>
              {seasonToDate.variance != null && (
                <div
                  className={`sc-homestand-rail-variance ${varianceClass(seasonToDate.variance)}`}
                >
                  <VarianceCell
                    variance={seasonToDate.variance}
                    showCarryToSeason={false}
                  />
                </div>
              )}
            </section>
          )}

          <nav
            className="sc-homestand-rail-nav"
            aria-label="Homestand navigation"
          >
            <button
              type="button"
              className="sc-homestand-rail-navbtn"
              disabled={!prev}
              onClick={() => prev && onNavHomestand(prev.key)}
              aria-label={prev ? `Previous homestand ${prev.ordinal}` : "No previous homestand"}
            >
              &lt; {prev ? prev.ordinal : "Prev"}
            </button>
            <button
              type="button"
              className="sc-homestand-rail-navbtn"
              disabled={!next}
              onClick={() => next && onNavHomestand(next.key)}
              aria-label={next ? `Next homestand ${next.ordinal}` : "No next homestand"}
            >
              {next ? next.ordinal : "Next"} &gt;
            </button>
          </nav>
        </aside>
      </div>

      {/* Visible legend - non-negotiable for tracker screens (prompt
          §4.5 + rubric). Homestand-specific: covers only what the
          day strip paints (game / served / prep proposal / no
          service / new month). See HomestandLegend.js for why this
          is a dedicated component rather than a StateLegend variant. */}
      <HomestandLegend />
    </div>
  );
}
