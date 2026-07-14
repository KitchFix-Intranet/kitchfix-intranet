// READ-ONLY probe for the Bug B PR riders (Kevin's 2026-07-14 additions).
//
// Rider (2): are there HOME game days on the 4 MLB fee accounts that lack
//            sc_daily_projections rows? Post-fallback they render as game
//            days with no meals line - report the list.
// Rider (4): does the same authored-before-schedule lifecycle touch
//            AAA/PDCO projections? Report schedule-vs-projection date
//            misalignment on the 2 AAA and any PDCO accounts (billing-side
//            data gap - meal counts feed billing there, so this MATTERS).
// STL 7/23 : missing-row-or-missing-attribute reconciliation vs Part 1's
//            missing=0 claim.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const MLB_FEE = ["CIN - OH", "STL - MO", "TXR - TX - H", "TXR - TX - V"];
const AAA_ACCOUNTS = ["CIN - KY", "TBJ - NY"];  // Louisville, Buffalo per Part 1

const SEASON_START = "2026-03-15";
const SEASON_END   = "2026-11-15";

async function loadHs(accountKey) {
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, day_type, opponent, game_pk")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`hs ${error.message}`);
  return data;
}

async function loadProjectionDates(accountKey) {
  // sc_daily_revenue is a VIEW backed by sc_daily_projections + actuals.
  // A date has "any projection rows" if the view has at least one row
  // for that (account, date). Group by service_date, distinct.
  const { data, error } = await supa
    .from("sc_daily_revenue")
    .select("service_date, has_projection, projected_count")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`rev ${error.message}`);
  const dates = new Map();
  for (const r of data) {
    let d = dates.get(r.service_date);
    if (!d) { d = { rows: 0, hasProj: false, projSum: 0 }; dates.set(r.service_date, d); }
    d.rows++;
    if (r.has_projection) d.hasProj = true;
    d.projSum += Number(r.projected_count) || 0;
  }
  return dates;
}

async function loadDayMeta(accountKey) {
  const { data, error } = await supa
    .from("sc_day_metadata")
    .select("service_date, game_type, game_time")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`meta ${error.message}`);
  return data;
}

async function accountSummary(acctKey, label) {
  const [hs, projMap, meta] = await Promise.all([
    loadHs(acctKey),
    loadProjectionDates(acctKey),
    loadDayMeta(acctKey),
  ]);
  const homeGames = hs.filter(r => r.day_type === "GAME");
  const awayGames = hs.filter(r => r.day_type === "AWAY");

  const homeNoProj = homeGames.filter(r => !projMap.has(r.service_date) || !projMap.get(r.service_date).hasProj);
  const awayNoProj = awayGames.filter(r => !projMap.has(r.service_date) || !projMap.get(r.service_date).hasProj);
  const awayZeroRows = awayGames.filter(r => !projMap.has(r.service_date));

  // Schedule-vs-projection date misalignment: how many "projection" dates
  // (rows in the view) exist that are NOT in hs? For AAA/PDCO these
  // represent projections authored before / off-schedule.
  const hsSet = new Set(hs.map(r => r.service_date));
  const projOnly = [...projMap.keys()].filter(d => !hsSet.has(d));

  console.log(`\n=== ${acctKey} (${label}) ===`);
  console.log(`  hs rows: ${hs.length}  (GAME ${homeGames.length}, AWAY ${awayGames.length})`);
  console.log(`  distinct dates with projection rows: ${projMap.size}`);
  console.log(`  meta rows: ${meta.length}`);
  console.log(`  HOME games WITHOUT projection rows: ${homeNoProj.length}`);
  if (homeNoProj.length > 0) {
    for (const r of homeNoProj) console.log(`    ${r.service_date} vs ${r.opponent}  (pk=${r.game_pk})`);
  }
  console.log(`  AWAY games WITHOUT projection rows: ${awayNoProj.length}`);
  if (awayNoProj.length > 0 && awayNoProj.length <= 15) {
    for (const r of awayNoProj) console.log(`    ${r.service_date} @${r.opponent}  (pk=${r.game_pk})`);
  } else if (awayNoProj.length > 15) {
    for (const r of awayNoProj.slice(0, 5)) console.log(`    ${r.service_date} @${r.opponent}`);
    console.log(`    ... (${awayNoProj.length - 5} more)`);
  }
  console.log(`  AWAY games with ZERO rows entirely (Kevin's Bug B set): ${awayZeroRows.length}`);
  console.log(`  Projection-only dates NOT in hs schedule: ${projOnly.length}`);
  if (projOnly.length > 0 && projOnly.length <= 20) {
    for (const d of projOnly) console.log(`    ${d}`);
  } else if (projOnly.length > 20) {
    for (const d of projOnly.slice(0, 8)) console.log(`    ${d}`);
    console.log(`    ... (${projOnly.length - 8} more)`);
  }

  return { acctKey, homeGames, awayGames, homeNoProj, awayNoProj, awayZeroRows, projOnly };
}

