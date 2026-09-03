-- ═══════════════════════════════════════════════════════════════════
-- sc-40: populate salaried_manager_emails (TBR + TBJ) and rdo_email
--        (all four mapped accounts) on sc_qbo_account_map
-- 2026-09-03
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   sc-38 seeded TBR - FL + TBJ - FL rows on sc_qbo_account_map with
--   salaried_manager_emails = ARRAY[] and rdo_email = NULL. sc-35
--   seeded CIN - AZ + TXR - AZ with their salaried lists in place but
--   left rdo_email = NULL. Notification routing (fireN1, fireN2,
--   fireN3) reads both fields from the map at send time. In test mode
--   (all four accounts today) the recipient override in
--   src/lib/billing/recipients.js:89 returns Kevin only regardless of
--   these fields, so the values are inert until the flip to
--   qbo_mode='live'. Populate now so no account carries a half-done
--   NULL that gets rediscovered in three months.
--
-- Owner rulings this codifies (Kevin 2026-09-03):
--
--   Ruling 1: SALARIED LIST = every ACTIVE salaried person at the
--     account with a work_email. Established precedent - CIN - AZ's
--     [j.trible, m.decanio] and TXR - AZ's [a.lacy, e.randall] were
--     populated on the same rule (both accounts have exactly the
--     matching people rows). Owner-marked site_leader is one of the
--     entries, not the sole entry.
--
--   Ruling 2: RDO source is academy_region_leads, joined via
--     accounts.region. The table declares itself authoritative in its
--     comment; sc_qbo_account_map has no other RDO resolver.
--     TBR - FL region = East -> s.lynch@kitchfix.com.
--     TBJ - FL region = East -> s.lynch@kitchfix.com.
--     CIN - AZ region = West -> r.moore@kitchfix.com.
--     TXR - AZ region = West -> r.moore@kitchfix.com.
--
--   Ruling 3: JOE COPPOLINO (Regional Chef, East) on TBR - FL's list
--     stays. Follows the "every salaried person with a work_email at
--     the account" rule. Owner will eyeball before flipping TBR - FL
--     to qbo_mode='live'. Flagged in the PR body, not enforced by
--     this migration - the migration derives from the data, and
--     changing the data is a separate action.
--
--   Ruling 4 (scope fold-in): CIN - AZ + TXR - AZ get rdo_email
--     populated in the same migration. Same authoritative source
--     (academy_region_leads), same idempotent WHERE guards. Leaving
--     two accounts NULL after populating two others creates the
--     half-done state that gets rediscovered stale.
--
-- Fences:
--   - No schema change - four UPDATE statements against
--     sc_qbo_account_map (2 for TBR + TBJ salaried+RDO, 2 for CIN +
--     TXR RDO only).
--   - WHERE guards restrict to rows in their expected empty state
--     (TBR/TBJ: salaried_manager_emails = ARRAY[]::text[] AND
--     rdo_email IS NULL; CIN/TXR: rdo_email IS NULL AND
--     array_length(salaried_manager_emails, 1) = 2). Idempotent:
--     re-running is a no-op. Refuses to overwrite if any expected
--     field has been touched between preflight and mutation.
--   - The CIN + TXR UPDATEs deliberately do NOT touch
--     salaried_manager_emails - those lists were populated in an
--     earlier pass and this migration has no ruling to change them.
--
-- Apply order (per the Studio batch-parse gotcha 2026-09-02):
--   THREE separate paste-and-run blocks.
--
-- TO ROLLBACK (if the pre-live-flip eyeball changes any minds):
--   BEGIN;
--   UPDATE sc_qbo_account_map
--     SET salaried_manager_emails = ARRAY[]::text[], rdo_email = NULL
--   WHERE account_key IN ('TBR - FL', 'TBJ - FL');
--   UPDATE sc_qbo_account_map
--     SET rdo_email = NULL
--   WHERE account_key IN ('CIN - AZ', 'TXR - AZ');
--   COMMIT;
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A - preflight (standalone SELECTs, paste + read first)
-- ═══════════════════════════════════════════════════════════════════
--
-- Read all three query outputs. Expected shape:
--   Query 1: TBR - FL and TBJ - FL rows both show
--            salaried_manager_emails = {} and rdo_email = NULL.
--   Query 2: derived salaried lists from people match what BLOCK B
--            will write (3 entries per account).
--   Query 3: derived RDO via accounts.region -> academy_region_leads
--            shows region='East', email='s.lynch@kitchfix.com' for
--            both accounts.
--   If ANY query surfaces a mismatch (Kevin edited a row in Studio,
--   Rippling sync changed roster) HALT and re-derive before BLOCK B.

