#!/usr/bin/env node
// PR-U: restore TBR - FL / Minor League Breakfast + Lunch projections.
//
// Context: Batch 2 (2026-09-02) deleted 714 sc_daily_projections rows on
// the two archived ST twins under an unverified assumption that the non-ST
// services carried duplicate projections. They did not. The delete removed
// TBR's entire MiLB Breakfast + Lunch projection series (259 non-zero
// dates 2026-01-19..2026-11-20, sum 33,615 each, including 64 forward-
// looking dates from today Kevin needs for training-week planning).
//
// Kevin fixed the workbook: on 2026-09-02 11:32 CDT he renamed
// Projections TBR-2026 headers Y2 "Breakfast - MiLB" (was ST) at price
// 17.8275, and AA2 "Lunch - MiLB" (was ST) at price 21.675. Both point
// at the live catalog non-ST service ids. Future imports feed one
// service per column and stop recreating twins.
//
// This script restores the projections by reading Y and AA from the
// pinned workbook and INSERTing against the non-ST service ids.
//
// FENCES (binding):
//   Writes are LIMITED to sc_daily_projections INSERTs for exactly two
//   service ids:
//     1318c319-1844-410a-ace5-8f8812eebd23  Breakfast - MiLB
//     1c62040d-b56c-4660-9b72-6e58b0554865  Lunch - MiLB
//   No schema changes, no actuals, no prices, no services. No DELETEs.
//   Hash gate on tbr-fl-sc-2026-v5.xlsx = 540b9b78... at startup.
//   Pre-write halt: if either target service_id already carries any
//   sc_daily_projections row, HALT (means something repopulated
//   between recon and execution).
//   created_by = 'spreadsheet_seed' (matches the arc's provenance).
//
// Two-step contract:
//   default   = dry-run (parse, print per-month non-zero counts + first
//               and last 5 dated values per service, halt)
//   --write   = separate invocation after Kevin's explicit go

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT = {
  path: path.join(__dirname, "inputs", "tbr-fl-sc-2026-v5.xlsx"),
  sha256: "540b9b7839c385a1dc1d1aa615251fcab1ba47b5d6f66734e4dbed55f1820fc5",
};

const WRITE = process.argv.includes("--write");
const CREATED_BY = "spreadsheet_seed";

const SHEET = "Projections TBR-2026";
const HEADER_ROWS = 2;
const DATE_COL = "B";

const COLUMNS = [
  {
    letter: "Y",
    service_id: "1318c319-1844-410a-ace5-8f8812eebd23",
    label: "Breakfast - MiLB",
  },
  {
    letter: "AA",
    service_id: "1c62040d-b56c-4660-9b72-6e58b0554865",
    label: "Lunch - MiLB",
  },
];

const ACCOUNT_KEY = "TBR - FL";

function colLetterToNum(letters) {
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function sha256(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function unwrapCell(v) {
  if (v && typeof v === "object" && "result" in v) return v.result;
  return v;
}

function toIntCount(v, ref) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Non-finite at ${ref}: ${v}`);
    return Math.round(v);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return 0;
    const n = Number(s.replace(/[,$]/g, ""));
    if (Number.isFinite(n)) return Math.round(n);
    throw new Error(`Non-numeric at ${ref}: ${JSON.stringify(v)}`);
  }
  throw new Error(`Unexpected cell type at ${ref}: ${JSON.stringify(v)}`);
}

function pgClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function parseColumns(filepath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filepath);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Sheet not found: ${SHEET}`);
  const dc = colLetterToNum(DATE_COL);
  const perService = new Map();
  for (const col of COLUMNS) perService.set(col.service_id, []);

  ws.eachRow((row, rowNum) => {
    if (rowNum <= HEADER_ROWS) return;
    const dateVal = unwrapCell(row.getCell(dc).value);
    let iso = null;
    if (dateVal instanceof Date) iso = isoDate(dateVal);
    else if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) iso = dateVal.slice(0, 10);
    if (!iso) return;

    for (const col of COLUMNS) {
      const cn = colLetterToNum(col.letter);
      const raw = unwrapCell(row.getCell(cn).value);
      const ref = `${SHEET}!${col.letter}${rowNum}`;
      const val = toIntCount(raw, ref);
      perService.get(col.service_id).push({
        service_date: iso,
        projected_count: val,
        _cellRef: ref,
      });
    }
  });
  return perService;
}

function reportSpan(label, rows) {
  const nonZero = rows.filter((r) => r.projected_count !== 0);
  console.log(`\n=== ${label} ===`);
  console.log(`  total date rows:      ${rows.length}`);
  console.log(`  non-zero date rows:   ${nonZero.length}`);
  if (nonZero.length > 0) {
    console.log(`  non-zero span:        ${nonZero[0].service_date} .. ${nonZero[nonZero.length - 1].service_date}`);
    console.log(`  sum:                  ${nonZero.reduce((s, r) => s + r.projected_count, 0)}`);
  }
  console.log(`  full span:            ${rows[0]?.service_date} .. ${rows[rows.length - 1]?.service_date}`);

  const perMonth = {};
  for (const r of nonZero) {
    const ym = r.service_date.slice(0, 7);
    perMonth[ym] = (perMonth[ym] || 0) + 1;
  }
  console.log(`  per-month non-zero counts:`);
  for (const ym of Object.keys(perMonth).sort()) {
    console.log(`    ${ym}   ${String(perMonth[ym]).padStart(3)}`);
  }

  console.log(`  first 5 dated values (non-zero only):`);
  for (const r of nonZero.slice(0, 5)) {
    console.log(`    ${r.service_date}  =  ${r.projected_count}   (${r._cellRef})`);
  }
  console.log(`  last  5 dated values (non-zero only):`);
  for (const r of nonZero.slice(-5)) {
    console.log(`    ${r.service_date}  =  ${r.projected_count}   (${r._cellRef})`);
  }
}

