# Reconciliation - purchasing_actuals to finance P&L

## Standing rule (Kevin 2026-09-17)

**The P&L is the answer. Where our total differs from finance, we reconcile our side to match. We do not wait for the source system.**

Finance's P&L is the ground truth for every GL line. When the board's aggregated total for an account × range × line disagrees with finance's actual for the same slice, we correct our side - by exclusion flags on duplicate captures, by data loads for finance-only lines, or by whatever surgical fix keeps aggregation matching without changing what the source system holds. The source system (bill.com, Rippling) can lag or carry its own duplicates; we do not gate on it.

**Consequence:** flagged rows survive future syncs cleanly. If bill.com later voids one of our flagged duplicates, the sync deletes the row and our flag goes with it. If Rippling re-captures a pending/settled pair, our flag stays until the sync updates or removes it. Either way we are not left with a phantom.

## Caveat before the index

Reconciliation knowledge is currently split across `docs/KPI_MASTER_SCOPE.md`, `docs/BUSINESS_NOTES.md`, `docs/KPI_DASHBOARD_PLAYBOOK.md`, and (until this file) CC's memory. That fragmentation is why the resale-food accrual and the 3400.1 packaging inventory pattern were re-investigated during the 2026-09-17 audit even though both were already ruled on. **This index makes the knowledge navigable, not consolidated.** A separate follow-up would be to fold the pieces into one canonical location per line - flagged, not scheduled here.

## Index shape

Each entry: `account · line · range · the gap · cause · status · where the detail lives`

## By design · never reconciles

| account | line | range | the gap | cause | status | where the detail lives |
|---|---|---|---|---|---|---|
| TBJ - FL | 3200.2 Resale Food (Fun Money) | all | budget = actual by design | Finance accrues to budget (R-73). Board reads the same. | by design | `docs/KPI_MASTER_SCOPE.md` (R-17c) + R-73 doctrine |
| all 4 accounts | 5017.3 Perks | all | consistent under-attribution vs pnl_actuals flat budget | Also-tracked band reads Rippling perks card spend; finance books flat budget of $1,485/year. Confirming with Sebastian. | by design (pending Sebastian) | `docs/KPI_MASTER_SCOPE.md` (R-17b + open Q at :402) |
| TBJ - FL | 3400.1 Packaging | all | six periods differ by exactly the inventory JE; parent 3400 agrees | Finance folds packaging inventory into 3400.1; board keeps synthetic 3400.INVJE row per R-74. | by design | `docs/BUSINESS_NOTES.md` (GL mapping conventions) |
| all accounts | every budget line | all | $1-$2 per line per range | Board derives period budget as `annual ÷ 13 × N` with float precision; finance reads whole-dollar per-period figures. | by design | `docs/BUSINESS_NOTES.md` (Budget derivation drift) |
| CIN - OH · STL - MO | food (all lines) | all | ~$17K inventory each vs finance's $0 food | Pass-through accounts · client-owned product. Structural, not a defect. | by design | `docs/KPI_MASTER_SCOPE.md` R898-8 |

## Fixed · with dates

