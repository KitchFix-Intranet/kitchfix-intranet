-- ═══════════════════════════════════════════════════════════════════
-- One-time prune: collapse superseded versions in
-- rippling_raw_time_entries.
-- ═══════════════════════════════════════════════════════════════════
--
-- Written 2026-11-02 for Chat-Claude review. NOT a schema migration;
-- NOT auto-applied. Kevin runs this in Supabase Studio by hand,
-- after the ISO-canonical datetime fix (branch
-- fix/rippling-hash-canonical-datetime) lands AND at least one
-- nightly run has completed. The nightly run writes one new version
-- per record under the new rule, which becomes the surviving row
-- after the prune.
--
-- ─── Why this prune is safe ────────────────────────────────────────
--
-- rippling_raw_time_entries at 146,132 rows against 11,803 distinct
-- rippling_id (~12.4 versions / id). Measured 2026-11-02: ~97% of
-- adjacent-version pairs carry the same instant with a different
-- offset representation (noise), ~1.6% carry a non-end_time change,
-- genuine end_time edits are rare. See the fix PR for the measured
-- numbers and the proof that the hash-canonicalization preserves
-- 100% of non-noise pairs.
--
-- Every reader goes through rippling_raw_time_entries_latest; grep
-- confirmed on 2026-11-02:
--   - scripts/derive_labor_actuals_from_time_entries.mjs:178 (latest)
--   - scripts/derive_labor_actuals_daily.mjs:125               (latest)
--   - src/lib/labor/deriveActuals.js:300                        (latest)
--   - src/lib/labor/timeEntriesDerive.js:189                    (latest)
-- No caller consumes historical time-entry versions.
--
-- The _latest view's ordering is `rippling_id, fetched_at DESC, id
-- DESC` (docs/migrations/kpi-8a-rippling-raw.sql:207); keeping the
-- row that matches that order is byte-identical to what readers see.
--
-- Expected result: 146,132 -> 11,803 rows. ~134,329 rows dropped.
--
-- ─── Pre-flight ─────────────────────────────────────────────────────

-- Verify measured counts match the current state before pruning.
SELECT
  COUNT(*)                       AS total_rows,
  COUNT(DISTINCT rippling_id)    AS unique_ids,
  ROUND(1.0 * COUNT(*) / NULLIF(COUNT(DISTINCT rippling_id), 0), 2)
                                 AS avg_versions_per_id
FROM rippling_raw_time_entries;
-- Expected (2026-11-02): total ~146132  unique ~11803  avg ~12.4


-- ─── The prune ──────────────────────────────────────────────────────
--
-- Done inside a transaction so an unexpected row-count can be
-- inspected and ROLLBACK'd. Match the _latest view's ordering so the
-- row the readers see is the row kept.

BEGIN;

WITH to_keep AS (
  SELECT DISTINCT ON (rippling_id) id
  FROM rippling_raw_time_entries
  ORDER BY rippling_id, fetched_at DESC, id DESC
)
DELETE FROM rippling_raw_time_entries
 WHERE id NOT IN (SELECT id FROM to_keep);
-- Expect DELETE to report ~134,329 rows (the superseded versions).
-- RETURNING id was previously here; dropped because shipping 134k
-- ids back through the Studio UI buys nothing a DELETE row count
-- does not already report.


-- ─── Post-check ─────────────────────────────────────────────────────

SELECT
  COUNT(*)                       AS total_rows,
  COUNT(DISTINCT rippling_id)    AS unique_ids
FROM rippling_raw_time_entries;
-- Expected post-prune: total == unique == ~11803

SELECT
  (SELECT COUNT(*) FROM rippling_raw_time_entries_latest) AS latest_view_rows,
  (SELECT COUNT(*) FROM rippling_raw_time_entries)        AS base_table_rows;
-- Expected: latest_view_rows == base_table_rows == ~11803

COMMIT;
-- OR, if any expectation above fails:
-- ROLLBACK;


-- ─── VACUUM (must run after COMMIT, not inside the transaction) ─────
--
-- Deleting the rows leaves dead tuples that the composite index on
-- (rippling_id, fetched_at DESC, id DESC) still walks past when
-- rippling_raw_time_entries_latest's DISTINCT ON scans. Without
-- VACUUM the table reads as small while performing exactly as
-- badly as before - the whole point of this prune (making the
-- _latest view fit under the 8s statement_timeout, which is
-- currently blocking derive_labor_actuals_daily) is lost. ANALYZE
-- refreshes the planner stats so queries pick the right plan for
-- the collapsed row count.
--
-- VACUUM cannot run inside a transaction, so this MUST be a
-- separate statement after the COMMIT above.

VACUUM (ANALYZE) rippling_raw_time_entries;
