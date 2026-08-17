-- ════════════════════════════════════════════════════════════════════════════
-- li-2: durable line-item extraction (A1)
-- ════════════════════════════════════════════════════════════════════════════
-- Turns line-item extraction into a claim-and-run job that is owned by the
-- submission row itself. No separate `extraction_jobs` table - a second store
-- is a second thing that can silently fall out of sync, which is the failure
-- class this PR eliminates.
--
-- Companion code lands in the same PR (feat/li-a1-durable-extraction):
--   - src/lib/invoiceActions.js         (removes the fire-and-forget
--                                        triggerAIScan call on line 1012;
--                                        keeps extractAndStoreLineItems
--                                        as-is, adds classify_failure)
--   - src/lib/dataStore/invoice.js      (upsertInvoiceSubmissionPostgres
--                                        writes ai_scan_status = 'queued'
--                                        at insert time, plus the new
--                                        lease/attempt columns)
--   - src/app/api/cron/extract-line-items/route.js (worker)
--   - scripts/backfill-queued-line-items.mjs        (backfill)
--
-- ─── Why the invariants ──────────────────────────────────────────────────
--
-- Extraction is currently started with a promise nobody awaits
-- (invoiceActions.js:1012) inside the invoice-submit handler, which returns
-- its HTTP response immediately. On Vercel the instance suspends when the
-- response is sent; the pending work only advances if a later request
-- happens to thaw that instance. Median extraction is 22s and tail reaches
-- 51s, so most invoices survive by luck. When a submission is the last one
-- before a quiet stretch, nothing wakes the instance, the extraction dies
-- before markScanStatus runs, and the row stays ai_scan_status=NULL with
-- no ai_scan_error and zero line items. Evidence: 59 of 442 submissions
-- in the last 30 days (13.3%) went silent that way, and 70.9% of NULL-
-- status rows over the last 45 days were the last submission before a
-- quiet period with median 21.6 hours to the submitter's next submission
-- (vs 16.9% and 2.9 minutes for invoices that completed).
--
-- The submission row itself becomes the job. invoice-submit writes
-- ai_scan_status = 'queued' in the same PG write that creates the row, so
-- NULL becomes structurally impossible for new rows. A worker cron claims
-- 'queued' rows atomically with FOR UPDATE SKIP LOCKED (so two overlapping
-- worker ticks can never grab the same invoice), extracts through the
-- existing extractAndStoreLineItems, records the outcome, and returns.
-- A lease timestamp lets a crashed worker's rows come back to 'queued'
-- automatically once the lease expires - no manual cleanup ever.
--
-- ─── NULL admissibility on ai_scan_status ────────────────────────────────
--
-- Kevin's spec asks me to argue this choice rather than decide silently.
--
-- The invariant we want post-migration: for any submission created via the
-- app AFTER this migration + code deploy, ai_scan_status is never NULL. It
-- is set to 'queued' by upsertInvoiceSubmissionPostgres in the same INSERT
-- that creates the row, and only transitions to 'complete' | 'failed' |
-- 'pg_failed' from the worker.
--
-- 552 existing rows currently sit at NULL (verified against live PG on
-- 2026-08-17). Two choices:
--
--   (a) Forbid NULL in the new CHECK. This means the migration itself
--       MUST convert every one of those 552 rows to a non-NULL value first,
--       inside the same Studio session, or the CHECK swap fails on the
--       ADD CONSTRAINT step. Doing that inside the migration file couples
--       schema + data changes into one atomic Studio paste, which is more
--       failure surface than needed - and the backfill script that lands
--       alongside this PR is what SHOULD own that write (staggered
--       next_attempt_at values so the worker doesn't thundering-herd
--       Anthropic when it wakes up). Migration and backfill are two
--       different concerns.
--
--   (b) Permit NULL in the new CHECK. The invariant is enforced by the
--       INSERT path (queued literal in the payload), not by the schema.
--       Existing NULL rows stay legal for the ~few minutes between the
--       Studio-apply and the backfill script's first tick, then the
--       backfill sets them to 'queued'. Any NULL that persists AFTER that
--       is a real anomaly worth Sentry-alerting on, not a schema error.
--
-- I chose (b). Rationale:
--   1. It keeps this migration idempotent and side-effect-free - no data
--      writes inside the CHECK swap.
--   2. It matches the existing constraint's admissibility (which already
--      permits NULL) so no existing row transitions state on the swap.
--   3. It lets the backfill script own the transition to 'queued' with
--      its stagger schedule, which is exactly the coordination it needs
--      to avoid the July credit-balance-outage repro.
--   4. Acceptance item #1 is testable exactly the way it needs to be:
--      every NEW submission carries queued at insert time (enforced by
--      the code path), and any NULL post-backfill is an alert-worthy
--      anomaly (enforced by observation, not schema).
--
-- Trade-off: a defective code path that forgets to set ai_scan_status
-- on INSERT would land a NULL that the schema wouldn't reject. Mitigated
-- by: (i) the INSERT literal is right there in upsertInvoiceSubmissionPostgres
-- and covered by acceptance item #1; (ii) a scheduled monitor comparing
-- COUNT(*) FILTER (ai_scan_status IS NULL AND submitted_at > <migration_apply_ts>)
-- against 0 catches drift. That monitor is out of scope for this PR but
-- worth a rider ticket.
--
-- ─── Verify block design (READ-ONLY, per A0 lesson) ──────────────────────
--
-- A0's li-1 file shipped a verify step that did BEGIN; UPDATE ...; ROLLBACK;
-- against a live row. Kevin applies statements in Studio one at a time,
-- where each execution is its own transaction. The BEGIN does nothing,
-- the UPDATE commits, and the ROLLBACK does nothing. Any verify step that
-- can commit a write is a defect.
--
-- The verify block below is entirely SELECTs. Two of the outcome checks
-- (does 'queued' pass CHECK? does the claim function exist and behave?)
-- are documented as post-apply UI actions for Kevin rather than baked-in
-- writes, since even a scoped UPDATE-on-a-real-row would commit in
-- Studio's per-statement transaction model.
--
-- ─── Constraint name verification ────────────────────────────────────────
--
-- Verified against live PG on 2026-08-17 via a mechanical probe
-- (attempted UPDATE with '__zzz_probe_invalid__'; PG rejected with
-- error 23514 naming the constraint). Name matches the spec exactly:
--
--   invoice_submissions_ai_scan_status_check
--
-- The DROP below uses that exact name and does NOT use IF EXISTS. If the
-- constraint is renamed or absent when this migration runs, we WANT the
-- ADD CONSTRAINT step later to be preceded by a loud failure that names
-- what happened - the A0 exercise existed because IF EXISTS silently
-- masked a mis-named constraint for months. If Kevin sees an unexpected
-- DROP failure here, that's the correct signal to stop and re-verify.
--
-- ─── Grants ──────────────────────────────────────────────────────────────
--
-- No new tables (this migration ALTERs invoice_submissions in place). The
-- new function get_extraction_claims is granted EXECUTE to service_role
-- only. anon + authenticated get nothing on it - the worker route calls it
-- with the service client, and there is no user-facing surface that needs
-- to claim jobs.
--
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Step 1: add lease and attempt columns to invoice_submissions ─────────
-- All nullable. ai_scan_attempt defaults 0 for new rows; existing rows keep
-- NULL and the backfill script sets 0 explicitly on the same UPDATE that
-- flips their status to 'queued'. Same for ai_scan_next_attempt_at: NULL
-- on existing rows until the backfill assigns staggered values.
ALTER TABLE public.invoice_submissions
  ADD COLUMN IF NOT EXISTS ai_scan_attempt         integer,
  ADD COLUMN IF NOT EXISTS ai_scan_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_scan_claimed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS ai_scan_claimed_by      text;

