// scripts/_probe_fin2027_absence_shape.mjs
//
// FIN-2027 W1 Stage 2 · read-only absence-shape analysis for a
// historical P&L workbook. Same parsing rules as
// scripts/load_pnl_history.mjs (row-1 title tab resolution +
// label-driven leaf scan + kpi_lines validation); classifies every
// (account, line, period) cell as populated or absent, and reports
// the shape of the absence:
//
//   A. Whole-period-blank per account
//      (all lines have 0 for this account+period, i.e. the account
//      is inactive that period - e.g. STL - FL starts mid-season).
//   B. Whole-line-blank per account
//      (all 13 periods have 0 for this account+line, i.e. the line
//      is inactive for the entire account this year).
//   C. Scattered blanks inside otherwise-active lines
//      (a line has some populated and some blank periods, in no
//      A / B pattern).
//
// Counts + PASS/FAIL only. Never prints dollar amounts.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_absence_shape.mjs \
//     --file '<xlsx>' --fiscal-year 2024

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { parseLineCode } from "./lib/pnl_load_core.mjs";

const args = { file: null, fiscalYear: null };
for (let i = 2; i < process.argv.length; i += 1) {
  const x = process.argv[i];
  if (x === "--file") args.file = process.argv[++i];
  else if (x === "--fiscal-year") args.fiscalYear = Number(process.argv[++i]);
  else { console.error(`unknown arg: ${x}`); process.exit(1); }
}
if (!args.file || !args.fiscalYear || !existsSync(args.file)) {
  console.error("usage: node --env-file=.env.local scripts/_probe_fin2027_absence_shape.mjs --file '<xlsx>' --fiscal-year <YYYY>");
  process.exit(1);
}

// Row-1 title -> account_key resolver (matches load_pnl_history.mjs).
function resolveAccountFromRow1Title(t) {
  if (typeof t !== "string" || !t.trim()) return null;
  const s = t.trim();
  if (/\bVISTOR\b|\bVisitor\b/i.test(s) && /Texas Rangers.*Arlington.*TX/i.test(s)) return "TXR - TX - V";
  if (/Cincinnati Reds.*Goodyear.*AZ/i.test(s)) return "CIN - AZ";
  if (/Louisville Bats.*Louisville.*KY/i.test(s)) return "CIN - KY";
  if (/Cincinnati Reds.*Cincinnati.*OH/i.test(s)) return "CIN - OH";
  if (/St\.?\s*Louis Cardinals.*Jupiter.*FL/i.test(s)) return "STL - FL";
  if (/St\.?\s*Louis Cardinals.*St\.?\s*Louis.*MO/i.test(s)) return "STL - MO";
  if (/Toronto Blue Jays.*Dunedin.*FL/i.test(s)) return "TBJ - FL";
  if (/Toronto Blue Jays.*Buffalo.*NY/i.test(s)) return "TBJ - NY";
  if (/Tampa Bay Rays.*(Engelwood|Englewood|Port Charlotte).*FL/i.test(s)) return "TBR - FL";
  if (/Texas Rangers.*Surprise.*AZ/i.test(s)) return "TXR - AZ";
  if (/Texas Rangers.*Arlington.*TX/i.test(s)) return "TXR - TX - H";
  return null;
}

function readNumericLoose(cell) {
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
const periodActualCol = (n) => 19 + (n - 1) * 14;
const periodBudgetCol = (n) => 2 + (n - 1);

// Load kpi_lines to filter dotless group headers.
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: catalog } = await supa.from("kpi_lines").select("line_code");
const KPI_LINES = new Set(catalog.map((r) => r.line_code));

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(args.file);

// Row-1 title map, first-match wins per account_key.
const tabToAccount = new Map();
const foundAccounts = new Set();
function row1Title(ws) {
  const v = ws.getRow(1).getCell(1).value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join("").trim();
  return String(v).trim();
}
for (const ws of wb.worksheets) {
  const t = row1Title(ws);
  const key = resolveAccountFromRow1Title(t);
  if (key && !foundAccounts.has(key)) {
    tabToAccount.set(ws.name, key);
    foundAccounts.add(key);
  }
}

