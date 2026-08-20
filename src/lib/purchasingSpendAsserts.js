// src/lib/purchasingSpendAsserts.js
//
// PRE-WRITE sanity asserts for the Rippling spend derive
// (scripts/purchasing_rippling_sync.mjs), added by INV-P8b Part E and
// extended by Ruling 4 (2026-08-20).
//
// These are DETERMINISTIC FROM PAYLOAD. They fail the write; they never
// silently correct. Pattern mirrors labor's pay-segment inflation guard:
// catch the bug SHAPE at derive time so it never lands in the fact table.
//
// INV-P8b findings driving the original two:
//   Part C - the payload carries NO version / revision / is_current
//     flag, so a "canonical set" cannot be inferred without owner
//     ruling. But the coexisting-multi-set SHAPE (parent has lines
//     whose distinct amount buckets each sum to the same total) IS
//     deterministic. When that shape appears, the sum-over-lines
//     multiplies the true amount N-fold. INV-P8 documented this on
//     parent 6a6c093207bd8eb94ef93ca4: coexisting [$311.40],
//     [$155.70, $155.70], [$103.80, $103.80, $103.80] - 3 sets, each
//     summing to $311.40, stored total wrongly $934.20.
//   Part D - the payload carries no reliable USD-converted field
//     (raw.normalized_amount is populated on 1/149 non-USD rows in the
//     current corpus - unreliable). Any non-USD amount summing into a
//     USD roll-up is a defect regardless of the FX rule.
//
// Ruling 4 (2026-08-20) adds a third: no non-excluded parent may have a
// later same-merchant same-amount partner within 5 days that is ALSO
// non-excluded. Enforces the auth->settlement pair collapse the derive
// applies with report-arbitration precedence.
//
// The guards do NOT assert against the report or against employment
// status per Kevin's spec. Ruling 4's report-arbitration lookup happens
// in the derive; the assert only checks the post-arbitration slice.
//
// Contract:
//   derivedRows        : array of objects with `source_line_id` (string
//                        "rippling_spend:<rippling_id>") and `amount`
//   rawRowsByRippling  : Map<rippling_id, { external_id, currency, ... }>
//
// Return shape on success: { parentsChecked, flagged } / { checked, offenders }.
// On flag: throws Error with human-readable diagnostic.

const HEX24 = /^[a-f0-9]{24}$/;

function parentOf(ext) {
  if (!ext || typeof ext !== "string") return null;
  const idx = ext.indexOf("__");
  if (idx <= 0) return null;
  const tok = ext.slice(0, idx).toLowerCase();
  return HEX24.test(tok) ? tok : null;
}

function ridFromSourceLineId(slid) {
  return slid && slid.startsWith("rippling_spend:")
    ? slid.slice("rippling_spend:".length)
    : null;
}

/**
 * Detect the "coexisting multi-set" shape: a parent has >= 2 distinct
 * amount values whose (amount * count) match on the SAME sum. That IS
 * the superseded-split fingerprint documented on parent
 * 6a6c093207bd8eb94ef93ca4 (INV-P8) - three coexisting split versions,
 * lines sum wrongly to N * true_amount.
 *
 * Throws on any flagged parent. Owner ruling on canonical-set selection
 * is outstanding.
 */
export function assertNoSupersededSplitParents(derivedRows, rawRowsByRippling) {
  const byParent = new Map();
  for (const d of derivedRows) {
    const rid = ridFromSourceLineId(d.source_line_id);
    if (!rid) continue;
    const raw = rawRowsByRippling.get(rid);
    const parent = parentOf(raw?.external_id);
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(Math.round(Number(d.amount || 0) * 100));
  }
  const flagged = [];
  for (const [k, arr] of byParent.entries()) {
    if (arr.length < 2) continue;
    const amtCount = new Map();
    for (const c of arr) amtCount.set(c, (amtCount.get(c) || 0) + 1);
    if (amtCount.size < 2) continue;
    const sumsByValue = new Map();
    for (const [amtC, n] of amtCount.entries()) {
      const s = amtC * n;
      sumsByValue.set(s, (sumsByValue.get(s) || 0) + 1);
    }
    for (const [, bucketCount] of sumsByValue.entries()) {
      if (bucketCount >= 2) { flagged.push(k); break; }
    }
  }
  if (flagged.length > 0) {
    throw new Error(
      `[assert] superseded-split shape detected on ${flagged.length} parent(s); `
      + `these parents have coexisting amount sets whose sums match, meaning the sum `
      + `of stored line amounts multiplies the true parent total. First 5 parent `
      + `Mongo IDs: ${flagged.slice(0, 5).join(", ")}. `
      + `Write blocked pending owner ruling on canonical-set selection.`
    );
  }
  return { parentsChecked: byParent.size, flagged: flagged.length };
}

