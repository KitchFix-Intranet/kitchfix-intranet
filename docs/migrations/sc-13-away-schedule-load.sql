-- ═══════════════════════════════════════════════════════════════════
-- sc-13-away-schedule-load.sql
-- Service Calendar - load AWAY games + add game_pk stable identity.
--
-- Landing site for the "complete schedule in Postgres" architectural
-- decision. sc-12 seeded the HOME slate under PDF-as-truth; sc-13
-- adds the ROAD slate under MLB-Stats-API-as-truth (see
-- docs/audits/SC_13_MLB_API_FEASIBILITY_2026-07-10.md - the API's
-- home slate reconciled row-for-row against sc-12, validating both
-- sources independently).
--
-- Scope:
--   1. Expand day_type CHECK to include 'AWAY' (schema first, load
--      second - same ordering lesson as sc-12 EXHIBITION).
--   2. Relax homestand_id to NULLABLE - away games belong to no
--      homestand.
--   3. Add game_pk BIGINT column (nullable). Partial UNIQUE index on
--      (account_key, game_pk) WHERE game_pk IS NOT NULL - lets a
--      future live-sync idempotent-upsert by MLB game identity per
--      the schema review's stable-key recommendation.
--   4. INSERT ~324 AWAY rows (81 per account, 4 accounts, TXR H/V
--      mirror per Q-d). Data extracted from MLB Stats API via
--      scripts/_extract_sc_13_away_schedule.mjs; block embedded below.
--   5. Backfill game_pk on existing HOME (day_type='GAME') rows so
--      the whole 162-per-account regular-season slate has stable
--      identity. HOME rows' day_type / opponent are NOT touched -
--      sc-12 reconciled those and they stay authoritative.
--   6. COMMENT ON TABLE noting the semantic drift (table name is now
--      a mild misnomer; rename deferred).
--
-- What this migration does NOT do (per the schema review):
--   - Rename sc_homestand_schedule. Deferred.
--   - Add road_trip_id. Deferred until a product need appears.
--   - Add FK on account_key -> accounts.team_key. Worth doing but
--     scope-separate.
--   - Refactor sc_daily_projections to key on game_pk. Meal counts
--     belong to the kitchen shift, not the game.
--   - Load 2025 or earlier seasons. Historical backfill is a
--     separate Kevin call.
--
-- Data-quality flag: the extraction script surfaced 35 AWAY-vs-
-- existing-row conflicts across the 4 accounts (mostly PREP, some
-- CLOSE at season end). The ON CONFLICT WHERE clause preserves the
-- existing row (safe default). Kevin's PR body enumerates each
-- conflict; decision on whether to reclassify PREP -> AWAY is a
-- follow-up call, not this migration.
--
-- Apply order:
--   - Paste + run in Supabase Studio (repo convention: migrations
--     don't auto-run on deploy).
--   - Single BEGIN/COMMIT transaction. Idempotent - safe to re-run.
--   - Verify with the probe block at the bottom (commented; uncomment
--     to execute).
--
-- References:
--   - Schema decision:      docs/audits/SC_13_SCHEMA_REVIEW_2026-07-10.md
--   - API feasibility:      docs/audits/SC_13_MLB_API_FEASIBILITY_2026-07-10.md
--   - sc-12 prior work:     docs/migrations/sc-12-mlb-schedule-reconciliation.sql
--   - PR #386 EXH pattern:  b6b6d0b (the reader-side pattern this PR extends)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. day_type CHECK expansion ───────────────────────────────────
-- Same drop-and-recreate ceremony sc-12 used for EXHIBITION. Look up
-- the auto-named constraint by target column at drop time.
DO $$
DECLARE
  cons_name TEXT;
BEGIN
  SELECT conname INTO cons_name
  FROM pg_constraint
  WHERE conrelid = 'sc_homestand_schedule'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%day_type%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sc_homestand_schedule DROP CONSTRAINT %I', cons_name);
    RAISE NOTICE 'Dropped constraint %', cons_name;
  ELSE
    RAISE NOTICE 'No matching day_type CHECK found - assuming already dropped or renamed';
  END IF;
END $$;

ALTER TABLE sc_homestand_schedule
  ADD CONSTRAINT sc_homestand_schedule_day_type_check
  CHECK (day_type IN ('GAME','PREP','OPEN','CLOSE','CLEAN','EXHIBITION','AWAY'));


-- ─── 2. homestand_id NOT NULL relaxation ───────────────────────────
-- Away games belong to no homestand. Existing HOME/PREP/OPEN/CLOSE/
-- EXHIBITION rows are unaffected (all currently populate homestand_id).
ALTER TABLE sc_homestand_schedule
  ALTER COLUMN homestand_id DROP NOT NULL;


-- ─── 3. game_pk column + partial UNIQUE index ──────────────────────
-- MLB's stable per-game identifier. Nullable so:
--   - pre-load HOME/PREP/OPEN/CLOSE/EXHIBITION rows stay valid before
--     the backfill in step 5 runs
--   - future manually-authored rows without a MLB game reference
--     (e.g. an ad-hoc PREP day) remain valid
-- Partial UNIQUE lets a future live-sync idempotent-upsert by game_pk.
ALTER TABLE sc_homestand_schedule
  ADD COLUMN IF NOT EXISTS game_pk BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_homestand_schedule_account_game_pk
  ON sc_homestand_schedule (account_key, game_pk)
  WHERE game_pk IS NOT NULL;


-- ─── 4. COMMENT ON TABLE ───────────────────────────────────────────
-- Documents the semantic drift: table was named for homestands, now
-- stores AWAY rows too. Rename deferred to its own dedicated PR per
-- the schema review. Comment surfaces the naming lie to any future
-- reader who lands on the DDL cold.
COMMENT ON TABLE sc_homestand_schedule IS
  'Per-(account, date) schedule shape for the 4 MLB fee accounts. '
  'Historically homestand-only (name reflects that); post-sc-13 also '
  'stores AWAY rows (day_type=AWAY, homestand_id NULL). Rename '
  'pending its own dedicated PR when a broader restructure is scoped. '
  'day_type domain: GAME|PREP|OPEN|CLOSE|CLEAN|EXHIBITION|AWAY. '
  'game_pk is MLB Stats API''s stable per-game identifier (nullable '
  'for non-game rows: PREP/OPEN/CLOSE/CLEAN).';


-- ─── 5. AWAY inserts + HOME game_pk backfill ───────────────────────

-- ── (1) AWAY inserts ──────────────────────────────────────────────
INSERT INTO sc_homestand_schedule
  (account_key, service_date, day_of_week, day_type, opponent, homestand_id, game_pk)
VALUES
  ('CIN - OH', '2026-04-03', 'Friday', 'AWAY', 'TEX', NULL, 822919),
  ('CIN - OH', '2026-04-04', 'Saturday', 'AWAY', 'TEX', NULL, 822920),
  ('CIN - OH', '2026-04-05', 'Sunday', 'AWAY', 'TEX', NULL, 822917),
  ('CIN - OH', '2026-04-06', 'Monday', 'AWAY', 'MIA', NULL, 823886),
  ('CIN - OH', '2026-04-07', 'Tuesday', 'AWAY', 'MIA', NULL, 823887),
  ('CIN - OH', '2026-04-08', 'Wednesday', 'AWAY', 'MIA', NULL, 823885),
  ('CIN - OH', '2026-04-09', 'Thursday', 'AWAY', 'MIA', NULL, 823884),
  ('CIN - OH', '2026-04-17', 'Friday', 'AWAY', 'MIN', NULL, 823720),
  ('CIN - OH', '2026-04-18', 'Saturday', 'AWAY', 'MIN', NULL, 823721),
  ('CIN - OH', '2026-04-19', 'Sunday', 'AWAY', 'MIN', NULL, 823718),
  ('CIN - OH', '2026-04-20', 'Monday', 'AWAY', 'TB', NULL, 822994),
  ('CIN - OH', '2026-04-21', 'Tuesday', 'AWAY', 'TB', NULL, 822995),
  ('CIN - OH', '2026-04-22', 'Wednesday', 'AWAY', 'TB', NULL, 822993),
  ('CIN - OH', '2026-05-01', 'Friday', 'AWAY', 'PIT', NULL, 823389),
  ('CIN - OH', '2026-05-02', 'Saturday', 'AWAY', 'PIT', NULL, 823388),
  ('CIN - OH', '2026-05-03', 'Sunday', 'AWAY', 'PIT', NULL, 823387),
  ('CIN - OH', '2026-05-04', 'Monday', 'AWAY', 'CHC', NULL, 824684),
  ('CIN - OH', '2026-05-05', 'Tuesday', 'AWAY', 'CHC', NULL, 824682),
  ('CIN - OH', '2026-05-06', 'Wednesday', 'AWAY', 'CHC', NULL, 824683),
  ('CIN - OH', '2026-05-07', 'Thursday', 'AWAY', 'CHC', NULL, 824681),
  ('CIN - OH', '2026-05-15', 'Friday', 'AWAY', 'CLE', NULL, 824439),
  ('CIN - OH', '2026-05-16', 'Saturday', 'AWAY', 'CLE', NULL, 824435),
  ('CIN - OH', '2026-05-17', 'Sunday', 'AWAY', 'CLE', NULL, 824436),
  ('CIN - OH', '2026-05-18', 'Monday', 'AWAY', 'PHI', NULL, 823465),
  ('CIN - OH', '2026-05-19', 'Tuesday', 'AWAY', 'PHI', NULL, 823464),
  ('CIN - OH', '2026-05-20', 'Wednesday', 'AWAY', 'PHI', NULL, 823462),
  ('CIN - OH', '2026-05-25', 'Monday', 'AWAY', 'NYM', NULL, 823625),
  ('CIN - OH', '2026-05-26', 'Tuesday', 'AWAY', 'NYM', NULL, 823624),
  ('CIN - OH', '2026-05-27', 'Wednesday', 'AWAY', 'NYM', NULL, 823626),
  ('CIN - OH', '2026-06-05', 'Friday', 'AWAY', 'STL', NULL, 823049),
  ('CIN - OH', '2026-06-06', 'Saturday', 'AWAY', 'STL', NULL, 823048),
  ('CIN - OH', '2026-06-07', 'Sunday', 'AWAY', 'STL', NULL, 823047),
  ('CIN - OH', '2026-06-08', 'Monday', 'AWAY', 'SD', NULL, 823289),
  ('CIN - OH', '2026-06-09', 'Tuesday', 'AWAY', 'SD', NULL, 823290),
  ('CIN - OH', '2026-06-10', 'Wednesday', 'AWAY', 'SD', NULL, 823287),
  ('CIN - OH', '2026-06-19', 'Friday', 'AWAY', 'NYY', NULL, 823534),
  ('CIN - OH', '2026-06-20', 'Saturday', 'AWAY', 'NYY', NULL, 823532),
  ('CIN - OH', '2026-06-21', 'Sunday', 'AWAY', 'NYY', NULL, 823531),
  ('CIN - OH', '2026-06-26', 'Friday', 'AWAY', 'PIT', NULL, 823363),
  ('CIN - OH', '2026-06-27', 'Saturday', 'AWAY', 'PIT', NULL, 823364),
  ('CIN - OH', '2026-06-28', 'Sunday', 'AWAY', 'PIT', NULL, 823362),
  ('CIN - OH', '2026-06-29', 'Monday', 'AWAY', 'MIL', NULL, 823771),
  ('CIN - OH', '2026-06-30', 'Tuesday', 'AWAY', 'MIL', NULL, 823768),
  ('CIN - OH', '2026-07-01', 'Wednesday', 'AWAY', 'MIL', NULL, 823767),
  ('CIN - OH', '2026-07-02', 'Thursday', 'AWAY', 'MIL', NULL, 823765),
  ('CIN - OH', '2026-07-17', 'Friday', 'AWAY', 'COL', NULL, 824332),
  ('CIN - OH', '2026-07-18', 'Saturday', 'AWAY', 'COL', NULL, 824331),
  ('CIN - OH', '2026-07-19', 'Sunday', 'AWAY', 'COL', NULL, 824330),
  ('CIN - OH', '2026-07-20', 'Monday', 'AWAY', 'SEA', NULL, 823112),
  ('CIN - OH', '2026-07-21', 'Tuesday', 'AWAY', 'SEA', NULL, 823114),
  ('CIN - OH', '2026-07-22', 'Wednesday', 'AWAY', 'SEA', NULL, 823110),
  ('CIN - OH', '2026-07-24', 'Friday', 'AWAY', 'STL', NULL, 823031),
  ('CIN - OH', '2026-07-25', 'Saturday', 'AWAY', 'STL', NULL, 823027),
  ('CIN - OH', '2026-07-26', 'Sunday', 'AWAY', 'STL', NULL, 823028),
  ('CIN - OH', '2026-08-07', 'Friday', 'AWAY', 'WSH', NULL, 822699),
  ('CIN - OH', '2026-08-08', 'Saturday', 'AWAY', 'WSH', NULL, 822701),
  ('CIN - OH', '2026-08-09', 'Sunday', 'AWAY', 'WSH', NULL, 822700),
  ('CIN - OH', '2026-08-11', 'Tuesday', 'AWAY', 'CWS', NULL, 824563),
  ('CIN - OH', '2026-08-12', 'Wednesday', 'AWAY', 'CWS', NULL, 824562),
  ('CIN - OH', '2026-08-13', 'Thursday', 'AWAY', 'CWS', NULL, 824561),
  ('CIN - OH', '2026-08-21', 'Friday', 'AWAY', 'ARI', NULL, 825045),
  ('CIN - OH', '2026-08-22', 'Saturday', 'AWAY', 'ARI', NULL, 825044),
  ('CIN - OH', '2026-08-23', 'Sunday', 'AWAY', 'ARI', NULL, 825043),
  ('CIN - OH', '2026-08-24', 'Monday', 'AWAY', 'SF', NULL, 823183),
  ('CIN - OH', '2026-08-25', 'Tuesday', 'AWAY', 'SF', NULL, 823181),
  ('CIN - OH', '2026-08-26', 'Wednesday', 'AWAY', 'SF', NULL, 823180),
  ('CIN - OH', '2026-08-28', 'Friday', 'AWAY', 'CHC', NULL, 824638),
  ('CIN - OH', '2026-08-29', 'Saturday', 'AWAY', 'CHC', NULL, 824637),
  ('CIN - OH', '2026-08-30', 'Sunday', 'AWAY', 'CHC', NULL, 824636),
  ('CIN - OH', '2026-09-07', 'Monday', 'AWAY', 'LAD', NULL, 823902),
  ('CIN - OH', '2026-09-08', 'Tuesday', 'AWAY', 'LAD', NULL, 823901),
  ('CIN - OH', '2026-09-09', 'Wednesday', 'AWAY', 'LAD', NULL, 823900),
  ('CIN - OH', '2026-09-11', 'Friday', 'AWAY', 'MIL', NULL, 823736),
  ('CIN - OH', '2026-09-12', 'Saturday', 'AWAY', 'MIL', NULL, 823737),
  ('CIN - OH', '2026-09-13', 'Sunday', 'AWAY', 'MIL', NULL, 823734),
  ('CIN - OH', '2026-09-22', 'Tuesday', 'AWAY', 'ATL', NULL, 824867),
  ('CIN - OH', '2026-09-23', 'Wednesday', 'AWAY', 'ATL', NULL, 824868),
  ('CIN - OH', '2026-09-24', 'Thursday', 'AWAY', 'ATL', NULL, 824866),
  ('CIN - OH', '2026-09-25', 'Friday', 'AWAY', 'TOR', NULL, 822760),
  ('CIN - OH', '2026-09-26', 'Saturday', 'AWAY', 'TOR', NULL, 822759),
  ('CIN - OH', '2026-09-27', 'Sunday', 'AWAY', 'TOR', NULL, 822761),
  ('STL - MO', '2026-04-03', 'Friday', 'AWAY', 'DET', NULL, 824299),
  ('STL - MO', '2026-04-04', 'Saturday', 'AWAY', 'DET', NULL, 824295),
  ('STL - MO', '2026-04-05', 'Sunday', 'AWAY', 'DET', NULL, 824296),
  ('STL - MO', '2026-04-06', 'Monday', 'AWAY', 'WSH', NULL, 822755),
  ('STL - MO', '2026-04-07', 'Tuesday', 'AWAY', 'WSH', NULL, 822754),
  ('STL - MO', '2026-04-08', 'Wednesday', 'AWAY', 'WSH', NULL, 822753),
  ('STL - MO', '2026-04-17', 'Friday', 'AWAY', 'HOU', NULL, 824207),
  ('STL - MO', '2026-04-18', 'Saturday', 'AWAY', 'HOU', NULL, 824206),
  ('STL - MO', '2026-04-19', 'Sunday', 'AWAY', 'HOU', NULL, 824205),
  ('STL - MO', '2026-04-20', 'Monday', 'AWAY', 'MIA', NULL, 823879),
  ('STL - MO', '2026-04-21', 'Tuesday', 'AWAY', 'MIA', NULL, 823880),
  ('STL - MO', '2026-04-22', 'Wednesday', 'AWAY', 'MIA', NULL, 823878),
  ('STL - MO', '2026-04-27', 'Monday', 'AWAY', 'PIT', NULL, 823395),
  ('STL - MO', '2026-04-28', 'Tuesday', 'AWAY', 'PIT', NULL, 823390),
  ('STL - MO', '2026-04-29', 'Wednesday', 'AWAY', 'PIT', NULL, 823392),
  ('STL - MO', '2026-04-30', 'Thursday', 'AWAY', 'PIT', NULL, 823391),
  ('STL - MO', '2026-05-07', 'Thursday', 'AWAY', 'SD', NULL, 823306),
  ('STL - MO', '2026-05-08', 'Friday', 'AWAY', 'SD', NULL, 823303),
  ('STL - MO', '2026-05-09', 'Saturday', 'AWAY', 'SD', NULL, 823304),
  ('STL - MO', '2026-05-10', 'Sunday', 'AWAY', 'SD', NULL, 823305),
  ('STL - MO', '2026-05-12', 'Tuesday', 'AWAY', 'ATH', NULL, 825011),
  ('STL - MO', '2026-05-13', 'Wednesday', 'AWAY', 'ATH', NULL, 825010),
  ('STL - MO', '2026-05-14', 'Thursday', 'AWAY', 'ATH', NULL, 825008),
  ('STL - MO', '2026-05-22', 'Friday', 'AWAY', 'CIN', NULL, 824518),
  ('STL - MO', '2026-05-23', 'Saturday', 'AWAY', 'CIN', NULL, 824516),
  ('STL - MO', '2026-05-24', 'Sunday', 'AWAY', 'CIN', NULL, 824514),
  ('STL - MO', '2026-05-25', 'Monday', 'AWAY', 'MIL', NULL, 823784),
  ('STL - MO', '2026-05-26', 'Tuesday', 'AWAY', 'MIL', NULL, 823785),
  ('STL - MO', '2026-05-27', 'Wednesday', 'AWAY', 'MIL', NULL, 823783),
  ('STL - MO', '2026-06-09', 'Tuesday', 'AWAY', 'NYM', NULL, 823620),
  ('STL - MO', '2026-06-10', 'Wednesday', 'AWAY', 'NYM', NULL, 823618),
  ('STL - MO', '2026-06-11', 'Thursday', 'AWAY', 'NYM', NULL, 823619),
  ('STL - MO', '2026-06-12', 'Friday', 'AWAY', 'MIN', NULL, 823695),
  ('STL - MO', '2026-06-13', 'Saturday', 'AWAY', 'MIN', NULL, 823694),
  ('STL - MO', '2026-06-14', 'Sunday', 'AWAY', 'MIN', NULL, 823693),
  ('STL - MO', '2026-06-18', 'Thursday', 'AWAY', 'KC', NULL, 824098),
  ('STL - MO', '2026-06-19', 'Friday', 'AWAY', 'KC', NULL, 824097),
  ('STL - MO', '2026-06-21', 'Sunday', 'AWAY', 'KC', NULL, 824095),
  ('STL - MO', '2026-06-30', 'Tuesday', 'AWAY', 'ATL', NULL, 824907),
  ('STL - MO', '2026-07-01', 'Wednesday', 'AWAY', 'ATL', NULL, 824905),
  ('STL - MO', '2026-07-02', 'Thursday', 'AWAY', 'ATL', NULL, 824906),
  ('STL - MO', '2026-07-03', 'Friday', 'AWAY', 'CHC', NULL, 824659),
  ('STL - MO', '2026-07-04', 'Saturday', 'AWAY', 'CHC', NULL, 824658),
  ('STL - MO', '2026-07-05', 'Sunday', 'AWAY', 'CHC', NULL, 824656),
  ('STL - MO', '2026-07-17', 'Friday', 'AWAY', 'ARI', NULL, 825060),
  ('STL - MO', '2026-07-18', 'Saturday', 'AWAY', 'ARI', NULL, 825059),
  ('STL - MO', '2026-07-19', 'Sunday', 'AWAY', 'ARI', NULL, 825057),
  ('STL - MO', '2026-07-20', 'Monday', 'AWAY', 'LAA', NULL, 824006),
  ('STL - MO', '2026-07-21', 'Tuesday', 'AWAY', 'LAA', NULL, 824005),
  ('STL - MO', '2026-07-22', 'Wednesday', 'AWAY', 'LAA', NULL, 824004),
  ('STL - MO', '2026-07-31', 'Friday', 'AWAY', 'TOR', NULL, 822782),
  ('STL - MO', '2026-08-01', 'Saturday', 'AWAY', 'TOR', NULL, 822781),
  ('STL - MO', '2026-08-02', 'Sunday', 'AWAY', 'TOR', NULL, 822783),
  ('STL - MO', '2026-08-03', 'Monday', 'AWAY', 'NYY', NULL, 823520),
  ('STL - MO', '2026-08-04', 'Tuesday', 'AWAY', 'NYY', NULL, 823517),
  ('STL - MO', '2026-08-05', 'Wednesday', 'AWAY', 'NYY', NULL, 823516),
  ('STL - MO', '2026-08-14', 'Friday', 'AWAY', 'CHC', NULL, 824643),
  ('STL - MO', '2026-08-15', 'Saturday', 'AWAY', 'CHC', NULL, 824644),
  ('STL - MO', '2026-08-16', 'Sunday', 'AWAY', 'CHC', NULL, 824642),
  ('STL - MO', '2026-08-17', 'Monday', 'AWAY', 'CIN', NULL, 824478),
  ('STL - MO', '2026-08-18', 'Tuesday', 'AWAY', 'CIN', NULL, 824475),
  ('STL - MO', '2026-08-19', 'Wednesday', 'AWAY', 'CIN', NULL, 824476),
  ('STL - MO', '2026-08-20', 'Thursday', 'AWAY', 'CIN', NULL, 824474),
  ('STL - MO', '2026-08-21', 'Friday', 'AWAY', 'PHI', NULL, 823420),
  ('STL - MO', '2026-08-22', 'Saturday', 'AWAY', 'PHI', NULL, 823422),
  ('STL - MO', '2026-08-23', 'Sunday', 'AWAY', 'PHI', NULL, 823421),
  ('STL - MO', '2026-09-01', 'Tuesday', 'AWAY', 'LAD', NULL, 823908),
  ('STL - MO', '2026-09-02', 'Wednesday', 'AWAY', 'LAD', NULL, 823906),
  ('STL - MO', '2026-09-03', 'Thursday', 'AWAY', 'LAD', NULL, 823907),
  ('STL - MO', '2026-09-04', 'Friday', 'AWAY', 'COL', NULL, 824311),
  ('STL - MO', '2026-09-05', 'Saturday', 'AWAY', 'COL', NULL, 824310),
  ('STL - MO', '2026-09-06', 'Sunday', 'AWAY', 'COL', NULL, 824309),
  ('STL - MO', '2026-09-07', 'Monday', 'AWAY', 'SF', NULL, 823175),
  ('STL - MO', '2026-09-08', 'Tuesday', 'AWAY', 'SF', NULL, 823174),
  ('STL - MO', '2026-09-09', 'Wednesday', 'AWAY', 'SF', NULL, 823172),
  ('STL - MO', '2026-09-22', 'Tuesday', 'AWAY', 'PIT', NULL, 823328),
  ('STL - MO', '2026-09-23', 'Wednesday', 'AWAY', 'PIT', NULL, 823327),
  ('STL - MO', '2026-09-24', 'Thursday', 'AWAY', 'PIT', NULL, 823326),
  ('STL - MO', '2026-09-25', 'Friday', 'AWAY', 'MIL', NULL, 823735),
  ('STL - MO', '2026-09-26', 'Saturday', 'AWAY', 'MIL', NULL, 823733),
  ('STL - MO', '2026-09-27', 'Sunday', 'AWAY', 'MIL', NULL, 823731),
  ('TXR - TX - H', '2026-03-26', 'Thursday', 'AWAY', 'PHI', NULL, 823486),
  ('TXR - TX - H', '2026-03-28', 'Saturday', 'AWAY', 'PHI', NULL, 823488),
  ('TXR - TX - H', '2026-03-29', 'Sunday', 'AWAY', 'PHI', NULL, 823487),
  ('TXR - TX - H', '2026-03-30', 'Monday', 'AWAY', 'BAL', NULL, 824863),
  ('TXR - TX - H', '2026-03-31', 'Tuesday', 'AWAY', 'BAL', NULL, 824861),
  ('TXR - TX - H', '2026-04-01', 'Wednesday', 'AWAY', 'BAL', NULL, 824860),
  ('TXR - TX - H', '2026-04-10', 'Friday', 'AWAY', 'LAD', NULL, 823968),
  ('TXR - TX - H', '2026-04-11', 'Saturday', 'AWAY', 'LAD', NULL, 823967),
  ('TXR - TX - H', '2026-04-12', 'Sunday', 'AWAY', 'LAD', NULL, 823966),
  ('TXR - TX - H', '2026-04-13', 'Monday', 'AWAY', 'ATH', NULL, 825024),
  ('TXR - TX - H', '2026-04-14', 'Tuesday', 'AWAY', 'ATH', NULL, 825022),
  ('TXR - TX - H', '2026-04-15', 'Wednesday', 'AWAY', 'ATH', NULL, 825021),
  ('TXR - TX - H', '2026-04-16', 'Thursday', 'AWAY', 'ATH', NULL, 825023),
  ('TXR - TX - H', '2026-04-17', 'Friday', 'AWAY', 'SEA', NULL, 823152),
  ('TXR - TX - H', '2026-04-18', 'Saturday', 'AWAY', 'SEA', NULL, 823151),
  ('TXR - TX - H', '2026-04-19', 'Sunday', 'AWAY', 'SEA', NULL, 823150),
  ('TXR - TX - H', '2026-05-01', 'Friday', 'AWAY', 'DET', NULL, 824287),
  ('TXR - TX - H', '2026-05-02', 'Saturday', 'AWAY', 'DET', NULL, 824284),
  ('TXR - TX - H', '2026-05-03', 'Sunday', 'AWAY', 'DET', NULL, 824285),
  ('TXR - TX - H', '2026-05-05', 'Tuesday', 'AWAY', 'NYY', NULL, 823553),
  ('TXR - TX - H', '2026-05-06', 'Wednesday', 'AWAY', 'NYY', NULL, 823550),
  ('TXR - TX - H', '2026-05-07', 'Thursday', 'AWAY', 'NYY', NULL, 823551),
  ('TXR - TX - H', '2026-05-15', 'Friday', 'AWAY', 'HOU', NULL, 824194),
  ('TXR - TX - H', '2026-05-16', 'Saturday', 'AWAY', 'HOU', NULL, 824193),
  ('TXR - TX - H', '2026-05-17', 'Sunday', 'AWAY', 'HOU', NULL, 824192),
  ('TXR - TX - H', '2026-05-18', 'Monday', 'AWAY', 'COL', NULL, 824357),
  ('TXR - TX - H', '2026-05-19', 'Tuesday', 'AWAY', 'COL', NULL, 824356),
  ('TXR - TX - H', '2026-05-20', 'Wednesday', 'AWAY', 'COL', NULL, 824355),
  ('TXR - TX - H', '2026-05-22', 'Friday', 'AWAY', 'LAA', NULL, 824029),
  ('TXR - TX - H', '2026-05-23', 'Saturday', 'AWAY', 'LAA', NULL, 824030),
  ('TXR - TX - H', '2026-05-24', 'Sunday', 'AWAY', 'LAA', NULL, 824028),
  ('TXR - TX - H', '2026-06-01', 'Monday', 'AWAY', 'STL', NULL, 823050),
  ('TXR - TX - H', '2026-06-02', 'Tuesday', 'AWAY', 'STL', NULL, 823052),
  ('TXR - TX - H', '2026-06-03', 'Wednesday', 'AWAY', 'STL', NULL, 823051),
  ('TXR - TX - H', '2026-06-09', 'Tuesday', 'AWAY', 'KC', NULL, 824105),
  ('TXR - TX - H', '2026-06-10', 'Wednesday', 'AWAY', 'KC', NULL, 824103),
  ('TXR - TX - H', '2026-06-11', 'Thursday', 'AWAY', 'KC', NULL, 824101),
  ('TXR - TX - H', '2026-06-12', 'Friday', 'AWAY', 'BOS', NULL, 824752),
  ('TXR - TX - H', '2026-06-13', 'Saturday', 'AWAY', 'BOS', NULL, 824749),
  ('TXR - TX - H', '2026-06-14', 'Sunday', 'AWAY', 'BOS', NULL, 824751),
  ('TXR - TX - H', '2026-06-22', 'Monday', 'AWAY', 'MIA', NULL, 823851),
  ('TXR - TX - H', '2026-06-23', 'Tuesday', 'AWAY', 'MIA', NULL, 823849),
  ('TXR - TX - H', '2026-06-24', 'Wednesday', 'AWAY', 'MIA', NULL, 823850),
  ('TXR - TX - H', '2026-06-25', 'Thursday', 'AWAY', 'TOR', NULL, 822797),
  ('TXR - TX - H', '2026-06-26', 'Friday', 'AWAY', 'TOR', NULL, 822796),
  ('TXR - TX - H', '2026-06-27', 'Saturday', 'AWAY', 'TOR', NULL, 822794),
  ('TXR - TX - H', '2026-06-28', 'Sunday', 'AWAY', 'TOR', NULL, 822795),
  ('TXR - TX - H', '2026-06-29', 'Monday', 'AWAY', 'CLE', NULL, 824420),
  ('TXR - TX - H', '2026-06-30', 'Tuesday', 'AWAY', 'CLE', NULL, 824418),
  ('TXR - TX - H', '2026-07-01', 'Wednesday', 'AWAY', 'CLE', NULL, 824419),
  ('TXR - TX - H', '2026-07-17', 'Friday', 'AWAY', 'ATL', NULL, 824901),
  ('TXR - TX - H', '2026-07-18', 'Saturday', 'AWAY', 'ATL', NULL, 824899),
  ('TXR - TX - H', '2026-07-19', 'Sunday', 'AWAY', 'ATL', NULL, 824897),
  ('TXR - TX - H', '2026-07-28', 'Tuesday', 'AWAY', 'TB', NULL, 822949),
  ('TXR - TX - H', '2026-07-29', 'Wednesday', 'AWAY', 'TB', NULL, 822947),
  ('TXR - TX - H', '2026-07-30', 'Thursday', 'AWAY', 'TB', NULL, 822946),
  ('TXR - TX - H', '2026-07-31', 'Friday', 'AWAY', 'HOU', NULL, 824164),
  ('TXR - TX - H', '2026-08-01', 'Saturday', 'AWAY', 'HOU', NULL, 824162),
  ('TXR - TX - H', '2026-08-02', 'Sunday', 'AWAY', 'HOU', NULL, 824163),
  ('TXR - TX - H', '2026-08-10', 'Monday', 'AWAY', 'LAA', NULL, 823998),
  ('TXR - TX - H', '2026-08-11', 'Tuesday', 'AWAY', 'LAA', NULL, 823997),
  ('TXR - TX - H', '2026-08-12', 'Wednesday', 'AWAY', 'LAA', NULL, 823994),
  ('TXR - TX - H', '2026-08-13', 'Thursday', 'AWAY', 'LAA', NULL, 823995),
  ('TXR - TX - H', '2026-08-14', 'Friday', 'AWAY', 'ATH', NULL, 824968),
  ('TXR - TX - H', '2026-08-15', 'Saturday', 'AWAY', 'ATH', NULL, 824966),
  ('TXR - TX - H', '2026-08-16', 'Sunday', 'AWAY', 'ATH', NULL, 824965),
  ('TXR - TX - H', '2026-08-24', 'Monday', 'AWAY', 'CWS', NULL, 824557),
  ('TXR - TX - H', '2026-08-25', 'Tuesday', 'AWAY', 'CWS', NULL, 824556),
  ('TXR - TX - H', '2026-08-26', 'Wednesday', 'AWAY', 'CWS', NULL, 824555),
  ('TXR - TX - H', '2026-08-28', 'Friday', 'AWAY', 'MIL', NULL, 823744),
  ('TXR - TX - H', '2026-08-29', 'Saturday', 'AWAY', 'MIL', NULL, 823741),
  ('TXR - TX - H', '2026-08-30', 'Sunday', 'AWAY', 'MIL', NULL, 823740),
  ('TXR - TX - H', '2026-09-08', 'Tuesday', 'AWAY', 'SEA', NULL, 823092),
  ('TXR - TX - H', '2026-09-09', 'Wednesday', 'AWAY', 'SEA', NULL, 823090),
  ('TXR - TX - H', '2026-09-10', 'Thursday', 'AWAY', 'SEA', NULL, 823088),
  ('TXR - TX - H', '2026-09-11', 'Friday', 'AWAY', 'ARI', NULL, 825036),
  ('TXR - TX - H', '2026-09-12', 'Saturday', 'AWAY', 'ARI', NULL, 825035),
  ('TXR - TX - H', '2026-09-13', 'Sunday', 'AWAY', 'ARI', NULL, 825033),
  ('TXR - TX - H', '2026-09-25', 'Friday', 'AWAY', 'MIN', NULL, 823652),
  ('TXR - TX - H', '2026-09-26', 'Saturday', 'AWAY', 'MIN', NULL, 823653),
  ('TXR - TX - H', '2026-09-27', 'Sunday', 'AWAY', 'MIN', NULL, 823650),
  ('TXR - TX - V', '2026-03-26', 'Thursday', 'AWAY', 'PHI', NULL, 823486),
  ('TXR - TX - V', '2026-03-28', 'Saturday', 'AWAY', 'PHI', NULL, 823488),
  ('TXR - TX - V', '2026-03-29', 'Sunday', 'AWAY', 'PHI', NULL, 823487),
  ('TXR - TX - V', '2026-03-30', 'Monday', 'AWAY', 'BAL', NULL, 824863),
  ('TXR - TX - V', '2026-03-31', 'Tuesday', 'AWAY', 'BAL', NULL, 824861),
  ('TXR - TX - V', '2026-04-01', 'Wednesday', 'AWAY', 'BAL', NULL, 824860),
  ('TXR - TX - V', '2026-04-10', 'Friday', 'AWAY', 'LAD', NULL, 823968),
  ('TXR - TX - V', '2026-04-11', 'Saturday', 'AWAY', 'LAD', NULL, 823967),
  ('TXR - TX - V', '2026-04-12', 'Sunday', 'AWAY', 'LAD', NULL, 823966),
  ('TXR - TX - V', '2026-04-13', 'Monday', 'AWAY', 'ATH', NULL, 825024),
  ('TXR - TX - V', '2026-04-14', 'Tuesday', 'AWAY', 'ATH', NULL, 825022),
  ('TXR - TX - V', '2026-04-15', 'Wednesday', 'AWAY', 'ATH', NULL, 825021),
  ('TXR - TX - V', '2026-04-16', 'Thursday', 'AWAY', 'ATH', NULL, 825023),
  ('TXR - TX - V', '2026-04-17', 'Friday', 'AWAY', 'SEA', NULL, 823152),
  ('TXR - TX - V', '2026-04-18', 'Saturday', 'AWAY', 'SEA', NULL, 823151),
  ('TXR - TX - V', '2026-04-19', 'Sunday', 'AWAY', 'SEA', NULL, 823150),
  ('TXR - TX - V', '2026-05-01', 'Friday', 'AWAY', 'DET', NULL, 824287),
  ('TXR - TX - V', '2026-05-02', 'Saturday', 'AWAY', 'DET', NULL, 824284),
  ('TXR - TX - V', '2026-05-03', 'Sunday', 'AWAY', 'DET', NULL, 824285),
  ('TXR - TX - V', '2026-05-05', 'Tuesday', 'AWAY', 'NYY', NULL, 823553),
  ('TXR - TX - V', '2026-05-06', 'Wednesday', 'AWAY', 'NYY', NULL, 823550),
  ('TXR - TX - V', '2026-05-07', 'Thursday', 'AWAY', 'NYY', NULL, 823551),
  ('TXR - TX - V', '2026-05-15', 'Friday', 'AWAY', 'HOU', NULL, 824194),
  ('TXR - TX - V', '2026-05-16', 'Saturday', 'AWAY', 'HOU', NULL, 824193),
  ('TXR - TX - V', '2026-05-17', 'Sunday', 'AWAY', 'HOU', NULL, 824192),
  ('TXR - TX - V', '2026-05-18', 'Monday', 'AWAY', 'COL', NULL, 824357),
  ('TXR - TX - V', '2026-05-19', 'Tuesday', 'AWAY', 'COL', NULL, 824356),
  ('TXR - TX - V', '2026-05-20', 'Wednesday', 'AWAY', 'COL', NULL, 824355),
  ('TXR - TX - V', '2026-05-22', 'Friday', 'AWAY', 'LAA', NULL, 824029),
  ('TXR - TX - V', '2026-05-23', 'Saturday', 'AWAY', 'LAA', NULL, 824030),
  ('TXR - TX - V', '2026-05-24', 'Sunday', 'AWAY', 'LAA', NULL, 824028),
  ('TXR - TX - V', '2026-06-01', 'Monday', 'AWAY', 'STL', NULL, 823050),
  ('TXR - TX - V', '2026-06-02', 'Tuesday', 'AWAY', 'STL', NULL, 823052),
  ('TXR - TX - V', '2026-06-03', 'Wednesday', 'AWAY', 'STL', NULL, 823051),
  ('TXR - TX - V', '2026-06-09', 'Tuesday', 'AWAY', 'KC', NULL, 824105),
  ('TXR - TX - V', '2026-06-10', 'Wednesday', 'AWAY', 'KC', NULL, 824103),
  ('TXR - TX - V', '2026-06-11', 'Thursday', 'AWAY', 'KC', NULL, 824101),
  ('TXR - TX - V', '2026-06-12', 'Friday', 'AWAY', 'BOS', NULL, 824752),
  ('TXR - TX - V', '2026-06-13', 'Saturday', 'AWAY', 'BOS', NULL, 824749),
  ('TXR - TX - V', '2026-06-14', 'Sunday', 'AWAY', 'BOS', NULL, 824751),
  ('TXR - TX - V', '2026-06-22', 'Monday', 'AWAY', 'MIA', NULL, 823851),
  ('TXR - TX - V', '2026-06-23', 'Tuesday', 'AWAY', 'MIA', NULL, 823849),
  ('TXR - TX - V', '2026-06-24', 'Wednesday', 'AWAY', 'MIA', NULL, 823850),
  ('TXR - TX - V', '2026-06-25', 'Thursday', 'AWAY', 'TOR', NULL, 822797),
  ('TXR - TX - V', '2026-06-26', 'Friday', 'AWAY', 'TOR', NULL, 822796),
  ('TXR - TX - V', '2026-06-27', 'Saturday', 'AWAY', 'TOR', NULL, 822794),
  ('TXR - TX - V', '2026-06-28', 'Sunday', 'AWAY', 'TOR', NULL, 822795),
  ('TXR - TX - V', '2026-06-29', 'Monday', 'AWAY', 'CLE', NULL, 824420),
  ('TXR - TX - V', '2026-06-30', 'Tuesday', 'AWAY', 'CLE', NULL, 824418),
  ('TXR - TX - V', '2026-07-01', 'Wednesday', 'AWAY', 'CLE', NULL, 824419),
  ('TXR - TX - V', '2026-07-17', 'Friday', 'AWAY', 'ATL', NULL, 824901),
  ('TXR - TX - V', '2026-07-18', 'Saturday', 'AWAY', 'ATL', NULL, 824899),
  ('TXR - TX - V', '2026-07-19', 'Sunday', 'AWAY', 'ATL', NULL, 824897),
  ('TXR - TX - V', '2026-07-28', 'Tuesday', 'AWAY', 'TB', NULL, 822949),
  ('TXR - TX - V', '2026-07-29', 'Wednesday', 'AWAY', 'TB', NULL, 822947),
  ('TXR - TX - V', '2026-07-30', 'Thursday', 'AWAY', 'TB', NULL, 822946),
  ('TXR - TX - V', '2026-07-31', 'Friday', 'AWAY', 'HOU', NULL, 824164),
  ('TXR - TX - V', '2026-08-01', 'Saturday', 'AWAY', 'HOU', NULL, 824162),
  ('TXR - TX - V', '2026-08-02', 'Sunday', 'AWAY', 'HOU', NULL, 824163),
  ('TXR - TX - V', '2026-08-10', 'Monday', 'AWAY', 'LAA', NULL, 823998),
  ('TXR - TX - V', '2026-08-11', 'Tuesday', 'AWAY', 'LAA', NULL, 823997),
  ('TXR - TX - V', '2026-08-12', 'Wednesday', 'AWAY', 'LAA', NULL, 823994),
  ('TXR - TX - V', '2026-08-13', 'Thursday', 'AWAY', 'LAA', NULL, 823995),
  ('TXR - TX - V', '2026-08-14', 'Friday', 'AWAY', 'ATH', NULL, 824968),
  ('TXR - TX - V', '2026-08-15', 'Saturday', 'AWAY', 'ATH', NULL, 824966),
  ('TXR - TX - V', '2026-08-16', 'Sunday', 'AWAY', 'ATH', NULL, 824965),
  ('TXR - TX - V', '2026-08-24', 'Monday', 'AWAY', 'CWS', NULL, 824557),
  ('TXR - TX - V', '2026-08-25', 'Tuesday', 'AWAY', 'CWS', NULL, 824556),
  ('TXR - TX - V', '2026-08-26', 'Wednesday', 'AWAY', 'CWS', NULL, 824555),
  ('TXR - TX - V', '2026-08-28', 'Friday', 'AWAY', 'MIL', NULL, 823744),
  ('TXR - TX - V', '2026-08-29', 'Saturday', 'AWAY', 'MIL', NULL, 823741),
  ('TXR - TX - V', '2026-08-30', 'Sunday', 'AWAY', 'MIL', NULL, 823740),
  ('TXR - TX - V', '2026-09-08', 'Tuesday', 'AWAY', 'SEA', NULL, 823092),
  ('TXR - TX - V', '2026-09-09', 'Wednesday', 'AWAY', 'SEA', NULL, 823090),
  ('TXR - TX - V', '2026-09-10', 'Thursday', 'AWAY', 'SEA', NULL, 823088),
  ('TXR - TX - V', '2026-09-11', 'Friday', 'AWAY', 'ARI', NULL, 825036),
  ('TXR - TX - V', '2026-09-12', 'Saturday', 'AWAY', 'ARI', NULL, 825035),
  ('TXR - TX - V', '2026-09-13', 'Sunday', 'AWAY', 'ARI', NULL, 825033),
  ('TXR - TX - V', '2026-09-25', 'Friday', 'AWAY', 'MIN', NULL, 823652),
  ('TXR - TX - V', '2026-09-26', 'Saturday', 'AWAY', 'MIN', NULL, 823653),
  ('TXR - TX - V', '2026-09-27', 'Sunday', 'AWAY', 'MIN', NULL, 823650)
ON CONFLICT (account_key, service_date) DO UPDATE
  SET day_type    = EXCLUDED.day_type,
      opponent    = EXCLUDED.opponent,
      game_pk     = EXCLUDED.game_pk,
      day_of_week = EXCLUDED.day_of_week
  WHERE sc_homestand_schedule.day_type = 'AWAY';
-- ON CONFLICT strategy:
--   Non-AWAY existing rows (GAME/PREP/OPEN/CLOSE/EXHIBITION) are PRESERVED
--   because the WHERE clause on the UPDATE only fires when target row is
--   already AWAY. A same-date collision against an existing PREP/CLOSE row
--   is a NO-OP (existing row wins). Kevin's PR body enumerates the ~35
--   PREP/CLOSE conflicts flagged for his review.
--   Re-running the migration self-heals AWAY-vs-AWAY (updates opponent / game_pk).

-- ── (2) HOME game_pk backfill ─────────────────────────────────────
-- Populates game_pk on existing HOME (day_type='GAME') rows only.
-- Never touches day_type or opponent - HOME rows were reconciled via
-- sc-12 PDF-as-truth and stay authoritative. This block is additive.
-- Uses a temp table to avoid a 324-row VALUES-list UPDATE that hits
-- PostgreSQL's parameter binding awkwardly.

CREATE TEMP TABLE tmp_sc13_home_gamepk (
  account_key  TEXT NOT NULL,
  service_date DATE NOT NULL,
  game_pk      BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_sc13_home_gamepk (account_key, service_date, game_pk) VALUES
  ('CIN - OH', '2026-03-26', 824541),
  ('CIN - OH', '2026-03-28', 824540),
  ('CIN - OH', '2026-03-29', 824538),
  ('CIN - OH', '2026-03-30', 824539),
  ('CIN - OH', '2026-03-31', 824537),
  ('CIN - OH', '2026-04-01', 824536),
  ('CIN - OH', '2026-04-10', 824534),
  ('CIN - OH', '2026-04-11', 824535),
  ('CIN - OH', '2026-04-12', 824533),
  ('CIN - OH', '2026-04-14', 824531),
  ('CIN - OH', '2026-04-15', 824532),
  ('CIN - OH', '2026-04-16', 824530),
  ('CIN - OH', '2026-04-24', 824529),
  ('CIN - OH', '2026-04-25', 824527),
  ('CIN - OH', '2026-04-26', 824528),
  ('CIN - OH', '2026-04-28', 824526),
  ('CIN - OH', '2026-04-29', 824525),
  ('CIN - OH', '2026-04-30', 824524),
  ('CIN - OH', '2026-05-08', 824522),
  ('CIN - OH', '2026-05-09', 824523),
  ('CIN - OH', '2026-05-10', 824520),
  ('CIN - OH', '2026-05-12', 824521),
  ('CIN - OH', '2026-05-13', 824519),
  ('CIN - OH', '2026-05-14', 824517),
  ('CIN - OH', '2026-05-22', 824518),
  ('CIN - OH', '2026-05-23', 824516),
  ('CIN - OH', '2026-05-24', 824514),
  ('CIN - OH', '2026-05-29', 824515),
  ('CIN - OH', '2026-05-30', 824513),
  ('CIN - OH', '2026-05-31', 824512),
  ('CIN - OH', '2026-06-01', 824510),
  ('CIN - OH', '2026-06-02', 824511),
  ('CIN - OH', '2026-06-03', 824509),
  ('CIN - OH', '2026-06-12', 824507),
  ('CIN - OH', '2026-06-13', 824508),
  ('CIN - OH', '2026-06-14', 824506),
  ('CIN - OH', '2026-06-15', 824505),
  ('CIN - OH', '2026-06-16', 824504),
  ('CIN - OH', '2026-06-17', 824503),
  ('CIN - OH', '2026-06-22', 824502),
  ('CIN - OH', '2026-06-23', 824501),
  ('CIN - OH', '2026-06-24', 824500),
  ('CIN - OH', '2026-07-03', 824498),
  ('CIN - OH', '2026-07-04', 824499),
  ('CIN - OH', '2026-07-05', 824497),
  ('CIN - OH', '2026-07-07', 824495),
  ('CIN - OH', '2026-07-08', 824496),
  ('CIN - OH', '2026-07-09', 824494),
  ('CIN - OH', '2026-07-10', 824493),
  ('CIN - OH', '2026-07-11', 824492),
  ('CIN - OH', '2026-07-12', 824491),
  ('CIN - OH', '2026-07-27', 824490),
  ('CIN - OH', '2026-07-28', 824489),
  ('CIN - OH', '2026-07-29', 824487),
  ('CIN - OH', '2026-07-30', 824488),
  ('CIN - OH', '2026-07-31', 824486),
  ('CIN - OH', '2026-08-01', 824485),
  ('CIN - OH', '2026-08-02', 824483),
  ('CIN - OH', '2026-08-04', 824484),
  ('CIN - OH', '2026-08-05', 824482),
  ('CIN - OH', '2026-08-06', 824481),
  ('CIN - OH', '2026-08-14', 824479),
  ('CIN - OH', '2026-08-15', 824480),
  ('CIN - OH', '2026-08-16', 824477),
  ('CIN - OH', '2026-08-17', 824478),
  ('CIN - OH', '2026-08-18', 824475),
  ('CIN - OH', '2026-08-19', 824476),
  ('CIN - OH', '2026-08-20', 824474),
  ('CIN - OH', '2026-08-31', 824473),
  ('CIN - OH', '2026-09-01', 824472),
  ('CIN - OH', '2026-09-02', 824470),
  ('CIN - OH', '2026-09-04', 824471),
  ('CIN - OH', '2026-09-05', 824468),
  ('CIN - OH', '2026-09-06', 824469),
  ('CIN - OH', '2026-09-14', 824465),
  ('CIN - OH', '2026-09-15', 824466),
  ('CIN - OH', '2026-09-16', 824467),
  ('CIN - OH', '2026-09-17', 824464),
  ('CIN - OH', '2026-09-18', 824463),
  ('CIN - OH', '2026-09-19', 824461),
  ('CIN - OH', '2026-09-20', 824462),
  ('STL - MO', '2026-03-26', 823081),
  ('STL - MO', '2026-03-28', 823082),
  ('STL - MO', '2026-03-29', 823079),
  ('STL - MO', '2026-03-30', 823080),
  ('STL - MO', '2026-03-31', 823077),
  ('STL - MO', '2026-04-01', 823078),
  ('STL - MO', '2026-04-10', 823076),
  ('STL - MO', '2026-04-11', 823074),
  ('STL - MO', '2026-04-12', 823075),
  ('STL - MO', '2026-04-13', 823073),
  ('STL - MO', '2026-04-14', 823072),
  ('STL - MO', '2026-04-15', 823071),
  ('STL - MO', '2026-04-24', 823069),
  ('STL - MO', '2026-04-25', 823070),
  ('STL - MO', '2026-04-26', 823068),
  ('STL - MO', '2026-05-01', 823066),
  ('STL - MO', '2026-05-02', 823067),
  ('STL - MO', '2026-05-03', 823065),
  ('STL - MO', '2026-05-04', 823064),
  ('STL - MO', '2026-05-05', 823062),
  ('STL - MO', '2026-05-06', 823063),
  ('STL - MO', '2026-05-15', 823061),
  ('STL - MO', '2026-05-16', 823060),
  ('STL - MO', '2026-05-17', 823058),
  ('STL - MO', '2026-05-19', 823059),
  ('STL - MO', '2026-05-20', 823057),
  ('STL - MO', '2026-05-21', 823056),
  ('STL - MO', '2026-05-29', 823055),
  ('STL - MO', '2026-05-30', 823054),
  ('STL - MO', '2026-05-31', 823053),
  ('STL - MO', '2026-06-01', 823050),
  ('STL - MO', '2026-06-02', 823052),
  ('STL - MO', '2026-06-03', 823051),
  ('STL - MO', '2026-06-05', 823049),
  ('STL - MO', '2026-06-06', 823048),
  ('STL - MO', '2026-06-07', 823047),
  ('STL - MO', '2026-06-15', 823046),
  ('STL - MO', '2026-06-16', 823045),
  ('STL - MO', '2026-06-17', 823044),
  ('STL - MO', '2026-06-22', 823040),
  ('STL - MO', '2026-06-23', 823043),
  ('STL - MO', '2026-06-24', 823041),
  ('STL - MO', '2026-06-25', 823042),
  ('STL - MO', '2026-06-26', 823039),
  ('STL - MO', '2026-06-27', 823038),
  ('STL - MO', '2026-06-28', 823037),
  ('STL - MO', '2026-07-06', 823036),
  ('STL - MO', '2026-07-07', 823035),
  ('STL - MO', '2026-07-08', 823032),
  ('STL - MO', '2026-07-09', 823034),
  ('STL - MO', '2026-07-10', 823033),
  ('STL - MO', '2026-07-11', 823030),
  ('STL - MO', '2026-07-12', 823029),
  ('STL - MO', '2026-07-24', 823031),
  ('STL - MO', '2026-07-25', 823027),
  ('STL - MO', '2026-07-26', 823028),
  ('STL - MO', '2026-07-27', 823025),
  ('STL - MO', '2026-07-28', 823026),
  ('STL - MO', '2026-07-29', 823022),
  ('STL - MO', '2026-07-30', 823023),
  ('STL - MO', '2026-08-07', 823024),
  ('STL - MO', '2026-08-08', 823021),
  ('STL - MO', '2026-08-09', 823020),
  ('STL - MO', '2026-08-10', 823018),
  ('STL - MO', '2026-08-11', 823019),
  ('STL - MO', '2026-08-12', 823017),
  ('STL - MO', '2026-08-25', 823016),
  ('STL - MO', '2026-08-26', 823015),
  ('STL - MO', '2026-08-27', 823014),
  ('STL - MO', '2026-08-28', 823013),
  ('STL - MO', '2026-08-29', 823011),
  ('STL - MO', '2026-08-30', 823010),
  ('STL - MO', '2026-09-11', 823012),
  ('STL - MO', '2026-09-12', 823009),
  ('STL - MO', '2026-09-13', 823008),
  ('STL - MO', '2026-09-14', 823006),
  ('STL - MO', '2026-09-15', 823007),
  ('STL - MO', '2026-09-16', 823004),
  ('STL - MO', '2026-09-18', 823005),
  ('STL - MO', '2026-09-19', 823003),
  ('STL - MO', '2026-09-20', 823001),
  ('TXR - TX - H', '2026-04-03', 822919),
  ('TXR - TX - H', '2026-04-04', 822920),
  ('TXR - TX - H', '2026-04-05', 822917),
  ('TXR - TX - H', '2026-04-06', 822918),
  ('TXR - TX - H', '2026-04-07', 822916),
  ('TXR - TX - H', '2026-04-08', 822915),
  ('TXR - TX - H', '2026-04-21', 822914),
  ('TXR - TX - H', '2026-04-22', 822913),
  ('TXR - TX - H', '2026-04-23', 822912),
  ('TXR - TX - H', '2026-04-24', 822909),
  ('TXR - TX - H', '2026-04-25', 822910),
  ('TXR - TX - H', '2026-04-26', 822911),
  ('TXR - TX - H', '2026-04-27', 822906),
  ('TXR - TX - H', '2026-04-28', 822908),
  ('TXR - TX - H', '2026-04-29', 822907),
  ('TXR - TX - H', '2026-05-08', 822904),
  ('TXR - TX - H', '2026-05-09', 822905),
  ('TXR - TX - H', '2026-05-10', 822902),
  ('TXR - TX - H', '2026-05-11', 822901),
  ('TXR - TX - H', '2026-05-12', 822903),
  ('TXR - TX - H', '2026-05-13', 822900),
  ('TXR - TX - H', '2026-05-25', 822899),
  ('TXR - TX - H', '2026-05-26', 822898),
  ('TXR - TX - H', '2026-05-27', 822897),
  ('TXR - TX - H', '2026-05-28', 822896),
  ('TXR - TX - H', '2026-05-29', 822894),
  ('TXR - TX - H', '2026-05-30', 822893),
  ('TXR - TX - H', '2026-05-31', 822895),
  ('TXR - TX - H', '2026-06-05', 822892),
  ('TXR - TX - H', '2026-06-06', 822891),
  ('TXR - TX - H', '2026-06-07', 822890),
  ('TXR - TX - H', '2026-06-15', 822887),
  ('TXR - TX - H', '2026-06-16', 822888),
  ('TXR - TX - H', '2026-06-18', 822889),
  ('TXR - TX - H', '2026-06-19', 822886),
  ('TXR - TX - H', '2026-06-20', 822885),
  ('TXR - TX - H', '2026-06-21', 822883),
  ('TXR - TX - H', '2026-07-02', 822884),
  ('TXR - TX - H', '2026-07-04', 822882),
  ('TXR - TX - H', '2026-07-05', 822879),
  ('TXR - TX - H', '2026-07-07', 822881),
  ('TXR - TX - H', '2026-07-08', 822880),
  ('TXR - TX - H', '2026-07-09', 822877),
  ('TXR - TX - H', '2026-07-10', 822878),
  ('TXR - TX - H', '2026-07-11', 822875),
  ('TXR - TX - H', '2026-07-12', 822876),
  ('TXR - TX - H', '2026-07-20', 822874),
  ('TXR - TX - H', '2026-07-21', 822871),
  ('TXR - TX - H', '2026-07-22', 822873),
  ('TXR - TX - H', '2026-07-24', 822872),
  ('TXR - TX - H', '2026-07-25', 822869),
  ('TXR - TX - H', '2026-07-26', 822870),
  ('TXR - TX - H', '2026-07-27', 822868),
  ('TXR - TX - H', '2026-08-03', 822867),
  ('TXR - TX - H', '2026-08-04', 822865),
  ('TXR - TX - H', '2026-08-05', 822866),
  ('TXR - TX - H', '2026-08-07', 822863),
  ('TXR - TX - H', '2026-08-08', 822864),
  ('TXR - TX - H', '2026-08-09', 822862),
  ('TXR - TX - H', '2026-08-18', 822859),
  ('TXR - TX - H', '2026-08-19', 822860),
  ('TXR - TX - H', '2026-08-20', 822861),
  ('TXR - TX - H', '2026-08-21', 822857),
  ('TXR - TX - H', '2026-08-22', 822858),
  ('TXR - TX - H', '2026-08-23', 822856),
  ('TXR - TX - H', '2026-08-31', 822855),
  ('TXR - TX - H', '2026-09-01', 822854),
  ('TXR - TX - H', '2026-09-02', 822851),
  ('TXR - TX - H', '2026-09-03', 822853),
  ('TXR - TX - H', '2026-09-04', 822852),
  ('TXR - TX - H', '2026-09-05', 822850),
  ('TXR - TX - H', '2026-09-06', 822848),
  ('TXR - TX - H', '2026-09-15', 822849),
  ('TXR - TX - H', '2026-09-16', 822846),
  ('TXR - TX - H', '2026-09-17', 822845),
  ('TXR - TX - H', '2026-09-18', 822847),
  ('TXR - TX - H', '2026-09-19', 822843),
  ('TXR - TX - H', '2026-09-20', 822844),
  ('TXR - TX - H', '2026-09-22', 822840),
  ('TXR - TX - H', '2026-09-23', 822841),
  ('TXR - TX - H', '2026-09-24', 822842),
  ('TXR - TX - V', '2026-04-03', 822919),
  ('TXR - TX - V', '2026-04-04', 822920),
  ('TXR - TX - V', '2026-04-05', 822917),
  ('TXR - TX - V', '2026-04-06', 822918),
  ('TXR - TX - V', '2026-04-07', 822916),
  ('TXR - TX - V', '2026-04-08', 822915),
  ('TXR - TX - V', '2026-04-21', 822914),
  ('TXR - TX - V', '2026-04-22', 822913),
  ('TXR - TX - V', '2026-04-23', 822912),
  ('TXR - TX - V', '2026-04-24', 822909),
  ('TXR - TX - V', '2026-04-25', 822910),
  ('TXR - TX - V', '2026-04-26', 822911),
  ('TXR - TX - V', '2026-04-27', 822906),
  ('TXR - TX - V', '2026-04-28', 822908),
  ('TXR - TX - V', '2026-04-29', 822907),
  ('TXR - TX - V', '2026-05-08', 822904),
  ('TXR - TX - V', '2026-05-09', 822905),
  ('TXR - TX - V', '2026-05-10', 822902),
  ('TXR - TX - V', '2026-05-11', 822901),
  ('TXR - TX - V', '2026-05-12', 822903),
  ('TXR - TX - V', '2026-05-13', 822900),
  ('TXR - TX - V', '2026-05-25', 822899),
  ('TXR - TX - V', '2026-05-26', 822898),
  ('TXR - TX - V', '2026-05-27', 822897),
  ('TXR - TX - V', '2026-05-28', 822896),
  ('TXR - TX - V', '2026-05-29', 822894),
  ('TXR - TX - V', '2026-05-30', 822893),
  ('TXR - TX - V', '2026-05-31', 822895),
  ('TXR - TX - V', '2026-06-05', 822892),
  ('TXR - TX - V', '2026-06-06', 822891),
  ('TXR - TX - V', '2026-06-07', 822890),
  ('TXR - TX - V', '2026-06-15', 822887),
  ('TXR - TX - V', '2026-06-16', 822888),
  ('TXR - TX - V', '2026-06-18', 822889),
  ('TXR - TX - V', '2026-06-19', 822886),
  ('TXR - TX - V', '2026-06-20', 822885),
  ('TXR - TX - V', '2026-06-21', 822883),
  ('TXR - TX - V', '2026-07-02', 822884),
  ('TXR - TX - V', '2026-07-04', 822882),
  ('TXR - TX - V', '2026-07-05', 822879),
  ('TXR - TX - V', '2026-07-07', 822881),
  ('TXR - TX - V', '2026-07-08', 822880),
  ('TXR - TX - V', '2026-07-09', 822877),
  ('TXR - TX - V', '2026-07-10', 822878),
  ('TXR - TX - V', '2026-07-11', 822875),
  ('TXR - TX - V', '2026-07-12', 822876),
  ('TXR - TX - V', '2026-07-20', 822874),
  ('TXR - TX - V', '2026-07-21', 822871),
  ('TXR - TX - V', '2026-07-22', 822873),
  ('TXR - TX - V', '2026-07-24', 822872),
  ('TXR - TX - V', '2026-07-25', 822869),
  ('TXR - TX - V', '2026-07-26', 822870),
  ('TXR - TX - V', '2026-07-27', 822868),
  ('TXR - TX - V', '2026-08-03', 822867),
  ('TXR - TX - V', '2026-08-04', 822865),
  ('TXR - TX - V', '2026-08-05', 822866),
  ('TXR - TX - V', '2026-08-07', 822863),
  ('TXR - TX - V', '2026-08-08', 822864),
  ('TXR - TX - V', '2026-08-09', 822862),
  ('TXR - TX - V', '2026-08-18', 822859),
  ('TXR - TX - V', '2026-08-19', 822860),
  ('TXR - TX - V', '2026-08-20', 822861),
  ('TXR - TX - V', '2026-08-21', 822857),
  ('TXR - TX - V', '2026-08-22', 822858),
  ('TXR - TX - V', '2026-08-23', 822856),
  ('TXR - TX - V', '2026-08-31', 822855),
  ('TXR - TX - V', '2026-09-01', 822854),
  ('TXR - TX - V', '2026-09-02', 822851),
  ('TXR - TX - V', '2026-09-03', 822853),
  ('TXR - TX - V', '2026-09-04', 822852),
  ('TXR - TX - V', '2026-09-05', 822850),
  ('TXR - TX - V', '2026-09-06', 822848),
  ('TXR - TX - V', '2026-09-15', 822849),
  ('TXR - TX - V', '2026-09-16', 822846),
  ('TXR - TX - V', '2026-09-17', 822845),
  ('TXR - TX - V', '2026-09-18', 822847),
  ('TXR - TX - V', '2026-09-19', 822843),
  ('TXR - TX - V', '2026-09-20', 822844),
  ('TXR - TX - V', '2026-09-22', 822840),
  ('TXR - TX - V', '2026-09-23', 822841),
  ('TXR - TX - V', '2026-09-24', 822842);

UPDATE sc_homestand_schedule s
   SET game_pk = t.game_pk
  FROM tmp_sc13_home_gamepk t
 WHERE s.account_key  = t.account_key
   AND s.service_date = t.service_date
   AND s.day_type     = 'GAME';
-- WHERE day_type='GAME' guard: never touches PREP/OPEN/CLOSE/EXHIBITION/AWAY.
-- Idempotent: re-running sets the same value.
-- Dates in tmp_sc13_home_gamepk that don't match an existing HOME row are
-- silently skipped (post-sc-12 all 81 should match; the CIN R3 flip landed
-- there, and API-vs-DB reconciled with 0 opponent mismatches).

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- POST-APPLY PROBES (commented; uncomment individually to run)
-- ═══════════════════════════════════════════════════════════════════
--
-- Probe A: row counts per (account, day_type) after apply
--
-- SELECT account_key, day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
--  GROUP BY account_key, day_type
--  ORDER BY account_key, day_type;
--
-- Expected (may differ by 1-3 in PREP if the AWAY-vs-PREP conflicts
-- resolved differently than expected - see PR body for enumeration):
--   CIN - OH     GAME=81, PREP=20, OPEN=2, CLOSE=2, AWAY=72
--                (72 = 81 API-away minus 9 conflicts that no-op'd)
--   STL - MO     GAME=81, PREP=16, OPEN=2, CLOSE=2, AWAY=75
--                (75 = 81 minus 6 conflicts)
--   TXR - TX - H GAME=81, PREP=17, OPEN=1, CLOSE=2, EXHIBITION=2, AWAY=71
--                (71 = 81 minus 10 conflicts)
--   TXR - TX - V GAME=81, PREP=17, OPEN=1, CLOSE=2, EXHIBITION=2, AWAY=71
--                (mirror of H)
--
--
-- Probe B: HOME game_pk backfill landed on every GAME row
--
-- SELECT account_key,
--        COUNT(*)                                    AS total_home,
--        COUNT(*) FILTER (WHERE game_pk IS NOT NULL) AS with_game_pk,
--        COUNT(*) FILTER (WHERE game_pk IS NULL)     AS missing_game_pk
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
--    AND day_type = 'GAME'
--  GROUP BY account_key
--  ORDER BY account_key;
--
-- Expected: total_home = with_game_pk = 81 for every account,
-- missing_game_pk = 0. If missing_game_pk > 0, the API date on a
-- HOME row didn't match DB (should not happen post-sc-12; investigate).
--
--
-- Probe C: TXR H/V AWAY parity (Q-d symmetric-diff on AWAY dates)
--
-- WITH h AS (
--   SELECT service_date FROM sc_homestand_schedule
--    WHERE account_key = 'TXR - TX - H' AND day_type = 'AWAY'
-- ),
-- v AS (
--   SELECT service_date FROM sc_homestand_schedule
--    WHERE account_key = 'TXR - TX - V' AND day_type = 'AWAY'
-- )
-- SELECT 'H-only' AS side, service_date FROM h
--   EXCEPT SELECT 'H-only', service_date FROM v
-- UNION ALL
-- SELECT 'V-only', service_date FROM v
--   EXCEPT SELECT 'V-only', service_date FROM h;
--
-- Expected: zero rows returned (H and V mirror).
--
--
-- Probe D: verify no HOME rows were mutated
--
-- SELECT account_key, day_type, opponent, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
--    AND day_type = 'GAME'
--  GROUP BY account_key, day_type, opponent
--  ORDER BY account_key, opponent;
--
-- Expected: matches the pre-sc-13 GAME opponent distribution.
--   (Kevin: eyeball against your sc-12 post-apply snapshot or the
--    hs_dump.csv used in the sc-13 feasibility doc.)
--
--
-- Probe E: game_pk uniqueness within account
--
-- SELECT account_key, game_pk, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE game_pk IS NOT NULL
--  GROUP BY account_key, game_pk
--  HAVING COUNT(*) > 1;
--
-- Expected: zero rows (the partial unique index prevents dupes, but
-- worth confirming empirically post-load).
