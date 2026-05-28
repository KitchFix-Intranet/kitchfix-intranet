-- ═══════════════════════════════════════════════════════════════
-- PR 5.3 - Project 3 Module 5: Vendor merge atomicity
-- ═══════════════════════════════════════════════════════════════
--
-- Creates the merge_vendors PL/pgSQL function that wraps the 3-step
-- vendor merge in a single atomic transaction. Replaces PR 5.1's
-- sequential 3-statement mergeVendorsPostgres adapter.
--
-- Atomicity semantics:
--   PL/pgSQL functions run inside an implicit transaction. All three
--   side-effects (accounts reassign + vendors soft-delete + aliases
--   insert) either all commit or all roll back. Partial failures
--   leave the database in the pre-function state.
--
-- Call site:
--   supabase.rpc("merge_vendors", {
--     p_keeper_id: "ABC-123",
--     p_dupe_ids:  ["XYZ-456", "DEF-789"],
--     p_email:     "k.fietek@kitchfix.com",
--   });
--
--   Returns JSON: { accounts_reassigned, vendors_deleted, dupe_names }
--
-- Idempotent: CREATE OR REPLACE allows the file to be re-applied on
-- DDL drift or schema-side iterations without manual DROP FUNCTION.

CREATE OR REPLACE FUNCTION merge_vendors(
  p_keeper_id  text,
  p_dupe_ids   text[],
  p_email      text
) RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_accounts_reassigned int := 0;
  v_vendors_deleted     int := 0;
  v_dupe_names          text[] := ARRAY[]::text[];
BEGIN
  -- 1. Read dupe names BEFORE soft-delete so the alias insert in
  --    step 3 has the names available.
  SELECT array_agg(name)
    INTO v_dupe_names
    FROM vendors
    WHERE id = ANY(p_dupe_ids)
      AND name IS NOT NULL
      AND name <> '';

  IF v_dupe_names IS NULL THEN
    v_dupe_names := ARRAY[]::text[];
  END IF;

  -- 2. Reassign vendor_accounts from dupes to keeper.
  UPDATE vendor_accounts
    SET vendor_id = p_keeper_id
    WHERE vendor_id = ANY(p_dupe_ids);
  GET DIAGNOSTICS v_accounts_reassigned = ROW_COUNT;

  -- 3. Soft-delete the dupe vendor rows.
  UPDATE vendors
    SET deleted_at = now()
    WHERE id = ANY(p_dupe_ids)
      AND deleted_at IS NULL;
  GET DIAGNOSTICS v_vendors_deleted = ROW_COUNT;

  -- 4. Insert dupe names as aliases on the keeper. ON CONFLICT DO
  --    NOTHING (vendor_id, alias_normalized) is race-safe and re-run
  --    safe: if a dupe name already exists as an alias on the keeper,
  --    skip it rather than erroring.
  IF array_length(v_dupe_names, 1) IS NOT NULL THEN
    INSERT INTO vendor_aliases (vendor_id, alias_text, source, learned_by)
    SELECT p_keeper_id, dn, 'merge', p_email
      FROM unnest(v_dupe_names) AS t(dn)
    ON CONFLICT (vendor_id, alias_normalized) DO NOTHING;
  END IF;

  RETURN json_build_object(
    'accounts_reassigned', v_accounts_reassigned,
    'vendors_deleted',     v_vendors_deleted,
    'dupe_names',          to_jsonb(v_dupe_names)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- GRANT: required for supabase.rpc("merge_vendors", ...) to work
-- ─────────────────────────────────────────────────────────────
-- Without this, supabase-js calls fail with "permission denied for
-- function merge_vendors" the same way unGRANTed tables failed in
-- PR 5.1. service_role gets EXECUTE; anon/authenticated do NOT
-- because vendor merge requires the OPS_LEADERSHIP gate which the
-- application layer enforces via the service-role-only RPC path.

GRANT EXECUTE ON FUNCTION merge_vendors(text, text[], text) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- Post-DDL verification (run manually after applying)
-- ─────────────────────────────────────────────────────────────
-- 1. Function exists:
--      SELECT proname, pronargs FROM pg_proc WHERE proname = 'merge_vendors';
--      -- expect 1 row, pronargs = 3
--
-- 2. service_role has EXECUTE:
--      SELECT grantee, privilege_type
--        FROM information_schema.routine_privileges
--        WHERE routine_name = 'merge_vendors';
--      -- expect at least 1 row with grantee = 'service_role' and
--      --   privilege_type = 'EXECUTE'
--
-- 3. End-to-end atomicity test:
--      node --env-file=.env.local scripts/verify-pr-5-3-merge-atomicity.mjs
--      -- expect ALL CHECKS PASSED, exit 0
