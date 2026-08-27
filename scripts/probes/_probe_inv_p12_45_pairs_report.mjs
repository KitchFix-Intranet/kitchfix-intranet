#!/usr/bin/env node
/*
 * Item 1 (Kevin ruling requested):
 *
 * Re-run INV-P12's truncation-blind pair rule and emit ONE ROW PER PAIR
 * in the shape Kevin asked for.  Report only - no writes, no rule apply.
 *
 * Rule (from INV-P12):
 *   Non-excluded rippling_spend parents, FYTD.  Group by (account_key,
 *   amount_cents).  Within group, form all (A, B) pairs where days between
 *   <= 5 and one merchant is a strict prefix of the other (min shared
 *   prefix length 8).  Then filter to "additional catch" (prefix != exact)
 *   and recurrenceMax <= 2 to drop contract-shaped repeaters.
 *
 * Kevin's fields per pair:
 *   - short_name + long_name
 *   - short_len (flag if != 20) + long_len
 *   - amount + amount_a + amount_b + amounts_match
 *   - short_date + long_date + days_between
 *   - account_key + gl_line_code_a + gl_line_code_b
 *
 * Sort by amount desc.  Split:
 *   - CONFIDENT   : short_len == 20 AND long.startsWith(short) AND amounts match to the cent
 *   - EVERYTHING ELSE : say what makes each one different (short_len_off / not_strict_prefix / amount_off)
 *
 * Env: read via process.env only (PRESENT/ABSENT reported).
 * Run: `node --env-file=.env.local scripts/probes/_probe_inv_p12_45_pairs_report.mjs`
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
if (!SB_URL || !SB_KEY) {
  console.error("BLOCKED: Supabase env not present.");
  process.exit(2);
}

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FYTD_START = "2025-12-29";
const WINDOW_DAYS = 5;
const MIN_PREFIX_LEN = 8;
const today = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(os.homedir(), "Downloads", `inv_p12_45_pairs_report_${today}.xlsx`);

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

console.log(`\nloading purchasing_actuals (rippling_spend, non-excluded, FYTD)...`);
const actuals = await paginate(
  "purchasing_actuals",
  "id, source, source_line_id, account_key, excluded, gl_line_code, txn_date, amount, vendor_or_merchant",
  (q) => q.eq("source", "rippling_spend").eq("excluded", false).gte("txn_date", FYTD_START).order("txn_date", { ascending: true }).order("id", { ascending: true }),
);
console.log(`  actuals rows: ${actuals.length}`);

console.log(`loading rippling_raw_spend_lines_latest (for parent + merchant)...`);
const rawLines = await paginate(
  "rippling_raw_spend_lines_latest",
  "rippling_id, currency, merchant_name, parent_txn_id",
);
console.log(`  raw lines: ${rawLines.length}`);

const rawByRid = new Map();
for (const r of rawLines) rawByRid.set(r.rippling_id, r);

// Parent-level aggregation.
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
console.log(`  parents (non-excluded, USD, non-zero): ${parents.length}`);

// Exact-match pairs (baseline).
function pairsExact(parents) {
  const byKey = new Map();
  for (const p of parents) {
    const key = JSON.stringify([p.account_key, p.merchant, p.cents]);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  const pairs = [];
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      if (daysBetween(a.txn_date, b.txn_date) <= WINDOW_DAYS) pairs.push({ a, b, mode: "exact" });
    }
  }
  return pairs;
}

// Truncation-blind pairs (exact OR strict-prefix, min 8).
function pairsPrefixTolerant(parents) {
  const byGroup = new Map();
  for (const p of parents) {
    const key = JSON.stringify([p.account_key, p.cents]);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(p);
  }
  const pairs = [];
  for (const arr of byGroup.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const d = daysBetween(a.txn_date, b.txn_date);
        if (d > WINDOW_DAYS) continue;
        const [shorter, longer] = a.merchant.length <= b.merchant.length ? [a.merchant, b.merchant] : [b.merchant, a.merchant];
        let related = false, mode = null;
        if (a.merchant === b.merchant) { related = true; mode = "exact"; }
        else if (shorter.length >= MIN_PREFIX_LEN && longer.startsWith(shorter)) { related = true; mode = "prefix"; }
        if (related) pairs.push({ a, b, days: d, mode });
      }
    }
  }
  return pairs;
}

const exactPairs = pairsExact(parents);
const tolerant   = pairsPrefixTolerant(parents);
const exactKey   = (p) => `${p.a.parent}||${p.b.parent}`;
const exactSet   = new Set(exactPairs.map(exactKey));
const additional = tolerant.filter((p) => !exactSet.has(exactKey(p)));

// Recurrence filter (recurrenceMax <= 2 to drop contract repeaters).
const recurrence = new Map();
for (const p of parents) {
  const key = `${p.merchant}||${p.cents}`;
  recurrence.set(key, (recurrence.get(key) || 0) + 1);
}
function recurrenceMax(pair) {
  const kA = `${pair.a.merchant}||${pair.a.cents}`;
  const kB = `${pair.b.merchant}||${pair.b.cents}`;
  return Math.max(recurrence.get(kA) || 0, recurrence.get(kB) || 0);
}
const targeted = additional.filter((p) => recurrenceMax(p) <= 2);

console.log(`\nrule counts:`);
console.log(`  exact-match pairs:              ${exactPairs.length}`);
console.log(`  tolerant (exact + prefix):      ${tolerant.length}`);
console.log(`  additional catch (prefix-only): ${additional.length}`);
console.log(`  after recurrence <= 2:          ${targeted.length}   <-- this is the 45-pair set`);
const targetedDollars = targeted.reduce((s, p) => s + p.a.cents / 100, 0);
console.log(`  dollars(one-side):              $${targetedDollars.toFixed(2)}`);

// ── Per-pair row build in Kevin's shape ───────────────────────────────
// Convention: A is the shorter merchant, B is the longer.  Amount matches
// by construction (grouped on cents), but we recompute + report so Kevin
// can see the comparison rather than trust the invariant.
function pairRow(p) {
  const [shortP, longP] = p.a.merchant.length <= p.b.merchant.length ? [p.a, p.b] : [p.b, p.a];
  const shortName = shortP.merchant;
  const longName  = longP.merchant;
  const shortLen  = shortName.length;
  const longLen   = longName.length;
  const amountA   = p.a.cents / 100;
  const amountB   = p.b.cents / 100;
  const amountsMatch = p.a.cents === p.b.cents;
  const strictPrefix = longName.startsWith(shortName);
  const daysApart = p.days;
  const confidentShortLen = shortLen === 20;
  const confident = confidentShortLen && strictPrefix && amountsMatch;
  const reasons = [];
  if (!confidentShortLen) reasons.push(`short_len=${shortLen} (want 20)`);
  if (!strictPrefix)      reasons.push(`long does NOT start with short`);
  if (!amountsMatch)      reasons.push(`amounts differ`);
  return {
    account_key: shortP.account_key,
    amount: amountA,
    amount_a: amountA,
    amount_b: amountB,
    amounts_match: amountsMatch,
    short_name: shortName,
    long_name:  longName,
    short_len: shortLen,
    long_len:  longLen,
    short_len_20: confidentShortLen,
    strict_prefix: strictPrefix,
    short_date: shortP.txn_date,
    long_date:  longP.txn_date,
    days_apart: daysApart,
    gl_a: [...shortP.gl_line_codes].sort().join("+") || "",
    gl_b: [...longP.gl_line_codes].sort().join("+") || "",
    parent_a: shortP.parent,
    parent_b: longP.parent,
    confident,
    disqualifiers: reasons.join(" | "),
  };
}

const rows = targeted.map(pairRow).sort((a, b) => b.amount - a.amount);
const confident   = rows.filter(r => r.confident);
const everythingElse = rows.filter(r => !r.confident);
const sumConfident = confident.reduce((s, r) => s + r.amount, 0);
const sumElse      = everythingElse.reduce((s, r) => s + r.amount, 0);

// Also count how many short_len != 20 among all rows (Kevin flagged this).
const shortNot20 = rows.filter(r => !r.short_len_20);
console.log(`\nsplit:`);
console.log(`  CONFIDENT:        ${confident.length} pairs   $${sumConfident.toFixed(2)}`);
console.log(`  EVERYTHING ELSE:  ${everythingElse.length} pairs   $${sumElse.toFixed(2)}`);
console.log(`  total:            ${rows.length} pairs   $${(sumConfident + sumElse).toFixed(2)}`);
console.log(`\nflag: short_len != 20:  ${shortNot20.length} pairs`);
if (shortNot20.length > 0) {
  const dist = new Map();
  for (const r of shortNot20) dist.set(r.short_len, (dist.get(r.short_len) || 0) + 1);
  console.log("  distribution:");
  for (const [L, n] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    len=${L}  count=${n}`);
  }
}

// ── Top 10 preview ─────────────────────────────────────────────────
console.log(`\nTOP 10 by amount desc:`);
for (let i = 0; i < Math.min(10, rows.length); i++) {
  const r = rows[i];
  const tag = r.confident ? "OK" : "??";
  console.log(`  ${String(i + 1).padStart(2)}. [${tag}] $${r.amount.toFixed(2).padStart(10)}  ${r.account_key.padEnd(10)}  "${r.short_name}" (${r.short_len}) -> "${r.long_name}" (${r.long_len})  d=${r.days_apart}${r.disqualifiers ? "  " + r.disqualifiers : ""}`);
}

// ── Workbook ──────────────────────────────────────────────────────
console.log(`\nwriting workbook: ${OUT_PATH}`);
const wb = new ExcelJS.Workbook();

const readme = wb.addWorksheet("Read me");
readme.columns = [{ header: "note", key: "note", width: 120 }];
for (const n of [
  `INV-P12 truncation-pair report generated ${today}.`,
  `Rule: non-excluded rippling_spend parents FYTD, group by (account, amount_cents),`,
  `      pair within 5 days, merchant one is strict prefix of other (min 8 chars),`,
  `      prefix-only (drop already-caught exact matches), recurrenceMax <= 2.`,
  ``,
  `TOTALS`,
  `  targeted pairs (this report):  ${rows.length}   $${(sumConfident + sumElse).toFixed(2)}`,
  `  CONFIDENT   (short=20 + strict prefix + amounts match): ${confident.length}   $${sumConfident.toFixed(2)}`,
  `  EVERYTHING ELSE:                                        ${everythingElse.length}   $${sumElse.toFixed(2)}`,
  ``,
  `Read me:`,
  `  - Confident sheet lists the pairs that satisfy all three tests.  Kevin rules on Confident.`,
  `  - Everything Else sheet lists the pairs missing at least one test, with "disqualifiers" naming which.`,
  `  - Sort: amount descending on both sheets.  Top ten warrant careful read, rest are skim.`,
  `  - short_len flag: any short_name whose length != 20 is a candidate for "not actually truncated" - Rippling truncates at 20.`,
  `  - amount_a and amount_b are the two rows' amounts; amounts_match is true when identical to the cent.`,
  `    Pairs are formed by grouping on cents so this is true by construction; kept in the report as a check on that invariant.`,
]) readme.addRow({ note: n });

function addPairSheet(name, list) {
  const sh = wb.addWorksheet(name);
  sh.columns = [
    { header: "amount",         key: "amount", width: 13, style: { numFmt: '"$"#,##0.00' } },
    { header: "account_key",    key: "account_key", width: 14 },
    { header: "short_name",     key: "short_name", width: 30 },
    { header: "short_len",      key: "short_len", width: 10 },
    { header: "long_name",      key: "long_name",  width: 42 },
    { header: "long_len",       key: "long_len",  width: 10 },
    { header: "amount_a",       key: "amount_a", width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "amount_b",       key: "amount_b", width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "amounts_match",  key: "amounts_match", width: 15 },
    { header: "short_date",     key: "short_date", width: 12 },
    { header: "long_date",      key: "long_date", width: 12 },
    { header: "days_apart",     key: "days_apart", width: 12 },
    { header: "gl_line_code_a", key: "gl_a", width: 15 },
    { header: "gl_line_code_b", key: "gl_b", width: 15 },
    { header: "short_len_20",   key: "short_len_20", width: 14 },
    { header: "strict_prefix",  key: "strict_prefix", width: 14 },
    { header: "disqualifiers",  key: "disqualifiers", width: 48 },
    { header: "parent_a",       key: "parent_a", width: 28 },
    { header: "parent_b",       key: "parent_b", width: 28 },
  ];
  for (const r of list) sh.addRow(r);
}

addPairSheet("Confident", confident);
addPairSheet("Everything else", everythingElse);
addPairSheet("All pairs (top view)", rows);

await wb.xlsx.writeFile(OUT_PATH);
console.log(`workbook written: ${OUT_PATH}`);
