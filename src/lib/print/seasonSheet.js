// Season sheet renderer for the SC print export.
//
// #422 (Wave 3, 2026-07-13): rewritten to SC_PRINT_SPEC_v2. Two
// variants:
//
//   Full-schedule (MLB / AAA)      - spec sheets 1 + 2, APPROVED.
//     Adds v1's missing pieces: day numbers in each cell (5.5px, top-
//     left) and AWAY cells (light fill + @OPP + no time). Home stays
//     navy fill with opponent + time. Counts stay "N HOME · N AWAY".
//
//   Blended SERVICE CALENDAR
//   (overlay PDCs: STL - FL, TBJ - FL)
//                                  - spec sheet 3. Ghost renamed from
//     "HOME SCHEDULE" to "SERVICE CALENDAR". Green service days
//     (season scale collapses served + projected to one green per
//     spec block 3) layer under the affiliate home game cells; day
//     numbers show; counts stay games-only "N HOME" because the
//     affiliate games are the only home-away signal for these accounts.

import { getServiceClient } from "@/lib/supabase";
import { formatMlbHomeGameTime, formatMilbHomeGameTime, getAccountHomeTz }
  from "@/app/service-calendar/gameTimeFormat";
import { esc, sheetHead, loadSealDataUri, footerDate, seasonServiceState }
  from "./assets";

const MON_NAMES_TITLE = [
  "JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
  "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER",
];
const MON_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN",
                   "JUL","AUG","SEP","OCT","NOV","DEC"];

const DAY_MS = 24 * 60 * 60 * 1000;
function shiftDays(d, days) { return new Date(d.getTime() + days * DAY_MS); }
function isoDay(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
function monFirstIndex(d) { const js = d.getUTCDay(); return js === 0 ? 6 : js - 1; }
function weekAnchor(d) { return shiftDays(d, -monFirstIndex(d)); }

function formatTimeForCell(row, accountKey) {
  if (!row.game_time) return "";
  const tz = getAccountHomeTz(accountKey);
  if (tz) return formatMlbHomeGameTime(row.game_time, accountKey) || "";
  return formatMilbHomeGameTime(row.game_time) || "";
}

function isDayGame(row, accountKey) {
  if (!row.game_time) return null;
  const tz = getAccountHomeTz(accountKey);
  if (tz) {
    const d = new Date(row.game_time);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", hour12: false, timeZone: tz.tz,
    }).formatToParts(d);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    if (Number.isNaN(hour)) return null;
    return hour < 14;
  }
  const raw = String(row.game_time);
  const pmMatch = /pm/i.test(raw);
  const amMatch = /am/i.test(raw);
  const hourMatch = raw.match(/^(\d{1,2})/);
  if (!hourMatch) return null;
  let hour = Number(hourMatch[1]);
  if (pmMatch && hour !== 12) hour += 12;
  if (amMatch && hour === 12) hour = 0;
  return hour < 14;
}

