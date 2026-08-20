-- ═══════════════════════════════════════════════════════════════════
-- v42-1b-rpc-rebind.sql
--
-- Fixes the silent-truncation defect PR-A shipped: v42-1 added five
-- nullable columns to labor_actuals, the derive JS populates them,
-- but swap_labor_actuals_for_account's hardcoded INSERT column list
-- (kpi-c6-labor-actuals-source-and-scoped-swap.sql:168-203) never
-- named them. The re-derive on 2026-08-20 rewrote 1,160 rows with
-- 26-column INSERTs and dropped the five new fields on the floor.
-- Zero error, success report, silent loss.
--
-- Fix: CREATE OR REPLACE the RPC with the same signature and body
-- shape, only extending the INSERT column list + SELECT extractions
-- by the five V42 columns. Every other line is byte-identical to
-- kpi-c6.
--
-- Guard: the follow-up probe scripts/_probe_labor_rpc_coverage.mjs
-- compares this RPC's INSERT list against information_schema.columns
-- for labor_actuals and FAILS on any column the RPC does not write.
-- That is what makes this class of bug impossible to repeat rather
-- than fixing this one instance.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies this migration in Supabase Studio after v42-1.
-- 2. Run scripts/derive_labor_actuals.mjs --source=manual once so
--    every existing row picks up the V42 columns.
-- 3. Re-run scripts/_probe_v42_sentinel.mjs.
--    - S1 must match exactly (113.98 / 2.32 / 39.91 / $4,328.27).
--    - S2 must show the five columns.
--    - S3 should now populate (Kevin's 2026-08-20 measurement
--      predicts roughly 18 anomaly_no_clockout on the current week).
--    - S4 surfaces any real closed-week finding.
--    - S5 breaks down anomalies per account.
-- 4. Run scripts/_probe_labor_rpc_coverage.mjs to confirm the guard
--    is green (RPC's INSERT list covers every writable labor_actuals
--    column, whitelist honored).
-- ═══════════════════════════════════════════════════════════════════

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
  -- (Byte-identical to kpi-c6 - do not widen without touching that
  -- migration's rationale.)
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
    -- v42-1b: five new V42 columns added below.
    draft_entry_count, draft_hours,
    anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h,
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
    -- v42-1b: five new V42 columns. NULL-safe for pre-derive rows or
    -- payloads that omit them; the derive JS always writes integers
    -- or a rounded number for these fields when it runs.
    NULLIF((r->>'draft_entry_count'),   '')::INTEGER,
    NULLIF((r->>'draft_hours'),         '')::NUMERIC,
    NULLIF((r->>'anomaly_no_clockout'), '')::INTEGER,
    NULLIF((r->>'anomaly_under_1h'),    '')::INTEGER,
    NULLIF((r->>'anomaly_over_16h'),    '')::INTEGER,
    NOW(),
    p_source_run,
    'api'                              -- explicit; api pipeline always inserts as 'api'
  FROM jsonb_array_elements(p_actuals) r;
  GET DIAGNOSTICS a_count = ROW_COUNT;

  RETURN a_count;
END $$;

GRANT EXECUTE ON FUNCTION public.swap_labor_actuals_for_account(TEXT, JSONB, TEXT) TO service_role;

-- ─── Coverage guard ────────────────────────────────────────────────
-- Purpose: catch the same silent-truncation defect at the source.
-- Returns the difference between labor_actuals's writable columns
-- and the RPC's INSERT list. A non-empty missing_columns means the
-- derive can write those fields but the RPC will drop them - the
-- exact class of bug that landed 1,160 rows of NULLs after the v42-1
-- apply + re-derive on 2026-08-20. scripts/_probe_labor_rpc_coverage.mjs
-- calls this function and fails on non-empty missing_columns.
CREATE OR REPLACE FUNCTION public.labor_actuals_rpc_coverage()
RETURNS TABLE(
  actual_col_count  INTEGER,
  insert_col_count  INTEGER,
  missing_columns   TEXT[],
  extra_columns     TEXT[],
  pass              BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body           TEXT;
  v_insert_block   TEXT;
  v_insert_names   TEXT[];
  v_writable_cols  TEXT[];
BEGIN
  -- 1. Pull the swap RPC source.
  SELECT p.prosrc INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'swap_labor_actuals_for_account'
   LIMIT 1;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'swap_labor_actuals_for_account not found';
  END IF;

  -- 2. Extract the parenthesised INSERT column list.
  v_insert_block := substring(v_body FROM 'INSERT\s+INTO\s+labor_actuals\s*\(([\s\S]*?)\)\s*SELECT');
  IF v_insert_block IS NULL THEN
    RAISE EXCEPTION 'no INSERT INTO labor_actuals (...) SELECT block in RPC body';
  END IF;

  -- 3. Split on commas; strip inline SQL comments; normalise.
  SELECT array_agg(nm) INTO v_insert_names
    FROM (
      SELECT trim(regexp_replace(part, '--.*$', '', 'gm')) AS nm
        FROM regexp_split_to_table(v_insert_block, ',') AS part
    ) x
   WHERE nm <> '';

  -- 4. Every writable column on labor_actuals. Skips identity +
  --    generated columns (postgres computes those; they are never
  --    valid INSERT targets from an application).
  SELECT array_agg(column_name ORDER BY column_name) INTO v_writable_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'labor_actuals'
     AND (is_generated IS NULL OR is_generated = 'NEVER')
     AND (is_identity  IS NULL OR is_identity  = 'NO');

  -- 5. Set diff.
  actual_col_count := coalesce(array_length(v_writable_cols, 1), 0);
  insert_col_count := coalesce(array_length(v_insert_names,  1), 0);
  SELECT array_agg(c) INTO missing_columns
    FROM unnest(v_writable_cols) c
   WHERE c <> ALL (coalesce(v_insert_names, ARRAY[]::TEXT[]));
  SELECT array_agg(c) INTO extra_columns
    FROM unnest(v_insert_names) c
   WHERE c <> ALL (coalesce(v_writable_cols, ARRAY[]::TEXT[]));
  pass := (missing_columns IS NULL OR array_length(missing_columns, 1) IS NULL);
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.labor_actuals_rpc_coverage() TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  cov RECORD;
BEGIN
  -- Structural check: RPC exists at the expected signature.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'swap_labor_actuals_for_account'
      AND pg_get_function_arguments(p.oid) = 'p_account_key text, p_actuals jsonb, p_source_run text'
  ) THEN
    RAISE EXCEPTION 'post-flight: swap_labor_actuals_for_account(text, jsonb, text) not found';
  END IF;

  -- Behavioural check: run the coverage guard the probe uses.
  -- Fails inside the transaction if the RPC drops any writable
  -- labor_actuals column, so this migration cannot land in a broken
  -- state. Guards against a future rebind that drops the V42 fields
  -- again, and against any future column added to labor_actuals
  -- without a matching RPC extension.
  SELECT * INTO cov FROM labor_actuals_rpc_coverage();
  IF NOT cov.pass THEN
    RAISE EXCEPTION 'post-flight: swap RPC drops labor_actuals columns: %', cov.missing_columns;
  END IF;

  RAISE NOTICE 'v42-1b post-flight OK: RPC rebound and covers all % writable columns', cov.actual_col_count;
END $$;


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
-- re-derive run:      <fill in ISO timestamp of the manual derive after apply>
-- sentinel probe:     <PASS | FAIL - result of _probe_v42_sentinel.mjs post-re-derive>
-- coverage probe:     <PASS | FAIL - result of _probe_labor_rpc_coverage.mjs>
-- notes:              <optional - anything that needed manual attention>
