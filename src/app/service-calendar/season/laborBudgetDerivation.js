// Labor-budget derivation - the M-1 allocation math.
//
// PURE function. No React, no fetches. MLB-only via the same
// DERIVE_HOMESTANDS_ACCOUNTS gate that governs homestandDerivation:
// non-MLB accounts return an empty result. Same discipline as M-0.
//
// Formula (owner-anchored):
//   dailyRate(period P) = P.hourly_budget /
//                           (game-derived homestand days falling inside P)
//   homestandBudget(H)  = SUM over periods P that H touches of
//                           dailyRate(P) × (days of H falling inside P)
//
// Both terms use the M-0 game-derived block spans exclusively:
// - `startDate .. endDate` from each block, day-by-day (inclusive).
// - Not stored homestand_id, not calendar spans, not operator-declared
//   days. The budget is untouchable by anyone in the field by
//   construction.
//
// Rounding rule: round ONCE at the emitted envelope. The per-period
// breakdown reconciles to the envelope by construction - the last
// period's slice absorbs any rounding remainder rather than each
// slice rounding independently (which is how a breakdown stops
// summing to its own total).
//
// Missing-vs-zero: if a period P has no matching `sc_labor_budgets`
// row (or its `hourly_budget` is NULL), the derivation returns
// `{ envelope: null, reason: "..." }` for every homestand that
// touches P. A zero envelope reads as "you may spend nothing," which
// is a lie; null with a reason is the honest state.
//
// Revenue-flex: when the account carries a non-null `labor_ratio`
// (TXR-TX-V today), the derivation also emits `laborRatio` on each
// homestand + an `adjustedEnvelope` computed from a caller-supplied
// sold-revenue value (per-homestand). When sold revenue is absent,
// `adjustedEnvelope` is null.

import { DERIVE_HOMESTANDS_ACCOUNTS } from "./homestandDerivation";

// Public: the M-1 gate. Same set as M-0 - the two planes align by
// design; a promotion needs both.
export { DERIVE_HOMESTANDS_ACCOUNTS };

