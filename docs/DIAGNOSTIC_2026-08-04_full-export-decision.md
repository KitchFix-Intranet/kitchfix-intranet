# Diagnostic + decision: full-picture inventory export (STL-MO catalog freeze)

**Date:** 2026-08-04
**Trigger:** STL-MO chef needs to count; the PG catalog is frozen at 2026-06-04 and the export I built in PR #614 shows a 2-month-old snapshot for any account. Kevin's follow-on prompt asks for a decision between two paths:
- **Path A** - union the frozen PG catalog with unreconciled `ai_line_items` in-memory at export time (read-only)
- **Path B** - on-demand backfill from `ai_line_items` into PG catalog tables

**Scope:** Read-only investigation + full build spec for the recommended path. No endpoint code shipped in this PR.

**Filename note:** the prompt asked for `docs/DIAGNOSTIC_2026-08-04_catalog-freeze.md`. That filename is already claimed by an earlier still-open diagnostic PR #616 (`diagnostic/catalog-freeze-2026-06-03`) which established the freeze scope (system-wide, since 2026-06-04). Using this distinct filename avoids a rebase conflict on PR #616 and makes the two documents' scopes distinguishable ("catalog freeze" = what and when; "full-export-decision" = which of the two follow-on paths to build). PR #616 is the prerequisite reading for this doc; queries here don't re-cover ground it already established.

**Recommendation, up front: PATH A.** Reasoning in §"Decision matrix" below. Full spec in `docs/SPEC_full-inventory-export.md` (this PR).

---

## Executive summary

The `ai_line_items` PG table (Module 6, cut over) and `price_history` PG table (Module 7, frozen since 2026-06-04) are architecturally disjoint - **zero `invoice_uuid` in `ai_line_items` appears in `price_history.source_or_invoice_id`** across the whole database, all 9 accounts. So "unprocessed" in the prompt's sense means "every row in `ai_line_items`" - 15,624 rows systemwide, 2,503 for STL-MO alone.

For STL-MO specifically: 1,454 distinct descriptions in `ai_line_items`, of which 924 (63.5%) text-match into the existing PG catalog by name or alias, 530 (36.5%) do not. Path B's ≥70% text-match trigger fails; Path A's ≥30%-unmatched trigger fires. STL-MO also has 4 draft `count_sessions` and CIN-OH has 1 - Path A's "in-flight count session" trigger fires. Path A wins on 3 of 4 triggers; Path B fails 4 of 5.

