-- labor-te-1: windowed variant of swap_labor_actuals_for_account.
--
-- Owner directive 2026-10-16. The live swap_labor_actuals_for_account
-- RPC deletes every source='api' row for an account before inserting
-- the payload - safe for a full-corpus derive, destructive for a
-- windowed derive (the time-entries cutover writes 2026-10-05 onward
-- and a windowed call to the unwindowed RPC would silently destroy
-- 2026-04-20 .. 2026-10-04, the entire frozen pay-segments era).
--
-- This file ships a NEW function alongside the live one. The live
-- function is UNCHANGED and still serves the pre-floor era and any
-- caller that writes a full-corpus payload. The windowed function
-- requires a lower bound (p_week_from) and refuses to touch rows
-- before it. Two guards on purpose: the DELETE is bounded, and the
-- INSERT also refuses any payload row before the floor. A payload
-- bug cannot reach protected weeks.
--
-- Era ownership after labor-te-1 ships:
--   week_start < '2026-04-20'          report backfill   frozen
--   '2026-04-20' .. '2026-10-04'       pay-segments      frozen (source dead)
--   week_start >= '2026-10-05'         time-entries      live, nightly
--
-- The three eras must not overlap. The new derive runs with
--   swap_labor_actuals_for_account_window(acct, payload, run, '2026-10-05')
-- and the frozen pay-segments era (2026-04-20 .. 2026-10-04) is
-- untouched by both guards.

CREATE OR REPLACE FUNCTION swap_labor_actuals_for_account_window(
  p_account_key   TEXT,
  p_actuals       JSONB,
  p_source_run    TEXT,
  p_week_from     DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
  DECLARE
    a_count INTEGER;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE team_key = p_account_key) THEN
      RAISE EXCEPTION 'swap_labor_actuals_for_account_window: account_key % not in accounts table', p_account_key;
    END IF;

    IF p_week_from IS NULL THEN
      RAISE EXCEPTION 'swap_labor_actuals_for_account_window: p_week_from is required';
    END IF;

    -- Bounded delete. Weeks before p_week_from are never touched.
    DELETE FROM labor_actuals
     WHERE account_key = p_account_key
       AND source = 'api'
       AND week_start >= p_week_from;

    INSERT INTO labor_actuals (
      account_key, worker_id, week_label, line_code,
      hours_regular, hours_overtime, hours_double_time, hours_premium_other,
      dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other,
      amount, hours_without_dollars,
      week_start, week_end, fiscal_year, period_no, week_source,
      segment_count, entry_count, coverage_state,
      draft_entry_count, draft_hours,
      anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h,
      approved_hours, oldest_draft_date, still_costing_hours,
      derived_at, source_run, source
    )
    SELECT
      p_account_key,
      (r->>'worker_id')::TEXT,
      (r->>'week_label')::TEXT,
      (r->>'line_code')::TEXT,
      COALESCE((r->>'hours_regular')::NUMERIC, 0),
      COALESCE((r->>'hours_overtime')::NUMERIC, 0),
      COALESCE((r->>'hours_double_time')::NUMERIC, 0),
      COALESCE((r->>'hours_premium_other')::NUMERIC, 0),
      COALESCE((r->>'dollars_regular')::NUMERIC, 0),
      COALESCE((r->>'dollars_overtime')::NUMERIC, 0),
      COALESCE((r->>'dollars_double_time')::NUMERIC, 0),
      COALESCE((r->>'dollars_premium_other')::NUMERIC, 0),
      COALESCE((r->>'amount')::NUMERIC, 0),
      COALESCE((r->>'hours_without_dollars')::NUMERIC, 0),
      (r->>'week_start')::DATE,
      (r->>'week_end')::DATE,
      NULLIF((r->>'fiscal_year'), '')::INTEGER,
      NULLIF((r->>'period_no'), '')::INTEGER,
      (r->>'week_source')::TEXT,
      COALESCE((r->>'segment_count')::INTEGER, 0),
      COALESCE((r->>'entry_count')::INTEGER, 0),
      (r->>'coverage_state')::TEXT,
      NULLIF((r->>'draft_entry_count'),   '')::INTEGER,
      NULLIF((r->>'draft_hours'),         '')::NUMERIC,
      NULLIF((r->>'anomaly_no_clockout'), '')::INTEGER,
      NULLIF((r->>'anomaly_under_1h'),    '')::INTEGER,
      NULLIF((r->>'anomaly_over_16h'),    '')::INTEGER,
      NULLIF((r->>'approved_hours'),      '')::NUMERIC,
      NULLIF((r->>'oldest_draft_date'),   '')::DATE,
      NULLIF((r->>'still_costing_hours'), '')::NUMERIC,
      NOW(),
      p_source_run,
      'api'
    FROM jsonb_array_elements(p_actuals) r
    WHERE (r->>'week_start')::DATE >= p_week_from;   -- belt and braces

    GET DIAGNOSTICS a_count = ROW_COUNT;
    RETURN a_count;
  END
$$;
