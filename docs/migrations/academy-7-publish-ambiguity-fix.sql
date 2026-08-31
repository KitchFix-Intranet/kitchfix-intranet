-- ═══════════════════════════════════════════════════════════════════
-- academy-7-publish-ambiguity-fix.sql
--
-- CREATE OR REPLACE only. No schema change, no new objects.
--
-- WHY
-- ────
-- publish_cycle_atomic (academy-5) failed at first real execution
-- with `42702 column reference "cycle_id" is ambiguous`. Root
-- cause: the function's RETURNS TABLE (cycle_id BIGINT, ...) clause
-- creates an implicit plpgsql OUT parameter named `cycle_id`, and
-- the INSERT's ON CONFLICT clause referenced `COALESCE(cycle_id,
-- -1)` unqualified. PostgreSQL 15+ (production is 17.6) refuses to
-- guess between the OUT parameter and the target column and raises
-- at execute time - CREATE OR REPLACE succeeded, P1/P2 verified
-- existence + grants, but the first end-to-end call tripped it.
--
-- FIX (single-site qualification, not a function-wide directive)
-- ─────────────────────────────────────────────────────────────
-- Change ON CONFLICT expression:
--   BEFORE: COALESCE(cycle_id, -1)
--   AFTER:  COALESCE(academy_requirements.cycle_id, -1)
--
-- Every other cycle_id reference in the body is already qualified
-- (academy_cycles.cycle_id) or uses the parameter (p_cycle_id).
-- Only this one site was ambiguous.
--
-- WHY QUALIFICATION AND NOT `#variable_conflict use_column`
-- ─────────────────────────────────────────────────────────
-- archive_document in pr-7-7 uses `#variable_conflict use_column`
-- because it has multiple collisions across its body. This function
-- has exactly one. A function-wide directive that silently prefers
-- the column over the OUT parameter would create a latent trap for
-- any future reference intending the OUT parameter - solving a
-- single-site bug with whole-function-wide silence is out of
-- proportion. Qualification is self-documenting at the point of
-- use and does not change behaviour anywhere else in the body.
--
-- The comment above the fixed clause names the failure mode so
-- nobody un-qualifies it during a tidy-up.
--
-- WHAT ABOUT insert_requirements_bulk?
-- ─────────────────────────────────────
-- Reasoned + PROVEN. insert_requirements_bulk RETURNS INT (no named
-- OUT parameter, therefore no implicit `cycle_id` in the plpgsql
-- variable namespace). The recordset alias `x(... cycle_id BIGINT,
-- ...)` is not in scope inside ON CONFLICT's target-column
-- expression (ON CONFLICT infers against the TARGET table's
-- columns), so `cycle_id` there unambiguously means
-- academy_requirements.cycle_id. Empirically verified by executing
-- the function end-to-end against production in a BEGIN/ROLLBACK
-- probe (see PR body): 'onboarding' source with one row inserts 1,
-- second call skips 0. No 42702, no error. No change needed to
-- insert_requirements_bulk.
--
-- APPLY DISCIPLINE
-- ────────────────
-- Same as prior academy migrations. Author-only; Kevin applies in
-- Studio. The migration-gate check fails until Kevin comments
-- `applied in Studio: YES`.
--
-- MANDATORY vs COMMENTED probes
-- ─────────────────────────────
-- Every prior function migration in this family had P3/P4/P5
-- probes commented out as "run deliberately." This one is
-- different: the P3 execution probe is MANDATORY (not commented)
-- because that is exactly the class of check that would have
-- caught 42702 before it ever left the migration file. Kevin
-- pastes the whole verify block; if the probe raises or the
-- assertion prints anything other than the expected value, the
-- apply is NOT complete and `applied in Studio: YES` must not be
-- posted until it is. Attestation footer carries the expected
-- values so future audits can spot a skipped probe.
-- ═══════════════════════════════════════════════════════════════════


