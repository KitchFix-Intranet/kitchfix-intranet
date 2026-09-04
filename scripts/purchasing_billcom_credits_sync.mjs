#!/usr/bin/env node
// scripts/purchasing_billcom_credits_sync.mjs
//
// Kevin R-71 Stage 2 (2026-09-04): ingest bill.com vendor-credits
// into purchasing_actuals. R-71 Stage 1 (2026-09-04) proved that
// credits were the whole document type absent from the platform -
// eleven negative rows on the entire board (all Rippling card
// refunds), zero from bill.com. Josh opened /vendor-credits; this
// script walks the endpoint, upserts raw, and derives negatives
// into purchasing_actuals with source='billcom_credit'.
//
// Usage:
//   node --env-file=.env.local scripts/purchasing_billcom_credits_sync.mjs --source=fytd
//   node --env-file=.env.local scripts/purchasing_billcom_credits_sync.mjs --source=nightly
//   node --env-file=.env.local scripts/purchasing_billcom_credits_sync.mjs --source=manual --dry-run
//
// Window semantics (mirrors purchasing_billcom_sync.mjs):
//   fytd     - walk every credit (no server-side date filter is
//              honoured), keep those with creditDate in [FY_START,
//              FY_END]. Used for the initial backfill.
//   nightly  - walk every credit, insert only those whose content
//              hash differs from the latest observed for that
//              credit_id. Idempotent posture.
//   manual   - same as nightly; used with --dry-run to preview.
//
// Attribution (identical to bills, mirroring
// purchasing_billcom_rederive.mjs):
//   line.classifications.accountingClassId -> billcom_class_site_map
//                                          -> account_key
//   line.classifications.chartOfAccountId  -> billcom_ref_accounts
//                                          -> account_number (GL)
//
// Sign convention:
//   Credit line amounts are stored as-is on the raw side (bill.com
//   returns them as positive numbers). The derive step writes
//   NEGATIVE amounts to purchasing_actuals so downstream
//   sum(purchasing_actuals.amount) = purchases - credits.
//
// Status:
//   FULLY_APPLIED, PARTIALLY_APPLIED, NOT_APPLIED all count v1 -
//   a credit is a credit whether spent or not. Kevin's note: "an
//   unspent credit is money owed to us and worth surfacing later."
//   Status stored on the raw header for a future OPEN-credits
//   surface.

import { createClient } from "@supabase/supabase-js";
import {
  fetchJson, extractRowsV3,
  vendorCreditsUrl, vendorCreditByIdUrl,
  contentHash, glBucketFor,
} from "../src/lib/billcom.js";

// ─── CLI ─────────────────────────────────────────────────────────────
const VALID_SOURCES = new Set(["backfill", "nightly", "manual", "fytd"]);
const args = { source: null, dryRun: false };
for (const x of process.argv.slice(2)) {
  if      (x.startsWith("--source="))  args.source = x.slice(9);
  else if (x === "--dry-run")          args.dryRun = true;
  else { console.error("unknown arg: " + x); process.exit(1); }
}
if (!args.source || !VALID_SOURCES.has(args.source)) {
  console.error("--source required, one of: " + [...VALID_SOURCES].join(", "));
  process.exit(1);
}

