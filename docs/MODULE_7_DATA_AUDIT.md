# MODULE 7 — SMART INVENTORY: DATA AUDIT & BEST-PRACTICE ASSESSMENT

**Status:** DECISIONS RESOLVED — ready for INV-1 (schema) drafting
**Date:** 2026-06-03 (decisions resolved 2026-06-04)
**Purpose:** The audit-first artifact mandated by CUTOVER_PLAYBOOK Lesson 3, applied to Module 7 (Smart Inventory / "KitchFix Inventory Manager") before any schema or migration work begins. This document does two jobs: (1) record the *verified* current state of the inventory data and code, and (2) assess each table and pattern against PostgreSQL/Supabase best practice, so the migration makes the system stronger rather than just relocating it.

**Framing note.** The tool was built Sheets-first, before PG/Supabase were in the picture. It has **never been turned on for chefs** — invoice data was deliberately accumulated first so the cron could build out real catalogs, and a robust data layer (Supabase) was a prerequisite to go-live. The 5 draft count sessions are internal test data, not abandoned chef attempts. This means: (a) there is almost no live count data to preserve, so migration risk on the count side is LOW, and (b) we have a rare, clean opportunity to get the foundation right *before* anyone depends on it.

**Scope discipline.** Every "is there a better way" gets asked, and each answer is bucketed:
- **DO NOW** — cheaper to fix during migration than ever again, minimal added scope.
- **DESIGN NOW** — schema must accommodate it now to avoid a corner later; feature can come later.
- **DEFER** — real improvement, but doing it now expands blast radius or delays the migration; logged as post-migration work.

The goal is a stronger system, not a ground-up rebuild wearing a migration's clothes.

---

## PART 1 — VERIFIED CURRENT STATE (from 2026-06-03 recon)

All figures below were pulled from the live system (Sheets + PG via service account), not from the prior doc. Where they diverge from `SMART_INVENTORY_DATA_MODEL.md`, the divergence is flagged.

### Architecture today
- **Inventory is 100% Google Sheets.** Zero inventory tables dual-write to PG. No `dataStore/inventory.js` adapter exists. Modules 5 (Vendor) and 6 (Invoice) are already live on PG; inventory is the last major surface still entirely on Sheets.
- **One backing spreadsheet** (INVENTORY, ID `14oROcj9hyQJfKOm-ZXUDn6qvOviZYX1aLMs27V8zZnk`), 8 active tabs + `zone_corrections`.
- **One hot read path:** `handleInventoryBootstrap` reads 7 tabs in parallel on every tool open, with a 60-second in-memory cache (`opsUtils.js`), and computes all derived views in JavaScript.
- **Three writers:** the intranet (chef counts + admin edits), the Railway cron (nightly invoice→catalog reconciliation), and rare manual sheet edits.
- **30 handler exports** in `inventoryActions.js`; **7 are stubs** returning empty/"Week 3"/"Week 4" placeholders (`handleHistoryGet`, `handleReviewQueueGet`, `handleResolveQueue`, `handleScan`, `handleAdminCorrect`, `handleUpdateItem`, `handlePrint`).

### Table-by-table verified state

