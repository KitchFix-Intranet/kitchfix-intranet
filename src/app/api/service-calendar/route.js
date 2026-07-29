import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { isScAdmin } from "@/lib/admin";
import {
  loadAccountConfig,
  loadAllAccountsConfig,
  loadMonthData,
  loadYearSummary,
  loadHomestandContext,
  loadScheduleOverlay,
  saveActuals,
  addDayNoteEntry,
  readSavedDayTotals,
  saveBulkActuals,
  updateServiceConfig,
  submitConfigRequest,
  loadFeeSchedule,
  loadFeeAccountHistory,
  updateFeeSchedule,
  archiveService,
  reactivateService,
  archiveServiceGroup,
  reactivateServiceGroup,
  addServiceWithAudit,
  addServiceGroup,
  // M-3 (2026-08-XX): homestand close-out. Route decides exceptions
  // + missing-projection guard; confirmCloseout is the RPC wrapper.
  confirmCloseout,
  readCloseoutHistory,
} from "@/lib/dataStore/serviceCalendar";
// M-1 (2026-08-09): labor budget plane. MLB-only via the
// DERIVE_HOMESTANDS_ACCOUNTS set from M-0 - matched at the API layer
// so a non-MLB accountKey is rejected before touching the dataStore.
import {
  readLiveLaborBudgets,
  readLaborBudgetHistory,
  updateLaborBudget,
  readLaborRatio,
  updateLaborRatio,
  readLaborRatioHistory,
} from "@/lib/dataStore/laborBudgets";
import { DERIVE_HOMESTANDS_ACCOUNTS } from "@/app/service-calendar/season/homestandDerivation";

// SHEETS REMOVED - PG orchestrator now handles all reads/writes.
// Imports preserved (commented) so a rollback during shadow validation
// is a one-uncomment, route-revert operation.
// import { readSheetSA, appendRowSA, appendRowsSA, updateRangeSA, SHEET_IDS } from "@/lib/sheets";

// ═══════════════════════════════════════════════════════════════════
// SERVICE CALENDAR API (PG-backed)
// ═══════════════════════════════════════════════════════════════════
//
// Reads: getServiceClient (Postgres) via the serviceCalendar dataStore.
// Writes: the orchestrator's upsert paths into sc_* tables. PG is the
// canonical source from import day; there is no Sheets fallback.
//
// JSON SHAPES are preserved verbatim from the prior Sheets-based route
// so the calendar UI (ServiceCalendar.js, DayDetail.js) reads the same
// field names. The mapping happens at this layer. (The pre-Stage-2
// ServiceConfig.js admin component was retired in PR #209; modern
// admin paths live under src/app/service-calendar/admin/.)
//
// colIndex CONVENTION
//   The legacy route used Sheets column numbers for `colIndex` as the
//   per-service key in projected/actual maps and POST payloads. The
//   PG-backed route puts the service UUID in that slot. The UI uses
//   colIndex as an opaque string key (object lookups, equality only) -
//   no numeric ops - so the swap is transparent.
//
// Admin gate on config writes:
//   All admin POST actions (price, fee, archive/reactivate, add-service,
//   add-group) check isScAdmin server-side before touching the
//   orchestrator. Defense in depth above the client-side admin gate.
//
// P0-1 (untouched-fields-zeroing) STATUS
//   The orchestrator's saveActuals upserts ONLY the entries it is
//   given. The legacy UI (DayDetail.js executeSave) currently sends
//   ALL services including value=0 for untouched, which would still
//   zero out untouched cells. The full P0-1 fix requires a UI PR that
//   sends only touched entries; this PR ships the data-layer half so
//   the moment the UI PR lands, the bug is fully resolved.

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function dayOfWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return DOW[d.getDay()] || "";
}

// Validate a clientToday query param. The browser sends its local
// YYYY-MM-DD on sc-load and sc-year-summary so the orchestrator can
// anchor isPast/isLocked and the year-summary classify() boundary on
// the operator's actual calendar day (CT/ET/AZ operators differ from
// UTC by several hours in the evening). Returns the validated string
// when it is a real calendar date that round-trips, otherwise null so
// the orchestrator falls back to its UTC default. Intentionally
// stricter than a bare regex - "2026-13-45" matches /^\d{4}-\d{2}-\d{2}$/
// but is not a real date and would construct a garbage anchor.
function parseClientToday(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) return null;
  return s;
}

// accounts.level -> UI category (preserves the legacy 3-bucket model).
function levelToCategory(level) {
  if (!level) return "Other";
  const L = String(level).toUpperCase();
  if (L === "MLB") return "MLB";
  if (L === "AAA" || L === "AA" || L === "MILB") return "MiLB";
  if (L === "PDC") return "PDC";
  if (L === "CORP") return "CORP";
  return level;
}

// metaColCount kept for legacy response parity. The current UI does
// not read it. PDC accounts use camp; MLB/AAA use gameType+gameTime.
function categoryToMetaColCount(category) {
  return category === "PDC" || category === "CORP" ? 5 : 6;
}

// Read every active account that has at least one service configured
// (i.e. has been imported). Returns the shape the legacy sc-accounts
// + sc-load actions both used.
async function loadAccountList() {
  const supa = getServiceClient();
  const [accountsRes, svcsRes] = await Promise.all([
    supa
      .from("accounts")
      .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
      .eq("active", true)
      .order("team_key", { ascending: true }),
    supa
      .from("sc_services")
      .select("account_key")
      .is("deleted_at", null),
  ]);
  if (accountsRes.error) throw new Error("[sc.route] loadAccountList accounts: " + accountsRes.error.message);
  if (svcsRes.error) throw new Error("[sc.route] loadAccountList services: " + svcsRes.error.message);

  // billing_model surfaced so the UI can fork its rendering for fee
  // accounts (flat_fee = homestand-driven display) vs per-meal accounts
  // (revenue-driven display). See ServiceCalendar.js isFeeAccount.
  // sc-16 (2026-07-11): hasHomestandSchedule surfaced as a per-account
  // flag so the UI can decouple schedule-presence from billing_model.
  // sc-17 (2026-07-11): hasScheduleOverlay surfaced as an ORTHOGONAL
  // per-account flag - accounts flagged for informational overlay
  // (STL - FL PDC today) render the opponent chip + pill on lg
  // WITHOUT any change to classify/kind/counters.
  const accountsWithServices = new Set((svcsRes.data || []).map((r) => r.account_key));
  return (accountsRes.data || [])
    .filter((a) => accountsWithServices.has(a.team_key))
    .map((a) => ({
      key:          a.team_key,
      category:     levelToCategory(a.level),
      name:         a.name || a.team_key,
      billingModel: a.billing_model || null,
      hasHomestandSchedule: !!a.has_homestand_schedule,
      hasScheduleOverlay:   !!a.has_schedule_overlay,
    }));
}

