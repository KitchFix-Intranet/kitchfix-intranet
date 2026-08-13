// Task 3 Fix 1 backfill (Phase 2c, 2026-08-13).
//
// Applies the same needs_review/review_reason validation gate that
// src/lib/dataStore/invoice.js:insertAILineItemsPostgres now runs on
// inserts, but retroactively to existing rows.
//
// Rules (must stay in sync with insertAILineItemsPostgres + the exported
// helpers evaluateLineArithmetic / evaluateInvoiceOverextraction):
//   1. Per-row: |extended_price - qty * unit_price| > max($5, 2% * |qty*up|)
//      -> needs_review=true, review_reason='ep_qty_up_mismatch'
//   2. Per-invoice: SUM(extended_price) / header total > 1.15 -> ALL
//      rows on that invoice -> needs_review=true, review_reason='invoice_over_extracted'
//   3. Invoice-level tag overrides per-row tag.
//   4. Rows already passing default to needs_review=false (PG column default);
//      we do NOT touch them.
//
// Scope: TBR-FL, TBJ-FL, STL-FL, invoice_date >= 2025-08-01. Same
// per-account window that Phase 2 recon uses.
//
// USAGE
//   From ~/dev/purchase-discovery-2026-08-12/kitchfix-intranet:
//     node --import ./scripts/_setup/register-aliases.mjs \
//          scripts/_task3_backfill_needs_review.mjs           # dry-run
//     node --import ./scripts/_setup/register-aliases.mjs \
//          scripts/_task3_backfill_needs_review.mjs --execute
//
// Requires pr-10-3 applied. Fails loud if columns absent.

import { createClient } from "@supabase/supabase-js";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");

const LOG_PATH = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/task3_backfill_log.jsonl";
const ACCOUNTS = ["TBR - FL", "TBJ - FL", "STL - FL"];
const SINCE_DATE = "2025-08-01";

// Must stay in sync with src/lib/dataStore/invoice.js exports.
const EP_ABS_TOLERANCE = 5;
const EP_REL_TOLERANCE = 0.02;
const INVOICE_OVEREXTRACTION_THRESHOLD = 1.15;

console.log(`[task3-backfill] mode=${EXECUTE ? "EXECUTE" : "dry-run"}  since=${SINCE_DATE}`);
console.log(`[task3-backfill] accounts: ${ACCOUNTS.join(", ")}`);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[task3-backfill] missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Reset log
writeFileSync(LOG_PATH, "");
function logRow(row) {
  appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
}
logRow({ ts: new Date().toISOString(), event: "RUN_START", mode: EXECUTE ? "EXECUTE" : "dry-run" });

// === Guard: pr-10-3 applied? ===
// Probe the columns directly; PostgREST throws 42703 with the column name in
// the message when a select references a missing column. This is more
// reliable than a live information_schema query (not always exposed).
{
  const probe = await supa.from("ai_line_items").select("id, needs_review, review_reason").limit(1);
  if (probe.error && /needs_review|review_reason/.test(probe.error.message)) {
    console.error("[task3-backfill] pr-10-3 not applied. Kevin: paste docs/migrations/pr-10-3-add-needs-review-columns.sql into Studio, then re-run.");
    console.error(`  underlying error: ${probe.error.message}`);
    logRow({ ts: new Date().toISOString(), event: "ABORT_PR_10_3_MISSING", error: probe.error.message });
    process.exit(3);
  }
  if (probe.error) {
    console.error(`[task3-backfill] unexpected probe error: ${probe.error.message}`);
    process.exit(3);
  }
}
console.log("[task3-backfill] pr-10-3 columns present.");

// === Read all rows in scope ===
// Join to invoice_submissions for header total_amount.
function evaluateLineArithmetic(qty, up, ep) {
  if (qty == null || up == null || ep == null) return { needsReview: false, reason: null };
  const expected = Number(qty) * Number(up);
  const diff = Math.abs(Number(ep) - expected);
  const tol = Math.max(EP_ABS_TOLERANCE, EP_REL_TOLERANCE * Math.abs(expected));
  if (diff > tol) return { needsReview: true, reason: "ep_qty_up_mismatch" };
  return { needsReview: false, reason: null };
}
function evaluateInvoiceOverextraction(lines, headerTotal) {
  if (headerTotal == null || Number(headerTotal) <= 0) return false;
  const sum = lines.reduce((a, l) => a + (l.extended_price == null ? 0 : Number(l.extended_price)), 0);
  return (sum / Number(headerTotal)) > INVOICE_OVEREXTRACTION_THRESHOLD;
}

const perAccount = {};

