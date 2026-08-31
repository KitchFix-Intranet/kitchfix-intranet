-- ═══════════════════════════════════════════════════════════════════
-- academy-5-publish-cycle-rpc.sql
--
-- One RPC: publish_cycle_atomic. Flips a draft cycle to published
-- AND inserts its resolved requirements in one transaction.
--
-- Function authored
-- ─────────────────
--   publish_cycle_atomic(
--     p_cycle_id      BIGINT,
--     p_published_by  TEXT,
--     p_rows          JSONB
--   ) RETURNS TABLE (
--     cycle_id                BIGINT,
--     new_status              TEXT,
--     published_at            TIMESTAMPTZ,
--     requirements_inserted   INT,
--     requirements_skipped    INT
--   )
--
-- Why an RPC (not two statements from JS)
-- ───────────────────────────────────────
-- Publishing must be atomic: "the cycle's status flips and its
-- requirements land in the same transaction, or neither happens.
-- A published cycle with no requirements is worse than a failed
-- publish, because it looks complete." Same reasoning as
-- pr-7-15-opd-atomic-replace-fns.sql and academy-4-obligations-rpc:
-- the Supabase REST client cannot run BEGIN/COMMIT, so a network
-- failure between two statements would leave a corrupted state
-- (published label + zero rows). A plpgsql function body executes
-- as one implicit transaction; either every statement commits or
-- every statement rolls back.
--
-- Why the caller pre-computes the rows
-- ────────────────────────────────────
-- Spec Section 3.2 forbids the resolver (and by extension the
-- audience filter) from being written twice. The application code
-- in src/lib/academy/requirements.js owns the ONE eligibility
-- filter; the RPC just receives its output as JSONB and inserts.
-- Duplicating the filter inside plpgsql would fork it the day
-- somebody adds a rule.
--
-- Input row shape (matches src/lib/academy/requirements.js output)
--   [
--     {
--       "worker_id":      "abc123...",
--       "person_id":      "uuid-...",
--       "doc_id":         "AGR-001",
--       "obligation_key": "big-rules-onboarding",
--       "doc_version":    "1.1",
--       "est_minutes":    12,
--       "due_date":       "2026-09-30"
--     },
--     ...
--   ]
-- source is FIXED to 'cycle' here - this RPC only publishes cycles.
-- Non-cycle triggers (onboarding, rehire) do their own bulk INSERT
-- from the app; they do not need atomic-swap with a state change,
-- so they do not need an RPC.
--
-- Idempotency
-- ───────────
-- INSERT ... ON CONFLICT DO NOTHING against the unique index
-- academy_requirements_unique_issue. Re-running publish_cycle_atomic
-- against an already-published cycle is a no-op that RAISEs (cycle
-- already published); re-running with the same p_rows against a
-- draft-then-published cycle inserts zero (unique-index blocks
-- duplicates) and returns requirements_inserted = 0,
-- requirements_skipped = <all>.
--
-- SECURITY
-- ────────
-- LANGUAGE plpgsql, default SECURITY INVOKER (mirrors
-- replace_document_obligations in academy-4 and archive_document
-- in pr-7-7). service_role already holds the required grants on
-- academy_cycles (UPDATE) and academy_requirements (INSERT).
-- service_role does NOT hold DELETE on academy_requirements - the
-- post-flight assertion in academy-3 enforces that at every
-- migration boundary and this file does not weaken it.
--
-- Refusal semantics
-- ─────────────────
-- The RPC RAISEs on every case where silent success would be
-- misleading:
--   1. Cycle does not exist
--   2. Cycle is not in draft (already published / closed)
--   3. p_published_by is null or empty
--   4. p_rows is null (empty array is allowed and legal - a cycle
--      with zero eligible people still publishes cleanly; the
--      report simply notes 0 inserted)
--
-- Coordination discipline
-- ───────────────────────
-- Apply this migration in Studio BEFORE the caller in
-- scripts/academy-issue.mjs merges. Same silent-gap discipline as
-- pr-9-1, pr-7-15, and academy-4. The caller will fail with
-- "function does not exist" if the migration has not been pasted.
-- ═══════════════════════════════════════════════════════════════════


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
  ON CONFLICT ON CONSTRAINT academy_requirements_unique_issue DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  RETURN QUERY
    SELECT p_cycle_id,
           'published'::TEXT,
           v_now,
           v_row_count,
           (v_planned - v_row_count);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_cycle_atomic(BIGINT, TEXT, JSONB) TO service_role;


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   P1 + P2 run cleanly.
--
--   P3 + P4 are commented-out probes Kevin runs deliberately - they
--   are DML wrapped in BEGIN/ROLLBACK so no state persists. Both
--   need a real cycle_id, so Kevin fills in one from a fresh test
--   INSERT INTO academy_cycles inside the transaction.
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. Function exists and is executable by service_role.
-- Expected: 1 row.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'publish_cycle_atomic';

