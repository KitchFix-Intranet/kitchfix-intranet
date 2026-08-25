// scripts/_probe_pnl_recon_extract.mjs
// Extract the P&L Budget + Actual figures for lines 3100.1 (hourly)
// and 3100.2 (salary) across P1-P8 for every account sheet. Dump as
// JSON to stdout so the reconciliation matrix probe can consume it.
//
// Sheet structure (verified on CIN-OH):
//   Row 35 col 1 = "    3100.1 Hourly Kitchen Labor Wages"
//   Row 36 col 1 = "    3100.2 Salary Kitchen Wages"
//   Period column layout:
//     P<N> Budget: col 17 + 14*(N-1)
//     P<N> Actual: col 19 + 14*(N-1)
//     P<N> Delta:  col 21 + 14*(N-1)
//   YTD block sits at col+7 offset (skipped here).

import ExcelJS from "exceljs";

const XLSX = "/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx";

const ACCOUNT_SHEETS = [
  "CIN-AZ", "CIN-KY", "CIN-OH",
  "STL-FL", "STL-MO",
  "TBJ-BUF", "TBJ-FL",
  "TBR-FL",
  "TXR-AZ", "TXR-HOME", "TXR-VISTOR",
];

const ROW_HOURLY = 35;
const ROW_SALARY = 36;

function periodBudgetCol(p) { return 17 + 14 * (p - 1); }
function periodActualCol(p) { return 19 + 14 * (p - 1); }

function readNumeric(cell) {
  let v = cell.value;
  if (v == null || v === "") return null;
  if (typeof v === "object") {
    if ("result" in v) v = v.result;
    else if ("text" in v) v = v.text;
    else return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);

const out = {};
for (const sheet of ACCOUNT_SHEETS) {
  const ws = wb.getWorksheet(sheet);
  if (!ws) { console.error(`ERR: sheet not found: ${sheet}`); continue; }

  // Verify the row labels are what we expect - fail loud if they moved.
  const hLabel = ws.getRow(ROW_HOURLY).getCell(1).value;
  const sLabel = ws.getRow(ROW_SALARY).getCell(1).value;
  const hOk = typeof hLabel === "string" && hLabel.includes("3100.1");
  const sOk = typeof sLabel === "string" && sLabel.includes("3100.2");
  if (!hOk || !sOk) {
    console.error(`ERR: ${sheet} row labels moved - R${ROW_HOURLY}=${JSON.stringify(hLabel)} R${ROW_SALARY}=${JSON.stringify(sLabel)}`);
    continue;
  }

  const perPeriod = {};
  for (let p = 1; p <= 8; p++) {
    const bCol = periodBudgetCol(p);
    const aCol = periodActualCol(p);
    perPeriod[`P${p}`] = {
      hourly_budget: readNumeric(ws.getRow(ROW_HOURLY).getCell(bCol)),
      hourly_actual: readNumeric(ws.getRow(ROW_HOURLY).getCell(aCol)),
      salary_budget: readNumeric(ws.getRow(ROW_SALARY).getCell(bCol)),
      salary_actual: readNumeric(ws.getRow(ROW_SALARY).getCell(aCol)),
    };
  }
  out[sheet] = { row_labels: { hourly: hLabel, salary: sLabel }, periods: perPeriod };
}

console.log(JSON.stringify(out, null, 2));
