// Dump row 3 + row 4 header labels for a portfolio account tab in the
// FY2024/FY2025 workbooks, so we can locate the Year Total and Year
// Budget columns for the history loader's sum-check law.
//
// Usage: node scripts/_probe_fin2027_workbook_headers.mjs '<xlsx>' '<tab>'

import ExcelJS from "exceljs";

const [file, tab] = process.argv.slice(2);
if (!file || !tab) {
  console.error("usage: node scripts/_probe_fin2027_workbook_headers.mjs '<xlsx>' '<tab>'");
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet(tab);
if (!ws) { console.error(`tab not found: ${tab}`); process.exit(1); }

const cellText = (c) => {
  if (!c) return "";
  const v = c.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
  }
  return String(v);
};

console.log(`FILE: ${file}`);
console.log(`TAB:  ${tab}`);
console.log("");
console.log("col | row1                     | row3                                     | row4");
console.log("----+--------------------------+------------------------------------------+---------");
for (let c = 1; c <= 210; c += 1) {
  const r1 = cellText(ws.getRow(1).getCell(c)).slice(0, 24);
  const r3 = cellText(ws.getRow(3).getCell(c)).slice(0, 40);
  const r4 = cellText(ws.getRow(4).getCell(c)).slice(0, 20);
  if (!r1 && !r3 && !r4) continue;
  console.log(`${String(c).padStart(3)} | ${r1.padEnd(24)} | ${r3.padEnd(40)} | ${r4}`);
}
