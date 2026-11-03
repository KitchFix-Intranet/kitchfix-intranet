#!/usr/bin/env node
// Calibration probe for the raw-table growth check added to
// cron-health. Runs the SAME logic the route uses, against live
// data, and reports which tables would alert at the thresholds
// shipped in the PR. Read-only.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const GROWTH_RATIO_THRESHOLD  = 6;
const GROWTH_SIZE_THRESHOLD   = 50_000;
const GROWTH_WATCHED_TABLES = [
  "rippling_raw_users",
  "rippling_raw_workers",
  "rippling_raw_compensations",
  "rippling_raw_time_entries",
];

console.log(`growth_check_calibration started=${new Date().toISOString()}`);
console.log(`thresholds: ratio>${GROWTH_RATIO_THRESHOLD}x  OR  rows>${GROWTH_SIZE_THRESHOLD.toLocaleString()}`);
console.log("");

const alerts = [];
for (const table of GROWTH_WATCHED_TABLES) {
  try {
    const totalResp = await supa.from(table).select("rippling_id", { count: "exact", head: true });
    if (totalResp.error) throw new Error(`total: ${totalResp.error.message}`);
    const total = Number(totalResp.count || 0);
    const distResp = await supa.from(`${table}_latest`).select("rippling_id", { count: "exact", head: true });
    if (distResp.error) throw new Error(`distinct: ${distResp.error.message}`);
    const distinct = Number(distResp.count || 0);
    const ratio = distinct > 0 ? total / distinct : 0;
    const sizeTrip = total > GROWTH_SIZE_THRESHOLD;
    const ratioTrip = ratio > GROWTH_RATIO_THRESHOLD;
    const verdict = (sizeTrip || ratioTrip) ? "WOULD ALERT" : "ok";
    console.log(`  ${table.padEnd(32)}  rows=${total.toString().padStart(7)}  distinct=${distinct.toString().padStart(6)}  ratio=${ratio.toFixed(1)}x  [${verdict}]`);
    if (sizeTrip) alerts.push(`${table} rows=${total.toLocaleString()} > ${GROWTH_SIZE_THRESHOLD.toLocaleString()}`);
    if (ratioTrip) alerts.push(`${table} ratio=${ratio.toFixed(1)}x > ${GROWTH_RATIO_THRESHOLD}x`);
  } catch (e) {
    console.log(`  ${table.padEnd(32)}  ERROR: ${e?.message || e}`);
  }
}
console.log("");
if (alerts.length === 0) {
  console.log("Result: no table would alert today. All ratios + sizes below threshold.");
} else {
  console.log(`Result: ${alerts.length} alert(s) would fire today:`);
  for (const a of alerts) console.log(`  - ${a}`);
}
