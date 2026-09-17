-- ═══════════════════════════════════════════════════════════════════
-- pnl-4-reconciliation-exceptions.sql
-- FIN-2027 W1 Stage 2 - append-only exception log for historical
-- workbook loads where the sum-check anchor drifts against the
-- workbook's own year-total column.
-- 2026-09-17
-- ═══════════════════════════════════════════════════════════════════
--
-- Ships one new table:
--
--   pnl_reconciliation_exceptions
--     Append-only log written by scripts/load_pnl_history.mjs when a
--     historical workbook line reconciles cleanly on one anchor but
--     drifts on another, or drifts on both. Under Kevin's ruling
--     2026-09-17 (correction to §5.3 brief for historical years),
--     historical loads copy - they do not withhold. The 20 FY2024
--     drift lines (5006.1 / 5006.3 / 5017.7 across 8 accounts) load
--     as-is per-period, AND their drift is recorded here so the
--     exception is queryable rather than only documented.
--
--     Why an event log, not a state table: a workbook can be
--     re-supplied after Sebastian corrects it, and a re-run should
--     preserve the historical exception record (what the first
--     ingest saw) as an artifact. No UPDATE, no DELETE - a new load
--     writes new rows.
--
-- Governing brief: CC_BRIEF_FIN2027_W1_HISTORY_LOAD.md §5.3 as
-- superseded by Kevin ruling 2026-09-17 (historical years only;
-- FY2026 period loads keep the hard gate).
-- Diagnostic that seeded this ruling: `_probe_fin2027_cell_diagnostic.mjs`
-- 2026-09-17 read of FY2024 5006.1 across TBJ-FL, TBR-FL, TXR-TX-H,
-- TXR-TX-V confirmed the workbook YTD-P13 cells carry hand-typed
-- reconciliation adjustments (`= FX71 + GE71 - 11397` etc.) while
-- the per-period cells are literals with cross-account-identical
-- copied values. The YTD side is the truer year total; the
-- per-period cells are allocated placeholders.
--
-- ─── Row semantics ─────────────────────────────────────────────────
--
-- One row per (account_key, fiscal_year, line_code, anchor) failing
-- reconciliation on a given load run. If both anchors fail, TWO
-- rows: one 'actual', one 'budget'. `note` names the anchor and can
-- carry a diagnostic string from the loader.
--
--   anchor_a  = the loader's own sum across P1..P13 (loaded_sum)
--   anchor_b  = the workbook's year-total column value
--                 - anchor='actual' -> workbook YTD-P13 Actual (col 194)
--                 - anchor='budget' -> workbook Year Total budget (col 15)
--   delta     = anchor_a - anchor_b (positive: loader higher; negative: loader lower)
--   note      = "<anchor>: <optional diagnostic>"; the loader-side
--                 is anchor_a, the workbook-side is anchor_b, so the
--                 anchor name in the note names which comparison the
--                 row records.
--   loaded_at = when this exception was written (defaults to now()).
--
-- The row's account_key + fiscal_year + line_code do NOT uniquely
-- key this table - re-loads append new rows. Query patterns include:
--   'give me the current exceptions for FY2024' -> WHERE fiscal_year=2024
--       plus loaded_at = MAX(loaded_at) grouped by (account_key, line_code)
--   'audit trail for one line' -> WHERE (account_key, fiscal_year, line_code) = ...
--
-- ─── Apply discipline ──────────────────────────────────────────────
--
-- One statement at a time in Supabase Studio's SQL editor. One
-- BEGIN/COMMIT block.
--
-- After apply, the loader's dry-run posts the exception count in
-- its verdict; the real run writes rows.
--
-- Governing docs:
--   docs/audits/FIN2027_ORIENTATION_2026-09-17.md §2 F-1..F-13
--   docs/PAST_FUTURE_FINANCE_MASTER_SCOPE.md (rulings ledger)
--   docs/migrations/pnl-1-actuals-and-status.sql (house-style anchor)
--
-- ═══════════════════════════════════════════════════════════════════


BEGIN;

-- Pre-flight: dependencies + no collision.
DO $$
DECLARE
  n_kpi_lines INTEGER;
BEGIN
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'pnl-4 pre-flight [pnl_reconciliation_exceptions]: kpi_lines missing (line_code FK cannot resolve)';
  END IF;
  IF to_regclass('public.pnl_reconciliation_exceptions') IS NOT NULL THEN
    RAISE NOTICE 'pnl-4 pre-flight [pnl_reconciliation_exceptions]: table already exists (idempotent re-apply)';
  END IF;
  SELECT COUNT(*) INTO n_kpi_lines FROM kpi_lines;
  IF n_kpi_lines < 34 THEN
    RAISE EXCEPTION 'pnl-4 pre-flight [pnl_reconciliation_exceptions]: kpi_lines = %, expected 34', n_kpi_lines;
  END IF;
