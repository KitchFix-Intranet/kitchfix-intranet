# Environment Variables - KitchFix Ops Hub

> **Purpose:** Canonical list of every environment variable used by this system. Where it's set, what it's for, what breaks if it's missing.
>
> **Last verified:** 2026-06-03
> **Rule:** Adding an env var requires updating this doc in the same commit.

---

## Where env vars live

| Location | Purpose |
|---|---|
| `.env.local` (machine, gitignored) | Local development |
| Vercel → Settings → Environments → Production | Production deploys |
| Vercel → Settings → Environments → Preview | Preview deploys for feature branches |
| Vercel → Settings → Environments → Development | Vercel CLI's `vercel dev` (rarely used) |

**Rule of thumb:** Most variables should be scoped to **Production AND Preview**. Production-only scope is the common cause of "preview deploys are broken" issues.

---

## Required env vars

### Authentication (NextAuth + Google OAuth)

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `NEXTAUTH_URL` | Public URL of the deployment | Prod, Preview | Auth callback fails |
| `NEXTAUTH_SECRET` | NextAuth session encryption key | Prod, Preview | All sessions invalid |
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud | Prod, Preview | Sign-in fails |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret from Google Cloud | Prod, Preview | Sign-in fails |

### Service account (Sheets/Drive writes)

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com` | Prod, Preview | All writes fail |
| `GOOGLE_PRIVATE_KEY` | Service account private key (PEM, newlines as `\n`) | Prod, Preview | All writes fail |

### Anthropic

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | API key for Claude Vision and AI features | Prod, Preview | Invoice OCR and inventory matching fail |

### Drive folders

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `GOOGLE_INVOICE_DRIVE_FOLDER_ID` | Root Drive folder ID for invoice uploads | Prod, Preview | Invoice uploads fail |
| `INCIDENTS_DRIVE_ROOT_ID` | Root Drive folder ID for incident attachments | Prod, Preview | Incident attachments fail |
| `BACKUP_FOLDER_ID` | Drive folder ID where the daily sheet backup cron writes dated copies (`/api/cron/backup-sheets`). | Prod, Preview | Backup cron returns 500 - no backups land |

### Sheets

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `INVENTORY_SHEET_ID` | Sheet ID for inventory module (8-tab schema) | Prod, Preview | Inventory module fails |

### Postgres cutover

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `DUAL_WRITE_TABLES` | Comma-separated list of PG tables that receive dual writes alongside Sheets. Per-table check via `isDualWrite(tab)` in `src/lib/cutover.js`. A tab absent here silently writes Sheets-only. | Prod, Preview, **`.env.local`** | Dual-write no-ops for the omitted tabs; PG falls out of sync with Sheets |
| `READ_FROM_POSTGRES` | Base list of tables whose READ path serves from PG instead of Sheets. | Prod, Preview, **`.env.local`** | Reads continue from Sheets |
| `READ_FROM_POSTGRES_OPS` | Per-surface override for the ops site. Composed with the base list at dispatch time via `isReadFromPostgres(tab, "ops")`. | Prod, Preview, **`.env.local`** | Ops reads continue from Sheets even if base list includes the tab |
| `READ_FROM_POSTGRES_DASHBOARD` | Per-surface override for the dashboard. | Prod, Preview, **`.env.local`** | Dashboard reads continue from Sheets |
| `READ_FROM_POSTGRES_PEOPLE` | Per-surface override for People Portal. | Prod, Preview, **`.env.local`** | People Portal reads continue from Sheets |
| `READ_FROM_POSTGRES_DIRECTORY` | Per-surface override for the directory. | Prod, Preview, **`.env.local`** | Directory reads continue from Sheets |

**Local mirroring rule:** `.env.local` must mirror Vercel's values for ALL of the above. A blank or stale local value silently makes local writes Sheets-only and diverges local reads from production. This caused Stage 1 of the STL-MO line-item backfill to write Sheets-only on 2026-06-03 (local `DUAL_WRITE_TABLES` lacked `ai_line_items` while Vercel had it; not caught until a post-stage verification query showed 0 PG rows). Pull values from Vercel rather than hand-maintaining; do not let them drift.

### Email

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `INVOICE_AP_EMAIL` | Where stamped invoices are sent (currently `k.fietek@kitchfix.com`, future `ap@kitchfix.com`) | Prod, Preview | Invoice email fails |
| `INCIDENT_CALENDAR_ORGANIZER` | Calendar organizer for incident events (default `m.chavez@kitchfix.com`) | Prod, Preview | Calendar events create with wrong organizer |

### Slack webhooks

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `SLACK_NEWHIRE_WEBHOOK` | New hire submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_PAF_WEBHOOK` | PAF submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_INCIDENT_WEBHOOK` | Incident reports channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_INVENTORY_WEBHOOK` | Inventory submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_INVOICE_WEBHOOK` | Invoice submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_VENDOR_WEBHOOK` | Vendor changes channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_HELP_WEBHOOK` | Help FAB submissions channel | Prod, Preview | Help submissions silently skipped |
| `SLACK_RECAP_WEBHOOK` | Periodic recap cron channel | Prod, Preview | Recap cron silently skipped |

### Crons

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `CRON_SECRET` | Shared secret for Vercel cron auth | Prod, Preview | All crons return 401 |

### Testing / feature flags

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `INCIDENT_TEST_MODE` | When `"true"`, incidents skip live side-effects (Slack/email/calendar) | Prod, Preview | Defaults to false (live mode) |
| `TEST_MODE` | **Reserved - not implemented yet.** When `"true"`, will route Sheet writes to test clones instead of prod sheets so the Playwright suite can exercise write paths. See `docs/TESTING.md → TEST_MODE plumbing`. | Not set anywhere yet | n/a - feature not built |
| `TEST_COLLECTION_SHEET_ID` | **Reserved - inactive.** Test clone of the COLLECTION sheet (`1OcccMHY-TSvv30drmL0RdqaMz36GjoQgmpCp6vIaZYE`, created 2026-05-12, shared with the `kitchfix-sheets` service account). Unused until `TEST_MODE` plumbing lands. | Not set anywhere yet | n/a - feature not built |
| `TEST_HUB_SHEET_ID` | **Reserved.** Will point to a test clone of the HUB sheet - **clone not yet created.** Needed before any Vendor Portal write test (Vendor writes go to HUB, not COLLECTION). | Not set anywhere yet | n/a - feature not built |

---

## Adding a new env var

1. Add to Vercel Production environment
2. Add to Vercel Preview environment
3. Add to local `.env.local`
4. Add a row to this doc with description and "if missing" behavior
5. Commit the doc update with the code change that uses the new var

## Rotating a secret

See `docs/RUNBOOK.md → How to rotate a secret`.

## Captain's log

- **2026-05-11** - Initial env var inventory captured during Phase 0. List built from `grep` of source files; values to be confirmed against Vercel dashboard as Phase 1 sanity check.
- **2026-05-12** - Added `ANALYTICS_ENABLED` (Phase 1 Task 12). Master kill-switch for analytics sheet writes; default off. Set to `false` on Vercel Production + Preview + Development. See `docs/MIGRATION.md → Captain's log`.
- **2026-05-12** - Reserved `TEST_MODE`, `TEST_COLLECTION_SHEET_ID`, `TEST_HUB_SHEET_ID` for the Playwright write-test plumbing (deferred from Phase 1 Task 1 Round 1). None are set yet; documented now so the names are claimed. See `docs/TESTING.md`.
- **2026-05-15** - Removed `ANALYTICS_SHEET_ID` and `ANALYTICS_ENABLED` (PR 3/3 of the analytics teardown, PR #34). Both env vars must also be removed from Vercel Production + Preview + Development. `SLACK_RECAP_WEBHOOK` stays - still used by `/api/cron/backup-sheets/route.js:54`. See `docs/MIGRATION.md → Phase 3 commentary` for the new analytics-via-Sentry/Vercel/Supabase plan.
