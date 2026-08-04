-- ═══════════════════════════════════════════════════════════════════
-- kpi-1-spine.sql
-- KPI Engine - Bundle 1: canonical account spine + chart of accounts
-- 2026-08-03
-- ═══════════════════════════════════════════════════════════════════
--
-- APPLIED 2026-08-04 in Supabase Studio. Pre-flight and post-flight
-- passed clean.
--
-- The account_key regex CHECK on kpi_line_activation is what actually
-- shipped. A foreign key to accounts(team_key) is the better constraint
-- and is applied separately by kpi-1b-activation-fk.sql. Do NOT edit
-- this CREATE TABLE to add it - the IF NOT EXISTS guard makes any
-- change here invisible on re-run, and the file would then describe
-- a database that does not exist. See docs/GOTCHAS.md "applied
-- migration is history, not a wish".
--
-- Governing docs: docs/KPI_DASHBOARD_PLAYBOOK.md, docs/KPI_ENGINE_ARCHITECTURE.md v1.1.
--
-- What this migration adds:
--   1. accounts.pnl_tab_name TEXT UNIQUE, seeded for 11 client accounts
--      (CORP intentionally NULL - out of KPI scope per playbook D17).
--   2. gl_codes account_key rename: 'TBJ - BUF' -> 'TBJ - NY'. Removes
--      the one cross-system join breakage where gl_codes uses the city
--      code while every other PG table uses the state code.
--   3. kpi_lines - canonical chart of accounts, 34 rows extracted from
--      the 2026 P&L workbooks. group_code is the rollup a sous chef
--      sees; it is load-bearing for the salary-visibility rule at
--      playbook §8.2 (a Total 3100 minus 3100.1 leak reveals 3100.2 by
--      subtraction). visibility_tier = 'site_leader' on 3100.2 only.
--   4. kpi_line_activation - 374 rows for FY2026 (11 client accounts x
--      34 lines). 350 active, 24 inactive. Applicability rule per
--      Kevin's Ruling 1 (2026-08-03): a line is applicable if the row
--      exists on the account's P&L tab, regardless of budget value.
--      Present-and-$0 with real spend renders as 'unbudgeted' at the
--      resolver, not n/a. Five lines have inactivations (see below).
--
-- The 24 inactivations (verified against workbook activation matrix
-- plus Kevin's D26 ruling on single-employee accounts):
--   - 3500.1 Delivery Mileage Reimbursement: absent on 10 accounts
--     (row exists ONLY on TBR-FL).
--   - 3500.2 Vehicle Insurance: absent on TBR-FL (row exists on the
--     other 10).
--   - 5012.3 General Utilities: absent on CIN-AZ and TXR-TX-H
--     (present on the other 9).
--   - 5012.5 Computer Hardware: absent on 9 accounts (row exists
--     ONLY on CIN-AZ and TXR-TX-H).
--   - 3100.1 Hourly Kitchen Labor Wages: not applicable on CIN-KY
--     and TBJ-NY. Both are single-employee salaried accounts with no
--     hourly staff (playbook D26). Rendering $0 there would read as
--     "spent nothing on hourly," not "has no hourly line."
--   Total: 10 + 1 + 2 + 9 + 2 = 24.
--
-- Activation is fiscal-year keyed on purpose. If either account hires
-- an hourly associate, that is one row for FY2027, not a deploy.
--
-- Pre-flight assertions (sc-8b lesson):
--   The migration opens by SELECTing the exact rows it intends to
--   change and refuses to run if they do not match expected values.
--   sc-8b assumed sc_service_prices held sticker prices; between the
--   doc being written and the migration running, an out-of-band
--   correction had moved them, and the migration silently
--   double-discounted. Every migration on this project asserts
--   before mutating.
--
-- Idempotency:
--   - CREATE TABLE IF NOT EXISTS on both new tables.
--   - ADD COLUMN IF NOT EXISTS on the accounts.pnl_tab_name column.
--   - UNIQUE constraint added via a pg_constraint IF-NOT-EXISTS guard.
--   - kpi_lines seed uses ON CONFLICT (line_code) DO UPDATE - safe to
--     re-run against a table already seeded.
--   - kpi_line_activation seed uses ON CONFLICT (account_key, line_code,
--     fiscal_year) DO UPDATE - safe to re-run.
--   - accounts.pnl_tab_name seeded via UPDATE .. WHERE team_key = ..;
--     stable and re-runnable. Pre-flight aborts if a populated value
--     drifts from the expected mapping (protects against manual edits).
--   - The gl_codes rename is a WHERE-clause UPDATE that touches zero
--     rows on re-run (TBJ - BUF is empty after first apply).
--   Second pass runs cleanly against a database that already has
--   kpi-1. Pre-flight tolerates both first-run and re-run states.
--
-- What this migration does NOT touch:
--   sc_day_metadata, sc_service_prices, sc_fee_schedule,
--   sc_labor_budgets, any view, any Service Calendar surface,
--   src/lib/export/scWorkbook.js.
--
-- Apply in Supabase Studio under the gated-DRAFT rule
-- (docs/CLAUDE.md, `main protection` ruleset). Verify via
--   node --env-file=.env.local scripts/_probe_kpi_spine.mjs
-- before flipping the PR ready-for-review.
--
-- Note on the prompt's `7 rows expected` for TBJ - BUF: measured
-- against live data on 2026-08-03, TBJ - BUF actually carries 16
-- gl_codes rows. The migration asserts 16, not 7. Kevin was flagged
-- before authoring.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- Pre-flight assertions
-- Tolerates both first-run and re-run states. Aborts on drift.
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_accounts INT;
  n_tbj_buf INT;
  n_tbj_ny_existing INT;
  n_lines_existing INT;
  n_activation_existing INT;
  pnl_col_exists BOOLEAN;
  drift_count INT;
BEGIN
  -- Invariant: accounts has 12 rows (11 client + CORP).
  SELECT COUNT(*) INTO n_accounts FROM accounts;
  IF n_accounts <> 12 THEN
    RAISE EXCEPTION 'kpi-1 pre-flight: accounts has % rows, expected 12', n_accounts;
  END IF;

  -- gl_codes TBJ - BUF: 16 on first run (measured 2026-08-03), 0 on
  -- re-run. Anything else is data drift and requires investigation
  -- before this migration mutates rows.
  SELECT COUNT(*) INTO n_tbj_buf FROM gl_codes WHERE account_key = 'TBJ - BUF';
  IF n_tbj_buf NOT IN (0, 16) THEN
    RAISE EXCEPTION 'kpi-1 pre-flight: gl_codes TBJ - BUF has % rows, expected 0 (re-run) or 16 (first run)', n_tbj_buf;
  END IF;

  -- On first run TBJ - NY should have 0 rows in gl_codes. On re-run
  -- it should have >= 16. If first-run shape (n_tbj_buf=16) and TBJ-NY
  -- already carries rows, someone has been partially applying by hand.
  SELECT COUNT(*) INTO n_tbj_ny_existing FROM gl_codes WHERE account_key = 'TBJ - NY';
  IF n_tbj_buf = 16 AND n_tbj_ny_existing <> 0 THEN
    RAISE EXCEPTION 'kpi-1 pre-flight: gl_codes has both TBJ - BUF (16) and TBJ - NY (%). Manual half-apply detected', n_tbj_ny_existing;
  END IF;

  -- kpi_lines: absent (first run) or exactly 34 rows (re-run).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kpi_lines') THEN
    SELECT COUNT(*) INTO n_lines_existing FROM kpi_lines;
    IF n_lines_existing NOT IN (0, 34) THEN
      RAISE EXCEPTION 'kpi-1 pre-flight: kpi_lines has % rows, expected 0 or 34', n_lines_existing;
    END IF;
  END IF;

  -- kpi_line_activation: absent (first run) or 0..374 for FY2026.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kpi_line_activation') THEN
    SELECT COUNT(*) INTO n_activation_existing FROM kpi_line_activation WHERE fiscal_year = 2026;
    IF n_activation_existing > 374 THEN
      RAISE EXCEPTION 'kpi-1 pre-flight: kpi_line_activation FY2026 has % rows, expected 0..374', n_activation_existing;
    END IF;
  END IF;

  -- accounts.pnl_tab_name: if the column exists (re-run), verify no
  -- drift from the expected mapping. If a populated value differs
  -- from what we plan to write, abort - someone edited it out of band.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'pnl_tab_name'
  ) INTO pnl_col_exists;
  IF pnl_col_exists THEN
    SELECT COUNT(*) INTO drift_count FROM (
      VALUES
        ('CIN - AZ','CIN-AZ'), ('CIN - KY','CIN-KY'), ('CIN - OH','CIN-OH'),
        ('STL - FL','STL-FL'), ('STL - MO','STL-MO'),
        ('TBJ - NY','TBJ-BUF'), ('TBJ - FL','TBJ-FL'),
        ('TBR - FL','TBR-FL'),
        ('TXR - AZ','TXR-AZ'), ('TXR - TX - H','TXR-HOME'), ('TXR - TX - V','TXR-VISTOR')
    ) v(tk, expected)
    JOIN accounts a ON a.team_key = v.tk
    WHERE a.pnl_tab_name IS NOT NULL AND a.pnl_tab_name <> v.expected;
    IF drift_count > 0 THEN
      RAISE EXCEPTION 'kpi-1 pre-flight: accounts.pnl_tab_name has % row(s) drifted from expected mapping', drift_count;
    END IF;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 1. accounts.pnl_tab_name
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pnl_tab_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_pnl_tab_name_key'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_pnl_tab_name_key UNIQUE (pnl_tab_name);
  END IF;
