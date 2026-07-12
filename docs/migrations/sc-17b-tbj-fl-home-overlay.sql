-- ═══════════════════════════════════════════════════════════════════
-- sc-17b-tbj-fl-home-overlay.sql
-- Service Calendar - TBJ - FL (Dunedin Blue Jays) home-game overlay
-- ADDITION to the sc-17 series.
--
-- Purpose:
--   Extends the sc-17 schedule-overlay pattern (has_schedule_overlay
--   flag + informational GAME rows) to a SECOND account: TBJ - FL
--   (Toronto Blue Jays PDC, Dunedin FL, sportId=14 teamId=424).
--   Kevin's brief was revised 2026-07-11 to two accounts; the initial
--   sc-17 shipped covering STL - FL only. This is the follow-up that
--   adds TBJ - FL under the same design.
--
-- Prerequisites (from sc-17):
--   - accounts.has_schedule_overlay column exists (added by sc-17).
--   - STL - FL is flagged has_schedule_overlay=true (unchanged here).
--   - loadScheduleOverlay() + the sc-17 reader plumbing exist.
--
-- Kind coverage caveat (Task 2 for TBJ - FL):
--   STL - FL and TBJ - FL render as DIFFERENT kinds today:
--     - STL - FL  billing_model = flat_fee               -> fee-no-dollar
--     - TBJ - FL  billing_model = actuals_drive_invoice  -> per-meal
--   The sc-17 code shipped renderFeeNoDollar overlay support only.
--   TBJ - FL rows will land inertly in the database until the paired
--   PR extends renderPerMeal + the per-meal branch of
--   buildLargeContent to consume the overlay. Applying THIS migration
--   before the paired PR is safe: TBJ - FL account still classifies
--   as per-meal (no has_homestand_schedule flag = no fee-branch
--   classification touch), the loadScheduleOverlay fetch runs and
--   returns data, but the per-meal render just ignores it. No user-
--   visible change until the paired PR lands.
--
-- Data source (locked, 2026-07-11):
--   statsapi.mlb.com /api/v1/schedule?sportId=14&teamId=424&season=2026&gameType=R
--
--   Verified via /api/v1/teams:
--     - Dunedin Blue Jays       id=424  parent="Toronto Blue Jays"
--                               abbreviation="DUN"  venue="TD Ballpark"
--
--   Live pull (see extractor stderr):
--     TBJ - FL: 66 HOME rows (day=13, night=53), 4 DH-flagged,
--               100% dayNight+gameDate coverage, 0 TBD.
--
-- HOME ONLY - HARD RULE
--   Same rule as sc-17 for STL - FL: NO AWAY rows for TBJ - FL. The
--   FSL plays ~66 away games too, but inserting them would either
--   force operationally-wrong "away" tiles on a PDC that serves
--   daily, or force a classifier guard that trades correctness at
--   one axis for complexity at another. Overlay-only. A future pass
--   MUST NOT "complete" this migration by adding AWAY rows.
--
--   Note: PBC (STL - FL) and Dunedin (TBJ - FL) are same-league so
--   they play each other. PMB (Palm Beach's API abbreviation) appears
--   as an opponent code on TBJ - FL's home slate. Expected, no
--   special handling.
--
-- Ordered steps (single BEGIN/COMMIT):
--   1. UPDATE: set has_schedule_overlay=true for TBJ - FL. Does NOT
--      change any other account.
--   2. INSERT: 66 TBJ - FL HOME rows (day_type='GAME') with opponent,
--      game_pk, game_time UTC, day_night, is_doubleheader.
--
-- Apply order:
--   - Requires sc-17 already applied (the column must exist).
--   - Paste + run in Supabase Studio. Idempotent - safe to re-run.
--   - Re-runnable via ON CONFLICT DO UPDATE for a future TBD
--     firm-up (0 TBD in the current pull).
--   - Verify with the probe block at the bottom.
--
-- Row counts emitted by scripts/_extract_milb_schedule.mjs (2026-07-11):
--   TBJ - FL: home=66 (day=13, night=53), away=66 API-side but NOT
--             inserted (homeOnly=true), dh_flagged=4.
--
-- References:
--   - Investigation:      docs/audits/SC_17_INVESTIGATION_2026-07-11.md
--   - Extractor:          scripts/_extract_milb_schedule.mjs
--   - sc-17 initial:      docs/migrations/sc-17-stl-fl-home-overlay.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Set has_schedule_overlay TRUE for TBJ - FL ─────────────────
-- Blue Jays PDC in Dunedin, FL. billing_model = actuals_drive_invoice
-- (per-meal). Serves daily. See file header for why has_homestand_schedule
-- stays FALSE.
UPDATE accounts
   SET has_schedule_overlay = true
 WHERE team_key = 'TBJ - FL';


-- ─── 2. INSERT TBJ - FL HOME rows (day_type='GAME') ────────────────
-- Same shape as sc-17's STL - FL inserts. ON CONFLICT DO UPDATE
-- limited to day_type='GAME' rows so a future TBD refresh doesn't
-- touch any other row shape. NO AWAY ROWS. See file header hard rule.
INSERT INTO sc_homestand_schedule
  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk, game_time, day_night, is_doubleheader)
