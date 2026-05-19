# Sheets Access Inventory

**Purpose:** Canonical map of Google Sheets access patterns in the intranet codebase as of 2026-05-19, before Bundle 3 consolidation work.

**Generated:** PR #53 sub-phase 0 (recon-only). No code changes; pure mechanical scan + per-file classification.

**Use:** Reference during Bundle 3 consolidation. Identifies which files need migration, which already use helpers, which patterns to consolidate.

## Summary

- Total files touching Sheets: **17**
- CONSOLIDATED: **10** (59%)
- DOWNSTREAM: **1** (6%)
- PARTIAL: **0** (0%)
- DIRECT-ONLY: **1** (6%)
- AUTH-BOUNDARY: **1** (6%)
- AD-HOC-HELPER: **4** (24%)
- READ-ONLY: noted as sub-attribute within CONSOLIDATED (not separate)

**Headline:** 10 of 17 files are already migration-ready. The 6 remaining split into 4 cron-style hand-rolled-JWT files (highest-leverage consolidation target) + 1 direct-API-heavy directory route + 1 user-OAuth-write dashboard. The DOWNSTREAM opsUtils.js is its own peer layer, not a migration target.

**Excluded from inventory** (use googleapis but NOT Sheets): `src/lib/auth.js` (NextAuth config), `src/lib/gmail.js` (Gmail send), `src/lib/drive.js` (Drive ops), `src/lib/incidentActions.js` (Drive folders + Calendar events, zero Sheets).

---

## Helpers currently in sheets.js

19 public exports as of 2026-05-19. The canonical menu other files should use:

