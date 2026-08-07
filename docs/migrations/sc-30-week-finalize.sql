-- ═══════════════════════════════════════════════════════════════════
-- sc-30: per-week finalize state (PR-A of the SC -> QBO billing arc)
-- 2026-08-06
-- ═══════════════════════════════════════════════════════════════════
--
-- Ships the storage for the week-level finalize signal that replaces
-- Sebastian's Excel highlight convention and gates the QBO invoice
-- push in PR-C.
--
-- Spec authority: docs/SC_QBO_SHAPE_SPEC.md §3 (state machine) + §6
-- (data model). Kevin signed the spec v1.0 on 2026-08-06. Where this
-- migration and the spec disagree, the spec wins - if you spot a
-- disagreement, STOP and report it, do not silently reconcile.
--
-- What this migration adds:
--   1. `sc_week_finalize` table - per (account, Mon-Sun week) state
--      row. INSERT on finalize; UPDATE for every state transition.
--   2. CHECK constraints codifying the finalized|push_failed|billed|
--      reverted status set and the "reverted rows must carry
--      revert_by/at/reason" invariant.
--   3. Partial UNIQUE index on (account_key, week_start) WHERE
--      status != 'reverted' - one LIVE row per (account, week);
--      reverted rows fall out of the uniqueness and a fresh finalize
--      can INSERT a new live row on the same tuple.
--   4. Read-index for the week-lookup shape the finalize predicate
--      and UI use.
--   5. GRANTs mirroring the sc-22 pattern: SELECT + INSERT + UPDATE
--      to service_role; REFERENCES + TRIGGER to anon/authenticated;
--      NO DELETE (state changes via UPDATE, not row removal - the
--      audit trail is the row history).
--
-- The state machine (docs/SC_QBO_SHAPE_SPEC.md §3, verbatim):
--
--     OPEN -> FINALIZED -> BILLED
--               |             \
--               v              -> (terminal for site leaders; K-3 freeze)
--           PUSH_FAILED -> (retry) -> BILLED
--
-- OPEN is the ABSENCE of a live row for that (account, week). No
-- 'open' status exists in the enum. The table only carries rows the
-- moment a site leader presses Finalize.
--
-- Reversal: UPDATE the live row's status from finalized/push_failed
-- to 'reverted', set reverted_by/at/revert_reason atomically. That
-- row leaves the partial unique index (status != 'reverted' filter)
-- so a subsequent finalize on the same (account, week) INSERTs a
-- new live row. History for that (account, week) is the ordered
-- list of rows keyed on finalized_at.
--
-- BILLED IS A ONE-WAY DOOR (K-3). Server code refuses billed ->
-- reverted transitions; no DB CHECK enforces it because the DB
-- cannot distinguish an override-member's Sebastian-directed
-- correction from a rogue write. That gate lives in the server
-- action.
--
-- Owner rulings this codifies:
--   - K-1 (2026-08-06): the week is the billing atom, per-week
--     finalize sits INSIDE the period lock, both signals stack.
--   - K-3 (2026-08-06): billed weeks are frozen server-side.
--     Corrections route through Sebastian manually in v1.
--   - K-10 (2026-08-06): override group = Kevin + Joe + Sebastian.
--     Enforced application-side in `SC_LOCK_OVERRIDE` (see the
--     src/lib/admin.js edit in this PR). The DB is agnostic to
--     override identity.
--
-- Read-only-until-called (sc-25 discipline): creating the table
-- does NOT enforce anything on writes to other tables. The
-- `assertWeekOpenForWrite` predicate (src/lib/scWeekFinalize.js,
-- this PR) is what wires the table's data into the four sc-25
-- write paths (sc-submit-day, sc-reset-day, sc-bulk-submit,
-- sc-submit-closeout). Applying this migration without the code
-- changes is a no-op. Applying the code without the migration
-- would 500 the RPC/select calls - the migration gate on this PR
-- prevents that.
--
-- Retroactive effect: ZERO. The table starts empty. No historic
-- week transitions to 'finalized' silently. Every finalize is an
-- explicit action.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + guarded CHECK adds +
-- CREATE INDEX IF NOT EXISTS. Re-apply is safe.
--
-- Apply order:
--   - Paste in Supabase Studio.
--   - Single BEGIN/COMMIT.
--   - Verify with the block at the bottom (COMMENTED, ready to
--     paste individually - NOT part of the migration).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_week_finalize (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity. account_key CHECK mirrors sc_homestand_closeout so the
  -- string shape is consistent across the SC billing tables. STL-FL
  -- (fee) is INCLUDED in the CHECK - the fee-exclusion rule is a
  -- server-side gate (per-meal accounts only) not a schema exclusion,
  -- so tightening this CHECK to per-meal-only would leak the pilot
  -- exclusion into the migration and require another migration to
  -- extend to the fee-shape-billing case that comes later. Structural
  -- exclusion belongs in code (the SC_TO_QBO_PROJECT_MASTER seed set).
  account_key              TEXT NOT NULL CHECK (
                             account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                           ),

  -- Week identity. Mon-Sun weeks only; week_start is always a Monday.
  -- The CHECK enforces this at the DB level so no code path can
  -- accidentally store a Sunday-anchored or arbitrary-anchored week.
  -- ISO day-of-week: Monday=1..Sunday=7.
  week_start               DATE NOT NULL CHECK (
                             extract(isodow from week_start) = 1
                           ),

  -- State enum. See file header for the state machine. `open` is
  -- NOT a status - the absence of a live row means open.
  status                   TEXT NOT NULL CHECK (
                             status IN ('finalized', 'push_failed', 'billed', 'reverted')
                           ),

  -- Finalize provenance. NOT NULL on both - every row was born from
  -- a finalize action.
  finalized_by             TEXT NOT NULL,
  finalized_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Reverted provenance. NULL when status != 'reverted'; all three
  -- must be non-NULL when status = 'reverted'. Enforced by the
  -- CHECK below.
  reverted_by              TEXT,
  reverted_at              TIMESTAMPTZ,
  revert_reason            TEXT CHECK (
                             revert_reason IS NULL
                             OR (length(trim(revert_reason)) > 0
                                 AND length(revert_reason) <= 280)
                           ),

  -- Invariant: reverted status requires all three reverted_* set;
  -- non-reverted status requires all three unset. Prevents partial-
  -- fill mistakes on either side.
  CHECK (
    (status = 'reverted'
      AND reverted_by IS NOT NULL
      AND reverted_at IS NOT NULL
      AND revert_reason IS NOT NULL)
    OR
    (status != 'reverted'
      AND reverted_by IS NULL
      AND reverted_at IS NULL
      AND revert_reason IS NULL)
  ),

  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. INDEXES ─────────────────────────────────────────────────────
-- Partial UNIQUE: one LIVE row per (account, week). Reverted rows
-- do not count against uniqueness so a re-finalize on the same tuple
-- can INSERT a new live row (spec §3).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_week_finalize_live
  ON sc_week_finalize (account_key, week_start)
  WHERE status != 'reverted';

-- History read: newest-first by finalized_at, keyed on
-- (account, week) for the revert-history and audit surfaces.
CREATE INDEX IF NOT EXISTS idx_sc_week_finalize_history
  ON sc_week_finalize (account_key, week_start, finalized_at DESC);

-- ─── 3. GRANTs (sc-22 pattern) ──────────────────────────────────────
-- SELECT + INSERT + UPDATE only to service_role. No DELETE by
-- design: state changes via UPDATE (reverted), never row removal.
-- The row IS the audit trail; a DELETE would erase it.
GRANT SELECT, INSERT, UPDATE ON sc_week_finalize TO service_role;

-- REFERENCES + TRIGGER for anon/authenticated. Matches sc-22 so a
-- future FK from sc_export_ledger (PR-C, sc-32) can reference this
-- table without a grant migration in between.
GRANT REFERENCES, TRIGGER ON sc_week_finalize TO anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
--   Everything above the COMMIT ran as one transaction. Everything
--   below is a read-only SELECT you paste and run separately in
--   Studio to confirm the shape. Each SELECT is standalone.
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Table exists with the expected column set.
--     Expected: 10 rows in the column list; column names + types
--     match the CREATE TABLE above.
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'sc_week_finalize'
-- ORDER BY ordinal_position;


-- V2. CHECK constraints present. Expected: five constraint rows -
--     status enum, week_start ISO Monday, revert_reason length,
--     reverted-invariant, plus the account_key regex.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.sc_week_finalize'::regclass
--   AND contype = 'c'
-- ORDER BY conname;


-- V3. Both indexes present + the partial unique's WHERE clause is
--     the right shape (`status <> 'reverted'::text` in the
--     definition string).
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename = 'sc_week_finalize'
-- ORDER BY indexname;


-- V4. GRANTs. Expected: service_role has SELECT/INSERT/UPDATE (no
--     DELETE); anon + authenticated have REFERENCES + TRIGGER.
--
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'sc_week_finalize'
-- ORDER BY grantee, privilege_type;


-- V5. Row count is zero (retroactive effect note in the header).
--
-- SELECT COUNT(*) FROM sc_week_finalize;


-- V6. Live-row semantics smoke test. Insert a finalized row, then
--     a reverted row on the same (account, week), then a second
--     finalized row on the same tuple. Expect: the two finalized
--     rows constitute a partial-index violation the SECOND time
--     around unless the first is first flipped to reverted.
--     Run only in a scratch environment; delete afterward.
--
-- INSERT INTO sc_week_finalize
--   (account_key, week_start, status, finalized_by)
-- VALUES ('TXR - AZ', '2026-08-03', 'finalized', 'probe@kitchfix.com');
--
-- UPDATE sc_week_finalize
-- SET status = 'reverted',
--     reverted_by = 'probe@kitchfix.com',
--     reverted_at = now(),
--     revert_reason = 'sc-30 verify block'
-- WHERE account_key = 'TXR - AZ' AND week_start = '2026-08-03'
--   AND status = 'finalized';
--
-- INSERT INTO sc_week_finalize
--   (account_key, week_start, status, finalized_by)
-- VALUES ('TXR - AZ', '2026-08-03', 'finalized', 'probe@kitchfix.com');
--
-- SELECT status, finalized_by, reverted_by, revert_reason
-- FROM sc_week_finalize
-- WHERE account_key = 'TXR - AZ' AND week_start = '2026-08-03'
-- ORDER BY finalized_at;
--
-- -- Cleanup (do NOT leave probe rows in prod):
-- DELETE FROM sc_week_finalize
-- WHERE account_key = 'TXR - AZ' AND week_start = '2026-08-03'
--   AND finalized_by = 'probe@kitchfix.com';
-- -- (DELETE is denied to service_role; the cleanup must run under a
-- --  role that owns the table, or be omitted in favor of leaving the
-- --  scratch rows in a non-prod DB.)