END $$;

-- Seed the 11 client accounts. CORP stays NULL (out of KPI scope).
-- The last three differ from the naive squish of team_key; two of them
-- carry the workbook's own choices (TBJ-BUF, TXR-HOME) and one is the
-- workbook's misspelling (TXR-VISTOR). The misspelling is load-bearing
-- for the ETL - the parser matches on the exact tab name.
UPDATE accounts SET pnl_tab_name = 'CIN-AZ'     WHERE team_key = 'CIN - AZ';
UPDATE accounts SET pnl_tab_name = 'CIN-KY'     WHERE team_key = 'CIN - KY';
UPDATE accounts SET pnl_tab_name = 'CIN-OH'     WHERE team_key = 'CIN - OH';
UPDATE accounts SET pnl_tab_name = 'STL-FL'     WHERE team_key = 'STL - FL';
UPDATE accounts SET pnl_tab_name = 'STL-MO'     WHERE team_key = 'STL - MO';
UPDATE accounts SET pnl_tab_name = 'TBJ-BUF'    WHERE team_key = 'TBJ - NY';
UPDATE accounts SET pnl_tab_name = 'TBJ-FL'     WHERE team_key = 'TBJ - FL';
UPDATE accounts SET pnl_tab_name = 'TBR-FL'     WHERE team_key = 'TBR - FL';
UPDATE accounts SET pnl_tab_name = 'TXR-AZ'     WHERE team_key = 'TXR - AZ';
UPDATE accounts SET pnl_tab_name = 'TXR-HOME'   WHERE team_key = 'TXR - TX - H';
UPDATE accounts SET pnl_tab_name = 'TXR-VISTOR' WHERE team_key = 'TXR - TX - V';

