-- ═══════════════════════════════════════════════════════════════════
-- sc-52-invoice-cc
--
-- Kevin ruling 2026-10-05. QBO stores per-customer Cc/Bcc defaults
-- that it auto-fills when a human creates an invoice in the UI; the
-- API create bypasses that path and "Review and send" does not back-
-- fill. The sc-50 round-2 investigation confirmed the defaults are
-- not readable through the Customer API (11 reads across 6
-- minorversions returned the same 27 keys with no Cc/Bcc; the query
-- validator explicitly rejects SecondaryEmailAddr / CcEmailAddr /
-- BccEmailAddr / Contacts / NotifyEmails as properties that do not
-- exist on the Customer entity). Writing BillEmailCc / BillEmailBcc
-- on the invoice does work - verified by a test-mode POST and
-- independent read-back; Kevin confirmed both render in the QBO
-- Cc/Bcc panel.
--
-- The two values split by shape:
--   Bcc: s.castro@kitchfix.com + ar@kitchfix.com - KitchFix internal,
--        same every account. Lives as INVOICE_BCC in qboAdapter.js,
--        imported from recipients.js so each address has one source.
--   Cc:  the client's own AP address, e.g.
--        accountspayable@texasrangers.com. Different per account.
--        Lives in THIS column.
--
-- SHIPPING WITH THE COLUMN EMPTY. Kevin collects the per-account list
-- from Sebastian later this week and populates it in Studio with a
-- short UPDATE per account. A null Cc is skipped rather than fatal,
-- so shipping unpopulated changes nothing until the UPDATEs land, and
-- the Bcc half starts working on the next live push.
--
-- MISSING Cc IS NOT FATAL. Deliberately the opposite of sc-49's
-- missing-slot_code refusal: a bad slot code means a wrong invoice
-- number so the invoice must not exist; a missing Cc means one fewer
-- copy of a correct invoice. Blocking an operator's push over an
-- absent address would be the wrong trade.
--
-- NO CHECK CONSTRAINT ON FORMAT. Email validation in a CHECK is a
-- trap - it will reject something legitimate eventually, and the
-- cost of a malformed address is a bounced copy, not a bad invoice.
--
-- CONSUMER
-- src/lib/billing/qboAdapter.js:postInvoiceDraft reads this column
-- off ctx.accountMap (threaded by scWeekFinalize.js's existing
-- .select("*") against sc_qbo_account_map - no new query, no new
-- threading).
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: Block B's ADD COLUMN IF NOT EXISTS is a no-op after
-- the first apply.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm sc_qbo_account_map exists.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map';

-- Confirm qbo_bill_email_cc does NOT exist yet. Expected: zero rows.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map'
  AND column_name  = 'qbo_bill_email_cc';

-- Preview the account rows that will carry the new column. Kevin
-- sees which accounts need an AP address from Sebastian; live rows
-- are the ones that will Cc immediately on the next push, test rows
-- stay inert.
SELECT account_key, qbo_customer_id, qbo_mode
FROM sc_qbo_account_map
ORDER BY account_key;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Add the column. Nullable, no seed, no default. Null is the
-- expected shipped state until Sebastian's per-account list lands
-- and Kevin runs the follow-up UPDATEs.
ALTER TABLE sc_qbo_account_map
  ADD COLUMN IF NOT EXISTS qbo_bill_email_cc TEXT;

-- 2. Column comment naming the consumer + shape. Comma-separated
-- addresses are accepted the same way QBO stores them in the UI
-- (the sc-50 round-2 verified POST sent one comma-joined string in
-- the Address field and both addresses rendered in the Cc panel).
COMMENT ON COLUMN sc_qbo_account_map.qbo_bill_email_cc IS
  'sc-52 (2026-10-05): client-side AP address(es) copied onto the QBO invoice BillEmailCc on live pushes only. Fed into src/lib/billing/qboAdapter.js:postInvoiceDraft via ctx.accountMap. Comma-separated addresses are accepted and sent as one string in the {Address} field, matching how QBO stores customer Cc defaults in the UI. NULL means Cc is omitted and the push proceeds (NOT a failure) - this is deliberately the opposite of sc-49''s missing-slot_code refusal.';

-- 3. No separate GRANT needed - sc_qbo_account_map already carries
-- SELECT on service_role from sc-35 (verified by sibling columns),
-- and ADD COLUMN inherits the table's existing privileges. Block C
-- asserts this.

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Column present, TEXT, nullable.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map'
  AND column_name  = 'qbo_bill_email_cc';

-- Column comment took.
SELECT col_description(
  (SELECT oid FROM pg_class WHERE relname = 'sc_qbo_account_map' AND relnamespace = 'public'::regnamespace),
  (SELECT ordinal_position FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'sc_qbo_account_map'
      AND column_name  = 'qbo_bill_email_cc')::int
) AS column_comment;

-- service_role has SELECT on the table. Expected: one row.
SELECT r.rolname AS grantee,
       string_agg(p.privilege_type, ', ' ORDER BY p.privilege_type) AS grants
FROM pg_class c
JOIN pg_namespace n     ON n.oid = c.relnamespace
JOIN LATERAL aclexplode(c.relacl) p ON true
JOIN pg_roles r         ON r.oid = p.grantee
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname = 'sc_qbo_account_map'
  AND r.rolname = 'service_role'
  AND p.privilege_type = 'SELECT'
GROUP BY r.rolname;

-- Inventory. Kevin sees the empty state he is about to fill. Every
-- qbo_bill_email_cc value should be NULL at this point.
SELECT account_key, qbo_mode, qbo_bill_email_cc
FROM sc_qbo_account_map
ORDER BY account_key;
