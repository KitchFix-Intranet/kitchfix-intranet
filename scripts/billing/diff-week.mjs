#!/usr/bin/env node
// scripts/billing/diff-week.mjs
//
// PR-B step 4 (B5): the retro-shadow diff instrument. Runs the
// buildInvoicePayload transform against LIVE sc_daily_revenue rows
// for one account + one week, fetches the corresponding real QBO
// invoice(s) READ-ONLY via the proxy, and prints a line-by-line
// diff + verdict (MATCH / DIFF / SC DATA ABSENT).
//
// Contract per spec §8:
//   - GET only. NO writes to QBO or PG at any point.
//   - Uses env vars QBO_PROXY_BASE + QBO_PROXY_KEY (never echoed).
//   - Verdicts:
//       MATCH               - builder output line-equal to invoice
//       DIFF [names]        - builder output diverges, named lines
//       SC DATA ABSENT      - builder emits no invoice (no actuals)
//       QBO INVOICE ABSENT  - no QBO invoice found for the week
//       CONFIG UNMAPPED     - service in scope has no service_map row
//
// Usage:
//   node scripts/billing/diff-week.mjs --account "TXR - AZ" --week 2026-07-27
//   node scripts/billing/diff-week.mjs --account "CIN - AZ" --week 2026-07-13
//
// The week arg is the pair's FIRST Monday for biweekly accounts.

import { createClient } from "@supabase/supabase-js";
import { buildInvoicePayload } from "../../src/lib/billing/buildInvoicePayload.js";

// ─── args ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--account") args.account = argv[++i];
    else if (argv[i] === "--week") args.week = argv[++i];
  }
  if (!args.account) throw new Error("--account required (e.g., --account \"TXR - AZ\")");
  if (!args.week || !/^\d{4}-\d{2}-\d{2}$/.test(args.week)) {
    throw new Error("--week required, ISO Monday (e.g., --week 2026-07-27)");
  }
  const dow = new Date(`${args.week}T12:00:00Z`).getUTCDay();
  if (dow !== 1) throw new Error(`--week must be a Monday (isodow=1), got isodow=${dow}`);
  return args;
}

