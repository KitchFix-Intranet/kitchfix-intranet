-- ═══════════════════════════════════════════════════════════════════
-- sc-32: sc_export_ledger (PR-C of the SC -> QBO billing arc)
-- 2026-08-11
-- ═══════════════════════════════════════════════════════════════════
--
-- Spec authority: docs/SC_QBO_SHAPE_SPEC.md §6 (data model, ledger)
-- + §7 (posting protocol). PR-C wires the adapter that writes here.
--
-- What this migration adds:
--   1. `sc_export_ledger` - one row per (account, week, invoice_slot)
--      that we ATTEMPT to post. Every attempt writes a row (created |
--      failed | test | superseded), never a silent no-op. The read
--      path is idempotency: before POST, look up the ledger; a live
--      `created` row makes the call a no-op returning the prior id.
--   2. A PARTIAL unique index on (account_key, week_start,
--      invoice_slot) WHERE `status = 'created' AND is_test = false`.
--      That predicate is the load-bearing invariant: exactly one live
--      real invoice per (account, week, slot). Test rows never
--      occupy the real uniqueness (they carry is_test=true), and
--      failed / superseded rows drop out too (they're not the live
--      binding).
--   3. GRANTs mirroring sc-31 (peer table, same access shape).
--
-- ─── Live shape verification (SR-23 discipline; sc-31 cost three
--       rounds against this same unverified pattern) ───────────────
--
-- Every table referenced by name or role granted in this file was
-- probed live via SELECT on 2026-08-11 before the file was written.
-- No sc_export_ledger dependencies on foreign keys; the ledger stands
-- alone. Cross-referenced tables listed below FOR CONTEXT ONLY (this
-- migration does not JOIN or FK to them):
--
-- sc_qbo_account_map (peer sc-31, verified live 2026-08-11):
--   account_key text NOT NULL PK
--   qbo_customer_id text NOT NULL
--   qbo_customer_name text NOT NULL
--   qbo_taxcode_id text NOT NULL
--   cadence text NOT NULL
--   biweekly_anchor date NULL
--   active bool NOT NULL DEFAULT true
--   created_at timestamptz NOT NULL DEFAULT now()
--   changed_at timestamptz NOT NULL DEFAULT now()
--
-- sc_qbo_service_map (peer sc-31 + sc-31a, verified live 2026-08-11):
--   service_id uuid NOT NULL
--   account_key text NOT NULL
--   qbo_item_id text NOT NULL
--   qbo_item_name text NOT NULL   -- carries Sebastian's typed
--                                    convention post sc-31a; the
--                                    upcoming rename to
--                                    qbo_line_description is a
--                                    separate migration owner ordered
--                                    after this PR reports harness.
--   aggregate_group text NULL
--   invoice_slot text NOT NULL
--   tax_override text NULL
--   line_desc_style text NULL
--   active bool NOT NULL DEFAULT true
--   created_at timestamptz NOT NULL DEFAULT now()
--   changed_at timestamptz NOT NULL DEFAULT now()
--
-- sc_week_finalize (peer sc-30, from the merged DDL, cross-checked
--   via SELECT-empty 2026-08-11):
--   id uuid PK DEFAULT gen_random_uuid()
--   account_key text NOT NULL CHECK (regex)
--   week_start date NOT NULL CHECK (extract(isodow from week_start)=1)
--   status text NOT NULL CHECK (in ('finalized','push_failed','billed','reverted'))
--   finalized_by text NOT NULL
--   finalized_at timestamptz NOT NULL DEFAULT now()
--   reverted_by text NULL
--   reverted_at timestamptz NULL
--   revert_reason text NULL
--   changed_at timestamptz NOT NULL DEFAULT now()
--
-- Roles (service_role / anon / authenticated) exist and are the
-- current GRANT targets for sc_qbo_account_map + sc_qbo_service_map.
-- Same pattern used here.
--
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. TABLE ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_export_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity. Same account_key regex as sc_week_finalize + the sc-30
  -- family so the string shape stays coherent across billing tables.
  account_key       TEXT NOT NULL CHECK (
                      account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    ),

  -- Week span. week_start is always a Monday; week_end is 6 days
  -- later for weekly cadence, 13 days later for biweekly. cadence_unit
  -- carries the resolution the payload was built at so the ledger
  -- reader does not have to re-derive it from account_map.
  week_start        DATE NOT NULL CHECK (
                      extract(isodow from week_start) = 1
                    ),
  week_end          DATE NOT NULL,
  cadence_unit      TEXT NOT NULL CHECK (
                      cadence_unit IN ('weekly', 'biweekly')
                    ),

  -- Which invoice this row records. CIN - AZ emits two per close
  -- (main + rehab). Every other pilot emits one. invoice_slot is
  -- the discriminant.
  invoice_slot      TEXT NOT NULL CHECK (
                      invoice_slot IN ('main', 'rehab')
                    ),

  -- Content hash for de-dupe / audit. sha256 of the canonical
  -- payload JSON (with test markers baked in for test posts). A
  -- second post with the same content sees the same hash and short-
  -- circuits at the idempotency guard.
  payload_hash      TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),

  -- QBO response fields. Populated on success ('created' / 'test');
  -- NULL on 'failed'. QBO assigns DocNumber; we never set it.
  qbo_invoice_id    TEXT,
  qbo_doc_number    TEXT,

  -- Recorded from the payload builder. Cents-int for exact compare.
  -- Sum of line Amounts BEFORE QBO tax computation.
  pretax_total_cents INTEGER NOT NULL CHECK (pretax_total_cents >= 0),

  -- Attempt state. 'created' = live real invoice. 'test' = live test
  -- invoice (customer 22463). 'failed' = the POST failed (adapter or
  -- proxy or QBO). 'superseded' = a later attempt replaced this row
  -- (Track B admin backdate flow, sc-XX later).
  status            TEXT NOT NULL CHECK (
                      status IN ('created', 'failed', 'test', 'superseded')
                    ),

  -- Attempt monotonically increases within (account, week, slot);
  -- ledger reader picks max(attempt) for the live view.
  attempt           INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),

  -- Free-text failure summary. NULL on success. Bounded so a QBO
  -- stack trace does not fill the row.
  error             TEXT CHECK (error IS NULL OR length(error) <= 4000),

  -- Test-flag. TRUE for every row that went to customer 22463.
  -- The partial unique index below EXCLUDES is_test=true rows so
  -- test posts never occupy the real (account, week, slot) uniqueness.
  is_test           BOOLEAN NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL
);

