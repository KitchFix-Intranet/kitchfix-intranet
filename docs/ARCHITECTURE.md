# Architecture - KitchFix Ops Hub

> **Purpose:** The 30,000-ft view of how this system is wired. Read this before touching anything new.
>
> **Last verified:** 2026-06-12 (close-out alignment)
>
> **Live per-module state lives in [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md).** This doc is the spatial mental model; that one is the source of truth for which modules sit on PG vs Sheets.
> **Verified against:** `src/lib/sheets.js`, `src/lib/auth.js`, `src/middleware.js`, `vercel.json`, `package.json`

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Auth | NextAuth v5 + Google OAuth |
| Database | **Sheets + Supabase Postgres (dual layer; six modules cut over)** - see "Data layer" below |
| File storage | Google Drive |
| Email | Gmail API |
| AI | Anthropic Claude API (Invoice OCR, vendor auto-detect, document chunk embeddings) |
| Hosting | Vercel Pro |
| Background jobs | Vercel cron (3 jobs - daily notifications, incident reminders, sheets backup) + Railway cron (1 job - inventory catalog matching, parked with Smart Inventory) |
| Notifications | Slack webhooks |
| PDF generation | `pdf-lib` (invoice stamping), WeasyPrint (Pre-Service Materials, separate pipeline) |
| Styling | Vanilla CSS with module-prefixed classes; Tailwind v4 imported as utility backstop |

---

## The data layer: Sheets + PG dual layer

After the 2026-04-through-06 migration project (now CLOSED), the system runs on a **dual data layer**: Sheets and Supabase Postgres. Six modules cut over to PG with dual-write to Sheets as rollback net. Six surfaces remain on Sheets pending per-item dispositions (most "leave; rebuild later"). See [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) for per-module state and [`MIGRATION_PROJECT_CLOSEOUT.md`](MIGRATION_PROJECT_CLOSEOUT.md) for the dispositions.

### Postgres (Supabase) - source of truth for cut-over modules

The six cut-over modules read from PG by default. Schema lives in `docs/migrations/*.sql` (applied manually in Studio - not auto-applied on deploy). Tables include:

| Module | Tables |
|---|---|
| News | `news_interactions` |
| Directory | `accounts`, `contacts`, `hero_images`, `work_locations` |
| People-submissions | `submissions` (PAFs, incidents structure, etc.) |
| Vendor | `vendors`, `vendor_aliases`, `vendor_accounts` |
| Invoice | `invoice_submissions`, `invoice_rejections`, `ai_line_items`, `gl_codes` |
| Playbook/OPD | `documents`, `document_chunks`, `document_relationships`, `document_surfaces`, `document_issues` |
| Smart Inventory (parked) | `inventory_items`, `item_aliases`, `price_history`, `review_queue`, `merge_history`, `merge_history_items`, `count_sessions`, `count_items`, `storage_locations` |

Writes to cut-over modules go to **both** Sheets and PG (dual-write); reads come from PG.

### Sheets - the original substrate, now the rollback net + still-on-Sheets surfaces

The original five-spreadsheet model. Still load-bearing for unmigrated modules + still receiving every write from cut-over modules as the rollback net.

| Pillar | Constant | Role | Notes |
|---|---|---|---|
| 1. Master Hub | `SHEET_IDS.HUB` | Source of truth - config, accounts, periods, contacts, admins, hero images, notifications, library manifests | Cut-over modules now read PG for accounts/contacts/etc.; HUB writes continue for backup |
| 2. Data Collection | `SHEET_IDS.COLLECTION` | Transaction logs - submissions, drafts, notification log, incidents, audit | Cut-over modules dual-write here; still-on-Sheets modules write here exclusively |
| 3. Game Engine | `SHEET_IDS.GAME` | Gamification logic | Sheets-only (no migration target) |
| 4. GL Codes | `SHEET_IDS.GL_CODES` | Chart of accounts for invoice coding | PG-mirrored as part of Invoice cutover; gl_codes table is the canonical now |
| 5. AI Line Items | `SHEET_IDS.AI_LINE_ITEMS` | Invoice line items extracted by Claude OCR (per-account tabs) | PG-mirrored; PG is canonical, Sheets is dual-write rollback |
| (separate) | `SHEET_IDS.INVENTORY` | Inventory schema (8-tab) - items, locations, counts, vendor mapping | Smart Inventory tables exist in PG; both stores write (cron + intranet); Sheets remains canonical for prototype-1 data preservation per the 2026-06-12 no-wipe decision |

