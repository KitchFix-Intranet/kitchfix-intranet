-- purchasing-11-report-only-pending-fn.sql
--
-- Pushes the purchased_at + currency predicates past the DISTINCT ON
-- dedupe in rippling_report_only_pending_v1. The existing view takes
-- no arguments, so the planner cannot push caller filters inside the
-- inner view's dedupe (it would change what the dedupe sees). The
-- fix is a set-returning function that takes the range as parameters;
-- the DISTINCT ON then runs over the in-window set only, and the
-- existing rippling_report_txns_purchased_at_idx can drive the scan.
--
-- The existing view (rippling_report_only_pending_v1) is left in
-- place UNCHANGED. Rollback is instant: switch the caller back to
-- the view. The function is additive; nothing depends on the view
-- being removed.
--
-- MEASURED (production, 2026-10-16, read-only):
--   current view, 1 row returned:         2,515 ms
--   restructured same shape as fn body:     113 ms (per brief's EXPLAIN)
--
-- The 2,141 ms of inner-view DISTINCT ON becomes 113 ms once the
-- planner has a date range to apply before sorting. label_to_account
-- (another 282 ms) is unchanged; replacing that CTE with a small
-- materialized table is a separate change.
--
-- APPLY IN STUDIO before this PR merges. Verify queries at the file
-- foot - row count and total MUST match the existing view exactly
-- on both the test range and FY2026 to date.

BEGIN;

-- ─── rippling_report_only_pending_v1_fn ──────────────────────────
-- Set-returning function. Returns the same column set the view does
-- (minus approval_state, which the current caller does not read -
-- can be re-added if needed later).
--
-- Why STABLE and not IMMUTABLE: the function reads tables that
-- change (rippling_report_txns ingests, rippling_raw_spend_lines
-- ingests). STABLE is the correct volatility class.
--
-- Why SECURITY DEFINER + search_path=public: same posture as the
-- existing swap_labor_actuals_for_account function family; keeps the
-- service_role caller from needing SELECT grants on every underlying
-- table.
--
-- Attribution-side correctness verified against all 7,041 distinct
-- parent transactions in rippling_report_txns 2026-10-16:
--   purchased_at:   0 cases differ across versions of same parent
--   currency:       0 cases differ across versions of same parent
--   amount:         92 cases differ; 48 have both zero + non-zero
--                   versions. amount filter MUST STAY post-dedupe.
--
-- Row-level parity verified end-to-end 2026-10-16:
--   2026-09-07..2026-10-04:  2/2 rows match, 0 diffs
--   FY2026 to date:          129/129 rows match, 0 diffs

CREATE OR REPLACE FUNCTION rippling_report_only_pending_v1_fn(
  p_start           DATE,
  p_end             DATE,
  p_account_keys    TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  parent_txn_id    TEXT,
  purchased_at     DATE,
  amount           NUMERIC,
  currency         TEXT,
  work_location    TEXT,
  account_key      TEXT,
  category         TEXT,
  approval_state   TEXT,
  gl_sync_status   TEXT,
  is_manually_paid BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH label_to_account AS MATERIALIZED (
    SELECT DISTINCT ON (rsl.work_location_label)
           rsl.work_location_label,
           sm.account_key,
           sm.excluded
    FROM   rippling_raw_spend_lines rsl
    JOIN   spend_work_location_site_map sm
      ON   sm.work_location_id = rsl.work_location_id
    WHERE  rsl.work_location_label IS NOT NULL
    ORDER  BY rsl.work_location_label, rsl.first_seen_at ASC
  ),
  deduped_in_window AS (
    -- purchased_at + currency pushed past the dedupe. Index-usable
    -- via rippling_report_txns_purchased_at_idx. amount STAYS below.
    SELECT DISTINCT ON (parent_txn_id)
           parent_txn_id,
           purchased_at,
           amount,
           currency,
           work_location,
           category,
           approval_state,
           gl_sync_status,
           is_manually_paid
    FROM   rippling_report_txns
    WHERE  purchased_at >= p_start
      AND  purchased_at <= p_end
      AND  currency = 'USD'
    ORDER  BY parent_txn_id, last_seen_at DESC, id DESC
  )
  SELECT
    rl.parent_txn_id,
    rl.purchased_at,
    rl.amount,
    rl.currency,
    rl.work_location,
    la.account_key,
    rl.category,
    rl.approval_state,
    rl.gl_sync_status,
    rl.is_manually_paid
  FROM   deduped_in_window rl
  LEFT   JOIN label_to_account la
    ON   la.work_location_label = rl.work_location
  WHERE  NOT EXISTS (
           SELECT 1
           FROM   rippling_raw_spend_lines rsl
           WHERE  SUBSTRING(rsl.external_id, 1, 24) = rl.parent_txn_id
             AND  rsl.external_id ~ '^[0-9a-f]{24}__'
         )
    AND  COALESCE(rl.amount, 0) <> 0
    AND  la.account_key IS NOT NULL
    AND  COALESCE(la.excluded, FALSE) = FALSE
    AND  (p_account_keys IS NULL OR la.account_key = ANY(p_account_keys));
$$;

COMMENT ON FUNCTION rippling_report_only_pending_v1_fn(DATE, DATE, TEXT[]) IS
  'Date-parameterized form of rippling_report_only_pending_v1. Pushes purchased_at + currency past the DISTINCT ON dedupe so the planner can use rippling_report_txns_purchased_at_idx. Row set and amounts byte-identical to the view on all tested ranges; amount != 0 filter stays post-dedupe to preserve the newest-version-wins behavior on parents with mixed zero/non-zero versions.';

GRANT EXECUTE ON FUNCTION rippling_report_only_pending_v1_fn(DATE, DATE, TEXT[]) TO service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════
-- Verify queries (run in Studio SQL editor after APPLY).
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Row count + total UNCHANGED vs the current view, two ranges.
--
-- SELECT COUNT(*) AS fn_rows, ROUND(SUM(amount)::numeric, 2) AS fn_total
-- FROM rippling_report_only_pending_v1_fn('2026-09-07', '2026-10-04');
--
-- SELECT COUNT(*) AS view_rows, ROUND(SUM(amount)::numeric, 2) AS view_total
-- FROM rippling_report_only_pending_v1
-- WHERE purchased_at >= '2026-09-07' AND purchased_at <= '2026-10-04';
--
-- Expected: identical row counts and totals.
--
-- Repeat for FY2026 range:
--
-- SELECT COUNT(*), ROUND(SUM(amount)::numeric, 2)
-- FROM rippling_report_only_pending_v1_fn('2025-12-29', CURRENT_DATE);
--
-- SELECT COUNT(*), ROUND(SUM(amount)::numeric, 2)
-- FROM rippling_report_only_pending_v1
-- WHERE purchased_at >= '2025-12-29' AND purchased_at <= CURRENT_DATE;
--
-- 2. EXPLAIN ANALYZE confirms Index Scan on
--    rippling_report_txns_purchased_at_idx.
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM rippling_report_only_pending_v1_fn(
--   '2026-09-07', '2026-10-04', ARRAY['TBJ - FL']::TEXT[]);
--
-- Expected plan features:
--   -> Index Scan using rippling_report_txns_purchased_at_idx
--      Index Cond: (purchased_at >= '2026-09-07' AND purchased_at <= '2026-10-04')
--   Rows Removed by Filter: near zero
--   Execution Time: under 200 ms
--
-- If the plan shows a Seq Scan on rippling_report_txns or a large
-- "Rows Removed by Filter" count, the pushdown did not take effect
-- - stop and investigate rather than merging.
--
-- 3. Dollar parity probe (run before migration apply to establish
--    baseline, re-run after to confirm no drift):
--
--    scripts/probes/_probe_report_fn_parity.mjs - already verifies
--    the restructured query shape against the current view on both
--    ranges. Expected: BYTE-IDENTICAL on both.
