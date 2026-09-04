// scripts/lib/dept_history.mjs
//
// R-70 (Kevin ruling 2026-09-04): effective-dated worker->account
// attribution for the salary loader. Reads `worker_dept_history`
// (Kevin-maintained per period close, same pattern as
// inventory_adjustments) and falls back to the worker's current
// department when no history row applies.
//
// The fallback is load-bearing. 99% of salaried workers never move.
// For them the table stays empty and the resolver returns their
// current-department attribution unchanged - so the loader's
// behaviour is byte-identical to today until a row is seeded.
//
// SPELL-COVERAGE RULE
//
//   A worker in `worker_dept_history` must have a row for every
//   spell they lived through in the fiscal year, INCLUDING their
//   opening spell. One row for a moved worker is always wrong
//   because the fallback would recover their CURRENT department
//   for the origin weeks, producing the exact defect the table
//   exists to fix.
//
//   Enforcement: `scripts/probes/_probe_r70_spell_coverage.mjs`
//   asserts every worker in the table has either a row whose
//   effective_from <= FY start, or a Rippling worker.start_date
//   after FY start (hired mid-year).
//
// RESOLVER RULE
//
//   attribute(workerId, workDateISO) returns { account_key, source }.
//
//   1. Walk that worker's history rows (sorted by effective_from
//      ascending). Pick the last row where
//        effective_from <= workDateISO
//         AND (end_date IS NULL OR workDateISO <= end_date)
//      If a row matches, source = "history:<row.source>".
//
//   2. If no history row matches, fall back to
//        workerToCurrentDept[workerId] -> deptToAccount[deptId]
//      source = "worker_current_dept".
//
//   3. If neither works, return null and let the caller bump the
//      unattr counter.
//
// end_date matters when a worker leaves. Kevin's Gordon Rouse III
// case: left TBJ - FL 2026-04-30, needs a single row with
// end_date='2026-04-30'; weeks past that fall through to
// null (no fallback either, worker terminated) so accrual stops.

/**
 * Build the attribution resolver.
 *
 * @param {object} args
 * @param {Array<{worker_id: string, effective_from: string, end_date: string|null, account_key: string, source: string}>} args.historyRows
 * @param {Map<string, string|null>} args.workerToCurrentDept  worker_id -> department_id
 * @param {Map<string, {account_key: string, is_container: boolean}>} args.deptToAccount  department_id -> {account_key, is_container}
 * @returns {(workerId: string, workDateISO: string) => ({account_key: string, source: string}|null)}
 */
export function buildDeptResolver({ historyRows, workerToCurrentDept, deptToAccount }) {
  // Index history by worker, sort spells ascending by effective_from.
  const byWorker = new Map();
  for (const h of historyRows || []) {
    if (!h || !h.worker_id || !h.effective_from || !h.account_key) continue;
    if (!byWorker.has(h.worker_id)) byWorker.set(h.worker_id, []);
    byWorker.get(h.worker_id).push(h);
  }
  for (const list of byWorker.values()) {
    list.sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)));
  }

  return function attribute(workerId, workDateISO) {
    if (!workerId || !workDateISO) return null;

    // 1. History match. Pick the last row whose effective_from <=
    //    workDateISO AND (end_date IS NULL OR workDateISO <= end_date).
    //    Rows already sorted ascending; scan and track the last match.
    const list = byWorker.get(workerId);
    if (list && list.length > 0) {
      let picked = null;
      for (const h of list) {
        if (String(h.effective_from) > workDateISO) break;
        const endOk = h.end_date == null || String(h.end_date) >= workDateISO;
        if (endOk) picked = h;
      }
      if (picked) {
        return { account_key: picked.account_key, source: `history:${picked.source || "unknown"}` };
      }
    }

    // 2. Fallback: worker's current department.
    const deptId = workerToCurrentDept.get(workerId);
    if (!deptId) return null;
    const dept = deptToAccount.get(deptId);
    if (!dept) return null;
    if (dept.is_container) return null;
    if (!dept.account_key) return null;

    return { account_key: dept.account_key, source: "worker_current_dept" };
  };
}
