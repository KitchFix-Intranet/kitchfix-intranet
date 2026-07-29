// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/spendVendorHistory.js
// SousAI data tool C2: vendor purchase line-item history.
//
// "What did we buy from Sysco between these dates?"
//
// Reads ai_line_items filtered by resolved vendor + date range. Returns rows,
// capped at C2_ROW_CAP with honest truncation. Alias resolution as in C1.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import { C2_ROW_CAP } from "./_constants.js";

/**
 * @param {object} args
 * @param {string} args.vendorName - required
 * @param {string} args.dateFrom - YYYY-MM-DD required
 * @param {string} args.dateTo - YYYY-MM-DD required
 * @param {string} [args.accountKey]
 * @param {boolean} [args.excludeHistorical=false]
 * @returns {Promise<object>}
 */
export async function spendVendorHistory({ vendorName, dateFrom, dateTo, accountKey, excludeHistorical = false } = {}) {
  if (!vendorName) return errorPayload("vendorName is required");
  if (!dateFrom || !dateTo) return errorPayload("dateFrom and dateTo are required (YYYY-MM-DD)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return errorPayload("dates must be YYYY-MM-DD");
  }

  const sb = getSupabase();
  const trimmed = vendorName.trim();

  // Vendor resolution (same as C1)
  const { data: exact } = await sb.from("vendors")
    .select("id, name")
    .is("deleted_at", null)
    .ilike("name", `%${trimmed}%`);
  const { data: aliases } = await sb.from("vendor_aliases")
    .select("vendor_id, alias")
    .ilike("alias", `%${trimmed}%`);
  const vendorIds = new Set();
  for (const v of exact ?? []) vendorIds.add(v.id);
  for (const a of aliases ?? []) vendorIds.add(a.vendor_id);
  if (vendorIds.size === 0) {
    return {
      source: "ai_line_items + vendors/vendor_aliases",
      scope: "invoice line items",
      loaded: `PG live as of ${new Date().toISOString()}`,
      parameters: { vendorName: trimmed, dateFrom, dateTo, accountKey: accountKey || null, excludeHistorical },
      rows: [],
      row_count: 0,
      truncated: false,
      note: `no vendor found matching '${trimmed}'.`,
    };
  }
  const { data: vendorNames } = await sb.from("vendors").select("id, name").in("id", [...vendorIds]);
  const { data: aliases2 } = await sb.from("vendor_aliases").select("vendor_id, alias").in("vendor_id", [...vendorIds]);
  const allNames = [...new Set([...(vendorNames ?? []).map((v) => v.name), ...(aliases2 ?? []).map((a) => a.alias)])];

  // Fetch invoice ids in the current set for the date range + account (for
  // corrections resolution)
  let invQ = sb.from("v_invoice_submissions_current").select("id");
  if (accountKey) invQ = invQ.eq("account_key", accountKey);
  invQ = invQ.gte("invoice_date", dateFrom).lte("invoice_date", dateTo);
  const { data: invRows } = await invQ;
  const currentInvoiceIds = new Set((invRows ?? []).map((r) => r.id));

  let liQ = sb.from("ai_line_items")
    .select("id, invoice_uuid, invoice_date, description, quantity, unit, unit_price, extended_price, category, vendor_name, confidence, is_historical, historical_invoice_ref, account_key")
    .in("vendor_name", allNames)
    .gte("invoice_date", dateFrom)
    .lte("invoice_date", dateTo)
    .order("invoice_date", { ascending: false });
  if (accountKey) liQ = liQ.eq("account_key", accountKey);

  const { data: lineItems, error } = await liQ;
  if (error) throw new Error(`spendVendorHistory: query failed: ${error.code || "?"} ${error.message}`);

  const kept = (lineItems ?? []).filter((li) => {
    if (li.is_historical) return !excludeHistorical;
    return li.invoice_uuid && currentInvoiceIds.has(li.invoice_uuid);
  });

  const total = kept.length;
  const truncated = total > C2_ROW_CAP;
  const capped = truncated ? kept.slice(0, C2_ROW_CAP) : kept;

  const rows = capped.map((li) => ({
    invoice_date: li.invoice_date,
    account_key: li.account_key,
    description: li.description,
    quantity: li.quantity == null ? null : Number(li.quantity),
    unit: li.unit ?? null,
    unit_price: li.unit_price == null ? null : Number(li.unit_price),
    extended_price: li.extended_price == null ? null : Number(li.extended_price),
    category: li.category ?? null,
    vendor_name: li.vendor_name,
    confidence: li.confidence ?? null,
    is_historical: !!li.is_historical,
  }));

  const totalDollars = kept.reduce((s, li) => s + (Number(li.extended_price) || 0), 0);

  const result = {
    source: "ai_line_items + v_invoice_submissions_current + vendors/vendor_aliases",
    scope: excludeHistorical ? "app-scanned invoice line items only" : "invoice line items including batch_rebuild historical",
    loaded: `PG live as of ${new Date().toISOString()}`,
    parameters: { vendorName: trimmed, dateFrom, dateTo, accountKey: accountKey || null, excludeHistorical },
    matched_vendor_names: allNames,
    total_lines: total,
    total_dollars: Math.round(totalDollars * 100) / 100,
    truncated,
    row_count: rows.length,
    rows,
  };
  if (truncated) {
    result.note_truncation = `showing ${C2_ROW_CAP} of ${total} lines - narrow the date range or add accountKey`;
  }
  return result;
}

function errorPayload(msg) {
  return {
    source: "ai_line_items",
    scope: "invoice line items",
    loaded: `PG live as of ${new Date().toISOString()}`,
    error: msg,
  };
}
