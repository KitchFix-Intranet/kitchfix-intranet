// scripts/probes/_probe_kpi_hs_daily_coverage.mjs
//
// HS FB1 PR-1 probe (owner ruling 2026-08-24, defect 1b): the
// homestand view ALWAYS needs day-level data because the day strip
// is the point. Owner reproducer: HS 9 STL - MO (window 06/29 -
// 07/12 = 2 whole fiscal weeks) routed weekly, shipped 0 daily
// rows, blanked the strip.
//
// This probe asserts, across ALL four homestand accounts, that
// every non-pre-floor stand's window has at least one row in
// labor_actuals_daily. If a stand comes back empty here, the
// daily strip would be blank on the client - same class as HS 9.
//
// Reports the offenders by (account, HS N, window). Runs against
// Supabase directly; no dev server required.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const HOMESTAND_ACCOUNTS = ["CIN - OH", "STL - MO", "TXR - TX - H", "TBJ - FL"];
const DAILY_FLOOR = "2026-04-20";

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }

console.log("=".repeat(72));
console.log("KPI homestand daily-coverage probe (HS FB1 PR-1 defect 1b)");
console.log("=".repeat(72));

async function fetchStands(account) {
  const q = await supa.from("sc_homestand_schedule")
    .select("service_date, day_type, opponent, homestand_id")
    .eq("account_key", account)
    .eq("day_type", "GAME")
    .gte("service_date", "2025-12-29")
    .lte("service_date", "2026-12-27")
    .order("service_date");
  if (q.error) throw new Error(`schedule read (${account}): ${q.error.message}`);
  // Group into stands: consecutive game runs share a stand.
  const games = q.data || [];
  const stands = [];
  let cur = null;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!cur) { cur = { games: [g] }; continue; }
    const prev = cur.games[cur.games.length - 1];
    const prevDay = new Date(`${prev.service_date}T00:00:00.000Z`);
    const gDay = new Date(`${g.service_date}T00:00:00.000Z`);
    const gap = (gDay.getTime() - prevDay.getTime()) / 86400000;
    if (gap <= 1) { cur.games.push(g); continue; }
    stands.push(cur);
    cur = { games: [g] };
  }
  if (cur) stands.push(cur);
  return stands.map((s, i) => {
    const first = s.games[0].service_date;
    const last = s.games[s.games.length - 1].service_date;
    // window_start = day-before-first-game (prep day)
    const prevDay = new Date(`${first}T00:00:00.000Z`);
    prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    const windowStart = prevDay.toISOString().slice(0, 10);
    return {
      index: i + 1,
      opponent: s.games[0].opponent || "(no opp)",
      game_start: first,
      game_end: last,
      window_start: windowStart,
      window_end: last,
      pre_floor: last < DAILY_FLOOR,
    };
  });
}

async function checkAccount(account) {
  console.log("");
  console.log(`[${account}]`);
  const stands = await fetchStands(account);
  const eligible = stands.filter(s => !s.pre_floor);
  ok(`resolved ${stands.length} stand(s); ${eligible.length} post-floor to check`);
  for (const s of eligible) {
    const q = await supa.from("labor_actuals_daily")
      .select("work_date", { count: "exact", head: true })
      .eq("account_key", account)
      .gte("work_date", s.window_start)
      .lte("work_date", s.window_end);
    if (q.error) { fail(`HS ${s.index} ${s.opponent} (${s.window_start}..${s.window_end}): query error ${q.error.message}`); continue; }
    const rows = q.count ?? 0;
    if (rows > 0) ok(`HS ${s.index} ${s.opponent}: ${rows} daily rows in ${s.window_start}..${s.window_end}`);
    else {
      // Only fail on stands whose game_end has already passed - a
      // fully-future stand legitimately has 0 daily rows because
      // the games have not been played. The concern is played
      // stands with no strip data (Kevin's HS 9 case).
      const today = new Date().toISOString().slice(0, 10);
      const played = s.game_end < today;
      if (played) fail(`HS ${s.index} ${s.opponent} (${s.window_start}..${s.window_end}): 0 daily rows on a PLAYED stand - the day strip would blank`);
      else ok(`HS ${s.index} ${s.opponent}: 0 daily rows on a FUTURE stand (expected - games not yet played)`);
    }
  }
}

for (const account of HOMESTAND_ACCOUNTS) {
  try { await checkAccount(account); }
  catch (e) { fail(`${account}: ${e.message}`); }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "HS DAILY COVERAGE: ALL PLAYED STANDS HAVE DAILY DATA" : `HS DAILY COVERAGE: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
