// scripts/_probe_rippling_spend_payload.mjs
//
// Pre-fix probe: inspect a real rippling_raw_spend_lines_latest row so
// we understand the payload shape before touching normalizer code.
// Also snapshots current derived-actuals amount-null count + billcom P8
// sum (so we can assert P8 is untouched after re-derive).
//
// Reports counts + a redacted payload sample (no client dollars printed
// to stdout beyond the "amount object present" flag, no cardholder
// names).
//
// Usage:
//   node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local \
//        scripts/_probe_rippling_spend_payload.mjs

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("env missing"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// 1. raw row counts
const rawLatest = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id", { count: "exact", head: true });
console.log(`rippling_raw_spend_lines_latest total rows: ${rawLatest.count}`);

// 2. current amount / category populate rates on latest
const nonNullAmount = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id", { count: "exact", head: true }).not("amount", "is", null);
const nonNullCat = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id", { count: "exact", head: true }).not("category_id", "is", null);
console.log(`rippling_raw_spend_lines_latest non-null amount: ${nonNullAmount.count}`);
console.log(`rippling_raw_spend_lines_latest non-null category_id: ${nonNullCat.count}`);

// 3. purchasing_actuals rippling_spend counts
const paRipp = await supa.from("purchasing_actuals").select("id", { count: "exact", head: true }).eq("source", "rippling_spend");
const paRippNonNullAmt = await supa.from("purchasing_actuals").select("id", { count: "exact", head: true }).eq("source", "rippling_spend").neq("amount", 0);
console.log(`purchasing_actuals rippling_spend rows: ${paRipp.count}`);
console.log(`purchasing_actuals rippling_spend non-zero amount rows: ${paRippNonNullAmt.count}`);

// 4. sample raw payload - print shape only (keys), then per-key type
const sample = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id, raw, amount, category_id, department_id, department_label, work_location_id, work_location_label").limit(3);
if (sample.error) { console.error(sample.error); process.exit(1); }
for (const r of sample.data || []) {
  console.log(`\n=== sample rippling_id=${r.rippling_id} ===`);
  console.log(`  parsed amount col:      ${r.amount}`);
  console.log(`  parsed category_id col: ${r.category_id}`);
  console.log(`  parsed department_id:   ${r.department_id}`);
  console.log(`  parsed department_lab:  ${r.department_label}`);
  console.log(`  parsed work_loc_id:     ${r.work_location_id}`);
  console.log(`  parsed work_loc_label:  ${r.work_location_label}`);
  const raw = r.raw || {};
  console.log(`  raw top-level keys:     ${Object.keys(raw).sort().join(", ")}`);
  const shapeOf = (v) => v == null ? "null" : Array.isArray(v) ? "array" : typeof v;
  console.log(`  raw.amount typeof:      ${shapeOf(raw.amount)}`);
  if (raw.amount && typeof raw.amount === "object") {
    console.log(`  raw.amount keys:        ${Object.keys(raw.amount).sort().join(", ")}`);
    console.log(`  raw.amount.value type:  ${shapeOf(raw.amount.value)}  currency_type: ${raw.amount.currency_type}`);
  }
  console.log(`  raw.category typeof:    ${shapeOf(raw.category)}`);
  console.log(`  raw.department typeof:  ${shapeOf(raw.department)}`);
  if (raw.department && typeof raw.department === "object") console.log(`  raw.department keys:    ${Object.keys(raw.department).sort().join(", ")}`);
  console.log(`  raw.work_location typeof: ${shapeOf(raw.work_location)}`);
  if (raw.work_location && typeof raw.work_location === "object") console.log(`  raw.work_location keys: ${Object.keys(raw.work_location).sort().join(", ")}`);
  console.log(`  raw.spend_transaction typeof: ${shapeOf(raw.spend_transaction)}`);
  if (raw.spend_transaction && typeof raw.spend_transaction === "object") console.log(`  raw.spend_transaction keys: ${Object.keys(raw.spend_transaction).sort().join(", ")}`);
}

// 5. billcom P8 sum snapshot - assertion baseline. Compute total dollars
//    of billcom rows dated in P8 = 2026-06-14 .. 2026-07-11 (period 7 in
//    FY 2026 by the /28-day formula from index 0). Compute both P7 and P8
//    to be safe. period_no formula: floor((txn_date - 2025-12-29)/28)+1.
const FY_START = new Date("2025-12-29T00:00:00Z").getTime();
function periodBounds(p) {
  const s = new Date(FY_START + (p - 1) * 28 * 86400000).toISOString().slice(0, 10);
  const e = new Date(FY_START + (p * 28 - 1) * 86400000).toISOString().slice(0, 10);
  return { s, e };
}
for (const p of [7, 8]) {
  const { s, e } = periodBounds(p);
  const { data, error } = await supa.from("purchasing_actuals")
    .select("amount")
    .eq("source", "billcom")
    .gte("txn_date", s).lte("txn_date", e)
    .limit(50000);
  if (error) { console.error(`P${p} billcom sum failed: ${error.message}`); continue; }
  const sum = (data || []).reduce((a, r) => a + Number(r.amount || 0), 0);
  console.log(`billcom P${p} (${s}..${e}) rows=${data.length} sum=$${sum.toFixed(2)}`);
}

// 6. current candidate map counts
const catAll = await supa.from("spend_category_map").select("category_id", { count: "exact", head: true });
const catLabelled = await supa.from("spend_category_map").select("category_id", { count: "exact", head: true }).not("gl_line_code", "is", null);
const deptAll = await supa.from("spend_department_site_map").select("department_id", { count: "exact", head: true });
const deptLabelled = await supa.from("spend_department_site_map").select("department_id", { count: "exact", head: true }).not("account_key", "is", null);
const deptExcluded = await supa.from("spend_department_site_map").select("department_id", { count: "exact", head: true }).eq("excluded", true);
console.log(`\nspend_category_map     total=${catAll.count} labelled=${catLabelled.count}`);
console.log(`spend_department_site_map total=${deptAll.count} labelled=${deptLabelled.count} excluded=${deptExcluded.count}`);
