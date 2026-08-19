// scripts/_probe_before_state.mjs
//
// Baseline snapshot BEFORE the work-location-attribution migration.
// Captures: current spend_department_site_map row count, current
// purchasing_actuals sums grouped by (source, account_key, excluded),
// billcom P7 + P8 sums (frozen for the "billcom untouched" assertion),
// rippling raw work_location distribution.
//
// Emits a JSON block to stdout for the report. No cardholder names.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FY_START = "2025-12-29";

// Compute P7 + P8 ISO date ranges.
function periodStart(p) {
  const d = new Date(FY_START + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + (p - 1) * 28);
  return d.toISOString().slice(0, 10);
}
function periodEnd(p) {
  const d = new Date(FY_START + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + p * 28 - 1);
  return d.toISOString().slice(0, 10);
}

const p7start = periodStart(7);
const p7end = periodEnd(7);
const p8start = periodStart(8);
const p8end = periodEnd(8);

async function fetchAll(table, cols, filter) {
  const rows = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    let q = supa.from(table).select(cols).range(from, from + CHUNK - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return rows;
}

// 1. spend_department_site_map rowcount + shape
const deptMap = await fetchAll("spend_department_site_map", "department_id, account_key, excluded");
console.log(`spend_department_site_map: total=${deptMap.length}  mapped=${deptMap.filter(r => r.account_key).length}  excluded=${deptMap.filter(r => r.excluded).length}`);

// 2. purchasing_actuals rippling_spend BEFORE state
const rippling = await fetchAll("purchasing_actuals", "account_key, excluded, amount", q => q.eq("source", "rippling_spend"));
const byAcct = new Map();
let excludedSum = 0;
let unattrSum = 0;
let excludedLines = 0;
let unattrLines = 0;
for (const r of rippling) {
  const amt = Number(r.amount || 0);
  if (r.excluded) { excludedSum += amt; excludedLines++; continue; }
  if (!r.account_key) { unattrSum += amt; unattrLines++; continue; }
  if (!byAcct.has(r.account_key)) byAcct.set(r.account_key, { sum: 0, lines: 0 });
  const b = byAcct.get(r.account_key);
  b.sum += amt;
  b.lines++;
}
console.log("");
console.log("BEFORE: rippling_spend by account_key (dept-based)");
for (const [k, v] of [...byAcct.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${k.padEnd(16)} sum=${v.sum.toFixed(2)}  lines=${v.lines}`);
}
console.log(`  EXCLUDED         sum=${excludedSum.toFixed(2)}  lines=${excludedLines}`);
console.log(`  UNATTRIBUTED     sum=${unattrSum.toFixed(2)}  lines=${unattrLines}`);
console.log(`  TOTAL rippling rows: ${rippling.length}`);

// 3. billcom P7 + P8 sum baselines (must be identical after)
async function billcomPeriodSum(pStart, pEnd) {
  const rows = await fetchAll("purchasing_actuals", "amount, account_key, excluded",
    q => q.eq("source", "billcom").gte("txn_date", pStart).lte("txn_date", pEnd));
  let total = 0;
  for (const r of rows) if (!r.excluded) total += Number(r.amount || 0);
  return { total, lines: rows.length };
}
const bcP7 = await billcomPeriodSum(p7start, p7end);
const bcP8 = await billcomPeriodSum(p8start, p8end);
console.log("");
console.log(`BEFORE: billcom P7 sum=${bcP7.total.toFixed(2)}  lines=${bcP7.lines}`);
console.log(`BEFORE: billcom P8 sum=${bcP8.total.toFixed(2)}  lines=${bcP8.lines}`);

// 4. work_location raw sum expectations (from Kevin's spec)
const wl = await fetchAll("rippling_raw_spend_lines_latest", "work_location_id, work_location_label, amount");
const byWL = new Map();
let wlNullSum = 0;
for (const r of wl) {
  const amt = Number(r.amount || 0);
  const key = r.work_location_label || "(null)";
  if (!byWL.has(key)) byWL.set(key, { sum: 0, lines: 0 });
  byWL.get(key).sum += amt;
  byWL.get(key).lines++;
  if (!r.work_location_label) wlNullSum += amt;
}
console.log("");
console.log("raw work_location distribution (raw table sum, includes any null-amount rows as 0):");
for (const [k, v] of [...byWL.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${k.padEnd(60)} sum=${v.sum.toFixed(2)}  lines=${v.lines}`);
}
