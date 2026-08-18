-- ════════════════════════════════════════════════════════════════════════════
-- li-2: durable line-item extraction (A1)
-- ════════════════════════════════════════════════════════════════════════════
-- Turns line-item extraction into a claim-and-run job owned by the submission
-- row itself. No separate `extraction_jobs` table - a second store is a second
-- thing that can silently fall out of sync, which is the failure class this PR
-- eliminates.
--
-- Companion code in the same PR (feat/li-a1-durable-extraction):
--   - src/lib/invoiceActions.js                     (removes fire-and-forget)
--   - src/lib/dataStore/invoice.js                  (writes 'queued' on INSERT)
--   - src/app/api/cron/extract-line-items/route.js  (worker)
--   - scripts/backfill-queued-line-items.mjs        (backfill, 160 eligible)
--
-- ─── Why ─────────────────────────────────────────────────────────────────
--
-- Extraction is currently started with a promise nobody awaits
-- (invoiceActions.js:1012) inside invoice-submit, which returns its HTTP
-- response immediately. Vercel suspends the instance when the response is
-- sent; the pending work only advances if a later request thaws it. Median
-- extraction is 22s, tail 51s, so most invoices survive by luck. When a
-- submission is the last one before a quiet stretch, nothing wakes the
-- instance and extraction dies before markScanStatus runs - leaving
-- ai_scan_status NULL, no ai_scan_error, zero line items.
--
-- Evidence: 59 of 442 submissions in the last 30 days went silent that way.
-- Over 45 days, 70.9% of NULL-status rows were the last submission before a
-- quiet period, median 21.6 hours to that submitter's next submission, versus
-- 16.9% and 2.9 minutes for invoices that completed.
--
-- The submission row becomes the job. invoice-submit writes 'queued' in the
-- same PG write that creates the row, so NULL is structurally impossible for
-- new rows. A worker cron claims 'queued' rows atomically with FOR UPDATE
-- SKIP LOCKED, extracts through the existing extractAndStoreLineItems,
-- records the outcome, and returns. A lease timestamp brings a crashed
-- worker's rows back automatically.
--
-- ─── State machine (this is why the claim set is 'queued' only) ──────────
--
--   queued     -> wants work. Claimable.
--   complete   -> terminal, success.
--   failed     -> terminal. NOT claimable.
--   pg_failed  -> terminal. Sheets holds rows, PG insert threw. Needs the
--                 per-invoice DELETE-then-INSERT ruling (2026-08-12), never
--                 a blind retry.
--   photo-only -> dead value, historical rows only.
--   pending    -> legacy, 7 historical rows.
--
-- The worker writes a RETRYABLE failure back to 'queued' with a backoff
-- (route.js:345-352). It only leaves a row at 'failed' when the outcome is
-- terminal. So 'failed' must not be claimable.
--
-- CORRECTION (2026-08-18, Chat-Claude review before apply): the first draft
-- of this migration admitted ai_scan_status IN ('queued','failed') in both
-- the index predicate and the claim function. That is wrong and would have
-- undone the backfill's eligibility fix on the worker's very first tick.
--
-- All 65 existing 'failed' rows have ai_scan_next_attempt_at IS NULL (the
-- column does not exist yet), and the function treats NULL as "due now". So
-- the worker would have immediately claimed all 65 - including 13 historical
-- rows, 6 credit memos, and 11 with no source PDF, exactly the cohorts the
-- backfill filter was written to exclude. The backfill runs once and filters
-- carefully; the claim function runs every five minutes forever and did not
-- filter at all. The invariant belonged in the function, not the script.
--
-- Fixed by claiming 'queued' only. Eligibility (is_historical, type,
-- raw_drive_url, status) stays owned by the backfill script rather than
-- being duplicated here: a row that fails a filter inside the claim function
-- would sit at 'queued' forever with no signal, re-creating the silent-stuck
-- class this whole PR exists to remove. A3's digest surfaces anything queued
-- and unclaimed for more than an hour.
--
-- ─── NULL admissibility on ai_scan_status ────────────────────────────────
--
-- 552 existing rows sit at NULL. Two choices:
--
--   (a) Forbid NULL now. The migration would have to convert all 552 rows
--       inside the same Studio session or the ADD CONSTRAINT fails. That
--       couples schema and data changes into one paste, and the backfill
--       script - which owns the staggered next_attempt_at values that stop
--       the worker thundering-herding Anthropic - is what should own that
--       write. Two different concerns.
--
--   (b) Permit NULL. The invariant is enforced by the INSERT path. Existing
--       NULLs stay legal until the backfill sets them to 'queued'. Any NULL
--       after that is a real anomaly worth alerting on, not a schema error.
--
-- Chose (b): keeps this migration free of data writes, matches the existing
-- constraint's admissibility so no row changes state on the swap, and lets
-- the backfill own the transition. li-3 tightens this to NOT NULL once the
-- backlog drains - already authored and deliberately unapplied.
--
-- ─── Verify block (READ-ONLY, per the A0 lesson) ─────────────────────────
--
-- A0's li-1 file shipped a verify step doing BEGIN; UPDATE; ROLLBACK against
-- a live row. Statements are applied one at a time in Studio, where each
-- execution is its own transaction: the BEGIN does nothing, the UPDATE
-- COMMITS, the ROLLBACK does nothing. Any verify step that can commit is a
-- defect. Everything below the banner is a SELECT.
--
-- V7 is a smoke call with p_limit = 0. plpgsql only syntax-checks at CREATE
-- time; name resolution happens on first execution, and the RETURNS TABLE
-- output names collide with real column names. Without V7 the function could
-- apply cleanly and then fail on the worker's first tick. p_limit = 0 makes
-- the CTE select nothing and the UPDATE touch nothing.
--
-- ─── Constraint name ─────────────────────────────────────────────────────
--
-- invoice_submissions_ai_scan_status_check - read directly from pg_constraint
-- on 2026-08-17. Current definition:
--   CHECK ((ai_scan_status IS NULL) OR (ai_scan_status = ANY (ARRAY[
--     'pending','complete','failed','photo-only','pg_failed'])))
--
-- DROP uses the exact name with NO IF EXISTS. If the constraint is renamed or
-- absent, we WANT a loud failure - A0 existed because IF EXISTS silently
-- masked a mis-named constraint for months. An unexpected DROP failure here
-- is the signal to stop and re-verify, not to add IF EXISTS.
--
-- Safety: all 1,844 existing rows pass the new CHECK (verified 2026-08-18 -
-- complete 1200, null 552, failed 65, photo-only 11, pg_failed 9, pending 7).
-- The ADD CONSTRAINT cannot fail on existing data.
--
-- ─── Grants ──────────────────────────────────────────────────────────────
--
-- No new tables. The four ADD COLUMN steps inherit invoice_submissions'
-- existing grants from pr-6-1. get_extraction_claims is the only new
-- grantable object: REVOKE from PUBLIC, GRANT EXECUTE to service_role only.
--
-- ─── Apply order ─────────────────────────────────────────────────────────
--
-- Steps 3a and 3b leave the column unconstrained between them. Run those two
-- back to back.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Step 1: lease and attempt columns ────────────────────────────────────
ALTER TABLE public.invoice_submissions
  ADD COLUMN IF NOT EXISTS ai_scan_attempt         integer,
  ADD COLUMN IF NOT EXISTS ai_scan_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_scan_claimed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS ai_scan_claimed_by      text;


