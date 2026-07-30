-- ═══════════════════════════════════════════════════════════════════════
-- sousai-1-phase-f-views.sql (Phase F PR 2, 2026-07-29)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Four views the Phase F SC + spend tools share. All read-only; no data
-- modification. Deliberately small - the tools do the shaping in JS, the
-- views encapsulate joins and orientation math.
--
-- Views:
--   v_current_homestand_by_account   - one row per account currently in a
--                                       homestand, per today's date.
--   v_current_period_by_account      - one row per account with an active
--                                       P1-P13 period today.
--   v_current_pdc_phase_by_account   - one row per PDC account with an
--                                       active phase today (5 accounts).
--   v_invoice_submissions_current    - one row per invoice, corrections-
--                                       chain resolved to the latest
--                                       version.
--
-- The homestand/period/phase views use CURRENT_DATE, so they re-evaluate
-- on every SELECT. Views cannot take parameters; the tools filter their
-- final result set on account_key after the view resolves.
--
-- HOW TO APPLY (per docs/GOTCHAS.md - migrations do NOT auto-apply):
--   1. Paste this entire file into Supabase Studio SQL editor and run.
--   2. Run the post-verify SELECT blocks below to check row counts +
--      shape sanity (expected values annotated inline).
--   3. Post the canonical migration-gate comment on the PR:
--        Migration gate: applied in Studio: YES
--      The `Migration gate` check flips green and merge unblocks.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- View 1: v_current_homestand_by_account
--
-- For each account currently in a homestand today, returns the
-- homestand_id, its start/end dates, days elapsed, days remaining. A day
-- is IN a homestand when sc_homestand_schedule has a row for
-- (account_key, today) with homestand_id NOT NULL. AWAY/EXHIBITION rows
-- carry homestand_id=NULL and are correctly excluded.
--
-- Authority: sc_homestand_schedule.day_type is CALENDAR TRUTH per
-- Kevin's 2026-07-14 schedule-truth doctrine (docs/modules/
-- SERVICE_CALENDAR.md "Schedule truth hierarchy"). sc-18 patched
-- sc_day_metadata.game_type to agree with it. This view reads
-- sc_homestand_schedule as the source; the metadata table is never
-- consulted for homestand membership.
--
-- Overlap guard: DISTINCT ON (account_key) with earliest-start tiebreak.
-- Nothing in the schema prevents overlapping homestand_id ranges, and
-- silently returning two rows would leave sc_orientation ambiguous.
-- Note: homestand_id is per-account, not globally unique - both CIN-OH
-- and STL-MO can carry an "HS10" with different date ranges.
-- ─────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_current_homestand_by_account;
CREATE VIEW v_current_homestand_by_account AS
WITH homestand_ranges AS (
  SELECT
    account_key,
    homestand_id,
    MIN(service_date) AS start_date,
    MAX(service_date) AS end_date
  FROM sc_homestand_schedule
  WHERE homestand_id IS NOT NULL
  GROUP BY account_key, homestand_id
),
current_ranges AS (
  SELECT *
  FROM homestand_ranges
  WHERE CURRENT_DATE BETWEEN start_date AND end_date
)
SELECT DISTINCT ON (account_key)
  account_key,
  homestand_id,
  start_date,
  end_date,
  (CURRENT_DATE - start_date)::INT AS days_elapsed,
  (end_date - CURRENT_DATE)::INT   AS days_remaining
FROM current_ranges
ORDER BY account_key, start_date, homestand_id;

COMMENT ON VIEW v_current_homestand_by_account IS
  'Phase F: current homestand per account (today only). '
  'Empty result for accounts on AWAY / OFF / EXHIBITION days. '
  'Homestand membership is derived from sc_homestand_schedule.homestand_id '
  '(calendar truth); sc_day_metadata is not consulted here. '
  'DISTINCT ON (account_key) guards against overlapping homestand ranges - '
  'earliest start wins the tiebreak.';

GRANT SELECT ON v_current_homestand_by_account TO service_role;


