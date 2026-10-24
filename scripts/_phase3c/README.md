# Phase 3c - final tightening pass

Narrow, suppression-only pass over the Phase 3b workbook + CEO one-pager before CEO delivery. Six items, all suppression-only except item 5 (bounded row exclusions on two named cells).

**Governing rule:** this pass may SUPPRESS and EXPLAIN. It may not RE-DERIVE. No re-classification, no re-parsing, no threshold tuning, no new derived columns. Every mutation logged.

## Deliverables (land in `~/dev/purchase-discovery-2026-08-12/`)

- `PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx` - 24 sheets (adds Phase 3c Change Log; overwrites 3b)
- `PURCHASE_ONE_PAGER.md` - renamed from `CEO_ONE_PAGER.md`
- `PURCHASE_ANALYSIS_PHASE3.md` - `## Phase 3c change log` appended

## Six items

1. Suppress Duplicate Family spreads where confidence < 70 OR spread > 3x.
2. Print real per-account reconciliation variances (TBR -7.0%, TBJ -0.1%, STL -5.1%) rather than aggregate `<8%`.
3. Suppress ALL STL-FL per-meal cells (meals denominator too weak).
4. Flag category $/lb cells outside per-category IQR-based band.
5. Bounded diagnosis of TBJ pork $/lb and STL seafood $/lb - two cells only. Row-exclude if cause conclusively identified; else suppress. Both conclusively identified; both recomputed.
6. Byte-preserve premium/prefabricated figures; add one neutral line explaining the two axes are independent.

## Pipeline commands

```
cd ~/dev/purchase-discovery-2026-08-12
node scripts_phase3c/05_dump_effective_weights.mjs   # dump AUG rows with rehab-replicated _effective_weight_lb (item 5 diagnosis input)
node scripts_phase3c/10_apply_suppressions.mjs       # produces _analysis3c.json + _change_log.json
node scripts_phase3c/20_build_workbook.mjs           # overwrites PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx
node scripts_phase3c/30_ceo_one_pager.mjs            # writes PURCHASE_ONE_PAGER.md
```

## Notes

- Scripts here are self-contained: `_common3b.mjs` is copied in-directory rather than imported cross-directory.
- Reads `scripts_phase3b/_analysis3b.json` and `scripts_phase3/_augmented.json` as inputs (both live in the working directory outside this repo).
- No DB writes.
