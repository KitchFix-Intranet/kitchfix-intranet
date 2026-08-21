// _g3_step1_date_split_68ed4977.mjs
//
// STEP 1 (read-only): for every DB row with category_id
// '68ed4977b7aabd4234afda3a', find the CSV row it originated from
// (via Transaction ID + amount join), then print
//   Purchased at | Category Name | Amount
// sorted by purchased_at. Decide clean-split vs interleaved.
//
// Does NOT echo employee names.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CAT = "68ed4977b7aabd4234afda3a";
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

// 1) All DB rows for the collision cat_id.
const dbRows = [];
{
  let from = 0; const step = 1000;
  for (;;) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
      .select("category_id, external_id, amount, merchant_name")
      .eq("category_id", CAT)
      .order("id").range(from, from + step - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    dbRows.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
console.log(`[db] rows for cat ${CAT}: ${dbRows.length}`);

// 2) Build DB (txn, amtStr) -> [entries]
const dbByKey = new Map();
for (const r of dbRows) {
  const idx = r.external_id.indexOf("__line_item");
  const txn = idx > 0 ? r.external_id.slice(0, idx) : null;
  const amtStr = r.amount != null ? Number(r.amount).toFixed(2).replace(".", "_") : null;
  if (!txn || !amtStr) continue;
  const k = `${txn}|${amtStr}`;
  if (!dbByKey.has(k)) dbByKey.set(k, []);
  dbByKey.get(k).push(r);
}
console.log(`[db] distinct (txn|amt) keys: ${dbByKey.size}`);

// 3) Walk CSV; for each row whose key matches a db key, capture (date, name, amount).
const records = loadCsvRecords(CSV);
const header = parseCsvLine(records[0]);
const IDX_TXN = header.indexOf("Transaction ID");
const IDX_PURCHASED_AT = header.indexOf("Purchased at");
const IDX_CATNAME = header.indexOf("Category Name");
const IDX_CATID = header.indexOf("Category");
const IDX_AMT = header.indexOf("Amount (by category)");
console.log(`[csv] IDX Txn=${IDX_TXN} PurchasedAt=${IDX_PURCHASED_AT} CatName=${IDX_CATNAME} Cat=${IDX_CATID} Amt=${IDX_AMT}`);

// The CSV Category column may hold the cat_id itself OR an =HYPERLINK to it.
// Try two joins: (a) join on cat_id equality (b) join on (txn|amt) db-lookup.
const rowsA = []; // matched by Category col text/id
const rowsB = []; // matched by (txn|amt) join
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const txn = cells[IDX_TXN];
  const purchasedAt = cells[IDX_PURCHASED_AT];
  const name = cells[IDX_CATNAME];
  const catCell = cells[IDX_CATID] || "";
  const amt = Number(cells[IDX_AMT] || 0);
  const amtStr = amt.toFixed(2).replace(".", "_");
  // (a) does the Category col include our cat id?
  if (catCell.includes(CAT)) rowsA.push({ txn, purchasedAt, name, amt });
  // (b) txn|amt DB hit?
  const k = `${txn}|${amtStr}`;
  if (dbByKey.has(k)) rowsB.push({ txn, purchasedAt, name, amt });
}
console.log(`[csv] matched by Category col=${rowsA.length}  by (txn|amt) db-lookup=${rowsB.length}`);

// Also probe CSV rows whose Category Name is either of the two collision names.
let cntEquipmentLease = 0, cntPleaseSelect = 0;
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const name = cells[IDX_CATNAME];
  if (name === "Equipment Lease") cntEquipmentLease++;
  else if (name === "**Please Select A Category**") cntPleaseSelect++;
}
console.log(`[csv] rows where Category Name == 'Equipment Lease': ${cntEquipmentLease}`);
console.log(`[csv] rows where Category Name == '**Please Select A Category**': ${cntPleaseSelect}`);

// Use the cleaner join. Pick B (deterministic txn|amt) unless empty.
const chosen = rowsB.length ? rowsB : rowsA;
console.log(`\n[chosen join] using ${rowsB.length ? "(txn|amt) DB lookup" : "Category-col text match"} - ${chosen.length} rows`);

// Sort by purchased_at.
function parseDate(s) {
  // format: MM/DD/YYYY HH:MM PM MST
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)/.exec(s || "");
  if (!m) return null;
  let [_, mo, d, y, hh, mm, ap] = m;
  hh = Number(hh); if (ap === "PM" && hh < 12) hh += 12; if (ap === "AM" && hh === 12) hh = 0;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hh, Number(mm)));
}
chosen.sort((a, b) => {
  const da = parseDate(a.purchasedAt), db = parseDate(b.purchasedAt);
  if (!da || !db) return 0;
  return da - db;
});

console.log("\n[date] all matched rows sorted by Purchased at:");
console.log("  " + ["#", "Purchased_at", "Category Name", "Amount"].join("  |  "));
for (let i = 0; i < chosen.length; i++) {
  const r = chosen[i];
  console.log(`  ${(i+1).toString().padStart(3)}  |  ${r.purchasedAt.padEnd(30)}  |  ${(r.name||"").padEnd(35)}  |  $${r.amt.toFixed(2).padStart(10)}`);
}

// Verdict
const dates = chosen.map(r => ({ d: parseDate(r.purchasedAt), n: r.name })).filter(x => x.d);
const nameCounts = {};
for (const x of dates) nameCounts[x.n] = (nameCounts[x.n] || 0) + 1;
console.log("\n[verdict] name histogram (matched rows):");
for (const [n, c] of Object.entries(nameCounts)) console.log(`  ${c.toString().padStart(4)}  ${n}`);

// clean-split test: if we sort by date, is there a single boundary where all
// prior rows are one name and all later rows are the other?
if (dates.length && Object.keys(nameCounts).length === 2) {
  const names = Object.keys(nameCounts);
  // Try both directions
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
    console.log(`  -> category was RENAMED. Later name governs.`);
  } else {
    console.log(`\n[verdict] INTERLEAVED. The id is permanently ambiguous.`);
    // interleave pattern: show contiguous name-runs
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
  console.log(`\n[verdict] OTHER: only one name appears in matched CSV rows (${Object.keys(nameCounts)[0]}).`);
} else {
  console.log(`\n[verdict] OTHER: matched rows contain ${Object.keys(nameCounts).length} distinct names.`);
}