-- ─── Step 2: column comments ──────────────────────────────────────────────
COMMENT ON COLUMN public.invoice_submissions.ai_scan_attempt IS
  'Extraction attempts made. Written as 0 by upsertInvoiceSubmissionPostgres on INSERT and by the backfill script on existing rows - there is deliberately no schema DEFAULT, so a row with NULL here was created outside those two paths. Incremented inside get_extraction_claims on each claim.';

COMMENT ON COLUMN public.invoice_submissions.ai_scan_next_attempt_at IS
  'Earliest time this row is eligible for a worker claim. now() on INSERT; a backoff timestamp after a retryable failure; staggered values from the backfill so the worker does not thundering-herd Anthropic.';

COMMENT ON COLUMN public.invoice_submissions.ai_scan_claimed_at IS
  'When the current worker claimed this row. NULL when no active claim. A claim older than the lease duration is treated as expired and the row becomes claimable again - covers the crashed-worker case with no manual cleanup.';

COMMENT ON COLUMN public.invoice_submissions.ai_scan_claimed_by IS
  'Opaque worker identifier, for log triage and the worker summary payload. Not a security boundary.';


-- ─── Step 3a: drop the old CHECK (run back to back with 3b) ───────────────
ALTER TABLE public.invoice_submissions
  DROP CONSTRAINT invoice_submissions_ai_scan_status_check;


