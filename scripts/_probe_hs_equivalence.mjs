// PROBE (read-only): M-0 STEP 1 equivalence proof.
//
// For every account with homestand data (4 MLB + 2 AAA MiLB), derive
// blocks from GAME/AWAY ordering (maximal run of GAME containing no
// AWAY; EXHIBITION excluded) and compare against the stored
// homestand_id grouping. Also confirm PDC / STL-FL / other per-meal
// accounts have NO rows in sc_homestand_schedule.
//
//   node --env-file=.env.local scripts/_probe_hs_equivalence.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const HAS_HS = ["CIN - OH", "STL - MO", "TXR - TX - H", "TXR - TX - V", "CIN - KY", "TBJ - NY"];

async function fetchAll(account) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("sc_homestand_schedule")
      .select("service_date, day_type, opponent, homestand_id, game_pk, game_time, is_doubleheader")
      .eq("account_key", account)
      .order("service_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error(account, error.message); return []; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

function daysInclusive(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) + 1;
}

// Derive blocks: order GAME + AWAY by date; a block is a maximal run
// of GAME days with no AWAY inside. EXHIBITION excluded entirely.
function deriveBlocks(rows) {
  const seasonRows = rows
    .filter(r => r.day_type === "GAME" || r.day_type === "AWAY")
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
  const blocks = [];
  let curr = null;
  for (const r of seasonRows) {
    if (r.day_type === "GAME") {
      if (!curr) curr = { first: r.service_date, last: r.service_date, gameCount: 0, opponents: new Set(), games: [] };
      curr.last = r.service_date;
      curr.gameCount += 1;
      if (r.opponent) curr.opponents.add(r.opponent);
      curr.games.push(r);
    } else {
      if (curr) { blocks.push(curr); curr = null; }
    }
  }
  if (curr) blocks.push(curr);
  return blocks;
}

// Group by stored homestand_id (excluding empty and EXHIBITION rows).
function groupByStoredId(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (r.day_type !== "GAME") continue; // only GAME rows carry a real homestand
    const id = String(r.homestand_id || "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, { id, first: r.service_date, last: r.service_date, gameCount: 0, opponents: new Set() });
    const b = byId.get(id);
    if (r.service_date < b.first) b.first = r.service_date;
    if (r.service_date > b.last) b.last = r.service_date;
    b.gameCount += 1;
    if (r.opponent) b.opponents.add(r.opponent);
  }
  return [...byId.values()].sort((a, b) => a.first.localeCompare(b.first));
}

async function comparePerAccount(account) {
  const rows = await fetchAll(account);
  if (!rows.length) return { account, empty: true };
  const derived = deriveBlocks(rows);
  const stored = groupByStoredId(rows);
  return { account, rows, derived, stored };
}

// ═══════════════════════════════════════════════════════════════
console.log(`═══ M-0 STEP 1 - equivalence proof (today = ${new Date().toISOString().slice(0,10)}) ═══\n`);

const results = [];
for (const acct of HAS_HS) {
  const r = await comparePerAccount(acct);
  results.push(r);
}

