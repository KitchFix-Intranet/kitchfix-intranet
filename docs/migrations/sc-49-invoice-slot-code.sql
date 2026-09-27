-- ═══════════════════════════════════════════════════════════════════
-- sc-49-invoice-slot-code
--
-- Deterministic SC invoice DocNumbers, Kevin ruling 2026-09-26 after
-- the 2026-09-26 KF000000005 collision (QBO error 6140). Sebastian
-- created an invoice manually in the QBO UI; QBO auto-filled the
-- next number from our last saved invoice (KF000000004), silently
-- consuming KF000000005 before Liz's TXR-AZ week-of-9/21 push tried
-- to use it.
--
-- The design flaw: our sequence and QBO's auto-increment share one
-- namespace with no coordination. Every manual QBO invoice created
-- after one of ours silently takes our next number.
--
-- The fix: stop drawing from a counter. Derive the DocNumber from
-- the invoice's own identity: KF + account code + YYMMDD week +
-- slot code + optional revision. See docs/GOTCHAS.md for the full
-- rationale.
--
-- ─── WHY A DEDICATED TABLE (sc-49b, 2026-09-26) ─────────────────
--
-- The first attempt at this migration put `slot_code` directly on
-- sc_qbo_service_map. That table is one row per SERVICE, not per
-- slot - live counts on 2026-09-26 include 9 rows for
-- (TXR - AZ, main), 4 rows for (CIN - AZ, rehab), etc. 48 rows,
-- 16 distinct (account_key, invoice_slot) pairs.
--
-- The rule that has to hold is bidirectional, per account:
--   1. one invoice_slot has exactly one slot_code
--   2. one slot_code belongs to exactly one invoice_slot
-- Break (1) and the DocNumber depends on which row the query
-- returns first. Break (2) and two different slots collide on the
-- same DocNumber - reintroducing the sc-49 problem one level down.
--
-- Neither rule is expressible as a unique index on
-- sc_qbo_service_map (per-service, so duplicates by design). The
-- attribute belongs on a slot-keyed table.
--
-- ─── WHAT THIS MIGRATION ADDS ───────────────────────────────────
--
-- sc_invoice_slot_codes: one row per (account_key, invoice_slot).
--   PK       (account_key, invoice_slot)  - enforces rule 1
--   UNIQUE   (account_key, slot_code)     - enforces rule 2
--   CHECK    slot_code ~ '^[A-Z]{2,3}$'   - enforces shape
--   NOT NULL slot_code                    - no backfill window
--
-- Studio-managed like sc_qbo_service_map / sc_qbo_account_map. No
-- writer in src/; new slots get a row by hand in Studio.
--
-- Sequence sc_invoice_number_seq (sc-48) is RETIRED but NOT dropped
-- - it is the only record of how KF000000001..004 were issued.
-- Retirement is expressed via COMMENT ON SEQUENCE in Block B.
-- sc_invoice_test_number_seq remains in active use for the KFT
-- test path (Kevin re-runs tests against the same key; a
-- deterministic test number would collide with itself).
--
-- CONSUMERS
-- src/lib/billing/qboAdapter.js:buildInvoiceDocNumber (pure function).
-- src/lib/scWeekFinalize.js reads slot_code + computes revision
-- before calling postInvoiceDraft; qboAdapter never queries for
-- slot_code itself (reservation-seam discipline: no I/O at the seam).
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: Block B's CREATE TABLE IF NOT EXISTS and ON CONFLICT
-- DO NOTHING are no-ops after the first apply.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm the new table does NOT exist yet. Expected: zero rows.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   = 'sc_invoice_slot_codes';

-- Confirm sc_qbo_service_map.slot_code does NOT exist. The prior
-- migration attempt would have added the column here; assert its
-- absence so a partial earlier apply surfaces immediately. Expected:
-- zero rows.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_service_map'
  AND column_name  = 'slot_code';

-- Show the 16 distinct (account_key, invoice_slot) pairs Block B
-- will seed. Expected exactly these 16 rows on 2026-09-26.
SELECT account_key, invoice_slot, COUNT(*) AS service_rows
FROM sc_qbo_service_map
WHERE active = true
GROUP BY account_key, invoice_slot
ORDER BY account_key, invoice_slot;

