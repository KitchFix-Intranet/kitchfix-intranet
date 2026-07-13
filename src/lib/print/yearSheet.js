// Year sheet renderer for the SC print export - Wave 2.
//
// Letter portrait; band + oversized Bebas "2026" with ghost "YEAR"
// per docs/design/SC_PRINT_SPEC_v1.html Sheet 3 (still the pixel
// authority). Twelve mini-months in a 3-column grid; each mini-month
// is a 28-cell (7-column x 4-row) sparkline of the account's service
// rhythm.
//
// Cell grammar (fill classes are defined in the shared CSS from
// src/lib/print/assets.js, copied verbatim from the spec):
//   svc default = tan #E9E6DC        (any day the account operates)
//   .sp         = copper wash #EFC5A9 (day inside a Spring Training block)
//   .gm         = solid navy #16305E  (home game day - option A ruling)
//   .of         = hollow hairline     (non-service / off day)
//
// Spring + game coexistence: the navy fill just punches into the
// copper field - no combined class is needed because the surrounding
// copper cells carry the spring band on their own. Priority order
// (highest -> lowest): game > spring > weekday-off default.
//
// HOME games only. Homestand accounts carry AWAY rows (sc-13) but the
// navy fill keys on day_type='GAME' just like the sc-18 wedge does -
// away days render as ordinary service or off.
//
// Offseason honesty (derived, not hardcoded):
//   - Only schedule accounts (has_homestand_schedule ||
//     has_schedule_overlay) are eligible for offseason collapse.
//   - A month is "empty" iff it has ZERO home games AND ZERO spring
//     days.
//   - Trailing contiguous empty months at year-end collapse into a
//     single "OFFSEASON - {MON} - {MON}" panel spanning the full
//     3-column grid.
//   - Non-trailing empty months (e.g. a bare January before a
//     February start) still render as 28 tan cells for calendar
//     completeness.
//   - Per-meal PDCs without schedules (e.g. CIN - AZ) fall through
//     the eligibility gate - they render all 12 months even if games
//     are absent. Flagged in the PR body; their "empty" months carry
//     spring cells (Feb/Mar for the 5 PDC accounts) which is exactly
//     the "service rhythm on a page" framing Kevin asked for.

import { getServiceClient } from "@/lib/supabase";
import {
  derivePhaseTimeline,
  collectSpringDates,
} from "@/app/service-calendar/season/phaseDerivation";
import { esc, sheetHead, loadSealDataUri, footerDate } from "./assets";

const MON3 = ["JAN","FEB","MAR","APR","MAY","JUN",
              "JUL","AUG","SEP","OCT","NOV","DEC"];

// ── Data loader ──────────────────────────────────────────────────────
export async function loadYearPrintData(accountKey, year) {
  const supa = getServiceClient();

  const accountRes = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (accountRes.error) throw new Error(`loadYear.account: ${accountRes.error.message}`);
  const account = accountRes.data;
  if (!account) throw new Error(`Account not found: ${accountKey}`);

  const homeDates = new Set();
  if (account.has_homestand_schedule || account.has_schedule_overlay) {
    // ONE query for the whole year, HOME rows only. Cheap - even the
    // widest MLB slate is ~81 home dates.
    const rowsRes = await supa
      .from("sc_homestand_schedule")
      .select("service_date, day_type")
      .eq("account_key", accountKey)
      .gte("service_date", `${year}-01-01`)
      .lte("service_date", `${year}-12-31`)
      .eq("day_type", "GAME");
    if (rowsRes.error) throw new Error(`loadYear.games: ${rowsRes.error.message}`);
    for (const r of rowsRes.data || []) homeDates.add(r.service_date);
  }

  // Spring block: same phaseCalendar source the on-screen chrome + the
  // Month sheet's spring band read.
  const phaseTimeline = derivePhaseTimeline(accountKey, account.level, year);
  const springDates = collectSpringDates(phaseTimeline);

  return {
    account,
    year,
    homeDates,
    springDates,
    hasSchedule: !!(account.has_homestand_schedule || account.has_schedule_overlay),
  };
}

