"use client";

// SeasonStepper - the homestand journey (Design Batch 3, audit P1-7).
//
// Replaces the broken "Jan-Dec axis + Stage 3 placeholder" strip on
// the 4 MLB-fee accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) with
// the approved option-A stepper: homestands as ordered stops on a
// progress journey, the connecting line filled to today.
//
// DESKTOP: full horizontal stepper.
//   - Caption above: "Now / Next / Last · HS<n> · <opp> -> <opp> ·
//     <range> · <count> games · homestand <n> of <total>"
//   - Connecting line filled to the current "now" stop (or to the
//     last "done" stop when there is no current homestand).
//   - Dot shape + fill + label encode status (rubric Part 3: status
//     legible without color):
//       done    - filled navy + check glyph
//       now     - larger amber dot with ring + ARIA "in progress"
//       next    - hollow grey-bordered dot
//   - Opponent label under each dot (compact "ARI" / "ARI/MIA").
//   - Tap or Enter / Space on a stop -> drills into that homestand's
//     period (onSegmentClick, wired by SeasonShell).
//
// MOBILE (<1024px): the 13-stop row does not fit. Collapses to:
//   - SPOTLIGHT card: the focus segment (now / next / last)
//   - SEASON BAR: 13 ordinal segments (one per homestand), color-
//     coded by status, current highlighted. The glanceable overview.
//
// No load-bearing animation; prefers-reduced-motion compliant.
// Engine fence: derives from yearData (segments come from the
// homestand derivation helper).

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
    <section className="sc-stepper" aria-label="Homestand season stepper">
      <Caption focus={focus} totalCount={segments.length} />

      {/* Desktop: full stepper - hidden below 1024px via CSS */}
      <div className="sc-stepper-desktop">
        <Stepper segments={segments} onSegmentClick={onSegmentClick} />
      </div>

      {/* Mobile / floor: spotlight + 13-segment bar */}
      <div className="sc-stepper-mobile">
        {focus && (
          <Spotlight
            focus={focus}
            totalCount={segments.length}
            onClick={() => onSegmentClick?.(focus.segment)}
          />
        )}
        <SeasonBar segments={segments} onSegmentClick={onSegmentClick} />
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
  const opp = segment.opponents.length > 0 ? segment.opponents.join(" -> ") : "TBD";
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

// Desktop stepper: dots + connecting line (filled to the "now" segment
// when there is one, else to the last "done" segment).
function Stepper({ segments, onSegmentClick }) {
  // Find the index of the rightmost "done" or "now" so the line fills
  // up to (and through) it.
  let fillIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].status === "done" || segments[i].status === "now") {
      fillIndex = i;
    }
  }
  // Convert to a percentage offset (0 to 100) along the rail. The
  // dots are evenly spaced; the line ends at the center of the last
  // filled dot.
  const fillPct = fillIndex >= 0
    ? (segments.length === 1 ? 100 : (fillIndex / (segments.length - 1)) * 100)
    : 0;

  return (
    <ol
      className="sc-stepper-rail"
      role="list"
      aria-label="Season homestands"
    >
      <div className="sc-stepper-line" aria-hidden="true">
        <div
          className="sc-stepper-line-fill"
          style={{ width: `${fillPct}%` }}
        />
      </div>
      {segments.map((seg, i) => (
        <Stop
          key={seg.homestandId}
          segment={seg}
          onClick={onSegmentClick}
          index={i}
          total={segments.length}
        />
      ))}
    </ol>
  );
}

function Stop({ segment, onClick, index, total }) {
  const label = ariaLabelForSegment(segment, index, total);
  return (
    <li className={`sc-stepper-stop sc-stepper-stop--${segment.status}`}>
      <button
        type="button"
        className="sc-stepper-stop-button"
        onClick={() => onClick?.(segment)}
        aria-label={label}
        title={label}
      >
        <span className="sc-stepper-stop-dot" aria-hidden="true">
          {segment.status === "done" && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
        </span>
        <span className="sc-stepper-stop-label">
          <span className="sc-stepper-stop-id">{segment.homestandId}</span>
          {segment.opponents.length > 0 && (
            <span className="sc-stepper-stop-opp">
              {compactOpps(segment.opponents)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

// Mobile spotlight card.
function Spotlight({ focus, totalCount, onClick }) {
  const { segment, kind } = focus;
  const verb = kind === "now" ? "Now" : kind === "next" ? "Next up" : "Last";
  const range = formatHomestandRange(segment.startDate, segment.endDate);
  const opp = segment.opponents.length > 0 ? segment.opponents.join(" -> ") : "TBD";
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

// Mobile 13-segment season bar. Each segment status-colored; current
// gets a small caret above it.
function SeasonBar({ segments, onSegmentClick }) {
  return (
    <ol
      className="sc-stepper-bar"
      role="list"
      aria-label="Season homestands overview"
    >
      {segments.map((seg) => (
        <li
          key={seg.homestandId}
          className={`sc-stepper-bar-segment sc-stepper-bar-segment--${seg.status}`}
        >
          <button
            type="button"
            className="sc-stepper-bar-segment-button"
            onClick={() => onSegmentClick?.(seg)}
            aria-label={ariaLabelForSegment(seg)}
            title={ariaLabelForSegment(seg)}
          />
        </li>
      ))}
    </ol>
  );
}

// "ARI" or "ARI/MIA" - one or two opponents joined by "/" so the dot
// label fits at desktop without truncation. The full set lives in the
// caption + spotlight.
function compactOpps(opps) {
  if (!opps || opps.length === 0) return "";
  if (opps.length === 1) return opps[0];
  if (opps.length === 2) return opps.join("/");
  return `${opps[0]}/${opps[opps.length - 1]}`;
}

// "homestand 8 of 13" - the ordinal hint. Uses the homestand_id
// number for the ordinal (assumes HS1..HS13 numbering, which matches
// the seed-script data shape).
function idxLabel(segment, total) {
  const n = parseInt(String(segment.homestandId).replace(/^HS/i, ""), 10);
  if (!Number.isFinite(n)) return "";
  return `homestand ${n} of ${total}`;
}

function ariaLabelForSegment(seg, index, total) {
  const verb = seg.status === "done" ? "completed" : seg.status === "now" ? "in progress" : "upcoming";
  const opp = seg.opponents.length > 0 ? seg.opponents.join(" to ") : "opponent to be determined";
  const range = formatHomestandRange(seg.startDate, seg.endDate);
  const games = seg.gameCount > 0 ? `, ${seg.gameCount} games` : "";
  const ord = (index != null && total != null)
    ? `, ${idxLabel(seg, total)}`
    : "";
  return `${seg.homestandId}, ${opp}, ${range}${games}${ord}, ${verb}`;
}
