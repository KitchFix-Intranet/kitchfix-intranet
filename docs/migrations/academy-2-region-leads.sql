-- ═══════════════════════════════════════════════════════════════════
-- academy-2-region-leads.sql
--
-- One row per region that identifies the Regional Director of
-- Operations by email. Owner-maintained, small, follows the pattern
-- established by `people.is_site_leader` (owner-maintained, never
-- derived, enforced one-per-scope).
--
-- Why this table exists
-- ─────────────────────
-- RDO identity is NOT derivable from `people` or `accounts` today.
-- Verified 2026-08-31:
--   - `sc_qbo_account_map.rdo_email` is NULL on both rows that exist,
--     and only 2 of 11 accounts have a row at all. Unusable.
--   - `people` has no `is_rdo` column and no owner-set flag.
--   - The only signal is the free-text `title` column
--     ("Regional Director of Operations - East" / "- West"), which
--     spec Section 3.2 explicitly forbids the Academy resolver from
--     reading. Titles vary, drift, and fail silently.
--
-- Same owner-maintained shape as `people.is_site_leader`: one row
-- per scope (region here, account_key there), the derive never
-- writes it, and Kevin is the source of truth. `assigned_by` and
-- `assigned_at` record who and when so re-assignments have an audit
-- trail.
--
-- Namespace + apply discipline
-- ────────────────────────────
-- `academy_*` prefix per spec Section 13. Same discipline as
-- academy-1: `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
-- verify block with expected values, and the applied-in-Studio
-- attestation footer. Author only - Kevin applies statements
-- sequentially in Supabase Studio; the migration-gate check on this
-- PR fails until Kevin comments `applied in Studio: YES`.
--
-- Data-driven seed (fail-loud)
-- ────────────────────────────
-- The two RDO rows are seeded from `people` via a titled SELECT so
-- the seed CANNOT contain a wrong address. If the titles have
-- changed since 2026-08-31 (verified: exactly two active CORP rows
-- match "Regional Director of Operations - East" / "- West"), the
-- INSERT inserts ZERO rows for that region, the post-flight
-- `RAISE EXCEPTION` fires, and the apply halts loudly. That is the
-- correct outcome: a rename requires a ruling, not a silent seed.
-- ═══════════════════════════════════════════════════════════════════


-- ─── academy_region_leads ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_region_leads (
  region       TEXT        PRIMARY KEY,
  email        TEXT        NOT NULL
                             CHECK (email = lower(email)),
  assigned_by  TEXT        NOT NULL,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE academy_region_leads IS
  'Owner-maintained mapping of accounts.region -> RDO email. Exists
   because RDO identity cannot be derived: sc_qbo_account_map is
   unusable (2 of 11 accounts have a row, rdo_email is NULL on
   both), people has no is_rdo flag, and free-text titles were
   rejected by spec Section 3.2 as a resolver signal. Follows the
   owner-maintained pattern of people.is_site_leader: one row per
   scope, derive never writes it, Kevin is source of truth.
   Consumed by src/lib/academy/resolveIdentity.js as rule 2 in the
   scope precedence (company > region > site > self).';

COMMENT ON COLUMN academy_region_leads.region IS
  'MUST match a value in accounts.region. No FK to accounts.region
   because accounts has no unique index on region (many accounts
   per region). The verify block below asserts every seeded region
   appears in accounts.region so an orphan seed halts the apply.';

COMMENT ON COLUMN academy_region_leads.email IS
  'Lower-cased Google Workspace address. CHECK enforces the invariant
   at insert time so lookups from the session email do not depend on
   convention. Matches the CHECK on academy_grants.email from
   academy-1.';


-- ─── RLS + grants ──────────────────────────────────────────────────
-- Same posture as academy-1: RLS disabled (auth is app-layer),
-- service_role writes only, anon + authenticated inherit REFERENCES
-- + TRIGGER from DEFAULT PRIVILEGES per _GRANT_TEMPLATE.md. Not
-- money-adjacent; no belt-and-suspenders REVOKE needed on TRUNCATE.
ALTER TABLE academy_region_leads DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON academy_region_leads TO service_role;


-- ─── Seed (data-driven, fail-loud) ─────────────────────────────────
-- INSERTs are done from a SELECT against people, filtered by title
-- pattern. If the titles change and a row is missing, the INSERT
-- writes zero rows for that region and the post-flight assertion
-- below fires. ON CONFLICT DO NOTHING makes the seed idempotent -
-- re-applying is a no-op.
--
-- WHY the SELECT filters:
--   - status = 'ACTIVE'      seasonal-rehire discipline (spec 2.4)
--   - account_key = 'CORP'   RDOs sit at CORP, not on a site
--   - is_corp = TRUE         defensive cross-check with the account
--   - title ILIKE ...        the only signal that distinguishes E/W
--   - work_email IS NOT NULL required for the destination column
--
-- The seed writes 'k.fietek@kitchfix.com' as `assigned_by` because
-- Kevin is the current source of truth. On re-assignment, the
-- Studio UPDATE should refresh both `email` and `assigned_by`.

INSERT INTO academy_region_leads (region, email, assigned_by)
SELECT 'East', lower(trim(p.work_email)), 'k.fietek@kitchfix.com'
FROM people p
WHERE p.status = 'ACTIVE'
  AND p.account_key = 'CORP'
  AND p.is_corp = TRUE
  AND p.title ILIKE 'Regional Director of Operations - East%'
  AND p.work_email IS NOT NULL
  AND trim(p.work_email) <> ''
ON CONFLICT (region) DO NOTHING;

INSERT INTO academy_region_leads (region, email, assigned_by)
SELECT 'West', lower(trim(p.work_email)), 'k.fietek@kitchfix.com'
FROM people p
WHERE p.status = 'ACTIVE'
  AND p.account_key = 'CORP'
  AND p.is_corp = TRUE
  AND p.title ILIKE 'Regional Director of Operations - West%'
  AND p.work_email IS NOT NULL
  AND trim(p.work_email) <> ''
ON CONFLICT (region) DO NOTHING;

-- Post-flight assertions. Both rows MUST land on first apply or the
-- migration halts. On re-application both rows already exist and
-- both checks pass trivially.
DO $$
DECLARE
  east_ok BOOLEAN;
  west_ok BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM academy_region_leads WHERE region = 'East') INTO east_ok;
  SELECT EXISTS (SELECT 1 FROM academy_region_leads WHERE region = 'West') INTO west_ok;
  IF NOT east_ok THEN
    RAISE EXCEPTION 'academy-2 seed: no active CORP row matches "Regional Director of Operations - East%%" - title has drifted or the RDO seat is vacant; needs a Kevin ruling before this migration can apply';
  END IF;
  IF NOT west_ok THEN
    RAISE EXCEPTION 'academy-2 seed: no active CORP row matches "Regional Director of Operations - West%%" - title has drifted or the RDO seat is vacant; needs a Kevin ruling before this migration can apply';
  END IF;
END
$$;


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   Run each SELECT below in Studio after applying. Every value in
--   the "expected" column MUST match, or the apply is not complete.
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. Two rows, East + West, each with a lower-cased @kitchfix.com
-- address. Expected: 2 / 0 / 0.
SELECT
  count(*)                                                        AS rows,
  count(*) FILTER (WHERE email <> lower(email))                   AS not_lowercased,
  count(*) FILTER (WHERE email NOT LIKE '%@kitchfix.com')         AS wrong_domain
FROM academy_region_leads;

-- P2. Every seeded region appears in accounts.region.
-- Expected: 0 rows returned.
SELECT rl.region
FROM academy_region_leads rl
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.region = rl.region
);

-- P3. Both seeded emails still map to an ACTIVE CORP row with the
-- expected title. Drift detector.
-- Expected: 2 rows, each with title_match = true.
SELECT
  rl.region,
  rl.email,
  p.display_name,
  p.title,
  (p.title ILIKE ('Regional Director of Operations - ' || rl.region || '%')) AS title_match
FROM academy_region_leads rl
JOIN people p
  ON lower(p.work_email) = rl.email
 AND p.status = 'ACTIVE'
 AND p.account_key = 'CORP'
ORDER BY rl.region;

-- P4. Grant hygiene - no anon / authenticated has TRUNCATE / DELETE
-- / UPDATE. Expected: 0 rows.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'academy_region_leads'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('TRUNCATE', 'DELETE', 'UPDATE');


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
-- p1_rows:           <expected 2 / 0 / 0>
-- p2_orphan_regions: <expected 0 rows>
-- p3_drift_check:    <expected 2 rows, title_match true for both>
-- p4_grants:         <expected 0 rows>
-- notes:             <optional>
