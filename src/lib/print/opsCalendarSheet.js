// Ops Calendar sheet renderer for the SC print export.
//
// #422 (Wave 3, 2026-07-13): replaces v1's "year at a glance" sparkline
// grammar entirely. Spec Sheet 4 (SC_PRINT_SPEC_v2). Letter portrait,
// 12 mini-months in a 3-column grid, day numbers in every ~16px cell.
//
// States (from resolveDayState):
//   SERVED       -> .sv fill (#D3E2C8)
//   PROJECTED    -> .pj fill + border (#EBF3E4 + #A8C796)
//   NO ACTUALS   -> .nd dashed copper border (compliance signal)
//   NO SERVICE   -> default soft fill (baseline)
//
// Plus:
//   period start -> .ps navy square; the day-number cell is replaced
//                   with the P-number label (e.g. "P8")
//   spring       -> .spb decorator: 2.5px copper top bar per cell
//                   (kept ONLY at year scale in v2 - month/period
//                   variants use the title copper chip instead)
//   header chips -> Mon = M (invoice/CC EOD), Fri = F (actuals EOD),
//                   both with .hd (ink) background under the weekday
//                   row.
//
// GAMES DO NOT APPEAR on this sheet.
//
// Inventory-due copper ring (spec block 4) is DEFERRED per Kevin's
// Option A ruling 2026-07-13: period_data (which carries due dates)
// lives in Sheets HUB, not PG. The follow-up PR migrates period_data
// to PG and wires the ring + a legend entry then. Until then, no ring
// AND no legend entry - "legend matches reality."

import { getServiceClient } from "@/lib/supabase";
import {
  derivePhaseTimeline,
  collectSpringDates,
} from "@/app/service-calendar/season/phaseDerivation";
import { esc, sheetHead, loadSealDataUri, footerDate, resolveDayState }
  from "./assets";

const MON3 = ["JAN","FEB","MAR","APR","MAY","JUN",
              "JUL","AUG","SEP","OCT","NOV","DEC"];

// ── Loader ───────────────────────────────────────────────────────────
export async function loadOpsCalendarPrintData(accountKey, year) {
  const supa = getServiceClient();

  const accountRes = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (accountRes.error) throw new Error(`loadOpsCal.account: ${accountRes.error.message}`);
  const account = accountRes.data;
  if (!account) throw new Error(`Account not found: ${accountKey}`);

  // Reuse the year-summary classifier output for per-day state -
  // matches what the operator sees on screen 1:1.
  const { loadYearSummary } = await import("@/lib/dataStore/serviceCalendar");
  const summary = await loadYearSummary(accountKey, year);
  const statusByDate = {};
  for (const mo of summary.months || []) {
    for (const d of mo.days || []) {
      if (d.status) statusByDate[d.date] = {
        status:        d.status,
        hasActuals:    !!d.hasActuals,
        hasProjection: !!d.hasProjection,
        isPast:        !!d.isPast,
      };
    }
  }

  // Period start dates: reuse loadYearSummary's periodRanges output
  // (start-of-period per fiscal period, keyed off sc_day_metadata.period).
  const periodStarts = {};
  for (const range of summary.periodRanges || []) {
    if (range.start && range.period != null) {
      periodStarts[range.start] = Number(range.period);
    }
  }

  // Spring dates from the phase calendar (PDC accounts only).
  const phaseTimeline = derivePhaseTimeline(accountKey, account.level, year);
  const springDates   = collectSpringDates(phaseTimeline);

  return {
    account,
    year,
    statusByDate,
    periodStarts,
    springDates,
  };
}

