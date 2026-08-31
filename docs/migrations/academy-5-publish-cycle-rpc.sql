-- ═══════════════════════════════════════════════════════════════════
-- academy-5-publish-cycle-rpc.sql
--
-- Two RPCs. Together they make `academy_requirements` write-only
-- through plpgsql - no application-code INSERT reaches it - which
-- keeps the `COALESCE(cycle_id, -1)` unique-index expression in
-- exactly two places (both in this file) rather than restated in
-- JavaScript where a subtle mismatch already surfaced once.
--
-- Functions authored
-- ──────────────────
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
--   insert_requirements_bulk(
--     p_source        TEXT,       -- 'onboarding' | 'rehire' | 'manual'
--     p_rows          JSONB       -- the row list; empty is legal
--   ) RETURNS INT                 -- rows inserted (skipped = planned - inserted)
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
  -- INDEX INFERENCE, NOT CONSTRAINT NAME. The unique enforcer in
  -- academy-3 is a CREATE UNIQUE INDEX over the expression
  -- COALESCE(cycle_id, -1), which never enters pg_constraint (an
  -- expression cannot be a table constraint in Postgres). ON
  -- CONFLICT ON CONSTRAINT <name> resolves against pg_constraint
  -- and would fail at runtime with "constraint ... does not
  -- exist." The only shape Postgres accepts here is index
  -- inference matching the exact expression list.
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
  ON CONFLICT (worker_id, doc_id, obligation_key, doc_version, source, COALESCE(cycle_id, -1))
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

GRANT EXECUTE ON FUNCTION publish_cycle_atomic(BIGINT, TEXT, JSONB) TO service_role;


