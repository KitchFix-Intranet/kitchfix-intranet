-- ═══════════════════════════════════════════════════════════════════
-- sc-27: TBJ - FL projection reproject from Dunedin home schedule
-- 2026-08-04
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Rewrite `sc_daily_projections` for TBJ - FL, 2026 season, on three
--   specific services so the projected counts line up with the
--   Dunedin Blue Jays home schedule (Single-A Jays, sportId=14). The
--   existing projections were built before the Single-A schedule was
--   released and are decoupled from game days: many home dates carry
--   zero, and many non-home dates carry non-zero.
--
--   Target services (BY ID - see fence below):
--     Pre-Game            b4ed054a-91e2-4c3d-883a-65b01884218d    50 per home date
--     Post-Game           6d130f22-314c-42c3-a0fc-ab777fe85c72    50 per home date
--     Stadium Staff Meals 275c3f76-2133-4ca3-a1cd-bea9978d697b    20 per home date
--
--   Rule: on every 2026-season home date that is NOT a Sunday, set
--   projected_count to the target value. On every other date in the
--   projection footprint, set projected_count to 0.
--
-- Owner rulings this codifies (all 2026-08-04, PR follow-up on the
-- read-only recon documented in the review thread):
--
--   Ruling 1: SUNDAYS ARE OUT AND IT IS NOT A SCHEDULE QUIRK.
--     11 home game dates fall on Sundays in the 2026 Dunedin schedule.
--     Owner: "no sunday service, on sundays they get catering and do
--     not use our services." Sunday home dates project ZERO on all
--     three services. This is deliberate. A future reader looking at
--     66 home games and 55 projected days will assume the 11 were
--     missed - they were not. Sundays are catered by someone else.
--     DO NOT "fix" this by adding Sunday projections.
--
--   Ruling 2: DOUBLEHEADERS GET ONE SERVICE DAY.
--     `sc_homestand_schedule` carries one row per date, not per game.
--     A doubleheader is one row with is_doubleheader=true (2 dates
--     in 2026: Apr 4 vs BRD, May 21 vs FTM). Owner: "a double header
--     day they will get the same service as other days so treat it
--     like a reg service." 50 / 50 / 20 once per date. The one-row-
--     per-date shape means this falls out of the data automatically;
--     DO NOT "correct" it into doubling.
--
--   Ruling 3: CLOSED PERIODS ARE IN, ONCE, WITH THE REASON.
--     179 of 245 change rows fall in closed periods 4-7. Normally
--     that stops the work. It does not here because "closed"
--     currently means the period end date passed - not that AP
--     pulled anything. The billing export does not exist and no site
--     is live. The lock is protecting a process that has not started.
--     THIS IS A ONE-TIME EXCEPTION WITH A STATED REASON, NOT A
--     PRECEDENT. Once AP is pulling periods, a rewrite touching a
--     closed period requires a different conversation.
--
--   Ruling 4: THE 14 OFF-HOME ACTUALS STAY EXACTLY AS THEY ARE.
--     9 seeded + 5 hand-entered. This migration writes projections
--     ONLY. It does not touch sc_daily_actuals under any
--     circumstance. After the rewrite, those days will start showing
--     the `Not scheduled` chip because a pre/post-game meal was
--     recorded on a day with no home game - correct by rule, not to
--     be suppressed or special-cased.
--
--   Ruling 5: ONE-TIME MIGRATION, NOT A RULE.
--     A continuously enforced rule would mean projections could never
--     be hand-adjusted without being overwritten. This corrects a
--     known bad build; if it drifts again, the fix is running it
--     again.
--
--   Ruling 6: THE BACKUP IS STEP ONE OF THIS FILE.
--     No `sc_daily_projections_history` table exists. Without a
--     snapshot, the rewrite is not reversible from the DB alone.
--     Backup runs as the first statement in the same transaction as
--     the rewrite; skipping it becomes impossible.
--     IF NOT EXISTS matters - a re-run must NOT overwrite the backup
--     with already-rewritten values. That would destroy the undo
--     while appearing to succeed. The guard is defensive and load-
--     bearing.
--
-- Fences:
--   - IDs, never names. There is a second `Post Game Meal` service
--     on the Major League PDC roster with a different id and a
--     different price ($23.11775 vs $16.50971). A name-matching
--     UPDATE would catch it; ID-scoped UPDATE cannot.
--   - Scope: account_key = 'TBJ - FL', three specific service_ids,
--     2026-01-01 to 2026-12-31 only. Nothing outside these bounds
--     changes.
--   - No actuals write. No schema change. No other account. No code.
--
-- Apply order:
--   - Paste + run in Supabase Studio.
--   - Single BEGIN/COMMIT transaction.
--   - Verify with the block at the bottom (COMMENTED, ready to
--     paste individually - NOT part of the migration).
--
-- TO RESTORE (in case of ruling reversal or error):
--   UPDATE sc_daily_projections p
--   SET projected_count = b.projected_count,
--       updated_by      = b.updated_by,
--       updated_at      = b.updated_at
--   FROM sc_bak_tbj_fl_projections_2026 b
--   WHERE p.account_key = b.account_key
--     AND p.service_id  = b.service_id
--     AND p.service_date = b.service_date;
--
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- Step 1. BACKUP (must run before any change).
--
-- IF NOT EXISTS is load-bearing: on re-run, the backup already holds
-- pre-rewrite values, and re-copying from the (now-rewritten) live
-- table would overwrite that undo footprint with the new values -
-- silent destruction of the restore path. This guard makes re-run a
-- no-op on the backup, which is the correct behavior.
--
-- Scope: every row in the write footprint (3 service_ids × the
-- season 2026-01-01..2026-12-31). Recon showed 1062 rows across
-- these three services (Pre 354 + Post 354 + SSM 354). The backup
-- captures the entire footprint so the restore query above is byte-
-- perfect regardless of which rows the UPDATE below actually changed.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sc_bak_tbj_fl_projections_2026 AS
SELECT *
FROM sc_daily_projections
WHERE account_key = 'TBJ - FL'
  AND service_id IN (
    'b4ed054a-91e2-4c3d-883a-65b01884218d',    -- Pre-Game
    '6d130f22-314c-42c3-a0fc-ab777fe85c72',    -- Post-Game
    '275c3f76-2133-4ca3-a1cd-bea9978d697b'     -- Stadium Staff Meals
  )
  AND service_date BETWEEN '2026-01-01' AND '2026-12-31';

