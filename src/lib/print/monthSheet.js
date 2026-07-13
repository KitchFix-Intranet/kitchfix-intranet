// Month + Period sheet renderer for the SC print export.
//
// One template. The Period export just swaps the `.trow` title:
// "MARCH 2026" -> "PERIOD 8" + fiscal-range "FEB 16 – MAR 15",
// with the P-tag replaced by the period number itself. Everything
// below the title row (grid, spring row, P-boundary, NS cells,
// footer) is identical between the two scopes.
//
// Data sources (kept lean - print does not need actuals):
//   - loadMonthData() for the target month(s): gives day.status
//     (so NO SERVICE cells match what the operator sees on-screen)
//     plus period metadata for the P-boundary logic + homestand
//     rows for schedule accounts.
//   - loadScheduleOverlay() supplements loadMonthData for overlay
//     accounts (STL-FL, TBJ-FL) whose HOME games live in
//     sc_homestand_schedule but aren't fetched by loadMonthData
//     (that loader's homestand fetch is gated on has_homestand_schedule).
//   - derivePhaseTimeline() + collectSpringDates() from the shared
//     phaseDerivation module: the same phase source the calendar
//     screen uses, so print + screen agree on where Spring Training
//     runs for each PDC account.

import { getServiceClient } from "@/lib/supabase";
import {
  loadMonthData,
  loadScheduleOverlay,
} from "@/lib/dataStore/serviceCalendar";
import {
  derivePhaseTimeline,
  collectSpringDates,
} from "@/app/service-calendar/season/phaseDerivation";
import { formatMlbHomeGameTime, formatMilbHomeGameTime, getAccountHomeTz }
  from "@/app/service-calendar/gameTimeFormat";
import { esc, sheetHead, loadSealDataUri, footerDate } from "./assets";

// ── Date utilities ───────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const MON_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
                   "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const MON_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN",
                   "JUL","AUG","SEP","OCT","NOV","DEC"];

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

function shiftDays(d, days) {
  return new Date(d.getTime() + days * DAY_MS);
}