-- ─── insert_requirements_bulk ──────────────────────────────────────
--
-- The non-cycle write path. Onboarding + rehire + manual go through
-- this, so `academy_requirements` never sees an app-layer INSERT
-- and the ON CONFLICT expression appears in exactly two places,
-- both in this file. Structural fix for the class of bug that let
-- a JS `.upsert` restate the index's expression incorrectly.
--
-- Why cycle is refused
-- ───────────────────
-- Cycle requirements MUST land in the same transaction as the
-- cycle's status flip (publish_cycle_atomic). A second writer here
-- would fork that atomicity - a caller could insert cycle rows
-- through this RPC without publishing the cycle, or after the
-- cycle already published from the other path, producing a state
-- where two writers disagree about which rows belong to a cycle.
-- Refused loudly.
--
-- Why only `manual` may carry a non-null cycle_id
-- ────────────────────────────────────────────────
-- academy-3 loosened academy_requirements_cycle_source_has_cycle
-- to one-way: cycle-sourced rows require a cycle_id, but non-cycle
-- sources MAY carry one. The scenario is Kevin manually issuing a
-- September module to a site leader who was on leave that month,
-- attributing the row to September so the person's completion
-- still counts against September's rollup. Under the two-way rule
-- that requirement could never be cycle-attributed and September
-- would report permanently incomplete for that person even after
-- they finished it (see review of academy-3, ruling to loosen).
--
-- `onboarding` and `rehire` are triggered by hiring events, not
-- calendar cycles. A cycle-attributed onboarding row would be
-- meaningless - a chef hired on October 3 owes onboarding because
-- of the hire, not because a September cycle published. The RPC
-- refuses non-null cycle_id from those two sources so the schema-
-- permitted capability cannot be misused.
--
-- INDEX INFERENCE, NOT CONSTRAINT NAME. Same lockstep with
-- academy-3-assignment-layer.sql's academy_requirements_unique_
-- issue as publish_cycle_atomic above. The index is an expression
-- index (COALESCE(cycle_id, -1)), and an expression index cannot
-- become a table constraint in Postgres, so ON CONFLICT ON
-- CONSTRAINT would fail at runtime with "constraint ... does not
-- exist." The tuple below MUST stay in lockstep with the index
-- definition; if either changes without the other, apply fails.
CREATE OR REPLACE FUNCTION insert_requirements_bulk(
  p_source TEXT,
  p_rows   JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  -- Refuse anything outside the non-cycle set. The
  -- academy_requirements.source CHECK also admits 'version_recert',
  -- but that source depends on academy_attestations (does not exist
  -- yet) so it has no producer today; when it lands, it will get
  -- its own RPC or be added here explicitly. Refusing unknown
  -- values now keeps the write path from silently accepting
  -- something the CHECK will reject downstream.
  IF p_source IS NULL OR p_source NOT IN ('onboarding', 'rehire', 'manual') THEN
    RAISE EXCEPTION 'insert_requirements_bulk: refused - p_source must be one of onboarding|rehire|manual (got "%"). Cycle issuance goes through publish_cycle_atomic; version_recert has no producer yet.',
      COALESCE(p_source, '(null)');
  END IF;

  -- Refuse a null input array (matches the discipline in
  -- academy-4's sweep_orphan_obligations). An empty array is
  -- legal - it returns 0 and skips the INSERT so a caller can run
  -- idempotently with no rows.
  IF p_rows IS NULL THEN
    RAISE EXCEPTION 'insert_requirements_bulk: refused - p_rows is null; pass an empty array to run with zero rows';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  -- Guard: only source='manual' may carry a non-null cycle_id (see
  -- header for the "site leader on leave" scenario). onboarding
  -- and rehire are hiring-triggered - a cycle-attributed row from
  -- those sources would be meaningless. Refuse before the INSERT
  -- so a mixed batch fails clean rather than leaving some rows
  -- inserted.
  IF p_source IN ('onboarding', 'rehire') THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_rows) AS x(cycle_id BIGINT)
      WHERE x.cycle_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'insert_requirements_bulk: refused - source="%" cannot carry a non-null cycle_id on any row. Only manual may carry a cycle attribution; onboarding and rehire are hiring-triggered and cannot be cycle-attributed.',
        p_source;
    END IF;
  END IF;

  -- Insert. cycle_id comes from the row (nullable). The RPC does
  -- NOT hardcode NULL, so the manual-catch-up scenario is
  -- reachable through this write path.
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
    p_source,
    x.cycle_id,
    x.due_date,
    COALESCE(x.issued_by, 'system')
  FROM jsonb_to_recordset(p_rows) AS x(
    worker_id       TEXT,
    person_id       UUID,
    doc_id          TEXT,
    obligation_key  TEXT,
    doc_version     TEXT,
    est_minutes     INTEGER,
    cycle_id        BIGINT,
    due_date        DATE,
    issued_by       TEXT
  )
  ON CONFLICT (worker_id, doc_id, obligation_key, doc_version, source, COALESCE(cycle_id, -1))
  DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_requirements_bulk(TEXT, JSONB) TO service_role;


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

-- P1. Both functions exist.
-- Expected: 2 rows.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('publish_cycle_atomic', 'insert_requirements_bulk')
ORDER BY p.proname;

-- P2. service_role has EXECUTE on both.
-- Expected: 6 rows total - 3 grantees per function (postgres,
-- PUBLIC, service_role). Postgres grants EXECUTE to PUBLIC by
-- default on every new function; that is harmless here because
-- both functions are SECURITY INVOKER, so an anon caller without
-- the underlying table privileges fails on the table, not on the
-- function. Same shape as archive_document (pr-7-7),
-- replace_document_relationships/_surfaces (pr-7-15), and the two
-- academy-4 functions.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('publish_cycle_atomic', 'insert_requirements_bulk')
  AND privilege_type = 'EXECUTE'
ORDER BY routine_name, grantee;


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
--   -- A second call against the same cycle is refused by the
--   -- draft-check ("cycle_id ... is in status \"published\" (must
--   -- be draft to publish)"), which runs BEFORE any INSERT, so
--   -- the ON CONFLICT DO NOTHING never gets a chance to fire.
--   -- Insert-side idempotency is exercised in P5 (which does not
--   -- involve a state flip) rather than here.
--   -- SELECT publish_cycle_atomic(:cid, 'probe', '[]'::jsonb);
--   -- Expected error: "cycle_id ... is in status \"published\"..."
--
--   ROLLBACK;


-- ─── P4 (probe, run deliberately) ──────────────────────────────────
-- Refusal branches for publish_cycle_atomic. Each MUST error.
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


-- ─── P5 (probe, run deliberately) ──────────────────────────────────
-- insert_requirements_bulk happy path + idempotency + refusals.
-- Uses Kevin's worker_id and PB-014 as the FK anchors.
--
-- Expected on run:
--   first_call_inserted  = 1
--   second_call_inserted = 0   (same rows; expression index skip)
--   empty_call_inserted  = 0   (empty array is legal)
--   cycle-source call    ERRORS: "p_source must be one of onboarding|rehire|manual"
--   null-source call     ERRORS: "p_source must be one of onboarding|rehire|manual"
--   null-rows call       ERRORS: "p_rows is null"
--
--   BEGIN;
--   SELECT insert_requirements_bulk('onboarding', $j$[
--     {
--       "worker_id":      "6418e1e52a44e07c8b303f7b",
--       "person_id":      null,
--       "doc_id":         "PB-014",
--       "obligation_key": "p5-probe",
--       "doc_version":    "probe",
--       "est_minutes":    11,
--       "due_date":       "2026-10-31",
--       "issued_by":      "probe"
--     }
--   ]$j$::jsonb) AS first_call_inserted;
--
--   SELECT insert_requirements_bulk('onboarding', $j$[
--     {
--       "worker_id":      "6418e1e52a44e07c8b303f7b",
--       "person_id":      null,
--       "doc_id":         "PB-014",
--       "obligation_key": "p5-probe",
--       "doc_version":    "probe",
--       "est_minutes":    11,
--       "due_date":       "2026-10-31",
--       "issued_by":      "probe"
--     }
--   ]$j$::jsonb) AS second_call_inserted;
--
--   SELECT insert_requirements_bulk('rehire', '[]'::jsonb) AS empty_call_inserted;
--
--   -- Refusal branches:
--   -- SELECT insert_requirements_bulk('cycle', '[]'::jsonb);
--   -- SELECT insert_requirements_bulk(NULL, '[]'::jsonb);
--   -- SELECT insert_requirements_bulk('onboarding', NULL);
--
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
-- p1_functions:      <expected 2 rows: publish_cycle_atomic + insert_requirements_bulk>
-- p2_grants:         <expected 6 rows: 3 grantees per function - postgres, PUBLIC, service_role - see P2 comment>
-- p3_publish_probe:  <run probe; expected new_status=published, inserted=2, skipped=0>
-- p4_publish_refusals: <run three probes; each must error on its named branch>
-- p5_bulk_probe:     <run probe; expected first_call_inserted=1, second_call_inserted=0, empty_call_inserted=0, three refusals each error>
-- notes:             <optional>
