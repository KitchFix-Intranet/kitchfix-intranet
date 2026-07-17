> **ARCHIVED 2026-07-17** - pre-sc-8c, superseded by the pricing-summit `docs/pricing-summit/PRICE_AUDIT.md` + per-account `docs/pricing-summit/EVIDENCE_*.md`. Point-in-time projection-vs-actuals sheet delta; the summit ledger + evidence files replace it as the canonical price truth.

# Service Calendar Price Comparison

Cross-account projection vs actuals price comparison for all 11 Service
Calendar source files. Generated from `/Users/kevinfietek/Documents/Claude /Service Calendars/*.xlsx`
using `docs/SC_SPREADSHEET_MAPPING.md` as the per-file layout reference.

- **Projection Price** is read from row 2 of each file's projections tab.
- **Actuals Price** is read from row 2 of each file's actuals tab if one exists, otherwise blank.
- **Delta** = Actuals Price - Projection Price.
- Only service data columns are read; total / aggregate columns
  (`Total Revenue`, `Total Meals`, `Total Snacks`, `Total Charged Items`,
  `Average $/Item`, etc.) are skipped per the mapping doc.
- Accounts with no actuals tab: CIN - OH, TXR - TX - H. Their Actuals columns
  are blank by design - no PROJECTION-ONLY flag is raised.

## Comparison table

