"use client";

// M-2 (2026-07-29): homestand detail surface. Owner scope C3.1 - the
// screen the build exists for. Answers the chef's questions in the
// order they ask them: what does this homestand look like, how much
// can I spend, what do I owe.
//
// STRUCTURE (per prompt §4.5):
//   - breadcrumb: "< Season - < July - < HS9 >" (hyphens per §5)
//   - header: ordinal, date range, day/game counts, opponents, status
//   - day strip
//   - scheduling instruction (VERBATIM copy per prompt §4.4)
//   - rail (BUDGET FIRST - no spend source until M-3)
//   - state legend (visible; non-negotiable for tracker screens)
//
// M-2 FENCES (per prompt §4.5, §9):
//   - Rail leads with BUDGET, not SPENT. Spend comes from
//     sc_homestand_closeout, which arrives in M-3.
//   - Season-to-date omitted (same reason).
//   - No week summaries. No overtime dividers on the strip. The
//     payroll week convention is open (Round 1 Q1 to owner).
//   - No Handoff motion (scope E3: MLB does not adopt it).
//   - status enum is upcoming | in-progress | ended. Owner ruling
//     (Round 1 §4): `actuals-due` is a close-out concept and arrives
//     in M-3 with the thing that makes it actionable.

import { useMemo } from "react";
import DayStrip from "./DayStrip";
import StateLegend from "../../season/StateLegend";
import { fmt$ } from "../../season/format";

const MON_LONG = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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
                {block.status === "in-progress" ? "in progress" : block.status}
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
          </section>
        </div>

        <aside
          className="sc-homestand-rail"
          aria-label="Homestand summary"
        >
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

          <section className="sc-homestand-rail-section">
            <div className="sc-homestand-rail-label">Service</div>
            <div className="sc-homestand-rail-served">
              {block.servedDays} of {block.gameCount} game days served
              {block.exceptionDays > 0 && (
                <> ({block.exceptionDays} exception{block.exceptionDays === 1 ? "" : "s"})</>
              )}.
            </div>
          </section>

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

      {/* Visible state legend - non-negotiable for tracker screens
          (prompt §4.5 + rubric). CIN-OH is a homestand-fee account so
          the HOMESTAND branch renders. dropDayNight matches how the
          season overview handles the sm-only pill (lg-only glyph
          would be an orphan key here). */}
      <StateLegend
        hasHomestandSchedule={true}
        isFeeAccount={true}
        isMilb={false}
        dropDayNight={true}
      />
    </div>
  );
}
