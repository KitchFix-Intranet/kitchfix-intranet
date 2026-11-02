-- ═══════════════════════════════════════════════════════════════════
-- One-time prune: collapse superseded versions in rippling_raw_users.
-- ═══════════════════════════════════════════════════════════════════
--
-- Written 2026-11-02 for Chat-Claude review. NOT a schema migration;
-- NOT auto-applied. Kevin runs this in Supabase Studio by hand,
-- after the users-hash fix (branch fix/rippling-users-hash-exclude-
-- photos) lands and at least one nightly run has completed.
--
-- ─── Why this prune is safe ────────────────────────────────────────
--
-- rippling_raw_users accumulated 84,082 rows against 901 distinct
-- rippling_id (~93 versions / user) between 2026-08-11 and 2026-11-02.
-- The underlying defect: HASH_EXCLUDE_TOP.users did not strip the
-- top-level `photos` array, whose per-entry `.value` field is a
-- CloudFront signed URL (`Expires`, `Signature`, `Key-Pair-Id`
-- querystring) that rotates on every fetch while the object path
-- stays byte-identical. The result: 825 unchanged users rewrote
-- nightly, the base table grew 93x, and the DISTINCT ON view
-- rippling_raw_users_latest finally crossed the server-side
-- statement_timeout on 2026-11-01.
--
-- Every reader goes through rippling_raw_users_latest; grep confirms
-- no caller consumes historical user versions (checked src/, scripts/
-- on 2026-11-02). The _latest view's ordering is `rippling_id,
-- fetched_at DESC, id DESC` (per docs/migrations/kpi-c5-users-raw.sql
-- line 103). Keeping the single newest row per rippling_id is
-- byte-identical to what every reader sees today.
--
-- Expected result: 84,082 -> 901 rows. ~83,181 rows dropped.
--
-- ─── Pre-flight ─────────────────────────────────────────────────────

-- Verify measured counts match the current state before pruning.
SELECT
  COUNT(*)                       AS total_rows,
  COUNT(DISTINCT rippling_id)    AS unique_ids,
  ROUND(1.0 * COUNT(*) / NULLIF(COUNT(DISTINCT rippling_id), 0), 2)
                                 AS avg_versions_per_id
FROM rippling_raw_users;
-- Expected (2026-11-02): total ~84082  unique ~901  avg ~93.3


-- ─── The prune ──────────────────────────────────────────────────────
--
-- Done inside a transaction so an unexpected row-count can be
-- inspected and ROLLBACK'd. Match the _latest view's ordering so
-- "the row the readers see" is the row kept.

BEGIN;

WITH to_keep AS (
  SELECT DISTINCT ON (rippling_id) id
  FROM rippling_raw_users
  ORDER BY rippling_id, fetched_at DESC, id DESC
)
DELETE FROM rippling_raw_users
 WHERE id NOT IN (SELECT id FROM to_keep)
RETURNING id;
-- Expect: ~83,181 rows returned (the superseded versions).


-- ─── Post-check ─────────────────────────────────────────────────────
--
-- Both counts should now be byte-equal: one row per rippling_id.

SELECT
  COUNT(*)                       AS total_rows,
  COUNT(DISTINCT rippling_id)    AS unique_ids
FROM rippling_raw_users;
-- Expected post-prune: total == unique == ~901

-- Spot-check that _latest view returns the same ids as the base
-- table (nothing was accidentally dropped).

SELECT
  (SELECT COUNT(*) FROM rippling_raw_users_latest) AS latest_view_rows,
  (SELECT COUNT(*) FROM rippling_raw_users)        AS base_table_rows;
-- Expected: latest_view_rows == base_table_rows == ~901

COMMIT;
-- OR, if any of the above expectations fails:
-- ROLLBACK;
