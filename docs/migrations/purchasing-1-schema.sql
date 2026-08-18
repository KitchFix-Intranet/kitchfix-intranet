-- purchasing-1-schema.sql
-- KPI PURCHASING PHASE 1 - data-layer schema.
-- Contract: docs/KPI_PURCHASING_PHASE1_SPEC.md §1 (tables) + §5 (seed).
--
-- ─── WHY ─────────────────────────────────────────────────────────────
-- Phase 0 settled that bill.com is the source of record for vendor
-- spend and Rippling's spend_transaction_line_item_zo is the source of
-- record for card spend. This migration lands ONLY the schema those
-- two syncs need. No UI. No route. No writes here.
--
-- Everything is schema-only. Kevin applies in Studio one statement at
-- a time (per CLAUDE.md working agreement + spec §1 explicit rule).
-- The attestation block at the tail records the SHA the apply matched.
--
-- ─── WHAT LANDS ──────────────────────────────────────────────────────
-- Raw ingest (append-only-on-hash-change, same pattern as kpi-8a):
--   billcom_raw_bills             one row per bill (v2 header)
--   billcom_raw_bill_lines        one row per bill line
--   rippling_raw_spend_lines      one row per spend line item
--
-- Reference (nightly full replace):
--   billcom_ref_accounts          chart of accounts snapshot
--   billcom_ref_classes           classes snapshot
--
-- Owner-maintained maps:
--   billcom_class_site_map        13 rows seeded (spec §5). CORP + CHI
--                                 excluded=true. actgClassId -> account_key.
--   spend_category_map            populated with candidates by first
--                                 Rippling sync. Kevin labels gl_line_code.
--   spend_department_site_map     populated with candidates by first
--                                 Rippling sync. Kevin labels account_key.
--                                 CORP labels (50xx-59xx prefix) default
--                                 excluded=true.
--
-- The derived fact table the route reads:
--   purchasing_actuals            one row per (source, source_line_id).
--                                 REVOKE TRUNCATE from anon + authenticated
--                                 (money-adjacent, per standing rule).
--
-- Views (route + probes):
--   billcom_raw_bills_latest      DISTINCT ON (bill_id) - current version.
--   billcom_raw_bill_lines_latest DISTINCT ON (line_id).
--   rippling_raw_spend_lines_latest DISTINCT ON (rippling_id).
--   v_purchasing_by_site_period   sum by (account_key, fiscal period,
--                                 gl_line_code). Excluded rows collapse.
--   v_purchasing_by_site_week     same at week grain.
--
-- ─── PROVENANCE / STANDING RULES HONORED ─────────────────────────────
--   - REVOKE TRUNCATE on purchasing_actuals + the two raw tables from
--     anon/authenticated (sc-34 default-privileges lesson: the postgres
--     default grants TRUNCATE on new tables to those roles; explicit
--     REVOKE is the only fix on per-table basis until the
--     ALTER DEFAULT PRIVILEGES record is cleaned up upstream).
--   - No UNIQUE on (external_id, content_hash) for raw tables - revert
--     cycles (X -> Y -> X) must land the third observation; app-side
--     compare-then-insert enforces the intent. Same as kpi-8a.
--   - CORP + CHI classes seeded with excluded=true so downstream never
--     sums them into any site or aggregate. account_key stays NULL for
--     those two rows.
--   - Each statement independently valid; Kevin can apply one at a time.
--   - No client dollars, vendor names, or merchant names anywhere in
--     this file (spec + master doc rule).
--
-- ─── APPLY DISCIPLINE ────────────────────────────────────────────────
-- 1. Kevin applies statements sequentially in Supabase Studio.
-- 2. Fill in the attestation block at end of file with the SHA the
--    apply matched and the timestamp.
-- 3. C2 (billcom sync) + C3 (rippling sync) + C4 (route + probes) do
--    not run against prod until this migration is applied.
-- 4. If any statement fails, stop and inspect. Every statement is
--    IF NOT EXISTS / OR REPLACE guarded so re-application is safe.
--
-- ─── RE-APPLY SAFETY ─────────────────────────────────────────────────
-- Every CREATE uses IF NOT EXISTS. The seed uses ON CONFLICT DO NOTHING.
-- REVOKE is idempotent (no-op when the privilege is not held). Running
-- this whole file twice changes zero rows and zero permissions.


