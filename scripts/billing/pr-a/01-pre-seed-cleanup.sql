-- PR-A / Block 1 (pre-seed cleanup)
--
-- Run this in Supabase Studio BEFORE the seeder --write step.
-- Chat-Claude reviews before Kevin executes.
--
-- Scope: CIN - AZ, TXR - AZ.
-- Range: 2026-01-01 .. current.
--
-- What this removes:
--   sc_week_finalize    - 5 CIN + 7 TXR = 12 dev-artefact rows. All by
--                          k.fietek@, revert reasons include "test2",
--                          "a", "Test", "Test1", "push_failed" states.
--                          Finalize records pointing at actuals that
--                          are about to be replaced are worse than the
--                          data they reference.
--   sc_export_ledger    - 11 TXR rows (0 CIN). None carries a
--                          qbo_doc_number. Statuses in {test, failed,
--                          superseded}. Nothing was ever invoiced from
--                          the Service Calendar for either account.
--   sc_day_metadata     - one surgical blank: the CIN "TEST" note on
--                          2026-07-09. Two real "Service cancelled -
--                          marked no service" notes on 2026-07-10 and
--                          2026-07-17 are LEFT INTACT.
--
-- What this deliberately does NOT touch:
--   sc_daily_actuals             - handled by the seeder
--   sc_daily_actuals_history     - handled in Block 2 (after seed)
--   sc_day_note_entries          - author-authored notes; preserved
--   sc_day_metadata event_label/game_time/etc - calendar structure
--   sc_week_chase_sent           - a chase email was sent; the fact
--                                   remains true regardless of counts
--   sc_daily_projections         - CIN keeps as-is (matches WB);
--                                   TXR reseed follows in PR-B
--   sc_phase_calendar, sc_services, catalog - out of scope

BEGIN;

-- 1a. Finalize rows.
WITH deleted AS (
  DELETE FROM sc_week_finalize
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND week_start >= '2026-01-01'
  RETURNING account_key, week_start, status
)
SELECT 'sc_week_finalize deleted' AS action, account_key, COUNT(*) AS rows,
       string_agg(week_start::text || ' ' || status, ', ' ORDER BY week_start) AS detail
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 1b. Export-ledger rows.
-- Guard: qbo_doc_number IS NULL. A non-null doc number is the record
-- that a real invoice was pushed to QuickBooks. That evidence must
-- survive the cleanup regardless of the actuals-side reseed. Preflight
-- (2026-09-15) confirmed all 11 TXR rows are null and CIN has none;
-- the guard is the mechanical enforcement, not the observation. If a
-- row ever carried a doc number and this predicate spares it, the
-- returning count comes back below 11 and Kevin sees the delta.
WITH deleted AS (
  DELETE FROM sc_export_ledger
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND week_start >= '2026-01-01'
    AND qbo_doc_number IS NULL
  RETURNING account_key, week_start, status, qbo_invoice_id, qbo_doc_number
)
SELECT 'sc_export_ledger deleted' AS action, account_key, COUNT(*) AS rows,
       COUNT(qbo_doc_number) AS with_qbo_doc_number,
       string_agg(week_start::text || ' ' || status, ', ' ORDER BY week_start) AS detail
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 1c. Blank the single CIN "TEST" note (2026-07-09).
-- Guarded by exact text so no other note is affected.
WITH updated AS (
  UPDATE sc_day_metadata
     SET notes = NULL,
         updated_by = 'spreadsheet_seed_cleanup',
         updated_at = NOW()
   WHERE account_key = 'CIN - AZ'
     AND service_date = '2026-07-09'
     AND notes = 'TEST'
  RETURNING account_key, service_date, notes
)
SELECT 'sc_day_metadata TEST note blanked' AS action, COUNT(*) AS rows
FROM updated;

-- 1d. Sanity: the two real "Service cancelled" notes must still be there.
SELECT 'preserved cancel notes (expect 2)' AS check, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key = 'CIN - AZ'
  AND service_date IN ('2026-07-10','2026-07-17')
  AND notes ILIKE '%Service cancelled%';

COMMIT;
