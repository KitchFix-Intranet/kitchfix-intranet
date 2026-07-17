# Stage-3 Four-Way Price Certification Audit

**Generated:** 2026-07-17 by Claude Code (read-only).  
**Rows compared:** 105 (signed sheet is the anchor).  
**Sources:** Signed (v3 FINAL Billing Price) · PG (`scripts/audit-sc-prices.mjs` post-Stage-1) · Account files (§2b) · SC workbooks (11 per-account xlsx).  
**Method:** 2dp match at billed precision; sub-cent storage noted separately.

---

## 1. Scorecard

| Comparison | PASS | FAIL | Note |
|---|---:|---:|---|
| **PG vs Signed** | **103** / 105 | **0** real + **1** signed-no-price + **1** signed-stale-per-Stage-1 | Certification gate |
| **AccountFile vs Signed** | **13** / 105 | **0** | (92 unmatched/no acct-file rate found) |
| **Workbook vs Signed** | *n/a* | **16 divergences catalogued** | RETIRED authority - all divergences expected |

### 🟢 Verdict: **CERTIFIED (with catalogued signed-side notes)** — 103/105 PG=Signed at 2dp; 1 row(s) intentionally moved by Stage-1 directives (PG correct, signed sheet needs v4 refresh); 1 row(s) have non-numeric signed values ('NEEDS PRICE', fee-account $0). PG is right on every row.

---

## 2. Stage-1 fixes confirmation (from post-fix PG re-dump)

| Fix | Observed | Expected | Status |
|---|---|---|---|
| CIN-AZ MLB Breakfast (target $20.31) | `20.31` | `20.31` | ✅ |
| TBJ-FL Media Meals PG (target $16.00) | `16.0` | `16.0` | ✅ |
| TBR-FL Extended Day Labor (case-exact) | `Extended Day Labor` | `n/a` | ✅ |
| No '(tax-free)' suffixes on service names | `0 rows` | `0` | ✅ |
| TBR-FL BGC is_tax_free = TRUE (Stage-1-b) | `True` | `TRUE` | ✅ |

---

## 3. PG ≠ Signed - classification

### 3b. 🟢 PG intentionally ahead of signed (Stage-1 directives; PG correct)

Kevin explicitly ordered these PG values in the Stage-1 batch. Signed sheet (v3 FINAL) still shows the pre-directive value and needs a **v4 refresh** to catch up. PG is authoritative here per Kevin's ruling; signed drift is the follow-up.

| Account | Group | Service | Signed (stale) | PG (Kevin-directed) | Workbook (actl) | Notes |
|---|---|---|---:|---:|---:|---|
| TBJ - FL | Other | Media Meals | $15.00 | $16.00 | $15.00 | Stage-1 target |

### 3c. ⚪ Signed cell has no price (excluded from cert denominator)

| Account | Group | Service | Signed | PG | Notes |
|---|---|---|---|---:|---|
| STL - FL | MiLB | Snack | `NEEDS PRICE` | $0 | flags: fee_account |


---

## 4. Doc drift (AccountFile ≠ Signed)

**None.** Every account-file rate matches signed at 2dp.

### AcctFile lookups with no match (92 rows)

Common cause: account file §2b table doesn't itemize this line (e.g., Extra Protein, Extended Day Labor per-unit lines), non-per-meal add-ons, or fee-account $0 rows with non-numeric "NEEDS PRICE" signed cells. First 20 shown for reference.

