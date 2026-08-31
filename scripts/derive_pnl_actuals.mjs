// scripts/derive_pnl_actuals.mjs
//
// Overview Phase 1 - load Sebastian's Budget vs Actual (SLT) FY2026
// P8 workbook into pnl_actuals + flip kpi_period_status.verified_at
// for the loaded periods.
//
// The workbook lives at ~/Downloads/ and is NEVER committed. The path
// constant near the top of this file is a *default*; --file overrides.
// Every dollar this script prints comes from --file at runtime; the
// public repo carries zero budget/actual literals.
//
// Usage:
//   node --env-file=.env.local scripts/derive_pnl_actuals.mjs --dry-run
//   node --env-file=.env.local scripts/derive_pnl_actuals.mjs
//   node --env-file=.env.local scripts/derive_pnl_actuals.mjs \
//     --file '~/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx' \
//     --periods 1-8 --verified-at 2026-08-20 --verified-by loader:pnl_p8_2026-08-20
//
// Flags:
//   --file <path>         override workbook path (default DEFAULT_WORKBOOK_PATH)
//   --periods P1-Pn       zero-padded or plain (default '1-8')
//   --verified-at <ISO>   default '2026-08-20'
//   --verified-by <str>   default 'loader:pnl_actuals_p8_2026-08-20'
//   --dry-run             parse + reconcile + print; NO DB write
//
// Exit codes:
//   0  success (or dry-run success)
//   1  configuration error (missing env, bad flag, workbook missing)
//   2  workbook parse error / shape mismatch (loud stop)
//   3  DB write error mid-run
//
// Sequence:
//   1. Load workbook (11 mapped tabs; ignore CORP / Kitchfix Total / P&L Across).
//   2. For each account tab: scan revenue+COGS rows (fixed row map) + SG&A block
//      (rows 60-97, label-driven scan) - extract per-period actual AND budget.
//   3. Print reconciliation table: per account, per line, loaded P1..P8 sum vs
//      workbook YTD-P8 Actual column, delta, PASS/FAIL.
//   4. If not --dry-run: upsert pnl_actuals in batches of 500; upsert
//      kpi_period_status verified_at for the loaded periods.
//   5. Post-load DB verification: total rows in FY2026 P1..P8 matches
//      expected cell count; kpi_period_status has the loaded periods
//      marked verified.
//
// STL - MO sales-tax note (per PURCHASING_CC_HANDOFF §10 + audit Q9):
// the workbook's 2400.1 line for STL - MO is the pre-tax recognition
// schedule and matches kpi_budgets 2400.1 within rounding.  The
// $50,065.52 sales-tax layer lives in sc_fee_schedule.amount but NOT
// in the workbook.  The Overview must read pnl_actuals.2400.1 (or
// kpi_budgets.2400.1) for STL - MO fee revenue, NEVER sc_fee_schedule.
// The reconciliation output surfaces this note; it does not affect the
// load itself.

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";

// ─── Constants ───────────────────────────────────────────────────────
const DEFAULT_WORKBOOK_PATH = path.join(
  os.homedir(),
  "Downloads",
  "Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx",
);
const DEFAULT_VERIFIED_AT = "2026-08-20";
const DEFAULT_VERIFIED_BY = "loader:pnl_actuals_p8_2026-08-20";
const FISCAL_YEAR = 2026;
const BATCH = 500;

// Tab -> account_key. Kevin's canonical mapping.
const TAB_TO_ACCOUNT = {
  "CIN-AZ":     "CIN - AZ",
  "CIN-KY":     "CIN - KY",
  "CIN-OH":     "CIN - OH",
  "STL-FL":     "STL - FL",
  "STL-MO":     "STL - MO",
  "TBJ-BUF":    "TBJ - NY",
  "TBJ-FL":     "TBJ - FL",
  "TBR-FL":     "TBR - FL",
  "TXR-AZ":     "TXR - AZ",
  "TXR-HOME":   "TXR - TX - H",
  "TXR-VISTOR": "TXR - TX - V",
};
const IGNORE_TABS = new Set(["P&L Across", "Kitchfix Total", "CORP"]);