// ── Loader ───────────────────────────────────────────────────────────
export async function loadSeasonPrintData(accountKey, year) {
  const supa = getServiceClient();

  const accountRes = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (accountRes.error) throw new Error(`loadSeason.account: ${accountRes.error.message}`);
  const account = accountRes.data;
  if (!account) throw new Error(`Account not found: ${accountKey}`);
  if (!account.has_homestand_schedule && !account.has_schedule_overlay) {
    throw new Error(`Account ${accountKey} has no schedule to print`);
  }

  // Games in the year.
  const rowsRes = await supa
    .from("sc_homestand_schedule")
    .select("service_date, day_of_week, day_type, opponent, game_time, day_night, is_doubleheader")
    .eq("account_key", accountKey)
    .gte("service_date", `${year}-01-01`)
    .lte("service_date", `${year}-12-31`)
    .order("service_date", { ascending: true });
  if (rowsRes.error) throw new Error(`loadSeason.rows: ${rowsRes.error.message}`);
  const rows = rowsRes.data || [];

  // Group by month.
  const byMonth = {};
  const homeAwayCounts = {};
  for (const r of rows) {
    const m = Number(r.service_date.slice(5, 7));
    if (!byMonth[m]) byMonth[m] = {};
    byMonth[m][r.service_date] = r;
    if (!homeAwayCounts[m]) homeAwayCounts[m] = { h: 0, a: 0 };
    if (r.day_type === "GAME") homeAwayCounts[m].h++;
    else if (r.day_type === "AWAY") homeAwayCounts[m].a++;
  }
  const gameMonths = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
  if (gameMonths.length === 0) {
    throw new Error(`Account ${accountKey} has no schedule rows for ${year}`);
  }
  const firstMonth = gameMonths[0];
  const lastMonth  = gameMonths[gameMonths.length - 1];

  let seasonEnd = null;
  for (const r of rows) {
    if (r.day_type === "GAME" || r.day_type === "AWAY") {
      if (!seasonEnd || r.service_date > seasonEnd) seasonEnd = r.service_date;
    }
  }

  // Blended-variant extras: pull day-level status for the overlay
  // accounts so the service layer can key on the classifier. Cheap -
  // one paginated call across the game span.
  let statusByDate = {};
  const isBlended = !!account.has_schedule_overlay && !account.has_homestand_schedule;
  if (isBlended) {
    const first = `${year}-${String(firstMonth).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
    const last = `${year}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    // Reuse the year-summary classifier output rather than re-running.
    // Pull minimal shape via the dedicated helper.
    const { loadYearSummary } = await import("@/lib/dataStore/serviceCalendar");
    const summary = await loadYearSummary(accountKey, year);
    for (const mo of summary.months || []) {
      for (const d of mo.days || []) {
        if (d.status) statusByDate[d.date] = { status: d.status };
      }
    }
  }

  return {
    account,
    year,
    firstMonth,
    lastMonth,
    byMonth,
    homeAwayCounts,
    seasonEnd,
    isOverlay: !!account.has_schedule_overlay && !account.has_homestand_schedule,
    statusByDate,
  };
}

