import { auth } from "@/lib/auth";
import { readSheetSA, appendRowSA, appendRowsSA, updateRangeSA, SHEET_IDS } from "@/lib/sheets";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/analytics";

// ═══════════════════════════════════════
// SERVICE CALENDAR API
// Drive-direct architecture: reads/writes to per-account Google Sheets
// Config source: service_config tab in HUB
// Audit trail: service_audit_log_26 in COLLECTION
// Overrides: service_day_overrides_26 in COLLECTION
// ═══════════════════════════════════════

const TABS = {
  PROJECTIONS: "Projections - 2026",
  ACTUALS: "Actuals - 2026",
  CLICKERS: "Clicker Counts - 2026",
  CONFIG: "service_config",
  AUDIT: "service_audit_log_26",
  OVERRIDES: "service_day_overrides_26",
};

// Billing lock: days older than this many days cannot be edited
const LOCK_DAYS = 7;

const parseNum = (v) => {
  const n = Number(String(v || "").replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
};

// Convert 0-based column index to A1 letter (0=A, 5=F, 25=Z, 26=AA)
function colLetter(idx) {
  let letter = "";
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// Parse date string from sheet (handles "2026-04-01", "4/1/2026", "April 1, 2026")
function parseSheetDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Return YYYY-MM-DD in local time
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Day-of-week label
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function dayOfWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return DOW[d.getDay()] || "";
}

// ─── Load and parse service_config from HUB ───
async function loadServiceConfig() {
  const { headers, rows } = await readSheetSA(SHEET_IDS.HUB, TABS.CONFIG);
  if (!rows.length) return [];

  // Map by header name for resilience
  const h = {};
  headers.forEach((name, i) => { h[String(name).trim()] = i; });

  return rows
    .filter((r) => r[h["AccountKey"]] && String(r[h["Active"]] || "TRUE").toUpperCase() !== "FALSE")
    .map((r) => ({
      accountKey:    String(r[h["AccountKey"]] || "").trim(),
      category:      String(r[h["Category"]] || "").trim(),
      spreadsheetId: String(r[h["SpreadsheetId"]] || "").trim(),
      groupName:     String(r[h["GroupName"]] || "").trim(),
      serviceName:   String(r[h["ServiceName"]] || "").trim(),
      pricePerPlate: parseNum(r[h["PricePerPlate"]]) || 0,
      serviceColIndex: parseInt(r[h["ServiceColIndex"]], 10) || 0,
      metaColCount:  parseInt(r[h["MetaColCount"]], 10) || 5,
      taxFree:       String(r[h["TaxFree"]] || "").toUpperCase() === "TRUE",
      sortOrder:     parseInt(r[h["SortOrder"]], 10) || 0,
    }));
}

// ─── Group services by GroupName for an account ───
function buildServiceGroups(configRows, accountKey) {
  const acctRows = configRows.filter((r) => r.accountKey === accountKey);
  if (!acctRows.length) return { groups: [], meta: null };

  const { spreadsheetId, category, metaColCount } = acctRows[0];

  // Group by groupName, sorted by sortOrder
  const groupMap = {};
  for (const r of acctRows) {
    if (!groupMap[r.groupName]) groupMap[r.groupName] = [];
    groupMap[r.groupName].push({
      name: r.serviceName,
      price: r.pricePerPlate,
      colIndex: r.serviceColIndex,
      taxFree: r.taxFree,
      sortOrder: r.sortOrder,
    });
  }

  const groups = Object.entries(groupMap).map(([name, services]) => ({
    name,
    services: services.sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  // Sort groups by lowest sortOrder of their first service
  groups.sort((a, b) => (a.services[0]?.sortOrder || 0) - (b.services[0]?.sortOrder || 0));

  return {
    groups,
    meta: { spreadsheetId, category, metaColCount },
  };
}

// ─── Parse a Drive sheet tab into structured day data ───
function parseDriveTab(rawRows, metaColCount, serviceColIndices) {
  // rawRows: full tab data including header rows
  // Data starts at row index 4 (row 5 in sheet, 1-indexed)
  if (rawRows.length < 5) return [];

  const days = [];
  for (let i = 4; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const dateVal = parseSheetDate(row[1]); // Date is always col B (index 1)
    if (!dateVal) continue;

    const meta = {
      day: String(row[0] || "").trim(),
      period: String(row[2] || "").trim(),
      week: String(row[3] || "").trim(),
    };

    // Extra meta cols (col 4+ before services start)
    if (metaColCount === 5) {
      meta.camp = String(row[4] || "").trim();
    } else if (metaColCount === 6) {
      meta.gameType = String(row[4] || "").trim();
      meta.gameTime = String(row[5] || "").trim();
    }

    // Service values keyed by column index
    const values = {};
    for (const ci of serviceColIndices) {
      const raw = row[ci];
      values[ci] = (raw !== undefined && raw !== "") ? parseNum(raw) : null;
    }

    days.push({
      sheetRow: i + 1, // 1-indexed sheet row number (for writes)
      date: dateVal,
      dayOfWeek: dayOfWeek(dateVal),
      meta,
      values,
    });
  }

  return days;
}


// ═══════════════════════════════════════
// GET HANDLER
// ═══════════════════════════════════════
export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = session.accessToken;
  const email = session.user?.email?.toLowerCase().trim();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    // ── sc-hero: return a random hero image ──
    if (action === "sc-hero") {
      const heroRaw = await readSheetSA(SHEET_IDS.HUB, "hero_images");
      const heroUrls = heroRaw.rows.flat().filter((u) => u && String(u).includes("http"));
      const heroImage = heroUrls.length ? heroUrls[Math.floor(Math.random() * heroUrls.length)] : "";
      return NextResponse.json({ success: true, heroImage });
    }

    // ── sc-accounts: list all accounts from service_config ──
    if (action === "sc-accounts") {
      const [configRows, accountsRaw] = await Promise.all([
        loadServiceConfig(),
        readSheetSA(SHEET_IDS.HUB, "accounts"),
      ]);
      // Map accounts tab keys → service_config keys (different naming conventions)
      const keyAliases = {
        "CIN-OH": "CIN-MLB",
        "STL-MO": "STL-MLB",
        "TXR-TX-H": "TXR-HOME",
        "TXR-TX-V": "TXR-VISIT",
        "TBJ-NY": "TBJ-BUF",
      };
      const nameLookup = { "TBR-BG": "Rays Boys & Girls Club" };
      for (const r of accountsRaw.rows) {
        const key = String(r[0] || "").trim();
        const normalized = key.replace(/\s*-\s*/g, "-");
        const mapped = keyAliases[normalized] || normalized;
        const name = String(r[1] || "").trim();
        if (mapped && name) nameLookup[mapped] = name;
      }
      const seen = new Map();
      for (const r of configRows) {
        if (!seen.has(r.accountKey)) {
          seen.set(r.accountKey, { key: r.accountKey, category: r.category, name: nameLookup[r.accountKey] || r.accountKey });
        }
      }
      return NextResponse.json({
        success: true,
        accounts: Array.from(seen.values()),
      });
    }

    // ── sc-load: load full month data for one account ──
    if (action === "sc-load") {
      const accountKey = searchParams.get("account");
      const month = searchParams.get("month"); // "2026-04" format
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing account param" }, { status: 400 });
      }

      logEvent(token, { email, category: "ops", action: "sc_load", page: "/ops/service-calendar", detail: { accountKey, month } });

      const configRows = await loadServiceConfig();
      const { groups, meta } = buildServiceGroups(configRows, accountKey);
      if (!meta) {
        return NextResponse.json({ success: false, error: `No config found for ${accountKey}` }, { status: 404 });
      }

      const { spreadsheetId, category, metaColCount } = meta;
      const serviceColIndices = groups.flatMap((g) => g.services.map((s) => s.colIndex));

      // Read projections + actuals + overrides in parallel
      const [projRaw, actRaw, overridesRaw] = await Promise.all([
        readSheetSA(spreadsheetId, TABS.PROJECTIONS),
        readSheetSA(spreadsheetId, TABS.ACTUALS),
        readSheetSA(SHEET_IDS.COLLECTION, TABS.OVERRIDES),
      ]);

      // Parse both tabs — pass full raw data including header rows
      const projAllRows = [projRaw.headers, ...projRaw.rows];
      const actAllRows = [actRaw.headers, ...actRaw.rows];

      const projDays = parseDriveTab(projAllRows, metaColCount, serviceColIndices);
      const actDays = parseDriveTab(actAllRows, metaColCount, serviceColIndices);

      // Build actuals lookup by date
      const actualsMap = {};
      for (const d of actDays) {
        actualsMap[d.date] = d;
      }

      // Filter to requested month (if provided)
      let filteredDays = projDays;
      if (month) {
        filteredDays = projDays.filter((d) => d.date.startsWith(month));
      }

      // Merge projected + actual into combined day objects
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const lockCutoff = new Date(now);
      lockCutoff.setDate(lockCutoff.getDate() - LOCK_DAYS);

      const days = filteredDays.map((proj) => {
        const act = actualsMap[proj.date] || null;
        const dateObj = new Date(proj.date + "T12:00:00");
        const isPast = dateObj < now;
        const isLocked = dateObj < lockCutoff;

        // Calculate revenue per service
        const projected = {};
        const actual = {};
        for (const g of groups) {
          for (const s of g.services) {
            projected[s.colIndex] = proj.values[s.colIndex];
            actual[s.colIndex] = act ? act.values[s.colIndex] : null;
          }
        }

        return {
          sheetRow: proj.sheetRow,
          date: proj.date,
          dayOfWeek: proj.dayOfWeek,
          meta: proj.meta,
          projected,
          actual,
          hasActuals: act ? Object.values(act.values).some((v) => v !== null) : false,
          isPast,
          isLocked,
        };
      });

      // Parse overrides for this account
      const overrides = overridesRaw.rows
        .filter((r) => String(r[0] || "").trim() === accountKey)
        .map((r) => ({
          accountKey: String(r[0] || "").trim(),
          date: String(r[1] || "").trim(),
          action: String(r[2] || "").trim(),       // "add_service" or "mark_closed"
          serviceName: String(r[3] || "").trim(),
          groupName: String(r[4] || "").trim(),
          note: String(r[5] || "").trim(),
          createdBy: String(r[6] || "").trim(),
          createdAt: String(r[7] || "").trim(),
        }));

      // All unique accounts for the selector
      const seen = new Map();
      for (const r of configRows) {
        if (!seen.has(r.accountKey)) {
          seen.set(r.accountKey, { key: r.accountKey, category: r.category });
        }
      }

      return NextResponse.json({
        success: true,
        account: { key: accountKey, category, spreadsheetId },
        metaColCount,
        serviceGroups: groups,
        days,
        overrides,
        accounts: Array.from(seen.values()),
      });
    }

    // ── sc-year-summary: aggregate months for year heatmap ──
    if (action === "sc-year-summary") {
      const accountKey = searchParams.get("account");
      if (!accountKey) {
        return NextResponse.json({ success: false, error: "Missing account param" }, { status: 400 });
      }

      const configRows = await loadServiceConfig();
      const { groups, meta } = buildServiceGroups(configRows, accountKey);
      if (!meta) {
        return NextResponse.json({ success: false, error: `No config for ${accountKey}` }, { status: 404 });
      }

      const { spreadsheetId, metaColCount } = meta;
      const serviceColIndices = groups.flatMap((g) => g.services.map((s) => s.colIndex));

      const [projRaw, actRaw] = await Promise.all([
        readSheetSA(spreadsheetId, TABS.PROJECTIONS),
        readSheetSA(spreadsheetId, TABS.ACTUALS),
      ]);

      const projAllRows = [projRaw.headers, ...projRaw.rows];
      const actAllRows = [actRaw.headers, ...actRaw.rows];

      const projDays = parseDriveTab(projAllRows, metaColCount, serviceColIndices);
      const actDays = parseDriveTab(actAllRows, metaColCount, serviceColIndices);

      const actualsMap = {};
      for (const d of actDays) actualsMap[d.date] = d;

      // Build price lookup
      const priceLookup = {};
      for (const g of groups) {
        for (const s of g.services) {
          priceLookup[s.colIndex] = s.price;
        }
      }

      // Aggregate by month
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const lockCutoff = new Date(now);
      lockCutoff.setDate(lockCutoff.getDate() - 7);

      const months = {};
      for (const proj of projDays) {
        const monthKey = proj.date.slice(0, 7);
        if (!months[monthKey]) {
          months[monthKey] = {
            month: monthKey,
            period: proj.meta.period || "",
            camp: proj.meta.camp || proj.meta.gameType || "",
            totalDays: 0,
            daysWithActuals: 0,
            projectedRevenue: 0,
            actualRevenue: 0,
            projectedCovers: 0,
            actualCovers: 0,
            days: [],
          };
        }
        const m = months[monthKey];
        m.totalDays++;

        const act = actualsMap[proj.date];
        const hasAct = act && Object.values(act.values).some((v) => v !== null);
        const allZeroProj = Object.values(proj.values).every((v) => v === null || v === 0);
        const dateObj = new Date(proj.date + "T12:00:00");
        const isPast = dateObj < now;
        const isOverdue = dateObj < lockCutoff;

        // Day status for heatmap
        let dayStatus = "future";
        if (hasAct && allZeroProj) dayStatus = "no-service";
        else if (hasAct) dayStatus = "entered";
        else if (isPast && isOverdue) dayStatus = "overdue";
        else if (isPast) dayStatus = "needs-entry";

        m.days.push({ date: proj.date, status: dayStatus, gameType: proj.meta.gameType || "" });

        for (const ci of serviceColIndices) {
          const price = priceLookup[ci] || 0;
          const pv = proj.values[ci];
          const av = act ? act.values[ci] : null;

          if (pv !== null) {
            m.projectedRevenue += pv * price;
            m.projectedCovers += pv;
          }
          if (av !== null) {
            m.actualRevenue += av * price;
            m.actualCovers += av;
          }
        }

        if (hasAct) {
          m.daysWithActuals++;
        }
      }

      return NextResponse.json({
        success: true,
        accountKey,
        months: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
      });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[ServiceCalendar GET]", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}


// ═══════════════════════════════════════
// POST HANDLER
// ═══════════════════════════════════════
export async function POST(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = session.accessToken;
  const email = session.user?.email?.toLowerCase().trim();
  const userName = session.user?.name || "Team Member";
  const body = await request.json();
  const { action } = body;

  try {
    // ── sc-submit-day: write actuals to Drive sheet ──
    if (action === "sc-submit-day") {
      const { accountKey, spreadsheetId, date, sheetRow, entries } = body;
      // entries: [{ colIndex, value }]

      if (!accountKey || !spreadsheetId || !date || !sheetRow || !entries?.length) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }

      // No billing lock — managers can edit any past day
      // The frontend shows overdue warnings but does not block writes

      // Write each entry to the correct cell in the Actuals tab
      // Build batch: group contiguous columns into ranges for efficiency
      const sorted = [...entries].sort((a, b) => a.colIndex - b.colIndex);

      // Write entries one range at a time (most days have a contiguous block)
      const writePromises = [];
      let rangeStart = sorted[0].colIndex;
      let rangeValues = [sorted[0].value];

      for (let i = 1; i <= sorted.length; i++) {
        const isContiguous = i < sorted.length && sorted[i].colIndex === sorted[i - 1].colIndex + 1;
        if (isContiguous) {
          rangeValues.push(sorted[i].value);
        } else {
          // Flush this range
          const startCol = colLetter(rangeStart);
          const endCol = colLetter(rangeStart + rangeValues.length - 1);
          const range = `'${TABS.ACTUALS}'!${startCol}${sheetRow}:${endCol}${sheetRow}`;
          writePromises.push(updateRangeSA(spreadsheetId, range, [rangeValues]));

          // Start next range
          if (i < sorted.length) {
            rangeStart = sorted[i].colIndex;
            rangeValues = [sorted[i].value];
          }
        }
      }

      const results = await Promise.all(writePromises);
      const anyFailed = results.some((r) => !r.success);

      // Append audit log
      const auditRow = [
        new Date().toISOString(),  // timestamp
        email,                     // who
        userName,                  // display name
        accountKey,                // account
        date,                      // service date
        "submit_actuals",          // action type
        JSON.stringify(entries),    // payload
        anyFailed ? "partial" : "success",
      ];
      await appendRowSA(SHEET_IDS.COLLECTION, TABS.AUDIT, auditRow);

      logEvent(token, {
        email, userName, category: "ops", action: "sc_submit_day",
        page: "/ops/service-calendar",
        detail: { accountKey, date, entryCount: entries.length },
      });

      return NextResponse.json({
        success: !anyFailed,
        error: anyFailed ? "Some writes failed — check the sheet" : undefined,
      });
    }

    // ── sc-day-override: add_service or mark_closed ──
    if (action === "sc-day-override") {
      const { accountKey, date, overrideAction, serviceName, groupName, note } = body;
      // overrideAction: "add_service" | "mark_closed"

      if (!accountKey || !date || !overrideAction) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }

      const row = [
        accountKey,
        date,
        overrideAction,
        serviceName || "",
        groupName || "",
        note || "",
        email,
        new Date().toISOString(),
      ];

      const result = await appendRowSA(SHEET_IDS.COLLECTION, TABS.OVERRIDES, row);

      logEvent(token, {
        email, userName, category: "ops", action: "sc_override",
        page: "/ops/service-calendar",
        detail: { accountKey, date, overrideAction, serviceName },
      });

      return NextResponse.json(result);
    }

    // ── sc-submit-clickers: write clicker counts to Drive sheet ──
    if (action === "sc-submit-clickers") {
      const { accountKey, spreadsheetId, date, sheetRow, entries } = body;

      if (!accountKey || !spreadsheetId || !date || !sheetRow || !entries?.length) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }

      // Same write pattern as actuals but to Clicker Counts tab
      const sorted = [...entries].sort((a, b) => a.colIndex - b.colIndex);
      const writePromises = [];
      let rangeStart = sorted[0].colIndex;
      let rangeValues = [sorted[0].value];

      for (let i = 1; i <= sorted.length; i++) {
        const isContiguous = i < sorted.length && sorted[i].colIndex === sorted[i - 1].colIndex + 1;
        if (isContiguous) {
          rangeValues.push(sorted[i].value);
        } else {
          const startCol = colLetter(rangeStart);
          const endCol = colLetter(rangeStart + rangeValues.length - 1);
          const range = `'${TABS.CLICKERS}'!${startCol}${sheetRow}:${endCol}${sheetRow}`;
          writePromises.push(updateRangeSA(spreadsheetId, range, [rangeValues]));

          if (i < sorted.length) {
            rangeStart = sorted[i].colIndex;
            rangeValues = [sorted[i].value];
          }
        }
      }

      const results = await Promise.all(writePromises);
      const anyFailed = results.some((r) => !r.success);

      // Audit log
      const auditRow = [
        new Date().toISOString(), email, userName, accountKey, date,
        "submit_clickers", JSON.stringify(entries),
        anyFailed ? "partial" : "success",
      ];
      await appendRowSA(SHEET_IDS.COLLECTION, TABS.AUDIT, auditRow);

      logEvent(token, {
        email, userName, category: "ops", action: "sc_submit_clickers",
        page: "/ops/service-calendar",
        detail: { accountKey, date, entryCount: entries.length },
      });

      return NextResponse.json({
        success: !anyFailed,
        error: anyFailed ? "Some writes failed" : undefined,
      });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[ServiceCalendar POST]", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}