-- ═══════════════════════════════════════════════════════════════════
-- kpi-2b-grants.sql
-- KPI Engine - service_role DML on kpi_budgets
-- 2026-08-13
-- ═══════════════════════════════════════════════════════════════════
--
-- APPLIED 2026-08-13 in Supabase Studio, out-of-band, BEFORE the
-- initial load. Kevin discovered under the current default privileges
-- that service_role held no INSERT/UPDATE on kpi_budgets (SELECT-only
-- inherited from the CREATE TABLE ownership defaults), so the
-- scripts/load_kpi_budgets_2026.mjs upsert would have failed.
-- This file is the paper trail. Re-apply is harmless (idempotent -
-- GRANT of already-held privileges is a no-op).
--
-- Kevin verified live after this ran:
--   service_role       - SELECT, INSERT, UPDATE
--   anon, authenticated - no privileges
-- Which matches the intent: the labor-route reader (getServiceClient
-- via SUPABASE_SERVICE_ROLE_KEY) reads; the loader writes; anon and
-- authenticated do not touch kpi_budgets directly.
--
-- Why this was not in kpi-2-budget-values.sql: kpi-1 relied on
-- ownership defaults and did not ship an explicit GRANT (verified:
-- `grep -c GRANT docs/migrations/kpi-1-spine.sql` = 0). kpi-2 mirrored
-- that pattern per prompt directive. On this Supabase project's
-- current default-privilege state, the pattern falls short for a
-- new table whose writer is service_role. Corrected here.
--
-- Grants are schema, not data - safe for the public repo.
--
-- ─────────────────────────────────────────────────────────────────

BEGIN;

GRANT SELECT, INSERT, UPDATE ON kpi_budgets TO service_role;

COMMIT;
