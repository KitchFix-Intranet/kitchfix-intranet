-- salary-1a-rippling-raw-compensations.sql
-- Salary PR 1 · migration 1a: raw Rippling compensation ingest.
--
-- One table + one _latest view + one lock table, same shape and same
-- append-only-on-hash-change semantics as rippling_raw_workers
-- (kpi-8a2). S0 + S0b established the endpoint model:
--
--   /workers returns compensation: null with a top-level
--   `compensation_id` reference; the compensation record itself lives
--   at /compensations/{id} and cursor-walks at /compensations. The
--   record shape (S0b sample):
--       { id, worker_id, annual_compensation:{value,currency_type},
--         hourly_wage:{value,currency_type}, payment_type,
--         salary_effective_date, ... }
--
-- This migration lands the raw table. The compensations walk added to
-- rippling_sync.mjs writes rows here; the salary derive reads them via
-- rippling_raw_compensations_latest and joins to a worker by worker_id.
--
-- Header choices, cited so a future reader does not "clean them up":
--
--   Append-only-on-hash-change (no UNIQUE on rippling_id, content_hash):
--     Same rationale as kpi-8a. A record that goes X -> Y -> X (raise
--     applied, reverted) must land the third observation; DB-side
--     uniqueness would drop it silently under ON CONFLICT DO NOTHING
--     and leave the audit trail lying. App-side compare-then-insert.
--
--   Projected convenience columns (worker_id, payment_type, annual_value,
--   salary_effective_date, currency):
--     Written by the walk from the JSONB payload. The payload stays
--     authoritative; the projections exist so the derive can filter on
--     payment_type + join on worker_id + resolve effective dates
--     without JSONB unpacking on every row read. All nullable in case
--     Rippling drops a field mid-walk (schema drift never hard-fails
--     the walk).
--
--   fetched_at (not first_seen_at / last_seen_at):
--     The spec enumerated (first_seen_at, last_seen_at) but said "same
--     shape as rippling_raw_workers" in the same clause. Workers is
--     `fetched_at` only. First/last-seen implies UPDATE semantics
--     (bump last_seen on unchanged) which contradicts the spec's own
--     grants (mirror rippling_raw_workers = SELECT + INSERT only, no
--     UPDATE). Chose fetched_at for shape parity + grant consistency.
--     Every observation is one row; the _latest view collapses them.
--
--   Grants mirror rippling_raw_workers exactly:
--     SELECT + INSERT to service_role. UPDATE and DELETE explicitly
--     absent. Post-flight asserts both negative and positive grants.
--
--   Filter surface = none on the Rippling side:
--     S0b confirmed /compensations?worker_id= returned 5 rows on a
--     single-worker query, which matches the known silently-ignored
--     filter behaviour on /time-entries. Cursor-walk only.
--
-- Applied: TBD in Supabase Studio. Post-flight assertions run inside
-- the same transaction as the DDL; a failure rolls back the whole
-- migration.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
DECLARE
  cp_bad_uq TEXT;
BEGIN
  -- Marker: PR 1 spine landed (same guard the kpi-8a family uses).
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'salary-1a pre-flight: kpi_lines missing - PR 1 spine must land first';
  END IF;

  -- Rippling raw ingest infrastructure (kpi-8a2) must be in place so
  -- the compensations walk shares the lock table + fetch_source CHECK.
  IF to_regclass('public.rippling_raw_workers') IS NULL THEN
    RAISE EXCEPTION 'salary-1a pre-flight: rippling_raw_workers missing - kpi-8a2 must land first';
  END IF;
  IF to_regclass('public.rippling_sync_locks') IS NULL THEN
    RAISE EXCEPTION 'salary-1a pre-flight: rippling_sync_locks missing - kpi-8a must land first';
  END IF;

  -- Half-applied guard: if the table exists it MUST NOT carry a UNIQUE
  -- on (rippling_id, content_hash). Same rationale as kpi-8a2.
  IF to_regclass('public.rippling_raw_compensations') IS NOT NULL THEN
    SELECT c.conname INTO cp_bad_uq
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_compensations'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
    LIMIT 1;
    IF cp_bad_uq IS NOT NULL THEN
      RAISE EXCEPTION 'salary-1a pre-flight: rippling_raw_compensations has a pre-existing UNIQUE on (rippling_id, content_hash) named %. Drop it first: ALTER TABLE rippling_raw_compensations DROP CONSTRAINT %I;', cp_bad_uq, cp_bad_uq;
    END IF;
  END IF;