// ── Renderer ─────────────────────────────────────────────────────────
export function renderOpsCalendarSheet(ctx) {
  const { account, year, statusByDate, periodStarts, springDates } = ctx;

  const seal = loadSealDataUri();
  const bandRight = esc(account.name || account.team_key);
  const asOf = footerDate();

  const monthBlocks = [];
  for (let m = 1; m <= 12; m++) {
    monthBlocks.push(renderMonth(year, m, statusByDate, periodStarts, springDates));
  }

  return `<!doctype html>
<html>
<head>
${sheetHead({ title: `KitchFix Ops Calendar`, orientation: "portrait" })}
</head>
<body>
<div class="sheet">
  <div class="band"><img class="seal" src="${seal}" alt="" /><span class="bk">KITCHFIX</span><span class="ba">${bandRight}</span></div>
  <div class="pad">
    <div class="trow">
      <span class="mo">${esc(String(year))}</span>
      <span class="yr">OPS CALENDAR</span>
    </div>
    <div class="ymos">
      ${monthBlocks.join("")}
    </div>
    <div class="ft" style="margin-top:14px;">
      <span class="k">
        <span><span class="kk" style="background:#D3E2C8"></span>SERVED</span>
        <span><span class="kk" style="background:#EBF3E4;border:1px solid #A8C796"></span>PROJECTED</span>
        <span><span class="kk" style="background:#fff;border:1.5px dashed #C2410C"></span>NO ACTUALS</span>
        <span><span class="kk" style="background:#F6F4EF;border:1px solid #E4E0D6"></span>NO SERVICE</span>
        <span><span class="kk" style="background:#16305E"></span>PERIOD START</span>
        <span><span class="kk" style="background:#C2410C;height:3px;border-radius:1.5px;margin-top:3px"></span>SPRING</span>
        <span><span class="km">M</span>INVOICE / CC EOD MONDAY</span>
        <span><span class="km">F</span>ACTUALS EOD FRIDAY</span>
      </span>
      <span><span class="asof">AS OF ${esc(asOf)}</span> — SERVED = ACTUALS ENTERED · PROJECTED AFTER</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

function renderMonth(year, month, statusByDate, periodStarts, springDates) {
  const label = MON3[month - 1];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Header row: M T W T F S S with Monday + Friday emphasized as
  // .hd (invoice/CC EOD Monday; actuals EOD Friday).
  const header = [
    `<b class="hd">M</b>`,
    `<b>T</b>`,
    `<b>W</b>`,
    `<b>T</b>`,
    `<b class="hd">F</b>`,
    `<b>S</b>`,
    `<b>S</b>`,
  ].join("");

  // Compute Monday-anchored offset for the 1st of month.
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const dow0Mon = ((first.getUTCDay() + 6) % 7);  // Mon=0..Sun=6
  const cells = [];
  // Blank pad cells at the start of week 1.
  for (let i = 0; i < dow0Mon; i++) cells.push(`<span class="x"></span>`);
  // Real days.
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push(renderCell(iso, d, statusByDate, periodStarts, springDates));
  }
  // Blank pad cells for the tail (grid completes to a multiple of 7).
  const total = dow0Mon + daysInMonth;
  const pad = (7 - (total % 7)) % 7;
  for (let i = 0; i < pad; i++) cells.push(`<span class="x"></span>`);

  return `<div class="ymo"><h5>${esc(label)}</h5><div class="yg">${header}${cells.join("")}</div></div>`;
}

function renderCell(iso, d, statusByDate, periodStarts, springDates) {
  const isSpring = springDates.has(iso);
  const springClass = isSpring ? " spb" : "";

  // Period start overrides day number with the P label.
  if (periodStarts[iso] != null) {
    return `<span class="ps${springClass}">P${periodStarts[iso]}</span>`;
  }

  const stat = statusByDate[iso];
  const state = stat ? resolveDayState(stat) : null;
  switch (state) {
    case "SERVED":
      return `<span class="sv${springClass}">${d}</span>`;
    case "PROJECTED":
      return `<span class="pj${springClass}">${d}</span>`;
    case "NO_ACTUALS":
      return `<span class="nd${springClass}">${d}</span>`;
    case "NO_SERVICE":
      return `<span class="${springClass.trim()}">${d}</span>`;
    default:
      return `<span class="${springClass.trim()}">${d}</span>`;
  }
}
