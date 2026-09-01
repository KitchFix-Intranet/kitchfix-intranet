-- ═══════════════════════════════════════════════════════════════════
-- academy-9-signature-layer.sql
--
-- Migration 4 of the Academy split (spec Section 16.1). Four tables
-- plus one sequence. This is the compliance record: everything the
-- Academy has built so far exists to make these rows trustworthy.
--
--   1 identity          persons, stints, exceptions, grants
--   2 region-leads      region -> RDO email
--   3 assignment layer  obligations, cycles, cycle_modules,
--                       requirements
--   4 SIGNATURE LAYER   questions, check_attempts, module_progress,
--                       attestations                             <-- THIS
--   5 delivery          portal_tokens, email_events, admin_audit
--
-- Tables authored here
-- ────────────────────
--   academy_questions          comprehension checks per module.
--                              correct_option_id NEVER reaches the
--                              client; grading is server-side.
--   academy_check_attempts     every attempt right or wrong.
--                              APPEND-ONLY, DB-enforced.
--   academy_module_progress    scratch state: sections seen, time
--                              spent. MUTABLE. Not evidence.
--   academy_attestations       THE record. The typed-name attestation
--                              gated by comprehension checks, stamped
--                              with document version, timestamp,
--                              attempts, certificate serial.
--                              APPEND-ONLY, DB-enforced. Client-
--                              supplied UUID for idempotency.
--
-- Sequence authored here
-- ──────────────────────
--   academy_certificate_seq    monotonically increasing serial for
--                              certificate identifiers. Never resets.
--                              Year is context; uniqueness comes from
--                              the sequence.
--
-- Governing principle - spec Section 7.2
-- ──────────────────────────────────────
-- "An attestation that can be quietly altered is worse than no
--  attestation, because it looks like evidence."
--
-- Everything below follows from that:
--   1. Append-only at the database level (kpi-8a pattern):
--      GRANT SELECT, INSERT only, REVOKE TRUNCATE explicitly,
--      post-flight assertion refuses to apply if UPDATE / DELETE /
--      TRUNCATE is present on service_role, anon, or authenticated.
--   2. Corrections are SUPERSEDING rows, never updates. Direction
--      inverts from the spec's original wording: the CORRECTING row
--      carries `supersedes` pointing at what it replaces. Nothing
--      ever updates. See spec Section 17 amendment.
--   3. Client-generated UUID as attestation_id, no DEFAULT: a retry
--      after a dropped connection cannot double-sign because the
--      idempotency key was born before the request.
--   4. attestation_text stored verbatim (the exact sentence the
--      person read), never a template reference. Re-wording the
--      template later must not silently re-word history.
--
-- What NOT to add - `satisfied_by` on academy_requirements
-- ────────────────────────────────────────────────────────
-- Spec Section 13 suggests a satisfied_by pointer on
-- academy_requirements. This migration DELIBERATELY omits it.
-- Satisfaction is answered by the existence of an attestation for
-- that requirement; a stored pointer is a second source of truth
-- for one fact and it can drift. This project has been bitten three
-- times by exactly that shape (KPI-versus-Sous divergence, the
-- person_id denormalization gap, doc-versus-code drift). The
-- performance argument does not hold at this scale - an indexed
-- NOT EXISTS against a few hundred rows is free.
--
-- See spec Section 17 for the ruling that closes this amendment.
--
-- Apply discipline
-- ────────────────
-- Same as prior academy migrations. Author-only; Kevin applies in
-- Studio. The migration-gate check fails until Kevin comments
-- `applied in Studio: YES`.
--
-- HOW TO APPLY
-- ────────────
-- The file has three sections meant to be RUN AS SEPARATE
-- SUBMISSIONS in the Studio SQL editor. Studio wraps the whole
-- editor in a transaction; a verify block referencing objects the
-- same submission creates would roll the whole thing back on any
-- probe failure.
--
--   Section A - DDL + REVOKE + post-flight assertion, wrapped
--               in one BEGIN/COMMIT so all-or-nothing.
--   Section B - Verify block (P1/P2/P5) as bare SELECTs against
--               committed state.
--   Section C - Two mandatory probes, each in its own
--               BEGIN;...ROLLBACK; block. Both RAISE EXCEPTION
--               carrying values on success - Studio swallows
--               NOTICEs, so a probe that prints "PROBE OK" as a
--               notice is indistinguishable from one that did
--               nothing. Raising surfaces the numbers.
--
-- Kevin runs A, waits for commit; runs B, verifies expected values;
-- runs C1 and C2 individually and reads the exception messages.
-- `applied in Studio: YES` must not be posted until every probe has
-- surfaced its expected PROBE OK line.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- SECTION A - DDL + REVOKE + POST-FLIGHT ASSERTION
--            run as one submission (BEGIN/COMMIT), all-or-nothing.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
-- Refuse to apply if migration 3 has not landed. The signature layer
-- FKs directly into academy_requirements; running against a database
-- that lacks it would fail mid-DDL with an uninformative FK error.
DO $$
BEGIN
  IF to_regclass('public.academy_requirements') IS NULL THEN
    RAISE EXCEPTION 'academy-9 pre-flight: academy_requirements missing - migration 3 must land first';
  END IF;
  IF to_regclass('public.people') IS NULL THEN
    RAISE EXCEPTION 'academy-9 pre-flight: people missing - PR 1 spine must land first';
  END IF;
