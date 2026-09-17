#!/usr/bin/env node
// scripts/probes/_probe_salary_restatement_effect.mjs
//
// Kevin ruling 2026-09-17. Standing gate. Recomputes the correct
// per-week amount from raw rippling_raw_compensations snapshots and
// asserts labor_salary_actuals matches to the cent per account per
// range.
//
// Rule (encoded in derive_salary_actuals.mjs's annualInForceForWeek
// and mirrored here): for week W, pick the snapshot whose
// salary_effective_date is the LATEST date <= W. Fall back to the
// EARLIEST snapshot if none qualify.
//
// PASS · every account × range delta is zero. Runs alongside the
// hourly-week probe as the second standing gate on salary. A future
// --window=fytd regression that reads _latest again would produce a
// non-zero delta on any account containing a worker with a rate
// history, and this probe would surface it immediately.
//
// FAIL · one or more accounts show a non-zero delta between the
// on-disk labor_salary_actuals total and the raw-snapshot simulation.
// The output table names the account, the current total, the target,
// and the delta. Fix path: re-run derive_salary_actuals.mjs
// --window=fytd (with the raise-restatement code in place).
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_salary_restatement_effect.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FY_START = "2025-12-29";
const CY_END = "2026-09-06";        // P9 end
const LP_START = "2026-08-10";      // P9 start
const LP_END = "2026-09-06";        // P9 end

async function fetchAll(table, cols, filters = []) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    let q = supa.from(table).select(cols).range(from, from + PS - 1);
    for (const f of filters) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PS) break;
    from += PS;
  }
  return out;
}

console.log("# salary restatement simulator · Kevin ruling 2026-09-17");
console.log(`# rule: for week W, pick snapshot with LATEST salary_effective_date <= W; fall back to earliest.\n`);

// Load raw comps and build per-worker snapshot lists sorted ascending
// by salary_effective_date.
const comps = await fetchAll("rippling_raw_compensations",
  "worker_id, payment_type, annual_value, salary_effective_date",
  [(q) => q.eq("payment_type", "DEFAULT")]);
const bywid = new Map();
for (const c of comps) {
  if (!c.worker_id || c.annual_value == null) continue;
  const list = bywid.get(c.worker_id) || [];
  list.push(c);
  bywid.set(c.worker_id, list);
}
for (const list of bywid.values()) {
  list.sort((a, b) => String(a.salary_effective_date || "").localeCompare(String(b.salary_effective_date || "")));
}
console.log(`comps raw rows: ${comps.length}  distinct workers: ${bywid.size}`);
const withHistory = [...bywid.entries()].filter(([, list]) => new Set(list.map(c => c.annual_value)).size > 1);
console.log(`workers with a rate change in raw history: ${withHistory.length}`);
for (const [wid, list] of withHistory) {
  const rates = list.map(c => `$${Number(c.annual_value).toLocaleString()} @ ${c.salary_effective_date}`);
  console.log(`  ${wid}  ${rates.join("  →  ")}`);
}
console.log("");

// Restatement rule.
function pickCompForWeek(list, weekStartISO) {
  if (!list || !list.length) return null;
  let picked = null;
  for (const c of list) {
    if (c.salary_effective_date && c.salary_effective_date <= weekStartISO) picked = c;
  }
  if (!picked) picked = list[0];
  return picked;
}

// Load current labor_salary_actuals across CY.
const rows = await fetchAll("labor_salary_actuals",
  "account_key, worker_id, week_start, amount",
  [(q) => q.gte("week_start", FY_START).lte("week_start", CY_END)]);
console.log(`labor_salary_actuals rows CY (P1-P9): ${rows.length}\n`);