VALUES
  ('TBJ - FL', '2026-04-02', 'Thursday', 'GAME', 'BRD', NULL, 820698, '2026-04-02T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-03', 'Friday', 'GAME', 'BRD', NULL, 820692, '2026-04-03T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-04', 'Saturday', 'GAME', 'BRD', NULL, 820696, '2026-04-04T20:00:00Z', 'day', true),
  ('TBJ - FL', '2026-04-14', 'Tuesday', 'GAME', 'CLR', NULL, 820697, '2026-04-14T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-15', 'Wednesday', 'GAME', 'CLR', NULL, 820693, '2026-04-15T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-16', 'Thursday', 'GAME', 'CLR', NULL, 820691, '2026-04-16T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-17', 'Friday', 'GAME', 'CLR', NULL, 820685, '2026-04-17T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-18', 'Saturday', 'GAME', 'CLR', NULL, 820690, '2026-04-18T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-19', 'Sunday', 'GAME', 'CLR', NULL, 820688, '2026-04-19T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-04-28', 'Tuesday', 'GAME', 'JUP', NULL, 820687, '2026-04-28T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-04-29', 'Wednesday', 'GAME', 'JUP', NULL, 820684, '2026-04-29T22:05:00Z', 'night', false),
  ('TBJ - FL', '2026-04-30', 'Thursday', 'GAME', 'JUP', NULL, 820686, '2026-04-30T15:00:00Z', 'day', false),
  ('TBJ - FL', '2026-05-01', 'Friday', 'GAME', 'JUP', NULL, 820689, '2026-05-01T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-02', 'Saturday', 'GAME', 'JUP', NULL, 820681, '2026-05-02T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-03', 'Sunday', 'GAME', 'JUP', NULL, 820680, '2026-05-03T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-05-05', 'Tuesday', 'GAME', 'BRD', NULL, 820679, '2026-05-05T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-06', 'Wednesday', 'GAME', 'BRD', NULL, 820682, '2026-05-06T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-07', 'Thursday', 'GAME', 'BRD', NULL, 820677, '2026-05-07T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-08', 'Friday', 'GAME', 'BRD', NULL, 820678, '2026-05-08T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-09', 'Saturday', 'GAME', 'BRD', NULL, 820683, '2026-05-09T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-10', 'Sunday', 'GAME', 'BRD', NULL, 820675, '2026-05-10T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-05-19', 'Tuesday', 'GAME', 'FTM', NULL, 820676, '2026-05-19T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-20', 'Wednesday', 'GAME', 'FTM', NULL, 820672, '2026-05-20T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-21', 'Thursday', 'GAME', 'FTM', NULL, 820673, '2026-05-21T20:30:00Z', 'night', true),
  ('TBJ - FL', '2026-05-22', 'Friday', 'GAME', 'FTM', NULL, 820674, '2026-05-22T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-23', 'Saturday', 'GAME', 'FTM', NULL, 820671, '2026-05-23T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-05-24', 'Sunday', 'GAME', 'FTM', NULL, 820667, '2026-05-24T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-06-02', 'Tuesday', 'GAME', 'DBT', NULL, 820665, '2026-06-02T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-03', 'Wednesday', 'GAME', 'DBT', NULL, 820669, '2026-06-03T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-04', 'Thursday', 'GAME', 'DBT', NULL, 820666, '2026-06-04T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-05', 'Friday', 'GAME', 'DBT', NULL, 820670, '2026-06-05T23:15:00Z', 'night', false),
  ('TBJ - FL', '2026-06-06', 'Saturday', 'GAME', 'DBT', NULL, 820664, '2026-06-06T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-07', 'Sunday', 'GAME', 'DBT', NULL, 820668, '2026-06-07T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-06-23', 'Tuesday', 'GAME', 'TAM', NULL, 820656, '2026-06-23T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-24', 'Wednesday', 'GAME', 'TAM', NULL, 820658, '2026-06-24T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-25', 'Thursday', 'GAME', 'TAM', NULL, 820659, '2026-06-25T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-26', 'Friday', 'GAME', 'TAM', NULL, 820660, '2026-06-26T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-27', 'Saturday', 'GAME', 'TAM', NULL, 820663, '2026-06-27T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-06-28', 'Sunday', 'GAME', 'TAM', NULL, 820657, '2026-06-28T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-07-07', 'Tuesday', 'GAME', 'LAK', NULL, 820661, '2026-07-07T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-08', 'Wednesday', 'GAME', 'LAK', NULL, 820662, '2026-07-08T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-09', 'Thursday', 'GAME', 'LAK', NULL, 820652, '2026-07-09T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-10', 'Friday', 'GAME', 'LAK', NULL, 820655, '2026-07-10T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-11', 'Saturday', 'GAME', 'LAK', NULL, 820651, '2026-07-11T22:53:00Z', 'night', false),
  ('TBJ - FL', '2026-07-12', 'Sunday', 'GAME', 'LAK', NULL, 820649, '2026-07-12T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-07-17', 'Friday', 'GAME', 'CLR', NULL, 820650, '2026-07-17T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-18', 'Saturday', 'GAME', 'CLR', NULL, 820653, '2026-07-18T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-19', 'Sunday', 'GAME', 'CLR', NULL, 820654, '2026-07-19T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-07-28', 'Tuesday', 'GAME', 'SLU', NULL, 820642, '2026-07-28T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-29', 'Wednesday', 'GAME', 'SLU', NULL, 820648, '2026-07-29T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-30', 'Thursday', 'GAME', 'SLU', NULL, 820647, '2026-07-30T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-07-31', 'Friday', 'GAME', 'SLU', NULL, 820643, '2026-07-31T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-01', 'Saturday', 'GAME', 'SLU', NULL, 820644, '2026-08-01T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-02', 'Sunday', 'GAME', 'SLU', NULL, 820646, '2026-08-02T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-08-11', 'Tuesday', 'GAME', 'TAM', NULL, 820645, '2026-08-11T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-12', 'Wednesday', 'GAME', 'TAM', NULL, 820636, '2026-08-12T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-13', 'Thursday', 'GAME', 'TAM', NULL, 820641, '2026-08-13T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-14', 'Friday', 'GAME', 'TAM', NULL, 820639, '2026-08-14T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-15', 'Saturday', 'GAME', 'TAM', NULL, 820635, '2026-08-15T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-16', 'Sunday', 'GAME', 'TAM', NULL, 820637, '2026-08-16T16:00:00Z', 'day', false),
  ('TBJ - FL', '2026-08-25', 'Tuesday', 'GAME', 'PMB', NULL, 820640, '2026-08-25T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-26', 'Wednesday', 'GAME', 'PMB', NULL, 820638, '2026-08-26T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-27', 'Thursday', 'GAME', 'PMB', NULL, 820634, '2026-08-27T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-28', 'Friday', 'GAME', 'PMB', NULL, 820627, '2026-08-28T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-29', 'Saturday', 'GAME', 'PMB', NULL, 820628, '2026-08-29T22:30:00Z', 'night', false),
  ('TBJ - FL', '2026-08-30', 'Sunday', 'GAME', 'PMB', NULL, 820629, '2026-08-30T16:00:00Z', 'day', false)
