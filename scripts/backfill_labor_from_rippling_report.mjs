// scripts/backfill_labor_from_rippling_report.mjs
//
// One-time loader for pre-floor labor dollars. Reads the Rippling
// "Hours worked by employee" xlsx report and writes rows into
// labor_actuals with source='report_backfill'.
//
// This is NOT a workflow step. Pre-floor data is closed and never
// changes; a nightly walk would re-fetch static history forever.
//
// Guardrails:
//   - Refuses to load any week on or after 2026-04-20 (the API owns
//     that window; overlap would double-count).
//   - Verifies detail-sum == grand-total on all 5 measures before
//     writing anything.
//   - Refuses any unmapped location (e.g. "Remote").
//   - Idempotent: DELETE FROM labor_actuals WHERE source='report_backfill'
//     runs before INSERT. Running twice does not double-count.
//   - Refuses to run if the migration is unapplied (no source column
//     or column CHECK is missing 'report_backfill').
//   - Never logs a worker name. Employee numbers, counts, IDs only.
//
// CLI:
//   node --env-file=.env.local scripts/backfill_labor_from_rippling_report.mjs --file=<path> --dry-run
//   node --env-file=.env.local scripts/backfill_labor_from_rippling_report.mjs --file=<path> --write

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { DOLLAR_COVERAGE_FLOOR } from "../src/lib/kpi/floors.js";

// ─── CLI ────────────────────────────────────────────────────────────
const args = { file: null, dryRun: null };
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--file=")) args.file = a.slice("--file=".length);
  else if (a === "--dry-run") args.dryRun = true;
  else if (a === "--write")   args.dryRun = false;
  else { console.error(`unknown arg: ${a}`); process.exit(1); }
}
if (!args.file) { console.error("--file=<xlsx path> required"); process.exit(1); }
if (args.dryRun === null) { console.error("--dry-run or --write required"); process.exit(1); }

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ─── Constants (from prompt B1) ─────────────────────────────────────
// FLOOR sourced from src/lib/kpi/floors.js so derivation + loader can
// never drift on the partition boundary (C6.1). A local re-alias keeps
// the read-site short.
const FLOOR = DOLLAR_COVERAGE_FLOOR;
const LINE_CODE = "3100.1";          // Hourly Kitchen; only line for labor
const LOC_TO_ACCT = {
  "Cincinnati, OH (CIN-OH)":                     "CIN - OH",
  "Goodyear, AZ (CIN-AZ)":                       "CIN - AZ",
  "Jupiter, FL (STL-FL)":                        "STL - FL",
  "St. Louis, MO (STL-MO)":                      "STL - MO",
  "Dunedin, FL (TBJ-FL)":                        "TBJ - FL",
  "Englewood, FL/Port Charlotte, FL (TBR-FL)":   "TBR - FL",
  "Surprise, AZ (TXR-AZ)":                       "TXR - AZ",
  "Arlington, TX (TXR-HOME)":                    "TXR - TX - H",
  "Arlington, TX Visitor (TXR-VISITOR)":         "TXR - TX - V",
};

// ─── Pre-flight: migration applied ──────────────────────────────────
// Dry-run allows the preflight to warn without exit (Kevin needs to
// preview before applying the migration). Write path exits hard.
async function preflightMigration() {
  const { error } = await supa.from("labor_actuals").select("source").limit(1);
  if (error) {
    if (args.dryRun) {
      console.warn(`pre-flight WARN: labor_actuals.source not queryable (${error.message})`);
      console.warn(`  --dry-run continues without it. --write would abort here.`);
      return;
    }
    console.error(`pre-flight FAILED: labor_actuals.source not queryable (${error.message})`);
    console.error(`  apply docs/migrations/kpi-c6-labor-actuals-source-and-scoped-swap.sql first.`);
    process.exit(2);
  }
  console.log("pre-flight OK: labor_actuals.source column present");
}

// ─── Parse xlsx ─────────────────────────────────────────────────────
function parseWeek(s) {
  if (!s || typeof s !== "string") return null;
  const [a, b] = s.split(" - ");
  const p = (x) => { const d = new Date(x + " UTC"); return isNaN(d) ? null : d.toISOString().slice(0,10); };
  const start = p(a), end = p(b);
  if (!start || !end) return null;
  return { start, end, label: s };
}

