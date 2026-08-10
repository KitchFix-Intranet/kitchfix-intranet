-- kpi-c5-users-raw.sql
--
-- KPI PR C5: adds the /users raw ingest, follows kpi-8a / kpi-8a2.
--
-- Adds:
--   rippling_raw_users         append-only, same shape as the other four raw tables
--   rippling_raw_users_latest  DISTINCT ON view, N11 latest-by-timestamp
--   ALTER rippling_walks.kind  CHECK now allows 'users'
--   ALTER rippling_current_presence.kind CHECK now allows 'users'
--
-- Why this PR exists separately:
--
--   Names live on /users, not /workers. The C3 diagnostic confirmed:
--   1,126 of 1,126 worker payloads have `user_id` populated and `user`
--   null; the endpoint's response schema does not include name fields.
--   The C5.1 probe confirmed /users returns 200 with a `name` object +
--   `display_name`, and record.id shares the 24-char lowercase-hex
--   Mongo-ObjectId shape with worker.user_id, so the join is safe.
--
-- Name resolution at read time only:
--
--   Nothing in this migration writes names into labor_actuals or any
--   derived table. Names are joined on the read path (worker.user_id
--   -> users.rippling_id -> canonical name field). If a worker is
--   removed from Rippling, presence expiry drops them from the users
--   view; nothing has to be scrubbed from derived data.
--
-- HASH_EXCLUDE_TOP for the new kind:
--
--   src/lib/rippling.js gains a `users: ["updated_at", "__meta"]`
--   entry. Same reasoning as `workers`: the universal nested-strip
--   handles image-URL rotation on any nested photo/avatar fields.
--   Photos on /users are top-level arrays of objects; the universal
--   `image` strip inside those objects protects the hash without
--   needing to top-level-exclude the whole `photos` field, which
--   would mask real photo changes. The first nightly is the test.
--
-- Fifth kind on the CHECK constraints:
--
--   rippling_walks.kind and rippling_current_presence.kind currently
--   allow four values. This migration ALTER-drops both constraints
--   and re-adds them with 'users' included. Without this, the sync
--   inserts a walks row with kind='users' and the walk fails at
--   INSERT time with a constraint violation.
--
-- Applied: NOT YET (draft PR). Transactional; failure rolls back the
-- entire migration.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
DECLARE
  bad_uq TEXT;
BEGIN
  -- kpi-8ba must be present (kind CHECK constraints live there)
  IF to_regclass('public.rippling_walks') IS NULL THEN
    RAISE EXCEPTION 'kpi-c5 pre-flight: rippling_walks missing - kpi-8ba must be applied first';
  END IF;
  IF to_regclass('public.rippling_current_presence') IS NULL THEN
    RAISE EXCEPTION 'kpi-c5 pre-flight: rippling_current_presence missing - kpi-8ba must be applied first';
  END IF;

  -- Half-applied guard on the new raw table
  IF to_regclass('public.rippling_raw_users') IS NOT NULL THEN
    SELECT c.conname INTO bad_uq
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_users'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
    LIMIT 1;
    IF bad_uq IS NOT NULL THEN
      RAISE EXCEPTION 'kpi-c5 pre-flight: rippling_raw_users has a pre-existing UNIQUE on (rippling_id, content_hash) named %. Drop it first: ALTER TABLE rippling_raw_users DROP CONSTRAINT %I;', bad_uq, bad_uq;
    END IF;
  END IF;
END $$;

-- ─── rippling_raw_users ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rippling_raw_users (
  id           BIGSERIAL PRIMARY KEY,
  rippling_id  TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual'))
  -- NO UNIQUE on (rippling_id, content_hash). Revert cycles must land the third observation.
);

