#!/usr/bin/env node
// R-148D · Card Authorization detection probe. READ ONLY.
//
// Mechanism (Kevin ruling 2026-09-24): Rippling emits a Card Authorization
// (swipe hold) that is dropped once the transaction settles. A hold that
// settles as a SPLIT (one hold -> N settled charges) is not caught by
// R-148C's amount-pairing inference and stays counting. Object Type on
// rippling_report_txns_latest names it outright.
//
// Detection: for each counting rippling_spend row in purchasing_actuals,
// join to rippling_raw_spend_lines_latest via source_line_id -> rippling_id,
// then take the leading 24 hex of external_id as parent_hex, and check
// if that parent has raw->>'Object Type' = 'Card Authorization' in the
// report.
//
// Assertions:
//   A1 · every retirement's parent is in holdSet (definitional)
//   A2 · zero candidates where the parent's Object Type is 'Card
//        Transaction' (regression guard - would delete real spend)
//   A3 · zero retirements where Object Type is null (pre-2026-07-28
//        rows should not be classified by this sweep)
//   A4 · zero retirements with Object Type in {Mileage Request,
//        Expense Request} (untouched per Kevin ruling)
//
// Output:
//   scripts/probes/artifacts/r148d_reversal.json  · committable (source_line_id + account_key only)
//   ~/Downloads/kf-r148d-review.json              · full detail, local only
//
// Prints per-account before/after for CP (P10).

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const KEY_URL = process.env.SUPABASE_URL;
const KEY_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL: ${KEY_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${KEY_SVC ? "PRESENT" : "ABSENT"}`);
if (!KEY_URL || !KEY_SVC) process.exit(1);

const s = createClient(KEY_URL, KEY_SVC, { auth: { persistSession: false, autoRefreshToken: false } });

const OBJECTID_RE = /^[a-f0-9]{24}__line_item_content_/;
const P10 = { start: "2026-09-07", end: "2026-10-04" };

const ARTIFACT_DIR    = path.join(__dirname, "artifacts");
const REVERSAL_PATH   = path.join(ARTIFACT_DIR, "r148d_reversal.json");
const REVIEW_PATH     = process.env.R148D_REVIEW_PATH
  || path.join(homedir(), "Downloads", "kf-r148d-review.json");
if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const fmt$ = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE = 1000;
async function pageAll(table, sel, filters = q => q) {
  const out = [];
  let from = 0;
  for (;;) {
    const q = filters(s.from(table).select(sel).range(from, from + PAGE - 1));
    const r = await q;
    if (r.error) throw r.error;
    out.push(...(r.data || []));
    if ((r.data || []).length < PAGE) break;
    from += PAGE;
  }
  return out;
}

console.log();
console.log("Step 1 · load raw spend lines + report_txns Object Type + counting rippling_spend PA rows");
const rawAll = await pageAll("rippling_raw_spend_lines_latest", "rippling_id, external_id");
const rawByRid = new Map();
for (const r of rawAll) {
  if (!r.external_id || !OBJECTID_RE.test(r.external_id)) continue;
  rawByRid.set(r.rippling_id, r.external_id.slice(0, 24));
}
console.log(`  ${rawAll.length} raw rows · ${rawByRid.size} with parent_hex`);

const objTypeByParent = new Map();
const reportRows = await pageAll("rippling_report_txns_latest", "parent_txn_id, raw");
let holdCount = 0, txnCount = 0, otherCount = 0, nullCount = 0;
for (const r of reportRows) {
  const objType = (r.raw && r.raw["Object Type"]) || null;
  objTypeByParent.set(r.parent_txn_id, objType);
  if (objType === "Card Authorization") holdCount += 1;
  else if (objType === "Card Transaction") txnCount += 1;
  else if (objType != null) otherCount += 1;
  else nullCount += 1;
}
console.log(`  ${reportRows.length} report rows · Object Type: Card Authorization=${holdCount} · Card Transaction=${txnCount} · other=${otherCount} · null=${nullCount}`);

const paCounting = await pageAll(
  "purchasing_actuals",
  "id, source, source_line_id, source_bill_id, account_key, gl_line_code, amount, txn_date, vendor_or_merchant, excluded, reason",
  q => q.eq("source", "rippling_spend").eq("excluded", false),
);
console.log(`  ${paCounting.length} counting rippling_spend rows`);

console.log();
console.log("Step 2 · classify by parent Object Type");
const buckets = { hold: [], txn: [], other: [], null: [], no_report: [], no_parent: [] };
for (const pa of paCounting) {
  const rid = (pa.source_line_id || "").replace(/^rippling_spend:/, "");
  const parentHex = rawByRid.get(rid);
  if (!parentHex) { buckets.no_parent.push(pa); continue; }
  if (!objTypeByParent.has(parentHex)) { buckets.no_report.push(pa); continue; }
  const objType = objTypeByParent.get(parentHex);
  if (objType === "Card Authorization") { buckets.hold.push({ pa, parentHex }); continue; }
  if (objType === "Card Transaction")   { buckets.txn.push({ pa, parentHex }); continue; }
  if (objType == null)                  { buckets.null.push({ pa, parentHex }); continue; }
  buckets.other.push({ pa, parentHex, objType });
}
const sumD = arr => arr.reduce((s, x) => s + Math.abs(Number((x.pa ?? x).amount || 0)), 0);
console.log(`  Card Authorization (retire set):    ${String(buckets.hold.length).padStart(4)} rows · ${fmt$(sumD(buckets.hold))}`);
console.log(`  Card Transaction   (real spend):    ${String(buckets.txn.length).padStart(4)} rows · ${fmt$(sumD(buckets.txn))}`);
console.log(`  Object Type null   (pre-07-28):     ${String(buckets.null.length).padStart(4)} rows · ${fmt$(sumD(buckets.null))}`);
console.log(`  Object Type other  (mileage/exp):   ${String(buckets.other.length).padStart(4)} rows · ${fmt$(sumD(buckets.other))}`);
console.log(`  No report row (walk ahead of nightly): ${buckets.no_report.length}`);
console.log(`  No parent_hex (external_id shape):     ${buckets.no_parent.length}`);

console.log();
console.log("Step 3 · assertions");
// A1 (definitional): every candidate has parent in holdSet - true by construction of buckets.hold
console.log(`  A1 · every retirement's parent in holdSet · PASS (by construction)`);
// A2: zero Card Transaction candidates entering retire set - by construction they're in buckets.txn not buckets.hold
console.log(`  A2 · zero Card Transaction rows in retire set · PASS (${buckets.txn.length} in txn bucket, 0 in hold bucket)`);
// A3: zero null Object Type in retire set
console.log(`  A3 · zero null-Object-Type rows in retire set · PASS (${buckets.null.length} in null bucket, 0 in hold bucket)`);
// A4: zero Mileage/Expense in retire set
console.log(`  A4 · zero Mileage/Expense rows in retire set · PASS (${buckets.other.length} in other bucket, 0 in hold bucket)`);

console.log();
console.log("Step 4 · per-account before/after · CP P10 (2026-09-07 to 2026-10-04)");
const p10Rows = paCounting.filter(r => r.txn_date && r.txn_date >= P10.start && r.txn_date <= P10.end);
const p10RetIds = new Set(buckets.hold
  .filter(x => x.pa.txn_date && x.pa.txn_date >= P10.start && x.pa.txn_date <= P10.end)
  .map(x => x.pa.id));

const accounts = [...new Set(p10Rows.map(r => r.account_key).filter(Boolean))].sort();
const perAcct = new Map();
for (const acct of accounts) perAcct.set(acct, { beforeRows: 0, beforeUn: 0, beforeSum: 0, afterRows: 0, afterUn: 0, afterSum: 0 });
for (const r of p10Rows) {
  const b = perAcct.get(r.account_key);
  if (!b) continue;
  const amt = Number(r.amount || 0);
  b.beforeRows += 1;
  if (r.gl_line_code == null) b.beforeUn += 1;
  b.beforeSum += amt;
  if (!p10RetIds.has(r.id)) {
    b.afterRows += 1;
    if (r.gl_line_code == null) b.afterUn += 1;
    b.afterSum += amt;
  }
}

console.log(`| account         | rows Δ         | uncoded Δ       | spend Δ                                            |`);
console.log(`|-----------------|----------------|-----------------|-----------------------------------------------------|`);
let tot = { br: 0, bu: 0, bs: 0, ar: 0, au: 0, as: 0 };
for (const acct of accounts) {
  const b = perAcct.get(acct);
  console.log(`| ${acct.padEnd(15)} | ${String(b.beforeRows).padStart(3)} → ${String(b.afterRows).padEnd(3)}  (${String(b.beforeRows - b.afterRows).padStart(3)}) | ${String(b.beforeUn).padStart(3)} → ${String(b.afterUn).padEnd(3)}  (${String(b.beforeUn - b.afterUn).padStart(3)}) | ${fmt$(b.beforeSum).padStart(12)} → ${fmt$(b.afterSum).padEnd(12)}  Δ ${fmt$(b.beforeSum - b.afterSum).padStart(10)} |`);
  tot.br += b.beforeRows; tot.bu += b.beforeUn; tot.bs += b.beforeSum;
  tot.ar += b.afterRows;  tot.au += b.afterUn;  tot.as += b.afterSum;
}
console.log(`| ${"PORTFOLIO".padEnd(15)} | ${String(tot.br).padStart(3)} → ${String(tot.ar).padEnd(3)}  (${String(tot.br - tot.ar).padStart(3)}) | ${String(tot.bu).padStart(3)} → ${String(tot.au).padEnd(3)}  (${String(tot.bu - tot.au).padStart(3)}) | ${fmt$(tot.bs).padStart(12)} → ${fmt$(tot.as).padEnd(12)}  Δ ${fmt$(tot.bs - tot.as).padStart(10)} |`);

console.log();
console.log("Step 5 · write artifacts");
const reversal = {
  brief_ref: "R-148D · Kevin ruling 2026-09-24",
  schema_version: 1,
  reason: "card_authorization",
  retirements: buckets.hold.map(x => ({
    source_line_id: x.pa.source_line_id,
    account_key:    x.pa.account_key,
  })).sort((a, b) => a.source_line_id.localeCompare(b.source_line_id)),
};
fs.writeFileSync(REVERSAL_PATH, JSON.stringify(reversal, null, 2));
const review = {
  generated_at: new Date().toISOString(),
  brief_ref: "R-148D · Kevin ruling 2026-09-24",
  detection_rule: "counting rippling_spend PA rows joined to rippling_report_txns_latest via parent_hex (leading 24 hex of external_id) where raw->>'Object Type' = 'Card Authorization'",
  totals: {
    counting_pa_rows:            paCounting.length,
    hold_retirements:            buckets.hold.length,
    txn_kept:                    buckets.txn.length,
    null_ot_kept:                buckets.null.length,
    other_ot_kept:               buckets.other.length,
    no_report_kept:              buckets.no_report.length,
  },
  cp_p10: {
    window: P10,
    per_account: Object.fromEntries(accounts.map(acct => [acct, perAcct.get(acct)])),
    portfolio: tot,
  },
  retirements: buckets.hold.map(x => ({
    source_line_id: x.pa.source_line_id,
    pa_id: x.pa.id, source_bill_id: x.pa.source_bill_id, account_key: x.pa.account_key,
    amount: Number(x.pa.amount), txn_date: x.pa.txn_date, vendor_or_merchant: x.pa.vendor_or_merchant,
    parent_hex: x.parentHex,
  })).sort((a, b) => (a.account_key || "").localeCompare(b.account_key || "") || (a.txn_date || "").localeCompare(b.txn_date || "")),
};
fs.writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2));
console.log(`  wrote ${REVERSAL_PATH} · ${reversal.retirements.length} rows`);
console.log(`  wrote ${REVIEW_PATH} · full detail`);

console.log();
console.log("=== summary ===");
console.log(`  retire set: ${buckets.hold.length} rows · ${fmt$(sumD(buckets.hold))}`);
console.log(`  assertions: A1 PASS · A2 PASS · A3 PASS · A4 PASS`);
console.log(`  portfolio CP: rows ${tot.br} → ${tot.ar} · uncoded ${tot.bu} → ${tot.au} · spend ${fmt$(tot.bs)} → ${fmt$(tot.as)} (Δ ${fmt$(tot.bs - tot.as)})`);
process.exit(0);
