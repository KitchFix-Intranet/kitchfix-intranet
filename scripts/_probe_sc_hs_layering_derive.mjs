// PROBE (read-only): Job 1 layering confirmation + Job 2 game-derived
// homestand blocks. No writes.
//
//   node --env-file=.env.local scripts/_probe_sc_hs_layering_derive.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const MLB = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V"];

async function fetchAll(account) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("sc_homestand_schedule")
      .select("service_date, day_type, opponent, homestand_id, game_pk, game_time, is_doubleheader, created_at")
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

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

// ═══════════════════════════════════════════════════════════════
// JOB 1 - STL-MO HS7..HS10 dump + layering confirmation
// ═══════════════════════════════════════════════════════════════
console.log("═══ JOB 1 — layering confirmation ═══\n");

const stl = await fetchAll("STL - MO");
const targetIds = new Set(["HS7", "HS8", "HS9", "HS10"]);
const targetRows = stl.filter(r => targetIds.has(r.homestand_id));

console.log(`STL - MO rows with homestand_id in {HS7,HS8,HS9,HS10}: ${targetRows.length}`);
console.log("date        dow  day_type    opp   hs_id  game_pk        game_time                     created_at");
for (const r of targetRows) {
  console.log(
    `${r.service_date}  ${new Date(r.service_date+"T00:00:00").toDateString().slice(0,3)}  ${(r.day_type||"").padEnd(10)}  ${(r.opponent||"").padEnd(4)}  ${(r.homestand_id||"").padEnd(5)}  ${String(r.game_pk ?? "(null)").padEnd(13)}  ${String(r.game_time ?? "(null)").padEnd(29)}  ${r.created_at}`
  );
}

// Layering signal: rows have game_pk / game_time even when homestand_id looks stale
const withPk = targetRows.filter(r => r.game_pk);
const withTime = targetRows.filter(r => r.game_time);
console.log(`\n  rows with game_pk populated: ${withPk.length} / ${targetRows.length}`);
console.log(`  rows with game_time populated: ${withTime.length} / ${targetRows.length}`);

// Per-account homestand_id census
console.log("\n═══ JOB 1.3 — homestand_id census (all 4 accounts) ═══");
console.log("account         total  with_hs_id  empty_hs_id  distinct_hs_ids  non_contiguous_ids");
for (const account of MLB) {
  const rows = account === "STL - MO" ? stl : await fetchAll(account);
  const total = rows.length;
  const withId = rows.filter(r => r.homestand_id && String(r.homestand_id).trim());
  const empty = rows.filter(r => !(r.homestand_id && String(r.homestand_id).trim()));
  const distinct = new Set(withId.map(r => r.homestand_id));
  // Contiguity check: for each hs_id, its assigned dates must form a run
  // with no other hs_id (or ID-less row) intervening in date order.
  const orderedNonEmpty = withId.slice().sort((a, b) => a.service_date.localeCompare(b.service_date));
  const nonContiguous = [];
  const seenAt = new Map();
  let lastId = null;
  let lastDate = null;
  for (const r of orderedNonEmpty) {
    const id = r.homestand_id;
    if (seenAt.has(id) && lastId !== id) {
      // this id appeared before, then another id appeared, now id again
      nonContiguous.push(id);
    }
    seenAt.set(id, r.service_date);
    lastId = id;
  }
  const nc = [...new Set(nonContiguous)];
  console.log(
    `${account.padEnd(14)}  ${String(total).padStart(5)}  ${String(withId.length).padStart(10)}  ${String(empty.length).padStart(11)}  ${String(distinct.size).padStart(15)}  ${nc.length ? nc.join(",") : "none"}`
  );
}

// ═══════════════════════════════════════════════════════════════
// JOB 2 - Derive homestands from GAME/AWAY ordering
// ═══════════════════════════════════════════════════════════════
console.log("\n\n═══ JOB 2 — derived homestand blocks (ignore homestand_id) ═══\n");