| Account Key | Group | Service | Projection Price | Actuals Price | Delta | Flags | Notes |
|---|---|---|---|---|---|---|---|
| CIN - AZ | Major League | Breakfast | $29.01 | $20.31 | -$8.70 |  | Cost-basis delta of -$8.70 |
| CIN - AZ | Major League | Dinner | $29.01 | $20.31 | -$8.70 |  | Cost-basis delta of -$8.70 |
| CIN - AZ | Major League | Lunch | $29.01 | $20.31 | -$8.70 |  | Cost-basis delta of -$8.70 |
| CIN - AZ | Minor League | Breakfast | $18.42 | $12.90 | -$5.53 |  | Cost-basis delta of -$5.53 |
| CIN - AZ | Minor League | Coffee Service (tax-free) | $511.05 | $511.05 | $0.00 | is_flat_fee, is_tax_free |  |
| CIN - AZ | Minor League | Dinner | $18.42 | $12.90 | -$5.53 |  | Cost-basis delta of -$5.53 |
| CIN - AZ | Minor League | Fountain Bev (tax-free) | $283.92 | $283.92 | $0.00 | is_flat_fee, is_tax_free |  |
| CIN - AZ | Minor League | Lunch | $18.42 | $12.90 | -$5.53 |  | Cost-basis delta of -$5.53 |
| CIN - AZ | Minor League | Pre-Game Snack | $7.31 | $5.12 | -$2.19 |  | Cost-basis delta of -$2.19 |
| CIN - AZ | Rehab | Breakfast | $18.42 | $12.90 | -$5.53 |  | Cost-basis delta of -$5.53 |
| CIN - AZ | Rehab | Continental Plus | $9.08 | $6.36 | -$2.72 |  | Cost-basis delta of -$2.72 |
| CIN - AZ | Rehab | Dinner | $18.42 | $12.90 | -$5.53 |  | Cost-basis delta of -$5.53 |
| CIN - AZ | Rehab | Lunch | $18.42 | $12.90 | -$5.53 |  | Cost-basis delta of -$5.53 |
| CIN - KY | Louisville Bats | Breakfast | $25.95 | $25.95 | $0.00 |  |  |
| CIN - KY | Louisville Bats | Lunch | $25.95 | $25.95 | $0.00 |  |  |
| CIN - KY | Louisville Bats | Post-Game | $25.95 | $25.95 | $0.00 |  |  |
| CIN - KY | Louisville Bats | Snack | $8.64 | $8.64 | $0.00 |  |  |
| CIN - KY | Louisville Bats | Umpire | $25.95 | $25.95 | $0.00 |  |  |
| CIN - OH | Cincinnati Reds | Arrival | $25.95 |  |  |  |  |
| CIN - OH | Cincinnati Reds | Post BP | $25.95 |  |  |  |  |
| CIN - OH | Cincinnati Reds | Post-Game | $25.95 |  |  |  |  |
| CIN - OH | Cincinnati Reds | Umpire | $25.95 |  |  |  |  |
| STL - FL | MLB | Breakfast - ST | $40.00 | $40.00 | $0.00 |  |  |
| STL - FL | MLB | Lunch - ST | $40.00 | $40.00 | $0.00 |  |  |
| STL - FL | MiLB | Breakfast | $26.00 | $26.00 | $0.00 |  |  |
| STL - FL | MiLB | Breakfast - ST | $40.00 | $40.00 | $0.00 |  |  |
| STL - FL | MiLB | Lunch | $26.00 | $26.00 | $0.00 |  |  |
| STL - FL | MiLB | Lunch - ST | $40.00 | $40.00 | $0.00 |  |  |
| STL - FL | MiLB | Snack |  |  |  |  | PROJECTION PRICE MISSING - needs decision |
| STL - FL | Palm Beach Cardinals | Arrival | $26.00 |  |  |  | PROJECTION-ONLY - actuals not tracked yet |
| STL - FL | Palm Beach Cardinals | Breakfast |  | $26.00 |  |  | ACTUALS-ONLY - new mid-season service? |
| STL - FL | Palm Beach Cardinals | Post-Game | $26.00 | $26.00 | $0.00 |  |  |
| STL - FL | Palm Beach Cardinals | Pre-game | $26.00 | $26.00 | $0.00 |  |  |
| STL - MO | St. Louis Cardinals | Arrival | $25.95 | $25.95 | $0.00 |  |  |
| STL - MO | St. Louis Cardinals | Post BP | $25.95 | $25.95 | $0.00 |  |  |
| STL - MO | St. Louis Cardinals | Post-Game | $25.95 | $25.95 | $0.00 |  |  |
| STL - MO | St. Louis Cardinals | Umpire | $25.95 | $25.95 | $0.00 |  |  |
| TBJ - FL | Major League - PDC | Breakfast | $23.12 | $23.12 | $0.00 |  |  |
| TBJ - FL | Major League - PDC | Dinner | $23.12 | $23.12 | $0.00 |  |  |
| TBJ - FL | Major League - PDC | Lunch | $23.12 | $23.12 | $0.00 |  |  |
| TBJ - FL | Major League - PDC | Post Game Meal | $23.12 | $23.12 | $0.00 |  |  |
| TBJ - FL | Major League - PDC | Snack | $1.70 | $1.70 | $0.00 |  |  |
| TBJ - FL | Major League - PDC | Umpire | $23.12 | $23.12 | $0.00 |  |  |
| TBJ - FL | Minor League - PDC | Breakfast | $11.55 | $11.55 | $0.00 |  |  |
| TBJ - FL | Minor League - PDC | Dinner | $11.55 | $11.55 | $0.00 |  |  |
| TBJ - FL | Minor League - PDC | Lunch | $11.55 | $11.55 | $0.00 |  |  |
| TBJ - FL | Other | Fun $$$$ Allocated | $28,472.76 | $28,472.76 | $0.00 | is_flat_fee, is_non_revenue |  |
| TBJ - FL | Other | MLB - Catering | $38.00 | $38.00 | $0.00 |  |  |
| TBJ - FL | Other | MLB G&G - Pantry | $1.70 | $1.70 | $0.00 |  |  |
| TBJ - FL | Other | Media Meals | $16.00 | $15.00 | -$1.00 |  | Cost-basis delta of -$1.00 |
| TBJ - FL | Other | MiLB G&G - Pantry | $1.70 | $1.70 | $0.00 |  |  |
| TBJ - FL | Other | Scout Meals |  | $11.55 |  |  | ACTUALS-ONLY - new mid-season service? |
| TBJ - FL | Other | Team Canada | $11.55 | $11.55 | $0.00 |  |  |
| TBJ - FL | SSM | Florida Ops - PDC |  | $11.55 |  |  | ACTUALS-ONLY - new mid-season service? |
| TBJ - FL | SSM | Stadium Staff Meals | $16.51 | $16.51 | $0.00 |  |  |
| TBJ - FL | Single A Jays | Breakfast | $16.51 | $16.51 | $0.00 |  |  |
| TBJ - FL | Single A Jays | Post-Game | $16.51 | $16.51 | $0.00 |  |  |
| TBJ - FL | Single A Jays | Pre-Game | $16.51 | $16.51 | $0.00 |  |  |
| TBJ - NY | Buffalo Bisons | Breakfast | $27.34 | $27.34 | $0.00 |  |  |
| TBJ - NY | Buffalo Bisons | Lunch | $27.34 | $27.34 | $0.00 |  |  |
| TBJ - NY | Buffalo Bisons | Post-Game | $27.34 | $27.34 | $0.00 |  |  |
| TBJ - NY | Buffalo Bisons | Shake | $0.00 | $0.00 | $0.00 |  | PROJECTION PRICE MISSING - needs decision |
| TBJ - NY | Buffalo Bisons | Snack | $0.00 | $0.00 | $0.00 |  | PROJECTION PRICE MISSING - needs decision |
| TBJ - NY | Buffalo Bisons | Umpire | $27.34 | $27.34 | $0.00 |  |  |
| TBR - FL | Major League | Breakfast | $35.63 | $35.63 | $0.00 |  |  |
| TBR - FL | Major League | Dinner | $39.48 | $39.48 | $0.00 |  |  |
| TBR - FL | Major League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | $0.00 | is_flat_fee |  |
| TBR - FL | Major League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | $0.00 | is_flat_fee |  |
| TBR - FL | Major League | Lunch | $39.48 | $39.48 | $0.00 |  |  |
| TBR - FL | Major League | MLB - Extra MTO - Lrg | $15.00 | $15.00 | $0.00 | is_flat_fee |  |
| TBR - FL | Major League | MLB - Extra MTO - Med | $10.00 | $10.00 | $0.00 | is_flat_fee |  |
| TBR - FL | Major League | MLB - Extra MTO - Sm | $5.00 | $5.00 | $0.00 | is_flat_fee |  |
| TBR - FL | Major League | Umpire Meal | $39.48 |  |  |  | PROJECTION-ONLY - actuals not tracked yet |
| TBR - FL | Minor League | AFTER HOURS MEALS | $27.95 | $20.96 | -$6.99 |  | Cost-basis delta of -$6.99 |
| TBR - FL | Minor League | Breakfast - MiLB |  | $17.83 |  |  | ACTUALS-ONLY - new mid-season service? |
| TBR - FL | Minor League | Breakfast - MiLB ST | $23.77 |  |  |  | PROJECTION-ONLY - actuals not tracked yet |
| TBR - FL | Minor League | Dinner | $27.95 | $20.96 | -$6.99 |  | Cost-basis delta of -$6.99 |
| TBR - FL | Minor League | Extended Day labor |  | $280.00 |  | is_flat_fee | ACTUALS-ONLY - new mid-season service? |
| TBR - FL | Minor League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | $0.00 | is_flat_fee |  |
| TBR - FL | Minor League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | $0.00 | is_flat_fee |  |
| TBR - FL | Minor League | Lunch - MiLB |  | $21.67 |  |  | ACTUALS-ONLY - new mid-season service? |
| TBR - FL | Minor League | Lunch - MiLB ST | $28.90 |  |  |  | PROJECTION-ONLY - actuals not tracked yet |
| TBR - FL | Minor League | Road Sandwiches - MiLB | $15.00 | $15.00 | $0.00 |  |  |
| TXR - AZ | Major League | Breakfast | $35.72 | $28.58 | -$7.14 |  | Cost-basis delta of -$7.14 |
| TXR - AZ | Major League | Dinner | $35.72 | $28.58 | -$7.14 |  | Cost-basis delta of -$7.14 |
| TXR - AZ | Major League | Extra Protein - Beef/Seafood |  | $165.00 |  | is_flat_fee | ACTUALS-ONLY - new mid-season service? |
| TXR - AZ | Major League | Extra Protein - Chicken/Pork |  | $115.00 |  | is_flat_fee | ACTUALS-ONLY - new mid-season service? |
| TXR - AZ | Major League | Lunch | $35.72 | $28.58 | -$7.14 |  | Cost-basis delta of -$7.14 |
| TXR - AZ | Minor League | Breakfast | $17.87 | $14.29 | -$3.57 |  | Cost-basis delta of -$3.57 |
| TXR - AZ | Minor League | Continental Breakfast | $8.20 | $6.56 | -$1.64 |  | Cost-basis delta of -$1.64 |
| TXR - AZ | Minor League | Dinner | $17.87 | $14.29 | -$3.57 |  | Cost-basis delta of -$3.57 |
| TXR - AZ | Minor League | Extra Protein - Beef/Seafood |  | $165.00 |  | is_flat_fee | ACTUALS-ONLY - new mid-season service? |
| TXR - AZ | Minor League | Extra Protein - Chicken/Pork |  | $115.00 |  | is_flat_fee | ACTUALS-ONLY - new mid-season service? |
| TXR - AZ | Minor League | Lunch | $17.87 | $14.29 | -$3.57 |  | Cost-basis delta of -$3.57 |
| TXR - AZ | Minor League | Pre-Game Hot Snack | $13.66 | $10.93 | -$2.73 |  | Cost-basis delta of -$2.73 |
| TXR - AZ | Minor League | Regular Snack | $7.36 | $5.89 | -$1.47 |  | Cost-basis delta of -$1.47 |
| TXR - TX - H | Texas Rangers | Arrival | $25.95 |  |  |  |  |
| TXR - TX - H | Texas Rangers | Post BP | $25.95 |  |  |  |  |
| TXR - TX - H | Texas Rangers | Post-Game | $25.95 |  |  |  |  |
| TXR - TX - H | Texas Rangers | Umpire | $25.95 |  |  |  |  |
| TXR - TX - V | Texas Rangers | Arrival | $25.95 | $25.95 | $0.00 |  |  |
| TXR - TX - V | Texas Rangers | Post BP | $25.95 | $25.95 | $0.00 |  |  |
| TXR - TX - V | Texas Rangers | Post-Game | $25.95 | $25.95 | $0.00 |  |  |
| TXR - TX - V | Texas Rangers | Umpire | $25.95 | $25.95 | $0.00 |  |  |

