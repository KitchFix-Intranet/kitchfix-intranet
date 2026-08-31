-- ═══════════════════════════════════════════════════════════════════
-- academy-8-person-id-backfill.sql
--
-- One RPC that fills missing academy_requirements.person_id values
-- by joining to academy_person_stints. Idempotent: only touches
-- rows where person_id IS NULL, so re-runs after the derive
-- extension catches up will progressively drain the drift.
--
-- WHY
-- ────
-- Cycle 2 published 8 requirements with NULL person_id. Root cause
-- was an unpaginated .select() in the JS loader hitting Supabase's
-- silent 1000-row cap on academy_person_stints (1,129 rows), so the
-- stint-map lookup returned undefined for Kevin's worker_id and the
-- planner emitted NULL. Pagination fix ships with this PR (see
-- src/lib/academy/requirements.js). This migration is the belt-
-- and-braces reconciliation: an RPC to fix rows that shipped
-- before the pagination fix (the 8 today) AND to reconcile any
-- future drift when the derive extension ships and stint rows
-- arrive after the requirements they should have populated.
--
-- Function authored
-- ─────────────────
--   backfill_requirement_person_ids() RETURNS INT
--
-- Behaviour
-- ─────────
--   UPDATE academy_requirements r
--      SET person_id = s.person_id
--     FROM academy_person_stints s
--    WHERE r.worker_id = s.worker_id
--      AND r.person_id IS NULL
--      AND s.person_id IS NOT NULL;
--
--   Returns rows_updated (INT). Idempotent: subsequent calls with
--   no drift return 0.
--
-- Does NOT touch
-- ──────────────
-- Every other column on academy_requirements. doc_id,
-- obligation_key, doc_version, est_minutes, source, cycle_id,
-- due_date, issued_at, issued_by, waived_* - all preserved. This
-- is filling a field that should have been set at issuance time,
-- not rewriting history.
--
-- SECURITY / GRANTS
-- ─────────────────
-- LANGUAGE plpgsql, default SECURITY INVOKER (same posture as the
-- other academy RPCs). GRANT EXECUTE TO service_role so the CLI +
-- app-code paths can call it; PUBLIC picks up the default EXECUTE
-- grant harmlessly (SECURITY INVOKER + service_role owns the
-- required table UPDATE grant).
--
-- The write is targeted: `WHERE r.person_id IS NULL` means a
-- runaway call cannot damage rows that already have a person_id.
-- The join ensures we only touch rows whose worker_id resolves to
-- a stint - orphans stay NULL until the stint arrives.
--
-- APPLY DISCIPLINE
-- ────────────────
-- Standard. Author only; Kevin applies in Studio. The
-- migration-gate check fails until Kevin comments
-- `applied in Studio: YES`.
--
-- MANDATORY EXECUTION PROBE
-- ─────────────────────────
-- P3 is a MANDATORY end-to-end execution probe. It:
--   1. Creates a probe requirement with person_id=NULL against a
--      known worker_id that has a stint row (Kevin).
--   2. Runs backfill_requirement_person_ids().
--   3. Asserts the RETURNED count is 1.
--   4. **ADDITIONALLY asserts the ROW's person_id is now the
--      expected UUID** (the check that would have caught cycle 2's
--      defect: return-shape verification is not sufficient for a
--      function whose job is writing rows). Per the academy-7
--      review's template extension: "A function whose job is
--      writing rows should have its probe assert the shape of what
--      landed, not only what the function returned."
--   5. ROLLBACK.
--
-- If any assertion fails, the apply IS NOT complete regardless of
-- whether P1/P2 (existence + grants) passed. Do not post
-- `applied in Studio: YES` until P3 prints PROBE OK.
-- ═══════════════════════════════════════════════════════════════════


