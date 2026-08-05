-- ═══════════════════════════════════════════════════════════════════
-- sc-29: STL - FL SLU away-dining projections
-- 2026-08-05
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Add Palm Beach Cardinals Pre-game + Post-Game projections at 50/50
--   on the 12 St. Lucie Mets (SLU) away dates in 2026. SLU is a short
--   bus ride from Roger Dean Stadium and the club eats at the PDC on
--   travel days against SLU - a home-dining pattern the schedule side
--   opened up in sc-28.
--
--   The 12 SLU dates (from sc-28 sc_homestand_schedule AWAY rows,
--   opponent_team_id = 507):
--     Apr 21-26 (Tue-Sun)   at St. Lucie
--     May 19-24 (Tue-Sun)   at St. Lucie
--
--   Target services (BY ID - see fence below):
--     Palm Beach Cardinals Pre-game    2b6f20df-4a93-44af-89ea-ae750057efbc    50 per SLU away date
--     Palm Beach Cardinals Post-Game   834105fa-8832-4d35-95a7-aa483255ce17    50 per SLU away date
--
-- Owner rulings this codifies (all 2026-08-05):
--
--   Ruling 1: JUP NEEDS NOTHING HERE.
--     The 11 JUP (Jupiter Hammerheads) away dates already carry
--     Palm Beach Cardinals Pre-game=50 + Post-Game=50 - verified via
--     read-only recon: 11/11 dates return the pair. Jupiter shares
--     Roger Dean Stadium with Palm Beach Cardinals so the "away" day
--     coincidentally lands on a home venue, and the existing home
--     projection stream already covered it. sc-29 is SLU-only.
--     DO NOT extend the write footprint to JUP dates.
--
--   Ruling 2: TWO SUNDAY SHAPE (Apr 26, May 24).
--     The SLU series ends on Sunday both times. The home-Sunday shape
--     at STL - FL is MiLB Breakfast=0 + Lunch=0, Palm Beach Cardinals
--     Pre-game=50 + Post-Game=50. Recon showed the MiLB Breakfast +
--     Lunch rows on Apr 26 and May 24 are ALREADY at 0 (rows exist,
--     projected_count=0) so the MiLB write here is a defensive no-op.
--     It runs regardless: the migration is what enforces the shape,
--     not the current state.
--
--   Ruling 3: DO NOT GATE ON THE PERIOD LOCK.
--     Owner ruling verbatim: "these get corrected from actuals once
--     the app is in use. No warning, no refusal." Same reasoning as
--     sc-27 Ruling 3: the billing export does not exist and no site
--     is live, so a "closed" period is currently protecting a process
--     that has not started. THIS IS A ONE-TIME EXCEPTION WITH A
--     STATED REASON, NOT A PRECEDENT. Once AP is pulling periods,
--     touching a closed period requires a different conversation.
--
--   Ruling 4: THE BACKUP IS STEP ONE OF THIS FILE.
--     No sc_daily_projections_history table exists. Without a
--     snapshot the change is not reversible from the DB alone.
--     Backup runs as the first statement in the same transaction as
--     the writes; skipping it becomes impossible.
--     IF NOT EXISTS matters - a re-run must NOT overwrite the backup
--     with already-written values. That would destroy the undo while
--     appearing to succeed. The guard is defensive and load-bearing.
--
-- Fences:
--   - IDs, never names. Same discipline as sc-27: names collide across
--     accounts, IDs do not. All UPDATEs and INSERTs key on service_id.
--   - Scope: account_key = 'STL - FL', two PBC service_ids (INSERT)
--     + two MiLB service_ids on 2 dates (defensive UPDATE). Nothing
--     outside these bounds changes.
--   - No actuals write. No schema change. No other account. No code.
--
-- Apply order:
--   - Paste + run in Supabase Studio.
--   - Single BEGIN/COMMIT transaction.
--   - Verify with the block at the bottom (COMMENTED, ready to
--     paste individually - NOT part of the migration).
--
-- TO RESTORE (in case of ruling reversal or error):
--   -- 1. Delete the 24 inserted PBC rows:
--   DELETE FROM sc_daily_projections
--   WHERE account_key = 'STL - FL'
--     AND service_id IN (
--       '2b6f20df-4a93-44af-89ea-ae750057efbc',   -- PBC Pre-game
--       '834105fa-8832-4d35-95a7-aa483255ce17'    -- PBC Post-Game
--     )
--     AND service_date IN (
--       '2026-04-21','2026-04-22','2026-04-23','2026-04-24','2026-04-25','2026-04-26',
--       '2026-05-19','2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-24'
--     )
--     AND updated_by = 'sc-29-slu-away-dining';
--
--   -- 2. Restore any changed MiLB Sunday rows from backup:
--   UPDATE sc_daily_projections p
--   SET projected_count = b.projected_count,
--       updated_by      = b.updated_by,
--       updated_at      = b.updated_at
--   FROM sc_bak_stl_fl_slu_away_projections_2026 b
--   WHERE p.account_key   = b.account_key
--     AND p.service_id    = b.service_id
--     AND p.service_date  = b.service_date;
--
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- Step 1. BACKUP (must run before any change).
--
-- IF NOT EXISTS is load-bearing: on re-run, the backup already holds
-- pre-write values, and re-copying from the (now-written) live table
-- would overwrite that undo footprint with the new values - silent
-- destruction of the restore path. This guard makes re-run a no-op
-- on the backup, which is the correct behavior.
--
-- Scope: rows in the write footprint:
--   - 4 service_ids (PBC Pre-game, PBC Post-Game, MiLB Breakfast, MiLB Lunch)
--   - 12 SLU away dates
-- Backup captures the entire footprint so the restore query above is
-- byte-perfect regardless of which rows the writes below actually
-- changed. Expected pre-write footprint: 24 rows (12 dates x 2 MiLB
-- rows; the PBC rows do not exist yet so they are captured as an
-- absence).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sc_bak_stl_fl_slu_away_projections_2026 AS
SELECT *
FROM sc_daily_projections
WHERE account_key = 'STL - FL'
  AND service_id IN (
    '2b6f20df-4a93-44af-89ea-ae750057efbc',   -- PBC Pre-game
    '834105fa-8832-4d35-95a7-aa483255ce17',   -- PBC Post-Game
    '4a5c9241-1b54-4506-bcf7-d0e9d957c879',   -- MiLB Breakfast
    '70a1e573-8757-44bb-a7e9-12ed6883fb22'    -- MiLB Lunch
  )
  AND service_date IN (
    '2026-04-21','2026-04-22','2026-04-23','2026-04-24','2026-04-25','2026-04-26',
    '2026-05-19','2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-24'
  );

