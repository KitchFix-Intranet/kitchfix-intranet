-- ═══════════════════════════════════════════════════════════════════
-- sc-38: TBR - FL + TBJ - FL billing enablement + export_excluded flag
-- 2026-09-02
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Add sc_qbo_service_map.export_excluded so a service can be present
--   in the mapping (satisfying the buildInvoicePayload unmapped-throw
--   guard) while being suppressed from invoice-line emission. B&G Lunch
--   on TBR - FL is the first case: Sebastian bills B&G outside the
--   system, but B&G revenue must remain in TBR account totals per
--   Kevin's kitchen-margin rule (one kitchen buys labour + food once
--   for two clients; any margin figure counting only Rays revenue
--   against the whole kitchen's cost is wrong).
--
--   Then seed the two account maps and 25 service maps required to
--   enable finalize for TBR - FL and TBJ - FL. Both accounts weekly,
--   tax code 26. Both in test mode until Kevin runs a live drill.
--
-- Owner rulings this codifies (Kevin 2026-09-02):
--
--   Ruling 1: EXPORT_EXCLUDED IS ORTHOGONAL TO IS_NON_REVENUE.
--     is_non_revenue drops from revenue rollups (sc_month_summary's
--     FILTER (WHERE NOT is_non_revenue)). export_excluded drops from
--     invoice-line emission only. B&G Lunch needs the latter, not the
--     former. A future service could be non-revenue AND count-entered,
--     or amount-entered and revenue-bearing, or export_excluded but
--     not either - the three flags do not coincide.
--
--   Ruling 2: MLB IS SPRING-TRAINING ONLY AT BOTH ACCOUNTS.
--     TBR MLB and TBJ MLB services are mapped, but the field team only
--     bills them March. Zero-unit rows for MLB Dinner and other MLB
--     items are mapped PREEMPTIVELY so a future spring day doesn't
--     throw on first use (learned from the TXR - AZ Extra Protein
--     failure mode).
--
--   Ruling 3: EXTRA PROTEIN (TBR) IS ITS OWN LINE ITEM SINCE JULY.
--     Sebastian changed practice mid-season; Extra Protein is no
--     longer bundled under Lunch/Dinner. Maps to its own QBO item id
--     3369 with its own line description, sits on the 'milb' invoice
--     slot (same document as MiLB meals per July + August observed
--     invoices), no aggregate_group.
--
--   Ruling 4: SLOT ASSIGNMENT MATCHES SEBASTIAN'S DOCUMENT SEPARATION.
--     TBR: mlb, milb.
--     TBJ: mlb, milb, single-a, ssm, florida-ops, mlb-pantry,
--          milb-pantry, catering. Realistic per-week count 3-5,
--          spring-training peak 7.
--
--   Ruling 5: BUFFALO MEAL SERVICE / TBJ - NY OUT OF SCOPE.
--     Sebastian bills Buffalo by hand. No invoice_account_key column
--     built. This migration covers TBR - FL + TBJ - FL only.
--
-- Fences:
--   - IDs, never hand-typed uuids. Service rows resolve by
--     (account_key, group_name, service_name) via joins so a future
--     service_id regeneration cannot break the seed.
--   - Column adds are reversible (DROP COLUMN + drop CHECKs).
--   - No changes to sc_daily_revenue, sc_month_summary, sc_services,
--     sc_service_prices, or any actuals/projections table.
--   - No writes to any table outside sc_qbo_service_map and
--     sc_qbo_account_map.
--
-- Apply order:
--   Single BEGIN/COMMIT. Schema alters run first, then account maps,
--   then service maps. Postflight verifies row counts + CHECK
--   invariants + QBO item id presence at end of the transaction.
--
-- TO ROLLBACK (in case of ruling reversal):
--   BEGIN;
--   DELETE FROM sc_qbo_service_map WHERE account_key IN ('TBR - FL','TBJ - FL');
--   DELETE FROM sc_qbo_account_map WHERE account_key IN ('TBR - FL','TBJ - FL');
--   ALTER TABLE sc_qbo_service_map
--     DROP CONSTRAINT sc_qbo_service_map_item_id_or_excluded_check,
--     DROP CONSTRAINT sc_qbo_service_map_line_desc_or_excluded_check;
--   ALTER TABLE sc_qbo_service_map
--     ALTER COLUMN qbo_item_id SET NOT NULL,
--     ALTER COLUMN qbo_line_description SET NOT NULL;
--   ALTER TABLE sc_qbo_service_map DROP COLUMN export_excluded;
--   COMMIT;
--
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- Step 1: schema changes on sc_qbo_service_map
-- ═══════════════════════════════════════════════════════════════════

