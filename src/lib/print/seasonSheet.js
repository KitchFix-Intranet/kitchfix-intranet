// Season sheet renderer for the SC print export - overview scope, one
// page per account, ONLY for accounts with a real schedule
// (has_homestand_schedule OR has_schedule_overlay). Overlay accounts
// (STL-FL, TBJ-FL) get the "HOME SCHEDULE" right-ghost variant + the
// H·A month header collapses to "N HOME" - their data is home-only by
// design (66 rows) and the sheet says so honestly; away cells simply
// never occur.
//
// Data source: direct query against sc_homestand_schedule for the
// year. Cheap - ~150 rows/year for MLB clubs, ~200 for AAA, ~66 for
// FSL overlay clubs. One indexed range query, group by month.

import { getServiceClient } from "@/lib/supabase";
import { formatMlbHomeGameTime, formatMilbHomeGameTime, getAccountHomeTz }
  from "@/app/service-calendar/gameTimeFormat";
import { esc, sheetHead, loadSealDataUri, footerDate } from "./assets";

const MON_NAMES_TITLE = [
  "JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
  "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER",
];
const MON_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN",
                   "JUL","AUG","SEP","OCT","NOV","DEC"];

const DAY_MS = 24 * 60 * 60 * 1000;
function shiftDays(d, days) {
  return new Date(d.getTime() + days * DAY_MS);
}
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
function monFirstIndex(d) {
  const js = d.getUTCDay();
  return js === 0 ? 6 : js - 1;
}
function weekAnchor(d) {
  const idx = monFirstIndex(d);
  return shiftDays(d, -idx);
}

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
    const hourStr = parts.find((p) => p.type === "hour")?.value;
    const hour = Number(hourStr);
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
    throw new Error(`Account ${accountKey} has no schedule to print (has_homestand_schedule + has_schedule_overlay both false)`);
  }

  const rowsRes = await supa
    .from("sc_homestand_schedule")
    .select("service_date, day_of_week, day_type, opponent, game_time, day_night, is_doubleheader")
    .eq("account_key", accountKey)
    .gte("service_date", `${year}-01-01`)
    .lte("service_date", `${year}-12-31`)
    .order("service_date", { ascending: true });
  if (rowsRes.error) throw new Error(`loadSeason.rows: ${rowsRes.error.message}`);
  const rows = rowsRes.data || [];

  // Group by month (1-12). For overlay accounts we only ever see GAME
  // rows; for full-schedule accounts we see HOME + AWAY (day_type -
  // "GAME" / "AWAY" / "OFF" per sc-13). Anything not "GAME" or "AWAY"
  // is ignored on the season sheet (OFF cells render hollow anyway).
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

  // Months to render: contiguous span from the first game month through
  // the last. Empty months in between still render (they'll show all
  // hollow cells) so the season shape reads honestly.
  const gameMonths = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
  if (gameMonths.length === 0) {
    throw new Error(`Account ${accountKey} has no schedule rows for ${year}`);
  }
  const firstMonth = gameMonths[0];
  const lastMonth  = gameMonths[gameMonths.length - 1];

  // Season-end date: the max service_date of a GAME or AWAY row.
  let seasonEnd = null;
  for (const r of rows) {
    if (r.day_type === "GAME" || r.day_type === "AWAY") {
      if (!seasonEnd || r.service_date > seasonEnd) seasonEnd = r.service_date;
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
  };
}

// ── Renderer ─────────────────────────────────────────────────────────
export function renderSeasonSheetHtml(ctx) {
  const {
    account, year, firstMonth, lastMonth, byMonth, homeAwayCounts,
    seasonEnd, isOverlay,
  } = ctx;

  const seal = loadSealDataUri();
  const bandRight = esc(account.name || account.team_key);
  const rightGhost = isOverlay ? "HOME SCHEDULE" : (account.level || "").toUpperCase();
  const tz = getAccountHomeTz(account.team_key)?.abbrev || "ET";
  const footerDateStr = footerDate();

  // Trim trailing months where the last month has no games. seasonEnd
  // stays as the "SEASON ENDS" label under the last rendered month.

  const monthBlocks = [];
  for (let m = firstMonth; m <= lastMonth; m++) {
    const dayRows = byMonth[m] || {};
    const monthName = MON_NAMES_TITLE[m - 1];
    const counts = homeAwayCounts[m] || { h: 0, a: 0 };
    const countLabel = isOverlay
      ? `${counts.h} HOME`
      : `${counts.h} H · ${counts.a} A`;

    const cells = buildSeasonMonthCells(year, m, dayRows, account.team_key);
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

  const legendAway = isOverlay ? "" : `<span><span class="ksoft"></span>AWAY</span>`;

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
    <div class="ft" style="margin-top:18px;">
      <span class="k">
        <span><span class="knavy"></span>HOME · OPPONENT + FIRST PITCH ${esc(tz)}</span>
        <span class="kct">DAY GAME</span>
        ${legendAway}
        <span>DH · DOUBLEHEADER</span>
      </span>
      <span>KITCHFIX · ${esc(footerDateStr)}</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

// Build the 7-column mini-grid for one season month. Header row (7
// <b> weekday letters), then Monday-anchored cells running to the end
// of the last week that contains a day of this month. Off cells are
// hollow, home cells navy fill (with opponent + time), away cells
// light fill (with opponent code only, no time).
function buildSeasonMonthCells(year, month, dayRows, accountKey) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const anchor = weekAnchor(first);
  // Six weeks * 7 = 42 cells covers every possible month layout.
  const cells = ["<b>M</b>","<b>T</b>","<b>W</b>","<b>T</b>","<b>F</b>","<b>S</b>","<b>S</b>"];
  for (let i = 0; i < 42; i++) {
    const d = shiftDays(anchor, i);
    const outOfMonth = d.getUTCMonth() !== month - 1 || d.getUTCFullYear() !== year;
    const iso = isoDay(d);
    if (outOfMonth) {
      cells.push(`<span class="o"></span>`);
      continue;
    }
    const row = dayRows[iso];
    if (!row) {
      cells.push(`<span class="o"></span>`);
      continue;
    }
    if (row.day_type === "GAME") {
      const timeStr = formatTimeForCell(row, accountKey);
      const day = isDayGame(row, accountKey);
      const dhAffix = row.is_doubleheader ? " DH" : "";
      const timeContent = timeStr ? `${esc(timeStr)}${dhAffix}` : dhAffix.trim();
      const timeClass = day ? "day" : "";
      const timeHtml = timeContent ? `<i class="${timeClass}">${timeContent}</i>` : "";
      cells.push(`<span class="h"><em>${esc(row.opponent || "")}</em>${timeHtml}</span>`);
      continue;
    }
    if (row.day_type === "AWAY") {
      // Spec: "away cells carry no time anywhere."
      cells.push(`<span class="a"><em>${esc(row.opponent || "")}</em></span>`);
      continue;
    }
    // OFF or unknown - hollow.
    cells.push(`<span class="o"></span>`);
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