END $$;


-- ─── academy_certificate_seq ────────────────────────────────────────
-- One monotonic counter across all certificates ever issued. The year
-- in the serial is context ("issued in 2026"), not a namespace - the
-- sequence never resets. That means the six-digit padding is soft:
-- once nextval > 999999 the serial grows to seven digits and still
-- sorts correctly because lpad only affects small numbers. At current
-- pace (single-digit signatures per person per year across ~100
-- salaried) six digits is millennia of runway.
CREATE SEQUENCE IF NOT EXISTS academy_certificate_seq
  START 1
  INCREMENT 1
  NO CYCLE;


-- ─── academy_questions ──────────────────────────────────────────────
-- Comprehension checks. Scoped to (doc_id, obligation_key, doc_version)
-- because a module carries its own question set, not the whole
-- document. correct_option_id is NEVER returned to a client - see
-- column comment for the enforcement contract.
CREATE TABLE IF NOT EXISTS academy_questions (
  question_id        BIGSERIAL   PRIMARY KEY,
  doc_id             TEXT        NOT NULL,
  obligation_key     TEXT        NOT NULL,
  doc_version        TEXT        NOT NULL,
  section_anchor     TEXT,
  prompt             TEXT        NOT NULL,
  options            JSONB       NOT NULL,
  correct_option_id  TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  sort_order         INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Approval is all-or-nothing. An approved question with no
  -- approver / no approval timestamp is authoring garbage.
  CONSTRAINT academy_questions_approved_complete
    CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),

  -- Options must be a JSON array with at least two entries. The
  -- "correct_option_id must reference one of the option ids"
  -- invariant is application-enforced (CHECK constraints cannot use
  -- subqueries, and hand-rolling a helper function for this one
  -- check is more attack surface than it saves; the authoring
  -- pipeline validates before insert).
  CONSTRAINT academy_questions_options_shape
    CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2)
);

-- Partial index for the operator queue: "give me the approved
-- questions for this module version." draft + retired questions are
-- authoring state and off the hot path.
CREATE INDEX IF NOT EXISTS academy_questions_approved_lookup_idx
  ON academy_questions (doc_id, obligation_key, doc_version)
  WHERE status = 'approved';

COMMENT ON TABLE academy_questions IS
  'Comprehension checks per module. Questions are drafted by the
   authoring pipeline and APPROVED by Kevin before they can be
   assigned (spec Section 8). Retired questions stay in the table -
   check attempts FK to question_id, and destroying a question would
   orphan every attempt that answered it. Set status=retired
   instead of deleting.';

COMMENT ON COLUMN academy_questions.correct_option_id IS
  'SERVER-SIDE ONLY. This column MUST NEVER appear in any response
   payload returned to a browser, an unauthenticated caller, or any
   route that a hourly-portal token could reach. Grading is done
   server-side: the API receives selected_option_id, compares it
   against correct_option_id in a query the client cannot inspect,
   and returns only the boolean outcome. Any /api route that reads
   this column must explicitly list its return columns and OMIT
   correct_option_id; do not `SELECT *`. Spec Section 8: correct
   answers are never discoverable client-side before submission.';

COMMENT ON COLUMN academy_questions.options IS
  'JSON array of `{ id, text, explanation }`. The `explanation`
   field is what renders after a wrong answer per spec Section 8
   ("wrong answers teach"). Server-side: safe to return in full to
   the client - unlike correct_option_id, options are meant to be
   seen. Answer order shuffles per attempt in the render, not in
   this storage.';


