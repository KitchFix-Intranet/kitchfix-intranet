"use client";

// PhaseStrip - the real operational strip (Stage 2 replaces Stage 1's
// placeholder).
//
// PDC accounts WITH recorded data (CIN-AZ, TXR-AZ, TBR-FL):
//   - Colored phase blocks across the year, canonical palette.
//   - Today marker positioned at today's fractional offset.
//   - Phase labels overlaid where the block is wide enough.
//
// PDC accounts WITHOUT recorded data (TBJ-FL, STL-FL):
//   - Year axis + month ticks + today marker (Stage 1 shape).
//   - "Phase calendar pending confirmation" message - never fake data.
//
// MLB / MiLB / CORP:
//   - Year axis + today marker.
//   - Operational-kind label per category.
//   - Homestand arc detail lands in Stage 3.
//
// The shared spine (derivePhaseTimeline) is the same one PeriodCard
// reads, so the strip's colors match the period-card header tints.

import { derivePhaseTimeline, findPhaseAtDate } from "./phaseDerivation";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function PhaseStrip({ accountKey, category, today, year }) {
  const timeline = derivePhaseTimeline(accountKey, category, year);
  const todayDate = today?.date || null;
  const todayFraction = todayDate ? dayOfYearFraction(todayDate, year) : null;
  const todayPhase = todayDate ? findPhaseAtDate(timeline, todayDate) : null;

  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd   = new Date(year + 1, 0, 1).getTime();
  const yearSpan  = yearEnd - yearStart;

  const blockPositions = (timeline.blocks || []).map(b => {
    const blockStart = new Date(b.start + "T12:00:00").getTime();
    const blockEnd   = new Date(b.end   + "T12:00:00").getTime();
    const clampedStart = Math.max(blockStart, yearStart);
    const clampedEnd   = Math.min(blockEnd,   yearEnd);
    if (clampedEnd <= clampedStart) return null;
    const left  = ((clampedStart - yearStart) / yearSpan) * 100;
    const width = ((clampedEnd - clampedStart) / yearSpan) * 100;
    return { ...b, left, width };
  }).filter(Boolean);

  return (
    <section className="sc-season-strip" aria-label="Operational strip">
      <div className="sc-season-strip-frame">
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
                    background: b.tint,
                    color: b.textTint,
                  }}
                  title={`${b.label} · ${b.start} to ${b.end}${b.recordedLabel !== b.label ? ` (recorded as ${b.recordedLabel})` : ""}`}
                >
                  <span className="sc-season-strip-block-label">
                    {b.width >= 9 ? b.label : b.width >= 4 ? b.short : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className={`sc-season-strip-ticks ${timeline.status === "recorded" ? "sc-season-strip-ticks--underlay" : ""}`}>
            {MONTH_SHORT.map((m) => (
              <span key={m} className="sc-season-strip-tick">
                <span className="sc-season-strip-tick-label">{m}</span>
              </span>
            ))}
          </div>

          {todayFraction != null && (
            <div
              className="sc-season-strip-today"
              style={{ left: `${todayFraction * 100}%` }}
              aria-label={`Today: ${formatDateLabel(new Date(todayDate + "T12:00:00"))}`}
            >
              <span className="sc-season-strip-today-dot" aria-hidden="true" />
              <span className="sc-season-strip-today-label">
                Today{todayPhase ? ` · ${todayPhase.label}` : ""}
              </span>
            </div>
          )}
        </div>

        <div className="sc-season-strip-tag">
          <span className="sc-season-strip-tag-kind">
            {operationalKindLabel(category, timeline.status)}
          </span>
          {timeline.reason && (
            <span className="sc-season-strip-tag-pending">{timeline.reason}</span>
          )}
        </div>
      </div>
    </section>
  );
}

function operationalKindLabel(category, status) {
  if (status === "recorded") return "Phase timeline";
  if (category === "PDC")    return "Phase timeline";
  if (category === "MLB")    return "Homestand arc";
  if (category === "MiLB")   return "Homestand arc";
  return "Operational arc";
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
