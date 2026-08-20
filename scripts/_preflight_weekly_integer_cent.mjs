// scripts/_preflight_weekly_integer_cent.mjs
//
// Pre-flight diff for the weekly-derive integer-cent fix.
// Kevin ruling 2026-08-20: fix the weekly derive to use integer-cent
// arithmetic so D1 reconciles to zero. Two conditions:
//   - Diff EVERY weekly row before and after, not just the 8. Report
//     the exact count changed and the aggregate delta. If more than 8
//     move, or the delta exceeds $0.08, stop and report before writing.
//   - CIN - OH 06/29 must stay $4,328.27; every standing sentinel
//     must hold.
//
// This script computes what the NEW derive would produce over the
// live inputs, diffs it against the CURRENT labor_actuals values, and
// hard-refuses to write if either gate is violated. It writes ONLY on
// --apply. Dry-run is the default.
//
// Usage
//   node --env-file=.env.local scripts/_preflight_weekly_integer_cent.mjs           # dry-run diff
//   node --env-file=.env.local scripts/_preflight_weekly_integer_cent.mjs --apply   # write if gate passes

import { createClient } from "@supabase/supabase-js";
import { deriveLaborActuals, writeLaborDerivation } from "../src/lib/labor/deriveActuals.js";

const applyFlag = process.argv.includes("--apply");

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ─── Ruling gate ────────────────────────────────────────────────────
const MAX_ROWS_MOVED  = 8;       // Kevin: no more than 8 rows may move
const MAX_DELTA_CENTS = 8;       // Kevin: aggregate delta may not exceed $0.08

// ─── Sentinels that must hold ───────────────────────────────────────
const SENTINELS = [
  { account: "CIN - OH", week_start: "2026-06-29", metric: "amount",         want: 4328.27 },
  { account: "CIN - OH", week_start: "2026-06-29", metric: "hours_regular",  want: 113.98 },
  { account: "CIN - OH", week_start: "2026-06-29", metric: "hours_overtime", want: 2.32   },
];

console.log("=".repeat(72));
console.log("Pre-flight: weekly derive integer-cent");
console.log("=".repeat(72));

// ─── 1. Fetch current labor_actuals_latest snapshot ─────────────────
async function fetchAll(table, sel) {
  const PS = 1000; const out = []; let f = 0;
  while (true) {
    const q = await supa.from(table).select(sel).range(f, f + PS - 1);
    if (q.error) throw new Error(`${table}: ${q.error.message}`);
    for (const r of q.data || []) out.push(r);
    if ((q.data || []).length < PS) break;
    f += PS;
  }
  return out;
}

console.log("");
console.log("loading current labor_actuals_latest (before)");
const before = await fetchAll("labor_actuals_latest",
  "account_key, week_start, worker_id, line_code, week_source, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount");
console.log(`  ${before.length} rows`);
const beforeByKey = new Map();
for (const r of before) beforeByKey.set(`${r.account_key}|${r.week_start}|${r.worker_id}|${r.line_code}`, r);

// ─── 2. Run the NEW derive in-memory (no write) ─────────────────────
console.log("");
console.log("running deriveLaborActuals (integer-cent branch, in-memory)");
const derivedAt = new Date().toISOString();
const runSource = `preflight-integer-cent-${derivedAt}`;
const result = await deriveLaborActuals({
  supa,
  sourceRun: runSource,
  log: (line) => process.stdout.write(`  ${line}\n`),
});
const derivedRows = result.accountResults.flatMap(a => a.actuals);
console.log(`  derived rows: ${derivedRows.length} across ${result.accountResults.length} accounts`);