-- ═══════════════════════════════════════════════════════════════════
-- 1. billcom_raw_bills                                    (v2 header)
-- ═══════════════════════════════════════════════════════════════════
-- One row per observed bill payload. Append-only-on-hash-change: when
-- bill.com mutates a bill (paymentStatus flip, retro edit), the hash
-- differs from the latest for that bill_id and a new row inserts.
-- Old rows stay as the audit trail. `_latest` view resolves current.
--
-- Columns are the v2 header fields the derive step reads. Everything
-- else stays in raw jsonb so a future addition can pull without a
-- schema change. Amounts are TEXT-safe: bill.com returns amounts as
-- strings ("1234.56") in v2 envelope; store the raw string and cast
-- in views only.

CREATE TABLE IF NOT EXISTS billcom_raw_bills (
  id                BIGSERIAL PRIMARY KEY,
  bill_id           TEXT        NOT NULL,
  content_hash      TEXT        NOT NULL,
  vendor_id         TEXT,
  invoice_number    TEXT,
  invoice_date      DATE,
  gl_posting_date   DATE,
  amount            NUMERIC(14, 2),
  paid_amount       NUMERIC(14, 2),
  due_amount        NUMERIC(14, 2),
  approval_status   TEXT,
  payment_status    TEXT,
  is_active         BOOLEAN,
  created_time      TIMESTAMPTZ,
  updated_time      TIMESTAMPTZ,
  raw               JSONB       NOT NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source      TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual', 'fytd'))
  -- No UNIQUE on (bill_id, content_hash). Same rationale as kpi-8a.
);


