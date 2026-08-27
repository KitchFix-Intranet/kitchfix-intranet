-- purchasing-9-external-id-prefix-index.sql
--
-- Hotfix.  purchasing-8-report-precedence.sql shipped
-- rippling_report_only_pending_v1, whose WHERE clause anti-joins
-- against `SUBSTRING(rippling_raw_spend_lines.external_id, 1, 24)`.
-- Postgres has no index on that expression, so the planner falls
-- back to a Seq Scan on rippling_raw_spend_lines (21,578 rows) inside
-- a Nested Loop Anti Join that removes 28,275,000 combinations to
-- answer a single-account query.
--
-- Measured 2026-08-26:
--   - EXPLAIN ANALYZE of a TBJ - FL FYTD query on the view:
--       Execution Time: 12,507 ms
--   - Live blast radius via curl (14 accounts x 3 ranges, TEST_MODE=1):
--       ALL FYTD:        500 in 10,086ms  (over Supabase timeout)
--       Every FYTD load: 5,552-6,669ms    (portfolio view breaks;
--                                          everything else is slow)
--       Every P8/P9:     1,061-3,032ms
--
-- The expression index below closes the anti-join in one hash lookup.
-- Partial predicate `external_id ~ '^[0-9a-f]{24}__'` matches the
-- view's own WHERE clause so the planner will use it for that exact
-- query shape.
--
-- Owner ruling 2026-08-26: separate one-liner PR ahead of R14.  R14
-- cannot verify screenshots against a broken portfolio view.
--
-- APPLY IN STUDIO before merging.  Verify queries at the file foot.

BEGIN;

CREATE INDEX IF NOT EXISTS rippling_raw_spend_lines_external_id_prefix_idx
  ON rippling_raw_spend_lines (SUBSTRING(external_id, 1, 24))
  WHERE external_id ~ '^[0-9a-f]{24}__';

COMMENT ON INDEX rippling_raw_spend_lines_external_id_prefix_idx IS
  'Supports the anti-join in rippling_report_only_pending_v1 (from
   purchasing-8-report-precedence.sql).  Partial predicate matches
   the view''s own WHERE so the planner uses this index for that
   query shape.  Without it, the view scans 21,578 rows and does a
   28M-row nested-loop anti-join, exceeding Supabase''s statement
   timeout on ALL FYTD.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════
-- Verify queries (run in Studio SQL editor after APPLY).
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Index exists on the substring expression with the partial predicate:
--
-- SELECT indexname, indexdef
-- FROM   pg_indexes
-- WHERE  schemaname = 'public'
--   AND  tablename  = 'rippling_raw_spend_lines'
--   AND  indexname  = 'rippling_raw_spend_lines_external_id_prefix_idx';
--
-- Expected: one row.  indexdef contains SUBSTRING + the partial WHERE.
--
-- 2. The view uses the index (drop from >10s to <200ms):
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT *
-- FROM   rippling_report_only_pending_v1
-- WHERE  account_key = 'TBJ - FL'
--   AND  purchased_at BETWEEN '2025-12-29' AND '2026-08-26';
--
-- Expected: Execution Time under 200 ms.  Plan should show a Hash /
-- Index Scan against the new index instead of the Nested Loop Anti
-- Join over a Seq Scan.
--
-- 3. Row counts unchanged (index is a read optimisation, no filter
--    change):
--
-- SELECT COUNT(*) AS report_only_rows,
--        ROUND(SUM(amount)::numeric, 2) AS total_usd
-- FROM   rippling_report_only_pending_v1;
--
-- Expected: same 172 rows / $32,248.49 as the purchasing-8 verify
-- reported on 2026-08-26 (allow small drift for new nightly ingests).
