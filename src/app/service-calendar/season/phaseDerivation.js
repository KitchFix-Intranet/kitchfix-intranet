// Phase derivation - the SHARED SPINE for Stage 2.
//
// Two consumers, ONE derivation:
//   - PhaseStrip renders the canonical phase blocks across the year.
//   - PeriodCard tints its header by the period's owning phase
//     (majority-phase rule, both named in subtitle when straddling).
//
// Pure functions. No React, no fetches, no engine calls. Stage 3
// reuses these in the workspace's phase-aware coaching.
//
// Companions:
//   phaseCalendar.js - the canonical vocab + alias map + recorded data
//   dayResolvers.js  - day-status + day-kind helpers (Stage 1)

import {
  CANONICAL_PHASES,
  PER_ACCOUNT_2026,
  resolveCanonicalPhase,
} from "./phaseCalendar.js";

// ─── derivePhaseTimeline ─────────────────────────────────────────
// The shared spine. Given an account key + year, returns the canonical
// phase blocks for the year, or a degraded shape when phase data is
// missing/unknown for the account.
//
// Returns:
//   {
//     status: "recorded" | "absent" | "non-pdc",
//     blocks: Array<{ phase, label, start, end, recordedLabel, tint, textTint }>,
//     reason: string,   // human-readable explanation of the status
//   }
//
// status meanings:
//   "recorded"  - clean recorded data; blocks populated. (CIN-AZ, TXR-AZ, TBR-FL)
//   "absent"    - PDC account without recorded data; degraded.    (TBJ-FL, STL-FL)
//   "non-pdc"   - MLB/MiLB/CORP; phases don't apply at year scope. (everyone else)
//
// The deriver applies the alias map to each recorded label so the
// strip + card-tints render the SAME canonical phase color for the
// same recorded label, no matter where the consumer reads it from.
export function derivePhaseTimeline(accountKey, category, year) {
  // Non-PDC accounts: phases don't apply at year scope. PhaseStrip
  // renders a calm "Season axis" (Design Batch 3 - the legacy
  // "Stage 3" placeholder copy is gone). The 4 MLB-fee accounts
  // render SeasonStepper instead of PhaseStrip for the season view;
  // this branch covers MiLB / AAA / non-homestand MLB.
  if (category !== "PDC") {
    return {
      status: "non-pdc",
      blocks: [],
      reason: null,
    };
  }

  const recorded = PER_ACCOUNT_2026[accountKey];

  // PDC without recorded data - graceful degradation per spec 11.5.
  if (!recorded) {
    return {
      status: "absent",
      blocks: [],
      reason: "Phase calendar pending confirmation",
    };
  }

  const blocks = recorded.map(r => {
    const canonical = resolveCanonicalPhase(r.recordedLabel);
    const meta = CANONICAL_PHASES[canonical] || CANONICAL_PHASES.unknown;
    return {
      phase: canonical,
      label: meta.label,
      start: r.start,
      end: r.end,
      recordedLabel: r.recordedLabel,
      tint: meta.tint,
      textTint: meta.textTint,
      short: meta.short,
    };
  });
  // The data is already sorted but defensive sort guards against
  // future drift in phaseCalendar.js.
  blocks.sort((a, b) => a.start.localeCompare(b.start));

  return { status: "recorded", blocks, reason: null };
}

// ─── findPhaseAtDate ─────────────────────────────────────────────
// Given a derived timeline + a date, return the canonical phase
// owning that date, or null if no block contains it. Used by the
// strip's today marker label.
export function findPhaseAtDate(timeline, dateStr) {
  if (!timeline?.blocks?.length || !dateStr) return null;
  return timeline.blocks.find(b => dateStr >= b.start && dateStr <= b.end) || null;
}

