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
// Segments: one per homestand. Status class carries the visual state:
//   - focus       amber, widened + labeled; the caption/spotlight anchor
//   - actuals-due amber fill, tall; needs the chef's attention (M-4a)
//   - in-progress amber fill, tall; the block that spans today (M-4a)
//   - done        navy; a closed-out block (or a past block before M-3)
//   - next        grey; upcoming
//
// Status source (M-4a): the payload's homestands[] carries the true
// billing status (upcoming | in-progress | actuals-due | closed-out)
// per the M-3 emit. It is joined onto derived segments by
// `segment.key` - the first game's gamePk, stable across schedule
// changes and the same key sc_homestand_closeout stores. NEVER by
// ordinal (HS3 shifts when a game reschedules; the M-0 phase removed
// that coupling deliberately). When the payload is absent (non-MLB
// account, or account not in MLB_HOMESTAND_SURFACE_ACCOUNTS), the
// strip falls back to the derived done/now/next vocabulary
// byte-identically to pre-M-4a.
//
// DESKTOP (>=1024px): caption + bar + hint + footer.
// MOBILE  (<1024px): spotlight card + bar + hint + footer.
//
// Engine fence: derives from yearData via homestandDerivation.

import {
  deriveHomestandSegments,
  pickFocusSegment,
  formatHomestandRange,
} from "./homestandDerivation";
import "./seasonStepper.css";

// Map the M-3 payload status onto the strip's visual class. Focus
// wins over payload status at render time (see SeasonBar), so this
// only decides what a non-focus segment paints as.
function payloadStatusToClass(payloadStatus) {
  switch (payloadStatus) {
    case "closed-out":  return "done";
    case "actuals-due": return "actuals-due";
    case "in-progress": return "in-progress";
    case "upcoming":    return "next";
    default:            return null;
  }
}

// Build the join map once per render. Small (<= 13 entries).
function buildStatusByKey(homestands) {
  const m = new Map();
  if (!Array.isArray(homestands)) return m;
  for (const h of homestands) {
    if (h?.key != null) m.set(String(h.key), h.status);
  }
  return m;
}

