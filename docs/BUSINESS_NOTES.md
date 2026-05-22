# KitchFix Ops Hub - Business Notes

A living reference for niche business knowledge embedded in this codebase. Each note documents a rule, quirk, preference, or historical decision that wouldn't be obvious from reading the code alone.

## Why this exists

This file captures the kind of knowledge that lives in Kevin's head: domain rules, account-specific quirks, stakeholder preferences, calculation methodology, historical context. It exists because:

1. **Migration preservation** - rules that must survive the Supabase migration without silent-failure bugs
2. **Future developer onboarding** - someone joining the project (or future-Kevin in 6 months) shouldn't have to re-derive business logic from code
3. **Single source of truth** - when business rules are documented inconsistently across docs, code comments, and Slack threads, they drift. One place to look prevents drift.

## How to use this file

- **Adding a note:** Append to the relevant section below. Use the template at the bottom.
- **Reading the code:** When you see business logic that surprises you, check here before assuming it's wrong.
- **Migration prep:** Anything marked [PRESERVE THROUGH MIGRATION] must survive Stage 1 schema design.
- **Discovered through audits:** Each Stage 0 audit PR should append rules surfaced by that audit.

---

## Account-level rules

### GL_CODES per-account tab structure
- **What:** GL codes live in a separate Google Sheet (`SHEET_IDS.GL_CODES`) where each account has its own tab. The tab name is resolved via `getGLTabName(accountKey)`. Invoice submissions read the relevant tab to populate the GL code dropdown.
- **Why:** Different accounts have different GL code structures (Cardinals chart of accounts differs from Rangers, etc.). Per-tab isolation prevents code-pollution and lets accounts manage their own GL structure independently.
- **Where:** `src/lib/invoiceActions.js` - `getGLTabName` helper, invoice-bootstrap GL codes load, invoice-submit GL lookup.
- **Documented:** 2026-05-18 during Audit #4+#5 (Phase 1).
- **Migration consideration:** In Postgres, flatten to a single `gl_codes` table with `account_key` FK. Index on `(account_key, code)` for lookups. The `getGLTabName` helper goes away; replaced with `WHERE account_key = $1`. Per-account isolation preserved at the row-filter level.
- **Verification:** After migration, query GL codes for STL-MO. Confirm: same set of codes returned as the legacy STL-MO tab. Add a new code via admin UI. Confirm: visible to STL-MO invoice submissions, NOT visible to TXR-TX-H submissions.

### MLB/MiLB/AAA P3 Auto-Inclusion [PRESERVE THROUGH MIGRATION]
- **What:** MLB, MiLB, and AAA accounts include `P3` in their `activePeriods` array even when no `labor_budgets` row exists for that `account_key + P3` combination. Non-MLB/MiLB/AAA accounts (e.g. PDCs) do not get this special treatment.
- **Why:** P3 is the period when opening inventory submissions happen. Operators need P3 visible in the period dropdown during the opening-inventory window, even before their full labor budget for the season is loaded.
- **Where:** `src/app/api/ops/route.js:717-721` (bootstrap action). Line numbers will shift slightly post help-request deletion in PR #41.
- **Documented:** 2026-05-17 during `/api/ops` dispatcher audit (PR #41).
- **Implementation options post-migration:**
  - (a) Application code (current state) - rule lives in the bootstrap query handler
  - (b) Postgres VIEW joining `accounts × labor_budgets` with conditional P3 union for matching levels
  - (c) Denormalized `active_periods` table populated at account-creation time
- **Schema design decision:** pending (Stage 1)
- **Verification:** when migration ships, manually verify a fresh MLB account with no `labor_budgets` P3 row still has P3 visible in its period dropdown during the opening inventory window.

### Smart Inventory account-label matching (accountMatch helper) [PRESERVE THROUGH MIGRATION]
- **What:** `item_catalog`, `storage_locations`, and several other Smart Inventory tabs may store account labels in either short form (`"STL - MO"`) or full form (`"STL - MO - St Louis Cardinals"`). The `accountMatch(rowAccount, activeAccount)` helper handles this by treating short labels as a prefix match against the full label (`activeAccount.startsWith(rowAccount + " -")`).
- **Why:** Historical data drift. Older Smart Inventory rows were written with short account labels; newer rows use the full label coming from `getAccountConfigs()`. Without `accountMatch`, half the catalog would be invisible to bootstrap on accounts whose label format evolved.
- **Where:** `src/lib/inventoryActions.js:16-20` (helper definition). Called from every Smart Inventory handler that reads or filters by account (bootstrap, catalog-get, count-submit, verify-price, batch-move-items, ai-similarity-check, merge-items, review-accept, review-delete, exclude-item, save-locations, save-sort-order, add-subzone, update-location, deactivate-location, dedup-catalog, update-catalog-item, archive-item, reactivate-item).
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 1: bootstrap recon).
- **Migration consideration:** In Postgres, both short and full labels must resolve to a single account FK (UUID). Two viable approaches: (a) normalize all existing rows to a canonical form (e.g. account_id FK) during the migration backfill, OR (b) preserve a mapping during the dual-write window so both label forms map to the same account_id. Either way, the `accountMatch` helper disappears post-migration — the FK relationship does the work. Stage 1 schema design should add a `WHERE account_id = $1` clause in place of every current `.filter(r => accountMatch(r[1], activeAccount))` call.
- **Verification:** After migration, query for items in account "STL - MO" via the legacy short label - confirm same result set as querying "STL - MO - St Louis Cardinals" via the full label. Then confirm: zero item rows orphaned (no items with NULL account FK). Run an audit query: `SELECT account_id, COUNT(*) FROM item_catalog GROUP BY account_id` - expected count per account should match pre-migration sheet row counts.

### Smart Inventory count session lifecycle [PRESERVE THROUGH MIGRATION]
- **What:** A `count_sessions` row progresses through specific statuses: `"draft"` (created via start-session; count-save appends `count_items` rows under this session) → `"submitted"` (final submit; totals computed server-side, item_catalog priceAtLastCount snapped) → `"corrected"` (admin-corrected after submit; reserved status, no handler currently transitions to it — likely future handleAdminCorrect at L1034).
- **Why:** The status field gates UI behavior. Submitted sessions should be locked from further count_items saves. Corrections are tracked separately. Without this enum, the system can't distinguish in-progress counts from finalized ones, and bootstrap can't pick a single "latest count" cleanly.
- **Where:** `src/lib/inventoryActions.js` - handleStartSession (creates `draft`), handleCountSave (appends count_items under any session), handleCountSubmit (transitions to `submitted`), bootstrap (filters by status to determine `lastCount` vs `activeDraft`).
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 2: count writes).
- **Migration consideration:** In Postgres, `status` should be a Postgres ENUM type: `CREATE TYPE count_session_status AS ENUM ('draft', 'submitted', 'corrected')`. A trigger or CHECK should prevent invalid transitions (e.g. `corrected → draft` not allowed). Submission lock: `count_items` INSERTs should reject when their session_id FK points to a session where `status != 'draft'` (enforce via trigger or app-layer check). The `corrected` status is the only path to mutate a submitted count - this is the structural fix for what handleAdminCorrect was designed to do.
- **Verification:** After migration: (1) create a session, status=draft, append count_items, submit, confirm status=submitted. (2) Attempt to append more count_items to that session - confirm rejected at DB layer. (3) Run admin-correct - confirm status flips to corrected and new totals re-computed. (4) Attempt to submit a corrected session - confirm rejected.

### Smart Inventory priceAtLastCount denormalization [PRESERVE THROUGH MIGRATION]
- **What:** At submit time, `handleCountSubmit` writes `priceAtCount` (the price the chef saw during the count) into `item_catalog` column K (`priceAtLastCount`) for each counted item. This is a denormalized "last value" field that's displayed as a chip in the next count's UI so chefs see what they paid last time.
- **Why:** Chef UX. When starting a new count, seeing "$2.50 last time" anchors expectations and flags price drift. The chip pulls from `item_catalog` directly, not from `price_history` (which would require a separate query per item ≈ 5K lookups on bootstrap).
- **Where:** `src/lib/inventoryActions.js` - handleCountSubmit L286-298 (write loop, chunked 500/batch), bootstrap L48 (read into catalog item.priceAtLastCount).
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 2: count writes).
- **Migration consideration:** In Postgres, two viable approaches: (a) keep as a denormalized column on `items` updated via trigger on count_sessions submit transition; (b) compute via window function from count_items: `SELECT price_at_count FROM count_items WHERE item_id = $1 ORDER BY saved_at DESC LIMIT 1`. The denormalized column approach is ~100ms faster on bootstrap (single column read vs 5K point lookups). The window function is cleaner for data integrity. Stage 1 decision: prefer denormalized column with trigger-maintained update at submit transition. Trade-off documented as recoverable: if the trigger fails, the chip becomes stale but count submission still succeeds.
- **Verification:** After migration, submit a count with priceAtCount=$2.50 for item X. Then open the next count - confirm "$2.50 last time" chip displays correctly. Then query `SELECT price_at_last_count FROM items WHERE item_id = ?` - confirm $2.50. Test partial-fail: simulate trigger error during submit, confirm count still completes but chip shows stale value (recoverable via reconciliation job).

### Smart Inventory append-only count_items with last-wins by locationSaveId [PRESERVE THROUGH MIGRATION]
- **What:** The `count_items` table is append-only. Each `handleCountSave` call appends N rows (one per item in that location) all sharing a single freshly-generated `locationSaveId`. Bootstrap reads `count_items`, groups by `locationId`, and selects the rows whose `locationSaveId` is the latest (by `savedAt` timestamp) as the "current state" of that location's count. If a chef re-counts a location 3 times during a session, all 3 saves persist in the sheet, with the latest winning on read.
- **Why:** Same Sheets-era safety pattern as `labor_plans` (see "Append-only 'latest row wins' for labor_plans"). Append-only writes are safer than row-update (no corruption risk from update bugs). Edit history preserved as a side effect — recoverable from raw sheet rows if needed.
- **Where:** `src/lib/inventoryActions.js` - handleCountSave L219-237 (appends per-save batch with a single locationSaveId), bootstrap L119-143 (groups by locationId, picks latest locationSaveId per location).
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 2: count writes).
- **Migration consideration:** Two viable patterns: (a) keep append-only with `DISTINCT ON (session_id, location_id) ORDER BY saved_at DESC` view providing the "current state" projection. Preserves full edit history. (b) Switch to UPDATE semantics with a separate `count_items_audit` table for history. Cleaner reads, requires explicit audit-trail design. Decision pending Stage 1; same trade-off as labor_plans entry, treat consistently.
- **Verification:** After migration: save a location count (rows appended). Re-count same location with different quantities (more rows appended). Confirm: only the LATEST `locationSaveId`'s rows are returned by the equivalent of bootstrap's read. Query the audit trail and confirm all 2 saves are recoverable for compliance/dispute resolution.

