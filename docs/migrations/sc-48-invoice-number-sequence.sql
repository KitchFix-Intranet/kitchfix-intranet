-- ═══════════════════════════════════════════════════════════════════
-- sc-48-invoice-number-sequence
--
-- SC-generated invoice numbers, feature ask from Sebastian relayed
-- 2026-09-18. Live invoices carry KF000000001, KF000000002, ...
-- Test invoices carry KFT000000001, KFT000000002, ... on a distinct
-- sequence so a test row can never be mistaken for a real invoice
-- in the ledger or in QuickBooks.
--
-- WHY TWO SEQUENCES (Kevin ruling 2026-09-17)
-- A gap from a failed push is an event Sebastian can explain: an
-- invoice was attempted and did not land. A gap from Kevin running
-- a test is noise in a ledger that exists to be audited. Under a
-- shared sequence the first 17 KF numbers would be consumed by
-- existing test rows before a single real invoice existed - and
-- the first live invoice would start at 18 with no visible reason.
-- Distinct prefixes (KF vs KFT) plus distinct sequences keep the
-- live audit trail clean.
--
-- WHY POSTGRES SEQUENCE (not row count)
-- nextval() is transaction-independent and guarantees uniqueness
-- across concurrent finalizes without application-layer locking.
-- Advances on rollback (that is the whole point) - a reserved
-- number is burned regardless of the surrounding transaction's
-- outcome. That matches the "burn on failure" model Kevin ruled on
-- for sc-48: a gap is an accounting artifact auditors accept
-- routinely; a duplicate DocNumber is not.
--
-- WHY THE RPC WRAPPERS
-- supabase-js does not expose SELECT nextval() through the query
-- builder. Two one-line functions expose the sequences as RPCs the
-- application client can call. Named to sort adjacent to their
-- sequences in a schema browser.
--
-- CONSUMERS
-- src/lib/billing/qboAdapter.js:postInvoiceDraft, immediately before
-- the first doHttp POST (post-env-validation, post-fence-check).
-- Reservation happens AFTER every step that can fail on non-QBO
-- reasons - customer-ID fence rejection is a config bug and must
-- not burn a live number.
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: block B's CREATE ... IF NOT EXISTS is a no-op after
-- the first apply.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm neither sequence exists yet. Expected: zero rows.
SELECT sequence_name
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name IN ('sc_invoice_number_seq', 'sc_invoice_test_number_seq');

-- Confirm neither wrapper function exists yet. Expected: zero rows.
SELECT routine_name, data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('nextval_sc_invoice_number', 'nextval_sc_invoice_test_number');


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- Live sequence. First real invoice will land at 1 -> 'KF000000001'.
CREATE SEQUENCE IF NOT EXISTS sc_invoice_number_seq
  AS       BIGINT
  START    1
  INCREMENT 1
  NO CYCLE
  NO MINVALUE
  NO MAXVALUE;

-- Test sequence. Kevin's 17 prior test finalizes did NOT burn any
-- number (they preceded this feature). First test invoice under the
-- new design lands at 1 -> 'KFT000000001'.
CREATE SEQUENCE IF NOT EXISTS sc_invoice_test_number_seq
  AS       BIGINT
  START    1
  INCREMENT 1
  NO CYCLE
  NO MINVALUE
  NO MAXVALUE;

COMMENT ON SEQUENCE sc_invoice_number_seq IS
  'Live SC invoice DocNumber sequence. Application formats each value as KF followed by 9 zero-padded digits (KF000000001, ...). Advances on rollback per PostgreSQL sequence semantics - that is the whole point (Kevin ruling: burn on failure, not return). sc-48 (2026-09-18).';

COMMENT ON SEQUENCE sc_invoice_test_number_seq IS
  'Test SC invoice DocNumber sequence. Application formats each value as KFT followed by 9 zero-padded digits (KFT000000001, ...). Distinct from live so a test row can never be mistaken for a real invoice in the ledger or in QuickBooks. sc-48 (2026-09-18).';

-- RPC wrappers. supabase-js's .rpc(name) can call these but cannot
-- call nextval() directly. One line each; STRICT + VOLATILE = the
-- correct semantics (sequences are inherently volatile).
CREATE OR REPLACE FUNCTION nextval_sc_invoice_number()
RETURNS BIGINT
LANGUAGE sql
VOLATILE
AS $$
  SELECT nextval('sc_invoice_number_seq');
