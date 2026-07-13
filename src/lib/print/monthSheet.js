// Month + Period sheet renderer for the SC print export.
//
// #422 (Wave 3, 2026-07-13): rewritten to SC_PRINT_SPEC_v2. One
// template, four variants keyed on account shape:
//
//   MLB   - MLB fee accounts + AAA fee accounts: home fill (#DCE5F3)
//           + away fill (#EFEDE6) + opponent + time. NO state fills.
//           NO meal stack. Boundary lines and in-grid P-marks REMOVED
//           (approved as spec Sheet 5, untouched).
//   AAA   - MiLB / AAA per-meal accounts: full state-fill grid
//           (SERVED / PROJECTED / NO ACTUALS / NO SERVICE) + game
//           overlay (home fill + opponent + time). NO meal stack.
//           Spec Sheet 6 grammar.
//   PDCO  - PDC overlay accounts (STL - FL, TBJ - FL): state-fill
//           grid + game overlay (HOME only per sc-17 hard rule).
//           Same grammar as AAA. Spec Sheet 6.
//   PDC   - Per-meal PDC without games (CIN - AZ, TXR - AZ, TBR - FL):
//           state-fill grid + right-aligned meal stack (per-service
//           actual/projected count with hairline rule + bold total).
//           No game overlay. Spec Sheet 7.
//
// Period scope reuses the chosen variant with a fiscal-range title
// swap; the grid renders the calendar month containing the period
// start. Spec Sheet 8.
//
// Grammar removals from v1: fiscal period boundary line (2px navy top
// rule) + in-grid Pn corner mark. Both retired; period structure now
// lives on the Period sheet's title only, per Kevin's ruling
// 2026-07-13. Spring styling: title-row copper chip when the scope
// intersects a spring block; NO per-cell wash or bottom band at month
// scale (that treatment is Ops Calendar only in v2).

import { getServiceClient } from "@/lib/supabase";
import {
  loadMonthData,
  loadHomestandContext,
  loadScheduleOverlay,
} from "@/lib/dataStore/serviceCalendar";
import {
  derivePhaseTimeline,
  collectSpringDates,
  rangeIntersectsSpring,
} from "@/app/service-calendar/season/phaseDerivation";
import { formatMlbHomeGameTime, formatMilbHomeGameTime, getAccountHomeTz }
  from "@/app/service-calendar/gameTimeFormat";
import {
  esc, sheetHead, loadSealDataUri, footerDate, resolveDayState,
} from "./assets";

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
function shiftDays(d, days) { return new Date(d.getTime() + days * DAY_MS); }
function shortMonthDay(d) { return `${MON_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`; }
function monFirstIndex(d) { const js = d.getUTCDay(); return js === 0 ? 6 : js - 1; }
function weekAnchor(d) { return shiftDays(d, -monFirstIndex(d)); }

// ── Period helpers ───────────────────────────────────────────────────
function periodOf(dayRow) {
  if (!dayRow || dayRow.period == null) return null;
  const raw = String(dayRow.period).replace(/^P/i, "").trim();
  return raw ? Number(raw) : null;
}

// ── Per-account time formatter selector ──────────────────────────────
function formatGameTime(gameTime, accountKey) {
  if (!gameTime) return "";
  const tz = getAccountHomeTz(accountKey);
  if (tz) return formatMlbHomeGameTime(gameTime, accountKey) || "";
  return formatMilbHomeGameTime(gameTime) || "";
}

function isDayGame(gameTime, accountKey) {
  if (!gameTime) return null;
  const tz = getAccountHomeTz(accountKey);
  if (tz) {
    const d = new Date(gameTime);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", hour12: false, timeZone: tz.tz,
    }).formatToParts(d);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    if (Number.isNaN(hour)) return null;
    return hour < 14;
  }
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

// ── Variant selector ────────────────────────────────────────────────
// Uses the account's level + billing_model + schedule flags to pick
// the render variant that matches SC_PRINT_SPEC_v2 sheets 5 / 6 / 7.
function pickVariant(account) {
  if (account.level === "MLB") return "MLB";
  if (account.has_schedule_overlay) return "PDCO";
  if (account.has_homestand_schedule) return "AAA";
  return "PDC";
}

