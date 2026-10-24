// scripts/load_pnl_history.mjs
//
// FIN-2027 W1 Stage 2 · historical P&L workbook loader for FY2024 +
// FY2025 (and any future closed year with the same shape). Sibling
// to scripts/derive_pnl_actuals.mjs (which owns the LIVE FY2026
// load path); shares scripts/lib/pnl_load_core.mjs for helpers +
// upsert + kpi_period_status update + post-load verify.
//
// KEY DIFFERENCES from the FY2026 loader (why this is a sibling,
// not a parameterised call):
//
//   1. TAB RESOLUTION by row-1 title, not tab name.  FY2024 uses
//      'PFS - REDS' / 'PFS - CINN' for Goodyear AZ / Cincinnati OH;
//      FY2025 uses 'REDS (PFS)' / 'CINN (PFS)'; the collision (F-6)
//      is silent if the loader keys on tab name alone.  We match the
//      row-1 title's 'team + state' signature so REDS = CIN - AZ
//      unambiguously.
//
//   2. LABEL-DRIVEN LEAF SCAN, not fixed row map.  FY2024 PFS - CINN
//      is missing the 3100.2 line and every row from 36 down shifts
//      up one (W0 finding F-10).  A label-driven scan (parse code
//      from column A per row; reject group headers + 'Total ...'
//      rows) handles the shift naturally.
//
//   3. SUM-CHECK LAW, per account per LINE, TWO anchors:
//        loaded_actual_sum(P1..P13) vs workbook col 194 (YTD-P13 Actual)
//        loaded_budget_sum(P1..P13) vs workbook col 15  (Year Total)
//      Kevin ruling 2026-09-17 (correction to §5.3 for historical
//      years only): closed books are copied, not audited. The check
//      still RUNS and still REPORTS - the consequence changes from
//      FAIL-and-hold to RECORD-AND-PROCEED. All 287 (or 352) lines
//      load per-period as-is; drifting (account_key, line_code)
//      tuples are recorded in pnl_reconciliation_exceptions
//      (append-only, pnl-4). FY2026 period loads still keep the hard
//      gate in scripts/derive_pnl_actuals.mjs. The 2024-09-17
//      diagnostic showed several FY2024 YTD-P13 cells carry
//      hand-typed reconciliation adjustments (`= FX71 + GE71 +
//      27020`); those exceptions are logged for query-ability.
//
//   4. FISCAL_YEAR is a REQUIRED CLI FLAG.  No default.
//
// Usage:
//   node --env-file=.env.local scripts/load_pnl_history.mjs \
//     --file '<workbook>' --fiscal-year 2024 --periods 1-13 --dry-run \
//     --verified-at 2026-09-17 --verified-by 'loader:pnl_history_fy2024_2026-09-17'
//
// Flags:
//   --file <path>         workbook path (required)
//   --fiscal-year <YYYY>  the fiscal year the workbook represents (required)
//   --periods P1-Pn       default '1-13' (closed years load full year)
//   --verified-at <ISO>   default: today
//   --verified-by <str>   default 'loader:pnl_history_fyYYYY_<date>'
//   --dry-run             parse + reconcile + print; NO DB write
//
// Exit codes:
//   0 - success (or dry-run success)
//   1 - configuration error (missing env, bad flag, workbook missing)
//   2 - workbook parse error / shape mismatch (loud stop, includes unknown line codes)
//   3 - DB write error mid-run
//
// R-8: workbooks live outside the repo; this file prints dollar
// amounts to the RECONCILIATION table for operational insight, but
// the repo carries zero dollar literals.  All amounts are read from
// --file at runtime.

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  SGA_ROW_RANGE,
  readNumeric,
  round2,
  parseLineCode,
  loadKpiLinesCatalog,
  upsertPnlActualsInBatches,
  updateKpiPeriodStatusVerified,
  verifyPostLoadRowCount,
  readKpiPeriodStatusVerified,
} from "./lib/pnl_load_core.mjs";

// ─── Constants ───────────────────────────────────────────────────────