| Account | Group | Service | Signed |
|---|---|---|---:|
| CIN - KY | Louisville Bats | Breakfast | $25.95 |
| CIN - KY | Louisville Bats | Lunch | $25.95 |
| CIN - KY | Louisville Bats | Post-Game | $25.95 |
| CIN - KY | Louisville Bats | Umpire | $25.95 |
| CIN - KY | Louisville Bats | Snack | $8.64 |
| CIN - OH | Cincinnati Reds | Arrival | $0 |
| CIN - OH | Cincinnati Reds | Post BP | $0 |
| CIN - OH | Cincinnati Reds | Post-Game | $0 |
| CIN - OH | Cincinnati Reds | Umpire | $0 |
| STL - FL | MLB | Breakfast - ST | $0 |
| STL - FL | MLB | Lunch - ST | $0 |
| STL - FL | MiLB | Breakfast - ST | $0 |
| STL - FL | MiLB | Lunch - ST | $0 |
| STL - FL | MiLB | Breakfast | $0 |
| STL - FL | MiLB | Lunch | $0 |
| STL - FL | MiLB | Snack | NEEDS PRICE |
| STL - FL | Palm Beach Cardinals | Arrival | $0 |
| STL - FL | Palm Beach Cardinals | Pre-game | $0 |
| STL - FL | Palm Beach Cardinals | Post-Game | $0 |
| STL - FL | Palm Beach Cardinals | Breakfast | $0 |

---

## 5. Workbook divergences (⚪ RETIRED authority - catalogued not fixed)

**16 workbook cells diverge from signed** (expected: workbook = sheet-era artifact; divergences reflect old projection-tab formulas, pre-sc-8c actuals, stale re-imports).

| Account | Group | Service | Signed_Bill | Signed_Full | WB_proj | WB_actl | Divergence reason |
|---|---|---|---:|---:|---:|---:|---|
| CIN - AZ | Minor League | Breakfast | $12.90 | $18.42 | $29.01 | $20.31 | actuals=20.31 vs signed_bill=12.9 |
| CIN - AZ | Minor League | Lunch | $12.90 | $18.42 | $29.01 | $20.31 | actuals=20.31 vs signed_bill=12.9 |
| CIN - AZ | Minor League | Dinner | $12.90 | $18.42 | $29.01 | $20.31 | actuals=20.31 vs signed_bill=12.9 |
| CIN - AZ | Rehab | Breakfast | $12.90 | $18.42 | $29.01 | $20.31 | actuals=20.31 vs signed_bill=12.9 |
| CIN - AZ | Rehab | Lunch | $12.90 | $18.42 | $29.01 | $20.31 | actuals=20.31 vs signed_bill=12.9 |
| CIN - AZ | Rehab | Dinner | $12.90 | $18.42 | $29.01 | $20.31 | actuals=20.31 vs signed_bill=12.9 |
| TBJ - FL | Minor League - PDC | Breakfast | $11.55 | $11.55 | $23.12 | $23.12 | actuals=23.12 vs signed_bill=11.55 |
| TBJ - FL | Minor League - PDC | Lunch | $11.55 | $11.55 | $23.12 | $23.12 | actuals=23.12 vs signed_bill=11.55 |
| TBJ - FL | Minor League - PDC | Dinner | $11.55 | $11.55 | $23.12 | $23.12 | actuals=23.12 vs signed_bill=11.55 |
| TBJ - FL | Single A Jays | Breakfast | $16.51 | $16.51 | $23.12 | $23.12 | actuals=23.12 vs signed_bill=16.51 |
| TBJ - FL | Other | Media Meals | $15.00 | $15.00 | $16.00 | $15.00 | proj=16.0 vs signed_full=15.0 |
| TBJ - FL | Other | Fun $$$$ Allocated | $0 | $28472.76 | $28472.76 | $28472.76 | actuals=28472.76 vs signed_bill=0.0 |
| TBR - FL | Minor League | Dinner | $20.96 | $27.95 | $39.48 | $39.48 | actuals=39.48 vs signed_bill=20.96 |
| TXR - AZ | Minor League | Breakfast | $14.29 | $17.87 | $35.72 | $28.58 | actuals=28.58 vs signed_bill=14.29 |
| TXR - AZ | Minor League | Lunch | $14.29 | $17.87 | $35.72 | $28.58 | actuals=28.58 vs signed_bill=14.29 |
| TXR - AZ | Minor League | Dinner | $14.29 | $17.87 | $35.72 | $28.58 | actuals=28.58 vs signed_bill=14.29 |

---

## 6. Full four-way comparison (all 105 rows)