// ── Data loader ──────────────────────────────────────────────────────
export async function loadMonthPrintData(accountKey, year, monthKey) {
  const supa = getServiceClient();

  const accountRes = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (accountRes.error) throw new Error(`loadMonthPrint.account: ${accountRes.error.message}`);
  const account = accountRes.data;
  if (!account) throw new Error(`Account not found: ${accountKey}`);

  // #420 bugfix (2026-07-13): loadMonthData expects the month as a
  // number, not the full "YYYY-MM" string. See PR #421 for the guard.
  const monthNumber = Number(monthKey.slice(5));
  const monthData = await loadMonthData(accountKey, year, monthNumber);

  const first = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const last = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  // R1 (2026-07-13, corrective wave): games into month sheets at the
  // PRINT loader. loadMonthData does NOT propagate homestand fields to
  // day rows (PRINT_DATA_CENSUS.md §D.3), so the previous
  // monthData.days[i].dayType mapping loop was dead code -
  // homestandByDate stayed empty for every schedule account, and MLB /
  // AAA month sheets rendered blank (Bugs 1+2). Fetch now goes direct
  // to sc_homestand_schedule via the existing helpers, keyed on the
  // account flags:
  //   has_homestand_schedule -> loadHomestandContext (GAME + AWAY)
  //   has_schedule_overlay   -> loadScheduleOverlay (GAME only per sc-17)
  // Both feed the same homestandByDate map; overlay entries synthesize
  // dayType: "GAME" so the render path sees one uniform shape.
  const homestandByDate = {};
  if (account.has_homestand_schedule) {
    const ctx = await loadHomestandContext(accountKey, first, last);
    for (const [date, entry] of Object.entries(ctx)) {
      homestandByDate[date] = {
        dayType:        entry.dayType,
        opponent:       entry.opponent || "",
        gameTime:       entry.gameTime,
        dayNight:       entry.dayNight,
        isDoubleheader: !!entry.isDoubleheader,
      };
    }
  }
  if (account.has_schedule_overlay) {
    const overlay = await loadScheduleOverlay(accountKey, first, last);
    for (const [date, entry] of Object.entries(overlay)) {
      homestandByDate[date] = {
        dayType:        "GAME",
        opponent:       entry.opponent || "",
        gameTime:       entry.gameTime,
        dayNight:       entry.dayNight,
        isDoubleheader: !!entry.isDoubleheader,
      };
    }
  }

  const grid = buildMonthGrid(year, monthNumber);

  // Per-date lookups: state (from classifier), per-service actuals /
  // projections (for the PDC meal stack), period metadata.
  const statusByDate = {};
  const servicesByDate = {};
  for (const d of monthData?.days || []) {
    if (d.status) statusByDate[d.date] = {
      status:        d.status,
      hasActuals:    !!d.hasActuals,
      hasProjection: !!d.hasProjection,
      isPast:        !!d.isPast,
    };
    if (Array.isArray(d.services) && d.services.length > 0) {
      servicesByDate[d.date] = d.services;
    }
  }

  // Period metadata for the P-tag (Month) or period-range title (Period).
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

  // Spring block (for the copper title chip on PDC variants).
  const phaseTimeline = derivePhaseTimeline(accountKey, account.level, year);
  const springDates   = collectSpringDates(phaseTimeline);
  const monthFirst    = `${monthKey}-01`;
  const monthLastDay  = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthLast     = `${monthKey}-${String(monthLastDay).padStart(2, "0")}`;
  const monthIntersectsSpring = rangeIntersectsSpring(phaseTimeline, monthFirst, monthLast);

  // R4 density: count the max services that would render on any single
  // day this month (services with !isNonRevenue and either projectedCount
  // > 0 or actualCount > 0). If it exceeds MEAL_STACK_LINE_CEILING the
  // table renders with the .dense class -> 6.5px line size floor. Emit
  // a console.warn so operations knows which month hit the floor.
  const variant = pickVariant(account);
  const wantsStack = (variant === "PDC" || variant === "PDCO" || variant === "AAA");
  const mealStackMax = wantsStack ? computeMealStackDensity(servicesByDate) : 0;
  const denseStack = mealStackMax > MEAL_STACK_LINE_CEILING;
  if (denseStack) {
    console.warn(
      `[print/monthSheet] ${accountKey} ${monthKey}: densest day carries ${mealStackMax} services - stepping to 6.5px floor`
    );
  }

  return {
    account,
    year,
    monthKey,
    grid,
    homestandByDate,
    statusByDate,
    servicesByDate,
    periodMap,
    springDates,
    monthIntersectsSpring,
    variant,
    mealStackMax,
    denseStack,
  };
}

