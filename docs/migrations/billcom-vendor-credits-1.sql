-- billcom-vendor-credits-1.sql
--
-- Kevin R-71 Stage 2 (2026-09-04): ingest bill.com vendor credits
-- into the platform. R-71 Stage 1 (2026-09-04) proved that finance
-- credits (short deliveries, spoilage, volume rebates from Sysco /
-- Cheney / Gordon Food Service) live in bill.com's `/vendorcredits`
-- document type but our sync only walked `/bills/filtered`, so
-- $60k+ of FY26 food credits were absent from every account.
--
-- Josh opened the proxy routes:
--   GET  /billcom/vendor-credits          (v3 envelope · nextPage cursor)
--   GET  /billcom/vendor-credits/<id>     (per-id detail)
--
-- Note the hyphen: /vendor-credits, not /vendorcredits.
--
-- ═══════════════════════════════════════════════════════════════════
-- SHAPE (from recon 2026-09-04)
-- ═══════════════════════════════════════════════════════════════════
--
-- Header field set (13 fields):
--   id, vendorId, referenceNumber, creditDate, description, amount,
--   appliedAmount, status, archived, createdTime, updatedTime,
--   usage[], vendorCreditLineItems[]
--
-- Status values seen: FULLY_APPLIED (2730), NOT_APPLIED (354),
-- PARTIALLY_APPLIED (4). OPEN documented but not observed in the
-- FY26 corpus.
--
-- Line-item shape (per Josh's route):
--   { id, amount, classifications: { chartOfAccountId,
--                                    accountingClassId } }
--
-- The class field is NESTED under `classifications` - different from
-- bills where `actgClassId` sits at the top-level line. The loader
-- flattens the nested field on write so the derive step reads a
-- uniform shape.
--
-- ═══════════════════════════════════════════════════════════════════
-- ATTRIBUTION
-- ═══════════════════════════════════════════════════════════════════
--
-- Same class-to-account and chartOfAccount-to-GL mapping bills use:
--   billcom_class_site_map.actg_class_id -> account_key
--   billcom_ref_accounts.id              -> account_number  (GL code)
--
-- The rederive step writes to `purchasing_actuals` with:
--   source       = 'billcom_credit'
--   source_bill_id  = the credit's `id` (vcr01...)
--   source_line_id  = 'billcom_credit:' || the credit-line's `id`
--   amount       = NEGATIVE of the credit's line amount (credits
--                  reduce cost by convention; downstream sum
--                  = purchases - credits)
--   txn_date     = creditDate (per finance's rule: attributed to the
--                  period the credit is dated, not the applied period)
--
-- ═══════════════════════════════════════════════════════════════════
-- STATUS CAPTURE
-- ═══════════════════════════════════════════════════════════════════
--
-- v1 uses the credit amount regardless of status - a credit is a
-- credit whether applied or not. Kevin's note: "an unspent credit is
-- money owed to us and worth surfacing later." Status is stored on
-- the header row so a future surface can filter to OPEN /
-- PARTIALLY_APPLIED credits and render an "owed to us" tally.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. billcom_raw_vendor_credits                      (header grain)
-- ═══════════════════════════════════════════════════════════════════
-- One row per observed credit payload. Append-only-on-hash-change,
-- matching the bills raw pattern. `_latest` view resolves current
-- version. Every substantive field goes into a typed column; the
-- rest stays in raw jsonb for future-proofing.

CREATE TABLE IF NOT EXISTS billcom_raw_vendor_credits (
  id                BIGSERIAL PRIMARY KEY,
  credit_id         TEXT        NOT NULL,
  content_hash      TEXT        NOT NULL,
  vendor_id         TEXT,
  reference_number  TEXT,
  credit_date       DATE,
  description       TEXT,
  amount            NUMERIC(14, 2),
  applied_amount    NUMERIC(14, 2),
  status            TEXT,
  archived          BOOLEAN,
  created_time      TIMESTAMPTZ,
  updated_time      TIMESTAMPTZ,
  raw               JSONB       NOT NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source      TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual', 'fytd'))
);

