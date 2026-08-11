-- kpi-c6-labor-actuals-source-and-scoped-swap.sql
--
-- KPI PR C6: enables pre-floor labor-dollar backfill from Rippling's
-- "Hours worked by employee" report (which returns dollars for the
-- pre-2026-04-20 window that the API pipeline cannot).
--
-- Two coupled changes; must land together or the backfill is wiped
-- on the first nightly re-derive:
--
--   1. Add labor_actuals.source ('api' | 'report_backfill'). Every
--      existing row is 'api' (default). Backfilled rows are
--      'report_backfill'. Provenance stays visible - "why does January
--      look different in March?" is answerable.
--
--   2. Scope swap_labor_actuals_for_account's DELETE to source='api'.
--      The nightly re-derive would otherwise wipe backfill rows for
--      every account it re-derives. This is the single highest-risk
--      item and the reason the two changes cannot ship separately.
--
-- Also extends the week_source CHECK to include 'rippling_report' so
-- backfilled rows can be honest about where the (week_start, week_end,
-- period_no) triple was resolved from.
--
-- Does NOT edit kpi-8bb or kpi-8bc. Both applied. This migration adds
-- on top - table alteration, function replacement, view recreation.
--
-- Applied: NOT YET. Kevin reviews, then Studio.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.labor_actuals') IS NULL THEN
    RAISE EXCEPTION 'kpi-c6 pre-flight: labor_actuals missing - kpi-8bb/8bc must be applied first';
  END IF;
  IF to_regclass('public.labor_actuals_latest') IS NULL THEN
    RAISE EXCEPTION 'kpi-c6 pre-flight: labor_actuals_latest missing';
  END IF;
  -- Idempotent guard - if the column already exists (re-apply), skip
  -- the add and go straight to the CHECK / function / view rebinding.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labor_actuals' AND column_name = 'source'
  ) THEN
    RAISE NOTICE 'kpi-c6: labor_actuals.source already exists - re-apply path';
  END IF;
END $$;

-- ─── 1. Add source column ───────────────────────────────────────────
-- DEFAULT 'api' so every existing row keeps its provenance.
-- NOT NULL after backfill of the default.
ALTER TABLE public.labor_actuals
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'api';

-- CHECK on the two known values. Named so future migrations can
-- ALTER-drop-and-add cleanly (kpi-c5 established the pattern for
-- named-CHECK evolution).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'labor_actuals' AND c.conname = 'labor_actuals_source_check'
  ) THEN
    ALTER TABLE public.labor_actuals
      ADD CONSTRAINT labor_actuals_source_check
      CHECK (source IN ('api', 'report_backfill'));
  END IF;
END $$;

-- Index the new column for the source-scoped DELETE and for pre-flight
-- checks. Composite with account_key mirrors the DELETE predicate.
CREATE INDEX IF NOT EXISTS labor_actuals_source_account_idx
  ON public.labor_actuals (source, account_key);

-- ─── 2. Extend week_source CHECK to include 'rippling_report' ──────
-- Existing CHECK allows 'sc_day_metadata' and 'iso_fallback'. Add
-- 'rippling_report' so backfilled rows honestly name the source of
-- the (week_start, week_end, period_no) resolution.
--
-- Use the column-scoped conkey match, not LIKE on the rendered defn
-- (kpi-c5 apply-fix documented why LIKE '%IN%' fails: Postgres
-- normalizes CHECK (col IN (...)) to CHECK ((col = ANY (ARRAY[...]))).
DO $$
DECLARE
  cn TEXT;
  cnt INTEGER;
BEGIN
  SELECT count(*), max(c.conname)
    INTO cnt, cn
  FROM pg_constraint c
  JOIN pg_class     t ON c.conrelid    = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'labor_actuals'
    AND c.contype = 'c'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid
        AND a.attname  = 'week_source'
        AND a.attnum   = ANY (c.conkey)
    );
  IF cnt = 0 THEN
    RAISE EXCEPTION 'kpi-c6: could not find week_source CHECK constraint on labor_actuals';
  END IF;
  IF cnt > 1 THEN
    RAISE EXCEPTION 'kpi-c6: found % week_source CHECK constraints on labor_actuals; refusing to drop arbitrarily', cnt;
  END IF;
  -- Idempotent: if the current defn already includes 'rippling_report',
  -- leave it alone.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c2
    WHERE c2.conname = cn
      AND pg_get_constraintdef(c2.oid) LIKE '%rippling_report%'
  ) THEN
    RAISE NOTICE 'kpi-c6: week_source CHECK already includes rippling_report; skipping';
  ELSE
    EXECUTE format('ALTER TABLE public.labor_actuals DROP CONSTRAINT %I', cn);
    ALTER TABLE public.labor_actuals
      ADD CONSTRAINT labor_actuals_week_source_check
      CHECK (week_source IN ('sc_day_metadata', 'iso_fallback', 'rippling_report'));
  END IF;
