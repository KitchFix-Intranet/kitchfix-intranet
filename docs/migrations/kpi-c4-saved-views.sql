-- kpi-c4-saved-views.sql
--
-- KPI PR C4: saved views for the labor surface (and future KPI tabs).
-- A saved view stores INTENT (preset date semantics, worker selection,
-- redaction, share flag), NOT resolved dates. "Joe's monthly" must
-- mean "last complete period" today AND next month; a hardcoded
-- 2026-06-29 through 2026-07-12 window would be silently useless a
-- month later.
--
-- New table: kpi_saved_views. No changes to existing objects.
--
-- Access is enforced at the API route (server-side via
-- OPS_LEADERSHIP_EMAILS from src/lib/admin.js) - the same gate as
-- labor and labor/export. This migration does NOT add RLS; the
-- service_role client bypasses RLS by design, and the auth boundary
-- lives one layer up in the route handlers.
--
-- Applied: NOT YET. Kevin reviews, then Studio.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'kpi-c4 pre-flight: accounts table missing';
  END IF;
  IF to_regclass('public.kpi_saved_views') IS NOT NULL THEN
    RAISE NOTICE 'kpi-c4: kpi_saved_views already exists - migration is idempotent-safe below';
  END IF;
END $$;

-- ─── Table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_saved_views (
  id            BIGSERIAL PRIMARY KEY,
  owner_email   TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  account_key   TEXT        NOT NULL REFERENCES public.accounts(team_key) ON DELETE CASCADE,
  tab           TEXT        NOT NULL DEFAULT 'labor',
  date_mode     TEXT        NOT NULL,
  date_preset   TEXT        NULL,
  date_from     DATE        NULL,
  date_to       DATE        NULL,
  worker_ids    TEXT[]      NULL,       -- null = all workers (distinct from empty array)
  redact        BOOLEAN     NOT NULL DEFAULT false,
  is_shared     BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce the date-mode contract at the schema level so an app-code
  -- regression cannot write a broken row. preset requires date_preset
  -- populated and both dates null; absolute requires both dates
  -- populated and date_preset null.
  CONSTRAINT kpi_saved_views_date_mode_valid
    CHECK (date_mode IN ('preset', 'absolute')),
  CONSTRAINT kpi_saved_views_date_shape_matches_mode
    CHECK (
      (date_mode = 'preset'
        AND date_preset IS NOT NULL
        AND date_from IS NULL
        AND date_to IS NULL)
      OR
      (date_mode = 'absolute'
        AND date_preset IS NULL
        AND date_from IS NOT NULL
        AND date_to IS NOT NULL
        AND date_from <= date_to)
    ),

  -- Kept small and explicit so a typo in the app becomes a check
  -- violation rather than a valid-looking preset that resolves to
  -- undefined. When we add new presets in the UI, add them here first.
  CONSTRAINT kpi_saved_views_preset_known
    CHECK (
      date_preset IS NULL
      OR date_preset IN ('this_period', 'last_period', 'last_4wk', 'last_13wk', 'fytd')
    ),

  CONSTRAINT kpi_saved_views_tab_known
    CHECK (tab IN ('labor')),

  CONSTRAINT kpi_saved_views_name_length
    CHECK (char_length(name) BETWEEN 1 AND 80),

  CONSTRAINT kpi_saved_views_owner_email_lowercase
    CHECK (owner_email = lower(owner_email))
);

-- One person cannot have two views with the same name.
CREATE UNIQUE INDEX IF NOT EXISTS kpi_saved_views_owner_name_uk
  ON public.kpi_saved_views (owner_email, name);

-- Fast reads on the two lookups the API does:
--   1) list-for-user: WHERE owner_email = $me OR is_shared = true
--   2) load-by-id:    PK-covered
CREATE INDEX IF NOT EXISTS kpi_saved_views_owner_email_ix
  ON public.kpi_saved_views (owner_email);
CREATE INDEX IF NOT EXISTS kpi_saved_views_is_shared_ix
  ON public.kpi_saved_views (is_shared) WHERE is_shared = true;
CREATE INDEX IF NOT EXISTS kpi_saved_views_account_key_ix
  ON public.kpi_saved_views (account_key);

-- Keep updated_at honest on every row change.
CREATE OR REPLACE FUNCTION public._kpi_saved_views_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kpi_saved_views_touch_updated_at ON public.kpi_saved_views;
CREATE TRIGGER kpi_saved_views_touch_updated_at
  BEFORE UPDATE ON public.kpi_saved_views
  FOR EACH ROW
  EXECUTE FUNCTION public._kpi_saved_views_touch_updated_at();

-- ─── Comments (self-documenting for Studio) ─────────────────────────
COMMENT ON TABLE  public.kpi_saved_views          IS 'KPI dashboard saved views. Stores INTENT (preset date semantics) not resolved dates - rolling ranges must stay rolling.';
COMMENT ON COLUMN public.kpi_saved_views.worker_ids IS 'NULL means all workers (distinct from empty array). Empty array is a valid saved state (no rows), NULL is a saved intent (all workers currently on the account).';
COMMENT ON COLUMN public.kpi_saved_views.date_mode  IS 'preset = rolling (resolves at query time); absolute = fixed window (audit-style).';
COMMENT ON COLUMN public.kpi_saved_views.is_shared  IS 'When true, the view is readable by any OPS_LEADERSHIP_EMAILS user. Edits still gated to the owner.';

COMMIT;

-- ─── Rollback (paste in Studio if needed) ───────────────────────────
--   BEGIN;
--   DROP TRIGGER  IF EXISTS kpi_saved_views_touch_updated_at ON public.kpi_saved_views;
--   DROP FUNCTION IF EXISTS public._kpi_saved_views_touch_updated_at();
--   DROP TABLE    IF EXISTS public.kpi_saved_views;
--   COMMIT;
