// INV-P8b DIG-2 - answer:
//   1. normalized_amount on non-USD lines: is it USD-converted?
//   2. purchase_type distribution across all lines - what values appear?
//   3. created_at range on lines (candidate real-txn timestamp)
//   4. INV-P8b table-history: how many prior rows in the append-only raw table?
//   5. Confirm sync-history: check purchasing_sync_locks + purchasing_derive_runs
//   6. What does the CSV look like broken down by MONTH of Purchased at?
//   7. Detailed superseded shape - reconcile the 78 count from INV-P8

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import readline from "node:readline";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("missing env"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

function fmt(n) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function cents(n) { return Math.round(Number(n || 0) * 100); }
const HEX24 = /^[a-f0-9]{24}$/;
function parseParentFromExternal(external_id) {
  if (!external_id || typeof external_id !== "string") return null;
  const idx = external_id.indexOf("__");
  if (idx <= 0) return null;
  const tok = external_id.slice(0, idx).toLowerCase();
  return HEX24.test(tok) ? tok : null;
}
async function paginate(qBuilder, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await qBuilder(from, from + pageSize - 1);
    if (q.error) throw q.error;
    const rows = q.data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ============ 1. normalized_amount on non-USD lines ============
console.log("=".repeat(70));
console.log("1. normalized_amount on non-USD lines");
console.log("=".repeat(70));
const nonUsdRaw = await paginate((f, t) => supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, external_id, amount, currency, raw")
  .neq("currency", "USD")
  .order("rippling_id").range(f, t), 1000);
console.log(`non-USD rows: ${nonUsdRaw.length}`);
let normPresent = 0, normNull = 0;
const normValues = [];
for (const r of nonUsdRaw) {
  const raw = r.raw || {};
  const na = raw.normalized_amount;
  if (na !== null && na !== undefined && na !== "") {
    normPresent++;
    normValues.push({ currency: r.currency, native: Number(r.amount || 0), normalized: na });
  } else {
    normNull++;
  }
}
console.log(`normalized_amount present: ${normPresent}   null: ${normNull}`);
if (normValues.length > 0) {
  console.log("sample normalized_amount values (up to 10):");
  for (const v of normValues.slice(0, 10)) {
    console.log(`  currency=${v.currency}  native=${v.native}  normalized=${JSON.stringify(v.normalized)}`);
  }
}

// ============ 2. purchase_type distribution ============
console.log("");
console.log("=".repeat(70));
console.log("2. purchase_type distribution (all rows)");
console.log("=".repeat(70));
const allRaw = await paginate((f, t) => supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, raw")
  .order("rippling_id").range(f, t), 1000);
const ptCounts = new Map();
for (const r of allRaw) {
  const pt = r.raw?.purchase_type ?? "(null)";
  ptCounts.set(pt, (ptCounts.get(pt) || 0) + 1);
}
for (const [k, n] of [...ptCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(30)}  ${n}`);
}

// ============ 3. created_at range on lines ============
console.log("");
console.log("=".repeat(70));
console.log("3. created_at range on line payload");
console.log("=".repeat(70));
const createdAts = [];
for (const r of allRaw) {
  const ca = r.raw?.created_at;
  if (ca) createdAts.push(String(ca).slice(0, 10));
}
createdAts.sort();
console.log(`created_at count: ${createdAts.length}   earliest: ${createdAts[0]}   latest: ${createdAts[createdAts.length - 1]}`);
// month bucket
const monthBucket = new Map();
for (const d of createdAts) {
  const m = d.slice(0, 7);
  monthBucket.set(m, (monthBucket.get(m) || 0) + 1);
}
console.log("month distribution of created_at:");
for (const [m, n] of [...monthBucket.entries()].sort()) {
  console.log(`  ${m}   ${n}`);
}

// ============ 4. raw table history ============
console.log("");
console.log("=".repeat(70));
console.log("4. rippling_raw_spend_lines (NOT _latest): row count + first_seen_at span");
console.log("=".repeat(70));
// count total rows in append-only table
const { count: rawTotal, error: rc } = await supa
  .from("rippling_raw_spend_lines")
  .select("*", { count: "exact", head: true });
if (rc) console.error(`err count raw: ${rc.message}`);
else console.log(`total rows in rippling_raw_spend_lines: ${rawTotal}`);

// distinct first_seen_at DAYS in the raw table (not _latest) - pagination for distinctness
// Sample: get the distinct dates using an aggregate proxy - fetch first_seen_at with limit and manual distinct.
console.log("distinct first_seen_at days in raw table (sample of 5000):");
const { data: sampleTs, error: rte } = await supa
  .from("rippling_raw_spend_lines")
  .select("first_seen_at")
  .order("first_seen_at", { ascending: true })
  .limit(5000);
if (rte) console.error(rte.message);
else {
  const days = new Set();
  for (const r of sampleTs || []) if (r.first_seen_at) days.add(String(r.first_seen_at).slice(0, 10));
  console.log(`  first 5000: distinct days = ${days.size}  ${[...days].sort().slice(0, 20).join(" | ")}`);
}
// Same for last 5000
const { data: sampleTsEnd, error: rte2 } = await supa
  .from("rippling_raw_spend_lines")
  .select("first_seen_at")
  .order("first_seen_at", { ascending: false })
  .limit(5000);
if (rte2) console.error(rte2.message);
else {
  const days = new Set();
  for (const r of sampleTsEnd || []) if (r.first_seen_at) days.add(String(r.first_seen_at).slice(0, 10));
  console.log(`  last 5000: distinct days = ${days.size}  ${[...days].sort().slice(0, 20).join(" | ")}`);
}

// ============ 5. purchasing_derive_runs recent activity ============
console.log("");
console.log("=".repeat(70));
console.log("5. purchasing_derive_runs recent activity");
console.log("=".repeat(70));
const { data: runs, error: re } = await supa
  .from("purchasing_derive_runs")
  .select("id, source, fetch_source, started_at, completed_at, status, lines_written")
  .eq("source", "rippling_spend")
  .order("started_at", { ascending: false })
  .limit(15);
if (re) console.error(re.message);
else for (const r of runs || []) {
  console.log(`  ${r.started_at}  status=${r.status}  lines=${r.lines_written}  fetch_source=${r.fetch_source}`);
}

// ============ 6. CSV month distribution ============
console.log("");
console.log("=".repeat(70));
console.log("6. CSV monthly volume (Purchased at)");
console.log("=".repeat(70));
const CSV_PATH = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
function parseCsvLine(line) {
  const out = [];
  let i = 0, cur = "", inQ = false;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { out.push(cur); cur = ""; i++; continue; }
      cur += c; i++;
    }
  }
  out.push(cur);
  return { fields: out, inQuote: inQ };
}
function parseRipDate(s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}
const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity });
let n = 0, hdr = null, hdrIdx = {};
const monthCsv = new Map();
const monthCsvDollars = new Map();
let pend = "";
for await (const raw of rl) {
  n++;
  const line = pend + raw;
  const p = parseCsvLine(line);
  if (p.inQuote) { pend = line + "\n"; continue; }
  pend = "";
  if (!hdr) {
    if (n === 1) { hdr = p.fields; hdrIdx = Object.fromEntries(hdr.map((h, i) => [h, i])); }
    continue;
  }
  if (p.fields.length === 1 && p.fields[0] === "") continue;
  const d = parseRipDate(p.fields[hdrIdx["Purchased at"]]);
  const m = d ? d.slice(0, 7) : "(null)";
  const amt = Number(p.fields[hdrIdx["Amount (by category)"]] || 0);
  monthCsv.set(m, (monthCsv.get(m) || 0) + 1);
  monthCsvDollars.set(m, (monthCsvDollars.get(m) || 0) + amt);
}
for (const m of [...monthCsv.keys()].sort()) {
  console.log(`  ${m}  rows=${monthCsv.get(m).toString().padStart(4)}  $=${fmt(monthCsvDollars.get(m)).padStart(14)}`);
}

// ============ 7. Detailed superseded shape reconciliation ============
console.log("");
console.log("=".repeat(70));
console.log("7. superseded shape: reconcile with INV-P8's 78 parents / $13,173.49");
console.log("=".repeat(70));
// From INV-P8: "78 parents, $13,173.49, where each of our lines equals the parent's full amount"
// Interpretation: parents where all lines share ONE amount (bucketA from dig1), BUT filtered
// to those where the coexisting parent has that amount as a documented total. Since parent is
// blocked, apply the following approximation: bucketA parents where max amount == 100% of an
// implicit single-txn total. Without parent total, we can only report bucketA (109 parents).
// However, INV-P8 could have used a stricter criteria. Let's break bucketA down by N:
const byParent = new Map();
for (const r of allRaw) {
  const p24 = parseParentFromExternal(r.raw?.external_id);
  if (!p24) continue;
  if (!byParent.has(p24)) byParent.set(p24, []);
  byParent.get(p24).push(Number(r.raw?.amount?.value ?? 0));
}
const bucketAByN = new Map(); // N -> { parents, storedDollars, canonicalDollars }
for (const [k, arr] of byParent.entries()) {
  if (arr.length < 2) continue;
  const distinctCents = new Set(arr.map(cents));
  if (distinctCents.size !== 1) continue;
  const stored = arr.reduce((a, b) => a + b, 0);
  const rec = bucketAByN.get(arr.length) || { parents: 0, storedDollars: 0, canonicalDollars: 0 };
  rec.parents++;
  rec.storedDollars += stored;
  rec.canonicalDollars += arr[0];
  bucketAByN.set(arr.length, rec);
}
console.log("bucketA (all-lines-equal) breakdown by line count N:");
for (const [n, rec] of [...bucketAByN.entries()].sort((a, b) => a[0] - b[0])) {
  const over = rec.storedDollars - rec.canonicalDollars;
  console.log(`  N=${n}  parents=${String(rec.parents).padStart(4)}  stored=$${fmt(rec.storedDollars).padStart(12)}  canonical=$${fmt(rec.canonicalDollars).padStart(12)}  over=$${fmt(over).padStart(12)}`);
}
// Also count parents with distinct amounts (bucketC - legit)
let bucketC_parents = 0, bucketC_lines = 0, bucketC_dollars = 0;
for (const [k, arr] of byParent.entries()) {
  if (arr.length < 2) continue;
  const distinctCents = new Set(arr.map(cents));
  if (distinctCents.size === 1) continue;
  bucketC_parents++;
  bucketC_lines += arr.length;
  bucketC_dollars += arr.reduce((a, b) => a + b, 0);
}
console.log(`bucketC (multi-amount): parents=${bucketC_parents} lines=${bucketC_lines} $=${fmt(bucketC_dollars)}`);

console.error("[done]");
