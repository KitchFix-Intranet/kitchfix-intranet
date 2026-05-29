# Module 6 (Invoice) Data Audit

**Audit date:** 2026-05-29
**Auditor:** Claude (Opus 4.7 1M)
**Method:** Read-only enumeration of production Sheets vs the planned PG schemas in `docs/FINANCE_STACK_PLAN.md` Section 2.2.
**Purpose:** Identify schema drift, dedup constraint violations, orphans, and partial rows BEFORE Module 6 schema work begins. Module 5 lesson #3 ("PG schema constraints surface latent data quality issues") drove this audit.

## 1. Executive Summary

### Headline

Module 6 source data has **218 row-level historical artifacts** plus one significant schema-drift discovery. Per Kevin's locked decision (Section 8), the artifacts are PRESERVED via an `is_historical` schema pattern rather than cleaned. Strict integrity constraints (UNIQUE, NOT NULL FK, status enum) apply only to `is_historical=FALSE` future rows. Sheets-era data carries `is_historical=TRUE` and bypasses the strict constraints while remaining queryable and auditable. See Section 8 for the full preservation-first architecture.

The ONE cleanup performed: 5 typo `invoice_date` corrections in Sheets (a different class of issue - human typos, not accumulated schema drift).

| Severity | Finding | Count | Action |
|---|---|---|---|
| **CRITICAL** | `invoice_submissions_26` header row says 15 columns, but actual data extends to 23 columns (cols P-W are populated but unlabeled in the header). The 8 hidden cols (type, raw_drive_url, rejection_reason, rejection_note, rejected_by, rejected_at, corrected_from_uuid, dupe_override) ARE in active use per `parseSubmissionRow`. Plan's invoice_submissions schema matches the actual 23-col structure - no plan change needed, but the header should be extended in Sheets for clarity (low-priority cleanup; doesn't block migration). | 590 rows affected (all of them) | Document; optionally extend header in Sheets pre-cutover. |
| **CRITICAL** | The `status` column (col N, idx 13) is **overloaded between AI Scan Status and workflow status**. Header says "AI Scan Status" but the column carries 7 values: 4 are workflow states (`sent`/`returned`/`corrected`/`deleted`) and 3-4 are AI scan states (`complete`/`failed`/`pending`/`photo-only`). When a row is rejected or corrected, its AI scan state is overwritten. **The plan's CHECK constraint `status IN ('sent','returned','corrected','deleted')` will reject 101 rows (17%) without migration mapping.** | 101 rows in non-plan-enum states: complete=71, failed=12, pending=7, photo-only=11 | Plan amendment + backfill-time mapping logic. See Section 4. |
| **HIGH** | **209 AI line item rows reference invoice_uuid that does NOT exist in invoice_submissions_26**. 145 unique orphan UUIDs (some are clearly reprocessing artifacts like `REBUILD-204842-00-1`; some are deleted/lost submissions). | 209 rows / 5438 total = 3.8% orphan rate | Either delete orphans pre-backfill, OR change PG FK to ON DELETE SET NULL + allow NULL invoice_uuid. |
| **MEDIUM** | **4 duplicate (invoice_uuid, line_num) pairs** in AI line items violate the planned UNIQUE constraint. Concentrated in 3 UUIDs - may be cron reprocessing artifacts. | 4 dupes total | Sheets cleanup (4 row deletes) before backfill. |
| **LOW** | **5 invoice_date values cannot be parsed** as ISO dates. | 5 rows | Manual review + correction before backfill, OR allow NULL invoice_date in PG. |
| **LOW** | 1 line item with description shorter than 3 chars, 1 with garbage text. 1 GL code row with empty name. | 3 cells | Cosmetic; not migration-blocking. |

### Cleanups Required Before PR 6.x Backfill

