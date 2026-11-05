# PR-A companion SQL - Chat-Claude review packet

Please review the three SQL blocks below. They accompany a seeder that
wipes-and-replaces `sc_daily_actuals` for CIN - AZ and TXR - AZ from the
two v5 workbooks. The seeder itself does its own DELETE-then-INSERT for
`sc_daily_actuals`; these blocks handle the tables adjacent to it.

## Context you need

**Ruling scope**: wipe-and-replace, `2026-01-01 .. today` (today is
`2026-09-15`), for accounts `CIN - AZ` and `TXR - AZ`.

**Why the reseed exists**: the current AZ actuals in Postgres carry
development artefacts (six TXR Extra Protein test rows on Jul 3/13/14
under Kevin's email are the reveal). Kevin ruled that the workbooks are
the source of truth. A parallel finding on TXR projections: the original
`import-script` slotted workbook columns two positions off, so Extra
Protein values landed as MiLB Breakfast / Lunch - sum-conserving but
mix-fictional. Nothing has actually been invoiced from the Service
Calendar for either account (every row in `sc_export_ledger` has
`qbo_doc_number IS NULL`), so a full rewrite is safe.

**Preflight table counts** (blast radius report already run):

| table | CIN-AZ | TXR-AZ | disposition |
|---|---|---|---|
| `sc_daily_actuals` (in scope) | 2,816 | 2,298 | seeder wipes and reseeds |
| `sc_week_finalize` (in scope) | 5 | 7 | **Block 1** deletes (all dev artefacts) |
| `sc_export_ledger` (in scope) | 0 | 11 | **Block 1** deletes (no `qbo_doc_number` anywhere) |
| `sc_day_metadata` (event_label rows) | 354 | 354 | preserved (calendar structure) |
| `sc_day_metadata` (notes set) | 3 | 0 | **Block 1** blanks CIN 2026-07-09 note = `TEST` only |
| `sc_day_note_entries` | 27 | 9 | preserved (author-authored notes) |
| `sc_daily_actuals_history` | 135 | 62 | **Block 2** purges after seed (plus the trigger-generated deletions) |
| `sc_week_chase_sent` | 6 | 12 | preserved (chase-email fact stays true) |
| `sc_daily_projections` | 4,641 | 1,968 | out of PR-A scope; PR-B reseeds TXR from `Projections - 2026` |
| `sc_phase_calendar` | 13 | 10 | preserved |
| `sc_fee_schedule`, `sc_labor_budgets`, `sc_homestand_*` | 0 | 0 | untouched |

**Trigger note that shapes Block 2's ordering**: `sc_daily_actuals` has a
`BEFORE DELETE` trigger (`sc_daily_actuals_delete_audit`) that inserts a
row into `sc_daily_actuals_history` per deleted actual, with
`changed_by = COALESCE(OLD.updated_by, OLD.created_by)` and
`change_type = 'delete'`. The seeder's DELETE-then-INSERT will fire this
trigger for every existing row it deletes (2,816 CIN + 2,298 TXR = 5,114
new history rows tagged as deletes). Block 2 runs AFTER the seed so it
sweeps both the pre-existing 197 rows AND the 5,114 trigger-generated
ones. Also nabs the 2029-01-07 TXR bad-date artefact.

**Run order** (for review context, not for your execution):

1. Block 1 (this packet)
2. Seeder dry-run
3. Seeder `--write`
4. Block 2 (this packet)
5. Block 3 (this packet) - read-only confirmation

## Ask

Review each block for:
- correctness under the ruling scope,
- unintended blast radius,
- transaction safety (each is wrapped in a single `BEGIN...COMMIT`),
- anything preserved that shouldn't be, or wiped that shouldn't be.

Reply with a per-block verdict (`OK`, `OK with note`, `HALT`) plus any
specific concern. Kevin will run these in Supabase Studio; he does not
want to discover a subtly wrong `WHERE` clause mid-transaction.

---

## Block 1 - Pre-seed cleanup (Studio, before the seeder --write)

```sql
-- PR-A / Block 1 (pre-seed cleanup)
--
-- Scope: CIN - AZ, TXR - AZ.
-- Range: 2026-01-01 .. current.

BEGIN;

-- 1a. Finalize rows.
WITH deleted AS (
  DELETE FROM sc_week_finalize
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND week_start >= '2026-01-01'
  RETURNING account_key, week_start, status
)
SELECT 'sc_week_finalize deleted' AS action, account_key, COUNT(*) AS rows,
       string_agg(week_start::text || ' ' || status, ', ' ORDER BY week_start) AS detail
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 1b. Export-ledger rows.
-- Guard: qbo_doc_number IS NULL. A non-null doc number is the record
-- that a real invoice was pushed to QuickBooks. That evidence must
-- survive the cleanup regardless of the actuals-side reseed.
WITH deleted AS (
  DELETE FROM sc_export_ledger
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND week_start >= '2026-01-01'
    AND qbo_doc_number IS NULL
  RETURNING account_key, week_start, status, qbo_invoice_id, qbo_doc_number
)
SELECT 'sc_export_ledger deleted' AS action, account_key, COUNT(*) AS rows,
       COUNT(qbo_doc_number) AS with_qbo_doc_number,
       string_agg(week_start::text || ' ' || status, ', ' ORDER BY week_start) AS detail
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 1c. Blank the single CIN "TEST" note (2026-07-09).
--     Guarded by exact text so no other note is affected.
WITH updated AS (
  UPDATE sc_day_metadata
     SET notes = NULL,
         updated_by = 'spreadsheet_seed_cleanup',
         updated_at = NOW()
   WHERE account_key = 'CIN - AZ'
     AND service_date = '2026-07-09'
     AND notes = 'TEST'
  RETURNING account_key, service_date, notes
)
SELECT 'sc_day_metadata TEST note blanked' AS action, COUNT(*) AS rows
FROM updated;

-- 1d. Sanity: the two real "Service cancelled" notes must still be there.
SELECT 'preserved cancel notes (expect 2)' AS check, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key = 'CIN - AZ'
  AND service_date IN ('2026-07-10','2026-07-17')
  AND notes ILIKE '%Service cancelled%';

COMMIT;
```

**Expected end state after Block 1**: 12 finalize + 11 ledger rows deleted;
one `sc_day_metadata.notes` field on CIN 2026-07-09 blanked; the two
"Service cancelled" notes on CIN 2026-07-10 and 2026-07-17 preserved
(sanity check returns 2).

---

## Block 2 - Post-seed history purge (Studio, after seeder --write)

```sql
-- PR-A / Block 2 (post-seed history purge)
--
-- Run AFTER the seeder --write completes.
--
-- Trigger inventory on sc_daily_actuals (verified 2026-09-15):
--   BEFORE UPDATE (sc_daily_actuals_audit_trigger)
--   BEFORE DELETE (sc_daily_actuals_delete_trigger)
--   NO INSERT TRIGGER.
--
-- Seeder run-side effect: the DELETE-then-INSERT inside writeAccount
-- fires the delete trigger for every existing row (5,114 total across
-- both accounts in scope) but produces no history rows on INSERT.
-- Immediately after --write, history for these accounts in scope
-- contains 5,311 rows: 197 pre-existing + 5,114 trigger-generated.
-- All reference actual_id values that no longer exist.
--
-- Design decision (Kevin ruling 2026-09-15): the trigger-generated
-- rows go with the purge - a full replace under a new provenance
-- gets a clean-slate history.
--
-- 2a's `service_date >= '2026-01-01'` has NO upper bound, so it also
-- catches the TXR 2029-01-07 artefact. 2b is defensive for any
-- pre-2026 row a future artefact might introduce; under current DB
-- state 2b's RETURNING is empty.

BEGIN;

-- 2a. Purge history for both accounts within scope.
WITH deleted AS (
  DELETE FROM sc_daily_actuals_history
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND service_date >= '2026-01-01'
  RETURNING account_key, service_date, change_type
)
SELECT 'sc_daily_actuals_history purged (in scope)' AS action,
       account_key,
       COUNT(*) AS rows,
       COUNT(*) FILTER (WHERE change_type = 'delete') AS deletes,
       COUNT(*) FILTER (WHERE change_type = 'update') AS updates,
       MIN(service_date) AS min_d,
       MAX(service_date) AS max_d
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 2b. Sweep the 2029-01-07 TXR artefact and anything else out of scope.
WITH deleted AS (
  DELETE FROM sc_daily_actuals_history
  WHERE account_key IN ('CIN - AZ','TXR - AZ')
    AND (service_date < '2026-01-01' OR service_date > '2027-12-31')
  RETURNING account_key, service_date, change_type
)
SELECT 'sc_daily_actuals_history out-of-scope sweep' AS action,
       account_key,
       COUNT(*) AS rows,
       string_agg(service_date::text || ' ' || change_type, ', ' ORDER BY service_date) AS detail
FROM deleted
GROUP BY account_key
ORDER BY account_key;

-- 2c. Verify: zero history rows for either account across all dates.
SELECT 'residual history (expect 0 both)' AS check,
       account_key,
       COUNT(*) AS rows
FROM sc_daily_actuals_history
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key
ORDER BY account_key;

COMMIT;
```

**Expected end state after Block 2**: `sc_daily_actuals_history` empty
for both accounts across all dates. Detail line for step 2b shows the
2029-01-07 TXR artefact by name.

---

## Block 3 - Post-write verification (Studio, read-only)

```sql
-- PR-A / Block 3 (post-write verification, read-only)

-- V1a: sc_daily_actuals composition in scope.
SELECT 'V1a actuals composition' AS check,
       a.account_key,
       a.created_by,
       COUNT(*) AS rows,
       MIN(a.service_date) AS min_d,
       MAX(a.service_date) AS max_d
FROM sc_daily_actuals a
WHERE a.account_key IN ('CIN - AZ','TXR - AZ')
  AND a.service_date >= '2026-01-01'
GROUP BY a.account_key, a.created_by
ORDER BY a.account_key, a.created_by;
-- Expect: created_by = 'spreadsheet_seed' rows only.

-- V1b: hard row-count assertion (dry-run intended totals).
--      CIN - AZ  intended = 2795
--      TXR - AZ  intended = 2821
SELECT 'V1b row-count assertion' AS check,
       a.account_key,
       COUNT(*) AS rows,
       CASE
         WHEN a.account_key = 'CIN - AZ' AND COUNT(*) = 2795 THEN 'MATCH'
         WHEN a.account_key = 'TXR - AZ' AND COUNT(*) = 2821 THEN 'MATCH'
         ELSE 'MISMATCH (expected CIN=2795, TXR=2821)'
       END AS verdict
FROM sc_daily_actuals a
WHERE a.account_key IN ('CIN - AZ','TXR - AZ')
  AND a.service_date >= '2026-01-01'
  AND a.created_by = 'spreadsheet_seed'
GROUP BY a.account_key
ORDER BY a.account_key;

-- V2: no legacy provenance rows survived.
SELECT 'V2 legacy provenance (expect 0)' AS check,
       account_key,
       created_by,
       COUNT(*) AS rows
FROM sc_daily_actuals
WHERE account_key IN ('CIN - AZ','TXR - AZ')
  AND service_date >= '2026-01-01'
  AND created_by IN ('import-script','k.fietek@kitchfix.com')
GROUP BY account_key, created_by
ORDER BY account_key, created_by;

-- V3: finalize + ledger + history all empty for both accounts.
SELECT 'V3 sc_week_finalize (expect 0)' AS check,
       account_key, COUNT(*) AS rows
FROM sc_week_finalize
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key;

SELECT 'V3 sc_export_ledger (expect 0)' AS check,
       account_key, COUNT(*) AS rows
FROM sc_export_ledger
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key;

SELECT 'V3 sc_daily_actuals_history (expect 0)' AS check,
       account_key, COUNT(*) AS rows
FROM sc_daily_actuals_history
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key;

-- V4: preserved surfaces still populated.
SELECT 'V4 sc_day_note_entries preserved' AS check,
       account_key, COUNT(*) AS rows
FROM sc_day_note_entries
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key
ORDER BY account_key;

SELECT 'V4 sc_day_metadata event_label preserved' AS check,
       account_key, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key IN ('CIN - AZ','TXR - AZ')
  AND event_label IS NOT NULL AND event_label <> ''
GROUP BY account_key
ORDER BY account_key;

SELECT 'V4 sc_week_chase_sent preserved' AS check,
       account_key, COUNT(*) AS rows
FROM sc_week_chase_sent
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key
ORDER BY account_key;

-- V5: the two real cancel notes intact; the TEST note gone.
SELECT 'V5 preserved cancel notes (expect 2)' AS check, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key = 'CIN - AZ'
  AND service_date IN ('2026-07-10','2026-07-17')
  AND notes ILIKE '%Service cancelled%';

SELECT 'V5 removed TEST note (expect 0)' AS check, COUNT(*) AS rows
FROM sc_day_metadata
WHERE account_key = 'CIN - AZ'
  AND service_date = '2026-07-09'
  AND notes = 'TEST';

-- V6: catalog untouched.
SELECT 'V6 active service count' AS check,
       account_key, COUNT(*) AS rows
FROM sc_services
WHERE account_key IN ('CIN - AZ','TXR - AZ')
  AND deleted_at IS NULL
  AND active_until IS NULL
GROUP BY account_key
ORDER BY account_key;
-- Expect: 13 and 13 (same as before the reseed).

-- V7: projection state - CIN unchanged, TXR untouched pending PR-B.
SELECT 'V7 projections (unchanged this PR)' AS check,
       account_key,
       created_by,
       COUNT(*) AS rows
FROM sc_daily_projections
WHERE account_key IN ('CIN - AZ','TXR - AZ')
GROUP BY account_key, created_by
ORDER BY account_key, created_by;
```

**Expected end state after Block 3** (all queries return the expected
value per its inline note; anything else is a signal to halt).

---

## Anything else that would help your review

Let me know if the transaction boundaries, the delete predicates, the
`WHERE` clauses on the surgical UPDATE, or the coverage of the history
sweep look wrong for the ruling scope. If a change is small enough to
suggest inline, do; if it's bigger than that, name the concern and
Kevin will route it back to me.
