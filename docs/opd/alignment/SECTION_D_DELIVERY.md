# Section D: Delivery

## D14: Email send capability

**Verdict: We already send transactional email today, at scale, via the Gmail API using Google service-account domain-wide delegation. Slack webhooks are NOT the only outbound channel.** No third-party ESP (SendGrid, Resend, Postmark, Nodemailer, Mailgun, SMTP) is installed or configured; email flows exclusively through the Gmail API.

Two Gmail send paths exist:

1. **Service-account impersonated Gmail (system email)** - `sendEmailSA({ sender, displayName, to, subject, html, replyTo })` at `src/lib/gmail.js:411-449` [code-read]. It uses `google.auth.JWT` with `scopes: ["https://www.googleapis.com/auth/gmail.send"]` and `subject: <impersonated mailbox>`. The service account is on the Workspace admin's domain-wide-delegation allowlist for `gmail.send`. Comments and callers confirm the impersonated mailbox has been proven in production (see `src/lib/billing/qboNotifications.js:48` "has proven Gmail SA domain-wide-delegation") [code-read].

2. **User-OAuth Gmail (invoice submitter sends as themselves)** - `sendInvoiceEmail(accessToken, senderEmail, data, ...)` at `src/lib/gmail.js:43-112` and `sendRejectionEmail` at `src/lib/gmail.js:300-355`. Uses the signed-in user's Gmail OAuth token from NextAuth [code-read].

