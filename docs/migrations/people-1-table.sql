-- ═══════════════════════════════════════════════════════════════════
-- people-1-table.sql
--
-- One nightly-refreshed roster derived from the Rippling worker +
-- user records the intranet already syncs. Replaces two hand-joins
-- in the labor route (route.js:370 / :623) and unblocks the KPI role
-- gate question "who is the site leader here", which today has no
-- backing column anywhere.
--
-- Data source (verified 2026-08-19):
--   rippling_raw_workers_latest    1,126 rows
--   rippling_raw_users_latest        897 rows
--   rippling_department_map        department_id -> account_key (+ CORP)
--   101 of 101 ACTIVE workers resolve to a user record. No gaps.
--
-- Apply discipline
-- ─────────────────
-- 1. Kevin applies statements sequentially in Supabase Studio.
-- 2. Fill in the attestation block at end of file with the SHA the
--    apply matched.
-- 3. Commit 2 (the derive) + commit 3 (the probes) do not run
--    against prod until this migration is applied. The nightly
--    workflow guards on that.
-- 4. Every statement is IF NOT EXISTS / OR REPLACE guarded so
--    re-application is safe.
--
-- PII posture
-- ───────────
-- The row is PII-dense. personal_email is stored so the row is
-- authoritative for a future opt-in workflow (people table is the
-- roster the whole intranet reads), but no route may SELECT it.
-- The column comment restates that. work_email, phone, photos are
-- fair game for internal surfaces.
--
-- Ownership model
-- ───────────────
-- Four columns are owner-maintained and MUST NOT be silently changed
-- by the derive: is_site_leader, site_leader_note, worker_class (when
-- worker_class_source = 'owner'), and worker_class_source. The derive
-- upsert lists its columns explicitly (see scripts/derive_people.mjs)
-- and for owner-marked worker_class rows carries the existing DB
-- value back into the payload so the round-trip is a no-op. Probe P3
-- asserts the contract for both is_site_leader and worker_class.
--
-- Why worker_class exists
-- ───────────────────────
-- Contractors are indistinguishable from salaried staff in Rippling
-- (both exempt, both no time entries, both an annual figure). One
-- known example already exists - a terminated contract RD whose
-- engagement landed in a site's salary total. Without this column a
-- contract engagement ending reads as an unfilled salaried role on
-- the KPI board. The DEFAULT derives from overtime_exemption; the
-- derive NEVER emits 'contract' because there is no signal that
-- distinguishes it from 'salaried' - Kevin marks contractors by
-- setting worker_class_source = 'owner' + worker_class = 'contract'.
-- is_salaried stays as-is and keeps its current meaning (the exempt
-- predicate). worker_class is the richer, owner-correctable view.
-- ═══════════════════════════════════════════════════════════════════

-- ─── people ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS people (
  worker_id           TEXT PRIMARY KEY,
  user_id             TEXT,
  display_name        TEXT,
  title               TEXT,
  status              TEXT,
  start_date          DATE,
  end_date            DATE,
  department_id       TEXT,
  account_key         TEXT,
  is_corp             BOOLEAN NOT NULL DEFAULT FALSE,
  work_email          TEXT,
  personal_email      TEXT,
  phone               TEXT,
  manager_worker_id   TEXT,
  is_manager          BOOLEAN,
  is_salaried         BOOLEAN,

  -- Richer, owner-correctable class than is_salaried. Default derives
  -- from overtime_exemption on every nightly run; a row Kevin has
  -- marked worker_class_source='owner' is carried through the upsert
  -- unchanged (see scripts/derive_people.mjs).
  worker_class        TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (worker_class IN ('hourly','salaried','contract','unknown')),
  worker_class_source TEXT NOT NULL DEFAULT 'derived'
                        CHECK (worker_class_source IN ('derived','owner')),

  -- Owner-maintained. Derive NEVER writes these two. Seeded by
  -- Kevin in Studio after this migration lands (one UPDATE per
  -- account). Probe P3 asserts the value survives the nightly
  -- derive; the derive upsert lists its own columns explicitly.
  is_site_leader      BOOLEAN NOT NULL DEFAULT FALSE,
  site_leader_note    TEXT,

  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE people IS
  'Nightly-derived roster from Rippling. worker_id is the stable key.
   is_site_leader / site_leader_note are OWNER-MAINTAINED; the derive
   in scripts/derive_people.mjs never writes them. worker_class is
   derived from overtime_exemption by default; a row with
   worker_class_source=owner is carried through the derive unchanged
   so Kevin can mark contractors as worker_class=contract.';

COMMENT ON COLUMN people.worker_class IS
  'hourly | salaried | contract | unknown. Default derives from
   overtime_exemption. The derive NEVER emits contract - Rippling
   has no signal that distinguishes a contractor from a salaried
   employee. contract is an owner-only value, set with
   worker_class_source=owner.';

COMMENT ON COLUMN people.worker_class_source IS
  'derived (default) or owner. When owner, the derive treats
   worker_class as owner-maintained and does not overwrite it.';

COMMENT ON COLUMN people.personal_email IS
  'PII. Stored for a future opt-in workflow; NEVER selected by any
   application route. work_email is the safe address for internal
   surfaces.';

COMMENT ON COLUMN people.manager_worker_id IS
  'Self-referential; NOT a foreign key. A manager can be terminated
   or otherwise absent from the current roster snapshot without
   invalidating the report-to line.';

COMMENT ON COLUMN people.is_site_leader IS
  'Owner-maintained. Derive never writes this. At most one true per
   account_key, enforced by people_one_leader_per_account below.';

-- ─── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS people_account_status_idx
  ON people (account_key, status);
CREATE INDEX IF NOT EXISTS people_status_idx
  ON people (status);
CREATE INDEX IF NOT EXISTS people_manager_idx
  ON people (manager_worker_id);
CREATE INDEX IF NOT EXISTS people_leader_idx
  ON people (is_site_leader) WHERE is_site_leader;

-- worker_class filter index. The salaried + contract + unknown sets
-- are the ones any query will filter on; hourly is the bulk and does
-- not benefit from an index. Partial index keeps it small.
CREATE INDEX IF NOT EXISTS people_worker_class_idx
  ON people (worker_class) WHERE worker_class <> 'hourly';

-- At most one site leader per account_key. This constraint is the
-- point of the table - it makes "who is the leader here" unambiguous.
-- The derive never writes is_site_leader, so a violation can only
-- come from an owner UPDATE; Studio surfaces the unique-violation
-- immediately.
CREATE UNIQUE INDEX IF NOT EXISTS people_one_leader_per_account
  ON people (account_key) WHERE is_site_leader;

-- ─── RLS + grants ──────────────────────────────────────────────────
-- Same pattern as the other rippling-derived tables in this project:
-- RLS disabled, service_role writes, anon + authenticated get the
-- non-data grants only. NO TRUNCATE for anyone but service_role.
ALTER TABLE people DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON people TO service_role;
REVOKE TRUNCATE ON people FROM anon, authenticated;
GRANT REFERENCES, TRIGGER ON people TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file (one statement at a
-- time) in Supabase Studio. This attestation records the exact SHA
-- the apply matched. The migration-gate check on the PR looks for
-- the phrase `applied in Studio: YES` in a comment from an OWNER
-- account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional - any statement that needed manual attention>
