/* Check cat 68ed4977b7aabd4234afda3a - how many CSV rows call it "Dues" vs
   "Please Select" vs other? */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function parseCsvLine(line) {
  const out = []; let cur = ""; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQuote = false; else cur += c; }
    else { if (c === '"') inQuote = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur); return out;
}
const raw = fs.readFileSync("/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv", "utf8");
const records = [];
{ let cur = ""; let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') { if (inQuote && raw[i + 1] === '"') { cur += '""'; i++; } else { cur += c; inQuote = !inQuote; } }
    else if (c === "\n" && !inQuote) { records.push(cur); cur = ""; }
    else if (c === "\r" && !inQuote) {} else cur += c;
  }
  if (cur.length) records.push(cur);
}
const header = parseCsvLine(records[0]);
const catNameIdx = header.indexOf("Category Name");
const txnIdIdx = header.indexOf("Transaction ID");
const amtIdx = header.indexOf("Amount (by category)");

// Build csv txn -> name+amt
const csv = new Map();
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  csv.set(cells[txnIdIdx], { name: cells[catNameIdx], amt: Number(cells[amtIdx]) });
}

// Fetch all raw rows for target cat
const target = "68ed4977b7aabd4234afda3a";
const rows = [];
let from = 0;
for (;;) {
  const { data } = await supa.from("rippling_raw_spend_lines_latest").select("external_id, amount, rippling_id").eq("category_id", target).order("id").range(from, from + 999);
  if (!data || data.length === 0) break;
  rows.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`raw rows for ${target}: ${rows.length}`);

// distribution of CSV names for these rows
const nameCounts = new Map();
let matched = 0; let unmatched = 0;
for (const r of rows) {
  const idx = r.external_id.indexOf("__line_item");
  const t = idx > 0 ? r.external_id.slice(0, idx) : null;
  if (!t) { unmatched++; continue; }
  const c = csv.get(t);
  if (!c) { unmatched++; continue; }
  matched++;
  nameCounts.set(c.name, (nameCounts.get(c.name) || 0) + 1);
}
console.log(`matched=${matched} unmatched=${unmatched}`);
console.log(`CSV-name distribution:`);
for (const [n, c] of [...nameCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.toString().padStart(6)}  "${n}"`);
