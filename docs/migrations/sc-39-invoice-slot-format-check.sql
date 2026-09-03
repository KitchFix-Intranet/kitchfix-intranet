-- ═══════════════════════════════════════════════════════════════════
-- sc-39: relax sc_export_ledger.invoice_slot to format-check;
--        add matching format-check to sc_qbo_service_map.invoice_slot
-- 2026-09-03
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   sc-32 hardcoded `CHECK (invoice_slot IN ('main','rehab'))` on
--   sc_export_ledger, an artifact of the CIN-AZ pilot when only two
--   slot names existed. sc-38 (2026-09-02) introduced 8 additional
--   slot names for TBR + TBJ (`mlb`, `milb`, `single-a`, `ssm`,
--   `florida-ops`, `mlb-pantry`, `milb-pantry`, `catering`). Those
--   values land cleanly on sc_qbo_service_map at seed time (the map
--   carried NO CHECK on invoice_slot) but the sc_export_ledger insert
--   rejects them at finalize time. TBR's 2026-08-24 test finalize
--   failed on this class - week is in push_failed, nothing reached
--   QBO, ledger has zero rows for that week.
--
--   Fix: drop the enumerated CHECK on the ledger and replace with a
--   format check that allows any operator-shaped slot value while
--   catching typos. Add the same CHECK to sc_qbo_service_map so a
--   typo on the map fails immediately (at its source) instead of
--   silently propagating to a finalize-time failure (further from
--   cause).
--
-- Owner rulings this codifies (Kevin 2026-09-03):
--
--   Ruling 1: FORMAT CHECK, NOT ENUMERATION.
--     Enumerating slot names means a migration every time a new
--     account gets a new slot shape. TBR added 2 new slots; TBJ
--     added 8; STL - FL / MLB homestand accounts will add more. A
--     format check catches typos + garbage without listing every
--     legal value.
--
--   Ruling 2: CONSTRAIN THE SOURCE, NOT JUST THE SINK.
--     sc_qbo_service_map is where slot names originate (operators +
--     migrations write them). sc_export_ledger is where they surface
--     (adapter inserts them at finalize). A typo on the map today
--     lands silently and fails downstream - the exact class that
--     produced the TBR failure. Both tables carry the same CHECK.
--
--   Ruling 3: CADENCE DEFERRED.
--     sc_qbo_account_map.cadence and sc_export_ledger.cadence_unit
--     both enum `('weekly','biweekly')` - same class of landmine.
--     Will block STL - FL's monthly flat-fee cadence when that
--     account onboards. Not blocking TBR / TBJ (both weekly). Widening
--     without the monthly code path (buildInvoicePayload only knows
--     weekly + biweekly) ships a schema change with no consumer.
--     Deferred to the STL - FL onboarding PR. Flag in the PR body so
--     the next reader sees it as a known follow-up.
--
-- Related lesson (Kevin 2026-09-03):
--   A uniqueness guarantee says nothing about a value guarantee. The
--   PR-W recon correctly established that sc_export_ledger's unique
--   index supports many slots per week; that was read as "the ledger
--   supports arbitrary slot values." Different questions - the unique
--   index answers coexistence, the CHECK answers legality. Worth
--   filing as its own GOTCHAS entry.
--
-- Fences:
--   - No touches outside sc_export_ledger + sc_qbo_service_map
--     invoice_slot CHECKs.
--   - No data mutations - only constraint swaps. Every existing row
--     across both tables passes the new format check (verified by
--     BLOCK A preflight; BLOCK B DO block re-verifies inside the
--     transaction as belt).
--   - No changes to app code required. buildInvoicePayload +
--     qboAdapter read invoice_slot as a text passthrough; format
--     matches every value they emit today.
--
-- Apply order (per the Studio batch-parse gotcha 2026-09-02):
--   THREE separate paste-and-run blocks. Studio parses each block
--   independently; a single-paste that adds a CHECK and references
--   it in a later DO block would fail at parse time.
--
-- TO ROLLBACK:
--   BEGIN;
--   ALTER TABLE sc_qbo_service_map
--     DROP CONSTRAINT sc_qbo_service_map_invoice_slot_check;
--   ALTER TABLE sc_export_ledger
--     DROP CONSTRAINT sc_export_ledger_invoice_slot_check;
--   ALTER TABLE sc_export_ledger
--     ADD CONSTRAINT sc_export_ledger_invoice_slot_check
--     CHECK (invoice_slot = ANY (ARRAY['main'::text, 'rehab'::text]));
--   COMMIT;
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A - preflight (standalone SELECTs, paste + read first)
-- ═══════════════════════════════════════════════════════════════════
--
-- Read all three query outputs. Expected shape:
--   Query 1: sc_export_ledger has ONE row named
--            `sc_export_ledger_invoice_slot_check` with the current
--            enumerated definition `CHECK ((invoice_slot = ANY
--            (ARRAY['main'::text, 'rehab'::text])))`.
--   Query 2: sc_qbo_service_map has ZERO invoice_slot CHECK rows.
--   Query 3: every distinct invoice_slot value across both tables
--            has `passes_new_check = true`. If any row returns
--            false, HALT and investigate before running BLOCK B -
--            the new CHECK would reject that value on migration
--            commit and roll the whole thing back.

-- Query 1: current CHECK on sc_export_ledger.invoice_slot
SELECT
  'sc_export_ledger' AS table_name,
  con.conname,
  pg_get_constraintdef(con.oid) AS current_def
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'sc_export_ledger'
  AND con.contype = 'c'
  AND con.conname LIKE '%invoice_slot%';

