// READ-ONLY probe for Module 7 (Smart Inventory) recon. Reads Sheets
// + Postgres via service accounts and reports counts / distributions.
// No writes anywhere. Verifies doc claims in SMART_INVENTORY_DATA_MODEL.
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe-inventory-data.mjs

import { createClient } from "@supabase/supabase-js";
import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function header(label) {
  console.log(``);
  console.log(`================================================`);
  console.log(`  ${label}`);
  console.log(`================================================`);
}

function asStr(v) {
  return v == null ? "" : String(v).trim();
}

async function main() {
  header(`7. item_catalog: row count + columns + priceAtLastCount fill`);
  const { rows: catalogRows } = await safeRead(SHEET_IDS.INVENTORY, "item_catalog");
  console.log(`item_catalog: ${catalogRows.length} data rows (after safeRead header skip)`);
  // Column width: max non-empty column index across rows
  let maxCol = 0;
  for (const r of catalogRows) {
    for (let i = r.length - 1; i >= 0; i--) {
      if (asStr(r[i]) !== "") { if (i + 1 > maxCol) maxCol = i + 1; break; }
    }
  }
  console.log(`max non-empty column (1-indexed): ${maxCol}`);
  // Active counts
  const activeRows = catalogRows.filter((r) => asStr(r[11]).toUpperCase() !== "FALSE");
  const inactiveRows = catalogRows.filter((r) => asStr(r[11]).toUpperCase() === "FALSE");
  console.log(`active (col L != FALSE): ${activeRows.length}`);
  console.log(`inactive (col L == FALSE): ${inactiveRows.length}`);
  // priceAtLastCount fill (col K = index 10)
  const palc = catalogRows.filter((r) => {
    const v = asStr(r[10]);
    return v !== "" && Number(v) !== 0;
  });
  console.log(`priceAtLastCount (col K) filled: ${palc.length} of ${catalogRows.length}  (${((palc.length / catalogRows.length) * 100).toFixed(2)}%)`);
  // Inactive status (col Q = index 16)
  const archived = inactiveRows.filter((r) => asStr(r[16]) === "archived");
  const excluded = inactiveRows.filter((r) => asStr(r[16]) === "excluded");
  console.log(`inactive: archived=${archived.length}  excluded=${excluded.length}  other=${inactiveRows.length - archived.length - excluded.length}`);

  header(`8. account_key distinct values in item_catalog`);
  const accountSet = new Set();
  for (const r of catalogRows) {
    const a = asStr(r[1]);
    if (a) accountSet.add(a);
  }
  const accounts = [...accountSet].sort();
  console.log(`distinct account values in col B: ${accounts.length}`);
  for (const a of accounts) {
    const ct = catalogRows.filter((r) => asStr(r[1]) === a).length;
    console.log(`  "${a}"  (${ct} rows)`);
  }
  // Short vs full detection: any pair where one is prefix of another (with " - " separator)
  const shortVsFull = [];
  for (const short of accounts) {
    for (const full of accounts) {
      if (short === full) continue;
      if (full.startsWith(short + " - ")) shortVsFull.push([short, full]);
    }
  }
  console.log(`short-vs-full overlaps: ${shortVsFull.length}`);
  for (const [s, f] of shortVsFull) console.log(`  short "${s}"  ->  full "${f}"`);

  header(`9. item_aliases: duplicate-alias issue (col 5 learnedBy / col 7 source)`);
  const { rows: aliasRows } = await safeRead(SHEET_IDS.INVENTORY, "item_aliases");
  console.log(`item_aliases: ${aliasRows.length} rows`);
  // Schema per code at handleMergeItems L648-651:
  //   [aliasId, aliasText, canonicalItemId, vendor, confidence, learnedBy, learnedAt, source]
  // Cols A..H (indices 0..7). Doc said "cols 5 and 7 (learnedBy/source) really are duplicates."
  // Check empirically how often col 5 == col 7.
  let learnedBySourceSame = 0;
  let learnedBySourceDifferent = 0;
  const sourceSample = new Set();
  for (const r of aliasRows) {
    const lb = asStr(r[5]);
    const sr = asStr(r[7]);
    sourceSample.add(`lb=${lb}|src=${sr}`);
    if (lb === sr) learnedBySourceSame++;
    else learnedBySourceDifferent++;
  }
  console.log(`rows where col F (learnedBy) == col H (source): ${learnedBySourceSame}`);
  console.log(`rows where they differ: ${learnedBySourceDifferent}`);
  // 945-duplicate-alias check: same (itemId, aliasText, vendor) appearing > 1x
  const aliasKey = new Map();
  for (const r of aliasRows) {
    const key = `${asStr(r[2])}::${asStr(r[1]).toLowerCase()}::${asStr(r[3]).toLowerCase()}`;
    aliasKey.set(key, (aliasKey.get(key) || 0) + 1);
  }
  let dupKeys = 0, dupExtraRows = 0;
  for (const [, n] of aliasKey) {
    if (n > 1) { dupKeys++; dupExtraRows += n - 1; }
  }
  console.log(`(itemId, aliasText, vendor) dup keys: ${dupKeys}  (extra rows beyond one-per-key: ${dupExtraRows})`);

  header(`10. primaryVendor: distinct values + unresolved against vendor_master`);
  const primaryVendorSet = new Set();
  for (const r of activeRows) {
    const v = asStr(r[6]);
    if (v) primaryVendorSet.add(v);
  }
  console.log(`distinct primaryVendor values in active item_catalog (col G): ${primaryVendorSet.size}`);
  // Pull vendor_master from PG (Module 5 is live; PG is authoritative for vendor names).
  const { data: vmRows, error: vmErr } = await supa
    .from("vendors")
    .select("name");
  if (vmErr) {
    console.log(`vendor_master (PG vendors): ERROR  ${vmErr.message}`);
  } else {
    const vmNames = new Set(vmRows.map((r) => asStr(r.name).toLowerCase()));
    console.log(`vendor_master (PG vendors.name): ${vmNames.size} distinct names`);
    const unresolved = [];
    for (const pv of primaryVendorSet) {
      if (!vmNames.has(pv.toLowerCase())) unresolved.push(pv);
    }
    console.log(`primaryVendor strings with NO exact-match in vendor_master: ${unresolved.length}`);
    for (const u of unresolved.slice(0, 25)) console.log(`  "${u}"`);
    if (unresolved.length > 25) console.log(`  ... +${unresolved.length - 25} more`);
  }

  header(`11. count_sessions + count_items volume by account`);
  const [csRead, ciRead] = await Promise.all([
    safeRead(SHEET_IDS.INVENTORY, "count_sessions"),
    safeRead(SHEET_IDS.INVENTORY, "count_items"),
  ]);
  const csRows = csRead.rows;
  const ciRows = ciRead.rows;
  console.log(`count_sessions: ${csRows.length} rows total`);
  console.log(`count_items: ${ciRows.length} rows total`);
  // Sessions by status
  const csByStatus = {};
  for (const r of csRows) {
    const s = asStr(r[5]) || "(empty)";
    csByStatus[s] = (csByStatus[s] || 0) + 1;
  }
  console.log(`count_sessions by status:`);
  for (const [s, n] of Object.entries(csByStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
  // Sessions by account
  const csByAccount = {};
  for (const r of csRows) {
    const a = asStr(r[1]) || "(empty)";
    csByAccount[a] = (csByAccount[a] || 0) + 1;
  }
  console.log(`count_sessions by account (top 10):`);
  for (const [a, n] of Object.entries(csByAccount).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${a}: ${n}`);
  }
  // count_items per session: distribution
  const ciPerSession = {};
  for (const r of ciRows) {
    const sid = asStr(r[0]);
    if (sid) ciPerSession[sid] = (ciPerSession[sid] || 0) + 1;
  }
  const ciSizes = Object.values(ciPerSession).sort((a, b) => b - a);
  console.log(`count_items lines per session: min=${ciSizes.at(-1) ?? 0}  median=${ciSizes[Math.floor(ciSizes.length / 2)] ?? 0}  max=${ciSizes[0] ?? 0}  sessions-with-items=${ciSizes.length}`);

  header(`12. review_queue: pending by reason`);
  const { rows: rqRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
  console.log(`review_queue: ${rqRows.length} rows total`);
  // Schema (col K post our doc update): J=status (idx 9), N=reason (idx 13)
  const byReason = {};
  const byStatus = {};
  for (const r of rqRows) {
    const st = asStr(r[9]) || "(empty)";
    const rs = asStr(r[13]) || "(empty)";
    byStatus[st] = (byStatus[st] || 0) + 1;
    byReason[rs] = (byReason[rs] || 0) + 1;
  }
  console.log(`review_queue by status:`);
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
  console.log(`review_queue by reason (col N, our just-shipped schema):`);
  for (const [r, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${n}`);
  }
  // Pending count
  const pending = rqRows.filter((r) => asStr(r[9]) === "pending");
  console.log(`review_queue pending: ${pending.length}`);
  const pendingByReason = {};
  for (const r of pending) {
    const rs = asStr(r[13]) || "(empty)";
    pendingByReason[rs] = (pendingByReason[rs] || 0) + 1;
  }
  console.log(`pending by reason:`);
  for (const [r, n] of Object.entries(pendingByReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${n}`);
  }

  header(`bonus: width of review_queue rows (does any row have col N populated?)`);
  let withReason = 0, withoutReason = 0;
  for (const r of rqRows) {
    if (asStr(r[13])) withReason++;
    else withoutReason++;
  }
  console.log(`rows with col N (reason) populated: ${withReason}`);
  console.log(`rows with col N empty (pre-arithmetic-gate or pre-hold rows): ${withoutReason}`);

  header(`bonus: merge_history snapshot (referenced by cron's exclude check)`);
  const { rows: mhRows } = await safeRead(SHEET_IDS.INVENTORY, "merge_history");
  const byAction = {};
  for (const r of mhRows) {
    const a = asStr(r[8]) || "(empty)";
    byAction[a] = (byAction[a] || 0) + 1;
  }
  console.log(`merge_history: ${mhRows.length} rows total. Distribution by col I (action):`);
  for (const [a, n] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${a}: ${n}`);
  }
}

main().catch((e) => {
  console.error(`[probe] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
