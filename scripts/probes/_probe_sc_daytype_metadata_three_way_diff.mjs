// READ-ONLY probe for Part 3.
//
// Three-way diff: sc_homestand_schedule.day_type  vs  sc_day_metadata.game_type
// vs MLB Stats API, for the four MLB fee accounts across 2026 regular season.
// Also tests Kevin's pattern: every AWAY date whose NEXT calendar date is a GAME
// date (getaway-into-homestand-opener). Also inspects CIN 8/17 (real DH).
//
// Zero writes. No branches touched.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCOUNTS = [
  { key: "CIN - OH",     mlbId: 113, name: "Cincinnati Reds"     },
  { key: "STL - MO",     mlbId: 138, name: "St. Louis Cardinals" },
  { key: "TXR - TX - H", mlbId: 140, name: "Texas Rangers (H)"   },
  { key: "TXR - TX - V", mlbId: 140, name: "Texas Rangers (V)"   },
];

const SEASON_START = "2026-03-15";
const SEASON_END   = "2026-11-15";

// MLB API opponent code normalization (matches Part 1 findings).
const MLB_TO_DB_OPP = new Map(Object.entries({
  AZ: "ARI",
  OAK: "ATH",
}));

function ctDate(iso) {
  // Convert ISO UTC gameDate to a Central-Time YYYY-MM-DD date.
  const d = new Date(iso);
  const y = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(d);
  const m = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit" }).format(d);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", day: "2-digit" }).format(d);
  return `${y}-${m}-${day}`;
}

