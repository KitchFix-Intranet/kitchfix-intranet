# Finance Stack Migration: Code Audit

**Generated:** 2026-05-28
**Scope:** Vendor + Invoice Capture + Smart Inventory + AI_LINE_ITEMS + Railway cron + shared infrastructure
**Status:** Reference document for Project 3 (finance stack migration) planning artifact
**Reference briefs:** BRIEF_THREESYSTEMS.md, BRIEF_VENDOR_WIDGET.md, BRIEF_INVOICE_CAPTURE.md, BRIEF_SMART_INVENTORY.md (provided in chat)

---

## 1. Overview

### Scope statement

**IN SCOPE:**
- Vendor system: `vendor_master`, `vendor_accounts` tables + 9 code files (invoiceActions.js vendor section, all vendors/* components, VendorSetup.js, opsUtils.js)
- Invoice Capture: `invoice_submissions_26` + 6 code files (invoiceActions.js invoice section, stampInvoice.js, drive.js, gmail.js, all invoice/* components)
- Smart Inventory: `item_catalog`, `storage_locations`, `count_sessions`, `count_items`, `item_aliases`, `price_history`, `merge_history`, `review_queue` + 7 code files (inventoryActions.js + inventory-manager/* components)
- Shared infrastructure: `sheets.js`, `dataStore.js`, `cutover.js`, `opsUtils.js`
- Companion sheets: `GL_CODES` (1Gs7ToEvrsraBt81DctgwImKK-ck2Ch6V2ifvF8VndeY), `AI_LINE_ITEMS` (18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo)
- Cron: `kitchfix-inventory-cron/index.js`

**NOT IN SCOPE:**
- People Portal modules (already migrated: submissions, dashboard, directory)
- Drafts, notification_log multi-writer (deferred)
- Service Calendar (deferred indefinitely)
- Performance / GL_CODES (the older flat GL_CODES tab on HUB, the per-account GL_CODES spreadsheet is in scope)
- HUB.vendors (4 rows, suspected orphan; out of scope unless found referenced)

### Methodology

For each file in scope:
1. Read end-to-end (or targeted reads for the largest files - InvoiceTool.js 1732 LOC, invoiceActions.js 1918, dataStore.js 1994, inventoryActions.js 1216, CountSheet.js 1008)
2. Note Sheets reads, writes, AI calls, external integrations, cross-file dependencies
3. Compare to the four briefs (THREESYSTEMS, VENDOR_WIDGET, INVOICE_CAPTURE, SMART_INVENTORY)
4. Note undocumented behaviors and drift
5. Capture migration considerations and risk surface

Companion sheets read live for header + sample row verification (column-position confirmation against briefs).

### Top-line findings

The 5 most important findings, in priority order for the planning artifact:

1. **`opsUtils.getAllVendors` and `resolveVendorId` have positional-index drift (DRIFT H1, H2).** `getAllVendors` returns `shortName: r[2]` but col 2 is `category`, and the `active: r[3] !== "FALSE"` check is on `website` column (not `active` - which doesn't exist on vendor_master). The functions are imported by inventoryActions.js. **Inventory bootstrap may be returning wrong/inconsistent vendor data today.** Fix is one-line per function but must be made carefully (which behavior was intended).

2. **`zone_corrections` tab written by `handleReviewAccept` but NOT documented in any brief.** Inventory's PG schema design is incomplete without this table - schema must be captured before design phase.

3. **Multiple sources of truth for shared logic (5-7 vendor matchers, 5 CATEGORIES lists, 4 CATEGORY_COLORS maps, 2 accountMatch implementations).** Maintenance burden today; opportunity to consolidate during migration OR defer to cleanup PRs. Scope decision needed before planning.

4. **`handleVendorMerge` has NO server-side admin gate (DRIFT H5).** Brief flags as P2. Any authenticated user can theoretically call the merge endpoint via direct API call. Fix is a one-line `OPS_LEADERSHIP_EMAILS.includes(email)` check.

5. **Cron + intranet share 5 INVENTORY tables (item_catalog, item_aliases, price_history, review_queue, merge_history) with one-way coupling (intranet writes exclude markers, cron reads them).** Migration phasing matters - cron is in a separate repo with its own deploy cycle. Cutover sequence requires intranet dual-write enabled BEFORE cron PR, then read-flip + cron read-swap last.

### Subsection ordering note

Section 2's subsections appear in reverse-physical order due to incremental write pattern (2E. Railway cron appears first, 2A. Shared infrastructure appears last). Content is correct; physical ordering is a polish item to fix in a follow-up.

---

## 2. Per-file audit

### 2E. Railway cron (kitchfix-inventory-cron/index.js)

**Lines:** 720
**Purpose:** Nightly AI catalog reconciliation. Reads new AI_LINE_ITEMS rows per account, matches against item_catalog via Claude, auto-approves >=90% confidence matches (writes item_catalog + item_aliases + price_history) or queues lower confidence (writes review_queue). Posts Slack digest.
**Reads:**
  - `readTab(AI_LINE_ITEMS, accountTab)` per account tab.
  - `readTab(INVENTORY, "item_catalog")` per account.
  - `readTab(INVENTORY, "item_aliases")` per account.
  - `readTab(INVENTORY, "price_history")` per account (idempotency check).
  - `readTab(INVENTORY, "merge_history")` per account (excluded items filter).
  - `readTab(INVENTORY, "review_queue")` for Slack digest counts.
  - `getTabNames(AI_LINE_ITEMS_SHEET_ID)` for account discovery.
**Writes:**
  - `appendRows(INVENTORY, "item_catalog!A1", rows)` - new items (linkedToInvoice=TRUE).
  - `appendRows(INVENTORY, "item_aliases!A1", rows)` - new aliases.
  - `appendRows(INVENTORY, "price_history!A1", rows)` - new price rows (with invoiceUuid as idempotency key).
  - `appendRows(INVENTORY, "review_queue!A1", rows)` - low-confidence rows.
  - `updateRange(INVENTORY, "item_catalog!L{r}", "FALSE")` - dedup-mode deactivation (gated by DEDUP=1 env).
  - `updateRange(INVENTORY, "item_aliases!C{r}", keeperId)` - dedup-mode alias remap.
  - `updateRange(INVENTORY, "price_history!A{r}", keeperId)` - dedup-mode price remap.
**AI calls:**
  - `callClaude(prompt, maxTokens=8192)` via `fetch("https://api.anthropic.com/v1/messages")` - line 123. Model `claude-sonnet-4-20250514`. One call per account per run with batches of 50 items.
**External calls:**
  - Anthropic Claude API.
  - Slack webhook `SLACK_RECAP_WEBHOOK`.
  - No HTTP coupling to intranet.
  - No shared modules with intranet (zero code dependency between cron and main repo).
**Cross-file dependencies:**
  - Imports: `googleapis` (and uses `google.auth.GoogleAuth` + `google.sheets` directly).
  - NOT imported by anything (standalone Node script).
**Brief alignment:**
  - AGREES with SMART_INVENTORY brief Section "How invoice data gets into the system" Step 3 + "How the count flow uses the catalog and prices" + future Stage 2 loop description.
  - **DRIFT (MEDIUM):** brief THREESYSTEMS Section 1 lists `dedupExistingCatalog` as part of the cron. Verified - lives at line 582 of cron index.js, gated by `DEDUP=1` env. Cron-side dedup is functional but manual (Kevin sets DEDUP=1 and runs).
  - **DRIFT (LOW):** SMART_INVENTORY brief says cron "Roughly 3,800 line items across approximately 2 months of operations as of mid-May 2026" - data volume estimate, not code.
**Undocumented behaviors:**
  - Tab filter skips: "Invoice Uploads" (catch-all), "Sheet1", "_metadata", and anything starting with "_" (line 689). Account discovery is everything else.
  - Excluded items per account: reads `merge_history` filtered by action="exclude" + accountMatch (line 295). Builds Set of names to never auto-add even if a new invoice line item arrives.
  - `MATCH_CONFIDENCE_THRESHOLD` defaults to 90 but is env-configurable.
  - 50-item batches with 2-second delays between batches (Claude rate limit accommodation).
  - 1-second delay between accounts.
  - Slack digest only fires if any account had `processed > 0` OR if it's Monday (catalog health digest always posts on Monday per line 535).
  - Idempotency: `processedInvoices = new Set(priceHistoryRows.map(...))` - all UUIDs already in price_history are skipped. First-run = process all (backfill). Subsequent runs = incremental.
  - `dedupExistingCatalog` (line 582) is a SEPARATE one-shot mode - not part of nightly flow. Gated by `DEDUP=1` env var. Has its own `DEDUP_DRY_RUN` env (defaults to true).
  - `HUB_SHEET_ID` env var declared at line 27 but **NOT USED anywhere else in the file**. Dead config.
  - v1.2 header (lines 12-19) lists fixes from production fires:
    - appendRows uses explicit "tab!A1" range (prevents offset column writes)
    - Account matching uses startsWith (handles short vs full account labels)
    - Excluded items check via merge_history (prevents re-importing excluded items)
    - active column filter handles both boolean false and string "FALSE"
    - readTab skips blank/description rows (rows 2-3)
**Migration considerations:**
  - Cron data layer: 4 helpers (`readTab`, `appendRows`, `updateRange`, `getTabNames`). PG migration changes these 4 functions to hit Supabase instead of Sheets.
  - Cron is in a SEPARATE repo - changing it requires a separate deploy.
  - Cron migration phasing (per Project 3 recon):
    1. Intranet-side dual-write enabled.
    2. Backfill PG tables.
    3. Cron PR: helpers dual-write (Sheets + PG).
    4. Cron deploy and verify dual-write for one full run.
    5. Intranet flag flip (READ_FROM_POSTGRES).
    6. Cron PR (final): PG-only reads + writes.
  - Cutover coordination: cron fires at 6am UTC. Flip flags during the 23-hour idle window (NOT around the fire time).
  - `accountMatch` cron-side duplicates the intranet `accountMatch` in inventoryActions.js. Two implementations of the same rule. PG migration normalizes account_key format to remove the need for both.
  - `getTabNames` for account discovery becomes `SELECT DISTINCT account_key FROM ai_line_items`.
  - Idempotency: `invoiceUuid` filter against `price_history` becomes PG UNIQUE constraint on `(item_id, source_or_invoice_id)`.
  - `dedupExistingCatalog` (the cron-side dedup mode) - decide whether to migrate the manual one-shot or accept that it becomes obsolete once PG constraints prevent duplicates from forming in the first place.
**Risk surface:**
  - Cron + intranet have IDENTICAL `accountMatch` rules duplicated in two repos. Drift risk if one changes.
  - 6am UTC fire window means cutover coordination matters. Bad-state windows possible.
  - No retry mid-account on failure. Failure of one account's writes is permanent until the next nightly run (idempotency saves but data lags).
  - No transactions: multi-table append (item_catalog + item_aliases + price_history) is 3 separate API calls. Partial failure means inconsistent state until next run picks it up.
  - Tab name filter (`_metadata`, `_` prefix) could exclude legitimate accounts if naming convention drifts.

---

### 2D. Smart Inventory

### src/lib/inventoryActions.js

**Lines:** 1216
**Purpose:** Backend handlers for all Smart Inventory actions. 30+ exported handlers covering bootstrap, count flow (start/save/submit), catalog mutations, location/zone management, AI similarity check, merges, archive/exclude/reactivate.
**Reads:**
  - `batchRead(INVENTORY, [item_catalog, storage_locations, count_sessions, count_items, review_queue, price_history, item_aliases])` - bootstrap.
  - `cachedRead(INVENTORY, "item_catalog")`, etc. - via opsUtils cache (60s TTL).
  - `getAccountConfigs()`, `getPeriods()`, `getCurrentPeriod()` - from opsUtils.
  - `getAllVendors()`, `resolveVendorId()` - from opsUtils (DRIFT - see 2A).
**Writes:**
  - `appendRowSA(INVENTORY, "count_sessions", ...)` - new session.
  - `appendRowsSA(INVENTORY, "count_items", rows)` - per-zone count save (one row per item).
  - `batchUpdateRangesSA(INVENTORY, ...)` - count-submit category totals (chunked at 500 per call), price snapshots on item_catalog.K (priceAtLastCount).
  - `appendRowSA(INVENTORY, "item_catalog", ...)` - add item; also writes `price_history` row if price > 0.
  - `updateRangeSA(INVENTORY, "item_catalog!H{r}:J{r}", ...)` - verify-price (cols H/I/J = price, priceDate, priceVendor) + col S (lastVerified).
  - `batchUpdateRangesSA(INVENTORY, ...)` - batch-move-items (locationId updates).
  - `updateRangeSA(INVENTORY, "item_catalog!{cols}{r}", ...)` - merge keeper update (cols C/D/E).
  - `updateRangeSA(INVENTORY, "item_catalog!L{r}", "FALSE")` - merge deactivate dupes (col L = active).
  - `appendRowSA(INVENTORY, "item_aliases", ...)` - alias on merge.
  - `batchUpdateRangesSA(INVENTORY, ...)` - alias remap + price_history remap on merge (rewrite col C / col A to keeper itemId).
  - `appendRowSA(INVENTORY, "merge_history", ...)` - merge audit row (action="merge" | "keep_separate" | "exclude").
  - `updateRangeSA(INVENTORY, "item_catalog!{various}", ...)` - archive/exclude/reactivate (col L active, col Q status).
  - `appendRowSA(INVENTORY, "zone_corrections", ...)` - new tab not in brief, used in review-accept (line 746).
  - Location writes: bulk save via batchUpdateRangesSA, single update via updateRangeSA, soft-delete via active=FALSE.
**AI calls:**
  - `callClaude(prompt, maxTokens=8192, retries=3)` - generic Claude wrapper (line 446). Used by `ai-similarity-check` (handleAISimilarityCheck) and `dedup-existing-catalog` (handleDedupCatalog, gated by env). Model: `claude-sonnet-4-20250514`. Retry with exponential backoff.
**External calls:** none direct (cron is a separate repo).
**Cross-file dependencies:**
  - Imports: sheets.js helpers, opsUtils.js helpers including the buggy `getAllVendors`/`resolveVendorId`.
  - Called by: src/app/api/ops/route.js dispatcher.
**Brief alignment:** Strongly AGREES with SMART_INVENTORY brief and THREESYSTEMS brief Section 1.
  - **DRIFT (HIGH):** brief THREESYSTEMS Section 1 lists `dedupExistingCatalog` as a separate-cron-mode feature. The same logic is ALSO in inventoryActions.js as `handleDedupCatalog` (line 1069) - this is the IN-APP version run via `/api/ops?action=dedup-catalog`. Brief mentions only the cron-side. Two implementations of dedup exist.
  - **DRIFT (MEDIUM):** SMART_INVENTORY brief mentions `handleScan`, `handleHistoryGet`, `handleReviewQueueGet`, `handleAdminCorrect`, `handlePrint`, `handleResolveQueue`, `handleUpdateItem` as STUBS (returns "Week 3" / "Week 4"). Confirmed at lines 398, 817, 1059-1062, 1154. All 7 are placeholder stubs. Brief Section "What it does NOT do today" mentions some but not all.
**Undocumented behaviors:**
  - `accountMatch` (line 14): handles short vs full account label mismatch. Same pattern as the cron's `accountMatch`. Two implementations of the same rule (cron + intranet) - drift risk.
  - **NEW TAB NOT IN BRIEF: `zone_corrections`** at line 746 (in `handleReviewAccept`). Per-correction audit row. Brief Section 3 / schema reference does NOT mention this tab.
  - Cache invalidation calls (`invalidateCache`) sprinkled after every write. 30+ invalidate calls across handlers. If any are missed, stale reads possible.
  - `handleCountSubmit` chunks price updates at 500 per `batchUpdateRangesSA` call to stay under Sheets API request size limit.
  - `merge_history` is written by multiple action types: action="merge" (handleMergeItems), action="keep_separate" (handleKeepSeparate), action="exclude" (handleExcludeItem).
  - `handleExcludeItem` (line 792) writes `merge_history!A:A` with explicit !A:A range (line 803) - special case of the bare-tab-name auto-add pattern.
**Migration considerations:**
  - 8 PG tables: `item_catalog`, `storage_locations`, `count_sessions`, `count_items`, `item_aliases`, `price_history`, `merge_history`, `review_queue` + `zone_corrections` (new from audit).
  - Per SMART_INVENTORY brief: lift-and-shift, not redesign. Schema mirrors Sheets columns; Kevin continues building post-migration.
  - Cache layer (`cachedRead`, `batchRead`, `invalidateCache` from opsUtils) gets dropped post-PG cutover.
  - `accountMatch` tolerance becomes unnecessary if PG enforces single account_key format (canonical = spaces "CIN - OH").
  - `count_items` is append-only with replay semantics (latest locationSaveId wins) - preserve as PG audit log.
  - `extendedPrice` on count_items can become PG GENERATED column (qty * priceAtCount).
  - The 7 stub handlers don't need migration; they remain stubs (or get implemented post-migration).
  - `merge_history.mergedItemIds` is a JSON-stringified array - becomes JSONB.
**Risk surface:**
  - 30+ invalidateCache calls: missing one creates stale-data bugs. Migration removes this entire class of risk.
  - 6 different tables can be written in a single user action (count-submit, merge-items). Atomicity concerns.
  - `zone_corrections` tab not in brief - schema design risk.
  - Bootstrap reads 7 tabs in parallel - large I/O. PG migration consolidates to fewer queries.
  - `getAllVendors`/`resolveVendorId` drift from opsUtils flows into inventory bootstrap - `primaryVendor` field on catalog items is freeform string, not FK to vendor_master.

### src/app/ops/components/inventory-manager/InventoryManager.js

**Lines:** 364
**Purpose:** Shell component. Account selector, sub-tool nav. Dispatches actions for all child components via callbacks. Handles 16+ action dispatches.
**Reads:** `inventory-bootstrap` on mount (returns the full payload).
**Writes:** All inventory POST actions dispatched here (see component grep results).
**Brief alignment:** AGREES with brief.
**Migration considerations:** UI doesn't change; backend dispatches go through dataStore.js.
**Risk surface:** Single orchestrator means many concerns in one component.

### src/app/ops/components/inventory-manager/CountSheet.js

**Lines:** 1008
**Purpose:** Count flow UI + state machine (v5.1 Warm Precision). Focus card, Apply Last shortcut, variance warning, none-on-hand flag, category grouping, counted drawer, sticky footer, zone-complete celebration, confirm-to-next flow.
**Reads:** Receives bootstrap data via props. No direct fetches.
**Writes:** None directly - emits onSaveCount, onSubmit, etc. callbacks to InventoryManager.
**Brief alignment:** AGREES with SMART_INVENTORY brief "Widget logic worth knowing".
**Undocumented behaviors:**
  - Local React state for in-progress counts (autosave gap noted in brief). Writes only on zone transitions or submit.
  - 420ms confirm flash, 240ms card activation, 180ms variance grow-in, 450ms checkmark draw (motion vocabulary).
  - iOS Safari soft-keyboard programmatic focus issue noted in brief - "tested workaround is unresolved".
**Migration considerations:** No data layer changes.
**Risk surface:** Autosave gap means in-progress counts can be lost on browser crash before zone transition.

### src/app/ops/components/inventory-manager/ItemCatalog.js

**Lines:** 323
**Purpose:** Catalog browser. Add/edit/archive items.
**Reads:** Receives catalog data from bootstrap.
**Writes:** Emits add-item, update-catalog-item, archive-item, verify-price callbacks.
**Brief alignment:** AGREES.
**Migration considerations:** UI no change.

### src/app/ops/components/inventory-manager/ItemReview.js

**Lines:** 530
**Purpose:** AI similarity review queue. Merge / keep-separate UI for AI-suggested groups.
**Reads:** Calls `ai-similarity-check` action on Run Scan.
**Writes:** Calls `merge-items`, `keep-separate`, `review-accept`.
**Brief alignment:** AGREES with SMART_INVENTORY brief.
**Migration considerations:** Backend actions migrate; UI no change.

### src/app/ops/components/inventory-manager/LocationSetup.js

**Lines:** 466
**Purpose:** Zone hierarchy editor. Sort order via drag-reorder. Sub-zones.
**Reads:** Bootstrap data via props.
**Writes:** Emits save-locations, save-sort-order, add-sub-zone, update-location, deactivate-location callbacks.
**Brief alignment:** AGREES.

### src/app/ops/components/inventory-manager/ProductPlacement.js

**Lines:** 609
**Purpose:** Drag-and-drop item-to-zone assignment. Bulk locationId updates.
**Reads:** Bootstrap data via props.
**Writes:** Emits batch-move-items callback (bulk locationId update in one `batchUpdateRangesSA`).
**Brief alignment:** AGREES.

---

### 2C. Invoice Capture

### src/lib/invoiceActions.js (invoice section, lines 1-1520)

**Lines:** ~1520 of 1918 (invoice section ~79% of file).
**Purpose:** Backend for all invoice and AI handlers. Houses GL parsing, line-item AI extraction, OCR engine, photo gate, consistency check, all submission/admin actions, AI_LINE_ITEMS lazy tab creation. Vendor handlers also live in this file (lines 1523-1919, audited in 2B above).
**Reads:**
  - `safeRead(HUB, "vendor_master")`, `safeRead(HUB, "vendor_accounts")` - bootstrap + OCR vendor match.
  - `safeRead(GL_CODES, getGLTabName(account))` - GL enrichment on submit + bootstrap.
  - `safeRead(COLLECTION, "invoice_submissions_26")` - history, admin list, dupe check.
  - `readSheetSA(AI_LINE_ITEMS, accountTab)` via ensureLineItemTab logic.
**Writes:**
  - `appendRowSA(COLLECTION, "invoice_submissions_26", row)` - submission row (23 cols).
  - `updateRangeSA(COLLECTION, "invoice_submissions_26!N{r}:O{r}", ...)` - status flips (sent/returned/corrected).
  - `updateCellSA(COLLECTION, "invoice_submissions_26!M{r}", "TRUE")` - emailSent flag.
  - `updateRangeSA(COLLECTION, "invoice_submissions_26!R{r}:U{r}", ...)` - rejection metadata (reason, note, by, at).
  - `updateCellSA(COLLECTION, "invoice_submissions_26!W{r}", "not_duplicate")` - dupe override.
  - `deleteRowSA(COLLECTION, sheetId, row)` - admin delete via batchUpdate deleteDimension.
  - `appendRowsSA(AI_LINE_ITEMS, accountTab, rows)` - line item extraction results (async, non-blocking).
  - `createTabSA(AI_LINE_ITEMS, accountTab)` + `appendRowSA(AI_LINE_ITEMS, accountTab, LINE_ITEM_HEADERS)` - lazy per-account tab creation.
  - Vendor writes also live here (see 2B).
**AI calls:** Three to four Claude API calls (model `claude-sonnet-4-20250514`):
  1. `invoice-photo-gate` (~line 745 area): per-page document type + quality + page number detection. max_tokens 300.
  2. `invoice-ocr` (~line 600 area): per-page header extraction (vendor, invoice#, date, total). max_tokens 500. Calls `fuzzyMatchVendor` against vendor_master to suggest a vendor.
  3. `invoice-consistency-check` (~line 770 area): multi-page rogue detection. Up to 6 page images. max_tokens 300.
  4. `triggerAIScan` (line 1360): async post-submit line item extraction. max_tokens 8192. Writes to AI_LINE_ITEMS per-account tab.
**External calls:**
  - Drive uploads via drive.js (`uploadStampedPDF`, `uploadInvoicePages` fallback) - service account.
  - Gmail via gmail.js (`sendInvoiceEmail` to AP, `sendRejectionEmail` to operator on rejection) - user OAuth.
  - Slack webhooks: `SLACK_INVOICE_WEBHOOK` (#invoice-submissions), `SLACK_VENDOR_WEBHOOK` (#vendors).
**Cross-file dependencies:**
  - Imports: sheets.js helpers (12 SA helpers + SHEET_IDS), drive.js (`uploadInvoicePages`, `uploadStampedPDF`), gmail.js (`sendInvoiceEmail`, `sendRejectionEmail`), stampInvoice.js (`createStampedInvoicePDF`, `createRawInvoicePDF`), admin.js (`OPS_LEADERSHIP_EMAILS`).
  - Called by: src/app/api/ops/route.js (dispatcher).
**Brief alignment:** Strongly AGREES with INVOICE_CAPTURE brief and VENDOR_WIDGET brief.
  - **DRIFT (MEDIUM):** VENDOR_WIDGET brief Section 12 P2 claims "fuzzyMatchVendor does NOT search aliases" - **WRONG**. Code at lines 199-214 explicitly checks aliases first with score weights 100/90/85. Brief drift to be corrected (the function DOES search aliases).
**Undocumented behaviors:**
  - `GL_TAB_MAP` (lines 99-114) has DOUBLE entries for TXR-HOME/TXR-VISTOR: both the short label and the full account key (`TXR - TX - H` / `TXR - TX - V`) map to the same tab. Defensive against account-key format inconsistencies.
  - `getGLTabName` (line 149-157) falls back to shortKey lookup if full key not in map; returns null if both fail. Silent failure - the caller logs at line 998 as "non-blocking".
  - `buildPdfFilename` (line 159-164): `${vendorClean}{invNum}_${dateStr}.pdf` - vendor first, then invoiceNumber, then date. Different from INVOICE_CAPTURE brief Section 9 example which shows `Fortune_Fish_2026-01-15_350118.pdf` (vendor_date_invoice). Verify which is right.
  - `LINE_ITEM_HEADERS` (line 117-121): 15 columns. Matches INVOICE_CAPTURE brief Section 3 AI_LINE_ITEMS schema.
  - Idempotency keys are server-generated if client doesn't send `body.uuid`. Falls back to `crypto.randomUUID()`. Allows legacy clients.
  - vendor-add F19a retry loop: 5 attempts max, fails with explicit error message if all collide. Prefix is first-3-letters-uppercase-of-vendor-name, non-letters replaced with X.
  - Vendor-add rowId format: `${vendorId}_${account.split(" - ").slice(0, 2).join("-")}` - account becomes hyphen-joined (e.g., `STL-FL` not `STL - FL`). Different from sheets where account is stored with spaces.
**Migration considerations:**
  - The 14 actions (10 POST + 4 GET) need dataStore.js orchestrators.
  - `parseSubmissionRow` (lines 257-283) is the canonical row shape - reusable for the PG read path.
  - GL_CODES tabs: per-account tab structure (one tab per account) becomes a flat `gl_codes` table in PG with `account_key` column.
  - `parseGLCodes` (line 50-93) has business-rule filters (EXCLUDED_CATEGORIES, SECTION_MARKERS, EXCLUDED_ITEMS) that may NOT need to migrate if PG schema enforces the rules at write time.
  - `triggerAIScan` is async fire-and-forget - the orchestrator must preserve this (return submission result first, scan happens after).
  - F25 + F19b client_uuid become PG UNIQUE constraints.
  - F24 field-based dedup (vendor + invoiceNumber + date + amount) becomes a unique partial index.
  - AI_LINE_ITEMS per-account tabs become a single `ai_line_items` table with FK to `invoice_submissions.uuid`.
**Risk surface:**
  - The submit pipeline (vendor-add + invoice-submit) is the most complex write in the system. 8-step pipeline with multiple failure modes.
  - PDF stamping + Drive upload + Sheets write + Gmail send + Slack + AI line item scan: 6 external dependencies on a single submission.
  - Email send uses operator's OAuth token (not SA) - if their session expires, email fails. Code logs but doesn't retry.
  - GL enrichment is non-blocking; if it fails, the submission row has GL rows without human-readable names.

### src/lib/stampInvoice.js

**Lines:** 402
**Purpose:** PDF generation via pdf-lib. Two exports: `createStampedInvoicePDF` (combined pages + navy header strip + GL Coding Summary page with real PDF text for Bill.com/Rippling parsing) and `createRawInvoicePDF` (pages only, no stamping).
**Reads:** Receives base64 image strings as input.
**Writes:** Returns `{ pdfBase64, pdfBuffer }`.
**AI calls:** none.
**External calls:** none (pure JS, pdf-lib).
**Cross-file:** Imported by invoiceActions.js. No reverse deps.
**Brief alignment:** AGREES with INVOICE_CAPTURE brief and THREESYSTEMS brief Section 3 ("stamped PDF format... Bill.com/Rippling depend on it").
**Undocumented behaviors:**
  - Color palette declared inline (lines 25-30): navy, mustard, grey, light_bg, white, divider. Matches the Ops Hub design system colors.
  - Supports per-page rotation: pages can be `string` (legacy) or `{ data, rotation }` (current).
  - JPEG-first, PNG fallback: embedJpg then embedPng with try/catch each.
  - Page size: US Letter 612x792 with 24-margin. Hardcoded.
**Migration considerations:**
  - PDF generation has no data layer - no migration impact.
  - Output Buffer is consumed by drive.js immediately (no intermediate storage).
**Risk surface:**
  - Bill.com/Rippling integration depends on the summary page's PDF text format. Changes here break downstream AP automation silently. Must test against actual Bill.com import per brief.

### src/lib/drive.js

**Lines:** 168
**Purpose:** Google Drive upload helpers via service account. Manages folder hierarchy `INVOICE_FOLDER / Year / Month / AccountShort`.
**Reads:** `drive.files.list` for folder lookup.
**Writes:** `drive.files.create` for folder creation + PDF/image upload + permission grant (`role: "reader", type: "anyone"`).
**AI calls:** none.
**External calls:** Google Drive API v3.
**Cross-file:** Imports `getServiceAccountDriveClient` from sheets.js. Imported by invoiceActions.js + cron/backup-sheets/route.js.
**Brief alignment:** AGREES with INVOICE_CAPTURE brief Section 9 and TEAM_KNOWLEDGE.
**Undocumented behaviors:**
  - **Folder structure uses SUBMISSION date, NOT invoice date** (line 49-51 comment: "Use submission date (today) for folder structure, NOT the invoice date"). Invoice from 2025-01-15 uploaded on 2026-05-28 lands in `2026/05/`. Operational implication: AP looks for invoices by submission month, not invoice month.
  - `accountShort = account.split(" - ").slice(0, 2).join(" - ").trim()` - takes first 2 hyphen-separated parts (e.g., "STL - FL" from "STL - FL - St Louis Cardinals").
  - Filename builder duplicated here AND in invoiceActions.js (line 110 here vs line 159 in invoiceActions). Two sources of truth; minor.
  - `supportsAllDrives: true` flag throughout - works with Shared Drives.
  - `accessToken` param in `uploadInvoicePages` / `uploadStampedPDF` / `uploadInvoiceImage` is accepted but UNUSED - the SA client is always used. Vestigial param from pre-SA migration; safe to drop.
  - Permission grant catches errors silently (line 94-96, 137-139): "Skipping permission (inherited from parent)". Behavior on shared drives.
**Migration considerations:**
  - Drive storage is NOT replaced by PG migration. Files continue to live in Drive.
  - PG migration changes the URL field type: today the `driveUrls` col is a JSON string array; PG migration makes it TEXT[].
  - If/when we move to Supabase Storage, the upload path here gets swapped. Out of scope today.
**Risk surface:**
  - Drive API quota: every submission = ~4 API calls (list/create year folder, list/create month folder, list/create account folder, create file). Burst rate on multi-submission days could hit limits.
  - Folder structure based on submission-day implies if cron runs around midnight, two invoices in same logical period land in different month folders.

### src/lib/gmail.js

**Lines:** 449
**Purpose:** Email send via Gmail API with MIME multipart support. Three exports: `sendInvoiceEmail` (operator's OAuth - sends FROM operator's address), `sendRejectionEmail` (operator's OAuth), `sendEmailSA` (service account with domain-wide delegation - new canonical helper per PR #56).
**Reads:** none.
**Writes:** Gmail API send.
**AI calls:** none.
**External calls:** Gmail API.
**Cross-file:** Imports `googleapis`. Imported by invoiceActions.js, cron/incident-reminders/route.js.
**Brief alignment:** AGREES with INVOICE_CAPTURE brief Section 8.
**Undocumented behaviors:**
  - TWO subject encoders coexist: `encodeSubject` (printable-ASCII-only, used by operator-OAuth sends) and `encodeSubjectSA` (RFC 2047, used by SA sends). Per BUSINESS_NOTES: unify in future cleanup.
  - MIME multipart construction is hand-rolled (no external library) - boundary strings, base64-encoded PDF attachment with proper Content-Type, Content-Disposition headers.
  - Uses `|` separator in subjects, not `·` (middot) - the middot mojibakes through some mail clients per gotcha.
  - `sendEmailSA` uses domain-wide delegation - the SA impersonates a sender email via JWT subject claim.
**Migration considerations:**
  - Gmail sending is NOT replaced by PG migration. Email infrastructure stays as-is.
  - The two subject encoders should be unified eventually but not in this migration.
**Risk surface:**
  - Email send uses operator's user OAuth - if token expires mid-submission, email fails but the row is already written. Documented post-submit step updates emailSent col M to "TRUE" only on success. Operators can resend via admin tool.
  - Domain-wide delegation requires GSuite admin config - if revoked, all SA emails (cron incident reminders + future SA email paths) break silently.

### src/app/ops/components/invoice/InvoiceTool.js

**Lines:** 1732
**Purpose:** Monolithic 4-step invoice form. 46 useState, 25 useCallback, 16 useEffect (85 total hooks per grep). Renders all 3 tabs (New Invoice, History, AP Review). State machine for the form flow.
**Reads:** `invoice-bootstrap` GET on mount (returns vendors, vendorMaster, glCodes, recentSubmissions). `invoice-history` for History tab refresh. `vendor-search` debounced.
**Writes:** `invoice-photo-gate`, `invoice-ocr`, `invoice-consistency-check` (AI preprocessing). `invoice-duplicate-check` pre-submit. `invoice-submit` for final submit. `vendor-add` if "new vendor" path triggered.
**AI calls:** Indirect via the POST actions.
**External calls:** None directly (all via API routes).
**Cross-file:** Imports InvoiceAdmin, GLCodeTable, VendorSetup. Mounted from src/app/ops/page.js.
**Brief alignment:** AGREES with INVOICE_CAPTURE brief Section 2 + 6.
**Undocumented behaviors:**
  - `MAINTENANCE_MODE` + `MAINTENANCE_BYPASS` list at top of file - hardcoded operator bypass.
  - 4 localStorage keys: `kf_inv_last_account`, `kf_invoice_offline_queue`, `kf_inv_recent_vendors`, `kf_inv_gl_usage`.
  - Maintenance mode UI hides the form entirely with a banner.
  - Offline queue: invoices can be drafted offline; submitted when online. Stored in localStorage as JSON.
  - Recent vendors: last 3 used vendor IDs, persisted per-browser.
  - GL code "Frequently Used" section reads `kf_inv_gl_usage` localStorage and sorts by frequency.
**Migration considerations:**
  - UI doesn't change. Underlying actions get re-routed through dataStore.js orchestrators.
  - Offline queue is client-only; not affected by migration.
**Risk surface:**
  - 1732 LOC in one file - the largest component in the codebase. Any refactor must be incremental.
  - 4 localStorage keys = 4 places per-browser state can desync.
  - 8-stage submit pipeline (validate -> dedup -> stamp -> upload Drive -> write sheet -> email -> AI scan -> Slack) - each stage can fail.

### src/app/ops/components/invoice/InvoiceAdmin.js

**Lines:** 401
**Purpose:** AP Review tab. Admin queue of all submissions. Filters by period (week/month/all). Actions: reject (with reason + note), unreject, dismiss-dupe, delete-dupe.
**Reads:** `invoice-admin-list?period=...`.
**Writes:** `invoice-reject`, `invoice-unreject`, `invoice-dismiss-dupe`, `invoice-delete-dupe`.
**AI calls:** none.
**External calls:** none.
**Cross-file:** Rendered inside InvoiceTool when admin. Has its own state.
**Brief alignment:** AGREES with INVOICE_CAPTURE brief Section 5 POST table.
**Undocumented behaviors:**
  - `isInvoiceAdmin(email)` at line 17 - hardcoded admin list check + `config.isAdmin` from bootstrap. Two sources of truth for admin status.
  - Period summary for "all" - shows totals.
  - Status badges: "sent" "returned" "corrected" with color coding.
  - Dupe row highlight: red background on rows matching the dupe detection criteria.
**Migration considerations:** UI doesn't change. Backend actions migrate.
**Risk surface:** Admin gate is client-side (hides UI) AND server-side (rejection actions check OPS_LEADERSHIP_EMAILS). Vendor-merge does NOT have server-side gate (drift noted in 2B).

### src/app/ops/components/invoice/GLCodeTable.js

**Lines:** 368
**Purpose:** GL code picker with search, category grouping, frequency-based sorting from localStorage. Strips negative signs from amounts on input.
**Reads:** Receives `glCodes` prop from bootstrap. Reads `kf_inv_gl_usage` localStorage for "Frequently Used" sort.
**Writes:** `kf_inv_gl_usage` localStorage on row pick. No server writes.
**AI calls:** none.
**External calls:** none.
**Cross-file:** Imported by InvoiceTool.
**Brief alignment:** AGREES with INVOICE_CAPTURE brief.
**Undocumented behaviors:**
  - Amount field strips minus signs (line 234-279 area) - operators can't break credit mode with negative inputs. Balance math uses `Math.abs()` server-side. Negative sign applied only at submit time for credit mode.
  - "Frequently Used" section reads `kf_inv_gl_usage` map and sorts by usage count.
  - Removed feature: `oh-inv-gl-suggest` CSS class is in ops-invoice.css but the GL split suggestion feature is gone. Vestigial CSS.
**Migration considerations:** Reads from server-side `gl_codes` PG table - no client-side logic change.
**Risk surface:** localStorage frequency map is per-browser. Migrating to server-side requires schema (user_id, gl_code, usage_count, last_used).

---

### 2B. Vendor system

### src/lib/invoiceActions.js (vendor section, lines 1523-1919)

**Lines:** 397 of 1918 (vendor section is ~21% of the file; invoice section is the other ~79%)
**Purpose:** Backend handlers for vendor CRUD and the OCR-driven alias learning. Lives in the same file as invoice handlers for historical reasons (per VENDOR_WIDGET brief Section 2.1: "Vendor handlers live in invoiceActions.js for historical reasons - the Vendor Portal grew out of Invoice Capture's vendor management needs").
**Reads (vendor):**
  - `handleVendorList`: parallel readSheetSA on HUB!vendor_master + HUB!vendor_accounts. Builds linkMap by vendorId, joins master + account-specific link. Page + pageSize pagination. Returns inactiveCount separately. Filter logic: `masterResult.rows.filter((r) => r[0])` filters out rows where vendorId is blank.
  - `handleVendorGet`: same dual read, single vendor lookup.
  - `setVendorActive` (internal): reads vendor_accounts to find rowIndex by (vendorId, accountKey).
  - `learnVendorAlias` (internal): reads vendor_master, finds rowIndex by vendorId.
  - `handleVendorMerge`: reads both tables.
**Writes (vendor):**
  - `handleVendorUpdate` (POST `vendor-update`): vendor_accounts D:R (15 cells range) + W (cell, accountNotes). Two separate calls in parallel via Promise.all.
  - `handleVendorMasterUpdate` (POST `vendor-master-update`): vendor_master B/C/D/E/I (5 separate updateCellSA via Promise.all - NOT batched, would benefit from batchUpdateRangesSA).
  - `setVendorActive` (POST `vendor-deactivate` / `vendor-reactivate`): vendor_accounts!S{row}.
  - `learnVendorAlias` (internal, fire-and-forget from invoice-submit): vendor_master!I{row} (aliases append).
  - `handleVendorMerge` (POST `vendor-merge`): batchUpdateRangesSA on vendor_accounts!B (vendorId reassignment) + batchUpdateRangesSA on vendor_master!B:E (soft-delete blanking) + updateCellSA on vendor_master!I (keeper aliases append). Three sequential batched ops.
  - vendor-add (separate handler inside `handleInvoicePost` around line ~900): appendRowSA on both tables, F19a vendorId collision retry, F19b client_uuid idempotency.
**AI calls:** none directly. `learnVendorAlias` is triggered after OCR fuzzy-matches a vendor.
**External calls:** Slack webhook `SLACK_VENDOR_WEBHOOK` (fire-and-forget on every write). No Drive, Gmail.
**Cross-file dependencies:**
  - Imports: sheets.js helpers, drive.js, gmail.js, stampInvoice.js (for the invoice section), `OPS_LEADERSHIP_EMAILS` from `@/lib/admin`.
  - Called by: `src/app/api/ops/route.js` (the route dispatcher), specifically the `handleInvoiceGet` and `handleInvoicePost` orchestrators.
**Brief alignment:**
  - AGREES with VENDOR_WIDGET brief Section 4 (API endpoints), Section 6 (data flows), Section 9 (duplicate prevention).
  - **DRIFT (HIGH):** brief Section 12 P2: "vendor-merge: No server-side admin gate. Relies on UI hiding Admin tab. Should be gated by OPS_LEADERSHIP_EMAILS check in handler." Verified at lines 1847-1849: `handleVendorMerge` does NOT check OPS_LEADERSHIP_EMAILS. Only `handleVendorDeactivate` has the server-side gate. Documented but not fixed.
  - **DRIFT (MEDIUM):** brief Section 12 P2: "fuzzyMatchVendor() (used by OCR) does not search aliases. vendor-search does." Need to verify against fuzzyMatchVendor implementation (lines 171-250 per brief).
**Undocumented behaviors:**
  - `handleVendorList` filter quirk: merged dupe vendor_master rows have vendorId (col A) preserved but B/C/D blanked + E="DELETED". The `r[0]` truthy filter doesn't exclude them. They appear in vendor-list with name="" if `allAccounts=true` (admin view). In per-account view, the subsequent linkMap filter excludes them (their links were reassigned to keeper). Brief mentions soft-delete blanks B-D but doesn't note the admin-view leak.
  - `setVendorActive` reads vendor_accounts even when input is just (vendorId, accountKey) - could be a direct lookup via `findRowByValueSA` with compound key but uses the iterate-and-find pattern.
  - `handleVendorMasterUpdate` uses 5 parallel `updateCellSA` calls instead of one `batchUpdateRangesSA` even though B-E are contiguous. Minor performance.
**Migration considerations:**
  - Vendor handlers will move to dataStore.js orchestrators following the submissions pattern.
  - `learnVendorAlias` is the OCR-driven async write - needs an orchestrator that preserves its "fire-and-forget on invoice-submit" semantics.
  - `vendor-merge` is the multi-table coordinated write that maps cleanly to the existing `coordinatedWrite` primitive in dataStore.js (with a PG transaction wrapping all 3 ops).
  - `vendor-deactivate` admin gate logic moves either to RLS or stays in the orchestrator. The OPS_LEADERSHIP_EMAILS allow-list should become a `users.role` column per AUTH_MODEL.md (already specced).
  - `vendor-merge` missing admin gate: fix in PR B handler rewire.
**Risk surface:**
  - Merge atomicity: 3 sequential operations today, partial failure possible. PG transaction would close this.
  - `learnVendorAlias` is fire-and-forget - if it fails silently, aliases don't accumulate. Today logs warn-level only.
  - Soft-delete via column blanking is fragile: any future code that queries vendor_master without filtering blanks will see "ghost" entries.

### src/app/ops/components/vendors/VendorPortal.js

**Lines:** 165
**Purpose:** Shell component. Renders account selector dropdown, sub-nav (Directory / Admin), mounts VendorList or VendorAdminView based on view, hosts the Add Vendor modal (via VendorSetup).
**Reads:** none directly (delegates to children).
**Writes:** none directly.
**Cross-file:** Imports VendorList, VendorAdminView, VendorSetup. Mounted from `src/app/ops/page.js` with `config` prop (isAdmin, email, accounts[]).
**Brief alignment:** AGREES with VENDOR_WIDGET brief Section 2.2.
**Migration considerations:** No data layer changes. Children handle data access.
**Risk surface:** none.

### src/app/ops/components/vendors/VendorList.js

**Lines:** 409
**Purpose:** Paginated vendor list with search, filter, split-pane layout. Fetches via `GET /api/ops?action=vendor-list`.
**Reads:** Calls `vendor-list` action (paginated, with category + search filters). Calls `vendor-get` on row click for full detail.
**Writes:** Calls `vendor-deactivate` / `vendor-reactivate` POST actions via confirm dialog.
**Brief alignment:**
  - **DRIFT (HIGH) - confirmed in audit:** brief Section 12 P2 - "Local `categoryColor` function only has 11 entries - missing Supplies and Linen." Verified at lines 249-264: missing `Supplies` and `Linen`. Also `CATEGORIES` const at line 6 missing both.
  - **DRIFT (MEDIUM):** VendorList's local `categoryColor` duplicates `CATEGORY_COLORS` from VendorCard / VendorAdminView / VendorSetup. 4 separate sources of truth for the same color map.
**Undocumented behaviors:**
  - Debounced search at 350ms (line 156-160).
  - Pagination uses `append` mode for "Load more" - rows are appended client-side, not paginated server-side after page 1.
**Migration considerations:** UI doesn't change; the underlying `vendor-list` endpoint switches reads to PG via the dispatch layer.
**Risk surface:**
  - Inactive vendors filtered out by default unless user toggles "Show inactive". Migration must preserve.
  - Search is client-substring-only in the API filter loop (line 1610: `v.name.toLowerCase().includes(search)`); aliases NOT searched here, only in `vendor-search`.

### src/app/ops/components/vendors/VendorCard.js

**Lines:** 265
**Purpose:** Read-only detail panel. Renders vendor name, category chip, sales rep contacts, delivery schedule, ordering portal link, portal username/password (masked, with reveal toggle), site notes (collapsible), Edit + Deactivate buttons.
**Reads:** Receives `vendor` prop from VendorList (fetched via vendor-get).
**Writes:** Triggers `onEdit` (opens VendorEditModal), `onDeactivate` / `onReactivate` (parent handles fetch).
**Brief alignment:** AGREES with VENDOR_WIDGET brief Section 6.1.
**Undocumented behaviors:**
  - `CATEGORY_COLORS` constant at line 5 - one of the 4 duplicates of the color map.
  - Portal password reveal: rendered as `••••••••` by default, click to toggle. Tab-index excluded.
  - Password is server-returned in cleartext (per VENDOR_WIDGET brief Section 10: intentional for shift continuity).
**Migration considerations:** No data layer changes.
**Risk surface:** Plaintext credential display matches design intent; access-control hardening is a future PR per brief.

### src/app/ops/components/vendors/VendorEditModal.js

**Lines:** 618
**Purpose:** Two-tab edit modal. Tab 1 = Account Settings (per-account fields, saves to vendor_accounts via `vendor-update`). Tab 2 = Vendor Info (global fields, saves to vendor_master via `vendor-master-update`).
**Reads:** Receives `vendor` prop pre-populated.
**Writes:** `vendor-update` (line 177-181), `vendor-master-update` (line 238-242). Independent saves per tab.
**Brief alignment:** AGREES with VENDOR_WIDGET brief Section 6.3.
**Undocumented behaviors:**
  - Dirty-state tracking: switching tabs with unsaved changes triggers a "SwitchWarning" prompt.
  - Time inputs (cutoffTime) have helper functions `formatTimeTo12h` / `formatTimeTo24h` for AM/PM display.
  - Has its own `CATEGORIES` const at line 7 (13 entries - correct, matches brief).
**Migration considerations:**
  - Two saves to two tables - currently in-flight via separate handlers. PG migration can preserve the split or unify.
**Risk surface:**
  - Dirty-state warning preserves user intent across tab switches; ensure UX preserved.

### src/app/ops/components/vendors/VendorAddModal.js

**Lines:** 292
**Purpose:** Older 2-step add modal (step 1 = name + duplicate check, step 2 = full form). Per VENDOR_WIDGET brief Section 10.3: "Separate, older add modal still in the codebase. It is NOT imported by VendorPortal (which uses VendorSetup). It may be used by InvoiceTool directly in some code paths."
**Reads:** `vendor-search` GET (debounced 400ms).
**Writes:** `vendor-add` POST.
**Brief alignment:** AGREES with brief; brief flags as "Audit before Supabase migration" (P3).
**Undocumented behaviors:**
  - Has its own `CATEGORIES` const at line 4 (13 entries - correct).
  - Has its own `PAYMENT_TERMS` const at line 5: `["NET30", "NET15", "NET7", "COD", "Prepaid", "Other"]` - 6 entries.
**Brief alignment:** **DRIFT (HIGH):** VENDOR_WIDGET brief Section 5.2 specifies 11 payment terms: `Net 7, Net 10, Net 14, Net 15, Net 30, Net 45, Net 60, COD, Prepaid, Credit Card, I don't know`. VendorAddModal has only 6 with different formatting (`NET30` vs `Net 30`).
**Migration considerations:**
  - Confirm via grep whether InvoiceTool.js or any other consumer still uses this older modal. If yes, migration must preserve. If no, deletion candidate (vestigial code).
**Risk surface:**
  - Payment terms drift: data written via this modal would have non-canonical values (`NET30` not `Net 30`) which would not match the brief's enum.

### src/app/ops/components/vendors/VendorAdminView.js

**Lines:** 529
**Purpose:** Admin-only view. Two sub-views: "All Vendors" table (read all vendors, allow inline category edit via `vendor-master-update`) and "Duplicate Detector" (Levenshtein scan + merge UI).
**Reads:** `vendor-list?allAccounts=true&pageSize=500` (line 31, 254 - twice for the two sub-views).
**Writes:** `vendor-master-update` (line 75, category edits), `vendor-merge` (line 315).
**Brief alignment:** AGREES with VENDOR_WIDGET brief Section 6.5.
**Undocumented behaviors:**
  - Has its own `CATEGORY_COLORS` const at line 4 + `CATEGORIES` const at line 12.
  - Levenshtein duplicate detector is client-side - reads pageSize=500, runs the scan in browser.
  - "Dismiss" stored in localStorage (not server-side).
**Migration considerations:**
  - PG migration enables server-side fuzzy match via `pg_trgm` (Postgres trigram extension) or similar - could replace client-side Levenshtein.
  - Dismissed pairs in localStorage are per-browser - if you want server-side persistence, that becomes a schema decision.
**Risk surface:**
  - 500-row limit on vendor-list?allAccounts=true: today 35 vendors fits comfortably; growth to >500 vendors breaks the dedup detector silently.

### src/app/ops/components/invoice/VendorSetup.js

**Lines:** 671
**Purpose:** 4-step add/link wizard. Step 0 = vendor name + duplicate check + link existing option. Step 1 = ordering & portal. Step 2 = sales rep. Step 3 = review + notes + submit. Used by BOTH VendorPortal (as the "+ Add Vendor" modal) AND InvoiceTool (when "New vendor" is selected mid-invoice).
**Reads:** `vendor-search` GET (debounced).
**Writes:** `vendor-add` POST (line 251-255).
**Brief alignment:** AGREES with VENDOR_WIDGET brief Section 6.2 and 10.2.
**Undocumented behaviors:**
  - Has its own `CATEGORIES` (line 58) + `CATEGORY_COLORS` (line 64) - the 4th duplicate.
  - F19a/F19b idempotency is server-side (in vendor-add handler), but the client generates the clientUuid that gets passed. Client-side: random UUID per form mount.
  - "Link existing vendor" path (skips master insert) jumps to step 1 with `existingVendorId` set.
**Migration considerations:**
  - The vendor-add path through this wizard is the primary write path for new vendors today.
  - F19b idempotency check (read-then-write on clientUuid) becomes redundant once PG UNIQUE constraint enforces it.
**Risk surface:**
  - Cross-surface usage (VendorPortal AND InvoiceTool): any change must be tested in both.
  - 4 sources of truth for category color map (this file + VendorCard + VendorAdminView + InvoiceTool indirectly): maintenance burden.

### src/lib/opsUtils.js (vendor section)

See 2A. Shared Infrastructure for full audit. Vendor-relevant functions: `getAllVendors`, `resolveVendorId` (both have positional-index DRIFT - shortName returns category, active checks website column, see 2A).

---

### 2A. Shared infrastructure

### src/lib/sheets.js

**Lines:** 443
**Purpose:** Google Sheets API abstraction layer. Exports SHEET_IDS constants + parallel user-OAuth and service-account helpers.
**Reads:** N/A (helper module - this is the layer that does reads for everyone else).
**Writes:** N/A (helper module).
**AI calls:** none.
**External calls:** googleapis (Sheets v4 + Drive v3).
**Cross-file dependencies:**
  - Imported by: every file in `src/lib/`, every API route in `src/app/api/`, the dataStore.js dual-write orchestrators, opsUtils.js.
  - Imports: `googleapis`, `process.env` (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`).
**Brief alignment:** AGREES with THREESYSTEMS brief ("Universal patterns shared by all three systems"): all sheet writes go through service account, user OAuth is identity-only. Helper inventory matches what the briefs reference.
**Undocumented behaviors:**
  - `SHEET_IDS.GAME` (line 17) is declared but commented "Paused - gamification pilot from the AppScript era. Not in active use; intentionally excluded from the backup-sheets cron." Worth knowing.
  - Sheet IDs `AI_LINE_ITEMS` and `INVENTORY` (lines 19, 20) both contain capital `O` not `0`. THREESYSTEMS brief calls this out ("This is a common typo source"). Code matches brief.
  - `appendRowSA` (line 124) auto-adds `!A:A` if the tab name is bare - prevents the "appendRows uses explicit tab!A1 range" bug the cron's `v1.2` comment header mentions. Defensive fix.
  - Two parallel API surfaces: user-OAuth helpers (`readSheet`, `appendRow`, `updateCell`, `findRowByValue`, `appendRows`) remain in the file but per the migration history (PR #54-#59) all production code now uses the SA variants. The user-OAuth helpers are vestigial but not yet removed.
**Migration considerations:**
  - sheets.js is foundation infrastructure. Migration does NOT replace sheets.js; the dataStore.js dispatch routes calls to either sheets.js (Sheets path) or supabase.js (PG path).
  - When all finance tables are cut over, the SA helpers will still be called from the orchestrators for Sheets-side writes during the dual-write window.
**Risk surface:**
  - The 14 SA helpers are universal. Any change to their behavior (e.g., adding caching, error semantics) would affect every consumer.
  - GAME sheet ID exists but is excluded from backups - if revived, backup wiring needs updating.

### src/lib/cutover.js

**Lines:** 193 (post PR #82 doc fix)
**Purpose:** Stage 1 dual-write control plane. Two env vars (`DUAL_WRITE_TABLES`, `READ_FROM_POSTGRES`) plus per-module variants (`READ_FROM_POSTGRES_<MODULE>`). Three boolean helpers: `isDualWrite`, `isReadFromPostgres`, `getCutoverState`.
**Reads:** `process.env.DUAL_WRITE_TABLES`, `process.env.READ_FROM_POSTGRES`, `process.env.READ_FROM_POSTGRES_*` at module load time.
**Writes:** none.
**AI calls:** none.
**External calls:** none.
**Cross-file dependencies:** Imported by dataStore.js (all dispatch sites). No imports.
**Brief alignment:** N/A - cutover.js is migration infrastructure not covered by the briefs (predates briefs as a Stage 1 mechanism).
**Undocumented behaviors:**
  - `isReadFromPostgres(tabName, moduleName)` second arg supports per-module scoping (added for directory PR B). OR-composes global + per-module flag.
  - Per-module env var discovery is generic: any `READ_FROM_POSTGRES_<MODULE>` is auto-discovered at module load. No code change required to add new modules - just set the env var.
  - The "implicit invariant" (READ_FROM_POSTGRES implies DUAL_WRITE_TABLES) is operator-maintained, NOT enforced at runtime. Per the PR #82 doc fix, the comment block now explicitly documents this and the misconfiguration state. State 4 (READ_FROM_POSTGRES only, no DUAL_WRITE) silently produces stale reads.
**Migration considerations:**
  - cutover.js is the control plane for the finance stack migration. Each new finance module (vendor, invoice, inventory, AI_LINE_ITEMS) gets dispatch sites in dataStore.js that check these flags.
  - The DECOMMISSION NOTE (KNOWN LIMITATION) section explains that removing tables from DUAL_WRITE_TABLES does NOT stop Sheets writes (orchestrators write Sheets unconditionally). For the cron migration, this matters: the cron can be cleanly swapped because it's a separate repo, but the intranet orchestrators retain Sheets writes indefinitely unless code changes invert the pattern.
**Risk surface:**
  - Env var typo (e.g., `READ_FROM_POSTGRES_FINANCE` instead of `READ_FROM_POSTGRES_OPS`) silently does nothing. No error surface.

### src/lib/dataStore.js

**Lines:** 1994
**Purpose:** Logical data layer for Stage 1 dual-write. Per-table orchestrators dispatch reads/writes between Sheets and Postgres based on cutover flags.
**Reads:** Composed of per-table read functions (readNewsInteractionsSheets/Postgres, readAccountsSheets/Postgres, etc.). Reads include all migrated tables (news_interactions, accounts, contacts, hero_images, work_locations, submissions).
**Writes:** Composed of per-table write functions. All orchestrators follow Sheets-first-then-conditional-PG pattern.
**AI calls:** none.
**External calls:** none (delegates to sheets.js + supabase.js).
**Cross-file dependencies:**
  - Imports: `readSheetSA`, `appendRowSA`, `appendRowsSA`, `updateCellSA`, `updateRangeSA`, `batchUpdateRangesSA`, `clearRangeSA`, `deleteRowSA`, `getSheetIdSA`, `SHEET_IDS` from `@/lib/sheets`. `isDualWrite`, `isReadFromPostgres` from `@/lib/cutover`. `getServiceClient` from `@/lib/supabase`.
  - Imported by: route handlers for migrated modules (dashboard/route.js for news_interactions, directory/route.js for accounts+contacts+hero_images+work_locations, people/route.js for submissions). Also imported by the backfill scripts.
**Brief alignment:** N/A - dataStore.js is migration infrastructure not in the briefs.
**Undocumented behaviors:**
  - Three shared primitives at lines 400-557 (`coordinatedWrite`, `deleteRecord`, `replaceScope`) - reusable for future modules. NOT exported - composed inline by adapter functions.
  - `coordinatedWrite` is sequential not parallel - explicit choice to avoid Sheets per-doc write rate limits. Log-and-continue on failure (does NOT throw mid-flight).
  - `deleteRecord` is idempotent - if key absent from Sheets, treated as no-op success rather than error.
  - `replaceScope` deletes Sheets rows BOTTOM-UP to avoid row-index shift bug in the Sheets API.
  - The submissions module (PR A through D, lines 1458-1994) is the most mature pattern: sub-{N} token translation, dual-column timestamp design (created_at immutable + submitted_at mutable), per-module dispatch (`getSubmissions({ module: "people" })` vs `{ module: "dashboard" }`), STATUS DEFAULT GOTCHA, drift fix from PR #78 (orchestrators stamp event-moment ONCE).
**Migration considerations:**
  - Finance stack adds 8 new tables to dataStore.js: vendor_master, vendor_accounts, invoice_submissions_26, AI_LINE_ITEMS, item_catalog, storage_locations, count_sessions, count_items, item_aliases, price_history, merge_history, review_queue, plus the GL_CODES table.
  - Pattern to follow: submissions module (cleanest current example).
  - Shared primitives (`coordinatedWrite`, `deleteRecord`, `replaceScope`) likely reusable for vendor-merge (multi-table coordinated write) and Smart Inventory item-merge.
  - File size: 1994 LOC today. Adding finance modules will push past 3000 LOC. Consider splitting into per-module files (e.g., `src/lib/dataStore/vendor.js`, `src/lib/dataStore/invoice.js`) before it becomes unmanageable. OUT OF SCOPE for this audit but flag for the planning artifact.
**Risk surface:**
  - The orchestrator pattern is now consistent across all migrated modules. Any new module that deviates from this pattern (e.g., conditional Sheets writes for the cron-aware paths) needs explicit documentation.
  - Per the PR #78 drift fix: orchestrators MUST stamp event-moment timestamps once before dispatching to adapters. Per-adapter `new Date().toISOString()` produces ~226ms drift. Future finance orchestrators must follow this pattern.

### src/lib/opsUtils.js

**Lines:** 123
**Purpose:** Shared utility helpers for the Ops Hub: cached reads, account/period lookups, vendor lookups, notifications, formatting.
**Reads:**
  - `getAccountConfigs()` reads `HUB.accounts` (cols A/B/C = key, name, level). Cached 60s.
  - `getPeriods()` reads `HUB.period_data` (cols A/B/C/D = name, start, end, due). Cached 60s.
  - `getAllVendors()` reads `HUB.vendor_master` (cols 0/1/2/3). Cached 60s. **DRIFT - see below.**
  - `resolveVendorId(vendorId)` reads `HUB.vendor_master`. Cached 60s.
**Writes:**
  - `opsNotify({recipient, subject, eventType, relatedInfo})` appends to `COLLECTION.notification_log` (7-col row: timestamp, recipient, channel='bell', subject, eventType, status='logged', relatedInfo).
**AI calls:** none.
**External calls:** `postSlack(webhookUrl, text)` posts a JSON `{text}` to a Slack webhook URL.
**Cross-file dependencies:**
  - Imports: `SHEET_IDS`, `readSheetSA`, `appendRowSA` from `@/lib/sheets`.
  - Imported by: inventoryActions.js (`getAccountConfigs`, `getCurrentPeriod`, `getPeriods`), invoice + vendor handlers (`getAllVendors`, `resolveVendorId`, `opsNotify`, `parseNum`, `formatCurrency`, `generateId`), service-calendar/route.js, dashboard/route.js (via opsNotify), incidentActions.js, etc.
**Brief alignment:** Mostly AGREES with THREESYSTEMS brief. The brief mentions `getAccountConfigs()` and `getCurrentPeriod()` from "src/lib/accounts.js" but that file does not exist - the functions live in opsUtils.js. **Brief drift: file path incorrect.**
**Undocumented behaviors:**
  - **CRITICAL DRIFT: `getAllVendors()` (line 79) reads vendor_master at positional indices that no longer match the schema.**
    - Code: `{ id: r[0], name: r[1], shortName: r[2] || r[1], active: r[3] !== "FALSE" }`
    - Actual schema per SHEETS_AUDIT.md + VENDOR_WIDGET brief: `[0]=vendorId, [1]=name, [2]=category, [3]=website, [4]=notes, ...` No `shortName` column. No `active` column on vendor_master (active lives on vendor_accounts col S).
    - Effect: `shortName` returns category. `active` check on `r[3] !== "FALSE"` is on website column - returns true unless website is literally "FALSE" (essentially always true).
    - **This means `getAllVendors()` filter never excludes anything, AND the returned `shortName` is wrong.**
    - Need to grep for callers - if anything depends on shortName being a shortName (not category), behavior is broken today.
  - `resolveVendorId(vendorId)` (line 86) returns `row[2] || row[1] || vendorId` - returns category if present, else name. Same drift. Comment claims to resolve "shortName" but col 2 is category.
  - Cache layer with `_cache` Map + 60s TTL + `invalidateCache(spreadsheetId, tabName)`. NOT cleared on writes by default - callers must invalidate explicitly. Used by inventory-bootstrap; not used by vendor-list (which calls readSheetSA directly).
  - `generateId(prefix)` generates 32-char hex IDs (16 random bytes pattern). Used by Smart Inventory for catalog item IDs, location IDs, session IDs.
**Migration considerations:**
  - `getAccountConfigs` + `getPeriods` + `getCurrentPeriod` become PG queries on `accounts` and `periods` tables. Already partially migrated: accounts is on PG (Module 2 directory cutover). `periods` table NOT yet migrated.
  - **`getAllVendors` and `resolveVendorId` are wrong today.** Fixing them is in-scope for the vendor migration (PR B handler rewire). The fix is one-line per function: correct positional indices.
  - Cache layer (`cachedRead`, `batchRead`, `invalidateCache`) can be dropped once Postgres is the read path - no need for in-memory caching.
  - `opsNotify` writes to `COLLECTION.notification_log` - this table is multi-writer (people, opsUtils, cron-daily). NOT in scope for this audit's finance migration, but worth flagging for the dashboard's Module 4+ planning.
**Risk surface:**
  - The vendor filter bug (`getAllVendors`) silently returns all vendors regardless of active state. If any caller is using this for "active vendors only" display, the count is wrong.
  - Cache TTL is 60s. Writes from another deployment (or admin direct sheet edit) won't be reflected for up to 60s. Acceptable today; PG cutover removes this concern.

---

## 3. Cross-cutting findings

### Duplicated logic across files

**Vendor name matching / fuzzy logic - SEVEN implementations:**
1. `fuzzyMatchVendor` in invoiceActions.js (lines 171-250) - OCR-driven, searches aliases + names with noise-token normalization
2. `learnVendorAlias` in invoiceActions.js (lines 1815-1844) - alias dedup case-insensitive
3. `vendor-search` API search (inline in handleInvoiceGet) - searches name + aliases with normalization
4. `getAllVendors` in opsUtils.js - simple positional read (broken, see drift)
5. Client-side Levenshtein in VendorAddModal.js debounce
6. Client-side Levenshtein in VendorAdminView.js full-corpus dedup scan
7. `normalizeName` in cron index.js (line 115) - cron's own normalizer

Each has subtle differences in noise tokens, normalization rules, scoring weights. Migration consolidates to a single PG function with `pg_trgm` similarity or one canonical helper.

**`CATEGORIES` constant - FIVE separate declarations:**
- VendorAddModal.js line 4: 13 entries (correct)
- VendorEditModal.js line 7: 13 entries (correct)
- VendorAdminView.js line 12: assumed 13 (not fully verified)
- VendorSetup.js line 58: assumed 13 (not fully verified)
- VendorList.js line 6: **11 entries + "All"** (MISSING Supplies, Linen)

**`CATEGORY_COLORS` map - FOUR declarations:**
- VendorCard.js line 5
- VendorAdminView.js line 4
- VendorSetup.js line 64
- VendorList.js inline `categoryColor` function (lines 249-264)

Single source of truth never established. Maintenance burden.

**`accountMatch` rule - TWO implementations:**
- inventoryActions.js line 14 (handles short vs full label)
- kitchfix-inventory-cron/index.js line 47 (same rule, separate repo)

Drift risk if one updates and the other doesn't.

**Account-key format - inconsistent across writes:**
- Sheets canonical: spaces ("CIN - OH") - 7,581 cells
- Hyphens ("CIN-OH") - 88 cells, quarantined in deferred modules
- vendor-add `rowId` (line 927): `account.split(" - ").slice(0, 2).join("-")` produces hyphens ("STL-FL")
- drive.js `accountShort` (line 54): `account.split(" - ").slice(0, 2).join(" - ")` keeps spaces ("STL - FL")
- Two paths from the same account string to two different format conventions.

### Cross-system data flow (file-level)

The shared INVENTORY sheet tables are written by BOTH the cron and the intranet:

| Table | Intranet writers | Cron writers |
|---|---|---|
| item_catalog | add-item, verify-price, archive-item, exclude-item, reactivate-item, batch-move-items, merge-items, count-submit (priceAtLastCount snapshot) | nightly auto-create (linkedToInvoice=TRUE), dedup mode (manual) |
| item_aliases | review-accept, merge-items | nightly auto-learn |
| price_history | add-item, verify-price, merge-items (remap) | nightly auto-append (with invoiceUuid for idempotency) |
| review_queue | review-accept (acts on), review-delete (removes) | nightly append (low-confidence) |
| merge_history | merge-items, keep-separate, exclude-item | NONE (read-only - filters excluded items) |
| zone_corrections | review-accept (NEW - not in brief) | NONE |

**One-way coupling: intranet writes `merge_history.action="exclude"`, cron reads to skip.** This is the only intranet -> cron synchronous-effect path.

### Shared helper inventory

These helpers must stay stable during migration:

- `sheets.js` SA helpers (14 functions): foundation - everything uses them.
- `opsUtils.js`: `getAccountConfigs`, `getPeriods`, `getCurrentPeriod`, `cachedRead`, `batchRead`, `invalidateCache`, `parseNum`, `formatCurrency`, `generateId`, `opsNotify`, `postSlack`.
- `opsUtils.js` BROKEN helpers: `getAllVendors`, `resolveVendorId` (see drift).
- `drive.js`: `uploadStampedPDF`, `uploadInvoicePages`, `uploadInvoiceImage`, `ensureInvoiceFolder` (internal), `getOrCreateFolder` (internal).
- `gmail.js`: `sendInvoiceEmail`, `sendRejectionEmail`, `sendEmailSA`, `encodeSubject`, `encodeSubjectSA`.
- `stampInvoice.js`: `createStampedInvoicePDF`, `createRawInvoicePDF`.
- `dataStore.js` orchestrator pattern + 3 shared primitives (`coordinatedWrite`, `deleteRecord`, `replaceScope`).

### Business rules in code vs briefs vs nowhere

- Photo gate "be very generous" rule: in prompt text (invoice-photo-gate), not in code. Brief INVOICE_CAPTURE Section 14 documents.
- Cron match confidence bands (95-100 / 80-94 / 60-79 / <60): in prompt + env var. Brief THREESYSTEMS Section 1 documents.
- GL category exclusions (`EXCLUDED_CATEGORIES`, `EXCLUDED_ITEMS`): in invoiceActions.js (lines 29-48). NOT in any brief.
- AI line item skip rules (weight notation, freight, totals): in prompt text. Brief documents at high level only.
- Vendor merge alias accumulation: in code (handleVendorMerge), brief documents.
- Variety grouping for inventory items: in cron prompt. Brief THREESYSTEMS Section 1 documents.

---

## 4. Drift report

### HIGH severity (would mislead migration plan)

| # | Where | Brief says | Code does | Recommended resolution |
|---|---|---|---|---|
| H1 | `opsUtils.js` `getAllVendors` | (no brief documents this fn) | `r[3] !== "FALSE"` checks website column (always true); `r[2]` returned as shortName is actually category | Fix during PR B vendor handler rewire. Replace with PG query or correct positional indices. |
| H2 | `opsUtils.js` `resolveVendorId` | Returns vendor shortName | Returns `r[2]` (category) | Same fix. |
| H3 | VendorList.js `CATEGORIES` | VENDOR_WIDGET Section 5.1 lists 13 categories | 11 + "All" (missing Supplies, Linen) | Single shared constant. Fix as part of vendor migration. |
| H4 | VendorAddModal.js `PAYMENT_TERMS` | VENDOR_WIDGET Section 5.2 lists 11 enum values including "Net 30" formatting | 6 entries with "NET30" formatting | Single shared constant; reformat existing data. Note: VendorAddModal may be deletable (see O5). |
| H5 | `handleVendorMerge` admin gate | VENDOR_WIDGET Section 12 P2: "should be gated by OPS_LEADERSHIP_EMAILS check in handler" | NO server-side gate; relies on UI hiding Admin tab | Add OPS_LEADERSHIP_EMAILS check in handler. Single-line fix. |

### MEDIUM severity (worth knowing)

| # | Where | Brief says | Code does | Recommended resolution |
|---|---|---|---|---|
| M1 | `fuzzyMatchVendor` | VENDOR_WIDGET Section 12 P2: "does not search aliases" | DOES search aliases (lines 199-214) with score weights 100/90/85 | Brief is WRONG. Update brief; no code change needed. |
| M2 | `getAccountConfigs` location | THREESYSTEMS brief Section "Smart Inventory Cross-System": "Bootstrap calls getAccountConfigs() and getCurrentPeriod() from src/lib/accounts.js" | Functions live in `src/lib/opsUtils.js` | Brief drift - `src/lib/accounts.js` does not exist. |
| M3 | `zone_corrections` tab | SMART_INVENTORY brief schema reference does NOT mention this tab | `handleReviewAccept` writes to it (line 746) | Add zone_corrections to PG schema design. Schema TBD - need to inspect actual tab. |
| M4 | `dedupExistingCatalog` two implementations | THREESYSTEMS Section 1 lists cron-side only | Also lives at inventoryActions.js line 1069 as `handleDedupCatalog` | Decision: which to migrate? Cron version is manual one-shot; intranet version is also gated. Both may become obsolete with PG UNIQUE constraints. |
| M5 | Brief inventory schema (SMART_INVENTORY) | "Smart Inventory schema is NOT yet in docs/SUPABASE_MIGRATION.md" | Confirmed - SUPABASE_MIGRATION.md has vendor + invoice schemas; inventory schemas need new design. | Schema design work in scope for Project 3 planning. |
| M6 | `account.startsWith` rule duplication | THREESYSTEMS / SMART_INVENTORY brief mentions accountMatch tolerance once | TWO implementations: inventoryActions.js + cron | Migration normalizes account_key format; both implementations become obsolete. |

### LOW severity (cosmetic)

| # | Where | Note |
|---|---|---|
| L1 | `HUB_SHEET_ID` cron env var | Declared at line 27 but unused. Dead config. Drop during cron migration. |
| L2 | drive.js filename example | INVOICE_CAPTURE brief Section 9 shows `Fortune_Fish_2026-01-15_350118.pdf` (vendor_date_invoice). Code produces `${vendor}_{invoice}_{dateNoHyphens}.pdf` (vendor_invoice_date). Brief example wrong; code format is `Fortune_Fish_350118_20260115.pdf`. |
| L3 | `accessToken` params in drive.js | `uploadInvoicePages`, `uploadStampedPDF`, `uploadInvoiceImage` accept `accessToken` but never use it (always SA). Vestigial parameter; safe to drop. |
| L4 | Duplicate filename builders | invoiceActions.js `buildPdfFilename` (line 159) AND drive.js `uploadStampedPDF` inline (line 110-112). Two sources of truth. |
| L5 | Two subject encoders | `encodeSubject` and `encodeSubjectSA` in gmail.js coexist. BUSINESS_NOTES flags for unification. |
| L6 | Reserved columns | vendor_accounts col V (index 21) marked "(unused) Reserved for Phase 2". 0/54 fills. Drop in PG schema. |
| L7 | vestigial user-OAuth helpers in sheets.js | `readSheet`, `appendRow`, `appendRows`, `updateCell`, `findRowByValue`, `getSheetsClient`. No production code uses them. |

---

## 5. Undocumented behaviors

| # | Behavior | Category |
|---|---|---|
| U1 | Drive folder structure uses SUBMISSION date, not invoice date (drive.js line 49-51) | Intentional (preserve) - documented in code comment, not in briefs |
| U2 | `handleVendorList` includes soft-deleted dupes in admin allAccounts view (name="" rows passed through) | Incidental - could change; UI may handle empty names |
| U3 | `LINE_ITEM_HEADERS` 15 cols are hardcoded; on first invoice for a new account, the tab is auto-created with these headers | Intentional - lazy-init pattern |
| U4 | `GL_TAB_MAP` has duplicate entries (TXR-HOME maps to "TXR - Home" AND TXR-TX-H also maps to "TXR - Home") | Intentional defensive coding against account-key format variance |
| U5 | inventoryActions.js writes to a `zone_corrections` tab not in any brief | LATENT - needs schema captured |
| U6 | Cron skip-tabs filter: anything matching `_` prefix OR in `["Invoice Uploads", "Sheet1", "_metadata"]` (line 689) | Intentional - filters metadata tabs |
| U7 | Cron Slack digest only fires if any account processed > 0 OR Monday morning | Intentional - quiet days are quiet |
| U8 | `handleMergeItems` (intranet) and cron's dedup both blank dupe item_catalog cols + write merge_history. Two write paths for the same logical operation | Intentional - intranet for admin UI, cron for batch cleanup |
| U9 | `handleExcludeItem` writes `merge_history!A:A` with explicit range (line 803) - all other merge_history writes use bare tab name | Inconsistency - either both should be `!A:A` (safer) or both bare. Cron uses `!A1` explicit ranges. |
| U10 | `excluded` vs `archived` distinction in item_catalog status col (line 60-73 of inventoryActions.js bootstrap) | Operationally important: excluded means "never re-add even if invoiced" (cron honors), archived means "dormant, can revive" |
| U11 | `accountMatch` cron-side reads `startsWith("CIN - OH -")` - tolerates EITHER format on EITHER side | Intentional defensive coding |
| U12 | OCR fuzzyMatchVendor returns top 3 candidates with confidence band labels (high/medium/low) | Documented in brief; what's undocumented is the scoring breakdown (alias 100/90/85, name 100/85/80, word-overlap formula) |
| U13 | `MAINTENANCE_MODE` flag in InvoiceTool.js with `MAINTENANCE_BYPASS` email list | Intentional - admin-only bypass |
| U14 | 4 localStorage keys in InvoiceTool.js (last_account, offline_queue, recent_vendors, gl_usage) | Intentional client-side state |
| U15 | Cron `v1.2` header lists 5 production-fire fixes (offset bug, account matching, excluded items, false handling, blank row skip) | Worth preserving exactly - these are known-good behaviors |
| U16 | 7 inventory handler stubs (handleScan, handleHistoryGet, handleReviewQueueGet, handleAdminCorrect, handlePrint, handleResolveQueue, handleUpdateItem) | Intentional placeholder - all return "Week 3" / "Week 4" error |
| U17 | dataStore.js orchestrator pattern: Sheets-first-unconditional, PG-conditional. Removing from DUAL_WRITE_TABLES doesn't stop Sheets writes (per cutover.js doc-fix PR #82) | Intentional design; documented limitation |
| U18 | Vendor-add: F19b idempotency at TWO checkpoints (vendor_master col J + vendor_accounts col X). Same UUID checked twice. | Intentional - handles both "new vendor" and "existing vendor + new account link" double-tap |

---

## 6. Schema reality check

For each finance-stack table, what the code reads/writes vs what the briefs document. Live sheet headers verified where possible.

### vendor_master (HUB)

- Brief: 10 columns (vendorId, name, category, website, notes, createdBy, createdAt, lastInvoiceDate, aliases, clientUuid)
- Sheet: 9 labeled headers + col J (client_uuid added later, only on newer rows)
- Code reads `r[0]` through `r[9]`.
- **DEAD col H** (lastInvoiceDate): 0/35 fills. Drop in PG.
- **NEW col J** (clientUuid): present in newer rows only, retrofit. PG: UNIQUE.

PG design:
```
vendors (
  id TEXT PRIMARY KEY,          -- vendorId (keep XXX-NNN format or migrate to uuid)
  name TEXT NOT NULL,
  category TEXT,
  website TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ,
  aliases TEXT[],               -- normalize pipe-string -> array
  client_uuid UUID UNIQUE,      -- F19b
  deleted_at TIMESTAMPTZ        -- soft-delete replaces "DELETED" sentinel
)
```

### vendor_accounts (HUB)

- Brief: 24 columns (rowId compound + 21 fields + col W accountNotes + col X client_uuid)
- Sheet headers (verified live): 22 labeled, cols W and X unlabeled
- Code reads `r[0]` through `r[23]`.
- **DEAD cols N/O/P** (Contact Name/Email/Phone): 0/54. Drop in PG.
- **DEAD col V** (unused, Phase 2 placeholder): 0/54. Drop.
- **PLAINTEXT cols L/M** (portal username/password): per TEAM_KNOWLEDGE, intentional.

PG design:
```
vendor_accounts (
  id UUID PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  account_key TEXT NOT NULL,
  customer_account_num TEXT,
  sales_rep_name, _phone, _email TEXT,
  delivery_days TEXT,
  cutoff_time TEXT,
  delivery_method TEXT,
  portal_url, _username, _password TEXT,  -- plaintext intentional
  payment_terms TEXT,
  min_order TEXT,
  active BOOLEAN DEFAULT true,
  created_by TEXT, created_at TIMESTAMPTZ,
  account_notes TEXT,
  client_uuid UUID UNIQUE,
  UNIQUE (vendor_id, account_key)
)
```

### invoice_submissions_26 (COLLECTION)

- Brief: 23 columns (per INVOICE_CAPTURE Section 3)
- Code `parseSubmissionRow` matches brief.

PG design (largely from SUPABASE_MIGRATION.md):
```
invoice_submissions (
  id UUID PRIMARY KEY,              -- was uuid
  timestamp TIMESTAMPTZ,
  user_email TEXT,
  account_key TEXT,
  vendor TEXT,                      -- display name
  vendor_id TEXT REFERENCES vendors(id),
  invoice_number TEXT,
  invoice_number_normalized TEXT GENERATED ALWAYS AS (...) STORED,
  invoice_date DATE,
  total_amount NUMERIC(12,2),
  gl_breakdown JSONB,
  drive_urls TEXT[],
  page_count INTEGER,
  email_sent BOOLEAN,
  status TEXT CHECK (status IN ('sent','returned','corrected','deleted')),
  status_updated_at TIMESTAMPTZ,
  type TEXT CHECK (type IN ('invoice','credit')),
  raw_drive_url TEXT,
  corrected_from_uuid UUID REFERENCES invoice_submissions(id),
  dupe_override BOOLEAN DEFAULT false,
  -- Rejection metadata to a separate table?
  -- UNIQUE INDEX on (vendor, invoice_number_normalized, invoice_date, total_amount)
  --   WHERE status != 'corrected' AND corrected_from_uuid IS NULL  (F24)
)
```

### AI_LINE_ITEMS (separate spreadsheet, per-account tabs)

- Spreadsheet has 9 account tabs (verified): STL-FL, STL-MO, CIN-OH, TXR-TX-H, TXR-TX-V, TXR-AZ, CIN-AZ, TBR-FL, TBJ-FL. **Subset of 12 directory accounts** - 3 accounts have no invoices yet (CIN-KY/Louisville, TBJ-NY/Buffalo, CORP).
- Schema (LINE_ITEM_HEADERS const): 15 cols.

PG design:
```
ai_line_items (
  id UUID PRIMARY KEY,
  invoice_uuid UUID REFERENCES invoice_submissions(id),
  timestamp TIMESTAMPTZ,
  account_key TEXT,
  vendor TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  line_num INTEGER,
  description TEXT,
  quantity NUMERIC,
  unit TEXT,
  unit_price NUMERIC,
  extended_price NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  category TEXT,
  confidence TEXT,
  raw_json JSONB
)
```

### GL_CODES (separate spreadsheet, per-account tabs)

- Spreadsheet has 14 tabs (verified live): Class Overview, CORP, CIN-AZ(REDS), CIN-KY(LBATS), CIN-OH(CINN), STL-FL, STL-MO, TBJ-FL, TBJ-BUF, TBR-FL, TXR-AZ, TXR-Home, TXR-Vistor (sic), Master Template
- 12 account tabs + Class Overview (master taxonomy) + Master Template
- Per-tab schema: Col A = description, Col B = GL code number. Category headers have empty col B.

PG design:
```
gl_codes (
  id UUID PRIMARY KEY,
  account_key TEXT NOT NULL,
  category TEXT,          -- parsed from header rows
  code TEXT NOT NULL,
  name TEXT,
  active BOOLEAN DEFAULT true,
  UNIQUE (account_key, code)
)
```

### item_catalog (INVENTORY)

- Brief: 19 columns
- Code reads up to `r[18]` (lastVerified).

PG design (lift-and-shift per SMART_INVENTORY brief direction):
```
inventory_items (
  id TEXT PRIMARY KEY,           -- itemId (inv_XXX)
  account_key TEXT NOT NULL,
  name TEXT,
  category TEXT,
  unit TEXT,
  location_id TEXT REFERENCES storage_locations(id),
  primary_vendor TEXT,           -- freeform (decision: FK to vendors? See open question)
  last_price NUMERIC,
  last_price_date DATE,
  last_price_vendor TEXT,
  price_at_last_count NUMERIC,
  active BOOLEAN DEFAULT true,
  linked_to_invoice BOOLEAN,
  is_variety_group BOOLEAN,
  created_by TEXT,
  created_at TIMESTAMPTZ,
  status TEXT,                   -- 'excluded' | 'archived' | NULL
  notes TEXT,
  last_verified DATE
)
```

### storage_locations (INVENTORY)

- Brief: 10 columns (cols 6-7 reserved/empty)
- PG: same minus reserved cols.

### count_sessions (INVENTORY)

- Brief: 14 columns
- PG with GENERATED grand_total = sum of category totals.

### count_items (INVENTORY)

- Brief: 13 columns, append-only ledger
- PG with GENERATED extended_price + index on (session_id, location_id, saved_at DESC).

### price_history, item_aliases, merge_history, review_queue

Per brief, no major drift identified. PG schemas straightforward.

### zone_corrections (INVENTORY)

- **NOT IN BRIEF** - discovered in inventoryActions.js line 746.
- Schema needs live inspection. Open question O3 below.

---

## 7. Multi-writer map

### vendor_master.aliases (col I) - 3 writers

| Writer | When | Where |
|---|---|---|
| handleVendorMasterUpdate | Admin edits aliases field | invoiceActions.js line 1738 |
| learnVendorAlias | After invoice-submit if OCR name novel | invoiceActions.js line 1815, fire-and-forget |
| handleVendorMerge | Merge appends dupe names to keeper | invoiceActions.js line 1895 |

**Synchronization concern:** Race between learnVendorAlias (async post-submit) and a concurrent admin edit. The read-modify-write pattern can drop edits. PG migration normalizes to a `vendor_aliases` table with FK + UNIQUE(alias, vendor_id) to eliminate the race.

### item_catalog - 8+ writers (intranet) + 2 (cron)

| Writer | When | Where |
|---|---|---|
| handleAddItem | Manual add via UI | inventoryActions.js |
| handleVerifyPrice | Manual price verify | inventoryActions.js |
| handleUpdateCatalogItem | Generic field update | inventoryActions.js |
| handleArchiveItem | Soft-delete | inventoryActions.js |
| handleReactivateItem | Un-archive | inventoryActions.js |
| handleExcludeItem | Permanent exclude | inventoryActions.js |
| handleBatchMoveItems | Bulk location move | inventoryActions.js |
| handleMergeItems | Merge keeper update + dupe blank | inventoryActions.js |
| handleCountSubmit | priceAtLastCount snapshot | inventoryActions.js |
| Cron auto-create | New items from invoices | cron index.js |
| Cron dedup (DEDUP=1) | Manual one-shot dedup | cron index.js |

**Synchronization concern:** Cron runs nightly with reads done at start of run. If admin merges items during cron run, cron's merge view is stale. Today: idempotency on invoiceUuid prevents double-processing, but newly-created cron rows could create duplicates of just-merged items. PG migration with UNIQUE on (account_key, normalized_name) constrains the namespace.

### item_aliases - 3 writers

| Writer | When | Where |
|---|---|---|
| handleMergeItems | Append dupe names as aliases | inventoryActions.js |
| handleReviewAccept | Accept AI similarity match | inventoryActions.js |
| Cron auto-learn | High-confidence match | cron index.js |

### price_history - 4 writers

| Writer | When | Where |
|---|---|---|
| handleAddItem | If price > 0 on add | inventoryActions.js |
| handleVerifyPrice | Manual verify | inventoryActions.js |
| handleMergeItems | Remap (rewrite col A to keeper) | inventoryActions.js |
| Cron auto-append | New invoice line item | cron index.js |

**Idempotency boundary:** Cron filters by `invoiceUuid` already in price_history. Intranet writes use different source markers ("manual-add", "manual-verify"). PG migration adds UNIQUE(item_id, source_or_invoice_id).

### merge_history - 3 writers (intranet only)

| Writer | When | Where |
|---|---|---|
| handleMergeItems | Action='merge' | inventoryActions.js |
| handleKeepSeparate | Action='keep_separate' | inventoryActions.js |
| handleExcludeItem | Action='exclude' | inventoryActions.js (with `!A:A` explicit range) |

Cron READS this table (filters action="exclude" to skip), does not write.

### review_queue - 2 writers

| Writer | When | Where |
|---|---|---|
| Cron auto-queue | Confidence 60-89 | cron index.js |
| handleReviewDelete | Remove on admin decision | inventoryActions.js (line 778 also writes merge_history) |

### vendor_master + vendor_accounts on vendor-merge - cross-table atomic concern

`handleVendorMerge` does 3 separate API calls (reassign accounts, blank dupes, append aliases). Not atomic. PG migration wraps in a transaction.

### invoice_submissions_26 - single-writer surface

Only invoiceActions.js writes. No multi-writer concern.

### notification_log (out-of-scope for finance, but worth noting)

3 writers per BUSINESS_NOTES: people-route.js, opsUtils.js (`opsNotify`), cron-daily. Future migration concern.

---

## 8. Critical dependencies

### External systems

| System | Depends on | Verification |
|---|---|---|
| **Bill.com** | Stamped PDF format with real PDF text on summary page | Test actual Bill.com import against a stamped PDF before any stampInvoice.js change |
| **Rippling** | Same as Bill.com | Same |
| **AP email (ap@kitchfix.com)** | sendInvoiceEmail subject + body format + PDF attachment | Send test email to AP after any gmail.js change |
| **Slack #invoice-submissions** | `SLACK_INVOICE_WEBHOOK` block format | Trigger one submit, verify Slack message renders correctly |
| **Slack #vendors** | `SLACK_VENDOR_WEBHOOK` block format | Trigger vendor add, verify |
| **Slack #inventory-recap** | `SLACK_RECAP_WEBHOOK` (cron-side) | Manual cron run with non-zero processed |
| **Google Drive Shared Drive** | SA permission as Content Manager + folder structure year/month/account | Test upload to a new account folder |
| **Anthropic Claude API** | 3-4 calls per invoice submission + nightly cron calls (1 per account per run) | Health: check API quota + cost dashboard |
| **Railway** | Scheduled job at `0 6 * * * UTC`, env vars set in Railway UI | Cron repo manual dispatch |

### Must-not-break invariants

| Invariant | Why | How to verify |
|---|---|---|
| Stamped PDF summary page text-extractable | Bill.com/Rippling parse it | PDF text extraction tool on output |
| Service-account-only writes universal | Per universal pattern (THREESYSTEMS) | grep for user-OAuth helpers - currently vestigial |
| `client_uuid` idempotency on vendor-add + invoice-submit | Prevents double-tap data corruption | Submit same form twice, verify single row |
| `invoiceUuid` filter on cron price_history reads | Prevents double-processing | Re-run cron same day, verify no new rows |
| Cron `accountMatch` startsWith tolerance | Handles short vs full account labels | Drive accountShort + cron output match |
| Email subject uses `\|` separator not `·` | Middot mojibakes | grep gmail.js for middot |
| Account-key format = SPACES ("CIN - OH") | 7,581 cells canonical | Sheet audit on every account-bearing column |
| Plaintext portal credentials surface in vendor-list response | Intentional shift continuity | Confirm vendor-list response shape unchanged at cutover |
| Excluded items never auto-resurrect via cron | Chef-merged items stay excluded | Verify merge_history.action="exclude" rows filter cron |

---

## 9. Open questions

### Schema decisions

| # | Question | Affects |
|---|---|---|
| Q1 | `inventory_items.primary_vendor`: FK to `vendors.id` or freeform text? | Smart Inventory PG schema |
| Q2 | `merge_history.mergedItemIds`: JSONB or normalize to junction table? | Smart Inventory PG schema |
| Q3 | `zone_corrections` schema: what columns? Need live inspection. | NEW table not in brief |
| Q4 | `vendor_master.lastInvoiceDate` (col H, 0/35): drop in PG? Brief says drop. | Vendor PG schema |
| Q5 | Soft-delete: deleted_at TIMESTAMPTZ vs is_deleted BOOLEAN? Brief mentions both styles. | All migrated tables |
| Q6 | Plaintext portal credentials: stay plaintext in PG with RLS, or encrypt at rest? | Vendor PG schema |
| Q7 | `count_items` PK: composite (session, save, item) or surrogate UUID? | Inventory PG schema |
| Q8 | `gl_codes` flat table: parse `parseGLCodes` business rules into PG or migrate raw? | GL_CODES PG migration |

### Business rules

| # | Question | Affects |
|---|---|---|
| BR1 | Should `vendor-merge` get an admin gate now (drift H5) or in a separate PR? | Vendor PR B |
| BR2 | Should the duplicate stamp filename format (drive.js vs invoiceActions.js) be unified now? | Invoice PR B |
| BR3 | Should the 7 stub inventory handlers (Week 3/Week 4) be implemented as part of migration or kept as stubs? | Smart Inventory scope |
| BR4 | Do we migrate the cron-side `dedupExistingCatalog` (DEDUP=1 mode) and intranet-side `handleDedupCatalog`? Both, one, neither (PG constraints replace)? | Cron + Smart Inventory scope |

### Deferred work

| # | Question | Affects |
|---|---|---|
| D1 | `VendorAddModal.js` still imported? Brief says "audit before delete". | Vendor cleanup |
| D2 | `HUB_SHEET_ID` cron env: drop now or keep until next cron change? | Cron migration |
| D3 | Vestigial user-OAuth helpers in sheets.js: keep or remove? | Shared infra cleanup |
| D4 | Two subject encoders in gmail.js: unify now or post-migration? | Invoice migration scope |
| D5 | `dataStore.js` size (1994 LOC, will exceed 3000 with finance modules): split now or after? | Code organization decision |

### Scope decisions

| # | Question | Affects |
|---|---|---|
| S1 | The 5-7 vendor name matching implementations: consolidate during this migration or after? | Migration scope |
| S2 | The 5 `CATEGORIES` constant declarations: unify to one shared constant during PR B vendor rewire? | Vendor migration scope |
| S3 | `accountMatch` rule duplication (cron + intranet): does PG normalization make both obsolete? | Schema decision |

---

## 10. Recommended planning approach

### Order of operations (for the planning artifact)

1. **Design phase first.** PG schemas for all 13+ finance tables (drafted in audit Section 6, finalized in planning):
   - vendors, vendor_accounts (already drafted in SUPABASE_MIGRATION.md)
   - invoice_submissions (drafted, refine indexes)
   - ai_line_items (NEW: per-account tabs become single table)
   - gl_codes (NEW: per-account tabs become single table)
   - inventory_items, storage_locations, count_sessions, count_items (NEW: lift-and-shift)
   - item_aliases, price_history, merge_history, review_queue (NEW)
   - zone_corrections (NEW: discovered in audit, needs live inspection)
   
2. **Vendor first.** Smallest blast radius. Establishes `vendors.id` as the FK other tables point to. Includes:
   - PR A: dataStore.js adapters + PG schema (dormant)
   - PR B: handler rewire in invoiceActions.js vendor section + opsUtils.js fixes (DRIFT H1, H2 - getAllVendors / resolveVendorId)
   - PR B: vendor-merge admin gate fix (DRIFT H5)
   - PR B: CATEGORIES constant unification (DRIFT H3, H4)
   - PR C: backfill (35 + 54 = 89 rows)
   - PR D: vendor-merge atomicity (PG transaction)
   - Cutover sequence: dual-write -> backfill -> per-module READ flag flip

3. **Invoice second.** Depends on vendors. Establishes invoice_submissions.uuid as FK for ai_line_items and price_history. Includes:
   - PR A: dataStore.js adapters + PG schema
   - PR B: invoiceActions.js invoice section rewire (~1500 LOC of handlers)
   - PR B: GL_CODES per-account tab -> single table
   - PR C: backfill (invoice_submissions_26 + GL_CODES + AI_LINE_ITEMS - this is the largest data volume)
   - Cutover sequence: dual-write -> backfill -> per-module flag flip

4. **Smart Inventory third.** Depends on vendors (primary_vendor decision Q1), invoices (ai_line_items FK), accounts/periods (already in PG).
   - PR A: dataStore.js adapters + 8 PG tables
   - PR B: inventoryActions.js rewire (1216 LOC of handlers)
   - PR B: opsUtils.js cache layer removal where unnecessary
   - PR C: backfill (large: 89 vendors + thousands of catalog items + sessions + counts)
   - Smart Inventory is the largest by table count (8 tables)

5. **Cron last.** After all intranet tables are dual-write capable + backfilled.
   - Cron PR 1: dual-write swap (cron helpers write Sheets + PG; reads stay Sheets)
   - Manual Railway deploy + verify dual-write for one nightly cycle
   - Cron PR 2: read swap (PG-only reads, drop Sheets I/O entirely)
   - Final manual Railway deploy

### Estimated total effort

- Schema design: 8-12 hours (13+ tables, FK + constraint decisions)
- Vendor migration (Module 4): 14-20 hours (per Project 3 recon)
- Invoice migration (Module 5): 25-35 hours (largest handler surface)
- Smart Inventory migration (Module 6): 20-30 hours (8 tables, complex orchestrators)
- Cron migration (Module 7): 11-14 hours (per Project 3 cron recon)
- Cross-cutting bug fixes from this audit: 4-6 hours (H1-H5)
- **Total: 82-117 hours** of focused work.

### Anything that needs a decision before further audit

- **Q1 vendor FK on inventory_items**: this decision affects Smart Inventory schema AND vendor migration ordering. If FK = yes, vendor migration must complete (with `vendors.id` populated) before inventory can use it.
- **BR3 stub handler scope**: if stubs implement during migration, scope grows significantly. If kept as stubs, Smart Inventory migration is pure lift-and-shift (per brief).
- **BR4 dedup-catalog migration**: decide before designing PG unique constraints. If PG enforces uniqueness, both intranet and cron dedup modes become obsolete.
- **S1 + S2 consolidation scope**: do we accept the migration grows by another 10-20% to clean up the 5-7 vendor matchers and 5 CATEGORIES constants? Or defer to post-migration cleanup PRs?

---

## End of audit
