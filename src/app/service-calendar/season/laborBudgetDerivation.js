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

import { DERIVE_HOMESTANDS_ACCOUNTS } from "./homestandDerivation.js";

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

// (Prior `distributeToBreakdown` helper retired 2026-07-29: the
// per-homestand `Math.round(envelopeExact)` pass accumulated half-cent
// drift across the season - CIN-OH ran $3 over, STL-MO $1 over at
// gate. Replaced with per-period cents-conservation (Hamilton method)
// inside deriveLaborBudgets below.)

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

  // Budget in CENTS for the whole allocation. Integer arithmetic
  // throughout: sum of block envelopes MUST equal sum of period
  // budgets to the cent. Under floats, per-homestand Math.round on
  // an exact-.5-cent split rounded up on both sides and accumulated
  // drift ($3 over on CIN-OH, $1 over on STL-MO). Cents make the
  // rounding deterministic AND the season conserves by construction.
  const budgetCentsByPeriod = {};
  for (const b of budgets) {
    if (b && b.period && b.hourly_budget != null) {
      budgetCentsByPeriod[b.period] = Math.round(Number(b.hourly_budget) * 100);
    }
  }

  // Pre-compute per-block days per period once (used by both the
  // missing-row check and the per-period allocation).
  const blockDaysPerPeriodArr = segments.map(seg => daysOfBlockPerPeriod(seg, periodRanges));

  // Missing-vs-zero. If ANY touched period has no live budget row
  // (or a null hourly_budget), emit null envelope with a reason. Do
  // NOT emit zero - a zero envelope reads as "you may spend nothing,"
  // which is a lie.
  const missingByBlock = segments.map((_, i) => {
    const periods = Object.keys(blockDaysPerPeriodArr[i]);
    return periods.filter(p => budgetCentsByPeriod[p] == null);
  });

  // Hamilton method (largest-remainder), per-period. For each period
  // P: allocate its budget_cents across every block touching P such
  // that the integer shares sum EXACTLY to budget_cents. Ties broken
  // by original block index for determinism (same input -> same
  // output on every run).
  //
  // subtotalCentsByBlockByPeriod[blockIndex][period] = integer cents.
  const subtotalCentsByBlockByPeriod = segments.map(() => ({}));
  for (const P of Object.keys(budgetCentsByPeriod)) {
    const totalDaysInP = daysPerPeriod[P] || 0;
    if (totalDaysInP === 0) continue;
    const budgetC = budgetCentsByPeriod[P];
    // Blocks that touch P AND are not missing (missing blocks are
    // emitted with envelope=null and do not receive cents).
    const touching = [];
    for (let i = 0; i < segments.length; i++) {
      if (missingByBlock[i].length > 0) continue;
      const days = blockDaysPerPeriodArr[i][P];
      if (days) touching.push({ i, days });
    }
    if (touching.length === 0) continue;
    // Compute exact share per touching block; take floor + fract.
    const shares = touching.map(({ i, days }) => {
      const exact = (budgetC * days) / totalDaysInP;
      const floor = Math.floor(exact);
      return { i, floor, fract: exact - floor };
    });
    const floorSum = shares.reduce((s, x) => s + x.floor, 0);
    let remainder = budgetC - floorSum;
    // Distribute the (integer) remainder one cent at a time to the
    // block with the largest fract; ties broken by original block
    // index (asc). Guaranteed remainder < touching.length under
    // exact math.
    if (remainder > 0) {
      const sorted = [...shares].sort((a, b) => {
        if (b.fract !== a.fract) return b.fract - a.fract;
        return a.i - b.i;
      });
      for (let k = 0; k < remainder; k++) sorted[k].floor += 1;
    }
    for (const s of shares) {
      subtotalCentsByBlockByPeriod[s.i][P] = s.floor;
    }
  }

  // Assemble results. envelope emitted as dollars-with-cents (Number
  // rounded to 2dp) so downstream currency display is trivial;
  // envelopeCents also emitted for callers that want to keep integer
  // precision (e.g. an acceptance probe comparing to sum of budget
  // cents).
  return segments.map((seg, i) => {
    const periodsTouched = Object.keys(blockDaysPerPeriodArr[i]);
    if (missingByBlock[i].length) {
      return {
        key: seg.key,
        homestandId: seg.homestandId,
        startDate: seg.startDate,
        endDate: seg.endDate,
        gameCount: seg.gameCount,
        opponents: seg.opponents,
        periodsTouched,
        envelope: null,
        envelopeCents: null,
        breakdown: [],
        reason: `no live sc_labor_budgets row for ${missingByBlock[i].join(", ")} (accountKey=${accountKey})`,
        laborRatio: laborRatio || null,
        soldRevenue: null,
        adjustedEnvelope: null,
      };
    }
    const perPeriodCents = subtotalCentsByBlockByPeriod[i];
    const envelopeCents = periodsTouched.reduce((s, p) => s + (perPeriodCents[p] || 0), 0);
    const envelope = envelopeCents / 100;
    const breakdown = periodsTouched.map(p => ({
      period: p,
      subtotal: (perPeriodCents[p] || 0) / 100,
      subtotalCents: perPeriodCents[p] || 0,
    }));
    // Revenue-flex adjustment - also cents-based for exactness.
    const soldRevenue = soldRevenueByBlockKey[seg.key];
    const adjustedEnvelope = (laborRatio != null && soldRevenue != null)
      ? Math.round(Number(soldRevenue) * Number(laborRatio) * 100) / 100
      : null;
    return {
      key: seg.key,
      homestandId: seg.homestandId,
      startDate: seg.startDate,
      endDate: seg.endDate,
      gameCount: seg.gameCount,
      opponents: seg.opponents,
      periodsTouched,
      envelope,
      envelopeCents,
      breakdown,
      reason: null,
      laborRatio: laborRatio || null,
      soldRevenue: soldRevenue != null ? Number(soldRevenue) : null,
      adjustedEnvelope,
    };
  });
}
