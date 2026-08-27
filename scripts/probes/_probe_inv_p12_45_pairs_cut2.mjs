#!/usr/bin/env node
/*
 * Item 1 cut 2 (Kevin ruling requested):
 *
 * Two more measurements on the 45 pairs:
 *
 *   1. Group by IN-prefix.  "IN " prefix marks a card-network descriptor;
 *      the card network may truncate at a different length than plain
 *      merchant names.  If the len=21/22 cluster is entirely IN-prefixed,
 *      that is a second truncation rule, not noise.
 *
 *   2. Source of each side.  The 45 came from a rippling_spend-only rule,
 *      so both parents ARE rippling_spend by construction.  But some may
 *      have a nearby bill.com twin (same account, same cents, within 5
 *      days of either date) - that would mean the "pair" is really a
 *      rippling->billcom auth-settlement, not a rippling truncation twin.
 *
 * Then split three ways, not two:
 *   - Truncation at 20        : short_len=20 + strict prefix + amounts match + NO bill.com twin
 *   - Truncation at 21/22 IN  : IN-prefix + short_len 21 or 22 + strict prefix + amounts match + NO bill.com twin
 *   - Genuine coincidence     : has bill.com twin OR neither truncation-shape fits
 *
 * Report only.  No writes.
 * Run: node --env-file=.env.local scripts/probes/_probe_inv_p12_45_pairs_cut2.mjs
 */

