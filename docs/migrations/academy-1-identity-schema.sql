-- ═══════════════════════════════════════════════════════════════════
-- academy-1-identity-schema.sql
--
-- PR 1 of the Academy build. Four tables that establish the identity
-- foundation the rest of the Academy hangs off of. No obligations,
-- no cycles, no attestations - those land in later migrations. The
-- reason this is the first migration and stands alone: it has zero
-- dependency on the content schema, so the pending frontmatter
-- extension (open ruling 17.6 in ACADEMY_MASTER_SPEC.md) cannot
-- invalidate anything here.
--
-- Tables authored
-- ───────────────
--   academy_persons                stable identity above the stint
--   academy_person_stints          worker_id -> person_id map
--   academy_eligibility_exceptions include/exclude override list
--   academy_grants                 library_admin / academy_admin
--
-- The person-above-stint split is spec Section 2.1. worker_id is a
-- Rippling employment stint (not a person); seasonal rehires get a
-- new worker_id each season but keep their personal_email. Person
-- identity keyed on normalized personal_email keeps returning
-- workers' history legible without merging their compliance records
-- across employment periods. Stints for compliance, person for
-- history. These never merge.
--
-- Namespace posture
-- ─────────────────
-- Every table is `academy_*` prefixed. The namespace was verified
-- greenfield in `public` on 2026-08-31 (docs/opd/alignment/
-- SECTION_G_POSTGRES_INVENTORY.md). `public.users` exists but is a
-- zero-row orphan - the prefix sidesteps it without a low-value
-- cleanup migration.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies statements sequentially in Supabase Studio.
--    The migration-gate check on this PR fails until Kevin comments
--    `applied in Studio: YES` from the OWNER account.
-- 2. Every statement is IF NOT EXISTS / OR REPLACE / ON CONFLICT
--    guarded, so re-application is a safe no-op. The backfill lives
--    inside two INSERT ... ON CONFLICT DO NOTHING blocks and is also
--    safe to run twice.
-- 3. The verify probes at the end of the file report the expected
--    row counts (887 persons, 1,129 stints, 1 exception, 2 grants)
--    and MUST return the expected values before this migration is
--    considered applied. If any probe disagrees, do not proceed to
--    PR 2/3/4 - flag the drift.
-- 4. Fill in the attestation block at the end of the file with the
--    commit SHA the apply matched.
--
-- PII posture
-- ───────────
-- `people.personal_email` carries the standing "NEVER selected by
-- any application route" policy (people-1-table.sql:118-121). The
-- Academy hourly portal (spec Section 2.5) is the opt-in workflow
-- that policy anticipated. `natural_key` on academy_persons is a
-- one-way DERIVED value (lower(trim(personal_email))) that lets us
-- ORDER, GROUP, and JOIN without ever needing to SELECT the address
-- itself back through any route. The address stays in people; one
-- copy of the truth means a Rippling update cannot leave a stale
-- copy behind.
--
-- Ownership model
-- ───────────────
-- academy_persons.display_name is a legibility field, not authority.
-- The nightly derive (added in a later PR, not this one - see
-- Section 2.1 of the spec ledger) will refresh it from the most
-- recent stint. Do not use display_name as an identifier.
--
-- academy_person_stints.resolved_by defaults to 'auto'; a 'manual'
-- row is the escape hatch for the shared-address failure mode (see
-- column comment). On 2026-08-31, zero personal_email keys carry
-- more than one distinct display_name across all 1,129 stints, so
-- the auto backfill is safe today. The override remains a defensive
-- capability, not a currently-needed correction.
--
-- academy_eligibility_exceptions defaults to include (absence of
-- row = eligible). Only exceptions live here, each with a required
-- reason string. A title-string heuristic ("Contractor" in a title)
-- was explicitly rejected because it fails silently into the
-- compliance denominator (spec Section 2.6). Kevin seeds Theresa
-- Camp as the initial exclusion; further exceptions are Studio
-- inserts, not code paths.
--
-- academy_grants are separate library_admin / academy_admin rows
-- (spec Section 12.2). Admin is not a role tier - Britt can hold
-- Library without Academy, and Mariela can hold People and Sync
-- plus Reports without Version Publisher.
--
-- Out of scope for this migration
-- ───────────────────────────────
-- - Nightly maintenance of academy_persons + academy_person_stints
--   as new Rippling rows arrive. That lands in the derive extension
--   PR alongside `scripts/derive_people.mjs` (i.e., the same nightly
--   job that owns `people` today gains an academy-facing block).
--   The backfill in this file is a one-time seed only.
-- - academy_obligations. Dropped from this PR (was table #5 in the
--   original prompt) because the frontmatter schema is about to widen
--   with `obligations[].key`, `cadence: on-hire`, and
--   `applies_to.worker_class` (open ruling 17.6). Landing the CHECK
--   constraints now would require immediate ALTER after the schema
--   extension approves. academy_obligations belongs to migration 2.
-- ═══════════════════════════════════════════════════════════════════


