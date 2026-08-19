-- salary-1c-kpi-roles.sql
-- Salary PR 1 · migration 1c: role table + seed for the salary gate.
--
-- The gate (spec R-1, R-2) decides who is allowed to see salary. It
-- has to live somewhere the server can read on every request without
-- calling out to another service. This table is the source of truth:
--
--   role='corporate'  scope=NULL              -> sees salary for every account
--   role='rdo'        scope='East'|'West'     -> sees salary for accounts in that region
--   role='site'       scope=<account_key>     -> never sees salary
--
-- Anyone NOT in this table = site with no scope = never permitted
-- (default deny). The route re-checks the gate on every request, so a
-- shared link cannot carry salary access to a caller who does not have
-- it (spec T-2).
--
-- Header choices:
--
--   email = PK, not user_id:
--     user_accounts is (email, account) with no numeric id and no join
--     to auth.users - email is already the identity across every
--     surface. Keep the model consistent.
--
--   Seed via three INSERTs with ON CONFLICT DO NOTHING:
--     Idempotent. Re-applying the migration does not clobber a
--     hand-edited row. Kevin can edit any row in Studio afterwards;
--     the migration will not overwrite it.
--
--   Sebastian's row: COMMENTED, awaits owner ruling.
--
--   scope validation via CHECK + trigger elided:
--     A CHECK per role would need a subquery (scope IS NULL for
--     corporate, scope in accounts.region for rdo, scope in
--     accounts.team_key for site), which CHECK cannot express in
--     Postgres (cross-table). A trigger would be the right shape but
--     is out of scope for this PR - the seed is small and reviewed;
--     the route's canSeeSalary function (PR 2) is where the semantics
--     live. Keep the table minimal.
--
--   Grants:
--     SELECT to service_role only. The route reads this on every
--     request. No INSERT / UPDATE / DELETE grants - editing is a
--     manual Studio operation.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'salary-1c pre-flight: kpi_lines missing - PR 1 spine must land first';
  END IF;
  IF to_regclass('public.user_accounts') IS NULL THEN
    RAISE EXCEPTION 'salary-1c pre-flight: user_accounts missing - site rows seed reads from it';
  END IF;
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'salary-1c pre-flight: accounts missing';
  END IF;
END $$;

-- ─── kpi_roles ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_roles (
  email       TEXT        PRIMARY KEY,
  role        TEXT        NOT NULL CHECK (role IN ('corporate', 'rdo', 'site')),
  scope       TEXT        NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Seed ───────────────────────────────────────────────────────────
-- Corporate: unrestricted salary access. Kevin, Josh, Joe.
-- Sebastian's row commented pending owner ruling.
INSERT INTO kpi_roles (email, role, scope, created_by)
VALUES
  ('k.fietek@kitchfix.com',  'corporate', NULL, 'salary-1c'),
  ('j.katt@kitchfix.com',    'corporate', NULL, 'salary-1c'),
  ('j.lessard@kitchfix.com', 'corporate', NULL, 'salary-1c')
  -- ('s.<lastname>@kitchfix.com', 'corporate', NULL, 'salary-1c')  -- Sebastian: pending owner ruling
ON CONFLICT (email) DO NOTHING;

-- Regional directors: salary for their region only.
INSERT INTO kpi_roles (email, role, scope, created_by)
VALUES
  ('s.lynch@kitchfix.com', 'rdo', 'East', 'salary-1c'),
  ('r.moore@kitchfix.com', 'rdo', 'West', 'salary-1c')
ON CONFLICT (email) DO NOTHING;

-- Site leads: no salary access. Seeded from user_accounts as the
-- current inventory of (email, account_key). ON CONFLICT DO NOTHING
-- means anyone already promoted to corporate / rdo above will not be
-- demoted to site.
INSERT INTO kpi_roles (email, role, scope, created_by)
SELECT LOWER(TRIM(email)), 'site', account, 'salary-1c'
FROM user_accounts
WHERE email IS NOT NULL AND account IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- ─── Grants ─────────────────────────────────────────────────────────
-- SELECT-only to service_role. Editing is a manual Studio operation;
-- there is no in-app write path.
GRANT SELECT ON kpi_roles TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  r_sel BOOLEAN; r_ins BOOLEAN; r_upd BOOLEAN; r_del BOOLEAN;
  corp_ct INT; rdo_ct INT; site_ct INT;
BEGIN
  IF to_regclass('public.kpi_roles') IS NULL THEN
    RAISE EXCEPTION 'post-flight: kpi_roles missing';
  END IF;

  SELECT COUNT(*) INTO corp_ct FROM kpi_roles WHERE role = 'corporate';
  SELECT COUNT(*) INTO rdo_ct  FROM kpi_roles WHERE role = 'rdo';
  SELECT COUNT(*) INTO site_ct FROM kpi_roles WHERE role = 'site';
  IF corp_ct < 3 THEN
    RAISE EXCEPTION 'post-flight: expected >=3 corporate rows (Kevin, Josh, Joe), got %', corp_ct;
  END IF;
  IF rdo_ct < 2 THEN
    RAISE EXCEPTION 'post-flight: expected >=2 rdo rows (Lynch, Moore), got %', rdo_ct;
  END IF;
  IF site_ct < 1 THEN
    RAISE EXCEPTION 'post-flight: expected >=1 site rows from user_accounts, got %', site_ct;
  END IF;

  -- Every rdo scope must be a valid region.
  IF EXISTS (
    SELECT 1 FROM kpi_roles r
    WHERE r.role = 'rdo'
      AND r.scope NOT IN (SELECT DISTINCT region FROM accounts WHERE region IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'post-flight: kpi_roles rdo row has scope that is not a known accounts.region value';
  END IF;

  -- Every site scope must be a valid account_key.
  IF EXISTS (
    SELECT 1 FROM kpi_roles r
    WHERE r.role = 'site'
      AND r.scope NOT IN (SELECT team_key FROM accounts)
  ) THEN
    RAISE EXCEPTION 'post-flight: kpi_roles site row has scope that is not a known accounts.team_key';
  END IF;

  -- Corporate rows must have NULL scope (spec R-1).
  IF EXISTS (SELECT 1 FROM kpi_roles WHERE role = 'corporate' AND scope IS NOT NULL) THEN
    RAISE EXCEPTION 'post-flight: kpi_roles corporate row has non-null scope';
  END IF;

  -- Grants: SELECT only.
  r_sel := has_table_privilege('service_role', 'kpi_roles', 'SELECT');
  r_ins := has_table_privilege('service_role', 'kpi_roles', 'INSERT');
  r_upd := has_table_privilege('service_role', 'kpi_roles', 'UPDATE');
  r_del := has_table_privilege('service_role', 'kpi_roles', 'DELETE');
  IF NOT r_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on kpi_roles'; END IF;
  IF r_ins     THEN RAISE EXCEPTION 'post-flight: service_role has INSERT on kpi_roles (must be Studio-edit only)'; END IF;
  IF r_upd     THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on kpi_roles (must be Studio-edit only)'; END IF;
  IF r_del     THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on kpi_roles (must be Studio-edit only)'; END IF;

  RAISE NOTICE 'salary-1c post-flight PASS - table + seed present (corporate=%, rdo=%, site=%), SELECT-only grants', corp_ct, rdo_ct, site_ct;
END $$;

COMMIT;
