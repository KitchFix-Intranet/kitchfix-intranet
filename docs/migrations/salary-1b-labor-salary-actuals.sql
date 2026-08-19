-- salary-1b-labor-salary-actuals.sql
-- Salary PR 1 · migration 1b: derived salaried-actuals table.
--
-- The salary derive (scripts/derive_salary_actuals.mjs) computes one
-- row per (worker_id, week_start) for every ACTIVE salaried worker,
-- attributes it to an account via rippling_department_map, and stores
-- amount = annual_in_force / 52. Kept SEPARATE from labor_actuals so
-- the default hourly path cannot accidentally read it and playbook 8.2
-- (never mix 3100.1 + 3100.2) stays enforceable by TABLE, not by WHERE.
-- The spec S-3 rationale in one line: "8.2 subtraction problem"
-- (hourly + full = one person's salary) can be attempted only if you
-- have both tables; keep them in different rooms.
--
-- Header choices:
--
--   UNIQUE (worker_id, week_start):
--     One salary row per worker-week. Effective-dated attribution
--     resolves to a single annual_in_force per week (spec S-2). A
--     transfer moves attribution from the transfer date forward via
--     rippling_department_map history; the derive rebuilds the
--     trailing 8 weeks every run so late-entered transfers, raises,
--     and terminations self-heal. Idempotent by construction.
--
--   REVOKE TRUNCATE from PUBLIC + anon + authenticated:
--     House rule fences those three roles only; service_role's
--     inherited TRUNCATE stays in place (precedent: labor_actuals,
--     purchasing_actuals). Rebuild the trailing window is DELETE +
--     INSERT scoped to that window; the derive itself never TRUNCATEs.
--
--   No UPDATE grant:
--     Rebuild is DELETE + INSERT; there is nothing to UPDATE. Grant
--     absence is asserted by post-flight.
--
--   compensation_rippling_id foreign-key-like column (no FK):
--     Records WHICH compensation row produced this amount. NO actual
--     foreign key - the compensation record can be superseded (a new
--     content-hash version arrives via the walk) and the derive
--     re-attributes on the next run; an FK would fight rebuild
--     semantics. This column is for the drill-down audit only.
--
--   source column defaults to 'rippling_compensations':
--     Leaves room for pay-run actuals (spec §7 "not in scope") to
--     replace the S-2 derivation later without a schema change - just
--     stamp source='rippling_payruns' on the newer rows.
--
--   No dollar figure, no worker name, no PII in this file.
--
-- Applied: TBD in Supabase Studio.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
DECLARE
  sa_bad_pk TEXT;
BEGIN
  -- Marker: PR 1 spine landed.
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'salary-1b pre-flight: kpi_lines missing - PR 1 spine must land first';
  END IF;

  -- rippling_raw_compensations must exist (salary-1a) so the derive
  -- has a source for the amount + effective date. Guard order.
  IF to_regclass('public.rippling_raw_compensations') IS NULL THEN
    RAISE EXCEPTION 'salary-1b pre-flight: rippling_raw_compensations missing - salary-1a must land first';
  END IF;

  -- Half-applied guard: if the table exists it MUST NOT carry a
  -- different UNIQUE key. UNIQUE (worker_id, week_start) is the only
  -- shape the derive expects.
  IF to_regclass('public.labor_salary_actuals') IS NOT NULL THEN
    SELECT c.conname INTO sa_bad_pk
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'labor_salary_actuals'
      AND c.contype = 'u'
      AND NOT ((SELECT array_agg(attname::text ORDER BY attnum)
                FROM pg_attribute WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
               @> ARRAY['worker_id', 'week_start'])
    LIMIT 1;
    IF sa_bad_pk IS NOT NULL THEN
      RAISE EXCEPTION 'salary-1b pre-flight: labor_salary_actuals has an unexpected UNIQUE constraint %. Drop it first.', sa_bad_pk;
    END IF;
  END IF;
END $$;

-- ─── labor_salary_actuals ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_salary_actuals (
  account_key              TEXT           NOT NULL,
  week_start               DATE           NOT NULL,
  worker_id                TEXT           NOT NULL,
  amount                   NUMERIC(14, 2) NOT NULL,
  annual_comp_at_time      NUMERIC(14, 2) NOT NULL,
  effective_from           DATE,
  compensation_rippling_id TEXT,
  source                   TEXT           NOT NULL DEFAULT 'rippling_compensations',
  derived_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (worker_id, week_start)
);

-- Common reads: per-account roll-ups over a date range.
CREATE INDEX IF NOT EXISTS labor_salary_actuals_account_week_idx
  ON labor_salary_actuals (account_key, week_start);

-- Rebuild window: DELETE where week_start >= trailing_8_weeks_start.
CREATE INDEX IF NOT EXISTS labor_salary_actuals_week_idx
  ON labor_salary_actuals (week_start);

-- ─── Grants ─────────────────────────────────────────────────────────
-- Rebuild pattern: DELETE + INSERT scoped to the trailing window. No
-- UPDATE ever - the derive rewrites rows, it does not mutate them.
-- TRUNCATE fenced from PUBLIC + anon + authenticated only (house
-- rule + precedent: labor_actuals, purchasing_actuals). service_role
-- keeps its inherited TRUNCATE.
GRANT SELECT, INSERT, DELETE ON labor_salary_actuals TO service_role;
REVOKE TRUNCATE ON labor_salary_actuals FROM PUBLIC;
REVOKE TRUNCATE ON labor_salary_actuals FROM anon;
REVOKE TRUNCATE ON labor_salary_actuals FROM authenticated;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  sa_sel BOOLEAN; sa_ins BOOLEAN; sa_del BOOLEAN; sa_upd BOOLEAN;
  sa_uq_ok BOOLEAN;
BEGIN
  IF to_regclass('public.labor_salary_actuals') IS NULL THEN
    RAISE EXCEPTION 'post-flight: labor_salary_actuals missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND tablename='labor_salary_actuals' AND indexname='labor_salary_actuals_account_week_idx') THEN
    RAISE EXCEPTION 'post-flight: labor_salary_actuals_account_week_idx missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND tablename='labor_salary_actuals' AND indexname='labor_salary_actuals_week_idx') THEN
    RAISE EXCEPTION 'post-flight: labor_salary_actuals_week_idx missing';
  END IF;

  -- UNIQUE (worker_id, week_start) is the identity of a salary row.
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'labor_salary_actuals'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['worker_id', 'week_start']
  ) INTO sa_uq_ok;
  IF NOT sa_uq_ok THEN
    RAISE EXCEPTION 'post-flight: labor_salary_actuals missing UNIQUE (worker_id, week_start)';
  END IF;

  sa_sel := has_table_privilege('service_role', 'labor_salary_actuals', 'SELECT');
  sa_ins := has_table_privilege('service_role', 'labor_salary_actuals', 'INSERT');
  sa_del := has_table_privilege('service_role', 'labor_salary_actuals', 'DELETE');
  sa_upd := has_table_privilege('service_role', 'labor_salary_actuals', 'UPDATE');
  IF NOT sa_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on labor_salary_actuals'; END IF;
  IF NOT sa_ins THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on labor_salary_actuals'; END IF;
  IF NOT sa_del THEN RAISE EXCEPTION 'post-flight: service_role missing DELETE on labor_salary_actuals'; END IF;
  IF sa_upd     THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on labor_salary_actuals (rebuild is delete+insert, no UPDATE)'; END IF;
  -- No TRUNCATE assertion on service_role: precedent (labor_actuals,
  -- purchasing_actuals) leaves service_role's inherited TRUNCATE in
  -- place. The REVOKE block above fences anon + authenticated per
  -- house rule; service_role is not part of that fence.

  RAISE NOTICE 'salary-1b post-flight PASS - table + indexes + UNIQUE present, grants set (no UPDATE; anon/authenticated fenced from TRUNCATE)';
END $$;

COMMIT;
