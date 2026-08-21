#!/usr/bin/env node
/* G3 5: join CSV transactions to DB via Transaction ID.
   The CSV Transaction ID looks like Rippling parent txn id (24 hex).
   In DB rippling_raw_spend_lines_latest we have parent_txn_id + category_id.
   Build: category_id -> Category Name text
*/

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const raw = fs.readFileSync(CSV, "utf8");
const records = [];
{
  let cur = "";
  let inQuote = false;
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

// build txn_id -> { name, amt, vend }
const csvByTxn = new Map();
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const t = cells[txnIdIdx];
  if (!t) continue;
  const rec = { name: cells[catNameIdx], amt: Number(cells[amtIdx] || 0), vend: cells[vendIdx] };
  if (!csvByTxn.has(t)) csvByTxn.set(t, []);
  csvByTxn.get(t).push(rec);
}
console.log(`csv distinct transaction ids: ${csvByTxn.size} rows: ${records.length - 1}`);
// sample: 3 keys
let n = 0;
for (const [k, v] of csvByTxn) { console.log(`  ${k} -> ${v.length} lines, first="${v[0].name}"`); if (++n>=3) break; }

// look up in DB via parent_txn_id
const sampleTxns = [...csvByTxn.keys()].slice(0, 5);
for (const t of sampleTxns) {
  const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
    .select("category_id, parent_txn_id, merchant_name")
    .eq("parent_txn_id", t)
    .limit(5);
  if (error) { console.log("err", error); continue; }
  console.log(`\nCSV txn ${t} -> DB matches: ${data.length}`);
  for (const r of data) console.log(`  cat=${r.category_id} merchant=${r.merchant_name}`);
}