-- ─── academy_check_attempts ─────────────────────────────────────────
-- Every attempt is recorded, right and wrong. A system that quietly
-- discards failed attempts is not recording comprehension, it is
-- recording persistence (spec Section 8). Append-only, DB-enforced
-- following the kpi-8a pattern.
CREATE TABLE IF NOT EXISTS academy_check_attempts (
  attempt_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id           TEXT        NOT NULL REFERENCES people (worker_id),
  person_id           UUID,
  requirement_id      UUID        REFERENCES academy_requirements (requirement_id),
  question_id         BIGINT      NOT NULL REFERENCES academy_questions (question_id),
  doc_version         TEXT        NOT NULL,
  selected_option_id  TEXT        NOT NULL,
  correct             BOOLEAN     NOT NULL,
  attempted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Operator queue: "how many attempts on this requirement" and
-- "did this stint eventually pass this module." Composite on
-- (worker_id, requirement_id) covers both.
CREATE INDEX IF NOT EXISTS academy_check_attempts_worker_req_idx
  ON academy_check_attempts (worker_id, requirement_id);

-- Question-side lookup: "how often is this question missed"
-- (authoring feedback loop). Small index; supports Records exports.
CREATE INDEX IF NOT EXISTS academy_check_attempts_question_idx
  ON academy_check_attempts (question_id, correct);

COMMENT ON TABLE academy_check_attempts IS
  'Append-only ledger of every check attempt, right or wrong. The
   Records "Attempts" column reads this table directly - unlimited
   attempts allowed per spec Section 8, and honest recording is the
   whole point. A row here does NOT satisfy a requirement; only an
   attestation does. Wrong attempts are evidence, not failure. Grants
   SELECT + INSERT only; the post-flight assertion refuses to apply
   if UPDATE / DELETE / TRUNCATE is present on service_role, anon,
   or authenticated.';

COMMENT ON COLUMN academy_check_attempts.person_id IS
  'Denormalized copy of academy_person_stints.person_id at the time
   of the attempt. No FK, same rationale as academy_requirements.
   person_id - the stint could theoretically be reassigned, and the
   historical attempt should carry the person_id that was true when
   it was made.';


-- ─── academy_module_progress ────────────────────────────────────────
-- MUTABLE working state. Sections seen so far, first-open timestamp,
-- last-seen timestamp, cumulative time spent. This is NOT evidence;
-- do not pattern-match the kpi-8a append-only shape here.
CREATE TABLE IF NOT EXISTS academy_module_progress (
  worker_id            TEXT        NOT NULL REFERENCES people (worker_id),
  requirement_id       UUID        NOT NULL REFERENCES academy_requirements (requirement_id),
  sections_seen        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_spent_seconds   INTEGER     NOT NULL DEFAULT 0
                         CHECK (time_spent_seconds >= 0),
  PRIMARY KEY (worker_id, requirement_id)
);

COMMENT ON TABLE academy_module_progress IS
  'MUTABLE scratch state. One row per (worker_id, requirement_id).
   Updated in place as the reader opens sections and time passes;
   UPSERTed on first section-open via
   ON CONFLICT (worker_id, requirement_id) DO UPDATE ....
   Deliberately NOT append-only - pattern-matching the kpi-8a shape
   here would turn a natural in-place scratch surface into an audit
   trail that nobody reads, and would slow every progress-bump into
   an insert. Evidence lives in academy_check_attempts (append-only)
   and academy_attestations (append-only, THE record). Progress is
   just how far the reader has scrolled.';


-- ─── academy_attestations ───────────────────────────────────────────
-- THE compliance record. Every column below carries weight - the
-- denormalized copies exist because a signature is a historical
-- FACT that does not change when an obligation is re-authored, a
-- cycle is closed, or a document is edited. attestation_id is
-- CLIENT-SUPPLIED (no DEFAULT) so a retry after a dropped connection
-- cannot double-sign; the client generates the UUID before submit.
CREATE TABLE IF NOT EXISTS academy_attestations (
  -- Client-generated UUID. NO DEFAULT - see column comment.
  attestation_id       UUID         PRIMARY KEY,

  -- The stint. FK to people; the person side is denormalized below.
  worker_id            TEXT         NOT NULL REFERENCES people (worker_id),

  -- Denormalized copies. See table comment for the "why not FK"
  -- rationale.
  person_id            UUID,
  requirement_id       UUID         REFERENCES academy_requirements (requirement_id),
  doc_id               TEXT         NOT NULL,
  obligation_key       TEXT         NOT NULL,
  doc_version          TEXT         NOT NULL,

  -- What the person actually typed. Compared to the authenticated
  -- identity display_name at submit time (application check); stored
  -- verbatim so a later name change / typo cannot silently rewrite
  -- what got typed.
  typed_name           TEXT         NOT NULL,

  -- The EXACT sentence the person read. Stored verbatim, not a
  -- template reference - see table comment.
  attestation_text     TEXT         NOT NULL,

  signed_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  attempts_count       INTEGER      NOT NULL CHECK (attempts_count >= 0),
  time_spent_seconds   INTEGER      CHECK (time_spent_seconds IS NULL OR time_spent_seconds >= 0),

  -- Certificate serial: 'KFA-YYYY-NNNNNN'. Default generates on
  -- INSERT via the shared sequence. UNIQUE across the table (and
  -- therefore across all attestations ever, because the sequence
  -- never resets). NOW() in the default matches signed_at's default
  -- to the same transaction-start timestamp; both DEFAULTs evaluate
  -- to the same value within one INSERT statement.
  certificate_serial   TEXT         NOT NULL UNIQUE
                         DEFAULT (
                           'KFA-' ||
                           to_char(NOW(), 'YYYY') || '-' ||
                           lpad(nextval('academy_certificate_seq')::text, 6, '0')
                         ),

  -- Self-reference. The CORRECTING row points at what it replaces.
  -- Direction is deliberate - see table comment.
  supersedes           UUID         REFERENCES academy_attestations (attestation_id),

  source               TEXT         NOT NULL
                         CHECK (source IN ('intranet', 'portal')),

  -- Hashes only. Raw IP + user-agent NEVER stored - the hash gives
  -- us "same session" comparison without holding PII on the record.
  ip_hash              TEXT,
  user_agent_hash      TEXT
);

-- "Does this stint hold a signature for this requirement?" Primary
-- query pattern; supports the Records ledger.
CREATE INDEX IF NOT EXISTS academy_attestations_worker_req_idx
  ON academy_attestations (worker_id, requirement_id);

-- "Does this stint hold the sig for this doc version?" Version-recert
-- trigger and cross-cycle queries.
CREATE INDEX IF NOT EXISTS academy_attestations_worker_doc_version_idx
  ON academy_attestations (worker_id, doc_id, doc_version);

-- "Which attestation supersedes X?" Reverse lookup for the
-- "is-current?" query - one row means X is superseded.
CREATE INDEX IF NOT EXISTS academy_attestations_supersedes_idx
  ON academy_attestations (supersedes)
  WHERE supersedes IS NOT NULL;

-- Signed-at range scans (Records exports by date, cycle rollups).
CREATE INDEX IF NOT EXISTS academy_attestations_signed_at_idx
  ON academy_attestations (signed_at DESC);

COMMENT ON TABLE academy_attestations IS
  'THE compliance record. Append-only, DB-enforced. Every row is a
   historical FACT: "on this date, this worker signed version X of
   this document, having passed comprehension checks in N attempts."
   That fact does NOT change when the obligation is re-authored, the
   cycle is closed, or the document itself is edited. The
   denormalized doc_id, obligation_key, doc_version columns carry
   what was signed, not a pointer back to whatever the current row
   might be.

   SUPERSEDES direction (spec Section 17 amendment 2026-09-01):
   the CORRECTING row carries `supersedes` pointing at what it
   replaces. The corrected row is never updated. The spec originally
   implied a `superseded_by` pointer on the older row, but setting
   that would be an UPDATE and this table forbids UPDATE. "Is this
   attestation current?" becomes "does any row supersede it?" - a
   NOT EXISTS query against the supersedes index, not a stored flag.

   attestation_id is CLIENT-SUPPLIED (no DEFAULT). The client
   generates a UUID before submitting so a retry after a dropped
   connection cannot double-sign; the second submit collides on the
   primary key and gets 23505, not a second row. Do NOT add
   DEFAULT gen_random_uuid() - it would defeat idempotency.

   attestation_text is stored VERBATIM (the exact sentence the
   person read), not a template reference. If the wording is ever
   revised, every prior signature still shows what that person
   actually agreed to. A template reference would silently re-word
   history.

   Append-only enforcement (kpi-8a pattern):
     - GRANT SELECT, INSERT only to service_role.
     - No UPDATE, no DELETE.
     - REVOKE TRUNCATE explicitly (granted by DEFAULT PRIVILEGES).
     - Post-flight assertion refuses to apply if any of UPDATE /
       DELETE / TRUNCATE is present on service_role, anon, or
       authenticated.
     - Corrections are superseding rows referencing supersedes.';

COMMENT ON COLUMN academy_attestations.attestation_id IS
  'Client-supplied UUID. NO DEFAULT. The client generates a UUID
   before submitting the sign action, so a retry after a dropped
   connection collides on the primary key (23505) rather than
   double-signing. Do NOT add a DEFAULT.';

COMMENT ON COLUMN academy_attestations.worker_id IS
  'FK to people(worker_id) - the STINT, not the person. Attestations
   hang off the stint per spec Section 2.1 so "rehires always redo
   onboarding" is structural rather than a maintained rule. A
   returning seasonal worker gets a new worker_id and starts with
   zero signatures against it, even though their person_id may
   already carry signatures from a prior stint.';

COMMENT ON COLUMN academy_attestations.person_id IS
  'Denormalized copy of academy_person_stints.person_id at signing
   time. No FK - the stint could theoretically be reassigned to a
   different person_id by a manual override, and the historical
   attestation should carry the person_id that was true when it
   was signed.';

COMMENT ON COLUMN academy_attestations.certificate_serial IS
  'Format `KFA-YYYY-NNNNNN`. Year is context; uniqueness comes from
   academy_certificate_seq which never resets. Six-digit padding is
   soft - a serial number greater than 999999 grows to seven digits
   without loss of sort order (KFA-2026-000001 < KFA-2026-1000000
   lexically).';

COMMENT ON COLUMN academy_attestations.supersedes IS
  'FK to academy_attestations(attestation_id). The CORRECTING row
   carries this pointing at what it replaces. Direction inverts
   from the spec Section 7.2 original wording so append-only holds
   (setting superseded_by on the old row would be an UPDATE, which
   this table forbids). "Is X current?" becomes "does any row
   supersede X?" - a NOT EXISTS query, not a stored flag.';


-- ─── Row-level security posture ─────────────────────────────────────
-- Same as prior academy migrations: RLS disabled, auth is app-layer
-- via NextAuth + opdAcl + resolveAcademyIdentity.
ALTER TABLE academy_questions        DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_check_attempts   DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_module_progress  DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_attestations     DISABLE ROW LEVEL SECURITY;


-- ─── Grants ─────────────────────────────────────────────────────────
-- academy_questions: authored + approved + revised in place while
-- draft. Retired instead of deleted (attempts FK the row).
GRANT SELECT, INSERT, UPDATE          ON academy_questions       TO service_role;

-- academy_check_attempts: APPEND-ONLY. Post-flight assertion refuses
-- to apply if UPDATE/DELETE/TRUNCATE is present.
GRANT SELECT, INSERT                  ON academy_check_attempts  TO service_role;

-- academy_module_progress: mutable scratch state (see table comment).
GRANT SELECT, INSERT, UPDATE          ON academy_module_progress TO service_role;

-- academy_attestations: APPEND-ONLY. Post-flight assertion refuses
-- to apply if UPDATE/DELETE/TRUNCATE is present.
GRANT SELECT, INSERT                  ON academy_attestations    TO service_role;

-- Sequences the app needs for INSERT with defaults.
GRANT USAGE, SELECT ON SEQUENCE academy_questions_question_id_seq         TO service_role;
GRANT USAGE, SELECT ON SEQUENCE academy_certificate_seq                   TO service_role;

-- TRUNCATE is granted to service_role by the Supabase DEFAULT
-- PRIVILEGES record (service_role=Dxtm/postgres - the D is
-- TRUNCATE), so not granting is insufficient. Explicit REVOKE from
-- all three roles for every append-only table PLUS module_progress
-- as defense-in-depth (a mutable scratch table with TRUNCATE would
-- wipe every learner's progress in one statement; that is a defect
-- shape we do not want reachable from app code).
REVOKE TRUNCATE ON academy_questions        FROM service_role, anon, authenticated;
REVOKE TRUNCATE ON academy_check_attempts   FROM service_role, anon, authenticated;
REVOKE TRUNCATE ON academy_module_progress  FROM service_role, anon, authenticated;
REVOKE TRUNCATE ON academy_attestations     FROM service_role, anon, authenticated;


-- ─── Post-flight assertion ──────────────────────────────────────────
-- The append-only grant surface is the load-bearing invariant of this
-- migration. Assert the negative space (UPDATE, DELETE, TRUNCATE all
-- absent on the three roles) for both academy_check_attempts and
-- academy_attestations. A single held privilege on any of the three
-- roles fails the apply.
--
-- Also assert TRUNCATE absent on academy_questions and
-- academy_module_progress - neither should be truncatable from app
-- code even though both accept mutation.
DO $$
DECLARE
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
    'academy_questions|authenticated|TRUNCATE',
    'academy_module_progress|service_role|TRUNCATE',
    'academy_module_progress|anon|TRUNCATE',
    'academy_module_progress|authenticated|TRUNCATE'
  ];
  parts TEXT[];
  t TEXT; r TEXT; p TEXT;
