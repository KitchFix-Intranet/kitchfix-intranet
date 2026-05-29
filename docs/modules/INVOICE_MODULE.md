# Invoice Module

> **Status:** Pre-cutover. Schema + dormant adapters shipping in PR 6.1 (this PR). Handler rewire in PR 6.2. Backfill + cutover in PR 6.3.

## Overview

The invoice module captures vendor invoices submitted through the People Portal and the Ops site. Each submission carries metadata (vendor, date, total), a GL breakdown (which expense codes the amount splits across), drive references to scanned pages, and an async AI line item extraction. Admins can reject submissions, correct earlier ones, mark dupe overrides, and view per-account history.

Backend: `src/lib/invoiceActions.js` (1689 LOC, 9 exported handlers, 18 distinct action sub-routes). Frontend: `src/app/ops/components/invoice/*` plus invoice tooling in People Portal flows.

PR 6.1 ships the dormant data layer. With cutover flags off (default), the existing handlers continue to read/write Sheets directly.

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

*Discovered during cutover. To be populated post-PR 6.3.*

Anticipated based on Module 5 cutover experience:
- **Vercel env changes require no-cache redeploys** for fresh Lambda cold-starts (Module 5 lesson #2).
- **PG schema constraints surface latent Sheets data issues** (Module 5 lesson #3). For invoice the audit caught 138 REBUILD-* synthetics, 71 orphans, 4 line-num dupes, 5 typo dates - all now handled via the is_historical pattern.

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

Handler call sites in `invoiceActions.js` to be rewired in PR 6.2: ~22 across 12 invoice-specific action sub-routes (invoice-bootstrap, invoice-history, invoice-admin-list, invoice-submit, invoice-duplicate-check, invoice-reject, invoice-unreject, invoice-dismiss-dupe, invoice-delete-dupe, invoice-ocr, invoice-photo-gate, invoice-consistency-check). Vendor sub-routes (`vendor-search`, `vendor-add`, vendor admin) are already migrated via Module 5.

## Cross-module dependencies

- **Reads from vendor module** via `getVendorsForBootstrap`, `searchVendors`, `getVendorsForMatching`. Vendor module is LIVE on PG as of 2026-05-29.
- **OCR uses `fuzzyMatchVendor`** from `src/lib/vendorMatching.js`.
- **Reads `gl_codes`** for the GL breakdown UI + the invoice-submit GL enrichment step.
- **Writes to `ai_line_items`** via the async `triggerAIScan` post-submit handler.
- **Drive integration** (`src/lib/drive.js`) for invoice page uploads + stamped PDF storage.
- **Email integration** (`src/lib/gmail.js`) for invoice notification to AP at submit time.

Post-Module-7 (Smart Inventory), there will also be a cron worker that reads `ai_line_items` for inventory reconciliation (cross-repo coordination).

## Cutover history

- **PR 6.1** (this PR, 2026-05-29): PG schema + dormant adapters. 4 tables + 11 orchestrators. Build + lint clean. Verification script 9 checks PASSED. No production behavior change.
- PR 6.2 (planned): handler rewire across 12 action sub-routes + ~22 Sheet I/O sites. Remove "Invoice Uploads" fallback in `triggerAIScan`. Add `module: "ops"` at every orchestrator call site.
- PR 6.3 (planned): backfill 590 submissions / 27 rejections / 5438 line items / 393 leaf GL codes. All marked `is_historical = TRUE` with provenance tags per audit Section 8 mapping logic.

## See also

- `docs/MODULE_6_DATA_AUDIT.md` - audit findings + locked architecture decisions
- `docs/FINANCE_STACK_PLAN.md` Section 2.2 - PG schema specifications
- `docs/migrations/pr-6-1-invoice-schema.sql` - DDL file
- `scripts/verify-pr-6-1-invoice-schema.mjs` - schema verification script
- `docs/architecture/IS_HISTORICAL_PATTERN.md` - preservation-first design doctrine *(TBD post-Module-6)*