-- ─── Step 3b: add the new CHECK admitting 'queued' ────────────────────────
ALTER TABLE public.invoice_submissions
  ADD CONSTRAINT invoice_submissions_ai_scan_status_check
  CHECK (
    ai_scan_status IS NULL OR ai_scan_status IN (
      'queued',
      'pending',
      'complete',
      'failed',
      'photo-only',
      'pg_failed'
    )
  );

COMMENT ON CONSTRAINT invoice_submissions_ai_scan_status_check ON public.invoice_submissions IS
  'Admissible ai_scan_status values. NULL is permitted for legacy rows only - the app INSERT path always writes queued, and the backfill sets queued on every existing NULL. Any post-backfill NULL is anomalous. li-3 tightens this to NOT NULL once the backlog drains.';


-- ─── Step 4: partial index for the claim query ────────────────────────────
-- Predicate matches the claim function exactly: 'queued' only. Keeping
-- 'failed' here would index rows the function can never claim.
CREATE INDEX IF NOT EXISTS invoice_submissions_extraction_queue_idx
  ON public.invoice_submissions (ai_scan_next_attempt_at)
  WHERE ai_scan_status = 'queued';

COMMENT ON INDEX public.invoice_submissions_extraction_queue_idx IS
  'Supports the get_extraction_claims eligibility scan. Partial predicate matches the function''s claim set exactly - queued only. Terminal states (complete, failed, pg_failed, photo-only) are excluded.';