// Which visual class a segment paints at. Focus overrides.
function classForSegment(seg, isFocus, statusByKey) {
  if (isFocus) return "focus";
  const payloadStatus = statusByKey.get(String(seg.key));
  const fromPayload = payloadStatusToClass(payloadStatus);
  if (fromPayload) return fromPayload;
  // Fallback to derived done/now/next when the payload is absent.
  if (seg.status === "now") return "in-progress";
  if (seg.status === "done") return "done";
  return "next";
}

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Days between two ISO dates, inclusive. Anchored to noon so DST
// shifts don't bump the count on the boundary days.
function spanDaysInclusive(startIso, endIso) {
  if (!startIso || !endIso) return 1;
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  const ms = e.getTime() - s.getTime();
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Compact date label for the tracker footer. "Apr 12" style.
function shortDate(iso) {
  if (!iso || typeof iso !== "string") return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return `${MON_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export default function SeasonStepper({
  yearData,                   // months[] from sc-year-summary
  todayDate,                  // "YYYY-MM-DD" | null
  accountKey,                 // M-0: MLB-only gate inside deriveHomestandSegments
  homestands,                 // M-4a: payload homestands[] for status join
  onSegmentClick,             // (homestandId) => void; drills into the period
}) {
  const segments = deriveHomestandSegments(yearData, todayDate, { accountKey });
  if (!segments.length) return null;
  const focus = pickFocusSegment(segments);
  const statusByKey = buildStatusByKey(homestands);

  return (
    <section className="sc-stepper" aria-label="Homestand season tracker">
      <div className="sc-stepper-desktop">
        <Caption focus={focus} totalCount={segments.length} />
        <SeasonBar
          segments={segments}
          focus={focus}
          statusByKey={statusByKey}
          onSegmentClick={onSegmentClick}
        />
        <StripHint />
        <TrackerFooter segments={segments} statusByKey={statusByKey} />
      </div>

      <div className="sc-stepper-mobile">
        {focus && (
          <Spotlight
            focus={focus}
            totalCount={segments.length}
            onClick={() => onSegmentClick?.(focus.segment)}
          />
        )}
        <SeasonBar
          segments={segments}
          focus={focus}
          statusByKey={statusByKey}
          onSegmentClick={onSegmentClick}
        />
        <StripHint />
        <TrackerFooter segments={segments} statusByKey={statusByKey} />
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

// Season bar. Width proportional to block length; focus block widens
// 1.7x on top of that. Height encoded per state so due + in-progress
// blocks read differently even in grayscale (second signal beyond
// color per rubric Part 3).
function SeasonBar({ segments, focus, statusByKey, onSegmentClick }) {
  const focusId = focus?.segment?.homestandId;
  // Day-count sum for aria completeness. Empty-focus falls to
  // gameCount + 1 nominal so no segment collapses to flex:0.
  return (
    <ol
      className="sc-stepper-bar"
      role="list"
      aria-label="Season homestands overview"
    >
      {segments.map((seg) => {
        const isFocus = seg.homestandId === focusId;
        const cls = classForSegment(seg, isFocus, statusByKey);
        // Proportional flex: span days, not gameCount. Owner phrased
        // "three-day and eleven-day" - length is calendar days between
        // startDate and endDate inclusive. HS10 has 10 games across
        // 11 span-days (a home off-day in the block). Focus gets a
        // 1.7x multiplier on top of that base.
        const base = spanDaysInclusive(seg.startDate, seg.endDate);
        const flexUnits = isFocus ? base * 1.7 : base;
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

// Affordance hint. Owner render item 4: without it, proportional
// width reads as arbitrary. Two facts, one line.
function StripHint() {
  return (
    <p className="sc-stepper-hint" aria-hidden="true">
      width shows length · click to open
    </p>
  );
}

// Three-part tracker footer. Replaces the "homestand N of M" counter
// with three anchor facts a chef reads at a glance:
//   - the season's first homestand + start date
//   - how many blocks currently need actuals
//   - the season's last homestand + end date
//
// "Need actuals" counts segments that carry status === "actuals-due"
// on the payload. Non-MLB accounts have no such segments; the counter
// reads 0 and the middle cell renders "on track".
function TrackerFooter({ segments, statusByKey }) {
  if (!segments.length) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const needCount = segments.filter(
    (s) => statusByKey.get(String(s.key)) === "actuals-due"
  ).length;
  const middleLabel = needCount === 0
    ? "on track"
    : `${needCount} need${needCount === 1 ? "s" : ""} actuals`;
  return (
    <div className="sc-stepper-footer" aria-label="Season summary">
      <div className="sc-stepper-footer-cell sc-stepper-footer-cell--first">
        <span className="sc-stepper-footer-label">First</span>
        <span className="sc-stepper-footer-value">{first.homestandId}</span>
        <span className="sc-stepper-footer-detail">{shortDate(first.startDate)}</span>
      </div>
      <div className="sc-stepper-footer-cell sc-stepper-footer-cell--middle">
        <span className="sc-stepper-footer-label">Actuals</span>
        <span className="sc-stepper-footer-value">{middleLabel}</span>
      </div>
      <div className="sc-stepper-footer-cell sc-stepper-footer-cell--last">
        <span className="sc-stepper-footer-label">Last</span>
        <span className="sc-stepper-footer-value">{last.homestandId}</span>
        <span className="sc-stepper-footer-detail">{shortDate(last.endDate)}</span>
      </div>
    </div>
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

// Screen-reader label for one segment. Every button carries this
// name + title. M-4a: append the payload's billing status word so
// the strip reads as: "HS9 · Jul 3 to Jul 12 · vs ARI · closed out."
// Falls back to the derived status word when the payload has no
// entry (non-MLB accounts stay on done/now/next vocabulary).
function ariaLabelForSegment(seg, statusByKey) {
  const range = formatHomestandRange(seg.startDate, seg.endDate);
  const opp = seg.opponents.length > 0
    ? `vs ${seg.opponents.join(" / ")}`
    : "vs opponent TBD";
  const payloadStatus = statusByKey?.get?.(String(seg.key));
  const statusWord = payloadStatus
    ? payloadStatus.replace(/-/g, " ")           // "actuals due" not "actuals-due"
    : (seg.status === "now" ? "in progress" : seg.status);
  return `${seg.homestandId} · ${range} · ${opp} · ${statusWord}`;
}
