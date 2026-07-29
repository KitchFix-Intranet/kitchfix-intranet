-- sc-24: STL - MO sc_day_metadata game_type correction (M-4a prerequisite).
--
-- Context. Same postponement as sc-23. The initial import-script seeded
-- sc_day_metadata from the ORIGINAL schedule where 6/25 was HOME. When
-- sc-19 fixed sc_homestand_schedule, sc_day_metadata was not touched.
-- Result today:
--   2026-06-25: game_type='HOME', game_time='TBD'   (lies; no game here)
--   2026-07-23: game_type='AWAY', game_time='-'     (lies; HOME game here)
--
-- What the chef sees on the July card before and after.
--
-- The game-day counter (sc_daily_revenue.game_type via sc_day_metadata,
-- read at ServiceCalendar.js:246 as isGameDay = !!day.meta?.gameType)
-- counts every day with any non-null game_type. Splits by HOME / AWAY
-- where the card surfaces them.
--
-- STL - MO June + July 2026 counter, measured live 2026-07-29:
--
--                    BEFORE sc-24        AFTER sc-24
--   June total       30 game days        29 game days   (-1 - 6/25 nulled)
--   June HOME        16                  15             (-1)
--   June AWAY        13                  13             (unchanged)
--   July total       31 game days        31 game days   (unchanged)
--   July HOME        14                  15             (+1 - 7/23 flips to HOME)
--   July AWAY        17                  16             (-1)
--
-- Visible effects:
--   - June card total game days drops by one. This is the fix.
--   - July card HOME / AWAY split shifts by one, total unchanged.
--   - Homestand containing 2026-07-23 now shows a home game where the
--     schedule already said one was; the counter no longer disagrees
--     with the tile.
--
-- Confirm via SELECT (post-apply):
--   SELECT service_date, game_type
--     FROM sc_day_metadata
--     WHERE account_key = 'STL - MO'
--       AND service_date >= '2026-06-01' AND service_date <= '2026-07-31'
--       AND game_type IS NOT NULL
--     ORDER BY service_date;
--   -- Expect no row for 2026-06-25, HOME for 2026-07-23.
--
-- Verification pre-apply (run in Studio, expect the two lying values):
--   SELECT service_date, game_type, game_time
--     FROM sc_day_metadata
--     WHERE account_key = 'STL - MO'
--       AND service_date IN ('2026-06-25', '2026-07-23')
--     ORDER BY service_date;

BEGIN;

-- Guard: rows must be present and carry the specific lies we're fixing.
DO $$
DECLARE
  src_bad INT;
  dst_bad INT;
BEGIN
  SELECT COUNT(*) INTO src_bad
    FROM sc_day_metadata
    WHERE account_key   = 'STL - MO'
      AND service_date  = '2026-06-25'
      AND game_type     = 'HOME';
  SELECT COUNT(*) INTO dst_bad
    FROM sc_day_metadata
    WHERE account_key   = 'STL - MO'
      AND service_date  = '2026-07-23'
      AND game_type     = 'AWAY';
  IF src_bad <> 1 THEN
    RAISE EXCEPTION
      'sc-24 refuses: expected 1 STL-MO 2026-06-25 row with game_type=HOME, saw %', src_bad;
  END IF;
  IF dst_bad <> 1 THEN
    RAISE EXCEPTION
      'sc-24 refuses: expected 1 STL-MO 2026-07-23 row with game_type=AWAY, saw %', dst_bad;
  END IF;
END $$;

-- 2026-06-25: no game any more (rescheduled away). Neither HOME nor
-- AWAY - null out both fields, keeping period/week context.
UPDATE sc_day_metadata
   SET game_type   = NULL,
       game_time   = NULL,
       updated_by  = 'sc-24-migration',
       updated_at  = now()
 WHERE account_key  = 'STL - MO'
   AND service_date = '2026-06-25';

-- 2026-07-23: the rescheduled home game vs ARI. game_time 'TBD' matches
-- the HOME pattern used elsewhere in this account's meta.
UPDATE sc_day_metadata
   SET game_type   = 'HOME',
       game_time   = 'TBD',
       updated_by  = 'sc-24-migration',
       updated_at  = now()
 WHERE account_key  = 'STL - MO'
   AND service_date = '2026-07-23';

-- Verification post-apply (run in Studio):
--   SELECT service_date, game_type, game_time, updated_by
--     FROM sc_day_metadata
--     WHERE account_key = 'STL - MO'
--       AND service_date IN ('2026-06-25', '2026-07-23')
--     ORDER BY service_date;
--   -- 2026-06-25 -> (NULL, NULL, 'sc-24-migration')
--   -- 2026-07-23 -> ('HOME', 'TBD', 'sc-24-migration')

COMMIT;
