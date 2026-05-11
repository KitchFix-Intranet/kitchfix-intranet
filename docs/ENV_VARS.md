# Environment Variables — KitchFix Ops Hub

> **Purpose:** Canonical list of every environment variable used by this system. Where it's set, what it's for, what breaks if it's missing.
>
> **Last verified:** 2026-05-11
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

### Sheets

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `INVENTORY_SHEET_ID` | Sheet ID for inventory module (8-tab schema) | Prod, Preview | Inventory module fails |
| `ANALYTICS_SHEET_ID` | Sheet ID for analytics events | Prod, Preview | Analytics writes fail (currently failing in prod due to 10M cell limit) |

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

- **2026-05-11** — Initial env var inventory captured during Phase 0. List built from `grep` of source files; values to be confirmed against Vercel dashboard as Phase 1 sanity check.
