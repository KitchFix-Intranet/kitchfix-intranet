-- ════════════════════════════════════════════════════════════════════════════
-- cron-heartbeat: generalized run-log for scheduled jobs.
-- ════════════════════════════════════════════════════════════════════════════
-- Companion to the PR on branch cron-heartbeat. Addresses the signal gap
-- surfaced by the 2026-10-14 invoice-scanner crash loop: nothing in the repo
-- knew that /api/cron/extract-line-items had been running broken for two days.
--
-- Generalizes purchasing_derive_runs (docs/migrations/purchasing-1-schema.sql
-- line 440) to an arbitrary job_name with a JSONB summary, so each cron
-- reports its own shape (extract-line-items: claimed/complete/reaped;
-- schedule-drift: drift counts; sc-chase: stage + scanned/sent; etc.) without
-- force-fitting fixed count columns.
--
-- APPLIED IN STUDIO by Kevin. Code that reads/writes this table ships only
-- after apply. The companion PR opens as DRAFT with the migration gate and
-- flips to ready-for-review once Kevin confirms with `applied in Studio: YES`.


-- ─── Step 1: cron_runs table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id            bigserial PRIMARY KEY,
  job_name      text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  status        text NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'success', 'failed')),
  summary       jsonb,
  error_message text
);

COMMENT ON TABLE public.cron_runs IS
  'One row per cron invocation across the four surviving scheduled jobs plus '
  'the cron-health watchdog. Status starts in_progress on claim and the host '
  'cron updates to success/failed on exit. A row that stays in_progress past '
  '2x maxDuration is the signal a worker crashed or timed out mid-run - this '
  'is what the watchdog keys on. summary is JSONB so each job can report its '
  'own shape without a shared column set.';

COMMENT ON COLUMN public.cron_runs.job_name IS
  'Logical cron name (not the route path). Known values: extract-line-items, '
  'sc-chase, schedule-drift, sc-bg-monthly-report, cron-health.';

COMMENT ON COLUMN public.cron_runs.summary IS
  'JSONB blob of per-job metrics. extract-line-items passes its existing '
  'response payload (claimed, complete, reaped, etc.) straight through. '
  'cron-health stores its debounce state here too (alerted = per-job iso '
  'timestamp, lastAllClearAt = iso).';


-- ─── Step 2: indexes ─────────────────────────────────────────────────────
-- NULLS FIRST on the completed index is deliberate: an in_progress row has
-- a null completed_at and must sort to the top as "most recent" so the
-- watchdog sees an unfinished run rather than skipping past it to the last
-- clean success. The started_at index supports the watchdog's stale-run
-- check (latest in_progress + started_at older than 2x maxDuration).
CREATE INDEX IF NOT EXISTS cron_runs_job_completed_idx
  ON public.cron_runs (job_name, completed_at DESC NULLS FIRST);

CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx
  ON public.cron_runs (job_name, started_at DESC);


-- ─── Step 3: grants ──────────────────────────────────────────────────────
-- Matches the purchasing_derive_runs pattern verified live in production:
-- service_role gets SELECT + INSERT + UPDATE on the table, plus USAGE on
-- the identity sequence. No anon/authenticated grants (same posture as
-- purchasing_derive_runs; both tables are service-side only). All crons
-- reach this table via getServiceClient().
GRANT SELECT, INSERT, UPDATE ON public.cron_runs           TO service_role;
GRANT USAGE                 ON SEQUENCE public.cron_runs_id_seq TO service_role;


-- ─── Step 4: baseline seed rows ──────────────────────────────────────────
-- One 'success' row per monitored job at apply time so the watchdog's
-- silence SLA measures from deploy, not from the epoch. Without these,
-- every rare job (monthly report, weekly drift, biweekly chase) would
-- alert "no run ever logged" every 6h from deploy until its first natural
-- run - up to a month of false alerts for sc-bg-monthly-report. The first
-- real run of each job supersedes its seed (newer completed_at wins the
-- watchdog's latest-row sort). cron-health seeds itself on its own first
-- tick, so it is not listed here.
INSERT INTO public.cron_runs (job_name, status, started_at, completed_at, summary)
VALUES
  ('extract-line-items',   'success', now(), now(), '{"seed":true}'::jsonb),
  ('sc-chase',             'success', now(), now(), '{"seed":true}'::jsonb),
  ('schedule-drift',       'success', now(), now(), '{"seed":true}'::jsonb),
  ('sc-bg-monthly-report', 'success', now(), now(), '{"seed":true}'::jsonb);


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFY BLOCK (read-only SELECTs only)
-- ────────────────────────────────────────────────────────────────────────────
-- Each SELECT runs independently in Studio. Read the output of each.

-- V1. Table + columns exist with the expected shape.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'cron_runs'
ORDER BY ordinal_position;

-- V2. Status check constraint carries the three expected states.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.cron_runs'::regclass
  AND contype  = 'c';

-- V3. Both indexes present.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'cron_runs'
ORDER BY indexname;

-- V4. Grants match the purchasing_derive_runs posture (service_role: SELECT
-- + INSERT + UPDATE; no anon/authenticated grants beyond defaults).
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'cron_runs'
ORDER BY grantee, privilege_type;

-- V5. Row count after seed. Expect 4 (one per monitored job).
SELECT count(*) AS row_count FROM public.cron_runs;

-- V6. Seed rows: one 'success' row per monitored job with summary->>'seed'
-- equal to 'true'. Expect exactly 4 rows: extract-line-items, sc-chase,
-- schedule-drift, sc-bg-monthly-report. The watchdog relies on these so
-- rare jobs do not false-alert "no run ever logged" between deploy and
-- their first natural run.
SELECT job_name, status, summary->>'seed' AS is_seed, completed_at
FROM public.cron_runs
WHERE summary->>'seed' = 'true'
ORDER BY job_name;