$$;

CREATE OR REPLACE FUNCTION nextval_sc_invoice_test_number()
RETURNS BIGINT
LANGUAGE sql
VOLATILE
AS $$
  SELECT nextval('sc_invoice_test_number_seq');
$$;

COMMENT ON FUNCTION nextval_sc_invoice_number() IS
  'RPC wrapper: SELECT nextval(sc_invoice_number_seq). Called by src/lib/billing/qboAdapter.js:reserveNextInvoiceNumber. sc-48.';

COMMENT ON FUNCTION nextval_sc_invoice_test_number() IS
  'RPC wrapper: SELECT nextval(sc_invoice_test_number_seq). Called by src/lib/billing/qboAdapter.js:reserveNextInvoiceNumber for test-mode pushes. sc-48.';

-- Grants. Same reasoning as sc-47: new tables/sequences/functions
-- do NOT inherit privileges from siblings; notify-1 shipped without
-- exercising this and failed at first insert. Verify in Block C.
GRANT USAGE, SELECT ON SEQUENCE sc_invoice_number_seq       TO service_role;
GRANT USAGE, SELECT ON SEQUENCE sc_invoice_test_number_seq  TO service_role;
GRANT EXECUTE ON FUNCTION nextval_sc_invoice_number()       TO service_role;
GRANT EXECUTE ON FUNCTION nextval_sc_invoice_test_number()  TO service_role;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm both sequences exist with correct shape.
SELECT sequence_name, data_type, start_value, increment, cycle_option
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name IN ('sc_invoice_number_seq', 'sc_invoice_test_number_seq')
ORDER BY sequence_name;

-- Confirm both wrapper functions exist.
SELECT routine_name, data_type, external_language
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('nextval_sc_invoice_number', 'nextval_sc_invoice_test_number')
ORDER BY routine_name;

-- Confirm sequence current values. Expected: last_value = 1,
-- is_called = false (nothing consumed yet).
SELECT sequence_name, last_value, is_called
FROM (
  SELECT 'sc_invoice_number_seq'      AS sequence_name, last_value, is_called
  FROM sc_invoice_number_seq
  UNION ALL
  SELECT 'sc_invoice_test_number_seq',                   last_value, is_called
  FROM sc_invoice_test_number_seq
) s
ORDER BY sequence_name;

-- Confirm service_role has USAGE + SELECT on both sequences.
-- Same query shape as sc-47 Block C's sequence-grant check.
SELECT s.relname AS sequence_name,
       r.rolname AS grantee,
       string_agg(p.privilege_type, ', ' ORDER BY p.privilege_type) AS grants
FROM pg_class s
JOIN pg_namespace n     ON n.oid = s.relnamespace
JOIN LATERAL aclexplode(s.relacl) p ON true
JOIN pg_roles r         ON r.oid = p.grantee
WHERE s.relkind = 'S'
  AND n.nspname = 'public'
  AND s.relname IN ('sc_invoice_number_seq', 'sc_invoice_test_number_seq')
  AND r.rolname = 'service_role'
GROUP BY s.relname, r.rolname
ORDER BY s.relname;

-- Expected: two rows, both showing service_role with SELECT, USAGE.
-- Missing USAGE means qboAdapter.js:reserveNextInvoiceNumber will
-- fail with "permission denied for sequence" on first live push.

-- Confirm service_role has EXECUTE on both RPC wrappers.
SELECT p.proname AS function_name,
       r.rolname AS grantee,
       string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type) AS grants
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN LATERAL aclexplode(p.proacl) a ON true
JOIN pg_roles r ON r.oid = a.grantee
WHERE n.nspname = 'public'
  AND p.proname IN ('nextval_sc_invoice_number', 'nextval_sc_invoice_test_number')
  AND r.rolname = 'service_role'
GROUP BY p.proname, r.rolname
ORDER BY p.proname;

-- Expected: two rows, both showing service_role with EXECUTE.
-- Missing EXECUTE means supabase-js .rpc() call will fail with
-- "permission denied for function".

-- Sanity-call both RPCs. Expected: 1 from each on first apply
-- (which advances them to 1). Second apply: 2, then 3, etc.
-- If Kevin re-applies for any reason, the sequences advance -
-- that is fine and matches the burn model.
-- SELECT nextval_sc_invoice_number();
-- SELECT nextval_sc_invoice_test_number();
-- (Left commented so preflight does not consume a number.)