END $$;

-- ─── rippling_raw_compensations ─────────────────────────────────────
-- id / rippling_id / content_hash / payload / fetched_at / fetch_source
-- mirror rippling_raw_workers. The projection columns below are new:
-- they are cheap read-only convenience for the salary derive.
CREATE TABLE IF NOT EXISTS rippling_raw_compensations (
  id                     BIGSERIAL PRIMARY KEY,
  rippling_id            TEXT        NOT NULL,
  content_hash           TEXT        NOT NULL,
  payload                JSONB       NOT NULL,
  fetched_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source           TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual')),
  -- Projections written by the walk from `payload`. Payload stays
  -- authoritative; these exist so the derive can filter + join without
  -- JSONB unpacking on every read.
  worker_id              TEXT,
  payment_type           TEXT,
  annual_value           NUMERIC(14, 2),
  salary_effective_date  DATE,
  currency               TEXT
  -- NO UNIQUE constraint on (rippling_id, content_hash). See header
  -- rationale.
);

-- Supports the DISTINCT ON in rippling_raw_compensations_latest and the
-- per-rippling_id current-hash lookup the sync issues before deciding
-- whether to insert.
CREATE INDEX IF NOT EXISTS rippling_raw_compensations_latest_idx
  ON rippling_raw_compensations (rippling_id, fetched_at DESC, id DESC);

-- Nightly delta queries ("what did we write since t0").
CREATE INDEX IF NOT EXISTS rippling_raw_compensations_fetched_at_idx
  ON rippling_raw_compensations (fetched_at DESC);

-- Effective-date lookup: for a given worker, find the latest
-- compensation record whose salary_effective_date <= week_start. The
-- derive hits this index once per (worker, week) pair.
CREATE INDEX IF NOT EXISTS rippling_raw_compensations_worker_effective_idx
  ON rippling_raw_compensations (worker_id, salary_effective_date DESC);

-- ─── rippling_raw_compensations_latest view ─────────────────────────
-- DISTINCT ON (rippling_id) - the currently-visible compensation
-- record per compensation_id. Ordered by fetched_at DESC, id DESC (N11:
-- latest wins by timestamp, id tiebreaker for same-millisecond inserts
-- inside one sync run).
CREATE OR REPLACE VIEW rippling_raw_compensations_latest AS
  SELECT DISTINCT ON (rippling_id)
    id, rippling_id, content_hash, payload, fetched_at, fetch_source,
    worker_id, payment_type, annual_value, salary_effective_date, currency
  FROM rippling_raw_compensations
  ORDER BY rippling_id, fetched_at DESC, id DESC;

-- ─── Extend CHECK constraints on kind columns ───────────────────────
-- rippling_walks + rippling_current_presence gate `kind` to the known
-- set. Same named-constraint drop-and-add pattern kpi-c5 used to add
-- 'users'. Match by column via conkey (pg_get_constraintdef renders
-- IN as `= ANY(ARRAY[...])`; string matching on 'IN' would miss).
DO $$
DECLARE
  walks_cn TEXT; walks_cnt INTEGER;
  pres_cn  TEXT; pres_cnt  INTEGER;