ON CONFLICT (account_key, service_date) DO UPDATE
  SET day_type        = EXCLUDED.day_type,
      opponent        = EXCLUDED.opponent,
      game_pk         = EXCLUDED.game_pk,
      game_time       = EXCLUDED.game_time,
      day_night       = EXCLUDED.day_night,
      day_of_week     = EXCLUDED.day_of_week,
      is_doubleheader = EXCLUDED.is_doubleheader
  WHERE sc_homestand_schedule.day_type = 'GAME';


COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- POST-APPLY PROBES (commented; uncomment individually to run)
-- ═══════════════════════════════════════════════════════════════════
--
-- Probe A: overlay flag now includes TBJ - FL
--
-- SELECT team_key, name, billing_model,
--        has_homestand_schedule, has_schedule_overlay
--   FROM accounts
--  WHERE has_schedule_overlay = true
--  ORDER BY team_key;
--
-- Expected: 2 rows.
--   STL - FL      Cardinals Palm Beach       flat_fee               false  true
--   TBJ - FL      Blue Jays Dunedin          actuals_drive_invoice  false  true
--
-- Both rows MUST have has_homestand_schedule=false. If TBJ - FL has
-- has_homestand_schedule=true, sc-17b fired on an account that
-- somehow already had the sc-16 flag - investigate immediately.
--
--
-- Probe B: TBJ - FL HOME row count
--
-- SELECT day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key = 'TBJ - FL'
--  GROUP BY day_type
--  ORDER BY day_type;
--
-- Expected: exactly one row.
--   GAME  66
-- If AWAY appears, the file's hard rule was violated. Revert.
--
--
-- Probe C: TBJ - FL day_night + game_time coverage
--
-- SELECT COUNT(*) AS home_rows,
--        COUNT(*) FILTER (WHERE game_time IS NOT NULL) AS with_game_time,
--        COUNT(*) FILTER (WHERE day_night IS NOT NULL) AS with_day_night
--   FROM sc_homestand_schedule
--  WHERE account_key = 'TBJ - FL'
--    AND day_type = 'GAME';
--
-- Expected: 66, 66, 66.
--
--
-- Probe D: TBJ - FL day/night distribution
--
-- SELECT day_night, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key = 'TBJ - FL'
--    AND day_type = 'GAME'
--  GROUP BY day_night
--  ORDER BY day_night;
--
-- Expected: day=13, night=53.
--
--
-- Probe E: TBJ - FL DH-flagged
--
-- SELECT service_date, opponent
--   FROM sc_homestand_schedule
--  WHERE account_key = 'TBJ - FL'
--    AND is_doubleheader = true
--  ORDER BY service_date;
--
-- Expected: 4 rows.
--
--
-- Probe F: STL - FL row count UNCHANGED
--
-- SELECT day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key = 'STL - FL'
--  GROUP BY day_type;
--
-- Expected: GAME 66 (matches sc-17's Probe B). If this changed, this
-- migration touched STL - FL - revert.
--
--
-- Probe G: sc-16 accounts UNCHANGED
--
-- SELECT account_key, day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V',
--                        'CIN - KY','TBJ - NY')
--  GROUP BY account_key, day_type
--  ORDER BY account_key, day_type;
--
-- Expected: matches the sc-16 post-apply snapshot exactly.
--
--
-- Probe H: PMB appears on TBJ - FL's slate (in-league opponent)
--
-- SELECT service_date, opponent, day_night, is_doubleheader
--   FROM sc_homestand_schedule
--  WHERE account_key = 'TBJ - FL'
--    AND opponent = 'PMB'
--    AND day_type = 'GAME'
--  ORDER BY service_date;
--
-- Expected: some number of dates where Palm Beach (PMB) visits
-- Dunedin. This is a curiosity spot-check that the same-league
-- relationship surfaces on Dunedin's home slate. Not a failure gate.
