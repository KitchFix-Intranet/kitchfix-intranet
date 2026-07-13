// Ops Calendar sheet renderer for the SC print export.
//
// #422 (Wave 3, 2026-07-13): replaces v1's "year at a glance" sparkline
// grammar entirely. Spec Sheet 4 (SC_PRINT_SPEC_v2). Letter portrait,
// 12 mini-months in a 3-column grid, square day cells (aspect-ratio 1/1).
//
// Polish wave (2026-07-13):
// - O1: SERVICE DAY collapse via opsServiceState. Single green replaces
//       the SERVED / PROJECTED / NO ACTUALS split on this overview
//       surface. Drill sheets keep the 4-state model pending redesign.
// - O2: Mini spring legend swatch (kk-spring) proxying the actual
//       per-cell treatment.
// - O3: Square tiles (aspect-ratio: 1/1). Cell borders now use the
//       darker --grid token (G1) for paper definition.
// - O4: Inventory-due ring LIVE. Copper open outline layered over
//       every state (SERVICE green, plain soft, period-start navy).
//       Data from src/lib/print/inventoryCalendar.js. MLB variant:
//       ring renders too - inventory is real ops even where actuals
//       aren't owed (R5 scoped service states, not fiscal markers).
//
// States (non-MLB, via opsServiceState):
//   SERVICE_DAY -> .svc fill (single green)
//   NO_SERVICE  -> default soft fill (baseline)
//
// MLB variant (R5 superseded 2026-07-13): plain day cells (no state
// layer). Period-start navy + inventory ring only. M chip only in
// header (F chip dropped).
//
// Plus (all variants):
//   period start -> .ps navy square; day-number cell replaced with P-N label
//   inventory    -> .inv copper open ring overlay on due-date cells
//   spring       -> .spb decorator: 2.5px copper top bar (year scale only)
//   header chips -> Mon = M (invoice/CC EOD).
//                   Non-MLB also gets Fri = F (actuals EOD).
//
// GAMES DO NOT APPEAR on this sheet.

import { getServiceClient } from "@/lib/supabase";
import {
  derivePhaseTimeline,
  collectSpringDates,
} from "@/app/service-calendar/season/phaseDerivation";
import { esc, sheetHead, loadSealDataUri, footerDate, opsServiceState }
  from "./assets";
import { getInventoryDueIndex } from "./inventoryCalendar";

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

  // O4: inventory-due index for the year. GLOBAL schedule (Kevin's
  // 2026 supplied schedule per phaseCalendar.js precedent). Applies
  // to every account including MLB - inventory is real ops even
  // where actuals aren't owed.
  const inventoryDueIndex = getInventoryDueIndex(year);

  return {
    account,
    year,
    statusByDate,
    periodStarts,
    springDates,
    inventoryDueIndex,
  };
}

