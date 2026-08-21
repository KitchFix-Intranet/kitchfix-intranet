// scripts/purchasing_review_worksheet.mjs
//
// G3 Part C (2026-08-20): produce a review worksheet for every DB
// spend category that (a) is not routed by Part A parse, and (b) does
// not have a concrete owner ruling. Same shape as
// card_category_rulings.xlsx: category name, FYTD dollars, top three
// merchants, blank ruling column, notes column, plus a running-percentage
// column so Kevin can see where to stop.
//
// Output: ~/Downloads/spend_category_review_2026-08-20.xlsx (LOCAL only,
// not committed - the spec forbids committing worksheets).
//
// Sourcing:
//   - Category name via CSV Transaction ID -> DB external_id join
//     (same technique as purchasing_apply_category_rulings.mjs)
//   - FYTD dollars = non-excluded card actuals sum per category in
//     purchasing_actuals (the derive fact table). Non-excluded because
//     the review question is "should this money route to X" - excluded
//     rows are already off the board.
//   - Top merchants = merchant_name histogram across all raw
//     rippling_raw_spend_lines_latest rows for the cat.
//   - Any category the applier already resolved (provenance IS NOT NULL
//     with gl_line_code IS NOT NULL) is excluded from the worksheet;
//     it's already routed.
//
// CLI:
//   node --env-file=.env.local scripts/purchasing_review_worksheet.mjs

import fs from "node:fs";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

// Duplicated from purchasing_apply_category_rulings.mjs. The applier runs at
// import time (top-level DB queries), so we can't safely `import` from it -
// this list is short and Kevin adjudicates additions per-collision, so a
// duplicated small Set is safer than importing side-effectful code. Kevin
// ruling 2026-08-20: for these cat_ids, do NOT resolve by majority vote.
// Include them in the Part C worksheet with BOTH names shown.
const COLLISION_UNROUTED = new Set([
  "68ed4977b7aabd4234afda3a",  // "Equipment Lease" vs "**Please Select A Category**"
]);

// Names carried by each collision cat_id, as identified by the sheets audit
// (three-part audit's LIVE verdict, 2026-08-20). We render these directly
// rather than re-computing via a CSV (txn|amt) join because that join is
// lossy (multiple CSV rows can share a (txn|amt) with an unrelated DB row).
const COLLISION_NAMES = new Map([
  ["68ed4977b7aabd4234afda3a", ["Equipment Lease", "**Please Select A Category**"]],
]);

const OUT = `${process.env.HOME}/Downloads/spend_category_review_2026-08-20.xlsx`;
const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ─── CSV helpers (same as applier) ───────────────────────────────────
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

