// src/lib/labor/paySegmentDedupe.js
//
// Presence filter + external_id dedupe over raw pay segments. ONE
// source of truth so the weekly derive (src/lib/labor/deriveActuals.js)
// and the daily derive (scripts/derive_labor_actuals_daily.mjs)
// cannot drift.
//
// Why this exists
// ───────────────
// 2026-08-19 hotfix contract. Rippling re-issues `rippling_id` for
// the same logical segment (owner_role.id, time_entry.id,
// segment_date all identical; only id + updated_at family + owner_role
// denormalised block differ). Between 2026-08-07 and 2026-08-18 the
// P8 population inflated to 8,848 rippling_id observations of 4,764
// distinct external_ids. Naive summing tripled hours across every
// account. The weekly derive caught it because a 48-hour regular-hours
// sanity assert fired. THE DAILY DERIVE HAS NO SUCH TELL - a tripled
// Tuesday reads as a busy Tuesday. Every caller of raw pay-segments
// runs through this helper, in this order:
//
//   1. presence filter    (drop orphan observations Rippling no
//                          longer considers live)
//   2. external_id dedupe (collapse re-issued rippling_ids that
//                          share one logical external_id; first-seen
//                          wins by system_updated_at DESC / latest
//                          observation)
//
// Segments with no external_id pass through unchanged (contract
// preserved; presence still gates their liveness).
//
// Raw stays authoritative - no schema change, no reclassification.
// Once Rippling stops re-issuing rippling_ids, each external_id has
// one rippling_id and the dedupe step is a no-op.

/**
 * Dedupe raw pay segments by presence + external_id.
 *
 * @param {Array<{rippling_id: string, payload: object}>} paySegsRaw
 *   the rows from rippling_raw_pay_segments (raw table, NOT
 *   _latest - we intentionally see every observation)
 * @param {Set<string>} presenceSet
 *   the rippling_ids currently in rippling_current_presence with
 *   kind='pay_segments'
 * @returns {{
 *   segments: Array,
 *   stats: {
 *     raw: number,               // input row count
 *     liveInPresence: number,    // rows surviving presence filter
 *     orphan: number,            // rows dropped by presence
 *     dedupDropped: number,      // rippling_id re-issues collapsed
 *     noExtId: number,           // rows with no external_id (passed through)
 *   }
 * }}
 */
export function dedupePaySegments(paySegsRaw, presenceSet) {
  const paySegsAfterPresence = paySegsRaw.filter(s => presenceSet.has(s.rippling_id));
  const bestByExt = new Map();
  for (const s of paySegsAfterPresence) {
    const ext = s.payload?.external_id;
    if (!ext) continue;
    const su = s.payload?.system_updated_at || s.payload?.updated_at || "";
    const prev = bestByExt.get(ext);
    if (!prev || su > prev.su) bestByExt.set(ext, { s, su });
  }
  const noExtId = paySegsAfterPresence.filter(s => !s.payload?.external_id);
  const segments = [...bestByExt.values()].map(x => x.s).concat(noExtId);
  return {
    segments,
    stats: {
      raw: paySegsRaw.length,
      liveInPresence: paySegsAfterPresence.length,
      orphan: paySegsRaw.length - paySegsAfterPresence.length,
      dedupDropped: paySegsAfterPresence.length - segments.length,
      noExtId: noExtId.length,
    },
  };
}