CREATE INDEX IF NOT EXISTS rippling_raw_users_latest_idx
  ON rippling_raw_users (rippling_id, fetched_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rippling_raw_users_fetched_at_idx
  ON rippling_raw_users (fetched_at DESC);

CREATE OR REPLACE VIEW rippling_raw_users_latest AS
  SELECT DISTINCT ON (rippling_id)
    id, rippling_id, content_hash, payload, fetched_at, fetch_source
  FROM rippling_raw_users
  ORDER BY rippling_id, fetched_at DESC, id DESC;

-- ─── Extend CHECK constraints on kind columns ───────────────────────
-- Both rippling_walks and rippling_current_presence gate `kind` to the
-- known-good set. Add 'users' to both. Named-constraint drop-and-add
-- keeps this idempotent-safe on re-apply. Constraint names in the
-- CHECK-in-CREATE-TABLE form get auto-generated (rippling_walks_kind_check),
-- so drop by the auto name and re-add with an explicit name we own.
DO $$
DECLARE
  walks_cn TEXT;
  pres_cn  TEXT;
BEGIN
  SELECT conname INTO walks_cn
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'rippling_walks'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%kind%IN%';
  IF walks_cn IS NULL THEN
    RAISE EXCEPTION 'kpi-c5: could not find kind CHECK constraint on rippling_walks';
  END IF;
  EXECUTE format('ALTER TABLE rippling_walks DROP CONSTRAINT %I', walks_cn);
  ALTER TABLE rippling_walks
    ADD CONSTRAINT rippling_walks_kind_check
    CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo','users'));

  SELECT conname INTO pres_cn
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'rippling_current_presence'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%kind%IN%';
  IF pres_cn IS NULL THEN
    RAISE EXCEPTION 'kpi-c5: could not find kind CHECK constraint on rippling_current_presence';
  END IF;
  EXECUTE format('ALTER TABLE rippling_current_presence DROP CONSTRAINT %I', pres_cn);
  ALTER TABLE rippling_current_presence
    ADD CONSTRAINT rippling_current_presence_kind_check
    CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo','users'));
END $$;

-- ─── Grants ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON rippling_raw_users                     TO service_role;
GRANT USAGE          ON SEQUENCE rippling_raw_users_id_seq     TO service_role;
GRANT SELECT         ON rippling_raw_users_latest              TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  us_sel BOOLEAN; us_ins BOOLEAN; us_upd BOOLEAN; us_del BOOLEAN; us_lat BOOLEAN;
  walks_has_users BOOLEAN;
  pres_has_users  BOOLEAN;
BEGIN
  -- Structure: table + view exist
  IF to_regclass('public.rippling_raw_users')                IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_users missing'; END IF;
  IF to_regclass('public.rippling_raw_users_latest')         IS NULL THEN RAISE EXCEPTION 'post-flight: rippling_raw_users_latest missing'; END IF;

  -- Structure: indexes
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_users'
      AND indexname  = 'rippling_raw_users_latest_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_users_latest_idx missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'rippling_raw_users'
      AND indexname  = 'rippling_raw_users_fetched_at_idx'
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_users_fetched_at_idx missing';
  END IF;

  -- Negative-space: no UNIQUE on (rippling_id, content_hash)
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'rippling_raw_users'
      AND c.contype = 'u'
      AND (SELECT array_agg(attname::text ORDER BY attnum)
           FROM pg_attribute
           WHERE attrelid = t.oid AND attnum = ANY(c.conkey))
          @> ARRAY['rippling_id', 'content_hash']
  ) THEN
    RAISE EXCEPTION 'post-flight: rippling_raw_users has a UNIQUE on (rippling_id, content_hash) - must not exist (revert-cycle trap)';
  END IF;

  -- CHECK constraints now include 'users'
  SELECT pg_get_constraintdef(c.oid) LIKE '%users%' INTO walks_has_users
  FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'rippling_walks' AND c.conname = 'rippling_walks_kind_check';
  IF NOT walks_has_users THEN
    RAISE EXCEPTION 'post-flight: rippling_walks_kind_check does not include users';
  END IF;

  SELECT pg_get_constraintdef(c.oid) LIKE '%users%' INTO pres_has_users
  FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'rippling_current_presence' AND c.conname = 'rippling_current_presence_kind_check';
  IF NOT pres_has_users THEN
    RAISE EXCEPTION 'post-flight: rippling_current_presence_kind_check does not include users';
  END IF;

  -- Grants
  us_sel := has_table_privilege('service_role', 'rippling_raw_users', 'SELECT');
  us_ins := has_table_privilege('service_role', 'rippling_raw_users', 'INSERT');
  us_upd := has_table_privilege('service_role', 'rippling_raw_users', 'UPDATE');
  us_del := has_table_privilege('service_role', 'rippling_raw_users', 'DELETE');
  us_lat := has_table_privilege('service_role', 'rippling_raw_users_latest', 'SELECT');

  IF NOT us_sel THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_users'; END IF;
  IF NOT us_ins THEN RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_raw_users'; END IF;
  IF NOT us_lat THEN RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_raw_users_latest'; END IF;
  IF us_upd    THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_users (must be append-only)'; END IF;
  IF us_del    THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_users (must be append-only)'; END IF;

  RAISE NOTICE 'kpi-c5 post-flight PASS - rippling_raw_users + view + indexes + grants + CHECK constraints extended';
END $$;

COMMIT;

-- ─── Rollback (paste in Studio if needed) ───────────────────────────
--   BEGIN;
--   -- Drop the users walk table + view
--   DROP VIEW  IF EXISTS rippling_raw_users_latest;
--   DROP TABLE IF EXISTS rippling_raw_users;
--   -- Revert the CHECK constraints to the four-value set (assumes no
--   -- rows exist with kind='users'; if they do, delete them first)
--   ALTER TABLE rippling_walks             DROP CONSTRAINT rippling_walks_kind_check;
--   ALTER TABLE rippling_walks             ADD CONSTRAINT rippling_walks_kind_check
--     CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo'));
--   ALTER TABLE rippling_current_presence  DROP CONSTRAINT rippling_current_presence_kind_check;
--   ALTER TABLE rippling_current_presence  ADD CONSTRAINT rippling_current_presence_kind_check
--     CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo'));
--   COMMIT;