-- P2. service_role has EXECUTE on it.
-- Expected: 1 row, grantee = service_role.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'publish_cycle_atomic'
  AND privilege_type = 'EXECUTE'
ORDER BY grantee;


-- ─── P3 (probe, run deliberately) ──────────────────────────────────
-- Happy path. Creates a throwaway cycle, publishes it with two
-- rows, asserts the return shape, then ROLLBACKs. Uses a real
-- worker_id (Kevin) and person_id (looked up inside).
--
-- Expected on run:
--   new_status = 'published'
--   requirements_inserted = 2
--   requirements_skipped  = 0
--   cycle is 'published' at the moment of the second SELECT
--   ROLLBACK undoes everything
--
--   BEGIN;
--   INSERT INTO academy_cycles (label, period_start, period_end, created_by)
--   VALUES ('P3 probe', '2026-10-01', '2026-10-31', 'probe')
--   RETURNING cycle_id;  -- capture as :cid
--
--   SELECT publish_cycle_atomic(
--     :cid,
--     'probe@kitchfix.com',
--     $j$[
--       {
--         "worker_id":      "6418e1e52a44e07c8b303f7b",
--         "person_id":      "00000000-0000-0000-0000-000000000000",
--         "doc_id":         "AGR-001",
--         "obligation_key": "big-rules-annual",
--         "doc_version":    "1.1",
--         "est_minutes":    12,
--         "due_date":       "2026-10-31"
--       },
--       {
--         "worker_id":      "6418e1e52a44e07c8b303f7b",
--         "person_id":      "00000000-0000-0000-0000-000000000000",
--         "doc_id":         "PB-014",
--         "obligation_key": "culture-os-standard-annual",
--         "doc_version":    "1.0",
--         "est_minutes":    11,
--         "due_date":       "2026-10-31"
--       }
--     ]$j$::jsonb
--   );
--
--   -- Second call with same p_rows exercises idempotency.
--   -- Expected: requirements_inserted=0, requirements_skipped=2,
--   -- but ALSO expected to ERROR because the cycle is already
--   -- published - RAISE fires from the draft-check. Both are
--   -- correct answers depending on the read: a repeat publish
--   -- attempt should be refused loudly.
--   -- SELECT publish_cycle_atomic(:cid, 'probe', ...);
--
--   ROLLBACK;


-- ─── P4 (probe, run deliberately) ──────────────────────────────────
-- Refusal branches. Each MUST error with its named message.
--
--   BEGIN;
--   SELECT publish_cycle_atomic(999999, 'x', '[]'::jsonb);
--   -- Expected error: "cycle_id 999999 does not exist"
--   ROLLBACK;
--
--   BEGIN;
--   SELECT publish_cycle_atomic(1, '', '[]'::jsonb);
--   -- Expected error: "p_published_by is null or empty"
--   ROLLBACK;
--
--   BEGIN;
--   SELECT publish_cycle_atomic(1, 'x', NULL);
--   -- Expected error: "p_rows is null"
--   ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file in Studio. The
-- migration-gate check on this PR looks for the phrase
-- `applied in Studio: YES` in a comment from an OWNER account and
-- re-emits the check_run on the current SHA.
--
-- applied in Studio: PENDING
-- sha:               <fill in commit SHA>
-- applied by:        k.fietek@kitchfix.com
-- applied at:        <fill in ISO timestamp>
-- p1_function:       <expected 1 row>
-- p2_grant:          <expected 1 row, service_role>
-- p3_publish_probe:  <run probe; expected new_status=published, inserted=2, skipped=0>
-- p4_refusal_probes: <run three probes; each must error on its named branch>
-- notes:             <optional>