| account | line | range | the gap | cause | status | where the detail lives |
|---|---|---|---|---|---|---|
| all with 3500.2 | 3500.2 Vehicle Insurance | all periods | board read $0; finance had $273-$611/period | Finance line never loaded into purchasing_actuals. | fixed 2026-09-17 | R-114 PR 2 (#1165) · `docs/migrations/2026-09-17-r114-item6-load-3500-2-into-purchasing-actuals.sql` |
| all 8 accounts | inventory adjustments · P9 | P9 | 24 rows never loaded | Manual workbook entry per R-61. | fixed 2026-09-17 | R-114 PR 2 (#1165) · `docs/migrations/2026-09-17-r114-item7-p9-inventory-adjustments.sql` |
| TBJ - FL · TBR - FL | 3400.1 P9 · 3500.1 P1 · 3500.5 P9 | LP / CY | $150 + $96.33 + $1,000 finance-only amounts | Not on bill.com, not on Rippling card. | fixed 2026-09-17 | R-114 follow-up (#1170) · `docs/migrations/2026-09-17-r114-followup-missing-finance-line-actuals.sql` |
| TBR - FL | 3500.3 Leased vehicle | CY | +$1,761.88 (Enterprise Rent A Car 08/13 duplicate) | Rippling pending/settled pair captured twice · `dup_rippling` | fixed 2026-09-17 | `docs/RECONCILIATION.md` (this file, below) |
| TBJ - FL | 3400.5 Linen | CY | +$2,823.39 (10× Cintas 04/06/26 unpaid duplicates) | bill.com duplicates on unpaid rows; one paid row is the real week · `dup_billcom` | fixed 2026-09-17 | `docs/RECONCILIATION.md` (this file, below) |
| TXR - AZ | 3100.2 Salary (Anna Hughes) | LP · CY | +$6,730.78 (7 weeks 2026-07-20..2026-08-31) | Anna was hourly through 2026-09-04; Rippling classifier flipped her to salaried starting 2026-07-20 while she still had hourly hours in those weeks. Loader now gates: a worker with hourly hours in a week is not salaried that week. | fixed 2026-09-17 | Anna PR · `scripts/derive_salary_actuals.mjs` (hourly-week gate) + `scripts/probes/_probe_salary_hourly_overlap.mjs` (standing gate) |

## Open

| account | line | range | the gap | cause | status | where the detail lives |
|---|---|---|---|---|---|---|
| TXR - AZ | 3100.2 salary | CY | ~$84,000 break at P5 | Two methods agree through P1-P4 and diverge from P5. R-115 pending. | open · pending R-115 | `docs/backlog/r115-txr-az-3100-2-salary-two-methods.md` |
| TXR - AZ · CIN - AZ | 3200.1 General Food | CY | -$18,198 (TXR - AZ), -$14,056 (CIN - AZ) | Finance rolls 3200.1.1 + 3200.1.2 children into 3200.1; our board reads the exact code `3200.1` only. Requires `code_remap` or aggregation fix. | open | `docs/KPI_DASHBOARD_PLAYBOOK.md:141` (partial - sub-codes named, reconciliation angle not) |
| TBR - FL | 3200 Food | CP · P10 | $115.27 (INV6 probe fail) | Standing r109_guard3 probe fail. Not diagnosed. | open · logged | `docs/backlog/inv6-tbr-fl-p10-food-115.md` |
| TBR - FL | Labor closed-week Guard 1 | CP | $431 | Labor's post-1049 accrual double-counts 2200 per R-96. Obvious fix (Option A) re-lands the double-count. Correct fix is fee/4 not accrual/4. | open · log-only 2026-09-14 | `docs/backlog/guard1-tbr-cp-431.md` |
| TBJ - FL | 3400.5 Linen | CY | 1¢ | Float summation drift across 44 remaining rows post-dedup. | open · not chasing | `docs/RECONCILIATION.md` (this file, below) |

## Resolved (once you know)

| account | line | range | the gap | cause | status | where the detail lives |
|---|---|---|---|---|---|---|
| TXR - AZ | 5002.5 Equipment | CY | $17,943 (pnl > board) | Client bill-back that settles in the next period. Deltas disappear as the receivable settles. | resolved · not a defect | `docs/BUSINESS_NOTES.md` (TXR - AZ 5002.5 client bill-back) |

---

## Flag details (2026-09-17)

### TBJ - FL · 3400.5 Linen · ten Cintas duplicates · `dup_billcom`

- **Finance YTD:** $7,430.31
- **Our YTD before flag:** $10,253.70
- **Gap:** $2,823.39 = exactly ten bill.com rows dated 2026-04-06 at $282.34 each, all `paid = false`. One paid row at the same date + amount + line (`source_bill_id = 00n01ISSKZCCKE8m8md6`) is the real week's charge.
- **Flag SQL:**
  ```sql
  UPDATE purchasing_actuals
  SET excluded = true, account_key = NULL, reason = 'dup_billcom'
  WHERE account_key = 'TBJ - FL'
    AND gl_line_code = '3400.5'
    AND amount = 282.34
    AND txn_date = '2026-04-06'
    AND paid = false
    AND excluded = false;
  ```
- **Rows affected:** 10 (IDs 26725, 27022, 27526, 27997, 28162, 29156, 29173, 163026, 164049, 164279)
- **Post-flag verify:** $7,430.30 (1¢ float-summation drift across 44 remaining rows; no missing entry).

### TBR - FL · 3500.3 Leased vehicle · one Enterprise Rent A Car duplicate · `dup_rippling`

- **Finance YTD:** $12,385.57
- **Our YTD before flag:** $14,147.45
- **Gap:** $1,761.88 = one duplicate rippling_spend row for Enterprise Rent A Car. Two consecutive-day captures (08/12 and 08/13) at $1,761.88 each, same merchant, distinct Rippling IDs, both `paid = false`, both `approx_date = true`, both in the same sync (derived_at 2026-09-17 08:29:41 UTC). Consistent with a pending/settled pair captured twice; finance's ledger records one rental.
- **Flag SQL:**
  ```sql
  UPDATE purchasing_actuals
  SET excluded = true, account_key = NULL, reason = 'dup_rippling'
  WHERE source_line_id = 'rippling_spend:01a044aa-d44e-74d0-b438-b9ab936e1a2a';
  ```
- **Rows affected:** 1 (ID 645975, the 08/13 capture; 08/12 kept as the real rental)
- **Post-flag verify:** $12,385.57 ✓ exact match to finance.

## Constraint compliance (for future flags)

Both flags set `account_key = NULL` alongside `excluded = true` and `reason = <token>`. This matches `purchasing_actuals_excluded_shape` (`NOT (excluded = true AND account_key IS NOT NULL)`) and `purchasing_actuals_reason_shape` (`reason IS NULL OR excluded = true`), and follows the 7,994-row precedent already in the table where every excluded row nulls its account. Reason tokens (`dup_rippling`, `dup_billcom`) match the existing enum-like convention: `map_excluded`, `auth_pair`, `zero_amount`, `dup_split`, `non_usd`, `report_coded`.