COMMENT ON COLUMN public.invoice_submissions.ai_scan_attempt IS
  'Number of extraction attempts made. Set to 0 by upsertInvoiceSubmissionPostgres '
  'on INSERT (new rows) and by the backfill script on existing rows. Incremented '
  'inside get_extraction_claims each time the row is claimed.';

COMMENT ON COLUMN public.invoice_submissions.ai_scan_next_attempt_at IS
  'Earliest time at which this row is eligible for a worker claim. Set on INSERT '
  '(new rows: now()) and by the worker after a retryable failure (backoff schedule). '
  'The backfill script uses staggered values so the worker does not thundering-herd '
  'Anthropic when it wakes up.';

COMMENT ON COLUMN public.invoice_submissions.ai_scan_claimed_at IS
  'Timestamp the current worker claimed this row. NULL when no active claim. '
  'A claim older than the lease duration (default 15 minutes) is treated as expired '
  'and the row becomes claimable again - covers the crashed-worker case with no '
  'manual cleanup.';

COMMENT ON COLUMN public.invoice_submissions.ai_scan_claimed_by IS
  'Opaque worker identifier (e.g., x-vercel-id header or run-scoped UUID). Only '
  'used for triage in logs and the /api/cron/extract-line-items summary payload. '
  'Not a security boundary.';

