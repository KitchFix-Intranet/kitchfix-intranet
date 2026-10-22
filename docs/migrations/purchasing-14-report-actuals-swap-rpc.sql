-- purchasing-14-report-actuals-swap-rpc.sql
--
-- Stage 2 cutover support. One PL/pgSQL function that performs the
-- above-floor DELETE + INSERT for the report-based card feed in a
-- single transaction. Owner ruling 2026-10-22: the live current period
-- must not be left empty by a half-completed loader run. A function
-- runs inside one implicit transaction; a RAISE inside the INSERT
-- rolls back the preceding DELETE, so a partial failure leaves the
-- pre-run state exactly intact.
--
-- Scope rules:
--   - Only purchasing_actuals (source='rippling_spend') rows with
--     txn_date >= p_floor are touched. Pre-floor rows (closed Finance
--     periods, pre-cutover API-walk history) are NEVER touched.
--   - DELETE uses the same scope key the loader scopes to; no row
--     outside that window can be affected by this RPC.
--   - INSERT uses jsonb_to_recordset so the loader passes a JSON
--     array of row shapes and the function unpacks them.
--
-- Idempotency: callers passing the same rows produce the same post-
-- state (count + sums). Delete scope is deterministic from (source,
-- date floor). Insert is deterministic from the passed array.
--
-- Return: integer count of rows inserted. Delete count is NOT
-- returned - the caller computes it from the pre-write state the
-- loader already snapshots.
--
-- SECURITY DEFINER so service_role (which lacks TRUNCATE and lacks
-- UPDATE on purchasing_actuals) can execute an atomic DELETE+INSERT
-- through this one entry point. The function's SET search_path pins
-- the lookup so a search-path hijack cannot reroute.
--
-- Apply discipline per CLAUDE.md: Kevin applies in Studio before the
-- PR flips out of draft. Idempotent on re-apply (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION swap_card_actuals_above_floor(
  p_floor   DATE,
  p_rows    JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  IF p_floor IS NULL THEN
    RAISE EXCEPTION 'swap_card_actuals_above_floor: p_floor is NULL';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'swap_card_actuals_above_floor: p_rows must be a JSON array (got %)', jsonb_typeof(p_rows);
  END IF;

  -- Hard-floor guard. Closed Finance periods (P10 and earlier for
  -- FY2026, pre-cutover API-walk history) must never be reachable by
  -- this function, no matter what the caller passes. Any caller
  -- attempt to lower the floor fails loudly here before DELETE runs.
  IF p_floor < DATE '2026-10-05' THEN
    RAISE EXCEPTION 'swap_card_actuals_above_floor: floor below cutover: %', p_floor;
  END IF;

  -- Empty-set guard. An empty insert set (a broken/partial nightly
  -- report, or a genuinely quiet period) must not delete the current
  -- period and leave it empty. Refuse to touch anything and return 0;
  -- the loader logs the empty set loudly.
  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  -- Delete the above-floor set. Pre-floor rows stay intact by the
  -- WHERE clause; the hard-floor guard above enforces the same
  -- invariant for any adversarial p_floor the caller might pass.
  DELETE FROM purchasing_actuals
   WHERE source = 'rippling_spend'
     AND txn_date >= p_floor;

  -- Insert the new above-floor set from the JSON array. Any INSERT
  -- failure (NOT NULL violation, UNIQUE constraint, check-constraint
  -- violation) raises an exception which rolls the whole function
  -- (DELETE included) back to the pre-call state.
  --
  -- derived_at is set explicitly to NOW() so every inserted row
  -- carries this run's write timestamp. The verify probe keys on
  -- (txn_date < floor AND derived_at >= today) to detect any pre-
  -- floor row that was touched today; explicit NOW() here makes the
  -- post-run assertion straightforward.
  INSERT INTO purchasing_actuals (
    source, source_bill_id, source_line_id,
    account_key, excluded,
    gl_line_code, gl_bucket,
    txn_date, posting_date,
    amount, vendor_or_merchant, paid, approx_date,
    reconcile_status, employee_name, employee_id,
    has_receipt, memo,
    derived_at
  )
  SELECT
    (r->>'source')::TEXT,
    NULLIF(r->>'source_bill_id', '')::TEXT,
    (r->>'source_line_id')::TEXT,
    NULLIF(r->>'account_key', '')::TEXT,
    COALESCE((r->>'excluded')::BOOLEAN, FALSE),
    NULLIF(r->>'gl_line_code', '')::TEXT,
    NULLIF(r->>'gl_bucket', '')::TEXT,
    NULLIF(r->>'txn_date', '')::DATE,
    NULLIF(r->>'posting_date', '')::DATE,
    (r->>'amount')::NUMERIC(14, 2),
    NULLIF(r->>'vendor_or_merchant', '')::TEXT,
    COALESCE((r->>'paid')::BOOLEAN, FALSE),
    COALESCE((r->>'approx_date')::BOOLEAN, FALSE),
    NULLIF(r->>'reconcile_status', '')::TEXT,
    NULLIF(r->>'employee_name', '')::TEXT,
    NULLIF(r->>'employee_id', '')::TEXT,
    CASE WHEN r ? 'has_receipt' AND r->>'has_receipt' IS NOT NULL
         THEN (r->>'has_receipt')::BOOLEAN ELSE NULL END,
    NULLIF(r->>'memo', '')::TEXT,
    NOW()
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION swap_card_actuals_above_floor(DATE, JSONB) TO service_role;

COMMENT ON FUNCTION swap_card_actuals_above_floor(DATE, JSONB) IS
  'Stage 2 cutover (2026-10-22). Atomic DELETE+INSERT for '
  'purchasing_actuals rows where source=''rippling_spend'' AND '
  'txn_date >= p_floor. Two engine-side guards: hard-floor RAISEs if '
  'p_floor is below the 2026-10-05 cutover so closed Finance history '
  'can never be deleted regardless of caller input; empty-set '
  'RETURNs 0 without touching anything if p_rows is an empty array '
  'so a broken/partial nightly report cannot leave the current '
  'period empty. A partial INSERT failure rolls back the DELETE so '
  'the current period cannot be left in an inconsistent state. '
  'derived_at is set to NOW() per row for the verify probe''s pre-'
  'floor-touched check.';

COMMIT;


-- ═════════════════════════════════════════════════════════════════
-- Verify (run after apply)
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Function exists and is EXECUTE-grantable to service_role:
--
--      SELECT proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
--      FROM   pg_proc p
--      JOIN   pg_namespace n ON p.pronamespace = n.oid
--      WHERE  n.nspname = 'public'
--        AND  p.proname = 'swap_card_actuals_above_floor';
--
-- 2. Grant landed:
--
--      SELECT grantee, privilege_type
--      FROM   information_schema.role_routine_grants
--      WHERE  routine_schema = 'public'
--        AND  routine_name   = 'swap_card_actuals_above_floor';
--
-- 3. Smoke the atomic rollback: call with a malformed row and
--    confirm pre-floor count + sum are unchanged. (The loader runs
--    this check on every live invocation; this one-off is manual.)
