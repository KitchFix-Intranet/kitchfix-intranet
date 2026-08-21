#!/usr/bin/env node
/* G3 7: build category_id -> Category Name map by joining CSV Transaction IDs
   to DB rippling_raw_spend_lines_latest.external_id.
   Also aggregate FYTD dollars + top merchants + Rippling line counts per category_id.

   Output: JSON to stdout with two collections:
     categories: [{ category_id, name, fytd_from_csv, csv_row_count, db_merchants: [top3], db_row_count, db_amount_sum }]
     summary: { csv_rows, csv_txns, db_rows, matched_pct, unmapped_categories: [...] }
*/

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";

// -------- CSV parse ----------
function parseCsvLine(line) {
  const out = []; let cur = ""; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur); return out;
}

const raw = fs.readFileSync(CSV, "utf8");
const records = [];
{
  let cur = ""; let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (inQuote && raw[i + 1] === '"') { cur += '""'; i++; }
      else { cur += c; inQuote = !inQuote; }
    } else if (c === "\n" && !inQuote) { records.push(cur); cur = ""; }
    else if (c === "\r" && !inQuote) {}
    else cur += c;
  }
  if (cur.length) records.push(cur);
}
const header = parseCsvLine(records[0]);
const txnIdIdx = header.indexOf("Transaction ID");
const catNameIdx = header.indexOf("Category Name");
const amtIdx = header.indexOf("Amount (by category)");
const vendIdx = header.indexOf("Vendor name");

// txn_id -> array of { name, amt, vend }
const csvByTxn = new Map();
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const t = cells[txnIdIdx]; if (!t) continue;
  if (!csvByTxn.has(t)) csvByTxn.set(t, []);
  csvByTxn.get(t).push({ name: cells[catNameIdx], amt: Number(cells[amtIdx] || 0), vend: cells[vendIdx] });
}

// -------- DB: pull all raw spend lines paginated ----------
const dbRows = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
      .select("category_id, external_id, merchant_name, amount")
      .order("id")
      .range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    dbRows.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
process.stderr.write(`db raw rows: ${dbRows.length}\n`);

// parse txn_id from external_id (prefix before "__line_item")
function txnFromExt(ext) {
  if (!ext) return null;
  const idx = ext.indexOf("__line_item");
  if (idx < 0) return null;
  return ext.slice(0, idx);
}

// build category_id -> aggregation
// Also build txn_id -> category_id set (in case there are multi-cat rare, but not expected)
const dbByCat = new Map();  // cat_id -> { merchants: Map, amount: number, row_count: number, txns: Set }
for (const r of dbRows) {
  const t = txnFromExt(r.external_id);
  const c = r.category_id;
  if (!c) continue;
  if (!dbByCat.has(c)) dbByCat.set(c, { merchants: new Map(), amount: 0, row_count: 0, txns: new Set() });
  const g = dbByCat.get(c);
  g.row_count++;
  g.amount += Number(r.amount || 0);
  if (r.merchant_name) g.merchants.set(r.merchant_name, (g.merchants.get(r.merchant_name) || 0) + 1);
  if (t) g.txns.add(t);
}

// build txn_id -> cat_id (via external_id parse, first-seen wins)
const dbTxnToCat = new Map();
for (const r of dbRows) {
  const t = txnFromExt(r.external_id);
  if (!t) continue;
  if (!dbTxnToCat.has(t)) dbTxnToCat.set(t, r.category_id);
}

// Now for CSV: use txn_id to look up cat_id, then attach the Category Name text
const catIdToName = new Map();
const csvCatIdAgg = new Map();   // cat_id -> { name, fytd, top_merchants Map, csv_row_count }
let matchedTxns = 0;
let unmatchedCsvRows = 0;
for (const [t, arr] of csvByTxn) {
  const catId = dbTxnToCat.get(t);
  if (!catId) { unmatchedCsvRows += arr.length; continue; }
  matchedTxns++;
  for (const r of arr) {
    if (!catIdToName.has(catId) || catIdToName.get(catId) === "" || catIdToName.get(catId) === "null") {
      catIdToName.set(catId, r.name || "");
    }
    if (!csvCatIdAgg.has(catId)) csvCatIdAgg.set(catId, { name: r.name, fytd: 0, top_merchants: new Map(), csv_row_count: 0 });
    const g = csvCatIdAgg.get(catId);
    g.fytd += r.amt;
    g.csv_row_count++;
    if (r.vend) g.top_merchants.set(r.vend, (g.top_merchants.get(r.vend) || 0) + 1);
    if (!g.name || g.name === "null") g.name = r.name;
  }
}
process.stderr.write(`matched CSV txns: ${matchedTxns} / ${csvByTxn.size}\n`);
process.stderr.write(`unmatched CSV rows: ${unmatchedCsvRows}\n`);

// Build final combined map: every category_id in DB, with name from catIdToName if available
const scm = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("spend_category_map").select("category_id, category_label, merchant_sample, gl_line_code").order("category_id").range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    scm.push(...data);
    if (data.length < step) break;
    from += step;
  }
}

const scmIds = new Set(scm.map(r => r.category_id));
const dbCatIds = new Set(dbByCat.keys());
const namedIds = new Set(catIdToName.keys());
process.stderr.write(`\nscm ids: ${scmIds.size}\n`);
process.stderr.write(`db raw distinct cat ids: ${dbCatIds.size}\n`);
process.stderr.write(`ids with a Name from CSV: ${namedIds.size}\n`);

// missing names
const missingNames = [...dbCatIds].filter(id => !namedIds.has(id));
process.stderr.write(`ids in DB but NO name from CSV: ${missingNames.length}\n`);

// output
const out = {
  csv_rows: records.length - 1,
  csv_txns: csvByTxn.size,
  matched_txns: matchedTxns,
  unmatched_csv_rows: unmatchedCsvRows,
  db_raw_rows: dbRows.length,
  scm_size: scm.length,
  db_distinct_cats: dbCatIds.size,
  named_ids: namedIds.size,
  missing_names_from_csv: missingNames.length,
  categories: [...dbCatIds].map(cid => {
    const g = dbByCat.get(cid);
    const csvA = csvCatIdAgg.get(cid) || null;
    const topMerchants = [...g.merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m, n]) => `${m} (${n})`);
    return {
      category_id: cid,
      name: catIdToName.get(cid) || null,
      db_amount_sum: g.amount,
      db_row_count: g.row_count,
      db_top_merchants: topMerchants,
      csv_fytd: csvA ? csvA.fytd : null,
      csv_row_count: csvA ? csvA.csv_row_count : 0,
    };
  }).sort((a, b) => b.db_amount_sum - a.db_amount_sum),
};

fs.writeFileSync("/tmp/g3_catmap.json", JSON.stringify(out, null, 2));
process.stderr.write(`\nwrote /tmp/g3_catmap.json (${out.categories.length} categories)\n`);
// print top categories to stdout
console.log("cat_id                              | name                                                | db_amount     | csv_fytd    | top_merchants");
for (const c of out.categories) {
  const n = (c.name || "(no CSV name)").slice(0, 50).padEnd(50);
  console.log(`${c.category_id} | ${n} | $${String(c.db_amount_sum.toFixed(2)).padStart(12)} | ${c.csv_fytd !== null ? "$" + c.csv_fytd.toFixed(2) : "(none)"} | ${c.db_top_merchants.slice(0, 3).join("; ")}`);
}
