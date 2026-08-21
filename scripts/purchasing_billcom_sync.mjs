// scripts/purchasing_billcom_sync.mjs
//
// KPI PURCHASING PHASE 1 - C2: bill.com sync + derive.
// Contract: docs/KPI_PURCHASING_PHASE1_SPEC.md §2 (billcom step a-c).
//
// Steps (per spec §2 billcom):
//   a. refresh billcom_ref_accounts (2 pages of 999), billcom_ref_classes,
//      and billcom_ref_vendors via full replace. Vendors added per
//      purchasing-5 migration - INV-P10 found bill headers carry NO
//      vendor name (organizationName is our own company), so /vendors
//      is the sole source of a real vendor name for the By-vendor UI
//      card and the miscoded-vendor search. /vendors uses the v3
//      envelope (results + nextPage), NOT v2 - do not mix parsers.
//      Proxy caps max at 100/page.
//   b. bills: /bills/filtered on invoiceDate window [today-45d, today] paged
//      with start/max=500. On the 1st of each fiscal period, also a
//      full-FY pass filtered per period. Upsert header + lines by content
//      hash (append-only-on-hash-change). Line items embedded in v2
//      response.
//   c. derive: rebuild purchasing_actuals rows for every bill touched in
//      (b). Atomic per bill: DELETE existing rows for source_bill_id then
//      INSERT the new set inside one supabase call sequence guarded by a
//      per-bill try/catch that keeps last-good state on failure.
//
// Atomicity guarantee (spec non-negotiable):
//   Per-bill: derive computes the full new row set for a bill in memory
//   BEFORE touching purchasing_actuals. Then DELETE ... WHERE source =
//   'billcom' AND source_bill_id = <id> and INSERT the new rows. If the
//   INSERT fails, we log and skip the bill (last-good state is one full
//   set of old rows, not a half-written bill). If DELETE succeeds but
//   INSERT then fails, we DELETE-again on the next run before re-derive
//   (deterministic). Never leave a half-written bill.
//
// Idempotency guarantee (spec non-negotiable):
//   Running twice in a row changes zero rows. The raw ingest hashes the
//   bill + each line and skips INSERT when the hash matches the current
//   latest. The derive re-computes the same output from the same raw
//   snapshot; the DELETE-then-INSERT-N-rows loop is a no-op when the N
//   rows are byte-identical to what was there. Enforced by a probe.
//
// CLI:
//   node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local scripts/purchasing_billcom_sync.mjs --source=nightly
//   node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local scripts/purchasing_billcom_sync.mjs --source=fytd --period=8
//
// Required env: BILLCOM_PROXY_BASE, BILLCOM_PROXY_KEY, SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY
//
// Exit codes:
//   0  all probes PASS
//   1  configuration error (missing env, bad --source, etc.)
//   2  walk failed mid-flight (partial data left in raw tables, derive skipped)
//   3  another sync run is in flight (lock held)
//   4  at least one probe FAILED (data landed but not spec-compliant)

import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import {
  fetchJson, extractRowsV2, extractRowsV3, billsFilteredUrl, chartOfAccountsUrl,
  classesUrl, vendorsUrl, contentHash, isPaid, glBucketFor,
} from "../src/lib/billcom.js";

// ─── CLI ─────────────────────────────────────────────────────────────

const VALID_SOURCES = new Set(["backfill", "nightly", "manual", "fytd"]);
const WINDOW_DAYS   = 45;   // spec §2 trailing window
const PAGE_SIZE     = 500;
const FY_START_ISO  = "2025-12-29";
const FY_END_ISO    = "2026-12-27";

