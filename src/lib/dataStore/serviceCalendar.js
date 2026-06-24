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
//   addServiceWithAudit + addServiceGroup (Bundle 2 sc-6c)
//     -> the audited catalog-add paths. The earlier unaudited
//        addService function was removed during the post-Bundle-2
//        audit cleanup; all admin add-paths now pair an
//        sc_config_changelog row.
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
  groups:       "sc_service_groups",
  services:     "sc_services",
  prices:       "sc_service_prices",
  projections:  "sc_daily_projections",
  actuals:      "sc_daily_actuals",
  metadata:     "sc_day_metadata",
  changelog:    "sc_config_changelog",
  feeSchedule:  "sc_fee_schedule",
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

// Money rounding helper. All price-display surfaces compare and render
// 2-decimal numbers; the DB stores NUMERIC(12,5) so legacy seed rows
// can carry contract-derived precision (e.g. 18.42147). Applying
// roundCents at the orchestrator boundary keeps the entire display/
// compare layer at the canonical money form without touching storage.
// Use this on every price coming OUT of the orchestrator.
function roundCents(n) {
  return Math.round(Number(n) * 100) / 100;
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
//
// "today" is computed via SERVER-LOCAL midnight (UTC on Vercel), not
// the operator's local clock. For a CT operator at 8pm Friday the
// server already sees Saturday UTC and may flip Friday's tile to
// isPast=true a few hours early. This is ADVISORY-ONLY UI coloring -
// the isPast/isLocked flags drive tile styling; no invoice cutoff or
// write enforcement reads them. Accepted as a known coloring quirk
// to keep loadMonthData's output shape stable.
//
// If evening tile-coloring ever matters operationally, the fix is to
// stop emitting isPast/isLocked from the orchestrator and have the
// calendar recompute them client-side per render. That is a separate
// future PR; do not bake it in here.
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

// Walk a select query in 1000-row chunks until exhausted. Caller passes a
// builder fn that returns a fresh PostgREST query each call (so we can
// re-apply .range per page). The query MUST include a deterministic
// .order() chain - without it, page boundaries can repeat or skip rows.
//
// Reason this exists: PostgREST silently caps single-call results at its
// configured max-rows (typically 1000). For sc_daily_revenue on an active
// account that's well under the per-account row count - the year heatmap
// silently dropped most dates and rendered them as transparent dots
// (reading as grey). This helper makes "fetch everything" safe.
async function fetchAllPaginated(supa, buildQuery, opLabel) {
  const PAGE = 1000;
  const out = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await buildQuery(supa).range(from, from + PAGE - 1);
    if (error) throw new Error(`[dataStore.sc] ${opLabel}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) out.push(r);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
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
      .select("id, group_name, sort_order, active, active_until")
      .eq("account_key", accountKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    supa
      .from(SC_TABLES.services)
      .select(
        "id, group_id, service_name, is_flat_fee, is_tax_free, " +
        "is_non_revenue, sort_order, active, active_until"
      )
      .eq("account_key", accountKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
  ]);
  throwOnError(groupsRes.error, "loadAccountConfig.groups");
  throwOnError(servicesRes.error, "loadAccountConfig.services");

  const groups = (groupsRes.data || []).map((g) => ({
    id:          g.id,
    groupName:   g.group_name,
    sortOrder:   g.sort_order,
    active:      g.active,
    activeUntil: g.active_until,
  }));

  const groupNameById = new Map(groups.map((g) => [g.id, g.groupName]));
  const groupSortById = new Map(groups.map((g) => [g.id, g.sortOrder]));

  // Current + upcoming price per service.
  //   current  = latest sc_service_prices row with effective_date <= today
  //   upcoming = earliest row with effective_date > today (if any)
  //
  // Split in JS rather than two queries; supabase-js doesn't expose
  // LATERAL, and at ~159 total price rows across all accounts the single
  // .in() query stays under PostgREST's 1000-row default page.
  //
  // Pre-this-fix the lookup picked the latest row OVERALL (no <= today
  // filter). That returned tomorrow's price as "current" today once the
  // admin editor started writing scheduled future changes. The split
  // here is the structural fix: the editor's "Current" display always
  // reads today, the "Scheduled" hint reads the next future-dated row.
  //
  // roundCents normalizes the 5-decimal NUMERIC storage to 2-decimal
  // display so the editor's change-detection compare is honest. The
  // legacy gear had a false-positive change counter for the 95 of 159
  // rows with > 2 decimal places.
  const today = isoDay(new Date());
  const serviceIds = (servicesRes.data || []).map((s) => s.id);
  const priceByServiceId = new Map();   // service_id -> { price, sinceDate }
  const upcomingByServiceId = new Map(); // service_id -> { price, effectiveDate }
  if (serviceIds.length > 0) {
    // price_kind = 'projected' selects the planning/sticker price.
    // The 'actual' kind (sc-8b backfill) is the contracted/billing
    // price consumed only by sc_daily_revenue's actuals lateral; the
    // account-config response is the planning surface (admin editor +
    // chef's per-row hint in DayDetail), so it must read projected.
    const { data: priceRows, error: priceErr } = await supa
      .from(SC_TABLES.prices)
      .select("service_id, price, effective_date")
      .in("service_id", serviceIds)
      .eq("price_kind", "projected")
      .order("effective_date", { ascending: false });
    throwOnError(priceErr, "loadAccountConfig.prices");
    // Walk rows DESC by effective_date. For each service_id, the first
    // row with effective_date <= today is the current price. Future-
    // dated rows seen before that are upcoming; track only the EARLIEST
    // one (so the editor surfaces the next scheduled change).
    for (const r of priceRows || []) {
      const sid = r.service_id;
      if (r.effective_date > today) {
        // Walking DESC means we overwrite repeatedly; the LAST write
        // wins, which is the earliest of the future-dated rows.
        upcomingByServiceId.set(sid, {
          price:         roundCents(r.price),
          effectiveDate: r.effective_date,
        });
        continue;
      }
      if (!priceByServiceId.has(sid)) {
        priceByServiceId.set(sid, {
          price:     roundCents(r.price),
          sinceDate: r.effective_date,
        });
      }
    }
  }

  const services = (servicesRes.data || [])
    .map((s) => {
      const cur = priceByServiceId.get(s.id);
      const up  = upcomingByServiceId.get(s.id);
      return {
        id:              s.id,
        groupId:         s.group_id,
        groupName:       groupNameById.get(s.group_id) || "",
        serviceName:     s.service_name,
        price:           cur?.price ?? 0,
        priceSinceDate:  cur?.sinceDate ?? null,
        upcomingPrice:   up?.price ?? null,
        upcomingEffectiveDate: up?.effectiveDate ?? null,
        isFlatFee:       !!s.is_flat_fee,
        isTaxFree:       !!s.is_tax_free,
        isNonRevenue:    !!s.is_non_revenue,
        sortOrder:       s.sort_order,
        active:          s.active,
        activeUntil:     s.active_until,
      };
    })
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
// loadAllAccountsConfig
// ═══════════════════════════════════════════════════════════════
//
// Single-shot read for the admin dashboard overview. Returns ALL
// active non-CORP accounts with their groups, services, and current
// (as-of-today) price. The structure mirrors loadAccountConfig per
// account, plus a top-level lastUpdatedAt per account derived from
// the changelog (preferred) or from sc_service_prices.effective_date
// (fallback). lastUpdatedAt is CAPPED AT today so a scheduled future
// price never makes an account read as "updated YYYY-MM-DD" in the
// future tense.
//
// Four queries total:
//   1. accounts (active, not CORP)
//   2. sc_service_groups (not deleted) - all accounts
//   3. sc_services (not deleted) - all accounts
//   4. sc_service_prices - bulk lookup, split current vs upcoming
//
// Plus one for the changelog:
//   5. sc_changelog_latest_by_account (sc-7 view) - one row per
//      account_key with the most recent changed_at. Replaces a prior
//      unbounded all-rows read on sc_config_changelog that PostgREST
//      silently capped at 1000 rows.
//
// Total payload bounded by ~270 rows; well under PostgREST's 1000-row
// default. No pagination required.

async function loadAllAccountsConfigPostgres() {
  const supa = getServiceClient();
  const today = isoDay(new Date());

  const [accountsRes, groupsRes, servicesRes, logRes] = await Promise.all([
    supa
      .from("accounts")
      .select("team_key, name, level, billing_model")
      .eq("active", true)
      .neq("team_key", "CORP")
      .order("team_key", { ascending: true }),
    supa
      .from(SC_TABLES.groups)
      .select("id, account_key, group_name, sort_order, active, active_until")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    supa
      .from(SC_TABLES.services)
      .select(
        "id, account_key, group_id, service_name, is_flat_fee, " +
        "is_tax_free, is_non_revenue, sort_order, active, active_until"
      )
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    supa
      .from("sc_changelog_latest_by_account")
      .select("account_key, last_changed_at"),
  ]);
  throwOnError(accountsRes.error,  "loadAllAccountsConfig.accounts");
  throwOnError(groupsRes.error,    "loadAllAccountsConfig.groups");
  throwOnError(servicesRes.error,  "loadAllAccountsConfig.services");
  throwOnError(logRes.error,       "loadAllAccountsConfig.changelog");

  // Bulk price lookup for every service in scope. Same split as
  // loadAccountConfigPostgres: current = latest <= today, upcoming =
  // earliest > today.
  const serviceIds = (servicesRes.data || []).map((s) => s.id);
  const priceByServiceId = new Map();
  const upcomingByServiceId = new Map();
  // Per-account "last priced" date - the max(effective_date) <= today
  // for any service in the account. Used as the fallback for
  // lastUpdatedAt when the changelog has no rows for the account.
  const lastPricedByAccount = new Map();
  if (serviceIds.length > 0) {
    // price_kind = 'projected': mirror the per-account loader's
    // semantic (planning price, not actual/billing price).
    const { data: priceRows, error: priceErr } = await supa
      .from(SC_TABLES.prices)
      .select("service_id, price, effective_date")
      .in("service_id", serviceIds)
      .eq("price_kind", "projected")
      .order("effective_date", { ascending: false });
    throwOnError(priceErr, "loadAllAccountsConfig.prices");
    const svcToAccount = new Map(
      (servicesRes.data || []).map((s) => [s.id, s.account_key])
    );
    for (const r of priceRows || []) {
      const sid = r.service_id;
      const acc = svcToAccount.get(sid);
      if (r.effective_date > today) {
        upcomingByServiceId.set(sid, {
          price:         roundCents(r.price),
          effectiveDate: r.effective_date,
        });
        continue;
      }
      if (!priceByServiceId.has(sid)) {
        priceByServiceId.set(sid, {
          price:     roundCents(r.price),
          sinceDate: r.effective_date,
        });
      }
      if (acc) {
        const prev = lastPricedByAccount.get(acc);
        if (!prev || r.effective_date > prev) {
          lastPricedByAccount.set(acc, r.effective_date);
        }
      }
    }
  }

  // Per-account latest changelog timestamp. Sourced from the
  // sc_changelog_latest_by_account view (sc-7), which does the MAX(changed_at)
  // GROUP BY account_key in Postgres. Bounded by account count, so the
  // PostgREST 1000-row cap that broke the prior unbounded read cannot
  // bite. The view's row shape is { account_key, last_changed_at } - one
  // row per account that has ever been written to changelog.
  const lastChangelogByAccount = new Map();
  for (const r of logRes.data || []) {
    if (r.last_changed_at) {
      lastChangelogByAccount.set(r.account_key, r.last_changed_at);
    }
  }

  // Build per-account payloads. Group services under their groups by
  // group_id. Each account's lastUpdatedAt prefers the changelog when
  // present, falls back to the effective_date floor, and is capped at
  // today so a scheduled future change never shows as "already
  // updated".
  const groupsByAccount = new Map();
  for (const g of groupsRes.data || []) {
    if (!groupsByAccount.has(g.account_key)) groupsByAccount.set(g.account_key, []);
    groupsByAccount.get(g.account_key).push({
      id:          g.id,
      groupName:   g.group_name,
      sortOrder:   g.sort_order,
      active:      g.active,
      activeUntil: g.active_until,
    });
  }
  const servicesByAccount = new Map();
  for (const s of servicesRes.data || []) {
    const cur = priceByServiceId.get(s.id);
    const up  = upcomingByServiceId.get(s.id);
    if (!servicesByAccount.has(s.account_key)) servicesByAccount.set(s.account_key, []);
    servicesByAccount.get(s.account_key).push({
      id:                    s.id,
      groupId:               s.group_id,
      serviceName:           s.service_name,
      price:                 cur?.price ?? 0,
      priceSinceDate:        cur?.sinceDate ?? null,
      upcomingPrice:         up?.price ?? null,
      upcomingEffectiveDate: up?.effectiveDate ?? null,
      isFlatFee:             !!s.is_flat_fee,
      isTaxFree:             !!s.is_tax_free,
      isNonRevenue:          !!s.is_non_revenue,
      sortOrder:             s.sort_order,
      active:                s.active,
      activeUntil:           s.active_until,
    });
  }

  const accounts = (accountsRes.data || []).map((a) => {
    // lastUpdatedAt: prefer changelog timestamp, else fall back to the
    // floor of (latest effective_date <= today) for the account. Either
    // way, capped at today.
    const cl = lastChangelogByAccount.get(a.team_key) || null;
    const lp = lastPricedByAccount.get(a.team_key) || null;
    let lastUpdatedAt = cl || lp;
    if (lastUpdatedAt && lastUpdatedAt.slice(0, 10) > today) lastUpdatedAt = null;
    return {
      key:           a.team_key,
      name:          a.name || a.team_key,
      level:         a.level || null,
      billingModel:  a.billing_model || null,
      groups:        groupsByAccount.get(a.team_key) || [],
      services:     (servicesByAccount.get(a.team_key) || []).sort((x, y) => x.sortOrder - y.sortOrder),
      lastUpdatedAt,
    };
  });

  return { generatedAt: today, accounts };
}

export async function loadAllAccountsConfig() {
  return loadAllAccountsConfigPostgres();
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
  // under. Paginate anyway so the year-view bug class (PostgREST cap
  // silently dropping rows) can't ever bite this path either.
  const viewRows = await fetchAllPaginated(
    supa,
    (q) => q
      .from("sc_daily_revenue")
      .select("*")
      .eq("account_key", accountKey)
      .gte("service_date", first)
      .lte("service_date", last)
      .order("service_date", { ascending: true })
      .order("service_id",   { ascending: true }),
    "loadMonthData.view"
  );

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

// ═══════════════════════════════════════════════════════════════
// loadHomestandContext
// ═══════════════════════════════════════════════════════════════
//
// Per-date lookup of homestand context for fee-account display
// (homestand grouping visuals, off-day urgency suppression between
// homestands, delivery vs revenue metrics). The data layer is
// intentionally kept separate from the sc_* core tables - this helper
// reads sc_homestand_schedule (a PG mirror of the HUB sheet's
// homestand_schedule tab seeded by scripts/_seed_sc_homestand_schedule.mjs).
//
// Return shape:
//   {
//     "YYYY-MM-DD": { homestandId: "HS1", dayType: "GAME", opponent: "CIN" },
//     ...
//   }
// Days not in sc_homestand_schedule are absent from the map - the UI
// reads "key missing" as "not part of the season" (renders invisible).
//
// Returns an empty object (not null) if the account has zero homestand
// rows, so callers can check `Object.keys(map).length` for the
// "has homestand data" gate.

export async function loadHomestandContext(accountKey, firstDate, lastDate) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, homestand_id, day_type, opponent")
    .eq("account_key", accountKey)
    .gte("service_date", firstDate)
    .lte("service_date", lastDate)
    .order("service_date", { ascending: true });
  throwOnError(error, "loadHomestandContext");

  const map = {};
  for (const r of data || []) {
    map[r.service_date] = {
      homestandId: r.homestand_id,
      dayType:     r.day_type,
      opponent:    r.opponent || "",
    };
  }
  return map;
}


async function loadYearSummaryPostgres(accountKey, year) {
  const supa = getServiceClient();
  const { first, last } = yearBounds(year);

  // PostgREST caps single-call rows at its configured max-rows even when
  // .range() asks for more. For accounts with > 1000 sc_daily_revenue
  // rows (every active account once you multiply 13+ services by 357
  // days), a single .range(0, 99999) silently returns the first 1000 -
  // status classification gets incomplete data and dates in the dropped
  // pages render as transparent dots on the year heatmap (reading as
  // grey against the page background). Chunk through with 1000-row pages
  // and a deterministic order so every day reaches dayState.
  const summaryRes = await supa
    .from("sc_month_summary")
    .select("*")
    .eq("account_key", accountKey)
    .gte("month", first)
    .lte("month", last)
    .order("month", { ascending: true });
  throwOnError(summaryRes.error, "loadYearSummary.summary");

  // billing_model lets classify() distinguish per-meal accounts (where a
  // past day with all-zero projections + no actuals means "planned off-
  // day, nothing to enter") from flat_fee accounts (which use homestand-
  // driven classification - see homestand branch in classify() below).
  const billingRes = await supa
    .from("accounts")
    .select("billing_model")
    .eq("team_key", accountKey)
    .maybeSingle();
  throwOnError(billingRes.error, "loadYearSummary.billing_model");
  const billingModel = billingRes.data?.billing_model || null;

  // Fetch homestand data ONLY for fee accounts. Per-meal accounts never
  // touch sc_homestand_schedule (no data exists for them) so we save the
  // query. STL-FL is flat_fee but has zero homestand rows; homestandMap
  // is empty for it and classify() falls back to the per-meal path.
  let homestandMap = {};
  if (billingModel === "flat_fee") {
    homestandMap = await loadHomestandContext(accountKey, first, last);
  }
  const hasHomestandData = Object.keys(homestandMap).length > 0;

  const daysRows = await fetchAllPaginated(
    supa,
    (q) => q
      .from("sc_daily_revenue")
      .select(
        "service_date, service_id, projected_count, actual_count, " +
        "has_actuals, has_projection, game_type"
      )
      .eq("account_key", accountKey)
      .gte("service_date", first)
      .lte("service_date", last)
      .order("service_date", { ascending: true })
      .order("service_id",   { ascending: true }),
    "loadYearSummary.days"
  );
  const daysRes = { data: daysRows };

  // Reduce the view rows to per-day status. Multiple services per
  // (account, date) means we union: hasAct=true if ANY service row has
  // actuals; anyNonZeroAct=true if ANY actual count is > 0. We classify
  // from actuals (what was served), not from projections (what was
  // planned). A day with all-zero projections but non-zero actuals -
  // e.g. unexpected catering on a Battery Camp Sunday - is "entered",
  // not "no-service".
  //
  // hasProj/anyNonZeroProj mirror the actuals pair and let per-meal
  // accounts recognize "past day with all-zero projection AND no actuals
  // entered" as a planned off-day instead of a missed entry. See the
  // classify() comment below for the gated branch.
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
        hasProj: false,
        anyNonZeroProj: false,
        gameType: r.game_type || "",
        actualMeals: 0,
      };
      dayState.set(r.service_date, st);
    }
    if (r.has_actuals) st.hasAct = true;
    if (r.has_projection) st.hasProj = true;
    const av = r.actual_count;
    if (av != null && Number(av) > 0) st.anyNonZeroAct = true;
    // Sum actual_count across services for the date so the year-view
    // tooltip can show "Mon Jun 23 - 240 meals" without a second
    // round trip. Includes non-revenue services (water, snack) - if
    // a service was logged, it counts toward the day total.
    if (av != null) st.actualMeals += Number(av);
    const pv = r.projected_count;
    if (pv != null && Number(pv) > 0) st.anyNonZeroProj = true;
    if (!st.gameType && r.game_type) st.gameType = r.game_type;
  }

  // Fee accounts: ensure every homestand date has a dayState entry even
  // if it's not in sc_daily_revenue (e.g. PREP/OPEN/CLOSE days that have
  // no projection rows). Without this, those dates would silently drop
  // from the year response and render as gaps in the heatmap.
  if (billingModel === "flat_fee" && hasHomestandData) {
    for (const date of Object.keys(homestandMap)) {
      if (!dayState.has(date)) {
        dayState.set(date, {
          date,
          hasAct: false,
          anyNonZeroAct: false,
          hasProj: false,
          anyNonZeroProj: false,
          gameType: "",
        });
      }
    }
  }

  function classify(s) {
    const d = new Date(s.date + "T12:00:00");
    const isPast = d < today;
    const isOverdue = d < lockCutoff;

    // ── Fee-account branch: homestand-driven classification ──
    // Fires for flat_fee accounts that have a homestand schedule loaded
    // (the 4 MLB fee accounts: CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V).
    // STL-FL is flat_fee but has zero homestand rows, so hasHomestandData
    // is false and it falls through to the per-meal branch.
    //
    // Schedule view, not urgency tracker: fee accounts have never had a
    // requirement to enter actuals, so a past game day without actuals
    // is just an unentered scheduled day - not "needs entry" or
    // "overdue". The fee year view is "here's your season at a glance",
    // not "here's everything you're behind on". Returning "future" for
    // any non-entered GAME day keeps the heatmap a clean navy schedule
    // with green highlights where data was entered.
    if (billingModel === "flat_fee" && hasHomestandData) {
      const hs = homestandMap[s.date];
      if (!hs) return "off-season";              // not in schedule -> invisible
      if (hs.dayType !== "GAME") return "prep";  // PREP/OPEN/CLOSE/CLEAN
      if (s.hasAct) return "entered";            // operator logged data
      return "future";                            // GAME day, no actuals - schedule
    }

    // ── Per-meal branch (unchanged) ──
    if (s.hasAct && !s.anyNonZeroAct) return "no-service";
    if (s.hasAct) return "entered";
    // 2026-06-17 (PR #167): per-meal accounts treat a past day with all-zero
    // projections AND no actuals as "no-service" (planned off-day, nothing
    // to enter). Without this branch the day fell through to "needs-entry"
    // (yellow) or "overdue" (red), surfacing a false alarm the operator
    // can't act on. flat_fee accounts use the homestand branch above.
    // Per-meal accounts: any day with projection rows that are ALL zero AND
    // no actuals = planned off day, regardless of past/future. Without
    // this, future zero-projection days (Joe entered blank or 0 in the
    // projections tab) flipped to "future" and rendered as light-green
    // "upcoming-service" on the year heatmap - operators saw the whole
    // back half of the season as scheduled service when most of those
    // days are planned off-days.
    //
    // Gate: any account that ISN'T using the homestand-driven schedule
    // view. flat_fee + hasHomestandData = the 4 MLB fee accounts
    // (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) - those use the homestand
    // branch above and skip this. STL-FL is flat_fee but has no
    // homestand rows; Kevin requires its operators to use actuals so
    // it gets the per-meal treatment here. Matches the frontend
    // isFeeAccount gate exactly (data.account.billingModel ===
    // "flat_fee" && !!data.homestandMap).
    if (!s.hasAct && s.hasProj && !s.anyNonZeroProj && !(billingModel === "flat_fee" && hasHomestandData)) return "no-service";
    if (isPast && isOverdue) return "overdue";
    if (isPast) return "needs-entry";
    return "future";
  }

  // Bucket day states by month for the response. For fee accounts the
  // homestand fields (homestandId, dayType, opponent) come through so
  // the UI can render homestand context on each dot without a second
  // round-trip.
  const daysByMonth = new Map();
  for (const s of dayState.values()) {
    const monthKey = s.date.slice(0, 7);
    if (!daysByMonth.has(monthKey)) daysByMonth.set(monthKey, []);
    const dayEntry = {
      date:        s.date,
      status:      classify(s),
      gameType:    s.gameType || "",
      actualMeals: s.actualMeals || 0,
    };
    const hs = homestandMap[s.date];
    if (hs) {
      dayEntry.homestandId = hs.homestandId;
      dayEntry.dayType     = hs.dayType;
      dayEntry.opponent    = hs.opponent;
    }
    daysByMonth.get(monthKey).push(dayEntry);
  }
  for (const arr of daysByMonth.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Fee accounts: pre-compute per-month homestand aggregates so the UI
  // can render "X of Y game days" + "X of Y homestands complete" on the
  // year cards without recomputing from days[]. Per-meal accounts skip
  // this block entirely (homestandSummary omitted from response).
  const homestandSummaryByMonth = new Map();
  if (billingModel === "flat_fee" && hasHomestandData) {
    for (const [monthKey, days] of daysByMonth.entries()) {
      let gameDays = 0, gameDaysEntered = 0, prepDays = 0;
      const homestandIds = new Set();
      for (const d of days) {
        if (d.dayType === "GAME") {
          gameDays++;
          if (d.status === "entered") gameDaysEntered++;
        } else if (d.dayType) {
          prepDays++;
        }
        if (d.homestandId) homestandIds.add(d.homestandId);
      }
      homestandSummaryByMonth.set(monthKey, {
        gameDays,
        gameDaysEntered,
        prepDays,
        homestandIds: [...homestandIds].sort((a, b) => {
          // Sort HS1, HS2, ... numerically rather than lexicographically
          // so HS10 doesn't sort before HS2.
          const na = parseInt(String(a).replace(/[^0-9]/g, ""), 10) || 0;
          const nb = parseInt(String(b).replace(/[^0-9]/g, ""), 10) || 0;
          return na - nb;
        }),
      });
    }
  }

  // Fee accounts: sc_month_summary may be missing months that have no
  // sc_daily_revenue rows but DO have homestand dates (PREP/OPEN/CLOSE
  // only). Backfill from daysByMonth so those months still appear.
  const monthsFromSummary = new Set((summaryRes.data || []).map((r) => String(r.month).slice(0, 7)));
  const allMonthKeys = new Set([...monthsFromSummary, ...daysByMonth.keys()]);
  const sortedMonthKeys = [...allMonthKeys].sort();

  const summaryByMonth = new Map(
    (summaryRes.data || []).map((r) => [String(r.month).slice(0, 7), r])
  );

  const months = sortedMonthKeys.map((monthKey) => {
    const row = summaryByMonth.get(monthKey) || {};
    const monthObj = {
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
    if (homestandSummaryByMonth.has(monthKey)) {
      monthObj.homestandSummary = homestandSummaryByMonth.get(monthKey);
    }
    return monthObj;
  });

  // Today's period + week (for the year-banner chip in the operator UI).
  // Reads the same view; a single row keyed by today's date for this
  // account. Returns null fields cleanly if today has no metadata (past
  // the seeded data range, e.g. the fiscal-year boundary) so the banner
  // chip is conditional rather than crashing.
  const todayStr = today.toISOString().slice(0, 10);
  const todayMetaRes = await supa
    .from("sc_daily_revenue")
    .select("period, week_label")
    .eq("account_key", accountKey)
    .eq("service_date", todayStr)
    .limit(1)
    .maybeSingle();
  const todayBlock = {
    date:   todayStr,
    period: todayMetaRes.data?.period     || null,
    week:   todayMetaRes.data?.week_label || null,
  };

  return { year: Number(year), months, today: todayBlock };
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
// Applies admin price changes to the service catalog. One change type:
//
//   { type: "price", serviceId, newPrice, effectiveDate? }
//     -> upserts a sc_service_prices row keyed by (service_id, effective_date).
//        effectiveDate defaults to today. If the admin corrects a price
//        twice in the same day, the second change UPDATEs the first row
//        rather than failing the uq_sc_service_prices_service_date
//        unique constraint. The ledger is otherwise append-only:
//        prior-day prices are never touched, and sc_daily_revenue
//        resolves price-at-date via LATERAL against the full history.
//
// Archive / reactivate is NOT here. Bundle 2 (sc-6c) added dedicated
// archiveService / reactivateService orchestrator functions that write
// sc_services.active_until (the billing-relevant archive field the
// views filter on). The earlier Stage 2 deactivate/reactivate branches
// that flipped the `active` BOOLEAN were unaudited and unreachable
// from any UI; removed as part of the post-Bundle-2 audit cleanup.
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
      // Step 1: read the prior as-of-today price for old_value in the
      // changelog. A miss (no prior row) means this is the first-ever
      // price for the service; the changelog records this as
      // change_type='create' so audit trails distinguish initial
      // pricing from a subsequent update.
      const effDate = ch.effectiveDate || today;
      const { data: priorRows, error: priorErr } = await supa
        .from(SC_TABLES.prices)
        .select("price, effective_date")
        .eq("service_id", ch.serviceId)
        .lte("effective_date", today)
        .order("effective_date", { ascending: false })
        .limit(1);
      throwOnError(priorErr, `updateServiceConfig.price.prior[${applied}]`);
      const priorPrice = priorRows && priorRows.length
        ? roundCents(priorRows[0].price)
        : null;

      // Step 2: upsert the price row. Upsert (not insert) so a same-
      // date re-correction updates the existing row instead of failing
      // on uq_sc_service_prices_service_date_kind. Same-date overwrites
      // are captured in the changelog write below, so the audit trail
      // is preserved even when the price-row history is not.
      // price_kind = 'projected': the admin editor surfaces the
      // planning/sticker rate. The actual/billing rate is derived in
      // sc_daily_revenue via the actuals lateral and is not edited
      // from this surface.
      const newPriceRounded = roundCents(ch.newPrice);
      const { error } = await supa.from(SC_TABLES.prices).upsert(
        {
          service_id:     ch.serviceId,
          price:          Number(ch.newPrice),
          effective_date: effDate,
          price_kind:     "projected",
          created_by:     email,
          notes:          ch.notes || null,
        },
        { onConflict: "service_id,effective_date,price_kind" }
      );
      throwOnError(error, `updateServiceConfig.price[${applied}]`);

      // Step 3: write one row to the audit log. Fails the whole
      // operation if the changelog insert errors - we never want a
      // price write without its audit row. The GRANT on
      // sc_config_changelog only allows INSERT + SELECT (sc-4
      // migration), so there's no UPDATE/DELETE bypass to worry about.
      // reason is required at the route layer; the schema CHECK is
      // defense in depth.
      const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
        account_key:    accountKey,
        entity_type:    "price",
        entity_id:      ch.serviceId,
        entity_label:   ch.entityLabel || null,
        change_type:    priorPrice === null ? "create" : "update",
        old_value:      priorPrice === null ? null : { price: priorPrice },
        new_value:      { price: newPriceRounded },
        effective_date: effDate,
        reason:         ch.notes,
        requested_by:   ch.requestedBy || null,
        changed_by:     email,
      });
      throwOnError(logErr, `updateServiceConfig.changelog[${applied}]`);
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
 * Apply admin price changes to an account's services.
 *
 *   accountKey - canonical spaced form
 *   changes    - array of { type, serviceId, ... }
 *                type = "price"   (archive/reactivate live in
 *                                  archiveService / reactivateService)
 *   email      - actor email
 *
 * Returns { success, applied }. Throws on the first error so the
 * caller can surface a partial-write count for retry. Price changes
 * are ledger appends (sc_service_prices).
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


// ═══════════════════════════════════════════════════════════════
// Catalog lifecycle (Bundle 2 Step 3 - sc-6c)
// ═══════════════════════════════════════════════════════════════
//
// Archive / reactivate / add for services and groups. Archive sets
// the billing-relevant active_until DATE on the catalog table;
// reactivate clears it. The views (sc-6b) filter on active_until so
// archived rows drop out of sc_daily_revenue for service_date >
// active_until while history at or before active_until is preserved.
//
// The pre-existing `active` BOOLEAN on both catalog tables is a UI
// toggle from Stage 2 that no surface today writes to (the gear was
// retired in PR #209). Views do NOT filter on it. We deliberately do
// not touch it from this lifecycle path - active_until is the truth.
// `deleted_at` stays dormant.
//
// Every write pairs an sc_config_changelog row (entity_type 'service'
// or 'group') so the audit ledger captures who / when / why for every
// catalog mutation.

async function archiveServicePostgres(accountKey, serviceId, archiveDate, reason, requestedBy, email) {
  const supa = getServiceClient();

  const { data: priorRows, error: priorErr } = await supa
    .from(SC_TABLES.services)
    .select("id, service_name, active_until")
    .eq("id", serviceId)
    .eq("account_key", accountKey)
    .is("deleted_at", null)
    .limit(1);
  throwOnError(priorErr, "archiveService.prior");
  if (!priorRows || priorRows.length === 0) {
    throw new Error(`[dataStore.sc] archiveService: service ${serviceId} not found in ${accountKey}`);
  }
  const prior = priorRows[0];

  const { error: updErr } = await supa
    .from(SC_TABLES.services)
    .update({ active_until: archiveDate, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("account_key", accountKey);
  throwOnError(updErr, "archiveService.update");

  const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
    account_key:    accountKey,
    entity_type:    "service",
    entity_id:      serviceId,
    entity_label:   prior.service_name,
    change_type:    "archive",
    old_value:      { activeUntil: prior.active_until },
    new_value:      { activeUntil: archiveDate },
    effective_date: archiveDate,
    reason:         reason.trim(),
    requested_by:   requestedBy ? requestedBy.trim() : null,
    changed_by:     email,
  });
  throwOnError(logErr, "archiveService.changelog");

  return { success: true, serviceId, activeUntil: archiveDate };
}

/**
 * Archive a service by setting its active_until DATE. The views filter on
 * active_until so the service drops out of sc_daily_revenue for dates
 * strictly after archiveDate while history at-or-before is preserved.
 */
export async function archiveService(accountKey, serviceId, archiveDate, reason, requestedBy, email) {
  return archiveServicePostgres(accountKey, serviceId, archiveDate, reason, requestedBy, email);
}


async function reactivateServicePostgres(accountKey, serviceId, reason, requestedBy, email) {
  const supa = getServiceClient();

  const { data: priorRows, error: priorErr } = await supa
    .from(SC_TABLES.services)
    .select("id, service_name, active_until")
    .eq("id", serviceId)
    .eq("account_key", accountKey)
    .is("deleted_at", null)
    .limit(1);
  throwOnError(priorErr, "reactivateService.prior");
  if (!priorRows || priorRows.length === 0) {
    throw new Error(`[dataStore.sc] reactivateService: service ${serviceId} not found in ${accountKey}`);
  }
  const prior = priorRows[0];

  const { error: updErr } = await supa
    .from(SC_TABLES.services)
    .update({ active_until: null, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("account_key", accountKey);
  throwOnError(updErr, "reactivateService.update");

  const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
    account_key:    accountKey,
    entity_type:    "service",
    entity_id:      serviceId,
    entity_label:   prior.service_name,
    change_type:    "reactivate",
    old_value:      { activeUntil: prior.active_until },
    new_value:      { activeUntil: null },
    effective_date: null,
    reason:         reason.trim(),
    requested_by:   requestedBy ? requestedBy.trim() : null,
    changed_by:     email,
  });
  throwOnError(logErr, "reactivateService.changelog");

  return { success: true, serviceId };
}

/**
 * Reactivate a service by clearing active_until (back to NULL = active
 * forever).
 */
export async function reactivateService(accountKey, serviceId, reason, requestedBy, email) {
  return reactivateServicePostgres(accountKey, serviceId, reason, requestedBy, email);
}


async function archiveServiceGroupPostgres(accountKey, groupId, archiveDate, reason, requestedBy, email) {
  const supa = getServiceClient();

  const { data: priorRows, error: priorErr } = await supa
    .from(SC_TABLES.groups)
    .select("id, group_name, active_until")
    .eq("id", groupId)
    .eq("account_key", accountKey)
    .is("deleted_at", null)
    .limit(1);
  throwOnError(priorErr, "archiveServiceGroup.prior");
  if (!priorRows || priorRows.length === 0) {
    throw new Error(`[dataStore.sc] archiveServiceGroup: group ${groupId} not found in ${accountKey}`);
  }
  const prior = priorRows[0];

  const { error: updErr } = await supa
    .from(SC_TABLES.groups)
    .update({ active_until: archiveDate, updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .eq("account_key", accountKey);
  throwOnError(updErr, "archiveServiceGroup.update");

  const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
    account_key:    accountKey,
    entity_type:    "group",
    entity_id:      groupId,
    entity_label:   prior.group_name,
    change_type:    "archive",
    old_value:      { activeUntil: prior.active_until },
    new_value:      { activeUntil: archiveDate },
    effective_date: archiveDate,
    reason:         reason.trim(),
    requested_by:   requestedBy ? requestedBy.trim() : null,
    changed_by:     email,
  });
  throwOnError(logErr, "archiveServiceGroup.changelog");

  return { success: true, groupId, activeUntil: archiveDate };
}

/**
 * Archive a service group by setting its active_until DATE. Affects every
 * service in the group via the view's group JOIN. The UI confirms the
 * blast radius (service count) before invoking.
 */
export async function archiveServiceGroup(accountKey, groupId, archiveDate, reason, requestedBy, email) {
  return archiveServiceGroupPostgres(accountKey, groupId, archiveDate, reason, requestedBy, email);
}


async function reactivateServiceGroupPostgres(accountKey, groupId, reason, requestedBy, email) {
  const supa = getServiceClient();

  const { data: priorRows, error: priorErr } = await supa
    .from(SC_TABLES.groups)
    .select("id, group_name, active_until")
    .eq("id", groupId)
    .eq("account_key", accountKey)
    .is("deleted_at", null)
    .limit(1);
  throwOnError(priorErr, "reactivateServiceGroup.prior");
  if (!priorRows || priorRows.length === 0) {
    throw new Error(`[dataStore.sc] reactivateServiceGroup: group ${groupId} not found in ${accountKey}`);
  }
  const prior = priorRows[0];

  const { error: updErr } = await supa
    .from(SC_TABLES.groups)
    .update({ active_until: null, updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .eq("account_key", accountKey);
  throwOnError(updErr, "reactivateServiceGroup.update");

  const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
    account_key:    accountKey,
    entity_type:    "group",
    entity_id:      groupId,
    entity_label:   prior.group_name,
    change_type:    "reactivate",
    old_value:      { activeUntil: prior.active_until },
    new_value:      { activeUntil: null },
    effective_date: null,
    reason:         reason.trim(),
    requested_by:   requestedBy ? requestedBy.trim() : null,
    changed_by:     email,
  });
  throwOnError(logErr, "reactivateServiceGroup.changelog");

  return { success: true, groupId };
}

/**
 * Reactivate a service group by clearing active_until.
 */
export async function reactivateServiceGroup(accountKey, groupId, reason, requestedBy, email) {
  return reactivateServiceGroupPostgres(accountKey, groupId, reason, requestedBy, email);
}


async function addServiceWithAuditPostgres(accountKey, groupId, serviceName, initialPrice, flags, reason, requestedBy, email) {
  const supa = getServiceClient();

  // Verify the group exists + belongs to this account (avoid cross-account
  // service writes via crafted groupId payloads).
  const { data: groupRows, error: groupErr } = await supa
    .from(SC_TABLES.groups)
    .select("id, group_name, account_key")
    .eq("id", groupId)
    .eq("account_key", accountKey)
    .is("deleted_at", null)
    .limit(1);
  throwOnError(groupErr, "addServiceWithAudit.group");
  if (!groupRows || groupRows.length === 0) {
    throw new Error(`[dataStore.sc] addServiceWithAudit: group ${groupId} not found in ${accountKey}`);
  }
  const groupName = groupRows[0].group_name;

  // Next sort_order within the group.
  const { data: maxSvcRows, error: maxSvcErr } = await supa
    .from(SC_TABLES.services)
    .select("sort_order")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1);
  throwOnError(maxSvcErr, "addServiceWithAudit.maxSort");
  const nextSort = (maxSvcRows?.[0]?.sort_order ?? -1) + 1;

  const svcIns = await supa
    .from(SC_TABLES.services)
    .insert({
      account_key:    accountKey,
      group_id:       groupId,
      service_name:   serviceName.trim(),
      is_flat_fee:    !!(flags?.isFlatFee),
      is_tax_free:    !!(flags?.isTaxFree),
      is_non_revenue: !!(flags?.isNonRevenue),
      sort_order:     nextSort,
      created_by:     email,
    })
    .select("id")
    .single();
  throwOnError(svcIns.error, "addServiceWithAudit.insertService");
  const serviceId = svcIns.data.id;

  // Initial price row at today.
  // price_kind = 'projected': new services are added with their
  // planning rate; the actual/billing rate is derived (or backfilled
  // separately) per the discount map - not from this surface.
  const today = isoDay(new Date());
  const priceRounded = roundCents(Number(initialPrice) || 0);
  const priceIns = await supa
    .from(SC_TABLES.prices)
    .insert({
      service_id:     serviceId,
      price:          Number(initialPrice) || 0,
      effective_date: today,
      price_kind:     "projected",
      created_by:     email,
    });
  throwOnError(priceIns.error, "addServiceWithAudit.insertPrice");

  // Paired changelog row.
  const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
    account_key:    accountKey,
    entity_type:    "service",
    entity_id:      serviceId,
    entity_label:   `${groupName} - ${serviceName.trim()}`,
    change_type:    "create",
    old_value:      null,
    new_value:      {
      serviceName:    serviceName.trim(),
      groupId,
      initialPrice:   priceRounded,
      isFlatFee:      !!(flags?.isFlatFee),
      isTaxFree:      !!(flags?.isTaxFree),
      isNonRevenue:   !!(flags?.isNonRevenue),
    },
    effective_date: today,
    reason:         reason.trim(),
    requested_by:   requestedBy ? requestedBy.trim() : null,
    changed_by:     email,
  });
  throwOnError(logErr, "addServiceWithAudit.changelog");

  return { success: true, serviceId, groupId, sortOrder: nextSort };
}

/**
 * Add a new service to an existing group with a paired changelog row.
 * The group must already exist + belong to the account (use addServiceGroup
 * to create groups). Inserts the service + an initial price row at today.
 */
export async function addServiceWithAudit(accountKey, groupId, serviceName, initialPrice, flags, reason, requestedBy, email) {
  return addServiceWithAuditPostgres(accountKey, groupId, serviceName, initialPrice, flags, reason, requestedBy, email);
}


async function addServiceGroupPostgres(accountKey, groupName, reason, requestedBy, email) {
  const supa = getServiceClient();

  // Next sort_order at the account level.
  const { data: maxRows, error: maxErr } = await supa
    .from(SC_TABLES.groups)
    .select("sort_order")
    .eq("account_key", accountKey)
    .order("sort_order", { ascending: false })
    .limit(1);
  throwOnError(maxErr, "addServiceGroup.maxSort");
  const nextSort = (maxRows?.[0]?.sort_order ?? -1) + 1;

  const ins = await supa
    .from(SC_TABLES.groups)
    .insert({
      account_key: accountKey,
      group_name:  groupName.trim(),
      sort_order:  nextSort,
      created_by:  email,
    })
    .select("id")
    .single();
  throwOnError(ins.error, "addServiceGroup.insert");
  const groupId = ins.data.id;

  const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
    account_key:    accountKey,
    entity_type:    "group",
    entity_id:      groupId,
    entity_label:   groupName.trim(),
    change_type:    "create",
    old_value:      null,
    new_value:      { groupName: groupName.trim() },
    effective_date: isoDay(new Date()),
    reason:         reason.trim(),
    requested_by:   requestedBy ? requestedBy.trim() : null,
    changed_by:     email,
  });
  throwOnError(logErr, "addServiceGroup.changelog");

  return { success: true, groupId, sortOrder: nextSort };
}

/**
 * Create a new service group under an account with a paired changelog
 * row. Returns the new groupId so the UI can drop into add-service flow
 * for the new group.
 */
export async function addServiceGroup(accountKey, groupName, reason, requestedBy, email) {
  return addServiceGroupPostgres(accountKey, groupName, reason, requestedBy, email);
}


// ═══════════════════════════════════════════════════════════════
// Fee schedule (Bundle 1 Stage 2 - sc-5 migration)
// ═══════════════════════════════════════════════════════════════
//
// The contract-revenue layer. Service Calendar does NOT consume this
// data; the admin owns it and the future KPI dashboard reads it.
//
// READ MODEL (matches sc-5 migration header):
//   - current = the latest sc_fee_schedule row for an account with
//     effective_date <= today, broken by created_at DESC (so a same-
//     day correction wins).
//   - upcoming = the EARLIEST future row, broken by created_at DESC
//     within the same effective_date.
//
// WRITE MODEL: insert-only. A change is a new dated row. NO upsert -
// the sc-5 GRANT denies UPDATE/DELETE, and the table has NO UNIQUE on
// (account_key, effective_date) so same-day corrections succeed as a
// fresh row.
//
// AUDIT: each write also inserts a sc_config_changelog row with
// entity_type='fee'. The two inserts are sequential; failure of the
// changelog insert aborts the operation just like the price path.

async function loadFeeSchedulePostgres() {
  const supa = getServiceClient();
  const today = isoDay(new Date());

  const accountsRes = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model")
    .eq("billing_model", "flat_fee")
    .eq("active", true)
    .order("team_key", { ascending: true });
  throwOnError(accountsRes.error, "loadFeeSchedule.accounts");

  const accountKeys = (accountsRes.data || []).map((a) => a.team_key);
  let feeRows = [];
  if (accountKeys.length > 0) {
    const feesRes = await supa
      .from(SC_TABLES.feeSchedule)
      .select(
        "id, account_key, amount, effective_date, period_type, " +
        "payment_cadence, covered_by_account_key, reason, requested_by, " +
        "changed_by, created_at"
      )
      .in("account_key", accountKeys)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });
    throwOnError(feesRes.error, "loadFeeSchedule.fees");
    feeRows = feesRes.data || [];
  }

  // Walking the result DESC by (effective_date, created_at). For each
  // account, the first row with effective_date <= today is the current
  // pick (latest eff, latest correction within ties). For upcoming, we
  // want the EARLIEST future effective_date with latest created_at
  // tiebreak - tracked explicitly because DESC traversal sees later
  // future dates first.
  const currentByKey = new Map();
  const upcomingByKey = new Map();
  for (const r of feeRows) {
    if (r.effective_date <= today) {
      if (!currentByKey.has(r.account_key)) {
        currentByKey.set(r.account_key, r);
      }
      continue;
    }
    const prev = upcomingByKey.get(r.account_key);
    if (!prev) {
      upcomingByKey.set(r.account_key, r);
    } else if (r.effective_date < prev.effective_date) {
      upcomingByKey.set(r.account_key, r);
    } else if (r.effective_date === prev.effective_date && r.created_at > prev.created_at) {
      upcomingByKey.set(r.account_key, r);
    }
  }

  const shape = (r) => r ? ({
    id:                   r.id,
    amount:               Number(r.amount),
    effectiveDate:        r.effective_date,
    periodType:           r.period_type,
    paymentCadence:       r.payment_cadence,
    coveredByAccountKey:  r.covered_by_account_key,
    reason:               r.reason,
    requestedBy:          r.requested_by,
    changedBy:            r.changed_by,
    createdAt:            r.created_at,
  }) : null;

  const fees = (accountsRes.data || []).map((a) => ({
    accountKey:  a.team_key,
    name:        a.name || a.team_key,
    level:       a.level || null,
    current:     shape(currentByKey.get(a.team_key)),
    upcoming:    shape(upcomingByKey.get(a.team_key)),
  }));

  return { generatedAt: today, fees };
}

/**
 * Read the fee schedule for all flat_fee accounts: current as-of-today
 * row + next upcoming change per account. Powers the admin Fee
 * schedule surface.
 */
export async function loadFeeSchedule() {
  return loadFeeSchedulePostgres();
}


async function loadFeeAccountHistoryPostgres(accountKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from(SC_TABLES.feeSchedule)
    .select(
      "id, amount, effective_date, period_type, payment_cadence, " +
      "covered_by_account_key, reason, requested_by, changed_by, created_at"
    )
    .eq("account_key", accountKey)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  throwOnError(error, "loadFeeAccountHistory");
  return (data || []).map((r) => ({
    id:                   r.id,
    amount:               Number(r.amount),
    effectiveDate:        r.effective_date,
    periodType:           r.period_type,
    paymentCadence:       r.payment_cadence,
    coveredByAccountKey:  r.covered_by_account_key,
    reason:               r.reason,
    requestedBy:          r.requested_by,
    changedBy:            r.changed_by,
    createdAt:            r.created_at,
  }));
}

/**
 * Read every sc_fee_schedule row for one account, newest first.
 * Used by the admin fee history surface.
 */
export async function loadFeeAccountHistory(accountKey) {
  return loadFeeAccountHistoryPostgres(accountKey);
}


async function updateFeeSchedulePostgres(accountKey, change, email) {
  const supa = getServiceClient();
  const today = isoDay(new Date());

  // Read prior current row for changelog old_value + to carry forward
  // covered_by_account_key + period_type when the caller does not
  // override them (Bundle 1 Stage 2 only edits amount + optional
  // payment_cadence; bundled markers persist across rows).
  const { data: priorRows, error: priorErr } = await supa
    .from(SC_TABLES.feeSchedule)
    .select("amount, effective_date, period_type, payment_cadence, covered_by_account_key")
    .eq("account_key", accountKey)
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  throwOnError(priorErr, "updateFeeSchedule.prior");
  const prior = priorRows && priorRows.length ? priorRows[0] : null;
  const priorValue = prior ? {
    amount:               Number(prior.amount),
    effectiveDate:        prior.effective_date,
    periodType:           prior.period_type,
    paymentCadence:       prior.payment_cadence,
    coveredByAccountKey:  prior.covered_by_account_key,
  } : null;

  // Carry forward bundle marker + period unless explicitly overridden.
  const periodType = change.periodType || prior?.period_type || "annual";
  const paymentCadence = change.paymentCadence !== undefined
    ? change.paymentCadence
    : (prior?.payment_cadence ?? null);
  const coveredBy = change.coveredByAccountKey !== undefined
    ? change.coveredByAccountKey
    : (prior?.covered_by_account_key ?? null);

  const newRow = {
    account_key:            accountKey,
    amount:                 Number(change.amount),
    effective_date:         change.effectiveDate,
    period_type:            periodType,
    payment_cadence:        paymentCadence,
    covered_by_account_key: coveredBy,
    reason:                 change.reason.trim(),
    requested_by:           change.requestedBy ? change.requestedBy.trim() : null,
    changed_by:             email,
  };

  const insRes = await supa
    .from(SC_TABLES.feeSchedule)
    .insert(newRow)
    .select("id, created_at")
    .single();
  throwOnError(insRes.error, "updateFeeSchedule.insert");

  const newValue = {
    amount:               Number(change.amount),
    periodType,
    paymentCadence,
    coveredByAccountKey:  coveredBy,
  };
  const { error: logErr } = await supa.from(SC_TABLES.changelog).insert({
    account_key:    accountKey,
    entity_type:    "fee",
    entity_id:      null,
    entity_label:   accountKey,
    change_type:    priorValue === null ? "create" : "update",
    old_value:      priorValue,
    new_value:      newValue,
    effective_date: change.effectiveDate,
    reason:         change.reason.trim(),
    requested_by:   change.requestedBy ? change.requestedBy.trim() : null,
    changed_by:     email,
  });
  throwOnError(logErr, "updateFeeSchedule.changelog");

  return {
    success:   true,
    id:        insRes.data.id,
    createdAt: insRes.data.created_at,
  };
}

/**
 * Apply one fee-schedule change for an account. Inserts a new
 * sc_fee_schedule row + a paired sc_config_changelog row. NEVER updates
 * or deletes existing fee rows - the audit trail is the history.
 *
 *   accountKey - canonical spaced form
 *   change     - { amount, effectiveDate, reason, requestedBy?,
 *                  periodType?, paymentCadence?, coveredByAccountKey? }
 *   email      - actor email (-> changed_by)
 *
 * Returns { success, id, createdAt }.
 */
export async function updateFeeSchedule(accountKey, change, email) {
  return updateFeeSchedulePostgres(accountKey, change, email);
}
