// scripts/purchasing_report_load.mjs
//
// Ruling 4 seed: load the parent Transaction IDs from the current
// unfiltered Rippling custom-report CSV into rippling_report_seen_txns.
// The derive consults this table when arbitrating same-merchant same-
// amount pairs within 5 days (spec §PRECEDENCE 1..3):
//   1. Both parents of a pair in report -> keep both
//   2. Only the earlier in report        -> keep the earlier
//   3. Otherwise                          -> keep the later
//
// Two input paths, both idempotent:
//
//   A. Fresh Rippling CSV export via --csv=<path> (the original path).
//      Preserved verbatim so a re-export can seed the table without
//      needing an intermediate step.
//
//   B. Repo-committed ID snapshot at data/rippling_report_seen_txns.txt
//      (the fresh-clone reproducibility path). Fires when no --csv= is
//      supplied. The file is pure 24-hex ObjectIDs, one per line, and
//      is described in data/rippling_report_seen_txns.md - including
//      the fact that it is a SNAPSHOT that decays until the scheduled
//      report-email ingestion lane (KPI_PURCHASING_MASTER §6.6) lands.
//
// Both paths upsert with ignoreDuplicates so repeat runs are no-ops.
//
// CLI:
//   node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local \
//     scripts/purchasing_report_load.mjs \
//     [--csv=/absolute/path/to/Custom_report-<hash>.csv] \
//     [--source-note="seed 2026-08-20 auth-pair"]
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = { csv: null, sourceNote: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--csv=")) args.csv = a.slice("--csv=".length);
    else if (a.startsWith("--source-note=")) args.sourceNote = a.slice("--source-note=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else { console.error("unknown arg: " + a); process.exit(1); }
  }
  return args;
}

const args = parseArgs(process.argv);

// Path B (repo snapshot) fires when --csv= is not supplied. Guard the
// CSV existence check to path A only so the fallback can run.
const SNAPSHOT_PATH = "data/rippling_report_seen_txns.txt";
if (args.csv && !fs.existsSync(args.csv)) {
  console.error(`csv not found: ${args.csv}`);
  process.exit(1);
}
if (!args.csv && !fs.existsSync(SNAPSHOT_PATH)) {
  console.error(`no --csv supplied and snapshot missing: ${SNAPSHOT_PATH}`);
  process.exit(1);
}

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ─── Minimal RFC-4180 CSV parser ────────────────────────────────────────
// Handles quoted fields with embedded commas, escaped double-quotes, and
// CRLF or LF line endings. Deliberately dependency-free.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
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

const t0 = Date.now();
const source = args.csv ? args.csv : SNAPSHOT_PATH;
const sourceKind = args.csv ? "csv" : "snapshot";
console.log(`purchasing_report_load source=${source} kind=${sourceKind} dryRun=${args.dryRun}`);

const parents = new Set();

if (sourceKind === "csv") {
  const raw = fs.readFileSync(args.csv, "utf8");
  const rows = parseCSV(raw);
  if (rows.length < 2) { console.error("csv is empty or header-only"); process.exit(1); }
  const header = rows[0];
  const txnIdx = header.indexOf("Transaction ID");
  if (txnIdx < 0) { console.error("csv missing 'Transaction ID' column; got: " + header.slice(0, 8).join(",") + " ..."); process.exit(1); }
  let dataRows = 0;
  let missing = 0;
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i][txnIdx];
    dataRows++;
    if (!id) { missing++; continue; }
    parents.add(id);
  }
  console.log(`parsed: data_rows=${dataRows}  missing_txn_id=${missing}  distinct_parent_ids=${parents.size}`);
} else {
  // Path B: snapshot file. Pure 24-hex ObjectIDs, one per line, sorted.
  // Skip blanks. Anything not matching the hex shape is a repo bug the
  // .md sibling forbids - fail loudly rather than seed a garbage id.
  const raw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  const HEX24 = /^[a-f0-9]{24}$/;
  let bad = 0;
  for (const line of lines) {
    if (!line) continue;
    if (!HEX24.test(line)) { bad++; continue; }
    parents.add(line);
  }
  if (bad > 0) {
    console.error(`snapshot has ${bad} non-hex lines; refusing to seed. Rebuild from a fresh Rippling export.`);
    process.exit(1);
  }
  console.log(`parsed snapshot: lines=${lines.length}  distinct_parent_ids=${parents.size}`);
}

if (args.dryRun) {
  console.log("dry-run - no insert");
  process.exit(0);
}

const defaultNote = `seed ${new Date().toISOString().slice(0, 10)} (${sourceKind})`;
const rowsToInsert = [...parents].map(id => ({
  parent_txn_id: id,
  source_note:   args.sourceNote || defaultNote,
}));

let inserted = 0;
let skipped = 0;
for (let i = 0; i < rowsToInsert.length; i += 500) {
  const batch = rowsToInsert.slice(i, i + 500);
  // upsert with ignoreDuplicates so repeat seeds are idempotent
  const { data, error, status } = await supa
    .from("rippling_report_seen_txns")
    .upsert(batch, { onConflict: "parent_txn_id", ignoreDuplicates: true })
    .select("parent_txn_id");
  if (error) {
    console.error(`insert batch ${i}..${i + batch.length} FAILED: ${error.message} status=${status}`);
    process.exit(2);
  }
  const insertedRows = (data || []).length;
  inserted += insertedRows;
  skipped += batch.length - insertedRows;
  process.stderr.write(`  progress: ${i + batch.length}/${rowsToInsert.length} inserted=${inserted} skipped=${skipped}\r`);
}
process.stderr.write("\n");

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`done: inserted=${inserted}  skipped_existing=${skipped}  total_in_table=? duration=${dur}s`);
const { count } = await supa.from("rippling_report_seen_txns").select("*", { count: "exact", head: true });
console.log(`rippling_report_seen_txns row count now: ${count}`);
