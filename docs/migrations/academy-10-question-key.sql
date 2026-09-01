-- ═══════════════════════════════════════════════════════════════════
-- academy-10-question-key.sql
--
-- Migration 5 in the academy_* series. DDL only.
--
-- What lands
-- ──────────
--   ALTER TABLE academy_questions
--     ADD COLUMN question_key TEXT NOT NULL;
--   CREATE UNIQUE INDEX academy_questions_unique_key
--     ON academy_questions (doc_id, obligation_key, doc_version, question_key);
--
-- Why
-- ───
-- academy_questions has no natural unique key today. Re-running a seed
-- would duplicate every row and there is no shape available for
-- "correct the question I authored last week" other than "insert
-- another one and hope operators pick the right question_id somehow."
-- That is the same defect class the obligations `key` field closes:
-- without a stable identifier, a question can only ever be inserted,
-- never corrected. See spec Section 8; obligation `key` in
-- content/schema/frontmatter.schema.json.
--
-- Empty-table safety
-- ──────────────────
-- academy_questions holds ZERO rows as of 2026-09-01. Adding a
-- NOT NULL column with no default is safe on an empty table. If any
-- row is authored between this migration's authoring date and its
-- apply date, the ALTER will fail on the existing rows - which is
-- correct: a row without a key was authored under the old
-- (duplicable) shape and needs the operator to name it before the
-- new rule can hold.
--
-- Append-only invariant is unchanged
-- ──────────────────────────────────
-- This migration touches ONLY academy_questions. The append-only
-- fences on academy_check_attempts and academy_attestations are
-- unchanged. The post-flight explicitly re-verifies those two
-- tables' grant surfaces have not drifted, per the standing pattern
-- from academy-9.
--
-- HOW TO APPLY
-- ────────────
-- Three sections meant to be run as separate submissions in Studio.
-- Studio wraps the whole editor in a transaction; a verify block
-- referencing objects the same submission adds would roll the whole
-- thing back on any probe failure.
--
--   Section A - DDL + REVOKE + post-flight assertion, one
--               BEGIN/COMMIT, all-or-nothing.
--   Section B - Verify (P1/P2) as bare SELECTs against committed
--               state.
--   Section C - Mandatory execution probe: insert one question, try
--               to insert a second with the same
--               (doc_id, obligation_key, doc_version, question_key)
--               tuple, assert the second is refused with SQLSTATE
--               23505 (unique_violation). Raises PROBE OK with the
--               observed values on success - Studio swallows NOTICE,
--               so raising is the only way to surface the numbers.
--
-- Kevin runs A, waits for commit; runs B, verifies expected values;
-- runs C and reads the exception message. `applied in Studio: YES`
-- must not be posted until C surfaces its PROBE OK line.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- SECTION A - DDL + REVOKE + POST-FLIGHT ASSERTION
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  IF to_regclass('public.academy_questions') IS NULL THEN
    RAISE EXCEPTION 'academy-10 pre-flight: academy_questions missing - migration 4 (academy-9) must land first';
  END IF;

  -- If the column already exists, no-op quietly (safe re-apply).
  -- If any row exists WITHOUT the column, the ALTER below will fail
  -- on the NOT NULL constraint; explicit pre-check so the message
  -- names the operator problem rather than a bare constraint error.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'academy_questions'
      AND column_name = 'question_key'
  ) THEN
    -- Already added; skip loudly so operator sees the state.
    RAISE NOTICE 'academy-10 pre-flight: question_key column already exists - ALTER TABLE will be a no-op via IF NOT EXISTS';
  ELSE
    SELECT count(*) INTO v_count FROM academy_questions;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'academy-10 pre-flight: academy_questions holds % row(s) but question_key does not exist - the NOT NULL ALTER will fail. Author question_key values on those rows first, or DELETE them if they were probe leftovers.', v_count;
    END IF;
  END IF;
END $$;


-- ─── ALTER + UNIQUE INDEX ───────────────────────────────────────────
ALTER TABLE academy_questions
  ADD COLUMN IF NOT EXISTS question_key TEXT NOT NULL;

