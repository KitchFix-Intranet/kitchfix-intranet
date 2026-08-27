// src/lib/labor/staleness.js
//
// #854 (owner ruling 2026-08-27): the staleness banner on the labor
// board reads two table-wide max(derived_at) values from the response's
// derive_freshness object and returns a list of stale tables to name
// in the banner. Pure function so scripts/probes/_probe_labor_staleness.mjs
// can feed it fixtures and assert the flip.
//
// derive_freshness is PRE-EXISTING - it carries last_walk_at,
// last_walk_ids_seen, and last_derive_at from before this PR. #854
// EXTENDS the object with two new fields, one per table:
//   last_weekly_derive_at   MAX(labor_actuals.derived_at)
//   last_daily_derive_at    MAX(labor_actuals_daily.derived_at)
//
// Named separately (not overloaded onto the existing last_derive_at)
// because last_derive_at is IN-SCOPE MAX - used by the existing
// freshness pill - and the banner needs TABLE-WIDE MAX to detect a
// stalled pipeline even on an account whose in-scope rows are absent
// or already stale for legitimate reasons.
//
// Threshold: 30h. Clears a normal nightly cadence (~24h) without
// flagging a late-running job.

// Returns hours since ISO timestamp, or null if the input is falsy /
// unparseable. Duplicated from formatting.js so this module has no
// browser-shaped imports and can be node-imported by the probe.
export function hoursSinceISOStr(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

/**
 * @param {{ last_weekly_derive_at?: string|null, last_daily_derive_at?: string|null }} freshness
 * @param {{ staleHours?: number, now?: Date }} [opts]
 * @returns {null | Array<{ table: string, hoursOld: number, at: string }>}
 *   null if both derives are fresh (or unknown - absent field falls
 *   through as null, banner stays quiet, and the underlying wire
 *   shape mismatch is a separate defect to be caught by a probe on
 *   the response). Array of one or two entries when stale, one per
 *   table over the threshold, in stable table order.
 */
export function computeStaleness(freshness, opts = {}) {
  const STALE_H = opts.staleHours ?? 30;
  const nowMs = (opts.now instanceof Date ? opts.now.getTime() : Date.now());
  function hoursOld(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return (nowMs - t) / 3_600_000;
  }
  const w = hoursOld(freshness?.last_weekly_derive_at);
  const d = hoursOld(freshness?.last_daily_derive_at);
  const stale = [];
  if (w != null && w >= STALE_H) {
    stale.push({ table: "labor_actuals",       hoursOld: w, at: freshness.last_weekly_derive_at });
  }
  if (d != null && d >= STALE_H) {
    stale.push({ table: "labor_actuals_daily", hoursOld: d, at: freshness.last_daily_derive_at });
  }
  return stale.length > 0 ? stale : null;
}
