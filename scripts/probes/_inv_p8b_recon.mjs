// INV-P8b. READ-ONLY. Reconcile card pipeline against UNFILTERED Rippling report.
// - No writes, no migrations, no Rippling API calls. Postgres + CSV only.
// - Do NOT touch spend_transaction_zo.
// - Do NOT commit CSV or any extract from it.
// - No worker/cardholder names in output. Merchants OK.
//
// PARTS:
//   A1 - three-population join against unfiltered CSV
//   A2 - authorization-pairing test (the decisive one)
//   A3 - characterise unpaired ours-only if pairing fails
//   A4 - sync-code read summarised at call site (in report text below)
//   A5 - category ids the filtered report hid, with dollars
//   B  - 737 pre-window parents against ACTUAL transaction_date (not ObjectID timestamp)
//   C  - versioning / canonical-flag hunt on split-superseded parents
//   D  - USD-converted field hunt in payload
//
// Input CSV:  /Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv
//             header on row 1, single-entity CJK Foods LLC, 100% USD, 4906 rows.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import readline from "node:readline";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rip = process.env.RIPPLING_API_KEY;
console.error(`env SUPABASE_URL:              ${url ? "PRESENT" : "ABSENT"}`);
console.error(`env SUPABASE_SERVICE_ROLE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
console.error(`env RIPPLING_API_KEY:          ${rip ? "PRESENT" : "ABSENT"}  (not used - no API calls)`);
if (!url || !key) { console.error("missing env"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const CSV_PATH = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";

// ─── helpers ───────────────────────────────────────────────────────
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
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
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

// ─── Load our side ─────────────────────────────────────────────────
console.error("[load] rippling_raw_spend_lines_latest ...");
const oursRaw = await paginate((f, t) => supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, external_id, amount, currency, work_location_label, department_label, first_seen_at, merchant_name, raw")
  .order("rippling_id").range(f, t), 1000);
console.error(`[load] our line-item rows: ${oursRaw.length}`);

// Extract per-line
const ourLines = oursRaw.map(r => {
  const raw = r.raw || {};
  const st = raw.spend_transaction || {};
  // parent-transaction date: try multiple aliases embedded in nested spend_transaction obj
  const stDate = st?.transaction_date || st?.transaction_time || st?.posted_at || st?.posted_date || null;
  return {
    rippling_id: r.rippling_id,
    external_id: r.external_id || null,
    parent24: parseParentFromExternal(r.external_id),
    stId: st?.id || null,
    stMerchant: st?.display_value || r.merchant_name || null,
    amount: Number(r.amount || 0),
    currency: r.currency || null,
    // line-level dates present on payload
    txn_date_line:   raw.transaction_date || null,
    posted_date_line: raw.posted_date || null,
    purchased_at_line: raw.purchased_at || null,
    // parent-nested dates
    stTxnDate: stDate,
    first_seen_at: r.first_seen_at || null,
    // parent fields we can extract for versioning search
    raw,
  };
});

const linesWithParent24 = ourLines.filter(l => l.parent24 !== null);

// ─── Load CSV ──────────────────────────────────────────────────────
console.error("[load] CSV ...");
const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity });
let lineNo = 0;
let header = null;
let colIdx = {};
const reportRows = [];
let pendingBuffer = "";
for await (const rawLine of rl) {
  lineNo++;
  const line = pendingBuffer + rawLine;
  const parsed = parseCsvLine(line);
  if (parsed.inQuote) { pendingBuffer = line + "\n"; continue; }
  pendingBuffer = "";
  if (!header) {
    if (lineNo === 1) {
      header = parsed.fields;
      colIdx = Object.fromEntries(header.map((h, i) => [h, i]));
    }
    continue;
  }
  if (parsed.fields.length === 1 && parsed.fields[0] === "") continue;
  reportRows.push(parsed.fields);
}
console.error(`[load] CSV data rows: ${reportRows.length}`);
console.error(`[load] CSV header cols: ${header?.length ?? 0}`);

for (const k of ["Transaction ID", "Amount (by category)", "Object Type", "Entity Name", "Purchased at", "Vendor name", "Category", "Category Name"]) {
  if (!(k in colIdx)) { console.error(`missing CSV col: ${k}`); process.exit(4); }
}
const IX = {
  txnId: colIdx["Transaction ID"],
  amount: colIdx["Amount (by category)"],
  currency: colIdx["Currency"],
  objType: colIdx["Object Type"],
  entity: colIdx["Entity Name"],
  purchasedAt: colIdx["Purchased at"],
  postedDate: colIdx["Posted Date"],
  approvalState: colIdx["Approval State"],
  vendorName: colIdx["Vendor name"],
  categoryId: colIdx["Category"],
  categoryName: colIdx["Category Name"],
  workLocation: colIdx["Work location"],
};
// Extract "Category" from raw formula-like "1385.4 STL - FL Other" -> we want the id.
// Rippling's "Category" col is often just the account/label pair, not the raw id. Note in output.
const rep = reportRows.map(f => ({
  txnId: (f[IX.txnId] || "").toLowerCase(),
  amount: Number(f[IX.amount] || 0),
  currency: f[IX.currency] || "",
  objectType: f[IX.objType] || "",
  entity: f[IX.entity] || "",
  purchasedAt: parseRipDate(f[IX.purchasedAt]),
  postedDate: parseRipDate(f[IX.postedDate]),
  approvalState: f[IX.approvalState] || "",
  vendorName: f[IX.vendorName] || "",
  categoryName: f[IX.categoryName] || "",
  workLocation: f[IX.workLocation] || "",
}));

// ─── A1: three-population join ─────────────────────────────────────
const ourTotalsByParent24 = new Map();
const ourLineCountByParent24 = new Map();
const byParent24 = new Map();
for (const l of linesWithParent24) {
  ourTotalsByParent24.set(l.parent24, (ourTotalsByParent24.get(l.parent24) || 0) + l.amount);
  ourLineCountByParent24.set(l.parent24, (ourLineCountByParent24.get(l.parent24) || 0) + 1);
  if (!byParent24.has(l.parent24)) byParent24.set(l.parent24, []);
  byParent24.get(l.parent24).push(l);
}
const repTotalsByTxn = new Map();
const repFirstRowByTxn = new Map();
for (const r of rep) {
  repTotalsByTxn.set(r.txnId, (repTotalsByTxn.get(r.txnId) || 0) + r.amount);
  if (!repFirstRowByTxn.has(r.txnId)) repFirstRowByTxn.set(r.txnId, r);
}

const ourSet24 = new Set(ourTotalsByParent24.keys());
const repSet   = new Set(repTotalsByTxn.keys());
const inBoth = [...ourSet24].filter(k => repSet.has(k));
const oursOnly = [...ourSet24].filter(k => !repSet.has(k));
const reportOnly = [...repSet].filter(k => !ourSet24.has(k));

let inBoth_agree = 0, inBoth_disagree = 0;
for (const k of inBoth) {
  const ours = ourTotalsByParent24.get(k);
  const theirs = repTotalsByTxn.get(k);
  if (cents(ours) === cents(theirs)) inBoth_agree++; else inBoth_disagree++;
}
const oursOnlyDollars = oursOnly.reduce((a, k) => a + ourTotalsByParent24.get(k), 0);
const reportOnlyDollars = reportOnly.reduce((a, k) => a + repTotalsByTxn.get(k), 0);
const inBothOursDollars = inBoth.reduce((a, k) => a + ourTotalsByParent24.get(k), 0);
const inBothTheirsDollars = inBoth.reduce((a, k) => a + repTotalsByTxn.get(k), 0);
const repAll_total = rep.reduce((a, r) => a + r.amount, 0);

// object-type mix on report
const repObjTypeSum = new Map();
for (const r of rep) {
  const b = repObjTypeSum.get(r.objectType) || { rows: 0, distinct: new Set(), dollars: 0 };
  b.rows++; b.distinct.add(r.txnId); b.dollars += r.amount;
  repObjTypeSum.set(r.objectType, b);
}

// ─── A2: authorization-pairing test ────────────────────────────────
// For a sample of ours-only parents, take one line's amount + merchant + date,
// find any report row within +/- 3 days at the same rounded amount + same merchant.
// Report pairing rate + dollars in each group.
// Compute merchant-normalized key: trim, lowercase, collapse whitespace.
function normMerchant(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
// Build merchant->list-of-report-rows index by amount-cents for O(1) lookups
const repByMerchantAmount = new Map(); // key = `${merchant}|${cents}` -> [dates...]
for (const r of rep) {
  const key = `${normMerchant(r.vendorName)}|${cents(r.amount)}`;
  if (!repByMerchantAmount.has(key)) repByMerchantAmount.set(key, []);
  repByMerchantAmount.get(key).push(r.purchasedAt || r.postedDate);
}

// Take FULL ours-only population (not just sample - N is small enough)
const oursOnlyLines = [];
for (const k of oursOnly) {
  const arr = byParent24.get(k) || [];
  for (const l of arr) oursOnlyLines.push(l);
}
// For each ours-only PARENT (not line): does a twin exist in the report
// with (a) matching merchant name, (b) amount within 1 cent, (c) date within +/- 3 days?
// Use the parent's summed amount vs report row amount (report is often line-by-category).
function dateDiffDays(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs((da - db) / (86400 * 1000));
}
let paired = 0, unpaired = 0;
let pairedDollars = 0, unpairedDollars = 0;
const unpairedParents = [];
for (const k of oursOnly) {
  const arr = byParent24.get(k) || [];
  if (arr.length === 0) continue;
  // Use first line's merchant + parent total
  const merchant = normMerchant(arr[0].stMerchant);
  const parentTotal = ourTotalsByParent24.get(k);
  // Also test per-line amount pairs
  const ourAmountCents = cents(parentTotal);
  // date candidate: the first line's txn_date_line or first_seen_at
  const ourDate = arr[0].txn_date_line || (arr[0].first_seen_at ? String(arr[0].first_seen_at).slice(0, 10) : null);
  let matched = false;
  // First: try parent-total match at the same merchant
  const dates = repByMerchantAmount.get(`${merchant}|${ourAmountCents}`);
  if (dates) {
    for (const d of dates) {
      const diff = dateDiffDays(ourDate, d);
      if (diff != null && diff <= 3) { matched = true; break; }
      // if we have no our-date, accept the merchant+amount match alone
      if (ourDate == null) { matched = true; break; }
    }
  }
  // Second: try any individual line amount matching a report row at same merchant
  if (!matched) {
    for (const l of arr) {
      const key2 = `${merchant}|${cents(l.amount)}`;
      const dates2 = repByMerchantAmount.get(key2);
      if (!dates2) continue;
      for (const d of dates2) {
        const diff = dateDiffDays(l.txn_date_line || (l.first_seen_at ? String(l.first_seen_at).slice(0, 10) : null), d);
        if (diff != null && diff <= 3) { matched = true; break; }
        if (l.txn_date_line == null && l.first_seen_at == null) { matched = true; break; }
      }
      if (matched) break;
    }
  }
  if (matched) { paired++; pairedDollars += parentTotal; }
  else         { unpaired++; unpairedDollars += parentTotal; unpairedParents.push(k); }
}

// ─── A3: characterise the unpaired ours-only population ────────────
// - date distribution (from txn_date_line or first_seen_at)
// - merchant distribution vs report's merchants
// - amount distribution buckets
// - derived_at / first_seen_at clustering
// Object type marker: does raw payload carry a "type" or "object_type"?
const unpairedParentSet = new Set(unpairedParents);
const unpairedLines = [];
for (const k of unpairedParents) {
  const arr = byParent24.get(k) || [];
  for (const l of arr) unpairedLines.push(l);
}
// Date distribution: month buckets
function monthKey(d) { return d ? String(d).slice(0, 7) : "(null)"; }
const monthTxnDate = new Map();
const monthFirstSeen = new Map();
for (const l of unpairedLines) {
  const td = l.txn_date_line ? String(l.txn_date_line).slice(0, 10) : null;
  const fs = l.first_seen_at ? String(l.first_seen_at).slice(0, 10) : null;
  monthTxnDate.set(monthKey(td), (monthTxnDate.get(monthKey(td)) || 0) + 1);
  monthFirstSeen.set(monthKey(fs), (monthFirstSeen.get(monthKey(fs)) || 0) + 1);
}
// Merchant distribution
const unpairedMerchants = new Map();
for (const l of unpairedLines) {
  const m = normMerchant(l.stMerchant) || "(null)";
  unpairedMerchants.set(m, (unpairedMerchants.get(m) || 0) + 1);
}
// Report merchant distribution
const repMerchants = new Map();
for (const r of rep) {
  const m = normMerchant(r.vendorName) || "(null)";
  repMerchants.set(m, (repMerchants.get(m) || 0) + 1);
}
// merchants present in unpaired but NOT in report
const merchOnlyInOurs = [];
for (const m of unpairedMerchants.keys()) {
  if (!repMerchants.has(m)) merchOnlyInOurs.push([m, unpairedMerchants.get(m)]);
}
merchOnlyInOurs.sort((a, b) => b[1] - a[1]);
// merchants present in both
let merchInBoth = 0;
for (const m of unpairedMerchants.keys()) if (repMerchants.has(m)) merchInBoth++;

// Amount buckets on unpaired
const amtBuckets = { lt_1: 0, "1_10": 0, "10_50": 0, "50_100": 0, "100_500": 0, "500_2500": 0, gt_2500: 0 };
for (const l of unpairedLines) {
  const a = Number(l.amount || 0);
  if (a < 1) amtBuckets.lt_1++;
  else if (a < 10) amtBuckets["1_10"]++;
  else if (a < 50) amtBuckets["10_50"]++;
  else if (a < 100) amtBuckets["50_100"]++;
  else if (a < 500) amtBuckets["100_500"]++;
  else if (a < 2500) amtBuckets["500_2500"]++;
  else amtBuckets.gt_2500++;
}

// Raw payload object_type / type inspection on unpaired sample
const typeCounts = new Map();
const parentTypeCounts = new Map();
for (let i = 0; i < Math.min(unpairedLines.length, 4000); i++) {
  const raw = unpairedLines[i].raw || {};
  const st = raw.spend_transaction || {};
  const t1 = raw.object_type || raw.type || raw.__type || null;
  const t2 = st?.object_type || st?.type || st?.__type || null;
  typeCounts.set(t1, (typeCounts.get(t1) || 0) + 1);
  parentTypeCounts.set(t2, (parentTypeCounts.get(t2) || 0) + 1);
}

// ─── A5: category ids the filtered report hid ──────────────────────
// We can only compare category NAMES here (CSV Category is a label). Also derive
// distinct category_id from our raw payload for the "in report" parents to cross-check.
const repCategoryNames = new Map();
for (const r of rep) {
  repCategoryNames.set(r.categoryName, (repCategoryNames.get(r.categoryName) || 0) + 1);
}
// Our category ids present in oursOnly parents (potentially "hidden" categories)
const catIdOursOnly = new Map();
for (const l of oursOnlyLines) {
  const cid = l.raw?.category && typeof l.raw.category === "string" ? l.raw.category : null;
  if (!cid) continue;
  const rec = catIdOursOnly.get(cid) || { rows: 0, dollars: 0 };
  rec.rows++; rec.dollars += Number(l.amount || 0);
  catIdOursOnly.set(cid, rec);
}
// Load labelled category map
const { data: catMap, error: catErr } = await supa.from("spend_category_map").select("category_id, category_label, gl_line_code");
if (catErr) console.error(`[warn] category map load: ${catErr.message}`);
const catLabelById = new Map((catMap || []).map(r => [r.category_id, r]));

// ─── Part B: pre-window parents against ACTUAL transaction_date ────
const REPORT_START = "2025-12-29";
// Use transaction_date from LINE payload if populated; else parent.transaction_date;
// else fall back to first_seen_at (with clear flag).
function bestTxnDate(l) {
  return (
    l.txn_date_line   ? String(l.txn_date_line).slice(0, 10) :
    l.stTxnDate        ? String(l.stTxnDate).slice(0, 10) :
    l.posted_date_line ? String(l.posted_date_line).slice(0, 10) :
    l.purchased_at_line? String(l.purchased_at_line).slice(0, 10) :
    null
  );
}
// Also count "first_seen_at only" (real txn_date NULL entirely)
let realTxnDateCount = 0, onlyFirstSeenCount = 0;
const preWindowParents = new Map(); // parent24 -> { dollars, lineCount, dateSample }
for (const [k, arr] of byParent24.entries()) {
  // Take earliest real txn date across lines
  let earliest = null;
  for (const l of arr) {
    const d = bestTxnDate(l);
    if (d) {
      realTxnDateCount++;
      if (!earliest || d < earliest) earliest = d;
    } else {
      onlyFirstSeenCount++;
    }
  }
  if (earliest && earliest < REPORT_START) {
    const tot = arr.reduce((a, r) => a + Number(r.amount || 0), 0);
    preWindowParents.set(k, { dollars: tot, lineCount: arr.length, dateSample: earliest });
  }
}
// Compare to first_seen_at-based pre-window count
let preWindowByFirstSeen = 0;
let preWindowByFirstSeenDollars = 0;
for (const [k, arr] of byParent24.entries()) {
  let earliest = null;
  for (const l of arr) {
    const d = l.first_seen_at ? String(l.first_seen_at).slice(0, 10) : null;
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  if (earliest && earliest < REPORT_START) {
    preWindowByFirstSeen++;
    preWindowByFirstSeenDollars += arr.reduce((a, r) => a + Number(r.amount || 0), 0);
  }
}
const preWindowDollars = [...preWindowParents.values()].reduce((a, v) => a + v.dollars, 0);

// ─── Part C: canonical-version / superseded-split flag hunt ────────
// A "split-inflation" parent is one where all N lines share the same amount, N >= 2,
// AND that amount equals the (implicit) parent total => sum is N * total.
// Look on the raw payload for any of: version, revision, is_current, is_deleted,
// superseded_at, replaced_by, split_id, split_version.
const canonicalKeyProbes = ["version", "revision", "rev", "is_current", "current", "is_deleted",
  "deleted", "superseded_at", "superseded", "replaced_by", "replaced_at",
  "split_id", "split_version", "line_version", "generation"];
const keyPresenceCountsLine = new Map(); // key -> count of lines where present + non-null
const keyPresenceCountsParent = new Map();
const keyValueSamples = new Map(); // key -> Set(values)
// Do NOT sniff more than say 20000 lines for perf; if we need more, extend.
for (const l of ourLines.slice(0, 20000)) {
  const raw = l.raw || {};
  const st = raw.spend_transaction || {};
  for (const k of canonicalKeyProbes) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") {
      keyPresenceCountsLine.set(k, (keyPresenceCountsLine.get(k) || 0) + 1);
      if (!keyValueSamples.has("line."+k)) keyValueSamples.set("line."+k, new Set());
      if (keyValueSamples.get("line."+k).size < 8) keyValueSamples.get("line."+k).add(String(raw[k]).slice(0, 40));
    }
    if (st[k] !== undefined && st[k] !== null && st[k] !== "") {
      keyPresenceCountsParent.set(k, (keyPresenceCountsParent.get(k) || 0) + 1);
      if (!keyValueSamples.has("parent."+k)) keyValueSamples.set("parent."+k, new Set());
      if (keyValueSamples.get("parent."+k).size < 8) keyValueSamples.get("parent."+k).add(String(st[k]).slice(0, 40));
    }
  }
}

// Identify "split-inflation" parents where each line equals a candidate parent total.
// Since we don't have parent total from API (blocked), infer: N lines all equal x, and
// the parent has ALSO one or more coexisting sets with the same sum (e.g. [x], [x/2, x/2]).
// This is the shape INV-P8 documented. Count parents that have BOTH multi-set patterns.
// Formally: parents where line amounts contain multiple distinct "sums-of-equal-splits".
function detectSupersededSplits(byParent) {
  // For each parent, group lines by amount, count occurrences per amount.
  // If we see e.g. amounts [a, a, a, b, b, c] with a*3 == b*2 == c => 3 sets superseded.
  const flagged = [];
  for (const [k, arr] of byParent.entries()) {
    if (arr.length < 2) continue;
    const amountCounts = new Map();
    for (const l of arr) {
      const c = cents(l.amount);
      amountCounts.set(c, (amountCounts.get(c) || 0) + 1);
    }
    if (amountCounts.size < 2) continue;
    // Compute sum = amount * count for each distinct amount
    const sums = new Map();  // sumCents -> [{ amountCents, n }]
    for (const [amtC, n] of amountCounts.entries()) {
      const s = amtC * n;
      if (!sums.has(s)) sums.set(s, []);
      sums.get(s).push({ amtC, n });
    }
    // Find the sum value shared by >= 2 distinct amount buckets => superseded splits
    let anySupersededSum = null;
    for (const [s, buckets] of sums.entries()) {
      if (buckets.length >= 2) { anySupersededSum = s; break; }
    }
    if (anySupersededSum != null) {
      const totalCents = arr.reduce((a, l) => a + cents(l.amount), 0);
      const canonicalCents = anySupersededSum;
      const overCountedCents = totalCents - canonicalCents;
      flagged.push({
        parent24: k,
        lineCount: arr.length,
        distinctAmountsCount: amountCounts.size,
        totalCents,
        canonicalCents,
        overCountedCents,
      });
    }
  }
  return flagged;
}
const superseded = detectSupersededSplits(byParent24);
const supersededTotalCents = superseded.reduce((a, r) => a + r.totalCents, 0);
const supersededCanonicalCents = superseded.reduce((a, r) => a + r.canonicalCents, 0);
const supersededOverCents = superseded.reduce((a, r) => a + r.overCountedCents, 0);

// ─── Part D: currency ──────────────────────────────────────────────
// Look at ALL our lines' currency. Enumerate distinct. For each non-USD, sum native
// amount + count parents. Probe payload for USD-converted fields.
const currencyBuckets = new Map(); // currency -> { rows, dollars }
for (const l of ourLines) {
  const c = String(l.currency || "").toUpperCase() || "(null)";
  const rec = currencyBuckets.get(c) || { rows: 0, dollars: 0 };
  rec.rows++; rec.dollars += Number(l.amount || 0);
  currencyBuckets.set(c, rec);
}
// USD-converted field probes on raw payload
const fxFieldProbes = [
  "amount_usd", "usd_amount", "amount_in_usd", "converted_amount", "conversion_amount",
  "reporting_amount", "reporting_currency_amount", "base_amount", "exchange_rate",
  "fx_rate", "conversion_rate",
];
const fxFieldPresent = new Map();
const fxFieldSamples = new Map();
for (const l of ourLines) {
  const raw = l.raw || {};
  // Check top-level scalar aliases
  for (const k of fxFieldProbes) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") {
      fxFieldPresent.set(k, (fxFieldPresent.get(k) || 0) + 1);
      if (!fxFieldSamples.has(k)) fxFieldSamples.set(k, new Set());
      if (fxFieldSamples.get(k).size < 5) fxFieldSamples.get(k).add(String(raw[k]).slice(0, 40));
    }
  }
  // Check nested amount object
  const amt = raw.amount;
  if (amt && typeof amt === "object" && !Array.isArray(amt)) {
    for (const k of Object.keys(amt)) {
      const val = amt[k];
      if (val === null || val === undefined || val === "") continue;
      if (["value", "currency_type", "currency"].includes(k)) continue;
      const kk = "amount." + k;
      fxFieldPresent.set(kk, (fxFieldPresent.get(kk) || 0) + 1);
      if (!fxFieldSamples.has(kk)) fxFieldSamples.set(kk, new Set());
      if (fxFieldSamples.get(kk).size < 5) fxFieldSamples.get(kk).add(String(val).slice(0, 40));
    }
  }
}

// Non-USD lines: currency-specific dollar exposure
const nonUsdLines = ourLines.filter(l => l.currency && String(l.currency).toUpperCase() !== "USD");
const nonUsdParents = new Set();
for (const l of nonUsdLines) if (l.parent24) nonUsdParents.add(l.parent24);
const nonUsdNativeSum = new Map();
for (const l of nonUsdLines) {
  const c = String(l.currency).toUpperCase();
  nonUsdNativeSum.set(c, (nonUsdNativeSum.get(c) || 0) + Number(l.amount || 0));
}

// Non-USD parents currently within FYTD (they leak into the USD roll-up):
const nonUsdFyLines = nonUsdLines.filter(l => {
  const d = bestTxnDate(l) || (l.first_seen_at ? String(l.first_seen_at).slice(0, 10) : null);
  return d && d >= REPORT_START;
});

// ─── Part B (leak check): does the route include pre-FY rows? ──────
// Code-read only; captured in output text.

// ─── OUTPUT ────────────────────────────────────────────────────────
const out = [];
const P = (...a) => out.push(a.join(""));
P("\nINV-P8b  card-pipeline vs UNFILTERED Rippling report");
P("         READ-ONLY   Postgres + CSV   no API calls");
P("         run at ", new Date().toISOString());
P("         CSV     ", CSV_PATH);
P("");

P("=".repeat(80));
P("A1  three-population join (parent24), UNFILTERED report");
P("-".repeat(80));
P(`  REPORT rows total       : ${rep.length}`);
P(`  REPORT distinct txn id  : ${repTotalsByTxn.size}`);
P(`  REPORT total dollars    : $${fmt(repAll_total)}`);
P("");
P("  Object-Type mix on report:");
{
  const arr = [...repObjTypeSum.entries()].map(([k, v]) => [k, v.rows, v.distinct.size, v.dollars]).sort((a, b) => b[3] - a[3]);
  P(`    ${"Object Type".padEnd(30)}  ${"rows".padStart(6)}  ${"distinct".padStart(9)}  ${"dollars".padStart(14)}`);
  for (const [k, rows, dist, dollars] of arr) {
    P(`    ${String(k).slice(0, 30).padEnd(30)}  ${String(rows).padStart(6)}  ${String(dist).padStart(9)}  $${fmt(dollars).padStart(14)}`);
  }
}
P("");
P(`  OUR distinct parent24   : ${ourSet24.size}`);
P(`  OUR total dollars       : $${fmt([...ourTotalsByParent24.values()].reduce((a, b) => a + b, 0))}`);
P("");
P("  Populations against ALL report rows:");
P(`    in both     txns=${String(inBoth.length).padStart(5)}   ours $=${fmt(inBothOursDollars).padStart(14)}   theirs $=${fmt(inBothTheirsDollars).padStart(14)}`);
P(`    ours only   txns=${String(oursOnly.length).padStart(5)}   ours $=${fmt(oursOnlyDollars).padStart(14)}`);
P(`    report only txns=${String(reportOnly.length).padStart(5)}                        theirs $=${fmt(reportOnlyDollars).padStart(14)}`);
P("");
P(`  in-both agree-to-cent : ${inBoth_agree}`);
P(`  in-both disagree      : ${inBoth_disagree}`);
P("");

P("=".repeat(80));
P("A2  authorization-pairing test  (the decisive one)");
P("-".repeat(80));
P(`  method: for each ours-only parent, try to find a report row with the SAME`);
P(`          merchant + amount (parent total OR any single line) with date within 3 days.`);
P(`  ours-only parents tested : ${oursOnly.length}`);
P(`  paired (twin found)      : ${paired}    $=${fmt(pairedDollars)}`);
P(`  unpaired                 : ${unpaired}    $=${fmt(unpairedDollars)}`);
if (paired + unpaired > 0) {
  const rate = (100 * paired / (paired + unpaired)).toFixed(1);
  P(`  pairing rate             : ${rate}%`);
  if (paired > unpaired) P(`  VERDICT: authorization-twin hypothesis LIKELY - most ours-only parents pair to a report row`);
  else P(`  VERDICT: authorization-twin hypothesis KILLED - most ours-only parents do NOT pair`);
}
P("");

P("=".repeat(80));
P("A3  characterise the unpaired ours-only population");
P("-".repeat(80));
P(`  unpaired parents : ${unpaired}    $=${fmt(unpairedDollars)}    lines=${unpairedLines.length}`);
P("");
P("  Amount distribution (unpaired lines):");
for (const [k, n] of Object.entries(amtBuckets)) {
  P(`    ${k.padEnd(10)}  ${String(n).padStart(6)}`);
}
P("");
P("  Month distribution by REAL txn_date (line-level, from payload):");
for (const [k, n] of [...monthTxnDate.entries()].sort()) {
  P(`    ${k.padEnd(10)}  ${String(n).padStart(6)}`);
}
P("");
P("  Month distribution by first_seen_at (ingestion timestamp):");
for (const [k, n] of [...monthFirstSeen.entries()].sort()) {
  P(`    ${k.padEnd(10)}  ${String(n).padStart(6)}`);
}
P("");
P(`  Distinct merchants in unpaired: ${unpairedMerchants.size}`);
P(`    also present in report      : ${merchInBoth}`);
P(`    only in ours (not in report): ${merchOnlyInOurs.length}`);
if (merchOnlyInOurs.length) {
  P("    top 10 merchants only in ours:");
  for (const [m, n] of merchOnlyInOurs.slice(0, 10)) {
    P(`      ${String(m).slice(0, 50).padEnd(50)}  ${String(n).padStart(6)}`);
  }
}
P("");
P("  Object-type field on raw payload (unpaired sample):");
P("    LINE-level  (raw.object_type / .type / .__type):");
for (const [k, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  P(`      ${String(k).padEnd(30)}  ${String(n).padStart(6)}`);
}
P("    PARENT-nested (raw.spend_transaction.object_type / .type):");
for (const [k, n] of [...parentTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  P(`      ${String(k).padEnd(30)}  ${String(n).padStart(6)}`);
}
P("");

P("=".repeat(80));
P("A5  category ids the filtered report may have hidden");
P("-".repeat(80));
P(`  distinct category ids in ours-only parents: ${catIdOursOnly.size}`);
P(`  distinct category_name values in report   : ${repCategoryNames.size}`);
P("");
P("  Ours-only categories, top 20 by dollars:");
{
  const arr = [...catIdOursOnly.entries()].sort((a, b) => b[1].dollars - a[1].dollars).slice(0, 20);
  for (const [cid, rec] of arr) {
    const lbl = catLabelById.get(cid);
    const label = lbl ? (lbl.category_label || lbl.gl_line_code || "(unlabelled in map)") : "(NOT IN MAP)";
    P(`    ${cid}  rows=${String(rec.rows).padStart(6)}  $=${fmt(rec.dollars).padStart(12)}  ${String(label).slice(0, 40)}`);
  }
}
P("");

P("=".repeat(80));
P("Part B  pre-window parents against ACTUAL transaction_date");
P("-".repeat(80));
P(`  bestTxnDate priority: raw.transaction_date -> spend_transaction.transaction_date -> raw.posted_date -> raw.purchased_at -> null`);
P(`  lines with a real txn date : ${realTxnDateCount}`);
P(`  lines with ONLY first_seen : ${onlyFirstSeenCount}`);
P("");
P(`  Parents with earliest REAL txn date < ${REPORT_START} : ${preWindowParents.size}    $=${fmt(preWindowDollars)}`);
P(`  Parents with earliest FIRST_SEEN < ${REPORT_START}     : ${preWindowByFirstSeen}    $=${fmt(preWindowByFirstSeenDollars)}`);
P("");
if (preWindowParents.size > 0) {
  P("  sample of pre-window parents by real txn date (up to 10):");
  const arr = [...preWindowParents.entries()].sort((a, b) => a[1].dateSample.localeCompare(b[1].dateSample)).slice(0, 10);
  for (const [k, v] of arr) P(`    ${k}   earliest=${v.dateSample}   lines=${v.lineCount}   $=${fmt(v.dollars)}`);
}
P("");

P("=".repeat(80));
P("Part C  canonical-version / superseded-split flag hunt");
P("-".repeat(80));
P("  Payload key presence over first 20k lines (line-level then parent-nested):");
P("  LINE-level presence:");
if (keyPresenceCountsLine.size === 0) P("    (NONE of the candidate keys are present on any line - no versioning flag on line payload)");
for (const [k, n] of keyPresenceCountsLine.entries()) {
  const samples = keyValueSamples.get("line."+k);
  P(`    ${k.padEnd(20)}  present on ${String(n).padStart(6)} lines   samples: ${samples ? [...samples].join(" | ") : ""}`);
}
P("  PARENT-nested presence:");
if (keyPresenceCountsParent.size === 0) P("    (NONE of the candidate keys are present on any parent - no versioning flag on parent-nested payload either)");
for (const [k, n] of keyPresenceCountsParent.entries()) {
  const samples = keyValueSamples.get("parent."+k);
  P(`    ${k.padEnd(20)}  present on ${String(n).padStart(6)} lines   samples: ${samples ? [...samples].join(" | ") : ""}`);
}
P("");
P("  Superseded-split shape detection (parents with >=2 distinct amounts whose amount*count matches across buckets):");
P(`    flagged parents : ${superseded.length}`);
P(`    stored total    : $${fmt(supersededTotalCents / 100)}`);
P(`    canonical (one set)  : $${fmt(supersededCanonicalCents / 100)}`);
P(`    over-counted    : $${fmt(supersededOverCents / 100)}`);
P("");
if (superseded.length) {
  P("  sample of superseded parents (up to 5):");
  for (const s of superseded.slice(0, 5)) {
    P(`    ${s.parent24}   lines=${s.lineCount}   distinct_amts=${s.distinctAmountsCount}   stored=$${fmt(s.totalCents/100)}   canonical=$${fmt(s.canonicalCents/100)}   over=$${fmt(s.overCountedCents/100)}`);
  }
}
P("");

P("=".repeat(80));
P("Part D  currency");
P("-".repeat(80));
P("  Distinct currency on our raw lines:");
for (const [c, rec] of [...currencyBuckets.entries()].sort((a, b) => b[1].dollars - a[1].dollars)) {
  P(`    ${String(c).padEnd(8)}  rows=${String(rec.rows).padStart(6)}  native_sum=${fmt(rec.dollars).padStart(14)}`);
}
P("");
P(`  Non-USD lines  : ${nonUsdLines.length}    non-USD parents: ${nonUsdParents.size}`);
P(`  Non-USD lines within FYTD (>= ${REPORT_START}) : ${nonUsdFyLines.length}`);
P("");
P("  Non-USD native sums (leak surface in USD roll-ups):");
for (const [c, s] of nonUsdNativeSum.entries()) P(`    ${c}  ${fmt(s)}`);
P("");
P("  USD-converted / FX field probes on raw payload:");
if (fxFieldPresent.size === 0) P("    (NO usd-conversion or exchange-rate field found on payload; only raw.amount.{value,currency_type})");
for (const [k, n] of fxFieldPresent.entries()) {
  const samples = fxFieldSamples.get(k);
  P(`    ${k.padEnd(24)}  present on ${String(n).padStart(6)} lines   samples: ${samples ? [...samples].join(" | ") : ""}`);
}
P("");
P(`  Verdict template: if fxFieldPresent is empty, currency drift is a STOP-FOR-RULING`);
P(`  (owner picks FX rate source). Do NOT invent a rule.`);
P("");

console.log(out.join("\n"));
console.error("[done]");
