-- purchasing-7-report-txns.sql
--
-- Phase-two report ingest. Adds a second table fed by the same
-- scheduled email lane that PR #834 built.  `rippling_report_seen_txns`
-- stays as it is - an ID set for Ruling 4 arbitration.  The new table
-- captures every projected column the CSV carries, plus the raw row
-- as JSONB for future-proofing.
--
-- Design:
--   - Append-on-content-hash (same pattern as rippling_raw_spend_lines).
--     Idempotent re-ingest is a no-op via ON CONFLICT DO NOTHING on
--     (parent_txn_id, content_hash).
--   - `raw` JSONB stores the full row so a column we did not project
--     today is recoverable in six months without another CSV.
--   - `employee` and `employee_id` are PII.  They are stored (schema
--     needs them for future compliance / attribution decisions) but
--     the loader, all probes and every log line must treat them as
--     write-only.  Never render, never join, never print.
--   - No foreign keys to purchasing_actuals.  Merge is out of scope
--     for this PR - see PR body §C.
--
-- APPLY IN STUDIO before merging the PR that reads / writes this
-- table.  Verify queries at the file foot.

BEGIN;

CREATE TABLE IF NOT EXISTS rippling_report_txns (
  id                BIGSERIAL PRIMARY KEY,
  parent_txn_id     TEXT NOT NULL,
  content_hash      TEXT NOT NULL,

  -- Projected columns (24 fields on 2026-08-26 export).
  purchased_at      DATE,
  posted_date       DATE,
  submission_date   DATE,
  approved_at       TIMESTAMPTZ,
  approval_state    TEXT,
  has_receipt       BOOLEAN,
  amount            NUMERIC(14, 2),
  currency          TEXT,
  vendor_name       TEXT,
  vendor            TEXT,
  category          TEXT,
  category_name     TEXT,
  department_name   TEXT,
  work_location     TEXT,
  employee          TEXT,     -- PII: never log, never render on a board
  employee_id       TEXT,     -- PII: never log, never render on a board
  memo              TEXT,
  line_item_memo    TEXT,
  gl_sync_status    TEXT,
  gl_vendor_name    TEXT,
  is_manually_paid  BOOLEAN,
  repayment_status  TEXT,
  is_user_edited    BOOLEAN,

  -- Full row payload for future coverage.  A field we forget to project
  -- today is still recoverable via `raw` without a re-ingest.
  raw               JSONB NOT NULL,

  -- Observability
  fetch_source      TEXT NOT NULL DEFAULT 'email_ingest',
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Content hash disambiguates category-split rows (5,346 CSV rows vs
  -- 5,274 distinct parent_txn_ids on the 2026-08-26 export = 72 rows
  -- with duplicate parent_txn_id but distinct content).  Same
  -- (parent_txn_id, content) means same row: dedup on re-ingest.
  UNIQUE (parent_txn_id, content_hash)
);

-- Indexes
CREATE INDEX IF NOT EXISTS rippling_report_txns_parent_idx
  ON rippling_report_txns (parent_txn_id);
CREATE INDEX IF NOT EXISTS rippling_report_txns_purchased_at_idx
  ON rippling_report_txns (purchased_at DESC);
CREATE INDEX IF NOT EXISTS rippling_report_txns_last_seen_idx
  ON rippling_report_txns (last_seen_at DESC);

-- Grants.  Same discipline as every other Postgres-native table on
-- this project - the service_role runs the loader, the API reads via
-- the anon role only where a public view exists.  No anon grant here
-- because the table carries PII.
GRANT SELECT, INSERT, UPDATE, DELETE ON rippling_report_txns TO service_role;
GRANT USAGE, SELECT ON SEQUENCE rippling_report_txns_id_seq TO service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════
-- Verify queries (run in Studio SQL editor after APPLY).
-- ═════════════════════════════════════════════════════════════════
--
-- 1. Table + grants (guards against the "structural verify passed on
--    an empty grant" incident from billcom_ref_vendors):
--
-- SELECT grantee, privilege_type
-- FROM   information_schema.role_table_grants
-- WHERE  table_schema = 'public'
--   AND  table_name   = 'rippling_report_txns'
-- ORDER  BY grantee, privilege_type;
--
-- Expected: service_role rows for SELECT, INSERT, UPDATE, DELETE.
--
-- 2. Unique constraint:
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM   pg_constraint
-- WHERE  conrelid = 'rippling_report_txns'::regclass
--   AND  contype  = 'u';
--
-- Expected: UNIQUE (parent_txn_id, content_hash).
--
-- 3. Row count AFTER the first ingest (guards against the
--    "structural verify passed on an empty table" incident:
--    billcom_ref_vendors passed six checks while holding zero rows):
--
-- SELECT COUNT(*) FROM rippling_report_txns;
--
-- Expected: > 0 within 24h of first workflow run.
--
-- 4. Idempotency check (run twice on the same CSV via workflow
--    dry-run; the count should not change on the second run):
--
-- SELECT COUNT(*) AS row_count, COUNT(DISTINCT parent_txn_id) AS distinct_parents
-- FROM   rippling_report_txns;
