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

// Load ALL raw rows
const rows = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data } = await supa.from("rippling_raw_spend_lines_latest").select("category_id, external_id, amount, merchant_name").order("id").range(from, from + step - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < step) break;
    from += step;
  }
}

// (txn, amt_key) -> [{cat, merchant, amt}]
const dbIndex = new Map();
for (const r of rows) {
  const m = /^([a-f0-9]{24})__line_item(?:_content_([a-f0-9]{24})_(.+)_no_dimensions)?$/i.exec(r.external_id || "");
  if (!m) continue;
  const txn = m[1];
  const amtStr = m[3];
  const key = `${txn}|${amtStr || Number(r.amount).toFixed(2).replace(".", "_")}`;
  if (!dbIndex.has(key)) dbIndex.set(key, []);
  dbIndex.get(key).push({ cat: r.category_id, merchant: r.merchant_name, amt: Number(r.amount) });
}

// For each DB cat_id, collect CSV names via txn+amt matches
const catNameCounts = new Map();  // cat -> Map<name, count>
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const txn = cells[txnIdIdx];
  const name = cells[catNameIdx];
  const amt = Number(cells[amtIdx] || 0);
  const amtKey = amt.toFixed(2).replace(".", "_");
  const key = `${txn}|${amtKey}`;
  const hits = dbIndex.get(key);
  if (!hits) continue;
  for (const h of hits) {
    if (!catNameCounts.has(h.cat)) catNameCounts.set(h.cat, new Map());
    const g = catNameCounts.get(h.cat);
    g.set(name, (g.get(name) || 0) + 1);
  }
}

console.log(`db cat_ids referenced: ${catNameCounts.size}`);
const catToName = new Map();
for (const [cat, nameMap] of catNameCounts) {
  const list = [...nameMap.entries()].sort((a, b) => b[1] - a[1]);
  const [dominantName, dominantCount] = list[0];
  const total = list.reduce((s, [_, c]) => s + c, 0);
  const dominantPct = (dominantCount / total) * 100;
  catToName.set(cat, dominantName);
  if (list.length > 1 || dominantPct < 100) {
    console.log(`  cat=${cat}: ${dominantCount}/${total} (${dominantPct.toFixed(1)}%)  "${dominantName}"  others: ${list.slice(1, 4).map(([n, c]) => `"${n}"=${c}`).join(", ")}`);
  }
}

// Also print the resolved cat -> name for all
console.log("\n\nRESOLVED cat -> name:");
for (const [cat, name] of catToName) {
  console.log(`  ${cat}: "${name}"`);
}

// Compare against SCM
const scmIds = new Set();
{ let from = 0; const step = 1000;
  while (true) {
    const { data } = await supa.from("spend_category_map").select("category_id").order("category_id").range(from, from + step - 1);
    if (!data || data.length === 0) break;
    for (const r of data) scmIds.add(r.category_id);
    if (data.length < step) break;
    from += step;
  }
}
const noNameCatIds = [...scmIds].filter(id => !catToName.has(id));
console.log(`\nSCM cat_ids with NO resolved name: ${noNameCatIds.length}`);
for (const c of noNameCatIds) console.log("  ", c);
