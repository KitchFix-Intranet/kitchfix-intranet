-- ════════════════════════════════════════════════════════════════════════════
-- pr-10-2: ai_line_items derived columns for parser + classifier output
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2 purchase-line-item repair. Adds NEW derived columns to ai_line_items
-- to hold pack-size parser output (Task 3) and food classifier output
-- (Task 4). Does NOT overwrite any source column (per Phase 2 hard rule).
--
-- Columns added:
--
--   parsed_pack_qty      numeric   inner "count" from packSize (e.g. "24/16OZ" -> 24)
--   parsed_pack_size     numeric   inner "size per unit" (e.g. "24/16OZ" -> 16)
--   parsed_pack_uom      text      canonical UOM ("LB", "OZ", "GAL", "CT", etc.)
--   parsed_weight_lb     numeric   total mass in pounds for the line
--                                  (quantity x parsed pack mass, or from
--                                  weight_line_value if catch-weight)
--   parsed_weight_source text      which resolver won:
--                                     'weight_line_value',
--                                     'pack_size:single_weight',
--                                     'pack_size:n_x_m_weight',
--                                     'description:single_weight',
--                                     'description:n_x_m_weight',
--                                     'catalog_lookup:*',
--                                     'volume_excluded',
--                                     'unresolved'
--   quantity_source      text      'shipped_count' | 'ordered_count' |
--                                  'quantity' | 'unresolved'
--   is_food              boolean   food/non-food verdict (null when 'unknown')
--   food_verdict         text      'food' | 'non_food' | 'unknown'
--   food_signals         jsonb     per-signal explanation:
--                                  {"vendor":"unknown|food|non_food",
--                                   "category":..., "description":...,
--                                   "gl":...}
--   food_disagreement    boolean   true when at least one signal said food
--                                  AND at least one said non_food
--
-- All columns are NULLABLE and DEFAULT NULL. Backfill happens in a follow-up
-- pr-10-3 script that reads existing rows, runs parser + classifier, and
-- UPDATEs the derived columns in batches. That backfill runs in dry-run mode
-- first and does NOT execute until Kevin approves.
--
-- SAFETY
--   - Purely additive. No source column touched.
--   - No CHECK constraints so existing writers keep working without
--     modification.
--   - No indexes added yet; the follow-up pr-10-4 will add
--     `CREATE INDEX ai_line_items_is_food_idx ON ai_line_items(is_food)
--     WHERE is_food = true` if Phase 3 needs it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE ai_line_items
  ADD COLUMN IF NOT EXISTS parsed_pack_qty      numeric,
  ADD COLUMN IF NOT EXISTS parsed_pack_size     numeric,
  ADD COLUMN IF NOT EXISTS parsed_pack_uom      text,
  ADD COLUMN IF NOT EXISTS parsed_weight_lb     numeric,
  ADD COLUMN IF NOT EXISTS parsed_weight_source text,
  ADD COLUMN IF NOT EXISTS quantity_source      text,
  ADD COLUMN IF NOT EXISTS is_food              boolean,
  ADD COLUMN IF NOT EXISTS food_verdict         text,
  ADD COLUMN IF NOT EXISTS food_signals         jsonb,
  ADD COLUMN IF NOT EXISTS food_disagreement    boolean;

COMMENT ON COLUMN ai_line_items.parsed_pack_qty      IS 'Phase 2 (pr-10-2). Inner count from packSize parser; e.g. 24/16OZ -> 24.';
COMMENT ON COLUMN ai_line_items.parsed_pack_size     IS 'Phase 2 (pr-10-2). Inner size-per-unit from packSize parser; e.g. 24/16OZ -> 16.';
COMMENT ON COLUMN ai_line_items.parsed_pack_uom      IS 'Phase 2 (pr-10-2). Canonical UOM from packSize parser.';
COMMENT ON COLUMN ai_line_items.parsed_weight_lb     IS 'Phase 2 (pr-10-2). Total mass in pounds for the line, resolved via parser fallback chain.';
COMMENT ON COLUMN ai_line_items.parsed_weight_source IS 'Phase 2 (pr-10-2). Which resolver won: weight_line_value | pack_size:* | description:* | catalog_lookup:* | volume_excluded | unresolved.';
COMMENT ON COLUMN ai_line_items.quantity_source      IS 'Phase 2 (pr-10-2). shipped_count | ordered_count | quantity | unresolved.';
COMMENT ON COLUMN ai_line_items.is_food              IS 'Phase 2 (pr-10-2). Boolean food verdict; NULL when unknown.';
COMMENT ON COLUMN ai_line_items.food_verdict         IS 'Phase 2 (pr-10-2). food | non_food | unknown.';
COMMENT ON COLUMN ai_line_items.food_signals         IS 'Phase 2 (pr-10-2). Per-signal breakdown for auditability.';
COMMENT ON COLUMN ai_line_items.food_disagreement    IS 'Phase 2 (pr-10-2). true when vendor/GL/category signals disagreed.';

COMMIT;
