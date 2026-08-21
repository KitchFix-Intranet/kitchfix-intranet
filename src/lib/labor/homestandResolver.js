// src/lib/labor/homestandResolver.js
//
// PR-1 of the homestand build. Derives ordered stands from the
// sc_homestand_schedule table for the four MLB clubhouse accounts
// in HOMESTAND_ACCOUNTS_FY2026; returns [] for every other account
// so the client's homestand tab is ABSENT, not disabled. See the
// constant's own comment for why the list is hardcoded rather than
// derived from data (audit follow-up ruling 2026-08-21).
//
// One code path serves the four accounts. All four carry a stored
// homestand_id. We derive stands from the raw GAME rows anyway and
// expose the stored id as metadata only so a probe can verify the
// derivation matches what the schedule loader wrote. Keying the URL
// or budget on a stored id would reintroduce the exact split owner
// ruling 2026-08-21 exists to eliminate.
//
// Stand counts are NOT uniform across accounts. Measured for FY2026:
// CIN - OH 13, STL - MO 13, TXR - TX - H 12, TXR - TX - V 12. Anything
// hardcoding 13 is wrong on two of the four active accounts. The
// derivation runs on the actual GAME rows in the account's schedule;
// no place downstream assumes a fixed count.
//
// Owner-approved attribution (forward-looking):
//   window(H) = [ previous stand's last game day + 1 ... H's last game day ]
//   Season-start edge: window_start = max(day-after-prev-season-last,
//                                          daily-grain floor,
//                                          H.game_start)
//   Pre-floor stands (game_start < daily floor): budget AND actual
//   land as null, not zero. Counting a budget with no attributable
//   actual is what inflated the design-pass bank from $6,009 to
//   $10,783; we omit them explicitly here and in the bank rollup.
//
// Grouping rule (verified on CIN - OH: 13 stored -> 13 derived; the
// same shape holds on STL - MO 13/13, TXR - TX - H 12/12, TXR - TX - V
// 12/12):
//   sort GAME rows by service_date, break when
//     next.service_date - prev.service_date > 2
//   which allows one off-day inside a stand (mid-series rest day).
//   day_type = 'GAME' only. AWAY is schedule context, not a game.
//
// Budget attribution (the trap owner named):
//   PERIOD LENGTH IS ALWAYS 28 DAYS, from the fiscal calendar. Never
//   from what happens to be in labor_actuals. Per-day cents are the
//   period amount divided by 28 with an LRM residual distribution
//   over the first `residual` days of the period so
//     sum(per-day budget across the fiscal year) ==
//     sum(kpi_budgets for account, line_code) to the cent.
//   H4 asserts this invariant.

const MS_PER_DAY = 86400000;
const PERIOD_LENGTH_DAYS = 28;

// The accounts that get a homestand tab this season. Owner ruling
// 2026-08-21 (final), hardcoded and NOT derived from data. The name
// carries FY2026 deliberately - this is a scope decision for this
// season, revisited when 2027 schedules land.
//
// Why this is a constant list, not a `has schedule AND has hourly
// labor` derivation:
//   - CIN - KY and TBJ - NY have zero hourly labor - salaried staff
//     only, verified against the P8 P&L. Both have a game schedule.
//     A pure data gate would still exclude them today (labor count
//     is zero), but the guardrail against a future season where they
//     hire one hourly worker is a hardcoded list, not a threshold.
//   - STL - FL and TBJ - FL are development complexes: 58% of their
//     hourly labor falls on non-game days against 12% at CIN - OH,
//     and they work 117 days against 57 game days. The homestand
//     model assumes labor clusters around games; it does not hold
//     there. A pure data gate would INCLUDE them (66 GAME rows +
//     hundreds of labor rows + full 3100.1 budgets), rendering a
//     view that misleads.
//
// Do not "fix" this into a derived rule. The next reader who thinks
// this looks like a smell should read the audit trail on PR-2 first.
export const HOMESTAND_ACCOUNTS_FY2026 = new Set([
  "CIN - OH", "STL - MO", "TXR - TX - H", "TXR - TX - V",
]);

