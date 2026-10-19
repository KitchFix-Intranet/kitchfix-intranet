// ═══════════════════════════════════════════════════════════════════════════
// Shared heartbeat helper for scheduled crons.
// ═══════════════════════════════════════════════════════════════════════════
//
// Reads/writes the `cron_runs` table created by
// docs/migrations/cron-heartbeat.sql. Every surviving cron imports
// `startCronRun` + `finishCronRun` from this file to record one row per
// authorized invocation.
//
// HARD RULE: this helper must never take down the job it measures. A
// heartbeat that crashes the scanner is worse than no heartbeat. Both
// functions catch internally and log to console.warn - neither throws to
// its caller. If the table is missing (migration not applied), the start
// insert fails, returns null, and the host cron continues exactly as if
// this file did not exist. The finish call tolerates a null id for the
// same reason.
//
// Callers pass their already-constructed service client (every cron
// already has one via getServiceClient()). This keeps the helper
// dependency-free and avoids a second client construction per tick.

/**
 * Open a heartbeat row for a cron tick.
 *
 * @param {object} supa    - service-role Supabase client (callers already have it)
 * @param {string} jobName - the logical cron name (e.g. "extract-line-items")
 * @returns {Promise<number | null>}  the inserted row's id, or null on any failure
 */
export async function startCronRun(supa, jobName) {
  try {
    const { data, error } = await supa
      .from("cron_runs")
      .insert({ job_name: jobName, status: "in_progress" })
      .select("id")
      .single();
    if (error) {
      console.warn(`[cronRuns] startCronRun(${jobName}) insert failed: ${error.message}`);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.warn(`[cronRuns] startCronRun(${jobName}) threw: ${e?.message || e}`);
    return null;
  }
}

/**
 * Close a heartbeat row with an outcome. No-op when id is null (which is
 * the normal response to startCronRun failing). Never throws.
 *
 * @param {object} supa          - service-role Supabase client
 * @param {number | null} id     - row id returned by startCronRun
 * @param {object} fields
 * @param {'success'|'failed'} fields.status
 * @param {object} [fields.summary]       - JSONB blob; the job's own result shape
 * @param {string} [fields.errorMessage]  - stored as error_message on failed runs
 */
export async function finishCronRun(supa, id, { status, summary, errorMessage } = {}) {
  if (id === null || id === undefined) return;
  try {
    const payload = {
      completed_at:  new Date().toISOString(),
      status:        status,
    };
    if (summary !== undefined) payload.summary = summary;
    if (errorMessage !== undefined && errorMessage !== null) payload.error_message = String(errorMessage);
    const { error } = await supa
      .from("cron_runs")
      .update(payload)
      .eq("id", id);
    if (error) {
      console.warn(`[cronRuns] finishCronRun(id=${id}) update failed: ${error.message}`);
    }
  } catch (e) {
    console.warn(`[cronRuns] finishCronRun(id=${id}) threw: ${e?.message || e}`);
  }
}
