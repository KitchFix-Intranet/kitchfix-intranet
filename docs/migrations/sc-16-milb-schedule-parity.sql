-- ═══════════════════════════════════════════════════════════════════
-- sc-16-milb-schedule-parity.sql
-- Service Calendar - Louisville Bats + Buffalo Bisons schedule parity.
--
-- Purpose:
--   Extend the sc-13/sc-15 pattern (structured HOME + AWAY schedule with
--   opponent, game_pk, game_time UTC, day_night) to the two AAA accounts
--   CIN - KY (Louisville) and TBJ - NY (Buffalo). These accounts are
--   per-meal (billing_model = 'actuals_drive_invoice') and today have no
--   rows in sc_homestand_schedule; day/night + game_time are free-text
--   entries on sc_day_metadata.
--
--   After this migration:
--     - accounts gains a data-driven schedule-presence flag
--       (has_homestand_schedule) so the loader can decouple "fetch the
--       schedule" from "billing_model = 'flat_fee'".
--     - sc_homestand_schedule gains an is_doubleheader flag (ruling 2:
--       compress DHs to one row per (account, date), first game's data
--       retained, DH days marked).
--     - Louisville + Buffalo get HOME + AWAY rows from the MLB Stats
--       API (sportId=11 AAA, teamId 416 + 422). day_night + game_time
--       populated on HOME rows; both NULL on AWAY (matches sc-15).
--
-- Data source (locked, 2026-07-11):
--   statsapi.mlb.com /api/v1/schedule?sportId=11&teamId=<id>&season=2026&gameType=R
--   Verified 100% dayNight populated + 100% gameDate populated + ~150
--   unique gamePk per club (per the read-only investigation).
--
-- Scope: Louisville Bats + Buffalo Bisons only. Other MiLB accounts
-- (CIN-AZ, TXR-AZ, TBJ-FL, TBR-FL, etc.) get has_homestand_schedule =
-- false and remain untouched - the reader falls back to sc_day_metadata
-- for their game_type + game_time (source precedence: schedule wins IF
-- has_homestand_schedule = true).
--
-- Ordered steps (single BEGIN/COMMIT):
--   1. ALTER: accounts.has_homestand_schedule BOOLEAN NOT NULL DEFAULT false.
--   2. UPDATE: set has_homestand_schedule = true for the 4 MLB fee
--      accounts (already had schedule; flag catches them up) + the 2
--      new MiLB clubs.
--   3. ALTER: sc_homestand_schedule.is_doubleheader BOOLEAN NOT NULL
--      DEFAULT false.
--   4. INSERT: HOME rows for Louisville + Buffalo (74 + 75 = 149) with
--      opponent, game_pk, game_time UTC, day_night, is_doubleheader.
--   5. INSERT: AWAY rows for Louisville + Buffalo (75 + 74 = 149) with
--      opponent, game_pk, is_doubleheader; day_night + game_time NULL.
--   6. COMMENT ON COLUMNs for the two new flag columns.
--
-- Apply order:
--   - Paste + run in Supabase Studio (repo convention: migrations don't
--     auto-run on deploy).
--   - Single BEGIN/COMMIT transaction. Idempotent - safe to re-run.
--   - Re-runnable: on a TBD firm-up re-run the extractor and paste the
--     fresh INSERT block back in; ON CONFLICT DO UPDATE fires only on
--     rows the loader already owns (day_type IN ('GAME','AWAY')).
--   - Verify with the probe block at the bottom (commented; uncomment
--     individually to run).
--
-- Row counts emitted by scripts/_extract_milb_schedule.mjs (2026-07-11):
--   CIN - KY: home=74 (day=24, night=50), away=75, dh_flagged=7
--   TBJ - NY: home=75 (day=31, night=44), away=74, dh_flagged=9
--
-- What this migration does NOT do:
--   - Live-sync. Load-once for 2026 + a manual re-runnable refresh for
--     TBD firm-up. Live-sync remains a 2027 concern (matches sc-13/sc-15).
--   - Widen the loader / reader / renderer. Task 4 in a follow-up PR
--     flips loadHomestandContext gates from billing_model to
--     has_homestand_schedule, extends the timezone map, and threads the
--     new content through resolveDayKind + buildLargeContent.
--   - Change per-meal financials, meal counts, or projections. Schedule
--     context is additive.
--   - Delete or migrate sc_day_metadata rows. Reader precedence handles
--     it: schedule wins when has_homestand_schedule = true.
--
-- References:
--   - Task 1 investigation: docs/audits/SC_MILB_SCHEDULE_PARITY_TASK1_2026-07-11.md
--   - Extractor:            scripts/_extract_milb_schedule.mjs
--   - sc-13 (AWAY pattern): docs/migrations/sc-13-away-schedule-load.sql
--   - sc-15 (game_time):    docs/migrations/sc-15-home-game-time.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. accounts.has_homestand_schedule ────────────────────────────
-- Boolean, NOT NULL, default false. Set explicitly TRUE below for the
-- 6 accounts that have structured schedule rows (4 MLB fee + 2 new
-- MiLB clubs). All other accounts (PDC, MiLB per-meal not in scope,
-- STL - FL, CORP) remain false.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS has_homestand_schedule BOOLEAN NOT NULL DEFAULT false;


-- ─── 2. Set flag TRUE for schedule-having accounts ─────────────────
-- The 4 MLB fee accounts have carried schedule rows since sc-2 (and
-- through sc-12/13/15). Flipping their flag here catches the reader
-- up to a data-driven gate. The 2 new MiLB clubs get flagged so the
-- reader picks up the schedule inserted below.
UPDATE accounts
   SET has_homestand_schedule = true
 WHERE team_key IN (
   'CIN - OH',      -- Cincinnati Reds (MLB, flat_fee)
   'STL - MO',      -- St. Louis Cardinals (MLB, flat_fee)
   'TXR - TX - H',  -- Texas Rangers home clubhouse (MLB, flat_fee)
   'TXR - TX - V',  -- Texas Rangers visiting clubhouse (MLB, flat_fee)
   'CIN - KY',      -- Louisville Bats (MiLB, actuals_drive_invoice)  -- NEW
   'TBJ - NY'       -- Buffalo Bisons (MiLB, actuals_drive_invoice)   -- NEW
 );