function daysBetween(startISO, endISO) {
  const a = new Date(startISO + "T00:00:00");
  const b = new Date(endISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

// Enumerate every date between (inclusive) startISO and endISO as
// YYYY-MM-DD strings. Bounded by both terms; degrades to empty when
// end < start.
function enumerateDates(startISO, endISO) {
  const dates = [];
  if (!startISO || !endISO || endISO < startISO) return dates;
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function periodOf(dateISO, periodRanges) {
  for (const r of periodRanges) {
    if (dateISO >= r.start && dateISO <= r.end) return r.period;
  }
  return null;
}

// Divisor: game-derived homestand days per period. For each derived
// block, walk every date in [startDate..endDate] and count into the
// period that contains the date. Days outside any period are dropped
// (defensive - a real MLB schedule sits inside the loaded ranges).
export function buildGameDerivedDaysPerPeriod(segments, periodRanges) {
  const perPeriod = {};
  if (!Array.isArray(segments) || !Array.isArray(periodRanges)) return perPeriod;
  for (const seg of segments) {
    for (const d of enumerateDates(seg.startDate, seg.endDate)) {
      const p = periodOf(d, periodRanges);
      if (p) perPeriod[p] = (perPeriod[p] || 0) + 1;
    }
  }
  return perPeriod;
}

// Multiplier: for a single block, days per period touched.
function daysOfBlockPerPeriod(block, periodRanges) {
  const perPeriod = {};
  for (const d of enumerateDates(block.startDate, block.endDate)) {
    const p = periodOf(d, periodRanges);
    if (p) perPeriod[p] = (perPeriod[p] || 0) + 1;
  }
  return perPeriod;
}

// Round-once. Compute exact envelope, round at emission. Distribute
// rounding across the breakdown so the parts sum to the whole -
// leftover cents attach to the LAST period touched (deterministic).
function distributeToBreakdown(perPeriodExact, roundedEnvelope) {
  const periods = Object.keys(perPeriodExact);
  if (periods.length === 0) return [];
  const roundedSlices = periods.map(p => Math.round(perPeriodExact[p]));
  const roundedSum = roundedSlices.reduce((s, x) => s + x, 0);
  const drift = roundedEnvelope - roundedSum;
  if (drift !== 0) roundedSlices[roundedSlices.length - 1] += drift;
  return periods.map((p, i) => ({ period: p, subtotal: roundedSlices[i] }));
}

/**
 * Derive labor-budget envelopes for the whole season.
 *
 * @param {Array} segments - M-0 game-derived blocks (deriveHomestandSegments output).
 * @param {Array} budgets - live sc_labor_budgets rows for the account:
 *                          [{ period, hourly_budget, salary_budget, revenue_forecast }]
 * @param {Array} periodRanges - [{ period, start, end }] from year-summary.
 * @param {object} opts - { accountKey, laborRatio, soldRevenueByBlockKey }
 *                        `laborRatio` is a per-account decimal (0.1923).
 *                        `soldRevenueByBlockKey` maps derived-block `key`
 *                        to a numeric sold-revenue value.
 * @returns {Array} homestand envelopes with breakdown + reason on missing rows.
 */
export function deriveLaborBudgets(segments, budgets, periodRanges, opts = {}) {
  const { accountKey, laborRatio = null, soldRevenueByBlockKey = {} } = opts;
  // MLB-only gate. Matches M-0 discipline; the two planes align.
  if (!accountKey || !DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) return [];
  if (!Array.isArray(segments) || !segments.length) return [];
  if (!Array.isArray(budgets)) return [];
  if (!Array.isArray(periodRanges)) return [];

  // Divisor: game-derived days per period, across the WHOLE season.
  const daysPerPeriod = buildGameDerivedDaysPerPeriod(segments, periodRanges);

  // Per-period budget map (period -> row) for O(1) lookup.
  const budgetByPeriod = {};
  for (const b of budgets) {
    if (b && b.period) budgetByPeriod[b.period] = b;
  }

  const results = [];
  for (const seg of segments) {
    const blockDaysPerPeriod = daysOfBlockPerPeriod(seg, periodRanges);
    const periodsTouched = Object.keys(blockDaysPerPeriod);

    // Missing-vs-zero. If ANY touched period has no live budget row
    // or a null hourly_budget, emit null envelope with a reason. Do
    // NOT emit zero - a zero envelope reads as "you may spend
    // nothing," which is a lie.
    const missing = periodsTouched.filter(p => {
      const b = budgetByPeriod[p];
      return !b || b.hourly_budget == null;
    });
    if (missing.length) {
      results.push({
        key: seg.key,
        homestandId: seg.homestandId,
        startDate: seg.startDate,
        endDate: seg.endDate,
        gameCount: seg.gameCount,
        opponents: seg.opponents,
        periodsTouched,
        envelope: null,
        breakdown: [],
        reason: `no live sc_labor_budgets row for ${missing.join(", ")} (accountKey=${accountKey})`,
        laborRatio: laborRatio || null,
        soldRevenue: null,
        adjustedEnvelope: null,
      });
      continue;
    }

    // Compute exact per-period subtotal without intermediate rounding.
    // subtotal = hourly_budget[p] / totalDaysInP × blockDaysInP.
    const perPeriodExact = {};
    let envelopeExact = 0;
    for (const p of periodsTouched) {
      const b = budgetByPeriod[p];
      const totalDaysInP = daysPerPeriod[p] || 0;
      if (totalDaysInP === 0) {
        // Shouldn't happen (the block itself contributed to
        // daysPerPeriod), but defensive.
        perPeriodExact[p] = 0;
        continue;
      }
      const rate = Number(b.hourly_budget) / totalDaysInP;
      const subtotal = rate * blockDaysPerPeriod[p];
      perPeriodExact[p] = subtotal;
      envelopeExact += subtotal;
    }
    const envelope = Math.round(envelopeExact);
    const breakdown = distributeToBreakdown(perPeriodExact, envelope);

    // Revenue-flex: if laborRatio is set + a sold-revenue value is
    // provided for THIS block, emit adjustedEnvelope. Sold revenue
    // is per-homestand (not per-period), so it applies uniformly.
    const soldRevenue = soldRevenueByBlockKey[seg.key];
    const adjustedEnvelope = (laborRatio != null && soldRevenue != null)
      ? Math.round(Number(soldRevenue) * Number(laborRatio))
      : null;

    results.push({
      key: seg.key,
      homestandId: seg.homestandId,
      startDate: seg.startDate,
      endDate: seg.endDate,
      gameCount: seg.gameCount,
      opponents: seg.opponents,
      periodsTouched,
      envelope,
      breakdown,
      reason: null,
      laborRatio: laborRatio || null,
      soldRevenue: soldRevenue != null ? Number(soldRevenue) : null,
      adjustedEnvelope,
    });
  }
  return results;
}
