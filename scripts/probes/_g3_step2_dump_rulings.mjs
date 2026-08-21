#!/usr/bin/env node
/* G3 step 2: dump the Rulings sheet fully (all 23 rulings). Look at columns
   to find the actual ruling column (spec says column F, but header may be
   elsewhere). Also dump "Already routed" and "The three hard ones" fully. */

import ExcelJS from "exceljs";

const RULINGS = "/Users/kevinfietek/Downloads/card_category_rulings.xlsx";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(RULINGS);

for (const ws of wb.worksheets) {
  console.log(`\n########## SHEET "${ws.name}" (rows=${ws.rowCount}, cols=${ws.columnCount}) ##########`);
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNum) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = row.getCell(c).value;
      // handle rich text / formula cells
      let s;
      if (v === null || v === undefined) s = "";
      else if (typeof v === "object") {
        if (v.text !== undefined) s = String(v.text);
        else if (v.result !== undefined) s = String(v.result);
        else if (v.richText) s = v.richText.map(t => t.text).join("");
        else s = JSON.stringify(v);
      }
      else s = String(v);
      vals.push(s);
    }
    rows.push({ rowNum, vals });
  });
  for (const r of rows) {
    console.log(`r${String(r.rowNum).padStart(2)}: ${r.vals.map((v, i) => `${String.fromCharCode(65+i)}=${JSON.stringify(v.slice(0, 120))}`).join(" | ")}`);
  }
}