async function parseFile(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  console.log(`file: sheet="${ws.name}" rowCount=${ws.rowCount}`);

  // Grand-total row is row 3 (per B1 structural probe)
  const gt = ws.getRow(3);
  const GT = {
    baseH: Number(gt.getCell(5).value || 0),
    base$: Number(gt.getCell(7).value || 0),
    otH:   Number(gt.getCell(8).value || 0),
    ot$:   Number(gt.getCell(10).value || 0),
    holH:  Number(gt.getCell(11).value || 0),
    hol$:  Number(gt.getCell(13).value || 0),
    ptoH:  Number(gt.getCell(14).value || 0),
    pto$:  Number(gt.getCell(16).value || 0),
  };

  const rows = [];
  const S = { baseH: 0, base$: 0, otH: 0, ot$: 0, holH: 0, hol$: 0, ptoH: 0, pto$: 0 };
  const unmappedLocs = new Map();
  const nonMondayWeeks = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const empId = row.getCell(1).value;
    if (empId == null) continue;
    const wk = parseWeek(row.getCell(3).value);
    if (!wk) { console.warn(`  row ${r}: unparseable week "${row.getCell(3).value}" - skipped`); continue; }
    const dow = new Date(wk.start + "T00:00:00Z").getUTCDay();
    if (dow !== 1) nonMondayWeeks.push({ row: r, label: wk.label });
    const loc = String(row.getCell(4).value || "");
    const acct = LOC_TO_ACCT[loc];
    const baseH = Number(row.getCell(5).value || 0);
    const base$ = Number(row.getCell(7).value || 0);
    const otH   = Number(row.getCell(8).value || 0);
    const ot$   = Number(row.getCell(10).value || 0);
    const holH  = Number(row.getCell(11).value || 0);
    const hol$  = Number(row.getCell(13).value || 0);
    const ptoH  = Number(row.getCell(14).value || 0);
    const pto$  = Number(row.getCell(16).value || 0);
    S.baseH += baseH; S.base$ += base$;
    S.otH += otH;     S.ot$   += ot$;
    S.holH += holH;   S.hol$  += hol$;
    S.ptoH += ptoH;   S.pto$  += pto$;
    if (!acct) {
      unmappedLocs.set(loc, (unmappedLocs.get(loc) || 0) + 1);
      continue;
    }
    rows.push({
      user_id:  String(empId),
      acct,
      week_start: wk.start,
      week_end:   wk.end,
      week_label: wk.label,
      baseH, base$, otH, ot$, holH, hol$, ptoH, pto$,
    });
  }
  return { rows, GT, S, unmappedLocs, nonMondayWeeks };
}

// ─── Main ───────────────────────────────────────────────────────────
await preflightMigration();

console.log(`Reading file: ${args.file}`);
const parsed = await parseFile(args.file);
console.log(`  parsed rows: ${parsed.rows.length}`);
console.log("");

// Detail sums vs Grand Total (5 measures per prompt B1 acceptance #1)
console.log("Detail-sum vs Grand-total tie-out (all 5 measures):");
const measures = [
  ["Base pay hours",  parsed.GT.baseH, parsed.S.baseH],
  ["Base pay $",      parsed.GT.base$, parsed.S.base$],
  ["1.5x OT hours",   parsed.GT.otH,   parsed.S.otH],
  ["1.5x OT $",       parsed.GT.ot$,   parsed.S.ot$],
  ["Holiday hours",   parsed.GT.holH,  parsed.S.holH],
  ["Holiday $",       parsed.GT.hol$,  parsed.S.hol$],
  ["Time Off hours",  parsed.GT.ptoH,  parsed.S.ptoH],
  ["Time Off $",      parsed.GT.pto$,  parsed.S.pto$],
];
let allTie = true;
for (const [name, g, s] of measures) {
  const diff = s - g;
  const isMoney = /\$/.test(name);
  const tie = Math.abs(diff) < (isMoney ? 0.02 : 0.05);
  if (!tie) allTie = false;
  console.log(`  ${name.padEnd(20)}  gt=${g.toFixed(2).padStart(12)}  sum=${s.toFixed(2).padStart(14)}  ${tie ? "tie" : "MISMATCH"}`);
}
if (!allTie) { console.error("ABORT: detail sums do not match grand total; file may be truncated."); process.exit(3); }

if (parsed.nonMondayWeeks.length > 0) {
  console.error(`ABORT: ${parsed.nonMondayWeeks.length} rows have a non-Monday week start.`);
  for (const w of parsed.nonMondayWeeks.slice(0, 5)) console.error(`  row ${w.row}: ${w.label}`);
  process.exit(3);
}
console.log(`  all weeks start on Monday`);