-- ─── Step 2: partial index for the claim query ────────────────────────────
-- The worker claim runs every few minutes forever, so the eligibility
-- predicate must not table-scan. Rows in non-terminal states are a small
-- fraction of the table (currently ~633 / 1,844 = 34%; expected to drop
-- toward zero as the backlog drains). Partial index keys on
-- (ai_scan_next_attempt_at) since that is the ORDER BY of the claim query,
-- and includes the state columns used in the WHERE.
CREATE INDEX IF NOT EXISTS invoice_submissions_extraction_queue_idx
  ON public.invoice_submissions (ai_scan_next_attempt_at)
  WHERE ai_scan_status IN ('queued', 'failed');

COMMENT ON INDEX public.invoice_submissions_extraction_queue_idx IS
  'Supports the get_extraction_claims eligibility scan. Partial predicate keeps '
  'the index small - complete/photo-only/pg_failed rows are excluded, and pg_failed '
  'is treated as terminal here (it means Sheets has line items and the PG side '
  'needs manual DELETE-then-re-extract per Kevin''s 2026-08-12 ruling).';

-- ─── Step 3: swap the ai_scan_status CHECK ────────────────────────────────
-- Constraint name verified against live PG on 2026-08-17 via mechanical
-- probe (see header). DROP by exact name, no IF EXISTS.
ALTER TABLE public.invoice_submissions
  DROP CONSTRAINT invoice_submissions_ai_scan_status_check;

ALTER TABLE public.invoice_submissions
  ADD CONSTRAINT invoice_submissions_ai_scan_status_check
  CHECK (
    ai_scan_status IS NULL OR ai_scan_status IN (
      'queued',       -- NEW: set by upsertInvoiceSubmissionPostgres on INSERT
      'pending',      -- pre-existing; kept for the 7 legacy rows still on it
      'complete',
      'failed',       -- retryable-soon / retryable-later after attempt-ceiling
      'photo-only',   -- dead value going forward; kept for historical rows
      'pg_failed'     -- dual-write inverse: Sheets has rows, PG insert threw
    )
  );

COMMENT ON CONSTRAINT invoice_submissions_ai_scan_status_check ON public.invoice_submissions IS
  'Admissible values for ai_scan_status. NULL is permitted for legacy rows only - '
  'the app-side INSERT path always sets queued, and the backfill script sets queued '
  'on every existing NULL row. Any post-backfill NULL is anomalous and worth an '
  'alert. See li-2 migration header for the argued choice.';

-- ─── Step 4: get_extraction_claims function ───────────────────────────────
-- Atomic claim. FOR UPDATE SKIP LOCKED means two overlapping worker ticks
-- never grab the same row (which would double-extract and collide on the
-- ai_line_items partial unique index ai_line_items_new_dedup_idx). Returns
-- the claimed rows so the worker can iterate them without a second SELECT.
--
-- SECURITY DEFINER so the worker's service_role EXECUTE grant is sufficient
-- (no need to grant UPDATE on invoice_submissions to any additional role).
-- search_path pinned to public,pg_temp to close the SECURITY DEFINER search-
-- path attack surface.
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
      -- Eligible states: 'queued' (new work), and 'failed' when the worker
      -- has scheduled a retry. pg_failed is terminal here - it needs the
      -- DELETE-then-INSERT ruling per invoice, not a blind retry.
      s.ai_scan_status IN ('queued', 'failed')
      -- Next attempt is due (or unscheduled, which the backfill script
      -- should never leave but we tolerate as "due now" for safety).
      AND (s.ai_scan_next_attempt_at IS NULL OR s.ai_scan_next_attempt_at <= now())
      -- Lease is free or expired. NULL means no active claim; an expired
      -- claim means the previous worker died mid-extraction (or the
      -- process is genuinely stuck) and this row is claimable again.
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
  'Atomically claim up to p_limit extraction jobs for worker p_worker_id, using a '
  'lease of p_lease_seconds. Uses FOR UPDATE SKIP LOCKED so overlapping worker '
  'ticks never claim the same row. Increments ai_scan_attempt and sets the claim '
  'timestamp inside the same UPDATE that returns the rows. Called only by the '
  'service-role client from /api/cron/extract-line-items - not exposed to anon '
  'or authenticated.';

