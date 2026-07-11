// ════════════════════════════════════════════════════════════════════════════
// EXTRACT: MLB Stats API (sportId=11, AAA) -> SQL for Louisville + Buffalo
// schedule parity (HOME + AWAY, opponent + game_pk + game_time + day_night +
// is_doubleheader).
//
// Sources:
//   https://statsapi.mlb.com/api/v1/teams?sportId=11&season=2026
//   https://statsapi.mlb.com/api/v1/schedule?sportId=11&teamId=<id>&season=2026&gameType=R
//
// Reads:   the AAA teams roster (once, for id->abbreviation map) + 2 team
//          schedules (Louisville 416, Buffalo 422).
// Writes:  stdout - SQL block for INSERT INTO sc_homestand_schedule.
// Model:   sc-13 (AWAY inserts) + sc-15 (game_time/day_night backfill).
//
// SCHEDULE / PLAN FIELDS ONLY per Kevin's ruling.
//   - date + home + opponent + gamePk + gameDate + dayNight + doubleHeader
//   - NO scores, NO results, NO status.abstractGameState="Final"/"Live"
//   - A postponed game lives at its ORIGINAL date (shadow entry, not the
//     makeup). Same shadow-preferred derivation as sc-13.
//
// DH RULE (Kevin's ruling 2, MiLB schedule parity brief):
//   One row per (account, service_date) is inviolate. On a DH date:
//     - Take the FIRST game's game_time + day_night.
//     - Flag the row: is_doubleheader = true.
//   The second game's context is dropped from the row (accepted loss).
//
// TBD RULE (ruling 3):
//   Games with startTimeTBD=true still carry a gameDate (a provisional time).
//   Store as-is. Re-running this extractor after MiLB firms the times will
//   emit fresh SQL that UPDATEs game_time / day_night on those rows.
//
// USAGE
//   node scripts/_extract_milb_schedule.mjs > /tmp/sc-milb-schedule.sql
//
// Then paste the emitted block into the Task 2 migration file.
// ════════════════════════════════════════════════════════════════════════════

const SEASON = 2026;
const SCHEDULE = "https://statsapi.mlb.com/api/v1/schedule";
const TEAMS = "https://statsapi.mlb.com/api/v1/teams";

const CLUBS = [
  { mlbId: 416, name: "Louisville Bats",  accounts: ["CIN - KY"] },
  { mlbId: 422, name: "Buffalo Bisons",   accounts: ["TBJ - NY"] },
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

async function fetchAaaAbbrevMap() {
  const doc = await fetchJson(`${TEAMS}?sportId=11&season=${SEASON}`);
  const map = new Map();
  for (const t of doc.teams || []) {
    if (t.id != null) {
      const code = t.abbreviation || t.teamCode || t.fileCode || null;
      map.set(t.id, {
        code: code ? code.toUpperCase() : null,
        name: t.name || t.teamName || String(t.id),
      });
    }
  }
  return map;
}

// Shadow-preferred: if the same gamePk appears twice (a Postponed shadow at
// its original date AND a makeup at a later date), keep the ORIGINAL date.
// Drop makeup entries so they don't double-count a game.
function derivePlanOfRecord(doc, teamId) {
  const plans = new Map(); // pk -> { gamePk, bucketDate, isHome, opponentId, gameDate, dayNight, doubleHeader, gameNumber, source }
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

      const entry = {
        gamePk: pk,
        bucketDate,
        isHome,
        opponentId,
        gameDate: g.gameDate || null,          // ISO UTC first-pitch
        dayNight: g.dayNight || null,           // "day" | "night"
        doubleHeader: g.doubleHeader || "N",    // "N" | "Y" | "S"
        gameNumber: g.gameNumber || 1,          // 1 or 2 within a DH
        source,
      };

      const existing = plans.get(pk);
      if (existing) {
        // Shadow wins - carries the ORIGINAL date.
        if (source === "shadow") plans.set(pk, entry);
        continue;
      }
      plans.set(pk, entry);
    }
  }
  // Drop makeup entries (they double-count when the shadow is present).
  return [...plans.values()].filter((v) => v.source !== "makeup");
}