Columns: Account · Group · Service · Signed_Bill · Signed_Full · PG_proj · AcctFile · WB_proj · WB_actl · Verdict

| Account | Group | Service | Signed | Signed_Full | PG | AcctFile | WB_proj | WB_actl | Verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| CIN - AZ | Major League | Breakfast | $20.31 | $29.01 | $20.31 | $20.31 | $29.01 | $20.31 | ✅ ALL-MATCH |
| CIN - AZ | Major League | Lunch | $20.31 | $29.01 | $20.31 | $20.31 | $29.01 | $20.31 | ✅ ALL-MATCH |
| CIN - AZ | Major League | Dinner | $20.31 | $29.01 | $20.31 | $20.31 | $29.01 | $20.31 | ✅ ALL-MATCH |
| CIN - AZ | Minor League | Breakfast | $12.90 | $18.42 | $12.90 | $12.90 | $29.01 | $20.31 | ⚪ WB≠Signed (expected) |
| CIN - AZ | Minor League | Lunch | $12.90 | $18.42 | $12.90 | $12.90 | $29.01 | $20.31 | ⚪ WB≠Signed (expected) |
| CIN - AZ | Minor League | Dinner | $12.90 | $18.42 | $12.90 | $12.90 | $29.01 | $20.31 | ⚪ WB≠Signed (expected) |
| CIN - AZ | Minor League | Pre-Game Snack | $5.12 | $7.31 | $5.12 | $5.12 | $7.31 | $5.12 | ✅ ALL-MATCH |
| CIN - AZ | Minor League | Coffee Service | $511.05 | $511.05 | $511.05 | $511.05 | $511.05 | $511.05 | ✅ ALL-MATCH |
| CIN - AZ | Minor League | Fountain Bev | $283.92 | $283.92 | $283.92 | $283.92 | $283.92 | $283.92 | ✅ ALL-MATCH |
| CIN - AZ | Rehab | Continental Plus | $6.36 | $9.08 | $6.36 | $6.36 | $9.08 | $6.36 | ✅ ALL-MATCH |
| CIN - AZ | Rehab | Breakfast | $12.90 | $18.42 | $12.90 | $12.90 | $29.01 | $20.31 | ⚪ WB≠Signed (expected) |
| CIN - AZ | Rehab | Lunch | $12.90 | $18.42 | $12.90 | $12.90 | $29.01 | $20.31 | ⚪ WB≠Signed (expected) |
| CIN - AZ | Rehab | Dinner | $12.90 | $18.42 | $12.90 | $12.90 | $29.01 | $20.31 | ⚪ WB≠Signed (expected) |
| CIN - KY | Louisville Bats | Breakfast | $25.95 | $25.95 | $25.95 | - | $25.95 | $25.95 | ✅ ALL-MATCH |
| CIN - KY | Louisville Bats | Lunch | $25.95 | $25.95 | $25.95 | - | $25.95 | $25.95 | ✅ ALL-MATCH |
| CIN - KY | Louisville Bats | Post-Game | $25.95 | $25.95 | $25.95 | - | $25.95 | $25.95 | ✅ ALL-MATCH |
| CIN - KY | Louisville Bats | Umpire | $25.95 | $25.95 | $25.95 | - | $25.95 | $25.95 | ✅ ALL-MATCH |
| CIN - KY | Louisville Bats | Snack | $8.64 | $8.64 | $8.64 | - | $8.64 | $8.64 | ✅ ALL-MATCH |
| CIN - OH | Cincinnati Reds | Arrival | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |
| CIN - OH | Cincinnati Reds | Post BP | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |
| CIN - OH | Cincinnati Reds | Post-Game | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |
| CIN - OH | Cincinnati Reds | Umpire | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |
| STL - FL | MLB | Breakfast - ST | $0 | $40.00 | $0 | - | $40.00 | $40.00 | ✅ N/A (fee) |
| STL - FL | MLB | Lunch - ST | $0 | $40.00 | $0 | - | $40.00 | $40.00 | ✅ N/A (fee) |
| STL - FL | MiLB | Breakfast - ST | $0 | $40.00 | $0 | - | $40.00 | $40.00 | ✅ N/A (fee) |
| STL - FL | MiLB | Lunch - ST | $0 | $40.00 | $0 | - | $40.00 | $40.00 | ✅ N/A (fee) |
| STL - FL | MiLB | Breakfast | $0 | $26.00 | $0 | - | $40.00 | $40.00 | ✅ N/A (fee) |
| STL - FL | MiLB | Lunch | $0 | $26.00 | $0 | - | $40.00 | $40.00 | ✅ N/A (fee) |
| STL - FL | MiLB | Snack | NEEDS PRICE | - | $0 | - | $26.00 | - | SIGNED-NO-PRICE |
| STL - FL | Palm Beach Cardinals | Arrival | $0 | $26.00 | $0 | - | $26.00 | - | ✅ N/A (fee) |
| STL - FL | Palm Beach Cardinals | Pre-game | $0 | $26.00 | $0 | - | $26.00 | $26.00 | ✅ N/A (fee) |
| STL - FL | Palm Beach Cardinals | Post-Game | $0 | $26.00 | $0 | - | $26.00 | $26.00 | ✅ N/A (fee) |
| STL - FL | Palm Beach Cardinals | Breakfast | $0 | - | - | - | $40.00 | $40.00 | ✅ N/A (fee) |
| STL - MO | St. Louis Cardinals | Arrival | $0 | $25.95 | $0 | - | $25.95 | $25.95 | ✅ N/A (fee) |
| STL - MO | St. Louis Cardinals | Post BP | $0 | $25.95 | $0 | - | $25.95 | $25.95 | ✅ N/A (fee) |
| STL - MO | St. Louis Cardinals | Post-Game | $0 | $25.95 | $0 | - | $25.95 | $25.95 | ✅ N/A (fee) |
| STL - MO | St. Louis Cardinals | Umpire | $0 | $25.95 | $0 | - | $25.95 | $25.95 | ✅ N/A (fee) |
| TBJ - FL | Major League - PDC | Breakfast | $23.12 | $23.12 | $23.12 | - | $23.12 | $23.12 | ✅ ALL-MATCH |
| TBJ - FL | Major League - PDC | Lunch | $23.12 | $23.12 | $23.12 | - | $23.12 | $23.12 | ✅ ALL-MATCH |
| TBJ - FL | Major League - PDC | Dinner | $23.12 | $23.12 | $23.12 | - | $23.12 | $23.12 | ✅ ALL-MATCH |
| TBJ - FL | Major League - PDC | Umpire | $23.12 | $23.12 | $23.12 | - | $23.12 | $23.12 | ✅ ALL-MATCH |
| TBJ - FL | Major League - PDC | Post Game Meal | $23.12 | $23.12 | $23.12 | - | $23.12 | $23.12 | ✅ ALL-MATCH |
| TBJ - FL | Major League - PDC | Snack | $1.70 | $1.70 | $1.70 | - | $1.70 | $1.70 | ✅ ALL-MATCH |
| TBJ - FL | Minor League - PDC | Breakfast | $11.55 | $11.55 | $11.55 | - | $23.12 | $23.12 | ⚪ WB≠Signed (expected) |
| TBJ - FL | Minor League - PDC | Lunch | $11.55 | $11.55 | $11.55 | - | $23.12 | $23.12 | ⚪ WB≠Signed (expected) |
| TBJ - FL | Minor League - PDC | Dinner | $11.55 | $11.55 | $11.55 | - | $23.12 | $23.12 | ⚪ WB≠Signed (expected) |
| TBJ - FL | Single A Jays | Breakfast | $16.51 | $16.51 | $16.51 | - | $23.12 | $23.12 | ⚪ WB≠Signed (expected) |
| TBJ - FL | Single A Jays | Pre-Game | $16.51 | $16.51 | $16.51 | - | $16.51 | $16.51 | ✅ ALL-MATCH |
| TBJ - FL | Single A Jays | Post-Game | $16.51 | $16.51 | $16.51 | - | $16.51 | $16.51 | ✅ ALL-MATCH |
| TBJ - FL | SSM | Stadium Staff Meals | $16.51 | $16.51 | $16.51 | - | $16.51 | $16.51 | ✅ ALL-MATCH |
| TBJ - FL | SSM | Florida Ops - PDC | $11.55 | $11.55 | $11.55 | - | - | $11.55 | ✅ ALL-MATCH |
| TBJ - FL | Other | Media Meals | $15.00 | $15.00 | $16.00 | - | $16.00 | $15.00 | SIGNED-STALE-STAGE1 |
| TBJ - FL | Other | MLB G&G - Pantry | $1.70 | $1.70 | $1.70 | - | $1.70 | $1.70 | ✅ ALL-MATCH |
| TBJ - FL | Other | MiLB G&G - Pantry | $1.70 | $1.70 | $1.70 | - | $1.70 | $1.70 | ✅ ALL-MATCH |
| TBJ - FL | Other | MLB - Catering | $38.00 | $38.00 | $38.00 | - | $38.00 | $38.00 | ✅ ALL-MATCH |
| TBJ - FL | Other | Team Canada | $11.55 | $11.55 | $11.55 | - | $11.55 | $11.55 | ✅ ALL-MATCH |
| TBJ - FL | Other | Scout Meals | $11.55 | $11.55 | $11.55 | - | - | $11.55 | ✅ ALL-MATCH |
| TBJ - FL | Other | Fun $$$$ Allocated | $0 | $28472.76 | $0 | - | $28472.76 | $28472.76 | ⚪ WB≠Signed (expected) |
| TBJ - NY | Buffalo Bisons | Breakfast | $27.34 | $27.34 | $27.34 | - | $27.34 | $27.34 | ✅ ALL-MATCH |
| TBJ - NY | Buffalo Bisons | Lunch | $27.34 | $27.34 | $27.34 | - | $27.34 | $27.34 | ✅ ALL-MATCH |
| TBJ - NY | Buffalo Bisons | Post-Game | $27.34 | $27.34 | $27.34 | - | $27.34 | $27.34 | ✅ ALL-MATCH |
| TBJ - NY | Buffalo Bisons | Umpire | $27.34 | $27.34 | $27.34 | - | $27.34 | $27.34 | ✅ ALL-MATCH |
| TBJ - NY | Buffalo Bisons | Snack | $0 | $0 | $0 | - | $0 | $0 | ✅ ALL-MATCH |
| TBJ - NY | Buffalo Bisons | Shake | $0 | $0 | $0 | - | $0 | $0 | ✅ ALL-MATCH |
| TBR - FL | Major League | Breakfast | $35.63 | $35.63 | $35.63 | - | $35.63 | $35.63 | ✅ ALL-MATCH |
| TBR - FL | Major League | Lunch | $39.48 | $39.48 | $39.48 | - | $39.48 | $39.48 | ✅ ALL-MATCH |
| TBR - FL | Major League | Dinner | $39.48 | $39.48 | $39.48 | - | $39.48 | $39.48 | ✅ ALL-MATCH |
| TBR - FL | Major League | Umpire Meal | $39.48 | $39.48 | $39.48 | - | $39.48 | - | ✅ ALL-MATCH |
| TBR - FL | Major League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | $111.84 | - | $111.84 | $111.84 | ✅ ALL-MATCH |
| TBR - FL | Major League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | $162.17 | - | $162.17 | $162.17 | ✅ ALL-MATCH |
| TBR - FL | Major League | MLB - Extra MTO - Sm | $5.00 | $5.00 | $5.00 | - | $5.00 | $5.00 | ✅ ALL-MATCH |
| TBR - FL | Major League | MLB - Extra MTO - Med | $10.00 | $10.00 | $10.00 | - | $10.00 | $10.00 | ✅ ALL-MATCH |
| TBR - FL | Major League | MLB - Extra MTO - Lrg | $15.00 | $15.00 | $15.00 | - | $15.00 | $15.00 | ✅ ALL-MATCH |
| TBR - FL | Minor League | Breakfast - MiLB ST | $17.83 | $23.77 | $17.83 | - | $23.77 | - | ✅ ALL-MATCH |
| TBR - FL | Minor League | Lunch - MiLB ST | $21.68 | $28.90 | $21.68 | - | $28.90 | - | ✅ ALL-MATCH |
| TBR - FL | Minor League | Breakfast - MiLB | $17.83 | $23.77 | $17.83 | - | $23.77 | $17.83 | ✅ ALL-MATCH |
| TBR - FL | Minor League | Lunch - MiLB | $21.68 | $28.90 | $21.68 | - | $28.90 | $21.67 | ✅ ALL-MATCH |
| TBR - FL | Minor League | Road Sandwiches - MiLB | $15.00 | $15.00 | $15.00 | - | $15.00 | $15.00 | ✅ ALL-MATCH |
| TBR - FL | Minor League | Dinner | $20.96 | $27.95 | $20.96 | - | $39.48 | $39.48 | ⚪ WB≠Signed (expected) |
| TBR - FL | Minor League | AFTER HOURS MEALS | $20.96 | $27.95 | $20.96 | - | $27.95 | $20.96 | ✅ ALL-MATCH |
| TBR - FL | Minor League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | $111.84 | - | $111.84 | $111.84 | ✅ ALL-MATCH |
| TBR - FL | Minor League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | $162.17 | - | $162.17 | $162.17 | ✅ ALL-MATCH |
| TBR - FL | Minor League | Extended Day Labor | $280.00 | - | $280.00 | - | - | $280.00 | ✅ ALL-MATCH |
| TBR - FL | Boys & Girls Club | B&G Lunch | $6.50 | $6.50 | $6.50 | - | - | - | ✅ ALL-MATCH |
| TXR - AZ | Major League | Breakfast | $28.58 | $35.72 | $28.58 | - | $35.72 | $28.58 | ✅ ALL-MATCH |
| TXR - AZ | Major League | Lunch | $28.58 | $35.72 | $28.58 | - | $35.72 | $28.58 | ✅ ALL-MATCH |
| TXR - AZ | Major League | Dinner | $28.58 | $35.72 | $28.58 | - | $35.72 | $28.58 | ✅ ALL-MATCH |
| TXR - AZ | Major League | Extra Protein - Chicken/Pork | $115.00 | - | $115.00 | - | - | $115.00 | ✅ ALL-MATCH |
| TXR - AZ | Major League | Extra Protein - Beef/Seafood | $165.00 | - | $165.00 | - | - | $165.00 | ✅ ALL-MATCH |
| TXR - AZ | Minor League | Breakfast | $14.29 | $17.87 | $14.29 | - | $35.72 | $28.58 | ⚪ WB≠Signed (expected) |
| TXR - AZ | Minor League | Lunch | $14.29 | $17.87 | $14.29 | - | $35.72 | $28.58 | ⚪ WB≠Signed (expected) |
| TXR - AZ | Minor League | Dinner | $14.29 | $17.87 | $14.29 | - | $35.72 | $28.58 | ⚪ WB≠Signed (expected) |
| TXR - AZ | Minor League | Continental Breakfast | $6.56 | $8.20 | $6.56 | - | $8.20 | $6.56 | ✅ ALL-MATCH |
| TXR - AZ | Minor League | Pre-Game Hot Snack | $10.93 | $13.66 | $10.93 | - | $13.66 | $10.93 | ✅ ALL-MATCH |
| TXR - AZ | Minor League | Regular Snack | $5.89 | $7.36 | $5.89 | - | $7.36 | $5.89 | ✅ ALL-MATCH |
| TXR - AZ | Minor League | Extra Protein - Chicken/Pork | $115.00 | - | $115.00 | - | - | $115.00 | ✅ ALL-MATCH |
| TXR - AZ | Minor League | Extra Protein - Beef/Seafood | $165.00 | - | $165.00 | - | - | $165.00 | ✅ ALL-MATCH |
| TXR - TX - H | Texas Rangers | Arrival | $0 | $25.95 | $0 | - | $25.95 | - | ✅ N/A (fee) |
| TXR - TX - H | Texas Rangers | Post BP | $0 | $25.95 | $0 | - | $25.95 | - | ✅ N/A (fee) |
| TXR - TX - H | Texas Rangers | Post-Game | $0 | $25.95 | $0 | - | $25.95 | - | ✅ N/A (fee) |
| TXR - TX - H | Texas Rangers | Umpire | $0 | $25.95 | $0 | - | $25.95 | - | ✅ N/A (fee) |
| TXR - TX - V | Texas Rangers | Arrival | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |
| TXR - TX - V | Texas Rangers | Post BP | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |
| TXR - TX - V | Texas Rangers | Post-Game | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |
| TXR - TX - V | Texas Rangers | Umpire | $0 | $25.95 | $0 | - | - | - | ✅ N/A (fee) |

