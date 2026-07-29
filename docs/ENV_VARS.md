# Environment Variables - KitchFix Ops Hub

> **Purpose:** Canonical list of every environment variable used by this system. Where it's set, what it's for, what breaks if it's missing.
>
> **Last verified:** 2026-07-29 - full `process.env` sweep across `src/` + `scripts/`, not just a re-read.
> **Rule:** Adding an env var requires updating this doc in the same commit.

---

## Verify this doc in one command

The rule above has been broken repeatedly. Do not trust the "Last verified" date on its own - re-derive the inventory and diff before you trust the doc. Copy-paste:

```
diff \
  <(grep -RhoE 'process\.env\.[A-Z_][A-Z0-9_]+' src scripts | sed 's/process\.env\.//' | sort -u) \
  <(grep -oE '`[A-Z_][A-Z0-9_]+`' docs/ENV_VARS.md | tr -d '\`' | sort -u)
```

Lines prefixed `<` are `process.env.*` names read by code but not documented here. Lines prefixed `>` are backticked names in this doc that no static reference reads (this includes retired vars deliberately kept in the changelog + Next-auth v5 renames + dynamically composed families like `READ_FROM_POSTGRES_<MODULE>` that the sweep cannot see).

This is a discipline aid, not a CI check. Do not automate it.

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
| `NEXTAUTH_URL` | Public URL of the deployment (Next-auth v4 name; v5 reads `AUTH_URL` first, falls back to this) | Prod, Preview | Auth callback fails |
| `NEXTAUTH_SECRET` | NextAuth session encryption key (Next-auth v4 name; v5 reads `AUTH_SECRET` first, falls back to this) | Prod, Preview | All sessions invalid |
| `AUTH_URL` | Public URL of the deployment used to build absolute callback links for cron-generated emails. Consumed by `src/app/api/people/route.js:135,335,1361` and `src/app/api/cron/incident-reminders/route.js:107` via `process.env.AUTH_URL \|\| "<fallback>"`. Same value as `NEXTAUTH_URL`. | Prod, Preview | Email links fall back to `http://localhost:3000` (broken in prod emails) or the incident-reminders hardcoded fallback |
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
| `ANTHROPIC_API_KEY_SOUS` | Sous-scoped API key for the SousAI agent (Sonnet 4.6). Separate from `ANTHROPIC_API_KEY` so Sous spend can be metered + rotated independently. Read at `src/lib/sousai/agent.js:263`. | Prod, Preview | `runSousAgent` throws `"ANTHROPIC_API_KEY_SOUS missing from environment"` at the top of `handleAsk`; the SSE stream emits an `error` event with `kind: "unknown"` and the request rolls into an `error` row in `sousai_questions` |

### Supabase

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `SUPABASE_URL` | Supabase project URL. Server-side, service-role client only. Read at `src/lib/supabase.js:42` and every SousAI + script path that instantiates a service-role client. | Prod, Preview, **`.env.local`** | Every PG read/write throws at the `getServiceClient` factory - Playbook, Sous, reports, cron backfills, embed pipeline, migration probes ALL fail |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key. Grants full PG access; server-side only, never exposed to the browser. Read at `src/lib/supabase.js:43` alongside `SUPABASE_URL`. | Prod, Preview, **`.env.local`** | Same failure surface as `SUPABASE_URL`: every service-role query throws |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase URL string. Used only by scripts as a URL fallback (`process.env.SUPABASE_URL \|\| process.env.NEXT_PUBLIC_SUPABASE_URL`) - see `scripts/backfill-stl-mo-line-items.mjs:111` and multiple `scripts/_probe_*.mjs` files. NOT used by any Next.js client component today. | Prod, Preview, **`.env.local`** | Scripts that only carry `NEXT_PUBLIC_SUPABASE_URL` (no `SUPABASE_URL`) fail to boot; production app is unaffected as long as `SUPABASE_URL` is set |

### OpenAI

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `OPENAI_API_KEY` | Embeddings API key (`text-embedding-3-small`, dim 1536) for the SousAI chunk corpus + query-time retrieval. Read at `src/lib/sousai/embed.js:45`. | Prod, Preview, **`.env.local`** for embed scripts | 401 from OpenAI mapped to a defensive throw: embed scripts fail loudly; live `searchDocuments` calls throw and get wrapped as `{kind:"unknown"}` errors on the SSE stream |

