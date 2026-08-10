-- kpi-8bc-labor-actuals-week-start-key-and-safe-delete.sql
--
-- P0 hot-fix for kpi-8bb (which applied 2026-08-08 and produced
-- corrupted labor_actuals on the first nightly run).
--
-- Two independent defects, both landing here in one migration because
-- both require touching the same objects:
--
--   1. labor_actuals PRIMARY KEY (account_key, worker_id, week_label,
--      line_code) collapsed multiple real weeks into one row per
--      worker. week_label is period-relative ("Week 4" exists in
--      every period), not unique per actual week. Evidence:
--        CIN-OH worker 698a3f67...: 152.65 hours_regular in a single
--        row against a paystub of 27.40. 152.65 / 4 ~= 38, four
--        stacked weeks. CIN-OH ended up with 5 workers * 4 week
--        labels = 20 rows, where the correct number was 5 * ~17 real
--        weeks. Portfolio total: 644 rows against an expected several
--        thousand.
--
--      Fix: PK on (account_key, worker_id, week_start, line_code).
--      week_start is a real date, unique per actual week. week_label
--      stays as a display-only field. Considered composite (period_no,
--      week_label) but rejected: week_start is a date, is single-column
--      unique, and does not require the derivation to have period_no
--      resolved (it can be null when a date falls outside a known
--      fiscal window; the weekly row should still emit).
--
--      labor_actuals holds only derived data. Drop + recreate is safe.
--      The bug lived in TWO places - JS bucket key AND the schema PK.
--      Fixing only the schema would turn the silent JS merge into a
--      unique-violation crash; both must move together.
--
--   2. swap_labor_unattributed_all did an unqualified DELETE which
--      Supabase's safe-delete guard rejects at runtime ("DELETE
--      requires a WHERE clause"). PG itself allows the unqualified
--      DELETE and scratch verification did not catch it. Fixed with
--      WHERE true.
--
--      Recorded here because it is the SECOND scratch-vs-production
--      environment divergence caught this month (the first was
--      Postgres-parse allowing the COALESCE-in-PK expression at parse
--      time but rejecting at CREATE - which scratch also caught but
--      only after the fix). Scratch Postgres is not Supabase.
--
-- Also refreshed: swap_labor_actuals_for_account. Its body is
-- unchanged, but the table it references has been dropped and
-- recreated, so it must be re-declared to bind to the new relation.
--
-- Applied: NOT YET (PR under review). Transactional; failure rolls
-- back the entire migration.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.labor_actuals') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bc pre-flight: labor_actuals missing - kpi-8bb must be applied first';
  END IF;
  IF to_regclass('public.labor_actuals_latest') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bc pre-flight: labor_actuals_latest missing - kpi-8bb must be applied first';
  END IF;
  IF to_regclass('public.labor_unattributed') IS NULL THEN
    RAISE EXCEPTION 'kpi-8bc pre-flight: labor_unattributed missing - kpi-8bb must be applied first';
  END IF;
END $$;

-- ─── Drop view + table (view depends on table) ──────────────────────
DROP VIEW  IF EXISTS labor_actuals_latest;
DROP TABLE IF EXISTS labor_actuals;

-- ─── Recreate labor_actuals with week_start in the PK ───────────────
CREATE TABLE labor_actuals (
  account_key            TEXT           NOT NULL REFERENCES accounts(team_key),
  worker_id              TEXT           NOT NULL,
  week_label             TEXT           NOT NULL,  -- display only; not in PK
  line_code              TEXT           NOT NULL REFERENCES kpi_lines(line_code),
  hours_regular          NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_overtime         NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_double_time      NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_premium_other    NUMERIC(10,2)  NOT NULL DEFAULT 0,
  dollars_regular        NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_overtime       NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_double_time    NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_premium_other  NUMERIC(14,2)  NOT NULL DEFAULT 0,
  amount                 NUMERIC(14,2)  NOT NULL DEFAULT 0,
  hours_without_dollars  NUMERIC(10,2)  NOT NULL DEFAULT 0,
  week_start             DATE           NOT NULL,
  week_end               DATE           NOT NULL,
  fiscal_year            INTEGER,
  period_no              INTEGER,
  week_source            TEXT           NOT NULL CHECK (week_source IN ('sc_day_metadata', 'iso_fallback')),
  segment_count          INTEGER        NOT NULL DEFAULT 0,
  entry_count            INTEGER        NOT NULL DEFAULT 0,
  coverage_state         TEXT           NOT NULL CHECK (coverage_state IN ('complete','partial','hours_only','unknown')),
  derived_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  source_run             TEXT           NOT NULL,
  PRIMARY KEY (account_key, worker_id, week_start, line_code)
);

