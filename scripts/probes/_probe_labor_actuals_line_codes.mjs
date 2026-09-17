#!/usr/bin/env node
// Regression probe for the 2026-09-17 classifier fix in
// src/lib/labor/deriveActuals.js + scripts/derive_labor_actuals_daily.mjs.
// Two surfaces, one probe.
//
// Weekly (labor_actuals) - derive-based assertions:
//   Runs deriveLaborActuals against the live DB (read-only; nothing
//   persisted) and asserts:
//     1. Zero 3100.2 rows emitted into labor_actuals (labor_actuals is
//        hourly-only by design; 3100.2 is the salary line and lives in
//        labor_salary_actuals via derive_salary_actuals.mjs).
//     2. D26 salaried-only accounts (CIN - KY, TBJ - NY) emit zero rows.
//   These fire BEFORE writes and catch a weekly-derive regression at
//   review time.
//
// Daily (labor_actuals_daily) - table-state assertions:
//   Reads labor_actuals_daily directly and asserts:
//     3. Zero rows with line_code='3100.2' in labor_actuals_daily.
//     4. Zero rows with account_key in D26 in labor_actuals_daily.
//   These are POST-derive - they read what the nightly wrote. The
//   daily derive script is a top-level executable, not an importable
//   module; extracting an in-memory version is a deferred refactor,
//   so the probe reads the table state after the daily nightly lands.
//
//   The 2026-09-17 D1 miss (weekly went green after the classifier
//   fix, daily still emitted 3100.2 on Anna Hughes's TXR-AZ hourly
//   weeks 2026-07-13..2026-08-10) got past the original probe because
//   assertion #1 covered labor_actuals only; #3 and #4 close that
//   gap.
//
// USAGE:
//   node --env-file=.env.local scripts/probes/_probe_labor_actuals_line_codes.mjs
//
// EXIT:
//   0  every assertion passes on both surfaces
//   1  any assertion fails on either surface

import { createClient } from "@supabase/supabase-js";
import { deriveLaborActuals } from "../../src/lib/labor/deriveActuals.js";

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("::error::SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const supa = createClient(url, key, { auth: { persistSession: false } });

const result = await deriveLaborActuals({
  supa,
  sourceRun: "manual",
  log: () => {},
});

let violations = 0;

// Assertion 1: no 3100.2 anywhere.
let total_3100_2 = 0;
const perAccount_3100_2 = new Map();
for (const acc of result.accountResults) {
  for (const row of acc.actuals || []) {
    if (row.line_code === "3100.2") {
      total_3100_2 += 1;
      perAccount_3100_2.set(acc.accountKey, (perAccount_3100_2.get(acc.accountKey) || 0) + 1);
    }
  }
}
if (total_3100_2 > 0) {
  console.error(`::error title=labor_actuals emitting 3100.2::${total_3100_2} rows across ${perAccount_3100_2.size} accounts. labor_actuals is hourly-only; 3100.2 belongs in labor_salary_actuals. The classifier at deriveActuals.js:attribute() has regressed to use d.pnl_line directly.`);
  for (const [acct, n] of perAccount_3100_2) console.error(`  ${acct}: ${n}`);
  violations += 1;
} else {
  console.log(`OK  zero 3100.2 emissions across ${result.accountResults.length} accounts`);
}

// Assertion 2: no D26 account emissions.
const d26_violators = new Map();
for (const acc of result.accountResults) {
  if (!D26_SALARIED_ONLY.has(acc.accountKey)) continue;
  const n = (acc.actuals || []).length;
  if (n > 0) d26_violators.set(acc.accountKey, n);
}
if (d26_violators.size > 0) {
  console.error(`::error title=D26 salaried-only account emitting hourly rows::`);
  for (const [acct, n] of d26_violators) console.error(`  ${acct}: ${n}`);
  violations += 1;
} else {
  console.log(`OK  D26 salaried-only accounts (${[...D26_SALARIED_ONLY].join(", ")}) emit zero rows`);
}

// Info-only line code summary.
const perAccountLineCodes = {};
for (const acc of result.accountResults) {
  const codes = new Map();
  for (const row of acc.actuals || []) {
    const k = row.line_code || "(null)";
    codes.set(k, (codes.get(k) || 0) + 1);
  }
  perAccountLineCodes[acc.accountKey] = Object.fromEntries(codes);
}
console.log(`\nPer-account line_code distribution:`);
for (const [acct, codes] of Object.entries(perAccountLineCodes)) {
  const s = Object.entries(codes).map(([c, n]) => `${c}=${n}`).join(", ");
  console.log(`  ${acct.padEnd(15)} ${s}`);
}

// ── Assertions 3 + 4: labor_actuals_daily table state ───────────
// The daily derive is a top-level script (scripts/derive_labor_-
// actuals_daily.mjs), not an importable module. Rather than block on
// extracting a callable deriveLaborActualsDaily(), assert on the
// written table state - the same rule shape, evaluated after the
// nightly write instead of before.
console.log(`\nlabor_actuals_daily assertions (post-write state check)`);

const dailyBad = await supa
  .from("labor_actuals_daily")
  .select("account_key, worker_id, work_date, line_code", { count: "exact", head: false })
  .eq("line_code", "3100.2")
  .limit(20);
if (dailyBad.error) {
  console.error(`::error::labor_actuals_daily 3100.2 read: ${dailyBad.error.message}`);
  violations += 1;
} else {
  const total = dailyBad.count ?? (dailyBad.data || []).length;
  if (total > 0) {
    console.error(`::error title=labor_actuals_daily emitting 3100.2::${total} rows. labor_actuals_daily is hourly-only; a 3100.2 row means derive_labor_actuals_daily.mjs:attribute() is reading the worker's current-dept pnl_line as line_code instead of the account's 3100.1 pnl_line.`);
    for (const r of dailyBad.data || []) console.error(`  ${r.account_key} worker=${r.worker_id} date=${r.work_date} line=${r.line_code}`);
    if (total > (dailyBad.data || []).length) console.error(`  ... and ${total - (dailyBad.data || []).length} more`);
    violations += 1;
  } else {
    console.log(`OK  zero 3100.2 rows in labor_actuals_daily`);
  }
}

const d26Bad = await supa
  .from("labor_actuals_daily")
  .select("account_key, worker_id, work_date, line_code", { count: "exact", head: false })
  .in("account_key", [...D26_SALARIED_ONLY])
  .limit(20);
if (d26Bad.error) {
  console.error(`::error::labor_actuals_daily D26 read: ${d26Bad.error.message}`);
  violations += 1;
} else {
  const total = d26Bad.count ?? (d26Bad.data || []).length;
  if (total > 0) {
    console.error(`::error title=labor_actuals_daily D26 salaried-only account emitting rows::${total} rows`);
    for (const r of d26Bad.data || []) console.error(`  ${r.account_key} worker=${r.worker_id} date=${r.work_date} line=${r.line_code}`);
    if (total > (d26Bad.data || []).length) console.error(`  ... and ${total - (d26Bad.data || []).length} more`);
    violations += 1;
  } else {
    console.log(`OK  labor_actuals_daily has zero rows for D26 accounts (${[...D26_SALARIED_ONLY].join(", ")})`);
  }
}

if (violations > 0) {
  console.error(`\n${violations} probe assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll probe assertions passed.`);
process.exit(0);