const FY_START = "2025-12-29";
const FY_END = "2026-12-27";
const PAGE_MAX = 100;
const HARD_PAGE_LIMIT = 500;
const CHUNK = 500;

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error(`SUPABASE_URL: ${SB_URL ? "PRESENT" : "ABSENT"}  SERVICE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
  process.exit(1);
}
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const num = (v) => v == null ? null : Number(v);

// ─── 1. Load reference maps ─────────────────────────────────────────
//
// Pagination + HIT_CAP guard. Supabase .select() silently caps at
// 1000 rows regardless of .range() or .limit() values passed in.
// billcom_ref_accounts holds 1072 rows today - a naive
// `.range(0, 9999)` returned 1000 and silently dropped 72, and the
// derive step wrote gl_line_code=null for every credit whose
// chartOfAccountId lived in those 72. 113 FY26 credits looked like
// unclassified vendor data for three days from that single bug.
//
// The mirror-shape guard in the bills refresh is at
// scripts/purchasing_billcom_sync.mjs:260 - "HIT_CAP: walked N pages
// with a full last page - silent truncation prevented, run fails".
// This is the same pattern for the credits-sync-side lookup.
console.log(`purchasing_billcom_credits_sync source=${args.source} dryRun=${args.dryRun} started=${new Date().toISOString()}`);
console.log("  loading class map + chart-of-accounts map...");

async function loadAllPaginated(table, cols) {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supa.from(table).select(cols).range(from, from + PAGE - 1);
    if (error) { console.error(`[${table}] page ${from / PAGE + 1} FAILED: ${error.message}`); process.exit(2); }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}
async function loadWithCapGuard(table, cols) {
  const { count, error: cErr } = await supa.from(table).select("*", { count: "exact", head: true });
  if (cErr) { console.error(`[${table}] count FAILED: ${cErr.message}`); process.exit(2); }
  const rows = await loadAllPaginated(table, cols);
  if (rows.length !== count) {
    console.error(`[${table}] HIT_CAP: authoritative count=${count} but loader returned ${rows.length} - silent truncation prevented, run fails`);
    process.exit(2);
  }
  return rows;
}

const [clsRows, coaRows] = await Promise.all([
  loadWithCapGuard("billcom_class_site_map", "actg_class_id, account_key, excluded"),
  loadWithCapGuard("billcom_ref_accounts", "id, account_number"),
]);
const classMap = new Map();
for (const r of clsRows) classMap.set(r.actg_class_id, { account_key: r.account_key, excluded: !!r.excluded });
const accountToNumber = new Map();
for (const r of coaRows) accountToNumber.set(r.id, r.account_number);
console.log(`    classes=${classMap.size} coa=${accountToNumber.size} (both cap-guarded)`);

// glBucketFor imported from src/lib/billcom.js - single source of
// truth for the gl_line_code → gl_bucket mapping shared with bills
// rederive. Constraint on purchasing_actuals.gl_bucket allows
// pl_cogs / reimbursable / sga / other only.

// ─── 2. Walk /vendor-credits via nextPage cursor ────────────────────
console.log("\n  walking /vendor-credits...");
const listRows = [];
let cursor = null;
let pageNo = 0;
let cursorExhausted = false;
while (pageNo < HARD_PAGE_LIMIT) {
  const url = vendorCreditsUrl({ pageCursor: cursor, max: PAGE_MAX });
  const p = await fetchJson(url);
  if (!p.ok) {
    console.error(`  page ${pageNo + 1} FAILED status=${p.status} err=${p.error}`);
    process.exit(2);
  }
  const rows = extractRowsV3(p.body);
  if (rows.length === 0) { cursorExhausted = true; break; }
  for (const r of rows) listRows.push(r);
  const next = p.body?.nextPage || null;
  pageNo++;
  if (!next || next === cursor) { cursorExhausted = true; break; }
  cursor = next;
}
if (!cursorExhausted) {
  console.error(`  hit HARD_PAGE_LIMIT=${HARD_PAGE_LIMIT} without cursor exhaustion - refusing to derive on a partial walk`);
  process.exit(2);
}
console.log(`    ${listRows.length} credits across ${pageNo} pages (cursor exhausted)`);

// FYTD backfill vs nightly: fytd keeps every credit whose creditDate
// falls in the FY window. Nightly keeps every credit that has changed
// vs the latest observed hash for that credit_id (checked below).
const inWindow = listRows.filter(r => {
  const d = String(r.creditDate || "").slice(0, 10);
  return args.source === "fytd" ? (d >= FY_START && d <= FY_END) : true;
});
console.log(`    ${inWindow.length} candidates (source=${args.source})`);

// ─── 3. Fetch details + upsert raw ───────────────────────────────────
console.log("\n  fetching credit details + upserting raw...");
const headerRows = [];
const lineRows = [];
let fetched = 0;
for (const c of inWindow) {
  const detail = await fetchJson(vendorCreditByIdUrl(c.id));
  fetched++;
  if (!detail.ok) {
    console.error(`    ${c.id} detail fetch FAILED status=${detail.status} - skipping`);
    continue;
  }
  const body = detail.body || {};
  const creditRaw = { ...body, __meta: { fetched_at: new Date().toISOString() } };
  const hdrHash = contentHash(creditRaw, "vendor_credit");
  headerRows.push({
    credit_id:        String(body.id),
    content_hash:     hdrHash,
    vendor_id:        body.vendorId || null,
    reference_number: body.referenceNumber || null,
    credit_date:      body.creditDate ? String(body.creditDate).slice(0, 10) : null,
    description:      body.description || null,
    amount:           num(body.amount),
    applied_amount:   num(body.appliedAmount),
    status:           body.status || null,
    archived:         body.archived === true,
    created_time:     body.createdTime || null,
    updated_time:     body.updatedTime || null,
    raw:              creditRaw,
    fetch_source:     args.source,
  });
  for (const li of body.vendorCreditLineItems || []) {
    const cls = li.classifications || {};
    const lineRaw = { ...li, __meta: { credit_id: body.id, fetched_at: new Date().toISOString() } };
    const lineHash = contentHash(lineRaw, "vendor_credit_line");
    lineRows.push({
      line_id:              String(li.id),
      credit_id:            String(body.id),
      content_hash:         lineHash,
      amount:               num(li.amount),
      chart_of_account_id:  cls.chartOfAccountId || null,
      actg_class_id:        cls.accountingClassId || null,
      raw:                  lineRaw,
      fetch_source:         args.source,
    });
  }
  if (fetched % 50 === 0) process.stderr.write(`\r  fetched ${fetched}/${inWindow.length}`);
}
process.stderr.write("\n");
console.log(`    headers to consider: ${headerRows.length}   lines: ${lineRows.length}`);

if (headerRows.length === 0) {
  console.log("  no credits to write. Exit 0.");
  process.exit(0);
}

// Hash-change insert (nightly). fytd + backfill always insert.
async function existingHashesFor(table, keyCol, keys) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const q = await supa.from(`${table}_latest`).select(`${keyCol}, content_hash`).in(keyCol, chunk);
    if (q.error) throw new Error(`${table}_latest hash lookup: ${q.error.message}`);
    for (const r of q.data || []) out.set(r[keyCol], r.content_hash);
  }
  return out;
}

let headerHashes = new Map();
let lineHashes = new Map();
try {
  const [hh, lh] = await Promise.all([
    existingHashesFor("billcom_raw_vendor_credits", "credit_id", headerRows.map(r => r.credit_id)),
    existingHashesFor("billcom_raw_vendor_credit_lines", "line_id", lineRows.map(r => r.line_id)),
  ]);
  headerHashes = hh; lineHashes = lh;
} catch (e) {
  // Pre-migration table missing - abort with clear message.
  console.error(`  raw table lookup FAILED: ${e.message}`);
  console.error(`  Apply docs/migrations/billcom-vendor-credits-1.sql first, then re-run.`);
  process.exit(2);
}

const headerInserts = headerRows.filter(r => headerHashes.get(r.credit_id) !== r.content_hash);
const lineInserts = lineRows.filter(r => lineHashes.get(r.line_id) !== r.content_hash);
console.log(`    headers with changed hash: ${headerInserts.length}   lines: ${lineInserts.length}`);

if (args.dryRun) {
  console.log(`  DRY RUN - no writes. Exit 0.`);
  process.exit(0);
}

// ─── 4. Insert raw header + line rows ────────────────────────────────
async function insertChunked(table, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const q = await supa.from(table).insert(chunk);
    if (q.error) { console.error(`  ${table} insert chunk ${i} FAILED: ${q.error.message}`); process.exit(2); }
    inserted += chunk.length;
  }
  return inserted;
}
console.log("\n  inserting raw rows...");
const hInserted = await insertChunked("billcom_raw_vendor_credits", headerInserts);
const lInserted = await insertChunked("billcom_raw_vendor_credit_lines", lineInserts);
console.log(`    inserted headers=${hInserted}  lines=${lInserted}`);

// ─── 5. Derive into purchasing_actuals ───────────────────────────────
// Rebuild strategy: for each touched credit_id (every one in this
// run's headerRows), DELETE existing purchasing_actuals rows for that
// credit and INSERT the fresh derivation. Matches the bills rederive
// contract - deterministic per-credit rebuild.
console.log("\n  deriving into purchasing_actuals (source=billcom_credit)...");
const touchedCreditIds = [...new Set(headerRows.map(r => r.credit_id))];
console.log(`    touched credit_ids: ${touchedCreditIds.length}`);

// Pull the LATEST header + line rows for every touched credit (may
// include header rows we didn't insert this run, if hash unchanged).
async function pullLatestFor(table, keyCol, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const q = await supa.from(`${table}_latest`).select("*").in(keyCol, chunk);
    if (q.error) { console.error(`  ${table}_latest FAILED: ${q.error.message}`); process.exit(2); }
    for (const r of q.data || []) out.push(r);
  }
  return out;
}
const [latestHeaders, latestLines] = await Promise.all([
  pullLatestFor("billcom_raw_vendor_credits", "credit_id", touchedCreditIds),
  pullLatestFor("billcom_raw_vendor_credit_lines", "credit_id", touchedCreditIds),
]);
console.log(`    latest headers=${latestHeaders.length}  lines=${latestLines.length}`);
const linesByCredit = new Map();
for (const l of latestLines) {
  if (!linesByCredit.has(l.credit_id)) linesByCredit.set(l.credit_id, []);
  linesByCredit.get(l.credit_id).push(l);
}

const paRows = [];
for (const h of latestHeaders) {
  if (h.archived) continue;                       // skip archived credits
  const lines = linesByCredit.get(h.credit_id) || [];
  for (const li of lines) {
    const classRow = classMap.get(li.actg_class_id);
    const excluded = classRow?.excluded === true;
    const accountKey = excluded ? null : (classRow?.account_key || null);
    const glLineCode = li.chart_of_account_id ? (accountToNumber.get(li.chart_of_account_id) || null) : null;
    paRows.push({
      source:             "billcom_credit",
      source_bill_id:     h.credit_id,
      source_line_id:     `billcom_credit:${li.line_id}`,
      account_key:        accountKey,
      excluded:           excluded,
      gl_line_code:       glLineCode,
      gl_bucket:          glBucketFor(glLineCode),
      txn_date:           h.credit_date,
      posting_date:       h.credit_date,           // credits carry no separate posting date
      amount:             -Number(li.amount || 0),  // NEGATE - credits reduce cost
      vendor_or_merchant: h.vendor_id,
      paid:               (h.status || "").toUpperCase() === "FULLY_APPLIED",
      approx_date:        false,
    });
  }
}
console.log(`    purchasing_actuals rows to write: ${paRows.length}`);

// DELETE existing billcom_credit rows for touched credits, then INSERT.
if (touchedCreditIds.length > 0) {
  for (let i = 0; i < touchedCreditIds.length; i += 500) {
    const chunk = touchedCreditIds.slice(i, i + 500);
    const del = await supa.from("purchasing_actuals").delete().eq("source", "billcom_credit").in("source_bill_id", chunk);
    if (del.error) { console.error(`  delete chunk ${i} FAILED: ${del.error.message}`); process.exit(2); }
  }
}
const paInserted = await insertChunked("purchasing_actuals", paRows);
console.log(`    inserted ${paInserted} purchasing_actuals rows`);

// ─── 6. Report per-account per-period totals ─────────────────────────
console.log("\n  per-account credit totals (this run):");
const perAcct = new Map();
for (const r of paRows) {
  if (!r.account_key) continue;
  perAcct.set(r.account_key, (perAcct.get(r.account_key) || 0) + Number(r.amount || 0));
}
for (const [a, sum] of [...perAcct.entries()].sort()) {
  console.log(`    ${a.padEnd(15)} $${sum.toFixed(2)}`);
}

console.log(`\ndone: source=${args.source} finished=${new Date().toISOString()}`);
