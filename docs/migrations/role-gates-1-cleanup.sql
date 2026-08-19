-- ═══════════════════════════════════════════════════════════════════
-- role-gates-1-cleanup.sql
--
-- Cleans up kpi_roles for the four-role KPI gate that lands with
-- this PR (see docs/KPI_ROLE_GATES_SPEC.md).
--
-- What lands
--   M1  DELETE all role='site' rows (27, per §9 / OQ-1). site-level
--       access is now authoritative from `people` (is_site_leader,
--       worker_class='salaried'), never from kpi_roles.
--   M2  Tighten the role CHECK to ('corporate','rdo') so a 'site'
--       row cannot come back. Named constraint so a future reader
--       sees the ruling.
--   M3  INSERT the four new corporate rows (Sebastian, Britt,
--       Mariela, Alex). Emails supplied by Kevin - PLACEHOLDERS
--       below; do NOT guess from the worker set. ON CONFLICT DO
--       NOTHING so re-application is safe.
--
-- Post-state assertion at the tail: exactly 7 corporate + 2 rdo = 9
-- rows in kpi_roles, zero 'site'.
--
-- Apply discipline
--   1. Kevin applies statements sequentially in Supabase Studio.
--   2. Fill in the four placeholder emails BEFORE running M3, or
--      run M1 + M2 now and M3 after emails land - both are safe.
--   3. Fill in the attestation block at the tail with the SHA the
--      apply matched.
--
-- PII posture: emails travel through this migration for the four
-- corporate additions. Handled the same way the salary-1c seed did;
-- no additional exposure surface.
-- ═══════════════════════════════════════════════════════════════════

-- ─── M1 - delete role='site' rows (superseded by people) ───────────
DELETE FROM kpi_roles WHERE role = 'site';

-- ─── M2 - tighten the role CHECK ───────────────────────────────────
-- Drop the anonymous CHECK from salary-1c and re-add it as a named
-- constraint. The `role` values are now closed at ('corporate','rdo')
-- so a stray 'site' write cannot regress the resolver.
ALTER TABLE kpi_roles DROP CONSTRAINT IF EXISTS kpi_roles_role_check;
ALTER TABLE kpi_roles
  ADD CONSTRAINT kpi_roles_role_corporate_or_rdo
  CHECK (role IN ('corporate', 'rdo'));

-- ─── M3 - four new corporate rows ──────────────────────────────────
-- PLACEHOLDER emails. Kevin: replace the four <fill-in> values with
-- the real addresses before running M3. Do NOT guess from the worker
-- set - kpi_roles is authoritative and a wrong email would grant
-- corporate access to the wrong person.
INSERT INTO kpi_roles (email, role, scope, created_by, created_at)
VALUES
  ('<fill-in-sebastian-email>', 'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('<fill-in-britt-email>',     'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('<fill-in-mariela-email>',   'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('<fill-in-alex-email>',      'corporate', NULL, 'k.fietek@kitchfix.com', NOW())
ON CONFLICT (email) DO NOTHING;

-- ─── Post-state verify (paste output in the attestation) ───────────
-- Expected after M1 + M2 + M3:
--   role='corporate'  count = 7   (Kevin + Josh + Joe + the four
--                                   above; the seed from salary-1c
--                                   already covers Kevin/Josh/Joe)
--   role='rdo'        count = 2   (Shane, Ryan)
--   role='site'       count = 0
--
-- Run this SELECT in Studio after applying:
--   SELECT role, count(*) FROM kpi_roles GROUP BY role ORDER BY role;
-- Expected output:
--   corporate | 7
--   rdo       | 2


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file (M1, M2, M3
-- sequentially) in Supabase Studio. This records the exact SHA the
-- apply matched. The migration-gate check on the PR looks for the
-- phrase `applied in Studio: YES` in a comment from an OWNER account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional - any statement that needed manual attention>
