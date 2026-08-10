// scripts/derive_labor_actuals.mjs
//
// CLI wrapper for src/lib/labor/deriveActuals.js. Called by the
// nightly workflow after the sync completes. Full re-derive per D38.
//
// Usage:
//   node --env-file=.env.local scripts/derive_labor_actuals.mjs --source=nightly
//   node --env-file=.env.local scripts/derive_labor_actuals.mjs --source=manual --dry-run
//   node --env-file=.env.local scripts/derive_labor_actuals.mjs --source=manual --dry-run --force-age-hours=100
//
// Exit codes:
//   0  success (or dry-run success)
//   1  configuration error (missing env, bad --source)
//   2  derivation error mid-run
//   3  derive duration exceeded 10 minutes (per D38; trigger to revisit design)

import { createClient } from "@supabase/supabase-js";
import { deriveLaborActuals, writeLaborDerivation } from "../src/lib/labor/deriveActuals.js";

const VALID_SOURCES = new Set(["backfill", "nightly", "manual"]);
const MAX_DURATION_SEC = 600;  // 10 minutes per D38

function parseArgs(argv) {
  const args = { source: null, dryRun: false, forceAgeH: null };
  for (const a of argv.slice(2)) {
    if      (a.startsWith("--source="))            args.source = a.slice(9);
    else if (a === "--dry-run")                    args.dryRun = true;
    else if (a.startsWith("--force-age-hours="))   args.forceAgeH = Number(a.slice(18));
    else { console.error("unknown arg: " + a); process.exit(1); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.source || !VALID_SOURCES.has(args.source)) {
  console.error("--source is required, one of: " + [...VALID_SOURCES].join(", "));
  process.exit(1);
}

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const runStartISO = new Date().toISOString();
console.log(`derive_labor_actuals source=${args.source} dryRun=${args.dryRun}${args.forceAgeH != null ? ` forceAgeH=${args.forceAgeH}` : ""} started=${runStartISO}`);

let result;
try {
  result = await deriveLaborActuals({
    supa,
    sourceRun: args.source,
    log: (msg) => console.log(`  ${msg}`),
    forcePresenceAgeH: args.forceAgeH,
  });
} catch (err) {
  console.error(`derive_labor_actuals: derivation FAILED: ${err.message}`);
  process.exit(2);
}

// Per-account summary
console.log("");
console.log("per-account derivation:");
console.log("  account         | rows | orphans | complete | partial | hours_only | unknown");
console.log("  ----------------+------+---------+----------+---------+------------+--------");
let totalRows = 0, totalOrphans = 0;
for (const acc of result.accountResults) {
  const s = acc.stats.buckets_by_state;
  console.log(`  ${acc.accountKey.padEnd(15)} | ${String(acc.stats.rows).padStart(4)} | ${String(acc.stats.orphans).padStart(7)} | ${String(s.complete || 0).padStart(8)} | ${String(s.partial || 0).padStart(7)} | ${String(s.hours_only || 0).padStart(10)} | ${String(s.unknown || 0).padStart(7)}`);
  totalRows += acc.stats.rows;
  totalOrphans += acc.stats.orphans;
}
console.log(`  TOTAL           | ${String(totalRows).padStart(4)} | ${String(totalOrphans).padStart(7)}`);
console.log("");

// Unmapped earning types
console.log(`unmapped earning-type names: ${result.unmappedRows.length}`);
for (const u of result.unmappedRows.sort((a, b) => b.total_amount - a.total_amount)) {
  console.log(`  ${u.merged_earning_type_name}: count=${u.occurrence_count} hrs=${u.total_hours} $=${u.total_amount}`);
}
console.log("");

// Unattributed
console.log(`unattributed groups: ${result.unattributed.length}`);
for (const u of result.unattributed.sort((a, b) => b.amount - a.amount).slice(0, 20)) {
  console.log(`  ${u.reason_code} dept=${u.department_id || "-"} worker=${u.worker_id || "-"}  segs=${u.segment_count} hrs=${u.hours} $=${u.amount}`);
}
console.log("");

// Presence age
console.log(`presence-age gate: pay_segments walk age=${result.stats.presenceAgeH != null ? result.stats.presenceAgeH.toFixed(2) + "h" : "no successful walk"}`);
console.log(`  isStalePresence=${result.stats.isStalePresence} (threshold: >54h -> all rows coverage_state=unknown)`);
console.log("");

// Orphan metrics - two numbers, distinct meaning (D36)
console.log(`orphan metrics:`);
console.log(`  raw_minus_presence:     ${result.stats.rawMinusPresence}  (raw observations not in presence; mostly rename-replaced retirements, NOT lost labor)`);
console.log(`  orphaned_labor_facts:   ${result.stats.orphanedLaborFacts}  (D36 signal: labor facts with ZERO live members - actual coverage loss)`);
console.log("");

// Derive duration
console.log(`derive duration: ${result.stats.durationSec.toFixed(2)}s`);
if (result.stats.durationSec > MAX_DURATION_SEC) {
  console.error(`derive duration EXCEEDED ${MAX_DURATION_SEC}s (10min). Per D38, stop and report rather than optimising.`);
  process.exit(3);
}
console.log("");

if (args.dryRun) {
  console.log("DRY RUN: skipping DB writes. Nothing persisted.");
  process.exit(0);
}

console.log("writing to labor_actuals + labor_unattributed + earning_type_unmapped...");
let writeStats;
try {
  writeStats = await writeLaborDerivation({
    supa,
    result,
    log: (msg) => console.log(`  ${msg}`),
  });
} catch (err) {
  console.error(`derive_labor_actuals: write FAILED: ${err.message}`);
  process.exit(2);
}

console.log("");
console.log(`derive_labor_actuals summary:`);
console.log(`  actuals rows written:       ${writeStats.actualsWritten}`);
console.log(`  unattributed groups written: ${writeStats.unattributedWritten}`);
console.log(`  unmapped types written:      ${writeStats.unmappedWritten}`);
console.log(`  derive+write elapsed:        ${(result.stats.durationSec + writeStats.writeDurationSec).toFixed(2)}s`);
console.log(`  source=${args.source}`);

process.exit(0);
