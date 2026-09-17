-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-17-sc-47-amount-service-refresh
--
-- Second one-shot cleanup for sc-47. First reload (post-BG-classifier
-- fix) landed 12,640 actuals + 12,296 projections; the per-account
-- per-year revenue spot-check surfaced TBJ - FL 2025 at $687M against
-- a $100K-$1.9M population elsewhere. Root cause: TBJ "Fun $$$$
-- Allocated" is a dollar-allocation service (not a per-cover charge),
-- but the loader treated it as per-cover and multiplied the dollar
-- value by the header rate. Same class as the live SC's
-- sc_services.is_non_revenue=true handling.
--
-- Kevin ruling 2026-09-17: mirror the live system. Add an explicit
-- AMOUNT_SERVICES set to the loader keyed on (account_key,
-- service_name); for matching rows emit count=null, rate=null,
-- revenue=value-from-column (same shape as BG-SINGLE tabs).
--
-- KEVIN'S KEY OBSERVATION (also captured in the loader header):
-- A rate of $0 in a header does NOT mean "no charge" - it means
-- "this column is not priced per cover." TBJ Fun Money is at rate=$0
-- in 2023 and 2024 with real dollar values in the data column. The
-- prior loader (per-cover) computed revenue=$0 for those rows,
-- silently under-counting TBJ FL 2023 by $16K and TBJ FL 2024 by
-- $25K. Neither would have prompted a human to notice. The visible
-- $687M failure exposed a two-year hidden under-count.
--
-- Also in this PR: post-load sanity assertion. Any account-year
-- revenue total > 10x median across all account-year totals halts
-- the load. Low outliers (< median/10) report only. Would have
-- caught the $687M automatically.
--
-- FULL TRUNCATE + RELOAD, not surgical DELETE. Same reasoning as the
-- prior refresh (2026-09-17-sc-47-bg-classifier-refresh): "the
-- classifier fix changed row counts on both tables, so a partial
-- reload leaves two parser versions mixed in one table. For audit
-- data that's worse than 30 seconds." The amount-service fix
-- changes the shape of Fun Money rows AND changes downstream sums;
-- a mixed state is worse than a rebuild.
--
-- Post-truncate row counts should be 0. Loader re-run follows and
-- re-populates with the corrected shape - dry-run projects:
--   sc_historical_actuals:     12,640 rows (unchanged - Fun Money
--                              row count is the same, only their
--                              revenue values change)
--   sc_historical_projections: 12,296 rows (unchanged)
-- TBJ FL 2025 corrected revenue: ~$1.43M (was $687.9M). TBJ FL
-- 2023: ~$1.24M (was $1.22M, gains $16K from Fun Money). TBJ FL
-- 2024: ~$1.32M (was $1.30M, gains $25K).
--
-- Three-block Studio pattern. One-shot; not idempotent by design.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Current state before truncate. Expected:
--   sc_historical_actuals     12,640 rows
--   sc_historical_projections 12,296 rows
SELECT 'sc_historical_actuals'     AS tbl, count(*) AS rows FROM sc_historical_actuals
UNION ALL
SELECT 'sc_historical_projections',       count(*)         FROM sc_historical_projections;

-- The $687M cell that surfaced the amount-service bug. Expected:
-- exactly one row aggregating to $687,933,933.57 for TBJ - FL 2025.
SELECT account_key,
       EXTRACT(YEAR FROM service_date)::int AS year,
       count(*) AS rows,
       SUM(revenue)::numeric(14,2) AS total_revenue
FROM sc_historical_actuals
WHERE account_key = 'TBJ - FL'
GROUP BY 1, 2
ORDER BY 2;

-- Fun Money rows that will change shape post-reload. Expected 25
-- rows in actuals summing to ~$686,524,185.88; 0 in projections.
SELECT source_file, source_tab, count(*) AS rows,
       SUM(revenue)::numeric(14,2) AS bad_revenue,
       MIN(service_date) AS earliest,
       MAX(service_date) AS latest
FROM sc_historical_actuals
WHERE service_name = 'Fun $$$$ Allocated'
GROUP BY source_file, source_tab
ORDER BY source_file, source_tab;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

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

-- Sequences reset to 1.
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
-- Expected loader output:
--   * Pre-write assertions all zero (dupes, numeric-name, summary-tell)
--   * Outlier check: median ~$1M, no HIGH outliers, no LOW outliers
--   * sc_historical_actuals:     12,640 rows written
--   * sc_historical_projections: 12,296 rows written
--   * TBJ FL 2025 actuals total ~$1.43M (was $687.9M)