-- ═══════════════════════════════════════════════════════════════════
-- Step 2. INSERT Palm Beach Cardinals Pre-game = 50 on 12 SLU dates.
--
-- Recon confirmed 0 PBC rows exist on any of these 12 dates, so this
-- is a pure INSERT with NOT EXISTS guard for re-run safety.
-- Expected effect: 12 rows inserted.
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO sc_daily_projections
  (account_key, service_id, service_date, projected_count, created_by, updated_by, created_at, updated_at)
SELECT
  'STL - FL',
  '2b6f20df-4a93-44af-89ea-ae750057efbc',
  d.service_date::date,
  50,
  'sc-29-slu-away-dining',
  'sc-29-slu-away-dining',
  now(),
  now()
FROM (VALUES
  ('2026-04-21'::date), ('2026-04-22'::date), ('2026-04-23'::date),
  ('2026-04-24'::date), ('2026-04-25'::date), ('2026-04-26'::date),
  ('2026-05-19'::date), ('2026-05-20'::date), ('2026-05-21'::date),
  ('2026-05-22'::date), ('2026-05-23'::date), ('2026-05-24'::date)
) AS d(service_date)
WHERE NOT EXISTS (
  SELECT 1 FROM sc_daily_projections p
  WHERE p.account_key  = 'STL - FL'
    AND p.service_id   = '2b6f20df-4a93-44af-89ea-ae750057efbc'
    AND p.service_date = d.service_date::date
);

-- Step 3. INSERT Palm Beach Cardinals Post-Game = 50 on 12 SLU dates.

INSERT INTO sc_daily_projections
  (account_key, service_id, service_date, projected_count, created_by, updated_by, created_at, updated_at)
SELECT
  'STL - FL',
  '834105fa-8832-4d35-95a7-aa483255ce17',
  d.service_date::date,
  50,
  'sc-29-slu-away-dining',
  'sc-29-slu-away-dining',
  now(),
  now()
FROM (VALUES
  ('2026-04-21'::date), ('2026-04-22'::date), ('2026-04-23'::date),
  ('2026-04-24'::date), ('2026-04-25'::date), ('2026-04-26'::date),
  ('2026-05-19'::date), ('2026-05-20'::date), ('2026-05-21'::date),
  ('2026-05-22'::date), ('2026-05-23'::date), ('2026-05-24'::date)
) AS d(service_date)
WHERE NOT EXISTS (
  SELECT 1 FROM sc_daily_projections p
  WHERE p.account_key  = 'STL - FL'
    AND p.service_id   = '834105fa-8832-4d35-95a7-aa483255ce17'
    AND p.service_date = d.service_date::date
);