-- Why a dedicated table: the row counts above are per-service, not
-- per-slot. This query prints the duplicate structure so the reason
-- for the redesign is visible in the preflight output. Expected: 48
-- total active rows across the 16 pairs above.
SELECT COUNT(*) AS total_active_service_rows
FROM sc_qbo_service_map
WHERE active = true;

-- Account-code prefix guard preview. Computed here so the assertion
-- in Block C can re-run the same check. Expected: zero rows (no code
-- is a prefix of any other code in the current 14 account_keys).
WITH codes AS (
  SELECT DISTINCT
         account_key,
         upper(regexp_replace(account_key, '[^A-Za-z0-9]', '', 'g')) AS code
  FROM sc_qbo_account_map
)
SELECT a.account_key AS a_key, a.code AS a_code,
       b.account_key AS b_key, b.code AS b_code
FROM codes a
JOIN codes b
  ON a.account_key <> b.account_key
 AND b.code LIKE a.code || '%';


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_invoice_slot_codes (
  account_key  TEXT        NOT NULL,
  invoice_slot TEXT        NOT NULL,
  slot_code    TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_at   TIMESTAMPTZ,
  CONSTRAINT sc_invoice_slot_codes_pkey
    PRIMARY KEY (account_key, invoice_slot),
  CONSTRAINT sc_invoice_slot_codes_shape
    CHECK (slot_code ~ '^[A-Z]{2,3}$'),
  CONSTRAINT sc_invoice_slot_codes_code_uniq
    UNIQUE (account_key, slot_code)
);

-- 2. Seed the 16 (account, slot, code) tuples. Codes repeat across
-- accounts (MN on three; MIL/MLB on two each) - intended, uniqueness
-- is per-account. ON CONFLICT DO NOTHING makes re-apply a no-op.
INSERT INTO sc_invoice_slot_codes (account_key, invoice_slot, slot_code) VALUES
  ('TXR - AZ', 'main',        'MN'),
  ('CIN - AZ', 'main',        'MN'),
  ('CIN - AZ', 'rehab',       'RH'),
  ('TBR - FL', 'main',        'MN'),
  ('TBR - FL', 'milb',        'MIL'),
  ('TBR - FL', 'mlb',         'MLB'),
  ('TBJ - FL', 'catering',    'CAT'),
  ('TBJ - FL', 'florida-ops', 'FLO'),
  ('TBJ - FL', 'media-meals', 'MED'),
  ('TBJ - FL', 'milb',        'MIL'),
  ('TBJ - FL', 'milb-pantry', 'MIP'),
  ('TBJ - FL', 'mlb',         'MLB'),
  ('TBJ - FL', 'mlb-pantry',  'MLP'),
  ('TBJ - FL', 'scout-meals', 'SCT'),
  ('TBJ - FL', 'single-a',    'SGA'),
  ('TBJ - FL', 'ssm',         'SSM')
ON CONFLICT (account_key, invoice_slot) DO NOTHING;

-- 3. Grants. New tables do not inherit sibling privileges - sc-47
-- notify-1 lesson, and sc-48 Block C exists because of it. RLS is
-- OFF on the sibling tables (sc_qbo_service_map, sc_qbo_account_map,
-- sc_export_ledger); match that here - do not enable RLS on this
-- table. Read only for the service client; INSERT/UPDATE stays
-- Studio-only because nothing in src/ writes it today.
GRANT SELECT ON sc_invoice_slot_codes TO service_role;

-- 4. Comments. Name the consumers so a future reader knows where
-- this row is read + what breaks if it is missing.
COMMENT ON TABLE sc_invoice_slot_codes IS
  'sc-49b (2026-09-26): 2-3 letter slot code per (account_key, invoice_slot). Feeds src/lib/billing/qboAdapter.js:buildInvoiceDocNumber via ctx.slotCode threaded by src/lib/scWeekFinalize.js. A slot without a row here cannot be invoiced - scWeekFinalize refuses the push with MISSING_SLOT_CODE + N2. Studio-managed; no writer in src/. Uniqueness is per-account, so codes repeat across accounts by design (MN on three; MIL/MLB on two each).';

COMMENT ON COLUMN sc_invoice_slot_codes.slot_code IS
  'The 2-3 uppercase letters appended to the sc-49 DocNumber, e.g. KFTXRAZ260921MN where MN is this column. Unique within an account (rule 2 - two different slots must never produce the same DocNumber).';