---

## Period rules

*(empty - to be populated as audits find them)*

---

## Calculation methodology

### Inventory submission validation rule
- **What:** A valid inventory submission requires at least one of `food`, `packaging`, or `supplies` to be greater than zero. `snacks` and `beverages` are optional. `total` equals the sum of all five components.
- **Why:** A submission with only `snacks` or `beverages` is not a real inventory event in the KitchFix data model; primary cost categories must be present.
- **Where:** Validation enforced server-side in `src/app/api/ops/route.js` submit-inventory handler post-Audit #2. Mirror client validation in `src/app/ops/components/inventory/InventoryTool.js` `validate()` function.
- **Documented:** 2026-05-17 during Audit #2.
- **Migration consideration:** Stage 1 schema should enforce this as a Postgres CHECK constraint on the `inventory_submissions` table: `CHECK (food > 0 OR packaging > 0 OR supplies > 0)`. The `total` column should be a generated column: `GENERATED ALWAYS AS (food + packaging + supplies + COALESCE(snacks, 0) + COALESCE(beverages, 0)) STORED`. This eliminates the client-trust bug structurally.
- **Verification:** After migration, attempt to insert a row with `food=0 AND packaging=0 AND supplies=0` and confirm Postgres rejects it. Attempt to insert a row with mismatched `total` and confirm Postgres overrides it.

