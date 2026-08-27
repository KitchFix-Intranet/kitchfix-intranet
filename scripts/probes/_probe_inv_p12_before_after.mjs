#!/usr/bin/env node
/*
 * Item 1 build support: BEFORE/AFTER measurement + exclusion parent set.
 *
 * Rebuilds the 45-pair set exactly as cut 1.  For each pair, picks the
 * PARENT TO EXCLUDE by Ruling 4 convention:
 *   sort by (txn_date ASC, then merchant.length ASC as tiebreak so the
 *   shorter name goes first when the dates match), exclude the first,
 *   keep the second.
 *
 * Emits three things:
 *
 *   1. A JSON blob at ~/Downloads/inv_p12_45_exclude_parents_<date>.json
 *      with the 45 (parent_txn_id, partner_parent_txn_id, merchant_short,
 *      merchant_long, amount_cents, account_key, days_apart) rows.  This
 *      is the seed for the migration.
 *
 *   2. A BEFORE snapshot of per-account totals (FYTD, all sources,
 *      non-excluded) - hero + line count + max txn_date.
 *
 *   3. A SIMULATED AFTER: same snapshot with the 45 parents' lines
 *      filtered out client-side.  Per-account delta printed.
 *
 * The simulated AFTER exists so Kevin can approve numbers before the
 * migration runs.  The migration itself does not depend on this file.
 *
 * Env via process.env only.
 * Run: node --env-file=.env.local scripts/probes/_probe_inv_p12_before_after.mjs
 */

import fs from "node:fs/promises";
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
const MIN_PREFIX_LEN = 8;
const today = new Date().toISOString().slice(0, 10);
const JSON_PATH = path.join(os.homedir(), "Downloads", `inv_p12_45_exclude_parents_${today}.json`);

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

// ── rebuild 45 pairs (identical rule to cut 1) ────────────────────────
console.log("\nloading purchasing_actuals rippling_spend FYTD...");
const actualsRipp = await paginate(
  "purchasing_actuals",
  "id, source, source_line_id, account_key, excluded, gl_line_code, txn_date, amount, vendor_or_merchant",
  (q) => q.eq("source", "rippling_spend").eq("excluded", false).gte("txn_date", FYTD_START).order("txn_date", { ascending: true }).order("id", { ascending: true }),
);
console.log(`  ripp rows: ${actualsRipp.length}`);
console.log("loading rippling_raw_spend_lines_latest...");
const rawLines = await paginate(
  "rippling_raw_spend_lines_latest",
  "rippling_id, currency, merchant_name, parent_txn_id",
);
console.log(`  raw lines: ${rawLines.length}`);
const rawByRid = new Map();
for (const r of rawLines) rawByRid.set(r.rippling_id, r);

const parentAgg = new Map();
for (const a of actualsRipp) {
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
      anyNonUSD: false,
      lineIds: [],
    });
  }
  const p = parentAgg.get(parent);
  const ccy = String(raw.currency || "").toUpperCase();
  if (ccy && ccy !== "USD") p.anyNonUSD = true;
  else p.cents += Math.round(Number(a.amount || 0) * 100);
  if (a.txn_date && (!p.txn_date || a.txn_date < p.txn_date)) p.txn_date = a.txn_date;
  if (!p.account_key && a.account_key) p.account_key = a.account_key;
  p.lineIds.push(a.id);
}
const parents = [...parentAgg.values()].filter(
  (p) => !p.anyNonUSD && p.cents !== 0 && p.merchant && p.txn_date && p.account_key,
);

// same-merchant pairs (baseline exact)
const byKey = new Map();
for (const p of parents) {
  const k = JSON.stringify([p.account_key, p.merchant, p.cents]);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(p);
}
const exactPairs = [];
for (const arr of byKey.values()) {
  if (arr.length < 2) continue;
  arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (daysBetween(a.txn_date, b.txn_date) <= WINDOW_DAYS) exactPairs.push({ a, b });
  }
}
const exactSet = new Set(exactPairs.map(p => `${p.a.parent}||${p.b.parent}`));

// prefix-tolerant
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
const additional = tolerant.filter(p => !exactSet.has(`${p.a.parent}||${p.b.parent}`));
const recurrence = new Map();
for (const p of parents) recurrence.set(`${p.merchant}||${p.cents}`, (recurrence.get(`${p.merchant}||${p.cents}`) || 0) + 1);
function recMax(pair) {
  return Math.max(recurrence.get(`${pair.a.merchant}||${pair.a.cents}`) || 0, recurrence.get(`${pair.b.merchant}||${pair.b.cents}`) || 0);
}
const targeted = additional.filter(p => recMax(p) <= 2);
console.log(`\ntargeted (45-pair set): ${targeted.length}`);