BEGIN
  SELECT count(*), max(c.conname) INTO walks_cnt, walks_cn
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'rippling_walks'
    AND c.contype = 'c'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attname = 'kind' AND a.attnum = ANY (c.conkey)
    );
  IF walks_cnt = 0 THEN RAISE EXCEPTION 'salary-1a: kind CHECK missing on rippling_walks'; END IF;
  IF walks_cnt > 1 THEN RAISE EXCEPTION 'salary-1a: % kind CHECK constraints on rippling_walks; refusing to drop arbitrarily', walks_cnt; END IF;
  EXECUTE format('ALTER TABLE rippling_walks DROP CONSTRAINT %I', walks_cn);
  ALTER TABLE rippling_walks
    ADD CONSTRAINT rippling_walks_kind_check
    CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo','users','compensations'));

  SELECT count(*), max(c.conname) INTO pres_cnt, pres_cn
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'rippling_current_presence'
    AND c.contype = 'c'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attname = 'kind' AND a.attnum = ANY (c.conkey)
    );
  IF pres_cnt = 0 THEN RAISE EXCEPTION 'salary-1a: kind CHECK missing on rippling_current_presence'; END IF;
  IF pres_cnt > 1 THEN RAISE EXCEPTION 'salary-1a: % kind CHECK constraints on rippling_current_presence; refusing to drop arbitrarily', pres_cnt; END IF;
  EXECUTE format('ALTER TABLE rippling_current_presence DROP CONSTRAINT %I', pres_cn);
  ALTER TABLE rippling_current_presence
    ADD CONSTRAINT rippling_current_presence_kind_check
    CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo','users','compensations'));
END $$;

-- ─── Grants ─────────────────────────────────────────────────────────
-- SELECT + INSERT only, mirror rippling_raw_workers. UPDATE + DELETE
-- absent by construction; post-flight asserts both.
GRANT SELECT, INSERT ON rippling_raw_compensations              TO service_role;
GRANT USAGE          ON SEQUENCE rippling_raw_compensations_id_seq TO service_role;
GRANT SELECT         ON rippling_raw_compensations_latest       TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  cp_sel BOOLEAN; cp_ins BOOLEAN; cp_upd BOOLEAN; cp_del BOOLEAN;
  cp_lat_sel BOOLEAN;
  cp_uq_present BOOLEAN;
BEGIN
  -- Structure: table + view exist.
  IF to_regclass('public.rippling_raw_compensations') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_compensations missing';
  END IF;
  IF to_regclass('public.rippling_raw_compensations_latest') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_compensations_latest view missing';
  END IF;

  -- Structure: all three indexes exist.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND tablename='rippling_raw_compensations' AND indexname='rippling_raw_compensations_latest_idx') THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_compensations_latest_idx missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND tablename='rippling_raw_compensations' AND indexname='rippling_raw_compensations_fetched_at_idx') THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_compensations_fetched_at_idx missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND tablename='rippling_raw_compensations' AND indexname='rippling_raw_compensations_worker_effective_idx') THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_compensations_worker_effective_idx missing';
  END IF;

  -- Structure: no UNIQUE on (rippling_id, content_hash).
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_compensations'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
  ) INTO cp_uq_present;
  IF cp_uq_present THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_compensations has a UNIQUE on (rippling_id, content_hash) - see header for why this must not exist';
  END IF;

  -- Positive grants: service_role has SELECT + INSERT.
  cp_sel := has_table_privilege('service_role', 'rippling_raw_compensations', 'SELECT');
  cp_ins := has_table_privilege('service_role', 'rippling_raw_compensations', 'INSERT');
  cp_lat_sel := has_table_privilege('service_role', 'rippling_raw_compensations_latest', 'SELECT');
  IF NOT cp_sel     THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_compensations'; END IF;
  IF NOT cp_ins     THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_raw_compensations'; END IF;
  IF NOT cp_lat_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_compensations_latest'; END IF;

  -- Negative-space grants: UPDATE and DELETE must NOT be present.
  cp_upd := has_table_privilege('service_role', 'rippling_raw_compensations', 'UPDATE');
  cp_del := has_table_privilege('service_role', 'rippling_raw_compensations', 'DELETE');
  IF cp_upd THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_compensations (must be append-only)'; END IF;
  IF cp_del THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_compensations (must be append-only)'; END IF;

  RAISE NOTICE 'salary-1a post-flight PASS - table/view/indexes present, positive grants set, UPDATE + DELETE absent';
END $$;

COMMIT;