COMMENT ON COLUMN academy_questions.question_key IS
  'Stable per-question identifier. Never reused. Never renumbered.
   Same reasoning as academy_obligations.obligation_key + the
   content schema frontmatter obligations[].key: without a stable
   key, a question can only ever be inserted, never corrected.
   Format is authoring convention (kebab-case slug describing the
   idea being tested, e.g. `hospitality-service-vs`). Uniqueness
   is scoped to (doc_id, obligation_key, doc_version): the same
   key MAY reappear on a NEW doc_version if the corrected wording
   tests the same anchor, but is prohibited within one version.';

CREATE UNIQUE INDEX IF NOT EXISTS academy_questions_unique_key
  ON academy_questions (doc_id, obligation_key, doc_version, question_key);


-- ─── REVOKE TRUNCATE (defense-in-depth, re-asserted) ────────────────
-- REVOKE is idempotent; re-stating here so the whole academy family
-- stays consistent even if a future migration silently re-grants.
REVOKE TRUNCATE ON academy_questions FROM service_role, anon, authenticated;


-- ─── Post-flight ────────────────────────────────────────────────────
-- Assert:
--   1. question_key column landed with NOT NULL.
--   2. The unique index exists on the four-column tuple.
--   3. Append-only fences on academy_check_attempts and
--      academy_attestations are UNCHANGED - UPDATE/DELETE/TRUNCATE
--      still absent for service_role, anon, authenticated.
--   4. TRUNCATE still absent on academy_questions.
DO $$
DECLARE
  v_notnull BOOLEAN;
  v_idx_exists BOOLEAN;
  bad TEXT;
  privilege_grants TEXT[] := ARRAY[
    'academy_attestations|service_role|UPDATE',
    'academy_attestations|service_role|DELETE',
    'academy_attestations|service_role|TRUNCATE',
    'academy_attestations|anon|UPDATE',
    'academy_attestations|anon|DELETE',
    'academy_attestations|anon|TRUNCATE',
    'academy_attestations|authenticated|UPDATE',
    'academy_attestations|authenticated|DELETE',
    'academy_attestations|authenticated|TRUNCATE',
    'academy_check_attempts|service_role|UPDATE',
    'academy_check_attempts|service_role|DELETE',
    'academy_check_attempts|service_role|TRUNCATE',
    'academy_check_attempts|anon|UPDATE',
    'academy_check_attempts|anon|DELETE',
    'academy_check_attempts|anon|TRUNCATE',
    'academy_check_attempts|authenticated|UPDATE',
    'academy_check_attempts|authenticated|DELETE',
    'academy_check_attempts|authenticated|TRUNCATE',
    'academy_questions|service_role|TRUNCATE',
    'academy_questions|anon|TRUNCATE',
    'academy_questions|authenticated|TRUNCATE'
  ];
  parts TEXT[];
  t TEXT; r TEXT; p TEXT;
BEGIN
  -- 1. Column exists, NOT NULL.
  SELECT (is_nullable = 'NO') INTO v_notnull
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'academy_questions'
    AND column_name = 'question_key';
  IF v_notnull IS NULL THEN
    RAISE EXCEPTION 'academy-10 post-flight: question_key column missing after ALTER';
  END IF;
  IF NOT v_notnull THEN
    RAISE EXCEPTION 'academy-10 post-flight: question_key is nullable - NOT NULL constraint did not land';
  END IF;

  -- 2. Unique index exists on the expected tuple.
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'academy_questions'
      AND indexname = 'academy_questions_unique_key'
  ) INTO v_idx_exists;
  IF NOT v_idx_exists THEN
    RAISE EXCEPTION 'academy-10 post-flight: academy_questions_unique_key index missing';
  END IF;

  -- 3 + 4. Append-only + TRUNCATE fence sweep.
  FOREACH bad IN ARRAY privilege_grants LOOP
    parts := string_to_array(bad, '|');
    t := parts[1]; r := parts[2]; p := parts[3];
    IF has_table_privilege(r, t, p) THEN
      RAISE EXCEPTION 'academy-10 post-flight: % has % on % - the fence set by academy-9 has drifted (or the REVOKE block above did not run before this assertion)', r, p, t;
    END IF;
  END LOOP;
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION B - VERIFY BLOCK (P1 / P2)
-- ═══════════════════════════════════════════════════════════════════

