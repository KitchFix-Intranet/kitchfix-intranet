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

// Load all raw rows
const rows = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data } = await supa.from("rippling_raw_spend_lines_latest").select("category_id, external_id, amount").order("id").range(from, from + step - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
console.log(`raw rows: ${rows.length}`);

// Build map: (txn_id, cat_id_from_ext, amt) -> canonical_cat_id (should = category_id column)
// Extract cat_id from external_id pattern
const dbIndex = new Map();  // key = txn|amt_str
for (const r of rows) {
  const m = /^([a-f0-9]{24})__line_item(?:_content_([a-f0-9]{24})_(.+)_no_dimensions)?$/i.exec(r.external_id || "");
  if (!m) continue;
  const [_, txn, catInExt, amtStr] = m;
  // key by txn + amt string (not floats)
  const key = `${txn}|${amtStr || Number(r.amount).toFixed(2).replace(".", "_")}`;
  if (!dbIndex.has(key)) dbIndex.set(key, []);
  dbIndex.get(key).push({ cat: r.category_id, catInExt, amt: Number(r.amount) });
}
console.log(`db index size: ${dbIndex.size}`);

// For each CSV row, try (txn, amt) join
const csvCatIdCounts = new Map(); // name -> cat_id counts
let matched = 0; let unmatched = 0; let multi = 0;
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const txn = cells[txnIdIdx];
  const name = cells[catNameIdx];
  const amt = Number(cells[amtIdx] || 0);
  const amtKey = amt.toFixed(2).replace(".", "_");
  const key = `${txn}|${amtKey}`;
  const hits = dbIndex.get(key);
  if (!hits || hits.length === 0) { unmatched++; continue; }
  if (hits.length > 1) multi++;
  matched++;
  const cat = hits[0].cat;
  if (!csvCatIdCounts.has(name)) csvCatIdCounts.set(name, new Map());
  const g = csvCatIdCounts.get(name);
  g.set(cat, (g.get(cat) || 0) + 1);
}
console.log(`\nCSV rows: matched=${matched} unmatched=${unmatched} multi_hit=${multi}`);
console.log(`\ndistinct names in CSV: ${csvCatIdCounts.size}`);

// Print: for each name, which cat_ids
console.log("\nName -> cat_id counts (top few for ambiguous ones):");
for (const [name, catMap] of csvCatIdCounts) {
  const list = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
  if (list.length > 1) {
    console.log(`  AMBIG "${name}": ${list.map(([c, n]) => `${c}=${n}`).join(", ")}`);
  }
}

// For "**Please Select A Category**"
console.log("\nSpecifically Please Select:");
const psMap = csvCatIdCounts.get("**Please Select A Category**");
if (!psMap) console.log("  none matched"); else for (const [c, n] of psMap) console.log(`  ${c}: ${n}`);