// ── Renderer ─────────────────────────────────────────────────────────
export function renderSeasonSheetHtml(ctx) {
  const {
    account, year, firstMonth, lastMonth, byMonth, homeAwayCounts,
    seasonEnd, isOverlay, statusByDate,
  } = ctx;

  const seal = loadSealDataUri();
  const bandRight = esc(account.name || account.team_key);
  const rightGhost = isOverlay ? "SERVICE CALENDAR" : (account.level || "").toUpperCase();
  const tz = getAccountHomeTz(account.team_key)?.abbrev || "ET";
  const asOf = footerDate();

  const monthBlocks = [];
  for (let m = firstMonth; m <= lastMonth; m++) {
    const dayRows = byMonth[m] || {};
    const monthName = MON_NAMES_TITLE[m - 1];
    const counts = homeAwayCounts[m] || { h: 0, a: 0 };
    const countLabel = isOverlay
      ? `${counts.h} HOME`
      : `${counts.h} H · ${counts.a} A`;
    const cells = buildSeasonMonthCells(year, m, dayRows, account.team_key, statusByDate, account.level);
    const isLast = m === lastMonth;
    const trailer = (isLast && seasonEnd)
      ? `<div class="seasend">SEASON ENDS ${esc(monthDayLabel(seasonEnd))}</div>`
      : "";
    monthBlocks.push(`<div class="smo">
      <h4>${esc(monthName)}<s>${esc(countLabel)}</s></h4>
      <div class="sg">${cells}</div>
      ${trailer}
    </div>`);
  }

  const svLeg  = `<span><span class="kk" style="background:#D3E2C8"></span>SERVICE</span>`;
  const hmLeg  = `<span><span class="kk" style="background:#16305E"></span>HOME · OPPONENT + FIRST PITCH ${esc(tz)}</span>`;
  const awLeg  = `<span><span class="kk" style="background:#EFEDE6"></span>@AWAY</span>`;
  const dayLeg = `<span class="kct">DAY GAME</span>`;
  const dhLeg  = `<span>DH · DOUBLEHEADER</span>`;
  const nsLeg  = `<span><span class="kk" style="background:#F6F4EF;border:1px solid #E4E0D6"></span>NO SERVICE</span>`;
  const legend = isOverlay
    ? [svLeg, nsLeg, hmLeg, dayLeg, dhLeg].join("")
    : [hmLeg, awLeg, dayLeg, dhLeg].join("");

  return `<!doctype html>
<html>
<head>
${sheetHead({ title: `KitchFix SC season`, orientation: "landscape" })}
</head>
<body>
<div class="sheet">
  <div class="band"><img class="seal" src="${seal}" alt="" /><span class="bk">KITCHFIX</span><span class="ba">${bandRight}</span></div>
  <div class="pad">
    <div class="trow">
      <span class="mo">${esc(String(year))} SCHEDULE</span>
      <span class="yr">${esc(rightGhost)}</span>
    </div>
    <div class="smos">
      ${monthBlocks.join("")}
    </div>
    <div class="ft" style="margin-top:14px;">
      <span class="k">${legend}</span>
      <span><span class="asof">AS OF ${esc(asOf)}</span>${isOverlay ? " — SERVED = ACTUALS ENTERED · PROJECTED AFTER" : ""}</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

function buildSeasonMonthCells(year, month, dayRows, accountKey, statusByDate, accountLevel) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const anchor = weekAnchor(first);
  const cells = ["<b>M</b>","<b>T</b>","<b>W</b>","<b>T</b>","<b>F</b>","<b>S</b>","<b>S</b>"];
  for (let i = 0; i < 42; i++) {
    const d = shiftDays(anchor, i);
    const outOfMonth = d.getUTCMonth() !== month - 1 || d.getUTCFullYear() !== year;
    const iso = isoDay(d);
    const dom = d.getUTCDate();
    if (outOfMonth) {
      cells.push(`<span class="x"></span>`);
      continue;
    }
    const row = dayRows[iso];
    // Home game takes priority even on blended (service under the game).
    if (row && row.day_type === "GAME") {
      const timeStr = formatTimeForCell(row, accountKey);
      const day = isDayGame(row, accountKey);
      const dhAffix = row.is_doubleheader ? " DH" : "";
      const timeContent = timeStr ? `${esc(timeStr)}${dhAffix}` : dhAffix.trim();
      const timeClass = day ? "day" : "";
      const timeHtml = timeContent ? `<i class="${timeClass}">${timeContent}</i>` : "";
      cells.push(`<span class="h"><u>${dom}</u><em>${esc(row.opponent || "")}</em>${timeHtml}</span>`);
      continue;
    }
    if (row && row.day_type === "AWAY") {
      cells.push(`<span class="a"><u>${dom}</u><em>${esc(row.opponent || "")}</em></span>`);
      continue;
    }
    // Blended (overlay) accounts: overlay a service layer under
    // non-game days keyed on the classifier state.
    const stat = statusByDate?.[iso];
    if (stat) {
      const svc = seasonServiceState(stat, { accountLevel });
      if (svc === "SERVICE")     { cells.push(`<span class="s"><u>${dom}</u></span>`); continue; }
      if (svc === "NO_SERVICE")  { cells.push(`<span class="o"><u>${dom}</u></span>`); continue; }
      if (svc === "NO_ACTUALS")  { cells.push(`<span class="s"><u>${dom}</u></span>`); continue; }
    }
    cells.push(`<span class="o"><u>${dom}</u></span>`);
  }
  return cells.join("");
}

function monthDayLabel(iso) {
  const d = parseIso(iso);
  return `${MON_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function renderSeasonSheet(ctx) {
  return renderSeasonSheetHtml(ctx);
}
