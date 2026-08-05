-- ═══════════════════════════════════════════════════════════════════
-- sc-28-stl-fl-away-dining.sql
-- Service Calendar - STL - FL (Palm Beach Cardinals) away-dining schedule.
--
-- Purpose:
--   Palm Beach shares Roger Dean Stadium with the Jupiter Hammerheads,
--   and St. Lucie is a short bus ride. On away games against JUP or
--   SLU the team returns to the PDC to eat - those are service days
--   and the calendar was blind to them. This migration adds:
--
--     1. `sc_homestand_schedule.opponent_team_id INTEGER` - the MLB
--        Stats API's stable numeric team identifier (much more
--        durable than the 3-letter abbreviation contract). Nullable
--        so existing rows without a backfill entry stay valid.
--     2. Backfill of opponent_team_id on existing STL - FL and
--        TBJ - FL home rows (both accounts use the FSL abbrev set;
--        the mapping is documented + fully covered below).
--     3. INSERT 64 STL - FL AWAY rows for the 2026 season, one per
--        unique service_date. Same source, same API pull as sc-17,
--        with the home filter dropped.
--
--   The pill fires only for (account, opponent) pairs listed in
--   `HOME_DINING_AWAY_OPPONENTS` (application-side code, in a
--   separate file). Rows outside that map insert here as normal
--   AWAY entries and stay invisible to `loadScheduleOverlay` (which
--   widens by one predicate to include qualifying AWAY rows).
--
--   Data source (locked, 2026-08-05):
--     statsapi.mlb.com /api/v1/schedule?sportId=14&teamId=279&season=2026&gameType=R
--     70 AWAY games in the raw pull -> 64 unique service_dates after
--     dedup on (account_key, service_date) with the same postponement-
--     shadow-preferred + DH-compression rules sc-17 used.
--   Team ID mapping:
--     statsapi.mlb.com /api/v1/teams?sportId=14&season=2026
--     Cached at commit time; the mapping below is the authoritative
--     copy for the FSL abbrev set that STL - FL and TBJ - FL rows use.
--
-- ─── Owner ruling revisited (2026-08-05) ──────────────────────────
-- sc-17's header carries a 2026-07-11 hard rule:
--
--     "HOME ONLY - HARD RULE
--      NO AWAY rows for STL - FL. A future pass MUST NOT
--      'complete' this migration by adding AWAY rows."
--
-- That ruling was CORRECT for what was known then. The blast-radius
-- concern was operational: away tiles on a PDC that serves daily
-- would confuse an operator, and the classification path was hard
-- to reason about without breaking existing behavior.
--
-- The dining fact was not known then. Owner-confirmed 2026-08-05:
-- Palm Beach dines at the PDC when the team travels to Jupiter or
-- St. Lucie. Those are service days. The original operational
-- concern is met because rows outside the qualifying opponent set
-- stay invisible to `loadScheduleOverlay` - `day_type = 'AWAY'`
-- rows are only surfaced when the (account, opponent_team_id) pair
-- sits in the application's `HOME_DINING_AWAY_OPPONENTS` map. Every
-- non-qualifying away day (Daytona, Bradenton, etc.) renders as it
-- did before.
--
-- The sc-17 header carries a dated append naming this revisit;
-- the original text is unmodified.
--
-- ─── Doubleheader + postponement shadow ────────────────────────────
-- The 2026 pull includes AWAY dates with the two flags:
--   2026-06-21 vs JUP - doubleheader + postponement shadow
--   2026-07-02 vs LAK - doubleheader + postponement shadow
--
-- Both are handled by the same ON CONFLICT (account_key,
-- service_date) DO UPDATE clause the home path already uses. The
-- shadow-preferred dedup in the API extract picks the played
-- (non-Postponed) row and rides in with is_doubleheader = true.
-- Same shape sc-17 uses for the STL - FL home DH on 2026-05-13.
--
-- ─── FSL team ID / abbrev mapping ──────────────────────────────────
--   279  PMB  Palm Beach Cardinals    (STL parent org)
--   424  DUN  Dunedin Blue Jays       (TOR parent org)
--   450  DBT  Daytona Tortugas        (CIN parent org)
--   479  JUP  Jupiter Hammerheads     (MIA parent org)
--   507  SLU  St. Lucie Mets          (NYM parent org)
--   509  FTM  Fort Myers Mighty Mussels (MIN parent org)
--   566  CLR  Clearwater Threshers    (PHI parent org)
--   570  LAK  Lakeland Flying Tigers  (DET parent org)
--   587  TAM  Tampa Tarpons           (NYY parent org)
--  3390  BRD  Bradenton Marauders     (PIT parent org)
--
-- Backfill scope:
--   STL - FL home rows: 66 rows, opponents in {JUP, SLU, DBT, CLR,
--                       LAK, BRD, TAM, FTM}. All 8 in the map above.
--   TBJ - FL home rows: 66 rows, opponents in the same set + PMB.
--                       All 9 in the map above.
--   MLB rows (CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V): NOT
--                       backfilled here. Their opponents are MLB
--                       3-letter codes and the corresponding team_id
--                       lookup lives in a separate mapping. Future
--                       migration; leaving opponent_team_id NULL on
--                       those rows does not break any current read.
--
-- ─── Away opponent breakdown for STL - FL (64 unique dates) ────────
--   SLU  12  (all 12 -> HOME_DINING qualifying)
--   JUP  11  (all 11 -> HOME_DINING qualifying)
--   DBT  12
--   BRD   6
--   TAM   6
--   FTM   6
--   DUN   6
--   LAK   5
--
-- ─── Idempotency + ordering ────────────────────────────────────────
-- Single BEGIN/COMMIT. Column ADD IF NOT EXISTS. Backfill UPDATEs
-- WHERE opponent_team_id IS NULL. Away INSERTs use ON CONFLICT
-- (account_key, service_date) DO UPDATE (same clause as sc-17).
-- Second run against a post-apply database is a no-op.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. opponent_team_id column ────────────────────────────────────
ALTER TABLE sc_homestand_schedule
  ADD COLUMN IF NOT EXISTS opponent_team_id INTEGER;

