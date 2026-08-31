-- ═══════════════════════════════════════════════════════════════════
-- pnl-1-actuals-and-status.sql
-- Overview Phase 1 - foundation tables for the finance P&L layer
-- 2026-08-31
-- ═══════════════════════════════════════════════════════════════════
--
-- Ships three new tables that stand up the finance-actuals surface
-- named in KPI_MASTER_SCOPE v4 §7 (Phase 1) and audit
-- OVERVIEW_BUILD_ALIGNMENT_2026-08-31 Q7 + Q8:
--
--   1. pnl_actuals        - per-account, per-line, per-period actual
--                           + budget from Sebastian's Budget-vs-Actual
--                           workbook. Loaded by scripts/derive_pnl_actuals.mjs
--                           after Sebastian closes a period (R-17).
--
--   2. kpi_period_status  - one row per (fiscal_year, period_no) with
--                           closed_at + verified_at + verified_by +
--                           source_ref. Powers the period-state chip
--                           (§5.6, R-21): open, closed-awaiting-finance,
--                           verified.
--
--   3. kpi_account_flags  - per-account manual flag sc_revenue_live
--                           (§5.5, R-20). Governs whether the Overview
--                           reads sc_daily_revenue for open-period per-meal
--                           revenue, or falls back to budget-to-date.
--                           Defaults to false; Kevin flips per account
--                           as each site validates.
--
-- Companion loader + seed: scripts/derive_pnl_actuals.mjs upserts pnl_actuals
-- + kpi_period_status.verified_at per (fiscal_year, period_no).
-- kpi_account_flags is seeded here at migration time with 11 rows
-- (sc_revenue_live=false, set_by='phase1-seed-2026-08-31') so the
-- flag surface is present the moment the migration lands.
--
-- ─── Apply discipline ──────────────────────────────────────────────
--
-- One statement at a time in Supabase Studio's SQL editor. The file
-- is deliberately split into per-table BEGIN/COMMIT blocks so a
-- mid-file failure leaves the schema in a coherent state at whichever
-- table finished last. See v43-1-approvals-derive.sql for the same
-- discipline pattern.
--
-- After apply, run scripts/derive_pnl_actuals.mjs --file <workbook>
-- --period 8 --dry-run once, then without --dry-run to land P1..P8
-- actuals + verify kpi_period_status flips verified_at for those 8
-- rows. Then run scripts/probes/_probe_pnl_actuals_sentinels.mjs to
-- confirm the load matches Kevin's outside-data sentinel.
--
-- Governing docs:
--   docs/KPI_MASTER_SCOPE.md v4 §5.5, §5.6, §7, §7.1 Q7 + Q8
--   docs/audits/OVERVIEW_BUILD_ALIGNMENT_2026-08-31.md Q7, Q8
--   docs/handoff/PURCHASING_CC_HANDOFF_2026-08-28.md §10 (STL - MO
--     $50K MO sales tax note - drives the loader's reconciliation
--     note; not the migration itself)
--
-- ═══════════════════════════════════════════════════════════════════


-- ─── Table 1: pnl_actuals ──────────────────────────────────────────
BEGIN;

-- Pre-flight: verify dependencies exist and there is no name collision.
-- The account_key regex and REFERENCES pattern mirror kpi_budgets
-- (docs/migrations/kpi-2-budget-values.sql) so PostgREST reads on the
-- new table have identical constraint semantics.
DO $$
DECLARE
  n_kpi_lines INTEGER;
  n_accounts  INTEGER;
