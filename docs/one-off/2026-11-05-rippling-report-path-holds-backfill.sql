-- ═══════════════════════════════════════════════════════════════════
-- One-time backfill: mark report-path Card Authorization holds
-- excluded in purchasing_actuals.
-- ═══════════════════════════════════════════════════════════════════
--
-- Written 2026-11-05 for Chat-Claude review. NOT a schema migration;
-- NOT auto-applied. Kevin runs this in Supabase Studio by hand after
-- the mapper fix (branch fix/report-path-exclude-card-holds) lands.
--
-- ─── What this corrects ───────────────────────────────────────────
--
-- Kevin ruling 2026-09-24: a Card Authorization is a swipe hold, not
-- a charge; it NEVER counts, whether it pairs or not. The old API-
-- walk derive excluded holds; the R-148D sweep caught stragglers.
-- Both are retired as of 2026-11-05 (PR #1341). The report path
-- that replaced them (purchasing-report-ingest) had no Object Type
-- logic until this PR, so a small number of holds have landed in
-- purchasing_actuals as counting rows.
--
-- Measured 2026-11-05 post-floor:
--   9 report-path holds, 2026-10-06 .. 2026-11-04. Dollar total
--   kept out of the repo per house style; it is in Chat-Claude's
--   measurement notes and the pre-flight SELECT below prints it.
--
-- These need a one-time correction. Going forward the mapper fix
-- prevents new holds from landing as excluded=false.
--
-- ─── Scope rules (hard constraints) ───────────────────────────────
--
-- ONLY target counting report-path holds:
--   source='rippling_spend'
--   excluded=false                           (not already excluded)
--   txn_date >= '2026-10-05'                  (above CARD_REPORT_SOURCE_FLOOR;
--                                              never touch pre-floor API-walk rows)
--   source_line_id NOT LIKE 'rippling_spend:%' (report-shape only -
--                                              the API-walk rows use
--                                              that prefix and are
--                                              closed Finance periods)
--   parent_txn whose rippling_report_txns.raw->>'Object Type' = 'Card Authorization'
--
-- Honor the purchasing_actuals excluded shape rule:
--   excluded=true  ->  account_key must be NULL
--
-- Do NOT delete rows. excluded=true is the mechanism; a deleted
-- hold loses the audit trail (the row proves the hold existed and
-- why it was dropped). Same approach the work-location and GL
-- exclusions already use.

-- ─── Pre-flight (MUST return 9; stop if it does not) ──────────────

SELECT COUNT(*) AS counting_report_path_holds
FROM purchasing_actuals pa
WHERE pa.source = 'rippling_spend'
  AND pa.excluded = false
  AND pa.txn_date >= DATE '2026-10-05'
  AND pa.source_line_id NOT LIKE 'rippling_spend:%'
  AND EXISTS (
    SELECT 1
    FROM rippling_report_txns_latest rt
    WHERE rt.parent_txn_id = pa.source_bill_id
      AND (rt.raw->>'Object Type') = 'Card Authorization'
  );
-- Expected (2026-11-05): 9
-- If NOT 9: the set moved since the measurement; stop and re-check
-- rather than apply blind. The mapper fix in the companion PR
-- blocks new holds going forward; a one-day slip is fine.


-- ─── The backfill ─────────────────────────────────────────────────

BEGIN;

UPDATE purchasing_actuals pa
   SET excluded    = true,
       account_key = NULL
 WHERE pa.source     = 'rippling_spend'
   AND pa.excluded   = false
   AND pa.txn_date   >= DATE '2026-10-05'
   AND pa.source_line_id NOT LIKE 'rippling_spend:%'
   AND EXISTS (
     SELECT 1
     FROM rippling_report_txns_latest rt
     WHERE rt.parent_txn_id = pa.source_bill_id
       AND (rt.raw->>'Object Type') = 'Card Authorization'
   );
-- Expect UPDATE to report 9 rows.

-- ─── Post-check: zero counting holds remain ───────────────────────

SELECT COUNT(*) AS counting_report_path_holds_after
FROM purchasing_actuals pa
WHERE pa.source = 'rippling_spend'
  AND pa.excluded = false
  AND pa.txn_date >= DATE '2026-10-05'
  AND pa.source_line_id NOT LIKE 'rippling_spend:%'
  AND EXISTS (
    SELECT 1
    FROM rippling_report_txns_latest rt
    WHERE rt.parent_txn_id = pa.source_bill_id
      AND (rt.raw->>'Object Type') = 'Card Authorization'
  );
-- Expected: 0

-- Sanity: every updated row satisfies the excluded_shape invariant
-- (excluded=true AND account_key IS NULL). Should return 9; if less,
-- some row was updated to excluded=true without nulling account_key
-- and must be fixed before COMMIT.
SELECT COUNT(*) AS updated_rows_with_shape_ok
FROM purchasing_actuals pa
WHERE pa.source     = 'rippling_spend'
  AND pa.excluded   = true
  AND pa.account_key IS NULL
  AND pa.txn_date   >= DATE '2026-10-05'
  AND pa.source_line_id NOT LIKE 'rippling_spend:%'
  AND EXISTS (
    SELECT 1
    FROM rippling_report_txns_latest rt
    WHERE rt.parent_txn_id = pa.source_bill_id
      AND (rt.raw->>'Object Type') = 'Card Authorization'
  );
-- Expected: 9

COMMIT;
-- OR, if any expectation above fails:
-- ROLLBACK;
