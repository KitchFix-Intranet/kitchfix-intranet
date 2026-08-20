// scripts/purchasing_apply_category_rulings.mjs
//
// G3 (2026-08-20): populate spend_category_map.gl_line_code + provenance
// from Part A (parse leading GL code off the category name) and Part B
// (owner's 23 rulings from card_category_rulings.xlsx). Anything neither
// parses nor is ruled stays UNROUTED (NULL gl_line_code, provenance=NULL).
//
// This script is idempotent and NEVER overwrites an owner ruling with a
// parsed value (Kevin's rule 11: ruling wins). Ordering: rulings first
// (matched by category name), then parser fills in the rest.
//
// CLI:
//   node --env-file=.env.local scripts/purchasing_apply_category_rulings.mjs [--dry-run]
//
// Category name is not stored directly on spend_category_map (label
// column is "null" text from the sync). We reconstruct name -> category_id
// by joining CSV Transaction IDs to rippling_raw_spend_lines_latest via
// external_id. This lets us match Kevin's rulings-by-name to the DB's
// category-by-id.
//
// The 23 rulings in card_category_rulings.xlsx (Rulings sheet col F):
//   Operations Travel               -> SG&A               -> 5000
//   Dues & Subscriptions            -> SG&A               -> 5000  (2 cat_ids share this name)
//   Sales Travel                    -> SG&A               -> 5000
//   Equipment                       -> SPLIT-needs-rule   -> UNROUTED (see G3 spec: not decided)
//   General Repair & Maintenance    -> SPLIT-needs-rule   -> 5002.1 (spec override: R&M; vehicle repairs stay in R&M)
//   Sales Function Event            -> SG&A               -> 5000
//   **Please Select A Category**    -> UNROUTED           -> NULL (spec: keep in queue)
//   Computer Hardware               -> SG&A               -> 5000
//   Leased Vehicles                 -> PURCHASING-Vehicle -> 3500.3 (spec: Enterprise + golf cars)
//   Perks                           -> SG&A               -> 5000
//   Building Lease                  -> SG&A               -> 5000
//   License & Fees                  -> SG&A               -> 5000
//   Meals & Entertainment           -> SG&A               -> 5000
//   Storage Lease                   -> SG&A               -> 5000
//   Equipment Lease                 -> SG&A               -> 5000
//   General Utilities               -> SG&A               -> 5000
//   Recruiting                      -> SG&A               -> 5000
//   Printer Lease                   -> SG&A               -> 5000
//   Office Supplies                 -> SG&A               -> 5000
//   General Liability Insurance     -> SG&A               -> 5000
//   Account Management Travel       -> SG&A               -> 5000
//   Training                        -> SG&A               -> 5000
//   Due to EE                       -> SG&A               -> 5000
//
// SG&A rulings map to `5000` (bucket-only placeholder). glBucketFor("5000")
// -> "sga" (the derive's prefix rule: any 5xxx is SG&A). Kevin can later
// refine to specific 5xxx sub-codes without another migration.
//
// Categories NOT in the 23 rulings AND whose name does not parse a GL
// code stay UNROUTED. That includes the two unnamed categories in the
// DB (no CSV row joined) which represent the "52 new ids" family the
// spec calls out - both go into the Part C review worksheet.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
const dryRun = process.argv.slice(2).includes("--dry-run");
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ─── Part B rulings (name -> { gl, provenance }) ─────────────────────
const SGA_PLACEHOLDER = "5000";