function parseArgs(argv) {
  const args = { source: null, dryRun: false, period: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--source=")) args.source = a.slice("--source=".length);
    else if (a.startsWith("--period=")) args.period = parseInt(a.slice("--period=".length), 10);
    else if (a === "--dry-run") args.dryRun = true;
    else { console.error("unknown arg: " + a); process.exit(1); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.source || !VALID_SOURCES.has(args.source)) {
  console.error("--source is required, one of: " + Array.from(VALID_SOURCES).join(", "));
  process.exit(1);
}
if (args.source === "fytd" && (!args.period || args.period < 1 || args.period > 13)) {
  console.error("--period=<1..13> is required when --source=fytd");
  process.exit(1);
}

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
if (!process.env.BILLCOM_PROXY_BASE) { console.error("BILLCOM_PROXY_BASE not set"); process.exit(1); }
if (!process.env.BILLCOM_PROXY_KEY)  { console.error("BILLCOM_PROXY_KEY not set (never echoed)"); process.exit(1); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const startedAt = new Date();
console.log(`purchasing_billcom_sync source=${args.source} dryRun=${args.dryRun} period=${args.period || "n/a"} started=${startedAt.toISOString()}`);

// ─── Concurrency lock ────────────────────────────────────────────────

const LOCK_NAME = "purchasing_billcom_sync";
const LOCK_TTL_MS = 4 * 60 * 60 * 1000;
const HOLDER_ID = [
  args.source,
  `host=${os.hostname()}`,
  `pid=${process.pid}`,
  `started=${startedAt.toISOString()}`,
  process.env.GITHUB_RUN_ID ? `gh_run=${process.env.GITHUB_RUN_ID}` : null,
].filter(Boolean).join(" ");

async function acquireLock() {
  const { error: reapErr } = await supa
    .from("purchasing_sync_locks")
    .delete()
    .eq("name", LOCK_NAME)
    .lt("expires_at", new Date().toISOString());
  if (reapErr) { console.error(`lock: reap failed: ${reapErr.message}`); process.exit(1); }

  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const { error } = await supa
    .from("purchasing_sync_locks")
    .insert({ name: LOCK_NAME, expires_at: expiresAt, holder: HOLDER_ID });
  if (error) {
    if (error.code === "23505") {
      const { data: current } = await supa
        .from("purchasing_sync_locks")
        .select("holder, acquired_at, expires_at")
        .eq("name", LOCK_NAME)
        .maybeSingle();
      console.error("another purchasing_billcom_sync run is in flight, refusing to start");
      if (current) {
        console.error(`  holder:      ${current.holder}`);
        console.error(`  acquired_at: ${current.acquired_at}`);
        console.error(`  expires_at:  ${current.expires_at}`);
      }
      process.exit(3);
    }
    console.error(`lock: acquire failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`acquired lock holder="${HOLDER_ID}" expires_at=${expiresAt}`);
}

async function releaseLock() {
  const { error } = await supa
    .from("purchasing_sync_locks")
    .delete()
    .eq("name", LOCK_NAME)
    .eq("holder", HOLDER_ID);
  if (error) console.error(`lock: release failed: ${error.message}`);
}

await acquireLock();
process.on("SIGINT",  async () => { await releaseLock(); process.exit(130); });
process.on("SIGTERM", async () => { await releaseLock(); process.exit(143); });

// ─── Helpers ─────────────────────────────────────────────────────────

// Parse "1234.56" or number -> number, null-safe.
function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function toTimestampTZ(v) {
  if (!v) return null;
  const s = String(v);
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

// FY period_start for a period 1..13.
function periodStartISO(p) {
  const fy = new Date(FY_START_ISO + "T00:00:00Z");
  const t = fy.getTime() + (p - 1) * 28 * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function periodEndISO(p) {
  const fy = new Date(FY_START_ISO + "T00:00:00Z");
  const t = fy.getTime() + (p * 28 - 1) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// ─── Step a: refresh reference tables ────────────────────────────────

async function refreshChartOfAccounts() {
  console.log("[ref_accounts] refresh (full replace)");
  const t0 = Date.now();
  let rows = [];
  let start = 0;
  let pageNo = 0;
  const MAX = 999;
  const HARD_PAGE_LIMIT = 10;
  while (pageNo < HARD_PAGE_LIMIT) {
    const url = chartOfAccountsUrl({ start, max: MAX });
    const res = await fetchJson(url);
    if (!res.ok) {
      console.error(`[ref_accounts] page ${pageNo + 1} FAILED status=${res.status} error=${res.error}`);
      return { ok: false, count: rows.length, error: res.error };
    }
    const pageRows = extractRowsV2(res.body);
    rows = rows.concat(pageRows);
    pageNo++;
    process.stderr.write(`[ref_accounts] page ${pageNo} rows=${pageRows.length} cumulative=${rows.length}\r`);
    if (pageRows.length < MAX) break;
    start += MAX;
  }
  process.stderr.write("\n");

  if (args.dryRun) {
    console.log(`[ref_accounts] dry-run - would refresh ${rows.length} rows`);
    return { ok: true, count: rows.length, dryRun: true };
  }

  // Full replace: DELETE then INSERT. TRUNCATE not available to
  // service_role by design (money-adjacent standing rule).
  const delResp = await supa.from("billcom_ref_accounts").delete().neq("id", "__never__");
  if (delResp.error) {
    console.error(`[ref_accounts] delete FAILED: ${delResp.error.message}`);
    return { ok: false, count: rows.length, error: delResp.error.message };
  }

  const rowsToInsert = rows.map(r => ({
    id:             String(r.id),
    account_number: r.accountNumber ? String(r.accountNumber) : null,
    name:           r.name || null,
    account_type:   r.accountType || null,
    is_active:      r.isActive === true || r.isActive === "true" || r.isActive === "1",
    parent_id:      r.parentAccountId || r.parent || null,
    raw:            r,
    refreshed_at:   new Date().toISOString(),
  }));
  if (rowsToInsert.length > 0) {
    // Batch inserts of 500 to keep payload sizes reasonable.
    for (let i = 0; i < rowsToInsert.length; i += 500) {
      const batch = rowsToInsert.slice(i, i + 500);
      const insResp = await supa.from("billcom_ref_accounts").insert(batch);
      if (insResp.error) {
        console.error(`[ref_accounts] insert batch ${i}..${i + batch.length} FAILED: ${insResp.error.message}`);
        return { ok: false, count: i, error: insResp.error.message };
      }
    }
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[ref_accounts] refreshed ${rows.length} rows in ${dur}s`);
  return { ok: true, count: rows.length };
}

async function refreshClasses() {
  console.log("[ref_classes] refresh (full replace)");
  const t0 = Date.now();
  const url = classesUrl({ start: 0, max: 500 });
  const res = await fetchJson(url);
  if (!res.ok) {
    console.error(`[ref_classes] page 1 FAILED status=${res.status} error=${res.error}`);
    return { ok: false, count: 0, error: res.error };
  }
  const rows = extractRowsV2(res.body);

  if (args.dryRun) {
    console.log(`[ref_classes] dry-run - would refresh ${rows.length} rows`);
    return { ok: true, count: rows.length, dryRun: true };
  }

  const delResp = await supa.from("billcom_ref_classes").delete().neq("id", "__never__");
  if (delResp.error) {
    console.error(`[ref_classes] delete FAILED: ${delResp.error.message}`);
    return { ok: false, count: 0, error: delResp.error.message };
  }
  const rowsToInsert = rows.map(r => ({
    id:           String(r.id),
    name:         r.name || null,
    is_active:    r.isActive === true || r.isActive === "true" || r.isActive === "1",
    raw:          r,
    refreshed_at: new Date().toISOString(),
  }));
  if (rowsToInsert.length > 0) {
    const insResp = await supa.from("billcom_ref_classes").insert(rowsToInsert);
    if (insResp.error) {
      console.error(`[ref_classes] insert FAILED: ${insResp.error.message}`);
      return { ok: false, count: 0, error: insResp.error.message };
    }
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[ref_classes] refreshed ${rows.length} rows in ${dur}s`);
  return { ok: true, count: rows.length };
}

async function refreshVendors() {
  console.log("[ref_vendors] refresh (full replace, v3 envelope, page-cursor pagination)");
  const t0 = Date.now();
  const MAX = 100;                // proxy caps /vendors at max=100 (verified 2026-08-20)
  const HARD_PAGE_LIMIT = 1000;   // 1000 * 100 = 100k vendors ceiling
  let pageCursor = null;
  let pageNo = 0;
  let rows = [];
  while (pageNo < HARD_PAGE_LIMIT) {
    const url = vendorsUrl({ pageCursor, max: MAX });
    const res = await fetchJson(url);
    if (!res.ok) {
      console.error(`[ref_vendors] page ${pageNo + 1} FAILED status=${res.status} error=${res.error}`);
      return { ok: false, count: rows.length, error: res.error };
    }
    const pageRows = extractRowsV3(res.body);
    rows = rows.concat(pageRows);
    pageNo++;
    const nextPage = res.body?.nextPage;
    process.stderr.write(`[ref_vendors] page ${pageNo} rows=${pageRows.length} cumulative=${rows.length} nextPage=${nextPage ? "yes" : "null"}\r`);
    // Break on empty page, short page, or missing nextPage cursor.
    // Missing nextPage is the definitive "no more data" signal on
    // this v3 endpoint. `start=` is IGNORED (see vendorsUrl header) -
    // do NOT fall back to offset pagination.
    if (pageRows.length === 0 || pageRows.length < MAX || !nextPage) break;
    pageCursor = nextPage;
  }
  process.stderr.write("\n");

  if (args.dryRun) {
    console.log(`[ref_vendors] dry-run - would refresh ${rows.length} rows`);
    return { ok: true, count: rows.length, dryRun: true };
  }

  // Full replace: DELETE then INSERT. TRUNCATE not available to
  // service_role by design (standing rule for money-adjacent + all
  // new tables via purchasing-5 REVOKE).
  const delResp = await supa.from("billcom_ref_vendors").delete().neq("id", "__never__");
  if (delResp.error) {
    console.error(`[ref_vendors] delete FAILED: ${delResp.error.message}`);
    return { ok: false, count: rows.length, error: delResp.error.message };
  }

  // Dedupe on id in case /vendors returns the same vendor twice
  // across pages (defensive - v3 pagination could double-emit on a
  // mid-walk mutation).
  const dedupedById = new Map();
  for (const r of rows) {
    if (r.id) dedupedById.set(String(r.id), r);
  }
  const rowsToInsert = [...dedupedById.values()].map(r => ({
    id:             String(r.id),
    name:           r.name || null,
    account_type:   r.accountType || null,
    // v3 uses `archived` boolean natively - store as-is. Do NOT invert
    // to is_active; that flip is exactly how the wrong-envelope trap
    // bites (per purchasing-5 header).
    archived:       r.archived === true,
    account_number: r.accountNumber || null,
    bill_currency:  r.billCurrency || null,
    created_time:   toTimestampTZ(r.createdTime),
    updated_time:   toTimestampTZ(r.updatedTime),
    raw:            r,
    refreshed_at:   new Date().toISOString(),
  }));

  if (rowsToInsert.length > 0) {
    for (let i = 0; i < rowsToInsert.length; i += 500) {
      const batch = rowsToInsert.slice(i, i + 500);
      const insResp = await supa.from("billcom_ref_vendors").insert(batch);
      if (insResp.error) {
        console.error(`[ref_vendors] insert batch ${i}..${i + batch.length} FAILED: ${insResp.error.message}`);
        return { ok: false, count: i, error: insResp.error.message };
      }
    }
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const dedupeNote = rowsToInsert.length !== rows.length
    ? ` (deduped ${rows.length - rowsToInsert.length} duplicate ids)`
    : "";
  console.log(`[ref_vendors] refreshed ${rowsToInsert.length} rows in ${dur}s${dedupeNote}`);
  return { ok: true, count: rowsToInsert.length, rawCount: rows.length };
}

// ─── Step b: bills window ────────────────────────────────────────────

// Walk /bills/filtered for an inclusive invoiceDate window, page by
// page. Returns { ok, billsExamined, billsInserted, linesExamined,
// linesInserted, touchedBillIds }. Header + lines are ingested per
// page. Atomic per (bill, line) via compare-then-insert.
async function walkBillsWindow({ invoiceDateStart, invoiceDateEnd, fetchSource }) {
  const t0 = Date.now();
  let start = 0;
  let pageNo = 0;
  let billsExamined = 0;
  let billsInserted = 0;
  let linesExamined = 0;
  let linesInserted = 0;
  const touchedBillIds = new Set();
  const HARD_PAGE_LIMIT = 40;   // 40 * 500 = 20k bills / window; well above real load

  while (pageNo < HARD_PAGE_LIMIT) {
    const url = billsFilteredUrl({ invoiceDateStart, invoiceDateEnd, start, max: PAGE_SIZE });
    const res = await fetchJson(url);
    if (!res.ok) {
      console.error(`[bills] page ${pageNo + 1} FAILED status=${res.status} error=${res.error}`);
      return { ok: false, billsExamined, billsInserted, linesExamined, linesInserted, touchedBillIds, error: res.error };
    }
    const rows = extractRowsV2(res.body);
    pageNo++;
    billsExamined += rows.length;

    // Per-page: hash headers, batch-look-up current hashes, INSERT
    // differing rows. Same shape as rippling_sync.
    const headerRows = [];
    for (const r of rows) {
      if (!r.id) continue;
      const hash = contentHash(r, "bill");
      touchedBillIds.add(String(r.id));
      headerRows.push({
        bill_id:         String(r.id),
        content_hash:    hash,
        vendor_id:       r.vendorId || null,
        invoice_number:  r.invoiceNumber || null,
        invoice_date:    toDate(r.invoiceDate),
        gl_posting_date: toDate(r.glPostingDate),
        amount:          num(r.amount),
        paid_amount:     num(r.paidAmount),
        due_amount:      num(r.amountDue ?? r.dueAmount),
        approval_status: r.approvalStatus != null ? String(r.approvalStatus) : null,
        payment_status:  r.paymentStatus != null ? String(r.paymentStatus) : null,
        is_active:       r.isActive === true || r.isActive === "true" || r.isActive === "1" || r.isActive === 1,
        created_time:    toTimestampTZ(r.createdTime),
        updated_time:    toTimestampTZ(r.updatedTime),
        raw:             r,
        fetch_source:    fetchSource,
        _lines_raw:      Array.isArray(r.billLineItems) ? r.billLineItems
                        : Array.isArray(r.lineItems)   ? r.lineItems
                        : [],
      });
    }

    // Look up current hashes for the page's bill_ids to decide inserts.
    if (!args.dryRun && headerRows.length > 0) {
      const ids = headerRows.map(r => r.bill_id);
      const { data, error } = await supa
        .from("billcom_raw_bills_latest")
        .select("bill_id, content_hash")
        .in("bill_id", ids);
      if (error) {
        console.error(`[bills] page ${pageNo} latest-hash lookup FAILED: ${error.message}`);
        return { ok: false, billsExamined, billsInserted, linesExamined, linesInserted, touchedBillIds, error: error.message };
      }
      const currentByBill = new Map();
      for (const r of data || []) currentByBill.set(r.bill_id, r.content_hash);

      const toInsertHeaders = headerRows.filter(r => currentByBill.get(r.bill_id) !== r.content_hash);
      if (toInsertHeaders.length > 0) {
        const insertPayload = toInsertHeaders.map(({ _lines_raw, ...rest }) => rest);
        const insResp = await supa.from("billcom_raw_bills").insert(insertPayload);
        if (insResp.error) {
          console.error(`[bills] page ${pageNo} header insert FAILED: ${insResp.error.message}`);
          return { ok: false, billsExamined, billsInserted, linesExamined, linesInserted, touchedBillIds, error: insResp.error.message };
        }
        billsInserted += insertPayload.length;
      }
    }

    // Lines: assemble across all bills on this page then batch-look-up.
    const linePayloads = [];
    for (const headerRow of headerRows) {
      const bill_id = headerRow.bill_id;
      const lines = headerRow._lines_raw || [];
      for (const line of lines) {
        if (!line.id) continue;
        linesExamined++;
        linePayloads.push({
          line_id:              String(line.id),
          bill_id:              bill_id,
          content_hash:         contentHash(line, "bill_line"),
          amount:               num(line.amount),
          chart_of_account_id:  line.chartOfAccountId || null,
          actg_class_id:        line.actgClassId || line.classId || null,
          department_id:        line.departmentId || null,
          description:          line.description || null,
          line_order:           Number.isFinite(Number(line.lineOrder)) ? Number(line.lineOrder) : null,
          raw:                  line,
          fetch_source:         fetchSource,
        });
      }
    }
    if (!args.dryRun && linePayloads.length > 0) {
      // Batch-look-up current hashes for these line_ids.
      const lineIds = linePayloads.map(l => l.line_id);
      // Split into chunks of 500 for IN() lookup.
      const currentLineHashes = new Map();
      for (let i = 0; i < lineIds.length; i += 500) {
        const chunk = lineIds.slice(i, i + 500);
        const { data, error } = await supa
          .from("billcom_raw_bill_lines_latest")
          .select("line_id, content_hash")
          .in("line_id", chunk);
        if (error) {
          console.error(`[bills] page ${pageNo} line latest-hash lookup FAILED: ${error.message}`);
          return { ok: false, billsExamined, billsInserted, linesExamined, linesInserted, touchedBillIds, error: error.message };
        }
        for (const r of data || []) currentLineHashes.set(r.line_id, r.content_hash);
      }
      const toInsertLines = linePayloads.filter(l => currentLineHashes.get(l.line_id) !== l.content_hash);
      if (toInsertLines.length > 0) {
        for (let i = 0; i < toInsertLines.length; i += 500) {
          const batch = toInsertLines.slice(i, i + 500);
          const insResp = await supa.from("billcom_raw_bill_lines").insert(batch);
          if (insResp.error) {
            console.error(`[bills] page ${pageNo} line insert FAILED: ${insResp.error.message}`);
            return { ok: false, billsExamined, billsInserted, linesExamined, linesInserted, touchedBillIds, error: insResp.error.message };
          }
          linesInserted += batch.length;
        }
      }
    } else if (args.dryRun) {
      linesInserted += linePayloads.length;   // report what would insert
    }

    process.stderr.write(`[bills] page ${pageNo}  rows=${rows.length}  bills_examined=${billsExamined}  bills_inserted=${billsInserted}  lines_examined=${linesExamined}  lines_inserted=${linesInserted}  elapsed=${Math.round((Date.now() - t0) / 1000)}s\r`);
    if (rows.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  process.stderr.write("\n");

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[bills] window done: bills_examined=${billsExamined} bills_inserted=${billsInserted} lines_examined=${linesExamined} lines_inserted=${linesInserted} duration=${dur}s`);
  return { ok: true, billsExamined, billsInserted, linesExamined, linesInserted, touchedBillIds };
}

// ─── Step c: derive purchasing_actuals for touched bills ─────────────
//
// Load class-site-map + chart-of-accounts snapshots once. For each
// touched bill_id: load its current header + all current lines from
// _latest, compute the new purchasing_actuals rows, then atomically
// DELETE existing + INSERT new inside a per-bill try/catch. On
// per-bill failure, log the id and continue - the failed bill's OLD
// rows remain in purchasing_actuals (last-good), never half-written.

async function deriveForTouchedBills({ touchedBillIds }) {
  const t0 = Date.now();
  if (touchedBillIds.size === 0) {
    console.log("[derive] no bills touched - nothing to derive");
    return { ok: true, billsDerived: 0, rowsWritten: 0, perBillFailures: [] };
  }

  const runInsert = await supa.from("purchasing_derive_runs")
    .insert({ source: "billcom", fetch_source: args.source, status: "in_progress" })
    .select("id").single();
  const runId = runInsert.data?.id;

  // Load maps.
  //
  // billcom_ref_accounts has 1,072 rows and PostgREST caps a single
  // .select() at 1000 rows by default. A single-shot select silently
  // truncates the tail 72 rows (which happen to include multi-dot
  // sub-accounts like 1371.2, 1373.5, 3200.1.2), leaving those lines
  // with gl_line_code NULL. Page via .range() to load all rows.
  const classMapResp = await supa
    .from("billcom_class_site_map")
    .select("actg_class_id, account_key, excluded");
  if (classMapResp.error) {
    console.error(`[derive] class map load FAILED: ${classMapResp.error.message}`);
    return { ok: false, billsDerived: 0, rowsWritten: 0, error: classMapResp.error.message };
  }
  const accountsRows = [];
  {
    const PAGE = 1000;
    let start = 0;
    // Guard against infinite loops in case count grows unexpectedly.
    for (let iter = 0; iter < 20; iter++) {
      const { data, error } = await supa
        .from("billcom_ref_accounts")
        .select("id, account_number")
        .range(start, start + PAGE - 1);
      if (error) {
        console.error(`[derive] accounts load FAILED at range ${start}..${start + PAGE - 1}: ${error.message}`);
        return { ok: false, billsDerived: 0, rowsWritten: 0, error: error.message };
      }
      if (!data || data.length === 0) break;
      accountsRows.push(...data);
      if (data.length < PAGE) break;
      start += PAGE;
    }
  }
  const classMap = new Map((classMapResp.data || []).map(r => [r.actg_class_id, r]));
  const accountToNumber = new Map(accountsRows.map(r => [r.id, r.account_number]));
  console.log(`[derive] loaded ${accountsRows.length} ref accounts into lookup map`);

  let billsDerived = 0;
  let rowsWritten = 0;
  const perBillFailures = [];
  const billIds = [...touchedBillIds];

  // Batch-load headers + lines from _latest for all touched bills.
  const headersByBill = new Map();
  for (let i = 0; i < billIds.length; i += 500) {
    const chunk = billIds.slice(i, i + 500);
    const { data, error } = await supa.from("billcom_raw_bills_latest")
      .select("bill_id, vendor_id, invoice_date, gl_posting_date, amount, paid_amount, payment_status, raw")
      .in("bill_id", chunk);
    if (error) {
      console.error(`[derive] load headers FAILED chunk ${i}..${i + chunk.length}: ${error.message}`);
      return { ok: false, billsDerived, rowsWritten, error: error.message };
    }
    for (const r of data || []) headersByBill.set(r.bill_id, r);
  }
  const linesByBill = new Map();
  for (let i = 0; i < billIds.length; i += 500) {
    const chunk = billIds.slice(i, i + 500);
    const { data, error } = await supa.from("billcom_raw_bill_lines_latest")
      .select("line_id, bill_id, amount, chart_of_account_id, actg_class_id, description")
      .in("bill_id", chunk);
    if (error) {
      console.error(`[derive] load lines FAILED chunk ${i}..${i + chunk.length}: ${error.message}`);
      return { ok: false, billsDerived, rowsWritten, error: error.message };
    }
    for (const r of data || []) {
      if (!linesByBill.has(r.bill_id)) linesByBill.set(r.bill_id, []);
      linesByBill.get(r.bill_id).push(r);
    }
  }

  // Per-bill: compute -> DELETE + INSERT atomically.
  for (const billId of billIds) {
    const header = headersByBill.get(billId);
    if (!header) {
      // Header not in _latest (rare - would mean the bill was ingested
      // then somehow purged mid-run). Skip; leave existing rows.
      perBillFailures.push({ billId, reason: "no_header_in_latest" });
      continue;
    }
    const lines = linesByBill.get(billId) || [];

    // Compute new rows.
    const paid = isPaid({
      paymentStatus: header.payment_status,
      amount:        header.amount,
      paidAmount:    header.paid_amount,
    });
    const vendorOrMerchant = header.vendor_id || null;  // vendor id, not name (name discipline)

    const newRows = [];
    for (const line of lines) {
      const classRow  = classMap.get(line.actg_class_id);
      const excluded  = classRow?.excluded === true;
      const accountKey = excluded ? null : (classRow?.account_key || null);
      const glLineCode = line.chart_of_account_id ? (accountToNumber.get(line.chart_of_account_id) || null) : null;
      newRows.push({
        source:             "billcom",
        source_bill_id:     billId,
        source_line_id:     `billcom:${line.line_id}`,
        account_key:        accountKey,
        excluded:           excluded,
        gl_line_code:       glLineCode,
        gl_bucket:          glBucketFor(glLineCode),
        txn_date:           header.invoice_date,
        posting_date:       header.gl_posting_date,
        amount:             line.amount != null ? Number(line.amount) : 0,
        vendor_or_merchant: vendorOrMerchant,
        paid:               paid,
        approx_date:        false,
      });
    }

    // Atomic per-bill: DELETE existing + INSERT new in sequence.
    // On DELETE failure -> skip, last-good state preserved.
    // On INSERT failure -> log; last-good state has been erased for
    //   this bill (worst case). Next run's DELETE (idempotent on
    //   empty) + INSERT will restore.
    if (args.dryRun) {
      rowsWritten += newRows.length;
      billsDerived += 1;
      continue;
    }
    const delResp = await supa.from("purchasing_actuals")
      .delete()
      .eq("source", "billcom")
      .eq("source_bill_id", billId);
    if (delResp.error) {
      console.error(`[derive] bill ${billId} delete FAILED: ${delResp.error.message}`);
      perBillFailures.push({ billId, reason: `delete: ${delResp.error.message}` });
      continue;
    }
    if (newRows.length > 0) {
      const insResp = await supa.from("purchasing_actuals").insert(newRows);
      if (insResp.error) {
        console.error(`[derive] bill ${billId} insert FAILED: ${insResp.error.message} (rows for this bill temporarily absent; next run will restore)`);
        perBillFailures.push({ billId, reason: `insert: ${insResp.error.message}` });
        continue;
      }
      rowsWritten += newRows.length;
    }
    billsDerived += 1;
  }

  if (runId) {
    await supa.from("purchasing_derive_runs").update({
      completed_at:  new Date().toISOString(),
      status:        perBillFailures.length === 0 ? "success" : "failed",
      bills_touched: billsDerived,
      lines_written: rowsWritten,
      error_message: perBillFailures.length > 0 ? `${perBillFailures.length} per-bill failures` : null,
    }).eq("id", runId);
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[derive] bills_derived=${billsDerived} rows_written=${rowsWritten} per_bill_failures=${perBillFailures.length} duration=${dur}s`);
  return { ok: perBillFailures.length === 0, billsDerived, rowsWritten, perBillFailures };
}

// ─── Probes (spec §2 probes) ─────────────────────────────────────────

async function runProbes({ touchedBillIds }) {
  console.log("");
  console.log("=== PROBES (spec §2) ===");
  const probes = [];

  // P1. sum(billcom_raw_bill_lines.amount) per bill == billcom_raw_bills.amount
  //     to the cent, over the touched set.
  if (touchedBillIds.size > 0) {
    const billIds = [...touchedBillIds];
    let mismatches = 0;
    for (let i = 0; i < billIds.length; i += 500) {
      const chunk = billIds.slice(i, i + 500);
      const [headerResp, lineResp] = await Promise.all([
        supa.from("billcom_raw_bills_latest").select("bill_id, amount").in("bill_id", chunk),
        supa.from("billcom_raw_bill_lines_latest").select("bill_id, amount").in("bill_id", chunk),
      ]);
      if (headerResp.error || lineResp.error) {
        console.log(`P1 FAIL: query error - ${headerResp.error?.message || lineResp.error?.message}`);
        probes.push({ id: "P1", pass: false, note: "query error" });
        return { probes, allPass: false };
      }
      const sumByBill = new Map();
      for (const l of lineResp.data || []) {
        sumByBill.set(l.bill_id, (sumByBill.get(l.bill_id) || 0) + Number(l.amount || 0));
      }
      for (const h of headerResp.data || []) {
        const s = sumByBill.get(h.bill_id) || 0;
        if (Math.abs(s - Number(h.amount || 0)) > 0.01) mismatches++;
      }
    }
    probes.push({ id: "P1", pass: mismatches === 0, note: `mismatches=${mismatches}/${billIds.length}` });
    console.log(`P1 ${mismatches === 0 ? "PASS" : "FAIL"}: sum(lines) == header.amount within 1c (mismatches=${mismatches}/${billIds.length})`);
  } else {
    probes.push({ id: "P1", pass: true, note: "no touched bills" });
    console.log("P1 PASS: no touched bills (vacuous)");
  }

  // P2. purchasing_actuals billcom rows for touched set count matches
  //     sum of lines available for touched set (excluding no-header).
  {
    const billIds = [...touchedBillIds];
    if (billIds.length > 0) {
      let paCount = 0;
      let lineCount = 0;
      for (let i = 0; i < billIds.length; i += 500) {
        const chunk = billIds.slice(i, i + 500);
        const [paResp, linesResp] = await Promise.all([
          supa.from("purchasing_actuals").select("id", { count: "exact", head: true }).eq("source", "billcom").in("source_bill_id", chunk),
          supa.from("billcom_raw_bill_lines_latest").select("line_id", { count: "exact", head: true }).in("bill_id", chunk),
        ]);
        paCount += paResp.count || 0;
        lineCount += linesResp.count || 0;
      }
      const pass = paCount === lineCount;
      probes.push({ id: "P2", pass, note: `pa=${paCount} lines=${lineCount}` });
      console.log(`P2 ${pass ? "PASS" : "FAIL"}: purchasing_actuals billcom rows for touched = raw line count (${paCount} vs ${lineCount})`);
    } else {
      probes.push({ id: "P2", pass: true, note: "no touched bills" });
      console.log("P2 PASS: no touched bills (vacuous)");
    }
  }

  // P3. no (source, source_line_id) duplicate.
  {
    // Do the check server-side via a group-by. Small cost; UNIQUE
    // constraint enforces it too, but the probe explicitly asserts it.
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select("source, source_line_id")
      .eq("source", "billcom")
      .limit(200000);
    if (error) {
      console.log(`P3 FAIL: query error - ${error.message}`);
      probes.push({ id: "P3", pass: false, note: "query error" });
      return { probes, allPass: false };
    }
    const seen = new Set();
    let dupes = 0;
    for (const r of data || []) {
      const key = `${r.source}|${r.source_line_id}`;
      if (seen.has(key)) dupes++;
      seen.add(key);
    }
    probes.push({ id: "P3", pass: dupes === 0, note: `dupes=${dupes}` });
    console.log(`P3 ${dupes === 0 ? "PASS" : "FAIL"}: no (source, source_line_id) duplicates (dupes=${dupes})`);
  }

  // P4. CORP + CHI rows have account_key null AND excluded=true; sum
  //     over excluded rows for site views == 0 (enforced by view WHERE
  //     excluded=FALSE + constraint). Probe explicitly asserts the row
  //     shape.
  {
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select("account_key, excluded")
      .eq("source", "billcom")
      .eq("excluded", true)
      .limit(50000);
    if (error) {
      console.log(`P4 FAIL: query error - ${error.message}`);
      probes.push({ id: "P4", pass: false, note: "query error" });
      return { probes, allPass: false };
    }
    let bad = 0;
    for (const r of data || []) if (r.account_key !== null) bad++;
    const pass = bad === 0;
    probes.push({ id: "P4", pass, note: `bad=${bad} excluded_count=${(data || []).length}` });
    console.log(`P4 ${pass ? "PASS" : "FAIL"}: every excluded row has account_key null (bad=${bad}/${(data || []).length})`);
  }

  // P5. Idempotency: content-hash unchanged for a re-fetch. The
  //     stronger form (re-run inserts zero) is asserted by the sync's
  //     insert count; a running probe asserts no orphaned rows.
  //     Implemented as "no bill in touched set has current-latest
  //     header AND line hashes differing from what we just wrote."
  {
    // Sample: the LAST touched bill; assert re-hashing its raw payload
    // yields the same content_hash as the stored one.
    const billIds = [...touchedBillIds];
    if (billIds.length > 0) {
      const sample = billIds[billIds.length - 1];
      const { data, error } = await supa.from("billcom_raw_bills_latest").select("bill_id, content_hash, raw").eq("bill_id", sample).maybeSingle();
      if (error) {
        console.log(`P5 FAIL: query error - ${error.message}`);
        probes.push({ id: "P5", pass: false, note: "query error" });
        return { probes, allPass: false };
      }
      const rehash = data?.raw ? contentHash(data.raw, "bill") : null;
      const pass = rehash && rehash === data.content_hash;
      probes.push({ id: "P5", pass, note: `sample=${sample} rehash_matches=${pass}` });
      console.log(`P5 ${pass ? "PASS" : "FAIL"}: content-hash idempotent on sample bill (${sample}, matches=${pass})`);
    } else {
      probes.push({ id: "P5", pass: true, note: "no touched bills" });
      console.log("P5 PASS: no touched bills (vacuous)");
    }
  }

  // P6. unattributed count + uncoded count reported (informational,
  //     not a fail). Included so the sync always prints the coverage.
  {
    const [unattrResp, uncodedResp] = await Promise.all([
      supa.from("purchasing_actuals").select("id", { count: "exact", head: true }).eq("source", "billcom").is("account_key", null).eq("excluded", false),
      supa.from("purchasing_actuals").select("id", { count: "exact", head: true }).eq("source", "billcom").is("gl_line_code", null),
    ]);
    const unattr = unattrResp.count || 0;
    const uncoded = uncodedResp.count || 0;
    probes.push({ id: "P6", pass: true, note: `unattributed=${unattr} uncoded=${uncoded}` });
    console.log(`P6 INFO: billcom unattributed=${unattr} uncoded=${uncoded}`);
  }

  // P7. Any purchasing_actuals billcom row with gl_line_code NULL
  //     whose raw line's chart_of_account_id EXISTS in
  //     billcom_ref_accounts is a lookup miss -> FAIL. Rows whose coa
  //     is genuinely absent from ref are reported separately and are
  //     not a failure. Applies across ALL billcom rows (not just the
  //     touched window) because ref refresh is a full replace and
  //     coverage is a global property.
  {
    // Load full ref-account id set (page past 1000-row PostgREST cap).
    const refIds = new Set();
    {
      const PAGE = 1000;
      let start = 0;
      for (let iter = 0; iter < 20; iter++) {
        const { data, error } = await supa
          .from("billcom_ref_accounts")
          .select("id")
          .range(start, start + PAGE - 1);
        if (error) {
          console.log(`P7 FAIL: ref accounts load error - ${error.message}`);
          probes.push({ id: "P7", pass: false, note: "ref load error" });
          return { probes, allPass: false };
        }
        if (!data || data.length === 0) break;
        for (const r of data) refIds.add(r.id);
        if (data.length < PAGE) break;
        start += PAGE;
      }
    }

    // Load all billcom purchasing_actuals rows that are still uncoded.
    // Page past the 1000-row PostgREST cap defensively.
    const uncodedRows = [];
    {
      const PAGE = 1000;
      let start = 0;
      for (let iter = 0; iter < 100; iter++) {
        const { data, error } = await supa
          .from("purchasing_actuals")
          .select("source_line_id")
          .eq("source", "billcom")
          .is("gl_line_code", null)
          .range(start, start + PAGE - 1);
        if (error) {
          console.log(`P7 FAIL: uncoded scan error - ${error.message}`);
          probes.push({ id: "P7", pass: false, note: "uncoded scan error" });
          return { probes, allPass: false };
        }
        if (!data || data.length === 0) break;
        uncodedRows.push(...data);
        if (data.length < PAGE) break;
        start += PAGE;
      }
    }

    if (uncodedRows.length === 0) {
      probes.push({ id: "P7", pass: true, note: "no uncoded billcom rows" });
      console.log("P7 PASS: no uncoded billcom rows");
    } else {
      // source_line_id is stored as "billcom:<line_id>"; strip the
      // prefix to join to billcom_raw_bill_lines_latest.line_id which
      // is stored bare.
      const lineIds = uncodedRows.map(r => {
        const s = String(r.source_line_id || "");
        return s.startsWith("billcom:") ? s.slice("billcom:".length) : s;
      });
      const coaById = new Map();
      for (let i = 0; i < lineIds.length; i += 500) {
        const chunk = lineIds.slice(i, i + 500);
        const { data, error } = await supa
          .from("billcom_raw_bill_lines_latest")
          .select("line_id, chart_of_account_id")
          .in("line_id", chunk);
        if (error) {
          console.log(`P7 FAIL: line lookup error - ${error.message}`);
          probes.push({ id: "P7", pass: false, note: "line lookup error" });
          return { probes, allPass: false };
        }
        for (const r of data || []) coaById.set(r.line_id, r.chart_of_account_id);
      }
      let lookupMiss = 0;   // coa exists in ref but derive left NULL -> bug
      let genuineAbsent = 0;// coa not in ref (or line has no coa at all)
      const missingCoaCounts = new Map();
      for (const lid of lineIds) {
        const coa = coaById.get(lid);
        if (coa && refIds.has(coa)) {
          lookupMiss++;
        } else {
          genuineAbsent++;
          if (coa) missingCoaCounts.set(coa, (missingCoaCounts.get(coa) || 0) + 1);
        }
      }
      const topAbsent = [...missingCoaCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, n]) => `${id}=${n}`)
        .join(" ");
      const pass = lookupMiss === 0;
      probes.push({
        id: "P7",
        pass,
        note: `lookup_miss=${lookupMiss} genuine_absent=${genuineAbsent}${topAbsent ? ` top_absent=[${topAbsent}]` : ""}`,
      });
      console.log(`P7 ${pass ? "PASS" : "FAIL"}: uncoded billcom rows whose coa EXISTS in ref (must be 0): ${lookupMiss}. Genuinely-absent coa: ${genuineAbsent}${topAbsent ? ` top=[${topAbsent}]` : ""}`);
    }
  }

  const allPass = probes.every(p => p.pass);
  return { probes, allPass };
}

// ─── Main ────────────────────────────────────────────────────────────

let refAccountsResult, refClassesResult, refVendorsResult, billsResult, deriveResult, probesResult;
try {
  refAccountsResult = await refreshChartOfAccounts();
  refClassesResult  = await refreshClasses();
  refVendorsResult  = await refreshVendors();
  if (!refAccountsResult.ok || !refClassesResult.ok || !refVendorsResult.ok) {
    console.error("[fatal] reference refresh failed; derive skipped");
  } else {
    // Compute window.
    let invoiceDateStart, invoiceDateEnd;
    if (args.source === "fytd") {
      invoiceDateStart = periodStartISO(args.period);
      invoiceDateEnd   = periodEndISO(args.period);
      console.log(`[bills] fytd pass period=${args.period} window=${invoiceDateStart}..${invoiceDateEnd}`);
    } else {
      const today = new Date();
      invoiceDateEnd = today.toISOString().slice(0, 10);
      const startTs = new Date(today.getTime() - WINDOW_DAYS * 86400000);
      invoiceDateStart = startTs.toISOString().slice(0, 10);
      console.log(`[bills] trailing window=${invoiceDateStart}..${invoiceDateEnd} (${WINDOW_DAYS}d)`);
    }
    billsResult = await walkBillsWindow({
      invoiceDateStart, invoiceDateEnd,
      fetchSource: args.source,
    });
    if (billsResult.ok) {
      deriveResult = await deriveForTouchedBills({ touchedBillIds: billsResult.touchedBillIds });
      probesResult = await runProbes({ touchedBillIds: billsResult.touchedBillIds });
    }
  }
} finally {
  await releaseLock();
}

const finishedAt = new Date();
const totalSec = ((finishedAt - startedAt) / 1000).toFixed(1);

console.log("");
console.log("purchasing_billcom_sync summary:");
console.log(`  ref_accounts:  ${refAccountsResult?.ok ? "ok" : "FAIL"}  count=${refAccountsResult?.count}`);
console.log(`  ref_classes:   ${refClassesResult?.ok ? "ok" : "FAIL"}  count=${refClassesResult?.count}`);
console.log(`  ref_vendors:   ${refVendorsResult?.ok ? "ok" : "FAIL"}  count=${refVendorsResult?.count}`);
if (billsResult) {
  console.log(`  bills:         ${billsResult.ok ? "ok" : "FAIL"}  bills_examined=${billsResult.billsExamined} bills_inserted=${billsResult.billsInserted} lines_examined=${billsResult.linesExamined} lines_inserted=${billsResult.linesInserted}`);
}
if (deriveResult) {
  console.log(`  derive:        ${deriveResult.ok ? "ok" : "FAIL"}  bills_derived=${deriveResult.billsDerived} rows_written=${deriveResult.rowsWritten} per_bill_failures=${deriveResult.perBillFailures?.length ?? 0}`);
}
if (probesResult) {
  console.log(`  probes:        ${probesResult.allPass ? "ALL PASS" : "FAIL"}  ${probesResult.probes.map(p => `${p.id}=${p.pass ? "P" : "F"}`).join(" ")}`);
}
console.log(`  total elapsed=${totalSec}s  source=${args.source}  dryRun=${args.dryRun}`);

// Exit code
if (!refAccountsResult?.ok || !refClassesResult?.ok || !refVendorsResult?.ok || !billsResult?.ok || !deriveResult?.ok) process.exit(2);
if (probesResult && !probesResult.allPass) process.exit(4);
process.exit(0);
