-- kpi-8b-attribution.sql
-- KPI PR 8b: attribute raw Rippling labor to accounts, WEEKS, employees, P&L lines.
--
-- Scope, in one sentence: turn raw Rippling time entries and pay segments
-- into per-employee, per-week, per-account labor dollars that the KPI
-- resolver can read.
--
-- Adds three tables + views on top of PR 8a + PR 8a-2:
--
--   rippling_department_map              department_id -> (account_key, pnl_line)
--   labor_actuals                        derived at (account, worker_id, week, line_code) grain
--   labor_actuals_latest                 DISTINCT ON view, N11 (latest by derived_at)
--   labor_unattributed                   segments that landed in the unattributed bucket
--
-- Grain change from earlier draft: WEEKLY + EMPLOYEE, not period.
-- Chefs manage labor week to week; the P&L is monthly-ish, but the
-- operating rhythm is weekly. Finest grain wins - you can always
-- aggregate up, never drill down. This also delivers "every account,
-- every employee, every hour, every dollar" directly rather than as
-- a later feature.
--
-- Week resolution: sc_day_metadata.week_label where the (account,
-- service_date) pair exists, ISO week where it does not. week_source
-- records which, so ISO fallbacks are visible not silent.
--
-- Design rules that come out of this branch's history:
--
-- 1. **Rippling department names do not reliably indicate the account.**
--    `Hourly Kitchen - 3100.1 - REDS` is `CIN - AZ` (Goodyear, 128/128
--    workers verified by work location), not `CIN - OH`. `REDS OH` is
--    Cincinnati. Both run concurrently from March 2026 forward. This is
--    not a rename cutover; it is two accounts sharing a name root
--    permanently. The map is many-to-one, keyed on `department_id`
--    (never on name), and legacy `department_id` values never get
--    removed - historical entries never migrate when a new department
--    is added. A future cleanup that removes "legacy" rows would
--    orphan labor history. See playbook D32.
--
-- 2. **Work location is the authority, the name is a hint.** Every
--    department entering the map is verified against the work-location
--    distribution of its workers, and `verified_at` records when.
--    Round 2 dump (2026-08-04) is the verification source for the
--    initial seed.
--
-- 3. **PR 8b produces `3100.1` only.** Every `3100.2` salary department
--    shows zero time entries, correctly - salaried staff do not punch a
--    clock. `3100.2` needs its own pipeline via `compensations.read`,
--    per worker, allocated by period. That is its own design with its
--    own access-control weight (playbook §8) and is not in this PR.
--
-- 4. **Unattributed is explicit, never silent.** Any segment whose
--    worker resolves to a department not in the map, or a container
--    department, or a worker not in rippling_raw_workers_latest, goes
--    to `labor_unattributed` with a distinct `reason_code`. Playbook N5.
--
-- 5. **`labor_actuals` is derived, not ingested.** It is computed from
--    the FOUR `_latest` views over rippling_raw_time_entries,
--    rippling_raw_pay_segments, rippling_raw_workers, and
--    rippling_raw_time_entry_zo, plus rippling_department_map and
--    sc_day_metadata. It never calls Rippling. When the map is
--    corrected - and it will be, because a `- REDS`-class discovery
--    can happen again - we re-derive rather than re-pull.
--
-- 6. **Amount comes from `estimated_amount` on the pay segment.**
--    Rippling computed it. We do not multiply hours by rate (playbook
--    D27). There is no pay-run endpoint and the derivation drifts on
--    overtime premiums, shift differentials, and retro adjustments.
--
-- 7. **OT rule** (matches the STL-MO verify): a segment is OT if
--    `overtime_multiplier > 1.0` OR `merged_earning_type_name` matches
--    /overtime|OT/i. Applied to `segment_duration_hours`. The
--    derivation module states this rule in its output; the labor page
--    states it in its footer.
--
-- 8. **Approval state is DOLLAR-ACCURATE now** (previous draft was wrong).
--
--    Earlier claim (STRICKEN 2026-08-06): "Segments only exist for
--    post-approval time entries, so segment dollars = approved+ by
--    construction." Disproved by measurement - 19 of 30 sampled DRAFT
--    entries have segments, 11 do not; one APPROVED entry from today
--    had no segment because Rippling computes on a lag. `amount`
--    includes some provisional dollars AND misses others; approval_state
--    now carries both facts, per status.
--
--    The join that makes this dollar-accurate:
--
--        pay_segment.time_entry.id   (36-char UUID)
--          -> time_entry_zo.id       (same UUID, direct match)
--        time_entry_zo.external_id   (24-char Mongo ObjectId)
--          -> time_entries.rippling_id (same ObjectId, direct match)
--
--    Verified end-to-end on 2026-08-05 with status agreement on 5 of 5
--    samples. Requires PR 8a-2's rippling_raw_time_entry_zo table.
--
--    Rejected alternative: worker-plus-date heuristic covered only
--    **40.8% of PAID entries** across the full 8,965-row set. Overnight
--    shifts, split shifts, and corrections collapse or double-count in
--    ways nothing in the data can distinguish. A heuristic is not a
--    join. Recording the number here so nobody re-invents the heuristic
--    in a year.
--
-- 9. **Contractor treatment.** All 14 employment-type=contractor workers
--    (measured 2026-08-05) have zero time entries and zero pay segments.
--    The labor pipeline never sees them, so they never appear in
--    labor_actuals. Two operational notes for record:
--      - CIN-KY contractor (69fdf5de...) has a Rippling compensation
--        record ($41,600/yr, $20/hr) but no clock-punch data. That
--        money exists in AP-side pay, not in 3100.1 or 3100.2.
--      - STL-MO contractor (69726cda..., "RD") sits on Cardinals salary
--        department. When 3100.2 gets its own compensations.read
--        pipeline, that worker's dollars will flow into STL-MO's salary
--        line via department attribution.
--
-- 10. **Arlington TXR parent (5e3ecbba...) is a container shared by
--     both TXR-TX-H and TXR-TX-V.** Its map entry assigns it to
--     TXR-TX-H by convention. `is_container = true` means it never
--     receives entries, so the assignment is effectively arbitrary;
--     stated explicitly rather than left as a semantic dissonance.
--
-- Applied: NOT YET (draft PR). Transactional; failure rolls back the
-- entire migration including the seed.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  -- PR 1 spine
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: kpi_lines missing - PR 1 spine must land first';
  END IF;
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: accounts table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM kpi_lines WHERE line_code = '3100.1') THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: kpi_lines has no row for 3100.1';
  END IF;
  -- PR 8a raw tables + views
  IF to_regclass('public.rippling_raw_time_entries_latest') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: rippling_raw_time_entries_latest missing - PR 8a must land first';
  END IF;
  IF to_regclass('public.rippling_raw_pay_segments_latest') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: rippling_raw_pay_segments_latest missing - PR 8a must land first';
  END IF;
  -- PR 8a-2 raw tables + views (workers + time_entry_zo)
  IF to_regclass('public.rippling_raw_workers') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: rippling_raw_workers missing - PR 8a-2 must land first';
  END IF;
  IF to_regclass('public.rippling_raw_workers_latest') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: rippling_raw_workers_latest missing - PR 8a-2 must land first';
  END IF;
  IF to_regclass('public.rippling_raw_time_entry_zo') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: rippling_raw_time_entry_zo missing - PR 8a-2 must land first';
  END IF;
  IF to_regclass('public.rippling_raw_time_entry_zo_latest') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: rippling_raw_time_entry_zo_latest missing - PR 8a-2 must land first';
  END IF;
  -- sc_day_metadata for week resolution
  IF to_regclass('public.sc_day_metadata') IS NULL THEN
    RAISE EXCEPTION 'kpi-8b pre-flight: sc_day_metadata missing';
  END IF;