async function preflightCheckEmpty(supa) {
  console.log(`\n=== Preflight: both target service_ids must hold 0 projection rows ===`);
  for (const col of COLUMNS) {
    const { count, error } = await supa
      .from("sc_daily_projections")
      .select("id", { count: "exact", head: true })
      .eq("service_id", col.service_id);
    if (error) throw new Error(`preflight ${col.label}: ${error.message}`);
    console.log(`  ${col.label.padEnd(18)}  existing rows = ${count}   (${col.service_id})`);
    if (count !== 0) {
      throw new Error(`PRE-WRITE HALT: ${col.label} already has ${count} projection rows. Something repopulated between recon and now - investigate before writing.`);
    }
  }
}

async function insertRows(supa, perService) {
  console.log(`\n=== Write ===`);
  const CHUNK = 500;
  for (const col of COLUMNS) {
    const rows = perService.get(col.service_id).map((r) => ({
      account_key:      ACCOUNT_KEY,
      service_id:       col.service_id,
      service_date:     r.service_date,
      projected_count:  r.projected_count,
      created_by:       CREATED_BY,
    }));
    console.log(`  ${col.label}: inserting ${rows.length} rows...`);
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supa.from("sc_daily_projections").insert(chunk);
      if (error) throw new Error(`INSERT ${col.label} chunk ${i}: ${error.message}`);
      inserted += chunk.length;
    }
    console.log(`  ${col.label}: inserted ${inserted}`);
  }
}

async function postWriteCheck(supa, perService) {
  console.log(`\n=== Post-write verify ===`);
  for (const col of COLUMNS) {
    const expected = perService.get(col.service_id);
    const expectedTotal = expected.reduce((s, r) => s + r.projected_count, 0);
    const { count, error } = await supa
      .from("sc_daily_projections")
      .select("id", { count: "exact", head: true })
      .eq("service_id", col.service_id);
    if (error) throw error;
    console.log(`  ${col.label}: db_rows=${count}  expected=${expected.length}   ${count === expected.length ? "MATCH" : "MISMATCH"}`);

    // Sum from DB for a numeric cross-check. Paginate above 1000.
    const PAGE = 1000;
    let from = 0;
    let dbSum = 0;
    while (true) {
      const { data, error: rowErr } = await supa
        .from("sc_daily_projections")
        .select("projected_count")
        .eq("service_id", col.service_id)
        .range(from, from + PAGE - 1);
      if (rowErr) throw rowErr;
      if (!data || data.length === 0) break;
      for (const r of data) dbSum += Number(r.projected_count);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    console.log(`  ${col.label}: db_sum=${dbSum}  expected_sum=${expectedTotal}   ${dbSum === expectedTotal ? "MATCH" : "MISMATCH"}`);
  }
}

async function main() {
  console.log(`PR-U TBR MiLB Bfst/Lunch projection restore  mode=${WRITE ? "WRITE" : "DRY-RUN"}  at ${new Date().toISOString()}`);

  // S1: hash gate.
  console.log(`\n=== S1: file integrity ===`);
  if (!fs.existsSync(INPUT.path)) throw new Error(`INPUT MISSING: ${INPUT.path}`);
  const actualSha = sha256(INPUT.path);
  if (actualSha !== INPUT.sha256) {
    throw new Error(`SHA256 MISMATCH\n  file:     ${INPUT.path}\n  expected: ${INPUT.sha256}\n  actual:   ${actualSha}`);
  }
  console.log(`  TBR  ${actualSha}  OK  ${path.basename(INPUT.path)}`);

  // Parse.
  console.log(`\n=== parsing workbook ===`);
  const perService = await parseColumns(INPUT.path);
  for (const col of COLUMNS) {
    reportSpan(`${col.label} (col ${col.letter} -> ${col.service_id})`, perService.get(col.service_id));
  }

  if (!WRITE) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`DRY-RUN COMPLETE`);
    console.log(`Row shape: { account_key='TBR - FL', service_id, service_date,`);
    console.log(`             projected_count, created_by='${CREATED_BY}' }`);
    console.log(`To write: re-run with --write after Kevin's explicit go.`);
    console.log(`${"=".repeat(70)}`);
    return;
  }

  const supa = pgClient();
  await preflightCheckEmpty(supa);
  await insertRows(supa, perService);
  await postWriteCheck(supa, perService);
  console.log(`\nRESTORE COMPLETE.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\nFATAL: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
