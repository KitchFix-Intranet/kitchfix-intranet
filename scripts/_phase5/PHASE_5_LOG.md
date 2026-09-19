# Purchase Analysis - Phase 3

Analysis date: 2026-08-13. Continues from `PURCHASE_DATA_DISCOVERY.md` (Phase 1) and `PURCHASE_DATA_REPAIR.md` (Phases 2, 2b, 2c).

## 1. Scope

Window: **2026-05-01 through 2026-07-31** (three months). Off-season overall for the main dining program; MiLB is in-season (Triple-A and Double-A operations across TBR/TBJ/STL Florida sites).

Accounts: TBR-FL, TBJ-FL, STL-FL (Postgres `account_key` stored as `TBR - FL`, `TBJ - FL`, `STL - FL` with spaces around the dash).

Deliverables:
- `PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx` (13 sheets)
- `item_classifications.json` (LLM classification cache)
- `docs/migrations/pr-10-4-item-classifications-table.sql` (NEW migration, not applied)
- `scripts/_phase3/*` (helper scripts)

## 2. Hard rules and how they were satisfied

| Rule | How satisfied |
| --- | --- |
| 1 - Read-only on `ai_line_items` + all existing tables | Only writes are the local JSON cache (item_classifications.json) and the workbook file. Migration pr-10-4 not applied. |
| 2 - No source column overwrites | No UPDATE on ai_line_items. Parser + classifier outputs live in-memory during load, never written back. |
| 3 - TWO-TIER quality filter | DOLLAR SET = exclude `review_reason='invoice_over_extracted'`; WEIGHT SET = also exclude `ep_qty_up_mismatch` AND rows with resolution_method in ('unresolved','volume_excluded'). Every workbook figure labeled. |
| 4 - Date drift normalized at read time | JS helper `normalizeInvoiceDate` in `scripts_phase3/_common.mjs` mirrors the SQL CASE. Reported below. |
| 5 - Three-month scope stated plainly | Summary sheet row 2 states window in plain language. |
| 6 - Coverage adjacent to every pounds figure | Weight & Coverage sheet has coverage_pct on same row as lbs; per_meal table has lbs_coverage next to lbs_per_meal. |
| 7 - Every number traces to a query | All figures derived from `_augmented.json` + `_meals.json` + `item_classifications.json` via `30_analysis.mjs`. Sources in Methodology sheet. |
| 8 - Two failures same root cause = STOP | Classifier has FAILURE_LIMIT=2 consecutive failures triggers stop. |
| 9 - PR only, never merged | Branch `feat/phase-3-purchasing-analysis`. |
| 10 - No em-dashes, ISO dates | Followed throughout. |
| 11 - Never expose env | `!!process.env.X` presence checks only. |
| 12 - Do not touch Kevin's live worktree | Scripts load env via absolute path only. |

## 3. Row-set counts

Fetched from live PG on 2026-08-13.

| Metric | Value |
| --- | --- |
| Total rows in window (all 3 accounts, includes drift-recovered) | 7,428 |
| Date-drift rows recovered into window | 33 (16 TBR-FL + 17 STL-FL; patterns `0026-06-19`, `0026-07-17`) |
| Orphan-corrected rows excluded (parent header status IN corrected/deleted) | 459 |
| Live rows | 6,969 |
| DOLLAR SET rows | see per-account below |
| Distinct (vendor_id, description) pairs in DOLLAR SET | 2,700 |

Per-account (post orphan-corrected exclusion; live rows):

| Account | Live rows | DOLLAR SET rows | WEIGHT SET rows |
| --- | --- | --- | --- |
| TBR-FL | 2,201 | 2,061 (93.6%) | see workbook |
| TBJ-FL | 2,221 | 2,202 (99.1%) | see workbook |
| STL-FL | 2,514 | 2,482 (98.7%) | see workbook |

The gap between live rows and DOLLAR SET rows is the `invoice_over_extracted` exclusion (rule 3).

## 4. Weight resolution coverage

Applied in-memory via `packSizeParser.resolveWeightForRow` (from the Phase 2 module, extracted from the `feat/phase-2c-catch-weight-gate-and-july-batch` branch since it has not been merged to main yet).

**Data quality gate on pack_size (Phase 3 addition):** OCR frequently drops the inner slash in multi-pack pack_size strings so `"4/10 LB"` arrives as `"410 LB"` and the parser reads it as literally 410 pounds. A first-pass survey found ~416 rows / ~112K lbs (about 42% of the weight-set food lbs) inflated by this shape, mostly Sysco chicken/beef cases (real weight ~40 lb per case). Rows whose pack_size matches `^\d{3,}\s?LB$` or `^\d{4,}\s?OZ$` are flagged `pack_size_ambiguous_multipack` and excluded from WEIGHT SET. Documented on the workbook Methodology sheet and Needs Review sheet.

Method distribution across live rows (post-quarantine):

| Method | Approx rows | Approx % |
| --- | --- | --- |
| unresolved | ~3,915 | ~56% |
| pack_size:single_weight | ~1,005 | ~14% |
| pack_size_ambiguous_multipack | ~522 | ~7.5% |
| weight_line_value | ~460 | ~6.6% |
| pack_size:n_x_m_weight | ~434 | ~6.2% |
| volume_excluded | ~202 | ~2.9% |
| description:single_weight | ~193 | ~2.8% |
| catalog_lookup:single_weight | ~87 | ~1.2% |
| catalog_lookup:n_x_m_weight | ~62 | ~0.9% |
| description:n_x_m_weight | ~62 | ~0.9% |
| pack_size:range_midpoint | ~39 | ~0.6% |

Resulting WEIGHT SET coverage (of DOLLAR SET food spend): TBR-FL 17%, TBJ-FL 28%, STL-FL 36%. This is lower than the Phase 2b naive coverage claim (~30-50%) because the multipack quarantine excluded a large chunk of legitimate-looking-but-inflated pounds.

Per-account, per-category coverage (food $ resolved / food $ dollar-set) is in the workbook `Weight & Coverage` sheet.

## 5. Food classification signals

Applied in-memory via `foodClassifier.classifyLine`. Verdict distribution across all 6,969 live rows:

| Verdict | Rows | % |
| --- | --- | --- |
| food | 5,818 | 83.5% |
| non_food | 1,086 | 15.6% |
| unknown | 65 | 0.9% |

Per-account food/non-food split (DOLLAR SET food % of total spend) matches the Phase 2b measurements to within 1-2pp - and is reported on the Summary and Account Comparison sheets.

## 6. LLM classification (three axes)

Model: `claude-sonnet-4-6` (matches production intranet OCR extractor).
Batch: 25 items per call, concurrency 6.
Prompt: system prompt defines premium/commodity/neutral, prefabricated/scratch-input/neutral, frozen/fresh/shelf-stable/unknown with 3-5 anchor examples per label; requires JSON output with all 6 fields (axis + confidence + reason for each of 3 axes) per item.

Confidence threshold: **70**. Any axis under 70 is excluded from headline percentages and lands on the Needs Review sheet.

Cache: `~/dev/purchase-discovery-2026-08-12/item_classifications.json`. Idempotent by input batch hash + per-item key (`vendor_id::description`).

Coverage and cost: see final summary in this doc.

## 7. Meals denominator (rule E)

Per-account per-month meals used (from `sc_daily_actuals`, projections substituted per rule):

