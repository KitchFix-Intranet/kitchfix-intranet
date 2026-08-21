import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(`${process.env.HOME}/Downloads/spend_category_review_2026-08-20.xlsx`);
for (const ws of wb.worksheets) {
  console.log(`\n== ${ws.name} ==`);
  ws.eachRow((row, n) => {
    if (n > 20) return;
    console.log(`r${n}:`, row.values.slice(1).map(v => JSON.stringify(v)).join(" | "));
  });
}
