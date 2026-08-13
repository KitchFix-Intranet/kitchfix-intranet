// scripts/load_kpi_budgets_2026.mjs
//
// KPI-2 · load FY2026 budget values from Kevin's local seed JSON into
// public.kpi_budgets. The public repo carries zero dollar literals -
// every number this script reads (and every number it prints on
// success) comes from --file at runtime.
//
// Usage:
//   node --env-file=.env.local scripts/load_kpi_budgets_2026.mjs \
//     --file <path>/fy2026_pnl_budget_seed.json [--dry-run]
//
// The seed JSON shape (produced locally, kept out of the repo):
//   {
//     "row_count": <int>,                     // exact expected row count
//     "grand_total_all_lines": <number>,      // rounded 2dp
//     "manifest_3100_1_year_totals": {        // rounded 2dp
//       "CIN - OH": <number>, "STL - MO": <number>, ...
//     },
//     "period_starts": ["2025-12-29", ...],   // 13 ISO dates, P1..P13
//     "lines": [
//       { "account_key": "...", "line_code": "3100.1",
//         "period_no": 1, "amount": <number> }, ...
//     ]
//   }
//
// Guardrails:
//   - Refuses without --file.
//   - Refuses if row_count, manifest_3100_1_year_totals, or lines[]
//     is missing / empty / mismatched vs actual entries.
//   - source_doc = 'pl_2026_clean_2026-08-13' (constant string, no
//     dollar values).
//   - Upsert on PK in batches of 500. Idempotent - re-run overwrites
//     the amount for any (account, line, fy, period) key.
//   - --dry-run stops before any DB write and prints counts only.
//   - After a real load, verifies: total rows, per-account 3100.1
//     year sums == manifest to the cent. Console receipt: COUNTS +
//     PASS/FAIL per account. NEVER prints dollar amounts.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === "--dry-run") { args.set("dry-run", true); continue; }
  if (a.startsWith("--")) {
    const key = a.slice(2);
    args.set(key, process.argv[++i]);
  }
}

const seedPath = args.get("file");
const dryRun = !!args.get("dry-run");
if (!seedPath) {
  console.error("ERROR: --file <seed.json> is required");
  process.exit(2);
}

let seed;
try {
  seed = JSON.parse(readFileSync(seedPath, "utf8"));
} catch (e) {
  console.error(`ERROR: could not read/parse ${seedPath}: ${e.message}`);
  process.exit(2);
}

// Structural guards - never touch amounts, only counts + presence.
if (!Number.isInteger(seed.row_count) || seed.row_count <= 0) {
  console.error("ERROR: seed.row_count missing or invalid");
  process.exit(2);
}
if (!seed.manifest_3100_1_year_totals || typeof seed.manifest_3100_1_year_totals !== "object" || Object.keys(seed.manifest_3100_1_year_totals).length === 0) {
  console.error("ERROR: seed.manifest_3100_1_year_totals missing or empty");
  process.exit(2);
}
if (!Array.isArray(seed.lines) || seed.lines.length !== seed.row_count) {
  console.error(`ERROR: seed.lines.length (${seed.lines?.length}) != row_count (${seed.row_count})`);
  process.exit(2);
}

// Shape-check each line entry (no amount comparisons, only presence).
for (let i = 0; i < seed.lines.length; i += 1) {
  const r = seed.lines[i];
  if (!r || typeof r.account_key !== "string" || typeof r.line_code !== "string"
      || !Number.isInteger(r.period_no) || r.period_no < 1 || r.period_no > 13
      || typeof r.amount !== "number") {
    console.error(`ERROR: seed.lines[${i}] malformed`);
    process.exit(2);
  }
}

console.log(`seed: ${seed.row_count} rows across ${Object.keys(seed.manifest_3100_1_year_totals).length} accounts (manifest keys)`);
console.log(`period_starts: ${seed.period_starts?.length ?? 0} (expected 13)`);

if (dryRun) {
  console.log("DRY-RUN - no DB writes. Counts above are what would be upserted.");
  process.exit(0);
}

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SOURCE_DOC = "pl_2026_clean_2026-08-13";
const FISCAL_YEAR = 2026;
const BATCH = 500;

let upserted = 0;
for (let i = 0; i < seed.lines.length; i += BATCH) {
  const chunk = seed.lines.slice(i, i + BATCH).map(r => ({
    account_key: r.account_key,
    line_code:   r.line_code,
    fiscal_year: FISCAL_YEAR,
    period_no:   r.period_no,
    amount:      r.amount,
    source_doc:  SOURCE_DOC,
  }));
  const { error, count } = await supa
    .from("kpi_budgets")
    .upsert(chunk, { onConflict: "account_key,line_code,fiscal_year,period_no", count: "exact" });
  if (error) {
    console.error(`ERROR at batch offset ${i}: ${error.message}`);
    process.exit(1);
  }
  upserted += (count ?? chunk.length);
  process.stdout.write(`  upserted ${upserted}/${seed.row_count}\r`);
}
process.stdout.write("\n");

// ── Post-load DB verification ────────────────────────────────────
// Fix D - scope the count query to fiscal_year so the day FY2027 loads,
// a FY2026 re-run does not fail on total-rows drift.
const total = await supa.from("kpi_budgets")
  .select("*", { count: "exact", head: true })
  .eq("fiscal_year", FISCAL_YEAR);
if (total.error) { console.error(`ERROR post-load count: ${total.error.message}`); process.exit(1); }
const rowMatch = total.count === seed.row_count;
console.log(`\nDB FY${FISCAL_YEAR} row count: ${total.count} vs seed.row_count ${seed.row_count} - ${rowMatch ? "PASS" : "FAIL"}`);

// Per-account 3100.1 year sums vs manifest.
const accounts = Object.keys(seed.manifest_3100_1_year_totals);
let allTie = true;
for (const acct of accounts) {
  const q = await supa
    .from("kpi_budgets")
    .select("amount")
    .eq("account_key", acct)
    .eq("line_code", "3100.1")
    .eq("fiscal_year", FISCAL_YEAR);
  if (q.error) { console.error(`ERROR reading ${acct}: ${q.error.message}`); process.exit(1); }
  const dbSum = (q.data || []).reduce((s, r) => s + Number(r.amount), 0);
  const dbSumR = Math.round(dbSum * 100) / 100;
  const seedSumR = Math.round(Number(seed.manifest_3100_1_year_totals[acct]) * 100) / 100;
  const tie = Math.abs(dbSumR - seedSumR) < 0.01;
  if (!tie) allTie = false;
  console.log(`  ${acct.padEnd(15)} 3100.1 year sum - ${tie ? "TIE" : "FAIL"}`);
}
console.log(rowMatch && allTie ? "\nLOAD PASS" : "\nLOAD FAIL");
process.exit(rowMatch && allTie ? 0 : 1);
