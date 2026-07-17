> **ARCHIVED 2026-07-17** - pre-Sheets-to-Postgres-migration trilogy (code side); the Supabase migration project closed 2026-06-12. Superseded operationally by `docs/MIGRATION_PROJECT_CLOSEOUT.md` + `docs/MIGRATION_STATUS.md`. Companion pieces `SHEETS_AUDIT_DATA_SIDE.md` + `SHEETS_AUDIT_SYNTHESIS.md` archived alongside.

# Sheets Audit - Code Perspective

**Generated:** 2026-05-26 (pre-news_interactions-cutover)
**Scope:** Every Google Sheets read and write operation in `src/`, mapped to spreadsheet, tab, column, file:line, helper, and business action.

This document is the CODE side of a cross-reference exercise. It records what the application code actually does against the sheets. Kevin's xlsx exports of the live sheets are the OTHER side; cross-referencing the two surfaces dead columns, dead tabs, manual-maintenance gaps, and column-shift drift.

**Boundaries:**
- This document does NOT decide what to migrate.
- This document does NOT mark columns dead/alive (that needs Kevin's judgment + the xlsx cross-ref).
- This document DOES inventory and flag pre-existing read-but-never-written bugs (the column-G data-loss class) so they are visible.

**Files audited (17 in `src/`):**
- `src/lib/sheets.js` (the canonical helper layer; defines SHEET_IDS, all SA helpers)
- `src/lib/dataStore.js` (Stage 1 logical data layer; news_interactions adapter)
- `src/lib/incidentSchema.js` (52-column Incidents tab schema)
- `src/lib/performanceSchema.js` (Performance subsystem tab + key constants)
- `src/lib/opsUtils.js` (ops cached readers + opsNotify writer)
- `src/lib/invoiceActions.js` (vendor + invoice flow)
- `src/lib/inventoryActions.js` (Smart Inventory)
- `src/lib/wowPlanActions.js` (WOW Plans helpers)
- `src/lib/performanceActions.js` (audit log writer)
- `src/lib/performanceAcl.js` (config reader)
- `src/lib/performanceChain.js` (chain reader)
- `src/app/api/directory/route.js`
- `src/app/api/dashboard/route.js`
- `src/app/api/people/route.js`
- `src/app/api/people/leadership-dugout/route.js`
- `src/app/api/ops/route.js`
- `src/app/api/service-calendar/route.js`
- `src/app/api/cron/daily/route.js`
- `src/app/api/cron/incident-reminders/route.js`
- `src/app/api/cron/backup-sheets/route.js` (Drive-only; excluded from Sheets audit)

---

## Quick reference

### Spreadsheets (from `src/lib/sheets.js:13-21`)

| ID const | Sheet ID | Role |
|---|---|---|
| `SHEET_IDS.HUB` | `1rvIg9trPCxiEWvzrYbtp1j7V_sbtQnKaysv5BOwA90E` | Pillar 1: Master Hub (read-mostly source of truth) |
| `SHEET_IDS.COLLECTION` | `1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ` | Pillar 2: Data Collection (write-heavy transaction logs) |
| `SHEET_IDS.GAME` | `1BFEGUIjmU56iRsu0Dbnn-x-jF2Bnw8K4BmUZrq6pghs` | Pillar 3: Gamification (PAUSED, no active code touches) |
| `SHEET_IDS.GL_CODES` | `1Gs7ToEvrsraBt81DctgwImKK-ck2Ch6V2ifvF8VndeY` | Pillar 4: Chart of accounts (read-only config) |
| `SHEET_IDS.AI_LINE_ITEMS` | `18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo` | Pillar 5: Invoice line item writes (append-only) |
| `SHEET_IDS.INVENTORY` | `14oROcj9hyQJfKOm-ZXUDn6qvOviZYX1aLMs27V8zZnk` | Smart Inventory (separate spreadsheet) |

### Canonical helpers (from `src/lib/sheets.js`)

| Helper | Signature | Purpose |
|---|---|---|
| `readSheetSA(spreadsheetId, tabName)` | line 65 | Read full tab, returns `{headers, rows}` |
| `safeRead(spreadsheetId, tabName)` | line 232 | Fail-soft wrapper around readSheetSA |
| `readRangeSA(spreadsheetId, range)` | line 211 | Read specific A1 range, returns 2D array |
| `appendRowSA(spreadsheetId, tabName, rowData)` | line 124 | Append one row |
| `appendRowsSA(spreadsheetId, tabName, rowsData)` | line 146 | Append many rows |
| `updateRangeSA(spreadsheetId, range, values)` | line 169 | Update A1-notation range with 2D values |
| `updateCellSA(spreadsheetId, range, value)` | line 245 | Single-cell wrapper around updateRangeSA |
| `updateCellByRowColSA(spreadsheetId, sheetName, row, col, value)` | line 293 | Single-cell by 1-indexed row+col (computes A1 internally) |
| `batchUpdateRangesSA(spreadsheetId, data)` | line 189 | Batch update multiple ranges in one API call |
| `clearRangeSA(spreadsheetId, range)` | line 256 | Clear values in a range (no row shift) |
| `deleteRowSA(spreadsheetId, sheetId, rowIndex)` | line 355 | Delete a row by sheet gid + 0-indexed row |
| `findRowByValueSA(spreadsheetId, tabName, columnIndex, searchValue)` | line 302 | Find 1-indexed row matching value in a column |
| `getSheetIdSA(spreadsheetId, tabName)` | line 317 | Resolve tab gid by name (needed before deleteRowSA) |
| `createTabSA(spreadsheetId, tabName)` | line 334 | Create new tab via batchUpdate |
| `getServiceAccountDriveClient(scopes)` | line 51 | Drive client (used by backup-sheets + directory drive-image proxy) |

Legacy user-OAuth helpers (`readSheet`, `appendRow`, `updateCell`, `appendRows`, `findRowByValue`) exist in `sheets.js` but are NOT used by any active code path as of PR #58. All active call sites use the SA-suffix helpers.

---

# PART 1: Read/Write System Map

Organized by spreadsheet then tab. Every distinct read and write operation across the codebase.

## SHEET_IDS.HUB

### `accounts` tab (Directory's primary write tab; multi-module read)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| directory/route.js:44 | READ | readSheetSA | full tab, A-S (19 cols) | Directory bootstrap |
| directory/route.js:231 | READ | readSheetSA | A only | admin-update-account: find row by TeamKey |
| directory/route.js:302 | READ | readSheetSA | A only | admin-deactivate-account: find row |
| directory/route.js:322 | READ | readSheetSA | A, B, D, E | admin-reactivate-account: find row + read fields for work_locations rebuild |
| directory/route.js:259 | WRITE range | updateRangeSA | `accounts!A${row}:R${row}` (cols A-R, 18 cols) | admin-update-account: full row update |
| directory/route.js:288 | WRITE append | appendRowSA | A-R (18 cols) | admin-add-account |
| directory/route.js:311 | WRITE cell | updateCellSA | `accounts!S${row}` | admin-deactivate-account: set Active=FALSE |
| directory/route.js:331 | WRITE cell | updateCellSA | `accounts!S${row}` | admin-reactivate-account: set Active=TRUE |
| dashboard/route.js:109 | READ | safeRead | A + logoIdx | Bootstrap: team logo lookup |
| people/route.js:381 | READ | readSheetSA | A, B | People Portal bootstrap: locations dropdown |
| people/route.js:1672 | READ | readSheetSA | A, T | Incident submit: site code to region lookup |
| ops/route.js:663 | READ | safeRead | A, B, C | Ops dashboard bootstrap |
| ops/route.js:783 | READ | safeRead | A, B, C | Labor bootstrap |
| service-calendar/route.js:191 | READ | readSheetSA | A, B | Service Calendar bootstrap: key->name lookup |
| opsUtils.js:44 | READ | cachedRead (wraps readSheetSA) | A, B, C | getAccountConfigs cached helper |

### `contacts` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| directory/route.js:46 | READ | readSheetSA | full | Directory bootstrap |
| directory/route.js:345 | READ | readSheetSA | A only | admin-update-contacts: find rows to delete |
| directory/route.js:352 | LOOKUP | getSheetIdSA | tab gid | admin-update-contacts: needed for deleteRowSA |
| directory/route.js:356 | WRITE delete | deleteRowSA | per row | admin-update-contacts: delete all rows for account (bottom-up) |
| directory/route.js:362 | WRITE bulk append | appendRowsSA | A-F (6 cols per row) | admin-update-contacts: re-append new contact set |
| dashboard/route.js:108 | READ | safeRead | A-D | User profile lookup |
| people/route.js:382 | READ | readSheetSA | A, C, D | People Portal bootstrap: managers, first name |
| cron/daily/route.js:110 | READ | readSheetSA | A, D | Past-due inventory notify: contact emails by account |

### `dir_links` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| directory/route.js:45 | READ | readSheetSA | A-E | Directory bootstrap: build linkMap |
| directory/route.js:401 | READ | readSheetSA | A only | writeLinks helper: find row by TeamKey |
| directory/route.js:406 | WRITE range | updateRangeSA | `dir_links!A${row}:E${row}` | writeLinks update branch |
| directory/route.js:409 | WRITE append | appendRowSA | A-E | writeLinks append branch (new account) |

### `work_locations` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| directory/route.js:415 | READ | readSheetSA | A-C | upsertWorkLocation: find row by TeamKey (col B) |
| directory/route.js:429 | READ | readSheetSA | A-C | removeWorkLocation: find row |
| directory/route.js:433 | LOOKUP | getSheetIdSA | tab gid | removeWorkLocation: needed for deleteRowSA |
| directory/route.js:421 | WRITE range | updateRangeSA | `work_locations!A${row}:C${row}` | upsertWorkLocation update branch |
| directory/route.js:423 | WRITE append | appendRowSA | A-C | upsertWorkLocation append branch |
| directory/route.js:434 | WRITE delete | deleteRowSA | full row | removeWorkLocation (called from admin-deactivate-account) |

### `hero_images` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| directory/route.js:47 | READ | readSheetSA | col A | Directory bootstrap |
| directory/route.js:186 | READ | readSheetSA | col A | hero-list admin GET |
| directory/route.js:373 | WRITE clear | clearRangeSA | `hero_images!A:A` | admin-update-heroes: clear column |
| directory/route.js:377 | WRITE range | updateRangeSA | `hero_images!A1` (extends downward) | admin-update-heroes: write new list |
| dashboard/route.js:110 | READ | safeRead | A, B | Hero image selection (type filter for celebration) |
| people/route.js:385 | READ | readSheetSA | flattened all | People Portal bootstrap: random hero |
| ops/route.js:665 | READ | safeRead | flattened all | Ops dashboard hero |
| service-calendar/route.js:181 | READ | readSheetSA | flattened all | Service Calendar bootstrap |

### `admins` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| directory/route.js:48 | READ | readSheetSA | A only | Directory bootstrap: isAdmin check |
| people/route.js:383 | READ | readSheetSA | A, C | People Portal bootstrap: isAdmin + hr flag check |
| cron/daily/route.js | (referenced but not directly read in this file; see notification fan-out) | - | - | - |

### `news_posts` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| dashboard/route.js:26 | READ | readSheetSA | A-L (12 cols) | News feed bootstrap |

### `notifications` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| people/route.js:80 | READ | readSheetSA | A through I (action toggles + email recipients) | Notification recipient lookup by actionKey |

### `period_data` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| dashboard/route.js:112 | READ | safeRead | A-D | Ops metrics (active period, due date) |
| ops/route.js:664 | READ | safeRead | A-D | Ops dashboard bootstrap |
| ops/route.js:784 | READ | safeRead | A-D | Labor bootstrap |
| opsUtils.js:55-57 | READ | cachedRead | A-D | getPeriods cached helper |
| cron/daily/route.js:108 | READ | readSheetSA | A-D | Inventory countdown notification |

### `personnel_celebrations` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| dashboard/route.js:116 | READ | safeRead | A-C | Birthdays/anniversaries today |
| cron/daily/route.js:109 | READ | readSheetSA | A-C | Daily celebration notifications |

### `kitchFix_philosophy` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| dashboard/route.js:111 | READ | safeRead | A only | Random philosophy quote of the day |

### `homestand_schedule` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| ops/route.js:785 | READ | safeRead | A-F | Labor bootstrap: game schedule |
| ops/route.js:101-188 | READ | (via buildLaborContext) | A-F | Labor engine: schedule by account |

### `labor_budgets` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| ops/route.js:667 | READ | safeRead | A-G | Dashboard bootstrap: P3 activity detection |
| ops/route.js:786 | READ | safeRead | A-G | Labor bootstrap |
| ops/route.js:140-148 | READ | (via buildLaborContext) | A-G | Labor engine |
| ops/route.js:465-474 | READ | (via buildPDCContext) | A-G | PDC labor engine |

### `library_manifest` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| people/route.js:478 | READ | readSheetSA | A, C, J | Incident bootstrap: Appendix C lookup |
| people/route.js:812 | READ | readSheetSA | A, C, J | Incident detail: Appendix C URL |

### `ldug_library_manifest` tab (Leadership Dugout)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| people/leadership-dugout/route.js:87 | READ | readSheetSA | A-J (10 cols) | Library manifest list |

### `service_config` tab (HUB)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| service-calendar/route.js:63 | READ | readSheetSA | A-K (11 cols) | Config load: parse service-column positions per account |
| service-calendar/route.js:603 | READ | readSheetSA | A-K | Config update: find specific service row |
| service-calendar/route.js:619 | WRITE cell | updateRangeSA | `service_config!{priceCol}{sheetRow}` | Update PricePerPlate (col F) |
| service-calendar/route.js:624 | WRITE cell | updateRangeSA | `service_config!{activeCol}{sheetRow}` | Deactivate service (col K = FALSE) |
| service-calendar/route.js:654 | WRITE append | appendRowSA | A-K (11 cols) | Add new service row |

### `vendor_master` tab (HUB)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| invoiceActions.js:292 | READ | safeRead | A-E | Bootstrap: vendor dropdown |
| invoiceActions.js:369 | READ | safeRead | A-C | Vendor search |
| invoiceActions.js:716 | READ | safeRead | A, B, I | Invoice OCR: fuzzy-match against aliases |
| invoiceActions.js:876 | READ | safeRead | A, B, J | Vendor add: idempotency check via Client UUID |
| invoiceActions.js:1535 | READ | readSheetSA | A-G | Vendor list |
| invoiceActions.js:1635 | READ | readSheetSA | A-G | Vendor get by ID |
| invoiceActions.js:1743 | READ | readSheetSA | A, B, I | Vendor master update: find row + read aliases |
| invoiceActions.js:1818 | READ | readSheetSA | A, B, I | Learn vendor alias |
| invoiceActions.js:1851 | READ | readSheetSA | A, B | Vendor merge: keeper + dupes |
| invoiceActions.js:908 | WRITE append | appendRowSA | A-J (10 cols) | Vendor add |
| invoiceActions.js:1757 | WRITE cell ×5 | updateCellSA | B, C, D, E, I individually | Vendor master update |
| invoiceActions.js:1839 | WRITE cell | updateCellSA | `vendor_master!I${row}` | Learn alias: append to pipe-delimited list |
| invoiceActions.js:1876 | WRITE range batch | batchUpdateRangesSA | B-E per dupe row | Vendor merge: soft-delete dupes |
| invoiceActions.js:1895 | WRITE cell | updateCellSA | `vendor_master!I${keeperRow}` | Vendor merge: append dupe names to keeper aliases |

### `vendor_accounts` tab (HUB)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| invoiceActions.js:293 | READ | safeRead | C-S | Bootstrap: account-vendor links |
| invoiceActions.js:1536 | READ | readSheetSA | A-W | Vendor list link map |
| invoiceActions.js:1636 | READ | readSheetSA | B-W subset | Vendor get: account links |
| invoiceActions.js:1690 | READ | readSheetSA | B-R | Vendor update: find existing row |
| invoiceActions.js:1792 | READ | readSheetSA | B, C | Vendor activate/deactivate: find row |
| invoiceActions.js:1854 | READ | readSheetSA | B only | Vendor merge: reassign account rows |
| invoiceActions.js:941 | WRITE append | appendRowSA | A-X (24 cols) | Vendor add: link to account |
| invoiceActions.js:1718 | WRITE range | updateRangeSA | `vendor_accounts!D${row}:R${row}` (15 cols) | Vendor update: account fields |
| invoiceActions.js:1719 | WRITE cell | updateCellSA | `vendor_accounts!W${row}` | Vendor update: account notes (non-contiguous) |
| invoiceActions.js:1797 | WRITE cell | updateCellSA | `vendor_accounts!S${row}` | Activate/deactivate (col S) |
| invoiceActions.js:1860 | WRITE range batch | batchUpdateRangesSA | B per row | Vendor merge: reassign vendorId to keeper |

### `HUB__Performance_Chain` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| performanceChain.js:22 | READ | readSheetSA | A-L (12 cols, see CHAIN_COL) | Load all chain entries |

### `HUB__Performance_System_Config` tab (key/value layout, col A=field, col B=value)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| performanceAcl.js:17 | READ | readSheetSA | A, B | Parse config keys |
| people/leadership-dugout/route.js:442 | READ | readSheetSA | A, B | Find test_mode_enabled row |
| people/leadership-dugout/route.js:459 | WRITE range | updateRangeSA | `${TABS.CONFIG}!B${rowNumber}` | Toggle test_mode_enabled |

### `HUB__Cycle_Calendar` tab

**SCHEMA-DECLARED BUT UNUSED.** Declared as `TABS.CALENDAR` in `performanceSchema.js:16`. Zero code reads or writes.

---

## SHEET_IDS.COLLECTION

### `news_interactions` tab (Stage 1 PR 1 - now via dataStore)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| dataStore.js:86 | READ | readSheetSA | A-F (6 cols) | Sheets adapter: read all rows, filter by user |
| dataStore.js:102 | READ | readSheetSA | A-F | Sheets adapter: locate row for upsert |
| dataStore.js:113 | WRITE cell | updateCellSA | `news_interactions!C${row}` | Sheets adapter: set read flag |
| dataStore.js:118-122 | WRITE cell | updateCellSA | `news_interactions!D${row}` | Sheets adapter: set readAt |
| dataStore.js:127 | WRITE cell | updateCellSA | `news_interactions!E${row}` | Sheets adapter: set saved |
| dataStore.js:132-136 | WRITE cell | updateCellSA | `news_interactions!F${row}` | Sheets adapter: set acknowledged |
| dataStore.js:150 | WRITE append | appendRowSA | A-F (6 cols) | Sheets adapter: new row for first interaction |
| dashboard/route.js:48 | READ (via dataStore) | getNewsInteractions | - | Bootstrap user interactions |
| dashboard/route.js:352 | WRITE (via dataStore) | upsertNewsInteraction | {read, readAt} | news-read action |
| dashboard/route.js:354 | WRITE (via dataStore) | upsertNewsInteraction | {saved} | news-save action |
| dashboard/route.js:356 | WRITE (via dataStore) | upsertNewsInteraction | {read, readAt, acknowledged} | news-ack action |

### `submissions` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| dashboard/route.js:85 | READ | readSheetSA | B (submitter), I (status) | People Portal metrics |
| people/route.js:384 | READ | readSheetSA | B, C, I | Bootstrap: counts by status and module |
| people/route.js:513 | READ | readSheetSA | A-J | History: user's submissions |
| people/route.js:625 | READ | readSheetSA | A-J | Admin queue bootstrap |
| people/route.js:715 | READ | readSheetSA | A-J | Admin detail pane |
| people/route.js:1116 | READ | readSheetSA | B, D, F | Admin-process: notification context |
| people/route.js:912 | WRITE range | updateRangeSA | `submissions!A${row}:{lastCol}${row}` (10 cols) | New hire edit upsert |
| people/route.js:913 | WRITE append | appendRowSA | A-J (10 cols) | New hire create |
| people/route.js:973 | WRITE range | updateRangeSA | same 10-col range | PAF edit upsert |
| people/route.js:974 | WRITE append | appendRowSA | A-J | PAF create |
| people/route.js:1096 | WRITE cell | updateCellByRowColSA | col 9 (I) | Status update (Withdrawn/Cancelled/Complete/Rejected) |
| people/route.js:1097 | WRITE cell | updateCellByRowColSA | col 10 (J) | Status notes |
| people/route.js:1098 | WRITE cell | updateCellByRowColSA | col 11 (K) | Admin action timestamp |
| people/route.js:1107 | WRITE cell | updateCellByRowColSA | col 9 (I) | Admin-process status (duplicate of 1096 path) |
| people/route.js:1111 | WRITE cell | updateCellByRowColSA | col 10 (J) | Admin-process notes |
| people/route.js:1112 | WRITE cell | updateCellByRowColSA | col 11 (K) | Admin-process timestamp |

### `drafts` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| people/route.js:386 | READ | readSheetSA | B, C | Bootstrap: user's drafts |
| people/route.js:583 | READ | readSheetSA | A, B, D | Load-draft |
| people/route.js:1040 | READ | readSheetSA | A, B | Save-draft: find row to upsert |
| people/route.js:1057 | READ | readSheetSA | A, B | Delete-draft: find row to clear |
| people/route.js:1047 | WRITE range | updateRangeSA | `drafts!A${row}:{lastCol}${row}` (4 cols A-D) | Upsert draft (edit case) |
| people/route.js:1049 | WRITE append | appendRowSA | A-D | Create draft |
| people/route.js:1063 | WRITE clear | clearRangeSA | `drafts!A${row}:D${row}` | Delete draft |

### `notification_log` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| people/route.js:595 | READ | readSheetSA | A-I | Notification Center bootstrap |
| people/route.js:1078 | READ | readSheetSA | B, H | Mark-all-read: filter by recipient + unread |
| cron/daily/route.js:111 | READ | readSheetSA | A, E, G | Daily cron dedup check |
| people/route.js:296 | WRITE append | appendRowSA | A-G (7 cols) | Log notification event from People Portal |
| opsUtils.js:98 | WRITE append | appendRowSA | A-G (7 cols) | opsNotify: log notification event (writes "bell" channel) |
| cron/daily/route.js:29 | WRITE append | appendRowSA | A-G | Daily cron notifications |
| people/route.js:1071 | WRITE cell | updateCellByRowColSA | col 8 (H) | Mark single notification read |
| people/route.js:1084 | WRITE cell (in Promise.all loop) | updateCellByRowColSA | col 8 (H) per row | Mark-all-read bulk |

### `Incidents` tab (52 columns - see incidentSchema.js INCIDENT_COLUMNS)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| people/route.js:545 | READ | readSheetSA | all 52 cols | History: user's incidents (via rowToIncident) |
| people/route.js:661 | READ | readSheetSA | all | Admin queue bootstrap |
| people/route.js:756 | READ | readSheetSA | all | Admin detail pane |
| people/route.js:794 | READ | readSheetSA | A only | Status change: validate target exists |
| people/route.js:1196 | READ | readSheetSA | A only | Submit: generate next incident ID |
| people/route.js:1434 | READ | readSheetSA | A, V (col 22) | Status change: find row by ID |
| people/route.js:1495 | READ | readSheetSA | all | Re-read post-update for notification |
| people/route.js:1520 | READ | readSheetSA | A, AN (col 40) | Add-note: read current notes |
| people/route.js:1564 | READ | readSheetSA | A only | Update-investigation: find row |
| people/route.js:1608 | READ | readSheetSA | all | Re-read post-investigation-save |
| cron/incident-reminders/route.js:52 | READ | readSheetSA | all 52 cols | 7-day reminder scan |
| people/route.js:1346 | WRITE append | appendRowSA | all 52 cols (via incidentToRow) | Incident submit |
| people/route.js:1351 | WRITE append | appendRowSA | all 52 cols | Incident submit retry after ensureIncidentsTab |
| people/route.js:1466 | WRITE cell | updateCellByRowColSA | col.status (idx 21 -> col V) | Status change: update status |
| people/route.js:1467 | WRITE cell | updateCellByRowColSA | col.last_updated_at (idx 40 -> col AO) | Status change audit |
| people/route.js:1468 | WRITE cell | updateCellByRowColSA | col.last_updated_by (idx 41 -> col AP) | Status change audit |
| people/route.js:1472 | WRITE cell | updateCellByRowColSA | col.acknowledged_by (idx 22 -> col W) | Status->acknowledged |
| people/route.js:1473 | WRITE cell | updateCellByRowColSA | col.acknowledged_at (idx 23 -> col X) | Status->acknowledged |
| people/route.js:1475 | WRITE cell | updateCellByRowColSA | col.investigating_assignee (idx 24 -> col Y) | Status->investigating |
| people/route.js:1476 | WRITE cell | updateCellByRowColSA | col.investigating_started_at (idx 25 -> col Z) | Status->investigating |
| people/route.js:1478 | WRITE cell | updateCellByRowColSA | col.closed_by (idx 31 -> col AF) | Status->closed |
| people/route.js:1479 | WRITE cell | updateCellByRowColSA | col.closed_at (idx 32 -> col AG) | Status->closed |
| people/route.js:1483 | WRITE cell | updateCellByRowColSA | col.corrective_action_completed_at (idx 30 -> col AE) | Status->closed-from-CA: stamp completion |
| people/route.js:1538 | WRITE cell | updateCellByRowColSA | col.internal_notes (idx 39 -> col AN) | Add-note: append timestamped note |
| people/route.js:1539 | WRITE cell | updateCellByRowColSA | col.last_updated_at | Add-note audit |
| people/route.js:1540 | WRITE cell | updateCellByRowColSA | col.last_updated_by | Add-note audit |
| people/route.js:1587 | WRITE cell (in loop) | updateCellByRowColSA | col[key] for whitelisted investigation fields (root_cause, corrective_action, corrective_action_owner, corrective_action_due, preventive_action, preventive_action_owner, preventive_action_completed_at) | Update-investigation: write each provided field |
| people/route.js:1593 | WRITE cell | updateCellByRowColSA | col.last_updated_at | Update-investigation audit |
| people/route.js:1594 | WRITE cell | updateCellByRowColSA | col.last_updated_by | Update-investigation audit |
| people/route.js:1600 | WRITE cell | updateCellByRowColSA | col.investigation_saved_at (idx 48 -> col AW) | First save stamp |
| people/route.js:1601 | WRITE cell | updateCellByRowColSA | col.status | First save: auto-advance status to "investigated" |
| people/route.js:1632 | WRITE cell | updateCellByRowColSA | col.investigation_edit_log (idx 49 -> col AX) | Re-edit: append audit log JSON |
| people/route.js:1747 | WRITE range (headers) | updateRangeSA | row 1, all 52 cols | ensureIncidentsTab: write headers when tab is created |
| cron/incident-reminders/route.js:151 | WRITE cell | updateCellSA | `Incidents!{colLetter}${row}` where colLetter resolves to col.reminder_7day_sent_at (idx 51 -> col AZ) | Mark 7-day reminder sent (dedupe) |

### `invoice_submissions_26` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| invoiceActions.js:353 | READ | safeRead | A-W (23 cols, via parseSubmissionRow) | Recent submissions in account |
| invoiceActions.js:380 | READ | safeRead | A-W | Invoice history per account |
| invoiceActions.js:392 | READ | safeRead | A-W | Admin list by period |
| invoiceActions.js:1028 | READ | readSheetSA | A-W subset | F25 idempotency check |
| invoiceActions.js:1094 | LOOKUP | findRowByValueSA | col 0 (A) | Find by UUID (correctedFromUuid) |
| invoiceActions.js:1117 | LOOKUP | findRowByValueSA | col 0 (A) | Find row to mark email-sent |
| invoiceActions.js:1172 | READ | safeRead | E, G, H, I, N, V | Duplicate detection |
| invoiceActions.js:1202 | LOOKUP | findRowByValueSA | col 0 (A) | Reject invoice: locate target |
| invoiceActions.js:1206 | READ | safeRead | C-G, I | Reject invoice: notification context |
| invoiceActions.js:1265 | LOOKUP | findRowByValueSA | col 0 (A) | Unreject invoice: locate |
| invoiceActions.js:1268 | READ | safeRead | C, D, E, G | Unreject context |
| invoiceActions.js:1301 | LOOKUP | findRowByValueSA | col 0 (A) | Dismiss-dupe: locate |
| invoiceActions.js:1315 | LOOKUP | findRowByValueSA | col 0 (A) | Delete-dupe: locate |
| invoiceActions.js:1088 | WRITE append | appendRowSA | A-W (23 cols) | Invoice submit |
| invoiceActions.js:1097 | WRITE range | updateRangeSA | `invoice_submissions_26!N${row}:O${row}` | Submit: mark original as "corrected" + timestamp |
| invoiceActions.js:1118 | WRITE cell | updateCellSA | `invoice_submissions_26!M${row}` | Mark emailSent=TRUE |
| invoiceActions.js:1216-1218 | WRITE range batch | batchUpdateRangesSA | N:O (status, ts) + R:U (rejection metadata) | Invoice reject: status="returned" |
| invoiceActions.js:1276-1278 | WRITE range batch | batchUpdateRangesSA | N:O (status="sent", ts) + R:U (clear rejection) | Invoice unreject |
| invoiceActions.js:1304 | WRITE cell | updateCellSA | `invoice_submissions_26!W${row}` | Dismiss-dupe: W="not_duplicate" |
| invoiceActions.js:1322 | WRITE delete | deleteRowSA | full row | Delete-dupe (admin) |

### Service Calendar tabs (COLLECTION)

#### `service_audit_log_26` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| service-calendar/route.js:515 | WRITE append | appendRowSA | 8 cols | Log submit_actuals |
| service-calendar/route.js:588 | WRITE append | appendRowSA | 8 cols | Log submit_clickers |
| service-calendar/route.js:630 | WRITE append | appendRowSA | 8 cols | Log config_update |
| service-calendar/route.js:657 | WRITE append | appendRowSA | 8 cols | Log config_add |
| service-calendar/route.js:670 | WRITE append | appendRowSA | 8 cols | Log config_request |

No reads of this tab in any file. Append-only.

#### `service_day_overrides_26` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| service-calendar/route.js:242 | READ | readSheetSA | A-H (8 cols) | Load day overrides for account |
| service-calendar/route.js:543 | WRITE append | appendRowSA | A-H (8 cols) | Add day override (add_service / mark_closed) |

### Ops collection tabs

#### `inventory_submissions` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| ops/route.js:666 | READ | safeRead | A-M (13 cols) | Dashboard bootstrap log display |
| ops/route.js:757 | READ | safeRead | A-M | Inventory history |
| ops/route.js:979 | READ | safeRead | A only | Submit-inventory: idempotency |
| ops/route.js:997 | WRITE append | appendRowSA | A-M (13 cols) | Submit-inventory |

#### `labor_plans` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| ops/route.js:787 | READ | safeRead | A-O (15 cols) | Labor bootstrap |
| ops/route.js:1080 | READ | safeRead | A, D, E, I | Submit-labor-actuals: idempotency + streak |
| ops/route.js:1131 | WRITE append | appendRowSA | A-O (15 cols) | Submit-labor-actuals |

#### `labor_sold_revenue` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| ops/route.js:789 | READ | safeRead | A-E (5 cols) | Labor bootstrap |
| ops/route.js:1162 | WRITE append | appendRowSA | A-E | Submit-sold-revenue |

#### `deep_clean_days` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| ops/route.js:788 | READ | safeRead | A-D (4 cols) | Labor bootstrap |
| ops/route.js:1180 | WRITE append | appendRowSA | A-D | Add deep clean day |

### Performance / Leadership Dugout tabs (COLLECTION)

#### `COLL__WOW_Plans_Header` tab (21 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| wowPlanActions.js:124 | READ | readSheetSA | A-U (21 cols) | Load all plan headers |
| wowPlanActions.js:214 | WRITE append | appendRowSA | A-U (21 cols) | Create plan header |
| wowPlanActions.js:238-240 | WRITE range ×3 | updateRangeSA | L, T, U single cells | Status update + audit |
| wowPlanActions.js:248 | WRITE range | updateRangeSA | M / N / O / P based on signedDay (Day1/30/60/90 signed_at) | Checkpoint sign-off timestamp |
| wowPlanActions.js:277-280 | WRITE range | updateRangeSA | T:U (bump last_action) | Post-body-save header bump |
| people/leadership-dugout/route.js:228 | WRITE range | updateRangeSA | `${tab}!R${idx + 4}` (col R, CALENDAR_EVENT_IDS) | Store calendar event IDs |
| people/leadership-dugout/route.js:421 | WRITE range | updateRangeSA | `${tab}!Q${idx + 4}` (col Q, PDF_DRIVE_ID) | Store rendered PDF ID at close |
| people/leadership-dugout/route.js:494 | WRITE range (via wipeTab) | batchUpdateRangesSA | full row per [TEST] match | Admin: wipe test data |

#### `COLL__WOW_Plans_Body` tab (12 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| wowPlanActions.js:154 | READ | readSheetSA | A-L (12 cols) | Load body by plan ID |
| wowPlanActions.js:260 | READ | readSheetSA | A-L | Re-read body to locate row before update |
| wowPlanActions.js:215 | WRITE append | appendRowSA | A-L | Create body with initial JSON cols |
| wowPlanActions.js:269 | WRITE range | updateRangeSA | `${tab}!${columnLetter}${row}` (caller specifies col C-L) | Autosave section |

#### `COLL__Performance_Audit_Log` tab

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| performanceActions.js:36 | WRITE append | appendRowSA | A-H (8 cols) | Log WOW Plan actions |
| people/leadership-dugout/route.js:496 | WRITE range (via wipeTab) | batchUpdateRangesSA | full row per [TEST] match | Admin: wipe test data |

No reads of this tab.

#### `COLL__Cycle_Review_Header`, `COLL__Cycle_Review_Body`, `COLL__Scorecards` tabs

**SCHEMA-DECLARED BUT UNUSED.** Declared in `performanceSchema.js:23-27`. Zero code reads or writes. Cycle Review backend is stubbed; ships in Chunks 4-5 per `leadership-dugout/route.js:35` comment.

---

## SHEET_IDS.INVENTORY (Smart Inventory subsystem - all ops in inventoryActions.js)

### `item_catalog` tab (~19 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:33-36 | READ | batchRead | A-S (cols 0-18) | Bootstrap full active state |
| inventoryActions.js:325 | READ | batchRead | A-N | catalogGet UI display |
| inventoryActions.js:373-382 | READ | readSheetSA | A-G | verifyPrice |
| inventoryActions.js:404 | READ | readSheetSA | A-G | batchMoveItems |
| inventoryActions.js:476-490 | READ | batchRead | A-H | AI similarity dedup |
| inventoryActions.js:612-615 | READ | batchRead | A-H | Merge: collect itemIds for remap |
| inventoryActions.js:734-756 | READ | readSheetSA | A-G, R | reviewAccept |
| inventoryActions.js:766-782 | READ | readSheetSA | A, C, Q-R | reviewDelete |
| inventoryActions.js:794-809 | READ | readSheetSA | A-C | excludeItem |
| inventoryActions.js:913-965 | READ | readSheetSA | B, D, F | saveLocations auto-assign |
| inventoryActions.js:1071-1089 | READ | readSheetSA | all | dedupCatalog scan |
| inventoryActions.js:1157-1166 | READ | readSheetSA | A, B | updateCatalogItem |
| inventoryActions.js:1175-1193 | READ | readSheetSA | C | archiveItem |
| inventoryActions.js:1198-1216 | READ | readSheetSA | C | reactivateItem |
| inventoryActions.js:350-355 | WRITE append | appendRowSA | A-S (18 explicit cols) | addItem new catalog entry |
| inventoryActions.js:291 | WRITE range batch | batchUpdateRangesSA | K per row | Submit: backfill priceAtLastCount |
| inventoryActions.js:378-382 | WRITE range batch | batchUpdateRangesSA | H, I, J, S (price + verified) | verifyPrice |
| inventoryActions.js:412 | WRITE range batch | batchUpdateRangesSA | F per row | batchMoveItems |
| inventoryActions.js:627 | WRITE range | updateRangeSA | `item_catalog!C${row}:E${row}` | Merge: update keeper name/cat/unit |
| inventoryActions.js:645 | WRITE range | updateRangeSA | L (active=FALSE) | Merge: deactivate merged |
| inventoryActions.js:669 | WRITE range | updateRangeSA | F (locationId) | Merge: inherit location |
| inventoryActions.js:680 | WRITE range | updateRangeSA | R (notes) | Merge: append merged notes |
| inventoryActions.js:740 | WRITE range | updateRangeSA | C:E (name/cat/unit) | reviewAccept |
| inventoryActions.js:742 | WRITE range | updateRangeSA | F (locationId) | reviewAccept location |
| inventoryActions.js:753 | WRITE range | updateRangeSA | Q (reviewStatus=reviewed) | reviewAccept |
| inventoryActions.js:774-777 | WRITE range batch | batchUpdateRangesSA | L (FALSE) + Q (review_deleted) | reviewDelete |
| inventoryActions.js:798-801 | WRITE range batch | batchUpdateRangesSA | L (FALSE) + Q (excluded) | excludeItem |
| inventoryActions.js:947 | WRITE range | updateRangeSA | F | saveLocations auto-assign by keyword |
| inventoryActions.js:958 | WRITE range | updateRangeSA | F | saveLocations auto-assign by category |
| inventoryActions.js:1135 | WRITE range | updateRangeSA | op.range (variable) | dedupCatalog ops |
| inventoryActions.js:1161 | WRITE range batch | batchUpdateRangesSA | D (category), R (notes) | updateCatalogItem |
| inventoryActions.js:1178-1181 | WRITE range batch | batchUpdateRangesSA | L (FALSE) + Q (archived) | archiveItem |
| inventoryActions.js:1201-1204 | WRITE range batch | batchUpdateRangesSA | L (TRUE) + Q (clear) | reactivateItem |

### `storage_locations` tab (10 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:79-87 | READ | batchRead | A-F, I, J | Bootstrap |
| inventoryActions.js:820-843 | READ | readSheetSA | A-F, I, J | saveLocations: existing rows |
| inventoryActions.js:979-986 | READ | readSheetSA | A, B | saveSortOrder |
| inventoryActions.js:1000-1013 | READ | readSheetSA | B, E, F, I | addSubZone: max sortOrder |
| inventoryActions.js:1025-1034 | READ | readSheetSA | A-F | updateLocation |
| inventoryActions.js:1045-1057 | READ | readSheetSA | A, B | deactivateLocation |
| inventoryActions.js:823 | WRITE range | updateRangeSA | `storage_locations!I1:J1` (headers) | Ensure new col headers exist |
| inventoryActions.js:840-843 | WRITE range | updateRangeSA | A-J (10 cols) | saveLocations: update top-level |
| inventoryActions.js:849-852 | WRITE append | appendRowSA | A-J | saveLocations: new top-level |
| inventoryActions.js:868-871 | WRITE range | updateRangeSA | A-J | saveLocations: update sub-zone |
| inventoryActions.js:875-878 | WRITE append | appendRowSA | A-J | saveLocations: new sub-zone |
| inventoryActions.js:889 | WRITE range | updateRangeSA | E:F (sortOrder=999, active=FALSE) | saveLocations: deactivate removed |
| inventoryActions.js:984 | WRITE range batch | batchUpdateRangesSA | E per row | saveSortOrder |
| inventoryActions.js:1011-1014 | WRITE append | appendRowSA | A-J | addSubZone |
| inventoryActions.js:1029-1031 | WRITE range batch | batchUpdateRangesSA | C, D, J | updateLocation (name, icon, color) |
| inventoryActions.js:1048 | WRITE range | updateRangeSA | E:F | deactivateLocation |

### `item_aliases` tab (4 cols core + extended)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:33-36 | READ | batchRead | B, C, D | Bootstrap aliases |
| inventoryActions.js:476-490 | READ | batchRead | B, C, D | AI similarity context |
| inventoryActions.js:612-615 | READ | batchRead | A-G | Merge: collect for remap |
| inventoryActions.js:1071-1089 | READ | readSheetSA | all | dedupCatalog scan |
| inventoryActions.js:648-651 | WRITE append | appendRowSA | 8-col row (extended schema; see anomalies) | Merge: create forward alias |
| inventoryActions.js:656 | WRITE range batch | batchUpdateRangesSA | C (itemId) per row | Merge: remap alias targets |

### `price_history` tab (7 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:33-36 | READ | batchRead | A, B, C, D, E, G | Price movers |
| inventoryActions.js:612-615 | READ | batchRead | A | Merge: collect for remap |
| inventoryActions.js:1071-1089 | READ | readSheetSA | all | dedupCatalog |
| inventoryActions.js:357-359 | WRITE append | appendRowSA | A-G | addItem: log initial price |
| inventoryActions.js:384-385 | WRITE append | appendRowSA | A-G | verifyPrice: log verification |
| inventoryActions.js:663 | WRITE range batch | batchUpdateRangesSA | A per row | Merge: remap to keeper |

### `count_sessions` tab (14 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:33-36 | READ | batchRead | B-H | Find sessions for account |
| inventoryActions.js:243 | READ | batchRead | A-H | Submit: locate session row |
| inventoryActions.js:205 | WRITE append | appendRowSA | 14 cols | Start session (draft) |
| inventoryActions.js:271-280 | WRITE range batch | batchUpdateRangesSA | F-N (status, submitter, totals) | Submit: finalize |

### `count_items` tab (13 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:33-36 | READ | batchRead | A-M | Bootstrap |
| inventoryActions.js:255-259 | READ | batchRead | A, C, F, H | Submit: category totals |
| inventoryActions.js:229 | WRITE append (bulk) | appendRowsSA | 13 cols per item | Save count for location |

### `merge_history` tab (10 cols, audit log)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:476-490 | READ | batchRead | B, F, G, H | AI similarity: recent merges |
| inventoryActions.js:698-703 | WRITE append | appendRowSA | A-J (10 cols) | Log merge |
| inventoryActions.js:719-725 | WRITE append | appendRowSA | A-J | Log keep_separate |
| inventoryActions.js:778-781 | WRITE append | appendRowSA | A-J | Log review_delete |
| inventoryActions.js:803-806 | WRITE append | appendRowSA | A-J | Log exclude |
| inventoryActions.js:1182-1185 | WRITE append | appendRowSA | A-J | Log archive |
| inventoryActions.js:1205-1208 | WRITE append | appendRowSA | A-J | Log reactivate |

### `zone_corrections` tab (9 cols)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:746-750 | WRITE append | appendRowSA | A-I | reviewAccept: log zone correction if user choice != AI suggestion |

No reads. Append-only audit.

### `review_queue` tab (referenced)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| inventoryActions.js:33-36 | READ | batchRead | F, J | Filter pending for account |

No writes observed in inventoryActions.js. (Possibly written by an AI/scanner module not in scope of this audit.)

---

## SHEET_IDS.GL_CODES

### Per-account GL tabs (12 distinct, resolved via GL_TAB_MAP)

`invoiceActions.js:99-114` defines GL_TAB_MAP mapping account keys to tab names:

| Account key | GL_CODES tab name |
|---|---|
| `CORP` | `CORP` |
| `CIN - AZ` | `CIN - AZ (REDS)` |
| `CIN - KY` | `CIN - KY (LBATS)` |
| `CIN - OH` | `CIN - OH (CINN)` |
| `STL - FL` | `STL - FL` |
| `STL - MO` | `STL - MO` |
| `TBJ - FL` | `TBJ - FL` |
| `TBJ - BUF` | `TBJ - BUF` |
| `TBR - FL` | `TBR - FL` |
| `TXR - AZ` | `TXR - AZ` |
| `TXR - HOME` / `TXR - TX - H` | `TXR - Home` |
| `TXR - VISTOR` / `TXR - TX - V` | `TXR - Vistor` |

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| invoiceActions.js:343 | READ | readSheetSA | A, B | Bootstrap: load GL codes for account |
| invoiceActions.js:987 | READ | readSheetSA | A, B | Invoice submit: enrich GL rows with human names |

All read-only. No code writes GL_CODES tabs.

---

## SHEET_IDS.AI_LINE_ITEMS

### `Invoice Uploads` tab (fallback) + per-account tabs (created dynamically)

| File:line | Op | Helper | Cols/range | Business action |
|---|---|---|---|---|
| invoiceActions.js:126 | LOOKUP | getSheetIdSA | tab gid | ensureLineItemTab: check existence |
| invoiceActions.js:129 | TAB CREATE | createTabSA | new tab | ensureLineItemTab: create if missing |
| invoiceActions.js:136 | WRITE append | appendRowSA | A-O (15 cols, LINE_ITEM_HEADERS) | First-time header write on tab creation |
| invoiceActions.js:1496 | WRITE bulk append | appendRowsSA | A-O per row | AI scan: write extracted line items to `metadata.account` tab |
| invoiceActions.js:1499 | WRITE bulk append | appendRowsSA | A-O per row | AI scan fallback: write to `Invoice Uploads` if tab creation failed |

LINE_ITEM_HEADERS (`invoiceActions.js:117-121`):
```
[Invoice UUID, Timestamp, Account, Vendor, Invoice #, Invoice Date,
 Line #, Item Description, Quantity, Unit, Unit Price, Extended Price,
 Category, Confidence, Raw JSON]
```

No reads. Append-only.

---

## SHEET_IDS.GAME

**PAUSED.** No active code reads or writes. Excluded from cron backup. Mentioned only in `SHEET_IDS` constant and comments in `sheets.js:16`.

---

# PART 2: Tab Inventory

One row per tab. Classification + readers + writers.

| Spreadsheet | Tab | Class | Read by | Written by | Natural key |
|---|---|---|---|---|---|
| HUB | accounts | ACTIVELY-USED | directory, dashboard, people, ops, service-calendar, opsUtils | directory only | TeamKey (col A, raw) |
| HUB | contacts | ACTIVELY-USED | directory, dashboard, people, cron-daily | directory only | (TeamKey + email) verified unique today; synthetic UUID recommended |
| HUB | dir_links | ACTIVELY-USED | directory only | directory only | TeamKey (1:1 with accounts) |
| HUB | work_locations | ACTIVELY-USED | directory only | directory only | TeamKey (col B; derived data) |
| HUB | hero_images | ACTIVELY-USED | directory, dashboard, people, ops, service-calendar | directory only | flat URL list (no PK) |
| HUB | admins | READ-ONLY-CONFIG | directory, people | NONE | email (col A) |
| HUB | news_posts | READ-ONLY-CONFIG | dashboard | NONE | postId (col A) |
| HUB | notifications | READ-ONLY-CONFIG | people | NONE | actionKey (col A) |
| HUB | period_data | READ-ONLY-CONFIG | dashboard, ops, opsUtils, cron-daily | NONE | period label (col A) |
| HUB | personnel_celebrations | READ-ONLY-CONFIG | dashboard, cron-daily | NONE | date (col A) |
| HUB | kitchFix_philosophy | READ-ONLY-CONFIG | dashboard | NONE | none (flat text list) |
| HUB | homestand_schedule | READ-ONLY-CONFIG | ops | NONE | (account, date) |
| HUB | labor_budgets | READ-ONLY-CONFIG | ops | NONE | (account, period) |
| HUB | library_manifest | READ-ONLY-CONFIG | people | NONE | file_id |
| HUB | ldug_library_manifest | READ-ONLY-CONFIG | leadership-dugout | NONE | file_id (col A) |
| HUB | service_config | ACTIVELY-USED | service-calendar | service-calendar | (AccountKey, ServiceName) compound |
| HUB | vendor_master | ACTIVELY-USED | invoiceActions, opsUtils | invoiceActions | vendor_id (col A) |
| HUB | vendor_accounts | ACTIVELY-USED | invoiceActions | invoiceActions | (vendor_id, account_key) compound |
| HUB | HUB__Performance_Chain | READ-ONLY-CONFIG | performanceChain | NONE (seeded externally) | leader_email (col A) |
| HUB | HUB__Performance_System_Config | ACTIVELY-USED | performanceAcl, leadership-dugout | leadership-dugout (test_mode toggle only) | key (col A) |
| HUB | HUB__Cycle_Calendar | **SCHEMA-DECLARED-BUT-UNUSED** | NONE | NONE | - |
| COLLECTION | news_interactions | ACTIVELY-USED (via dataStore) | dataStore (dashboard) | dataStore (dashboard) | (post_id, user_email) compound |
| COLLECTION | submissions | ACTIVELY-USED | dashboard, people | people | submission_id (col A) presumed; positional indexing throughout |
| COLLECTION | drafts | ACTIVELY-USED | people | people | (email, module) compound |
| COLLECTION | notification_log | ACTIVELY-USED | people, cron-daily | people, opsUtils, cron-daily | notification_id (col A) presumed |
| COLLECTION | Incidents | ACTIVELY-USED | people, cron-incident-reminders | people, cron-incident-reminders | incident_id (col A) |
| COLLECTION | invoice_submissions_26 | ACTIVELY-USED | invoiceActions | invoiceActions | invoice_uuid (col A) |
| COLLECTION | service_audit_log_26 | ACTIVELY-USED (write-only) | NONE | service-calendar | audit_id (col A) presumed |
| COLLECTION | service_day_overrides_26 | ACTIVELY-USED | service-calendar | service-calendar | (account, date) compound |
| COLLECTION | Projections - 2026 | ACTIVELY-USED (read-only here; per-account spreadsheet) | service-calendar | NONE in this codebase | (date, serviceColIdx) grid |
| COLLECTION | Actuals - 2026 | ACTIVELY-USED (per-account spreadsheet) | service-calendar | service-calendar | (date, serviceColIdx) grid |
| COLLECTION | Clicker Counts - 2026 | ACTIVELY-USED (write-only; per-account spreadsheet) | NONE | service-calendar | (date, colIdx) grid |
| COLLECTION | inventory_submissions | ACTIVELY-USED | ops | ops | uuid (col A) |
| COLLECTION | labor_plans | ACTIVELY-USED | ops | ops | planId (col A) |
| COLLECTION | labor_sold_revenue | ACTIVELY-USED | ops | ops | (account, homestandId) |
| COLLECTION | deep_clean_days | ACTIVELY-USED | ops | ops | (account, date) |
| COLLECTION | COLL__WOW_Plans_Header | ACTIVELY-USED | wowPlanActions, leadership-dugout | wowPlanActions, leadership-dugout | plan_uuid (col A) |
| COLLECTION | COLL__WOW_Plans_Body | ACTIVELY-USED | wowPlanActions | wowPlanActions | plan_uuid (col A) |
| COLLECTION | COLL__Performance_Audit_Log | ACTIVELY-USED (write-only) | NONE | performanceActions, leadership-dugout | audit_uuid (col A) |
| COLLECTION | COLL__Cycle_Review_Header | **SCHEMA-DECLARED-BUT-UNUSED** | NONE | NONE | - |
| COLLECTION | COLL__Cycle_Review_Body | **SCHEMA-DECLARED-BUT-UNUSED** | NONE | NONE | - |
| COLLECTION | COLL__Scorecards | **SCHEMA-DECLARED-BUT-UNUSED** | NONE | NONE | - |
| INVENTORY | item_catalog | ACTIVELY-USED | inventoryActions | inventoryActions | item_id (col A) |
| INVENTORY | item_aliases | ACTIVELY-USED | inventoryActions | inventoryActions | alias_id (col A) |
| INVENTORY | price_history | ACTIVELY-USED | inventoryActions | inventoryActions | (item_id, date) presumed |
| INVENTORY | storage_locations | ACTIVELY-USED | inventoryActions | inventoryActions | location_id (col A) |
| INVENTORY | count_sessions | ACTIVELY-USED | inventoryActions | inventoryActions | session_id (col A) |
| INVENTORY | count_items | ACTIVELY-USED | inventoryActions | inventoryActions | (session_id, item_id, location) compound |
| INVENTORY | merge_history | ACTIVELY-USED (mostly append) | inventoryActions (AI similarity context only) | inventoryActions | merge_id (col A) |
| INVENTORY | zone_corrections | ACTIVELY-USED (write-only) | NONE | inventoryActions | correction_id (col A) |
| INVENTORY | review_queue | ACTIVELY-USED (read-only here) | inventoryActions | NONE (in inventoryActions; possibly written elsewhere) | unclear |
| GL_CODES | CORP | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) compound |
| GL_CODES | CIN - AZ (REDS) | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | CIN - KY (LBATS) | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | CIN - OH (CINN) | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | STL - FL | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | STL - MO | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | TBJ - FL | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | TBJ - BUF | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | TBR - FL | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | TXR - AZ | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | TXR - Home | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| GL_CODES | TXR - Vistor | READ-ONLY-CONFIG | invoiceActions | NONE | (account, code) |
| AI_LINE_ITEMS | Invoice Uploads | ACTIVELY-USED (write-only fallback) | NONE | invoiceActions | per-row line_item |
| AI_LINE_ITEMS | {per-account dynamic tabs} | ACTIVELY-USED (write-only) | NONE | invoiceActions (createTabSA + appendRowsSA) | per-row line_item |
| GAME | (all tabs) | PAUSED | NONE | NONE | - |