// Collapse per (account_key, service_date) - DH compression.
// Sort ascending by (bucketDate, gameNumber, gameDate) so the DH "first game"
// is the one we keep. Later entries in the same bucket just flip the
// is_doubleheader flag.
function collapseByDate(planEntries, accountKey) {
  const buckets = new Map(); // date -> row
  for (const p of planEntries) {
    const key = p.bucketDate;
    const gameNumber = p.gameNumber || 1;
    const gameDateIso = p.gameDate || "";
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        account_key: accountKey,
        service_date: key,
        isHome: p.isHome,
        opponentId: p.opponentId,
        gamePk: p.gamePk,
        gameDate: p.gameDate,
        dayNight: p.dayNight,
        gameNumber,
        doubleHeaderField: p.doubleHeader,
        countInBucket: 1,
      });
    } else {
      existing.countInBucket += 1;
      // If this entry is "earlier" (lower gameNumber, or same gameNumber but
      // earlier gameDate), replace the "first game" fields.
      const isEarlier =
        gameNumber < existing.gameNumber ||
        (gameNumber === existing.gameNumber && gameDateIso && gameDateIso < (existing.gameDate || ""));
      if (isEarlier) {
        existing.isHome = p.isHome;
        existing.opponentId = p.opponentId;
        existing.gamePk = p.gamePk;
        existing.gameDate = p.gameDate;
        existing.dayNight = p.dayNight;
        existing.gameNumber = gameNumber;
      }
      // Any bucket with the API's doubleHeader field set to Y or S is a DH,
      // regardless of ordering.
      if (p.doubleHeader && p.doubleHeader !== "N") {
        existing.doubleHeaderField = p.doubleHeader;
      }
    }
  }
  // Second pass: attach the is_doubleheader flag = (2+ games in bucket) OR
  // (API's doubleHeader field ∈ {Y,S}).
  return [...buckets.values()].map((r) => ({
    ...r,
    is_doubleheader: r.countInBucket > 1 || (r.doubleHeaderField && r.doubleHeaderField !== "N"),
  }));
}

function dayOfWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()];
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function nullOr(v, wrap = (x) => `'${sqlEscape(x)}'`) {
  return v == null || v === "" ? "NULL" : wrap(v);
}