async function fetchApiSchedule(mlbId) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${mlbId}&startDate=${SEASON_START}&endDate=${SEASON_END}&hydrate=team`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const games = [];
  for (const day of data.dates || []) {
    for (const g of day.games || []) {
      if (g.gameType !== "R") continue;
      const home = g.teams?.home?.team;
      const away = g.teams?.away?.team;
      const isHome = home?.id === mlbId;
      const oppTeam = isHome ? away : home;
      const rawAbbr = oppTeam?.abbreviation || null;
      const opp = rawAbbr && MLB_TO_DB_OPP.has(rawAbbr) ? MLB_TO_DB_OPP.get(rawAbbr) : rawAbbr;
      const status = g.status?.detailedState || "";
      const isPPD = /Postpone|Suspend/i.test(status);
      games.push({
        date: ctDate(g.gameDate),
        game_pk: g.gamePk,
        ha: isHome ? "HOME" : "AWAY",
        opp,
        status,
        isPPD,
        doubleHeaderCode: g.doubleHeader,
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
    .select("service_date, day_type, opponent, game_pk, homestand_id, day_night, game_time, is_doubleheader")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`hs ${error.message}`);
  return data;
}

async function loadMetadata(accountKey) {
  const { data, error } = await supa
    .from("sc_day_metadata")
    .select("*")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`meta ${error.message}`);
  return data;
}

async function loadRevenue(accountKey) {
  const { data, error } = await supa
    .from("sc_daily_revenue")
    .select("service_date, game_type, game_time")
    .eq("account_key", accountKey)
    .gte("service_date", SEASON_START)
    .lte("service_date", SEASON_END)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`rev ${error.message}`);
  return data;
}

function toMap(rows, key = "service_date") {
  const m = new Map();
  for (const r of rows) m.set(r[key], r);
  return m;
}

function toApiByDate(games) {
  // Handle DH (two games same date) - group into an array per date.
  const m = new Map();
  for (const g of games) {
    if (!m.has(g.date)) m.set(g.date, []);
    m.get(g.date).push(g);
  }
  return m;
}

function nextDate(iso) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function three(v) { return v == null ? "(null)" : String(v).padEnd(10); }

async function auditAccount(acct) {
  console.log(`\n============================================================`);
  console.log(`ACCOUNT: ${acct.key} (mlbId=${acct.mlbId}, ${acct.name})`);
  console.log(`============================================================`);
  const [apiRaw, hs, meta, rev] = await Promise.all([
    fetchApiSchedule(acct.mlbId),
    loadHs(acct.key),
    loadMetadata(acct.key),
    loadRevenue(acct.key),
  ]);
  const api = toApiByDate(apiRaw);
  const hsMap = toMap(hs);
  const metaMap = toMap(meta);
  const revMap = toMap(rev);

  console.log(`  API games (regular season): ${apiRaw.length}`);
  console.log(`  sc_homestand_schedule rows: ${hs.length}`);
  console.log(`    day_type distribution: ${JSON.stringify(hs.reduce((a,r)=>{a[r.day_type]=(a[r.day_type]||0)+1;return a;},{}))}`);
  console.log(`  sc_day_metadata rows: ${meta.length}`);
  const metaGameTypes = meta.reduce((a,r)=>{a[r.game_type||"(null)"]=(a[r.game_type||"(null)"]||0)+1;return a;},{});
  console.log(`    game_type distribution: ${JSON.stringify(metaGameTypes)}`);
  console.log(`  sc_daily_revenue rows: ${rev.length}`);

  // Compare hs.day_type vs meta.game_type on the intersection.
  const allDates = new Set([...hsMap.keys(), ...metaMap.keys(), ...api.keys()]);
  const sortedDates = [...allDates].sort();

  // Mismatch buckets.
  const mismatches = [];
  const gameDayHsAwayMetaAway = []; // canonical away
  const gameDayHsAwayMetaOther = []; // hs says AWAY, meta says something else
  const gameDayHsGameMetaHome = [];
  const gameDayHsGameMetaOther = [];
  const gameDayNoHsRow = [];
  const noHsNoApi = []; // non-game date - fine
  const apiNoHsNoMeta = []; // API game but no HS row and no meta row
  const apiNoHs = []; // API game but no HS row (regardless of meta)

  for (const date of sortedDates) {
    const hsRow = hsMap.get(date);
    const metaRow = metaMap.get(date);
    const revRow = revMap.get(date);
    const apiGames = api.get(date) || [];

    const apiHa = apiGames.length > 0 ? apiGames[0].ha : null;

    // If API has a game on this date, HS should have a row with day_type IN (GAME, AWAY, EXHIBITION).
    if (apiHa) {
      const hasHs = !!hsRow;
      const hsDt = hsRow?.day_type || null;
      const metaGt = metaRow?.game_type || null;
      const revGt = revRow?.game_type || null;

      if (!hasHs) {
        apiNoHs.push({ date, apiHa, metaGt, revGt });
        continue;
      }
      const expectedHsDt = apiHa === "HOME" ? "GAME" : "AWAY";
      // meta.game_type expectation: HOME for home games, AWAY for away.
      const expectedMetaGt = apiHa === "HOME" ? "HOME" : "AWAY";

      const hsOk = hsDt === expectedHsDt || hsDt === "EXHIBITION"; // exhibition special
      const metaOk = metaGt === expectedMetaGt;

      if (!hsOk || !metaOk) {
        mismatches.push({
          date,
          api_ha: apiHa,
          hs_day_type: hsDt,
          meta_game_type: metaGt,
          rev_game_type: revGt,
          hs_ok: hsOk,
          meta_ok: metaOk,
        });
      }
    }
  }

  console.log(`\n  MISMATCH ROWS (dates where API has a game and DB layers don't all agree):`);
  console.log(`  --------------------------------------------------------------------`);
  if (mismatches.length === 0) {
    console.log(`  none.`);
  } else {
    console.log(`  date       | api_ha | hs.day_type | meta.game_type | rev.game_type | hs_ok | meta_ok`);
    for (const m of mismatches) {
      console.log(`  ${m.date} | ${(m.api_ha || "").padEnd(6)} | ${three(m.hs_day_type)} | ${three(m.meta_game_type)} | ${three(m.rev_game_type)} | ${m.hs_ok} | ${m.meta_ok}`);
    }
  }
  console.log(`  Mismatch count: ${mismatches.length}`);

  if (apiNoHs.length > 0) {
    console.log(`\n  DATES WHERE API HAS GAME BUT NO sc_homestand_schedule ROW:`);
    for (const m of apiNoHs) console.log(`    ${m.date} api=${m.apiHa} meta.game_type=${m.metaGt || "(null)"} rev.game_type=${m.revGt || "(null)"}`);
  }

  return { acct, apiGames: apiRaw, hs, hsMap, meta, metaMap, revMap, mismatches, apiNoHs, api };
}

