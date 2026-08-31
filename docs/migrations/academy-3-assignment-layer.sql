-- ═══════════════════════════════════════════════════════════════════
-- academy-3-assignment-layer.sql
--
-- Migration 3 of the Academy split (spec Section 16.1). Four tables
-- that turn authored obligations into "this specific person owes
-- this specific document, at this version, by this specific date."
--
-- The Academy split as of this migration:
--   1 identity          persons, stints, exceptions, grants
--   2 region-leads      region -> RDO email (owner-maintained)
--   3 assignment layer  obligations, cycles, cycle_modules, requirements   <-- THIS
--   4 signature layer   questions, check_attempts, module_progress, attestations
--   5 delivery          portal_tokens, email_events, admin_audit
--
-- Tables authored here
-- ────────────────────
--   academy_obligations     projection target from MDX. Empty until PR 4
--                             extends scripts/content/project-catalog.mjs.
--   academy_cycles          calendar-month cycles. Enforced in schema.
--   academy_cycle_modules   docs pinned to a cycle (with the version).
--   academy_requirements    the resolved who-owes-what ledger. Denormalized
--                             deliberately; see the table comment for why.
--
-- Namespace + apply discipline
-- ────────────────────────────
-- `academy_*` prefix per spec Section 13. Same discipline as
-- academy-1 and academy-2: CREATE TABLE IF NOT EXISTS, verify block
-- with expected values, applied-in-Studio attestation footer.
-- Author only - Kevin applies statements sequentially in Supabase
-- Studio; the migration-gate check on this PR fails until Kevin
-- comments `applied in Studio: YES`.
--
-- No seed data
-- ────────────
-- Cycles are created in the Cycle Builder, which does not exist yet.
-- The projection writes obligations in PR 4. Requirements are
-- issued when a cycle publishes or an onboarding/rehire trigger
-- fires - all logic that lands in later PRs. This migration creates
-- the shapes, no rows.
-- ═══════════════════════════════════════════════════════════════════


-- ─── academy_obligations ───────────────────────────────────────────
-- The projection target. UPSERTed by PR 4's extension to
-- scripts/content/project-catalog.mjs. NOT append-only: an obligation
-- removed from a document must be removable from the table so the
-- projection can mirror the MDX truthfully. service_role therefore
-- carries DELETE here (unusual for the Academy family; deliberate).
CREATE TABLE IF NOT EXISTS academy_obligations (
  obligation_id   BIGSERIAL   PRIMARY KEY,
  doc_id          TEXT        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  obligation_key  TEXT        NOT NULL,
  doc_version     TEXT        NOT NULL,
  type            TEXT        NOT NULL
                    CHECK (type IN (
                      'permit_renewal', 'cert_renewal', 'review', 'training',
                      'audit', 'inspection', 'report', 'other'
                    )),
  cadence         TEXT        NOT NULL
                    CHECK (cadence IN (
                      'annual', 'biannual', 'quarterly', 'monthly',
                      'weekly', 'daily', 'one-time', 'per-event', 'on-hire'
                    )),
  owner           TEXT        NOT NULL,
  source_section  TEXT,
  description     TEXT,
  est_minutes     INTEGER     CHECK (est_minutes IS NULL OR est_minutes > 0),
  applies_to      JSONB       NOT NULL DEFAULT '{}',
  next_due        DATE,
  source_hash     TEXT,
  projected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_id, obligation_key)
);

CREATE INDEX IF NOT EXISTS academy_obligations_applies_to_gin
  ON academy_obligations USING GIN (applies_to);

COMMENT ON TABLE academy_obligations IS
  'Projected copy of the obligations block from content/documents/
   *.mdx frontmatter. UPSERTed by PR 4''s extension to
   scripts/content/project-catalog.mjs; empty until then. The CHECK
   values mirror the frontmatter schema''s type + cadence enums
   verbatim (all 8 types, all 9 cadences including on-hire) - the
   table stores what documents author, not the Academy''s subset.
   The Academy consumes only type IN (training, cert_renewal); the
   other six types belong to the compliance calendar, which reads
   the same rows.';

COMMENT ON COLUMN academy_obligations.doc_id IS
  'FK to documents(id) ON DELETE CASCADE. The archive_document RPC
   (pr-7-7) only sets a flag, it does not DELETE, so cascade does
   NOT fire on archive; archive is handled by the projection
   re-reading the MDX. Cascade exists to cover the rare owner-run
   one-off DELETE (e.g., pr-7-5 poster-id fix) so those do not leave
   orphaned obligation rows behind.';

