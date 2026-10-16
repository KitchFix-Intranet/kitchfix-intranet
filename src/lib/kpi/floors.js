// src/lib/kpi/floors.js
//
// Shared date floors for the KPI Labor pipeline. Lifted here so the
// derivation (src/lib/labor/deriveActuals.js) and the pre-floor
// backfill loader (scripts/backfill_labor_from_rippling_report.mjs)
// can agree on the boundary without duplicating a literal.
//
// DOLLAR_COVERAGE_FLOOR - the first week Rippling's pay-segments API
// began emitting dollars (D35, pay-run rollout 2026-04-20). Weeks
// with week_start < FLOOR are owned by the report backfill; weeks
// with week_start >= FLOOR are owned by the api-derived pipeline.
// The two must not overlap.

export const DOLLAR_COVERAGE_FLOOR = "2026-04-20";

// TIME_ENTRY_SOURCE_FLOOR - the first week owned by the time-entries
// derive. Rippling's pay-segment custom objects began returning 404 on
// 2026-10-07; the last clean pay-segments derive covered through
// 2026-10-05. Weeks with week_start >= FLOOR are owned by the
// time-entries pipeline; earlier weeks stay exactly as the pay-segments
// derive left them and are never rewritten. The three eras must not
// overlap. Floor is 2026-10-05 (not 2026-10-06) because that week is
// currently partially populated by the pay-segments derive and must be
// rebuilt whole, not appended to.
export const TIME_ENTRY_SOURCE_FLOOR = "2026-10-05";
