# Invoice Module

> **Status:** Pre-cutover (handlers rewired, flags off). PR 6.1 shipped the schema + dormant adapters; PR 6.2 (this PR) rewires every Sheet I/O site through the dataStore orchestrators, bundles 9 cross-cutting cleanups, and switches `invoice-delete-dupe` from hard-delete to admin-gated soft-delete. Backfill + cutover in PR 6.3.

## Overview

The invoice module captures vendor invoices submitted through the People Portal and the Ops site. Each submission carries metadata (vendor, date, total), a GL breakdown (which expense codes the amount splits across), drive references to scanned pages, and an async AI line item extraction. Admins can reject submissions, correct earlier ones, mark dupe overrides, and view per-account history.

Backend: `src/lib/invoiceActions.js` (~1500 LOC post-PR-6.2, 9 exported handlers, 14 distinct action sub-routes). Frontend: `src/app/ops/components/invoice/*` plus invoice tooling in People Portal flows.

PR 6.1 shipped the dormant data layer. PR 6.2 rewired all 13 invoice-specific Sheet I/O sites through the dataStore orchestrators (vendor sub-routes were already on the orchestrator from Module 5). With cutover flags off (default), every orchestrator dispatches to its Sheets adapter so behavior remains byte-equivalent to the pre-PR-6.2 handler.

## Schema reality

4 PG tables per `docs/migrations/pr-6-1-invoice-schema.sql` (DDL applied to Supabase as part of PR 6.1).

| Table | Purpose | Sheets source |
|---|---|---|
| `invoice_submissions` | One row per submitted invoice | `COLLECTION / invoice_submissions_26` (23 cols A-W; only 15 in header but cols P-W in active use) |
| `invoice_rejections` | Rejection history per submission | Embedded in cols R-U of the same submission row |
| `ai_line_items` | AI-extracted line items per invoice | `AI_LINE_ITEMS` per-account tabs |
| `gl_codes` | Per-account chart of accounts | `GL_CODES` per-account tabs |

### Preservation-first design (`is_historical` pattern)

Per Kevin's locked decision in PR #94 (`docs/MODULE_6_DATA_AUDIT.md` Section 8). 218 row-level historical artifacts surfaced in the audit are migrated AS-IS rather than cleaned. Each of the 4 tables gets two base columns:

```sql
is_historical    BOOLEAN NOT NULL DEFAULT FALSE
data_provenance  TEXT NOT NULL DEFAULT 'app_scan'
                 CHECK (data_provenance IN ('app_scan','batch_rebuild','manual_entry','unknown'))
```

Strict integrity constraints (UNIQUE, NOT NULL FK, status enum, F24 dedup) become **conditional on `is_historical = FALSE`** via partial indexes and CHECK predicates. Backfilled rows carry `is_historical = TRUE` and bypass the strict constraints. Future app writes default `is_historical = FALSE` and get full integrity enforcement.

Additional per-table touches:

- **`invoice_submissions`**: adds `ai_scan_status TEXT` for the 4 historical AI states (`pending/complete/failed/photo-only`) + `ai_scan_complete BOOLEAN GENERATED ALWAYS AS (COALESCE(ai_scan_status, '') = 'complete') STORED` for backwards compatibility (COALESCE makes NULL `ai_scan_status` derive to FALSE, matching the old `BOOLEAN NOT NULL DEFAULT false` semantics for queries like `WHERE ai_scan_complete = FALSE`). Status CHECK is `is_historical = TRUE OR status IN ('sent','returned','corrected','deleted')`. F24 partial UNIQUE INDEX excludes historical rows.
- **`ai_line_items`**: `invoice_uuid` becomes NULLable + FK. Adds `historical_invoice_ref TEXT` for synthetic IDs like `REBUILD-204842-00-1` (138 rows from a 2026-04-03 batch re-extraction) and for original UUIDs of parent-deleted rows (71 valid-UUID orphans). UNIQUE (invoice_uuid, line_num) becomes partial on `is_historical = FALSE`. Two CHECKs enforce new rows have a real parent + historical rows have either parent or `historical_invoice_ref`.
- **`gl_codes`**: just the 2 base columns. Master Template + Class Overview tabs SKIPPED per Q6 (admin-reference Sheets-only).

### Scope parameter on reads