import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("=== env preflight (PRESENT / ABSENT) ===");
console.log(`SUPABASE_URL:              ${SB_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FYTD_START = "2025-12-29";
const WINDOW_DAYS = 5;
const TWIN_WINDOW_DAYS = 5;
const MIN_PREFIX_LEN = 8;
const today = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(os.homedir(), "Downloads", `inv_p12_45_pairs_cut2_${today}.xlsx`);

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

// ── rebuild the 45 pairs (same rule as cut 1) ────────────────────────
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
      parent,
      merchant: raw.merchant_name || a.vendor_or_merchant || "",
      cents: 0,
      txn_date: a.txn_date,
      account_key: a.account_key,
      gl_line_codes: new Set(),
      anyNonUSD: false,
      lines: 0,
    });
  }
  const p = parentAgg.get(parent);
  const ccy = String(raw.currency || "").toUpperCase();
  if (ccy && ccy !== "USD") p.anyNonUSD = true;
  else p.cents += Math.round(Number(a.amount || 0) * 100);
  p.lines++;
  if (a.txn_date && (!p.txn_date || a.txn_date < p.txn_date)) p.txn_date = a.txn_date;
  if (!p.account_key && a.account_key) p.account_key = a.account_key;
  if (a.gl_line_code) p.gl_line_codes.add(a.gl_line_code);
}
const parents = [...parentAgg.values()].filter(
  (p) => !p.anyNonUSD && p.cents !== 0 && p.merchant && p.txn_date && p.account_key,
);
console.log(`  parents: ${parents.length}`);

const byKey = new Map();
for (const p of parents) {
  const key = JSON.stringify([p.account_key, p.merchant, p.cents]);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(p);
}
const exactPairs = [];
for (const arr of byKey.values()) {
  if (arr.length < 2) continue;
  arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (daysBetween(a.txn_date, b.txn_date) <= WINDOW_DAYS) exactPairs.push({ a, b, days: daysBetween(a.txn_date, b.txn_date), mode: "exact" });
  }
}
const exactKey = (p) => `${p.a.parent}||${p.b.parent}`;
const exactSet = new Set(exactPairs.map(exactKey));

const byGroup = new Map();
for (const p of parents) {
  const key = JSON.stringify([p.account_key, p.cents]);
  if (!byGroup.has(key)) byGroup.set(key, []);
  byGroup.get(key).push(p);
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
      if (a.merchant === b.merchant) tolerant.push({ a, b, days: d, mode: "exact" });
      else if (shorter.length >= MIN_PREFIX_LEN && longer.startsWith(shorter)) tolerant.push({ a, b, days: d, mode: "prefix" });
    }
  }
}
const additional = tolerant.filter((p) => !exactSet.has(exactKey(p)));

const recurrence = new Map();
for (const p of parents) recurrence.set(`${p.merchant}||${p.cents}`, (recurrence.get(`${p.merchant}||${p.cents}`) || 0) + 1);
function recurrenceMax(pair) {
  return Math.max(recurrence.get(`${pair.a.merchant}||${pair.a.cents}`) || 0, recurrence.get(`${pair.b.merchant}||${pair.b.cents}`) || 0);
}
const targeted = additional.filter((p) => recurrenceMax(p) <= 2);
console.log(`\ntargeted (45-pair set): ${targeted.length}`);

// ── load bill.com side for twin check ────────────────────────────────
console.log("\nloading purchasing_actuals billcom FYTD (for twin check)...");
const billcom = await paginate(
  "purchasing_actuals",
  "account_key, txn_date, amount, vendor_or_merchant",
  (q) => q.eq("source", "billcom").eq("excluded", false).gte("txn_date", FYTD_START),
);
console.log(`  billcom rows: ${billcom.length}`);
const billByBucket = new Map(); // key = account|cents -> [{ txn_date, name }]
for (const b of billcom) {
  const cents = Math.round(Number(b.amount || 0) * 100);
  const k = `${b.account_key}|${cents}`;
  if (!billByBucket.has(k)) billByBucket.set(k, []);
  billByBucket.get(k).push({ txn_date: b.txn_date, name: b.vendor_or_merchant });
}

// ── classify + enrich each pair ──────────────────────────────────────
function classify(p) {
  const [shortP, longP] = p.a.merchant.length <= p.b.merchant.length ? [p.a, p.b] : [p.b, p.a];
  const shortName = shortP.merchant;
  const longName  = longP.merchant;
  const shortLen  = shortName.length;
  const longLen   = longName.length;
  const amountsMatch = p.a.cents === p.b.cents;
  const strictPrefix = longName.startsWith(shortName);
  const inPrefix = shortName.startsWith("IN ");
  const cents = p.a.cents;
  const acct = shortP.account_key;

  // bill.com twin: same account, same cents, within TWIN_WINDOW_DAYS of
  // either pair date.
  const bucket = billByBucket.get(`${acct}|${cents}`) || [];
  const twins = bucket.filter(b => {
    if (!b.txn_date) return false;
    return daysBetween(b.txn_date, shortP.txn_date) <= TWIN_WINDOW_DAYS
        || daysBetween(b.txn_date, longP.txn_date)  <= TWIN_WINDOW_DAYS;
  });
  const hasBillcomTwin = twins.length > 0;

  // Three-way class.
  let classLabel;
  if (hasBillcomTwin) {
    classLabel = "genuine coincidence (billcom twin)";
  } else if (strictPrefix && amountsMatch && shortLen === 20) {
    classLabel = "truncation at 20";
  } else if (strictPrefix && amountsMatch && inPrefix && (shortLen === 21 || shortLen === 22)) {
    classLabel = "truncation at 21/22 (IN-prefixed)";
  } else {
    classLabel = "genuine coincidence (other)";
  }

  return {
    class: classLabel,
    account_key: acct,
    amount: cents / 100,
    short_name: shortName,
    short_len: shortLen,
    long_name:  longName,
    long_len:   longLen,
    short_date: shortP.txn_date,
    long_date:  longP.txn_date,
    days_apart: p.days,
    gl_a: [...shortP.gl_line_codes].sort().join("+"),
    gl_b: [...longP.gl_line_codes].sort().join("+"),
    amounts_match: amountsMatch,
    strict_prefix: strictPrefix,
    in_prefix: inPrefix,
    has_billcom_twin: hasBillcomTwin,
    n_billcom_twins: twins.length,
    parent_a: shortP.parent,
    parent_b: longP.parent,
    source_a: "rippling_spend",
    source_b: "rippling_spend",
  };
}

const rows = targeted.map(classify).sort((a, b) => b.amount - a.amount);

// ── summaries ────────────────────────────────────────────────────────
const classGroups = new Map();
for (const r of rows) {
  if (!classGroups.has(r.class)) classGroups.set(r.class, []);
  classGroups.get(r.class).push(r);
}
const sum = (arr) => arr.reduce((s, r) => s + r.amount, 0);

console.log(`\n══ THREE-WAY SPLIT ══`);
for (const [cls, arr] of [...classGroups.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))) {
  console.log(`  ${cls.padEnd(40)}  ${String(arr.length).padStart(3)} pairs   $${sum(arr).toFixed(2)}`);
}
console.log(`  ${"TOTAL".padEnd(40)}  ${String(rows.length).padStart(3)} pairs   $${sum(rows).toFixed(2)}`);

// ── IN-prefix crosstab (Kevin's specific ask) ────────────────────────
console.log(`\n══ IN-prefix crosstab by short_len ══`);
const cross = new Map(); // short_len -> { in: n, non: n, in_$: 0, non_$: 0 }
for (const r of rows) {
  const key = r.short_len;
  if (!cross.has(key)) cross.set(key, { in: 0, non: 0, in_$: 0, non_$: 0 });
  const c = cross.get(key);
  if (r.in_prefix) { c.in++; c.in_$ += r.amount; }
  else             { c.non++; c.non_$ += r.amount; }
}
console.log(`  short_len   IN-prefixed        non-IN`);
for (const [L, c] of [...cross.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  len=${String(L).padStart(3)}     ${String(c.in).padStart(3)} ($${c.in_$.toFixed(2).padStart(9)})    ${String(c.non).padStart(3)} ($${c.non_$.toFixed(2).padStart(9)})`);
}

