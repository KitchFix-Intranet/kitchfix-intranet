// ═══════════════════════════════════════════════════════════════════
// getSalariedManagerEmails - derive the notify list from `people`
// ═══════════════════════════════════════════════════════════════════
//
// Kevin ruling 2026-09-17. `sc_qbo_account_map.salaried_manager_emails`
// is hand-maintained and has drifted on two of four accounts (TBR
// still carried a terminated worker; TXR was missing a promotion).
// Only salaried managers have system access, so the access list and
// the notify list are the same list - derive rather than store.
//
// This module is the single source of that derivation. Every caller
// (recipients.js consumers, chasePersonName.js consumers, dry-run
// headcount logs) reads from here and only here. If a second
// implementation appears in the codebase - stop and merge it back.
// See docs/backlog/sc-structural-health-post-training.md item 1's
// worked examples for why two implementations always cost more than
// they save.
//
// Same predicate everywhere. Same ordering everywhere.
//
// PREDICATE
//   FROM people
//   WHERE account_key = <account>
//     AND status = 'ACTIVE'
//     AND is_salaried IS TRUE
//     AND work_email IS NOT NULL
//
// ORDERING (Kevin ruling 2026-09-17)
//   ORDER BY is_site_leader DESC NULLS LAST, display_name
//
//   chasePersonName's first_salaried fallback picks index 0. Ordering
//   by is_site_leader first makes that pick meaningful (the person
//   accountable for the site sorts first). display_name is the tie
//   breaker so the order is deterministic across runs.

/**
 * Emails of salaried managers at ONE account, ordered.
 *
 * @param {SupabaseClient} supa
 * @param {string} accountKey - e.g. "TXR - AZ"
 * @returns {Promise<string[]>} lowercased-order preserved as stored
 * @throws on DB error - never returns an empty array to mask a fault
 */
export async function getSalariedManagerEmails(supa, accountKey) {
  const { data, error } = await supa
    .from("people")
    .select("work_email, is_site_leader, display_name")
    .eq("account_key", accountKey)
    .eq("status", "ACTIVE")
    .eq("is_salaried", true)
    .not("work_email", "is", null)
    .order("is_site_leader", { ascending: false, nullsFirst: false })
    .order("display_name",   { ascending: true });
  if (error) {
    throw new Error(`getSalariedManagerEmails(${accountKey}): ${error.message}`);
  }
  return (data || []).map(r => r.work_email);
}

/**
 * Batch variant. One query for N accounts, returns a Map keyed on
 * account_key -> ordered email array. Callers iterate accounts and
 * read per-account via `map.get(accountKey) || []`.
 *
 * Empty array (not undefined) for accounts with zero salaried
 * managers in `people` - so callers can drop the `|| []` guard and
 * a genuinely-empty account still surfaces as "no site recipient"
 * downstream (see chaseNotifications.js noSiteRecipient guard).
 *
 * @param {SupabaseClient} supa
 * @param {string[]} accountKeys
 * @returns {Promise<Map<string, string[]>>}
 * @throws on DB error
 */
export async function getSalariedManagerEmailsBatch(supa, accountKeys) {
  const keys = [...(accountKeys || [])].filter(Boolean);
  const byAccount = new Map(keys.map(k => [k, []]));
  if (keys.length === 0) return byAccount;
  const { data, error } = await supa
    .from("people")
    .select("account_key, work_email, is_site_leader, display_name")
    .in("account_key", keys)
    .eq("status", "ACTIVE")
    .eq("is_salaried", true)
    .not("work_email", "is", null)
    .order("account_key",     { ascending: true })
    .order("is_site_leader",  { ascending: false, nullsFirst: false })
    .order("display_name",    { ascending: true });
  if (error) {
    throw new Error(`getSalariedManagerEmailsBatch(${keys.length} accounts): ${error.message}`);
  }
  for (const r of data || []) {
    if (!byAccount.has(r.account_key)) byAccount.set(r.account_key, []);
    byAccount.get(r.account_key).push(r.work_email);
  }
  return byAccount;
}