-- ─── academy_persons ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_persons (
  person_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  natural_key    TEXT        NOT NULL UNIQUE,
  display_name   TEXT,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE academy_persons IS
  'Stable identity above the Rippling employment stint. One row per
   distinct human. person_id is stable forever and MUST NOT be
   regenerated by any downstream code - the attestation ledger will
   carry it and re-anchoring would silently orphan history.';

COMMENT ON COLUMN academy_persons.natural_key IS
  'Derived: lower(trim(personal_email)). This column exists so a
   returning seasonal worker''s history stays legible without merging
   their compliance record across employment periods (Antonio
   Rodriguez, seven stints, is the canonical case). The underlying
   personal_email address itself is NEVER exposed through any route,
   view, export, or API response - see people.personal_email column
   comment and spec Section 2.5. Only the derived natural_key
   surfaces beyond the DB, and only for JOIN / GROUP / ORDER, never
   for display or send. Sends read directly from people.personal_email
   inside a server-only send function at the moment of sending.';

COMMENT ON COLUMN academy_persons.display_name IS
  'Legibility field for Admin views. Refreshed from the most recent
   stint by the nightly derive extension. Not authoritative - do not
   use as an identifier.';


-- ─── academy_person_stints ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_person_stints (
  worker_id    TEXT        PRIMARY KEY REFERENCES people (worker_id),
  person_id    UUID        NOT NULL   REFERENCES academy_persons (person_id),
  resolved_by  TEXT        NOT NULL DEFAULT 'auto'
                             CHECK (resolved_by IN ('auto', 'manual')),
  resolved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT
);

CREATE INDEX IF NOT EXISTS academy_person_stints_person_idx
  ON academy_person_stints (person_id);

COMMENT ON TABLE academy_person_stints IS
  'Maps every people(worker_id) stint to a stable academy_persons
   row. Attestations FK to worker_id (the stint), not person_id -
   this is what makes "rehires always redo onboarding" structural
   rather than a maintained rule (spec Section 2.1). The nightly
   derive extension keeps this table current as new Rippling rows
   arrive.';

COMMENT ON COLUMN academy_person_stints.resolved_by IS
  'Shared-address failure mode: identity is resolved by shared
   normalized personal_email, which is a heuristic. Two different
   humans sharing one address (a household) would be incorrectly
   merged into a single academy_persons row. That is the same silent-
   and-plausible failure class the eligibility exception table
   defends against. `manual` is the override - a human reviewer marks
   the stint with `resolved_by = manual`, points it at the correct
   person_id (creating a new academy_persons row if needed), and
   optionally records the correction in `note`. `auto` is the
   backfill and the nightly derive default. On 2026-08-31 zero
   normalized personal_email keys carry more than one distinct
   display_name across all 1,129 stints, so no manual overrides are
   currently needed; the column exists so we do not have to invent
   an escape hatch under time pressure the day the first collision
   appears.';


-- ─── academy_eligibility_exceptions ────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_eligibility_exceptions (
  worker_id  TEXT        PRIMARY KEY REFERENCES people (worker_id),
  eligible   BOOLEAN     NOT NULL,
  reason     TEXT        NOT NULL,
  added_by   TEXT        NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE academy_eligibility_exceptions IS
  'Explicit include/exclude override list. Absence of a row means
   ELIGIBLE - only exceptions are stored, and every exception
   carries a required reason string. Seeded with Theresa Camp as the
   initial exclusion (contractor, event work only, no work email).
   A title-string heuristic ("Contractor" in the title) was
   explicitly rejected as the eligibility signal because title
   varies ("Contractor", "Consultant", others) and fails silently
   into the compliance denominator - spec Section 2.6.';


-- ─── academy_grants ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_grants (
  email       TEXT        NOT NULL,
  grant_type  TEXT        NOT NULL
                CHECK (grant_type IN ('library_admin', 'academy_admin')),
  granted_by  TEXT        NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (email, grant_type)
);

COMMENT ON TABLE academy_grants IS
  'Library and Academy administration are SEPARATE grants (spec
   Section 12.2). Admin is not a role tier. Britt can hold
   library_admin without academy_admin. Mariela can hold People and
   Sync plus Reports (both under academy_admin) without holding
   library_admin. The primary key (email, grant_type) means a person
   may hold zero, one, or both.';


-- ─── RLS + grants ──────────────────────────────────────────────────
-- Same posture as every other public-schema table in this project:
-- RLS disabled (auth is app-layer via NextAuth + opdAcl), service_role
-- writes, anon + authenticated get REFERENCES + TRIGGER by default
-- from the postgres DEFAULT PRIVILEGES record (see _GRANT_TEMPLATE.md).
-- No TRUNCATE for anyone but service_role. These tables are not
-- money-adjacent, so the belt-and-suspenders REVOKE is optional -
-- included on academy_persons + academy_person_stints because a
-- TRUNCATE there would silently orphan every future attestation.
ALTER TABLE academy_persons                DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_person_stints          DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_eligibility_exceptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_grants                 DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON academy_persons                TO service_role;
GRANT SELECT, INSERT, UPDATE ON academy_person_stints          TO service_role;
GRANT SELECT, INSERT, UPDATE ON academy_eligibility_exceptions TO service_role;
GRANT SELECT, INSERT, UPDATE ON academy_grants                 TO service_role;

-- Defensive: identity tables underpin the attestation ledger. A
-- TRUNCATE here would sever every academy_person_stints -> people
-- FK and orphan every future attestation's person_id linkage. The
-- DEFAULT PRIVILEGES record no longer grants TRUNCATE to anon +
-- authenticated post-sc-34, but this keeps intent explicit.
REVOKE TRUNCATE ON academy_persons        FROM anon, authenticated;
REVOKE TRUNCATE ON academy_person_stints  FROM anon, authenticated;


-- ─── Backfill (idempotent) ─────────────────────────────────────────
-- One academy_persons row per distinct normalized personal_email.
-- display_name comes from the most recent stint (latest start_date,
-- tie-broken by first_seen_at). Expected: 887 rows.
--
-- Then one academy_person_stints row per people row, resolved_by
-- 'auto'. Expected: 1,129 rows.
--
-- Both blocks are ON CONFLICT DO NOTHING so re-application is a
-- no-op. To rebuild identity from a clean slate, DELETE both tables
-- in Studio first (in this order because of the FK), then re-run.

WITH ranked_stints AS (
  SELECT
    lower(trim(personal_email)) AS natural_key,
    display_name,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(personal_email))
      ORDER BY start_date DESC NULLS LAST,
               first_seen_at DESC NULLS LAST
    ) AS rnk
  FROM people
  WHERE personal_email IS NOT NULL
    AND trim(personal_email) <> ''
)
INSERT INTO academy_persons (natural_key, display_name)
SELECT natural_key, display_name
FROM ranked_stints
WHERE rnk = 1
ON CONFLICT (natural_key) DO NOTHING;

