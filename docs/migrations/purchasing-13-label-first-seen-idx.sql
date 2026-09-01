-- purchasing-13-label-first-seen-idx.sql
--
-- F-11 hotfix (2026-09-01). EXPLAIN ANALYZE on
-- rippling_report_only_pending_v1 identified the label_to_account CTE
-- as 82% of the view's 6,031ms warm cost. The CTE:
--
--   SELECT DISTINCT ON (rsl.work_location_label)
--          rsl.work_location_label, sm.account_key, sm.excluded
--   FROM   rippling_raw_spend_lines rsl
--   JOIN   spend_work_location_site_map sm
--     ON   sm.work_location_id = rsl.work_location_id
--   WHERE  rsl.work_location_label IS NOT NULL
--   ORDER  BY rsl.work_location_label, rsl.first_seen_at ASC
--
-- walked all 32,981 raw rows via Seq Scan, sorted them on disk
-- (1584kB external merge), and produced 14 unique labels. No index
-- existed on work_location_label; the planner had no alternative to
-- Seq Scan + Sort.
--
-- This migration adds a partial covering index that matches the CTE's
-- ORDER BY exactly. Included columns cover work_location_id so the
-- outer hash-join to spend_work_location_site_map (25 rows) can use
-- an index-only scan against the CTE input.
--
-- Partial predicate matches the CTE's WHERE clause so the planner
-- can use it for that exact query shape.
--
-- Postgres has no true index skip-scan for DISTINCT ON, so this may
-- not drop the row-visit count from 32,981; what it eliminates is the
-- external merge SORT + the wide-row Seq Scan cost. Even at full
-- 32,981-row visits, an ordered index scan against a narrow index
-- avoids the disk sort and skips reading the wide base table rows.
-- Verify #2 below is the actual measurement.
--
-- Row semantics UNCHANGED across the fix. The index is a plan
-- optimisation; no filter, no view, no data movement. The view's
-- output is byte-identical.
--
-- Follow-up finding (Kevin's ruling 2026-09-01, deferred to a later
-- PR): the 25-row spend_work_location_site_map does NOT carry the
-- work_location_label it maps to. Every request re-derives 14 stable
-- rows from the raw feed to build that mapping. This migration makes
-- the re-derive cheap; adding the label to the map table would make
-- the re-derive unnecessary. That is (b) in the F-11 ruling and is
-- NOT built here.
--
-- Note on the CTE's data-source choice: it walks
-- rippling_raw_spend_lines (32,981 rows, full history) rather than
-- rippling_raw_spend_lines_latest (11,803 rows), and orders by
-- first_seen_at ASC to pick the EARLIEST label per work_location_id.
-- This is deliberate for stability - a label that changes over time
-- should not flip the CTE's output as new content_hashes land.
-- Documented here so the next reader sees this as a design choice,
-- not an oversight.
--
-- APPLY IN STUDIO before merging. Verify queries at the file foot.

BEGIN;

CREATE INDEX IF NOT EXISTS rippling_raw_spend_lines_label_first_seen_idx
  ON rippling_raw_spend_lines (work_location_label, first_seen_at, work_location_id)
  WHERE work_location_label IS NOT NULL;

COMMENT ON INDEX rippling_raw_spend_lines_label_first_seen_idx IS
  'F-11 hotfix (2026-09-01). Supports the label_to_account CTE in
   rippling_report_only_pending_v1 (purchasing-10). The CTE
   ORDER BY (work_location_label, first_seen_at ASC) with
   DISTINCT ON (work_location_label). Partial predicate matches the
   CTE''s own WHERE work_location_label IS NOT NULL so the planner
   uses this index for that query shape. Covers work_location_id so
   the hash-join to spend_work_location_site_map can proceed
   index-only. Without this, EXPLAIN showed 4,820ms Seq Scan +
   external merge SORT (1584kB temp).';

COMMIT;

-- ═════════════════════════════════════════════════════════════════
-- Verify queries (run in Studio SQL editor after APPLY).
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Index exists with the exact expression and partial predicate:
--
-- SELECT indexname, indexdef
-- FROM   pg_indexes
-- WHERE  schemaname = 'public'
--   AND  tablename  = 'rippling_raw_spend_lines'
--   AND  indexname  = 'rippling_raw_spend_lines_label_first_seen_idx';
--
-- Expected: one row. indexdef contains work_location_label,
-- first_seen_at, work_location_id and the partial WHERE clause.
--
-- 2. EXPLAIN ANALYZE the CTE in isolation - the 4.9s -> sub-second
--    drop is the whole point. Plan should show an ordered Index Scan
--    (or Index Only Scan) on the new index, NOT the Seq Scan + Sort
--    combination that produced the external merge on disk.
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT DISTINCT ON (rsl.work_location_label)
--        rsl.work_location_label,
--        sm.account_key,
--        sm.excluded
-- FROM   rippling_raw_spend_lines rsl
-- JOIN   spend_work_location_site_map sm
--   ON   sm.work_location_id = rsl.work_location_id
-- WHERE  rsl.work_location_label IS NOT NULL
-- ORDER  BY rsl.work_location_label, rsl.first_seen_at ASC;
--
-- Expected: no "Sort Method: external merge Disk: ..." line. Plan
-- root should be Unique over an Index Scan / Index Only Scan on
-- rippling_raw_spend_lines_label_first_seen_idx. Execution Time
-- under 200ms.
--
-- 3. EXPLAIN ANALYZE the full view - the 6,031ms -> ~1,100ms drop
--    is the operator-visible payoff (CTE cost mostly vanishes; the
--    subquery scan + nested loop + anti-join sum to ~1s and stay).
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM rippling_report_only_pending_v1;
--
-- Expected: total Execution Time drops from ~6,000ms to ~1,100ms
-- (all values approximate; caches vary). Row semantics identical
-- (0 rows today given the current post-Ruling-6-fix corpus).
--
-- 4. Row-count invariant - the index does not change output:
--
-- SELECT COUNT(*) AS report_only_rows,
--        ROUND(SUM(amount)::numeric, 2) AS total_usd
-- FROM   rippling_report_only_pending_v1;
--
-- Expected: same COUNT + SUM as before apply.
