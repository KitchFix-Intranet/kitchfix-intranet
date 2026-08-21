#!/usr/bin/env node
/* G3 step 1: probe the rulings xlsx + CSV structure. No writes. */

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const RULINGS = "/Users/kevinfietek/Downloads/card_category_rulings.xlsx";
const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";

// 1) probe rulings xlsx
console.log("=== rulings xlsx ===");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(RULINGS);
for (const ws of wb.worksheets) {
  console.log(`sheet: "${ws.name}" rows=${ws.rowCount} cols=${ws.columnCount}`);
  // print first row (headers) and first 3 data rows
  const printed = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum > 5) return;
    const vals = [];
    for (let c = 1; c <= Math.min(ws.columnCount, 10); c++) {
      const v = row.getCell(c).value;
      vals.push(v === null || v === undefined ? "" : String(v).slice(0, 80));
    }
    printed.push(`row ${rowNum}: [${vals.join(" | ")}]`);
  });
  for (const p of printed) console.log(p);
  // count non-empty rows
  let count = 0;
  ws.eachRow({ includeEmpty: false }, () => { count++; });
  console.log(`non-empty rows total: ${count}`);
}

// 2) probe CSV: header row + first data row + count
console.log("\n=== CSV probe ===");
const csvRaw = fs.readFileSync(CSV, "utf8");
const lines = csvRaw.split("\n");
console.log(`total lines (incl blanks): ${lines.length}`);
console.log(`header (row 1): ${lines[0].slice(0, 300)}`);
// count non-blank data lines
let nonBlank = 0;
for (let i = 1; i < lines.length; i++) if (lines[i].trim().length > 0) nonBlank++;
console.log(`non-blank data rows: ${nonBlank}`);