**When designing a new feature, build Supabase-native** using the `dataStore` orchestrator pattern (see "Module map" below). The Sheets-only pattern persists in legacy modules but is not the model for new work. See [`MIGRATION_PROJECT_CLOSEOUT.md`](MIGRATION_PROJECT_CLOSEOUT.md) §H for the pattern contrast.

### OPD: MDX is the source of truth, Postgres holds the overlay

The Playbook / OPD module is the one place in the stack where the source of truth is **not** Postgres. After the doc-format arc, repo-canonical MDX (`content/documents/*.mdx`) holds document content + identity + structure. The projection script (`scripts/content/project-catalog.mjs --apply`) derives the Postgres `documents` row from MDX on every run. Postgres holds an **overlay** of operational-lifecycle fields that the projection PRESERVES (never overwrites) so the dashboard can own them as instant, no-deploy edits.

The boundary:

| Lives in | Fields | Edit path |
|---|---|---|
| **MDX (`content/documents/*.mdx`)** - the document | id, title, doc_class, version, shelf, sort_order, card_line, summary, keywords, owner, approver, audience, classification, print_required, critical, effective_date, last_reviewed, approved_date, content body, relationships, surfaces | Edit the MDX file -> run projection -> changes land in Postgres on next apply |
| **Postgres overlay** - operational lifecycle | status, access_level, pinned (in `document_pins`), archived / archived_at, source_drive_id* (dead, retiring), storage_path (reserved) | Edit via the Build Dashboard (becoming "OPD Command") - instant, persists across projection applies |

**The rule:** editing an MDX-authored field anywhere except the MDX file is a silent-data-loss trap. The dashboard can show a value and accept an edit, but the next `--apply` overwrites it. The dashboard rebuild (OPD Command) makes this boundary visible at the cell level - overlay fields are editable; MDX-authored fields are read-only with an "edit in MDX" affordance.

**Projection preserves overlay by omission:** fields the projection doesn't include in `mdxToDocRow` aren't written. PostgREST `.upsert(rows, { onConflict: "id" })` only updates columns present in the INSERT list, so omitted columns ride through ON CONFLICT untouched. Status is the exception (NOT NULL with no default) and uses conditional include - see `GOTCHAS.md` "`documents.status` is NOT NULL with no default."

**Drive is retired as an OPD content source.** The doc-format arc replaced Drive-hosted PDFs with in-app MDX rendering (cover, TOC, print/PDF, the works). `documents.source_drive_id` / `_es` columns and a reader iframe fallback still exist but are scheduled for deletion once the operator-catalog alive-test in `PlaybookClient.js` is unwired from Drive.

### Service Calendar architecture

This section orients; the deep docs hold the detail.

**Two-layer money model.** Per-meal / operational revenue is derived via the effective-dated view `sc_daily_revenue` (LATERAL join across `sc_service_prices` on `service_date`). Contract revenue (annual fees, SF% amounts, flat-fee accounts) lives in `sc_fee_schedule` and is managed via the admin surface. The KPI/dashboard lens reads both as additive P&L lines. Canonical doc: [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md).

**Server-authoritative saved totals.** After a day/bulk save, `sc-submit-day` reads `sc_daily_revenue` AFTER the write via `readSavedDayTotals`, then returns `savedRevenue` and `savedMeals` in the response. Every surface (day-tile total, drill rail, review overlay, submission toast, bulk header) echoes those numbers - one server-computed truth per save. Landed via #361 (SC-051).

**Append-only notes ledger.** Day notes persist to `sc_day_note_entries` (one row per authored note; author derived server-side from the session, never accepted from client input). The `sc-add-note` action appends; DayDetail renders the ledger client-side. The dormant `sc_day_metadata.day_notes` column was backfilled into the ledger with author `"-"` (typographic no-data placeholder) on cutover. Landed via #367 (SC-079); schema is `docs/migrations/sc-9-day-note-entries.sql`.

