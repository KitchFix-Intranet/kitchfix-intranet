# Diagnostic: Smart Inventory PG catalog freeze at 2026-06-04

**Date:** 2026-08-04
**Author:** CC session
**Trigger:** STL-FL emergency count-sheet export (PR #614) surfaced every catalog item as "created 2026-06-03 20:37:32 UTC" and no items younger.
**Scope:** Read-only. No writes to `inventory_items`, `price_history`, `item_aliases`, `review_queue`, `merge_history`, or the cron repo. All queries ran via the Supabase MCP client against production PG (project `dhkhvaokmtsfscnwnbum`).

---

## Executive summary

The PG "freeze" is **not STL-FL specific**. All 9 accounts in `inventory_items` are frozen. **No cron write to the PG mirror has landed on any account since `2026-06-04 06:12:45 UTC`** (a single manual merge by Kevin at 21:52 UTC on the same day is the only later inventory_items touch). Meanwhile the intake layer is fully alive: `ai_line_items` gained 7,367 rows since 2026-06-04 including 1,492 STL-FL rows, and 230 STL-FL invoice submissions have arrived post-freeze. Operators are submitting, OCR is scanning, but the aggregation step that turns line items into catalog rows never fires against PG.

This is the expected consequence of the parked-Module-7 posture from `docs/MIGRATION_STATUS.md`: dual-write flags are OFF, so the Railway cron writes to the Google Sheets catalog only. The PG `inventory_items` table has been a frozen INV-3 backfill snapshot ever since. What the STL-FL export I built earlier today actually reads is the 2026-06 catalog snapshot, not a live catalog. The Sheets side is presumably still current (that's where the Smart Inventory UI reads from and where the cron writes).

The 2026-06-03 20:37 UTC timestamp specifically was a **STL-FL-only manual backfill run** - 52 items + 86 aliases + 87 price rows for STL-FL alone, at 3:37 PM CT, outside the cron's midnight-CT window. Not the cron; a scripted catch-up done during the migration project close-out on 2026-06-12.

---

## Q1: Is the freeze STL-FL-only or systemic?

**Answer: Systemic across all 9 accounts.** (The prompt anticipated 11 accounts; only 9 exist in PG.)

### Query [ran]

```sql
SELECT
  ii.account,
  COUNT(*) AS active_items,
  MAX(ii.last_verified) AS max_last_verified,
  MAX(ii.updated_at) AS max_updated_at,
  MAX(ii.created_at) AS max_created_at,
  (SELECT MAX(ph.effective_date) FROM price_history ph WHERE ph.account = ii.account) AS max_ph_effective_date,
  (SELECT MAX(ph.recorded_at)    FROM price_history ph WHERE ph.account = ii.account) AS max_ph_recorded_at,
  (SELECT COUNT(*)               FROM price_history ph WHERE ph.account = ii.account AND ph.effective_date > DATE '2026-06-03') AS ph_effective_after_jun3
FROM inventory_items ii
WHERE ii.status = 'active'
GROUP BY ii.account
ORDER BY ii.account;
```

### Result

| account       | active_items | max_last_verified | max_updated_at              | max_created_at              | max_ph_effective_date | max_ph_recorded_at              | ph_effective_after_jun3 |
|---------------|-------------:|-------------------|-----------------------------|-----------------------------|-----------------------|---------------------------------|------------------------:|
| CIN - AZ      | 330          | NULL              | 2026-06-04 17:15:57.313+00  | 2026-06-04 06:09:24.230+00  | 2026-06-03            | 2026-06-04 06:09:24.230+00      | 0                       |
| CIN - OH      | 430          | NULL              | 2026-06-04 17:15:57.313+00  | 2026-06-04 06:08:29.893+00  | 2026-06-03            | 2026-06-04 06:08:29.893+00      | 0                       |
| STL - FL      | 299          | NULL              | 2026-06-04 17:15:57.312+00  | 2026-06-03 20:37:32.524+00  | 2026-06-03            | 2026-06-03 20:37:32.524+00      | 0                       |
| STL - MO      | 732          | NULL              | 2026-06-04 21:52:01.468+00  | 2026-06-04 06:04:43.912+00  | 2026-06-01            | 2026-06-04 06:04:43.912+00      | 0                       |
| TBJ - FL      | 342          | NULL              | 2026-06-04 17:15:57.313+00  | 2026-06-04 06:12:45.373+00  | 2026-06-02            | 2026-06-04 06:12:45.373+00      | 0                       |
| TBR - FL      | 378          | NULL              | 2026-06-04 17:15:57.311+00  | 2026-06-02 06:09:36.911+00  | 2026-06-01            | 2026-06-03 06:05:50.272+00      | 0                       |
| TXR - AZ      | 334          | NULL              | 2026-06-04 17:15:57.311+00  | 2026-05-31 06:05:17.388+00  | 2026-05-30            | 2026-05-31 06:05:17.388+00      | 0                       |
| TXR - TX - H  | 527          | NULL              | 2026-06-04 17:15:57.310+00  | 2026-05-28 06:11:18.110+00  | 2026-05-21            | 2026-05-28 06:11:18.110+00      | 0                       |
| TXR - TX - V  | 351          | NULL              | 2026-06-04 17:15:57.311+00  | 2026-05-30 06:03:11.628+00  | 2026-05-29            | 2026-05-30 06:03:11.628+00      | 0                       |

### Interpretation

- **`last_verified` is NULL on every item, every account.** The column exists but the cron never writes it. Anything that reads it for freshness (including the "Last Ordered" column my STL-FL export shipped in PR #614) is reading noise.
- **Freeze is universal, not STL-FL-specific.** No account has any `price_history.effective_date > 2026-06-03`. No `inventory_items.created_at > 2026-06-04 06:12`. STL-FL is not special - it's just the account whose export got looked at.
- **The `max_updated_at ~ 2026-06-04 17:15:57.31+00` shared across 8 accounts** to within a millisecond is a smoking-gun signature: a single bulk backfill / correction script that touched (almost) every account row at once. Not cron pattern.
- **STL-MO's outlier `max_updated_at = 2026-06-04 21:52:01.468469+00`** matches to the microsecond with `max(merge_history.created_at)` - see Q5 - so it's a single manual merge by Kevin, not a separate cron event.
- The `max_ph_effective_date` values pre-date the run dates because invoices carry historical dates; effective_date is the invoice's own date, not the write date.

---

## Q2: Are invoices still flowing into the intake layer?

**Answer: Yes, aggressively.** `ai_line_items` (the PG line-item store; Module 6 cut over) has thousands of rows per account since 2026-06-04. Most recent row across the whole table: **2026-08-04 14:50 UTC** (roughly 90 minutes before this query ran).

### Query [ran]

```sql
SELECT
  account_key,
  COUNT(*) AS total_rows,
  MAX(invoice_date) AS most_recent_invoice_date,
  MAX(created_at)   AS most_recent_created_at,
  COUNT(*) FILTER (WHERE created_at > TIMESTAMP '2026-06-04 00:00:00+00') AS rows_created_after_jun4,
  COUNT(*) FILTER (WHERE invoice_date > DATE '2026-06-03') AS rows_invoice_date_after_jun3
FROM ai_line_items
GROUP BY account_key
ORDER BY account_key;
```

### Result

| account_key   | total_rows | most_recent_invoice_date | most_recent_created_at         | rows_created_after_jun4 | rows_invoice_date_after_jun3 |
|---------------|-----------:|--------------------------|--------------------------------|------------------------:|----------------------------:|
| CIN - AZ      | 1659       | 2026-07-29               | 2026-07-30 20:11:55.916+00     | 856                     | 785                         |
| CIN - OH      | 1666       | 2026-07-29               | 2026-07-31 00:27:10.699+00     | 768                     | 714                         |
| STL - FL      | 1887       | **23026-07-31** (typo)   | 2026-07-31 18:51:51.812+00     | 1492                    | 1424                        |
| STL - MO      | 2503       | 2026-07-30               | 2026-07-30 17:49:29.992+00     | 943                     | 805                         |
| TBJ - FL      | 1722       | 2026-08-01               | 2026-08-03 13:43:32.390+00     | 1116                    | 891                         |
| TBR - FL      | 2038       | 2026-08-01               | 2026-08-01 11:29:20.834+00     | 1315                    | 1181                        |
| TXR - AZ      | 1555       | 2026-08-03               | 2026-08-04 14:50:12.216+00     | 800                     | 720                         |
| TXR - TX - H  | 1640       | 2026-07-24               | 2026-07-29 19:16:50.808+00     | 734                     | 478                         |
| TXR - TX - V  | 954        | 2026-07-11               | 2026-07-11 21:25:59.264+00     | 343                     | 299                         |

### Interpretation

- Every account is receiving line items post-freeze. The intake path (OCR → `ai_line_items`) is healthy.
- **STL-FL alone has 1,492 line items landed since 2026-06-04** while its PG catalog stayed at 299 items.
- Minor data-quality finding, unrelated to the freeze: at least one STL-FL row has `invoice_date = '23026-07-31'` (year 23026, four-digit-year off-by-one typo). Not a systemic issue; single row noise.

---

## Q3: Are invoices still being submitted at all?

**Answer: Yes, actively.** 188 STL-FL submissions since 2026-06-04, 129 with `ai_scan_complete=true`. Most recent submission across the fleet: **today 2026-08-04 14:48 UTC** (TXR-AZ). `pg_failed` counts are low (0-7 per account).

### Query [ran]

```sql
SELECT
  account_key,
  COUNT(*) AS total_submissions,
  MAX(submitted_at) AS most_recent_submitted_at,
  COUNT(*) FILTER (WHERE submitted_at > TIMESTAMP '2026-06-04 00:00:00+00') AS submitted_after_jun4,
  COUNT(*) FILTER (WHERE ai_scan_complete = true AND submitted_at > TIMESTAMP '2026-06-04 00:00:00+00') AS scan_complete_after_jun4,
  COUNT(*) FILTER (WHERE ai_scan_status = 'pg_failed') AS pg_failed_total
FROM invoice_submissions
GROUP BY account_key
ORDER BY account_key;
```

### Result

| account_key   | total_submissions | most_recent_submitted_at        | submitted_after_jun4 | scan_complete_after_jun4 | pg_failed_total |
|---------------|------------------:|---------------------------------|---------------------:|-------------------------:|----------------:|
| CIN - AZ      | 201               | 2026-08-01 18:01:44.079+00      | 103                  | 70                       | 0               |
| CIN - OH      | 138               | 2026-07-31 00:27:16.678+00      | 61                   | 53                       | 0               |
| STL - FL      | 230               | 2026-07-31 18:33:31.204+00      | 188                  | 129                      | 0               |
| STL - MO      | 361               | 2026-07-30 17:50:06.037+00      | 173                  | 124                      | 7               |
| TBJ - FL      | 196               | 2026-08-03 13:35:13.024+00      | 138                  | 84                       | 1               |
| TBR - FL      | 219               | 2026-08-01 09:52:07.599+00      | 144                  | 111                      | 7               |
| TXR - AZ      | 185               | 2026-08-04 14:48:19.732+00      | 105                  | 65                       | 0               |
| TXR - TX - H  | 69                | 2026-07-29 19:23:13.830+00      | 33                   | 21                       | 0               |
| TXR - TX - V  | 56                | 2026-08-03 21:40:26.712+00      | 23                   | 11                       | 0               |

### Interpretation

- The operator side of the pipeline is healthy - submitters keep uploading and OCR keeps scanning. This isolates the freeze to the **catalog aggregation stage**, not to intake.
- The "scan_complete_after_jun4" being less than "submitted_after_jun4" is expected (some subs are recent enough that OCR is still queued) and is not new bugginess.

---

## Q4: Is the cron running at all?

**Answer: The cron may still be running against the Sheets side (I cannot see Sheets from here), but it has stopped writing to any of the six PG SI tables system-wide since `2026-06-04 06:12` UTC (plus one manual merge at 21:52 UTC).**

### Query [ran]

```sql
SELECT 'price_history'      AS tbl, MAX(recorded_at) AS max_ts, COUNT(*) AS total_rows FROM price_history
UNION ALL SELECT 'inventory_items',        MAX(updated_at), COUNT(*) FROM inventory_items
UNION ALL SELECT 'inventory_items_created',MAX(created_at), COUNT(*) FROM inventory_items
UNION ALL SELECT 'item_aliases',           MAX(learned_at), COUNT(*) FROM item_aliases
UNION ALL SELECT 'review_queue',           MAX(created_at), COUNT(*) FROM review_queue
UNION ALL SELECT 'merge_history',          MAX(created_at), COUNT(*) FROM merge_history;
```

### Result

| tbl                       | max_ts                          | total_rows |
|---------------------------|---------------------------------|-----------:|
| price_history             | 2026-06-04 06:12:45.373+00      | 6665       |
| inventory_items (updated) | 2026-06-04 21:52:01.468+00      | 3759       |
| inventory_items (created) | 2026-06-04 06:12:45.373+00      | 3759       |
| item_aliases              | 2026-06-04 06:12:45.373+00      | 4341       |
| review_queue              | 2026-06-04 17:54:46.274+00      | 167        |
| merge_history             | 2026-06-04 21:52:01.468+00      | 59         |

### Interpretation

- `price_history`, `item_aliases`, and `inventory_items.created` all share `2026-06-04 06:12:45.373` as their max - that's ~1am CT / midnight CT ± DST. Signature of the **last successful cron run against PG**.
- After that: nothing except two manual events (17:15 mass-`updated_at` touch on Q1; 21:52 Kevin's merge on Q5-followup).
- **There is no cron log table in PG** (no `cron_runs`, `cron_log`, `cron_events` visible in `list_tables`). The Railway repo would carry its own logs.
- I cannot tell from PG alone whether the cron is (a) still running on Railway but writing only to Sheets, or (b) stopped entirely. Given the `docs/MIGRATION_STATUS.md` note that Module 7 is parked with flags off, (a) is the operational expectation - the cron writes to Sheets, doesn't touch PG.

---

## Q5: What did the 2026-06-03 20:37 UTC event look like?

**Answer: STL-FL-only, single 20-minute window. 52 new items + 86 new aliases + 87 new price rows for STL-FL alone. No other account touched. Not the nightly cron pattern (wrong hour and wrong fanout).**

### Query [ran]

```sql
WITH win AS (
  SELECT TIMESTAMP '2026-06-03 20:27:00+00' AS t0,
         TIMESTAMP '2026-06-03 20:47:00+00' AS t1
)
SELECT 'price_history_recorded' AS metric, account, COUNT(*)
  FROM price_history CROSS JOIN win WHERE recorded_at BETWEEN win.t0 AND win.t1 GROUP BY account
UNION ALL SELECT 'inventory_items_created', account, COUNT(*)
  FROM inventory_items CROSS JOIN win WHERE created_at BETWEEN win.t0 AND win.t1 GROUP BY account
UNION ALL SELECT 'item_aliases_learned', ii.account, COUNT(*)
  FROM item_aliases ia JOIN inventory_items ii ON ii.id=ia.item_id CROSS JOIN win
  WHERE ia.learned_at BETWEEN win.t0 AND win.t1 GROUP BY ii.account
UNION ALL SELECT 'review_queue_created', account, COUNT(*)
  FROM review_queue CROSS JOIN win WHERE created_at BETWEEN win.t0 AND win.t1 GROUP BY account
ORDER BY metric, account;
```

### Result

| metric                    | account   | count |
|---------------------------|-----------|------:|
| inventory_items_created   | STL - FL  | 52    |
| item_aliases_learned      | STL - FL  | 86    |
| price_history_recorded    | STL - FL  | 87    |

No rows for any other account. No `review_queue` writes in that window.

### Follow-up query [ran] - what did the June 4 cron run look like?

```sql
SELECT DATE_TRUNC('hour', recorded_at) AS hour, account, COUNT(*) AS ph_rows
FROM price_history
WHERE recorded_at >= TIMESTAMP '2026-06-04 00:00:00+00'
  AND recorded_at <  TIMESTAMP '2026-06-05 00:00:00+00'
GROUP BY 1, 2 ORDER BY 1, 2;
```

| hour                    | account   | ph_rows |
|-------------------------|-----------|--------:|
| 2026-06-04 06:00:00+00  | CIN - AZ  | 22      |
| 2026-06-04 06:00:00+00  | CIN - OH  | 96      |
| 2026-06-04 06:00:00+00  | STL - MO  | 5       |
| 2026-06-04 06:00:00+00  | TBJ - FL  | 95      |

### Follow-up query [ran] - what was the June 4 21:52 merge event?

```sql
SELECT id, account, action, canonical_name, keeper_item_id, email, created_at
FROM merge_history
WHERE created_at BETWEEN TIMESTAMP '2026-06-04 21:50:00+00' AND TIMESTAMP '2026-06-04 21:54:00+00'
ORDER BY created_at;
```

| account   | action | canonical_name                | email                | created_at                     |
|-----------|--------|-------------------------------|----------------------|--------------------------------|
| STL - MO  | merge  | Tomato Crushed Rustic Dinapo  | k.fietek@kitchfix.com| 2026-06-04 21:52:01.468469+00  |

### Interpretation

- The 2026-06-03 20:37 event is **not the cron**. Cron pattern is midnight CT (~06:00 UTC on the June 4 row), hits multiple accounts. 20:37 UTC is 3:37 PM CT, hits STL-FL only. This has the shape of a scripted one-shot backfill or catch-up run targeting STL-FL alone.
- The 2026-06-04 06:00 UTC run **is** cron-shaped: 4-account fanout. But note that it hit only 4 of 9 accounts (missing TBR-FL, STL-FL, TXR-AZ, TXR-TX-H, TXR-TX-V). Either the cron's Sheets-vs-PG dual-write shed those accounts, or the cron ran only against some accounts that morning.
- The 2026-06-04 21:52 event was Kevin's manual merge on STL-MO ("Tomato Crushed Rustic Dinapo"). Unrelated to the freeze.
- **After 2026-06-04 21:52, nothing in any of the six SI tables.** Two months of silence.

---

## Q6: STL-FL delta - what has ai_line_items accumulated post-June-3 that isn't in the PG catalog?

**Answer: 727 distinct descriptions since 2026-06-03 20:37 UTC; 102 already covered by name/alias in the PG catalog; 625 not present.** Most of the 625 are legitimate items the cron would have appended if it had been writing to PG; a chunk are known-cron-filtered noise (fuel surcharges, delivery charges, minimum invoice amounts).

### Query [ran]

```sql
WITH stl_new AS (
  SELECT DISTINCT LOWER(TRIM(description)) AS desc_norm
  FROM ai_line_items
  WHERE account_key = 'STL - FL'
    AND created_at > TIMESTAMP '2026-06-03 20:37:32+00'
    AND description IS NOT NULL AND description <> ''
),
catalog AS (
  SELECT DISTINCT LOWER(TRIM(name)) AS name_norm FROM inventory_items
    WHERE account='STL - FL' AND status='active'
  UNION
  SELECT DISTINCT LOWER(TRIM(ia.alias_text)) FROM item_aliases ia
    JOIN inventory_items ii ON ii.id=ia.item_id
    WHERE ii.account='STL - FL' AND ii.status='active'
)
SELECT
  (SELECT COUNT(*) FROM stl_new) AS total_distinct_new_descriptions,
  (SELECT COUNT(*) FROM stl_new WHERE desc_norm IN (SELECT name_norm FROM catalog)) AS already_in_catalog_or_aliases,
  (SELECT COUNT(*) FROM stl_new WHERE desc_norm NOT IN (SELECT name_norm FROM catalog)) AS not_in_catalog;
```

### Result

| total_distinct_new_descriptions | already_in_catalog_or_aliases | not_in_catalog |
|--------------------------------:|------------------------------:|---------------:|
| 727                             | 102                           | 625            |

### Sample (top 20 by occurrence count) [ran]

```sql
WITH stl_new AS (
  SELECT DISTINCT LOWER(TRIM(description)) AS desc_norm, MAX(description) AS desc_display, MAX(created_at) AS latest, COUNT(*) AS ct
  FROM ai_line_items
  WHERE account_key='STL - FL' AND created_at > TIMESTAMP '2026-06-03 20:37:32+00'
    AND description IS NOT NULL AND description <> ''
  GROUP BY 1
),
catalog AS (
  SELECT DISTINCT LOWER(TRIM(name)) AS name_norm FROM inventory_items
    WHERE account='STL - FL' AND status='active'
  UNION
  SELECT DISTINCT LOWER(TRIM(ia.alias_text)) FROM item_aliases ia
    JOIN inventory_items ii ON ii.id=ia.item_id
    WHERE ii.account='STL - FL' AND ii.status='active'
)
SELECT desc_display AS description, ct AS occurrences, latest::date AS last_seen
FROM stl_new
WHERE desc_norm NOT IN (SELECT name_norm FROM catalog)
ORDER BY ct DESC, desc_display ASC
LIMIT 20;
```

| description                                                                | occurrences | last_seen  |
|----------------------------------------------------------------------------|------------:|------------|
| CHGS FOR FUEL SURCHARGE                                                    | 24          | 2026-07-31 |
| CUSTOMER INCENTIVE PROGRAM                                                 | 16          | 2026-06-18 |
| DELIVERY CHARGE                                                            | 16          | 2026-07-31 |
| WHLFIMP EGG WHOLE W/CITRIC AC 34730-64458-00                               | 13          | 2026-07-31 |
| COAT CHEF SS SNAP POL                                                      | 12          | 2026-07-02 |
| HORMEL BACON LAYOUT APPLEWOOD 13/17 55253                                  | 11          | 2026-07-31 |
| CALIFIA MILK OAT BARISTA BLEND 420697CA                                    | 10          | 2026-07-31 |
| BERRY BLUEBERRY 12/6 OZ                                                    | 9           | 2026-07-31 |
| NATALIE JUICE ORANGE FRESH 120001                                          | 9           | 2026-07-13 |
| HORMEL TURKEY BREAST SLI OIL BRN 1 OZ 32493                                | 8           | 2026-07-31 |
| SYS CLS GLOVE NITRILE FDSRV PF BLU 304363284                               | 8           | 2026-07-31 |
| APRON BIB NO PKT SPUN                                                      | 7           | 2026-07-13 |
| BROCCOLI FLORETTES 6/3 LB                                                  | 7           | 2026-07-31 |
| CGRVIMP JUICE APPLE 100% ASEPTIC 2812                                      | 7           | 2026-07-31 |
| ENERGY SURCHARGE                                                           | 7           | 2026-07-13 |
| MINIMUM INVOICE AMOUNT                                                     | 7           | 2026-07-13 |
| NAT VLY CEREAL GRANOLA OATSN HNY BLKPK 27111                               | 7           | 2026-07-08 |
| SALMON: **SK/OFF** 3-4 PBO SK/OFF SALPC3F                                  | 7           | 2026-07-31 |
| BOWL PULP NATURAL 24 OZ ROUND PULP PLUS 8.19X1.63 COMPOSTABLE PFAS FREE    | 6           | 2026-07-31 |
| CASAIMP CHEESE CHDR MILD FTHR SHRD YE 2927C4                               | 6           | 2026-07-10 |

### Interpretation

- Roughly 3 in 4 of the 625 non-cataloged descriptions look like real food/packaging/supplies items the cron would have promoted to catalog (with normalization) if it had been running against PG (egg product, bacon, oat milk, blueberries, orange juice, turkey breast, gloves, cheese, salmon, apron, cereal, broccoli).
- The remainder are surcharge/administrative line items the Railway cron's Claude prompt is specifically instructed to skip (fuel surcharge, delivery charge, minimum invoice, energy surcharge, customer incentive). Those would still show up in `ai_line_items` (Module 6 stores everything the OCR returns) but the cron's Claude pass drops them before writing to catalog.
- 102 already-covered descriptions is the "healthy overlap" - repeat items whose text happens to match verbatim or via an alias already in PG. That set is the floor for what the cron would have de-duped rather than newly created.

---

## Hypothesis

The Railway cron (`kitchfix-inventory-cron`) is almost certainly still running nightly against Google Sheets (that's where the operational catalog lives per `docs/MIGRATION_STATUS.md`), and STL-FL's Sheets catalog is presumably up-to-date. The freeze is in the **PG mirror of that catalog**, which stopped receiving cron writes on 2026-06-04 06:12 UTC when Module 7's parked-state posture took hold. The cron's PG dual-write was disabled around the migration project close-out (2026-06-12), and the 2026-06-03 20:37 UTC event was a targeted STL-FL catch-up backfill during that same close-out window - not a cron run, not a nightly cadence, and not repeatable without someone running the same script again.

Practical consequence for the earlier work: **the emergency count-sheet endpoint I built (PR #614) is reading a 2-month-old snapshot, not the live catalog.** For STL-FL that means the sheet shows 299 items when the Sheets side likely holds 500-800 (Q6's 727 new distinct descriptions since June 3 supports the upper end after cron dedup). The endpoint works mechanically, but it does not solve the "chef can count TODAY" problem it was intended to solve, because what it reads is stale.

---

## Recommended next step (do NOT build in this PR)

Two paths, in decreasing order of certainty:

1. **Emergency route: point the export at the Sheets catalog directly.** The Smart Inventory UI already reads from Sheets today; there is a live Sheets `INVENTORY` tab per account that the cron continues to write. A ~1 hour rewrite of `src/lib/inventoryExport.js` to source from the same helpers the SI UI uses (`src/lib/inventoryActions.js` / `sheets.js`) would give the STL-FL chef a truly current count sheet. This does NOT resolve the PG freeze but it does discharge the original operational need. Concern: `handleInventoryBootstrap` is the same code path that's currently timing out in the UI, so this rewrite would need to walk the Sheets catalog with the OCR/similarity scanner explicitly disabled.

2. **Structural route: bring PG back into the cron's write path.** Turn on Module 7 dual-write for the four cron-owned tables (`inventory_items` / `item_aliases` / `price_history` / `review_queue`) by setting `DUAL_WRITE_TABLES` accordingly in Railway's env and in Vercel's env (the intranet's admin writes also need dual-write). Requires: audit that the cron's PG write path is still functional (INV-1 schema is applied, cron code still calls `getServiceClient`), a backfill of the 2026-06-04 -> today window from Sheets or from `ai_line_items` reruns to close the two-month gap, and a probe run to verify. This is 2-4 hours of careful work, not a "one PR." Also fights with the parked-Module-7 posture in `MIGRATION_STATUS.md` - un-parking is a directional decision, not a diagnostic one.

Kevin picks between "keep the emergency export path but source from Sheets" and "un-park Module 7 dual-write to make PG the answer again." No code changes in this diagnostic PR.

---

## Notes on evidence quality

- All row counts and timestamps in this doc came from `[ran]` queries via the Supabase MCP client against production PG (project ref `dhkhvaokmtsfscnwnbum`) between roughly 14:15 and 14:55 UTC on 2026-08-04. No writes were issued; every query is a SELECT.
- I did not query Google Sheets (no MCP tool available for Sheets values). Claims about the Sheets-side catalog state ("presumably up to date," "cron writes to Sheets nightly") are `[code-read]` inferences from `docs/BUSINESS_NOTES.md` §"Railway cron invariants" and `docs/MIGRATION_STATUS.md` §"Module status," not verified directly. Kevin can spot-check by opening the STL-FL tab in the `INVENTORY` spreadsheet.
- The Railway cron repo (`kitchfix-inventory-cron`) was NOT examined in this session. Any claim about the cron's current code, dual-write toggle, or last-run timestamps on the Railway side would need to be sourced there.
- Env var / dual-write flag state is inferred from `MIGRATION_STATUS.md` line 74 ("flags OFF") and the observed silence of PG cron writes since 2026-06-04. Not verified against a Vercel or Railway env dump.
- Advisory (surfaced by the MCP client on the `list_tables` call): 34 public tables have RLS disabled, including all Smart Inventory tables. Anon key can read them. Not a bug being reported here; documenting it because the tool surfaced it and it is relevant to any future turn-on-dual-write conversation.
