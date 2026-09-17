#!/usr/bin/env node
// scripts/probes/_probe_salary_hourly_overlap.mjs
//
// Standing gate. Fails if ANY (worker_id, week_start) combo carries
// both a labor_salary_actuals row AND labor_actuals_latest hourly
// hours > 0 in the same week. Kevin ruling 2026-09-17: a worker with
// hourly hours in a week is not salaried that week. Anna Hughes
// (658c8203d69a90ae354e00b6) surfaced this class of defect - 7 weeks
// of $6,730.78 salary on TXR - AZ overlapping her hourly through
// 2026-09-04.
//
// The hourly-hours cross-check is the discriminator Kevin used to
// separate real double-counts from legitimate raises:
//   - 7 workers had salary_effective_date > first salaried week
//   - Only 1 (Anna) had hourly hours in the overlap window
//   - The other 6 were raises (comp record changed, worker was already
//     salaried under a prior comp record we do not see)
// This probe encodes the same discriminator as a standing gate. If
// derive_salary_actuals.mjs is behaving correctly, this probe returns
// 0 rows.
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_salary_hourly_overlap.mjs
//
// Optional flags:
//   --window=fytd       scan FY2026 P1..today (default: FY2026 P1..today)
//   --window=trailing8  scan trailing 8 weeks only
//   --json              emit a machine-parseable summary at the end

import { createClient } from "@supabase/supabase-js";

const args = { window: "fytd", json: false };
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--window=")) args.window = a.slice("--window=".length);
  else if (a === "--json") args.json = true;
}

const FY_START = "2025-12-29";
const today = new Date().toISOString().slice(0, 10);
function mondayOnOrBefore(iso) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const wd = d.getUTCDay();          // Sun=0..Sat=6
  const back = wd === 0 ? 6 : wd - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const windowEnd = mondayOnOrBefore(today);
const windowStart = args.window === "trailing8"
  ? addDaysISO(windowEnd, -7 * 8)
  : FY_START;

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log(`# salary/hourly overlap gate · window ${windowStart} .. ${windowEnd}`);

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

const salaryRows = await fetchAll("labor_salary_actuals",
  "worker_id, account_key, week_start, amount",
  [(q) => q.gte("week_start", windowStart).lte("week_start", windowEnd)]);
console.log(`  labor_salary_actuals rows in window: ${salaryRows.length}`);

const hourlyRows = await fetchAll("labor_actuals_latest",
  "worker_id, week_start, hours_regular, hours_overtime, hours_double_time, hours_premium_other",
  [(q) => q.gte("week_start", windowStart).lte("week_start", windowEnd)]);

const hourlyWW = new Map();  // "worker||week" -> total hours
for (const r of hourlyRows) {
  const h = Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) +
            Number(r.hours_double_time || 0) + Number(r.hours_premium_other || 0);
  if (h > 0) hourlyWW.set(`${r.worker_id}||${r.week_start}`, h);
}
console.log(`  labor_actuals_latest hourly-week combos with hours > 0: ${hourlyWW.size}`);

const overlaps = [];
for (const s of salaryRows) {
  const key = `${s.worker_id}||${s.week_start}`;
  if (hourlyWW.has(key)) {
    overlaps.push({ ...s, hours: hourlyWW.get(key) });
  }
}

console.log(``);
if (overlaps.length === 0) {
  console.log(`  PASS · no salary/hourly overlap in the window`);
  if (args.json) console.log(JSON.stringify({ ok: true, overlaps: 0 }));
  process.exit(0);
}

// Aggregate by worker for readable output.
const byWorker = new Map();
for (const o of overlaps) {
  const cur = byWorker.get(o.worker_id) || { worker_id: o.worker_id, weeks: 0, dollars: 0, hours: 0, accounts: new Set() };
  cur.weeks += 1;
  cur.dollars += Number(o.amount || 0);
  cur.hours += Number(o.hours || 0);
  cur.accounts.add(o.account_key);
  byWorker.set(o.worker_id, cur);
}
console.log(`  FAIL · ${overlaps.length} overlap row(s) across ${byWorker.size} worker(s)`);
console.log(``);
console.log(`  worker_id                      accts        weeks    hourly_hrs    salary_$_overlap`);
for (const w of [...byWorker.values()].sort((a, b) => b.dollars - a.dollars)) {
  const accts = [...w.accounts].join(",").slice(0, 12).padEnd(12);
  console.log(`  ${w.worker_id}  ${accts}  ${String(w.weeks).padStart(5)}  ${w.hours.toFixed(2).padStart(11)}   $${w.dollars.toFixed(2).padStart(12)}`);
}
console.log(``);
console.log(`  fix: re-run scripts/derive_salary_actuals.mjs --source=manual --window=fytd`);
console.log(`  root cause: derive_salary_actuals must gate on hourly-hours-in-week (Kevin ruling 2026-09-17).`);

if (args.json) {
  console.log(JSON.stringify({
    ok: false,
    overlaps: overlaps.length,
    workers: [...byWorker.values()].map(w => ({ ...w, accounts: [...w.accounts] })),
  }));
}
process.exit(1);