INSERT INTO academy_person_stints (worker_id, person_id, resolved_by)
SELECT
  p.worker_id,
  ap.person_id,
  'auto'
FROM people p
JOIN academy_persons ap
  ON ap.natural_key = lower(trim(p.personal_email))
WHERE p.personal_email IS NOT NULL
  AND trim(p.personal_email) <> ''
ON CONFLICT (worker_id) DO NOTHING;


-- ─── Seed rows ─────────────────────────────────────────────────────
-- Theresa Camp: contractor, event work only, not in scope for
-- training. Verified worker_id and title against production on
-- 2026-08-31 (docs/opd/alignment/SECTION_A_IDENTITY_AUTH.md
-- addenda). ON CONFLICT DO NOTHING so re-runs are safe; to change
-- the decision, DELETE and re-INSERT in Studio.
INSERT INTO academy_eligibility_exceptions
  (worker_id, eligible, reason, added_by)
VALUES
  ('69fdf5de8a5af7aab51464c1',
   FALSE,
   'Contractor, event work only. Not in scope for Academy training. Status HIRED, title "Contractor", account CIN - KY, no work_email.',
   'k.fietek@kitchfix.com')
ON CONFLICT (worker_id) DO NOTHING;

-- Kevin holds both grants at v1. Widening happens in Studio (or via
-- a follow-up migration if patterns emerge).
INSERT INTO academy_grants (email, grant_type, granted_by)
VALUES
  ('k.fietek@kitchfix.com', 'library_admin', 'k.fietek@kitchfix.com'),
  ('k.fietek@kitchfix.com', 'academy_admin', 'k.fietek@kitchfix.com')