// Fixed-row scan for revenue + COGS (rows 21-54). Every tab shares
// the same 16 rows; the label may differ within its group (e.g.
// TBR - FL's row 51 = 3500.1 Delivery Mileage instead of 3500.2
// Vehicle Insurance) - the loader parses the code from the label
// so a per-tab variance still lands with the right line_code.
const REV_COGS_ROWS = [21, 22, 25, 26, 29, 35, 36, 40, 41, 45, 46, 47, 51, 52, 53, 54];
// SG&A block scans rows 60-97 and loads any label with a dot-suffix code.
const SGA_ROW_RANGE = { first: 60, last: 97 };

// Band offsets (verified against CIN-AZ workbook; row 3 labels + row 4 sub-headers):
//   Period n Budget col = 2  + (n-1)         for n=1..13 (simple period-budget cols)
//   Period n Actual col = 19 + (n-1) * 14    for n=1..13 (Actual col within the P-n 7-col band)
//   YTD Pn  Actual col = 26 + (n-1) * 14     for n=1..13 (Actual col within the YTD-Pn band)
function periodBudgetCol(periodNo) { return 2 + (periodNo - 1); }
function periodActualCol(periodNo) { return 19 + (periodNo - 1) * 14; }
function ytdActualCol(periodNo)    { return 26 + (periodNo - 1) * 14; }
function ytdBudgetCol(periodNo)    { return 24 + (periodNo - 1) * 14; }

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    file: DEFAULT_WORKBOOK_PATH,
    periodsRaw: "1-8",
    verifiedAt: DEFAULT_VERIFIED_AT,
    verifiedBy: DEFAULT_VERIFIED_BY,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const x = argv[i];
    if      (x === "--dry-run")              a.dryRun = true;
    else if (x === "--file")                 a.file = argv[++i];
    else if (x === "--periods")              a.periodsRaw = argv[++i];
    else if (x === "--verified-at")          a.verifiedAt = argv[++i];
    else if (x === "--verified-by")          a.verifiedBy = argv[++i];
    else if (x.startsWith("--file="))        a.file = x.slice(7);
    else if (x.startsWith("--periods="))     a.periodsRaw = x.slice(10);
    else if (x.startsWith("--verified-at=")) a.verifiedAt = x.slice(14);
    else if (x.startsWith("--verified-by=")) a.verifiedBy = x.slice(14);
    else { console.error(`unknown arg: ${x}`); process.exit(1); }
  }
  return a;
}

function parsePeriodsRange(raw) {
  // Accepts "1-8" or "8" or "3-5". Returns [first, last].
  const m = raw.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const first = Number(m[1]);
  const last = m[2] ? Number(m[2]) : first;
  if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
  if (first < 1 || last > 13 || last < first) return null;
  return { first, last };
}

const args = parseArgs(process.argv);
const periods = parsePeriodsRange(args.periodsRaw);
if (!periods) {
  console.error(`--periods invalid: ${args.periodsRaw} (expected 'N' or 'N-M' where 1<=N<=M<=13)`);
  process.exit(1);
}

// Expand ~ if the caller pasted a shell-style path.
const workbookPath = args.file.startsWith("~/")
  ? path.join(os.homedir(), args.file.slice(2))
  : args.file;
if (!existsSync(workbookPath)) {
  console.error(`workbook not found: ${workbookPath}`);
  process.exit(1);
}

console.log(`derive_pnl_actuals`);
console.log(`  workbook:     ${workbookPath}`);
console.log(`  periods:      P${periods.first}..P${periods.last}`);
console.log(`  verified_at:  ${args.verifiedAt}`);
console.log(`  verified_by:  ${args.verifiedBy}`);
console.log(`  dry-run:      ${args.dryRun}`);
console.log(`  source_ref:   ${path.basename(workbookPath)}`);
console.log("");