/**
 * Ruling 4 assert (2026-08-20). No non-excluded parent may have a later
 * same-merchant same-amount partner within 5 days that is ALSO non-
 * excluded. Enforces the pair collapse the derive is supposed to have
 * applied. Report-arbitration precedence is expressed by the derive; this
 * assert only checks the post-arbitration slice for leaks.
 *
 * Contract:
 *   nonExcludedDerived : array of {source_line_id, amount, txn_date,
 *                        vendor_or_merchant}
 * Groups by (merchant, amount-cents). Within each group, sorts by
 * txn_date + source_line_id (stable tiebreak). Fires if any adjacent pair
 * is within 5 days.
 *
 * Do NOT widen the 5-day window. Do NOT match on amount alone.
 */
export function assertNoAuthPairSurvivors(nonExcludedDerived, { windowDays = 5 } = {}) {
  // Group by (merchant, cents). Key uses JSON.stringify so any merchant
  // name is unambiguous; per-row _merchant / _cents avoid needing to
  // split the key back apart.
  const byKey = new Map();
  for (const r of nonExcludedDerived) {
    if (r.amount == null) continue;
    const cents = Math.round(Number(r.amount) * 100);
    if (cents === 0) continue;  // zero-amount handled by Ruling 5, not Ruling 4
    const merchant = (r.vendor_or_merchant || "").trim();
    if (!merchant) continue;    // Rule requires merchant AND amount; no merchant -> no group
    if (!r.txn_date) continue;
    const key = JSON.stringify([merchant, cents]);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ ...r, _merchant: merchant, _cents: cents });
  }
  const flagged = [];
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => {
      if (a.txn_date < b.txn_date) return -1;
      if (a.txn_date > b.txn_date) return 1;
      const aid = String(a.source_line_id || "");
      const bid = String(b.source_line_id || "");
      return aid < bid ? -1 : aid > bid ? 1 : 0;
    });
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      const da = new Date(a.txn_date + "T00:00:00Z").getTime();
      const db = new Date(b.txn_date + "T00:00:00Z").getTime();
      const days = Math.round((db - da) / 86400000);
      if (days >= 0 && days <= windowDays) {
        flagged.push({
          merchant: a._merchant,
          cents:    a._cents,
          days,
          earlier:  a.source_line_id,
          later:    b.source_line_id,
        });
      }
    }
  }
  if (flagged.length > 0) {
    const sample = flagged.slice(0, 5)
      .map(f => `${f.merchant}@$${(f.cents / 100).toFixed(2)} days=${f.days} earlier=${f.earlier} later=${f.later}`)
      .join(" | ");
    throw new Error(
      `[assert] auth-pair survivors: ${flagged.length} non-excluded pair(s) found `
      + `within ${windowDays} days sharing merchant + amount. Ruling 4 requires the earlier `
      + `to be excluded (or both kept when both are in the report). First 5: ${sample}. `
      + `Write blocked - the derive did not apply Ruling 4 precedence correctly.`
    );
  }
  return { groupsChecked: byKey.size, flagged: 0 };
}

/**
 * Any derived row whose raw currency is non-USD would sum into a USD
 * roll-up (purchasing_actuals.amount is bare, no currency column).
 * Throws on any offender. Owner ruling on FX-rate source is outstanding.
 */
export function assertNoNonUsdAmountsSummed(derivedRows, rawRowsByRippling) {
  const offenders = [];
  for (const d of derivedRows) {
    const rid = ridFromSourceLineId(d.source_line_id);
    if (!rid) continue;
    const raw = rawRowsByRippling.get(rid);
    const ccy = String(raw?.currency || "").toUpperCase();
    if (ccy && ccy !== "USD" && Number(d.amount || 0) !== 0) {
      offenders.push({ rippling_id: rid, currency: ccy });
    }
  }
  if (offenders.length > 0) {
    const sample = offenders.slice(0, 3)
      .map(o => `${o.rippling_id}=${o.currency}`).join(", ");
    throw new Error(
      `[assert] ${offenders.length} non-USD row(s) would sum into the USD fact `
      + `table (purchasing_actuals.amount is bare, no currency column). `
      + `Sample: ${sample}. Write blocked pending owner ruling on FX rate source.`
    );
  }
  return { checked: derivedRows.length, offenders: 0 };
}