CREATE OR REPLACE FUNCTION backfill_requirement_person_ids()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  UPDATE academy_requirements r
     SET person_id = s.person_id
    FROM academy_person_stints s
   WHERE r.worker_id = s.worker_id
     AND r.person_id IS NULL
     AND s.person_id IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_requirement_person_ids() TO service_role;


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   P1 + P2 (existence + grants) are safe on every apply.
--
--   P3 is MANDATORY - it inserts a probe row, calls the RPC,
--   asserts BOTH the returned count AND the row's post-state.
--   Wrapped in BEGIN/ROLLBACK so no state persists.
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. Function exists.
-- Expected: 1 row.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'backfill_requirement_person_ids';

-- P2. service_role has EXECUTE.
-- Expected: 3 rows (postgres / PUBLIC / service_role - same shape
-- as academy-5 / academy-7 for the same reason).
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'backfill_requirement_person_ids'
  AND privilege_type = 'EXECUTE'
ORDER BY grantee;


-- P3. MANDATORY execution + row-shape probe.
--
-- Expected on run: NOTICE "PROBE OK: updated=1 post_person_id=0ba90a26-41c8-4c72-90f8-5db1ff7afb21"
-- The UUID is Kevin's academy_persons.person_id, verified against
-- production at PR authoring time.
BEGIN;

DO $probe$
DECLARE
  v_updated       INT;
  v_post_person   UUID;
  v_expected      UUID := '0ba90a26-41c8-4c72-90f8-5db1ff7afb21';
BEGIN
  -- Insert a probe requirement with person_id=NULL against Kevin's
  -- worker_id. Uses source='onboarding' (matches the CHECK for the
  -- cycle_id-null branch); doc_id/obligation_key deliberately
  -- unique to the probe to avoid colliding with real rows.
  INSERT INTO academy_requirements (
    worker_id,
    person_id,
    doc_id,
    obligation_key,
    doc_version,
    est_minutes,
    source,
    cycle_id,
    due_date,
    issued_by
  ) VALUES (
    '6418e1e52a44e07c8b303f7b',
    NULL,
    'PB-014',
    'academy-8-probe',
    'probe',
    11,
    'onboarding',
    NULL,
    '2026-12-31',
    'probe'
  );

  -- Run the backfill.
  SELECT backfill_requirement_person_ids() INTO v_updated;

  -- ROW-SHAPE assertion (the check that would have caught cycle 2).
  SELECT person_id INTO v_post_person
    FROM academy_requirements
   WHERE worker_id = '6418e1e52a44e07c8b303f7b'
     AND obligation_key = 'academy-8-probe';

  IF v_updated = 1 AND v_post_person = v_expected THEN
    RAISE NOTICE 'PROBE OK: updated=% post_person_id=%', v_updated, v_post_person;
  ELSE
    RAISE EXCEPTION 'PROBE FAIL: expected updated=1 post_person_id=%, got updated=% post_person_id=%',
      v_expected, v_updated, v_post_person;
  END IF;
END
$probe$;

ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying. **Do NOT post
-- `applied in Studio: YES` until P3 has printed PROBE OK.** P1 + P2
-- are not sufficient - the whole point of this migration is that
-- existence + grants passing was what let cycle 2 ship with 8 NULL
-- person_ids.
--
-- After the migration applies AND the probe passes, run the RPC
-- once against production (NOT in a transaction) to fix the 8
-- existing cycle-2 rows:
--
--   SELECT backfill_requirement_person_ids();  -- expected: 8
--
-- Then verify:
--
--   SELECT count(*) FROM academy_requirements
--    WHERE cycle_id = 2 AND person_id IS NULL;  -- expected: 0
--
--   SELECT count(*) FROM academy_requirements r
--     JOIN academy_person_stints s ON s.worker_id = r.worker_id
--    WHERE r.cycle_id = 2
--      AND r.person_id = s.person_id;           -- expected: 8
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- p1_function:        <expected 1 row>
-- p2_grants:          <expected 3 rows: postgres, PUBLIC, service_role>
-- p3_probe:           <expected NOTICE "PROBE OK: updated=1 post_person_id=0ba90a26-41c8-4c72-90f8-5db1ff7afb21">
-- one_time_backfill:  <after apply, run SELECT backfill_requirement_person_ids(); expected 8>
-- post_backfill_null: <expected 0 rows>
-- post_backfill_match: <expected 8 rows>
-- notes:              <optional>