| Table | Rows | Verified notes / divergence from old doc |
|---|---|---|
| **item_catalog** | 3,666 | Doc said ~2,700 (**+966**). 3,631 active, 35 inactive (2 archived, 3 excluded, **30 "other" — undocumented inactive class, needs investigation**). Max non-empty column = 19; the documented **124 trailing padding columns are NOT present** (cleaned or trimmed by API). `priceAtLastCount` (col K) = **0 of 3,666 filled** (doc said ~1/2,688) — because no count session has ever submitted. |
| **item_aliases** | 6,585 | **1,126 duplicate-key clusters covering 2,270 redundant rows** (doc said ~945 — problem has grown). `learnedBy` (col F) == `source` (col H) on 93.8% of rows, but **408 rows differ** — they are NOT simply duplicate columns; collapse must handle the minority deliberately. |
| **storage_locations** | (zone tree) | Self-referencing `parentLocationId → locationId` for sub-zones. Cols 6–7 reserved/blank. `sortOrder` drives chef walk-order. |
| **count_sessions** | 5 | **ALL 5 in `draft` status — zero ever submitted.** STL-MO (full label) 4, CIN-OH (full label) 1. Confirms the tool has never completed a count end-to-end (by design — not turned on). |
| **count_items** | 147 | Append-only ledger (replay by latest `locationSaveId` per `sessionId`+`locationId`). Per-session 3 / 3 / 120 (min/median/max). Trivial volume — **near-zero migration preservation risk.** |
| **price_history** | (ledger) | Append-only. Dedup key = `sourceOrInvoiceId` (cron builds a JS Set to skip seen invoices). The single company-wide cost ledger. Now includes today's STL-MO backfill promotions. |
| **review_queue** | 213 | Doc said 41. **All 213 pending — nothing ever resolved (no resolver UI).** 151 have col N (reason), 62 are legacy pre-arithmetic-gate (empty reason). Reason distribution: `arithmetic_fail` 73, empty 62, `overcount_suspect_reextract` 45, `low_match_confidence` 33, `possible_new` 0. Col-N schema matches what we documented tonight. |
| **merge_history** | 58 | `keep_separate` 29, `merge` 24, `exclude` 3, `archive` 2. Cron reads this for the excluded-names filter. `mergedItemIds`/`mergedNames` stored as JSON arrays. |
| **zone_corrections** | ? | Referenced in schema but **not read by bootstrap or merge logic — purpose unverified. Needs investigation.** |

### Account labels (the `accountMatch` question, quantified)
10 distinct `account` values in `item_catalog`:

```
CIN - AZ                        321      STL - MO                        758
CIN - OH                        412      STL - MO - St Louis Cardinals     1   <-- lone full-form stray
STL - FL                        299      TBJ - FL                        285
TBR - FL                        378      TXR - AZ                        334
TXR - TX - H                    527      TXR - TX - V                    351
```

**Short-vs-full drift is ONE stray row** (`STL - MO - St Louis Cardinals`, 1 of 759), not the widespread drift the doc implied. `accountMatch` is called in 20+ handlers to tolerate this. Catalog covers 10 of ~15 documented accounts.

### Vendor resolution (for the primaryVendor FK question)
34 distinct `primaryVendor` strings in active catalog vs 33 vendor names in PG `vendors` (Module 5 live). **5 do not exact-match** and need fuzzy resolution: `Test Vendor`, `Freshpoint` (PG: "Fresh Point"), `Cozzini Bros` + `Cozzini Brothers` (spelling split), `Samuels Seafoos` (typo of "Samuels Seafood").

### The official plan vs reality
- **FINANCE_STACK_PLAN.md Module 7 = 3 PRs** (not the 5 I previously recalled): 7.1 schema + dormant adapters (10–14h), 7.2 handler rewire (14–18h), 7.3 backfill (6–8h). **~30–40h total. 9 PG tables.**
- **MODULE_7_DATA_AUDIT.md does not exist** — this document fills that gap.
- **No Smart Inventory DDL exists.** The `pr-7-*.sql` files in `migrations/` are for **OPD** (a different module that shipped today). The inventory schema is unwritten.
- **PR-number collision:** OPD used 7.1–7.5; the inventory plan also calls its PRs 7.1–7.3. **Rename inventory PRs (e.g. INV-1/2/3) to avoid conflation.**

---

## PART 2 — BEST-PRACTICE ASSESSMENT

For each pattern/table: how it works today (Sheets-era), what PG/Supabase best practice would do, the gap, the bucket, and a recommended lean. **Open decisions are tagged `[DECISION n]` and resolved in Part 3.**

### Cross-cutting patterns