function shortMonthDay(d) {
  return `${MON_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Mon-first weekday index. spec uses MON THU WED THU FRI SAT SUN.
// JS getUTCDay(): Sun=0, Mon=1, ... Sat=6. Mon-first: Mon=0, ... Sun=6.
function monFirstIndex(d) {
  const js = d.getUTCDay();
  return js === 0 ? 6 : js - 1;
}

// Monday on or before d.
function weekAnchor(d) {
  const idx = monFirstIndex(d);
  return shiftDays(d, -idx);
}

// ── Period boundary + range utility ──────────────────────────────────
// Period keys are stored in sc_day_metadata.period as bare integers
// (post-2026-07 hotfix). Comparing two adjacent dates' period values
// tells us where the fiscal boundary sits inside a calendar month.
function periodOf(dayRow) {
  if (!dayRow || dayRow.period == null) return null;
  const raw = String(dayRow.period).replace(/^P/i, "").trim();
  return raw ? Number(raw) : null;
}

// Given a period key (e.g. "P8" or 8) and the full year's day-period
// map, return { start, end } as ISO YYYY-MM-DD.
function periodRange(periodMap, periodKey) {
  const target = Number(String(periodKey).replace(/^P/i, ""));
  const dates = Object.keys(periodMap)
    .filter((d) => periodMap[d] === target)
    .sort();
  if (!dates.length) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}

// ── Per-account time formatter selector ──────────────────────────────
// MLB fee accounts have TIMESTAMPTZ game_time -> formatMlbHomeGameTime
// (Intl DateTimeFormat with the account's home tz).
// MiLB per-meal accounts store manually-entered TEXT game_time ->
// formatMilbHomeGameTime (light cleanup, keeps whatever the operator
// typed). Overlay accounts (STL-FL, TBJ-FL) went through sc-15 so
// they use TIMESTAMPTZ + Intl formatter too.
function formatGameTime(gameTime, accountKey, billingModel) {
  if (!gameTime) return "";
  const tz = getAccountHomeTz(accountKey);
  if (tz) return formatMlbHomeGameTime(gameTime, accountKey) || "";
  return formatMilbHomeGameTime(gameTime) || "";
}

// "Day game" = first pitch before 2 PM account-local. Uses the tz
// map because ET/CT accounts produce different UTC->local hour maps
// for the same wall-clock label. Returns null when the game_time is
// missing or unparseable so callers can skip the copper class.
function isDayGame(gameTime, accountKey) {
  if (!gameTime) return null;
  const tz = getAccountHomeTz(accountKey);
  if (tz) {
    const d = new Date(gameTime);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", hour12: false, timeZone: tz.tz,
    }).formatToParts(d);
    const hourStr = parts.find((p) => p.type === "hour")?.value;
    const hour = Number(hourStr);
    if (Number.isNaN(hour)) return null;
    return hour < 14;
  }
  // MiLB text field ("7:05 PM" / "12:05 PM" style). Strip AM/PM and
  // parse the hour.
  const raw = String(gameTime);
  const pmMatch = /pm/i.test(raw);
  const amMatch = /am/i.test(raw);
  const hourMatch = raw.match(/^(\d{1,2})/);
  if (!hourMatch) return null;
  let hour = Number(hourMatch[1]);
  if (pmMatch && hour !== 12) hour += 12;
  if (amMatch && hour === 12) hour = 0;
  return hour < 14;
}

// ── Data loader ──────────────────────────────────────────────────────
// Given accountKey + a date range (inclusive), return everything the
// grid renderer needs.
export async function loadMonthPrintData(accountKey, year, monthKey) {
  const supa = getServiceClient();

  // Account meta - name, level, billing_model, both flags.
  const accountRes = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (accountRes.error) throw new Error(`loadMonthPrint.account: ${accountRes.error.message}`);
  const account = accountRes.data;
  if (!account) throw new Error(`Account not found: ${accountKey}`);

  // Reuse loadMonthData for status derivation + homestand context (for
  // schedule accounts). Kept the light `noWrite: true` option out - we
  // just consume its output.
  //
  // #420 bugfix (2026-07-13, caught by scripts/sc-print/loader-smoke.mjs):
  // loadMonthData expects `month` as a number (or 2-char zero-padded
  // string) - it internally does `String(month).padStart(2, "0")` +
  // `${year}-${m}-01`. Passing the full monthKey ("2026-06") produced
  // "2026-2026-06-01" and threw "invalid input syntax for type date"
  // from the sc_daily_revenue fetch. This bug existed in Wave 1's
  // monthSheet.js from day one but slipped through the browser
  // verification. The Wave 2 regression guard invokes all four print
  // loaders against real Supabase creds so mistyped filters like this
  // one can no longer ship silently.
  const monthNumber = Number(monthKey.slice(5));   // "2026-06" -> 6
  const monthData = await loadMonthData(accountKey, year, monthNumber);

  // Overlay accounts (STL-FL, TBJ-FL) need a separate call - loadMonthData
  // only fetches homestand when has_homestand_schedule is TRUE.
  let overlayMap = {};
  if (account.has_schedule_overlay) {
    const [year4, month2] = monthKey.split("-");
    const first = `${year4}-${month2}-01`;
    const lastDay = new Date(Date.UTC(Number(year4), Number(month2), 0)).getUTCDate();
    const last = `${year4}-${month2}-${String(lastDay).padStart(2, "0")}`;
    overlayMap = await loadScheduleOverlay(accountKey, first, last);
  }

  // Period lookup for THIS month + the next month (in case the month
  // ends mid-period, we need the next month's period boundary sitting
  // at the end for the grid to catch it). Cheap query.
  const [y4, m2] = monthKey.split("-").map(Number);
  const grid = buildMonthGrid(y4, m2);
  const rangeStart = isoDay(grid.firstCell);
  const rangeEnd   = isoDay(grid.lastCell);
  const periodRowsRes = await supa
    .from("sc_day_metadata")
    .select("service_date, period")
    .eq("account_key", accountKey)
    .gte("service_date", rangeStart)
    .lte("service_date", rangeEnd)
    .order("service_date", { ascending: true });
  if (periodRowsRes.error) throw new Error(`loadMonthPrint.periods: ${periodRowsRes.error.message}`);
  const periodMap = {};
  for (const r of periodRowsRes.data || []) {
    const p = periodOf(r);
    if (p != null) periodMap[r.service_date] = p;
  }

  // Homestand: loadMonthData already carried it in via day.homestandId /
  // day.dayType / day.opponent / day.gameTime / day.dayNight for flagged
  // accounts. Re-index by date for a uniform lookup below.
  const homestandByDate = {};
  for (const d of monthData?.days || []) {
    if (d.dayType) {
      homestandByDate[d.date] = {
        dayType:        d.dayType,
        opponent:       d.opponent || "",
        gameTime:       d.gameTime,
        dayNight:       d.dayNight,
        isDoubleheader: !!d.isDoubleheader,
      };
    }
  }
  for (const [date, entry] of Object.entries(overlayMap)) {
    if (entry.dayType === "GAME") {
      homestandByDate[date] = {
        dayType:        "GAME",
        opponent:       entry.opponent || "",
        gameTime:       entry.gameTime,
        dayNight:       entry.dayNight,
        isDoubleheader: !!entry.isDoubleheader,
      };
    }
  }

  // Statuses (for the NS cell) - loadMonthData ran the classifier
  // already. Index by date.
  const statusByDate = {};
  for (const d of monthData?.days || []) {
    if (d.status) statusByDate[d.date] = d.status;
  }

  // Spring block: pull from the same phaseCalendar the on-screen chrome
  // reads. Only fires for PDC accounts.
  const phaseTimeline = derivePhaseTimeline(accountKey, account.level, year);
  const springDates = collectSpringDates(phaseTimeline);

  return {
    account,
    year,
    monthKey,
    grid,
    homestandByDate,
    statusByDate,
    periodMap,
    springDates,
    hasScheduleOverlay: !!account.has_schedule_overlay,
    hasHomestandSchedule: !!account.has_homestand_schedule,
  };
}

// Given a calendar year + 1-indexed month, produce a 6-row grid (42
// cells) starting on the Monday-anchored week that contains the 1st.
// Blank cells are the out-of-month spillover.
function buildMonthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const firstCell = weekAnchor(first);
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const cells = [];
    for (let c = 0; c < 7; c++) {
      const d = shiftDays(firstCell, r * 7 + c);
      cells.push({
        date:            isoDay(d),
        dayOfMonth:      d.getUTCDate(),
        outOfMonth:      d.getUTCMonth() !== (month - 1) || d.getUTCFullYear() !== year,
      });
    }
    rows.push(cells);
  }
  const lastCell = shiftDays(firstCell, 41);
  return { firstCell, lastCell, rows };
}

// ── Renderer ─────────────────────────────────────────────────────────
// Same template for month + period. The caller supplies a `title`
// override for period scope.
export function renderMonthSheetHtml(ctx, opts = {}) {
  const {
    account, year, monthKey, grid, homestandByDate, statusByDate,
    periodMap, springDates, hasScheduleOverlay,
  } = ctx;
  const {
    titleMain,        // "MARCH" (month scope) or "PERIOD 8" (period scope)
    titleTagRight,    // "P8 – P9" (month) or "FEB 16 – MAR 15" (period)
    titleYear,        // 2026 - Bebas ghost (period keeps the year too)
    scopeLabel,       // "month" | "period" - for filename hint only
    tzAbbrev,         // "ET"/"CT"/etc for the legend
  } = opts;

  const [y4, m2] = monthKey.split("-").map(Number);
  const monthNameFull = MON_NAMES[m2 - 1];

  const tzForLegend = tzAbbrev || (getAccountHomeTz(account.team_key)?.abbrev || "ET");
  const seal = loadSealDataUri();

  // Weeks: mark each row as spring if ANY in-month date sits in the
  // spring block; mark a row as pb if it contains the FIRST date of a
  // new period (compared to the previous cell's period).
  let prevPeriod = null;
  let periodBoundaryHtml = null;   // remembered when we set pmark on a cell

  const rowsHtml = grid.rows.map((cells) => {
    let rowIsSpring = false;
    let rowIsPb = false;
    let firstNewPeriodDate = null;
    let firstNewPeriodNum = null;

    for (const c of cells) {
      if (!c.outOfMonth && springDates.has(c.date)) rowIsSpring = true;
      const p = periodMap[c.date];
      if (p != null) {
        if (prevPeriod == null) {
          prevPeriod = p;
        } else if (p !== prevPeriod) {
          rowIsPb = true;
          firstNewPeriodDate = c.date;
          firstNewPeriodNum = p;
          prevPeriod = p;
        }
      }
    }

    const rowClass = [
      rowIsSpring ? "spr" : "",
      rowIsPb ? "pb" : "",
    ].filter(Boolean).join(" ");

    const cellsHtml = cells.map((c) => {
      if (c.outOfMonth) {
        return `<td class="blank"><span class="d">${c.dayOfMonth}</span></td>`;
      }
      const isNs = statusByDate[c.date] === "no-service";
      const home = homestandByDate[c.date];
      const isSpringCell = springDates.has(c.date);
      const pmark = (c.date === firstNewPeriodDate)
        ? `<span class="pmark">P${firstNewPeriodNum}</span>`
        : "";

      // Priority: NO SERVICE > HOME GAME > blank-in-month.
      // Spring row applies bottom copper on ALL non-blank cells in the
      // row via the CSS selector - no per-cell class needed.
      if (isNs) {
        return `<td class="ns"><span class="d">${c.dayOfMonth}</span>${pmark}<span class="nst">NO SERVICE</span></td>`;
      }
      if (home && home.dayType === "GAME") {
        const timeStr = formatGameTime(home.gameTime, account.team_key, account.billing_model);
        const day = isDayGame(home.gameTime, account.team_key);
        const timeClass = day ? "tm day" : "tm";
        const oppLabel = home.opponent
          ? (home.isDoubleheader ? `${esc(home.opponent)} · DH` : esc(home.opponent))
          : "";
        const oppHtml = oppLabel ? `<span class="opp">${oppLabel}</span>` : "";
        const timeHtml = timeStr ? `<span class="${timeClass}">${esc(timeStr)}</span>` : "";
        return `<td class=""><span class="d">${c.dayOfMonth}</span>${pmark}${oppHtml}${timeHtml}</td>`;
      }
      return `<td class=""><span class="d">${c.dayOfMonth}</span>${pmark}</td>`;
    }).join("");

    return `<tr class="${rowClass}">${cellsHtml}</tr>`;
  }).join("");

  const bandRight = esc(account.name || account.team_key);
  const titleMonth = titleMain || monthNameFull;
  const titleTag  = titleTagRight != null ? titleTagRight : (calcMonthPTag(periodMap, m2, y4));
  const titleYearStr = titleYear != null ? titleYear : year;

  const footerDateStr = footerDate();

  return `<!doctype html>
<html>
<head>
${sheetHead({ title: `KitchFix SC ${scopeLabel || "month"}`, orientation: "landscape" })}
</head>
<body>
<div class="sheet">
  <div class="band"><img class="seal" src="${seal}" alt="" /><span class="bk">KITCHFIX</span><span class="ba">${bandRight}</span></div>
  <div class="pad">
    <div class="trow">
      <span class="mo">${esc(titleMonth)}</span>
      ${titleTag ? `<span class="ptag">${esc(titleTag)}</span>` : ""}
      <span class="yr">${esc(String(titleYearStr))}</span>
    </div>
    <table class="cal">
      <tr><th>MON</th><th>TUE</th><th>WED</th><th>THU</th><th>FRI</th><th>SAT</th><th>SUN</th></tr>
      ${rowsHtml}
    </table>
    <div class="ft">
      <span class="k">
        <span><span class="knavy"></span>HOME · FIRST PITCH ${esc(tzForLegend)}</span>
        <span class="kct">DAY GAME</span>
        <span><span class="ksoft"></span>NO SERVICE</span>
        <span><span class="kcop"></span>SPRING TRAINING</span>
      </span>
      <span>KITCHFIX · ${esc(footerDateStr)}</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

// Derive the month title's P-tag when scope = month. Returns the range
// "P8 – P9" if the month spans two periods; "P8" if only one; "" if
// there is no period data at all.
function calcMonthPTag(periodMap) {
  const seen = new Set();
  for (const p of Object.values(periodMap)) if (p != null) seen.add(p);
  const nums = [...seen].sort((a, b) => a - b);
  if (nums.length === 0) return "";
  if (nums.length === 1) return `P${nums[0]}`;
  return `P${nums[0]} – P${nums[nums.length - 1]}`;
}

// ── Period-scope helpers ─────────────────────────────────────────────
// Kevin's brief: Month + Period share ONE template. The Period scope
// swaps the title row to "PERIOD 8" + fiscal-range "FEB 16 – MAR 15"
// while everything below is identical. To make the grid line up with
// the fiscal range, load the calendar month(s) that contain the
// period range and let the grid render as it would for any month
// (blank cells fill the spillover).

export async function loadPeriodPrintData(accountKey, year, periodKey) {
  const supa = getServiceClient();
  const targetPeriodNum = Number(String(periodKey).replace(/^P/i, ""));

  // Find every day this year with period == target. Cheap - one row per
  // service_date.
  const rowsRes = await supa
    .from("sc_day_metadata")
    .select("service_date, period")
    .eq("account_key", accountKey)
    .gte("service_date", `${year}-01-01`)
    .lte("service_date", `${year}-12-31`)
    .order("service_date", { ascending: true });
  if (rowsRes.error) throw new Error(`loadPeriodPrint.range: ${rowsRes.error.message}`);
  const periodDates = (rowsRes.data || [])
    .filter((r) => periodOf(r) === targetPeriodNum)
    .map((r) => r.service_date);
  if (periodDates.length === 0) {
    throw new Error(`Period P${targetPeriodNum} has no metadata rows in ${year}`);
  }
  const startDate = periodDates[0];
  const endDate = periodDates[periodDates.length - 1];

  // Load the calendar month that CONTAINS the period start. Kevin's
  // spec pictures a single-page period grid; if a period spans two
  // calendar months, we still render one month page (the one that
  // holds the period's majority - the start date's month). Extension
  // to a 2-month grid is a follow-up polish.
  const startMonth = startDate.slice(0, 7);
  const monthCtx = await loadMonthPrintData(accountKey, year, startMonth);

  // Filter the grid + status: cells outside the period range render
  // as "blank" so the visual grid shows just the fiscal period. The
  // month name in the title becomes the fiscal range.
  return {
    ...monthCtx,
    periodNum: targetPeriodNum,
    periodStart: startDate,
    periodEnd:   endDate,
  };
}

export function renderPeriodSheetHtml(ctx) {
  const { periodNum, periodStart, periodEnd } = ctx;
  const startD = parseIso(periodStart);
  const endD   = parseIso(periodEnd);
  const range = `${shortMonthDay(startD)} – ${shortMonthDay(endD)}`;
  return renderMonthSheetHtml(ctx, {
    titleMain:     `PERIOD ${periodNum}`,
    titleTagRight: range,
    titleYear:     ctx.year,
    scopeLabel:    "period",
    tzAbbrev:      getAccountHomeTz(ctx.account.team_key)?.abbrev,
  });
}

// Public export used by the print route for the month scope.
export function renderMonthSheet(ctx) {
  return renderMonthSheetHtml(ctx, {
    scopeLabel: "month",
    tzAbbrev:   getAccountHomeTz(ctx.account.team_key)?.abbrev,
  });
}