const derivedByAccount = new Map();
for (const account of MLB) {
  const rows = account === "STL - MO" ? stl : await fetchAll(account);
  const seasonRows = rows
    .filter(r => r.day_type === "GAME" || r.day_type === "AWAY")
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
  // A homestand = maximal run of GAME rows containing no AWAY row.
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
      // AWAY - close any open block
      if (curr) { blocks.push(curr); curr = null; }
    }
  }
  if (curr) blocks.push(curr);
  derivedByAccount.set(account, blocks);

  console.log(`${account}   derived blocks: ${blocks.length}`);
  console.log("  ord  first        last         span  gameCount  opponents");
  blocks.forEach((b, i) => {
    const span = daysBetween(b.first, b.last) + 1; // inclusive
    console.log(
      `  ${String(i+1).padStart(3)}  ${b.first}  ${b.last}  ${String(span).padStart(4)}  ${String(b.gameCount).padStart(9)}  ${[...b.opponents].join("/")}`
    );
  });

  // span distribution
  const spans = blocks.map(b => daysBetween(b.first, b.last) + 1);
  const min = Math.min(...spans), max = Math.max(...spans);
  const sorted = [...spans].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length/2)];
  const over14 = blocks.filter(b => (daysBetween(b.first, b.last) + 1) > 14);
  console.log(`  span distribution: min=${min}, median=${median}, max=${max}`);
  console.log(`  blocks > 14 days: ${over14.length}${over14.length ? " -> " + over14.map(b => `${b.first}..${b.last} (${daysBetween(b.first, b.last)+1}d)`).join(", ") : ""}`);

  // No-game gaps INSIDE each derived block (days between two consecutive
  // GAME rows in the same block that carry NEITHER a GAME nor an AWAY row)
  const dateHas = new Map();
  for (const r of rows) dateHas.set(r.service_date, r.day_type);
  const innerGaps = [];
  for (const b of blocks) {
    const gg = b.games;
    for (let i = 1; i < gg.length; i++) {
      const prev = gg[i-1].service_date;
      const cur = gg[i].service_date;
      const nDays = daysBetween(prev, cur) - 1; // days strictly between
      let missing = 0;
      for (let k = 1; k <= nDays; k++) {
        const d = new Date(prev + "T00:00:00");
        d.setDate(d.getDate() + k);
        const iso = d.toISOString().slice(0, 10);
        if (!dateHas.has(iso)) missing += 1;
      }
      if (missing > 0) innerGaps.push({ block: `${b.first}..${b.last}`, between: `${prev}..${cur}`, noDataDays: missing });
    }
  }
  if (innerGaps.length) {
    console.log(`  no-game gaps INSIDE blocks (days with neither GAME nor AWAY):`);
    for (const g of innerGaps) {
      console.log(`    ${g.block}: between ${g.between}  → ${g.noDataDays} no-data days`);
    }
    const gapLens = innerGaps.map(g => g.noDataDays);
    console.log(`  inner-gap distribution: min=${Math.min(...gapLens)}, max=${Math.max(...gapLens)}, avg=${(gapLens.reduce((a,b)=>a+b,0)/gapLens.length).toFixed(1)}`);
  } else {
    console.log(`  no-game gaps INSIDE blocks: none`);
  }

  // EXHIBITION placement (TXR pair only)
  const exh = rows.filter(r => r.day_type === "EXHIBITION").sort((a, b) => a.service_date.localeCompare(b.service_date));
  if (exh.length) {
    console.log(`  EXHIBITION rows: ${exh.length}`);
    for (const e of exh) {
      const firstBlock = blocks[0];
      const relation = firstBlock
        ? (e.service_date < firstBlock.first ? `BEFORE opener (${firstBlock.first})`
          : (e.service_date > blocks[blocks.length-1].last ? "AFTER closer" : "INSIDE season"))
        : "no blocks";
      console.log(`    ${e.service_date}  vs ${e.opponent}  hs_id=${e.homestand_id}  →  ${relation}`);
    }
  }
  console.log("");
}
