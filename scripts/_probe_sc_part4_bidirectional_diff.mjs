// READ-ONLY probe for Part 4 Steps 2-4: bidirectional (DB<->API) diff on
// ALL 8 schedule-bearing accounts + full PPD/DH population + projection-
// alignment diff where meals feed billing.
//
// Kevin's amendment: Part 1 walked DB->API only, which is how STL 7/23
// hid. This probe walks BOTH directions on all 8 accounts (re-verifying
// the 4 MLB accounts' reverse walk too, cheaply).
//
// Buckets:
//   OK              - pk match on same date, opp+ha agree
//   ATTRIBUTE_DRIFT - pk+date match but opp or ha differs (beyond ARI/AZ)
//   DATE_DRIFT      - pk matches but hs.service_date != API date (STL 7/23 class)
//   MISSING_IN_DB   - API has game with pk X, DB has no row with pk X
//   PHANTOM_IN_DB   - DB has row with pk X, API has no game with pk X
//   PPD             - API game with status Postponed/Suspended/Rescheduled
//   DH              - API game with doubleHeader != "N" (part of a doubleheader)
//
// Zero writes.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCOUNTS = [
  { key: "CIN - OH",     sportId: 1,  teamId: 113, name: "Cincinnati Reds",       tz: "America/New_York" },
  { key: "STL - MO",     sportId: 1,  teamId: 138, name: "St. Louis Cardinals",    tz: "America/Chicago"  },
  { key: "TXR - TX - H", sportId: 1,  teamId: 140, name: "Texas Rangers (H)",      tz: "America/Chicago"  },
  { key: "TXR - TX - V", sportId: 1,  teamId: 140, name: "Texas Rangers (V)",      tz: "America/Chicago"  },
  { key: "CIN - KY",     sportId: 11, teamId: 416, name: "Louisville Bats",        tz: "America/New_York" },
  { key: "TBJ - NY",     sportId: 11, teamId: 422, name: "Buffalo Bisons",         tz: "America/New_York" },
  { key: "STL - FL",     sportId: 14, teamId: 279, name: "Palm Beach Cardinals",   tz: "America/New_York" },
  { key: "TBJ - FL",     sportId: 14, teamId: 424, name: "Dunedin Blue Jays",      tz: "America/New_York" },
];

// Wide season range to catch spring + FSL + AAA + MLB regular seasons.
const SEASON_START = "2026-02-01";
const SEASON_END   = "2026-11-30";

// Opponent code normalization from Part 1.
const MLB_TO_DB_OPP = new Map(Object.entries({
  AZ: "ARI",
  OAK: "ATH",
}));

function localDate(iso, tz) {
  const d = new Date(iso);
  const y = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(d);
  const m = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "2-digit" }).format(d);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "2-digit" }).format(d);
  return `${y}-${m}-${day}`;
}

async function fetchApi(sportId, teamId, tz) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=${sportId}&teamId=${teamId}&startDate=${SEASON_START}&endDate=${SEASON_END}&hydrate=team`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status} on ${url}`);
  const data = await res.json();
  const games = [];
  for (const day of data.dates || []) {
    for (const g of day.games || []) {
      // Regular season only, mirroring Part 1's gameType=R filter.
      // FSL/MiLB: 'R' is still the code for regular-season MiLB games.
      if (g.gameType !== "R") continue;
      const home = g.teams?.home?.team;
      const away = g.teams?.away?.team;
      const isHome = home?.id === teamId;
      const oppTeam = isHome ? away : home;
      const rawAbbr = oppTeam?.abbreviation || null;
      const opp = rawAbbr && MLB_TO_DB_OPP.has(rawAbbr)
        ? MLB_TO_DB_OPP.get(rawAbbr)
        : rawAbbr;
      const status = g.status?.detailedState || "";
      const isPPD = /Postpone|Suspend|Rescheduled/i.test(status);
      const dhCode = g.doubleHeader || "N";  // "N" | "Y" (traditional) | "S" (split)
      games.push({
        date: localDate(g.gameDate, tz),
        game_pk: g.gamePk,
        ha: isHome ? "HOME" : "AWAY",
        opp,
        status,
        isPPD,
        dhCode,
        gameNumber: g.gameNumber,
        gameTimeUtc: g.gameDate,
      });
    }
  }
  return games;
}

async function loadHs(accountKey) {
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, day_type, opponent, game_pk, is_doubleheader, game_time")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`hs ${error.message}`);
  return data;
}

