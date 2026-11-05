-- PR-A / Block 2 (post-seed history purge)
--
-- Run this in Supabase Studio AFTER the seeder --write step completes.
-- Chat-Claude reviews before Kevin executes.
--
-- Trigger inventory on sc_daily_actuals (verified 2026-09-15):
--   sc_daily_actuals_audit_trigger   BEFORE UPDATE ROW
--   sc_daily_actuals_delete_trigger  BEFORE DELETE ROW
--   (no INSERT trigger)
--
-- Consequence for the seeder run: the DELETE step inside writeAccount
-- fires the delete trigger once per pre-existing row (2,816 CIN +
-- 2,298 TXR = 5,114 new history rows with change_type='delete'). The
-- INSERT step that follows produces zero history rows. So immediately
-- after --write, sc_daily_actuals_history for these two accounts in
-- scope contains: (135 CIN + 62 TXR pre-existing rows) + 5,114
-- trigger-generated deletion rows = 5,311 rows total, all referencing
-- actual_id values that no longer exist.
--
-- Why after, not before:
--   If we purged history first, the seeder's DELETE would immediately
--   re-populate history with 5,114 fresh rows and we'd need a second
--   purge anyway. Running after does it in one shot.
--
-- Design decision (Kevin ruling 2026-09-15): the trigger-generated
-- rows go with the purge. Clean-slate history is the correct end
-- state after a full replace under a new provenance - the pre-seed
-- history describes rows that no longer exist, and the delete-trigger
-- rows describe transitions that have no forward reference either.
-- 2a's range predicate sweeps both together.
--
-- 2b is defensive: any history row on a date outside 2026-01-01..
-- 2027-12-31 for these accounts. Preflight found one (TXR 2029-01-07
-- from an earlier session). 2a's `service_date >= '2026-01-01'` with
-- no upper bound already catches that 2029 row; 2b is left in place
-- so a future pre-2026 artefact would still be swept, but under
-- current DB state 2b's RETURNING will be empty.

BEGIN;

-- 2a. Purge history for both accounts within scope (uses service_date,
--     not changed_at, since the row records the service_date of the
--     deleted/updated actual).
WITH deleted AS (
  DELETE FROM sc_daily_actuals_history
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND service_date >= '2026-01-01'
  RETURNING account_key, service_date, change_type
)
SELECT 'sc_daily_actuals_history purged (in scope)' AS action,
       account_key,
       COUNT(*) AS rows,
       COUNT(*) FILTER (WHERE change_type = 'delete') AS deletes,
       COUNT(*) FILTER (WHERE change_type = 'update') AS updates,
       MIN(service_date) AS min_d,
       MAX(service_date) AS max_d
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 2b. Sweep the 2029-01-07 TXR artefact and anything else pre-scope
--     (should be nothing on CIN; TXR has the one bad-date row).
WITH deleted AS (
  DELETE FROM sc_daily_actuals_history
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND (service_date < '2026-01-01' OR service_date > '2027-12-31')
  RETURNING account_key, service_date, change_type
)
SELECT 'sc_daily_actuals_history out-of-scope sweep' AS action,
       account_key,
       COUNT(*) AS rows,
       string_agg(service_date::text || ' ' || change_type, ', ' ORDER BY service_date) AS detail
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 2c. Verify: zero history rows for either account across all dates.
SELECT 'residual history (expect 0 both)' AS check,
       account_key,
       COUNT(*) AS rows
FROM sc_daily_actuals_history
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key
ORDER BY account_key;

COMMIT;