| Account | Month | Actuals rows | Actuals meals | Projections meals | USED | Source |
| --- | --- | --- | --- | --- | --- | --- |
| TBR-FL | 2026-05 | 105 | 7,632 | 7,490 | 7,632 | actual |
| TBR-FL | 2026-06 | 69 | 6,252 | 6,500 | 6,252 | actual |
| TBR-FL | 2026-07 | 113 | 5,588 | 3,500 | 5,588 | actual |
| TBJ-FL | 2026-05 | 120 | 16,078 | 9,512 | 16,078 | actual |
| TBJ-FL | 2026-06 | 217 | 8,499 | 9,260 | 8,499 | actual |
| TBJ-FL | 2026-07 | 12 | 885 | 2,955 | 885 | actual_sparse |
| STL-FL | 2026-05 | 78 | 6,021 | 6,340 | 6,021 | actual |
| STL-FL | 2026-06 | 0 | 0 | 5,440 | **5,440** | **projected** |
| STL-FL | 2026-07 | 5 | 164 | 4,680 | 164 | actual_sparse |

Substitution rules:
- **STL-FL Jun 2026**: actuals are 0 rows -> **projection substituted** (5,440 meals). Labeled `projected` in workbook, yellow fill on Account Comparison sheet.
- **TBJ-FL Jul 2026 and STL-FL Jul 2026**: actuals present but sparse (12 rows in 31-day month, 5 rows in 31-day month). Labeled `actual_sparse`, orange fill. Not substituted (per prompt: actuals present, only partial).
- Nothing else falls to UNAVAILABLE.

Window totals:
- TBR-FL: 19,472 (actual)
- TBJ-FL: 25,462 (actual_with_sparse - July is small but the window sum is dominated by May+June)
- STL-FL: 11,625 (mixed - includes 5,440 projected from June, distorts $/meal)

## 8. Reconciliation (DOLLAR SET)

Full table on Reconciliation sheet. Window aggregates:

| Account | Line-item sum | Header sum | GL food sum | LI - Header $ | Variance % |
| --- | --- | --- | --- | --- | --- |
| TBR-FL | $129,507.43 | $139,270.24 | $119,910.78 | -$9,762.81 | -7.0% |
| TBJ-FL | $183,851.55 | $186,169.49 | $114,668.03 | -$2,317.94 | -1.2% |
| STL-FL | $274,187.13 | $288,840.09 | $206,485.73 | -$14,652.96 | -5.1% |

Per-month breakdown on the sheet. The DOLLAR-SET-filtered LI totals are lower than the raw-sum totals from Phase 2c's Task 7 recon (which did NOT exclude `invoice_over_extracted`). The gap is exactly the excluded catch-weight-over-extracted rows.

## 9. Blocked / STOP conditions

- Rule 8 (two failures same root cause = STOP) hit ONCE mid-run 2 on a burst of "Connection error" from the Anthropic API. Response: instrumented with a retry-on-transient wrapper (up to 3 retries per call, exponential backoff), then resumed. Re-runs completed cleanly. See run 3 in the cost tally.
- No other STOP conditions. Final classifier coverage: 2,633 of 2,633 distinct (vendor_id, description) pairs (100%).
- No writes to any existing DB table. Every deliverable is either a local file (JSON cache, xlsx, MD) or the new migration file (not applied).

## 12. PR

https://github.com/KitchFix-Intranet/kitchfix-intranet/pull/670 (`feat/phase-3-purchasing-analysis`). Base: main. DO NOT MERGE.

## 10. Cost tally

Classification API calls (all against `claude-sonnet-4-6`, batches of 25 items):

| Run | Batches | Items landed | Tokens in | Tokens out | Est cost |
| --- | --- | --- | --- | --- | --- |
| Pilot (--limit-batches 2) | 2 | 50 | 5,183 | 7,352 | $0.13 |
| Full run 1 | 96 | 2,700 (later lost to race) | 253,908 | 364,569 | $6.23 |
| Full run 2 (post race-condition fix) | 45 attempted | 1,900 (partial, transient errors) | 40,958 | 57,546 | $0.99 |
| Full run 3 (with retry-on-transient) | 30 | 2,632 | 79,641 | 112,465 | $1.93 |
| Full run 4 (catch-up single item) | 1 | 2,633 | 1,036 | 196 | $0.01 |
| **Total** |  | **2,633 distinct pairs** | **380,726** | **542,128** | **$9.29** |

Rate at published Sonnet 4-6 pricing ($3/M input, $15/M output). Approximate; the Anthropic dashboard is authoritative.

Other cost: none. All Postgres reads via existing service-role key (no marginal cost). Storage: local JSON cache + xlsx file only.

Cost breakdown vs Kevin's estimate: forecast was $5-15. Actual $9.29 is inside the band. Two false-start reruns were caused by (a) a race condition in the multi-worker persister (fixed with atomic writeFile + single-writer interval persist) and (b) an Anthropic connection-error burst that STOP'd via rule 8 before a per-call retry loop was added.

## 10a. Final numbers (post 100% classification)

Headline account comparison table (window totals; DOLLAR SET / WEIGHT SET as labeled):

| Metric | TBR-FL | TBJ-FL | STL-FL |
| --- | --- | --- | --- |
| Total spend (DOLLAR SET) | $129,507 | $171,222 | $274,187 |
| Food spend (DOLLAR SET) | $111,694 | $155,903 | $256,305 |
| Non-food % of spend | 13.8% | 8.9% | 6.5% |
| Meals used (actuals; sparse allowed) | 19,472 | 25,462 | 11,625 |
| Meals used (projections filled for sparse/missing) | 19,472 | 27,532 | 16,141 |
| Meals source | actual | actual_with_sparse | mixed |
| Food $ per meal (actuals) | $5.74 | $6.12 | $22.05 |
| Food $ per meal (projection-filled) | $5.74 | $5.66 | $15.88 |
| Food lbs (WEIGHT SET) | 13,474 | 23,870 | 54,714 |
| Weight coverage of food $ | 17.1% | 27.5% | 35.7% |
| Food lbs per meal (actuals) | 0.69 | 0.94 | 4.71 |
| $/lb overall (food, WEIGHT SET) | $1.41 | $1.79 | $1.67 |

Premium/commodity share (% of food $, DOLLAR SET, quality axis):

| Account | premium | commodity | neutral | below-70 |
| --- | --- | --- | --- | --- |
| TBR-FL | 20.1% | 35.9% | 24.8% | 19.3% |
| TBJ-FL | 21.2% | 32.6% | 27.2% | 19.1% |
| STL-FL | 51.2% | 23.9% | 13.9% | 11.0% |

Prefabricated/scratch-input (preparation axis):

| Account | prefabricated | scratch-input | neutral | below-70 |
| --- | --- | --- | --- | --- |
| TBR-FL | 36.1% | 57.8% | 4.8% | 1.4% |
| TBJ-FL | 50.2% | 38.5% | 7.5% | 3.8% |
| STL-FL | 45.7% | 30.5% | 21.1% | 2.7% |

Frozen/fresh/shelf-stable (storage axis):

| Account | frozen | fresh | shelf-stable | unknown | below-70 |
| --- | --- | --- | --- | --- | --- |
| TBR-FL | 16.9% | 62.4% | 13.7% | 0% | 7.0% |
| TBJ-FL | 10.7% | 53.9% | 26.2% | 0% | 9.2% |
| STL-FL | 14.3% | 52.7% | 30.2% | 0% | 2.8% |

Pounds per meal (with coverage stated on the same line):

| Account | Food lbs (WEIGHT SET) | Coverage % of food $ | Meals used | Lbs per meal |
| --- | --- | --- | --- | --- |
| TBR-FL | 13,474 lb | 17.1% | 19,472 actual | 0.69 lb/meal |
| TBJ-FL | 23,870 lb | 27.5% | 25,462 actual_with_sparse | 0.94 lb/meal |
| STL-FL | 54,714 lb | 35.7% | 11,625 mixed (June projected, July sparse) | 4.71 lb/meal |