**P1 — Account isolation & access control**
*Today:* `accountMatch` fuzzy string-prefix matching in JS, applied per-handler. No enforcement that a given user only sees their account's data — the filter is application logic, not a database guarantee.
*Best practice:* Canonical account identity (FK to an accounts table) + **Row-Level Security (RLS)** so the database itself enforces "this chef sees only their account." This is the Supabase-native answer to multi-tenant isolation, and it ties to how chefs authenticate.
*Gap:* Large. Today's isolation is convention, not constraint. For a tool multiple site operators across 10+ accounts will use, DB-enforced isolation is the correct posture.
*Bucket:* **`[DECISION 1]`** — this is the scope-defining call (see Part 3).

**P2 — Authentication model**
*Today:* NextAuth (per ENV_VARS.md). Chefs would authenticate through the existing intranet auth.
*Best practice:* If RLS is adopted, access policies key off the authenticated user's identity/claims. Supabase Auth integrates natively with RLS; NextAuth can also drive RLS via JWT claims but needs wiring.
*Gap:* Coupled to P1. Can't fully design RLS without deciding how identity reaches the database.
*Bucket:* **`[DECISION 1]`** (bundled with RLS).

**P3 — Read path (the bootstrap)**
*Today:* `handleInventoryBootstrap` reads 7 tabs and computes everything in JS: per-category stats, price movers (≥5% change, top 10), last-count replay (window over count_items), review counts, top-N price history per item. A 60s app-level cache wraps it, with manual `invalidateCache` calls on every write.
*Best practice:* Express derived views as **PG views / materialized views**; the bootstrap becomes a few queries or one RPC. The entire JS cache-invalidation layer disappears (Postgres + connection pooling handles it).
*Gap:* Significant business logic lives in JS that PG expresses more reliably (and consistently — today two code paths could compute "current count" differently).
*Bucket:* **DO NOW** for the mechanical views (price movers, last-count current-state, category rollups). Lean: build these as views in 7.1. *Open sub-question on how far to go — see `[DECISION 8]`.*

**P4 — Atomic multi-table writes (merge especially)**
*Today:* `handleMergeItems` does 4–5+ sequential Sheets writes (update keeper, deactivate dupes, append aliases, remap alias FKs, remap price FKs, append merge_history) with **no transaction — partial failure leaves drift.**
*Best practice:* A single **stored procedure / RPC in a transaction**, or app-side transaction. Either all of a merge lands or none does.
*Gap:* This is the single riskiest operation in the system and currently has no atomicity. (Module 5 already established the pattern with `pr-5-3-vendor-merge-function.sql`.)
*Bucket:* **DO NOW.** Lean: implement `merge_inventory_items()` as a stored proc, mirroring the vendor-merge precedent. Non-negotiable for data integrity.

**P5 — Idempotency (price_history dedup)**
*Today:* Cron builds a JS `Set` of seen `sourceOrInvoiceId` values and skips duplicates. Works, but the guarantee lives in application code.
*Best practice:* `UNIQUE (item_id, source_or_invoice_id)` constraint + `INSERT ... ON CONFLICT DO NOTHING`. Dedup enforced by the database.
*Gap:* Small, free win.
*Bucket:* **DO NOW.** Lean: add the constraint. (Confirmed available; no downside.)

**P6 — Computed totals**
*Today:* `count_sessions.grandTotal` and `count_items.extendedPrice` are stored and computed app-side, so they can drift if anything writes a component without updating the total.
*Best practice:* **GENERATED columns** — `grand_total` as the sum of the five category totals; `extended_price` as `quantity * price_at_count`. Drift becomes impossible.
*Gap:* Small, free win.
*Bucket:* **DO NOW.** Lean: generated columns. (One caveat: category totals themselves aggregate across count_items, so `grand_total` may be better as a generated column over the five stored category totals, with those category totals computed at submit — confirm the exact derivation in 7.1.)

**P7 — Soft-delete / status modeling**
*Today:* `active = 'FALSE'` string + a separate `status` string (`excluded` / `archived` / empty). The 30 "other" inactive rows suggest this has drifted.
*Best practice:* A single `status` enum (`active` / `archived` / `excluded`) with a partial index for the hot `active` path; drop the redundant boolean.
*Gap:* Moderate; the dual-field model is the likely source of the 30 ambiguous rows.
*Bucket:* **DO NOW** (clean it during backfill). Lean: status enum, drop the boolean — *pending what the 30 "other" rows actually are (investigation, not decision).*