BEGIN
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'pnl-1 pre-flight [pnl_actuals]: kpi_lines missing (line_code FK cannot resolve)';
  END IF;
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'pnl-1 pre-flight [pnl_actuals]: accounts missing';
  END IF;
  IF to_regclass('public.pnl_actuals') IS NOT NULL THEN
    RAISE NOTICE 'pnl-1 pre-flight [pnl_actuals]: table already exists (idempotent re-apply)';
  END IF;
  SELECT COUNT(*) INTO n_kpi_lines FROM kpi_lines;
  IF n_kpi_lines <> 34 THEN
    RAISE EXCEPTION 'pnl-1 pre-flight [pnl_actuals]: kpi_lines = %, expected 34 (matches kpi-2 discipline)', n_kpi_lines;
  END IF;
  SELECT COUNT(*) INTO n_accounts FROM accounts;
  IF n_accounts <> 12 THEN
    RAISE EXCEPTION 'pnl-1 pre-flight [pnl_actuals]: accounts = %, expected 12 (11 client + CORP)', n_accounts;
  END IF;
  -- Verify service_role currently has grants to resolve on kpi_lines/kpi_budgets
  -- (belt-and-suspenders; a broken grants surface would break the loader read).
  IF NOT has_table_privilege('service_role', 'public.kpi_lines', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-1 pre-flight [pnl_actuals]: service_role missing SELECT on kpi_lines';
  END IF;
END $$;

-- The table. One row per (account, line, fiscal_year, period_no).
-- Loader UPSERTs on PK so re-issued workbooks land as amendments.
-- account_key regex mirrors kpi_budgets (kpi-2-budget-values.sql:87).
-- line_code REFERENCES kpi_lines so the loader cannot ship a code the
-- catalog does not carry (belt-and-suspenders against typos in workbook
-- label parsing).
CREATE TABLE IF NOT EXISTS pnl_actuals (
  account_key    TEXT NOT NULL CHECK (
                   account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                 ),
  fiscal_year    INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  period_no      INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  line_code      TEXT NOT NULL REFERENCES kpi_lines(line_code),
  budget         NUMERIC(14,2),                                        -- workbook's own budget column (for R-17d closed-vs-shown delta at render)
  actual         NUMERIC(14,2) NOT NULL,                               -- signed; workbook can carry negatives (returns / adjustments)
  source_ref     TEXT NOT NULL,                                        -- workbook basename, e.g. 'Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx'
  verified_at    TIMESTAMPTZ NOT NULL,                                 -- when the workbook was received / verified (per R-17)
  verified_by    TEXT NOT NULL,                                        -- ingest identity ('loader:pnl_actuals_p8_2026-08-20' or Kevin's email)
  loaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),                   -- when this row was written to PG (audit trail)
  PRIMARY KEY (account_key, fiscal_year, period_no, line_code)
);

-- Helpful non-unique indexes for the two dominant Overview read paths:
--   1. resolver call for one account, all lines, one period          -> (account_key, fiscal_year, period_no)
--   2. resolver call for one line across all accounts, one period    -> (line_code, fiscal_year, period_no)
CREATE INDEX IF NOT EXISTS pnl_actuals_account_period_idx
  ON pnl_actuals (account_key, fiscal_year, period_no);
CREATE INDEX IF NOT EXISTS pnl_actuals_line_period_idx
  ON pnl_actuals (line_code, fiscal_year, period_no);

-- Grants. service_role writes (loader) and reads (Overview resolver
-- via getServiceClient). authenticated reads only. anon has no
-- privileges. Mirrors kpi-2b-grants.sql intent.
GRANT SELECT ON pnl_actuals TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON pnl_actuals TO service_role;

-- Post-flight: table + indexes + grants live; no seed rows expected
-- at migration time (loader owns UPSERT). Belt-and-suspenders on
-- has_table_privilege exactly per user-accounts-derived.sql pattern.
DO $$
DECLARE
  n_rows INTEGER;
BEGIN
  IF to_regclass('public.pnl_actuals') IS NULL THEN
    RAISE EXCEPTION 'pnl-1 post-flight [pnl_actuals]: table did not materialise';
  END IF;
  -- Existence of columns we know we wrote - a typo in the CREATE TABLE
  -- above would surface here. Belt-and-suspenders per "guards need
  -- coverage" (2026-08-25 feedback).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pnl_actuals'
      AND column_name IN ('account_key','fiscal_year','period_no','line_code',
                          'budget','actual','source_ref','verified_at','verified_by','loaded_at')
    GROUP BY () HAVING COUNT(*) = 10
  ) THEN
    RAISE EXCEPTION 'pnl-1 post-flight [pnl_actuals]: expected 10 columns not all present';
  END IF;
  -- Grants that the loader and reader will hit at request time.
  IF NOT has_table_privilege('service_role', 'public.pnl_actuals', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [pnl_actuals]: service_role missing SELECT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.pnl_actuals', 'INSERT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [pnl_actuals]: service_role missing INSERT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.pnl_actuals', 'UPDATE') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [pnl_actuals]: service_role missing UPDATE';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.pnl_actuals', 'DELETE') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [pnl_actuals]: service_role missing DELETE';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.pnl_actuals', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [pnl_actuals]: authenticated missing SELECT';
  END IF;
  SELECT COUNT(*) INTO n_rows FROM pnl_actuals;
  IF n_rows > 0 THEN
    RAISE NOTICE 'pnl-1 post-flight [pnl_actuals]: table already has % rows (idempotent re-apply)', n_rows;
  END IF;
  RAISE NOTICE 'pnl-1 post-flight [pnl_actuals] OK';
END $$;

COMMIT;


-- ─── Table 2: kpi_period_status ────────────────────────────────────
BEGIN;

-- Pre-flight: dependencies + no collision.
DO $$
BEGIN
  IF to_regclass('public.kpi_period_status') IS NOT NULL THEN
    RAISE NOTICE 'pnl-1 pre-flight [kpi_period_status]: table already exists (idempotent re-apply)';
  END IF;
END $$;

-- One row per (fiscal_year, period_no).
--   closed_at IS NULL         -> period is still open on the calendar
--                                ("open · live estimate" chip state).
--   closed_at NOT NULL AND
--   verified_at IS NULL       -> calendar-closed, awaiting Sebastian's
--                                workbook ("closed · awaiting finance").
--   closed_at NOT NULL AND
--   verified_at NOT NULL      -> pnl_actuals landed for this period
--                                ("verified · date" chip). set by the
--                                loader on successful ingest.
CREATE TABLE IF NOT EXISTS kpi_period_status (
  fiscal_year   INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  period_no     INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  closed_at     TIMESTAMPTZ,                                           -- calendar close (deterministic; seed at migration/loader time)
  verified_at   TIMESTAMPTZ,                                           -- when pnl_actuals landed for this period
  verified_by   TEXT,                                                  -- loader ingest identity
  source_ref    TEXT,                                                  -- workbook basename that verified this period
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),                    -- last mutation timestamp
  PRIMARY KEY (fiscal_year, period_no)
);

