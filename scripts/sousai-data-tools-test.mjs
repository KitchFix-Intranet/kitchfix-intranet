#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-data-tools-test.mjs
// Phase F PR 1 · CLI probe for the four directory data tools.
//
// Exercises hit / miss / edge cases against production PG. Read-only.
//
// Run:
//   node --env-file=.env.local scripts/sousai-data-tools-test.mjs
//
// Named acceptance cases:
//   - "Chef Kelsey" -> Kelsey Atherton, Executive Chef, CIN - OH
//   - BGC via list_accounts -> current-season-list language, not denial
//   - Unknown role via list_contacts_by_role -> valid role list
//   - CIN - OH team roster -> ordered by seniority, gaps flagged
// ─────────────────────────────────────────────────────────────────────────────

import { findContact } from "../src/lib/sousai/tools/data/findContact.js";
import { listAccounts } from "../src/lib/sousai/tools/data/listAccounts.js";
import { listContactsByRole } from "../src/lib/sousai/tools/data/listContactsByRole.js";
import { getAccountTeam } from "../src/lib/sousai/tools/data/getAccountTeam.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

let passed = 0;
let failed = 0;
const failures = [];

async function run(label, fn) {
  console.log(`\n${BOLD}▶ ${label}${RESET}`);
  try {
    await fn();
    passed++;
    console.log(`  ${GREEN}PASS${RESET}`);
  } catch (e) {
    failed++;
    failures.push({ label, error: e.message });
    console.log(`  ${RED}FAIL${RESET}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function log(obj) {
  console.log(`  ${DIM}${JSON.stringify(obj, null, 2).split("\n").join("\n  ")}${RESET}`);
}

// ── A1: findContact ──────────────────────────────────────────────────────────

await run("A1 hit - Kevin's example: 'Kelsey' resolves to Kelsey Atherton", async () => {
  const r = await findContact({ nameQuery: "Kelsey" });
  log(r);
  assert(r.matches.length >= 1, "expected at least one match");
  const kelsey = r.matches.find((m) => m.name === "Kelsey Atherton");
  assert(kelsey, "Kelsey Atherton not in matches");
  assert(kelsey.role === "Executive Chef", `role=${kelsey.role} not Executive Chef`);
  assert(kelsey.team_key === "CIN - OH", `team_key=${kelsey.team_key} not CIN - OH`);
  assert(kelsey.phone, "phone missing");
  assert(kelsey.email === "k.atherton@kitchfix.com", `email=${kelsey.email}`);
  assert(r.loaded === "2026-05-27", `loaded=${r.loaded} not 2026-05-27`);
  assert(r.source === "contacts", "source missing");
});

await run("A1 hit - first-name-only 'Jennifer' returns row(s)", async () => {
  const r = await findContact({ nameQuery: "Jennifer" });
  log({ total: r.total, names: r.matches.map((m) => m.name) });
  assert(r.total >= 1, "no Jennifer found");
});

await run("A1 miss - unknown name 'Bartholomew Nobody'", async () => {
  const r = await findContact({ nameQuery: "Bartholomew Nobody" });
  log(r);
  assert(r.matches.length === 0, "expected zero matches");
  assert(r.total === 0, "expected total 0");
  assert(r.note && r.note.includes("leadership directory"), "coverage language missing from note");
  assert(r.note && r.note.includes("Executive Chef"), "role coverage not stated");
});

await run("A1 edge - empty query returns note without crashing", async () => {
  const r = await findContact({ nameQuery: "" });
  log(r);
  assert(r.matches.length === 0, "expected zero matches");
  assert(r.note && r.note.includes("empty"), "empty-query note missing");
});

// ── A2: listAccounts ─────────────────────────────────────────────────────────

await run("A2 hit - unfiltered list of 12 current-season accounts", async () => {
  const r = await listAccounts({});
  log({ total: r.total, team_keys: r.accounts.map((a) => a.team_key) });
  assert(r.total === 12, `expected 12 accounts, got ${r.total}`);
  assert(r.accounts.every((a) => a.team_key), "some account missing team_key");
  assert(r.loaded === "2026-05-27", `loaded=${r.loaded}`);
});

await run("A2 miss - BGC ('does BGC still work with us?') returns current-season-list language", async () => {
  const r = await listAccounts({ teamKey: "BGC" });
  log(r);
  assert(r.total === 0, "expected zero rows");
  assert(
    r.note && r.note.includes("current-season list"),
    `expected 'current-season list' language, got note='${r.note}'`
  );
  assert(
    r.note && r.note.includes("REC"),
    "expected the model-facing pointer to the doc corpus (REC docs)"
  );
});

await run("A2 edge - unknown level returns validLevels", async () => {
  const r = await listAccounts({ level: "Bogus-Level" });
  log(r);
  assert(r.total === 0, "expected zero rows");
  assert(Array.isArray(r.validLevels), "expected validLevels array");
  assert(r.validLevels.length > 0, "expected at least one valid level");
});

// ── A4: listContactsByRole ───────────────────────────────────────────────────

await run("A4 hit - all Executive Chefs", async () => {
  const r = await listContactsByRole({ role: "Executive Chef" });
  log({ total: r.total, names: r.matches.map((m) => `${m.name} @ ${m.team_key}`) });
  assert(r.total >= 6, `expected >= 6 Executive Chefs, got ${r.total}`);
  assert(r.matches.every((m) => m.role === "Executive Chef"), "role mismatch in results");
});

await run("A4 hit - Executive Chef at CIN - OH (composed with teamKey)", async () => {
  const r = await listContactsByRole({ role: "Executive Chef", teamKey: "CIN - OH" });
  log(r);
  assert(r.matches.length === 1, `expected exactly 1 EC at CIN - OH, got ${r.matches.length}`);
  assert(r.matches[0].name === "Kelsey Atherton", "expected Kelsey Atherton");
});

await run("A4 edge - unknown role returns validRoles", async () => {
  const r = await listContactsByRole({ role: "Chief Vibes Officer" });
  log({ total: r.total, note: r.note, validRoles: r.validRoles });
  assert(r.total === 0, "expected zero matches");
  assert(Array.isArray(r.validRoles) && r.validRoles.length > 0, "validRoles missing");
  assert(r.validRoles.includes("Executive Chef"), "known role missing from validRoles");
});

await run("A4 case-insensitive role match: 'executive chef' resolves", async () => {
  const r = await listContactsByRole({ role: "executive chef" });
  log({ total: r.total, canonical: r.parameters.role });
  assert(r.total >= 6, "case-insensitive match failed");
  assert(r.parameters.role === "Executive Chef", "expected canonical role in parameters");
});

// ── A5: getAccountTeam ───────────────────────────────────────────────────────

await run("A5 hit - CIN - OH team roster, ordered by seniority", async () => {
  const r = await getAccountTeam({ teamKey: "CIN - OH" });
  log({
    account: r.account,
    total: r.total,
    team: r.team.map((t) => `${t.role} - ${t.name}`),
    gaps: r.gaps,
  });
  assert(r.total >= 1, `expected at least 1 person at CIN - OH, got ${r.total}`);
  assert(r.team[0].role === "Executive Chef", "expected Executive Chef first in seniority");
  // CIN - OH investigation showed only 1 contact - Kelsey - so gaps should include Sous Chef + Hospitality Manager
  assert(r.gaps.length >= 2, `expected 2+ gaps at CIN - OH (Sous Chef, Hospitality Manager), got ${r.gaps.length}`);
  const gapRoles = r.gaps.map((g) => g.missing_role);
  assert(gapRoles.includes("Sous Chef"), "expected Sous Chef gap");
  assert(gapRoles.includes("Hospitality Manager"), "expected Hospitality Manager gap");
});

await run("A5 hit - CORP roster (no site triad gap check)", async () => {
  const r = await getAccountTeam({ teamKey: "CORP" });
  log({ total: r.total, team: r.team.map((t) => `${t.role} - ${t.name}`), gaps: r.gaps });
  assert(r.total >= 5, `expected >= 5 CORP contacts, got ${r.total}`);
  assert(r.gaps.length === 0, "CORP should not trigger site-triad gap check");
});

await run("A5 miss - unknown teamKey 'BGC'", async () => {
  const r = await getAccountTeam({ teamKey: "BGC" });
  log(r);
  assert(r.total === 0, "expected zero team members");
  assert(Array.isArray(r.validTeamKeys), "validTeamKeys missing");
  assert(r.validTeamKeys.includes("CIN - OH"), "known account missing from validTeamKeys");
  assert(r.note && r.note.includes("current-season list"), "current-season-list language missing");
});

await run("A5 edge - empty teamKey returns note without crashing", async () => {
  const r = await getAccountTeam({ teamKey: "" });
  log(r);
  assert(r.total === 0, "expected zero");
  assert(r.note && r.note.includes("empty"), "empty-teamKey note missing");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}══════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}Summary${RESET}: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`);
if (failed > 0) {
  console.log(`\n${BOLD}Failures:${RESET}`);
  for (const f of failures) console.log(`  ${RED}${f.label}${RESET}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