const BATCH = 500;
const RECON_TOLERANCE = 1.00;                              // dollar tolerance for per-line and per-account reconciliation

// Row-1 title regex -> account_key.  Row-1 titles vary across years
// (FY2024 'REDS/Cincinnati Reds - Goodyear, AZ'; FY2025 same;
// FY2027 'Cincinnati Reds - Goodyear, AZ' with no prefix).  We match
// on 'team city + state' since city drifts (Engelwood/Englewood/Port
// Charlotte) but team + state is stable.
const PORTFOLIO_TITLE_MAP = [
  { key: "CIN - AZ",     match: /Cincinnati Reds.*Goodyear.*AZ/i },
  { key: "CIN - KY",     match: /Louisville Bats.*Louisville.*KY/i },
  { key: "CIN - OH",     match: /Cincinnati Reds.*Cincinnati.*OH/i },
  { key: "STL - FL",     match: /St\.?\s*Louis Cardinals.*Jupiter.*FL/i },
  { key: "STL - MO",     match: /St\.?\s*Louis Cardinals.*St\.?\s*Louis.*MO/i },
  { key: "TBJ - FL",     match: /Toronto Blue Jays.*Dunedin.*FL/i },
  { key: "TBJ - NY",     match: /Toronto Blue Jays.*Buffalo.*NY/i },
  { key: "TBR - FL",     match: /Tampa Bay Rays.*(Engelwood|Englewood|Port Charlotte).*FL/i },
  { key: "TXR - AZ",     match: /Texas Rangers.*Surprise.*AZ/i },
  { key: "TXR - TX - H", match: /Texas Rangers.*Arlington.*TX/i },
  { key: "TXR - TX - V", match: /Texas Rangers.*Arlington.*TX/i },   // disambiguated via TXR-VISTOR handling below
];

// Row-1 titles that carry 'VISTOR' or 'Visitor' resolve to TXR-TX-V;
// everything else matching Texas Rangers Arlington TX is TXR-TX-H.
function resolveAccountFromRow1Title(title) {
  if (typeof title !== "string" || !title.trim()) return null;
  const t = title.trim();
  // Precedence 1: visitor markers.
  if (/\bVISTOR\b|\bVisitor\b|-\s*V\s*-/i.test(t)) {
    if (/Texas Rangers.*Arlington.*TX/i.test(t)) return "TXR - TX - V";
  }
  // Precedence 2: home markers for TXR (avoid the ambiguity).
  if (/\bHome\b|\bTXR-HOME\b|-\s*H\s*-/i.test(t)) {
    if (/Texas Rangers.*Arlington.*TX/i.test(t)) return "TXR - TX - H";
  }
  // Precedence 3: unadorned Texas Rangers Arlington TX -> Home (FY2024/25 workbook uses 'TXR' as the home tab).
  for (const m of PORTFOLIO_TITLE_MAP) {
    if (m.key === "TXR - TX - V") continue;                 // handled above
    if (m.key === "TXR - TX - H" && !/\bTXR\b/.test(t)) continue;
    if (m.match.test(t)) return m.key;
  }
  return null;
}

// Column offsets (FY2024/FY2025/FY2026 workbook shape, verified by
// scripts/_probe_fin2027_workbook_headers.mjs against 'PFS - REDS'):
//   col 2+(n-1)         = P<n> Budget (plan band, top of the sheet)
//   col 15              = Year Total (budget-band year total)
//   col 19+(n-1)*14     = P<n> Actual (per-period details band)
//   col 26+(n-1)*14     = YTD-P<n> Actual (running YTD band)
//   col 194 = 26+12*14  = YTD-P13 Actual (year-end actual anchor)
function periodBudgetCol(periodNo) { return 2 + (periodNo - 1); }
function periodActualCol(periodNo) { return 19 + (periodNo - 1) * 14; }
function ytdActualCol(periodNo)    { return 26 + (periodNo - 1) * 14; }
const YEAR_TOTAL_BUDGET_COL = 15;
const YEAR_TOTAL_ACTUAL_COL = ytdActualCol(13);            // 194