---

# PART 3: Column Map

Per-tab column-by-column inventory. For each actively-used tab, every column the code interacts with by position, and where in the code that interaction happens.

## HUB / accounts (cols A-S, 19 cols)

| Col | Idx | Name (from comment in directory/route.js:96-99) | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | TeamKey (raw, source-of-truth) | directory:44/231/302/322 (every find-by-key); dashboard:109; people:381/1672; ops:663/783; service-calendar:191; opsUtils:44 | directory:259 (range), directory:288 (append) |
| B | 1 | Team Name | directory:44 (bootstrap); people:381; ops:663/783; service-calendar:191; opsUtils:44 | directory:259, 288 |
| C | 2 | Level (MLB / PDC / MiLB) | directory:44 (bootstrap, normalizeLevel); ops:663/783; opsUtils:44 | directory:259, 288 |
| D | 3 | City | directory:44; directory:322 (reactivate-account reads to rebuild work_locations) | directory:259, 288 |
| E | 4 | State | directory:44; directory:322 | directory:259, 288 |
| F | 5 | Season | directory:44 | directory:259, 288 |
| G | 6 | Stadium Name | directory:44 | directory:259, 288 |
| H | 7 | Stadium Header URL (img) | directory:44 | directory:259, 288 |
| I | 8 | Logo URL | directory:44; dashboard:109 (logoIdx lookup) | directory:259, 288 |
| J | 9 | Address | directory:44 | directory:259, 288 |
| K | 10 | Lat | directory:44 | directory:259, 288 |
| L | 11 | Long | directory:44 | directory:259, 288 |
| M | 12 | Timezone | directory:44 | directory:259, 288 |
| N | 13 | Wifi SSID | directory:44 | directory:259, 288 |
| O | 14 | Wifi Pass | directory:44 | directory:259, 288 |
| P | 15 | Gate Code | directory:44 | directory:259, 288 |
| Q | 16 | Door Code | directory:44 | directory:259, 288 |
| R | 17 | gmap Drive link (gmapImg) | directory:44 | directory:259, 288 |
| S | 18 | Active (TRUE/FALSE) | directory:44 | directory:311 (deactivate), directory:331 (reactivate) - **NOT included in admin-update-account's A:R range write** |
| T | 19 | Region | people:1672 (only read site, incident escalation) | NONE |

