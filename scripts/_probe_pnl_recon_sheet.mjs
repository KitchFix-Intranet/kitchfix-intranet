// scripts/_probe_pnl_recon_sheet.mjs
// Read one account sheet in full and find:
//   - the line-code column (contains 3100.1 / 3100.2 strings)
//   - the row(s) matching those codes
//   - the period columns (P1 through P8)
// Prints the full column 1 (line codes), the column-A/B header rows,
// and the values at line-code x period intersections.

import ExcelJS from "exceljs";

const XLSX = "/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx";
const SHEET = process.argv[2] || "CIN-OH";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);
const ws = wb.getWorksheet(SHEET);
if (!ws) throw new Error(`sheet not found: ${SHEET}`);

console.log(`SHEET: "${SHEET}"  rows=${ws.rowCount}  cols=${ws.columnCount}`);

// Walk column 1 (col A) to find rows with any content. Line codes are
// typically strings like "3100.1" or numeric-string sortable.
console.log("\nCOLUMN 1 (line codes / labels):");
for (let r = 1; r <= ws.rowCount; r++) {
  const cell = ws.getRow(r).getCell(1);
  let v = cell.value;
  if (v && typeof v === "object") {
    if ("result" in v) v = v.result;
    else if ("text" in v) v = v.text;
  }
  if (v != null && v !== "") {
    console.log(`  R${r} col1: ${JSON.stringify(v)}`);
  }
}

// Header rows - first 5 rows across all cols to understand period columns.
console.log("\nFIRST 5 ROWS (all cols with content):");
for (let r = 1; r <= 5; r++) {
  const row = ws.getRow(r);
  const cells = [];
  row.eachCell({ includeEmpty: false }, (cell, colNum) => {
    let v = cell.value;
    if (v && typeof v === "object") {
      if ("result" in v) v = v.result;
      else if ("text" in v) v = v.text;
    }
    cells.push(`c${colNum}=${JSON.stringify(v)}`);
  });
  console.log(`  R${r}: ${cells.join(" | ")}`);
}
