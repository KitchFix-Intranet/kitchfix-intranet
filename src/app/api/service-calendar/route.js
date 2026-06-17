import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { SC_ADMINS } from "@/lib/admin";
import {
  loadAccountConfig,
  loadMonthData,
  loadYearSummary,
  loadHomestandContext,
  saveActuals,
  saveBulkActuals,
  updateServiceConfig,
  addService,
  submitConfigRequest,
} from "@/lib/dataStore/serviceCalendar";

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
// so the UI (ServiceCalendar.js, DayDetail.js, ServiceConfig.js) reads
// the same field names. The mapping happens at this layer.
//
// colIndex CONVENTION
//   The legacy route used Sheets column numbers for `colIndex` as the
//   per-service key in projected/actual maps and POST payloads. The
//   PG-backed route puts the service UUID in that slot. The UI uses
//   colIndex as an opaque string key (object lookups, equality only) -
//   no numeric ops - so the swap is transparent.
//
// P0-3 (admin gate on config writes)
//   sc-config-update and sc-config-add now check SC_ADMINS server-side
//   before touching the orchestrator. The client-side ServiceConfig
//   gate stays; this is defense in depth.
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
      .select("team_key, name, level, billing_model")
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
  const accountsWithServices = new Set((svcsRes.data || []).map((r) => r.account_key));
  return (accountsRes.data || [])
    .filter((a) => accountsWithServices.has(a.team_key))
    .map((a) => ({
      key:          a.team_key,
      category:     levelToCategory(a.level),
      name:         a.name || a.team_key,
      billingModel: a.billing_model || null,
    }));
}

async function loadAccountInfo(accountKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("accounts")
    .select("name, level, billing_model")
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
      name:       s.serviceName,
      price:      s.price,
      colIndex:   s.id,
      taxFree:    s.isTaxFree,
      flatFee:    s.isFlatFee,
      nonRevenue: s.isNonRevenue,
      sortOrder:  s.sortOrder,
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
    for (const s of d.services) {
      projected[s.serviceId] = s.projectedCount;
      actual[s.serviceId]    = s.actualCount;
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
      hasActuals: d.hasAnyActuals,
      isPast:     d.isPast,
      isLocked:   d.isLocked,
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
    // Also returns defaultAccount: the account_key the requesting user is
    // mapped to in user_accounts (seeded from the contacts table via
    // docs/migrations/sc-3-user-accounts-seed.sql). The frontend uses this
    // to auto-select the user's account on mount with fallback to CIN-AZ.
    if (action === "sc-accounts") {
      const accounts = await loadAccountList();
      let defaultAccount = null;
      if (email) {
        try {
          const supa = getServiceClient();
          const { data, error } = await supa
            .from("user_accounts")
            .select("account")
            .ilike("email", email)
            .limit(1);
          if (!error && data?.[0]?.account) defaultAccount = data[0].account;
        } catch {
          // user_accounts missing or query failed - swallow, frontend
          // falls back to CIN-AZ -> first account.
        }
      }
      return NextResponse.json({ success: true, accounts, defaultAccount });
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
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
      }

      const [config, monthData, accountInfo, accounts] = await Promise.all([
        loadAccountConfig(accountKey),
        loadMonthData(accountKey, year, month),
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

      // Homestand context: only fetched + included for flat_fee accounts.
      // STL-FL is flat_fee but has zero homestand rows; the resulting
      // empty {} signals "no homestand data" to the UI, which falls
      // back to per-meal display for that account. The 4 MLB fee
      // accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) return a populated
      // map keyed by YYYY-MM-DD.
      let homestandMap = null;
      if (billingModel === "flat_fee") {
        // Month-range bounds match the loadMonthData month exactly.
        const first = `${String(year)}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const last = `${String(year)}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        const map = await loadHomestandContext(accountKey, first, last);
        // Only include in response when there IS data, so the UI's
        // !!data.homestandMap gate works for STL-FL too.
        if (Object.keys(map).length > 0) homestandMap = map;
      }

      const responsePayload = {
        success: true,
        account: {
          key: accountKey,
          category,
          name: accountInfo.name || accountKey,
          billingModel,
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

      const summary = await loadYearSummary(accountKey, year);

      return NextResponse.json({
        success: true,
        accountKey,
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
      });
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
      const { accountKey, date, entries } = body;
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
      const touched = entries.map((e) => ({
        serviceId:   e.colIndex,
        actualCount: Number(e.value) || 0,
      }));
      const result = await saveActuals(accountKey, date, touched, email);
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
      const touched = entries.map((e) => ({
        serviceId:   e.colIndex,
        serviceDate: e.date,
        actualCount: Number(e.value) || 0,
      }));
      const result = await saveBulkActuals(accountKey, touched, email);
      return NextResponse.json(result);
    }

    // ── sc-config-update: change prices, deactivate services (ADMIN) ──
    if (action === "sc-config-update") {
      if (!SC_ADMINS.includes(email)) {
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

      // UI sends changes as { type, groupName, serviceName, from?, to? }.
      // The orchestrator wants { type, serviceId, newPrice? }. Resolve
      // each (groupName, serviceName) to its serviceId via a single
      // config read so the route does not query per-change.
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
          return { type: "price", serviceId: svc.id, newPrice: Number(c.to) };
        }
        if (c.type === "deactivate") {
          return { type: "deactivate", serviceId: svc.id };
        }
        if (c.type === "reactivate") {
          return { type: "reactivate", serviceId: svc.id };
        }
        throw new Error(`Unknown change type: ${c.type}`);
      });

      const result = await updateServiceConfig(accountKey, translated, email);
      return NextResponse.json({ success: true, updated: result.applied });
    }

    // ── sc-config-add: add a new service to an account (ADMIN) ──
    if (action === "sc-config-add") {
      if (!SC_ADMINS.includes(email)) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
      const { accountKey, groupName, serviceName, price, taxFree, flatFee, nonRevenue } = body;
      if (!accountKey || !groupName || !serviceName) {
        return NextResponse.json(
          { success: false, error: "Missing fields" },
          { status: 400 }
        );
      }
      const result = await addService(
        accountKey,
        groupName,
        serviceName,
        Number(price) || 0,
        {
          isFlatFee:    !!flatFee,
          isTaxFree:    !!taxFree,
          isNonRevenue: !!nonRevenue,
        },
        email
      );
      // Legacy response field `colIndex` carried the Sheets column
      // number; the PG version returns the new service UUID so the UI
      // can index into the freshly-reloaded calendar shape.
      return NextResponse.json({ success: true, colIndex: result.serviceId });
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
