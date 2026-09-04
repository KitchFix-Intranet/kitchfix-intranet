#!/usr/bin/env node
// scripts/load_cost_allocations.mjs
//
// Kevin R-72 (2026-09-04): load corporate cost allocations into the
// `cost_allocations` Postgres table. Real costs finance posts
// straight to the P&L that never appear in bill.com or Rippling.
//
// Source: JSON file with a rows[] array of allocation records:
//   {
//     "source_ref": "finance FY26 P8 vehicle insurance close",
//     "rows": [
//       {"account_key":"TBJ - FL","fiscal_year":2026,"period_no":1,"gl_line_code":"3500.2","amount":542.05},
//       {"account_key":"TBJ - FL","fiscal_year":2026,"period_no":2,"gl_line_code":"3500.2","amount":658.20},
//       ...
//     ]
//   }
//
// Idempotent upsert on (account_key, fiscal_year, period_no,
// gl_line_code). Re-uploading a period replaces the amount.
//
// USAGE
//   node --env-file=.env.local scripts/load_cost_allocations.mjs \
//     --input=docs/allocations/fy26-vehicle-insurance.json
//   node --env-file=.env.local scripts/load_cost_allocations.mjs \
//     --input=... --dry-run
//
// Exit codes:
//   0  success (or dry-run success)
//   1  configuration error
//   2  load error mid-run

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = { input: null, dryRun: false };
for (const x of process.argv.slice(2)) {
  if      (x.startsWith("--input="))  args.input = x.slice(8);
  else if (x === "--dry-run")         args.dryRun = true;
  else { console.error(`unknown arg: ${x}`); process.exit(1); }
}
if (!args.input) { console.error("--input=<path.json> required"); process.exit(1); }

const raw = readFileSync(args.input, "utf-8");
let doc;
try { doc = JSON.parse(raw); } catch (e) { console.error(`invalid JSON: ${e.message}`); process.exit(1); }
if (!doc || typeof doc !== "object" || !Array.isArray(doc.rows)) {
  console.error(`JSON must have a top-level "rows" array`);
  process.exit(1);
}
const source_ref = String(doc.source_ref || args.input);
console.log(`# cost_allocations loader · ${new Date().toISOString()}`);
console.log(`  input:      ${args.input}`);
console.log(`  source_ref: ${source_ref}`);
console.log(`  rows:       ${doc.rows.length}`);
console.log(`  dry-run:    ${args.dryRun}`);

// Validate every row before touching the DB.
const errors = [];
const rows = doc.rows.map((r, i) => {
  const req = ["account_key", "fiscal_year", "period_no", "gl_line_code", "amount"];
  for (const k of req) {
    if (r[k] == null || r[k] === "") errors.push(`row ${i}: missing ${k}`);
  }
  const fy = Number(r.fiscal_year);
  const p = Number(r.period_no);
  const amt = Number(r.amount);
  if (!Number.isFinite(fy)) errors.push(`row ${i}: fiscal_year not numeric: ${r.fiscal_year}`);
  if (!Number.isFinite(p) || p < 1 || p > 13) errors.push(`row ${i}: period_no ${r.period_no} not in 1..13`);
  if (!Number.isFinite(amt)) errors.push(`row ${i}: amount not numeric: ${r.amount}`);
  return {
    account_key:  String(r.account_key),
    fiscal_year:  fy,
    period_no:    p,
    gl_line_code: String(r.gl_line_code),
    amount:       Math.round(amt * 100) / 100,
    source_ref,
  };
});
if (errors.length > 0) {
  console.error(`validation failed with ${errors.length} error(s):`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
}

if (args.dryRun) {
  console.log(`\n[DRY RUN] would upsert ${rows.length} rows. Sample:`);
  for (const r of rows.slice(0, 5)) console.log(`  ${JSON.stringify(r)}`);
  process.exit(0);
}

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error(`SUPABASE_URL: ${SB_URL ? "PRESENT" : "ABSENT"}  SERVICE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
  process.exit(1);
}
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Chunked upsert to stay within PostgREST payload limits.
const CHUNK = 500;
let upserted = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const q = await supa
    .from("cost_allocations")
    .upsert(chunk, { onConflict: "account_key,fiscal_year,period_no,gl_line_code" });
  if (q.error) {
    console.error(`upsert chunk ${i}..${i + chunk.length} FAILED: ${q.error.message}`);
    process.exit(2);
  }
  upserted += chunk.length;
}
console.log(`UPSERTED ${upserted} rows.`);
process.exit(0);