-- ─── 3. sc_homestand_schedule.is_doubleheader ──────────────────────
-- Boolean, NOT NULL, default false. Flagged TRUE on any (account, date)
-- where the API reported 2 games (compressed to one row per Kevin's
-- ruling 2) OR any single visible game carrying doubleHeader in
-- {'Y','S'}. First game's game_time + day_night are what the row
-- carries; the second game's context is dropped.
ALTER TABLE sc_homestand_schedule
  ADD COLUMN IF NOT EXISTS is_doubleheader BOOLEAN NOT NULL DEFAULT false;


-- ─── 4-5. HOME + AWAY inserts (from the extractor) ─────────────────

-- ── (1) HOME rows (day_type='GAME') ────────────────────────────────
INSERT INTO sc_homestand_schedule
  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk, game_time, day_night, is_doubleheader)
VALUES
  ('CIN - KY', '2026-03-27', 'Friday', 'GAME', 'OMA', NULL, 816303, '2026-03-27T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-03-28', 'Saturday', 'GAME', 'OMA', NULL, 816298, '2026-03-28T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-03-29', 'Sunday', 'GAME', 'OMA', NULL, 816305, '2026-03-29T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-03-31', 'Tuesday', 'GAME', 'IOW', NULL, 816301, '2026-03-31T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-04-01', 'Wednesday', 'GAME', 'IOW', NULL, 816293, '2026-04-01T16:05:00Z', 'day', false),
  ('CIN - KY', '2026-04-02', 'Thursday', 'GAME', 'IOW', NULL, 816292, '2026-04-02T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-04-03', 'Friday', 'GAME', 'IOW', NULL, 816294, '2026-04-03T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-04-04', 'Saturday', 'GAME', 'IOW', NULL, 816296, '2026-04-04T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-04-05', 'Sunday', 'GAME', 'IOW', NULL, 816297, '2026-04-05T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-04-14', 'Tuesday', 'GAME', 'TOL', NULL, 816295, '2026-04-14T22:05:00Z', 'night', false),
  ('CIN - KY', '2026-04-15', 'Wednesday', 'GAME', 'TOL', NULL, 816289, '2026-04-15T15:05:00Z', 'day', false),
  ('CIN - KY', '2026-04-16', 'Thursday', 'GAME', 'TOL', NULL, 816290, '2026-04-16T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-04-17', 'Friday', 'GAME', 'TOL', NULL, 816291, '2026-04-17T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-04-18', 'Saturday', 'GAME', 'TOL', NULL, 816285, '2026-04-18T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-04-19', 'Sunday', 'GAME', 'TOL', NULL, 816282, '2026-04-19T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-05-05', 'Tuesday', 'GAME', 'NAS', NULL, 816286, '2026-05-05T22:05:00Z', 'night', false),
  ('CIN - KY', '2026-05-06', 'Wednesday', 'GAME', 'NAS', NULL, 816287, '2026-05-06T15:05:00Z', 'day', false),
  ('CIN - KY', '2026-05-07', 'Thursday', 'GAME', 'NAS', NULL, 816284, '2026-05-07T20:35:00Z', 'night', true),
  ('CIN - KY', '2026-05-08', 'Friday', 'GAME', 'NAS', NULL, 816281, '2026-05-08T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-05-09', 'Saturday', 'GAME', 'NAS', NULL, 816283, '2026-05-09T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-05-10', 'Sunday', 'GAME', 'NAS', NULL, 816288, '2026-05-10T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-05-12', 'Tuesday', 'GAME', 'IND', NULL, 816277, '2026-05-12T22:05:00Z', 'night', false),
  ('CIN - KY', '2026-05-13', 'Wednesday', 'GAME', 'IND', NULL, 816280, '2026-05-13T15:05:00Z', 'day', false),
  ('CIN - KY', '2026-05-14', 'Thursday', 'GAME', 'IND', NULL, 816278, '2026-05-14T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-05-15', 'Friday', 'GAME', 'IND', NULL, 816279, '2026-05-15T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-05-16', 'Saturday', 'GAME', 'IND', NULL, 816276, '2026-05-16T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-05-17', 'Sunday', 'GAME', 'IND', NULL, 816275, '2026-05-17T16:05:00Z', 'day', true),
  ('CIN - KY', '2026-05-26', 'Tuesday', 'GAME', 'STP', NULL, 816274, '2026-05-26T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-05-27', 'Wednesday', 'GAME', 'STP', NULL, 816266, '2026-05-27T16:05:00Z', 'day', false),
  ('CIN - KY', '2026-05-28', 'Thursday', 'GAME', 'STP', NULL, 816265, '2026-05-28T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-05-29', 'Friday', 'GAME', 'STP', NULL, 816273, '2026-05-29T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-05-30', 'Saturday', 'GAME', 'STP', NULL, 816272, '2026-05-30T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-05-31', 'Sunday', 'GAME', 'STP', NULL, 816268, '2026-05-31T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-06-09', 'Tuesday', 'GAME', 'IOW', NULL, 816267, '2026-06-09T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-06-10', 'Wednesday', 'GAME', 'IOW', NULL, 816271, '2026-06-10T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-06-11', 'Thursday', 'GAME', 'IOW', NULL, 816270, '2026-06-11T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-06-12', 'Friday', 'GAME', 'IOW', NULL, 816269, '2026-06-12T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-06-13', 'Saturday', 'GAME', 'IOW', NULL, 816261, '2026-06-13T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-06-14', 'Sunday', 'GAME', 'IOW', NULL, 816257, '2026-06-14T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-06-23', 'Tuesday', 'GAME', 'STP', NULL, 816260, '2026-06-23T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-06-24', 'Wednesday', 'GAME', 'STP', NULL, 816258, '2026-06-24T16:05:00Z', 'day', false),
  ('CIN - KY', '2026-06-27', 'Saturday', 'GAME', 'STP', NULL, 816262, '2026-06-27T19:05:00Z', 'day', true),
  ('CIN - KY', '2026-06-26', 'Friday', 'GAME', 'STP', NULL, 816264, '2026-06-26T20:05:00Z', 'night', true),
  ('CIN - KY', '2026-06-28', 'Sunday', 'GAME', 'STP', NULL, 816259, '2026-06-28T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-07-07', 'Tuesday', 'GAME', 'OMA', NULL, 816250, '2026-07-07T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-07-08', 'Wednesday', 'GAME', 'OMA', NULL, 816255, '2026-07-08T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-07-09', 'Thursday', 'GAME', 'OMA', NULL, 816256, '2026-07-09T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-07-10', 'Friday', 'GAME', 'OMA', NULL, 816249, '2026-07-10T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-07-11', 'Saturday', 'GAME', 'OMA', NULL, 816252, '2026-07-11T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-07-12', 'Sunday', 'GAME', 'OMA', NULL, 816254, '2026-07-12T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-07-28', 'Tuesday', 'GAME', 'IND', NULL, 816253, '2026-07-28T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-07-29', 'Wednesday', 'GAME', 'IND', NULL, 816251, '2026-07-29T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-07-30', 'Thursday', 'GAME', 'IND', NULL, 816243, '2026-07-30T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-07-31', 'Friday', 'GAME', 'IND', NULL, 816248, '2026-07-31T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-08-01', 'Saturday', 'GAME', 'IND', NULL, 816245, '2026-08-01T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-08-02', 'Sunday', 'GAME', 'IND', NULL, 816242, '2026-08-02T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-08-11', 'Tuesday', 'GAME', 'TOL', NULL, 816244, '2026-08-11T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-08-12', 'Wednesday', 'GAME', 'TOL', NULL, 816247, '2026-08-12T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-08-13', 'Thursday', 'GAME', 'TOL', NULL, 816246, '2026-08-13T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-08-14', 'Friday', 'GAME', 'TOL', NULL, 816240, '2026-08-14T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-08-15', 'Saturday', 'GAME', 'TOL', NULL, 816241, '2026-08-15T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-08-16', 'Sunday', 'GAME', 'TOL', NULL, 816239, '2026-08-16T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-08-25', 'Tuesday', 'GAME', 'GWN', NULL, 816231, '2026-08-25T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-08-26', 'Wednesday', 'GAME', 'GWN', NULL, 816232, '2026-08-26T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-08-27', 'Thursday', 'GAME', 'GWN', NULL, 816236, '2026-08-27T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-08-28', 'Friday', 'GAME', 'GWN', NULL, 816234, '2026-08-28T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-08-29', 'Saturday', 'GAME', 'GWN', NULL, 816237, '2026-08-29T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-08-30', 'Sunday', 'GAME', 'GWN', NULL, 816233, '2026-08-30T17:05:00Z', 'day', false),
  ('CIN - KY', '2026-09-08', 'Tuesday', 'GAME', 'COL', NULL, 816238, '2026-09-08T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-09-09', 'Wednesday', 'GAME', 'COL', NULL, 816235, '2026-09-09T16:05:00Z', 'day', false),
  ('CIN - KY', '2026-09-10', 'Thursday', 'GAME', 'COL', NULL, 816230, '2026-09-10T22:35:00Z', 'night', false),
  ('CIN - KY', '2026-09-11', 'Friday', 'GAME', 'COL', NULL, 816229, '2026-09-11T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-09-12', 'Saturday', 'GAME', 'COL', NULL, 816224, '2026-09-12T23:15:00Z', 'night', false),
  ('CIN - KY', '2026-09-13', 'Sunday', 'GAME', 'COL', NULL, 816223, '2026-09-13T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-03-27', 'Friday', 'GAME', 'SWB', NULL, 816976, '2026-03-27T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-03-28', 'Saturday', 'GAME', 'SWB', NULL, 816975, '2026-03-28T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-03-29', 'Sunday', 'GAME', 'SWB', NULL, 816972, '2026-03-29T16:35:00Z', 'day', true),
  ('TBJ - NY', '2026-04-07', 'Tuesday', 'GAME', 'SYR', NULL, 816974, '2026-04-07T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-04-08', 'Wednesday', 'GAME', 'SYR', NULL, 816973, '2026-04-08T16:35:00Z', 'day', true),
  ('TBJ - NY', '2026-04-09', 'Thursday', 'GAME', 'SYR', NULL, 816971, '2026-04-09T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-04-10', 'Friday', 'GAME', 'SYR', NULL, 816966, '2026-04-10T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-04-11', 'Saturday', 'GAME', 'SYR', NULL, 816970, '2026-04-11T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-04-12', 'Sunday', 'GAME', 'SYR', NULL, 816969, '2026-04-12T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-04-21', 'Tuesday', 'GAME', 'COL', NULL, 816968, '2026-04-21T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-04-22', 'Wednesday', 'GAME', 'COL', NULL, 816967, '2026-04-22T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-04-23', 'Thursday', 'GAME', 'COL', NULL, 816965, '2026-04-23T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-04-24', 'Friday', 'GAME', 'COL', NULL, 816962, '2026-04-24T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-04-25', 'Saturday', 'GAME', 'COL', NULL, 816964, '2026-04-25T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-04-26', 'Sunday', 'GAME', 'COL', NULL, 816963, '2026-04-26T16:05:00Z', 'day', true),
  ('TBJ - NY', '2026-05-12', 'Tuesday', 'GAME', 'WOR', NULL, 816958, '2026-05-12T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-05-13', 'Wednesday', 'GAME', 'WOR', NULL, 816961, '2026-05-13T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-05-14', 'Thursday', 'GAME', 'WOR', NULL, 816960, '2026-05-14T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-05-15', 'Friday', 'GAME', 'WOR', NULL, 816959, '2026-05-15T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-05-16', 'Saturday', 'GAME', 'WOR', NULL, 816955, '2026-05-16T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-05-17', 'Sunday', 'GAME', 'WOR', NULL, 816957, '2026-05-17T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-05-26', 'Tuesday', 'GAME', 'LHV', NULL, 816956, '2026-05-26T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-05-27', 'Wednesday', 'GAME', 'LHV', NULL, 816950, '2026-05-27T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-05-28', 'Thursday', 'GAME', 'LHV', NULL, 816951, '2026-05-28T15:05:00Z', 'day', false),
  ('TBJ - NY', '2026-05-29', 'Friday', 'GAME', 'LHV', NULL, 816949, '2026-05-29T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-05-30', 'Saturday', 'GAME', 'LHV', NULL, 816952, '2026-05-30T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-05-31', 'Sunday', 'GAME', 'LHV', NULL, 816953, '2026-05-31T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-06-09', 'Tuesday', 'GAME', 'SYR', NULL, 816954, '2026-06-09T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-10', 'Wednesday', 'GAME', 'SYR', NULL, 816944, '2026-06-10T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-11', 'Thursday', 'GAME', 'SYR', NULL, 816947, '2026-06-11T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-12', 'Friday', 'GAME', 'SYR', NULL, 816943, '2026-06-12T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-13', 'Saturday', 'GAME', 'SYR', NULL, 816946, '2026-06-13T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-06-14', 'Sunday', 'GAME', 'SYR', NULL, 816948, '2026-06-14T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-06-16', 'Tuesday', 'GAME', 'CLT', NULL, 816945, '2026-06-16T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-17', 'Wednesday', 'GAME', 'CLT', NULL, 816942, '2026-06-17T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-06-18', 'Thursday', 'GAME', 'CLT', NULL, 816940, '2026-06-18T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-19', 'Friday', 'GAME', 'CLT', NULL, 816939, '2026-06-19T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-20', 'Saturday', 'GAME', 'CLT', NULL, 816941, '2026-06-20T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-06-21', 'Sunday', 'GAME', 'CLT', NULL, 816938, '2026-06-21T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-07-07', 'Tuesday', 'GAME', 'SWB', NULL, 816936, '2026-07-07T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-08', 'Wednesday', 'GAME', 'SWB', NULL, 816937, '2026-07-08T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-09', 'Thursday', 'GAME', 'SWB', NULL, 816932, '2026-07-09T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-10', 'Friday', 'GAME', 'SWB', NULL, 816933, '2026-07-10T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-11', 'Saturday', 'GAME', 'SWB', NULL, 816935, '2026-07-11T20:30:00Z', 'night', true),
  ('TBJ - NY', '2026-07-12', 'Sunday', 'GAME', 'SWB', NULL, 816934, '2026-07-12T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-07-21', 'Tuesday', 'GAME', 'ROC', NULL, 816930, '2026-07-21T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-22', 'Wednesday', 'GAME', 'ROC', NULL, 816931, '2026-07-22T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-07-23', 'Thursday', 'GAME', 'ROC', NULL, 816927, '2026-07-23T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-24', 'Friday', 'GAME', 'ROC', NULL, 816928, '2026-07-24T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-25', 'Saturday', 'GAME', 'ROC', NULL, 816929, '2026-07-25T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-07-26', 'Sunday', 'GAME', 'ROC', NULL, 816924, '2026-07-26T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-08-04', 'Tuesday', 'GAME', 'NOR', NULL, 816925, '2026-08-04T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-05', 'Wednesday', 'GAME', 'NOR', NULL, 816926, '2026-08-05T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-08-06', 'Thursday', 'GAME', 'NOR', NULL, 816920, '2026-08-06T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-07', 'Friday', 'GAME', 'NOR', NULL, 816919, '2026-08-07T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-08', 'Saturday', 'GAME', 'NOR', NULL, 816921, '2026-08-08T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-09', 'Sunday', 'GAME', 'NOR', NULL, 816922, '2026-08-09T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-08-18', 'Tuesday', 'GAME', 'LHV', NULL, 816923, '2026-08-18T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-19', 'Wednesday', 'GAME', 'LHV', NULL, 816915, '2026-08-19T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-08-20', 'Thursday', 'GAME', 'LHV', NULL, 816914, '2026-08-20T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-21', 'Friday', 'GAME', 'LHV', NULL, 816918, '2026-08-21T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-22', 'Saturday', 'GAME', 'LHV', NULL, 816917, '2026-08-22T22:35:00Z', 'night', false),
  ('TBJ - NY', '2026-08-23', 'Sunday', 'GAME', 'LHV', NULL, 816916, '2026-08-23T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-09-01', 'Tuesday', 'GAME', 'WOR', NULL, 816912, '2026-09-01T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-02', 'Wednesday', 'GAME', 'WOR', NULL, 816913, '2026-09-02T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-03', 'Thursday', 'GAME', 'WOR', NULL, 816911, '2026-09-03T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-04', 'Friday', 'GAME', 'WOR', NULL, 816910, '2026-09-04T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-05', 'Saturday', 'GAME', 'WOR', NULL, 816909, '2026-09-05T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-06', 'Sunday', 'GAME', 'WOR', NULL, 816908, '2026-09-06T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-09-15', 'Tuesday', 'GAME', 'ROC', NULL, 816907, '2026-09-15T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-16', 'Wednesday', 'GAME', 'ROC', NULL, 816905, '2026-09-16T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-17', 'Thursday', 'GAME', 'ROC', NULL, 816906, '2026-09-17T16:05:00Z', 'day', false),
  ('TBJ - NY', '2026-09-18', 'Friday', 'GAME', 'ROC', NULL, 816901, '2026-09-18T22:05:00Z', 'night', false),
  ('TBJ - NY', '2026-09-19', 'Saturday', 'GAME', 'ROC', NULL, 816904, '2026-09-19T17:05:00Z', 'day', false),
  ('TBJ - NY', '2026-09-20', 'Sunday', 'GAME', 'ROC', NULL, 816903, '2026-09-20T16:05:00Z', 'day', false)
