// scripts/_probe_daily_picker_guard.mjs
//
// PR-3a picker guard - acceptance for the client-side gate that keeps
// RangeMenu's inline calendar from emitting partial-week or pre-floor
// ranges until PR-3b brings the day strip and refusal panel.
//
// The gate is not a disable and not a clamp. Non-boundary dates render
// disabled in the picker; invalid picks (Sunday earlier than pending
// start + 6 days) render disabled too. Whole-week ranges still route
// to the server's weekly branch and render the normal board.
//
// Assertions
//   G1  staging start (no customPending, no customStaged): Monday
//       cells selectable, every other DOW rejected
//   G2  staging end (customPending set to a Monday): Sunday cells
//       from that Monday+6 forward selectable
//   G3  every non-boundary DOW (Tue..Sat) rejected in every staging
//       state - Custom range is not disabled, only invalid cells are
//   G4  staging end: a Sunday earlier than customPending+6 is
//       rejected. This is the "click a Sunday before your pending
//       Monday" case that would swap into a partial-week span - the
//       gate refuses it rather than silently widening
//   G5  Kevin's verified whole-week custom fixture 2026-07-06 (Mon)
//       to 2026-07-19 (Sun) crosses a period boundary, is selectable
//       via the guard, AND resolveRangeSource routes it to weekly
//       with isWholeWeeks=true - proving the picker still emits
//       ranges the normal board renders
//   G6  helper text is present verbatim in RangeMenu.js so an
//       operator sees why non-boundary dates are grey
//
// Usage: node scripts/_probe_daily_picker_guard.mjs

import { isCustomCellSelectable } from "../src/lib/labor/customPickerGate.js";
import { resolveRangeSource } from "../src/lib/labor/rangeResolver.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }

// Fixture dates - local-time midnight. RangeMenu builds Date via the
// same MonthPanel grid which uses local-time; matching that here.
function d(iso) { return new Date(`${iso}T00:00:00`); }

const DOW_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
// Fiscal week 2026-08-03 to 2026-08-09 - a Monday-through-Sunday span
// that lets us walk every DOW without ambiguity.
const WEEK = ["2026-08-03","2026-08-04","2026-08-05","2026-08-06","2026-08-07","2026-08-08","2026-08-09"];

console.log("=".repeat(72));
console.log("PR-3a picker guard probe");
console.log("=".repeat(72));

// ─── G1 staging start (nothing picked yet) ──────────────────────────
console.log("");
console.log("[G1] staging start: only Mondays selectable across a full week");
{
  for (const iso of WEEK) {
    const dt = d(iso);
    const sel = isCustomCellSelectable(dt, { customPending: null, customStaged: null });
    const dow = DOW_NAMES[dt.getDay()];
    const want = dow === "Mon";
    if (sel === want) ok(`${iso} (${dow}): selectable=${sel} as expected`);
    else fail(`${iso} (${dow}): selectable=${sel}, expected ${want}`);
  }
}

// ─── G2 staging end after a Monday ──────────────────────────────────
console.log("");
console.log("[G2] staging end after Monday 2026-08-03: Sundays >= 2026-08-09 selectable");
{
  const pending = d("2026-08-03");
  const sundays = ["2026-08-09","2026-08-16","2026-08-23","2026-08-30"];
  for (const iso of sundays) {
    const sel = isCustomCellSelectable(d(iso), { customPending: pending, customStaged: null });
    if (sel === true) ok(`${iso} (Sun): selectable=true`);
    else fail(`${iso} (Sun): selectable=false, expected true`);
  }
}