async function loadProjectionDates(accountKey) {
  const { data, error } = await supa
    .from("sc_daily_revenue")
    .select("service_date, has_projection, projected_count")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END);
  if (error) throw new Error(`rev ${error.message}`);
  const map = new Map();
  for (const r of data) {
    let d = map.get(r.service_date);
    if (!d) { d = { rows: 0, hasProj: false, projSum: 0 }; map.set(r.service_date, d); }
    d.rows++;
    if (r.has_projection) d.hasProj = true;
    d.projSum += Number(r.projected_count) || 0;
  }
  return map;
}

function auditAccount(acct, apiGames, hsRows, projMap) {
  const apiByPk = new Map();
  for (const g of apiGames) apiByPk.set(g.game_pk, g);
  const hsByPk = new Map();
  const hsByDate = new Map();
  const hsByDateArray = new Map();
  for (const r of hsRows) {
    hsByPk.set(r.game_pk, r);
    hsByDate.set(r.service_date, r);
    if (!hsByDateArray.has(r.service_date)) hsByDateArray.set(r.service_date, []);
    hsByDateArray.get(r.service_date).push(r);
  }

  // Bucket enumeration
  const buckets = {
    OK: [],
    ATTRIBUTE_DRIFT: [],
    DATE_DRIFT: [],
    MISSING_IN_DB: [],
    PHANTOM_IN_DB: [],
    PPD: [],
    DH_dates: new Set(),
    DH_games: [],
  };

  // API-side walk: MISSING_IN_DB, DATE_DRIFT, ATTRIBUTE_DRIFT, PPD, DH
  for (const g of apiGames) {
    if (g.isPPD) buckets.PPD.push(g);
    if (g.dhCode !== "N") {
      buckets.DH_dates.add(g.date);
      buckets.DH_games.push(g);
    }
    const hs = hsByPk.get(g.game_pk);
    if (!hs) {
      buckets.MISSING_IN_DB.push({ ...g });
      continue;
    }
    // Match by pk. Now check date + attrs.
    if (hs.service_date !== g.date) {
      buckets.DATE_DRIFT.push({
        game_pk: g.game_pk,
        api_date: g.date, api_status: g.status, api_ha: g.ha, api_opp: g.opp,
        hs_date: hs.service_date, hs_day_type: hs.day_type, hs_opp: hs.opponent,
      });
      continue;
    }
    // Same date. Check ha + opp.
    const expectedDt = g.ha === "HOME" ? "GAME" : "AWAY";
    const haOk = hs.day_type === expectedDt || hs.day_type === "EXHIBITION";
    const oppOk = (hs.opponent || null) === (g.opp || null);
    if (!haOk || !oppOk) {
      buckets.ATTRIBUTE_DRIFT.push({
        date: g.date, game_pk: g.game_pk,
        api_ha: g.ha, api_opp: g.opp,
        hs_day_type: hs.day_type, hs_opp: hs.opponent,
        haOk, oppOk,
      });
    } else {
      buckets.OK.push({ date: g.date, game_pk: g.game_pk });
    }
  }

  // DB-side walk: PHANTOM_IN_DB (hs rows with no matching API pk)
  for (const r of hsRows) {
    if (!apiByPk.has(r.game_pk)) {
      buckets.PHANTOM_IN_DB.push({
        date: r.service_date, game_pk: r.game_pk,
        hs_day_type: r.day_type, hs_opp: r.opponent, hs_is_doubleheader: r.is_doubleheader,
      });
    }
  }

  // Projection alignment (billing-relevant for AAA + FSL where meal counts feed billing)
  const scheduleDateSet = new Set(hsRows.map(r => r.service_date));
  const projDateSet = new Set(projMap.keys());
  const scheduleWithoutProjections = [...scheduleDateSet].filter(d => !projMap.has(d) || !projMap.get(d).hasProj).sort();
  const projectionsWithoutSchedule = [...projDateSet].filter(d => !scheduleDateSet.has(d)).sort();
  // DH representation: hs date rows count vs API DH date game count
  const dhCoverage = [];
  for (const dhDate of buckets.DH_dates) {
    const apiCount = apiGames.filter(g => g.date === dhDate).length;
    const dbCount = (hsByDateArray.get(dhDate) || []).length;
    dhCoverage.push({ date: dhDate, api_games: apiCount, db_rows: dbCount, matches: apiCount === dbCount });
  }

  return {
    acct,
    counts: {
      api_games: apiGames.length,
      hs_rows: hsRows.length,
      OK: buckets.OK.length,
      ATTRIBUTE_DRIFT: buckets.ATTRIBUTE_DRIFT.length,
      DATE_DRIFT: buckets.DATE_DRIFT.length,
      MISSING_IN_DB: buckets.MISSING_IN_DB.length,
      PHANTOM_IN_DB: buckets.PHANTOM_IN_DB.length,
      PPD: buckets.PPD.length,
      DH_dates: buckets.DH_dates.size,
      DH_games: buckets.DH_games.length,
    },
    buckets,
    projAlignment: {
      scheduleWithoutProjections,
      projectionsWithoutSchedule,
    },
    dhCoverage,
  };
}

