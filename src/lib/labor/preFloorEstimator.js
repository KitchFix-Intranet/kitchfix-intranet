// src/lib/labor/preFloorEstimator.js
//
// PR #273 - pre-floor stand estimator. Owner ruling 2026-08-21.
//
// Stands whose game_end < daily-grain floor (2026-04-20) have no
// labor_actuals_daily rows behind them - the daily-grain pipeline
// wasn't built yet, and the raw pay segments those rows would derive
// from were retention-purged. Weekly totals in labor_actuals_latest
// still exist. So the estimator's job is: allocate the KNOWN weekly
// total to the DAYS in a pre-floor stand's window using the account's
// own schedule as the weighting signal.
//
// Method (game-day weighted, NOT flat pro-rate)
//
//   For each week that overlaps a pre-floor stand:
//     1. Look up the week's real total in labor_actuals_latest.
//     2. For each of the 7 days in that week, assign a weight based on
//        what the schedule says happened:
//          night game   -> account's night_base
//          day game     -> account's day_base
//          prep day     -> account's prep_base
//          other        -> 0
//     3. Distribute the week's real total across the 7 days
//        proportionally to those weights.
//     4. Sum only the day-slices whose date falls inside the pre-floor
//        stand's window.
//
// The base rates are derived from each account's own history on
// post-floor stands with peak_games_in_week <= 4 (low-OT so overtime
// doesn't distort the per-day-shape signal). Kevin's ruling: "derive
// these in code from each account's own history - the figures above
// are for verification, not hardcoding." The verification numbers in
// his spec may drift from the live derivation as data evolves.
//
// Non-negotiables baked in
//   - Estimates NEVER enter the bank. Pre-floor stands remain excluded
//     from computeHomestandBank the same way they always have; this
//     module attaches actual_estimated + is_estimated onto the stand
//     for display only. Bank is byte-identical with the estimator on
//     or off - H9 probe asserts.
//   - Zero stands may straddle the daily floor (game_start < floor
//     AND game_end >= floor). Method does not apply to straddles;
//     the fold refuses rather than half-estimate. Verified on all
//     four accounts in the recon.
//   - Trickle (~$214/stand for road-trip work while the team is
//     away) has no schedule day to land on, so it gets absorbed into
//     game days. Slightly inflates game-day slices vs off days.
//     The popover copy is meant to state this plainly.

const MS_PER_DAY = 86400000;

function parseIso(iso) { return new Date(`${iso}T00:00:00.000Z`); }
function toIso(d) { return d.toISOString().slice(0, 10); }
function addDaysIso(iso, n) {
  const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d);
}
function mondayOfIso(iso) {
  const d = parseIso(iso);
  const dow = d.getUTCDay();
  const back = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return toIso(d);
}

/**
 * Derive per-account game-day base rates from post-floor stands with
 * peak_games_in_week <= 4. Returns { night, day, prep, samples: { night, day, prep, other } }
 * where each rate is a mean daily amount in dollars.
 *
 * A missing sample class (e.g. no prep days in the low-OT set) returns
 * 0 for that class, which correctly makes it contribute zero weight.
 *
 * @param {SupabaseClient} supa
 * @param {string} accountKey
 * @param {Array} homestands       output of listHomestands (post-floor stands only used)
 * @param {string} todayIso        current date - excludes future stands
 */
