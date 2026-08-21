-- purchasing-5-billcom-vendors.sql
-- KPI PURCHASING PHASE 1 - billcom vendors reference table.
--
-- --- WHY ------------------------------------------------------------
-- INV-P10 found billcom_raw_bills.raw.organizationName is our own
-- company ("CJK Foods, LLC") on 100% of 3,536 rows. The vendor NAME
-- is not on the bill payload at all - only vendorId. Two live
-- consequences:
--   1. The purchasing board's "By vendor" card cannot render (has an
--      opaque id, no name to display).
--   2. INV-P4's search for miscoded vehicle spend was blind: it
--      searched vendor text that carries no vendor names, so the
--      "nothing found" result proves nothing.
--
-- This migration lands the reference table that the /vendors sync
-- populates and a view that resolves a bill line to a vendor name.
-- No UI. No route. No writes here.
--
-- --- WHAT LANDS -----------------------------------------------------
-- Reference (nightly full replace, same discipline as billcom_ref_
-- accounts and billcom_ref_classes):
--   billcom_ref_vendors           vendor snapshot from /billcom/vendors
--
-- View:
--   v_purchasing_actuals_billcom_named  purchasing_actuals billcom rows
--                                       joined to billcom_ref_vendors
--                                       by vendor_or_merchant -> id.
--                                       vendor_name is NULL when the
--                                       id does not resolve.
--
-- --- ENVELOPE + PAGINATION NOTES ------------------------------------
-- /billcom/vendors returns the v3 envelope (top-level `results` array +
-- `nextPage` cursor), NOT the v2 envelope (`response_data`). Proxy caps
-- max at 100 per page (verified 2026-08-20). Do NOT mix with the v2
-- parsers used by /bills, /chartofaccounts, /classes. `start=` query
-- param is IGNORED on this endpoint - pagination is by opaque cursor
-- passed as `page=<nextPage>`.
--
-- The vendor payload uses `archived` (boolean) as the active-flag
-- semantic, NOT `isActive` like the other ref endpoints. We store
-- `archived` natively so we do not flip the invariant on a downstream
-- filter.
--
-- --- PROVENANCE / STANDING RULES HONORED ----------------------------
--   - Full-replace refresh (DELETE then INSERT) matches billcom_ref_
--     accounts + billcom_ref_classes. TRUNCATE not granted (money-
--     adjacent standing rule; REVOKE issued below defensively).
--   - No client dollars, no vendor NAMES, no merchant names in this
--     file. Only column definitions + grants + verify probes.
--   - Every statement independently valid; Kevin applies one at a time
--     in Supabase Studio.
--   - No backfill by guessing. A vendor_id that /vendors does not
--     return simply stays unresolved (view returns vendor_name=NULL).
--
-- --- APPLY DISCIPLINE -----------------------------------------------
-- 1. Kevin applies statements sequentially in Supabase Studio.
-- 2. Fill in the attestation block at end of file with the SHA the
--    apply matched and the timestamp.
-- 3. Run the sync (scripts/purchasing_billcom_sync.mjs with the new
--    /vendors step included) only after this migration is applied.
-- 4. If any statement fails, stop and inspect. Every statement is
--    IF NOT EXISTS / OR REPLACE guarded so re-application is safe.
--
-- --- RE-APPLY SAFETY ------------------------------------------------
-- Every CREATE uses IF NOT EXISTS. GRANT / REVOKE are idempotent.
-- Running this whole file twice changes zero rows and zero permissions.


-- ===================================================================
-- 1. billcom_ref_vendors                              (vendor snapshot)
-- ===================================================================
-- One row per vendor observed on the /billcom/vendors endpoint.
-- Refreshed nightly by full replace (DELETE then INSERT), same shape
-- as billcom_ref_accounts and billcom_ref_classes.
--
-- id                v3 opaque vendor id, e.g. "00901HCCBJFRML3ezuoe"
-- name              vendor display name (this is the piece the entire
--                   downstream pipeline was blind to prior to this
--                   migration).
-- account_type      "BUSINESS" | "PERSON" | "NONE" (v3 enum).
-- archived          v3 native active-flag semantic: true = archived,
--                   false = active. Store as-is; downstream picks the
--                   invariant (do not invert to is_active - that flip
--                   is exactly how the wrong-envelope trap bites).
-- account_number    optional vendor account number the vendor has for
--                   us (visible on some rows; nullable).
-- bill_currency     e.g. "USD".
-- created_time      TIMESTAMPTZ - vendor record created in bill.com.
-- updated_time      TIMESTAMPTZ - vendor record last updated.
-- raw               full payload for future column additions without
--                   a schema change.
-- refreshed_at      when this snapshot row was written.

