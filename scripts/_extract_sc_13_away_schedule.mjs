// ════════════════════════════════════════════════════════════════════════════
// EXTRACT: MLB Stats API -> INSERT rows for the sc-13 AWAY-schedule migration.
//
// Source:  https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2026
// Reads:   3 team schedules (Reds 113, Cardinals 138, Rangers 140)
// Writes:  stdout - SQL INSERT block Kevin pastes into
//          docs/migrations/sc-13-away-schedule-load.sql
//
// SCHEDULE / PLAN FIELDS ONLY per Kevin's ruling.
//   - date + home team + away team + venue + scheduled time + gamePk
//   - NO scores, NO results, NO status.abstractGameState="Final"/"Live"
//   - A postponed game lives at its ORIGINAL date (shadow entry, not the
//     makeup), per the sc-13 feasibility investigation's derivation.
//
// USAGE
//   node scripts/_extract_sc_13_away_schedule.mjs > /tmp/sc-13-away.sql
//
// Then paste the emitted INSERT block into
// docs/migrations/sc-13-away-schedule-load.sql at the marked placeholder.
//
// The API is public, no auth, no rate limit expected at this volume
// (3 requests). Verified stable + validating against sc-12 in
// docs/audits/SC_13_MLB_API_FEASIBILITY_2026-07-10.md.
// ════════════════════════════════════════════════════════════════════════════

const SEASON = 2026;
const BASE = "https://statsapi.mlb.com/api/v1/schedule";

// Team -> the 1 or 2 KitchFix accounts that share its schedule.
// TXR H and V are the SAME club (Rangers home clubhouse + visiting clubhouse
// both serve the same home stadium and follow the same 81/81 schedule
// per Q-d ruling).
const TEAMS = [
  { mlbId: 113, name: "Cincinnati Reds",     accounts: ["CIN - OH"] },
  { mlbId: 138, name: "St. Louis Cardinals", accounts: ["STL - MO"] },
  { mlbId: 140, name: "Texas Rangers",       accounts: ["TXR - TX - H", "TXR - TX - V"] },
];

// MLB team_id -> DB canonical opponent code.
// Verified against docs/audits/SC_13_MLB_API_FEASIBILITY_2026-07-10.md
// which cross-checked opponent codes vs the /tmp/sc-audit/hs_dump.csv
// distribution (sc-12 R6 normalization: ARI not AZ, ATH not OAK).
const OPPONENT_CODE = {
  108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN",
  114: "CLE", 115: "COL", 116: "DET", 117: "HOU", 118: "KC",  119: "LAD",
  120: "WSH", 121: "NYM", 133: "ATH", 134: "PIT", 135: "SD",  136: "SEA",
  137: "SF",  138: "STL", 139: "TB",  140: "TEX", 141: "TOR", 142: "MIN",
  143: "PHI", 144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
};

