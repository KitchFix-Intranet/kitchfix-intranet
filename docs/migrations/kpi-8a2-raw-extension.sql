-- kpi-8a2-raw-extension.sql
-- KPI PR 8a-2: extend the PR 8a raw ingest pattern to two more Rippling
-- objects that PR 8b's attribution derivation needs.
--
-- Adds two tables + views on top of PR 8a:
--
--   rippling_raw_workers                append-only raw ingest, same shape as
--                                       rippling_raw_time_entries / _pay_segments
--   rippling_raw_workers_latest         DISTINCT ON view, N11 (latest by timestamp)
--   rippling_raw_time_entry_zo          same shape
--   rippling_raw_time_entry_zo_latest   same _latest view pattern
--
-- Why this PR exists separately from PR 8b:
--
--   Raw ingest and attribution have different failure modes and different
--   verification. PR 8a proved retrieval is lossless against a figure
--   Kevin had personally checked; PR 8b proves attribution is correct.
--   Bundling them would have meant debugging both at once. The same
--   reasoning applied when PR 8a and PR 8b were split, and it applies
--   again here: two new raw tables, two new sync walks, two new hash-
--   exclusion sets, and a backfill for both belong on their own PR so
--   that when 8b's attribution work begins nobody has to wonder whether
--   the underlying data is sound.
--
-- Why these two objects matter for the eventual attribution pipeline:
--
--   1. `rippling_raw_workers` is what carries `department_id` per worker.
--      Neither `time_entries` nor `pay_segments` payloads carry it.
--      Without workers in Postgres, the derivation either calls Rippling
--      at runtime (breaking the "never calls Rippling" rule) or cannot
--      resolve worker -> department -> account at all.
--
--   2. `rippling_raw_time_entry_zo` is the bridge between the two
--      id-spaces that PR 8a landed. Verified end-to-end on 2026-08-05:
--
--        pay_segment.time_entry.id  (36-char UUID)
--          -> time_entry_zo.id      (same UUID, direct match)
--        time_entry_zo.external_id  (24-char Mongo ObjectId)
--          -> time_entries.rippling_id (same ObjectId, direct match)
--
--      Without time_entry_zo, the only way to associate a pay_segment
--      with a time_entry (and therefore with its approval status) is a
--      worker-plus-date heuristic. That heuristic was measured at
--      **40.8% coverage on PAID entries** across the full 8,965-row
--      set, because overnight shifts, split shifts, and corrections
--      collapse or double-count in ways nothing in the data can
--      distinguish. A heuristic is not a join.
--
--      time_entry_zo also carries `status` directly, so once ingested
--      the derivation can compute `approval_state` per attribution
--      bucket with dollar-accurate splits rather than a decorative
--      count from a loose join.
--
-- Same design rules as PR 8a apply and are stated in the kpi-8a header:
--   - Append-only-on-hash-change; dedup is app-side, not DB-enforced.
--   - No `UNIQUE (rippling_id, content_hash)` - revert cycles must land
--     the third observation. DB-side uniqueness would silently drop it
--     under ON CONFLICT DO NOTHING.
--   - `_latest` view via DISTINCT ON ordered by fetched_at DESC, id DESC.
--     N11: latest by timestamp, never row order.
--   - Grants: SELECT + INSERT to service_role only. UPDATE and DELETE
--     asserted absent in post-flight.
--
-- Hash exclusion sets:
--
--   Workers: `[updated_at, __meta]` is the measured minimum. Two pulls
--   14 minutes apart on 2026-08-05 showed zero fields moving on any of
--   1,126 workers - the interval was uneventful. Additional defensive
--   exclusions in src/lib/rippling.js (user, manager, legal_entity,
--   employment_type, compensation, department, teams, job_function,
--   business_partners) are harmless because those top-level nested
--   objects return null on this endpoint; null hashes identically.
--   The first nightly run is the real test.
--
--   time_entry_zo: measured empirically before the sync script extension.
--   Measurement recorded in the code comment on HASH_EXCLUDE_TOP in
--   src/lib/rippling.js. Both errors on this branch (- REDS and
--   "different id space") were reasonable inferences from partial
--   evidence; the exclusion set does not get the same benefit of doubt.
--
-- Applied: NOT YET (draft PR). Transactional; failure rolls back the
-- entire migration.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
DECLARE
  wk_bad_uq TEXT;
  zo_bad_uq TEXT;
