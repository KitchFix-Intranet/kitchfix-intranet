// scripts/purchasing_billcom_rederive.mjs
//
// One-shot re-derive of purchasing_actuals billcom rows for ALL bills
// present in billcom_raw_bills_latest. No network fetch; pure recompute
// from raw + refreshed reference tables. Intended for use after a
// derive-logic code fix (e.g. PR-707 sub-account lookup fix). Idempotent
// on identical output.
//
// Reuses the same shape as scripts/purchasing_billcom_sync.mjs
// deriveForTouchedBills but sourced from every bill_id in _latest.
//
// CLI:
//   node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local scripts/purchasing_billcom_rederive.mjs [--dry-run]
//
// Exit codes:
//   0  success
//   1  configuration error
//   2  per-bill failure(s) occurred

import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { isPaid, glBucketFor } from "../src/lib/billcom.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const dryRun = process.argv.slice(2).includes("--dry-run");
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const startedAt = new Date();
console.log(`purchasing_billcom_rederive dryRun=${dryRun} started=${startedAt.toISOString()}`);

// Concurrency lock: reuse the same lock name so this cannot race the sync.
const LOCK_NAME = "purchasing_billcom_sync";
const LOCK_TTL_MS = 4 * 60 * 60 * 1000;
const HOLDER_ID = [
  "rederive",
  `host=${os.hostname()}`,
  `pid=${process.pid}`,
  `started=${startedAt.toISOString()}`,
].join(" ");

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
      console.error("another purchasing_billcom_sync run is in flight, refusing to start");
      process.exit(3);
    }
    console.error(`lock: acquire failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`acquired lock holder="${HOLDER_ID}" expires_at=${expiresAt}`);
}

async function releaseLock() {
  await supa.from("purchasing_sync_locks").delete().eq("name", LOCK_NAME).eq("holder", HOLDER_ID);
}

await acquireLock();
process.on("SIGINT",  async () => { await releaseLock(); process.exit(130); });
process.on("SIGTERM", async () => { await releaseLock(); process.exit(143); });

try {
  const t0 = Date.now();

  // Load maps. Same PostgREST 1000-row-cap fix as the sync's derive.
  const classMapResp = await supa
    .from("billcom_class_site_map")
    .select("actg_class_id, account_key, excluded");
  if (classMapResp.error) throw new Error(`class map: ${classMapResp.error.message}`);

  const accountsRows = [];
  {
    const PAGE = 1000;
    let start = 0;
    for (let iter = 0; iter < 20; iter++) {
      const { data, error } = await supa
        .from("billcom_ref_accounts")
        .select("id, account_number")
        .range(start, start + PAGE - 1);
      if (error) throw new Error(`ref accounts range ${start}: ${error.message}`);
      if (!data || data.length === 0) break;
      accountsRows.push(...data);
      if (data.length < PAGE) break;
      start += PAGE;
    }
  }
  const classMap = new Map((classMapResp.data || []).map(r => [r.actg_class_id, r]));
  const accountToNumber = new Map(accountsRows.map(r => [r.id, r.account_number]));
  console.log(`[rederive] loaded ${accountsRows.length} ref accounts, ${classMap.size} class map rows`);

  // Load ALL bill_ids from _latest (page past 1000 cap).
  const billIds = [];
  {
    const PAGE = 1000;
    let start = 0;
    for (let iter = 0; iter < 200; iter++) {
      const { data, error } = await supa
        .from("billcom_raw_bills_latest")
        .select("bill_id")
        .range(start, start + PAGE - 1);
      if (error) throw new Error(`load bill_ids range ${start}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data) billIds.push(r.bill_id);
      if (data.length < PAGE) break;
      start += PAGE;
    }
  }
  console.log(`[rederive] ${billIds.length} bills to re-derive`);

  const runInsert = await supa.from("purchasing_derive_runs")
    .insert({ source: "billcom", fetch_source: "rederive", status: "in_progress" })
    .select("id").single();
  const runId = runInsert.data?.id;

  // Batch-load headers + lines from _latest.
  const headersByBill = new Map();
  for (let i = 0; i < billIds.length; i += 500) {
    const chunk = billIds.slice(i, i + 500);
    const { data, error } = await supa.from("billcom_raw_bills_latest")
      .select("bill_id, vendor_id, invoice_date, gl_posting_date, amount, paid_amount, payment_status")
      .in("bill_id", chunk);
    if (error) throw new Error(`load headers chunk ${i}: ${error.message}`);
    for (const r of data || []) headersByBill.set(r.bill_id, r);
    process.stderr.write(`[rederive] loaded headers ${headersByBill.size}/${billIds.length}\r`);
  }
  process.stderr.write("\n");

  const linesByBill = new Map();
  for (let i = 0; i < billIds.length; i += 500) {
    const chunk = billIds.slice(i, i + 500);
    const { data, error } = await supa.from("billcom_raw_bill_lines_latest")
      .select("line_id, bill_id, amount, chart_of_account_id, actg_class_id, description")
      .in("bill_id", chunk);
    if (error) throw new Error(`load lines chunk ${i}: ${error.message}`);
    for (const r of data || []) {
      if (!linesByBill.has(r.bill_id)) linesByBill.set(r.bill_id, []);
      linesByBill.get(r.bill_id).push(r);
    }
    process.stderr.write(`[rederive] loaded lines for ${linesByBill.size} bills\r`);
  }
  process.stderr.write("\n");

  let billsDerived = 0;
  let rowsWritten = 0;
  const perBillFailures = [];

  for (const [idx, billId] of billIds.entries()) {
    const header = headersByBill.get(billId);
    if (!header) {
      perBillFailures.push({ billId, reason: "no_header_in_latest" });
      continue;
    }
    const lines = linesByBill.get(billId) || [];
    const paid = isPaid({
      paymentStatus: header.payment_status,
      amount:        header.amount,
      paidAmount:    header.paid_amount,
    });
    const vendorOrMerchant = header.vendor_id || null;

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

    if (dryRun) {
      rowsWritten += newRows.length;
      billsDerived += 1;
      continue;
    }
    const delResp = await supa.from("purchasing_actuals")
      .delete()
      .eq("source", "billcom")
      .eq("source_bill_id", billId);
    if (delResp.error) {
      perBillFailures.push({ billId, reason: `delete: ${delResp.error.message}` });
      continue;
    }
    if (newRows.length > 0) {
      const insResp = await supa.from("purchasing_actuals").insert(newRows);
      if (insResp.error) {
        perBillFailures.push({ billId, reason: `insert: ${insResp.error.message}` });
        continue;
      }
      rowsWritten += newRows.length;
    }
    billsDerived += 1;

    if ((idx + 1) % 100 === 0) {
      process.stderr.write(`[rederive] progress ${idx + 1}/${billIds.length} bills, ${rowsWritten} rows written, ${perBillFailures.length} failures\r`);
    }
  }
  process.stderr.write("\n");

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
  console.log(`\n[rederive] DONE bills_derived=${billsDerived} rows_written=${rowsWritten} failures=${perBillFailures.length} duration=${dur}s`);
  if (perBillFailures.length > 0) {
    console.log("First 5 failures:");
    for (const f of perBillFailures.slice(0, 5)) console.log(`  ${f.billId}: ${f.reason}`);
  }
} finally {
  await releaseLock();
}

process.exit(0);
