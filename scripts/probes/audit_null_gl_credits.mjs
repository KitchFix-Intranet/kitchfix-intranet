#!/usr/bin/env node
// Null-gl vendor-credit audit.
//
// Kevin finding 2026-09-04: bill.com vendor credits without a
// chartOfAccountId land in `purchasing_actuals` with `gl_line_code =
// NULL`. The KPI resolver's per-gl sub-row aggregation filters null
// gls, and `purchBoard.buckets["3200"].period_total` uses
// `gl_line_code.startsWith("3200")` (see src/app/kpi/purchasing/lib/
// resolver.js:107) which also drops nulls. So a null-gl credit
// contributes to NOTHING the UI surfaces - the money is held on our
// books but appears in no total.
//
// This is the same shape as the missing-credits defect R-71 just
// fixed, one level down: a credit we pulled but cannot place is
// worse than one we never pulled, because there is no signal it
// exists. CIN - OH's $-7,911 Creation Gardens credit
// (ref 07302026WCW, 2026-07-30) is the first known instance;
// currently masked because CIN - OH is billed_back, but on any
// non-billed-back account $-8,000 would vanish silently.
//
// Report shape:
//   1) Per-account rollup: null_gl_credit_count, null_gl_credit_total
//   2) Per-credit detail: account, txn_date, amount, vendor, ref, status
//   3) Vendor rollup: which vendors keep sending un-classified credits
//
// Usage: node --env-file=<path>/.env.local scripts/probes/audit_null_gl_credits.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

console.log(`# Null-gl vendor-credit audit  ·  ${new Date().toISOString().slice(0, 10)}\n`);

// Pull every billcom_credit purchasing_actuals row with a null gl_line_code.
// This is authoritative: purchasing_actuals is post-derive, so anything
// with a null here is a credit we ingested but couldn't map.
const { data: nulls, error } = await supa
  .from("purchasing_actuals")
  .select("account_key, txn_date, amount, source_bill_id, gl_bucket")
  .eq("source", "billcom_credit")
  .is("gl_line_code", null);

if (error) throw error;

const rows = nulls || [];
if (rows.length === 0) {
  console.log("No null-gl vendor credits. All ingested credits carry a chart_of_account_id mapping to a known GL line.");
  process.exit(0);
}

// Per-account rollup
const perAccount = new Map();
for (const r of rows) {
  const cur = perAccount.get(r.account_key) || { count: 0, total: 0 };
  cur.count += 1;
  cur.total += Number(r.amount);
  perAccount.set(r.account_key, cur);
}

console.log(`## per-account rollup  (${rows.length} null-gl credit lines total)\n`);
console.log("| account | count | dollars |");
console.log("|---|---:|---:|");
const accountsSorted = [...perAccount.entries()].sort((a, b) => a[1].total - b[1].total);
let grandTotal = 0;
let grandCount = 0;
for (const [acct, v] of accountsSorted) {
  console.log(`| ${acct} | ${v.count} | $${v.total.toFixed(2)} |`);
  grandTotal += v.total;
  grandCount += v.count;
}
console.log(`| **total** | **${grandCount}** | **$${grandTotal.toFixed(2)}** |`);

// Per-credit detail with vendor lookup
const creditIds = [...new Set(rows.map(r => r.source_bill_id))];
const { data: heads } = await supa
  .from("billcom_raw_vendor_credits_latest")
  .select("credit_id, vendor_id, reference_number, credit_date, description, status")
  .in("credit_id", creditIds);
const vendorIds = [...new Set((heads || []).map(h => h.vendor_id).filter(Boolean))];
const { data: vends } = await supa
  .from("billcom_ref_vendors")
  .select("id, name")
  .in("id", vendorIds);
const vname = new Map((vends || []).map(v => [v.id, v.name]));
const hbyid = new Map((heads || []).map(h => [h.credit_id, h]));

console.log(`\n## per-credit detail\n`);
console.log("| account | txn_date | amount | vendor | ref | status |");
console.log("|---|---|---:|---|---|---|");
const sorted = [...rows].sort((a, b) => a.amount - b.amount);
for (const r of sorted) {
  const h = hbyid.get(r.source_bill_id);
  const vn = h ? (vname.get(h.vendor_id) || h.vendor_id) : "?";
  console.log(`| ${r.account_key} | ${r.txn_date} | $${Number(r.amount).toFixed(2)} | ${vn} | ${h?.reference_number || "-"} | ${h?.status || "-"} |`);
}

// Vendor rollup - which vendors are the offenders
const perVendor = new Map();
for (const r of rows) {
  const h = hbyid.get(r.source_bill_id);
  const vn = h ? (vname.get(h.vendor_id) || h.vendor_id) : "(unknown)";
  const cur = perVendor.get(vn) || { count: 0, total: 0 };
  cur.count += 1;
  cur.total += Number(r.amount);
  perVendor.set(vn, cur);
}
console.log(`\n## per-vendor rollup  (which vendors send credits without a chart_of_account_id)\n`);
console.log("| vendor | count | dollars |");
console.log("|---|---:|---:|");
for (const [v, s] of [...perVendor.entries()].sort((a, b) => a[1].total - b[1].total)) {
  console.log(`| ${v} | ${s.count} | $${s.total.toFixed(2)} |`);
}

console.log(`\n## remediation\n`);
console.log(`For each vendor above:`);
console.log(`  a) Ask them to reissue credits with a chart-of-accounts classification;`);
console.log(`     OR`);
console.log(`  b) Add a per-vendor default mapping in billcom_ref_accounts so the`);
console.log(`     derive step can assign a GL when the credit-line's classification`);
console.log(`     is null (guarded by vendor_id, not a blanket fallback).`);
console.log(``);
console.log(`Until either lands, these dollars are held on our books but appear`);
console.log(`in no KPI surface. On billed_back accounts the effect is masked;`);
console.log(`on any normal account, the credit silently vanishes.`);
