# Smart Inventory Data Model

**Source:** INVENTORY Google Sheet (`SHEET_IDS.INVENTORY` in `src/lib/sheets.js`).
**Captured during:** PR #51 — Audit #6, 2026-05-18.
**Purpose:** Input for Stage 1 Supabase schema design. Documents the live schema state observed in code, including the gap between sheet column counts and code-written column counts, plus the migration invariants captured across the audit.

This doc reflects the **code's view** of the schema (what handlers actually read and write), not just the sheet header. Where code writes more columns than the sheet header advertises, both are noted.

---

## How to use this doc at Stage 1 design time

1. Read tab inventory to understand current schema.
2. Read invariants per tab to know what must survive migration.
3. Read cross-cutting patterns for system-wide design decisions.
4. Read open questions for the explicit Stage 1 decision list.
5. Cross-reference `docs/BUSINESS_NOTES.md` for canonical detail.

---

## Tab inventory (10 tabs)

### 1. `item_catalog` — master item list

- **Volume:** ~5,154 rows (as of 2026-05-18).
- **Sheet columns (per header):** 17. **Code-written columns:** 19 (cols 0-18). The 2 extra cols (`reviewStatus` at Q, `lastVerified` at S) are written by handlers but may not appear in the original sheet header; Stage 1 should reconcile.
- **Schema (code-derived):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `itemId` | `inv_<uuid>` per code (NOT `item_<uuid>` as data model spec implied — see F37 under Identity formats) |
  | 1 | B | `account` | Short (`"STL - MO"`) OR full (`"STL - MO - St Louis Cardinals"`) — accountMatch handles both |
  | 2 | C | `name` | |
  | 3 | D | `category` | Enum: Food, Packaging, Supplies, Snacks, Beverages, Uncategorized. catMap fallback to "Food" if missing. |
  | 4 | E | `unit` | Free text; case/each/lb/etc. Pack-size variation drives keep-separate rule (see BUSINESS_NOTES) |
  | 5 | F | `locationId` | FK to `storage_locations.locationId`. Auto-assigned by keyword pattern if empty/orphaned |
  | 6 | G | `primaryVendor` | |
  | 7 | H | `lastPrice` | Denormalized cache of most recent `price_history` row |
  | 8 | I | `lastPriceDate` | Denormalized cache |
  | 9 | J | `lastPriceVendor` | Denormalized cache |
  | 10 | K | `priceAtLastCount` | Denormalized — set at submit time for next-count chip UX |
  | 11 | L | `active` | String `"TRUE"`/`"FALSE"` — sometimes legacy boolean too (dual-type comparison in bootstrap) |
  | 12 | M | `linkedToInvoice` | String `"TRUE"`/`"FALSE"` |
  | 13 | N | `isVarietyGroup` | String `"TRUE"`/`"FALSE"` |
  | 14 | O | `createdBy` | Email; falls back to `"manual"` |
  | 15 | P | `createdAt` | ISO timestamp |
  | 16 | Q | `reviewStatus` | Enum: empty / `"reviewed"` / `"archived"` / `"excluded"` / `"review_deleted"` (PR #51 F36 added the 5th) |
  | 17 | R | `notes` | Max 500 chars (truncated by merge handler) |
  | 18 | S | `lastVerified` | ISO date — set by handleVerifyPrice |

- **Writers:** handleAddItem (creates), handleVerifyPrice (price + lastVerified), handleBatchMoveItems (locationId), handleMergeItems (deactivates merged, copies notes to keeper), handleReviewAccept (name/cat/unit/locationId/reviewStatus), handleReviewDelete (active+reviewStatus per F36 fix), handleExcludeItem, handleArchiveItem, handleReactivateItem, handleUpdateCatalogItem (category, notes), handleDedupCatalog (utility), handleSaveLocations (auto-assign locationId in keyword path), handleCountSubmit (priceAtLastCount).
- **Readers:** bootstrap (4 separate filter passes for active/excluded/archived/itemIds — single SQL query in Postgres), handleCatalogGet (currently unused by UI — separate finding), every action handler does linear scan to find target row.
- **Invariants:**
  - `itemId` is unique within account but the cross-account uniqueness is not enforced (relies on UUID collision-free).
  - `active=FALSE` items are **never hard-deleted** — soft-delete is the universal pattern (see BUSINESS_NOTES "Smart Inventory soft-delete via active=FALSE + reviewStatus").
  - `priceAtLastCount` is the denormalized chip UX field — see BUSINESS_NOTES entry.
- **Stage 1 schema notes:**
  - `itemId` → UUID primary key (drop the `inv_` prefix or formalize as `items.id`).
  - `account` → FK to `accounts.id` (UUID); the dual-label problem (short vs full) disappears.
  - `locationId` → FK to `storage_locations.id`.
  - `active` → BOOLEAN, indexed.
  - `category` → Postgres ENUM `item_category`.
  - `reviewStatus` → Postgres ENUM `item_review_status` (`pending` / `reviewed` / `archived` / `excluded` / `review_deleted`). Backfill empty-string rows to `pending` per BUSINESS_NOTES.
  - `lastPrice` / `lastPriceDate` / `lastPriceVendor` → trigger-maintained from `price_history` (keep denormalized for bootstrap perf).
  - `priceAtLastCount` → trigger-maintained from `count_items` on submit transition (keep denormalized).
  - Composite index on `(account_id, locationId, active)` for the bootstrap hot path.
  - `notes` → keep TEXT with the 500-char application-level cap, OR move to separate `item_notes` table with source attribution per BUSINESS_NOTES "Smart Inventory notes preservation on merge".

### 2. `item_aliases` — name variations linked to canonical items

- **Volume:** ~3,494 rows.
- **Columns (8):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `aliasId` | `alias_<uuid>` |
  | 1 | B | `aliasText` | The variant name (e.g. merged item's original name) |
  | 2 | C | `itemId` | FK to `item_catalog.itemId` (the canonical) |
  | 3 | D | `vendor` | Source vendor for the alias |
  | 4 | E | `confidence` | Number, always `100` in current writes (placeholder for future fuzzy-confidence) |
  | 5 | F | `createdBy` | Email or source tag (`"item_review"`) |
  | 6 | G | `createdAt` | ISO timestamp |
  | 7 | H | `source` | `"item_review"` for merge-created, others TBD |

- **Writers:** handleMergeItems (alias from merged item name → keeper), remap of existing aliases pointing to merged → keeper (F33 fix in this PR converted this to batched writes).
- **Readers:** bootstrap (joins to catalog for display), handleAISimilarityCheck (loads as prompt context), handleDedupCatalog (one-time utility).
- **Stage 1 schema notes:**
  - Becomes `item_aliases` table with FK `item_id` → items + `alias_text` indexed for trigram fuzzy matching.
  - `confidence` is currently dead (always 100); drop or implement.
  - `source` should be ENUM (`merge`, `manual`, `ocr`, `review`).

### 3. `item_sort_order` — schema present, writers/readers unclear

- **Volume:** 3 rows.
- **Columns (5):** present in sheet but no current handler in `inventoryActions.js` writes to or reads from this tab.
- **Status:** Either vestigial (earlier design) or pre-feature (planned writer not yet built). The 3 rows present suggest limited historical use.
- **Stage 1 schema notes:** Investigation needed before migration. Either deprecate (drop the tab) or reconstruct the intended purpose from sheet headers. Possible candidates: per-account or per-category item ordering preferences distinct from storage_locations sortOrder (which is its own column on storage_locations).

### 4. `count_sessions` — count event header rows

- **Volume:** 5 rows.
- **Columns (18 written by code):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `sessionId` | `inv_<uuid>` (shares prefix with itemId — F37) |
  | 1 | B | `account` | |
  | 2 | C | `period` | E.g. P5, P6 |
  | 3 | D | `createdBy` | Chef email |
  | 4 | E | `startedAt` | ISO timestamp |
  | 5 | F | `status` | Enum: `"draft"` / `"submitted"` / `"corrected"` — see BUSINESS_NOTES count session lifecycle |
  | 6 | G | `submittedBy` | Set at submit |
  | 7 | H | `submittedAt` | Set at submit |
  | 8 | I | `totalFood` | Server-recomputed at submit from count_items (NOT client-trusted) |
  | 9 | J | `totalPackaging` | Server-recomputed |
  | 10 | K | `totalSupplies` | Server-recomputed |
  | 11 | L | `totalSnacks` | Server-recomputed |
  | 12 | M | `totalBeverages` | Server-recomputed |
  | 13 | N | `grandTotal` | Server-recomputed |
  | 14-17 | O-R | (empty placeholders) | Reserved cells written as `""` by handleStartSession; not populated by any current handler |

- **Writers:** handleStartSession (creates row with `draft` status + empty placeholders), handleCountSubmit (transitions status + writes totals via 9-cell batch + updates priceAtLastCount on item_catalog).
- **Readers:** bootstrap (filters by status to find lastCount + activeDraft), handleCountSubmit (recomputes totals).
- **Invariants:**
  - status lifecycle: `draft → submitted → corrected` (`"corrected"` reserved; no current handler transitions, intended for future handleAdminCorrect).
  - Totals are server-recomputed at submit (trust-server pattern — see BUSINESS_NOTES).
- **Stage 1 schema notes:**
  - `status` → Postgres ENUM `count_session_status('draft', 'submitted', 'corrected')`.
  - Each `total_*` column → GENERATED column from `SUM(count_items.ext_price)` filtered by category JOIN.
  - Trigger or CHECK to enforce status transitions: `draft → submitted → corrected`, no backward transitions.
  - F34 (idempotency): add `client_uuid UNIQUE` column populated by frontend at session-start click — eliminates double-tap race in Sheets-era pattern.
  - F35 (multi-tab atomic): the submit-time `count_sessions` update + `item_catalog.priceAtLastCount` chunked loop becomes a single TRANSACTION block.

### 5. `count_items` — per-item count rows under a session

- **Volume:** ~145 rows.
- **Columns (13):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `sessionId` | FK to count_sessions |
  | 1 | B | `locationSaveId` | `loc_<uuid>` — **shares prefix with `storage_locations.locationId` (F37-adjacent)** |
  | 2 | C | `itemId` | FK to item_catalog |
  | 3 | D | `quantity` | Numeric |
  | 4 | E | `unit` | Snapshot of item's unit at count time |
  | 5 | F | `priceAtCount` | Snapshot of price at count time |
  | 6 | G | `priceVendor` | Snapshot |
  | 7 | H | `extPrice` | Client-computed `quantity * priceAtCount`, stored to 2 decimals |
  | 8 | I | `locationId` | FK to storage_locations |
  | 9 | J | `email` | Chef who saved this row |
  | 10 | K | `savedAt` | **DEAD COLUMN** — handleCountSave writes savedAt here AND col 11. Only col 11 is ever read. Stage 1 cleanup target. |
  | 11 | L | `savedAt` (canonical) | Read by bootstrap's last-wins-by-locationSaveId logic |
  | 12 | M | `noneOnHand` | String `"TRUE"`/`"FALSE"` |

- **Writers:** handleCountSave (append-only per-save batch, all rows share one `locationSaveId`).
- **Readers:** bootstrap (groups by `locationId`, picks latest `locationSaveId` per location to get "current state"), handleCountSubmit (sums by category for totals).
- **Invariants:**
  - **Append-only with last-wins by `locationSaveId` per `locationId`** (see BUSINESS_NOTES "Smart Inventory append-only count_items").
  - Same shape as `labor_plans` from Audit #3 (latest-row-wins).
  - `extPrice` is client-computed (not server-recomputed). Migration GENERATED column eliminates client trust.
- **Stage 1 schema notes:**
  - Either keep append-only with `DISTINCT ON (session_id, location_id) ORDER BY saved_at DESC` view, OR switch to UPDATE semantics with separate `count_items_audit` table.
  - **Drop the duplicate `savedAt` column at col K** — single source of truth at col L.
  - `extPrice` → GENERATED column `(quantity * price_at_count)::NUMERIC(10,2)`.
  - `noneOnHand` → BOOLEAN.
  - Composite index on `(session_id, location_id, saved_at DESC)` for the bootstrap dedup query.

### 6. `review_queue` — pending matches, arithmetic holds, invoice-level deferrals

- **Volume:** Growing. Inactive in `inventoryActions.js` (handleReviewQueueGet still returns `{success: true, items: []}`); the active writer is the inventory cron (`kitchfix-inventory-cron`). Backfill scripts in `kitchfix-intranet/scripts/` also append for invoice-level holds.
- **Columns (14):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `queueId` | `q_<uuid>` |
  | 1 | B | `lineItemText` | Description from `ai_line_items` |
  | 2 | C | `vendor` | |
  | 3 | D | `invoiceId` | Submission `client_uuid` (matches `li.invoiceUuid` the cron reads from `AI_LINE_ITEMS!A`) |
  | 4 | E | `invoiceDate` | YYYY-MM-DD |
  | 5 | F | `account` | Short or full account label; cron's `accountMatch` handles both |
  | 6 | G | `suggestedMatchId` | Matched `item_catalog.itemId` if Claude proposed one |
  | 7 | H | `suggestedMatchName` | Canonical name proposed by Claude (or fallback `lineItemText`) |
  | 8 | I | `confidence` | 0-100 from Claude |
  | 9 | J | `status` | `'pending'` on write; chef resolver UI flips to `'accepted'` / `'rejected'` |
  | 10 | K | `reviewedBy` | Email of resolver (blank on insert) |
  | 11 | L | `reviewedAt` | ISO timestamp (blank on insert) |
  | 12 | M | `resultItemId` | Resolved `item_catalog.itemId` after the resolver acts (blank on insert) |
  | 13 | N | `reason` | Why this row is in review (enum below) |

- **`reason` (col N) values:**
  - `arithmetic_fail` — per-line `qty * unitPrice` differs from `extendedPrice` beyond `2% * abs(extendedPrice) + 0.01`. Bad OCR; cron does NOT promote this line to `price_history` / `item_catalog`.
  - `low_match_confidence` — Claude returned `action="match"` with confidence below `MATCH_CONFIDENCE_THRESHOLD` (default 90). Line did not promote on this pass; awaits human review.
  - `possible_new` — Claude returned `action="new"` with confidence in [60, 94]; likely a match it didn't quite commit to. Did not promote; awaits human review.
  - `overcount_suspect_reextract` — invoice-level hold. Sum of an invoice's extracted line `extended_price` exceeds its stored `total_amount` by more than 1% (real + fabricated mix). The cron honors these holds in `processAccount` (cron PR #2): all lines of the held invoice are filtered out of `newItems` and skipped from promotion entirely. Their `ai_line_items` rows remain for audit.

- **Writers:** the inventory cron `processAccount` write path (`arithmetic_fail` / `low_match_confidence` / `possible_new`). Backfill scripts in `kitchfix-intranet/scripts/` (`overcount_suspect_reextract`).
- **Readers:** the inventory cron itself reads col N to honor `overcount_suspect_reextract` holds before the Claude matching pass; future chef resolver UI (Module 8) consumes `status='pending'` rows for manual reconciliation.
- **Invariants:**
  - `invoiceId` (col D) is the submission's `client_uuid`, not the PG row id; keys identically to `li.invoiceUuid` the cron reads from `AI_LINE_ITEMS!A`.
  - One row per line item (not per invoice). An overcount-held invoice produces N rows where N is its line count.
  - Reason values are stable contracts the cron filter depends on; new values may be added but existing values must not change meaning.
- **Stage 1 schema notes:** `status` and `reason` become Postgres ENUMs. `invoiceId` becomes FK to `invoice_submissions.id` (cleans up the client_uuid vs row-id distinction at the same time). Index on `(account_id, status)` and `(account_id, reason)` for the cron's hold lookup and the resolver UI's queue pagination. Reviewer fields (K/L/M) populate during chef resolver flows; suggested-match fields (G/H) are write-once at queue-insert time. Per-account isolation is row-level via the FK.

### 7. `storage_locations` — count zones + sub-zones

- **Volume:** ~33 rows.
- **Columns (10):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `locationId` | `loc_<uuid>` (shares prefix with count_items.locationSaveId) |
  | 1 | B | `account` | |
  | 2 | C | `name` | E.g. "Walk-In Cooler", "Dry Storage" |
  | 3 | D | `icon` | UI hint string |
  | 4 | E | `sortOrder` | Integer for UI ordering |
  | 5 | F | `active` | String `"TRUE"`/`"FALSE"` |
  | 6 | G | `createdBy` | Email |
  | 7 | H | `createdAt` | ISO timestamp |
  | 8 | I | `parentLocationId` | Self-FK for sub-zones (NULL for top-level) |
  | 9 | J | `color` | UI hint string |

- **Writers:** handleSaveLocations (bulk save + auto-assign items), handleSaveSortOrder (sortOrder column only), handleAddSubZone, handleUpdateLocation, handleDeactivateLocation. `handleSaveLocations` also writes the column header row at L798 — idempotent but unusual.
- **Readers:** bootstrap (filters active + sorts by sortOrder, builds locations array with sub-zone parent links).
- **Invariants:**
  - Soft-delete via `active=FALSE` (same universal pattern as items).
  - Sub-zones link to parent via `parentLocationId` (self-FK).
  - Auto-assignment keyword patterns map item categories → locations by name match (see BUSINESS_NOTES "Smart Inventory auto-assignment keyword patterns").
- **Stage 1 schema notes:**
  - `parentLocationId` → self-FK with `ON DELETE SET NULL` (parent deactivation should orphan sub-zones, not cascade-delete).
  - `active` → BOOLEAN.
  - Stage 1 should consider promoting `location_type ENUM('cooler', 'freezer', 'dry', 'beverage', 'supplies', 'other')` to a separate column rather than relying on keyword-match against `name`. Auto-assignment becomes `WHERE category_target = location_type`.

### 8. `price_history` — authoritative price log

- **Volume:** ~3,465 rows.
- **Columns (7):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `itemId` | FK to item_catalog |
  | 1 | B | `account` | |
  | 2 | C | `vendor` | |
  | 3 | D | `price` | Numeric |
  | 4 | E | `priceDate` | YYYY-MM-DD string |
  | 5 | F | `source` | Enum: `"manual-add"` / `"manual-verify"` / `"invoice-ocr"` (plus future: `"merge"`) |
  | 6 | G | `timestamp` | ISO ms timestamp |

- **Writers:** handleAddItem (`manual-add`), handleVerifyPrice (`manual-verify`), invoice OCR pipeline (`invoice-ocr` — separate file). handleMergeItems remaps existing rows from merged → keeper itemId (F33 fix batched this).
- **Readers:** bootstrap (movers analysis: most-recent vs second-most-recent per item), bootstrap (`itemPrices` output for catalog detail view, top-6 per item).
- **Invariants:**
  - **`price_history` is the source of truth for prices.** `item_catalog.lastPrice` etc. are denormalized caches.
  - Every price update appends; never updated in place except by merge remapping.
- **Stage 1 schema notes:**
  - Time-series table with index on `(item_id, timestamp DESC)`.
  - `source` → Postgres ENUM `price_source`.
  - Consider partitioning by month or year (5K items × multiple prices/year = 100K+ rows/year).
  - `source_invoice_id` FK NULLABLE for invoice-ocr rows (link back to invoice_submissions).
  - bootstrap's mover query becomes a window function: `LAG(price) OVER (PARTITION BY item_id ORDER BY timestamp DESC)`.

### 9. `merge_history` — catalog decisions audit + AI learning corpus

- **Volume:** ~59 rows.
- **Columns (10):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `mergeId` | `mrg_<uuid>` |
  | 1 | B | `account` | |
  | 2 | C | `timestamp` | ISO |
  | 3 | D | `email` | Actor |
  | 4 | E | `keeperItemId` | OR target itemId for non-merge types |
  | 5 | F | `canonicalName` | OR target itemName for non-merge |
  | 6 | G | `mergedItemIds` | JSON array (empty for non-merge) |
  | 7 | H | `mergedNames` | JSON array (empty for non-merge) |
  | 8 | I | `type` | **Enum (6 values):** `merge`, `keep_separate`, `exclude`, `archive`, `reactivate`, `review_delete` (PR #51 F36 added the 6th) |
  | 9 | J | `reason` | Previously empty/reserved; populated by `review_delete` after PR #51 F36 fix |

- **Writers:** handleMergeItems (`merge`), handleKeepSeparate (`keep_separate`), handleExcludeItem (`exclude`), handleArchiveItem (`archive`), handleReactivateItem (`reactivate`), handleReviewDelete (`review_delete` after F36). Note the column-offset variation between merge writes (uses cols 4-5 for keeper) and keep_separate writes (cols 4-5 empty, uses cols 6-7 for itemIds/itemNames) — Stage 1 should normalize.
- **Readers:** handleAISimilarityCheck (loads last 50 rows for prompt context — see BUSINESS_NOTES "Smart Inventory merge_history as AI learning corpus"), code-level safety filter at L585-603 (rejects AI suggestions overlapping keep_separate decisions).
- **Invariants:**
  - **Irreplaceable corpus.** Deletion destroys all kitchen merge decisions; AI would re-suggest bad merges forever. **Migration must preserve every row.**
  - 6-value type enum encodes operation semantics.
  - Semantic distinction between `archive` and `review_delete` matters for future analytics (see BUSINESS_NOTES entry).
- **Stage 1 schema notes:**
  - Rename to `catalog_decisions` table for clarity (not just merges anymore).
  - `type` → Postgres ENUM `catalog_decision_type('merge', 'keep_separate', 'exclude', 'archive', 'reactivate', 'review_delete')`.
  - `mergedItemIds` JSON → JSONB or separate `catalog_decision_items` join table (FK array).
  - `reason` → TEXT, NULL allowed.
  - Normalize the column-offset between merge and keep_separate writes (currently merge uses cols 4-5 for keeper, keep_separate leaves them empty).
  - Index on `(account_id, timestamp DESC)` for the last-50 prompt query + on `(type, timestamp DESC)` for type-filtered analytics.
  - The AI prompt-context formatter at handleAISimilarityCheck L497-506 currently bins everything that isn't `keep_separate` into the "merged examples" bucket — Stage 1 cleanup should give each type its own prompt-context treatment.

### 10. `zone_corrections` — AI location-guess training corpus

- **Volume:** 1 row (sparse — feature recently added or AI rarely wrong).
- **Columns (9):**

  | Col | Letter | Field | Notes |
  |---|---|---|---|
  | 0 | A | `correctionId` | `zc_<uuid>` |
  | 1 | B | `account` | |
  | 2 | C | `timestamp` | ISO |
  | 3 | D | `email` | Actor |
  | 4 | E | `itemId` | FK to item_catalog |
  | 5 | F | `itemName` | Snapshot at correction time |
  | 6 | G | `aiSuggestedLocationId` | What AI proposed |
  | 7 | H | `chefChoseLocationId` | What chef accepted |
  | 8 | I | `category` | Snapshot of item category |

- **Writers:** handleReviewAccept (only writer; logs when chef-chosen location differs from AI suggestion).
- **Readers:** **None currently.** Write-only corpus intended for future analytics or prompt tuning.
- **Invariants:**
  - Irreplaceable corpus (same rationale as merge_history) — captures the AI's location-guessing error signal.
- **Stage 1 schema notes:**
  - FK to both locations (`ai_suggested_location_id`, `chef_chose_location_id`).
  - Consider snapshotting `ai_suggested_location_name` for forensic queries when locations get renamed/deactivated post-correction.
  - Index on `(account_id, created_at DESC)` for future analytics.

---

## Critical relationships (FK chains)

```
accounts ─┬─→ item_catalog.account
          ├─→ storage_locations.account
          ├─→ count_sessions.account
          └─→ price_history.account (+ merge_history.account, zone_corrections.account, item_aliases (transitive))

item_catalog ─┬─→ item_aliases.itemId (1:N)
              ├─→ count_items.itemId (1:N)
              ├─→ price_history.itemId (1:N — time series)
              ├─→ zone_corrections.itemId (1:N — correction log)
              └─→ merge_history.keeperItemId / mergedItemIds[] (M:N)

storage_locations ─┬─→ item_catalog.locationId (auto-assigned + chef-set)
                   ├─→ storage_locations.parentLocationId (self-FK for sub-zones)
                   ├─→ count_items.locationId
                   └─→ zone_corrections.aiSuggestedLocationId + chefChoseLocationId

count_sessions ─→ count_items.sessionId (1:N — append-only per save)
```

**Stage 1 join hot paths to index:**
- bootstrap: `item_catalog × storage_locations × count_sessions × count_items × review_queue × price_history × item_aliases` (single SQL query replaces 7 parallel reads).
- handleAISimilarityCheck: `item_catalog × item_aliases × merge_history.last_50`.
- handleCountSubmit: `count_items.sessionId × item_catalog.category` for the catMap.

---

## Identity formats (per F37 audit finding)

The original data model spec implied separate prefixes per entity, but the **actual code uses fewer prefixes than expected**, sharing some between conceptually distinct entities:

| Entity | Prefix in code | Format | Notes |
|---|---|---|---|
| sessionId (count_sessions) | `inv_` | `inv_<uuid>` | **Shares prefix with itemId — F37** |
| itemId (item_catalog) | `inv_` | `inv_<uuid>` | **Shares prefix with sessionId — F37** |
| locationId (storage_locations) | `loc_` | `loc_<uuid>` | **Shares prefix with locationSaveId** |
| locationSaveId (count_items col 1) | `loc_` | `loc_<uuid>` | **Shares prefix with locationId** (a different entity — the save-event identifier vs the location identifier) |
| aliasId (item_aliases) | `alias_` | `alias_<uuid>` | Unique prefix |
| mergeId (merge_history) | `mrg_` | `mrg_<uuid>` | Unique prefix (used for all decision types, not just merges) |
| correctionId (zone_corrections) | `zc_` | `zc_<uuid>` | Unique prefix |

**Stage 1 question (see Open questions below):** should the shared prefixes (`inv_` for items+sessions, `loc_` for locations+save-events) be split into distinct prefixes for clarity? Or are they kept as-is since Postgres UUIDs will replace string-prefixed IDs entirely?

---

## Cross-cutting patterns to preserve through migration

Quick reference - see `docs/BUSINESS_NOTES.md` for canonical detail on each pattern.

These patterns recur across multiple tabs and are documented in `docs/BUSINESS_NOTES.md`:

1. **`accountMatch` invariant** — short vs full account labels (BUSINESS_NOTES "Smart Inventory account-label matching"). Dissolves at Stage 1 with FK to accounts table.
2. **Soft-delete via `active=FALSE` + `reviewStatus`** — items NEVER hard-deleted. Preserve as policy in Postgres.
3. **Append-only + last-wins** — count_items, labor_plans share this pattern. Stage 1 either keeps append-only with DISTINCT ON view OR switches to UPDATE with audit table.
4. **Server-recomputes totals on submit** — count_sessions totals are server-computed from count_items. Preserve as Postgres GENERATED columns or triggers. See cross-module BUSINESS_NOTES entry.
5. **Trust-server, not client** — F35 multi-tab atomic concern + F34 idempotency both rely on Sheets-era hacks. Postgres TRANSACTION + UNIQUE constraints solve both structurally.
6. **Denormalized cache columns** — `priceAtLastCount`, `lastPrice`, etc. on item_catalog are caches for bootstrap speed. Keep trigger-maintained in Postgres for the same speed benefit.
7. **AI learning corpora** — `merge_history` (6-value type enum) and `zone_corrections` are irreplaceable training data. Migration must preserve every row.
8. **Pack-size keep-separate rule** — encoded in the AI similarity prompt (>50% price gap with different unit). May become a CHECK constraint in Postgres.

---

## Companion system: Railway cron

The catalog isn't only written by intranet handlers - the nightly Railway cron is the dominant writer (99.96% of catalog items, 99.2% of aliases). See `docs/BUSINESS_NOTES.md` "Railway cron invariants" entry for the cron's writes, attribution patterns, and Stage 1 migration considerations.

The cron's writes follow the same schemas documented above. Idempotency is invoiceUuid-based at the cron level; the data model's UNIQUE constraints on (invoice_uuid, line_num) in a future line_items table replace the application-level membership check at Stage 1.

---

## Open questions for Stage 1 schema design

1. **Identity prefix normalization (F37).** Should `inv_` be split into `item_<uuid>` (item_catalog) vs `session_<uuid>` (count_sessions)? Should `loc_` be split into `loc_<uuid>` (storage_locations) vs `save_<uuid>` (count_items locationSaveId)? Or — since Postgres UUIDs replace the string-prefix scheme entirely — does this question become irrelevant at migration time? Likely moot post-migration since Postgres UUID primary keys replace the string-prefix scheme entirely. The question persists only for migration script design (how do old IDs map to new UUIDs?).

2. **`item_sort_order` tab.** 3 rows present, no current writer in code. Is this vestigial (deprecate) or pre-feature (reconstruct)? Stage 1 should investigate sheet headers to decide.

3. **`review_queue` tab.** 41 rows present, no current writer in code. Is this historical state (drop) or do we want to reinstate the writer for persistence + pagination? Decision affects whether to build a writer at Stage 1 or drop the table.

4. **`count_items` col 10/11 dead-write.** handleCountSave writes `savedAt` to BOTH col K (index 10) AND col L (index 11); only col L is read. Verify against sheet header — is col K supposed to be `createdAt` (first save timestamp) vs col L `updatedAt` (last edit)? Or is this purely a code typo dating back to original implementation? Stage 1 schema should have one timestamp column, not two.

5. **`reviewStatus` empty default backfill.** Items currently in `item_catalog` with empty reviewStatus (the majority — anything created via handleAddItem) need a value at migration time. Backfill all empty rows to `'pending'` (cleaner enum), OR allow NULL as a 6th state meaning "untriaged" (preserves current semantic). Recommended: backfill to `'pending'`.

6. **`merge_history` column-offset normalization.** Merge writes use cols 4-5 for `keeperItemId` / `canonicalName`. Keep_separate writes leave cols 4-5 empty and use cols 6-7 for `itemIds` / `itemNames`. Stage 1 should normalize — either consistent positional schema or move to JSONB payload column for type-specific fields.

7. **Auto-assignment keyword patterns.** Three options for `handleSaveLocations` keyword auto-assign logic post-migration: (a) port as application-layer code, (b) promote `location_type ENUM` column for direct mapping, (c) per-account configurable patterns table. (b) is the recommended default; (a) is the fast port.

8. **`handleCatalogGet` is dead handler.** Surfaced during sub-phase 4 recon — no UI calls action `"catalog"`. Bootstrap returns the catalog inline. Stage 1: either build a UI that uses it OR remove the handler + dispatcher case.

9. **`handleReviewDelete` is wired but uncalled.** F36 fix made it correct, but no UI currently calls action `"review-delete"`. The fix is architecturally valuable for future review-queue UI build-out. Stage 1: confirm the future UI will use this action OR remove the handler.

10. **AI prompt context formatter for merge_history types.** handleAISimilarityCheck L497-506 currently bins all 5 non-`keep_separate` types into the "merged examples" bucket. Stage 1 cleanup: give each type (`exclude`, `archive`, `reactivate`, `review_delete`, `merge`) its own prompt-context treatment to improve AI learning signal quality.

11. **`item_aliases.confidence` is always 100.** Dead field in current writes. Drop or implement fuzzy-confidence scoring (e.g. from Levenshtein distance against the canonical name).

12. ~~**`callClaude` model alias consolidation.** `claude-sonnet-4-20250514` appears in both `invoiceActions.js` and `inventoryActions.js`.~~ **DONE 2026-08-20.** Consolidated to `CLAUDE_SONNET_MODEL` in `src/lib/anthropicModel.js`. See `docs/CONVENTIONS.md` "Anthropic model string" for the single-source pattern.

---

## Source material

This document was assembled from PR #51 Audit #6 cluster-by-cluster recon:
- **Cluster 1 (bootstrap):** account-label matching invariant + dual-type comparison + filter-pass optimization
- **Cluster 2 (count writes):** count session lifecycle + priceAtLastCount denormalization + append-only count_items + F34/F35 deferred + col 10/11 dead-write
- **Cluster 3 (dedup/merge):** pack-size keep-separate + merge_history as AI corpus + notes preservation + F33 fix
- **Cluster 4 (item mgmt):** soft-delete + price_history authoritative log + F37 identity prefix
- **Cluster 5 (review/location):** reviewStatus enum + F36 fix + auto-assignment keyword patterns + zone_corrections corpus

All BUSINESS_NOTES entries cross-referenced in `docs/BUSINESS_NOTES.md` under "Smart Inventory" titles. F-code fixes shipped in PR #51: F33 (handleMergeItems batched remap), F36 (handleReviewDelete reason+email persistence).
