// TXR - TX - H deep dive - extract TXR-HOME from both file A + file B,
// compare (in case B has an update), then emit B as the authoritative
// source. Same row/column formula the prior P&L recon audit verified:
//   Row 35 = "    3100.1 Hourly Kitchen Labor Wages"
//   Row 36 = "    3100.2 Salary Kitchen Wages"
//   Period N: Budget col = 17 + 14*(N-1)
//             Actual col = 19 + 14*(N-1)

import ExcelJS from "exceljs";

const A = "/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)A.xlsx";
const B = "/Users/kevinfietek/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx";

const ROW_HOURLY = 35;
const ROW_SALARY = 36;
function bcol(p) { return 17 + 14 * (p - 1); }
function acol(p) { return 19 + 14 * (p - 1); }

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

async function extract(filepath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filepath);
  const ws = wb.getWorksheet("TXR-HOME");
  if (!ws) throw new Error(`TXR-HOME missing in ${filepath}`);
  // Verify row labels still match
  const hLabel = ws.getRow(ROW_HOURLY).getCell(1).value;
  const sLabel = ws.getRow(ROW_SALARY).getCell(1).value;
  const hOk = typeof hLabel === "string" && hLabel.includes("3100.1");
  const sOk = typeof sLabel === "string" && sLabel.includes("3100.2");
  if (!hOk || !sOk) throw new Error(`row labels moved: R${ROW_HOURLY}=${JSON.stringify(hLabel)} R${ROW_SALARY}=${JSON.stringify(sLabel)}`);
  const per = {};
  for (let p = 1; p <= 8; p++) {
    per[`P${p}`] = {
      hourly_budget: readNumeric(ws.getRow(ROW_HOURLY).getCell(bcol(p))),
      hourly_actual: readNumeric(ws.getRow(ROW_HOURLY).getCell(acol(p))),
      salary_budget: readNumeric(ws.getRow(ROW_SALARY).getCell(bcol(p))),
      salary_actual: readNumeric(ws.getRow(ROW_SALARY).getCell(acol(p))),
    };
  }
  return { labels: { hourly: hLabel, salary: sLabel }, periods: per };
}

const a = await extract(A);
const b = await extract(B);

console.log(JSON.stringify({
  file_A: { path: A, ...a },
  file_B: { path: B, ...b },
}, null, 2));

// Diff summary - which periods (if any) drifted between A and B.
console.log("\n--- A vs B diff (any period where a value differs by > $0.01) ---");
let anyDrift = false;
for (let p = 1; p <= 8; p++) {
  const pk = `P${p}`;
  const aRow = a.periods[pk];
  const bRow = b.periods[pk];
  for (const k of ["hourly_budget", "hourly_actual", "salary_budget", "salary_actual"]) {
    const av = aRow[k];
    const bv = bRow[k];
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull !== bNull || (!aNull && Math.abs(av - bv) > 0.01)) {
      console.log(`  ${pk} ${k}: A=${av} B=${bv} delta=${(bv ?? 0) - (av ?? 0)}`);
      anyDrift = true;
    }
  }
}
if (!anyDrift) console.log("  (no drift between A and B on TXR-HOME P1-P8)");
