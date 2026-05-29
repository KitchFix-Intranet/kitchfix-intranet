-- ═══════════════════════════════════════════════════════════════
-- PR 6.1 - Project 3 Module 6: Invoice PG schema
-- ═══════════════════════════════════════════════════════════════
--
-- Creates 4 invoice tables (invoice_submissions, invoice_rejections,
-- ai_line_items, gl_codes) per docs/FINANCE_STACK_PLAN.md Section 2.2
-- with the is_historical preservation-first pattern locked in PR #94
-- (see docs/MODULE_6_DATA_AUDIT.md Section 8).
--
-- PRESERVATION-FIRST DESIGN (the key architectural decision)
--
-- Each of the 4 tables gets 2 base columns:
--   is_historical    BOOLEAN NOT NULL DEFAULT FALSE
--   data_provenance  TEXT NOT NULL DEFAULT 'app_scan'
--                    CHECK (data_provenance IN
--                      ('app_scan','batch_rebuild','manual_entry','unknown'))
--
-- Strict integrity constraints (status enum, line_num UNIQUE, NOT NULL FK)
-- apply only when is_historical=FALSE via partial indexes and conditional
-- CHECK predicates. Sheets-era backfilled rows carry is_historical=TRUE +
-- the provenance tag and bypass the strict constraints while remaining
-- queryable and auditable. Future app writes default is_historical=FALSE
-- and get strict integrity enforcement.
--
-- Specific is_historical effects per table:
--   invoice_submissions:
--     - status CHECK gated: historical rows may carry any value;
--       new writes restricted to 'sent'/'returned'/'corrected'/'deleted'.
--     - ai_scan_status TEXT preserves the historical AI states
--       (complete/failed/pending/photo-only). ai_scan_complete BOOLEAN
--       is GENERATED ALWAYS AS (ai_scan_status = 'complete') for
--       backwards compatibility.
--     - F24 partial UNIQUE INDEX (dedup) only enforces on
--       is_historical=FALSE.
--   ai_line_items:
--     - invoice_uuid becomes NULLable + FK. Historical orphan rows
--       (REBUILD-* synthetics + parent-deleted UUIDs) use NULL
--       invoice_uuid + populate historical_invoice_ref TEXT.
--     - UNIQUE (invoice_uuid, line_num) only enforces on
--       is_historical=FALSE so the 4 known dupe pairs from Sheets pass
--       through.
--     - Two CHECKs ensure new rows have real FK AND historical rows
--       have either FK or historical_invoice_ref.
--   gl_codes + invoice_rejections: just the 2 base columns, no other
--     conditional constraints.
--
-- DDL is idempotent (IF NOT EXISTS) so re-running on DDL drift is safe.
--
-- See also:
--   docs/MODULE_6_DATA_AUDIT.md (Section 8 architecture)
--   docs/FINANCE_STACK_PLAN.md (Section 2.2 amended DDLs)
--   docs/modules/INVOICE_MODULE.md (handler reference, cross-module deps)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- invoice_submissions
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_submissions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid                 UUID UNIQUE,                              -- F25 idempotency
  submitted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitter_email             TEXT NOT NULL,
  account_key                 TEXT NOT NULL,
  vendor_name                 TEXT NOT NULL,                            -- display name (may differ from canonical due to alias)
  vendor_id                   TEXT NOT NULL REFERENCES vendors(id),
  invoice_number              TEXT,
  invoice_number_normalized   TEXT GENERATED ALWAYS AS (
                                  regexp_replace(coalesce(invoice_number, ''), '^#?0*', '')
                                ) STORED,
  invoice_date                DATE,
  total_amount                NUMERIC(12, 2) NOT NULL,
  gl_breakdown                JSONB NOT NULL,
  drive_urls                  TEXT[] NOT NULL DEFAULT '{}',
  page_count                  INTEGER NOT NULL DEFAULT 1,
  email_sent                  BOOLEAN NOT NULL DEFAULT false,
  status                      TEXT NOT NULL DEFAULT 'sent',
  status_updated_at           TIMESTAMPTZ,
  type                        TEXT NOT NULL DEFAULT 'invoice'
                                CHECK (type IN ('invoice', 'credit')),
  raw_drive_url               TEXT,
  corrected_from_uuid         UUID REFERENCES invoice_submissions(id),
  dupe_override               BOOLEAN NOT NULL DEFAULT false,
  ai_scan_status              TEXT
                                CHECK (ai_scan_status IS NULL OR ai_scan_status IN
                                  ('pending', 'complete', 'failed', 'photo-only')),
  ai_scan_complete            BOOLEAN GENERATED ALWAYS AS (
                                COALESCE(ai_scan_status, '') = 'complete'
                              ) STORED,
  is_historical               BOOLEAN NOT NULL DEFAULT FALSE,
  data_provenance             TEXT NOT NULL DEFAULT 'app_scan'
                                CHECK (data_provenance IN
                                  ('app_scan', 'batch_rebuild', 'manual_entry', 'unknown')),

  -- Status enum applies only to new writes; historical rows pass any value
  CONSTRAINT chk_status_enum CHECK (
    is_historical = TRUE OR status IN ('sent', 'returned', 'corrected', 'deleted')
  )
);

