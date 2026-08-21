# rippling_report_seen_txns.txt

A snapshot of distinct `parent_txn_id` values that were present in the
Rippling spend export used to seed the `rippling_report_seen_txns`
table. The engine consults this table when arbitrating same-merchant
same-amount pairs within 5 days (see `scripts/purchasing_report_load.mjs`
header and `docs/KPI_PURCHASING_MASTER.md`).

## What is in the .txt file

- Pure text, one 24-character hex Mongo ObjectID per line, sorted lexically
- 4,838 lines / 4,838 distinct IDs, no duplicates
- **Nothing else.** No amounts, no merchants, no employees, no dates
- Verify: `grep -v -E "^[a-f0-9]{24}\$" data/rippling_report_seen_txns.txt | wc -l` must return 0

## Provenance

- Source export: `Custom_report-6a87456dd3e0e4d972a07439.csv` (Rippling custom-report hash)
- Report generation window: 2025-12-29 to 2026-08-19
- Row count on export: 4,838 distinct parent transaction IDs
- Snapshot captured: 2026-08-21

## This is a SNAPSHOT and it decays

Every day new Rippling transactions land that this snapshot does not
know about. Ruling 4 arbitration on a pair whose parents post-date the
snapshot's cutoff falls through to the default (later wins) even when
both parents are in the report. The snapshot stays correct for the
window it covers; it goes stale outside it.

The scheduled `report-email` ingestion lane specified in
`KPI_PURCHASING_MASTER §6.6` is the maintainer that ends the decay.
Until that lane is built, refresh the snapshot by re-exporting the
Rippling custom report and re-running `scripts/purchasing_report_load.mjs`.

## How the loader uses it

`scripts/purchasing_report_load.mjs` seeds `rippling_report_seen_txns`
from either:

1. A fresh Rippling CSV export via `--csv=<path>` (preserved existing
   behavior), or
2. This file (`data/rippling_report_seen_txns.txt`) when no `--csv=`
   is supplied - the fresh-clone reproducibility path.

Both paths are idempotent: `.upsert(rows, { onConflict: "parent_txn_id",
ignoreDuplicates: true })`.