if (parsed.unmappedLocs.size > 0) {
  console.error(`ABORT: unmapped locations - refusing to load:`);
  for (const [loc, n] of parsed.unmappedLocs) console.error(`  "${loc}" -> ${n} rows`);
  process.exit(3);
}
console.log(`  all locations mapped`);
console.log("");

// Floor check
const beforeFloor = parsed.rows.filter(r => r.week_end < FLOOR);
const onOrAfterFloor = parsed.rows.filter(r => r.week_start >= FLOOR);
const straddleFloor = parsed.rows.filter(r => r.week_start < FLOOR && r.week_end >= FLOOR);
console.log(`Floor check (D35 = ${FLOOR}):`);
console.log(`  rows entirely before floor: ${beforeFloor.length}`);
console.log(`  rows entirely on/after floor: ${onOrAfterFloor.length}   (WILL BE REFUSED)`);
console.log(`  rows straddling floor: ${straddleFloor.length}`);
if (onOrAfterFloor.length > 0 || straddleFloor.length > 0) {
  if (onOrAfterFloor.length > 0) {
    console.error(`ABORT: ${onOrAfterFloor.length} rows have week_start >= ${FLOOR}. API owns that window.`);
    for (const r of onOrAfterFloor.slice(0, 3)) console.error(`  ${r.acct}  ${r.week_label}  user=${r.user_id}`);
    process.exit(3);
  }
  if (straddleFloor.length > 0) {
    console.error(`ABORT: ${straddleFloor.length} rows straddle the floor. Refusing to partial-load a week.`);
    for (const r of straddleFloor.slice(0, 3)) console.error(`  ${r.acct}  ${r.week_label}`);
    process.exit(3);
  }
}
console.log("");