-- ═══════════════════════════════════════════════════════════════════
-- 2. Indexes for billcom_raw_bills
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS billcom_raw_bills_latest_idx
  ON billcom_raw_bills (bill_id, first_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS billcom_raw_bills_invoice_date_idx
  ON billcom_raw_bills (invoice_date);

CREATE INDEX IF NOT EXISTS billcom_raw_bills_first_seen_at_idx
  ON billcom_raw_bills (first_seen_at DESC);


-- ═══════════════════════════════════════════════════════════════════
-- 3. billcom_raw_bill_lines                              (line grain)
-- ═══════════════════════════════════════════════════════════════════
-- One row per observed bill-line payload. Line item is where site
-- (actgClassId) and GL (chartOfAccountId) actually live - the header
-- has neither. 132 of 409 P8 bills split across GL codes, so line-item
-- grain is not optional.

CREATE TABLE IF NOT EXISTS billcom_raw_bill_lines (
  id                    BIGSERIAL PRIMARY KEY,
  line_id               TEXT        NOT NULL,
  bill_id               TEXT        NOT NULL,
  content_hash          TEXT        NOT NULL,
  amount                NUMERIC(14, 2),
  chart_of_account_id   TEXT,
  actg_class_id         TEXT,
  department_id         TEXT,
  description           TEXT,
  line_order            INTEGER,
  raw                   JSONB       NOT NULL,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source          TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual', 'fytd'))
);


-- ═══════════════════════════════════════════════════════════════════
-- 4. Indexes for billcom_raw_bill_lines
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS billcom_raw_bill_lines_latest_idx
  ON billcom_raw_bill_lines (line_id, first_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS billcom_raw_bill_lines_bill_id_idx
  ON billcom_raw_bill_lines (bill_id);

CREATE INDEX IF NOT EXISTS billcom_raw_bill_lines_actg_class_id_idx
  ON billcom_raw_bill_lines (actg_class_id);

CREATE INDEX IF NOT EXISTS billcom_raw_bill_lines_chart_of_account_id_idx
  ON billcom_raw_bill_lines (chart_of_account_id);


-- ═══════════════════════════════════════════════════════════════════
-- 5. billcom_ref_accounts                        (chart of accounts)
-- ═══════════════════════════════════════════════════════════════════
-- Chart of accounts snapshot. Refreshed nightly by full replace inside
-- the sync (DELETE all then INSERT). 1,072 rows across 2 pages of 999
-- (spec §0). accountNumber IS our GL number - do not build a mapping
-- table for GL. This IS the mapping.

CREATE TABLE IF NOT EXISTS billcom_ref_accounts (
  id             TEXT PRIMARY KEY,
  account_number TEXT,
  name           TEXT,
  account_type   TEXT,
  is_active      BOOLEAN,
  parent_id      TEXT,
  raw            JSONB       NOT NULL,
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billcom_ref_accounts_account_number_idx
  ON billcom_ref_accounts (account_number);


-- ═══════════════════════════════════════════════════════════════════
-- 6. billcom_ref_classes                                    (classes)
-- ═══════════════════════════════════════════════════════════════════
-- 51 rows per spec §0. The 13 that matter map 1:1 to sites in
-- billcom_class_site_map (below). Refreshed nightly, full replace.

CREATE TABLE IF NOT EXISTS billcom_ref_classes (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  is_active    BOOLEAN,
  raw          JSONB       NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════
-- 7. billcom_class_site_map                    (13 rows, owner map)
-- ═══════════════════════════════════════════════════════════════════
-- Owner-maintained. Seeded below with the 13 verified rows per spec §5.
-- CORP + CHI carry excluded=true; account_key stays NULL for those two
-- so any derived query that sums by account_key skips them naturally.
-- Class ids match /billcom/classes on 2026-08-18 (spec §5 attestation).

CREATE TABLE IF NOT EXISTS billcom_class_site_map (
  actg_class_id TEXT PRIMARY KEY,
  account_key   TEXT,
  excluded      BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Guard: excluded rows must not carry an account_key (CORP + CHI
  -- must never route into a site). Mapped rows must carry one.
  CONSTRAINT billcom_class_site_map_excluded_shape
    CHECK ((excluded = TRUE AND account_key IS NULL)
        OR (excluded = FALSE AND account_key IS NOT NULL))
);


-- ═══════════════════════════════════════════════════════════════════
-- 8. Seed billcom_class_site_map                       (spec §5)
-- ═══════════════════════════════════════════════════════════════════
-- ON CONFLICT DO NOTHING so a re-apply is a no-op. 13 rows.

INSERT INTO billcom_class_site_map (actg_class_id, account_key, excluded, note) VALUES
  ('cls01XDVUJNKWWE718yt', 'STL - FL',     FALSE, 'spec §5 seed'),
  ('cls01MJNJVUSTRT46sa5', 'TBJ - FL',     FALSE, 'spec §5 seed'),
  ('cls01FITMWDEUUS4yjvx', 'TBR - FL',     FALSE, 'spec §5 seed'),
  ('cls01HJFZJLQFXD5ezf3', 'TXR - AZ',     FALSE, 'spec §5 seed'),
  ('cls01LIGHCBKRZC50y8m', 'CIN - AZ',     FALSE, 'spec §5 seed'),
  ('cls01XGEJEVHCCR6sne7', 'STL - MO',     FALSE, 'spec §5 seed'),
  ('cls01GKCFIDLEGD46sa7', 'TXR - TX - H', FALSE, 'spec §5 seed'),
  ('cls01HQLOOGQSHY6pqrj', 'CIN - OH',     FALSE, 'spec §5 seed'),
  ('cls01LVIFFEPKYQ6k3i7', 'TXR - TX - V', FALSE, 'spec §5 seed'),
  ('cls01TVGQFCHAZW6lfo4', 'CIN - KY',     FALSE, 'spec §5 seed'),
  ('cls01GVPEPCCGSM46sa6', 'TBJ - NY',     FALSE, 'spec §5 seed'),
  ('cls01JPNBTZOZZH46saa', NULL,           TRUE,  'CORP - excluded by construction'),
  ('cls01TPHLWNLIDR471s9', NULL,           TRUE,  'CHI  - excluded by construction')
ON CONFLICT (actg_class_id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
-- 9. rippling_raw_spend_lines                    (Rippling card spend)
-- ═══════════════════════════════════════════════════════════════════
-- One row per observed spend_transaction_line_item_zo record. Same
-- append-only-on-hash-change discipline. Parent transaction id kept
-- for the eventual reconciliation with the parent object (blocked by
-- Rippling bug per master §6.6 - do NOT retry the parent endpoint;
-- merchant comes off the parent FK's display_value on each line).
--
-- category_id + department_id are opaque Rippling ids the syncs
-- populate into spend_category_map + spend_department_site_map as
-- candidates for Kevin to label. work_location_* held here for
-- reference; the site map is department-driven per Kevin ruling.

CREATE TABLE IF NOT EXISTS rippling_raw_spend_lines (
  id                    BIGSERIAL PRIMARY KEY,
  rippling_id           TEXT        NOT NULL,
  external_id           TEXT,
  content_hash          TEXT        NOT NULL,
  amount                NUMERIC(14, 2),
  currency              TEXT,
  category_id           TEXT,
  department_id         TEXT,
  department_label      TEXT,
  work_location_id      TEXT,
  work_location_label   TEXT,
  merchant_name         TEXT,
  parent_txn_id         TEXT,
  embedded_document_id  TEXT,
  updated_at            TIMESTAMPTZ,
  raw                   JSONB       NOT NULL,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_source          TEXT        NOT NULL CHECK (fetch_source IN ('backfill', 'nightly', 'manual'))
);


-- ═══════════════════════════════════════════════════════════════════
-- 10. Indexes for rippling_raw_spend_lines
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS rippling_raw_spend_lines_latest_idx
  ON rippling_raw_spend_lines (rippling_id, first_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS rippling_raw_spend_lines_first_seen_at_idx
  ON rippling_raw_spend_lines (first_seen_at DESC);

CREATE INDEX IF NOT EXISTS rippling_raw_spend_lines_category_id_idx
  ON rippling_raw_spend_lines (category_id);

CREATE INDEX IF NOT EXISTS rippling_raw_spend_lines_department_id_idx
  ON rippling_raw_spend_lines (department_id);


-- ═══════════════════════════════════════════════════════════════════
-- 11. spend_category_map                          (owner-maintained)
-- ═══════════════════════════════════════════════════════════════════
-- Populated with CANDIDATES by the first Rippling sync (spec §2).
-- gl_line_code stays NULL until Kevin labels it. Unlabelled rows
-- surface in the purchasing route as `uncoded` counts. Never guess.
--
-- category_label carries the human-readable label from the first
-- observation for Kevin's convenience; merchant_sample carries a
-- single merchant name to disambiguate ambiguous labels. Both are
-- write-once by the sync (ON CONFLICT DO NOTHING) so a labelled row
-- is never overwritten.

CREATE TABLE IF NOT EXISTS spend_category_map (
  category_id      TEXT PRIMARY KEY,
  category_label   TEXT,
  gl_line_code     TEXT,
  merchant_sample  TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  labelled_by      TEXT,
  labelled_at      TIMESTAMPTZ
);


-- ═══════════════════════════════════════════════════════════════════
-- 12. spend_department_site_map                    (owner-maintained)
-- ═══════════════════════════════════════════════════════════════════
-- Populated with CANDIDATES by the first Rippling sync. account_key
-- stays NULL until Kevin labels it. CORP labels (department prefix
-- 50xx-59xx per master §6.6) default to excluded=true so they never
-- sum into a site. Sync sets `excluded` on first-insert per the label
-- prefix rule; Kevin can override.

CREATE TABLE IF NOT EXISTS spend_department_site_map (
  department_id      TEXT PRIMARY KEY,
  department_label   TEXT,
  account_key        TEXT,
  excluded           BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  labelled_by        TEXT,
  labelled_at        TIMESTAMPTZ,
  -- Same shape guard as billcom_class_site_map: excluded rows must
  -- not carry an account_key. NULL account_key on non-excluded rows
  -- IS allowed here (that is the "candidate awaiting label" state).
  CONSTRAINT spend_department_site_map_excluded_shape
    CHECK (NOT (excluded = TRUE AND account_key IS NOT NULL))
);


-- ═══════════════════════════════════════════════════════════════════
-- 13. purchasing_actuals                              (THE fact table)
-- ═══════════════════════════════════════════════════════════════════
-- The board reads this. One row per (source, source_line_id).
--
-- source in ('billcom', 'rippling_spend', 'upload'):
--   billcom          bill.com line item
--   rippling_spend   Rippling spend_transaction_line_item_zo record
--   upload           Phase 2+ card upload lane. Reserved.
--
-- account_key NULL means "unattributed" (class unmapped, Rippling
-- department unlabelled, or unlabelled category with no fallback).
-- excluded=true means CORP/CHI (bill.com) or excluded department
-- (Rippling); account_key MUST be NULL when excluded (constraint).
-- Downstream sums MUST filter WHERE excluded = FALSE.
--
-- gl_line_code NULL means "uncoded" - the row's chartOfAccountId did
-- not resolve to a chart-of-accounts row, or the Rippling category
-- was unlabelled. Reported as `uncoded` count by the route.
--
-- gl_bucket derived from gl_line_code prefix (§2 derive step):
--   32/34/35 -> pl_cogs
--   13       -> reimbursable
--   5        -> sga
--   else     -> other
--
-- txn_date = bill.invoiceDate for billcom (ACCRUAL - owner ruling
-- 6.1). For rippling_spend, txn_date = first_seen_at with
-- approx_date=TRUE until the parent object is readable.
--
-- REVOKE TRUNCATE from anon + authenticated below - money-adjacent.

CREATE TABLE IF NOT EXISTS purchasing_actuals (
  id                    BIGSERIAL PRIMARY KEY,
  source                TEXT NOT NULL CHECK (source IN ('billcom', 'rippling_spend', 'upload')),
  source_bill_id        TEXT,
  source_line_id        TEXT NOT NULL,
  account_key           TEXT,
  excluded              BOOLEAN NOT NULL DEFAULT FALSE,
  gl_line_code          TEXT,
  gl_bucket             TEXT CHECK (gl_bucket IS NULL OR gl_bucket IN ('pl_cogs', 'reimbursable', 'sga', 'other')),
  txn_date              DATE,
  posting_date          DATE,
  amount                NUMERIC(14, 2) NOT NULL,
  vendor_or_merchant    TEXT,
  paid                  BOOLEAN NOT NULL DEFAULT FALSE,
  approx_date           BOOLEAN NOT NULL DEFAULT FALSE,
  derived_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchasing_actuals_source_line_id_uq UNIQUE (source, source_line_id),
  CONSTRAINT purchasing_actuals_excluded_shape
    CHECK (NOT (excluded = TRUE AND account_key IS NOT NULL))
);


-- ═══════════════════════════════════════════════════════════════════
-- 14. Indexes for purchasing_actuals
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS purchasing_actuals_account_txn_idx
  ON purchasing_actuals (account_key, txn_date);

CREATE INDEX IF NOT EXISTS purchasing_actuals_txn_date_idx
  ON purchasing_actuals (txn_date);

CREATE INDEX IF NOT EXISTS purchasing_actuals_source_bill_id_idx
  ON purchasing_actuals (source_bill_id);

CREATE INDEX IF NOT EXISTS purchasing_actuals_gl_line_code_idx
  ON purchasing_actuals (gl_line_code);


-- ═══════════════════════════════════════════════════════════════════
-- 15. purchasing_derive_runs                        (derive freshness)
-- ═══════════════════════════════════════════════════════════════════
-- One row per derive invocation. Route reports MAX(completed_at) as
-- `last_derive_at` per surface. Same shape used by the labor pipeline
-- (D38 lesson: read the recorded run timestamp, not row-level derived_at).

CREATE TABLE IF NOT EXISTS purchasing_derive_runs (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT NOT NULL CHECK (source IN ('billcom', 'rippling_spend')),
  fetch_source   TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'success', 'failed')),
  bills_touched  INTEGER,
  lines_written  INTEGER,
  error_message  TEXT
);

CREATE INDEX IF NOT EXISTS purchasing_derive_runs_completed_idx
  ON purchasing_derive_runs (source, completed_at DESC);


-- ═══════════════════════════════════════════════════════════════════
-- 16. purchasing_sync_locks                         (concurrency lock)
-- ═══════════════════════════════════════════════════════════════════
-- Same shape as rippling_sync_locks (kpi-8a). Serialize concurrent
-- purchasing syncs across environments (local + GH Action). TTL 4h.

CREATE TABLE IF NOT EXISTS purchasing_sync_locks (
  name         TEXT PRIMARY KEY,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  holder       TEXT        NOT NULL
);


-- ═══════════════════════════════════════════════════════════════════
-- 17. _latest views                       (current-version resolution)
-- ═══════════════════════════════════════════════════════════════════
-- Same DISTINCT ON pattern as kpi-8a. `_latest` view resolves the
-- currently-visible row per external id. Order by first_seen_at DESC,
-- id DESC (same-millisecond tiebreak).

CREATE OR REPLACE VIEW billcom_raw_bills_latest AS
  SELECT DISTINCT ON (bill_id)
    id, bill_id, content_hash, vendor_id, invoice_number, invoice_date,
    gl_posting_date, amount, paid_amount, due_amount, approval_status,
    payment_status, is_active, created_time, updated_time, raw,
    first_seen_at, last_seen_at, fetch_source
  FROM billcom_raw_bills
  ORDER BY bill_id, first_seen_at DESC, id DESC;

CREATE OR REPLACE VIEW billcom_raw_bill_lines_latest AS
  SELECT DISTINCT ON (line_id)
    id, line_id, bill_id, content_hash, amount, chart_of_account_id,
    actg_class_id, department_id, description, line_order, raw,
    first_seen_at, last_seen_at, fetch_source
  FROM billcom_raw_bill_lines
  ORDER BY line_id, first_seen_at DESC, id DESC;

CREATE OR REPLACE VIEW rippling_raw_spend_lines_latest AS
  SELECT DISTINCT ON (rippling_id)
    id, rippling_id, external_id, content_hash, amount, currency,
    category_id, department_id, department_label, work_location_id,
    work_location_label, merchant_name, parent_txn_id, embedded_document_id,
    updated_at, raw, first_seen_at, last_seen_at, fetch_source
  FROM rippling_raw_spend_lines
  ORDER BY rippling_id, first_seen_at DESC, id DESC;


-- ═══════════════════════════════════════════════════════════════════
-- 18. v_purchasing_by_site_period                    (aggregation view)
-- ═══════════════════════════════════════════════════════════════════
-- FY2026 starts 2025-12-29. Periods are 28 days each, aligned to the
-- FY start. period_no = floor((txn_date - FY_START)/28) + 1 clamped to
-- 1..13.
-- Excluded rows drop out via the WHERE clause; account_key NULL drops
-- via the GROUP BY key. gl_line_code NULL rolls up as "uncoded".

CREATE OR REPLACE VIEW v_purchasing_by_site_period AS
  SELECT
    account_key,
    2026 AS fiscal_year,
    (FLOOR((txn_date - DATE '2025-12-29')::INT / 28.0)::INT + 1) AS period_no,
    gl_line_code,
    gl_bucket,
    SUM(amount)                                AS amount,
    COUNT(*)                                   AS line_count,
    COUNT(DISTINCT source_bill_id)             AS bill_count,
    SUM(CASE WHEN paid THEN amount ELSE 0 END) AS paid_amount
  FROM purchasing_actuals
  WHERE excluded = FALSE
    AND account_key IS NOT NULL
    AND txn_date IS NOT NULL
    AND txn_date >= DATE '2025-12-29'
    AND txn_date <= DATE '2026-12-27'
  GROUP BY account_key,
           (FLOOR((txn_date - DATE '2025-12-29')::INT / 28.0)::INT + 1),
           gl_line_code,
           gl_bucket;


-- ═══════════════════════════════════════════════════════════════════
-- 19. v_purchasing_by_site_week                              (week grain)
-- ═══════════════════════════════════════════════════════════════════
-- Fiscal weeks are Mon-Sun aligned to FY_START (2025-12-29 Mon).
-- week_start = FY_START + floor((txn_date - FY_START)/7)*7.

CREATE OR REPLACE VIEW v_purchasing_by_site_week AS
  SELECT
    account_key,
    (DATE '2025-12-29' + (FLOOR((txn_date - DATE '2025-12-29')::INT / 7.0)::INT * 7)) AS week_start,
    (DATE '2025-12-29' + (FLOOR((txn_date - DATE '2025-12-29')::INT / 7.0)::INT * 7) + 6) AS week_end,
    gl_line_code,
    gl_bucket,
    SUM(amount)                                AS amount,
    COUNT(*)                                   AS line_count,
    COUNT(DISTINCT source_bill_id)             AS bill_count,
    SUM(CASE WHEN paid THEN amount ELSE 0 END) AS paid_amount
  FROM purchasing_actuals
  WHERE excluded = FALSE
    AND account_key IS NOT NULL
    AND txn_date IS NOT NULL
    AND txn_date >= DATE '2025-12-29'
    AND txn_date <= DATE '2026-12-27'
  GROUP BY account_key,
           (DATE '2025-12-29' + (FLOOR((txn_date - DATE '2025-12-29')::INT / 7.0)::INT * 7)),
           (DATE '2025-12-29' + (FLOOR((txn_date - DATE '2025-12-29')::INT / 7.0)::INT * 7) + 6),
           gl_line_code,
           gl_bucket;


-- ═══════════════════════════════════════════════════════════════════
-- 20. Grants - service_role positive
-- ═══════════════════════════════════════════════════════════════════
-- Raw ingest tables: SELECT + INSERT only. Append-only-on-hash-change
-- means UPDATE and DELETE must NOT be granted (audit-trail integrity).
-- Reference tables (ref_accounts, ref_classes) get INSERT + DELETE
-- because nightly refresh is delete-all + re-insert.
-- Owner-maintained maps get SELECT + INSERT + UPDATE (Kevin labels).
-- purchasing_actuals gets SELECT + INSERT + DELETE (derive rebuilds
-- per touched bill: DELETE rows for the bill then INSERT new).
-- purchasing_derive_runs gets SELECT + INSERT + UPDATE (in-progress
-- -> success/failed).
-- Lock table: SELECT + INSERT + DELETE.

GRANT SELECT, INSERT ON billcom_raw_bills            TO service_role;
GRANT SELECT, INSERT ON billcom_raw_bill_lines       TO service_role;
GRANT SELECT, INSERT ON rippling_raw_spend_lines     TO service_role;

GRANT USAGE ON SEQUENCE billcom_raw_bills_id_seq        TO service_role;
GRANT USAGE ON SEQUENCE billcom_raw_bill_lines_id_seq   TO service_role;
GRANT USAGE ON SEQUENCE rippling_raw_spend_lines_id_seq TO service_role;
GRANT USAGE ON SEQUENCE purchasing_actuals_id_seq      TO service_role;
GRANT USAGE ON SEQUENCE purchasing_derive_runs_id_seq  TO service_role;

GRANT SELECT, INSERT, DELETE          ON billcom_ref_accounts       TO service_role;
GRANT SELECT, INSERT, DELETE          ON billcom_ref_classes        TO service_role;
GRANT SELECT, INSERT, UPDATE          ON billcom_class_site_map     TO service_role;
GRANT SELECT, INSERT, UPDATE          ON spend_category_map         TO service_role;
GRANT SELECT, INSERT, UPDATE          ON spend_department_site_map  TO service_role;
GRANT SELECT, INSERT, DELETE          ON purchasing_actuals         TO service_role;
GRANT SELECT, INSERT, UPDATE          ON purchasing_derive_runs     TO service_role;
GRANT SELECT, INSERT, DELETE          ON purchasing_sync_locks      TO service_role;

GRANT SELECT ON billcom_raw_bills_latest         TO service_role;
GRANT SELECT ON billcom_raw_bill_lines_latest    TO service_role;
GRANT SELECT ON rippling_raw_spend_lines_latest  TO service_role;
GRANT SELECT ON v_purchasing_by_site_period      TO service_role;
GRANT SELECT ON v_purchasing_by_site_week        TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 21. REVOKE TRUNCATE                             (standing lesson)
-- ═══════════════════════════════════════════════════════════════════
-- The postgres role's default privileges grant TRUNCATE on new tables
-- to anon + authenticated. Explicit REVOKE fences THIS table without
-- disturbing other subsystems. Money-adjacent: purchasing_actuals +
-- both raw tables. See sc-33 header for the mechanism analysis.
-- Idempotent (no-op when not held).

REVOKE TRUNCATE ON purchasing_actuals        FROM anon, authenticated;
REVOKE TRUNCATE ON billcom_raw_bills         FROM anon, authenticated;
REVOKE TRUNCATE ON billcom_raw_bill_lines    FROM anon, authenticated;
REVOKE TRUNCATE ON rippling_raw_spend_lines  FROM anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 22. Table comments                        (self-documenting schema)
-- ═══════════════════════════════════════════════════════════════════

COMMENT ON TABLE billcom_raw_bills IS
  'One row per observed bill.com bill header (v2 envelope). Append-only-on-hash-change. '
  '_latest view resolves current row per bill_id. No UNIQUE(bill_id, content_hash) - '
  'revert cycles must land the third observation.';

COMMENT ON TABLE billcom_raw_bill_lines IS
  'One row per observed bill line. actg_class_id -> site (via billcom_class_site_map); '
  'chart_of_account_id -> billcom_ref_accounts.account_number (which IS our GL number). '
  'Line-item grain mandatory: 132 of 409 P8 bills split across GL codes.';

COMMENT ON TABLE billcom_ref_accounts IS
  'Chart of accounts snapshot. 1,072 rows across 2 pages of 999. Refreshed nightly by '
  'full replace. account_number IS our GL number - do not build a mapping table for GL.';

COMMENT ON TABLE billcom_class_site_map IS
  'Owner-maintained. Seeded with 13 rows on 2026-08-18. CORP + CHI carry excluded=true '
  'so they never sum into a site or aggregate.';

COMMENT ON TABLE rippling_raw_spend_lines IS
  'Rippling spend_transaction_line_item_zo records. Parent object is blocked by a Rippling '
  'bug (400 on spend_transaction_zo per Phase 0b verdict B) - do NOT retry it. Merchant '
  'comes off the parent FK display_value on each line item.';

COMMENT ON TABLE spend_category_map IS
  'Populated with CANDIDATES by first Rippling sync. gl_line_code NULL until Kevin labels. '
  'Sync writes candidates ON CONFLICT DO NOTHING (never overwrites a labelled row).';

COMMENT ON TABLE spend_department_site_map IS
  'Populated with CANDIDATES by first Rippling sync. account_key NULL until Kevin labels. '
  'CORP departments (label prefix 50xx-59xx) default to excluded=TRUE. Same first-write-wins '
  'discipline as spend_category_map.';

COMMENT ON TABLE purchasing_actuals IS
  'THE fact table the /api/kpi/purchasing route reads. One row per (source, source_line_id). '
  'Excluded rows have account_key NULL AND excluded=TRUE - they never sum anywhere but stay '
  'auditable. gl_bucket derived from gl_line_code prefix (32/34/35=pl_cogs, 13=reimbursable, '
  '5=sga, else=other). txn_date = invoiceDate for billcom (accrual per owner ruling 6.1). '
  'paid is a flag, not a filter. TRUNCATE revoked from anon + authenticated.';


-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
-- V1. Every declared table + view + lock exists.
--
-- SELECT c.relname, c.relkind
-- FROM pg_class c
-- JOIN pg_namespace n ON c.relnamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND c.relname IN (
--     'billcom_raw_bills', 'billcom_raw_bill_lines', 'billcom_ref_accounts',
--     'billcom_ref_classes', 'billcom_class_site_map', 'rippling_raw_spend_lines',
--     'spend_category_map', 'spend_department_site_map', 'purchasing_actuals',
--     'purchasing_derive_runs', 'purchasing_sync_locks',
--     'billcom_raw_bills_latest', 'billcom_raw_bill_lines_latest',
--     'rippling_raw_spend_lines_latest',
--     'v_purchasing_by_site_period', 'v_purchasing_by_site_week'
--   )
-- ORDER BY c.relname;
-- Expected: 16 rows.
--
-- V2. Seed landed. Expected: 13 rows, 11 with account_key non-null,
--     2 excluded (CORP + CHI) with account_key null.
--
-- SELECT COUNT(*) AS total,
--        COUNT(account_key) AS mapped,
--        SUM(CASE WHEN excluded THEN 1 ELSE 0 END) AS excluded_count
-- FROM billcom_class_site_map;
--
-- V3. REVOKE TRUNCATE landed. Expected: zero rows.
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('purchasing_actuals', 'billcom_raw_bills',
--                      'billcom_raw_bill_lines', 'rippling_raw_spend_lines')
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type = 'TRUNCATE';
--
-- V4. purchasing_actuals grants: SELECT + INSERT + DELETE for service_role,
--     no UPDATE (rebuild is DELETE-then-INSERT, never in-place).
--     Expected: SELECT/INSERT/DELETE = true, UPDATE = false.
--
-- SELECT has_table_privilege('service_role', 'purchasing_actuals', 'SELECT') AS sel,
--        has_table_privilege('service_role', 'purchasing_actuals', 'INSERT') AS ins,
--        has_table_privilege('service_role', 'purchasing_actuals', 'DELETE') AS del,
--        has_table_privilege('service_role', 'purchasing_actuals', 'UPDATE') AS upd;
--
-- V5. No UNIQUE constraint on (bill_id, content_hash) or
--     (rippling_id, content_hash) on the raw tables. Expected: zero rows.
--
-- SELECT c.conname, t.relname
-- FROM pg_constraint c
-- JOIN pg_class t ON c.conrelid = t.oid
-- WHERE t.relname IN ('billcom_raw_bills', 'billcom_raw_bill_lines',
--                     'rippling_raw_spend_lines')
--   AND c.contype = 'u';
-- (Only PK constraints are expected here; contype='p' would appear if
--  queried without the u filter.)
--
-- V6. Re-apply is a no-op. Run this file a second time in Studio.
--     Every CREATE ... IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING
--     + REVOKE (already-not-held) is a no-op. Expected: no errors, no
--     row-count change.


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file (one statement at a
-- time) in Supabase Studio. This attestation records the exact SHA
-- the apply matched. The migration-gate check on the PR looks for the
-- phrase `applied in Studio: YES` in a comment from an OWNER account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional - any statement that needed manual attention>