**Note:** people/route.js:1672 reads col T (Region) which directory/route.js does NOT read or write. Region is populated externally (manual sheet entry).

## HUB / contacts (sheet has cols A-J, 10 cols; code touches A-G)

| Col | Idx | Header (from live sheet recon) | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | TeamKey | directory:44/46/345; dashboard:108; people:382; cron-daily:110 | directory:362 (bulk append, col 0 of new row) |
| B | 1 | Role | directory:44 (bootstrap r[1]) | directory:362 (col 1 of new row) |
| C | 2 | Name | directory:44 (r[2]); dashboard:108; people:382 | directory:362 (col 2) |
| D | 3 | Email | directory:44 (r[3]); dashboard:108; people:382; cron-daily:110 | directory:362 (col 3) |
| E | 4 | Phone | directory:44 (r[4]) | directory:362 (col 4) |
| F | 5 | Slack Handle | directory:44 (r[5]) | directory:362 (col 5) |
| **G** | **6** | **Slack User ID** | **directory:44 (r[6] -> slackId)** | **NONE - read-but-never-written** |
| H | 7 | Kiosk Emails | NONE | NONE |
| I | 8 | Manager | NONE | NONE |
| J | 9 | Region | NONE | NONE |

**Flagged:** col G (Slack User ID) is read at directory:91 but the admin-update-contacts append path writes only A-F (6 cols). Cols H/I/J are untouched by code; per Kevin: manual reference notes, not load-bearing.

