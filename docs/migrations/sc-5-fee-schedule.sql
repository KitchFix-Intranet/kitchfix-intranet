-- ═══════════════════════════════════════════════════════════════════
-- sc-5-fee-schedule.sql
-- Service Calendar - fee schedule (Module SC, Bundle 5)
-- Bundle 1 Stage 2: the first contract-revenue-layer piece.
--
-- The contract-revenue layer holds flat fees (and later: service fees,
-- postseason). Lives in the admin; will feed the future KPI dashboard.
-- The Service Calendar does NOT consume this table.
--
-- DESIGN
-- - Mirrors sc_service_prices' EFFECTIVE-DATED pattern with a stronger
--   tamper-evident shape: a fee change is a new dated row, never an
--   overwrite. The current value for any (account_key, as-of-date) is
--   the latest row by (effective_date DESC, created_at DESC).
-- - NO UNIQUE on (account_key, effective_date). Same-date corrections
--   are a real case (operator types $362,500 instead of $326,500 and
--   wants to fix it on the same day). UNIQUE + insert-only grants
--   would force the correction to a wrong effective_date, which makes
--   the ledger lie about when a fee applied. Without UNIQUE, the
--   correction is a NEW row with the SAME effective_date and a later
--   created_at; the LATERAL read picks it; the original row stays as
--   history; nothing is rewritten.
-- - Audit lives in sc_config_changelog (entity_type='fee', already
--   in its CHECK). The orchestrator writes a changelog row atomic
--   with the fee insert; schema does not enforce that (app-level
--   invariant). Each fee insert is also self-audited via reason +
--   requested_by + changed_by + created_at, which means the fee
--   table alone is forensically readable even without joining the
--   changelog.
-- - Bundled accounts (TXR-TX-V = covered by TXR-TX-H) carry a
--   covered_by_account_key marker AND amount = 0. Schema-level CHECK
--   (chk_bundled_zero_amount) prevents the misconfiguration where
--   covered_by is set AND amount > 0 - that would double-count
--   revenue at the KPI dashboard layer.
-- - Service-portion only. Passthrough (CIN-OH/STL-MO/STL-FL food
--   budgets) is excluded - it's net-zero margin, not revenue. The
--   contract bible has the locked values; the seed in Stage 2B uses
--   them exactly.
--
-- GRANTS - insert-only on service_role (SELECT + INSERT, no UPDATE,
-- no DELETE, no TRUNCATE). A fee change = new dated row. No in-place
-- rewrite of the contract-revenue ledger, even by a code bug or a
-- compromised service-role key. Same audit-tightness as
-- sc_config_changelog (sc-4).
--
-- HAZARD CHECK (NOT NULL columns with no default):
--   account_key, amount, effective_date, reason, changed_by
-- All five are load-bearing required fields supplied by every insert
-- through the admin path (orchestrator + route both validate). The
-- documents.status NOT-NULL-no-default class of bug is named and
-- cleared. period_type has DEFAULT 'annual'; created_at has DEFAULT
-- now(). No silent-data-loss path.
--
-- Apply in Supabase Studio. Verify via
--   scripts/_probe_sc5_fee_schedule_verify.mjs
-- before any Stage 2B code that reads/writes the table merges.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sc_fee_schedule (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key            TEXT NOT NULL CHECK (
                           account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                           OR account_key = 'CORP'
                         ),
  amount                 NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  effective_date         DATE NOT NULL,
  period_type            TEXT NOT NULL DEFAULT 'annual' CHECK (
                           period_type IN ('annual')
                         ),
  -- Informational - the operator's mental model for how the annual
  -- amount gets paid out. The future KPI dashboard can use this for
  -- "next installment due X" UX. Schema does not drive any compute
  -- from this field.
  payment_cadence        TEXT CHECK (
                           payment_cadence IS NULL
                           OR payment_cadence IN ('monthly-6', 'monthly-7', 'quarterly', 'annual')
                         ),
  -- Bundled-account marker. TXR-TX-V is the canonical case: its row
  -- has amount=0 and covered_by_account_key='TXR - TX - H'. The
  -- future KPI dashboard sums amount across accounts; bundled rows
  -- contribute $0 by data, with the covered_by field providing the
  -- human-readable reason. No FK to accounts(team_key) on purpose:
  -- if an account is later archived/renamed, the history row should
  -- remain readable (same principle as sc_daily_actuals_history's
  -- non-FK actual_id in sc-1:272).
  covered_by_account_key TEXT CHECK (
                           covered_by_account_key IS NULL
                           OR covered_by_account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                         ),
  -- Bundle invariant: if covered_by_account_key is set, amount MUST
  -- be 0. Prevents the "amount > 0 AND covered_by set" misconfiguration
  -- that would double-count revenue at the KPI dashboard layer.
  CONSTRAINT chk_bundled_zero_amount CHECK (
    covered_by_account_key IS NULL OR amount = 0
  ),

  reason                 TEXT NOT NULL CHECK (
                           length(trim(reason)) > 0 AND length(reason) <= 280
                         ),
  requested_by           TEXT,
  changed_by             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LATERAL-style lookup index. Supports:
--   SELECT * WHERE account_key = $1 AND effective_date <= $2
--   ORDER BY effective_date DESC, created_at DESC LIMIT 1
-- (as-of-date current fee for one account)
-- AND per-account history reads.
-- The created_at DESC tiebreak is what makes same-day corrections
-- work without UNIQUE: a corrected row inserted later on the same
-- effective_date wins the LATERAL pick.
CREATE INDEX IF NOT EXISTS idx_sc_fee_schedule_lookup
  ON sc_fee_schedule (account_key, effective_date DESC, created_at DESC);

-- Bundled-account lookup (future KPI dashboard "show me everything
-- bundled into X"). Partial index on the non-null subset keeps it
-- tight (most rows are NULL here).
CREATE INDEX IF NOT EXISTS idx_sc_fee_schedule_covered_by
  ON sc_fee_schedule (covered_by_account_key)
  WHERE covered_by_account_key IS NOT NULL;

COMMENT ON TABLE sc_fee_schedule IS
  'Contract-revenue fee schedule. Effective-dated: a fee change is a '
  'new dated row, never an overwrite. Reads via LATERAL pick of latest '
  '(effective_date, created_at) <= as-of-date per account. NO UNIQUE '
  'on (account_key, effective_date) - same-day corrections insert a '
  'new row with the SAME effective_date and a later created_at; the '
  'tiebreak picks the corrected row; the original stays as history. '
  'Audited via sc_config_changelog (entity_type=''fee'') - orchestrator '
  'writes both atomically. Service-portion only; passthrough excluded. '
  'Bundled accounts carry amount=0 + covered_by_account_key '
  '(TXR-TX-V case). GRANTed SELECT + INSERT only on service_role - '
  'no in-place UPDATE or DELETE, ever.';

ALTER TABLE sc_fee_schedule DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- GRANTs - insert-only. A fee change = new dated row, never an UPDATE.
-- Same audit-integrity reasoning as sc-4: no in-place rewrite of the
-- contract-revenue ledger, even by a compromised service-role key or
-- a code bug. Same-day corrections are handled by INSERT (no UNIQUE
-- to block them).
-- ═══════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT ON sc_fee_schedule TO service_role;

-- anon/authenticated get REFERENCES + TRIGGER only (no TRUNCATE).
-- Matches sc-4's pattern.
GRANT REFERENCES, TRIGGER ON sc_fee_schedule TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- DONE
-- Verify with scripts/_probe_sc5_fee_schedule_verify.mjs.
-- ═══════════════════════════════════════════════════════════════════