-- ─── publish_cycle_atomic (CREATE OR REPLACE with the fix) ─────────
-- Identical body to academy-5's definition except for the ON
-- CONFLICT qualification on line 78 below.
CREATE OR REPLACE FUNCTION publish_cycle_atomic(
  p_cycle_id      BIGINT,
  p_published_by  TEXT,
  p_rows          JSONB
)
RETURNS TABLE (
  cycle_id                BIGINT,
  new_status              TEXT,
  published_at            TIMESTAMPTZ,
  requirements_inserted   INT,
  requirements_skipped    INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_status TEXT;
  v_row_count      INT := 0;
  v_planned        INT;
  v_now            TIMESTAMPTZ := NOW();
BEGIN
  -- Refuse an empty publisher name up front.
  IF p_published_by IS NULL OR btrim(p_published_by) = '' THEN
    RAISE EXCEPTION 'publish_cycle_atomic: refused - p_published_by is null or empty';
  END IF;

  -- Refuse a null input array. An empty array is legal (see header).
  IF p_rows IS NULL THEN
    RAISE EXCEPTION 'publish_cycle_atomic: refused - p_rows is null; pass an empty array to publish a cycle with zero eligible people';
  END IF;
  v_planned := jsonb_array_length(p_rows);

  -- Verify the cycle exists and is in draft.
  SELECT c.status INTO v_current_status
    FROM academy_cycles c
   WHERE c.cycle_id = p_cycle_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publish_cycle_atomic: refused - cycle_id % does not exist', p_cycle_id;
  END IF;
  IF v_current_status <> 'draft' THEN
    RAISE EXCEPTION 'publish_cycle_atomic: refused - cycle_id % is in status "%" (must be draft to publish)', p_cycle_id, v_current_status;
  END IF;

  -- Flip status. Both status and its two stamps land in the same
  -- transaction with the INSERT below, so the CHECK
  -- academy_cycles_published_complete is satisfied atomically.
  UPDATE academy_cycles
     SET status       = 'published',
         published_at = v_now,
         published_by = p_published_by
   WHERE academy_cycles.cycle_id = p_cycle_id;

  -- Insert requirements. ON CONFLICT DO NOTHING against the unique
  -- index academy_requirements_unique_issue so a partial re-run
  -- reports skipped rather than crashing on duplicates.
  --
  -- INDEX INFERENCE, NOT CONSTRAINT NAME. The unique enforcer in
  -- academy-3 is a CREATE UNIQUE INDEX over the expression
  -- COALESCE(cycle_id, -1), which never enters pg_constraint (an
  -- expression cannot be a table constraint in Postgres). ON
  -- CONFLICT ON CONSTRAINT <name> would fail at runtime with
  -- "constraint ... does not exist." The only shape Postgres
  -- accepts here is index inference matching the exact expression
  -- list.
  --
  -- QUALIFICATION IS REQUIRED, NOT STYLISTIC (academy-7 fix):
  -- `COALESCE(cycle_id, -1)` unqualified is ambiguous - `cycle_id`
  -- also names the implicit OUT parameter from RETURNS TABLE above.
  -- Postgres 15+ raises 42702 at EXECUTION time, not at CREATE, so
  -- CREATE OR REPLACE + existence-only probes will never catch it.
  -- Do not un-qualify this expression during a tidy-up: the
  -- academy-7 mandatory probe will refuse the next apply if it
  -- reverts.
  --
  -- The column + expression tuple below MUST stay in lockstep with
  -- academy-3-assignment-layer.sql's academy_requirements_unique_
  -- issue index. If either changes without the other, apply
  -- fails.
  --
  -- source is fixed to 'cycle' here; the CHECK
  -- academy_requirements_cycle_source_has_cycle then requires the
  -- non-null cycle_id, which we supply from the argument.
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
  )
  SELECT
    x.worker_id,
    x.person_id,
    x.doc_id,
    x.obligation_key,
    x.doc_version,
    x.est_minutes,
    'cycle',
    p_cycle_id,
    x.due_date,
    p_published_by
  FROM jsonb_to_recordset(p_rows) AS x(
    worker_id       TEXT,
    person_id       UUID,
    doc_id          TEXT,
    obligation_key  TEXT,
    doc_version     TEXT,
    est_minutes     INTEGER,
    due_date        DATE
  )
  ON CONFLICT (worker_id, doc_id, obligation_key, doc_version, source, COALESCE(academy_requirements.cycle_id, -1))
  DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  RETURN QUERY
    SELECT p_cycle_id,
           'published'::TEXT,
           v_now,
           v_row_count,
           (v_planned - v_row_count);
END;
$$;