// ── source pair type ────────────────────────────────────────────────
console.log(`\n══ Source composition ══`);
console.log(`  by construction, all 45 pairs are rippling_spend + rippling_spend`);
console.log(`  (the pair-forming rule queries purchasing_actuals WHERE source='rippling_spend').`);
console.log(`  bill.com twin check (nearby same-account, same-cents bill within 5 days):`);
const withTwin = rows.filter(r => r.has_billcom_twin);
const noTwin   = rows.filter(r => !r.has_billcom_twin);
console.log(`    pairs WITH bill.com twin:    ${withTwin.length}  $${sum(withTwin).toFixed(2)}`);
console.log(`    pairs WITHOUT bill.com twin: ${noTwin.length}    $${sum(noTwin).toFixed(2)}`);

// ── Top 10 ──────────────────────────────────────────────────────────
console.log(`\n══ TOP 10 by amount desc (with class) ══`);
for (let i = 0; i < Math.min(10, rows.length); i++) {
  const r = rows[i];
  console.log(`  ${String(i + 1).padStart(2)}. [${r.class}]  $${r.amount.toFixed(2).padStart(10)}  ${r.account_key.padEnd(10)}  "${r.short_name}" (${r.short_len}) -> "${r.long_name}" (${r.long_len})  d=${r.days_apart}  IN=${r.in_prefix ? "Y" : "N"}  billcomTwin=${r.has_billcom_twin ? r.n_billcom_twins : "0"}`);
}

// ── Workbook ────────────────────────────────────────────────────────
console.log(`\nwriting workbook: ${OUT_PATH}`);
const wb = new ExcelJS.Workbook();
const readme = wb.addWorksheet("Read me");
readme.columns = [{ header: "note", key: "note", width: 120 }];
const notes = [
  `INV-P12 truncation-pair report, cut 2, generated ${today}.`,
  ``,
  `Classifier:`,
  `  - "truncation at 20"                : short_len=20, strict prefix, amounts match, no bill.com twin`,
  `  - "truncation at 21/22 (IN-prefixed)": IN-prefix + short_len 21 or 22, strict prefix, amounts match, no bill.com twin`,
  `  - "genuine coincidence (billcom twin)": has same-account same-cents bill.com row within 5 days`,
  `  - "genuine coincidence (other)"      : everything else`,
  ``,
  `THREE-WAY TOTALS`,
];
for (const [cls, arr] of [...classGroups.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))) {
  notes.push(`  ${cls}: ${arr.length} pairs, $${sum(arr).toFixed(2)}`);
}
notes.push(``);
notes.push(`Source composition: all 45 pairs are rippling_spend + rippling_spend (rule is rippling-only).`);
notes.push(`bill.com twin: ${withTwin.length} with, ${noTwin.length} without.`);
for (const n of notes) readme.addRow({ note: n });

function addSheet(name, list) {
  const sh = wb.addWorksheet(name);
  sh.columns = [
    { header: "class",           key: "class", width: 40 },
    { header: "amount",          key: "amount", width: 13, style: { numFmt: '"$"#,##0.00' } },
    { header: "account_key",     key: "account_key", width: 14 },
    { header: "short_name",      key: "short_name", width: 30 },
    { header: "short_len",       key: "short_len", width: 10 },
    { header: "long_name",       key: "long_name",  width: 42 },
    { header: "long_len",        key: "long_len",  width: 10 },
    { header: "in_prefix",       key: "in_prefix", width: 10 },
    { header: "strict_prefix",   key: "strict_prefix", width: 12 },
    { header: "amounts_match",   key: "amounts_match", width: 13 },
    { header: "has_billcom_twin", key: "has_billcom_twin", width: 15 },
    { header: "n_billcom_twins", key: "n_billcom_twins", width: 15 },
    { header: "short_date",      key: "short_date", width: 12 },
    { header: "long_date",       key: "long_date", width: 12 },
    { header: "days_apart",      key: "days_apart", width: 11 },
    { header: "gl_a",            key: "gl_a", width: 12 },
    { header: "gl_b",            key: "gl_b", width: 12 },
    { header: "source_a",        key: "source_a", width: 15 },
    { header: "source_b",        key: "source_b", width: 15 },
    { header: "parent_a",        key: "parent_a", width: 28 },
    { header: "parent_b",        key: "parent_b", width: 28 },
  ];
  for (const r of list) sh.addRow(r);
}
addSheet("All (sorted, class-tagged)", rows);
for (const [cls, arr] of [...classGroups.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))) {
  addSheet(cls.slice(0, 30), arr);
}

// Crosstab sheet
const shX = wb.addWorksheet("IN-prefix crosstab");
shX.columns = [
  { header: "short_len", key: "L", width: 12 },
  { header: "IN_count", key: "in_n", width: 12 },
  { header: "IN_dollars", key: "in_d", width: 14, style: { numFmt: '"$"#,##0.00' } },
  { header: "nonIN_count", key: "non_n", width: 14 },
  { header: "nonIN_dollars", key: "non_d", width: 15, style: { numFmt: '"$"#,##0.00' } },
];
for (const [L, c] of [...cross.entries()].sort((a, b) => a[0] - b[0])) {
  shX.addRow({ L, in_n: c.in, in_d: c.in_$, non_n: c.non, non_d: c.non_$ });
}

await wb.xlsx.writeFile(OUT_PATH);
console.log(`workbook written: ${OUT_PATH}`);