BEGIN
  FOREACH bad IN ARRAY privilege_grants LOOP
    parts := string_to_array(bad, '|');
    t := parts[1]; r := parts[2]; p := parts[3];
    IF has_table_privilege(r, t, p) THEN
      RAISE EXCEPTION 'academy-9 post-flight: % has % on % (append-only invariant broken; the REVOKE block above must run before this assertion)', r, p, t;
    END IF;
  END LOOP;

  -- Positive grants: service_role can SELECT + INSERT the two
  -- append-only tables (the point of them existing).
  IF NOT has_table_privilege('service_role', 'academy_attestations', 'SELECT') THEN
    RAISE EXCEPTION 'academy-9 post-flight: service_role missing SELECT on academy_attestations';
  END IF;
  IF NOT has_table_privilege('service_role', 'academy_attestations', 'INSERT') THEN
    RAISE EXCEPTION 'academy-9 post-flight: service_role missing INSERT on academy_attestations';
  END IF;
  IF NOT has_table_privilege('service_role', 'academy_check_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'academy-9 post-flight: service_role missing SELECT on academy_check_attempts';
  END IF;
  IF NOT has_table_privilege('service_role', 'academy_check_attempts', 'INSERT') THEN
    RAISE EXCEPTION 'academy-9 post-flight: service_role missing INSERT on academy_check_attempts';
  END IF;
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION B - VERIFY BLOCK (P1 / P2 / P5)
--            run as a separate submission against committed state.
-- ═══════════════════════════════════════════════════════════════════

-- P1. All four tables + one sequence exist.
-- Expected: 4 rows in the first query, 1 row in the second.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'academy_questions',
    'academy_check_attempts',
    'academy_module_progress',
    'academy_attestations'
  )