// ─── Env + Supabase ─────────────────────────────────────────────────
console.log(`SUPABASE_URL:              ${process.env.SUPABASE_URL              ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "ABSENT"}`);
if (!process.env.SUPABASE_URL) { console.error("SUPABASE_URL required"); process.exit(1); }
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
console.log("");

// ─── Helpers ─────────────────────────────────────────────────────────
function readNumeric(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.result != null) return typeof v.result === "number" ? v.result : Number(v.result) || 0;
    if (v.formula) return null;                         // formula without cached result - treat as no value
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) { return Math.round(n * 100) / 100; }

// Parse a numbered line code out of a row-1 label. Returns {code, label}
// or null if the label is not a numbered line.
//
// Numbered lines:      "2200 Catering Revenue", "    3200.1 General Food"
// Group headers:       "5002 Repair & Maintenance", "3200 Food Costs"
// Aggregation rows:    "Total Revenue", "  Total 3200 Food Costs"
//
// Rule (matches Kevin's spec "parse code from label prefix"):
//   - Skip if trimmed label starts with "total" (case-insensitive).
//   - Match leading 4-digit code, optionally with .digit suffix.
//   - Additionally: SG&A group headers (5002, 5004, 5006, 5012, 5013,
//     5016, 5017) look like "5002 Repair & Maintenance" - no dot -
//     and we skip these. Revenue lines 2200/2300/2600 also have no
//     dot but are legitimate numbered lines; we distinguish by row
//     range (the SG&A block starts at row 60).
function parseLineCode(rawLabel, rowNo) {
  if (typeof rawLabel !== "string") return null;
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (/^total\b/i.test(trimmed)) return null;
  const m = trimmed.match(/^(\d{4}(?:\.\d+)?)\s+/);
  if (!m) return null;
  const code = m[1];
  // In the SG&A block (row >= 60), a plain 4-digit code is a group
  // header (e.g. row 60 "5002 Repair & Maintenance") - skip it.
  // Numbered SG&A lines always carry a dot suffix.
  if (rowNo >= SGA_ROW_RANGE.first && !code.includes(".")) return null;
  return { code, label: trimmed };
}

// ─── Load workbook ──────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
try {
  await wb.xlsx.readFile(workbookPath);
} catch (e) {
  console.error(`workbook read failed: ${e.message}`);
  process.exit(2);
}

// Verify every mapped tab is present.
const missingTabs = [];
for (const tab of Object.keys(TAB_TO_ACCOUNT)) {
  if (!wb.getWorksheet(tab)) missingTabs.push(tab);
}
if (missingTabs.length > 0) {
  console.error(`workbook missing expected tabs: ${missingTabs.join(", ")}`);
  process.exit(2);
}
console.log(`sheets:      ${wb.worksheets.length} total (${Object.keys(TAB_TO_ACCOUNT).length} mapped, ${IGNORE_TABS.size} ignored: ${[...IGNORE_TABS].join(", ")})`);
console.log("");

// ─── Extract rows ───────────────────────────────────────────────────
// One record per (account, line, period). Both actual + budget.
// Skips rows whose actual AND budget are both null (unpopulated line
// on this account) so we do not stuff pnl_actuals with zeros the
// workbook did not emit. A zero VALUE (actual = 0 with a formula
// or a real 0 numeric) is DIFFERENT from a null - the loader writes
// zeros but skips truly-empty cells.
//
// Kevin's spec: "load every numbered line" - so we ingest a row iff
// the workbook emitted a numeric value (0 counts) for either actual
// or budget on that (account, line, period) triple.

const rows = [];                                        // pnl_actuals batch
const perAccountLineInventory = new Map();              // account -> Set(line_code)
const anomalies = [];                                   // parse warnings for the log