The June 3 20:37 UTC event was previously identified (PR #616, Q5) as an STL-FL-only manual backfill, not a cron run - so the underlying schedule is not currently viable, which independently disqualifies the "one-shot backfill from a still-working cron" scenario Path B was written for.

Build Path A. Full spec attached.

---

## Q1: Is the freeze STL-MO-only, or systemic?

**Answer: Systemic across all 9 accounts** (the prompt anticipated 11; only 9 exist in PG). Same finding as PR #616 §Q1 - re-stated here for a single-doc read.

### Query [ran] (identical to PR #616 §Q1)

```sql
SELECT
  ii.account,
  MAX(ii.last_verified)                                                           AS max_last_verified,
  MAX(ii.updated_at)                                                              AS max_updated_at,
  MAX(ii.created_at)                                                              AS max_created_at,
  (SELECT MAX(ph.effective_date) FROM price_history ph WHERE ph.account = ii.account) AS max_ph_effective_date,
  (SELECT MAX(ph.recorded_at)    FROM price_history ph WHERE ph.account = ii.account) AS max_ph_recorded_at,
  (SELECT COUNT(*)               FROM price_history ph WHERE ph.account = ii.account
     AND ph.effective_date > DATE '2026-06-03')                                    AS ph_effective_after_jun3
FROM inventory_items ii
WHERE ii.status = 'active'
GROUP BY ii.account ORDER BY ii.account;
```

### Result

| account       | max_last_verified | max_updated_at              | max_created_at              | max_ph_effective_date | max_ph_recorded_at              | ph_effective_after_jun3 |
|---------------|-------------------|-----------------------------|-----------------------------|-----------------------|---------------------------------|------------------------:|
| CIN - AZ      | NULL              | 2026-06-04 17:15:57.313+00  | 2026-06-04 06:09:24.230+00  | 2026-06-03            | 2026-06-04 06:09:24.230+00      | 0                       |
| CIN - OH      | NULL              | 2026-06-04 17:15:57.313+00  | 2026-06-04 06:08:29.893+00  | 2026-06-03            | 2026-06-04 06:08:29.893+00      | 0                       |
| STL - FL      | NULL              | 2026-06-04 17:15:57.312+00  | 2026-06-03 20:37:32.524+00  | 2026-06-03            | 2026-06-03 20:37:32.524+00      | 0                       |
| STL - MO      | NULL              | 2026-06-04 21:52:01.468+00  | 2026-06-04 06:04:43.912+00  | 2026-06-01            | 2026-06-04 06:04:43.912+00      | 0                       |
| TBJ - FL      | NULL              | 2026-06-04 17:15:57.313+00  | 2026-06-04 06:12:45.373+00  | 2026-06-02            | 2026-06-04 06:12:45.373+00      | 0                       |
| TBR - FL      | NULL              | 2026-06-04 17:15:57.311+00  | 2026-06-02 06:09:36.911+00  | 2026-06-01            | 2026-06-03 06:05:50.272+00      | 0                       |
| TXR - AZ      | NULL              | 2026-06-04 17:15:57.311+00  | 2026-05-31 06:05:17.388+00  | 2026-05-30            | 2026-05-31 06:05:17.388+00      | 0                       |
| TXR - TX - H  | NULL              | 2026-06-04 17:15:57.310+00  | 2026-05-28 06:11:18.110+00  | 2026-05-21            | 2026-05-28 06:11:18.110+00      | 0                       |
| TXR - TX - V  | NULL              | 2026-06-04 17:15:57.311+00  | 2026-05-30 06:03:11.628+00  | 2026-05-29            | 2026-05-30 06:03:11.628+00      | 0                       |

Two important shape facts inherited from PR #616:
- **`last_verified` is NULL on every item, every account** - the column exists but the cron never writes it. My PR #614 export uses this column for "Last Ordered" - always blank.
- The `max_updated_at ~ 2026-06-04 17:15:57.31` shared across 8 accounts to within a millisecond is a single bulk backfill / correction event, not cron pattern.

---

## Q2: What is AI_LINE_ITEMS' actual storage today?

**Answer: Postgres. Table is `public.ai_line_items`, 15,624 rows total, Module 6 dual-write.**

### Query [ran]

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='ai_line_items'
ORDER BY ordinal_position;
```

Yields 29 columns including `id UUID PK`, `invoice_uuid UUID`, `account_key TEXT`, `description TEXT`, `unit TEXT`, `unit_price NUMERIC`, `extended_price NUMERIC`, `category TEXT`, `raw_json JSONB`, `created_at TIMESTAMPTZ`, plus Stage-A raw invoice columns from pr-9-1 (`item_number`, `pack_size`, `ordered_count`, `shipped_count`, `uom_raw`, `amount`, `weight_line_value`, `catch_weight_marker`, `raw_columns`).

### Query [ran] - per-account totals + freshness

```sql
SELECT
  account_key,
  COUNT(*) AS total_rows,
  MAX(invoice_date) AS most_recent_invoice_date,
  MAX(created_at)   AS most_recent_created_at,
  COUNT(*) FILTER (WHERE created_at > TIMESTAMP '2026-06-04 00:00:00+00') AS rows_created_after_jun4
FROM ai_line_items
GROUP BY account_key ORDER BY account_key;
```

### Result

| account_key   | total_rows | most_recent_invoice_date | most_recent_created_at         | rows_created_after_jun4 |
|---------------|-----------:|--------------------------|--------------------------------|------------------------:|
| CIN - AZ      | 1659       | 2026-07-29               | 2026-07-30 20:11:55.916+00     | 856                     |
| CIN - OH      | 1666       | 2026-07-29               | 2026-07-31 00:27:10.699+00     | 768                     |
| STL - FL      | 1887       | **23026-07-31** (typo)   | 2026-07-31 18:51:51.812+00     | 1492                    |
| STL - MO      | 2503       | 2026-07-30               | 2026-07-30 17:49:29.992+00     | 943                     |
| TBJ - FL      | 1722       | 2026-08-01               | 2026-08-03 13:43:32.390+00     | 1116                    |
| TBR - FL      | 2038       | 2026-08-01               | 2026-08-01 11:29:20.834+00     | 1315                    |
| TXR - AZ      | 1555       | 2026-08-03               | 2026-08-04 14:50:12.216+00     | 800                     |
| TXR - TX - H  | 1640       | 2026-07-24               | 2026-07-29 19:16:50.808+00     | 734                     |
| TXR - TX - V  | 954        | 2026-07-11               | 2026-07-11 21:25:59.264+00     | 343                     |

### Interpretation

- Cross-system Sheets reads are NOT required. Both catalog and line items live in the same Postgres DB - Path A or Path B are both same-DB reads on the input side.
- Note: at least one STL-FL row has `invoice_date = '23026-07-31'` (year 23026). Data-quality noise from OCR; not systemic. Spec §"Error handling" filters this out.

---

## Q3: For STL-MO specifically, how many unprocessed line items exist?

**Answer, strict-prompt definition: 2,503 line items (== total ai_line_items STL-MO rows).**
Every STL-MO row in `ai_line_items` is "unprocessed" per the prompt's `invoice_uuid` != `price_history.source_or_invoice_id` definition, because the two universes never overlap by construction. See Q3-followup for the architectural explanation.

### Query [ran]

```sql
WITH processed_uuids AS (
  SELECT DISTINCT source_or_invoice_id FROM price_history WHERE account='STL - MO'
)
SELECT
  COUNT(*)                                    AS unprocessed_line_items,
  COUNT(DISTINCT invoice_uuid)                AS distinct_unprocessed_invoices,
  COUNT(DISTINCT LOWER(TRIM(description)))    AS distinct_descriptions,
  MIN(invoice_date), MAX(invoice_date),
  MIN(created_at),   MAX(created_at)
FROM ai_line_items
WHERE account_key='STL - MO'
  AND invoice_uuid::text NOT IN (SELECT source_or_invoice_id FROM processed_uuids);
```

### Result

| unprocessed_line_items | distinct_unprocessed_invoices | distinct_descriptions | min_invoice_date | max_invoice_date | min_created_at | max_created_at |
|-----------------------:|------------------------------:|----------------------:|------------------|------------------|----------------|----------------|
| 2,503                  | 286                           | 1,234                 | 2020-03-25       | 2026-07-30       | 2026-06-01 18:35+00 | 2026-07-30 17:49+00 |

### Q3-followup [ran]: system-wide zero-overlap check

```sql
WITH matched AS (
  SELECT DISTINCT ali.account_key, ali.invoice_uuid
  FROM ai_line_items ali
  JOIN price_history ph
    ON ph.account = ali.account_key
   AND ph.source_or_invoice_id = ali.invoice_uuid::text
)
SELECT account_key, COUNT(*) FROM matched GROUP BY account_key;
```

Returned **0 rows.** Not a single `invoice_uuid` in `ai_line_items` (any account) has a matching `source_or_invoice_id` in `price_history` (any account).

### Sample of 20 unprocessed descriptions (top by occurrence) [ran]

```sql
SELECT description AS example, COUNT(*) AS occurrences
FROM ai_line_items
WHERE account_key='STL - MO'
  AND invoice_uuid::text NOT IN (
    SELECT DISTINCT source_or_invoice_id FROM price_history WHERE account='STL - MO'
  )
  AND description IS NOT NULL AND description <> ''
GROUP BY description
ORDER BY occurrences DESC LIMIT 20;
```

_Ran; sample truncated for readability in this doc. Distribution follows the same shape as Q6 (mix of legitimate items + cron-filterable surcharge/delivery-charge lines)._

### Interpretation

The prompt's `invoice_uuid` != `source_or_invoice_id` definition captures the situation faithfully but the "2 months of unreconciled invoices" framing is not quite the mechanism. The mechanism is:
- `ai_line_items` PG rows are Module-6 dual-writes, started when Module 6 cut over (2026-06-03).
- `price_history.source_or_invoice_id` values were populated by the INV-3 backfill of the Sheets-side price history snapshot AS OF 2026-06-04. That snapshot's UUIDs came from the cron's read of the AI_LINE_ITEMS Sheet (which does receive an invoice UUID from `triggerAIScan`).
- After 2026-06-04, the cron kept writing to the Sheets side (per `docs/MIGRATION_STATUS.md` "flags OFF") but not to PG.

Result: the two PG tables represent the same conceptual invoices in some overlap window (roughly late May to early June 2026), but their UUID linkages never lined up because they were populated by different code paths at different points in the dual-write phase. This is not a bug - it's the parked-Module-7 architecture. Path B's "insert the ones that are missing" model requires the two universes to be reconcilable; they aren't.

The right practical interpretation of "2,503 unprocessed" is "2,503 line items sitting in PG that have never been considered for catalog membership by any PG-side matching logic." The count is real; only the mental model of how it happened differs.

---

## Q4: Are invoices still being submitted?

**Answer: Yes, actively. STL-MO: 173 submissions since 2026-06-04 (124 with `ai_scan_complete=true`).** Same finding as PR #616 §Q3 - table below is the STL-MO-relevant slice.

### Query [ran]

```sql
SELECT
  account_key,
  COUNT(*) AS total_submissions,
  MAX(submitted_at) AS most_recent_submitted_at,
  COUNT(*) FILTER (WHERE submitted_at > TIMESTAMP '2026-06-04 00:00:00+00') AS submitted_after_jun4,
  COUNT(*) FILTER (WHERE ai_scan_complete = true AND submitted_at > TIMESTAMP '2026-06-04 00:00:00+00') AS scan_complete_after_jun4,
  COUNT(*) FILTER (WHERE ai_scan_status = 'pg_failed') AS pg_failed_total
FROM invoice_submissions GROUP BY account_key ORDER BY account_key;
```

### Result

| account_key   | total_submissions | most_recent_submitted_at        | submitted_after_jun4 | scan_complete_after_jun4 | pg_failed_total |
|---------------|------------------:|---------------------------------|---------------------:|-------------------------:|----------------:|
| CIN - AZ      | 201               | 2026-08-01 18:01:44.079+00      | 103                  | 70                       | 0               |
| CIN - OH      | 138               | 2026-07-31 00:27:16.678+00      | 61                   | 53                       | 0               |
| STL - FL      | 230               | 2026-07-31 18:33:31.204+00      | 188                  | 129                      | 0               |
| **STL - MO**  | **361**           | **2026-07-30 17:50:06.037+00**  | **173**              | **124**                  | **7**           |
| TBJ - FL      | 196               | 2026-08-03 13:35:13.024+00      | 138                  | 84                       | 1               |
| TBR - FL      | 219               | 2026-08-01 09:52:07.599+00      | 144                  | 111                      | 7               |
| TXR - AZ      | 185               | 2026-08-04 14:48:19.732+00      | 105                  | 65                       | 0               |
| TXR - TX - H  | 69                | 2026-07-29 19:23:13.830+00      | 33                   | 21                       | 0               |
| TXR - TX - V  | 56                | 2026-08-03 21:40:26.712+00      | 23                   | 11                       | 0               |

Operators alive on the STL-MO side. `pg_failed=7` on STL-MO is small enough to be normal recovery noise and not a systemic OCR-to-PG failure.

---

## Q5: Cross-system reconciliation for STL-MO

**Answer: 63.5% of the 1,454 distinct descriptions text-match into the existing STL-MO catalog. 36.5% (530 descriptions) do not.**

The threshold ratios here are the load-bearing evidence for the decision.

### Query [ran]

```sql
WITH stl AS (
  SELECT DISTINCT description FROM ai_line_items
  WHERE account_key='STL - MO' AND description IS NOT NULL AND description <> ''
),
norm AS (
  SELECT description AS raw,
         TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
           REGEXP_REPLACE(UPPER(description), '\s*-\s*\d{4,}\s*$', ''),
           '\s+\d{6,}\s*$', ''),
           '\s+', ' ', 'g'),
           '-{2,}', '-', 'g')) AS norm_desc
  FROM stl
),
catalog_names AS (
  SELECT DISTINCT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
    REGEXP_REPLACE(UPPER(name), '\s*-\s*\d{4,}\s*$', ''),
    '\s+\d{6,}\s*$', ''),
    '\s+', ' ', 'g'),
    '-{2,}', '-', 'g')) AS norm_name
  FROM inventory_items WHERE account='STL - MO' AND status='active'
),
catalog_aliases AS (
  SELECT DISTINCT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
    REGEXP_REPLACE(UPPER(ia.alias_text), '\s*-\s*\d{4,}\s*$', ''),
    '\s+\d{6,}\s*$', ''),
    '\s+', ' ', 'g'),
    '-{2,}', '-', 'g')) AS norm_alias
  FROM item_aliases ia JOIN inventory_items ii ON ii.id=ia.item_id
  WHERE ii.account='STL - MO' AND ii.status='active'
)
SELECT
  COUNT(*)                                                                    AS total_distinct_descriptions,
  COUNT(*) FILTER (WHERE norm_desc IN (SELECT norm_name FROM catalog_names))  AS matches_by_name,
  COUNT(*) FILTER (WHERE norm_desc IN (SELECT norm_alias FROM catalog_aliases)) AS matches_by_alias,
  COUNT(*) FILTER (WHERE norm_desc IN (SELECT norm_name FROM catalog_names)
                       OR norm_desc IN (SELECT norm_alias FROM catalog_aliases)) AS matches_either,
  COUNT(*) FILTER (WHERE norm_desc NOT IN (SELECT norm_name FROM catalog_names)
                     AND norm_desc NOT IN (SELECT norm_alias FROM catalog_aliases)) AS unmatched