COMMENT ON COLUMN academy_obligations.applies_to IS
  'Raw scope object as authored. Two shapes both valid per the
   frontmatter schema oneOf: the string "company-wide" or an object
   with any subset of {states, account, role, worker_class}.
   JSONB preserves both so the resolver can inspect either shape.
   worker_class IS the only reliable audience dimension in v1 -
   applies_to.role is free text and matches nothing in people, and
   states/account may be sparse; the resolver in PR 5+ will pin on
   worker_class first and fall back defensively.';

COMMENT ON COLUMN academy_obligations.doc_version IS
  'Document version at projection time. A material version publish
   (spec Section 12.3) re-projects with a new value; the previous
   obligation row stays until the projection removes it, and the
   resolver decides expiry / re-cert issuance in a later PR.';


-- ─── academy_cycles ────────────────────────────────────────────────
-- Calendar-month cycles (spec Section 6, ruling 2026-08-31). The
-- calendar-month invariant is enforced in the schema, not left to
-- UI convention.
CREATE TABLE IF NOT EXISTS academy_cycles (
  cycle_id          BIGSERIAL   PRIMARY KEY,
  label             TEXT        NOT NULL,
  period_start      DATE        NOT NULL UNIQUE,
  period_end        DATE        NOT NULL,
  fiscal_year       INTEGER,
  fiscal_period_no  INTEGER,
  status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published', 'closed')),
  published_at      TIMESTAMPTZ,
  published_by      TEXT,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT        NOT NULL,

  -- Calendar-month invariants. Two CHECKs so a violation names
  -- the specific rule that failed rather than a mixed message.
  CONSTRAINT academy_cycles_starts_on_first
    CHECK (EXTRACT(DAY FROM period_start) = 1),
  CONSTRAINT academy_cycles_ends_on_month_last_day
    CHECK (period_end = (period_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE),

  -- Published cycles must record who published them and when. Draft
  -- and closed states leave these NULL / carry them from the prior
  -- publish; neither combination is invalid.
  CONSTRAINT academy_cycles_published_complete
    CHECK (status <> 'published' OR (published_at IS NOT NULL AND published_by IS NOT NULL))
);

COMMENT ON TABLE academy_cycles IS
  'One row per Academy cycle. Cycles are ALWAYS calendar months per
   Kevin''s ruling (spec Section 6); the two CHECKs on period_start
   and period_end enforce that invariant at the DB rather than
   trusting the Cycle Builder UI. Fiscal year + period are displayed
   as secondary context in the Academy but never drive cycle
   boundaries, because the Academy is the one intranet surface that
   is not about money. Draft cycles issue no requirements; only a
   published cycle writes rows into academy_requirements. Closed
   cycles are read-only history.';

COMMENT ON COLUMN academy_cycles.label IS
  'Human label, typically the month name (e.g. "September 2026").
   Displayed on the Cycle Builder + on the operator queue; not a
   uniqueness constraint (period_start is).';


-- ─── academy_cycle_modules ─────────────────────────────────────────
-- Documents pinned to a cycle. The doc_version is written when the
-- cycle publishes so a later MDX edit does not silently retarget
-- the cycle. Cascade on cycle delete is correct: a deleted draft
-- takes its module list with it.
CREATE TABLE IF NOT EXISTS academy_cycle_modules (
  cycle_id         BIGINT   NOT NULL REFERENCES academy_cycles (cycle_id) ON DELETE CASCADE,
  doc_id           TEXT     NOT NULL,
  obligation_key   TEXT     NOT NULL,
  doc_version      TEXT     NOT NULL,
  est_minutes      INTEGER  CHECK (est_minutes IS NULL OR est_minutes > 0),
  sort_order       INTEGER  NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_id, doc_id, obligation_key)
);

COMMENT ON TABLE academy_cycle_modules IS
  'The module list for a cycle. Written by the Cycle Builder in a
   later PR. No FK to academy_obligations - modules pin the exact
   (doc_id, obligation_key, doc_version) that was authored when the
   cycle was built, and that pin must survive a subsequent obligation
   re-author. Cascade on cycle delete is the correct semantic for
   the draft-cycle case: deleting a draft removes its module list.
   Published cycles are protected by the requirements they issued
   (see academy_requirements).';