function printAccountReport(r) {
  console.log(`\n============================================================`);
  console.log(`${r.acct.key} (sportId=${r.acct.sportId}, teamId=${r.acct.teamId}, ${r.acct.name})`);
  console.log(`============================================================`);
  const c = r.counts;
  console.log(`  API games ${c.api_games}  |  hs rows ${c.hs_rows}`);
  console.log(`  OK                : ${c.OK}`);
  console.log(`  ATTRIBUTE_DRIFT   : ${c.ATTRIBUTE_DRIFT}`);
  console.log(`  DATE_DRIFT        : ${c.DATE_DRIFT}`);
  console.log(`  MISSING_IN_DB     : ${c.MISSING_IN_DB}`);
  console.log(`  PHANTOM_IN_DB     : ${c.PHANTOM_IN_DB}`);
  console.log(`  PPD (any status)  : ${c.PPD}`);
  console.log(`  DH dates          : ${c.DH_dates}  (${c.DH_games} DH games)`);

  if (c.ATTRIBUTE_DRIFT > 0) {
    console.log(`  --- ATTRIBUTE_DRIFT rows ---`);
    for (const r2 of r.buckets.ATTRIBUTE_DRIFT.slice(0, 20)) {
      console.log(`    ${r2.date} pk=${r2.game_pk} api=${r2.api_ha}/${r2.api_opp} hs=${r2.hs_day_type}/${r2.hs_opp} haOk=${r2.haOk} oppOk=${r2.oppOk}`);
    }
    if (r.buckets.ATTRIBUTE_DRIFT.length > 20) console.log(`    ... (${r.buckets.ATTRIBUTE_DRIFT.length - 20} more)`);
  }
  if (c.DATE_DRIFT > 0) {
    console.log(`  --- DATE_DRIFT rows (hs.service_date != API date; STL 7/23 class) ---`);
    for (const r2 of r.buckets.DATE_DRIFT) {
      console.log(`    pk=${r2.game_pk} api_date=${r2.api_date} (${r2.api_status}) hs_date=${r2.hs_date} api=${r2.api_ha}/${r2.api_opp} hs=${r2.hs_day_type}/${r2.hs_opp}`);
    }
  }
  if (c.MISSING_IN_DB > 0) {
    console.log(`  --- MISSING_IN_DB rows (API game pk absent from hs entirely) ---`);
    for (const r2 of r.buckets.MISSING_IN_DB.slice(0, 20)) {
      console.log(`    ${r2.date} pk=${r2.game_pk} api=${r2.ha}/${r2.opp} status="${r2.status}" DH=${r2.dhCode} game#=${r2.gameNumber}`);
    }
    if (r.buckets.MISSING_IN_DB.length > 20) console.log(`    ... (${r.buckets.MISSING_IN_DB.length - 20} more)`);
  }
  if (c.PHANTOM_IN_DB > 0) {
    console.log(`  --- PHANTOM_IN_DB rows (hs pk absent from API) ---`);
    for (const r2 of r.buckets.PHANTOM_IN_DB.slice(0, 15)) {
      console.log(`    ${r2.date} pk=${r2.game_pk} hs=${r2.hs_day_type}/${r2.hs_opp} DH=${r2.hs_is_doubleheader}`);
    }
    if (r.buckets.PHANTOM_IN_DB.length > 15) console.log(`    ... (${r.buckets.PHANTOM_IN_DB.length - 15} more)`);
  }
  if (c.PPD > 0) {
    console.log(`  --- PPD games (status Postponed/Suspended/Rescheduled) ---`);
    for (const g of r.buckets.PPD.slice(0, 15)) {
      const inDb = r.buckets.MISSING_IN_DB.find(x => x.game_pk === g.game_pk) ? " MISSING_IN_DB" : "";
      console.log(`    ${g.date} pk=${g.game_pk} api=${g.ha}/${g.opp} status="${g.status}" DH=${g.dhCode}${inDb}`);
    }
    if (r.buckets.PPD.length > 15) console.log(`    ... (${r.buckets.PPD.length - 15} more)`);
  }
  if (c.DH_dates > 0) {
    console.log(`  --- DH dates + coverage ---`);
    for (const c2 of r.dhCoverage) {
      const marker = c2.matches ? "OK " : "DIVERGE";
      console.log(`    ${c2.date} api_games=${c2.api_games} db_rows=${c2.db_rows} ${marker}`);
    }
  }
}

