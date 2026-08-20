// INV-P8b DIG-3 - is the endpoint returning ALL history when we walk it?
// - The custom-report FILTER is 2025-12-29 to 2026-08-20 (FYTD).
// - Endpoint has NO date filter in our sync (walkSpendLines).
// - Payload has NO real transaction_date field.
// - Line-level created_at is 2026-08-04 to 2026-08-11 = when Rippling created the line
//   (not when the transaction happened).
//
// Hypothesis: the 5,910 "ours-only" parents are ones whose real purchase date is
// OUTSIDE the report window (before 2025-12-29 or after 2026-08-20), and Rippling's
// report filters them out - but the LINE ITEMS API returns them.
//
// Test: for each ours-only parent, look up the parent Mongo ObjectID timestamp
// (first 8 hex chars = unix epoch of when the parent object was created in Mongo).
// This is a proxy for when the parent transaction was created in Rippling's system.
// If ours-only parents' Mongo timestamps skew heavily before 2025-12-29, that
// confirms the pipeline is pulling pre-window history the report filters out.

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
// Mongo ObjectID first 4 bytes = seconds since unix epoch
function mongoIdToDate(hex24) {
  if (!hex24 || hex24.length < 8) return null;
  const seconds = parseInt(hex24.substring(0, 8), 16);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
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

// Load our side
console.error("[load] rippling_raw_spend_lines_latest ...");
const oursMin = await paginate((f, t) => supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, external_id, amount")
  .order("rippling_id").range(f, t), 1000);
const byParent = new Map();
for (const r of oursMin) {
  const p24 = parseParentFromExternal(r.external_id);
  if (!p24) continue;
  if (!byParent.has(p24)) byParent.set(p24, []);
  byParent.get(p24).push(Number(r.amount || 0));
}

// Load CSV
console.error("[load] CSV ...");
const CSV_PATH = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity });
let n = 0, hdr = null, hdrIdx = {};
const repParents = new Set();
const repPurchasedByTxn = new Map();
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
  const txn = (p.fields[hdrIdx["Transaction ID"]] || "").toLowerCase();
  repParents.add(txn);
  if (!repPurchasedByTxn.has(txn)) {
    repPurchasedByTxn.set(txn, parseRipDate(p.fields[hdrIdx["Purchased at"]]));
  }
}

// Bucket our parents by presence in report and by MongoID-derived timestamp
const oursOnly = [];
const inBoth = [];
for (const k of byParent.keys()) {
  if (repParents.has(k)) inBoth.push(k);
  else oursOnly.push(k);
}
console.log(`total ours parents: ${byParent.size}`);
console.log(`  in both:  ${inBoth.length}`);
console.log(`  ours only: ${oursOnly.length}`);

// Distribution of Mongo timestamps
function bucketByMonth(arr) {
  const m = new Map();
  const dollars = new Map();
  for (const k of arr) {
    const d = mongoIdToDate(k);
    const key = d ? d.toISOString().slice(0, 7) : "(null)";
    m.set(key, (m.get(key) || 0) + 1);
    const amt = (byParent.get(k) || []).reduce((a, b) => a + b, 0);
    dollars.set(key, (dollars.get(key) || 0) + amt);
  }
  return { m, dollars };
}

console.log("");
console.log("=== Mongo-ObjectID timestamp distribution (parent creation in Rippling's system) ===");
console.log("(first 4 bytes of ObjectID = unix seconds when Mongo doc created)");
console.log("");
console.log("IN-BOTH parents (present in report):");
{
  const { m, dollars } = bucketByMonth(inBoth);
  for (const [k, v] of [...m.entries()].sort()) {
    console.log(`  ${k}  parents=${String(v).padStart(5)}  $=${fmt(dollars.get(k)).padStart(14)}`);
  }
}

