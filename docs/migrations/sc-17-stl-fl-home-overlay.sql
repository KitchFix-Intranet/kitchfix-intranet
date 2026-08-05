-- ═══════════════════════════════════════════════════════════════════
-- sc-17-stl-fl-home-overlay.sql
-- Service Calendar - STL - FL (Palm Beach Cardinals) home-game overlay.
--
-- Purpose:
--   Add a NEW flag `accounts.has_schedule_overlay BOOLEAN` for accounts
--   that want schedule rows shown as an INFORMATIONAL DISPLAY overlay
--   on the drill-in tile, WITHOUT touching classification, kind
--   resolution, or actionable-day counter math. Set the flag TRUE for
--   STL - FL and insert 66 HOME game rows from the MLB Stats API
--   (sportId=14, Palm Beach Cardinals teamId=279).
--
--   The `has_homestand_schedule` flag introduced by sc-16 stays FALSE
--   for STL - FL - flipping it would break the account in three
--   documented ways (see docs/audits/SC_17_INVESTIGATION_2026-07-11.md):
--     1. resolveDayKind (dayResolvers.js:100) would return "mlb-fee"
--        instead of "fee-no-dollar" - loses the no-$ discipline.
--     2. classifyDayStatus (dataStore serviceCalendar.js:210) would
--        route rowless dates to "off-season" - catastrophic for a
--        DAILY-serving PDC.
--     3. Post-#409 actionable-day counters would collapse the
--        denominator when off-season days drop out of BOTH sides.
--
--   `has_schedule_overlay` is orthogonal - it feeds a separate
--   render path that ADDITIVELY prepends the opponent chip and the
--   day/night pill on lg drill-in tiles when the account is flagged
--   AND the date has a GAME row. No status change, no kind change,
--   no counter change.
--
-- Data source (locked, 2026-07-11):
--   statsapi.mlb.com /api/v1/schedule?sportId=14&teamId=279&season=2026&gameType=R
--   Palm Beach Cardinals (parent org = St. Louis Cardinals, verified
--   via /api/v1/teams). Home games only. dayNight + gameDate 100%
--   populated per the read-only investigation (see the audit doc for
--   full stats: 66 unique home dates, 14 day / 53 night, 3 DH-flagged,
--   4 postponement shadows resolved to their original dates).
--
-- HOME ONLY - HARD RULE
--   Kevin's ruling 2026-07-11: NO AWAY rows for STL - FL. The FSL
--   season plays 66 away games too, but inserting them would either
--   force operationally-wrong "away" tiles on a PDC that serves
--   daily, or force a classifier guard that trades correctness at
--   one axis for complexity at another. Overlay-only. A future pass
--   MUST NOT "complete" this migration by adding AWAY rows.
--
-- ─── 2026-08-05 ruling append (do not edit body above) ────────────
--   Owner-confirmed operational fact: Palm Beach shares Roger Dean
--   Stadium with the Jupiter Hammerheads (JUP) and St. Lucie is a
--   short bus ride. On away games against either club the team eats
--   at the PDC. Those are service days.
--
--   sc-28 adds 64 STL - FL AWAY rows to sc_homestand_schedule with
--   `day_type='AWAY'` and a new `opponent_team_id` column, plus a
--   `HOME_DINING_AWAY_OPPONENTS` code map keyed by (account, team_id).
--   loadScheduleOverlay widens by one predicate: an AWAY row surfaces
--   only when the (account, opponent_team_id) pair sits in that map.
--
--   The concern this HARD RULE was written to prevent - away tiles
--   on a daily-service PDC - stays met: the 47 non-JUP-non-SLU away
--   rows in sc-28 are invisible to loadScheduleOverlay because
--   `HOME_DINING_AWAY_OPPONENTS.get('STL - FL')` contains only
--   {479, 507}. The 23 qualifying dates render as `at OPP ·
--   Meals@Home` in the copper family, which is the pill copy the
--   operational fact needs.
--
--   The 2026-07-11 ruling was correct for what was known then. The
--   append records the revisit on new information rather than a
--   silent body edit; the original body reads as it did.
--
-- Ordered steps (single BEGIN/COMMIT):
--   1. ALTER: accounts.has_schedule_overlay BOOLEAN NOT NULL DEFAULT false.
--   2. UPDATE: set the flag TRUE for STL - FL. No other account
--      needs this flag today; adding another later = flip the flag +
--      insert schedule rows, no code change required.
--   3. INSERT: 66 STL - FL HOME rows (day_type='GAME') with
--      opponent, game_pk, game_time UTC, day_night, is_doubleheader.
--      Same shape as sc-16's HOME inserts.
--   4. COMMENT ON COLUMN.
--
-- Apply order:
--   - Paste + run in Supabase Studio (repo convention: migrations
--     don't auto-run on deploy).
--   - Single BEGIN/COMMIT transaction. Idempotent - safe to re-run.
--   - Re-runnable: TBD firm-ups (not expected for STL - FL - 0 TBD
--     games in the 2026 pull - but the ON CONFLICT DO UPDATE keeps
--     the door open for a mid-season refresh).
--   - Verify with the probe block at the bottom (commented; uncomment
--     individually to run).
--
-- Row counts emitted by scripts/_extract_milb_schedule.mjs (2026-07-11):
--   STL - FL: home=66 (day=13, night=53), away=66 API-side but NOT
--             inserted (homeOnly=true), dh_flagged=3.
--
-- What this migration does NOT do:
--   - Live-sync. Load-once for 2026 + optional re-runnable refresh.
--   - Widen the reader / renderer. Task 5 in the paired PR flips
--     STL - FL's fee-no-dollar tile render to conditionally prepend
--     [vs OPP] + [pill] when overlay data has a row for the date.
--   - Insert AWAY / EXHIBITION / PREP rows on STL - FL. Ever.
--   - Change per-meal or fee-account behavior on ANY other account.
--   - Change actionable-day counter math (#409). Overlay data is
--     purely presentational.
--
-- References:
--   - Investigation:      docs/audits/SC_17_INVESTIGATION_2026-07-11.md
--   - Extractor:          scripts/_extract_milb_schedule.mjs
--   - sc-16 (AAA flag):   docs/migrations/sc-16-milb-schedule-parity.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. accounts.has_schedule_overlay column ───────────────────────
-- Boolean, NOT NULL, default false. This flag signals the reader to
-- fetch schedule rows for informational display WITHOUT running the
-- has_homestand_schedule fee-branch classifier. Orthogonal to
-- has_homestand_schedule - an account can have zero, one, or (in
-- theory) both flags on; today only one account uses the overlay
-- (STL - FL) and none use both simultaneously.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS has_schedule_overlay BOOLEAN NOT NULL DEFAULT false;


-- ─── 2. Set flag TRUE for STL - FL ─────────────────────────────────
-- STL - FL: PDC flat-fee daily-service account. Serves every day
-- regardless of what the schedule says. The overlay lets site leaders
-- see WHO the Cardinals play at home ("vs OPP") and WHEN ("day/night
-- pill with venue-local time") on the drill-in tile - purely
-- informational, no operational shift. `has_homestand_schedule` for
-- STL - FL stays FALSE - flipping it would break the account in
-- three ways (see the file header comments + the audit doc).
UPDATE accounts
   SET has_schedule_overlay = true
 WHERE team_key = 'STL - FL';


-- ─── 3. INSERT HOME rows for STL - FL (day_type='GAME') ────────────
-- Same shape as sc-16's HOME inserts: opponent (API abbreviation),
-- game_pk (MLB Stats API stable identifier), game_time (UTC
-- TIMESTAMPTZ), day_night, is_doubleheader (2 DH days plus 1 with
-- the doubleHeader Y/S field set - flag 3 total).
--
-- ON CONFLICT strategy: only touch rows the loader already owns
-- (day_type='GAME'). If a re-pull firms up a TBD or fixes a
-- postponement, the fresh block UPDATEs game_time/day_night/etc.
-- without disturbing any other rows.
--
-- NO AWAY ROWS. Ever. See file header hard rule.
INSERT INTO sc_homestand_schedule
  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk, game_time, day_night, is_doubleheader)
VALUES
  ('STL - FL', '2026-04-02', 'Thursday', 'GAME', 'SLU', NULL, 820436, '2026-04-02T22:30:00Z', 'night', false),
  ('STL - FL', '2026-04-03', 'Friday', 'GAME', 'SLU', NULL, 820437, '2026-04-03T22:30:00Z', 'night', false),
  ('STL - FL', '2026-04-04', 'Saturday', 'GAME', 'SLU', NULL, 820432, '2026-04-04T22:00:00Z', 'night', false),
  ('STL - FL', '2026-04-14', 'Tuesday', 'GAME', 'JUP', NULL, 820423, '2026-04-14T22:30:00Z', 'night', false),
  ('STL - FL', '2026-04-15', 'Wednesday', 'GAME', 'JUP', NULL, 820424, '2026-04-15T22:42:00Z', 'night', false),
  ('STL - FL', '2026-04-16', 'Thursday', 'GAME', 'JUP', NULL, 820425, '2026-04-16T22:30:00Z', 'night', false),
  ('STL - FL', '2026-04-17', 'Friday', 'GAME', 'JUP', NULL, 820429, '2026-04-17T22:30:00Z', 'night', false),
  ('STL - FL', '2026-04-18', 'Saturday', 'GAME', 'JUP', NULL, 820427, '2026-04-18T22:00:00Z', 'night', false),
  ('STL - FL', '2026-04-19', 'Sunday', 'GAME', 'JUP', NULL, 820426, '2026-04-19T16:30:00Z', 'day', false),
  ('STL - FL', '2026-04-28', 'Tuesday', 'GAME', 'CLR', NULL, 820428, '2026-04-28T22:30:00Z', 'night', false),
  ('STL - FL', '2026-04-29', 'Wednesday', 'GAME', 'CLR', NULL, 820420, '2026-04-29T22:30:00Z', 'night', false),
  ('STL - FL', '2026-04-30', 'Thursday', 'GAME', 'CLR', NULL, 820417, '2026-04-30T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-01', 'Friday', 'GAME', 'CLR', NULL, 820422, '2026-05-01T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-02', 'Saturday', 'GAME', 'CLR', NULL, 820418, '2026-05-02T22:00:00Z', 'night', false),
  ('STL - FL', '2026-05-03', 'Sunday', 'GAME', 'CLR', NULL, 820421, '2026-05-03T16:30:00Z', 'day', false),
  ('STL - FL', '2026-05-12', 'Tuesday', 'GAME', 'DBT', NULL, 820419, '2026-05-12T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-13', 'Wednesday', 'GAME', 'DBT', NULL, 820415, '2026-05-13T19:00:00Z', 'day', true),
  ('STL - FL', '2026-05-14', 'Thursday', 'GAME', 'DBT', NULL, 820416, '2026-05-14T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-15', 'Friday', 'GAME', 'DBT', NULL, 820409, '2026-05-15T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-16', 'Saturday', 'GAME', 'DBT', NULL, 820413, '2026-05-16T22:00:00Z', 'night', false),
  ('STL - FL', '2026-05-17', 'Sunday', 'GAME', 'DBT', NULL, 820414, '2026-05-17T16:30:00Z', 'day', false),
  ('STL - FL', '2026-05-26', 'Tuesday', 'GAME', 'LAK', NULL, 820411, '2026-05-26T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-27', 'Wednesday', 'GAME', 'LAK', NULL, 820412, '2026-05-27T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-28', 'Thursday', 'GAME', 'LAK', NULL, 820410, '2026-05-28T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-29', 'Friday', 'GAME', 'LAK', NULL, 820408, '2026-05-29T22:30:00Z', 'night', false),
  ('STL - FL', '2026-05-30', 'Saturday', 'GAME', 'LAK', NULL, 820406, '2026-05-30T22:00:00Z', 'night', false),
  ('STL - FL', '2026-05-31', 'Sunday', 'GAME', 'LAK', NULL, 820401, '2026-05-31T16:30:00Z', 'day', false),
  ('STL - FL', '2026-06-09', 'Tuesday', 'GAME', 'SLU', NULL, 820407, '2026-06-09T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-10', 'Wednesday', 'GAME', 'SLU', NULL, 820404, '2026-06-10T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-11', 'Thursday', 'GAME', 'SLU', NULL, 820402, '2026-06-11T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-12', 'Friday', 'GAME', 'SLU', NULL, 820400, '2026-06-12T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-13', 'Saturday', 'GAME', 'SLU', NULL, 820403, '2026-06-13T22:00:00Z', 'night', false),
  ('STL - FL', '2026-06-14', 'Sunday', 'GAME', 'SLU', NULL, 820405, '2026-06-14T16:30:00Z', 'day', false),
  ('STL - FL', '2026-06-23', 'Tuesday', 'GAME', 'BRD', NULL, 820396, '2026-06-23T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-24', 'Wednesday', 'GAME', 'BRD', NULL, 820398, '2026-06-24T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-25', 'Thursday', 'GAME', 'BRD', NULL, 820399, '2026-06-25T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-26', 'Friday', 'GAME', 'BRD', NULL, 820393, '2026-06-26T22:30:00Z', 'night', false),
  ('STL - FL', '2026-06-27', 'Saturday', 'GAME', 'BRD', NULL, 820395, '2026-06-27T22:00:00Z', 'night', false),
  ('STL - FL', '2026-06-28', 'Sunday', 'GAME', 'BRD', NULL, 820394, '2026-06-28T16:30:00Z', 'day', false),
  ('STL - FL', '2026-07-17', 'Friday', 'GAME', 'SLU', NULL, 820397, '2026-07-17T22:30:00Z', 'night', false),
  ('STL - FL', '2026-07-18', 'Saturday', 'GAME', 'SLU', NULL, 820389, '2026-07-18T22:00:00Z', 'night', false),
  ('STL - FL', '2026-07-19', 'Sunday', 'GAME', 'SLU', NULL, 820386, '2026-07-19T16:30:00Z', 'day', false),
  ('STL - FL', '2026-07-21', 'Tuesday', 'GAME', 'TAM', NULL, 820385, '2026-07-21T22:30:00Z', 'night', false),
  ('STL - FL', '2026-07-22', 'Wednesday', 'GAME', 'TAM', NULL, 820390, '2026-07-22T16:00:00Z', 'day', false),
  ('STL - FL', '2026-07-23', 'Thursday', 'GAME', 'TAM', NULL, 820391, '2026-07-23T22:30:00Z', 'night', false),
  ('STL - FL', '2026-07-24', 'Friday', 'GAME', 'TAM', NULL, 820388, '2026-07-24T22:30:00Z', 'night', false),
  ('STL - FL', '2026-07-25', 'Saturday', 'GAME', 'TAM', NULL, 820387, '2026-07-25T22:00:00Z', 'night', false),
  ('STL - FL', '2026-07-26', 'Sunday', 'GAME', 'TAM', NULL, 820392, '2026-07-26T16:30:00Z', 'day', false),
  ('STL - FL', '2026-08-04', 'Tuesday', 'GAME', 'JUP', NULL, 820378, '2026-08-04T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-05', 'Wednesday', 'GAME', 'JUP', NULL, 820382, '2026-08-05T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-06', 'Thursday', 'GAME', 'JUP', NULL, 820381, '2026-08-06T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-07', 'Friday', 'GAME', 'JUP', NULL, 820383, '2026-08-07T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-08', 'Saturday', 'GAME', 'JUP', NULL, 820379, '2026-08-08T22:00:00Z', 'night', false),
  ('STL - FL', '2026-08-09', 'Sunday', 'GAME', 'JUP', NULL, 820380, '2026-08-09T16:30:00Z', 'day', false),
  ('STL - FL', '2026-08-18', 'Tuesday', 'GAME', 'FTM', NULL, 820384, '2026-08-18T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-19', 'Wednesday', 'GAME', 'FTM', NULL, 820373, '2026-08-19T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-20', 'Thursday', 'GAME', 'FTM', NULL, 820371, '2026-08-20T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-21', 'Friday', 'GAME', 'FTM', NULL, 820372, '2026-08-21T22:30:00Z', 'night', false),
  ('STL - FL', '2026-08-22', 'Saturday', 'GAME', 'FTM', NULL, 820370, '2026-08-22T22:00:00Z', 'night', false),
  ('STL - FL', '2026-08-23', 'Sunday', 'GAME', 'FTM', NULL, 820374, '2026-08-23T16:30:00Z', 'day', false),
  ('STL - FL', '2026-09-01', 'Tuesday', 'GAME', 'DBT', NULL, 820375, '2026-09-01T22:30:00Z', 'night', false),
  ('STL - FL', '2026-09-02', 'Wednesday', 'GAME', 'DBT', NULL, 820376, '2026-09-02T22:30:00Z', 'night', false),
  ('STL - FL', '2026-09-03', 'Thursday', 'GAME', 'DBT', NULL, 820377, '2026-09-03T22:30:00Z', 'night', false),
  ('STL - FL', '2026-09-04', 'Friday', 'GAME', 'DBT', NULL, 820368, '2026-09-04T22:30:00Z', 'night', false),
  ('STL - FL', '2026-09-05', 'Saturday', 'GAME', 'DBT', NULL, 820366, '2026-09-05T22:00:00Z', 'night', false),
  ('STL - FL', '2026-09-06', 'Sunday', 'GAME', 'DBT', NULL, 820364, '2026-09-06T16:30:00Z', 'day', false)
ON CONFLICT (account_key, service_date) DO UPDATE
  SET day_type        = EXCLUDED.day_type,
      opponent        = EXCLUDED.opponent,
      game_pk         = EXCLUDED.game_pk,
      game_time       = EXCLUDED.game_time,
      day_night       = EXCLUDED.day_night,
      day_of_week     = EXCLUDED.day_of_week,
      is_doubleheader = EXCLUDED.is_doubleheader
  WHERE sc_homestand_schedule.day_type = 'GAME';


-- ─── 4. COMMENT ON COLUMN ──────────────────────────────────────────
COMMENT ON COLUMN accounts.has_schedule_overlay IS
  'True when this account wants schedule rows shown as an '
  'INFORMATIONAL DISPLAY overlay on the drill-in tile. Purely '
  'presentational: does NOT change classifyDayStatus, does NOT '
  'change resolveDayKind, does NOT feed aggregateWorkspaceMetrics. '
  'The reader fetches GAME rows via loadScheduleOverlay() and '
  'threads them into the workspace tile bag; when a date has an '
  'overlay row, the render conditionally prepends the opponent '
  'chip + day/night pill. Orthogonal to has_homestand_schedule. '
  'Currently TRUE only for STL - FL (sc-17, Palm Beach Cardinals '
  'home games). See docs/audits/SC_17_INVESTIGATION_2026-07-11.md '
  'for the design rationale.';


COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- POST-APPLY PROBES (commented; uncomment individually to run)
-- ═══════════════════════════════════════════════════════════════════
--
-- Probe A: overlay flag distribution
--
-- SELECT team_key, name, billing_model,
--        has_homestand_schedule, has_schedule_overlay
--   FROM accounts
--  WHERE has_schedule_overlay = true
--     OR has_homestand_schedule = true
--  ORDER BY team_key;
--
-- Expected: 7 rows. 6 from sc-16 (all has_homestand_schedule=true,
-- has_schedule_overlay=false) + STL-FL (flat_fee,
-- has_homestand_schedule=FALSE, has_schedule_overlay=TRUE).
--   CIN - KY      Louisville Bats            actuals_drive_invoice  true   false
--   CIN - OH      Cincinnati Reds            flat_fee               true   false
--   STL - FL      STL Cardinals (Palm Beach) flat_fee               false  true
--   STL - MO      St. Louis Cardinals        flat_fee               true   false
--   TBJ - NY      Buffalo Bisons             actuals_drive_invoice  true   false
--   TXR - TX - H  Texas Rangers (home)       flat_fee               true   false
--   TXR - TX - V  Texas Rangers (visitor)    flat_fee               true   false
--
-- STL - FL row MUST have has_homestand_schedule=false and
-- has_schedule_overlay=true. If both are true, sc-17 fired on an
-- account that already had homestand_schedule and the reader will
-- double-fetch - investigate before the paired-PR reader lands.
--
--
-- Probe B: STL - FL HOME row count
--
-- SELECT day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key = 'STL - FL'
--  GROUP BY day_type
--  ORDER BY day_type;
--
-- Expected: exactly one row of output.
--   GAME  66
-- If AWAY / EXHIBITION / PREP appears here, this migration or a
-- future one leaked non-overlay data onto STL - FL. Revert.
--
--
-- Probe C: STL - FL day_night + game_time coverage
--
-- SELECT COUNT(*) AS home_rows,
--        COUNT(*) FILTER (WHERE game_time IS NOT NULL) AS with_game_time,
--        COUNT(*) FILTER (WHERE day_night IS NOT NULL) AS with_day_night
--   FROM sc_homestand_schedule
--  WHERE account_key = 'STL - FL'
--    AND day_type = 'GAME';
--
-- Expected: 66, 66, 66. Any GAME row missing game_time or day_night
-- would break the [vs OPP] + pill render on that date.
--
--
-- Probe D: STL - FL day/night distribution
--
-- SELECT day_night, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key = 'STL - FL'
--    AND day_type = 'GAME'
--  GROUP BY day_night
--  ORDER BY day_night;
--
-- Expected: day=13, night=53 (matches extractor summary).
--
--
-- Probe E: STL - FL DH-flagged rows
--
-- SELECT service_date, opponent, is_doubleheader
--   FROM sc_homestand_schedule
--  WHERE account_key = 'STL - FL'
--    AND is_doubleheader = true
--  ORDER BY service_date;
--
-- Expected: 3 rows. Spot-check the dates against the extractor stderr.
--
--
-- Probe F: sc-16 accounts' HOME/AWAY counts UNCHANGED
--
-- SELECT account_key, day_type, COUNT(*) AS rows
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V',
--                        'CIN - KY','TBJ - NY')
--  GROUP BY account_key, day_type
--  ORDER BY account_key, day_type;
--
-- Expected: matches the sc-16 post-apply snapshot exactly. If any
-- count changed, this migration touched an unintended account.
-- Rollback trigger.
--
--
-- Probe G: no schedule rows on any other flagged-off account
--
-- SELECT account_key, day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key NOT IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V',
--                            'CIN - KY','TBJ - NY','STL - FL')
--  GROUP BY account_key, day_type;
--
-- Expected: zero rows returned. If anything shows here, this
-- migration inserted onto an unintended account - revert.
