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
import { CANONICAL_PHASES } from "./phaseCalendar";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function PhaseStrip({ accountKey, category, today, year, isLoading = false }) {
  const timeline = derivePhaseTimeline(accountKey, category, year);
  const todayDate = today?.date || null;
  const todayFraction = todayDate ? dayOfYearFraction(todayDate, year) : null;
  const todayPhase = todayDate ? findPhaseAtDate(timeline, todayDate) : null;

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

  const railGradient = timeline.status === "recorded" ? buildRailGradient(blockPositions) : null;

  const title = phaseStripTitle(category, timeline.status);
  const subtitle = phaseStripSubtitle(timeline.status);

  // Bare = no phase blocks (MiLB + not-yet-confirmed PDC). Drives the
  // mobile rail/ticks override + a subtle season gradient on the rail.
  const isBare = (timeline.blocks || []).length === 0;
  const railBackground =
    railGradient ||
    (isBare
      ? "linear-gradient(90deg, var(--surface-page) 0%, var(--surface-page) 20%, var(--accent-sc-tint) 40%, var(--accent-sc-tint) 60%, var(--surface-page) 80%, var(--surface-page) 100%)"
      : undefined);

  // Mobile chip: at phone width the 12-segment strip clips badly
  // (audit Part E1). Collapse to a compact "current phase -> next"
  // chip. Find the next phase after today's by walking blocks in
  // order.
  const nextPhase = todayDate
    ? (timeline.blocks || []).find((b) => b.start > todayDate) || null
    : null;

  return (
    <section
      className={`sc-season-strip${isBare ? " sc-season-strip--bare" : ""}${isLoading ? " sc-season-strip--loading" : ""}`}
      aria-label={isLoading ? "Loading season" : title}
    >
      {/* Title row: name on the left, today chip on the right.
          Title sits ABOVE the rail (audit P1-2 - the eye reads the
          title before scanning the strip). */}
      {/* Bundle 2: the header today chip was redundant - the InfoCard /
          ChromeBar stats above already show today's date and the navy
          today line on the rail already marks the position. Removed
          (along with the dead chip CSS) so the title sits clean. */}
      {/* SC-016: header is suppressed while loading so the initial
          "SEASON" label does not flip to "PHASE TIMELINE" once the
          account resolves. The rail alone reads as the skeleton. */}
      {!isLoading && (
        <header className="sc-season-strip-header">
          <span className="sc-season-strip-title">{title}</span>
          {subtitle && (
            <span className="sc-season-strip-subtitle">{subtitle}</span>
          )}
        </header>
      )}

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

      {/* OV-3 Wave 3a - MONTH TICKS ABOVE the rail (spec v4 flip:
          months row above the band, phase titles below). */}
      <div className="sc-season-strip-ticks sc-season-strip-ticks--above" aria-hidden="true">
        {MONTH_SHORT.map((m) => (
          <span key={m} className="sc-season-strip-tick">{m}</span>
        ))}
      </div>

      {/* Rail: continuous gradient across the year. OV-3 Wave 3a
          drops the in-band block LABELS - phase titles now render as
          a separate row BELOW the rail (see .sc-season-strip-phase-
          labels below). The block <div>s remain for their POSITIONS +
          data-current signal so downstream selectors can still key
          on the current phase; label text moved out. */}
      <div
        className="sc-season-strip-rail"
        style={railBackground ? { background: railBackground } : undefined}
      >
        {timeline.status === "recorded" && (() => {
          const currentPhaseKey = blockPositions.find(
            (b) => todayDate && todayDate >= b.start && todayDate <= b.end
          )?.phase ?? null;
          return (
            <div className="sc-season-strip-blocks" aria-hidden="true">
              {blockPositions.map((b, i) => {
                const isCurrent = !!(currentPhaseKey && b.phase === currentPhaseKey);
                return (
                  <div
                    key={`${b.phase}-${i}`}
                    className="sc-season-strip-block"
                    data-current={isCurrent ? "true" : undefined}
                    style={{
                      left: `${b.left}%`,
                      width: `${b.width}%`,
                    }}
                    title={`${b.label} · ${b.start} to ${b.end}`}
                  />
                );
              })}
            </div>
          );
        })()}

        {todayFraction != null && (
          <div
            className="sc-season-strip-today-line"
            style={{ left: `${todayFraction * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* OV-3 Wave 3a - PHASE TITLES BELOW the rail. Current phase
          = navy + 800 weight, NO dot. Positioned as an absolute-in-
          row layout mirroring the block positions. */}
      {timeline.status === "recorded" && (() => {
        const currentPhaseKey = blockPositions.find(
          (b) => todayDate && todayDate >= b.start && todayDate <= b.end
        )?.phase ?? null;
        return (
          <div className="sc-season-strip-phase-labels" aria-hidden="true">
            {blockPositions.map((b, i) => {
              if (b.width < 6) return null;
              const isCurrent = !!(currentPhaseKey && b.phase === currentPhaseKey);
              return (
                <span
                  key={`${b.phase}-label-${i}`}
                  className="sc-season-strip-phase-label"
                  data-current={isCurrent ? "true" : undefined}
                  style={{
                    left: `${b.left}%`,
                    width: `${b.width}%`,
                  }}
                >
                  {b.width >= 9 ? b.label : b.short}
                </span>
              );
            })}
          </div>
        );
      })()}
    </section>
  );
}

// Title that sits ABOVE the strip. Replaces the legacy "Homestand
// arc / Operational arc" labels that came with the "Stage 3"
// placeholder copy (audit P1-6 + CC-11).
function phaseStripTitle(category, status) {
  if (status === "recorded") return "Phase timeline";
  if (category === "PDC")    return "Phase timeline";
  return "Season";
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

// Bundle 2 change 2: build a left-to-right linear-gradient that paints
// the entire 0-100% year span with the canonical phase tints. Adjacent
// phases blend through a small FADE zone instead of meeting at a hard
// line, so the rail reads as the seasonal arc. Year-start and year-end
// spans not covered by a phase fill with CANONICAL_PHASES.off.tint so
// the rail is never bare (this is what closes the Jan-Mar void on PDC
// accounts).
//
// The tint hex values intentionally come from the data-model phase
// palette (CANONICAL_PHASES), not from CSS tokens - PeriodCard already
// consumes block.tint inline the same way. This is a phase-identity
// palette, not a token regression.
function buildRailGradient(blocks) {
  if (!blocks?.length) return null;
  const offTint = CANONICAL_PHASES.off.tint;
  const FADE = 1.2;
  const clamp = (n) => Math.max(0, Math.min(100, n));
  const sorted = [...blocks].sort((a, b) => a.left - b.left);
  const stops = [];
  const first = sorted[0];
  if (first.left > 0.5) {
    stops.push(`${offTint} 0%`);
    stops.push(`${offTint} ${clamp(first.left - FADE).toFixed(2)}%`);
  }
  sorted.forEach((b, i) => {
    const start = b.left;
    const end = b.left + b.width;
    const startFade = (i === 0 && first.left <= 0.5) ? 0 : FADE;
    stops.push(`${b.tint} ${clamp(start + startFade).toFixed(2)}%`);
    stops.push(`${b.tint} ${clamp(end - FADE).toFixed(2)}%`);
  });
  const last = sorted[sorted.length - 1];
  const lastEnd = last.left + last.width;
  if (lastEnd < 99.5) {
    stops.push(`${offTint} ${clamp(lastEnd + FADE).toFixed(2)}%`);
    stops.push(`${offTint} 100%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