// Threshold set at 4: five-service days trigger .dense (6.5px floor).
// The 5-row stack + Total row + game info (opp+time on .hm cells) does
// not fit in the 56px reservation at 7px line size (63px required);
// 6.5px steps it to 56.2px, which fits within a 108px cell height.
const MEAL_STACK_LINE_CEILING = 4;

function computeMealStackDensity(servicesByDate) {
  let max = 0;
  for (const services of Object.values(servicesByDate)) {
    let count = 0;
    for (const s of services) {
      if (s.isNonRevenue) continue;
      const proj = Number(s.projectedCount) || 0;
      const act  = Number(s.actualCount)    || 0;
      if (proj > 0 || act > 0) count++;
    }
    if (count > max) max = count;
  }
  return max;
}

function buildMonthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const firstCell = weekAnchor(first);
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const cells = [];
    for (let c = 0; c < 7; c++) {
      const d = shiftDays(firstCell, r * 7 + c);
      cells.push({
        date:       isoDay(d),
        dayOfMonth: d.getUTCDate(),
        outOfMonth: d.getUTCMonth() !== (month - 1) || d.getUTCFullYear() !== year,
      });
    }
    rows.push(cells);
  }
  const lastCell = shiftDays(firstCell, 41);
  return { firstCell, lastCell, rows };
}

