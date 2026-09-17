# Reconciliation - purchasing_actuals to finance P&L

## Standing rule (Kevin 2026-09-17)

**The P&L is the answer. Where our total differs from finance, we reconcile our side to match. We do not wait for the source system.**

Finance's P&L is the ground truth for every GL line. When the board's aggregated total for an account × range × line disagrees with finance's actual for the same slice, we correct our side - by exclusion flags on duplicate captures, by data loads for finance-only lines (like R-114 PR 2's 3500.2 vehicle insurance, R-114 follow-up's 3400.1 / 3500.1 / 3500.5), or by whatever surgical fix keeps aggregation matching without changing what the source system holds. The source system (bill.com, Rippling) can lag or carry its own duplicates; we do not gate on it.

**Consequence:** flagged rows survive future syncs cleanly. If bill.com later voids one of our flagged duplicates, the sync deletes the row and our flag goes with it. If Rippling re-captures a pending/settled pair, our flag stays until the sync updates or removes it. Either way we are not left with a phantom.

## Flags applied 2026-09-17

### TBJ - FL · 3400.5 Linen · ten Cintas duplicates

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

### TBR - FL · 3500.3 Leased vehicle · one Enterprise Rent A Car duplicate

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

## Constraint compliance

Both flags set `account_key = NULL` alongside `excluded = true` and `reason = <token>`. This matches `purchasing_actuals_excluded_shape` (`NOT (excluded = true AND account_key IS NOT NULL)`) and `purchasing_actuals_reason_shape` (`reason IS NULL OR excluded = true`), and follows the 7,994-row precedent already in the table where every excluded row nulls its account. Reason tokens (`dup_rippling`, `dup_billcom`) match the existing enum-like convention: `map_excluded`, `auth_pair`, `zero_amount`, `dup_split`, `non_usd`, `report_coded`.
