# Sheet Inventory — Ground Truth as of 2026-05-14

> **Purpose:** Capture which Sheets tabs are populated, empty, or in-development. This is the ground-truth reference for Stage 0 audit and migration planning.
>
> **Source:** HUB + COLLECTION xlsx files downloaded from production Google Sheets on 2026-05-14.
>
> **Re-derivation cost:** ~15 minutes (download xlsx, run inspection script). Don't re-derive in future sessions unless you suspect drift.
>
> **Update cadence:** Refresh this doc once per stage of the migration (Stage 0 complete, Stage 1 complete, etc.) or whenever a significant tab is created/deleted.

---

## HUB Spreadsheet

**ID:** `1rvIg9trPCxiEWvzrYbtp1j7V_sbtQnKaysv5BOwA90E`
**Purpose:** Source-of-truth configuration. Read-heavy. Operators edit some tabs manually.
**Total tabs:** 34

### Populated (active, data exists)

| Tab | Rows | Cols | Purpose / Notes |
|---|---|---|---|
| `hero_images` | 7 | 1 | Dashboard hero image URLs with type tags |
| `accounts` | 13 | 20 | KitchFix account list (MLB/MiLB/PDCs) |
| `dir_links` | 12 | 6 | Team Directory external links |
| `contacts` | 32 | 9 | Operator/manager contact roster |
| `work_locations` | 13 | 3 | Physical location codes |
| `employee_roster` | 99 | 15 | Synced from Rippling (read-only via that integration) |
| `kiosk_info` | 13 | 4 | Kiosk device info |
| `admins` | 9 | 5 | Admin permissions per module (home/hr/finance/ops) |
| `notifications` | 14 | 9 | Notification routing config |
| `homestand_schedule` | 409 | 6 | MLB homestand schedule (high row count) |
| `labor_budgets` | 108 | 7 | Labor budget targets per account/period |
| `vendor_master` | 33 | 9 | Vendor master record |
| `vendor_accounts` | 50 | 22 | Vendor-account relationships |
| `service_config` | 98 | 12 | Service Calendar config |
| `library_manifest` | 10 | 10 | Leadership Dugout library entries |
| `period_data` | 14 | 4 | KitchFix period (P1-P13) date ranges |
| `gl_codes` | 11 | 3 | GL chart of accounts for invoices |
| `vendors` | 5 | 3 | Smaller vendor list (relationship to `vendor_master` unclear, audit) |
| `personnel_celebrations` | 157 | 3 | Birthdays + work anniversaries (active, drives CelebrationBar + hero swap) |
| `daily_pulse` | 61 | 6 | Daily pulse content (verify usage — may be legacy) |
| `news_posts` | 7 | 12 | KitchFix News feed posts (active) |
| `kitchFix_philosophy` | 29 | 1 | "Today's Motivation" quotes |
| `did_you_know` | 31 | 2 | Trivia/facts (verify usage — may be legacy) |
| `wastenot_resources` | 10 | 4 | Resources for the waste-not feature (which itself appears dead — audit) |
| `kk_values` | 47 | 2 | KitchFix core values (verify usage) |
| `ai_prompts` | 70 | 4 | AI prompt templates (active for invoice OCR) |
| `budgets` | 1 | 5 | Header only — verify if this is dormant or in-development |

### Empty (0 data rows) — fair-game for audit

| Tab | Rows | Status |
|---|---|---|
| `roster_config` | 1 | Header only — verify if dormant |

### Empty / 0 rows / 0 cols — likely never built

| Tab | Status |
|---|---|
| `ops_newsfeed` | 🚫 IN DEVELOPMENT — do not touch |
| `labor_settings` | 0 rows, 0 cols — likely never used; fair-game pending audit |

### In development — DO NOT TOUCH

| Tab | Status |
|---|---|
| `preservice_content` | 1 row (header only) — Pre-Service Briefing Tool in dev |
| `HUB__Performance_Chain` | 5 rows | KPI Dashboard work, parked |
| `HUB__Cycle_Calendar` | 11 rows | KPI Dashboard work, parked |
| `HUB__Performance_System_Config` | 18 rows | KPI Dashboard work, parked |

---

## COLLECTION Spreadsheet

**ID:** `1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ`
**Purpose:** Transaction logs. Write-heavy. Application records events here.
**Total tabs:** 29

### Populated (active, data exists)

| Tab | Rows | Cols | Purpose / Notes |
|---|---|---|---|
| `login_logs` | 1246 | 3 | Login visit logs — **read+write deleted in PR #23** (data abandoned in sheet but no longer accumulating) |
| `inventory_submissions` | 28 | 13 | Active inventory submission log |
| `invoice_submissions_26` | 386 | 15 | Active invoice submission log (high volume — biggest single tab) |
| `labor_sold_revenue` | 8 | 5 | Labor / revenue records |
| `service_audit_log_26` | 8 | 11 | Service Calendar audit log |
| `labor_plans` | 16 | 15 | Labor planning records |
| `submissions` | 96 | 10 | People Portal submission log (PAFs, new hires, etc.) |
| `drafts` | 17 | 4 | People Portal draft saves |
| `notification_log` | 411 | 11 | Notification emails sent log (high volume) |
| `news_interactions` | 18 | 6 | Per-user news read/save/ack state |
| `wastenot_log` | 6 | 20 | Waste tracking — **read deleted in PR #23**; 5 actual data rows total (lightly used or abandoned) |