-- ═══════════════════════════════════════════════════════════════════
-- Step 2. REWRITE Pre-Game (50 on home non-Sunday, 0 elsewhere).
--
-- Home non-Sunday predicate: service_date is in sc_homestand_schedule
-- as a GAME row for this account AND EXTRACT(DOW ...) != 0 (Postgres
-- DOW: 0=Sunday, 1=Monday, ..., 6=Saturday).
--
-- Every home date already has a projection row per recon (noRow=0),
-- so this UPDATE handles all cases. Step 5 below is a defensive
-- INSERT for any home non-Sunday that might not have a row - expected
-- to insert 0 rows.
-- ═══════════════════════════════════════════════════════════════════

UPDATE sc_daily_projections
SET
  projected_count = CASE
    WHEN service_date IN (
      SELECT service_date
      FROM sc_homestand_schedule
      WHERE account_key = 'TBJ - FL'
        AND day_type = 'GAME'
        AND EXTRACT(DOW FROM service_date) != 0
    ) THEN 50
    ELSE 0
  END,
  updated_by = 'sc-27-reproject',
  updated_at = now()
WHERE account_key = 'TBJ - FL'
  AND service_id = 'b4ed054a-91e2-4c3d-883a-65b01884218d'
  AND service_date BETWEEN '2026-01-01' AND '2026-12-31';

-- Step 3. REWRITE Post-Game (50 on home non-Sunday, 0 elsewhere).

UPDATE sc_daily_projections
SET
  projected_count = CASE
    WHEN service_date IN (
      SELECT service_date
      FROM sc_homestand_schedule
      WHERE account_key = 'TBJ - FL'
        AND day_type = 'GAME'
        AND EXTRACT(DOW FROM service_date) != 0
    ) THEN 50
    ELSE 0
  END,
  updated_by = 'sc-27-reproject',
  updated_at = now()
