// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/scServicePrice.js
// SousAI data tool B4: service price lookup (as-of).
//
// "What are we charging TBJ-FL for breakfast right now?"
//
// The F8 trap: sc_service_prices has no account_key. Join via sc_services.
// This tool encapsulates the join so the model never sees it.
//
// Filter sc_services.deleted_at IS NULL.
//
// No price found IS A DECLINE, never a zero. Missing-price rule (Convention
// 6) applies here specifically: the tool cannot return "the price is $0" for
// a service with no configured price.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";

/**
 * @param {object} args
 * @param {string} args.accountKey - e.g. "TBJ - FL"
 * @param {string} args.serviceNameOrId - substring match on service_name, OR exact service.id
 * @param {string} [args.asOf] - YYYY-MM-DD; defaults to today
 * @param {boolean} [args.includeHistory=false] - also return prior price rows
 * @returns {Promise<object>}
 */
export async function scServicePrice({ accountKey, serviceNameOrId, asOf, includeHistory = false } = {}) {
  if (!accountKey || typeof accountKey !== "string") {
    return errorPayload("accountKey is required (e.g. 'TBJ - FL')");
  }
  if (!serviceNameOrId || typeof serviceNameOrId !== "string") {
    return errorPayload("serviceNameOrId is required (service name substring or exact service_id)");
  }
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return errorPayload(`asOf must be YYYY-MM-DD, got '${asOfDate}'`);
  }

  const sb = getSupabase();
  const query = serviceNameOrId.trim();

  // Find matching services for the account. Encapsulates the F8 trap.
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
  let servicesQ = sb.from("sc_services")
    .select("id, service_name, group_id, is_flat_fee, is_non_revenue, deleted_at, sc_service_groups(group_name)")
    .eq("account_key", accountKey)
    .is("deleted_at", null);
  if (looksLikeUuid) {
    servicesQ = servicesQ.eq("id", query);
  } else {
    servicesQ = servicesQ.ilike("service_name", `%${query}%`);
  }
  const { data: services, error: svcErr } = await servicesQ;
  if (svcErr) throw new Error(`scServicePrice: services query failed: ${svcErr.code || "?"} ${svcErr.message}`);

  if (!services || services.length === 0) {
    return {
      source: "sc_services + sc_service_prices",
      scope: "current-season Service Calendar prices",
      loaded: `PG live as of ${new Date().toISOString()}`,
      parameters: { accountKey, serviceNameOrId: query, asOf: asOfDate, includeHistory },
      matches: [],
      note: `no service on file at ${accountKey} matching '${query}'. This is a service-catalog gap, not a claim the service does not exist elsewhere. Try list_accounts to confirm the accountKey and search_documents for the account's contract if unsure what services are in scope.`,
    };
  }

  // For each matching service, find the as-of price (latest effective_date
  // that is <= asOf). If none found, that specific service is flagged as
  // unpriced.
  const matches = [];
  for (const svc of services) {
    const { data: priceRows } = await sb.from("sc_service_prices")
      .select("price, effective_date, created_at")
      .eq("service_id", svc.id)
      .lte("effective_date", asOfDate)
      .order("effective_date", { ascending: false });
    const rows = priceRows || [];
    const current = rows[0] || null;
    const match = {
      service_id: svc.id,
      service_name: svc.service_name,
      group: svc.sc_service_groups?.group_name || null,
      is_flat_fee: !!svc.is_flat_fee,
      is_non_revenue: !!svc.is_non_revenue,
      price_available: !!current,
      current_price: current ? Number(current.price) : null,
      effective_date: current ? current.effective_date : null,
      as_of: asOfDate,
      price_decline_reason: current ? null : `no price configured for '${svc.service_name}' at ${accountKey} on or before ${asOfDate}`,
    };
    if (includeHistory) {
      match.history = rows.map((r) => ({ price: Number(r.price), effective_date: r.effective_date }));
    }
    matches.push(match);
  }

  const unpriced = matches.filter((m) => !m.price_available);
  const priced = matches.filter((m) => m.price_available);

  const result = {
    source: "sc_services + sc_service_prices",
    scope: "current-season Service Calendar prices",
    loaded: `PG live as of ${new Date().toISOString()}`,
    parameters: { accountKey, serviceNameOrId: query, asOf: asOfDate, includeHistory },
    matches,
    total: matches.length,
    priced_count: priced.length,
    unpriced_count: unpriced.length,
  };
  if (unpriced.length > 0) {
    result.note = `${unpriced.length} matching service(s) have no configured price as of ${asOfDate}. These are declines, not $0 prices - see matches[].price_decline_reason.`;
  }
  return result;
}

function errorPayload(msg) {
  return {
    source: "sc_services + sc_service_prices",
    scope: "current-season Service Calendar prices",
    loaded: `PG live as of ${new Date().toISOString()}`,
    error: msg,
  };
}