ON CONFLICT (account_key, service_date) DO UPDATE
  SET day_type        = EXCLUDED.day_type,
      opponent        = EXCLUDED.opponent,
      game_pk         = EXCLUDED.game_pk,
      game_time       = EXCLUDED.game_time,
      day_night       = EXCLUDED.day_night,
      day_of_week     = EXCLUDED.day_of_week,
      is_doubleheader = EXCLUDED.is_doubleheader
  WHERE sc_homestand_schedule.day_type = 'GAME';
-- ON CONFLICT strategy: only re-update rows the loader already owns
-- (day_type = 'GAME'). Same guard as sc-13 AWAY re-runs.

-- ── (2) AWAY rows (day_type='AWAY') ────────────────────────────────
-- day_night + game_time stay NULL on AWAY per sc-15 convention.
INSERT INTO sc_homestand_schedule
  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk, is_doubleheader)
VALUES
  ('CIN - KY', '2026-04-07', 'Tuesday', 'AWAY', 'IND', NULL, 816599, false),
  ('CIN - KY', '2026-04-08', 'Wednesday', 'AWAY', 'IND', NULL, 816600, false),
  ('CIN - KY', '2026-04-09', 'Thursday', 'AWAY', 'IND', NULL, 816594, false),
  ('CIN - KY', '2026-04-10', 'Friday', 'AWAY', 'IND', NULL, 816590, false),
  ('CIN - KY', '2026-04-11', 'Saturday', 'AWAY', 'IND', NULL, 816593, false),
  ('CIN - KY', '2026-04-12', 'Sunday', 'AWAY', 'IND', NULL, 816591, false),
  ('CIN - KY', '2026-04-21', 'Tuesday', 'AWAY', 'IOW', NULL, 816515, false),
  ('CIN - KY', '2026-04-22', 'Wednesday', 'AWAY', 'IOW', NULL, 816519, false),
  ('CIN - KY', '2026-04-23', 'Thursday', 'AWAY', 'IOW', NULL, 816512, false),
  ('CIN - KY', '2026-04-24', 'Friday', 'AWAY', 'IOW', NULL, 816517, false),
  ('CIN - KY', '2026-04-25', 'Saturday', 'AWAY', 'IOW', NULL, 816513, false),
  ('CIN - KY', '2026-04-26', 'Sunday', 'AWAY', 'IOW', NULL, 816514, false),
  ('CIN - KY', '2026-04-28', 'Tuesday', 'AWAY', 'OMA', NULL, 815991, false),
  ('CIN - KY', '2026-04-29', 'Wednesday', 'AWAY', 'OMA', NULL, 815992, false),
  ('CIN - KY', '2026-04-30', 'Thursday', 'AWAY', 'OMA', NULL, 815982, false),
  ('CIN - KY', '2026-05-01', 'Friday', 'AWAY', 'OMA', NULL, 815983, false),
  ('CIN - KY', '2026-05-02', 'Saturday', 'AWAY', 'OMA', NULL, 815985, false),
  ('CIN - KY', '2026-05-03', 'Sunday', 'AWAY', 'OMA', NULL, 815984, false),
  ('CIN - KY', '2026-05-19', 'Tuesday', 'AWAY', 'COL', NULL, 816810, false),
  ('CIN - KY', '2026-05-20', 'Wednesday', 'AWAY', 'COL', NULL, 816813, false),
  ('CIN - KY', '2026-05-21', 'Thursday', 'AWAY', 'COL', NULL, 816800, false),
  ('CIN - KY', '2026-05-22', 'Friday', 'AWAY', 'COL', NULL, 816802, false),
  ('CIN - KY', '2026-05-23', 'Saturday', 'AWAY', 'COL', NULL, 816805, true),
  ('CIN - KY', '2026-05-24', 'Sunday', 'AWAY', 'COL', NULL, 816806, false),
  ('CIN - KY', '2026-06-02', 'Tuesday', 'AWAY', 'MEM', NULL, 816206, false),
  ('CIN - KY', '2026-06-03', 'Wednesday', 'AWAY', 'MEM', NULL, 816200, false),
  ('CIN - KY', '2026-06-04', 'Thursday', 'AWAY', 'MEM', NULL, 816201, false),
  ('CIN - KY', '2026-06-05', 'Friday', 'AWAY', 'MEM', NULL, 816198, false),
  ('CIN - KY', '2026-06-06', 'Saturday', 'AWAY', 'MEM', NULL, 816196, false),
  ('CIN - KY', '2026-06-07', 'Sunday', 'AWAY', 'MEM', NULL, 816192, false),
  ('CIN - KY', '2026-06-16', 'Tuesday', 'AWAY', 'GWN', NULL, 816638, false),
  ('CIN - KY', '2026-06-17', 'Wednesday', 'AWAY', 'GWN', NULL, 816637, false),
  ('CIN - KY', '2026-06-18', 'Thursday', 'AWAY', 'GWN', NULL, 816643, false),
  ('CIN - KY', '2026-06-19', 'Friday', 'AWAY', 'GWN', NULL, 816644, true),
  ('CIN - KY', '2026-06-20', 'Saturday', 'AWAY', 'GWN', NULL, 816639, false),
  ('CIN - KY', '2026-06-21', 'Sunday', 'AWAY', 'GWN', NULL, 816642, false),
  ('CIN - KY', '2026-06-30', 'Tuesday', 'AWAY', 'COL', NULL, 816790, false),
  ('CIN - KY', '2026-07-01', 'Wednesday', 'AWAY', 'COL', NULL, 816785, false),
  ('CIN - KY', '2026-07-02', 'Thursday', 'AWAY', 'COL', NULL, 816786, false),
  ('CIN - KY', '2026-07-03', 'Friday', 'AWAY', 'COL', NULL, 816788, false),
  ('CIN - KY', '2026-07-04', 'Saturday', 'AWAY', 'COL', NULL, 816789, false),
  ('CIN - KY', '2026-07-05', 'Sunday', 'AWAY', 'COL', NULL, 816787, false),
  ('CIN - KY', '2026-07-17', 'Friday', 'AWAY', 'STP', NULL, 815730, false),
  ('CIN - KY', '2026-07-18', 'Saturday', 'AWAY', 'STP', NULL, 815727, true),
  ('CIN - KY', '2026-07-19', 'Sunday', 'AWAY', 'STP', NULL, 815725, false),
  ('CIN - KY', '2026-07-21', 'Tuesday', 'AWAY', 'TOL', NULL, 815579, false),
  ('CIN - KY', '2026-07-22', 'Wednesday', 'AWAY', 'TOL', NULL, 815584, false),
  ('CIN - KY', '2026-07-23', 'Thursday', 'AWAY', 'TOL', NULL, 815585, false),
  ('CIN - KY', '2026-07-24', 'Friday', 'AWAY', 'TOL', NULL, 815578, false),
  ('CIN - KY', '2026-07-25', 'Saturday', 'AWAY', 'TOL', NULL, 815577, false),
  ('CIN - KY', '2026-07-26', 'Sunday', 'AWAY', 'TOL', NULL, 815572, false),
  ('CIN - KY', '2026-08-04', 'Tuesday', 'AWAY', 'STP', NULL, 815719, false),
  ('CIN - KY', '2026-08-05', 'Wednesday', 'AWAY', 'STP', NULL, 815718, false),
  ('CIN - KY', '2026-08-06', 'Thursday', 'AWAY', 'STP', NULL, 815714, false),
  ('CIN - KY', '2026-08-07', 'Friday', 'AWAY', 'STP', NULL, 815716, false),
  ('CIN - KY', '2026-08-08', 'Saturday', 'AWAY', 'STP', NULL, 815717, false),
  ('CIN - KY', '2026-08-09', 'Sunday', 'AWAY', 'STP', NULL, 815715, false),
  ('CIN - KY', '2026-08-18', 'Tuesday', 'AWAY', 'IND', NULL, 816541, false),
  ('CIN - KY', '2026-08-19', 'Wednesday', 'AWAY', 'IND', NULL, 816538, false),
  ('CIN - KY', '2026-08-20', 'Thursday', 'AWAY', 'IND', NULL, 816540, false),
  ('CIN - KY', '2026-08-21', 'Friday', 'AWAY', 'IND', NULL, 816543, false),
  ('CIN - KY', '2026-08-22', 'Saturday', 'AWAY', 'IND', NULL, 816537, false),
  ('CIN - KY', '2026-08-23', 'Sunday', 'AWAY', 'IND', NULL, 816539, false),
  ('CIN - KY', '2026-09-01', 'Tuesday', 'AWAY', 'NAS', NULL, 816085, false),
  ('CIN - KY', '2026-09-02', 'Wednesday', 'AWAY', 'NAS', NULL, 816090, false),
  ('CIN - KY', '2026-09-03', 'Thursday', 'AWAY', 'NAS', NULL, 816083, false),
  ('CIN - KY', '2026-09-04', 'Friday', 'AWAY', 'NAS', NULL, 816088, false),
  ('CIN - KY', '2026-09-05', 'Saturday', 'AWAY', 'NAS', NULL, 816087, false),
  ('CIN - KY', '2026-09-06', 'Sunday', 'AWAY', 'NAS', NULL, 816084, false),
  ('CIN - KY', '2026-09-15', 'Tuesday', 'AWAY', 'TOL', NULL, 815552, false),
  ('CIN - KY', '2026-09-16', 'Wednesday', 'AWAY', 'TOL', NULL, 815550, false),
  ('CIN - KY', '2026-09-17', 'Thursday', 'AWAY', 'TOL', NULL, 815557, false),
  ('CIN - KY', '2026-09-18', 'Friday', 'AWAY', 'TOL', NULL, 815553, false),
  ('CIN - KY', '2026-09-19', 'Saturday', 'AWAY', 'TOL', NULL, 815551, false),
  ('CIN - KY', '2026-09-20', 'Sunday', 'AWAY', 'TOL', NULL, 815554, false),
  ('TBJ - NY', '2026-03-31', 'Tuesday', 'AWAY', 'OMA', NULL, 815999, false),
  ('TBJ - NY', '2026-04-01', 'Wednesday', 'AWAY', 'OMA', NULL, 815995, false),
  ('TBJ - NY', '2026-04-02', 'Thursday', 'AWAY', 'OMA', NULL, 816000, false),
  ('TBJ - NY', '2026-04-03', 'Friday', 'AWAY', 'OMA', NULL, 815998, false),
  ('TBJ - NY', '2026-04-04', 'Saturday', 'AWAY', 'OMA', NULL, 815996, true),
  ('TBJ - NY', '2026-04-05', 'Sunday', 'AWAY', 'OMA', NULL, 816001, false),
  ('TBJ - NY', '2026-04-14', 'Tuesday', 'AWAY', 'ROC', NULL, 815924, false),
  ('TBJ - NY', '2026-04-15', 'Wednesday', 'AWAY', 'ROC', NULL, 815919, false),
  ('TBJ - NY', '2026-04-16', 'Thursday', 'AWAY', 'ROC', NULL, 815912, false),
  ('TBJ - NY', '2026-04-17', 'Friday', 'AWAY', 'ROC', NULL, 815917, true),
  ('TBJ - NY', '2026-04-18', 'Saturday', 'AWAY', 'ROC', NULL, 815915, false),
  ('TBJ - NY', '2026-04-19', 'Sunday', 'AWAY', 'ROC', NULL, 815914, false),
  ('TBJ - NY', '2026-04-28', 'Tuesday', 'AWAY', 'SWB', NULL, 815836, false),
  ('TBJ - NY', '2026-04-29', 'Wednesday', 'AWAY', 'SWB', NULL, 815840, false),
  ('TBJ - NY', '2026-04-30', 'Thursday', 'AWAY', 'SWB', NULL, 815839, false),
  ('TBJ - NY', '2026-05-01', 'Friday', 'AWAY', 'SWB', NULL, 815841, true),
  ('TBJ - NY', '2026-05-02', 'Saturday', 'AWAY', 'SWB', NULL, 815838, false),
  ('TBJ - NY', '2026-05-03', 'Sunday', 'AWAY', 'SWB', NULL, 815837, false),
  ('TBJ - NY', '2026-05-05', 'Tuesday', 'AWAY', 'LHV', NULL, 816360, false),
  ('TBJ - NY', '2026-05-06', 'Wednesday', 'AWAY', 'LHV', NULL, 816361, false),
  ('TBJ - NY', '2026-05-07', 'Thursday', 'AWAY', 'LHV', NULL, 816359, false),
  ('TBJ - NY', '2026-05-08', 'Friday', 'AWAY', 'LHV', NULL, 816358, false),
  ('TBJ - NY', '2026-05-09', 'Saturday', 'AWAY', 'LHV', NULL, 816355, false),
  ('TBJ - NY', '2026-05-10', 'Sunday', 'AWAY', 'LHV', NULL, 816357, false),
  ('TBJ - NY', '2026-05-19', 'Tuesday', 'AWAY', 'SYR', NULL, 815682, false),
  ('TBJ - NY', '2026-05-20', 'Wednesday', 'AWAY', 'SYR', NULL, 815676, false),
  ('TBJ - NY', '2026-05-21', 'Thursday', 'AWAY', 'SYR', NULL, 815672, false),
  ('TBJ - NY', '2026-05-22', 'Friday', 'AWAY', 'SYR', NULL, 815668, false),
  ('TBJ - NY', '2026-05-23', 'Saturday', 'AWAY', 'SYR', NULL, 815675, false),
  ('TBJ - NY', '2026-05-24', 'Sunday', 'AWAY', 'SYR', NULL, 815674, true),
  ('TBJ - NY', '2026-06-02', 'Tuesday', 'AWAY', 'WOR', NULL, 815523, false),
  ('TBJ - NY', '2026-06-03', 'Wednesday', 'AWAY', 'WOR', NULL, 815525, false),
  ('TBJ - NY', '2026-06-04', 'Thursday', 'AWAY', 'WOR', NULL, 815527, false),
  ('TBJ - NY', '2026-06-05', 'Friday', 'AWAY', 'WOR', NULL, 815526, false),
  ('TBJ - NY', '2026-06-06', 'Saturday', 'AWAY', 'WOR', NULL, 815522, false),
  ('TBJ - NY', '2026-06-07', 'Sunday', 'AWAY', 'WOR', NULL, 815514, false),
  ('TBJ - NY', '2026-06-23', 'Tuesday', 'AWAY', 'IOW', NULL, 816489, false),
  ('TBJ - NY', '2026-06-24', 'Wednesday', 'AWAY', 'IOW', NULL, 816485, false),
  ('TBJ - NY', '2026-06-25', 'Thursday', 'AWAY', 'IOW', NULL, 816487, false),
  ('TBJ - NY', '2026-06-26', 'Friday', 'AWAY', 'IOW', NULL, 816482, false),
  ('TBJ - NY', '2026-06-27', 'Saturday', 'AWAY', 'IOW', NULL, 816481, false),
  ('TBJ - NY', '2026-06-28', 'Sunday', 'AWAY', 'IOW', NULL, 816484, false),
  ('TBJ - NY', '2026-06-30', 'Tuesday', 'AWAY', 'STP', NULL, 815736, false),
  ('TBJ - NY', '2026-07-01', 'Wednesday', 'AWAY', 'STP', NULL, 815732, false),
  ('TBJ - NY', '2026-07-02', 'Thursday', 'AWAY', 'STP', NULL, 815735, false),
  ('TBJ - NY', '2026-07-03', 'Friday', 'AWAY', 'STP', NULL, 815734, false),
  ('TBJ - NY', '2026-07-04', 'Saturday', 'AWAY', 'STP', NULL, 815728, false),
  ('TBJ - NY', '2026-07-05', 'Sunday', 'AWAY', 'STP', NULL, 815726, false),
  ('TBJ - NY', '2026-07-17', 'Friday', 'AWAY', 'SYR', NULL, 815656, false),
  ('TBJ - NY', '2026-07-18', 'Saturday', 'AWAY', 'SYR', NULL, 815650, false),
  ('TBJ - NY', '2026-07-19', 'Sunday', 'AWAY', 'SYR', NULL, 815652, false),
  ('TBJ - NY', '2026-07-28', 'Tuesday', 'AWAY', 'LHV', NULL, 816324, false),
  ('TBJ - NY', '2026-07-29', 'Wednesday', 'AWAY', 'LHV', NULL, 816322, false),
  ('TBJ - NY', '2026-07-30', 'Thursday', 'AWAY', 'LHV', NULL, 816323, false),
  ('TBJ - NY', '2026-07-31', 'Friday', 'AWAY', 'LHV', NULL, 816328, false),
  ('TBJ - NY', '2026-08-01', 'Saturday', 'AWAY', 'LHV', NULL, 816314, false),
  ('TBJ - NY', '2026-08-02', 'Sunday', 'AWAY', 'LHV', NULL, 816321, false),
  ('TBJ - NY', '2026-08-11', 'Tuesday', 'AWAY', 'WOR', NULL, 815493, false),
  ('TBJ - NY', '2026-08-12', 'Wednesday', 'AWAY', 'WOR', NULL, 815497, false),
  ('TBJ - NY', '2026-08-13', 'Thursday', 'AWAY', 'WOR', NULL, 815495, false),
  ('TBJ - NY', '2026-08-14', 'Friday', 'AWAY', 'WOR', NULL, 815491, false),
  ('TBJ - NY', '2026-08-15', 'Saturday', 'AWAY', 'WOR', NULL, 815486, false),
  ('TBJ - NY', '2026-08-16', 'Sunday', 'AWAY', 'WOR', NULL, 815490, false),
  ('TBJ - NY', '2026-08-25', 'Tuesday', 'AWAY', 'ROC', NULL, 815862, false),
  ('TBJ - NY', '2026-08-26', 'Wednesday', 'AWAY', 'ROC', NULL, 815863, false),
  ('TBJ - NY', '2026-08-27', 'Thursday', 'AWAY', 'ROC', NULL, 815857, false),
  ('TBJ - NY', '2026-08-28', 'Friday', 'AWAY', 'ROC', NULL, 815859, false),
  ('TBJ - NY', '2026-08-29', 'Saturday', 'AWAY', 'ROC', NULL, 815860, false),
  ('TBJ - NY', '2026-08-30', 'Sunday', 'AWAY', 'ROC', NULL, 815858, false),
  ('TBJ - NY', '2026-09-08', 'Tuesday', 'AWAY', 'CLT', NULL, 816834, false),
  ('TBJ - NY', '2026-09-09', 'Wednesday', 'AWAY', 'CLT', NULL, 816833, false),
  ('TBJ - NY', '2026-09-10', 'Thursday', 'AWAY', 'CLT', NULL, 816823, false),
  ('TBJ - NY', '2026-09-11', 'Friday', 'AWAY', 'CLT', NULL, 816828, false),
  ('TBJ - NY', '2026-09-12', 'Saturday', 'AWAY', 'CLT', NULL, 816825, true)
