-- kpi-8a-rippling-raw.sql
-- KPI PR 8a: raw Rippling ingest.
--
-- Two tables, same shape, append-only-on-hash-change. Land the raw
-- payloads from two Rippling endpoints into Postgres:
--
--   /time-entries                                    -> rippling_raw_time_entries
--   /custom-objects/time_entry_computed_pay_segment  -> rippling_raw_pay_segments
--
-- Scope is raw only. No account attribution, no period bucketing, no
-- P&L line resolution - those are PR 8b, and 8b is what gates on Joe's
-- fiscal-year ruling. This migration lands raw objects and is NOT
-- blocked on any calendar decision.
--
-- Both tables are the same shape (rippling_id, content_hash, payload,
-- fetched_at, fetch_source) but modelled separately. The two objects
-- have different mutation semantics and different volatile-field sets
-- for hash computation, and every consumer of a hypothetical shared
-- table would carry a WHERE object_type = clause someone eventually
-- forgets. Two objects with different shapes and different mutation
-- semantics are two tables.
--
-- Append-only-on-hash-change:
--   - Each row is one immutable observation of the Rippling record at
--     one point in time.
--   - Dedup is app-side, NOT database-enforced. For each incoming
--     record the sync script looks up the latest hash for that
--     rippling_id and only inserts when the new hash differs.
--   - There is intentionally NO `UNIQUE (rippling_id, content_hash)`.
--     That constraint would express "never seen this exact payload,"
--     which breaks on revert: a record that goes X -> Y -> X (mis-keyed
--     punch fixed then un-fixed) would drop the third observation
--     silently under ON CONFLICT DO NOTHING, leaving the audit trail
--     lying and _latest returning Y forever. What we actually want is
--     "differs from what we last saw." That is a comparison against
--     the CURRENT latest, not against any historical row. App-side
--     compare-then-insert enforces the intent correctly and makes the
--     sync summary distinguish genuinely-unchanged from a failed
--     insert (which ON CONFLICT DO NOTHING silently conflates).
--   - When Rippling mutates a record (retro edit, pay re-run, revert),
--     the hash differs from the current latest and a new row inserts.
--     Old rows stay - they are the audit trail.
--   - The `_latest` view resolves the currently-visible record per
--     rippling_id via DISTINCT ON ordered by fetched_at DESC, id DESC.
--     N11: latest wins by TIMESTAMP, never by row order alone. The
--     `id DESC` tiebreaker exists for two rows at the same millisecond,
--     which can happen inside one sync run.
--
-- Grants:
--   SELECT + INSERT to service_role. UPDATE and DELETE are NOT granted
--   and the post-flight explicitly asserts their absence
--   (has_table_privilege returning false). "A new table needs an explicit
--   grant" (2026-08-04 GOTCHAS entry) applies in reverse here - a
--   permission we did not grant is exactly the kind of thing a future
--   migration can quietly add.
--
-- Filter surface:
--   None on the Rippling side. Discovery probe (2026-08-04) established
--   that Rippling's REST API silently ignores every date, worker_id, and
--   sort filter on both /time-entries and custom-objects/*/records - only
--   `limit` and `cursor` are honored. Full cursor walk from the first
--   page is mandatory on every sync.
--
-- Applied: NOT YET (draft PR). Post-flight assertions run inside the
-- same transaction as the DDL; a failure rolls back the whole migration.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  -- Marker: PR 1 spine landed. The kpi-8a tables are structurally
  -- independent of PR 1, but the migration order matters for the
  -- probe/verify surface, so refuse to apply if PR 1 has not run.
  IF to_regclass('public.kpi_lines') IS NULL THEN
    RAISE EXCEPTION 'kpi-8a pre-flight: kpi_lines missing - PR 1 spine must land first';
  END IF;
END $$;

-- ─── rippling_raw_time_entries ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rippling_raw_time_entries (
  id           BIGSERIAL PRIMARY KEY,
  rippling_id  TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual'))
  -- NO UNIQUE constraint on (rippling_id, content_hash). See header
  -- rationale: revert cycles (X -> Y -> X) must land the third
  -- observation; DB-side uniqueness would silently drop it.
);

-- Supports the DISTINCT ON in rippling_raw_time_entries_latest and
-- the per-rippling_id current-hash lookup the sync script issues before
-- deciding whether to insert.
CREATE INDEX IF NOT EXISTS rippling_raw_time_entries_latest_idx
  ON rippling_raw_time_entries (rippling_id, fetched_at DESC, id DESC);

-- Supports nightly delta queries ("what did we write since t0"). Kept
-- separate from the compound index above because fetched_at is not the
-- leading column there and cannot be used alone for a range scan.
CREATE INDEX IF NOT EXISTS rippling_raw_time_entries_fetched_at_idx
  ON rippling_raw_time_entries (fetched_at DESC);

-- ─── rippling_raw_pay_segments ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rippling_raw_pay_segments (
  id           BIGSERIAL PRIMARY KEY,
  rippling_id  TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual'))
  -- Same rationale as rippling_raw_time_entries: no UNIQUE.
);

CREATE INDEX IF NOT EXISTS rippling_raw_pay_segments_latest_idx
  ON rippling_raw_pay_segments (rippling_id, fetched_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rippling_raw_pay_segments_fetched_at_idx
  ON rippling_raw_pay_segments (fetched_at DESC);

-- ─── _latest views ──────────────────────────────────────────────────
-- Resolve the current record per rippling_id. ORDER BY fetched_at
-- DESC, id DESC picks the most recent observation; id DESC breaks
-- fetched_at ties (same-millisecond inserts inside one sync run).
-- Never rely on physical row order.

CREATE OR REPLACE VIEW rippling_raw_time_entries_latest AS
  SELECT DISTINCT ON (rippling_id)
    id, rippling_id, content_hash, payload, fetched_at, fetch_source
  FROM rippling_raw_time_entries
  ORDER BY rippling_id, fetched_at DESC, id DESC;

CREATE OR REPLACE VIEW rippling_raw_pay_segments_latest AS
  SELECT DISTINCT ON (rippling_id)
    id, rippling_id, content_hash, payload, fetched_at, fetch_source
  FROM rippling_raw_pay_segments
  ORDER BY rippling_id, fetched_at DESC, id DESC;

-- ─── Grants ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON rippling_raw_time_entries  TO service_role;
GRANT SELECT, INSERT ON rippling_raw_pay_segments  TO service_role;
GRANT USAGE           ON SEQUENCE rippling_raw_time_entries_id_seq TO service_role;
GRANT USAGE           ON SEQUENCE rippling_raw_pay_segments_id_seq TO service_role;
GRANT SELECT          ON rippling_raw_time_entries_latest TO service_role;
GRANT SELECT          ON rippling_raw_pay_segments_latest TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  te_sel BOOLEAN; te_ins BOOLEAN; te_upd BOOLEAN; te_del BOOLEAN;
  ps_sel BOOLEAN; ps_ins BOOLEAN; ps_upd BOOLEAN; ps_del BOOLEAN;
  te_lat_sel BOOLEAN; ps_lat_sel BOOLEAN;
BEGIN
  -- Structure: both tables and both views exist.
  IF to_regclass('public.rippling_raw_time_entries') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entries missing';
  END IF;
  IF to_regclass('public.rippling_raw_pay_segments') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_pay_segments missing';
  END IF;
  IF to_regclass('public.rippling_raw_time_entries_latest') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entries_latest view missing';
  END IF;
  IF to_regclass('public.rippling_raw_pay_segments_latest') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_pay_segments_latest view missing';
  END IF;

  -- Structure: all four indexes exist (compound latest + fetched_at-only
  -- per table).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_time_entries'
      AND indexname  = 'rippling_raw_time_entries_latest_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entries_latest_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_time_entries'
      AND indexname  = 'rippling_raw_time_entries_fetched_at_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entries_fetched_at_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_pay_segments'
      AND indexname  = 'rippling_raw_pay_segments_latest_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_pay_segments_latest_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_pay_segments'
      AND indexname  = 'rippling_raw_pay_segments_fetched_at_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_pay_segments_fetched_at_idx missing';
  END IF;

  -- Structure: no UNIQUE constraint on (rippling_id, content_hash) -
  -- app-side compare-then-insert is authoritative. Assert its absence
  -- to guard against a well-intentioned future migration adding it back
  -- and breaking revert cycles silently.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_time_entries'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_time_entries has a UNIQUE on (rippling_id, content_hash) - see header for why this must not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_pay_segments'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_pay_segments has a UNIQUE on (rippling_id, content_hash) - see header for why this must not exist';
  END IF;

  -- Positive grants: service_role has SELECT + INSERT on both tables.
  te_sel := has_table_privilege('service_role', 'rippling_raw_time_entries', 'SELECT');
  te_ins := has_table_privilege('service_role', 'rippling_raw_time_entries', 'INSERT');
  ps_sel := has_table_privilege('service_role', 'rippling_raw_pay_segments', 'SELECT');
  ps_ins := has_table_privilege('service_role', 'rippling_raw_pay_segments', 'INSERT');
  te_lat_sel := has_table_privilege('service_role', 'rippling_raw_time_entries_latest', 'SELECT');
  ps_lat_sel := has_table_privilege('service_role', 'rippling_raw_pay_segments_latest', 'SELECT');
  IF NOT te_sel     THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_time_entries'; END IF;
  IF NOT te_ins     THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_raw_time_entries'; END IF;
  IF NOT ps_sel     THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_pay_segments'; END IF;
  IF NOT ps_ins     THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_raw_pay_segments'; END IF;
  IF NOT te_lat_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_time_entries_latest'; END IF;
  IF NOT ps_lat_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_pay_segments_latest'; END IF;

  -- Negative-space grants: UPDATE and DELETE MUST NOT be present.
  -- These tables are append-only; a mutation grant would silently
  -- convert an audit trail into a mutable store.
  te_upd := has_table_privilege('service_role', 'rippling_raw_time_entries', 'UPDATE');
  te_del := has_table_privilege('service_role', 'rippling_raw_time_entries', 'DELETE');
  ps_upd := has_table_privilege('service_role', 'rippling_raw_pay_segments', 'UPDATE');
  ps_del := has_table_privilege('service_role', 'rippling_raw_pay_segments', 'DELETE');
  IF te_upd THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_time_entries (must be append-only)'; END IF;
  IF te_del THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_time_entries (must be append-only)'; END IF;
  IF ps_upd THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_pay_segments (must be append-only)'; END IF;
  IF ps_del THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_pay_segments (must be append-only)'; END IF;

  RAISE NOTICE 'kpi-8a post-flight PASS - tables/views/indexes/positive grants present, negative-space grants absent';
END $$;

COMMIT;
