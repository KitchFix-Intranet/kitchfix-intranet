-- ═══════════════════════════════════════════════════════════════════
-- kpi-1b-activation-fk.sql
-- KPI Engine - Bundle 1b: kpi_line_activation FK swap + grants
-- 2026-08-04
-- ═══════════════════════════════════════════════════════════════════
--
-- Two follow-ups to kpi-1-spine.sql, both discovered after apply:
--
--   1. Swap the regex CHECK on kpi_line_activation.account_key for a
--      foreign key to accounts(team_key). The CHECK constrains SHAPE
--      but not IDENTITY - `'ZZZ - QQ'` passes the pattern. The FK
--      constrains to real accounts and cascades correctly on any
--      future rename. The original CREATE TABLE cannot be edited
--      because IF NOT EXISTS makes any change invisible on re-run;
--      hence the separate ALTER migration here.
--
--   2. GRANT SELECT on kpi_lines and kpi_line_activation to service_role.
--      Applied kpi-1 omitted these grants, so the local probe cannot
--      read either table. Kevin's applied state has the tables and the
--      rows but no service_role SELECT, which blocks _probe_kpi_spine.mjs.
--
-- SAFETY GATE - accounts.team_key must carry a unique or primary key.
--   Verified 2026-08-04 via duplicate insert probe: team_key is the
--   PRIMARY KEY of accounts (constraint name accounts_pkey). Pre-flight
--   asserts this directly from pg_constraint before touching anything.
--   If team_key ever loses that constraint, this migration aborts
--   rather than leaving the table in a half-migrated state.
--
-- SAFETY GATE - every existing account_key must resolve to an accounts
--   row. If ANY does not, the FK ADD would fail on the live rows and
--   Kevin would see a cryptic constraint violation. Pre-flight lists
--   the offenders (if any) BEFORE dropping the CHECK.
--
-- IDEMPOTENCY:
--   - Dynamic DROP by actual constraint name (pg_constraint lookup)
--     so re-run is a no-op if the CHECK is already gone.
--   - ADD CONSTRAINT ... check via pg_constraint too; skip if the FK
--     is already present.
--   - GRANT is idempotent by construction.
--   Second pass runs cleanly against a database that already has kpi-1b.
--
-- APPLY ORDER: kpi-1 must have been applied first (this migration
-- references tables kpi-1 creates). Pre-flight aborts if not.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- Pre-flight assertions
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_tables INT;
  team_key_is_unique BOOLEAN;
  orphan_count INT;
  orphan_sample TEXT;
BEGIN
  -- kpi-1 must have been applied
  SELECT COUNT(*) INTO n_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('kpi_lines', 'kpi_line_activation');
  IF n_tables <> 2 THEN
    RAISE EXCEPTION 'kpi-1b pre-flight: expected kpi_lines and kpi_line_activation to exist (kpi-1 not applied?); found %', n_tables;
  END IF;

  -- accounts.team_key MUST have a unique or primary key constraint or
  -- the FK ADD will fail. pg_constraint is authoritative.
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'accounts'
      AND a.attname = 'team_key'
      AND c.contype IN ('p', 'u')
      AND array_length(c.conkey, 1) = 1
  ) INTO team_key_is_unique;
  IF NOT team_key_is_unique THEN
    RAISE EXCEPTION 'kpi-1b pre-flight: accounts.team_key does not carry a UNIQUE or PRIMARY KEY constraint. Adding one is a bigger change than belongs here and needs its own migration. Aborting.';
  END IF;

  -- Every existing account_key must resolve to an accounts row, or the
  -- FK ADD will fail on live data. Surface the offenders now, not on
  -- the failed ADD.
  SELECT COUNT(*), string_agg(DISTINCT act.account_key, ', ')
  INTO orphan_count, orphan_sample
  FROM kpi_line_activation act
  LEFT JOIN accounts a ON a.team_key = act.account_key
  WHERE a.team_key IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'kpi-1b pre-flight: % activation row(s) have account_key values not in accounts.team_key: %. Resolve before FK ADD.', orphan_count, orphan_sample;
  END IF;

  RAISE NOTICE 'kpi-1b pre-flight OK. team_key is unique/PK, zero orphan activation rows.';
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 1. Drop the existing regex CHECK on account_key
-- ─────────────────────────────────────────────────────────────────
-- Look up the actual constraint name (Postgres auto-generates as
-- kpi_line_activation_account_key_check when unnamed) and drop it if
-- present. Idempotent - no-op if the CHECK is already gone.
DO $$
DECLARE
  chk_name TEXT;
BEGIN
  SELECT conname INTO chk_name
  FROM pg_constraint
  WHERE conrelid = 'public.kpi_line_activation'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%account_key%'
  LIMIT 1;

  IF chk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE kpi_line_activation DROP CONSTRAINT %I', chk_name);
    RAISE NOTICE 'kpi-1b: dropped CHECK constraint %', chk_name;
  ELSE
    RAISE NOTICE 'kpi-1b: no CHECK constraint on account_key found (already dropped or never existed)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 2. Add the FK to accounts(team_key), if not already present
-- ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kpi_line_activation'::regclass
      AND contype = 'f'
      AND conname = 'kpi_line_activation_account_key_fkey'
  ) THEN
    ALTER TABLE kpi_line_activation
      ADD CONSTRAINT kpi_line_activation_account_key_fkey
      FOREIGN KEY (account_key) REFERENCES accounts(team_key);
    RAISE NOTICE 'kpi-1b: added FK kpi_line_activation_account_key_fkey';
  ELSE
    RAISE NOTICE 'kpi-1b: FK kpi_line_activation_account_key_fkey already exists';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 3. Grants missed by kpi-1
-- ─────────────────────────────────────────────────────────────────
GRANT SELECT ON kpi_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON kpi_line_activation TO service_role;

-- ─────────────────────────────────────────────────────────────────
-- Post-flight assertions
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fk_present BOOLEAN;
  chk_still_there BOOLEAN;
  n_activation INT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kpi_line_activation'::regclass
      AND contype = 'f'
      AND conname = 'kpi_line_activation_account_key_fkey'
  ) INTO fk_present;
  IF NOT fk_present THEN
    RAISE EXCEPTION 'kpi-1b post-flight: FK not present after ADD';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kpi_line_activation'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%account_key%'
  ) INTO chk_still_there;
  IF chk_still_there THEN
    RAISE EXCEPTION 'kpi-1b post-flight: a CHECK constraint on account_key is still present. Manual investigation required.';
  END IF;

  SELECT COUNT(*) INTO n_activation FROM kpi_line_activation WHERE fiscal_year = 2026;
  IF n_activation <> 374 THEN
    RAISE EXCEPTION 'kpi-1b post-flight: FY2026 rows = %, expected 374 (row count must be unchanged by this migration)', n_activation;
  END IF;

  RAISE NOTICE 'kpi-1b post-flight OK. FK in place, CHECK gone, 374 FY2026 rows intact.';
END $$;

COMMIT;
