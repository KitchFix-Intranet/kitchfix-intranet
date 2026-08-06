// scripts/derive_labor_actuals.mjs
//
// CLI wrapper for src/lib/labor/deriveActuals.js. Runs the derivation
// and writes labor_actuals + labor_unattributed. Read-only against
// Rippling (never calls the API - Postgres only).
//
// CLI:
//   node --env-file=.env.local scripts/derive_labor_actuals.mjs [--source=manual]
//
// --source is stamped on every derived row as source_run's prefix so
// the origin of any run is queryable later. Defaults to 'manual'.
//
// Exit codes:
//   0  derivation completed and rows written
//   1  configuration error
//   2  derivation or write failed

import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { deriveLaborActuals } from "../src/lib/labor/deriveActuals.js";

const args = { source: "manual", dryRun: false };
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--source=")) args.source = a.slice("--source=".length);
  else if (a === "--dry-run") args.dryRun = true;
  else { console.error("unknown arg: " + a); process.exit(1); }
}

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const startedAt = new Date();
const sourceRun = `${args.source}:host=${os.hostname()}:pid=${process.pid}:${startedAt.toISOString()}`;
console.log(`derive_labor_actuals source=${args.source} dryRun=${args.dryRun}`);
console.log(`  source_run: ${sourceRun}`);
console.log(`  started_at: ${startedAt.toISOString()}`);
console.log("");

const t0 = Date.now();
let result;
try {
  result = await deriveLaborActuals({
    supa,
    sourceRun,
    log: (msg) => process.stderr.write(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}\n`),
  });
} catch (err) {
  console.error("derivation failed:", err.message);
  console.error(err.stack);
  process.exit(2);
}

const derivedSec = ((Date.now() - t0) / 1000).toFixed(1);
console.log("");
console.log("derivation stats:");
for (const [k, v] of Object.entries(result.stats)) {
  console.log(`  ${k}: ${Array.isArray(v) ? v.length + " (" + v.slice(0, 3).join(", ") + (v.length > 3 ? ", ..." : "") + ")" : v}`);
}
console.log(`  actuals_rows: ${result.actuals.length}`);
console.log(`  unattributed_rows: ${result.unattributed.length}`);
console.log(`  derivation duration: ${derivedSec}s`);

// Per-account breakdown - a single account dropping to zero is visible
// in a per-account line and invisible in a total.
const perAccount = new Map();
for (const a of result.actuals) {
  const acct = a.account_key;
  if (!perAccount.has(acct)) perAccount.set(acct, { rows: 0, workers: new Set(), weeks: new Set(), amount: 0, hours_reg: 0, hours_ot: 0 });
  const b = perAccount.get(acct);
  b.rows++;
  b.workers.add(a.worker_id);
  b.weeks.add(a.week_label);
  b.amount += Number(a.amount || 0);
  b.hours_reg += Number(a.hours_regular || 0);
  b.hours_ot += Number(a.hours_overtime || 0);
}
console.log("");
console.log("per-account summary:");
console.log("  account         rows  workers  weeks  reg_hrs    ot_hrs     dollars");
for (const [acct, b] of [...perAccount.entries()].sort()) {
  const w = String(b.workers.size).padStart(3);
  const wk = String(b.weeks.size).padStart(3);
  console.log(`  ${acct.padEnd(14)}  ${String(b.rows).padStart(4)}  ${w}      ${wk}    ${b.hours_reg.toFixed(2).padStart(9)}  ${b.hours_ot.toFixed(2).padStart(9)}  $${b.amount.toFixed(2).padStart(12)}`);
}

// Unattributed breakdown by reason
if (result.unattributed.length) {
  const byReason = new Map();
  for (const u of result.unattributed) {
    if (!byReason.has(u.reason_code)) byReason.set(u.reason_code, { rows: 0, amount: 0, depts: new Set() });
    const b = byReason.get(u.reason_code);
    b.rows++;
    b.amount += Number(u.amount || 0);
    if (u.department_id) b.depts.add(u.department_id + " (" + (u.department_name || "?") + ")");
  }
  console.log("");
  console.log("unattributed by reason (playbook N5 - always visible, never silent):");
  for (const [reason, b] of byReason) {
    console.log(`  ${reason.padEnd(24)} rows=${b.rows}  dollars=$${b.amount.toFixed(2)}  distinct_depts=${b.depts.size}`);
    for (const d of [...b.depts].slice(0, 5)) console.log(`    ${d}`);
  }
}

console.log("");

if (args.dryRun) {
  console.log("dry-run: skipping DB writes");
  process.exit(0);
}

// ─── Write ─────────────────────────────────────────────────────────
const CHUNK = 500;
const w0 = Date.now();

async function chunkedInsert(table, rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error, data } = await supa.from(table).insert(slice).select("id");
    if (error) {
      console.error(`${table} insert chunk ${i / CHUNK + 1} FAILED: ${error.message}`);
      throw new Error(error.message);
    }
    written += data?.length || 0;
    process.stderr.write(`  ${table} chunk ${i / CHUNK + 1}: ${written} rows written\r`);
  }
  process.stderr.write("\n");
  return written;
}

try {
  const actualsWritten = await chunkedInsert("labor_actuals", result.actuals);
  const unattrWritten = result.unattributed.length ? await chunkedInsert("labor_unattributed", result.unattributed) : 0;
  const writeSec = ((Date.now() - w0) / 1000).toFixed(1);
  console.log("");
  console.log(`labor_actuals written: ${actualsWritten}`);
  console.log(`labor_unattributed written: ${unattrWritten}`);
  console.log(`write duration: ${writeSec}s`);
} catch (err) {
  console.error("write failed:", err.message);
  process.exit(2);
}

console.log("");
console.log(`derive_labor_actuals complete: total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
