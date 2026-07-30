"use client";

// SeasonStepper - the homestand tracker.
//
// Renders for any account with hasHomestandSchedule=true (MLB fee +
// MiLB AAA). Non-MLB accounts get [] out of deriveHomestandSegments
// and this component returns null - the strip does not paint.
//
// M-4b (2026-07-30 - owner review of the new rail): the header
// simplified drastically. rev-earlier carried a spotlight card,
// three-part footer, and an affordance hint. All three duplicated
// content the rev3 rail (pinned in-progress card + three collapsed
// groups) now carries a few inches to the right, and the strip is
// the only element the rail cannot show.
//
// Reduced to: proportional strip + two month anchors, roughly
// 60px tall.
//
// Segments: one per homestand.
//   - Proportional flex by span days (three-day block reads about
//     29px; ten-day block about 98px on the desktop grid).
//   - Every block is clickable and routes to its homestand.
//   - The IN-PROGRESS block is the ONLY saturated one: solid navy,
//     taller than the others, ordinal label inside. Actuals-due
//     gets a pale amber wash; closed-out a pale green; upcoming a
//     near-neutral grey. This drains the strip so the block that
//     needs a chef's eye is the loudest thing on it.
//   - Aria label carries the status word - now the only place a
//     screen reader learns which block is current, with the
//     spotlight gone.
//
// Status source: M-3 payload homestands[] joined onto derived
// segments by segment.key (first game's gamePk, stable across
// schedule changes). Never by ordinal. Falls back to the derived
// done/now/next when the payload is absent (non-MLB accounts, or
// account not in MLB_HOMESTAND_SURFACE_ACCOUNTS).

import {
  deriveHomestandSegments,
  pickFocusSegment,
  formatHomestandRange,
} from "./homestandDerivation";
import "./seasonStepper.css";

// Map the M-3 payload status onto the strip's visual class. Current
// (the in-progress block) wins over everything at the render site.
function payloadStatusToClass(payloadStatus) {
  switch (payloadStatus) {
    case "closed-out":  return "done";
    case "actuals-due": return "actuals-due";
    case "in-progress": return "current";
    case "upcoming":    return "next";
    default:            return null;
  }
}

// Small map, built once per render. <= 13 entries.
function buildStatusByKey(homestands) {
  const m = new Map();
  if (!Array.isArray(homestands)) return m;
  for (const h of homestands) {
    if (h?.key != null) m.set(String(h.key), h.status);
  }
  return m;
}

// Which visual class a segment paints at. `isCurrent` = "this is
// THE in-progress block right now"; only that block gets the
// saturated navy focus treatment (owner rule: only the current is
// saturated). Everything else falls to its status class with a
// drained wash.
function classForSegment(seg, isCurrent, statusByKey) {
  if (isCurrent) return "current";
  const payloadStatus = statusByKey.get(String(seg.key));
  const fromPayload = payloadStatusToClass(payloadStatus);
  if (fromPayload) return fromPayload;
  // Fallback when the payload is absent (non-MLB accounts).
  if (seg.status === "now") return "current";
  if (seg.status === "done") return "done";
  return "next";
}

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Days between two ISO dates, inclusive. Anchored at noon so DST
// shifts do not bump the count on boundary days.
function spanDaysInclusive(startIso, endIso) {
  if (!startIso || !endIso) return 1;
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  const ms = e.getTime() - s.getTime();
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Month short-name at a given ISO date. "Mar" / "Sep".
function monthShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return MON_SHORT[d.getMonth()];
}

export default function SeasonStepper({
  yearData,                   // months[] from sc-year-summary
  todayDate,                  // "YYYY-MM-DD" | null
  accountKey,                 // M-0: MLB-only gate inside deriveHomestandSegments
  homestands,                 // M-4a: payload homestands[] for status join
  onSegmentClick,             // (segment) => void; routes to the homestand
}) {
  const segments = deriveHomestandSegments(yearData, todayDate, { accountKey });
  if (!segments.length) return null;

  const focus = pickFocusSegment(segments);
  const statusByKey = buildStatusByKey(homestands);

  // ONE block gets the saturated navy focus treatment: whichever is
  // currently in-progress (focus.kind === "now"). When no homestand
  // is in-progress (gap day, off-season, all closed), no block is
  // saturated - the strip reads honestly quiet, matching the
  // rail's pinned-card-absent state.
  const currentId = focus?.kind === "now" ? focus.segment.homestandId : null;

  return (
    <section className="sc-stepper" aria-label="Homestand season tracker">
      <SeasonBar
        segments={segments}
        currentId={currentId}
        statusByKey={statusByKey}
        onSegmentClick={onSegmentClick}
      />
      <MonthAnchors segments={segments} />
    </section>
  );
}

// Season bar. Width proportional to block length (span days);
// current block reads taller than the others and carries its
// ordinal inside. Everything else drains to a pale wash by state.
function SeasonBar({ segments, currentId, statusByKey, onSegmentClick }) {
  return (
    <ol
      className="sc-stepper-bar"
      role="list"
      aria-label="Season homestands overview"
    >
      {segments.map((seg) => {
        const isCurrent = currentId != null && seg.homestandId === currentId;
        const cls = classForSegment(seg, isCurrent, statusByKey);
        // Proportional flex: span days. Current block widens on top
        // of that base so the ordinal label has room to sit inside.
        const base = spanDaysInclusive(seg.startDate, seg.endDate);
        const flexUnits = isCurrent ? base * 1.7 : base;
        return (
          <li
            key={seg.homestandId}
            className={`sc-stepper-bar-segment sc-stepper-bar-segment--${cls}`}
            style={{ flex: flexUnits }}
          >
            <button
              type="button"
              className="sc-stepper-bar-segment-button"
              onClick={() => onSegmentClick?.(seg)}
              aria-label={ariaLabelForSegment(seg, statusByKey)}
              title={ariaLabelForSegment(seg, statusByKey)}
            >
              {isCurrent && (
                <span className="sc-stepper-bar-segment-label">{seg.homestandId}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// Two month anchors under the strip: season start month (left) and
// season end month (right). Two words instead of the six-line
// footer that read the same information less clearly.
function MonthAnchors({ segments }) {
  if (!segments?.length) return null;
  const first = monthShort(segments[0].startDate);
  const last = monthShort(segments[segments.length - 1].endDate);
  if (!first && !last) return null;
  return (
    <div className="sc-stepper-anchors" aria-hidden="true">
      <span className="sc-stepper-anchor sc-stepper-anchor--first">{first}</span>
      <span className="sc-stepper-anchor sc-stepper-anchor--last">{last}</span>
    </div>
  );
}

// Screen-reader label for one segment. Every button carries this
// name + title. Owner ruling 2026-07-30: with the spotlight gone,
// aria is the only place a screen reader learns which block is
// current. It matters more than it did.
// Format: "HS9 · Jul 3 to Jul 12 · vs ARI · closed out"
function ariaLabelForSegment(seg, statusByKey) {
  const range = formatHomestandRange(seg.startDate, seg.endDate);
  const opp = seg.opponents.length > 0
    ? `vs ${seg.opponents.join(" / ")}`
    : "vs opponent TBD";
  const payloadStatus = statusByKey?.get?.(String(seg.key));
  const statusWord = payloadStatus
    ? payloadStatus.replace(/-/g, " ")
    : (seg.status === "now" ? "in progress" : seg.status);
  return `${seg.homestandId} · ${range} · ${opp} · ${statusWord}`;
}
