// scripts/probes/_probe_pnl_line_coverage.mjs
//
// Coverage probe for PR #902 Fix 2. Answers:
//
//   Q1. Which kpi_lines codes have ZERO loaded rows in the P8 workbook parse?
//   Q2. Per account: count of distinct line codes loaded. Uniformly 32?
//   Q3. Do 3500.1 / 3500.2 land under their own codes per account?
//   Q4. Do 5012.3 / 5012.5 land under their own codes per account?
//   Q5. Name every skipped cell / row (empty, unnumbered, or unrecognized).
//
// READ-ONLY. Reads kpi_lines from Postgres; parses the workbook from disk.

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";

const WORKBOOK_PATH = path.join(
  os.homedir(),
  "Downloads",
  "Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx",
);

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

const REV_COGS_ROWS = [21, 22, 25, 26, 29, 35, 36, 40, 41, 45, 46, 47, 51, 52, 53, 54];
const SGA_ROW_RANGE = { first: 60, last: 97 };
const PERIODS = { first: 1, last: 8 };

function periodBudgetCol(periodNo) { return 2 + (periodNo - 1); }
function periodActualCol(periodNo) { return 19 + (periodNo - 1) * 14; }

function readNumeric(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.result != null) return typeof v.result === "number" ? v.result : Number(v.result) || 0;
    if (v.formula) return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseLineCode(rawLabel, rowNo) {
  if (typeof rawLabel !== "string") return null;
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (/^total\b/i.test(trimmed)) return null;
  const m = trimmed.match(/^(\d{4}(?:\.\d+)?)\s+/);
  if (!m) return null;
  const code = m[1];
  if (rowNo >= SGA_ROW_RANGE.first && !code.includes(".")) return null;
  return { code, label: trimmed };
}

console.log(`SUPABASE_URL:              ${process.env.SUPABASE_URL              ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "ABSENT"}`);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

if (!existsSync(WORKBOOK_PATH)) {
  console.error(`workbook missing: ${WORKBOOK_PATH}`);
  process.exit(1);
}

// Load kpi_lines catalog.
const { data: kpiLinesRows, error: kpiErr } = await supa
  .from("kpi_lines")
  .select("line_code")
  .order("line_code");
if (kpiErr) { console.error(`kpi_lines read failed: ${kpiErr.message}`); process.exit(1); }
const catalog = new Set(kpiLinesRows.map((r) => r.line_code));
console.log(`kpi_lines catalog: ${catalog.size} codes`);
console.log("");

// Parse workbook.
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(WORKBOOK_PATH);

const perAccountLines = new Map();       // account -> Set(line_code)
const codeToRowCount = new Map();        // code -> count of (account, period) rows emitted
const skippedRows = [];                  // {tab, rowNo, kind, label}
const emptyCells = [];                   // {tab, rowNo, code, period, kind}
const unrecognized = [];                 // {tab, rowNo, code, label, reason}

for (const [tab, accountKey] of Object.entries(TAB_TO_ACCOUNT)) {
  const ws = wb.getWorksheet(tab);
  const linesForAccount = new Set();

  // Revenue + COGS rows (fixed set).
  for (const rowNo of REV_COGS_ROWS) {
    const row = ws.getRow(rowNo);
    const rawLabel = row.getCell(1).value;
    const parsed = parseLineCode(rawLabel, rowNo);
    if (!parsed) {
      skippedRows.push({
        tab, rowNo, kind: "revcogs_row_unparsed",
        label: typeof rawLabel === "string" ? rawLabel.trim() : String(rawLabel),
        reason: "label did not match numbered-line regex (fixed REV_COGS row)",
      });
      continue;
    }
    if (!catalog.has(parsed.code)) {
      unrecognized.push({
        tab, rowNo, code: parsed.code, label: parsed.label,
        reason: "code parsed from label is NOT in kpi_lines catalog",
      });
      continue;
    }
    linesForAccount.add(parsed.code);
    for (let p = PERIODS.first; p <= PERIODS.last; p += 1) {
      const actual = readNumeric(row.getCell(periodActualCol(p)));
      const budget = readNumeric(row.getCell(periodBudgetCol(p)));
      if (actual == null && budget == null) {
        emptyCells.push({ tab, rowNo, code: parsed.code, period: p, kind: "empty_cell" });
        continue;
      }
      codeToRowCount.set(parsed.code, (codeToRowCount.get(parsed.code) || 0) + 1);
    }
  }

  // SG&A block: iterate row range.
  for (let rowNo = SGA_ROW_RANGE.first; rowNo <= SGA_ROW_RANGE.last; rowNo += 1) {
    const row = ws.getRow(rowNo);
    const rawLabel = row.getCell(1).value;
    const parsed = parseLineCode(rawLabel, rowNo);
    if (!parsed) {
      const stringForm = typeof rawLabel === "string" ? rawLabel.trim() : (rawLabel == null ? "" : String(rawLabel));
      // Categorize skip: empty, "total" header, group header, comment.
      let kind = "empty_row";
      let reason = "blank cell (SG&A range fill)";
      if (stringForm.length > 0) {
        if (/^total\b/i.test(stringForm)) {
          kind = "total_row"; reason = "Total aggregator row (label starts 'Total')";
        } else if (/^\d{4}\s+/.test(stringForm)) {
          kind = "group_header_row"; reason = "SG&A group header (4-digit no dot; e.g. '5002 Repair & Maintenance')";
        } else {
          kind = "unnumbered_row"; reason = "no leading 4-digit code prefix";
        }
      }
      skippedRows.push({ tab, rowNo, kind, label: stringForm, reason });
      continue;
    }
    if (!catalog.has(parsed.code)) {
      unrecognized.push({
        tab, rowNo, code: parsed.code, label: parsed.label,
        reason: "code parsed from label is NOT in kpi_lines catalog",
      });
      continue;
    }
    linesForAccount.add(parsed.code);
    for (let p = PERIODS.first; p <= PERIODS.last; p += 1) {
      const actual = readNumeric(row.getCell(periodActualCol(p)));
      const budget = readNumeric(row.getCell(periodBudgetCol(p)));
      if (actual == null && budget == null) {
        emptyCells.push({ tab, rowNo, code: parsed.code, period: p, kind: "empty_cell" });
        continue;
      }
      codeToRowCount.set(parsed.code, (codeToRowCount.get(parsed.code) || 0) + 1);
    }
  }

  perAccountLines.set(accountKey, linesForAccount);
}

