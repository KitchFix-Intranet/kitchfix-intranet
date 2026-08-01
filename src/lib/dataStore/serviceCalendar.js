import { getServiceClient } from "@/lib/supabase";
import { isDualWrite } from "@/lib/cutover";
// M-0 (2026-08-04): homestandSummary.homestandIds for MLB accounts is
// now derived from GAME/AWAY blocks, not from stored homestand_id.
// Non-MLB accounts fall through to the pre-M-0 stored-id path (STL-FL
// gets [] either way; empty stored ids). Import is client-file-free -
// homestandDerivation.js has no React / DOM dependencies.
import {
  deriveHomestandSegments,
  DERIVE_HOMESTANDS_ACCOUNTS,
} from "@/app/service-calendar/season/homestandDerivation";
// M-2 (2026-07-29): homestand detail payload build. Pure module,
// server-safe (no React deps - checked in laborBudgetDerivation.js
// header). We call deriveLaborBudgets here without touching its math.
import { deriveLaborBudgets } from "@/app/service-calendar/season/laborBudgetDerivation";
// M-2 pilot allow-list. Non-hook module; safe to import server-side.
// The set is the ONLY signal that gates the top-level homestands[]
// emit. See v2/pilots.js for why this is separate from
// DERIVE_HOMESTANDS_ACCOUNTS.
import { MLB_HOMESTAND_SURFACE_ACCOUNTS } from "@/app/service-calendar/v2/pilots";
// M-2: labor budgets live rows for the emit. salary_budget and
// revenue_forecast are stripped at the boundary here so they never
// cross the network. Admin fields (changed_by / changed_at /
// effective_from / reason / id) never enter the M-2 payload path.
import { readLiveLaborBudgets } from "@/lib/dataStore/laborBudgets";

// ── Schedule-truth fallback (shared) ──────────────────────────────────
//
// DOCTRINE (Kevin's ruling, 2026-07-14): the MLB / MiLB Stats API schedule
// is CALENDAR TRUTH for every schedule-bearing account (MLB fee, AAA,
// PDCO overlay affiliates). Projections are authored before final
// schedules exist, by design - they overlay the skeleton, never define
// it. Day existence on the Service Calendar derives from the schedule
// table (sc_homestand_schedule) or the overlay table (sc-17/sc-17b),
// NEVER from sc_daily_revenue row presence. See
// docs/modules/SERVICE_CALENDAR.md "Schedule truth hierarchy".
//
// Called by both loadYearSummaryPostgres and loadMonthDataPostgres to
// backfill the loader's day map from schedule truth for any date the
// revenue view happens not to cover (getaway AWAY dates immediately
// preceding a home opener - Part 3 audit finding; PREP/OPEN/CLOSE days;
// GAME days lacking projections; any future case where schedule >
// projection lag exists). Scoped to ALL schedule-bearing accounts (not
// just MLB fee) per the 2026-07-14 widening: AAA per-meal + PDCO
// overlay-only both benefit.
//
// The two loaders keep different per-day shapes, so the caller passes a
// `defaultFactory(date) -> entry` closure and pre-computes the union of
// schedule/overlay date sets. Exported for unit tests -
// scripts/content/__tests__/sc-fee-fallback.test.mjs. Returns the count
// of dates added.
export function addMissingScheduleDates(mapRef, scheduleDates, defaultFactory) {
  let added = 0;
  for (const date of scheduleDates) {
    if (!mapRef.has(date)) {
      mapRef.set(date, defaultFactory(date));
      added++;
    }
  }
  return added;
}

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
  metadata:     "sc_day_metadata",     // SC-079: notes column DORMANT post-Round 3
  noteEntries:  "sc_day_note_entries", // SC-079: append-only day-note ledger (sc-9 migration)
  changelog:    "sc_config_changelog",
  feeSchedule:  "sc_fee_schedule",
};

// Days older than LOCK_DAYS render as locked in the UI. The orchestrator
// does NOT enforce this at the data layer - the legacy route note
// "managers can edit any past day" applies here too. The flag is
// computed and returned with each day so the UI can apply consistent
// styling without recomputing.
//
// DP2-09 (owner-confirmed 2026-07-20): LOCK_DAYS is the INTENTIONAL
// grace period that separates the "needs-entry" (amber) and "overdue"
// (red) states in the UI classifier. Recent-past unentered days sit
// in amber grace for LOCK_DAYS-1 days after their service date;
// crossing the boundary flips them to red overdue. The threshold is
// a product decision (not a bug): floor teams get a week to enter
// actuals with soft urgency before escalation. Downstream:
// classify() at serviceCalendar.js:215-216 branches on isLocked;
// DayDetail.js:747 + DayEntryV2.js:457 recompute the same isPast +
// isLocked signal for the modal; RailFooter footer state machines
// (DrillRail.js:132-172, OpsRail.js buildDrillFooter, OpsRail
// deriveOpsFooterActionStlFl) all read `.status` fields already
// classified with this cutoff. DO NOT change LOCK_DAYS without an
// owner ruling - the value shows up in every operator surface
// (chip colors, rail severity, "N days old" copy, escalation UX).
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
// "today" is supplied by the caller (built from opts.clientToday when
// the client sends its local date on the read; otherwise server-local
// midnight = UTC on Vercel as the fallback). Constructed consistently
// with the per-day comparison dates (d = new Date(date + "T12:00:00")
// is local midday) so the calendar-date compare is correct in either
// timezone.
function dayContext(serviceDate, today) {
  const lockCutoff = new Date(today);
  lockCutoff.setDate(lockCutoff.getDate() - LOCK_DAYS);
  const d = new Date(serviceDate + "T12:00:00");
  return {
    isPast: d < today,
    isLocked: d < lockCutoff,
  };
}

// Build the "today" anchor used by the read paths. When clientToday is
// a YYYY-MM-DD string sent by the operator's browser, construct local
// midnight of that date so the d < today compare (with d = local
// midday) reflects the operator's actual calendar day. Otherwise fall
// back to server-local midnight (UTC on Vercel).
function buildTodayAnchor(clientToday) {
  if (clientToday && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)) {
    const d = new Date(clientToday + "T00:00:00");
    // Defense-in-depth: a shaped-but-invalid date ("2026-99-99") would
    // construct an Invalid Date and silently poison every downstream
    // compare. The route's parseClientToday round-trip-validates, but
    // any future direct caller can land here. Fall through to the
    // server-local midnight fallback on isNaN.
    if (!isNaN(d.getTime())) return d;
  }
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// Wraps any supabase error into a thrown Error with a [dataStore.sc]
// prefix so the route handler's catch produces a useful log line.
function throwOnError(error, op) {
  if (error) throw new Error(`[dataStore.sc] ${op}: ${error.message}`);
}

