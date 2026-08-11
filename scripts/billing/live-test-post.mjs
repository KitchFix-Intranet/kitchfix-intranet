#!/usr/bin/env node
// live-test-post.mjs - PR-C Step 5, gated on Kevin's go.
//
// Build the payload for a real (account, week), apply test-marking,
// POST to QBO customer 22463, and print:
//   - the invoice id + DocNumber
//   - the ledger row
//   - a read-back GET showing test markers + line-level parity
//
// Run:
//   node --env-file=.env.local scripts/billing/live-test-post.mjs \
//     --account "TXR - AZ" --week 2026-07-27
//
// STOP after: cleanup (void or delete) is Josh's or Sebastian's
// action. Do not delete or void from this script.

import { createClient } from "@supabase/supabase-js";
import { buildInvoicePayload } from "../../src/lib/billing/buildInvoicePayload.js";
import { postInvoiceDraft, TEST_CUSTOMER_ID } from "../../src/lib/billing/qboAdapter.js";

const QBO_BASE = "https://chief.ngrok.app/qbo/v3/company/1219933770";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--account") args.account = argv[++i];
    else if (argv[i] === "--week") args.week = argv[++i];
  }
  if (!args.account) throw new Error("--account required");
  if (!args.week)    throw new Error("--week required (ISO Monday)");
  return args;
}

function pgClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function qGet(qql, apiKey) {
  const url = `${QBO_BASE}/query?query=${encodeURIComponent(qql)}&minorversion=75`;
  const res = await fetch(url, { headers: { "X-API-Key": apiKey, "Accept": "application/json" } });
  const body = await res.text();
  if (!res.ok) throw new Error(`QBQL failed (${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const REVENUE_COLS =
  "service_date, service_id, service_name, account_key, is_flat_fee, is_tax_free, is_non_revenue, actual_count, actual_price_at_date, price_at_date, projected_count, period, week_label, has_actuals, has_projection";

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[live-test-post] account=${args.account}  week=${args.week}`);

  const apiKey = process.env.QBO_PROXY_KEY;
  if (!apiKey) throw new Error("QBO_PROXY_KEY required (never echoed)");

  const supa = pgClient();
  const { data: accountMap } = await supa.from("sc_qbo_account_map").select("*").eq("account_key", args.account).maybeSingle();
  if (!accountMap) throw new Error(`no sc_qbo_account_map for ${args.account}`);
  const { data: serviceMap } = await supa.from("sc_qbo_service_map").select("*").eq("account_key", args.account).eq("active", true);

  const spanDays = accountMap.cadence === "biweekly" ? 14 : 7;
  const first = args.week;
  const last  = addDays(args.week, spanDays - 1);
  const { data: rows } = await supa.from("sc_daily_revenue").select(REVENUE_COLS)
    .eq("account_key", args.account).gte("service_date", first).lte("service_date", last);
  console.log(`[live-test-post] span ${first}..${last}  loaded ${rows.length} sc_daily_revenue rows`);

  const built = buildInvoicePayload({
    accountKey: args.account, weekStart: args.week,
    rows, accountMap, serviceMap,
  });
  if (built.invoices.length === 0) throw new Error("no invoices to build");

  const results = [];
  for (const invoice of built.invoices) {
    console.log(`[live-test-post] posting slot=${invoice._slot} lines=${invoice.Line.length}`);
    const result = await postInvoiceDraft(invoice, {
      isTest:      true,
      accountKey:  args.account,
      weekStart:   first,
      weekEnd:     last,
      cadenceUnit: accountMap.cadence,
      createdBy:   "live-test-post",
    });
    console.log(`  -> id=${result.qboInvoiceId}  doc=${result.qboDocNumber}  ledgerRow=${result.ledgerRowId}`);
    results.push({ slot: invoice._slot, ...result });
  }

  console.log(`\n=== read-back ===`);
  for (const r of results) {
    const qql = `SELECT * FROM Invoice WHERE Id = '${r.qboInvoiceId}'`;
    const res = await qGet(qql, apiKey);
    const inv = res?.QueryResponse?.Invoice?.[0];
    if (!inv) { console.log(`  slot=${r.slot}  READ-BACK MISSING`); continue; }
    console.log(`  slot=${r.slot}  DocNumber=${inv.DocNumber}  CustomerRef=${inv.CustomerRef?.value} ${inv.CustomerRef?.name}`);
    console.log(`    TxnDate=${inv.TxnDate}  EmailStatus=${inv.EmailStatus || "(unset)"}`);
    console.log(`    CustomerMemo=${JSON.stringify(inv.CustomerMemo?.value || "").slice(0, 80)}`);
    console.log(`    PrivateNote=${JSON.stringify(inv.PrivateNote || "").slice(0, 120)}`);
    console.log(`    Lines=${(inv.Line || []).filter(l => l.DetailType==="SalesItemLineDetail").length}`);
    for (const l of (inv.Line || []).filter(l => l.DetailType==="SalesItemLineDetail").slice(0, 3)) {
      const sil = l.SalesItemLineDetail;
      console.log(`      ${sil.ServiceDate}  item=${sil.ItemRef.value}  qty=${sil.Qty}  rate=${sil.UnitPrice}  amt=${l.Amount}  desc=${JSON.stringify(l.Description)}`);
    }
    // Test-marker sanity checks.
    const okCust = inv.CustomerRef?.value === TEST_CUSTOMER_ID;
    const okYear = String(inv.TxnDate).startsWith("2029");
    const okMemo = /TEST - NOT A REAL INVOICE/.test(inv.CustomerMemo?.value || "");
    const okNote = /TEST - NOT A REAL INVOICE/.test(inv.PrivateNote || "");
    const okDescs = (inv.Line || []).every((l) => l.DetailType !== "SalesItemLineDetail" || /^TEST /.test(l.Description || ""));
    console.log(`    markers ok? customer=${okCust} txnYear2029=${okYear} memo=${okMemo} note=${okNote} desc-prefixes=${okDescs}`);
  }

  console.log(`\n=== NEXT ===`);
  console.log(`Cleanup (void or delete) is Josh's or Sebastian's action, not this script's. Halt here.`);
}

main().catch((e) => {
  console.error("[live-test-post] ERROR:", e.message);
  process.exit(1);
});
