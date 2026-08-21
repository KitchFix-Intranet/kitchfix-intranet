// _g3_step1b_date_split.mjs
//
// Approach: filter CSV rows where Category Name is one of the two collision
// names ('Equipment Lease' or '**Please Select A Category**'), then verify
// each maps to cat 68ed4977 via the (txn|amt) join to
// rippling_raw_spend_lines_latest. If the DB row's category_id matches the
// collision cat_id, we count it.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CAT = "68ed4977b7aabd4234afda3a";
const NAME_A = "Equipment Lease";
const NAME_B = "**Please Select A Category**";
const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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
function parseDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)/.exec(s || "");
  if (!m) return null;
  let [_, mo, d, y, hh, mm, ap] = m;
  hh = Number(hh); if (ap === "PM" && hh < 12) hh += 12; if (ap === "AM" && hh === 12) hh = 0;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hh, Number(mm)));
}

// 1) load DB rows for cat + build (txn|amt) -> exists
const dbKeys = new Set();
{
  let from = 0; const step = 1000;
  for (;;) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
      .select("external_id, amount")
      .eq("category_id", CAT)
      .order("id").range(from, from + step - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const idx = r.external_id.indexOf("__line_item");
      const txn = idx > 0 ? r.external_id.slice(0, idx) : null;
      const amtStr = r.amount != null ? Number(r.amount).toFixed(2) : null;
      if (!txn || amtStr == null) continue;
      dbKeys.add(`${txn}|${amtStr}`);
    }
    if (data.length < step) break;
    from += step;
  }
}
console.log(`[db] cat=${CAT} distinct (txn|amt) count: ${dbKeys.size}`);

// 2) walk CSV; keep rows where Category Name is one of the two AND DB join hits.
const records = loadCsvRecords(CSV);
const header = parseCsvLine(records[0]);
const IDX_TXN = header.indexOf("Transaction ID");
const IDX_PURCHASED_AT = header.indexOf("Purchased at");
const IDX_CATNAME = header.indexOf("Category Name");
const IDX_AMT = header.indexOf("Amount (by category)");

const matched = [];
let a_seen = 0, b_seen = 0, a_matched = 0, b_matched = 0;
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const name = cells[IDX_CATNAME];
  if (name !== NAME_A && name !== NAME_B) continue;
  if (name === NAME_A) a_seen++; else b_seen++;
  const txn = cells[IDX_TXN];
  const amt = Number(cells[IDX_AMT] || 0);
  const key = `${txn}|${amt.toFixed(2)}`;
  if (!dbKeys.has(key)) continue;
  if (name === NAME_A) a_matched++; else b_matched++;
  matched.push({ txn, purchasedAt: cells[IDX_PURCHASED_AT], name, amt });
}
console.log(`[csv] Category Name='${NAME_A}': seen=${a_seen} matched-to-cat=${a_matched}`);
console.log(`[csv] Category Name='${NAME_B}': seen=${b_seen} matched-to-cat=${b_matched}`);
console.log(`[csv] total matched rows: ${matched.length}`);

matched.sort((a, b) => (parseDate(a.purchasedAt) || 0) - (parseDate(b.purchasedAt) || 0));

console.log("\n[date] sorted by Purchased at:");
console.log("  " + ["#", "Purchased at", "Category Name", "Amount"].join("  |  "));
for (let i = 0; i < matched.length; i++) {
  const r = matched[i];
  console.log(`  ${(i+1).toString().padStart(3)}  |  ${r.purchasedAt.padEnd(30)}  |  ${r.name.padEnd(35)}  |  $${r.amt.toFixed(2).padStart(10)}`);
}

// Verdict
const dates = matched.map(r => ({ d: parseDate(r.purchasedAt), n: r.name })).filter(x => x.d);
const nameCounts = {};
for (const x of dates) nameCounts[x.n] = (nameCounts[x.n] || 0) + 1;
console.log("\n[verdict] name histogram (matched rows):");
for (const [n, c] of Object.entries(nameCounts)) console.log(`  ${c.toString().padStart(4)}  ${n}`);

if (dates.length && Object.keys(nameCounts).length === 2) {
  const names = Object.keys(nameCounts);
  let cleanSplit = null;
  for (const [firstName, secondName] of [[names[0], names[1]], [names[1], names[0]]]) {
    let boundary = -1;
    let ok = true;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i].n === firstName) {
        if (boundary !== -1) { ok = false; break; }
      } else if (dates[i].n === secondName) {
        if (boundary === -1) boundary = i;
      } else { ok = false; break; }
    }
    if (ok && boundary !== -1) {
      cleanSplit = { firstName, secondName, boundaryIdx: boundary, boundaryDate: dates[boundary].d.toISOString(), prevDate: dates[boundary-1]?.d.toISOString() || null };
      break;
    }
  }
  if (cleanSplit) {
    console.log(`\n[verdict] CLEAN SPLIT: '${cleanSplit.firstName}' then '${cleanSplit.secondName}'.`);
    console.log(`  last '${cleanSplit.firstName}' at ${cleanSplit.prevDate}`);
    console.log(`  first '${cleanSplit.secondName}' at ${cleanSplit.boundaryDate}`);
    console.log(`  -> RENAME. Later name governs.`);
  } else {
    console.log(`\n[verdict] INTERLEAVED. The id is permanently ambiguous.`);
    let runs = []; let cur = { name: dates[0].n, start: dates[0].d, end: dates[0].d, count: 1 };
    for (let i = 1; i < dates.length; i++) {
      if (dates[i].n === cur.name) { cur.end = dates[i].d; cur.count++; }
      else { runs.push(cur); cur = { name: dates[i].n, start: dates[i].d, end: dates[i].d, count: 1 }; }
    }
    runs.push(cur);
    console.log(`  runs (${runs.length}):`);
    for (const r of runs) console.log(`    ${r.name.padEnd(35)}  ${r.start.toISOString().slice(0,10)} .. ${r.end.toISOString().slice(0,10)}  (${r.count} rows)`);
  }
} else if (Object.keys(nameCounts).length === 1) {
  console.log(`\n[verdict] OTHER: only one of the two names appears in matched CSV rows (${Object.keys(nameCounts)[0]}). The other name (${dates[0]?.n === NAME_A ? NAME_B : NAME_A}) never joins to this cat_id.`);
} else {
  console.log(`\n[verdict] OTHER: matched rows contain ${Object.keys(nameCounts).length} distinct names.`);
}
