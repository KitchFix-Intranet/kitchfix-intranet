-- cost-allocations-1.sql
--
-- Kevin R-72 (2026-09-04): corporate cost allocations - real costs
-- finance posts straight to the P&L that never appear in bill.com
-- invoices or Rippling card charges. Vehicle insurance (3500.2) and
-- Vehicle Repair & Maintenance (3500.5) are the two Kevin identified
-- for FY26; the shape generalises to any allocated cost.
--
-- Kevin maintains this table at period close, same maintenance moment
-- as inventory_adjustments. Empty by default. Never derived from a
-- budget - the amount is what finance ACTUALLY posted, not what was
-- planned.
--
-- ═══════════════════════════════════════════════════════════════
-- WHY A SIBLING TABLE, NOT A `kind` ON inventory_adjustments
-- ═══════════════════════════════════════════════════════════════
--
-- Both tables carry Kevin-uploaded numbers finance posts, and both
-- apply only on closed periods (same rule). Two reasons to keep
-- them separate:
--
-- 1. Semantics differ. Inventory JEs are usage-vs-purchase
--    reconciliations - a signed correction to purchases already in
--    purchasing_actuals. Allocations are additive costs that never
--    existed in any operational feed. Sharing a table blurs that.
--
-- 2. Primary key shape differs. inventory_adjustments PK is
--    (account, fy, period_no, category) with category IN
--    ('food', 'packaging', 'supplies'). Allocations need
--    gl_line_code as the discriminator (3500.2 vs 3500.5 - both are
--    "vehicle" bucket). Retro-fitting inventory_adjustments would
--    force the category column to hold arbitrary GL codes, which
--    breaks the existing CHECK constraint and the loader that
--    parses Sebastian's XLSX category names.
--
-- Trade-off: two tables to maintain instead of one. Loader script
-- shape can share once we have one; today the inventory loader
-- (scripts/load_inventory_adjustments.mjs) is bespoke to Sebastian's
-- XLSX format and shouldn't be forced onto allocations.
--
-- ═══════════════════════════════════════════════════════════════
-- COLUMNS
-- ═══════════════════════════════════════════════════════════════
--
--   account_key    Site key (e.g. "TBJ - FL", "CIN - KY")
--   fiscal_year    FY the allocation belongs to (2026 for FY26)
--   period_no      1..13 fiscal period
--   gl_line_code   Sub-line the allocation posts against (e.g.
--                  "3500.2" for Vehicle Insurance). Kept as the
--                  discriminator so the same account+period can
--                  carry multiple allocations on different GL codes.
--   amount         Dollar amount finance posted. Positive.
--   source_ref     Free text: "finance P8 allocation vehicle
--                  insurance", ticket ref, upload filename, etc.
--   loaded_at      Audit timestamp.
--
-- PRIMARY KEY (account_key, fiscal_year, period_no, gl_line_code)
--   Idempotent upsert. Re-uploading a period replaces the amount
--   with no duplicates.
--
-- OPEN-PERIOD RULE (enforced in resolver + probe)
--
--   Allocations only apply on CLOSED periods (calendar-closed or
--   verified). Open periods must return zero contribution. Same
--   rule inventory_adjustments follows. Enforced in
--   src/lib/kpi/overview/resolver.js finalisedPeriods loop and
--   asserted by scripts/probes/_probe_r72_allocations.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS cost_allocations (
  account_key   TEXT           NOT NULL,
  fiscal_year   INTEGER        NOT NULL,
  period_no     INTEGER        NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  gl_line_code  TEXT           NOT NULL,
  amount        NUMERIC(14, 2) NOT NULL,
  source_ref    TEXT           NOT NULL,
  loaded_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_key, fiscal_year, period_no, gl_line_code)
);

CREATE INDEX IF NOT EXISTS cost_allocations_by_range
  ON cost_allocations (fiscal_year, period_no, account_key);

CREATE INDEX IF NOT EXISTS cost_allocations_by_line
  ON cost_allocations (fiscal_year, account_key, gl_line_code);

GRANT SELECT, INSERT, UPDATE, DELETE ON cost_allocations TO service_role;

COMMIT;
