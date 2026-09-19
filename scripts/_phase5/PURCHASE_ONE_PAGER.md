# Purchasing Comparison - CEO One-Pager

Window 2026-05-01 to 2026-07-31 (3 months). Off-season for main dining program; MiLB in-season (Triple-A + Double-A across TBR/TBJ/STL Florida sites). All figures on core_food basis unless noted (core_food = food $ excluding beverage). Every number traces to a query - full workbook: PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx.

## 1. Category mix (core_food $) - LEAD FINDING

| | TBR-FL | TBJ-FL | STL-FL |
|:-|:-|:-|:-|
| Core food $ | $109,020.61 | $132,317.45 | $200,947.87 |
| protein % core | 45.1% | 33.7% | **52%** |
| produce % core | 26% | 28.6% | 17.7% |
| dairy % core | 10% | 15% | 12.2% |
| dry_goods % core | 18.6% | 22.7% | 18.1% |
| beverage % of food | 1.4% | 14.5% | **20.5%** |

**Means:** three accounts run visibly different plates. STL is protein-heavy (52%) with the largest beverage program (20.5%). TBJ most balanced. TBR protein-heavy (45.1%), almost no beverage program. Category share reflects kitchen scope + menu + service program.

**Does NOT prove:** whether any mix is right for its service program. Whether protein-heavy = expensive-per-meal (STL per-meal figures suppressed in Phase 3c - meals denominator is insufficient).

## 2. Beverage is scope, not purchasing choice

STL beverage = $51,755.34 (20.5% of food); TBR $1,599.95 (1.4%). Phase 3 counted bottled water in the premium-food signal - Phase 3b moves branded beverages to neutral.

**Means:** treat as scope question (does the account run a full-service beverage program?). Do NOT roll into "STL buys premium food."

**Does NOT prove:** margin. This is spend to vendors, not revenue.

## 3. Premium share on core_food (beverages excluded)

Premium % of core_food $ (LLM classifier, >= 70 conf): TBR **20%**, TBJ **21.3%**, STL **46%**. Commodity: TBR 35.7%, TBJ 34.2%, STL 25.9%.

**Means:** STL still runs materially higher premium share on food-only basis (46% vs ~20% for TBR/TBJ - ~2.3x). Phase 3 called this 2.4x; that was ~half beverage artifact. The real core-food gap is ~2.3x.

**Note on axes (Phase 3c item 6):** Quality and preparation are independent axes; an item can be both premium and prefabricated (a pre-portioned Choice steak is both). Present the observation; do not interpret it.

**Does NOT prove:** whether STL should be premium (menu positioning). 11.1% of STL core_food is <70-confidence, excluded from headline (Needs Review sheet).

## 4. Operational shape - cadence + concentration

| | TBR-FL | TBJ-FL | STL-FL |
|:-|:-|:-|:-|
| Invoices/window | 195 | 150 | 208 |
| Deliveries/week | 14.84 | 11.41 | 15.83 |
| Avg order value | $664.14 | $1,148.57 | $1,313.1 |
| Top-3 vendor share | 95.5% | 90.8% | 81.4% |
| Top-20 SKU share | 27.9% | 25% | 30.5% |

**Means:** TBR orders most-frequent + smallest (~14.84/wk at $664.14). STL/TBJ order 2x the value. Top-3 vendors = 81-96% everywhere - little maverick spend to attack.

**Does NOT prove:** whether small-frequent costs more (delivery fees, minimums). No fee data.

## 5. Same-SKU price variance across accounts

33 SKUs bought at >1 account with >15% spread. Top: **SYS CLS HONEY PURE WLDFLW GR A TSC JU PF4107** 3.14x spread ($624.5 at stake); **SYS CLS CHICKEN CVP THGH B/I SM HAL 5001346** 1.42x ($425.72); **WHLFCLS MILK WHL GALLON** 4.23x ($411.29). Top-5 aggregate at-stake: ~$2,016.46 - contract-negotiation targets. Full ranked list on Price Variance sheet.

**Means:** candidate lift-and-shift savings.

**Does NOT prove:** whether pack size/grade actually matches (some spread is real product difference). At-stake = if-all-lined-up ceiling, not a promise.

## 6. Reconciliation - line-item vs invoice header (Phase 3c item 2)

