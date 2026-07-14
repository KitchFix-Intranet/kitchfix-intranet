-- ═══════════════════════════════════════════════════════════════════
-- sc-18-day-metadata-counter-patches.sql
-- Service Calendar - counter-only patches for sc_day_metadata.game_type
-- misclassifications surfaced in Part 3 audit (see
-- /tmp/txr_schedule_audit.md §P3.2).
--
-- Purpose:
--   Fix 5 rows where sc_day_metadata.game_type disagreed with
--   sc_homestand_schedule.day_type (which is calendar truth per Kevin's
--   2026-07-14 schedule-truth doctrine - see
--   docs/modules/SERVICE_CALENDAR.md "Schedule truth hierarchy").
--
--   The tile RENDER for MLB fee accounts is gated on hs.dayType (fee
--   branch of classifyDayStatus at src/lib/dataStore/serviceCalendar.js
--   :217-240), so these mismatches do NOT affect the visual state of the
--   tile. They ONLY affect the "N game days" counter at
--   src/app/service-calendar/ServiceCalendar.js:156 which reads
--   !!day.meta?.gameType (which surfaces from sc_day_metadata via the
--   sc_daily_revenue view).
--
--   Two classes of misclassification:
--
--   (A) meta.game_type=AWAY on days hs+API agree are HOME. Fix: set
--       meta.game_type=HOME so the counter picks them up correctly.
--       (CIN 5/29 vs ATL, CIN 8/20 vs STL.)
--
--   (B) meta.game_type=NULL on days hs+API agree are AWAY. Fix: set
--       meta.game_type=AWAY so the counter picks them up. (TXR H+V
--       opening series 3/26, 3/28, 3/29 vs PHI - both accounts share
--       the same MLB team's schedule per _extract_sc_13 seed doctrine.)
--
--   Each row is justified line-by-line from the Part 3 three-way diff
--   (sc_homestand_schedule vs sc_day_metadata vs MLB Stats API).
--
-- Reversibility:
--   Every UPDATE is a single row; the pre-fix values are:
--     CIN 5/29 game_type='AWAY'
--     CIN 8/20 game_type='AWAY'
--     TXR-H 3/26/28/29 game_type=NULL
--     TXR-V 3/26/28/29 game_type=NULL
--   To reverse: swap the assignments (or restore from a Studio snapshot).
--
-- Migration-gate: this file adds/modifies rows only in one existing
-- table; no schema change. Kevin runs manually in Studio. The gate
-- workflow (.github/workflows/migration-gate.yml) will require
-- Kevin's `applied in Studio: YES` comment before this PR merges.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- (A) Two CIN rows: hs=GAME + API=HOME, meta wrongly says AWAY.
--     Fix so the counter treats them as HOME game days.

-- CIN - OH 2026-05-29 vs ATL (game_pk 824515, HS6, hs.day_type=GAME,
-- game_time 22:40 UTC = 6:40 PM ET at Great American Ball Park).
UPDATE sc_day_metadata
   SET game_type = 'HOME',
       updated_by = 'sc-18-counter-patches',
       updated_at = now()
 WHERE account_key = 'CIN - OH'
   AND service_date = '2026-05-29'
   AND game_type = 'AWAY';   -- guard: only touch if still the pre-fix value

-- CIN - OH 2026-08-20 vs STL (game_pk 824474, HS11, hs.day_type=GAME,
-- game_time 16:40 UTC = 12:40 PM ET, day game).
UPDATE sc_day_metadata
   SET game_type = 'HOME',
       updated_by = 'sc-18-counter-patches',
       updated_at = now()
 WHERE account_key = 'CIN - OH'
   AND service_date = '2026-08-20'
   AND game_type = 'AWAY';

-- (B) Six TXR rows (three dates x two H/V accounts): hs=AWAY + API=AWAY,
--     meta wrongly says NULL (opening 3-game road series @ PHI). Fix so
--     the counter treats them as game days.

-- TXR - TX - H opening @ PHI:
UPDATE sc_day_metadata
   SET game_type = 'AWAY',
       updated_by = 'sc-18-counter-patches',
       updated_at = now()
 WHERE account_key = 'TXR - TX - H'
   AND service_date IN ('2026-03-26', '2026-03-28', '2026-03-29')
   AND game_type IS NULL;

-- TXR - TX - V opening @ PHI (same schedule, per _extract_sc_13 seed
-- ruling that TXR H+V share teamId 140):
UPDATE sc_day_metadata
   SET game_type = 'AWAY',
       updated_by = 'sc-18-counter-patches',
       updated_at = now()
 WHERE account_key = 'TXR - TX - V'
   AND service_date IN ('2026-03-26', '2026-03-28', '2026-03-29')
   AND game_type IS NULL;

COMMIT;

-- ── Verify probe (run AFTER commit) ────────────────────────────────
--
-- Expect: 0 rows returned. Each row that comes back is a remaining
-- mismatch and warrants a second look.
--
-- SELECT m.account_key, m.service_date, m.game_type, h.day_type
-- FROM sc_day_metadata m
-- JOIN sc_homestand_schedule h
--   USING (account_key, service_date)
-- WHERE m.account_key IN ('CIN - OH', 'TXR - TX - H', 'TXR - TX - V')
--   AND (
--     (h.day_type = 'GAME' AND m.game_type <> 'HOME')
--  OR (h.day_type = 'AWAY' AND (m.game_type <> 'AWAY' OR m.game_type IS NULL))
--   )
-- ORDER BY m.account_key, m.service_date;
