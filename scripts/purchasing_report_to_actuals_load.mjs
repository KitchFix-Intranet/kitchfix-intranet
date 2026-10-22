#!/usr/bin/env node
/**
 * scripts/purchasing_report_to_actuals_load.mjs
 *
 * Stage 2 real-write loader. Consumes the nightly Rippling report CSV
 * (same file the orchestrator at purchasing_report_ingest.mjs
 * downloads via gmailReadReport) and writes rows into purchasing_actuals
 * (source='rippling_spend') for txn_date >= CARD_REPORT_SOURCE_FLOOR.
 *
 * Pre-floor rows are NEVER touched. Closed/verified Finance periods
 * (P10 and earlier for FY2026) stay exactly as the dead API walk left
 * them. The report feed owns the current period forward.
 *
 * Semantics:
 *   - DELETE from purchasing_actuals WHERE source='rippling_spend'
 *       AND txn_date >= floor
 *   - INSERT the mapped above-floor rows (bulk-chunked)
 *   - Idempotent: re-running on the same CSV reproduces the same set
 *     of rows exactly (same content_hash per source_line_id).
 *   - Clean recode handling: a recoded transaction produces a new
 *     content_hash in today's CSV; the delete+insert cycle guarantees
 *     the old content_hash row above-floor is purged.
 *
 * Columns written (REQUIRES Stage 1 migration applied in Studio):
 *   source, source_bill_id, source_line_id, account_key, excluded,
 *   gl_line_code, gl_bucket, txn_date, posting_date, amount,
 *   vendor_or_merchant, paid, approx_date,
 *   reconcile_status, employee_name, employee_id, has_receipt, memo
 *
 * CLI:
 *   node --env-file=/path/to/.env.local scripts/purchasing_report_to_actuals_load.mjs
 *     --csv=/absolute/path/to/report.csv
 *     [--dry-run]        skip DB writes; print what would be written.
 *
 * Exit codes:
 *   0  success
 *   1  configuration / arg error
 *   2  csv unreadable / parse error / schema mismatch
 *   3  database read or write error
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  readReportCsv,
} from "../src/lib/purchasing/reportCsvParser.js";
import {
  CARD_REPORT_SOURCE_FLOOR,
  buildDbCategoryMap,
  mapReportRowToActualsShape,
  assignSourceLineIds,
} from "../src/lib/purchasing/reportToActualsMap.js";

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

const t0 = Date.now();
console.log(`report_to_actuals_load csv=${args.csv} dryRun=${args.dryRun} floor=${CARD_REPORT_SOURCE_FLOOR}`);

// ─── Parse CSV ──────────────────────────────────────────────────────
const text = fs.readFileSync(args.csv, "utf8");
let csvRows;
try {
  csvRows = readReportCsv(text);
} catch (e) {
  console.error(`csv parse FAILED: ${e.message}`);
  process.exit(2);
}
console.log(`parsed: ${csvRows.length} rows with parent_txn_id`);

// ─── Fetch spend_category_map for label -> gl_line_code ─────────────
const catMapResp = await supa.from("spend_category_map").select("category_label, gl_line_code");
if (catMapResp.error) {
  console.error(`spend_category_map read FAILED: ${catMapResp.error.message}`);
  process.exit(3);
}
const dbCategoryMap = buildDbCategoryMap(catMapResp.data || []);
console.log(`category map: ${dbCategoryMap.size} labelled entries`);

// ─── Map rows + apply floor filter ──────────────────────────────────
const aboveFloor = [];
let countBelowFloor = 0;
let countNoDate = 0;
let countUnmappedWl = 0;
let countUnmappedCat = 0;
const unmappedWlSet = new Set();
const unmappedCatSet = new Set();

for (const r of csvRows) {
  const shape = mapReportRowToActualsShape(r, dbCategoryMap);
  if (shape._unmapped_work_location) {
    countUnmappedWl += 1;
    unmappedWlSet.add(r.work_location || "(null)");
  }
  if (shape._unmapped_category) {
    countUnmappedCat += 1;
    unmappedCatSet.add(r.category_name || "(null)");
  }
  const date = shape.txn_date;
  if (!date) { countNoDate += 1; continue; }
  if (String(date).slice(0, 10) < CARD_REPORT_SOURCE_FLOOR) { countBelowFloor += 1; continue; }
  aboveFloor.push(shape);
}

// Compose source_line_id = parent_txn_id::category_slug::ordinal.
// Ordinal disambiguates the rare (txn, category) duplicate; stable
// across runs via amount-desc + content_hash tiebreak sort.
const { stats: slidStats } = assignSourceLineIds(aboveFloor);

console.log(`csv_rows: ${csvRows.length}`);
console.log(`above_floor (txn_date >= ${CARD_REPORT_SOURCE_FLOOR}): ${aboveFloor.length}`);
console.log(`below_floor (not written): ${countBelowFloor}`);
console.log(`no_txn_date (dropped): ${countNoDate}`);
console.log(`unmapped_work_location (rows): ${countUnmappedWl}  (distinct labels: ${unmappedWlSet.size})`);
console.log(`unmapped_category (rows -> Food fallback): ${countUnmappedCat}  (distinct labels: ${unmappedCatSet.size})`);
console.log(`source_line_id composite: duplicate_txn_category_groups=${slidStats.duplicateGroups}  max_ordinal=${slidStats.maxOrdinal}`);

// Stop and report if there is an unmapped Work location - we never
// want to silently drop or mis-attribute card spend to an account
// map we have not seen before.
if (unmappedWlSet.size > 0) {
  console.error("");
  console.error("STOP: unmapped Work location labels present. Add them to WORK_LOCATION_MAP + the migration seed before proceeding.");
  for (const w of [...unmappedWlSet].sort()) console.error(`  - ${JSON.stringify(w)}`);
  process.exit(2);
}

// ─── Pre-floor freeze check ─────────────────────────────────────────
// Count + sum pre-floor rippling_spend rows BEFORE the write; compare
// to the same figure AFTER. They must be byte-identical - this write
// path never touches pre-floor rows.
async function preFloorStats() {
  // Paginate because Supabase caps a single query at 1000 rows.
  const PAGE = 1000;
  let count = 0, sum = 0;
  let from = 0;
  for (;;) {
    const q = await supa.from("purchasing_actuals")
      .select("amount, excluded")
      .eq("source", "rippling_spend")
      .lt("txn_date", CARD_REPORT_SOURCE_FLOOR)
      .range(from, from + PAGE - 1);
    if (q.error) throw new Error(`pre-floor read failed: ${q.error.message}`);
    const rows = q.data || [];
    for (const r of rows) {
      count += 1;
      if (!r.excluded) sum += Number(r.amount || 0);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return { count, sum };
}

const preBefore = await preFloorStats();
console.log(`pre-floor rows before write: count=${preBefore.count} sum=${preBefore.sum.toFixed(2)}`);

// ─── Dry-run early exit ────────────────────────────────────────────
if (args.dryRun) {
  console.log(``);
  console.log(`DRY-RUN: no DB write. Would delete + insert ${aboveFloor.length} rows above the floor.`);
  console.log(`DRY-RUN: pre-floor state would stay at count=${preBefore.count} sum=${preBefore.sum.toFixed(2)}.`);
  process.exit(0);
}

// ─── Empty-set guard (loader side) ──────────────────────────────────
//
// A broken or partial nightly report can parse to zero above-floor
// rows. The engine-side function returns 0 without touching anything
// in that case; the loader also skips the RPC entirely so the warning
// is visible in the log before the call. No hard error - an empty
// set is a legitimate no-op (quiet-period weeks, a wholly off-season
// run, a partial feed we'd rather observe than silently rebuild).
if (aboveFloor.length === 0) {
  console.warn("WARNING: zero above-floor rows - skipping swap, no write");
  console.log(`pre-floor rows after (unchanged): count=${preBefore.count} sum=${preBefore.sum.toFixed(2)}`);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`done: inserted=0 (empty-set guard) duration=${dur}s`);
  process.exit(0);
}

// ─── Atomic DELETE + INSERT via the swap RPC ────────────────────────
//
// Owner ruling 2026-10-22: a half-completed loader must not leave the
// current period empty. The swap_card_actuals_above_floor() PL/pgSQL
// function (purchasing-14 migration) does DELETE + INSERT in a single
// transaction - a RAISE inside INSERT rolls the DELETE back, so pre-
// run state is intact on any failure. Scope is clamped inside the
// function: only source='rippling_spend' AND txn_date >= floor can be
// touched. Pre-floor rows cannot be reached from this call. The
// function also carries its own empty-set guard as belt-and-
// suspenders against the loader-side check above.
//
// Shape stripped of diagnostic underscore fields before send.
const insertRows = aboveFloor.map(s => ({
  source: s.source,
  source_bill_id: s.source_bill_id,
  source_line_id: s.source_line_id,
  account_key: s.account_key,
  excluded: s.excluded,
  gl_line_code: s.gl_line_code,
  gl_bucket: s.gl_bucket,
  txn_date: s.txn_date,
  posting_date: s.posting_date,
  amount: s.amount,
  vendor_or_merchant: s.vendor_or_merchant,
  paid: s.paid,
  approx_date: s.approx_date,
  reconcile_status: s.reconcile_status,
  employee_name: s.employee_name,
  employee_id: s.employee_id,
  has_receipt: s.has_receipt,
  memo: s.memo,
}));

const rpcResp = await supa.rpc("swap_card_actuals_above_floor", {
  p_floor: CARD_REPORT_SOURCE_FLOOR,
  p_rows: insertRows,
});
if (rpcResp.error) {
  console.error(`swap_card_actuals_above_floor FAILED: ${rpcResp.error.message}`);
  const preAfter = await preFloorStats().catch(() => null);
  if (preAfter) {
    console.error(`pre-floor stats after RPC failure: count=${preAfter.count} sum=${preAfter.sum.toFixed(2)}  (expected count=${preBefore.count} sum=${preBefore.sum.toFixed(2)})`);
  }
  process.exit(3);
}
const inserted = Number(rpcResp.data || 0);
console.log(`atomic swap completed: inserted=${inserted}  (pre-floor untouched by WHERE clause inside RPC)`);

// ─── Pre-floor freeze check (after) ─────────────────────────────────
const preAfter = await preFloorStats();
console.log(`pre-floor rows after write: count=${preAfter.count} sum=${preAfter.sum.toFixed(2)}`);
if (preAfter.count !== preBefore.count || Math.abs(preAfter.sum - preBefore.sum) > 0.005) {
  console.error(`PRE-FLOOR FREEZE VIOLATED: pre count=${preBefore.count} sum=${preBefore.sum.toFixed(2)} vs post count=${preAfter.count} sum=${preAfter.sum.toFixed(2)}`);
  process.exit(3);
}
console.log(`pre-floor freeze: HELD (count + sum identical before/after)`);

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`done: inserted=${inserted} duration=${dur}s`);