// ─── CLI ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {
    file: null,
    fiscalYear: null,
    periodsRaw: "1-13",
    verifiedAt: new Date().toISOString().slice(0, 10),
    verifiedBy: null,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const x = argv[i];
    if      (x === "--dry-run")              a.dryRun = true;
    else if (x === "--file")                 a.file = argv[++i];
    else if (x === "--fiscal-year")          a.fiscalYear = Number(argv[++i]);
    else if (x === "--periods")              a.periodsRaw = argv[++i];
    else if (x === "--verified-at")          a.verifiedAt = argv[++i];
    else if (x === "--verified-by")          a.verifiedBy = argv[++i];
    else { console.error(`unknown arg: ${x}`); process.exit(1); }
  }
  if (!a.file) { console.error("--file required"); process.exit(1); }
  if (!a.fiscalYear || !Number.isInteger(a.fiscalYear) || a.fiscalYear < 2020 || a.fiscalYear > 2050) {
    console.error(`--fiscal-year required (integer 2020..2050); got ${a.fiscalYear}`);
    process.exit(1);
  }
  if (a.fiscalYear === 2023) {
    console.error(`--fiscal-year 2023 is PARKED (R-10). This loader will not process FY2023.`);
    process.exit(1);
  }
  if (a.fiscalYear === 2026) {
    console.error(`--fiscal-year 2026 is owned by scripts/derive_pnl_actuals.mjs; use that loader for FY2026.`);
    process.exit(1);
  }
  if (!a.verifiedBy) {
    a.verifiedBy = `loader:pnl_history_fy${a.fiscalYear}_${a.verifiedAt}`;
  }
  return a;
}

function parsePeriodsRange(raw) {
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
  console.error(`--periods invalid: ${args.periodsRaw}`);
  process.exit(1);
}

const workbookPath = args.file.startsWith("~/")
  ? path.join(process.env.HOME || "", args.file.slice(2))
  : args.file;
if (!existsSync(workbookPath)) {
  console.error(`workbook not found: ${workbookPath}`);
  process.exit(1);
}

console.log(`load_pnl_history`);
console.log(`  workbook:     ${workbookPath}`);
console.log(`  fiscal_year:  ${args.fiscalYear}`);
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

// ─── Load workbook ──────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
try {
  await wb.xlsx.readFile(workbookPath);
} catch (e) {
  console.error(`workbook read failed: ${e.message}`);
  process.exit(2);
}

// Resolve each tab to an account (or skip). Log every skipped tab
// with its row-1 title so the coverage picture is complete.
function row1Title(ws) {
  const v = ws.getRow(1).getCell(1).value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join("").trim();
  return String(v).trim();
}

const tabToAccount = new Map();                             // tab_name -> account_key (portfolio)
const skippedTabs = [];                                     // { tab, title, reason }
const foundAccounts = new Set();
for (const ws of wb.worksheets) {
  const title = row1Title(ws);
  const accountKey = resolveAccountFromRow1Title(title);
  if (accountKey && !foundAccounts.has(accountKey)) {
    tabToAccount.set(ws.name, accountKey);
    foundAccounts.add(accountKey);
  } else if (accountKey) {
    skippedTabs.push({ tab: ws.name, title, reason: `duplicate account_key ${accountKey}` });
  } else {
    skippedTabs.push({ tab: ws.name, title, reason: "not a portfolio tab (row-1 title did not match)" });
  }
}

console.log(`tab resolution:`);
console.log(`  ${tabToAccount.size} portfolio tab(s) matched, ${skippedTabs.length} skipped`);
console.log(`  matched:`);
for (const [tab, acct] of tabToAccount) {
  const ws = wb.getWorksheet(tab);
  console.log(`    ${tab.padEnd(18)} -> ${acct.padEnd(14)} · row1='${row1Title(ws).slice(0, 60)}'`);
}
if (skippedTabs.length > 0) {
  console.log(`  skipped (non-portfolio):`);
  for (const s of skippedTabs) {
    console.log(`    ${s.tab.padEnd(18)}   ${s.reason.padEnd(42)} · row1='${s.title.slice(0, 60)}'`);
  }
}
console.log("");