**Effective-dated price model.** `sc_service_prices` carries a `price_kind` enum (`'projected'` or `'actual'`) plus an `effective_date`. The view LATERAL-joins the newest `service_date <= effective_date` row per (service, date), and falls back on `COALESCE(pr_act.price, pr_proj.price)` when no actual row exists yet. That fallback is why removing the sc-8b double-discounted `'actual'` rows in sc-8c self-healed history via the view. Migrations: `sc-8a` (kind column), `sc-8b` (view + backfill, since superseded), `sc-8c` (double-discount cleanup, 2026-07-09). Detail: [`SC_MONEY_ALIGNMENT_REPORT.md`](SC_MONEY_ALIGNMENT_REPORT.md).

**Classifier asymmetry.** `classifyDayStatus` in `src/lib/dataStore/serviceCalendar.js:~183-216` treats a zero actual count differently by account shape: on per-meal accounts an all-zero save reads as `"no-service"`; on MLB homestand accounts an all-zero save on a GAME day reads as `"entered"` (a recorded rainout). Deliberate per owner ruling 2026-07-09. Full rationale in [`GOTCHAS.md`](GOTCHAS.md) "SC classifier: per-meal zero and homestand zero mean opposite things."

**Debug-hook pattern.** Failed-atom rendering is testable via `?debug=failed` gated on `isDev`, wired in `src/app/service-calendar/ServiceCalendar.js:1509` (overview) + `:1555` (period + month drill scopes). Forces `resolveDayStatus` to return failed for one tile so the failure state can be inspected. This is the canonical pattern for forcing UI states in dev: `isDev && searchParams.get('debug') === '<state>'` + a per-consumer resolver override.

**Schema hygiene note.** `sc_services.deleted_at` is a reserved hard-delete escape hatch - populated by nothing, filtered for defense in ~10 read sites. Live archive uses `active_until` (`sc-6c`, sets a date; NULL = active forever). Do not conflate the two.

### Cutover control plane

`src/lib/cutover.js` parses two env-var-derived flag sets at module load:

```js
DUAL_WRITE_TABLES=table_a,table_b,...        // mirror to PG on writes
READ_FROM_POSTGRES=table_a,table_b,...       // read from PG (instead of Sheets)
READ_FROM_POSTGRES_<MODULE>=table_a,...      // per-module read flag override
```

Each `dataStore/<module>.js` orchestrator dispatches based on `isDualWrite(tab)` and `isReadFromPostgres(tab, module)` checks. Sheets writes are **unconditional** in every orchestrator; PG writes are conditional on the dual-write flag.

**Structural gap:** there is no flag to stop Sheets writes once a module is cut over. Removing a table from `DUAL_WRITE_TABLES` stops PG writes (a misconfiguration that produces silent PG-stale), not Sheets writes. Sheets retirement requires either inverted semantics or a third `FREEZE_SHEETS_TABLES` flag - neither is built. Not urgent.

---

## The auth boundary (security-critical)

There are **two authentication paths**, and using the wrong one is a security bug.

### User OAuth (per-user identity)

- Login via NextAuth + Google OAuth at `/login`
- Token refresh handled in `src/lib/auth.js` (jwt callback)
- Scopes requested: `openid email profile spreadsheets drive gmail.send`
- Used for: identifying the user, sending email *as* the user (Gmail API), reading data scoped to user permissions
- **Never used for: writes to Sheets/Drive that any authenticated user should be able to perform**

### Service account (app identity)

- Email: `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com`
- Configured via `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` env vars
- Helper: `getServiceAccountSheetsClient()` from `src/lib/sheets.js`
- Used for: all Sheets writes, all Drive uploads, all reads where user permission isn't required

### Why this matters

If you use a user's OAuth token for a Drive upload, the upload succeeds only if that user has Drive permission to the target folder. In a multi-user system that's brittle and inconsistent - invoices a chef uploads might land in a different folder than invoices the director uploads. **Use the service account for all Drive/Sheets writes.** This is one of the most important rules in the codebase.

