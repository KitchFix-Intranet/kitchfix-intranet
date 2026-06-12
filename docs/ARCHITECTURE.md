# Architecture - KitchFix Ops Hub

> ⚠️ **STATUS: portions of this document may be out of date.** Last verified 2026-05-05; multiple module cutovers and the Module 6 invoice-capture-to-PG fix landed since. [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) is the canonical source of truth for current per-module migration state. Architectural patterns (five-pillar Sheets model, auth boundary, dual-write orchestrator pattern) are still broadly accurate; specific table-by-table claims may have drifted. Verify against `MIGRATION_STATUS.md` before relying on a module-specific detail. Full reconciliation is a tracked do-later item.

> **Purpose:** The 30,000-ft view of how this system is wired. Read this before touching anything new.
>
> **Last verified:** 2026-05-05
> **Verified against:** `src/lib/sheets.js`, `src/lib/auth.js`, `src/middleware.js`, `vercel.json`, `package.json`

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Auth | NextAuth v5 + Google OAuth |
| Database | Google Sheets (five spreadsheets - see below) |
| File storage | Google Drive |
| Email | Gmail API |
| AI | Anthropic Claude API (Invoice OCR, vendor auto-detect, inventory matching) |
| Hosting | Vercel Pro |
| Background jobs | Vercel cron (4 jobs) + Railway cron (1 job, inventory matching) |
| Notifications | Slack webhooks (8 channels) |
| PDF generation | `pdf-lib` (invoice stamping), WeasyPrint (Pre-Service Materials, separate pipeline) |
| Styling | Vanilla CSS with module-prefixed classes; Tailwind v4 imported as utility backstop |

---

## The data layer: Five-Pillar Sheet Architecture

The system uses **five Google Sheets**, each with a defined role. The header comment in `src/lib/sheets.js` calls this "Three-Pillar Architecture" but lists five - the comment is out of date. The five pillars are the real model.

| Pillar | Constant | Role | Access pattern |
|---|---|---|---|
| 1. Master Hub | `SHEET_IDS.HUB` | Source of truth - config, accounts, periods, contacts, admins, hero images, notifications, library manifests | Read-only from app |
| 2. Data Collection | `SHEET_IDS.COLLECTION` | Transaction logs - submissions, drafts, notification log, incidents | Write-heavy |
| 3. Game Engine | `SHEET_IDS.GAME` | Gamification logic | Write |
| 4. GL Codes | `SHEET_IDS.GL_CODES` | Chart of accounts for invoice coding | Read-only |
| 5. AI Line Items | `SHEET_IDS.AI_LINE_ITEMS` | Invoice line items extracted by Claude OCR | Write |
| (separate) | `SHEET_IDS.INVENTORY` | Inventory schema (8-tab) - items, locations, counts, vendor mapping | Read/write, env-configured |

When designing a new feature, decide which pillar(s) it touches before writing code. A feature that mixes config (Pillar 1) and transactions (Pillar 2) is normal. A feature that writes to Pillar 1 from the app is wrong - Pillar 1 is configured in Sheets directly.

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
| `sheets.js` | All Sheets API calls (read/write, both auth paths). The data layer. |
| `auth.js` | NextAuth config, token refresh logic |
| `drive.js` | Drive uploads (invoice images, stamped PDFs, multi-page invoices) |
| `gmail.js` | Outbound email (invoice notifications, rejections) |
| `analytics.js` | Stub - no-op `logEventSA` only (kept while `auth.js` and `incident-reminders` still import it; full removal pending). See PR #34. |
| `opsUtils.js` | Shared helpers - `parseNum`, `formatCurrency`, `generateId`, `cachedRead`, account/period config, vendor lookup, Slack posting |
| `incidentActions.js` | Incident Center business logic - ID generation, Drive folders, escalation |
| `incidentSchema.js` | Incident column definitions, types, statuses, regional director mapping |
| `inventoryActions.js` | Inventory Manager business logic |
| `invoiceActions.js` | Invoice Capture business logic |
| `peopleReport.js` | Weekly/monthly People Portal email reports |
| `stampInvoice.js` | PDF stamping pipeline (`pdf-lib`) |

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

Runs nightly. Calls Anthropic Claude in 50-item batches to AI-match invoice line items against the inventory catalog. Writes results back to the inventory sheet.

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