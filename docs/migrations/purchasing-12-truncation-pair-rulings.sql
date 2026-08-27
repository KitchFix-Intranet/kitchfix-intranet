-- ═══════════════════════════════════════════════════════════════════════════
-- purchasing-12-truncation-pair-rulings.sql
--
-- INV-P12 Kevin's ruling 2026-08-27: apply the truncation-pair rule to all
-- 45 pairs measured on 2026-08-27 ($35,626.81 double-counted).
--
-- Stored decision, not live rule.  The derive consults this table on each
-- pass and excludes the parents listed with reason='truncation_pair'.  A
-- fresh candidate pair discovered next month does NOT auto-exclude - it is
-- surfaced by scripts/purchasing_detect_truncation_pairs.mjs for a new
-- ruling.  Same discipline as the report-only precedence rule: we refuse
-- to guess which pairs are the same vendor.  The rule that measures is
-- report-only; the rule that excludes is a table of ruled ids.
--
-- ─── SCHEMA CHANGES (this migration) ─────────────────────────────────────
--
-- 1. purchasing_truncation_pair_rulings - each row is a parent to exclude
--    with a full audit trail (partner parent kept, both merchant strings,
--    amount, dates, ruled_by, ruled_at, batch, note).  parent_txn_id is
--    the primary key so a re-ruling is an UPDATE not a duplicate row.
--
-- 2. The derive picks up 'truncation_pair' as a new reason value.  The
--    existing constraint `reason IS NULL OR excluded = TRUE` still holds.
--    No column change to purchasing_actuals.
--
-- ─── DDL STATEMENTS - APPLY ONE AT A TIME IN STUDIO ──────────────────────

-- Statement 1: rulings table.
CREATE TABLE IF NOT EXISTS purchasing_truncation_pair_rulings (
  parent_txn_id          TEXT PRIMARY KEY,
  partner_parent_txn_id  TEXT NOT NULL,
  merchant_short         TEXT NOT NULL,
  merchant_long          TEXT NOT NULL,
  amount_cents           BIGINT NOT NULL,
  account_key            TEXT NOT NULL,
  days_apart             INT  NOT NULL,
  excluded_txn_date      DATE NOT NULL,
  kept_txn_date          DATE NOT NULL,
  ruled_by               TEXT NOT NULL,
  ruled_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ruling_batch           TEXT NOT NULL,
  note                   TEXT
);

-- Statement 2: index for the derive's lookup (parent_txn_id is PK; this
-- covers the reverse lookup + audit joins).
CREATE INDEX IF NOT EXISTS purchasing_truncation_pair_rulings_partner_idx
  ON purchasing_truncation_pair_rulings (partner_parent_txn_id);
CREATE INDEX IF NOT EXISTS purchasing_truncation_pair_rulings_batch_idx
  ON purchasing_truncation_pair_rulings (ruling_batch);

-- Statement 3: REVOKE TRUNCATE (money-adjacent lookup).
REVOKE TRUNCATE ON purchasing_truncation_pair_rulings FROM anon, authenticated;

-- Statement 4: service_role read + write (derive reads; seed script writes).
-- Same grant shape as rippling_report_seen_txns (purchasing-3 Statement 8).
GRANT SELECT, INSERT, UPDATE, DELETE ON purchasing_truncation_pair_rulings TO service_role;

-- ─── SEEDING ────────────────────────────────────────────────────────────
-- The 45 rulings are NOT inserted by this SQL.  A separate one-shot script
-- runs after the DDL lands:
--     node --env-file=.env.local scripts/purchasing_seed_truncation_pair_rulings.mjs
-- The seed script reads ~/Downloads/inv_p12_45_exclude_parents_YYYY-MM-DD.json
-- (produced by scripts/probes/_probe_inv_p12_before_after.mjs) and INSERTs
-- one row per ruled parent.  Idempotent - ON CONFLICT (parent_txn_id) DO
-- NOTHING so a re-run does not double-write.  Merchant names live in the
-- DB not the migration text so the repo does not carry the merchant list.
--
-- ─── VERIFY BLOCK - READ-ONLY ────────────────────────────────────────────
-- Run after DDL lands + seed script runs.
--
-- V1. table exists
--     SELECT table_name FROM information_schema.tables
--      WHERE table_name = 'purchasing_truncation_pair_rulings';
--
-- V2. service_role grant present
--     SELECT grantee, privilege_type FROM information_schema.role_table_grants
--      WHERE table_name = 'purchasing_truncation_pair_rulings'
--        AND grantee = 'service_role'
--      ORDER BY privilege_type;
--
-- V3. TRUNCATE revoked from anon + authenticated
--     SELECT grantee, privilege_type FROM information_schema.table_privileges
--      WHERE table_name = 'purchasing_truncation_pair_rulings'
--        AND grantee IN ('anon', 'authenticated')
--        AND privilege_type = 'TRUNCATE';
--     (expect zero rows)
--
-- V4. seed rowcount matches Kevin's ruling
--     SELECT COUNT(*)                  AS rulings_count,
--            SUM(amount_cents) / 100.0 AS total_excluded_dollars
--       FROM purchasing_truncation_pair_rulings;
--     (expect 45 rows, $35,626.81)
--
-- V5. after next derive run - the 45 parents show as excluded with reason
--     SELECT COUNT(DISTINCT source_bill_id) AS ruled_parents_excluded
--       FROM purchasing_actuals
--      WHERE reason = 'truncation_pair'
--        AND excluded = TRUE;
--     (expect 45 after the first derive that runs post-seed)
--
-- ─── OWNER ATTESTATION ───────────────────────────────────────────────────
-- applied in Studio: <fill-in-when-applied>
--   head SHA: <fill-in-when-applied>