async function main() {
  process.stderr.write(`Fetching AAA teams roster (sportId=11, season=${SEASON})...\n`);
  const abbrevMap = await fetchAaaAbbrevMap();
  process.stderr.write(`  ${abbrevMap.size} AAA teams cached.\n\n`);

  const homeRows = []; // GAME day_type
  const awayRows = []; // AWAY day_type
  const summary = {};

  for (const club of CLUBS) {
    process.stderr.write(`Fetching ${club.name} (id=${club.mlbId})...\n`);
    const doc = await fetchJson(`${SCHEDULE}?sportId=11&teamId=${club.mlbId}&season=${SEASON}&gameType=R`);
    const plans = derivePlanOfRecord(doc, club.mlbId);
    process.stderr.write(`  planned games (post shadow/makeup dedup): ${plans.length}\n`);

    for (const acct of club.accounts) {
      const collapsed = collapseByDate(plans, acct);
      const home = collapsed.filter((r) => r.isHome);
      const away = collapsed.filter((r) => !r.isHome);
      const dhFlagged = collapsed.filter((r) => r.is_doubleheader).length;
      const nightCount = home.filter((r) => r.dayNight === "night").length;
      const dayCount = home.filter((r) => r.dayNight === "day").length;
      summary[acct] = { home: home.length, away: away.length, dh: dhFlagged, night: nightCount, day: dayCount };

      for (const r of home) {
        const opp = abbrevMap.get(r.opponentId);
        if (!opp || !opp.code) {
          throw new Error(`Unknown opponent id=${r.opponentId} for ${club.name} (account=${acct}) - update AAA teams cache.`);
        }
        homeRows.push({
          account_key: acct,
          service_date: r.service_date,
          day_of_week: dayOfWeek(r.service_date),
          opponent: opp.code,
          game_pk: r.gamePk,
          game_time: r.gameDate,
          day_night: r.dayNight,
          is_doubleheader: !!r.is_doubleheader,
        });
      }
      for (const r of away) {
        const opp = abbrevMap.get(r.opponentId);
        if (!opp || !opp.code) {
          throw new Error(`Unknown opponent id=${r.opponentId} for ${club.name} (account=${acct}) - update AAA teams cache.`);
        }
        awayRows.push({
          account_key: acct,
          service_date: r.service_date,
          day_of_week: dayOfWeek(r.service_date),
          opponent: opp.code,
          game_pk: r.gamePk,
          is_doubleheader: !!r.is_doubleheader,
        });
      }
    }
  }

  process.stderr.write("\nSummary per account:\n");
  for (const [k, v] of Object.entries(summary)) {
    process.stderr.write(`  ${k}: home=${v.home} (day=${v.day}, night=${v.night}), away=${v.away}, dh_flagged=${v.dh}\n`);
  }
  process.stderr.write(`\nTotal HOME rows: ${homeRows.length}\n`);
  process.stderr.write(`Total AWAY rows: ${awayRows.length}\n\n`);

  // Guardrail: coverage on HOME rows (dayNight + gameDate) - matches
  // sc-15's guardrail for MLB. TBD-time rows still emit a game_time.
  const missingDayNight = homeRows.filter((r) => !r.day_night);
  const missingGameTime = homeRows.filter((r) => !r.game_time);
  if (missingDayNight.length > 0) {
    process.stderr.write(`WARN: ${missingDayNight.length} HOME rows have NULL day_night (spot-check):\n`);
    for (const r of missingDayNight.slice(0, 5)) process.stderr.write(`  ${r.account_key} ${r.service_date}\n`);
  }
  if (missingGameTime.length > 0) {
    process.stderr.write(`WARN: ${missingGameTime.length} HOME rows have NULL game_time (spot-check):\n`);
    for (const r of missingGameTime.slice(0, 5)) process.stderr.write(`  ${r.account_key} ${r.service_date}\n`);
  }

  // Emit SQL block.
  process.stdout.write("-- ─── Louisville + Buffalo schedule inserts (MLB Stats API AAA) ─────\n");
  process.stdout.write("-- Generated by scripts/_extract_milb_schedule.mjs\n");
  process.stdout.write(`-- Season: ${SEASON}. Source: ${SCHEDULE}\n`);
  process.stdout.write(`-- Extracted: ${new Date().toISOString()}\n`);
  process.stdout.write("-- Row counts (per account):\n");
  for (const [k, v] of Object.entries(summary)) {
    process.stdout.write(`--   ${k}: home=${v.home} (day=${v.day}, night=${v.night}), away=${v.away}, dh_flagged=${v.dh}\n`);
  }
  process.stdout.write("-- Idempotent via ON CONFLICT DO UPDATE below; safe to re-run for TBD firm-up.\n");
  process.stdout.write("-- DH compression per ruling 2: one row per (account, date); first game's\n");
  process.stdout.write("-- game_time + day_night retained; is_doubleheader = true on the row.\n\n");

  // (1) HOME inserts.
  process.stdout.write("-- ── (1) HOME rows (day_type='GAME') ────────────────────────────────\n");
  process.stdout.write("INSERT INTO sc_homestand_schedule\n");
  process.stdout.write("  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk, game_time, day_night, is_doubleheader)\n");
  process.stdout.write("VALUES\n");
  const homeLines = homeRows.map((r, i) => {
    const comma = i < homeRows.length - 1 ? "," : "";
    const gt = r.game_time ? `'${r.game_time}'` : "NULL";
    const dn = r.day_night ? `'${r.day_night}'` : "NULL";
    return `  ('${sqlEscape(r.account_key)}', '${r.service_date}', '${r.day_of_week}', 'GAME', '${r.opponent}', NULL, ${r.game_pk}, ${gt}, ${dn}, ${r.is_doubleheader ? "true" : "false"})${comma}`;
  });
  process.stdout.write(homeLines.join("\n") + "\n");
  process.stdout.write("ON CONFLICT (account_key, service_date) DO UPDATE\n");
  process.stdout.write("  SET day_type        = EXCLUDED.day_type,\n");
  process.stdout.write("      opponent        = EXCLUDED.opponent,\n");
  process.stdout.write("      game_pk         = EXCLUDED.game_pk,\n");
  process.stdout.write("      game_time       = EXCLUDED.game_time,\n");
  process.stdout.write("      day_night       = EXCLUDED.day_night,\n");
  process.stdout.write("      day_of_week     = EXCLUDED.day_of_week,\n");
  process.stdout.write("      is_doubleheader = EXCLUDED.is_doubleheader\n");
  process.stdout.write("  WHERE sc_homestand_schedule.day_type = 'GAME';\n");
  process.stdout.write("-- ON CONFLICT strategy: only re-update rows the loader already owns\n");
  process.stdout.write("-- (day_type = 'GAME'). Same guard as sc-13 AWAY re-runs.\n\n");

  // (2) AWAY inserts.
  process.stdout.write("-- ── (2) AWAY rows (day_type='AWAY') ────────────────────────────────\n");
  process.stdout.write("-- day_night + game_time stay NULL on AWAY per sc-15 convention.\n");
  process.stdout.write("INSERT INTO sc_homestand_schedule\n");
  process.stdout.write("  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk, is_doubleheader)\n");
  process.stdout.write("VALUES\n");
  const awayLines = awayRows.map((r, i) => {
    const comma = i < awayRows.length - 1 ? "," : "";
    return `  ('${sqlEscape(r.account_key)}', '${r.service_date}', '${r.day_of_week}', 'AWAY', '${r.opponent}', NULL, ${r.game_pk}, ${r.is_doubleheader ? "true" : "false"})${comma}`;
  });
  process.stdout.write(awayLines.join("\n") + "\n");
  process.stdout.write("ON CONFLICT (account_key, service_date) DO UPDATE\n");
  process.stdout.write("  SET day_type        = EXCLUDED.day_type,\n");
  process.stdout.write("      opponent        = EXCLUDED.opponent,\n");
  process.stdout.write("      game_pk         = EXCLUDED.game_pk,\n");
  process.stdout.write("      day_of_week     = EXCLUDED.day_of_week,\n");
  process.stdout.write("      is_doubleheader = EXCLUDED.is_doubleheader\n");
  process.stdout.write("  WHERE sc_homestand_schedule.day_type = 'AWAY';\n");
  process.stdout.write("-- Same ON CONFLICT posture as HOME - only touches AWAY rows on re-run.\n");
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`);
  process.exit(1);
});
