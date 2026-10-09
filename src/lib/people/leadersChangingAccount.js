// src/lib/people/leadersChangingAccount.js
//
// Pure helper for scripts/derive_people.mjs. Site leadership is
// account-scoped: it does not travel with a worker. When a current
// is_site_leader's derived account_key changes to a different known
// account, the derive must clear that worker's is_site_leader before
// the main upsert (the upsert itself still omits is_site_leader so
// every other owner-set leader is preserved). Owner reassigns the
// new account's leader separately.
//
// Guard on "non-null new account_key" on purpose: a department-map
// gap that drops account_key to null must NOT strip a leader; only a
// real move to a different known account does.
//
// Origin incident: 2026-10-09 Stephen Bailey CIN - KY -> TBR - FL;
// crashed the nightly on people_one_leader_per_account.

/**
 * Return the list of worker_ids whose is_site_leader flag must be
 * cleared because they moved to a different known account.
 *
 * @param {Map<string, { account_key: string|null, is_site_leader: boolean }>} existingByWorker
 *   Snapshot of the current people rows keyed by worker_id.
 * @param {Array<{ worker_id: string, account_key: string|null }>} shapedRows
 *   The derive's post-shaping row list (new account_key already set).
 * @returns {string[]} worker_ids that need their flag cleared.
 */
export function leadersChangingAccount(existingByWorker, shapedRows) {
  const out = [];
  for (const r of shapedRows) {
    const prev = existingByWorker.get(r.worker_id);
    if (!prev) continue;                       // new row, no prior leader state
    if (!prev.is_site_leader) continue;        // was not a leader
    if (r.account_key == null) continue;       // unknown-department gap, don't strip
    if (r.account_key === prev.account_key) continue; // same account, no transfer
    out.push(r.worker_id);
  }
  return out;
}
