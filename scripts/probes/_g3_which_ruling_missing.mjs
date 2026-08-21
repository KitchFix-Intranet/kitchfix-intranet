// Ad-hoc probe: which of the 21 RULINGS keys did NOT match any category name
// resolved by the applier's CSV/DB join? Runs in the audit clone.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
const RULING_NAMES = [
  "Operations Travel","Dues & Subscriptions","Sales Travel",
  "General Repair & Maintenance","Sales Function Event","Computer Hardware",
  "Leased Vehicles","Perks","Building Lease","License & Fees",
  "Meals & Entertainment","Storage Lease","Equipment Lease","General Utilities",
  "Recruiting","Printer Lease","Office Supplies","General Liability Insurance",
  "Account Management Travel","Training","Due to EE",
];

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
function loadCsvRecords(path) {
  const raw = fs.readFileSync(path, "utf8");
  const records = []; let cur = ""; let inQuote = false;
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
  return records;
}

// Repro the applier's cat->name resolution exactly
async function buildCatToName() {
  const CONFIDENCE_THRESHOLD = 0.5;
  const records = loadCsvRecords(CSV);
  const header = parseCsvLine(records[0]);
  const txnIdIdx = header.indexOf("Transaction ID");
  const catNameIdx = header.indexOf("Category Name");
  const amtIdx = header.indexOf("Amount (by category)");
  const dbIndex = new Map();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("category_id, external_id, amount")
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (!r.external_id) continue;
      const m = /^([a-f0-9]{24})__line_item(?:_content_([a-f0-9]{24})_(.+)_no_dimensions)?$/i.exec(r.external_id);
      if (!m) continue;
      const txn = m[1];
      const amtStr = m[3] || (r.amount != null ? Number(r.amount).toFixed(2).replace(".", "_") : null);
      if (!amtStr) continue;
      const key = `${txn}|${amtStr}`;
      if (!dbIndex.has(key)) dbIndex.set(key, []);
      dbIndex.get(key).push(r.category_id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const nameToCatCounts = new Map();
  for (let n = 1; n < records.length; n++) {
    const cells = parseCsvLine(records[n]);
    const txn = cells[txnIdIdx]; const name = cells[catNameIdx]; const amt = Number(cells[amtIdx] || 0);
    if (!txn || !name) continue;
    const amtStr = amt.toFixed(2).replace(".", "_");
    const key = `${txn}|${amtStr}`;
    const hits = dbIndex.get(key); if (!hits) continue;
    for (const cat of hits) {
      if (!nameToCatCounts.has(name)) nameToCatCounts.set(name, new Map());
      const g = nameToCatCounts.get(name);
      g.set(cat, (g.get(cat) || 0) + 1);
    }
  }
  const nameToCat = new Map();
  for (const [name, catMap] of nameToCatCounts) {
    const list = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
    const [cat, count] = list[0];
    const total = list.reduce((s, [_, c]) => s + c, 0);
    const pct = count / total;
    nameToCat.set(name, { cat, count, total, pct });
  }
  const catToName = new Map();
  for (const [name, r] of nameToCat) {
    if (r.pct < CONFIDENCE_THRESHOLD) continue;
    const existing = catToName.get(r.cat);
    if (!existing || r.count > existing.count) catToName.set(r.cat, { name, count: r.count });
  }
  const out = new Map();
  for (const [cat, { name }] of catToName) out.set(cat, name);
  return { catToName: out, nameToCat };
}

const { catToName, nameToCat } = await buildCatToName();
const resolvedNames = new Set(catToName.values());
console.log("=== RULING NAMES matched by applier's cat->name output ===");
for (const rn of RULING_NAMES) {
  const hit = resolvedNames.has(rn);
  const cand = nameToCat.get(rn);
  console.log(`  ${hit ? "MATCH" : "MISS "}  ${rn.padEnd(40)}  ${cand ? `cand cat=${cand.cat} count=${cand.count}/${cand.total} pct=${(cand.pct*100).toFixed(0)}%` : "no CSV row joined"}`);
}
const acks = ["**Please Select A Category**","Equipment"];
console.log("\n=== ACKNOWLEDGED_UNROUTED names ===");
for (const rn of acks) {
  const hit = resolvedNames.has(rn);
  const cand = nameToCat.get(rn);
  console.log(`  ${hit ? "MATCH" : "MISS "}  ${rn.padEnd(40)}  ${cand ? `cand cat=${cand.cat} count=${cand.count}/${cand.total} pct=${(cand.pct*100).toFixed(0)}%` : "no CSV row joined"}`);
}
