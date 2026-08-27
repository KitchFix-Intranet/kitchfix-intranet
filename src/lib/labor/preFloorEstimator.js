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
 * @param {string} [todayIso]                       today YYYY-MM-DD; enables the future-stand branch
 *
 * HS PR-A (owner ruling 2026-08-24): the estimator's guard was
 * pre_floor-only. Future post-floor stands (game_start > today) also
 * have no per-day actuals to plot the plan against, and the math -
 * distribute the account's low-OT weekly totals by day-type weights -
 * applies to any window whose games have not been played. The gate
 * relaxes to `pre_floor OR game_start > today`, so the estimator ships
 * on both classes. Two consumers, one function - a parallel copy is
 * exactly the drift risk the audit was there to prevent.
 *
 * HS FB1 PR-4 (owner ruling 2026-08-25): the gate relaxes further to
 * "run on any stand". Owner is adding an Actuals | Plan toggle to the
 * homestand view - Plan mode compares the retrospective plan against
 * the played stand's actual, so an operator can see whether the model
 * predicted the spend. The math is identical: distribute the account's
 * weekly totals by day-type weights over the stand's window. On a
 * played stand the "weekly totals" are just what actually landed that
 * week, so the estimator is measuring the plan against known truth.
 * Bank invariant is preserved architecturally by computeHomestandBank
 * (homestandResolver.js:529) - it consumes actuals via a Map interface,
 * never reads actual_estimated. See H9 in _probe_kpi_homestand.mjs.
 *
 * Callers:
 *   - src/lib/labor/homestandResolver.js attachEstimatorToPreFloor
 *   - src/lib/labor/homestandResolver.js attachEstimatorToFuture (PR-A)
 *   - Also folded onto played stands via foldPreFloorEstimates (PR-4)
 */
export function estimatePreFloorStand(stand, baseRates, weekTotalsByMonday, gameByDate, prepDays, todayIso) {
  if (!stand) return { total: 0, per_day: [] };
  // #850 defect 1 (owner ruling 2026-08-27): base rates fire on every
  // stand still being played, not just future stands.
  //
  // Prior state: `isFuture` = future-only, and the base-rate branch
  // was gated by `weekTotal === 0`. On an in-progress stand the week
  // total is non-zero (partial-week actual) so the historical branch
  // ran and redistributed that partial actual across weighted days.
  // Result: "what it should cost" numerically equals "what has been
  // spent so far" - a plan that agrees with the actual no matter
  // what happens. Vs the plan would report 100% accuracy forever.
  //
  // Correct model per owner ruling:
  //   games not started    -> base rates
  //   part played          -> base rates
  //   all games played     -> historical distribution (real retrospective plan)
  //   pre-floor            -> historical distribution (weeks ARE complete)
  //
  // Gate becomes: not pre-floor AND game_end has not passed today.
  // Boundary: on the last game day itself, treat as still-in-progress
  // (labor for that day is only fully realized after payroll).
  const isNotFullyPlayed = todayIso != null && !stand.pre_floor && stand.game_end >= todayIso;
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
    // #850 defect 1: base rates fire on every not-fully-played stand,
    // not just when weekTotal is zero. Partial-week weekTotal on an
    // in-progress stand is contamination, not signal - redistributing
    // it makes the plan equal the actual by construction. See
    // isNotFullyPlayed comment above. Fully-played stands + pre-floor
    // stands stay on the historical-distribution branch below.
    if (isNotFullyPlayed) {
      for (const dw of dayWeights) {
        if (dw.date < stand.window_start || dw.date > stand.window_end) continue;
        totalX10000 += Math.round(dw.w * 10000);
        perDay.push({ date: dw.date, amount: Math.round(dw.w * 100) / 100, day_type: dw.dayType });
      }
      continue;
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
  // HS PR-A (owner ruling 2026-08-24): fold estimates onto BOTH
  // pre-floor stands AND post-floor future stands (game_start >
  // today). Both classes render plan-mode PlanCards on the client,
  // and both need the same estimator payload. Client gate is one
  // derived boolean (`planMode`) so the two paths cannot drift.
  //
  // HS FB1 PR-4 (owner ruling 2026-08-25): fold onto PLAYED stands
  // too so an Actuals | Plan toggle can compare the retrospective
  // plan against the played actual. The is_estimated flag stays TRUE
  // only on pre-floor / future stands - the rail's hatch semantics
  // are "no actual to show, using the estimate instead", which does
  // not apply to a played stand. Played stands carry actual_estimated
  // + estimator_meta with is_estimated: false so all existing client
  // reads (SeasonRailCard scale calc, rail bar display, season table
  // row) gate correctly and keep showing the real actual. Bank
  // invariant is architectural: computeHomestandBank never reads
  // actual_estimated (H9 in _probe_kpi_homestand.mjs asserts).
  const targets = homestands || [];
  if (targets.length === 0) return homestands;

  const baseRates = await deriveAccountBaseRates(supa, accountKey, homestands, todayIso);
  if (baseRates.source_stands === 0) {
    // No low-OT stands played yet - estimator cannot run. Return the
    // stands unchanged; pre-floor + future stay "no detail" on client
    // and played stands stay without a plan comparison.
    return homestands;
  }

  // Weekly totals for every week any stand touches. Pre-floor and
  // played weeks have real labor_actuals_latest rows; future weeks
  // return nothing and estimatePreFloorStand falls back to base rates
  // (see its isFuture branch). The single query covers all three.
  const weeksTouched = new Set();
  for (const h of targets) {
    for (let d = h.window_start; d <= h.window_end; d = addDaysIso(d, 1)) {
      weeksTouched.add(mondayOfIso(d));
    }
  }
  const wkStarts = [...weeksTouched].sort();
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
    const est = estimatePreFloorStand(h, baseRates, weekTotals, gameByDate, prepDays, todayIso);
    // is_estimated stays TRUE only on pre-floor / future (the "no
    // actual to show, use estimate instead" case). Played stands
    // carry the estimate as a Plan comparison, is_estimated: false.
    const isPreFloorOrFuture = h.pre_floor || (h.game_start > todayIso);
    return {
      ...h,
      actual_estimated: est.total,
      is_estimated: isPreFloorOrFuture,
      estimator_meta: {
        source_stands: baseRates.source_stands,
        base_rates: baseRates,
        per_day: est.per_day,
      },
    };
  });
}