async function stlSevenTwentyThree() {
  console.log(`\n=== STL 7/23 RECONCILIATION vs Part 1 missing=0 ===`);
  // Missing row (no hs), missing attribute (row present but day_type wrong),
  // or missing game_pk match?
  const { data: hsAny } = await supa
    .from("sc_homestand_schedule")
    .select("*")
    .eq("account_key", "STL - MO")
    .eq("service_date", "2026-07-23");
  console.log(`  sc_homestand_schedule rows for STL - MO on 2026-07-23: ${hsAny?.length || 0}`);
  if (hsAny && hsAny.length > 0) {
    for (const r of hsAny) {
      console.log(`    day_type=${r.day_type} opp=${r.opponent} game_pk=${r.game_pk} homestand_id=${r.homestand_id}`);
    }
  }
  // Wider check: how many API-only STL games total (Part 3 spotted STL API
  // count 166 vs 162 rows - 4-game gap; enumerate all four).
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=138&startDate=${SEASON_START}&endDate=${SEASON_END}&hydrate=team`;
  const res = await fetch(url);
  const data = await res.json();
  const apiGames = [];
  for (const day of data.dates || []) {
    for (const g of day.games || []) {
      if (g.gameType !== "R") continue;
      const isHome = g.teams?.home?.team?.id === 138;
      const oppTeam = isHome ? g.teams.away.team : g.teams.home.team;
      const gd = new Date(g.gameDate);
      const y = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(gd);
      const m = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit" }).format(gd);
      const day2 = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", day: "2-digit" }).format(gd);
      apiGames.push({
        date: `${y}-${m}-${day2}`,
        pk: g.gamePk,
        ha: isHome ? "HOME" : "AWAY",
        opp: oppTeam?.abbreviation || null,
        status: g.status?.detailedState || "",
        dhCode: g.doubleHeader,
        gameNumber: g.gameNumber,
      });
    }
  }
  console.log(`  MLB API STL regular-season games: ${apiGames.length}`);
  const { data: allStl } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, day_type, opponent, game_pk")
    .eq("account_key", "STL - MO")
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END);
  const hsByPk = new Map((allStl || []).map(r => [r.game_pk, r]));
  const hsByDate = new Map();
  for (const r of allStl || []) {
    if (!hsByDate.has(r.service_date)) hsByDate.set(r.service_date, []);
    hsByDate.get(r.service_date).push(r);
  }
  console.log(`  STL hs rows loaded: ${allStl?.length || 0}`);
  const apiOnly = apiGames.filter(g => !hsByPk.has(g.pk));
  console.log(`  API games with NO matching hs row (by game_pk): ${apiOnly.length}`);
  for (const g of apiOnly) {
    const dateHs = hsByDate.get(g.date) || [];
    console.log(`    ${g.date} pk=${g.pk} api=${g.ha} vs ${g.opp} status=${g.status} DH-code=${g.dhCode} game#=${g.gameNumber}`);
    if (dateHs.length > 0) {
      for (const r of dateHs) {
        console.log(`      hs on same date: day_type=${r.day_type} opp=${r.opponent} game_pk=${r.game_pk} (attribute drift? or DH slot for different pk?)`);
      }
    } else {
      console.log(`      hs on same date: (no row)  <-- fully missing row`);
    }
  }
}

async function main() {
  console.log("READ-ONLY :: Bug B PR riders (schedule-truth doctrine)");

  console.log("\n\n########## RIDER (2): MLB fee accounts - HOME games without projections ##########");
  for (const acct of MLB_FEE) {
    await accountSummary(acct, "MLB fee");
  }

  console.log("\n\n########## RIDER (4): AAA/PDCO schedule-vs-projection misalignment ##########");
  console.log("(AAA meal counts feed billing - findings are separately actionable, not shipped with this PR.)");
  for (const acct of AAA_ACCOUNTS) {
    await accountSummary(acct, "AAA (has schedule)");
  }
  // Also check the PDCO account (has schedule overlay but not homestand_schedule).
  console.log("\n  PDCO check (STL - FL):");
  await accountSummary("STL - FL", "PDCO (schedule_overlay)");

  console.log("\n\n########## STL 7/23 reconciliation vs Part 1 missing=0 ##########");
  await stlSevenTwentyThree();
}

main().catch((e) => { console.error(e); process.exit(1); });
