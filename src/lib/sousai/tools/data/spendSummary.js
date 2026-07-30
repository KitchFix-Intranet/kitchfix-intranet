// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/spendSummary.js
// SousAI data tool C1: spend by category or vendor.
//
// "How much have we spent on Sysco this year?"
// "How much did STL-FL spend on food this month?"
//
// Reads ai_line_items joined to v_invoice_submissions_current so corrections
// don't double-count. Historical rows (is_historical=TRUE, invoice_uuid=NULL,
// historical_invoice_ref populated) are INCLUDED by default because year-over-
// year totals matter, but the caller can exclude via `excludeHistorical`.
//
// OCR confidence: ai_line_items.confidence varies. A total built from lines
// with mostly low confidence carries a caveat in the tool output.
//
// Vendor alias resolution: vendor names are spelled differently across
// invoices ("Sysco", "SYSCO", "Sysco Foods"). The tool resolves the query
// through vendor_aliases + vendors.name (both filtered on deleted_at IS NULL)
// to get the canonical vendor.id first, then aggregates by vendor_id where
// available.
//
// Aggregate by default - Convention 1. This is C1; C2 is the rows variant.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";

const VALID_WINDOWS = ["month", "year", "ytd", "period", "date_range"];

/**
 * @param {object} args
 * @param {string} [args.accountKey] - optional; omit for portfolio total
 * @param {string} [args.vendorName] - vendor name substring (resolved via aliases)
 * @param {string} [args.category] - line-item category
 * @param {string} [args.window="month"] - month/year/ytd/period/date_range
 * @param {string} [args.dateFrom] - required when window=date_range
 * @param {string} [args.dateTo] - required when window=date_range
 * @param {string} [args.asOf] - YYYY-MM-DD; defaults to today
 * @param {boolean} [args.excludeHistorical=false]
 * @returns {Promise<object>}
 */