### SousAI surface flags + reports

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `SOUSAI_ROUTE_ENABLED` | Kill switch for `/api/sousai` and `/sous`. Only `"true"` (string) opens the door. Read at `src/app/api/sousai/route.js:143` (gate order: flag -> auth -> tier -> input) and `src/app/sous/page.js:74` (page notFound). | Prod, Preview | Route returns 404-shaped `{error:"not found"}` on `POST /api/sousai`; `/sous` page calls `notFound()`. Nothing leaks that the endpoint exists |
| `SOUSAI_REPORTS_VIEWERS` | Comma-separated email allowlist for `/sousai/reports` + `/api/sousai/chips` + the profile-dropdown "Sous Reports" nav link. Read at `src/lib/opdAcl.js:71` via `parseSousReportsViewers(...)`; case-insensitive, per-item trimmed, empty items dropped. | Prod, Preview | **Fail-closed hardcoded default:** collapses to `SOUS_REPORTS_DEFAULT_VIEWERS = ["k.fietek@kitchfix.com"]` at `src/lib/opdAcl.js:76`. A missing env var never widens access |
| `SOUSAI_REPORT_RECIPIENTS` | Comma-separated recipient list for the weekly + monthly digest email crons. Read at `src/lib/sousai/reports/emailShared.js:22` via `resolveRecipients()`; case-insensitive, per-item trimmed, empty items dropped. | Prod, Preview | **Fail-closed hardcoded default:** falls back to `DEFAULT_RECIPIENTS = ["k.fietek@kitchfix.com"]` at `src/lib/sousai/reports/emailShared.js:22-29`. Digests still ship, just narrower audience |
| `SOUSAI_REPORT_SENDER` | Sender identity for the weekly + monthly digest emails. Read at `src/lib/sousai/reports/emailShared.js:33` via `senderIdentity()`. | Prod, Preview | Falls back to the module `DEFAULT_SENDER`; digest still ships |
| `SLACK_SOUSAI_WEBHOOK_URL` | Incoming-webhook URL for the daily SousAI Slack digest cron (`/api/cron/sousai-daily`). Read at `src/app/api/cron/sousai-daily/route.js:41`. | Prod, Preview | Daily digest logs a "webhook missing" line and returns 200 with `sent: 0`; doesn't take the cron surface down |

### Directory

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `DIRECTORY_ADMIN_EMAILS` | Comma-separated allowlist that gates every `admin-*` action on `/api/directory`. Case-insensitive per-item trim. Read at `src/app/api/directory/route.js:288`. | Prod, Preview | Fail-closed: the allowlist is empty, so nobody passes the check and every admin action returns 403 |

### OPD editor (GitHub-backed authoring)

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `GITHUB_OPD_TOKEN` | Fine-scoped GitHub token used by the OPD authoring surface for MDX-source fetch, branch + PR creation, and auto-merge. Read at `src/app/api/playbook/route.js:414, 514, 899`. Requires repo contents + PR write scopes on `KitchFix-Intranet/kitchfix-intranet`. | Prod, Preview | `?action=mdx-source` returns 500 / auth error; `?action=pending-edits` returns empty; `?action=commit-mdx` fails to create the branch or merge |

### Instrumentation + public URLs

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for the client-side instrumentation. Read at `src/instrumentation-client.js:9`. | Prod, Preview | Sentry init runs with `dsn: undefined` - client events silently drop |
| `NEXT_PUBLIC_BASE_URL` | Public deploy URL used to build absolute links into digest emails / Slack messages. Read at the three `src/app/api/cron/sousai-*/route.js` files, each with `\|\| ""` fallback. | Prod, Preview | Digest links render as relative paths (broken in email inbox / Slack); crons still deliver text |