BEGIN
  -- PR 8a raw tables must be present
  IF to_regclass('public.rippling_raw_time_entries')          IS NULL THEN
    RAISE EXCEPTION 'kpi-8a2 pre-flight: rippling_raw_time_entries missing - PR 8a must land first';
  END IF;
  IF to_regclass('public.rippling_raw_pay_segments')          IS NULL THEN
    RAISE EXCEPTION 'kpi-8a2 pre-flight: rippling_raw_pay_segments missing - PR 8a must land first';
  END IF;
  IF to_regclass('public.rippling_raw_time_entries_latest')   IS NULL THEN
    RAISE EXCEPTION 'kpi-8a2 pre-flight: rippling_raw_time_entries_latest missing - PR 8a must land first';
  END IF;
  IF to_regclass('public.rippling_raw_pay_segments_latest')   IS NULL THEN
    RAISE EXCEPTION 'kpi-8a2 pre-flight: rippling_raw_pay_segments_latest missing - PR 8a must land first';
  END IF;

  -- Half-applied guards: if either new table already exists (from a
  -- prior aborted attempt), it must NOT carry a UNIQUE on
  -- (rippling_id, content_hash). Same revert-cycle rationale as kpi-8a.
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
      RAISE EXCEPTION 'kpi-8a2 pre-flight: rippling_raw_workers has a pre-existing UNIQUE on (rippling_id, content_hash) named %. Drop it first: ALTER TABLE rippling_raw_workers DROP CONSTRAINT %I;', wk_bad_uq, wk_bad_uq;
    END IF;
  END IF;
  IF to_regclass('public.rippling_raw_time_entry_zo') IS NOT NULL THEN
    SELECT c.conname INTO zo_bad_uq
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_time_entry_zo'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
    LIMIT 1;
    IF zo_bad_uq IS NOT NULL THEN
      RAISE EXCEPTION 'kpi-8a2 pre-flight: rippling_raw_time_entry_zo has a pre-existing UNIQUE on (rippling_id, content_hash) named %. Drop it first: ALTER TABLE rippling_raw_time_entry_zo DROP CONSTRAINT %I;', zo_bad_uq, zo_bad_uq;
    END IF;
  END IF;
END $$;

-- ─── rippling_raw_workers ───────────────────────────────────────────
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

-- ─── rippling_raw_time_entry_zo ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS rippling_raw_time_entry_zo (
  id           BIGSERIAL PRIMARY KEY,
  rippling_id  TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual'))
  -- Same rationale as rippling_raw_workers: no UNIQUE.
);