export async function deriveAccountBaseRates(supa, accountKey, homestands, todayIso) {
  const lowOt = (homestands || [])
    .filter(h => !h.pre_floor && h.peak_games_in_week <= 4 && h.game_end < todayIso);
  if (!lowOt.length) {
    return { night: 0, day: 0, prep: 0, samples: { night: 0, day: 0, prep: 0, other: 0 }, source_stands: 0 };
  }
  const windowStart = lowOt.map(h => h.window_start).sort()[0];
  const windowEnd   = lowOt.map(h => h.window_end).sort().slice(-1)[0];
  // Base-rate derivation sums dollars_regular ONLY - explicitly NOT
  // amount. Amount includes overtime + double-time + premium; folding
  // those into a "day-game base rate" is the exact double-count the
  // low-OT stand restriction (peak <= 4) exists to prevent. Owner
  // ruling 2026-08-21 after PR #773 v1 shipped `amount` and inflated
  // CIN - OH day base from $806.89 to $871.82 - the +$65 that
  // compounded through HS 1's partial-week weighting.
  const dQ = await supa.from("labor_actuals_daily")
    .select("work_date, dollars_regular")
    .eq("account_key", accountKey)
    .gte("work_date", windowStart)
    .lte("work_date", windowEnd);
  if (dQ.error) throw new Error(`preFloorEstimator daily read (${accountKey}): ${dQ.error.message}`);
  const dailyByDate = new Map();
  for (const r of dQ.data || []) {
    dailyByDate.set(r.work_date, (dailyByDate.get(r.work_date) || 0) + Number(r.dollars_regular || 0));
  }
  const sQ = await supa.from("sc_homestand_schedule")
    .select("service_date, day_type, day_night")
    .eq("account_key", accountKey);
  if (sQ.error) throw new Error(`preFloorEstimator schedule read (${accountKey}): ${sQ.error.message}`);
  const gameByDate = new Map();
  for (const r of sQ.data || []) {
    if (r.day_type === "GAME") gameByDate.set(r.service_date, r.day_night);
  }
  // Prep days = day-before-open of every stand on this account.
  const prepDays = new Set();
  for (const h of homestands || []) prepDays.add(addDaysIso(h.game_start, -1));

  // Owner ruling 2026-08-21 (PR #773 v2): exclude zero-amount days
  // from the base-rate sample. A game day with $0 dollars_regular is
  // not "a game day at the base rate" - it is a game day where the
  // payroll data has not landed yet (Rippling can lag 24h, and this
  // was surfaced by CIN - OH 2026-08-20 = HS 11 game_end day one day
  // before today; sample of 12 day-games included that zero and
  // dragged the day base from the spec's $806.89 / 11 down to
  // $739.65 / 12). Owner spec matches when the zero-amount days are
  // filtered - "average dollars_regular on game days" implicitly
  // means game days with recorded labor.
  const bucket = { night: [], day: [], prep: [], other: [] };
  for (const h of lowOt) {
    for (let d = h.window_start; d <= h.window_end; d = addDaysIso(d, 1)) {
      const amt = dailyByDate.get(d) || 0;
      const dn = gameByDate.get(d);
      if (dn === "night") { if (amt > 0) bucket.night.push(amt); }
      else if (dn === "day") { if (amt > 0) bucket.day.push(amt); }
      else if (prepDays.has(d)) { if (amt > 0) bucket.prep.push(amt); }
      else bucket.other.push(amt);
    }
  }
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  return {
    night: avg(bucket.night),
    day:   avg(bucket.day),
    prep:  avg(bucket.prep),
    samples: { night: bucket.night.length, day: bucket.day.length, prep: bucket.prep.length, other: bucket.other.length },
    source_stands: lowOt.length,
  };
}

/**
 * Assert no stand straddles the daily floor. Straddling stands break
 * the method (part hourly-detailed, part estimator-would-fill) so we
 * refuse rather than half-estimate.
 *
 * @throws if any stand has game_start < dailyFloorIso AND game_end >= dailyFloorIso
 */
export function assertNoStraddlingStand(homestands, dailyFloorIso) {
  const straddles = (homestands || []).filter(
    h => h.game_start < dailyFloorIso && h.game_end >= dailyFloorIso,
  );
  if (straddles.length > 0) {
    const list = straddles.map(h => `${h.game_start}..${h.game_end}`).join(", ");
    throw new Error(
      `preFloorEstimator: ${straddles.length} stand(s) straddle the daily floor (${dailyFloorIso}): ${list}. The method assumes a stand is cleanly before or cleanly after the floor; a straddling stand cannot be estimated without double-counting.`,
    );
  }
}

/**
 * Estimate a single pre-floor stand's actual using the game-day
 * weighted method. Returns { total, per_day: [{date, amount, day_type}] }.
 *
 * @param {Object} stand              pre-floor stand from listHomestands
 * @param {Object} baseRates          { night, day, prep }
 * @param {Map<string, number>} weekTotalsByMonday  labor_actuals_latest weekly amounts keyed by Monday ISO
 * @param {Map<string, string>} gameByDate          "night" | "day" per game date
 * @param {Set<string>} prepDays                    day-before-open ISO dates
 */