## HUB / dir_links (5 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | TeamKey | directory:45 (bootstrap); directory:401 | directory:406 (range), 409 (append) |
| B | 1 | Homestand URL | directory:45 | directory:406, 409 |
| C | 2 | SLA URL | directory:45 | directory:406, 409 |
| D | 3 | Service Calendars URL | directory:45 | directory:406, 409 |
| E | 4 | Drive URL | directory:45 | directory:406, 409 |

## HUB / work_locations (3 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | Location Name (computed display string) | directory:415, 429 | directory:421 (range), 423 (append) |
| B | 1 | TeamKey (NATURAL PK in this tab) | directory:415 (find by col B), 429 | directory:421, 423 |
| C | 2 | Team Name | directory:415, 429 | directory:421, 423 |

Delete: directory:434 (whole row by sheetId + idx).

## HUB / hero_images (1 col conventionally; service-calendar reads col B as type)

| Col | Idx | Name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | URL | directory:47, 186; dashboard:110; people:385; ops:665; service-calendar:181 | directory:373 (clear), 377 (range-write down from A1) |
| B | 1 | type (celebration etc) | dashboard:110 only | NONE - **read-but-never-written by any code** |

## HUB / admins (1-2 cols read)

| Col | Idx | Name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | Email | directory:48; people:383 | NONE |
| C | 2 | hr_flag (TRUE/FALSE) | people:383 (admin check requires col A + col C "hr"=TRUE) | NONE |

