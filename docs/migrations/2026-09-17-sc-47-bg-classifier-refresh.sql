-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-17-sc-47-bg-classifier-refresh
--
-- One-shot cleanup. sc-47's first --write ran with a classifier bug
-- that misclassified the 4 BG-SINGLE tabs (TBR 2024/2025 actuals +
-- projections) as STANDARD, filing ~413 rows with wrong shape
-- (service_name='Total Revenue', count=750, rate=0 as an example -
-- rate columns misread as service names). Root cause: ExcelJS fills
-- merged cells and the row-1 'Day' merge spilled across cols 6-7 on
-- the BG tabs, tripping the loader's row-1-band-count check that
-- distinguished BG-SINGLE. openpyxl returns null for merged children
-- so the Python family probe classified correctly; the ExcelJS-side
-- loader did not.
--
-- Fix (already on main via feat/historical-sc-load HEAD): classifier
-- now keys on col-D header = 'Lunch' as the positive BG signal
-- instead of counting row-1 bands. No STANDARD/TBR-STD tab has col D
-- = 'Lunch' (they all have col D = 'Week'), so the discriminator is
-- unambiguous and merged-cell semantics are irrelevant.
--
-- Full truncate + reload rather than surgical DELETE of the 4 tabs.
-- Kevin ruling 2026-09-17: "the classifier fix changed row counts on
-- both tables, so a partial reload leaves two parser versions mixed
-- in one table. For audit data that's worse than 30 seconds."
--
-- Post-truncate row counts should be 0 in both tables. Loader re-run
-- follows immediately after and re-populates with the corrected
-- shape - expected 20,449 actuals + 20,946 projections (dry-run
-- totals with classifier fix).
--
-- Three-block Studio pattern (preflight / main / postflight).
-- One-shot; not idempotent by design - re-running block B on a
-- freshly-loaded table would wipe the good data. Kevin runs this
-- ONCE before the sc-47 loader re-run.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Current state before truncate. Expected:
--   sc_historical_actuals     ~20,586 rows (from the buggy first --write)
--   sc_historical_projections ~21,222 rows
-- Also expected: several rows with service_name='Total Revenue',
-- which is the tell that the BG tabs were parsed with the STANDARD
-- parser.
SELECT 'sc_historical_actuals'     AS tbl, count(*) AS rows FROM sc_historical_actuals
UNION ALL
SELECT 'sc_historical_projections',       count(*)         FROM sc_historical_projections;

-- Confirm the misclassification tell rows exist. Expected > 0
-- before the truncate; will vanish after reload with the fixed
-- classifier.
SELECT source_file, source_tab, count(*) AS bad_rows
FROM sc_historical_actuals
WHERE service_name = 'Total Revenue'
GROUP BY source_file, source_tab
ORDER BY source_file, source_tab;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- TRUNCATE resets identity sequences; DELETE keeps them advanced.
-- Prefer TRUNCATE here so id starts at 1 on the reload - cleaner
-- for a first-real-load state.
TRUNCATE TABLE sc_historical_actuals     RESTART IDENTITY;
TRUNCATE TABLE sc_historical_projections RESTART IDENTITY;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Expected: both tables at 0 rows.
SELECT 'sc_historical_actuals'     AS tbl, count(*) AS rows FROM sc_historical_actuals
UNION ALL
SELECT 'sc_historical_projections',       count(*)         FROM sc_historical_projections;

-- Confirm the id sequences reset to 1 (TRUNCATE ... RESTART IDENTITY).
SELECT sequence_name, last_value, is_called
FROM (
  SELECT 'sc_historical_actuals_id_seq'     AS sequence_name, last_value, is_called
  FROM sc_historical_actuals_id_seq
  UNION ALL
  SELECT 'sc_historical_projections_id_seq',                  last_value, is_called
  FROM sc_historical_projections_id_seq
) s
ORDER BY sequence_name;

-- After this file lands and Kevin runs the loader:
--   node --env-file=.env.local scripts/billing/seed-historical-sc.mjs --write
--
-- Expected loader final counts (matching dry-run with fixed classifier):
--   sc_historical_actuals:     20,449 rows written
--   sc_historical_projections: 20,946 rows written
