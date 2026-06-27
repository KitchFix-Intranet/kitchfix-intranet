"use client";

// PhaseStrip - the phase / season strip for PHASE-shaped accounts
// (PDC including STL-FL, MiLB / AAA when no homestand data). The 4
// MLB-fee accounts get SeasonStepper instead; this strip never
// renders for them.
//
// Design Batch 3 rebuild (audit P1-2 + P2-4 + CC-13):
//   - Title now sits ABOVE the strip rail (it used to sit under,
//     so the eye hit the rail before the title).
//   - Today marker is a PERMANENT navy line + a clearly anchored
//     chip below the rail. It does NOT look dismissible and does
//     NOT overlap phase labels.
//   - Phase block labels never overlap month ticks. The block label
//     hugs the LEFT inside the block; month ticks render BELOW
//     (or are dropped entirely when blocks are present).
//   - Phase tints are toned down to a uniform low-saturation rail
//     so the today marker + active phase win the hierarchy.
//   - The "Homestand arc - detail lands in Stage 3" placeholder
//     copy is gone (audit P1-6 + CC-11). Non-PDC accounts render
//     a calm "Season axis" with month ticks + today only.

import { derivePhaseTimeline, findPhaseAtDate } from "./phaseDerivation";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function PhaseStrip({ accountKey, category, today, year }) {
  const timeline = derivePhaseTimeline(accountKey, category, year);
  const todayDate = today?.date || null;
  const todayFraction = todayDate ? dayOfYearFraction(todayDate, year) : null;
  const todayPhase = todayDate ? findPhaseAtDate(timeline, todayDate) : null;
  const todayLabel = todayDate ? formatDateLabel(new Date(todayDate + "T12:00:00")) : null;

  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd   = new Date(year + 1, 0, 1).getTime();
  const yearSpan  = yearEnd - yearStart;

  const blockPositions = (timeline.blocks || []).map((b) => {
    const blockStart = new Date(b.start + "T12:00:00").getTime();
    const blockEnd   = new Date(b.end   + "T12:00:00").getTime();
    const clampedStart = Math.max(blockStart, yearStart);
    const clampedEnd   = Math.min(blockEnd,   yearEnd);
    if (clampedEnd <= clampedStart) return null;
    const left  = ((clampedStart - yearStart) / yearSpan) * 100;
    const width = ((clampedEnd - clampedStart) / yearSpan) * 100;
    return { ...b, left, width };
  }).filter(Boolean);

  const title = phaseStripTitle(category, timeline.status);
  const subtitle = phaseStripSubtitle(timeline.status);

  // Mobile chip: at phone width the 12-segment strip clips badly
  // (audit Part E1). Collapse to a compact "current phase -> next"
  // chip. Find the next phase after today's by walking blocks in
  // order.
  const nextPhase = todayDate
    ? (timeline.blocks || []).find((b) => b.start > todayDate) || null
    : null;

  return (
    <section className="sc-season-strip" aria-label={title}>
      {/* Title row: name on the left, today chip on the right.
          Title sits ABOVE the rail (audit P1-2 - the eye reads the
          title before scanning the strip). */}
      <header className="sc-season-strip-header">
        <span className="sc-season-strip-title">{title}</span>
        {subtitle && (
          <span className="sc-season-strip-subtitle">{subtitle}</span>
        )}
        {todayLabel && (
          <span className="sc-season-strip-today-chip">
            <span className="sc-season-strip-today-chip-dot" aria-hidden="true" />
            Today
            <span className="sc-season-strip-today-chip-sep" aria-hidden="true">·</span>
            {todayLabel}
            {todayPhase && (
              <>
                <span className="sc-season-strip-today-chip-sep" aria-hidden="true">·</span>
                {todayPhase.label}
              </>
            )}
          </span>
        )}
      </header>

      {/* Mobile-only compact "current -> next" chip. The full 12-block
          rail clips at phone width; this chip carries the same signal
          at a readable scale (audit Part E1). */}
      {(todayPhase || nextPhase) && (
        <div className="sc-season-strip-mobile-chip">
          <span className="sc-season-strip-mobile-chip-tag">Now</span>
          <span className="sc-season-strip-mobile-chip-value">
            {todayPhase ? todayPhase.label : "Season"}
          </span>
          {nextPhase && (
            <>
              <span className="sc-season-strip-mobile-chip-sep" aria-hidden="true">-&gt;</span>
              <span className="sc-season-strip-mobile-chip-next">{nextPhase.label}</span>
            </>
          )}
        </div>
      )}

      {/* Rail: blocks (when present), today line. Month ticks only
          render BELOW the rail so they cannot overlap phase labels. */}
      <div className="sc-season-strip-rail">
        {timeline.status === "recorded" && (
          <div className="sc-season-strip-blocks" aria-hidden="true">
            {blockPositions.map((b, i) => (
              <div
                key={`${b.phase}-${i}`}
                className="sc-season-strip-block"
                style={{
                  left: `${b.left}%`,
                  width: `${b.width}%`,
                }}
                title={`${b.label} · ${b.start} to ${b.end}`}
              >
                {b.width >= 6 && (
                  <span className="sc-season-strip-block-label">
                    {b.width >= 9 ? b.label : b.short}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {todayFraction != null && (
          <div
            className="sc-season-strip-today-line"
            style={{ left: `${todayFraction * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Month ticks underneath the rail. Always visible on desktop;
          hidden on mobile (the chip above carries the signal). */}
      <div className="sc-season-strip-ticks" aria-hidden="true">
        {MONTH_SHORT.map((m) => (
          <span key={m} className="sc-season-strip-tick">{m}</span>
        ))}
      </div>
    </section>
  );
}

// Title that sits ABOVE the strip. Replaces the legacy "Homestand
// arc / Operational arc" labels that came with the "Stage 3"
// placeholder copy (audit P1-6 + CC-11).
function phaseStripTitle(category, status) {
  if (status === "recorded") return "Phase timeline";
  if (category === "PDC")    return "Phase timeline";
  return "Season axis";
}

// Subtitle is OPTIONAL - it only shows for PDC accounts that don't
// yet have a recorded phase calendar (the graceful-degradation case).
// The non-PDC categories get no subtitle (no more "Stage 3" copy).
function phaseStripSubtitle(status) {
  if (status === "absent") return "Phase calendar pending confirmation";
  return null;
}

function dayOfYearFraction(dateStr, year) {
  const start = new Date(year, 0, 1).getTime();
  const end   = new Date(year + 1, 0, 1).getTime();
  const here  = new Date(dateStr + "T12:00:00").getTime();
  if (here < start || here >= end) return null;
  return (here - start) / (end - start);
}

function formatDateLabel(d) {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}