-- ─────────────────────────────────────────────────────────────────
-- 2. gl_codes account_key rename: TBJ - BUF -> TBJ - NY
-- ─────────────────────────────────────────────────────────────────
UPDATE gl_codes SET account_key = 'TBJ - NY' WHERE account_key = 'TBJ - BUF';

-- ─────────────────────────────────────────────────────────────────
-- 3. kpi_lines - canonical chart of accounts
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_lines (
  line_code       TEXT PRIMARY KEY,
  line_name       TEXT NOT NULL,
  section         TEXT NOT NULL CHECK (section IN ('revenue','cogs','sga')),
  group_code      TEXT,
  definition      TEXT,
  visibility_tier TEXT NOT NULL DEFAULT 'all' CHECK (visibility_tier IN ('all','site_leader')),
  sort_order      INTEGER NOT NULL
);

INSERT INTO kpi_lines (line_code, line_name, section, group_code, definition, visibility_tier, sort_order) VALUES
  ('2200',   'Catering Revenue',              'revenue', NULL,   'Account-specific catering, billed apart from service charges and meal service', 'all',          10),
  ('2300',   'Service Charges',               'revenue', NULL,   'Contracted fee to run the service',                                             'all',          20),
  ('2400.1', 'Meal Service (Home)',           'revenue', '2400', 'Revenue at the home stadium from the operating clubhouse''s perspective',      'all',          30),
  ('2400.2', 'Meal Service (Away)',           'revenue', '2400', 'Revenue at the home stadium earned from visiting clubs',                       'all',          40),
  ('2600',   'Consulting',                    'revenue', NULL,   'One-off consulting fees to teams',                                              'all',          50),
  ('3100.1', 'Hourly Kitchen Labor Wages',    'cogs',    '3100', 'Hourly kitchen labor',                                                          'all',          60),
  ('3100.2', 'Salary Kitchen Wages',          'cogs',    '3100', 'Salaried managers on the account, annual salary by period',                    'site_leader',  70),
  ('3200.1', 'General Food',                  'cogs',    '3200', 'All food purchased for production',                                             'all',          80),
  ('3200.2', 'Resale Food',                   'cogs',    '3200', '4% of the general food budget as an inflation savings account, plus fun money at STL-FL and TBJ-FL', 'all', 90),
  ('3400.1', 'Packaging',                     'cogs',    '3400', 'Disposables for packaging food',                                                'all',         100),
  ('3400.2', 'Supplies',                      'cogs',    '3400', 'Disposables used in preparation',                                               'all',         110),
  ('3400.5', 'Linen',                         'cogs',    '3400', 'Chef coats, aprons, towels, uniforms, laundry service',                        'all',         120),
  ('3500.1', 'Delivery Mileage Reimbursement','cogs',    '3500', 'Reimbursement when someone uses a personal vehicle',                           'all',         130),
  ('3500.2', 'Vehicle Insurance',             'cogs',    '3500', 'Insurance on account vehicles',                                                 'all',         140),
  ('3500.3', 'Leased Vehicle',                'cogs',    '3500', 'Lease on a delivery vehicle',                                                   'all',         150),
  ('3500.4', 'Fuel',                          'cogs',    '3500', 'Fuel',                                                                          'all',         160),
  ('3500.5', 'Vehicle Repair & Maintenance',  'cogs',    '3500', 'Oil, tires, detailing, general vehicle maintenance',                           'all',         170),
  ('5002.1', 'General Repair & Maintenance',  'sga',     '5002', 'Upkeep of physical space and non-equipment assets. KitchFix-owned, not client-owned', 'all', 180),
  ('5002.5', 'Equipment',                     'sga',     '5002', 'Repair and service of kitchen and service equipment, including contracts and PM', 'all',       190),
  ('5004.8', 'Incentives',                    'sga',     '5004', 'Bonuses, referral payments, performance awards',                                'all',         200),
  ('5004.9', 'Employer Payroll Taxes',        'sga',     '5004', 'Employer share of FICA, FUTA, SUTA',                                            'all',         210),
  ('5006.1', 'Operations Travel',             'sga',     '5006', 'Travel for account operations',                                                 'all',         220),
  ('5006.3', 'Account Management Travel',     'sga',     '5006', 'Travel by the account management team to visit clients',                       'all',         230),
  ('5012.1', 'Telephone Expense',             'sga',     '5012', 'Salaried manager phone stipends',                                               'all',         240),
  ('5012.2', 'Scavenger',                     'sga',     '5012', 'Trash collection',                                                              'all',         250),
  ('5012.3', 'General Utilities',             'sga',     '5012', 'Gas and electric where the account is not in a client-paid facility',          'all',         260),
  ('5012.5', 'Computer Hardware',             'sga',     '5012', 'Company computers purchased for managers',                                      'all',         270),
  ('5013.1', 'Equipment Lease',               'sga',     '5013', 'Leased kitchen equipment - dishwashers, ice machines',                         'all',         280),
  ('5013.2', 'Building Lease',                'sga',     '5013', 'Rent where the kitchen is not client-owned',                                    'all',         290),
  ('5016.6', 'Merchant Service Fees',         'sga',     '5016', 'Card processing and payment platform fees',                                     'all',         300),
  ('5016.7', 'Licenses & Fees',               'sga',     '5016', 'Permits, health department, food handler and liquor licenses, subscriptions',  'all',         310),
  ('5017.3', 'Perks',                         'sga',     '5017', 'Team appreciation - gear, recognition, team meals, outings',                   'all',         320),
  ('5017.5', 'Meals & Entertainment',         'sga',     '5017', 'Business meals, entertainment and gifts with or for clients',                  'all',         330),
  ('5017.7', 'Paid Time Off',                 'sga',     '5017', 'Vacation, sick, holiday, accrual',                                              'all',         340)