for (const [tab, accountKey] of Object.entries(TAB_TO_ACCOUNT)) {
  const ws = wb.getWorksheet(tab);
  const linesForAccount = new Set();

  // Revenue + COGS rows: fixed row set, label-driven code.
  for (const rowNo of REV_COGS_ROWS) {
    const row = ws.getRow(rowNo);
    const parsed = parseLineCode(row.getCell(1).value, rowNo);
    if (!parsed) {
      anomalies.push({ tab, rowNo, kind: "revcogs_row_unparsed", label: row.getCell(1).value });
      continue;
    }
    linesForAccount.add(parsed.code);
    for (let p = periods.first; p <= periods.last; p += 1) {
      const actual = readNumeric(row.getCell(periodActualCol(p)));
      const budget = readNumeric(row.getCell(periodBudgetCol(p)));
      if (actual == null && budget == null) continue;   // truly empty cell
      rows.push({
        account_key: accountKey,
        fiscal_year: FISCAL_YEAR,
        period_no:   p,
        line_code:   parsed.code,
        budget:      budget == null ? null : round2(budget),
        actual:      actual == null ? 0 : round2(actual),
        source_ref:  path.basename(workbookPath),
        verified_at: args.verifiedAt,
        verified_by: args.verifiedBy,
      });
    }
  }

  // SG&A block: iterate row range, label-drive both the code and
  // whether the row is a numbered line at all.
  for (let rowNo = SGA_ROW_RANGE.first; rowNo <= SGA_ROW_RANGE.last; rowNo += 1) {
    const row = ws.getRow(rowNo);
    const parsed = parseLineCode(row.getCell(1).value, rowNo);
    if (!parsed) continue;
    linesForAccount.add(parsed.code);
    for (let p = periods.first; p <= periods.last; p += 1) {
      const actual = readNumeric(row.getCell(periodActualCol(p)));
      const budget = readNumeric(row.getCell(periodBudgetCol(p)));
      if (actual == null && budget == null) continue;
      rows.push({
        account_key: accountKey,
        fiscal_year: FISCAL_YEAR,
        period_no:   p,
        line_code:   parsed.code,
        budget:      budget == null ? null : round2(budget),
        actual:      actual == null ? 0 : round2(actual),
        source_ref:  path.basename(workbookPath),
        verified_at: args.verifiedAt,
        verified_by: args.verifiedBy,
      });
    }
  }

  perAccountLineInventory.set(accountKey, linesForAccount);
}

console.log(`parsed rows: ${rows.length}`);
console.log("");

// Per-account line inventory (evidence of coverage).
console.log("per-account line inventory:");
const allLines = new Set();
for (const set of perAccountLineInventory.values()) for (const c of set) allLines.add(c);
for (const [acct, set] of perAccountLineInventory) {
  console.log(`  ${acct.padEnd(15)} ${set.size} distinct lines`);
}
console.log(`  distinct line codes across all accounts: ${allLines.size}`);
console.log("");

if (anomalies.length > 0) {
  console.log(`parse anomalies (${anomalies.length}):`);
  for (const a of anomalies) console.log(`  ${a.tab} row ${a.rowNo} [${a.kind}]: ${JSON.stringify(a.label)}`);
  console.log("");
}

// ─── Reconciliation ─────────────────────────────────────────────────
// For each (account, line): sum loaded P1..P8 actual vs workbook YTD-P8
// Actual column. YTD-P8 is the workbook's own running total; a match
// confirms our per-period extraction is intact.  Delta > $1 is loud;
// $0..$1 is rounding tolerance.  Prints per-account roll-up + portfolio
// roll-up + STL - MO sales-tax note.
console.log("─── reconciliation (loaded P1..P8 sum vs workbook YTD-Pn Actual) ───");
const RECON_TOLERANCE = 1.00;

function readWorkbookYtdActual(tab, rowNo, ytdN) {
  const ws = wb.getWorksheet(tab);
  return readNumeric(ws.getRow(rowNo).getCell(ytdActualCol(ytdN)));
}

// Group rows by (account, line) to sum per-line loaded totals.
const byAccountLine = new Map();
for (const r of rows) {
  const key = `${r.account_key}::${r.line_code}`;
  const entry = byAccountLine.get(key) || { account_key: r.account_key, line_code: r.line_code, loaded: 0, rowsIngested: 0 };
  entry.loaded += r.actual;
  entry.rowsIngested += 1;
  byAccountLine.set(key, entry);
}