ON CONFLICT (email, grant_type) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   Run each SELECT below in Studio after applying. Every value in
--   the "expected" column MUST match, or the apply is not complete.
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. Person rows exactly match the distinct personal_email count.
-- Expected: 887 / 887 / 0 (zero unmatched).
SELECT
  (SELECT count(*) FROM academy_persons)                       AS person_rows,
  (SELECT count(DISTINCT lower(trim(personal_email)))
     FROM people
    WHERE personal_email IS NOT NULL
      AND trim(personal_email) <> '')                          AS distinct_emails,
  (SELECT count(*) FROM academy_persons ap
    WHERE NOT EXISTS (
      SELECT 1 FROM people p
       WHERE lower(trim(p.personal_email)) = ap.natural_key))  AS orphan_persons;

-- P2. Stints exactly match the roster.
-- Expected: 1129 / 1129 / 0.
SELECT
  (SELECT count(*) FROM academy_person_stints)                 AS stint_rows,
  (SELECT count(*) FROM people
    WHERE personal_email IS NOT NULL
      AND trim(personal_email) <> '')                          AS eligible_source_rows,
  (SELECT count(*) FROM people p
    WHERE personal_email IS NOT NULL
      AND trim(personal_email) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM academy_person_stints s
         WHERE s.worker_id = p.worker_id))                     AS people_without_stint_row;

-- P3. Antonio Rodriguez (canonical seasonal-rehire case): 7 stints,
-- 1 person, 1 natural_key.
-- Expected: 7 / 1 / 1.
SELECT
  count(DISTINCT s.worker_id)  AS antonio_stints,
  count(DISTINCT s.person_id)  AS antonio_persons,
  count(DISTINCT ap.natural_key) AS antonio_natural_keys
FROM academy_person_stints s
JOIN academy_persons ap  ON ap.person_id = s.person_id
JOIN people          p   ON p.worker_id  = s.worker_id
WHERE p.display_name = 'Antonio Rodriguez';

-- P4. Theresa Camp exception exists and is exclusive.
-- Expected: 1 row, eligible = false.
SELECT worker_id, eligible, reason, added_by
FROM academy_eligibility_exceptions
WHERE worker_id = '69fdf5de8a5af7aab51464c1';

-- P5. Kevin holds both grants.
-- Expected: 2 rows (library_admin + academy_admin).
SELECT email, grant_type, granted_by
FROM academy_grants
WHERE email = 'k.fietek@kitchfix.com'
ORDER BY grant_type;

-- P6. No non-service_role has TRUNCATE / DELETE / UPDATE on any
-- Academy identity table.
-- Expected: 0 rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('academy_persons',
                     'academy_person_stints',
                     'academy_eligibility_exceptions',
                     'academy_grants')
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('TRUNCATE', 'DELETE', 'UPDATE');


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file (statements applied
-- sequentially) in Supabase Studio. The migration-gate check on the
-- PR looks for the phrase `applied in Studio: YES` in a comment from
-- an OWNER account and re-emits the check_run on the current SHA
-- (see .github/workflows/migration-gate.yml).
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- p1_person_rows:     <expected 887 / 887 / 0>
-- p2_stint_rows:      <expected 1129 / 1129 / 0>
-- p3_antonio:         <expected 7 / 1 / 1>
-- p4_theresa:         <expected 1 row, eligible=false>
-- p5_kevin_grants:    <expected 2 rows>
-- p6_grants_hygiene:  <expected 0 rows>
-- notes:              <optional - any statement that needed manual attention>
