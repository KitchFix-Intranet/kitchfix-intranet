-- ═══════════════════════════════════════════════════════════════════
-- v42-2-view-rebind.sql
--
-- Same silent-truncation class as v42-1b's RPC finding, one layer up:
-- labor_actuals_latest (defined in kpi-c6:127-137) has a hardcoded
-- 25-column SELECT and does NOT expose the five V42 columns that
-- v42-1 added and v42-1b's rebound RPC now populates. Every route
-- read goes through this view, so the client cannot see draft_hours,
-- draft_entry_count, or the anomaly counts even though they live on
-- the base table.
--
-- Fix
-- ───
-- 1. DROP + CREATE labor_actuals_latest with the five V42 columns
--    appended to the SELECT.
-- 2. Extend labor_actuals_rpc_coverage() into
--    labor_actuals_coverage() which returns BOTH the RPC INSERT
--    coverage AND the view SELECT coverage in one shot. Any writable
--    labor_actuals column the RPC drops OR the view hides is
--    surfaced. scripts/_probe_labor_rpc_coverage.mjs calls the new
--    function.
-- 3. Self-test before AND after: run coverage against the CURRENT
--    view (which is expected to be missing the five V42 columns),
--    assert exactly that set, then rebind, then assert green. Same
--    pattern that caught the trim() bug in v42-1b.
--
-- Guard scope: the view check enforces coverage on labor_actuals_latest
-- only. Any future view built off labor_actuals should get the same
-- treatment - add a check to labor_actuals_coverage() when the view
-- lands. A whitelist column set is enforced at the SCHEMA level
-- (is_generated / is_identity skipped); genuine exceptions have to
-- be explicit at the schema level, not hidden in the guard.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies this migration in Studio after v42-1b. The four
--    self-tests run inside the transaction:
--      A. view coverage against CURRENT (unrebound) view: missing
--         exactly the five V42 columns
--      B. RPC coverage against current rebound RPC: pass (guard
--         regression check)
--      C. view coverage post-rebind: pass
--      D. RPC coverage post-rebind: pass
-- 2. After apply, re-run scripts/_probe_labor_rpc_coverage.mjs -
--    both RPC and view lines should show PASS.
-- 3. No re-derive needed. The columns are already populated per the
--    v42-1b post-derive; this migration just makes them visible.
-- ═══════════════════════════════════════════════════════════════════