const RULINGS = new Map([
  ["Operations Travel",            { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Dues & Subscriptions",         { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Sales Travel",                 { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  // Equipment: F says "SPLIT - needs a rule". G3 spec does not carry a
  // concrete decision, so stays UNROUTED. Kevin's Column G intent is a
  // future move to COGS; not applied now.
  //   ["Equipment",                    { gl: null, note: "SPLIT - not yet decided" }],
  ["General Repair & Maintenance", { gl: "5002.1", note: "R&M (spec override; vehicle repairs stay in R&M and are flagged)" }],
  ["Sales Function Event",         { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  // **Please Select A Category**: UNROUTED - stay in queue.
  //   ["**Please Select A Category**", { gl: null, note: "UNROUTED - visible queue" }],
  ["Computer Hardware",            { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Leased Vehicles",              { gl: "3500.3", note: "Vehicle (spec override: Enterprise + Mission Golf Cars)" }],
  ["Perks",                        { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Building Lease",               { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["License & Fees",               { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Meals & Entertainment",        { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Storage Lease",                { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Equipment Lease",              { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["General Utilities",            { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Recruiting",                   { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Printer Lease",                { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Office Supplies",              { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["General Liability Insurance",  { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Account Management Travel",    { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Training",                     { gl: SGA_PLACEHOLDER, note: "SG&A" }],
  ["Due to EE",                    { gl: SGA_PLACEHOLDER, note: "SG&A (owner ruled SG&A despite reimbursable-style memo)" }],
]);

// Categories the ruling sheet marks as "UNROUTED" or "SPLIT" - we log
// them explicitly so the applier's summary shows they were ACKNOWLEDGED
// (a ruling was made) even though no gl_line_code lands.
//
// Provenance='unrouted' records that Kevin considered the category and
// chose to leave it unrouted; it distinguishes deliberate-unrouted from
// awaiting-review-unrouted (provenance=NULL). The Part C worksheet
// gets both, filtered by provenance IS DISTINCT FROM 'owner_ruling_...'.
const ACKNOWLEDGED_UNROUTED = new Set([
  "**Please Select A Category**",     // owner-ruled UNROUTED (spec: visible queue)
  "Equipment",                        // owner-marked SPLIT (col F "SPLIT - needs a rule"); not decided per G3 spec
]);

// ─── Part A parser: leading \d{4}(\.\d+)* on category name ───────────
const PART_A_RE = /^(\d{4}(?:\.\d+)*)/;

function parseGlFromName(name) {
  if (!name) return null;
  const m = PART_A_RE.exec(String(name).trim());
  return m ? m[1] : null;
}

// ─── Rebuild category_id -> name via CSV Transaction ID join ─────────
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
  const records = [];
  let cur = ""; let inQuote = false;
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

async function buildCategoryIdToName() {
  // Robust cat_id -> name resolution.
  //
  // Problem: the CSV's Category / Category Name columns carry the text label
  // but only the parent Transaction ID as an identifier. Multiple DB line
  // items can share a parent txn (Rippling records one line_item_content
  // per amount per parent). The DB's rippling_raw_spend_lines_latest has
  // category_id + external_id where external_id = `<txn>__line_item_content_<cat>_<amt>_no_dimensions`.
  //
  // Join key: (parent_txn, amount_as_string) - deterministic to line item.
  // For each CSV row (txn, amt, name) look up matching DB rows via that
  // key, then vote per-name: the DB cat_id that most CSV rows for a given
  // name point to wins the name.
  //
  // Then invert: cat_id -> highest-count-name. If a cat_id has multiple
  // names claim it, the one with the most CSV support wins. Any cat_id
  // whose winning name has < CONFIDENCE_THRESHOLD ratio is left unnamed
  // (returns null) so the applier does not silently misroute it.
  const CONFIDENCE_THRESHOLD = 0.5;

  const records = loadCsvRecords(CSV);
  const header = parseCsvLine(records[0]);
  const txnIdIdx = header.indexOf("Transaction ID");
  const catNameIdx = header.indexOf("Category Name");
  const amtIdx = header.indexOf("Amount (by category)");

  // DB: (txn, amt_key) -> [cat_id, ...]
  const dbIndex = new Map();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supa
        .from("rippling_raw_spend_lines_latest")
        .select("category_id, external_id, amount")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`load raw spend: ${error.message}`);
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
  }

  // For each (name, cat) count via CSV rows
  const nameToCatCounts = new Map();  // name -> Map<cat, count>
  for (let n = 1; n < records.length; n++) {
    const cells = parseCsvLine(records[n]);
    const txn = cells[txnIdIdx];
    const name = cells[catNameIdx];
    const amt = Number(cells[amtIdx] || 0);
    if (!txn || !name) continue;
    const amtStr = amt.toFixed(2).replace(".", "_");
    const key = `${txn}|${amtStr}`;
    const hits = dbIndex.get(key);
    if (!hits) continue;
    for (const cat of hits) {
      if (!nameToCatCounts.has(name)) nameToCatCounts.set(name, new Map());
      const g = nameToCatCounts.get(name);
      g.set(cat, (g.get(cat) || 0) + 1);
    }
  }

  // Name -> dominant cat (with confidence)
  const nameToCat = new Map();  // name -> { cat, count, total, pct }
  for (const [name, catMap] of nameToCatCounts) {
    const list = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
    const [cat, count] = list[0];
    const total = list.reduce((s, [_, c]) => s + c, 0);
    const pct = count / total;
    nameToCat.set(name, { cat, count, total, pct });
  }

  // Invert: cat -> highest-count name (each cat claimed by only one name).
  // If two names both claim the same cat, the higher-count name wins.
  const catToName = new Map();      // cat -> { name, count }
  for (const [name, r] of nameToCat) {
    if (r.pct < CONFIDENCE_THRESHOLD) continue;   // low-confidence -> skip
    const existing = catToName.get(r.cat);
    if (!existing || r.count > existing.count) {
      catToName.set(r.cat, { name, count: r.count });
    }
  }

  const out = new Map();
  for (const [cat, { name }] of catToName) out.set(cat, name);
  return out;
}

async function loadSpendCategoryMap() {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  // Try with provenance column first. If the migration has not been applied
  // yet the column is absent - fall back to selecting without it so the
  // applier's dry-run can still preview the intended writes. The UPDATE path
  // below would fail without the migration; caller sees the fail cleanly.
  let selectExpr = "category_id, category_label, gl_line_code, provenance, merchant_sample";
  for (;;) {
    let { data, error } = await supa
      .from("spend_category_map")
      .select(selectExpr)
      .order("category_id")
      .range(from, from + PAGE - 1);
    if (error && /column .*provenance.* does not exist/i.test(error.message)) {
      console.warn("[scm] provenance column absent - falling back (migration not yet applied); UPDATEs will fail if attempted");
      selectExpr = "category_id, category_label, gl_line_code, merchant_sample";
      const retry = await supa
        .from("spend_category_map")
        .select(selectExpr)
        .order("category_id")
        .range(from, from + PAGE - 1);
      if (retry.error) throw new Error(`load scm (retry): ${retry.error.message}`);
      data = (retry.data || []).map(r => ({ ...r, provenance: null }));
      error = null;
    }
    if (error) throw new Error(`load scm: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ─── main ────────────────────────────────────────────────────────────
const startedAt = new Date();
console.log(`purchasing_apply_category_rulings dryRun=${dryRun} started=${startedAt.toISOString()}`);

const catIdToName = await buildCategoryIdToName();
console.log(`[names] resolved ${catIdToName.size} category_id -> name via CSV/DB join`);

const scm = await loadSpendCategoryMap();
console.log(`[scm] loaded ${scm.length} spend_category_map rows`);

// Compute update per row. Rule 11: an existing owner_ruling row is NEVER
// overwritten by a parsed value. Since this run is the first population,
// no existing gl_line_code exists - but the guard stays for future runs.
const updates = [];
const summary = {
  by_parse: 0,
  by_ruling: 0,
  ruling_acknowledged_unrouted: 0,
  no_name_no_ruling: 0,
  skipped_existing_ruling: 0,
  no_change_still_null: 0,
};
const perCat = [];

for (const row of scm) {
  const name = catIdToName.get(row.category_id) || null;
  let newGl = null;
  let newProv = null;

  // Case A: owner ruling by name
  if (name && RULINGS.has(name)) {
    const r = RULINGS.get(name);
    newGl = r.gl;
    newProv = "owner_ruling_2026-08-20";
  } else if (name && ACKNOWLEDGED_UNROUTED.has(name)) {
    // Case B: owner acknowledged but ruling is UNROUTED
    newGl = null;
    newProv = "unrouted";
  } else if (name) {
    // Case C: try Part A parse
    const gl = parseGlFromName(name);
    if (gl) { newGl = gl; newProv = "parsed_from_name"; }
    else { newGl = null; newProv = null; /* no ruling, no parse - stays unrouted, provenance stays NULL */ }
  } else {
    // Case D: no name at all (2 unnamed categories)
    newGl = null;
    newProv = null;
  }

  // Rule 11: if row already has provenance='owner_ruling_2026-08-20',
  // never overwrite with parse. (Not applicable on first run.)
  if (row.provenance === "owner_ruling_2026-08-20" && newProv === "parsed_from_name") {
    summary.skipped_existing_ruling++;
    continue;
  }

  // Track for reporting
  perCat.push({ category_id: row.category_id, name, newGl, newProv });

  if (newProv === "parsed_from_name") summary.by_parse++;
  else if (newProv === "owner_ruling_2026-08-20") summary.by_ruling++;
  else if (newProv === "unrouted") summary.ruling_acknowledged_unrouted++;
  else if (!name) summary.no_name_no_ruling++;
  else summary.no_change_still_null++;

  // Idempotency: if the row already has the same (gl, provenance), skip.
  const same = (row.gl_line_code === newGl) && (row.provenance === newProv);
  if (same) continue;

  updates.push({ category_id: row.category_id, gl_line_code: newGl, provenance: newProv, category_label: name || row.category_label });
}

console.log(`\n[applier] categories categorized:`);
console.log(`  parsed_from_name:              ${summary.by_parse}`);
console.log(`  owner_ruling_2026-08-20 (gl):  ${summary.by_ruling}`);
console.log(`  owner_ruling ack. UNROUTED:    ${summary.ruling_acknowledged_unrouted}`);
console.log(`  no_name_no_ruling:             ${summary.no_name_no_ruling}`);
console.log(`  unrouted (name, no ruling, no parse): ${summary.no_change_still_null}`);
console.log(`  updates to write:              ${updates.length}`);

// Verify: every 5xxx placeholder + every ruling code + every parsed code
// must bucket to a known non-null bucket via the prefix rule (5/13/32/34/35).
// This catches typos in RULINGS map.
function glBucketPrefix(gl) {
  if (!gl) return null;
  const s = String(gl);
  if (s.startsWith("32") || s.startsWith("34") || s.startsWith("35")) return "pl_cogs";
  if (s.startsWith("13")) return "reimbursable";
  if (s.startsWith("5"))  return "sga";
  return "other";
}
let badBucket = 0;
for (const u of updates) {
  if (u.gl_line_code && glBucketPrefix(u.gl_line_code) === "other") {
    console.error(`[bucket-check] FAIL: cat_id=${u.category_id} gl=${u.gl_line_code} -> other (should be pl_cogs/reimbursable/sga)`);
    badBucket++;
  }
}
if (badBucket > 0) {
  console.error(`[applier] ABORT: ${badBucket} rows would land in 'other' bucket. Fix RULINGS map.`);
  process.exit(2);
}

// Preview
console.log("\n[applier] per-category resolution (top 20 by name):");
const preview = [...perCat].sort((a, b) => String(a.name || "~").localeCompare(String(b.name || "~"))).slice(0, 40);
for (const p of preview) {
  console.log(`  ${p.category_id} | ${(p.name || "(no-name)").padEnd(45)} | gl=${p.newGl || "(null)"}  prov=${p.newProv || "(null)"}`);
}

if (dryRun) {
  console.log(`\n[applier] dry-run: would write ${updates.length} updates to spend_category_map`);
  process.exit(0);
}

// Write updates one row at a time (57 max), UPDATE by category_id.
// Alternative would be upsert; but UPDATE is safer against accidental
// category_id creation on typo.
let written = 0; let writeFail = 0;
for (const u of updates) {
  const { error } = await supa
    .from("spend_category_map")
    .update({
      gl_line_code: u.gl_line_code,
      provenance:   u.provenance,
      category_label: u.category_label,   // fix "null" text at the same time
      updated_at:   new Date().toISOString(),
      labelled_by:  "purchasing_apply_category_rulings.mjs",
      labelled_at:  new Date().toISOString(),
    })
    .eq("category_id", u.category_id);
  if (error) {
    console.error(`[applier] UPDATE FAILED cat=${u.category_id}: ${error.message}`);
    writeFail++;
  } else written++;
}
console.log(`\n[applier] DONE written=${written} failed=${writeFail}`);
if (writeFail > 0) process.exit(2);
process.exit(0);