ON CONFLICT (line_code) DO UPDATE SET
  line_name       = EXCLUDED.line_name,
  section         = EXCLUDED.section,
  group_code      = EXCLUDED.group_code,
  definition      = EXCLUDED.definition,
  visibility_tier = EXCLUDED.visibility_tier,
  sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────
-- 4. kpi_line_activation - per-account applicability for FY2026
-- ─────────────────────────────────────────────────────────────────
-- account_key uses a regex CHECK for the canonical spaced-hyphen
-- format. A foreign key to accounts(team_key) is stronger (it
-- constrains to real accounts, not just shape-matching strings) but
-- lands in a separate migration (kpi-1b-activation-fk.sql) because
-- editing this CREATE after apply is a no-op under IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS kpi_line_activation (
  account_key   TEXT NOT NULL CHECK (
                  account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                ),
  line_code     TEXT NOT NULL REFERENCES kpi_lines(line_code),
  fiscal_year   INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  active        BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (account_key, line_code, fiscal_year)
);

-- Seed 11 client accounts x 34 lines = 374 rows for FY2026.
-- Inactivation rules per the verified activation matrix + D26 single-
-- employee ruling. 24 total inactive rows.
INSERT INTO kpi_line_activation (account_key, line_code, fiscal_year, active)
SELECT
  a.team_key,
  l.line_code,
  2026 AS fiscal_year,
  CASE
    WHEN l.line_code = '3500.1' AND a.team_key <> 'TBR - FL'                             THEN false
    WHEN l.line_code = '3500.2' AND a.team_key  = 'TBR - FL'                             THEN false
    WHEN l.line_code = '5012.3' AND a.team_key IN ('CIN - AZ', 'TXR - TX - H')           THEN false
    WHEN l.line_code = '5012.5' AND a.team_key NOT IN ('CIN - AZ', 'TXR - TX - H')       THEN false
    WHEN l.line_code = '3100.1' AND a.team_key IN ('CIN - KY', 'TBJ - NY')               THEN false
    ELSE true
  END AS active
