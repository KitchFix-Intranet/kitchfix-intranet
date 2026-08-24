// src/app/kpi/labor/lib/weekTableModels.js
//
// PR-C - pure aggregate-child builder for the portfolio-view week
// table. Extracted from WeekTable.js so a Node probe can synthesize
// actuals and assert without JSX compilation, same pattern PR-A used
// for the signal-card models.
//
// Owner ruling 2026-08-24 (live browser trace on ?account=ALL): the
// previous implementation iterated `w.worker_rows` inside a grouped
// -> weeks tree, but `worker_rows` was not present on the objects
// the WeekTable actually received in aggregate mode. Result: the
// aggregate-child map was empty, week rows expanded to zero children,
// and Kevin's OT-chip reproducer failed at the "account level" -
// because account rows never rendered.
//
// The fix moves the group-by to raw actuals (data.actuals), which
// carries all the fields needed: account_key, hours_regular,
// hours_overtime, hours_double_time, hours_without_dollars, amount,
// coverage_state. Same source page.js already uses to build
// weekAggregates - so we're not adding anything to the server payload,
// just consuming it directly.

/**
 * Group raw actuals rows by (week_start, account_key) for the
 * aggregate week-table drill-down. Same shape aggregateChildrenForWeek
 * consumes.
 *
 * @param {Array<{
 *   account_key: string,
 *   week_start: string,
 *   hours_regular?: number, hours_overtime?: number,
 *   hours_double_time?: number, hours_without_dollars?: number,
 *   amount?: number, coverage_state?: string,
 * }>} actuals
 * @param {"aggregate"|"single"} mode  // single-mode returns empty (path unused)
 * @returns {Map<string, Map<string, {
 *   amount: number, hours: number, ot: number, hol: number,
 *   unpriced: number, states: string[],
 * }>>}
 */
export function buildMemberByWeekAndAcct(actuals, mode) {
  const out = new Map();
  if (mode !== "aggregate") return out;
  if (!actuals || actuals.length === 0) return out;
  for (const r of actuals) {
    const wk = r.week_start;
    if (!wk) continue;
    let per = out.get(wk);
    if (!per) { per = new Map(); out.set(wk, per); }
    const key = r.account_key;
    if (!key) continue;
    const cur = per.get(key) || { amount: 0, hours: 0, ot: 0, hol: 0, unpriced: 0, states: [] };
    cur.amount += Number(r.amount || 0);
    cur.hours += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
    cur.ot += Number(r.hours_overtime || 0);
    cur.hol += Number(r.hours_double_time || 0);
    cur.unpriced += Number(r.hours_without_dollars || 0);
    cur.states.push(r.coverage_state);
    per.set(key, cur);
  }
  return out;
}
