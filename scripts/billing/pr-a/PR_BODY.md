# PR-A: reseed CIN - AZ + TXR - AZ actuals from v5 workbooks

## The shift finding (read this first)

The original `import-script` that populated `sc_daily_projections` slotted TXR-AZ's workbook columns two positions off from where the services actually live. Values that live in `Major League | Extra Protein - Chicken/Pork` (col L) and `Major League | Extra Protein - Beef/Seafood` (col N) in the current workbook were written into DB as `Minor League | Breakfast` and `Minor League | Lunch`. Every downstream shift chains from there.

This is not stale data. This is not a data-entry problem. It is a systematic positional-mapping bug in the loader. Row sums are conserved, so nothing flagged, but the meal mix is fictional.

**Why this matters beyond this account.** Meal mix drives per-service revenue rates and, when the Service Calendar finalizes a week, the QBO invoice line items. A shifted mix produces wrong line items on every invoice the SC generates, even when the invoice total is right. The reason no client was billed from this class of error on AZ is that nothing has actually been invoiced from the SC yet (see reassurance below). That protection does not generalize.

**Backlog implication.** Any account whose `sc_daily_projections` were loaded by the same original `import-script` deserves the same shift check. Nine accounts remain. Not this PR. Method + probe shape logged as `project_projection_import_shift_sweep.md`.