Note: directory:48 only reads col A. people:383 also reads col C with a stricter "hr"=TRUE rule. Mentioned in CLAUDE.md note (PR #57): inconsistent flag model across modules.

## HUB / news_posts (12 cols, all read at dashboard:26)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A-L | 0-11 | postId, title, body, tag, pinned, author, publishDate, expiresDate, countdownLabel, countdownDate, link, active | dashboard:26 (full row consumption) | NONE - **fully read-only** |

## HUB / notifications (9 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | actionKey | people:80 | NONE |
| B | 1 | enabled1 | people:80 | NONE |
| C | 2 | email1 | people:80 | NONE |
| D | 3 | enabled2 | people:80 | NONE |
| E | 4 | email2 | people:80 | NONE |
| F | 5 | enabled3 | people:80 | NONE |
| G | 6 | email3 | people:80 | NONE |
| H | 7 | enabled4 | people:80 | NONE |
| I | 8 | email4 | people:80 | NONE |

## HUB / period_data (4 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | label | dashboard:112; ops:664/784; opsUtils:55-57; cron-daily:108 | NONE |
| B | 1 | start | same | NONE |
| C | 2 | end | same | NONE |
| D | 3 | dueDate | same | NONE |

## HUB / personnel_celebrations (3 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | date | dashboard:116; cron-daily:109 | NONE |
| B | 1 | headline | same | NONE |
| C | 2 | type (Birthday / Anniversary) | same | NONE |

## HUB / kitchFix_philosophy (1 col)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | standard text | dashboard:111 | NONE |

## HUB / homestand_schedule (6 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | account | ops:785 (bootstrap); ops:101-188 (labor context) | NONE |
| B | 1 | date | same | NONE |
| C | 2 | dayOfWeek | same | NONE |
| D | 3 | dayType (GAME / PREP / OPEN / CLOSE / CLEAN) | same | NONE |
| E | 4 | opponent | same | NONE |
| F | 5 | homestandId (HS1 etc) | same | NONE |

## HUB / labor_budgets (7 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | account | ops:667/786; opsUtils; ops:140-148, 465-474 | NONE |
| B | 1 | period | same | NONE |
| C | 2 | hourlyBudget | same | NONE |
| D | 3 | salaryBudget | same | NONE |
| E | 4 | revenue | same | NONE |
| F | 5 | foodBudget | same | NONE |
| G | 6 | packagingBudget | same | NONE |

## HUB / library_manifest (10 cols, but code only reads 3)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | file_id | people:478, 812 | NONE |
| C | 2 | title | people:478, 812 | NONE |
| J | 9 | active flag | people:478, 812 | NONE |

Cols B, D, E, F, G, H, I are likely populated externally but the people module reads only A, C, J. **Likely read-but-never-written by any code** but possibly populated by manual sheet entry. Worth cross-referencing the xlsx.

## HUB / ldug_library_manifest (10 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | drive_file_id | leadership-dugout:87 | NONE |
| B | 1 | category | leadership-dugout:87 | NONE |
| C | 2 | title | leadership-dugout:87 | NONE |
| D | 3 | version | leadership-dugout:87 | NONE |
| E | 4 | updated_at | leadership-dugout:87 | NONE |
| F | 5 | description | leadership-dugout:87 | NONE |
| G | 6 | pinned | leadership-dugout:87 | NONE |
| H | 7 | critical | leadership-dugout:87 | NONE |
| I | 8 | sort_order | leadership-dugout:87 | NONE |
| J | 9 | active | leadership-dugout:87 | NONE |

Fully read-only. Populated externally.

## HUB / service_config (11 cols)

| Col | Idx | Header (from service-calendar/route.js:63 header-key mapping) | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | AccountKey | service-calendar:63, 603 | service-calendar:654 (append) |
| B | 1 | Category | 63, 603 | 654 only |
| C | 2 | SpreadsheetId | 63, 603 | 654 only |
| D | 3 | GroupName | 63, 603 | 654 only |
| E | 4 | ServiceName | 63, 603 | 654 only |
| F | 5 | PricePerPlate | 63, 603 | 619 (cell), 654 |
| G | 6 | ServiceColIndex | 63, 603 | 654 only |
| H | 7 | MetaColCount | 63, 603 | 654 only |
| I | 8 | TaxFree | 63, 603 | 654 only |
| J | 9 | SortOrder | 63, 603 | 654 only |
| K | 10 | Active | 63, 603 | 624 (cell, set FALSE), 654 |

## HUB / vendor_master (10 cols)

| Col | Idx | Name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | Vendor ID | invoiceActions:292, 369, 716, 876, 1535, 1635, 1743, 1818, 1851 | invoiceActions:908 (append) |
| B | 1 | Vendor Name | 292, 369, 716, 876, 1535, 1635, 1743, 1818, 1851 | 908, 1757, 1876 (merge soft-delete) |
| C | 2 | Category | 292, 369, 1535, 1635, 1743 | 908, 1757, 1876 |
| D | 3 | Website | 292, 1535, 1635, 1743 | 908, 1757, 1876 |
| E | 4 | Notes | 292, 1535, 1635, 1743 | 908, 1757, 1876 |
| F | 5 | Created By (email) | 1535, 1635 | 908 |
| G | 6 | Created At (ISO) | 1535, 1635 | 908 |
| **H** | **7** | **Last Invoice Date** | **NONE** | **908 (append "")** |
| I | 8 | Aliases (pipe-delimited) | 716, 876, 1535, 1818, 1851 | 908 (append ""), 1757, 1839 (alias learn), 1895 (merge append) |
| J | 9 | Client UUID (F19b idempotency key) | 876 (idempotency check) | 908 (append) |

**Col H is appended once as empty string but never read or updated. Effectively dead.**

## HUB / vendor_accounts (24 cols)

| Col | Idx | Name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | Row ID | invoiceActions:1545 | 941 |
| B | 1 | Vendor ID | 293, 1536, 1574, 1642, 1691, 1794, 1854 | 941, 1860 (merge reassign) |
| C | 2 | Account Key | 293, 1546, 1574, 1643, 1692, 1794 | 941 |
| D | 3 | Customer Account # | 293, 1547, 1574, 1691, 1699 | 941, 1718 |
| E | 4 | Sales Rep Name | 293, 1548 | 941, 1718 |
| F | 5 | Sales Rep Phone | 293, 1549 | 941, 1718 |
| G | 6 | Sales Rep Email | 293, 1550 | 941, 1718 |
| H | 7 | Delivery Days | 293, 1551 | 941, 1718 |
| I | 8 | Cutoff Time | 293, 1552 | 941, 1718 |
| J | 9 | Delivery Method | 293, 1553 | 941, 1718 |
| K | 10 | Portal URL | 293, 1554 | 941, 1718 |
| L | 11 | Portal Username | 293, 1555 | 941, 1718 |
| M | 12 | Portal Password | 293, 1556 | 941, 1718 |
| N | 13 | Contact Name | 293, 1557 | 941, 1718 |
| O | 14 | Contact Email | 293, 1558 | 941, 1718 |
| P | 15 | Contact Phone | 293, 1559 | 941, 1718 |
| Q | 16 | Payment Terms | 293, 1560 | 941, 1718 |
| R | 17 | Min Order | 293, 1561 | 941, 1718 |
| S | 18 | Active | 293, 1562, 1599 | 941, 1797 (toggle) |
| T | 19 | Created By | 1563 | 941 |
| U | 20 | Created At | 1564 | 941 |
| **V** | **21** | **Reserved (Phase 2 F11 placeholder)** | **NONE** | **941 (append empty)** |
| W | 22 | Account Notes | 1565, 1670 | 941, 1719 |
| X | 23 | Client UUID (F19b) | 917 (idempotency) | 941 |

**Col V is appended empty but never read or updated. Effectively dead (marked as "Phase 2 F11" placeholder in code comment).**

## HUB / HUB__Performance_Chain (12 cols, see CHAIN_COL in performanceSchema.js:155-168)

| Col | Idx | CHAIN_COL name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | LEADER_EMAIL | performanceChain:22 (filter rows by "@" in col A) | NONE |
| B | 1 | LEADER_NAME | performanceChain:96 | NONE |
| C | 2 | ROLE | performanceChain:98 | NONE |
| D | 3 | ACCOUNT | performanceChain:99 | NONE |
| E | 4 | CONTRACT_TYPE | performanceChain:100 | NONE |
| F | 5 | REVIEWER_EMAIL | performanceChain:101 | NONE |
| G | 6 | REVIEWER_NAME | performanceChain:102 | NONE |
| H | 7 | OVERSIGHT_EMAIL | performanceChain:103 | NONE |
| I | 8 | OVERSIGHT_NAME | performanceChain:104 | NONE |
| J | 9 | CHAIN_EFFECTIVE_DATE | performanceChain:105 | NONE |
| K | 10 | CHAIN_STATUS | performanceChain:106 | NONE |
| L | 11 | NOTES | performanceChain:107 | NONE |

**Entire tab is read-only. Seeded externally.**

## HUB / HUB__Performance_System_Config (key/value, 2 cols)

| Col | Idx | Role | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | key/field name (one of CONFIG_KEYS values) | performanceAcl:17; leadership-dugout:442 | NONE |
| B | 1 | value | performanceAcl:17; leadership-dugout:442 | leadership-dugout:459 (only for test_mode_enabled key) |

**Of the 15 CONFIG_KEYS declared in performanceSchema.js:171-187, only 3 are actually consumed by code:**
- `test_mode_enabled` (read at performanceAcl:36 + leadership-dugout:446; write at leadership-dugout:459)
- `system_viewer_emails` (read at performanceAcl:77)
- `test_calendar_recipient` (read at performanceAcl:43)

**The other 12 CONFIG_KEYS (HR_EMAIL, VP_OPS_EMAIL, SR_DIR_OPS_EMAIL, DIRECTOR_CULINARY_EMAIL, DELTA_FLAG_THRESHOLD, RESPONSE_WINDOW_DAYS, CALIBRATION_SLA_DAYS, WOW_PLAN_PRE_DAY1_DAYS, WOW_PLAN_SHARE_DAYS, CO_EDITOR_WARN_MINUTES, SECTION10_LOCK_SECONDS, CELL_SIZE_WARN_PCT, CELL_SIZE_BLOCK_PCT, SEASON_TRACKER_STALE_HOURS) are declared as constants but never read or written.** They may be referenced in the live sheet for human inspection / future plumbing.

## COLLECTION / news_interactions (6 cols, schema documented in dataStore.js)

| Col | Idx | Name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | postId | dataStore:86, 102 (find row by PK) | dataStore:150 (append) |
| B | 1 | userEmail (lowercased + trimmed) | dataStore:86, 102 | dataStore:150 |
| C | 2 | read (TRUE/FALSE) | dataStore:86 | dataStore:113 (cell), 150 (append) |
| D | 3 | readAt (ISO string or "") | dataStore:86 | dataStore:118-122, 150 |
| E | 4 | saved (TRUE/FALSE) | dataStore:86 | dataStore:127, 150 |
| F | 5 | acknowledged (TRUE/FALSE) | dataStore:86 | dataStore:132-136, 150 |

## COLLECTION / submissions (10 cols, see SUB constant in people/route.js:51-66)

| Col | Idx (0-based) | 1-indexed | Name | READ at | WRITE at |
|---|---|---|---|---|---|
| A | 0 | 1 | TIMESTAMP | people:513, 625, 715 | people:913, 974 (append-create only) |
| B | 1 | 2 | SUBMITTER | dashboard:85; people:384/398/513/518/625/1041/1120 | 913, 974 (append-create only) |
| C | 2 | 3 | MODULE | people:384/399/513/519/625/1042 | 913, 974 |
| D | 3 | 4 | EMPLOYEE | people:513/520/625/715/1120 | 913, 974 |
| E | 4 | 5 | LOCATION | people:625, 715 | 913, 974 |
| F | 5 | 6 | ACTION_TYPE | people:513/521/625/715/1122 | 913, 974 |
| G | 6 | 7 | EFFECTIVE | people:625, 715 | 913, 974 |
| H | 7 | 8 | PAYLOAD | people:513/524/583/587/625/715 | 913, 974 |
| I | 8 | 9 | STATUS (SUB.STATUS_COL=9 in 1-indexed cell ops) | dashboard:85; people:384/400/513/522/625/715 | 913, 974, **1096, 1107 (status updates)** |
| J | 9 | 10 | NOTES (SUB.NOTES_COL=10) | people:513/523/625/715/1108 | 913, 974, **1097, 1111 (status notes)** |
| **K** | **10** | **11** | **ADMIN_ACTION (SUB.ADMIN_ACTION_COL=11)** | **NONE - never read positionally** | **1098, 1112 (admin action timestamp)** |

**Col K is WRITE-only. The code never reads it positionally; it's a server-stamped audit value.**

## COLLECTION / drafts (4 cols)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | email | people:386, 583, 1040, 1057 | 1045, 1047 |
| B | 1 | module | people:386, 583, 1042, 1060 | 1045, 1047 |
| C | 2 | timestamp | NONE - **read-but-never-written read inverted: written but never read** | 1045, 1047 |
| D | 3 | payload | people:587 (load-draft) | 1045, 1047, 1063 (clear) |

**Col C (timestamp) is WRITE-only.**

## COLLECTION / notification_log (7 written cols + col H/I for read flag)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | timestamp | cron-daily:111 (dedup) | people:296; opsUtils:97; cron-daily:29 |
| B | 1 | recipient | people:1081 (mark-all-read filter) | same writers |
| C | 2 | channel | NONE - **write-only** | same |
| D | 3 | subject | NONE - **write-only** | same |
| E | 4 | eventType | cron-daily:111 (dedup) | same |
| F | 5 | status | NONE - **write-only** | same |
| G | 6 | relatedInfo | cron-daily:111 (dedup) | same |
| **H** | **7** | **read_flag (positional 0-indexed)** | **people:1083 (check if already read)** | **NONE - read-but-never-written by positional path** |
| I | 8 | marked_read (1-indexed col 8) | NONE | people:1071, 1084 (mark-as-read) |

**SUSPICIOUS:** Code reads col H (idx 7, "is this read?") but writes col I (1-indexed col 8 == 0-indexed col H). The naming overlap is misleading: `updateCellByRowColSA(spreadsheetId, tab, row, 8, "TRUE")` writes to 1-indexed col 8 which is 0-indexed col H. So the read at `r[7]` (col H) IS the same cell as the write at `col 8` (also col H). They're consistent. The H/I distinction in this audit comes from confusing 0-indexed vs 1-indexed conventions in the source agent's report. **Treating col H as both read AND written.** No actual mismatch.

## COLLECTION / Incidents (52 cols, see INCIDENT_COLUMNS in incidentSchema.js:159-244)

Read patterns: full-row reads via `rowToIncident()` helper consume all 52 cols. Most cols are READ as part of bootstrap/admin-pane operations.

Write patterns: append (full 52-col row via `incidentToRow()`) + targeted cell updates via `updateCellByRowColSA`.

| Col | Idx (0-based) | 1-indexed | INCIDENT_COLUMNS name | Section | READ | WRITE |
|---|---|---|---|---|---|---|
| A | 0 | 1 | incident_id | Identity | people:1196/1434/1495/1520/1564/1608/545/661/756/794; cron-incident-reminders:52 | people:1346/1351 (append) |
| B | 1 | 2 | submitted_at | Identity | (via rowToIncident) | append only |
| C | 2 | 3 | submitted_by_name | Identity | (via rowToIncident) | append only |
| D | 3 | 4 | submitted_by_email | Identity | (via rowToIncident) | append only |
| E | 4 | 5 | submitter_role | Identity | (via rowToIncident) | append only |
| F | 5 | 6 | incident_type | Universal | (via rowToIncident) | append only |
| G | 6 | 7 | severity | Universal | (via rowToIncident) | append only |
| H | 7 | 8 | site_code | Universal | (via rowToIncident) | append only |
| I | 8 | 9 | incident_date | Universal | (via rowToIncident) | append only |
| J | 9 | 10 | incident_time | Universal | (via rowToIncident) | append only |
| K | 10 | 11 | location_detail | Universal | (via rowToIncident) | append only |
| L | 11 | 12 | manager_aware_date | Universal | (via rowToIncident) | append only |
| M | 12 | 13 | what_happened | Universal | (via rowToIncident) | append only |
| N | 13 | 14 | witnesses | Universal | (via rowToIncident) | append only |
| O | 14 | 15 | type_specific_data (JSON) | Type-specific | (via rowToIncident) | append only |
| P | 15 | 16 | drive_folder_id | Attachments | (via rowToIncident) | append only |
| Q | 16 | 17 | drive_folder_url | Attachments | (via rowToIncident) | append only |
| R | 17 | 18 | attachment_count | Attachments | (via rowToIncident) | append only |
| S | 18 | 19 | attachment_summary | Attachments | (via rowToIncident) | append only |
| T | 19 | 20 | notifications_sent | Notification log | (via rowToIncident) | append only |
| U | 20 | 21 | s1_escalation_at | Notification log | (via rowToIncident) | append only |
| V | 21 | 22 | status | Status & lifecycle | people:1434, 1495 + rowToIncident | append + 1466 (status change), 1601 (auto-investigated) |
| W | 22 | 23 | acknowledged_by | Status & lifecycle | (via rowToIncident) | append + 1472 |
| X | 23 | 24 | acknowledged_at | Status & lifecycle | (via rowToIncident) | append + 1473 |
| Y | 24 | 25 | investigating_assignee | Status & lifecycle | (via rowToIncident) | append + 1475 |
| Z | 25 | 26 | investigating_started_at | Status & lifecycle | (via rowToIncident) | append + 1476 |
| AA | 26 | 27 | root_cause | Status & lifecycle | (via rowToIncident) | append + 1587 (if in EDITABLE) |
| AB | 27 | 28 | corrective_action | Status & lifecycle | (via rowToIncident) | append + 1587 |
| AC | 28 | 29 | corrective_action_owner | Status & lifecycle | (via rowToIncident) | append + 1587 |
| AD | 29 | 30 | corrective_action_due | Status & lifecycle | (via rowToIncident) | append + 1587 |
| AE | 30 | 31 | corrective_action_completed_at | Status & lifecycle | (via rowToIncident) | append + 1483 |
| AF | 31 | 32 | closed_by | Status & lifecycle | (via rowToIncident) | append + 1478 |
| AG | 32 | 33 | closed_at | Status & lifecycle | (via rowToIncident) | append + 1479 |
| AH | 33 | 34 | employee_check_in_due | Employee check-in | (via rowToIncident) | append only |
| AI | 34 | 35 | employee_check_in_completed_at | Employee check-in | (via rowToIncident) | append only |
| AJ | 35 | 36 | claim_submitted_date | Workers' Comp | (via rowToIncident) | append only |
| AK | 36 | 37 | claim_number | Workers' Comp | (via rowToIncident) | append only |
| AL | 37 | 38 | claim_handler_name | Workers' Comp | (via rowToIncident) | append only |
| AM | 38 | 39 | claim_handler_contact | Workers' Comp | (via rowToIncident) | append only |
| AN | 39 | 40 | internal_notes | Internal admin | people:1520 (current notes) + rowToIncident | append + 1538 (add-note) |
| AO | 40 | 41 | last_updated_at | Internal admin | (via rowToIncident) | append + 1467, 1539, 1593 |
| AP | 41 | 42 | last_updated_by | Internal admin | (via rowToIncident) | append + 1468, 1540, 1594 |
| AQ | 42 | 43 | immediate_actions_taken | SOP v2.1 | (via rowToIncident) | append only |
| AR | 43 | 44 | preventive_action | SOP v2.1 | (via rowToIncident) | append + 1587 |
| AS | 44 | 45 | preventive_action_owner | SOP v2.1 | (via rowToIncident) | append + 1587 |
| AT | 45 | 46 | preventive_action_completed_at | SOP v2.1 | (via rowToIncident) | append + 1587 |
| AU | 46 | 47 | root_cause_due_at | SOP v2.1 | (via rowToIncident) | append only |
| AV | 47 | 48 | corrective_action_due_at | SOP v2.1 | (via rowToIncident) | append only |
| AW | 48 | 49 | investigation_saved_at | Phase 4C | (via rowToIncident) | append + 1600 (first-save) |
| AX | 49 | 50 | investigation_edit_log | Phase 4C | (via rowToIncident) | append + 1632 (re-edit) |
| AY | 50 | 51 | calendar_event_id | Phase 4C | (via rowToIncident) | append only |
| **AZ** | **51** | **52** | **reminder_7day_sent_at** | Phase 4C | (via rowToIncident) | **append + cron-incident-reminders:151 (col AZ via `colIdx + 1` -> letter)** |

**ALL 52 columns are written at row append time (incidentToRow fills every cell, defaulting to empty strings). No read-but-never-written bug class in this tab.**

## COLLECTION / invoice_submissions_26 (23 cols)

| Col | Idx | Name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | Invoice UUID | invoiceActions:1029, 1094 (findRowByValue at 0); parseSubmissionRow | 1088 (append) |
| B | 1 | Timestamp (ISO) | parseSubmissionRow | 1088 |
| C | 2 | User Email | parseSubmissionRow; 1208, 1270, 1212 | 1088 |
| D | 3 | Account Key | parseSubmissionRow; 1355, 355, 382 | 1088 |
| E | 4 | Vendor Name | parseSubmissionRow; 1178, 1208, 1272 | 1088 |
| F | 5 | Vendor ID | parseSubmissionRow | 1088 |
| G | 6 | Invoice Number | parseSubmissionRow; 1179, 1209, 1312 | 1088 |
| H | 7 | Invoice Date | parseSubmissionRow; 1180, 1209 | 1088 |
| I | 8 | Total Amount | parseSubmissionRow; 1181, 1211, 1312 | 1088 |
| J | 9 | GL Breakdown (JSON) | parseSubmissionRow | 1088 |
| K | 10 | Drive URLs (JSON) | parseSubmissionRow | 1088 |
| L | 11 | Page Count | parseSubmissionRow | 1088 |
| M | 12 | Email Sent (TRUE/FALSE) | parseSubmissionRow | 1088 (FALSE), 1118 (set TRUE) |
| N | 13 | Status | parseSubmissionRow; 1037, 1182 | 1088 ("sent"), 1097 ("corrected"), 1217 ("returned"), 1277 ("sent" unreject) |
| O | 14 | Status Updated At | parseSubmissionRow | 1088 (""), 1097, 1217, 1277 |
| P | 15 | Type | parseSubmissionRow | 1088 |
| Q | 16 | Raw Drive URL | parseSubmissionRow | 1088 |
| R | 17 | Rejection Reasons | parseSubmissionRow | 1088 (""), 1218, 1278 |
| S | 18 | Rejection Note | parseSubmissionRow | 1088 (""), 1218, 1278 |
| T | 19 | Rejected By | parseSubmissionRow | 1088 (""), 1218, 1278 |
| U | 20 | Rejected At | parseSubmissionRow | 1088 (""), 1218, 1278 |
| V | 21 | Corrected From UUID | parseSubmissionRow; 1038, 1183 | 1088 |
| W | 22 | Dupe Override Flag | parseSubmissionRow | 1088 (""), 1304 ("not_duplicate") |

## COLLECTION / service_audit_log_26 (8 cols, write-only)

| Col | Idx | Inferred | WRITTEN at (5 sites, all appendRowSA) |
|---|---|---|---|
| A | 0 | timestamp | 515, 588, 630, 657, 670 |
| B | 1 | email | same |
| C | 2 | userName | same |
| D | 3 | accountKey / context | same |
| E | 4 | date / action type | same |
| F | 5 | action type / payload | same |
| G | 6 | payload / status | same |
| H | 7 | status | same |

No reads anywhere. Pure audit log.

## COLLECTION / service_day_overrides_26 (8 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | accountKey | service-calendar:242 | 543 |
| B | 1 | date | 242 | 543 |
| C | 2 | action (add_service / mark_closed) | 242 | 543 |
| D | 3 | serviceName | 242 | 543 |
| E | 4 | groupName | 242 | 543 |
| F | 5 | note | 242 | 543 |
| G | 6 | createdBy | 242 | 543 |
| H | 7 | createdAt | 242 | 543 |

## COLLECTION / Projections - 2026 (per-account; dynamic width grid)

Layout: rows are calendar days; cols A-D are metadata (day, date, period, week); cols E or F+ are services (one col per service, indices from service_config.ServiceColIndex). Read-only in this module.

| Col | Idx | Role | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | day label | service-calendar:240, 349 | NONE |
| B | 1 | date | 240, 349 | NONE |
| C | 2 | period | 240, 349 | NONE |
| D | 3 | week | 240, 349 | NONE |
| E+ | 4+ | camp (metaColCount=5) or gameType (=6) | 240, 349 | NONE |
| dynamic 5+ | - | service counts (per service column from config) | 240, 349 | NONE |

## COLLECTION / Actuals - 2026 (per-account; mirror layout to Projections)

| Col | Idx | Role | READ at | WRITE at |
|---|---|---|---|---|
| A-E or A-F | 0-4 or 0-5 | metadata (same as Projections) | service-calendar:241, 350 | NONE |
| dynamic 5+ | - | service counts | 241, 350 | service-calendar:491 (range-update, contiguous-batched per service group) |

## COLLECTION / Clicker Counts - 2026 (per-account; write-only)

| Col | Idx | Role | READ at | WRITE at |
|---|---|---|---|---|
| dynamic 5+ | - | clicker counts | NONE (never read in code) | service-calendar:570 (range-update, contiguous-batched) |

**The entire tab is write-only from the code's perspective. No reads anywhere.**

## COLLECTION / inventory_submissions (13 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | uuid | ops:979 (idempotency check) | 997 (append) |
| B | 1 | timestamp | NONE (server-generated, not read positionally) | 997 |
| C | 2 | email | ops:741 (log display) | 997 |
| D | 3 | account | ops:732, 759, 762 | 997 |
| E | 4 | period | ops:733, 763 | 997 |
| F | 5 | date | ops:734, 764 | 997 |
| G | 6 | food (numeric) | ops:735, 765 | 997 |
| H | 7 | packaging | ops:736, 766 | 997 |
| I | 8 | supplies | ops:737, 767 | 997 |
| J | 9 | snacks | ops:738, 768 | 997 |
| K | 10 | beverages | ops:739, 769 | 997 |
| L | 11 | total | ops:740, 770 | 997 |
| M | 12 | notes | ops:742, 771 | 997 |

## COLLECTION / labor_plans (15 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | planId (uuid) | ops:1084 (idempotency) | 1131 (append) |
| B | 1 | timestamp | NONE | 1131 |
| C | 2 | email | NONE | 1131 |
| D | 3 | account | ops:151, 486, 1091 | 1131 |
| E | 4 | homestandId | ops:156, 491, 1093 | 1131 |
| F | 5 | budgetEnvelope | ops:157, 492 | 1131 |
| G | 6 | carryForward | ops:158, 493 | 1131 |
| H | 7 | actualSpent | ops:159, 494 | 1131 |
| I | 8 | variance | ops:160, 495, 1094 | 1131 |
| J | 9 | cumulativeVariance | ops:161, 496 | 1131 |
| K | 10 | streakCount | ops:162, 497 | 1131 |
| L | 11 | notes | ops:163, 498 | 1131 |
| M | 12 | revenueActual | ops:164, 499 | 1131 |
| N | 13 | actualFood | ops:165, 500 | 1131 (hardcoded 0) |
| O | 14 | actualPackaging | ops:166, 501 | 1131 (hardcoded 0) |

## COLLECTION / labor_sold_revenue (5 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | account | ops:179 | 1162 |
| B | 1 | homestandId | ops:180 | 1162 |
| C | 2 | soldRevenue | ops:182 | 1162 |
| D | 3 | email | ops:183 | 1162 |
| E | 4 | timestamp | ops:184 | 1162 |

## COLLECTION / deep_clean_days (4 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | account | ops:170 | 1180 |
| B | 1 | date | ops:172 | 1180 |
| C | 2 | email | ops:173 | 1180 |
| D | 3 | timestamp | NONE | 1180 |

## COLLECTION / COLL__WOW_Plans_Header (21 cols)

| Col | Idx | WOW_HEADER_COL name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | ID | wowPlanActions:64, 70, 149 | 214 (append) |
| B | 1 | LEADER_EMAIL | wowPlanActions:71 | 214 |
| C | 2 | LEADER_NAME | 72 | 214 |
| D | 3 | ROLE | 73 | 214 |
| E | 4 | ACCOUNT | 74 | 214 |
| F | 5 | REVIEWER_EMAIL | 75 | 214 |
| G | 6 | OVERSIGHT_EMAIL | 76 | 214 |
| H | 7 | DAY1_DATE | 77 | 214 |
| I | 8 | DAY30_DATE | 78 | 214 |
| J | 9 | DAY60_DATE | 79 | 214 |
| K | 10 | DAY90_DATE | 80 | 214 |
| L | 11 | STATUS | 81 | 214, 238 |
| M | 12 | DAY1_SIGNED_AT | 82 | 214, 248 (if signedDay=1) |
| N | 13 | DAY30_SIGNED_AT | 83 | 214, 248 |
| O | 14 | DAY60_SIGNED_AT | 84 | 214, 248 |
| P | 15 | DAY90_SIGNED_AT | 85 | 214, 248 |
| Q | 16 | PDF_DRIVE_ID | 86 | 214, leadership-dugout:421 |
| R | 17 | CALENDAR_EVENT_IDS | 87 | 214, leadership-dugout:228 |
| S | 18 | CREATED_AT | 88 | 214 |
| T | 19 | LAST_ACTION_BY | 89; **leadership-dugout:494 (wipeTab scans this col for [TEST] prefix)** | 214, 239, 277 |
| U | 20 | LAST_ACTION_AT | 90 | 214, 240, 277 |

## COLLECTION / COLL__WOW_Plans_Body (12 cols)

| Col | Idx | WOW_BODY_COL name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | ID | wowPlanActions:101, 157 | 215 |
| B | 1 | SCALE_DIRECTION | 102 | 215 |
| C | 2 | PRE_WORK_RESPONSES (JSON) | 103 | 215, 269 (caller-driven col letter) |
| D | 3 | DAY1_HIGH_LEVERAGE_QUESTION | 104 | 215, 269 |
| E | 4 | DAY1_TOP3_GOALS | 105 | 215, 269 |
| F | 5 | MANAGER_BRAND_EXPECTATIONS | 106 | 215, 269 |
| G | 6 | LEADER_STYLE_PREFERENCES | 107 | 215, 269 |
| H | 7 | KEY_INTERACTION_POINTS | 108 | 215, 269 |
| I | 8 | CADENCE_PLAN | 109 | 215, 269 |
| J | 9 | DAY30_DATA | 110 | 215, 269 |
| K | 10 | DAY60_DATA | 111 | 215, 269 |
| L | 11 | DAY90_DATA | 112 | 215, 269 |

## COLLECTION / COLL__Performance_Audit_Log (8 cols, write-only)

| Col | Idx | Inferred | WRITTEN at |
|---|---|---|---|
| A | 0 | uuid | performanceActions:36 |
| B | 1 | instrument_type | 36 |
| C | 2 | instrument_id | 36 |
| D | 3 | action | 36 |
| E | 4 | actor_email (prefixed [TEST] if test mode) | 36; **leadership-dugout:496 (wipeTab scans this col)** |
| F | 5 | actor_role | 36 |
| G | 6 | timestamp | 36 |
| H | 7 | details (JSON) | 36 |

## INVENTORY / item_catalog (~19 cols, inferred from positional usage)

| Col | Idx | Inferred name | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | itemId | inventoryActions:39, 375, 410, 478, 640, 766 | 350 |
| B | 1 | account | 39, 290, 411, 478, 736, 796, 929, 1083 | 350 |
| C | 2 | name | 39, 642, 769, 770 | 627, 740 |
| D | 3 | category | 39, 259, 264, 478, 739, 951, 1084 | 627, 740, 1161 |
| E | 4 | unit | 39, 478, 739 | 627, 740 |
| F | 5 | locationId | 39, 81, 411, 668, 743, 931, 942, 1088, 1100, 1125 | 412, 669, 742, 947, 958, 1125 |
| G | 6 | primaryVendor | 39, 377, 479, 649 | 350 |
| H | 7 | lastPrice | 39, 479 | 350, 378 |
| I | 8 | lastPriceDate | 39 | 350, 380 |
| J | 9 | lastPriceVendor | 39 | 350, 381 |
| K | 10 | priceAtLastCount | 39, 46 | 291 |
| L | 11 | active (TRUE/FALSE) | 40, 60, 64, 80, 327, 478, 1081 | 645, 775, 799, 1110, 1179, 1202 |
| **M** | **12** | **linkedToInvoice (TRUE/FALSE)** | **47, 332** | **NONE** (read-but-never-written) |
| **N** | **13** | **isVarietyGroup (TRUE/FALSE)** | **48, 332** | **NONE** |
| O | 14 | createdBy | 49, 70 | 350 (append only; never updated post-create) |
| **P** | **15** | **(gap)** | **NONE** | **NONE** (unused position) |
| Q | 16 | reviewStatus ("excluded" / "archived" / "reviewed" / "review_deleted") | 60, 64, 753, 776, 800 | 753, 776, 800, 1180, 1203 |
| R | 17 | notes (max 500 chars) | 50, 71, 674, 676 | 680, 1162 |
| S | 18 | lastVerified | 51, 72 | 351, 382 |

**Flagged read-but-never-written cols M (linkedToInvoice) and N (isVarietyGroup)** - populated externally, consumed by code. Col O (createdBy) is written once at create but never updated thereafter - that's expected for an immutable creator stamp.

## INVENTORY / storage_locations (10 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | locationId | inventoryActions:81, 827, 909, 983, 920, 1004, 1047 | 840, 849, 868, 875, 1011 |
| B | 1 | account | 81, 827, 920, 1004, 1027 | 840, 849, 868, 875, 1011 |
| C | 2 | name | 81, 905, 911 | 840, 849, 868, 875, 1011, 1029 |
| D | 3 | icon | 81 | 840, 849, 868, 875, 1011, 1030 |
| E | 4 | sortOrder | 81, 1002, 1005 | 840, 849, 868, 875, 984, 889, 1011 |
| F | 5 | active | 80, 920, 1004, 1027 | 823 (?), 840, 849, 868, 875, 889, 1011 |
| G | 6 | email | NONE | 840, 849, 868, 875, 1011 (**write-only**) |
| H | 7 | createdAt | NONE | 840, 849, 868, 875, 1011 (**write-only**) |
| I | 8 | parentLocationId | 81, 85, 863, 1004 | 823, 840, 849, 868, 875, 1011 |
| J | 9 | color | 81, 86 | 823, 840, 849, 868, 875, 1011, 1031 |

**Cols G (email) and H (createdAt) are write-only** - audit stamps not consumed by the read paths in this file.

## INVENTORY / item_aliases (extended; code writes 8 cols at merge, reads 4)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | aliasId | NONE | 648 (write-only) |
| B | 1 | aliasText | 76, 484, 510 | 648 |
| C | 2 | itemId | 76, 484, 654, 1114 | 648, 656, 1114 (remap on merge) |
| D | 3 | vendor | 76, 484 | 648 |
| **E** | **4** | **inferred score (e.g. 100)** | **NONE** | **648 (write-only)** |
| **F** | **5** | **inferred source ("item_review")** | **NONE** | **648 (write-only)** |
| **G** | **6** | **inferred timestamp** | **NONE** | **648 (write-only)** |
| **H** | **7** | **inferred type ("item_review")** | **NONE** | **648 (write-only)** |

**Cols E-H are write-only.** They appear to be added by the merge-creates-forward-alias path (inventoryActions:648) but no read path consumes them. Possibly used by an external dedup dashboard, or vestigial.

## INVENTORY / price_history (7 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | itemId | 152, 1120 | 357, 384, 663, 1120 |
| B | 1 | account | 149 | 357, 384 |
| C | 2 | vendor | 152, 154 | 357, 384 |
| D | 3 | price | 154 | 357, 384 |
| E | 4 | date | 150, 154 | 357, 384 |
| **F** | **5** | **source ("manual-add" / "manual-verify")** | **NONE** | **357, 384 (write-only)** |
| **G** | **6** | **timestamp** | **NONE** | **357, 384 (write-only)** |

**Cols F (source) and G (timestamp) are write-only.**

## INVENTORY / count_sessions (14 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | sessionId | 103, 120 | 205 |
| B | 1 | account | 91 | 205 |
| C | 2 | period | 96, 182 | 205 |
| D | 3 | email (initiator) | 104 | 205 |
| E | 4 | startedAt | 92, 182 | 205 |
| F | 5 | status ("draft" / "submitted" / "corrected") | 94, 172 | 272 |
| G | 6 | submittedBy | 104 | 273 |
| H | 7 | submittedAt | 105, 150 | 274 |
| I | 8 | totalFood | 107 | 275 |
| J | 9 | totalPackaging | 108 | 276 |
| K | 10 | totalSupplies | 109 | 277 |
| L | 11 | totalSnacks | 110 | 278 |
| M | 12 | totalBeverages | 111 | 279 |
| N | 13 | grandTotal | 112 | 280 |

## INVENTORY / count_items (13 cols)

| Col | Idx | Inferred | READ at | WRITE at |
|---|---|---|---|---|
| A | 0 | sessionId | 120, 255 | 229 |
| B | 1 | locationSaveId | 134 | 229 |
| C | 2 | itemId | 135, 262, 286 | 229 |
| D | 3 | quantity | 136 | 229 |
| **E** | **4** | **unit** | **NONE** | **229 (write-only)** |
| F | 5 | priceAtCount | 287 | 229 |
| **G** | **6** | **priceVendor** | **NONE** | **229 (write-only)** |
| H | 7 | extended (qty x price) | 263 | 229 |
| I | 8 | locationId | 124 | 229 |
| **J** | **9** | **email** | **NONE** | **229 (write-only)** |
| **K** | **10** | **(gap)** | **NONE** | **NONE** |
| L | 11 | savedAt | 126 | 229 |
| M | 12 | noneOnHand | 137 | 229 |

**Cols E (unit), G (priceVendor), J (email) are write-only.**

## INVENTORY / merge_history (10 cols, mostly append)

| Col | Idx | Inferred | READ at | WRITE at (6 sites, all appendRowSA) |
|---|---|---|---|---|
| A | 0 | mergeId | NONE | 698, 719, 778, 803, 1182, 1205 |
| B | 1 | account | 489, 584 (AI similarity context) | same |
| C | 2 | timestamp | NONE | same |
| D | 3 | email | NONE | same |
| E | 4 | keeperItemId (or empty for non-merge ops) | 502 (AI context) | same |
| F | 5 | canonicalName (or empty) | 502 | same |
| G | 6 | JSON itemIds (merged/affected) | 586 | same |
| H | 7 | JSON itemNames | 498 | same |
| I | 8 | type ("merge" / "keep_separate" / "exclude" / "archive" / "reactivate" / "review_delete") | 496 | same |
| J | 9 | reason / notes | NONE | same |

**Col J (reason) is write-only.** Cols A, C, D, F (when not a merge), and J are all write-only or only read in narrow AI-context paths.

## INVENTORY / zone_corrections (9 cols, write-only)

| Col | Idx | Inferred | WRITTEN at |
|---|---|---|---|
| A | 0 | correctionId | 746 |
| B | 1 | account | 746 |
| C | 2 | timestamp | 746 |
| D | 3 | email | 746 |
| E | 4 | itemId | 746 |
| F | 5 | itemName | 746 |
| G | 6 | aiSuggestedLocationId | 746 |
| H | 7 | userChosenLocationId | 746 |
| I | 8 | category | 746 |

No reads. Pure audit.

## INVENTORY / review_queue (read-only in this file)

| Col | Idx | Inferred | READ at |
|---|---|---|---|
| F | 5 | account | 145 |
| J | 9 | status | 145 |

No writes in inventoryActions.js. Other columns are not read. Probably populated by an AI/scanner module not in this audit's scope.

## GL_CODES / per-account tabs (12 distinct tabs, 2 cols each)

| Col | Idx | Inferred | READ at |
|---|---|---|---|
| A | 0 | account name / GL code label | invoiceActions:343, 987 (via parseGLCodes) |
| B | 1 | GL code (numeric/string code) | 343, 987 |

Read-only. No writes anywhere.

## AI_LINE_ITEMS / per-account tabs (15 cols, write-only)

| Col | Idx | LINE_ITEM_HEADERS name | WRITE at |
|---|---|---|---|
| A | 0 | Invoice UUID | invoiceActions:136 (header), 1496/1499 (data) |
| B | 1 | Timestamp | 136, 1496/1499 |
| C | 2 | Account | 136, 1496/1499 |
| D | 3 | Vendor | 136, 1496/1499 |
| E | 4 | Invoice # | 136, 1496/1499 |
| F | 5 | Invoice Date | 136, 1496/1499 |
| G | 6 | Line # | 136, 1496/1499 |
| H | 7 | Item Description | 136, 1496/1499 |
| I | 8 | Quantity | 136, 1496/1499 |
| J | 9 | Unit | 136, 1496/1499 |
| K | 10 | Unit Price | 136, 1496/1499 |
| L | 11 | Extended Price | 136, 1496/1499 |
| M | 12 | Category | 136, 1496/1499 |
| N | 13 | Confidence | 136, 1496/1499 |
| O | 14 | Raw JSON | 136, 1496/1499 |

No reads. Pure append-only output of AI line-item extraction.

---

# PART 4: Anomalies & Flags

Consolidated observations across all tabs.

## A. Read-but-never-written columns (the column-G data-loss bug class)

These columns are consumed by code (READ positionally) but never written by any code path. If the data is populated externally (manual sheet entry, Apps Script, import), it survives. If a code-side write operation needs to preserve the row, this column gets blanked.

| Tab | Col | Idx | Name | Read at | Risk |
|---|---|---|---|---|---|
| HUB / contacts | G | 6 | Slack User ID | directory:91 (read into slackId field) | **Confirmed live bug** - admin-update-contacts re-appends 6-col rows that blank G/H/I/J. Kevin: ONLY G is operational; H/I/J are manual reference notes (not load-bearing). |
| HUB / accounts | T | 19 | Region | people:1672 (incident region routing) | **Yes** - col T is read by people module but directory never touches it. Populated externally; would be blanked if directory's full-row write ever extended to col T. Today the write range is A:R (cols 0-17), so col T is preserved. Latent risk if the write range extends. |
| HUB / hero_images | B | 1 | type (celebration etc) | dashboard:110 only | Latent - only dashboard reads col B; directory's hero writer is col-A-only. No risk today since directory's clear+rewrite is column A only. |
| HUB / library_manifest | (D-I) | 3-8 | various | NONE read by code | Likely populated externally for human inspection. Cross-ref needed. |
| HUB / HUB__Performance_System_Config | (12 of 15 CONFIG_KEYS) | - | HR_EMAIL, VP_OPS_EMAIL, SR_DIR_OPS_EMAIL, DIRECTOR_CULINARY_EMAIL, DELTA_FLAG_THRESHOLD, RESPONSE_WINDOW_DAYS, CALIBRATION_SLA_DAYS, WOW_PLAN_PRE_DAY1_DAYS, WOW_PLAN_SHARE_DAYS, CO_EDITOR_WARN_MINUTES, SECTION10_LOCK_SECONDS, CELL_SIZE_WARN_PCT, CELL_SIZE_BLOCK_PCT, SEASON_TRACKER_STALE_HOURS | NONE | Declared as constants but never read or written. Likely placeholder for future implementation. |
| INVENTORY / item_catalog | M | 12 | linkedToInvoice (TRUE/FALSE) | inventoryActions:47, 332 | Read but never written. Possibly written by an invoice-side flow (invoiceActions or AI scan) that the audit didn't trace. |
| INVENTORY / item_catalog | N | 13 | isVarietyGroup (TRUE/FALSE) | inventoryActions:48, 332 | Read but never written. Same situation as M. |
| INVENTORY / item_aliases | B | 1 | aliasText | inventoryActions:76, 484, 510 (AI similarity) | Written at create (648); read in fuzzy match. Probably fine. |

## B. Write-but-never-read columns (code emits data nothing consumes in this codebase)

These are stamped on writes but never consumed by any read path. They survive in the sheet as "exhaust" or external-consumer data.

| Tab | Col | Idx | Name | Note |
|---|---|---|---|---|
| HUB / vendor_master | H | 7 | Last Invoice Date | Appended as "" at create; never updated; never read |
| HUB / vendor_accounts | V | 21 | Reserved (Phase 2 F11 placeholder) | Appended empty; never read or written |
| HUB / accounts | (potentially T Region if directory wrote it) | 19 | - | Currently not in directory's write range; not a write-but-never-read in this codebase |
| COLLECTION / submissions | K (1-indexed col 11) | 10 | ADMIN_ACTION timestamp | Written on status changes; never read positionally |
| COLLECTION / drafts | C | 2 | timestamp | Written on append/upsert; never read positionally (drafts are loaded via composite key, not by timestamp) |
| COLLECTION / notification_log | C, D, F | 2, 3, 5 | channel, subject, status | Written but never consumed by read paths |
| COLLECTION / Clicker Counts - 2026 | dynamic 5+ | - | clicker counts | Entirely write-only - no read paths anywhere |
| COLLECTION / service_audit_log_26 | A-H | 0-7 | all 8 cols | Entirely write-only (audit log) |
| COLLECTION / COLL__Performance_Audit_Log | A-H | 0-7 | all 8 cols | Entirely write-only |
| COLLECTION / inventory_submissions | B | 1 | timestamp | Server-stamped, never read positionally |
| COLLECTION / labor_plans | B, C | 1, 2 | timestamp, email | Stamped but not read |
| COLLECTION / deep_clean_days | D | 3 | timestamp | Stamped but not read |
| INVENTORY / storage_locations | G, H | 6, 7 | email, createdAt | Audit stamps; never read |
| INVENTORY / item_aliases | E, F, G, H | 4-7 | score, source, timestamp, type | Extended cols written by merge path; never read here |
| INVENTORY / price_history | F, G | 5, 6 | source, timestamp | Stamped; never read |
| INVENTORY / count_items | E, G, J | 4, 6, 9 | unit, priceVendor, email | Stamped; never read |
| INVENTORY / merge_history | A, C, D, J | 0, 2, 3, 9 | mergeId, timestamp, email, reason | Audit stamps; rarely read (only in AI similarity context paths) |
| INVENTORY / zone_corrections | all 9 cols | - | - | Entirely write-only |
| AI_LINE_ITEMS / per-account | all 15 cols | - | - | Entirely write-only |

## C. Tab-write column-count mismatches (write N cols, sheet has M cols, code reads K cols)

| Tab | Sheet cols | Code reads | Code writes | Note |
|---|---|---|---|---|
| HUB / contacts | 10 (A-J) | 7 (A-G) | 6 (A-F via admin-update-contacts) | **Cols G/H/I/J get blanked on every contacts-update operation.** Per Kevin: only G is operational; H/I/J are manual notes (not load-bearing). |
| HUB / accounts | 20 (A-T, including Region) | 19 (A-S) + col T by people | 18 (A-R range write) + cell ops on S | Col S (Active) and col T (Region) are outside the A:R range update. S is updated separately by cell ops. T is read-only-from-code (people's read; populated externally). |
| HUB / library_manifest | 10 (A-J) | 3 (A, C, J) | 0 | Read-only by code; populated externally. |
| INVENTORY / item_catalog | 19 (A-S, possibly more) | 18 (incl. M, N read) | 17 (M, N never written) | Cols M, N read but never written by code. |
| All others | match | - | - | No structural mismatches detected. |

## D. Positional indexing where the index might drift if a sheet column is inserted

Every tab that uses positional `r[N]` access is at risk if a column is inserted at the head or middle. The most concentrated drift risk is in:

| Tab | Positional indices used | Drift risk |
|---|---|---|
| HUB / accounts | r[0] through r[19] across multiple files (directory, people, ops, opsUtils, dashboard, service-calendar, invoiceActions) | **HIGH** - 5 modules consume positional indices. A column inserted in the middle of accounts would break all consumers simultaneously. |
| HUB / contacts | r[0]-r[6] in 4 files | **MEDIUM-HIGH** - 4 consumers. Same risk shape as accounts. |
| HUB / hero_images | r[0], r[1] in dashboard | LOW (only 2 cols) |
| COLLECTION / submissions | r[0]-r[9] in people + dashboard | **HIGH** - submitter status display + admin queue depend on r[8] (status) and r[9] (notes). Insert a column upstream and many code paths break. |
| COLLECTION / Incidents | dynamically resolved via INCIDENT_COLUMNS array | **LOW** - col indices come from the schema array, not hardcoded. Add a new column to INCIDENT_COLUMNS and code automatically extends. |
| COLLECTION / invoice_submissions_26 | r[0]-r[22] via parseSubmissionRow | MEDIUM - parseSubmissionRow centralizes the mapping; one update site fixes drift. |
| COLLECTION / news_interactions | r[0]-r[5] in dataStore.js only | LOW - single consumer, dual-write-mediated. |
| INVENTORY / item_catalog | r[0]-r[18] in inventoryActions.js only | MEDIUM - single-file but many call sites. |

**Recommendation for migration cleanup:** column-index constants (like SUB in people/route.js or CHAIN_COL in performanceSchema.js) should be canonicalized per tab. INCIDENT_COLUMNS is the gold standard pattern.

## E. Inconsistent admin / hr flag model across modules

Documented in CLAUDE.md (PR #57 captain's log):
- `directory/route.js:48` reads admins!A only (any email in col A is admin)
- `people/route.js:383` reads admins!A AND admins!C (requires col C "hr"=TRUE)

Different modules apply different admin definitions against the same admins tab. Stage 1 auth model (docs/AUTH_MODEL.md) replaces this with the users table + is_admin column.

## F. Account-key format inconsistency (spaces vs no-spaces)

Identified in invoiceActions.js GL_TAB_MAP and elsewhere:
- `GL_TAB_MAP` keys use spaces around hyphens: `"CIN - AZ"`, `"CIN - KY"` etc.
- accounts tab uses the same spaced format in col A.
- service_config tab uses the same spaced format.
- Some helper code applies `safeId()` to strip non-alphanumeric chars (directory uses this for app-side keying).
- `TXR - HOME` / `TXR - TX - H` both map to the same GL tab `TXR - Home` (the map has alias entries).

Consistent format in HUB sheets, but the safeId-vs-raw distinction matters at the app boundary. Directory's `safeId()` and `rawKey` distinction documents this.

## G. Stale schema comments

| File:line | Stale comment | Reality |
|---|---|---|
| incidentSchema.js:155 | "// SHEET COLUMNS (48 total, SOP v2.1)" | Actual count is 52 (48 SOP v2.1 + 4 Phase 4C additions) |
| directory/route.js:7 | header comment "Sheets: HUB (accounts, links, contacts) read-only" | Outdated - directory writes accounts, contacts, dir_links, work_locations, hero_images |
| people/route.js (various) | Multiple comments reference old SOP version | Actual code uses 52-column INCIDENT_COLUMNS via the helper |
| performanceSchema.js:11-13 | Comments imply "HUB__ prefix denotes hub-side config tabs; COLL__ prefix denotes collection-side actuals tabs" | Confirmed, but 3 COLL__ tabs + 1 HUB__ tab are declared but unused |

## H. Schema-declared but unused tabs

These tabs are declared in code constants but no code reads or writes them. They may or may not exist in the live sheet.

| Spreadsheet | Tab | Declared in | Status |
|---|---|---|---|
| HUB | HUB__Cycle_Calendar | performanceSchema.js:16 (TABS.CALENDAR) | Unused |
| COLLECTION | COLL__Cycle_Review_Header | performanceSchema.js:23 | Unused (Cycle Review feature unshipped) |
| COLLECTION | COLL__Cycle_Review_Body | performanceSchema.js:24 | Unused |
| COLLECTION | COLL__Scorecards | performanceSchema.js:27 | Unused |
| COLLECTION | Clicker Counts - 2026 | service-calendar/route.js:16 (TABS.CLICKERS) | Tab name declared but only written, never read; ABSENT from code reads entirely |

## I. Tabs touched in code that may not exist in live sheets

To be confirmed via xlsx cross-ref:
- `HUB__Cycle_Calendar` (declared in code, never referenced)
- All `COLL__Cycle_Review_*` and `COLL__Scorecards` tabs (declared, never referenced)
- AI_LINE_ITEMS per-account tabs (dynamically created on demand via createTabSA; may not all exist for every account)
- `Invoice Uploads` fallback tab in AI_LINE_ITEMS (assumed to exist; fallback target if account tab creation fails)

## J. Cross-spreadsheet writes

| Spreadsheet | Tab | Write-source modules |
|---|---|---|
| HUB / accounts | directory only | directory |
| HUB / contacts | directory only | directory |
| HUB / dir_links | directory only | directory |
| HUB / work_locations | directory only | directory |
| HUB / hero_images | directory only | directory |
| HUB / vendor_master | invoiceActions | invoiceActions |
| HUB / vendor_accounts | invoiceActions | invoiceActions |
| HUB / service_config | service-calendar | service-calendar |
| HUB / HUB__Performance_System_Config | leadership-dugout (test_mode only) | leadership-dugout |
| COLLECTION / submissions | people only | people |
| COLLECTION / drafts | people only | people |
| COLLECTION / notification_log | people, opsUtils, cron-daily | **3 writers** - keep multi-writer awareness for migration |
| COLLECTION / Incidents | people, cron-incident-reminders | **2 writers** - cron writes col AZ only |
| COLLECTION / invoice_submissions_26 | invoiceActions only | invoiceActions |
| COLLECTION / service_audit_log_26 | service-calendar only | service-calendar |
| COLLECTION / service_day_overrides_26 | service-calendar only | service-calendar |
| Per-account / Actuals - 2026, Clicker Counts - 2026 | service-calendar only | service-calendar |
| COLLECTION / inventory_submissions | ops only | ops |
| COLLECTION / labor_plans | ops only | ops |
| COLLECTION / labor_sold_revenue | ops only | ops |
| COLLECTION / deep_clean_days | ops only | ops |
| COLLECTION / news_interactions | dataStore (dashboard) only | dataStore |
| COLLECTION / COLL__WOW_Plans_Header | wowPlanActions, leadership-dugout | **2 writers** - leadership-dugout writes cols Q, R, T |
| COLLECTION / COLL__WOW_Plans_Body | wowPlanActions only | wowPlanActions |
| COLLECTION / COLL__Performance_Audit_Log | performanceActions, leadership-dugout (wipe only) | performanceActions writes; leadership-dugout only wipes |
| INVENTORY (all tabs) | inventoryActions only | inventoryActions |

**Multi-writer tabs (require coordinated migration):**
1. `notification_log` (3 writers: people, opsUtils, cron-daily)
2. `Incidents` (2 writers: people for full lifecycle, cron-incident-reminders for col AZ only)
3. `COLL__WOW_Plans_Header` (2 writers: wowPlanActions for lifecycle, leadership-dugout for calendar/PDF stamps)

## K. Tabs read by code but for which the read may not exercise every column

Examples where the code reads only a subset of available columns from a tab that has many more columns:

| Tab | Code reads | Likely actual cols |
|---|---|---|
| HUB / library_manifest | A, C, J | 10 (per ldug equivalent) |
| HUB / contacts | A-G | 10 (A-J per recon) |
| INVENTORY / count_items | A-D, F, H, I, L, M | 13 (E, G, J, K never read positionally) |
| INVENTORY / merge_history | B, E, F, G, H, I in AI context | 10 (A, C, D, J never read) |

## L. cron/backup-sheets is Drive-only

`src/app/api/cron/backup-sheets/route.js` calls `getServiceAccountDriveClient()` and uses `drive.files.copy()` to make full-spreadsheet backups. It does not use any `*SA` Sheets helper. **Excluded from this Sheets audit.**

---

## End of audit

This document is the code-perspective inventory. The next step is cross-referencing it against Kevin's xlsx exports to identify:
1. Tabs in the sheet but NOT in this document = potentially dead tabs (or external-system-only tabs)
2. Columns in the sheet but NOT in this document = potentially dead columns (or manually-maintained reference columns like contacts H/I/J)
3. Columns in this document but NOT in the sheet = code referencing positions that no longer exist (drift risk)
4. Tabs flagged SCHEMA-DECLARED-BUT-UNUSED here that actually have data = orphaned features
5. Read-but-never-written columns (Part 4 Section A) that have data = manually-maintained references that need migration handling

The xlsx cross-reference + this code audit together produce the cleanup + migration plan for Stage 1+.