// Day-status classification shared by the year + month loaders. Was a
// closure inside loadYearSummaryPostgres, which meant the month payload
// carried no status field and every drill-in tile fell through to the
// neutral "off" fill (dayResolvers.js default branch). Extracted with an
// explicit input contract so both paths derive the same status for the
// same day.
//
//   s   - the per-day state: { date, hasAct, hasProj, anyNonZeroAct,
//         anyNonZeroProj }. Same shape both loaders reduce their view
//         rows into.
//   ctx - the classification context: { today, lockCutoff, billingModel,
//         hasHomestandData, homestandMap }. today/lockCutoff are Date
//         objects (today anchor + LOCK_DAYS-back cutoff).
//
// Status vocabulary (preserves the legacy heatmap colors):
//   "no-service"   - actuals present but all zero, OR (per-meal only)
//                    a day with all-zero projections and no actuals
//   "entered"      - actuals present (at least one non-zero)
//   "overdue"      - past date older than LOCK_DAYS, no actuals
//   "needs-entry"  - past date within LOCK_DAYS, no actuals
//   "future"       - future date (also the fee "GAME day, no actuals")
//   "prep"         - fee non-GAME homestand day (PREP/OPEN/CLOSE/CLEAN)
//   "off-season"   - fee date not in the homestand schedule
export function classifyDayStatus(s, ctx) {
  const d = new Date(s.date + "T12:00:00");
  const isPast = d < ctx.today;
  const isOverdue = d < ctx.lockCutoff;

  // sc-16 (2026-07-11): lift the schedule-row lookup so both branches
  // can consult it. Fee accounts have always used hs for their branch
  // logic; per-meal accounts now use it to short-circuit AWAY days for
  // Louisville / Buffalo (the two per-meal accounts with schedule
  // data). Other per-meal accounts have no hs and skip the check.
  const hs = ctx.homestandMap?.[s.date];

  // Fee-account branch: homestand-driven classification (4 MLB fee
  // accounts have homestand rows; STL-FL is flat_fee but has zero
  // homestand rows so hasHomestandData is false and it falls through to
  // the per-meal branch).
  //
  // Schedule view, not urgency tracker: fee accounts have never had a
  // requirement to enter actuals, so a past GAME day without actuals is
  // just an unentered scheduled day - not "needs entry" or "overdue".
  //
  // SC-078 (owner ruling 2026-07-09): entry beats schedule. The pre-
  // Round-3 shape returned "prep" for any non-game day the moment the
  // schedule said so, ignoring hasAct - so an entered non-game day
  // (Jun 26 repro: 10 meals recorded) stayed beige. Fixed by checking
  // hasAct BEFORE the dayType filter on non-game days.
  //
  // Deliberate asymmetry vs per-meal (worth a GOTCHAS entry - flagged
  // as a Round-3 candidate). Per-meal all-zero saved actuals classify
  // as "no-service" (planned off day). Homestand game-day + hasAct
  // (INCLUDING all-zero) classifies as "entered" (a zeroed game = a
  // recorded cancellation, still a tracked event). Per Kevin's ruling:
  // the operator's action wins over the schedule's suggestion.
  if (ctx.billingModel === "flat_fee" && ctx.hasHomestandData) {
    if (!hs) return "off-season";              // not in schedule -> invisible
    // sc-12 (2026-07-10): EXHIBITION days are billed as separate catering
    // outside the contract. Distinct atom status so the tile can render
    // the cream + copper "EXH" ribbon and stay display-only (not
    // clickable, no actuals expected). Excluded from the X/30 counter
    // downstream via the existing dayType === "GAME" filter.
    if (hs.dayType === "EXHIBITION") return "exhibition";
    // sc-13 (2026-07-10): AWAY days - team is on the road, no service
    // to enter. Distinct atom status so the tile renders the muted
    // date + hollow @OPP tag + plane glyph. Not clickable. Excluded
    // from the X/30 counter downstream via the existing dayType === "GAME"
    // filter and from every rollup surface EXHIBITION was excluded from.
    if (hs.dayType === "AWAY") return "away";
    if (hs.dayType === "GAME") {
      if (s.hasAct) return "entered";           // game day recorded (zero incl.)
      return "future";                            // GAME day, no actuals
    }
    // Non-game day (PREP / OPEN / CLOSE / CLEAN): entry wins if the
    // operator actually recorded a non-zero meal count. All-zero on a
    // non-game day OR no actuals stays "prep" (schedule-driven default).
    if (s.hasAct && s.anyNonZeroAct) return "entered";
    return "prep";
  }

  // Per-meal branch (PDC + MiLB + STL-FL).
  // sc-16 (2026-07-11): schedule-having per-meal accounts
  // (Louisville / Buffalo) short-circuit to "away" when the schedule
  // says the team is on the road. Team-on-the-road wins over any
  // stale projections or actuals - the AWAY tile is display-only,
  // teal fill, hollow @OPP chip (matches the fee branch's AWAY
  // handling). All other per-meal accounts have no hs and the check
  // is a no-op.
  if (hs?.dayType === "AWAY") return "away";
  if (s.hasAct && !s.anyNonZeroAct) return "no-service";
  if (s.hasAct) return "entered";
  // 2026-06-17 (PR #167): per-meal accounts treat a day with all-zero
  // projections AND no actuals as "no-service" (planned off-day, nothing
  // to enter). Applies past AND future so the back half of the season
  // isn't rendered as scheduled service. flat_fee + hasHomestandData
  // uses the fee branch above and skips this.
  if (!s.hasAct && s.hasProj && !s.anyNonZeroProj && !(ctx.billingModel === "flat_fee" && ctx.hasHomestandData)) return "no-service";
  if (isPast && isOverdue) return "overdue";
  if (isPast) return "needs-entry";
  return "future";
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
    // price_kind = 'projected' selects the post-SF invoice rate per
    // docs/SC_MONEY_MODEL.md (Price Review v3, 2026-06-16). The column
    // name is legacy - what these rows hold is what appears on the
    // client's per-meal invoice, not a "sticker" or "planning" rate.
    // The 'actual' kind was written by sc-8b's backfill and REMOVED
    // by sc-8c on 2026-07-09 (it double-discounted; see sc-8c header).
    // The view's COALESCE(pr_act, pr_proj) fallback now prices actuals
    // at the projected row = the post-SF invoice rate. Kept the
    // .eq("price_kind","projected") filter to make the intent explicit
    // and defend against a future third kind (e.g., 'sticker') being
    // added without this call site being reviewed.
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
      .select("team_key, name, level, billing_model, has_homestand_schedule")
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
    // semantic. Per docs/SC_MONEY_MODEL.md, 'projected' rows hold the
    // post-SF invoice rate (Price Review v3, 2026-06-16), so this is
    // the number that shows on admin surfaces + chef surfaces alike.
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
      hasHomestandSchedule: !!a.has_homestand_schedule,
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
//         period, weekLabel, eventLabel, gameType, gameTime,
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

async function loadMonthDataPostgres(accountKey, year, month, opts = {}) {
  const supa = getServiceClient();
  const { first, last } = monthBounds(year, month);
  const today = buildTodayAnchor(opts.clientToday);
  const lockCutoff = new Date(today);
  lockCutoff.setDate(lockCutoff.getDate() - LOCK_DAYS);

  // Fetch view rows + billing_model in parallel; classify() below needs
  // billing_model (per-meal vs flat_fee branch) and, for flat_fee, the
  // homestand context. Mirrors loadYearSummaryPostgres so the drill-in
  // grid colors match the overview cell-for-cell.
  //
  // Fetch with explicit range to bypass the 1000-default ceiling for
  // wider months (PDC accounts with 13 services * 31 days = 403 rows
  // - within default - but TBJ-FL with 21 services * 31 = 651, still
  // under. Paginate anyway so the year-view bug class (PostgREST cap
  // silently dropping rows) can't ever bite this path either.
  const [viewRows, billingRes, noteEntriesByDate, historyEntriesByDate] = await Promise.all([
    fetchAllPaginated(
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
    ),
    supa
      .from("accounts")
      .select("billing_model, has_homestand_schedule, has_schedule_overlay")
      .eq("team_key", accountKey)
      .maybeSingle(),
    // SC-079: one batched query for the whole month range. Returns a
    // Map keyed by service_date, values are per-day arrays already
    // ordered newest-first inside each bucket.
    readNoteEntriesForRange(accountKey, first, last),
    // F1 (M2): the actuals-history feed powering the Activity ledger's
    // EDIT rows. Same batched-by-range pattern as noteEntries.
    readHistoryEntriesForRange(accountKey, first, last),
  ]);
  throwOnError(billingRes.error, "loadMonthData.billing_model");
  const billingModel = billingRes.data?.billing_model || null;
  const hasHomestandScheduleFlag = !!billingRes.data?.has_homestand_schedule;
  const hasScheduleOverlayFlag = !!billingRes.data?.has_schedule_overlay;

  // sc-16 (2026-07-11): schedule presence is now a data-driven flag on
  // accounts, not a billing_model proxy. Gate the loadHomestandContext
  // fetch on has_homestand_schedule. The 4 MLB fee accounts + the 2
  // AAA clubs (Louisville / Buffalo) fetch; STL-FL (flat_fee, no
  // schedule) skips the query cleanly.
  let homestandMap = {};
  if (hasHomestandScheduleFlag) {
    homestandMap = await loadHomestandContext(accountKey, first, last);
  }
  const hasHomestandData = Object.keys(homestandMap).length > 0;
  // Schedule-truth doctrine (2026-07-14): PDCO overlay-only accounts
  // (STL-FL, TBJ-FL) also need day-existence from schedule. Fetch the
  // overlay so its dates can seed the day map alongside homestandMap.
  // The route.js sc-load handler still fetches overlay separately for
  // the response payload; this fetch is internal-only for materialization.
  let scheduleOverlayForMaterialize = {};
  if (hasScheduleOverlayFlag) {
    scheduleOverlayForMaterialize = await loadScheduleOverlay(accountKey, first, last);
  }
  const statusCtx = { today, lockCutoff, billingModel, hasHomestandData, homestandMap };

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

  // Schedule-truth fallback (Part 3 fix, widened 2026-07-14). For every
  // schedule-bearing account (homestand OR overlay), any date the
  // schedule says exists must materialize in days[], even when
  // sc_daily_revenue has no rows for it. Getaway AWAY dates + missing-
  // projection HOME days + PDCO overlay dates without projections all
  // stop dropping silently. Uses the shared addMissingScheduleDates
  // helper - symmetric with loadYearSummaryPostgres below.
  const scheduleDatesUnion = new Set([
    ...Object.keys(homestandMap),
    ...Object.keys(scheduleOverlayForMaterialize),
  ]);
  addMissingScheduleDates(dayBuckets, scheduleDatesUnion, (date) => ({
    date,
    period:     null,
    weekLabel:  null,
    eventLabel: null,
    gameType:   null,
    gameTime:   null,
    services:   [],
  }));

  // Build the final day array sorted by date. Compute totals + isPast/
  // isLocked per day, plus the reduced state (hasAct / anyNonZeroAct /
  // hasProj / anyNonZeroProj) classifyDayStatus needs so the drill-in
  // grid can color itself the same way the year-view heatmap does.
  // Revenue totals exclude is_non_revenue services to match
  // sc_month_summary semantics; counts include everything.
  const days = [...dayBuckets.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const ctx = dayContext(day.date, today);
      let projectedCount = 0;
      let actualCount = 0;
      let projectedRevenue = 0;
      let actualRevenue = 0;
      let hasAnyActuals = false;
      let anyNonZeroAct = false;
      let hasProj = false;
      let anyNonZeroProj = false;
      for (const s of day.services) {
        if (s.projectedCount != null) projectedCount += s.projectedCount;
        if (s.actualCount    != null) actualCount    += s.actualCount;
        if (!s.isNonRevenue) {
          // R13 round-then-sum: each per-service line rounds to 2dp
          // before being summed so day totals foot to the visible line
          // amounts in the modal + drill rail + week card.
          projectedRevenue += Math.round((s.projectedRevenue || 0) * 100) / 100;
          if (s.hasActuals) actualRevenue += Math.round((s.actualRevenue || 0) * 100) / 100;
        }
        if (s.hasActuals) hasAnyActuals = true;
        if (s.actualCount != null && Number(s.actualCount) > 0) anyNonZeroAct = true;
        if (s.hasProjection) hasProj = true;
        if (s.projectedCount != null && Number(s.projectedCount) > 0) anyNonZeroProj = true;
      }
      const status = classifyDayStatus(
        { date: day.date, hasAct: hasAnyActuals, anyNonZeroAct, hasProj, anyNonZeroProj },
        statusCtx
      );
      return {
        ...day,
        ...ctx,
        hasAnyActuals,
        // R2 (2026-07-13): day-level flags for print's resolveDayState.
        // Additive - existing consumers reading `hasAnyActuals` unchanged.
        hasActuals: hasAnyActuals,
        hasProjection: hasProj,
        status,
        totals: { projectedCount, actualCount, projectedRevenue, actualRevenue },
        // SC-079: per-day ledger, newest first. [] when the day has no
        // entries so the client can render the empty container without
        // a null-check.
        noteEntries: noteEntriesByDate.get(day.date) || [],
        // F1 (M2): actuals-edit history, newest first. Empty array when
        // the day has no historical UPDATEs (fresh saves do NOT populate
        // this by trigger design - see readHistoryEntriesForRange).
        // Phase 1 Ledger (2026-07-24 revised): the reader appends a
        // synthetic {kind: "first-entered"} row into this array for any
        // day that has actuals rows. Consumers filter on kind. Flat
        // shape restored - no separate firstEntered field.
        historyEntries: historyEntriesByDate.get(day.date) || [],
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
 *
 * opts.clientToday (YYYY-MM-DD): the operator's local today, used to
 * anchor isPast/isLocked so evening operators in CT/ET/AZ get correct
 * cell coloring. Validated upstream in the route handler; when absent
 * or invalid, the orchestrator falls back to server-local midnight.
 */
export async function loadMonthData(accountKey, year, month, opts = {}) {
  return loadMonthDataPostgres(accountKey, year, month, opts);
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
    .select("service_date, homestand_id, day_type, opponent, day_night, game_time, is_doubleheader, game_pk")
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
      // sc-15 (2026-07-11): day/night classification for HOME games,
      // sourced from MLB Stats API dayNight field at backfill time.
      // Nullable - AWAY and EXHIBITION rows carry null. Drives the
      // sun/moon glyph on MLB home cells, matching MiLB's vocabulary.
      dayNight:    r.day_night || null,
      // Ghost pill (2026-07-11): game_time is TIMESTAMPTZ UTC, formatted
      // to venue-local at render time by gameTimeFormat.js. Nullable -
      // AWAY / EXHIBITION rows keep null and no time renders.
      gameTime:    r.game_time || null,
      // sc-16 (2026-07-11): doubleheader compression flag. Drives a
      // small "DH" affix on the opponent chip when true. Defaults to
      // false on rows that predate sc-16 or aren't loader-owned.
      isDoubleheader: !!r.is_doubleheader,
      // M-0 (2026-08-04): MLB Stats API game_pk passes through so the
      // client-side derivation can use it as the block's stable key
      // (survives reschedules; the service_date does not). Nullable
      // on AWAY / EXHIBITION rows.
      gamePk:      r.game_pk || null,
    };
  }
  return map;
}


// ═══════════════════════════════════════════════════════════════
// loadScheduleOverlay (sc-17)
// ═══════════════════════════════════════════════════════════════
//
// STRICTLY informational schedule fetch for accounts that want the
// opponent chip + day/night pill on drill-in tiles WITHOUT running
// the fee-account homestand classifier (which reclassifies rowless
// dates as "off-season" and reroutes resolveDayKind - see the
// investigation doc for why that's wrong for STL - FL's daily-
// service PDC).
//
// Reads ONLY day_type='GAME' rows so no AWAY / EXHIBITION / PREP
// signal can ever bleed into the overlay. If a future migration
// accidentally inserts a non-GAME row for an overlay-flagged
// account, this select's WHERE clause silently drops it.
//
// Return shape:
//   {
//     "YYYY-MM-DD": { opponent: "SLU", dayNight: "night",
//                     gameTime: "2026-04-02T22:30:00Z", isDoubleheader: false },
//     ...
//   }
// Dates without a GAME row are absent from the map. Callers render
// the tile identically to today when the key is missing.
//
// Returns an empty object (not null) if the account has zero GAME
// rows, so callers can `Object.keys(...).length` for a truthy gate.

export async function loadScheduleOverlay(accountKey, firstDate, lastDate) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, opponent, day_night, game_time, is_doubleheader")
    .eq("account_key", accountKey)
    .eq("day_type", "GAME")
    .gte("service_date", firstDate)
    .lte("service_date", lastDate)
    .order("service_date", { ascending: true });
  throwOnError(error, "loadScheduleOverlay");

  const map = {};
  for (const r of data || []) {
    map[r.service_date] = {
      opponent:       r.opponent || "",
      dayNight:       r.day_night || null,
      gameTime:       r.game_time || null,
      isDoubleheader: !!r.is_doubleheader,
    };
  }
  return map;
}


// M-3 (2026-08-XX): closeout table readers. Live rows only for the
// year-summary status derivation; history is read on the reopen
// surface via readCloseoutHistory.
//
// homestand_key is stored as TEXT (matches how deriveHomestandSegments
// emits block.key: gamePk or startDate). Comparisons are string-based
// in-JS; callers stringify block.key at lookup time.
//
// Graceful pre-migration behavior: if sc_homestand_closeout does not
// exist yet (owner applies migrations in Studio, not on deploy), this
// helper returns []. The M-3 payload just emits every past block as
// `actuals-due` in that window, which is the honest state until the
// table is available.
async function readLiveCloseouts(accountKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("sc_homestand_closeout")
    .select("homestand_key, service_confirmed_at, confirmed_by, "
      + "labor_actual, labor_source, window_start, window_end, "
      + "budget_snapshot, notes")
    .eq("account_key", accountKey)
    .is("superseded_at", null);
  if (error) {
    if (String(error.message || "").includes("Could not find the table")) {
      return [];   // pre-migration; treat as empty
    }
    throwOnError(error, "readLiveCloseouts");
  }
  return data || [];
}

// M-3: atomic close-out write. Calls sc_confirm_closeout RPC which
// wraps supersede + insert + bulk actuals-upsert in one plpgsql
// transaction. NO BUSINESS LOGIC HERE - the route decides which days
// are exceptions, what count each service gets, and whether a
// projection is missing. This function is a thin passthrough.
//
// params:
//   accountKey        - "CIN - OH" etc
//   homestandKey      - block.key stringified (game_pk or startDate)
//   laborActual       - Number, dollars, non-negative
//   laborSource       - "manual" | "rippling_import"
//   windowStart, windowEnd - ISO date strings
//   budgetSnapshot    - Number or null (null when derivation returned
//                       null-with-reason at close-out)
//   notes             - optional
//   actualsRows       - [{ service_id, service_date, actual_count }, ...]
//   reopenReason      - null on first confirm; required on reopen
//   confirmedBy       - email
//
// Returns { closeout_id, superseded_count, actuals_written } on
// success; throws with the RPC's error message otherwise.
export async function confirmCloseout(params) {
  const supa = getServiceClient();
  const { data, error } = await supa.rpc("sc_confirm_closeout", {
    p_account_key:     params.accountKey,
    p_homestand_key:   String(params.homestandKey),
    p_labor_actual:    Number(params.laborActual),
    p_labor_source:    params.laborSource,
    p_window_start:    params.windowStart,
    p_window_end:      params.windowEnd,
    p_budget_snapshot: params.budgetSnapshot != null ? Number(params.budgetSnapshot) : null,
    p_notes:           params.notes || null,
    p_confirmed_by:    params.confirmedBy,
    p_actuals:         params.actualsRows,
    p_reopen_reason:   params.reopenReason || null,
  });
  if (error) throw new Error(`confirmCloseout: ${error.message}`);
  // supabase-js unwraps RETURNS TABLE into an array of rows; the RPC
  // yields exactly one.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    closeoutId:      row?.closeout_id || null,
    supersededCount: row?.superseded_count || 0,
    actualsWritten:  row?.actuals_written || 0,
  };
}