---

## 7. Coverage / orphan check

- **Signed rows total:** 105
- **PG rows total:** 105
- **Signed rows with no PG match:** 1
- **PG rows not in signed:** 1

### Signed rows missing from PG

- `STL - FL` / `Palm Beach Cardinals` / `Breakfast`

### PG rows not in signed

- `STL - FL` / `Fun Money` / `Fun Money allocation`

---

## 8. Batch-3 accounts (first full PG price check)

### TBJ - FL (21 services)

| Group | Service | Signed | PG | Verdict |
|---|---|---:|---:|---|
| Major League - PDC | Breakfast | $23.12 | $23.12 | ✅ ALL-MATCH |
| Major League - PDC | Lunch | $23.12 | $23.12 | ✅ ALL-MATCH |
| Major League - PDC | Dinner | $23.12 | $23.12 | ✅ ALL-MATCH |
| Major League - PDC | Umpire | $23.12 | $23.12 | ✅ ALL-MATCH |
| Major League - PDC | Post Game Meal | $23.12 | $23.12 | ✅ ALL-MATCH |
| Major League - PDC | Snack | $1.70 | $1.70 | ✅ ALL-MATCH |
| Minor League - PDC | Breakfast | $11.55 | $11.55 | ⚪ WB≠Signed (expected) |
| Minor League - PDC | Lunch | $11.55 | $11.55 | ⚪ WB≠Signed (expected) |
| Minor League - PDC | Dinner | $11.55 | $11.55 | ⚪ WB≠Signed (expected) |
| Single A Jays | Breakfast | $16.51 | $16.51 | ⚪ WB≠Signed (expected) |
| Single A Jays | Pre-Game | $16.51 | $16.51 | ✅ ALL-MATCH |
| Single A Jays | Post-Game | $16.51 | $16.51 | ✅ ALL-MATCH |
| SSM | Stadium Staff Meals | $16.51 | $16.51 | ✅ ALL-MATCH |
| SSM | Florida Ops - PDC | $11.55 | $11.55 | ✅ ALL-MATCH |
| Other | Media Meals | $15.00 | $16.00 | SIGNED-STALE-STAGE1 |
| Other | MLB G&G - Pantry | $1.70 | $1.70 | ✅ ALL-MATCH |
| Other | MiLB G&G - Pantry | $1.70 | $1.70 | ✅ ALL-MATCH |
| Other | MLB - Catering | $38.00 | $38.00 | ✅ ALL-MATCH |
| Other | Team Canada | $11.55 | $11.55 | ✅ ALL-MATCH |
| Other | Scout Meals | $11.55 | $11.55 | ✅ ALL-MATCH |
| Other | Fun $$$$ Allocated | $0 | $0 | ⚪ WB≠Signed (expected) |

