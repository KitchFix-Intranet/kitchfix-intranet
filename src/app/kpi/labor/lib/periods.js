// src/app/kpi/labor/lib/periods.js
//
// D2 hotfix H1 - one client-side period function, used everywhere.
//
// Fiscal year starts 2025-12-29 (P1 W1). Periods are 28 days each,
// aligned to the FY start. Every week in the FY belongs to exactly
// one period; period_no = floor((week_start - FY_START)/28d) + 1.
//
// Why client-side: `labor_actuals.period_no` is a stored column populated
// by the derive pipeline. The C6/C6.1 backfill rows (pre-2026-04-20)
// were inserted with period_no = null because they came from the
// Rippling report, not the derive pipeline that walks account_periods.
// Trusting the DB value collapses those weeks into an unlabeled "?"
// bucket that can't be expanded (state tracks period_no, and null
// keys don't route through Set membership as the user expects).
//
// The formula is deterministic and covers every week within the FY.

export const FY_START_ISO = "2025-12-29";
export const FY_END_ISO   = "2026-12-27";  // FY2026 last day
const MS_PER_DAY = 86400000;
const DAYS_PER_PERIOD = 28;

// Parse YYYY-MM-DD as a UTC-noon date. UTC anchor is required because
// arithmetic between local Date objects across DST transitions loses an
// hour (spring forward) or gains one (fall back), and floor((diff)/86400000)
// gives 223 instead of 224 across a spring-forward boundary. This misplaces
// the current week by a period. Every parse-then-diff below uses UTC.
function parseISO(iso) {
  if (typeof iso !== "string") return null;
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

// Return the fiscal period number (1..13) for a given ISO week_start.
// Returns null when week_start is outside FY2026 (pre-2025-12-29 or
// post-2026-12-27) - the caller decides whether to include such rows
// in the grouping (usually: not in FY2026, filed under "prior FY").
export function periodOf(weekStartISO) {
  const d = parseISO(weekStartISO);
  const fy = parseISO(FY_START_ISO);
  if (!d || !fy) return null;
  const days = Math.floor((d.getTime() - fy.getTime()) / MS_PER_DAY);
  if (days < 0) return null;
  const p = Math.floor(days / DAYS_PER_PERIOD) + 1;
  if (p < 1 || p > 13) return null;
  return p;
}

// Fiscal year integer for a given week_start.
// FY2026 spans 2025-12-29 .. 2026-12-27.
export function fiscalYearOf(weekStartISO) {
  const d = parseISO(weekStartISO);
  if (!d) return null;
  const fyStart = parseISO(FY_START_ISO);
  const fyEnd = parseISO(FY_END_ISO);
  if (d >= fyStart && d <= fyEnd) return 2026;
  // Prior/next FY - only relevant if the range ever includes them.
  if (d < fyStart) return d.getUTCFullYear();
  return d.getUTCFullYear() + 1;
}

// The start ISO for a given period_no in FY2026.
export function periodStartISO(period_no) {
  const fy = parseISO(FY_START_ISO);
  if (!fy) return null;
  // UTC arithmetic (see parseISO note). Result already UTC-anchored;
  // ISO slice reads the UTC date.
  const dt = new Date(fy.getTime() + (period_no - 1) * DAYS_PER_PERIOD * MS_PER_DAY);
  return dt.toISOString().slice(0, 10);
}

// The end ISO for a given period_no in FY2026 (inclusive).
export function periodEndISO(period_no) {
  const fy = parseISO(FY_START_ISO);
  if (!fy) return null;
  const dt = new Date(fy.getTime() + (period_no * DAYS_PER_PERIOD - 1) * MS_PER_DAY);
  return dt.toISOString().slice(0, 10);
}

// Which period contains today's date? Used for hero's suffix labeling
// of "this period" / "last period" when the user is on a preset.
export function currentPeriodNo(todayISO) {
  return periodOf(todayISO);
}