// Fiscal-year boundaries. Duplicated from deriveActuals.js (which
// doesn't export them); trap-avoidance is that these are always 364
// days = 13 * 28, never derived from data.
const FY_BOUNDARIES = new Map([
  [2025, { start: "2024-12-30", end: "2025-12-28" }],
  [2026, { start: "2025-12-29", end: "2026-12-27" }],
  [2027, { start: "2026-12-28", end: "2027-12-26" }],
]);

const LINE_CODE = "3100.1";

// ─── date helpers (UTC-anchored so DST cannot shift a boundary) ─────
export function isoToDate(iso) { return new Date(`${iso}T00:00:00.000Z`); }
export function dateToIso(d)   { return d.toISOString().slice(0, 10); }
export function addDaysIso(iso, n) {
  return dateToIso(new Date(isoToDate(iso).getTime() + n * MS_PER_DAY));
}
function daysBetween(a, b) {
  return Math.round((isoToDate(b).getTime() - isoToDate(a).getTime()) / MS_PER_DAY);
}

// Returns 1..13 for a date in FY, or null.
function periodOfDate(iso, fyStartIso) {
  const d = daysBetween(fyStartIso, iso);
  if (d < 0 || d >= 13 * PERIOD_LENGTH_DAYS) return null;
  return Math.floor(d / PERIOD_LENGTH_DAYS) + 1;
}

// The Monday-anchored week that contains an ISO date, returned as an
// ISO date for the Monday. Used for peak_games_in_week.
function mondayIsoFor(iso) {
  const d = isoToDate(iso);
  const dow = d.getUTCDay();               // 0=Sun ... 1=Mon
  const daysBackToMon = (dow + 6) % 7;
  return dateToIso(new Date(d.getTime() - daysBackToMon * MS_PER_DAY));
}