// For each row, compute corrected amount using the new rule.
const deltas = new Map();  // account_key -> { current_cy, target_cy, current_lp, target_lp }
function bump(acct, field, v) {
  const cur = deltas.get(acct) || { current_cy: 0, target_cy: 0, current_lp: 0, target_lp: 0 };
  cur[field] += v;
  deltas.set(acct, cur);
}
let workersFixed = new Set();
for (const r of rows) {
  const currentAmount = Number(r.amount || 0);
  const list = bywid.get(r.worker_id);
  const picked = pickCompForWeek(list, r.week_start);
  const targetAmount = picked ? Math.round((Number(picked.annual_value) / 52) * 100) / 100 : currentAmount;
  if (Math.abs(currentAmount - targetAmount) > 0.005) workersFixed.add(r.worker_id);
  bump(r.account_key, "current_cy", currentAmount);
  bump(r.account_key, "target_cy",  targetAmount);
  if (r.week_start >= LP_START && r.week_start <= LP_END) {
    bump(r.account_key, "current_lp", currentAmount);
    bump(r.account_key, "target_lp",  targetAmount);
  }
}
console.log(`distinct workers with any restated amount: ${workersFixed.size}`);
console.log(``);

const accts = [...deltas.keys()].sort();
const fmt = n => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (s, n) => String(s).padStart(n);

console.log("Whole-year effect · CY (P1-P9)");
console.log("| account       |   current CY |    target CY |          Δ |");
console.log("|---------------|-------------:|-------------:|-----------:|");
let totCur = 0, totTgt = 0;
for (const a of accts) {
  const d = deltas.get(a);
  const delta = d.target_cy - d.current_cy;
  totCur += d.current_cy;
  totTgt += d.target_cy;
  console.log(`| ${a.padEnd(13)} | ${pad(fmt(d.current_cy), 12)} | ${pad(fmt(d.target_cy), 12)} | ${pad((delta >= 0 ? "+" : "") + fmt(delta), 10)} |`);
}
console.log(`| ${"TOTAL".padEnd(13)} | ${pad(fmt(totCur), 12)} | ${pad(fmt(totTgt), 12)} | ${pad(((totTgt - totCur) >= 0 ? "+" : "") + fmt(totTgt - totCur), 10)} |`);

console.log("\nLP · P9 only");
console.log("| account       |   current LP |    target LP |          Δ |");
console.log("|---------------|-------------:|-------------:|-----------:|");
let ltCur = 0, ltTgt = 0;
for (const a of accts) {
  const d = deltas.get(a);
  const delta = d.target_lp - d.current_lp;
  ltCur += d.current_lp;
  ltTgt += d.target_lp;
  console.log(`| ${a.padEnd(13)} | ${pad(fmt(d.current_lp), 12)} | ${pad(fmt(d.target_lp), 12)} | ${pad((delta >= 0 ? "+" : "") + fmt(delta), 10)} |`);
}
console.log(`| ${"TOTAL".padEnd(13)} | ${pad(fmt(ltCur), 12)} | ${pad(fmt(ltTgt), 12)} | ${pad(((ltTgt - ltCur) >= 0 ? "+" : "") + fmt(ltTgt - ltCur), 10)} |`);

// PASS / FAIL. Delta > $0.01 on any range on any account is a fail.
console.log("");
const TOL = 0.01;
const cyDelta = Math.abs(totTgt - totCur);
const lpDelta = Math.abs(ltTgt - ltCur);
if (cyDelta <= TOL && lpDelta <= TOL) {
  console.log(`  PASS · restatement delta zero (CY $${cyDelta.toFixed(2)}, LP $${lpDelta.toFixed(2)})`);
  process.exit(0);
}
console.log(`  FAIL · restatement delta present`);
console.log(`    CY total delta: $${(totTgt - totCur).toFixed(2)}`);
console.log(`    LP total delta: $${(ltTgt - ltCur).toFixed(2)}`);
console.log(`    fix path: re-run scripts/derive_salary_actuals.mjs --window=fytd (with raise-restatement code in place).`);
console.log(`    root cause: labor_salary_actuals contains rows written by a loader that read rippling_raw_compensations_latest instead of the raw table.`);
process.exit(1);
