#!/usr/bin/env node
// FIN-2027 W5 · FY2024 CORP load · Option B refined (Kevin ruling 2026-09-23).
//
// Loads 6 rows to pnl_actuals + 1 row to pnl_reconciliation_exceptions.
// Every value taken from a source cell in Kevin's workbook.
//
// Source values live OUTSIDE this repo, in a local reference file:
//   ~/Downloads/kf-fin2027-w5-fy2024-corp-source.json
//   (or override via FIN2027_W5_FY24_CORP_SOURCE=/path/to/file.json)
//
// This repo is public. Standing rule (Kevin, 2026-09-23): no dollar
// figures in the tree - counts, dates, PASS/FAIL only. Dollars live
// in chat, in the local workbook, and in gitignored reference files.
//
// Usage:
//   node --env-file=.env.local scripts/fin2027_w5_fy2024_corp.mjs [--execute]

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const execute = process.argv.includes("--execute");

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SOURCE_PATH = process.env.FIN2027_W5_FY24_CORP_SOURCE
  || path.join(homedir(), "Downloads", "kf-fin2027-w5-fy2024-corp-source.json");

if (!fs.existsSync(SOURCE_PATH)) {
  console.error(`ABORT · source reference file not found at ${SOURCE_PATH}`);
  console.error(`  set FIN2027_W5_FY24_CORP_SOURCE or restore the local file per FIN-2027 W5 brief.`);
  process.exit(2);
}
const SRC = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf-8"));

const BOOK = SRC.workbook;
const NOW  = "2026-09-23T00:00:00+00:00";
const BY   = "loader:fin2027_w5_fy2024_corp_2026-09-23";
const ROWS = SRC.rows;
const EXPECTED_TOTAL = SRC.expected_total;
const EXCEPTION_SRC = SRC.exception;

const TOTAL = ROWS.reduce((s, r) => s + r.actual, 0);
console.log(`FY2024 CORP · ${ROWS.length} rows loaded from reference · ${SOURCE_PATH}`);
console.log(`  row-sum matches expected_total: ${Math.abs(TOTAL - EXPECTED_TOTAL) < 0.005 ? "PASS" : "FAIL"}`);
for (const r of ROWS) {
  console.log(`  CORP · FY2024 · P${String(r.period_no).padStart(2)} · ${r.line_code} · ${r.src}`);
}
console.log();

const EXCEPTION = {
  account_key: EXCEPTION_SRC.account_key,
  fiscal_year: EXCEPTION_SRC.fiscal_year,
  line_code: EXCEPTION_SRC.line_code,
  anchor_a: EXCEPTION_SRC.anchor_a,
  anchor_b: EXCEPTION_SRC.anchor_b,
  delta: EXCEPTION_SRC.delta,
  note: EXCEPTION_SRC.note_template,
};
console.log("pnl_reconciliation_exceptions entry:");
console.log(`  account_key=${EXCEPTION.account_key}  fiscal_year=${EXCEPTION.fiscal_year}  line_code=${EXCEPTION.line_code}`);
console.log(`  anchor/delta values elided (see reference file)`);
console.log();

if (!execute) {
  console.log("(dry-run) · re-run with --execute to write");
  process.exit(0);
}

// Execute
console.log("EXECUTING...");
const rowsForInsert = ROWS.map(r => ({
  account_key: "CORP",
  fiscal_year: 2024,
  period_no: r.period_no,
  line_code: r.line_code,
  budget: 0,
  actual: Math.round(r.actual * 100) / 100,
  source_ref: `${BOOK}#${r.src}`,
  verified_at: NOW,
  verified_by: BY,
}));

const w1 = await s.from("pnl_actuals").upsert(rowsForInsert, {
  onConflict: "account_key,fiscal_year,period_no,line_code",
  ignoreDuplicates: false,
});
if (w1.error) { console.error("pnl_actuals write failed:", w1.error.message); process.exit(3); }
console.log(`  OK · pnl_actuals: wrote ${rowsForInsert.length} rows`);

const w2 = await s.from("pnl_reconciliation_exceptions").insert([EXCEPTION]);
if (w2.error) { console.error("exception write failed:", w2.error.message); process.exit(3); }
console.log(`  OK · pnl_reconciliation_exceptions: wrote 1 row`);

// Post-write verification (row counts only; values elided)
const v1 = await s.from("pnl_actuals").select("period_no, line_code").eq("account_key", "CORP").eq("fiscal_year", 2024).order("period_no");
console.log(`\npost-write · CORP FY2024 pnl_actuals rows: ${v1.data.length}`);
for (const r of v1.data) console.log(`    P${String(r.period_no).padStart(2)}  ${r.line_code}`);

const v2 = await s.from("pnl_reconciliation_exceptions").select("id").eq("account_key","CORP").eq("fiscal_year",2024);
console.log(`\npost-write · pnl_reconciliation_exceptions rows for CORP/FY2024: ${v2.data.length}`);