CREATE TABLE IF NOT EXISTS billcom_ref_vendors (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  account_type    TEXT,
  archived        BOOLEAN,
  account_number  TEXT,
  bill_currency   TEXT,
  created_time    TIMESTAMPTZ,
  updated_time    TIMESTAMPTZ,
  raw             JSONB       NOT NULL,
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ===================================================================
-- 2. Indexes for billcom_ref_vendors
-- ===================================================================

CREATE INDEX IF NOT EXISTS billcom_ref_vendors_name_idx
  ON billcom_ref_vendors (name);

CREATE INDEX IF NOT EXISTS billcom_ref_vendors_archived_idx
  ON billcom_ref_vendors (archived);


-- ===================================================================
-- 3. Table comment
-- ===================================================================

COMMENT ON TABLE billcom_ref_vendors IS
  'Vendor snapshot from /billcom/vendors (v3 envelope: results + nextPage). '
  'Refreshed nightly by full replace (DELETE + INSERT). archived is the v3 '
  'native active-flag semantic (true=archived, false=active) - do NOT invert. '
  'purchasing_actuals.vendor_or_merchant (a vendor_id for billcom rows) joins '
  'to id here to resolve a real vendor name for the By-vendor UI card and '
  'audit trails.';


-- ===================================================================
-- 4. Grants - service_role positive
-- ===================================================================
-- Same shape as billcom_ref_accounts and billcom_ref_classes:
-- SELECT + INSERT + DELETE (nightly full replace pattern).
-- Non-negotiable per KPI_PURCHASING_PHASE2_BUILD_SPEC.md section 8:
-- any new table needs an explicit GRANT to service_role AND a verify
-- probe reading information_schema.role_table_grants below.

GRANT SELECT, INSERT, DELETE ON billcom_ref_vendors TO service_role;


-- ===================================================================
-- 5. REVOKE TRUNCATE                              (standing lesson)
-- ===================================================================
-- The postgres role's default privileges grant TRUNCATE on new tables
-- to anon + authenticated. Ref tables are not money-adjacent in the
-- same way purchasing_actuals is, but the standing rule applies to
-- every new table until the ALTER DEFAULT PRIVILEGES upstream is
-- cleaned up. Idempotent (no-op when the privilege is not held).

REVOKE TRUNCATE ON billcom_ref_vendors FROM anon, authenticated;


-- ===================================================================
-- 6. v_purchasing_actuals_billcom_named               (join view)
-- ===================================================================
-- Resolves a purchasing_actuals billcom row to a vendor name via
-- vendor_or_merchant -> billcom_ref_vendors.id.
--
-- Rows where the vendor_id is not present in billcom_ref_vendors
-- (either because /vendors did not return it, or because the id is
-- stale/deleted) get vendor_name = NULL and vendor_resolved = FALSE.
-- Downstream counts unresolved without inventing a name.
--
-- Filters to source='billcom' only. rippling_spend rows already
-- carry merchant_name in vendor_or_merchant and do not need this
-- join.

CREATE OR REPLACE VIEW v_purchasing_actuals_billcom_named AS
  SELECT
    pa.id,
    pa.source,
    pa.source_bill_id,
    pa.source_line_id,
    pa.account_key,
    pa.excluded,
    pa.gl_line_code,
    pa.gl_bucket,
    pa.txn_date,
    pa.posting_date,
    pa.amount,
    pa.vendor_or_merchant       AS vendor_id,
    v.name                      AS vendor_name,
    (v.id IS NOT NULL)          AS vendor_resolved,
    v.archived                  AS vendor_archived,
    v.account_type              AS vendor_account_type,
    pa.paid,
    pa.approx_date,
    pa.derived_at
  FROM purchasing_actuals pa
  LEFT JOIN billcom_ref_vendors v
    ON v.id = pa.vendor_or_merchant
  WHERE pa.source = 'billcom';


-- ===================================================================
-- 7. Grant on the view
-- ===================================================================

GRANT SELECT ON v_purchasing_actuals_billcom_named TO service_role;


-- ===================================================================
-- ===================================================================
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
-- ===================================================================
-- ===================================================================
--
-- READ-ONLY. No BEGIN. No UPDATE. No ROLLBACK. Studio commits under
-- those, so any BEGIN in a verify block would be a mistake.
--
-- V1. Table + view exist.
--
-- SELECT c.relname, c.relkind
-- FROM pg_class c
-- JOIN pg_namespace n ON c.relnamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND c.relname IN ('billcom_ref_vendors', 'v_purchasing_actuals_billcom_named')
-- ORDER BY c.relname;
-- Expected: 2 rows. relkind r=table, v=view.
--
-- V2. Indexes landed.
--
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename = 'billcom_ref_vendors'
-- ORDER BY indexname;
-- Expected: 3 rows (PK + name idx + archived idx).
--
-- V3. Grants match the ref pattern (SELECT + INSERT + DELETE for
--     service_role, no UPDATE - nightly is DELETE then INSERT).
--
-- SELECT has_table_privilege('service_role', 'billcom_ref_vendors', 'SELECT') AS sel,
--        has_table_privilege('service_role', 'billcom_ref_vendors', 'INSERT') AS ins,
--        has_table_privilege('service_role', 'billcom_ref_vendors', 'DELETE') AS del,
--        has_table_privilege('service_role', 'billcom_ref_vendors', 'UPDATE') AS upd;
-- Expected: sel=t ins=t del=t upd=f.
--
-- V4. REVOKE TRUNCATE landed. Expected: zero rows.
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'billcom_ref_vendors'
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type = 'TRUNCATE';
--
-- V5. View resolves via LEFT JOIN so nothing drops on missing vendor.
--     Row count on the view MUST equal row count on
--     purchasing_actuals WHERE source='billcom'.
--
-- SELECT
--   (SELECT COUNT(*) FROM v_purchasing_actuals_billcom_named)                                AS view_rows,
--   (SELECT COUNT(*) FROM purchasing_actuals WHERE source = 'billcom')                        AS pa_billcom_rows;
-- Expected: equal.
--
-- V6. Non-negotiable per KPI_PURCHASING_PHASE2_BUILD_SPEC.md section 8:
--     the service_role SELECT + INSERT grant on the new table appears
--     in information_schema.role_table_grants. Five green structural
--     checks preceded a 403 last week - has_table_privilege is not a
--     substitute for reading the actual grant catalog.
--
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'billcom_ref_vendors'
--   AND grantee = 'service_role'
--   AND privilege_type IN ('SELECT', 'INSERT', 'DELETE')
-- ORDER BY privilege_type;
-- Expected: 3 rows - DELETE, INSERT, SELECT (all for service_role).
--
-- V7. billcom_ref_vendors is populated (POST-SYNC check, not post-
--     migration). V1-V6 all pass while the table sits empty because
--     they check structure, grants, and view row count (view rows =
--     purchasing_actuals billcom rows regardless of ref population -
--     LEFT JOIN preserves the left side even when every right side is
--     NULL). Run this AFTER the first successful sync.
--
-- SELECT COUNT(*) AS vendor_count FROM billcom_ref_vendors;
-- Expected: > 0.
--
-- V8. Coverage - after the sync runs at least once. Reports how many
--     billcom rows resolve to a vendor name and how many do not.
--
-- SELECT
--   COUNT(*)                                     AS total_billcom_rows,
--   COUNT(vendor_name)                           AS resolved,
--   COUNT(*) FILTER (WHERE vendor_name IS NULL)  AS unresolved
-- FROM v_purchasing_actuals_billcom_named;
--
-- V9. Re-apply is a no-op. Run this file a second time in Studio.
--     CREATE ... IF NOT EXISTS + CREATE OR REPLACE VIEW + GRANT
--     (already-granted) + REVOKE (already-not-held) all no-op.


-- ===================================================================
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ===================================================================
--
-- Kevin fills in below AFTER applying the file (one statement at a
-- time) in Supabase Studio.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional - any statement that needed manual attention>