CREATE INDEX IF NOT EXISTS billcom_raw_vendor_credits_latest_idx
  ON billcom_raw_vendor_credits (credit_id, first_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS billcom_raw_vendor_credits_credit_date_idx
  ON billcom_raw_vendor_credits (credit_date);

CREATE INDEX IF NOT EXISTS billcom_raw_vendor_credits_first_seen_at_idx
  ON billcom_raw_vendor_credits (first_seen_at DESC);


-- ═══════════════════════════════════════════════════════════════════
-- 2. billcom_raw_vendor_credit_lines                    (line grain)
-- ═══════════════════════════════════════════════════════════════════
-- Line-item grain (mirrors billcom_raw_bill_lines). The
-- `classifications` sub-object from the API is flattened here:
--   classifications.chartOfAccountId -> chart_of_account_id
--   classifications.accountingClassId -> actg_class_id
-- so the rederive step reads the same fields it reads for bills.

CREATE TABLE IF NOT EXISTS billcom_raw_vendor_credit_lines (
  id                    BIGSERIAL PRIMARY KEY,
  line_id               TEXT        NOT NULL,
  credit_id             TEXT        NOT NULL,
  content_hash          TEXT        NOT NULL,
  amount                NUMERIC(14, 2),
  chart_of_account_id   TEXT,
  actg_class_id         TEXT,
  raw                   JSONB       NOT NULL,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source          TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual', 'fytd'))
);

CREATE INDEX IF NOT EXISTS billcom_raw_vendor_credit_lines_latest_idx
  ON billcom_raw_vendor_credit_lines (line_id, first_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS billcom_raw_vendor_credit_lines_credit_id_idx
  ON billcom_raw_vendor_credit_lines (credit_id);


-- ═══════════════════════════════════════════════════════════════════
-- 3. _latest views
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW billcom_raw_vendor_credits_latest AS
  SELECT DISTINCT ON (credit_id)
    id, credit_id, content_hash, vendor_id, reference_number, credit_date,
    description, amount, applied_amount, status, archived,
    created_time, updated_time, raw,
    first_seen_at, last_seen_at, fetch_source
  FROM billcom_raw_vendor_credits
  ORDER BY credit_id, first_seen_at DESC, id DESC;

CREATE OR REPLACE VIEW billcom_raw_vendor_credit_lines_latest AS
  SELECT DISTINCT ON (line_id)
    id, line_id, credit_id, content_hash, amount, chart_of_account_id,
    actg_class_id, raw,
    first_seen_at, last_seen_at, fetch_source
  FROM billcom_raw_vendor_credit_lines
  ORDER BY line_id, first_seen_at DESC, id DESC;


-- ═══════════════════════════════════════════════════════════════════
-- 4. Grants (mirror the bills grants at purchasing-1-schema.sql:600)
-- ═══════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT ON billcom_raw_vendor_credits       TO service_role;
GRANT SELECT, INSERT ON billcom_raw_vendor_credit_lines  TO service_role;

GRANT USAGE ON SEQUENCE billcom_raw_vendor_credits_id_seq       TO service_role;
GRANT USAGE ON SEQUENCE billcom_raw_vendor_credit_lines_id_seq  TO service_role;

GRANT SELECT ON billcom_raw_vendor_credits_latest      TO service_role;
GRANT SELECT ON billcom_raw_vendor_credit_lines_latest TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Extend purchasing_actuals.source CHECK constraint
-- ═══════════════════════════════════════════════════════════════════
-- Original constraint (purchasing-1-schema.sql:396) allows:
--   source IN ('billcom', 'rippling_spend', 'upload')
-- Add 'billcom_credit' so the rederive step can write credit rows.
-- Drop-and-recreate is the standard PostgreSQL pattern for CHECK
-- constraint modification.
--
-- Failure mode without this: the credits loader errors on
--   check constraint "purchasing_actuals_source_check"
-- and the raw tables load correctly but purchasing_actuals stays
-- empty of credits, so the Overview never surfaces them.

ALTER TABLE purchasing_actuals
  DROP CONSTRAINT IF EXISTS purchasing_actuals_source_check;

ALTER TABLE purchasing_actuals
  ADD CONSTRAINT purchasing_actuals_source_check
  CHECK (source IN ('billcom', 'billcom_credit', 'rippling_spend', 'upload'));

COMMIT;