// Q1: Which kpi_lines codes have ZERO loaded rows?
console.log("── Q1: kpi_lines codes with ZERO loaded rows ──");
const zeroCodes = [];
for (const c of [...catalog].sort()) {
  if (!codeToRowCount.get(c)) zeroCodes.push(c);
}
console.log(`  ${zeroCodes.length} code(s): ${zeroCodes.join(", ") || "(none)"}`);
console.log("");

// Q2: Per account distinct line count.
console.log("── Q2: per-account distinct line count ──");
console.log("  account          distinct");
console.log("  ---------------+---------");
for (const [acct, lines] of perAccountLines) {
  console.log(`  ${acct.padEnd(15)} ${String(lines.size).padStart(8)}`);
}
console.log("");

// Q3 + Q4: 3500.1/3500.2 and 5012.3/5012.5 landing per account.
console.log("── Q3: 3500.1 vs 3500.2 landing per account ──");
console.log("  account          3500.1  3500.2");
console.log("  ---------------+-------+-------");
for (const [acct, lines] of perAccountLines) {
  console.log(`  ${acct.padEnd(15)} ${(lines.has("3500.1") ? "YES" : "no ").padEnd(7)} ${(lines.has("3500.2") ? "YES" : "no ").padEnd(7)}`);
}
console.log("");

console.log("── Q4: 5012.3 vs 5012.5 landing per account ──");
console.log("  account          5012.3  5012.5");
console.log("  ---------------+-------+-------");
for (const [acct, lines] of perAccountLines) {
  console.log(`  ${acct.padEnd(15)} ${(lines.has("5012.3") ? "YES" : "no ").padEnd(7)} ${(lines.has("5012.5") ? "YES" : "no ").padEnd(7)}`);
}
console.log("");

// Q5: Every skipped row / empty cell, named.
console.log("── Q5a: skipped rows (parsed but NOT loaded) ──");
console.log(`  count: ${skippedRows.length}`);
// Group by (kind, label) so the output collapses across the 11 tabs.
const skipGroups = new Map();
for (const s of skippedRows) {
  const key = `${s.kind}::${s.rowNo}::${s.label}`;
  const g = skipGroups.get(key) || { kind: s.kind, rowNo: s.rowNo, label: s.label, reason: s.reason, tabs: [] };
  g.tabs.push(s.tab);
  skipGroups.set(key, g);
}
for (const g of [...skipGroups.values()].sort((a, b) => a.rowNo - b.rowNo || a.kind.localeCompare(b.kind))) {
  const tabsHint = g.tabs.length === 11 ? "(all 11)" : `(${g.tabs.length}: ${g.tabs.join(",")})`;
  console.log(`  row ${g.rowNo.toString().padStart(2)} [${g.kind.padEnd(20)}] "${g.label}" ${tabsHint}  reason: ${g.reason}`);
}
console.log("");

console.log("── Q5b: empty CELLS in numbered-line rows (parsed row, but this (account,period) cell had null actual+budget) ──");
console.log(`  count: ${emptyCells.length}`);
for (const c of emptyCells) {
  console.log(`  tab=${c.tab.padEnd(11)} row=${String(c.rowNo).padStart(2)} code=${c.code.padEnd(6)} period=P${c.period}  reason: workbook cell blank on both actual + budget`);
}
console.log("");

console.log("── Q5c: unrecognized line codes (would FAIL FK) ──");
console.log(`  count: ${unrecognized.length}`);
for (const u of unrecognized) {
  console.log(`  tab=${u.tab} row=${u.rowNo} code=${u.code} label="${u.label}" reason: ${u.reason}`);
}
console.log("");

// Summary.
console.log("── SUMMARY ──");
console.log(`  kpi_lines catalog:          ${catalog.size}`);
console.log(`  codes with 0 loaded rows:   ${zeroCodes.length}  (${zeroCodes.join(",") || "-"})`);
console.log(`  codes with >0 loaded rows:  ${codeToRowCount.size}`);
console.log(`  accounts loaded:            ${perAccountLines.size}`);
console.log(`  skipped rows:               ${skippedRows.length}  (grouped: ${skipGroups.size})`);
console.log(`  empty cells:                ${emptyCells.length}`);
console.log(`  unrecognized codes:         ${unrecognized.length}`);
process.exit(0);