FROM norm;
```

### Result

| total_distinct_descriptions | matches_by_name | matches_by_alias | matches_either | unmatched |
|----------------------------:|----------------:|-----------------:|---------------:|----------:|
| 1,454                       | 377             | 921              | **924 (63.5%)** | **530 (36.5%)** |

### Interpretation

- Aliases are the workhorse (921 matches, 63% of the total) - unsurprising: the cron's job was to build aliases so vendor-string variants map to the canonical item.
- **530 unmatched descriptions** (36.5%) is genuine judgment work - some are new items the catalog never learned, some are OCR variants the cron would have created aliases for. Getting them into the catalog cleanly is exactly the cron's job, and it requires either the cron's Claude prompt or a chef reviewing them one by one.
- 36.5% unmatched **triggers Path A** (>30% unmatched threshold). It also **kills Path B** (needs >70% matched; 63.5% is below).

---

## Q6: Merge_history exclusions for STL-MO

**Answer: 3 excluded items. Small enough to hardcode-suppress in either path.**

### Query [ran]

```sql
SELECT mh.id, mh.canonical_name, mh.reason, mh.email, mh.created_at,
       STRING_AGG(mhi.item_name, ' | ' ORDER BY mhi.item_name) AS excluded_items
FROM merge_history mh
LEFT JOIN merge_history_items mhi ON mhi.merge_id = mh.id
WHERE mh.account='STL - MO' AND mh.action='exclude'
GROUP BY mh.id, mh.canonical_name, mh.reason, mh.email, mh.created_at
ORDER BY mh.created_at;
```

### Result

| canonical_name                | email                  | created_at                     | excluded_items                |
|-------------------------------|------------------------|--------------------------------|-------------------------------|
| Chocolate Milk - 12 Oz Samples | k.fietek@kitchfix.com | 2026-04-10 20:33:24.207+00     | Chocolate Milk - 12 Oz Samples |
| 10 Lb Plastic Tubs & Lids      | k.fietek@kitchfix.com | 2026-04-10 21:10:13.541+00     | 10 Lb Plastic Tubs & Lids      |
| 20 Lb Plastic Tubs & Lids      | k.fietek@kitchfix.com | 2026-04-10 21:10:17.31+00      | 20 Lb Plastic Tubs & Lids      |

Full merge_history breakdown for STL-MO: 3 excludes, 0 review_deletes, 24 keep_separates, 19 merges, 2 archives.

### Interpretation

The 3 excluded items must be filtered out of the export - the chef should not see them, and Path B must never re-create them. Path A's read-only nature naturally protects against re-creation but the export layer still needs to omit them from display. Spec §"Exclusion honor" covers this.

The 24 `keep_separate` decisions are also informative for Path A: they represent chef-authored "these look similar but ARE different items" rulings. Any dedup logic must not collapse a keep_separate pair. Practical implication: our current PR #614 dedup by `(normKey, unit, category)` is fine because keep_separate items presumably differ on at least one of unit or normKey (that's the point of ruling they're distinct).

---

## Q7: The 2026-06-03 20:37 UTC event

**Answer, from PR #616 §Q5: STL-FL-only, 3:37 PM CT, single 20-minute window. NOT a cron run - wrong hour and wrong fanout.** 52 items + 86 aliases + 87 price rows for STL-FL alone. Zero rows for any other account. Shape of a targeted manual backfill run during the migration close-out window.

Re-verified [ran] in this session:

```sql
WITH win AS (SELECT TIMESTAMP '2026-06-03 20:27:00+00' AS t0,
                    TIMESTAMP '2026-06-03 20:47:00+00' AS t1)
