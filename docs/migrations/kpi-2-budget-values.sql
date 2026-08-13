-- ═══════════════════════════════════════════════════════════════════
-- kpi-2-budget-values.sql
-- KPI Engine - Bundle 2: budget values (schema only, no data rows)
-- 2026-08-13
-- ═══════════════════════════════════════════════════════════════════
--
-- LOADER PATTERN. This migration ships an EMPTY kpi_budgets table.
-- All dollar values live in a local seed file that Kevin keeps outside
-- the repo and loads via scripts/load_kpi_budgets_2026.mjs after this
-- migration applies in Studio. That keeps client financials out of the
-- public repo entirely - the schema is public, the numbers are not.
--
-- Sequence:
--   1. Apply this migration in Studio (one statement at a time).
--   2. Run scripts/verify_budget_seed_vs_xlsx.mjs against the 11
--      workbooks - must be 11/11 TIE before loading.
--   3. Run scripts/load_kpi_budgets_2026.mjs --file <seed.json> for a
--      real load (idempotent upsert).
--   4. Run scripts/_probe_kpi_budgets.mjs --file <seed.json> for the
--      final PASS gate.
--   5. Comment "applied in Studio: YES" and "loaded: YES" on the PR.
--
-- Governing docs: docs/KPI_DASHBOARD_PLAYBOOK.md §4.5 (budget
-- authority is layered), §5.4 (labor budget drift - TXR-HOME only),
-- §8.2 (subtraction problem: this table stores 3100.1 amongst others,
-- but the resolver never ships 3100.2 or 3100-group totals to public
-- surfaces).
--
-- Pre-flight assertions (abort on drift, tolerate re-run):
--   - kpi_lines = 34
--   - kpi_line_activation FY2026 = 374
--   - accounts = 12 (11 client + CORP)
--
-- Idempotency:
--   - CREATE TABLE IF NOT EXISTS on kpi_budgets.
--   - No seed rows. The loader script owns UPSERT semantics on the PK.
--   - Re-apply is a no-op once the table exists.
--
-- What this migration does NOT do:
--   - Does NOT touch sc_labor_budgets (that stays as the supersede
--     source-of-truth per playbook §4.5).
--   - Does NOT touch kpi_lines or kpi_line_activation (kpi-1 territory).
--   - Does NOT touch accounts.
--   - Does NOT add explicit GRANTs. kpi-1 relied on default privileges
--     (ownership grants; verified in kpi-1-spine.sql - no explicit
--     GRANT statement). Mirroring that pattern here per prompt.
--
-- ─────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  n_kpi_lines INTEGER;
  n_activation INTEGER;
  n_accounts INTEGER;
BEGIN
  -- kpi_lines - canonical chart from kpi-1, applied 2026-08-04.
  SELECT COUNT(*) INTO n_kpi_lines FROM kpi_lines;
  IF n_kpi_lines <> 34 THEN
    RAISE EXCEPTION 'kpi-2 pre-flight: kpi_lines = %, expected 34', n_kpi_lines;
  END IF;

  -- kpi_line_activation FY2026 - 11 accounts x 34 lines = 374.
  SELECT COUNT(*) INTO n_activation
    FROM kpi_line_activation WHERE fiscal_year = 2026;
  IF n_activation <> 374 THEN
    RAISE EXCEPTION 'kpi-2 pre-flight: kpi_line_activation FY2026 = %, expected 374', n_activation;
  END IF;

  -- accounts - 11 client + CORP = 12.
  SELECT COUNT(*) INTO n_accounts FROM accounts;
  IF n_accounts <> 12 THEN
    RAISE EXCEPTION 'kpi-2 pre-flight: accounts = %, expected 12', n_accounts;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- kpi_budgets - per-account, per-line, per-period budget amounts.
-- ─────────────────────────────────────────────────────────────────
-- Regex CHECK on account_key mirrors kpi_line_activation's canonical
-- spaced-hyphen shape (kpi-1 line 279). Cross-check on real accounts
-- is deferred to a separate kpi-2b-budget-fk migration if wanted; do
-- NOT edit this CREATE after apply (IF NOT EXISTS makes edits invisible
-- on re-run; see GOTCHAS "applied migration is history").
CREATE TABLE IF NOT EXISTS kpi_budgets (
  account_key   TEXT NOT NULL CHECK (
                  account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                ),
  line_code     TEXT NOT NULL REFERENCES kpi_lines(line_code),
  fiscal_year   INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  period_no     INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  amount        NUMERIC(12,2) NOT NULL,
  source_doc    TEXT NOT NULL,
  loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_key, line_code, fiscal_year, period_no)
);

-- Helpful non-unique index for the labor-route resolver:
-- (account_key, line_code) is the loop-inner scope when pulling
-- periods 1..13 for a single line on one account. Cheap given the
-- table is small (roughly 4,500 rows at full load).
CREATE INDEX IF NOT EXISTS kpi_budgets_account_line_idx
  ON kpi_budgets (account_key, line_code, fiscal_year);

-- ─────────────────────────────────────────────────────────────────
-- Post-flight - table exists, is empty, PK + FK + CHECK are live.
-- The loader will populate; no rows expected at migration time.
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_rows FROM kpi_budgets;
  IF n_rows <> 0 THEN
    RAISE NOTICE 'kpi-2 post-flight: kpi_budgets already has % rows (idempotent re-apply)', n_rows;
  END IF;
END $$;

COMMIT;
