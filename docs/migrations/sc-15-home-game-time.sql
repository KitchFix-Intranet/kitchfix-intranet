-- ═══════════════════════════════════════════════════════════════════
-- sc-15-home-game-time.sql
-- Service Calendar - store first-pitch time + day/night classification
-- on HOME (day_type='GAME') rows.
--
-- Purpose:
--   Adds `game_time TIMESTAMPTZ` (raw first-pitch UTC) and `day_night
--   TEXT` ('day'/'night') columns to sc_homestand_schedule and
--   backfills them for the 324 home rows across the 4 MLB fee
--   accounts using the MLB Stats API. Enables the sun/moon glyph
--   render on MLB home games (matches MiLB's day/night vocabulary)
--   and unlocks a future "show first pitch on the tile" surface via
--   the raw timestamp.
--
-- Data sources (locked, 2026-07-11):
--   - `game_time` from statsapi.mlb.com `gameDate` (ISO UTC).
--   - `day_night` from statsapi.mlb.com `dayNight` (100% populated
--     per the Task 1 investigation: 81/81 across all three teams).
--   Using the API's own dayNight designation sidesteps the venue
--   timezone gotcha - we never do a UTC->local threshold at read
--   time. Kevin's principle "the real data in PG" is honored by
--   also storing the raw timestamp for future flexibility.
--
-- Scope: HOME games ONLY. Away rows (day_type='AWAY') and TXR
-- exhibitions (day_type='EXHIBITION') keep NULL on both columns.
-- Exhibitions could be filled later from the spring-training
-- endpoint if Kevin wants the sun/moon on those tiles too.
--
-- Ordered steps (single BEGIN/COMMIT):
--   1. ALTER: ADD COLUMN game_time TIMESTAMPTZ (nullable).
--   2. ALTER: ADD COLUMN day_night TEXT (nullable) + CHECK
--      constraint 'day'|'night' when non-null.
--   3. UPDATE: backfill both columns via temp-table + guarded
--      UPDATE (WHERE day_type='GAME'). Data emitted by the
--      extraction script; block embedded below.
--   4. COMMENT ON COLUMN for both new columns.
--
-- Apply order:
--   - Paste + run in Supabase Studio (repo convention: migrations
--     don't auto-run on deploy).
--   - Single BEGIN/COMMIT transaction. Idempotent - safe to re-run.
--   - Verify with the probe block at the bottom (commented; uncomment
--     to execute).
--
-- What this migration does NOT do:
--   - Backfill AWAY or EXHIBITION rows. Add a follow-up when needed.
--   - Add derived indexes on game_time / day_night. Small table
--     (~660 rows total across MLB fee accounts); scan is fine.
--   - Rename sc_homestand_schedule. Still deferred.
--   - Enforce game_time NOT NULL when day_type='GAME'. Partial
--     CHECK would work but adds ceremony for a script-managed
--     invariant. Probe B verifies coverage empirically.
--
-- References:
--   - MLB Stats API investigation:  docs/audits/SC_13_MLB_API_FEASIBILITY_2026-07-10.md
--   - sc-13 migration (game_pk pattern): docs/migrations/sc-13-away-schedule-load.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. game_time column ───────────────────────────────────────────
ALTER TABLE sc_homestand_schedule
  ADD COLUMN IF NOT EXISTS game_time TIMESTAMPTZ;


-- ─── 2. day_night column + CHECK constraint ────────────────────────
-- Nullable so AWAY / EXHIBITION rows stay valid. CHECK gates value
-- domain when set.
ALTER TABLE sc_homestand_schedule
  ADD COLUMN IF NOT EXISTS day_night TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'sc_homestand_schedule'::regclass
       AND conname = 'sc_homestand_schedule_day_night_check'
  ) THEN
    ALTER TABLE sc_homestand_schedule
      ADD CONSTRAINT sc_homestand_schedule_day_night_check
      CHECK (day_night IS NULL OR day_night IN ('day','night'));
  END IF;
END $$;


-- ─── 3. Backfill HOME game_time + day_night ────────────────────────


CREATE TEMP TABLE tmp_sc15_home_daynight (
  account_key  TEXT NOT NULL,
  service_date DATE NOT NULL,
  game_time    TIMESTAMPTZ NOT NULL,
  day_night    TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_sc15_home_daynight
  (account_key, service_date, game_time, day_night) VALUES
  ('CIN - OH', '2026-03-26', '2026-03-26T20:10:00Z', 'day'),
  ('CIN - OH', '2026-03-28', '2026-03-28T20:10:00Z', 'day'),
  ('CIN - OH', '2026-03-29', '2026-03-29T17:40:00Z', 'day'),
  ('CIN - OH', '2026-03-30', '2026-03-30T22:40:00Z', 'night'),
  ('CIN - OH', '2026-03-31', '2026-03-31T22:40:00Z', 'night'),
  ('CIN - OH', '2026-04-01', '2026-04-01T16:40:00Z', 'day'),
  ('CIN - OH', '2026-04-10', '2026-04-10T22:45:00Z', 'night'),
  ('CIN - OH', '2026-04-11', '2026-04-11T20:10:00Z', 'day'),
  ('CIN - OH', '2026-04-12', '2026-04-12T17:40:00Z', 'day'),
  ('CIN - OH', '2026-04-14', '2026-04-14T22:40:00Z', 'night'),
  ('CIN - OH', '2026-04-15', '2026-04-15T22:40:00Z', 'night'),
  ('CIN - OH', '2026-04-16', '2026-04-16T16:40:00Z', 'day'),
  ('CIN - OH', '2026-04-24', '2026-04-24T22:40:00Z', 'night'),
  ('CIN - OH', '2026-04-25', '2026-04-25T23:15:00Z', 'night'),
  ('CIN - OH', '2026-04-26', '2026-04-26T17:40:00Z', 'day'),
  ('CIN - OH', '2026-04-28', '2026-04-28T22:40:00Z', 'night'),
  ('CIN - OH', '2026-04-29', '2026-04-29T22:40:00Z', 'night'),
  ('CIN - OH', '2026-04-30', '2026-04-30T16:40:00Z', 'day'),
  ('CIN - OH', '2026-05-08', '2026-05-08T22:10:00Z', 'night'),
  ('CIN - OH', '2026-05-09', '2026-05-09T20:10:00Z', 'day'),
  ('CIN - OH', '2026-05-10', '2026-05-10T17:40:00Z', 'day'),
  ('CIN - OH', '2026-05-12', '2026-05-12T22:40:00Z', 'night'),
  ('CIN - OH', '2026-05-13', '2026-05-13T22:40:00Z', 'night'),
  ('CIN - OH', '2026-05-14', '2026-05-14T16:40:00Z', 'day'),
  ('CIN - OH', '2026-05-22', '2026-05-22T22:40:00Z', 'night'),
  ('CIN - OH', '2026-05-23', '2026-05-23T23:15:00Z', 'night'),
  ('CIN - OH', '2026-05-24', '2026-05-24T17:40:00Z', 'day'),
  ('CIN - OH', '2026-05-29', '2026-05-29T22:40:00Z', 'night'),
  ('CIN - OH', '2026-05-30', '2026-05-30T23:15:00Z', 'night'),
  ('CIN - OH', '2026-05-31', '2026-05-31T17:40:00Z', 'day'),
  ('CIN - OH', '2026-06-01', '2026-06-01T23:10:00Z', 'night'),
  ('CIN - OH', '2026-06-02', '2026-06-02T23:10:00Z', 'night'),
  ('CIN - OH', '2026-06-03', '2026-06-03T23:10:00Z', 'night'),
  ('CIN - OH', '2026-06-12', '2026-06-12T23:15:00Z', 'night'),
  ('CIN - OH', '2026-06-13', '2026-06-13T20:10:00Z', 'day'),
  ('CIN - OH', '2026-06-14', '2026-06-14T17:40:00Z', 'day'),
  ('CIN - OH', '2026-06-15', '2026-06-15T23:10:00Z', 'night'),
  ('CIN - OH', '2026-06-16', '2026-06-16T23:10:00Z', 'night'),
  ('CIN - OH', '2026-06-17', '2026-06-17T16:40:00Z', 'day'),
  ('CIN - OH', '2026-06-22', '2026-06-22T23:10:00Z', 'night'),
  ('CIN - OH', '2026-06-23', '2026-06-23T23:10:00Z', 'night'),
  ('CIN - OH', '2026-06-24', '2026-06-24T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-03', '2026-07-03T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-04', '2026-07-04T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-05', '2026-07-05T17:05:00Z', 'day'),
  ('CIN - OH', '2026-07-07', '2026-07-07T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-08', '2026-07-08T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-09', '2026-07-09T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-10', '2026-07-10T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-11', '2026-07-11T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-12', '2026-07-12T17:40:00Z', 'day'),
  ('CIN - OH', '2026-07-27', '2026-07-27T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-28', '2026-07-28T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-29', '2026-07-29T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-30', '2026-07-30T23:10:00Z', 'night'),
  ('CIN - OH', '2026-07-31', '2026-07-31T22:10:00Z', 'night'),
  ('CIN - OH', '2026-08-01', '2026-08-01T22:40:00Z', 'night'),
  ('CIN - OH', '2026-08-02', '2026-08-02T17:40:00Z', 'day'),
  ('CIN - OH', '2026-08-04', '2026-08-04T22:40:00Z', 'night'),
  ('CIN - OH', '2026-08-05', '2026-08-05T22:40:00Z', 'night'),
  ('CIN - OH', '2026-08-06', '2026-08-06T16:40:00Z', 'day'),
  ('CIN - OH', '2026-08-14', '2026-08-14T22:10:00Z', 'night'),
  ('CIN - OH', '2026-08-15', '2026-08-15T22:40:00Z', 'night'),
  ('CIN - OH', '2026-08-16', '2026-08-16T17:40:00Z', 'day'),
  ('CIN - OH', '2026-08-17', '2026-08-17T22:40:00Z', 'night'),
  ('CIN - OH', '2026-08-18', '2026-08-18T22:40:00Z', 'night'),
  ('CIN - OH', '2026-08-19', '2026-08-19T22:40:00Z', 'night'),
  ('CIN - OH', '2026-08-20', '2026-08-20T16:40:00Z', 'day'),
  ('CIN - OH', '2026-08-31', '2026-08-31T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-01', '2026-09-01T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-02', '2026-09-02T16:40:00Z', 'day'),
  ('CIN - OH', '2026-09-04', '2026-09-04T22:10:00Z', 'night'),
  ('CIN - OH', '2026-09-05', '2026-09-05T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-06', '2026-09-06T16:10:00Z', 'day'),
  ('CIN - OH', '2026-09-14', '2026-09-14T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-15', '2026-09-15T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-16', '2026-09-16T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-17', '2026-09-17T16:40:00Z', 'day'),
  ('CIN - OH', '2026-09-18', '2026-09-18T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-19', '2026-09-19T22:40:00Z', 'night'),
  ('CIN - OH', '2026-09-20', '2026-09-20T17:40:00Z', 'day'),
  ('STL - MO', '2026-03-26', '2026-03-26T20:15:00Z', 'day'),
  ('STL - MO', '2026-03-28', '2026-03-28T18:15:00Z', 'day'),
  ('STL - MO', '2026-03-29', '2026-03-29T18:15:00Z', 'day'),
  ('STL - MO', '2026-03-30', '2026-03-30T23:45:00Z', 'night'),
  ('STL - MO', '2026-03-31', '2026-03-31T23:45:00Z', 'night'),
  ('STL - MO', '2026-04-01', '2026-04-01T17:15:00Z', 'day'),
  ('STL - MO', '2026-04-10', '2026-04-11T00:15:00Z', 'night'),
  ('STL - MO', '2026-04-11', '2026-04-11T23:15:00Z', 'night'),
  ('STL - MO', '2026-04-12', '2026-04-12T18:15:00Z', 'day'),
  ('STL - MO', '2026-04-13', '2026-04-13T23:45:00Z', 'night'),
  ('STL - MO', '2026-04-14', '2026-04-14T23:45:00Z', 'night'),
  ('STL - MO', '2026-04-15', '2026-04-15T17:15:00Z', 'day'),
  ('STL - MO', '2026-04-24', '2026-04-25T00:15:00Z', 'night'),
  ('STL - MO', '2026-04-25', '2026-04-25T18:15:00Z', 'day'),
  ('STL - MO', '2026-04-26', '2026-04-26T18:15:00Z', 'day'),
  ('STL - MO', '2026-05-01', '2026-05-02T00:15:00Z', 'night'),
  ('STL - MO', '2026-05-02', '2026-05-02T23:15:00Z', 'night'),
  ('STL - MO', '2026-05-03', '2026-05-03T18:15:00Z', 'day'),
  ('STL - MO', '2026-05-04', '2026-05-04T23:45:00Z', 'night'),
  ('STL - MO', '2026-05-05', '2026-05-05T23:45:00Z', 'night'),
  ('STL - MO', '2026-05-06', '2026-05-06T17:15:00Z', 'day'),
  ('STL - MO', '2026-05-15', '2026-05-16T00:15:00Z', 'night'),
  ('STL - MO', '2026-05-16', '2026-05-16T18:15:00Z', 'day'),
  ('STL - MO', '2026-05-17', '2026-05-17T18:15:00Z', 'day'),
  ('STL - MO', '2026-05-19', '2026-05-19T23:45:00Z', 'night'),
  ('STL - MO', '2026-05-20', '2026-05-20T23:45:00Z', 'night'),
  ('STL - MO', '2026-05-21', '2026-05-21T17:15:00Z', 'day'),
  ('STL - MO', '2026-05-29', '2026-05-29T23:15:00Z', 'night'),
  ('STL - MO', '2026-05-30', '2026-05-30T23:15:00Z', 'night'),
  ('STL - MO', '2026-05-31', '2026-05-31T23:20:00Z', 'night'),
  ('STL - MO', '2026-06-01', '2026-06-01T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-02', '2026-06-02T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-03', '2026-06-03T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-05', '2026-06-06T00:15:00Z', 'night'),
  ('STL - MO', '2026-06-06', '2026-06-06T18:15:00Z', 'day'),
  ('STL - MO', '2026-06-07', '2026-06-07T18:15:00Z', 'day'),
  ('STL - MO', '2026-06-15', '2026-06-15T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-16', '2026-06-16T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-17', '2026-06-17T18:15:00Z', 'day'),
  ('STL - MO', '2026-06-22', '2026-06-22T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-23', '2026-06-23T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-24', '2026-06-24T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-25', '2026-06-25T23:45:00Z', 'night'),
  ('STL - MO', '2026-06-26', '2026-06-27T00:15:00Z', 'night'),
  ('STL - MO', '2026-06-27', '2026-06-27T23:15:00Z', 'night'),
  ('STL - MO', '2026-06-28', '2026-06-28T18:15:00Z', 'day'),
  ('STL - MO', '2026-07-06', '2026-07-06T23:45:00Z', 'night'),
  ('STL - MO', '2026-07-07', '2026-07-07T23:45:00Z', 'night'),
  ('STL - MO', '2026-07-08', '2026-07-08T23:45:00Z', 'night'),
  ('STL - MO', '2026-07-09', '2026-07-09T23:45:00Z', 'night'),
  ('STL - MO', '2026-07-10', '2026-07-11T00:15:00Z', 'night'),
  ('STL - MO', '2026-07-11', '2026-07-11T23:15:00Z', 'night'),
  ('STL - MO', '2026-07-12', '2026-07-12T18:15:00Z', 'day'),
  ('STL - MO', '2026-07-24', '2026-07-25T00:15:00Z', 'night'),
  ('STL - MO', '2026-07-25', '2026-07-25T23:15:00Z', 'night'),
  ('STL - MO', '2026-07-26', '2026-07-26T18:15:00Z', 'day'),
  ('STL - MO', '2026-07-27', '2026-07-27T23:45:00Z', 'night'),
  ('STL - MO', '2026-07-28', '2026-07-28T23:45:00Z', 'night'),
  ('STL - MO', '2026-07-29', '2026-07-29T23:45:00Z', 'night'),
  ('STL - MO', '2026-07-30', '2026-07-30T18:15:00Z', 'day'),
  ('STL - MO', '2026-08-07', '2026-08-08T00:15:00Z', 'night'),
  ('STL - MO', '2026-08-08', '2026-08-08T23:15:00Z', 'night'),
  ('STL - MO', '2026-08-09', '2026-08-09T18:15:00Z', 'day'),
  ('STL - MO', '2026-08-10', '2026-08-10T23:45:00Z', 'night'),
  ('STL - MO', '2026-08-11', '2026-08-11T23:45:00Z', 'night'),
  ('STL - MO', '2026-08-12', '2026-08-12T18:15:00Z', 'day'),
  ('STL - MO', '2026-08-25', '2026-08-25T23:45:00Z', 'night'),
  ('STL - MO', '2026-08-26', '2026-08-26T23:45:00Z', 'night'),
  ('STL - MO', '2026-08-27', '2026-08-27T18:15:00Z', 'day'),
  ('STL - MO', '2026-08-28', '2026-08-29T00:15:00Z', 'night'),
  ('STL - MO', '2026-08-29', '2026-08-29T18:15:00Z', 'day'),
  ('STL - MO', '2026-08-30', '2026-08-30T18:15:00Z', 'day'),
  ('STL - MO', '2026-09-11', '2026-09-12T00:15:00Z', 'night'),
  ('STL - MO', '2026-09-12', '2026-09-12T23:15:00Z', 'night'),
  ('STL - MO', '2026-09-13', '2026-09-13T18:15:00Z', 'day'),
  ('STL - MO', '2026-09-14', '2026-09-14T23:45:00Z', 'night'),
  ('STL - MO', '2026-09-15', '2026-09-15T23:45:00Z', 'night'),
  ('STL - MO', '2026-09-16', '2026-09-16T17:15:00Z', 'day'),
  ('STL - MO', '2026-09-18', '2026-09-19T00:15:00Z', 'night'),
  ('STL - MO', '2026-09-19', '2026-09-19T23:15:00Z', 'night'),
  ('STL - MO', '2026-09-20', '2026-09-20T18:15:00Z', 'day'),
  ('TXR - TX - H', '2026-04-03', '2026-04-03T20:05:00Z', 'day'),
  ('TXR - TX - H', '2026-04-04', '2026-04-04T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-05', '2026-04-05T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-04-06', '2026-04-07T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-07', '2026-04-08T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-08', '2026-04-08T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-04-21', '2026-04-22T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-22', '2026-04-23T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-23', '2026-04-24T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-24', '2026-04-25T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-25', '2026-04-25T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-26', '2026-04-26T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-04-27', '2026-04-28T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-28', '2026-04-29T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-04-29', '2026-04-29T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-05-08', '2026-05-09T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-09', '2026-05-09T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-10', '2026-05-10T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-05-11', '2026-05-12T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-12', '2026-05-13T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-13', '2026-05-14T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-25', '2026-05-25T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-26', '2026-05-27T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-27', '2026-05-28T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-28', '2026-05-29T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-29', '2026-05-30T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-05-30', '2026-05-30T20:05:00Z', 'day'),
  ('TXR - TX - H', '2026-05-31', '2026-05-31T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-06-05', '2026-06-06T00:15:00Z', 'night'),
  ('TXR - TX - H', '2026-06-06', '2026-06-06T23:35:00Z', 'night'),
  ('TXR - TX - H', '2026-06-07', '2026-06-07T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-06-15', '2026-06-16T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-06-16', '2026-06-17T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-06-18', '2026-06-18T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-06-19', '2026-06-20T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-06-20', '2026-06-20T20:05:00Z', 'day'),
  ('TXR - TX - H', '2026-06-21', '2026-06-21T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-07-02', '2026-07-03T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-04', '2026-07-04T20:05:00Z', 'day'),
  ('TXR - TX - H', '2026-07-05', '2026-07-05T19:30:00Z', 'day'),
  ('TXR - TX - H', '2026-07-07', '2026-07-08T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-08', '2026-07-09T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-09', '2026-07-10T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-10', '2026-07-11T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-11', '2026-07-11T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-12', '2026-07-12T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-07-20', '2026-07-21T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-21', '2026-07-22T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-22', '2026-07-23T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-24', '2026-07-25T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-07-25', '2026-07-25T23:15:00Z', 'night'),
  ('TXR - TX - H', '2026-07-26', '2026-07-26T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-07-27', '2026-07-27T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-08-03', '2026-08-04T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-04', '2026-08-05T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-05', '2026-08-05T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-08-07', '2026-08-08T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-08', '2026-08-08T23:15:00Z', 'night'),
  ('TXR - TX - H', '2026-08-09', '2026-08-09T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-08-18', '2026-08-19T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-19', '2026-08-20T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-20', '2026-08-21T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-21', '2026-08-22T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-22', '2026-08-22T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-08-23', '2026-08-23T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-08-31', '2026-09-01T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-01', '2026-09-02T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-02', '2026-09-02T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-09-03', '2026-09-04T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-04', '2026-09-05T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-05', '2026-09-05T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-06', '2026-09-06T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-09-15', '2026-09-16T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-16', '2026-09-17T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-17', '2026-09-18T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-18', '2026-09-19T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-19', '2026-09-19T23:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-20', '2026-09-20T18:35:00Z', 'day'),
  ('TXR - TX - H', '2026-09-22', '2026-09-23T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-23', '2026-09-24T00:05:00Z', 'night'),
  ('TXR - TX - H', '2026-09-24', '2026-09-24T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-04-03', '2026-04-03T20:05:00Z', 'day'),
  ('TXR - TX - V', '2026-04-04', '2026-04-04T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-05', '2026-04-05T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-04-06', '2026-04-07T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-07', '2026-04-08T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-08', '2026-04-08T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-04-21', '2026-04-22T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-22', '2026-04-23T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-23', '2026-04-24T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-24', '2026-04-25T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-25', '2026-04-25T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-26', '2026-04-26T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-04-27', '2026-04-28T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-28', '2026-04-29T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-04-29', '2026-04-29T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-05-08', '2026-05-09T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-09', '2026-05-09T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-10', '2026-05-10T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-05-11', '2026-05-12T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-12', '2026-05-13T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-13', '2026-05-14T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-25', '2026-05-25T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-26', '2026-05-27T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-27', '2026-05-28T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-28', '2026-05-29T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-29', '2026-05-30T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-05-30', '2026-05-30T20:05:00Z', 'day'),
  ('TXR - TX - V', '2026-05-31', '2026-05-31T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-06-05', '2026-06-06T00:15:00Z', 'night'),
  ('TXR - TX - V', '2026-06-06', '2026-06-06T23:35:00Z', 'night'),
  ('TXR - TX - V', '2026-06-07', '2026-06-07T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-06-15', '2026-06-16T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-06-16', '2026-06-17T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-06-18', '2026-06-18T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-06-19', '2026-06-20T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-06-20', '2026-06-20T20:05:00Z', 'day'),
  ('TXR - TX - V', '2026-06-21', '2026-06-21T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-07-02', '2026-07-03T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-04', '2026-07-04T20:05:00Z', 'day'),
  ('TXR - TX - V', '2026-07-05', '2026-07-05T19:30:00Z', 'day'),
  ('TXR - TX - V', '2026-07-07', '2026-07-08T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-08', '2026-07-09T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-09', '2026-07-10T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-10', '2026-07-11T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-11', '2026-07-11T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-12', '2026-07-12T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-07-20', '2026-07-21T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-21', '2026-07-22T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-22', '2026-07-23T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-24', '2026-07-25T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-07-25', '2026-07-25T23:15:00Z', 'night'),
  ('TXR - TX - V', '2026-07-26', '2026-07-26T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-07-27', '2026-07-27T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-08-03', '2026-08-04T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-04', '2026-08-05T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-05', '2026-08-05T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-08-07', '2026-08-08T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-08', '2026-08-08T23:15:00Z', 'night'),
  ('TXR - TX - V', '2026-08-09', '2026-08-09T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-08-18', '2026-08-19T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-19', '2026-08-20T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-20', '2026-08-21T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-21', '2026-08-22T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-22', '2026-08-22T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-08-23', '2026-08-23T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-08-31', '2026-09-01T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-01', '2026-09-02T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-02', '2026-09-02T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-09-03', '2026-09-04T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-04', '2026-09-05T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-05', '2026-09-05T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-06', '2026-09-06T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-09-15', '2026-09-16T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-16', '2026-09-17T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-17', '2026-09-18T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-18', '2026-09-19T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-19', '2026-09-19T23:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-20', '2026-09-20T18:35:00Z', 'day'),
  ('TXR - TX - V', '2026-09-22', '2026-09-23T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-23', '2026-09-24T00:05:00Z', 'night'),
  ('TXR - TX - V', '2026-09-24', '2026-09-24T18:35:00Z', 'day');

UPDATE sc_homestand_schedule s
   SET game_time = t.game_time,
       day_night = t.day_night
  FROM tmp_sc15_home_daynight t
 WHERE s.account_key  = t.account_key
   AND s.service_date = t.service_date
   AND s.day_type     = 'GAME';
-- WHERE day_type='GAME' guard: never touches AWAY/EXHIBITION/etc.
-- Idempotent: re-running sets the same values.


-- ─── 4. COMMENT ON COLUMN ──────────────────────────────────────────
COMMENT ON COLUMN sc_homestand_schedule.game_time IS
  'MLB Stats API first-pitch time (UTC) for home games. Nullable - '
  'AWAY and EXHIBITION rows keep NULL. Backfilled by sc-15 for HOME '
  '(day_type=GAME) rows. Future-flexible for a "show first pitch on '
  'the tile" surface (venue-timezone conversion at read time).';

COMMENT ON COLUMN sc_homestand_schedule.day_night IS
  'MLB Stats API dayNight designation (day|night) for home games. '
  'Drives the sun/moon glyph on MLB home cells (matches MiLB pattern). '
  'Populated at load time so read path avoids UTC->venue-local '
  'timezone math. Nullable - AWAY and EXHIBITION rows keep NULL.';


COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- POST-APPLY PROBES (commented; uncomment individually to run)
-- ═══════════════════════════════════════════════════════════════════
--
-- Probe A: coverage - every HOME row has non-null game_time + day_night
--
-- SELECT account_key,
--        COUNT(*) FILTER (WHERE day_type = 'GAME') AS home_rows,
--        COUNT(*) FILTER (WHERE day_type = 'GAME' AND game_time IS NOT NULL) AS with_game_time,
--        COUNT(*) FILTER (WHERE day_type = 'GAME' AND day_night IS NOT NULL) AS with_day_night
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
--  GROUP BY account_key
--  ORDER BY account_key;
--
-- Expected: home_rows = with_game_time = with_day_night = 81 per account.
--
--
-- Probe B: day/night distribution per account
--
-- SELECT account_key, day_night, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
--    AND day_type = 'GAME'
--  GROUP BY account_key, day_night
--  ORDER BY account_key, day_night;
--
-- Expected (matches the extraction summary):
--   CIN - OH     day=27, night=54
--   STL - MO     day=28, night=53
--   TXR - TX - H day=24, night=57
--   TXR - TX - V day=24, night=57
--
--
-- Probe C: AWAY / EXHIBITION rows stayed NULL
--
-- SELECT day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
--    AND day_type IN ('AWAY','EXHIBITION')
--    AND (game_time IS NOT NULL OR day_night IS NOT NULL)
--  GROUP BY day_type;
--
-- Expected: zero rows returned. Anything nonzero means the guarded
-- UPDATE leaked (should not happen - the WHERE day_type='GAME' is
-- explicit).
--
--
-- Probe D: spot-check known games
--
-- SELECT account_key, service_date, day_type, opponent, game_pk,
--        game_time AT TIME ZONE 'America/New_York' AS et_local,
--        day_night
--   FROM sc_homestand_schedule
--  WHERE (account_key = 'CIN - OH' AND service_date = '2026-03-26')  -- Reds Home Opener, 4:10pm ET = day
--     OR (account_key = 'CIN - OH' AND service_date = '2026-03-30')  -- 6:40pm ET = night
--     OR (account_key = 'TXR - TX - H' AND service_date = '2026-04-03')  -- 3:05pm CT = day
--     OR (account_key = 'TXR - TX - H' AND service_date = '2026-04-04') -- 6:05pm CT = night
--  ORDER BY account_key, service_date;
--
-- Expected: game_time renders as the venue-local first-pitch when
-- cast to the venue's timezone; day_night matches the corresponding
-- classification. TXR games rendered via ET will show 1hr ahead of
-- CT; that's expected and just proves the timestamp is real UTC.