-- ─── academy_requirements ──────────────────────────────────────────
-- The resolved who-owes-what ledger. Deliberately denormalized:
-- see the table comment for the full rationale. Waivers, not
-- deletions. Satisfaction is answered by the attestation (added in
-- migration 4), not by a status column here.
CREATE TABLE IF NOT EXISTS academy_requirements (
  requirement_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id        TEXT        NOT NULL REFERENCES people (worker_id),
  person_id        UUID,
  doc_id           TEXT        NOT NULL,
  obligation_key   TEXT        NOT NULL,
  doc_version      TEXT        NOT NULL,
  est_minutes      INTEGER     CHECK (est_minutes IS NULL OR est_minutes > 0),
  source           TEXT        NOT NULL
                     CHECK (source IN ('cycle', 'onboarding', 'rehire', 'version_recert', 'manual')),
  cycle_id         BIGINT      REFERENCES academy_cycles (cycle_id),
  due_date         DATE        NOT NULL,
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by        TEXT        NOT NULL,
  waived_at        TIMESTAMPTZ,
  waived_by        TEXT,
  waive_reason     TEXT,

  -- Cycle-source requirements MUST carry a cycle_id; non-cycle
  -- sources MUST NOT. Prevents an orphan cycle-source row from
  -- becoming a mystery in the queue.
  CONSTRAINT academy_requirements_cycle_id_matches_source
    CHECK (
      (source = 'cycle'    AND cycle_id IS NOT NULL) OR
      (source <> 'cycle'   AND cycle_id IS NULL)
    ),

  -- Waiver is all-or-nothing. A waiver without a reason is not a
  -- waiver, and a reason without a stamp is authoring garbage.
  CONSTRAINT academy_requirements_waiver_all_or_none
    CHECK (
      (waived_at IS NULL AND waived_by IS NULL AND waive_reason IS NULL) OR
      (waived_at IS NOT NULL AND waived_by IS NOT NULL AND waive_reason IS NOT NULL)
    )
);

-- Uniqueness: (worker, doc, obligation, version, source, cycle_id).
-- COALESCE(cycle_id, -1) collapses NULL into a sentinel so unique
-- treats "no cycle" as one value rather than "unknown != unknown".
-- Without this, two onboarding requirements for the same worker on
-- the same doc/obligation/version could silently duplicate.
-- -1 is safe because cycle_id is a positive BIGSERIAL that never
-- reaches negative values.
CREATE UNIQUE INDEX IF NOT EXISTS academy_requirements_unique_issue
  ON academy_requirements (worker_id, doc_id, obligation_key, doc_version, source, COALESCE(cycle_id, -1));

-- Operator queue: fetch a person's requirements ordered by due date.
CREATE INDEX IF NOT EXISTS academy_requirements_worker_due_idx
  ON academy_requirements (worker_id, due_date);

-- Cycle reporting: gather everything a cycle issued for a rollup.
CREATE INDEX IF NOT EXISTS academy_requirements_cycle_idx
  ON academy_requirements (cycle_id);

COMMENT ON TABLE academy_requirements IS
  'The resolved who-owes-what ledger. Rows are historical FACTS:
   "on September 1, this worker was required to read PB-014 v1.0,
   module culture-os-origin, because the September cycle published."
   That fact does not stop being true when the MDX is later edited
   and the obligation disappears from the projection.

   DELIBERATE DENORMALIZATION (do NOT "fix" this):
   The columns doc_id, obligation_key, doc_version, est_minutes are
   copied from academy_obligations at issuance time and carry no FK
   back. An FK with ON DELETE CASCADE would silently destroy the
   audit trail when an obligation is re-authored; an FK without
   cascade would block legitimate content edits. Neither is
   acceptable. The requirement carries its own copy of what was
   owed.

   Waivers are the only softening: a requirement can be waived
   (with a required reason string) but NEVER destroyed. service_role
   holds SELECT / INSERT / UPDATE - never DELETE. A post-flight
   assertion below fails apply if DELETE is ever granted.

   SATISFACTION lives on the attestation, not on this table. A
   satisfied_by pointer will be added in migration 4, the same
   migration that creates the attestation it points at. No status
   column here - a second source of truth for something the
   attestation already answers would drift immediately.';