-- Query 2: absence of CHECK on sc_qbo_service_map.invoice_slot
SELECT
  'sc_qbo_service_map' AS table_name,
  COUNT(*) AS invoice_slot_check_count
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'sc_qbo_service_map'
  AND con.contype = 'c'
  AND con.conname LIKE '%invoice_slot%';

-- Query 3: every existing invoice_slot value in either table must
-- pass the new format regex. If any row shows passes_new_check=false,
-- HALT.
SELECT
  source,
  invoice_slot,
  (invoice_slot ~ '^[a-z][a-z0-9-]{0,31}$') AS passes_new_check
FROM (
  SELECT 'sc_export_ledger'  AS source, invoice_slot FROM sc_export_ledger
  UNION
  SELECT 'sc_qbo_service_map' AS source, invoice_slot FROM sc_qbo_service_map
) AS s
ORDER BY source, invoice_slot;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B - mutation (BEGIN/COMMIT, paste + run only after BLOCK A
--                     shows every existing invoice_slot value passes
--                     the new format check)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- Step 1: relax the ledger's enumerated CHECK.
ALTER TABLE sc_export_ledger
  DROP CONSTRAINT sc_export_ledger_invoice_slot_check;

ALTER TABLE sc_export_ledger
  ADD CONSTRAINT sc_export_ledger_invoice_slot_check
  CHECK (invoice_slot ~ '^[a-z][a-z0-9-]{0,31}$');

-- Step 2: add matching format CHECK to sc_qbo_service_map. The map
-- previously carried NO CHECK on invoice_slot, which is why sc-38's
-- 8 new slot names landed cleanly and the failure surfaced only at
-- finalize (further from cause). Constrain the source now so a typo
-- on the map fails at write time rather than at billing time.
ALTER TABLE sc_qbo_service_map
  ADD CONSTRAINT sc_qbo_service_map_invoice_slot_check
  CHECK (invoice_slot ~ '^[a-z][a-z0-9-]{0,31}$');

-- Postflight: no existing row in either table violates the new CHECK.
-- The CHECK constraints themselves already enforce this at commit
-- time (any violation would abort the transaction); this DO block is
-- belt-and-suspenders defense that surfaces a clean named error
-- rather than a raw constraint violation from Postgres.
DO $$
DECLARE
  bad_ledger int;
  bad_map    int;
BEGIN
  SELECT COUNT(*) INTO bad_ledger
    FROM sc_export_ledger
    WHERE NOT (invoice_slot ~ '^[a-z][a-z0-9-]{0,31}$');
  IF bad_ledger <> 0 THEN
    RAISE EXCEPTION 'sc-39 HALT: % sc_export_ledger row(s) violate the new format CHECK. Re-run BLOCK A to identify.', bad_ledger;
  END IF;

  SELECT COUNT(*) INTO bad_map
    FROM sc_qbo_service_map
    WHERE NOT (invoice_slot ~ '^[a-z][a-z0-9-]{0,31}$');
  IF bad_map <> 0 THEN
    RAISE EXCEPTION 'sc-39 HALT: % sc_qbo_service_map row(s) violate the new format CHECK. Re-run BLOCK A to identify.', bad_map;
  END IF;

  RAISE NOTICE 'sc-39: constraint swap complete. sc_export_ledger + sc_qbo_service_map both carry format CHECK ~ ''^[a-z][a-z0-9-]{0,31}$''. Zero existing rows violate.';
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C - external verify (SELECTs, paste + read any time after
--                            BLOCK B commits)
-- ═══════════════════════════════════════════════════════════════════
--
-- Sanity: exercise the new regex against a battery of good + bad slot
-- values. Pure SELECT, no INSERT (avoids polluting the map or
-- needing rollback gymnastics). Every "expected_pass=true" row must
-- show passes_check=true; every "expected_pass=false" row must show
-- passes_check=false. Any mismatch = the regex is wrong.

SELECT
  input,
  expected_pass,
  (input ~ '^[a-z][a-z0-9-]{0,31}$') AS passes_check,
  CASE
    WHEN (input ~ '^[a-z][a-z0-9-]{0,31}$') = expected_pass THEN 'OK'
    ELSE 'FAIL'
  END AS status
FROM (VALUES
  -- Currently used slot names must all pass:
  ('main',                                 true),
  ('rehab',                                true),
  ('mlb',                                  true),
  ('milb',                                 true),
  ('single-a',                             true),
  ('ssm',                                  true),
  ('florida-ops',                          true),
  ('mlb-pantry',                           true),
  ('milb-pantry',                          true),
  ('catering',                             true),
  -- Format garbage must reject:
  ('MAIN',                                 false),  -- uppercase
  ('Main',                                 false),  -- mixed case
  ('mi lb',                                false),  -- whitespace
  ('',                                     false),  -- empty
  ('-milb',                                false),  -- starts with dash
  ('1milb',                                false),  -- starts with digit
  ('milb!',                                false),  -- special char
  ('milb.pantry',                          false),  -- dot
  ('milb_pantry',                          false),  -- underscore
  ('a' || repeat('b', 32),                 false)   -- 33 chars, too long
) AS t(input, expected_pass);

-- Optional smoke: confirm the two new CHECK constraints exist by name.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname IN ('sc_export_ledger','sc_qbo_service_map')
  AND con.contype = 'c'
  AND con.conname LIKE '%invoice_slot%'
ORDER BY rel.relname;
-- Expect two rows, both with definition
-- `CHECK ((invoice_slot ~ '^[a-z][a-z0-9-]{0,31}$'::text))`.
