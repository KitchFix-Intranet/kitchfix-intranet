// M-4b (2026-07-30): shared card-scope derivations for MonthCard
// and PeriodCard. All three helpers are pure functions consumed by
// both cards; extracting here keeps the two card files from
// duplicating logic and drifting.
//
// Owner rulings 2026-07-30:
//   PeriodCard shows its own sc_labor_budgets figure. One number,
//   ties to the P&L.
//   MonthCard shows "Draws from Pn + Pn+1" naming the periods.
//   No figure and no repeated period amounts. Every in-season
//   month straddles exactly two fiscal periods (28-day periods
//   never align with 30/31-day months); a monthly total does not
//   exist and pro-rating manufactures a number that reconciles
//   against nothing.
//   Both cards list the homestands inside the scope with status
//   and a click target, straddlers labelled "spans Pn + Pn+1" or
//   "spans Jul + Aug" with the scope-native game count. HS7
//   (Jun 12-17, 3 games in P6 + 3 in P7) is the case that ships.

import { deriveOpsHomestandLedgerScoped } from "../v2/opsRailDerive";

// PeriodCard budget lookup. Returns { amount } when the period has
// a live labor-budget row on the payload, or { amount: null } when
// it does not. Missing-vs-zero applied at the render site: never
// display $0 for a missing budget.
export function resolvePeriodBudget(periodBudgets, periodNumber) {
  if (!Array.isArray(periodBudgets) || periodNumber == null) return { amount: null };
  const row = periodBudgets.find((b) => String(b.period) === String(periodNumber));
  const amount = row?.hourly_budget;
  return {
    amount: (amount != null && Number.isFinite(Number(amount))) ? Number(amount) : null,
  };
}

// MonthCard "Draws from" label. Returns the array of period labels
// that overlap [monthStart, monthEnd]. Ordered by period.start so
// the label reads chronologically. Empty when periodRanges is
// missing or the month overlaps nothing (off-season).
export function resolveDrawsFromPeriods(periodRanges, monthStart, monthEnd) {
  if (!Array.isArray(periodRanges) || !monthStart || !monthEnd) return [];
  return periodRanges
    .filter((r) => r?.start && r?.end && r.start <= monthEnd && r.end >= monthStart)
    .map((r) => String(r.period));
}

// Homestand list for a scope. Reuses deriveOpsHomestandLedgerScoped
// (already handles the scope-native game count via yearData walk)
// and decorates each row with:
//   - payloadStatus: from M-3 homestands[].status joined by key.
//     Preferred over the derivation's done/current/next because it
//     reads sc_homestand_closeout for the true billing status.
//   - spansPeriods: array of period numbers the FULL block touches
//     (not scope-limited).
//   - spansOtherScope: true when the block extends past the current
//     scope range on either side. Used by the "spans" label so a
//     straddle is only labelled when there's an OTHER scope to name.
//
// yearData, todayDate, accountKey get passed to
// deriveOpsHomestandLedgerScoped verbatim; rangeStart / rangeEnd
// bound the scope; periodRanges + homestandsPayload feed the
// decoration.
export function resolveScopedHomestands({
  yearData,
  todayDate,
  accountKey,
  rangeStart,
  rangeEnd,
  periodRanges,
  homestandsPayload,
}) {
  if (!rangeStart || !rangeEnd) return [];
  const scoped = deriveOpsHomestandLedgerScoped(
    yearData, todayDate, rangeStart, rangeEnd, { accountKey }
  );
  if (!scoped.length) return [];

  // Build payload lookup for status join. Keys come off the M-3
  // payload as strings; keys off the derivation are gamePk (number)
  // or startDate (string). Coerce both sides via String() so joins
  // match cleanly.
  const payloadByKey = new Map();
  if (Array.isArray(homestandsPayload)) {
    for (const h of homestandsPayload) {
      if (h?.key != null) payloadByKey.set(String(h.key), h);
    }
  }

  const ranges = Array.isArray(periodRanges) ? periodRanges : [];

  return scoped.map((seg) => {
    const payload = payloadByKey.get(String(seg.key)) || null;
    const spansPeriods = ranges
      .filter((r) => r?.start && r?.end && seg.startDate <= r.end && seg.endDate >= r.start)
      .map((r) => String(r.period));
    const spansOtherScope = seg.startDate < rangeStart || seg.endDate > rangeEnd;
    return {
      ...seg,
      payloadStatus: payload?.status || null,
      spansPeriods,
      spansOtherScope,
    };
  });
}

// Month-boundary label helper for a homestand row. Returns
// something like "spans Jul + Aug" when the block extends past the
// current month. Null when the block is entirely inside this month.
const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export function formatMonthSpan(seg, monthIndex) {
  if (!seg?.startDate || !seg?.endDate) return null;
  const startMonth = Number(seg.startDate.slice(5, 7)) - 1;
  const endMonth = Number(seg.endDate.slice(5, 7)) - 1;
  if (startMonth === endMonth && startMonth === monthIndex) return null;
  const parts = [];
  if (Number.isFinite(startMonth)) parts.push(MON_SHORT[startMonth]);
  if (Number.isFinite(endMonth) && endMonth !== startMonth) parts.push(MON_SHORT[endMonth]);
  if (parts.length < 2) return null;
  return `spans ${parts.join(" + ")}`;
}
