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

// V6-1 - week-of-period (1..4) for the given ISO date within its
// containing fiscal period. Used in the command bar fiscal context.
// Returns null when the date falls outside FY2026.
export function weekOfPeriod(dateISO) {
  const d = parseISO(dateISO);
  const fy = parseISO(FY_START_ISO);
  if (!d || !fy) return null;
  const days = Math.floor((d.getTime() - fy.getTime()) / MS_PER_DAY);
  if (days < 0) return null;
  const withinPeriod = days % DAYS_PER_PERIOD;
  const w = Math.floor(withinPeriod / 7) + 1;
  return w >= 1 && w <= 4 ? w : null;
}

// V6-3 - fiscal months (calendar month indexes, 0..11) that contain
// at least one fiscal week whose MONDAY falls inside the month.
// FY2026 spans 2025-12-29 (P1W1D1, Mon) through 2026-12-27 (P13W4D7).
// December weeks may straddle the FY boundary; a week belongs to a
// month iff its Monday is in that month. Returns array of
// { monthIndex: 0..11, year: 2025|2026, weekCount, firstMonday: ISO,
//   lastMonday: ISO }.
export function fiscalMonthsWithWeeks() {
  const fy = parseISO(FY_START_ISO);
  if (!fy) return [];
  // Enumerate every Monday from FY_START forward until we've walked
  // 52 weeks (FY2026 has 52 fiscal weeks; 13 periods x 4 weeks).
  const buckets = new Map();
  for (let i = 0; i < 52; i += 1) {
    const wStart = new Date(fy.getTime() + i * 7 * MS_PER_DAY);
    const key = `${wStart.getUTCFullYear()}-${wStart.getUTCMonth()}`;
    const cur = buckets.get(key) || {
      year: wStart.getUTCFullYear(),
      monthIndex: wStart.getUTCMonth(),
      weekCount: 0,
      firstMonday: null,
      lastMonday: null,
    };
    cur.weekCount += 1;
    const iso = wStart.toISOString().slice(0, 10);
    if (!cur.firstMonday) cur.firstMonday = iso;
    cur.lastMonday = iso;
    buckets.set(key, cur);
  }
  return [...buckets.values()].sort((a, b) =>
    a.year - b.year || a.monthIndex - b.monthIndex
  );
}

// V6-4 - resolve a month selection (year + monthIndex) into a
// concrete { startISO, endISO } range that spans exactly the fiscal
// weeks whose Monday falls in that month. startISO = first such
// Monday; endISO = last such Monday + 6 days (Sunday).
export function rangeForFiscalMonth(year, monthIndex) {
  const months = fiscalMonthsWithWeeks();
  const m = months.find(mm => mm.year === year && mm.monthIndex === monthIndex);
  if (!m) return null;
  const lastMon = parseISO(m.lastMonday);
  if (!lastMon) return null;
  const endMs = lastMon.getTime() + 6 * MS_PER_DAY;
  const endISO = new Date(endMs).toISOString().slice(0, 10);
  return { startISO: m.firstMonday, endISO, weekCount: m.weekCount };
}

// Range PR-2 follow-up 2026-08-24. Owner ruling after live verify:
// Range PR-1 promised calendar months are exact ($18,714.03 on
// CIN - OH July, not the $21,555.27 weekly widening returned before
// the cap raise). The picker's month button still handed back
// fiscal-week ranges (rangeForFiscalMonth returns 07/06 - 08/02 for
// July, 28 days on weekly grain), and the `?label=2026-07` URL hint
// serialized by that button then failed its own validator when
// validateLabel resolved it to the CALENDAR range the operator
// intuits from the word "July". Two paths, two answers.
//
// This helper aligns the picker + label to calendar months, which
// then route to daily via PR-1's raised cap. Clamped to the fiscal-
// year bounds: December 2025 collapses to 12/29 - 12/31 (only 3 days
// of that calendar month sit inside FY2026); every other month lands
// unclamped because it sits fully within FY2026.
//
// Returns null when the calendar month is entirely outside FY. The
// picker's month list is derived from fiscalMonthsWithWeeks() which
// already filters out months with no fiscal week - so a null return
// here is defensive, not user-reachable.
export function rangeForCalendarMonth(year, monthIndex) {
  const fyStart = parseISO(FY_START_ISO);
  const fyEnd   = parseISO(FY_END_ISO);
  if (!fyStart || !fyEnd) return null;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  if (monthIndex < 0 || monthIndex > 11) return null;

  // Calendar month bounds in UTC. Day 0 of next month == last day of
  // this month; Date.UTC handles overflow for us.
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd   = new Date(Date.UTC(year, monthIndex + 1, 0));

  const clampedStart = monthStart < fyStart ? fyStart : monthStart;
  const clampedEnd   = monthEnd   > fyEnd   ? fyEnd   : monthEnd;

  // Entirely outside FY: month ends before FY starts, or begins after
  // FY ends. Returns null so the caller can no-op the click.
  if (clampedEnd < fyStart || clampedStart > fyEnd) return null;
  if (clampedStart > clampedEnd) return null;

  const startISO = clampedStart.toISOString().slice(0, 10);
  const endISO   = clampedEnd.toISOString().slice(0, 10);
  const spanDays = Math.round((clampedEnd.getTime() - clampedStart.getTime()) / MS_PER_DAY) + 1;
  return { startISO, endISO, spanDays };
}

