#!/usr/bin/env node
// One-off re-derive of the 113 null-gl credits after the
// billcom_ref_accounts pagination bug was diagnosed (2026-09-04).
//
// Root cause: scripts/purchasing_billcom_credits_sync.mjs:87 loads
// billcom_ref_accounts with .range(0, 9999). Supabase silently caps
// at 1000. Ref table has 1072 rows today; the 72 rows above the cap
// held the chart_of_account_id -> account_number mappings used by
// every one of these 113 credits. The sync derived them with
// gl_line_code=null; the raw tables have the correct chart ids and
// the ref table has the correct mappings NOW.
//
// This script re-derives ONLY the credit_ids that currently have a
// null-gl-line-code row in purchasing_actuals. Matches the sync's
// derive contract byte-for-byte:
//   DELETE purchasing_actuals WHERE source='billcom_credit' AND
//                                   source_bill_id IN (touched_ids)
//   INSERT fresh rows built from raw headers + raw lines using a
//         FULLY paginated billcom_ref_accounts + billcom_class_site_map
//
// Modes:
//   default (no flags)  DRY-RUN - print plan, no writes
//   --commit            execute delete + insert
//
// Report shape (both modes):
//   - N credit_ids touched, N raw lines to be re-derived
//   - per-gl-code distribution (before -> after)
//   - per-account per-bucket dollar totals for the impacted accounts
//     (before -> after)
//   - explicit check: any 1385.X row appearing on a cost surface
//     (gl_bucket = 'pl_cogs') would be a defect - STOP

import { createClient } from "@supabase/supabase-js";
import { glBucketFor } from "../../../src/lib/billcom.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes("--commit");

console.log(`# Re-derive null-gl credits  ·  ${new Date().toISOString()}  ·  mode=${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);

// Paginated loader - Supabase caps .select() at 1000 rows silently.
async function loadAll(table, cols) {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supa.from(table).select(cols).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} page ${from / PAGE + 1}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// Cap-guard: authoritative count vs loaded count must match.
async function loadAllWithCapGuard(table, cols) {
  const { count } = await supa.from(table).select("*", { count: "exact", head: true });
  const rows = await loadAll(table, cols);
  if (rows.length !== count) {
    throw new Error(`HIT_CAP: ${table} authoritative count=${count} but loader returned ${rows.length}`);
  }
  console.log(`  ${table}: ${rows.length} rows (verified against exact count)`);
  return rows;
}

console.log("Loading reference maps (paginated + cap-guarded)...");
const [refAcc, classMap] = await Promise.all([
  loadAllWithCapGuard("billcom_ref_accounts", "id, account_number"),
  loadAllWithCapGuard("billcom_class_site_map", "actg_class_id, account_key, excluded"),
]);
const coaToGl = new Map(refAcc.map(r => [r.id, r.account_number]));
const classToInfo = new Map(classMap.map(r => [r.actg_class_id, { account_key: r.account_key, excluded: !!r.excluded }]));

// Step 1: find the credit_ids with at least one null-gl-line-code row.
const { data: nullRows, error: nullErr } = await supa
  .from("purchasing_actuals")
  .select("source_bill_id, account_key")
  .eq("source", "billcom_credit")
  .is("gl_line_code", null);
if (nullErr) throw nullErr;
const touchedCreditIds = [...new Set(nullRows.map(r => r.source_bill_id))];
const affectedAccounts = [...new Set(nullRows.map(r => r.account_key).filter(Boolean))];
console.log(`\nTouching ${touchedCreditIds.length} credit_ids across ${affectedAccounts.length} accounts.`);

// Step 2: pull raw headers + lines for those credit_ids (in-chunks).
async function pullLatestFor(table, keyCol, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const { data, error } = await supa.from(`${table}_latest`).select("*").in(keyCol, chunk);
    if (error) throw new Error(`${table}_latest: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}
const [latestHeaders, latestLines] = await Promise.all([
  pullLatestFor("billcom_raw_vendor_credits", "credit_id", touchedCreditIds),
  pullLatestFor("billcom_raw_vendor_credit_lines", "credit_id", touchedCreditIds),
]);
console.log(`  raw headers=${latestHeaders.length}  raw lines=${latestLines.length}`);

const linesByCredit = new Map();
for (const l of latestLines) {
  if (!linesByCredit.has(l.credit_id)) linesByCredit.set(l.credit_id, []);
  linesByCredit.get(l.credit_id).push(l);
}

// Step 3: rebuild purchasing_actuals rows using the SAME shape the
// sync uses (scripts/purchasing_billcom_credits_sync.mjs:278-302).
const paRows = [];
for (const h of latestHeaders) {
  if (h.archived) continue;
  const lines = linesByCredit.get(h.credit_id) || [];
  for (const li of lines) {
    const classRow = classToInfo.get(li.actg_class_id);
    const excluded = classRow?.excluded === true;
    const accountKey = excluded ? null : (classRow?.account_key || null);
    const glLineCode = li.chart_of_account_id ? (coaToGl.get(li.chart_of_account_id) || null) : null;
    paRows.push({
      source:             "billcom_credit",
      source_bill_id:     h.credit_id,
      source_line_id:     `billcom_credit:${li.line_id}`,
      account_key:        accountKey,
      excluded:           excluded,
      gl_line_code:       glLineCode,
      gl_bucket:          glBucketFor(glLineCode),
      txn_date:           h.credit_date,
      posting_date:       h.credit_date,
      amount:             -Number(li.amount || 0),
      vendor_or_merchant: h.vendor_id,
      paid:               (h.status || "").toUpperCase() === "FULLY_APPLIED",
      approx_date:        false,
    });
  }
}
console.log(`\nRe-derived ${paRows.length} rows.`);

