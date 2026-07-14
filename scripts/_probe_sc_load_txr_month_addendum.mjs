// READ-ONLY probe for Part 2 addendum.
//
// Call the exact server-side sc-load path (loadMonthData + loadHomestandContext)
// for TXR - TX - H with the client's literal month key format for July 2026
// and April 2026 (control).
//
// Isolation intent:
//   - July -> DET/LAA/HOU/CWS/SEA  => server is innocent; defect is client-side
//                                     state / cache / request-param (candidates 1-3).
//   - July -> CIN/SEA/LAD/ATH/NYY  => server-side param->bounds or dataStore
//                                     month resolution bug (candidate 4-ish).
//   - Also prints the exact monthCache key strings the client composes at
//     ServiceCalendar.js:335 for April and July on this account so we can eyeball
//     collision or missing-month bugs (mk = `${year}-${String(month+1).padStart(2,"0")}`).
//
// Zero writes. No branch touches.

import { createClient } from "@supabase/supabase-js";

// The two functions live in src/lib/dataStore/serviceCalendar.js. We can't import
// them directly (Next path aliases, module resolution). Re-implement the minimal
// query the route hits, so we probe the SAME table + same range math.
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCT = "TXR - TX - H";
const YEAR = 2026;

// Replicate route.js:418-420 range math exactly.
function monthBounds(year, month /* 1-indexed */) {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

// Replicate ServiceCalendar.js:507 mk composition. month is 0-indexed local state.
function clientMonthKey(year, monthZeroIndexed) {
  return `${year}-${String(monthZeroIndexed + 1).padStart(2, "0")}`;
}

// Replicate loadHomestandContext(accountKey, first, last) from
// src/lib/dataStore/serviceCalendar.js. Same SELECT + range filter.
async function loadHomestandContext(accountKey, first, last) {
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, homestand_id, day_type, opponent, day_night, game_time, is_doubleheader")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .order("service_date", { ascending: true });
  if (error) throw new Error(error.message);
  const map = {};
  for (const r of data) {
    map[r.service_date] = {
      homestandId: r.homestand_id,
      dayType: r.day_type,
      opponent: r.opponent,
      dayNight: r.day_night,
      gameTime: r.game_time,
      isDoubleheader: r.is_doubleheader,
    };
  }
  return map;
}

// Replicate the sc_day_metadata slice that transformDays feeds into day.meta.
// gameType is what aggregateWorkspaceMetrics counts (isGameDay = !!day.meta?.gameType).
async function loadDayMeta(accountKey, first, last) {
  const { data, error } = await supa
    .from("sc_daily_revenue")
    .select("service_date, game_type")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .order("service_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

function fingerprint(homestandMap) {
  const dates = Object.keys(homestandMap).sort();
  return dates.map((d) => {
    const r = homestandMap[d];
    return { date: d, day_type: r.dayType, opponent: r.opponent, game_time: r.gameTime };
  });
}

async function probeMonth(monthOneIndexed, label) {
  const { first, last } = monthBounds(YEAR, monthOneIndexed);
  console.log(`\n=== SC-LOAD PROBE :: ${ACCT} :: ${label} (${YEAR}-${String(monthOneIndexed).padStart(2,"0")}) ===`);
  console.log(`  route.js month bounds: first=${first} last=${last}`);
  console.log(`  client monthCache key (ServiceCalendar.js:335 mk): "${clientMonthKey(YEAR, monthOneIndexed - 1)}"`);
  console.log(`  URL monthKey      : "${YEAR}-${String(monthOneIndexed).padStart(2, "0")}"`);
  console.log(`  keys match?       : ${clientMonthKey(YEAR, monthOneIndexed - 1) === `${YEAR}-${String(monthOneIndexed).padStart(2, "0")}`}`);
  const map = await loadHomestandContext(ACCT, first, last);
  const rows = fingerprint(map);
  console.log(`  homestandMap row count: ${rows.length}`);
  console.log(`  --- rows (date | day_type | opponent | game_time UTC) ---`);
  for (const r of rows) {
    console.log(`  ${r.date} | ${(r.day_type || "").padEnd(10)} | ${(r.opponent || "").padEnd(4)} | ${r.game_time || "(null)"}`);
  }
  const gameOpps = rows.filter((r) => r.day_type === "GAME").map((r) => r.opponent);
  console.log(`  GAME opponents (in service_date order): ${JSON.stringify(gameOpps)}`);
  const meta = await loadDayMeta(ACCT, first, last);
  const gameTypeDist = meta.reduce((acc, r) => { acc[r.game_type || "null"] = (acc[r.game_type || "null"] || 0) + 1; return acc; }, {});
  console.log(`  sc_daily_revenue.game_type distribution for month: ${JSON.stringify(gameTypeDist)}`);
  return { first, last, rows, gameOpps };
}

// sc-year-summary path: loadYearSummary reads homestandMap for the WHOLE year
// then merges per-day. Verify that per-day opponent chips are correctly scoped
// to their own service_date - no cross-month contamination.
async function probeYearSummaryOpponents() {
  const { first: yFirst, last: yLast } = { first: `${YEAR}-01-01`, last: `${YEAR}-12-31` };
  console.log(`\n=== YEAR-SUMMARY PROBE :: ${ACCT} :: full ${YEAR} homestandMap slice per month ===`);
  const map = await loadHomestandContext(ACCT, yFirst, yLast);
  const byMonth = new Map();
  for (const [date, r] of Object.entries(map)) {
    const mk = date.slice(0, 7);
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push({ date, day_type: r.dayType, opponent: r.opponent });
  }
  for (const [mk, arr] of [...byMonth.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    const games = arr.filter(r => r.day_type === "GAME").map(r => r.opponent);
    console.log(`  ${mk} :: ${arr.length} rows, GAME opponents = ${JSON.stringify(games)}`);
  }
  console.log(`  If July's GAME row set is [DET,DET,DET,LAA,LAA,LAA,HOU,HOU,HOU,CWS,CWS,CWS,SEA,SEA,SEA,SEA],`);
  console.log(`  then the year-summary path returns July correctly and the SeasonShell MonthCard for July`);
  console.log(`  should show July's slate. If Kevin sees April data on the JULY MonthCard, the bug is downstream`);
  console.log(`  of loadYearSummary in the SeasonShell/MonthCard month-picking layer.`);
}

async function main() {
  console.log("READ-ONLY probe :: sc-load server-side path for TXR - TX - H");
  console.log("Fires the same table + same range math as route.js:396-433.");
  console.log("Client key composition test replicates ServiceCalendar.js:507 exactly.");

  const july = await probeMonth(7, "JULY");
  const april = await probeMonth(4, "APRIL (control)");

  console.log("\n=== VERDICT ===");
  const julyIsAprilShape = JSON.stringify(july.gameOpps) === JSON.stringify(april.gameOpps);
  const julyExpected = ["DET", "DET", "DET", "LAA", "LAA", "LAA", "HOU", "HOU", "HOU", "CWS", "CWS", "CWS", "SEA", "SEA", "SEA", "SEA"];
  const julyMatchesExpected = JSON.stringify(july.gameOpps) === JSON.stringify(julyExpected);
  console.log(`  July server-response opponents match Kevin's expected DET/LAA/HOU/CWS/SEA slate? ${julyMatchesExpected}`);
  console.log(`  July server-response == April server-response? ${julyIsAprilShape}`);
  if (julyMatchesExpected) {
    console.log(`  SERVER IS INNOCENT. Defect is client-side. Continue diagnosis on candidates 1-3.`);
  } else if (julyIsAprilShape) {
    console.log(`  SERVER RETURNS APRIL FOR JULY. Bug is in the request-parameter construction or dataStore month resolution. Candidate 4 (server-side).`);
  } else {
    console.log(`  UNEXPECTED SHAPE. Investigate.`);
  }

  await probeYearSummaryOpponents();

  console.log("\n=== monthCache key collision check ===");
  const aprKey = clientMonthKey(YEAR, 3); // month state = 3 for April (0-indexed)
  const julKey = clientMonthKey(YEAR, 6); // month state = 6 for July
  console.log(`  April client mk (month=3, 0-indexed): "${aprKey}"`);
  console.log(`  July  client mk (month=6, 0-indexed): "${julKey}"`);
  console.log(`  Keys distinct? ${aprKey !== julKey}`);
  console.log(`  Contain month?  Apr="${aprKey}" Jul="${julKey}" - both have month number in key`);
}

main().catch((e) => { console.error(e); process.exit(1); });