async function buildCategoryIdToName() {
  const records = loadCsvRecords(CSV);
  const header = parseCsvLine(records[0]);
  const txnIdIdx = header.indexOf("Transaction ID");
  const catNameIdx = header.indexOf("Category Name");
  const csvTxnToName = new Map();
  for (let n = 1; n < records.length; n++) {
    const cells = parseCsvLine(records[n]);
    const t = cells[txnIdIdx]; if (!t) continue;
    const nm = cells[catNameIdx];
    if (!csvTxnToName.has(t) && nm) csvTxnToName.set(t, nm);
  }
  const dbTxnToCat = new Map();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("category_id, external_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load raw spend: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (!r.external_id) continue;
      const idx = r.external_id.indexOf("__line_item");
      const t = idx > 0 ? r.external_id.slice(0, idx) : null;
      if (t && r.category_id && !dbTxnToCat.has(t)) dbTxnToCat.set(t, r.category_id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const catIdToName = new Map();
  for (const [t, name] of csvTxnToName) {
    const cid = dbTxnToCat.get(t);
    if (!cid) continue;
    if (!catIdToName.has(cid) && name && name !== "null") catIdToName.set(cid, name);
  }
  return catIdToName;
}

async function loadSpendCategoryMap() {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  let selectExpr = "category_id, category_label, gl_line_code, provenance, merchant_sample";
  for (;;) {
    let { data, error } = await supa.from("spend_category_map")
      .select(selectExpr)
      .order("category_id")
      .range(from, from + PAGE - 1);
    if (error && /column .*provenance.* does not exist/i.test(error.message)) {
      selectExpr = "category_id, category_label, gl_line_code, merchant_sample";
      const retry = await supa.from("spend_category_map").select(selectExpr).order("category_id").range(from, from + PAGE - 1);
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

async function loadRawSpendPaginated() {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
      .select("category_id, rippling_id, merchant_name, amount, external_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load raw: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function loadActualsPaginated() {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supa.from("purchasing_actuals")
      .select("source_line_id, amount, excluded")
      .eq("source", "rippling_spend")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load actuals: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ─── Compose the worksheet ────────────────────────────────────────────
const catIdToName = await buildCategoryIdToName();
console.log(`[names] resolved ${catIdToName.size} names`);
console.log(`[collision] set size: ${COLLISION_UNROUTED.size}`);
for (const c of COLLISION_UNROUTED) {
  console.log(`  ${c}: ${(COLLISION_NAMES.get(c) || []).join(" / ")}`);
}
const scm = await loadSpendCategoryMap();
console.log(`[scm] loaded ${scm.length}`);
const raw = await loadRawSpendPaginated();
const actuals = await loadActualsPaginated();
console.log(`[raw] ${raw.length} rows  [actuals] ${actuals.length} rows`);

// rippling_id -> category_id (for actuals join)
const ridToCat = new Map();
for (const r of raw) ridToCat.set(r.rippling_id, r.category_id);

// Aggregate by category
const byCat = new Map();
for (const r of raw) {
  const c = r.category_id;
  if (!c) continue;
  if (!byCat.has(c)) byCat.set(c, { merchants: new Map(), raw_amount: 0, raw_count: 0, actual_non_excl: 0, actual_excl: 0, actual_non_excl_count: 0, actual_excl_count: 0 });
  const g = byCat.get(c);
  g.raw_amount += Number(r.amount || 0);
  g.raw_count++;
  if (r.merchant_name) g.merchants.set(r.merchant_name, (g.merchants.get(r.merchant_name) || 0) + 1);
}
for (const a of actuals) {
  const rid = a.source_line_id.replace(/^rippling_spend:/, "");
  const c = ridToCat.get(rid);
  if (!c) continue;
  const g = byCat.get(c);
  if (!g) continue;
  const amt = Number(a.amount || 0);
  if (a.excluded) { g.actual_excl += amt; g.actual_excl_count++; }
  else { g.actual_non_excl += amt; g.actual_non_excl_count++; }
}

// Determine which categories need review: any where provenance is NOT
// 'owner_ruling_2026-08-20' AND NOT 'parsed_from_name'. Include:
//   - the 2 unnamed (no ruling, no parse)
//   - Please Select (UNROUTED) - acknowledged but stays in queue
//   - collision cat_id (Equipment Lease / Please Select)
// Do NOT include: 32 parsed + 21 ruled = 53 already-routed (Equipment
// moved into RULINGS 2026-08-21: 5002.5).
const NEEDS_REVIEW = [];
for (const row of scm) {
  const name = catIdToName.get(row.category_id) || row.category_label || null;
  const g = byCat.get(row.category_id) || null;
  const nonExcl = g ? g.actual_non_excl : 0;
  const isCollision = COLLISION_UNROUTED.has(row.category_id);
  // Category is "resolved" if gl_line_code is set (post-applier) OR
  // if the name parses (Part A). Pre-applier we compute from name.
  const parseRe = /^(\d{4}(?:\.\d+)*)/;
  const parses = name ? parseRe.test(String(name).trim()) : false;
  // Rulings map (subset - just care whether the name is in it)
  const RULINGS = new Set([
    "Operations Travel", "Dues & Subscriptions", "Sales Travel",
    "General Repair & Maintenance", "Sales Function Event",
    "Computer Hardware", "Leased Vehicles", "Perks", "Building Lease",
    "License & Fees", "Meals & Entertainment", "Storage Lease",
    "Equipment Lease", "General Utilities", "Recruiting", "Printer Lease",
    "Office Supplies", "General Liability Insurance",
    "Account Management Travel", "Training", "Due to EE",
    "Equipment",  // owner ruling 2026-08-21: 5002.5 (Purchasing - Equipment)
  ]);
  const ruled = name && RULINGS.has(name);
  // Kevin ruling 2026-08-20: collision cat_ids bypass the "already-ruled"
  // exclusion. The id carries two names in the CSV so the majority-vote
  // resolution is unsafe. Route into the worksheet with BOTH names shown.
  if ((parses || ruled) && !isCollision) continue;
  let displayName, notesPreFill;
  if (isCollision) {
    const names = COLLISION_NAMES.get(row.category_id) || [];
    displayName = names.length
      ? `${names.join(" / ")}  (COLLISION - id carries multiple names)`
      : `(COLLISION - names not enumerated)`;
    notesPreFill = "Cat id carries two names in CSV. Kevin to decide: rule under one name, split into two, or stay unrouted.";
  } else {
    displayName = name || "(no CSV name)";
    notesPreFill = "";
  }
  NEEDS_REVIEW.push({
    category_id: row.category_id,
    name: displayName,
    notes_prefill: notesPreFill,
    fytd_non_excluded: nonExcl,
    raw_amount: g ? g.raw_amount : 0,
    actual_excluded: g ? g.actual_excl : 0,
    raw_count: g ? g.raw_count : 0,
    top_merchants: g ? [...g.merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${m} (${n})`) : [],
    is_collision: isCollision,
  });
}
NEEDS_REVIEW.sort((a, b) => b.fytd_non_excluded - a.fytd_non_excluded);
const totalReview = NEEDS_REVIEW.reduce((s, r) => s + r.fytd_non_excluded, 0);

console.log(`\n[worksheet] categories needing review: ${NEEDS_REVIEW.length}`);
console.log(`[worksheet] total FYTD non-excluded across those: $${totalReview.toFixed(2)}`);

// Build xlsx
const wb = new ExcelJS.Workbook();
wb.creator = "purchasing_review_worksheet.mjs (G3)";
wb.created = new Date();

const info = wb.addWorksheet("Info");
info.addRow(["G3 Part C - spend categories needing an owner ruling"]);
info.addRow(["Generated: " + new Date().toISOString()]);
info.addRow(["Source: purchasing_actuals + rippling_raw_spend_lines_latest + Custom_report CSV"]);
info.addRow([]);
info.addRow(["What this is:"]);
info.addRow(["  DB categories that neither parsed a GL from name (Part A) nor were ruled by"]);
info.addRow(["  Kevin in card_category_rulings.xlsx (Part B). Every dollar here is card"]);
info.addRow(["  spend currently sitting UNROUTED in the pending queue."]);
info.addRow([]);
info.addRow(["How to use:"]);
info.addRow(["  Column D (My ruling): fill in a bucket - SG&A / PURCHASING - Vehicle / "]);
info.addRow(["                        REIMBURSABLE / PURCHASING - Food / PURCHASING - Packaging"]);
info.addRow(["                        / PURCHASING - Equipment / PURCHASING - R&M / UNROUTED"]);
info.addRow(["  Column E (Notes):     any context back to the engineer"]);
info.addRow([]);
info.addRow(["Sorted by non-excluded FYTD dollars descending. Column C running-% shows"]);
info.addRow(["cumulative share so it's easy to stop after the material rows."]);
info.getColumn(1).width = 90;

const ws = wb.addWorksheet("Review");
ws.addRow(["Category", "FYTD $ (non-excluded)", "Cumulative %", "My ruling", "Notes", "Top merchants", "Category ID", "Raw $ (all obs.)", "Excluded $"]);
ws.getRow(1).font = { bold: true };
ws.getColumn(1).width = 40;
ws.getColumn(2).width = 18;
ws.getColumn(3).width = 14;
ws.getColumn(4).width = 24;
ws.getColumn(5).width = 40;
ws.getColumn(6).width = 60;
ws.getColumn(7).width = 28;
ws.getColumn(8).width = 18;
ws.getColumn(9).width = 18;

let cum = 0;
for (const r of NEEDS_REVIEW) {
  cum += r.fytd_non_excluded;
  const pct = totalReview > 0 ? (cum / totalReview) * 100 : 0;
  const row = ws.addRow([
    r.name,
    r.fytd_non_excluded,
    pct / 100,
    "",  // ruling
    r.notes_prefill || "",
    r.top_merchants.join("; "),
    r.category_id,
    r.raw_amount,
    r.actual_excluded,
  ]);
  row.getCell(2).numFmt = '"$"#,##0.00';
  row.getCell(3).numFmt = '0.0%';
  row.getCell(8).numFmt = '"$"#,##0.00';
  row.getCell(9).numFmt = '"$"#,##0.00';
  // Highlight collision rows so Kevin sees them at a glance.
  if (r.is_collision) {
    row.font = { bold: true };
    for (let c = 1; c <= 9; c++) {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE599" } };
    }
  }
}
// Total row
const totalRow = ws.addRow(["TOTAL awaiting a ruling", totalReview, 1, "", "", "", "", "", ""]);
totalRow.font = { bold: true };
totalRow.getCell(2).numFmt = '"$"#,##0.00';
totalRow.getCell(3).numFmt = '0.0%';

// Data validation on ruling column
const validationSheet = wb.addWorksheet("_dropdown");
validationSheet.state = "hidden";
const opts = [
  "SG&A",
  "PURCHASING - Food",
  "PURCHASING - Packaging",
  "PURCHASING - Vehicle",
  "PURCHASING - Equipment",
  "PURCHASING - R&M",
  "REIMBURSABLE",
  "UNROUTED",
  "LABOR (out of scope)",
];
opts.forEach((o, i) => validationSheet.getCell(i + 1, 1).value = o);
for (let i = 2; i <= NEEDS_REVIEW.length + 1; i++) {
  ws.getCell(i, 4).dataValidation = {
    type: "list",
    allowBlank: true,
    formulae: [`_dropdown!$A$1:$A$${opts.length}`],
  };
}

await wb.xlsx.writeFile(OUT);
console.log(`\n[worksheet] wrote ${OUT}`);