-- ─────────────────────────────────────────────────────────────────────
-- View 2: v_current_period_by_account
--
-- For each account with a non-NULL period today in sc_day_metadata,
-- returns the P-label plus the boundaries of the contiguous run of
-- dates with that same period value. Uses the classic "run-length
-- grouping" trick: subtract row_number-per-partition to get a stable
-- group key across contiguous same-period runs.
--
-- Coverage: 11 of 12 accounts (CORP has 0 rows in sc_day_metadata,
-- which is semantically correct - CORP is not a service account).
-- All 11 service accounts today (2026-07-29) are in period 8, Week 3.
--
-- The window function makes this view heavier than the homestand one,
-- but sc_day_metadata is bounded at ~4k rows (12 accounts * 365 days)
-- so the aggregation is cheap. If it becomes a bottleneck, drop the
-- boundary math and ship label-only.
-- ─────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_current_period_by_account;
CREATE VIEW v_current_period_by_account AS
WITH period_runs AS (
  SELECT
    account_key,
    service_date,
    period,
    week_label,
    event_label,
    service_date -
      (ROW_NUMBER() OVER (
        PARTITION BY account_key, period
        ORDER BY service_date
      ))::INT * INTERVAL '1 day' AS run_group
  FROM sc_day_metadata
  WHERE period IS NOT NULL
),
period_ranges AS (
  SELECT
    account_key,
    period,
    run_group,
    MIN(service_date) AS start_date,
    MAX(service_date) AS end_date,
    -- Sample one week_label / event_label representative for the run.
    -- These vary within a period; the tool consumes them as context, not
    -- as authority. Prefer the value for today when present, else the
    -- start-of-run value.
    (ARRAY_AGG(week_label ORDER BY service_date))[1] AS week_label_first,
    (ARRAY_AGG(event_label ORDER BY service_date))[1] AS event_label_first
  FROM period_runs
  GROUP BY account_key, period, run_group
)
SELECT
  pr.account_key,
  pr.period,
  pr.start_date,
  pr.end_date,
  (CURRENT_DATE - pr.start_date)::INT AS days_elapsed,
  (pr.end_date - CURRENT_DATE)::INT   AS days_remaining,
  today.week_label AS week_label,
  today.event_label AS event_label
FROM period_ranges pr
LEFT JOIN sc_day_metadata today
  ON today.account_key = pr.account_key
 AND today.service_date = CURRENT_DATE
WHERE CURRENT_DATE BETWEEN pr.start_date AND pr.end_date;

COMMENT ON VIEW v_current_period_by_account IS
  'Phase F: current P1-P13 period per account with boundaries + today''s '
  'week_label/event_label. Empty for CORP (no service rows) and for any '
  'account outside its season window. Uses run-length grouping on '
  'sc_day_metadata.period to find the contiguous span containing today.';

GRANT SELECT ON v_current_period_by_account TO service_role;


-- ─────────────────────────────────────────────────────────────────────
-- View 3: v_current_pdc_phase_by_account
--
-- For each of the 5 PDC accounts (CIN-AZ, TXR-AZ, TBR-FL, TBJ-FL,
-- STL-FL) currently within a phase window, returns the phase name +
-- boundaries + elapsed/remaining. Empty for the 7 non-PDC accounts by
-- construction - the phase table has no rows for them.
--
-- This is deliberately a THIRD dimension alongside homestand + period.
-- PDC facilities have no homestands and no visiting teams; for them,
-- the phase (Battery Camp / MLB ST / ACL / Bridge / Instructs-Camps /
-- OFF etc.) IS the seasonal orientation. A B5-shaped tool that asks
-- "where are we in the season" for CIN-AZ needs this view; the period
-- view alone would return "P8" which is technically true but not what
-- an operator at a PDC facility means by "where are we."
-- ─────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_current_pdc_phase_by_account;
CREATE VIEW v_current_pdc_phase_by_account AS
SELECT DISTINCT ON (account_key)
  account_key,
  phase,
  start_date,
  end_date,
  (CURRENT_DATE - start_date)::INT AS days_elapsed,
  (end_date - CURRENT_DATE)::INT   AS days_remaining
FROM sc_phase_calendar
WHERE CURRENT_DATE BETWEEN start_date AND end_date
ORDER BY account_key, start_date, phase;

COMMENT ON VIEW v_current_pdc_phase_by_account IS
  'Phase F: current PDC phase per PDC account (CIN-AZ, TXR-AZ, TBR-FL, '
  'TBJ-FL, STL-FL only - other accounts have no rows in '
  'sc_phase_calendar by design). Phase names stored verbatim per '
  'docs/SC_PDC_PHASES.md (Battery Camp, MLB ST, ACL, Bridge, etc.). '
  'DISTINCT ON (account_key) guards against overlapping phase ranges - '
  'earliest start wins the tiebreak.';

GRANT SELECT ON v_current_pdc_phase_by_account TO service_role;


