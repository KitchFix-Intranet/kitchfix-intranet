// M-1 labor-budget dataStore. Read-live, read-history, write-supersede.
//
// The write path never UPDATEs an existing row's business fields. A
// change is a NEW row + a paired UPDATE that sets `superseded_at` on
// the previous live row. This is the "trail is the data rather than a
// side table" pattern owner named. No sc_config_changelog write.
//
// The ratio path DOES write sc_config_changelog (entity_type =
// 'labor_ratio') because `accounts.labor_ratio` is a single-cell edit
// - the trail cannot live on the row itself.

import { getServiceClient } from "@/lib/supabase";

const TABLE = "sc_labor_budgets";
const CHANGELOG = "sc_config_changelog";

/**
 * Read all live rows for one account (superseded_at IS NULL).
 * Returns [] if the account has no budgets. Ordered by period.
 *
 * NOTE: caller filters non-MLB accounts. This layer trusts.
 */
export async function readLiveLaborBudgets(accountKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from(TABLE)
    .select("id, account_key, period, hourly_budget, salary_budget, revenue_forecast, effective_from, reason, changed_by, changed_at")
    .eq("account_key", accountKey)
    .is("superseded_at", null)
    .order("period", { ascending: true });
  if (error) throw new Error(`readLiveLaborBudgets: ${error.message}`);
  return data || [];
}

/**
 * Read full history for one (account, period). Ordered newest first.
 * Includes both live and superseded rows.
 */
export async function readLaborBudgetHistory(accountKey, period) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from(TABLE)
    .select("id, account_key, period, hourly_budget, salary_budget, revenue_forecast, effective_from, superseded_at, reason, requested_by, changed_by, changed_at")
    .eq("account_key", accountKey)
    .eq("period", period)
    .order("effective_from", { ascending: false })
    .order("changed_at", { ascending: false });
  if (error) throw new Error(`readLaborBudgetHistory: ${error.message}`);
  return data || [];
}

/**
 * Write a new (account, period) budget row. Closes the previous
 * live row for the same tuple by setting `superseded_at`.
 *
 * @param {string} accountKey
 * @param {object} change - { period, hourlyBudget, salaryBudget,
 *                            revenueForecast, effectiveFrom, reason,
 *                            requestedBy? }
 * @param {string} email - actor email (-> changed_by)
 */
export async function updateLaborBudget(accountKey, change, email) {
  const supa = getServiceClient();
  if (!change?.period) throw new Error("updateLaborBudget: period is required");
  if (!change?.effectiveFrom) throw new Error("updateLaborBudget: effectiveFrom is required");
  if (!change?.reason || !String(change.reason).trim()) {
    throw new Error("updateLaborBudget: reason is required");
  }
  if (!email) throw new Error("updateLaborBudget: email is required");

  // 1) Close the previous live row (idempotent - no-op if none exists).
  const nowIso = new Date().toISOString();
  const { data: closed, error: closeErr } = await supa
    .from(TABLE)
    .update({ superseded_at: nowIso })
    .eq("account_key", accountKey)
    .eq("period", change.period)
    .is("superseded_at", null)
    .select("id");
  if (closeErr) throw new Error(`updateLaborBudget.close: ${closeErr.message}`);

  // 2) Insert the new row.
  const newRow = {
    account_key:      accountKey,
    period:           change.period,
    hourly_budget:    change.hourlyBudget != null ? Number(change.hourlyBudget) : null,
    salary_budget:    change.salaryBudget != null ? Number(change.salaryBudget) : null,
    revenue_forecast: change.revenueForecast != null ? Number(change.revenueForecast) : null,
    effective_from:   change.effectiveFrom,
    superseded_at:    null,
    reason:           String(change.reason).trim(),
    requested_by:     change.requestedBy ? String(change.requestedBy).trim() : null,
    changed_by:       email,
  };
  const insRes = await supa.from(TABLE).insert(newRow).select("id, changed_at").single();
  if (insRes.error) throw new Error(`updateLaborBudget.insert: ${insRes.error.message}`);

  return {
    success: true,
    id: insRes.data.id,
    changedAt: insRes.data.changed_at,
    supersededCount: closed?.length || 0,
  };
}

/**
 * Read the labor_ratio for one account. Returns { labor_ratio: number|null }.
 */
export async function readLaborRatio(accountKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("accounts")
    .select("team_key, labor_ratio")
    .eq("team_key", accountKey)
    .single();
  if (error) throw new Error(`readLaborRatio: ${error.message}`);
  return { accountKey: data.team_key, laborRatio: data.labor_ratio != null ? Number(data.labor_ratio) : null };
}

/**
 * Update accounts.labor_ratio for one account. Paired with a
 * sc_config_changelog insert (entity_type='labor_ratio').
 */
export async function updateLaborRatio(accountKey, change, email) {
  const supa = getServiceClient();
  if (change?.laborRatio == null) throw new Error("updateLaborRatio: laborRatio is required");
  if (!change?.reason || !String(change.reason).trim()) {
    throw new Error("updateLaborRatio: reason is required");
  }
  if (!email) throw new Error("updateLaborRatio: email is required");

  // 1) Read prior value for changelog.
  const prior = await readLaborRatio(accountKey);

  // 2) Update accounts.labor_ratio.
  const { error: updErr } = await supa
    .from("accounts")
    .update({ labor_ratio: Number(change.laborRatio) })
    .eq("team_key", accountKey);
  if (updErr) throw new Error(`updateLaborRatio.update: ${updErr.message}`);

  // 3) Write changelog row. Effective date is NOW (labor_ratio is a
  // live parameter; edits take effect immediately).
  const today = new Date().toISOString().slice(0, 10);
  const { error: logErr } = await supa.from(CHANGELOG).insert({
    account_key:    accountKey,
    entity_type:    "labor_ratio",
    entity_id:      null,
    entity_label:   `${accountKey} labor_ratio`,
    change_type:    prior.laborRatio == null ? "create" : "update",
    old_value:      prior.laborRatio == null ? null : { laborRatio: prior.laborRatio },
    new_value:      { laborRatio: Number(change.laborRatio) },
    effective_date: today,
    reason:         String(change.reason).trim(),
    requested_by:   change.requestedBy ? String(change.requestedBy).trim() : null,
    changed_by:     email,
  });
  if (logErr) throw new Error(`updateLaborRatio.changelog: ${logErr.message}`);

  return { success: true, priorRatio: prior.laborRatio, newRatio: Number(change.laborRatio) };
}

/**
 * Read the labor_ratio changelog history for one account.
 * Ordered newest first.
 */
export async function readLaborRatioHistory(accountKey) {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from(CHANGELOG)
    .select("id, old_value, new_value, effective_date, reason, requested_by, changed_by, changed_at")
    .eq("account_key", accountKey)
    .eq("entity_type", "labor_ratio")
    .order("changed_at", { ascending: false });
  if (error) throw new Error(`readLaborRatioHistory: ${error.message}`);
  return data || [];
}