COMMENT ON COLUMN academy_requirements.worker_id IS
  'FK to people(worker_id) - the STINT, not the person. Spec Section
   2.1: attestations hang off the stint so "rehires always redo
   onboarding" is structural rather than a maintained rule.
   person_id below is denormalized for history queries across
   employment periods.';

COMMENT ON COLUMN academy_requirements.person_id IS
  'Denormalized copy of academy_person_stints.person_id for the
   worker_id at issuance time. No FK; the stint could theoretically
   be reassigned to a different person_id by a manual override, and
   the historical requirement should carry the person_id that was
   true when it was issued.';


-- ─── RLS + grants ──────────────────────────────────────────────────
-- Same posture as academy-1 and academy-2: RLS disabled (auth is
-- app-layer via NextAuth + opdAcl + resolveAcademyIdentity),
-- service_role writes, anon + authenticated inherit REFERENCES +
-- TRIGGER by default from the postgres DEFAULT PRIVILEGES record
-- (see _GRANT_TEMPLATE.md). Grants differ per table by design;
-- see per-line rationale below.
ALTER TABLE academy_obligations   DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_cycles        DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_cycle_modules DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_requirements  DISABLE ROW LEVEL SECURITY;

-- academy_obligations: DELETE granted because the projection must
-- be able to remove an obligation the MDX has removed.
GRANT SELECT, INSERT, UPDATE, DELETE ON academy_obligations   TO service_role;

-- academy_cycles: no DELETE from the app. Deleting a draft cycle
-- is an owner-only Studio operation (same reasoning as academy-1's
-- rebuild note). A published or closed cycle is history and must
-- not be deletable at all.
GRANT SELECT, INSERT, UPDATE                ON academy_cycles TO service_role;

-- academy_cycle_modules: added and removed freely while a cycle
-- is draft. Cascade from cycles handles the draft-delete path.
GRANT SELECT, INSERT, UPDATE, DELETE ON academy_cycle_modules TO service_role;

-- academy_requirements: NEVER DELETE. Waivers, not deletions.
-- The post-flight assertion below enforces this at apply time.
GRANT SELECT, INSERT, UPDATE                ON academy_requirements TO service_role;

-- Defensive: sequence grants for the BIGSERIAL / UUID columns.
-- Only service_role needs USAGE on these; anon + authenticated get
-- nothing on the sequences.
GRANT USAGE, SELECT ON SEQUENCE academy_obligations_obligation_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE academy_cycles_cycle_id_seq           TO service_role;


-- ─── Post-flight assertion: no DELETE on academy_requirements ──────
-- Same shape as kpi-8a-rippling-raw.sql:329-339. Reads the current
-- grants via has_table_privilege and fails the apply if DELETE is
-- present on any role other than the owner (the table owner is
-- outside the has_table_privilege('service_role'|'anon'|
-- 'authenticated', ...) query set by construction).
DO $$
DECLARE
  req_sr_del  BOOLEAN;
  req_anon_del BOOLEAN;
  req_auth_del BOOLEAN;
BEGIN
  req_sr_del   := has_table_privilege('service_role',   'academy_requirements', 'DELETE');
  req_anon_del := has_table_privilege('anon',           'academy_requirements', 'DELETE');
  req_auth_del := has_table_privilege('authenticated',  'academy_requirements', 'DELETE');
  IF req_sr_del THEN
    RAISE EXCEPTION 'post-flight: service_role has DELETE on academy_requirements (must be waived, never destroyed - see table comment)';
  END IF;
  IF req_anon_del THEN
    RAISE EXCEPTION 'post-flight: anon has DELETE on academy_requirements (must be waived, never destroyed)';
  END IF;
  IF req_auth_del THEN
    RAISE EXCEPTION 'post-flight: authenticated has DELETE on academy_requirements (must be waived, never destroyed)';
  END IF;
END
$$;


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   P1 + P2 + P5 run cleanly and are safe on every apply.
--
--   P3 + P4 are commented-out probes Kevin runs DELIBERATELY - they
--   are DML wrapped in a transaction that ROLLBACKs, so they never
--   leave data behind, but they still touch the table and belong
--   outside the automatic apply so a rerun is a conscious act.
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. All four tables exist.
-- Expected: 4 rows.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'academy_obligations',
    'academy_cycles',
    'academy_cycle_modules',
    'academy_requirements'
  )
