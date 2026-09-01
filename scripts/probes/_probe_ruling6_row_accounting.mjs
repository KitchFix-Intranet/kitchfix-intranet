#!/usr/bin/env node
// scripts/probes/_probe_ruling6_row_accounting.mjs
//
// Q1 accounting for PR #931 review. Read-only.
//
// PURPOSE
//   #927 measured the intersection cohort at 96.4% API-coded, 5,062 of
//   5,250 rows - which leaves ~188 uncoded. Those are the rows the
//   corrected rule should still catch. The fix reports 11 rows /
//   $10,140.14 excluded under reason='report_coded'. Kevin: where did
//   the other ~177 go? Two candidates - reattribution (earlier rule
//   claims them first; auth_pair sits AFTER report_coded so it cannot;
//   dup_split / non_usd / map_excluded / label_fallback CAN) - or the
//   condition is tighter than intended.
//
// APPROACH
//   Recompute the intersection cohort from live data:
//     - reportCodedParents = parent_txn_id in rippling_report_txns_latest
//       where category is coded (not "please select")
//     - intersection rows = purchasing_actuals where source='rippling_spend'
//       AND parent-hex (from external_id) in that set
//   Report the row breakdown by:
//     - excluded state (true / false)
//     - reason (for excluded=true rows)
//     - coded state (gl_line_code null vs not null)
//   Then answer: for the intersection cohort's UNCODED rows, what reason
//   did they land under? If the number of uncoded rows in the cohort is
//   ~188 and only 11 are report_coded, the other 177 must sit under
//   earlier reason columns (dup_split etc.) or must be non-excluded.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;

// The derive uses parentIdFromExternalId(ext) which extracts the 24-char
// Mongo hex from an external_id like `rippling_spend_line:<hex>_...`.
// Preserve that exact parse.
const OBJECTID_HEX24 = /^[0-9a-f]{24}$/;
function parentIdFromExternalId(ext) {
  if (!ext || typeof ext !== "string") return null;
  const m = ext.match(/([0-9a-f]{24})/i);
  return m ? m[1].toLowerCase() : null;
}

