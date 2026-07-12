-- ═══════════════════════════════════════════════════════════════════
-- sc-17-fsl-home-overlay.sql (revised 2026-07-11: TBJ - FL added)
-- Service Calendar - FSL PDC home-game overlays for STL - FL AND TBJ - FL.
--
-- Purpose:
--   Add a NEW flag `accounts.has_schedule_overlay BOOLEAN` for accounts
--   that want schedule rows shown as an INFORMATIONAL DISPLAY overlay
--   on the drill-in tile, WITHOUT touching classification, kind
--   resolution, or actionable-day counter math. Set the flag TRUE for
--   BOTH:
--     - STL - FL (Palm Beach Cardinals, parent: St. Louis Cardinals,
--                 sportId=14 teamId=279, billing_model=flat_fee)
--     - TBJ - FL (Dunedin Blue Jays, parent: Toronto Blue Jays,
--                 sportId=14 teamId=424, billing_model=actuals_drive_invoice)
--   and insert 132 total HOME game rows from the MLB Stats API.
--
--   The `has_homestand_schedule` flag introduced by sc-16 stays FALSE
--   for both accounts - flipping it would break each in three
--   documented ways (see docs/audits/SC_17_INVESTIGATION_2026-07-11.md).
--   Both PDC accounts serve DAILY regardless of what the schedule
--   says; a fee-branch reclassifier that routes rowless dates to
--   "off-season" is operationally wrong for daily service.
--
--   `has_schedule_overlay` is orthogonal - it feeds a separate
--   render path that ADDITIVELY prepends the opponent chip and the
--   day/night pill on lg drill-in tiles when the account is flagged
--   AND the date has a GAME row. No status change, no kind change,
--   no counter change. Because the two accounts render as different
--   kinds today (STL - FL = fee-no-dollar, TBJ - FL = per-meal), the
--   paired PR touches renderFeeNoDollar AND renderPerMeal in
--   DaySquare.js and both branches of buildLargeContent - see the
--   PR body for the render-path listing.
--
-- Data source (locked, 2026-07-11):
--   statsapi.mlb.com /api/v1/schedule?sportId=14&teamId=<id>&season=2026&gameType=R
--
--   Verified via /api/v1/teams:
--     - Palm Beach Cardinals    id=279  parent="St. Louis Cardinals"
--     - Dunedin Blue Jays       id=424  parent="Toronto Blue Jays"
--
--   Live pull (see extractor stderr summary):
--     STL - FL: 66 HOME rows (day=13, night=53), 3 DH-flagged,
--               100% dayNight+gameDate coverage, 0 TBD.
--     TBJ - FL: 66 HOME rows (day=13, night=53), 4 DH-flagged,
--               100% dayNight+gameDate coverage, 0 TBD.
--   Postponement shadows resolved to their original dates per sc-16
--   shadow-preferred derivation.
--
-- HOME ONLY - HARD RULE
--   Kevin's ruling 2026-07-11: NO AWAY rows for either account. The
--   FSL plays ~65 away games per club too, but inserting them would
--   either force operationally-wrong "away" tiles on PDCs that serve
--   daily, or force a classifier guard that trades correctness at
--   one axis for complexity at another. Overlay-only. A future pass
--   MUST NOT "complete" this migration by adding AWAY rows.
--
--   Note: PBC and Dunedin play EACH OTHER (both FSL). A PBC home
--   date will read "vs DUN" and a Dunedin home date will read "vs
--   PMB" - expected, no special handling. Verify against
--   Probe H (spot-check).
--
-- Ordered steps (single BEGIN/COMMIT):
--   1. ALTER: accounts.has_schedule_overlay BOOLEAN NOT NULL DEFAULT false.
--   2. UPDATE: set the flag TRUE for both STL - FL and TBJ - FL.
--   3. INSERT: 66 STL - FL + 66 TBJ - FL HOME rows (day_type='GAME')
--      with opponent, game_pk, game_time UTC, day_night, is_doubleheader.
--      Same shape as sc-16's HOME inserts.
--   4. COMMENT ON COLUMN.
--
-- Apply order:
--   - Paste + run in Supabase Studio (repo convention).
--   - Single BEGIN/COMMIT transaction. Idempotent - safe to re-run.
--   - Re-runnable: TBD firm-ups (0 TBD games in the current 2026 pull
--     for either account, but the ON CONFLICT DO UPDATE keeps the
--     door open).
--   - Verify with the probe block at the bottom (uncomment individually).
--
-- What this migration does NOT do:
--   - Live-sync. Load-once for 2026 + optional re-runnable refresh.
--   - Widen the reader / renderer. Paired PR flips both accounts'
--     tile renders to conditionally prepend [vs OPP] + [pill] when
--     overlay data has a row for the date.
--   - Insert AWAY / EXHIBITION / PREP rows on either account. Ever.
--   - Change per-meal or fee-account behavior on ANY other account.
--   - Change actionable-day counter math (#409).
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
-- theory) both flags on; today only STL - FL and TBJ - FL use the
-- overlay and NEITHER has has_homestand_schedule=true.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS has_schedule_overlay BOOLEAN NOT NULL DEFAULT false;


-- ─── 2. Set flag TRUE for STL - FL AND TBJ - FL ────────────────────
-- Both are FSL Single-A PDC accounts that serve DAILY (billing
-- models differ - STL - FL is flat_fee, TBJ - FL is
-- actuals_drive_invoice - but daily service is the shared trait).
-- Neither has has_homestand_schedule=true; overlay-only is the
-- correct treatment for both (see the file header comments + the
-- audit doc).
UPDATE accounts
   SET has_schedule_overlay = true
 WHERE team_key IN ('STL - FL', 'TBJ - FL');