// ─── 3. Row-for-row diff on the dollars columns ─────────────────────
console.log("");
console.log("diffing dollars fields against current labor_actuals_latest");
let rowsMoved = 0;
let deltaCents = 0;   // signed integer, cents
const rowsMovedDetail = [];
// Only compare rows the derive actually produces (sc_day_metadata era);
// rippling_report-backfilled rows are not touched by the derive.
for (const nb of derivedRows) {
  const k = `${nb.account_key}|${nb.week_start}|${nb.worker_id}|${nb.line_code}`;
  const ob = beforeByKey.get(k);
  if (!ob) continue;
  const fields = ["dollars_regular","dollars_overtime","dollars_double_time","dollars_premium_other","amount"];
  let rowChanged = false;
  const rowDiffs = [];
  for (const f of fields) {
    const nCents = Math.round(Number(nb[f]) * 100);
    const oCents = Math.round(Number(ob[f]) * 100);
    if (nCents !== oCents) {
      rowChanged = true;
      const diff = nCents - oCents;
      deltaCents += diff;
      rowDiffs.push(`${f}: ${(oCents/100).toFixed(2)} -> ${(nCents/100).toFixed(2)} (${diff >= 0 ? "+" : ""}${diff}c)`);
    }
  }
  if (rowChanged) {
    rowsMoved++;
    if (rowsMovedDetail.length < 12) rowsMovedDetail.push(`${nb.account_key} ${nb.week_start} worker=${nb.worker_id.slice(0,8)} ${nb.line_code}: ${rowDiffs.join(", ")}`);
  }
}
const absDeltaCents = Math.abs(deltaCents);
console.log(`  rows moved: ${rowsMoved}`);
console.log(`  aggregate delta: ${deltaCents >= 0 ? "+" : ""}${deltaCents} cents ($${(deltaCents/100).toFixed(2)})`);
console.log(`  |delta|: ${absDeltaCents} cents ($${(absDeltaCents/100).toFixed(2)})`);
console.log("");
console.log("  row-by-row detail:");
for (const s of rowsMovedDetail) console.log(`    ${s}`);
if (rowsMoved > rowsMovedDetail.length) console.log(`    ... ${rowsMoved - rowsMovedDetail.length} more`);

// ─── 4. Sentinel check (against derived rows) ───────────────────────
console.log("");
console.log("sentinel check on derived rows");
const derivedByKeyWeek = new Map();
for (const r of derivedRows) {
  const k = `${r.account_key}|${r.week_start}`;
  if (!derivedByKeyWeek.has(k)) derivedByKeyWeek.set(k, []);
  derivedByKeyWeek.get(k).push(r);
}
let sentinelBad = 0;
for (const s of SENTINELS) {
  const rows = derivedByKeyWeek.get(`${s.account}|${s.week_start}`) || [];
  const sum = rows.reduce((a, r) => a + Number(r[s.metric] || 0), 0);
  const match = Math.abs(sum - s.want) < 0.005;
  console.log(`  ${s.account} ${s.week_start} ${s.metric}: derived sum = ${sum.toFixed(4)}  (want ${s.want})  ${match ? "OK" : "FAIL"}`);
  if (!match) sentinelBad++;
}

// ─── 5. Gate ────────────────────────────────────────────────────────
console.log("");
console.log("─".repeat(72));
const gateFailReasons = [];
if (rowsMoved > MAX_ROWS_MOVED) gateFailReasons.push(`rowsMoved=${rowsMoved} > ${MAX_ROWS_MOVED}`);
if (absDeltaCents > MAX_DELTA_CENTS) gateFailReasons.push(`|delta|=${absDeltaCents}c > ${MAX_DELTA_CENTS}c ($${(MAX_DELTA_CENTS/100).toFixed(2)})`);
if (sentinelBad > 0) gateFailReasons.push(`${sentinelBad} sentinel(s) failed`);

if (gateFailReasons.length > 0) {
  console.log(`GATE FAILED: ${gateFailReasons.join("; ")}`);
  console.log("Refusing to write. Report the numbers above to Kevin.");
  process.exit(2);
}
console.log("GATE PASSED");
console.log(`  rows moved: ${rowsMoved} <= ${MAX_ROWS_MOVED}`);
console.log(`  |delta|: ${absDeltaCents} cents <= ${MAX_DELTA_CENTS} cents ($${(MAX_DELTA_CENTS/100).toFixed(2)})`);
console.log(`  sentinels: all hold`);

if (!applyFlag) {
  console.log("");
  console.log("(dry-run) NOT writing. Re-run with --apply to commit.");
  process.exit(0);
}

// ─── 6. Apply ───────────────────────────────────────────────────────
console.log("");
console.log("applying derivation (writeLaborDerivation)");
await writeLaborDerivation({
  supa,
  result,
  log: (line) => process.stdout.write(`  ${line}\n`),
});
console.log("write complete.");
