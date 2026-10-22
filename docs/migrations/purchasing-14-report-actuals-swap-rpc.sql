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

  -- Delete the above-floor set. Pre-floor rows stay intact by the
  -- WHERE clause; nothing in this function can touch them.
  DELETE FROM purchasing_actuals
   WHERE source = 'rippling_spend'
     AND txn_date >= p_floor;

  -- Insert the new above-floor set from the JSON array. Any INSERT
  -- failure (NOT NULL violation, UNIQUE constraint, check-constraint
  -- violation) raises an exception which rolls the whole function
  -- (DELETE included) back to the pre-call state.
  INSERT INTO purchasing_actuals (
    source, source_bill_id, source_line_id,
    account_key, excluded,
    gl_line_code, gl_bucket,
    txn_date, posting_date,
    amount, vendor_or_merchant, paid, approx_date,
    reconcile_status, employee_name, employee_id,
    has_receipt, memo
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
    NULLIF(r->>'memo', '')::TEXT
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION swap_card_actuals_above_floor(DATE, JSONB) TO service_role;

COMMENT ON FUNCTION swap_card_actuals_above_floor(DATE, JSONB) IS
  'Stage 2 cutover (2026-10-22). Atomic DELETE+INSERT for '
  'purchasing_actuals rows where source=''rippling_spend'' AND '
  'txn_date >= p_floor. Pre-floor rows never touched. A partial '
  'INSERT failure rolls back the DELETE so the current period '
  'cannot be left empty.';

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