END $$;

-- ─── 3. Recreate labor_actuals_latest to expose source ─────────────
DROP VIEW IF EXISTS public.labor_actuals_latest;
CREATE VIEW public.labor_actuals_latest AS
  SELECT
    account_key, worker_id, week_label, line_code,
    hours_regular, hours_overtime, hours_double_time, hours_premium_other,
    dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other,
    amount, hours_without_dollars,
    week_start, week_end, fiscal_year, period_no, week_source,
    segment_count, entry_count, coverage_state,
    derived_at, source_run, source
  FROM public.labor_actuals;

GRANT SELECT ON public.labor_actuals_latest TO service_role;

-- ─── 4. Scope swap_labor_actuals_for_account's DELETE to source='api' ──
-- CRITICAL. Without this scope the nightly re-derive DELETEs the
-- backfilled rows and re-inserts only api rows, silently destroying
-- everything the loader wrote. Same signature as kpi-8bc; only the
-- DELETE predicate widens with AND source='api'.
CREATE OR REPLACE FUNCTION public.swap_labor_actuals_for_account(
  p_account_key   TEXT,
  p_actuals       JSONB,
  p_source_run    TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a_count INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE team_key = p_account_key) THEN
    RAISE EXCEPTION 'swap_labor_actuals_for_account: account_key % not in accounts table', p_account_key;
  END IF;

  -- Source-scoped delete: nightly re-derive only wipes api-source
  -- rows. report_backfill rows are preserved across every derive run.
  DELETE FROM labor_actuals
   WHERE account_key = p_account_key
     AND source = 'api';

  INSERT INTO labor_actuals (
    account_key, worker_id, week_label, line_code,
    hours_regular, hours_overtime, hours_double_time, hours_premium_other,
    dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other,
    amount, hours_without_dollars,
    week_start, week_end, fiscal_year, period_no, week_source,
    segment_count, entry_count, coverage_state,
    derived_at, source_run, source
  )
  SELECT
    p_account_key,
    (r->>'worker_id')::TEXT,
    (r->>'week_label')::TEXT,
    (r->>'line_code')::TEXT,
    COALESCE((r->>'hours_regular')::NUMERIC, 0),
    COALESCE((r->>'hours_overtime')::NUMERIC, 0),
    COALESCE((r->>'hours_double_time')::NUMERIC, 0),
    COALESCE((r->>'hours_premium_other')::NUMERIC, 0),
    COALESCE((r->>'dollars_regular')::NUMERIC, 0),
    COALESCE((r->>'dollars_overtime')::NUMERIC, 0),
    COALESCE((r->>'dollars_double_time')::NUMERIC, 0),
    COALESCE((r->>'dollars_premium_other')::NUMERIC, 0),
    COALESCE((r->>'amount')::NUMERIC, 0),
    COALESCE((r->>'hours_without_dollars')::NUMERIC, 0),
    (r->>'week_start')::DATE,
    (r->>'week_end')::DATE,
    NULLIF((r->>'fiscal_year'), '')::INTEGER,
    NULLIF((r->>'period_no'), '')::INTEGER,
    (r->>'week_source')::TEXT,
    COALESCE((r->>'segment_count')::INTEGER, 0),
    COALESCE((r->>'entry_count')::INTEGER, 0),
    (r->>'coverage_state')::TEXT,
    NOW(),
    p_source_run,
    'api'                              -- explicit; api pipeline always inserts as 'api'
  FROM jsonb_array_elements(p_actuals) r;
  GET DIAGNOSTICS a_count = ROW_COUNT;

  RETURN a_count;
END $$;

GRANT EXECUTE ON FUNCTION public.swap_labor_actuals_for_account(TEXT, JSONB, TEXT) TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  api_rows           INTEGER;
  backfill_rows      INTEGER;
  view_has_source    BOOLEAN;
  fn_delete_scoped   BOOLEAN;
  wk_has_report      BOOLEAN;
