// scripts/_probe_fin2027_workbook_shape.mjs
//
// FIN-2027 W0 §5.9 probe. Read-only workbook shape audit.
// Prints labels, dates, and counts ONLY. Never prints dollar amounts.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_workbook_shape.mjs \
//     '<path/to/workbook1.xlsx>' '<path/to/workbook2.xlsx>' ...
//
// Per tab prints:
//   - row-1 title (A1)
//   - row-4 P1 date, row-4 P13 date, period-column span (1..13)
//   - leaf line codes parsed (REV_COGS fixed rows + SG&A row range)
//   - codes NOT in kpi_lines catalog
//   - whether the FY2026 fixed-row map holds (each REV_COGS row yields a parseable code)
//   - SG&A row span (first/last row in the range that yielded a parseable code)
//
// Constants borrowed from scripts/derive_pnl_actuals.mjs:
//   REV_COGS_ROWS = [21, 22, 25, 26, 29, 35, 36, 40, 41, 45, 46, 47, 51, 52, 53, 54]
//   SGA_ROW_RANGE = { first: 60, last: 97 }
//   periodBudgetCol(n) = 2 + (n-1)

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import path from "node:path";

const REV_COGS_ROWS = [21, 22, 25, 26, 29, 35, 36, 40, 41, 45, 46, 47, 51, 52, 53, 54];
const SGA_FIRST = 60;
const SGA_LAST = 97;

function parseLineCode(rawLabel, rowNo) {
  if (typeof rawLabel !== "string") {
    if (rawLabel && typeof rawLabel === "object" && "richText" in rawLabel) {
      rawLabel = rawLabel.richText.map((r) => r.text).join("");
    } else if (rawLabel != null) {
      rawLabel = String(rawLabel);
    } else {
      return null;
    }
  }
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (/^total\b/i.test(trimmed)) return null;
  const m = trimmed.match(/^(\d{4}(?:\.\d+)?)\s+/);
  if (!m) return null;
  const code = m[1];
  if (rowNo >= SGA_FIRST && !code.includes(".")) return null;
  return { code, label: trimmed };
}

function cellText(cell) {
  if (!cell) return "";
  const v = cell.value;
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
}

function cellDateOrText(cell) {
  if (!cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return cellText(cell);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node --env-file=.env.local scripts/_probe_fin2027_workbook_shape.mjs '<xlsx>' [...]");
  process.exit(1);
}
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`missing file: ${f}`);
    process.exit(1);
  }
}

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: catalog, error: catErr } = await supa.from("kpi_lines").select("line_code");
if (catErr) { console.error(catErr.message); process.exit(2); }
const KPI_LINES = new Set(catalog.map((r) => r.line_code));
console.log(`kpi_lines catalog loaded: ${KPI_LINES.size} codes`);
console.log("");

for (const f of files) {
  console.log("=".repeat(80));
  console.log(`FILE: ${path.basename(f)}`);
  console.log("=".repeat(80));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f);
  console.log(`  sheets total: ${wb.worksheets.length}`);
  console.log("");

  for (const ws of wb.worksheets) {
    const tabName = ws.name;
    const row1 = cellText(ws.getRow(1).getCell(1));
    const p1Date = cellDateOrText(ws.getRow(4).getCell(2));       // P1 budget col
    const p13Date = cellDateOrText(ws.getRow(4).getCell(14));      // P13 budget col
    const p1DateAlt = cellDateOrText(ws.getRow(4).getCell(1));     // some tabs may put date in col A

    // Count parseable codes in REV_COGS rows + SG&A block
    const codesFound = new Set();
    const revcogsHold = { hits: 0, misses: 0, missRows: [] };
    for (const r of REV_COGS_ROWS) {
      const label = ws.getRow(r).getCell(1).value;
      const p = parseLineCode(label, r);
      if (p) {
        codesFound.add(p.code);
        revcogsHold.hits += 1;
      } else {
        revcogsHold.misses += 1;
        revcogsHold.missRows.push({ row: r, label: (typeof label === "string" ? label : cellText(ws.getRow(r).getCell(1))).slice(0, 40) });
      }
    }

    let sgaFirst = null, sgaLast = null;
    for (let r = SGA_FIRST; r <= SGA_LAST; r += 1) {
      const label = ws.getRow(r).getCell(1).value;
      const p = parseLineCode(label, r);
      if (p) {
        if (sgaFirst === null) sgaFirst = r;
        sgaLast = r;
        codesFound.add(p.code);
      }
    }

    const unknown = [...codesFound].filter((c) => !KPI_LINES.has(c));

    // Skip empty tabs (nothing on row 1 and no codes)
    const isEmpty = !row1 && codesFound.size === 0;
    if (isEmpty) {
      console.log(`  [tab] ${tabName}  <empty>`);
      continue;
    }

    console.log(`  [tab] ${tabName}`);
    console.log(`    row1 title:     ${row1}`);
    console.log(`    row4 P1 col-B:  ${p1Date}   row4 P13 col-N: ${p13Date}`);
    if (p1DateAlt && p1DateAlt !== p1Date) console.log(`    row4 col-A:     ${p1DateAlt}`);
    console.log(`    leaf codes:     ${codesFound.size} (unique across REV/COGS + SGA)`);
    console.log(`    fixed-row map:  ${revcogsHold.hits}/16 REV/COGS rows parsed${revcogsHold.misses ? ` · misses: ${revcogsHold.missRows.map((m) => `r${m.row}[${m.label}]`).join(", ")}` : ""}`);
    console.log(`    sga row span:   ${sgaFirst === null ? "NONE" : `r${sgaFirst}..r${sgaLast}`}`);
    console.log(`    unknown codes:  ${unknown.length}${unknown.length ? ` [${unknown.join(", ")}]` : ""}`);
    console.log("");
  }
}