ORDER BY table_name;

-- P2. Row counts on first apply.
-- Expected: 0 / 0 / 0 / 0.
SELECT
  (SELECT count(*) FROM academy_obligations)    AS obligations,
  (SELECT count(*) FROM academy_cycles)         AS cycles,
  (SELECT count(*) FROM academy_cycle_modules)  AS cycle_modules,
  (SELECT count(*) FROM academy_requirements)   AS requirements;

-- P5. DELETE not granted on academy_requirements to anon or authenticated.
-- Expected: 0 rows.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'academy_requirements'
  AND grantee IN ('anon', 'authenticated', 'service_role')
  AND privilege_type = 'DELETE';


-- ─── P3 (probe, run deliberately) ──────────────────────────────────
-- The cadence CHECK accepts all 9 values including `on-hire`.
-- Inserts 9 sentinel rows in a transaction, counts them, ROLLBACK.
-- Requires a documents row to satisfy the FK - the SENTINEL id
-- below must exist; substitute an actual live doc id (e.g. PB-014).
--
-- Expected on run: cadence_ok = 9.
--
--   BEGIN;
--   INSERT INTO academy_obligations
--     (doc_id, obligation_key, doc_version, type, cadence, owner)
--   VALUES
--     ('PB-014', 'p3-annual',    'p3', 'training', 'annual',     'probe'),
--     ('PB-014', 'p3-biannual',  'p3', 'training', 'biannual',   'probe'),
--     ('PB-014', 'p3-quarterly', 'p3', 'training', 'quarterly',  'probe'),
--     ('PB-014', 'p3-monthly',   'p3', 'training', 'monthly',    'probe'),
--     ('PB-014', 'p3-weekly',    'p3', 'training', 'weekly',     'probe'),
--     ('PB-014', 'p3-daily',     'p3', 'training', 'daily',      'probe'),
--     ('PB-014', 'p3-onetime',   'p3', 'training', 'one-time',   'probe'),
--     ('PB-014', 'p3-perevent',  'p3', 'training', 'per-event',  'probe'),
--     ('PB-014', 'p3-onhire',    'p3', 'training', 'on-hire',    'probe');
--   SELECT count(*) AS cadence_ok FROM academy_obligations WHERE owner = 'probe';
--   ROLLBACK;


-- ─── P4 (probe, run deliberately) ──────────────────────────────────
-- Calendar-month CHECK rejects a non-first-of-month period_start.
-- Both statements below MUST error with the named CHECK constraint.
-- If either succeeds, the invariant is missing and the apply is
-- incomplete.
--
--   BEGIN;
--   INSERT INTO academy_cycles (label, period_start, period_end, created_by)
--   VALUES ('P4 not first', '2026-09-02', '2026-09-30', 'probe');
--   -- Expected error: violates check constraint "academy_cycles_starts_on_first"
--   ROLLBACK;
--
--   BEGIN;
--   INSERT INTO academy_cycles (label, period_start, period_end, created_by)
--   VALUES ('P4 wrong end', '2026-09-01', '2026-09-29', 'probe');
--   -- Expected error: violates check constraint "academy_cycles_ends_on_month_last_day"
--   ROLLBACK;
--
--   BEGIN;
--   INSERT INTO academy_cycles (label, period_start, period_end, status, created_by)
--   VALUES ('P4 published no ts', '2026-10-01', '2026-10-31', 'published', 'probe');
--   -- Expected error: violates check constraint "academy_cycles_published_complete"
--   ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file (statements applied
-- sequentially) in Supabase Studio. The migration-gate check on this
-- PR looks for the phrase `applied in Studio: YES` in a comment from
-- an OWNER account and re-emits the check_run on the current SHA.
--
-- applied in Studio: PENDING
-- sha:               <fill in commit SHA>
-- applied by:        k.fietek@kitchfix.com
-- applied at:        <fill in ISO timestamp>
-- p1_tables:         <expected 4 rows>
-- p2_row_counts:     <expected 0 / 0 / 0 / 0>
-- p3_cadence_ok:    <run probe; expected 9>
-- p4_check_rejects: <run three probes; each must error on its named CHECK>
-- p5_no_delete:      <expected 0 rows>
-- notes:             <optional>
