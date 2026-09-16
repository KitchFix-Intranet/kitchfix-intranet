#!/usr/bin/env node
// Regression probe for the 2026-09-17 classifier fix in
// src/lib/labor/deriveActuals.js. Runs deriveLaborActuals against
// the live DB (read-only; nothing persisted) and asserts:
//
//   1. Zero 3100.2 rows emitted into labor_actuals (labor_actuals is
//      hourly-only by design; 3100.2 is the salary line and lives in
//      labor_salary_actuals via derive_salary_actuals.mjs).
//   2. Only accounts with a 3100.1 department in rippling_department_map
//      have emissions. D26 salaried-only accounts (CIN - KY, TBJ - NY)
//      emit zero rows.
//
// USAGE:
//   node --env-file=.env.local scripts/probes/_probe_labor_actuals_line_codes.mjs
//
// EXIT:
//   0  no 3100.2 emitted, no D26-account emissions
//   1  any 3100.2 emitted OR any D26-account emitted
//
// The prior classifier bug (fixed by the 2026-09-17 attribute() rewrite)
// silently reclassified an hourly worker's history when they changed
// department. If a future edit reintroduces the "use worker's current
// dept's pnl_line as line_code" pattern, this probe fires immediately.

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

if (violations > 0) {
  console.error(`\n${violations} probe assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll probe assertions passed.`);
process.exit(0);
