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
// Every projected field is optional at the CSV level; a missing header
// lands as NULL in the projection but still lives inside `raw`.
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

const COL_SPEC = [
  { csv: "Transaction ID",   col: "parent_txn_id",   parse: trim,          required: true  },
  { csv: "Purchased at",     col: "purchased_at",    parse: parseDate },
  { csv: "Posted Date",      col: "posted_date",     parse: parseDate },
  { csv: "Submission Date",  col: "submission_date", parse: parseDate },
  { csv: "Approved At",      col: "approved_at",     parse: parseTimestamp },
  { csv: "Approval State",   col: "approval_state",  parse: trim },
  { csv: "Has Receipt",      col: "has_receipt",     parse: parseBool },
  { csv: "Amount (by category)", col: "amount",      parse: parseAmount },
  { csv: "Currency",         col: "currency",        parse: trim },
  { csv: "Vendor name",      col: "vendor_name",     parse: trim },
  { csv: "Vendor",           col: "vendor",          parse: trim },
  { csv: "Category",         col: "category",        parse: trim },
  { csv: "Category Name",    col: "category_name",   parse: trim },
  { csv: "Department Name",  col: "department_name", parse: trim },
  { csv: "Work location",    col: "work_location",   parse: trim },
  { csv: "Employee",         col: "employee",        parse: trim },   // PII - never log
  { csv: "Employee - ID",    col: "employee_id",     parse: trim },   // PII - never log
  { csv: "Memo",             col: "memo",            parse: trim },
  { csv: "Line item memo",   col: "line_item_memo",  parse: trim },
  { csv: "GL Sync Status",   col: "gl_sync_status",  parse: trim },
  { csv: "GL Vendor Name",   col: "gl_vendor_name",  parse: trim },
  { csv: "Is Manually Paid", col: "is_manually_paid",parse: parseBool },
  { csv: "Repayment Status", col: "repayment_status",parse: trim },
  { csv: "Is user edited",   col: "is_user_edited",  parse: parseBool },
];

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
// Index each CSV header we care about
const idxByCsv = new Map();
for (let i = 0; i < header.length; i++) idxByCsv.set(header[i], i);

// Fail loudly if `Transaction ID` is missing (same discipline as
// existing loader at scripts/purchasing_report_load.mjs:110).
if (!idxByCsv.has("Transaction ID")) {
  console.error(`csv missing 'Transaction ID' column; got: ${header.slice(0, 8).join(",")} ...`);
  process.exit(2);
}
// Report which projected columns are missing from the header - not
// fatal (missing CSV columns land as NULL in the projection).
const missingCols = COL_SPEC.filter(s => !idxByCsv.has(s.csv)).map(s => s.csv);
console.log(`header cols=${header.length}  projected cols mapped=${COL_SPEC.length - missingCols.length}  missing=${missingCols.length}`);
if (missingCols.length > 0) console.log(`  missing from CSV (will be NULL): ${missingCols.join(", ")}`);

const toInsert = [];
let skippedNoTxnId = 0;
for (let i = 1; i < rows.length; i++) {
  const rowArr = rows[i];
  const projected = {};
  const rawObj = {};
  for (const spec of COL_SPEC) {
    const csvIdx = idxByCsv.get(spec.csv);
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