CREATE INDEX labor_actuals_account_week_idx     ON labor_actuals (account_key, week_start);
CREATE INDEX labor_actuals_derived_at_idx       ON labor_actuals (derived_at DESC);
CREATE INDEX labor_actuals_week_range_idx       ON labor_actuals (account_key, week_start, week_end);

-- ─── Recreate view (columns enumerated, no SELECT *) ────────────────
CREATE VIEW labor_actuals_latest AS
  SELECT
    account_key, worker_id, week_label, line_code,
    hours_regular, hours_overtime, hours_double_time, hours_premium_other,
    dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other,
    amount, hours_without_dollars,
    week_start, week_end, fiscal_year, period_no, week_source,
    segment_count, entry_count, coverage_state,
    derived_at, source_run
  FROM labor_actuals;

-- ─── Rebind swap_labor_actuals_for_account to the recreated table ──
-- Body unchanged from kpi-8bb; CREATE OR REPLACE re-parses and binds
-- to the newly-created relation.
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

-- ─── Fix swap_labor_unattributed_all: WHERE true for Supabase safe-delete ──
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
  -- Supabase's PostgREST-side safe-delete guard rejects unqualified
  -- DELETE. Postgres itself accepts it, which is why scratch parse did
  -- not catch it. WHERE true is a no-op qualifier that both accept.
  DELETE FROM labor_unattributed WHERE true;

  INSERT INTO labor_unattributed (
    reason_code, department_id, worker_id,
    amount, hours, segment_count,
    first_seen_date, last_seen_date,
    derived_at, source_run, notes
  )
  SELECT
    (r->>'reason_code')::TEXT,
    COALESCE(r->>'department_id', ''),
    COALESCE(r->>'worker_id', ''),
    COALESCE((r->>'amount')::NUMERIC, 0),
    COALESCE((r->>'hours')::NUMERIC, 0),
    COALESCE((r->>'segment_count')::INTEGER, 0),
    NULLIF(r->>'first_seen_date', '')::DATE,
    NULLIF(r->>'last_seen_date', '')::DATE,
    NOW(),
    p_source_run,
    NULLIF(r->>'notes', '')
  FROM jsonb_array_elements(p_rows) r
  ON CONFLICT (reason_code, department_id, worker_id)
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

-- ─── Re-grant on the recreated table + view ─────────────────────────
GRANT SELECT, INSERT, DELETE ON labor_actuals        TO service_role;
GRANT SELECT                  ON labor_actuals_latest TO service_role;
GRANT EXECUTE ON FUNCTION swap_labor_actuals_for_account(TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION swap_labor_unattributed_all(JSONB, TEXT)          TO service_role;

-- ─── Post-flight sanity ─────────────────────────────────────────────
DO $$
DECLARE
  pk_cols TEXT;
BEGIN
  IF to_regclass('public.labor_actuals') IS NULL THEN
    RAISE EXCEPTION 'post-flight: labor_actuals missing after recreate';
  END IF;
  IF to_regclass('public.labor_actuals_latest') IS NULL THEN
    RAISE EXCEPTION 'post-flight: labor_actuals_latest view missing after recreate';
  END IF;

  IF (SELECT COUNT(*) FROM labor_actuals) <> 0 THEN
    RAISE EXCEPTION 'post-flight: labor_actuals should be empty after recreate';
  END IF;

  -- Confirm the PK columns include week_start, not week_label.
  SELECT string_agg(attname::text, ',' ORDER BY attnum)
  INTO pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'labor_actuals'::regclass AND i.indisprimary;
  IF pk_cols LIKE '%week_label%' THEN
    RAISE EXCEPTION 'post-flight: labor_actuals PK still includes week_label (%). Should key on week_start.', pk_cols;
  END IF;
  IF pk_cols NOT LIKE '%week_start%' THEN
    RAISE EXCEPTION 'post-flight: labor_actuals PK does not include week_start (%). Grain bug will re-appear.', pk_cols;
  END IF;

  IF NOT has_table_privilege('service_role', 'labor_actuals', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing INSERT on labor_actuals';
  END IF;
  IF NOT has_table_privilege('service_role', 'labor_actuals', 'DELETE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing DELETE on labor_actuals';
  END IF;
  IF NOT has_function_privilege('service_role', 'swap_labor_actuals_for_account(text, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing EXECUTE on swap_labor_actuals_for_account';
  END IF;
  IF NOT has_function_privilege('service_role', 'swap_labor_unattributed_all(jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing EXECUTE on swap_labor_unattributed_all';
  END IF;

  RAISE NOTICE 'kpi-8bc post-flight PASS - labor_actuals PK=(%) contains week_start; swap_labor_unattributed_all uses WHERE true; grants intact', pk_cols;
END $$;

COMMIT;