// ── Decide which side to EXCLUDE per pair ─────────────────────────────
// Ruling 4 convention: sort by (txn_date ASC, merchant.length ASC),
// exclude the FIRST, keep the SECOND.  This is auth->settlement grammar:
// the earlier and less-complete row is the auth event.
const excludeParents = [];
for (const pair of targeted) {
  const both = [pair.a, pair.b].slice().sort((x, y) => {
    if (x.txn_date < y.txn_date) return -1;
    if (x.txn_date > y.txn_date) return 1;
    if (x.merchant.length < y.merchant.length) return -1;
    if (x.merchant.length > y.merchant.length) return 1;
    return x.parent < y.parent ? -1 : x.parent > y.parent ? 1 : 0;
  });
  const excl = both[0];
  const keep = both[1];
  excludeParents.push({
    parent_txn_id: excl.parent,
    partner_parent_txn_id: keep.parent,
    merchant_short: excl.merchant,
    merchant_long:  keep.merchant,
    amount_cents:   excl.cents,
    account_key:    excl.account_key,
    days_apart:     pair.days,
    excluded_txn_date: excl.txn_date,
    kept_txn_date:     keep.txn_date,
    excluded_line_ids: excl.lineIds,
  });
}

const excludeParentIds = new Set(excludeParents.map(e => e.parent_txn_id));
console.log(`  exclusion parent_ids: ${excludeParentIds.size}`);

// ── BEFORE snapshot: per-account totals, FYTD, ALL sources, non-excluded ──
console.log("\nloading purchasing_actuals ALL FYTD non-excluded for per-account snapshot...");
const actualsAll = await paginate(
  "purchasing_actuals",
  "id, source, source_line_id, account_key, excluded, gl_line_code, txn_date, amount",
  (q) => q.eq("excluded", false).gte("txn_date", FYTD_START),
);
console.log(`  actuals (non-excluded, FYTD): ${actualsAll.length}`);

// The AFTER simulation needs to know WHICH LINE IDS get excluded.  Those
// are lines whose source_line_id is rippling_spend:<rid> where the rid
// maps to a parent in excludeParentIds.
function isExcludedLine(row) {
  if (row.source !== "rippling_spend") return false;
  if (!row.source_line_id?.startsWith("rippling_spend:")) return false;
  const rid = row.source_line_id.slice("rippling_spend:".length);
  const raw = rawByRid.get(rid);
  if (!raw?.parent_txn_id) return false;
  return excludeParentIds.has(raw.parent_txn_id);
}

const byAcct = new Map();
function ensureAcct(k) {
  if (!byAcct.has(k)) {
    byAcct.set(k, {
      before_cents: 0, before_lines: 0,
      after_cents:  0, after_lines:  0,
      excluded_cents: 0, excluded_lines: 0,
    });
  }
  return byAcct.get(k);
}
for (const r of actualsAll) {
  if (!r.account_key) continue;
  const cents = Math.round(Number(r.amount || 0) * 100);
  const a = ensureAcct(r.account_key);
  a.before_cents += cents;
  a.before_lines++;
  if (isExcludedLine(r)) {
    a.excluded_cents += cents;
    a.excluded_lines++;
  } else {
    a.after_cents += cents;
    a.after_lines++;
  }
}

// Per-account report, sorted by |excluded_cents| desc so accounts that
// change most surface first.
const rows = [...byAcct.entries()].map(([k, v]) => ({
  account_key: k,
  before_dollars: v.before_cents / 100,
  after_dollars:  v.after_cents / 100,
  delta_dollars:  (v.before_cents - v.after_cents) / 100,
  excluded_lines: v.excluded_lines,
  before_lines:   v.before_lines,
  after_lines:    v.after_lines,
})).sort((a, b) => Math.abs(b.delta_dollars) - Math.abs(a.delta_dollars));

console.log("\n══ BEFORE / AFTER per account (FYTD, non-excluded, all sources) ══");
console.log("account_key         before        after          delta       excl_lines/before_lines");
let totalBefore = 0, totalAfter = 0;
for (const r of rows) {
  totalBefore += r.before_dollars;
  totalAfter  += r.after_dollars;
  console.log(
    `  ${r.account_key.padEnd(16)}  $${r.before_dollars.toFixed(2).padStart(11)}  $${r.after_dollars.toFixed(2).padStart(11)}  ${r.delta_dollars === 0 ? "         -" : "-$" + Math.abs(r.delta_dollars).toFixed(2).padStart(9)}    ${r.excluded_lines}/${r.before_lines}`
  );
}
console.log(`  ${"TOTAL".padEnd(16)}  $${totalBefore.toFixed(2).padStart(11)}  $${totalAfter.toFixed(2).padStart(11)}  -$${(totalBefore - totalAfter).toFixed(2).padStart(9)}`);

// ── Write JSON seed for the migration ─────────────────────────────────
await fs.writeFile(JSON_PATH, JSON.stringify({
  generated_at: new Date().toISOString(),
  rule: "INV-P12 truncation-pair (prefix-tolerant, recurrence<=2)",
  ruled_by: "kevin",
  ruled_at_note: "2026-08-27 manual review of all 45 pairs; every pair confirmed same vendor",
  window_days: WINDOW_DAYS,
  min_prefix_len: MIN_PREFIX_LEN,
  count: excludeParents.length,
  total_excluded_dollars: excludeParents.reduce((s, e) => s + e.amount_cents, 0) / 100,
  parents: excludeParents,
  per_account: rows,
}, null, 2));
console.log(`\nJSON seed written: ${JSON_PATH}`);
console.log(`  parent_ids to exclude: ${excludeParents.length}`);
console.log(`  simulated AFTER delta: -$${(totalBefore - totalAfter).toFixed(2)}`);
