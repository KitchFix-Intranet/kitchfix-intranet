# Backlog · extend `purchasing_actuals.source` to include `pnl_finance_load`

Opened 2026-09-17 as a follow-up to R-114 PR 2 (#1165).

## Problem

`purchasing_actuals.source` is constrained to:

```sql
CHECK (source = ANY (ARRAY['billcom', 'billcom_credit', 'rippling_spend', 'upload']))
```

R-114 PR 2 loaded 3500.2 vehicle insurance rows from `pnl_actuals` into `purchasing_actuals`. None of the four allowed source values describes "finance-loaded from `pnl_actuals`". We shipped with `source = 'upload'` as the working substitute; the migration file header and this backlog entry carry the real provenance.

## Why this matters

The 3500.2 load is not a one-off. When finance publishes P10's P&L to `pnl_actuals`, the same SELECT block in R-114 PR 2's item 6 migration re-runs and the same rows re-land. As more finance-only lines get pulled in over time (5-series SG&A, other reimbursables), the same shape recurs. A real `pnl_finance_load` source would:

- disambiguate finance-loaded rows from CSV uploads in ad hoc queries and audits
- let a maintenance job identify + refresh finance-loaded rows on a schedule without touching CSV uploads
- carry semantic weight that survives past the migration file it came from

## Proposed change

Migration to extend the constraint:

```sql
ALTER TABLE purchasing_actuals DROP CONSTRAINT purchasing_actuals_source_check;
ALTER TABLE purchasing_actuals ADD CONSTRAINT purchasing_actuals_source_check
  CHECK (source = ANY (ARRAY[
    'billcom', 'billcom_credit', 'rippling_spend',
    'upload', 'pnl_finance_load'
  ]));
```

Then a data migration to update the 17 R-114-loaded 3500.2 rows in place:

```sql
UPDATE purchasing_actuals
SET source = 'pnl_finance_load'
WHERE source = 'upload'
  AND source_bill_id LIKE 'pnl_actuals::%';
```

The R-114 PR 2 item 6 migration file's SELECT block should also be updated at the same time so re-runs write the new value. The `ON CONFLICT (source, source_line_id)` key means the update carries a source change that has to sync with the file - both need to land in the same commit.

## Not this PR

R-114 is display + data. This constraint change is table plumbing; the value of doing it right - one commit, one review, no discovery-during-review - is higher than the value of bundling it in. Open as a separate PR when P10 finance loads or a related surface (5-series, reimbursables) forces the question.
