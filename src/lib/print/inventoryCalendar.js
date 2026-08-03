// Inventory due-date calendar for the SC print export.
//
// PARKED per Kevin's ruling 2026-07-13 (polish-wave amendment): no
// inventory due dates on the calendar this year. They return with the
// 2027 schedule.
//
// This module is DORMANT MACHINERY, not deleted:
// - getInventoryDueIndex() returns {} for every year until a 2027
//   schedule is entered here. The Ops Calendar renders no rings and
//   omits the INVENTORY DUE legend entry on all variants (MLB
//   included) via data-driven legend logic in opsCalendarSheet.js.
// - The CSS (.yg .inv, .yg .ps.inv, .kk-inv) stays in assets.js so
//   the machinery is one-line away from re-enable when 2027 lands.
// - The 2026 schedule below is REFERENCE only, preserved with every
//   date and Kevin's P1 + P2 shared-3/14 flag.
//
// ON RE-ENABLE (when 2027 schedule is entered):
// 1. Read Sheets HUB period_data via getPeriods() and diff the new
//    schedule's due dates against getPeriods().dueDate for the same
//    year, VERBATIM (same shape as the pre-merge check that surfaced
//    the 2026 divergence - see PR #426 comment for the pattern).
// 2. Reconcile any mismatch BEFORE anything ships. Rings on the Ops
//    Calendar and the notification-bell cron (src/app/api/cron/daily/
//    route.js) fire from different sources; they must agree.
// 3. Populate INVENTORY_DUE_2027 = { 1: ..., 2: ..., ... } and add
//    the year branch below to getInventoryDueIndex().
// 4. Add an entry to CHANGELOG-style docs; retire this parked note.
//
// Precedent: src/app/service-calendar/season/phaseCalendar.js
// PER_ACCOUNT_2026. Declarative-only, no logic, no fetches.
//
// Micro-census reference (2026-07-13): no PG source exists for
// inventory due dates. Probed exhaustively (sc_period_data,
// sc_periods, period_data, fiscal_periods, sc_fiscal_periods,
// sc_period_dates, sc_calendar_periods, and ~20 other name variants
// including inventory_*, inv_due_dates, sc_inv_due_dates - all
// return "table not found in schema cache"). Sheets HUB period_data
// tab is the sole source in the codebase, read by src/lib/opsUtils.js
// getPeriods() (columns: label, start, end, dueDate) and src/app/api/
// cron/daily/route.js (notification scheduler that fires
// "Inventory due in Nd" bells). No migration files define any
// period_data / inventory_due table.

// ─── Kevin's 2026 schedule (REFERENCE - parked, not active) ────────
// Kept verbatim so 2027 re-enable can compare intent + pattern. P1
// and P2 shared 2026-03-14 per Kevin's original brief; treat as flag
// if re-enabling as-is. P7 due 2026-07-13 was the P8-start composite
// (P7 due-date coincides with P8 period-start); this composite is
// what the .ps.inv CSS rule was tuned for.
//
// export const INVENTORY_DUE_2026 = {
//   1:  "2026-03-14",  // shared with P2 - flagged
//   2:  "2026-03-14",  // shared with P1 - flagged
//   3:  "2026-03-26",
//   4:  "2026-04-22",
//   5:  "2026-05-19",
//   6:  "2026-06-16",
//   7:  "2026-07-13",  // composite: also P8 period start
//   8:  "2026-08-09",
//   9:  "2026-09-06",
//   10: "2026-10-04",
//   11: "2026-11-01",
//   12: "2026-11-29",
//   13: "2026-12-27",
// };
//
// Pre-merge check (2026-07-13) surfaced a divergence between the
// above schedule and the Sheets HUB period_data.dueDate column:
// P1-P7 disagreed (deltas +1 to +48 days); P8-P13 matched. The
// notification cron fires on the Sheets HUB values, not this
// schedule. Both surfaces stayed unfixed pending Kevin's ruling;
// Kevin's ruling was to park the entire ring surface until 2027,
// so the divergence is now moot for 2026.
//
// Polish wave amendment (2026-08-04): the reason for the park is
// stronger than the 2026-07-13 note captured. Kevin's rule for
// due-date placement is "the Friday before the next period starts."
// Applying that rule to the current period boundaries produces
// dates that land TWO DAYS EARLIER than the Sheets HUB
// period_data.dueDate values the notification cron actually fires
// on. Printing the Friday on the wall calendar would put the wall
// and the Slack reminders on different dates - a scheduling
// contradiction the operator sees immediately.
//
// The reconciliation on ON RE-ENABLE (step 1 above) is not just
// "check for drift" - it is "pick which source is authoritative."
// The next person to unpark has to decide whether:
//   (a) The cron switches to the Friday-before rule (change of
//       schedule for Slack reminders), or
//   (b) The calendar prints the Sheets HUB dates (change of
//       what Kevin said the rule was), or
//   (c) The two surfaces genuinely serve different audiences and
//       both dates stay, with the calendar labelling its date
//       differently than the cron does.
// None of those are one-line changes. Do not unpark without a
// Kevin ruling on that choice first.

/**
 * Return the due-date index for a given year. Returns {} until a
 * year's schedule is populated above and the year branch is added
 * here on re-enable. All years currently return {} - the ring
 * surface is parked per Kevin's ruling 2026-07-13.
 */
export function getInventoryDueIndex(_year) {
  return {};
}

/**
 * Return the raw period -> date map for a given year. Returns {}
 * until a year's schedule is populated + re-enabled.
 */
export function getInventorySchedule(_year) {
  return {};
}