// ─── QBO proxy client (GET only) ──────────────────────────────────
const QBO_BASE = "https://chief.ngrok.app/qbo/v3/company/1219933770";
async function qGet(qql, apiKey) {
  const url = `${QBO_BASE}/query?query=${encodeURIComponent(qql)}&minorversion=75`;
  const res = await fetch(url, { headers: { "X-API-Key": apiKey, "Accept": "application/json" } });
  const body = await res.text();
  if (!res.ok) throw new Error(`QBQL failed (${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

// ─── Postgres client (SELECT only) ────────────────────────────────
function pgClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loadAccountMap(supa, accountKey) {
  const { data, error } = await supa.from("sc_qbo_account_map").select("*").eq("account_key", accountKey).maybeSingle();
  if (error) throw new Error(`sc_qbo_account_map: ${error.message}`);
  return data;
}
async function loadServiceMap(supa, accountKey) {
  const { data, error } = await supa.from("sc_qbo_service_map").select("*").eq("account_key", accountKey).eq("active", true);
  if (error) throw new Error(`sc_qbo_service_map: ${error.message}`);
  return data;
}
async function loadRevenueRows(supa, accountKey, first, last) {
  const { data, error } = await supa
    .from("sc_daily_revenue")
    .select("service_date, service_id, service_name, account_key, is_flat_fee, is_tax_free, is_non_revenue, actual_count, actual_price_at_date, price_at_date, projected_count, period, week_label, has_actuals, has_projection")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last);
  if (error) throw new Error(`sc_daily_revenue: ${error.message}`);
  return data;
}

// ─── Diff engine ──────────────────────────────────────────────────
function keyOf(line) {
  const sil = line.SalesItemLineDetail;
  return `${sil.ServiceDate}|${sil.ItemRef.value}|${Number(sil.UnitPrice).toFixed(4)}|${Number(sil.Qty)}`;
}
function normaliseInvoice(inv) {
  return (inv.Line || [])
    .filter((l) => l.DetailType === "SalesItemLineDetail")
    .map((l) => ({
      date: l.SalesItemLineDetail.ServiceDate,
      item: l.SalesItemLineDetail.ItemRef.value,
      itemName: l.SalesItemLineDetail.ItemRef.name,
      qty: Number(l.SalesItemLineDetail.Qty),
      rate: Number(l.SalesItemLineDetail.UnitPrice),
      amount: Number(l.Amount),
      description: l.Description || "",
      key: keyOf(l),
    }));
}

function diffLines(builtLines, invoiceLines) {
  const byKey = new Map();
  for (const l of builtLines) byKey.set(l.key, { built: l, invoice: null });
  for (const l of invoiceLines) {
    const cur = byKey.get(l.key) || { built: null, invoice: null };
    cur.invoice = l;
    byKey.set(l.key, cur);
  }
  const only_built = [];
  const only_invoice = [];
  const matched = [];
  const mismatched = [];
  for (const [k, pair] of byKey.entries()) {
    if (pair.built && !pair.invoice) only_built.push(pair.built);
    else if (!pair.built && pair.invoice) only_invoice.push(pair.invoice);
    else if (pair.built && pair.invoice) {
      if (pair.built.amount === pair.invoice.amount && pair.built.description === pair.invoice.description) {
        matched.push(pair);
      } else {
        mismatched.push({ key: k, built: pair.built, invoice: pair.invoice });
      }
    }
  }
  return { only_built, only_invoice, matched, mismatched };
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  console.log(`[diff-week] account=${args.account}  week=${args.week}`);

  const apiKey = process.env.QBO_PROXY_KEY;
  if (!apiKey) throw new Error("QBO_PROXY_KEY required (never echoed)");

  const supa = pgClient();
  let accountMap;
  try {
    accountMap = await loadAccountMap(supa, args.account);
  } catch (err) {
    if (String(err.message).includes("Could not find the table")) {
      console.log(`VERDICT: CONFIG UNMAPPED - sc-31 not yet applied in Studio (sc_qbo_account_map missing)`);
      process.exit(0);
    }
    throw err;
  }
  if (!accountMap) {
    console.log(`VERDICT: CONFIG UNMAPPED - no sc_qbo_account_map row for ${args.account}. sc-31 not yet applied?`);
    process.exit(0);
  }
  let serviceMap;
  try {
    serviceMap = await loadServiceMap(supa, args.account);
  } catch (err) {
    if (String(err.message).includes("Could not find the table")) {
      console.log(`VERDICT: CONFIG UNMAPPED - sc-31 not yet applied in Studio (sc_qbo_service_map missing)`);
      process.exit(0);
    }
    throw err;
  }

  const isBiweekly = accountMap.cadence === "biweekly";
  const spanDays = isBiweekly ? 14 : 7;
  const lastDate = new Date(`${args.week}T12:00:00Z`);
  lastDate.setUTCDate(lastDate.getUTCDate() + spanDays - 1);
  const lastIso = lastDate.toISOString().slice(0, 10);
  console.log(`[diff-week] span ${args.week} .. ${lastIso}  cadence=${accountMap.cadence}`);

  const rows = await loadRevenueRows(supa, args.account, args.week, lastIso);
  console.log(`[diff-week] loaded ${rows.length} sc_daily_revenue rows`);

  // Build (may throw UNMAPPED_SERVICE if a service has no map row).
  let built;
  try {
    built = buildInvoicePayload({
      accountKey: args.account,
      weekStart: args.week,
      rows,
      accountMap,
      serviceMap,
    });
  } catch (err) {
    console.log(`[diff-week] BUILDER THROW: ${err.message}`);
    console.log(`VERDICT: CONFIG UNMAPPED (or invalid input) - ${err.message}`);
    process.exit(0);
  }
  console.log(`[diff-week] builder emitted ${built.invoices.length} invoice(s); warnings=${built.warnings.length}`);

  if (built.invoices.length === 0) {
    console.log(`VERDICT: SC DATA ABSENT - no billable actuals for ${args.account} ${args.week}. Expected per C-11 for pilot accounts until real actuals are seeded.`);
    process.exit(0);
  }

  // Fetch matching QBO invoice(s) for the closing Sunday.
  const closingSunday = built.invoices[0].TxnDate;
  const custId = accountMap.qbo_customer_id;
  const qql = `SELECT * FROM Invoice WHERE CustomerRef = '${custId}' AND TxnDate = '${closingSunday}' MAXRESULTS 20`;
  const invRes = await qGet(qql, apiKey);
  const qboInvs = invRes?.QueryResponse?.Invoice || [];
  console.log(`[diff-week] QBO invoices for CustomerRef ${custId} on ${closingSunday}: ${qboInvs.length}`);

  if (qboInvs.length === 0) {
    console.log(`VERDICT: QBO INVOICE ABSENT - no invoice found for ${accountMap.qbo_customer_name} TxnDate ${closingSunday}`);
    process.exit(0);
  }

  // For CIN - AZ: pair main vs rehab slots by amount pattern. Simpler
  // heuristic here: dump all pairs to console with best-effort pairing.
  console.log("\n=== DIFF ===\n");
  let anyDiff = false;
  for (const bInv of built.invoices) {
    const builtLines = normaliseInvoice({ Line: bInv.Line });
    // Match to a QBO invoice: pick the invoice with the closest line count.
    let bestMatch = null;
    let bestDist = Infinity;
    for (const qbo of qboInvs) {
      const qboCount = (qbo.Line || []).filter((l) => l.DetailType === "SalesItemLineDetail").length;
      const dist = Math.abs(qboCount - bInv.Line.length);
      if (dist < bestDist) { bestDist = dist; bestMatch = qbo; }
    }
    if (!bestMatch) {
      console.log(`Builder slot ${bInv._slot}: no QBO match candidate`);
      anyDiff = true;
      continue;
    }
    const qboLines = normaliseInvoice(bestMatch);
    const diff = diffLines(builtLines, qboLines);
    console.log(`Slot ${bInv._slot}  |  BUILT ${builtLines.length} lines  vs  QBO ${bestMatch.DocNumber} (${qboLines.length} lines)`);
    console.log(`  matched:    ${diff.matched.length}`);
    console.log(`  only_built: ${diff.only_built.length}`);
    console.log(`  only_qbo:   ${diff.only_invoice.length}`);
    console.log(`  mismatched: ${diff.mismatched.length}`);
    if (diff.only_built.length + diff.only_invoice.length + diff.mismatched.length === 0) {
      console.log(`  -> MATCH`);
    } else {
      anyDiff = true;
      for (const l of diff.only_built.slice(0, 6)) console.log(`    only_built: ${l.date} ${l.itemName.padEnd(35)} qty=${l.qty} rate=${l.rate} amt=${l.amount}`);
      for (const l of diff.only_invoice.slice(0, 6)) console.log(`    only_qbo:   ${l.date} ${l.itemName.padEnd(35)} qty=${l.qty} rate=${l.rate} amt=${l.amount}`);
      for (const m of diff.mismatched.slice(0, 6)) console.log(`    mismatch:   ${m.built.date} ${m.built.itemName}  built.amt=${m.built.amount} qbo.amt=${m.invoice.amount}  desc_built=${JSON.stringify(m.built.description)}  desc_qbo=${JSON.stringify(m.invoice.description)}`);
    }
  }

  if (anyDiff) {
    console.log(`\nVERDICT: DIFF - see named lines above`);
  } else {
    console.log(`\nVERDICT: MATCH - builder reproduced the QBO invoice(s) at the line level`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
