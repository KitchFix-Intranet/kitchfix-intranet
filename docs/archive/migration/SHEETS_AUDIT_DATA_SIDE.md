> **ARCHIVED 2026-07-17** - pre-Sheets-to-Postgres-migration trilogy (data side); the Supabase migration project closed 2026-06-12. Superseded operationally by `docs/MIGRATION_PROJECT_CLOSEOUT.md` + `docs/MIGRATION_STATUS.md`. Companion pieces `SHEETS_AUDIT.md` + `SHEETS_AUDIT_SYNTHESIS.md` archived alongside.

# KitchFix Sheets Audit - DATA SIDE (sheet contents)

Read from the four current spreadsheets 2026-05-26 (HUB v4.0(10), COLLECTION v4.0(7), INVENTORY Manager(10), AI line items 2026(8)). This is the DATA half of the two-source audit: what actually exists in the sheets, every tab, every column, fill rates, anomalies. The CODE half (what the app reads/writes) comes from CC and gets cross-referenced into this for final verdicts.

**Verdict legend (final verdicts need the code cross-reference + Kevin's judgment):**
- LIVE = code uses it, real data
- DEAD = empty or near-empty, no apparent use
- PADDING = trailing empty unlabeled columns (sheet bloat, safe to trim)
- REFERENCE = populated but maintained manually / for Kevin, not app-driven
- SCHEMA-ONLY = tab exists with a type-definition row but no real data (unbuilt feature)
- MISLABELED = header does not match the data under it
- BUG = read-but-never-written, or data-in-unlabeled-columns

Anything marked "candidate" needs the code side to confirm whether the app touches it.

---

## HUB (34 tabs)

### accounts | 12 rows, 20 cols (A-T)
- LIVE A-M, R-T: TeamKey, Team Name, Level, City, State, Season, Stadium Name, Stadium Header URL, Logo URL, Address, Latitude, Longitude, Timezone (A-M), gmap (R), Active (S), Region (T). All 12/12.
- **DEAD candidates N/O/P/Q**: Wifi SSID, Wifi Pass, Gate Code, Door Code - 0/12 filled. Headers exist, zero data.
- NOTE: this is 20 cols (A-T), not 19 (A-S) as the code survey assumed. **Col T = Region** (the East/West data used for auth mappings). The directory design must account for col T.

### dir_links | 12 rows, real data A-F
- LIVE A-F: TeamKey, Homestand, SLA, ServiceCalendars, Drive, Active (Homestand 11/12, SLA 10/12, others ~11/12).
- **PADDING G-Z**: 20 trailing empty unlabeled columns. Safe to trim.
- (Directory design folds A-E URLs into accounts; this confirms the source.)

### contacts | 30 rows, 10 cols (A-J)
- LIVE A-F: TeamKey, Role, Name, Email, Phone, Slack Handle (Phone 29/30, rest 30/30).
- LIVE-but-incomplete G: Slack User ID 20/30 (operational - powers Slack button; the 10 blanks are why some Slack links do not resolve to the person).
- **REFERENCE H/I/J**: Kiosk Emails 19/30, Manager 30/30, Region 30/30. Per Kevin: his manual reference notes, NOT used by intranet. Stay in Sheet, do not migrate.

### work_locations | 12 rows, 3 cols
- LIVE A-C: Work location name, TeamKey, Team Name. All 12/12. (Only directory touches it - kept as real table in migration.)

### employee_roster | 98 rows, 15 cols
- Populated A-O (Work email N only 23/98). Real HR roster data: names, titles, comp, status, dates, phone.
- CODE-CROSS-REF NEEDED: not in the original code survey. Likely externally-maintained HR export OR feeds a module. Confirm whether code reads it.

### budgets | 0 data rows, 5 headers
- **DEAD/empty**: headers only (Account, Date, Event, Revenue, Target %). Staged, never populated.

### kiosk_info | 12 rows, 4 cols
- Populated A-D: kiosk emails, teamkey, teamname, notification. All 12/12.
- CODE-CROSS-REF NEEDED: confirm code use.

### admins | 8 rows, 5 cols
- LIVE A-E: email, home, hr, finance, ops (boolean capability flags). All 8/8. (Read-only auth config per code survey.)

### notifications | 13 rows, real data A-I
- LIVE A-I: action_key + notify/emails pairs for hr/finance/ops/admin. All 13/13.
- **PADDING J-Z**: 17 trailing empty unlabeled columns.

### homestand_schedule | 408 rows, 6 cols
- LIVE A-F: AccountKey, Date, DayOfWeek, DayType, Opponent (324/408), HomestandID. Real schedule data.
- CODE-CROSS-REF NEEDED: confirm reader (likely ops/labor).

### labor_budgets | 107 rows, real data A-G
- LIVE A-G: AccountKey, Period, HourlyBudget, SalaryBudget, Revenue, FoodBudget, PackagingBudget. All 107/107.
- **PADDING H-N**: 7 trailing empty unlabeled columns.

### roster_config | 0 data rows, 6 headers
- **DEAD/empty**: headers only (Account, Name, Role, Rate, DefaultHours, Active). Staged, never populated.

### vendor_master | 35 rows, 10 cols
- LIVE A-G, I: Vendor ID, Vendor Name (31/35), Category (31/35), Website (9/35), Notes (4/35), Created By, Created Date, Aliases (24/35).
- **DEAD H**: lastInvoiceDate 0/35.
- **BUG/junk J**: unlabeled, 2/35.

### vendor_accounts | 54 rows, 24 cols
- LIVE A-M, Q-U: Row ID, Vendor ID, Account, Customer Account #, Sales Rep fields, Delivery Days, Cutoff Time, Delivery Method, Portal URL/Username/Password, Payment Terms, Min Order, Active, Created By, Created Date (varying fill).
- **DEAD N/O/P (Contact Name/Email/Phone) 0/54, V (Notes) 0/54.**
- **PADDING/junk W/X**: unlabeled, 2-4/54.
- FLAG (not dead, but note): cols L/M = Portal Username / Portal Password - credentials stored in plaintext in the sheet. Out of audit scope, but worth Kevin knowing for the eventual migration (do not surface these in any UI).

### service_config | 97 rows, 12 cols
- LIVE A-L: AccountKey, Category, SpreadsheetId, Title, MetaColCount, GroupName, ServiceName, PricePerPlate, ServiceColIndex, TaxFree, SortOrder, Active. All 97/97. (Service-calendar config.)

### library_manifest | 9 rows, 10 cols
- LIVE A-J: drive_file_id, category, title, version, updated_at, description, pinned, critical, sort_order, active. All 9/9. (Leadership-dugout library.)

### HUB__Performance_Chain | 4 rows, 12 cols
- **SCHEMA-ONLY candidate**: sample row 1 is a type-definition (email, text, enum, text...). 4 rows total. Performance feature scaffolding.

### HUB__Cycle_Calendar | 10 rows, 14 cols
- **SCHEMA-ONLY candidate**: sample row 1 is types (text, enum, text, number...). Partially filled. Performance feature, code survey said unused.

### HUB__Performance_System_Config | 17 rows, 3 cols
- LIVE A-C: Field, Value, Notes. All 17/17. Config key-value for performance system (read by performanceAcl per survey).

### period_data | 13 rows, 4 cols
- LIVE A-D: Period, Start, End, DueDate. All 13/13. (Fiscal period definitions, read by ops/cron.)

### gl_codes | 10 rows, 3 cols
- Populated A-C: Code, Description, Budget_Category. All 10/10.
- NOTE: lowercase gl_codes tab in HUB, distinct from the separate GL_CODES spreadsheet (12 per-account tabs). CODE-CROSS-REF NEEDED: which is actually used.

### vendors | 4 rows, 3 cols
- Populated A-C: Vendor Name, Account, Active?. 4 rows.
- **LEGACY-DUPLICATE candidate**: this is a much simpler/smaller vendor list than vendor_master (35) + vendor_accounts (54). Possible orphan from before the vendor portal. CODE-CROSS-REF NEEDED.

### preservice_content | 0 data rows, 5 headers
- **DEAD/empty**: headers only (Date, Safety_Topic, Service_Focus, Team_News, SOP_Link). Pre-service briefing tool is specced-not-built.

### ops_newsfeed | EMPTY (0 rows, 0 cols)
- **DEAD/empty**: completely empty tab.

### labor_settings | EMPTY (0 rows, 0 cols)
- **DEAD/empty**: completely empty tab.

### personnel_celebrations | 156 rows, real data A-C
- LIVE A-C: Date, Event Name, Type (birthdays/anniversaries). All 156/156.
- **PADDING D-Z**: 23 trailing empty unlabeled columns.

### daily_pulse | 60 rows, 6 cols
- Populated A-F: Date, Question, Option 1/2/3, Votes. All 60/60.
- CODE-CROSS-REF NEEDED: confirm code use (looks like a poll feature).

### news_posts | 8 rows, real data A-L
- LIVE A-L: postId, title, body, tag, pinned, author, publishDate, expiresDate, countdownLabel (2/8), countdownDate (2/8), link (1/8), active. (The news feed source; news_interactions references these postIds.)
- **PADDING M-Z**: 14 trailing empty unlabeled columns.

### kitchFix_philosophy | 28 rows, 1 col
- LIVE A: single column of philosophy statements. 28/28. (Dashboard reads it - the missed tab from the gap recon.)
- MISLABEL note: header reads "Standard" but content is philosophy lines. Minor.

### did_you_know | 30 rows, 2 cols
- Populated A-B: Fact, Category. 30/30. CODE-CROSS-REF NEEDED.

### wastenot_resources | 9 rows, 4 cols
- Populated A-D: Tittle [sic], Type, URL (6/9), Description. CODE-CROSS-REF NEEDED.
- **MISLABEL**: col A header "Tittle" (typo for Title).

### kk_values | 46 rows, 2 cols
- Populated A-B: Value, Category. 46/46. CODE-CROSS-REF NEEDED (kudos values list?).

### ai_prompts | 69 rows, 4 cols
- Populated A-D: Role, Label, Prompt, Values. 69/69. CODE-CROSS-REF NEEDED (kudos/AI prompt library?).

---

## COLLECTION (29 tabs)

### login_logs | 1245 rows, 3 cols
- LIVE A-C: Timestamp, Date, Email. Append-only access log.

### inventory_submissions | 34 rows, 13 cols
- LIVE A-M: UUID, Server Timestamp, User Email, Account, Period, Count Date, Food/Packaging/Supplies/Snacks/Beverages ($), Total Value ($), notes (17/34). Append-only ops submissions.

### invoice_submissions_26 | 537 rows, real headers A-O + data in P-W
- LIVE A-O: UUID, Timestamp, Email, Account, Vendor, Vendor ID, Invoice #, Invoice Date, Total Amount, GL Breakdown, Drive URLs, Page Count, Email Sent, AI Scan Status, AI Scan Timestamp (O 97/537).
- **BUG/unlabeled P-W**: live data in UNLABELED columns. P 537/537 (sample "invoice" - a doc type), Q 469/537, R-W sparse 27/537 down to 2/537. Data being written to columns with no headers. Needs labeling or cleanup. HIGH-WRITE finance tab - investigate before migrating.

### labor_sold_revenue | 8 rows, 5 cols
- LIVE A-E: Account, HomestandID, SoldRevenue, Email, Timestamp. Append-only.

### service_day_overrides_26 | 0 data rows, 6 headers
- **DEAD/empty**: headers only. (Service calendar, half-built.)

### service_audit_log_26 | 7 rows, 11 cols
- **MISLABELED**: headers say AccountKey, Date, GroupName... but the DATA is shifted - col A holds a timestamp, B holds an email, C holds a name. Headers do not match data. Cols I/J/K (DayNote/EnteredBy/Timestamp) 0/7. Investigate the header/data mismatch before migrating.

### labor_plans | 19 rows, 15 cols
- LIVE A-K, M-O: PlanID, Timestamp, Email, AccountKey, HomestandID, BudgetEnvelope, CarryForward, ActualLaborSpent, Variance, CumulativeVariance, StreakCount, RevenueActual, ActualFood, ActualPackaging.
- **DEAD L**: Notes 0/19.

### submissions | 109 rows, 11 cols
- LIVE A-J: Timestamp, Submitter Email, Module, Employee Name, Location, Action Type, Effective Date, JSON Payload, Status, HR Notes (104/109).
- **BUG/unlabeled K**: no header, 104/109 filled (looks like a second timestamp / completion stamp). High-write people tab.

### paf_log | 0 data rows, 30 cols
- **MALFORMED**: row 1 is DATA, not headers (britt@kitchfix.com, dates, amounts in the header positions). 0 data rows beneath. Either a broken tab or a single mis-saved row. Investigate / likely DEAD.

### drafts | 46 rows, 4 cols, only 17 filled
- LIVE A-D: Email, Module, Updated At, JSON Payload - but 29 of 46 rows are BLANK (sample row 1 fully empty). Junk blank rows accumulating. Cleanup candidate.

### notification_log | 526 rows, real data A-H
- LIVE A-H: Timestamp, Recipient, Channel, Subject, Event Type, Status (F), Related Submission (255/526), Read (318/526).
- **DEAD/BUG I/J/K**: a SECOND "Status" at col I (0/526, duplicate of F), Notes (0/526), AdminAction (0/526). The duplicate Status header is dead.

### _archived_paf_log | 0 data rows, 31 headers
- **ARCHIVE/empty**: headers only, archived tab.

### _archived_newhire_log | 0 data rows, 19 headers
- **ARCHIVE/empty**: headers only, archived tab.

### incidents | 0 data rows, 48 headers
- **SCHEMA-ONLY/empty**: 48 columns of well-defined incident state-machine schema (incident_id through corrective_action_due_at), but ZERO data rows. The big state machine the code survey flagged as 22+ CA sites - currently UNUSED in the data. Confirm with code: is the incident feature live-but-unused, or built-but-never-fired?

### COLL__Cycle_Review_Header | 2 rows | SCHEMA-ONLY (row 1 = types: uuid, text, email...)
### COLL__Cycle_Review_Body | 3 rows | SCHEMA-ONLY (row 1 = types; cols N-Z padding)
### COLL__WOW_Plans_Header | 1 row | SCHEMA-ONLY (row 1 = types; cols V-Z padding)
### COLL__WOW_Plans_Body | 2 rows | SCHEMA-ONLY (row 1 = types; cols I-U padding)
### COLL__Scorecards | 2 rows | SCHEMA-ONLY (row 1 = types)
### COLL__Performance_Audit_Log | 1 row | SCHEMA-ONLY (row 1 = types; cols I-Z padding)
- All six performance tabs are scaffolding for the unbuilt performance/cycle-review feature. Type-definition rows, 0-3 real rows. Migrate when the feature ships, not before. Matches code survey (declared, unused).

### wastenot_log | 5 rows, 20 cols
- LIVE A-T: Timestamp, Date, Location, Pounds, Whoops, OverPrep, Safety, Quality, Expired, Other, Total, Reason, Details (4/5), Cost ($), CO2e (lbs), Trees, Water (gal), User Email, Week, Month. Real wastenot data, append-only.

### kudos_log | 0 data rows, 13 headers
- **DEAD/empty**: headers only (kudos feature staged).

### kudos_bonus_log | 0 data rows, 6 headers
- **DEAD/empty**: headers only.

### preservice_logs | 0 data rows, 5 headers
- **DEAD/empty**: headers only (pre-service tool not built).

### labor_logs | 0 data rows, 8 headers
- **DEAD/empty**: headers only.

### invoice_logs | 0 data rows, 12 headers
- **DEAD/empty**: headers only. (Distinct from invoice_submissions_26 which is the live one.)

### news_interactions | 19 rows, 6 cols
- LIVE A-F: postId, userEmail, read, readAt, saved, acknowledged. All 19/19. (Module 1 - cutover tomorrow. Header confirmed "postId", matches backfill recon.)

### systems_logs | EMPTY (0 rows, 0 cols)
- **DEAD/empty**: completely empty.

### deep_clean_days | 0 data rows, 4 headers
- **DEAD/empty**: headers only (AccountKey, Date, AddedBy, AddedAt).

---

## INVENTORY (10 tabs)

### item_catalog | 2688 rows, real data A-Q, sheet is 141 cols
- LIVE A-J, L-Q: itemId, account, name, category, unit, locationId, primaryVendor, lastPrice, lastPriceDate, lastPriceVendor (A-J), active, linkedToInvoice, isVarietyGroup, createdBy, createdAt, updatedAt (L-Q, updatedAt 2687/2688).
- **DEAD K**: priceAtLastCount 1/2688.
- **MASSIVE PADDING R-EK**: 124 empty unlabeled columns (R through EK, plus R/S have 1-3 stray values). This is the single biggest sheet-bloat in the system - the highest-volume tab (2688 rows) carrying 124 dead columns. Top cleanup target.

### item_aliases | 4423 rows, 8 cols
- LIVE A-H: aliasId, aliasText, canonicalItemId, vendor, confidence, approvedBy, approvedAt, source. All 4423/4423. Append-only, AI-cron-fed.

### item_sort_order | 0 data rows, 5 headers
- **DEAD/empty**: headers only (account, locationId, itemOrder, updatedBy, updatedAt).

### count_sessions | 5 rows, 18 cols
- LIVE A-F: sessionId, account, period, startedBy, startedAt, status.
- **DEAD/unfinished G-R**: submittedBy, submittedAt, totals (Food/Packaging/Supplies/Snacks/Beverages), grandTotal, adjustmentNote, itemsModifiedFlag, locationsVisited, locationsSkipped - all 0/5. Either the count-submit flow has not run to completion, or these are write-on-submit fields not yet exercised. Investigate vs code.

### count_items | 147 rows, 13 cols
- LIVE A-M: sessionId, locationSaveId, itemId, quantity, unit, priceAtCount, priceVendor, extendedPrice, locationId, countedBy, countedAt, savedAt, noneOnHand. All 147/147. Append-only count data.

### review_queue | 46 rows, 13 cols
- LIVE A-J: queueId, lineItemText, vendor, invoiceId, invoiceDate, account, suggestedMatchId (41/46), suggestedMatchName, confidence, status.
- **DEAD/unfinished K/L/M**: reviewedBy, reviewedAt, resultItemId - 0/46 (the review-action fields, not yet exercised, or read-but-never-written).

### storage_locations | 32 rows, 10 cols
- LIVE A-J: locationId, account, name, icon, sortOrder, active, createdBy, createdAt, parentLocationId (21/32), color (24/32). All core fields populated.

### price_history | 4394 rows, 7 cols
- LIVE A-G: itemId, account, vendor, price, invoiceDate, invoiceId, recordedAt. All 4394/4394. Append-only, AI-cron-fed.

### merge_history | 58 rows, 10 cols
- LIVE A-I: mergeId, account, timestamp, email, keeperItemId (29/58), keeperName (29/58), mergedItemIds (53/58), mergedNames (53/58), action.
- **DEAD J**: aiGroupId 0/58.

### zone_corrections | 0 data rows, 9 headers
- **DEAD/empty**: headers only.

---

## AI_LINE_ITEMS (9 per-account tabs)

All 9 tabs (STL-FL, STL-MO, CIN-OH, TXR-TX-H, TXR-TX-V, TXR-AZ, CIN-AZ, TBR-FL, TBJ-FL) are CLEAN and uniform:
- 15-16 cols A-O: Invoice UUID, Timestamp, Account, Vendor, Invoice #, Invoice Date, Line #, Item Description, Quantity, Unit, Unit Price, Extended Price, Category, Confidence, Raw JSON. (STL-MO has a 16th col, fully filled.)
- Fully populated, append-only AI invoice line-item logs. Row counts: CIN-OH 835, TXR-TX-H 736, CIN-AZ 662, TXR-AZ 608, TXR-TX-V 562, TBR-FL 548, STL-MO 432, TBJ-FL 262, STL-FL 127.
- NOTE: tab names use the SPACES format ("TXR - TX - H"). Confirms the account-key-format inconsistency (these are dynamically created per-account via createTabSA, named with spaces). Relevant to the account-key-format audit prerequisite.
- Only 9 tabs but 11 field accounts - TBJ-NY and STL-FL... (STL-FL present; missing TBJ-NY and one other - confirm whether those accounts have no AI line items yet or the tabs were never created).

---

## Scope summary - MEASURED (82 tabs, but the real migration is ~25 tables)

Bucketed every tab by data substance:

- **19 EMPTY tabs (0 data rows)** - nothing to migrate, pure cleanup (delete or ignore): HUB budgets, roster_config, preservice_content, ops_newsfeed, labor_settings; COLLECTION service_day_overrides_26, paf_log (malformed), _archived_paf_log, _archived_newhire_log, incidents (48-col schema, 0 rows), kudos_log, kudos_bonus_log, preservice_logs, labor_logs, invoice_logs, systems_logs, deep_clean_days; INVENTORY item_sort_order, zone_corrections.
- **6 TINY/SCHEMA tabs (1-3 rows, type-definition scaffolding)** - defer until feature ships: all six performance tabs (COLL__Cycle_Review_Header/Body, COLL__WOW_Plans_Header/Body, COLL__Scorecards, COLL__Performance_Audit_Log).
- **57 LIVE tabs** - but includes the 9 AI line-item tabs (one logical per-account thing) and many small config/content tabs. The genuinely substantial operational tables are ~25.

**Real migration target: ~25 tables of substance, not 82.** The rest is empty (cleanup), schema-only (defer), or trivial config.

### High-volume live tables (the data weight, all append-only = easy once pattern proven)
- item_aliases 4423, price_history 4394, item_catalog 2688, login_logs 1245, AI line items ~4770 total across 9 tabs, invoice_submissions_26 537, notification_log 526.

### The risky tables are SMALL or EMPTY right now (useful for sequencing)
- incidents: EMPTY (0 rows) - the 22-CA-site state machine has no data yet.
- submissions: 109 rows. invoice_submissions_26: 537. So the cell-addressing-heavy tables are not the big ones; the big ones are clean append-only logs.

### Cleanup punch list - dead columns (trim before/during migration)
- item_catalog: 124 empty trailing columns (R-EK) on a 2688-row tab. Biggest single cleanup.
- incidents: 48 columns, 0 rows (schema-only).
- _archived_paf_log: 31, paf_log: 30 (empty/malformed).
- dir_links: 20, _archived_newhire_log: 19, COLL__Performance_Audit_Log: 18, notifications: 17, news_posts: 14, COLL__Cycle_Review_Body + COLL__WOW_Plans_Body: 13 each, kudos_log: 13, invoice_logs: 12, count_sessions: 12 (unfinished fields).
- 19 fully-empty tabs = delete list.

---

## Anomalies & Observations

1. **Trailing padding columns** are pervasive: dir_links (G-Z), notifications (J-Z), labor_budgets (H-N), personnel_celebrations (D-Z), news_posts (M-Z), item_catalog (R-EK = 124 cols), and the performance tabs. None carry data. All safe-to-trim cleanup candidates. item_catalog is the worst by far.

2. **Empty/staged tabs** (headers but 0 data): HUB budgets, roster_config, preservice_content, ops_newsfeed (fully empty), labor_settings (fully empty); COLLECTION service_day_overrides_26, kudos_log, kudos_bonus_log, preservice_logs, labor_logs, invoice_logs, systems_logs (fully empty), deep_clean_days, _archived_paf_log, _archived_newhire_log; INVENTORY item_sort_order, zone_corrections. These are features staged-but-unused or archives. Confirm none are write-targets the code expects to exist.

3. **Schema-only tabs** (type-definition row, no real data): incidents (48 cols, 0 rows), all 6 performance tabs (Cycle_Review x2, WOW_Plans x2, Scorecards, Performance_Audit_Log), HUB Performance_Chain, HUB Cycle_Calendar. The performance/cycle-review feature is scaffolded but not live. Migrate when shipped.

4. **Read-but-never-written / data-in-unlabeled-columns (BUG class)** to investigate against code:
   - contacts G (Slack User ID): read, not written on edit (the known bug).
   - invoice_submissions_26 P-W: live data in unlabeled columns.
   - submissions K: live data in unlabeled column.
   - notification_log I/J/K: duplicate dead Status + empty Notes/AdminAction.
   - count_sessions G-R, review_queue K-M: action/total fields 0-filled - either unexercised or read-but-never-written.

5. **Mislabeled tabs** (header/data mismatch): service_audit_log_26 (data shifted vs headers - investigate), paf_log (row 1 is data not headers - malformed), wastenot_resources col A "Tittle" typo, kitchFix_philosophy header "Standard" vs philosophy content.

6. **Possible legacy duplicates**: HUB `vendors` (4 rows) vs vendor_master/vendor_accounts (the real vendor system); HUB lowercase `gl_codes` (10 rows) vs the separate GL_CODES spreadsheet (12 per-account tabs). Confirm which the code actually uses; the small ones may be orphans.

7. **Tabs NOT in the original code survey** (exist + populated, need code cross-ref to classify LIVE vs orphan): employee_roster (98), kiosk_info (12), homestand_schedule (408), labor_budgets (107), daily_pulse (60), did_you_know (30), kk_values (46), ai_prompts (69), wastenot_resources (9), HUB vendors (4), HUB gl_codes (10).

8. **Sensitive data note** (not a migration verdict, just flag): vendor_accounts L/M hold Portal Username/Password in plaintext. Whatever the migration does, these should never surface in a UI and should be access-controlled in Postgres.

9. **Account-key format - MEASURED (resolves the format-audit prerequisite for the directory/auth path):** Scanned every account-key-bearing column across all 4 sheets. Result: the system is overwhelmingly SPACES format ("CIN - OH") - 7,581 cells across 24 columns. HYPHEN format ("CIN-OH") appears in only 88 cells across 4 columns, and ALL of them are in modules we are deferring: service_config (75, service-calendar = half-built), service_audit_log_26 (7, service-calendar), HUB__Cycle_Calendar (4) + HUB__Performance_Chain (2) (the unbuilt performance feature).
   - **Canonical format = SPACES ("CIN - OH").**
   - **The directory + auth path is CLEAN**: every table directory touches (accounts, contacts, dir_links, work_locations) plus all high-volume operational tabs (labor_budgets, homestand_schedule, item_catalog, price_history, invoice_submissions_26, vendor_accounts, AI line items) use spaces consistently. The earlier "scoping joins might silently return empty" worry does NOT bite the directory/auth migration - that path is uniform.
   - The hyphen inconsistency is QUARANTINED in the deferred modules (service-calendar, performance). Normalize hyphen->spaces when THOSE modules eventually migrate - small contained job (~82 cells in service_config). Not a directory-phase concern.
   - Side confirmation: work_locations holds a "TBJ - NY" key, so TBJ-NY is a real account; the AI line items have only 9 tabs (no TBJ-NY) because that account has no AI invoice line items yet, not because the account is missing.