// Per-account, per-line, per-period: 1 if populated (actual OR budget non-null), 0 if absent.
// A cell is "populated" iff at least one of actual or budget is non-null (matches loader's
// absence contract: absent = both null).
const grid = new Map();                                    // account -> Map(line -> Array(14) of 0/1, index 1..13)

const SCAN_ROW_FIRST = 5;
const SCAN_ROW_LAST = 97;

for (const [tab, account] of tabToAccount) {
  const ws = wb.getWorksheet(tab);
  const accountGrid = new Map();
  for (let r = SCAN_ROW_FIRST; r <= SCAN_ROW_LAST; r += 1) {
    const row = ws.getRow(r);
    const rawLabel = row.getCell(1).value;
    const parsed = parseLineCode(rawLabel, r);
    if (!parsed) continue;
    if (!KPI_LINES.has(parsed.code)) continue;               // group header or unknown (loader handles either)
    const cells = new Array(14).fill(0);
    for (let p = 1; p <= 13; p += 1) {
      const actual = readNumericLoose(row.getCell(periodActualCol(p)));
      const budget = readNumericLoose(row.getCell(periodBudgetCol(p)));
      cells[p] = (actual != null || budget != null) ? 1 : 0;
    }
    accountGrid.set(parsed.code, cells);
  }
  grid.set(account, accountGrid);
}

// ──── Analysis ────────────────────────────────────────────────────
console.log(`FY${args.fiscalYear} absence-shape analysis`);
console.log(`  workbook: ${args.file.split("/").pop()}`);
console.log("");

let overallExpected = 0;
let overallPresent = 0;
let overallAbsent = 0;

// Per-account totals.
console.log("Per-account cell coverage (loaded / expected, absent count, absent %):");
console.log("  account         lines  cells_loaded  cells_expected  absent  absent_%");
console.log("  ---------------+------+-------------+---------------+-------+---------");
const perAccountStats = [];
for (const [acct, lines] of grid) {
  const nLines = lines.size;
  const expected = nLines * 13;
  let present = 0;
  for (const cells of lines.values()) {
    for (let p = 1; p <= 13; p += 1) present += cells[p];
  }
  const absent = expected - present;
  perAccountStats.push({ acct, nLines, expected, present, absent });
  overallExpected += expected;
  overallPresent += present;
  overallAbsent += absent;
  const pct = expected > 0 ? (100 * absent / expected).toFixed(1) : "n/a";
  console.log(`  ${acct.padEnd(15)} ${String(nLines).padStart(4)}  ${String(present).padStart(11)}  ${String(expected).padStart(13)}  ${String(absent).padStart(5)}  ${String(pct).padStart(7)}%`);
}
console.log(`  ---------------+------+-------------+---------------+-------+---------`);
console.log(`  TOTAL              ${String(overallPresent).padStart(13)}  ${String(overallExpected).padStart(13)}  ${String(overallAbsent).padStart(5)}  ${(100 * overallAbsent / overallExpected).toFixed(1).padStart(7)}%`);
console.log("");

// Shape A: whole-period-blank per account.
console.log("Shape A · whole-period-blank per account (all lines have 0 cells this period → account inactive that period):");
console.log("  account         empty_periods (P#: all lines blank)");
console.log("  ---------------+----------------------------------------------------");
let totalShapeA = 0;
for (const { acct } of perAccountStats) {
  const lines = grid.get(acct);
  const emptyPeriods = [];
  for (let p = 1; p <= 13; p += 1) {
    let anyPresent = false;
    for (const cells of lines.values()) {
      if (cells[p] === 1) { anyPresent = true; break; }
    }
    if (!anyPresent) emptyPeriods.push(p);
  }
  if (emptyPeriods.length > 0) {
    const contiguous = (emptyPeriods.length === emptyPeriods[emptyPeriods.length - 1] - emptyPeriods[0] + 1);
    const label = contiguous ? `P${emptyPeriods[0]}..P${emptyPeriods[emptyPeriods.length - 1]}` : `P${emptyPeriods.join(",P")}`;
    console.log(`  ${acct.padEnd(15)}  ${emptyPeriods.length} period(s) blank: ${label}  (${lines.size} lines × ${emptyPeriods.length} = ${lines.size * emptyPeriods.length} cells accounted for)`);
    totalShapeA += lines.size * emptyPeriods.length;
  }
}
if (totalShapeA === 0) console.log("  (none - every account has at least one populated cell in every period)");
console.log(`  Shape A subtotal: ${totalShapeA} absent cells attributable to whole-period-blank`);
console.log("");