async function main() {
  console.log("READ-ONLY :: Part 4 Step 2-4 - bidirectional diff + PPD/DH + projection alignment");
  console.log("all 8 schedule-bearing accounts");

  const results = [];
  for (const acct of ACCOUNTS) {
    const [apiGames, hsRows, projMap] = await Promise.all([
      fetchApi(acct.sportId, acct.teamId, acct.tz),
      loadHs(acct.key),
      loadProjectionDates(acct.key),
    ]);
    const r = auditAccount(acct, apiGames, hsRows, projMap);
    results.push(r);
    printAccountReport(r);
  }

  // ── SEASON-WIDE ROLLUP ────────────────────────────────────────────
  console.log(`\n\n############################################################`);
  console.log(`ROLLUP :: full 2026 population that DH/PPD Option A must handle`);
  console.log(`############################################################`);
  const allPpd = [];
  const allDhDates = [];
  const allDateDrift = [];
  const allMissingInDb = [];
  const allPhantomInDb = [];
  for (const r of results) {
    for (const g of r.buckets.PPD) allPpd.push({ account: r.acct.key, ...g });
    for (const d of r.buckets.DH_dates) allDhDates.push({ account: r.acct.key, date: d });
    for (const x of r.buckets.DATE_DRIFT) allDateDrift.push({ account: r.acct.key, ...x });
    for (const x of r.buckets.MISSING_IN_DB) allMissingInDb.push({ account: r.acct.key, ...x });
    for (const x of r.buckets.PHANTOM_IN_DB) allPhantomInDb.push({ account: r.acct.key, ...x });
  }
  console.log(`  Total PPD games across all accounts: ${allPpd.length}`);
  console.log(`  Total DH dates across all accounts:  ${allDhDates.length}`);
  console.log(`  Total DATE_DRIFT rows:               ${allDateDrift.length}`);
  console.log(`  Total MISSING_IN_DB rows:            ${allMissingInDb.length}`);
  console.log(`  Total PHANTOM_IN_DB rows:            ${allPhantomInDb.length}`);

  // ── PROJECTION-ALIGNMENT ROLLUP (AAA + FSL) ─────────────────────
  console.log(`\n\n############################################################`);
  console.log(`PROJECTION ALIGNMENT :: AAA (billing) + FSL/PDCO`);
  console.log(`############################################################`);
  for (const r of results) {
    if (r.acct.sportId === 1) continue; // MLB fee billing-inert
    const p = r.projAlignment;
    console.log(`\n  ${r.acct.key} (sportId=${r.acct.sportId}):`);
    console.log(`    Schedule days WITHOUT projections (post-fix render OK, but billing = 0): ${p.scheduleWithoutProjections.length}`);
    if (p.scheduleWithoutProjections.length > 0 && p.scheduleWithoutProjections.length <= 25) {
      for (const d of p.scheduleWithoutProjections) console.log(`      ${d}`);
    } else if (p.scheduleWithoutProjections.length > 25) {
      for (const d of p.scheduleWithoutProjections.slice(0, 12)) console.log(`      ${d}`);
      console.log(`      ... (${p.scheduleWithoutProjections.length - 12} more)`);
    }
    console.log(`    Projection days NOT in schedule (authored-before-schedule artifacts): ${p.projectionsWithoutSchedule.length}`);
    if (p.projectionsWithoutSchedule.length > 0 && p.projectionsWithoutSchedule.length <= 15) {
      for (const d of p.projectionsWithoutSchedule) console.log(`      ${d}`);
    } else if (p.projectionsWithoutSchedule.length > 15) {
      for (const d of p.projectionsWithoutSchedule.slice(0, 8)) console.log(`      ${d}`);
      console.log(`      ... (${p.projectionsWithoutSchedule.length - 8} more)`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
