import { getServiceClient } from "@/lib/supabase";
import { isDualWrite } from "@/lib/cutover";

// ═══════════════════════════════════════════════════════════════
// SERVICE CALENDAR MODULE - PG-native orchestrator
// ═══════════════════════════════════════════════════════════════
//
// Built Supabase-native, not migrated from Sheets. The sc-1 + sc-1b
// migrations seeded PG from the 11 Service Calendar spreadsheets
// (see docs/SC_SPREADSHEET_MAPPING.md, docs/SC_PRICE_COMPARISON.md,
// scripts/_seed_sc_from_xlsx.mjs). PG is the canonical source from
// the start; this orchestrator reads and writes PG exclusively.
//
// CUTOVER FLAG POSTURE
//   Standard dataStore modules (directory, vendor, invoice) write
//   Sheets unconditionally + PG conditionally on isDualWrite. SC
//   inverts that: writes go to PG unconditionally. The isDualWrite
//   gate is reserved for an OPTIONAL Sheets MIRROR during shadow
//   validation - when the legacy Sheets-based UI is still consulted
//   for cross-check during the cutover window. That mirror is not
//   implemented yet; the gate is in place so the work can land
//   incrementally without re-shaping the public API.
//
//   isReadFromPostgres is NOT consulted by this module. Reads always
//   come from PG because there is no Sheets-as-source state to fall
//   back to - SC was born in PG.
//
// PG TABLES OWNED (used by the dual-write flag list when the time
// comes; today these names are documentation):
//   sc_service_groups, sc_services, sc_service_prices,
//   sc_daily_projections, sc_daily_actuals, sc_day_metadata
//
// PUBLIC API (consumed by src/app/api/service-calendar/route.js
// after the route rewire PR):
//   loadAccountConfig(accountKey)
//     -> { groups, services } shaped for the calendar UI
//   loadMonthData(accountKey, year, month)
//     -> { days, totals } with projections + actuals + revenue per day
//   loadYearSummary(accountKey, year)
//     -> { months } shaped for the year heatmap
//   saveActuals(accountKey, serviceDate, entries, email)
//     -> upserts ONLY the touched entries
//   saveBulkActuals(accountKey, entries, email)
//     -> upserts a flat list of (serviceDate, serviceId, count) tuples
//   updateServiceConfig(accountKey, changes, email)
//     -> price changes append to the ledger; deactivate flips active=false
//   addService(accountKey, groupName, serviceName, price, flags, email)
//     -> creates group on-demand if missing, then service + price
//   submitConfigRequest(accountKey, request, email)
//     -> logs the request via the submissions table (module='service_calendar')
//
// P0-1 FIX (untouched-fields-zeroing) - the data-layer half
//   saveActuals only writes the entries the caller passes. If the UI
//   sent Breakfast=75 without touching Lunch, only Breakfast hits the
//   upsert. Lunch's existing row (or absence) is preserved. The UI
//   half (don't include untouched services in the entries array) is
//   tracked separately in the calendar component PR.

const SC_TABLES = {
  groups:      "sc_service_groups",
  services:    "sc_services",
  prices:      "sc_service_prices",
  projections: "sc_daily_projections",
  actuals:     "sc_daily_actuals",
  metadata:    "sc_day_metadata",
};

// Days older than LOCK_DAYS render as locked in the UI. The orchestrator
// does NOT enforce this at the data layer - the legacy route note
// "managers can edit any past day" applies here too. The flag is
// computed and returned with each day so the UI can apply consistent
// styling without recomputing.
const LOCK_DAYS = 7;

// Service Calendar months are always full calendar months in account
// timezone. The orchestrator assumes ISO YYYY-MM-DD throughout.
const IMPORT_BY = "import-script";

// ── Helpers ──

