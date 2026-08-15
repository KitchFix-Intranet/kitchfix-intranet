# Phase 6 log - STL weight fix (Mechanism A) + v6 recompute battery

Branch: feat/phase-6-weight-fix (off feat/phase-3-purchasing-analysis)
Working dir: /Users/kevinfietek/dev/purchase-discovery-2026-08-12/
Ran: 2026-08-14

## Completeness map

| Item | Status | Detail |
|------|--------|--------|
| B1 stale-proof test | PASS | Stale AUG reproduces published v5 TBJ 2,219 / $171,222.23 to the cent (all three accounts). |
| B2 fresh pull | PARTIAL | Fresh AUG produced 6,983 live rows / 445 orphan / 33 drift (spec expected 6,969 / 459 / 33). TBR + STL reconcile to the cent vs Fact 1. TBJ FRESH does NOT reproduce Fact 2 fresh figures (2,202 / $183,851.55); reproduces published v5 instead (2,219 / $171,222.23). See STOP #1 below. |
| B3 3c regenerate | PASS | 6,795 rows / 93 sanity-drops on fresh AUG. Also re-verified against stale AUG: identical result 6,795 / 93 (Fact 7 [re-verify] confirmed - 93, not 92 - the off-by-one Kevin predicted was correct). |
| B4 R9 resolution | PASS (see R9 line) |
| B5 v6 recompute | DONE - baseline + v6 both landed. See STOP #2 (R8) and STOP #3 (R4 TBR swing). |
| B6 before/after tables | DONE | See `_bridge6.json`. |
| B7 workbook + one-pager | SKIPPED | Kevin's spec: "Only after B1-B6 gates pass." R4 and R8 breached; no workbook write. |
| R3 dollar invariance | PASS for TBR/STL, PARTIAL for TBJ (see STOP #1). |
| R4 TBR protein swing | FAIL (STOP) | baseline 7,717.2 lbs -> v6 3,398.4 lbs = -56% swing (spec threshold 5%). Root cause: R5 arithmetic gate rejects 140 TBR catch rows (-4,646 lbs) because `shipped_count` is null on catch-weight invoices. See STOP #3. |
| R5 arith gate | RAN (all rejected) | 362/362 catch-reclassified rows gated OUT. Root cause: 100/362 have `shipped_count=0` and 262/362 have `shipped_count=null` in the AUG. The Q8 catch pattern on these vendors carries the case count in `quantity`, not `shipped_count`; per-invoice weight totals live in the description "TOT WT: N.NN". Kevin's spec (mirror Step 1 tolerance on up*shipped) cannot pass for these rows. Reported under "no silent scope additions" - not amended. |
| R6 $/lb band gate | RAN | 431 rows gated out (TBR 60 / TBJ 98 / STL 273). Total spend gated: TBR $3,374 / TBJ $9,344 / STL $43,012. See STOP #4: band_low=0 for all categories in the frozen artifact, so the gate never catches under-priced high-lb rows (Coleman 45 LB and similar). |
| R7 fluid-oz restoration | PASS | 22 p5-fused beverage rows reverted to volume_excluded. |
| R8 hard-fail gate | FIRE + FAIL | Baseline: STL 25,690 / 18,860 = 1.36 FIRES (as spec required). v6: STL 20,874 / 18,860 = 1.11 STILL FIRES. See STOP #2. |
| R9 layer-id resolution | PASS | p5 447/447, catch 362/362, p4 72/72; catch ∩ p5 = 1; **catch ∩ p4 = 9** (Kevin/Chat-Claude assumption A1 "empty set" is FALSE - 9 rows overlap). |
| R10 change-log | DONE | 521 entries in `_change_log6.json`. |
| D1 sc_daily_actuals | DONE | TBR 7,632/6,252/5,588; TBJ 16,078/8,499/885; STL 6,021/0/164. |
| D2 BGC entity search | DONE | Match FOUND: `Boys & Girls Club` under `TBR - FL` (service_id ae275d84). Zero in-window `sc_daily_actuals` rows for that service_id. |
| D3 STL projections | DONE | May 6,340 / Jun 5,440 / Jul 4,680 (total 16,460). Kevin's Q6 figures (7,540/6,190/5,130 = 18,860) do NOT match DB (short by 2,400). |

## STOP conditions

### STOP #1 - TBJ fresh figures do not match Fact 2
Direct live-DB query (bypassing the augment pipeline) returns TBJ dollar set = **2,219 / $171,222.23** (May 930/$79,383.13, Jun 715/$54,653.71, Jul 574/$37,185.39) - byte-identical to the published v5 figures. Chat-Claude's Fact 2 "fresh" figures of 2,202 / $183,851.55 are NOT the current live-DB state. Either the DB was reverted between Fact-2 capture and Phase 6, or Fact 2 was captured via a different filter. Under R1 the v6 baseline follows the live DB, so the R2(a) restatement bridge is ZERO in this session (0 rows, $0.00). Every bridge row in `_bridge6.json` shows `restatement: 0`. The entire delta reported is under `fix`.

### STOP #2 - R8 hard-fail gate breached in v6
STL-FL core-food protein lbs = **20,873.8** on 18,860 meals = 1.11 lbs/meal, over the 0.6 threshold. The Mechanism-A catch fix cut STL from 25,808 (baseline) to 20,874, but the residual is still ~35x the plausible per-meal protein. Diagnostic (`05_instrument_stl.mjs`) shows the top surviving contributors:

- one BEEF BOTTOM SIRLOIN FLAP row (id d48e8152) parsed as `4 x 12 lb per case * 117.3 qty = 5,630 lbs` on $870.37 spend ($0.15/lb). pack "004/12 #" + up $7.42 + sh 117.3 is a catch-weight pattern but the row's review_reason is null so it never entered Step 3 (the 362 catch pool). R6 band gate does not catch it because band_low = 0 for protein.
- one CHIX DRUMSTICKS CVP row (id 4db7eb60) at 3,200 lbs / $57.60 (same shape).
- 20 Coleman Chicken 45 LB pack rows through 3c-rehab (~180 lb each), catch-weight in spirit but with review_reason=null. R6 EXEMPTS 3c layer per Kevin's spec, so they survive.

### STOP #3 - R4 TBR protein swing -56%
TBR baseline core-food protein lbs 7,717 -> v6 3,398 (-56%, spec threshold 5%). Cause: R5 (arithmetic gate) removed 140 TBR catch rows (-4,646 lbs). R4 (catch-implied replacement layer) added 0 rows to compensate, because the arith gate uses `shipped_count` which is null on these invoices.

### STOP #4 - R6 band_low = 0 for every category
The frozen `_q13_bands.json` artifact has `band_low = 0` (from `max(0, Q1 - mult*IQR)`) for every category. This means the band gate only catches HIGH-$/lb rows (over-priced-for-weight) - it CANNOT catch LOW-$/lb rows (over-weighted-for-price), which is the actual mechanism of the STL inflation. The Coleman rows sit at $85.99 up / 4 sh / 3c-derived 180 lbs = $1.91/lb, WITHIN band [0, 17.34]. Kevin's spec froze the artifact "do not re-derive" - not amended.

## Detail by rule

### R4 TBR swing (STOP #3)
- baseline TBR core-food protein: 7,717.2 lbs
- v6 TBR core-food protein: 3,398.4 lbs
- swing: -56%
- cause: R5 arith gate removed 140 rows / -4,646 lbs from TBR's catch layer; R4 replacement added 0 lbs

### R5 arith gate (as-written)
- 362 catch-weight ids inspected
- 100 with shipped_count = 0
- 262 with shipped_count = null (JSON)
- 0 admitted, 362 gated out
- Gated-out reasons: 358 `missing_shipped_count`, 4 `up_times_shipped_not_ep`

### R6 band gate
- 431 rows gated out across all accounts (TBR 60 / TBJ 98 / STL 273)
- lbs removed from weight set: TBR 77.8, TBJ 329.3, STL 1,366.0
- spend removed from weight set: TBR $3,373.52, TBJ $9,343.53, STL $43,012.35
- No rows caught for being too heavy for the price (band_low = 0 for all categories in the frozen artifact)

### R7 fluid-oz restoration
- 22 p5-recovered rows on beverage-basis with fused_slash source reverted to volume_excluded

### R8 (fire + pass test)
- baseline mode: STL 25,690.1 / 18,860 = 1.36 -> FIRES (as expected)
- v6 mode: STL 20,873.8 / 18,860 = 1.11 -> STILL FIRES (spec breach)

### R9 layer-id resolution
- p5.recovered: 447/447 resolved on fresh AUG
- catch reclass ids: 362/362 resolved (deduped; raw 362 stored, no dupes at the id-list level; 364 dupes only in the detail-object list)
- p4.recovered_rows: 72/72 resolved
- overlaps: catch ∩ p5 = 1, catch ∩ p4 = **9** (Chat-Claude assumption A1 empty-set is FALSE)

## Denominator appendix (D1-D3)

### D1 - sc_daily_actuals monthly meals in-window
| Account | May 2026 | Jun 2026 | Jul 2026 | Total |
|--------:|--------:|--------:|--------:|-----:|
| TBR-FL | 7,632 (105 rows) | 6,252 (69 rows) | 5,588 (113 rows) | 19,472 |
| TBJ-FL | 16,078 (120 rows) | 8,499 (217 rows) | 885 (12 rows) | 25,462 |
| STL-FL | 6,021 (78 rows) | 0 (0 rows) | 164 (5 rows) | 6,185 |

TBR total matches A5.per_meal window_meals_used (19,472). TBJ actuals = 25,462 vs A5 27,532 (delta +2,070 from projected substitute for sparse July). STL sparse data confirmed - matches the Phase 3c suppression rationale.

### D2 - Boys & Girls Club / BGC under TBR-FL
| Field | Value |
|------|------|
| service_id | ae275d84-3dc9-415a-8f61-1d3127c3c72f |
| account_key | TBR - FL |
| group_name | Boys & Girls Club |
| active | true |
| in-window sc_daily_actuals rows | 0 |

The entity exists in `sc_service_groups` but has zero actuals rows in the 2026-05-01..07-31 window.

### D3 - STL-FL sc_daily_projections monthly
| Month | Projected meals | Rows |
|------|------:|-----:|
| 2026-05 | 6,340 | 271 |
| 2026-06 | 5,440 | 246 |
| 2026-07 | 4,680 | 235 |
| Total | 16,460 | 752 |

Kevin's Q6 figures (7,540 / 6,190 / 5,130 = 18,860) do NOT match DB projections (short by 1,200 May, 750 Jun, 450 Jul; total short by 2,400).

## Files

- `01_stale_proof.mjs` + `_stale_proof.json` - B1 stale reconciliation
- `02_verify_fresh.mjs` + `_verify_fresh.json` - B2 fresh vs expected
- `03_live_db_check.mjs` + `_live_db_check.json` - independent Postgres read
- `04_layer_id_resolution.mjs` + `_layer_id_resolution.json` - R9
- `05_instrument_stl.mjs` - STL residual-lbs diagnostic
- `10_recompute_v6.mjs` - v6 recompute (with `--baseline` flag)
- `_analysis6.json` + `_change_log6.json` - v6 outputs
- `_analysis6_baseline.json` + `_change_log6_baseline.json` - v5-logic baseline
- `20_before_after_tables.mjs` + `_bridge6.json` - B6 bridge
- `30_denominators.mjs` + `_denominators.json` - D1-D3
- `PHASE_6_LOG.md` - this file
- `_denominators.mjs` - Addendum A1 canon constants (TBR 20,300 / TBJ 29,541 / STL 18,860)
- `31_denominator_audit.mjs` + `_denominator_audit.json` - Addendum A2 sc_daily_actuals variance table (read-only audit)
- `_a4_defect.json` - Addendum A4 TBR calendar column-mis-entry defect verification (REPRODUCED, 400 meals leaked into price cols on 2026-07-28/29/30)

## Addenda 1 + 2 (executed 2026-08-14)

### A1 canon denominators - wired
- Constants live in `_denominators.mjs` and are imported by `10_recompute_v6.mjs`. The sparse-month projection-substitution path is disabled for this window.
- R8 gate on baseline: TBR 0.38 pass, TBJ 0.34 pass, STL 1.36 FIRES (as expected).
- R8 gate on v6: TBR 0.17 pass, TBJ 0.28 pass, STL 1.11 STILL FIRES (STOP #2 unchanged from Phase 6 body).
- R4 TBR swing: baseline 7,717.2 lbs -> v6 3,398.4 lbs = -56% (STOP #3 unchanged). New lb/cover figures against canon 20,300: baseline 0.38 -> v6 0.17.

### A2 sc_daily_actuals variance (audit only, DB NOT modified)
| Account | Month | Canon | DB actuals | Variance | Pct |
|---|---|---:|---:|---:|---:|
| TBR-FL | 2026-05 | 7,620 | 7,632 | +12 | +0.2% |
| TBR-FL | 2026-06 | 6,240 | 6,252 | +12 | +0.2% |
| TBR-FL | 2026-07 | 6,440 | 5,588 | -852 | -13.2% |
| TBR-FL | TOTAL | 20,300 | 19,472 | -828 | -4.1% |
| TBJ-FL | 2026-05 | 9,433 | 16,078 | +6,645 | +70.4% |
| TBJ-FL | 2026-06 | 9,307 | 8,499 | -808 | -8.7% |
| TBJ-FL | 2026-07 | 10,801 | 885 | -9,916 | -91.8% |
| TBJ-FL | TOTAL | 29,541 | 25,462 | -4,079 | -13.8% |
| STL-FL | 2026-05 | 7,540 | 6,021 | -1,519 | -20.1% |
| STL-FL | 2026-06 | 6,190 | 0 | -6,190 | -100% |
| STL-FL | 2026-07 | 5,130 | 164 | -4,966 | -96.8% |
| STL-FL | TOTAL | 18,860 | 6,185 | -12,675 | -67.2% |

Chat-Claude's three claimed variances all CONFIRMED (TBJ May 16,078; TBJ Jul 885; STL Jun 0). Per-service-group breakdowns captured in `_denominator_audit.json`. TBR breakdown: Minor League 17,851 / Boys & Girls Club 1,620 / Major League 1 (window total 19,472).

### A3 B&G disclosure + contract specs
- `BG_DISCLOSURE` string is exported from `_denominators.mjs` and attached to `A6.per_meal["TBR-FL"]._bg_disclosure` for every TBR per-cover figure. Also attached at `A6._phase6.addendum_a3`.
- One-pager Q&A section carries Q18/Q20 Kevin answers and the two-paragraph limitations block.
- Workbook Methodology sheet note DEFERRED pending B7 unblock (Phase 6 STOP #2/STOP #4).
- **B&G contract specs found** (source: `content/documents/REC-108.mdx` Account Record for TBR-FL + `content/documents/REF-141.mdx` Price Book):
  - Client: Boys & Girls Clubs of Charlotte County, Port Charlotte, FL. Contractually independent of the Rays. Contract runs Aug 19, 2025 -> May 21, 2026 (10-month school year, Tue-Thu, 1:30pm delivery), NO auto-renewal.
  - Rate: $6.50 per Estimated Meal, FLAT (any meal type - contract does not split by breakfast/lunch/dinner). TAX-EXEMPT (Club provided tax-exempt documentation).
  - Meal type: after-school supper (1:30pm delivery; sample menu is a dinner menu; USDA CCFP meal pattern). Prior "lunch" label is a labeling error - rate is the same regardless.
  - Billing: prepaid 4-week periods. Club sends Period Estimate 7+ days ahead; KitchFix invoices $6.50 x estimate at period start; Club pays BEFORE the period begins; unserved meals credit forward. Check-only payment; 5%/month late fee; 125/day is planning estimate, NOT a billed floor.
  - Ancillary status: IN-SCOPE second-client stream for TBR-FL (P&L 2200, school-year total approx $79,950). Commissary overlap is operational, not contractual.
  - For calendar 2026, only Jan 1 - May 21 is under contract; fall 2026 (Aug onward) requires a new BGC contract not yet on file.
  - Note: contract-digest reference in prior code comments was `REF-121` (BGC Contract Digest). Actual source-of-record now lives in REC-108 + REF-141 rows; there is no separate `REF-BGC` mdx file - the BGC Contract Digest content is embedded in REC-108 §BGC and Ancillary revenue sections.

### A4 TBR calendar column-mis-entry defect - REPRODUCED
- File: `Tampa Bay Rays Service Calendar - 2026 (4).xlsx` sheet `TBR-2026 - Actuals`.
- Verified via ExcelJS positional read of columns 22 (breakfast count) / 23 (breakfast price) / 24 (lunch count) / 25 (lunch price) on rows 215/216/217 (2026-07-28/29/30):
  - 2026-07-28 (r215): col22=null col23=80  col24=null col25=80  (both defects)
  - 2026-07-29 (r216): col22=80   col23=80  col24=null col25=80  (lunch defect only)
  - 2026-07-30 (r217): col22=null col23=80  col24=null col25=80  (both defects)
  - 5 leaked slots x 80 meals = 400 meals in the price columns.
- Formula (col 51 "Total Meals" shared formula `sum(F,H,J,V,X,Z,AB,AD)`) references count cols only (V=22, X=24, Z=26, AB=28, AD=30). BUT the shared formula range is only `AY4:AY214` - rows 215-217 carry HARDCODED "Total Meals" values of 160 each, entered by hand to compensate for the mis-entry. So col-51 sum on the window = 18,680 (correct), positional read of count cols = 18,280 (undercount by exactly 400).
- **Ingest exposure: YES** - the intranet's one-time SC seed pipeline (`kitchfix-intranet/scripts/_extract_sc_xlsx.py`) uses positional column reads: `build_column_map()` scans row 1 (group headers) + row 2 (service name + interleaved prices) to build a services list keyed on `name_col` (count col), then in `extract_tab()` reads each data row at those `name_col` positions. Values placed in `price_col` positions are treated as prices, not counts, and would be dropped. If the extractor were re-run against this v4 workbook it would ingest TBR July at 6,440 - 400 = 6,040 meals (an under-count of 400). Live-DB (sc_daily_actuals) currently reports TBR July = 5,588 - already further undercounted relative to calendar formula (see A2), so this defect is a sub-component of a larger data-integrity issue.
- Sheet NOT modified per rule 5 (verify-and-log only).
