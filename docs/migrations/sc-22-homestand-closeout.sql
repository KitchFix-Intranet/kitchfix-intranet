-- ═══════════════════════════════════════════════════════════════════
-- sc-22-homestand-closeout.sql
-- Service Calendar - M-3 close-out plane.
--
-- WHY
-- An MLB homestand ends. The chef needs to tell the system two things:
-- that the block ran, and what labor it actually cost. This migration
-- introduces the table + RPC that lets them.
--
-- Supersede-rather-than-update (same pattern sc_labor_budgets uses):
-- reopen closes the prior live row via superseded_at + reopened_by +
-- reopen_reason, and INSERTs a new live row. Owner ruling H6
-- (transparency): the prior figure, its provenance, and its
-- budget_snapshot stay preserved so the surface can show the prior
-- figure alongside the new one until the new close-out is confirmed.
--
-- Partial UNIQUE index enforces ONE live row per (account_key,
-- homestand_key) - matches sc_labor_budgets's live-row discipline
-- from sc-20.
--
-- ATOMICITY VIA RPC
-- Confirming a close-out writes to THREE tables in one operation:
-- supersede any prior live row on sc_homestand_closeout, insert the
-- new live row, and upsert all sc_daily_actuals rows for the block.
-- supabase-js cannot batch across tables. Three sequential calls
-- would leave a closed-out row with no actuals on partial failure -
-- exactly the partial-write class the standing atomicity rule
-- exists to prevent.
--
-- The plpgsql function sc_confirm_closeout wraps the three writes
-- in one implicit transaction. Any exception aborts the whole
-- write; last-good state is preserved by construction.
--
-- **The function is a transaction wrapper and nothing else.** Owner
-- ruling 2026-07-29: no business logic in plpgsql. Which days are
-- exceptions, what count each service gets, and whether a
-- projection is missing are all decided in the route and passed
-- in. The route is the only caller. See the sc-submit-closeout
-- action in src/app/api/service-calendar/route.js for the caller.
--
-- WHAT THIS FILE DOES (order matters)
-- 1. CREATE TABLE sc_homestand_closeout.
-- 2. CREATE INDEX (partial UNIQUE on live rows + history-read index).
-- 3. CREATE FUNCTION sc_confirm_closeout - atomic wrapper.
-- 4. RLS off + GRANTs (service_role SELECT + INSERT + UPDATE +
--    EXECUTE).
-- 5. COMMENTs on the table + load-bearing columns + function.
--
-- POST-APPLY VERIFY
--   SELECT count(*) FROM sc_homestand_closeout;    -- 0 (fresh)
--   \df sc_confirm_closeout                        -- function exists
--   node --env-file=.env.local scripts/_probe_m3_atomicity.mjs
--   node --env-file=.env.local scripts/_probe_m3_no_projection.mjs
--
-- Apply in Supabase Studio.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_homestand_closeout (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (per scope B6). CHECK matches team-key form.
  -- 'CORP' deliberately omitted vs the sc_daily_actuals CHECK
  -- (owner ruling 2026-07-29): a homestand close-out for CORP is
  -- not a real thing; carrying a dead condition invites the next
  -- reader to assume it's meaningful.
  account_key              TEXT NOT NULL CHECK (
                             account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                           ),
  homestand_key            TEXT NOT NULL,   -- game_pk OR startDate;
                                            -- stable per M-0 derivation

  -- Confirmation moment (H6 provenance).
  service_confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by             TEXT NOT NULL,

  -- Labor actual + provenance (M9).
  -- NOT NULL is deliberate (owner ruling 2026-07-29): a block sits
  -- in `actuals-due` until the number exists. That is exactly the
  -- state the enum was designed to express. Timesheets lag; that is
  -- fine. No "confirm service now, labor later" path.
  labor_actual             NUMERIC(12,2) NOT NULL CHECK (labor_actual >= 0),
  labor_source             TEXT NOT NULL CHECK (
                             labor_source IN ('manual', 'rippling_import')
                           ),

  -- Attribution window (scope B5). Snapshot at close-out - preserved
  -- across reopens so a variance calc after a budget edit can still
  -- name the window the chef was scheduling against.
  window_start             DATE NOT NULL,
  window_end               DATE NOT NULL,
  CHECK (window_start <= window_end),

  -- Budget snapshot (scope B6). Frozen at close-out - a later
  -- sc_labor_budgets edit must NEVER rewrite a closed homestand's
  -- variance. This is the entire reason the column exists.
  --
  -- NULL is intentional: it captures the missing-vs-null case
  -- honestly - when deriveLaborBudgets returned {envelope: null,
  -- reason: "..."} at close-out, the snapshot carries null and the
  -- surface displays the reason instead of a made-up figure.
  budget_snapshot          NUMERIC(12,2),

  notes                    TEXT,

  -- Supersede + reopen (H6 / M25 transparency).
  --
  -- superseded_at IS NULL      -> live row
  -- superseded_at IS NOT NULL  -> closed by a later confirm; the row
  --                              carries reopened_by + reopen_reason
  --
  -- reopen_reason is required at supersede time (enforced in the
  -- RPC below). CHECK here permits NULL for the always-alive
  -- original row and enforces length otherwise.
  superseded_at            TIMESTAMPTZ,
  reopened_by              TEXT,
  reopen_reason            TEXT CHECK (
                             reopen_reason IS NULL
                             OR (length(trim(reopen_reason)) > 0
                                 AND length(reopen_reason) <= 280)
                           ),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. INDEXES ─────────────────────────────────────────────────────
-- Partial UNIQUE: one live row per (account, homestand). Matches the
-- sc_labor_budgets live-row discipline the M-1 build established.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_homestand_closeout_live
  ON sc_homestand_closeout (account_key, homestand_key)
  WHERE superseded_at IS NULL;

-- History read: newest-first by confirmation moment, keyed on
-- (account, homestand) for the reopen surface's prior-figure lookup.
CREATE INDEX IF NOT EXISTS idx_sc_homestand_closeout_history
  ON sc_homestand_closeout (account_key, homestand_key, service_confirmed_at DESC);

-- ─── 3. RPC ─────────────────────────────────────────────────────────
-- sc_confirm_closeout: atomic wrapper. No business logic. Callable
-- only from the route (src/app/api/service-calendar/route.js
-- sc-submit-closeout action).
--
-- The route:
--   - decides which days are exceptions (span-only, game days only
--     per owner ruling Q7B),
--   - fetches sc_daily_projections for every non-exception game day,
--   - refuses the whole confirm when any (game_date, service_id) has
--     no projection (missing-vs-zero rule; no lie is permitted),
--   - assembles p_actuals as a JSONB array of
--     [{ service_id, service_date, actual_count }, ...] where
--     actual_count = 0 for exception days and = projected_count for
--     non-exception days,
--   - snapshots the current envelope from deriveLaborBudgets as
--     p_budget_snapshot (NUMERIC or NULL),
--   - calls this RPC.
--
-- On first close (no prior live row), p_reopen_reason must be NULL.
-- On reopen-then-reconfirm (prior live row exists), p_reopen_reason
-- must be non-empty; the guardrail below RAISEs otherwise.
--
-- Client double-fire: a second confirm without the client-side
-- in-flight guard would find its own live row it just created and
-- hit the RAISE below (no reopen_reason). Loud failure, no
-- corruption. The route also responds 400 rather than 500.
CREATE OR REPLACE FUNCTION sc_confirm_closeout(
  p_account_key      TEXT,
  p_homestand_key    TEXT,
  p_labor_actual     NUMERIC,
  p_labor_source     TEXT,
  p_window_start     DATE,
  p_window_end       DATE,
  p_budget_snapshot  NUMERIC,
  p_notes            TEXT,
  p_confirmed_by     TEXT,
  p_actuals          JSONB,
  p_reopen_reason    TEXT
) RETURNS TABLE (
  closeout_id      UUID,
  superseded_count INTEGER,
  actuals_written  INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_superseded  INTEGER := 0;
  v_written     INTEGER := 0;
  v_new_id      UUID;
  v_has_live    BOOLEAN;
BEGIN
  -- Guardrail: reopen_reason is required whenever a live row exists.
  SELECT EXISTS (
    SELECT 1 FROM sc_homestand_closeout
     WHERE account_key   = p_account_key
       AND homestand_key = p_homestand_key
       AND superseded_at IS NULL
  ) INTO v_has_live;

  IF v_has_live AND (p_reopen_reason IS NULL OR length(trim(p_reopen_reason)) = 0) THEN
    RAISE EXCEPTION 'reopen_reason is required when superseding a live closeout';
  END IF;

  -- 1. Supersede any prior live row for this (account, homestand).
  UPDATE sc_homestand_closeout
     SET superseded_at = now(),
         reopened_by   = p_confirmed_by,
         reopen_reason = p_reopen_reason
   WHERE account_key   = p_account_key
     AND homestand_key = p_homestand_key
     AND superseded_at IS NULL;
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  -- 2. Insert the new live row.
  INSERT INTO sc_homestand_closeout (
    account_key, homestand_key,
    service_confirmed_at, confirmed_by,
    labor_actual, labor_source,
    window_start, window_end,
    budget_snapshot, notes
  ) VALUES (
    p_account_key, p_homestand_key,
    now(), p_confirmed_by,
    p_labor_actual, p_labor_source,
    p_window_start, p_window_end,
    p_budget_snapshot, p_notes
  )
  RETURNING id INTO v_new_id;

  -- 3. Upsert all actuals rows. jsonb_to_recordset expands the JSON
  -- array into a rowset the INSERT can read from directly.
  --
  -- p_actuals CAN be empty (schema permits it) but the route should
  -- never produce an empty array - a whole-homestand cancellation
  -- writes zeros for every service on every day, not nothing. If
  -- the route sends empty, the closeout row still lands and the
  -- caller learns v_written=0 in the return.
  WITH src AS (
    SELECT service_id, service_date, actual_count
      FROM jsonb_to_recordset(p_actuals) AS x(
        service_id   UUID,
        service_date DATE,
        actual_count INTEGER
      )
  )
  INSERT INTO sc_daily_actuals (
    account_key, service_id, service_date, actual_count,
    created_by, updated_by, updated_at
  )
  SELECT p_account_key, service_id, service_date, actual_count,
         p_confirmed_by, p_confirmed_by, now()
    FROM src
  ON CONFLICT (account_key, service_id, service_date)
  DO UPDATE SET
        actual_count = EXCLUDED.actual_count,
        updated_by   = EXCLUDED.updated_by,
        updated_at   = EXCLUDED.updated_at;
  GET DIAGNOSTICS v_written = ROW_COUNT;

  RETURN QUERY SELECT v_new_id, v_superseded, v_written;
END;
$$;

-- ─── 4. RLS + GRANTs ────────────────────────────────────────────────
ALTER TABLE sc_homestand_closeout DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON sc_homestand_closeout TO service_role;
GRANT REFERENCES, TRIGGER ON sc_homestand_closeout TO anon, authenticated;

GRANT EXECUTE ON FUNCTION sc_confirm_closeout(
  TEXT, TEXT, NUMERIC, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, JSONB, TEXT
) TO service_role;

-- ─── 5. COMMENTs ────────────────────────────────────────────────────
COMMENT ON TABLE sc_homestand_closeout IS
  'Per-account, per-homestand close-out ledger. One live row per '
  '(account_key, homestand_key) enforced by uq_sc_homestand_closeout_live '
  '(partial UNIQUE WHERE superseded_at IS NULL). Reopen supersedes the '
  'live row via reopened_by + reopen_reason and inserts a new one - the '
  'trail is the data, not a side table.';

COMMENT ON COLUMN sc_homestand_closeout.homestand_key IS
  'Stable identifier per M-0 derivation: first game''s game_pk, or '
  'its startDate when game_pk is absent. NEVER an "HS7" ordinal.';

COMMENT ON COLUMN sc_homestand_closeout.budget_snapshot IS
  'Frozen at close-out. A later sc_labor_budgets edit must NEVER '
  'rewrite this. NULL means the derivation returned null-with-reason '
  '(missing budget row) at close-out; the surface displays the reason.';

COMMENT ON FUNCTION sc_confirm_closeout IS
  'Atomic close-out wrapper: supersede any prior live row + insert '
  'the new one + upsert all actuals rows, all in one implicit '
  'plpgsql transaction. NO BUSINESS LOGIC - the route is the only '
  'caller and decides which days are exceptions, what count each '
  'service gets, and whether a projection is missing. Reason '
  'required on reopen. Returns closeout_id + superseded_count + '
  'actuals_written.';