async function fetchSchedule(teamId) {
  const url = `${BASE}?sportId=1&season=${SEASON}&teamId=${teamId}&gameType=R`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

// Extract the PLANNED away slate for this team.
//
// Postponement handling (from the feasibility investigation):
//   - Every gamePk appears at least once. If a game got PPD'd, it appears
//     TWICE: a "shadow" at the original date bucket with
//     status.detailedState='Postponed', and a "makeup" at the new date
//     with description starting "Makeup of ...".
//   - We want the ORIGINAL planned date. Shadow wins over makeup.
//   - Drop makeup entries (they double-count).
function derivePlanOfRecord(doc, teamId) {
  // gamePk -> {bucket_date, is_home, opponent_id, source}
  const plans = new Map();
  for (const d of doc.dates || []) {
    const bucketDate = d.date;
    for (const g of d.games || []) {
      const pk = g.gamePk;
      const isHome = g.teams.home.team.id === teamId;
      const opponentId = isHome ? g.teams.away.team.id : g.teams.home.team.id;
      const desc = g.description || "";
      const isShadow = g.status && g.status.detailedState === "Postponed";
      const isMakeup = desc.includes("Makeup");
      const source = isShadow ? "shadow" : (isMakeup ? "makeup" : "as-scheduled");
      const existing = plans.get(pk);
      if (existing) {
        // Shadow wins - it carries the ORIGINAL date.
        if (source === "shadow") {
          plans.set(pk, { bucketDate, isHome, opponentId, source });
        }
        continue;
      }
      plans.set(pk, { bucketDate, isHome, opponentId, source });
    }
  }
  // Drop makeup entries; keep shadow + as-scheduled.
  const out = [];
  for (const [pk, v] of plans.entries()) {
    if (v.source === "makeup") continue;
    out.push({ gamePk: pk, date: v.bucketDate, isHome: v.isHome, opponentId: v.opponentId });
  }
  return out;
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function opponentCode(opponentId, teamId, teamName) {
  const code = OPPONENT_CODE[opponentId];
  if (!code) {
    throw new Error(
      `Unknown MLB team_id=${opponentId} while processing ${teamName} (id=${teamId}). ` +
      `Update OPPONENT_CODE map in this script.`
    );
  }
  return code;
}

async function main() {
  const awayRows = [];  // { account_key, service_date, day_of_week, opponent, game_pk }
  const homeUpdates = [];  // { account_key, service_date, game_pk } - backfills game_pk on existing HOME rows
  const summary = {};

  for (const team of TEAMS) {
    process.stderr.write(`Fetching ${team.name} (id=${team.mlbId})...\n`);
    const doc = await fetchSchedule(team.mlbId);
    const plans = derivePlanOfRecord(doc, team.mlbId);
    const home = plans.filter((p) => p.isHome);
    const away = plans.filter((p) => !p.isHome);
    process.stderr.write(`  planned games: ${plans.length} (${home.length} home / ${away.length} away)\n`);

    for (const acct of team.accounts) {
      summary[acct] = { home: home.length, away: away.length };
      for (const p of away) {
        const code = opponentCode(p.opponentId, team.mlbId, team.name);
        const d = new Date(p.date + "T12:00:00Z");
        const dow = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()];
        awayRows.push({
          account_key: acct,
          service_date: p.date,
          day_of_week: dow,
          opponent: code,
          game_pk: p.gamePk,
        });
      }
      for (const p of home) {
        homeUpdates.push({
          account_key: acct,
          service_date: p.date,
          game_pk: p.gamePk,
        });
      }
    }
  }

  process.stderr.write("\nAway rows per account:\n");
  for (const [k, v] of Object.entries(summary)) {
    process.stderr.write(`  ${k}: home=${v.home}, away=${v.away}\n`);
  }
  process.stderr.write(`\nTotal AWAY rows emitted: ${awayRows.length}\n`);
  process.stderr.write(`Total HOME game_pk backfills emitted: ${homeUpdates.length}\n`);

  // Emit SQL block.
  process.stdout.write("-- ─── AWAY rows + HOME game_pk backfill ─────────────────────────────\n");
  process.stdout.write("-- Generated by scripts/_extract_sc_13_away_schedule.mjs\n");
  process.stdout.write(`-- Season: ${SEASON}. Source: ${BASE}\n`);
  process.stdout.write(`-- Extracted: ${new Date().toISOString()}\n`);
  process.stdout.write(`-- Row counts (per account, away): ${Object.entries(summary).map(([k,v]) => `${k}=${v.away}`).join(", ")}\n`);
  process.stdout.write("-- Idempotent via ON CONFLICT + guarded UPDATE below; safe to re-run.\n\n");

  // 1. AWAY inserts.
  process.stdout.write("-- ── (1) AWAY inserts ──────────────────────────────────────────────\n");
  process.stdout.write("INSERT INTO sc_homestand_schedule\n");
  process.stdout.write("  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk)\n");
  process.stdout.write("VALUES\n");
  const awayLines = awayRows.map((r, i) => {
    const comma = i < awayRows.length - 1 ? "," : "";
    return `  ('${sqlEscape(r.account_key)}', '${r.service_date}', '${r.day_of_week}', 'AWAY', '${r.opponent}', NULL, ${r.game_pk})${comma}`;
  });
  process.stdout.write(awayLines.join("\n") + "\n");
  process.stdout.write("ON CONFLICT (account_key, service_date) DO UPDATE\n");
  process.stdout.write("  SET day_type    = EXCLUDED.day_type,\n");
  process.stdout.write("      opponent    = EXCLUDED.opponent,\n");
  process.stdout.write("      game_pk     = EXCLUDED.game_pk,\n");
  process.stdout.write("      day_of_week = EXCLUDED.day_of_week\n");
  process.stdout.write("  WHERE sc_homestand_schedule.day_type = 'AWAY';\n");
  process.stdout.write("-- ON CONFLICT strategy:\n");
  process.stdout.write("--   Non-AWAY existing rows (GAME/PREP/OPEN/CLOSE/EXHIBITION) are PRESERVED\n");
  process.stdout.write("--   because the WHERE clause on the UPDATE only fires when target row is\n");
  process.stdout.write("--   already AWAY. A same-date collision against an existing PREP/CLOSE row\n");
  process.stdout.write("--   is a NO-OP (existing row wins). Kevin's PR body enumerates the ~35\n");
  process.stdout.write("--   PREP/CLOSE conflicts flagged for his review.\n");
  process.stdout.write("--   Re-running the migration self-heals AWAY-vs-AWAY (updates opponent / game_pk).\n\n");

  // 2. HOME game_pk backfill.
  process.stdout.write("-- ── (2) HOME game_pk backfill ─────────────────────────────────────\n");
  process.stdout.write("-- Populates game_pk on existing HOME (day_type='GAME') rows only.\n");
  process.stdout.write("-- Never touches day_type or opponent - HOME rows were reconciled via\n");
  process.stdout.write("-- sc-12 PDF-as-truth and stay authoritative. This block is additive.\n");
  process.stdout.write("-- Uses a temp table to avoid a 324-row VALUES-list UPDATE that hits\n");
  process.stdout.write("-- PostgreSQL's parameter binding awkwardly.\n\n");
  process.stdout.write("CREATE TEMP TABLE tmp_sc13_home_gamepk (\n");
  process.stdout.write("  account_key  TEXT NOT NULL,\n");
  process.stdout.write("  service_date DATE NOT NULL,\n");
  process.stdout.write("  game_pk      BIGINT NOT NULL\n");
  process.stdout.write(") ON COMMIT DROP;\n\n");
  process.stdout.write("INSERT INTO tmp_sc13_home_gamepk (account_key, service_date, game_pk) VALUES\n");
  const homeLines = homeUpdates.map((r, i) => {
    const comma = i < homeUpdates.length - 1 ? "," : "";
    return `  ('${sqlEscape(r.account_key)}', '${r.service_date}', ${r.game_pk})${comma}`;
  });
  process.stdout.write(homeLines.join("\n") + ";\n\n");
  process.stdout.write("UPDATE sc_homestand_schedule s\n");
  process.stdout.write("   SET game_pk = t.game_pk\n");
  process.stdout.write("  FROM tmp_sc13_home_gamepk t\n");
  process.stdout.write(" WHERE s.account_key  = t.account_key\n");
  process.stdout.write("   AND s.service_date = t.service_date\n");
  process.stdout.write("   AND s.day_type     = 'GAME';\n");
  process.stdout.write("-- WHERE day_type='GAME' guard: never touches PREP/OPEN/CLOSE/EXHIBITION/AWAY.\n");
  process.stdout.write("-- Idempotent: re-running sets the same value.\n");
  process.stdout.write("-- Dates in tmp_sc13_home_gamepk that don't match an existing HOME row are\n");
  process.stdout.write("-- silently skipped (post-sc-12 all 81 should match; the CIN R3 flip landed\n");
  process.stdout.write("-- there, and API-vs-DB reconciled with 0 opponent mismatches).\n");
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`);
  process.exit(1);
});