Per-account window variance (DOLLAR SET line-item sum vs invoice header sum): **TBR-FL -7.0%**, **TBJ-FL -0.1%**, **STL-FL -5.1%**. Per-month breakdown on the workbook Reconciliation sheet.

## Phase 3b fix log

- **Fix 4** (category leakage): $1,731.62 cleaning/smallwares moved out of STL food; beverages split (STL $51,755.34, TBJ $22,378.47, TBR $1,599.95).
- **Fix 5** (TBR protein rehab): applied. Weight coverage 9.8% -> 63.05% (rows) / 69.24% (spend). $/lb by protein type now reportable.
- **Fix 2** (meals denominator): 0 monthly cells suppressed. Projections used for sparse-actual months, labeled honestly.

## Phase 3c final tightening

- **Item 1:** 50 unreliable Duplicate Family spread values replaced with "not comparable" (family confidence < 70 OR spread > 3x). Spend covered: $43,594.86.
- **Item 2:** Reconciliation now shown as three real per-account variances (section 6), not an aggregated bound.
- **Item 3:** All STL-FL per-meal cells suppressed - "meals data insufficient" (STL June 0 actuals, July 5 rows / 164 meals). TBR + TBJ per-meal figures unchanged.
- **Item 4:** 2 category $/lb cells outside per-category IQR-based band flagged "review - outside expected range". Bands + method on workbook Methodology sheet.
- **Item 5:** TBJ-FL pork $/lb and STL-FL seafood $/lb recomputed after excluding rows conclusively identified as bad weight resolution (bacon OCR pack-size garble + shrimp qty-as-lb mislabeling). See Phase 3c Change Log sheet for exact rows + before/after.
- **Item 6:** Premium and prefabricated axes are independent - byte-identical to Phase 3b; one-line neutral explanation added in section 3.

## Phase 4 protein weight recovery

Applied 2026-08-14. Zero dollar figures changed. 72 protein-category rows recovered across three accounts / $17,696 spend / 4,551 lbs new weight.

- **Path A** (cross-account item_number weight borrowing): 26 rows / $3,392 / 655 lbs. Same-vendor+item# clean-sibling weights borrowed from any account.
- **Path B** (11 TBJ-FL Sysco bacon invoice rescans via Anthropic vision): 8 of 16 Phase-3c-excluded bacon rows recovered with pack-size read verbatim as "1/15 LB" (15 lb/case).
- **Path C** (39 TBJ-FL top-unresolved-SKU invoice rescans): 38 additional rows recovered - mostly from invoice-printed "TOT WT" catch-weight lines.

**Cells cleared the 35% publication threshold (were suppressed / uncertain in Phase 3c, now publishable):**

- TBJ-FL beef $/lb: coverage 31.6% -> 84.8%; $/lb = **$4.42**
- TBJ-FL pork $/lb: coverage 17.8% -> 46.4%; $/lb = **$2.76**
- STL-FL seafood $/lb: coverage 30.8% -> 40.2%; $/lb = **$11.61**

**Cells still suppressed by 35% threshold (below-threshold coverage):**
- TBJ-FL and STL-FL `other` protein-type buckets (small residuals, low coverage).

**Path D - plant_or_egg category:** 41 rows / $4,624. Eggs sold by count, not weight - not resolvable to lbs. RECOMMENDATION (Kevin decides): compute lbs-per-meal denominators EXCLUDING plant_or_egg category rather than counting as missing coverage. Cells suppressed in Protein Mix with reason "eggs sold by count".

Full recovery log: workbook Phase 4 Recovery Log sheet + PURCHASE_ANALYSIS_PHASE3.md Phase 4 section.

## Phase 5 - Kevin's answers applied

