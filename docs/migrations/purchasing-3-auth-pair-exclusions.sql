-- ═══════════════════════════════════════════════════════════════════════════
-- purchasing-3-auth-pair-exclusions.sql
--
-- Ruling 4 (2026-08-20): where two parents share the same merchant + amount
-- within 5 days, keep the later and exclude the earlier. Report acts as
-- arbiter for the 177 border cases (27 earlier-in-report + 150 both-in-report).
--
-- Ruling 5 (2026-08-20): exclude the 854 in-window zero-amount parents.
-- Nothing legitimate is a $0.00 purchase.
--
-- The evidence: mystery_transactions_2026-08-20.xlsx Sheet 2 across all
-- 4,158 pairs -> 3,834 later-in-report / 27 earlier / 150 both / 147 neither.
-- 142:1 signal that this is auth->settlement, not repeat purchase.
--
-- ─── SCHEMA CHANGES (this migration) ─────────────────────────────────────
--
-- 1. purchasing_actuals.reason - TEXT column. Populated for every excluded
--    row. Contract:
--      - 'auth_pair'   -> Ruling 4 (earlier of same-merchant same-amount
--                        pair within 5 days, arbitrated against the report)
--      - 'zero_amount' -> Ruling 5 (in-window parent with $0.00 amount)
--      - 'dup_split'   -> INV-P8c Ruling 2 (already excluded in-code; back-fill
--                        left to derive re-run - column is additive)
--      - 'non_usd'     -> INV-P8c Ruling 3 (same)
--      - 'label_fallback'|'map_excluded' -> owner-seeded work_location map
--                        (populated by derive; existing rows back-fill on
--                        first re-run since derive is DELETE+INSERT)
--    Nullable because non-excluded rows carry no reason. Constraint on
--    non-null-reason-implies-excluded encoded below.
--
-- 2. rippling_report_seen_txns - reference table populated by
--    scripts/purchasing_report_load.mjs from the current unfiltered
--    Rippling custom report CSV. Interim snapshot; when the scheduled
--    report-email lane (per KPI_PURCHASING_MASTER §6.6) lands, it becomes
--    the maintainer.
--
-- ─── DDL STATEMENTS - APPLY ONE AT A TIME IN STUDIO ──────────────────────
-- Each statement is independently valid. Kevin applies each, one at a time.
-- After all statements land, the verify block at the bottom is READ-ONLY.
--
-- REVOKE TRUNCATE is applied on the new table below (money-adjacent lookup).

-- Statement 1: add the reason column, nullable.
ALTER TABLE purchasing_actuals
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Statement 2: constraint - if reason is non-null then excluded must be TRUE.
-- The converse (excluded -> reason non-null) is NOT enforced at the DB layer
-- because historical rows excluded before this migration carry NULL. The
-- derive back-fills reason on its next DELETE+INSERT pass.
ALTER TABLE purchasing_actuals
  DROP CONSTRAINT IF EXISTS purchasing_actuals_reason_shape;

ALTER TABLE purchasing_actuals
  ADD CONSTRAINT purchasing_actuals_reason_shape
    CHECK (reason IS NULL OR excluded = TRUE);

-- Statement 3: reference table - parent transaction IDs seen in the current
-- unfiltered Rippling custom report. Seeded by scripts/purchasing_report_load.mjs.
CREATE TABLE IF NOT EXISTS rippling_report_seen_txns (
  parent_txn_id  TEXT PRIMARY KEY,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_note    TEXT
);

-- Statement 4: REVOKE TRUNCATE on the new table (money-adjacent lookup).
REVOKE TRUNCATE ON rippling_report_seen_txns FROM anon, authenticated;

-- Statement 5: index for pair-detection lookup and workbook joins.
CREATE INDEX IF NOT EXISTS purchasing_actuals_reason_idx
  ON purchasing_actuals (reason)
  WHERE reason IS NOT NULL;

-- ─── VERIFY BLOCK - READ-ONLY (no BEGIN/UPDATE/ROLLBACK) ─────────────────
-- Run these in Studio after the DDL lands. Every query is a SELECT.
--
-- V1. reason column exists on purchasing_actuals with type TEXT
--     SELECT column_name, data_type, is_nullable
--       FROM information_schema.columns
--      WHERE table_name = 'purchasing_actuals' AND column_name = 'reason';
--
-- V2. reason constraint present
--     SELECT conname, pg_get_constraintdef(oid)
--       FROM pg_constraint
--      WHERE conrelid = 'purchasing_actuals'::regclass
--        AND conname = 'purchasing_actuals_reason_shape';
--
-- V3. rippling_report_seen_txns table exists
--     SELECT table_name FROM information_schema.tables
--      WHERE table_name = 'rippling_report_seen_txns';
--
-- V4. TRUNCATE revoked from anon + authenticated on rippling_report_seen_txns
--     SELECT grantee, privilege_type FROM information_schema.table_privileges
--      WHERE table_name = 'rippling_report_seen_txns'
--        AND grantee IN ('anon', 'authenticated')
--        AND privilege_type = 'TRUNCATE';
--     (expect zero rows)
--
-- V5. reason-column index present
--     SELECT indexname FROM pg_indexes
--      WHERE tablename = 'purchasing_actuals'
--        AND indexname = 'purchasing_actuals_reason_idx';
--
-- ─── OWNER ATTESTATION ───────────────────────────────────────────────────
-- applied in Studio: YES
--   head SHA: <fill-in-when-applied>
