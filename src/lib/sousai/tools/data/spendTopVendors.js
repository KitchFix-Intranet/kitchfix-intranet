// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/spendTopVendors.js
// SousAI data tool C3: portfolio-wide vendor ranking.
//
// "Which vendors did we spend the most with this year?"
//
// The Phase F PR 2 gap the sweep flagged: spend_summary requires at least one
// filter (vendor, category, or accountKey), so "top vendors" - which by
// definition has no vendor filter - was unanswerable. The model routed
// correctly given the tool surface; the surface had the hole.
//
// This tool is the ranking answer: no filter required beyond a window. Reads
// ai_line_items paginated (Convention 1), joined via v_invoice_submissions_
// current for corrections resolution. Returns top-N vendors by aggregated
// dollar_total, with line_count and share_pct.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import { paginateAll } from "./_constants.js";

const VALID_WINDOWS = ["month", "year", "ytd", "date_range"];
const DEFAULT_TOP_N = 10;
const MAX_TOP_N = 25;

/**
 * @param {object} args
 * @param {"month"|"year"|"ytd"|"date_range"} [args.window="ytd"]
 * @param {string} [args.category] - optional line-item category filter
 * @param {string} [args.accountKey] - optional account filter
 * @param {number} [args.topN=10]
 * @param {string} [args.dateFrom] - required when window=date_range
 * @param {string} [args.dateTo] - required when window=date_range
 * @param {string} [args.asOf] - YYYY-MM-DD; defaults to today
 * @param {boolean} [args.excludeHistorical=false]
 * @returns {Promise<object>}
 */
export async function spendTopVendors({
  window = "ytd",
  category,
  accountKey,
  topN = DEFAULT_TOP_N,
  dateFrom,
  dateTo,
  asOf,
  excludeHistorical = false,
} = {}) {
  if (!VALID_WINDOWS.includes(window)) {
    return errorPayload(`window must be one of ${VALID_WINDOWS.join(", ")}`);
  }
  if (window === "date_range" && (!dateFrom || !dateTo)) {
    return errorPayload("dateFrom and dateTo required when window=date_range");
  }
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  const n = Math.min(Math.max(1, Number(topN) || DEFAULT_TOP_N), MAX_TOP_N);
  const bounds = resolveWindow(window, asOfDate, dateFrom, dateTo);
  if (bounds.error) return errorPayload(bounds.error);

  const sb = getSupabase();

  // Corrections-resolution: gather current invoice ids in the window.
  const currentInvoiceIds = new Set();
  {
    const invRows = await paginateAll((from, to) => {
      let q = sb.from("v_invoice_submissions_current").select("id");
      if (accountKey) q = q.eq("account_key", accountKey);
      q = q.gte("invoice_date", bounds.start).lte("invoice_date", bounds.end);
      return q.order("id", { ascending: true }).range(from, to);
    });
    for (const r of invRows) currentInvoiceIds.add(r.id);
  }

  // Fetch every line item in the window (paginated - portfolio YTD is ~15k).
  const lineItems = await paginateAll((from, to) => {
    let q = sb.from("ai_line_items")
      .select("id, invoice_uuid, extended_price, vendor_name, is_historical, account_key");
    if (accountKey) q = q.eq("account_key", accountKey);
    if (category) q = q.ilike("category", `%${category.trim()}%`);
    q = q.gte("invoice_date", bounds.start).lte("invoice_date", bounds.end);
    return q.order("id", { ascending: true }).range(from, to);
  });

  const kept = lineItems.filter((li) => {
    if (li.is_historical) return !excludeHistorical;
    return li.invoice_uuid && currentInvoiceIds.has(li.invoice_uuid);
  });

  // Aggregate by vendor_name. Empty vendor_name aggregates as "(unknown)" so
  // the model can see the miss without crashing.
  const perVendor = new Map();
  let grandTotal = 0;
  for (const li of kept) {
    const key = li.vendor_name || "(unknown)";
    const price = Number(li.extended_price) || 0;
    grandTotal += price;
    const prev = perVendor.get(key) || { vendor_name: key, dollar_total: 0, line_count: 0 };
    prev.dollar_total += price;
    prev.line_count += 1;
    perVendor.set(key, prev);
  }
  const ranked = [...perVendor.values()]
    .map((r) => ({
      ...r,
      dollar_total: Math.round(r.dollar_total * 100) / 100,
      share_pct: grandTotal > 0 ? Math.round((r.dollar_total / grandTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.dollar_total - a.dollar_total);

  const total_vendors = ranked.length;
  const top = ranked.slice(0, n);
  const truncated = total_vendors > n;

  return {
    source: "ai_line_items + v_invoice_submissions_current",
    scope: excludeHistorical
      ? "app-scanned invoice line items (excluding batch_rebuild historical rows)"
      : "invoice line items including batch_rebuild historical",
    loaded: `PG live as of ${new Date().toISOString()}`,
    parameters: {
      window,
      dateFrom: bounds.start,
      dateTo: bounds.end,
      accountKey: accountKey || null,
      category: category || null,
      topN: n,
      excludeHistorical,
    },
    totals: {
      dollar_total: Math.round(grandTotal * 100) / 100,
      line_count: kept.length,
      total_vendors,
    },
    top_vendors: top,
    truncated,
    note_truncation: truncated ? `showing top ${n} of ${total_vendors} vendors - raise topN (max ${MAX_TOP_N}) to widen` : null,
  };
}

function resolveWindow(window, asOf, dateFrom, dateTo) {
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
