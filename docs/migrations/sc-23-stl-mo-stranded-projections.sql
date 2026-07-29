-- sc-23: STL - MO stranded projections (M-4a prerequisite).
--
-- Context. STL - MO game pk=823042 vs ARI was originally scheduled for
-- 2026-06-25, postponed, then rescheduled to 2026-07-23. Migration
-- sc-19 (2026-07-14) fixed sc_homestand_schedule. It did NOT touch
-- sc_daily_projections, so four projection rows are stranded on the
-- pre-postponement date, and the rescheduled date has zero projections.
--
-- Why this blocks M-4a. M-4a admits STL - MO to the homestand-surface
-- pilot. The first close-out attempt on the HS containing 2026-07-23
-- would trip the sc-submit-closeout missing-projection guard (route
-- refuses with a 400 and names the pair). Guard would be correct.
-- Chef would be stuck.
--
-- Approach. UPDATE, not DELETE + INSERT. Preserves row ids and
-- created_at, moves service_date + updated fields. Four rows,
-- one per service. No collision risk (verified 2026-07-23 is empty
-- for STL - MO).
--
-- Verification pre-apply (run in Studio, expect):
--   SELECT service_id, service_date, projected_count
--     FROM sc_daily_projections
--     WHERE account_key = 'STL - MO'
--       AND service_date IN ('2026-06-25', '2026-07-23');
--   -- Expect 4 rows on 2026-06-25, 0 rows on 2026-07-23.

BEGIN;

-- Guard: the source rows must exist as expected.
DO $$
DECLARE
  src_count INT;
  dst_count INT;
BEGIN
  SELECT COUNT(*) INTO src_count
    FROM sc_daily_projections
    WHERE account_key   = 'STL - MO'
      AND service_date  = '2026-06-25';
  SELECT COUNT(*) INTO dst_count
    FROM sc_daily_projections
    WHERE account_key   = 'STL - MO'
      AND service_date  = '2026-07-23';
  IF src_count <> 4 THEN
    RAISE EXCEPTION
      'sc-23 refuses: expected 4 STL - MO projection rows on 2026-06-25, saw %', src_count;
  END IF;
  IF dst_count <> 0 THEN
    RAISE EXCEPTION
      'sc-23 refuses: expected 0 STL - MO projection rows on 2026-07-23, saw %', dst_count;
  END IF;
END $$;

UPDATE sc_daily_projections
   SET service_date = '2026-07-23',
       updated_by   = 'sc-23-migration',
       updated_at   = now()
 WHERE account_key  = 'STL - MO'
   AND service_date = '2026-06-25';

-- Verification post-apply (run in Studio, expect 0 rows on 6/25,
-- 4 rows on 7/23, projected_counts preserved 68/68/68/8):
--   SELECT service_id, service_date, projected_count, updated_by
--     FROM sc_daily_projections
--     WHERE account_key = 'STL - MO'
--       AND service_date IN ('2026-06-25', '2026-07-23')
--     ORDER BY service_date, service_id;

COMMIT;