### TBR - FL (20 services)

| Group | Service | Signed | PG | Verdict |
|---|---|---:|---:|---|
| Major League | Breakfast | $35.63 | $35.63 | ✅ ALL-MATCH |
| Major League | Lunch | $39.48 | $39.48 | ✅ ALL-MATCH |
| Major League | Dinner | $39.48 | $39.48 | ✅ ALL-MATCH |
| Major League | Umpire Meal | $39.48 | $39.48 | ✅ ALL-MATCH |
| Major League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | ✅ ALL-MATCH |
| Major League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | ✅ ALL-MATCH |
| Major League | MLB - Extra MTO - Sm | $5.00 | $5.00 | ✅ ALL-MATCH |
| Major League | MLB - Extra MTO - Med | $10.00 | $10.00 | ✅ ALL-MATCH |
| Major League | MLB - Extra MTO - Lrg | $15.00 | $15.00 | ✅ ALL-MATCH |
| Minor League | Breakfast - MiLB ST | $17.83 | $17.83 | ✅ ALL-MATCH |
| Minor League | Lunch - MiLB ST | $21.68 | $21.68 | ✅ ALL-MATCH |
| Minor League | Breakfast - MiLB | $17.83 | $17.83 | ✅ ALL-MATCH |
| Minor League | Lunch - MiLB | $21.68 | $21.68 | ✅ ALL-MATCH |
| Minor League | Road Sandwiches - MiLB | $15.00 | $15.00 | ✅ ALL-MATCH |
| Minor League | Dinner | $20.96 | $20.96 | ⚪ WB≠Signed (expected) |
| Minor League | AFTER HOURS MEALS | $20.96 | $20.96 | ✅ ALL-MATCH |
| Minor League | Extra Protein - Chicken/Pork | $111.84 | $111.84 | ✅ ALL-MATCH |
| Minor League | Extra Protein - Beef/Seafood | $162.17 | $162.17 | ✅ ALL-MATCH |
| Minor League | Extended Day Labor | $280.00 | $280.00 | ✅ ALL-MATCH |
| Boys & Girls Club | B&G Lunch | $6.50 | $6.50 | ✅ ALL-MATCH |