COMMENT ON COLUMN sc_homestand_schedule.opponent_team_id IS
  'MLB Stats API numeric team identifier for the opponent. Stable across '
  'seasons; abbreviation contract at `opponent` is the API''s labeling '
  'and can drift. Application-side gates (e.g. HOME_DINING_AWAY_OPPONENTS) '
  'key on this id to avoid the silent-mismatch failure a rename would '
  'produce on abbreviation.';

-- ─── 2. Backfill opponent_team_id on STL - FL + TBJ - FL rows ──────
UPDATE sc_homestand_schedule
   SET opponent_team_id = CASE opponent
     WHEN 'PMB' THEN 279
     WHEN 'DUN' THEN 424
     WHEN 'DBT' THEN 450
     WHEN 'JUP' THEN 479
     WHEN 'SLU' THEN 507
     WHEN 'FTM' THEN 509
     WHEN 'CLR' THEN 566
     WHEN 'LAK' THEN 570
     WHEN 'TAM' THEN 587
     WHEN 'BRD' THEN 3390
     ELSE NULL
   END
 WHERE account_key IN ('STL - FL', 'TBJ - FL')
   AND opponent_team_id IS NULL
   AND opponent IS NOT NULL;

-- ─── 3. INSERT the 64 STL - FL AWAY rows ───────────────────────────
-- Column order matches sc-17 exactly for grep parity, with
-- opponent_team_id inserted next to opponent. homestand_id is NULL
-- (away games do not belong to a homestand block; sc-13 relaxed
-- the NOT NULL constraint).
INSERT INTO sc_homestand_schedule
  (account_key, service_date, day_of_week, day_type, opponent, opponent_team_id,
   game_time, day_night, is_doubleheader, homestand_id, game_pk)