// Per-account report
let anyDivergesOtherThanStlMo = false;
for (const r of results) {
  console.log(`\n──────── ${r.account} ────────`);
  if (r.empty) { console.log("  (no rows)"); continue; }
  console.log(`  total rows: ${r.rows.length}`);
  console.log(`  derived block count: ${r.derived.length}`);
  console.log(`  stored block count (by homestand_id, GAME rows only): ${r.stored.length}`);
  console.log("");
  console.log("  ord  derived_first  derived_last   d_days  d_games   |   stored_id  stored_first  stored_last   s_days  s_games   MATCH?");
  const maxLen = Math.max(r.derived.length, r.stored.length);
  let allMatch = true;
  const diffs = [];
  for (let i = 0; i < maxLen; i++) {
    const d = r.derived[i];
    const s = r.stored[i];
    const dSpan = d ? `${d.first}   ${d.last}   ${String(daysInclusive(d.first, d.last)).padStart(6)}  ${String(d.gameCount).padStart(7)}` : "(none)                                       ";
    const sSpan = s ? `${(s.id || "").padEnd(8)}   ${s.first}   ${s.last}   ${String(daysInclusive(s.first, s.last)).padStart(6)}  ${String(s.gameCount).padStart(7)}` : "(none)                                                 ";
    const match = d && s && d.first === s.first && d.last === s.last && d.gameCount === s.gameCount;
    if (!match) { allMatch = false; diffs.push({ ord: i + 1, d, s }); }
    console.log(`  ${String(i + 1).padStart(3)}  ${dSpan}   |   ${sSpan}   ${match ? "✓" : "✗ DIFF"}`);
  }
  console.log("");
  if (allMatch) {
    console.log(`  VERDICT: IDENTICAL - derived and stored produce the same blocks.`);
  } else {
    console.log(`  VERDICT: DIVERGES - ${diffs.length} block(s) differ:`);
    for (const d of diffs) {
      const dStr = d.d ? `derived=${d.d.first}..${d.d.last} (${d.d.gameCount}g)` : "derived=(none)";
      const sStr = d.s ? `stored=${d.s.id} ${d.s.first}..${d.s.last} (${d.s.gameCount}g)` : "stored=(none)";
      console.log(`    ord=${d.ord}  ${dStr}   |   ${sStr}`);
    }
    if (r.account !== "STL - MO") anyDivergesOtherThanStlMo = true;
  }
}

// Ordinal labels comparison: does derivation produce the same HS1..HS13
// numbering the stored rows show today?
console.log(`\n══════════ ORDINAL LABEL DRIFT ══════════\n`);
console.log("For each account, walk stored blocks in date order and compare their");
console.log("stored HS id against the derived ordinal (1..N).\n");
for (const r of results) {
  if (r.empty) continue;
  console.log(`${r.account}:`);
  let anyDrift = false;
  for (let i = 0; i < r.stored.length; i++) {
    const s = r.stored[i];
    const derivedOrd = `HS${i + 1}`;
    if (s.id !== derivedOrd) {
      console.log(`  ord ${i + 1}: stored id="${s.id}" vs derived ordinal="${derivedOrd}"  DRIFT`);
      anyDrift = true;
    }
  }
  if (!anyDrift) console.log(`  no drift - stored HS1..HS${r.stored.length} match derived ordinals in date order.`);
}

// PDC / STL-FL / other per-meal check
console.log(`\n══════════ NON-HOMESTAND ACCOUNTS - must have zero rows ══════════\n`);
const NON_HS = ["CIN - AZ", "TXR - AZ", "TBJ - FL", "TBR - FL", "STL - FL"];
for (const acct of NON_HS) {
  const { count, error } = await supa
    .from("sc_homestand_schedule")
    .select("*", { count: "exact", head: true })
    .eq("account_key", acct);
  if (error) { console.error(acct, error.message); continue; }
  const marker = count === 0 ? "✓" : "✗ HAS ROWS";
  console.log(`  ${acct.padEnd(14)}  rows=${count}  ${marker}`);
}

console.log(`\n══════════ SUMMARY ══════════\n`);
for (const r of results) {
  if (r.empty) { console.log(`  ${r.account.padEnd(14)}  (no rows)`); continue; }
  const same = r.derived.length === r.stored.length && r.derived.every((d, i) => {
    const s = r.stored[i];
    return s && d.first === s.first && d.last === s.last && d.gameCount === s.gameCount;
  });
  console.log(`  ${r.account.padEnd(14)}  derived=${r.derived.length}  stored=${r.stored.length}  ${same ? "IDENTICAL" : "DIVERGES"}`);
}
if (anyDivergesOtherThanStlMo) {
  console.log(`\n⚠ ONE OR MORE ACCOUNTS OTHER THAN STL-MO DIVERGES. Do not proceed to the swap.`);
} else {
  console.log(`\n✓ Only STL - MO diverges (as expected). Proof holds - proceed to swap on owner ruling.`);
}
