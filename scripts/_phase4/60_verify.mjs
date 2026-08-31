// Phase 4 verification - opens the workbook and compares key cells to
// Phase 3c values to confirm dollar invariance.

import ExcelJS from "exceljs";
import fs from "node:fs";

const WORKBOOK = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx";
const A3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_analysis3c.json", "utf8"));
const A4 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_analysis4.json", "utf8"));

// Compare spend-related totals
console.log("Spend invariance:");
for (const acct of ["TBR-FL", "TBJ-FL", "STL-FL"]) {
  const s3 = A3C.spend[acct];
  const s4 = A4.spend[acct];
  for (const k of Object.keys(s3)) {
    const a = s3[k];
    const b = s4[k];
    if (typeof a === "number" && Math.abs(a - b) > 0.005) {
      console.log(`  DIFF  ${acct}.spend.${k}: 3c=${a} 4=${b}`);
    }
  }
}
console.log("Reconciliation invariance:");
for (const acct of ["TBR-FL", "TBJ-FL", "STL-FL"]) {
  const r3 = A3C.reconciliation[acct].window;
  const r4 = A4.reconciliation[acct].window;
  for (const k of Object.keys(r3)) {
    const a = r3[k];
    const b = r4[k];
    if (typeof a === "number" && Math.abs(a - b) > 0.005) {
      console.log(`  DIFF  ${acct}.recon.${k}: 3c=${a} 4=${b}`);
    }
  }
}
console.log("Protein spend invariance:");
for (const acct of ["TBR-FL", "TBJ-FL", "STL-FL"]) {
  const p3 = A3C.protein_mix[acct];
  const p4 = A4.protein_mix[acct];
  if (Math.abs(p3.total_protein_spend - p4.total_protein_spend) > 0.005) {
    console.log(`  DIFF  ${acct}.total_protein_spend: 3c=${p3.total_protein_spend} 4=${p4.total_protein_spend}`);
  }
  for (const b3 of p3.by_type) {
    const b4 = p4.by_type.find((x) => x.type === b3.type);
    if (b4 && Math.abs(b3.spend - b4.spend) > 0.005) {
      console.log(`  DIFF  ${acct}.${b3.type}.spend: 3c=${b3.spend} 4=${b4.spend}`);
    }
    if (b4 && Math.abs((b3.pct_of_protein_spend ?? 0) - (b4.pct_of_protein_spend ?? 0)) > 0.05) {
      console.log(`  DIFF  ${acct}.${b3.type}.pct_of_protein_spend: 3c=${b3.pct_of_protein_spend} 4=${b4.pct_of_protein_spend}`);
    }
    if (b4 && Math.abs((b3.rows ?? 0) - (b4.rows ?? 0)) > 0) {
      console.log(`  DIFF  ${acct}.${b3.type}.rows: 3c=${b3.rows} 4=${b4.rows}`);
    }
  }
}

// Open workbook and check the Protein Mix sheet
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(WORKBOOK);
console.log(`\nWorkbook: ${wb.worksheets.length} sheets`);
for (const name of ["Weight & Coverage", "Protein Mix", "Item Master", "Phase 4 Recovery Log"]) {
  const s = wb.getWorksheet(name);
  console.log(`  ${name}: ${s ? `rows=${s.rowCount} cols=${s.columnCount}` : "MISSING"}`);
}

console.log("\nProtein Mix sheet sample (first 30 rows col 1-8):");
const pm = wb.getWorksheet("Protein Mix");
for (let r = 1; r <= Math.min(35, pm.rowCount); r++) {
  const row = pm.getRow(r);
  const vals = [];
  for (let c = 1; c <= 9; c++) {
    let v = row.getCell(c).value;
    if (typeof v === "object" && v?.result != null) v = v.result;
    if (typeof v === "number") v = Math.round(v * 100) / 100;
    vals.push(String(v ?? ""));
  }
  console.log(`  ${vals.slice(0, 9).map(v => v.slice(0, 26).padEnd(26)).join(" | ")}`);
}