VALUES
  ('STL - FL', '2026-04-07', 'Tuesday', 'AWAY', 'BRD', 3390, '2026-04-07T21:30:00Z', 'night', false, NULL, 820900),
  ('STL - FL', '2026-04-08', 'Wednesday', 'AWAY', 'BRD', 3390, '2026-04-08T15:00:00Z', 'day', false, NULL, 820890),
  ('STL - FL', '2026-04-09', 'Thursday', 'AWAY', 'BRD', 3390, '2026-04-09T22:30:00Z', 'night', false, NULL, 820886),
  ('STL - FL', '2026-04-10', 'Friday', 'AWAY', 'BRD', 3390, '2026-04-10T22:30:00Z', 'night', false, NULL, 820893),
  ('STL - FL', '2026-04-11', 'Saturday', 'AWAY', 'BRD', 3390, '2026-04-11T22:30:00Z', 'night', false, NULL, 820889),
  ('STL - FL', '2026-04-12', 'Sunday', 'AWAY', 'BRD', 3390, '2026-04-12T16:00:00Z', 'day', false, NULL, 820887),
  ('STL - FL', '2026-04-21', 'Tuesday', 'AWAY', 'SLU', 507, '2026-04-21T22:10:00Z', 'night', false, NULL, 820356),
  ('STL - FL', '2026-04-22', 'Wednesday', 'AWAY', 'SLU', 507, '2026-04-22T22:10:00Z', 'night', false, NULL, 820358),
  ('STL - FL', '2026-04-23', 'Thursday', 'AWAY', 'SLU', 507, '2026-04-23T22:10:00Z', 'night', false, NULL, 820360),
  ('STL - FL', '2026-04-24', 'Friday', 'AWAY', 'SLU', 507, '2026-04-24T22:10:00Z', 'night', false, NULL, 820359),
  ('STL - FL', '2026-04-25', 'Saturday', 'AWAY', 'SLU', 507, '2026-04-25T22:10:00Z', 'night', false, NULL, 820362),
  ('STL - FL', '2026-04-26', 'Sunday', 'AWAY', 'SLU', 507, '2026-04-26T16:10:00Z', 'day', false, NULL, 820361),
  ('STL - FL', '2026-05-05', 'Tuesday', 'AWAY', 'JUP', 479, '2026-05-05T22:30:00Z', 'night', false, NULL, 820549),
  ('STL - FL', '2026-05-06', 'Wednesday', 'AWAY', 'JUP', 479, '2026-05-06T22:30:00Z', 'night', false, NULL, 820553),
  ('STL - FL', '2026-05-07', 'Thursday', 'AWAY', 'JUP', 479, '2026-05-07T22:30:00Z', 'night', false, NULL, 820548),
  ('STL - FL', '2026-05-08', 'Friday', 'AWAY', 'JUP', 479, '2026-05-08T22:30:00Z', 'night', false, NULL, 820551),
  ('STL - FL', '2026-05-09', 'Saturday', 'AWAY', 'JUP', 479, '2026-05-09T22:00:00Z', 'night', false, NULL, 820552),
  ('STL - FL', '2026-05-10', 'Sunday', 'AWAY', 'JUP', 479, '2026-05-10T16:30:00Z', 'day', false, NULL, 820544),
  ('STL - FL', '2026-05-19', 'Tuesday', 'AWAY', 'SLU', 507, '2026-05-19T22:05:00Z', 'night', false, NULL, 820353),
  ('STL - FL', '2026-05-20', 'Wednesday', 'AWAY', 'SLU', 507, '2026-05-20T15:10:00Z', 'day', false, NULL, 820342),
  ('STL - FL', '2026-05-21', 'Thursday', 'AWAY', 'SLU', 507, '2026-05-21T22:10:00Z', 'night', false, NULL, 820345),
  ('STL - FL', '2026-05-22', 'Friday', 'AWAY', 'SLU', 507, '2026-05-22T22:10:00Z', 'night', false, NULL, 820344),
  ('STL - FL', '2026-05-23', 'Saturday', 'AWAY', 'SLU', 507, '2026-05-23T22:10:00Z', 'night', false, NULL, 820341),
  ('STL - FL', '2026-05-24', 'Sunday', 'AWAY', 'SLU', 507, '2026-05-24T16:10:00Z', 'day', false, NULL, 820347),
  ('STL - FL', '2026-06-02', 'Tuesday', 'AWAY', 'TAM', 587, '2026-06-02T22:30:00Z', 'night', false, NULL, 820278),
  ('STL - FL', '2026-06-03', 'Wednesday', 'AWAY', 'TAM', 587, '2026-06-03T21:00:00Z', 'day', false, NULL, 820272),
  ('STL - FL', '2026-06-04', 'Thursday', 'AWAY', 'TAM', 587, '2026-06-04T22:30:00Z', 'night', false, NULL, 820266),
  ('STL - FL', '2026-06-05', 'Friday', 'AWAY', 'TAM', 587, '2026-06-05T22:30:00Z', 'night', false, NULL, 820265),
  ('STL - FL', '2026-06-06', 'Saturday', 'AWAY', 'TAM', 587, '2026-06-06T22:30:00Z', 'night', false, NULL, 820267),
  ('STL - FL', '2026-06-07', 'Sunday', 'AWAY', 'TAM', 587, '2026-06-07T16:00:00Z', 'day', false, NULL, 820270),
  ('STL - FL', '2026-06-16', 'Tuesday', 'AWAY', 'JUP', 479, '2026-06-16T16:00:00Z', 'day', false, NULL, 820537),
  ('STL - FL', '2026-06-17', 'Wednesday', 'AWAY', 'JUP', 479, '2026-06-17T22:30:00Z', 'night', false, NULL, 820528),
  ('STL - FL', '2026-06-18', 'Thursday', 'AWAY', 'JUP', 479, '2026-06-18T22:30:00Z', 'night', false, NULL, 820527),
  ('STL - FL', '2026-06-19', 'Friday', 'AWAY', 'JUP', 479, '2026-06-19T22:30:00Z', 'night', false, NULL, 820529),
  ('STL - FL', '2026-06-21', 'Sunday', 'AWAY', 'JUP', 479, '2026-06-21T16:00:00Z', 'day', true, NULL, 820532),
  ('STL - FL', '2026-06-30', 'Tuesday', 'AWAY', 'LAK', 570, '2026-06-30T22:30:00Z', 'night', false, NULL, 820463),
  ('STL - FL', '2026-07-02', 'Thursday', 'AWAY', 'LAK', 570, '2026-07-02T20:00:00Z', 'day', true, NULL, 820458),
  ('STL - FL', '2026-07-03', 'Friday', 'AWAY', 'LAK', 570, '2026-07-03T21:00:00Z', 'day', false, NULL, 820460),
  ('STL - FL', '2026-07-04', 'Saturday', 'AWAY', 'LAK', 570, '2026-07-04T21:00:00Z', 'day', false, NULL, 820459),
  ('STL - FL', '2026-07-05', 'Sunday', 'AWAY', 'LAK', 570, '2026-07-05T16:00:00Z', 'day', false, NULL, 820457),
  ('STL - FL', '2026-07-07', 'Tuesday', 'AWAY', 'DBT', 450, '2026-07-07T22:35:00Z', 'night', false, NULL, 820726),
  ('STL - FL', '2026-07-08', 'Wednesday', 'AWAY', 'DBT', 450, '2026-07-08T22:35:00Z', 'night', false, NULL, 820727),
  ('STL - FL', '2026-07-09', 'Thursday', 'AWAY', 'DBT', 450, '2026-07-09T22:35:00Z', 'night', false, NULL, 820721),
  ('STL - FL', '2026-07-10', 'Friday', 'AWAY', 'DBT', 450, '2026-07-10T22:35:00Z', 'night', false, NULL, 820715),
  ('STL - FL', '2026-07-11', 'Saturday', 'AWAY', 'DBT', 450, '2026-07-11T22:35:00Z', 'night', false, NULL, 820714),
  ('STL - FL', '2026-07-12', 'Sunday', 'AWAY', 'DBT', 450, '2026-07-12T17:05:00Z', 'day', false, NULL, 820716),
  ('STL - FL', '2026-07-28', 'Tuesday', 'AWAY', 'FTM', 509, '2026-07-28T23:05:00Z', 'night', false, NULL, 820585),
  ('STL - FL', '2026-07-29', 'Wednesday', 'AWAY', 'FTM', 509, '2026-07-29T23:05:00Z', 'night', false, NULL, 820580),
  ('STL - FL', '2026-07-30', 'Thursday', 'AWAY', 'FTM', 509, '2026-07-30T23:05:00Z', 'night', false, NULL, 820578),
  ('STL - FL', '2026-07-31', 'Friday', 'AWAY', 'FTM', 509, '2026-07-31T23:05:00Z', 'night', false, NULL, 820579),
  ('STL - FL', '2026-08-01', 'Saturday', 'AWAY', 'FTM', 509, '2026-08-01T22:05:00Z', 'night', false, NULL, 820577),
  ('STL - FL', '2026-08-02', 'Sunday', 'AWAY', 'FTM', 509, '2026-08-02T16:05:00Z', 'day', false, NULL, 820576),
  ('STL - FL', '2026-08-11', 'Tuesday', 'AWAY', 'DBT', 450, '2026-08-11T22:35:00Z', 'night', false, NULL, 820712),
  ('STL - FL', '2026-08-12', 'Wednesday', 'AWAY', 'DBT', 450, '2026-08-12T22:35:00Z', 'night', false, NULL, 820706),
  ('STL - FL', '2026-08-13', 'Thursday', 'AWAY', 'DBT', 450, '2026-08-13T22:35:00Z', 'night', false, NULL, 820707),
  ('STL - FL', '2026-08-14', 'Friday', 'AWAY', 'DBT', 450, '2026-08-14T22:35:00Z', 'night', false, NULL, 820703),
  ('STL - FL', '2026-08-15', 'Saturday', 'AWAY', 'DBT', 450, '2026-08-15T22:35:00Z', 'night', false, NULL, 820701),
  ('STL - FL', '2026-08-16', 'Sunday', 'AWAY', 'DBT', 450, '2026-08-16T17:05:00Z', 'day', false, NULL, 820699),
  ('STL - FL', '2026-08-25', 'Tuesday', 'AWAY', 'DUN', 424, '2026-08-25T22:30:00Z', 'night', false, NULL, 820640),
  ('STL - FL', '2026-08-26', 'Wednesday', 'AWAY', 'DUN', 424, '2026-08-26T22:30:00Z', 'night', false, NULL, 820638),
  ('STL - FL', '2026-08-27', 'Thursday', 'AWAY', 'DUN', 424, '2026-08-27T22:30:00Z', 'night', false, NULL, 820634),
  ('STL - FL', '2026-08-28', 'Friday', 'AWAY', 'DUN', 424, '2026-08-28T22:30:00Z', 'night', false, NULL, 820627),
  ('STL - FL', '2026-08-29', 'Saturday', 'AWAY', 'DUN', 424, '2026-08-29T22:30:00Z', 'night', false, NULL, 820628),
  ('STL - FL', '2026-08-30', 'Sunday', 'AWAY', 'DUN', 424, '2026-08-30T16:00:00Z', 'day', false, NULL, 820629);
