// Read filled OPEN_QUESTIONS.xlsx (Kevin's answers) and dump as JSON.
import ExcelJS from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/node_modules/exceljs/excel.js";
import { writeFileSync } from "node:fs";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/OPEN_QUESTIONS.xlsx");

const out = { questions: [], pack_weights: [] };

const wsQ = wb.getWorksheet("Questions");
wsQ.eachRow({ includeEmpty: false }, (row, rn) => {
  if (rn === 1) return;
  const rec = {
    num: row.getCell(1).value,
    tier: row.getCell(2).value,
    q: row.getCell(3).value,
    ex: row.getCell(4).value,
    assumed: row.getCell(5).value,
    rows: row.getCell(6).value,
    dollars: row.getCell(7).value,
    unlocks: row.getCell(8).value,
    answer: row.getCell(9).value,
    notes: row.getCell(10).value,
  };
  // Normalize richtext cells
  for (const k of ["q","ex","assumed","unlocks","answer","notes"]) {
    const v = rec[k];
    if (v && typeof v === "object" && Array.isArray(v.richText)) {
      rec[k] = v.richText.map(t => t.text).join("");
    }
  }
  out.questions.push(rec);
});

const wsP = wb.getWorksheet("Pack Weights");
wsP.eachRow({ includeEmpty: false }, (row, rn) => {
  if (rn === 1) return;
  const rec = {
    vendor: row.getCell(1).value,
    item_number: row.getCell(2).value,
    description: row.getCell(3).value,
    pack_as_printed: row.getCell(4).value,
    rows: row.getCell(5).value,
    spend: row.getCell(6).value,
    guess: row.getCell(7).value,
    case_weight_lb: row.getCell(8).value,
    notes: row.getCell(9).value,
  };
  for (const k of ["vendor","description","pack_as_printed","guess","notes"]) {
    const v = rec[k];
    if (v && typeof v === "object" && Array.isArray(v.richText)) {
      rec[k] = v.richText.map(t => t.text).join("");
    }
  }
  out.pack_weights.push(rec);
});

writeFileSync(
  "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_open_questions.json",
  JSON.stringify(out, null, 2)
);
console.log(`Questions: ${out.questions.length}`);
console.log(`Pack Weights: ${out.pack_weights.length}`);
console.log("\n===== KEVIN'S ANSWERS =====");
for (const q of out.questions) {
  const ans = (q.answer || "").toString().trim();
  const notes = (q.notes || "").toString().trim();
  console.log(`\n#${q.num} T${q.tier} (${q.rows} rows / $${q.dollars})`);
  console.log(`  Q: ${(q.q||"").toString().slice(0,140)}`);
  console.log(`  ANSWER: ${ans || "(blank)"}`);
  if (notes) console.log(`  NOTES: ${notes}`);
}
console.log("\n===== KEVIN'S PACK WEIGHTS =====");
for (const r of out.pack_weights) {
  const cw = r.case_weight_lb;
  console.log(`${r.vendor} | ${r.item_number} | ${(r.description||"").toString().slice(0,60)} | pack=${r.pack_as_printed} | wt=${cw ?? "(blank)"} | notes=${(r.notes||"").toString().slice(0,80)}`);
}
