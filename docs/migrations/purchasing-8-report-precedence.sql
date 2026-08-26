-- purchasing-8-report-precedence.sql
--
-- Precedence machinery.  Two views make the report fill the gap where
-- the API has no row, and never contribute where the API already does.
--
--   1. rippling_report_txns_latest
--      One row per parent_txn_id, newest content_hash.  Resolves the
--      "recoded charge inserts as a new content hash" case that would
--      otherwise double-count from the same source.  Ordering key:
--      last_seen_at DESC, id DESC (id is the tie-breaker within the
--      same ingest run).
--
--   2. rippling_report_only_pending_v1
--      report-only rows the API has never seen.  Filters:
--        - LEFT JOIN against the API's external_id prefix set
--          (SUBSTRING(external_id, 1, 24)); include only rows where
--          the API side is NULL
--        - currency = 'USD'          (R3 non-USD exclusion)
--        - amount != 0               (R5 zero-amount exclusion)
--        - account_key IS NOT NULL   (attribution resolves to a team)
--        - excluded = FALSE          (R1 excluded work locations)
--      Attribution goes via work_location_label -> raw_spend map ->
--      spend_work_location_site_map -> account_key.
--
-- Precedence rule (both halves, documented in code at
-- src/app/kpi/purchasing/lib/precedence.js):
--   BETWEEN sources: API wins.  A parent_txn_id present in the API
--     is authoritative; the report contributes zero for that id.
--   WITHIN report: newest content_hash wins (via _latest above).
--
-- The two views close the "counted twice" failure mode structurally.
-- Neither the reader nor a probe can accidentally sum a row twice:
-- the view either contributes it once or not at all.
--
-- APPLY IN STUDIO before merging the PR that reads these views.
-- Verify queries at the file foot.

BEGIN;

-- ─── 1. rippling_report_txns_latest ─────────────────────────────
-- Newest content_hash per parent_txn_id.  DISTINCT ON is the shortest
-- way to express "one row per parent, newest by ordering key".

CREATE OR REPLACE VIEW rippling_report_txns_latest AS
SELECT DISTINCT ON (parent_txn_id) *
FROM   rippling_report_txns
ORDER  BY parent_txn_id, last_seen_at DESC, id DESC;

COMMENT ON VIEW rippling_report_txns_latest IS
  'One row per parent_txn_id, newest content_hash. A recoded charge (new content_hash inserted for the same parent_txn_id) is resolved here so no downstream reader can sum it twice from the same source.';

GRANT SELECT ON rippling_report_txns_latest TO service_role;

-- ─── 2. rippling_report_only_pending_v1 ────────────────────────
-- report-only rows the API has never seen, with attribution and
-- rulings gates already applied.  A row in this view is safe to add
-- to `pending`: the API has zero contribution for the same id.
--
-- The API external_id prefix is the join key.  Every raw_spend row
-- ever ingested carries external_id shaped '<24-hex>__line_item...',
-- so SUBSTRING(external_id, 1, 24) is total, not sparse.  Verified
-- 21578/21578 by scripts/probes/_probe_report_join_key.mjs on the
-- production snapshot 2026-08-26.

CREATE OR REPLACE VIEW rippling_report_only_pending_v1 AS
WITH api_prefixes AS (
  SELECT DISTINCT SUBSTRING(external_id, 1, 24) AS parent_txn_id
  FROM   rippling_raw_spend_lines
  WHERE  external_id ~ '^[0-9a-f]{24}__'
),
label_to_account AS (
  -- Every distinct work_location_label present on the API side maps
  -- to a work_location_id via raw_spend, then to an account_key via
  -- spend_work_location_site_map.  Labels not present on the API
  -- side won't resolve (a report-only work_location Rippling has
  -- never sent us via API).  Left unresolved on purpose: those rows
  -- drop out of the view rather than land on the wrong account.
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
LEFT   JOIN api_prefixes ap ON ap.parent_txn_id = rl.parent_txn_id
LEFT   JOIN label_to_account la ON la.work_location_label = rl.work_location
WHERE  ap.parent_txn_id IS NULL           -- API-side absent (report-only)
  AND  rl.currency = 'USD'                -- R3
  AND  COALESCE(rl.amount, 0) <> 0        -- R5
  AND  la.account_key IS NOT NULL         -- attribution resolved
  AND  COALESCE(la.excluded, FALSE) = FALSE;  -- R1 excluded work locations

COMMENT ON VIEW rippling_report_only_pending_v1 IS
  'Report-only card charges, attribution-resolved, rulings R1/R3/R5 applied. Sum(amount) grouped by account_key is the additional pending an operator sees on top of the API-derived pending.';

GRANT SELECT ON rippling_report_only_pending_v1 TO service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════
-- Verify queries (run in Studio SQL editor after APPLY).
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Views exist + grants (guards against structural-verify-on-empty):
--
-- SELECT table_name, table_type
-- FROM   information_schema.tables
-- WHERE  table_schema = 'public'
--   AND  table_name IN ('rippling_report_txns_latest', 'rippling_report_only_pending_v1')
-- ORDER  BY table_name;
--
-- Expected: two 'VIEW' rows.
--
-- SELECT grantee, privilege_type, table_name
-- FROM   information_schema.role_table_grants
-- WHERE  table_schema = 'public'
--   AND  table_name IN ('rippling_report_txns_latest', 'rippling_report_only_pending_v1')
--   AND  grantee     = 'service_role'
-- ORDER  BY table_name, privilege_type;
--
-- Expected: two SELECT grants to service_role.
--
-- 2. _latest cardinality (equals DISTINCT parent_txn_id in report_txns):
--
-- SELECT (SELECT COUNT(*) FROM rippling_report_txns_latest)                     AS latest_count,
--        (SELECT COUNT(DISTINCT parent_txn_id) FROM rippling_report_txns)      AS distinct_parents;
--
-- Expected: latest_count == distinct_parents.
--
-- 3. report_only_pending row count (should reproduce the 314
--    measured on 2026-08-26 within a small ingest-freshness delta):
--
-- SELECT COUNT(*) AS report_only_pending_rows,
--        ROUND(SUM(amount)::numeric, 2) AS report_only_pending_total_usd
-- FROM   rippling_report_only_pending_v1;
--
-- Expected on 2026-08-26 snapshot: ~314 rows, ~$32,248 total resolvable
-- across accounts (Remote / Corporate drop off - no team_key).
--
-- 4. No double-count invariant (Kevin's Check 4):
--
-- SELECT COUNT(*) AS overlap_count
-- FROM   rippling_report_only_pending_v1 v
-- WHERE  EXISTS (
--   SELECT 1
--   FROM   rippling_raw_spend_lines rsl
--   WHERE  SUBSTRING(rsl.external_id, 1, 24) = v.parent_txn_id
-- );
--
-- Expected: 0.  Any non-zero here means the API-absent gate leaked and
-- an operator would see the same transaction from both sources.