Per Kevin's decision #6, orchestrators do NOT default-filter by `is_historical`. Historical rows are real data and appear in invoice history, admin queues, F24 dedup checks, and reports. Callers needing a specific slice pass `opts.scope = 'all'` (default) | `'historical'` | `'current'`.

## Key invariants

- **F25 client_uuid idempotency**: every submission carries a frontend-supplied UUID. PG enforces UNIQUE on `client_uuid`. Retries of the same submit-click are no-ops via ON CONFLICT DO NOTHING.
- **F24 field-based dedup**: prevents accidental re-submission of the same invoice. PG enforces via partial UNIQUE INDEX on `(vendor_id, invoice_number_normalized, invoice_date, total_amount)` filtered to non-corrected, non-deleted, non-dupe-override rows. Historical rows bypass.
- **F19a/F19b**: vendor-side patterns (Module 5). Invoice module reads vendor data via the Module 5 orchestrators; doesn't generate vendor IDs.
- **is_historical doctrine**: never set `is_historical = TRUE` from app code. Only the backfill PR 6.3 sets it. New writes always get `FALSE` via the column default.
- **Module arg propagation (Module 5 lesson #1, PR #92)**: every read orchestrator accepts `opts.module` and forwards to `isReadFromPostgres`. PR 6.2 handlers MUST pass `module: "ops"` at every call site or `READ_FROM_POSTGRES_OPS` is a no-op.
- **`ai_scan_status` is the source of truth** for AI scan state. `ai_scan_complete` is GENERATED and read-only from app code.
- **Sheets writes are unconditional, PG writes are conditional**: orchestrators dispatch to Sheets adapter always, then `if (isDualWrite(tab))` to PG adapter. Sheets is the rollback target during the dual-write window.

## Common pitfalls

*Cutover (PR 6.3) findings to be appended here. Anticipated based on Module 5 cutover experience:*

- **Vercel env changes require no-cache redeploys** for fresh Lambda cold-starts (Module 5 lesson #2).
- **PG schema constraints surface latent Sheets data issues** (Module 5 lesson #3). For invoice the audit caught 138 REBUILD-* synthetics, 71 orphans, 4 line-num dupes, 5 typo dates - all now handled via the is_historical pattern.
- **`module: "ops"` propagation** (Module 5 lesson #1). PR 6.2 passes `module: "ops"` at every orchestrator call site in `invoiceActions.js`. Forget the opts arg and `READ_FROM_POSTGRES_OPS` silently no-ops at cutover.
- **F24 dedup keys on `vendorId`, not vendor name**. PR 6.2 swapped the legacy invoice-name match for the orchestrator-level vendor_id match (matches the PG partial UNIQUE INDEX). Frontend `invoice-duplicate-check` now sends `vendorId` alongside vendor name. A vendor without a `vendor.vendorId` (rare; orphan UI state) silently bypasses the field-based dedup; the F25 `client_uuid` retry guard still applies.
- **`invoice-delete-dupe` is a soft delete** (PR 6.2 C10). Status flips to `'deleted'`; handler-side filter in `invoice-history` + `invoice-admin-list` hides these rows to match pre-PR-6.2 hard-delete UX. Restricted to `OPS_LEADERSHIP_EMAILS` via the BR1 admin gate added in this PR.
- **AI scan line item write requires `metadata.account`**. The `'Invoice Uploads'` junk-drawer fallback was removed (PR 6.2 L1). Submissions without an account on metadata now skip the line item write with a warning rather than spraying into a fallback tab.
- **`ai_scan_status` propagation via `updateInvoiceFields`**. The Sheets path has no column for it (FIELD_TO_COL silently skips); the PG path writes `ai_scan_status` once dual-write is on. Pre-PR-6.2 `updateScanStatus` was a console-only stub - removed.

## Handler reference

`src/lib/dataStore/invoice.js` exports 11 orchestrators:

| # | Orchestrator | Tables | Purpose |
|---|---|---|---|
| 1 | `getInvoiceSubmissions(opts)` | invoice_submissions | Paginated list (history + admin-list) with optional accountKey / status / period / scope filters |
| 2 | `getInvoiceSubmissionByUuid(uuid, opts)` | invoice_submissions | Single row by client_uuid |
| 3 | `findDuplicateSubmission(input, opts)` | invoice_submissions | F24 dedup check pre-submit |
| 4 | `getInvoiceRejectionsForSubmission(submissionUuid, opts)` | invoice_rejections | Reject history; Sheets path returns 0-1 row, PG path returns 0-N |
| 5 | `getAILineItemsForInvoice(invoiceUuid, opts)` | ai_line_items | Line items for one invoice (opts.accountKey required on Sheets path) |
| 6 | `getGLCodes(opts)` | gl_codes | Active+purchasing per-account list |
| 7 | `upsertInvoiceSubmission(input)` | invoice_submissions | Insert with F25 idempotency |
| 8 | `updateInvoiceFields(uuid, fields, opts)` | invoice_submissions | Generalized partial update (status, emailSent, aiScanStatus, etc.) |
| 9 | `insertInvoiceRejection(input)` | invoice_rejections | Sheets path writes cols R-U + col N=returned; PG path inserts |
| 10 | `unrejectInvoice(submissionUuid, by, opts)` | invoice_rejections | Sheets path reverts col N=sent + clears R-U; PG path updates most-recent row |
| 11 | `insertAILineItems(invoiceUuid, lineItems[], opts)` | ai_line_items | Bulk insert post-AI-scan |

### PR 6.2 handler rewire map

All 13 invoice-specific Sheet I/O sites now route through the orchestrators above. `module: "ops"` is passed at every call site so `READ_FROM_POSTGRES_OPS` works end-to-end. `invoice-photo-gate`, `invoice-ocr`, and `invoice-consistency-check` are AI-only and have no Sheet I/O (untouched).

| Sub-route | Pre-PR-6.2 Sheet ops | Orchestrator call |
|---|---|---|
| `invoice-bootstrap` (GET) | `readSheetSA(GL_CODES, tab) → parseGLCodes`, `safeRead(invoice_submissions_26)` | `getGLCodes({accountKey, module})` + `regroupGLCodes` (C5), `getInvoiceSubmissions({accountKey, pageSize:200, scope:"all", module})` |
| `invoice-history` (GET) | `safeRead(invoice_submissions_26) + parseSubmissionRow` | `getInvoiceSubmissions({accountKey, pageSize:200, scope:"all", module})` + soft-delete filter |
| `invoice-admin-list` (GET) | `safeRead + parseSubmissionRow` | `getInvoiceSubmissions({period, pageSize:5000, scope:"all", module})` + soft-delete filter |
| `invoice-submit` GL enrich | `readSheetSA(GL_CODES) → parseGLCodes` | `getGLCodes({accountKey, module})` |
| `invoice-submit` F25/F24 pre-check | `readSheetSA + inline normalizeInv` | `getInvoiceSubmissionByUuid` + `findDuplicateSubmission` (orphan-PDF guard) |
| `invoice-submit` row write | `appendRowSA` | `upsertInvoiceSubmission` (returns `{submission, deduplicated}` race-guard) |
| `invoice-submit` correction mark | `findRowByValueSA + updateRangeSA(N:O)` | `updateInvoiceFields(correctedFromUuid, {status, statusUpdatedAt})` |
| `invoice-submit` email-sent flag | `findRowByValueSA + updateCellSA(M)` | `updateInvoiceFields(uuid, {emailSent:true})` |
| `invoice-duplicate-check` | `safeRead + inline match by vendor name` | `findDuplicateSubmission({vendorId, ...})` (frontend now sends `vendorId`) |
| `invoice-reject` | `findRowByValueSA + safeRead + batchUpdateRangesSA(N:O,R:U)` | `getInvoiceSubmissionByUuid` + `insertInvoiceRejection` |
| `invoice-unreject` | `findRowByValueSA + safeRead + batchUpdateRangesSA` | `getInvoiceSubmissionByUuid` + `unrejectInvoice` |
| `invoice-dismiss-dupe` | `findRowByValueSA + updateCellSA(W)` | `updateInvoiceFields(uuid, {dupeOverride:"not_duplicate"})` |
| `invoice-delete-dupe` | `findRowByValueSA + getSheetIdSA + deleteRowSA` (hard delete) | `updateInvoiceFields(uuid, {status:"deleted", statusUpdatedAt})` (BR1 admin gate + C10 soft delete) |
| `triggerAIScan` line item write | `ensureLineItemTab + appendRowsSA + "Invoice Uploads" fallback` | `insertAILineItems(uuid, lineItems, {accountKey, module})`; fallback dropped (L1) |
| `triggerAIScan` scan status | `updateScanStatus` (console-only stub) | `updateInvoiceFields(uuid, {aiScanStatus})` (S4) |

### PR 6.2 cleanups bundled

- **BR1**: `invoice-delete-dupe` admin gate via `OPS_LEADERSHIP_EMAILS`.
- **S1**: removed GL helpers (`parseGLCodes`, `GL_TAB_MAP`, `getGLTabName`, `EXCLUDED_CATEGORIES`, `SECTION_MARKERS`, `EXCLUDED_ITEMS`, `flattenGLCodes`) from `invoiceActions.js`. GL categorization now happens in the orchestrator + `regroupGLCodes` at the handler boundary (C5).
- **S2**: removed `parseSubmissionRow`; canonical-to-legacy translation lives in `toLegacySubmission` at the top of `invoiceActions.js`.
- **S3**: removed local `normalizeInvNum` helpers in two sites; `findDuplicateSubmission` owns normalization.
- **S4**: removed `updateScanStatus` no-op stub; replaced with `markScanStatus` that calls `updateInvoiceFields({aiScanStatus})`.
- **D1**: moved `ensureLineItemTab` + `LINE_ITEM_HEADERS` from `invoiceActions.js` into `src/lib/dataStore/invoice.js` as a Sheets-adapter internal.
- **L1**: dropped the `"Invoice Uploads"` fallback tab path in `triggerAIScan`. Missing `metadata.account` now logs and skips rather than writing to a junk drawer.
- **L2**: pruned `LINE_ITEM_HEADERS` from `invoiceActions.js` (moved with D1).
- **L3**: pruned unused Sheets imports (`readSheetSA, appendRowSA, appendRowsSA, findRowByValueSA, updateCellSA, updateRangeSA, batchUpdateRangesSA, deleteRowSA, getSheetIdSA, createTabSA, safeRead, SHEET_IDS`) from `invoiceActions.js`.

## Cross-module dependencies

- **Reads from vendor module** via `getVendorsForBootstrap`, `searchVendors`, `getVendorsForMatching`. Vendor module is LIVE on PG as of 2026-05-29.
- **OCR uses `fuzzyMatchVendor`** from `src/lib/vendorMatching.js`.
- **Reads `gl_codes`** for the GL breakdown UI + the invoice-submit GL enrichment step.
- **Writes to `ai_line_items`** via the async `triggerAIScan` post-submit handler.
- **Drive integration** (`src/lib/drive.js`) for invoice page uploads + stamped PDF storage.
- **Email integration** (`src/lib/gmail.js`) for invoice notification to AP at submit time.

Post-Module-7 (Smart Inventory), there will also be a cron worker that reads `ai_line_items` for inventory reconciliation (cross-repo coordination).

## Cutover history

- **PR 6.1** (2026-05-29): PG schema + dormant adapters. 4 tables + 11 orchestrators. Build + lint clean. Verification script 9 checks PASSED. No production behavior change.
- **PR 6.2** (this PR, 2026-05-29): handler rewire across 13 invoice Sheet I/O sites + 9 cross-cutting cleanups (BR1, S1-S4, D1, L1-L3). Orchestrators now own dedup signal (`upsertInvoiceSubmission` returns `{submission, deduplicated}` per locked decision C6). `ensureLineItemTab` moved to dataStore as Sheets-adapter internal (C4). `invoice-delete-dupe` switched from hard delete to admin-gated soft delete (BR1 + C10). `module: "ops"` passed at every orchestrator call site. Build + lint clean. Behavior byte-equivalent to PR 6.1 with cutover flags off.
- PR 6.3 (planned): backfill 590 submissions / 27 rejections / 5438 line items / 393 leaf GL codes. All marked `is_historical = TRUE` with provenance tags per audit Section 8 mapping logic. Then flip `DUAL_WRITE_INVOICE_SUBMISSIONS` + sibling flags on; two-week dual-write window; then `READ_FROM_POSTGRES_OPS = invoice_submissions,...`.

## See also

- `docs/MODULE_6_DATA_AUDIT.md` - audit findings + locked architecture decisions
- `docs/FINANCE_STACK_PLAN.md` Section 2.2 - PG schema specifications
- `docs/migrations/pr-6-1-invoice-schema.sql` - DDL file
- `scripts/verify-pr-6-1-invoice-schema.mjs` - schema verification script
- `docs/architecture/IS_HISTORICAL_PATTERN.md` - preservation-first design doctrine *(TBD post-Module-6)*