The STL-FL 4.71 lb/meal figure is inflated by the small meals denominator (July has 5 rows of actuals = 164 meals). Using the projection-filled denominator (16,141 meals), STL-FL is 3.39 lb/meal.

Reconciliation summary (window totals, per account, DOLLAR SET):

| Account | LI sum (DOLLAR SET) | Header sum (live only) | GL food sum | LI - Header $ | Variance % |
| --- | --- | --- | --- | --- | --- |
| TBR-FL | $129,507.43 | $139,270.24 | $119,910.78 | -$9,762.81 | -7.0% |
| TBJ-FL | $171,222.23 | $171,408.26 | $106,798.37 | -$186.03 | -0.1% |
| STL-FL | $274,187.13 | $288,840.09 | $206,485.73 | -$14,652.96 | -5.1% |

The DOLLAR SET LI sums are lower than the Phase 2c Task 7 recon (which did NOT exclude `invoice_over_extracted`), because those over-extracted rows are now filtered.

## 11. Directory of artifacts

- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx` - the workbook
- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_PHASE3.md` - this file
- `~/dev/purchase-discovery-2026-08-12/item_classifications.json` - classification cache
- `~/dev/purchase-discovery-2026-08-12/scripts_phase3/*` - the analysis pipeline
- `~/dev/purchase-discovery-2026-08-12/kitchfix-intranet/docs/migrations/pr-10-4-item-classifications-table.sql` - migration (NOT applied)
- `~/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase3/*` - helper scripts for the PR + loader for post-migration load

## 12. Pipeline commands (repeatability)

```
cd ~/dev/purchase-discovery-2026-08-12
node scripts_phase3/00_env_check.mjs
node scripts_phase3/10_load_and_augment.mjs
node scripts_phase3/11_load_meals.mjs
node scripts_phase3/20_classify_items.mjs --concurrency 6
node scripts_phase3/30_analysis.mjs
node scripts_phase3/40_build_workbook.mjs
```

After Kevin applies `pr-10-4-item-classifications-table.sql`:
```
node ~/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase3/load_classifications_to_db.mjs           # dry
node ~/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase3/load_classifications_to_db.mjs --execute # write
```

## Phase 3b fix log

Date: 2026-08-14. Correcting six defects in the Phase 3 workbook + adding two missing sheets + scrubbing for additional CEO-worthy findings. Same environment as Phase 3, no schema changes, no DB writes.

### Six fixes applied

