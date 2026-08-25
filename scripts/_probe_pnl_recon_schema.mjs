// scripts/_probe_pnl_recon_schema.mjs
// PNL RECON P1-P8 audit 2026-08-25 - step 1.
//
// Read the finance xlsx and dump: sheet names, dimensions, header
// rows verbatim, first 5 data rows per sheet, and any obviously
// account-identifier + line-code + period columns.
//
// Constraint: NO worker names, NO individual pay amounts anywhere in
// output. This is a schema probe; if any row-level dump has PII-ish
// content, redact. For this finance file the risk is low (it is
// account-period P&L, not line-item pay).

import ExcelJS from "exceljs";
import path from "node:path";

const XLSX = "/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);

console.log(`FILE: ${path.basename(XLSX)}`);
console.log(`SHEETS (${wb.worksheets.length}):`);
for (const ws of wb.worksheets) {
  console.log(`  - "${ws.name}"  rows=${ws.rowCount}  cols=${ws.columnCount}  state=${ws.state}`);
}

for (const ws of wb.worksheets) {
  console.log("");
  console.log("=".repeat(72));
  console.log(`SHEET: "${ws.name}"`);
  console.log("=".repeat(72));
  console.log(`dimensions: rows=${ws.rowCount}, cols=${ws.columnCount}`);

  // Dump the first 10 rows verbatim to establish header shape.
  const previewRows = Math.min(ws.rowCount, 10);
  for (let r = 1; r <= previewRows; r++) {
    const row = ws.getRow(r);
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      // Values may be numbers, strings, dates, or formula objects. Render
      // .result (formula) or .value (plain) as a printable string.
      let v = cell.value;
      if (v && typeof v === "object") {
        if ("result" in v) v = v.result;
        else if ("text" in v) v = v.text;
        else if (v instanceof Date) v = v.toISOString().slice(0, 10);
        else v = JSON.stringify(v);
      }
      cells.push(`[${colNum}] ${JSON.stringify(v)}`);
    });
    console.log(`  R${r}: ${cells.join(" | ")}`);
  }
}