// Distribution of new gl_line_codes
const glDist = new Map();
const bucketDist = new Map();
let stillNull = 0;
for (const r of paRows) {
  const k = r.gl_line_code || "(null)";
  glDist.set(k, (glDist.get(k) || 0) + 1);
  const b = r.gl_bucket || "(null)";
  bucketDist.set(b, (bucketDist.get(b) || 0) + 1);
  if (!r.gl_line_code) stillNull++;
}
console.log("\nNew gl_line_code distribution:");
for (const [gl, n] of [...glDist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(gl).padEnd(12)}  ${n} rows`);
}
console.log("\nNew gl_bucket distribution:");
for (const [b, n] of [...bucketDist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(b).padEnd(15)}  ${n} rows`);
}
console.log(`\nStill null after re-derive: ${stillNull}`);
if (stillNull > 0) {
  console.log("  ^ credits whose chart_of_account_id could not be resolved. Investigate.");
}

// DEFECT CHECK: any 1385.X row landing in a COGS bucket
const inventoryOnCogs = paRows.filter(r =>
  r.gl_line_code && String(r.gl_line_code).startsWith("1385") && r.gl_bucket === "pl_cogs"
);
if (inventoryOnCogs.length > 0) {
  console.error(`\nSTOP: ${inventoryOnCogs.length} rows have 1385.X gl_line_code but gl_bucket='pl_cogs'`);
  console.error("  This means an inventory account is reaching the COGS bucket - a separate defect.");
  console.error("  Sample:");
  for (const r of inventoryOnCogs.slice(0, 5)) console.error(`    ${JSON.stringify(r)}`);
  process.exit(3);
}
console.log(`\nDefect check: 0 rows have 1385.X on a pl_cogs bucket. Safe.`);

// Pre-write snapshot: per-account per-gl totals on billcom_credit rows (current state)
console.log("\nPre-write snapshot: current billcom_credit totals on affected accounts:");
const { data: preAll, error: preErr } = await supa
  .from("purchasing_actuals")
  .select("account_key, gl_line_code, amount")
  .eq("source", "billcom_credit")
  .in("account_key", affectedAccounts);
if (preErr) throw preErr;
const preAgg = new Map();
for (const r of preAll || []) {
  const k = `${r.account_key}|${r.gl_line_code || "(null)"}`;
  preAgg.set(k, (preAgg.get(k) || 0) + Number(r.amount));
}

if (!COMMIT) {
  console.log(`\n[DRY-RUN]  ${touchedCreditIds.length} credit_ids would be DELETED then ${paRows.length} rows INSERTED.`);
  console.log(`[DRY-RUN]  Re-run with --commit to execute.`);
  process.exit(0);
}

// --- COMMIT PATH ---
console.log(`\n[COMMIT]  Deleting existing billcom_credit rows for ${touchedCreditIds.length} credit_ids...`);
for (let i = 0; i < touchedCreditIds.length; i += 500) {
  const chunk = touchedCreditIds.slice(i, i + 500);
  const { error } = await supa.from("purchasing_actuals").delete().eq("source", "billcom_credit").in("source_bill_id", chunk);
  if (error) throw new Error(`delete chunk ${i}: ${error.message}`);
}
console.log(`[COMMIT]  Deleted.`);

console.log(`[COMMIT]  Inserting ${paRows.length} fresh rows...`);
let inserted = 0;
for (let i = 0; i < paRows.length; i += 500) {
  const chunk = paRows.slice(i, i + 500);
  const { data, error } = await supa.from("purchasing_actuals").insert(chunk).select("id");
  if (error) throw new Error(`insert chunk ${i}: ${error.message}`);
  inserted += (data || []).length;
}
console.log(`[COMMIT]  Inserted ${inserted} rows.`);

// Post-write snapshot
const { data: postAll } = await supa
  .from("purchasing_actuals")
  .select("account_key, gl_line_code, amount")
  .eq("source", "billcom_credit")
  .in("account_key", affectedAccounts);
const postAgg = new Map();
for (const r of postAll || []) {
  const k = `${r.account_key}|${r.gl_line_code || "(null)"}`;
  postAgg.set(k, (postAgg.get(k) || 0) + Number(r.amount));
}

console.log("\nDeltas per account/gl (only entries that changed):");
const allKeys = new Set([...preAgg.keys(), ...postAgg.keys()]);
const deltas = [];
for (const k of allKeys) {
  const pre = preAgg.get(k) || 0;
  const post = postAgg.get(k) || 0;
  if (Math.abs(post - pre) >= 0.005) deltas.push({ key: k, pre, post, delta: post - pre });
}
deltas.sort((a, b) => a.key.localeCompare(b.key));
console.log("| account | gl | before | after | delta |");
console.log("|---|---|---:|---:|---:|");
for (const d of deltas) {
  const [acct, gl] = d.key.split("|");
  console.log(`| ${acct} | ${gl} | $${d.pre.toFixed(2)} | $${d.post.toFixed(2)} | $${d.delta.toFixed(2)} |`);
}
console.log(`\nDone.`);
