-- purchasing-10-report-only-view-rewrite.sql
--
-- Second half of the hotfix.  purchasing-9 added the expression
-- index; the planner rejected it because the view materialised the
-- api-prefix set via a CTE + HashAggregate + Anti Join, not a per-row
-- NOT EXISTS.  Post-index EXPLAIN ANALYZE still ran 11,140 ms - same
-- plan as before the index.
--
-- Rewrite: replace the api_prefixes CTE + LEFT JOIN + NULL check with
-- a WHERE NOT EXISTS correlated subquery.  Per-row lookup carries the
-- SAME partial predicate as the index (external_id ~ '^[0-9a-f]{24}__'),
-- so the planner lifts it to an Index Scan against
-- rippling_raw_spend_lines_external_id_prefix_idx.
--
-- MATERIALIZED on label_to_account (second amendment 2026-08-27):
-- the first NOT EXISTS rewrite made the index work (224 index probes,
-- ~160ms total) but reordered the plan so label_to_account joined
-- against 4,954 report rows before the anti-join filter fired.
-- Postgres re-computed the 14-row DISTINCT ON per outer row - 4,954
-- iterations x ~4ms each = ~20 seconds.  MATERIALIZED forces the CTE
-- to compute once, upstream of the loop, so the outer join hash-joins
-- against 14 rows instead of re-sorting 20,798 raw_spend rows per
-- iteration.
--
-- Row semantics unchanged across BOTH rewrites.  Filters
-- (currency='USD', amount != 0, account_key attribution,
-- excluded=false) identical.  Post-apply verify #1 confirms the same
-- 172 rows / $32,248.49 total after MATERIALIZED - a plan change can
-- surface a subtle DISTINCT ON tiebreak difference that a syntax-
-- only reader would miss.
--
-- APPLY IN STUDIO before merging.  Verify queries at the file foot.

BEGIN;

CREATE OR REPLACE VIEW rippling_report_only_pending_v1 AS
WITH label_to_account AS MATERIALIZED (
  -- Row semantics unchanged from purchasing-8.  Every distinct
  -- work_location_label present on the API side maps to a
  -- work_location_id via raw_spend, then to an account_key via
  -- spend_work_location_site_map.  Labels not present on the API
  -- side won't resolve (a report-only work_location Rippling has
  -- never sent us via API).  Left unresolved on purpose: those rows
  -- drop out of the view rather than land on the wrong account.
  --
  -- MATERIALIZED forces one-shot computation.  Without it Postgres
  -- inlined the CTE and re-computed 4,954 times per query - the
  -- ~20s regression the NOT EXISTS rewrite alone introduced.
  SELECT DISTINCT ON (rsl.work_location_label)
         rsl.work_location_label,
         sm.account_key,
         sm.excluded
  FROM   rippling_raw_spend_lines rsl
  JOIN   spend_work_location_site_map sm
    ON   sm.work_location_id = rsl.work_location_id
  WHERE  rsl.work_location_label IS NOT NULL
  ORDER  BY rsl.work_location_label, rsl.first_seen_at ASC
)
SELECT
  rl.parent_txn_id,
  rl.purchased_at,
  rl.amount,
  rl.currency,
  rl.work_location,
  la.account_key,
  rl.approval_state,
  rl.category,
  rl.gl_sync_status,
  rl.is_manually_paid
FROM   rippling_report_txns_latest rl
LEFT   JOIN label_to_account la ON la.work_location_label = rl.work_location
WHERE  NOT EXISTS (
         SELECT 1
         FROM   rippling_raw_spend_lines rsl
         WHERE  SUBSTRING(rsl.external_id, 1, 24) = rl.parent_txn_id
           AND  rsl.external_id ~ '^[0-9a-f]{24}__'
       )
  AND  rl.currency = 'USD'
  AND  COALESCE(rl.amount, 0) <> 0
  AND  la.account_key IS NOT NULL
  AND  COALESCE(la.excluded, FALSE) = FALSE;

COMMENT ON VIEW rippling_report_only_pending_v1 IS
  'Report-only card charges, attribution-resolved, rulings R1/R3/R5 applied. Sum(amount) grouped by account_key is the additional pending an operator sees on top of the API-derived pending. Rewritten 2026-08-26 to use NOT EXISTS instead of CTE anti-join so the expression index on SUBSTRING(external_id, 1, 24) is used.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════
-- Verify queries (run in Studio SQL editor after APPLY).
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Row count + total UNCHANGED vs purchasing-8 verify (Kevin's rule:
--    a rewrite that returns different rows is worse than one that is
--    slow).  Expected on the 2026-08-26 snapshot: 172 rows,
--    $32,248.49.  Small drift is allowed for new nightly ingests.
--
-- SELECT COUNT(*) AS report_only_rows,
--        ROUND(SUM(amount)::numeric, 2) AS total_usd
-- FROM   rippling_report_only_pending_v1;
--
-- 2. EXPLAIN ANALYZE the same TBJ - FL FYTD query used in
--    purchasing-9 verify #2.  Expected drop from 11,140 ms to under
--    200 ms.  The plan should show an Anti Join with Index Scan on
--    rippling_raw_spend_lines_external_id_prefix_idx, NOT the
--    HashAggregate + Nested Loop Anti Join.
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT *
-- FROM   rippling_report_only_pending_v1
-- WHERE  account_key = 'TBJ - FL'
--   AND  purchased_at BETWEEN '2025-12-29' AND '2026-08-26';
--
-- 3. Double-count invariant (Kevin's Check 4 from purchasing-8, still
--    zero after the rewrite):
--
-- SELECT COUNT(*) AS overlap_count
-- FROM   rippling_report_only_pending_v1 v
-- WHERE  EXISTS (
--   SELECT 1
--   FROM   rippling_raw_spend_lines rsl
--   WHERE  SUBSTRING(rsl.external_id, 1, 24) = v.parent_txn_id
-- );
--
-- Expected: 0.