Functions ending in `SA` (e.g., `readSheetSA`, `appendRowSA`, `updateRangeSA`) use the service account. Functions without that suffix take an `accessToken` and use user OAuth.

---

## Request flow

A typical authenticated request:

```
Browser
  → Next.js middleware (src/middleware.js)
      ├─ /api/auth/* → pass through to NextAuth
      ├─ /api/cron/* → pass through (cron auth handled in route)
      └─ everything else → require session, else redirect to /login
  → API route (src/app/api/{module}/route.js)
      ├─ parse ?action=... (action-dispatch pattern)
      ├─ call lib helpers (src/lib/*.js)
      └─ return NextResponse.json(...)
  → lib helper
      ├─ Sheets read/write via service account or user token
      ├─ Drive upload via service account
      ├─ Gmail send via user token
      ├─ Slack webhook POST
      └─ Anthropic API call (for AI features)
```

---

## Module map

### Page modules (in `src/app/`)

| Path | Purpose |
|---|---|
| `/` (`page.js`) | Home Dashboard |
| `/people` | People Portal - HR command center |
| `/ops` | Ops Hub - operational tools |
| `/directory` | Team Directory |
| `/service-calendar` | Service Calendar |
| `/financial` | Financial views |
| `/login` | Login page |

### API routes (in `src/app/api/`)

| Route | Module served | Action count |
|---|---|---|
| `/api/people` | People Portal | ~24 actions |
| `/api/ops` | Ops Hub (multi-tool) | ~19 actions |
| `/api/ops/inventory` | Inventory Manager | (sub-route) |
| `/api/directory` | Team Directory | ~9 actions |
| `/api/service-calendar` | Service Calendar | (full route) |
| `/api/dashboard` | Home Dashboard data | (full route) |
| `/api/financial` | Financial views | (full route) |
| `/api/cron/daily` | Daily notification cron | 13:00 UTC daily |
| `/api/auth/[...nextauth]` | NextAuth handlers | - |

API routes use the **action-dispatch pattern** (one route file, many action handlers). See `CONVENTIONS.md`.

### Library helpers (in `src/lib/`)

| File | Role |
|---|---|
| `sheets.js` | All Sheets API calls (read/write via service account). The Sheets-side data layer. |
| `supabase.js` | Supabase client + `getServiceClient()`. The PG-side data layer entry point. |
| `cutover.js` | Migration control plane - parses `DUAL_WRITE_TABLES` / `READ_FROM_POSTGRES` flags. Every orchestrator gates on this. |
| `dataStore/` | Per-module orchestrators that dispatch Sheets/PG via flag checks. One file per module: `invoice.js`, `vendor.js`, `directory.js`, `submissions.js`, `inventory.js`, `newsInteractions.js`, `opd.js`, plus `index.js` (re-export hub) and `shared.js` (common helpers). **This is the pattern for new feature work.** |
| `auth.js` | NextAuth config, token refresh logic |
| `drive.js` | Drive uploads (invoice images, stamped PDFs, multi-page invoices) |
| `gmail.js` | Outbound email (invoice notifications, rejections) |
| `analytics.js` | Stub - no-op `logEventSA` only (kept while `auth.js` and `incident-reminders` still import it; full removal pending). |
| `opsUtils.js` | Shared helpers - `parseNum`, `formatCurrency`, `generateId`, `cachedRead`, account/period config, vendor lookup, Slack posting |
| `incidentActions.js` | Incident Center business logic (direct Sheets pattern - module not migrated; rebuild Supabase-native when prioritized) |
| `incidentSchema.js` | Incident column definitions, types, statuses, regional director mapping |
| `inventoryActions.js` | Inventory Manager business logic (writes through `dataStore.inventory`; Smart Inventory currently parked) |
| `invoiceActions.js` | Invoice Capture business logic (writes through `dataStore.invoice`) |
| `peopleReport.js` | Weekly/monthly People Portal email reports |
| `stampInvoice.js` | PDF stamping pipeline (`pdf-lib`) |
| `performanceChain.js`, `wowPlanActions.js`, `performanceAcl.js`, `performanceActions.js` | Leadership Dugout helpers (direct Sheets pattern - module not migrated; defer per close-out §D) |

