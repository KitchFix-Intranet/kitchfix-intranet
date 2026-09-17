// Print tab names for each supplied workbook (no cell reads beyond .worksheets[].name).
import ExcelJS from "exceljs";
import path from "node:path";

const files = process.argv.slice(2);
for (const f of files) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f);
  console.log("=".repeat(60));
  console.log(path.basename(f));
  console.log("=".repeat(60));
  wb.worksheets.forEach((ws, i) => console.log(`  ${String(i + 1).padStart(2)}. ${ws.name}`));
}
