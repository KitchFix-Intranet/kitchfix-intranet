#!/usr/bin/env node
// Categorize vendor credits: rebates vs short-delivery vs other.
//
// Kevin ruling 2026-09-04: "$3,502 of TXR - AZ's $4,397 is rebate
// money and only $877 is short-delivery credits. Those are different
// things operationally - a rebate is earned volume, a short is a
// delivery failure. Worth keeping them distinguishable if the credit
// description supports it."
//
// Classification rules (reference_number patterns):
//   /^Q\d\d{2}REB/i      -> "rebate_quarterly"  (Shamrock Q<qtr><yy>REB rebates - e.g. Q226REB)
//   /^[A-Z]{3}\d{2}REB/i -> "rebate_monthly"    (Shamrock MMM YY REB rebates - e.g. MAR26REB)
//   /REB/i               -> "rebate_other"      (any other REB-tagged, catch-all)
//   default              -> "short_delivery"    (everything else)
//
// The default lumps short-deliveries with any other adjustment credit.
// Refinable later if description text becomes available.
//
// Usage: node --env-file=.env.local scripts/probes/_probe_r71_credit_type_split.mjs [account]

import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const acctFilter = process.argv[2] || null;

function classify(ref) {
  if (!ref) return "short_delivery";
  const r = String(ref).toUpperCase();
  if (/^Q\d\d{2}REB/.test(r)) return "rebate_quarterly";
  if (/^[A-Z]{3}\d{2}REB/.test(r)) return "rebate_monthly";
  if (/REB/.test(r)) return "rebate_other";
  return "short_delivery";
}

// Pull all credit rows + their raw headers
let q = supa
  .from("purchasing_actuals")
  .select("account_key, txn_date, amount, source_bill_id")
  .eq("source", "billcom_credit");
if (acctFilter) q = q.eq("account_key", acctFilter);

const { data: pa, error } = await q;
if (error) throw error;
const rows = pa || [];

const creditIds = [...new Set(rows.map(r => r.source_bill_id))];
const { data: heads } = await supa
  .from("billcom_raw_vendor_credits_latest")
  .select("credit_id, vendor_id, reference_number")
  .in("credit_id", creditIds);
const vendorIds = [...new Set(heads.map(h => h.vendor_id).filter(Boolean))];
const { data: vends } = await supa.from("billcom_ref_vendors").select("id, name").in("id", vendorIds);
const vname = new Map((vends || []).map(v => [v.id, v.name]));
const hbyid = new Map(heads.map(h => [h.credit_id, h]));

// Rollup by account and type
const perAcct = new Map();
for (const r of rows) {
  const h = hbyid.get(r.source_bill_id);
  const cls = classify(h?.reference_number);
  const a = perAcct.get(r.account_key) || { rebate_quarterly: 0, rebate_monthly: 0, rebate_other: 0, short_delivery: 0 };
  a[cls] += Number(r.amount);
  perAcct.set(r.account_key, a);
}

console.log(`# Credit type split  ·  ${new Date().toISOString().slice(0, 10)}${acctFilter ? "  ·  " + acctFilter : ""}\n`);
console.log("Classification by reference_number pattern (rebate_* = Shamrock REB tags; short_delivery = default).\n");

console.log("| account | quarterly rebate | monthly rebate | other rebate | short-delivery | total |");
console.log("|---|---:|---:|---:|---:|---:|");
const accts = [...perAcct.keys()].sort();
let tot = { rebate_quarterly: 0, rebate_monthly: 0, rebate_other: 0, short_delivery: 0 };
for (const a of accts) {
  const v = perAcct.get(a);
  const total = v.rebate_quarterly + v.rebate_monthly + v.rebate_other + v.short_delivery;
  for (const k of Object.keys(tot)) tot[k] += v[k];
  console.log(`| ${a} | $${v.rebate_quarterly.toFixed(2)} | $${v.rebate_monthly.toFixed(2)} | $${v.rebate_other.toFixed(2)} | $${v.short_delivery.toFixed(2)} | $${total.toFixed(2)} |`);
}
const grand = tot.rebate_quarterly + tot.rebate_monthly + tot.rebate_other + tot.short_delivery;
console.log(`| **total** | **$${tot.rebate_quarterly.toFixed(2)}** | **$${tot.rebate_monthly.toFixed(2)}** | **$${tot.rebate_other.toFixed(2)}** | **$${tot.short_delivery.toFixed(2)}** | **$${grand.toFixed(2)}** |`);

// TXR-AZ P4 detail (Kevin's specific ask)
if (!acctFilter || acctFilter === "TXR - AZ") {
  console.log(`\n## TXR - AZ P4 breakdown by classification\n`);
  const P4_S = "2026-03-23", P4_E = "2026-04-19";
  const p4 = rows.filter(r => r.account_key === "TXR - AZ" && r.txn_date >= P4_S && r.txn_date <= P4_E);
  const buckets = { rebate_quarterly: [], rebate_monthly: [], rebate_other: [], short_delivery: [] };
  for (const r of p4) {
    const h = hbyid.get(r.source_bill_id);
    const cls = classify(h?.reference_number);
    buckets[cls].push({ txn_date: r.txn_date, amount: r.amount, ref: h?.reference_number || "-", vendor: vname.get(h?.vendor_id) || "?" });
  }
  for (const [cls, list] of Object.entries(buckets)) {
    if (list.length === 0) continue;
    const sum = list.reduce((a, x) => a + Number(x.amount), 0);
    console.log(`\n**${cls}** (${list.length} lines · $${sum.toFixed(2)}):`);
    for (const x of list.sort((a, b) => a.amount - b.amount)) {
      console.log(`  - ${x.txn_date}  $${Number(x.amount).toFixed(2).padStart(10)}  ${x.vendor}  ref=${x.ref}`);
    }
  }
}
