// scripts/_probe_fin2027_scenario_diff.mjs
//
// FIN-2027 W0 §5.9 probe. Diff the two FY2027 scenario budget files.
// Reports per portfolio account tab: number of differing period-budget cells,
// the set of line codes that differ, and each code's differing-period span.
// NEVER prints amounts.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_scenario_diff.mjs \
//     '<FY2027_FULL_MLB.xlsx>' '<FY2027_NO_MLB.xlsx>'
//
// Constants (from derive_pnl_actuals.mjs):
//   REV_COGS_ROWS = [21, 22, 25, 26, 29, 35, 36, 40, 41, 45, 46, 47, 51, 52, 53, 54]
//   SGA_ROW_RANGE = { first: 60, last: 97 }
//   periodBudgetCol(n) = 2 + (n-1)  (column B..N for P1..P13)

import ExcelJS from "exceljs";
import path from "node:path";

const REV_COGS_ROWS = [21, 22, 25, 26, 29, 35, 36, 40, 41, 45, 46, 47, 51, 52, 53, 54];
const SGA_FIRST = 60;
const SGA_LAST = 97;

// Portfolio account tabs (row-1 title -> account_key). Non-portfolio tabs are ignored.
const TITLE_TO_ACCOUNT = new Map([
  ["Cincinnati Reds - Goodyear, AZ", "CIN - AZ"],
  ["Cincinnati Reds - Cincinnati, OH", "CIN - OH"],
  ["Louisville Bats - Louisville, KY", "CIN - KY"],
  ["St. Louis Cardinals - Jupiter, FL", "STL - FL"],
  ["St. Louis Cardinals MLB - St. Louis, MO", "STL - MO"],
  ["Toronto Blue Jays - Dunedin, FL", "TBJ - FL"],
  ["Toronto Blue Jays - Buffalo, NY", "TBJ - NY"],
  ["Tampa Bay Rays - Port Charlotte, FL", "TBR - FL"],
  ["Texas Rangers - Surprise, AZ", "TXR - AZ"],
  ["Texas Rangers - Home - Arlington, TX", "TXR - TX - H"],
  ["Texas Rangers - Visitor - Arlington, TX", "TXR - TX - V"],
]);

function parseLineCode(rawLabel, rowNo) {
  if (rawLabel && typeof rawLabel === "object" && "richText" in rawLabel) {
    rawLabel = rawLabel.richText.map((r) => r.text).join("");
  } else if (typeof rawLabel !== "string") {
    if (rawLabel == null) return null;
    rawLabel = String(rawLabel);
  }
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (/^total\b/i.test(trimmed)) return null;
  const m = trimmed.match(/^(\d{4}(?:\.\d+)?)\s+/);
  if (!m) return null;
  const code = m[1];
  if (rowNo >= SGA_FIRST && !code.includes(".")) return null;
  return code;
}

function readNumeric(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.result != null) return typeof v.result === "number" ? v.result : Number(v.result) || null;
    if (v.formula) return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function row1Title(ws) {
  const v = ws.getRow(1).getCell(1).value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join("").trim();
  return String(v).trim();
}

// Load a workbook and return a map: account_key -> { code -> [period: budget] }.
async function loadScenario(pathToXlsx) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(pathToXlsx);
  const byAccount = new Map();
  for (const ws of wb.worksheets) {
    const title = row1Title(ws);
    const acctKey = TITLE_TO_ACCOUNT.get(title);
    if (!acctKey) continue;
    const codeMap = new Map();
    const addRow = (rowNo) => {
      const label = ws.getRow(rowNo).getCell(1).value;
      const code = parseLineCode(label, rowNo);
      if (!code) return;
      const periods = new Array(14).fill(null); // 1..13
      for (let p = 1; p <= 13; p += 1) {
        periods[p] = readNumeric(ws.getRow(rowNo).getCell(2 + (p - 1)));
      }
      codeMap.set(code, periods);
    };
    for (const r of REV_COGS_ROWS) addRow(r);
    for (let r = SGA_FIRST; r <= SGA_LAST; r += 1) addRow(r);
    byAccount.set(acctKey, codeMap);
  }
  return byAccount;
}

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error("usage: node --env-file=.env.local scripts/_probe_fin2027_scenario_diff.mjs '<FULL_MLB>' '<NO_MLB>'");
  process.exit(1);
}

console.log(`A = ${path.basename(fileA)}`);
console.log(`B = ${path.basename(fileB)}`);
console.log("");

const a = await loadScenario(fileA);
const b = await loadScenario(fileB);

const allAccounts = new Set([...a.keys(), ...b.keys()]);
let grandDiffCells = 0;

for (const acct of [...allAccounts].sort()) {
  const codesA = a.get(acct) || new Map();
  const codesB = b.get(acct) || new Map();
  const allCodes = new Set([...codesA.keys(), ...codesB.keys()]);
  let acctDiffCells = 0;
  const codeSpans = new Map(); // code -> {periods:[], differsCount:int}

  for (const code of allCodes) {
    const va = codesA.get(code);
    const vb = codesB.get(code);
    const differPeriods = [];
    for (let p = 1; p <= 13; p += 1) {
      const aVal = va ? va[p] : null;
      const bVal = vb ? vb[p] : null;
      // Round both to 2 decimals before compare - Excel formula floats.
      const aR = aVal == null ? null : Math.round(aVal * 100) / 100;
      const bR = bVal == null ? null : Math.round(bVal * 100) / 100;
      if (aR !== bR) {
        differPeriods.push(p);
        acctDiffCells += 1;
        grandDiffCells += 1;
      }
    }
    if (differPeriods.length > 0) {
      codeSpans.set(code, differPeriods);
    }
  }

  console.log(`[${acct}]  differing cells: ${acctDiffCells}  differing codes: ${codeSpans.size}`);
  const sortedCodes = [...codeSpans.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [code, periods] of sortedCodes) {
    // Compact span display
    const first = periods[0], last = periods[periods.length - 1];
    const contiguous = periods.length === (last - first + 1);
    const label = contiguous ? `P${first}..P${last}` : `P${periods.join(",P")}`;
    console.log(`    ${code}  ${periods.length} periods: ${label}`);
  }
  console.log("");
}

console.log(`TOTAL DIFFERING CELLS ACROSS ALL 11 ACCOUNTS: ${grandDiffCells}`);
