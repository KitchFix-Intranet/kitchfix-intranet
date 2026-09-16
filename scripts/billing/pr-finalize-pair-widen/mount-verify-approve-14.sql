-- PR: finalize confirm pair-widen · mount-verify helper (2026-09-16)
--
-- Purpose. Pre-approves the 14 days of CIN - AZ pair 2026-08-10..2026-08-23
-- so a live mount-verify can jump straight to the CONFIRM overlay (the
-- surface that was defective) without clicking through 14 approve
-- buttons. The review path is unchanged and already correct per Kevin's
-- 2026-09-16 observation; this shortcut is for the acceptance loop.
--
-- Scope: CIN - AZ, service_date IN 2026-08-10..2026-08-23. Sets
-- sc_day_metadata.review_status = 'approved' for those 14 rows.
--
-- Idempotent: WHERE clause only flips rows that are not already approved.
-- Safe to run multiple times if the acceptance loop repeats.
--
-- REVERT (after acceptance): the finalize action creates a
-- sc_week_finalize row. Delete that + the ledger row + any resulting
-- sc_daily_actuals_history rows using the Block-1 / Block-2 SQL shape
-- from scripts/billing/pr-a. This script does not touch actuals.

BEGIN;

WITH updated AS (
  UPDATE sc_day_metadata
     SET review_status = 'approved',
         reviewed_by = 'mount-verify',
         reviewed_at = NOW(),
         updated_by = 'mount-verify',
         updated_at = NOW()
   WHERE account_key = 'CIN - AZ'
     AND service_date >= '2026-08-10'
     AND service_date <= '2026-08-23'
     AND (review_status IS NULL OR review_status <> 'approved')
  RETURNING service_date
)
SELECT 'sc_day_metadata approved for mount-verify' AS action,
       COUNT(*) AS rows,
       MIN(service_date) AS first_date,
       MAX(service_date) AS last_date
FROM updated;

-- Sanity: after the update, all 14 days should show review_status = 'approved'.
SELECT 'review_status coverage (expect 14 approved)' AS check,
       review_status,
       COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key = 'CIN - AZ'
  AND service_date >= '2026-08-10'
  AND service_date <= '2026-08-23'
GROUP BY review_status
ORDER BY review_status NULLS LAST;

COMMIT;

-- Undo (revert after acceptance):
--
-- BEGIN;
-- UPDATE sc_day_metadata
--    SET review_status = NULL,
--        reviewed_by   = NULL,
--        reviewed_at   = NULL,
--        updated_by    = 'mount-verify-revert',
--        updated_at    = NOW()
--  WHERE account_key = 'CIN - AZ'
--    AND service_date >= '2026-08-10'
--    AND service_date <= '2026-08-23'
--    AND reviewed_by = 'mount-verify';
-- COMMIT;