The AZ **actuals** get a full reseed on the correct positional map in this PR. The TXR-AZ **projections** reseed follows in PR-B on the `Projections - 2026` tab (Kevin's ruling; `In house Projections - 2026` diverges from 2026-07-13 onward and is not canonical). CIN-AZ projections match the workbook 20/20 and stay as-is.

## Nothing was ever invoiced from the SC for either account

Confirmed against `sc_export_ledger`:
- CIN - AZ: 0 rows.
- TXR - AZ: 11 rows. All either `status='test'` (`is_test=true`), `status='failed'`, or `status='superseded'`. **Every row has `qbo_doc_number IS NULL`.** No client was ever billed from the Service Calendar for either AZ account. Sebastian's hand-built QBO invoices from the workbooks are the invoicing record of truth, so the shifted projections never reached a customer.

That is the reason a full rewrite is safe rather than risky.

## Wipe scope is the ruling scope, not the workbook span

Initial seeder version scoped the DELETE by the workbook's populated span (`firstDate..lastDate` from non-zero cells). That works by coincidence on today's DB state but is not the rule your ruling asked for. Fixed to the ruling scope:

- `DELETE_FROM = SEASON_START` = 2026-01-01
- `DELETE_TO = TODAY` (captured at seeder start; 2026-09-15)

Any DB row on a date the workbook leaves entirely zero, or that sits outside the workbook's non-zero span but inside 2026-01-01..today, still gets wiped. The rollback backup covers the same full scope so a failed INSERT restores everything the DELETE touched.

## Delete-scope preview (from dry-run against live DB, 2026-09-15)

```
DELETE-SCOPE PREVIEW  (--write range: 2026-01-01 .. 2026-09-15)

  CIN - AZ: existing rows in scope = 2816   intended inserts = 2795
    import-script                 rows= 2077  non_zero= 634
    k.fietek@kitchfix.com         rows=  557  non_zero= 209
    spreadsheet_seed              rows=  182  non_zero=  68
  TXR - AZ: existing rows in scope = 2298   intended inserts = 2821
    import-script                 rows= 1918  non_zero= 456
    k.fietek@kitchfix.com         rows=  198  non_zero=  70
    spreadsheet_seed              rows=  182  non_zero=  41
```

- The 557 CIN + 198 TXR `k.fietek@` rows are the dev-era manual entries (including the six TXR Extra Protein test rows on Jul 3/13/14) that motivated the reseed.
- Both accounts show 182 `spreadsheet_seed` rows in scope. Traced to a pilot seed on 2026-08-10 19:05:24 - a fortnight loaded into each account to test the finalize flow (CIN Jul 13-26, TXR Jul 20-Aug 2). 13 services x 14 days = 182 per account. Same arc as the `sc_week_finalize` test rows on Aug 11-19. Reseed wipes them, which is correct.
- Net row change: CIN 2,816 -> 2,795 (-21). TXR 2,298 -> 2,821 (+523; workbook covers dates DB left populated as zeros).
- Backup captured before delete: 5,114 rows total in memory (2,816 CIN + 2,298 TXR). A failed INSERT chunk restores every one with original `created_by`, `updated_by`, timestamps preserved.

## S9 contamination assertion (post-write)

- **Positive**: `count(rows in scope with created_by='spreadsheet_seed') == results[acct].inserted`. `MATCH` or `MISMATCH` printed. Mismatch means the DELETE-then-INSERT did not land what the seeder said it wrote.
- **Negative**: `count(rows in scope with created_by != 'spreadsheet_seed')` must be 0. If not, seeder enumerates up to 20 offenders (with cap-warning if it hits 20) showing `service_date, created_by, service_name, actual_count`. Contamination becomes actionable rather than a lonely count.

## Also cleared with the wipe

- **`sc_daily_actuals_history` TXR row with `service_date = 2029-01-07`** - bad-date artefact from an earlier session. Evidence of the class of thing that got in, and the reason the reseed is needed. Sweep in Block 2 catches it via the `service_date > '2027-12-31'` bound.
- 5 CIN + 7 TXR `sc_week_finalize` rows (all `k.fietek@`, revert reasons like `test2`, `a`, `Test1`).
- 11 TXR `sc_export_ledger` rows (none invoiced, per above). Block 1's DELETE is guarded on `qbo_doc_number IS NULL` so any row that ever carried a real doc number survives.
- 197 `sc_daily_actuals_history` rows (135 CIN + 62 TXR) plus whatever the DELETE trigger generates when the seed runs.
- One surgical `sc_day_metadata.notes = NULL` on CIN 2026-07-09 where the note was literally `TEST`. The two real `Service cancelled - marked no service` notes on 2026-07-10 and 2026-07-17 stay.

## Preserved

- `sc_day_metadata` event_label / game_type / game_time - the calendar structure (354 rows/account).
- `sc_day_note_entries` (27 CIN + 9 TXR author-authored notes).
- `sc_week_chase_sent` (6 CIN + 12 TXR). A chase email was sent; that fact stays true.
- `sc_phase_calendar`, `sc_services`, prices, service groups, QBO catalog - all out of scope.
- **CIN-AZ `sc_daily_projections`** - 20/20 spot-checked against `Goodyear, AZ - Projected Number`, all match.
- **TXR-AZ `sc_daily_projections`** - untouched here; PR-B reseeds from `Projections - 2026`.

## What ships in this PR

```
scripts/billing/inputs/cin-az-sc-2026-v5.xlsx           (new, sanitized copy)
scripts/billing/inputs/txr-az-sc-2026-v5.xlsx           (new, sanitized copy)
scripts/billing/seed-cin-az-txr-az-history.mjs          (new seeder)
scripts/billing/pr-a/01-pre-seed-cleanup.sql            (finalize + ledger + TEST note)
scripts/billing/pr-a/02-post-seed-history-purge.sql     (history table sweep)
scripts/billing/pr-a/03-verify.sql                      (post-write verification)
scripts/billing/pr-a/PR_BODY.md                         (this file)
scripts/billing/pr-a/CHAT_CLAUDE_REVIEW.md              (SQL review packet)
```

## Staged input provenance (audit record)

```
=== PR-A input staging (2026-09-15 11:50:23 CDT) ===

  CIN-AZ
    source:  /Users/kevinfietek/Downloads/REDS AZ - Service Calendar 2026 (5).xlsx
             size=419646  sha256=cab11a66b14f6e60f33f3794a7265b2b5eb88fdde0a35ffd6940eaf9d4752dec
    dest:    scripts/billing/inputs/cin-az-sc-2026-v5.xlsx
             size=419646  sha256=cab11a66b14f6e60f33f3794a7265b2b5eb88fdde0a35ffd6940eaf9d4752dec
    pinned:  cab11a66b14f6e60f33f3794a7265b2b5eb88fdde0a35ffd6940eaf9d4752dec
    verdict: src==dst==pinned  OK

  TXR-AZ
    source:  /Users/kevinfietek/Downloads/TXR AZ - Service Calendar - 2026 (5).xlsx
             size=632874  sha256=48ca6b93b187f0d1324557378d593cddb4e87d3a84b9c59026df52d7298a1eb8
    dest:    scripts/billing/inputs/txr-az-sc-2026-v5.xlsx
             size=632874  sha256=48ca6b93b187f0d1324557378d593cddb4e87d3a84b9c59026df52d7298a1eb8
    pinned:  48ca6b93b187f0d1324557378d593cddb4e87d3a84b9c59026df52d7298a1eb8
    verdict: src==dst==pinned  OK
```

Source files timestamped 2026-09-15 11:15 CDT (today, Kevin's fresh export). Runtime hash gate in the seeder halts if `inputs/` ever holds different bytes at run time.

## Dry-run headline

```
PR-A seed  mode=DRY-RUN  at 2026-09-15T...
  SEASON_START=2026-01-01  TODAY=2026-09-15  SANE_MAX=2027-12-31

S1 hash gate:                          CIN OK, TXR OK
Resolver:                              CIN 13 services, TXR 13 services
Parse:                                 3354 CIN cells, 3354 TXR cells
Date bounds:
  skipped before 2026-01-01:           6   range: 2025-12-29 .. 2025-12-31
  skipped after  2026-09-15:           192 range: 2026-09-16 .. 2026-12-20
  insane-date findings (> SANE_MAX):   0

Intended rows:
  CIN - AZ:  2795 rows across 215 dates (2026-01-04 .. 2026-09-14)
  TXR - AZ:  2821 rows across 217 dates (2026-01-05 .. 2026-09-15)

Delete-scope preview:  (as above)
```

Per-month row counts and sanity-anchor breakdowns for the seven anchor dates are in the dry-run output; ~800 units peak day (CIN 3/09), ~275 units on a typical current-season day for TXR, MiL Coffee/Fountain register as `1` per service day (workbook flag convention). Kevin will eyeball anchors against the sheets before `--write`.

## Run order

1. **Block 1** (`01-pre-seed-cleanup.sql`) in Studio. Chat-Claude reviews first.
2. **Seeder dry-run**: `node scripts/billing/seed-cin-az-txr-az-history.mjs`. Kevin eyeballs anchors + delete-scope preview.
3. **Seeder write**: `node scripts/billing/seed-cin-az-txr-az-history.mjs --write` after Kevin's explicit go.
4. **Block 2** (`02-post-seed-history-purge.sql`) in Studio. Purges history rows generated by the DELETE trigger plus the pre-existing 197 + the 2029-01-07 artefact.
5. **Block 3** (`03-verify.sql`) in Studio. Read-only confirmation of end state.

## Date discipline

- `SEASON_START = 2026-01-01` (floor): drops the 3 rows of 2025-12-29..31 that head both actuals tabs. Routine skip.
- `TODAY` captured at run start: drops the 96 dates 2026-09-16 .. 2026-12-20 present in the sheet's future rows. Routine skip.
- `SANE_MAX = 2027-12-31` (halt bound): `--write` refuses if any row past this appears. The 2029-01-07 history artefact is the class this guard is for. Neither workbook parse triggers it in dry-run.

## What survives the seed for eyes-on

- `sc_daily_projections`: CIN untouched (matched WB), TXR untouched (awaiting PR-B).
- `sc_daily_actuals_history`: emptied for both accounts in scope (Block 2).
- Everything else in the preserved list above.

## Followups

- **PR-B**: reseed TXR-AZ `sc_daily_projections` from `Projections - 2026`. Same seeder pattern, projections table.
- **Projection shift sweep**: nine unchecked accounts. Not this PR; logged as `project_projection_import_shift_sweep.md`.