### Performance module (WoW plan + PDF render)

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `PERFORMANCE_CALENDAR_ID` | Google Calendar ID for the Performance module's Day-30/60/90 invites. Read at `src/lib/wowPlanActions.js:293`, fallback `"primary"`. | Prod, Preview | Falls back to the service account's primary calendar |
| `PERFORMANCE_RENDER_SECRET` | Shared secret sent to the Railway WeasyPrint renderer for PDF generation. Read at `src/lib/performancePdf.js:9`. | Prod, Preview | `callRender()` logs `"WEASYPRINT_SERVICE_URL or PERFORMANCE_RENDER_SECRET not set; skipping"` and returns `{ok:false, reason:"not-configured"}` - PDF is never produced |
| `WEASYPRINT_SERVICE_URL` | Base URL for the Railway-hosted WeasyPrint renderer. Read at `src/lib/performancePdf.js:8`. | Prod, Preview | Same as `PERFORMANCE_RENDER_SECRET` - render is skipped, no PDF |

### Drive folders

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `GOOGLE_INVOICE_DRIVE_FOLDER_ID` | Root Drive folder ID for invoice uploads | Prod, Preview | Invoice uploads fail |
| `INCIDENTS_DRIVE_ROOT_ID` | Root Drive folder ID for incident attachments | Prod, Preview | Incident attachments fail |
| `BACKUP_FOLDER_ID` | Drive folder ID where the daily sheet backup cron writes dated copies (`/api/cron/backup-sheets`). | Prod, Preview | Backup cron returns 500 - no backups land |
| `NEWS_IMAGES_FOLDER_ID` | Drive folder ID for News module hero images. Read at `src/lib/drive.js:153`, consumed by the News image list/upload path. | Prod, Preview | News image list/upload returns empty; News editor cannot attach images |

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
| `PEOPLE_OPS_FROM_EMAIL` | Sender address for People-Ops outbound email (WoW plan cadence + incident-reminders cron). Read at `src/app/api/cron/incident-reminders/route.js:139` and `src/lib/wowPlanActions.js`, with fallback `"support@kitchfix.com"`. | Prod, Preview | Emails send from the `support@kitchfix.com` fallback (still deliverable; wrong reply-to for People Ops) |

