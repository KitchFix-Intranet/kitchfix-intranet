# PR-A: reseed CIN - AZ + TXR - AZ actuals from v5 workbooks

## Why the reseed was needed

`sc_daily_actuals` for both AZ accounts carried a mix of legitimate seed data and dev-era artefacts that piled up while the Service Calendar was being built. Direct evidence:

- **6 TXR Extra Protein test rows** on 2026-07-03, 2026-07-13, 2026-07-14 under Kevin's email. Extra Protein has never been charged at TXR - the column is a placeholder for a service that has not happened. These were the reveal.
- **557 CIN + 198 TXR `k.fietek@kitchfix.com`-authored rows** in scope (209 CIN + 70 TXR non-zero). Dev-era manual entries from the SC build, not real service records.
- **5 CIN + 7 TXR `sc_week_finalize` rows** with revert reasons literally reading `test2`, `a`, `Test`, `Test1` - proof the finalize flow was being smoke-tested against the actuals underneath.
- **182 `spreadsheet_seed` rows on each account** from a 2026-08-10 pilot seed (a fortnight loaded into each account to test the finalize flow, immediately before the finalize test rows on Aug 11-19).
- **1 CIN `sc_day_metadata.notes = 'TEST'`** on 2026-07-09.
- **1 TXR `sc_daily_actuals_history` row with `service_date = 2029-01-07`** - bad-date artefact from an earlier session.

Kevin's ruling: workbooks are the source of truth. Wipe and replace both accounts from 2026-01-01 to today under `spreadsheet_seed`. The v5 workbooks exported 2026-09-15 are the pinned inputs.

## Nothing was ever invoiced from the SC for either account

Confirmed against `sc_export_ledger`:
- CIN - AZ: 0 rows.
- TXR - AZ: 11 rows. All either `status='test'` (`is_test=true`), `status='failed'`, or `status='superseded'`. **Every row has `qbo_doc_number IS NULL`.** No client was ever billed from the Service Calendar for either AZ account. Sebastian's hand-built QBO invoices from the workbooks are the invoicing record of truth.

That is the reason a full rewrite is safe rather than risky.

## Projections are correct - PR-B was cancelled

An earlier round of this arc reported a "systematic 2-position column shift" in TXR-AZ projections and staged a PR-B to reseed them. **That finding was wrong** - it came from a probe script that hardcoded the TXR **Actuals** tab column map (`L = ML Extra Protein - Chicken/Pork`) and applied it to the **Projections** tab, where the same column L is `MiL Breakfast`. Same letters, different meanings. The DB has always been aligned to the Projections tab. Independent verification: TXR has zero rows and zero units across all four Extra Protein service_ids - a real 2-position shift would have deposited those values somewhere and the distribution would be lopsided. It isn't.

CIN - AZ projections were also correct. CIN's Actuals and Projections share the same column layout so the probe's Actuals map matched the Projections tab by structural coincidence; the 20/20 match was real.

Both accounts' `sc_daily_projections` are untouched. PR-B has no scope. See the GOTCHAS entry added in this PR for the mechanism (a column map is specific to one tab, copying a probe between tabs carries a map that no longer means what it says) and the more useful lesson (when a check contradicts something known to be stable - projections are set once at the start of the season and do not change - suspect the check first).

## Wipe scope is the ruling scope, not the workbook span

Initial seeder version scoped the DELETE by the workbook's populated span (`firstDate..lastDate` from non-zero cells). That works by coincidence on today's DB state but is not the rule the ruling asked for. Fixed to the ruling scope:

- `DELETE_FROM = SEASON_START` = 2026-01-01
- `DELETE_TO = TODAY` (captured at seeder start; 2026-09-15)

Any DB row on a date the workbook leaves entirely zero, or that sits outside the workbook's non-zero span but inside 2026-01-01..today, still gets wiped. The rollback backup covers the same full scope so a failed INSERT restores everything the DELETE touched.

## What Block 1 removed (applied 2026-09-15)

