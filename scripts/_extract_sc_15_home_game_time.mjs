// ════════════════════════════════════════════════════════════════════════════
// EXTRACT: MLB Stats API -> UPDATE block for the sc-15 HOME game_time
// + day_night backfill.
//
// Source:  https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2026
// Reads:   3 team schedules (Reds 113, Cardinals 138, Rangers 140)
// Writes:  stdout - SQL block Kevin pastes into
//          docs/migrations/sc-15-home-game-time.sql at the marked
//          placeholder.
//
// SCHEDULE / PLAN FIELDS ONLY per Kevin's ruling.
//   - `gameDate` (ISO UTC first-pitch)
//   - `dayNight` ("day" | "night") - the API's own designation, 100%
//     populated per the sc-15 Task 1 investigation (81/81 across all
//     three teams).
//   - NO scores, NO results, NO status.abstractGameState.
//
// Postponement handling: same shadow-preferred rule as sc-13. If a
// game was PPD'd, the shadow entry at its ORIGINAL date carries the
// game's ORIGINAL first-pitch time + dayNight. Prefer that over the
// makeup entry (which reflects the post-hoc reschedule).
//
// USAGE
//   node scripts/_extract_sc_15_home_game_time.mjs > /tmp/sc-15-backfill.sql
//
// Emitted block is a temp-table + guarded UPDATE (same pattern as
// sc-13's HOME game_pk backfill). Idempotent - re-runnable.
// ════════════════════════════════════════════════════════════════════════════

const SEASON = 2026;
const BASE = "https://statsapi.mlb.com/api/v1/schedule";

const TEAMS = [
  { mlbId: 113, name: "Cincinnati Reds",     accounts: ["CIN - OH"] },
  { mlbId: 138, name: "St. Louis Cardinals", accounts: ["STL - MO"] },
  { mlbId: 140, name: "Texas Rangers",       accounts: ["TXR - TX - H", "TXR - TX - V"] },
];

async function fetchSchedule(teamId) {
  const url = `${BASE}?sportId=1&season=${SEASON}&teamId=${teamId}&gameType=R`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

// Same shadow-preferred derivation the sc-13 extractor used. For each
// gamePk, take the shadow entry (status=Postponed) if present, so the
// row's date and first-pitch reflect the ORIGINAL plan, not the makeup.
function derivePlanOfRecord(doc, teamId) {
  const plans = new Map();
  for (const d of doc.dates || []) {
    const bucketDate = d.date;
    for (const g of d.games || []) {
      const pk = g.gamePk;
      const isHome = g.teams.home.team.id === teamId;
      const desc = g.description || "";
      const isShadow = g.status && g.status.detailedState === "Postponed";
      const isMakeup = desc.includes("Makeup");
      const source = isShadow ? "shadow" : (isMakeup ? "makeup" : "as-scheduled");
      const entry = {
        gamePk: pk,
        date: bucketDate,
        isHome,
        gameDate: g.gameDate,          // ISO UTC first-pitch
        dayNight: g.dayNight,          // "day" | "night" per API
        source,
      };
      const existing = plans.get(pk);
      if (existing) {
        if (source === "shadow") plans.set(pk, entry);
        continue;
      }
      plans.set(pk, entry);
    }
  }
  const out = [];
  for (const [, v] of plans.entries()) {
    if (v.source === "makeup") continue;
    out.push(v);
  }
  return out;
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

async function main() {
  const homeRows = [];  // { account_key, service_date, game_pk, game_time, day_night }
  const summary = {};

  for (const team of TEAMS) {
    process.stderr.write(`Fetching ${team.name} (id=${team.mlbId})...\n`);
    const doc = await fetchSchedule(team.mlbId);
    const plans = derivePlanOfRecord(doc, team.mlbId);
    const home = plans.filter((p) => p.isHome);
    process.stderr.write(`  home planned games: ${home.length}\n`);

    for (const acct of team.accounts) {
      const dayNightDist = { day: 0, night: 0, unknown: 0 };
      for (const p of home) {
        if (!p.dayNight) throw new Error(`gamePk ${p.gamePk} missing dayNight - update script to handle`);
        if (!p.gameDate)  throw new Error(`gamePk ${p.gamePk} missing gameDate - update script to handle`);
        if (p.dayNight !== "day" && p.dayNight !== "night") {
          throw new Error(`gamePk ${p.gamePk} has unexpected dayNight=${p.dayNight}`);
        }
        dayNightDist[p.dayNight]++;
        homeRows.push({
          account_key: acct,
          service_date: p.date,
          game_pk: p.gamePk,
          game_time: p.gameDate,
          day_night: p.dayNight,
        });
      }
      summary[acct] = dayNightDist;
    }
  }

  process.stderr.write("\nDay/night distribution per account:\n");
  for (const [k, v] of Object.entries(summary)) {
    process.stderr.write(`  ${k}: day=${v.day}, night=${v.night} (total ${v.day + v.night})\n`);
  }
  process.stderr.write(`\nTotal HOME backfill rows: ${homeRows.length}\n`);

  // Emit SQL block. Uses the same temp-table + guarded UPDATE pattern
  // as sc-13's HOME game_pk backfill.
  process.stdout.write("-- ─── HOME game_time + day_night backfill ──────────────────────────\n");
  process.stdout.write("-- Generated by scripts/_extract_sc_15_home_game_time.mjs\n");
  process.stdout.write(`-- Season: ${SEASON}. Source: ${BASE}\n`);
  process.stdout.write(`-- Extracted: ${new Date().toISOString()}\n`);
  process.stdout.write(`-- Row counts (per account): ${Object.entries(summary).map(([k,v]) => `${k}=${v.day + v.night}`).join(", ")}\n\n`);

  process.stdout.write("CREATE TEMP TABLE tmp_sc15_home_daynight (\n");
  process.stdout.write("  account_key  TEXT NOT NULL,\n");
  process.stdout.write("  service_date DATE NOT NULL,\n");
  process.stdout.write("  game_time    TIMESTAMPTZ NOT NULL,\n");
  process.stdout.write("  day_night    TEXT NOT NULL\n");
  process.stdout.write(") ON COMMIT DROP;\n\n");

  process.stdout.write("INSERT INTO tmp_sc15_home_daynight\n");
  process.stdout.write("  (account_key, service_date, game_time, day_night) VALUES\n");
  const lines = homeRows.map((r, i) => {
    const comma = i < homeRows.length - 1 ? "," : "";
    return `  ('${sqlEscape(r.account_key)}', '${r.service_date}', '${r.game_time}', '${r.day_night}')${comma}`;
  });
  process.stdout.write(lines.join("\n") + ";\n\n");

  process.stdout.write("UPDATE sc_homestand_schedule s\n");
  process.stdout.write("   SET game_time = t.game_time,\n");
  process.stdout.write("       day_night = t.day_night\n");
  process.stdout.write("  FROM tmp_sc15_home_daynight t\n");
  process.stdout.write(" WHERE s.account_key  = t.account_key\n");
  process.stdout.write("   AND s.service_date = t.service_date\n");
  process.stdout.write("   AND s.day_type     = 'GAME';\n");
  process.stdout.write("-- WHERE day_type='GAME' guard: never touches AWAY/EXHIBITION/etc.\n");
  process.stdout.write("-- Idempotent: re-running sets the same values.\n");
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`);
  process.exit(1);
});
