-- ════════════════════════════════════════════════════════════════════════════
-- li-4: extraction crash guard + vendor-level opt-out
-- ════════════════════════════════════════════════════════════════════════════
-- Companion to the PR on branch fix/invoice-scanner-crash-loop. Addresses the
-- third episode of a cron-tick crash loop on /api/cron/extract-line-items -
-- 2026-08-30 (160 attempts), 2026-09-15 (140-141), 2026-10-14 (420 / 418 /
-- 402). The function timed out mid-extraction every tick for roughly two
-- days, re-claiming the same three rows every five minutes and burning the
-- full 300-second ceiling each time.
--
-- The runtime side of the fix:
--   - 600-second lease (previously 300, resonant with maxDuration and cron
--     tick - a killed run's rows were re-claimable instantly).
--   - CLAIM_LIMIT 1 so one bad document burns at most one invocation.
--   - stop_reason = max_tokens treated as terminal, no inner retry.
--   - Worker resets ai_scan_crash_count whenever it writes an outcome.
--   - Worker reaps crash-capped rows at the top of every run.
--
-- The SQL side of the fix:
--   - A crash counter column, incremented inside get_extraction_claims ONLY
--     when a row is re-claimed while its previous claim is still set (i.e.
--     the previous worker died mid-extraction). A clean release path -
--     retryable-later credit-balance self-heal, retryable-soon backoff -
--     clears the claim and never trips the counter.
--   - A ceiling of 10 on the crash counter inside the eligibility predicate.
--     Deliberately NOT a cap on ai_scan_attempt: the retryable-later billing
--     path legitimately runs roughly 84 clean attempts over 7 days, and a
--     flat ai_scan_attempt cap would break the credit-balance self-heal.
--   - A vendors.extract_line_items flag so service vendors (uniform, linen,
--     equipment) can be routed to AP without extraction. Data, not a
--     hardcoded list; editable without a deploy.
--
-- Signature of get_extraction_claims is unchanged, so existing grants carry
-- over through CREATE OR REPLACE. No GRANT statement here.
--
-- APPLY NOTE: Studio applies statements one at a time, each in its own
-- transaction. The verify block at the bottom is read-only SELECTs only -
-- any step that could commit would land uncontrolled on a partial state.


-- ─── Step 1: ai_scan_crash_count on invoice_submissions ───────────────────
ALTER TABLE public.invoice_submissions
  ADD COLUMN IF NOT EXISTS ai_scan_crash_count integer;

COMMENT ON COLUMN public.invoice_submissions.ai_scan_crash_count IS
  'Consecutive claims that ended without the worker writing an outcome - i.e. '
  'the function was killed mid-extraction. Incremented inside get_extraction_claims '
  'only when a row is re-claimed while its previous claim is still set. Reset to 0 '
  'by the worker whenever an outcome is written. Distinct from ai_scan_attempt, '
  'which counts all claims including clean retryable-later backoff cycles.';


-- ─── Step 2: crash-aware claim function ───────────────────────────────────
-- Signature unchanged from li-2 so grants on (integer, integer, text) carry
-- over. Candidate CTE handles both clean re-claim (uncapped) and crash
-- re-claim (capped at v_max_crashes). Crash increment uses the pre-update
-- value of ai_scan_claimed_at - UPDATE SET expressions reference the OLD
-- row in PostgreSQL - so the +1 fires only when the previous claim was
-- still live at UPDATE time.
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
DECLARE
  -- Crash ceiling. At a 5-minute tick this bounds a jam to roughly 50
  -- minutes instead of indefinitely. Deliberately NOT a cap on
  -- ai_scan_attempt: the retryable-later billing path needs ~84 clean
  -- attempts over 7 days.
  v_max_crashes constant integer := 10;
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
    FROM public.invoice_submissions s
    WHERE
      -- 'queued' only. 'failed' is terminal - see li-2 header.
      s.ai_scan_status = 'queued'
      AND (s.ai_scan_next_attempt_at IS NULL OR s.ai_scan_next_attempt_at <= now())
      AND (
        -- Clean re-claim: the previous attempt finished and released its
        -- claim. Uncapped - this is the normal backoff path. The worker
        -- clears ai_scan_claimed_at on every outcome write.
        s.ai_scan_claimed_at IS NULL
        -- Crash re-claim: the claim is still set, so the previous attempt
        -- died without writing an outcome. Capped at v_max_crashes.
        OR (
          s.ai_scan_claimed_at < now() - make_interval(secs => p_lease_seconds)
          AND COALESCE(s.ai_scan_crash_count, 0) < v_max_crashes
        )
      )
    ORDER BY s.ai_scan_next_attempt_at NULLS FIRST, s.submitted_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.invoice_submissions s
  SET
    ai_scan_claimed_at  = now(),
    ai_scan_claimed_by  = p_worker_id,
    ai_scan_attempt     = COALESCE(s.ai_scan_attempt, 0) + 1,
    -- Only a re-claim over a live claim counts as a crash.
    ai_scan_crash_count = COALESCE(s.ai_scan_crash_count, 0)
                          + CASE WHEN s.ai_scan_claimed_at IS NOT NULL THEN 1 ELSE 0 END
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
  'Atomically claim up to p_limit queued extraction jobs for worker p_worker_id, using a lease of p_lease_seconds. FOR UPDATE SKIP LOCKED means overlapping worker ticks never claim the same row. Clean re-claims (previous worker released the claim) are uncapped. Crash re-claims (claim still set past the lease) are capped at 10 via ai_scan_crash_count. Called only by the service-role client from /api/cron/extract-line-items.';


-- ─── Step 3: vendor-level opt-out ─────────────────────────────────────────
-- Service vendors (uniform, linen, equipment) submit invoices that carry
-- no pack sizes and distort line-item analysis. The worker skips them by
-- never admitting them to the queue - the submit path writes
-- ai_scan_status = 'photo-only' when this flag is false. Data, not a
-- hardcoded list; editable in Studio without a deploy.
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS extract_line_items boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.vendors.extract_line_items IS
  'When false, invoices from this vendor are stamped and routed to AP but not '
  'line-item extracted. For service vendors - uniform, linen, equipment - whose '
  'invoices carry no pack sizes and distort food analysis. Data, not a hardcoded '
  'list: editable without a deploy.';


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFY BLOCK (read-only SELECTs only)
-- ────────────────────────────────────────────────────────────────────────────
-- Each SELECT runs independently in Studio. Read the output of each.

-- V1. ai_scan_crash_count column exists with the right type.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'invoice_submissions'
  AND column_name  = 'ai_scan_crash_count';

-- V2. Function body contains the new crash-counter logic. The literal
-- strings below are present only in the new version; a result of 1 proves
-- the CREATE OR REPLACE landed.
SELECT
  routine_name,
  (position('ai_scan_crash_count' IN routine_definition) > 0) AS has_crash_col,
  (position('v_max_crashes'       IN routine_definition) > 0) AS has_ceiling,
  (position('Crash re-claim'      IN routine_definition) > 0) AS has_crash_branch
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'get_extraction_claims';

-- V3. vendors.extract_line_items exists with NOT NULL DEFAULT true, and
-- every existing vendor is defaulted to true (no vendor opted out yet).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vendors'
  AND column_name  = 'extract_line_items';

SELECT extract_line_items, count(*) AS vendor_count
FROM public.vendors
GROUP BY extract_line_items
ORDER BY extract_line_items;

-- V4. Current ai_scan_status distribution snapshot. No modification.
SELECT ai_scan_status, count(*) AS n
FROM public.invoice_submissions
GROUP BY ai_scan_status
ORDER BY n DESC;

-- V5. Any row already past the crash ceiling that the worker will reap on
-- first tick post-apply. Expect 0 immediately after apply (column is new
-- and NULL for all existing rows).
SELECT count(*) AS rows_at_ceiling
FROM public.invoice_submissions
WHERE ai_scan_status = 'queued'
  AND COALESCE(ai_scan_crash_count, 0) >= 10;
