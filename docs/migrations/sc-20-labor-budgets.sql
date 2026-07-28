-- ═══════════════════════════════════════════════════════════════════
-- sc-20-labor-budgets.sql
-- Service Calendar - MLB labor budgets (Module SC, Bundle: MLB M-1)
--
-- Introduces the labor-budget plane. Serves the four MLB accounts and
-- nothing else. Non-MLB accounts have no labor-budget concept in SC.
--
-- DESIGN
-- - `sc_labor_budgets` is the versioned per-account-per-period budget
--   store. Hourly is the chef target; salary and revenue_forecast are
--   reporting-only fields carried alongside so the change trail moves
--   the money crossing between lines atomically (TXR-TX-H's 2026
--   $150k -> $110k change involved ~$40k crossing from hourly to
--   salary; the two lines must edit together to stay coherent).
-- - Supersede-rather-than-update. A change writes a NEW row with a
--   fresh `effective_from` + `reason` + `changed_by` + `changed_at`,
--   and closes the previous row by writing `superseded_at`. Reading
--   the live budget is `WHERE superseded_at IS NULL`; reading history
--   is the whole set for the (account_key, period) tuple ordered by
--   effective_from DESC. Self-audited on the row itself - no paired
--   sc_config_changelog write required. Matches the pattern owner
--   described: "the trail is the data rather than a side table."
-- - One live row per (account_key, period) enforced via a PARTIAL
--   UNIQUE INDEX filtered on `superseded_at IS NULL`. Supersedes stay
--   as history without violating the invariant.
-- - Reason is required on every write - the CHECK is on the column
--   itself, not app-layer, so a bad orchestrator path cannot slip a
--   blank reason in. Same shape as sc_config_changelog + sc_fee_
--   schedule + sc_service_prices.
-- - `accounts.labor_ratio` is a per-account numeric parameter with
--   the same insert-only rule but stored as an accounts-row column
--   (one live value per account). Audit for ratio edits goes through
--   sc_config_changelog with entity_type='labor_ratio' - additive
--   CHECK extension below.
-- - TXR-TX-V is the only 2026 revenue-flex account. Seeded to 0.1923
--   ("designed" per P&L, hourly/revenue rounds to 0.1923 in all seven
--   periods, so `sold_revenue * 0.1923` is the flex envelope). Other
--   MLB accounts get NULL - flag-off; the derivation does not consult
--   ratio unless it is populated.
-- - `hourly_budget` / `salary_budget` / `revenue_forecast` are all
--   NUMERIC(12,2) NULL. NULL renders as "not set" in the admin - the
--   missing-versus-zero rule that already governs every operator
--   surface applies here too (a $0 budget reads as "you may spend
--   nothing," which is a lie; not-set is the honest state).
--
-- ACCOUNT REGEX matches the pattern already in every SC account_key
-- CHECK: '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$' with an override for
-- 'CORP'. Bundled accounts (TXR-TX-V vs TXR-TX-H) are already
-- expressible under the fee_schedule pattern; labor_budgets are
-- per-account independently (TXR-TX-V has its own hourly budget
-- separate from H).
--
-- GRANTS - SELECT + INSERT + UPDATE on service_role. UPDATE is
-- required for the supersede path (setting `superseded_at` on the
-- previous row). No DELETE, no TRUNCATE - history is data.
--
-- HAZARD CHECK (NOT NULL columns without a default):
--   account_key, period, effective_from, reason, changed_by
-- Five load-bearing required fields supplied by every insert. The
-- three budget/revenue columns are intentionally NULLABLE. The
-- documents.status class of bug is named and cleared.
--
-- Apply in Supabase Studio. Verify via
--   node --env-file=.env.local scripts/_probe_labor_budget_acceptance.mjs
-- (probe reports live rows, self-consistency of season totals, and
-- ratio-consumer round-trips).
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 1. sc_labor_budgets ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_labor_budgets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key       TEXT NOT NULL CHECK (
                      account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    ),
  period            TEXT NOT NULL CHECK (period ~ '^P([1-9]|1[0-3])$'),
  hourly_budget     NUMERIC(12,2),
  salary_budget     NUMERIC(12,2),
  revenue_forecast  NUMERIC(12,2),
  effective_from    DATE NOT NULL,
  superseded_at     TIMESTAMPTZ,       -- NULL = live, non-NULL = closed
  reason            TEXT NOT NULL CHECK (
                      length(trim(reason)) > 0 AND length(reason) <= 280
                    ),
  requested_by      TEXT,
  changed_by        TEXT NOT NULL,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live row per (account_key, period). Superseded rows carry
-- `superseded_at` non-NULL so they drop out of the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_labor_budgets_live
  ON sc_labor_budgets (account_key, period)
  WHERE superseded_at IS NULL;

-- History reads: latest row for one (account, period) tuple across
-- effective_from + changed_at (later changed_at wins on same date).
CREATE INDEX IF NOT EXISTS idx_sc_labor_budgets_history
  ON sc_labor_budgets (account_key, period, effective_from DESC, changed_at DESC);

ALTER TABLE sc_labor_budgets DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON sc_labor_budgets TO service_role;
GRANT REFERENCES, TRIGGER ON sc_labor_budgets TO anon, authenticated;

COMMENT ON TABLE sc_labor_budgets IS
  'MLB labor budget plane. Supersede-rather-than-update: a change '
  'writes a new row with fresh effective_from + reason + changed_by, '
  'and closes the previous row by setting superseded_at. Self-audited '
  'on the row itself. One live row per (account_key, period) via '
  'partial UNIQUE INDEX. Serves the 4 MLB accounts (CIN-OH, STL-MO, '
  'TXR-TX-H, TXR-TX-V); non-MLB accounts have no rows here by design.';

-- ─── 2. accounts.labor_ratio ────────────────────────────────────────
-- Per-account revenue-flex ratio. NULL = not a revenue-flex account
-- (99% of accounts). NUMERIC(6,4) fits 0.0001..9.9999 - covers every
-- realistic labor/revenue ratio and leaves headroom without allowing
-- absurd values.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS labor_ratio NUMERIC(6,4)
    CHECK (labor_ratio IS NULL OR (labor_ratio > 0 AND labor_ratio < 1));

COMMENT ON COLUMN accounts.labor_ratio IS
  'Revenue-flex labor ratio (labor budget / sold revenue). Populated '
  'for revenue-flex accounts only (TXR-TX-V = 0.1923 in 2026). NULL '
  'for the other 3 MLB accounts. Consumed by the M-1 derivation to '
  'compute an adjusted homestand envelope when the operator submits '
  'a sold-revenue figure. Change audit lives in sc_config_changelog '
  'with entity_type=''labor_ratio''.';

-- ─── 3. sc_config_changelog entity_type extension ───────────────────
-- Ratio audit hangs off the existing changelog with a new entity_type.
-- The CHECK constraint needs to be DROP + ADD; there is no ALTER
-- CHECK IN Postgres.
--
-- CORRECTION (post-apply, fix/sc-20-do-block, 2026-08-14):
-- The predicate here originally matched on
--   pg_get_constraintdef(c.oid) LIKE '%entity_type%IN%'
-- to skip the DDL when the constraint had already been extended.
-- That predicate NEVER MATCHES a real Postgres CHECK: the planner
-- normalises `IN (a, b, c)` to `= ANY (ARRAY[a, b, c])` on storage,
-- so the literal token `IN` is not present in the definition text.
-- The block silently no-op'd, the constraint stayed at the sc-4
-- shape, and a fresh environment applying the merged file would
-- reject the first `labor_ratio` audit write at write time - with
-- no trail back to this migration.
--
-- Owner applied the corrected DDL by hand in Studio; on this
-- environment the constraint is live and includes labor_ratio.
-- File corrected here so a fresh apply lands the same shape without
-- the silent no-op. Detects by CONSTRAINT NAME (sc-4's known label)
-- with the idempotency guard retained via a NOT LIKE '%labor_ratio%'
-- check on the same definition string. No re-apply needed here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'sc_config_changelog'
      AND c.conname = 'sc_config_changelog_entity_type_check'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%labor_ratio%'
  ) THEN
    -- Drop and recreate with the extended enum.
    ALTER TABLE sc_config_changelog DROP CONSTRAINT sc_config_changelog_entity_type_check;
    ALTER TABLE sc_config_changelog ADD CONSTRAINT sc_config_changelog_entity_type_check
      CHECK (entity_type IN ('price', 'service', 'group', 'fee', 'fun_money', 'labor_ratio'));
  END IF;
END $$;
