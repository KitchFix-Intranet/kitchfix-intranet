// sc-58 - billable pretax helper.
//
// Reconciles the finalize-confirm screen total with the payload pretax by
// applying the same billable definition on both sides: drop is_non_revenue
// AND export_excluded services. Mirrors buildInvoicePayload's exclusion at
// line 292 (export_excluded skip).
//
// Shared by:
//   - loadMonthDataPostgres (per-day accumulation into
//     day.totals.billableActualRevenue; the loader iterates services
//     inline rather than calling the helper to avoid per-row function
//     overhead on months with 600+ rows, but the semantics match)
//   - billing tests (direct sum over sc_daily_revenue-shaped rows)
//
// Does NOT replace day.totals.actualRevenue. actualRevenue stays as-is
// so KPI / week-card revenue displays continue to show the real revenue
// figure (B&G Lunch on TBR - FL is real revenue; it is only excluded from
// what the SC pushes to QBO). confirmedPretaxCents (billable) is the only
// consumer that needs the narrower definition.

/**
 * Sum billable pretax from sc_daily_revenue-shaped rows.
 *
 * @param {Array} rows - sc_daily_revenue rows (requires fields
 *   service_id, is_non_revenue, has_actuals, actual_revenue).
 * @param {Set<string>|Iterable<string>|Array<string>} exportExcludedServiceIds
 *   service_ids whose sc_qbo_service_map row has export_excluded = true.
 * @returns {number} total cents (integer). Matches the two-step rounding
 *   used by loadMonthDataPostgres so independent callers reach the same
 *   integer.
 */
export function sumBillablePretaxCents(rows, exportExcludedServiceIds) {
  const excluded = exportExcludedServiceIds instanceof Set
    ? exportExcludedServiceIds
    : new Set(exportExcludedServiceIds || []);
  let dollars = 0;
  for (const r of rows || []) {
    if (!r) continue;
    if (r.is_non_revenue) continue;
    if (excluded.has(r.service_id)) continue;
    if (!r.has_actuals) continue;
    const rev = Number(r.actual_revenue) || 0;
    // Round per-service to cents-as-dollars so the sum foots to the
    // visible per-line amounts in the UI (same R13 round-then-sum rule
    // the loader uses at serviceCalendar.js:924-925).
    dollars += Math.round(rev * 100) / 100;
  }
  return Math.round(dollars * 100);
}