-- ═══════════════════════════════════════════════════════════════════
-- Steps 4-5. Enforce home-Sunday shape on the two SLU Sunday finales:
--   MiLB Breakfast + MiLB Lunch to 0 on Apr 26 and May 24.
--
-- Recon confirmed both MiLB rows on both Sundays are already at 0.
-- This UPDATE is defensive - it enforces the intended state so a
-- future rerun on drifted data lands the same shape. Expected effect
-- on the current data: 0 rows changed.
-- ═══════════════════════════════════════════════════════════════════

UPDATE sc_daily_projections
SET projected_count = 0,
    updated_by = 'sc-29-slu-away-dining',
    updated_at = now()
WHERE account_key = 'STL - FL'
  AND service_id = '4a5c9241-1b54-4506-bcf7-d0e9d957c879'   -- MiLB Breakfast
  AND service_date IN ('2026-04-26', '2026-05-24')
  AND projected_count IS DISTINCT FROM 0;

UPDATE sc_daily_projections
SET projected_count = 0,
    updated_by = 'sc-29-slu-away-dining',
    updated_at = now()
WHERE account_key = 'STL - FL'
  AND service_id = '70a1e573-8757-44bb-a7e9-12ed6883fb22'   -- MiLB Lunch
  AND service_date IN ('2026-04-26', '2026-05-24')
  AND projected_count IS DISTINCT FROM 0;

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

-- V1. SLU dates now carry PBC Pre-game=50 + Post-Game=50.
--     Expected: 24 rows returned, all projected_count=50.
--
-- SELECT
--   p.service_date,
--   TO_CHAR(p.service_date, 'Dy') AS dow,
--   s.service_name,
--   p.projected_count
-- FROM sc_daily_projections p
-- JOIN sc_services s ON s.id = p.service_id
-- WHERE p.account_key = 'STL - FL'
--   AND p.service_id IN (
--     '2b6f20df-4a93-44af-89ea-ae750057efbc',   -- PBC Pre-game
--     '834105fa-8832-4d35-95a7-aa483255ce17'    -- PBC Post-Game
--   )
--   AND p.service_date IN (
--     '2026-04-21','2026-04-22','2026-04-23','2026-04-24','2026-04-25','2026-04-26',
--     '2026-05-19','2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-24'
--   )
-- ORDER BY p.service_date, s.service_name;


-- V2. Sunday shape sanity: Apr 26 + May 24 have MiLB Breakfast=0 +
--     MiLB Lunch=0 AND PBC Pre-game=50 + PBC Post-Game=50.
--     Expected: 4 rows per date - MiLB Breakfast=0, MiLB Lunch=0,
--     PBC Pre-game=50, PBC Post-Game=50.
--
-- SELECT
--   p.service_date,
--   s.service_name,
--   p.projected_count
-- FROM sc_daily_projections p
-- JOIN sc_services s ON s.id = p.service_id
-- WHERE p.account_key = 'STL - FL'
--   AND p.service_id IN (
--     '2b6f20df-4a93-44af-89ea-ae750057efbc',   -- PBC Pre-game
--     '834105fa-8832-4d35-95a7-aa483255ce17',   -- PBC Post-Game
--     '4a5c9241-1b54-4506-bcf7-d0e9d957c879',   -- MiLB Breakfast
--     '70a1e573-8757-44bb-a7e9-12ed6883fb22'    -- MiLB Lunch
--   )
--   AND p.service_date IN ('2026-04-26', '2026-05-24')
-- ORDER BY p.service_date, s.service_name;


-- V3. JUP away dates already carry PBC 50/50 (no change from sc-29).
--     Expected: 22 rows (11 JUP dates x 2 services), all
--     projected_count=50, updated_by NOT sc-29-slu-away-dining.
--
-- SELECT
--   p.service_date,
--   s.service_name,
--   p.projected_count,
--   p.updated_by
-- FROM sc_daily_projections p
-- JOIN sc_services s ON s.id = p.service_id
-- WHERE p.account_key = 'STL - FL'
--   AND p.service_id IN (
--     '2b6f20df-4a93-44af-89ea-ae750057efbc',
--     '834105fa-8832-4d35-95a7-aa483255ce17'
--   )
--   AND p.service_date IN (
--     '2026-05-05','2026-05-06','2026-05-07','2026-05-08','2026-05-09','2026-05-10',
--     '2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-21'
--   )
-- ORDER BY p.service_date, s.service_name;


-- V4. Backup row count.
--     Expected: 24 rows (12 dates x 2 MiLB service_ids). The two PBC
--     service_ids had 0 rows pre-write.
--
-- SELECT COUNT(*) FROM sc_bak_stl_fl_slu_away_projections_2026;
