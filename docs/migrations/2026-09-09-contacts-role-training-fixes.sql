-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-09-contacts-role-training-fixes
-- Two contacts.role corrections found by the landing-data-health
-- sweep. Both fixes align contacts.role with the person's real title
-- on the people table.
--
-- Discovered via scripts/probes/_probe_sc_landing_data_health.mjs
-- (report queued 2026-09-09). Both people were landing on the
-- Season overview instead of the Period workspace because their
-- contacts.role value did not map to ROLE_TIERS. people.title was
-- correct in both cases.
--
-- Three-block Studio pattern:
--   A (preflight) - shows current values so the mutation acts on
--                   known state.
--   B (main)      - the two UPDATEs. Idempotent - re-running is a
--                   no-op after the first apply.
--   C (postflight)- confirms the new values.
--
-- Kevin ruling 2026-09-09.
--
-- ─── SHANE LYNCH: separate ruling pending ────────────────────────
-- Shane's user_accounts_manual override was proposed but the
-- overlay is silently shadowed by his ACTIVE people row per the
-- user_accounts_derived view semantics (see
-- docs/migrations/user-accounts-derived.sql:87-105). Not included
-- in this migration - flagged to Kevin, awaiting his choice among
-- (1) mutate people.account_key, (2) alter view semantics,
-- (3) add sc_landing_override, or (4) leave as-is for training.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Expected pre-fix values:
--   c.parry@kitchfix.com : role="Parry"  team_key="TBJ - FL"
--   j.forkner@kitchfix.com : role="Chef"  team_key="TXR - TX - H"
SELECT email, name, role, team_key
FROM contacts
WHERE email IN ('c.parry@kitchfix.com', 'j.forkner@kitchfix.com')
ORDER BY email;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- Claire Parry: her contacts.role was typed as her surname. Her
-- people.title is "Performance Chef" - that is her real role. The
-- companion code change to computeInitialView adds
-- "performance chef": "floor" to ROLE_TIERS so this real title
-- maps to the floor tier and she lands on her Period workspace.
UPDATE contacts
   SET role = 'Performance Chef'
 WHERE email = 'c.parry@kitchfix.com'
   AND role  = 'Parry';

-- Josh Forkner: his contacts.role was typed as bare "Chef" which
-- does not map. His people.title is "Sous Chef" which already
-- maps to floor. No code change needed - just align the fact.
UPDATE contacts
   SET role = 'Sous Chef'
 WHERE email = 'j.forkner@kitchfix.com'
   AND role  = 'Chef';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Expected post-fix values:
--   c.parry@kitchfix.com : role="Performance Chef"  team_key="TBJ - FL"
--   j.forkner@kitchfix.com : role="Sous Chef"       team_key="TXR - TX - H"
SELECT email, name, role, team_key
FROM contacts
WHERE email IN ('c.parry@kitchfix.com', 'j.forkner@kitchfix.com')
ORDER BY email;

-- Regression check: re-run the landing-data-health probe locally
-- (`node --env-file=.env.local scripts/probes/_probe_sc_landing_data_health.mjs`).
-- Expected: Finding 1 (unmapped role) count drops from 2 to 0.
-- Any non-zero after this apply means a new person hit the same
-- shape between the sweep and this run.