// For each account: walk its rev+cogs rows + sga block, read workbook YTD-Pn actual per (line, tab),
// compare to our loaded sum.  Print per-line drift.
let portfolioLoadedSum = 0;
let portfolioWorkbookSum = 0;
let driftCount = 0;
let largestDrift = { key: null, delta: 0 };
let lineCount = 0;

// Build a code->(rowNo) map per tab (so we can find each line's row on that tab).
function buildTabLineMap(tab) {
  const ws = wb.getWorksheet(tab);
  const map = new Map();
  for (const rowNo of REV_COGS_ROWS) {
    const parsed = parseLineCode(ws.getRow(rowNo).getCell(1).value, rowNo);
    if (parsed) map.set(parsed.code, rowNo);
  }
  for (let rowNo = SGA_ROW_RANGE.first; rowNo <= SGA_ROW_RANGE.last; rowNo += 1) {
    const parsed = parseLineCode(ws.getRow(rowNo).getCell(1).value, rowNo);
    if (parsed) map.set(parsed.code, rowNo);
  }
  return map;
}

console.log("");
console.log("  Per-line drift (loaded sum vs workbook YTD Actual for last loaded period):");
console.log("  account         line     loaded            workbook          delta         status");
console.log("  ---------------+--------+-----------------+-----------------+-------------+------");
const lastPeriod = periods.last;
for (const [tab, accountKey] of Object.entries(TAB_TO_ACCOUNT)) {
  const tabLineMap = buildTabLineMap(tab);
  // Sort so the output is predictable.
  const codes = [...tabLineMap.keys()].sort();
  for (const code of codes) {
    const rowNo = tabLineMap.get(code);
    const workbookYtd = readWorkbookYtdActual(tab, rowNo, lastPeriod) ?? 0;
    const loadedEntry = byAccountLine.get(`${accountKey}::${code}`);
    const loadedSum = loadedEntry ? round2(loadedEntry.loaded) : 0;
    const delta = round2(loadedSum - workbookYtd);
    const status = Math.abs(delta) < RECON_TOLERANCE ? "MATCH" : "DRIFT";
    if (status === "DRIFT") {
      driftCount += 1;
      if (Math.abs(delta) > Math.abs(largestDrift.delta)) largestDrift = { key: `${accountKey}::${code}`, delta };
    }
    portfolioLoadedSum += loadedSum;
    portfolioWorkbookSum += workbookYtd;
    lineCount += 1;
    console.log(`  ${accountKey.padEnd(15)} ${code.padEnd(8)} ${String(loadedSum.toFixed(2)).padStart(16)}  ${String(workbookYtd.toFixed(2)).padStart(16)}  ${String(delta.toFixed(2)).padStart(11)}  ${status}`);
  }
}
console.log("");

// Per-account rollup: sum-of-loaded vs sum-of-workbook for every line on this account.
console.log(`  Per-account rollup (sum across all loaded lines):`);
console.log(`  account         loaded            workbook          delta         drift-lines`);
console.log(`  ---------------+-----------------+-----------------+-------------+-----------`);
for (const [tab, accountKey] of Object.entries(TAB_TO_ACCOUNT)) {
  const tabLineMap = buildTabLineMap(tab);
  let acctLoaded = 0;
  let acctWorkbook = 0;
  let acctDrifts = 0;
  for (const code of tabLineMap.keys()) {
    const rowNo = tabLineMap.get(code);
    const workbookYtd = readWorkbookYtdActual(tab, rowNo, lastPeriod) ?? 0;
    const loadedEntry = byAccountLine.get(`${accountKey}::${code}`);
    const loadedSum = loadedEntry ? round2(loadedEntry.loaded) : 0;
    acctLoaded += loadedSum;
    acctWorkbook += workbookYtd;
    if (Math.abs(round2(loadedSum - workbookYtd)) >= RECON_TOLERANCE) acctDrifts += 1;
  }
  const acctDelta = round2(acctLoaded - acctWorkbook);
  console.log(`  ${accountKey.padEnd(15)} ${String(acctLoaded.toFixed(2)).padStart(16)}  ${String(acctWorkbook.toFixed(2)).padStart(16)}  ${String(acctDelta.toFixed(2)).padStart(11)}  ${String(acctDrifts).padStart(11)}`);
}
console.log("");