-- ─── Step 1: extend the coverage guard to also cover the view ──────
-- Same parser as labor_actuals_rpc_coverage(). btrim(x, E' \t\r\n')
-- strips all whitespace classes so line-first tokens in a multi-line
-- SELECT list do not carry a leading \n (the trim() defect that
-- rolled v42-1b's first attempt back).
CREATE OR REPLACE FUNCTION public.labor_actuals_coverage()
RETURNS TABLE(
  subject           TEXT,        -- 'rpc_insert' | 'view_select'
  actual_col_count  INTEGER,
  named_col_count   INTEGER,
  missing_columns   TEXT[],
  extra_columns     TEXT[],
  pass              BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rpc_body     TEXT;
  v_rpc_block    TEXT;
  v_rpc_names    TEXT[];
  v_view_def     TEXT;
  v_view_block   TEXT;
  v_view_names   TEXT[];
  v_writable     TEXT[];
BEGIN
  -- Writable columns on labor_actuals. Skip generated + identity.
  SELECT array_agg(column_name ORDER BY column_name) INTO v_writable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'labor_actuals'
     AND (is_generated IS NULL OR is_generated = 'NEVER')
     AND (is_identity  IS NULL OR is_identity  = 'NO');

  -- ── RPC subject ──────────────────────────────────────────────────
  SELECT p.prosrc INTO v_rpc_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'swap_labor_actuals_for_account'
   LIMIT 1;
  IF v_rpc_body IS NULL THEN
    RAISE EXCEPTION 'swap_labor_actuals_for_account not found';
  END IF;
  v_rpc_block := substring(v_rpc_body FROM 'INSERT\s+INTO\s+labor_actuals\s*\(([\s\S]*?)\)\s*SELECT');
  IF v_rpc_block IS NULL THEN
    RAISE EXCEPTION 'no INSERT INTO labor_actuals (...) SELECT block in RPC body';
  END IF;
  SELECT array_agg(nm) INTO v_rpc_names
    FROM (
      SELECT btrim(regexp_replace(part, '--.*$', '', 'gm'), E' \t\r\n') AS nm
        FROM regexp_split_to_table(v_rpc_block, ',') AS part
    ) x
   WHERE nm <> '';

  subject          := 'rpc_insert';
  actual_col_count := coalesce(array_length(v_writable,  1), 0);
  named_col_count  := coalesce(array_length(v_rpc_names, 1), 0);
  SELECT array_agg(c ORDER BY c) INTO missing_columns
    FROM unnest(v_writable) c
   WHERE c <> ALL (coalesce(v_rpc_names, ARRAY[]::TEXT[]));
  SELECT array_agg(c ORDER BY c) INTO extra_columns
    FROM unnest(v_rpc_names) c
   WHERE c <> ALL (coalesce(v_writable, ARRAY[]::TEXT[]));
  pass := (missing_columns IS NULL OR array_length(missing_columns, 1) IS NULL);
  RETURN NEXT;

  -- ── View subject ─────────────────────────────────────────────────
  -- pg_get_viewdef gives us the SELECT as a formatted string. The
  -- projection appears as `SELECT col1, col2, ... FROM ...`. Grab
  -- the block between SELECT and FROM to enumerate exposed names.
  SELECT pg_get_viewdef('public.labor_actuals_latest'::regclass, true) INTO v_view_def;
  IF v_view_def IS NULL THEN
    RAISE EXCEPTION 'view public.labor_actuals_latest not found';
  END IF;
  v_view_block := substring(v_view_def FROM 'SELECT([\s\S]*?)FROM');
  IF v_view_block IS NULL THEN
    RAISE EXCEPTION 'no SELECT ... FROM block in labor_actuals_latest';
  END IF;
  SELECT array_agg(nm) INTO v_view_names
    FROM (
      SELECT btrim(regexp_replace(part, '--.*$', '', 'gm'), E' \t\r\n') AS nm
        FROM regexp_split_to_table(v_view_block, ',') AS part
    ) x
   WHERE nm <> '';

  subject          := 'view_select';
  actual_col_count := coalesce(array_length(v_writable,   1), 0);
  named_col_count  := coalesce(array_length(v_view_names, 1), 0);
  SELECT array_agg(c ORDER BY c) INTO missing_columns
    FROM unnest(v_writable) c
   WHERE c <> ALL (coalesce(v_view_names, ARRAY[]::TEXT[]));
  SELECT array_agg(c ORDER BY c) INTO extra_columns
    FROM unnest(v_view_names) c
   WHERE c <> ALL (coalesce(v_writable, ARRAY[]::TEXT[]));
  pass := (missing_columns IS NULL OR array_length(missing_columns, 1) IS NULL);
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.labor_actuals_coverage() TO service_role;


-- ─── Step 2: self-test A - view coverage BEFORE rebind ─────────────
-- Prove the guard detects the real defect. Current view is expected
-- to be missing exactly the five V42 columns.
DO $$
DECLARE
  view_cov    RECORD;
  rpc_cov     RECORD;
  expected TEXT[] := ARRAY[
    'anomaly_no_clockout',
    'anomaly_over_16h',
    'anomaly_under_1h',
    'draft_entry_count',
    'draft_hours'
  ];
  got_sorted TEXT[];
BEGIN
  SELECT * INTO view_cov FROM labor_actuals_coverage() WHERE subject = 'view_select';
  SELECT array_agg(c ORDER BY c) INTO got_sorted FROM unnest(coalesce(view_cov.missing_columns, ARRAY[]::TEXT[])) c;
  IF got_sorted IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'v42-2 self-test A FAILED: view missing set = %, expected exactly %. Parser or pre-state is wrong.',
      got_sorted, expected;
  END IF;
  IF view_cov.extra_columns IS NOT NULL AND array_length(view_cov.extra_columns, 1) IS NOT NULL AND array_length(view_cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v42-2 self-test A FAILED: view has unexpected extras = %', view_cov.extra_columns;
  END IF;

  -- Also confirm the RPC is still green (v42-1b regression check).
  SELECT * INTO rpc_cov FROM labor_actuals_coverage() WHERE subject = 'rpc_insert';
  IF NOT rpc_cov.pass THEN
    RAISE EXCEPTION 'v42-2 self-test A FAILED: RPC coverage regressed since v42-1b: missing %', rpc_cov.missing_columns;
  END IF;

  RAISE NOTICE 'v42-2 self-test A OK: view missing exactly the five V42 columns, RPC still green';
END $$;


-- ─── Step 3: rebind the view ────────────────────────────────────────
DROP VIEW IF EXISTS public.labor_actuals_latest;
CREATE VIEW public.labor_actuals_latest AS
  SELECT
    account_key, worker_id, week_label, line_code,
    hours_regular, hours_overtime, hours_double_time, hours_premium_other,
    dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other,
    amount, hours_without_dollars,
    week_start, week_end, fiscal_year, period_no, week_source,
    segment_count, entry_count, coverage_state,
    -- v42-2: expose the five V42 columns to the API layer.
    draft_entry_count, draft_hours,
    anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h,
    derived_at, source_run, source
  FROM public.labor_actuals;

GRANT SELECT ON public.labor_actuals_latest TO service_role;


-- ─── Step 4: self-test B - both coverages GREEN post-rebind ────────
DO $$
DECLARE
  view_cov RECORD;
  rpc_cov  RECORD;
BEGIN
  SELECT * INTO view_cov FROM labor_actuals_coverage() WHERE subject = 'view_select';
  IF NOT view_cov.pass THEN
    RAISE EXCEPTION 'v42-2 self-test B FAILED: rebound view still drops columns: %', view_cov.missing_columns;
  END IF;
  IF view_cov.extra_columns IS NOT NULL AND array_length(view_cov.extra_columns, 1) IS NOT NULL AND array_length(view_cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v42-2 self-test B FAILED: rebound view has typo/dropped-column extras: %', view_cov.extra_columns;
  END IF;

  SELECT * INTO rpc_cov FROM labor_actuals_coverage() WHERE subject = 'rpc_insert';
  IF NOT rpc_cov.pass THEN
    RAISE EXCEPTION 'v42-2 self-test B FAILED: RPC coverage regressed: %', rpc_cov.missing_columns;
  END IF;

  RAISE NOTICE 'v42-2 self-test B OK: view + RPC both cover all % writable columns, zero extras', view_cov.actual_col_count;
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
-- coverage probe:     <PASS | FAIL - result of _probe_labor_rpc_coverage.mjs>
-- notes:              <optional - anything that needed manual attention>
