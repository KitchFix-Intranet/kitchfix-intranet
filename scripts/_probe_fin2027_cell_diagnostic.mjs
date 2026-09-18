// scripts/_probe_fin2027_cell_diagnostic.mjs
//
// FIN-2027 W1 Stage 2 · read-only cell diagnostic for the FY2024
// reconciliation drift on 5006.1 / 5006.3 / 5017.7 across TBJ - FL,
// TBR - FL, TXR - TX - H, TXR - TX - V. Reports per (tab, line_code):
//   - the 13 per-period actual cells (address + value + is-formula
//     + formula text if formula)
//   - the YTD-P13 actual cell (col 194)
//   - the Year Total budget cell (col 15) for comparison
//   - whether formulas reference off-tab / shared ranges
//
// Kevin's diagnostic call, 2026-09-17. Read-only; no writes.
//
// Usage:
//   node scripts/_probe_fin2027_cell_diagnostic.mjs '<xlsx>' \
//     'PFS - TBJ:5006.1' 'PFS - TBR:5006.1' 'PFS - TXR:5006.1' 'PFS - TXR-VISTOR:5006.1'
//
// Each pair is <tab_name>:<line_code>. The probe finds the row that
// begins with that line_code label (via parseLineCode) and dumps the
// numeric-band cells.

import ExcelJS from "exceljs";

const [file, ...targets] = process.argv.slice(2);
if (!file || targets.length === 0) {
  console.error("usage: node scripts/_probe_fin2027_cell_diagnostic.mjs <xlsx> <tab:code> [<tab:code>...]");
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

function parseLineCodeLoose(rawLabel) {
  if (typeof rawLabel !== "string") return null;
  const trimmed = rawLabel.trim();
  const m = trimmed.match(/^(\d{4}(?:\.\d+)?)\s+/);
  return m ? m[1] : null;
}

function periodActualCol(n) { return 19 + (n - 1) * 14; }
const YEAR_TOTAL_BUDGET_COL = 15;
const YEAR_TOTAL_ACTUAL_COL = periodActualCol(13) + 7;      // 26 + 12*14 = 194 (YTD-P13 Actual)

function addressOf(cell) {
  return cell?.address ?? "?";
}

function describeCell(cell) {
  if (!cell) return { kind: "MISSING", value: null, formula: null, refs: [] };
  const v = cell.value;
  if (v == null) return { kind: "EMPTY", value: null, formula: null, refs: [] };
  if (typeof v === "number") return { kind: "LITERAL", value: v, formula: null, refs: [] };
  if (typeof v === "string") return { kind: "STRING", value: v, formula: null, refs: [] };
  if (typeof v === "object") {
    // ExcelJS carries formulas as { formula, result } or { sharedFormula, result }.
    if (v.formula) {
      // Extract cell / range references from the formula string.
      const refs = [];
      const rangeRe = /(?:'?[^!'\s]+'?!)?\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?/g;
      const m = v.formula.match(rangeRe);
      if (m) refs.push(...m);
      return { kind: "FORMULA", value: v.result ?? null, formula: v.formula, refs };
    }
    if (v.sharedFormula) {
      return { kind: "SHARED_FORMULA", value: v.result ?? null, formula: v.sharedFormula, refs: [v.sharedFormula] };
    }
    if (v.result != null) return { kind: "OBJ", value: v.result, formula: null, refs: [] };
  }
  return { kind: "OTHER", value: String(v), formula: null, refs: [] };
}

for (const target of targets) {
  const [tab, code] = target.split(":");
  console.log("=".repeat(90));
  console.log(`TAB: ${tab}   LINE: ${code}`);
  console.log("=".repeat(90));

  const ws = wb.getWorksheet(tab);
  if (!ws) { console.log(`  tab not found`); continue; }

  // Locate the row whose col-A label starts with the code.
  let foundRow = null;
  for (let r = 1; r <= 120; r += 1) {
    const label = ws.getRow(r).getCell(1).value;
    if (typeof label !== "string") continue;
    const parsed = parseLineCodeLoose(label);
    if (parsed === code) { foundRow = r; break; }
  }
  if (foundRow == null) { console.log(`  code ${code} not found in tab`); continue; }

  console.log(`  row: ${foundRow}   label: ${JSON.stringify(ws.getRow(foundRow).getCell(1).value).slice(0, 80)}`);
  console.log("");

  let sumOfPeriods = 0;
  let anyPeriodNumeric = false;
  console.log(`  per-period actual cells (col 19+14*(n-1)):`);
  console.log(`    p   col  addr    kind             value              formula-or-ref`);
  console.log(`    --+-----+-------+-----------------+------------------+--------------------------------`);
  for (let p = 1; p <= 13; p += 1) {
    const col = periodActualCol(p);
    const cell = ws.getRow(foundRow).getCell(col);
    const desc = describeCell(cell);
    if (typeof desc.value === "number") { sumOfPeriods += desc.value; anyPeriodNumeric = true; }
    const valStr = desc.value == null ? "-" : String(desc.value);
    const formulaOrRef = desc.formula
      ? `= ${desc.formula.slice(0, 60)}${desc.refs.length ? "  refs=[" + desc.refs.slice(0, 4).join(",") + "]" : ""}`
      : (desc.refs.length ? "sharedFrom=" + desc.refs.join(",") : "");
    console.log(`    ${String(p).padStart(2)}  ${String(col).padStart(3)}  ${String(addressOf(cell)).padEnd(5)}  ${desc.kind.padEnd(15)}  ${valStr.padStart(16)}  ${formulaOrRef}`);
  }
  console.log("");
  console.log(`    sum-of-13-period-cells (loader anchor A_loaded):  ${anyPeriodNumeric ? sumOfPeriods.toFixed(2) : "n/a"}`);

  // YTD-P13 Actual cell (col 194).
  {
    const cell = ws.getRow(foundRow).getCell(YEAR_TOTAL_ACTUAL_COL);
    const desc = describeCell(cell);
    const valStr = desc.value == null ? "-" : String(desc.value);
    const formulaOrRef = desc.formula
      ? `= ${desc.formula}${desc.refs.length ? "  refs=[" + desc.refs.slice(0, 4).join(",") + "]" : ""}`
      : (desc.refs.length ? "sharedFrom=" + desc.refs.join(",") : "");
    console.log("");
    console.log(`  YTD-P13 actual (col ${YEAR_TOTAL_ACTUAL_COL}, ${addressOf(cell)}):  ${desc.kind}  value=${valStr}`);
    if (formulaOrRef) console.log(`    formula/ref: ${formulaOrRef}`);
  }

  // Year Total budget (col 15).
  {
    const cell = ws.getRow(foundRow).getCell(YEAR_TOTAL_BUDGET_COL);
    const desc = describeCell(cell);
    const valStr = desc.value == null ? "-" : String(desc.value);
    const formulaOrRef = desc.formula
      ? `= ${desc.formula}${desc.refs.length ? "  refs=[" + desc.refs.slice(0, 4).join(",") + "]" : ""}`
      : (desc.refs.length ? "sharedFrom=" + desc.refs.join(",") : "");
    console.log(`  Year Total budget (col ${YEAR_TOTAL_BUDGET_COL}, ${addressOf(cell)}):  ${desc.kind}  value=${valStr}`);
    if (formulaOrRef) console.log(`    formula/ref: ${formulaOrRef}`);
  }
  console.log("");
}