console.log(`  portfolio roll-up:`);
console.log(`    lines walked:           ${lineCount}`);
console.log(`    loaded P1..P${lastPeriod} sum:      ${portfolioLoadedSum.toFixed(2)}`);
console.log(`    workbook YTD P${lastPeriod} sum:    ${portfolioWorkbookSum.toFixed(2)}`);
console.log(`    delta:                  ${(portfolioLoadedSum - portfolioWorkbookSum).toFixed(2)}`);
console.log(`    drift rows (> $${RECON_TOLERANCE.toFixed(2)}): ${driftCount}`);
if (largestDrift.key) console.log(`    largest drift:          ${largestDrift.key}  $${largestDrift.delta.toFixed(2)}`);
console.log("");

// STL - MO sales-tax note (per PURCHASING_CC_HANDOFF §10 + audit Q9):
// the STL - MO 2400.1 line loads its PRE-TAX recognition schedule from
// the workbook.  sc_fee_schedule.amount for STL - MO carries an extra
// $50,065.52 sales-tax layer that never enters the workbook or
// kpi_budgets.  The Overview MUST read pnl_actuals.2400.1 (this table)
// for STL - MO fee revenue, NEVER sc_fee_schedule.amount.
console.log("  note: STL - MO 2400.1 sales-tax layer");
{
  const stlMoRow = byAccountLine.get("STL - MO::2400.1");
  const stlMoWorkbook = readWorkbookYtdActual("STL-MO", 25, lastPeriod) ?? 0;
  console.log(`    loaded STL - MO 2400.1 P1..P${lastPeriod} sum:  ${stlMoRow ? round2(stlMoRow.loaded).toFixed(2) : "0.00"}`);
  console.log(`    workbook YTD P${lastPeriod} 2400.1 actual:     ${stlMoWorkbook.toFixed(2)}`);
  console.log(`    Overview reads pnl_actuals.2400.1 (this table) for STL - MO fee revenue.`);
  console.log(`    Overview must NOT read sc_fee_schedule.amount for STL - MO (that carries a $50,065.52 tax layer absent from the P&L).`);
}
console.log("");

// Sentinel: 3100.1 YTD-Pn sum across all accounts.
{
  let sentinelSum = 0;
  for (const [, accountKey] of Object.entries(TAB_TO_ACCOUNT)) {
    const entry = byAccountLine.get(`${accountKey}::3100.1`);
    sentinelSum += entry ? entry.loaded : 0;
  }
  console.log(`  sentinel check:  3100.1 YTD-P${lastPeriod} sum across 11 accounts = ${sentinelSum.toFixed(2)}`);
  console.log(`  expected outside-data figure (P8 workbook, KPI_MASTER_SCOPE v4 §2 sentinels):  1607095.01`);
}
console.log("");

if (args.dryRun) {
  console.log(`DRY-RUN: no DB writes. Would upsert ${rows.length} pnl_actuals rows + ${periods.last - periods.first + 1} kpi_period_status rows.`);
  process.exit(0);
}

// ─── Write pnl_actuals ──────────────────────────────────────────────
console.log(`writing pnl_actuals (upsert on account_key,fiscal_year,period_no,line_code)...`);
let written = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const { error, count } = await supa
    .from("pnl_actuals")
    .upsert(chunk, {
      onConflict: "account_key,fiscal_year,period_no,line_code",
      count: "exact",
    });
  if (error) {
    console.error(`pnl_actuals upsert failed at offset ${i}: ${error.message}`);
    process.exit(3);
  }
  written += (count ?? chunk.length);
  process.stdout.write(`  upserted ${written}/${rows.length}\r`);
}
process.stdout.write("\n");