// ─── Load kpi_lines catalog ─────────────────────────────────────────
console.log("loading kpi_lines catalog for FK pre-validation...");
let kpiLinesCatalog;
try {
  kpiLinesCatalog = await loadKpiLinesCatalog(supa);
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 1);
}
console.log(`  kpi_lines catalog: ${kpiLinesCatalog.size} codes`);
console.log("");

// ─── Extract rows (label-driven scan) ───────────────────────────────
// For each portfolio tab: iterate rows 5..100 (well beyond the SG&A
// range last of 97). For every row that parseLineCode accepts, we
// have a leaf line: read per-period budget + actual + also the
// workbook's per-line Year Total (col 15) and YTD-P13 Actual (col
// 194) for the sum-check anchors.
//
// If a parsed code is NOT in kpi_lines catalog, LOUD STOP (exit 2).

const rows = [];                                            // { account_key, fiscal_year, period_no, line_code, budget, actual, source_ref, verified_at, verified_by }
const perAccountLines = new Map();                          // account -> Map(code -> { rowNo, ytdP13Actual, yearTotalBudget, loadedActualSum, loadedBudgetSum })
const skippedRows = [];                                     // { tab, rowNo, label, reason }
const emptyCells = [];                                      // { tab, rowNo, code, period, reason }
const unrecognizedCodes = [];

const SCAN_ROW_FIRST = 5;
const SCAN_ROW_LAST = SGA_ROW_RANGE.last;                   // 97

for (const [tab, accountKey] of tabToAccount) {
  const ws = wb.getWorksheet(tab);
  const codesForAccount = new Map();
  for (let rowNo = SCAN_ROW_FIRST; rowNo <= SCAN_ROW_LAST; rowNo += 1) {
    const row = ws.getRow(rowNo);
    const rawLabel = row.getCell(1).value;
    const parsed = parseLineCode(rawLabel, rowNo);
    if (!parsed) {
      // Only log labels that had SOMETHING (skip fully empty rows to keep the log legible).
      if (typeof rawLabel === "string" && rawLabel.trim().length > 0) {
        skippedRows.push({ tab, rowNo, label: rawLabel.trim(), reason: /^total\b/i.test(rawLabel.trim()) ? "Total aggregator" : "no code prefix / group header" });
      }
      continue;
    }
    if (!kpiLinesCatalog.has(parsed.code)) {
      // Distinguish group headers from unknown leaves. Dotless 4-digit
      // codes NOT in kpi_lines are convention-group headers (2400 Meal
      // Service, 3100 Kitchen Labor Costs, 3200 Food Costs, 3400
      // Packaging & Supplies Costs, 3500 Vehicle Costs, plus the SG&A
      // group headers 5002/5004/5006/5012/5013/5016/5017). The three
      // dotless LEAVES (2200, 2300, 2600) ARE in kpi_lines and land
      // above. A dotted code NOT in kpi_lines is a retired code or a
      // typo - LOUD STOP so Kevin decides (add to kpi_lines or fix
      // the workbook).
      if (!parsed.code.includes(".")) {
        skippedRows.push({ tab, rowNo, label: parsed.label, reason: "REV/COGS group header (dotless code not in kpi_lines)" });
        continue;
      }
      unrecognizedCodes.push({ tab, rowNo, code: parsed.code, label: parsed.label });
      continue;
    }
    // Per-line sum-check anchors from the workbook.
    const workbookYearTotalBudget = readNumeric(row.getCell(YEAR_TOTAL_BUDGET_COL));
    const workbookYearTotalActual = readNumeric(row.getCell(YEAR_TOTAL_ACTUAL_COL));
    let loadedActualSum = 0;
    let loadedBudgetSum = 0;
    for (let p = periods.first; p <= periods.last; p += 1) {
      const actual = readNumeric(row.getCell(periodActualCol(p)));
      const budget = readNumeric(row.getCell(periodBudgetCol(p)));
      if (actual == null && budget == null) {
        emptyCells.push({ tab, rowNo, code: parsed.code, period: p, reason: "workbook cell blank on both actual + budget (contract: NOT REPORTED)" });
        continue;
      }
      if (actual != null) loadedActualSum += actual;
      if (budget != null) loadedBudgetSum += budget;
      rows.push({
        account_key: accountKey,
        fiscal_year: args.fiscalYear,
        period_no:   p,
        line_code:   parsed.code,
        budget:      budget == null ? null : round2(budget),
        actual:      actual == null ? 0 : round2(actual),
        source_ref:  path.basename(workbookPath),
        verified_at: args.verifiedAt,
        verified_by: args.verifiedBy,
      });
    }
    codesForAccount.set(parsed.code, {
      rowNo,
      workbookYearTotalActual: workbookYearTotalActual == null ? 0 : round2(workbookYearTotalActual),
      workbookYearTotalBudget: workbookYearTotalBudget == null ? 0 : round2(workbookYearTotalBudget),
      loadedActualSum: round2(loadedActualSum),
      loadedBudgetSum: round2(loadedBudgetSum),
    });
  }
  perAccountLines.set(accountKey, codesForAccount);
}

