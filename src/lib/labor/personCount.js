// src/lib/labor/personCount.js
//
// Count distinct PEOPLE across labor rows.
//
// Why this helper exists (owner ruling 2026-08-28):
//
// Rippling assigns a NEW `worker_id` each time an employee is rehired
// (seasonal turnover, mid-year comebacks). One human can have several
// worker_ids across a fiscal year - Keith Gilman has five spells, one
// person. Every prior counting site did
//
//     new Set(rows.map(r => r.worker_id)).size
//
// which reads that human as five distinct workers. The right key is
// the person key - `work_email` from the workers-latest payload -
// because email is stable across spells.
//
// Seven counting sites in the labor code used the wrong key. This
// helper is the ONE shared function all seven now route through:
//   board.js sumRows          -> worker_count, approval_people
//   board.js buildBoard       -> distinct_workers range-total
//   salaryBoard.js            -> distinctWorkers salary summary
//   salaryProRate.js          -> per-person aggregation key
//   dailyRangeBody.js         -> salary_summary.workers
//   page.js                   -> totalWorkersInRange (via server field)
//
// Fallback rule. When a worker_id has NO email in the map (rare - it
// implies the workers-latest read didn't see that id, e.g., the
// worker was ingested after the resolver ran), the id counts as its
// own person under the sentinel `wid:<id>`. Conservative: it does
// NOT collapse unmapped ids together, and it does NOT drop them from
// the count. If a row has no worker_id at all, it is skipped.
//
// Related memory: [[worker_id-per-spell]] - "Rippling gives seasonal
// rehires a new worker_id each season. Email is the person key.
// Never dedupe or filter status by matching one worker_id row; check
// for ANY active spell."

/**
 * Count distinct people across rows.
 *
 * @param {Array<{worker_id?: string}>} rows            labor rows (any shape with worker_id)
 * @param {Map<string,string>|Record<string,string>|null|undefined} workerToEmail
 *   worker_id -> lowercase work_email. Passing null / undefined /
 *   empty is legal and degrades to the old worker_id-based count -
 *   used by callers that legitimately have no map (fixture tests,
 *   legacy paths pre-cutover).
 * @returns {number}
 */
export function countDistinctPeople(rows, workerToEmail) {
  const emailMap = toEmailMap(workerToEmail);
  const seen = new Set();
  for (const r of rows || []) {
    const wid = r?.worker_id;
    if (!wid) continue;
    const email = emailMap.get(wid);
    seen.add(email || `wid:${wid}`);
  }
  return seen.size;
}

function toEmailMap(x) {
  if (!x) return new Map();
  if (x instanceof Map) return x;
  return new Map(Object.entries(x));
}

/**
 * Build a worker_id -> email Map from the workerMeta dict that
 * resolveWorkerMeta returns. Skips workers with no email so the
 * countDistinctPeople fallback (unmapped id counts as itself) fires
 * cleanly.
 *
 * @param {Record<string,{email?: string|null}>} workerMeta
 * @returns {Map<string,string>}
 */
export function buildWorkerToEmail(workerMeta) {
  const m = new Map();
  if (!workerMeta) return m;
  for (const [workerId, meta] of Object.entries(workerMeta)) {
    if (meta?.email) m.set(workerId, meta.email);
  }
  return m;
}