Applied 2026-08-14 after Kevin filled OPEN_QUESTIONS.xlsx (Questions sheet + 30-SKU Pack Weights sheet). Zero dollar figures changed. Publication threshold lowered to 25% with visible caveat between 25-35% (Kevin's Q5 answer). Full details on the workbook "Phase 5 Overview", "Fused-Slash Validation", and "Phase 5 Change Log" sheets.

### Coverage improvement (weight-set food $ / dollar-set food $)

| | TBR-FL | TBJ-FL | STL-FL |
|:-|:-|:-|:-|
| Phase 4 coverage | 46.1% | 45.2% | 67.8% |
| Phase 5 coverage | **48.6%** | **49.2%** | 62.2% |
| Food lbs (Phase 4) | 19,395 | 34,744 | 54,835 |
| Food lbs (Phase 5) | **22,386** | **41,609** | **68,080** |

TBR-FL and TBJ-FL both up 3-6pp; STL-FL absolute weight increased +24% (55K -> 68K lb) but the coverage % dropped slightly because the fresh recompute is stricter than Phase 4's overlay. Every dollar figure is byte-identical to Phase 4 (dollar invariance check PASS with 0 issues).

### STL-FL per-meal figures unlocked (Q6)

Kevin: STL uses 2027 service-calendar projections. **May 7,540 + June 6,190 + July 5,130 = 18,860 window**. Every previously-suppressed STL per-meal cell now populated:

- STL-FL food $/meal: **$13.40** (was suppressed)
- STL-FL food lbs/meal: **3.61 lb** (was 4.71 with 11,625-mixed / 3.39 with 16,141-projection-filled)

### Protein $/lb table (Phase 5 post-recovery, coverage stated inline)

| | TBR-FL | TBJ-FL | STL-FL |
|:-|:-|:-|:-|
| beef $/lb | $7.56 @ 75.4% | $5.20 @ 69.3% | $4.17 @ 84.1% |
| poultry $/lb | $2.20 @ 66.3% | $1.83 @ 75.2% | $1.54 @ 84.0% |
| pork $/lb | $3.51 @ 64.4% | $2.62 @ 67.0% | $3.06 @ 68.8% |
| seafood $/lb | $6.88 @ 76.0% | $4.20 @ 75.1% | $6.99 @ 91.8% |
| plant_or_egg | not comparable | not comparable | not comparable |
| other_meat | - | - | $14.58 @ 84.2% |

**No cell is under the 25% publication threshold on any of the 12 primary protein $/lb figures**. plant_or_egg deliberately excluded (Kevin's Q3: include only where pack now resolves; eggs sold by count).

### Self-answered (from data + source docs)

- **Q14 GFS invoice self-answer:** 4 GFS invoices with "NxN CO" pack code pulled via Drive + read via Sonnet vision ($0.056 total cost). Result: GFS invoices do NOT show per-line case weight for these packs. One invoice had a weight column, but it was empty for these SKUs. Rows remain unresolved. See "Q14 GFS Invoice Reads" sheet.
- **Q15 Cheney '#N' self-answer:** Cheney rows where `uom_raw='#N'` follow catch-weight-lb convention (up = $/lb, ep/up = total shipped lb). 13 of 14 tested rows reconcile inside category-plausibility bounds (92.9% > 80% adopt threshold). Convention adopted. Already covered via Step 3 catch-weight gate (those rows carry `weight_line_value`). See "Q15 Cheney # Test" sheet.

### Analyst decisions (distinct from Kevin's answers - revisitable)

- Q10 orphaned line items: keep, do not hard-delete. Already filtered on read.
- Q11 over-extraction threshold: measured post-Step 3. **q95 = 1.44x; recommended threshold = 1.45x** (rounded up 0.05 from measured distribution). Above 1.15x: 33 invoices; above 1.20x: 32; above 1.50x: 21. See "Q11 Over-Extraction Dist" sheet.
- Q13 $/lb sanity bands: measured per category. Seafood widened (2.5*IQR per Kevin's steer); produce narrowed (1.0*IQR); others 1.5*IQR. See "Q13 dpp Bands" sheet.
- Q17 'other' category: 16 top-groups reclassified into real categories (sorbets -> dairy, condiments -> dry_goods, service fees -> non_food). Long tail stays 'other'. See "Q17 Other Reclass" sheet.
- Q19 failed-invoice rescan: 30-day SLA policy adopted. Backlog audit to be run separately.
- Q21 fresh vs frozen: 30-item stratified sample delivered for chef sign-off. Analyst does not self-validate. See "Q21 Chef Review Sample" sheet.

### Still open (need Kevin; NOT guessed)

- **Q18** vendor order guides for Sysco/Cheney/GFS/FreshPoint/Samuels - highest-value outstanding question. Would eliminate half the pack-size question class permanently.
- **Q20** delivery-fee / minimum-order schedule per vendor per account - without it, true delivered cost unanswerable.