// LOUD STOP: any unrecognized code aborts before any DB write.
if (unrecognizedCodes.length > 0) {
  console.error(`\n[LOAD ABORTED] ${unrecognizedCodes.length} workbook row(s) carry a line_code NOT in kpi_lines catalog.`);
  console.error(`Add the code to kpi_lines OR fix the workbook label BEFORE re-running.`);
  for (const u of unrecognizedCodes) {
    console.error(`  tab=${u.tab} row=${u.rowNo} code=${u.code} label="${u.label}"`);
  }
  process.exit(2);
}

console.log(`parsed rows: ${rows.length}`);
console.log("");

// Per-account line inventory (F-10 witness: PFS - CINN leaf count is explicit).
console.log("per-account line inventory:");
for (const [acct, codes] of perAccountLines) {
  console.log(`  ${acct.padEnd(14)} ${codes.size} distinct lines`);
}
const distinctLines = new Set();
for (const codes of perAccountLines.values()) for (const c of codes.keys()) distinctLines.add(c);
console.log(`  distinct line codes across all accounts: ${distinctLines.size}`);
console.log("");

console.log(`skipped rows (had a label, no code parsed): ${skippedRows.length}   empty cells: ${emptyCells.length}   unrecognized codes: 0`);
console.log("");

// ─── Sum-check reconciliation ────────────────────────────────────────
// Per account per line: TWO anchors.
//   Anchor A (actual):  loaded P1..P13 actual sum  vs  workbook YTD-P13 Actual (col 194)
//   Anchor B (budget):  loaded P1..P13 budget sum  vs  workbook Year Total     (col 15)
// Any per-line mismatch beyond RECON_TOLERANCE marks the ACCOUNT as
// FAIL - no rows written for that account, per §5.3 brief.

console.log("─── sum-check reconciliation (per account, per line, two anchors) ───");
console.log("  account         line     A_loaded         A_workbook       A_delta       B_loaded         B_workbook       B_delta       status");
console.log("  ---------------+--------+----------------+----------------+-------------+----------------+----------------+-------------+------");

