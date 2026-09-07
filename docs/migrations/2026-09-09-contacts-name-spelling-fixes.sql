-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-09-contacts-name-spelling-fixes
-- Four contacts.name corrections found by the extended landing-data-
-- health sweep. Every fix aligns contacts.name with the Rippling-
-- sourced people.display_name where the two currently disagree AND
-- the difference is a spelling error (not a legitimate nickname
-- variance).
--
-- Discovered via scripts/probes/_probe_sc_landing_data_health.mjs
-- Finding 3a + 3b (spelling subclass).
--
-- Kevin's rulings 2026-09-09:
--   - Ship the four spelling corrections. Diego and Desiree are
--     training-week site leaders; a person seeing their own name
--     misspelled in a system they are being asked to trust is not
--     a small thing.
--   - Leave the two nickname mismatches (Liz Randall, Josh Forkner)
--     alone. Nickname vs formal is not a spelling error - it is two
--     correct answers to different questions, and overwriting one
--     destroys information rather than fixing it. Logged to
--     docs/backlog/two-fields-one-truth.md as a concrete example.
--
-- Rename-safety verification (grep sweep 2026-09-09):
--   Every consumer of the contacts table keys on email, team_key,
--   role, or id. contacts.name is rendering-only in every read
--   site (sc-chase message, Sous rendering, directory display).
--   The Sous findContact tool ilike-searches on name - a corrected
--   spelling improves search accuracy rather than orphaning
--   anything. No downstream cache, join, or foreign-key uses
--   contacts.name as an identifier.
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Block A shows current values; Block B does the UPDATEs in a
-- single transaction with narrow WHERE clauses (idempotent - re-
-- run is a no-op after the first apply); Block C confirms.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Expected pre-fix values:
--   c.parry@kitchfix.com    : "Claire"          (first-only)
--   d.colone@kitchfix.com   : "Deserie Colone"  (spelling)
--   d.diaz@kitchfix.com     : "Diego Diez"      (spelling)
--   j.rogers@kitchfix.com   : "Jordan Rodgers"  (spelling)
SELECT email, name, role, team_key
FROM contacts
WHERE email IN (
  'c.parry@kitchfix.com',
  'd.colone@kitchfix.com',
  'd.diaz@kitchfix.com',
  'j.rogers@kitchfix.com'
)
ORDER BY email;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════
--
-- Each UPDATE guards on the current wrong value so re-running is a
-- no-op. The new values match people.display_name in every case
-- (verified via the sweep).
BEGIN;

UPDATE contacts
   SET name = 'Claire Parry'
 WHERE email = 'c.parry@kitchfix.com'
   AND name  = 'Claire';

UPDATE contacts
   SET name = 'Desiree Colone'
 WHERE email = 'd.colone@kitchfix.com'
   AND name  = 'Deserie Colone';

UPDATE contacts
   SET name = 'Diego Diaz'
 WHERE email = 'd.diaz@kitchfix.com'
   AND name  = 'Diego Diez';

UPDATE contacts
   SET name = 'Jordan Rogers'
 WHERE email = 'j.rogers@kitchfix.com'
   AND name  = 'Jordan Rodgers';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Expected post-fix values (matches people.display_name for each):
--   c.parry@kitchfix.com    : "Claire Parry"
--   d.colone@kitchfix.com   : "Desiree Colone"
--   d.diaz@kitchfix.com     : "Diego Diaz"
--   j.rogers@kitchfix.com   : "Jordan Rogers"
SELECT email, name, role, team_key
FROM contacts
WHERE email IN (
  'c.parry@kitchfix.com',
  'd.colone@kitchfix.com',
  'd.diaz@kitchfix.com',
  'j.rogers@kitchfix.com'
)
ORDER BY email;

-- Regression check: re-run the sweep locally.
--   node --env-file=.env.local scripts/probes/_probe_sc_landing_data_health.mjs
-- Expected after this apply:
--   Finding 3a count: 0  (Claire's single-word name resolved)
--   Finding 3b spelling subclass: 0  (all three spellings resolved)
--   Finding 3b nickname subclass: 2  (Liz Randall + Josh Forkner
--                                     REMAIN - deliberate, per ruling)