### Server-recomputes totals on submit (trust-server pattern) [PRESERVE THROUGH MIGRATION]
- **What:** Submit handlers that touch money, inventory quantities, or labor totals re-compute totals server-side from the source rows rather than trusting client-supplied totals. The client may display totals for UX, but the server stores its own recomputation as the source of truth. This is a general security/integrity pattern, not specific to any one module.
- **Why:** Client-side totals are user-influenceable (DevTools edit, browser bugs, version drift between client and server). Without server recomputation, a malicious or buggy client could submit `quantity=10 totalAmount=$100` and the server would accept the mismatch. Server recomputation closes this trust gap. Every submit handler that touches financial or count data should follow this pattern.
- **Where:**
  - **Enforced (current):**
    - `src/lib/inventoryActions.js` handleCountSubmit L256-270 - recomputes 5-category totals from count_items rows + catalog category mapping (Smart Inventory).
    - `src/app/api/ops/route.js` submit-inventory handler (post-Audit #2) - computes `total` server-side from food/packaging/supplies/snacks/beverages components.
  - **NOT enforced (documented gap):**
    - `src/app/api/ops/route.js` submit-labor-actuals - client-supplied `budgetEnvelope`, `carryForward`, `actualSpent` are trusted today (flagged in Audit #3 as deferred concern). Currently masked because the chef UI only inputs one field (actualSpent) and the others are server-fetched then echoed back; but if client auto-fill logic is introduced, drift becomes possible.
- **Documented:** 2026-05-17 (Audit #2 + #3 surfaces), 2026-05-18 (PR #51 Audit #6 cluster 2 reinforced as Smart Inventory pattern; promoted to standalone entry for cross-module discoverability).
- **Migration consideration:** In Postgres, GENERATED columns + CHECK constraints provide structural enforcement. Server recomputation becomes a trigger or computed view; client-supplied totals dropped from API payloads entirely. For `count_sessions`: each `category_total_*` becomes a GENERATED column from `SUM(count_items.ext_price)` WHERE category matches. For `labor_plans`: `budgetEnvelope` derived via JOIN from `labor_budgets`, eliminating the client-trust gap structurally.
- **Verification:** After migration, attempt to POST a count submission with manually inflated category totals via raw API call - confirm Postgres' GENERATED column overrides the client value and stored totals match the `count_items` SUM. Same test for inventory submissions. Same for labor actuals once the JOIN-derived budget envelope is in place.

### TXR-V revenue-flex labor budget [PRESERVE THROUGH MIGRATION]
- **What:** The account `TXR - TX - V` (Texas Rangers Visiting) is the only KitchFix MLB account whose labor budget is not a fixed dollar amount. Instead, the labor budget for each homestand is a percentage of that homestand's sold revenue.
- **Mechanism:**
  - The P&L provides a labor ratio (e.g. 19.23%) rather than a dollar budget.
  - In code, the ratio is derived: `laborRatio = budgetEnvelope / forecastedRevenue` (where `budgetEnvelope` and `forecastedRevenue` both come from `HUB.labor_budgets`).
  - After the homestand closes, the chef submits actual sold revenue. The adjusted budget is then computed: `adjustedEnvelope = soldRevenue * laborRatio`.
  - Example: forecast $5,000 revenue with $1,000 budget = 20% ratio. Actual revenue $4,500 → adjusted budget $900 (not the original $1,000).
  - In practice, the derived ratio is constant across all of TXR-V's periods (P4 through P10 all = 0.1923). The code derives it per-homestand to keep the logic uniform, but the ratio could equivalently be stored once as a season-level constant. The Postgres migration design (below) treats this as a single `labor_ratio` value on the `accounts` table - this aligns with operational reality.
- **Why:** Visiting-team food service revenue is variable and depends on event size, opponent draw, weather. The P&L is structured to give visiting kitchens a percentage envelope rather than a fixed budget so that costs scale with revenue.
- **Where:**
  - `src/app/api/ops/route.js` - `REVENUE_FLEX_ACCOUNTS` constant lists revenue-flex accounts. `buildLaborContext` computes the ratio and adjustedEnvelope.
  - `src/app/ops/components/labor/SeasonPlanner.js` - `handleSubmitFlex` is the chef's combo submission (revenue + labor) that bypasses the standard single-submission flow.
- **Documented:** 2026-05-17 during Audit #3 (Season Tracker).
- **Migration consideration:** Move `REVENUE_FLEX_ACCOUNTS` from code constant to a column on the `accounts` table (e.g. `is_revenue_flex` boolean OR a `budget_model` enum with values `fixed` and `revenue_ratio`). In Postgres, the adjusted budget should be a computed column or VIEW: for revenue-flex accounts, `budget = (SELECT sold_revenue FROM labor_sold_revenue WHERE ...) * (labor_ratio FROM labor_budgets)`. The two-stage submission flow (revenue first, then labor) should be a single transaction.
- **Verification:** After migration, for `TXR - TX - V`, submit revenue $4,500 against a homestand with labor_ratio 0.20 - confirm the adjusted budget shown in the chef UI = $900. Then submit $850 actual labor and confirm variance shows +$50.

### Season Tracker streak calculation
- **What:** A chef's "streak" is the count of consecutive homestands ending with the most recent submission where actual labor spent was at or under budget envelope (i.e. variance >= 0).
- **Rules:**
  - Homestands are iterated in **season sequence order** (HS1, HS2, HS3, ..., not submission order).
  - Each homestand contributes to the streak if its variance is >= 0 (on or under budget).
  - A variance < 0 (over budget) resets the streak to 0.
  - The streak displayed is the streak ending at the most recent homestand, NOT the season's longest run.
- **Why:** Streaks are a leaderboard mechanic that rewards consistent on-budget execution. They're meaningful only when computed in chronological homestand order - a chef who submits HS3 first and HS1 last shouldn't get a different streak than one who submits in order.
- **Where:** `src/app/api/ops/route.js` submit-labor-actuals handler computes streak server-side at write time and stores it in the `labor_plans.streak` column. The read path (`buildLaborContext`) trusts the stored value.
- **Documented:** 2026-05-17 during Audit #3 (corrects the prior implementation that iterated in submission order, see PR #44).
- **Migration consideration:** In Postgres, streak can be a window function over the labor_plans table: `SUM(CASE WHEN variance >= 0 THEN 1 ELSE 0 END) OVER (PARTITION BY account ORDER BY homestand_sequence ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`. Alternatively, a generated column maintained by trigger on insert. Decision pending Stage 1.
- **Verification:** After migration, for a chef with submissions in order HS1(+$100), HS2(-$50), HS3(+$200), HS4(+$300), confirm streak = 2 (HS3 and HS4 only). Then submit HS5(+$0) - confirm streak = 3.

### Cut+Dry / "What Chefs Want" invoice-number rule [PRESERVE THROUGH MIGRATION]
- **What:** For invoices from the vendor "Cut+Dry" (also known as "What Chefs Want"), the invoice-number field must be populated with the Reference # from the platform, NOT the Order #. The OCR prompt at `invoiceActions.js:681-682` explicitly instructs the model to handle this special case.
- **Why:** Cut+Dry's vendor portal displays both an Order # (the purchase reference) and a Reference # (the invoice reference). Operationally, AP needs the Reference # because it's what matches the eventual payment record. Using Order # would cause invoice-payment mismatches downstream.
- **Where:** `src/lib/invoiceActions.js:681-682` (in the invoice-ocr handler's prompt text).
- **Documented:** 2026-05-18 during Audit #4+#5 (Phase 3 F32).
- **Migration consideration:** Postgres `invoice_submissions` table should NOT collapse "Order #" and "Reference #" into a generic `invoice_number` field. Either preserve both as separate columns (`order_ref`, `invoice_ref`) with vendor-specific selection logic at write time, OR keep `invoice_number` as the canonical field but document which vendor source it came from. The OCR prompt logic must survive migration of the OCR pipeline.
- **Verification:** After migration, OCR-process a sample Cut+Dry invoice with both Order # and Reference #. Confirm the `invoice_number` stored = Reference #, not Order #. Confirm a downstream payment matching against this row succeeds.

### Invoice duplicate detection rule
- **What:** An invoice is considered a duplicate of an existing submission when ALL FOUR of these match: vendor name (trimmed exact match), normalized invoice number (strip leading `#`/spaces/zeros), invoice date (string exact match), and total amount (within $0.01 to allow for rounding). Submissions with `status="corrected"` or with `correctedFromUuid` set are excluded from the duplicate check (they're intentional resubmissions).
- **Why:** Floor-first protection. Chefs occasionally accidentally re-photograph the same invoice. The 4-criterion match catches genuine duplicates without false-positive-blocking legitimate similar invoices (same vendor, same date, different amount).
- **Where:** `src/lib/invoiceActions.js` - invoice-submit handler dup guard, invoice-duplicate-check handler client-pre-check. Same logic in 2 places.
- **Documented:** 2026-05-18 during Audit #4+#5 (Phase 3 F30).
- **Migration consideration:** In Postgres, this becomes a UNIQUE INDEX with WHERE clause: `CREATE UNIQUE INDEX ON invoice_submissions (vendor, invoice_number_normalized, invoice_date, total_amount) WHERE status != 'corrected' AND corrected_from_uuid IS NULL`. The normalize function moves to a generated column or stored function.
- **Verification:** After migration, submit two identical invoices (same vendor, normalized inv#, date, amount ± $0.005). Confirm Postgres rejects the second. Submit a correction submission with `correctedFromUuid` set. Confirm it succeeds despite matching an existing row.

### Smart Inventory pack-size keep-separate rule [PRESERVE THROUGH MIGRATION]
- **What:** The AI similarity-check prompt has a hard rule: when two items have similar names but DIFFERENT UNITS (e.g. each vs case, pound vs case) AND a large price gap (>50% difference), they are the SAME PRODUCT in DIFFERENT PACK SIZES. The AI must flag them with `type: "keep_separate"` rather than `type: "merge"`. Example from the prompt: "Herb Cilantro Fresh" ($0.80/each) and "Cilantro Bunched" ($29.50/case) = same herb, different formats = keep separate. Vs. "Chicken Breast 10lb" ($35.00/case) and "Chicken Breast 10 LB" ($35.50/case) = same product, same unit = merge.
- **Why:** Merging different pack sizes would corrupt count math. A chef counts 5 "Chicken Breast" thinking each-unit, but the master record was merged with a case-unit price → revenue calculation off by 10-50x. Pack-size separation preserves the unit semantics that drive financial math.
- **Where:** `src/lib/inventoryActions.js` handleAISimilarityCheck L537-541 (the prompt's CRITICAL pack-size rule). Reinforced by code-level safety filter at L585-603 that rejects merge groups overlapping with keep_separate history.
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 3: dedup/merge).
- **Migration consideration:** This rule survives because it's encoded in the AI prompt + code-level filter. If the prompt is ever re-tuned (Anthropic model upgrade, prompt template change), the >50% price gap heuristic must be preserved. Consider lifting the 0.50 threshold to a named constant or config column on `accounts` for per-account tuning. In Postgres, the pack-size distinction becomes a CHECK constraint that prevents merging items with different `unit` AND price ratio outside a tolerance.
- **Verification:** After migration, attempt to merge "Cilantro Fresh" ($0.80/each) with "Cilantro Bunched" ($29.50/case) - confirm rejected with a "different pack sizes" error. Confirm merging "Chicken Breast 10lb @ $35" with "Chicken Breast 10 LB @ $35.50" still succeeds.

### Smart Inventory merge_history as AI learning corpus [PRESERVE THROUGH MIGRATION]
- **What:** The `merge_history` table captures every catalog-mutation decision. Col 9 stores type, currently 6 values: `"merge"`, `"keep_separate"`, `"exclude"`, `"archive"`, `"reactivate"`, `"review_delete"`. The last 50 rows feed back into the AI similarity-check prompt as: (a) examples of decisions to learn from (merged groups → positive examples), and (b) **hard rules of pairs the AI must NEVER flag again** (keep-separate decisions). The kitchen's accumulated decisions become the AI's persistent memory.
  - **Semantic distinction between `archive` and `review_delete`:** Both result in `active=FALSE`, but signal different user intents. `archive` = chef said "we used to buy this but stopped" (clicked Archive in active-catalog UI). `review_delete` = chef said "the AI's suggestion was wrong / this item shouldn't exist" (clicked Delete in the review-queue UI surfacing AI-flagged duplicates). The two flows feed different future analytics: archive measures procurement/catalog hygiene; review_delete is a tuning signal for the AI similarity threshold and prompt.
- **Why:** Without this feedback loop, the AI would suggest the same false-positive merges forever (e.g. proposing "Cilantro Fresh" + "Cilantro Bunched" again next week even though the chef just said keep-separate). The merge_history transforms the AI from stateless suggester to learning system.
- **Where:** `src/lib/inventoryActions.js` handleAISimilarityCheck L489-509 (loads last 50 merge_history rows, formats as prompt context), code-level safety filter L585-603 (rejects AI suggestions that conflict with keep_separate history regardless of what the AI returns). Writes to merge_history happen in handleMergeItems L685 (`merge`), handleKeepSeparate L706 (`keep_separate`), handleExcludeItem L778 (`exclude`), handleArchiveItem L1157 (`archive`), handleReactivateItem L1180 (`reactivate`), handleReviewDelete L758 (`review_delete`, added in PR #51 F36 fix).
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 3: dedup/merge; expanded in cluster 5 to include `review_delete` after F36 fix).
- **Migration consideration:** **The merge_history table is irreplaceable corpus** - deleting or rebuilding it destroys all of the kitchen's prior decisions and the AI would start re-suggesting bad merges. Migration must preserve every row. Postgres design: `merge_decisions` table with `type` enum `('merge', 'keep_separate', 'exclude', 'archive', 'reactivate', 'review_delete')`, foreign keys to keeper/merged items, JSONB for merged_item_ids array, timestamp index for the "last 50" prompt context query. The 50-row limit may become configurable per-account in the future. The AI prompt context formatter at L497-506 currently bins everything that isn't `keep_separate` into the "merged examples" bucket - a separate Stage 1 cleanup should refine this to give each type its own prompt-context treatment (e.g. review_delete decisions could become "AI flagged these but chef said they shouldn't exist" examples).
- **Verification:** After migration, run an AI similarity check. Confirm: groups previously marked `keep_separate` do NOT appear as merge suggestions. Confirm: the prompt context includes the last 50 decisions for the active account. Test the 6 enum values: (1) merge two items, (2) mark a pair keep-separate, (3) exclude an item, (4) archive an active item, (5) reactivate that item, (6) review-delete a review-queue item with a reason. Confirm all 6 rows appear in merge_history with correct type values + the reason in col J (index 9) for review_delete.

### Smart Inventory soft-delete via active=FALSE + reviewStatus [PRESERVE THROUGH MIGRATION]
- **What:** Items in `item_catalog` are NEVER hard-deleted from Smart Inventory. Deactivation uses two columns working together: col L (`active`) set to `"FALSE"`, col Q (`reviewStatus`) set to a reason marker (`"archived"`, `"excluded"`, `"reviewed"`, or `""` for merged-into-keeper). Same pattern applies to `storage_locations` (col F = active flag). Excluded items, archived items, items merged into keepers, deactivated locations - all preserved in the sheet with `active=FALSE`.
- **Why:** Auditability + recovery. (a) Chefs occasionally archive items by accident; reactivate is one click. (b) Historical counts referencing now-deactivated items remain valid - the items still exist in the sheet, just hidden from active UI lists. (c) Forensic investigations ("where did this $400 in inventory go?") need the deactivated item rows. (d) The merge AI learning corpus (see "Smart Inventory merge_history as AI learning corpus") requires that merged items remain queryable.
- **Where:**
  - `item_catalog` active=FALSE set by: `handleArchiveItem` L1153, `handleReviewDelete` L756, `handleExcludeItem` L774, `handleMergeItems` L641 (merged items), `handleDedupCatalog` L1085 (cleanup utility).
  - `storage_locations` active=FALSE set by: `handleDeactivateLocation` L1023, `handleSaveLocations` L864 (removed-from-payload locations).
  - reviewStatus values: `"archived"` (handleArchiveItem), `"excluded"` (handleExcludeItem), `"reviewed"` (handleReviewAccept — confirmed AI-suggested item), `""` empty for merged-into-keeper or default.
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 4: item mgmt).
- **Migration consideration:** In Postgres, replace dual-string columns with timestamp soft-delete fields: `deleted_at TIMESTAMPTZ`, `archived_at TIMESTAMPTZ`, `excluded_at TIMESTAMPTZ`. Filter active items via `WHERE deleted_at IS NULL AND archived_at IS NULL AND excluded_at IS NULL` (or use a partial index + computed `is_active` column). The reviewStatus enum becomes a proper Postgres ENUM: `CREATE TYPE item_review_status AS ENUM ('pending', 'reviewed', 'archived', 'excluded', 'merged')`. **The "no hard-delete" rule must survive migration** - chef-driven deactivation must remain recoverable. RLS or trigger should block hard `DELETE` from items table; only the migration scripts themselves should bypass.
- **Verification:** After migration, archive an item. Confirm: item disappears from active catalog list. Reactivate. Confirm: item reappears with all original fields intact (notes, price history, locationId). Try a hard `DELETE FROM items WHERE id = ?` via raw SQL - confirm rejected by policy. Query for archived items - confirm queryable for forensics view.

### Smart Inventory reviewStatus column [PRESERVE THROUGH MIGRATION]
- **What:** `item_catalog` column Q (`reviewStatus`) is a categorical state field that classifies an item's review/deactivation context. 5 distinct values are written across handlers; a sixth "implicit" state is the empty string (for items that have never been through any review/deactivation flow). The full enum, with handler attribution and semantic meaning:
  - `""` (empty/default): Item created via handleAddItem or backfilled migration row; never been reviewed or deactivated. Active in catalog.
  - `"reviewed"`: Set by handleReviewAccept (L740). Chef confirmed an AI-suggested item from the review queue. Item is active in catalog with reviewStatus marking it as human-verified.
  - `"archived"`: Set by handleArchiveItem (L1155). Chef said "we used to buy this but stopped." Paired with active=FALSE. Reactivatable via handleReactivateItem (which clears reviewStatus back to empty).
  - `"excluded"`: Set by handleExcludeItem (L775). Chef said "this item should never appear in counts" (e.g. item created by mistake, vendor sample). Paired with active=FALSE.
  - `"review_deleted"`: Set by handleReviewDelete (L767, added in PR #51 F36 fix). Chef rejected an AI-flagged duplicate from the review queue, meaning "the AI's suggestion was wrong." Paired with active=FALSE. Semantically distinct from `archived` (see "Smart Inventory merge_history as AI learning corpus" entry for the archive-vs-review_delete distinction).
- **Why:** The reviewStatus field exists to disambiguate WHY an item is deactivated. Without it, querying for "all currently-inactive items" gives a mixed bag — merged-into-keeper items + chef-archived items + admin-excluded items + AI-rejected items. Forensic queries ("how often does the AI similarity check produce actionable results?") need to distinguish these flows. Bootstrap surfaces archived items as a separate UI list at L65-75 (so chefs can review/reactivate); excluded items live in their own list at L61-63. Empty-reviewStatus active items are the "normal" working set.
- **Where:** `src/lib/inventoryActions.js` writes the column at: handleReviewAccept L740 (`reviewed`), handleArchiveItem L1155 (`archived`), handleExcludeItem L775 (`excluded`), handleReviewDelete L767 (`review_deleted`). Reads happen in bootstrap L62 (filters `=== "excluded"`) and L66 (filters `=== "archived"`). handleReactivateItem L1178 clears the column back to empty.
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 5: surfaced during F36 fix when handleReviewDelete needed a reviewStatus value distinct from `archived`).
- **Migration consideration:** In Postgres, this becomes a proper ENUM type: `CREATE TYPE item_review_status AS ENUM ('pending', 'reviewed', 'archived', 'excluded', 'review_deleted')` — note `pending` replaces the empty-string default for explicit modeling. **Backfill decision required:** items currently in `item_catalog` with empty reviewStatus (the majority of rows — anything created via handleAddItem) need a value at migration time. Two options: (a) backfill all empty-reviewStatus rows with `'pending'`, OR (b) allow NULL as a 6th state meaning "untriaged." Option (a) is cleaner for queryability and matches the typical Postgres enum pattern; Option (b) preserves the current "empty means default" semantic. Stage 1 should pick (a). The corresponding application-layer change: handleAddItem starts writing `pending` explicitly instead of relying on the empty default. The pair-with-active-flag pattern documented in "Smart Inventory soft-delete via active=FALSE + reviewStatus" should also be revisited — Postgres CHECK constraint could enforce `(active = TRUE AND review_status IN ('pending', 'reviewed')) OR (active = FALSE AND review_status IN ('archived', 'excluded', 'review_deleted'))`.
- **Verification:** After migration, query for items in each reviewStatus state: `SELECT review_status, COUNT(*) FROM items GROUP BY review_status`. Confirm: counts match pre-migration sheet row counts per state, with empty-string rows folded into `pending`. Then: archive an item, confirm `review_status = 'archived'`. Reactivate it, confirm `review_status = 'pending'` (NOT empty/NULL). Run review-delete on a queue item, confirm `review_status = 'review_deleted'` and the active flag is FALSE.

### Smart Inventory auto-assignment keyword patterns [PRESERVE THROUGH MIGRATION]
- **What:** `handleSaveLocations` runs an auto-assign step after saving locations: for each item in `item_catalog` with an empty, keyword-shaped, or orphaned `locationId`, the system assigns a real location by matching the item's category against a 5-keyword pattern dictionary (`KEYWORD_PATTERNS` at L869-875). Patterns: `cooler` (matches "cool", "refrig", "reach-in", "walk-in c", "fridge"), `freezer` ("freez", "frost"), `dry` ("dry", "pantry", "shelf", "storage room"), `beverage` ("bev", "bar", "drink"), `supplies` ("supply", "suppli", "clean", "chem", "janitor", "paper"). Category-to-keyword mapping (L926-931): Food → cooler, Beverages → beverage, Packaging+Supplies → supplies, Snacks → dry, default → dry.
- **Why:** Chefs add items to the catalog faster than they configure locations. Without auto-assignment, every new item would land with no location and the UI would treat them as orphans. The keyword patterns let new locations get auto-populated with the right items as soon as the chef defines storage zones with recognizable names. The fuzzy `name.toLowerCase().includes(pattern)` match handles variations like "Walk-In Cooler #2" or "Bev Cooler" without requiring exact names.
- **Where:** `src/lib/inventoryActions.js` handleSaveLocations L868-939. The KEYWORD_PATTERNS dictionary, the matchKeywordToLocation closure, the category-to-keyword mapping, and the loop applying real location IDs to item_catalog.
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 5: review queue + location).
- **Migration consideration:** In Postgres, this becomes one of three patterns: (a) **Application-layer port** — keep the keyword dictionary and matching logic in code, run on location save. Simplest. (b) **Location-type tagging** — add `location_type ENUM ('cooler', 'freezer', 'dry', 'beverage', 'supplies', 'other')` column to storage_locations, set during admin setup. Items auto-assign via category-to-type mapping. Cleaner querying. (c) **Per-account configurable patterns** — promote KEYWORD_PATTERNS to a `location_patterns` table so each account can tune. Highest flexibility, may not be needed at current scale. Stage 1 should default to (b). The 5-category enum (cooler/freezer/dry/beverage/supplies) is the canonical taxonomy and should survive even if patterns become data-driven.
- **Verification:** After migration: create a new storage location called "Reach-In Cooler 3" (keyword match: cooler). Create an item with category Food and empty location. Run save-locations (or equivalent migration trigger). Confirm item now points at the cooler. Repeat for each category: Food → cooler, Beverages → beverage, Snacks → dry, Packaging → supplies. Test orphan recovery: deactivate a location, confirm items previously pointing at it get re-assigned by category, not left orphaned.

### Smart Inventory zone_corrections feedback loop [PRESERVE THROUGH MIGRATION]
- **What:** When a chef accepts an AI-suggested item from the review queue via `handleReviewAccept`, the handler logs a row to the `zone_corrections` table if the chef's chosen `locationId` differs from the AI's originally-suggested location (catalog col F at AI-creation time). Schema: `[correctionId, account, timestamp, email, itemId, itemName, aiSuggested, chefChose, category]`. The table captures every instance where the AI's location guess was wrong AND the chef corrected it.
- **Why:** This is the AI's location-guessing training signal. The AI similarity check + review queue surface auto-categorized items with proposed locations, but the AI's location guess is statistically weaker than its name-similarity guess. Logging every correction gives Stage 2 (or a future prompt-tuning pass) a corpus to either: (a) improve the AI's location prompt with kitchen-specific examples, (b) train a small classifier on category + name patterns → location, (c) flag items the AI tends to get wrong for special handling.
- **Where:** `src/lib/inventoryActions.js` handleReviewAccept L730-737 (the only writer). No reader yet — this is a write-only learning corpus today, intended for future analytics/training consumption.
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 5: review queue + location).
- **Migration consideration:** In Postgres, becomes a properly-typed table: `(id UUID PK, account_id FK, created_at TIMESTAMPTZ, user_email TEXT, item_id FK, item_name_at_time TEXT, ai_suggested_location_id FK, chef_chose_location_id FK, category TEXT)`. Index on `(account_id, created_at DESC)` for future analytics queries. **The table is irreplaceable corpus** — same preservation rationale as merge_history. The "ai_suggested" location ID should reference the location at the time the AI suggested it (even if that location has since been renamed or deactivated), so consider denormalizing `ai_suggested_location_name` as a snapshot.
- **Verification:** After migration: trigger an AI similarity check that surfaces a new item with category Food. Confirm AI suggests a Food-typical location (e.g. cooler). In the review queue UI, accept the item but override to a different location (e.g. dry storage). Query zone_corrections - confirm exactly one new row with ai_suggested ≠ chef_chose. Then accept another item where the AI's location is correct - confirm NO zone_corrections row added.

### Smart Inventory price_history as authoritative price log [PRESERVE THROUGH MIGRATION]
- **What:** Every price update to an item appends a new row to `price_history` with a `source` field (col F). Source values include: `"manual-add"` (chef added a new item with initial price via handleAddItem), `"manual-verify"` (chef verified existing price via handleVerifyPrice), `"invoice-ocr"` (price detected by invoice scan AI), `"merge"` (inherited during merge). The `item_catalog` columns `lastPrice` (col H), `lastPriceDate` (col I), `lastPriceVendor` (col J) are DENORMALIZED CACHES of the most recent `price_history` row for display speed; **`price_history` is the source of truth**.
- **Why:** (a) **Price drift analysis** - bootstrap's "Top Price Movers" panel compares most-recent vs second-most-recent price_history rows per item. Without historical rows, this view is impossible. (b) **Disputes / audit** - chefs need to defend purchase decisions ("vendor charged us $X.YY last week" → check price_history). (c) **Future Stage 2 corpus** - AI purchasing recommendations need full price-by-vendor history per item.
- **Where:** Writes: `handleAddItem` L358-361 (manual-add), `handleVerifyPrice` L386-388 (manual-verify), invoice OCR pipeline (separate). Reads: bootstrap L149-170 (movers calculation), bootstrap L186-187 (`itemPrices` output for catalog detail view, top-6 per item).
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 4: item mgmt).
- **Migration consideration:** In Postgres, `price_history` becomes a properly-indexed time-series table: `(item_id FK, account_id FK, vendor_id FK, price NUMERIC(10,4), price_date DATE, source TEXT, timestamp TIMESTAMPTZ, source_invoice_id FK NULLABLE)`. Index on `(item_id, timestamp DESC)` for the latest-price lookup + the movers analysis. The source field should be an ENUM: `CREATE TYPE price_source AS ENUM ('manual-add', 'manual-verify', 'invoice-ocr', 'merge')`. Consider partitioning by month or year as corpus grows (~5K items × multiple prices/year = 100K+ rows/year). The denormalized `lastPrice` columns on items become MATERIALIZED VIEW or trigger-maintained for backward-compat with bootstrap.
- **Verification:** After migration: (1) add a new item with price $10 via API (manual-add). (2) Verify it at $11 (manual-verify). (3) Mark a third price via invoice OCR at $12. Query price_history for the item - confirm 3 rows with correct sources and timestamps in order. Confirm `items.last_price` materialized field = $12 (latest).

### Smart Inventory notes preservation on merge [PRESERVE THROUGH MIGRATION]
- **What:** When `handleMergeItems` merges items into a keeper, any notes on the merged items (col R / index 17 in item_catalog) are APPENDED to the keeper's notes with a `[Merged from <name>]:` prefix. Truncated to 500 chars total. The code comment at L669 explicitly marks this as a "locked decision: preserve notes" — not a casual default.
- **Why:** Notes on items often capture vendor-specific quirks, allergen info, prep instructions, sourcing notes. Discarding them during a merge would silently lose tribal knowledge that the chef may have accumulated over many counts. Appending preserves the history; truncation prevents unbounded growth.
- **Where:** `src/lib/inventoryActions.js` handleMergeItems L669-678. The 500-char cap is hardcoded.
- **Documented:** 2026-05-18 during PR #51 Audit #6 (cluster 3: dedup/merge).
- **Migration consideration:** In Postgres, this behavior should survive. Two options: (a) keep as application-layer concat (current behavior, port directly), (b) move to a separate `item_notes` table with FK to item + free-text + source ("manual", "merge-from-XXX"). Option (b) is cleaner for queryability and removes the 500-char truncation, but adds a JOIN to bootstrap. Decision pending Stage 1.
- **Verification:** After migration, create item A with notes "ABC vendor only". Create item B with notes "XYZ allergen". Merge B into A. Confirm A's notes are now `"ABC vendor only\n[Merged from B]: XYZ allergen"`.

### Vendor alias auto-learning from OCR
- **What:** When the OCR pipeline detects a vendor name on an invoice that matches an existing vendor_master row via `fuzzyMatchVendor`, the OCR'd name is appended to that vendor's aliases column (pipe-separated). Subsequent OCR passes match faster because the alias improves future fuzzy matches.
- **Why:** Vendors print their names inconsistently on invoices (legal name vs DBA, abbreviations, formatting). Building an alias dictionary over time eliminates repeated false-mismatches.
- **Where:** `src/lib/invoiceActions.js` - `learnVendorAlias` helper, called from invoice-submit's alias-auto-learn block.
- **Documented:** 2026-05-18 during Audit #4+#5 (Phase 3 F33).
- **Migration consideration:** In Postgres, aliases should be a separate `vendor_aliases` table (`vendor_id` FK + `alias` text + `first_seen_at` + `source = 'ocr' | 'manual'`), or a `TEXT[]` array column on `vendors`. Either supports better querying than the pipe-separated string. The auto-learning behavior should be preserved as a trigger or service-layer hook.
- **Verification:** After migration, OCR-process an invoice from a known vendor with an unusual name variation (e.g. "ABC Foods, Inc." when vendor_master has "ABC Foods"). Confirm the variation gets added to that vendor's aliases. Subsequent OCR pass should match faster.

---

## Vendor-specific patterns

*(empty - to be populated as audits find them)*

---

## Stakeholder preferences

### Inventory submission AP fanout [PRESERVE THROUGH MIGRATION]
- **What:** Every `submit-inventory` triggers a 3-channel fanout: bell notification to submitter, HTML email to `ap@kitchfix.com` (cc submitter), Slack post to `#opshub-inventory-submissions`.
- **Why:** AP does not read the COLLECTION sheet directly. The email to `ap@kitchfix.com` is the handoff channel - it is how AP receives inventory submissions for accounting entry. Loss of this email means AP does not know an inventory event happened.
- **Where:** `src/app/api/ops/route.js` submit-inventory handler (post-Audit #2 line numbers shift; search `action === "submit-inventory"`)
- **Documented:** 2026-05-17 during Audit #2 (inventory submission flow).
- **Migration consideration:** Post-Postgres, AP could read the table directly via a dashboard or scheduled report. The email path could become optional/configurable. Until that flip is explicitly designed and shipped, the email path must be preserved through migration.
- **Verification:** Submit a test inventory row post-migration. Confirm `ap@kitchfix.com` receives the formatted HTML email within 30 seconds.

### Fail-open AI integrations (floor-first design)
- **What:** Three AI integrations in invoice-submit fail OPEN (allow submission to proceed) when the Anthropic API fails or returns unexpected data: `invoice-photo-gate` (document type detection), `invoice-consistency-check` (multi-page consistency), and Drive upload / Gmail send failures inside invoice-submit. Only sheet append failures hard-block. Partial-success counts as success and falls through to next stage.
- **Why:** Floor-first design philosophy. A chef in a walk-in cooler with wet hands cannot have their submission blocked because Anthropic's API is rate-limiting or Gmail had a transient hiccup. The recovery path is: sheet row exists + Slack notification + manual cleanup. Hard-blocking on every AI/Drive/Gmail failure would create a much worse user experience than allowing occasional degraded artifacts.
- **Where:** `src/lib/invoiceActions.js` - `handleInvoicePost`. Multiple try/catch wrappers at the AI / Drive / Gmail boundaries, with `console.warn` on failure and falls-through-to-next.
- **Documented:** 2026-05-18 during Audit #4+#5 (Phase 3 F21/F22/F29).
- **Migration consideration:** Postgres migration MUST NOT "tighten error handling" by adding hard-blocking on AI/Drive/Gmail failures. The fail-open behavior is the intent, not a bug. Future refactors should preserve it explicitly. Consider documenting the recovery path (Slack notification → admin manual cleanup) as a runbook.
- **Verification:** After migration, simulate an Anthropic API failure during invoice-photo-gate. Confirm: submission succeeds, `isWarning` is set true in the result, chef sees a non-blocking advisory, sheet row appears. Then simulate Drive upload failure during invoice-submit. Confirm: submission succeeds, sheet row appears with empty Drive URL, Slack notification fires.

---

## Historical context

### Append-only "latest row wins" for labor_plans
- **What:** The `COLLECTION.labor_plans` table is append-only. Every chef submission - including edits to a previously-submitted homestand - creates a new row rather than updating an existing one. Reads dedupe by taking the latest row per (account, homestand) combo (`.pop()` pattern in code).
- **Why:** Append-only writes are safer in a Sheets context (no risk of corrupting historical data via row-update bugs). Edit history is preserved as a side effect - if a chef revises P5 numbers three times, all three submissions are in the sheet, with the most recent one winning on read.
- **Where:** `src/app/api/ops/route.js` - submit-labor-actuals appends; buildLaborContext reads via `plans.filter((pl) => pl.homestandId === hsId).pop()`. Same pattern applies to `labor_sold_revenue` and `deep_clean_days`.
- **Documented:** 2026-05-17 during Audit #3.
- **Migration consideration:** In Postgres, two viable patterns:
  - (a) Keep append-only with a `latest_per_homestand` VIEW that uses `DISTINCT ON (account, homestand_id) ORDER BY created_at DESC`. Preserves full edit history.
  - (b) Switch to UPDATE semantics with a separate `labor_plans_audit` table for history. Cleaner reads, requires explicit audit trail design.
  - Decision pending Stage 1.
- **Verification:** After migration, submit an edit to a previously-submitted homestand. Confirm: the displayed values reflect the edit (latest wins), AND the prior version is recoverable from the audit trail or full table scan.

### F25 client-UUID idempotency race window (Stage 1 atomicity target)
- **What:** F25 idempotency in invoice-submit and F19b in vendor-add use a read-then-write pattern: read the sheet to check for existing UUID, then append the new row if not found. This is NOT atomic. If two requests arrive within the sub-second window before the first request's append is visible to the second request's read, both can pass the check and create duplicate rows.
- **Why:** Sheets-era constraint. Sheets API has no UNIQUE constraint or compare-and-swap primitive. The race window is small (<1s typically) and chef double-tap UX is 1-3s, so practical risk is low. Floor-first lens: a single duplicate row from a true race is recoverable; a more defensive locking pattern would slow every legitimate submission.
- **Where:** `src/lib/invoiceActions.js` - invoice-submit F25 check, vendor-add F19b checks at `vendor_master` and `vendor_accounts`.
- **Documented:** 2026-05-18 during Audit #4+#5 (sub-phase 6 self-disclosure during patch review).
- **Migration consideration:** Postgres UNIQUE constraint on the idempotency UUID column eliminates the race entirely. Schema design: `ALTER TABLE invoice_submissions ADD CONSTRAINT unique_client_uuid UNIQUE (client_uuid)`. Same for `vendor_master` and `vendor_accounts`. The read-then-write check becomes redundant once Postgres enforces uniqueness at write time.
- **Verification:** After migration, simulate two parallel requests with the same `client_uuid`. Confirm one succeeds, the other receives a constraint-violation error which the application layer translates to `{success: true, deduplicated: true}`.

### AI invoice line-item collection (Smart Inventory corpus)
- **What:** Every successful invoice submission triggers an AI line-item extraction via `triggerAIScan`. Results are written to the `AI_LINE_ITEMS` spreadsheet (one tab per account, 9 tabs as of 2026-05-18). Schema: invoice UUID (FK) + timestamp, account, vendor, invoice #, invoice date, line #, item description, quantity, unit, unit price, extended price, AI category (10-bucket enum: produce, dry_goods, protein, dairy, other, beverage, supplies, packaging, cleaning, smallwares), confidence (currently always "high" in practice), and raw JSON for fallback. As of 2026-05-18, ~3,800 line items collected across all accounts spanning ~2 months of operations.
- **Why:** This corpus is the substrate for the future Smart Inventory feature - per-account purchase frequency analysis, anomaly detection, "what does this account typically buy" pattern matching. Also serves invoice-level reporting (what categories are we spending in, by account).
- **Where:** `src/lib/invoiceActions.js` - `triggerAIScan` + `ensureLineItemTab` (both out of scope for Audit #4+#5 - still use user-OAuth, follow-up PR scoped). `AI_LINE_ITEMS` spreadsheet ID stored as `SHEET_IDS.AI_LINE_ITEMS`.
- **Documented:** 2026-05-18 during Audit #4+#5 (sub-phase 7, surfaced via Kevin's review of the AI corpus mid-audit).
- **Migration consideration:** Becomes `invoice_line_items` table FK'd to `invoice_submissions` (UUID). The 10 categories should be a Postgres enum or FK to a `categories` lookup. Unit standardization is a Stage 1 cleanup target - currently has `ea` (10 rows) drift from `each` (385 rows), plus `other` (59 rows) as a unit fallback when the AI can't parse. The `confidence` column is currently a stored constant ("high" for all 3,803 rows surveyed) - either AI genuinely high-confidence on structured OCR, or threshold filters low-confidence rows out before write. Stage 1: drop the confidence column OR re-implement as real signal.
- **Verification:** After migration, query "all produce line items for CIN-OH in the last 30 days." Confirm count matches the `produce` rows in the CIN-OH tab for the same date range.

### Railway cron invariants [PRESERVE THROUGH MIGRATION]

- **What:** Nightly cron job at https://github.com/KitchFix-Intranet/kitchfix-inventory-cron processes invoice line items from AI_LINE_ITEMS into the INVENTORY catalog. Runs once per day at midnight CT on Railway infrastructure. Single index.js file, ~720 lines.
- **Production impact:** 99.96% of inventory catalog items (2361 of 2362) are cron-created. 99.2% of aliases (3597 of 3627) are cron-created. The cron is the workhorse of the catalog system, not a peripheral tool.
- **Why:** Invoices upload faster than chefs could manually categorize. The cron's nightly AI pass keeps the catalog growing automatically while preserving chef override authority via the review_queue + merge_history.
- **Invariants that must survive migration:**
  1. **Idempotency via invoiceUuid + price_history membership check.** The cron skips line items whose invoiceUuid is already present in price_history (any row, any item). Safe to re-run. Postgres equivalent: UNIQUE constraint on (invoice_uuid, line_num) in line_items table.
  2. **Append-only writes to 4 tabs** (item_catalog, item_aliases, price_history, review_queue). Never updates existing rows, never deletes. EXCEPT: DEDUP=1 mode mutates by deactivating items + remapping references. DEDUP mode is the one mutation path.
  3. **Per-account error isolation + per-batch error isolation within accounts.** If one account's Claude call fails, others continue. If one batch within an account fails, other batches continue. Postgres equivalent: per-batch transactions with savepoints.
  4. **Two attribution patterns:** "ai_cron" for direct catalog/alias creates (3380 alias rows), "ai_cron_batch" for batch_match alias creates where Claude detected within-batch duplicates (217 alias rows). These distinguish two different code paths.
  5. **MATCH_CONFIDENCE_THRESHOLD as the only tunable** (env var, default 90). Anything Claude scores at or above auto-approves to catalog. Anything below queues for chef review.
  6. **Single-pass Claude prompt** does normalization + category mapping + variety grouping + matching + dedup. The prompt itself is critical infrastructure - JSON contract changes break the cron silently with no schema validation.
- **Where:** kitchfix-inventory-cron repo, index.js. Key functions: readTab (line 51), callClaude (line 122), processAccount (line 220), dedupExistingCatalog (line 582).
- **Documented:** 2026-05-19 during Railway cron audit-as-documentation pass.
- **Migration consideration:** The cron's nightly job becomes a Supabase Edge Function or scheduled job running on the same nightly cadence. The Claude prompt migrates 1:1 (it doesn't care about the storage layer). The Sheets-specific patterns (column-A anchor at "tab!A1", invoiceUuid string-membership check) become Postgres-native (INSERT...ON CONFLICT DO NOTHING using UNIQUE constraints). The DEDUP mode becomes obsolete (Postgres CHECK constraints catch duplicates at write time).
- **Verification post-migration:** Run nightly cron equivalent on Supabase. Confirm: same invoiceUuids processed (no duplicates inserted), same review_queue population, same attribution patterns preserved, MATCH_CONFIDENCE_THRESHOLD tunable still functional.

### Railway cron F-codes (F43-F49) - documented, not fixed [LOW PRIORITY]

The following F-codes were identified during 2026-05-19 audit-as-documentation pass. All are theoretical risks with no observable production impact across 408 invoices processed.

- **F43 - Description-row filter fragility.** readTab at line 61 uses hardcoded string prefix matching ("One row", "Multiple", "Every ", "Per-account", "Append-only", "Pending") to skip description rows. Risk: a real catalog item starting with these prefixes would be silently dropped. Evidence: zero rows in production data have these prefixes. No fix needed unless real data later contains these prefixes.
- **F44 - No retry on Claude API failure.** callClaude at line 122 is single-shot. Risk: transient Anthropic API failure loses a 50-item batch. Evidence: 408 invoices processed cleanly including 10 invoices that exceed BATCH_SIZE (split across 2+ batches). No observed losses. Fix would be small (~10 lines, retry-with-backoff) but not urgent.
- **F45 - parseFloat silent zeros.** lineItems mapping at line 267 uses `parseFloat(r[8]) || 0` which converts non-numeric to 0. Risk: garbled OCR output creates qty=0 catalog entries. Evidence: zero NaN values in production data. Real qty=0 rows exist (returns/credits/totals) but Claude's prompt rules correctly skip them.
- **F46 - DEDUP mode bypasses append-only safety.** The only path in the codebase that mutates existing data. Risk: accidental DEDUP=1 run during catalog-edit window could mass-deactivate items. Evidence: DEDUP mode not run in observable history. Stage 1 makes this obsolete (Postgres constraints catch duplicates at write).
- **F47 - Recursive batch_match not handled.** Lines 478-516 don't detect when a batch_match references another batch_match. Risk: silent fallback to "create as new" creating duplicate catalog entries. Evidence: 217 ai_cron_batch entries created successfully, no observed duplicates.
- **F48 - Magic column index in Slack digest.** Line 540 hardcodes column 9 for "pending" status check. Risk: review_queue schema shift breaks the digest silently. Evidence: schema stable since cron deployment. Stage 1 migration must update this reference.
- **F49 - REBUILD UUID format coexists with standard UUIDs.** 138 of 170 STL-MO invoice UUIDs start with "REBUILD-" prefix (from prior repair script). Risk: Stage 1 migration must handle both formats or normalize. Documentation note for Stage 1, not a bug.

### Hand-rolled JWT consolidation (Bundle 3 PR A1) [FULLY CLOSED]

- **What:** Three cron files previously hand-rolled service-account JWT auth instead of using the canonical `getServiceAccountSheetsClient()` / `getServiceAccountDriveClient()` helpers from `src/lib/sheets.js`. PR A1 (2026-05-20) consolidated 3 of the 4 hand-rolled paths. The 4th path (people/route.js) is deferred to PR A2.
- **Why:** CLAUDE.md item 1 has flagged "two parallel service-account implementations exist" since the 2026-05-11 calibration. Hand-rolled JWT paths fragment auth, complicate Stage 1 Postgres migration (every consolidated call site automatically swaps to the new store when the canonical helper is replaced), and risk drift from canonical helper behavior (e.g., scope changes, retry behavior, error handling).
- **Where (removed):**
  - `src/app/api/cron/backup-sheets/route.js` - removed local `getServiceAccountAuth` JWT helper (was L37-46). Now uses `getServiceAccountDriveClient()`.
  - `src/app/api/cron/daily/route.js` - removed `getAccessToken` / `importPrivateKey` / `signJwt` block (was L17-71, ~55 LOC of `crypto.subtle` code) plus local `readSheet` / `appendRow` helpers (was L76-104). Now uses `readSheetSA` + `appendRowSA`.
  - `src/app/api/cron/incident-reminders/route.js` - removed local `getSheetsClient` (was L26-35) plus local `readIncidents` (was L69-75) and `updateCell` (was L78-85) helpers. Now uses `readSheetSA` + `updateCellSA`.
- **What stays:** `getGmailClient` in `cron/incident-reminders/route.js` (now ~L28) intentionally not consolidated. Different auth pattern - see "Gmail SA auth pattern (incident-reminders) [PRESERVE]" entry below.
- **What's still pending:** `src/app/api/people/route.js` (2,056 lines) still has hand-rolled JWT at L79-156 (`getServiceToken` / `importPrivateKey` / `signJwt` plus local `readSheet` / `appendRow` / `updateCell` / `updateRow` helpers without the `SA` naming suffix). Deferred to PR A2 due to file size. After PR A2 merges, CLAUDE.md item 1 fully closes.
- **Also in this PR:** New `getServiceAccountDriveClient(scopes)` helper added to `src/lib/sheets.js` (mirrors `getServiceAccountSheetsClient` but returns a Drive client). Drift-bomb duplicate local `SHEET_IDS` consts removed from `cron/daily` and `cron/incident-reminders` (the locals had a `DB` key referencing `PEOPLE_DB_SHEET_ID`; verified safe to migrate to canonical `SHEET_IDS.COLLECTION` because Kevin confirmed `PEOPLE_DB_SHEET_ID` env var = COLLECTION sheet ID `1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ`).
- **LOC impact:** -130 LOC across the 3 cron files (724 -> 594), +22 LOC in `sheets.js` (new Drive helper). Net -108 LOC.
- **Documented:** 2026-05-20 during Bundle 3 PR A1 (sub-phase 6).
- **Migration consideration:** All Sheets reads/writes from these 3 cron files now flow through the canonical SA pattern. Stage 1 swap of `getServiceAccountSheetsClient` to a Postgres-equivalent (or repointing of `readSheetSA` / `appendRowSA` / `updateCellSA` to query Postgres) will automatically pick up these files without per-file edits.
- **Verification:** After merge, confirm the 3 cron jobs continue running successfully: (a) backup-sheets nightly Slack ping shows 5/5 backup success, (b) daily cron writes to `notification_log` in the COLLECTION sheet (inventory countdowns, birthdays, anniversaries, period starts), (c) incident-reminders sends Gmail + writes `reminder_7day_sent_at` timestamps to the incidents tab. All 3 must produce identical output to pre-PR behavior.
- **Fully closed by PR A2b 2026-05-22:** Zero hand-rolled `crypto.subtle` JWT remains in the codebase. The Sheets portion of `people/route.js` closed in PR A2a (#55); the Gmail portion + the JWT block itself closed in PR A2b. See "Gmail SA canonicalization (Bundle 3 PR A2b)" entry below.

### Gmail SA auth pattern (incident-reminders) [PRESERVE]

- **What:** `src/app/api/cron/incident-reminders/route.js` uses `google.auth.JWT()` (~L28-38) with `subject: process.env.PEOPLE_OPS_FROM_EMAIL || "support@kitchfix.com"` for Gmail send operations. This is intentionally NOT consolidated into the `src/lib/sheets.js` helpers, even though PR A1 consolidated all the Sheets auth in this same file.
- **Why:** Gmail send-as-user requires Google Workspace domain-wide delegation with subject impersonation. The service account acts AS `support@kitchfix.com`, not as itself, so the recipient sees a clean From: header. Sheets SA auth (in `getServiceAccountSheetsClient`) is non-impersonated - the SA acts as itself. These are fundamentally different auth patterns and should not share a single helper: consolidating them would either (a) force every Sheets call site to declare a subject they don't need, or (b) force the Gmail call site to bypass the helper to get impersonation back.
- **Where:** `src/app/api/cron/incident-reminders/route.js` - `getGmailClient` function (~L28), called from the email-send path in the route's main handler (~L168). The `import { google } from "googleapis"` line at L2 is retained specifically for this client (the Sheets path no longer needs it).
- **Documented:** 2026-05-20 during Bundle 3 PR A1 (sub-phase 2 recon surfaced the pattern; preserved per Decision 3).
- **Migration consideration:** Stage 1 Postgres replaces Sheets storage but does NOT change Gmail send infrastructure. This auth pattern continues post-migration unchanged. The `PEOPLE_OPS_FROM_EMAIL` env var and the `gmail.send` scope on the SA's domain-wide delegation config must both survive Stage 1.
- **Do not:** Try to consolidate Gmail send into `sheets.js` helpers, or rename the function to `getGmailClientSA` to match the SA naming convention - the convention specifically describes the Sheets-data pattern, and conflating Gmail auth with it obscures the impersonation requirement.
- **Verification:** Send a test incident, wait 7 days before the check-in date, confirm the reminder email's From: header reads "KitchFix People Ops <support@kitchfix.com>" (not the SA email). If the From: header ever reverts to the SA address, impersonation has broken and the JWT `subject` parameter or the SA's domain-wide delegation scope needs investigation.
- **Update 2026-05-22 (PR A2b):** The SA-impersonated Gmail pattern now flows through canonical `sendEmailSA` in `src/lib/gmail.js`. `cron/incident-reminders/route.js`'s local `getGmailClient` + `buildEmailMime` have been removed. The pattern was preserved (still uses `google.auth.JWT` + `subject` for domain-wide-delegation impersonation), just relocated to a canonical helper alongside `people/route.js`'s migration. The original [PRESERVE] rationale - that Gmail SA send should NOT be consolidated INTO `src/lib/sheets.js` helpers - still holds. Gmail lives in `gmail.js` (alongside the user-OAuth invoice helpers), not in `sheets.js`. See "Gmail SA canonicalization (Bundle 3 PR A2b)" entry below for the full A2b consolidation details.

### people/route.js Sheets consolidation (Bundle 3 PR A2a) [PARTIAL CLOSE OF CLAUDE.md ITEM 1]

- **What:** `src/app/api/people/route.js` (2,056 lines) migrated from 7 local Sheets helpers + hand-rolled SA JWT auth to canonical SA helpers from `src/lib/sheets.js`. 66 call sites converted (29 `readSheet`, 4 `appendRow`, 27 `updateCell`, 3 `updateRow`, 1 `clearRow`, 2 `appendRowAnchored`). Local `SHEET_IDS` const dropped; canonical `SHEET_IDS.COLLECTION` used for all writes. `ensureIncidentsTab` kept local per D2 but its internals refactored to use canonical inline batchUpdate (for frozen-row addSheet) + canonical `updateRangeSA` (for 42-col header write).
- **Why:** Closes the Sheets-path portion of CLAUDE.md item 1 ("two parallel service-account implementations exist"). The Gmail-path JWT block stays alive until PR A2b. Also eliminates a P0 drift bomb (see Drift-bomb point below).
- **Where:** `src/app/api/people/route.js` (66 call sites + 7 local helpers + local `SHEET_IDS` const removed). `src/lib/sheets.js` gained 2 new exported helpers (`clearRangeSA`, `updateCellByRowColSA`) + 1 internal helper (`colToLetter`).
- **What stays (queued for PR A2b):** The Gmail send path - `sendEmail`, `getGmailToken`, `getServiceToken`, `importPrivateKey`, `signJwt`. Note: `getAccessToken` is now ORPHAN (0 callers) - it was always a Sheets-only wrapper, and `getGmailToken` calls `getServiceToken` directly. PR A2b removes the whole block including this dead member.
- **Drift bomb removed (D6 / P0):** Local `SHEET_IDS.DB` had a fallback chain `process.env.PEOPLE_DB_SHEET_ID || process.env.MASTER_HUB_SHEET_ID`. If `PEOPLE_DB_SHEET_ID` were ever unset, every write would land in the read-only HUB sheet and corrupt it. After PR A2a all writes flow to canonical `SHEET_IDS.COLLECTION` (hardcoded) - the env var is orphaned (see separate "PEOPLE_DB_SHEET_ID env var orphaned" entry below).
- **Anchoring guarantee preserved:** The old local `appendRowAnchored` pinned writes to `!A:A` to prevent column-shift on variable-width rows. Canonical `appendRowSA` already auto-anchors bare tab names to `!A:A` (sheets.js L127), so the anchoring guarantee is preserved automatically with no caller changes.
- **Latent bug removed:** The old local `updateCell` used 2-letter-max column math that breaks above col 702 ("ZZ"). The new canonical `updateCellByRowColSA` uses iterative col-to-letter math that handles arbitrary depth (col 703 → "AAA"). No production call hit col > 26 in practice, so this was a latent risk not an active bug.
- **LOC impact:** -165 LOC in `people/route.js` (2,056 → 1,891). +49 LOC in `sheets.js`. Net -116 LOC.
- **Lint debt NOT addressed:** 5 pre-existing `no-assign-module-variable` errors (local vars named `module` shadowing Next.js module global). Out of scope for a consolidation PR. They pre-date PR A2a and remain after.
- **Documented:** 2026-05-22 during Bundle 3 PR A2a sub-phase 8.
- **Migration consideration:** All Sheets reads/writes from `people/route.js` now flow through canonical SA helpers. Stage 1 Postgres swap (repointing canonical helpers to query Postgres) will pick up this file automatically without per-file edits.
- **Verification post-merge:** Exercise the People Portal end-to-end: submit a PAF, submit a new hire, save+load+delete a draft, file an incident with attachments, change an incident's status, add an investigation note. All paths exercise the migrated helpers. Also: verify the incident reminder cron's "tab missing" auto-create path by spot-checking the Incidents tab structure (frozen header row 1, 42 columns A through AP).

### Drive client consolidation (Bundle 3 PR A2a sub-phase 7.5)

- **What:** PR #54 added canonical `getServiceAccountDriveClient(scopes)` to `src/lib/sheets.js` but didn't sweep pre-existing local duplicates. The pattern audit (2026-05-20) found 2: `drive.js` L20 and `incidentActions.js` L29. Both were file-private (not exported) and functionally identical to canonical. PR A2a consolidated both to import from sheets.js.
- **Why:** Three definitions of the same Drive client construction is drift risk - if one diverges (e.g. scope change for narrower access), the others silently don't follow. Single canonical source eliminates the drift surface.
- **Where:** `src/lib/drive.js` (L20 def + 2 internal call sites); `src/lib/incidentActions.js` (L29 def + 2 internal call sites). Both files now import from `@/lib/sheets`.
- **What stays:** `incidentActions.js` still imports `google` from "googleapis" - used by 2 Calendar client constructions (impersonated + non-impersonated fallback) which are deferred (see separate "Calendar SA client patterns" entry).
- **Bonus cleanup:** `drive.js`'s `import { google } from "googleapis"` was dead after removing the local def (the function was its only consumer). Removed alongside the consolidation.
- **LOC impact:** -27 LOC (drive.js -13, incidentActions.js -14).
- **Documented:** 2026-05-22 during Bundle 3 PR A2a sub-phase 7.5.
- **Migration consideration:** None - Drive client behavior is unchanged. The canonical helper's optional `scopes` parameter (default `["drive"]`) is strictly more flexible than the locals' hardcoded scope, so future callers can pass narrower scopes like `drive.file` if needed.
- **Verification post-merge:** Invoice page-upload (drive.js path) and incident folder/file creation (incidentActions.js path) continue working. Both paths get exercised on real user submissions.

### Calendar SA client patterns [PRE-CANONICAL] [DEFERRED]

- **What:** The pattern audit (2026-05-20) found 3 inline SA Calendar client constructions across 2 lib files: `incidentActions.js` L60 (impersonated, `subject = m.chavez@kitchfix.com` for 30-day incident check-in events), `incidentActions.js` L73 (non-impersonated fallback when domain-wide delegation isn't configured), `wowPlanActions.js` L309 (non-impersonated, inline + dynamic import inside the function).
- **Why:** No canonical `getServiceAccountCalendarClient` helper exists in `sheets.js` yet. This mirrors the pre-PR-#54 state of `getServiceAccountDriveClient` (multiple inline constructions, no canonical layer).
- **Where:** `src/lib/incidentActions.js` L60 and L73; `src/lib/wowPlanActions.js` L309.
- **Status:** DEFERRED to a post-Bundle-3 PR. Calendar is not Sheets data and not Stage 1 critical. When built, mirror the Drive consolidation pattern: add canonical `getServiceAccountCalendarClient({ scopes, subject? })` with optional impersonation, rewire the 3 sites. Estimated LOC reduction: ~30 LOC.
- **Documented:** 2026-05-22 during Bundle 3 PR A2a sub-phase 8 (catalogued from the pattern audit).
- **Migration consideration:** Calendar is not migrating in Stage 1 (Calendar API is not data storage). This consolidation is pure code-hygiene, no migration dependency.
- **Do not:** Add the canonical Calendar helper to `sheets.js` (wrong file). Create `src/lib/calendar.js` when consolidating, OR add to a future `src/lib/google-clients.js` if the eventual decision is to consolidate all Google API client construction in one place.

### PEOPLE_DB_SHEET_ID env var orphaned after PR A2a [CLEANUP]

- **What:** After PR A2a removes the local `SHEET_IDS` const in `people/route.js`, NO code in the codebase reads `process.env.PEOPLE_DB_SHEET_ID`. The env var becomes orphaned.
- **Why:** `PEOPLE_DB_SHEET_ID` was the env var the People Portal used to point at the COLLECTION sheet (`1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ`). Verified in PR A1 (2026-05-20) that `PEOPLE_DB_SHEET_ID` resolves to the same physical sheet as canonical `SHEET_IDS.COLLECTION`. After PR A2a migrates all writes to canonical `SHEET_IDS.COLLECTION` (hardcoded), the env var is no longer read.
- **Where:** Vercel project env vars (Production / Preview / Development).
- **Action:** Remove from Vercel via `vercel env rm PEOPLE_DB_SHEET_ID production` (and same for preview + development), OR via the Vercel dashboard. Non-urgent - no functional impact while it sits unused. Update `docs/ENV_VARS.md` (drop the entry) when removing.
- **Documented:** 2026-05-22 during Bundle 3 PR A2a sub-phase 8.
- **Migration consideration:** Stage 1 Postgres uses different env vars entirely (SUPABASE_*). `PEOPLE_DB_SHEET_ID` was always a Sheets-era variable, retired before Stage 1.

### Gmail SA canonicalization (Bundle 3 PR A2b) [CLOSES CLAUDE.md ITEM 1]

- **What:** The two SA-impersonated Gmail implementations - `people/route.js` (hand-rolled `crypto.subtle` JWT + raw fetch to `gmail.googleapis.com`) and `cron/incident-reminders/route.js` (`google.auth.JWT` + local MIME builder) - consolidated into one canonical helper `sendEmailSA({ sender, displayName, to, subject, html, replyTo })` in `src/lib/gmail.js`. Returns `"sent"|"failed"` string to preserve the by-reference contract `incidentActions.js` depends on (via `notifyIncident` and `notifyStatusChange` which receive `sendEmail` as a function parameter).
- **Why:** Closes CLAUDE.md item 1 ("two parallel service-account implementations"). After A2b, `grep crypto.subtle src/` returns zero active code (1 JSDoc reference remains in `gmail.js` intentionally documenting the removed pattern). The full ~72 LOC hand-rolled JWT block (`getAccessToken`, `getGmailToken`, `getServiceToken`, `importPrivateKey`, `signJwt`) removed from `people/route.js`. The local `sendEmail` function (~66 LOC) became a 1-line adapter closing over the `GMAIL_SENDER` + `GMAIL_SENDER_NAME` consts; the by-reference plumbing to `incidentActions` preserved unchanged (0 lines touched in incidentActions.js).
- **Where:**
  - `src/lib/gmail.js` (+95 LOC) - new exported `sendEmailSA` + new local `encodeSubjectSA` helper + section comment.
  - `src/app/api/cron/incident-reminders/route.js` (-30 LOC) - removed local `getGmailClient`, local `buildEmailMime`, dead `import { google } from "googleapis"` (matches drive.js precedent from PR #55).
  - `src/app/api/people/route.js` (-133 LOC) - removed the entire JWT block + the local `sendEmail` function; replaced with a 1-line adapter (`const sendEmail = (to, subject, html, replyTo) => sendEmailSA({ sender: GMAIL_SENDER, displayName: GMAIL_SENDER_NAME, to, subject, html, replyTo })`). `GMAIL_SENDER` + `GMAIL_SENDER_NAME` consts retained (the adapter consumes them).
- **Encoding equivalence proven before swap:** The canonical helper's 3 encodings were verified byte-equivalent to the original `people/route.js sendEmail` before any call-site swap. (a) Subject via `encodeSubjectSA` - byte-exact port of the original's `/[^\x00-\x7F]/` ASCII test (intentionally distinct from `gmail.js`'s existing `encodeSubject` which uses a stricter `[\x20-\x7E]` test; see "two subject encoders" follow-up below). (b) HTML body via `Buffer.from(html).toString("base64")` - standard padded base64, MIME-standard, byte-identical to original's `btoa(unescape(encodeURIComponent(html)))`. (c) Raw message via `Buffer.from(rawMessage).toString("base64url")` - empirically confirmed equal to original's manual `+/-`, `//_`, strip-`=` chain across 4 forced-character test inputs (RFC 4648 §5 unpadded URL-safe base64).
- **Two intentional behavior changes to cron emails (REQUIRE post-merge verification):** The cron previously sent (a) plain unencoded subjects (no RFC 2047 - the `·` U+00B7 char in "30-day check-in due in 7 days · ${incident_id}" could render as mojibake in some clients) and (b) plain HTML body (not base64-encoded inside the multipart). After A2b both go through `sendEmailSA` which RFC-2047-encodes non-ASCII subjects and base64-encodes the body. More RFC-compliant. **Post-merge verification:** trigger a test reminder, confirm From header reads "KitchFix People Ops <support@kitchfix.com>", confirm subject + body render cleanly in Gmail/Outlook recipients.
- **Observability trade-off in cron:** The old cron code threw the actual Gmail API error string into its `errors[]` response array; `sendEmailSA` returns `"failed"` and logs the detail to `console.error` (load-bearing contract for the incidentActions by-reference pattern). The cron now does `if (status !== "sent") throw new Error("Gmail send failed (see [Gmail SA] log)")` to preserve its error-counting flow, but granular Gmail errors (quota exceeded, auth failure, etc.) moved from the API response's `errors[]` array to Vercel logs (the `[Gmail SA] Send failed:` console.error). Minor, acceptable, documented.
- **Two subject encoders coexist in gmail.js (follow-up cleanup):** `encodeSubject` at ~L201 (used by user-OAuth invoice path, `sendInvoiceEmail` + `sendRejectionEmail`) and `encodeSubjectSA` at ~L381 (used by the new SA path). They differ on control-char handling (`encodeSubject` uses stricter `[\x20-\x7E]` test, encodes control chars; `encodeSubjectSA` byte-exact ports the original's `[^\x00-\x7F]` test, passes control chars through). Intentionally NOT unified in A2b to avoid changing the invoice-email path's behavior. Future cleanup: unify once the invoice path is verified to tolerate the stricter test, OR loosen `encodeSubject` to match `encodeSubjectSA`. Non-urgent code-hygiene.
- **incidentActions.js untouched:** Zero changes. The by-reference contract preservation via the adapter pattern was the design goal - `sendEmail(to, subject, html, replyTo) => "sent"|"failed"` signature held exactly, so the 3 by-reference passes in people/route.js (L1325 `notifyIncident`, L1503 + L1616 `notifyStatusChange`) and their downstream invocations inside incidentActions.js (L648 + L838) continue working without modification.
- **LOC impact:** `gmail.js` +95, `cron/incident-reminders` -30, `people/route.js` -133. Net **-68 LOC** code.
- **Documented:** 2026-05-22 during Bundle 3 PR A2b sub-phase 5.
- **Migration consideration:** Stage 1 Postgres replaces Sheets storage but does NOT change Gmail send infrastructure. The canonical `sendEmailSA` helper survives Stage 1 unchanged. The `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` env vars (now read only by `gmail.js`'s `sendEmailSA` + `sheets.js`'s SA client helpers) must survive Stage 1. The SA's `gmail.send` domain-wide-delegation config in Workspace admin must also survive.
- **Verification post-merge:**
  - Trigger an incident submission (people/route.js path): confirm admin + submitter notification emails arrive with `From: KitchFix People Ops <support@kitchfix.com>`.
  - Trigger an incident status update: confirm status-change email reaches the original submitter with the same From header.
  - Wait for or manually trigger an incident-reminder cron run: confirm reminder email arrives with the same From header, subject reads cleanly (RFC 2047 fix - "·" should now render correctly), HTML body renders correctly (base64-encoded body change).
  - PAF / new hire submit: confirm notify cascade still fires with correct From header.
  - Help FAB email: confirm helps still reach Kevin.

### Directory POST admin gate (interim, PR B1) [SECURITY FIX] [INTERIM, replaced in Stage 1]

- **What:** `src/app/api/directory/route.js` POST handler gained a server-side admin gate at the top (right after the existing token check). The gate parses `DIRECTORY_ADMIN_EMAILS` (comma-separated env var, lowercased + trimmed + `.filter(Boolean)`) and returns 403 if `session.user?.email` is not in the list. Fail-closed: if the env var is unset or empty, no one passes - directory POST locks until Vercel env is configured. The gate runs ONCE at the handler entry, before any of the 5 admin actions (admin-update-account, admin-add-account, admin-deactivate-account, admin-reactivate-account, admin-update-contacts, admin-update-heroes) dispatches.
- **What it closes (latent finding):** Pre-B1, directory POST authenticated (`if (!session)`) and required a token (`if (!token)`) but did NOT authorize. Admin gating existed only client-side via the `isAdmin` flag returned from GET bootstrap. A non-admin authenticated user could craft a direct API call to any admin-* action; the only thing stopping them was their OAuth token's HUB edit ACL at the Drive level (an implicit gate via Drive's editor list - brittle, undocumented, and would silently disappear when PR B2's SA migration removes the user-OAuth dependency entirely). The gate makes the authorization explicit, application-layer, and independent of Drive ACLs.
- **Where (gate code):** `src/app/api/directory/route.js` L254-272 (in the POST handler, between the token check at L252 and the body parse at L274).
- **Why env var instead of admins tab:** Per Kevin (decision locked 2026-05-22), directory should be Kevin-only for now. The admins tab has an inconsistent flag model across modules (see "Known divergence" below) and shouldn't be enshrined in a security PR. Env var is the simplest interim source: 1 admin today (Kevin), trivial to add a second via Vercel env edit, no Sheets call required for the check (zero new API calls in B1).
- **Required deploy step:** `DIRECTORY_ADMIN_EMAILS` must be set in Vercel (all environments - Production, Preview, Development) BEFORE this PR merges, or directory POST will 403 for everyone including Kevin. Value today: Kevin's email. Format: comma-separated emails (e.g. `k.fietek@kitchfix.com,future-admin@kitchfix.com`).
- **Known divergence preserved (NOT fixed by B1):** `people/route.js` checks `admins` tab col A (email) AND col C (`"hr"` flag) === "TRUE". `directory/route.js` GET bootstrap (L104-106) checks col A only. So the admins tab apparently has a per-module flag system (col C = hr; possibly other columns for other modules) that directory never adopted. PR B1 does NOT fix this - the GET bootstrap's `isAdmin` flag still uses the col-A-only check unchanged. **Intentional interim mismatch:** the UI's admin-control visibility (driven by bootstrap's `isAdmin`) and the new POST gate (driven by `DIRECTORY_ADMIN_EMAILS`) now use DIFFERENT sources. Worst-case observable behavior: a person on the admins tab but not in `DIRECTORY_ADMIN_EMAILS` sees admin controls in the UI but gets 403 when they try to use them. Acceptable for a Kevin-only interim. Stage 1 unifies both.
- **The real fix (deferred to Stage 1):** Supabase-backed role model + admin dashboard with per-person, per-module toggles. Part of the auth strategy decision - the last Stage 0 gate item per `docs/PROJECT_DASHBOARD.md` (sequence step 10: "Unbundled items spread throughout - auth strategy decision is the LAST gate"). When that lands, both directory's GET `isAdmin` flag and its POST gate switch to the role-table check together. The `DIRECTORY_ADMIN_EMAILS` env var becomes orphaned at that point and is removed from Vercel.
- **LOC impact:** +19 LOC in directory/route.js (9 code + 10 comment). No file deletions, no helpers added, no API calls added, no imports added. Smallest possible diff that closes the auth gap.
- **Documented:** 2026-05-22 during Bundle 3 PR B1 (the deliberate split of the original PR B into B1 security-fix + B2 SA-migration).
- **Migration consideration:** When Stage 1's role model lands, the gate code at L254-272 is the replacement target - swap the `process.env.DIRECTORY_ADMIN_EMAILS` parse for a Supabase role-table check, drop the env var. The COMMENT BLOCK at L254-263 is explicitly written to flag this as interim so a future reader knows it's a replacement target, not a permanent pattern.
- **Verification post-merge:**
  - Confirm `DIRECTORY_ADMIN_EMAILS` is set in Vercel (Production + Preview + Development) BEFORE the merge deploys. If missing, the directory admin UI will hard-fail for Kevin (403 on any admin action). Recovery: set the env var, re-trigger any failed admin action.
  - Confirm Kevin can still perform all 5 admin actions through the directory admin UI (smoke test: edit an account name, save, verify it persists).
  - Confirm a non-admin user (any authenticated user not in the env var) gets 403 on a direct API call (test via `curl` with a non-admin's session cookie if available; otherwise verify in the wild over the following weeks via Vercel logs).
- **Do not:** Convert this gate to read the admins tab. That re-enshrines the divergent flag-model fudge that B1 deliberately avoids. If you want the gate to mirror `isAdmin` semantics, the right move is Stage 1's unified role model, not a tab-read backport.

---

## Template for new entries

### [Rule name] [optional: PRESERVE THROUGH MIGRATION]
- **What:** [the rule in plain language]
- **Why:** [business reason]
- **Where:** [file:line range, if applicable]
- **Documented:** [date + source - audit PR, debug session, stakeholder request]
- **Implementation options post-migration:** [if applicable - a/b/c structure]
- **Schema design decision:** [pending | locked: option N]
- **Verification:** [how to test the rule is preserved after migration]
- **Notes:** [optional: edge cases, history, related rules]