// Record-and-proceed per Kevin ruling 2026-09-17: historical loads
// copy closed books; drifting lines LOAD as-is per-period AND are
// recorded in pnl_reconciliation_exceptions (pnl-4). No withhold.
// FY2026 keeps its hard gate in scripts/derive_pnl_actuals.mjs.
const exceptionRows = [];                                   // { account_key, fiscal_year, line_code, anchor_a, anchor_b, delta, note }
let totalLines = 0;
let totalDrift = 0;
for (const [acct, codes] of perAccountLines) {
  const codeList = [...codes.keys()].sort();
  for (const code of codeList) {
    const c = codes.get(code);
    const deltaA = round2(c.loadedActualSum - c.workbookYearTotalActual);
    const deltaB = round2(c.loadedBudgetSum - c.workbookYearTotalBudget);
    const failA = Math.abs(deltaA) >= RECON_TOLERANCE;
    const failB = Math.abs(deltaB) >= RECON_TOLERANCE;
    const status = (failA || failB) ? "DRIFT" : "MATCH";
    if (failA) {
      exceptionRows.push({
        account_key: acct,
        fiscal_year: args.fiscalYear,
        line_code:   code,
        anchor_a:    round2(c.loadedActualSum),             // loader's own P1..P13 sum
        anchor_b:    round2(c.workbookYearTotalActual),     // workbook YTD-P13 Actual (col 194)
        delta:       deltaA,
        note:        "actual: workbook YTD-P13 is a manual reconciliation (YTD-P12 + P13 + hand-typed constant); per-period cells are copied/allocated literals. anchor_b holds the workbook's reconciled year total - prefer it over the sum of per-period rows.",
      });
    }
    if (failB) {
      exceptionRows.push({
        account_key: acct,
        fiscal_year: args.fiscalYear,
        line_code:   code,
        anchor_a:    round2(c.loadedBudgetSum),             // loader's own P1..P13 budget sum
        anchor_b:    round2(c.workbookYearTotalBudget),     // workbook Year Total budget (col 15)
        delta:       deltaB,
        note:        "budget: loaded P1..P13 sum vs workbook Year Total budget (col 15)",
      });
    }
    if (status === "DRIFT") totalDrift += 1;
    totalLines += 1;
    console.log(`  ${acct.padEnd(15)} ${code.padEnd(8)} ${String(c.loadedActualSum.toFixed(2)).padStart(15)}  ${String(c.workbookYearTotalActual.toFixed(2)).padStart(15)}  ${String(deltaA.toFixed(2)).padStart(11)}  ${String(c.loadedBudgetSum.toFixed(2)).padStart(15)}  ${String(c.workbookYearTotalBudget.toFixed(2)).padStart(15)}  ${String(deltaB.toFixed(2)).padStart(11)}  ${status}`);
  }
}
console.log("");

const acctsWithDrift = new Set(exceptionRows.map((e) => e.account_key));
console.log(`  reconciliation summary:`);
console.log(`    lines walked:                              ${totalLines}`);
console.log(`    lines with drift (> $${RECON_TOLERANCE.toFixed(2)}):                 ${totalDrift}`);
console.log(`    exception rows to record (per anchor):     ${exceptionRows.length}`);
console.log(`    accounts with at least one drift line:     ${acctsWithDrift.size}`);
console.log(`    accounts fully clean:                      ${perAccountLines.size - acctsWithDrift.size} / ${perAccountLines.size}`);
if (exceptionRows.length > 0) {
  console.log(`    exceptions (account, line_code, anchor):`);
  for (const e of exceptionRows) {
    const anchor = e.note.startsWith("actual") ? "actual" : "budget";
    console.log(`      ${e.account_key.padEnd(14)} ${e.line_code.padEnd(8)} ${anchor}`);
  }
}
console.log("");

// Every parsed row loads. No filtering.
const writableRows = rows;

if (args.dryRun) {
  console.log(`DRY-RUN: no DB writes.`);
  console.log(`  Would UPSERT ${writableRows.length} pnl_actuals rows (all ${totalLines} lines load as-is).`);
  console.log(`  Would INSERT ${exceptionRows.length} pnl_reconciliation_exceptions row(s).`);
  console.log(`  Would UPDATE ${periods.last - periods.first + 1} kpi_period_status rows for FY${args.fiscalYear} P${periods.first}..P${periods.last}.`);
  process.exit(writableRows.length === 0 ? 1 : 0);
}
console.log(`writing ${writableRows.length} pnl_actuals rows (upsert on account_key,fiscal_year,period_no,line_code)...`);

if (writableRows.length === 0) {
  console.error(`[LOAD ABORTED] every account failed reconciliation; no rows to write.`);
  process.exit(1);
}

try {
  await upsertPnlActualsInBatches(supa, writableRows, BATCH, (written, total) => {
    process.stdout.write(`  upserted ${written}/${total}\r`);
  });
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 3);
}
process.stdout.write("\n");