-- Grant unchanged from academy-5. Restated defensively.
GRANT EXECUTE ON FUNCTION publish_cycle_atomic(BIGINT, TEXT, JSONB) TO service_role;


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   P1 + P2 (existence + grants) are the same shape as academy-5's
--   verify block. They must pass, but they do not exercise the
--   function body - which is exactly how 42702 slipped through.
--
--   P3 is MANDATORY: an end-to-end execution probe. Kevin runs it
--   AS PART OF THE APPLY. If it raises or the assertion prints
--   anything other than "PROBE OK", the apply is NOT complete;
--   `applied in Studio: YES` MUST NOT be posted until it passes.
--
--   Wrapped in BEGIN/ROLLBACK so no state persists. Uses Kevin's
--   worker_id and PB-014 as FK anchors (both real, both stable).
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. Function exists.
-- Expected: 1 row.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'publish_cycle_atomic';

-- P2. service_role has EXECUTE. Expected 3 rows total per prior
-- convention (postgres / PUBLIC / service_role) - PUBLIC harmless
-- because SECURITY INVOKER, see academy-5 P2 comment.
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'publish_cycle_atomic'
  AND privilege_type = 'EXECUTE'
ORDER BY grantee;


-- P3. MANDATORY execution probe. Runs the fixed function against a
-- throwaway draft cycle with two real rows; asserts the return
-- shape; ROLLBACKs. If this raises 42702 (the bug this migration
-- fixes) the apply IS NOT complete regardless of whether the
-- CREATE OR REPLACE succeeded.
--
-- Expected on run: probe_result = 'PROBE OK: new_status=published inserted=2 skipped=0'
BEGIN;

DO $probe$
DECLARE
  v_cycle_id  BIGINT;
  v_result    RECORD;
  v_rows      JSONB;
BEGIN
  -- Throwaway probe cycle. period_start=Nov 1 to avoid the sept
  -- draft that Kevin has waiting.
  INSERT INTO academy_cycles (label, period_start, period_end, created_by)
  VALUES ('academy-7 probe cycle', '2026-11-01', '2026-11-30', 'probe')
  RETURNING academy_cycles.cycle_id INTO v_cycle_id;

  v_rows := jsonb_build_array(
    jsonb_build_object(
      'worker_id',      '6418e1e52a44e07c8b303f7b',
      'person_id',      NULL,
      'doc_id',         'PB-014',
      'obligation_key', 'probe-a7-1',
      'doc_version',    'probe',
      'est_minutes',    11,
      'due_date',       '2026-11-30'
    ),
    jsonb_build_object(
      'worker_id',      '6418e1e52a44e07c8b303f7b',
      'person_id',      NULL,
      'doc_id',         'AGR-001',
      'obligation_key', 'probe-a7-2',
      'doc_version',    'probe',
      'est_minutes',    12,
      'due_date',       '2026-11-30'
    )
  );

  SELECT * INTO v_result FROM publish_cycle_atomic(v_cycle_id, 'probe@kitchfix.com', v_rows);

  IF v_result.new_status = 'published'
     AND v_result.requirements_inserted = 2
     AND v_result.requirements_skipped  = 0 THEN
    RAISE NOTICE 'PROBE OK: new_status=% inserted=% skipped=%',
      v_result.new_status, v_result.requirements_inserted, v_result.requirements_skipped;
  ELSE
    RAISE EXCEPTION 'PROBE FAIL: expected published/2/0, got %/%/%',
      v_result.new_status, v_result.requirements_inserted, v_result.requirements_skipped;
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
-- Kevin fills in below AFTER applying the file in Studio. The
-- migration-gate check on this PR looks for the phrase
-- `applied in Studio: YES` in a comment from an OWNER account.
-- **Do NOT post that phrase until P3 has printed PROBE OK.**
-- P1 + P2 alone are not sufficient - the whole point of this
-- migration is that existence + grants passed while the body
-- was broken.
--
-- applied in Studio: PENDING
-- sha:               <fill in commit SHA>
-- applied by:        k.fietek@kitchfix.com
-- applied at:        <fill in ISO timestamp>
-- p1_function:       <expected 1 row>
-- p2_grants:         <expected 3 rows: postgres, PUBLIC, service_role>
-- p3_probe:          <expected NOTICE "PROBE OK: new_status=published inserted=2 skipped=0">
-- notes:             <optional>
