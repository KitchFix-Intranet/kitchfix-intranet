-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-09-tbj-media-scout-meals-map
-- Add Media Meals + Scout Meals to sc_qbo_service_map for TBJ - FL.
--
-- Unblocks the three finalize weeks that were failing on
-- `throw new Error('unmapped')` for these two services:
--   2026-01-26 (Scout Meals, 380 units)
--   2026-02-16 (Media Meals, 50 units)
--   2026-06-01 (Scout Meals, 180 units)
--
-- Sebastian's invoicing practice (verified via K300168537 +
-- K300168801, customer 16971): each of these bills as a solo line
-- on its own invoice. Not merged with the meal service invoice.
--
-- Mapping (rulings 2026-09-09):
--
--   SC service    QBO item ID   qbo_item name       rate     slot
--   ─────────────────────────────────────────────────────────────
--   Media Meals   3344          TBJ - Media Meals   $15.00   media-meals
--   Scout Meals   3376          TBJ - Scouts        $11.55   scout-meals
--
-- Both services already exist in sc_services (active, not archived).
-- Neither is in sc_qbo_service_map today - clean INSERTs, no ON
-- CONFLICT logic needed.
--
-- Shape:
--   aggregate_group = NULL for both. Nothing else in the catalog
--     groups with either. If Sebastian ever bills them together
--     with something else, that is a new decision + new migration.
--   invoice_slot = own dedicated slots ('media-meals', 'scout-meals')
--     matching TBJ - FL's slot-per-invoice pattern (catering,
--     florida-ops, milb, milb-pantry, mlb, mlb-pantry, single-a,
--     ssm are the eight existing slots; each = one Sebastian
--     invoice per week).
--   tax_override = NULL (defaults to TAX). Both services carry
--     is_tax_free=false in sc_services.
--   line_desc_style = 'plain_name' - matches every other TBJ
--     single-service slot (Catering, Florida Ops, both Pantries,
--     Stadium Staff Meals).
--
-- The finding worth recording (from the pre-write probe): Media
-- and Scout coincide with meal service in the same billing week
-- on all three affected weeks. Joining them into the `milb` or
-- `mlb` slots would merge them onto an existing invoice line,
-- breaking Sebastian's document structure (one solo invoice per).
-- The slot separation is what preserves the invoice shape.
--
-- Item-default vs SC price:
--   QBO item 3376 (TBJ - Scouts) carries a default UnitPrice of
--   $11.12. Sebastian's invoices bill at $11.55. buildInvoicePayload
--   emits the SC price on every line, so this discrepancy does NOT
--   affect output - the invoice will read $11.55 as expected. Noted
--   here so a future reader does not assume the item default is
--   authoritative.
--
-- Three-block Studio pattern (preflight / main / postflight).
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- A1. Confirm sc_services rows exist for both, active.
--     Expected 2 rows.
SELECT id, service_name, is_flat_fee, is_tax_free, active, active_until
FROM sc_services
WHERE account_key = 'TBJ - FL'
  AND service_name IN ('Media Meals', 'Scout Meals')
  AND deleted_at IS NULL
ORDER BY service_name;

-- A2. Confirm neither is currently in sc_qbo_service_map.
--     Expected 0 rows.
SELECT service_id, qbo_item_id, qbo_line_description, invoice_slot
FROM sc_qbo_service_map
WHERE service_id IN (
  '84277f04-38e4-4232-b5b9-9f8318510f08',  -- Media Meals
  '41858327-adef-486e-b43d-734ec39d9c33'   -- Scout Meals
);

-- A3. Preview the existing slot inventory for TBJ - FL so the new
--     slot names land in an obvious column of an obvious set.
SELECT DISTINCT invoice_slot
FROM sc_qbo_service_map
WHERE account_key = 'TBJ - FL'
  AND active = true
ORDER BY invoice_slot;
-- Expected: catering, florida-ops, milb, milb-pantry, mlb,
-- mlb-pantry, single-a, ssm


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent via ON CONFLICT)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO sc_qbo_service_map
  (service_id,                              account_key, qbo_item_id, qbo_line_description, aggregate_group, invoice_slot,   tax_override, line_desc_style)
VALUES
  -- Media Meals -> QBO item 3344 (TBJ - Media Meals), $15.00, own slot
  ('84277f04-38e4-4232-b5b9-9f8318510f08', 'TBJ - FL',  '3344',      'TBJ - Media Meals',  NULL,            'media-meals',  NULL,         'plain_name'),
  -- Scout Meals -> QBO item 3376 (TBJ - Scouts), $11.55 (see item-default note), own slot
  ('41858327-adef-486e-b43d-734ec39d9c33', 'TBJ - FL',  '3376',      'TBJ - Scouts',       NULL,            'scout-meals',  NULL,         'plain_name')
ON CONFLICT (service_id) DO NOTHING;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- C1. Confirm both rows landed with the expected shape.
--     Expected 2 rows exactly matching the mapping table above.
SELECT service_id, account_key, qbo_item_id, qbo_line_description,
       aggregate_group, invoice_slot, tax_override, line_desc_style, active
FROM sc_qbo_service_map
WHERE service_id IN (
  '84277f04-38e4-4232-b5b9-9f8318510f08',
  '41858327-adef-486e-b43d-734ec39d9c33'
)
ORDER BY qbo_item_id;

-- C2. Confirm the TBJ - FL slot inventory now includes the two new
--     slots. Expected 10 rows: the prior 8 + media-meals + scout-meals.
SELECT DISTINCT invoice_slot
FROM sc_qbo_service_map
WHERE account_key = 'TBJ - FL'
  AND active = true
ORDER BY invoice_slot;

-- After apply, re-finalize any of the three previously-failing weeks
-- in TEST mode:
--   2026-01-26  (Scout Meals: 380 units × $11.55 = $4,389.00)
--   2026-02-16  (Media Meals: 50 units × $15.00  =   $750.00)
--   2026-06-01  (Scout Meals: 180 units × $11.55 = $2,079.00)
-- Expected: no `unmapped` throw; each affected week produces its
-- normal meal-service invoices PLUS a solo Media Meals or Scout
-- Meals invoice per Sebastian's shape.
