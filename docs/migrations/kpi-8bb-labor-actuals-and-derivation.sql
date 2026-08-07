-- kpi-8bb-labor-actuals-and-derivation.sql
--
-- KPI PR 8b - part B1: labor_actuals + labor_unattributed +
-- rippling_department_map + atomic per-account swap RPC.
--
-- Consumes what PR A / kpi-8ba landed (rippling_current_presence,
-- rippling_walks, earning_type_map, earning_type_unmapped) and turns
-- raw Rippling rows into a per-worker weekly labor table.
--
-- Motivation, from four probe rounds, four paystub reconciliations,
-- and Gates 1-4 on PR A:
--
-- 1. `_latest` sums retired IDs. Presence is the projection that filters
--    them. This PR's derivation is the first consumer of that projection.
--    Measured PR A apply: `_latest` reports $843,065 against a true
--    $717,486 (17.5% over truth). Presence-filtered gets the right number.
--
-- 2. The prior draft on feat/kpi-8b-attribution read hours from
--    `zo.duration_hours`, which is null once ZO is pruned - exactly the
--    case where "hours we know about with no dollars" needed to emit
--    non-zero. Round 2 P2.2 measured 42,036.81 hours across 1,090 buckets
--    (38% of everything the derivation would emit) rescued by reading
--    `time_entry_summary.duration` from the REST time entry instead.
--
-- 3. The draft classified by `overtime_multiplier` which is null on
--    every non-OT type including Holiday Double Rate ($37,758
--    misfiled as regular). `earning_type_map` is the durable fix; this
--    derivation left-joins against it.
--
-- 4. `coverage_state` is the honest gap column. Weeks with entries but
--    no live pay-segments emit `hours_only`, not `0`. Weeks with no
--    entries at all emit no row (absence is the fifth state; it is not
--    a value). Weeks after a stale presence walk (>54h) emit `unknown`
--    for every row until the next successful walk lands. That last one
--    is the failure mode nothing else catches: a walk that fails
--    plausibility keeps the previous presence set, which then looks
--    identical to fresh. Age-gating turns that silence into a `unknown`
--    state per D36.
--
-- Design decisions committed in playbook v0.7 that constrain this:
--
--   D24 - department_id is the attribution key, never department_name
--   D26 - CIN-KY / TBJ-NY are salaried-only (excluded from hourly)
--   D27 - never compute labor as hours times rate
--   D32 - `- REDS` (601d817448f7105e4c3d5f49) is CIN-AZ, not CIN-OH
--   D33 - 3100.1 is gross wages; employer burden is 5004.9 (invisible)
--   D34 - bonus and PTO are gross wages structurally invisible to us
--   D36 - presence filters; orphans surface as coverage gaps
--   D37 - earning types resolve through earning_type_map only
--   D38 - full re-derive nightly (upsert-on-grain; RPC does atomic swap)
--   N2  - missing, failed, and zero are distinct states
--   N5  - unattributed labor must be visible, never silently zero
--   N11 - never rely on row order; order explicitly
--
-- This PR:
--   - Adds rippling_department_map (seeded, 38 rows) + labor_actuals +
--     labor_unattributed + the atomic per-account swap RPC.
--   - Does NOT build the /kpi/labor page. That is PR B2, governed by
--     docs/KPI_DASHBOARD_DESIGN_SPEC.md which lands in this PR as docs.
--   - Does NOT touch existing sync behaviour. The derivation is a new
--     workflow step, appended after the sync.
--
-- Applied: NOT YET (PR under review). Transactional; failure rolls
-- back the entire migration.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  -- PR A tables must be present. The derivation reads from all of them.
  IF to_regclass('public.rippling_current_presence') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bb pre-flight: rippling_current_presence missing - kpi-8ba (PR A) must land first';
  END IF;
  IF to_regclass('public.rippling_walks') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bb pre-flight: rippling_walks missing - kpi-8ba (PR A) must land first';
  END IF;
  IF to_regclass('public.earning_type_map') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bb pre-flight: earning_type_map missing - kpi-8ba (PR A) must land first';
  END IF;
  IF to_regclass('public.earning_type_unmapped') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bb pre-flight: earning_type_unmapped missing - kpi-8ba (PR A) must land first';
  END IF;
  -- Spine tables must be present (kpi-1)
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bb pre-flight: accounts missing - kpi-1 must be applied';
  END IF;
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bb pre-flight: kpi_lines missing - kpi-1 must be applied';
  END IF;