ON CONFLICT (account_key, service_date) DO UPDATE
  SET day_type        = EXCLUDED.day_type,
      opponent        = EXCLUDED.opponent,
      game_pk         = EXCLUDED.game_pk,
      day_of_week     = EXCLUDED.day_of_week,
      is_doubleheader = EXCLUDED.is_doubleheader
  WHERE sc_homestand_schedule.day_type = 'AWAY';
-- Same ON CONFLICT posture as HOME - only touches AWAY rows on re-run.


-- ─── 6. COMMENT ON COLUMNs ─────────────────────────────────────────
COMMENT ON COLUMN accounts.has_homestand_schedule IS
  'True when this account has structured schedule rows in '
  'sc_homestand_schedule (HOME + AWAY, opponent + game_pk + game_time '
  '+ day_night). Data-driven gate replacing the billing_model = '
  '''flat_fee'' proxy for schedule presence. Set TRUE for the 4 MLB '
  'fee accounts (CIN-OH, STL-MO, TXR-TX-H/V) and the 2 AAA clubs on '
  'MLB Stats API sportId=11 parity (CIN-KY Louisville Bats, TBJ-NY '
  'Buffalo Bisons). STL-FL is flat_fee but flag=false (no schedule '
  'rows exist). Adding another schedule-having account = flip this '
  'flag + load schedule; no code change required.';

COMMENT ON COLUMN sc_homestand_schedule.is_doubleheader IS
  'True when the (account, date) originally scheduled two games. '
  'Compressed to one row per Kevin''s ruling 2: first game''s '
  'game_time + day_night retained, second game''s context dropped. '
  'Populated on both HOME (day_type=GAME) and AWAY (day_type=AWAY) '
  'rows. Default false. Renderer may show a compact affix (e.g. "DH") '
  'on the opponent chip.';


COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- POST-APPLY PROBES (commented; uncomment individually to run)
-- ═══════════════════════════════════════════════════════════════════
--
-- Probe A: accounts flag distribution
--
-- SELECT team_key, name, billing_model, has_homestand_schedule
--   FROM accounts
--  WHERE has_homestand_schedule = true
--  ORDER BY team_key;
--
-- Expected: 6 rows.
--   CIN - KY      Louisville Bats            actuals_drive_invoice  true
--   CIN - OH      Cincinnati Reds            flat_fee               true
--   STL - MO      St. Louis Cardinals        flat_fee               true
--   TBJ - NY      Buffalo Bisons             actuals_drive_invoice  true
--   TXR - TX - H  Texas Rangers (home)       flat_fee               true
--   TXR - TX - V  Texas Rangers (visitor)    flat_fee               true
-- Any other row here means the UPDATE hit a team_key that didn't exist
-- or matched more than intended - re-review the UPDATE list.
--
--
-- Probe B: per-account HOME + AWAY counts (Louisville + Buffalo)
--
-- SELECT account_key, day_type, COUNT(*) AS rows
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - KY', 'TBJ - NY')
--  GROUP BY account_key, day_type
--  ORDER BY account_key, day_type;
--
-- Expected:
--   CIN - KY  AWAY  75
--   CIN - KY  GAME  74
--   TBJ - NY  AWAY  74
--   TBJ - NY  GAME  75
-- Anything else means either the INSERT didn't complete or a re-run
-- landed on an unexpected day_type.
--
--
-- Probe C: day_night coverage on HOME (GAME) rows
--
-- SELECT account_key,
--        COUNT(*) FILTER (WHERE day_type = 'GAME') AS home_rows,
--        COUNT(*) FILTER (WHERE day_type = 'GAME' AND game_time IS NOT NULL) AS with_game_time,
--        COUNT(*) FILTER (WHERE day_type = 'GAME' AND day_night IS NOT NULL) AS with_day_night
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - KY', 'TBJ - NY')
--  GROUP BY account_key
--  ORDER BY account_key;
--
-- Expected: home_rows = with_game_time = with_day_night.
--   CIN - KY  74  74  74
--   TBJ - NY  75  75  75
-- Any GAME row missing game_time or day_night flags an API schema
-- shift; investigate before proceeding to Task 4.
--
--
-- Probe D: day/night distribution per account (HOME)
--
-- SELECT account_key, day_night, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - KY', 'TBJ - NY')
--    AND day_type = 'GAME'
--  GROUP BY account_key, day_night
--  ORDER BY account_key, day_night;
--
-- Expected (from the extractor summary):
--   CIN - KY  day    24
--   CIN - KY  night  50
--   TBJ - NY  day    31
--   TBJ - NY  night  44
--
--
-- Probe E: DH-flagged rows
--
-- SELECT account_key, day_type, service_date, opponent
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - KY', 'TBJ - NY')
--    AND is_doubleheader = true
--  ORDER BY account_key, day_type, service_date;
--
-- Expected: 7 rows for CIN - KY (4 GAME + 3 AWAY),
--           9 rows for TBJ - NY (4 GAME + 5 AWAY).
-- Spot-check against the extractor stderr output.
--
--
-- Probe F: zero leak on other accounts
--
-- SELECT account_key, day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key NOT IN ('CIN - KY', 'TBJ - NY')
--  GROUP BY account_key, day_type
--  ORDER BY account_key, day_type;
--
-- Expected: matches the pre-sc-16 baseline (CIN-OH, STL-MO, TXR-TX-H,
-- TXR-TX-V rows unchanged). If any is_doubleheader = true rows appear
-- on the MLB fee accounts unexpectedly, they came from somewhere other
-- than this migration - investigate.
--
--
-- Probe G: is_doubleheader defaults on existing rows
--
-- SELECT is_doubleheader, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH', 'STL - MO', 'TXR - TX - H', 'TXR - TX - V')
--  GROUP BY is_doubleheader;
--
-- Expected: all rows is_doubleheader = false (the DEFAULT applied to
-- pre-existing MLB fee rows; sc-16 only inserts for CIN-KY / TBJ-NY).
--
--
-- Probe H: TBD-time spot-check (2026-07-11 TBJ-NY, DH per extractor)
--
-- SELECT account_key, service_date, day_type, opponent, game_pk,
--        game_time, day_night, is_doubleheader
--   FROM sc_homestand_schedule
--  WHERE account_key = 'TBJ - NY'
--    AND service_date = '2026-07-11';
--
-- Expected: 1 row, opponent = 'SWB', game_pk = 816935, game_time =
-- '2026-07-11T20:30:00+00', day_night = 'night', is_doubleheader = true.
-- If game_time changes on a later extractor re-run (post-firm-up),
-- pasting the updated INSERT block into a fresh migration will UPDATE
-- this row via the ON CONFLICT guard.
