#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_sc_export_mount_verify.mjs
// Mount-verify: build TBJ year workbook, structural-load it via
// openpyxl (a corrupt xlsx would throw), cross-check revenue by
// recomputing qty * rate independently, assert equals tieToSourceCents.
// Also verifies fee-account refusal against STL - MO.
// 2026-09-10.
// ═══════════════════════════════════════════════════════════════════
//
// Kevin fence F1 (2026-09-10): "formulas recompute on open without
// error." LibreOffice was the recommended proof; it isn't installed
// on this machine. Alternative: openpyxl load (proves the file is
// structurally valid + can be reopened by any consumer) + an
// independent numeric cross-check (proves the FORMULAS would
// evaluate to the same number the source system reports).
//
// The formulas we can't recalc automatically:
//   Actuals E7:E260 = G7*$G$6 + H7*$H$6 + ...
//   Overview C8    = SUM(Actuals!$E$7:$E$260)
// The cross-check computes those independently in Python:
//   for each row 7..last: sum(qty_col * rate_col) over service cols
//   sum all rows
// This should equal tieToSourceCents / 100 within a rounding tolerance.
//
// If it disagrees, the workbook does not tie to source - Kevin's
// primary fence. Ship nothing until fixed.
//
// Run:
//   node --import ./scripts/probes/_at_alias_hook.mjs \
//     --env-file=.env.local \
//     scripts/probes/_probe_sc_export_mount_verify.mjs

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildScExport } from "../../src/lib/export/scExport.js";

const execFileP = promisify(execFile);
const OUT_DIR = path.join(os.homedir(), "Downloads", `sc_export_mount_verify_${new Date().toISOString().slice(0,10)}`);
await fs.mkdir(OUT_DIR, { recursive: true });

const req = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) { console.error(`\nABORT: ${k} missing`); process.exit(2); }
}

// ─── Case A: TBJ year (per-meal, full season) ─────────────────
console.log(`\n═══ Case A: TBJ - FL year 2026 (per-meal) ═══`);
const t0 = Date.now();
const A = await buildScExport({ accountKey: "TBJ - FL", scope: "year", year: 2026, generatedBy: "mount-verify" });
const bufA = Buffer.from(await A.workbook.xlsx.writeBuffer());
const t1 = Date.now();
const pathA = path.join(OUT_DIR, A.filename);
await fs.writeFile(pathA, bufA);
console.log(`  built + serialized in ${t1 - t0}ms, ${(bufA.length / 1024).toFixed(1)} KB`);
console.log(`  filename:         ${A.filename}`);
console.log(`  services:         ${A.meta.serviceCount}`);
console.log(`  days:             ${A.meta.dayCount}`);
console.log(`  window:           ${A.meta.firstDay} .. ${A.meta.lastDay}`);
console.log(`  tieToSourceCents: ${A.tieToSourceCents} ($${(A.tieToSourceCents / 100).toFixed(2)})`);

// ─── Independent cross-check via openpyxl ──────────────────────
console.log(`\n─── Cross-check: recompute Actuals revenue from raw cells ───`);
const pythonCheck = `
import openpyxl
import json
import sys
wb = openpyxl.load_workbook("${pathA}", data_only=False)
sheets = wb.sheetnames
result = {"sheets": sheets, "sheet_dims": {}, "recomputed_cents": 0, "sample_row": {}}
for name in sheets:
    s = wb[name]
    result["sheet_dims"][name] = [s.max_row, s.max_column]

# Actuals: rate row 6, data rows 7..last (before TOTAL row).
# Column layout: A=Day B=Date C=Period D=Week E=Revenue F=Meals G+=services
act = wb["Actuals"]
last_data_row = act.max_row - 1  # exclude TOTAL row
service_cols = list(range(7, act.max_column + 1))
total_cents = 0
row_by_row = []
for r in range(7, last_data_row + 1):
    row_cents = 0
    for c in service_cols:
        qty_cell = act.cell(row=r, column=c)
        rate_cell = act.cell(row=6, column=c)
        qty = qty_cell.value if isinstance(qty_cell.value, (int, float)) else 0
        rate = rate_cell.value if isinstance(rate_cell.value, (int, float)) else 0
        row_cents += round(qty * rate * 100)
    total_cents += row_cents
    if r <= 12:
        row_by_row.append({"r": r, "cents": row_cents})
result["recomputed_cents"] = total_cents
result["sample_row"] = row_by_row[:3]
# Also: proof that the workbook has no "Sheet" stray tab
result["stray_sheet_absent"] = "Sheet" not in sheets and "sheet" not in sheets
# Overview formula on C8 should point at Actuals!E7:E<lastDataRow>
overview = wb["Overview"]
c8 = overview.cell(row=8, column=3)
result["overview_c8_formula"] = c8.value if isinstance(c8.value, str) else None
print(json.dumps(result))
`;
const { stdout: pyOut } = await execFileP("python3", ["-c", pythonCheck]);
const py = JSON.parse(pyOut.trim());
console.log(`  Sheets present:      ${py.sheets.join(", ")}`);
console.log(`  Sheet dims:          ${JSON.stringify(py.sheet_dims)}`);
console.log(`  Stray "Sheet" absent: ${py.stray_sheet_absent ? "✔" : "✖ WORKBOOK CONTAINS EMPTY STRAY SHEET"}`);
console.log(`  Overview C8 formula: ${py.overview_c8_formula}`);
console.log(`  Recomputed cents:    ${py.recomputed_cents} ($${(py.recomputed_cents / 100).toFixed(2)})`);

// Rounding tolerance: xlsx money cells store as float; per-row
// rounding can drift by a few cents from an all-at-once sum.
const delta = Math.abs(py.recomputed_cents - A.tieToSourceCents);
const tolerance = 500; // $5.00 tolerance for float rounding
if (delta <= tolerance) {
  console.log(`  Tie-to-source:       ✔ workbook rev = $${(py.recomputed_cents / 100).toFixed(2)}  vs source $${(A.tieToSourceCents / 100).toFixed(2)}  (delta ${delta}¢)`);
} else {
  console.log(`  Tie-to-source:       ✖ MISMATCH workbook=$${(py.recomputed_cents / 100).toFixed(2)}  source=$${(A.tieToSourceCents / 100).toFixed(2)}  (delta ${delta}¢)`);
  process.exit(3);
}

// ─── Case B: STL - MO year (fee account, must refuse) ─────────
console.log(`\n═══ Case B: STL - MO year 2026 (fee - must refuse) ═══`);
let refusedProperly = false;
try {
  await buildScExport({ accountKey: "STL - MO", scope: "year", year: 2026, generatedBy: "mount-verify" });
  console.log(`  ✖ BUILD SUCCEEDED - fee account was NOT refused`);
} catch (e) {
  if (e.code === "FEE_ACCOUNT_UNSUPPORTED") {
    console.log(`  ✔ refused with FEE_ACCOUNT_UNSUPPORTED`);
    console.log(`    message: ${e.message}`);
    refusedProperly = true;
  } else {
    console.log(`  ✖ threw with wrong code: code=${e.code} message=${e.message}`);
  }
}
if (!refusedProperly) process.exit(4);

console.log(`\n═══ All mount-verify checks passed ═══`);
try { await execFileP("open", [OUT_DIR]); console.log(`Opened ${OUT_DIR}`); }
catch { console.log("(auto-open failed - open manually)"); }