-- F24 field-based dedup as partial unique index. Gated on is_historical=FALSE
-- so backfilled potential dupes never block migration. Excludes corrected/
-- deleted statuses, rows that are corrections of a prior submission, and
-- rows explicitly marked dupe_override.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_submissions_field_dedup_idx
  ON invoice_submissions (vendor_id, invoice_number_normalized, invoice_date, total_amount)
  WHERE is_historical = FALSE
    AND status NOT IN ('corrected', 'deleted')
    AND corrected_from_uuid IS NULL
    AND dupe_override = false;

CREATE INDEX IF NOT EXISTS invoice_submissions_account_idx
  ON invoice_submissions (account_key, submitted_at DESC);

CREATE INDEX IF NOT EXISTS invoice_submissions_status_idx
  ON invoice_submissions (status, submitted_at DESC)
  WHERE is_historical = FALSE;

CREATE INDEX IF NOT EXISTS invoice_submissions_historical_idx
  ON invoice_submissions (is_historical, account_key, submitted_at DESC)
  WHERE is_historical = TRUE;

-- ─────────────────────────────────────────────────────────────
-- invoice_rejections
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_rejections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID NOT NULL REFERENCES invoice_submissions(id) ON DELETE CASCADE,
  rejected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  rejected_by         TEXT NOT NULL,
  reason              TEXT,                                              -- comma-separated reasons today
  note                TEXT,
  unrejected_at       TIMESTAMPTZ,                                       -- set when admin un-rejects
  unrejected_by       TEXT,
  is_historical       BOOLEAN NOT NULL DEFAULT FALSE,
  data_provenance     TEXT NOT NULL DEFAULT 'app_scan'
                        CHECK (data_provenance IN
                          ('app_scan', 'batch_rebuild', 'manual_entry', 'unknown')),

  UNIQUE (submission_id, rejected_at)                                    -- allow re-rejection history
);

CREATE INDEX IF NOT EXISTS invoice_rejections_submission_idx
  ON invoice_rejections (submission_id);

-- ─────────────────────────────────────────────────────────────
-- ai_line_items
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_line_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_uuid           UUID REFERENCES invoice_submissions(id) ON DELETE CASCADE,
  account_key            TEXT NOT NULL,                                  -- collapses per-account tab structure
  vendor_name            TEXT NOT NULL,
  invoice_number         TEXT,
  invoice_date           DATE,
  line_num               INTEGER NOT NULL,
  description            TEXT NOT NULL,
  quantity               NUMERIC,
  unit                   TEXT,
  unit_price             NUMERIC,
  extended_price         NUMERIC,
  category               TEXT,                                           -- 10-bucket OCR enum
  confidence             TEXT,
  raw_json               JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  historical_invoice_ref TEXT,                                           -- preserves "REBUILD-..." synthetic IDs or original UUID-as-text
  is_historical          BOOLEAN NOT NULL DEFAULT FALSE,
  data_provenance        TEXT NOT NULL DEFAULT 'app_scan'
                           CHECK (data_provenance IN
                             ('app_scan', 'batch_rebuild', 'manual_entry', 'unknown')),

  -- New writes MUST have a real parent FK; historical rows may use NULL
  -- invoice_uuid + populate historical_invoice_ref instead.
  CONSTRAINT chk_new_rows_have_parent CHECK (
    is_historical = TRUE OR invoice_uuid IS NOT NULL
  ),
  CONSTRAINT chk_historical_rows_have_parent_ref CHECK (
    is_historical = FALSE OR invoice_uuid IS NOT NULL OR historical_invoice_ref IS NOT NULL
  )
);

