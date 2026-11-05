-- PR-A / Block 3 (post-write verification)
--
-- Run this in Supabase Studio after Blocks 1 and 2 and the seeder
-- --write have all completed. Read-only. Confirms the end state.

-- V1: sc_daily_actuals composition in scope.
--     Composition-by-created_by (V1a) plus a hard row-count assertion
--     against the dry-run intended totals (V1b). A 100% spreadsheet_seed
--     composition at, say, 1,400 rows would pass V1a but is a partial
--     write - V1b catches that shape.
SELECT 'V1a actuals composition' AS check,
       a.account_key,
       a.created_by,
       COUNT(*) AS rows,
       MIN(a.service_date) AS min_d,
       MAX(a.service_date) AS max_d
FROM sc_daily_actuals a
WHERE a.account_key IN ('CIN - AZ','TXR - AZ')
  AND a.service_date >= '2026-01-01'
GROUP BY a.account_key, a.created_by
ORDER BY a.account_key, a.created_by;
-- Expect: created_by = 'spreadsheet_seed' rows only.

-- V1b: hard row-count assertion against dry-run intended totals.
--      Expected values captured from 2026-09-15 dry-run:
--        CIN - AZ  intended = 2795
--        TXR - AZ  intended = 2821
--      If the workbook is re-run at a later date these numbers will
--      drift; update this block from the write-step's own reported
--      intended-inserts count before running verify.
SELECT 'V1b row-count assertion' AS check,
       a.account_key,
       COUNT(*) AS rows,
       CASE
         WHEN a.account_key = 'CIN - AZ' AND COUNT(*) = 2795 THEN 'MATCH'
         WHEN a.account_key = 'TXR - AZ' AND COUNT(*) = 2821 THEN 'MATCH'
         ELSE 'MISMATCH (expected CIN=2795, TXR=2821)'
       END AS verdict
FROM sc_daily_actuals a
WHERE a.account_key IN ('CIN - AZ','TXR - AZ')
  AND a.service_date >= '2026-01-01'
  AND a.created_by = 'spreadsheet_seed'
GROUP BY a.account_key
ORDER BY a.account_key;

-- V2: no legacy provenance rows survived.
SELECT 'V2 legacy provenance (expect 0)' AS check,
       account_key,
       created_by,
       COUNT(*) AS rows
FROM sc_daily_actuals
WHERE account_key IN ('CIN - AZ','TXR - AZ')
  AND service_date >= '2026-01-01'
  AND created_by IN ('import-script','k.fietek@kitchfix.com')
GROUP BY account_key, created_by
ORDER BY account_key, created_by;

-- V3: finalize + ledger + history all empty for both accounts.
SELECT 'V3 sc_week_finalize (expect 0)' AS check,
       account_key, COUNT(*) AS rows
FROM sc_week_finalize
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key;

SELECT 'V3 sc_export_ledger (expect 0)' AS check,
       account_key, COUNT(*) AS rows
FROM sc_export_ledger
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key;

SELECT 'V3 sc_daily_actuals_history (expect 0)' AS check,
       account_key, COUNT(*) AS rows
FROM sc_daily_actuals_history
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key;

-- V4: preserved surfaces still populated.
SELECT 'V4 sc_day_note_entries preserved' AS check,
       account_key, COUNT(*) AS rows
FROM sc_day_note_entries
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key
ORDER BY account_key;

SELECT 'V4 sc_day_metadata event_label preserved' AS check,
       account_key, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key IN ('CIN - AZ','TXR - AZ')
  AND event_label IS NOT NULL AND event_label <> ''
GROUP BY account_key
ORDER BY account_key;

SELECT 'V4 sc_week_chase_sent preserved' AS check,
       account_key, COUNT(*) AS rows
FROM sc_week_chase_sent
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key
ORDER BY account_key;

-- V5: the two real cancel notes intact; the TEST note gone.
SELECT 'V5 preserved cancel notes (expect 2)' AS check, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key = 'CIN - AZ'
  AND service_date IN ('2026-07-10','2026-07-17')
  AND notes ILIKE '%Service cancelled%';

SELECT 'V5 removed TEST note (expect 0)' AS check, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key = 'CIN - AZ'
  AND service_date = '2026-07-09'
  AND notes = 'TEST';

-- V6: catalog untouched.
SELECT 'V6 active service count' AS check,
       account_key, COUNT(*) AS rows
FROM sc_services
WHERE account_key IN ('CIN - AZ','TXR - AZ')
  AND deleted_at IS NULL
  AND active_until IS NULL
GROUP BY account_key
ORDER BY account_key;
-- Expect: 13 and 13 (same as before the reseed).

-- V7: projection state - CIN unchanged, TXR untouched pending PR-B.
SELECT 'V7 projections (unchanged this PR)' AS check,
       account_key,
       created_by,
       COUNT(*) AS rows
FROM sc_daily_projections
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key, created_by
ORDER BY account_key, created_by;