ORDER BY table_name;

SELECT sequence_name
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name = 'academy_certificate_seq';


-- P2. Row counts on first apply.
-- Expected: 0 / 0 / 0 / 0.
SELECT
  (SELECT count(*) FROM academy_questions)         AS questions,
  (SELECT count(*) FROM academy_check_attempts)    AS check_attempts,
  (SELECT count(*) FROM academy_module_progress)   AS module_progress,
  (SELECT count(*) FROM academy_attestations)      AS attestations;


-- P5. Append-only grant surface. Neither UPDATE, DELETE, nor TRUNCATE
-- is present on service_role, anon, or authenticated for the two
-- append-only tables. TRUNCATE not present on the other two either
-- (defense-in-depth).
-- Expected: 0 rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
  AND (
    (table_name = 'academy_attestations'    AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE'))
    OR (table_name = 'academy_check_attempts'   AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE'))
    OR (table_name = 'academy_questions'        AND privilege_type = 'TRUNCATE')
    OR (table_name = 'academy_module_progress'  AND privilege_type = 'TRUNCATE')
  )
ORDER BY table_name, grantee, privilege_type;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION C - MANDATORY PROBES
--            Two probes. Each is its own BEGIN;...ROLLBACK; so state
--            never persists. Each RAISES EXCEPTION carrying the
--            observed values on SUCCESS - Studio swallows NOTICE, so
--            "PROBE OK" as a notice is indistinguishable from a probe
--            that did nothing. Raising surfaces the numbers and the
--            rollback comes free (an unhandled exception aborts the
--            transaction).
--
--            Both probes SET LOCAL ROLE service_role first so they
--            test the app-facing grant surface, not the superuser
--            path Studio runs as by default. The postgres role a
--            Studio session runs under holds every privilege and
--            would trivially satisfy any probe run under it.
-- ═══════════════════════════════════════════════════════════════════

-- ─── C1: MANDATORY probe - client-supplied UUID insert + column verify
-- Insert one attestation as service_role with a client-supplied UUID,
-- read every column back, verify each landed as intended including
-- a well-formed certificate_serial matching /^KFA-\d{4}-\d{6,}$/.
-- Asserts the ROWS THAT LANDED, not what the INSERT returned - that
-- is the gap that let the person_id defect ship.
--
-- Expected on run: raises "PROBE 1 OK a9: ..." with the observed
-- values. If it raises anything else, the apply is NOT complete.
BEGIN;

DO $probe1$
DECLARE
  v_id UUID := 'a9a90001-0000-4000-8000-000000000001';
  v_worker TEXT := '6418e1e52a44e07c8b303f7b';  -- Kevin's worker_id
  v_typed TEXT := 'Probe Kevin';
  v_att_text TEXT := 'I, Probe Kevin, have read and understood Probe Document, version 1.0, and I will hold this standard at my sites.';
  v_landed_id UUID;
  v_landed_worker TEXT;
  v_landed_typed TEXT;
  v_landed_att TEXT;
  v_landed_doc TEXT;
  v_landed_version TEXT;
  v_landed_source TEXT;
  v_landed_serial TEXT;
  v_landed_attempts INT;
  v_landed_time INT;
  v_landed_signed_at TIMESTAMPTZ;
BEGIN
  SET LOCAL ROLE service_role;

  INSERT INTO academy_attestations (
    attestation_id, worker_id, person_id, requirement_id,
    doc_id, obligation_key, doc_version,
    typed_name, attestation_text, attempts_count, time_spent_seconds,
    source
  ) VALUES (
    v_id, v_worker, NULL, NULL,
    'PB-014', 'probe-a9-1', '1.0',
    v_typed, v_att_text, 2, 137,
    'intranet'
  );

  -- Read back EVERY column that the probe supplied plus the ones
  -- the DEFAULT expressions filled. Assert each landed as intended.
  SELECT attestation_id, worker_id, typed_name, attestation_text,
         doc_id, doc_version, source,
         certificate_serial, attempts_count, time_spent_seconds, signed_at
    INTO v_landed_id, v_landed_worker, v_landed_typed, v_landed_att,
         v_landed_doc, v_landed_version, v_landed_source,
         v_landed_serial, v_landed_attempts, v_landed_time, v_landed_signed_at
  FROM academy_attestations
  WHERE attestation_id = v_id;

  IF v_landed_id IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: client-supplied attestation_id did not land (expected % got %)', v_id, v_landed_id;
  END IF;
  IF v_landed_worker <> v_worker THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: worker_id did not land (got %)', v_landed_worker;
  END IF;
  IF v_landed_typed <> v_typed THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: typed_name did not land verbatim (got "%")', v_landed_typed;
  END IF;
  IF v_landed_att <> v_att_text THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: attestation_text did not land verbatim - the whole point of storing it as text is that it does NOT drift';
  END IF;
  IF v_landed_doc <> 'PB-014' OR v_landed_version <> '1.0' THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: doc_id / doc_version denormalization did not land (got % / %)', v_landed_doc, v_landed_version;
  END IF;
  IF v_landed_source <> 'intranet' THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: source did not land (got %)', v_landed_source;
  END IF;
  IF v_landed_attempts <> 2 THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: attempts_count did not land (got %)', v_landed_attempts;
  END IF;
  IF v_landed_time <> 137 THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: time_spent_seconds did not land (got %)', v_landed_time;
  END IF;
  IF v_landed_signed_at IS NULL THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: signed_at DEFAULT NOW() did not land';
  END IF;
  IF v_landed_serial IS NULL THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: certificate_serial DEFAULT did not land';
  END IF;
  IF v_landed_serial !~ '^KFA-[0-9]{4}-[0-9]{6,}$' THEN
    RAISE EXCEPTION 'PROBE 1 FAIL: certificate_serial malformed (got "%") - expected KFA-YYYY-NNNNNN', v_landed_serial;
  END IF;

  RESET ROLE;

  -- SUCCESS. Raise with the values so Studio surfaces them (notices
  -- are swallowed). The exception aborts the transaction; ROLLBACK
  -- below runs against an already-aborted tx and is a no-op.
  RAISE EXCEPTION E'PROBE 1 OK a9:\n  attestation_id=%\n  worker_id=%\n  typed_name="%"\n  doc=% v%\n  source=%\n  attempts=%\n  time_spent_seconds=%\n  certificate_serial=%\n  signed_at=%',
    v_landed_id, v_landed_worker, v_landed_typed, v_landed_doc, v_landed_version,
    v_landed_source, v_landed_attempts, v_landed_time, v_landed_serial, v_landed_signed_at;
END
$probe1$;

ROLLBACK;


-- ─── C2: MANDATORY probe - UPDATE and DELETE are refused
-- Same shape: insert one attestation as service_role, then attempt
-- UPDATE and DELETE against that row as service_role. Both must
-- raise insufficient_privilege. If either succeeds, the append-only
-- grant surface has failed - the apply is NOT complete.
--
-- Expected on run: raises "PROBE 2 OK a9: ..." with both refusal
-- flags true.
BEGIN;

DO $probe2$
DECLARE
  v_id UUID := 'a9a90002-0000-4000-8000-000000000002';
  v_worker TEXT := '6418e1e52a44e07c8b303f7b';
  v_upd_refused BOOLEAN := FALSE;
  v_del_refused BOOLEAN := FALSE;
  v_upd_sqlstate TEXT;
  v_del_sqlstate TEXT;
BEGIN
  SET LOCAL ROLE service_role;

  INSERT INTO academy_attestations (
    attestation_id, worker_id, doc_id, obligation_key, doc_version,
    typed_name, attestation_text, attempts_count, source
  ) VALUES (
    v_id, v_worker, 'PB-014', 'probe-a9-2', '1.0',
    'Probe Kevin', 'I, Probe Kevin, have read and understood...', 1,
    'intranet'
  );

  -- UPDATE must be refused with SQLSTATE 42501 (insufficient_privilege).
  BEGIN
    UPDATE academy_attestations SET typed_name = 'tampered' WHERE attestation_id = v_id;
    -- If we reach here, UPDATE succeeded - grant surface is wrong.
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_upd_refused := TRUE;
      v_upd_sqlstate := SQLSTATE;
  END;
  IF NOT v_upd_refused THEN
    RAISE EXCEPTION 'PROBE 2 FAIL: UPDATE on academy_attestations succeeded as service_role. Append-only invariant broken.';
  END IF;

  -- DELETE must be refused with SQLSTATE 42501.
  BEGIN
    DELETE FROM academy_attestations WHERE attestation_id = v_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_del_refused := TRUE;
      v_del_sqlstate := SQLSTATE;
  END;
  IF NOT v_del_refused THEN
    RAISE EXCEPTION 'PROBE 2 FAIL: DELETE on academy_attestations succeeded as service_role. Append-only invariant broken.';
  END IF;

  RESET ROLE;

  RAISE EXCEPTION 'PROBE 2 OK a9: upd_refused=% (SQLSTATE %) del_refused=% (SQLSTATE %) - both raised insufficient_privilege as expected',
    v_upd_refused, v_upd_sqlstate, v_del_refused, v_del_sqlstate;
END
$probe2$;

ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying Section A (BEGIN/COMMIT
-- succeeded), running Section B against committed state, and running
-- Section C1 + C2 individually. Both probes MUST raise their
-- respective "PROBE N OK" messages carrying the observed values.
-- If either raises "PROBE N FAIL" or any other exception, the apply
-- is NOT complete and `applied in Studio: YES` MUST NOT be posted.
--
-- The migration-gate check on this PR looks for the phrase
-- `applied in Studio: YES` in a comment from an OWNER account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- section_a_commit:   <expected: COMMIT succeeded, no exceptions>
-- p1_tables:          <expected 4 rows>
-- p1_sequence:        <expected 1 row>
-- p2_row_counts:      <expected 0 / 0 / 0 / 0>
-- p5_grants:          <expected 0 rows>
-- c1_probe:           <expected exception "PROBE 1 OK a9: ..." with
--                      the inserted values + a well-formed
--                      certificate_serial>
-- c2_probe:           <expected exception "PROBE 2 OK a9: upd_refused=t
--                      del_refused=t ...">
-- notes:              <optional>