-- ─── Step 5: the claim function ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_extraction_claims(
  p_limit          integer,
  p_lease_seconds  integer,
  p_worker_id      text
)
RETURNS TABLE (
  client_uuid      uuid,
  account_key      text,
  vendor_name      text,
  invoice_number   text,
  invoice_date     date,
  ai_scan_attempt  integer,
  ai_scan_status   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
    FROM public.invoice_submissions s
    WHERE
      -- 'queued' ONLY. 'failed' is terminal: the worker writes a retryable
      -- failure back to 'queued' with a backoff (route.js:345-352) and only
      -- leaves 'failed' when the outcome is genuinely terminal. Admitting
      -- 'failed' here would claim all 65 pre-existing terminal rows on the
      -- first tick, including historical rows, credit memos, and rows with
      -- no source PDF.
      s.ai_scan_status = 'queued'
      -- Due now. NULL is tolerated as "due now" - the backfill always sets a
      -- staggered value, so a NULL here means a row queued by some other
      -- path and we would rather run it than strand it.
      AND (s.ai_scan_next_attempt_at IS NULL OR s.ai_scan_next_attempt_at <= now())
      -- Lease free or expired. An expired claim means the previous worker
      -- died mid-extraction; the row becomes claimable again with no manual
      -- cleanup.
      AND (
        s.ai_scan_claimed_at IS NULL
        OR s.ai_scan_claimed_at < now() - make_interval(secs => p_lease_seconds)
      )
    ORDER BY s.ai_scan_next_attempt_at NULLS FIRST, s.submitted_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.invoice_submissions s
  SET
    ai_scan_claimed_at = now(),
    ai_scan_claimed_by = p_worker_id,
    ai_scan_attempt    = COALESCE(s.ai_scan_attempt, 0) + 1
  FROM candidates c
  WHERE s.id = c.id
  RETURNING
    s.client_uuid,
    s.account_key,
    s.vendor_name,
    s.invoice_number,
    s.invoice_date,
    s.ai_scan_attempt,
    s.ai_scan_status;
END;
$$;

COMMENT ON FUNCTION public.get_extraction_claims(integer, integer, text) IS
  'Atomically claim up to p_limit queued extraction jobs for worker p_worker_id, using a lease of p_lease_seconds. FOR UPDATE SKIP LOCKED means overlapping worker ticks never claim the same row. Increments ai_scan_attempt and sets the claim timestamp inside the same UPDATE that returns the rows. Claims queued rows only - failed and pg_failed are terminal. Called only by the service-role client from /api/cron/extract-line-items.';


-- ─── Step 6: grants ───────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_extraction_claims(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_extraction_claims(integer, integer, text) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY BLOCK - READ ONLY. Nothing below writes a row.
-- ════════════════════════════════════════════════════════════════════════════

-- V1: the four new columns exist with the expected types.
-- Expect 4 rows: ai_scan_attempt (integer), ai_scan_claimed_at (timestamp
-- with time zone), ai_scan_claimed_by (text), ai_scan_next_attempt_at
-- (timestamp with time zone).
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invoice_submissions'
  AND column_name IN (
    'ai_scan_attempt', 'ai_scan_next_attempt_at',
    'ai_scan_claimed_at', 'ai_scan_claimed_by'
  )
ORDER BY column_name;


-- V2: the CHECK was swapped and now admits 'queued'.
-- Expect exactly ONE row. If two rows come back, a duplicate constraint
-- survived - stop, that is the li-1 failure mode repeating.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.invoice_submissions'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%ai_scan_status%';


-- V3: the partial index is in place and its predicate is 'queued' only.
-- Expect 1 row; indexdef must read WHERE (ai_scan_status = 'queued'::text).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'invoice_submissions'
  AND indexname = 'invoice_submissions_extraction_queue_idx';


-- V4: get_extraction_claims exists with the expected signature.
-- Expect 1 row.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_extraction_claims';


-- V5: EXECUTE is scoped to service_role.
-- Expect 1 row: service_role / EXECUTE. PUBLIC must NOT appear.
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'get_extraction_claims'
  AND privilege_type = 'EXECUTE'
ORDER BY grantee;


-- V6: pre-backfill status snapshot.
-- Expect on 2026-08-18: complete 1200, (null) 552, failed 65, photo-only 11,
-- pg_failed 9, pending 7. 'queued' should be absent until the backfill runs.
SELECT COALESCE(ai_scan_status, '(null)') AS status, COUNT(*)::int AS n
FROM public.invoice_submissions
GROUP BY 1
ORDER BY 2 DESC;


-- V7: SMOKE TEST - proves the function actually compiles and executes.
-- p_limit = 0 means the CTE selects nothing and the UPDATE touches no row.
-- Expect: zero rows returned, NO error.
-- An error here is the whole point of this check: plpgsql resolves names at
-- first execution, not at CREATE time, so a broken function would otherwise
-- apply cleanly and fail on the worker's first tick.
SELECT * FROM public.get_extraction_claims(0, 900, 'verify-smoke');


-- V8: confirm nothing was claimed by the smoke test.
-- Expect 0.
SELECT COUNT(*)::int AS rows_with_a_claim
FROM public.invoice_submissions
WHERE ai_scan_claimed_at IS NOT NULL;


-- ─── After applying: two checks in the app, not in SQL ───────────────────
--
-- UA1 (acceptance item 1): submit a real invoice, then
--       SELECT client_uuid, ai_scan_status, ai_scan_attempt,
--              ai_scan_next_attempt_at
--       FROM public.invoice_submissions
--       WHERE client_uuid = '<the uuid just submitted>';
--     Expect ai_scan_status = 'queued', ai_scan_attempt = 0,
--     ai_scan_next_attempt_at within the last few seconds.
--
-- UA2: hit the worker once with the CRON_SECRET bearer and confirm the JSON
--     summary reports claimed >= 1, the row flips to 'complete' (or 'failed'
--     with a cause), and ai_scan_claimed_by is populated.