// Shape B: whole-line-blank per account.
console.log("Shape B · whole-line-blank per account (all 13 periods blank for a (account, line) → line inactive that year):");
console.log("  account         empty_lines (line_code: all 13 periods blank)");
console.log("  ---------------+----------------------------------------------------");
let totalShapeB = 0;
for (const { acct } of perAccountStats) {
  const lines = grid.get(acct);
  const emptyLines = [];
  for (const [code, cells] of lines) {
    let anyPresent = false;
    for (let p = 1; p <= 13; p += 1) if (cells[p] === 1) { anyPresent = true; break; }
    if (!anyPresent) emptyLines.push(code);
  }
  if (emptyLines.length > 0) {
    console.log(`  ${acct.padEnd(15)}  ${emptyLines.length} line(s) blank: ${emptyLines.join(", ")}  (${emptyLines.length} × 13 = ${emptyLines.length * 13} cells accounted for)`);
    totalShapeB += emptyLines.length * 13;
  }
}
if (totalShapeB === 0) console.log("  (none - every (account, line) has at least one populated period)");
console.log(`  Shape B subtotal: ${totalShapeB} absent cells attributable to whole-line-blank`);
console.log("");

// Overlap: cells that are BOTH whole-period-blank and whole-line-blank
// are double-counted above. Compute the actual union.
let unionShapeAB = 0;
for (const { acct } of perAccountStats) {
  const lines = grid.get(acct);
  const emptyPeriods = new Set();
  for (let p = 1; p <= 13; p += 1) {
    let anyPresent = false;
    for (const cells of lines.values()) {
      if (cells[p] === 1) { anyPresent = true; break; }
    }
    if (!anyPresent) emptyPeriods.add(p);
  }
  const emptyLines = new Set();
  for (const [code, cells] of lines) {
    let anyPresent = false;
    for (let p = 1; p <= 13; p += 1) if (cells[p] === 1) { anyPresent = true; break; }
    if (!anyPresent) emptyLines.add(code);
  }
  for (const [code, cells] of lines) {
    for (let p = 1; p <= 13; p += 1) {
      if (cells[p] === 0 && (emptyPeriods.has(p) || emptyLines.has(code))) unionShapeAB += 1;
    }
  }
}
const scatteredAbsent = overallAbsent - unionShapeAB;