async function loadAccountInfo(accountKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("accounts")
    .select("name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (error) throw new Error("[sc.route] loadAccountInfo: " + error.message);
  return data;
}

// Transform orchestrator config shape -> legacy serviceGroups shape.
//   { groups, services } (flat per-account list)
//    -> [{ name, services: [{ name, price, colIndex, taxFree, ... }, ...] }]
//
// colIndex = service UUID (see "colIndex CONVENTION" note above).
function transformServiceGroups(config) {
  const groupMap = new Map();
  for (const g of config.groups) {
    groupMap.set(g.id, {
      name:      g.groupName,
      sortOrder: g.sortOrder,
      services:  [],
    });
  }
  for (const s of config.services) {
    const g = groupMap.get(s.groupId);
    if (!g) continue;
    g.services.push({
      name:        s.serviceName,
      price:       s.price,
      colIndex:    s.id,
      taxFree:     s.isTaxFree,
      flatFee:     s.isFlatFee,
      nonRevenue:  s.isNonRevenue,
      sortOrder:   s.sortOrder,
      // activeUntil flows through from sc-6a/6c so the calendar's
      // DayDetail can apply the same in-service predicate the
      // sc_daily_revenue view uses: a (service, day) pair is in service
      // iff (activeUntil IS NULL OR day <= activeUntil). Without this,
      // an archived service surfaces as an enterable input on days
      // strictly after its archive date - the view drops those day
      // rows but the UI still offers entry, producing a silent data
      // path (orphan upserts that the view never surfaces).
      activeUntil: s.activeUntil,
    });
  }
  return [...groupMap.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({
      name:     g.name,
      services: g.services.sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}

// Transform orchestrator days -> legacy days shape (projected/actual
// keyed by colIndex = serviceId UUID).
function transformDays(orchDays) {
  return orchDays.map((d) => {
    const projected = {};
    const actual = {};
    // View-sourced per-service revenue maps. These come from
    // sc_daily_revenue via loadMonthDataPostgres - priced by each
    // service-date's effective_date (LATERAL pick), so they reflect
    // mid-period price changes correctly. The count maps above stay
    // for now; a follow-up PR drops them once nothing JS-recomputes
    // from them.
    const projectedRevenue = {};
    const actualRevenue    = {};
    const priceAtDate      = {};
    for (const s of d.services) {
      projected[s.serviceId]        = s.projectedCount;
      actual[s.serviceId]           = s.actualCount;
      projectedRevenue[s.serviceId] = s.projectedRevenue;
      actualRevenue[s.serviceId]    = s.actualRevenue;
      priceAtDate[s.serviceId]      = s.priceAtDate;
    }
    return {
      // sheetRow is legacy Sheets context; null on PG.
      sheetRow:  null,
      date:      d.date,
      dayOfWeek: dayOfWeek(d.date),
      meta: {
        day:      dayOfWeek(d.date),
        period:   d.period     || "",
        week:     d.weekLabel  || "",
        camp:     d.eventLabel || "",
        gameType: d.gameType   || "",
        gameTime: d.gameTime   || "",
      },
      projected,
      actual,
      // Day-level revenue totals from the view (excludes is_non_revenue
      // services per sc_month_summary semantics). Guaranteed present
      // for every day - constructed unconditionally at
      // loadMonthDataPostgres:608 ({ projectedCount, actualCount,
      // projectedRevenue, actualRevenue }). No runtime guard needed
      // on the client side.
      totals: {
        projectedRevenue: d.totals.projectedRevenue,
        actualRevenue:    d.totals.actualRevenue,
      },
      projectedRevenue,
      actualRevenue,
      priceAtDate,
      // SC-079: per-day authored note ledger (newest first). Replaces
      // the singleton dayNotes field from #361 - authors, timestamps,
      // and history now travel with each day. Empty array when the day
      // has no notes so the UI can render the empty state without a
      // null-check. Backfilled entries carry author=null (rendered as
      // em-dash in the ledger).
      noteEntries: (d.noteEntries || []).map((e) => ({
        note:      e.note,
        author:    e.author,
        createdAt: e.createdAt,
      })),
      // F1 (M2): actuals-edit history per day, newest first. Same
      // pass-through pattern as noteEntries. Author null on legacy /
      // seed rows; UI renders as em-dash.
      // Phase 1 Ledger (2026-07-24 revised): server may append a
      // synthetic {kind: "first-entered"} row - preserved on the
      // pass-through so BOTH v1 mergeActivity and v2 groupActivity
      // can guard on it.
      historyEntries: (d.historyEntries || []).map((h) => ({
        kind:        h.kind || null,
        serviceId:   h.serviceId,
        serviceName: h.serviceName,
        oldValue:    h.oldValue,
        newValue:    h.newValue,
        author:      h.author,
        changedAt:   h.changedAt,
      })),
      hasActuals: d.hasAnyActuals,
      isPast:     d.isPast,
      isLocked:   d.isLocked,
      // Status is classified in loadMonthDataPostgres using the same
      // classifyDayStatus() the year loader uses; without this pass-through
      // the drill-in grid rendered every cell as the neutral off-fill.
      status:     d.status,
    };
  });
}


// ═══════════════════════════════════════════════════════════════════
// GET HANDLER
// ═══════════════════════════════════════════════════════════════════
export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const email = session.user?.email?.toLowerCase().trim();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    // ── sc-hero: random hero image (global pool) ──
    if (action === "sc-hero") {
      const supa = getServiceClient();
      const { data, error } = await supa
        .from("hero_images")
        .select("url")
        .is("team_key", null);
      if (error) throw new Error("hero_images: " + error.message);
      const urls = (data || [])
        .map((r) => r.url)
        .filter((u) => u && String(u).includes("http"));
      const heroImage = urls.length
        ? urls[Math.floor(Math.random() * urls.length)]
        : "";
      return NextResponse.json({ success: true, heroImage });
    }

    // ── sc-accounts: list every imported account ──
    //
    // Also returns:
    //   defaultAccount: the account_key the requesting user is mapped
    //     to in user_accounts (seeded from contacts via sc-3). The
    //     frontend auto-selects this on mount, fallback CIN-AZ.
    //   roles: the requesting user's role strings from contacts.role.
    //     A user can have multiple contacts rows (one per role/account
    //     combo - see sc-3 comment); we return ALL roles and let the
    //     client apply the floor-wins tiebreaker via computeInitialView
    //     for intent-aware landing (Stage 4 seam, activated here).
    //     Empty array when no contacts row matches the email.
    if (action === "sc-accounts") {
      const accounts = await loadAccountList();
      let defaultAccount = null;
      let roles = [];
      if (email) {
        try {
          const supa = getServiceClient();
          // Both queries use the same email match the route already
          // applies for the SC's user identification - no new auth path.
          const [acctRes, rolesRes] = await Promise.all([
            supa.from("user_accounts").select("account").ilike("email", email).limit(1),
            supa.from("contacts").select("role").ilike("email", email),
          ]);
          if (!acctRes.error && acctRes.data?.[0]?.account) {
            defaultAccount = acctRes.data[0].account;
          }
          if (!rolesRes.error && rolesRes.data?.length) {
            roles = rolesRes.data
              .map(r => r.role)
              .filter(r => r != null && String(r).trim() !== "");
          }
        } catch {
          // user_accounts / contacts missing or query failed - swallow.
          // Frontend falls back to CIN-AZ + Season default landing.
        }
      }
      return NextResponse.json({ success: true, accounts, defaultAccount, roles });
    }

    // ── sc-load: full month data for one account ──
    if (action === "sc-load") {
      const accountKey = searchParams.get("account");
      const monthStr = searchParams.get("month"); // "2026-04"
      if (!accountKey) {
        return NextResponse.json(
          { success: false, error: "Missing account param" },
          { status: 400 }
        );
      }

      let year, month;
      if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
        const parts = monthStr.split("-").map(Number);
        year = parts[0];
        month = parts[1];
      } else {
        // UTC fallback. In practice unreached: ServiceCalendar.js
        // initializes year/month from the CLIENT's local clock and
        // always sends ?month=YYYY-MM on first load. This branch only
        // catches a malformed param or a direct API hit; it computes
        // server-local (UTC on Vercel) which can be off by one for an
        // evening operator near a month boundary. The client-side
        // discipline is the real correctness; do not rely on this.
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
      }

      const clientToday = parseClientToday(searchParams.get("clientToday"));

      const [config, monthData, accountInfo, accounts] = await Promise.all([
        loadAccountConfig(accountKey),
        loadMonthData(accountKey, year, month, { clientToday }),
        loadAccountInfo(accountKey),
        loadAccountList(),
      ]);

      if (!accountInfo) {
        return NextResponse.json(
          { success: false, error: `Account not found: ${accountKey}` },
          { status: 404 }
        );
      }

      const category = levelToCategory(accountInfo.level);
      const serviceGroups = transformServiceGroups(config);
      const days = transformDays(monthData.days);
      const billingModel = accountInfo.billing_model || null;
      const hasHomestandScheduleFlag = !!accountInfo.has_homestand_schedule;
      const hasScheduleOverlayFlag = !!accountInfo.has_schedule_overlay;

      // Month-range bounds match the loadMonthData month exactly.
      // Computed here so both the homestand fetch and the sc-17
      // overlay fetch share the same range.
      const first = `${String(year)}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const last = `${String(year)}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Homestand context: fetched for any account with the
      // has_homestand_schedule flag TRUE (4 MLB fee accounts + the 2
      // AAA clubs after sc-16). STL-FL keeps flag=false and never
      // fetches. Empty {} still handled by !!data.homestandMap on the
      // UI side so old and new behavior stay in sync for STL-FL.
      let homestandMap = null;
      if (hasHomestandScheduleFlag) {
        const map = await loadHomestandContext(accountKey, first, last);
        // Only include in response when there IS data, so the UI's
        // !!data.homestandMap gate works cleanly.
        if (Object.keys(map).length > 0) homestandMap = map;
      }

      // sc-17 schedule overlay: fetched for any account flagged
      // has_schedule_overlay=true (currently STL-FL only). Reads
      // day_type='GAME' rows only; feeds a purely informational
      // render on lg drill-in tiles (opponent chip + day/night pill).
      // NEVER touches classify/kind/counters - see the audit doc.
      let scheduleOverlay = null;
      if (hasScheduleOverlayFlag) {
        const overlay = await loadScheduleOverlay(accountKey, first, last);
        if (Object.keys(overlay).length > 0) scheduleOverlay = overlay;
      }

      const responsePayload = {
        success: true,
        account: {
          key: accountKey,
          category,
          name: accountInfo.name || accountKey,
          billingModel,
          hasHomestandSchedule: hasHomestandScheduleFlag,
          hasScheduleOverlay: hasScheduleOverlayFlag,
          // spreadsheetId kept on the response shape for legacy parity;
          // the UI still echoes it back in the POST body but the
          // PG route ignores it.
          spreadsheetId: "",
        },
        metaColCount: categoryToMetaColCount(category),
        serviceGroups,
        days,
        // Overrides (sc_day_overrides) not migrated; the calendar
        // tolerates an empty array.
        overrides: [],
        accounts,
      };
      if (homestandMap) responsePayload.homestandMap = homestandMap;
      if (scheduleOverlay) responsePayload.scheduleOverlay = scheduleOverlay;
      return NextResponse.json(responsePayload);
    }

    // ── sc-year-summary: 12-month rollup for heatmap ──
    if (action === "sc-year-summary") {
      const accountKey = searchParams.get("account");
      if (!accountKey) {
        return NextResponse.json(
          { success: false, error: "Missing account param" },
          { status: 400 }
        );
      }
      const yearParam = searchParams.get("year");
      const year = yearParam && /^\d{4}$/.test(yearParam)
        ? Number(yearParam)
        : new Date().getFullYear();

      const clientToday = parseClientToday(searchParams.get("clientToday"));
      const summary = await loadYearSummary(accountKey, year, { clientToday });

      return NextResponse.json({
        success: true,
        accountKey,
        // Top-level today block: { date, period, week } for the year-banner
        // period chip. period/week are null when today has no metadata
        // (past the seeded data range). The legacy month-level `period: ""`
        // below is a Sheets-era display vestige and is NOT replaced by
        // this block (a per-month period label is Phase B territory).
        today: summary.today,
        // Period ranges for the Period lens (PR-B2). Array of
        // { period, start, end } sorted by start; drives both the
        // period-data fetch (which 1-2 calendar months a period spans)
        // and the prev/next period navigation.
        periodRanges: summary.periodRanges,
        months: summary.months.map((m) => {
          const monthOut = {
            month:             m.month,
            // period + camp at the month level were Sheets-era display
            // labels. Empty strings keep the UI happy.
            period:            "",
            camp:              "",
            totalDays:         m.totalServiceDays,
            daysWithActuals:   m.daysWithActuals,
            projectedRevenue:  m.totalProjectedRevenue,
            actualRevenue:     m.totalActualRevenue,
            projectedCovers:   m.totalProjectedMeals,
            actualCovers:      m.totalActualMeals,
            days:              m.days,
          };
          // Fee accounts: pre-aggregated homestand counts for the year
          // card (game days entered / total, homestand IDs in month).
          // Omitted on per-meal accounts.
          if (m.homestandSummary) monthOut.homestandSummary = m.homestandSummary;
          return monthOut;
        }),
        // M-2 (2026-07-29): homestand detail payload for the pilot
        // account (CIN-OH). Present only when the loader emitted it
        // - non-pilot accounts get a byte-identical pre-M-2 response.
        // Copy-through pattern mirrors homestandSummary at :539.
        ...(summary.homestands ? { homestands: summary.homestands } : {}),
      });
    }

    // ── sc-admin-all-config: per-account groups + services + as-of-today
    //    price + lastUpdatedAt, for the admin overview landing. ──
    if (action === "sc-admin-all-config") {
      if (!isScAdmin(email)) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const payload = await loadAllAccountsConfig();
      return NextResponse.json({ success: true, ...payload });
    }

    // ── sc-admin-account-config: groups + services + current price for
    //    one account, for the admin per-account editor. Cleaner than
    //    sc-load (which also pulls the calendar's full month data). ──
    if (action === "sc-admin-account-config") {
      if (!isScAdmin(email)) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const accountKey = searchParams.get("account");
      if (!accountKey) {
        return NextResponse.json(
          { success: false, error: "Missing account param" },
          { status: 400 }
        );
      }
      const config = await loadAccountConfig(accountKey);
      return NextResponse.json({ success: true, accountKey, ...config });
    }

    // ── sc-admin-fee-list: all fee-managed accounts (flat_fee + the
    //    fee-eligible per_meal accounts per FEE_ELIGIBLE_PER_MEAL) with
    //    current as-of-today fee + next upcoming change. The contract-
    //    revenue surface. ──
    if (action === "sc-admin-fee-list") {
      if (!isScAdmin(email)) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const payload = await loadFeeSchedule();
      return NextResponse.json({ success: true, ...payload });
    }

    // ── sc-admin-fee-history: full sc_fee_schedule history for one
    //    account. Used by the per-account fee editor's history panel. ──
    if (action === "sc-admin-fee-history") {
      if (!isScAdmin(email)) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const accountKey = searchParams.get("account");
      if (!accountKey) {
        return NextResponse.json(
          { success: false, error: "Missing account param" },
          { status: 400 }
        );
      }
      const history = await loadFeeAccountHistory(accountKey);
      return NextResponse.json({ success: true, accountKey, history });
    }

    // ── sc-admin-labor-budgets-list: all live rows for one MLB account ──
    // Returns per-period budgets + labor_ratio. MLB-only via the M-0 set.
    if (action === "sc-admin-labor-budgets-list") {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const accountKey = searchParams.get("account");
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing account param" }, { status: 400 });
      }
      if (!DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) {
        return NextResponse.json({ success: false, error: "Labor budgets are MLB-only" }, { status: 400 });
      }
      const [budgets, ratio] = await Promise.all([
        readLiveLaborBudgets(accountKey),
        readLaborRatio(accountKey),
      ]);
      return NextResponse.json({ success: true, accountKey, budgets, laborRatio: ratio.laborRatio });
    }

    // ── sc-admin-labor-budget-history: full history for one (account, period) ──
    if (action === "sc-admin-labor-budget-history") {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const accountKey = searchParams.get("account");
      const period = searchParams.get("period");
      if (!accountKey || !period) {
        return NextResponse.json({ success: false, error: "Missing account or period param" }, { status: 400 });
      }
      if (!DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) {
        return NextResponse.json({ success: false, error: "Labor budgets are MLB-only" }, { status: 400 });
      }
      const history = await readLaborBudgetHistory(accountKey, period);
      return NextResponse.json({ success: true, accountKey, period, history });
    }

    // ── sc-closeout-history: full history for one homestand's close-outs.
    //    Feeds the reopen surface's "prior figure" render (H6). Non-admin;
    //    the chef needs to see prior figures on their own homestand.
    if (action === "sc-closeout-history") {
      const accountKey = searchParams.get("account");
      const homestandKey = searchParams.get("homestand");
      if (!accountKey || !homestandKey) {
        return NextResponse.json({ success: false, error: "Missing account or homestand param" }, { status: 400 });
      }
      if (!DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) {
        return NextResponse.json({ success: false, error: "Close-out is MLB-only" }, { status: 400 });
      }
      const history = await readCloseoutHistory(accountKey, homestandKey);
      return NextResponse.json({ success: true, accountKey, homestandKey, history });
    }

    // ── sc-admin-labor-ratio-history: full sc_config_changelog history
    //    for one account's labor_ratio edits ──
    if (action === "sc-admin-labor-ratio-history") {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const accountKey = searchParams.get("account");
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing account param" }, { status: 400 });
      }
      if (!DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) {
        return NextResponse.json({ success: false, error: "Labor ratio is MLB-only" }, { status: 400 });
      }
      const history = await readLaborRatioHistory(accountKey);
      return NextResponse.json({ success: true, accountKey, history });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[ServiceCalendar GET]", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}


// PR-B Fix 3 (2026-07-22): server-side integer guard for actual_count.
//
// Prior coercion `Number(e.value) || 0` at :637 silently mapped any
// non-numeric input to 0 - a plausible-looking zero the operator would
// not spot on the next month refetch. NaN -> 0, "abc" -> 0, false -> 0,
// undefined -> 0. Client digit-strip was the only defense; nothing
// guarded the wire.
//
// This helper distinguishes intent from malformed input:
//   - null / undefined / "" (empty) -> deliberate zero (accept)
//   - a numeric value that is a non-negative integer -> accept
//   - anything else -> throw ValidationError with the offending
//     serviceId so the caller can respond 400 with a specific message
//
// Defense-in-depth: sc_daily_actuals CHECK (actual_count >= 0) at
// docs/migrations/sc-1-service-calendar-schema.sql:206 still catches
// anything that slips past. Non-integer / non-numeric never should.
class ActualCountValidationError extends Error {
  constructor(message, serviceId) {
    super(message);
    this.name = "ActualCountValidationError";
    this.serviceId = serviceId;
  }
}
function coerceActualCount(rawValue, serviceId) {
  // Deliberate zero from a cleared field. Client's getVal already
  // returns 0 for "" / undefined, but accept the empty forms here so
  // a queued replay or a legitimate direct API caller doesn't have
  // to guess at the coercion.
  if (rawValue === null || rawValue === undefined || rawValue === "") return 0;
  const n = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    throw new ActualCountValidationError(
      `Invalid value for service ${serviceId}: got ${JSON.stringify(rawValue)}, expected a non-negative integer`,
      serviceId,
    );
  }
  if (!Number.isInteger(n)) {
    throw new ActualCountValidationError(
      `Invalid value for service ${serviceId}: got ${JSON.stringify(rawValue)}, expected a non-negative integer (non-integer values would be silently truncated by PG)`,
      serviceId,
    );
  }
  if (n < 0) {
    throw new ActualCountValidationError(
      `Invalid value for service ${serviceId}: got ${n}, must be non-negative`,
      serviceId,
    );
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════
// POST HANDLER
// ═══════════════════════════════════════════════════════════════════
export async function POST(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const email = session.user?.email?.toLowerCase().trim();
  const body = await request.json();
  const { action } = body;

  try {
    // ── sc-submit-day: save actuals for one day ──
    if (action === "sc-submit-day") {
      const { accountKey, date, entries, auditNote, rideNote } = body;
      if (!accountKey || !date || !entries?.length) {
        return NextResponse.json(
          { success: false, error: "Missing required fields" },
          { status: 400 }
        );
      }
      // entries: [{ colIndex: '<service-uuid>', value: number }]
      // Translate to the orchestrator's shape.
      // P0-1 NOTE: future UI PR should filter to touched-only entries
      // before this call; the orchestrator already preserves untouched
      // services that are absent from the array.
      // PR-B Fix 3 (2026-07-22): coerceActualCount replaces `Number(x) || 0`
      // so malformed values 400 out with a field-specific message
      // instead of silently zeroing an actuals row.
      let touched;
      try {
        touched = entries.map((e) => ({
          serviceId:   e.colIndex,
          actualCount: coerceActualCount(e.value, e.colIndex),
        }));
      } catch (err) {
        if (err instanceof ActualCountValidationError) {
          return NextResponse.json(
            { success: false, error: err.message, serviceId: err.serviceId },
            { status: 400 },
          );
        }
        throw err;
      }
      const result = await saveActuals(accountKey, date, touched, email);

      // SC-079: notes moved off the save path (#361's dayNotes upsert
      // retired). The mark-no-service flow still needs to leave a
      // trail, so it posts its literal via the same ledger table as
      // sc-add-note. Author derives from the session - the client
      // cannot spoof it. Regular saves omit auditNote entirely.
      //
      // A3 fix (2026-07-24): wrap in try/catch. Prior behavior let a
      // note-write failure propagate to the outer catch, which
      // returned 500 while the ACTUALS were already committed to disk.
      // Operator saw "Save failed" and retried; LWW rewrote the same
      // value. Now: actuals are the billing truth - a note-write
      // failure is non-fatal, surfaced via auditNoteFailed so the
      // client can display an honest partial-success message ("saved,
      // no-service note couldn't post"). Same shape as rideNote below.
      let auditNoteFailed = false;
      if (typeof auditNote === "string" && auditNote.trim().length > 0) {
        try {
          const author = session.user?.name || session.user?.email || "";
          await addDayNoteEntry(accountKey, date, auditNote, author);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[sc-submit-day] auditNote append after successful save:", err);
          auditNoteFailed = true;
        }
      }

      // P2 (item 2, 2026-07-10): ride-along authored note. Ordered
      // AFTER save success so a failed save never leaves an orphan
      // note attached to unrecorded actuals. Author derives from the
      // session - the client cannot spoof it, matching sc-add-note.
      // A post-save append failure surfaces as noteFailed:true so the
      // client shows an honest partial toast ("Saved - note couldn't
      // post, use Add note") and preserves the draft. Bulk endpoints
      // do NOT accept rideNote (v1 fence - see sc-bulk-submit below).
      let noteFailed = false;
      const trimmedRide = typeof rideNote === "string" ? rideNote.trim() : "";
      if (trimmedRide.length > 0) {
        try {
          const author = session.user?.name || session.user?.email || "";
          await addDayNoteEntry(accountKey, date, trimmedRide, author);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[sc-submit-day] rideNote append after successful save:", err);
          noteFailed = true;
        }
      }

      // SC-051: server-authoritative totals. Read the view after the
      // write so the toast reflects effective-dated prices (same source
      // as the tile + week card + drill rail), not a client recompute
      // from the current catalog. Toast rounds to whole dollars via
      // fmt$; toast component receives the raw sum.
      //
      // A3 fix (2026-07-24): wrap in try/catch for the same reason as
      // auditNote above. Actuals are committed; a view-read failure
      // means we can't echo totals but the write is fine. Client's
      // Number.isFinite guard (SubmissionToast.js:33) already handles
      // absent totals gracefully.
      let totals = null;
      try {
        totals = await readSavedDayTotals(accountKey, date);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[sc-submit-day] readSavedDayTotals after successful save:", err);
      }

      return NextResponse.json({
        ...result,
        ...(totals ? { savedRevenue: totals.revenue, savedMeals: totals.meals } : {}),
        ...(noteFailed ? { noteFailed: true } : {}),
        ...(auditNoteFailed ? { auditNoteFailed: true } : {}),
      });
    }

    // ── sc-add-note: append one authored entry to the day's ledger ──
    // SC-079. Author is derived from the session; the client cannot
    // supply it. Returns the created entry so the UI can prepend
    // optimistically. Body: { account, date, note }.
    if (action === "sc-add-note") {
      const { account, date, note } = body;
      if (!account || !date || typeof note !== "string" || note.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: "account, date, and non-empty note required" },
          { status: 400 }
        );
      }
      const author = session.user?.name || session.user?.email || "";
      const result = await addDayNoteEntry(account, date, note, author);
      return NextResponse.json(result);
    }

    // ── sc-bulk-submit: save actuals for multiple days ──
    if (action === "sc-bulk-submit") {
      const { accountKey, entries } = body;
      if (!accountKey || !entries?.length) {
        return NextResponse.json(
          { success: false, error: "Missing required fields" },
          { status: 400 }
        );
      }
      // entries: [{ colIndex: '<service-uuid>', date: 'YYYY-MM-DD', value: number }]
      // P2 (item 2) fence, v1: rideNote is NOT accepted here. A single
      // note attached to a bulk write would land on all touched days
      // with the same author + timestamp, blurring which day it was
      // meant for. Per-day ride notes for bulk are out of scope for
      // this iteration - operators post standalone notes via the
      // DayDetail composer per day.
      // PR-B Fix 3 (2026-07-22): coerceActualCount replaces `Number(x) || 0`
      // on the bulk path too. A 400 aborts the ENTIRE batch (per Fix 1's
      // all-or-nothing contract) - one malformed entry blocks the whole
      // upsert rather than silently zeroing that row.
      // A3 failure-UI amend (2026-07-24): track the current entry so
      // the 400 response can name which DAY the bad value came from
      // (not just which service). Enables the client's "day X, field Y"
      // bulk-rejection message per §8B without a second lookup.
      let touched;
      let failingEntry = null;
      try {
        touched = [];
        for (const e of entries) {
          failingEntry = e;
          touched.push({
            serviceId:   e.colIndex,
            serviceDate: e.date,
            actualCount: coerceActualCount(e.value, e.colIndex),
          });
        }
        failingEntry = null;
      } catch (err) {
        if (err instanceof ActualCountValidationError) {
          return NextResponse.json(
            {
              success: false,
              error: err.message,
              serviceId: err.serviceId,
              serviceDate: failingEntry?.date || null,
            },
            { status: 400 },
          );
        }
        throw err;
      }
      const result = await saveBulkActuals(accountKey, touched, email);
      return NextResponse.json(result);
    }

    // ── sc-config-update: change prices (ADMIN) ──
    // Archive/reactivate live in the sc-admin-archive-* / sc-admin-
    // reactivate-* actions (Bundle 2 Step 3). This handler is the
    // price-update path only.
    if (action === "sc-config-update") {
      // Gate is the corporate-write set (SC_ADMIN_EMAILS via isScAdmin).
      // Stage 1 opened the admin page to 8 corporate users; the gate
      // here mirrors that.
      if (!isScAdmin(email)) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const { accountKey, changes } = body;
      if (!accountKey || !changes?.length) {
        return NextResponse.json(
          { success: false, error: "Missing fields" },
          { status: 400 }
        );
      }

      // Per-change validation for price entries. effectiveDate is REQUIRED
      // so the orchestrator's "today" fallback (UTC-today on Vercel) never
      // silently fires when a Central or Eastern operator hits "Today" in
      // the evening. The UI always supplies the operator's local YYYY-MM-DD
      // wall-clock today.
      //
      // BACKDATE (Bundle 1 Stage 3): a per-change `allowBackdate: true` flag
      // opts out of the today-or-future floor. The UI's Backdate radio is
      // the only path that sets the flag; Today and Future never do. When
      // allowBackdate is set we still require the date be a valid
      // YYYY-MM-DD AND >= 2024-01-01 (SC data + contracts are 2024-onward;
      // anything older is a fat-finger typo).
      //
      // The server-side today-or-future floor accepts (server-today-UTC
      // minus 1 day) intentionally: a CT/ET operator picking "Today" at
      // 8pm sends their local date, which is yesterday's date in UTC. The
      // 1-day grace is SAFE - yesterday is never a closed/invoiced day at
      // this stage of operations. Treat as a coarse sanity check, not the
      // primary control.
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const BACKDATE_FLOOR = "2024-01-01";
      for (const c of changes) {
        if (c.type !== "price") continue;
        if (!c.effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(c.effectiveDate)) {
          return NextResponse.json(
            { success: false, error: "effectiveDate required on price changes (YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        if (c.allowBackdate === true) {
          if (c.effectiveDate < BACKDATE_FLOOR) {
            return NextResponse.json(
              { success: false, error: `effectiveDate must be on or after ${BACKDATE_FLOOR} (older dates rejected as likely typos)` },
              { status: 400 }
            );
          }
          if (c.effectiveDate > today) {
            return NextResponse.json(
              { success: false, error: "backdate mode requires a past effectiveDate; use Future mode for forward-dated changes" },
              { status: 400 }
            );
          }
        } else if (c.effectiveDate < yesterday) {
          return NextResponse.json(
            { success: false, error: "effectiveDate must be today or future; choose Backdate to set a past date" },
            { status: 400 }
          );
        }
        if (!c.reason || typeof c.reason !== "string" || c.reason.trim().length === 0) {
          return NextResponse.json(
            { success: false, error: "reason required on price changes" },
            { status: 400 }
          );
        }
        if (c.reason.length > 280) {
          return NextResponse.json(
            { success: false, error: "reason must be 280 characters or fewer" },
            { status: 400 }
          );
        }
        if (c.requestedBy && (typeof c.requestedBy !== "string" || c.requestedBy.length > 280)) {
          return NextResponse.json(
            { success: false, error: "requestedBy must be 280 characters or fewer" },
            { status: 400 }
          );
        }
      }

      // UI sends changes as { type, groupName, serviceName, from?, to?,
      // effectiveDate, reason, requestedBy }. The orchestrator wants
      // { type, serviceId, newPrice, effectiveDate, notes, requestedBy,
      // entityLabel }. Resolve (groupName, serviceName) -> serviceId via
      // a single config read so the route does not query per-change.
      // Pass entityLabel through too so the orchestrator's changelog
      // insert doesn't need a second DB round-trip.
      const config = await loadAccountConfig(accountKey);
      const translated = changes.map((c) => {
        const svc = config.services.find(
          (s) => s.groupName === c.groupName && s.serviceName === c.serviceName
        );
        if (!svc) {
          throw new Error(
            `Service not found in config: ${c.groupName} / ${c.serviceName}`
          );
        }
        if (c.type === "price") {
          return {
            type:          "price",
            serviceId:     svc.id,
            newPrice:      Number(c.to),
            effectiveDate: c.effectiveDate,
            notes:         c.reason.trim(),
            requestedBy:   c.requestedBy ? c.requestedBy.trim() : null,
            entityLabel:   `${c.groupName} - ${c.serviceName}`,
          };
        }
        throw new Error(`Unknown change type: ${c.type}`);
      });

      const result = await updateServiceConfig(accountKey, translated, email);
      return NextResponse.json({ success: true, updated: result.applied });
    }

    // ── sc-admin-fee-set: write one fee-schedule change (ADMIN) ──
    // Mirrors sc-config-update's validation pattern: reason required,
    // effectiveDate required (today-or-future, 1-day UTC grace for CT/ET
    // operators). A top-level `allowBackdate: true` flag (Stage 3) opts
    // out of the today-or-future floor; still validates YYYY-MM-DD AND
    // >= 2024-01-01 lower floor for typo protection.
    if (action === "sc-admin-fee-set") {
      if (!isScAdmin(email)) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const { accountKey, amount, effectiveDate, reason, requestedBy, paymentCadence, allowBackdate } = body;
      if (!accountKey) {
        return NextResponse.json(
          { success: false, error: "Missing accountKey" },
          { status: 400 }
        );
      }
      if (amount === undefined || amount === null || isNaN(Number(amount))) {
        return NextResponse.json(
          { success: false, error: "amount required and must be numeric" },
          { status: 400 }
        );
      }
      if (Number(amount) < 0) {
        return NextResponse.json(
          { success: false, error: "amount must be >= 0" },
          { status: 400 }
        );
      }
      if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        return NextResponse.json(
          { success: false, error: "effectiveDate required (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      const todayFee = new Date().toISOString().slice(0, 10);
      const yesterday = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const FEE_BACKDATE_FLOOR = "2024-01-01";
      if (allowBackdate === true) {
        if (effectiveDate < FEE_BACKDATE_FLOOR) {
          return NextResponse.json(
            { success: false, error: `effectiveDate must be on or after ${FEE_BACKDATE_FLOOR} (older dates rejected as likely typos)` },
            { status: 400 }
          );
        }
        if (effectiveDate > todayFee) {
          return NextResponse.json(
            { success: false, error: "backdate mode requires a past effectiveDate; use Future mode for forward-dated changes" },
            { status: 400 }
          );
        }
      } else if (effectiveDate < yesterday) {
        return NextResponse.json(
          { success: false, error: "effectiveDate must be today or future; choose Backdate to set a past date" },
          { status: 400 }
        );
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: "reason required" },
          { status: 400 }
        );
      }
      if (reason.length > 280) {
        return NextResponse.json(
          { success: false, error: "reason must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      if (requestedBy && (typeof requestedBy !== "string" || requestedBy.length > 280)) {
        return NextResponse.json(
          { success: false, error: "requestedBy must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      if (paymentCadence !== undefined && paymentCadence !== null) {
        const allowed = ["monthly-6", "monthly-7", "quarterly", "annual"];
        if (typeof paymentCadence !== "string" || !allowed.includes(paymentCadence)) {
          return NextResponse.json(
            { success: false, error: `paymentCadence must be one of ${allowed.join(", ")}` },
            { status: 400 }
          );
        }
      }
      const result = await updateFeeSchedule(
        accountKey,
        {
          amount:         Number(amount),
          effectiveDate,
          reason:         reason.trim(),
          requestedBy:    requestedBy ? requestedBy.trim() : null,
          paymentCadence: paymentCadence ?? undefined,
        },
        email
      );
      return NextResponse.json(result);
    }

    // ── sc-admin-labor-budget-set: write one (account, period) labor
    //    budget change. Reason required. Supersedes the previous live
    //    row; response includes the supersede count for symmetry with
    //    fee edits' history read. MLB-only. ──
    if (action === "sc-admin-labor-budget-set") {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const { accountKey, period, hourlyBudget, salaryBudget, revenueForecast, effectiveFrom, reason, requestedBy } = body;
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing accountKey" }, { status: 400 });
      }
      if (!DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) {
        return NextResponse.json({ success: false, error: "Labor budgets are MLB-only" }, { status: 400 });
      }
      // sc-21 (2026-08-15): bare numeric ("4"..."13"), matching the
      // house convention in sc_day_metadata.period. Displays add "P".
      if (!period || !/^([1-9]|1[0-3])$/.test(String(period))) {
        return NextResponse.json({ success: false, error: "period required (bare numeric 1..13)" }, { status: 400 });
      }
      if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom))) {
        return NextResponse.json({ success: false, error: "effectiveFrom required (YYYY-MM-DD)" }, { status: 400 });
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return NextResponse.json({ success: false, error: "reason required" }, { status: 400 });
      }
      if (reason.length > 280) {
        return NextResponse.json({ success: false, error: "reason must be 280 characters or fewer" }, { status: 400 });
      }
      const validNumOrNull = (v) => v == null || (typeof v === "number" && !isNaN(v) && v >= 0) || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v));
      if (!validNumOrNull(hourlyBudget)) {
        return NextResponse.json({ success: false, error: "hourlyBudget must be numeric >= 0 or null" }, { status: 400 });
      }
      if (!validNumOrNull(salaryBudget)) {
        return NextResponse.json({ success: false, error: "salaryBudget must be numeric >= 0 or null" }, { status: 400 });
      }
      if (!validNumOrNull(revenueForecast)) {
        return NextResponse.json({ success: false, error: "revenueForecast must be numeric >= 0 or null" }, { status: 400 });
      }
      const result = await updateLaborBudget(
        accountKey,
        {
          period,
          hourlyBudget:    hourlyBudget != null ? Number(hourlyBudget) : null,
          salaryBudget:    salaryBudget != null ? Number(salaryBudget) : null,
          revenueForecast: revenueForecast != null ? Number(revenueForecast) : null,
          effectiveFrom,
          reason:          reason.trim(),
          requestedBy:     requestedBy ? String(requestedBy).trim() : null,
        },
        email
      );
      return NextResponse.json(result);
    }

    // ── sc-admin-labor-ratio-set: write TXR-V-style labor_ratio change.
    //    Value stored on accounts.labor_ratio; audit in sc_config_changelog.
    //    MLB-only. Value bounded (0, 1) at the schema level. ──
    if (action === "sc-admin-labor-ratio-set") {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const { accountKey, laborRatio, reason, requestedBy } = body;
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing accountKey" }, { status: 400 });
      }
      if (!DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) {
        return NextResponse.json({ success: false, error: "Labor ratio is MLB-only" }, { status: 400 });
      }
      const n = Number(laborRatio);
      if (isNaN(n) || n <= 0 || n >= 1) {
        return NextResponse.json({ success: false, error: "laborRatio must be a number in (0, 1)" }, { status: 400 });
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return NextResponse.json({ success: false, error: "reason required" }, { status: 400 });
      }
      if (reason.length > 280) {
        return NextResponse.json({ success: false, error: "reason must be 280 characters or fewer" }, { status: 400 });
      }
      const result = await updateLaborRatio(
        accountKey,
        { laborRatio: n, reason: reason.trim(), requestedBy: requestedBy ? String(requestedBy).trim() : null },
        email
      );
      return NextResponse.json(result);
    }

    // ─────────────────────────────────────────────────────────────
    // CATALOG LIFECYCLE (Bundle 2 Step 3 - sc-6c)
    // archive / reactivate / add for services and groups.
    // All isScAdmin-gated. Reason required on every action.
    // Archive date validation mirrors Stage 3 backdate (allowBackdate
    // opt-in skips the today-or-future floor; still requires valid
    // YYYY-MM-DD AND >= 2024-01-01 AND <= today).
    // ─────────────────────────────────────────────────────────────
    if (
      action === "sc-admin-archive-service" ||
      action === "sc-admin-archive-group"
    ) {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const isGroup = action === "sc-admin-archive-group";
      const { accountKey, archiveDate, reason, requestedBy, allowBackdate } = body;
      const entityId = isGroup ? body.groupId : body.serviceId;
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing accountKey" }, { status: 400 });
      }
      if (!entityId) {
        return NextResponse.json(
          { success: false, error: `Missing ${isGroup ? "groupId" : "serviceId"}` },
          { status: 400 }
        );
      }
      if (!archiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(archiveDate)) {
        return NextResponse.json(
          { success: false, error: "archiveDate required (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const BACKDATE_FLOOR = "2024-01-01";
      if (allowBackdate === true) {
        if (archiveDate < BACKDATE_FLOOR) {
          return NextResponse.json(
            { success: false, error: `archiveDate must be on or after ${BACKDATE_FLOOR} (older dates rejected as likely typos)` },
            { status: 400 }
          );
        }
        if (archiveDate > today) {
          return NextResponse.json(
            { success: false, error: "backdate mode requires a past archiveDate; use Future mode for forward-dated archives" },
            { status: 400 }
          );
        }
      } else if (archiveDate < yesterday) {
        return NextResponse.json(
          { success: false, error: "archiveDate must be today or future; choose Backdate to set a past date" },
          { status: 400 }
        );
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return NextResponse.json({ success: false, error: "reason required" }, { status: 400 });
      }
      if (reason.length > 280) {
        return NextResponse.json(
          { success: false, error: "reason must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      if (requestedBy && (typeof requestedBy !== "string" || requestedBy.length > 280)) {
        return NextResponse.json(
          { success: false, error: "requestedBy must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      const fn = isGroup ? archiveServiceGroup : archiveService;
      const result = await fn(accountKey, entityId, archiveDate, reason.trim(), requestedBy ? requestedBy.trim() : null, email);
      return NextResponse.json(result);
    }

    if (
      action === "sc-admin-reactivate-service" ||
      action === "sc-admin-reactivate-group"
    ) {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const isGroup = action === "sc-admin-reactivate-group";
      const { accountKey, reason, requestedBy } = body;
      const entityId = isGroup ? body.groupId : body.serviceId;
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing accountKey" }, { status: 400 });
      }
      if (!entityId) {
        return NextResponse.json(
          { success: false, error: `Missing ${isGroup ? "groupId" : "serviceId"}` },
          { status: 400 }
        );
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return NextResponse.json({ success: false, error: "reason required" }, { status: 400 });
      }
      if (reason.length > 280) {
        return NextResponse.json(
          { success: false, error: "reason must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      if (requestedBy && (typeof requestedBy !== "string" || requestedBy.length > 280)) {
        return NextResponse.json(
          { success: false, error: "requestedBy must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      const fn = isGroup ? reactivateServiceGroup : reactivateService;
      const result = await fn(accountKey, entityId, reason.trim(), requestedBy ? requestedBy.trim() : null, email);
      return NextResponse.json(result);
    }

    if (action === "sc-admin-add-service") {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const {
        accountKey, groupId, serviceName, initialPrice,
        isFlatFee, isTaxFree, isNonRevenue,
        reason, requestedBy,
      } = body;
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing accountKey" }, { status: 400 });
      }
      if (!groupId) {
        return NextResponse.json({ success: false, error: "Missing groupId" }, { status: 400 });
      }
      if (!serviceName || typeof serviceName !== "string" || serviceName.trim().length === 0) {
        return NextResponse.json({ success: false, error: "serviceName required" }, { status: 400 });
      }
      if (serviceName.length > 120) {
        return NextResponse.json(
          { success: false, error: "serviceName must be 120 characters or fewer" },
          { status: 400 }
        );
      }
      if (initialPrice === undefined || initialPrice === null || isNaN(Number(initialPrice)) || Number(initialPrice) < 0) {
        return NextResponse.json(
          { success: false, error: "initialPrice required and must be a non-negative number" },
          { status: 400 }
        );
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return NextResponse.json({ success: false, error: "reason required" }, { status: 400 });
      }
      if (reason.length > 280) {
        return NextResponse.json(
          { success: false, error: "reason must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      if (requestedBy && (typeof requestedBy !== "string" || requestedBy.length > 280)) {
        return NextResponse.json(
          { success: false, error: "requestedBy must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      const result = await addServiceWithAudit(
        accountKey,
        groupId,
        serviceName,
        Number(initialPrice),
        { isFlatFee: !!isFlatFee, isTaxFree: !!isTaxFree, isNonRevenue: !!isNonRevenue },
        reason.trim(),
        requestedBy ? requestedBy.trim() : null,
        email
      );
      return NextResponse.json(result);
    }

    if (action === "sc-admin-add-group") {
      if (!isScAdmin(email)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      const { accountKey, groupName, reason, requestedBy } = body;
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing accountKey" }, { status: 400 });
      }
      if (!groupName || typeof groupName !== "string" || groupName.trim().length === 0) {
        return NextResponse.json({ success: false, error: "groupName required" }, { status: 400 });
      }
      if (groupName.length > 120) {
        return NextResponse.json(
          { success: false, error: "groupName must be 120 characters or fewer" },
          { status: 400 }
        );
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return NextResponse.json({ success: false, error: "reason required" }, { status: 400 });
      }
      if (reason.length > 280) {
        return NextResponse.json(
          { success: false, error: "reason must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      if (requestedBy && (typeof requestedBy !== "string" || requestedBy.length > 280)) {
        return NextResponse.json(
          { success: false, error: "requestedBy must be 280 characters or fewer" },
          { status: 400 }
        );
      }
      const result = await addServiceGroup(
        accountKey,
        groupName,
        reason.trim(),
        requestedBy ? requestedBy.trim() : null,
        email
      );
      return NextResponse.json(result);
    }

    // ── sc-config-request: site lead submits a config change request ──
    if (action === "sc-config-request") {
      const { accountKey, requestType, groupName, serviceName, newPrice, notes } = body;
      if (!accountKey || !requestType) {
        return NextResponse.json(
          { success: false, error: "Missing fields" },
          { status: 400 }
        );
      }
      const result = await submitConfigRequest(
        accountKey,
        { requestType, groupName, serviceName, newPrice, notes },
        email
      );
      return NextResponse.json(result);
    }

    // ══════════════════════════════════════════════════════════════
    // M-3 (2026-08-XX): homestand close-out.
    // ══════════════════════════════════════════════════════════════
    //
    // The route decides which days are exceptions, what count each
    // service gets, and whether a projection is missing. The RPC
    // (sc_confirm_closeout) is a transaction wrapper only - no
    // business logic in plpgsql. Owner ruling 2026-07-29.
    //
    // Missing-projection rule (owner standing rule 2026-07-29): a
    // game day with no projection gets NO count written, not zero.
    // The route refuses the confirm with a 400 and names every
    // missing (date, service) pair. The chef then either marks the
    // day as an exception (rainout) or asks admin to fix the
    // projection.
    //
    // Exception scope (owner ruling Q7B): game days inside
    // [block.startDate, block.endDate]. Not the attribution window,
    // not prep days.
    //
    // Atomicity: the RPC wraps supersede + insert + bulk actuals
    // upsert in one plpgsql transaction. Pre-checks live here;
    // once we call the RPC, either every write lands or none.
    if (action === "sc-submit-closeout") {
      const {
        accountKey,
        homestandKey,
        exceptions,       // Array<ISO date> - game days in span
        laborActual,      // Number, dollars, non-negative
        laborSource,      // "manual" | "rippling_import"
        notes,            // optional
        reopenReason,     // null on first confirm; required on reopen
        clientToday: bodyClientToday,  // "YYYY-MM-DD" from browser
      } = body;
      const clientToday = parseClientToday(bodyClientToday);

      if (!accountKey || !homestandKey || laborActual == null || !laborSource) {
        return NextResponse.json(
          { success: false, error: "Missing required fields" },
          { status: 400 }
        );
      }
      if (!DERIVE_HOMESTANDS_ACCOUNTS.has(accountKey)) {
        return NextResponse.json(
          { success: false, error: "Close-out is MLB-only" },
          { status: 400 }
        );
      }
      if (laborSource !== "manual" && laborSource !== "rippling_import") {
        return NextResponse.json(
          { success: false, error: "labor_source must be manual or rippling_import" },
          { status: 400 }
        );
      }
      if (Number(laborActual) < 0 || !Number.isFinite(Number(laborActual))) {
        return NextResponse.json(
          { success: false, error: "labor_actual must be a non-negative number" },
          { status: 400 }
        );
      }

      // Load the block from the year-summary payload so windowStart,
      // windowEnd, and budget snapshot come from the SAME derivation
      // the client showed. A client-side value could rewrite the
      // budget snapshot incorrectly; the server must not trust it.
      //
      // M-3 Defect 2 (2026-08-XX owner ruling): derive the year from
      // clientToday, NEVER from new Date().getFullYear(). The server
      // clock ignores the operator's calendar day - trap §10.12
      // class. Two failure modes: (a) December 31 after 7pm ET, the
      // UTC year is already next year so this lookup 404s; (b) a
      // chef closing out an October homestand in January hits the
      // wrong season entirely (2027 budgets have already loaded per
      // owner's plan). clientToday validated shape "^\d{4}-\d{2}-\d{2}$"
      // above; first 4 chars are the year.
      const currentYear = clientToday
        ? Number(clientToday.slice(0, 4))
        : new Date().getFullYear();
      const yearSummary = await loadYearSummary(accountKey, currentYear, { clientToday });
      const block = (yearSummary.homestands || []).find((h) => String(h.key) === String(homestandKey));
      if (!block) {
        return NextResponse.json(
          { success: false, error: "Homestand not found for account+year" },
          { status: 404 }
        );
      }
      // Status gate: confirm can only fire on actuals-due (first) or
      // closed-out (reopen-then-reconfirm). Upcoming or in-progress
      // blocks refuse - a chef confirming before the block ends would
      // write actuals for game days that had not happened yet, and
      // the enum was designed to make that state unreachable.
      const allowedStatuses = new Set(["actuals-due", "closed-out"]);
      if (!allowedStatuses.has(block.status)) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot confirm a ${block.status} homestand. Confirm opens after the last game.`,
            status: block.status,
          },
          { status: 400 }
        );
      }

      // Exceptions must be game-day dates inside the block span.
      // Load the schedule to know which dates are GAME rows. Owner
      // ruling Q7B: span-only, game days only. Reject anything else.
      const supa = getServiceClient();
      const scheduleRes = await supa.from("sc_homestand_schedule")
        .select("service_date, day_type")
        .eq("account_key", accountKey)
        .eq("day_type", "GAME")
        .gte("service_date", block.startDate)
        .lte("service_date", block.endDate)
        .order("service_date", { ascending: true });
      if (scheduleRes.error) throw new Error(`schedule read: ${scheduleRes.error.message}`);
      const gameDates = scheduleRes.data.map((r) => r.service_date);
      const gameDateSet = new Set(gameDates);

      const exceptionSet = new Set(Array.isArray(exceptions) ? exceptions : []);
      const badExceptions = [...exceptionSet].filter((d) => !gameDateSet.has(d));
      if (badExceptions.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Exceptions must be game days inside the block span",
            badExceptions,
          },
          { status: 400 }
        );
      }

      // Load services + projections for the block span.
      //
      // M-3 Defect 1 (2026-08-XX owner ruling): the archive-relevant
      // field is `active_until`, not `active`. `active` is a vestigial
      // UI-only boolean the billing views deliberately ignore (see
      // serviceCalendar.js:2401 lineage note). Filtering on `active`
      // would (a) still write counts for services archived mid-season
      // - because `active` stays true and only `active_until` moves -
      // and (b) skip services with `active=false` that never got
      // archived (TBJ - NY Snack/Shake are in that state).
      //
      // Per-date resolution against `active_until` mirrors the
      // sc_daily_revenue view's catalog JOIN (sc-6b) and the client's
      // DayDetail archive-edge guard at DayDetail.js:243-246
      // (isInServiceOnDay). Cannot literally reuse that export - it
      // lives in a "use client" module - so the two-line predicate is
      // inlined below. Comment updates propagate to both call sites.
      const servicesRes = await supa.from("sc_services")
        .select("id, service_name, active_until")
        .eq("account_key", accountKey)
        .order("sort_order", { ascending: true });
      if (servicesRes.error) throw new Error(`services read: ${servicesRes.error.message}`);
      const services = servicesRes.data;

      // Archive-edge predicate (mirrors DayDetail.js:243-246). A
      // (service, day) pair is in service iff the service has no
      // active_until OR the day is on or before active_until.
      const isInServiceOnDay = (svc, dayDate) => {
        if (!svc.active_until) return true;
        return dayDate <= String(svc.active_until).slice(0, 10);
      };

      const projRes = await supa.from("sc_daily_projections")
        .select("service_id, service_date, projected_count")
        .eq("account_key", accountKey)
        .gte("service_date", block.startDate)
        .lte("service_date", block.endDate);
      if (projRes.error) throw new Error(`projections read: ${projRes.error.message}`);
      const projByPair = new Map();
      for (const p of projRes.data) {
        projByPair.set(`${p.service_date}|${p.service_id}`, Number(p.projected_count));
      }

      // Missing-projection guard. Iterate NON-EXCEPTION game dates x
      // IN-SERVICE services; refuse the whole confirm if any pair has
      // no projection. Owner standing rule: no lie is permitted. The
      // chef sees the gap and either marks the day as an exception
      // (rainout) or asks admin to add the projection. Archived
      // services skip out entirely - they belong to skippedByArchive
      // below, not to missingProjections.
      const missingProjections = [];
      for (const d of gameDates) {
        if (exceptionSet.has(d)) continue;
        for (const s of services) {
          if (!isInServiceOnDay(s, d)) continue;
          const key = `${d}|${s.id}`;
          if (!projByPair.has(key)) {
            missingProjections.push({
              service_date: d,
              service_id: s.id,
              service_name: s.service_name,
            });
          }
        }
      }
      if (missingProjections.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Cannot confirm: game days with missing projections. "
              + "Mark them as exceptions or ask admin to fix the projection.",
            missingProjections,
          },
          { status: 400 }
        );
      }

      // Assemble actualsRows and skippedByArchive together in one
      // pass. Owner ruling: the chef should SEE that some days write
      // fewer services than others (mid-block archives), not
      // discover it in the data later. skippedByArchive rides back
      // on the success response so the panel can render an
      // "N services skipped (archived)" note.
      //
      //   non-exception + in-service game day: actual_count = projected_count
      //   exception + in-service game day:     actual_count = 0
      //   archived (any day):                  skipped, recorded in skippedByArchive
      //
      // The route NEVER produces an empty actualsRows on a real
      // homestand. If services archive out entirely mid-block, the
      // remaining game days still write actuals for the still-active
      // services and the response names the archived ones.
      const actualsRows = [];
      const skippedByArchive = [];
      for (const d of gameDates) {
        const isException = exceptionSet.has(d);
        for (const s of services) {
          if (!isInServiceOnDay(s, d)) {
            skippedByArchive.push({
              service_date: d,
              service_id: s.id,
              service_name: s.service_name,
              active_until: s.active_until,
            });
            continue;
          }
          const projected = projByPair.get(`${d}|${s.id}`);
          actualsRows.push({
            service_id: s.id,
            service_date: d,
            actual_count: isException ? 0 : projected,
          });
        }
      }
      if (actualsRows.length === 0) {
        return NextResponse.json(
          { success: false, error: "Assembled zero actuals; every service archived out before this block?" },
          { status: 400 }
        );
      }

      // Budget snapshot: use the derivation's current envelope. When
      // the envelope was null-with-reason, carry null - the surface
      // will render the reason at close-out just like it did before.
      const budgetSnapshot = block.budget ? block.budget.amount : null;

      // Call the RPC. Atomic supersede + insert + bulk upsert in one
      // plpgsql transaction.
      //
      // Validation-vs-500 split (2026-07-29 gate ruling): the RPC RAISEs
      // when a reopen omits reopen_reason. That's a user forgetting a
      // required field, not the server breaking - it should return 400
      // with a clean message the panel can render as inline validation,
      // not 500 which reads as "the server failed" and pollutes error
      // monitoring. Match on the guard's verbatim message; any other
      // RPC error still surfaces as 500 via the outer catch.
      let result;
      try {
        result = await confirmCloseout({
          accountKey,
          homestandKey,
          laborActual,
          laborSource,
          windowStart: block.windowStart,
          windowEnd: block.windowEnd,
          budgetSnapshot,
          notes: notes || null,
          actualsRows,
          reopenReason: reopenReason || null,
          confirmedBy: email,
        });
      } catch (err) {
        if (err.message.includes("reopen_reason is required")) {
          return NextResponse.json(
            {
              success: false,
              error: "A reopen reason is required to amend a closed-out homestand.",
              field: "reopenReason",
            },
            { status: 400 }
          );
        }
        throw err;
      }

      return NextResponse.json({
        success: true,
        closeoutId: result.closeoutId,
        supersededCount: result.supersededCount,
        actualsWritten: result.actualsWritten,
        // Owner ruling: mid-block archive skips are named on the
        // response so the chef sees them (not "discovered in the
        // data later"). Empty array on the happy path; the panel
        // renders a note when non-empty.
        skippedByArchive,
      });
    }

    // ── Deferred actions (Sheets-only features not yet on PG) ──
    if (action === "sc-day-override") {
      // sc_day_overrides has no PG analogue today. The legacy table
      // stored "add a service today" / "mark day closed" decisions in
      // the COLLECTION sheet. If this feature comes back, design the
      // PG table first.
      return NextResponse.json({
        success: false,
        error: "Day overrides not available in PG yet",
      }, { status: 501 });
    }

    if (action === "sc-submit-clickers") {
      // Clicker count data was intentionally excluded from the seed
      // (mapping doc Issue #10). Stays out until use case is revisited.
      return NextResponse.json({
        success: false,
        error: "Clicker counts not available in PG",
      }, { status: 501 });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[ServiceCalendar POST]", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
