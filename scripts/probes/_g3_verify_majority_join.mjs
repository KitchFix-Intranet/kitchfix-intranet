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

// Build (txn, amt_key) -> [cat_ids...]
const dbIndex = new Map();
for (const r of rows) {
  const m = /^([a-f0-9]{24})__line_item(?:_content_([a-f0-9]{24})_(.+)_no_dimensions)?$/i.exec(r.external_id || "");
  if (!m) continue;
  const txn = m[1];
  const amtStr = m[3];
  const key = `${txn}|${amtStr || Number(r.amount).toFixed(2).replace(".", "_")}`;
  if (!dbIndex.has(key)) dbIndex.set(key, []);
  dbIndex.get(key).push(r.category_id);
}

// name -> Map<cat_id, count>
const nameCatCounts = new Map();
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const txn = cells[txnIdIdx];
  const name = cells[catNameIdx];
  const amt = Number(cells[amtIdx] || 0);
  const amtKey = amt.toFixed(2).replace(".", "_");
  const key = `${txn}|${amtKey}`;
  const hits = dbIndex.get(key);
  if (!hits) continue;
  for (const cat of hits) {
    if (!nameCatCounts.has(name)) nameCatCounts.set(name, new Map());
    const g = nameCatCounts.get(name);
    g.set(cat, (g.get(cat) || 0) + 1);
  }
}

// Majority vote per name
const nameToCat = new Map();
for (const [name, catMap] of nameCatCounts) {
  const list = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = list[0][0];
  const dominantCount = list[0][1];
  const secondCount = list[1]?.[1] || 0;
  const total = list.reduce((s, [_, c]) => s + c, 0);
  const dominantPct = (dominantCount / total) * 100;
  console.log(`  ${dominantCount.toString().padStart(4)}/${total.toString().padStart(4)} (${dominantPct.toFixed(1)}%)  ${dominant}  <-- ${name}${list.length > 1 ? ` (2nd: ${list[1][0]}=${secondCount})` : ""}`);
  nameToCat.set(name, dominant);
}
console.log(`\nname -> cat_id resolved: ${nameToCat.size}`);

// Now invert: cat_id -> name (unique names per cat)
const catToNames = new Map();
for (const [name, cat] of nameToCat) {
  if (!catToNames.has(cat)) catToNames.set(cat, new Set());
  catToNames.get(cat).add(name);
}
console.log(`\ndistinct cat_ids referenced: ${catToNames.size}`);
let multiNameCats = 0;
for (const [cat, names] of catToNames) {
  if (names.size > 1) { multiNameCats++; console.log(`  MULTI cat=${cat}: ${[...names].join(" | ")}`); }
}
console.log(`multi-name cat_ids: ${multiNameCats}`);