**P8 — Referential integrity across the finance stack (NEW capability)**
*Today:* Inventory references vendors and invoices by **freeform string** because they lived in separate sheets — no integrity possible. `primaryVendor` is text; `price_history.sourceOrInvoiceId` is a bare UUID string.
*Best practice / unlocked-by-migration:* Modules 5 and 6 are **already in PG**, so inventory in PG can hold **real foreign keys** to `vendors` and `invoice_submissions`. This is a genuine new strength the migration unlocks — referential integrity across the whole finance stack, impossible in the Sheets era.
*Gap:* Opportunity, not a defect. Worth seizing where clean.
*Bucket:* **DESIGN NOW.** Lean: FK `price_history.invoice_id → invoice_submissions(id)` (clean, every cron-sourced price has a real invoice UUID). The vendor FK is `[DECISION 2]` (the 5 unresolvable strings complicate it).

### Table-specific decisions

**T1 — inventory_items (renamed from item_catalog)**
- Drop dead/reserved/padding columns (padding already gone; confirm no dead cols remain). **DO NOW.**
- `account` → FK + canonical label; retire `accountMatch`. **`[DECISION 6]`** (lean: yes, fix the 1 stray row, add CHECK/FK).
- `primaryVendor` → FK vs freeform. **`[DECISION 2]`**.
- `priceAtLastCount` (0/3666 filled) → keep the column, or drop and derive from a join to count_items at read time. **`[DECISION 5]`**.
- `status` enum (per P7). **DO NOW**, pending the 30-row investigation.

**T2 — item_aliases**
- 2,270 redundant rows: dedup during migration, or migrate-then-clean? **`[DECISION 4]`**.
- `learnedBy`/`source` collapse must preserve the 408 differing rows (not a blind drop). **`[DECISION 4]`** (bundled).
- FK `item_id → inventory_items(id)`. **DESIGN NOW** (lean: yes).

**T3 — storage_locations**
- Self-FK `parent_location_id`. **DESIGN NOW** (lean: yes — required for the zone tree).
- Drop reserved cols 6–7. **DO NOW.**
- Keep `sort_order` (drives chef walk-order). **DO NOW.**

**T4 — count_sessions**
- `grand_total` generated (per P6). **DO NOW.**
- `status` enum (`draft`/`submitted`/`corrected`). **DO NOW.**
- `period` → FK to HUB periods. **DESIGN NOW** (depends on whether HUB migrates — note dependency).