async function loadReportCodedParents() {
  const set = new Set();
  let from = 0;
  while (true) {
    const r = await supa
      .from("rippling_report_txns_latest")
      .select("parent_txn_id, category")
      .not("category", "ilike", "%please select%")
      .order("parent_txn_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(`report_txns page ${from}: ${r.error.message}`);
    const rows = r.data || [];
    for (const row of rows) if (row.parent_txn_id) set.add(row.parent_txn_id);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return set;
}

async function loadAllRipplingSpendPA() {
  const rows = [];
  let from = 0;
  while (true) {
    const r = await supa
      .from("purchasing_actuals")
      .select("id, source_line_id, gl_line_code, excluded, reason, amount, txn_date")
      .eq("source", "rippling_spend")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(`purchasing_actuals page ${from}: ${r.error.message}`);
    const chunk = r.data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// Load rippling_raw_spend_lines_latest so we can map source_line_id ->
// external_id -> parent_hex. Excluded rows carry account_key=NULL by
// constraint, and the derive uses external_id from the raw row - not
// stored on purchasing_actuals directly.
async function loadRippExternals() {
  const map = new Map();  // rippling_id -> external_id
  let from = 0;
  while (true) {
    const r = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("rippling_id, external_id, parent_txn_id")
      .order("rippling_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(`raw page ${from}: ${r.error.message}`);
    const chunk = r.data || [];
    for (const row of chunk) {
      if (row.rippling_id) map.set(row.rippling_id, {
        external_id: row.external_id,
        parent_txn_id: row.parent_txn_id,
      });
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

function fmt$(v) {
  const n = Math.round(Number(v || 0) * 100) / 100;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  console.log(`# Ruling 6 row accounting - ${new Date().toISOString()}`);
  console.log(`# Post-fix reason distribution + intersection cohort recount.`);
  console.log("");

  const [coded, allPA, extMap] = await Promise.all([
    loadReportCodedParents(),
    loadAllRipplingSpendPA(),
    loadRippExternals(),
  ]);
  console.log(`report_coded parents (live): ${coded.size}`);
  console.log(`rippling_spend rows in purchasing_actuals: ${allPA.length}`);
  console.log(`rippling_raw_spend_lines_latest rows loaded: ${extMap.size}`);
  console.log("");

  // ─── A. Full reason distribution across ALL rippling_spend rows ─────
  console.log(`## A. Reason distribution across every rippling_spend row`);
  const byReason = new Map();
  for (const r of allPA) {
    const key = r.excluded ? (r.reason || "(null)") : "(not excluded)";
    if (!byReason.has(key)) byReason.set(key, { n: 0, sum: 0 });
    const e = byReason.get(key);
    e.n += 1;
    e.sum += Number(r.amount || 0);
  }
  console.log(`  ${"reason".padEnd(24)} ${"rows".padStart(6)}  ${"$sum".padStart(14)}`);
  for (const key of [...byReason.keys()].sort()) {
    const e = byReason.get(key);
    console.log(`  ${key.padEnd(24)} ${String(e.n).padStart(6)}  ${fmt$(e.sum).padStart(14)}`);
  }
  console.log("");

  // ─── B. Intersection cohort: rows whose parent_hex ∈ reportCodedParents ─
  //
  // Derive parent for each rippling_spend PA row via its source_line_id ->
  // rippling_id lookup into rippling_raw_spend_lines_latest.external_id ->
  // parentIdFromExternalId. This mirrors the derive at scripts/purchasing_rippling_sync.mjs.
  console.log(`## B. Intersection cohort: PA rippling_spend rows whose parent ∈ report_coded set`);
  let intersectRows = 0;
  let intersectSum = 0;
  const intersect = [];
  for (const r of allPA) {
    const rid = String(r.source_line_id || "").replace(/^rippling_spend:/, "");
    const ext = extMap.get(rid);
    if (!ext) continue;
    const parent = parentIdFromExternalId(ext.external_id);
    if (!parent) continue;
    if (!coded.has(parent)) continue;
    intersectRows += 1;
    intersectSum += Number(r.amount || 0);
    intersect.push(r);
  }
  console.log(`  intersection rows total: ${intersectRows}   $sum: ${fmt$(intersectSum)}`);
  const intersectCoded = intersect.filter(r => r.gl_line_code != null && String(r.gl_line_code).trim() !== "");
  const intersectUncoded = intersect.filter(r => r.gl_line_code == null || String(r.gl_line_code).trim() === "");
  console.log(`  coded on our side (glLine NOT NULL):    ${intersectCoded.length} rows / ${fmt$(intersectCoded.reduce((s, r) => s + Number(r.amount || 0), 0))}`);
  console.log(`  uncoded on our side (glLine IS NULL):   ${intersectUncoded.length} rows / ${fmt$(intersectUncoded.reduce((s, r) => s + Number(r.amount || 0), 0))}`);
  console.log(`  coded % of intersection: ${((intersectCoded.length / intersectRows) * 100).toFixed(2)}%`);
  console.log("");

  // ─── C. Where did the UNCODED intersection rows end up? ─────────────
  console.log(`## C. Reason distribution for UNCODED intersection cohort (should mostly be report_coded)`);
  const uncByReason = new Map();
  for (const r of intersectUncoded) {
    const key = r.excluded ? (r.reason || "(null)") : "(not excluded)";
    if (!uncByReason.has(key)) uncByReason.set(key, { n: 0, sum: 0 });
    const e = uncByReason.get(key);
    e.n += 1;
    e.sum += Number(r.amount || 0);
  }
  console.log(`  ${"reason".padEnd(24)} ${"rows".padStart(6)}  ${"$sum".padStart(14)}`);
  for (const key of [...uncByReason.keys()].sort()) {
    const e = uncByReason.get(key);
    console.log(`  ${key.padEnd(24)} ${String(e.n).padStart(6)}  ${fmt$(e.sum).padStart(14)}`);
  }
  console.log("");

  // ─── D. Where did the CODED intersection rows end up? ───────────────
  console.log(`## D. Reason distribution for CODED intersection cohort (should be mostly NOT excluded post-fix)`);
  const codedByReason = new Map();
  for (const r of intersectCoded) {
    const key = r.excluded ? (r.reason || "(null)") : "(not excluded)";
    if (!codedByReason.has(key)) codedByReason.set(key, { n: 0, sum: 0 });
    const e = codedByReason.get(key);
    e.n += 1;
    e.sum += Number(r.amount || 0);
  }
  console.log(`  ${"reason".padEnd(24)} ${"rows".padStart(6)}  ${"$sum".padStart(14)}`);
  for (const key of [...codedByReason.keys()].sort()) {
    const e = codedByReason.get(key);
    console.log(`  ${key.padEnd(24)} ${String(e.n).padStart(6)}  ${fmt$(e.sum).padStart(14)}`);
  }
  console.log("");
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });
