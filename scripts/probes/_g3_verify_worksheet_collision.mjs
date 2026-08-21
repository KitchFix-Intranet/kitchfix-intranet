import ExcelJS from "exceljs";
const OUT = `${process.env.HOME}/Downloads/spend_category_review_2026-08-20.xlsx`;
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(OUT);
const ws = wb.getWorksheet("Review");
console.log(`review sheet rows: ${ws.rowCount}`);
ws.eachRow((row, idx) => {
  const cells = [];
  for (let c = 1; c <= 9; c++) cells.push(row.getCell(c).value);
  console.log(`  ${idx}: ${JSON.stringify(cells)}`);
});