-- Query 1: current state of all four mapped rows
SELECT
  account_key,
  salaried_manager_emails AS current_salaried,
  rdo_email               AS current_rdo,
  qbo_mode
FROM sc_qbo_account_map
ORDER BY account_key;
-- Expected:
--   CIN - AZ: {j.trible@..., m.decanio@...}, rdo=NULL, qbo_mode=test
--   TBJ - FL: {},                              rdo=NULL, qbo_mode=test
--   TBR - FL: {},                              rdo=NULL, qbo_mode=test
--   TXR - AZ: {a.lacy@...,   e.randall@...},   rdo=NULL, qbo_mode=test

-- Query 2: derive salaried candidates from the people roster
-- (only TBR + TBJ; CIN + TXR are already populated)
SELECT
  p.account_key,
  ARRAY_AGG(p.work_email ORDER BY p.is_site_leader DESC, p.display_name) AS derived_salaried,
  COUNT(*) AS n
FROM people p
WHERE p.account_key IN ('TBR - FL', 'TBJ - FL')
  AND p.status      = 'ACTIVE'
  AND p.is_salaried = TRUE
  AND p.work_email IS NOT NULL
GROUP BY p.account_key
ORDER BY p.account_key;
-- Expected TBR - FL: {j.coppolino@kitchfix.com, d.colone@kitchfix.com, s.groves@kitchfix.com} n=3
-- Expected TBJ - FL: {d.diaz@kitchfix.com, c.parry@kitchfix.com, m.richards@kitchfix.com}     n=3

-- Query 3: derive RDO via accounts.region -> academy_region_leads
-- (all four accounts; CIN + TXR fold-in per Ruling 4)
SELECT
  a.team_key AS account_key,
  a.region,
  arl.email  AS derived_rdo
FROM accounts a
LEFT JOIN academy_region_leads arl ON arl.region = a.region
WHERE a.team_key IN ('TBR - FL', 'TBJ - FL', 'CIN - AZ', 'TXR - AZ')
ORDER BY a.team_key;
-- Expected:
--   CIN - AZ region=West, derived_rdo=r.moore@kitchfix.com
--   TBJ - FL region=East, derived_rdo=s.lynch@kitchfix.com
--   TBR - FL region=East, derived_rdo=s.lynch@kitchfix.com
--   TXR - AZ region=West, derived_rdo=r.moore@kitchfix.com


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B - mutation (BEGIN/COMMIT, paste + run only after BLOCK A
--                     confirms every query matches the expected shape)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- UPDATE 1: TBR - FL salaried list + East RDO
UPDATE sc_qbo_account_map
SET salaried_manager_emails = ARRAY[
      'j.coppolino@kitchfix.com',
      'd.colone@kitchfix.com',
      's.groves@kitchfix.com'
    ],
    rdo_email = 's.lynch@kitchfix.com'
WHERE account_key = 'TBR - FL'
  AND salaried_manager_emails = ARRAY[]::text[]
  AND rdo_email IS NULL;

-- UPDATE 2: TBJ - FL salaried list + East RDO
UPDATE sc_qbo_account_map
SET salaried_manager_emails = ARRAY[
      'd.diaz@kitchfix.com',
      'c.parry@kitchfix.com',
      'm.richards@kitchfix.com'
    ],
    rdo_email = 's.lynch@kitchfix.com'
WHERE account_key = 'TBJ - FL'
  AND salaried_manager_emails = ARRAY[]::text[]
  AND rdo_email IS NULL;

-- UPDATE 3: CIN - AZ West RDO fold-in (Ruling 4). Salaried list
-- untouched; guard on the current 2-entry shape refuses to fire if
-- someone edited it between preflight and mutation.
UPDATE sc_qbo_account_map
SET rdo_email = 'r.moore@kitchfix.com'
WHERE account_key = 'CIN - AZ'
  AND rdo_email IS NULL
  AND array_length(salaried_manager_emails, 1) = 2;

