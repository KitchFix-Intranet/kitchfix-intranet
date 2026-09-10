-- ═══════════════════════════════════════════════════════════════════
-- sc-44: bg_report_recipients on sc_qbo_account_map
-- 2026-09-09
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Monthly B&G meal-count report - Kevin's commitment to Sebastian
--   on 2026-09-08. Sebastian bills Boys & Girls Club by hand and
--   needs the meals/revenue numbers per calendar month.
--
--   Recipient list per-account. First slot = TO (primary billing
--   contact, currently Sebastian). Remainder = CC (site leadership +
--   Kevin). NULL means "no report for this account" - the cron loop
--   skips accounts whose recipients column is null. Only TBR - FL
--   is populated on day one; other accounts can adopt by populating
--   the column in Studio, no code change required.
--
--   Column name mirrors the existing shape (salaried_manager_emails,
--   rdo_email) so it reads in the same neighborhood on the Studio
--   row view.
--
-- Rationale (CC, not owner-ruled):
--   Kevin's ruling on the recon: "recipients: Sebastian, cc TBR
--   leadership and Kevin. Per your recon, a bg_report_recipients
--   column on sc_qbo_account_map is the right home." A separate
--   sc_bg_recipients table was considered and rejected - one row
--   per account, no history needed, and colocating with the other
--   recipient columns matches the ergonomic Kevin already uses when
--   maintaining site leaders + RDOs.
--
-- Fences:
--   - Additive only. Existing rows: bg_report_recipients defaults to
--     NULL, which the cron reads as "skip". Zero risk to any account
--     that hasn't opted in.
--   - No CHECK constraint on element shape (email validation happens
--     in the resolver at send time so a bad address logs + fails
--     loudly rather than silently rejecting rows on insert).
--   - Kevin populates TBR - FL after apply. The cron will skip TBR
--     until the array is non-empty; skip is logged so a missed
--     populate does not silently disable the report.
--
-- Apply order:
--   ONE block. ALTER TABLE runs atomically.
--
-- Verify: paste BLOCK B afterward. Confirms the column landed and
-- the initial population state (should be NULL on every row).
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: schema change (single transaction)
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE sc_qbo_account_map
  ADD COLUMN IF NOT EXISTS bg_report_recipients TEXT[];

COMMENT ON COLUMN sc_qbo_account_map.bg_report_recipients IS
  'Monthly B&G meal-count report recipient list. NULL = no report for this account (cron skips). Non-empty array: first slot is TO, remainder is CC. Populated in Studio; email validation happens at send time.';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: verify (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Query 1: confirm the column exists with the right type.
SELECT column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map'
  AND column_name  = 'bg_report_recipients';

-- Expected 1 row:
--   bg_report_recipients | ARRAY | _text | YES


-- Query 2: confirm initial state (no account has opted in yet).
SELECT account_key,
       bg_report_recipients,
       CASE
         WHEN bg_report_recipients IS NULL           THEN 'skip (opt-out)'
         WHEN array_length(bg_report_recipients, 1) IS NULL THEN 'ERROR: empty array'
         ELSE 'active - ' || array_length(bg_report_recipients, 1) || ' recipient(s)'
       END AS report_status
FROM sc_qbo_account_map
ORDER BY account_key;

-- Expected: every account shows 'skip (opt-out)' until Kevin
-- populates TBR - FL below.


-- Query 3 (Kevin runs after BLOCK A): populate TBR - FL with
-- Sebastian + Kevin + TBR salaried list. Substitute the actual
-- email addresses before running.
--
-- UPDATE sc_qbo_account_map
--   SET bg_report_recipients = ARRAY[
--     'sebastian@kitchfix.com',                -- TO (billing)
--     'k.fietek@kitchfix.com',                 -- CC
--     'joe.coppolino@kitchfix.com'             -- CC (add other TBR leadership here)
--     -- add more addresses here comma-separated
--   ]
--   WHERE account_key = 'TBR - FL';
--
-- Then re-run Query 2 to confirm TBR - FL shows 'active - N recipient(s)'.


-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed - do not run in normal flow)
-- ═══════════════════════════════════════════════════════════════════
--
-- Any account with bg_report_recipients populated will lose its
-- recipient list on rollback. Confirm no active account before
-- dropping.
--
-- BEGIN;
--   ALTER TABLE sc_qbo_account_map
--     DROP COLUMN IF EXISTS bg_report_recipients;
-- COMMIT;