// ─── G3 non-boundary DOWs never selectable ──────────────────────────
console.log("");
console.log("[G3] Tue..Sat + Sun (staging start) / Mon..Sat (staging end): never selectable");
{
  const stagingStates = [
    { label: "start",            customPending: null,        customStaged: null },
    { label: "end (Mon staged)", customPending: d("2026-08-03"), customStaged: null },
    { label: "reset (staged)",   customPending: null,        customStaged: { start: d("2026-08-03"), end: d("2026-08-09") } },
  ];
  for (const state of stagingStates) {
    for (const iso of WEEK) {
      const dt = d(iso);
      const dow = DOW_NAMES[dt.getDay()];
      const sel = isCustomCellSelectable(dt, state);
      let want;
      if (state.label === "start" || state.label === "reset (staged)") want = (dow === "Mon");
      else want = (dow === "Sun");
      if (sel === want) {
        // pass silently to keep output readable
      } else fail(`state=${state.label} ${iso} (${dow}): selectable=${sel}, expected ${want}`);
    }
  }
  ok("all DOW/state combinations agree with the boundary rule");
}

// ─── G4 Sunday earlier than pending+6 is rejected ───────────────────
console.log("");
console.log("[G4] staging end: Sunday before customPending+6 rejected (no partial-week swap)");
{
  // customPending = Monday 2026-08-10; Sunday earlier than 2026-08-16
  // must be rejected. Prior Sunday 2026-08-09 is a valid week-end
  // in absolute terms but WOULD swap into (2026-08-09, 2026-08-10)
  // which is a partial-week span - exactly what the guard prevents.
  const pending = d("2026-08-10");
  const priorSun = d("2026-08-09");
  const validSun = d("2026-08-16");
  const s1 = isCustomCellSelectable(priorSun, { customPending: pending, customStaged: null });
  const s2 = isCustomCellSelectable(validSun, { customPending: pending, customStaged: null });
  if (s1 === false) ok("prior Sunday 2026-08-09 rejected");
  else fail(`prior Sunday 2026-08-09 selectable=${s1}, expected false`);
  if (s2 === true) ok("valid Sunday 2026-08-16 selectable");
  else fail(`valid Sunday 2026-08-16 selectable=${s2}, expected true`);
}

// ─── G5 whole-week custom fixture routes to weekly ──────────────────
console.log("");
console.log("[G5] 2026-07-06 (Mon) to 2026-07-19 (Sun) - Kevin's verified fixture");
{
  const start = d("2026-07-06");
  const end   = d("2026-07-19");
  if (start.getDay() === 1) ok("2026-07-06 is a Monday");
  else fail(`2026-07-06 getDay=${start.getDay()} (${DOW_NAMES[start.getDay()]}), expected Mon`);
  if (end.getDay() === 0) ok("2026-07-19 is a Sunday");
  else fail(`2026-07-19 getDay=${end.getDay()} (${DOW_NAMES[end.getDay()]}), expected Sun`);

  // Guard side: staging start allows the Monday; staging end (after
  // that Monday) allows the Sunday.
  const s1 = isCustomCellSelectable(start, { customPending: null, customStaged: null });
  const s2 = isCustomCellSelectable(end,   { customPending: start, customStaged: null });
  if (s1 && s2) ok("guard: 07/06 selectable as start AND 07/19 selectable as end");
  else fail(`guard: start=${s1} end=${s2}`);

  // Server side: resolveRangeSource routes this to weekly + whole-weeks.
  const rs = resolveRangeSource({ startISO: "2026-07-06", endISO: "2026-07-19", dailyFloorISO: "2026-04-20" });
  if (rs.source === "weekly" && rs.isWholeWeeks) ok("resolveRangeSource -> source='weekly', isWholeWeeks=true");
  else fail(`resolveRangeSource -> source=${rs.source} isWholeWeeks=${rs.isWholeWeeks}`);
}

// ─── G6 helper text present ─────────────────────────────────────────
console.log("");
console.log("[G6] helper text present in RangeMenu.js (honest disclosure of the temp limit)");
{
  const src = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/components/RangeMenu.js"), "utf8");
  const want = "Custom ranges use whole weeks. Day-level ranges are coming.";
  if (src.includes(want)) ok(`literal present: "${want}"`);
  else fail(`helper text missing - grep RangeMenu.js`);
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "PR-3a PICKER GUARD: ALL PROBES PASS" : `PR-3a PICKER GUARD: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
