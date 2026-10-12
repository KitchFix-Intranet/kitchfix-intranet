-- ═══════════════════════════════════════════════════════════════════
-- people-2-admin-columns.sql
--
-- Stage 1 of the Directory Admin Panel arc. Adds 18 permission / role /
-- routing columns to the existing `people` table and seeds them from
-- today's hardcoded constants in:
--   - src/lib/admin.js                (OPS_LEADERSHIP, SC_*)
--   - src/lib/notifications/getManagerChain.js (ALWAYS_CC, REGION map)
--   - src/lib/opdAcl.js               (PLAYBOOK_OWNER)
--   - src/lib/incidentSchema.js       (incident notification emails)
--
-- NO BEHAVIORAL CHANGES in this migration. Every consumer still reads
-- from the hardcoded lists; the DB rows are shadow state that Stage 4
-- cuts over to.
--
-- Idempotent: every ALTER / CREATE INDEX uses IF NOT EXISTS and every
-- UPDATE is scoped by work_email. Re-application is safe.
--
-- Apply order (Studio): paste the whole file as one transaction, or
-- block by block (ALTERs -> COMMENTs -> INDEX -> seed) if the editor
-- rejects multi-statement submissions. The whole thing is wrapped in
-- BEGIN;/COMMIT; so either the schema + seed both land or nothing does.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Permission flags ──────────────────────────────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_ops_leadership    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_sc_access          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_sc_admin           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_sc_lock_override   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_labor_admin        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_invoice_admin      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_inv_manager        BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── KPI ───────────────────────────────────────────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS kpi_role              TEXT CHECK (kpi_role IN ('corporate','rdo'));
ALTER TABLE people ADD COLUMN IF NOT EXISTS kpi_scope             TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS can_see_salary        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_kpi_preview        BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Content & Tools ───────────────────────────────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS opd_access_tier       TEXT NOT NULL DEFAULT 'unrestricted' CHECK (opd_access_tier IN ('unrestricted','restricted','slt'));
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_playbook_owner     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_sous_preview       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_hr_admin           BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Notifications ─────────────────────────────────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS paf_always_cc         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS incident_notify       TEXT NOT NULL DEFAULT 'none' CHECK (incident_notify IN ('all','s4_weekly','none'));

-- ─── Routing ───────────────────────────────────────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS region                TEXT CHECK (region IN ('East','West','CORP'));
ALTER TABLE people ADD COLUMN IF NOT EXISTS sc_default_account    TEXT;


-- ─── Column comments ───────────────────────────────────────────────
COMMENT ON COLUMN people.is_ops_leadership IS
  'Replaces OPS_LEADERSHIP_EMAILS in admin.js. Gates ops route, invoice handlers, vendor handlers, People Portal admin.';

COMMENT ON COLUMN people.is_sc_access IS
  'Replaces SC_ADMINS in admin.js. Gates Service Calendar page-level access (who can open SC at all).';

COMMENT ON COLUMN people.is_sc_admin IS
  'Replaces SC_ADMIN_EMAILS in admin.js. Gates Service Calendar admin dashboard (money-moving config edits).';

COMMENT ON COLUMN people.is_sc_lock_override IS
  'Replaces SC_LOCK_OVERRIDE in admin.js. Can bypass period lock and week-finalize lock. Narrower than is_sc_admin.';

COMMENT ON COLUMN people.paf_always_cc IS
  'Replaces ALWAYS_CC in getManagerChain.js. Always receives PAF/new-hire notification CC.';

COMMENT ON COLUMN people.region IS
  'East / West / CORP. Replaces the hardcoded REGIONAL_DIRECTOR_BY_REGION map in getManagerChain.js. Used for PAF CC routing and KPI scope.';

COMMENT ON COLUMN people.is_playbook_owner IS
  'Replaces PLAYBOOK_OWNER in opdAcl.js. Can view and manage The Playbook (/playbook).';

COMMENT ON COLUMN people.incident_notify IS
  'Replaces hardcoded incident emails in incidentSchema.js. all = S1-S3 immediate + S4 digest. s4_weekly = S4 digest only. none = no incident notifications.';


-- ─── Index ─────────────────────────────────────────────────────────
-- Partial index on the common admin-lookup query (who is in ops
-- leadership?). Partial so the index only carries the ~6 TRUE rows,
-- not the 1,100+ FALSE rows.
CREATE INDEX IF NOT EXISTS people_ops_leadership_idx
  ON people (is_ops_leadership) WHERE is_ops_leadership;