WHERE account_key = 'TBJ - FL'
  AND service_id = '6d130f22-314c-42c3-a0fc-ab777fe85c72'
  AND service_date BETWEEN '2026-01-01' AND '2026-12-31';

-- Step 4. REWRITE Stadium Staff Meals (20 on home non-Sunday, 0 elsewhere).

UPDATE sc_daily_projections
SET
  projected_count = CASE
    WHEN service_date IN (
      SELECT service_date
      FROM sc_homestand_schedule
      WHERE account_key = 'TBJ - FL'
        AND day_type = 'GAME'
        AND EXTRACT(DOW FROM service_date) != 0
    ) THEN 20
    ELSE 0
  END,
  updated_by = 'sc-27-reproject',
  updated_at = now()
WHERE account_key = 'TBJ - FL'
  AND service_id = '275c3f76-2133-4ca3-a1cd-bea9978d697b'
  AND service_date BETWEEN '2026-01-01' AND '2026-12-31';

-- ═══════════════════════════════════════════════════════════════════
-- Steps 5-7. DEFENSIVE INSERT for any home non-Sunday date lacking a
-- projection row. Recon showed 0 rows in this shape (every home date
-- already has a row per service). This is guarded against future
-- schedule pulls that might add a home date without pairing it with
-- an existing projection row. On the current data these three INSERTs
-- affect 0 rows.
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO sc_daily_projections
  (account_key, service_id, service_date, projected_count, created_by, updated_by, created_at, updated_at)
SELECT
  'TBJ - FL',
  'b4ed054a-91e2-4c3d-883a-65b01884218d',
  h.service_date,
  50,
  'sc-27-reproject',
  'sc-27-reproject',
  now(),
  now()
FROM sc_homestand_schedule h
WHERE h.account_key = 'TBJ - FL'
  AND h.day_type = 'GAME'
  AND EXTRACT(DOW FROM h.service_date) != 0
  AND h.service_date BETWEEN '2026-01-01' AND '2026-12-31'
  AND NOT EXISTS (
    SELECT 1 FROM sc_daily_projections p
    WHERE p.account_key = 'TBJ - FL'
      AND p.service_id  = 'b4ed054a-91e2-4c3d-883a-65b01884218d'
      AND p.service_date = h.service_date
  );

INSERT INTO sc_daily_projections
  (account_key, service_id, service_date, projected_count, created_by, updated_by, created_at, updated_at)
SELECT
  'TBJ - FL',
  '6d130f22-314c-42c3-a0fc-ab777fe85c72',
  h.service_date,
  50,
  'sc-27-reproject',
  'sc-27-reproject',
  now(),
  now()
FROM sc_homestand_schedule h
WHERE h.account_key = 'TBJ - FL'
  AND h.day_type = 'GAME'
  AND EXTRACT(DOW FROM h.service_date) != 0
  AND h.service_date BETWEEN '2026-01-01' AND '2026-12-31'
  AND NOT EXISTS (
    SELECT 1 FROM sc_daily_projections p
    WHERE p.account_key = 'TBJ - FL'
      AND p.service_id  = '6d130f22-314c-42c3-a0fc-ab777fe85c72'
      AND p.service_date = h.service_date
  );

INSERT INTO sc_daily_projections
  (account_key, service_id, service_date, projected_count, created_by, updated_by, created_at, updated_at)
SELECT
  'TBJ - FL',
  '275c3f76-2133-4ca3-a1cd-bea9978d697b',
  h.service_date,
  20,
  'sc-27-reproject',
  'sc-27-reproject',
  now(),
  now()
