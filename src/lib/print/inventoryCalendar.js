// Inventory due-date calendar for the SC print export.
//
// GLOBAL across accounts (one due date per fiscal period, applies to
// every account including MLB - Kevin's ruling 2026-07-13: inventory
// is real ops even where actuals aren't owed, so the ring renders
// wherever a due date applies regardless of R5 state-layer suppression).
//
// Precedent: src/app/service-calendar/season/phaseCalendar.js
// PER_ACCOUNT_2026. Declarative-only, no logic, no fetches.
//
// The prior "Sheets HUB period_data - PG migration" plan for this data
// is superseded by Kevin's 2026-07-13 ruling: locate the real source
// as step one of the print polish wave's O4 census, and if the hunt
// dead-ends, implement Kevin's supplied schedule here.
//
// Micro-census verdict (2026-07-13):
// - No PG table exists for inventory due dates. Probed exhaustively
//   (sc_period_data, sc_periods, period_data, fiscal_periods,
//   sc_fiscal_periods, sc_period_dates, sc_calendar_periods, and
//   ~20 other name variants including inventory_*, inv_due_dates,
//   sc_inv_due_dates - all return "table not found in schema cache").
// - Sheets HUB `period_data` tab is still the sole source in the
//   codebase, read by src/lib/opsUtils.js getPeriods() (columns:
//   label, start, end, dueDate) and src/app/api/cron/daily/route.js
//   (notification scheduler that fires "Inventory due in Nd" bells).
// - No migration files define any period_data / inventory_due table.
//
// Kevin's assertion that inventory due dates already live in Postgres
// is not supported by the current schema; the fallback per his brief
// is this code constant. The queued period_data - PG migration item
// in SC_STATUS is rescoped to its remaining rationale (cron surface +
// sc_day_metadata.period dedup); this file may be absorbed into a
// proper table later.

// Kevin's supplied schedule (2026-07-13). Period - due date, GLOBAL.
// P1 and P2 share 3/14 - flagged to Kevin in the brief, treated as
// given unless he corrects.
// P7 due 7/13 is also P8 period start - the ring-on-navy composite
// per Kevin's brief; test target on the July mini-month.
export const INVENTORY_DUE_2026 = {
  1:  "2026-03-14",
  2:  "2026-03-14",
  3:  "2026-03-26",
  4:  "2026-04-22",
  5:  "2026-05-19",
  6:  "2026-06-16",
  7:  "2026-07-13",
  8:  "2026-08-09",
  9:  "2026-09-06",
  10: "2026-10-04",
  11: "2026-11-01",
  12: "2026-11-29",
  13: "2026-12-27",
};

// Reverse index: due date ISO -> Set of period numbers. Enables O(1)
// lookup at cell-render time ("does this date carry a due ring?").
// A single date can carry multiple period numbers (P1+P2 both on
// 2026-03-14) - the ring renders once per date regardless; the set
// is preserved so the tooltip / metadata copy can list every period.
function buildDueDateIndex(schedule) {
  const idx = {};
  for (const [period, iso] of Object.entries(schedule)) {
    if (!idx[iso]) idx[iso] = new Set();
    idx[iso].add(Number(period));
  }
  return idx;
}

const INVENTORY_DUE_INDEX_2026 = buildDueDateIndex(INVENTORY_DUE_2026);

/**
 * Return the due-date index for a given year. Currently 2026 only;
 * add year entries beside the existing constant when fiscal 2027 lands.
 */
export function getInventoryDueIndex(year) {
  if (year === 2026) return INVENTORY_DUE_INDEX_2026;
  return {};
}

/**
 * Return the raw period -> date map for a given year, in case a caller
 * needs to iterate periods (e.g. building a summary).
 */
export function getInventorySchedule(year) {
  if (year === 2026) return INVENTORY_DUE_2026;
  return {};
}