### Slack webhooks

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `SLACK_NEWHIRE_WEBHOOK` | New hire submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_PAF_WEBHOOK` | PAF submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_INCIDENT_WEBHOOK` | Incident reports channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_INVENTORY_WEBHOOK` | Inventory submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_INVOICE_WEBHOOK` | Invoice submissions channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_VENDOR_WEBHOOK` | Vendor changes channel | Prod, Preview | Slack notifications silently skipped |
| `SLACK_HELP_WEBHOOK` | Help FAB submissions channel. Also used as the fallback for OPD report-issue when `SLACK_OPD_WEBHOOK` is not set (`src/app/api/playbook/route.js:667`). | Prod, Preview | Help submissions silently skipped; OPD report-issue Slack ping silently skipped |
| `SLACK_RECAP_WEBHOOK` | Periodic recap cron channel | Prod, Preview | Recap cron silently skipped |
| `SLACK_OPD_WEBHOOK` | OPD (Playbook) report-issue channel. Read at `src/app/api/playbook/route.js:667`; falls back to `SLACK_HELP_WEBHOOK` when not set. | Prod, Preview | Report-issue Slack ping goes to `SLACK_HELP_WEBHOOK` instead |
| `SLACK_SC_WEBHOOK_URL` | Service Calendar operational alerts channel (schedule-drift cron + price-change smoke). Read at `src/app/api/cron/schedule-drift/route.js:101` and `scripts/price-change-report.mjs:81`. | Prod, Preview | Schedule-drift Slack pings silently skipped; price-change report warns and skips Slack |
| `SLACK_PERFORMANCE_WEBHOOK` | Performance module (WoW plan) notifications channel. Read at `src/lib/performanceActions.js:46`. | Prod, Preview | Performance-module Slack pings silently skipped |

### Crons

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `CRON_SECRET` | Shared secret for Vercel cron auth | Prod, Preview | All crons return 401 |

### Testing / feature flags

| Variable | Description | Scope | If missing |
|---|---|---|---|
| `INCIDENT_TEST_MODE` | When `"true"`, incidents skip live side-effects (Slack/email/calendar) | Prod, Preview | Defaults to false (live mode) |
| `TEST_MODE` | **LIVE (Playwright middleware bypass).** When `"true"` AND `VERCEL !== "1"`, `src/middleware.js` returns `NextResponse.next()` at the top of the chain, letting Playwright drive authed surfaces without OAuth. Double-gated on `VERCEL !== "1"` so a stray production export cannot open the app. Used by the CI `matrix` job (in-runner build) via inline env; not set on Vercel. See [`docs/TESTING.md`](TESTING.md) "TEST_MODE bypass". | CI runner + local dev only; NEVER Vercel | Middleware auth runs normally; Playwright cannot reach authed routes |
| `TEST_COLLECTION_SHEET_ID` | **Reserved - inactive.** Test clone of the COLLECTION sheet (`1OcccMHY-TSvv30drmL0RdqaMz36GjoQgmpCp6vIaZYE`, created 2026-05-12, shared with the `kitchfix-sheets` service account). Not used by the sc-nav-matrix spec (all data routes stubbed via `page.route`); would re-activate if a future spec needs a real Sheets write target. | Not set anywhere yet | n/a - feature not currently used |
| `TEST_HUB_SHEET_ID` | **Reserved.** Will point to a test clone of the HUB sheet - **clone not yet created.** Not needed for the current sc-nav-matrix spec; would matter for a future Vendor Portal write test (HUB, not COLLECTION). | Not set anywhere yet | n/a - feature not currently used |

---

## Platform-injected (not settable by us)

These variables are provided by the runtime. Do NOT add them to Vercel Production/Preview or to `.env.local` - the platform sets them and setting a value yourself either does nothing or breaks the runtime's own logic.

| Variable | Provided by | Read at |
|---|---|---|
| `NODE_ENV` | Node.js runtime | `src/instrumentation-client.js:13, 16` (Sentry gate + tag) |
| `VERCEL` | Vercel runtime (`"1"` when running on Vercel infra) | `src/middleware.js:16` (`TEST_MODE` double-gate) |
| `NEXT_RUNTIME` | Next.js runtime (`"nodejs"` or `"edge"`) | `src/instrumentation.js:4, 8` (runtime-specific Sentry init) |

## CI-injected (GitHub Actions runs only)

Provided by GitHub Actions inside a workflow run. These have no meaning outside CI and must not be set anywhere else.

| Variable | Read at |
|---|---|
| `GITHUB_REPOSITORY` | `scripts/price-change-report.mjs:221-222` (composes the run URL for the Slack footer) |
| `GITHUB_RUN_ID` | `scripts/price-change-report.mjs:221-222` (same) |
| `GITHUB_SERVER_URL` | `scripts/price-change-report.mjs:221-222` (same) |

## Script / operator-only (not required for the app to run)

These do not need to be set on Vercel or in `.env.local`. They exist for CLI scripts or one-off maintenance flows and are consumed only when the operator runs the tool by hand.

| Variable | Description | Consumer | If missing |
|---|---|---|---|
| `ALLOWED_LEVELS` | Comma-separated tier filter for the SousAI retrieval smoke test. Read at `scripts/sousai-retrieval-test.mjs:39` with `?? "unrestricted"`. | Retrieval smoke test only | Defaults to `"unrestricted"` (single-tier probe); results still print |
| `SOUSAI_DOC_ID` | Doc id selector for the single-doc embed script. Read at `scripts/sousai-embed-doc.mjs:37`; resolution order is `argv[2] > env > "PB-002"` default. | Single-doc embed | Script embeds `PB-002` by default |
| `SC_HOMESTAND_SEED_ALLOW` | **Destructive-seed guard.** `_seed_sc_homestand_schedule.mjs` refuses to run unless this equals `"1"`. Read at `scripts/_seed_sc_homestand_schedule.mjs:35`. | SC homestand seed | Script exits early with a "guard tripped" message - the seed refuses to touch data |
| `SC_LABOR_BUDGETS_SEED_FORCE` | **Destructive-seed guard.** `_seed_sc_labor_budgets.mjs` treats `"1"` as the go-ahead. Read at `scripts/_seed_sc_labor_budgets.mjs:53`. | SC labor budgets seed | Script refuses the force path; falls back to safe-mode behavior |
| `SHEET_HUB` | HUB sheet id override for the reconciliation-alarm + inventory-canonicalize scripts. Read at `scripts/reconciliation-alarm.mjs:81` with a hardcoded HUB id fallback. | Reconciliation alarm | Falls back to the production HUB id literal in the script |
| `SHEET_COLLECTION` | COLLECTION sheet id override. Read at `scripts/reconciliation-alarm.mjs:82`. | Reconciliation alarm | Falls back to the production COLLECTION id literal |
| `SHEET_GL_CODES` | GL codes sheet id override. Read at `scripts/reconciliation-alarm.mjs:83`. | Reconciliation alarm | Falls back to the production GL codes id literal |
| `SHEET_AI_LINE_ITEMS` | AI line items sheet id override. Read at `scripts/reconciliation-alarm.mjs:84`. | Reconciliation alarm | Falls back to the production ai_line_items id literal |
| `SHEET_INVENTORY` | Inventory sheet id override. Read at `scripts/reconciliation-alarm.mjs:85` and `scripts/canonicalize-inventory-accounts.mjs:80`. Note: the doc row `INVENTORY_SHEET_ID` (Sheets section above) documents the OLD env var name that these scripts no longer read - see the Captain's log entry for 2026-07-29. | Reconciliation alarm + canonicalize-inventory-accounts | Falls back to the production inventory id literal for reconciliation-alarm; canonicalize-inventory-accounts requires it (no fallback) |

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
- **2026-07-12** - `TEST_MODE` promoted from "Reserved" to "LIVE (Playwright middleware bypass)" - `src/middleware.js` now short-circuits when `TEST_MODE === "true" && VERCEL !== "1"`, landed in PR #407 as the Playwright reach mechanism for the nav-matrix spec. Double-gate on `VERCEL !== "1"` prevents a stray production export from opening the app. Value is set inline in `.github/workflows/e2e.yml` (job A step "Start production server with TEST_MODE bypass") - NOT on Vercel. `TEST_COLLECTION_SHEET_ID` + `TEST_HUB_SHEET_ID` remain reserved (no current consumer; the sc-nav-matrix spec stubs data routes via `page.route`). Last-verified header bumped implicitly.
- **2026-07-29** - Sync sweep. Full `process.env` grep across `src/` + `scripts/` measured **61 distinct references**; the doc carried **34 documented** with **38 undocumented** and **11 documented-not-in-code** (details below). Undocumented set added in the appropriate existing section, or in one of four new sections: **Supabase** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` - the doc claimed to be canonical without documenting the database it lives on), **OpenAI** + **SousAI surface flags + reports** + **Directory** + **OPD editor** + **Instrumentation + public URLs** + **Performance module** (23 vars total, one full table row each with `[code-read]` cites), **Platform-injected** (`NODE_ENV`, `VERCEL`, `NEXT_RUNTIME` - grouped; must not be added to Vercel or `.env.local`), **CI-injected** (`GITHUB_REPOSITORY/RUN_ID/SERVER_URL` - grouped; exist only inside Actions runs), and **Script / operator-only** (9 vars - CLI-only, not required to boot the app). The `.env.local`-required Supabase group is called out inline. `AUTH_URL` (Next-auth v5 rename of `NEXTAUTH_URL`) added to the Authentication section with a note that Next-auth v5 reads the new name first and falls back to the legacy one. Documented-not-in-code residue kept as-is with reasons: `NEXTAUTH_URL/SECRET` are the fallback aliases Next-auth v5 accepts (still consumed via NextAuth internals, not via literal `process.env` reads in `src/lib/auth.js`); `READ_FROM_POSTGRES_{DASHBOARD,DIRECTORY,OPS,PEOPLE}` are the dynamically-composed per-module family that `src/lib/cutover.js:126` discovers generically via `READ_FROM_POSTGRES_*` (a static-grep sweep cannot see them); `INVENTORY_SHEET_ID` is a legacy row that predates the `SHEET_INVENTORY` rename in the reconciliation scripts - retained in Sheets section for now, cross-referenced from the `SHEET_INVENTORY` row in the script-only section; `TEST_COLLECTION_SHEET_ID` + `TEST_HUB_SHEET_ID` remain reserved (no current consumer, deliberate); `ANALYTICS_ENABLED` + `ANALYTICS_SHEET_ID` were removed 2026-05-15 and appear only in changelog entries, not as vars-table rows. Also added a **Verify this doc in one command** block up top so the next person can re-run the sweep rather than trust the "Last verified" date. That block is a discipline aid, not automation - the sweep never becomes a CI check or a pre-commit hook.