ON CONFLICT (account_key, service_date) DO UPDATE
  SET day_type         = EXCLUDED.day_type,
      opponent         = EXCLUDED.opponent,
      opponent_team_id = EXCLUDED.opponent_team_id,
      game_pk          = EXCLUDED.game_pk,
      game_time        = EXCLUDED.game_time,
      day_night        = EXCLUDED.day_night,
      day_of_week      = EXCLUDED.day_of_week,
      is_doubleheader  = EXCLUDED.is_doubleheader
  WHERE sc_homestand_schedule.day_type IN ('GAME', 'AWAY');

-- ─── 4. Verify counts ──────────────────────────────────────────────
-- Run after applying (Studio pastebox):
--
--   SELECT
--     COUNT(*)                                                AS total_stl_fl_rows,
--     COUNT(*) FILTER (WHERE day_type='GAME')                 AS home_rows,
--     COUNT(*) FILTER (WHERE day_type='AWAY')                 AS away_rows,
--     COUNT(*) FILTER (WHERE opponent_team_id IS NULL)        AS null_team_id_rows,
--     COUNT(*) FILTER (WHERE opponent='SLU' AND day_type='AWAY') AS slu_away,
--     COUNT(*) FILTER (WHERE opponent='JUP' AND day_type='AWAY') AS jup_away,
--     COUNT(*) FILTER (WHERE is_doubleheader = true)          AS dh_rows
--   FROM sc_homestand_schedule WHERE account_key='STL - FL';
--
-- Expected: total 130, home 66, away 64, null_team_id 0, slu_away 12,
--           jup_away 11, dh_rows 3 (2026-05-13 home + 2026-06-21 away
--           + 2026-07-02 away).

COMMIT;