-- 5. Mark the live sequence retired. sc-48's sc_invoice_number_seq
-- stays in place because it is the only record of how KF000000001..004
-- were issued; the retirement is a comment, not a DROP.
COMMENT ON SEQUENCE sc_invoice_number_seq IS
  'RETIRED 2026-09-26 (sc-49). Live SC invoice DocNumbers now derive from (account_key, week_start, slot_code, revision) via src/lib/billing/qboAdapter.js:buildInvoiceDocNumber. This sequence issued KF000000001..004; the values remain in sc_export_ledger for audit. sc_invoice_test_number_seq is still in active use for KFT test-mode pushes (Kevin ruling: test mode stays counter-based; see docs/GOTCHAS.md).';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Table exists with expected columns.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_invoice_slot_codes'
ORDER BY ordinal_position;

-- All three constraints present.
SELECT conname, contype, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname IN (
  'sc_invoice_slot_codes_pkey',
  'sc_invoice_slot_codes_shape',
  'sc_invoice_slot_codes_code_uniq'
)
ORDER BY conname;

-- Exactly 16 rows seeded.
SELECT COUNT(*) AS n_rows FROM sc_invoice_slot_codes;

-- Every distinct (account_key, invoice_slot) active in
-- sc_qbo_service_map has a code. This is the check that would have
-- caught the sc-49 (v1) schema error. Expected: zero rows.
SELECT s.account_key, s.invoice_slot
FROM (
  SELECT DISTINCT account_key, invoice_slot
  FROM sc_qbo_service_map
  WHERE active = true
) s
LEFT JOIN sc_invoice_slot_codes c
  USING (account_key, invoice_slot)
WHERE c.slot_code IS NULL
ORDER BY s.account_key, s.invoice_slot;

-- No (account_key, slot_code) duplicates. Expected: zero rows (the
-- UNIQUE constraint would have refused Block B, but this query is
-- the check that names the failure mode.).
SELECT account_key, slot_code, COUNT(*) AS n
FROM sc_invoice_slot_codes
GROUP BY account_key, slot_code
HAVING COUNT(*) > 1
ORDER BY account_key, slot_code;

-- Full inventory for review.
SELECT account_key, invoice_slot, slot_code
FROM sc_invoice_slot_codes
ORDER BY account_key, invoice_slot;

-- service_role has SELECT. Missing SELECT means the intranet client
-- reads zero rows and every live push falls to MISSING_SLOT_CODE +
-- N2. sc-47's notify-1 shipped without this grant and failed at the
-- first insert; do not repeat.
SELECT r.rolname AS grantee,
       string_agg(p.privilege_type, ', ' ORDER BY p.privilege_type) AS grants
FROM pg_class c
JOIN pg_namespace n     ON n.oid = c.relnamespace
JOIN LATERAL aclexplode(c.relacl) p ON true
JOIN pg_roles r         ON r.oid = p.grantee
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname = 'sc_invoice_slot_codes'
  AND r.rolname = 'service_role'
GROUP BY r.rolname;

-- Expected: one row, service_role with SELECT.

-- Account-code prefix guard (assertion form). No account code should
-- be a prefix of another. Expected: zero rows.
WITH codes AS (
  SELECT DISTINCT
         account_key,
         upper(regexp_replace(account_key, '[^A-Za-z0-9]', '', 'g')) AS code
  FROM sc_qbo_account_map
)
SELECT a.account_key AS a_key, a.code AS a_code,
       b.account_key AS b_key, b.code AS b_code
FROM codes a
JOIN codes b
  ON a.account_key <> b.account_key
 AND b.code LIKE a.code || '%';

-- Confirm sc_invoice_number_seq is still in place (retirement is a
-- comment, not a DROP) and that the retirement comment took.
SELECT sequence_name, last_value
FROM (
  SELECT 'sc_invoice_number_seq'      AS sequence_name, last_value FROM sc_invoice_number_seq
  UNION ALL
  SELECT 'sc_invoice_test_number_seq',                    last_value FROM sc_invoice_test_number_seq
) s
ORDER BY sequence_name;

SELECT obj_description('sc_invoice_number_seq'::regclass, 'pg_class') AS retirement_comment;