-- UPDATE 4: TXR - AZ West RDO fold-in (Ruling 4). Same shape.
UPDATE sc_qbo_account_map
SET rdo_email = 'r.moore@kitchfix.com'
WHERE account_key = 'TXR - AZ'
  AND rdo_email IS NULL
  AND array_length(salaried_manager_emails, 1) = 2;

-- Postflight: raise if any of the four rows did not land the
-- expected shape. Belt-and-suspenders for the WHERE guards -
-- catches the case where concurrent Studio activity between
-- BLOCK A and BLOCK B silently prevented an UPDATE from touching
-- a row.
--
-- NULL-safe comparison: rdo_email is nullable and salaried_manager_
-- emails is empty-nullable. `<>` and `array_length(ARRAY[]::text[], 1)`
-- both evaluate to NULL rather than TRUE on the un-updated state, so
-- a plain `col <> value` postflight would silently pass on the exact
-- failure it was written to catch. Use `IS DISTINCT FROM` (NULL-aware)
-- and COALESCE-wrap `array_length` to force a real value.
-- Reference: docs/GOTCHAS.md "Postflights on nullable columns must
-- use IS DISTINCT FROM" (2026-09-03).
DO $$
DECLARE
  bad_tbr int;
  bad_tbj int;
  bad_cin int;
  bad_txr int;
BEGIN
  SELECT COUNT(*) INTO bad_tbr FROM sc_qbo_account_map
    WHERE account_key = 'TBR - FL'
      AND (rdo_email IS DISTINCT FROM 's.lynch@kitchfix.com'
        OR COALESCE(array_length(salaried_manager_emails, 1), 0) IS DISTINCT FROM 3);
  IF bad_tbr <> 0 THEN
    RAISE EXCEPTION 'sc-40 HALT: TBR - FL postflight failed (bad=%). Re-run BLOCK A to inspect.', bad_tbr;
  END IF;

  SELECT COUNT(*) INTO bad_tbj FROM sc_qbo_account_map
    WHERE account_key = 'TBJ - FL'
      AND (rdo_email IS DISTINCT FROM 's.lynch@kitchfix.com'
        OR COALESCE(array_length(salaried_manager_emails, 1), 0) IS DISTINCT FROM 3);
  IF bad_tbj <> 0 THEN
    RAISE EXCEPTION 'sc-40 HALT: TBJ - FL postflight failed (bad=%). Re-run BLOCK A to inspect.', bad_tbj;
  END IF;

  SELECT COUNT(*) INTO bad_cin FROM sc_qbo_account_map
    WHERE account_key = 'CIN - AZ'
      AND rdo_email IS DISTINCT FROM 'r.moore@kitchfix.com';
  IF bad_cin <> 0 THEN
    RAISE EXCEPTION 'sc-40 HALT: CIN - AZ postflight failed (bad=%). Re-run BLOCK A to inspect.', bad_cin;
  END IF;

  SELECT COUNT(*) INTO bad_txr FROM sc_qbo_account_map
    WHERE account_key = 'TXR - AZ'
      AND rdo_email IS DISTINCT FROM 'r.moore@kitchfix.com';
  IF bad_txr <> 0 THEN
    RAISE EXCEPTION 'sc-40 HALT: TXR - AZ postflight failed (bad=%). Re-run BLOCK A to inspect.', bad_txr;
  END IF;

  RAISE NOTICE 'sc-40: 4 accounts populated. East (TBR+TBJ) -> s.lynch@kitchfix.com. West (CIN+TXR) -> r.moore@kitchfix.com.';
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C - external verify (SELECTs, paste + read any time after
--                            BLOCK B commits)
-- ═══════════════════════════════════════════════════════════════════

SELECT
  account_key,
  salaried_manager_emails,
  rdo_email,
  qbo_mode
FROM sc_qbo_account_map
ORDER BY account_key;
-- Expect four rows total. All four now carry non-NULL rdo_email.
-- TBR - FL and TBJ - FL additionally carry three-entry salaried lists.
-- CIN - AZ + TXR - AZ salaried lists are unchanged from their sc-35
-- seed (2 entries each).