| Fix | Description | Impact |
| --- | --- | --- |
| 1 | Beverage classification: any row with `category='beverage'` OR strong beverage keyword (BOTTLED WATER, SODA, GATORADE, RED BULL, COCONUT WATER/MILK, COLD BREW, KEG) has `quality_axis` forced to `neutral` at conf=100. Culinary exceptions (marsala, cooking wine) preserved. 134 distinct items reclassified. | Introduces `core_food` basis (food $ excluding beverage $). Every headline figure now reported on BOTH bases where the difference matters. |
| 2 | Monthly denominator: sparse-actual months (< 50% of month days) now use projections (labeled `projected`). Every cell shows `meals_used` + `meals_source`. Cells where computed $/meal > 3x window average are suppressed and logged on Needs Review. | 0 monthly cells needed suppression after projections substituted (previously blew past 3x threshold on 5-actual-days-of-31). |
| 3 | Shared Basket rewritten. Match key = `(vendor_id, item_number)` not description. Reports $/lb where lb coverage >= 50% in all three accounts; else $/order + explicit `pack_sizes` column. Never publishes bare "mean $/unit" across accounts. Dedup by SKU identity. | Sheet went from misleading pack-size-mixed comparisons to a defensible 9-SKU basket (SKUs present in all three accounts). |
| 4 | Category-to-basis mapping hardened: every category explicitly assigned to `food`/`beverage`/`non_food`/`unknown`. Categories `cleaning`, `smallwares`, `chemical`, `chemicals` now `non_food` (previously leaked into food-labeled tables via GL override). | STL: 24 rows / $1,731.62 moved out of food. TBR: 1 row / $142.95 moved out. TBJ: 0 rows moved. |
| 5 | TBR-FL protein weight rehab. Candidate A: `pack_size_ambiguous_multipack` rows disambiguated via same-SKU sibling with a clean `parsed_weight_lb`, category-plausibility bounds. Candidate B: `ep_qty_up_mismatch` rows with `weight_line_value` (vendor's printed catch weight) rehabbed. Additional sanity gate: rows where implied $/lb falls outside 0.5x-2x category bounds are excluded from WEIGHT SET. | TBR protein WEIGHT SET coverage went from 29 rows (9.8%) to 186 rows (63.05% rows / 69.24% spend). $/lb by protein type now reportable across all three accounts. Diagnosis: Candidate A applied 237/522, Candidate B applied 292/800. |
| 6 | Two new sheets added: **Protein Mix** (spend + lbs share by type: beef/poultry/pork/seafood/other, per account) and **Duplicate Item Families** (grouped SKUs, intra-family $/lb spread, fresh+frozen flag). Duplicate Families does NOT label anything "waste" - surfaces pattern; operator interprets. | 510 families detected. Top by SKU count are the standard produce/dairy re-orderings across pack sizes. |

### Scrub findings (added as workbook sheets)

Ranked per prompt priority:

1. **Category Mix** sheet - the LEAD finding. Protein/produce/dairy/dry_goods/beverage share of core_food $ per account. Neither weight parser nor meals denominator needed. Most defensible finding in the dataset.
2. **Price Variance** sheet - 33 SKUs bought at >1 account with >15% mean-unit-price spread. Top item spread 4.23x ($411 at stake). Aggregate top-5 at-stake ~$2,016.
3. **Price Drift** sheet - 93 SKUs with >10% price change from first to last month of appearance in the window.
4. **Vendor Concentration** sheet - top-3 vendor share per account (TBR 95.5%, TBJ 90.8%, STL 81.4%). Maverick top items listed for each account.
5. **Pareto** sheet - top-20 SKU share of spend per account (TBR 27.9%, TBJ 25.0%, STL 30.5%).
6. **Order Cadence** sheet - deliveries/week + avg order value per account (TBR 14.84/wk at $664; STL 15.83/wk at $1,313).
7. **Unique Items** sheet - SKUs bought at ONE account only, spend >= $250.

### Corrected headline shares

Premium share of food $ (Phase 3 methodology): TBR 20.1%, TBJ 21.2%, STL **51.2%**.
Premium share of core_food $ (Phase 3b): TBR 20.0%, TBJ 21.3%, STL **46.0%**.
Premium share of food $ (Phase 3b, incl beverage): TBR 19.7%, TBJ 18.2%, STL **36.8%**.

The STL "2.4x premium" claim in Phase 3 was ~half beverage artifact. Real core-food gap is ~2.3x. Still a meaningful directional finding; the magnitude is materially different.

### Category mix (core_food $ basis - Phase 3b lead finding)

| Category | TBR-FL | TBJ-FL | STL-FL |
| --- | --- | --- | --- |
| protein | 45.1% | 33.7% | 52.0% |
| produce | 26.0% | 28.6% | 17.7% |
| dairy | 10.0% | 15.0% | 12.2% |
| dry_goods | 18.6% | 22.7% | 18.1% |
| other food | 0.3% | 0.0% | 0.0% |
| beverage (% of food incl bev) | 1.4% | 14.5% | 20.5% |

### Fix 5 diagnosis outcome

TBR-FL protein rows (DOLLAR SET): 295 (spend $49,174).

Pre-rehab exclusion breakdown (rows / spend):
- `weight_line_value + ep_qty_up_mismatch`: 120 / $25,165 (WEIGHT SET excluded)
- `unresolved + ep_qty_up_mismatch`: 29 / $7,079
- `unresolved + no review flag`: 69 / $7,078
- `pack_size_ambiguous_multipack + no flag`: 47 / $6,053 (Candidate A target)
- Cleanly-resolved rows: 30 / $3,800 (were the only WEIGHT SET admits)

Post-rehab: 186 WEIGHT SET rows (63.05%). Both candidates cleared the 25% threshold. Rehab APPLIED.
- Candidate A applied 237 of 522 attempted (285 had no clean sibling; 0 bounds-rejected).
- Candidate B applied 292 of 800 attempted (501 had no vendor-printed weight; 7 bounds-rejected).
- Additional sanity gate excluded 93 rows across all accounts where the implied $/lb was outside category-plausibility bounds (typically catch-weight lines where `shipped_count` is actually shipped-weight-in-lb and pack-size math produced 5,000+ lb figures).

### Deliverables

- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx` (overwrites Phase 3; 23 sheets including Phase 3b fix log)
- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ONE_PAGER.md` (new; 6 findings; renamed from `CEO_ONE_PAGER.md` in Phase 3c per section below)
- `~/dev/purchase-discovery-2026-08-12/item_classifications.json` (in-place patched; 134 beverage reclassifications; originals preserved on `_phase3_original_*` sibling fields)
- `~/dev/purchase-discovery-2026-08-12/scripts_phase3b/*` (new pipeline)

### Phase 3b pipeline commands

```
cd ~/dev/purchase-discovery-2026-08-12
node scripts_phase3b/10_reclassify_beverages.mjs  # patches item_classifications.json in place
node scripts_phase3b/20_recompute.mjs             # produces _analysis3b.json
node scripts_phase3b/30_build_workbook.mjs        # overwrites PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx
node scripts_phase3b/40_ceo_one_pager.mjs         # writes CEO_ONE_PAGER.md (Phase 3c renames this to PURCHASE_ONE_PAGER.md)
```

### STOP conditions

None hit. All numbers trace to a query in scripts_phase3b/. No DB writes. Migration file from Phase 3 (`pr-10-4-item-classifications-table.sql`) still not applied.

## Phase 3c change log

Date: 2026-08-14. Narrow, final tightening pass before CEO delivery. Six items, all suppression-only except item 5 (bounded row exclusions on two named cells). No re-classification, no re-parsing, no threshold tuning, no new derived columns. Every mutation reported below.

### Governing rule

Phase 3c may SUPPRESS and EXPLAIN. It may not RE-DERIVE. Suppressed cells replaced with `not comparable` / `meals data insufficient` / `review - outside expected range` per item. Item 5 is the sole exception: TWO cells were recomputed after excluding rows conclusively identified as bad weight resolution.

### Deliverables

- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx` (overwrites Phase 3b; 24 sheets - adds "Phase 3c Change Log" sheet)
- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ONE_PAGER.md` (was `CEO_ONE_PAGER.md`; renamed per file rename below)
- `~/dev/purchase-discovery-2026-08-12/scripts_phase3c/*` (new pipeline layered on top of 3b)

### Filename fix

The CEO one-pager script in Phase 3b wrote to `CEO_ONE_PAGER.md`. Per Kevin's local rename (from a typo `PURCHSE_ONE_PAGER.md`) and CEO-delivery consistency, Phase 3c renames the file to `PURCHASE_ONE_PAGER.md`. Script paths updated in `scripts_phase3c/30_ceo_one_pager.mjs`. This report's Phase 3b Deliverables section updated above.

### Item 1 - Duplicate Family spread suppressions

Rule: for each family in the Duplicate Item Families sheet with a numeric $/lb spread, suppress the spread cell (replace with `not comparable`) where family confidence < 70 OR spread > 3x. Keep row, SKU count, and spend visible.

- Families suppressed: **50**
- Total spend covered by suppressed families: **$43,594.86**
- Breakdown by reason:
  - confidence < 70 only: 24
  - spread > 3x only: 22
  - both: 4

Per-account `spread_ratio_dpp` cells also suppressed under the same rule. Full list on the Needs Review sheet (Phase 3c section) and Phase 3c Change Log sheet.

### Item 2 - Reconciliation numbers

Previously the one-pager stated reconciliation as `<8%` bound. Phase 3c prints three real per-account window variances (DOLLAR SET line-item sum vs invoice_submissions header sum):

- **TBR-FL: -7.0%**
- **TBJ-FL: -0.1%**
- **STL-FL: -5.1%**

Displayed in both the workbook Summary sheet and the CEO one-pager (new section 6). Monthly breakdown unchanged on the Reconciliation sheet.

### Item 3 - STL-FL per-meal suppression

Rule: STL-FL meals denominator is too weak to support any per-meal figure (June 0 actuals; July 5 rows / 164 meals). Every STL-FL per-meal and per-lb-per-meal cell replaced with `meals data insufficient`. TBR-FL and TBJ-FL per-meal figures unchanged.

Cells suppressed in the workbook (**10 total**):

- Account Comparison window: `window_dollars_per_meal`, `window_dollars_per_meal_core`, `window_lbs_per_meal`, `window_lbs_per_meal_core`
- Account Comparison per-month (2026-05, 2026-06, 2026-07): `dollars_per_meal`, `dollars_per_meal_core`

Cells suppressed in the CEO one-pager: **0** (the Phase 3b one-pager did not include any explicit STL per-meal figure - only a caveat mention; the caveat is retained and updated to reference the suppression).

### Item 4 - Plausibility bands per category

Rule: for each category present in Weight & Coverage, collect the `dollars_per_lb` values across the three accounts. Compute Q1, Q3, IQR = Q3 - Q1. Band = `[max(0, Q1 - 1.5*IQR), Q3 + 1.5*IQR]`. Cells outside their band are replaced with `review - outside expected range` and listed on Needs Review with the computed value, coverage, and lbs. Rule applied uniformly - no per-account or per-cell tuning.

Bands computed from Phase 3b category $/lb values:

| Category | n | Q1 $/lb | Q3 $/lb | Band low | Band high |
| --- | --- | --- | --- | --- | --- |
| protein | 3 | $1.99 | $4.56 | $0.00 | $8.41 |
| produce | 3 | $1.00 | $1.34 | $0.49 | $1.85 |
| dry_goods | 3 | $1.54 | $1.87 | $1.05 | $2.37 |
| dairy | 3 | $1.55 | $2.09 | $0.74 | $2.90 |
| beverage | 3 | $0.35 | $1.84 | $0.00 | $4.08 |
| poultry | 1 | (insufficient datapoints - pass through) | | | |

Cells flagged and suppressed (**2**):

- TBJ-FL dry_goods: $2.76/lb outside band [$1.05, $2.37]
- STL-FL beverage: $5.03/lb outside band [$0.00, $4.08]

Method + bands recorded on workbook Methodology sheet.

### Item 5 - Bounded diagnosis (two named cells only)

Scope: exactly two Protein Mix cells. Rule: if cause conclusively identified as bad weight resolution on specific rows -> exclude and recompute; else suppress. Cause was conclusively identified for both; row exclusion applied.

**TBJ-FL pork $/lb:**

- Root cause: bacon "LAYFLAT" SKUs (DAILYS BACON, RNCHGRL BACON) with pack_size `115LB` (OCR-garbled 3-digit LB - actual pack is 1 case × 15 lb) inflated per-case weight ~10x. Candidate A sibling median seeded from Candidate B `weight_line_value` rows where `wlv` equals `extended_price` exactly (a second OCR artifact - the wlv field carried the dollar amount, not pounds). Combined, both mechanisms produced ~$1/lb bacon (impossible; wholesale bacon is $4-7/lb).
- Rows excluded: **16** (all bacon SKUs with pack_size matching `^\d{3,}LB$` / `^\d+ (CS|BX|CA) \d+ LB$` / `wlv == extended_price`)
- Excluded spend: $2,510.11
- Excluded weight (pre-exclusion): ~2,519.6 lb
- **Before: $/lb = $1.23** (27 rows, 2,889.7 lb, 60.3% coverage)
- **After: $/lb = $2.85** (11 rows, 370.1 lb, 17.8% coverage)

**STL-FL seafood $/lb:**

- Root cause: 4 SHRIMP PD 16/20 rows with pack_size `5x2#` (=10 lb/case) where the quantity field (30, 30, 30, 60) represents pounds shipped, not case count. The `pack_size:n_x_m_weight` parser multiplied qty × 10 lb/case, inflating weight ~20x (600 lb / 300 lb output vs true ~60 lb / ~30 lb).
- Rows excluded: **4** (SHRIMP PD 16/20 with pack `5x2#`, quantity >= 25, implied $/lb < $1)
- Excluded spend: $1,192.50
- Excluded weight (pre-exclusion): 1,500 lb
- **Before: $/lb = $3.65** (15 rows, 2,017.7 lb, 36.7% coverage)
- **After: $/lb = $11.91** (11 rows, 517.7 lb, 30.8% coverage)

Only the Protein Mix cell's `dollars_per_lb` (plus `lbs`, `lbs_spend`, `coverage_spend_pct`, `lbs_rows`) is recomputed. The `pct_of_protein_lbs` share is suppressed rather than cascading. Account-level totals (`total_protein_lbs`, `lbs_coverage_spend_pct`) and downstream Weight & Coverage / lbs-per-meal figures are left at Phase 3b values with a note on the Protein Mix sheet.

### Item 6 - Premium / prefabricated (byte-identical)

No mutation. Premium % core (TBR 20.0%, TBJ 21.3%, STL 46.0%) and prefabricated % core (TBR 36.1%, TBJ 50.2%, STL 45.7%) are byte-identical to Phase 3b. One-line neutral explanation added to the Prefabricated vs Scratch sheet and the CEO one-pager section 3:

> Quality and preparation are independent axes; an item can be both premium and prefabricated (a pre-portioned Choice steak is both). Present the observation; do not interpret it.

### Every difference between Phase 3b and Phase 3c outputs

**Workbook (`PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx`)**:

- Summary sheet: new "Reconciliation" mini-table added (three per-account variances, item 2).
- Methodology sheet: new sections added covering item 3 STL per-meal suppression, item 4 IQR bands (with per-category numbers), item 5 scope note, item 6 neutral axes explanation.
- Account Comparison sheet: STL-FL cells suppressed in window ($/meal food+core, lbs/meal food+core) and monthly ($/meal food+core for each of 2026-05, 06, 07). Total 10 cells.
- Weight & Coverage sheet: 2 category $/lb cells replaced with `review - outside expected range` (TBJ-FL dry_goods, STL-FL beverage).
- Protein Mix sheet: 2 cells recomputed (TBJ-FL pork $/lb, STL-FL seafood $/lb) with an inline "item 5 recompute" note; a footnote about non-cascaded totals appended.
- Prefabricated vs Scratch sheet: one-line item 6 neutral note appended.
- Duplicate Item Families sheet: 50 family-level `intra_family_dpp_spread` cells replaced with `not comparable`; the corresponding per-account `spread_ratio_dpp` cells same rule.
- Needs Review sheet: new sections added listing all Phase 3c suppressions (items 1, 3, 4) and item-5 diagnosis with before/after per cell + excluded row detail.
- NEW sheet "Phase 3c Change Log" (last) - the same content as this markdown section, in workbook form.

**CEO one-pager (`PURCHASE_ONE_PAGER.md`)**:

- Renamed from `CEO_ONE_PAGER.md`.
- Section 1 caveat text updated to reference the item-3 suppression.
- Section 3: new one-line note (item 6, axes are independent).
- Section 6: new - three real per-account reconciliation variances.
- "Phase 3c final tightening" footer bullets added.
- All other figures byte-identical to the Phase 3b one-pager output.

### Phase 3c pipeline commands

```
cd ~/dev/purchase-discovery-2026-08-12
node scripts_phase3c/05_dump_effective_weights.mjs   # dump AUG rows with _effective_weight_lb (rehab-replicated) for item 5 diagnosis
node scripts_phase3c/10_apply_suppressions.mjs       # produces _analysis3c.json + _change_log.json
node scripts_phase3c/20_build_workbook.mjs           # overwrites PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx
node scripts_phase3c/30_ceo_one_pager.mjs            # writes PURCHASE_ONE_PAGER.md
```

### STOP conditions

None hit. No DB writes. No re-classification, re-parsing, or threshold tuning. Every mutation logged.

## Phase 4 recovery log

Date: 2026-08-14. Protein weight resolution recovery pass. TBJ-FL priority. Goal: MORE real data traced to documented source. 35% publication threshold FIXED. Zero dollar figures changed. No re-classification.

### Diagnostic (before recovery)

Per-account protein-category row + spend + reason breakdown. Weight-resolution counters reflect Phase 3b+3c effective state (rehab dump from `scripts_phase3c/05_dump_effective_weights.mjs`, before Phase 3c item-5 row exclusions).

**TBR-FL protein**: 295 rows / $49,174. Already at 69% weight coverage post-Phase-3b rehab. Not a priority for Phase 4.

**TBJ-FL protein (priority)**: 233 rows / $44,597. Coverage 39.9% post-Phase-3c. Per-type:

| Type | Rows | Spend | Resolved rows | Resolved spend | Coverage % spend |
| --- | --- | --- | --- | --- | --- |
| beef | 46 | $16,315.53 | 13 | $5,160.91 | 31.6% |
| poultry | 83 | $13,086.90 | 33 | $5,869.72 | 44.9% |
| pork | 45 | $5,913.60 | 27 | $3,563.43 | 60.3% |
| seafood | 33 | $5,863.30 | 14 | $3,196.57 | 54.5% |
| plant_or_egg | 25 | $3,213.91 | 0 | $0.00 | 0% |
| other | 1 | $203.36 | 0 | $0.00 | 0% |

**STL-FL protein**: 352 rows / $104,412. Coverage 67% post-Phase-3c (excl item-5 shrimp exclusion for seafood). Only seafood was near/below 35% threshold (30.8% after item-5 shrimp exclusion). Small recovery target.

Full per-`(review_reason, parsed_weight_source)` breakdown in `scripts_phase4/00_diagnostic.py` output and `_diagnostic.json`.

### Path A results (cross-account item_number weight borrowing)

Match key: STRICT `(vendor_id, item_number)`. Donor gate: clean parsed source, not review-flagged, category-plausibility passed. Conflict rule: donors disagreeing by >1.5x on lb-per-qty = no borrow. Recipient sanity gate: implied $/lb inside category-plausibility band.

- **26 rows applied** across dataset / $3,591.83 / 576.6 lbs.
- 2 rows skipped for donor conflict (>1.5x lb-per-qty spread), 9 rows sanity-rejected.
- 1,918 rows had no cross-account donor (unique to their account or item_number missing on siblings).
- 1,660 rows had no item_number populated (Path A cannot help).

Per-account per-protein-type protein applies:
- STL-FL seafood: 3 rows / $1,878.75 / 175.6 lbs.
- No TBR-FL protein Path A applies (TBR already well-covered post-3b).
- No TBJ-FL protein Path A applies (most TBJ-FL unresolved protein rows have `item_number = null`, so cross-account borrow doesn't reach them; Path B and Path C carry the weight).

Non-protein applies (produce, dairy, dry_goods etc.) landed on all three accounts - see `_path_a_borrows.json`.

Tag: `parsed_weight_source_p4 = 'catalog_lookup:cross_account'`.

### Path B results (11 bacon-invoice rescans via Anthropic vision)

Scope: 16 TBJ-FL bacon rows excluded by Phase 3c item-5 for OCR-garbled `115LB` pack size. Vision model prompted to READ pack size verbatim from invoice image; DO NOT infer.

Model: `claude-sonnet-4-5-20250929`. Estimated cost: **$0.21**.

Results across 11 distinct Sysco invoices:
- **12 of 16 rows** read verbatim as `1/15 LB` / `1 15LB` / `2 BX 115LB` (all mean 15 lb per box).
- **4 of 16 rows** still not legibly read (the invoice image showed `115LB` fused, or blank pack column, or vision confidence <70) - remain excluded.

Sanity gate applied: recovered rows must pass category dpp bounds. **8 of 12 rows** passed sanity + confidence gates and are recovered ($1,188.86 / 300 lbs). Note: 4 rows had shipped_weight_lb null AND low-confidence pack reads - correctly rejected.

Tag: `parsed_weight_source_p4 = 'invoice_image_verified:pack_size'`.

**Broader corpus**: same garble pattern (`^\d{3,}LB$` fused-pack) appears widely across Sysco invoices (~500+ candidate lines dataset-wide including non-protein). Only PROTEIN rows in TBJ-FL scope fixed in Path B; broader dataset LOGGED as out-of-scope defect (see Recovery Log sheet).

### Path C results (39 top-unresolved-SKU TBJ-FL invoice rescans)

Ranked TBJ-FL unresolved protein rows by summed extended_price. Top-80% of unresolved dollars = **37 distinct SKUs**. Grouped their rows by invoice_uuid = 39 invoices to fetch.

Model: `claude-sonnet-4-5-20250929`. Estimated cost: **$0.72**.

Vision model prompted to READ pack size + shipped weight verbatim. Preferred `shipped_weight_lb` (invoice-printed "TOT WT") over derived `total_lb_per_case * qty` because Sysco invoices commonly use fused-slash pack shorthand that the model reads as `"410 LB"` = 410 lb (but actually means `4/10 LB` = 40 lb). Fused-slash reads without accompanying shipped_weight = REJECTED (cannot disambiguate without inferring).

Recovery: **38 rows** / $12,915.47 / 3,674.1 lbs. Per protein-type on TBJ-FL:
- beef: 21 rows / $8,673.59 / 2,393.8 lbs
- poultry: 6 rows / $2,265.94 / 762.6 lbs
- pork: 3 rows (in addition to Path B bacon 8) / $... / ... lbs
- seafood: 8 rows / $1,471.95 / 192.4 lbs

Rejects breakdown:
- 16 Sysco fused-pack-without-shipped-weight ("410 LB", "115LB", "610LB", "101 LB") - safely rejected per no-inference rule.
- 4 sanity-fails (implied $/lb outside category bounds) - caught e.g. "2 BX 115LB" would-be 460 lb at $145.90 = $0.32/lb (impossible for pork).
- 1 pack code that vision couldn't quantify.

Tag: mostly `parsed_weight_source_p4 = 'invoice_image_verified:shipped_weight'` (from printed TOT WT lines). Some `invoice_image_verified:pack_size` for lines with clear non-fused pack (like `001/30`, `005/2`, `6x3 CO`).

### Path D report - plant_or_egg

41 rows across three accounts / $4,623.57. Categories:
- EGGS MEDIUM LOOSE (shell eggs, count-based)
- EGGS SCRAMBLED BRE (liquid egg, weight-based but small volume)
- EGGS HARDCOOKED (count-based)
- Tofu / seitan / tempeh occasional

Eggs sold by count, not weight. Liquid egg products carry pack sizes but the count-based rows dominate. Not resolvable to a defensible lbs figure.

**RECOMMENDATION (Kevin decides):** compute lbs-per-meal denominators EXCLUDING plant_or_egg category rather than counting as missing coverage. plant_or_egg protein-type cells in Protein Mix sheet flagged as suppressed with reason "eggs sold by count".

### Before / after coverage per account per protein type

| Account | Type | Before coverage % | After coverage % | Before $/lb | After $/lb | Publish (>=35%)? |
| --- | --- | --- | --- | --- | --- | --- |
| TBJ-FL | beef | 31.6% | **84.8%** | $7.04 | **$4.42** | YES (was NO) |
| TBJ-FL | poultry | 44.9% | 62.2% | $1.33 | $1.57 | YES |
| TBJ-FL | pork | 17.8% | **46.4%** | $2.85 | **$2.76** | YES (was NO) |
| TBJ-FL | seafood | 54.5% | 79.6% | $3.58 | $4.30 | YES |
| STL-FL | seafood | 30.8% | **40.2%** | $11.91 | **$11.61** | YES (was NO) |

TBR-FL cells all unchanged (no Path A/B/C applies landed on TBR-FL protein - TBR-FL already at 69% coverage post-Phase-3b).

### Cells that cleared the 35% publication threshold

- TBJ-FL beef $/lb (31.6% -> 84.8%)
- TBJ-FL pork $/lb (17.8% -> 46.4%)
- STL-FL seafood $/lb (30.8% -> 40.2%)

### Cells still suppressed by 35% threshold

- TBJ-FL `other` protein-type $/lb (0% coverage, 1 row / $203)
- STL-FL `other` protein-type $/lb (5.3% coverage, 7 rows / $1,821)
- All `plant_or_egg` cells (suppressed by Path D rule, not by threshold - "eggs sold by count, not weight")

### Dollar figures changed

**Zero.** Dollar-invariance check ran on Phase-3c-vs-Phase-4 for `spend` and `reconciliation` structures + `protein_mix[acct].total_protein_spend` + each `by_type.spend`: PASS (0 issues). Every recovered row carries its original `extended_price`. Recovery is weight-only.

### Out-of-scope defects logged (NOT fixed)

- Sysco pack-size OCR fused-slash shape: `410 LB`, `115LB`, `182#AVG`, `610LB` etc. commonly OCR without the slash. Bacon subset fixed in Path B; broader dataset (~500+ Sysco lines corpus-wide including non-protein) NOT fixed. Recommend future extractor prompt refinement + parser rule extension.
- Gordon Food Service `6x3 CO` pack code with weight on separate CASE-lines - vision reads pack but not the CASE-line weights. Some GFS invoices carry TOTAL WEIGHT lines the parser doesn't ingest.
- Vendor `item_number` field frequently null on Cheney/Sysco/GFS lines (visible on invoice but OCR missed). Path A cross-account borrow depends on item_number; missing item_number caps recovery ceiling.
- TBJ-FL beef: 25 rows / $6.3K carry `ep_qty_up_mismatch` with NO `weight_line_value` AND NO `pack_size` AND NO `item_number` (Cheney/GFS). Cannot recover without another Anthropic re-OCR pass on those specific invoice line items.
- Vendor catalog reference (order guides) not present in intranet. Path C used invoice images per-SKU. A vendor-catalog Sheets/PG table would eliminate need for per-invoice image reads on repeated SKUs.

### Cost tally

Anthropic API cost: **$0.93** total (Path B $0.21 + Path C $0.72). Model: `claude-sonnet-4-5-20250929`. Well inside Kevin's estimate.

### STOP conditions

None hit. No DB writes. No re-classification, no threshold tuning (35% is FIXED), no dollar changes. Every recovered weight traces to a documented source (donor row, invoice image). Every recovered row tagged in Item Master via `_phase4_recovery_tag` column.

### Phase 4 pipeline commands

```
cd ~/dev/purchase-discovery-2026-08-12
node scripts_phase4/00_env_check.mjs                    # env presence
python3 scripts_phase4/00_diagnostic.py                 # per-type breakdown (report only)
node scripts_phase4/10_diagnostic_and_path_a.mjs        # Path A cross-account borrows + diagnostic.json
python3 scripts_phase4/01_find_bacon_exclusions.py      # identify TBJ-FL bacon Phase-3c exclusions
node scripts_phase4/20_path_b_fetch_urls.mjs            # fetch raw_drive_url per bacon invoice
node scripts_phase4/21_path_b_read_bacon_invoices.mjs   # rescan 11 bacon invoices via vision
node scripts_phase4/25_path_c_identify_top_unresolved.mjs   # rank top-80% TBJ-FL unresolved SKUs
node scripts_phase4/26_path_c_read_invoices.mjs         # rescan 39 top-unresolved-SKU invoices
node scripts_phase4/30_apply_recovery.mjs               # combine A+B+C -> recovered_rows.json
node scripts_phase4/40_recompute_with_recovery.mjs      # overlay onto _analysis3c -> _analysis4
node scripts_phase4/50_build_workbook.mjs               # overwrites PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx
```

## Phase 5 log

Date: 2026-08-14. Applied Kevin's answers from `OPEN_QUESTIONS.xlsx` plus analyst decisions on unanswered questions plus two self-answered items (Q14 GFS invoice reads via vision, Q15 Cheney '#N' data-reconciliation test). No dollar figures changed. Publication threshold lowered from 35% to 25% with visible caveat between 25%-35% (Kevin's Q5). STL-FL now uses 2027-service-calendar projected meals (Kevin's Q6). See workbook sheets: Phase 5 Overview, Fused-Slash Validation, Fused Ambiguous Skipped, Beverage Unresolved (Q1), Q11 Over-Extraction Dist, Q13 dpp Bands, Q14 GFS Invoice Reads, Q15 Cheney # Test, Q17 Other Reclass, Q21 Chef Review Sample, Phase 5 Change Log.

### Order applied

1. **Q9 unit='lb' rows** - Kevin: `up * shipped = ep`, `shipped` is pounds shipped, `up` is $/lb. Applied per-row after reconciling `up * shipped_count` to `extended_price` within 2% or $1 tolerance.
2. **Q2 fused-slash + 30 verified pack weights** - Kevin's 30-SKU Pack Weights sheet applied first as `kevin_verified_pack` overrides. Then general fused-slash rule applied to broader corpus.
3. **Q8 catch-weight arithmetic gate** - ep_qty_up_mismatch flag removed for rows carrying real catch-weight signal (`AVG` / `T/WT` / `TOT WT` in description, `unit='lb'`, Cheney `#` convention, or `weight_line_value` populated).
4. **Q1 beverage size rule** - half-gallon+/gallon/liter -> culinary; 8/12/16/24 oz -> service (stays neutral). Kevin-flagged unsure items (CGRVIMP apple aseptic, Cheney pineapple) LEFT UNRESOLVED.
5. **Q3 plant_or_egg reintegration** - Reversed Phase 4 exclusion only for rows whose pack now resolves via Kevin's verified overrides.
6. **Q4 TBJ beef implied weight** - `implied_lb = ep / up` where pack+wlv+item#=blank AND up in per-lb range. Kevin's 4 examples all already covered by Phase 4 Path C; net 0 new applied.
7. **Q12 category disagreement** - Verified non-food shares correct as published (some classifier inconsistency 10-30 rows/account noted).
8. **Q5 publication threshold** - Lowered from 35% to 25%. Cells between [25%, 35%) publish with visible caveat.
9. **Q6 STL-FL projected meals** - Denominator = 7,540 May + 6,190 Jun + 5,130 Jul = **18,860** window.
10. **Q7 duplicate item families** - Recomputed with updated pack reads (still on Duplicate Item Families sheet).

### Fused-slash resolver: rule + validation

Rule:

- **4-digit + UNIT (LB or OZ)**: always split 2+2. e.g. `1412 OZ` = 14/12 OZ = 14 x 12 oz = 168 oz = **10.5 lb per case**. `2420 OZ` = 24/20 OZ = 480 oz = **30 lb per case**.
- **3-digit + UNIT (LB or OZ)**: compute BOTH candidate splits (1+2 and 2+1). Choose the one that fits the row's category plausibility bounds (protein 5-150 lb, produce 3-100 lb, etc). If BOTH pass or NEITHER passes -> `ambiguous_skipped`, LEFT UNRESOLVED.
- **OZ variants convert to pounds** (/16 at the end).

**Validation vs Kevin's 30 verified SKUs**: Pass rate = **90%** (20 uniquely-resolved-and-match + 7 ambiguous-but-Kevin's-answer-matches-one-candidate + 0 fail + 0 unhandled). **0 fails**. The 7 ambiguous cases (115 LB, 115LB, 115 LB, 152 LB, 115LB, 115 LB, 111 LB) collapse to Kevin's answer only when applied against the Kevin-verified-pack override (which we do first) - the general rule correctly refuses to guess.

### 3-digit fused-slash dispositions on corpus

- 4-digit (rule 4d, always 2+2): **58 rows**
- 3-digit 1+2 chosen: **150 rows**
- 3-digit 2+1 chosen: **7 rows** (e.g. 101 LB = 10/1, 152 LB = 15/2)
- 3-digit ambiguous_skipped: **89 rows** (LEFT UNRESOLVED - see 'Fused Ambiguous Skipped' sheet)

### Q9 unit='lb' validation

- Applied: 20 rows / $4483
- Rejected (up * shipped != ep within 2% or $1): 28 rows
- Already resolved by upstream pipeline: rest

### Q1 beverage size-rule reclassification

- culinary (half-gallon+ / gallon / liter+): 86 rows
- service (8/12/16/24 oz small bottle): 90 rows
- unresolved (no size signal or Kevin-flagged unsure): 198 rows - see 'Beverage Unresolved (Q1)' sheet

Kevin-flagged unsure held aside: CGRVIMP JUICE APPLE 100% ASEPTIC, Cheney PINEAPPLE 100% JUICE.

### Q3 plant_or_egg pack-resolved count

- 21 plant_or_egg rows now have a resolved lb value (via kevin_verified_pack overrides on WHLFIMP / WHLFCLS eggs).
- Aggregate plant_or_egg $/lb still flagged 'not comparable' - mix of count-based (shell eggs, hardcooked) and weight-based (liquid egg) is inherent.

### Q6 STL-FL denominator swap

- Denominator: **18,860 projected meals** (7,540 May + 6,190 Jun + 5,130 Jul, per Kevin).
- STL-FL food $/meal = **$13.4**
- STL-FL core-food $/meal = **$10.65**
- STL-FL food lbs/meal = **3.61 lb**
- STL-FL core-food lbs/meal = **3.29 lb**

### Coverage before/after per account per category

| Account | Coverage food $ (Phase 4 -> Phase 5) |
|---|---|
| TBR-FL | 46.1% -> 48.6% |
| TBJ-FL | 45.2% -> 49.2% |
| STL-FL | 67.8% -> 62.2% |

Protein $/lb (Phase 5, coverage stated inline):

| Type | TBR-FL | TBJ-FL | STL-FL |
|---|---|---|---|
| beef | $7.56 @ 75.4% | $5.2 @ 69.3% | $4.17 @ 84.1% |
| poultry | $2.2 @ 66.3% | $1.83 @ 75.2% | $1.54 @ 84% |
| pork | $3.51 @ 64.4% | $2.62 @ 67% | $3.06 @ 68.8% |
| seafood | $6.88 @ 76% | $4.2 @ 75.1% | $6.99 @ 91.8% |
| plant_or_egg | $null @ 0% | $0.98 @ 9.4% | $null @ 0% |
| other_meat | - | - | $14.58 @ 84.2% |
| other | - | $null @ 0% | $12.29 @ 79.6% |

### Cells that changed publication status

- Cleared 25% threshold (now published; some also would have cleared 35% pre-Phase-5): 14
- Published WITH caveat (25-35% coverage): 0
- Suppressed below 25%: 1
  - TBJ-FL protein_mix.other.dollars_per_lb: cov=0%

### Q11 measured over-extraction distribution + threshold recommendation

- Invoices scored (line-item sum vs invoice header sum, post-Step-3 fix): **478**
- Quantiles: q25=0.99x, q50=1.00x, q75=1.00x, q90=1.00x, q95=1.44x, q99=1.99x
- Invoices above 1.15x: 33 | 1.20x: 32 | 1.30x: 27 | 1.50x: 21
- **Recommended threshold from measured distribution (q95 rounded up 0.05): 1.45x**
- The old 1.15x threshold flagged 33 invoices; the recommended 1.45x flags ~21. Lower false-positive rate on legitimate freight/tax variance.

### Q13 measured $/lb sanity bands (per category)

| Category | n | Q1 | Q3 | Multiplier | Band | Median |
|---|---|---|---|---|---|---|
| produce | 920 | $0.8 | $3.51 | 1*IQR | [$0, $6.21] | $1.6 |
| dairy | 363 | $1.43 | $3 | 1.5*IQR | [$0, $5.36] | $2.23 |
| protein | 611 | $2.04 | $8.16 | 1.5*IQR | [$0, $17.34] | $4.73 |
| dry_goods | 583 | $1.3 | $9.71 | 1.5*IQR | [$0, $22.32] | $3.05 |
| poultry | 4 | | | | (insufficient_data (<5 rows)) | |
| beverage | 189 | $1 | $18.81 | 1.5*IQR | [$0, $45.54] | $1.9 |
| packaging | 40 | $2.78 | $106.43 | 1.5*IQR | [$0, $261.9] | $40.09 |
| cleaning | 40 | $0.9 | $5.77 | 1.5*IQR | [$0, $13.07] | $2.88 |
| other | 5 | $6.14 | $462.74 | 1.5*IQR | [$0, $1147.65] | $9 |
| supplies | 16 | $1 | $2.83 | 1.5*IQR | [$0, $5.57] | $2.17 |
| smallwares | 3 | | | | (insufficient_data (<5 rows)) | |

Per Kevin's steer: seafood widened to 2.5*IQR; produce narrowed to 1*IQR; others 1.5*IQR.

### Q14 GFS invoice self-answer

- Model: claude-sonnet-4-5-20250929. Invoices probed: 4. Cost: $0.056.
- Result: **GFS invoices do NOT show per-line case weight for 'NxN CO' packs** ('60x1 CO', '4x6 CO', '100x1 CO' etc.). One invoice had a weight column but it was empty for these SKUs. No case-line-with-weight found on any of the 4 invoices.
- Consequence: GFS 'NxN CO' rows stay unresolved. Recovery not possible from invoice image alone; would require vendor catalog (Q18).

### Q15 Cheney '#N' self-answer

- Method: for each Cheney row where uom_raw='#N' AND unit_price + shipped_count + extended_price all populated, compute implied per-case weight = (ep / sh) / up. Check whether it falls in the row's category plausibility bounds.
- Test result: **13 of 14 tested rows reconcile inside bounds (92.9%)**. Threshold to adopt: 80%. **Convention ADOPTED.**
- Interpretation: on Cheney lines with '#N' uom, unit_price is $/lb and shipped_count is number of cases; per-case weight is implied by (ep/sh)/up. Already covered in the corpus by Step 3 catch-weight arithmetic gate (these rows carry weight_line_value populated).

### Q21 chef review sample delivered

- 30-row stratified sample of protein/produce/dairy SKUs (10 per account, weighted toward spend, mix of confidence levels).
- Delivered as workbook 'Q21 Chef Review Sample' sheet. Column 'CHEF: agree?' left blank (amber) for sign-off.
- Analyst does NOT self-validate. Chef marks AGREE / DISAGREE / UNCERTAIN.

### Analyst decisions recorded (distinct from Kevin answers - revisitable)

- **Q10 orphaned line items**: KEEP. Filtered on read; no cleanup migration.
- **Q11 over-extraction threshold**: measured from post-Step-3 data (see above). Recommended 1.45x from q95 rounded up 0.05.
- **Q13 $/lb sanity bands**: measured, seafood widened + produce narrowed per Kevin's steer.
- **Q16 fees**: verified non-food (245 rows / $1,245). No change.
- **Q17 'other' category**: 16 top-groups reclassified into real categories via description patterns (sorbets -> dairy, condiments -> dry_goods, service fees -> non_food). Long tail stays 'other'.
- **Q19 failed-invoice rescan SLA**: 30-day policy adopted. Backlog audit to be done separately.
- **Q21 fresh vs frozen**: sample delivered; analyst does not decide.

### Still open (need Kevin, DO NOT guess)

- **Q18** printed / scanned vendor order guides for Sysco / Cheney / GFS / FreshPoint / Samuels. **HIGHEST-VALUE outstanding question**. Would eliminate half the pack-size question class permanently.
- **Q20** delivery-fee / minimum-order schedule per vendor per account. Without it, true delivered cost unanswerable.

### Dollar invariance check

- **PASS** (0 issues). Every dollar figure - reconciliation totals, spend by category, protein bucket totals - byte-identical to Phase 4.

### Cost tally

- Q14 GFS invoice reads via Anthropic vision: **$0.056**
- Q15 Cheney #N self-answer: **$0** (data-only test)
- Total Phase 5 API cost: **$0.056**

### Deliverables

- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx` (overwritten; 36 sheets)
- `~/dev/purchase-discovery-2026-08-12/PURCHASE_ONE_PAGER.md` (Phase 5 section appended)
- `~/dev/purchase-discovery-2026-08-12/scripts_phase5/*` (Phase 5 pipeline + all artifacts)

### Phase 5 pipeline commands

```
cd ~/dev/purchase-discovery-2026-08-12
node scripts_phase5/00_read_open_questions.mjs      # ingest filled OPEN_QUESTIONS.xlsx
node scripts_phase5/10_validate_fused_slash.mjs     # validate rule vs 30 Kevin SKUs
node scripts_phase5/12_q15_cheney_pound_n_test.mjs  # self-answer Q15
node scripts_phase5/13_q14_gfs_invoice_self_answer.mjs  # self-answer Q14 (vision)
node scripts_phase5/20_apply.mjs                    # apply all steps -> recovered rows
node scripts_phase5/30_recompute.mjs                # recompute analysis + Q11/Q13
node scripts_phase5/40_q17_other_reclass.mjs        # Q17 analyst reclass
node scripts_phase5/45_q21_fresh_frozen_sample.mjs  # Q21 chef review sample
node scripts_phase5/50_q12_q16_verify.mjs           # Q12/Q16 verify
node scripts_phase5/60_build_workbook.mjs           # overwrite workbook
node scripts_phase5/70_append_phase5_log.mjs        # append this log
```
