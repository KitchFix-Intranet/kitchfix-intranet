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
import { pgLiveNow } from "../_freshness.js";
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
  // vendor_id is populated by pr-8-1's backfill (exact match on vendors.name +
  // vendor_aliases fallback). Aggregating by vendor_id folds the alias table
  // in for free - "Cozzini Bros" / "Cozzini Brothers" / "Freshpoint" /
  // "Samuels Seafoos" all point at their canonical vendor_id. This is what
  // makes total_vendors_canonical honest.
  const lineItems = await paginateAll((from, to) => {
    let q = sb.from("ai_line_items")
      .select("id, invoice_uuid, extended_price, vendor_name, vendor_id, is_historical, account_key");
    if (accountKey) q = q.eq("account_key", accountKey);
    if (category) q = q.ilike("category", `%${category.trim()}%`);
    q = q.gte("invoice_date", bounds.start).lte("invoice_date", bounds.end);
    return q.order("id", { ascending: true }).range(from, to);
  });

  const kept = lineItems.filter((li) => {
    if (li.is_historical) return !excludeHistorical;
    return li.invoice_uuid && currentInvoiceIds.has(li.invoice_uuid);
  });

  // Load canonical vendor names for every distinct vendor_id we're about to
  // aggregate on. pr-8-1's SET NOT NULL means vendor_id shouldn't be null in
  // any surviving row; the defensive `if (!id)` below guards the edge case
  // where a hand-written or legacy row slipped past.
  const distinctVendorIds = [...new Set(kept.map((li) => li.vendor_id).filter(Boolean))];
  let nameById = new Map();
  if (distinctVendorIds.length > 0) {
    const { data: vendorRows } = await sb
      .from("vendors")
      .select("id, name")
      .in("id", distinctVendorIds);
    nameById = new Map((vendorRows || []).map((v) => [v.id, v.name]));
  }

  // Aggregate by vendor_id (canonical). Rows without vendor_id (should not
  // exist post pr-8-1) bucket into "(unresolved)" so the model can see the
  // miss rather than silently dropping revenue.
  const perVendor = new Map();
  let grandTotal = 0;
  for (const li of kept) {
    const price = Number(li.extended_price) || 0;
    grandTotal += price;
    const id = li.vendor_id || "(unresolved)";
    const canonicalName = li.vendor_id
      ? (nameById.get(li.vendor_id) || li.vendor_id)
      : "(unresolved)";
    const prev = perVendor.get(id) || {
      vendor_id: id,
      vendor_name: canonicalName,
      dollar_total: 0,
      line_count: 0,
    };
    prev.dollar_total += price;
    prev.line_count += 1;
    perVendor.set(id, prev);
  }
  const ranked = [...perVendor.values()]
    .map((r) => ({
      ...r,
      dollar_total: Math.round(r.dollar_total * 100) / 100,
      share_pct: grandTotal > 0 ? Math.round((r.dollar_total / grandTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.dollar_total - a.dollar_total);

  const total_vendors_canonical = ranked.length;
  const top = ranked.slice(0, n);
  const truncated = total_vendors_canonical > n;

  return {
    source: "ai_line_items + v_invoice_submissions_current + vendors",
    scope: excludeHistorical
      ? "app-scanned invoice line items (excluding batch_rebuild historical rows), aggregated by canonical vendor_id"
      : "invoice line items including batch_rebuild historical, aggregated by canonical vendor_id",
    loaded: pgLiveNow(),
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
      total_vendors_canonical,
    },
    top_vendors: top,
    truncated,
    note_truncation: truncated ? `showing top ${n} of ${total_vendors_canonical} vendors - raise topN (max ${MAX_TOP_N}) to widen` : null,
  };
}

// Shared canonical-vendor count helper. The /sous first-run Spend chip and
// the spend_top_vendors tool must return the same number - both surfaces
// call THIS function so a schema change flows to both at once. Cheap when
// spendTopVendors is the only path; the paginated line-item scan is the
// same shape either way.
export async function countYtdCanonicalVendors({ asOf } = {}) {
  const result = await spendTopVendors({ window: "ytd", topN: 1, asOf });
  return result?.totals?.total_vendors_canonical ?? null;
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
    loaded: pgLiveNow(),
    error: msg,
  };
}