// V6-3 - resolve a period selection into a { startISO, endISO } range.
export function rangeForPeriod(period_no) {
  const s = periodStartISO(period_no);
  const e = periodEndISO(period_no);
  if (!s || !e) return null;
  return { startISO: s, endISO: e };
}

// V6-7 - inverse label inference. Given a committed start/end, return
// a { kind, value, label } tuple naming the selection so the range
// button and hero echo can read canonical vocabulary. Order matches
// the spec: exact period -> "PERIOD n"; exact month week-span ->
// "<MONTH> <year>"; else caller falls back to preset inference or
// "CUSTOM RANGE".
export function inferRangeSelection(startISO, endISO) {
  if (!startISO || !endISO) return null;
  // Period?
  for (let p = 1; p <= 13; p += 1) {
    const r = rangeForPeriod(p);
    if (r && r.startISO === startISO && r.endISO === endISO) {
      return { kind: "period", value: p, label: `PERIOD ${p}` };
    }
  }
  // Month?
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  for (const m of fiscalMonthsWithWeeks()) {
    const r = rangeForFiscalMonth(m.year, m.monthIndex);
    if (r && r.startISO === startISO && r.endISO === endISO) {
      return { kind: "month", value: { year: m.year, monthIndex: m.monthIndex }, label: `${MONTHS[m.monthIndex]} ${m.year}` };
    }
  }
  return null;
}

// D2.3 - human-readable span the RANGE touches, sourced from the
// shared week enumerator so the label and the budget-dollars universe
// can never diverge. Names the DATE RANGE, not the nonzero-budget
// periods; CIN - OH FYTD reads "P1-P9 to date" even when P1-P3 carry
// $0 budget (Ruling C - intentional and honest).
//
// Returns null when the range enumerates zero fiscal weeks (out of
// FY, inverted range) so the caller can decide whether to render
// anything. Otherwise:
//   single period                 -> "P9"
//   multi-period                  -> "P1-P9"
//   range end === today (any preset or custom) -> " to date" appended
export function spanLabelForRange(rangeStartISO, rangeEndISO, todayISO) {
  const weeks = weekStartsInRange(rangeStartISO, rangeEndISO);
  if (weeks.length === 0) return null;
  const pFirst = periodOf(weeks[0]);
  const pLast  = periodOf(weeks[weeks.length - 1]);
  if (pFirst == null || pLast == null) return null;
  const base = pFirst === pLast ? `P${pFirst}` : `P${pFirst}-P${pLast}`;
  const toDate = todayISO && rangeEndISO && rangeEndISO === todayISO ? " to date" : "";
  return `${base}${toDate}`;
}

// kpi-2 - the ONE week-in-range enumerator. Same overlap semantics
// as the server-side actuals filter (`week_start <= end AND week_end
// >= start`, i.e., the fiscal week [week_start, week_start+6d]
// overlaps [rangeStart, rangeEnd]). Both consumers on the client
// (budget-per-range sum, and any future actuals-vs-budget week-set
// check) must call this so the two grains never drift.
//
// FY2026 starts 2025-12-29 (Sunday). Fiscal weeks step exactly 7
// days from FY_START, so every fiscal week_start is Sunday-aligned.
// Returns ISO strings (YYYY-MM-DD), UTC-anchored.
export function weekStartsInRange(rangeStartISO, rangeEndISO) {
  const rs = parseISO(rangeStartISO);
  const re = parseISO(rangeEndISO);
  const fy = parseISO(FY_START_ISO);
  if (!rs || !re || !fy || rs > re) return [];
  // Snap forward to the first FY-week start >= rangeStart - 6d,
  // stepping in 7-day chunks from FY_START. A week [w, w+6d]
  // overlaps [rs, re] iff w <= re AND w + 6d >= rs.
  const rsMs = rs.getTime();
  const reMs = re.getTime();
  const fyMs = fy.getTime();
  // Index of the first candidate week: floor((rangeStart - 6d - FY_START)/7d).
  const idxStart = Math.max(0, Math.floor((rsMs - 6 * MS_PER_DAY - fyMs) / (7 * MS_PER_DAY)));
  const out = [];
  for (let i = idxStart; ; i += 1) {
    const wStartMs = fyMs + i * 7 * MS_PER_DAY;
    if (wStartMs > reMs) break;
    const wEndMs = wStartMs + 6 * MS_PER_DAY;
    if (wEndMs >= rsMs) {
      out.push(new Date(wStartMs).toISOString().slice(0, 10));
    }
  }
  return out;
}
