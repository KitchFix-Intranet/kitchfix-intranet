#!/usr/bin/env node
/*
 * purchasing_detect_truncation_pairs.mjs
 *
 * Report-only detector for the "pair 46" case.  Same rule as INV-P12's
 * measurement (prefix-tolerant, additional catch, recurrence<=2), but
 * filters OUT parents that are already ruled in
 * `purchasing_truncation_pair_rulings`.  Emits a workbook to
 * ~/Downloads/truncation_pair_candidates_<date>.xlsx.
 *
 * NEVER auto-excludes.  When a new pair appears, Kevin reviews the
 * workbook and decides.  Ruled pairs get INSERTed via a follow-up seed
 * (same shape as the initial 45).
 *
 * Same discipline as the report-only precedence rule: the derive refuses
 * to guess which pair is the same vendor.  The human rules.
 *
 * Exit codes:
 *   0  no new candidates - the derive is caught up
 *   4  new candidates found - workbook written, Kevin needs to rule
 *   2  env absent
 *   1  fatal
 *
 * Env: process.env only.
 * Run: node --env-file=.env.local scripts/purchasing_detect_truncation_pairs.mjs
 */

import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL:              ${SB_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FYTD_START = "2025-12-29";
const WINDOW_DAYS = 5;
const MIN_PREFIX_LEN = 8;
const today = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(os.homedir(), "Downloads", `truncation_pair_candidates_${today}.xlsx`);

function daysBetween(a, b) {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round(Math.abs(db - da) / 86400000);
}
async function paginate(sel, cols, extras = (q) => q, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    let q = supa.from(sel).select(cols).range(from, from + pageSize - 1);
    q = extras(q);
    const { data, error } = await q;
    if (error) throw new Error(`${sel} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// ── Load already-ruled parents ────────────────────────────────────────
console.log("\nloading purchasing_truncation_pair_rulings...");
const { data: rulings, error: rErr } = await supa
  .from("purchasing_truncation_pair_rulings")
  .select("parent_txn_id, partner_parent_txn_id");
if (rErr) { console.error("BLOCKED: rulings read failed:", rErr.message); process.exit(1); }
const ruledParents = new Set();
for (const r of rulings || []) {
  ruledParents.add(r.parent_txn_id);
  ruledParents.add(r.partner_parent_txn_id);
}
console.log(`  ruled parents (either side): ${ruledParents.size}`);

// ── Rebuild candidate pairs ────────────────────────────────────────────
console.log("\nloading purchasing_actuals rippling_spend FYTD...");
const actuals = await paginate(
  "purchasing_actuals",
  "id, source, source_line_id, account_key, excluded, gl_line_code, txn_date, amount, vendor_or_merchant",
  (q) => q.eq("source", "rippling_spend").eq("excluded", false).gte("txn_date", FYTD_START).order("txn_date", { ascending: true }).order("id", { ascending: true }),
);
console.log(`  actuals rows: ${actuals.length}`);
console.log("loading rippling_raw_spend_lines_latest...");
const rawLines = await paginate(
  "rippling_raw_spend_lines_latest",
  "rippling_id, currency, merchant_name, parent_txn_id",
);
console.log(`  raw lines: ${rawLines.length}`);
const rawByRid = new Map();
for (const r of rawLines) rawByRid.set(r.rippling_id, r);

const parentAgg = new Map();
for (const a of actuals) {
  if (!a.source_line_id?.startsWith("rippling_spend:")) continue;
  const rid = a.source_line_id.slice("rippling_spend:".length);
  const raw = rawByRid.get(rid);
  if (!raw?.parent_txn_id) continue;
  const parent = raw.parent_txn_id;
  if (!parentAgg.has(parent)) {
    parentAgg.set(parent, {
      parent, merchant: raw.merchant_name || a.vendor_or_merchant || "",
      cents: 0, txn_date: a.txn_date, account_key: a.account_key,
      anyNonUSD: false,
    });
  }
  const p = parentAgg.get(parent);
  const ccy = String(raw.currency || "").toUpperCase();
  if (ccy && ccy !== "USD") p.anyNonUSD = true;
  else p.cents += Math.round(Number(a.amount || 0) * 100);
  if (a.txn_date && (!p.txn_date || a.txn_date < p.txn_date)) p.txn_date = a.txn_date;
  if (!p.account_key && a.account_key) p.account_key = a.account_key;
}
const parents = [...parentAgg.values()].filter(
  (p) => !p.anyNonUSD && p.cents !== 0 && p.merchant && p.txn_date && p.account_key,
);

const byKey = new Map();
for (const p of parents) {
  const k = JSON.stringify([p.account_key, p.merchant, p.cents]);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(p);
}
const exactSet = new Set();
for (const arr of byKey.values()) {
  if (arr.length < 2) continue;
  arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (daysBetween(a.txn_date, b.txn_date) <= WINDOW_DAYS) exactSet.add(`${a.parent}||${b.parent}`);
  }
}

const byGroup = new Map();
for (const p of parents) {
  const k = JSON.stringify([p.account_key, p.cents]);
  if (!byGroup.has(k)) byGroup.set(k, []);
  byGroup.get(k).push(p);
}
const tolerant = [];
for (const arr of byGroup.values()) {
  if (arr.length < 2) continue;
  arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const d = daysBetween(a.txn_date, b.txn_date);
      if (d > WINDOW_DAYS) continue;
      const [shorter, longer] = a.merchant.length <= b.merchant.length ? [a.merchant, b.merchant] : [b.merchant, a.merchant];
      if (a.merchant === b.merchant) tolerant.push({ a, b, days: d });
      else if (shorter.length >= MIN_PREFIX_LEN && longer.startsWith(shorter)) tolerant.push({ a, b, days: d });
    }
  }
}
const additional = tolerant.filter((p) => !exactSet.has(`${p.a.parent}||${p.b.parent}`));
const recurrence = new Map();
for (const p of parents) recurrence.set(`${p.merchant}||${p.cents}`, (recurrence.get(`${p.merchant}||${p.cents}`) || 0) + 1);
function recMax(pair) {
  return Math.max(recurrence.get(`${pair.a.merchant}||${pair.a.cents}`) || 0, recurrence.get(`${pair.b.merchant}||${pair.b.cents}`) || 0);
}
const targeted = additional.filter((p) => recMax(p) <= 2);

// ── Filter out already-ruled ──────────────────────────────────────────
const candidates = targeted.filter(p => !ruledParents.has(p.a.parent) && !ruledParents.has(p.b.parent));

console.log(`\nrule counts:`);
console.log(`  targeted (would apply):      ${targeted.length}`);
console.log(`  already ruled (skipped):     ${targeted.length - candidates.length}`);
console.log(`  NEW candidates (need ruling): ${candidates.length}`);

if (candidates.length === 0) {
  console.log(`\nno new candidates - the derive is caught up.`);
  process.exit(0);
}

// Build report rows
function toRow(p) {
  const [shortP, longP] = p.a.merchant.length <= p.b.merchant.length ? [p.a, p.b] : [p.b, p.a];
  return {
    amount: p.a.cents / 100,
    account_key: shortP.account_key,
    short_name: shortP.merchant,
    short_len:  shortP.merchant.length,
    long_name:  longP.merchant,
    long_len:   longP.merchant.length,
    short_date: shortP.txn_date,
    long_date:  longP.txn_date,
    days_apart: p.days,
    in_prefix:  shortP.merchant.startsWith("IN "),
    parent_short: shortP.parent,
    parent_long:  longP.parent,
  };
}
const rows = candidates.map(toRow).sort((a, b) => b.amount - a.amount);
const totalDollars = rows.reduce((s, r) => s + r.amount, 0);
console.log(`  candidates total dollars: $${totalDollars.toFixed(2)}`);

console.log(`\nTOP 10:`);
for (let i = 0; i < Math.min(10, rows.length); i++) {
  const r = rows[i];
  console.log(`  ${String(i + 1).padStart(2)}. $${r.amount.toFixed(2).padStart(10)}  ${r.account_key.padEnd(10)}  "${r.short_name}" (${r.short_len}) -> "${r.long_name}" (${r.long_len})  d=${r.days_apart}${r.in_prefix ? "  IN" : ""}`);
}

// ── Workbook ────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
const readme = wb.addWorksheet("Read me");
readme.columns = [{ header: "note", key: "note", width: 120 }];
for (const n of [
  `Truncation-pair candidate detector run ${today}.`,
  `Rule: same as INV-P12 (prefix-tolerant, min prefix 8, 5-day window,`,
  `      additional-catch (not already caught by exact-match auth_pair),`,
  `      recurrence <= 2).`,
  `Filter: parents already in purchasing_truncation_pair_rulings are skipped.`,
  ``,
  `SUMMARY`,
  `  targeted total:              ${targeted.length}`,
  `  already ruled (skipped):     ${targeted.length - candidates.length}`,
  `  NEW candidates need ruling:  ${candidates.length}`,
  `  candidates total dollars:    $${totalDollars.toFixed(2)}`,
  ``,
  `Next step: Kevin reviews each candidate.  Ruled parents get INSERTed`,
  `via scripts/purchasing_seed_truncation_pair_rulings.mjs (same seed shape`,
  `as the initial 45).  Never auto-apply.`,
]) readme.addRow({ note: n });

const sh = wb.addWorksheet("New candidates");
sh.columns = [
  { header: "amount", key: "amount", width: 13, style: { numFmt: '"$"#,##0.00' } },
  { header: "account_key", key: "account_key", width: 14 },
  { header: "short_name", key: "short_name", width: 30 },
  { header: "short_len", key: "short_len", width: 10 },
  { header: "long_name", key: "long_name", width: 42 },
  { header: "long_len", key: "long_len", width: 10 },
  { header: "short_date", key: "short_date", width: 12 },
  { header: "long_date", key: "long_date", width: 12 },
  { header: "days_apart", key: "days_apart", width: 11 },
  { header: "in_prefix", key: "in_prefix", width: 10 },
  { header: "parent_short", key: "parent_short", width: 28 },
  { header: "parent_long", key: "parent_long", width: 28 },
];
for (const r of rows) sh.addRow(r);

await wb.xlsx.writeFile(OUT_PATH);
console.log(`\nworkbook: ${OUT_PATH}`);
console.log(`exit 4: new candidates present.`);
process.exit(4);
