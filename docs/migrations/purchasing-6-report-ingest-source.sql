-- purchasing-6-report-ingest-source.sql
--
-- Add `rippling_report` to the CHECK constraint on
-- `purchasing_derive_runs.source` so the report-ingest orchestrator
-- can write its own success / failed rows.
--
-- Board's freshness pill (src/app/api/kpi/purchasing/route.js
-- loadFreshness) reads the most-recent `source='rippling_report'`
-- row's completed_at + status to decide whether the pill shows fresh
-- or stale.  Without this constraint update, the orchestrator's
-- INSERT fails with a check-constraint violation and the pill has no
-- signal to read.
--
-- No new tables, so no new GRANT needed - the existing
-- `service_role` grant on `purchasing_derive_runs` carries.  The
-- migration-gate verify probe below reads
-- `information_schema.role_table_grants` to confirm that.
--
-- APPLY IN STUDIO before merging the PR that uses `rippling_report`.
-- The workflow will fail loudly on its first run if the constraint
-- has not been widened.

BEGIN;

ALTER TABLE purchasing_derive_runs
  DROP CONSTRAINT IF EXISTS purchasing_derive_runs_source_check;

ALTER TABLE purchasing_derive_runs
  ADD CONSTRAINT purchasing_derive_runs_source_check
  CHECK (source IN ('billcom', 'rippling_spend', 'rippling_report'));

COMMIT;

-- Verify probe (run in Studio SQL editor after APPLY):
--
-- 1. constraint present with the new value:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM   pg_constraint
-- WHERE  conname = 'purchasing_derive_runs_source_check';
-- expected: CHECK ((source = ANY (ARRAY['billcom'::text, 'rippling_spend'::text, 'rippling_report'::text])))
--
-- 2. service_role grant still in place (per Kevin's GRANT + verify rule
--    - no new table but confirm the existing grants read):
-- SELECT grantee, privilege_type
-- FROM   information_schema.role_table_grants
-- WHERE  table_schema = 'public'
--   AND  table_name   = 'purchasing_derive_runs'
--   AND  grantee      = 'service_role'
-- ORDER  BY privilege_type;
-- expected: at minimum SELECT, INSERT, UPDATE, DELETE for service_role