END $$;

-- ─── rippling_department_map ────────────────────────────────────────
-- The single source of truth for department -> account attribution.
-- Keyed on department_id, never on the name. Names carry typos and
-- can be actively misleading about the account (`- REDS` = CIN - AZ).
--
-- Many-to-one and permanent. Legacy department_id values never removed
-- (historical entries never migrate).
--
-- `is_container = true` marks parent departments with zero workers.
-- They map to an account for completeness but should never receive
-- entries. Post-flight of the derivation asserts that.
--
-- `verified_at` is the date the work-location cross-check was last run
-- against the department. Initial seed = 2026-08-04, the Round 2 dump.
CREATE TABLE IF NOT EXISTS rippling_department_map (
  department_id   TEXT        PRIMARY KEY,
  department_name TEXT        NOT NULL,
  account_key     TEXT        NOT NULL REFERENCES accounts(team_key),
  pnl_line        TEXT        REFERENCES kpi_lines(line_code),
  is_container    BOOLEAN     NOT NULL DEFAULT false,
  verified_at     DATE        NOT NULL,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS rippling_department_map_account_idx
  ON rippling_department_map (account_key);

-- ─── Seed the map (Round 2 verification, 2026-08-04) ────────────────
INSERT INTO rippling_department_map (department_id, department_name, account_key, pnl_line, is_container, verified_at, notes) VALUES
-- CIN - AZ (Goodyear)
('601d80ea2aca9a5fef7617fa', 'Goodyear Reds',                                 'CIN - AZ',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('601d817448f7105e4c3d5f49', 'Hourly Kitchen - 3100.1 - REDS',                'CIN - AZ',     '3100.1', false, '2026-08-04', 'D32: name-misleading. 128/128 workers at Goodyear, AZ - NOT Cincinnati'),
('601d818b2ab2cef76f0d62f7', 'Salary Wages - 3100.2 - REDS',                  'CIN - AZ',     '3100.2', false, '2026-08-04', '11/11 workers at Goodyear, AZ. Salary line - 0 entries expected'),
-- CIN - OH (Cincinnati)
('66a3b85f0b7d0b40d36acc2f', 'Cincinnati Reds',                               'CIN - OH',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('66a3b8c92d818718345ff854', 'Hourly Kitchen - 3100.1 - REDS OH',             'CIN - OH',     '3100.1', false, '2026-08-04', '16/16 workers at Cincinnati, OH. Created March 2026'),
('676a00efeb1828eb5fc829b6', 'Salary Wages - 3100.2 REDS OH',                 'CIN - OH',     '3100.2', false, '2026-08-04', '1/1 worker at Cincinnati, OH. Salary line - 0 entries expected'),
-- CIN - KY (Louisville) - D26 single-salaried account
('65dcfcbd44398f188b75e20c', 'Louisville  Bats',                              'CIN - KY',     NULL,     true,  '2026-08-04', 'container parent (double-space in name). 1 contractor sits here with $41,600 Rippling comp; contractor has 0 labor data, not in scope'),
('65dcfcd6726b559b2db5c0e9', 'Salary Wages - 3100.2 - Bats',                  'CIN - KY',     '3100.2', false, '2026-08-04', 'D26: single salaried Executive Chef'),
-- STL - FL (Jupiter)
('69179d2b52f92c170ac0d29c', 'Jupiter Cardinals',                             'STL - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('69612c8272453bb48d0416a1', 'Hourly Kitchen - 3100.1 - Jupiter',             'STL - FL',     '3100.1', false, '2026-08-04', '26/26 workers at Jupiter, FL'),
('69612c8372453bb48d0416b4', 'Salary Wages - 3100.2 - Jupiter',               'STL - FL',     '3100.2', false, '2026-08-04', '4/4 workers at Jupiter, FL'),
-- STL - MO (St. Louis)
('67a3caba7a2ec09203ff3895', 'St. Louis Cardinals',                           'STL - MO',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('67a3cabe7a2ec09203ff38a4', 'Hourly Kitchen - 3100.1 - Cardinals',           'STL - MO',     '3100.1', false, '2026-08-04', '23/23 workers at St. Louis, MO. Contains Cardinals but NOT Jupiter - disambiguator'),
('67a3cac07a2ec09203ff38ac', 'Salary Wages - 3100.2 - Cardinals',             'STL - MO',     '3100.2', false, '2026-08-04', '6/6 workers at St. Louis, MO. Includes 1 contractor RD - when 3100.2 pipeline builds, that flows into STL-MO salary via department attribution'),
-- TBJ - FL (Dunedin)
('5c2cf3cc92dabb2b61fd9411', 'Dunedin TBJ',                                   'TBJ - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5c338b256ab9e2451298d7b5', 'Hourly Kitchen - 3100.1 - TBJ',                 'TBJ - FL',     '3100.1', false, '2026-08-04', '181/181 workers at Dunedin, FL'),
('5c338b1fc59291794dc6daee', 'Salary Wages - 3100.2 - TBJ',                   'TBJ - FL',     '3100.2', false, '2026-08-04', '14/15 workers at Dunedin, FL (1 HQ Chicago outlier)'),
-- TBJ - NY (Buffalo) - D26 single-salaried
('5e40c83c5a8f4e2ad22c4bf7', 'Buffalo NY',                                    'TBJ - NY',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5f2178a412365002972c65ea', 'Hourly Kitchen - 3100.1 - BUF',                 'TBJ - NY',     '3100.1', false, '2026-08-04', '12 workers all TERMINATED 2020-21; Rippling does not strip department_id on termination. D26 holds - no active hourly'),
('5e40c8d2b0974e0f7fc79a6a', 'Salary Wages - 3100.2 - BUF',                   'TBJ - NY',     '3100.2', false, '2026-08-04', '7/7 workers at Buffalo, NY'),
-- TBR - FL (Port Charlotte / Englewood)
('5fd0ff740f3ad600d0424614', 'Port Charlotte TBR',                            'TBR - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5fd0ffb21cbc9d00293c4eca', 'Hourly Kitchen - 3100.1 - TBR',                 'TBR - FL',     '3100.1', false, '2026-08-04', '183/183 workers at single work_location covering Englewood + Port Charlotte'),
('5fd0ffbef75c1200ce81bc69', 'Salary Wages - 3100.2 - TBR',                   'TBR - FL',     '3100.2', false, '2026-08-04', '9/9 workers at the combined TBR-FL work_location'),
-- TXR - AZ (Surprise)
('61bba390891bcdcd7caf8103', 'Surprise TXR',                                  'TXR - AZ',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('61bba40f9876bd62d74ab5f9', 'Hourly Kitchen - 3100.1 TXR-AZ',                'TXR - AZ',     '3100.1', false, '2026-08-04', '81/81 workers at Surprise, AZ'),
('61bba432d48aba5eefbc27ee', 'Salary Wages - 3100.2 TXR-AZ',                  'TXR - AZ',     '3100.2', false, '2026-08-04', '3/3 workers at Surprise, AZ'),
-- TXR - TX - H (Arlington Home)
('5e3ecbba5a8f4e251b754611', 'Arlington TXR',                                 'TXR - TX - H', NULL,     true,  '2026-08-04', 'container parent shared with V - is_container=true means it never receives entries so the H assignment is arbitrary; stated explicitly'),
('5e3eccebb0974e16af6f8c16', 'Hourly Kitchen - 3100.1 - TXR - Home Side',     'TXR - TX - H', '3100.1', false, '2026-08-04', '78/79 workers at Arlington TX Home; 1 on deleted work_location 5c05aaae (logged, non-blocking)'),
('5e3ecce18a9f4e38d515fd9c', 'Salary Wages - 3100.2 - TXR - Home Side',       'TXR - TX - H', '3100.2', false, '2026-08-04', '15/17 workers at Arlington TX Home; 1 at Buffalo NY, 1 at HQ Chicago (logged, non-blocking)'),
-- TXR - TX - V (Arlington Visiting)
('65c402509aa26127a1e29f22', 'Hourly Kitchen - 3100.1 - TXR- Visiting Side',  'TXR - TX - V', '3100.1', false, '2026-08-04', 'typo in name (missing space). 12 workers - clock discipline CLOSED 2026-08-06 per Kevin (three Rippling structures agree). 4 workers on Arlington HOME work_location all TERMINATED, cleanup only'),
('65c4024887a5e2437fcccc32', 'Salary Wages - 3100.2 - TXR- Visiting Side',    'TXR - TX - V', '3100.2', false, '2026-08-04', '2/2 workers at Arlington TX Visitor'),
-- CORP (D17 out of scope for client P&Ls)
('5c4a125c6ab9e21dcc288ad8', 'PFS',                                           'CORP',         NULL,     true,  '2026-08-04', 'root container for all client account trees. 0 workers'),
('5c140b612962480ef6366027', 'Corporate',                                     'CORP',         NULL,     true,  '2026-08-04', 'root container, 0 workers'),
('5c338b0a296248677c0a26db', '5004.1 - CORP CEO',                             'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c2cfbbc296248319461af77', '5004.2 - CORP FINANCE',                         'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c338afbc592917819e89219', '5004.6 - CORP HR',                              'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c338d8d92dabb3a580c611f', '5004.7 CORP OPS/ACCT MGMT/SALES',               'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c2cfbc16ab9e23aa196c5ac', '5004.4 - Marketing Wages',                      'CORP',         NULL,     false, '2026-08-04', 'CORP - 4 TERMINATED workers at HQ Chicago, likely dormant');

-- ─── labor_actuals (weekly + employee grain, derived) ───────────────
-- One row per (account, worker, week, line_code) per derivation run.
-- Append-only with source_run distinguishing runs. `_latest` view
-- resolves the current values by derived_at DESC (N11: never row order).
--
-- Weekly grain: sc_day_metadata.week_label preferred; ISO week fallback
-- where the (account, service_date) pair is absent. week_source
-- records which, so ISO fallbacks are visible.
--
-- period_no NULLABLE on purpose. periodForDate returns null outside
-- the fiscal-year window and FY2026_END is provisional pending Joe.
-- A null period must NOT suppress the weekly row - the weekly figure
-- is still true and useful.
--
-- worker_id ONLY. No names, no rates, no pay grades in this table.
-- Consumers resolve display names at render from rippling_raw_workers_latest.
--
-- Approval state is dollar-accurate now (see header note 8). JSONB
-- shape per status - see comment on approval_state below.
CREATE TABLE IF NOT EXISTS labor_actuals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL REFERENCES accounts(team_key),
  worker_id       TEXT NOT NULL,
  week_label      TEXT NOT NULL,
  week_start      DATE NOT NULL,
  week_end        DATE NOT NULL,
  fiscal_year     INTEGER NOT NULL,
  period_no       INTEGER,
  line_code       TEXT NOT NULL REFERENCES kpi_lines(line_code),
  amount          NUMERIC(14,2) NOT NULL,
  hours_regular   NUMERIC(10,2),
  hours_overtime  NUMERIC(10,2),
  segment_count   INTEGER NOT NULL,
  entry_count     INTEGER NOT NULL,
  approval_state  JSONB NOT NULL,
  week_source     TEXT NOT NULL CHECK (week_source IN ('sc_day_metadata', 'iso_fallback')),
  derived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_run      TEXT NOT NULL
);

-- approval_state JSONB shape per status:
--   "STATUS": {
--     "entries": N,                  count of REST time_entries in bucket with this status
--     "dollars": D,                  sum of pay_segment.estimated_amount for those entries (via zo hop)
--     "entries_without_segments": N, count of entries in bucket with no matching pay_segment
--     "hours_without_segments": H    sum of zo.duration_hours for those (measured, not estimated - D27)
--   }
-- Every status present even at zero (N2: missing key and zero differ).

CREATE INDEX IF NOT EXISTS labor_actuals_latest_idx
  ON labor_actuals (account_key, worker_id, week_label, line_code, derived_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS labor_actuals_derived_at_idx
  ON labor_actuals (derived_at DESC);

CREATE INDEX IF NOT EXISTS labor_actuals_week_range_idx
  ON labor_actuals (account_key, week_start, week_end);

CREATE OR REPLACE VIEW labor_actuals_latest AS
  SELECT DISTINCT ON (account_key, worker_id, week_label, line_code)
    id, account_key, worker_id, week_label, week_start, week_end,
    fiscal_year, period_no, line_code,
    amount, hours_regular, hours_overtime,
    segment_count, entry_count, approval_state,
    week_source, derived_at, source_run
  FROM labor_actuals
  ORDER BY account_key, worker_id, week_label, line_code, derived_at DESC, id DESC;

-- ─── labor_unattributed ─────────────────────────────────────────────
-- Non-negotiable per N5: any pay_segment whose worker resolves to a
-- department not in the map, a container department, or an unknown
-- worker goes here with a distinct reason_code.
--
-- A probe that reports "$8,000 unattributed across 2 unknown
-- departments" is working correctly. A probe that reports a clean
-- number while quietly dropping those segments is the failure this
-- whole project exists to prevent.
CREATE TABLE IF NOT EXISTS labor_unattributed (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reason_code     TEXT NOT NULL CHECK (reason_code IN ('unknown_department', 'container_leak', 'null_period', 'no_worker_department', 'unknown_worker')),
  department_id   TEXT,
  department_name TEXT,
  worker_id       TEXT,
  segment_date    DATE,
  amount          NUMERIC(14,2),
  hours           NUMERIC(10,2),
  segment_count   INTEGER NOT NULL,
  derived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_run      TEXT NOT NULL,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS labor_unattributed_reason_idx
  ON labor_unattributed (reason_code, derived_at DESC);

CREATE INDEX IF NOT EXISTS labor_unattributed_derived_at_idx
  ON labor_unattributed (derived_at DESC);

-- ─── Grants ─────────────────────────────────────────────────────────
-- rippling_department_map: SELECT only for service_role. Seed lands in
-- this migration. Future updates come via new migrations.
GRANT SELECT ON rippling_department_map TO service_role;

-- labor_actuals: SELECT for the resolver, INSERT for the derivation
-- script. No UPDATE / no DELETE - append-only, latest-wins via view.
GRANT SELECT, INSERT ON labor_actuals             TO service_role;
GRANT SELECT         ON labor_actuals_latest      TO service_role;

-- labor_unattributed: same pattern.
GRANT SELECT, INSERT ON labor_unattributed        TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  seed_count INTEGER;
  reds_az    TEXT;
  la_sel BOOLEAN; la_ins BOOLEAN; la_upd BOOLEAN; la_del BOOLEAN;
  un_sel BOOLEAN; un_ins BOOLEAN; un_upd BOOLEAN; un_del BOOLEAN;
  dm_sel BOOLEAN; dm_ins BOOLEAN; dm_upd BOOLEAN; dm_del BOOLEAN;
BEGIN
  -- Structure: all new tables + views exist
  IF to_regclass('public.rippling_department_map')       IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_department_map missing'; END IF;
  IF to_regclass('public.labor_actuals')                 IS NULL THEN RAISE EXCEPTION 'post-flight: labor_actuals missing'; END IF;
  IF to_regclass('public.labor_actuals_latest')          IS NULL THEN RAISE EXCEPTION 'post-flight: labor_actuals_latest missing'; END IF;
  IF to_regclass('public.labor_unattributed')            IS NULL THEN RAISE EXCEPTION 'post-flight: labor_unattributed missing'; END IF;

  -- Seed row count exactly 38 (Round 2 dump)
  SELECT COUNT(*) INTO seed_count FROM rippling_department_map;
  IF seed_count <> 38 THEN
    RAISE EXCEPTION 'post-flight: rippling_department_map has % rows, expected 38 (Round 2 dump)', seed_count;
  END IF;

  -- Regression guard for the D32 correction: `- REDS` (the naked one,
  -- id 601d817448f7105e4c3d5f49) MUST resolve to CIN - AZ.
  SELECT account_key INTO reds_az
  FROM rippling_department_map
  WHERE department_id = '601d817448f7105e4c3d5f49';
  IF reds_az IS NULL THEN
    RAISE EXCEPTION 'post-flight: department 601d817448f7105e4c3d5f49 (Hourly Kitchen - 3100.1 - REDS) missing from seed';
  END IF;
  IF reds_az <> 'CIN - AZ' THEN
    RAISE EXCEPTION 'post-flight: department 601d817448f7105e4c3d5f49 (- REDS) resolves to %, expected CIN - AZ. D32 regression', reds_az;
  END IF;

  -- department_map: SELECT only (no writes at runtime; seed is the write)
  dm_sel := has_table_privilege('service_role', 'rippling_department_map', 'SELECT');
  dm_ins := has_table_privilege('service_role', 'rippling_department_map', 'INSERT');
  dm_upd := has_table_privilege('service_role', 'rippling_department_map', 'UPDATE');
  dm_del := has_table_privilege('service_role', 'rippling_department_map', 'DELETE');
  IF NOT dm_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_department_map'; END IF;
  IF dm_ins     THEN RAISE EXCEPTION 'post-flight: service_role has INSERT on rippling_department_map (map updates should be new migrations)'; END IF;
  IF dm_upd     THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_department_map'; END IF;
  IF dm_del     THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_department_map'; END IF;

  -- labor_actuals: SELECT + INSERT for derivation, no UPDATE / DELETE
  la_sel := has_table_privilege('service_role', 'labor_actuals', 'SELECT');
  la_ins := has_table_privilege('service_role', 'labor_actuals', 'INSERT');
  la_upd := has_table_privilege('service_role', 'labor_actuals', 'UPDATE');
  la_del := has_table_privilege('service_role', 'labor_actuals', 'DELETE');
  IF NOT la_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on labor_actuals'; END IF;
  IF NOT la_ins THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on labor_actuals'; END IF;
  IF la_upd     THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on labor_actuals (must be append-only)'; END IF;
  IF la_del     THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on labor_actuals (must be append-only)'; END IF;
  IF NOT has_table_privilege('service_role', 'labor_actuals_latest', 'SELECT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on labor_actuals_latest';
  END IF;

  -- labor_unattributed: same pattern
  un_sel := has_table_privilege('service_role', 'labor_unattributed', 'SELECT');
  un_ins := has_table_privilege('service_role', 'labor_unattributed', 'INSERT');
  un_upd := has_table_privilege('service_role', 'labor_unattributed', 'UPDATE');
  un_del := has_table_privilege('service_role', 'labor_unattributed', 'DELETE');
  IF NOT un_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on labor_unattributed'; END IF;
  IF NOT un_ins THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on labor_unattributed'; END IF;
  IF un_upd     THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on labor_unattributed (must be append-only)'; END IF;
  IF un_del     THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on labor_unattributed (must be append-only)'; END IF;

  RAISE NOTICE 'kpi-8b post-flight PASS - tables/views/seed present, grants correct, D32 regression guard held';
END $$;

COMMIT;