-- ─── GRANTs ────────────────────────────────────────────────────────────────
-- service_role holds the app-facing write privileges. anon +
-- authenticated get REFERENCES + TRIGGER by default from the postgres
-- role's DEFAULT PRIVILEGES (see sc-34 + docs/audits/GRANT_HYGIENE_
-- 2026-07-29.md §10); do not re-grant them here.
--
-- No new tables in this migration - the four ADD COLUMN steps above are
-- on the existing public.invoice_submissions, which already has its
-- grants set from pr-6-1-invoice-schema.sql. The new columns inherit
-- those grants automatically.
--
-- The get_extraction_claims function is the only new grantable object.
-- REVOKE public first (PG grants EXECUTE to PUBLIC on new functions by
-- default in some setups), then GRANT to service_role only.
REVOKE ALL ON FUNCTION public.get_extraction_claims(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_extraction_claims(integer, integer, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY BLOCK (READ-ONLY - see A0 lesson in the header)
-- ════════════════════════════════════════════════════════════════════════════
-- Every statement below is a SELECT. Two post-apply behavior checks
-- (does 'queued' now pass the CHECK? does the claim function behave?)
-- are documented as UI actions for Kevin at the bottom of this block
-- rather than as executable statements, because a scoped UPDATE would
-- commit under Studio's per-statement transaction model.

-- V1: the four new columns exist with the expected types.
-- Expected 4 rows: ai_scan_attempt (integer), ai_scan_next_attempt_at
-- (timestamp with time zone), ai_scan_claimed_at (timestamp with time
-- zone), ai_scan_claimed_by (text).
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
-- Expected: exactly one row, constraint_name =
-- 'invoice_submissions_ai_scan_status_check', check_clause contains 'queued'.
SELECT cc.constraint_name, cc.check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = cc.constraint_name
 AND ccu.constraint_schema = cc.constraint_schema
WHERE ccu.table_schema = 'public'
  AND ccu.table_name = 'invoice_submissions'
  AND ccu.column_name = 'ai_scan_status';

-- V3: the partial index is in place.
-- Expected 1 row: invoice_submissions_extraction_queue_idx.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'invoice_submissions'
  AND indexname = 'invoice_submissions_extraction_queue_idx';

-- V4: get_extraction_claims exists with the expected signature.
-- Expected 1 row.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_function_result(p.oid) AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_extraction_claims';

-- V5: EXECUTE grant on the function is scoped to service_role.
-- Expected 1 row: grantee = service_role, privilege_type = EXECUTE.
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'get_extraction_claims'
  AND privilege_type = 'EXECUTE'
ORDER BY grantee;

-- V6: current distribution of ai_scan_status (pre-backfill snapshot).
-- Expected on 2026-08-17 (from the pre-apply probe):
--   complete: 1200, (null): 552, failed: 65, photo-only: 11, pg_failed: 9,
--   pending: 7. 'queued' should be 0 until the backfill runs.
SELECT COALESCE(ai_scan_status, '(null)') AS status, COUNT(*)::int AS n
FROM public.invoice_submissions
GROUP BY 1
ORDER BY 2 DESC;

-- ─── Post-apply UI actions for Kevin (NOT SQL - do these in the app) ─────
--
-- UA1: Submit a real invoice through the ops hub and confirm the row lands
--      with ai_scan_status = 'queued'. Query it via the Studio SQL editor:
--        SELECT client_uuid, ai_scan_status, ai_scan_attempt,
--               ai_scan_next_attempt_at
--        FROM public.invoice_submissions
--        WHERE client_uuid = '<the uuid you just submitted>';
--      Expected: ai_scan_status = 'queued', ai_scan_attempt = 0,
--      ai_scan_next_attempt_at within the last few seconds. This is
--      acceptance item #1.
--
-- UA2: Hit the worker cron once manually with the CRON_SECRET bearer:
--        curl -H "Authorization: Bearer $CRON_SECRET" \
--          https://<deploy>/api/cron/extract-line-items
--      Confirm the JSON summary reports claimed >= 1 (assuming there's
--      a queued row) and that after the tick the submission's
--      ai_scan_status flipped to 'complete' (or 'failed' + reason).
--      Also confirm ai_scan_claimed_by is populated. This is the
--      per-tick smoke test for acceptance items #2, #3, #4.
--
-- No SQL below this line is intended to test a write. Anything that
-- would commit under Studio's per-statement model belongs in the app.