**T5 — count_items**
- "Current count state" as a **view/window function** over the append-only table (don't lose the ledger). **DO NOW** (lean: yes).
- `extended_price` generated (per P6). **DO NOW.**
- Preserve the `none_on_hand` vs `quantity = 0` distinction explicitly (boolean, not overloaded). **DO NOW.**

**T6 — price_history**
- `UNIQUE (item_id, source_or_invoice_id)` + ON CONFLICT (per P5). **DO NOW.**
- FK `invoice_id → invoice_submissions(id)` (per P8). **DESIGN NOW** (lean: yes).
- Stays append-only. **DO NOW.**

**T7 — review_queue**
- Col N `reason` enum + the decision-metadata cols (`reviewed_by`/`reviewed_at`/`result_item_id`) properly typed. **DO NOW.**
- 213 pending rows + **no resolver UI**: the resolver (Item Review `handleResolveQueue`/`handleReviewQueueGet` are stubs) is a real gap, but building it is a **feature**, not a migration step. **`[DECISION 9]`** (sequence the resolver).

**T8 — merge_history**
- `mergedItemIds`/`mergedNames` as JSONB vs a `merge_history_items` junction table. **`[DECISION 3]`**.
- Cron's excluded-names read becomes a clean query either way. **DO NOW** (follows from the choice).

**T9 — zone_corrections**
- Purpose unverified — **investigate before schema** (is it live? read by anything? safe to drop?). Investigation, not decision.

### Sequencing

**S1 — Reconciliation alarm.** The lesson of 2026-06-03 (the 7-week silent gap + the local-env dual-write gap). Best understood now as the **pre-go-live safety net**: once chefs count against this catalog, a silent gap can't be allowed to hide. **`[DECISION 10]`** — build before/after/parallel to the migration.

**S2 — PR naming.** Rename inventory migration PRs to `INV-1/2/3` to avoid the OPD 7.x collision. **DO NOW** (lean: yes).

**S3 — Audit-first.** This document satisfies the playbook mandate. It should be committed (`docs/MODULE_7_DATA_AUDIT.md`) before schema work starts.

---

## PART 3 — RESOLVED DECISIONS (binding design spec for INV-1)

**[DECISION 1] — RLS + Auth → PARKED.**
Schema is built **RLS-ready** (canonical account identity on every table) but RLS policies are NOT built in this migration. Per-account isolation stays application-level (the current pattern) for now. **RLS + auth integration becomes its own dedicated step before go-live** (chefs must not see other accounts' data once the tool is live, but that gate is separate from the data migration). No corner painted; scope contained.

**[DECISION 2] — primaryVendor → FK to `vendors(id)`.**
Inventory adopts the same canonical-vendor discipline invoices already have. Backfill resolves all 34 strings to `vendor_id` (29 exact-match, 3 via existing `vendor_aliases`, "Samuels Seafoos" gets one alias insert, "Test Vendor" skipped as dev artifact).
- **Design-now corollary:** `ai_line_items` should carry `vendor_id`, not just freeform `vendor_name`, so canonical identity flows from invoices → line items → inventory instead of being re-derived from a string. (This is the structural fix for the drift source.)
- **Logged, not scheduled:** (i) a *preventive* fuzzy dup-check at the Add-Vendor wizard Step 1 — the registry already has a working **Duplicate Detector** (detective control, 0/33 dupes today), so this is a low-priority hardening, not urgent; (ii) **cron vendor canonicalization** (resolve `li.vendor` → `vendor_id` before writing) — belongs to Module 8, addressed structurally by the `ai_line_items.vendor_id` design above.

**[DECISION 3] — merge_history → junction table.**
`merged_item_ids`/`merged_names` JSON arrays become a `merge_history_items` junction table, enabling clean "what merges ever touched this item" queries without JSON parsing.

**[DECISION 4] — item_aliases dedup → during backfill.**
Migrate clean, not messy-then-clean. The 2,270 redundant rows are deduped as part of the INV-3 backfill. The `learnedBy`/`source` columns are collapsed **but the 408 rows where they differ are preserved deliberately** (not a blind drop of one column).

**[DECISION 5] — priceAtLastCount → DROP and derive.**
Column removed; "price at last count" is derived via join to `count_items` at read time. Eliminates a denormalized, drift-prone column that only a never-fired write path populated (0/3,666 today).

**[DECISION 6] — account identity → canonical + enforced.**
CHECK/FK enforces canonical short-form account labels; the 1 stray full-form row (`STL - MO - St Louis Cardinals`) is fixed in backfill; **`accountMatch` is retired** (the DB constraint makes fuzzy matching unnecessary).

**[DECISION 7] — free-wins batch → YES to all.**
- Generated columns: `count_sessions.grand_total`, `count_items.extended_price`.
- `UNIQUE (item_id, source_or_invoice_id)` + `INSERT ... ON CONFLICT DO NOTHING` on `price_history` (cron idempotency moves to the DB).
- `merge_inventory_items()` **stored proc** (atomic transaction), mirroring the live `merge_vendors()` precedent.
- `status` enum (`active`/`archived`/`excluded`) replacing the `active` boolean + `status` string pair.

**[DECISION 8] — bootstrap → PG views, MECHANICAL ONLY.**
Build views for the mechanical derivations (price movers, current-count window, category rollups). The JS cache layer disappears. **No materialized views / heavier denormalization** unless a real read-latency problem appears (no premature optimization).

**[DECISION 9] — review_queue resolver UI → DEFER.**
The resolver (currently stubbed) is a post-cutover **feature**, not a migration step. The 213 pending rows stay safely held. Schema models the reason enum + decision-metadata columns properly so the resolver has a clean target when built.

**[DECISION 10] — reconciliation alarm → BEFORE go-live, PARALLEL-ABLE.**
The pre-launch safety net (lesson of the 2026-06-03 silent gap). Doesn't block schema work; can be built alongside the migration. Must be in place before chefs count against this catalog.

### Investigations (CC tasks, run before/during INV-1)
- What are the 30 "other" inactive `item_catalog` rows? (Determines status-enum mapping.)
- What is `zone_corrections` — read by anything? Safe to drop, or must it migrate?
- Confirm the exact `grand_total` derivation (generated over the 5 stored category totals vs aggregate over `count_items`).

---

## PART 4 — MIGRATION SCOPE & SEQUENCE

**PR renaming:** inventory migration PRs are **INV-1 / INV-2 / INV-3** (NOT 7.1–7.3) to avoid collision with the OPD `pr-7-*.sql` files already on main.

### Core migration (the 3 PRs, ~30–40h)

**INV-1 — Schema + dormant adapters (~10–14h).**
9 PG tables + 1 junction (`merge_history_items`). Embeds the resolved decisions: vendor_id FK (D2), account CHECK (D6), generated columns + UNIQUE/ON CONFLICT + status enums (D7), self-FK on locations, FK `price_history.invoice_id → invoice_submissions`, RLS-ready account identity (D1). `merge_inventory_items()` stored proc (D7/P4). PG views for bootstrap derivations (D8). `dataStore/inventory.js` adapters dormant behind cutover flags. **No behavior change yet.**

**INV-2 — Handler rewire (~14–18h).**
30 handlers route through `dataStore/inventory.js`. `accountMatch` removed (D6). `handleDedupCatalog` retired. `opsUtils` cache becomes a no-op (D8). The 7 stub handlers stay stubs (resolver deferred per D9). `priceAtLastCount` reads become a join (D5).

**INV-3 — Backfill (~6–8h).**
9 tables in dependency order. Includes: vendor_id resolution for all 34 strings (D2), alias dedup + learnedBy/source collapse preserving the 408 (D4), the 1 stray account-label fix (D6), the 30 "other" inactive rows mapped to the status enum (pending investigation).

### Parallel track
- **Reconciliation alarm (D10)** — buildable now against PG, in parallel with INV-1/2. Pre-go-live requirement.

### Design-now, builds with later modules
- **`ai_line_items.vendor_id`** (D2 corollary) — add the column/FK so canonical vendor identity flows to line items; cron consumes it. Lands with the Module 8 cron migration.

### Logged, low-priority (not scheduled)
- Add-Vendor wizard preventive dup-check (Detector already covers the risk).
- Cron vendor canonicalization (Module 8, structurally handled by `ai_line_items.vendor_id`).

### Hard gate before chef go-live (separate from the migration)
- RLS + auth integration (D1).
- Reconciliation alarm live (D10).
- A confirmed end-to-end count submit (the flow has never completed; verify `handleCountSubmit` works post-migration before turning the tool on).

---

## APPENDIX — Divergences from `SMART_INVENTORY_DATA_MODEL.md`
1. item_catalog 3,666 rows (doc: ~2,700).
2. 124 padding columns not present (doc said present).
3. priceAtLastCount 0/3,666 (doc: ~1/2,688) — root cause: no count ever submitted.
4. item_aliases dup clusters 1,126 / 2,270 redundant rows (doc: ~945).
5. learnedBy == source only 93.8% (408 differ) — not pure duplicates.
6. count flow never completed end-to-end (5 drafts) — by design, tool not turned on.
7. review_queue 213 rows with active writers (doc: 41, "no current writer").
8. Module 7 plan is 3 PRs (not 5).
9. No MODULE_7_DATA_AUDIT.md existed (this fills it).
10. No inventory DDL exists (the pr-7-*.sql files are OPD).
11. 30 "other" inactive catalog rows — undocumented status class.
