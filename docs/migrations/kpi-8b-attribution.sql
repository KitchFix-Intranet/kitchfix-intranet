-- kpi-8b-attribution.sql
-- KPI PR 8b: attribute raw Rippling labor to accounts, periods, and P&L lines.
--
-- Scope, in one sentence: turn raw Rippling time entries and pay segments
-- into account-attributed, period-bucketed labor dollars that the KPI
-- resolver can read.
--
-- Adds four tables + views on top of PR 8a:
--
--   rippling_raw_workers                 append-only raw ingest, same shape as
--                                        rippling_raw_time_entries / _pay_segments
--   rippling_raw_workers_latest          DISTINCT ON view, N11 (latest by timestamp)
--   rippling_department_map              department_id -> (account_key, pnl_line)
--   labor_actuals                        derived: dollars + hours per account/period/line
--   labor_actuals_latest                 DISTINCT ON view over source_run
--   labor_unattributed                   segments that landed in the unattributed bucket
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
--    orphan labor history. See D32 in the playbook.
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
--    worker resolves to a department not in the map, or a department
--    flagged `is_container = true`, or a segment_date that resolves to
--    null via `periodForDate` (fiscal-year boundary case, currently
--    provisional pending Joe's ruling), goes to `labor_unattributed`
--    with a distinct `reason_code`. Playbook N5.
--
-- 5. **`labor_actuals` is derived, not ingested.** It is computed from
--    the `_latest` views over `rippling_raw_pay_segments`,
--    `rippling_raw_time_entries`, and `rippling_raw_workers`, plus
--    `rippling_department_map`. It never calls Rippling. When the map
--    is corrected - and it will be, because a `- REDS`-class discovery
--    can happen again - we re-derive rather than re-pull. That is the
--    entire point of the two-layer design.
--
-- 6. **Amount comes from `estimated_amount` on the pay segment.**
--    Rippling computed it. We do not multiply hours by rate (playbook
--    D27). There is no pay-run endpoint and the derivation drifts on
--    overtime premiums, shift differentials, and retro adjustments.
--
-- 7. **OT rule** (matches the PR 8a verify probe and Kevin's 2026-08-04
--    one-off): a segment is OT if `overtime_multiplier > 1.0` OR
--    `merged_earning_type_name` matches /overtime|OT/i. Applied to
--    `segment_duration_hours`.
--
-- 8. **Approval state is entry-count distribution, not dollar
--    distribution.** `pay_segment.time_entry.id` uses a different id
--    space than the REST `/time-entries` endpoint, so direct join is
--    impossible. Segments only exist for post-approval time entries,
--    so segment dollars = approved+ by construction. The `approval_state`
--    JSONB carries entry-count-by-status across the period bucket, so
--    the resolver can render "n entries still in draft" alongside the
--    finalized dollars.
--
-- Applied: NOT YET (draft PR). Transactional; failure rolls back the
-- entire migration including the seed.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
DECLARE
  te_bad_uq TEXT;
  ps_bad_uq TEXT;
  wk_bad_uq TEXT;
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
  -- Half-applied guard for workers table: if it exists, it must NOT
  -- carry a UNIQUE on (rippling_id, content_hash). Same rationale as
  -- kpi-8a: DB-side uniqueness breaks revert cycles for content-hashed
  -- audit trails.
  IF to_regclass('public.rippling_raw_workers') IS NOT NULL THEN
    SELECT c.conname INTO wk_bad_uq
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_workers'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
    LIMIT 1;
    IF wk_bad_uq IS NOT NULL THEN
      RAISE EXCEPTION 'kpi-8b pre-flight: rippling_raw_workers has a pre-existing UNIQUE on (rippling_id, content_hash) named %. Drop it first: ALTER TABLE rippling_raw_workers DROP CONSTRAINT %I;', wk_bad_uq, wk_bad_uq;
    END IF;
  END IF;
END $$;

-- ─── rippling_raw_workers (extend PR 8a's ingest pattern) ──────────
CREATE TABLE IF NOT EXISTS rippling_raw_workers (
  id           BIGSERIAL PRIMARY KEY,
  rippling_id  TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual'))
  -- NO UNIQUE on (rippling_id, content_hash). Revert cycles (X -> Y -> X)
  -- must land the third observation; app-side compare-then-insert
  -- enforces the intent.
);

CREATE INDEX IF NOT EXISTS rippling_raw_workers_latest_idx
  ON rippling_raw_workers (rippling_id, fetched_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rippling_raw_workers_fetched_at_idx
  ON rippling_raw_workers (fetched_at DESC);

CREATE OR REPLACE VIEW rippling_raw_workers_latest AS
  SELECT DISTINCT ON (rippling_id)
    id, rippling_id, content_hash, payload, fetched_at, fetch_source
  FROM rippling_raw_workers
  ORDER BY rippling_id, fetched_at DESC, id DESC;

-- ─── rippling_department_map ────────────────────────────────────────
-- The single source of truth for department -> account attribution.
-- Keyed on department_id, never on the name. Names carry typos
-- (`"TXR- Visiting Side"`, double space in `"Louisville  Bats"`) and
-- can be actively misleading about the account (`- REDS` = CIN - AZ).
--
-- Many-to-one and permanent. CIN - OH has both `REDS OH` departments;
-- CIN - AZ has both `REDS` departments. Historical entries never
-- migrate when a new department is added, so every department_id that
-- has ever carried entries stays here forever. A future cleanup that
-- removes "legacy" rows would orphan labor history.
--
-- `is_container = true` marks parent departments with zero workers
-- (Goodyear Reds, Cincinnati Reds, Jupiter Cardinals, St. Louis
-- Cardinals, Dunedin TBJ, Buffalo NY, Port Charlotte TBR, Surprise
-- TXR, Arlington TXR, PFS, Corporate). They map to an account for
-- completeness but should never receive entries. Post-flight of the
-- derivation asserts that.
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
-- 31 client-account rows + 7 CORP rows = 38 total, exactly the
-- department count returned by Rippling as of 2026-08-04. Every
-- account_key is verified by work location of the workers currently
-- assigned to that department_id.

INSERT INTO rippling_department_map (department_id, department_name, account_key, pnl_line, is_container, verified_at, notes) VALUES
-- CIN - AZ (Goodyear)
('601d80ea2aca9a5fef7617fa', 'Goodyear Reds',                                 'CIN - AZ',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('601d817448f7105e4c3d5f49', 'Hourly Kitchen - 3100.1 - REDS',                'CIN - AZ',     '3100.1', false, '2026-08-04', 'D32: name-misleading. 128/128 workers at Goodyear, AZ - NOT Cincinnati'),
('601d818b2ab2cef76f0d62f7', 'Salary Wages - 3100.2 - REDS',                  'CIN - AZ',     '3100.2', false, '2026-08-04', '11/11 workers at Goodyear, AZ. Salary line - 0 entries expected (D26/D27, 3100.2 not from time-entry pipeline)'),
-- CIN - OH (Cincinnati)
('66a3b85f0b7d0b40d36acc2f', 'Cincinnati Reds',                               'CIN - OH',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('66a3b8c92d818718345ff854', 'Hourly Kitchen - 3100.1 - REDS OH',             'CIN - OH',     '3100.1', false, '2026-08-04', '16/16 workers at Cincinnati, OH. Created March 2026'),
('676a00efeb1828eb5fc829b6', 'Salary Wages - 3100.2 REDS OH',                 'CIN - OH',     '3100.2', false, '2026-08-04', '1/1 worker at Cincinnati, OH. Salary line - 0 entries expected'),
-- CIN - KY (Louisville) - D26 single-salaried account
('65dcfcbd44398f188b75e20c', 'Louisville  Bats',                              'CIN - KY',     NULL,     true,  '2026-08-04', 'container parent (note double-space in name). 1 contractor sits here; contractor has 0 labor data, not in scope for time-entry pipeline'),
('65dcfcd6726b559b2db5c0e9', 'Salary Wages - 3100.2 - Bats',                  'CIN - KY',     '3100.2', false, '2026-08-04', 'D26: single salaried Executive Chef. 1/1 worker at Louisville, KY'),
-- STL - FL (Jupiter)
('69179d2b52f92c170ac0d29c', 'Jupiter Cardinals',                             'STL - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('69612c8272453bb48d0416a1', 'Hourly Kitchen - 3100.1 - Jupiter',             'STL - FL',     '3100.1', false, '2026-08-04', '26/26 workers at Jupiter, FL'),
('69612c8372453bb48d0416b4', 'Salary Wages - 3100.2 - Jupiter',               'STL - FL',     '3100.2', false, '2026-08-04', '4/4 workers at Jupiter, FL'),
-- STL - MO (St. Louis)
('67a3caba7a2ec09203ff3895', 'St. Louis Cardinals',                           'STL - MO',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('67a3cabe7a2ec09203ff38a4', 'Hourly Kitchen - 3100.1 - Cardinals',           'STL - MO',     '3100.1', false, '2026-08-04', '23/23 workers at St. Louis, MO. Name contains Cardinals but NOT Jupiter - the disambiguator'),
('67a3cac07a2ec09203ff38ac', 'Salary Wages - 3100.2 - Cardinals',             'STL - MO',     '3100.2', false, '2026-08-04', '6/6 workers at St. Louis, MO. Includes 1 contractor RD (0 labor data, out of pipeline)'),
-- TBJ - FL (Dunedin)
('5c2cf3cc92dabb2b61fd9411', 'Dunedin TBJ',                                   'TBJ - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5c338b256ab9e2451298d7b5', 'Hourly Kitchen - 3100.1 - TBJ',                 'TBJ - FL',     '3100.1', false, '2026-08-04', '181/181 workers at Dunedin, FL'),
('5c338b1fc59291794dc6daee', 'Salary Wages - 3100.2 - TBJ',                   'TBJ - FL',     '3100.2', false, '2026-08-04', '14/15 workers at Dunedin, FL (1 HQ Chicago outlier logged)'),
-- TBJ - NY (Buffalo) - D26 single-salaried
('5e40c83c5a8f4e2ad22c4bf7', 'Buffalo NY',                                    'TBJ - NY',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5f2178a412365002972c65ea', 'Hourly Kitchen - 3100.1 - BUF',                 'TBJ - NY',     '3100.1', false, '2026-08-04', '12 workers all TERMINATED 2020-21; Rippling does not strip department_id on termination. D26 holds - no active hourly'),
('5e40c8d2b0974e0f7fc79a6a', 'Salary Wages - 3100.2 - BUF',                   'TBJ - NY',     '3100.2', false, '2026-08-04', '7/7 workers at Buffalo, NY'),
-- TBR - FL (Port Charlotte / Englewood)
('5fd0ff740f3ad600d0424614', 'Port Charlotte TBR',                            'TBR - FL',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('5fd0ffb21cbc9d00293c4eca', 'Hourly Kitchen - 3100.1 - TBR',                 'TBR - FL',     '3100.1', false, '2026-08-04', '183/183 workers at single Rippling work_location "Englewood, FL/Port Charlotte, FL (TBR-FL)" - one location covers both physical sites'),
('5fd0ffbef75c1200ce81bc69', 'Salary Wages - 3100.2 - TBR',                   'TBR - FL',     '3100.2', false, '2026-08-04', '9/9 workers at the combined TBR-FL work_location'),
-- TXR - AZ (Surprise)
('61bba390891bcdcd7caf8103', 'Surprise TXR',                                  'TXR - AZ',     NULL,     true,  '2026-08-04', 'container parent, 0 workers'),
('61bba40f9876bd62d74ab5f9', 'Hourly Kitchen - 3100.1 TXR-AZ',                'TXR - AZ',     '3100.1', false, '2026-08-04', '81/81 workers at Surprise, AZ'),
('61bba432d48aba5eefbc27ee', 'Salary Wages - 3100.2 TXR-AZ',                  'TXR - AZ',     '3100.2', false, '2026-08-04', '3/3 workers at Surprise, AZ'),
-- TXR - TX - H (Arlington Home)
('5e3ecbba5a8f4e251b754611', 'Arlington TXR',                                 'TXR - TX - H', NULL,     true,  '2026-08-04', 'container parent shared with V (0 workers on it directly)'),
('5e3eccebb0974e16af6f8c16', 'Hourly Kitchen - 3100.1 - TXR - Home Side',     'TXR - TX - H', '3100.1', false, '2026-08-04', '78/79 workers at Arlington TX Home; 1 on deleted work_location 5c05aaae (logged, non-blocking)'),
('5e3ecce18a9f4e38d515fd9c', 'Salary Wages - 3100.2 - TXR - Home Side',       'TXR - TX - H', '3100.2', false, '2026-08-04', '15/17 workers at Arlington TX Home; 1 at Buffalo NY, 1 at HQ Chicago (logged, non-blocking)'),
-- TXR - TX - V (Arlington Visiting)
('65c402509aa26127a1e29f22', 'Hourly Kitchen - 3100.1 - TXR- Visiting Side',  'TXR - TX - V', '3100.1', false, '2026-08-04', 'note typo in name (missing space). 12 workers, 8 at Visitor clock-in, 4 at Home clock-in - open op question flagged with Grant/Jordan per playbook §2.1'),
('65c4024887a5e2437fcccc32', 'Salary Wages - 3100.2 - TXR- Visiting Side',    'TXR - TX - V', '3100.2', false, '2026-08-04', '2/2 workers at Arlington TX Visitor'),
-- CORP (D17 out of scope for client P&Ls)
('5c4a125c6ab9e21dcc288ad8', 'PFS',                                           'CORP',         NULL,     true,  '2026-08-04', 'root container for all client account trees. 0 workers'),
('5c140b612962480ef6366027', 'Corporate',                                     'CORP',         NULL,     true,  '2026-08-04', 'root container, 0 workers'),
('5c338b0a296248677c0a26db', '5004.1 - CORP CEO',                             'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c2cfbbc296248319461af77', '5004.2 - CORP FINANCE',                         'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c338afbc592917819e89219', '5004.6 - CORP HR',                              'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c338d8d92dabb3a580c611f', '5004.7 CORP OPS/ACCT MGMT/SALES',               'CORP',         NULL,     false, '2026-08-04', 'CORP - out of scope per D17'),
('5c2cfbc16ab9e23aa196c5ac', '5004.4 - Marketing Wages',                      'CORP',         NULL,     false, '2026-08-04', 'CORP - 4 TERMINATED workers at HQ Chicago, likely dormant');

-- ─── labor_actuals (derived) ────────────────────────────────────────
-- Rows per (account, fiscal_year, period_no, line_code) per derivation
-- run. Append-only with source_run distinguishing runs. `_latest` view
-- resolves the current values by derived_at DESC.
--
-- amount:      sum of pay_segment.estimated_amount (Rippling-computed, D27)
-- hours_reg:   sum of segment_duration_hours where NOT isOT
-- hours_ot:    sum of segment_duration_hours where isOT
-- segment_count: count of pay_segments in the bucket
-- entry_count: count of DISTINCT time_entry_id in the bucket (from the
--              time_entries side, joined by worker + start_time date
--              being in the period)
-- approval_state: JSONB { "DRAFT": n, "APPROVED": n, "PAID": n,
--              "FINALIZED": n, ... } - counts of TIME ENTRIES by status
--              in this bucket. Not dollars-per-status because
--              pay_segment.time_entry.id uses a different id space
--              than /time-entries and cannot be directly joined.
--              Segment dollars are approved+ by construction (Rippling
--              only computes segments after entries are approved).
CREATE TABLE IF NOT EXISTS labor_actuals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key    TEXT NOT NULL REFERENCES accounts(team_key),
  fiscal_year    INTEGER NOT NULL,
  period_no      INTEGER NOT NULL,
  line_code      TEXT NOT NULL REFERENCES kpi_lines(line_code),
  amount         NUMERIC(14,2) NOT NULL,
  hours_regular  NUMERIC(10,2),
  hours_overtime NUMERIC(10,2),
  segment_count  INTEGER NOT NULL,
  entry_count    INTEGER NOT NULL,
  approval_state JSONB NOT NULL,
  derived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_run     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS labor_actuals_latest_idx
  ON labor_actuals (account_key, fiscal_year, period_no, line_code, derived_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS labor_actuals_derived_at_idx
  ON labor_actuals (derived_at DESC);

CREATE OR REPLACE VIEW labor_actuals_latest AS
  SELECT DISTINCT ON (account_key, fiscal_year, period_no, line_code)
    id, account_key, fiscal_year, period_no, line_code,
    amount, hours_regular, hours_overtime,
    segment_count, entry_count, approval_state,
    derived_at, source_run
  FROM labor_actuals
  ORDER BY account_key, fiscal_year, period_no, line_code, derived_at DESC, id DESC;

-- ─── labor_unattributed ─────────────────────────────────────────────
-- Non-negotiable per N5: any pay_segment whose worker resolves to a
-- department not in the map, a container department, or a segment_date
-- that resolves null via periodForDate (fiscal-year boundary, currently
-- provisional) goes here with a distinct reason_code.
--
-- Also non-negotiable: a probe that reports "$8,000 unattributed across
-- 2 unknown departments" is working correctly. A probe that reports a
-- clean number while quietly dropping those segments is the failure
-- this whole project exists to prevent.
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
-- rippling_raw_workers follows the PR 8a pattern: SELECT + INSERT to
-- service_role, no UPDATE / no DELETE (append-only). Same negative-
-- space assertion in post-flight.
GRANT SELECT, INSERT ON rippling_raw_workers                TO service_role;
GRANT USAGE          ON SEQUENCE rippling_raw_workers_id_seq TO service_role;
GRANT SELECT         ON rippling_raw_workers_latest          TO service_role;

-- rippling_department_map: SELECT only for service_role. Seed lands
-- in this migration. Future updates come via new migrations (per
-- "applied migration is history, not a wish" - GOTCHAS).
GRANT SELECT ON rippling_department_map TO service_role;

-- labor_actuals: SELECT for the resolver, INSERT for the derivation
-- script. No UPDATE / no DELETE - append-only, latest-wins view
-- resolves. Same negative-space check in post-flight.
GRANT SELECT, INSERT ON labor_actuals             TO service_role;
GRANT SELECT         ON labor_actuals_latest      TO service_role;

-- labor_unattributed: same pattern.
GRANT SELECT, INSERT ON labor_unattributed        TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  seed_count INTEGER;
  reds_az    TEXT;
  wk_sel BOOLEAN; wk_ins BOOLEAN; wk_upd BOOLEAN; wk_del BOOLEAN;
  la_sel BOOLEAN; la_ins BOOLEAN; la_upd BOOLEAN; la_del BOOLEAN;
  un_sel BOOLEAN; un_ins BOOLEAN; un_upd BOOLEAN; un_del BOOLEAN;
  dm_sel BOOLEAN; dm_ins BOOLEAN; dm_upd BOOLEAN; dm_del BOOLEAN;
BEGIN
  -- Structure: all new tables + views exist
  IF to_regclass('public.rippling_raw_workers')          IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_workers missing'; END IF;
  IF to_regclass('public.rippling_raw_workers_latest')   IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_workers_latest missing'; END IF;
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
  -- id 601d817448f7105e4c3d5f49) MUST resolve to CIN - AZ. If a future
  -- edit puts it on CIN - OH we want the migration to fail loudly on
  -- re-apply.
  SELECT account_key INTO reds_az
  FROM rippling_department_map
  WHERE department_id = '601d817448f7105e4c3d5f49';
  IF reds_az IS NULL THEN
    RAISE EXCEPTION 'post-flight: department 601d817448f7105e4c3d5f49 (Hourly Kitchen - 3100.1 - REDS) missing from seed';
  END IF;
  IF reds_az <> 'CIN - AZ' THEN
    RAISE EXCEPTION 'post-flight: department 601d817448f7105e4c3d5f49 (Hourly Kitchen - 3100.1 - REDS) resolves to %, expected CIN - AZ. D32 regression - 128 workers all clock at Goodyear AZ, not Cincinnati OH', reds_az;
  END IF;

  -- Negative-space: rippling_raw_workers must NOT have UNIQUE on
  -- (rippling_id, content_hash). Same guard as kpi-8a.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_workers'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_workers has a UNIQUE on (rippling_id, content_hash) - must not exist (revert-cycle trap, kpi-8a header)';
  END IF;

  -- Positive grants: workers table + view
  wk_sel := has_table_privilege('service_role', 'rippling_raw_workers', 'SELECT');
  wk_ins := has_table_privilege('service_role', 'rippling_raw_workers', 'INSERT');
  wk_upd := has_table_privilege('service_role', 'rippling_raw_workers', 'UPDATE');
  wk_del := has_table_privilege('service_role', 'rippling_raw_workers', 'DELETE');
  IF NOT wk_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_workers'; END IF;
  IF NOT wk_ins THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_raw_workers'; END IF;
  IF wk_upd     THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_workers (must be append-only)'; END IF;
  IF wk_del     THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_workers (must be append-only)'; END IF;
  IF NOT has_table_privilege('service_role', 'rippling_raw_workers_latest', 'SELECT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_workers_latest';
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
  IF la_del     THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on labor_actuals (must be append-only; re-derive via new source_run instead of mutating rows)'; END IF;
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

  RAISE NOTICE 'kpi-8b post-flight PASS - tables/views/seed present, grants correct, D32 regression guard held, negative-space grants absent';
END $$;

COMMIT;
