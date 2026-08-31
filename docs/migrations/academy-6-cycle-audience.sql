-- ═══════════════════════════════════════════════════════════════════
-- academy-6-cycle-audience.sql
--
-- Add audience_scope JSONB to academy_cycles so a cycle can be
-- published to a subset of people rather than to everyone its
-- obligations happen to reach. See spec Sections 5, 6, 12, 15
-- (v1 is a Kevin-only pilot; today that is unexpressable).
--
-- Column authored
-- ───────────────
--   academy_cycles.audience_scope   JSONB NOT NULL DEFAULT '{}'
--
-- Shape (all keys optional)
-- ─────────────────────────
--   {
--     "worker_class": "all" | "salaried" | "hourly",
--     "accounts":     ["CIN - AZ", "TXR - AZ"],
--     "regions":      ["West"],
--     "worker_ids":   ["6418e1e52a44e07c8b303f7b"]
--   }
--
-- No new table, so no TRUNCATE revoke block is needed. The
-- academy-3 REVOKE on academy_cycles is unchanged by adding a
-- column, and TRUNCATE is a table-level privilege that a column
-- add cannot re-grant. Sanity-checked before omitting.
--
-- Companion changes
-- ─────────────────
-- Composition, scope validation, and publish-time refusals live
-- in src/lib/academy/requirements.js. The publish_cycle_atomic
-- RPC (academy-5) is unchanged - scope narrowing is resolved on
-- the JS side into a pre-computed row list before the RPC ever
-- runs, consistent with the "RPC does not own eligibility"
-- principle. If a caller ever bypassed the JS path with an
-- empty p_rows on a scope-set cycle, the RPC still runs cleanly
-- (empty is legal from the RPC's view); the JS refuses the
-- zero-resolution case with a specific message before it can
-- ever get there. This asymmetry is deliberate; the alternative
-- (RPC re-reading the scope and applying it) would fork the
-- validation.
--
-- Namespace + apply discipline
-- ────────────────────────────
-- Same as prior academy migrations: CREATE UNIQUE INDEX IF NOT
-- EXISTS + verify block + applied-in-Studio attestation. Author
-- only - Kevin applies in Studio; the migration-gate check on
-- this PR fails until Kevin comments `applied in Studio: YES`.
-- ═══════════════════════════════════════════════════════════════════


-- ─── academy_cycles.audience_scope ─────────────────────────────────
-- ADD COLUMN IF NOT EXISTS is safe on re-apply. Every existing row
-- (none today; academy_cycles is empty) picks up the default '{}'.
ALTER TABLE academy_cycles
  ADD COLUMN IF NOT EXISTS audience_scope JSONB NOT NULL DEFAULT '{}'::jsonb;

-- GIN index so a scope query like "which cycles included site X"
-- or "which cycles targeted worker Y" is a real index scan rather
-- than a full-table filter. Cheap: academy_cycles is one row per
-- calendar month, so worst-case ~12 rows/year.
CREATE INDEX IF NOT EXISTS academy_cycles_audience_scope_gin
  ON academy_cycles USING GIN (audience_scope);

COMMENT ON COLUMN academy_cycles.audience_scope IS
  'Optional narrowing filter applied on top of each obligation''s
   applies_to. Shape is an object with any subset of {worker_class,
   accounts, regions, worker_ids}; all keys optional; keys present
   are intersected (a person must satisfy every key present).
   Empty object ({}) means no narrowing - current behaviour, the
   whole obligation audience. Scope NARROWS, never widens: a
   person must pass BOTH the obligation''s applies_to AND the
   cycle''s audience_scope. A cycle scoped to hourly carrying a
   salaried obligation resolves to zero people for that module.
   worker_ids is the explicit allowlist that makes a Kevin-only
   pilot (spec Section 15) possible - deliberately blunt and
   auditable; the cycle row records exactly who it was scoped to.
   Validation of the values inside (accounts / regions / worker_ids
   / worker_class) lives in src/lib/academy/requirements.js at
   publish-plan time - see planCyclePublish. The engine refuses
   the publish if any value does not resolve, or if the resolved
   population is zero.';


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   All safe on every apply (no writes, no probes).
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. Column exists with the expected type + default + not-null.
-- Expected: 1 row, data_type=jsonb, is_nullable=NO, column_default='''{}''::jsonb'.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'academy_cycles'
  AND column_name  = 'audience_scope';

-- P2. GIN index exists.
-- Expected: 1 row.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'academy_cycles'
  AND indexname  = 'academy_cycles_audience_scope_gin';

-- P3. Comment landed on the column.
-- Expected: 1 row with a non-null description starting with
-- "Optional narrowing filter".
SELECT c.relname AS table_name,
       a.attname AS column_name,
       d.description
FROM pg_description d
JOIN pg_attribute a
  ON a.attrelid = d.objoid AND a.attnum = d.objsubid
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'academy_cycles'
  AND a.attname = 'audience_scope';

-- P4. Every current row (should be zero on first apply; a rehydrated
-- Kevin-authored cycle if any) has default '{}' - proves the
-- backfill semantics of ADD COLUMN with a default.
-- Expected: all_default = total_rows (both may be 0).
SELECT
  count(*)                                                         AS total_rows,
  count(*) FILTER (WHERE audience_scope = '{}'::jsonb)             AS all_default;

-- P5. TRUNCATE fence unchanged from academy-3.
-- Expected: 0 rows (service_role / anon / authenticated have no
-- TRUNCATE on academy_cycles).
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'academy_cycles'
  AND grantee IN ('anon', 'authenticated', 'service_role')
  AND privilege_type = 'TRUNCATE';


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file in Studio. The
-- migration-gate check on this PR looks for the phrase
-- `applied in Studio: YES` in a comment from an OWNER account and
-- re-emits the check_run on the current SHA.
--
-- applied in Studio: PENDING
-- sha:               <fill in commit SHA>
-- applied by:        k.fietek@kitchfix.com
-- applied at:        <fill in ISO timestamp>
-- p1_column:         <expected 1 row: jsonb, NOT NULL, default '{}'::jsonb>
-- p2_gin_index:      <expected 1 row>
-- p3_comment:        <expected 1 row with description starting "Optional narrowing filter">
-- p4_default_backfill: <expected all_default = total_rows>
-- p5_no_truncate:    <expected 0 rows - fence unchanged>
-- notes:             <optional>