-- 1a. Add export_excluded flag. Defaults to false so existing rows
-- retain their current behavior (line emission on).
ALTER TABLE sc_qbo_service_map
  ADD COLUMN export_excluded boolean NOT NULL DEFAULT false;

-- 1b. Allow qbo_item_id + qbo_line_description to be NULL for
-- excluded rows. Existing rows keep their current values.
ALTER TABLE sc_qbo_service_map
  ALTER COLUMN qbo_item_id DROP NOT NULL;

ALTER TABLE sc_qbo_service_map
  ALTER COLUMN qbo_line_description DROP NOT NULL;

-- 1c. CHECK constraints: unmapped-and-not-excluded stays impossible.
-- Either export_excluded=true (both fields may be NULL) OR
-- export_excluded=false (both fields must be present).
ALTER TABLE sc_qbo_service_map
  ADD CONSTRAINT sc_qbo_service_map_item_id_or_excluded_check
  CHECK (
    (export_excluded = false AND qbo_item_id IS NOT NULL)
    OR
    (export_excluded = true)
  );

ALTER TABLE sc_qbo_service_map
  ADD CONSTRAINT sc_qbo_service_map_line_desc_or_excluded_check
  CHECK (
    (export_excluded = false AND qbo_line_description IS NOT NULL)
    OR
    (export_excluded = true)
  );

-- ═══════════════════════════════════════════════════════════════════
-- Step 2: sc_qbo_account_map rows (TBR + TBJ)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO sc_qbo_account_map
  (account_key, qbo_customer_id, qbo_customer_name, qbo_taxcode_id,
   cadence, qbo_mode, salaried_manager_emails, rdo_email)
VALUES
  ('TBR - FL', '17860', 'Tampa Bay Rays (Port Charlotte, FL)', '26',
   'weekly', 'test', ARRAY[]::text[], NULL),
  ('TBJ - FL', '16971', 'Toronto Blue Jays (Dunedin, FL)',      '26',
   'weekly', 'test', ARRAY[]::text[], NULL);