END $$;

-- Append-only event log. Synthetic BIGSERIAL PK so multiple rows
-- for the same (account_key, fiscal_year, line_code, anchor) can
-- coexist across load runs. No UNIQUE constraint on the natural
-- tuple.
CREATE TABLE IF NOT EXISTS pnl_reconciliation_exceptions (
  id            BIGSERIAL PRIMARY KEY,
  account_key   TEXT NOT NULL CHECK (
                  account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                ),
  fiscal_year   INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  line_code     TEXT NOT NULL REFERENCES kpi_lines(line_code),
  anchor_a      NUMERIC(14,2) NOT NULL,                     -- loader's P1..P13 sum
  anchor_b      NUMERIC(14,2) NOT NULL,                     -- workbook's year-total column
  delta         NUMERIC(14,2) NOT NULL,                     -- anchor_a - anchor_b
  note          TEXT,                                       -- '<anchor>: <optional diagnostic>' - anchor in {'actual','budget'}
  loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the two dominant read patterns:
--   1. Latest exceptions per year               -> (fiscal_year, loaded_at)
--   2. Audit trail for one (account, line, year) -> (fiscal_year, account_key, line_code)
CREATE INDEX IF NOT EXISTS pnl_reconciliation_exceptions_fy_loaded_idx
  ON pnl_reconciliation_exceptions (fiscal_year, loaded_at DESC);
CREATE INDEX IF NOT EXISTS pnl_reconciliation_exceptions_lookup_idx
  ON pnl_reconciliation_exceptions (fiscal_year, account_key, line_code);

-- Grants. service_role only. SELECT + INSERT; no UPDATE, no DELETE:
-- an exception record is a load-time observation and is preserved
-- as an artifact of that load. If the workbook is later corrected
-- and re-loaded, a new set of rows lands; the old set stays.
GRANT SELECT, INSERT ON pnl_reconciliation_exceptions TO service_role;
GRANT USAGE ON SEQUENCE pnl_reconciliation_exceptions_id_seq TO service_role;

-- Post-flight: table + indexes + grants live.
DO $$
DECLARE
  n_rows INTEGER;
BEGIN
  IF to_regclass('public.pnl_reconciliation_exceptions') IS NULL THEN
    RAISE EXCEPTION 'pnl-4 post-flight [pnl_reconciliation_exceptions]: table did not materialise';
  END IF;
  -- Column existence guard (a typo in CREATE TABLE would surface here).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pnl_reconciliation_exceptions'
      AND column_name IN ('id','account_key','fiscal_year','line_code','anchor_a','anchor_b','delta','note','loaded_at')
    GROUP BY () HAVING COUNT(*) = 9
  ) THEN
    RAISE EXCEPTION 'pnl-4 post-flight [pnl_reconciliation_exceptions]: expected 9 columns not all present';
  END IF;
  -- Grants that the historical loader will hit at request time.
  IF NOT has_table_privilege('service_role', 'public.pnl_reconciliation_exceptions', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-4 post-flight [pnl_reconciliation_exceptions]: service_role missing SELECT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.pnl_reconciliation_exceptions', 'INSERT') THEN
    RAISE EXCEPTION 'pnl-4 post-flight [pnl_reconciliation_exceptions]: service_role missing INSERT';
  END IF;
  -- Append-only invariant check: the migration must not grant
  -- UPDATE or DELETE (a re-apply cannot silently loosen these).
  IF has_table_privilege('service_role', 'public.pnl_reconciliation_exceptions', 'UPDATE') THEN
    RAISE EXCEPTION 'pnl-4 post-flight [pnl_reconciliation_exceptions]: service_role has UPDATE (must be append-only)';
  END IF;
  IF has_table_privilege('service_role', 'public.pnl_reconciliation_exceptions', 'DELETE') THEN
    RAISE EXCEPTION 'pnl-4 post-flight [pnl_reconciliation_exceptions]: service_role has DELETE (must be append-only)';
  END IF;
  SELECT COUNT(*) INTO n_rows FROM pnl_reconciliation_exceptions;
  IF n_rows > 0 THEN
    RAISE NOTICE 'pnl-4 post-flight [pnl_reconciliation_exceptions]: table already has % rows (idempotent re-apply)', n_rows;
  END IF;
  RAISE NOTICE 'pnl-4 post-flight [pnl_reconciliation_exceptions] OK: table + indexes + grants live, append-only enforced';
END $$;

COMMIT;
