-- ═══════════════════════════════════════════════════════════════════
-- role-gates-2-salary-suppression.sql
--
-- Adds a per-person salary-suppression flag on kpi_roles so one
-- corporate operator (Decnoy Inthavone, d.inthavone@kitchfix.com,
-- Corporate Field Chef) keeps full account visibility while never
-- seeing salary anywhere.
--
-- Why a column and not a fifth role
-- ─────────────────────────────────
-- "Can this person see compensation" is a property of a person, not
-- a rank. A `corporate_no_salary` role would multiply on the next
-- exception (an rdo who should not see salary, a leader who should
-- not) and the kpi_roles CHECK constraint would grow with each. One
-- boolean generalises; a role does not.
--
-- Default posture
-- ───────────────
-- NOT NULL DEFAULT TRUE. The default preserves today's behaviour on
-- every existing row (9 corporate + 2 rdo). Owner-maintained; the
-- derive never writes this column.
--
-- Fail-open on view, closed on nothing
-- ────────────────────────────────────
-- The resolver reads the column and defaults to TRUE if the value is
-- somehow absent (a schema-drift edge). A stale read leaves salary
-- ON, not off, so a mis-read never over-restricts a corporate.
-- Suppression is a positive assertion (`= FALSE`), not an absence.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies this migration in Studio.
-- 2. The DO block below verifies the post-state inside the
--    transaction: 11 total rows, exactly 1 with can_see_salary=FALSE,
--    that row is d.inthavone@kitchfix.com with role='corporate'.
-- 3. After apply, extend + run scripts/_probe_kpi_role_gates.mjs
--    (S1..S5). Every S must pass; the standing G-suite must remain
--    green.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE kpi_roles
  ADD COLUMN IF NOT EXISTS can_see_salary BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN kpi_roles.can_see_salary IS
  'Per-person salary suppression. TRUE (default) means the role''s
   normal salary permission applies. FALSE means this person never
   sees salary on any account regardless of role - the toggle and
   the scope pill are absent exactly as they are for a site_manager.
   Owner-maintained; no derive writes this column.';

UPDATE kpi_roles SET can_see_salary = FALSE
  WHERE email = 'd.inthavone@kitchfix.com';


-- ─── Post-flight ────────────────────────────────────────────────────
-- The migration cannot land unless the post-state is exactly one
-- corporate row suppressed and the target row is the intended one.
DO $$
DECLARE
  v_total       INTEGER;
  v_suppressed  INTEGER;
  v_target_role TEXT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM kpi_roles;
  SELECT COUNT(*) INTO v_suppressed FROM kpi_roles WHERE can_see_salary = FALSE;
  SELECT role INTO v_target_role FROM kpi_roles
    WHERE email = 'd.inthavone@kitchfix.com'
    LIMIT 1;

  IF v_total <> 11 THEN
    RAISE EXCEPTION 'post-flight: kpi_roles total = %, expected 11 (9 corporate + 2 rdo per role-gates-1-cleanup)', v_total;
  END IF;
  IF v_suppressed <> 1 THEN
    RAISE EXCEPTION 'post-flight: can_see_salary=FALSE count = %, expected exactly 1', v_suppressed;
  END IF;
  IF v_target_role IS DISTINCT FROM 'corporate' THEN
    RAISE EXCEPTION 'post-flight: d.inthavone@ role = %, expected corporate', COALESCE(v_target_role, '<not found>');
  END IF;

  RAISE NOTICE 'role-gates-2 post-flight OK: 11 rows, 1 suppressed, target is corporate';
END $$;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- probe result:       <PASS | FAIL - result of _probe_kpi_role_gates.mjs S1..S5>
-- notes:              <optional - anything that needed manual attention>
