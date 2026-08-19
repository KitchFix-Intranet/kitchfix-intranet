-- ═══════════════════════════════════════════════════════════════════
-- role-gates-1-cleanup.sql
--
-- Cleans up kpi_roles for the four-role KPI gate that lands with
-- this PR (see docs/KPI_ROLE_GATES_SPEC.md §9). All emails below are
-- OWNER-CONFIRMED; do not guess or derive any from the worker set.
--
-- What lands
--   M1  DELETE all role='site' rows (27; superseded by people.
--       is_site_leader + worker_class='salaried' + account_key
--       filters, per §2).
--   M2  Tighten the role CHECK to ('corporate','rdo'). Named
--       constraint so a future reader sees the ruling.
--   M3  CORRECT the two wrong corporate emails already in the table.
--       kpi_roles carries `j.katt@` and `j.lessard@`; NEITHER
--       matches any Rippling work_email. The real addresses are
--       `josh@` and `joe@` (owner-confirmed). Left uncorrected, the
--       CEO and the VP of Operations miss rule 1 on sign-in and fall
--       through to rule 4 - locked out of the board they
--       commissioned. UPDATE rather than delete-and-reinsert so
--       nothing depends on insert order.
--   M4  INSERT the six new corporate rows (Mariela, Alex, Sebastian,
--       Britt, John, Dararet Corporate Field Chef). role='corporate',
--       scope=NULL, ON CONFLICT DO NOTHING.
--
-- Post-state assertion: 9 corporate + 2 rdo = 11 rows in kpi_roles,
-- zero 'site', and every corporate/rdo email matches an ACTIVE
-- person in `people` by work_email.
--
-- ORDERING IS LOAD-BEARING
-- ────────────────────────
-- M1 MUST RUN BEFORE M4. Three of the six M4 emails (m.chavez,
-- s.castro, britt) ALREADY exist in kpi_roles as role='site',
-- scope='CORP'. `email` is the PK and M4 uses ON CONFLICT DO
-- NOTHING, so an insert-first order would silently skip them, then
-- M1 would delete them - three people with no access and no error
-- anywhere. josh@ and joe@ are ALSO currently in kpi_roles as
-- role='site' (with the CORP scope) - they get deleted by M1 first,
-- then M3 renames the wrong-address corporate rows onto their
-- freed emails without a PK collision. Do not reorder for
-- convenience.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies statements sequentially in Supabase Studio, in
--    the exact M1 -> M2 -> M3 -> M4 order.
-- 2. After each block, verify the running row-count:
--      after M1: 5 rows (3 corp + 2 rdo, 'site' gone)
--      after M2: 5 rows (constraint tightened, no data change)
--      after M3: 5 rows (2 emails corrected; still 3 corp + 2 rdo)
--      after M4: 11 rows (9 corp + 2 rdo)
-- 3. Fill in the attestation block at the tail with the SHA the
--    apply matched.
--
-- PII posture: nine emails travel through this file. They belong to
-- the operations leadership + RDO + designated site leaders; the
-- addresses are already in Studio and this file simply corrects and
-- extends them.
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

-- ─── M3 - correct the two wrong corporate emails ───────────────────
-- Existing rows carry j.katt@ and j.lessard@; owner-confirmed real
-- addresses are josh@ and joe@. UPDATE preserves created_by /
-- created_at so audit history stays intact.
UPDATE kpi_roles SET email = 'josh@kitchfix.com'
  WHERE email = 'j.katt@kitchfix.com';
UPDATE kpi_roles SET email = 'joe@kitchfix.com'
  WHERE email = 'j.lessard@kitchfix.com';

-- ─── M4 - insert the six new corporate rows ────────────────────────
-- M4 comes AFTER M1 by design; see the ORDERING block in the
-- header. All addresses are owner-confirmed verbatim.
INSERT INTO kpi_roles (email, role, scope, created_by, created_at)
VALUES
  ('m.chavez@kitchfix.com',    'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('a.wasserman@kitchfix.com', 'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('s.castro@kitchfix.com',    'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('britt@kitchfix.com',       'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('john@kitchfix.com',        'corporate', NULL, 'k.fietek@kitchfix.com', NOW()),
  ('d.inthavone@kitchfix.com', 'corporate', NULL, 'k.fietek@kitchfix.com', NOW())
ON CONFLICT (email) DO NOTHING;

-- ─── Post-state verify (paste output in the attestation) ───────────
-- Expected after M1 + M2 + M3 + M4:
--   role='corporate'  count = 9   (kevin, josh, joe, mariela, alex,
--                                   sebastian, britt, john,
--                                   d.inthavone)
--   role='rdo'        count = 2   (shane, ryan)
--   role='site'       count = 0
--
-- Run in Studio:
--   SELECT role, count(*) FROM kpi_roles GROUP BY role ORDER BY role;
-- Expected output:
--   corporate | 9
--   rdo       | 2
--
-- Match assertion (every corporate/rdo email exists as an ACTIVE
-- person in people by work_email):
--   SELECT k.email, k.role
--     FROM kpi_roles k
--     LEFT JOIN people p
--       ON lower(p.work_email) = lower(k.email)
--      AND p.status = 'ACTIVE'
--    WHERE p.worker_id IS NULL
--    ORDER BY k.role, k.email;
-- Expected output: zero rows.


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file (M1 -> M2 -> M3 -> M4
-- sequentially) in Supabase Studio. This records the exact SHA the
-- apply matched. The migration-gate check on the PR looks for the
-- phrase `applied in Studio: YES` in a comment from an OWNER account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- post-state row counts (paste from Studio):
--   corporate: <count>
--   rdo:       <count>
--   site:      <count, expect 0>
-- notes:              <optional - any statement that needed manual attention>