-- ─── 2. INDEXES ───────────────────────────────────────────────────
--
-- Partial unique on (account, week, slot) for LIVE REAL invoices.
-- Predicate: status='created' AND is_test=false. Failure rows,
-- superseded rows, and test rows never collide with the live real
-- row. This is the idempotency spine per spec §7 (posting protocol).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sc_export_ledger_live_real
  ON sc_export_ledger (account_key, week_start, invoice_slot)
  WHERE status = 'created' AND is_test = false;

-- Query index: adapter looks up (account, week, slot) regardless of
-- status to find the latest attempt.
CREATE INDEX IF NOT EXISTS idx_sc_export_ledger_lookup
  ON sc_export_ledger (account_key, week_start, invoice_slot, attempt DESC);

-- Query index: N1 / audit views scan by created_at.
CREATE INDEX IF NOT EXISTS idx_sc_export_ledger_created_at
  ON sc_export_ledger (created_at DESC);

-- ─── 3. GRANTs (mirrors sc-30 / sc-31 pattern) ────────────────────
GRANT SELECT, INSERT, UPDATE ON sc_export_ledger TO service_role;
GRANT REFERENCES, TRIGGER      ON sc_export_ledger TO anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Table columns present.
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'sc_export_ledger'
-- ORDER BY ordinal_position;

-- V2. CHECKs present.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.sc_export_ledger'::regclass
--   AND contype = 'c'
-- ORDER BY conname;

-- V3. Partial unique index installed.
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'sc_export_ledger'
-- ORDER BY indexname;
-- Expect uniq_sc_export_ledger_live_real to carry
--   WHERE ((status = 'created'::text) AND (is_test = false)).

-- V4. GRANTs match sc-31 peer pattern.
--
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'sc_export_ledger'
-- ORDER BY grantee, privilege_type;
-- Expect service_role has SELECT / INSERT / UPDATE; anon +
-- authenticated have REFERENCES + TRIGGER only.

-- V5. Re-apply is idempotent.
--
-- Re-running this file in Studio touches zero rows: CREATE TABLE IF
-- NOT EXISTS + CREATE INDEX IF NOT EXISTS + GRANT-with-existing =
-- no-op. Verified by pasting the migration a second time in Studio.