for (const account of ACCOUNTS) {
  console.log(`\n[task3-backfill] processing ${account}...`);
  perAccount[account] = { rowsExamined: 0, invoicesExamined: 0, rowsTagged: 0, byReason: {}, invoicesFullyTagged: 0 };

  // Fetch all ai_line_items rows for this account since SINCE_DATE.
  // Page through - PostgREST default limit is 1000.
  const rows = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const res = await supa
      .from("ai_line_items")
      .select("id, invoice_uuid, quantity, unit_price, extended_price, needs_review, review_reason")
      .eq("account_key", account)
      .gte("invoice_date", SINCE_DATE)
      .order("invoice_uuid", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) {
      console.error(`[task3-backfill] read failed for ${account}: ${res.error.message}`);
      logRow({ ts: new Date().toISOString(), event: "READ_ERROR", account, error: res.error.message });
      process.exit(4);
    }
    rows.push(...(res.data || []));
    if ((res.data || []).length < PAGE) break;
    from += PAGE;
  }
  perAccount[account].rowsExamined = rows.length;
  console.log(`  fetched ${rows.length} rows`);

  // Group by invoice_uuid + fetch header totals in bulk.
  // Guard: skip rows with null/malformed invoice_uuid (legacy Sheets-only rows).
  const byInvoice = new Map();
  for (const r of rows) {
    if (!r.invoice_uuid || r.invoice_uuid === "null") continue;
    if (!byInvoice.has(r.invoice_uuid)) byInvoice.set(r.invoice_uuid, []);
    byInvoice.get(r.invoice_uuid).push(r);
  }
  perAccount[account].invoicesExamined = byInvoice.size;

  const invoiceIds = [...byInvoice.keys()].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const subsByPgId = new Map();
  const CHUNK = 200;
  for (let i = 0; i < invoiceIds.length; i += CHUNK) {
    const chunk = invoiceIds.slice(i, i + CHUNK);
    const subs = await supa
      .from("invoice_submissions")
      .select("id, total_amount")
      .in("id", chunk);
    if (subs.error) {
      console.error(`[task3-backfill] header lookup failed: ${subs.error.message}`);
      process.exit(5);
    }
    for (const s of subs.data || []) subsByPgId.set(s.id, s.total_amount);
  }

  // Compute per-row + per-invoice verdicts
  const updates = []; // { id, needs_review, review_reason }
  let invoicesTagged = 0;
  for (const [invoiceId, invLines] of byInvoice.entries()) {
    const headerTotal = subsByPgId.get(invoiceId);
    const invOver = evaluateInvoiceOverextraction(invLines, headerTotal);
    if (invOver) invoicesTagged++;
    for (const r of invLines) {
      let needsReview = false;
      let reason = null;
      if (invOver) {
        needsReview = true;
        reason = "invoice_over_extracted";
      } else {
        const chk = evaluateLineArithmetic(r.quantity, r.unit_price, r.extended_price);
        if (chk.needsReview) {
          needsReview = true;
          reason = chk.reason;
        }
      }
      // Only queue an update if the current state differs.
      if (needsReview !== !!r.needs_review || (reason || null) !== (r.review_reason || null)) {
        if (needsReview) {
          updates.push({ id: r.id, needs_review: true, review_reason: reason });
          perAccount[account].byReason[reason] = (perAccount[account].byReason[reason] || 0) + 1;
        }
        // We do NOT clear existing needs_review=true rows here. If Kevin
        // reviewed and reset, that's manual and we don't undo it. Backfill
        // is one-directional: tag additional problems, don't untag.
      }
    }
  }
  perAccount[account].rowsTagged = updates.length;
  perAccount[account].invoicesFullyTagged = invoicesTagged;

  console.log(`  invoices=${byInvoice.size}  invoices_over_extracted=${invoicesTagged}  rows_to_tag=${updates.length}`);
  console.log(`  by reason: ${JSON.stringify(perAccount[account].byReason)}`);

  if (!EXECUTE) {
    logRow({ ts: new Date().toISOString(), event: "DRY_RUN_SUMMARY", account, ...perAccount[account] });
    continue;
  }

  // Batch update. PostgREST doesn't support bulk UPDATE with per-row
  // values; group by (needs_review, review_reason) tuple and issue one
  // UPDATE per group with .in('id', ids).
  const groups = new Map(); // reason -> ids[]
  for (const u of updates) {
    if (!groups.has(u.review_reason)) groups.set(u.review_reason, []);
    groups.get(u.review_reason).push(u.id);
  }
  for (const [reason, ids] of groups.entries()) {
    // Chunk to avoid overly large IN() lists
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const upd = await supa
        .from("ai_line_items")
        .update({ needs_review: true, review_reason: reason })
        .in("id", chunk);
      if (upd.error) {
        console.error(`[task3-backfill] update failed (${reason}, ${chunk.length} ids): ${upd.error.message}`);
        logRow({ ts: new Date().toISOString(), event: "UPDATE_ERROR", account, reason, chunk_size: chunk.length, error: upd.error.message });
        process.exit(6);
      }
    }
    console.log(`  updated: reason=${reason}  count=${ids.length}`);
  }

  logRow({ ts: new Date().toISOString(), event: "EXECUTE_SUMMARY", account, ...perAccount[account] });
}

console.log(`\n[task3-backfill] =========  RUN COMPLETE  =========`);
for (const [k, v] of Object.entries(perAccount)) {
  console.log(`  ${k}: rows=${v.rowsExamined} invoices=${v.invoicesExamined} invoices_over_extracted=${v.invoicesFullyTagged} rows_tagged=${v.rowsTagged} by_reason=${JSON.stringify(v.byReason)}`);
}
const totalTagged = Object.values(perAccount).reduce((a, v) => a + v.rowsTagged, 0);
console.log(`  TOTAL rows tagged: ${totalTagged}`);
logRow({ ts: new Date().toISOString(), event: "RUN_END", perAccount, totalTagged });