// ── Renderer ─────────────────────────────────────────────────────────
export function renderYearSheet(ctx) {
  const { account, year, homeDates, springDates, hasSchedule } = ctx;

  const seal = loadSealDataUri();
  const bandRight = esc(account.name || account.team_key);
  const footerDateStr = footerDate();

  // Per-month emptiness: no home games in that month AND no spring
  // days in that month. Applies only when the account has a schedule
  // (schedule accounts get honest offseason panels; per-meal PDCs
  // render all 12 months as their service rhythm).
  const monthEmpty = new Array(13).fill(true); // 1-indexed, [0] unused
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    for (const d of homeDates) {
      if (d.slice(5, 7) === mm) { monthEmpty[m] = false; break; }
    }
    if (monthEmpty[m]) {
      for (const d of springDates) {
        if (d.slice(5, 7) === mm) { monthEmpty[m] = false; break; }
      }
    }
  }

  // Trailing empty months (for the collapse panel). Only fires when
  // the account carries a schedule; per-meal PDCs render all 12
  // months for calendar completeness.
  let firstCollapseMonth = 13;
  if (hasSchedule) {
    let m = 12;
    while (m >= 1 && monthEmpty[m]) {
      firstCollapseMonth = m;
      m--;
    }
  }
  // Only collapse a run of at least 2 trailing months. A single empty
  // month at year-end reads better as an empty mini-grid than as a
  // one-month "OFFSEASON" banner.
  const collapseCount = 13 - firstCollapseMonth;
  const doCollapse = hasSchedule && collapseCount >= 2;
  const collapseStart = doCollapse ? firstCollapseMonth : 13;

  const monthBlocks = [];
  for (let m = 1; m < (doCollapse ? collapseStart : 13); m++) {
    monthBlocks.push(renderYearMonth(year, m, homeDates, springDates));
  }
  if (doCollapse) {
    const start = MON3[collapseStart - 1];
    const end   = MON3[11];
    monthBlocks.push(`<div class="offpanel">OFFSEASON · ${esc(start)} – ${esc(end)}</div>`);
  }

  return `<!doctype html>
<html>
<head>
${sheetHead({ title: `KitchFix SC year`, orientation: "portrait" })}
</head>
<body>
<div class="sheet port">
  <div class="band"><img class="seal" src="${seal}" alt="" /><span class="bk">KITCHFIX</span><span class="ba">${bandRight}</span></div>
  <div class="pad">
    <div class="trow">
      <span class="mo">${esc(String(year))}</span>
      <span class="yr">YEAR</span>
    </div>
    <div class="ymos">
      ${monthBlocks.join("")}
    </div>
    <div class="ft" style="margin-top:16px;">
      <span class="k">
        <span><span style="display:inline-block;width:9px;height:9px;background:#EFC5A9;border-radius:2px;margin-right:5px;vertical-align:-1px;"></span>SPRING TRAINING</span>
        <span><span class="knavy"></span>HOME GAME</span>
        <span><span style="display:inline-block;width:9px;height:9px;background:#E9E6DC;border-radius:2px;margin-right:5px;vertical-align:-1px;"></span>SERVICE DAY</span>
      </span>
      <span>KITCHFIX · ${esc(footerDateStr)}</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

// One .ymo block: header + 28-cell sparkline. Cells 1-28 are simply
// days 1-28 of the month (spec caps at 28 - months with 29-31 days
// drop the tail per the mockup's visual density).
//
// Priority: game > spring > weekday-off default > service.
// The "weekday-off default" = every 7th cell (col 7 of each of the 4
// rows) mirrors the spec's stylized Sunday-off rhythm; real games /
// spring days override.
function renderYearMonth(year, month, homeDates, springDates) {
  const monthLabel = MON3[month - 1];
  const cells = [];
  const CAP = 28;
  for (let d = 1; d <= CAP; d++) {
    const dd = String(d).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    const iso = `${year}-${mm}-${dd}`;
    let cls = "";
    if (homeDates.has(iso)) {
      cls = "gm";
    } else if (springDates.has(iso)) {
      cls = "sp";
    } else if (d % 7 === 0) {
      // Column 7 default per the spec mockup.
      cls = "of";
    }
    cells.push(`<i class="${cls}"></i>`);
  }
  return `<div class="ymo"><h5>${esc(monthLabel)}</h5><div class="ygg">${cells.join("")}</div></div>`;
}
