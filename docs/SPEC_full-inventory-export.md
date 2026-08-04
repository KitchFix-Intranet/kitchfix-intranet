# Spec: full-picture inventory export endpoint (Path A)

**Status:** SPEC PROPOSAL. Not built. Awaiting Kevin's approval.
**Companion doc:** `docs/DIAGNOSTIC_2026-08-04_full-export-decision.md` (evidence + decision rationale).
**Recommended path:** A - union the frozen PG catalog with unreconciled `ai_line_items` in-memory at export time. Read-only.
**Extends:** `GET /api/ops/inventory-export-emergency` shipped in PR #614 (`src/lib/inventoryExport.js` + `src/app/api/ops/inventory-export-emergency/route.js`).

---

## Why this exists

The PR #614 export reads only the frozen PG catalog and misses ~2 months of invoice line items sitting in `ai_line_items`. STL-MO alone has 2,503 unprocessed line items and 530 distinct descriptions (36.5% of its ai_line_items descriptions) that don't match the current catalog. A count sheet built from the frozen catalog alone will not reflect what's actually on the shelf.

Path A gives the chef a sheet that shows:
1. Every currently-known catalog item (as PR #614 does today), plus
2. Every invoice-observed item that is NOT already covered by the catalog, labeled `NEW - NOT IN CATALOG` in the Notes column, so the chef can count it and Kevin/Joe can promote it later.

The endpoint writes nothing. All un-matched items ride in the export only; they never touch `inventory_items`, `item_aliases`, `price_history`, or `review_queue`.

---

## Endpoint

**URL:** `GET /api/ops/inventory-export-full`
**Rationale for the new route rather than extending `/inventory-export-emergency`:** the PR #614 endpoint's name implies "emergency, catalog-only snapshot" and is documented that way in PR body + PROJECT_DASHBOARD. Adding a `?mode=full` toggle would drift the surface. A new route keeps the old one untouched and each URL means one thing. Both endpoints share the same lib file for dedup/normalize/workbook helpers (see §"File structure").

**Method:** GET. Idempotent read-only.

**Auth:** identical to PR #614's route:
- `auth()` from `@/lib/auth` returns 401 JSON when session missing
- Email must be in `["k.fietek@kitchfix.com", "joe@kitchfix.com"]` (mirrors `/api/ops/inventory` allowlist) or return 403 JSON
- No new env vars

**Query parameters:**
| param       | required | shape                        | notes                                                                                       |
|-------------|----------|------------------------------|---------------------------------------------------------------------------------------------|
| `account`   | yes      | URL-friendly account slug    | e.g. `STL-MO`, `STL-FL`, `CIN-OH`, `TXR-TX-H`. Normalized to canonical spaced form (`STL - MO`) inside the route, same helper PR #614 uses. |
| `since`     | no       | ISO date `YYYY-MM-DD`        | Only pull `ai_line_items` rows with `created_at >= since`. Default: `2026-06-04` (day after the freeze). Lets Kevin bound the "new items" pane by date if a bigger backfill window is undesirable. |

**Response:** `200` with binary xlsx body + these headers (identical shape to PR #614):
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="{account}_Full_Inventory_Count_Sheet.xlsx"
Content-Length: <bytes>
Cache-Control: no-store
```

**Error responses:** `400` JSON on missing/bad params, `401`/`403` on auth failures, `500` JSON on read/build failure (never a broken .xlsx).

---

## Output format

Identical structure to PR #614's workbook:

1. **Instructions tab** - updated to explain the two-source picture (see §"Instructions copy" below).
2. **Summary tab** - 4-column formula-driven roll-up (Category / Items Counted / Extended Total / % of Total). Grand total row.
3. **One tab per category** in enum order: Food, Packaging, Supplies, Snacks, Beverages, plus Uncategorized if any items land there. Columns: Item | Unit | Avg Unit Price | Vendor(s) | Last Ordered | Count | Extended Total | Notes.
   - `Count` column amber (`FEF3C7`), empty.
   - `Extended Total` = `IFERROR(F{row}*C{row},0)` with `$#,##0.00;[Red]-$#,##0.00;""` format (blank when Count empty).
   - Frozen rows highlighted `DBEAFE`, sorted to top of each tab.
   - Freeze panes on header row + column A.

**New behavior beyond PR #614:**
- `NEW - NOT IN CATALOG` rows land in their inferred category tab, colored a **distinct light amber background** (`FEF9C3`, one shade lighter than the Count column so it reads as flagged-but-fillable) with `NEW` as the value in the Notes column.
- If `Notes` already had a value from a NEW/frozen-highlight combo, both flags appear semicolon-separated: `NEW; frozen (verify)`.

---

## Categories

Same 5-bucket enum as PR #614's schema audit (`Food`, `Packaging`, `Supplies`, `Snacks`, `Beverages`). Uncategorized only if items land NULL.

For `NEW` rows (which come from `ai_line_items`, not `inventory_items`), the enum doesn't apply directly - `ai_line_items.category` is free text (e.g. `produce`, `dry_goods`, `dairy`, `protein`, `beverage`, `packaging`, `supplies`, `cleaning`, `smallwares`, `other`). Map to the 5-bucket enum via:

| ai_line_items.category (lowercased) | Mapped tab                              |
|-------------------------------------|-----------------------------------------|
| produce, protein, dairy, dry_goods, other-food (whatever is not below) | Food     |
| beverage                            | Beverages                               |
| packaging                           | Packaging                               |
| supplies, cleaning, smallwares      | Supplies                                |
| (anything else, or NULL)            | Uncategorized                           |

There is no `Snacks` mapping from `ai_line_items` (the cron promoted items into `Snacks` by judgment; nothing in the OCR output pre-tags a snack cleanly). NEW rows never land in Snacks under this mapping - acceptable, chef can move them post-count.

---

## Dedup logic

Same `normalize()` from `src/lib/inventoryExport.js` PR #614. Group by `(normKey, unit, category)`. Never merge across categories.

**Union-and-dedup order:**
1. Fetch catalog rows (as PR #614 does): `inventory_items` where `account=X AND status='active'`, joined to `vendors`.
2. Fetch NEW candidates: DISTINCT (`description`, `unit`, `category`) from `ai_line_items` for the account, `created_at >= since`, filtered against the catalog's normalized names + aliases (Q5-style check).
3. Build the group Map keyed by `(normKey, unit, mapped_category)`. Catalog rows come first, so their metadata wins the tie (longest-name canonical, vendors, avg price).
4. For each NEW candidate, if its `(normKey, unit, mapped_category)` key already exists in the Map (because the text match this session found it) - **skip it silently**, catalog covers it. If it does NOT exist - add it with `isNew=true`, empty vendor set, and Avg Unit Price computed from the `ai_line_items.unit_price` values in the source set (mean across the description's rows in the window).
5. Emit the merged list.

**Explicit merge behavior for a description matched by both sources:**
- Metadata wins from catalog (name, vendors, category tab).
- Avg Unit Price: prompt suggested "averaged across both." Practical implementation: only use catalog `price_history` for now; do NOT average in `ai_line_items.unit_price`. Reason: `ai_line_items` may include surcharge rows and OCR line-level quirks that the cron's Claude prompt would have filtered before pricing. If Kevin wants a mix later, we can add it - but PR #614's mean-of-recent-8-price_history semantics is a known-clean signal today.

**Text-match logic** (mirrors Q5 SQL):
- Catalog side: normalize `inventory_items.name` + `item_aliases.alias_text` for this account.
- Candidate side: normalize `ai_line_items.description`.
- Match iff normalized candidate is in the normalized catalog set (name OR alias).
- Normalization: same `normalize()` function from `src/lib/inventoryExport.js`. NOT the schema's `alias_normalized STORED` column, because that strips punctuation more aggressively and would cause different matching in JS vs SQL.

---

## Frozen detection

Same regex as PR #614: `/\b(FROZEN|FRZN|FRZ|IQF)\b/i`. Applied to the canonical display name (longest of the collapsed group).

---

## Exclusion honor

`merge_history` rows with `action='exclude'` mark items the chef has explicitly said "never re-import." Q6 found 3 for STL-MO. These need to be suppressed from BOTH sources:
- If a catalog item is somehow currently active despite an exclude ruling: log a warning to server console; keep in export (data-cleanup problem, not an export-layer decision).
- If a NEW candidate's normalized description matches an excluded item's name: drop the NEW row silently. Do NOT surface as `NEW`.

Query the exclusion list once at the top of the export build:
```sql
SELECT DISTINCT LOWER(TRIM(mhi.item_name)) AS excluded_norm
FROM merge_history mh
JOIN merge_history_items mhi ON mhi.merge_id = mh.id
WHERE mh.account = $1 AND mh.action = 'exclude';
```

Compare on `normalize()`'d strings.

---

## Error handling

- **`ai_scan_status = 'pg_failed'` invoices:** their `ai_line_items` rows may be partial or missing. Ignore - we're reading from `ai_line_items` directly, so anything present is fair game. Kevin monitors `pg_failed` separately.
- **`invoice_date` OCR typos (e.g. year `23026`):** filter with `invoice_date BETWEEN DATE '2020-01-01' AND CURRENT_DATE + INTERVAL '30 days'` before pulling into candidate set. Cheap, prevents the typo from leaking into `Last Ordered` cells.
- **Null prices:** skip in the mean (already the behavior). If NEW row has zero `unit_price` observations (all NULL), emit the row with blank Avg Unit Price - the row is still visible for the chef to count.
- **Null vendor for NEW rows:** display empty string in Vendor(s). NEW rows won't have vendor info unless `ai_line_items.vendor_name` or `vendor_id` resolves - display that string if present, else blank.
- **Aliased-only items** (an alias covers the description but its keeper item is in a different unit or category): treat as unmatched. The dedup key is `(normKey, unit, category)`, so a match by alias only counts when unit + category also agree with what we'd assign the candidate.
- **Empty account query:** if `inventory_items` has zero active rows AND `ai_line_items` has zero rows in the window, return an xlsx with Instructions + Summary showing "no items" - do NOT 404. The endpoint working correctly on an empty account should not look like a broken endpoint.
- **Duplicate `raw` descriptions with variant `unit`:** normalize will collapse the descriptions but the `(normKey, unit, category)` key preserves the split. Correct behavior; matches PR #614.
- **Category-mapping edge case:** an `ai_line_items` row with an unrecognized category free-text value lands in Uncategorized. If Uncategorized is >20% of the NEW rows, log a warning to server console with the top unrecognized values so we can update the map.

---

## Instructions copy (updated for full-picture mode)

The instructions tab in PR #614 has 6 sections. Add a new section 2 titled "Where these items came from" between "How this was built" and "How to count":

> **2. Where these items came from**
>
> Rows without a NEW tag come from the current Smart Inventory catalog. Rows tagged `NEW` in the Notes column were seen on an invoice since {since date} but have not been added to the catalog yet (the nightly reconciliation cron has been silent on this side of the system since 2026-06-04). Count them the same way you count any other item; we will decide later which NEW items to promote to the catalog. If a NEW row looks like a duplicate of a catalog row, count them together on one line and leave a note.

Renumber the existing sections 2-6 to 3-7.

Also update section 4 (was "What might be missing" - now "What might still be missing"):

> Genuinely never-seen items - if a vendor delivered something we have never received or manually added, it will not appear on this sheet. Write it at the bottom of the right tab.
>
> Excluded items - items you or Joe marked "never re-import" (e.g. old plastic tub sizes) will not appear even if a new invoice mentions them.
>
> The `NEW` tag catches items that arrived via invoice but never got promoted; the "genuinely never-seen" gap is only for items that never appeared on any invoice.

---

## File structure

**New file:** `src/app/api/ops/inventory-export-full/route.js`
- ~90 lines. Thin route: auth, param parsing + normalization, calls `buildFullInventoryCountWorkbook`, returns xlsx binary. Mirrors PR #614's route.

**Extended file:** `src/lib/inventoryExport.js`
- Add new export: `buildFullInventoryCountWorkbook({ account, since })`.
- Refactor the internal helpers so `buildInventoryCountWorkbook` (PR #614) and the new function share `normalize()`, `pickLongestName()`, `mean()`, `maxDate()`, `styleHeaderRow()`, `addInstructionsTab()`, `addSummaryTab()`, `addCategoryTab()`. The instructions tab function gains an optional `fullPicture` boolean to swap the copy set.
- Add helpers: `fetchNewCandidates(supa, account, since)`, `fetchExclusions(supa, account)`, `mapAiCategory(text)`.
- `addCategoryTab()` picks up the `isNew` per-row flag and applies the `FEF9C3` background + `NEW` notes value.

**No changes** to PR #614's route file. It stays as shipped.

**No new npm deps.** `exceljs ^4.4.0` and `@supabase/supabase-js ^2.106.2` already present.

**No migrations.** Read-only.

**No changes to** `inventoryActions.js`, the Smart Inventory UI, or the AI similarity scanner.

---

## Estimated size

- New route file: ~90 lines
- inventoryExport.js additions + refactor: ~200 lines added, ~100 lines refactored (extracting shared helpers from PR #614's inline structure)
- Instructions/summary/category tab changes: additive branching, ~40 lines
- Total: ~330 lines net add, ~430 lines touched. One PR.

Test plan additions on top of PR #614's tests:
- Unit: `mapAiCategory` mapping table
- Unit: exclusion normalization + match
- Unit: NEW-vs-catalog merge preferring catalog metadata
- Integration [ran]: run the endpoint against STL-MO in a Vercel preview after deploy, verify:
  - Total row count is roughly 299 + (530 or fewer NEW after exclusion filter) = ~800-900 rows
  - `NEW` rows exist in each of Food / Beverages / Supplies / Packaging (per the mapping)
  - The 3 STL-MO excluded items do NOT appear anywhere
  - Amber Count column stays empty
  - Extended Total blank when Count empty
  - Frozen rows still at the top of each tab

---

## What Path A does NOT do

- Does not write anything to Postgres.
- Does not fix the cron's stopped-writing-to-PG condition (that's Module 7 un-parking or v2 - separate work).
- Does not resolve OCR-typo invoice dates or `pg_failed` submissions - those are pre-existing.
- Does not promote NEW items to the catalog - Kevin/Joe review the NEW tags post-count and either add via admin UI or run the cron.
- Does not solve the Smart Inventory UI timeout on the 802-item catalog - that's still open, still separate.

---

## Rollback

Delete the new route file. `src/lib/inventoryExport.js` refactor is additive; if it needs to revert, revert to the PR #614 shape (git will diff cleanly).

---

## Sign-off checklist

- [ ] Kevin approves Path A recommendation
- [ ] Kevin approves the new route name (`/api/ops/inventory-export-full`)
- [ ] Kevin approves the `?since` default of `2026-06-04`
- [ ] Kevin approves the `mapAiCategory` mapping table (§Categories)
- [ ] Kevin approves the "don't average ai_line_items unit_price into catalog Avg" rule (§Dedup logic)
- [ ] Kevin approves the exclusion-honor rule (§Exclusion honor)
- [ ] Follow-on prompt from Kevin for the build session