END $$;

-- ─── rippling_department_map ────────────────────────────────────────
-- Keyed on department_id, never on the name (D24). Names carry typos
-- and can be actively misleading about the account (D32: - REDS is
-- CIN-AZ, not CIN-OH).
--
-- Many-to-one and permanent. Legacy department_ids stay in the map
-- forever - terminated workers retain their department_id and their
-- old segments still need attribution.
--
-- is_container = true marks parent departments that never receive
-- entries. Mapped for completeness so the resolver has a landing
-- account even for accidental parent-department segments; the
-- derivation asserts is_container departments never actually receive
-- pay-segments and routes any that do to labor_unattributed with
-- reason_code = 'container_leak'.
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

-- Seed (Round 2 dump, 2026-08-04). Preserved verbatim from
-- feat/kpi-8b-attribution draft - not re-verified in this PR.
INSERT INTO rippling_department_map (department_id, department_name, account_key, pnl_line, is_container, verified_at, notes) VALUES
-- CIN - AZ (Goodyear)
('601d80ea2aca9a5fef7617fa', 'Goodyear Reds',                                 'CIN - AZ',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('601d817448f7105e4c3d5f49', 'Hourly Kitchen - 3100.1 - REDS',                'CIN - AZ',     '3100.1', false, '2026-08-04', 'D32: name-misleading. 128/128 workers at Goodyear, AZ - NOT Cincinnati'),
('601d818b2ab2cef76f0d62f7', 'Salary Wages - 3100.2 - REDS',                  'CIN - AZ',     '3100.2', false, '2026-08-04', '11/11 workers at Goodyear, AZ. Salary line - 0 entries expected'),
-- CIN - OH (Cincinnati)
('66a3b85f0b7d0b40d36acc2f', 'Cincinnati Reds',                               'CIN - OH',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('66a3b8c92d818718345ff854', 'Hourly Kitchen - 3100.1 - REDS OH',             'CIN - OH',     '3100.1', false, '2026-08-04', '16/16 workers at Cincinnati, OH. Created March 2026'),
('676a00efeb1828eb5fc829b6', 'Salary Wages - 3100.2 REDS OH',                 'CIN - OH',     '3100.2', false, '2026-08-04', '1/1 worker at Cincinnati, OH. Salary line - 0 entries expected'),
-- CIN - KY (Louisville) - D26 single-salaried
('65dcfcbd44398f188b75e20c', 'Louisville  Bats',                              'CIN - KY',     NULL,     true,  '2026-08-04', 'container parent (double-space in name). 1 contractor sits here with $41,600 Rippling comp; contractor has 0 labor data, not in scope'),
('65dcfcd6726b559b2db5c0e9', 'Salary Wages - 3100.2 - Bats',                  'CIN - KY',     '3100.2', false, '2026-08-04', 'D26: single salaried Executive Chef'),
-- STL - FL (Jupiter)
('69179d2b52f92c170ac0d29c', 'Jupiter Cardinals',                             'STL - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('69612c8272453bb48d0416a1', 'Hourly Kitchen - 3100.1 - Jupiter',             'STL - FL',     '3100.1', false, '2026-08-04', '26/26 workers at Jupiter, FL'),
('69612c8372453bb48d0416b4', 'Salary Wages - 3100.2 - Jupiter',               'STL - FL',     '3100.2', false, '2026-08-04', '4/4 workers at Jupiter, FL'),
-- STL - MO (St. Louis)
('67a3caba7a2ec09203ff3895', 'St. Louis Cardinals',                           'STL - MO',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('67a3cabe7a2ec09203ff38a4', 'Hourly Kitchen - 3100.1 - Cardinals',           'STL - MO',     '3100.1', false, '2026-08-04', '23/23 workers at St. Louis, MO. Contains Cardinals but NOT Jupiter - disambiguator'),
('67a3cac07a2ec09203ff38ac', 'Salary Wages - 3100.2 - Cardinals',             'STL - MO',     '3100.2', false, '2026-08-04', '6/6 workers at St. Louis, MO. Includes 1 contractor RD'),
-- TBJ - FL (Dunedin)
('5c2cf3cc92dabb2b61fd9411', 'Dunedin TBJ',                                   'TBJ - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5c338b256ab9e2451298d7b5', 'Hourly Kitchen - 3100.1 - TBJ',                 'TBJ - FL',     '3100.1', false, '2026-08-04', '181/181 workers at Dunedin, FL'),
('5c338b1fc59291794dc6daee', 'Salary Wages - 3100.2 - TBJ',                   'TBJ - FL',     '3100.2', false, '2026-08-04', '14/15 workers at Dunedin, FL (1 HQ Chicago outlier)'),
-- TBJ - NY (Buffalo) - D26 single-salaried
('5e40c83c5a8f4e2ad22c4bf7', 'Buffalo NY',                                    'TBJ - NY',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5f2178a412365002972c65ea', 'Hourly Kitchen - 3100.1 - BUF',                 'TBJ - NY',     '3100.1', false, '2026-08-04', '12 workers all TERMINATED 2020-21; D26 holds - no active hourly'),
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
('5e3ecbba5a8f4e251b754611', 'Arlington TXR',                                 'TXR - TX - H', NULL,     true,  '2026-08-04', 'container parent shared with V'),
('5e3eccebb0974e16af6f8c16', 'Hourly Kitchen - 3100.1 - TXR - Home Side',     'TXR - TX - H', '3100.1', false, '2026-08-04', '78/79 workers at Arlington TX Home'),
('5e3ecce18a9f4e38d515fd9c', 'Salary Wages - 3100.2 - TXR - Home Side',       'TXR - TX - H', '3100.2', false, '2026-08-04', '15/17 workers at Arlington TX Home'),
-- TXR - TX - V (Arlington Visiting)
('65c402509aa26127a1e29f22', 'Hourly Kitchen - 3100.1 - TXR- Visiting Side',  'TXR - TX - V', '3100.1', false, '2026-08-04', 'typo in name; 12 workers - clock discipline CLOSED 2026-08-06'),
('65c4024887a5e2437fcccc32', 'Salary Wages - 3100.2 - TXR- Visiting Side',    'TXR - TX - V', '3100.2', false, '2026-08-04', '2/2 workers at Arlington TX Visitor'),
-- CORP (D17 out of scope for client P&Ls)
('5c4a125c6ab9e21dcc288ad8', 'PFS',                                           'CORP',         NULL,     true,  '2026-08-04', 'root container for all client account trees'),
('5c140b612962480ef6366027', 'Corporate',                                     'CORP',         NULL,     true,  '2026-08-04', 'root container'),
('5c338b0a296248677c0a26db', '5004.1 - CORP CEO',                             'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c2cfbbc296248319461af77', '5004.2 - CORP FINANCE',                         'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c338afbc592917819e89219', '5004.6 - CORP HR',                              'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c338d8d92dabb3a580c611f', '5004.7 CORP OPS/ACCT MGMT/SALES',               'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c2cfbc16ab9e23aa196c5ac', '5004.4 - Marketing Wages',                      'CORP',         NULL,     false, '2026-08-04', 'CORP - 4 TERMINATED workers at HQ Chicago')
ON CONFLICT (department_id) DO NOTHING;

-- ─── labor_actuals ───────────────────────────────────────────────────
-- Grain: (account_key, worker_id, week_label, line_code). Upserted on
-- that PK by the derivation's per-account atomic swap - D38's full
-- re-derive is nightly overwrite, not accumulation.
--
-- Hours split four ways by pay-rate bucket, dollars split the same
-- four ways. `amount` is the surfaces-quote total. `hours_without_dollars`
-- is a SEPARATE column, not a fifth bucket: those hours have no known
-- rate class (D27 forbids inferring one), so they never fold into any
-- bucket and never into `amount`.
--
-- `hours_toward_ot_threshold` is NOT stored. Derived at read time as
-- hours_regular + hours_double_time - Holiday hours count toward the
-- weekly 40 (measured R3 P6.2). Storing it invites the two to drift.
--
-- coverage_state pins four values; a week where nobody worked emits
-- NO ROW (absence is the fifth state, not a stored value).
CREATE TABLE IF NOT EXISTS labor_actuals (
  account_key            TEXT           NOT NULL REFERENCES accounts(team_key),
  worker_id              TEXT           NOT NULL,
  week_label             TEXT           NOT NULL,
  line_code              TEXT           NOT NULL REFERENCES kpi_lines(line_code),
  -- hour buckets (rate-class split per D37)
  hours_regular          NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_overtime         NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_double_time      NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_premium_other    NUMERIC(10,2)  NOT NULL DEFAULT 0,
  -- dollar buckets (mirror hours)
  dollars_regular        NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_overtime       NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_double_time    NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_premium_other  NUMERIC(14,2)  NOT NULL DEFAULT 0,
  amount                 NUMERIC(14,2)  NOT NULL DEFAULT 0,
  -- honest gap column (per D36; never folded into any bucket)
  hours_without_dollars  NUMERIC(10,2)  NOT NULL DEFAULT 0,
  -- week metadata
  week_start             DATE           NOT NULL,
  week_end               DATE           NOT NULL,
  fiscal_year            INTEGER,
  period_no              INTEGER,
  week_source            TEXT           NOT NULL CHECK (week_source IN ('sc_day_metadata', 'iso_fallback')),
  -- observation metadata
  segment_count          INTEGER        NOT NULL DEFAULT 0,
  entry_count            INTEGER        NOT NULL DEFAULT 0,
  coverage_state         TEXT           NOT NULL CHECK (coverage_state IN ('complete','partial','hours_only','unknown')),
  derived_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  source_run             TEXT           NOT NULL,
  PRIMARY KEY (account_key, worker_id, week_label, line_code)
);

CREATE INDEX IF NOT EXISTS labor_actuals_account_week_idx
  ON labor_actuals (account_key, week_label);
CREATE INDEX IF NOT EXISTS labor_actuals_derived_at_idx
  ON labor_actuals (derived_at DESC);
CREATE INDEX IF NOT EXISTS labor_actuals_week_range_idx
  ON labor_actuals (account_key, week_start, week_end);

-- labor_actuals_latest: alias view for consumer compatibility. The /kpi/labor
-- page (kpi-8c on feat/kpi-8c-labor-page) reads `labor_actuals_latest`;
-- since labor_actuals is now upsert-per-grain, latest == the table itself.
CREATE OR REPLACE VIEW labor_actuals_latest AS SELECT * FROM labor_actuals;

-- ─── labor_unattributed ─────────────────────────────────────────────
-- N5: any pay-segment whose worker's department resolves to no account,
-- a container department, or an unknown worker goes here. Same upsert
-- pattern as labor_actuals - grain PK, atomically swapped per run.
CREATE TABLE IF NOT EXISTS labor_unattributed (
  reason_code     TEXT           NOT NULL CHECK (reason_code IN ('unknown_department','container_leak','no_worker_department','unknown_worker')),
  department_id   TEXT,
  worker_id       TEXT,
  amount          NUMERIC(14,2)  NOT NULL DEFAULT 0,
  hours           NUMERIC(10,2)  NOT NULL DEFAULT 0,
  segment_count   INTEGER        NOT NULL DEFAULT 0,
  first_seen_date DATE,
  last_seen_date  DATE,
  derived_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  source_run      TEXT           NOT NULL,
  notes           TEXT,
  PRIMARY KEY (reason_code, COALESCE(department_id, ''), COALESCE(worker_id, ''))
);

CREATE INDEX IF NOT EXISTS labor_unattributed_derived_at_idx
  ON labor_unattributed (derived_at DESC);

-- ─── RPC: swap_labor_actuals_for_account ────────────────────────────
-- Single atomic operation per account. The derivation loops accounts
-- and calls this per account, so one account failing (bad payload
-- shape, etc.) does not roll back another account's fresh figures.
--
-- The RPC takes the account's new labor_actuals rows as a JSONB array.
-- Deletes rows currently in labor_actuals FOR THAT ACCOUNT ONLY, then
-- inserts the new set. One transaction: partial failure rolls back to
-- pre-DELETE state.
CREATE OR REPLACE FUNCTION swap_labor_actuals_for_account(
  p_account_key   TEXT,
  p_actuals       JSONB,
  p_source_run    TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a_count INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE team_key = p_account_key) THEN
    RAISE EXCEPTION 'swap_labor_actuals_for_account: account_key % not in accounts table', p_account_key;
  END IF;

  DELETE FROM labor_actuals WHERE account_key = p_account_key;

  INSERT INTO labor_actuals (
    account_key, worker_id, week_label, line_code,
    hours_regular, hours_overtime, hours_double_time, hours_premium_other,
    dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other,
    amount, hours_without_dollars,
    week_start, week_end, fiscal_year, period_no, week_source,
    segment_count, entry_count, coverage_state,
    derived_at, source_run
  )
  SELECT
    p_account_key,
    (r->>'worker_id')::TEXT,
    (r->>'week_label')::TEXT,
    (r->>'line_code')::TEXT,
    COALESCE((r->>'hours_regular')::NUMERIC, 0),
    COALESCE((r->>'hours_overtime')::NUMERIC, 0),
    COALESCE((r->>'hours_double_time')::NUMERIC, 0),
    COALESCE((r->>'hours_premium_other')::NUMERIC, 0),
    COALESCE((r->>'dollars_regular')::NUMERIC, 0),
    COALESCE((r->>'dollars_overtime')::NUMERIC, 0),
    COALESCE((r->>'dollars_double_time')::NUMERIC, 0),
    COALESCE((r->>'dollars_premium_other')::NUMERIC, 0),
    COALESCE((r->>'amount')::NUMERIC, 0),
    COALESCE((r->>'hours_without_dollars')::NUMERIC, 0),
    (r->>'week_start')::DATE,
    (r->>'week_end')::DATE,
    NULLIF((r->>'fiscal_year'), '')::INTEGER,
    NULLIF((r->>'period_no'), '')::INTEGER,
    (r->>'week_source')::TEXT,
    COALESCE((r->>'segment_count')::INTEGER, 0),
    COALESCE((r->>'entry_count')::INTEGER, 0),
    (r->>'coverage_state')::TEXT,
    NOW(),
    p_source_run
  FROM jsonb_array_elements(p_actuals) r;
  GET DIAGNOSTICS a_count = ROW_COUNT;

  RETURN a_count;
END $$;

-- ─── RPC: swap_labor_unattributed_all ────────────────────────────
-- Portfolio-wide swap. labor_unattributed has no account scope - it
-- captures segments that CANNOT be attributed to an account. Called
-- once per derivation run, after all per-account swaps complete.
--
-- Full DELETE + INSERT, atomic: partial failure rolls back to the
-- previous full set. That is intentional over per-row upsert: an
-- unattributed row disappearing (a dept map fix resolved it) needs to
-- vanish from the table, not linger from an old run.
CREATE OR REPLACE FUNCTION swap_labor_unattributed_all(
  p_rows        JSONB,
  p_source_run  TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u_count INTEGER;
BEGIN
  DELETE FROM labor_unattributed;

  INSERT INTO labor_unattributed (
    reason_code, department_id, worker_id,
    amount, hours, segment_count,
    first_seen_date, last_seen_date,
    derived_at, source_run, notes
  )
  SELECT
    (r->>'reason_code')::TEXT,
    NULLIF(r->>'department_id', ''),
    NULLIF(r->>'worker_id', ''),
    COALESCE((r->>'amount')::NUMERIC, 0),
    COALESCE((r->>'hours')::NUMERIC, 0),
    COALESCE((r->>'segment_count')::INTEGER, 0),
    NULLIF(r->>'first_seen_date', '')::DATE,
    NULLIF(r->>'last_seen_date', '')::DATE,
    NOW(),
    p_source_run,
    NULLIF(r->>'notes', '')
  FROM jsonb_array_elements(p_rows) r
  ON CONFLICT (reason_code, COALESCE(department_id, ''), COALESCE(worker_id, ''))
  DO UPDATE SET
    amount = EXCLUDED.amount,
    hours = EXCLUDED.hours,
    segment_count = EXCLUDED.segment_count,
    first_seen_date = LEAST(labor_unattributed.first_seen_date, EXCLUDED.first_seen_date),
    last_seen_date = GREATEST(labor_unattributed.last_seen_date, EXCLUDED.last_seen_date),
    derived_at = NOW(),
    source_run = EXCLUDED.source_run,
    notes = EXCLUDED.notes;
  GET DIAGNOSTICS u_count = ROW_COUNT;

  RETURN u_count;
END $$;

-- ─── Grants ─────────────────────────────────────────────────────────
-- rippling_department_map: SELECT only. Updates land via new migrations
-- (parallel to earning_type_map from PR A).
GRANT SELECT ON rippling_department_map TO service_role;

-- labor_actuals: SELECT + DELETE + INSERT (RPC uses all three). No
-- direct UPDATE - the pattern is DELETE-then-INSERT inside the RPC.
GRANT SELECT, INSERT, DELETE ON labor_actuals TO service_role;
GRANT SELECT ON labor_actuals_latest TO service_role;

-- labor_unattributed: SELECT + DELETE + INSERT + UPDATE (upsert path).
GRANT SELECT, INSERT, UPDATE, DELETE ON labor_unattributed TO service_role;

-- RPCs executable by service_role.
GRANT EXECUTE ON FUNCTION swap_labor_actuals_for_account(TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION swap_labor_unattributed_all(JSONB, TEXT) TO service_role;

-- ─── Post-flight sanity ─────────────────────────────────────────────
DO $$
DECLARE
  seed_count INTEGER;
  reds_az    TEXT;
BEGIN
  -- Structure
  IF to_regclass('public.rippling_department_map') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_department_map missing';
  END IF;
  IF to_regclass('public.labor_actuals') IS NULL THEN
    RAISE EXCEPTION 'post-flight: labor_actuals missing';
  END IF;
  IF to_regclass('public.labor_actuals_latest') IS NULL THEN
    RAISE EXCEPTION 'post-flight: labor_actuals_latest view missing';
  END IF;
  IF to_regclass('public.labor_unattributed') IS NULL THEN
    RAISE EXCEPTION 'post-flight: labor_unattributed missing';
  END IF;

  -- Department map seed count
  SELECT COUNT(*) INTO seed_count FROM rippling_department_map;
  IF seed_count <> 38 THEN
    RAISE EXCEPTION 'post-flight: rippling_department_map has % rows, expected 38 (Round 2 seed)', seed_count;
  END IF;

  -- D32 regression guard: - REDS (601d817448f7105e4c3d5f49) must be CIN - AZ
  SELECT account_key INTO reds_az
  FROM rippling_department_map
  WHERE department_id = '601d817448f7105e4c3d5f49';
  IF reds_az IS NULL THEN
    RAISE EXCEPTION 'post-flight: department 601d817448f7105e4c3d5f49 (- REDS) missing from seed';
  END IF;
  IF reds_az <> 'CIN - AZ' THEN
    RAISE EXCEPTION 'post-flight: department 601d817448f7105e4c3d5f49 resolves to %, expected CIN - AZ. D32 regression.', reds_az;
  END IF;

  -- Empty at apply time
  IF (SELECT COUNT(*) FROM labor_actuals) <> 0 THEN
    RAISE EXCEPTION 'post-flight: labor_actuals should be empty at apply time';
  END IF;
  IF (SELECT COUNT(*) FROM labor_unattributed) <> 0 THEN
    RAISE EXCEPTION 'post-flight: labor_unattributed should be empty at apply time';
  END IF;

  -- Grants
  IF NOT has_table_privilege('service_role', 'rippling_department_map', 'SELECT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_department_map';
  END IF;
  IF has_table_privilege('service_role', 'rippling_department_map', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role has INSERT on rippling_department_map (should be SELECT-only)';
  END IF;

  IF NOT has_table_privilege('service_role', 'labor_actuals', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing INSERT on labor_actuals';
  END IF;
  IF NOT has_table_privilege('service_role', 'labor_actuals', 'DELETE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing DELETE on labor_actuals (needed for RPC swap)';
  END IF;

  IF NOT has_table_privilege('service_role', 'labor_unattributed', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing INSERT on labor_unattributed';
  END IF;
  IF NOT has_table_privilege('service_role', 'labor_unattributed', 'UPDATE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing UPDATE on labor_unattributed';
  END IF;
  IF NOT has_table_privilege('service_role', 'labor_unattributed', 'DELETE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing DELETE on labor_unattributed';
  END IF;

  -- RPCs exist and are executable
  IF NOT has_function_privilege('service_role',
    'swap_labor_actuals_for_account(text, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing EXECUTE on swap_labor_actuals_for_account';
  END IF;
  IF NOT has_function_privilege('service_role',
    'swap_labor_unattributed_all(jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing EXECUTE on swap_labor_unattributed_all';
  END IF;

  RAISE NOTICE 'kpi-8bb post-flight PASS - tables/views/seed present, grants correct, D32 regression guard held';
END $$;

COMMIT;
