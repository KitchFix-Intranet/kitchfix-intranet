-- pr-2-range-drop-last-13wk.sql
--
-- Range PR-2 (multi-select ranges). Owner ruling 2026-08-24: Last 13
-- weeks preset is removed from the KPI labor board because it could
-- not be justified in the 2026-08-19 review. Client + API drop the
-- key in the same PR; this migration closes the loop on the schema
-- side so a whitelist cannot outlive the preset it names.
--
-- Verified before shipping: kpi_saved_views is empty (0 rows total,
-- 0 rows carrying date_preset='last_13wk'), so the CHECK constraint
-- swap is a pure schema change with no data-migration step.
--
-- Verify probe: after apply, INSERT with date_preset='last_13wk'
-- should fail with a CHECK violation; INSERT with 'last_4wk' should
-- succeed. Owner runs one of each via `insert...returning` in Studio.

BEGIN;

ALTER TABLE public.kpi_saved_views
  DROP CONSTRAINT IF EXISTS kpi_saved_views_preset_known;

ALTER TABLE public.kpi_saved_views
  ADD CONSTRAINT kpi_saved_views_preset_known
  CHECK (
    date_preset IS NULL
    OR date_preset IN ('this_period', 'last_period', 'last_4wk', 'fytd')
  );

COMMIT;