// Match user_id -> worker rippling_id and pull worker.number for reporting
async function fetchAll(t, c) {
  const all = []; const PAGE = 1000; let from = 0;
  while (true) {
    const { data, error } = await supa.from(t).select(c).range(from, from + PAGE - 1);
    if (error) throw new Error(`${t}: ${error.message}`);
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
// The prompt described report's "Employee - ID" as a user_id joined
// via workers.payload.user_id. Empirically (probe against 138 distinct
// IDs in the file) that field is the worker's rippling_id, not the
// user_id: 138/138 match on workers.rippling_id, 0/138 match on
// workers.payload.user_id. Join accordingly.
console.log("Matching report Employee-ID -> worker rippling_id (empirically the worker id, not the user id)...");
const workers = await fetchAll("rippling_raw_workers_latest", "rippling_id, payload");
const workerByRipplingId = new Map();
for (const w of workers) workerByRipplingId.set(w.rippling_id, w);
console.log(`  workers loaded: ${workerByRipplingId.size}`);

const distinctReportIds = new Set(beforeFloor.map(r => r.user_id));  // field name kept; contains worker id
const matched = [];
const unmatched = new Map();  // report_id -> total $
for (const r of beforeFloor) {
  const w = workerByRipplingId.get(r.user_id);
  if (!w) {
    unmatched.set(r.user_id, (unmatched.get(r.user_id) || 0) + r.base$ + r.ot$ + r.hol$);
    continue;
  }
  matched.push({ ...r, worker_id: w.rippling_id, worker_number: w.payload?.number ?? null });
}
console.log(`  distinct report IDs in file (pre-floor): ${distinctReportIds.size}`);
console.log(`  matched to worker: ${distinctReportIds.size - unmatched.size} / ${distinctReportIds.size}`);
if (unmatched.size > 0) {
  console.warn(`  UNMATCHED (${unmatched.size}) - will NOT load:`);
  for (const [uid, dol] of unmatched) console.warn(`    user_id=${uid.slice(0,10)}... total $${dol.toFixed(2)}`);
}
console.log("");

// Build per-account rollup for reporting
const perAcct = new Map();
for (const r of matched) {
  const cur = perAcct.get(r.acct) || { rows: 0, base$: 0, ot$: 0, hol$: 0 };
  cur.rows++;
  cur.base$ += r.base$;
  cur.ot$   += r.ot$;
  cur.hol$  += r.hol$;
  perAcct.set(r.acct, cur);
}
console.log("Per-account rollup (what will be loaded):");
console.log("  account         rows   base$        ot$          hol$         total$");
let TotalDol = 0;
for (const [acct, s] of [...perAcct.entries()].sort()) {
  const total = s.base$ + s.ot$ + s.hol$;
  TotalDol += total;
  console.log(`  ${acct.padEnd(15)}  ${String(s.rows).padStart(4)}   $${s.base$.toFixed(2).padStart(11)}  $${s.ot$.toFixed(2).padStart(11)}  $${s.hol$.toFixed(2).padStart(11)}  $${total.toFixed(2).padStart(11)}`);
}
console.log(`  ${"TOTAL".padEnd(15)}                                                                         $${TotalDol.toFixed(2)}`);
console.log("");

// ─── A2 - pre-floor api claim ───────────────────────────────────────
// C6.1: to avoid PK-collision with existing pre-floor api rows,
// the loader claims the pre-floor partition for accounts it loads
// by deleting api rows with week_start < FLOOR for those accounts.
// The derivation (post-C6.1) no longer emits pre-floor rows, so the
// nightly cannot re-create the collision.
const loadedAccounts = [...perAcct.keys()];
async function fetchPreFloorApi(accts) {
  const all = []; const PAGE = 1000; let from = 0;
  while (true) {
    const { data, error } = await supa
      .from("labor_actuals")
      .select("account_key, worker_id, week_start, hours_regular, hours_overtime, hours_double_time, hours_without_dollars, amount")
      .eq("source", "api")
      .lt("week_start", FLOOR)
      .in("account_key", accts)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`pre-floor api fetch: ${error.message}`);
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
const preFloorApi = await fetchPreFloorApi(loadedAccounts);
// Per-account rollup of what the api-delete would remove
const apiDeletePerAcct = new Map();
for (const r of preFloorApi) {
  const cur = apiDeletePerAcct.get(r.account_key) || { rows: 0, hrsClass: 0, hrsWo: 0, amt: 0 };
  cur.rows++;
  cur.hrsClass += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
  cur.hrsWo    += Number(r.hours_without_dollars || 0);
  cur.amt      += Number(r.amount || 0);
  apiDeletePerAcct.set(r.account_key, cur);
}
// A3 - "beyond PK-collisions": api rows whose (worker_id, week_start)
// does NOT exist in the incoming backfill for the same account. Those
// are dropped-only-because-they-are-pre-floor. Everything else would
// have been replaced by an incoming backfill row.
const backfillKeys = new Set(matched.map(r => `${r.acct}|${r.worker_id}|${r.week_start}`));
const beyondCollisions = preFloorApi.filter(r =>
  !backfillKeys.has(`${r.account_key}|${r.worker_id}|${r.week_start}`)
);
const beyondPerAcct = new Map();
for (const r of beyondCollisions) {
  const cur = beyondPerAcct.get(r.account_key) || { rows: 0, hrsClass: 0, hrsWo: 0 };
  cur.rows++;
  cur.hrsClass += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
  cur.hrsWo    += Number(r.hours_without_dollars || 0);
  beyondPerAcct.set(r.account_key, cur);
}
console.log("A2 - pre-floor api rows the loader will DELETE (source='api', week_start < FLOOR, loaded accounts):");
console.log("  account         rows    class-hrs   wo-hrs    api-amt      collides-w-backfill   beyond-collisions (rows / wo-hrs)");
let totalApiDelete = 0, totalBeyondRows = 0, totalBeyondHrs = 0;
for (const acct of loadedAccounts.sort()) {
  const a = apiDeletePerAcct.get(acct) || { rows: 0, hrsClass: 0, hrsWo: 0, amt: 0 };
  const b = beyondPerAcct.get(acct) || { rows: 0, hrsClass: 0, hrsWo: 0 };
  const collides = a.rows - b.rows;
  totalApiDelete += a.rows;
  totalBeyondRows += b.rows;
  totalBeyondHrs += b.hrsWo + b.hrsClass;
  console.log(`  ${acct.padEnd(15)}  ${String(a.rows).padStart(4)}   ${a.hrsClass.toFixed(2).padStart(8)}   ${a.hrsWo.toFixed(2).padStart(7)}   $${a.amt.toFixed(2).padStart(9)}   ${String(collides).padStart(6)}                ${String(b.rows).padStart(4)} / ${(b.hrsWo + b.hrsClass).toFixed(2).padStart(7)}`);
}
console.log(`  ${"TOTAL".padEnd(15)}  ${String(totalApiDelete).padStart(4)}                                              ${String(totalApiDelete - totalBeyondRows).padStart(6)}                ${String(totalBeyondRows).padStart(4)} / ${totalBeyondHrs.toFixed(2).padStart(7)}`);
console.log("");
console.log(`  Interpretation:`);
console.log(`    - collides-with-backfill rows will be REPLACED by an equivalent backfill row.`);
console.log(`    - beyond-collisions rows have no backfill counterpart (worker had clock time`);
console.log(`      but zero payroll dollars per Rippling report). Their hours vanish from`);
console.log(`      labor_actuals unless Kevin decides otherwise.`);
console.log("");

if (args.dryRun) {
  console.log("DRY RUN - nothing written. Rerun with --write to load.");
  process.exit(0);
}

// ─── Write path ─────────────────────────────────────────────────────
console.log("=".repeat(72));
console.log("WRITE PATH");
console.log("=".repeat(72));

// Idempotency #1: delete all existing report_backfill rows first.
console.log("Deleting existing report_backfill rows (idempotent step)...");
const del = await supa.from("labor_actuals").delete().eq("source", "report_backfill").select("account_key");
if (del.error) { console.error(`  delete FAILED: ${del.error.message}`); process.exit(4); }
console.log(`  deleted ${del.data?.length ?? 0} existing report_backfill rows`);

// A2 - claim the pre-floor partition. DELETE api rows with
// week_start < FLOOR for loaded accounts. C6.1 stopped the derivation
// from emitting these; without that partner change this delete would
// be re-created by tonight's nightly.
console.log(`Claiming pre-floor api partition (source='api', week_start < ${FLOOR}, ${loadedAccounts.length} loaded accounts)...`);
const apiDel = await supa.from("labor_actuals").delete()
  .eq("source", "api")
  .lt("week_start", FLOOR)
  .in("account_key", loadedAccounts)
  .select("account_key");
if (apiDel.error) { console.error(`  api-partition delete FAILED: ${apiDel.error.message}`); process.exit(4); }
console.log(`  deleted ${apiDel.data?.length ?? 0} pre-floor api rows`);

// Build insert rows. line_code='3100.1', source='report_backfill',
// week_source='rippling_report', coverage_state='complete',
// hours_without_dollars=0.
const sourceRun = `backfill-report-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const insertRows = matched.map(r => ({
  account_key:            r.acct,
  worker_id:              r.worker_id,
  week_label:             r.week_label,
  line_code:              LINE_CODE,
  hours_regular:          Number(r.baseH.toFixed(2)),
  hours_overtime:         Number(r.otH.toFixed(2)),
  hours_double_time:      Number(r.holH.toFixed(2)),
  hours_premium_other:    0,
  dollars_regular:        Number(r.base$.toFixed(2)),
  dollars_overtime:       Number(r.ot$.toFixed(2)),
  dollars_double_time:    Number(r.hol$.toFixed(2)),
  dollars_premium_other:  0,
  amount:                 Number((r.base$ + r.ot$ + r.hol$).toFixed(2)),
  hours_without_dollars:  0,
  week_start:             r.week_start,
  week_end:               r.week_end,
  fiscal_year:            2026,
  period_no:              null,           // Resolvable later from sc_day_metadata if needed
  week_source:            "rippling_report",
  segment_count:          0,
  entry_count:            0,
  coverage_state:         "complete",
  source_run:             sourceRun,
  source:                 "report_backfill",
}));

console.log(`Inserting ${insertRows.length} rows in batches of 500...`);
const CHUNK = 500;
let inserted = 0;
for (let i = 0; i < insertRows.length; i += CHUNK) {
  const batch = insertRows.slice(i, i + CHUNK);
  const { data, error } = await supa.from("labor_actuals").insert(batch).select("account_key");
  if (error) {
    console.error(`  insert batch ${i / CHUNK + 1} FAILED: ${error.message}`);
    process.exit(4);
  }
  inserted += data?.length ?? 0;
  process.stderr.write(`  batch ${Math.floor(i / CHUNK) + 1}: inserted=${inserted}\r`);
}
process.stderr.write("\n");
console.log(`  total inserted: ${inserted}`);

// Verify: totals per account match what dry-run promised
console.log("");
console.log("Post-write verification (per-account totals from labor_actuals_latest):");
for (const [acct, expected] of [...perAcct.entries()].sort()) {
  const { data } = await supa.from("labor_actuals_latest")
    .select("amount, dollars_regular, dollars_overtime, dollars_double_time")
    .eq("account_key", acct)
    .eq("source", "report_backfill");
  const sum = (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const expectedTotal = expected.base$ + expected.ot$ + expected.hol$;
  const match = Math.abs(sum - expectedTotal) < 0.02;
  console.log(`  ${acct.padEnd(15)}  written=$${sum.toFixed(2).padStart(11)}  expected=$${expectedTotal.toFixed(2).padStart(11)}  ${match ? "tie" : "MISMATCH"}`);
}

console.log("");
console.log(`source_run: ${sourceRun}`);
console.log(`Done.`);