FROM sc_homestand_schedule h
WHERE h.account_key = 'TBJ - FL'
  AND h.day_type = 'GAME'
  AND EXTRACT(DOW FROM h.service_date) != 0
  AND h.service_date BETWEEN '2026-01-01' AND '2026-12-31'
  AND NOT EXISTS (
    SELECT 1 FROM sc_daily_projections p
    WHERE p.account_key = 'TBJ - FL'
      AND p.service_id  = '275c3f76-2133-4ca3-a1cd-bea9978d697b'
      AND p.service_date = h.service_date
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
--   Everything above the COMMIT ran as one transaction. Everything
--   below is a read-only SELECT you paste and run separately. Owner
--   is one-statement-at-a-time; each SELECT is standalone.
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Row counts by service and by projected value.
--     Expected shape (post-migration):
--       Pre-Game   : 55 rows at 50, 299 rows at 0  (total 354)
--       Post-Game  : 55 rows at 50, 299 rows at 0  (total 354)
--       SSM        : 55 rows at 20, 299 rows at 0  (total 354)
--     The 55 = 66 home dates - 11 Sundays.
--     The 299 = 288 off-home + 11 Sunday home dates, both at 0.
--
-- SELECT
--   s.service_name,
--   p.projected_count,
--   COUNT(*) AS row_count
-- FROM sc_daily_projections p
-- JOIN sc_services s ON s.id = p.service_id
-- WHERE p.account_key = 'TBJ - FL'
--   AND p.service_id IN (
--     'b4ed054a-91e2-4c3d-883a-65b01884218d',
--     '6d130f22-314c-42c3-a0fc-ab777fe85c72',
--     '275c3f76-2133-4ca3-a1cd-bea9978d697b'
--   )
--   AND p.service_date BETWEEN '2026-01-01' AND '2026-12-31'
-- GROUP BY s.service_name, p.projected_count
-- ORDER BY s.service_name, p.projected_count DESC;


-- V2. SUNDAY HOME DATES ARE ZERO (Ruling 1 - most likely to look
--     like a bug later; call this out explicitly).
--     Expected: 33 rows returned (3 services × 11 Sundays), all
--     projected_count = 0.
--
-- SELECT
--   p.service_date,
--   TO_CHAR(p.service_date, 'Day') AS dow,
--   s.service_name,
--   p.projected_count
-- FROM sc_daily_projections p
-- JOIN sc_services s ON s.id = p.service_id
-- WHERE p.account_key = 'TBJ - FL'
--   AND p.service_id IN (
--     'b4ed054a-91e2-4c3d-883a-65b01884218d',
--     '6d130f22-314c-42c3-a0fc-ab777fe85c72',
--     '275c3f76-2133-4ca3-a1cd-bea9978d697b'
--   )
--   AND EXTRACT(DOW FROM p.service_date) = 0
--   AND p.service_date IN (
--     SELECT service_date FROM sc_homestand_schedule
--     WHERE account_key = 'TBJ - FL' AND day_type = 'GAME'
--   )
-- ORDER BY p.service_date, s.service_name;


-- V3. Backup table row count matches the pre-change footprint.
--     Expected: 1062 rows (Pre 354 + Post 354 + SSM 354).
--
-- SELECT COUNT(*) FROM sc_bak_tbj_fl_projections_2026;


-- V4. Season projected revenue for the three services under the
--     Sunday exclusion.
--     Expected: ~$108,964.09
--       = 55 non-Sunday home dates × 120 meals × $16.50971
--       = 55 × 1981.1652
--       = 108,964.086
--
-- SELECT ROUND(SUM(projected_revenue)::numeric, 2) AS season_proj_rev
-- FROM sc_daily_revenue
-- WHERE account_key = 'TBJ - FL'
--   AND service_id IN (
--     'b4ed054a-91e2-4c3d-883a-65b01884218d',
--     '6d130f22-314c-42c3-a0fc-ab777fe85c72',
--     '275c3f76-2133-4ca3-a1cd-bea9978d697b'
--   )
--   AND service_date BETWEEN '2026-01-01' AND '2026-12-31';


-- V5. Sanity: the two doubleheader dates (Apr 4 vs BRD, May 21 vs
--     FTM) project once each (Ruling 2). Expected: 3 rows returned
--     per date - Pre-Game=50, Post-Game=50, SSM=20.
--
-- SELECT
--   p.service_date,
--   s.service_name,
--   p.projected_count
-- FROM sc_daily_projections p
-- JOIN sc_services s ON s.id = p.service_id
-- WHERE p.account_key = 'TBJ - FL'
--   AND p.service_id IN (
--     'b4ed054a-91e2-4c3d-883a-65b01884218d',
--     '6d130f22-314c-42c3-a0fc-ab777fe85c72',
--     '275c3f76-2133-4ca3-a1cd-bea9978d697b'
--   )
--   AND p.service_date IN ('2026-04-04', '2026-05-21')
-- ORDER BY p.service_date, s.service_name;