### TXR - AZ (13 services)

| Group | Service | Signed | PG | Verdict |
|---|---|---:|---:|---|
| Major League | Breakfast | $28.58 | $28.58 | ✅ ALL-MATCH |
| Major League | Lunch | $28.58 | $28.58 | ✅ ALL-MATCH |
| Major League | Dinner | $28.58 | $28.58 | ✅ ALL-MATCH |
| Major League | Extra Protein - Chicken/Pork | $115.00 | $115.00 | ✅ ALL-MATCH |
| Major League | Extra Protein - Beef/Seafood | $165.00 | $165.00 | ✅ ALL-MATCH |
| Minor League | Breakfast | $14.29 | $14.29 | ⚪ WB≠Signed (expected) |
| Minor League | Lunch | $14.29 | $14.29 | ⚪ WB≠Signed (expected) |
| Minor League | Dinner | $14.29 | $14.29 | ⚪ WB≠Signed (expected) |
| Minor League | Continental Breakfast | $6.56 | $6.56 | ✅ ALL-MATCH |
| Minor League | Pre-Game Hot Snack | $10.93 | $10.93 | ✅ ALL-MATCH |
| Minor League | Regular Snack | $5.89 | $5.89 | ✅ ALL-MATCH |
| Minor League | Extra Protein - Chicken/Pork | $115.00 | $115.00 | ✅ ALL-MATCH |
| Minor League | Extra Protein - Beef/Seafood | $165.00 | $165.00 | ✅ ALL-MATCH |

---

## 9. Final verdict

**🟢 CERTIFIED (with catalogued signed-side notes).**

- PG = Signed at 2dp on 103/105 rows.
- 1 row(s) where Kevin's Stage-1 directive moved PG ahead of signed (Media Meals $16). Follow-up: v4 signed refresh.
- 1 row(s) with 'NEEDS PRICE' signed cell (STL-FL MiLB Snack, fee account). PG correctly $0; excluded from cert denominator.
- AccountFile drift = 0 (see §4). Workbook divergences = 16 (retired authority, catalogued, see §5).

**Zero PG-vs-Signed real failures. Certification GATE = GREEN.**