-- ═══════════════════════════════════════════════════════════════════
-- Step 3: sc_qbo_service_map rows for TBR - FL (10 rows)
-- ═══════════════════════════════════════════════════════════════════
--
-- MLB Bfst: own QBO item, own line. Spring-training only.
-- MLB Lunch + Dinner: aggregated under 'TBR MLB - Lunch/Dinner'
--   (id 3298). MLB Dinner mapped preemptively (0 season units) so a
--   future ST day does not throw.
-- MiLB Bfst: own QBO item (id 3293).
-- MiLB Lunch + Dinner: aggregated under 'TBR MiLB - Lunch/Dinner'
--   (id 3294). Rates match at $21.68 post the 2026-09-02 precision
--   recon so the aggregate-group merge produces one line per day
--   (Sebastian's shape).
-- MiLB Road Sandwiches: own QBO item (id 3389).
-- MiLB Extra Protein - Chicken/Pork: own line (id 3369), 'milb' slot
--   per Kevin ruling (same document as MiLB meals). is_flat_fee=true
--   in sc_services so the builder emits one weekly line per week
--   with any actual row.
-- MiLB Extended Day Labor: own line ('Labor Fee', id 3392). is_flat_fee
--   in sc_services.
-- B&G Lunch: export_excluded=true. qbo_item_id + qbo_line_description
--   left NULL. Sebastian bills B&G outside the system.

INSERT INTO sc_qbo_service_map
  (service_id, account_key, qbo_item_id, qbo_line_description,
   aggregate_group, invoice_slot, tax_override, line_desc_style,
   export_excluded)
SELECT s.id, 'TBR - FL',
       item.qbo_item_id, item.qbo_line_description,
       item.aggregate_group, item.invoice_slot, item.tax_override,
       item.line_desc_style, item.export_excluded
FROM (VALUES
  ('Major League',      'Breakfast',                    '3297', 'TBR MLB - Breakfast',                NULL,           'mlb',   NULL, NULL,         false),
  ('Major League',      'Lunch',                        '3298', 'TBR MLB - Lunch/Dinner',             'tbr-mlb-ld',   'mlb',   NULL, NULL,         false),
  ('Major League',      'Dinner',                       '3298', 'TBR MLB - Lunch/Dinner',             'tbr-mlb-ld',   'mlb',   NULL, NULL,         false),
  ('Minor League',      'Breakfast - MiLB',             '3293', 'TBR MiLB - Breakfast',               NULL,           'milb',  NULL, NULL,         false),
  ('Minor League',      'Lunch - MiLB',                 '3294', 'TBR MiLB - Lunch/Dinner',            'tbr-milb-ld',  'milb',  NULL, NULL,         false),
  ('Minor League',      'Dinner',                       '3294', 'TBR MiLB - Lunch/Dinner',            'tbr-milb-ld',  'milb',  NULL, NULL,         false),
  ('Minor League',      'Road Sandwiches - MiLB',       '3389', 'TBR MiLB - Road Sandwiches',         NULL,           'milb',  NULL, NULL,         false),
  ('Minor League',      'Extra Protein - Chicken/Pork', '3369', 'Extra Protein (TBR) - Chicken/Pork', NULL,           'milb',  NULL, 'plain_name', false),
  ('Minor League',      'Extended Day Labor',           '3392', 'Labor Fee',                          NULL,           'milb',  NULL, 'plain_name', false),
  ('Boys & Girls Club', 'B&G Lunch',                    NULL,   NULL,                                 NULL,           'main',  NULL, NULL,         true)
) AS item(group_name, service_name, qbo_item_id, qbo_line_description,
         aggregate_group, invoice_slot, tax_override, line_desc_style, export_excluded)
JOIN sc_services s        ON s.service_name = item.service_name
                          AND s.account_key = 'TBR - FL'
                          AND s.deleted_at IS NULL
                          AND s.active_until IS NULL
JOIN sc_service_groups g  ON g.id = s.group_id
                          AND g.group_name = item.group_name;

-- ═══════════════════════════════════════════════════════════════════
-- Step 4: sc_qbo_service_map rows for TBJ - FL (15 rows)
-- ═══════════════════════════════════════════════════════════════════
--
-- MLB Bfst/Lunch/Dinner: aggregated under
--   'TBJ MLB - Breakfast/Lunch/Dinner' (id 3299). Spring-training only.
--   Dinner mapped preemptively.
-- MLB Post Game Meal: separate QBO item 'TBJ Pre/Post Game Meal'
--   (id 3381), own line, still on 'mlb' slot (same document).
-- MiLB Bfst/Lunch/Dinner: aggregated under
--   'TBJ MiLB - Breakfast/Lunch/Dinner' (id 3295). All three at $11.55.
-- Single A Jays Bfst + Pre-Game + Post-Game: aggregated under
--   'TBJ Single A Jays - Meal Service' (id 3323). All at $16.51.
--   Bfst has 0 season units; mapped preemptively.
-- SSM Stadium Staff Meals: own item (id 3435), own 'ssm' slot.
-- SSM Florida Ops - PDC: own item (id 3438), own 'florida-ops' slot
--   (Sebastian invoices Florida Ops separately from other SSM).
-- Other MLB G&G - Pantry: own item (id 3433), own 'mlb-pantry' slot.
-- Other MiLB G&G - Pantry: own item (id 3432), own 'milb-pantry' slot.
-- Other Team Canada: 'Catering - PFS' (id 3354), own 'catering' slot.
--
-- Deliberately NOT mapped per Kevin ruling:
--   MLB Umpire, MLB Snack (dead services - separate archive PR).
--   Other Fun $$$$ Allocated (is_non_revenue=true; drops before
--     mapping check hits).
--   Other Media Meals, Scout Meals, MLB - Catering (Kevin ruling
--     pending on QBO items).
--   TBJ - NY / Buffalo Meal Service (out of scope for this PR).

INSERT INTO sc_qbo_service_map
  (service_id, account_key, qbo_item_id, qbo_line_description,
   aggregate_group, invoice_slot, tax_override, line_desc_style,
   export_excluded)
SELECT s.id, 'TBJ - FL',
       item.qbo_item_id, item.qbo_line_description,
       item.aggregate_group, item.invoice_slot, item.tax_override,
       item.line_desc_style, item.export_excluded
FROM (VALUES
  ('Major League - PDC', 'Breakfast',           '3299', 'TBJ MLB - Breakfast/Lunch/Dinner',  'tbj-mlb-bld',       'mlb',          NULL, NULL,         false),
  ('Major League - PDC', 'Lunch',               '3299', 'TBJ MLB - Breakfast/Lunch/Dinner',  'tbj-mlb-bld',       'mlb',          NULL, NULL,         false),
  ('Major League - PDC', 'Dinner',              '3299', 'TBJ MLB - Breakfast/Lunch/Dinner',  'tbj-mlb-bld',       'mlb',          NULL, NULL,         false),
  ('Major League - PDC', 'Post Game Meal',      '3381', 'TBJ Pre/Post Game Meal',            NULL,                'mlb',          NULL, 'plain_name', false),
  ('Minor League - PDC', 'Breakfast',           '3295', 'TBJ MiLB - Breakfast/Lunch/Dinner', 'tbj-milb-bld',      'milb',         NULL, NULL,         false),
  ('Minor League - PDC', 'Lunch',               '3295', 'TBJ MiLB - Breakfast/Lunch/Dinner', 'tbj-milb-bld',      'milb',         NULL, NULL,         false),
  ('Minor League - PDC', 'Dinner',              '3295', 'TBJ MiLB - Breakfast/Lunch/Dinner', 'tbj-milb-bld',      'milb',         NULL, NULL,         false),
  ('Single A Jays',      'Breakfast',           '3323', 'TBJ Single A Jays - Meal Service',  'tbj-single-a-meal', 'single-a',     NULL, NULL,         false),
  ('Single A Jays',      'Pre-Game',            '3323', 'TBJ Single A Jays - Meal Service',  'tbj-single-a-meal', 'single-a',     NULL, NULL,         false),
  ('Single A Jays',      'Post-Game',           '3323', 'TBJ Single A Jays - Meal Service',  'tbj-single-a-meal', 'single-a',     NULL, NULL,         false),
  ('SSM',                'Stadium Staff Meals', '3435', 'TBJ - Stadium Staff Meals',         NULL,                'ssm',          NULL, 'plain_name', false),
  ('SSM',                'Florida Ops - PDC',   '3438', 'TBJ - Florida Ops',                 NULL,                'florida-ops',  NULL, 'plain_name', false),
  ('Other',              'MLB G&G - Pantry',    '3433', 'MLB G&G - Pantry',                  NULL,                'mlb-pantry',   NULL, 'plain_name', false),
  ('Other',              'MiLB G&G - Pantry',   '3432', 'MiLB G&G - Pantry',                 NULL,                'milb-pantry',  NULL, 'plain_name', false),
  ('Other',              'Team Canada',         '3354', 'Catering - PFS',                    NULL,                'catering',     NULL, 'plain_name', false)
) AS item(group_name, service_name, qbo_item_id, qbo_line_description,
         aggregate_group, invoice_slot, tax_override, line_desc_style, export_excluded)
JOIN sc_services s        ON s.service_name = item.service_name
                          AND s.account_key = 'TBJ - FL'
                          AND s.deleted_at IS NULL
                          AND s.active_until IS NULL
JOIN sc_service_groups g  ON g.id = s.group_id
                          AND g.group_name = item.group_name;

-- ═══════════════════════════════════════════════════════════════════
-- Step 5: postflight invariants (aborts the transaction on any breach)
-- ═══════════════════════════════════════════════════════════════════
--
-- Any DO block that RAISE EXCEPTIONs aborts the transaction. Runs
-- BEFORE COMMIT so a bad state cannot be committed.

DO $$
DECLARE
  tbr_count int;
  tbj_count int;
  bad_check_rows int;
  missing_account_maps int;
BEGIN
  -- Account map count: expect exactly 2 new rows (TBR + TBJ).
  SELECT COUNT(*) INTO missing_account_maps
    FROM sc_qbo_account_map
    WHERE account_key IN ('TBR - FL', 'TBJ - FL');
  IF missing_account_maps <> 2 THEN
    RAISE EXCEPTION 'sc-38 HALT: expected 2 sc_qbo_account_map rows for TBR + TBJ, got %', missing_account_maps;
  END IF;

  -- Service map counts: TBR expects 10, TBJ expects 15.
  SELECT COUNT(*) INTO tbr_count
    FROM sc_qbo_service_map
    WHERE account_key = 'TBR - FL';
  IF tbr_count <> 10 THEN
    RAISE EXCEPTION 'sc-38 HALT: expected 10 sc_qbo_service_map rows for TBR - FL, got %. A service_name in the VALUES list did not match any live sc_services row.', tbr_count;
  END IF;

  SELECT COUNT(*) INTO tbj_count
    FROM sc_qbo_service_map
    WHERE account_key = 'TBJ - FL';
  IF tbj_count <> 15 THEN
    RAISE EXCEPTION 'sc-38 HALT: expected 15 sc_qbo_service_map rows for TBJ - FL, got %. A service_name in the VALUES list did not match any live sc_services row.', tbj_count;
  END IF;

  -- CHECK invariants: no row should have export_excluded=false AND
  -- (qbo_item_id IS NULL OR qbo_line_description IS NULL). The CHECK
  -- constraints already enforce this; the count is defense-in-depth
  -- against a race where the CHECK were deferred.
  SELECT COUNT(*) INTO bad_check_rows
    FROM sc_qbo_service_map
    WHERE export_excluded = false
      AND (qbo_item_id IS NULL OR qbo_line_description IS NULL);
  IF bad_check_rows <> 0 THEN
    RAISE EXCEPTION 'sc-38 HALT: % row(s) have export_excluded=false but missing qbo_item_id or qbo_line_description', bad_check_rows;
  END IF;

  RAISE NOTICE 'sc-38: 2 account maps, 10 TBR service maps, 15 TBJ service maps. Invariants OK.';
END $$;

COMMIT;