function predictPatternMissing(hsRows) {
  // Kevin's pattern: every AWAY date whose NEXT calendar date is a GAME (home) date.
  // From sc_homestand_schedule alone, list these AWAY predecessors.
  const dtByDate = new Map();
  for (const r of hsRows) dtByDate.set(r.service_date, r.day_type);
  const predicted = [];
  for (const r of hsRows) {
    if (r.day_type !== "AWAY") continue;
    const nx = nextDate(r.service_date);
    const nxDt = dtByDate.get(nx);
    if (nxDt === "GAME") {
      predicted.push({ date: r.service_date, opp: r.opponent, next_home_date: nx, next_home_opp: hsRows.find(h => h.service_date === nx)?.opponent });
    }
  }
  return predicted;
}

async function checkCinDoubleheader817(auditResults) {
  const cin = auditResults.find(a => a.acct.key === "CIN - OH");
  if (!cin) return;
  console.log(`\n============================================================`);
  console.log(`CIN 8/17 DH SIDE OBSERVATION`);
  console.log(`============================================================`);
  const targetDates = ["2026-05-24", "2026-08-17"];
  for (const date of targetDates) {
    const hs = cin.hsMap.get(date);
    const meta = cin.metaMap.get(date);
    const rev = cin.revMap.get(date);
    const apiGames = cin.api.get(date) || [];
    console.log(`  ${date}:`);
    console.log(`    sc_homestand_schedule: ${hs ? `day_type=${hs.day_type} opp=${hs.opponent} game_pk=${hs.game_pk} game_time=${hs.game_time} is_doubleheader=${hs.is_doubleheader}` : "(no row)"}`);
    console.log(`    sc_day_metadata:       ${meta ? `game_type=${meta.game_type} game_time=${meta.game_time}` : "(no row)"}`);
    console.log(`    sc_daily_revenue:      ${rev ? `game_type=${rev.game_type} game_time=${rev.game_time}` : "(no row)"}`);
    console.log(`    MLB API games on date: ${apiGames.length}`);
    for (const g of apiGames) {
      console.log(`      pk=${g.game_pk} ha=${g.ha} opp=${g.opp} status=${g.status} DH-code=${g.doubleHeaderCode} game#=${g.gameNumber} gameTime=${g.gameTimeUtc}`);
    }
  }
}

async function main() {
  console.log("READ-ONLY :: three-way diff sc_homestand vs sc_day_metadata vs MLB API");
  console.log("            + Kevin's pattern check (AWAY-into-homestand-opener) + CIN 8/17 DH");

  const results = [];
  for (const acct of ACCOUNTS) {
    const r = await auditAccount(acct);
    results.push(r);
  }

  // Step 3 - pattern check per account.
  console.log(`\n\n============================================================`);
  console.log(`STEP 3 :: KEVIN'S PATTERN — AWAY dates immediately preceding a GAME (home) date`);
  console.log(`============================================================`);
  for (const r of results) {
    const predicted = predictPatternMissing(r.hs);
    console.log(`\n  ${r.acct.key}: ${predicted.length} such AWAY dates in 2026 regular season`);
    for (const p of predicted) {
      console.log(`    ${p.date} @ ${p.opp} -> next day ${p.next_home_date} home vs ${p.next_home_opp}`);
    }
  }

  await checkCinDoubleheader817(results);

  console.log(`\n\n============================================================`);
  console.log(`STEP 4 :: sc_day_metadata provenance snapshot (created_at / updated_by batches)`);
  console.log(`============================================================`);
  for (const r of results) {
    const acctKey = r.acct.key;
    // Group meta rows by created_at date to see load batches.
    const batches = new Map();
    for (const m of r.meta) {
      const key = (m.created_at || "").slice(0, 10);
      if (!batches.has(key)) batches.set(key, { count: 0, updatedBySet: new Set(), gameTypeSet: new Set() });
      const b = batches.get(key);
      b.count++;
      if (m.updated_by) b.updatedBySet.add(m.updated_by);
      if (m.game_type) b.gameTypeSet.add(m.game_type);
    }
    console.log(`\n  ${acctKey} :: sc_day_metadata created_at batches:`);
    for (const [k, b] of [...batches.entries()].sort()) {
      console.log(`    ${k || "(null)"}: ${b.count} rows, updated_by ∈ ${JSON.stringify([...b.updatedBySet])}, game_type ∈ ${JSON.stringify([...b.gameTypeSet])}`);
    }
    // Show one representative row shape (columns present).
    if (r.meta.length > 0) {
      console.log(`  ${acctKey} :: sample row keys: ${JSON.stringify(Object.keys(r.meta[0]))}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