-- No index beyond the PK - the table is at most 13 rows per fiscal
-- year. Every Overview read is a PK lookup.

GRANT SELECT ON kpi_period_status TO authenticated, service_role;
GRANT INSERT, UPDATE ON kpi_period_status TO service_role;
-- No DELETE grant: a period never disappears - the loader UPSERTs
-- verified_at from NULL to a real timestamp; it never sets it back
-- to NULL. If a workbook is retracted, updated_at moves; the row
-- stays.

-- Post-flight: existence, columns, grants.
DO $$
BEGIN
  IF to_regclass('public.kpi_period_status') IS NULL THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_period_status]: table did not materialise';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kpi_period_status'
      AND column_name IN ('fiscal_year','period_no','closed_at','verified_at',
                          'verified_by','source_ref','updated_at')
    GROUP BY () HAVING COUNT(*) = 7
  ) THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_period_status]: expected 7 columns not all present';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.kpi_period_status', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_period_status]: service_role missing SELECT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.kpi_period_status', 'INSERT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_period_status]: service_role missing INSERT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.kpi_period_status', 'UPDATE') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_period_status]: service_role missing UPDATE';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.kpi_period_status', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_period_status]: authenticated missing SELECT';
  END IF;
  RAISE NOTICE 'pnl-1 post-flight [kpi_period_status] OK';
END $$;

COMMIT;


-- ─── Table 3: kpi_account_flags ────────────────────────────────────
BEGIN;