### Empty (0 data rows) — fair-game for audit OR in-development (see below)

| Tab | Rows | Status |
|---|---|---|
| `kudos_log` | 1 | Header only — feature never adopted in production. **Read deleted in PR #23.** |
| `kudos_bonus_log` | 1 | Header only — companion to dead kudos feature. Fair-game for code deletion. |
| `paf_log` | 1 | Header only — likely legacy from before unified `submissions` tab. Fair-game audit. |
| `_archived_paf_log` | 1 | Header only — archive table never used. Fair-game audit. |
| `_archived_newhire_log` | 1 | Header only — archive table never used. Fair-game audit. |
| `labor_logs` | 1 | Header only. Fair-game audit. |
| `invoice_logs` | 1 | Header only. Fair-game audit. |
| `service_day_overrides_26` | 1 | Header only — likely related to in-dev Service Calendar work |
| `systems_logs` | 0 | 0 cols — never initialized. Fair-game audit. |

### In development — DO NOT TOUCH

| Tab | Rows | Status |
|---|---|
| `incidents` | 1 | Incident Reporter feature in active development |
| `preservice_logs` | 1 | Pre-Service Briefing Tool in dev |
| `deep_clean_days` | 1 | In development |
| `COLL__Cycle_Review_Header` | 3 | KPI Dashboard work, parked |
| `COLL__Cycle_Review_Body` | 4 | KPI Dashboard work, parked |
| `COLL__WOW_Plans_Header` | 2 | KPI Dashboard work, parked |
| `COLL__WOW_Plans_Body` | 3 | KPI Dashboard work, parked |
| `COLL__Scorecards` | 3 | KPI Dashboard work, parked |
| `COLL__Performance_Audit_Log` | 2 | KPI Dashboard work, parked |

---

## Cross-cutting Notes

### Tabs with discovered dead-read code in PR #23
- `kudos_log` (read removed from `/api/dashboard`)
- `wastenot_log` (read removed from `/api/dashboard`)
- `login_logs` (read AND write removed from `/api/dashboard`)

### Tabs with confirmed dead-feature code (likely candidates for Stage 0 cleanup)
Based on empty data + presumed legacy:
- `kudos_log` — feature never adopted, computation logic still references the tab from multiple code paths beyond dashboard (audit `news/NewsFeed.js` references)
- `kudos_bonus_log` — companion to dead kudos
- `paf_log` — likely superseded by unified `submissions` tab
- `_archived_paf_log`, `_archived_newhire_log` — archive tables never used
- `labor_logs`, `invoice_logs`, `systems_logs` — header-only tabs, code may reference but data shows no usage

### "DO NOT TOUCH" list (confirmed with Kevin 2026-05-14)
Code paths reading from or writing to these tabs must remain untouched during audit and migration until their respective features are launched or deprecated:
- `incidents` — Incident Reporter feature in development
- `preservice_logs`, `preservice_content` — Pre-Service Briefing Tool in development
- `deep_clean_days` — in development
- `ops_newsfeed` — in development
- All `HUB__Performance_*` tabs — KPI Dashboard parked but may resume
- All `COLL__Cycle_Review_*`, `COLL__WOW_*`, `COLL__Scorecards`, `COLL__Performance_Audit_Log` — KPI Dashboard parked

### Tabs read by routes (verification needed)
Many tabs are read by multiple routes. Full audit per route is Stage 0 work. Inventory of routes that touch sheets:
- `/api/dashboard` — partially audited (PR #23)
- `/api/people` — **audit next session** (largest, 2165 lines, 25+ action handlers)
- `/api/ops` — pending audit
- `/api/service-calendar` — pending audit
- `/api/directory` — partially audited yesterday (drive-image action uses user OAuth, dependency for Task #2)
- `/api/people/leadership-dugout` — pending audit
- `/api/cron/daily` — pending audit
- `/api/cron/backup-sheets` — verify this still needs all the same tabs

---

## How to refresh this inventory

```bash
# Download current production Sheets as xlsx (manual step: File > Download > xlsx)
# Then in python (or equivalent):

python3 << 'EOF'
from openpyxl import load_workbook
for fname, label in [("hub.xlsx", "HUB"), ("collection.xlsx", "COLLECTION")]:
    wb = load_workbook(fname, read_only=True, data_only=True)
    print(f"\n========== {label} ==========")
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = sum(1 for row in ws.iter_rows(values_only=True) if any(c is not None for c in row))
        cols = 0
        for row in ws.iter_rows(max_row=1, values_only=True):
            cols = sum(1 for c in row if c is not None)
            break
        print(f"  - {sheet_name}: {rows} non-empty rows, ~{cols} cols")
    wb.close()
EOF
```

Replace the tables above with new findings. Note any tabs that appeared or disappeared.