CREATE INDEX IF NOT EXISTS rippling_raw_time_entry_zo_latest_idx
  ON rippling_raw_time_entry_zo (rippling_id, fetched_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rippling_raw_time_entry_zo_fetched_at_idx
  ON rippling_raw_time_entry_zo (fetched_at DESC);

CREATE OR REPLACE VIEW rippling_raw_time_entry_zo_latest AS
  SELECT DISTINCT ON (rippling_id)
    id, rippling_id, content_hash, payload, fetched_at, fetch_source
  FROM rippling_raw_time_entry_zo
  ORDER BY rippling_id, fetched_at DESC, id DESC;

-- ─── Grants ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON rippling_raw_workers                     TO service_role;
GRANT USAGE          ON SEQUENCE rippling_raw_workers_id_seq     TO service_role;
GRANT SELECT         ON rippling_raw_workers_latest              TO service_role;

GRANT SELECT, INSERT ON rippling_raw_time_entry_zo               TO service_role;
GRANT USAGE          ON SEQUENCE rippling_raw_time_entry_zo_id_seq TO service_role;
GRANT SELECT         ON rippling_raw_time_entry_zo_latest        TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  wk_sel BOOLEAN; wk_ins BOOLEAN; wk_upd BOOLEAN; wk_del BOOLEAN; wk_lat BOOLEAN;
  zo_sel BOOLEAN; zo_ins BOOLEAN; zo_upd BOOLEAN; zo_del BOOLEAN; zo_lat BOOLEAN;
BEGIN
  -- Structure: both tables + both views exist
  IF to_regclass('public.rippling_raw_workers')                IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_workers missing'; END IF;
  IF to_regclass('public.rippling_raw_workers_latest')         IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_workers_latest missing'; END IF;
  IF to_regclass('public.rippling_raw_time_entry_zo')          IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_time_entry_zo missing'; END IF;
  IF to_regclass('public.rippling_raw_time_entry_zo_latest')   IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_time_entry_zo_latest missing'; END IF;

  -- Structure: indexes exist on both tables (compound latest + fetched_at-only)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_workers'
      AND indexname  = 'rippling_raw_workers_latest_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_workers_latest_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_workers'
      AND indexname  = 'rippling_raw_workers_fetched_at_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_workers_fetched_at_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_time_entry_zo'
      AND indexname  = 'rippling_raw_time_entry_zo_latest_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entry_zo_latest_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_time_entry_zo'
      AND indexname  = 'rippling_raw_time_entry_zo_fetched_at_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entry_zo_fetched_at_idx missing';
  END IF;

  -- Negative-space: neither table may carry a UNIQUE on
  -- (rippling_id, content_hash). Guards a well-intentioned future
  -- migration re-adding it and breaking revert cycles.
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
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_time_entry_zo'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entry_zo has a UNIQUE on (rippling_id, content_hash) - must not exist';
  END IF;

  -- Positive grants: SELECT + INSERT on both tables, SELECT on both views
  wk_sel := has_table_privilege('service_role', 'rippling_raw_workers', 'SELECT');
  wk_ins := has_table_privilege('service_role', 'rippling_raw_workers', 'INSERT');
  wk_upd := has_table_privilege('service_role', 'rippling_raw_workers', 'UPDATE');
  wk_del := has_table_privilege('service_role', 'rippling_raw_workers', 'DELETE');
  wk_lat := has_table_privilege('service_role', 'rippling_raw_workers_latest', 'SELECT');
  zo_sel := has_table_privilege('service_role', 'rippling_raw_time_entry_zo', 'SELECT');
  zo_ins := has_table_privilege('service_role', 'rippling_raw_time_entry_zo', 'INSERT');
  zo_upd := has_table_privilege('service_role', 'rippling_raw_time_entry_zo', 'UPDATE');
  zo_del := has_table_privilege('service_role', 'rippling_raw_time_entry_zo', 'DELETE');
  zo_lat := has_table_privilege('service_role', 'rippling_raw_time_entry_zo_latest', 'SELECT');

  IF NOT wk_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_workers'; END IF;
  IF NOT wk_ins THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_raw_workers'; END IF;
  IF NOT wk_lat THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_workers_latest'; END IF;
  IF NOT zo_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_time_entry_zo'; END IF;
  IF NOT zo_ins THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_raw_time_entry_zo'; END IF;
  IF NOT zo_lat THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_time_entry_zo_latest'; END IF;

  -- Negative-space grants: UPDATE and DELETE MUST NOT be present
  IF wk_upd THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_workers (must be append-only)'; END IF;
  IF wk_del THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_workers (must be append-only)'; END IF;
  IF zo_upd THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_time_entry_zo (must be append-only)'; END IF;
  IF zo_del THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_time_entry_zo (must be append-only)'; END IF;

  RAISE NOTICE 'kpi-8a2 post-flight PASS - two raw tables + views + indexes + positive grants present, negative-space grants absent';
END $$;

COMMIT;