-- ─────────────────────────────────────────────────────────────────────
-- View 4: v_invoice_submissions_current
--
-- The corrections-resolving view. invoice_submissions.corrected_from_uuid
-- is a self-FK correction chain: when an invoice is corrected, the new
-- row references the old one. A naive SUM over invoice_submissions
-- double-counts every correction chain.
--
-- This view returns only the LATEST version of each invoice - the row
-- that no OTHER row references as corrected_from_uuid. Any spend tool
-- reading through this view is safe from double-count.
--
-- Also excludes:
--   - rows where status is 'corrected' or 'deleted' (superseded)
--
-- IMPORTANT (Kevin ruling, 2026-07-29): `dupe_override = true` rows are
-- INCLUDED. The flag means an operator hit the dedup unique index,
-- examined the row, and confirmed a look-alike is a genuine separate
-- invoice. Excluding them undercounts spend by real dollars ($431.99
-- across 5 rows at the time of the ruling). An earlier draft of this
-- view excluded them; that draft was corrected before shipping.
--
-- Kept in view but flagged: is_historical rows (batch_rebuild from
-- pre-app history) - the tools decide inclusion per-question because
-- historical totals matter for year-over-year but not for month-in-flight.
--
-- The ai_line_items trap: historical rows carry NULL invoice_uuid with
-- historical_invoice_ref populated; a naive INNER JOIN drops them. The
-- tools handle this at query time by declaring inclusion policy in the
-- SELECT; this view stays at the invoice level.
-- ─────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_invoice_submissions_current;
CREATE VIEW v_invoice_submissions_current AS
WITH superseded AS (
  -- The set of invoice ids that some other row references as its parent.
  -- These are the corrected-away versions and must not appear in the view.
  SELECT DISTINCT corrected_from_uuid AS id
  FROM invoice_submissions
  WHERE corrected_from_uuid IS NOT NULL
)
SELECT
  s.id,
  s.client_uuid,
  s.submitted_at,
  s.submitter_email,
  s.account_key,
  s.vendor_name,
  s.vendor_id,
  s.invoice_number,
  s.invoice_number_normalized,
  s.invoice_date,
  s.total_amount,
  s.gl_breakdown,
  s.drive_urls,
  s.page_count,
  s.email_sent,
  s.status,
  s.status_updated_at,
  s.type,
  s.raw_drive_url,
  s.corrected_from_uuid,
  s.dupe_override,
  s.is_historical,
  s.data_provenance
FROM invoice_submissions s
LEFT JOIN superseded ON superseded.id = s.id
WHERE superseded.id IS NULL
  AND s.status NOT IN ('corrected', 'deleted');

COMMENT ON VIEW v_invoice_submissions_current IS
  'Phase F: current version of each invoice (correction-chain resolved). '
  'One row per real invoice; superseded rows and rows marked corrected/'
  'deleted are excluded. dupe_override rows ARE included (operator-'
  'confirmed look-alikes are real invoices; excluding them undercounts '
  'spend by measured dollars per Kevin ruling 2026-07-29). Naive SUM '
  'over this view will not double-count corrections. is_historical is '
  'preserved as a column so tools can decide per-question inclusion '
  '(batch_rebuild vs live).';

GRANT SELECT ON v_invoice_submissions_current TO service_role;


-- ─────────────────────────────────────────────────────────────────────
-- POST-VERIFY SELECTS (run after CREATE VIEWs above)
-- ─────────────────────────────────────────────────────────────────────

-- Q1: v_current_homestand_by_account - expect 0-few rows depending on
-- who is at home today.
--   SELECT account_key, homestand_id, start_date, end_date,
--          days_elapsed, days_remaining
--   FROM v_current_homestand_by_account
--   ORDER BY account_key;

-- Q2: v_current_period_by_account - expect ~11 rows (every service
-- account with a period today, CORP excluded).
--   SELECT account_key, period, start_date, end_date,
--          days_elapsed, days_remaining, week_label, event_label
--   FROM v_current_period_by_account
--   ORDER BY account_key;
--   -- 2026-07-29 all should show period='8', week_label='Week 3'.

-- Q3: v_current_pdc_phase_by_account - expect up to 5 rows (5 PDC
-- accounts; only those inside a phase window today).
--   SELECT account_key, phase, start_date, end_date,
--          days_elapsed, days_remaining
--   FROM v_current_pdc_phase_by_account
--   ORDER BY account_key;

-- Q4: v_invoice_submissions_current - expect COUNT less than
-- COUNT(invoice_submissions) if any correction chains exist.
--   SELECT
--     (SELECT COUNT(*) FROM invoice_submissions)         AS raw_count,
--     (SELECT COUNT(*) FROM v_invoice_submissions_current) AS current_count,
--     (SELECT COUNT(*) FROM invoice_submissions
--      WHERE corrected_from_uuid IS NOT NULL)            AS correction_chain_count;

-- Q5 (correction proof): pick any invoice with a correction chain and
-- verify only the terminal version appears.
--   SELECT id, corrected_from_uuid, invoice_number, total_amount, status
--   FROM invoice_submissions
--   WHERE corrected_from_uuid IS NOT NULL
--   ORDER BY submitted_at DESC LIMIT 5;
--   -- Then confirm the id of each SUPERSEDED row is NOT in
--   -- v_invoice_submissions_current, and the NEWER row IS present.