// ── Renderer ─────────────────────────────────────────────────────────
export function renderOpsCalendarSheet(ctx) {
  const { account, year, statusByDate, periodStarts, springDates, inventoryDueIndex } = ctx;
  // R5 superseded (2026-07-13): MLB Ops Calendars render plain day
  // cells (no state layer), M chip only (F drops - no actuals deadline
  // exists for MLB), legend slimmed to PERIOD START + INVENTORY DUE +
  // INVOICE / CC EOD MONDAY.
  const isMlb = account.level === "MLB";

  const seal = loadSealDataUri();
  const bandRight = esc(account.name || account.team_key);
  const asOf = footerDate();

  const monthBlocks = [];
  for (let m = 1; m <= 12; m++) {
    monthBlocks.push(renderMonth(year, m, statusByDate, periodStarts, springDates, inventoryDueIndex, {
      accountLevel: account.level,
      isMlb,
    }));
  }

  // Legend order per Kevin's polish-wave brief:
  //   non-MLB: SERVICE DAY + PERIOD START + SPRING + INVENTORY DUE + M + F
  //   MLB:     PERIOD START + INVENTORY DUE + M
  const legend = isMlb
    ? `
        <span><span class="kk" style="background:#16305E"></span>PERIOD START</span>
        <span><span class="kk-inv"></span>INVENTORY DUE</span>
        <span><span class="km">M</span>INVOICE / CC EOD MONDAY</span>`
    : `
        <span><span class="kk" style="background:#D3E2C8;border:1px solid #B9C9AE"></span>SERVICE DAY</span>
        <span><span class="kk" style="background:#16305E"></span>PERIOD START</span>
        <span><span class="kk-spring"></span>SPRING</span>
        <span><span class="kk-inv"></span>INVENTORY DUE</span>
        <span><span class="km">M</span>INVOICE / CC EOD MONDAY</span>
        <span><span class="km">F</span>ACTUALS EOD FRIDAY</span>`;
  const trailerCopy = `<span class="asof">AS OF ${esc(asOf)}</span>`;

  return `<!doctype html>
<html>
<head>
${sheetHead({ title: `KitchFix Ops Calendar`, orientation: "portrait" })}
</head>
<body>
<div class="sheet">
  <div class="band"><img class="seal" src="${seal}" alt="" /><span class="bk">KITCHFIX</span><span class="ba">${bandRight}</span></div>
  <div class="pad">
    <div class="trow compact">
      <span class="mo">${esc(String(year))}</span>
      <span class="yr">OPS CALENDAR</span>
    </div>
    <div class="ymos">
      ${monthBlocks.join("")}
    </div>
    <div class="ft" style="margin-top:14px;">
      <span class="k">${legend}
      </span>
      <span>${trailerCopy}</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

function renderMonth(year, month, statusByDate, periodStarts, springDates, inventoryDueIndex, opts) {
  const label = MON3[month - 1];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Header row: M T W T F S S. Non-MLB shows Monday (M invoice/CC EOD)
  // AND Friday (F actuals EOD). MLB drops the Friday emphasis - no
  // actuals deadline exists for MLB accounts per R5 superseded.
  const header = [
    `<b class="hd">M</b>`,
    `<b>T</b>`,
    `<b>W</b>`,
    `<b>T</b>`,
    opts.isMlb ? `<b>F</b>` : `<b class="hd">F</b>`,
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
    cells.push(renderCell(iso, d, statusByDate, periodStarts, springDates, inventoryDueIndex, opts));
  }
  // Blank pad cells for the tail (grid completes to a multiple of 7).
  const total = dow0Mon + daysInMonth;
  const pad = (7 - (total % 7)) % 7;
  for (let i = 0; i < pad; i++) cells.push(`<span class="x"></span>`);

  return `<div class="ymo"><h5>${esc(label)}</h5><div class="yg">${header}${cells.join("")}</div></div>`;
}

function renderCell(iso, d, statusByDate, periodStarts, springDates, inventoryDueIndex, opts) {
  // Compose the class list. Ring (.inv) and spring bar (.spb) are
  // overlays that layer on top of the base state / period-start /
  // baseline. The base is chosen first, then decorators appended.
  const decorators = [];
  if (springDates.has(iso)) decorators.push("spb");
  if (inventoryDueIndex[iso]) decorators.push("inv");
  const decorSuffix = decorators.length ? " " + decorators.join(" ") : "";

  // Period start overrides day number with the P label.
  if (periodStarts[iso] != null) {
    return `<span class="ps${decorSuffix}">P${periodStarts[iso]}</span>`;
  }

  const stat = statusByDate[iso];
  const state = stat ? opsServiceState(stat, { accountLevel: opts.accountLevel }) : null;
  const base = state === "SERVICE_DAY" ? "svc" : "";
  const cls = [base, ...decorators].filter(Boolean).join(" ");
  return `<span${cls ? ` class="${cls}"` : ""}>${d}</span>`;
}