// Split "non-A-non-B" absences further: contiguous-tail (line dies
// at some period N, blank PN+1..P13) vs internal-scattered (blanks
// with populated periods AFTER them, so a P/P comparison in W4
// would misread the blank as inactivity).
let contiguousTailAbsent = 0;
let internalScatteredAbsent = 0;
const contiguousTailByAccount = new Map();                  // account -> [{code, lastPopulated, absentTail}]
const internalScatteredByAccount = new Map();               // account -> [{code, absentPeriods}]
for (const { acct } of perAccountStats) {
  const lines = grid.get(acct);
  const emptyPeriods = new Set();
  for (let p = 1; p <= 13; p += 1) {
    let anyPresent = false;
    for (const cells of lines.values()) {
      if (cells[p] === 1) { anyPresent = true; break; }
    }
    if (!anyPresent) emptyPeriods.add(p);
  }
  const emptyLines = new Set();
  for (const [code, cells] of lines) {
    let anyPresent = false;
    for (let p = 1; p <= 13; p += 1) if (cells[p] === 1) { anyPresent = true; break; }
    if (!anyPresent) emptyLines.add(code);
  }
  for (const [code, cells] of lines) {
    if (emptyLines.has(code)) continue;
    // Find last populated period.
    let lastPop = 0;
    for (let p = 13; p >= 1; p -= 1) { if (cells[p] === 1) { lastPop = p; break; } }
    // Find absences ATTRIBUTED to this line (skip those already
    // counted in emptyPeriods so we don't double-count with Shape A).
    const absentPeriods = [];
    for (let p = 1; p <= 13; p += 1) {
      if (cells[p] === 0 && !emptyPeriods.has(p)) absentPeriods.push(p);
    }
    if (absentPeriods.length === 0) continue;
    // Contiguous-tail = every absent period is > lastPop AND covers
    // exactly {lastPop+1, ..., 13}. If any absent period is <= lastPop,
    // that's an internal gap.
    const anyInternal = absentPeriods.some((p) => p <= lastPop);
    if (anyInternal) {
      const arr = internalScatteredByAccount.get(acct) || [];
      arr.push({ code, absentPeriods });
      internalScatteredByAccount.set(acct, arr);
      internalScatteredAbsent += absentPeriods.length;
    } else {
      const arr = contiguousTailByAccount.get(acct) || [];
      arr.push({ code, lastPopulated: lastPop, absentTail: 13 - lastPop });
      contiguousTailByAccount.set(acct, arr);
      contiguousTailAbsent += absentPeriods.length;
    }
  }
}

console.log("Non-(A|B) absence classification:");
console.log(`  Total absent cells:                                    ${overallAbsent}`);
console.log(`  Attributable to whole-period-blank (A):                ${totalShapeA}`);
console.log(`  Attributable to whole-line-blank    (B):               ${totalShapeB}`);
console.log(`  Union of A + B (double-counted removed):               ${unionShapeAB}`);
console.log(`  Non-(A|B) subtotal:                                    ${scatteredAbsent}`);
console.log(`    Shape D · contiguous tail (line dies at period N):   ${contiguousTailAbsent}`);
console.log(`    Shape C · INTERNAL scattered (blank inside active):  ${internalScatteredAbsent}   <-- W4 P/P risk`);
console.log("");

// Report contiguous-tail per account (compact: code:last_populated).
console.log("Shape D · contiguous-tail per account (line dies at period; blank PN+1..P13):");
console.log("  account         count  per_line (line:lastPopulated / absent-tail-length)");
console.log("  ---------------+------+--------------------------------------------------");
for (const { acct } of perAccountStats) {
  const arr = contiguousTailByAccount.get(acct);
  if (!arr || arr.length === 0) continue;
  const total = arr.reduce((s, x) => s + x.absentTail, 0);
  const details = arr.map((x) => `${x.code}:P1..P${x.lastPopulated}`).join(", ");
  console.log(`  ${acct.padEnd(15)} ${String(total).padStart(4)}   ${details}`);
}
console.log("");

// Report internal-scattered (the W4 concern).
console.log("Shape C · INTERNAL scattered per account (blank period inside a still-active line):");
console.log("  account         count  per_line (line: absent periods inside active range)");
console.log("  ---------------+------+--------------------------------------------------");
if (internalScatteredAbsent === 0) {
  console.log("  (none - every absence in this workbook fits Shape A, B, or D)");
} else {
  for (const { acct } of perAccountStats) {
    const arr = internalScatteredByAccount.get(acct);
    if (!arr || arr.length === 0) continue;
    const total = arr.reduce((s, x) => s + x.absentPeriods.length, 0);
    const details = arr.map((x) => `${x.code}:P${x.absentPeriods.join(",P")}`).join(", ");
    console.log(`  ${acct.padEnd(15)} ${String(total).padStart(4)}   ${details}`);
  }
}
console.log("");

console.log(`Sanity check: A(${totalShapeA}) + B(${totalShapeB}) - overlap(${totalShapeA + totalShapeB - unionShapeAB}) + D(${contiguousTailAbsent}) + C_internal(${internalScatteredAbsent}) = ${totalShapeA + totalShapeB - (totalShapeA + totalShapeB - unionShapeAB) + contiguousTailAbsent + internalScatteredAbsent}, expected ${overallAbsent}`);