export function estimatePreFloorStand(stand, baseRates, weekTotalsByMonday, gameByDate, prepDays) {
  if (!stand?.pre_floor) return { total: 0, per_day: [] };
  const weeks = new Set();
  for (let d = stand.window_start; d <= stand.window_end; d = addDaysIso(d, 1)) {
    weeks.add(mondayOfIso(d));
  }
  let totalX10000 = 0;
  const perDay = [];
  for (const wStart of weeks) {
    const wEnd = addDaysIso(wStart, 6);
    const weekTotal = weekTotalsByMonday.get(wStart) || 0;
    // Weight every day of the FULL week (7 days), not just days in
    // the stand's window - the week's real total covers the full
    // week, so weights must too. Then we take only the fraction that
    // falls inside the stand's window.
    let sumWeights = 0;
    const dayWeights = [];
    for (let d = wStart; d <= wEnd; d = addDaysIso(d, 1)) {
      const dn = gameByDate.get(d);
      let w = 0;
      let dayType = "other";
      if (dn === "night") { w = baseRates.night; dayType = "night"; }
      else if (dn === "day") { w = baseRates.day; dayType = "day"; }
      else if (prepDays.has(d)) { w = baseRates.prep; dayType = "prep"; }
      dayWeights.push({ date: d, w, dayType });
      sumWeights += w;
    }
    for (const dw of dayWeights) {
      const slice = sumWeights > 0 ? (dw.w / sumWeights) * weekTotal : 0;
      if (dw.date >= stand.window_start && dw.date <= stand.window_end) {
        totalX10000 += Math.round(slice * 10000);
        perDay.push({ date: dw.date, amount: Math.round(slice * 100) / 100, day_type: dw.dayType });
      }
    }
  }
  return {
    total: Math.round(totalX10000 / 100) / 100,
    per_day: perDay,
  };
}

/**
 * Fold estimates into pre-floor stands on the homestands array. Returns
 * a NEW array (does not mutate). Non-pre-floor stands are copied through
 * unchanged. Pre-floor stands gain:
 *   actual_estimated: number    total estimated hourly dollars
 *   is_estimated: true          client renders `est.` marker + hatched bar
 *   estimator_meta: {           method disclosure for popovers + probe
 *     source_stands: number,
 *     base_rates: {night, day, prep, samples: ...},
 *     per_day: [{date, amount, day_type}]
 *   }
 *
 * Assertions
 *   1. assertNoStraddlingStand throws before any estimate lands.
 *   2. Bank is untouched. Callers must not add these estimates into
 *      computeHomestandBank's actuals map. H9 asserts bank byte-
 *      identical with the estimator on and off.
 *
 * @param {SupabaseClient} supa
 * @param {string} accountKey
 * @param {Array} homestands
 * @param {string} dailyFloorIso
 * @param {string} todayIso
 */
export async function foldPreFloorEstimates(supa, accountKey, homestands, dailyFloorIso, todayIso) {
  assertNoStraddlingStand(homestands, dailyFloorIso);
  const preFloor = (homestands || []).filter(h => h.pre_floor);
  if (preFloor.length === 0) return homestands;

  const baseRates = await deriveAccountBaseRates(supa, accountKey, homestands, todayIso);
  if (baseRates.source_stands === 0) {
    // No low-OT stands played yet - estimator cannot run. Return the
    // stands unchanged; pre-floor stays "no detail" on the client.
    return homestands;
  }

  // Weekly totals for the pre-floor era (labor_actuals_latest, weekly
  // grain). Bounded by the earliest pre-floor stand's overlapped week
  // through the daily floor (exclusive of anything post-floor).
  const preFloorWeeks = new Set();
  for (const h of preFloor) {
    for (let d = h.window_start; d <= h.window_end; d = addDaysIso(d, 1)) {
      preFloorWeeks.add(mondayOfIso(d));
    }
  }
  const wkStarts = [...preFloorWeeks].sort();
  const minWk = wkStarts[0];
  const maxWk = wkStarts[wkStarts.length - 1];
  const wQ = await supa.from("labor_actuals_latest")
    .select("week_start, amount")
    .eq("account_key", accountKey)
    .gte("week_start", minWk)
    .lte("week_start", maxWk);
  if (wQ.error) throw new Error(`preFloorEstimator weekly read (${accountKey}): ${wQ.error.message}`);
  const weekTotals = new Map();
  for (const r of wQ.data || []) {
    weekTotals.set(r.week_start, (weekTotals.get(r.week_start) || 0) + Number(r.amount || 0));
  }

  // Schedule map + prep days (used again for weighting).
  const sQ = await supa.from("sc_homestand_schedule")
    .select("service_date, day_type, day_night")
    .eq("account_key", accountKey);
  if (sQ.error) throw new Error(`preFloorEstimator schedule read (${accountKey}): ${sQ.error.message}`);
  const gameByDate = new Map();
  for (const r of sQ.data || []) {
    if (r.day_type === "GAME") gameByDate.set(r.service_date, r.day_night);
  }
  const prepDays = new Set();
  for (const h of homestands || []) prepDays.add(addDaysIso(h.game_start, -1));

  return (homestands || []).map(h => {
    if (!h.pre_floor) return h;
    const est = estimatePreFloorStand(h, baseRates, weekTotals, gameByDate, prepDays);
    return {
      ...h,
      actual_estimated: est.total,
      is_estimated: true,
      estimator_meta: {
        source_stands: baseRates.source_stands,
        base_rates: baseRates,
        per_day: est.per_day,
      },
    };
  });
}
