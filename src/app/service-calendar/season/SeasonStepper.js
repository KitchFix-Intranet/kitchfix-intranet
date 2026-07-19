"use client";

// SeasonStepper - the homestand tracker (Design Batch 3, render 2).
//
// Renders for any account with hasHomestandSchedule=true:
//   - MLB fee: CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V (4 accounts)
//   - MiLB AAA (per OV-3 Wave 7 reuse, item 18): CIN-KY, TBJ-NY.
//     `sc-16` (2026-07-11) added the has_homestand_schedule flag
//     to these accounts; #474 (2026-07-19) rode the same homestand
//     context to emit the home-day signal. deriveHomestandSegments
//     is category-agnostic - it groups yearData days by homestandId
//     (populated for every account that clears the flag gate in
//     loadYearSummaryPostgres). No parallel derivation was needed
//     for MiLB reuse (owner's carve-out guard held: existing MLB
//     grouping reused cleanly). Guards satisfied at the reuse site:
//     fee footer + DayDetail untouched, MLB rendering unchanged,
//     read-side only, zero write-path.
//
// Segments: one per homestand, status encoded by fill (done = navy,
// next = grey, focus = amber). The focus segment is the deriveFocus
// segment - live homestand when one is in progress, else the next
// upcoming, else the last done. The focus segment widens and carries
// the HS id label inside.
//
// DESKTOP (>=1024px): caption + bar.
// MOBILE  (<1024px): spotlight card + bar (>=44px tap target).
//
// Engine fence: derives from yearData via homestandDerivation.

import {
  deriveHomestandSegments,
  pickFocusSegment,
  formatHomestandRange,
} from "./homestandDerivation";
import "./seasonStepper.css";

export default function SeasonStepper({
  yearData,                   // months[] from sc-year-summary
  todayDate,                  // "YYYY-MM-DD" | null
  onSegmentClick,             // (homestandId) => void; drills into the period
}) {
  const segments = deriveHomestandSegments(yearData, todayDate);
  if (!segments.length) return null;
  const focus = pickFocusSegment(segments);

  return (
    <section className="sc-stepper" aria-label="Homestand season tracker">
      <div className="sc-stepper-desktop">
        <Caption focus={focus} totalCount={segments.length} />
        <SeasonBar segments={segments} focus={focus} onSegmentClick={onSegmentClick} />
      </div>

      <div className="sc-stepper-mobile">
        {focus && (
          <Spotlight
            focus={focus}
            totalCount={segments.length}
            onClick={() => onSegmentClick?.(focus.segment)}
          />
        )}
        <SeasonBar segments={segments} focus={focus} onSegmentClick={onSegmentClick} />
      </div>
    </section>
  );
}

function Caption({ focus, totalCount }) {
  if (!focus) {
    return (
      <div className="sc-stepper-caption">
        <span className="sc-stepper-caption-tag">Season</span>
        <span className="sc-stepper-caption-text">Season in progress</span>
      </div>
    );
  }
  const { segment, kind } = focus;
  const verb = kind === "now" ? "Now" : kind === "next" ? "Next" : "Last";
  const ordinal = idxLabel(segment, totalCount);
  const range = formatHomestandRange(segment.startDate, segment.endDate);
  const opp = segment.opponents.length > 0 ? "vs " + segment.opponents.join(" / ") : "TBD";
  return (
    <div className={`sc-stepper-caption sc-stepper-caption--${kind}`}>
      <span className="sc-stepper-caption-tag">{verb}</span>
      <span className="sc-stepper-caption-id">{segment.homestandId}</span>
      <span className="sc-stepper-caption-sep" aria-hidden="true">·</span>
      <span className="sc-stepper-caption-opponents">{opp}</span>
      <span className="sc-stepper-caption-sep" aria-hidden="true">·</span>
      <span className="sc-stepper-caption-range">{range}</span>
      {segment.gameCount > 0 && (
        <>
          <span className="sc-stepper-caption-sep" aria-hidden="true">·</span>
          <span className="sc-stepper-caption-count">
            {segment.gameCount} {segment.gameCount === 1 ? "game" : "games"}
          </span>
        </>
      )}
      <span className="sc-stepper-caption-sep" aria-hidden="true">·</span>
      <span className="sc-stepper-caption-ordinal">{ordinal}</span>
    </div>
  );
}

