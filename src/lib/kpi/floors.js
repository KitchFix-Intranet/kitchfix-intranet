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