// ─── derivePeriodPhase ───────────────────────────────────────────
// Majority-phase tint rule (spec 7.4 / 11.x). Given a period range
// and a derived timeline, find the phase(s) overlapping the period
// and return the one owning the MAJORITY of the period's days.
//
// Returns:
//   {
//     primary: canonical phase key (null when no overlap),
//     secondary: canonical phase key when the period straddles (null
//                if single-phase or no overlap),
//     bothLabels: array of canonical labels in order (for the subtitle
//                 "Camp -> Spring Training" rendering when straddling),
//   }
export function derivePeriodPhase(periodRange, timeline) {
  if (!periodRange || !timeline?.blocks?.length) {
    return { primary: null, secondary: null, bothLabels: [] };
  }
  const start = periodRange.start;
  const end = periodRange.end;

  // For each overlapping phase, count its days inside the period.
  const overlap = new Map(); // phase -> { days, label, order }
  let order = 0;
  for (const b of timeline.blocks) {
    if (b.end < start || b.start > end) continue;
    const overlapStart = b.start > start ? b.start : start;
    const overlapEnd   = b.end   < end   ? b.end   : end;
    const days = daysBetween(overlapStart, overlapEnd) + 1;
    if (days <= 0) continue;
    const cur = overlap.get(b.phase);
    if (cur) {
      cur.days += days;
    } else {
      overlap.set(b.phase, { days, label: b.label, order: order++ });
    }
  }

  if (overlap.size === 0) {
    return { primary: null, secondary: null, bothLabels: [] };
  }

  // Sort by days desc; ties broken by order in timeline (earlier wins,
  // which feels right for a chronological view).
  const ranked = [...overlap.entries()]
    .map(([phase, info]) => ({ phase, ...info }))
    .sort((a, b) => (b.days - a.days) || (a.order - b.order));

  const primary = ranked[0].phase;
  const secondary = ranked.length > 1 ? ranked[1].phase : null;
  const bothLabels = ranked.map(r => r.label);

  return { primary, secondary, bothLabels };
}

// ─── dayToPeriod ─────────────────────────────────────────────────
// Per-day-period derivation (spec 11.6). sc-year-summary already
// ships periodRanges = [{ period, start, end }] for the account; this
// helper takes a date + that array and returns the period label the
// date belongs to (or null if outside any period - the day is off-
// season relative to the fiscal calendar).
//
// Reused by:
//   - PeriodCard buckets days[].date -> period for the 13 cards
//   - Stage 3 workspace finds today's period
export function dayToPeriod(dateStr, periodRanges) {
  if (!dateStr || !periodRanges?.length) return null;
  // Linear scan; periodRanges is 13 entries max. The sc-year-summary
  // already orders them by start; we still guard with the range check.
  for (const r of periodRanges) {
    if (dateStr >= r.start && dateStr <= r.end) return r.period;
  }
  return null;
}

// ─── bucketDaysByPeriod ──────────────────────────────────────────
// Walks the year's day records and groups them by period using
// dayToPeriod. Used by the 4x3 period grid to fill each card with
// its days. Days that fall outside all periods (rare; the seeded
// metadata covers the operational year) are dropped, not crashed.
//
// Returns: Map<periodLabel, day[]>
export function bucketDaysByPeriod(yearData, periodRanges) {
  const buckets = new Map();
  if (!periodRanges?.length) return buckets;
  for (const r of periodRanges) buckets.set(r.period, []);
  if (!yearData?.length) return buckets;
  for (const month of yearData) {
    if (!month?.days?.length) continue;
    for (const d of month.days) {
      const period = dayToPeriod(d.date, periodRanges);
      if (period == null) continue;
      const list = buckets.get(period);
      if (list) list.push(d);
    }
  }
  return buckets;
}

// ─── humanAnchor ─────────────────────────────────────────────────
// Returns a "mid Jun" / "early Apr" / etc. anchor for a date range
// so low-context users aren't lost on "P7" (spec 7.10). Picks the
// mid-point of the range to derive the month + which third of the
// month it falls in.
export function humanAnchor(startStr, endStr) {
  if (!startStr) return "";
  const start = new Date(startStr + "T12:00:00");
  const end = endStr ? new Date(endStr + "T12:00:00") : start;
  const midMs = Math.round((start.getTime() + end.getTime()) / 2);
  const mid = new Date(midMs);
  const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mid.getMonth()];
  const day = mid.getDate();
  const part = day <= 10 ? "early" : day <= 20 ? "mid" : "late";
  return `${part} ${monthShort}`;
}

// ─── helpers ─────────────────────────────────────────────────────
// Inclusive days between two YYYY-MM-DD strings. Tolerates UTC drift
// (GOTCHAS L105: Vercel runs UTC) by anchoring at noon local.
function daysBetween(startStr, endStr) {
  const s = new Date(startStr + "T12:00:00").getTime();
  const e = new Date(endStr   + "T12:00:00").getTime();
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}
