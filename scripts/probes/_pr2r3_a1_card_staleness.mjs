// PR2 R3 A1 - "why is the current period nearly empty of card spend".
//
// Report-only. Measures:
//   1. max(txn_date) on purchasing_actuals (source=rippling_spend) and
//      row count per week for the last eight weeks.
//   2. Last 5 derive runs (rippling_spend) with rows written.
//   3. Ingestion vs derivation gap: raw rows landed vs derived rows per week.
//   4. ObjectID-derived txn_date vs first_seen_at on newest 50 raw rows -
//      does the ObjectID-derived date lag at the recent end?
//   5. Walk horizon check via config constants + does newest raw row's
//      first_seen_at land after or before its parent ObjectID's timestamp.
//
// Never opens .env files. Never prints keys.

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("MISSING SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const supa = createClient(SB_URL, SB_KEY);

const OBJECTID_HEX24 = /^[a-f0-9]{24}$/;
const RULING_1_CALIBRATION_DAYS = -1;
function parentIdFromExternalId(ext) {
  if (!ext || typeof ext !== "string") return null;
  const idx = ext.indexOf("__");
  if (idx <= 0) return null;
  const tok = ext.slice(0, idx).toLowerCase();
  return OBJECTID_HEX24.test(tok) ? tok : null;
}
function objectIdToTxnDate(hex24) {
  if (!hex24 || !OBJECTID_HEX24.test(hex24)) return null;
  const secs = parseInt(hex24.slice(0, 8), 16);
  if (!Number.isFinite(secs)) return null;
  const ms = (secs + RULING_1_CALIBRATION_DAYS * 86400) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
function objectIdToDate(hex24) {
  if (!hex24 || !OBJECTID_HEX24.test(hex24)) return null;
  const secs = parseInt(hex24.slice(0, 8), 16);
  if (!Number.isFinite(secs)) return null;
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

const todayISO = new Date().toISOString().slice(0, 10);

function weekStartISO(dateISO) {
  const d = new Date(dateISO + "T00:00:00Z");
  const dow = d.getUTCDay(); // Sun=0, Mon=1
  const daysSinceMon = (dow + 6) % 7;
  const wk = new Date(d);
  wk.setUTCDate(d.getUTCDate() - daysSinceMon);
  return wk.toISOString().slice(0, 10);
}

async function fetchAllPages(fn) {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await fn(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

console.log("=".repeat(72));
console.log("PR2 R3 A1 - card-spend staleness investigation");
console.log("todayISO:", todayISO);
console.log("=".repeat(72));

// 1. max(txn_date) on rippling_spend rows and per-week counts for last 8 weeks
console.log("\n[1] max(txn_date) on purchasing_actuals (source=rippling_spend)");
{
  const eightWksAgo = new Date();
  eightWksAgo.setUTCDate(eightWksAgo.getUTCDate() - 8 * 7);
  const eightWksISO = eightWksAgo.toISOString().slice(0, 10);
  const rows = await fetchAllPages((from, to) =>
    supa.from("purchasing_actuals")
      .select("txn_date, derived_at")
      .eq("source", "rippling_spend")
      .gte("txn_date", eightWksISO)
      .order("txn_date", { ascending: false })
      .range(from, to));
  const max = rows[0]?.txn_date || "(none in last 8 weeks)";
  console.log("  max(txn_date):", max);
  const perWeek = new Map();
  for (const r of rows) {
    const wk = weekStartISO(r.txn_date);
    perWeek.set(wk, (perWeek.get(wk) || 0) + 1);
  }
  const sortedWk = [...perWeek.keys()].sort();
  console.log("  rows per week (last 8 weeks):");
  for (const wk of sortedWk) console.log(`    ${wk}  count=${perWeek.get(wk)}`);
  console.log(`  total rows in last 8 weeks: ${rows.length}`);
}

// 2. Last 5 derived_at timestamps + rows written per run
console.log("\n[2] last 5 derive runs (purchasing_derive_runs, source=rippling_spend)");
{
  const { data, error } = await supa
    .from("purchasing_derive_runs")
    .select("id, source, status, started_at, ended_at, rows_written")
    .eq("source", "rippling_spend")
    .order("started_at", { ascending: false })
    .limit(5);
  if (error) console.log("  ERROR:", error.message);
  else {
    for (const r of data || []) {
      console.log(`    started=${r.started_at}  ended=${r.ended_at}  status=${r.status}  rows_written=${r.rows_written}`);
    }
  }
}

// 3. Ingestion vs derivation: raw rows in last 4 weeks vs derived rows
console.log("\n[3] ingestion vs derivation (raw vs derived, per week, last 4 weeks)");
{
  const fourWksAgo = new Date();
  fourWksAgo.setUTCDate(fourWksAgo.getUTCDate() - 4 * 7);
  const fourWksISO = fourWksAgo.toISOString().slice(0, 10);
  // Raw rows by first_seen_at (when landed)
  const rawByLandedWeek = new Map();
  const raw = await fetchAllPages((from, to) =>
    supa.from("rippling_raw_spend_lines_latest")
      .select("rippling_id, first_seen_at, external_id")
      .gte("first_seen_at", fourWksISO)
      .order("first_seen_at", { ascending: false })
      .range(from, to));
  for (const r of raw) {
    const wk = weekStartISO(r.first_seen_at.slice(0, 10));
    rawByLandedWeek.set(wk, (rawByLandedWeek.get(wk) || 0) + 1);
  }
  console.log(`  raw rows landed (by first_seen_at week) in last 4 weeks: ${raw.length}`);
  const rawWks = [...rawByLandedWeek.keys()].sort();
  for (const wk of rawWks) console.log(`    landed_week=${wk}  raw_count=${rawByLandedWeek.get(wk)}`);

  // Raw rows by derived (ObjectID) txn_date
  const rawByObjIdWeek = new Map();
  for (const r of raw) {
    const parent = parentIdFromExternalId(r.external_id);
    if (!parent) continue;
    const txnD = objectIdToTxnDate(parent);
    if (!txnD) continue;
    const wk = weekStartISO(txnD);
    rawByObjIdWeek.set(wk, (rawByObjIdWeek.get(wk) || 0) + 1);
  }
  console.log(`  raw rows grouped by ObjectID-derived txn_date week:`);
  const objWks = [...rawByObjIdWeek.keys()].sort();
  for (const wk of objWks) console.log(`    objid_week=${wk}  count=${rawByObjIdWeek.get(wk)}`);

  // Derived rows in the same period
  const derived = await fetchAllPages((from, to) =>
    supa.from("purchasing_actuals")
      .select("id, txn_date, derived_at")
      .eq("source", "rippling_spend")
      .gte("txn_date", fourWksISO)
      .order("txn_date", { ascending: false })
      .range(from, to));
  const derByWeek = new Map();
  for (const r of derived) {
    const wk = weekStartISO(r.txn_date);
    derByWeek.set(wk, (derByWeek.get(wk) || 0) + 1);
  }
  console.log(`  derived rows (purchasing_actuals) with txn_date in last 4 weeks: ${derived.length}`);
  const derWks = [...derByWeek.keys()].sort();
  for (const wk of derWks) console.log(`    derived_txn_week=${wk}  count=${derByWeek.get(wk)}`);
}

// 4. ObjectID-derived txn_date vs first_seen_at on newest 50 raw rows
console.log("\n[4] ObjectID-lag test - newest 50 raw rows: txn_date - first_seen_at");
{
  const { data, error } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("rippling_id, external_id, first_seen_at")
    .order("first_seen_at", { ascending: false })
    .limit(50);
  if (error) console.log("  ERROR:", error.message);
  else {
    const rows = (data || []).map(r => {
      const parent = parentIdFromExternalId(r.external_id);
      if (!parent) return null;
      const objId = objectIdToDate(parent);          // raw ObjectID timestamp
      const txnD = objectIdToTxnDate(parent);        // -1 day calibration
      const seenD = r.first_seen_at.slice(0, 10);
      if (!txnD || !seenD) return null;
      const lagDays = Math.round((new Date(seenD) - new Date(objId)) / 86400000);
      const txnVsSeenDays = Math.round((new Date(seenD) - new Date(txnD)) / 86400000);
      return { rid: r.rippling_id, objId, txnD, seenD, objIdVsSeen: lagDays, txnDvsSeen: txnVsSeenDays };
    }).filter(Boolean);
    // Summary stats
    const lags = rows.map(r => r.objIdVsSeen).sort((a, b) => a - b);
    const median = lags[Math.floor(lags.length / 2)];
    const min = lags[0];
    const max = lags[lags.length - 1];
    console.log(`  newest 50 rows: ObjectID-timestamp -> first_seen_at lag`);
    console.log(`    median=${median} days  min=${min}  max=${max}  n=${lags.length}`);
    console.log(`  first 10 rows:`);
    for (const r of rows.slice(0, 10)) {
      console.log(`    rid=${r.rid.slice(0, 12)}...  objId_date=${r.objId}  txnD(-1d)=${r.txnD}  first_seen=${r.seenD}  objid_lag=${r.objIdVsSeen}d  txnD_lag=${r.txnDvsSeen}d`);
    }
  }
}

// 5. Walk horizon: what's the newest first_seen_at at all?
console.log("\n[5] walk horizon");
{
  const { data, error } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("rippling_id, external_id, first_seen_at")
    .order("first_seen_at", { ascending: false })
    .limit(1);
  if (error) console.log("  ERROR:", error.message);
  else {
    const r = (data || [])[0];
    if (!r) console.log("  (no rows)");
    else {
      const parent = parentIdFromExternalId(r.external_id);
      const objId = parent ? objectIdToDate(parent) : null;
      const txnD = parent ? objectIdToTxnDate(parent) : null;
      console.log(`  newest raw row: first_seen_at=${r.first_seen_at}  objId_date=${objId}  txnD(-1d)=${txnD}`);
    }
  }
  console.log(`  scripts/purchasing_rippling_sync.mjs constants:`);
  console.log(`    PAGE_SIZE=100  MAX_PAGES_HARD=500  -> hard cap 50,000 rows/run`);
  console.log(`    order=default (Rippling API silently ignores sort per src/lib/rippling.js:17)`);
  console.log(`    early exit: NONE (walks to end or MAX_PAGES_HARD)`);
  // Count total raw rows to see if 50k cap could be hitting
  const { count, error: cErr } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("rippling_id", { count: "exact", head: true });
  if (!cErr) console.log(`  total raw rows (_latest): ${count}`);
}

// 6. Sanity - TBR - FL P9 card spend by bucket right now
console.log("\n[6] sanity: TBR - FL P9 (2026-08-10 to 2026-09-06) rippling_spend rows");
{
  const p9Start = "2026-08-10";
  const p9End = "2026-09-06";
  const { data, error } = await supa
    .from("purchasing_actuals")
    .select("account_key, gl_bucket, amount, txn_date")
    .eq("source", "rippling_spend")
    .in("account_key", ["TBR - FL"])
    .gte("txn_date", p9Start)
    .lte("txn_date", p9End);
  if (error) console.log("  ERROR:", error.message);
  else {
    const sum = (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    console.log(`  TBR - FL rippling_spend rows in P9: n=${(data || []).length}  sum=${sum.toFixed(2)}`);
    const byBucket = new Map();
    for (const r of data || []) byBucket.set(r.gl_bucket, (byBucket.get(r.gl_bucket) || 0) + Number(r.amount || 0));
    for (const [b, v] of byBucket) console.log(`    bucket=${b}  sum=${v.toFixed(2)}`);
  }
}

console.log("\n" + "=".repeat(72));
console.log("END A1");