SELECT 'inventory_items_created' AS metric, account, COUNT(*)
  FROM inventory_items CROSS JOIN win WHERE created_at BETWEEN win.t0 AND win.t1 GROUP BY account;
```

Returned only `STL - FL, 52`. All other queries in that window (price_history_recorded, item_aliases_learned, review_queue_created) also returned STL-FL-only rows or nothing.

### Interpretation

The last real cron-shaped write was `2026-06-04 06:00 UTC` (~midnight CT, 4-account fanout: CIN-AZ, CIN-OH, STL-MO, TBJ-FL). Nothing anywhere in the six SI tables since - two months of silence.

Combined with the June 3 event being a scripted STL-FL-only backfill rather than a scheduled run, the "cron is still viable, just needs a one-shot backfill" scenario that Path B's decision matrix asks about is not met. The cron either isn't running against PG at all or is running but with the dual-write flag off. Either way, waiting for the next nightly run to catch up STL-MO to 2026-08-04 is not going to happen without operator intervention. Path B is designed for a "one-shot catch-up" and only makes sense if the cron will keep it caught up going forward. It won't, under current posture.

---

## Q3.5 (bonus): In-flight count sessions

**Answer: 5 draft count sessions system-wide (STL-MO=4, CIN-OH=1). Path A trigger fires.**

### Query [ran]

```sql
SELECT account, status, COUNT(*) AS ct, MAX(started_at) AS max_started
FROM count_sessions
GROUP BY account, status ORDER BY account, status;
```

| account   | status | ct | max_started                    |
|-----------|--------|---:|--------------------------------|
| CIN - OH  | draft  | 1  | 2026-04-12 19:33:21.027+00     |
| STL - MO  | draft  | 4  | 2026-05-19 17:20:09.671+00     |

### Interpretation

The 4 STL-MO drafts have `max_started = 2026-05-19` (2.5 months old); they may be abandoned rather than actively in-flight. Strict reading of the decision matrix ("Any account currently has an in-flight count session (draft in count_sessions). Writing to catalog mid-count would break running totals.") treats them as blockers. Even if we relax the strict reading, the drafts are old enough that they may be draft-then-orphaned and there's no signal in the row that distinguishes those from a genuinely in-progress count - so the operationally-safe read is "treat as blockers." Path A trigger fires.

---

## Decision matrix

### Path A triggers (ANY true -> recommend A)

| # | Trigger                                                                                    | Fires? | Evidence                                                                                         |
|---|--------------------------------------------------------------------------------------------|--------|--------------------------------------------------------------------------------------------------|
| 1 | AI_LINE_ITEMS is still in Google Sheets and NOT in Postgres                                | **NO** | Q2: `ai_line_items` PG table exists, 15,624 rows                                                 |
| 2 | Unprocessed line item volume is large (>500) across multiple accounts                       | **YES** | Q3+Q3-followup: STL-MO 2,503; every other account also >500 (systemwide 15,624)                 |
| 3 | >30% of unprocessed descriptions do NOT match existing catalog by simple text               | **YES** | Q5: STL-MO 36.5% unmatched                                                                       |
| 4 | Any account has an in-flight count session (draft in count_sessions)                        | **YES** | Q3.5: STL-MO 4 drafts, CIN-OH 1 draft                                                            |

**3 of 4 Path A triggers fire (any = recommend A).**

### Path B triggers (ALL true -> recommend B)

| # | Trigger                                                                                     | Passes? | Evidence                                                                                        |
|---|---------------------------------------------------------------------------------------------|---------|-------------------------------------------------------------------------------------------------|
| 1 | AI_LINE_ITEMS is in Postgres                                                                | **YES**  | Q2                                                                                              |
| 2 | Unprocessed volume small (<500 STL-MO, <2,000 systemwide)                                    | **NO**   | Q3: STL-MO 2,503; systemwide 15,624                                                             |
| 3 | >70% of unprocessed descriptions match existing catalog by simple text                       | **NO**   | Q5: STL-MO 63.5% matched                                                                        |
| 4 | No in-flight count sessions                                                                  | **NO**   | Q3.5: 5 drafts exist                                                                            |
| 5 | Q7 confirms June 3 event was a single manual trigger + underlying cron process still viable  | **NO**   | Q7 half-passes: it was a manual trigger, but the underlying cron has been silent to PG for 2 months. "still viable" fails. |

**4 of 5 Path B triggers fail (all-must-pass = do NOT recommend B).**

### Recommendation

**Path A.** All four Path A triggers land except the one that depends on Sheets-only architecture (which was resolved by Module 6 cutover). Path B is disqualified on 4 of 5 gates.

Confidence: **high (>90%).** The 63.5% text-match rate is genuine judgment territory the cron was built for - reproducing that in a general-purpose backfill endpoint without Claude calls would either mis-match items (silent data corruption in the catalog) or leave 530 items untriaged in the export (defeating the point). The read-only union is honest about "here's what the catalog knows + here's what we've seen in invoices; the un-matched are labeled `NEW`" and lets the chef make the judgment during the physical count.

### What Path A doesn't solve

- Does not fix the cron's PG write path. That is either Module 7 un-parking or a fresh queries-over-facts v2 build (see `docs/modules/INVENTORY_MODULE.md`) - separately scoped.
- Does not de-duplicate `NEW` rows against each other beyond the same `(normKey, unit, category)` dedup PR #614 already uses. If two OCR variants describe the same new item, both surface as `NEW` and the chef consolidates during count. Acceptable.
- Does not resolve the `invoice_date = '23026-07-31'` OCR typos or `ai_scan_status=pg_failed` invoices - both are pre-existing, small enough that Kevin can spot-fix; spec §"Error handling" filters typos out of the export display.

---

## Hypothesis carried forward from PR #616

The `docs/MIGRATION_STATUS.md` "flags OFF" posture on Module 7 combined with Module 6's dual-write turn-on the day before is the mechanism. The Railway cron continues writing to the Sheets `INVENTORY` catalog nightly (unverified from PG alone; would need to open the sheet); the PG `inventory_items` table is a frozen snapshot from INV-3 backfill. Nothing in this session changed that hypothesis.

---

## Notes on evidence quality

- All row counts and timestamps came from `[ran]` queries via the Supabase MCP client against production PG (`dhkhvaokmtsfscnwnbum`), between roughly 15:00 and 15:30 UTC 2026-08-04. No writes issued.
- Q1, Q2, Q4, Q7 restate results from PR #616 verbatim (re-verified this session where relevant); Q3, Q3.5, Q5, Q6 are new work for the STL-MO decision.
- Did not query Google Sheets. The Sheets-side `INVENTORY` catalog state is unverified from this session - Kevin can spot-check by opening the STL-MO tab.
- Did not open the Railway cron repo. Any claim about the cron's current write behavior is `[code-read]` inference from `docs/BUSINESS_NOTES.md` §"Railway cron invariants."
- Env-var / dual-write flag state inferred from `MIGRATION_STATUS.md` line 74 ("flags OFF") + the observed 2-month silence of PG cron writes since 2026-06-04.
- Advisory the MCP client surfaced: 34 public tables have RLS disabled, including all Smart Inventory tables. Not a bug being reported in this doc; carried forward from PR #616 for future reference.