-- ═══════════════════════════════════════════════════════════════════
-- Seed data
--
-- Each UPDATE sets ONLY the columns that are TRUE / non-default for
-- that person. The DEFAULT FALSE / DEFAULT 'none' / DEFAULT
-- 'unrestricted' handles everything else at ALTER time, so re-running
-- the seed cannot clobber other columns.
--
-- Match key is LOWER(work_email) because Rippling occasionally
-- rewrites casing on sync and the derive normalizes to lower on
-- ingest (see src/app/api/people/route.js directory handler for the
-- same pattern).
--
-- A row that does not exist (person left, never in Rippling, etc.)
-- causes the UPDATE to no-op. That is correct - we do not seed ghost
-- rows.
-- ═══════════════════════════════════════════════════════════════════

-- Kevin Fietek · ops + SC admin + lock override + playbook owner + CC + CORP + incidents
UPDATE people SET
  is_ops_leadership   = TRUE,
  is_sc_access        = TRUE,
  is_sc_admin         = TRUE,
  is_sc_lock_override = TRUE,
  is_playbook_owner   = TRUE,
  paf_always_cc       = TRUE,
  region              = 'CORP',
  incident_notify     = 'all'
WHERE LOWER(work_email) = 'k.fietek@kitchfix.com';

-- Joe Lessard · ops + SC admin + lock override + CC + incidents
UPDATE people SET
  is_ops_leadership   = TRUE,
  is_sc_access        = TRUE,
  is_sc_admin         = TRUE,
  is_sc_lock_override = TRUE,
  paf_always_cc       = TRUE,
  incident_notify     = 'all'
WHERE LOWER(work_email) = 'joe@kitchfix.com';

-- Josh · ops + SC admin + incidents
UPDATE people SET
  is_ops_leadership   = TRUE,
  is_sc_access        = TRUE,
  is_sc_admin         = TRUE,
  incident_notify     = 'all'
WHERE LOWER(work_email) = 'josh@kitchfix.com';

-- Britt · ops + SC admin + incidents (no SC_ACCESS)
UPDATE people SET
  is_ops_leadership = TRUE,
  is_sc_admin       = TRUE,
  incident_notify   = 'all'
WHERE LOWER(work_email) = 'britt@kitchfix.com';

-- Alex Wasserman · ops + CC
UPDATE people SET
  is_ops_leadership = TRUE,
  paf_always_cc     = TRUE
WHERE LOWER(work_email) = 'a.wasserman@kitchfix.com';

-- Mariela Chavez · ops + SC admin + CC + incidents
UPDATE people SET
  is_ops_leadership = TRUE,
  is_sc_access      = TRUE,
  is_sc_admin       = TRUE,
  paf_always_cc     = TRUE,
  incident_notify   = 'all'
WHERE LOWER(work_email) = 'm.chavez@kitchfix.com';

-- Sebastian Castro · SC admin + lock override (not ops)
UPDATE people SET
  is_sc_access        = TRUE,
  is_sc_admin         = TRUE,
  is_sc_lock_override = TRUE
WHERE LOWER(work_email) = 's.castro@kitchfix.com';

-- Ryan Moore · SC admin + West region
UPDATE people SET
  is_sc_access = TRUE,
  is_sc_admin  = TRUE,
  region       = 'West'
WHERE LOWER(work_email) = 'r.moore@kitchfix.com';

-- Shane Lynch · SC admin + East region (no SC_ACCESS flag; present
-- only in SC_ADMIN per the hardcoded list)
UPDATE people SET
  is_sc_admin = TRUE,
  region      = 'East'
WHERE LOWER(work_email) = 's.lynch@kitchfix.com';

-- Jennifer Trible · SC access only
UPDATE people SET
  is_sc_access = TRUE
WHERE LOWER(work_email) = 'j.trible@kitchfix.com';

-- Michael Decanio · SC access only
UPDATE people SET
  is_sc_access = TRUE
WHERE LOWER(work_email) = 'm.decanio@kitchfix.com';

-- Elizabeth Randall · SC access only
UPDATE people SET
  is_sc_access = TRUE
WHERE LOWER(work_email) = 'e.randall@kitchfix.com';

-- Alexis Lacy · SC access only
UPDATE people SET
  is_sc_access = TRUE
WHERE LOWER(work_email) = 'a.lacy@kitchfix.com';

-- Anna Hughes · SC access only
UPDATE people SET
  is_sc_access = TRUE
WHERE LOWER(work_email) = 'a.hughes@kitchfix.com';

COMMIT;


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