-- Pre-flight: dependencies + no collision.
DO $$
BEGIN
  IF to_regclass('public.kpi_account_flags') IS NOT NULL THEN
    RAISE NOTICE 'pnl-1 pre-flight [kpi_account_flags]: table already exists (idempotent re-apply)';
  END IF;
END $$;

-- Manual per-account flag. sc_revenue_live gates whether the Overview
-- reads sc_daily_revenue for open-period per-meal revenue (§5.5 R-20).
-- Default false so every account starts on the safe path (planned
-- revenue from budget-to-date, marked "planned"). Kevin flips per
-- account after each site validates its SC counts.
--
-- Fee accounts do not need this row semantically (they always read
-- kpi_budgets 2400.1 for contractual recognition), but the seed
-- includes them so the flag surface is complete and probes can iterate
-- ALL_ACCOUNTS without gaps.
CREATE TABLE IF NOT EXISTS kpi_account_flags (
  account_key       TEXT PRIMARY KEY CHECK (
                      account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    ),
  sc_revenue_live   BOOLEAN NOT NULL DEFAULT false,
  set_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  set_by            TEXT NOT NULL
);

GRANT SELECT ON kpi_account_flags TO authenticated, service_role;
GRANT INSERT, UPDATE ON kpi_account_flags TO service_role;

-- Seed all 11 real account keys. INSERT ... ON CONFLICT DO NOTHING
-- so re-applying this migration is a no-op on the flag values. If
-- Kevin has flipped a flag to true before a re-apply, the flip
-- survives.
INSERT INTO kpi_account_flags (account_key, sc_revenue_live, set_by) VALUES
  ('CIN - AZ',     false, 'phase1-seed-2026-08-31'),
  ('CIN - KY',     false, 'phase1-seed-2026-08-31'),
  ('CIN - OH',     false, 'phase1-seed-2026-08-31'),
  ('STL - FL',     false, 'phase1-seed-2026-08-31'),
  ('STL - MO',     false, 'phase1-seed-2026-08-31'),
  ('TBJ - FL',     false, 'phase1-seed-2026-08-31'),
  ('TBJ - NY',     false, 'phase1-seed-2026-08-31'),
  ('TBR - FL',     false, 'phase1-seed-2026-08-31'),
  ('TXR - AZ',     false, 'phase1-seed-2026-08-31'),
  ('TXR - TX - H', false, 'phase1-seed-2026-08-31'),
  ('TXR - TX - V', false, 'phase1-seed-2026-08-31')
ON CONFLICT (account_key) DO NOTHING;

-- Post-flight: table exists, columns present, 11 seed rows landed,
-- grants live. Belt-and-suspenders on has_table_privilege.
DO $$
DECLARE
  n_rows INTEGER;
BEGIN
  IF to_regclass('public.kpi_account_flags') IS NULL THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_account_flags]: table did not materialise';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kpi_account_flags'
      AND column_name IN ('account_key','sc_revenue_live','set_at','set_by')
    GROUP BY () HAVING COUNT(*) = 4
  ) THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_account_flags]: expected 4 columns not all present';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.kpi_account_flags', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_account_flags]: service_role missing SELECT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.kpi_account_flags', 'INSERT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_account_flags]: service_role missing INSERT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.kpi_account_flags', 'UPDATE') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_account_flags]: service_role missing UPDATE';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.kpi_account_flags', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_account_flags]: authenticated missing SELECT';
  END IF;
  SELECT COUNT(*) INTO n_rows FROM kpi_account_flags;
  IF n_rows < 11 THEN
    RAISE EXCEPTION 'pnl-1 post-flight [kpi_account_flags]: expected >= 11 seed rows, got %', n_rows;
  END IF;
  RAISE NOTICE 'pnl-1 post-flight [kpi_account_flags] OK (% rows)', n_rows;
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- loader run:         <fill in ISO timestamp of the first derive_pnl_actuals run after apply>
-- sentinel probe:     <PASS | FAIL - result of _probe_pnl_actuals_sentinels.mjs>
-- notes:              <optional - anything that needed manual attention>