// ── Renderer ────────────────────────────────────────────────────────
export function renderMonthSheetHtml(ctx, opts = {}) {
  const {
    account, year, monthKey, grid, homestandByDate, statusByDate,
    servicesByDate, periodMap, monthIntersectsSpring, variant, denseStack,
  } = ctx;
  const {
    titleMain, titleTagRight, titleYear, scopeLabel, tzAbbrev,
  } = opts;

  const [y4, m2] = monthKey.split("-").map(Number);
  const monthNameFull = MON_NAMES[m2 - 1];
  const tzForLegend = tzAbbrev || (getAccountHomeTz(account.team_key)?.abbrev || "ET");
  const seal = loadSealDataUri();
  const asOf = footerDate();

  const rowsHtml = grid.rows.map((cells) => {
    const cellsHtml = cells.map((c) => renderCell(c, {
      account, homestandByDate, statusByDate, servicesByDate, variant,
    })).join("");
    return `<tr>${cellsHtml}</tr>`;
  }).join("");

  const bandRight = esc(account.name || account.team_key);
  const titleMonth = titleMain || monthNameFull;
  const titleTag = titleTagRight != null ? titleTagRight : calcMonthPTag(periodMap);
  const titleYearStr = titleYear != null ? titleYear : year;
  // Spring copper chip fires when the current scope intersects a spring
  // block AND the variant is a PDC variant (spring only applies to PDCs).
  const isPdcVariant = variant === "PDC" || variant === "PDCO";
  const springChip = (isPdcVariant && monthIntersectsSpring)
    ? `<span class="schip">SPRING TRAINING</span>`
    : "";

  // Legend copy per variant.
  const legend = variantLegend(variant, tzForLegend);

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
      ${springChip}
      <span class="yr">${esc(String(titleYearStr))}</span>
    </div>
    <table class="cal${denseStack ? " dense" : ""}">
      <tr><th>MON</th><th>TUE</th><th>WED</th><th>THU</th><th>FRI</th><th>SAT</th><th>SUN</th></tr>
      ${rowsHtml}
    </table>
    <div class="ft">
      <span class="k">${legend}</span>
      <span><span class="asof">AS OF ${esc(asOf)}</span> — SERVED = ACTUALS ENTERED · PROJECTED AFTER</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ── Cell renderer (variant-aware) ────────────────────────────────────
function renderCell(c, { account, homestandByDate, statusByDate, servicesByDate, variant }) {
  if (c.outOfMonth) return `<td class="blank"><span class="d">${c.dayOfMonth}</span></td>`;

  const home = homestandByDate[c.date];
  const stat = statusByDate[c.date];
  // R5 superseded: MLB accounts route around state mapping in the
  // resolver. Threading accountLevel keeps the safety consistent even
  // though the MLB branch below already skips state.
  const state = stat ? resolveDayState(stat, { accountLevel: account.level }) : null;

  // ── MLB variant: home/away fills only, no state grid, no meal stack.
  if (variant === "MLB") {
    if (home && home.dayType === "GAME") {
      return renderGameCell(c, home, account, "hm");
    }
    if (home && home.dayType === "AWAY") {
      return renderAwayCell(c, home);
    }
    return `<td class=""><span class="d">${c.dayOfMonth}</span></td>`;
  }

  // ── AAA / PDCO / PDC variants: state grid + game overlay + meal stack.
  const gameCell = home && home.dayType === "GAME";
  const awayCell = home && home.dayType === "AWAY";
  const wantsStack = (variant === "PDC" || variant === "PDCO" || variant === "AAA");

  if (gameCell) {
    // R6 (2026-07-13): past game days without actuals render as
    // NO ACTUALS (copper) with game info still visible (opp + time).
    // No meal stack - projections don't print on past days.
    if (state === "NO_ACTUALS") {
      return renderGameCell(c, home, account, "nd");
    }
    // Home game overrides state fill (navy-tint fill + game info + stack).
    const mealStack = (wantsStack && servicesByDate[c.date])
      ? renderMealStack(servicesByDate[c.date], state)
      : "";
    return renderGameCell(c, home, account, "hm", mealStack);
  }
  if (awayCell) {
    // R1 (2026-07-13): AAA + PDCO away days render --awayfill + grey
    // @OPP like the approved MLB Sheet 5. If the day carries service
    // counts, the meal stack overlays on top (R4). Was falling through
    // to renderStateCell(state=null) -> plain white cell with no away
    // visual.
    const mealStack = (wantsStack && servicesByDate[c.date])
      ? renderMealStack(servicesByDate[c.date], state)
      : "";
    return renderAwayCell(c, home, mealStack);
  }

  return renderStateCell(c, state, variant, servicesByDate[c.date]);
}

function renderGameCell(c, home, account, cls, extraStack = "") {
  const timeStr = formatGameTime(home.gameTime, account.team_key);
  const day = isDayGame(home.gameTime, account.team_key);
  const timeClass = day ? "tm day" : "tm";
  const oppLabel = home.opponent
    ? (home.isDoubleheader ? `${esc(home.opponent)} · DH` : esc(home.opponent))
    : "";
  const oppHtml = oppLabel ? `<span class="opp">${oppLabel}</span>` : "";
  const timeHtml = timeStr ? `<span class="${timeClass}">${esc(timeStr)}</span>` : "";
  return `<td class="${cls}"><span class="d">${c.dayOfMonth}</span>${oppHtml}${timeHtml}${extraStack}</td>`;
}

function renderAwayCell(c, home, extraStack = "") {
  // Away opponent uses .awy (grey #A9A499) not .opp (navy). Spec
  // Sheet 5 (approved) grammar. The navy-vs-grey greyscale contrast
  // is the load-bearing home/away signal on paper.
  const opp = home.opponent ? `@${esc(home.opponent)}` : "";
  const oppHtml = opp ? `<span class="awy">${opp}</span>` : "";
  return `<td class="aw"><span class="d">${c.dayOfMonth}</span>${oppHtml}${extraStack}</td>`;
}

function renderStateCell(c, state, variant, services) {
  const wantsStack = (variant === "PDC" || variant === "PDCO" || variant === "AAA");
  const mealStack = (wantsStack && services)
    ? renderMealStack(services, state)
    : "";
  switch (state) {
    case "SERVED":
      return `<td class="sv"><span class="d">${c.dayOfMonth}</span>${mealStack}</td>`;
    case "PROJECTED":
      return `<td class="pj"><span class="d">${c.dayOfMonth}</span>${mealStack}</td>`;
    case "NO_ACTUALS":
      return `<td class="nd"><span class="d">${c.dayOfMonth}</span><span class="ndt">NO ACTUALS</span></td>`;
    case "NO_SERVICE":
      return `<td class="ns"><span class="d">${c.dayOfMonth}</span><span class="nst">NO SERVICE</span></td>`;
    default:
      return `<td><span class="d">${c.dayOfMonth}</span></td>`;
  }
}

// Meal stack: full-cell-width rows per service - name left, count right.
// Grammar per docs/design/SC_PRINT_MEALSTACK_ADDENDUM.html:
//   <span class="msl [pj]">
//     <span class="r"><n>ServiceName</n><v>Count</v></span>...
//     <span class="t"><n>Total</n><v>Sum</v></span>
//   </span>
// Service names print VERBATIM - case preserved. "Pre-game" (STL - FL)
// stays distinct from "Pre-Game" (TBJ - FL). Long names wrap to two
// lines via overflow-wrap:anywhere; never clipped.
//
// Includes every service that carries a non-zero value for the state's
// key AND is_non_revenue = false. Exclusion is is_non_revenue ONLY -
// the pre-corrective wave name-regex is retired (R3, 2026-07-13). Flat-
// fee services (Coffee Service, Fountain Bev) print like any other
// row when they carry counts.
function renderMealStack(services, state) {
  const pj = state === "PROJECTED";
  const cls = pj ? "msl pj" : "msl";
  const key = pj ? "projectedCount" : "actualCount";

  const rows = [];
  let total = 0;
  for (const s of services) {
    if (s.isNonRevenue) continue;
    const v = Number(s[key]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!s.serviceName) continue;
    rows.push({ name: s.serviceName, v });
    total += v;
  }
  if (rows.length === 0) return "";

  const lines = rows
    .map((r) => `<span class="r"><n>${esc(r.name)}</n><v>${r.v}</v></span>`)
    .join("");
  return `<span class="${cls}">${lines}<span class="t"><n>Total</n><v>${total}</v></span></span>`;
}

function variantLegend(variant, tzAbbrev) {
  const svLeg    = `<span><span class="kk" style="background:#D3E2C8"></span>SERVED</span>`;
  const pjLeg    = `<span><span class="kk" style="background:#EBF3E4;border:1px solid #A8C796"></span>PROJECTED</span>`;
  const ndLeg    = `<span><span class="kk" style="background:#FBF1EA"></span>NO ACTUALS</span>`;
  const nsLeg    = `<span><span class="kk" style="background:#F6F4EF;border:1px solid #E4E0D6"></span>NO SERVICE</span>`;
  const hmLeg    = `<span><span class="kk" style="background:#DCE5F3"></span>HOME · FIRST PITCH ${esc(tzAbbrev)}</span>`;
  const awLeg    = `<span><span class="kk" style="background:#EFEDE6"></span>@AWAY</span>`;
  const dayLeg   = `<span class="kct">DAY GAME</span>`;
  if (variant === "MLB") {
    return [hmLeg, awLeg, dayLeg].join("");
  }
  return [svLeg, pjLeg, ndLeg, nsLeg, hmLeg, dayLeg].join("");
}

function calcMonthPTag(periodMap) {
  const seen = new Set();
  for (const p of Object.values(periodMap)) if (p != null) seen.add(p);
  const nums = [...seen].sort((a, b) => a - b);
  if (nums.length === 0) return "";
  if (nums.length === 1) return `P${nums[0]}`;
  return `P${nums[0]} – P${nums[nums.length - 1]}`;
}

// ── Period-scope helpers (unchanged shape from Wave 1) ───────────────
export async function loadPeriodPrintData(accountKey, year, periodKey) {
  const supa = getServiceClient();
  const targetPeriodNum = Number(String(periodKey).replace(/^P/i, ""));

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
  const endDate   = periodDates[periodDates.length - 1];
  const startMonth = startDate.slice(0, 7);
  const monthCtx = await loadMonthPrintData(accountKey, year, startMonth);
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
  const range  = `${shortMonthDay(startD)} – ${shortMonthDay(endD)}`;
  return renderMonthSheetHtml(ctx, {
    titleMain:     `PERIOD ${periodNum}`,
    titleTagRight: range,
    titleYear:     ctx.year,
    scopeLabel:    "period",
    tzAbbrev:      getAccountHomeTz(ctx.account.team_key)?.abbrev,
  });
}

export function renderMonthSheet(ctx) {
  return renderMonthSheetHtml(ctx, {
    scopeLabel: "month",
    tzAbbrev:   getAccountHomeTz(ctx.account.team_key)?.abbrev,
  });
}
