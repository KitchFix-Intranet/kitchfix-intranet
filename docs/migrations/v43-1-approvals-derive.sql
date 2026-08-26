-- ═══════════════════════════════════════════════════════════════════
-- v43-1-approvals-derive.sql
--
-- Adds three nullable columns to labor_actuals for the Approvals card
-- (renamed from Payroll data). Owner ruling 2026-08-26: the current
-- card mixed two independent things - approval status (DRAFT/APPROVED)
-- and cost status (has-pay-segment / none). Presenting the mix as one
-- signal produced STL - FL "49.1 pending / Not costed 54.08" - a state
-- that reads impossible if either is a subset of the other. This
-- migration lands the schema so the derive can carry the two
-- dimensions separately.
--
-- Why these three columns
-- ───────────────────────
-- The pipeline already tracks the two dimensions in memory during
-- derive; it just did not persist approval-side information beyond
-- draft_hours + draft_entry_count. These three fields complete the
-- four-quadrant model without any new joins:
--
--   approved_hours       NUMERIC - sum of duration on APPROVED entries
--                                  (source: time_entry_summary.duration,
--                                  same field draft_hours uses at
--                                  deriveActuals.js:481)
--   oldest_draft_date    DATE    - MIN(start_time) among DRAFT entries
--                                  in the bucket. NULL when no DRAFT
--                                  entries. Enables the "Oldest shift"
--                                  fact that surfaced STL - FL's 29-day-
--                                  old draft during owner review.
--   still_costing_hours  NUMERIC - sum of duration on APPROVED entries
--                                  with NO matching pay-segment (the
--                                  te -> zo -> segment hop returns
--                                  empty). The "APPROVED but not yet
--                                  costed" box - resolves on its own,
--                                  needs no operator action, but the
--                                  card names it plainly so the reader
--                                  understands where the hours are.
--
-- All three are NULLABLE and default to NULL. Existing rows stay NULL
-- until the next full re-derive populates them. The card's zero-state
-- rule handles that: absent-on-premise-fail (NULL means "we do not
-- know", not "nothing is old" / not green ALL CLEAR).
--
-- Four-box model (probe asserts mutual exclusivity + sum invariant)
-- ─────────────────────────────────────────────────────────────────
--
--                       not costed              costed
--   not approved        still on the clock      WAITING ON YOU
--                       (open punches)          (draft, needs sig)
--   approved            payroll catching up     done
--                       (still_costing_hours)   (approved_hours -
--                                                 still_costing_hours)
--
-- Invariant: draft_hours + approved_hours == sum(all time entries'
-- duration in range). Every time entry is either DRAFT or APPROVED -
-- verified in raw feed 2026-08-26: week 08/24 across all accounts
-- carries exactly two payload.status values.
--
-- Subset invariant: still_costing_hours <= approved_hours (still-
-- costing is a subset of approved, defined only within approved).
--
-- Schema safety
-- ─────────────
-- ALTER TABLE is a metadata change on labor_actuals (~5,000 rows) -
-- completes in seconds, no row rewrite. RPC + view rebind updates
-- the two writable/readable surfaces so v42-1b's silent-truncation
-- class cannot fire on these new columns. Self-tests before AND
-- after each rebind, same pattern that caught v42-1b's trim() bug.
--
-- Apply discipline
-- ────────────────
-- No enclosing transaction. Kevin applies statements sequentially in
-- Supabase Studio; a self-test RAISE EXCEPTION halts THAT step but
-- does NOT undo prior DDL (postgres implicit-commits after each DDL
-- statement in autocommit mode, which Studio uses). The steps are
-- ordered so a mid-file failure leaves the schema in a coherent
-- state at whichever step passed last:
--   after step 1 (ALTER)      - three NULL columns present, view + RPC
--                               still hide/drop them (v42 state,
--                               harmless - the client already tolerates
--                               NULL for the whole v42 column set).
--   after step 2 self-test A  - proves the guards would detect the
--                               real defect. No schema change.
--   after step 3 (RPC rebind) - RPC now writes the three new columns;
--                               view still hides them.
--   after step 4 (view rebind)- view now exposes them; end state.
--   step 5 is the post-rebind self-test.
--
-- 1. Apply each step in order in Supabase Studio's SQL editor. If a
--    self-test raises, fix the underlying issue and rerun from the
--    failing step (do not blindly rerun all steps).
-- 2. After apply, run scripts/derive_labor_actuals.mjs --source=manual
--    once so every existing row picks up the three new columns.
-- 3. Re-run scripts/probes/_probe_labor_rpc_coverage.mjs - RPC and
--    view lines both PASS.
-- 4. PR-body test-plan verifies the Approvals card renders live
--    values on STL - FL / TBR - FL / CIN - OH FYTD.
-- ═══════════════════════════════════════════════════════════════════


-- ─── Step 1: three new columns on labor_actuals ────────────────────
ALTER TABLE labor_actuals
  ADD COLUMN IF NOT EXISTS approved_hours       NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS oldest_draft_date    DATE          NULL,
  ADD COLUMN IF NOT EXISTS still_costing_hours  NUMERIC(10,2) NULL;


-- ─── Step 2: self-test A - both coverages BEFORE rebind ────────────
-- Prove the guard detects the real defect. RPC and view are both
-- expected to be missing exactly the three v43-1 columns (the v42
-- columns are already covered by v42-1b + v42-2).
DO $$
DECLARE
  view_cov    RECORD;
  rpc_cov     RECORD;
  expected TEXT[] := ARRAY[
    'approved_hours',
    'oldest_draft_date',
    'still_costing_hours'
  ];
  got_sorted TEXT[];
BEGIN
  SELECT * INTO view_cov FROM labor_actuals_coverage() WHERE subject = 'view_select';
  SELECT array_agg(c ORDER BY c) INTO got_sorted FROM unnest(coalesce(view_cov.missing_columns, ARRAY[]::TEXT[])) c;
  IF got_sorted IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'v43-1 self-test A FAILED: view missing set = %, expected exactly %. Parser or pre-state is wrong.',
      got_sorted, expected;
  END IF;
  IF view_cov.extra_columns IS NOT NULL AND array_length(view_cov.extra_columns, 1) IS NOT NULL AND array_length(view_cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v43-1 self-test A FAILED: view has unexpected extras = %', view_cov.extra_columns;
  END IF;

  SELECT * INTO rpc_cov FROM labor_actuals_coverage() WHERE subject = 'rpc_insert';
  SELECT array_agg(c ORDER BY c) INTO got_sorted FROM unnest(coalesce(rpc_cov.missing_columns, ARRAY[]::TEXT[])) c;
  IF got_sorted IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'v43-1 self-test A FAILED: RPC missing set = %, expected exactly %. Parser or pre-state is wrong.',
      got_sorted, expected;
  END IF;
  IF rpc_cov.extra_columns IS NOT NULL AND array_length(rpc_cov.extra_columns, 1) IS NOT NULL AND array_length(rpc_cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v43-1 self-test A FAILED: RPC has unexpected extras = %', rpc_cov.extra_columns;
  END IF;

  RAISE NOTICE 'v43-1 self-test A OK: view + RPC each missing exactly the three v43-1 columns, zero extras. Guards detect the real defect.';
END $$;


-- ─── Step 3: rebind the RPC ─────────────────────────────────────────
-- CREATE OR REPLACE the swap RPC with the three new columns added to
-- the INSERT column list + SELECT extractions. Byte-identical to
-- v42-1b except for those additions.
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
    approved_hours, oldest_draft_date, still_costing_hours,
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
    -- v42-1b V42 columns.
    NULLIF((r->>'draft_entry_count'),   '')::INTEGER,
    NULLIF((r->>'draft_hours'),         '')::NUMERIC,
    NULLIF((r->>'anomaly_no_clockout'), '')::INTEGER,
    NULLIF((r->>'anomaly_under_1h'),    '')::INTEGER,
    NULLIF((r->>'anomaly_over_16h'),    '')::INTEGER,
    -- v43-1 approval + oldest-draft + still-costing columns. NULL-safe
    -- for pre-derive rows or payloads that omit them; the derive JS
    -- writes numbers for approved_hours + still_costing_hours whenever
    -- it runs, and a date OR NULL for oldest_draft_date (NULL when no
    -- DRAFT entries land in the bucket - the correct "we do not know
    -- an oldest" state, not zero).
    NULLIF((r->>'approved_hours'),      '')::NUMERIC,
    NULLIF((r->>'oldest_draft_date'),   '')::DATE,
    NULLIF((r->>'still_costing_hours'), '')::NUMERIC,
    NOW(),
    p_source_run,
    'api'
  FROM jsonb_array_elements(p_actuals) r;
  GET DIAGNOSTICS a_count = ROW_COUNT;

  RETURN a_count;
END $$;

GRANT EXECUTE ON FUNCTION public.swap_labor_actuals_for_account(TEXT, JSONB, TEXT) TO service_role;


-- ─── Step 4: rebind the view ────────────────────────────────────────
-- ⚠ APPLY THE DROP + CREATE TOGETHER. Between the DROP and the CREATE
-- there is no labor_actuals_latest view; any read from that surface
-- returns an error and the deployed labor board renders blank until
-- CREATE lands. Paste both statements together into a single query
-- run (Studio treats a single query submission atomically for DDL
-- purposes in the sense that no other session sees the intermediate
-- state longer than the query takes to execute). CREATE OR REPLACE is
-- NOT usable here - the new columns sit BEFORE derived_at so the
-- column order changes, and CREATE OR REPLACE forbids column-order
-- changes on views.
DROP VIEW IF EXISTS public.labor_actuals_latest;
CREATE VIEW public.labor_actuals_latest AS
  SELECT
    account_key, worker_id, week_label, line_code,
    hours_regular, hours_overtime, hours_double_time, hours_premium_other,
    dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other,
    amount, hours_without_dollars,
    week_start, week_end, fiscal_year, period_no, week_source,
    segment_count, entry_count, coverage_state,
    draft_entry_count, draft_hours,
    anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h,
    -- v43-1: expose the three approval-side columns to the API layer.
    approved_hours, oldest_draft_date, still_costing_hours,
    derived_at, source_run, source
  FROM public.labor_actuals;

GRANT SELECT ON public.labor_actuals_latest TO service_role;


-- ─── Step 5: self-test B - both coverages GREEN post-rebind ────────
DO $$
DECLARE
  view_cov  RECORD;
  rpc_cov   RECORD;
BEGIN
  -- Structural check: RPC signature intact.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'swap_labor_actuals_for_account'
      AND pg_get_function_arguments(p.oid) = 'p_account_key text, p_actuals jsonb, p_source_run text'
  ) THEN
    RAISE EXCEPTION 'v43-1 self-test B FAILED: swap_labor_actuals_for_account(text, jsonb, text) not found';
  END IF;

  SELECT * INTO view_cov FROM labor_actuals_coverage() WHERE subject = 'view_select';
  IF NOT view_cov.pass THEN
    RAISE EXCEPTION 'v43-1 self-test B FAILED: rebound view still hides columns: %', view_cov.missing_columns;
  END IF;
  IF view_cov.extra_columns IS NOT NULL AND array_length(view_cov.extra_columns, 1) IS NOT NULL AND array_length(view_cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v43-1 self-test B FAILED: rebound view has typo/dropped-column extras: %', view_cov.extra_columns;
  END IF;

  SELECT * INTO rpc_cov FROM labor_actuals_coverage() WHERE subject = 'rpc_insert';
  IF NOT rpc_cov.pass THEN
    RAISE EXCEPTION 'v43-1 self-test B FAILED: rebound RPC still drops columns: %', rpc_cov.missing_columns;
  END IF;
  IF rpc_cov.extra_columns IS NOT NULL AND array_length(rpc_cov.extra_columns, 1) IS NOT NULL AND array_length(rpc_cov.extra_columns, 1) > 0 THEN
    RAISE EXCEPTION 'v43-1 self-test B FAILED: rebound RPC has typo/dropped-column extras: %', rpc_cov.extra_columns;
  END IF;

  RAISE NOTICE 'v43-1 self-test B OK: view + RPC both cover all % writable columns, zero extras.', view_cov.actual_col_count;
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
-- coverage probe:     <PASS | FAIL - result of _probe_labor_rpc_coverage.mjs>
-- notes:              <optional - anything that needed manual attention>
