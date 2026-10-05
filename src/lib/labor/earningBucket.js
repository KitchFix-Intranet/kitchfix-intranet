// src/lib/labor/earningBucket.js
//
// SHARED earning-type -> bucket classifier for pay segments. Both the
// weekly derive (src/lib/labor/deriveActuals.js) and the daily derive
// (scripts/derive_labor_actuals_daily.mjs) call this exact function.
//
// Rationale (Kevin ruling 2026-10-05, post Rippling 2026-10-02 relabel).
// Rippling re-issued pay segments under new rippling_ids between
// 2026-10-02 and 2026-10-04, and on some of them changed
// `merged_earning_type_name` without changing hours, rate, segment_date
// or timezone. Five of those relabels moved genuine holiday double-time
// into the "Regular" bucket while leaving the pay rate at exactly 2.0x
// the worker's base hourly wage. KitchFix policy pays double for a
// holiday, so a segment at double base rate IS holiday double-time
// regardless of what Rippling now calls it.
//
// The decision must live in ONE place. paySegmentDedupe.js already
// exists because this exact drift class happened once: two derives
// each carrying their own copy of a shared decision eventually diverge,
// and the drift is silent. The pre-fix mapEntry.bucket if/else at
// deriveActuals.js:471-488 and derive_labor_actuals_daily.mjs:274-290
// were byte-identical before the holiday upgrade; they are now moved
// here together.
//
// Rule D37 (deriveActuals.js:28-30) documents that
// `overtime_multiplier` is NULL on `Holiday Double Rate` and cannot be
// used as a holiday detector. This classifier does not read that
// field.

// Pay-rate threshold for the holiday upgrade. Picked at 1.9 (not 2.0):
//   - Float safety: estimated_hourly_rate and hourly_wage.value cross
//     JSON on both sides, so an equality test would miss a legitimate
//     holiday with a trailing-digit drift.
//   - Headroom for mid-period raises: a bump between the comp record
//     and the segment's effective date could nudge the ratio slightly
//     away from 2.0.
//   - No corpus overlap: measured 2026-10-05 the only segments at or
//     above 1.9 are the five flagged holiday relabels, all sitting at
//     exactly 2.0000. Nothing else in `Base Pay` or either overtime
//     spelling is anywhere near 1.9.
export const HOLIDAY_DOUBLE_RATE_RATIO = 1.9;

// Return shape:
//   bucket:       'regular' | 'overtime' | 'double_time' | 'premium_other'
//   reclassified: true  when the earning-type map said 'regular' but the
//                       segment was promoted to 'double_time' because
//                       estimated_hourly_rate / baseHourlyWage >= 1.9
//   ratio:        the measured ratio when evaluable, else null. Logged
//                 for every reclassification.
//   unevaluable:  true  when the mapped bucket was 'regular' AND the
//                       rule could NOT run because either the segment's
//                       estimated_hourly_rate or the worker's base
//                       hourly wage was missing / non-numeric / <= 0.
//                 The classifier returns the earning-type-map verdict
//                 unchanged in this case, and the caller counts the
//                 segment toward its unevaluable guard. The rule is
//                 BLIND on these - a quiet skip is the same defect
//                 class as an alert that never fires.
//
// classifyBucket does NOT key on `overtime_multiplier` or on the
// specific et_name. The decision is: trust the earning-type map AS
// THE DEFAULT, then upgrade regular -> double_time when the pay rate
// says so.
export function classifyBucket({ segmentPayload, mapEntry, baseHourlyWage }) {
  const mapped = mapEntry?.bucket;
  // Mirror the pre-fix ladder's fallthroughs: a null mapEntry OR an
  // unknown bucket name goes to premium_other. This matches both
  // derives' pre-fix behavior at :471-488 (weekly) and :274-290 (daily).
  const defaultBucket =
    mapped === "regular" || mapped === "overtime" ||
    mapped === "double_time" || mapped === "premium_other"
      ? mapped
      : "premium_other";

  if (defaultBucket !== "regular") {
    return { bucket: defaultBucket, reclassified: false, ratio: null, unevaluable: false };
  }

  const estRate = Number(segmentPayload?.estimated_hourly_rate);
  const base = Number(baseHourlyWage);
  if (!Number.isFinite(estRate) || estRate <= 0 ||
      !Number.isFinite(base)   || base   <= 0) {
    return { bucket: "regular", reclassified: false, ratio: null, unevaluable: true };
  }
  const ratio = estRate / base;
  if (ratio >= HOLIDAY_DOUBLE_RATE_RATIO) {
    return { bucket: "double_time", reclassified: true, ratio, unevaluable: false };
  }
  return { bucket: "regular", reclassified: false, ratio, unevaluable: false };
}

// Build Map<worker_id, baseHourlyWage>. Reads
// rippling_raw_compensations_latest, which is already one-row-per-worker
// (confirmed 2026-10-05: 1,139 DEFAULT + 177 VARIED = 1,316 distinct
// workers, 1,138 of DEFAULT carry a non-null hourly_wage.value).
//
// payload.hourly_wage is a NESTED object { value, currency_type }, not
// a scalar. Reading `payload->>'hourly_wage'` returns the JSON text
// (`{"value": 21, ...}`) and the subsequent ::numeric cast throws.
// Reach for `payload->'hourly_wage'->>'value'` instead - the single-
// arrow accessor is what preserves the nested path.
//
// Workers whose payment_type is 'VARIED' carry a null hourly_wage by
// design. Those entries are not included in the output map. Their
// segments reach classifyBucket with baseHourlyWage=null and are
// counted as `unevaluable` there.
export async function loadBaseHourlyWages(supa) {
  const PAGE = 1000;
  let from = 0;
  const out = new Map();
  while (true) {
    const q = await supa
      .from("rippling_raw_compensations_latest")
      .select("worker_id, payload")
      .range(from, from + PAGE - 1);
    if (q.error) {
      throw new Error(`loadBaseHourlyWages: ${q.error.message}`);
    }
    const rows = q.data || [];
    for (const r of rows) {
      const wid = r.worker_id || r.payload?.worker_id;
      if (!wid) continue;
      const raw = r.payload?.hourly_wage?.value;
      if (raw == null) continue;
      const wage = Number(raw);
      if (!Number.isFinite(wage) || wage <= 0) continue;
      out.set(wid, wage);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