function isoDay(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthBounds(year, month) {
  const m = String(month).padStart(2, "0");
  const first = `${year}-${m}-01`;
  // Last day of month: trick with new Date(year, month, 0)
  const lastDate = new Date(year, month, 0);
  const last = isoDay(lastDate);
  return { first, last };
}

function yearBounds(year) {
  return { first: `${year}-01-01`, last: `${year}-12-31` };
}

// Returns the day's relationship to "today" + lock cutoff.
// Computed UTC midnight to avoid client-side TZ drift; the calendar
// UI is the source of truth for tz-aware display.
function dayContext(serviceDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lockCutoff = new Date(today);
  lockCutoff.setDate(lockCutoff.getDate() - LOCK_DAYS);
  const d = new Date(serviceDate + "T12:00:00");
  return {
    isPast: d < today,
    isLocked: d < lockCutoff,
  };
}

// Wraps any supabase error into a thrown Error with a [dataStore.sc]
// prefix so the route handler's catch produces a useful log line.
function throwOnError(error, op) {
  if (error) throw new Error(`[dataStore.sc] ${op}: ${error.message}`);
}


// ═══════════════════════════════════════════════════════════════
// loadAccountConfig
// ═══════════════════════════════════════════════════════════════
//
// Returns the service catalog for one account in the shape the
// calendar UI consumes when building its column headers, price
// chips, and admin-config drawer.
//
// Return shape:
//   {
//     groups: [
//       { id, groupName, sortOrder, active }, ...
//     ],
//     services: [
//       { id, groupId, groupName, serviceName, price,
//         isFlatFee, isTaxFree, isNonRevenue, sortOrder, active },
//       ...
//     ]
//   }
//
// services array is sorted by (group sortOrder, service sortOrder)
// so consumers can iterate in display order without resorting.
// Prices are the latest effective sc_service_prices row per service.

async function loadAccountConfigPostgres(accountKey) {
  const supa = getServiceClient();

  const [groupsRes, servicesRes] = await Promise.all([
    supa
      .from(SC_TABLES.groups)
      .select("id, group_name, sort_order, active")
      .eq("account_key", accountKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    supa
      .from(SC_TABLES.services)
      .select(
        "id, group_id, service_name, is_flat_fee, is_tax_free, " +
        "is_non_revenue, sort_order, active"
      )
      .eq("account_key", accountKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
  ]);
  throwOnError(groupsRes.error, "loadAccountConfig.groups");
  throwOnError(servicesRes.error, "loadAccountConfig.services");

  const groups = (groupsRes.data || []).map((g) => ({
    id:        g.id,
    groupName: g.group_name,
    sortOrder: g.sort_order,
    active:    g.active,
  }));

  const groupNameById = new Map(groups.map((g) => [g.id, g.groupName]));
  const groupSortById = new Map(groups.map((g) => [g.id, g.sortOrder]));

  // Latest-effective price per service via a per-service LATERAL-style
  // pull. supabase-js does not expose LATERAL, so we fetch all prices
  // for these service_ids and reduce to latest in JS. At ~100 prices
  // per account this is well within the single-call budget.
  const serviceIds = (servicesRes.data || []).map((s) => s.id);
  let priceByServiceId = new Map();
  if (serviceIds.length > 0) {
    const { data: priceRows, error: priceErr } = await supa
      .from(SC_TABLES.prices)
      .select("service_id, price, effective_date")
      .in("service_id", serviceIds)
      .order("effective_date", { ascending: false });
    throwOnError(priceErr, "loadAccountConfig.prices");
    for (const r of priceRows || []) {
      if (!priceByServiceId.has(r.service_id)) {
        // First row wins because we sorted desc; that's the latest price.
        priceByServiceId.set(r.service_id, Number(r.price));
      }
    }
  }

  const services = (servicesRes.data || [])
    .map((s) => ({
      id:           s.id,
      groupId:      s.group_id,
      groupName:    groupNameById.get(s.group_id) || "",
      serviceName:  s.service_name,
      price:        priceByServiceId.get(s.id) ?? 0,
      isFlatFee:    !!s.is_flat_fee,
      isTaxFree:    !!s.is_tax_free,
      isNonRevenue: !!s.is_non_revenue,
      sortOrder:    s.sort_order,
      active:       s.active,
    }))
    .sort((a, b) => {
      const ga = groupSortById.get(a.groupId) ?? 0;
      const gb = groupSortById.get(b.groupId) ?? 0;
      if (ga !== gb) return ga - gb;
      return a.sortOrder - b.sortOrder;
    });

  return { groups, services };
}

/**
 * Read service config (groups + services + prices) for one account.
 * Reads always come from Postgres - no flag dispatch.
 */
export async function loadAccountConfig(accountKey) {
  return loadAccountConfigPostgres(accountKey);
}


// ═══════════════════════════════════════════════════════════════
// loadMonthData
// ═══════════════════════════════════════════════════════════════
//
// Returns one day per (account, date) in the requested month, each
// with all per-service projection/actual/revenue values plus per-day
// metadata. The view sc_daily_revenue does the heavy lifting (UNION
// of projection + actual keys, LATERAL price lookup, metadata join).
//
// Return shape:
//   {
//     month: "2026-06",
//     days: [
//       {
//         date: "2026-06-01",
//         isPast, isLocked,
//         period, weekLabel, eventLabel, gameType, gameTime, dayNotes,
//         services: [
//           {
//             serviceId, serviceName, groupName,
//             isFlatFee, isTaxFree, isNonRevenue,
//             projectedCount, actualCount,
//             priceAtDate, priceEffectiveDate,
//             projectedRevenue, actualRevenue,
//             hasActuals, hasProjection
//           }
//         ],
//         hasAnyActuals,
//         totals: {
//           projectedCount, actualCount,
//           projectedRevenue, actualRevenue,
//         }
//       }
//     ]
//   }
//
// PostgREST default LIMIT is 1000. A 30-day month with up to ~25
// services per day = 750 view rows so this fits comfortably. The
// fetch pages explicitly via .range to be safe against future
// service-count growth.

async function loadMonthDataPostgres(accountKey, year, month) {
  const supa = getServiceClient();
  const { first, last } = monthBounds(year, month);

  // Fetch with explicit range to bypass the 1000-default ceiling for
  // wider months (PDC accounts with 13 services * 31 days = 403 rows
  // - within default - but TBJ-FL with 21 services * 31 = 651, still
  // under. The range still helps catch a future growth surprise.)
  const { data: viewRows, error: viewErr } = await supa
    .from("sc_daily_revenue")
    .select("*")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .range(0, 9999)
    .order("service_date", { ascending: true });
  throwOnError(viewErr, "loadMonthData.view");

  // Bucket rows by date.
  const dayBuckets = new Map();
  for (const r of viewRows || []) {
    if (!dayBuckets.has(r.service_date)) {
      dayBuckets.set(r.service_date, {
        date: r.service_date,
        period:      r.period      || null,
        weekLabel:   r.week_label  || null,
        eventLabel:  r.event_label || null,
        gameType:    r.game_type   || null,
        gameTime:    r.game_time   || null,
        dayNotes:    r.day_notes   || null,
        services: [],
      });
    }
    const bucket = dayBuckets.get(r.service_date);
    bucket.services.push({
      serviceId:           r.service_id,
      serviceName:         r.service_name,
      groupName:           r.group_name,
      isFlatFee:           !!r.is_flat_fee,
      isTaxFree:           !!r.is_tax_free,
      isNonRevenue:        !!r.is_non_revenue,
      projectedCount:      r.projected_count == null ? null : Number(r.projected_count),
      actualCount:         r.actual_count    == null ? null : Number(r.actual_count),
      priceAtDate:         Number(r.price_at_date) || 0,
      priceEffectiveDate:  r.price_effective_date,
      projectedRevenue:    Number(r.projected_revenue) || 0,
      actualRevenue:       Number(r.actual_revenue)    || 0,
      hasActuals:          !!r.has_actuals,
      hasProjection:       !!r.has_projection,
    });
  }

  // Build the final day array sorted by date. Compute totals + isPast/
  // isLocked per day. Revenue totals exclude is_non_revenue services
  // to match sc_month_summary semantics; counts include everything.
  const days = [...dayBuckets.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const ctx = dayContext(day.date);
      let projectedCount = 0;
      let actualCount = 0;
      let projectedRevenue = 0;
      let actualRevenue = 0;
      let hasAnyActuals = false;
      for (const s of day.services) {
        if (s.projectedCount != null) projectedCount += s.projectedCount;
        if (s.actualCount    != null) actualCount    += s.actualCount;
        if (!s.isNonRevenue) {
          projectedRevenue += s.projectedRevenue;
          if (s.hasActuals) actualRevenue += s.actualRevenue;
        }
        if (s.hasActuals) hasAnyActuals = true;
      }
      return {
        ...day,
        ...ctx,
        hasAnyActuals,
        totals: { projectedCount, actualCount, projectedRevenue, actualRevenue },
      };
    });

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    days,
  };
}

/**
 * Read one month of projection + actual data for an account.
 * Backed by the sc_daily_revenue view.
 */
export async function loadMonthData(accountKey, year, month) {
  return loadMonthDataPostgres(accountKey, year, month);
}


// ═══════════════════════════════════════════════════════════════
// loadYearSummary
// ═══════════════════════════════════════════════════════════════
//
// Returns the per-month rollup the heatmap needs, plus a per-day
// status array for each month so the heatmap can color days without
// a second round trip. Monthly aggregates come from sc_month_summary
// (which already excludes is_non_revenue from revenue). Day-status
// data comes from sc_daily_revenue (projection + actuals existence
// flags per day).
//
// Return shape:
//   {
//     year,
//     months: [
//       {
//         month: "2026-06",
//         totalServiceDays, daysWithActuals,
//         totalProjectedMeals, totalActualMeals,
//         totalProjectedRevenue, totalActualRevenue, revenueVariance,
//         days: [
//           { date, status, gameType }
//         ]
//       }
//     ]
//   }
//
// Day status values (preserves the legacy route's heatmap colors):
//   "no-service"   - has actuals AND all projections are zero/null
//   "entered"      - has actuals (at least one)
//   "overdue"      - past date older than LOCK_DAYS, no actuals
//   "needs-entry"  - past date within LOCK_DAYS, no actuals
//   "future"       - any future date

async function loadYearSummaryPostgres(accountKey, year) {
  const supa = getServiceClient();
  const { first, last } = yearBounds(year);

  const [summaryRes, daysRes] = await Promise.all([
    supa
      .from("sc_month_summary")
      .select("*")
      .eq("account_key", accountKey)
      .gte("month", first)
      .lte("month", last)
      .order("month", { ascending: true }),
    supa
      .from("sc_daily_revenue")
      .select(
        "service_date, projected_count, actual_count, " +
        "has_actuals, has_projection, game_type"
      )
      .eq("account_key", accountKey)
      .gte("service_date", first)
      .lte("service_date", last)
      .range(0, 99999),
  ]);
  throwOnError(summaryRes.error, "loadYearSummary.summary");
  throwOnError(daysRes.error,    "loadYearSummary.days");

  // Reduce the view rows to per-day status. Multiple services per
  // (account, date) means we union: hasAct=true if ANY service row has
  // actuals; anyNonZeroAct=true if ANY actual count is > 0. We classify
  // from actuals (what was served), not from projections (what was
  // planned). A day with all-zero projections but non-zero actuals -
  // e.g. unexpected catering on a Battery Camp Sunday - is "entered",
  // not "no-service".
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lockCutoff = new Date(today);
  lockCutoff.setDate(lockCutoff.getDate() - LOCK_DAYS);

  const dayState = new Map();
  for (const r of daysRes.data || []) {
    let st = dayState.get(r.service_date);
    if (!st) {
      st = {
        date: r.service_date,
        hasAct: false,
        anyNonZeroAct: false,
        gameType: r.game_type || "",
      };
      dayState.set(r.service_date, st);
    }
    if (r.has_actuals) st.hasAct = true;
    const av = r.actual_count;
    if (av != null && Number(av) > 0) st.anyNonZeroAct = true;
    if (!st.gameType && r.game_type) st.gameType = r.game_type;
  }

  function classify(s) {
    const d = new Date(s.date + "T12:00:00");
    const isPast = d < today;
    const isOverdue = d < lockCutoff;
    if (s.hasAct && !s.anyNonZeroAct) return "no-service";
    if (s.hasAct) return "entered";
    if (isPast && isOverdue) return "overdue";
    if (isPast) return "needs-entry";
    return "future";
  }

  // Bucket day states by month for the response.
  const daysByMonth = new Map();
  for (const s of dayState.values()) {
    const monthKey = s.date.slice(0, 7);
    if (!daysByMonth.has(monthKey)) daysByMonth.set(monthKey, []);
    daysByMonth.get(monthKey).push({
      date:     s.date,
      status:   classify(s),
      gameType: s.gameType || "",
    });
  }
  for (const arr of daysByMonth.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  const months = (summaryRes.data || []).map((row) => {
    const monthKey = String(row.month).slice(0, 7);
    return {
      month:                  monthKey,
      totalServiceDays:       Number(row.total_service_days)        || 0,
      daysWithActuals:        Number(row.days_with_actuals)         || 0,
      totalProjectedMeals:    Number(row.total_projected_meals)     || 0,
      totalActualMeals:       Number(row.total_actual_meals)        || 0,
      totalProjectedRevenue:  Number(row.total_projected_revenue)   || 0,
      totalActualRevenue:     Number(row.total_actual_revenue)      || 0,
      revenueVariance:        Number(row.revenue_variance)          || 0,
      days:                   daysByMonth.get(monthKey)             || [],
    };
  });

  return { year: Number(year), months };
}

/**
 * Read 12-month aggregate + per-day status for the year heatmap.
 * Backed by sc_month_summary + sc_daily_revenue views.
 */
export async function loadYearSummary(accountKey, year) {
  return loadYearSummaryPostgres(accountKey, year);
}


// ═══════════════════════════════════════════════════════════════
// saveActuals (the P0-1 fix landing site)
// ═══════════════════════════════════════════════════════════════
//
// Upserts the touched entries for one (account, service_date) only.
// The caller (route handler) is responsible for filtering out
// untouched services BEFORE constructing the entries array - the
// orchestrator writes exactly what it is given.
//
// entries shape:
//   [ { serviceId, actualCount }, ... ]
//
// Empty entries array = no-op (returns success, written=0). The UI
// can use this as a "no changes detected" path without special-casing.
//
// actualCount must be a non-negative integer. The schema CHECK
// catches violations; this function does not pre-validate.

async function saveActualsPostgres(accountKey, serviceDate, entries, email) {
  if (!entries || entries.length === 0) {
    return { success: true, written: 0 };
  }
  const supa = getServiceClient();
  const now = new Date().toISOString();

  // Build the rows for upsert. Each row is a complete sc_daily_actuals
  // payload. The schema's UNIQUE (account_key, service_id, service_date)
  // is the conflict target.
  const rows = entries.map((e) => ({
    account_key:  accountKey,
    service_id:   e.serviceId,
    service_date: serviceDate,
    actual_count: Number(e.actualCount),
    created_by:   email,
    updated_by:   email,
    updated_at:   now,
  }));

  const { error } = await supa
    .from(SC_TABLES.actuals)
    .upsert(rows, {
      onConflict: "account_key,service_id,service_date",
      ignoreDuplicates: false,
    });
  throwOnError(error, "saveActuals");

  return { success: true, written: rows.length };
}

/**
 * Upsert actuals for ONE day. ONLY the touched entries are written -
 * services absent from `entries` are preserved (P0-1 fix).
 *
 *   accountKey   - canonical spaced form, e.g. "CIN - AZ"
 *   serviceDate  - "YYYY-MM-DD"
 *   entries      - [{ serviceId, actualCount }] (ONLY touched)
 *   email        - actor email for created_by/updated_by + audit
 *
 * Returns { success, written }.
 *
 * The BEFORE UPDATE trigger on sc_daily_actuals captures the prior
 * actual_count into sc_daily_actuals_history for any value-changing
 * UPDATE. First INSERTs do not produce history rows (the row itself
 * carries created_by + created_at).
 */
export async function saveActuals(accountKey, serviceDate, entries, email) {
  const result = await saveActualsPostgres(accountKey, serviceDate, entries, email);
  if (isDualWrite(SC_TABLES.actuals)) {
    // TODO: mirror to per-account Drive spreadsheet (Actuals tab) when
    // shadow validation begins. The Sheets write logic lives in the
    // legacy route handler today; consolidating it here is a follow-up.
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════
// saveBulkActuals
// ═══════════════════════════════════════════════════════════════
//
// Multi-day version of saveActuals. Same touched-only semantics:
// every entry in the list represents a deliberate write.
//
// entries shape:
//   [ { serviceId, serviceDate, actualCount }, ... ]

async function saveBulkActualsPostgres(accountKey, entries, email) {
  if (!entries || entries.length === 0) {
    return { success: true, written: 0 };
  }
  const supa = getServiceClient();
  const now = new Date().toISOString();

  const rows = entries.map((e) => ({
    account_key:  accountKey,
    service_id:   e.serviceId,
    service_date: e.serviceDate,
    actual_count: Number(e.actualCount),
    created_by:   email,
    updated_by:   email,
    updated_at:   now,
  }));

  const { error } = await supa
    .from(SC_TABLES.actuals)
    .upsert(rows, {
      onConflict: "account_key,service_id,service_date",
      ignoreDuplicates: false,
    });
  throwOnError(error, "saveBulkActuals");

  return { success: true, written: rows.length };
}

/**
 * Upsert actuals for many (date, service) pairs. Touched-only.
 *
 *   accountKey - canonical spaced form
 *   entries    - [{ serviceId, serviceDate, actualCount }]
 *   email      - actor email
 *
 * Returns { success, written }. Single upsert call regardless of
 * payload size; supabase-js batches under the hood.
 */
export async function saveBulkActuals(accountKey, entries, email) {
  const result = await saveBulkActualsPostgres(accountKey, entries, email);
  if (isDualWrite(SC_TABLES.actuals)) {
    // TODO: Sheets mirror for shadow validation. Same posture as
    // saveActuals - the legacy route owns the Sheets logic today.
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════
// updateServiceConfig
// ═══════════════════════════════════════════════════════════════
//
// Applies admin changes to the service catalog. Two change types:
//
//   { type: "price", serviceId, newPrice, effectiveDate? }
//     -> appends a new sc_service_prices row. effectiveDate defaults
//        to today. The ledger is append-only; previous prices remain.
//        sc_daily_revenue resolves the price-at-date via LATERAL.
//
//   { type: "deactivate", serviceId }
//     -> sets sc_services.active = false. Existing projections/
//        actuals/prices are not deleted; the LEFT JOIN on the view
//        filters via the sc_services.deleted_at IS NULL clause.
//        Reactivation is "update active = true" - undo path stays
//        cheap.
//
// Changes are applied sequentially so a partial failure stops on the
// first bad change rather than producing a silently-half-applied
// state. Returns { success, applied } with applied <= changes.length.

async function updateServiceConfigPostgres(accountKey, changes, email) {
  if (!changes || changes.length === 0) {
    return { success: true, applied: 0 };
  }
  const supa = getServiceClient();
  const today = isoDay(new Date());
  let applied = 0;

  for (const ch of changes) {
    if (ch.type === "price") {
      const { error } = await supa.from(SC_TABLES.prices).insert({
        service_id:     ch.serviceId,
        price:          Number(ch.newPrice),
        effective_date: ch.effectiveDate || today,
        created_by:     email,
        notes:          ch.notes || null,
      });
      throwOnError(error, `updateServiceConfig.price[${applied}]`);
      applied++;
    } else if (ch.type === "deactivate") {
      const { error } = await supa
        .from(SC_TABLES.services)
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", ch.serviceId)
        .eq("account_key", accountKey);
      throwOnError(error, `updateServiceConfig.deactivate[${applied}]`);
      applied++;
    } else if (ch.type === "reactivate") {
      const { error } = await supa
        .from(SC_TABLES.services)
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq("id", ch.serviceId)
        .eq("account_key", accountKey);
      throwOnError(error, `updateServiceConfig.reactivate[${applied}]`);
      applied++;
    } else {
      throw new Error(
        `[dataStore.sc] updateServiceConfig: unknown change type '${ch.type}'`
      );
    }
  }

  return { success: true, applied };
}

/**
 * Apply admin config changes to an account's services.
 *
 *   accountKey - canonical spaced form
 *   changes    - array of { type, serviceId, ... }
 *                type = "price" | "deactivate" | "reactivate"
 *   email      - actor email
 *
 * Returns { success, applied }. Throws on the first error so the
 * caller can surface a partial-write count for retry.
 *
 * Price changes are ledger appends (sc_service_prices). Deactivation
 * is a soft toggle on sc_services.active.
 */
export async function updateServiceConfig(accountKey, changes, email) {
  const result = await updateServiceConfigPostgres(accountKey, changes, email);
  if (
    isDualWrite(SC_TABLES.prices) ||
    isDualWrite(SC_TABLES.services)
  ) {
    // TODO: shadow validation may need to mirror price changes to the
    // legacy service_config tab. Not implemented; see header note.
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════
// addService
// ═══════════════════════════════════════════════════════════════
//
// Admin path to add a new service to an account. Creates the group
// on-demand if it does not exist (matching the legacy route's
// implicit create-group-by-name behavior).
//
//   flags: { isFlatFee?, isTaxFree?, isNonRevenue? } (all default false)
//
// Returns the new service_id + group_id so the UI can immediately
// place the service in the calendar without a full reload.

async function addServicePostgres(
  accountKey, groupName, serviceName, price, flags, email
) {
  const supa = getServiceClient();

  // Resolve or create the group.
  let groupId;
  {
    const { data: existing, error } = await supa
      .from(SC_TABLES.groups)
      .select("id, sort_order")
      .eq("account_key", accountKey)
      .eq("group_name", groupName)
      .is("deleted_at", null)
      .maybeSingle();
    throwOnError(error, "addService.findGroup");

    if (existing) {
      groupId = existing.id;
    } else {
      // Find next sort_order: max(existing) + 1, or 0 if none.
      const { data: maxRows, error: maxErr } = await supa
        .from(SC_TABLES.groups)
        .select("sort_order")
        .eq("account_key", accountKey)
        .order("sort_order", { ascending: false })
        .limit(1);
      throwOnError(maxErr, "addService.maxGroupSort");
      const nextSort = (maxRows?.[0]?.sort_order ?? -1) + 1;

      const ins = await supa
        .from(SC_TABLES.groups)
        .insert({
          account_key: accountKey,
          group_name:  groupName,
          sort_order:  nextSort,
          created_by:  email,
        })
        .select("id")
        .single();
      throwOnError(ins.error, "addService.insertGroup");
      groupId = ins.data.id;
    }
  }

  // Resolve next service sort_order within the group.
  const { data: maxSvcRows, error: maxSvcErr } = await supa
    .from(SC_TABLES.services)
    .select("sort_order")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1);
  throwOnError(maxSvcErr, "addService.maxServiceSort");
  const nextServiceSort = (maxSvcRows?.[0]?.sort_order ?? -1) + 1;

  // Insert the service.
  const svcIns = await supa
    .from(SC_TABLES.services)
    .insert({
      account_key:    accountKey,
      group_id:       groupId,
      service_name:   serviceName,
      is_flat_fee:    !!(flags?.isFlatFee),
      is_tax_free:    !!(flags?.isTaxFree),
      is_non_revenue: !!(flags?.isNonRevenue),
      sort_order:     nextServiceSort,
      created_by:     email,
    })
    .select("id")
    .single();
  throwOnError(svcIns.error, "addService.insertService");
  const serviceId = svcIns.data.id;

  // Insert the initial price (effective today).
  const today = isoDay(new Date());
  const priceIns = await supa
    .from(SC_TABLES.prices)
    .insert({
      service_id:     serviceId,
      price:          Number(price) || 0,
      effective_date: today,
      created_by:     email,
    });
  throwOnError(priceIns.error, "addService.insertPrice");

  return {
    success:    true,
    serviceId,
    groupId,
    sortOrder:  nextServiceSort,
  };
}

/**
 * Add a new service under an account, creating its group if missing.
 *
 *   accountKey  - canonical spaced form
 *   groupName   - target group display name
 *   serviceName - the new service name
 *   price       - initial price (numeric)
 *   flags       - { isFlatFee?, isTaxFree?, isNonRevenue? }
 *   email       - actor email
 *
 * Returns { success, serviceId, groupId, sortOrder }.
 */
export async function addService(
  accountKey, groupName, serviceName, price, flags, email
) {
  const result = await addServicePostgres(
    accountKey, groupName, serviceName, price, flags, email
  );
  if (
    isDualWrite(SC_TABLES.services) ||
    isDualWrite(SC_TABLES.groups) ||
    isDualWrite(SC_TABLES.prices)
  ) {
    // TODO: Sheets mirror - the legacy route adds rows to the
    // service_config HUB tab; carry that path here when shadow
    // validation requires it.
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════
// submitConfigRequest
// ═══════════════════════════════════════════════════════════════
//
// Site leads cannot directly edit the catalog; they file a request
// that an admin reviews. The legacy route appended the request to the
// service_audit_log_26 tab. The PG version writes to the submissions
// table with module = 'service_calendar' (which already supports the
// audit + admin-review pattern; submissions has a 'status' column the
// admin UI flips from 'pending' to 'accepted'/'rejected').
//
// request shape:
//   {
//     requestType,           // e.g. "price_change", "add_service", "deactivate"
//     groupName?, serviceName?, currentPrice?, newPrice?, notes?
//   }
//
// The full request body is JSON-stored in submissions.payload so
// nothing is lost.

async function submitConfigRequestPostgres(accountKey, request, email) {
  const supa = getServiceClient();
  const { error } = await supa.from("submissions").insert({
    submitter_email: email,
    module:          "service_calendar",
    action_type:     `config_request:${request?.requestType || "unspecified"}`,
    location:        accountKey,
    payload:         request || {},
    status:          "pending",
    submitted_at:    new Date().toISOString(),
  });
  throwOnError(error, "submitConfigRequest");
  return { success: true };
}

/**
 * Log a site-lead config-change request as a pending submission.
 *
 *   accountKey - canonical spaced form
 *   request    - { requestType, groupName?, serviceName?,
 *                  currentPrice?, newPrice?, notes? }
 *   email      - actor email
 *
 * Returns { success }. Admin review flow lives in the submissions
 * module; nothing here approves or applies the change.
 */
export async function submitConfigRequest(accountKey, request, email) {
  return submitConfigRequestPostgres(accountKey, request, email);
}