### Components

Components live in two locations. **This is current state, not necessarily the final rule** - see `CONVENTIONS.md` for guidance:

- `src/components/` - shared and home/directory/people components
- `src/app/ops/components/` - Ops Hub components (organized into `executive/`, `inventory/`, `inventory-manager/`, `invoice/`, `labor/`, `vendors/`, `shared/`)

---

## Background jobs

### Vercel crons (defined in `vercel.json`)

| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/daily` | `0 13 * * *` (daily 13:00) | Daily notification run - celebrations, news, contact updates |
| `/api/cron/incident-reminders` | `0 14 * * *` (daily 14:00) | 7-day reminders for open incidents (regional/AVP escalation) |
| `/api/cron/backup-sheets` | `0 6 * * *` (daily 06:00) | Full backup of HUB, COLLECTION, GL_CODES, AI_LINE_ITEMS, INVENTORY to Drive |

All cron routes require `Authorization: Bearer ${CRON_SECRET}` header. Vercel sends this automatically for configured crons.

### Railway cron (separate repo: `KitchFix-Intranet/kitchfix-inventory-cron`)

Runs nightly. Calls Anthropic Claude in 50-item batches to match invoice line items against the inventory catalog. Writes results back to both stores (Sheets + PG).

**Status:** parked 2026-06-12 alongside Smart Inventory. Cron keeps running (data accumulates as input for the v2 design). Cron's role likely goes away entirely in Smart Inventory v2's queries-over-facts model - no catalog to match against. Decision rides with SI un-parking. See [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md) for the v2 reasoning.

---

## External integrations

| System | Purpose | Auth |
|---|---|---|
| Google Sheets | Database | Service account (writes) + user OAuth (reads) |
| Google Drive | File storage | Service account |
| Gmail | Outbound email | User OAuth (sends as the user) |
| Anthropic Claude API | AI OCR, vendor auto-detect, inventory matching | API key |
| Slack | Operational notifications | Webhook URLs (8 channels) |
| Bill.com | Invoice handoff (via Gmail) | Email-based, no API |

### Slack channels

| Webhook env var | Channel | Triggers |
|---|---|---|
| `SLACK_NEWHIRE_WEBHOOK` | New hire submissions | `/api/people` newhire submit |
| `SLACK_PAF_WEBHOOK` | PAF submissions | `/api/people` paf submit |
| `SLACK_INCIDENT_WEBHOOK` | Incident reports | `/api/people` incident submit |
| `SLACK_INVENTORY_WEBHOOK` | Inventory submissions | `/api/ops/inventory` |
| `SLACK_INVOICE_WEBHOOK` | Invoice submissions | `/api/ops` invoice submit |
| `SLACK_VENDOR_WEBHOOK` | Vendor changes | `/api/ops` vendor add/edit/deactivate |
| `SLACK_HELP_WEBHOOK` | Help requests | Help FAB submissions |
| `SLACK_RECAP_WEBHOOK` | Periodic recaps | Cron-driven summaries |

---

## Permission tiers (summary - see `DESIGN_SYSTEM_REFERENCE.md` for full breakdown)

| Tier | Members | Gates |
|---|---|---|
| Authenticated User | Any `@kitchfix.com` Google account | Default - submit forms, see own history |
| Module Admin (Ops Leadership) | 7 emails in `OPS_LEADERSHIP_EMAILS` | Ops admin tabs, Vendor/Labor/Invoice admin |
| Service Calendar Admin | k.fietek, joe | Service config |
| People Portal Admin | Sheet-driven (`admins` tab) | PAF approvals, HR-flagged views |
| Service Account | App identity, not a person | All Sheets/Drive writes |

---

## What's NOT in this architecture

These exist in conversations or specs but are not in the running system:

- **KPI Dashboard** - built prematurely, removed from active architecture. Don't include in data flow diagrams.
- **Pre-Service Briefing Tool, Culinary Management Platform, Stage 2 Inventory** - specs exist, not built.
- **Tests** - there are no automated tests. Validation is manual.
- **Staging environment** - there isn't one. `main` branch = production.