console.log("");
console.log("OURS-ONLY parents (NOT in report):");
{
  const { m, dollars } = bucketByMonth(oursOnly);
  for (const [k, v] of [...m.entries()].sort()) {
    console.log(`  ${k}  parents=${String(v).padStart(5)}  $=${fmt(dollars.get(k)).padStart(14)}`);
  }
}

// Compare against the report's Purchased-At month distribution (already computed in dig2)
// The IN-BOTH set gives us the mapping "Mongo-timestamp-month vs Purchased-at-month"
console.log("");
console.log("=== Cross-check: for IN-BOTH parents, Mongo-month vs Purchased-at-month ===");
console.log("(is Mongo-timestamp a reliable proxy for purchase date?)");
let sameMonth = 0, driftMonth = 0, missing = 0;
for (const k of inBoth) {
  const mDate = mongoIdToDate(k);
  const rDate = repPurchasedByTxn.get(k);
  if (!mDate || !rDate) { missing++; continue; }
  const mMonth = mDate.toISOString().slice(0, 7);
  const rMonth = rDate.slice(0, 7);
  if (mMonth === rMonth) sameMonth++; else driftMonth++;
}
console.log(`  same month  : ${sameMonth}`);
console.log(`  differs     : ${driftMonth}`);
console.log(`  missing one : ${missing}`);

// The definitive test: OURS-ONLY parents where Mongo timestamp is < 2025-12-29 = these
// SHOULD NOT be in the report (they're pre-FY).
const REPORT_START_MS = Date.parse("2025-12-29T00:00:00Z");
const REPORT_END_MS = Date.parse("2026-08-20T23:59:59Z");
let oursOnly_preWindow = 0, oursOnly_preDollars = 0;
let oursOnly_postWindow = 0, oursOnly_postDollars = 0;
let oursOnly_inWindow = 0, oursOnly_inDollars = 0;
let oursOnly_noDate = 0, oursOnly_noDateDollars = 0;
for (const k of oursOnly) {
  const d = mongoIdToDate(k);
  const amt = (byParent.get(k) || []).reduce((a, b) => a + b, 0);
  if (!d) { oursOnly_noDate++; oursOnly_noDateDollars += amt; continue; }
  const t = d.getTime();
  if (t < REPORT_START_MS) { oursOnly_preWindow++; oursOnly_preDollars += amt; }
  else if (t > REPORT_END_MS) { oursOnly_postWindow++; oursOnly_postDollars += amt; }
  else { oursOnly_inWindow++; oursOnly_inDollars += amt; }
}
console.log("");
console.log("=== OURS-ONLY parent bucketing by MongoID timestamp vs report window ===");
console.log(`  before window (< 2025-12-29): parents=${oursOnly_preWindow}   $=${fmt(oursOnly_preDollars)}`);
console.log(`  after window  (> 2026-08-20): parents=${oursOnly_postWindow}  $=${fmt(oursOnly_postDollars)}`);
console.log(`  inside window                : parents=${oursOnly_inWindow}   $=${fmt(oursOnly_inDollars)}`);
console.log(`  no MongoID timestamp         : parents=${oursOnly_noDate}     $=${fmt(oursOnly_noDateDollars)}`);

// For OURS-ONLY parents INSIDE window, what shape are they?
// (These are the puzzle - real inside-window purchases the report doesn't show.)
console.log("");
console.log("=== OURS-ONLY inside-window parents: sample IDs + counts (up to 20) ===");
{
  const inside = oursOnly.filter(k => {
    const d = mongoIdToDate(k);
    if (!d) return false;
    const t = d.getTime();
    return t >= REPORT_START_MS && t <= REPORT_END_MS;
  }).slice(0, 20);
  for (const k of inside) {
    const d = mongoIdToDate(k);
    const arr = byParent.get(k) || [];
    const tot = arr.reduce((a, b) => a + b, 0);
    console.log(`  ${k}   mongo_ts=${d.toISOString()}   lines=${arr.length}   $=${fmt(tot)}`);
  }
}

console.error("[done]");