-- P1. question_key column exists, NOT NULL.
-- Expected: 1 row where is_nullable = 'NO'.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'academy_questions'
  AND column_name = 'question_key';

-- P2. Unique index exists on the four-column tuple.
-- Expected: 1 row.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'academy_questions'
  AND indexname = 'academy_questions_unique_key';


-- ═══════════════════════════════════════════════════════════════════
-- SECTION C - MANDATORY PROBE
--
-- Insert one question, then INSERT another row with the same
-- (doc_id, obligation_key, doc_version, question_key) tuple. The
-- second must raise SQLSTATE 23505 (unique_violation). The probe
-- SET LOCAL ROLE service_role first so it tests the grant surface
-- the app actually runs under.
--
-- Expected on run: raises "PROBE OK a10: ..." with the observed
-- values. If it raises "PROBE FAIL" or any other exception, the
-- unique index did not land and the apply is NOT complete.
--
-- Wrapped in BEGIN;...ROLLBACK; so no state persists. The success-
-- side RAISE EXCEPTION aborts the transaction; the ROLLBACK below
-- runs against an already-aborted tx and is a no-op.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  v_doc TEXT := 'PB-014';
  v_key TEXT := 'probe-a10-uniq';
  v_first_id BIGINT;
  v_dup_refused BOOLEAN := FALSE;
  v_dup_sqlstate TEXT;
  v_dup_msg TEXT;
BEGIN
  SET LOCAL ROLE service_role;

  INSERT INTO academy_questions (
    doc_id, obligation_key, doc_version, question_key,
    section_anchor, prompt, options, correct_option_id, sort_order
  ) VALUES (
    v_doc, 'probe-a10-obligation', 'probe-1.0', v_key,
    'Probe Anchor',
    'Probe prompt: does the unique index refuse a duplicate key?',
    '[
      {"id": "a", "text": "Yes", "explanation": "correct"},
      {"id": "b", "text": "No", "explanation": "wrong"}
    ]'::jsonb,
    'a', 0
  )
  RETURNING question_id INTO v_first_id;

  -- Second insert with same key must fail unique_violation.
  BEGIN
    INSERT INTO academy_questions (
      doc_id, obligation_key, doc_version, question_key,
      section_anchor, prompt, options, correct_option_id, sort_order
    ) VALUES (
      v_doc, 'probe-a10-obligation', 'probe-1.0', v_key,
      'Probe Anchor 2',
      'Probe prompt 2: this insert MUST be refused.',
      '[
        {"id": "x", "text": "one", "explanation": "correct"},
        {"id": "y", "text": "two", "explanation": "wrong"}
      ]'::jsonb,
      'x', 1
    );
    -- If we reach here, the insert succeeded - unique index is missing.
  EXCEPTION
    WHEN unique_violation THEN
      v_dup_refused := TRUE;
      v_dup_sqlstate := SQLSTATE;
      v_dup_msg := SQLERRM;
  END;

  IF NOT v_dup_refused THEN
    RAISE EXCEPTION 'PROBE FAIL a10: duplicate (doc_id, obligation_key, doc_version, question_key) INSERT succeeded as service_role - unique index missing or wrong tuple';
  END IF;

  RESET ROLE;

  RAISE EXCEPTION 'PROBE OK a10: first_insert_id=% dup_refused=% (SQLSTATE % - %) - unique_key index enforced as expected',
    v_first_id, v_dup_refused, v_dup_sqlstate, v_dup_msg;
END
$probe$;

ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying Section A (BEGIN/COMMIT),
-- running Section B against committed state, and running Section C.
-- The probe MUST raise its "PROBE OK a10" message. If it raises
-- "PROBE FAIL" or any other exception, the apply is NOT complete
-- and `applied in Studio: YES` MUST NOT be posted.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- section_a_commit:   <expected: COMMIT succeeded, no exceptions>
-- p1_column:          <expected 1 row, is_nullable='NO'>
-- p2_index:           <expected 1 row, indexname='academy_questions_unique_key'>
-- c_probe:            <expected exception "PROBE OK a10: first_insert_id=<N>
--                      dup_refused=t (SQLSTATE 23505 - ...)">
-- notes:              <optional>