// Full history for one (account, homestand_key). Ordered newest-first
// by service_confirmed_at. Includes superseded rows for the reopen
// surface's "prior figure" render (H6 transparency).
export async function readCloseoutHistory(accountKey, homestandKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("sc_homestand_closeout")
    .select("id, homestand_key, service_confirmed_at, confirmed_by, "
      + "labor_actual, labor_source, window_start, window_end, "
      + "budget_snapshot, notes, superseded_at, reopened_by, reopen_reason")
    .eq("account_key", accountKey)
    .eq("homestand_key", String(homestandKey))
    .order("service_confirmed_at", { ascending: false });
  throwOnError(error, "readCloseoutHistory");
  return data || [];
}

// M-2 helpers - local date math for the homestands[] emit.
// enumerateDatesInclusive("2026-07-03", "2026-07-12") -> 10 ISO
// strings. Guards on end < start (empty array). Uses noon-anchored
// local Date to sidestep DST bumping.
function m2EnumerateDatesInclusive(startISO, endISO) {
  const out = [];
  if (!startISO || !endISO || endISO < startISO) return out;
  const start = new Date(startISO + "T12:00:00");
  const end = new Date(endISO + "T12:00:00");
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function m2AddDaysIso(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function m2SpanInclusiveDays(startISO, endISO) {
  const a = new Date(startISO + "T12:00:00");
  const b = new Date(endISO + "T12:00:00");
  return Math.round((b - a) / 86400000) + 1;
}

// Homestands payload builder (M-2 + M-3). Assembles the per-block
// payload from derived blocks + derived envelopes + a date-keyed day
// lookup + live closeout lookup. Pure function. Does NOT compute
// budgets - deriveLaborBudgets is the sole owner of that math per
// the M-1 acceptance gate.
//
// Emits per block:
//   { key, ordinal, startDate, endDate, dayCount, gameCount,
//     opponents, periodsTouched, budget, budgetReason, status,
//     servedDays, exceptionDays, meals, prepDays,
//     windowStart, windowEnd,
//     laborActual, laborSource, budgetSnapshotAtCloseout,
//     confirmedAt, confirmedBy }
//
// STATUS enum (M-3, 2026-08-XX):
//   upcoming    - block.startDate > todayIso
//   in-progress - block.startDate <= todayIso <= block.endDate
//   actuals-due - block.endDate < todayIso AND no live closeout row
//   closed-out  - live closeout row present
//
// `ended` retires. It was M-2's placeholder for the "past but no
// close-out concept yet" state; sc_homestand_closeout now gives
// that state a source table, so the enum expresses it truthfully.
//
// PREP DAYS (per scope B3): the day BEFORE the block's first game,
// plus each internal off-day inside the block span. This is a
// derived proposal - no stored adjustments. The day strip's domain
// is (startDate - 1) through endDate.
//
// WINDOW (per scope B5): from the day AFTER the previous block's
// last day through THIS block's last day. First block opens 14 days
// before its first game (season opener onboarding + training). The
// window is a labor-attribution concept for M-3 close-out and is
// carried on the payload so the surface can display the range where
// close-out lands.
//
// CLOSEOUT FIELDS (M-3): laborActual, laborSource,
// budgetSnapshotAtCloseout, confirmedAt, confirmedBy emit ONLY when
// a live closeout row exists for (accountKey, block.key). Absent
// otherwise so a healthy pre-closeout payload stays minimal.
function buildHomestandsPayload(blocks, envelopes, daysByDate, todayIso, accountKey, closeoutByKey) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  const envByKey = new Map(envelopes.map((e) => [e.key, e]));

  return blocks.map((block, i) => {
    const env = envByKey.get(block.key);
    // Closeout lookup uses the same stringified stable key as
    // sc_homestand_closeout.homestand_key stores. The derivation
    // emits block.key as game_pk (numeric) or startDate (string);
    // stringify both sides so the compare works either way.
    const closeout = closeoutByKey
      ? (closeoutByKey.get(String(block.key)) || null)
      : null;

    // Status priority chain (M-3, 2026-08-XX):
    //   1. closed-out  - a live sc_homestand_closeout row exists
    //   2. actuals-due - past block, no live closeout
    //   3. in-progress - today inside span
    //   4. upcoming    - future block
    //
    // The chain reads top-down: presence of a closeout row wins over
    // pastness. If a closeout gets reopened (superseded_at set on the
    // prior live row and no new row yet), the block falls back to
    // actuals-due because the closeoutByKey Map is built from live
    // rows only.
    let status;
    if (closeout) status = "closed-out";
    else if (block.endDate < todayIso) status = "actuals-due";
    else if (block.startDate <= todayIso && todayIso <= block.endDate) status = "in-progress";
    else status = "upcoming";

    const dayCount = m2SpanInclusiveDays(block.startDate, block.endDate);

    // Prep proposal (M-2 Round 2 owner reversal, 2026-07-29).
    //
    // The block's own boundaries are the authority. Inside
    // [block.startDate, block.endDate]:
    //   - date has a GAME record  -> game day
    //   - date has NO GAME record -> internal off-day -> prep proposal
    //
    // This is derivable from the span itself; the missing-versus-zero
    // rule governs FACTS you would need a record to know (served
    // counts, meals, labor) - not DATES the span itself defines.
    // Post-sc-13's schedule table has no PREP rows by design, which
    // is exactly why B3 is a derivation rule rather than a lookup.
    //
    // Owner ruling verified against every CIN-OH homestand: M20a
    // shows HS9 = 9 games in 10 days, 1 internal off-day, 2 prep
    // (leading + 1 internal). The rule matches that count by
    // construction.
    //
    // Leading pre-day (definitional per B3): the day BEFORE the
    // block's first game. Pushed UNLESS a record for that date shows
    // EXHIBITION (M27: exhibitions are separately billed catering).
    // AWAY does NOT block - per B5 the labor attribution window
    // includes road-trip cleaning and prep "attributed to the
    // homestand they serve"; the ballpark kitchen is prepping while
    // the team travels. AWAY on the schedule is orthogonal to
    // whether the chef is prepping.
    //
    // At M-4 the pilot widens to the TXR pair, which carries the
    // EXHIBITION rows on Mar 23-24 immediately before the opener.
    // The EXHIBITION guard here handles them without a code change
    // when M-4 lands.
    //
    // Naming note: the M-2 payload's `prepDays` is a derived
    // proposal per B3. It is a different concept from
    // `classifyDayStatus`'s `"prep"` return value at ~:314, which is
    // a per-day operational status enum used by DaySquare CSS. The
    // classifyDayStatus prep path is dormant post-sc-13 (no PREP-
    // typed schedule rows exist in the DB anymore). B3 derivation
    // is authoritative for the M-2 surface.
    const prepDays = [];
    const leadingIso = m2AddDaysIso(block.startDate, -1);
    const leadingRec = daysByDate.get(leadingIso);
    const leadingBlocked = leadingRec && leadingRec.dayType === "EXHIBITION";
    if (!leadingBlocked) prepDays.push(leadingIso);

    // Internal walk. Every date inside [startDate, endDate] with no
    // GAME record is definitionally an internal off-day and becomes
    // a prep proposal. Count games in the span so we can enforce the
    // invariant below.
    let gamesInSpan = 0;
    let internalOffInSpan = 0;
    for (const iso of m2EnumerateDatesInclusive(block.startDate, block.endDate)) {
      const d = daysByDate.get(iso);
      if (d && d.dayType === "GAME") {
        gamesInSpan++;
      } else {
        internalOffInSpan++;
        prepDays.push(iso);
      }
    }

    // Invariant (owner ruling, trap §11.2 vanishing schedule days):
    // within a block span, `block.gameCount === gamesInSpan` AND
    // `gamesInSpan + internalOffInSpan === dayCount` MUST hold by
    // construction. deriveHomestandSegments and this walk read the
    // same daysByMonth feed, so a mismatch means a GAME row went
    // missing between the two walks - the exact class of silent-
    // defect trap §11.2 exists to catch. Surface it (server log +
    // payload flag) rather than silently absorb into prep.
    const gameCountMatches = gamesInSpan === (block.gameCount || 0);
    const spanBalances = gamesInSpan + internalOffInSpan === dayCount;
    const hasScheduleGap = !(gameCountMatches && spanBalances);
    if (hasScheduleGap) {
      // eslint-disable-next-line no-console
      console.warn(
        `[buildHomestandsPayload] invariant fail: ${accountKey} ${block.homestandId} `
        + `${block.startDate}..${block.endDate}: `
        + `derivation gameCount=${block.gameCount}, gamesInSpan=${gamesInSpan}, `
        + `internalOff=${internalOffInSpan}, dayCount=${dayCount}. `
        + `Vanishing GAME row (trap §11.2).`
      );
    }

    // Served / exception / meals from the day records inside the
    // block span. GAME rows only - AWAY / EXHIBITION rows never
    // appear inside a block (the derivation splits on AWAY, and
    // EXHIBITION is excluded upstream).
    let servedDays = 0;
    let exceptionDays = 0;
    let meals = 0;
    for (const iso of m2EnumerateDatesInclusive(block.startDate, block.endDate)) {
      const d = daysByDate.get(iso);
      if (!d) continue;
      if (d.dayType !== "GAME") continue;
      if (d.status === "entered") servedDays += 1;
      if (d.status === "no-service") exceptionDays += 1;
      if (d.actualMeals != null) meals += Number(d.actualMeals) || 0;
    }

    // Attribution window (B5). First block: 14 days before first
    // game (season opener onboarding + training). Every other
    // block: day after previous block's endDate.
    const prevBlock = i > 0 ? blocks[i - 1] : null;
    const windowStart = prevBlock
      ? m2AddDaysIso(prevBlock.endDate, 1)
      : m2AddDaysIso(block.startDate, -14);
    const windowEnd = block.endDate;

    // Budget flatten. Missing budget row -> null with reason so the
    // surface can render an honest "no budget yet" state instead of
    // "$0" (the missing-vs-zero rule). Present budget carries amount
    // + cents (for reconciliation) + per-period breakdown.
    let budget = null;
    let budgetReason = null;
    if (env) {
      if (env.envelope != null) {
        budget = {
          amount: env.envelope,
          cents: env.envelopeCents,
          breakdown: env.breakdown,
        };
      } else {
        budgetReason = env.reason || null;
      }
    }

    return {
      key: block.key,
      ordinal: block.homestandId,
      startDate: block.startDate,
      endDate: block.endDate,
      dayCount,
      gameCount: block.gameCount,
      opponents: block.opponents,
      periodsTouched: env ? env.periodsTouched : [],
      budget,
      budgetReason,
      status,
      servedDays,
      exceptionDays,
      meals,
      prepDays,
      windowStart,
      windowEnd,
      // hasScheduleGap flips to true when the invariant
      //   block.gameCount === gamesInSpan
      //   AND gamesInSpan + internalOffInSpan === dayCount
      // fails. Under normal operation this stays false; a true value
      // means a GAME row went missing between deriveHomestandSegments
      // and this walk (trap §11.2). Server also logged a warning;
      // this field lets the client surface a UI hint if wanted. Only
      // emitted when true so a healthy payload stays minimal.
      ...(hasScheduleGap ? { hasScheduleGap: true } : {}),
      // M-3 closeout fields emit ONLY when a live closeout row
      // exists. Absent otherwise so a fresh block stays minimal. The
      // budget_snapshot at close-out is preserved verbatim - a later
      // sc_labor_budgets edit does NOT rewrite closed variance.
      ...(closeout ? {
        laborActual: Number(closeout.labor_actual),
        laborSource: closeout.labor_source,
        budgetSnapshotAtCloseout: closeout.budget_snapshot != null
          ? Number(closeout.budget_snapshot)
          : null,
        confirmedAt: closeout.service_confirmed_at,
        confirmedBy: closeout.confirmed_by,
      } : {}),
    };
  });
}

async function loadYearSummaryPostgres(accountKey, year, opts = {}) {
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
  // sc-16 (2026-07-11): schedule-presence is now a separate flag; read
  // it in the same query.
  const billingRes = await supa
    .from("accounts")
    .select("billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  throwOnError(billingRes.error, "loadYearSummary.billing_model");
  const billingModel = billingRes.data?.billing_model || null;
  const hasHomestandScheduleFlag = !!billingRes.data?.has_homestand_schedule;
  const hasScheduleOverlayFlag = !!billingRes.data?.has_schedule_overlay;

  // sc-16 (2026-07-11): gate on the flag rather than the billing model
  // proxy. Louisville / Buffalo pick up schedule context here even
  // though their billing_model = 'actuals_drive_invoice'.
  let homestandMap = {};
  if (hasHomestandScheduleFlag) {
    homestandMap = await loadHomestandContext(accountKey, first, last);
  }
  const hasHomestandData = Object.keys(homestandMap).length > 0;

  // sc-18 (2026-07-12): year-scoped overlay presence for the game-day
  // wedge on sm overview tiles. Fetches GAME rows across the whole
  // year range in one query and reduces to a Set of dates - the sm
  // render only needs presence (boolean per date), not opponent /
  // time / DH flag. Purely additive: the year-summary payload gains
  // a `hasScheduleGame` boolean on each day, wired through by the
  // daysByMonth loop below. Overlay-flagged accounts only; other
  // accounts skip the query entirely.
  let scheduleOverlayDates = null;
  if (hasScheduleOverlayFlag) {
    const overlay = await loadScheduleOverlay(accountKey, first, last);
    if (Object.keys(overlay).length > 0) {
      scheduleOverlayDates = new Set(Object.keys(overlay));
    }
  }

  // P2 (item 3, R3, 2026-07-10): dates with at least one authored NOTE
  // entry in the year. Feeds the DaySquare bubble on sm tiles (year
  // grid + PeriodCard rail) - lg drill-in tiles already have
  // day.noteEntries via loadMonth, so this is the parity path for the
  // overview surfaces. NOTE-only per Kevin's Q-b ruling; history rows
  // (from sc_daily_actuals_history) never count here.
  const noteDates = await readNoteDatesInRange(accountKey, first, last);

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
  const today = buildTodayAnchor(opts.clientToday);
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

  // Schedule-truth fallback (widened 2026-07-14). Symmetric with
  // loadMonthDataPostgres via the shared addMissingScheduleDates helper -
  // day-existence for schedule-bearing accounts derives from schedule/
  // overlay truth, never from revenue-row presence. Scoped to homestand
  // OR overlay dates so AAA per-meal and PDCO overlay-only accounts get
  // the same lag-tolerance MLB fee already had.
  const yearScheduleDatesUnion = new Set([
    ...Object.keys(homestandMap),
    ...(scheduleOverlayDates || []),
  ]);
  addMissingScheduleDates(dayState, yearScheduleDatesUnion, (date) => ({
    date,
    hasAct: false,
    anyNonZeroAct: false,
    hasProj: false,
    anyNonZeroProj: false,
    gameType: "",
  }));

  const statusCtx = { today, lockCutoff, billingModel, hasHomestandData, homestandMap };

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
      status:      classifyDayStatus(s, statusCtx),
      gameType:    s.gameType || "",
      actualMeals: s.actualMeals || 0,
      // P2 (item 3): NOTE-only note indicator. Boolean rather than
      // count so the payload stays compact - the tile only needs
      // "has any" for the bubble render.
      hasNoteEntries: noteDates.has(s.date),
      // R2 (2026-07-13): day-level flags for print's resolveDayState +
      // ops-calendar variant. Additive - screen consumers unaffected.
      hasActuals:    !!s.hasAct,
      hasProjection: !!s.hasProj,
    };
    const hs = homestandMap[s.date];
    if (hs) {
      dayEntry.homestandId = hs.homestandId;
      dayEntry.dayType     = hs.dayType;
      dayEntry.opponent    = hs.opponent;
      // sc-15 (2026-07-11): dayNight passes through so the render
      // path can drive the sun/moon glyph without a second DB call.
      dayEntry.dayNight    = hs.dayNight;
      // Ghost pill (2026-07-11): raw UTC first-pitch. Formatted to
      // venue-local by the render path via gameTimeFormat.js.
      dayEntry.gameTime    = hs.gameTime;
      // sc-16 (2026-07-11): DH affix flag passes through so the
      // renderer can decorate the opponent chip.
      dayEntry.isDoubleheader = hs.isDoubleheader;
      // M-0 (2026-08-04): gamePk is the block's stable key across
      // reschedules. Nullable - AWAY / EXHIBITION rows keep null.
      dayEntry.gamePk = hs.gamePk;
    }
    // sc-18 (2026-07-12): boolean-per-date overlay presence for the
    // sm-tile game-day wedge. Purely presentational; never touches
    // classify/kind/counters. Non-overlay accounts pass through with
    // no field set (undefined -> the sm renderer treats as false).
    //
    // V3 §7.5 (2026-07-19): extended to HOMESTAND-schedule accounts
    // (CIN - KY, TBJ - NY, and the 4 MLB fee accounts) so their HOME
    // game days emit the same field. The v2 DaySquare converts
    // `hasScheduleGame: true` into the `sc-daysq--home` class + the
    // year-zoom filled navy dot per §7.5. Homestand accounts already
    // emit AWAY days via the `status === "away"` classification path
    // (unchanged); the missing side was home-day emission.
    //
    // Signal source: `hs.dayType === "GAME"` is a HOME game (fee
    // classify branch at line 267 already treats it as home). AWAY
    // days flow through `hs.dayType === "AWAY"` and are handled by
    // the existing status path - no change to that emit.
    //
    // Guards: field is read-only, purely presentational (no classify
    // / counter / write-path change). Legacy consumers pass through
    // untouched (undefined -> false in the sm renderer). v1 CSS
    // doesn't key on `--home`, so flag-off is inert.
    const isOverlayGame = scheduleOverlayDates && scheduleOverlayDates.has(s.date);
    const isHomestandHomeGame = hs?.dayType === "GAME";
    if (isOverlayGame || isHomestandHomeGame) {
      dayEntry.hasScheduleGame = true;
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
    // M-0 (2026-08-04): for MLB accounts (DERIVE_HOMESTANDS_ACCOUNTS),
    // homestandIds per month is DERIVED from GAME/AWAY blocks scoped
    // to that month, not from stored homestand_id. STL-FL falls through
    // the derivation (not in the set → []) and lands on the pre-M-0
    // stored-id path below, which for STL-FL returns [] too (stored
    // ids are empty on its overlay rows). Same effective output.
    const isDerivedAccount = DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey);
    // Build the derive input from daysByMonth (same shape yearData has
    // client-side). One derivation covers the whole year; per-month
    // slices come from overlap filtering below.
    let derivedBlocks = [];
    if (isDerivedAccount) {
      const yearDataForDerive = [...daysByMonth.entries()].map(
        ([month, days]) => ({ month, days })
      );
      // M-2 Rider 5 (2026-07-29 owner ruling): the M-0 UTC twin. Same
      // one-line defect as :1687 - `today.toISOString().slice(0, 10)`
      // re-applies UTC and, in Cincinnati (UTC-4), flips block status
      // a day early after 8pm local. This site sets `status` on the
      // homestand strip for all four MLB accounts and ships in
      // production today; leaving it in place to protect the
      // per-M-2 rider cap was the wrong trade.
      //
      // The shared `todayStr` at ~:1674 is declared LATER in this
      // function and is not in scope here (owner authorized a local
      // computation rather than restructuring the function to reach
      // it). Same clientToday-aware pattern, verbatim.
      const todayIso = opts.clientToday && /^\d{4}-\d{2}-\d{2}$/.test(opts.clientToday)
        ? opts.clientToday
        : today.toISOString().slice(0, 10);
      derivedBlocks = deriveHomestandSegments(yearDataForDerive, todayIso, { accountKey });
    }
    const useDerived = isDerivedAccount && derivedBlocks.length > 0;

    for (const [monthKey, days] of daysByMonth.entries()) {
      let gameDays = 0, gameDaysEntered = 0, prepDays = 0;
      const storedIds = new Set();
      for (const d of days) {
        // sc-12 (2026-07-10): EXHIBITION rows are billed outside the
        // contract and must not inflate the month rollups. Skip before
        // the prep-day and homestand-id accumulation so March for TXR
        // still reads as Spring Training (noService), and month cards
        // never surface "1 homestand" for an EXH-only month.
        // sc-13 (2026-07-10): AWAY rows are display-only (team on the
        // road). Same exclusion - never inflates the "N homestand(s)"
        // footer or the prep count. homestand_id is NULL for AWAY so
        // the Set add below is defensive.
        if (d.dayType === "EXHIBITION" || d.dayType === "AWAY") continue;
        if (d.dayType === "GAME") {
          gameDays++;
          // P1 item 4 (2026-07-10): unified completeness rule across
          // every surface - `entered` OR `no-service`. Homestand-game
          // days classify as `entered` on any actuals write (SC-078),
          // so the widening is defensive here (no live count change)
          // but keeps this predicate identical to the workspace's
          // aggregateWorkspaceMetrics and MonthCard/PeriodCard readers.
          if (d.status === "entered" || d.status === "no-service") gameDaysEntered++;
        } else if (d.dayType) {
          prepDays++;
        }
        if (!useDerived && d.homestandId) storedIds.add(d.homestandId);
      }
      let homestandIds;
      if (useDerived) {
        // Month bounds are string-comparable ISO dates. "2026-07-31"
        // is a safe upper bound for July (any real date "2026-07-DD"
        // sorts <= it, and August dates sort > it).
        const monthStart = `${monthKey}-01`;
        const monthEnd = `${monthKey}-31`;
        const overlapping = derivedBlocks.filter(b =>
          b.startDate <= monthEnd && b.endDate >= monthStart
        );
        homestandIds = overlapping.map(b => b.homestandId);
      } else {
        homestandIds = [...storedIds].sort((a, b) => {
          // Sort HS1, HS2, ... numerically rather than lexicographically
          // so HS10 doesn't sort before HS2.
          const na = parseInt(String(a).replace(/[^0-9]/g, ""), 10) || 0;
          const nb = parseInt(String(b).replace(/[^0-9]/g, ""), 10) || 0;
          return na - nb;
        });
      }
      homestandSummaryByMonth.set(monthKey, {
        gameDays,
        gameDaysEntered,
        prepDays,
        homestandIds,
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
  //
  // When the client sent its local today, emit that verbatim so the
  // string surfaced to the UI matches the operator's calendar day (no
  // .toISOString round-trip - that would re-apply UTC and undo the fix).
  const todayStr = opts.clientToday && /^\d{4}-\d{2}-\d{2}$/.test(opts.clientToday)
    ? opts.clientToday
    : today.toISOString().slice(0, 10);
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

  // Period ranges for the Period lens (PR-B2). Walks sc_day_metadata
  // for the year and aggregates per-period { start, end } in JS -
  // PostgREST doesn't expose MIN/MAX/GROUP BY ergonomically through
  // the client, but ~30 rows per query is negligible.
  const periodRangesRes = await supa
    .from("sc_day_metadata")
    .select("period, service_date")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .not("period", "is", null)
    .order("service_date", { ascending: true });
  throwOnError(periodRangesRes.error, "loadYearSummary.period_ranges");
  const periodRangeMap = new Map();
  for (const r of periodRangesRes.data || []) {
    const cur = periodRangeMap.get(r.period);
    if (!cur) periodRangeMap.set(r.period, { period: r.period, start: r.service_date, end: r.service_date });
    else if (r.service_date > cur.end) cur.end = r.service_date;
  }
  const periodRanges = [...periodRangeMap.values()];

  // M-2 (2026-07-29): homestand detail payload.
  //
  // Emit gate is MLB_HOMESTAND_SURFACE_ACCOUNTS (all four MLB as of
  // M-4a; was CIN - OH only at M-2), NOT DERIVE_HOMESTANDS_ACCOUNTS.
  // The derivation feeds homestandSummaryByMonth for all four MLB
  // accounts above; the top-level homestands[] emit is surface-set
  // gated. This preserves the pre-M-2 payload byte-identically for
  // every non-MLB account (Fences 1-4). The MLB surface set gains
  // three accounts at M-4a (STL - MO, TXR - TX - H, TXR - TX - V);
  // Fence 5 becomes "they gain the homestand surface and nothing
  // else changes."
  //
  // The `homestands` key is ABSENT from the response for non-pilot
  // accounts, not [] and not null. Mirrors the pattern at :1435 for
  // homestandSummary and matches the response-shape guarantee the
  // fence rests on.
  //
  // salary_budget and revenue_forecast are stripped at this boundary
  // per owner ruling ("must never cross the network boundary. Strip
  // it server-side in the handler, not in the client"). The projected
  // rows carry only period + hourly_budget - the fields deriveLaborBudgets
  // reads and nothing else.
  let m2Homestands;
  let m4bPeriodBudgets;
  if (MLB_HOMESTAND_SURFACE_ACCOUNTS.has(accountKey)) {
    // Re-derive rather than close over the derivedBlocks scoped inside
    // the outer flat_fee+hasHomestandData branch above. Pure function,
    // ~13-block computation, cost negligible. Keeps the pre-M-2 code
    // path in that branch unchanged.
    const yearDataForDerive = [...daysByMonth.entries()].map(
      ([month, days]) => ({ month, days })
    );
    // M-2 defect 1 fix (2026-07-29 owner ruling): use the todayStr
    // that already respects opts.clientToday (built at :1622 above),
    // NEVER `today.toISOString().slice(0, 10)` - that re-applies UTC
    // and, in Cincinnati (UTC-4), flips every past-8pm-local block
    // from `in-progress` to `ended` a day early. Trap §10.12 and the
    // exact failure the clientToday parameter exists to prevent. The
    // pre-M-2 fee-account derivation at :1521 has the same latent
    // bug; NOT fixed here (outside M-2 scope) but flagged in the
    // build report.
    const m2Blocks = deriveHomestandSegments(yearDataForDerive, todayStr, { accountKey });

    if (m2Blocks.length > 0) {
      // Read live budgets and STRIP admin + reporting fields at the
      // boundary. Only period + hourly_budget cross the wire.
      const rawBudgets = await readLiveLaborBudgets(accountKey);
      const strippedBudgets = rawBudgets.map((r) => ({
        period: r.period,
        hourly_budget: r.hourly_budget,
      }));

      // M-4b (2026-07-30): also expose the stripped budgets to the
      // client so PeriodCard can render "Budget: $X" and MonthCard can
      // name "Draws from P6 + P7" without re-reading sc_labor_budgets
      // from the client. Same array deriveLaborBudgets reads below;
      // no new server call.
      m4bPeriodBudgets = strippedBudgets;

      const envelopes = deriveLaborBudgets(m2Blocks, strippedBudgets, periodRanges, {
        accountKey,
        // laborRatio + soldRevenueByBlockKey deliberately omitted.
        // Revenue-flex is M-5 (TXR-V). CIN-OH pilot has neither.
      });

      // Flatten daysByMonth into a date-keyed lookup for per-block
      // prep / served / exception / meal accumulation. Same day
      // records already assembled above; no re-query.
      const daysByDate = new Map();
      for (const [, days] of daysByMonth.entries()) {
        for (const d of days) daysByDate.set(d.date, d);
      }

      // M-3 (2026-08-XX): live closeout rows for the priority chain
      // in buildHomestandsPayload's status derivation. Keyed by
      // homestand_key stringified so game_pk (numeric) and startDate
      // (string) both look up cleanly.
      const closeouts = await readLiveCloseouts(accountKey);
      const closeoutByKey = new Map();
      for (const c of closeouts) {
        closeoutByKey.set(String(c.homestand_key), c);
      }

      // M-2 defect 1 fix (2026-07-29): same today string used for the
      // derivation status derivation. See :1522-1531 for why.
      m2Homestands = buildHomestandsPayload(
        m2Blocks, envelopes, daysByDate, todayStr, accountKey, closeoutByKey
      );
    } else {
      // Derivation returned [] (self-guard tripped or no AWAY rows
      // in this year's stream). Do NOT emit a stub - a surface
      // consumer treats presence-with-empty as "0 homestands", which
      // is a lie during regular season. Same discipline as the M-0
      // "empty is honest, one giant block is a lie" rule.
      m2Homestands = undefined;
    }
  }

  return {
    year: Number(year),
    months,
    today: todayBlock,
    periodRanges,
    ...(m2Homestands ? { homestands: m2Homestands } : {}),
    ...(m4bPeriodBudgets ? { periodBudgets: m4bPeriodBudgets } : {}),
  };
}

/**
 * Read 12-month aggregate + per-day status for the year heatmap.
 * Backed by sc_month_summary + sc_daily_revenue views.
 *
 * opts.clientToday (YYYY-MM-DD): the operator's local today, used as
 * the classify() boundary AND as the emitted summary.today so the
 * year-grid ring, the cell colors, and the period/week chips all agree
 * on the operator's actual calendar day. Validated upstream; absent or
 * invalid -> server-local midnight (UTC on Vercel) fallback.
 */
export async function loadYearSummary(accountKey, year, opts = {}) {
  return loadYearSummaryPostgres(accountKey, year, opts);
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
// SC-079: append-only day-note ledger
// ═══════════════════════════════════════════════════════════════
//
// The pre-Round-3 shape upserted a single-column TEXT `notes` on
// sc_day_metadata that got overwritten on every save. Owner review
// flagged the accountability gap (no author, no history). This ships
// an append-only entry table (see sc-9-day-note-entries.sql) that the
// UI reads as a per-day ledger, newest first.
//
// author is server-derived from the session on INSERT - never accept
// a client-supplied author. The saveDayNotes function from #361 is
// replaced by addDayNoteEntry (single entry per call) plus a batched
// month reader.

// addDayNoteEntry - one authored entry against sc_day_note_entries.
// Returns the inserted row so the client can prepend optimistically.
export async function addDayNoteEntry(accountKey, serviceDate, note, author) {
  const supa = getServiceClient();
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (!trimmed) {
    return { success: false, error: "note required" };
  }
  const { data, error } = await supa
    .from(SC_TABLES.noteEntries)
    .insert({
      account_key:  accountKey,
      service_date: serviceDate,
      note:         trimmed,
      author:       author || null,
    })
    .select("id, note, author, created_at")
    .single();
  throwOnError(error, "addDayNoteEntry.insert");
  return {
    success: true,
    entry: {
      id:        data.id,
      note:      data.note,
      author:    data.author,
      createdAt: data.created_at,
    },
  };
}

// readHistoryEntriesForRange - one query for a whole month range,
// keyed by service_date so the month loader can attach per-day arrays
// in a single pass. Ordered by (service_date, changed_at DESC) so the
// per-day arrays land newest-first inside each bucket without a
// second sort. Service name resolution comes from a parallel
// sc_services fetch (no deleted_at filter - archived/hard-deleted
// services still surface their name in the audit trail).
//
// Coverage: the sc_daily_actuals_audit trigger fires only on UPDATE
// (WHEN old_count IS DISTINCT FROM new_count). First INSERTs produce
// NO history row by design; the originating sc_daily_actuals row
// carries created_by + created_at + initial actual_count instead.
// See sc-1-service-calendar-schema.sql:263-268.
export async function readHistoryEntriesForRange(accountKey, first, last) {
  const supa = getServiceClient();
  // Phase 1 Ledger (2026-07-24, revised per owner Q1 ruling): parallel
  // query for "first entered" synthesis. The audit trigger deliberately
  // skips INSERT (per :1579-1583 above), so a day entered once and never
  // edited has NO history rows even though it's the operator's most-
  // asked Ledger question ("who entered this day?"). Server synthesis
  // from sc_daily_actuals.created_by/created_at fills that gap.
  //
  // NOT NULL columns (sc-1-service-calendar-schema.sql:207-208), no
  // legacy null concern. Owner ruling: no schema change - synthesized.
  //
  // Transport shape: the synthesized row is APPENDED into historyEntries
  // with a discriminator {kind: "first-entered"} so BOTH consumers
  // (v1 mergeActivity, v2 groupActivity) receive it through the same
  // channel. Return shape stays flat: Map<date, [historyRow]>.
  //
  // Discriminator (not just null values) so the mark-no-service collapse
  // {every(newValue === 0), length > 1} in mergeActivity/groupActivity
  // cannot silently absorb a synthetic row that happens to have
  // null newValue (Number(null) === 0).
  const [historyRows, servicesRes, actualsCreationRows] = await Promise.all([
    fetchAllPaginated(
      supa,
      (q) => q
        .from("sc_daily_actuals_history")
        // sc-25 (2026-08-01): change_type distinguishes update rows
        // from delete rows. groupActivity groups delete rows into a
        // single "reset" ledger entry; without this column a reset
        // would collapse into the mark-no-service `allZero` branch
        // because delete rows carry new_count = 0 by convention.
        .select("service_date, service_id, old_count, new_count, changed_by, changed_at, change_type")
        .eq("account_key", accountKey)
        .gte("service_date", first)
        .lte("service_date", last)
        .order("service_date", { ascending: true })
        .order("changed_at",   { ascending: false })
        .order("service_id",   { ascending: true }),
      "readHistoryEntriesForRange.history"
    ),
    supa
      .from("sc_services")
      .select("id, service_name")
      .eq("account_key", accountKey),
    // First-entered source: (created_by, created_at) per row in the
    // range. Client aggregates to MIN(created_at) per date. Doing the
    // aggregate client-side rather than a PostgREST rpc keeps this a
    // single .select() call - same shape as the other reads here.
    fetchAllPaginated(
      supa,
      (q) => q
        .from("sc_daily_actuals")
        .select("service_date, created_by, created_at")
        .eq("account_key", accountKey)
        .gte("service_date", first)
        .lte("service_date", last),
      "readHistoryEntriesForRange.actualsCreation"
    ),
  ]);
  throwOnError(servicesRes.error, "readHistoryEntriesForRange.services");
  const svcNameById = new Map();
  for (const s of servicesRes.data || []) svcNameById.set(s.id, s.service_name);
  // First-entered aggregate: earliest created_at per date, with its author.
  const firstEnteredByDate = new Map();
  for (const r of actualsCreationRows || []) {
    const existing = firstEnteredByDate.get(r.service_date);
    if (!existing || r.created_at < existing.createdAt) {
      firstEnteredByDate.set(r.service_date, {
        createdAt: r.created_at,
        createdBy: r.created_by,
      });
    }
  }
  const byDate = new Map();
  for (const r of historyRows || []) {
    if (!byDate.has(r.service_date)) byDate.set(r.service_date, []);
    byDate.get(r.service_date).push({
      serviceId:   r.service_id,
      serviceName: svcNameById.get(r.service_id) || "(archived service)",
      oldValue:    Number(r.old_count),
      newValue:    Number(r.new_count),
      author:      r.changed_by || null,
      changedAt:   r.changed_at,
      // sc-25: 'update' | 'delete'. Default null on backfilled rows
      // written before sc-25 landed (nothing wrote deletes before the
      // trigger existed, so null-here == 'update'-in-practice).
      changeType:  r.change_type || null,
    });
  }
  // Append the synthetic first-entered row per date. changedAt = the
  // earliest actuals.created_at for that date, so newest-first sort in
  // mergeActivity/groupActivity naturally places it last. Consumers
  // recognize it by `kind` and route around the bucketing loop.
  for (const [date, first] of firstEnteredByDate.entries()) {
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      kind:        "first-entered",
      serviceId:   null,
      serviceName: null,
      oldValue:    null,
      newValue:    null,
      author:      first.createdBy,
      changedAt:   first.createdAt,
    });
  }
  return byDate;
}

// P2 (item 3, R3, 2026-07-10): dates-only lookup used by the year-
// summary loader to flag which days carry at least one NOTE entry
// for the DaySquare bubble on overview + PeriodCard sm tiles.
// Cheaper than readNoteEntriesForRange (no body/author/timestamp
// payload; PostgREST returns just service_date, dedup on the client).
//
// Paginated via fetchAllPaginated because PostgREST caps a bare
// .select() at its configured max-rows (1000 by default) and a
// silent truncation would drop bubble signals for later dates in
// an active year - the same failure class the daysRows loader
// upstream (~:949) already handles. Order by service_date so the
// pagination cursor is deterministic; the Set dedup below collapses
// multi-note-same-date rows unchanged.
export async function readNoteDatesInRange(accountKey, first, last) {
  const supa = getServiceClient();
  const rows = await fetchAllPaginated(
    supa,
    (q) => q
      .from(SC_TABLES.noteEntries)
      .select("service_date")
      .eq("account_key", accountKey)
      .gte("service_date", first)
      .lte("service_date", last)
      .order("service_date", { ascending: true }),
    "readNoteDatesInRange"
  );
  const set = new Set();
  for (const r of rows) set.add(r.service_date);
  return set;
}

// readNoteEntriesForRange - one query for a whole month range, keyed
// by service_date so the month loader can attach per-day arrays in a
// single pass. Ordered by (service_date, created_at DESC) so the
// per-day arrays land newest-first inside each bucket without a
// second sort.
export async function readNoteEntriesForRange(accountKey, first, last) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from(SC_TABLES.noteEntries)
    .select("service_date, note, author, created_at")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .order("service_date", { ascending: true })
    .order("created_at",   { ascending: false });
  throwOnError(error, "readNoteEntriesForRange");
  const byDate = new Map();
  for (const r of data || []) {
    if (!byDate.has(r.service_date)) byDate.set(r.service_date, []);
    byDate.get(r.service_date).push({
      note:      r.note,
      author:    r.author,
      createdAt: r.created_at,
    });
  }
  return byDate;
}


// ═══════════════════════════════════════════════════════════════
// readSavedDayTotals - post-write revenue + meals for one (account, day)
// ═══════════════════════════════════════════════════════════════
//
// Reads sc_daily_revenue AFTER the write so the toast displays what
// actual_revenue will show on the next month reload. Effective-dated
// prices (view's LATERAL join on sc_service_prices) - same source as
// the day tile + week card + drill rail. Non-revenue services excluded
// from the revenue sum (matches loadMonthDataPostgres line 734-737 +
// sc_month_summary semantics); counts include everything.
export async function readSavedDayTotals(accountKey, serviceDate) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("sc_daily_revenue")
    .select("actual_count, actual_revenue, is_non_revenue, has_actuals")
    .eq("account_key",  accountKey)
    .eq("service_date", serviceDate);
  throwOnError(error, "readSavedDayTotals");
  let meals = 0;
  let revenue = 0;
  for (const r of data || []) {
    if (!r.has_actuals) continue;
    meals += Number(r.actual_count) || 0;
    // R13 round-then-sum: each per-service line rounds to 2dp before
    // being summed so the toast foots to the lines the operator sees
    // in the modal. The view returns exact products (actual_count *
    // price with sub-cent price precision); sum-then-round drifts a
    // penny on rates like $12.895 / $17.8275.
    if (!r.is_non_revenue) revenue += Math.round((Number(r.actual_revenue) || 0) * 100) / 100;
  }
  return { meals, revenue };
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

// Fee-eligible per_meal accounts. Some PDCs bill a contract service
// fee alongside per-meal revenue. Kevin ruling 2026-07-12: CIN - AZ
// (Goodyear PDC, actuals_drive_invoice) is the current instance -
// widened here so the admin surface + fee history + fee writes work
// exactly like a flat_fee account, while the calendar tile render
// stays per-meal and the actionable-day counters stay per-meal.
//
// Why here vs a boolean flag on `accounts`: the sc-16/17 two-flag
// precedent is about schedule loading BEHAVIOR (which loader runs,
// which classification path fires). This is about admin-surface
// VISIBILITY. Migration cost is real; the list is short and
// self-documenting. Add another team_key here if a future per_meal
// account also bills a fee.
const FEE_ELIGIBLE_PER_MEAL = ["CIN - AZ"];

async function loadFeeSchedulePostgres() {
  const supa = getServiceClient();
  const today = isoDay(new Date());

  // Read ALL active accounts + filter in JS to the union
  // (billing_model === 'flat_fee') OR (team_key in the eligible-
  // per_meal list). Table is small (~11 rows today) so the JS
  // filter beats the PostgREST .or() quoting gymnastics required
  // to inline team keys with spaces.
  const accountsRes = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model")
    .eq("active", true)
    .order("team_key", { ascending: true });
  throwOnError(accountsRes.error, "loadFeeSchedule.accounts");

  const feeManagedAccounts = (accountsRes.data || []).filter(
    (a) => a.billing_model === "flat_fee" || FEE_ELIGIBLE_PER_MEAL.includes(a.team_key)
  );

  const accountKeys = feeManagedAccounts.map((a) => a.team_key);
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

  const fees = feeManagedAccounts.map((a) => ({
    accountKey:  a.team_key,
    name:        a.name || a.team_key,
    level:       a.level || null,
    current:     shape(currentByKey.get(a.team_key)),
    upcoming:    shape(upcomingByKey.get(a.team_key)),
  }));

  return { generatedAt: today, fees };
}

/**
 * Read the fee schedule for all fee-managed accounts (all flat_fee
 * accounts + the fee-eligible per_meal accounts listed in
 * `FEE_ELIGIBLE_PER_MEAL`): current as-of-today row + next upcoming
 * change per account. Powers the admin Fee
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