-- Cron idempotency UNIQUE applies only to new writes. Historical dupes pass.
CREATE UNIQUE INDEX IF NOT EXISTS ai_line_items_new_dedup_idx
  ON ai_line_items (invoice_uuid, line_num)
  WHERE is_historical = FALSE;

CREATE INDEX IF NOT EXISTS ai_line_items_account_invoice_idx
  ON ai_line_items (account_key, invoice_date DESC);

CREATE INDEX IF NOT EXISTS ai_line_items_invoice_idx
  ON ai_line_items (invoice_uuid)
  WHERE invoice_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_line_items_historical_lookup_idx
  ON ai_line_items (account_key, historical_invoice_ref, line_num)
  WHERE is_historical = TRUE;

-- ─────────────────────────────────────────────────────────────
-- gl_codes
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gl_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL,                                          -- per-account tab collapses
  category        TEXT,                                                   -- parsed from header rows
  code            TEXT NOT NULL,
  name            TEXT,
  is_purchasing   BOOLEAN NOT NULL DEFAULT true,                          -- Q8: replaces parseGLCodes business-rule filter
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_historical   BOOLEAN NOT NULL DEFAULT FALSE,
  data_provenance TEXT NOT NULL DEFAULT 'app_scan'
                    CHECK (data_provenance IN
                      ('app_scan', 'batch_rebuild', 'manual_entry', 'unknown')),

  UNIQUE (account_key, code)
);

CREATE INDEX IF NOT EXISTS gl_codes_account_idx
  ON gl_codes (account_key) WHERE active = true AND is_purchasing = true;

-- ─────────────────────────────────────────────────────────────
-- RLS: service-role only (mirrors PR 5.1 convention)
-- ─────────────────────────────────────────────────────────────
-- Application layer's OPS_LEADERSHIP_EMAILS allow-list remains
-- authoritative. Future AUTH_MODEL.md work may add per-role policies.

ALTER TABLE invoice_submissions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_rejections   DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_line_items        DISABLE ROW LEVEL SECURITY;
ALTER TABLE gl_codes             DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- GRANTS: match the project convention (mirrors PR 5.1 + PR 5.3)
-- ─────────────────────────────────────────────────────────────
--   service_role:  SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
--   anon:          REFERENCES, TRIGGER, TRUNCATE only (no DML)
--   authenticated: REFERENCES, TRIGGER, TRUNCATE only (no DML)
--
-- Required because Supabase project does not have a default-privileges
-- grant configured. Every new table needs explicit GRANT statements.
-- GRANT is idempotent.

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON invoice_submissions  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON invoice_rejections   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON ai_line_items        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON gl_codes             TO service_role;

GRANT REFERENCES, TRIGGER, TRUNCATE ON invoice_submissions  TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON invoice_rejections   TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON ai_line_items        TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON gl_codes             TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Post-DDL verification (run automated check after applying)
-- ─────────────────────────────────────────────────────────────
-- 1. All 4 tables exist + are empty:
--      SELECT count(*) FROM invoice_submissions;   -- expect 0
--      SELECT count(*) FROM invoice_rejections;    -- expect 0
--      SELECT count(*) FROM ai_line_items;         -- expect 0
--      SELECT count(*) FROM gl_codes;              -- expect 0
--
-- 2. service_role has full DML:
--      SELECT grantee, privilege_type
--        FROM information_schema.table_privileges
--        WHERE table_name IN ('invoice_submissions','invoice_rejections','ai_line_items','gl_codes')
--          AND grantee = 'service_role';
--      -- expect 7 priv types x 4 tables = 28 rows
--
-- 3. Run automated verification script:
--      node --env-file=.env.local scripts/verify-pr-6-1-invoice-schema.mjs
--      -- expect ALL CHECKS PASSED, exit 0
