# Phase 4 - protein weight coverage recovery

Read-only pass over Phase 3c. Recovers weight data for protein rows via three paths, then overlays onto Phase 3c workbook.

- **Path A**: cross-account item_number weight borrowing (safest; no external calls)
- **Path B**: Anthropic vision rescan of 11 TBJ-FL bacon invoices Phase 3c excluded
- **Path C**: Anthropic vision rescan of 39 top-unresolved-SKU TBJ-FL invoices

**Hard rules honored:**

- Zero dollar figures changed (dollar-invariance check enforced)
- 35% publication threshold FIXED (cells below stay suppressed)
- Every recovered weight traces to a documented source (donor row, invoice image)
- Category-plausibility sanity gate on every applied borrow / vision read
- Tag on Item Master: `_phase4_recovery_tag` = `catalog_lookup:cross_account` / `invoice_image_verified:pack_size` / `invoice_image_verified:shipped_weight`
- Every recovered row logged in `_recovered_rows.json`; every mutation in `_change_log4.json`

## Pipeline

```
cd ~/dev/purchase-discovery-2026-08-12
node scripts_phase4/00_env_check.mjs
python3 scripts_phase4/00_diagnostic.py
node scripts_phase4/10_diagnostic_and_path_a.mjs
python3 scripts_phase4/01_find_bacon_exclusions.py
node scripts_phase4/20_path_b_fetch_urls.mjs
node scripts_phase4/21_path_b_read_bacon_invoices.mjs
node scripts_phase4/25_path_c_identify_top_unresolved.mjs
node scripts_phase4/26_path_c_read_invoices.mjs
node scripts_phase4/30_apply_recovery.mjs
node scripts_phase4/40_recompute_with_recovery.mjs
node scripts_phase4/50_build_workbook.mjs
node scripts_phase4/60_verify.mjs
```

## Outputs

- `PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx` (overwrites; 25 sheets; adds "Phase 4 Recovery Log" at end)
- `PURCHASE_ONE_PAGER.md` (adds "Phase 4 protein weight recovery" section)
- `PURCHASE_ANALYSIS_PHASE3.md` (adds "Phase 4 recovery log" section)

## STOP conditions

None hit. No DB writes. No re-classification, no threshold tuning, no dollar changes.

## Cost

- Path B: ~$0.21 (11 invoices)
- Path C: ~$0.72 (39 invoices)
- Total: **~$0.93** (Anthropic sonnet-4.5)