export async function spendSummary({
  accountKey,
  vendorName,
  category,
  window = "month",
  dateFrom,
  dateTo,
  asOf,
  excludeHistorical = false,
} = {}) {
  if (!vendorName && !category && !accountKey) {
    return errorPayload("must provide at least one filter: vendorName, category, or accountKey");
  }
  if (!VALID_WINDOWS.includes(window)) {
    return errorPayload(`window must be one of ${VALID_WINDOWS.join(", ")}`);
  }
  if (window === "date_range" && (!dateFrom || !dateTo)) {
    return errorPayload("dateFrom and dateTo required when window=date_range");
  }
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);

  const sb = getSupabase();

  // Resolve window bounds
  const bounds = resolveDateWindow(window, asOfDate, dateFrom, dateTo);
  if (bounds.error) return errorPayload(bounds.error);

  // Resolve vendor if supplied
  let vendorMatch = null;
  if (vendorName) {
    const trimmed = vendorName.trim();
    // Try canonical name
    const { data: exact } = await sb.from("vendors")
      .select("id, name")
      .is("deleted_at", null)
      .ilike("name", `%${trimmed}%`);
    // Try aliases
    const { data: aliases } = await sb.from("vendor_aliases")
      .select("vendor_id, alias")
      .ilike("alias", `%${trimmed}%`);
    const vendorIds = new Set();
    for (const v of exact ?? []) vendorIds.add(v.id);
    for (const a of aliases ?? []) vendorIds.add(a.vendor_id);
    if (vendorIds.size === 0) {
      return {
        source: "ai_line_items + v_invoice_submissions_current + vendors",
        scope: "current + historical invoice line items",
        loaded: `PG live as of ${new Date().toISOString()}`,
        parameters: { accountKey, vendorName: trimmed, category, window, dateFrom: bounds.start, dateTo: bounds.end, excludeHistorical },
        totals: { line_count: 0, dollar_total: 0 },
        note: `no vendor found matching '${trimmed}' (searched vendors.name and vendor_aliases.alias). Vendor spelling varies across invoices; if the answer should exist, check with the invoice module admin.`,
      };
    }
    vendorMatch = { vendor_ids: [...vendorIds] };
  }

  // Build the ai_line_items query. Join through v_invoice_submissions_current
  // by fetching current invoice ids first (so corrections resolved), then
  // filter line items by invoice_uuid IN that set OR is_historical=TRUE.
  let currentInvoiceIds = new Set();
  {
    let invQ = sb.from("v_invoice_submissions_current").select("id");
    if (accountKey) invQ = invQ.eq("account_key", accountKey);
    // Filter invoices by date range too (uses invoice_date as the temporal key)
    invQ = invQ.gte("invoice_date", bounds.start).lte("invoice_date", bounds.end);
    const { data: invRows, error: invErr } = await invQ;
    if (invErr) throw new Error(`spendSummary: invoice query failed: ${invErr.code || "?"} ${invErr.message}`);
    for (const r of invRows ?? []) currentInvoiceIds.add(r.id);
  }

  // Now line items
  let liQ = sb.from("ai_line_items")
    .select("id, invoice_uuid, invoice_date, extended_price, category, vendor_name, description, confidence, is_historical, historical_invoice_ref, account_key");
  if (accountKey) liQ = liQ.eq("account_key", accountKey);
  if (category) liQ = liQ.ilike("category", `%${category.trim()}%`);
  if (vendorMatch) {
    // Vendor filter via vendor_name on line item (since ai_line_items has no vendor_id)
    // Get canonical names for the resolved ids
    const { data: vendorNames } = await sb.from("vendors").select("id, name").in("id", vendorMatch.vendor_ids);
    const nameList = (vendorNames ?? []).map((v) => v.name);
    const { data: aliases2 } = await sb.from("vendor_aliases").select("vendor_id, alias").in("vendor_id", vendorMatch.vendor_ids);
    const aliasList = (aliases2 ?? []).map((a) => a.alias);
    const all = [...new Set([...nameList, ...aliasList])];
    if (all.length === 0) {
      return errorPayload(`vendor resolution collapsed to empty set for '${vendorName}'`);
    }
    liQ = liQ.in("vendor_name", all);
  }
  liQ = liQ.gte("invoice_date", bounds.start).lte("invoice_date", bounds.end);

  const { data: lineItems, error: liErr } = await liQ;
  if (liErr) throw new Error(`spendSummary: line items query failed: ${liErr.code || "?"} ${liErr.message}`);

  // Now filter: keep items whose invoice_uuid is in current set (corrections-
  // resolved) OR is_historical=TRUE (unless excluded).
  const kept = (lineItems ?? []).filter((li) => {
    if (li.is_historical) return !excludeHistorical;
    return li.invoice_uuid && currentInvoiceIds.has(li.invoice_uuid);
  });

  // Aggregate
  const totalDollars = kept.reduce((s, li) => s + (Number(li.extended_price) || 0), 0);
  const byCategory = {};
  const byVendor = {};
  const confidenceDist = { OK: 0, Review: 0, other: 0, null: 0 };
  let historicalLines = 0;
  for (const li of kept) {
    const cat = li.category || "(uncategorized)";
    byCategory[cat] = (byCategory[cat] || 0) + (Number(li.extended_price) || 0);
    const v = li.vendor_name || "(unknown)";
    byVendor[v] = (byVendor[v] || 0) + (Number(li.extended_price) || 0);
    if (li.confidence === "OK") confidenceDist.OK++;
    else if (li.confidence === "Review") confidenceDist.Review++;
    else if (li.confidence == null) confidenceDist.null++;
    else confidenceDist.other++;
    if (li.is_historical) historicalLines++;
  }

  const result = {
    source: "ai_line_items + v_invoice_submissions_current" + (vendorName ? " + vendors/vendor_aliases" : ""),
    scope: excludeHistorical
      ? "app-scanned invoice line items (excluding batch_rebuild historical rows)"
      : "invoice line items including batch_rebuild historical",
    loaded: `PG live as of ${new Date().toISOString()}`,
    parameters: { accountKey: accountKey || null, vendorName: vendorName || null, category: category || null, window, dateFrom: bounds.start, dateTo: bounds.end, excludeHistorical },
    totals: {
      line_count: kept.length,
      dollar_total: Math.round(totalDollars * 100) / 100,
      historical_lines: historicalLines,
    },
    by_category: byCategory,
    by_vendor: byVendor,
    confidence_distribution: confidenceDist,
  };
  if (confidenceDist.Review > 0 || confidenceDist.other > 0) {
    result.confidence_caveat = `${confidenceDist.Review} of ${kept.length} lines are flagged 'Review' by the OCR pass. Their extended_price may need human confirmation before this total is quoted downstream.`;
  }
  if (historicalLines > 0 && !excludeHistorical) {
    result.historical_caveat = `${historicalLines} of ${kept.length} lines come from the batch_rebuild historical import (pre-app scans). If you need a live-only total, re-run with excludeHistorical=true.`;
  }
  return result;
}

function resolveDateWindow(window, asOf, dateFrom, dateTo) {
  if (window === "date_range") return { start: dateFrom, end: dateTo };
  const d = new Date(asOf + "T00:00:00Z");
  const year = d.getUTCFullYear();
  if (window === "month") {
    const start = new Date(Date.UTC(year, d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { start, end };
  }
  if (window === "year" || window === "ytd") {
    const start = `${year}-01-01`;
    const end = window === "ytd" ? asOf : `${year}-12-31`;
    return { start, end };
  }
  if (window === "period") {
    // Period boundaries live in sc_day_metadata; C1 doesn't have an accountKey
    // context reliably enough to resolve the period. Callers who want
    // per-period spend should pass explicit date_range. Return an error so the
    // model doesn't silently interpret this as year.
    return { error: "window='period' is not yet supported for spend queries - the fiscal-period boundary depends on the account and Sous doesn't have a period-boundary lookup wired for spend. Pass window='date_range' with dateFrom/dateTo instead." };
  }
  return { error: `unsupported window '${window}'` };
}

function errorPayload(msg) {
  return {
    source: "ai_line_items",
    scope: "invoice line items",
    loaded: `PG live as of ${new Date().toISOString()}`,
    error: msg,
  };
}