FROM accounts a
CROSS JOIN kpi_lines l
WHERE a.team_key <> 'CORP'
ON CONFLICT (account_key, line_code, fiscal_year) DO UPDATE SET
  active = EXCLUDED.active;

-- ─────────────────────────────────────────────────────────────────
-- Post-flight assertions - exact counts, abort on any mismatch.
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_lines INT;
  n_slt INT;
  slt_code TEXT;
  n_activation INT;
  n_inactive INT;
  n_pnl_null_client INT;
  n_pnl_corp_populated INT;
  n_pnl_duplicates INT;
  n_tbj_buf INT;
  n_tbj_ny INT;
BEGIN
  -- kpi_lines
  SELECT COUNT(*) INTO n_lines FROM kpi_lines;
  IF n_lines <> 34 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: kpi_lines has % rows, expected 34', n_lines;
  END IF;

  SELECT COUNT(*), MIN(line_code) INTO n_slt, slt_code FROM kpi_lines WHERE visibility_tier = 'site_leader';
  IF n_slt <> 1 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: site_leader tier count = %, expected 1', n_slt;
  END IF;
  IF slt_code <> '3100.2' THEN
    RAISE EXCEPTION 'kpi-1 post-flight: site_leader tier is on %, expected 3100.2', slt_code;
  END IF;

  -- kpi_line_activation
  SELECT COUNT(*) INTO n_activation FROM kpi_line_activation WHERE fiscal_year = 2026;
  IF n_activation <> 374 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: FY2026 activation rows = %, expected 374 (11 x 34)', n_activation;
  END IF;

  SELECT COUNT(*) INTO n_inactive FROM kpi_line_activation WHERE fiscal_year = 2026 AND active = false;
  IF n_inactive <> 24 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: FY2026 inactive rows = %, expected 24', n_inactive;
  END IF;

  -- Per-line inactive counts. Independent verification: a CASE that
  -- inactivates the WRONG accounts would produce the right total but
  -- the wrong distribution. This check restates the intent line by
  -- line rather than restating the CASE.
  IF (SELECT COUNT(*) FROM kpi_line_activation
      WHERE fiscal_year = 2026 AND active = false AND line_code = '3500.1') <> 10 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: 3500.1 inactive count wrong, expected 10';
  END IF;
  IF (SELECT COUNT(*) FROM kpi_line_activation
      WHERE fiscal_year = 2026 AND active = false AND line_code = '3500.2') <> 1 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: 3500.2 inactive count wrong, expected 1';
  END IF;
  IF (SELECT COUNT(*) FROM kpi_line_activation
      WHERE fiscal_year = 2026 AND active = false AND line_code = '5012.3') <> 2 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: 5012.3 inactive count wrong, expected 2';
  END IF;
  IF (SELECT COUNT(*) FROM kpi_line_activation
      WHERE fiscal_year = 2026 AND active = false AND line_code = '5012.5') <> 9 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: 5012.5 inactive count wrong, expected 9';
  END IF;
  IF (SELECT COUNT(*) FROM kpi_line_activation
      WHERE fiscal_year = 2026 AND active = false AND line_code = '3100.1') <> 2 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: 3100.1 inactive count wrong, expected 2';
  END IF;

  -- accounts.pnl_tab_name
  SELECT COUNT(*) INTO n_pnl_null_client FROM accounts WHERE team_key <> 'CORP' AND pnl_tab_name IS NULL;
  IF n_pnl_null_client <> 0 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: % client accounts have NULL pnl_tab_name', n_pnl_null_client;
  END IF;

  SELECT COUNT(*) INTO n_pnl_corp_populated FROM accounts WHERE team_key = 'CORP' AND pnl_tab_name IS NOT NULL;
  IF n_pnl_corp_populated <> 0 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: CORP has pnl_tab_name populated (expected NULL - out of KPI scope)';
  END IF;

  SELECT COUNT(*) INTO n_pnl_duplicates FROM (
    SELECT pnl_tab_name FROM accounts WHERE pnl_tab_name IS NOT NULL
    GROUP BY pnl_tab_name HAVING COUNT(*) > 1
  ) d;
  IF n_pnl_duplicates <> 0 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: % pnl_tab_name duplicates', n_pnl_duplicates;
  END IF;

  -- gl_codes rename
  SELECT COUNT(*) INTO n_tbj_buf FROM gl_codes WHERE account_key = 'TBJ - BUF';
  IF n_tbj_buf <> 0 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: gl_codes still has % TBJ - BUF rows', n_tbj_buf;
  END IF;

  SELECT COUNT(*) INTO n_tbj_ny FROM gl_codes WHERE account_key = 'TBJ - NY';
  IF n_tbj_ny < 16 THEN
    RAISE EXCEPTION 'kpi-1 post-flight: gl_codes TBJ - NY has % rows, expected >= 16 (16 moved from TBJ - BUF)', n_tbj_ny;
  END IF;
END $$;

COMMIT;
