// READ-ONLY probe for Part 4 Step 1: resolve AAA + FSL team IDs by NAME
// (Kevin's ruling: no hardcoded sportIds).
//
// Target teams:
//   Louisville Bats       -> CIN - KY (AAA)
//   Buffalo Bisons        -> TBJ - NY (AAA)
//   Palm Beach Cardinals  -> STL - FL (FSL / Single-A)
//   Dunedin Blue Jays     -> TBJ - FL (FSL / Single-A)
//
// Approach: query the MLB Stats API teams endpoint at candidate sportIds
// (11 AAA, 12 AA, 13 High-A, 14 Low-A, 16 Winter). Pick the level that
// contains the target name for each affiliate.

const CANDIDATE_LEVELS = [
  { sportId: 11, label: "Triple-A" },
  { sportId: 12, label: "Double-A" },
  { sportId: 13, label: "High-A" },
  { sportId: 14, label: "Low-A" },
  { sportId: 15, label: "Rookie" },
  { sportId: 16, label: "Winter" },
];

const TARGETS = [
  { account: "CIN - KY", name: "Louisville Bats" },
  { account: "TBJ - NY", name: "Buffalo Bisons" },
  { account: "STL - FL", name: "Palm Beach Cardinals" },
  { account: "TBJ - FL", name: "Dunedin Blue Jays" },
];

async function fetchTeamsForLevel(sportId) {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/teams?sportId=${sportId}&season=2026`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.teams || [];
}

async function main() {
  console.log("READ-ONLY :: Part 4 Step 1 - resolve AAA + FSL team IDs by name");
  const levelToTeams = {};
  for (const lvl of CANDIDATE_LEVELS) {
    const teams = await fetchTeamsForLevel(lvl.sportId);
    levelToTeams[lvl.sportId] = teams;
    console.log(`  sportId=${lvl.sportId} (${lvl.label}): ${teams.length} teams`);
  }

  console.log(`\n=== target resolutions ===`);
  const resolved = [];
  for (const tgt of TARGETS) {
    let hit = null;
    for (const lvl of CANDIDATE_LEVELS) {
      const teams = levelToTeams[lvl.sportId];
      const t = teams.find((x) => (x.name || "").toLowerCase() === tgt.name.toLowerCase());
      if (t) {
        hit = { sportId: lvl.sportId, level: lvl.label, team: t };
        break;
      }
    }
    if (hit) {
      console.log(`  ${tgt.account.padEnd(10)} ${tgt.name.padEnd(24)} -> sportId=${hit.sportId} (${hit.level}) team_id=${hit.team.id} venue="${hit.team.venue?.name || ""}" league="${hit.team.league?.name || ""}"`);
      resolved.push({ account: tgt.account, name: tgt.name, sportId: hit.sportId, teamId: hit.team.id, league: hit.team.league?.name, venue: hit.team.venue?.name });
    } else {
      console.log(`  ${tgt.account.padEnd(10)} ${tgt.name.padEnd(24)} -> NOT FOUND across sportIds ${CANDIDATE_LEVELS.map(l => l.sportId).join(",")}`);
      resolved.push({ account: tgt.account, name: tgt.name, sportId: null, teamId: null });
    }
  }

  console.log(`\n=== JSON for downstream probes ===`);
  console.log(JSON.stringify(resolved, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