-- ─── 3. INSERT HOME rows for both accounts (day_type='GAME') ───────
-- Same shape as sc-16's HOME inserts: opponent (API abbreviation),
-- game_pk (MLB Stats API stable identifier), game_time (UTC
-- TIMESTAMPTZ), day_night, is_doubleheader.
--
-- Row order: 66 STL - FL rows followed by 66 TBJ - FL rows,
-- 132 total. Extractor emits both slices with STL - FL first;
-- the trailing comma on the last STL - FL row transitions cleanly
-- into the first TBJ - FL row.
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
  ('STL - FL', '2026-09-06', 'Sunday', 'GAME', 'DBT', NULL, 820364, '2026-09-06T16:30:00Z', 'day', false),
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
  'Set TRUE for STL - FL (Palm Beach Cardinals home games, '
  'fee-no-dollar render kind) and TBJ - FL (Dunedin Blue Jays '
  'home games, per-meal render kind) via sc-17. See '
  'docs/audits/SC_17_INVESTIGATION_2026-07-11.md for design rationale.';


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
-- Expected: 8 rows. 6 from sc-16 (all has_homestand_schedule=true,
-- has_schedule_overlay=false) + STL-FL + TBJ-FL (both
-- has_homestand_schedule=FALSE, has_schedule_overlay=TRUE).
--   CIN - KY      Louisville Bats            actuals_drive_invoice  true   false
--   CIN - OH      Cincinnati Reds            flat_fee               true   false
--   STL - FL      Cardinals Palm Beach       flat_fee               false  true
--   STL - MO      St. Louis Cardinals        flat_fee               true   false
--   TBJ - FL      Blue Jays Dunedin          actuals_drive_invoice  false  true
--   TBJ - NY      Buffalo Bisons             actuals_drive_invoice  true   false
--   TXR - TX - H  Texas Rangers (home)       flat_fee               true   false
--   TXR - TX - V  Texas Rangers (visitor)    flat_fee               true   false
--
-- STL - FL and TBJ - FL rows MUST both have has_homestand_schedule=false
-- and has_schedule_overlay=true. If both flags are true on either
-- account, sc-17 fired on an account that already had homestand_schedule
-- and the reader will double-fetch - investigate before the paired-PR
-- reader lands.
--
--
-- Probe B: per-account HOME row count
--
-- SELECT account_key, day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('STL - FL', 'TBJ - FL')
--  GROUP BY account_key, day_type
--  ORDER BY account_key, day_type;
--
-- Expected: exactly two rows of output.
--   STL - FL  GAME  66
--   TBJ - FL  GAME  66
-- If AWAY / EXHIBITION / PREP appears on either account, this
-- migration or a future one leaked non-overlay data. Revert.
--
--
-- Probe C: day_night + game_time coverage
--
-- SELECT account_key,
--        COUNT(*) AS home_rows,
--        COUNT(*) FILTER (WHERE game_time IS NOT NULL) AS with_game_time,
--        COUNT(*) FILTER (WHERE day_night IS NOT NULL) AS with_day_night
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('STL - FL', 'TBJ - FL')
--    AND day_type = 'GAME'
--  GROUP BY account_key
--  ORDER BY account_key;
--
-- Expected: 66, 66, 66 for each account. Any GAME row missing
-- game_time or day_night would break the [vs OPP] + pill render on
-- that date.
--
--
-- Probe D: day/night distribution per account
--
-- SELECT account_key, day_night, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('STL - FL', 'TBJ - FL')
--    AND day_type = 'GAME'
--  GROUP BY account_key, day_night
--  ORDER BY account_key, day_night;
--
-- Expected (matches extractor summary):
--   STL - FL  day    13
--   STL - FL  night  53
--   TBJ - FL  day    13
--   TBJ - FL  night  53
--
--
-- Probe E: DH-flagged rows per account
--
-- SELECT account_key, service_date, opponent, is_doubleheader
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('STL - FL', 'TBJ - FL')
--    AND is_doubleheader = true
--  ORDER BY account_key, service_date;
--
-- Expected: 3 rows for STL - FL, 4 rows for TBJ - FL (matches
-- extractor summary). Spot-check the dates against the run log.
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
--                            'CIN - KY','TBJ - NY','STL - FL','TBJ - FL')
--  GROUP BY account_key, day_type;
--
-- Expected: zero rows returned. If anything shows here, this
-- migration inserted onto an unintended account - revert.
--
--
-- Probe H: STL - FL and TBJ - FL play each other spot-check
--
-- SELECT account_key, service_date, opponent, day_night
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('STL - FL', 'TBJ - FL')
--    AND opponent IN ('PMB', 'DBT', 'PBC', 'DUN', 'DBJ', 'STL', 'JAY',
--                     'CAR', 'CARDS', 'JAYS')
--    AND day_type = 'GAME'
--  ORDER BY account_key, service_date;
--
-- Expected: some number of dates where one account's home game has
-- the other's team code as opponent (they share the FSL). The exact
-- codes depend on how the API abbreviates - if this returns zero
-- rows and the extractor summary showed both clubs on the schedule,
-- the abbreviation set needs widening. Not a failure by itself -
-- it's a curiosity probe to spot-check that the shared-league relationship
-- surfaces on both sides.