- (a) **Plan amendment for status enum** (no Sheets changes; doc-only). Required before PR 6.1 schema PR.
- (b) **209 orphan AI line item rows decision**: delete OR loosen PG FK. Required before PR 6.2/6.3.
- (c) **4 duplicate AI line item rows**: Sheets cleanup. Required before PR 6.3 backfill.
- (d) **5 unparseable invoice_date rows**: manual review or schema flex. Required before PR 6.3 backfill.

### Time Spent

~2 hours total. ~30 min for tab discovery + initial audit. ~30 min for first-pass interpretation. ~15 min for the deeper rechecks (status drift, glBreakdown structure, orphan UUID investigation). ~45 min for this report.

### Schema Drift vs FINANCE_STACK_AUDIT.md

The audit doc references the 23-col structure correctly via `parseSubmissionRow` line citations. The plan's PG schema for invoice_submissions also matches the 23-col canonical shape. The drift is between the **Sheet header row** (15 cols documented) and the **actual data extent** (23 cols in active use). The audit doc did not flag this; this audit adds that flag.

## 2. Per-Tab Findings

### 2.1 `invoice_submissions_26` (COLLECTION sheet)

**Shape:**
- Total data rows: **590**
- Documented header columns: **15** (cols A-O)
- Actual data column extent: **up to 23** (cols A-W)
- Row width distribution: 68 rows at width 16, 471 at width 17, 26 at width 21, 23 at width 22, 2 at width 23

**Header (cols A-O):**
```
UUID, Timestamp, Email, Account, Vendor, Vendor ID, Invoice #, Invoice Date, Total Amount, GL Breakdown, Drive URLs, Page Count, Email Sent, AI Scan Status, AI Scan Timestamp
```

**Hidden cols P-W (in active use per `parseSubmissionRow` + write call sites at L1012, L1132, L1003):**
```
P: type (invoice/credit)
Q: rawDriveUrl
R: rejectionReason
S: rejectionNote
T: rejectedBy
U: rejectedAt
V: correctedFromUuid
W: dupeOverride
```

**Dedup integrity (clean):**
- **0** UUID duplicates (F25 idempotency working as designed)
- **0** F24 (vendor_id, invoice_number_normalized, invoice_date, total_amount) field-dedup violations across all 590 rows
- **0** rows with empty `vendor_id`
- **0** non-numeric totals

**Status column (col N) drift:**
```
sent       : 462
complete   :  71   <- AI scan status, not workflow
corrected  :  23
failed     :  12   <- AI scan status, not workflow
photo-only :  11   <- AI scan status, not workflow
pending    :   7   <- AI scan status, not workflow
returned   :   4
deleted    :   0
TOTAL      : 590
```

The plan's CHECK constraint `status IN ('sent','returned','corrected','deleted')` would reject **101 rows (17%)**. Resolution must split this column into two PG fields (separate workflow status from AI scan status). The plan's schema already has `ai_scan_complete BOOLEAN` separate from `status`, so the intent is already separation - just the migration mapping needs to be specified.

**Type column (col P) distribution:**
```
invoice : 550
credit  :  40
TOTAL   : 590
```
All 590 rows have a valid type value matching the plan's `CHECK (type IN ('invoice','credit'))`. No drift.

**Rejection cols R-U:**
- 27 rows have any of R/S/T/U populated (matches manual count of 27 rejection records)
- 0 rows have missing rejected_at when reason is populated
- 0 rows have missing rejected_by when reason is populated
- Plan's `invoice_rejections` separate table can be cleanly extracted from these 27 rows.

**Timestamp integrity (mostly clean):**
- timestamp (col B): **0** parse failures
- invoice_date (col H): **5** parse failures (samples available - see Section 5 open questions)
- rejected_at (col U): **0** parse failures
- status_updated_at (col O): **0** parse failures

