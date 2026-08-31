# Phase 3b - defect fixes on the Phase 3 workbook

Reads Phase 3 caches (`_augmented.json`, `_meals.json`, `item_classifications.json`),
applies the six fixes, and writes a corrected workbook + a CEO one-pager.

## Fixes applied

1. Beverage classification -> `neutral` on quality axis; introduce `core_food`
   basis (food $ excluding beverage $).
2. Monthly denominator overhaul: use `sc_daily_projections` when actuals sparse
   or missing; every cell shows `meals_used` + `meals_source`; suppress cells
   where $/meal > 3x window average.
3. Shared Basket unit normalization: match by (vendor_id, item_number), report
   $/lb where weight resolves else $/pack with pack_size printed; dedup by
   identity.
4. Non-food category leakage: reassign `cleaning`, `smallwares`, `chemical` etc
   to non-food (fixes Phase 3 defect where cleaning items landed in food-only
   tables via GL override).
5. TBR protein weight coverage: apply Candidate A (same-SKU sibling
   disambiguation for `pack_size_ambiguous_multipack`) + Candidate B (rehab
   `ep_qty_up_mismatch` rows that have `weight_line_value` - vendor's printed
   catch weight is trustworthy even when EP-vs-UP*Q disagrees).
6. Two new sheets: Protein Mix, Duplicate Item Families.

## Files

- `10_reclassify_beverages.mjs` - patch `item_classifications.json` in place
- `20_recompute.mjs` - the full re-analysis with all six fixes applied
- `30_build_workbook.mjs` - workbook re-build
- `40_ceo_one_pager.mjs` - CEO one-pager markdown
- `_common3b.mjs` - shared helpers

## Run order

```
node scripts_phase3b/10_reclassify_beverages.mjs
node scripts_phase3b/20_recompute.mjs
node scripts_phase3b/30_build_workbook.mjs
node scripts_phase3b/40_ceo_one_pager.mjs
```
