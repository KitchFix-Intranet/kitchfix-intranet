-- ═══════════════════════════════════════════════════════════════════
-- sc-6a-catalog-active-until.sql
-- Service Calendar - Bundle 2 Step 1 (catalog lifecycle, additive half)
--
-- Adds a nullable `active_until DATE` column on sc_services AND
-- sc_service_groups. This is the BILLING-RELEVANT archive mechanism
-- the future view recreate (sc-6b) will filter on.
--
--   NULL                   -> active forever (default for every existing row)
--   active_until = X       -> active through and including day X; days
--                             STRICTLY AFTER X are not active
--   reactivate             -> SET active_until = NULL
--
-- A date in the past, today, or the future are all legitimate values:
--   past   = backdated archive (clean up something that has actually
--            been off the menu for months)
--   today  = archive as of today
--   future = scheduled future archive (e.g. service ends on contract date)
--
-- Mirrors the Bundle 1 Stage 3 backdate discipline - same field, same
-- date semantics, no separate "as-of" timestamp needed.
--
-- ═══════════════════════════════════════════════════════════════════
-- THREE-WAY CLARIFICATION (active / active_until / deleted_at)
-- ═══════════════════════════════════════════════════════════════════
-- The catalog tables now carry THREE history-affecting fields. They
-- mean different things and the next maintainer needs to know which
-- is which. This is the canonical statement:
--
--   `active`        BOOLEAN, currently on both tables. PRE-EXISTING.
--                   UI VISIBILITY TOGGLE ONLY. The revenue views do
--                   NOT filter on it (confirmed in the Bundle 2 recon:
--                   a service with active=false STILL appears in
--                   sc_daily_revenue today). updateServiceConfig's
--                   "deactivate" path flips this to false; the admin
--                   UI hides those services client-side. Billing
--                   numbers are unaffected. We are NOT changing or
--                   retiring this column in this migration; that is
--                   a separate future cleanup.
--
--   `active_until`  DATE, added by THIS migration. The REAL,
--                   BILLING-RELEVANT archive. The view recreate in
--                   sc-6b will add the JOIN condition
--                     (active_until IS NULL OR sd.service_date <= active_until)
--                   so that historical days BEFORE archive still count
--                   in sc_daily_revenue / sc_month_summary, but days
--                   AFTER archive are excluded going forward.
--                   This migration adds the column only; the view
--                   does not yet read it.
--
--   `deleted_at`    TIMESTAMPTZ, currently on both tables. PRE-EXISTING.
--                   The view JOINs DO filter on `deleted_at IS NULL`,
--                   but NO code path in the repo sets this column
--                   (confirmed in the Bundle 2 recon - grep). It is a
--                   dormant hard-delete escape hatch, SEPARATE from
--                   archive. Bundle 2's archive uses active_until.
--                   We are deliberately NOT wiring deleted_at to
--                   anything. Leaving the two history-affecting
--                   mechanisms legible side-by-side is preferable to
--                   silently overloading one of them.
--
-- ═══════════════════════════════════════════════════════════════════
-- SCOPE
-- ═══════════════════════════════════════════════════════════════════
-- ADDITIVE ONLY. This migration:
--   - adds two columns
--   - adds two COMMENT ON COLUMN statements
--
-- It does NOT:
--   - touch the views (sc_daily_revenue, sc_month_summary) - that is
--     sc-6b, isolated as its own apply with a snapshot-diff probe
--   - touch any other column or table
--   - backfill any value (every existing row gets NULL = active forever)
--   - add CHECK constraints on the date (any valid date is legitimate:
--     backdated, today, or future-scheduled - mirroring Stage 3)
--   - add an index (justification below)
--   - change any GRANT (ADD COLUMN inherits the table's existing
--     full-CRUD service_role grants from sc-1)
--
-- After this migration runs there is ZERO observable change in the
-- calendar. The column is dormant until sc-6b lands and admin code
-- starts setting it.
--
-- ═══════════════════════════════════════════════════════════════════
-- INDEX DECISION (none)
-- ═══════════════════════════════════════════════════════════════════
-- The future view JOIN condition will be
--   (s.active_until IS NULL OR sd.service_date <= s.active_until)
-- For nearly every row in production, active_until will be NULL (most
-- services stay active). An index on active_until would be a partial
-- index WHERE active_until IS NOT NULL with at most a few dozen rows -
-- the planner will already prefer a sequential scan over an index that
-- covers a tiny minority of rows when joined against the full service
-- catalog. The view's existing primary lookup (account_key +
-- service_date via the projection/actual tables) drives the plan;
-- the active_until check is a row-level filter, not a join key.
-- No index added. Revisit if production query plans show a problem.
--
-- ═══════════════════════════════════════════════════════════════════
-- IDEMPOTENT - safe to re-apply. Uses ADD COLUMN IF NOT EXISTS.
--
-- Apply in Supabase Studio. Verify via
--   scripts/_probe_sc6a_active_until_verify.mjs
-- before any code that reads/writes active_until ships.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1. sc_services.active_until
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE sc_services
  ADD COLUMN IF NOT EXISTS active_until DATE;

COMMENT ON COLUMN sc_services.active_until IS
  'Billing-relevant archive field. NULL = active forever (default for '
  'every row at column-add time). A date means the service was active '
  'through and including that day; days strictly after are not active. '
  'Reactivate by setting back to NULL. Future-scheduled archive = set a '
  'future date; backdated archive = set a past date (clean-up). The '
  'sc_daily_revenue view (after the sc-6b recreate) filters with '
  '(active_until IS NULL OR service_date <= active_until). '
  'SEPARATE from the pre-existing `active` BOOLEAN (UI-visibility toggle '
  'only, views do not filter on it) and from `deleted_at` (dormant '
  'hard-delete escape hatch, never set by app code).';


-- ─────────────────────────────────────────────────────────────────────
-- 2. sc_service_groups.active_until
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE sc_service_groups
  ADD COLUMN IF NOT EXISTS active_until DATE;

COMMENT ON COLUMN sc_service_groups.active_until IS
  'Billing-relevant archive field. Same semantics as '
  'sc_services.active_until: NULL = active forever; a date = active '
  'through that day inclusive, archived strictly after. Archiving a '
  'group will exclude its services from sc_daily_revenue for dates '
  'after the group''s active_until (via the group JOIN condition in '
  'the sc-6b view recreate). SEPARATE from `active` (UI toggle) and '
  '`deleted_at` (dormant hard-delete escape hatch).';


-- ═══════════════════════════════════════════════════════════════════
-- DONE
-- Verify with scripts/_probe_sc6a_active_until_verify.mjs.
-- Next step (separate migration + apply): sc-6b - the view recreate
-- that actually reads active_until. Do NOT apply sc-6b until the
-- sc-6a probe is green and Kevin has confirmed.
-- ═══════════════════════════════════════════════════════════════════