**NextAuth scopes** (`src/lib/auth.js:11-19`) [verified]:
```
openid email profile
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/gmail.send
```
The user-OAuth path already has `gmail.send`. (Full `drive` scope is over-broad - `CLAUDE.md` standing findings #1 flags this.)

**Verdict on an `academy@kitchfix.com` alias:** SUPPORTED with one operational prerequisite. The `sendEmailSA` pattern takes `sender` as a parameter [code-read at `src/lib/gmail.js:411, 417`], so any mailbox is a caller-choice, not hardcoded. Prod already sends as `support@kitchfix.com` (`src/app/api/people/route.js:75` `GMAIL_SENDER = "support@kitchfix.com"`) and impersonates `m.chavez@kitchfix.com` for incident calendar events. **Prerequisite:** the `academy@` mailbox (or alias) must be on the SA's domain-wide-delegation allowlist for the `gmail.send` scope in the Google Workspace admin console. This is a Kevin-side Workspace config task, not code work. Env var scaffolding (`PEOPLE_OPS_FROM_EMAIL`, `INVOICE_AP_EMAIL`, `INCIDENT_CALENDAR_ORGANIZER`) already exists per `.env.example` [verified], so the same pattern would apply for an `ACADEMY_FROM_EMAIL` var.

**Bounce detection: NONE exists.** Grep for `bounce`, `webhookForAddress`, `history.list`, `delivery.*status` returned zero matches in email-related code [verified]. The only Gmail-read code (`src/lib/gmailReadReport.js`) is read-only and scoped to Rippling scheduled-report ingestion; it never inspects DSNs. `sendEmailSA` catches errors and returns `"sent"|"failed"` synchronously; a downstream 550 bounce is invisible to the app [code-read at `src/lib/gmail.js:445-449`]. If Academy needs bounce detection, that's net-new code (either Gmail `history.list` polling of the sender inbox for DSN patterns, or a dedicated bounce webhook via a real ESP).

Callers of `sendEmailSA` today [verified]: `src/app/api/people/route.js` (new-hire, PAF, status), `src/app/api/cron/daily/route.js`, `src/app/api/cron/incident-reminders/route.js`, `src/app/api/cron/sousai-monthly/route.js`, `src/app/api/cron/sousai-weekly/route.js`, `src/lib/incidentActions.js`.

## D15: Token / magic-link primitives

**Verdict: no signed-URL, no magic-link, no OTP primitive exists in the repo. Nothing to build on. This is a net-new component.**

What was searched and NOT found [verified via grep]:
- No `jsonwebtoken`, no `jose`, no `nanoid` in `package.json` dependencies.
- No `crypto.randomBytes` anywhere in `src/`.
- No `createHmac` used for signing (only `createHash` for hashing, and only for content-hashing rows in `src/lib/rippling.js`, `src/lib/billcom.js`, `src/lib/billing/qboAdapter.js`).
- No Supabase `signInWithOtp`, `verifyOtp`, `createSignedUrl`, `createSignedUploadUrl`, `getSignedUrl`, `storage.from` calls anywhere.
- No NextAuth EmailProvider / MagicLink / Passwordless provider configured; NextAuth v5 is Google-OAuth-only (`src/lib/auth.js:6-24`) [verified].
- No `signed_url`, `magic_link`, `token_hash`, `one_time` string anywhere in `src/`.

What DOES exist [code-read]:
- `crypto.randomUUID()` used for submission UUIDs (invoice, labor, ops) - not cryptographically-suitable for magic links but the primitive is present in the runtime.
- `google.auth.JWT` used only for Google service-account impersonation (`src/lib/gmail.js:413`, `src/lib/gmailReadReport.js:80`, `src/lib/incidentActions.js:47`); this is a Google-token flow, not a general JWT signing utility for our own tokens.
- `crypto.subtle` referenced only in a historical comment about the retired hand-rolled JWT path (`src/lib/gmail.js:399`); the current code does not use `crypto.subtle` for our own signing [verified via grep].

Practical implication: an hourly-portal magic link needs a fresh design - token generation (`crypto.randomBytes(32).toString("base64url")` or a signed JWT via `jose`), a `token_hash` column with `expires_at` and `consumed_at`, a `GET /api/academy/verify?token=...` route, and a session-issue mechanism. NextAuth v5's EmailProvider is one option but would require a database adapter (currently there is none - NextAuth is stateless JWT sessions).

## D16: PDF generation

**Verdict: three PDF paths already exist in production. A certificate artifact backed by `pdf-lib` is a straightforward reuse of the incident-report pattern.**

Paths [verified]:

1. **`pdf-lib` (pure JS, no native deps, Vercel-safe)** - Used in production at:
   - `src/lib/incidentActions.js:907-1100+` `buildIncidentPdf(incident, attachmentNames)` - builds a fully-styled multi-section US-Letter PDF with brand colors, embedded Helvetica fonts, severity chips, wrapped text, dividers, and returns a Buffer. Called from `src/app/api/people/route.js:1421` and uploaded to Drive (`{incidentId}_Report.pdf`) plus returned as base64 to the client for download. **This is the closest existing match for a certificate: fixed template with fields (name/date/type/severity/id).**
   - `src/lib/stampInvoice.js` (`createStampedInvoicePDF`, `createRawInvoicePDF`) - assembles invoice image pages plus a machine-readable GL summary page.
   - Also used in scripts (`scripts/backfill-stl-mo-line-items.mjs`, various probes) for reading invoice PDFs.

2. **`puppeteer-core` + `@sparticuz/chromium`** - `src/app/api/service-calendar/print/route.js` (GET route). Loads Chromium in Vercel Node runtime, renders HTML from `renderMonthSheet`/`renderPeriodSheetHtml`/`renderSeasonSheet`/`renderOpsCalendarSheet` to PDF, returns with `Content-Type: application/pdf`. `maxDuration = 60`, cold-start ~2-4s. Overkill for a certificate but proven.

3. **Railway WeasyPrint** - `src/lib/performancePdf.js`. External HTTP service at `WEASYPRINT_SERVICE_URL` with `PERFORMANCE_RENDER_SECRET`, endpoints `/render/wow-plan`, `/render/cycle-review`. Requires infra that the local `.env.example` shows as optional. Not useful for Academy unless we want to move certificate rendering off-Vercel.

**Certificate reuse verdict:** `buildIncidentPdf` in `src/lib/incidentActions.js:907` is the model. A certificate is simpler (single page, fixed fields: employee name, doc title, date, serial, signature line). A new `buildCertificatePdf({ name, docTitle, docId, completedAt, serial })` following the same pattern (dynamic `import("pdf-lib")`, `PDFDocument.create()`, embedded Helvetica, `drawText`/`drawRow`) is a ~100-line function. No Chromium needed, no cold-start penalty.

Note: the "print-on-POST" brief phrase - there is currently no `POST /api/*print*` route in the repo. All existing PDF generation is either GET (`/api/service-calendar/print`) or inline within a POST body (incident submit returns `pdf_base64` in the response JSON at `/api/people/route.js:1456`). Neither pattern blocks a POST-shaped certificate route; both are valid precedents.

## Contradictions with the prompt's Section 1 facts

- **"Slack webhooks may be the only outbound channel today"** - contradicted. Gmail-API send (both SA-impersonated and user-OAuth) is production-live and used by cron, incidents, and people-ops flows. Slack webhooks are an additional channel, not the only one. Ten separate Slack webhook env vars exist (`SLACK_SC_WEBHOOK_URL`, `SLACK_INVENTORY_WEBHOOK`, `SLACK_RECAP_WEBHOOK`, `SLACK_OPD_WEBHOOK`, `SLACK_HELP_WEBHOOK`, `SLACK_NEWHIRE_WEBHOOK`, `SLACK_PAF_WEBHOOK`, `SLACK_VENDOR_WEBHOOK`, `SLACK_INVOICE_WEBHOOK`, `SLACK_INCIDENT_WEBHOOK`, `SLACK_PERFORMANCE_WEBHOOK`) [verified via `.env.example`], but they coexist with Gmail send, they do not substitute for it.
- **"The magic-link model covers everyone with no fallback"** - the magic-link INFRASTRUCTURE does not exist yet (see D15). The token/verify/session-issue layer needs to be designed and built.

## Completeness map

| Claim | Basis |
|---|---|
| No SendGrid/Resend/Nodemailer/Postmark/Mailgun/SMTP installed | [verified] - `package.json` inspection + grep across `src/` and `scripts/` |
| `googleapis` + `google-auth-library` pinned | [verified] - `package.json` deps |
| `sendEmailSA` uses domain-wide delegation, `gmail.send` scope | [code-read] - `src/lib/gmail.js:411-449` |
| SA-impersonated production senders (`support@`, `m.chavez@`) proven | [code-read] - `src/app/api/people/route.js:74-76`, `src/lib/incidentActions.js:29-47`; comment at `src/lib/billing/qboNotifications.js:48` |
| NextAuth scope includes `gmail.send` | [verified] - `src/lib/auth.js:11-19` |
| No bounce detection anywhere | [verified] - grep zero matches for bounce patterns in email code paths |
| No signed-URL / magic-link / OTP / JWT-signing primitive for our own tokens | [verified] - grep across `src/` for signed_url, magic_link, jsonwebtoken, jose, crypto.randomBytes, createHmac, signInWithOtp, verifyOtp, createSignedUrl, EmailProvider - all zero |
| `crypto.randomUUID` present in runtime | [verified] - multiple call sites |
| `pdf-lib` used to build incident-report PDF with fielded layout | [code-read] - `src/lib/incidentActions.js:907-1100+`, called from `src/app/api/people/route.js:1421` |
| `puppeteer-core` + `@sparticuz/chromium` used for SC print PDFs | [code-read] - `src/app/api/service-calendar/print/route.js:139-169` |
| Railway WeasyPrint used for performance PDFs | [code-read] - `src/lib/performancePdf.js` |
| No `POST /api/*print*` route today; PDF binaries returned via GET or inline base64 in POST responses | [verified] - grep for `/api/*print*` |
