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
-- Fix: CREATE OR REPLACE the RPC with the same signature, extending
-- the INSERT column list + SELECT extractions by the five V42
-- columns. Every other line is byte-identical to kpi-c6.
--
-- Guard: labor_actuals_rpc_coverage() diffs the RPC's parsed INSERT
-- list against information_schema.columns for labor_actuals. This
-- migration proves the guard works BEFORE the fix lands, then
-- rebinds, then proves the fix works, all in one transaction. A
-- broken parser (like the first attempt where trim() left \n on the
-- line-first tokens) cannot slip through - the self-test would find
-- the wrong set of missing columns and roll everything back.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies this migration in Supabase Studio after v42-1.
--    Post-flight self-checks run inside the transaction:
--      A. current RPC (pre-rebind): coverage reports exactly the
--         five V42 columns as missing, nothing else. Proves the
--         parser works on the real defective state.
--      B. new RPC (post-rebind): coverage reports zero missing.
--         Proves the fix works.
--    Any deviation aborts the transaction and leaves nothing applied.
-- 2. After apply, run scripts/derive_labor_actuals.mjs --source=manual
--    once so every existing row picks up the V42 columns.
-- 3. Re-run scripts/_probe_v42_sentinel.mjs (S1..S5) +
--    scripts/_probe_labor_rpc_coverage.mjs.
-- ═══════════════════════════════════════════════════════════════════


-- ─── Step 1: define labor_actuals_rpc_coverage() ────────────────────
-- Returns the difference between labor_actuals's writable columns
-- and the RPC's INSERT list. Called by the self-tests below and by
-- scripts/_probe_labor_rpc_coverage.mjs.
--
-- Whitespace note: the RPC body is multi-line, so the naive
-- `trim(part)` (spaces only) leaves \n on line-first tokens and
-- silently under-reports coverage - the very failure mode the first
-- v42-1b attempt hit. `btrim(part, E' \t\r\n')` strips all whitespace
-- classes from both ends; regexp comment-strip handles inline SQL
-- comments before btrim so `column,  -- comment` normalises correctly.
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

  -- 3. Split on commas, strip inline SQL comments, btrim ALL
  --    whitespace classes (space, tab, CR, LF) from both ends.
  SELECT array_agg(nm) INTO v_insert_names
    FROM (
      SELECT btrim(regexp_replace(part, '--.*$', '', 'gm'), E' \t\r\n') AS nm
        FROM regexp_split_to_table(v_insert_block, ',') AS part
    ) x
   WHERE nm <> '';

  -- 4. Every writable column on labor_actuals. Skips identity +
  --    generated columns (postgres computes those; they are never
  --    valid INSERT targets from an application). Genuine exceptions
  --    have to be explicit at the schema level - not hidden in the
  --    coverage function.
  SELECT array_agg(column_name ORDER BY column_name) INTO v_writable_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'labor_actuals'
     AND (is_generated IS NULL OR is_generated = 'NEVER')
     AND (is_identity  IS NULL OR is_identity  = 'NO');

  -- 5. Set diff. Sort for deterministic reporting.
  actual_col_count := coalesce(array_length(v_writable_cols, 1), 0);
  insert_col_count := coalesce(array_length(v_insert_names,  1), 0);
  SELECT array_agg(c ORDER BY c) INTO missing_columns
    FROM unnest(v_writable_cols) c
   WHERE c <> ALL (coalesce(v_insert_names, ARRAY[]::TEXT[]));
  SELECT array_agg(c ORDER BY c) INTO extra_columns
    FROM unnest(v_insert_names) c
   WHERE c <> ALL (coalesce(v_writable_cols, ARRAY[]::TEXT[]));
  pass := (missing_columns IS NULL OR array_length(missing_columns, 1) IS NULL);
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.labor_actuals_rpc_coverage() TO service_role;


-- ─── Step 2: SELF-TEST against the current (unrebound) RPC ─────────
-- Prove the guard actually detects the real defect BEFORE the fix
-- lands. Expected today (post-v42-1, pre-rebind): the coverage
-- function reports exactly the five V42 columns as missing and
-- nothing else. Any deviation means the parser is wrong or the
-- pre-state isn't what we thought - either way, roll back.
DO $$
DECLARE
  cov      RECORD;
  expected TEXT[] := ARRAY[
    'anomaly_no_clockout',
    'anomaly_over_16h',
    'anomaly_under_1h',
    'draft_entry_count',
    'draft_hours'
  ];
  got_sorted TEXT[];
BEGIN
  SELECT * INTO cov FROM labor_actuals_rpc_coverage();

  -- Sort both sides for order-independent equality.
  SELECT array_agg(c ORDER BY c) INTO got_sorted FROM unnest(coalesce(cov.missing_columns, ARRAY[]::TEXT[])) c;

  IF got_sorted IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'v42-1b self-test A FAILED: current RPC missing set = %, expected exactly %. Parser or pre-state is wrong.',
      got_sorted, expected;
  END IF;

  IF cov.extra_columns IS NOT NULL AND array_length(cov.extra_columns, 1) IS NOT NULL AND array_length(cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v42-1b self-test A FAILED: current RPC has unexpected extras = %. Parser is wrong (extras should be empty).',
      cov.extra_columns;
  END IF;

  RAISE NOTICE 'v42-1b self-test A OK: parser detects the five V42 columns as missing on the current RPC, zero extras. Guard works on the real defect.';
END $$;


-- ─── Step 3: rebind the RPC ─────────────────────────────────────────
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
    -- v42-1b: five new V42 columns. NULL-safe for pre-derive rows
    -- or payloads that omit them; the derive JS writes integers or
    -- a rounded number for these fields whenever it runs.
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


-- ─── Step 4: post-rebind self-test ─────────────────────────────────
-- Prove the new RPC covers every writable column. If this fails,
-- the CREATE OR REPLACE landed with a defect and everything rolls
-- back including step 3 - the RPC returns to its kpi-c6 state.
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
    RAISE EXCEPTION 'v42-1b self-test B FAILED: swap_labor_actuals_for_account(text, jsonb, text) not found';
  END IF;

  -- Behavioural check: coverage must be green.
  SELECT * INTO cov FROM labor_actuals_rpc_coverage();
  IF NOT cov.pass THEN
    RAISE EXCEPTION 'v42-1b self-test B FAILED: rebound RPC still drops columns: %', cov.missing_columns;
  END IF;
  IF cov.extra_columns IS NOT NULL AND array_length(cov.extra_columns, 1) IS NOT NULL AND array_length(cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v42-1b self-test B FAILED: rebound RPC has typo/dropped-column extras: %', cov.extra_columns;
  END IF;

  RAISE NOTICE 'v42-1b self-test B OK: RPC rebound and covers all % writable columns, zero extras.', cov.actual_col_count;
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
