# KitchFix Sheets Audit - SYNTHESIS (code x data cross-reference)

Cross-references the CODE side (CC's docs/SHEETS_AUDIT.md, 1726 lines, what the app reads/writes) against the DATA side (the actual sheet contents, read 2026-05-26). This is where the two halves meet and produce verdicts. Neither side alone could produce these - the cross-reference is the point.

**Verdict legend:**
- LIVE = code uses it + has real data. Migrate.
- UNUSED-LIVE = code targets it (reads/writes) but it has no data yet (feature works, never exercised). Migrate the structure; no data to backfill.
- DEAD = no code touches it + empty or near-empty. Cleanup, do not migrate.
- ORPHAN-CANDIDATE = has data but CC's code audit found no reader/writer. Either truly orphaned OR read by code CC did not route to / by an external process. NEEDS one confirm.
- REFERENCE = populated, maintained manually by Kevin, not app-driven. Stays in Sheet, do not migrate.
- SCHEMA-ONLY = type-definition scaffolding, unbuilt feature. Defer.
- EXTERNAL-WRITTEN = populated, but written by a process outside the main app (e.g. the inventory AI cron / Railway). Not dead; account for the external writer in migration.
- BUG = read-but-never-written, or data-in-unlabeled-columns.
- MISLABELED = header does not match data.

---

## THE KEY CROSS-REFERENCE RESOLUTIONS (where code and data disagreed)

These are the findings neither side could produce alone:

### 1. item_catalog cols M (linkedToInvoice) + N (isVarietyGroup) = EXTERNAL-WRITTEN, not dead
- CODE side: CC flagged both as read-but-never-written by the app (looked like a bug or dead).
- DATA side: both 2688/2688 fully populated.
- RESOLUTION: written by the inventory AI cron (the separate Railway repo `kitchfix-inventory-cron`), which CC's audit of `src/` did not cover. They are LIVE, maintained externally. Migration must preserve them and account for the cron as a writer. **Without both sides you would mis-verdict these** - code alone says "dead," data alone says "app maintains them," truth is the cron does.

### 2. contacts col G (Slack User ID) = BUG, confirmed by both sides
- CODE: read (powers Slack button), never written on edit. DATA: 20/30 filled. Agreed: live bug, the edit flow blanks it. Narrow fix during directory build (preserve G on re-append). The 10 blanks are why some Slack links do not land on the person.

### 3. Empty-but-code-targeted tabs = UNUSED-LIVE, not dead
- CC lists these as code-referenced (the app reads/writes them); DATA shows 0 rows: `incidents` (52-col schema), `service_day_overrides_26`, `deep_clean_days`, and the staged log tabs. RESOLUTION: the features are wired but never exercised. Migrate the structure, nothing to backfill. NOT cleanup-deletable (code expects them to exist).

### 4. The 34-vs-21 HUB tab gap = ORPHANS, now DEFINITIVE (not just candidates)
- DATA: HUB has 34 tabs. CODE: searched CC's full 1726-line audit for each unlisted tab. RESULT: **zero mentions** of employee_roster, kiosk_info, daily_pulse, did_you_know, kk_values, ai_prompts, wastenot_resources, roster_config, preservice_content, ops_newsfeed, labor_settings anywhere in CC's audit. CC's code map is the authority on what code touches; these are simply not in it. VERDICT: ORPHANS - populated in the sheet, never touched by app code. Definitive, not "needs confirm." Most likely: employee_roster = HR-system export (manual paste/sync); HUB vendors + lowercase gl_codes = legacy pre-portal orphans; the content tabs (daily_pulse/did_you_know/kk_values/ai_prompts/wastenot_resources) = staged content not yet wired. Kevin confirms intent, but the code verdict is clear: nothing reads them.

### 5. Account-key format = SPACES canonical (measured), inconsistency quarantined
- CODE: CC flagged spaces-vs-no-spaces in GL_TAB_MAP. DATA: measured 7,581 spaces-format cells vs 88 hyphen-format, and ALL 88 hyphen cells are in deferred modules (service_config, service_audit_log_26, the performance tabs). RESOLUTION: spaces ("CIN - OH") is canonical; the directory/auth path is uniform and safe; normalize hyphen->spaces only when service-calendar/performance migrate. Not a directory-phase risk.

---

## VERDICTS BY SPREADSHEET

### HUB

**Directory module (migrate, module 2):**
- accounts - LIVE. 12 rows, 20 cols (A-T). Cols A-M/R-T live; N/O/P/Q (Wifi/Gate/Door) DEAD (0/12). Note col T=Region: read by people (incident routing), populated externally, and directory's current write range is A:R so col T is PRESERVED today - but LATENT RISK if that write range ever extends (would blank Region, same class as the col-G bug). Directory migration must keep the write bounded or explicitly preserve col T. 5-module hot-read - per-module read flags needed.
- contacts - LIVE (A-F) + BUG (G, read-not-written) + REFERENCE (H/I/J, Kevin's notes). Migrate A-G, fix G, leave H/I/J.
- dir_links - LIVE A-F, PADDING G-Z (20 dead cols). Folds into accounts per directory design.
- work_locations - LIVE A-C. Keep as real table (unknown external consumers).
- hero_images - LIVE (1 col, 6 URLs).

**Other LIVE config/content (code-confirmed by CC):**
- admins - LIVE, read-only auth config (8 rows). Stays Sheets until auth model retires it.
- news_posts - LIVE A-L, PADDING M-Z (14 dead). Read by dashboard.
- notifications - LIVE A-I, PADDING J-Z (17 dead). People module config.
- period_data - LIVE (fiscal periods, read by ops/cron).
- personnel_celebrations - LIVE A-C, PADDING D-Z (23 dead). Read by cron-daily.
- kitchFix_philosophy - LIVE (dashboard reads it). MISLABEL: header "Standard" vs philosophy content.
- homestand_schedule - LIVE (408 rows, ops/labor). CC confirms reader.
- labor_budgets - LIVE A-G, PADDING H-N (7 dead). Ops.
- library_manifest - LIVE (leadership-dugout). NOTE: CC lists both `library_manifest` and `ldug_library_manifest` - confirm if duplicate/alias.
- service_config - LIVE (97 rows, service-calendar config). Uses hyphen-format keys (deferred module).
- vendor_master - LIVE A-G/I; DEAD H (lastInvoiceDate 0/35); junk J. Invoice module.
- vendor_accounts - LIVE A-M/Q-U; DEAD N/O/P (Contact fields 0/54), V (Notes 0/54); junk W/X. FLAG: L/M = plaintext Portal credentials (never surface in UI).
- HUB__Performance_System_Config - LIVE (17 rows) BUT CC: 12 of 15 CONFIG_KEYS never read/written = mostly SCHEMA-ONLY placeholders.

**SCHEMA-ONLY (defer, performance feature unbuilt):**
- HUB__Performance_Chain - 4 rows, type-def row. CC: referenced by performanceChain.
- HUB__Cycle_Calendar - CC: declared but NEVER accessed by code. DEAD/SCHEMA-ONLY.

**ORPHAN-CANDIDATES (data present, CC found no reader/writer - NEEDS CONFIRM):**
- employee_roster (98 rows, real HR data) - biggest orphan-candidate. Likely an external HR export (manual paste / sync), not app-read. Confirm.
- kiosk_info (12 rows) - possible orphan or read by a path CC missed.
- daily_pulse (60), did_you_know (30), kk_values (46), ai_prompts (69), wastenot_resources (9) - content tabs. Likely feed features (pulse poll, kudos values, AI prompt library) OR are staged content. Confirm which are code-read.
- vendors (4 rows) - LEGACY-DUPLICATE candidate (vs vendor_master/vendor_accounts). Likely orphan from pre-vendor-portal.
- gl_codes (10 rows, lowercase) - vs the separate GL_CODES spreadsheet (12 per-account tabs CC confirmed). Confirm which is used; lowercase one may be orphan.

**DEAD/EMPTY (cleanup, no code data dependency):**
- budgets, roster_config, preservice_content (headers only); ops_newsfeed, labor_settings (fully empty).

### COLLECTION

**LIVE (high-write actuals, migrate per risk order):**
- news_interactions - LIVE (module 1, cutover tomorrow). Clean.
- submissions - LIVE A-J + BUG/write-only K (admin-action stamp, CC confirms write-never-read). 109 rows. People state machine.
- notification_log - LIVE A-H; DEAD I/J/K (duplicate Status at I + empty Notes/AdminAction). 526 rows. CC: multi-writer (people+ops+cron) - coordinated migration.
- invoice_submissions_26 - LIVE A-O + data-in-unlabeled-cols P-W (BUG/needs labeling). 537 rows. Finance-critical.
- inventory_submissions, labor_plans (DEAD col L Notes), labor_sold_revenue, login_logs, wastenot_log - all LIVE append-only.
- drafts - LIVE but 29/46 rows blank (junk rows, cleanup).

**UNUSED-LIVE (code targets, no data yet - migrate structure):**
- incidents - code-wired 52-col state machine, 0 rows. CC: multi-writer, the 22+ CA-site complex surface. Migrate structure when its turn comes; no backfill. (CC note: incidentSchema comment says 48 cols, actual 52 - stale comment.)
- service_day_overrides_26, deep_clean_days - code-targeted, 0 rows.

**SCHEMA-ONLY (defer, performance/cycle-review unbuilt):**
- COLL__Cycle_Review_Header/Body, COLL__Scorecards - CC: declared, never accessed. Type-def rows only.
- COLL__WOW_Plans_Header/Body - CC: WOW plans referenced (Header is multi-writer); 1-2 type-def rows. Defer.
- COLL__Performance_Audit_Log - type-def row only.

**DEAD/EMPTY/ARCHIVE (cleanup):**
- paf_log (MALFORMED - row 1 is data not headers), _archived_paf_log, _archived_newhire_log (archives, 0 rows), kudos_log, kudos_bonus_log, preservice_logs, labor_logs, invoice_logs (staged, 0 rows), systems_logs (fully empty).

**MISLABELED (investigate before migrate):**
- service_audit_log_26 - DATA shows header/data mismatch (col A header "AccountKey" holds a timestamp). 7 rows. Service-calendar (deferred). Investigate the shift.

**CODE-ONLY tabs CC names that I should flag** (CC lists, confirm against sheet): `Projections - 2026`, `Actuals - 2026`, `Clicker Counts - 2026` - CC says service-calendar writes Projections/Actuals (grid, high CA), Clicker declared-unused. These may live in per-account service-calendar spreadsheets, not the main COLLECTION (my 4 uploads did not include a Projections/Actuals tab in COLLECTION). Confirm where these physically live - likely the separate per-account service-calendar sheets, out of my upload set.

### INVENTORY (all code-confirmed live by CC, inventoryActions)

- item_catalog - LIVE A-Q; DEAD K (priceAtLastCount 1/2688); EXTERNAL-WRITTEN M/N (cron); MASSIVE PADDING R-EK (124 dead cols - biggest cleanup target). 2688 rows.
- item_aliases (4423), price_history (4394) - LIVE, EXTERNAL-WRITTEN (AI cron), append-only. High volume but trivial migration.
- count_items (147), storage_locations (32), review_queue (46, DEAD K/L/M action fields), merge_history (58, DEAD J aiGroupId) - LIVE.
- count_sessions - LIVE A-F; cols G-R (totals/submit fields) 0/5 = UNUSED-LIVE (submit flow not exercised to completion yet) - confirm vs code (CC: are these write-on-submit?).
- item_sort_order, zone_corrections - DEAD/EMPTY (0 rows, code-targeted = UNUSED-LIVE structurally).

### GL_CODES
- 12 per-account tabs, read-only chart-of-accounts lookups (CC resolved via GL_TAB_MAP). Hyphen/spaces mixed in tab names (the format inconsistency). Config-shape - likely stays Sheets-as-config, low migration value.

### AI_LINE_ITEMS
- 9 per-account tabs, append-only AI invoice line-item logs, uniform 15-col, fully populated. EXTERNAL/AI-written. CC: dynamic per-account tabs + "Invoice Uploads" fallback. Migrate as append-only when invoice flow migrates. Only 9 tabs for 11 accounts (TBJ-NY etc. have no line items yet - not missing accounts).

### GAME
- Paused. Excluded. Not a migration target.

---

## THE CLEANUP PUNCH LIST (safe to do, independent of migration)

**Delete-able empty tabs (0 rows, no code data dependency - but confirm code does not expect them to exist before deleting):**
- HUB: budgets, roster_config, preservice_content, ops_newsfeed, labor_settings
- COLLECTION: paf_log (malformed), _archived_paf_log, _archived_newhire_log, kudos_log, kudos_bonus_log, preservice_logs, labor_logs, invoice_logs, systems_logs
- CAUTION: service_day_overrides_26, deep_clean_days, incidents, item_sort_order, zone_corrections are EMPTY but code-targeted (UNUSED-LIVE) - do NOT delete, the code expects them.

**Trim dead trailing columns (sheet bloat, no data):**
- item_catalog R-EK (124 cols) - by far the biggest
- dir_links G-Z (20), notifications J-Z (17), news_posts M-Z (14), personnel_celebrations D-Z (23), labor_budgets H-N (7)

**Drop confirmed-dead labeled columns (0-filled, no code read):**
- accounts N/O/P/Q (Wifi/Gate/Door), vendor_master H (lastInvoiceDate), vendor_accounts N/O/P/V (Contact fields/Notes), notification_log I/J/K (dup Status/empty), labor_plans L (Notes), merge_history J (aiGroupId), item_catalog K (priceAtLastCount)

**Fix mislabels:**
- service_audit_log_26 (header/data shift - investigate first), paf_log (malformed), wastenot_resources "Tittle" typo, kitchFix_philosophy "Standard" header, contacts (the col-G blanking bug)

**Stale code comments (CC found, low priority):**
- incidentSchema.js "48 cols" -> actual 52; directory/route.js header comment says "read-only" but directory writes 5 tabs.

---

## THE REAL MIGRATION SCOPE

Of 82 tabs:
- **~25 LIVE tables of real substance** = the actual migration.
- **19 EMPTY** = cleanup (delete) or UNUSED-LIVE structure (incidents etc.).
- **6 SCHEMA-ONLY** (performance) = defer.
- **~11 ORPHAN-CANDIDATES** = confirm, most likely don't migrate (reference/external/legacy).

**Migration order (confirmed by both sides, risk-ranked):**
1. news_interactions (done, cutover tomorrow)
2. directory (accounts/contacts/dir_links/work_locations/hero_images) - module 2
3. People Portal: submissions, then incidents (when it has data), then drafts/notification_log
4. Invoice config (vendor_master/vendor_accounts)
5. Smart Inventory (item_catalog + the append-only logs - high volume, low complexity, account for AI cron as external writer)
6. invoice_submissions_26 (finance-critical, save for mature pattern)
7. Defer: service-calendar (Projections/Actuals grids, half-built), performance (schema-only), GL_CODES (config)

---

## RESOLVED by CC's full audit (were open, now closed)

1. **ORPHANS** - RESOLVED. CC's audit has zero mentions of the orphan tabs. Definitively not code-touched. (Kevin confirms intent: which are HR-export / legacy / staged-content. But the migration verdict is settled: do not migrate, they are not part of the app.)
2. **Projections/Actuals/Clicker** - RESOLVED. CC confirms these are per-account service-calendar spreadsheets (Part 2 + Part 3), not main COLLECTION. Deferred with service-calendar.
3. **library_manifest vs ldug_library_manifest** - RESOLVED. Two distinct tabs: library_manifest read by people, ldug_library_manifest read by leadership-dugout. Not a duplicate.
4. **accounts col T (Region)** - RESOLVED + IMPORTANT. CC: read by people:1672 (incident region routing), populated externally, and directory's write range is A:R so col T is PRESERVED today. But it is a LATENT RISK: if directory's full-row write ever extends past col R, it would blank Region. The directory migration must keep the write range bounded OR explicitly preserve col T. Same class as the col-G bug, currently dormant.
5. **service_audit_log_26 mislabel** - SOFTENED. My data side flagged a header/data shift; CC lists it as a clean write-only audit log (cols A-H all deliberately written). Likely NOT a true mislabel - the apparent shift is the audit-row structure. Verdict downgraded from MISLABELED to "verify, likely fine per code."

## STILL OPEN (genuinely need Kevin or a tiny check)

1. **count_sessions G-R empty fields** - write-on-submit (UNUSED-LIVE, fine) or read-but-never-written (BUG)? CC's inventory audit lists count_sessions as 14 cols actively used; the 0-fill is likely "submit flow not exercised to completion yet." Low-stakes, confirm during inventory migration.
2. **Empty tabs before deleting** - before deleting any empty tab, confirm code does not `getSheetIdSA`/expect-it-to-exist (a missing tab the code reaches for throws). CC's Part 4-I lists the schema-declared tabs that may not need to exist; cross-check the delete-list against any getSheetIdSA calls before removing.
3. **Kevin's intent on the orphans** - employee_roster, the content tabs, legacy vendors/gl_codes: keep as reference, or delete? (Code says they are not app-data; your call on whether they are useful to you outside the app.)

Everything else is verdicted. The audit is effectively closed - these three are refinements, not blockers.