// Mobile spotlight card.
function Spotlight({ focus, totalCount, onClick }) {
  const { segment, kind } = focus;
  const verb = kind === "now" ? "Now" : kind === "next" ? "Next up" : "Last";
  const range = formatHomestandRange(segment.startDate, segment.endDate);
  const opp = segment.opponents.length > 0 ? "vs " + segment.opponents.join(" / ") : "TBD";
  return (
    <button
      type="button"
      className={`sc-stepper-spotlight sc-stepper-spotlight--${kind}`}
      onClick={onClick}
      aria-label={`${verb} ${segment.homestandId}, ${opp}, ${range}, ${segment.gameCount} games`}
    >
      <div className="sc-stepper-spotlight-row">
        <span className={`sc-stepper-spotlight-tag sc-stepper-spotlight-tag--${kind}`}>
          {verb}
        </span>
        <span className="sc-stepper-spotlight-id">{segment.homestandId}</span>
        <span className="sc-stepper-spotlight-ordinal">{idxLabel(segment, totalCount)}</span>
      </div>
      <div className="sc-stepper-spotlight-detail">
        <span className="sc-stepper-spotlight-opp">{opp}</span>
        <span className="sc-stepper-spotlight-sep" aria-hidden="true">·</span>
        <span className="sc-stepper-spotlight-range">{range}</span>
        {segment.gameCount > 0 && (
          <>
            <span className="sc-stepper-spotlight-sep" aria-hidden="true">·</span>
            <span className="sc-stepper-spotlight-count">
              {segment.gameCount} {segment.gameCount === 1 ? "game" : "games"}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

// 13-segment season bar. The focus segment widens (flex: 1.7) and
// carries the HS id label inside; non-focus segments stay flex: 1 and
// fall to done (navy) or next (grey) by status.
function SeasonBar({ segments, focus, onSegmentClick }) {
  const focusId = focus?.segment?.homestandId;
  return (
    <ol
      className="sc-stepper-bar"
      role="list"
      aria-label="Season homestands overview"
    >
      {segments.map((seg) => {
        const isFocus = seg.homestandId === focusId;
        const cls = isFocus ? "focus" : seg.status === "done" ? "done" : "next";
        return (
          <li
            key={seg.homestandId}
            className={`sc-stepper-bar-segment sc-stepper-bar-segment--${cls}`}
          >
            <button
              type="button"
              className="sc-stepper-bar-segment-button"
              onClick={() => onSegmentClick?.(seg)}
              aria-label={ariaLabelForSegment(seg)}
              title={ariaLabelForSegment(seg)}
            >
              {isFocus && (
                <span className="sc-stepper-bar-segment-label">{seg.homestandId}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// "homestand 8 of 13" - the ordinal hint. Uses the homestand_id
// number for the ordinal (assumes HS1..HS13 numbering, which matches
// the seed-script data shape).
function idxLabel(segment, total) {
  const n = parseInt(String(segment.homestandId).replace(/^HS/i, ""), 10);
  if (!Number.isFinite(n)) return "";
  return `homestand ${n} of ${total}`;
}

// SC-006 (2026-07-08): every segment button (not just the current
// focus) carries this label as its accessible name + hover title.
// Format: "HS3 · Apr 12 to Apr 18 · vs ARI / MIL" - a compact readable
// line derived from the data the segment already holds, no fetches.
function ariaLabelForSegment(seg) {
  const range = formatHomestandRange(seg.startDate, seg.endDate);
  const opp = seg.opponents.length > 0
    ? `vs ${seg.opponents.join(" / ")}`
    : "vs opponent TBD";
  return `${seg.homestandId} · ${range} · ${opp}`;
}