BEGIN
  -- Structure: column exists, indexed, CHECK present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='labor_actuals' AND column_name='source'
  ) THEN
    RAISE EXCEPTION 'post-flight: labor_actuals.source column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='labor_actuals' AND indexname='labor_actuals_source_account_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: labor_actuals_source_account_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname='labor_actuals' AND c.conname='labor_actuals_source_check'
  ) THEN
    RAISE EXCEPTION 'post-flight: labor_actuals_source_check missing';
  END IF;

  -- Every existing row backfilled with source='api'
  SELECT COUNT(*) INTO backfill_rows FROM labor_actuals WHERE source IS NULL;
  IF backfill_rows > 0 THEN
    RAISE EXCEPTION 'post-flight: % rows still have NULL source (default backfill failed)', backfill_rows;
  END IF;
  SELECT COUNT(*) INTO api_rows FROM labor_actuals WHERE source = 'api';
  SELECT COUNT(*) INTO backfill_rows FROM labor_actuals WHERE source = 'report_backfill';
  RAISE NOTICE 'kpi-c6: api rows=%, report_backfill rows=% (expected report_backfill=0 pre-loader)', api_rows, backfill_rows;

  -- View exposes source
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='labor_actuals_latest' AND column_name='source'
  ) INTO view_has_source;
  IF NOT view_has_source THEN
    RAISE EXCEPTION 'post-flight: labor_actuals_latest view does not expose source column';
  END IF;

  -- Function body contains the source-scoped DELETE (the whole point)
  SELECT (pg_get_functiondef(p.oid) LIKE '%source = ''api''%')
    INTO fn_delete_scoped
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'swap_labor_actuals_for_account'
    AND pg_get_function_identity_arguments(p.oid) = 'p_account_key text, p_actuals jsonb, p_source_run text';
  IF NOT COALESCE(fn_delete_scoped, false) THEN
    RAISE EXCEPTION 'post-flight: swap_labor_actuals_for_account does NOT scope DELETE to source=api - nightly would wipe backfill';
  END IF;

  -- week_source CHECK includes rippling_report
  SELECT (pg_get_constraintdef(c.oid) LIKE '%rippling_report%')
    INTO wk_has_report
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'labor_actuals'
    AND c.contype = 'c'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attname = 'week_source' AND a.attnum = ANY (c.conkey)
    );
  IF NOT COALESCE(wk_has_report, false) THEN
    RAISE EXCEPTION 'post-flight: week_source CHECK does not include rippling_report';
  END IF;

  -- Grants preserved on function
  IF NOT has_function_privilege('service_role',
    'swap_labor_actuals_for_account(text, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing EXECUTE on swap_labor_actuals_for_account';
  END IF;
  IF NOT has_table_privilege('service_role', 'labor_actuals_latest', 'SELECT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on labor_actuals_latest';
  END IF;

  RAISE NOTICE 'kpi-c6 post-flight PASS - source column + scoped swap + view + CHECK + grants';
END $$;

COMMIT;

-- ─── Rollback (paste in Studio if needed) ───────────────────────────
--   BEGIN;
--   -- Restore swap function to the pre-c6 body (unscoped DELETE)
--   -- from kpi-8bc lines 120-176. Only re-run this if there are no
--   -- report_backfill rows OR if you delete them first.
--   -- DROP the report_backfill rows first (loses backfill!):
--   DELETE FROM labor_actuals WHERE source = 'report_backfill';
--   DROP VIEW  IF EXISTS labor_actuals_latest;
--   ALTER TABLE labor_actuals DROP CONSTRAINT IF EXISTS labor_actuals_source_check;
--   DROP INDEX IF EXISTS labor_actuals_source_account_idx;
--   ALTER TABLE labor_actuals DROP COLUMN IF EXISTS source;
--   ALTER TABLE labor_actuals DROP CONSTRAINT IF EXISTS labor_actuals_week_source_check;
--   ALTER TABLE labor_actuals ADD CONSTRAINT labor_actuals_week_source_check
--     CHECK (week_source IN ('sc_day_metadata', 'iso_fallback'));
--   -- Then paste the labor_actuals_latest view from kpi-8bc lines 106-115
--   -- Then paste the swap_labor_actuals_for_account body from kpi-8bc lines 120-176
--   COMMIT;