// ─── Write reconciliation exceptions ────────────────────────────────
// Append-only per pnl-4. One INSERT per drifting anchor. Kevin
// ruling 2026-09-17: closed-year drifts are recorded, not held.
if (exceptionRows.length > 0) {
  console.log(`writing pnl_reconciliation_exceptions (${exceptionRows.length} row(s))...`);
  const { error } = await supa
    .from("pnl_reconciliation_exceptions")
    .insert(exceptionRows);
  if (error) {
    console.error(`pnl_reconciliation_exceptions insert failed: ${error.message}`);
    console.error(`(pnl_actuals load already succeeded; exception log did not - re-run the loader after resolving to append the log rows)`);
    process.exit(3);
  }
  console.log(`  inserted ${exceptionRows.length} exception row(s)`);
} else {
  console.log(`pnl_reconciliation_exceptions: 0 rows to record (all lines MATCH).`);
}

// ─── Update kpi_period_status ───────────────────────────────────────
// closed_at NEVER touched.  Loader owns verified_at / verified_by /
// source_ref only.  The migration pnl-3 seeded FY2024 + FY2025 rows;
// this call flips verified_* fields.
console.log(`updating kpi_period_status FY${args.fiscalYear} P${periods.first}..P${periods.last} (verified_at=${args.verifiedAt}, source_ref=${path.basename(workbookPath)})...`);
{
  let updatedCount = 0;
  try {
    const res = await updateKpiPeriodStatusVerified(supa, {
      fiscalYear: args.fiscalYear,
      first:      periods.first,
      last:       periods.last,
      verifiedAt: args.verifiedAt,
      verifiedBy: args.verifiedBy,
      sourceRef:  path.basename(workbookPath),
    });
    updatedCount = res.updatedCount;
  } catch (e) {
    console.error(e.message);
    process.exit(e.exitCode ?? 3);
  }
  console.log(`  updated ${updatedCount} kpi_period_status rows (verified_at + verified_by + source_ref + updated_at)`);
  console.log(`  closed_at NOT TOUCHED (migration owns calendar closes)`);
}

// ─── Post-load verification ─────────────────────────────────────────
console.log("");
console.log("─── post-load verification ───");

let cntCount;
try {
  const res = await verifyPostLoadRowCount(supa, args.fiscalYear, periods.first, periods.last);
  cntCount = res.count;
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 3);
}
console.log(`  pnl_actuals rows in FY${args.fiscalYear} P${periods.first}..P${periods.last}: ${cntCount}  (loader emitted ${writableRows.length} to writable set of ${rows.length} parsed)`);
const rowMatch = cntCount >= writableRows.length;           // >= because upsert is idempotent - re-run should not shrink
console.log(`  row-count match: ${rowMatch ? "PASS" : "FAIL"}`);

let verRows;
try {
  const res = await readKpiPeriodStatusVerified(supa, args.fiscalYear, periods.first, periods.last);
  verRows = res.data;
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 3);
}
console.log(`  kpi_period_status verified rows for FY${args.fiscalYear} P${periods.first}..P${periods.last}:`);
for (const r of verRows) {
  console.log(`    P${r.period_no}  verified_at=${r.verified_at}  verified_by=${r.verified_by}  source_ref=${r.source_ref}`);
}
const versionCount = verRows.length;
const statusMatch = versionCount === (periods.last - periods.first + 1);
console.log(`  period-status match: ${statusMatch ? "PASS" : "FAIL"}`);

console.log("");
if (exceptionRows.length > 0) {
  console.log(`LOAD PASS · ${totalLines} lines loaded · ${exceptionRows.length} exception row(s) recorded (see audit doc + pnl_reconciliation_exceptions).`);
  process.exit(rowMatch && statusMatch ? 0 : 1);
} else {
  console.log(rowMatch && statusMatch ? "LOAD PASS" : "LOAD ATTENTION (see post-load verification above)");
  process.exit(rowMatch && statusMatch ? 0 : 1);
}
