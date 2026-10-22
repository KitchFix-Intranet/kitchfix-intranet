-- purchasing-15-card-coding-backfill-rpc.sql
--
-- One-time P10 card-coding backfill support. Pairs with
-- scripts/purchasing_p10_card_coding_backfill.mjs. Owner ruling
-- 2026-10-22: P10 card rows in purchasing_actuals are frozen uncoded
-- (the old API feed's last write landed before P10 close); the charges
-- were coded in Rippling afterwards and the report feed carries the
-- current coding. The nightly swap_card_actuals_above_floor RPC
-- deliberately refuses to touch P10 (hard floor >= 2026-10-05), so
-- this one-off correction needs a parallel entry point with its own
-- hard scope.
--
-- Scope rules (all enforced in the WHERE clause so a bad id passed by
-- the caller cannot escape the window):
--   - Only purchasing_actuals rows WHERE source='rippling_spend'.
--   - Only rows WHERE gl_line_code IS NULL (already-coded rows are
--     never re-coded).
--   - Only rows WHERE excluded = FALSE. The 2026-10-22 narrowing:
--     excluded rows are hidden from the detail (paginateActuals reads
--     excluded = FALSE), so re-coding them changes nothing a user
--     sees. 765 of 833 P10 uncoded card rows were excluded; this
--     filter puts them firmly out of reach even if a caller passes
--     their ids.
--   - Only rows WHERE txn_date BETWEEN 2026-09-07 AND 2026-10-04
--     (P10, FY2026). Any row outside this window - including every
--     above-floor row the nightly swap owns, and every pre-cutover
--     row older than P10 - is unreachable from this function.
--
-- Idempotency: a second run updates 0 rows (gl_line_code IS NULL no
-- longer holds). Safe to re-run; refusing to re-code a row that is
-- already coded is the right default here.
--
-- Fields updated:
--   gl_line_code, gl_bucket, excluded, derived_at.
--
-- Fields explicitly NOT updated (preserved from the existing row):
--   amount, source_bill_id, source_line_id, txn_date, posting_date,
--   vendor_or_merchant, account_key, employee_name, employee_id,
--   has_receipt, memo, reconcile_status, paid, approx_date, id.
--   Row identity is unchanged; this is a correction stamp, not a
--   delete+insert.
--
-- The excluded-shape CHECK on purchasing_actuals
-- (NOT (excluded = TRUE AND account_key IS NOT NULL)) is NOT handled
-- here. The caller is responsible for omitting any row whose new
-- excluded value would violate the invariant against the existing
-- account_key; a row that fails the check raises an exception which
-- rolls back the entire function call (one implicit transaction).
-- The companion script filters those rows out of the apply set and
-- surfaces them in the dry-run for a separate ruling, so this
-- function never sees one in practice. The RAISE on an unexpected
-- violation is the belt-and-suspenders guard.
--
-- Return: integer count of rows actually updated.
--
-- SECURITY DEFINER so service_role (which lacks UPDATE on
-- purchasing_actuals directly) can run the correction through this
-- one entry point. SET search_path pins the lookup so a search-path
-- hijack cannot reroute.
--
-- Apply discipline per CLAUDE.md: Kevin applies in Studio before the
-- PR flips out of draft. Idempotent on re-apply (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION apply_card_coding_backfill(
  p_rows JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_row     INTEGER;
  r         JSONB;
  v_id      BIGINT;
  v_gl      TEXT;
  v_bucket  TEXT;
  v_excl    BOOLEAN;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'apply_card_coding_backfill: p_rows must be a JSON array (got %)', jsonb_typeof(p_rows);
  END IF;

  -- Empty-set guard. A dry-run that produces no apply set means the
  -- backfill has nothing to do; refuse to iterate and return 0 rather
  -- than silently reporting success.
  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_id     := (r->>'id')::BIGINT;
    v_gl     := NULLIF(r->>'gl_line_code', '');
    v_bucket := NULLIF(r->>'gl_bucket', '');
    v_excl   := COALESCE((r->>'excluded')::BOOLEAN, FALSE);

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'apply_card_coding_backfill: row with NULL id in p_rows';
    END IF;

    UPDATE purchasing_actuals
       SET gl_line_code = v_gl,
           gl_bucket    = v_bucket,
           excluded     = v_excl,
           derived_at   = NOW()
     WHERE id = v_id
       AND source = 'rippling_spend'
       AND gl_line_code IS NULL
       AND excluded = FALSE
       AND txn_date BETWEEN DATE '2026-09-07' AND DATE '2026-10-04';

    GET DIAGNOSTICS v_row = ROW_COUNT;
    v_updated := v_updated + v_row;
  END LOOP;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_card_coding_backfill(JSONB) TO service_role;

COMMENT ON FUNCTION apply_card_coding_backfill(JSONB) IS
  'One-time P10 card-coding backfill (2026-10-22). Updates '
  'gl_line_code, gl_bucket, excluded, derived_at on '
  'purchasing_actuals rows where source=''rippling_spend'' AND '
  'gl_line_code IS NULL AND excluded = FALSE AND txn_date BETWEEN '
  '2026-09-07 AND 2026-10-04. The WHERE clause is the hard scope '
  'guard - a bad id in p_rows cannot touch any row outside P10, any '
  'non-card row, any already-coded row, or any excluded row. '
  'Idempotent on re-run (gl_line_code IS NULL no longer holds after '
  'the first run). Companion to swap_card_actuals_above_floor; the '
  'two RPCs have disjoint txn_date scopes.';

COMMIT;


-- ═════════════════════════════════════════════════════════════════
-- Verify (run after apply)
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Function exists:
--
--      SELECT proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
--      FROM   pg_proc p
--      JOIN   pg_namespace n ON p.pronamespace = n.oid
--      WHERE  n.nspname = 'public'
--        AND  p.proname = 'apply_card_coding_backfill';
--
-- 2. Grant landed:
--
--      SELECT grantee, privilege_type
--      FROM   information_schema.role_routine_grants
--      WHERE  routine_schema = 'public'
--        AND  routine_name   = 'apply_card_coding_backfill';
--
-- 3. Dry-smoke: pass an empty array and confirm it returns 0 without
--    error, and the P10 uncoded-card count is unchanged.
--
--      SELECT apply_card_coding_backfill('[]'::jsonb);