## Summary

- Total distinct services per account:

  | Account | Count |
  |---|---|
  | CIN - AZ | 13 |
  | CIN - KY | 5 |
  | CIN - OH | 4 |
  | STL - FL | 11 |
  | STL - MO | 4 |
  | TBJ - FL | 21 |
  | TBJ - NY | 6 |
  | TBR - FL | 19 |
  | TXR - AZ | 13 |
  | TXR - TX - H | 4 |
  | TXR - TX - V | 4 |
  | **TOTAL** | **104** |

- Services with $0 / missing pricing across both tabs (or proj-only with $0/missing): 3
  - STL - FL | MiLB | Snack
  - TBJ - NY | Buffalo Bisons | Shake
  - TBJ - NY | Buffalo Bisons | Snack

- Services that are actuals-only (no projection equivalent): 10
  - STL - FL | Palm Beach Cardinals | Breakfast (actuals price $26.00)
  - TBJ - FL | Other | Scout Meals (actuals price $11.55)
  - TBJ - FL | SSM | Florida Ops - PDC (actuals price $11.55)
  - TBR - FL | Minor League | Breakfast - MiLB (actuals price $17.83)
  - TBR - FL | Minor League | Extended Day labor (actuals price $280.00)
  - TBR - FL | Minor League | Lunch - MiLB (actuals price $21.67)
  - TXR - AZ | Major League | Extra Protein - Beef/Seafood (actuals price $165.00)
  - TXR - AZ | Major League | Extra Protein - Chicken/Pork (actuals price $115.00)
  - TXR - AZ | Minor League | Extra Protein - Beef/Seafood (actuals price $165.00)
  - TXR - AZ | Minor League | Extra Protein - Chicken/Pork (actuals price $115.00)