**SA-flavored helpers (post-PR-#47/#48 additions in bold):**
- `readSheetSA(spreadsheetId, tabName)` — read all rows of a tab via service account
- `appendRowSA(spreadsheetId, tabName, rowData)` — append a single row via SA
- `appendRowsSA(spreadsheetId, tabName, rowsData)` — append multiple rows via SA
- `updateRangeSA(spreadsheetId, range, values)` — update a 2D range via SA
- `batchUpdateRangesSA(spreadsheetId, data)` — batch update multiple ranges in one call
- `readRangeSA(spreadsheetId, range)` — read a specific range via SA
- **`safeRead(spreadsheetId, tabName)`** — read with fail-soft fallback (returns empty rows on error)
- **`updateCellSA(spreadsheetId, range, value)`** — single-cell SA update
- **`findRowByValueSA(spreadsheetId, tabName, columnIndex, searchValue)`** — find row number by column-value match via SA
- **`getSheetIdSA(spreadsheetId, tabName)`** — resolve numeric sheetId (gid) for a tab via SA
- **`createTabSA(spreadsheetId, tabName)`** — create a new tab via SA batchUpdate
- **`deleteRowSA(spreadsheetId, sheetId, rowIndex)`** — delete a row via SA batchUpdate

**Legacy user-OAuth helpers (kept for routes that need chef-identity audit trail):**
- `readSheet(accessToken, spreadsheetId, tabName)` — read via user OAuth token
- `appendRow(accessToken, spreadsheetId, tabName, rowData)` — append via user OAuth
- `appendRows(accessToken, spreadsheetId, tabName, rowsData)` — append multiple via user OAuth
- `updateCell(accessToken, spreadsheetId, range, value)` — single-cell update via user OAuth
- `findRowByValue(accessToken, spreadsheetId, tabName, columnIndex, searchValue)` — find row via user OAuth

**Auth client factories:**
- `getSheetsClient(accessToken)` — user OAuth Sheets client
- `getServiceAccountSheetsClient()` — SA Sheets client

**Constants + utilities:**
- `SHEET_IDS` — canonical map of all sheet IDs (HUB, COLLECTION, GAME, GL_CODES, AI_LINE_ITEMS, INVENTORY)
- `toObjects(headers, rows)` — convert raw 2D rows to objects keyed by header

**Caching primitives (currently in `opsUtils.js`, not `sheets.js`):** `cachedRead`, `batchRead`, `invalidateCache` — see Missing helpers section for the relocation question.

---

## Files by category

### CONSOLIDATED files

Files using `sheets.js` helpers exclusively for all Sheets operations. Migration-ready as-is.

- `src/lib/sheets.js` (376 lines): the canonical helper file itself. CONSOLIDATED by definition. 19 public exports.
- `src/lib/invoiceActions.js` (1,247 lines): CONSOLIDATED. Uses all 6 new SA helpers + legacy ones. Audited in PR #47. ~50 Sheets call sites all via helpers.
- `src/lib/inventoryActions.js` (1,191 lines): CONSOLIDATED. 94 SHEET_IDS.INVENTORY sites via helpers (cleaned in PR #51 sub-phase 5). Audited in PR #51.
- `src/lib/performanceActions.js` (95 lines): CONSOLIDATED. 1 helper write (`appendRowSA` to COLLECTION audit log). Tiny file.
- `src/lib/performanceChain.js` (108 lines): CONSOLIDATED, READ-ONLY. 1 helper read (`readSheetSA` from HUB.chain).
- `src/lib/performanceAcl.js` (184 lines): CONSOLIDATED, READ-ONLY. 1 helper read (`readSheetSA` from HUB.config).
- `src/app/api/ops/route.js` (1,238 lines): CONSOLIDATED for Sheets access. The `google.auth.OAuth2` at L42 is for Gmail (`google.gmail` at L44), NOT Sheets. All Sheets operations consolidated via helpers per Audits #1/#3 cleanups.
- `src/app/api/people/leadership-dugout/route.js` (537 lines): CONSOLIDATED with a quirky pattern — uses `await import("@/lib/sheets")` dynamic imports at 3 sites (L222, L415, L440, L469) instead of top-level static imports. Functional but unusual. Note for Bundle 3: convert to static imports.
- `src/app/api/service-calendar/route.js` (679 lines): CONSOLIDATED. Clean SA helper usage throughout for multi-sheet (HUB + per-account Drive sheets + COLLECTION) operations.
- `src/lib/wowPlanActions.js` (358 lines): CONSOLIDATED for Sheets. Uses helpers (`readSheetSA`, `appendRowSA`, `updateRangeSA`) for all WOW plan Sheets operations. The `new google.auth.GoogleAuth()` at L309 is for **Google Calendar** (scope `calendar`, `google.calendar({...})` client at L316) creating checkpoint event invites — NOT Sheets. Analogous to drive.js/gmail.js using google.auth for their own non-Sheets services. No migration needed.

### DOWNSTREAM files

Files that ARE the utility/helper layer, building on `sheets.js`. Not call sites to migrate; rather a peer abstraction.

- `src/lib/opsUtils.js` (123 lines): DOWNSTREAM. Imports `SHEET_IDS + readSheetSA + appendRowSA` from sheets.js and re-exports higher-level primitives: `cachedRead`, `batchRead`, `invalidateCache`, `getAccountConfigs`, `getPeriods`, `getCurrentPeriod`, `getAllVendors`, `resolveVendorId`, `opsNotify`, `postSlack`, plus utils `parseNum`, `formatCurrency`, `generateId`. **Design question for Bundle 3:** should `cachedRead`/`batchRead`/`invalidateCache` live in `sheets.js` (the canonical helper file) or stay in `opsUtils.js` (as the "ops-specific caching layer")? Currently split; some files import cache primitives from opsUtils, some from sheets directly. See Missing helpers section.

### DIRECT-ONLY files

Files using direct `google.sheets()` API throughout. Don't import sheets.js helpers (or import only `SHEET_IDS`).

- `src/app/api/directory/route.js` (529 lines): DIRECT-ONLY + secondary AUTH-BOUNDARY characteristic. Imports `readSheet` + `SHEET_IDS` from sheets.js, then creates its own `google.sheets()` client at L54-56 and makes **13 direct API calls**: 6 `spreadsheets.values.update` calls (L290, L352, L377, L440, L474, L499), 4 `spreadsheets.values.append` calls (L324, L419, L482, L506), 1 `spreadsheets.values.clear` at L434, and 2 `spreadsheets.batchUpdate` calls at L406, L522. Auth via `google.auth.OAuth2()` (user OAuth) at L12 and L54. **The user-OAuth-for-writes issue from Audit #1's Directory Concerns 1-4 is structural — bigger than a simple migration.** Highest-priority migration target by surface area.

### AUTH-BOUNDARY files

Files using user OAuth pattern for writes (instead of service account). May or may not use helpers.

- `src/app/api/dashboard/route.js` (401 lines): AUTH-BOUNDARY. Uses `readSheetSA` for reads at L27/47/80/90 (SA path, clean). BUT switches to USER-OAUTH writes for news_interactions: `readSheet(token, ...)` at L341, then `updateCell(token, ...)` at L349/L350/L371/L372/L375/L378/L379/L380, `appendRow(token, ...)` at L352 and L393, and another `readSheet(token, ...)` at L362. **8 user-OAuth write sites for news_interactions** (read+save+acknowledge buttons). **Decision needed:** is this intentional (chef identity in news_interactions audit) or accidental (user OAuth was the only pattern at the time)? Same shape as Audit #1's "Directory Concern 1" and opsNotify duplicate (PR #43) patterns.

### AD-HOC-HELPER files

Files with their own private helper functions that should be promoted to (or replaced by) sheets.js helpers. Includes hand-rolled JWT auth implementations.

- `src/app/api/people/route.js` (2,056 lines): AD-HOC-HELPER. **Hand-rolled JWT path via `getServiceToken` + `importPrivateKey` + `signJwt` (using `crypto.subtle`) at L79-156.** Two scopes returned: `spreadsheets` and `gmail.send`. CLAUDE.md item 1 explicitly flags this: "Two parallel service-account implementations exist. The canonical one lives in `src/lib/sheets.js`. There is a second, hand-rolled JWT path in `src/app/api/people/route.js` (lines 80-151)." Also has local `readSheet` / `appendRow` / `updateCell` / `updateRow` helpers that don't have the `SA` naming suffix despite using the service account. **Bundle 3 highest-priority single-file migration** — likely the longest single piece of consolidation work.
- `src/app/api/cron/backup-sheets/route.js` (139 lines): AD-HOC-HELPER. Has `new google.auth.JWT()` at L38 (hand-rolled JWT for Drive backup). Imports SHEET_IDS from sheets.js but bypasses the auth helper. **Migration:** swap to `getServiceAccountSheetsClient()` from sheets.js.
- `src/app/api/cron/daily/route.js` (338 lines): AD-HOC-HELPER + **DUPLICATE-CONST drift bomb**. Defines its own LOCAL `const SHEET_IDS = {...}` at L9 instead of importing from sheets.js. Has local `readSheet` (L76) and `appendRow` (L92) helpers. Zero imports from sheets.js. **The SHEET_IDS duplication is a real risk: if sheets.js's canonical SHEET_IDS changes, this file silently doesn't.** Same drift bomb pattern as the `VENDOR_ADMIN_EMAILS` dead duplicate we cleaned up in PR #47.
- `src/app/api/cron/incident-reminders/route.js` (247 lines): AD-HOC-HELPER. Triple-pattern surprise: `google.auth.GoogleAuth` at L27, `google.auth.JWT` at L40 (BOTH auth strategies), creates own `google.sheets()` client at L34, has local `updateCell` helper at L78, direct `spreadsheets.values.get` + `spreadsheets.values.update` calls. **Highest pattern-density per LOC of any AD-HOC-HELPER file.**

---

## Missing helpers identified

Patterns that recur across multiple files but don't yet have a helper in sheets.js. Candidates for new Bundle 3 helpers:

1. **`clearRangeSA(spreadsheetId, range)`** — directory/route.js uses `spreadsheets.values.clear()` at L434. No SA equivalent. Used 1 time today but the pattern is real (clear-then-rewrite is common for full-table refreshes).

2. **Generalized `batchUpdateSA` for non-values operations** — `deleteRowSA` (PR #47) handled one case. directory/route.js uses raw `spreadsheets.batchUpdate()` at L406 and L522 for other batchUpdate operations (likely row deletions or sheet manipulations). Either case-specific helpers (per the deleteRowSA pattern) OR a generalized one.

3. **`updateRowSA(spreadsheetId, tabName, rowIndex, rowData)`** — semantic helper for "overwrite this entire row" that's currently spelled as `updateRangeSA(..., 'tab!A${row}:Z${row}', [[...]])` repeatedly. The people/route.js local `updateRow` helper does this; promote to canonical.

4. **`cachedRead` / `batchRead` / `invalidateCache` relocation question** — currently in opsUtils.js. Should they live in sheets.js (alongside other SA helpers) for consistency? Or do they belong in opsUtils as the "ops-specific caching layer"? Currently split is ambiguous: invoiceActions.js doesn't use cache, inventoryActions.js does (via batchRead). Stage 1 design decision.

5. **`promotedJwt` or unified auth helper** — three files have hand-rolled JWT/GoogleAuth that should funnel through `getServiceAccountSheetsClient()`. Not a new helper; an enforcement pattern.

---

## Anti-patterns identified

Surfaced during pass but deferred to future PRs (not strict Bundle 3 scope unless Bundle 3 absorbs them):

1. **Hand-rolled JWT auth in 3 files** (people/route.js, cron/backup-sheets, cron/incident-reminders): each implements its own service-account auth instead of using `getServiceAccountSheetsClient()` from sheets.js. CLAUDE.md item 1 is the existing capture of this issue.

2. **Duplicate SHEET_IDS const in cron/daily/route.js** (L9): a "drift bomb" — if sheets.js SHEET_IDS changes (e.g. a sheet is renamed or replaced), cron/daily silently doesn't update. Same shape as PR #47's VENDOR_ADMIN_EMAILS finding.

3. **Lazy/dynamic `await import("@/lib/sheets")` in leadership-dugout/route.js** (3 sites): functional but unusual. Bundle 3 should convert to standard top-level static imports.

4. **Mixed SA + user-OAuth in single files**: dashboard/route.js (news_interactions writes), directory/route.js (multiple write paths). Each file makes a per-call decision about auth pattern — sometimes appropriate, sometimes not. Audit-as-documentation pass should explicitly mark which is intentional.

5. **8 user-OAuth write sites in dashboard/route.js for news_interactions**: heaviest concentration of user-OAuth writes in a single feature. Either a strong design intent that needs documenting or a missed migration.

6. **No retry-on-rate-limit pattern for SA writes**: `appendRowSA` / `updateRangeSA` / etc. don't retry on 429/quota. The Anthropic callClaude helper has retry (PR #47 / PR #51). Sheets API can return 429 under load. Worth adding for production stability — not Bundle 3 scope but worth a future PR.

---

## Recommended Bundle 3 consolidation scope

Based on this recon, the consolidation work is bigger than the "data layer foundation" framing suggests but smaller than "rewrite everything":

**Estimated effort:** ~10-13 hours total, recommended as **3 PRs** rather than one:

**PR A — Cron consolidation (HIGH priority, 4-6 hours):**
- 4 files: `cron/backup-sheets/route.js`, `cron/daily/route.js`, `cron/incident-reminders/route.js`, `people/route.js`
- Eliminate hand-rolled JWT paths (use `getServiceAccountSheetsClient()`)
- Eliminate duplicate SHEET_IDS const in cron/daily
- Eliminate local ad-hoc helpers (readSheet/appendRow/updateCell variants) in favor of sheets.js helpers
- This is the highest-leverage cleanup: eliminates the "two parallel SA implementations" issue from CLAUDE.md item 1 + the drift-bomb const + 4 file-local helper variants.

**PR B — directory/route.js DIRECT-ONLY migration (HIGH priority, 3-4 hours):**
- Migrate **13** direct `spreadsheets.values/batchUpdate` calls to helpers (6 update + 4 append + 1 clear + 2 batchUpdate)
- Add 1-2 new helpers: `clearRangeSA` (1 site) and possibly `updateRowSA` (semantic improvement)
- Decision: is the user-OAuth write pattern intentional (admin identity in audit) or accidental? Document + either keep with user-OAuth helpers OR migrate to SA.
- This file has the highest direct-API surface area.

**PR C — dashboard/route.js AUTH-BOUNDARY decision (MEDIUM priority, 1-2 hours):**
- Document the news_interactions user-OAuth-write decision: intentional (chef identity in audit) or accidental?
- If intentional: stay on user-OAuth helpers, add BUSINESS_NOTES entry capturing the rationale.
- If accidental: swap 8 write sites to SA helpers.
- Lower priority because dashboard/route is read-heavy + the user-OAuth pattern works today.

**Defer to future PRs (NOT Bundle 3 scope):**
- leadership-dugout lazy-import cleanup (~30 min) — cosmetic, absorb into PR A if energy permits.
- opsUtils caching primitives relocation question — design decision, not migration. Stage 1 design call.
- Retry-on-rate-limit pattern for SA writes — production stability improvement, separate concern from consolidation.
- ~~wowPlanActions L309 google.auth check~~ — RESOLVED during recon: L309 is for Google Calendar (non-Sheets), no migration needed.

**Recommended sequencing:** PR A first (eliminates the documented CLAUDE.md item 1 issue). PR B second (high leverage on directory's surface). PR C third (depends on a product decision before code change).

**Total Bundle 3 consolidation surface:** ~30-40 call sites to migrate (13 in directory + ~17-25 across the 4 AD-HOC files + 8 in dashboard) + 1-2 new helpers added. About half the scale of PR #47 or PR #51, but spread across 6 files instead of 1.

After all three PRs ship, the inventory should look like: 14-16 CONSOLIDATED files, 1 DOWNSTREAM (opsUtils), 0 in DIRECT-ONLY / AUTH-BOUNDARY / AD-HOC-HELPER. That's the "Bundle 3 complete" target state.