**GL breakdown integrity (clean):**
- 862 total GL code references across 590 submissions
- **0** unparseable glBreakdown JSON
- **0** non-array glBreakdown values (all are JSON arrays of `{code, name, amount}` objects - the planned schema's interpretation of glBreakdown as JSONB matches)
- **0** orphan GL references (every code in a submission's glBreakdown exists in the matching GL_CODES tab)

### 2.2 AI_LINE_ITEMS (per-account tabs)

**Shape:**
- Total tabs: **9** (one per active account)
- Total line item rows across all tabs: **5438**

**Tab list:**
```
"STL - FL", "STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V",
"TXR - AZ", "CIN - AZ", "TBR - FL", "TBJ - FL"
```

**Orphan rate:**
- Rows with empty `invoice_uuid`: **0**
- Rows with empty `line_num`: **0**
- Rows whose `invoice_uuid` is NOT in invoice_submissions_26: **209** (3.8% orphan rate)
- Unique orphan UUIDs: **145**

**Top orphan UUIDs:**
```
ef5620a4-1648-4004-b2a8-26640e4fbe27: 36 line items
5f31f6b5-e269-4545-bded-34ad3b2b974d: 22 line items
REBUILD-204842-00-1                 :  1 line item     <- NOT a UUID; cron reprocessing artifact
REBUILD-204842-00-2                 :  1 line item     <- same
REBUILD-204842-00-3                 :  1 line item     <- same
```

The "REBUILD-" prefixed identifiers are clearly NOT submission UUIDs - they look like cron reprocessing or test artifacts that were accidentally appended. Need decision on disposition: delete or keep as historical?

**Dedup integrity:**
- 4 duplicate `(invoice_uuid, line_num)` pairs:
  ```
  5f31f6b5-e269-4545-bded-34ad3b2b974d || line 8
  a049c1b8-e28e-4c01-bb71-d8626c16fbb7 || line 69
  74048609-935e-408a-aa74-0d4cc53fd721 || line 170
  74048609-935e-408a-aa74-0d4cc53fd721 || line 140
  ```
  These violate the plan's `UNIQUE (invoice_uuid, line_num)` constraint. Likely cron rerun artifacts.

**Description quality:**
- 1 row with description <3 chars
- 1 row with garbage string ("test"/"asdf"/etc)
- **0** rows matching AI hallucination patterns (`/i cannot extract/`, `/no items found/`, `/unclear/`, `/not provided/`, etc.)

**Timestamp integrity (clean):**
- **0** bad timestamps across all 5438 rows

### 2.3 GL_CODES (per-account tabs)

**Shape:**
- Total tabs: **14** (12 per-account + 2 utility: "Class Overview" + "Master Template")
- Total raw rows across all tabs: 746
- Leaf code rows (col B has a code value): **393**

**Tab list (12 per-account + 2 utility):**
```
Class Overview (utility - cross-reference)
Master Template (utility - new account onboarding template)
CORP
CIN - AZ (REDS), CIN - KY (LBATS), CIN - OH (CINN)
STL - FL, STL - MO
TBJ - FL, TBJ - BUF
TBR - FL
TXR - AZ, TXR - Home, TXR - Vistor
```

**Per-tab leaf-code counts:**
```
Class Overview        :  15 (reference)
CORP                  :  31
CIN - AZ (REDS)       :  28
CIN - KY (LBATS)      :  22
CIN - OH (CINN)       :  22
STL - FL              :  21
STL - MO              :  21
TBJ - FL              :  35
TBJ - BUF             :  16
TBR - FL              :  31
TXR - AZ              :  27
TXR - Home            :  24
TXR - Vistor          :  22
Master Template       :  78 (reference)
```

**Dedup integrity (clean):**
- **0** duplicate `(account_key, code)` pairs across all 393 leaf code rows
- **1** leaf code row with empty name (col A) - cosmetic, not blocking

**Notes:**
- "Vistor" is the production spelling - probably intentional shorthand for "Visitors" in the dressing-room context. Plan's `gl_codes.code` schema preserves as-is.
- The 78 Master Template leaf codes are a superset for new-account onboarding. Plan's `is_purchasing` classification per Q8 happens at backfill time - the template's codes need an admin to mark `is_purchasing=true/false` per row OR the backfill applies the EXCLUDED_CATEGORIES/SECTION_MARKERS/EXCLUDED_ITEMS logic from `parseGLCodes` (current runtime filter) at backfill time. Per plan Section 8 item resolution (Q8): backfill applies the runtime filter.

### 2.4 `invoice_rejections` location

**Resolution**: `invoice_rejections` does **NOT** exist as a separate sheet or tab. It is embedded in `invoice_submissions_26` as cols R-U (rejection_reason, rejection_note, rejected_by, rejected_at).

**Counts:**
- 27 rows have any rejection field populated
- 0 rejections with missing rejected_at
- 0 rejections with missing rejected_by
- 0 rejections with missing rejection_reason

The plan's `invoice_rejections` separate table extraction from these 27 rows is clean (no missing fields).

## 3. Sheets Cleanups Performed + Deferred

**Post-decision (Section 8 preservation-first architecture)**, the only Sheets-side cleanup is item (d). All other listed items are handled at the PG schema layer via `is_historical=TRUE` tagging.

| # | Cleanup | Affected | Status |
|---|---|---|---|
| ~~(a)~~ | ~~Plan amendment for status enum~~ | n/a | SUPERSEDED: status CHECK becomes `is_historical=TRUE OR status IN (...)`. Historical rows can carry any value; new writes get strict enum. See Section 8. |
| ~~(b)~~ | ~~Decide AI_LINE_ITEMS orphan disposition~~ | 209 rows | SUPERSEDED: all 209 preserved as `is_historical=TRUE` with `invoice_uuid=NULL` + `historical_invoice_ref=<original>`. See Section 8. |
| ~~(c)~~ | ~~Resolve 4 duplicate (invoice_uuid, line_num) pairs~~ | 4 rows | SUPERSEDED: both rows in each pair preserved as `is_historical=TRUE`; partial UNIQUE INDEX only enforces uniqueness when `is_historical=FALSE`. See Section 8. |
| **(d)** | **5 typo invoice_date corrections** | 5 rows | **DONE 2026-05-29**: Cell-level Sheets updates applied + verified (0206->2026, 4x 201X->202X). Typos are a different class of issue than accumulated schema drift; corrected in Sheets so PG receives clean DATE values. |
| ~~(e)~~ | ~~Optional: extend invoice_submissions_26 header row~~ | 1 row | DEFERRED per Q7. Low priority. |
| ~~(f)~~ | ~~Optional: cosmetic cleanups (short desc / garbage / empty GL name)~~ | 3 cells | DEFERRED. Will land in PG as-is with `is_historical=TRUE`. |

## 4. Schema Design Implications

### 4.1 `invoice_submissions.status` enum needs amendment

**Plan's current CHECK:**
```sql
status TEXT NOT NULL DEFAULT 'sent'
  CHECK (status IN ('sent','returned','corrected','deleted'))
```

**Production reality (101 / 590 = 17% rows fail this CHECK):**
- `complete` (71), `failed` (12), `pending` (7), `photo-only` (11) all surface in col N at submit-time via the AI scan path.

**Recommended migration mapping** (applied at backfill `transformToPg` time):
```js
function migrateStatus(sheetStatus) {
  const s = String(sheetStatus || "sent").trim().toLowerCase();
  // Workflow states pass through
  if (["sent", "returned", "corrected", "deleted"].includes(s)) return s;
  // AI scan states map back to 'sent' (the implicit workflow state was 'sent' before the AI status overwrote it)
  if (["complete", "failed", "pending", "photo-only"].includes(s)) return "sent";
  // Unknown: log + default to 'sent'
  console.warn(`Unknown status "${s}", defaulting to sent`);
  return "sent";
}

function migrateAiScanComplete(sheetStatus) {
  const s = String(sheetStatus || "").trim().toLowerCase();
  return s === "complete";
}
```

**Effect after migration:**
- 462 sent + 71 complete -> 533 with status='sent' (71 of those have ai_scan_complete=true, rest false)
- 23 corrected -> 23 with status='corrected'
- 4 returned -> 4 with status='returned'
- 12 failed -> 12 with status='sent', ai_scan_complete=false
- 11 photo-only -> 11 with status='sent', ai_scan_complete=false (need new field? See open question 1)
- 7 pending -> 7 with status='sent', ai_scan_complete=false (need new field? See open question 1)

### 4.2 `ai_line_items.invoice_uuid` FK requires decision

**Plan's current FK:**
```sql
invoice_uuid UUID NOT NULL REFERENCES invoice_submissions(id) ON DELETE CASCADE
```

**Production reality:** 209 rows (3.8%) have `invoice_uuid` values that don't exist in invoice_submissions_26. PG INSERT would fail FK violation on these rows.

**Options:**
1. **Delete orphan rows pre-backfill**. Keeps schema strict. Loses 209 rows of historical AI extraction data.
2. **Relax FK**: drop the FK constraint OR add ON DELETE SET NULL + make `invoice_uuid` nullable. Preserves historical data. Adds query complexity.
3. **Match orphans to a fallback "deleted_submissions" placeholder UUID**. Preserves data with a sentinel reference. Schema gymnastics.

**Recommended**: Option 1 (delete). Reasoning: 145/209 of the orphans look like they correspond to deleted submissions OR cron reprocessing artifacts with malformed IDs (the `REBUILD-...` prefix). Historical AI extraction data on a deleted submission has little value.

### 4.3 `ai_line_items` UNIQUE constraint

**Plan's current:**
```sql
UNIQUE (invoice_uuid, line_num)
```

**Production reality:** 4 violations exist. Cleanup before backfill (Sheets row delete for the dupes).

### 4.4 `invoice_submissions.invoice_date` nullability

**Plan's current:**
```sql
invoice_date DATE
```
(implicit NULL allowed)

5 rows have unparseable invoice_date values. Plan's schema already allows NULL, so backfill can just set NULL for unparseable values + log them. No plan change needed.

### 4.5 `invoice_submissions` actual column structure vs header

The 23-col data structure is in active production use even though only 15 cols are in the header row. This means:
- Plan's invoice_submissions schema matches actual data (no plan change for this)
- Sheets header should optionally be extended to 23 cols pre-cutover for clarity (low priority)
- During dual-write window, the orchestrator's Sheets adapter writes to all 23 cols regardless

## 5. Open Questions for Kevin

1. **Where do `photo-only` and `pending` statuses fit in the new schema?** They aren't "AI scan complete" (so `ai_scan_complete=false`), they aren't "AI scan failed" either, and they don't map to any workflow state. Three options:
   - (a) Map both to `ai_scan_complete=false` and accept loss of distinction.
   - (b) Add a separate `ai_scan_status` TEXT column (CHECK constraint `pending`/`complete`/`failed`/`photo-only`/`null`) alongside the boolean `ai_scan_complete`. More precise but expands schema surface.
   - (c) Split the AI scan info entirely off invoice_submissions into a separate `invoice_ai_scans` table with its own status enum.

   **My recommendation: (b)**. Adds 1 column, preserves audit info, doesn't expand schema cross-table complexity.

2. **What is the "REBUILD-204842-00-1" line item invoice_uuid pattern?** 3 line items use this non-UUID identifier. Looks like a cron reprocessing artifact. Delete or investigate?

3. **209 orphan line item disposition**: confirm Option 1 (delete pre-backfill) per Section 4.2 recommendation, OR pick a different option.

4. **4 duplicate (invoice_uuid, line_num) pairs**: should I write a Sheets-side dedupe script (mirroring the PR 5.3 Pair 1 cleanup pattern), or do you want to manually review each pair to pick the keep-row first?

5. **5 unparseable invoice_date rows**: I can dump them for you to review the actual values. Default action without your input is to set NULL during backfill (which the plan's schema already allows).

6. **Master Template + Class Overview GL_CODES tabs**: these are utility tabs that aren't bound to a real account. Plan Section 4 implicitly treats them as out-of-scope for backfill (per `GL_TAB_MAP` excluding them). Confirm: skip these 2 tabs entirely during gl_codes backfill, OR backfill them with a special account_key like `"__TEMPLATE__"` for new-account-onboarding workflows?

7. **invoice_submissions_26 header extension**: do you want me to extend the Sheet header row from 15 to 23 cols pre-cutover for documentation clarity? Low priority.

## 6. Summary Counts

| Source | Rows | Notes |
|---|---|---|
| invoice_submissions_26 | 590 | 0 dedup violations, 101 status-enum drift rows (preserve), 27 rejections embedded. 5 typo invoice_dates CORRECTED 2026-05-29. |
| AI_LINE_ITEMS (9 tabs) | 5438 | 209 historical orphans (138 REBUILD-* + 71 valid-UUID-but-parent-gone), 4 line_num dupes. All preserved per Section 8. |
| GL_CODES (14 tabs total: 12 account + 2 utility) | 746 rows / 393 leaf codes | 12 per-account tabs migrate as `is_historical=TRUE`. Master Template + Class Overview SKIPPED per Q6 (admin reference, Sheets-only post-cutover). |
| invoice_rejections | 27 (embedded in cols R-U) | 0 missing required fields, clean extraction path. All migrated as `is_historical=TRUE`. |

**Preservation-first migration design (Section 8): all 218 historical artifacts preserved in PG with `is_historical=TRUE` + `data_provenance` provenance tag. ZERO data deleted from Sheets pre-backfill (except the 5 typo date corrections, which are not data integrity issues but human typos).**

| Artifact category | Count | Disposition |
|---|---|---|
| Status-enum-drift submissions (complete/failed/pending/photo-only) | 101 | Preserved: `status='sent'` + `ai_scan_status=<original>` + `is_historical=TRUE` |
| Orphan AI line items (138 REBUILD-* + 71 valid-UUID-orphans) | 209 | Preserved: `invoice_uuid=NULL` + `historical_invoice_ref=<original>` + `is_historical=TRUE` |
| Duplicate (invoice_uuid, line_num) line items | 4 | Both rows in each pair preserved: `is_historical=TRUE` bypasses partial UNIQUE INDEX |
| Typo invoice_dates corrected in Sheets | 5 | Cleanly migrated as valid DATE values + `is_historical=TRUE` |
| Cosmetic (short desc / garbage / empty GL name) | 3 | Migrate as-is with `is_historical=TRUE`. Backlog for future cleanup project. |

## 7. Migration Sequence Implication for PR 6.x

Per the plan (`docs/FINANCE_STACK_PLAN.md` Section 4), Module 6 is 3 PRs: 6.1 (schema + dormant adapters), 6.2 (handler rewire + cleanups), 6.3 (backfill). This audit's findings - and Kevin's locked Section 8 preservation-first decision - affect each PR:

**PR 6.1 schema PR** - adopt the `is_historical` schema pattern across all 4 invoice tables:
- All 4 tables add: `is_historical BOOLEAN NOT NULL DEFAULT FALSE`, `data_provenance TEXT NOT NULL DEFAULT 'app_scan' CHECK IN ('app_scan', 'batch_rebuild', 'manual_entry', 'unknown')`
- `invoice_submissions`: status CHECK becomes `CHECK (is_historical = TRUE OR status IN ('sent', 'returned', 'corrected', 'deleted'))`. Add `ai_scan_status TEXT` column.
- `ai_line_items`: change `invoice_uuid` to NULLable + FK with ON DELETE CASCADE. Add `historical_invoice_ref TEXT` for synthetic IDs. UNIQUE (invoice_uuid, line_num) becomes partial index `WHERE is_historical = FALSE`. Add CHECK ensuring new rows have either real parent FK or historical ref.
- `invoice_rejections`: only adds the 2 base columns.
- `gl_codes`: only adds the 2 base columns. Master Template + Class Overview tabs SKIPPED per Q6.

See FINANCE_STACK_PLAN.md Section 2.2 (amended in PR #94) for full DDL.

**PR 6.2 handler rewire** - no direct impact from this audit. Standard rewire per Module 5 pattern. Handlers must pass `module: "ops"` to orchestrators (Module 5 lesson #1 - PR #92).

**PR 6.3 backfill** - all existing rows tagged `is_historical=TRUE`:
- `invoice_submissions`: 590 rows. Apply status -> {status, ai_scan_status} split per Section 4.1 mapping function. Set `data_provenance='app_scan'` for all (provenance was always app).
- `ai_line_items`: 5438 rows. For 138 REBUILD-* rows: `invoice_uuid=NULL`, `historical_invoice_ref="REBUILD-{n}-{i}"`, `data_provenance='batch_rebuild'`. For 71 valid-UUID orphans: `invoice_uuid=NULL`, `historical_invoice_ref=<original UUID as TEXT>`, `data_provenance='unknown'`. For 5158 in-bounds rows: `invoice_uuid=<resolved>`, `data_provenance='app_scan'`. The 4 dupe pairs both migrate cleanly because partial UNIQUE INDEX only enforces on `is_historical=FALSE`.
- `invoice_rejections`: 27 rows. Extract cols R-U from `invoice_submissions_26` rows. `data_provenance='app_scan'` (admin rejection flow is in-app).
- `gl_codes`: 393 leaf codes from 12 per-account tabs. `data_provenance='manual_entry'` (sheet-edited by admins).

**Estimated additional work** beyond the plan's 28-38 hour Module 6 estimate: **+3-5 hours** for PR 6.1 schema amendment + PR 6.3 backfill transform logic. Less than the original +2-4 estimate because we are not writing cleanup scripts.

## 8. Locked Architecture: Preservation-First Migration Design

### Rationale

The 218 row-level artifacts surfaced in Sections 2 + 3 represent **accumulated schema drift from app evolution**, not garbage:
- The 101 status-enum-drift rows reflect a column whose semantics changed over time (workflow status conflated with AI scan status). Real workflow events; just stored in a way that fails the planned strict enum.
- The 138 REBUILD-* line items reflect a 2026-04-03 batch re-extraction of 10 Kuna invoices, 9 of which have surviving submission parents. Real AI extraction work product; just appended with synthetic IDs instead of resolving to original UUIDs.
- The 71 valid-UUID orphan line items reflect submissions that were subsequently deleted from the Sheet. Real historical AI extractions; parent is gone.
- The 4 duplicate (invoice_uuid, line_num) pairs reflect AI emitting collide-on-line-num within a single scan. Both rows are real items; just mis-numbered.

**Cleaning these means deleting real work product.** Preserving them with a tag means PG retains 100% of the historical signal while letting the strict-integrity constraints apply only to future writes.

### Pattern: Three Columns + Conditional Constraints

All 4 invoice tables in Module 6 schema (invoice_submissions, invoice_rejections, ai_line_items, gl_codes) get:

```sql
is_historical     BOOLEAN NOT NULL DEFAULT FALSE
data_provenance   TEXT    NOT NULL DEFAULT 'app_scan'
                  CHECK (data_provenance IN ('app_scan', 'batch_rebuild', 'manual_entry', 'unknown'))
```

`ai_line_items` additionally gets:
```sql
historical_invoice_ref TEXT  -- preserves synthetic IDs like "REBUILD-204842-00-1" or original UUID-as-text for parent-deleted rows
```

**Strict constraints become conditional on `is_historical = FALSE`** via partial indexes and CHECK predicates. Pattern examples:

- Status enum: `CHECK (is_historical = TRUE OR status IN ('sent', 'returned', 'corrected', 'deleted'))`. Historical rows can carry any value.
- Line-number uniqueness: `CREATE UNIQUE INDEX idx_x ON ai_line_items (invoice_uuid, line_num) WHERE is_historical = FALSE`. Historical pairs may share keys.
- Parent FK: `invoice_uuid UUID REFERENCES invoice_submissions(id) ON DELETE CASCADE` with `CHECK (is_historical = TRUE OR invoice_uuid IS NOT NULL)`. Historical rows may have NULL parent (use `historical_invoice_ref` instead).

### Per-Table Effects

**`invoice_submissions`:**
- Add `ai_scan_status TEXT` column (CHECK `ai_scan_status IS NULL OR ai_scan_status IN ('pending', 'complete', 'failed', 'photo-only')`).
- Backfill 590 rows: for each, examine col N value:
  - If value in `('sent', 'returned', 'corrected', 'deleted')`: `status=<value>`, `ai_scan_status=NULL`, `is_historical=TRUE`.
  - If value in `('complete', 'failed', 'pending', 'photo-only')`: `status='sent'`, `ai_scan_status=<value>`, `is_historical=TRUE`.
  - All rows: `data_provenance='app_scan'`.

**`ai_line_items`:**
- 138 REBUILD-* rows: `invoice_uuid=NULL`, `historical_invoice_ref="REBUILD-{n}-{i}"`, `data_provenance='batch_rebuild'`, `is_historical=TRUE`.
- 71 valid-UUID orphans: `invoice_uuid=NULL`, `historical_invoice_ref=<original UUID as TEXT>`, `data_provenance='unknown'`, `is_historical=TRUE`.
- 5158 in-bounds rows: `invoice_uuid=<resolved>`, `historical_invoice_ref=NULL`, `data_provenance='app_scan'`, `is_historical=TRUE`.
- 4 dupe pairs: both rows preserved. Partial UNIQUE INDEX only fires on `is_historical=FALSE`.

**`invoice_rejections`:**
- 27 rows: `is_historical=TRUE`, `data_provenance='app_scan'`. Add the 2 base columns.

**`gl_codes`:**
- 393 leaf codes from 12 per-account tabs: `is_historical=TRUE`, `data_provenance='manual_entry'`. Add the 2 base columns.
- Master Template (78 codes) + Class Overview (15 codes): SKIPPED per Q6. They are admin-reference Sheets-only; PG `gl_codes` table only mirrors operational per-account data.

### Tradeoffs

**What we give up:**
- Most app queries must add `WHERE is_historical = FALSE` to ignore historical rows. ~2-5 chars per query, minor cost.
- "Bad" pre-existing data persists in PG, tagged as historical. It never affects live queries but lives in the table.
- Schema complexity: 2 extra columns + conditional constraints on each table.

**What we gain:**
- 100% data preservation. Zero pre-migration data loss decisions to defend.
- Strict integrity for new writes (status enum, FK, UNIQUE) applies to `is_historical=FALSE` rows.
- Audit trail via `data_provenance` (where did the row originate?).
- Zero cutover risk from cleanup mistakes. We do not delete 209 rows pre-backfill and then discover one mattered.
- Future cleanup is optional and decoupled from migration. Separate decision, separate project, separate scrutiny.

### Future Cleanup Path

Deferred indefinitely. If a future project wants to clean up historical data:
1. Inspect `WHERE is_historical = TRUE` slice of each table.
2. For each slice, decide: delete / promote to current / leave.
3. Run separately from any active migration so blast radius is small.

No commitment made now to ever do this cleanup. The whole point of the preservation-first design is that we don't have to.

### Why This Pattern Will Outlive Module 6

Modules 7 (Smart Inventory) and beyond will encounter the same class of historical accumulation. The `is_historical` + `data_provenance` pattern is a reusable convention for any Sheets-to-PG migration where the source data has accumulated drift the app's strict rules wouldn't accept. Recommended for all subsequent Project 3 modules.