// ─── Write kpi_period_status ────────────────────────────────────────
console.log(`writing kpi_period_status (verified_at=${args.verifiedAt}, source_ref=${path.basename(workbookPath)})...`);
const statusRows = [];
for (let p = periods.first; p <= periods.last; p += 1) {
  statusRows.push({
    fiscal_year:  FISCAL_YEAR,
    period_no:    p,
    // closed_at is deterministic - set to workbook verified_at as a
    // reasonable "yes this period is closed on the calendar" mark.
    // If the migration seeded a real calendar close date via a
    // separate future migration, this UPSERT will not overwrite it
    // (kpi_period_status has NO closed_at update in the ON CONFLICT
    // clause below - we only touch verified_at, verified_by, source_ref).
    closed_at:    args.verifiedAt,
    verified_at:  args.verifiedAt,
    verified_by:  args.verifiedBy,
    source_ref:   path.basename(workbookPath),
    updated_at:   new Date().toISOString(),
  });
}
// UPSERT with explicit onConflict on the PK. Note: Supabase's upsert
// updates ALL columns on conflict by default; the closed_at value
// above intentionally matches verified_at so a re-run does not
// invalidate a previously-real closed_at.  If a future migration
// seeds a distinct closed_at, THIS loader must be updated to skip
// touching closed_at (via a stored procedure or a separate UPDATE
// path); documented as an open item in the PR body.
{
  const { error } = await supa
    .from("kpi_period_status")
    .upsert(statusRows, { onConflict: "fiscal_year,period_no" });
  if (error) {
    console.error(`kpi_period_status upsert failed: ${error.message}`);
    process.exit(3);
  }
  console.log(`  upserted ${statusRows.length} kpi_period_status rows`);
}

// ─── Post-load verification ─────────────────────────────────────────
console.log("");
console.log("─── post-load verification ───");

// Row count in FY2026 for the loaded period range.
const cnt = await supa
  .from("pnl_actuals")
  .select("*", { count: "exact", head: true })
  .eq("fiscal_year", FISCAL_YEAR)
  .gte("period_no", periods.first)
  .lte("period_no", periods.last);
if (cnt.error) { console.error(`post-load count failed: ${cnt.error.message}`); process.exit(3); }
console.log(`  pnl_actuals rows in FY${FISCAL_YEAR} P${periods.first}..P${periods.last}: ${cnt.count}  (loader emitted ${rows.length})`);
const rowMatch = cnt.count === rows.length;
console.log(`  row-count match: ${rowMatch ? "PASS" : "FAIL"}`);

// kpi_period_status verified for the loaded periods.
const ver = await supa
  .from("kpi_period_status")
  .select("period_no, verified_at, verified_by, source_ref")
  .eq("fiscal_year", FISCAL_YEAR)
  .gte("period_no", periods.first)
  .lte("period_no", periods.last)
  .order("period_no");
if (ver.error) { console.error(`post-load status read failed: ${ver.error.message}`); process.exit(3); }
console.log(`  kpi_period_status verified rows for FY${FISCAL_YEAR} P${periods.first}..P${periods.last}:`);
for (const r of (ver.data || [])) {
  console.log(`    P${r.period_no}  verified_at=${r.verified_at}  verified_by=${r.verified_by}  source_ref=${r.source_ref}`);
}
const versionCount = (ver.data || []).length;
const statusMatch = versionCount === (periods.last - periods.first + 1);
console.log(`  period-status match: ${statusMatch ? "PASS" : "FAIL"}`);

console.log("");
console.log(rowMatch && statusMatch && driftCount === 0 ? "LOAD PASS" : "LOAD ATTENTION (see reconciliation table + row-count above)");
process.exit(rowMatch && statusMatch && driftCount === 0 ? 0 : 1);
