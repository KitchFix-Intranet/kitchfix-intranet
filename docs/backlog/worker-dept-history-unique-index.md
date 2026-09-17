# Backlog · worker_dept_history · unique index on (worker_id, effective_from)

Opened 2026-09-17 during the R-115 migration review. Kevin catch.

## What

`worker_dept_history` today has one uniqueness constraint - the PK on `id`. There is no unique index on `(worker_id, effective_from)`. Any migration that uses `INSERT ... ON CONFLICT DO NOTHING` against a `(worker_id, effective_from)` conflict target silently inserts a duplicate on re-run, because there is nothing for the ON CONFLICT to fire against.

Two spells for one worker starting on the same day is never valid business data. Every future seed on this table carries the same duplicate-insert hazard until the unique index lands.

## Concrete case

Caught pre-merge on R-115 PR (2026-09-17). The Ryan Moore seed's original SQL used `ON CONFLICT DO NOTHING`. Would have re-inserted the row on any subsequent run of the migration file. Fixed for R-115 by switching to `INSERT ... SELECT ... WHERE NOT EXISTS`, guarding on data rather than a constraint.

## Proposed change

```sql
CREATE UNIQUE INDEX worker_dept_history_worker_from_uq
  ON worker_dept_history (worker_id, effective_from);
```

Once the index exists, seed migrations can go back to the natural `ON CONFLICT (worker_id, effective_from) DO NOTHING` or `DO UPDATE` shape and idempotency comes from the constraint rather than from a per-migration WHERE NOT EXISTS block.

## Consequences

- Any legitimate data update to an existing spell (e.g. correcting an annual_comp value) becomes an explicit `ON CONFLICT DO UPDATE` per migration - which is the right shape.
- Any accidental duplicate insert becomes a loud error instead of a silent duplicate row.
- Existing rows (currently 2, both Bailey) do not conflict.

## Not this PR

R-115 uses the WHERE NOT EXISTS workaround. This backlog opens a separate migration when the pattern next comes up or when Kevin picks it up on its own.