async function fetchAllRange(supa, table, cols, filters) {
  let out = [], from = 0;
  while (true) {
    let q = supa.from(table).select(cols).range(from, from + 999);
    for (const [k, v] of filters) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`homestandResolver ${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

// ─── budget arithmetic (mille-cent accumulator) ─────────────────────
// Fractional per-day cents: period_cents / 28. Accumulate in
// mille-cents (integer x 1000) so 3 dp of precision survives the sum;
// round to cents at the field boundary. Matches the owner-verified
// scheme (HS 11 P8 3d + P9 11d = $8056.06 exact); LRM residual-to-
// first-N-days gave $8056.09 (3c high) on the same window.
//
// H4 invariant: sum of per-day mille-cents over the entire FY equals
// sum(period_cents_x1000). Trivially true because each period
// contributes 28 * (period_cents * 1000 / 28) = period_cents * 1000.

export function perDayMilleCents(periodCents) {
  return Math.round(periodCents * 1000 / PERIOD_LENGTH_DAYS);
}

// Sum per-day mille-cents across [start, end] inclusive. Returns
// integer mille-cents (cents x 1000). Divide by 1000 + round to cents
// at the caller.
function sumWindowMilleCents(budgetByPeriod, startIso, endIso, fyStartIso) {
  let mille = 0;
  for (let d = startIso; d <= endIso; d = addDaysIso(d, 1)) {
    const p = periodOfDate(d, fyStartIso);
    if (p == null) continue;
    mille += perDayMilleCents(budgetByPeriod.get(p) || 0);
  }
  return mille;
}

// ─── grouping ───────────────────────────────────────────────────────
// Group GAME rows into stands. Break when gap > 2 (one-day inside-stand
// rest is preserved). Verified: on CIN - OH this reproduces the stored
// 13 stands EXACTLY. Naive consecutive-day grouping gives 20 because
// mid-series off days split stands in two.
export function groupGamesIntoStands(gameRowsSorted) {
  if (!gameRowsSorted?.length) return [];
  const groups = [];
  let cur = [gameRowsSorted[0]];
  for (let i = 1; i < gameRowsSorted.length; i++) {
    const prev = cur[cur.length - 1];
    const g = gameRowsSorted[i];
    const gap = daysBetween(prev.service_date, g.service_date);
    if (gap > 2) { groups.push(cur); cur = [g]; }
    else cur.push(g);
  }
  groups.push(cur);
  return groups;
}

// Peak GAME days in any Mon-Sun week the stand overlaps. This is the
// overtime driver - the 40-hour clock resets Monday.
function peakGamesInWeek(stand) {
  const byWeek = new Map();
  for (const g of stand) {
    const wkMon = mondayIsoFor(g.service_date);
    byWeek.set(wkMon, (byWeek.get(wkMon) || 0) + 1);
  }
  return byWeek.size ? Math.max(...byWeek.values()) : 0;
}

// day/night classification from the sc-15 / sc-16 day_night column.
// Values in the DB: "day" | "night" (lowercase, spec-verified 100%
// populated on GAME rows for all six accounts, 2026-08-21). Anything
// else counts as neither so the sum invariant catches unexpected data.
function classifyDN(v) {
  const s = String(v || "").toLowerCase();
  if (s === "night") return "night";
  if (s === "day")   return "day";
  return null;
}

/**
 * List ordered homestands for an MLB account in a fiscal year.
 *
 * Returns [] for any account not in HOMESTAND_ACCOUNTS_FY2026 - see
 * that constant's own comment for the reasoning behind the list.
 * Returns [] if the fiscal year has no schedule rows or no budgets.
 *
 * @param {SupabaseClient} supa
 * @param {string} accountKey
 * @param {number} fiscalYear (default 2026)
 * @returns {Promise<Array>} ordered stands
 */
export async function listHomestands(supa, accountKey, fiscalYear = 2026) {
  // Owner ruling 2026-08-21 (final): the homestand view is available
  // on the four accounts in HOMESTAND_ACCOUNTS_FY2026 and nobody else
  // for this season. See the constant's own comment for why this is a
  // hardcoded list, not a data-derived gate.
  if (!HOMESTAND_ACCOUNTS_FY2026.has(accountKey)) return [];
  const fy = FY_BOUNDARIES.get(fiscalYear);
  if (!fy) return [];

  const [sched, budgets] = await Promise.all([
    fetchAllRange(
      supa,
      "sc_homestand_schedule",
      "service_date, day_type, opponent, homestand_id, day_night, is_doubleheader, game_pk",
      [["account_key", accountKey]],
    ),
    fetchAllRange(
      supa,
      "kpi_budgets",
      "period_no, amount",
      [["account_key", accountKey], ["line_code", LINE_CODE], ["fiscal_year", fiscalYear]],
    ),
  ]);

  const games = sched
    .filter(r => r.day_type === "GAME"
                 && r.service_date >= fy.start
                 && r.service_date <= fy.end)
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
  if (!games.length) return [];

  const groups = groupGamesIntoStands(games);

  const budgetByPeriod = new Map();
  for (const b of budgets) budgetByPeriod.set(Number(b.period_no), Math.round(Number(b.amount) * 100));
  const dailyFloorIso = await resolveDailyFloor(supa);

  const out = [];
  for (let i = 0; i < groups.length; i++) {
    const stand = groups[i];
    const game_start = stand[0].service_date;
    const game_end   = stand[stand.length - 1].service_date;

    // window_start:
    //   Non-pre-floor stands take the day after the previous stand's
    //   last game (or game_start on the first stand of the season).
    //   The result is then clamped up to the daily floor, so no
    //   non-pre-floor stand ever owns days before the daily-grain
    //   floor. Kevin's post-PR-2 audit 2026-08-21: PR-1 v1 only
    //   clamped the FIRST stand, which meant HS 3 inherited a window
    //   reaching three days behind the floor (HS 2 was pre-floor,
    //   HS 3 got HS 2's game_end + 1 = 04/17, floor 04/20). The
    //   range resolver then refused HS 3 - "Daily detail starts
    //   04/20/26" - blanking the page for the operator.
    //
    //   pre_floor stays a property of the STAND (game_end < floor),
    //   not the window: HS 1 and HS 2 stay pre-floor because their
    //   games completed before daily detail started, so no attributable
    //   actual exists for them at all.
    let windowStart;
    if (i === 0) {
      windowStart = game_start;
    } else {
      windowStart = addDaysIso(groups[i - 1][groups[i - 1].length - 1].service_date, 1);
    }
    // Clamp NON-PRE-FLOOR windows up to the daily floor so the range
    // resolver stops refusing (was blanking the page for HS 3 through
    // HS 13 - Kevin's audit 2026-08-21). Pre-floor stands keep their
    // original window so start <= end stays coherent for display
    // even though they never render an actual.
    const preFloor = game_end < dailyFloorIso;
    if (!preFloor && windowStart < dailyFloorIso) windowStart = dailyFloorIso;
    const windowEnd = game_end;

    const nightGames = stand.filter(g => classifyDN(g.day_night) === "night").length;
    const dayGames   = stand.filter(g => classifyDN(g.day_night) === "day").length;
    const opponents  = [...new Set(stand.map(g => g.opponent).filter(Boolean))];

    // Budget: sum per-day mille-cents across the window, round to
    // cents at the field boundary. Absent on pre-floor stands per
    // owner ruling 2026-08-21.
    const budgetCents = preFloor
      ? null
      : Math.round(sumWindowMilleCents(budgetByPeriod, windowStart, windowEnd, fy.start) / 1000);

    out.push({
      // Stored id (metadata only - H3 verifies our derived groups
      // match). URL keys on game_start, never on this.
      homestand_id: stand[0].homestand_id || null,
      game_start, game_end,
      window_start: windowStart, window_end: windowEnd,
      game_days: stand.length,
      night_games: nightGames,
      day_games:   dayGames,
      peak_games_in_week: peakGamesInWeek(stand),
      window_days: daysBetween(windowStart, windowEnd) + 1,
      opponents,
      budget: budgetCents == null ? null : budgetCents / 100,
      pre_floor: preFloor,
      window_start_bounded_by: windowStart === dailyFloorIso
        ? "daily_floor"
        : (i === 0 ? "game_start" : "prev_game_end_plus_1"),
      index: i + 1,
      of_total: groups.length,
    });
  }
  return out;
}

// Reads the daily floor the same way the range resolver does: the
// earliest week_start where week_source='sc_day_metadata'. Falls back
// to the DOLLAR_COVERAGE_FLOOR constant if the read errors, matching
// the route's pattern.
async function resolveDailyFloor(supa) {
  const q = await supa
    .from("labor_actuals_latest")
    .select("week_start")
    .eq("week_source", "sc_day_metadata")
    .order("week_start", { ascending: true })
    .limit(1);
  if (q.error || !q.data?.length) {
    const { DOLLAR_COVERAGE_FLOOR } = await import("../kpi/floors.js");
    return DOLLAR_COVERAGE_FLOOR;
  }
  return q.data[0].week_start;
}

/**
 * Find one stand by its game_start ISO (the URL key).
 * @returns the stand object or null.
 */
export function findHomestandByGameStart(homestands, gameStartIso) {
  if (!gameStartIso) return null;
  return (homestands || []).find(h => h.game_start === gameStartIso) || null;
}

/**
 * Split actuals across a stand's window into GAME vs OFF, plus the
 * one-day-before-open prep total. Returns null on a pre-floor stand
 * (owner ruling 2026-08-21: absent, not zero).
 *
 * Accumulates in myriadths (amount * 10000) so 4dp precision from
 * labor_actuals_daily.dollars_* survives the sum; rounds to cents at
 * the output field boundary. Same discipline the daily-grain PR uses.
 *
 * @param {Array<{work_date, amount}>} actualsDaily
 * @param {Object} stand
 * @param {Set<string>} gameDates  ISO dates of every GAME in the stand
 * @returns {Object|null}
 */
export function computeSplitWithGameDates(actualsDaily, stand, gameDates) {
  if (!stand || stand.pre_floor) return null;
  const prepIso = addDaysIso(stand.game_start, -1);
  let gameX10000 = 0, offX10000 = 0, prepX10000 = 0;
  const offDays = new Set();
  for (const r of actualsDaily || []) {
    if (r.work_date < stand.window_start || r.work_date > stand.window_end) continue;
    const x = Math.round(Number(r.amount || 0) * 10000);
    if (gameDates.has(r.work_date)) {
      gameX10000 += x;
    } else {
      offX10000 += x;
      offDays.add(r.work_date);
      if (r.work_date === prepIso) prepX10000 += x;
    }
  }
  return {
    game_day_dollars: Math.round(gameX10000 / 100) / 100,
    off_day_dollars:  Math.round(offX10000  / 100) / 100,
    off_day_count:    offDays.size,
    prep_day_dollars: Math.round(prepX10000 / 100) / 100,
  };
}

/**
 * Season bank. Sums FINISHED stands (game_end < todayIso) that are
 * NOT pre-floor. Owner ruling 2026-08-21: pre-floor stands have
 * budget but no attributable actual - counting one without the other
 * fakes a surplus (design-pass inflated $6,009 to $10,783).
 *
 * Rounding boundary is PER STAND on both sides, matching the values
 * an operator sees on the season rail. `h.budget` is already
 * cent-rounded by the resolver (from the mille-cent per-day sum).
 * Actual comes from actualsByStand's myriadth accumulator and is
 * rounded to cents PER STAND before it enters the sum. This means
 * the bank equals `sum(per-stand budget shown) - sum(per-stand
 * actual shown)` exactly - an operator adding the nine stands on
 * screen lands on the bank to the cent. Owner ruling 2026-08-21
 * after PR-1 v1's mille-cent parallel accumulator drifted 2c.
 *
 * @param {Array} homestands
 * @param {Map<string, number>} actualX10000ByGameStart  myriadths per stand
 * @param {string} todayIso
 */
export function computeHomestandBank(homestands, actualX10000ByGameStart, todayIso) {
  let budgetCents = 0;
  let spentCents  = 0;
  let remainingBudgetCents = 0;
  let standsFinished = 0;
  let standsRemaining = 0;
  for (const h of homestands) {
    if (h.pre_floor) continue;
    if (h.game_end < todayIso) {
      budgetCents += Math.round((h.budget || 0) * 100);              // per-stand rounded
      const x10000 = actualX10000ByGameStart.get(h.game_start) || 0;
      spentCents  += Math.round(x10000 / 100);                       // per-stand rounded
      standsFinished++;
    } else {
      standsRemaining++;
      remainingBudgetCents += Math.round((h.budget || 0) * 100);
    }
  }
  const bankCents = budgetCents - spentCents;
  const bankShareCents = standsRemaining > 0 ? Math.round(bankCents / standsRemaining) : 0;
  // Owner ruling 2026-08-21: any figure the server computes must be
  // read on the client, never re-derived. The season-to-date card's
  // "9 finished / 2 remaining / $15,018.09 budgeted" trio all comes
  // from this return so the client cannot count pre-floor stands or
  // count future stands as finished. Same discrimination the bank
  // itself uses (pre_floor excluded, game_end < today = finished).
  return {
    budget_to_date:  budgetCents / 100,
    spent_to_date:   spentCents  / 100,
    bank:            bankCents   / 100,
    stands_finished:  standsFinished,
    stands_remaining: standsRemaining,
    remaining_budget: remainingBudgetCents / 100,
    bank_share:      bankShareCents / 100,
  };
}

/**
 * Roll up per-stand actual myriadths keyed by game_start. Bank uses this.
 * Myriadths preserve 4dp precision from labor_actuals_daily.
 */
export function actualsByStand(homestands, actualsDailyFy) {
  const out = new Map();
  const daily = actualsDailyFy || [];
  for (const h of homestands) {
    if (h.pre_floor) continue;
    let x10000 = 0;
    for (const r of daily) {
      if (r.work_date >= h.window_start && r.work_date <= h.window_end) {
        x10000 += Math.round(Number(r.amount || 0) * 10000);
      }
    }
    out.set(h.game_start, x10000);
  }
  return out;
}
