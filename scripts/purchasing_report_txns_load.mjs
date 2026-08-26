#!/usr/bin/env node
/**
 * scripts/purchasing_report_txns_load.mjs
 *
 * Phase-two loader: parse the full Rippling report CSV and populate
 * `rippling_report_txns`.  Sibling to `purchasing_report_load.mjs`
 * (which stays as-is - it feeds Ruling 4 arbitration and its contract
 * must not change).  Both loaders run against the same CSV inside the
 * orchestrator.
 *
 * Idempotent: content-hash append.  ON CONFLICT (parent_txn_id,
 * content_hash) DO UPDATE SET last_seen_at = NOW().  Re-ingesting the
 * same CSV inserts zero new rows and touches last_seen_at only.
 *
 * PII discipline:
 *   - `Employee` and `Employee - ID` are stored (schema needs them
 *     for future compliance decisions) but never logged.  Progress
 *     lines carry counts, hashes and dates only - never names, emails,
 *     merchants, memos or amounts.
 *
 * CLI:
 *   node --env-file=/path/to/.env.local scripts/purchasing_report_txns_load.mjs \
 *     [--csv=/absolute/path/to/Custom_report-<hash>.csv] \
 *     [--dry-run]
 *
 * Exit codes:
 *   0  success
 *   1  configuration error
 *   2  csv absent / unreadable / header mismatch
 *   3  db error
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const args = { csv: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--csv=")) args.csv = a.slice("--csv=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.csv) { console.error("--csv=<path> is required"); process.exit(1); }
if (!fs.existsSync(args.csv)) { console.error(`csv not found: ${args.csv}`); process.exit(2); }

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ─── RFC-4180 CSV parser (byte-identical to purchasing_report_load) ──
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++;
    } else {
      if (ch === "\"") { inQuotes = true; i++; }
      else if (ch === ",") { row.push(field); field = ""; i++; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
      else if (ch === "\r") { i++; }
      else { field += ch; i++; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Column map: CSV header -> projected column + parser ────────────
//
// Header matching is normalised against a stable primary form.  Rippling
// appends a grouping-label suffix to columns the report is grouped by:
//   `Amount (by category) (None)`  <- Amount, no grouping
//   `Amount (by category) (Category Name)`  <- grouped by category
// The suffix drifts every time the report is regrouped.  The
// normaliser strips a TRAILING ` (…)` group and lower-cases the rest
// so a regroup doesn't silently NULL a column.  Case wobble (e.g.
// `Department Name` vs `Department name`, both observed in the same
// file) is absorbed at the same layer.
//
// See `_probe_report_txns_mapping.mjs` for the sweep + edge cases.
//
// Matching is two-pass:
//   1. Exact normalised (trim + lowercase) match against every spec.
//      Catches `Amount (by category)`, `Purchased at`, etc. in their
//      bare (ungrouped) form.
//   2. If step 1 misses, strip a TRAILING ` (…)` grouping-label group
//      and retry.  Catches `Amount (by category) (None)` →
//      strip → `Amount (by category)` → maps to amount.  Also catches
//      `Purchased at (None)` → strip → `Purchased at` → maps to
//      purchased_at.
//
// A naive "always strip" pass mishandles the bare `Amount (by category)`
// because the intrinsic parens get stripped too.  Two-pass avoids that.
function normalise(h) {
  return String(h || "").trim().toLowerCase();
}
function stripTrailingParenGroup(h) {
  return String(h || "").trim().replace(/\s+\([^()]*\)\s*$/, "").trim();
}

// Every projected field is optional at the CSV level UNLESS listed in
// REQUIRED_COLUMNS below.  A missing OPTIONAL column lands as NULL in
// the projection but still lives inside `raw`.  A missing REQUIRED
// column exits the loader non-zero before any DB write.
function parseBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1")  return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return null;
}
function parseDate(v) {
  if (v == null || v === "") return null;
  // Accept `YYYY-MM-DD` and `MM/DD/YYYY` and `YYYY-MM-DDTHH:MM:SS...`.
  // Rippling reports commonly ship US-style; anchor both.
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}
function parseTimestamp(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  const d = parseDate(s);
  return d ? `${d}T00:00:00Z` : null;
}
function parseAmount(v) {
  if (v == null || v === "") return null;
  const s = String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function trim(v) { if (v == null) return null; const s = String(v).trim(); return s === "" ? null : s; }

// Every entry's `csv` is the primary shape we EXPECT.  Matching goes
// through `normaliseHeader()` on BOTH sides so case + trailing-paren
// suffixes drift without breaking the mapping.
const COL_SPEC = [
  { csv: "Transaction ID",       col: "parent_txn_id",   parse: trim },
  { csv: "Purchased at",         col: "purchased_at",    parse: parseDate },
  { csv: "Posted Date",          col: "posted_date",     parse: parseDate },
  { csv: "Submission Date",      col: "submission_date", parse: parseDate },
  { csv: "Approved At",          col: "approved_at",     parse: parseTimestamp },
  { csv: "Approval State",       col: "approval_state",  parse: trim },
  { csv: "Has Receipt",          col: "has_receipt",     parse: parseBool },
  { csv: "Amount (by category)", col: "amount",          parse: parseAmount },
  { csv: "Currency",             col: "currency",        parse: trim },
  { csv: "Vendor name",          col: "vendor_name",     parse: trim },
  { csv: "Vendor",               col: "vendor",          parse: trim },
  { csv: "Category",             col: "category",        parse: trim },
  { csv: "Category Name",        col: "category_name",   parse: trim },
  { csv: "Department Name",      col: "department_name", parse: trim },
  { csv: "Work location",        col: "work_location",   parse: trim },
  { csv: "Employee",             col: "employee",        parse: trim },   // PII - never log
  { csv: "Employee - ID",        col: "employee_id",     parse: trim },   // PII - never log
  { csv: "Memo",                 col: "memo",            parse: trim },
  { csv: "Line item memo",       col: "line_item_memo",  parse: trim },
  { csv: "GL Sync Status",       col: "gl_sync_status",  parse: trim },
  { csv: "GL Vendor Name",       col: "gl_vendor_name",  parse: trim },
  { csv: "Is Manually Paid",     col: "is_manually_paid",parse: parseBool },
  { csv: "Repayment Status",     col: "repayment_status",parse: trim },
  { csv: "Is user edited",       col: "is_user_edited",  parse: parseBool },
];

// Proposed required columns (owner rules).  A missing REQUIRED column
// exits the loader non-zero BEFORE any DB write, printing which
// column and what CSV headers were present (redacted to their
// normalised form).  Optional columns land as NULL in the projection.
//
// Rationale for the initial six:
//   - parent_txn_id  : the primary key; the loader already required it
//   - purchased_at   : the raison d'être of the phase-two loader
//                       (closes the 16-day API lag)
//   - amount         : the money.  Every downstream card that uses
//                       this table needs it.
//   - currency       : needed to interpret amount honestly across
//                       future non-USD transactions
//   - work_location  : the attribution axis the board already uses
//   - approval_state : compliance signal, PR-6 dependency
//
// Owner ruling from this list before it hardens.
const REQUIRED_COLUMNS = new Set([
  "parent_txn_id",
  "purchased_at",
  "amount",
  "currency",
  "work_location",
  "approval_state",
]);

function contentHash(projected, rawRow) {
  // Deterministic - sorted keys.  Uses projected values (parsed) so
  // a whitespace-only diff on the CSV does not force a re-insert.
  const keys = Object.keys(projected).sort();
  const canonical = keys.map(k => `${k}=${JSON.stringify(projected[k])}`).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

const t0 = Date.now();
console.log(`purchasing_report_txns_load csv=${args.csv} dryRun=${args.dryRun}`);
const raw = fs.readFileSync(args.csv, "utf8");
const rows = parseCSV(raw);
if (rows.length < 2) { console.error("csv is empty or header-only"); process.exit(2); }

const header = rows[0].map(h => h.trim());

// Build the spec index once, keyed by the spec's own normalised form.
const specByKey = new Map();
for (const s of COL_SPEC) specByKey.set(normalise(s.csv), s);

// Two-pass CSV header index: try exact-normalised first, then strip
// the trailing grouping paren and retry.
const specToCsvIdx = new Map();          // table_col -> header index
const csvIdxToSpec = new Map();          // header index -> spec (for logging)
const collisions = [];
for (let i = 0; i < header.length; i++) {
  const raw = header[i];
  if (!raw) continue;
  const keyA = normalise(raw);
  let spec = specByKey.get(keyA);
  if (!spec) {
    const stripped = normalise(stripTrailingParenGroup(raw));
    if (stripped !== keyA) spec = specByKey.get(stripped);
  }
  if (!spec) continue;
  if (specToCsvIdx.has(spec.col)) {
    // Two CSV headers both map to the same spec column (e.g.
    // `Department Name` and `Department name`).  Keep the first;
    // log the collision so an operator can spot the duplication.
    collisions.push({ col: spec.col, kept: header[specToCsvIdx.get(spec.col)], skipped: raw });
    continue;
  }
  specToCsvIdx.set(spec.col, i);
  csvIdxToSpec.set(i, spec);
}

const mapped = [];
const missing = [];
for (const spec of COL_SPEC) {
  const idx = specToCsvIdx.get(spec.col);
  if (idx == null) missing.push(spec);
  else mapped.push({ spec, idx, actualHeader: header[idx] });
}
console.log(`header cols=${header.length}  spec cols=${COL_SPEC.length}  mapped=${mapped.length}  missing=${missing.length}`);
if (collisions.length > 0) {
  console.log(`  header collisions (mapped to same table col; kept the first):`);
  for (const c of collisions) console.log(`    "${c.kept}" and "${c.skipped}" both -> ${c.col}`);
}
if (missing.length > 0) {
  const requiredMissing = missing.filter(s => REQUIRED_COLUMNS.has(s.col));
  const optionalMissing = missing.filter(s => !REQUIRED_COLUMNS.has(s.col));
  if (optionalMissing.length > 0) {
    console.log(`  missing OPTIONAL columns (will be NULL): ${optionalMissing.map(s => `${s.col} (expected "${s.csv}")`).join(", ")}`);
  }
  if (requiredMissing.length > 0) {
    console.error("");
    console.error("REQUIRED column(s) missing from the CSV. Loader will not proceed.");
    for (const s of requiredMissing) {
      console.error(`  - table column '${s.col}' (expected "${s.csv}", normalised "${normalise(s.csv)}")`);
    }
    console.error(`\nCSV had ${header.length} headers; normalised set:`);
    const normSet = [...new Set(header.map(normalise).filter(Boolean))].sort();
    for (const n of normSet) console.error(`  "${n}"`);
    process.exit(2);
  }
}

const toInsert = [];
let skippedNoTxnId = 0;
for (let i = 1; i < rows.length; i++) {
  const rowArr = rows[i];
  const projected = {};
  const rawObj = {};
  for (const spec of COL_SPEC) {
    const csvIdx = specToCsvIdx.get(spec.col);
    const cellRaw = csvIdx != null ? rowArr[csvIdx] : null;
    projected[spec.col] = spec.parse(cellRaw);
  }
  // Build raw JSONB from ALL header/value pairs so future columns
  // survive even if COL_SPEC doesn't project them yet.
  for (let c = 0; c < header.length; c++) {
    const h = header[c];
    if (!h) continue;
    rawObj[h] = rowArr[c] ?? null;
  }
  if (!projected.parent_txn_id) { skippedNoTxnId++; continue; }
  const hash = contentHash(projected, rawObj);
  toInsert.push({ ...projected, content_hash: hash, raw: rawObj });
}
console.log(`parsed: data_rows=${rows.length - 1}  skipped_no_txn_id=${skippedNoTxnId}  candidate_rows=${toInsert.length}`);

if (args.dryRun) {
  console.log(`--dry-run set; skipping DB writes`);
  process.exit(0);
}

// Batch upsert with ignoreDuplicates so a repeat ingest of the same
// CSV inserts nothing.  Postgres UNIQUE (parent_txn_id, content_hash)
// enforces this.
let inserted = 0, skipped = 0;
for (let i = 0; i < toInsert.length; i += 500) {
  const batch = toInsert.slice(i, i + 500);
  const resp = await supa
    .from("rippling_report_txns")
    .upsert(batch, { onConflict: "parent_txn_id,content_hash", ignoreDuplicates: true })
    .select("id");
  if (resp.error) {
    // Do NOT log the batch contents (carries employee names, memos).
    // Message only.
    console.error(`insert batch ${i}..${i + batch.length} FAILED: ${resp.error.message}`);
    process.exit(3);
  }
  const insertedRows = (resp.data || []).length;
  inserted += insertedRows;
  skipped += batch.length - insertedRows;
  process.stderr.write(`  progress ${i + batch.length}/${toInsert.length} inserted=${inserted} skipped=${skipped}\r`);
}
process.stderr.write("\n");

// Post-load row count (Kevin's rule 4: any new-table sync needs a
// post-sync row-count check).
const { count: total } = await supa.from("rippling_report_txns").select("*", { count: "exact", head: true });
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`done: inserted=${inserted}  skipped_existing=${skipped}  row_count_now=${total}  duration=${dur}s`);
if (total === 0) {
  console.error("POST-SYNC ROW COUNT IS ZERO - table exists but empty (see billcom_ref_vendors incident)");
  process.exit(3);
}