- Services that are projection-only despite an actuals tab existing: 4
  - STL - FL | Palm Beach Cardinals | Arrival (projection price $26.00)
  - TBR - FL | Major League | Umpire Meal (projection price $39.48)
  - TBR - FL | Minor League | Breakfast - MiLB ST (projection price $23.77)
  - TBR - FL | Minor League | Lunch - MiLB ST (projection price $28.90)

- Flag tallies:
  - is_flat_fee: 15
  - is_tax_free: 2
  - is_non_revenue: 1

- Cost-basis delta observations (accounts with systematic projection vs actuals price gaps):
  - **CIN - AZ**: 11 services with non-zero delta. 11 of 11 are negative (actuals cheaper). Avg delta: $-5.84.
  - **TBJ - FL**: 1 services with non-zero delta. 1 of 1 are negative (actuals cheaper). Avg delta: $-1.00.
  - **TBR - FL**: 2 services with non-zero delta. 2 of 2 are negative (actuals cheaper). Avg delta: $-6.99.
  - **TXR - AZ**: 9 services with non-zero delta. 9 of 9 are negative (actuals cheaper). Avg delta: $-4.22.

- Open questions / decisions still pending (from mapping doc + this comparison):
  - STL - FL 'Snack' (col S in projections) has no listed price - confirm intended price or omit from import.
  - TBJ - NY 'Snack' (N) and 'Shake' (P) both have $0 prices in BOTH tabs - real services awaiting pricing, or skip?
  - TBJ - FL actuals tab introduces 'Florida Ops - PDC' and 'Scout Meals' (both at $11.55) and 'Media Meals' at $15 (vs projection $16). Reconcile canonical service list.
  - TBR - FL actuals tab introduces 'Extended Day labor' at $280 flat and replaces 'Umpire Meal' (drops it). Confirm canonical set.
  - TBR - FL actuals tab renames 'Breakfast - MiLB ST' -> 'Breakfast - MiLB' and 'Lunch - MiLB ST' -> 'Lunch - MiLB'. Same service mid-season name change, or distinct services?
  - TXR - AZ actuals tab introduces 4 'Extra Protein' services (MLB Chicken/Pork, MLB Beef/Seafood, MiLB Chicken/Pork, MiLB Beef/Seafood) at flat $115 / $165. Confirm they should be added to projections canonical set.
  - PDC cost-basis pattern: CIN - AZ, TXR - AZ, TBR - FL all show projection (retail) vs actuals (cost-basis) split. Confirm canonical sc_service_prices stores PROJECTION price; cost basis is internal margin tracking.
  - TBJ - FL actuals tab uses different group assignment: 'Florida Ops - PDC' falls inside the SSM merged region (AJ-AM); projections puts SSM as a single-service group. Decide whether SSM expands or Florida Ops belongs to 'Other'.
  - TBJ - FL Major League - PDC 'Snack' projection price ($1.70) vs actuals ($1.70) match, but Snack price feels low for a meal-shaped service - confirm intended.
  - STL - FL has THREE projection-like tabs (Projections, Projections Br); only the canonical Projections tab is compared here. Confirm Projections Br is deprecated.