| table | CIN-AZ | TXR-AZ | notes |
|---|---|---|---|
| `sc_week_finalize` | 5 | 7 | all `k.fietek@`, all dev artefacts |
| `sc_export_ledger` | 0 | 11 | delete guarded on `qbo_doc_number IS NULL` |
| `sc_day_metadata.notes = 'TEST'` on 2026-07-09 | 1 blanked | - | two real "Service cancelled" notes on 07-10 and 07-17 preserved |

## What the seeder --write did (applied 2026-09-15)

- CIN - AZ: 2,816 deleted → 2,795 inserted (net -21).
- TXR - AZ: 2,298 deleted → 2,821 inserted (net +523).
- In-memory backup captured before each account's DELETE: 5,114 rows total. A failed INSERT chunk would restore every one verbatim.
- S3 - S9 all green. S9 contamination assertion: seed-authored rows in scope equal intended inserts on both accounts (2795 == 2795, 2821 == 2821); zero non-seed rows survived.
- S7 spot check on 6 evenly-spaced dates: all MATCH for db_rows and db_sum vs wb_rows and wb_sum.

## What Block 2 removed (applied 2026-09-15)

- `sc_daily_actuals_history`: all rows for both accounts in scope, plus the trigger-generated deletion rows the seeder's DELETE produced, plus the 2029-01-07 TXR artefact. End state: history empty for both accounts across all dates.

## Block 3 verification (applied 2026-09-15)

All green. V1a composition = 100% `spreadsheet_seed`. V1b hard row-count match: `CIN 2795 MATCH`, `TXR 2821 MATCH`. V2 legacy provenance = 0. V3 finalize + ledger + history all empty. V4 preserved surfaces: 27 CIN + 9 TXR `sc_day_note_entries`, 357 CIN + 357 TXR `sc_day_metadata` with `event_label` (354 in scope + 3 pre-scope 2025-12-29..31; metadata was never in delete scope), 6 CIN + 12 TXR `sc_week_chase_sent`. V5 TEST note gone, cancel notes intact. V6 catalog untouched (13 services each). V7 `sc_daily_projections` unchanged - as they should be.

## What ships in this PR

```
scripts/billing/inputs/cin-az-sc-2026-v5.xlsx           (pinned, sanitized)
scripts/billing/inputs/txr-az-sc-2026-v5.xlsx           (pinned, sanitized)
scripts/billing/seed-cin-az-txr-az-history.mjs          (seeder)
scripts/billing/pr-a/01-pre-seed-cleanup.sql            (Block 1)
scripts/billing/pr-a/02-post-seed-history-purge.sql     (Block 2)
scripts/billing/pr-a/03-verify.sql                      (Block 3)
scripts/billing/pr-a/PR_BODY.md                         (this file)
scripts/billing/pr-a/CHAT_CLAUDE_REVIEW.md              (SQL review packet handed to Chat-Claude)
docs/GOTCHAS.md                                          (+ entry: column maps are tab-specific)
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

  TXR-AZ
    source:  /Users/kevinfietek/Downloads/TXR AZ - Service Calendar - 2026 (5).xlsx
             size=632874  sha256=48ca6b93b187f0d1324557378d593cddb4e87d3a84b9c59026df52d7298a1eb8
    dest:    scripts/billing/inputs/txr-az-sc-2026-v5.xlsx
             size=632874  sha256=48ca6b93b187f0d1324557378d593cddb4e87d3a84b9c59026df52d7298a1eb8
    pinned:  48ca6b93b187f0d1324557378d593cddb4e87d3a84b9c59026df52d7298a1eb8
```

Source files timestamped 2026-09-15 11:15 CDT (Kevin's fresh export that day). Runtime hash gate in the seeder halts if `inputs/` ever holds different bytes at run time.

## Date discipline

- `SEASON_START = 2026-01-01` (floor): drops the 3 rows of 2025-12-29..31 that head both actuals tabs. Routine skip.
- `TODAY` captured at run start (2026-09-15): drops the 96 dates 2026-09-16 .. 2026-12-20 present in the sheet's future rows. Routine skip.
- `SANE_MAX = 2027-12-31` (halt bound): `--write` refuses if any row past this appears. The 2029-01-07 history artefact is the class this guard is for. Neither workbook parse triggered it.

## Followups

None outstanding from this PR. PR-B cancelled (see projections section above).
