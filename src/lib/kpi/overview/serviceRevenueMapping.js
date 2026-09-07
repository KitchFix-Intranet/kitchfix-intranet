// src/lib/kpi/overview/serviceRevenueMapping.js
//
// Kevin ruling 2026-09-09 (PR-3 · item 2). Service Calendar services
// map to revenue lines by NAME. This is the mapping the Overview's
// per-line revenue read applies when splitting confirmed SC revenue
// across statement rows (2200 Catering / 2400.1 Meal service home).
//
// The ruling: B&G goes to catering; everything else is meal service
// revenue we bill the client for.
//
// Location trade-off Kevin named: "a lookup keyed on service name,
// or a column on the service record if the schema allows it." This
// file is the lookup. Long-term end state is a `revenue_line_code`
// column on `sc_services` plus an admin UI to reassign - a schema
// migration + a form - deferred until the set grows past the point
// a code-edit-per-service is workable. For now: greppable, one file
// to edit when a new account onboards.
//
// Do NOT hard-code service names in the resolver. Every read goes
// through classifyServiceRevenueLine below.

// Catering service names. Everything not in this set defaults to
// 2400.1 (Meal service · home). Case-preserving match; if a new
// account onboards with a differently-cased name, add the exact
// string here.
const CATERING_SERVICE_NAMES = new Set([
  "B&G Lunch",
]);

/**
 * Classify a Service Calendar service name to a revenue line code.
 *
 * @param {string|null|undefined} serviceName - the sc_services.service_name
 * @returns {"2200" | "2400.1"} - the revenue line the service's dollars belong to
 *
 * Defaults to 2400.1 for any unknown name. A default of "unknown /
 * error" would break the confirmed-sum invariant on any new account
 * whose service list isn't in the catering set - meal service is the
 * common case, so falling to it keeps the KPI board's revenue count
 * agreeing with the SC total without a code change for every seeding.
 */
export function classifyServiceRevenueLine(serviceName) {
  if (serviceName && CATERING_SERVICE_NAMES.has(serviceName)) return "2200";
  return "2400.1";
}

// Exposed for probes + reports so the assertion isn't itself a copy
// of the constant.
export function isCateringService(serviceName) {
  return !!(serviceName && CATERING_SERVICE_NAMES.has(serviceName));
}
