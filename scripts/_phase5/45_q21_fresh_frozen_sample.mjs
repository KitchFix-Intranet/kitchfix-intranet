// Q21 analyst decision: produce a 30-row stratified sample for chef spot-check
// on fresh/frozen classifier. Stratified across three accounts, weighted
// toward spend. Not our decision - just delivery.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, round2 } from "./_common5.mjs";

const rows = JSON.parse(fs.readFileSync(P.AUG, "utf8")).rows;
const CLS = JSON.parse(fs.readFileSync(P.CLS, "utf8"));

// Classifications keyed by vendor_id::description
const clsBy = new Map();
const items = CLS.items || {};
for (const k of Object.keys(items)) {
  clsBy.set(k, items[k]);
}

function classifyStorage(row) {
  const key = `${row.vendor_id}::${row.description}`;
  const c = clsBy.get(key);
  if (!c) return { verdict: "unknown", confidence: 0, reason: "not in cache" };
  return {
    verdict: c.storage_axis ?? "unknown",
    confidence: c.storage_confidence ?? 0,
    reason: c.storage_reason ?? "",
  };
}

function accountKey(a) { return (a || "").replace(" - ", "-"); }

// Group by (account, vendor_id, description) - one row per SKU per account
const bySku = {};
for (const r of rows) {
  const cat = String(r.category || "").toLowerCase();
  // Restrict to food categories where fresh/frozen matters most
  if (!["protein","poultry","meat","seafood","dairy","produce","frozen"].includes(cat)) continue;
  const key = `${accountKey(r.account_label)}|${r.vendor_id}|${r.description}`;
  bySku[key] = bySku[key] || {
    account: accountKey(r.account_label), vendor_id: r.vendor_id, vendor_name: r.vendor_name,
    description: r.description, category: cat,
    rows: 0, spend: 0,
  };
  bySku[key].rows++;
  bySku[key].spend += Number(r.extended_price) || 0;
}
// Attach classifier
const skuItems = Object.values(bySku).map(x => {
  const c = classifyStorage({ vendor_id: x.vendor_id, description: x.description });
  return { ...x, storage_axis: c.verdict, storage_confidence: c.confidence, storage_reason: c.reason };
});

// Stratified sample: pick 10 per account, weighted by spend
const sample = [];
for (const acct of ["TBR-FL", "TBJ-FL", "STL-FL"]) {
  const list = skuItems.filter(i => i.account === acct)
    .sort((a,b) => b.spend - a.spend);
  // Pick a spend-weighted mix: 4 top-spend, 3 mid, 3 tail with confidence variety
  const picks = new Set();
  const push = (i) => picks.add(i);
  for (const i of list.slice(0, 4)) push(i);
  const mid = list.slice(Math.floor(list.length / 3), Math.floor(list.length * 2 / 3));
  for (let k = 0; k < Math.min(3, mid.length); k++) push(mid[Math.floor(mid.length * k / 3)]);
  const tail = list.slice(Math.floor(list.length * 2 / 3));
  for (let k = 0; k < Math.min(3, tail.length); k++) push(tail[Math.floor(tail.length * k / 3)]);
  for (const p of picks) sample.push({ ...p, sample_account: acct });
}
// Trim to 30
const sample30 = sample.slice(0, 30);
console.log(`sample: ${sample30.length} rows`);
for (const s of sample30.slice(0, 10)) {
  console.log(`  ${s.sample_account} ${s.category.padEnd(8)} ${(s.description||"").slice(0,50).padEnd(50)} ${s.storage_axis.padEnd(12)} conf=${s.storage_confidence}`);
}
fs.writeFileSync(P5.Q21_SAMPLE, JSON.stringify({
  method: "10 per account, top-4 spend + 3 mid-spend + 3 tail = 30 SKUs total; stratified",
  sample: sample30,
}, null, 2));
console.log(`\nwrote ${P5.Q21_SAMPLE}`);
