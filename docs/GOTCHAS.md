# Gotchas - KitchFix Ops Hub

> **Purpose:** Hard-won lessons from building this system. Every entry is a real bug or pitfall that has already cost time. Read before debugging anything that smells familiar.
>
> **Last verified:** 2026-05-05
> **How to add to this list:** When you spend more than an hour on a problem and the cause is non-obvious, add the lesson here. Date the entry and describe the symptom + fix.

---

## Data & Sheets

### Currency values from Sheets are strings, not numbers

Google Sheets returns currency as `"$20,309.00"` - a string with a `$` and commas. Doing arithmetic on it silently produces `NaN`.

**Fix:** Always run currency values through `parseNum()` from `opsUtils.js` before any math.

```javascript
import { parseNum } from "@/lib/opsUtils";
const total = parseNum(row[7]);  // "$20,309.00" → 20309
```

### `values.append` must anchor to column A

Without an anchor, `values.append` writes to the first empty row of the *first column it finds with data*. If a tab has variable-width rows (e.g., some rows have data through column D, others only through column B), appends end up in the wrong column.

**Fix:** Always pass `range: "tabname!A:A"` regardless of how wide the row you're appending is.

```javascript
await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: "submissions!A:A",  // anchor to A even if row spans A:K
  valueInputOption: "USER_ENTERED",
  resource: { values: [rowData] },
});
```

### Frozen panes must be the LAST batchUpdate request

Setting frozen rows/columns *before* a merge operation in the same `batchUpdate` call causes errors. The Sheets API processes requests in order and merge boundaries can't span freeze lines that were set earlier in the same batch.

**Fix:** Apply `updateSheetProperties` (frozen panes) as the final request in the batch, after all merges.

---

## Postgres & OPD projection

### Non-atomic projection swap (relationships + surfaces)

The OPD projection's `--apply` (`scripts/content/project-catalog.mjs`) replaces `document_relationships` and `document_surfaces` via **delete-then-insert**, NOT a transaction. The Supabase REST / `supabase-js` client cannot do `BEGIN..COMMIT` or DDL, so there is no way to wrap the two calls in a single Postgres transaction from JS.

If the delete succeeds and the immediately-following insert fails (network blip, schema CHECK violation, etc.), that table is left **empty** until a re-run. The window is sub-second, but it is real.

**Recovery, in order of cheapness:**
1. Re-run `--apply`. The diff recomputes from MDX and re-inserts the same row set.
2. If re-run fails too (e.g. a CHECK constraint snuck in), restore from `.scratch/a4-backup/*-postapply-*.json` (the apply captures pre + post snapshots).

**Future hardening:** move the swap into a Postgres function (RPC) that wraps the delete + insert in a transaction; then it's an `sb.rpc('replace_document_relationships', ...)` call from JS.

### `documents.status` is NOT NULL with no default, which breaks preserve-by-omission

The OPD projection preserves overlay fields (`source_drive_id`, `pinned`, `archived`, `storage_path`) by simply OMITTING them from `mdxToDocRow`'s returned object. PostgREST's `.upsert(rows, { onConflict: "id" })` translates to `INSERT ... ON CONFLICT (id) DO UPDATE SET col=EXCLUDED.col` only for columns in the INSERT list - omitted columns are untouched on UPDATE and fall to their schema default on INSERT.

This pattern BREAKS for `documents.status`: the column is `TEXT NOT NULL` with no schema default (`pr-7-1-opd-schema.sql:44`). Omitting status fails the INSERT immediately with `null value in column status violates not-null constraint`, before ON CONFLICT can run. The same upsert call fails for every row, including existing-doc rows we only wanted to update.

`access_level` is safe to omit by contrast - it has `NOT NULL DEFAULT 'unrestricted'` (`pr-7-11`).

**Fix (used in the OPD Command overlay migration):** conditional include via an `existing` parameter to `mdxToDocRow`:

```javascript
function mdxToDocRow(fm, existing = null) {
  return {
    // ...
    status: existing ? existing.status : fm.status,                    // seed on insert, preserve on update
    access_level: existing ? existing.access_level : (fm.access_level || "unrestricted"),
    // ...
  };
}
```

On UPDATE the overlay value rides through unchanged (`EXCLUDED.status === existing.status` is a no-op). On INSERT, MDX seeds the value.

**Lesson:** before moving any field to preserve-by-omission, check whether it's NOT NULL with no schema default. If yes, either add a default in a migration or use the conditional-include pattern.

### `archive_document` RPC re-archive behavior is unverified

The projection's `computeDiff` skips already-archived docs:

```js
for (const row of live.documents) {
  if (mdxIds.has(row.id)) continue;
  if (row.archived) continue;   // <- already-archived rows skipped here
  docPlan.archive.push({ id: row.id, ... });
}
```

This means re-running `--apply` never re-calls `archive_document` on an already-archived doc, so the RPC's re-archive behavior has never been exercised by the projection. The pr-7-7 contract reads "atomic flip + chunks delete in one transaction"; whether the RPC errors or no-ops on a doc that is already `archived=true` is **not documented and not verified by the projection itself**.

**Current risk: zero** - the diff logic prevents it. **Future risk:** if any future code path bypasses `computeDiff` and calls `archive_document` directly on an already-archived id, test the RPC's behavior first (call it once against a known-archived doc and inspect both the error path and the row state).

---

## Time & Dates

### Vercel runs in UTC - date comparisons need normalization

Date comparisons that work locally fail in production because Vercel's UTC offset shifts day boundaries.

**Fix:** Normalize to start-of-day or end-of-day before comparing.

```javascript
const start = new Date(period.startDate);
start.setHours(0, 0, 0, 0);

const end = new Date(period.endDate);
end.setHours(23, 59, 59, 999);

if (eventDate >= start && eventDate <= end) { /* ... */ }
```

This bug shows up as "the period boundary cron sometimes catches things and sometimes doesn't" - classic timezone-edge symptom.

### Date helpers are duplicated across 10+ files

`formatDate`, `fmt`, `parseDate` are redefined in many files. See `CONVENTIONS.md` for the centralization rule (new code adds to `opsUtils.js`; existing duplicates migrate opportunistically).

---

## Email & Notifications

### Em-dashes in email subjects break encoding

Subject lines with `-` (em-dash) produce encoding artifacts in some email clients - the recipient sees `=?UTF-8?...` garbage in the subject.

**Fix:** Use a regular hyphen `-` in email subjects. Em-dashes in body content are fine.

### Slack webhooks need vendor name and actor email

When Vendor Portal Slack notifications were first written, deactivate/reactivate messages didn't include the vendor name or who triggered the change. This is a known polish gap. When adding a Slack notification, always include:
- Who did it (`actor email`)
- What changed (`vendor name`, `account`, etc.)
- Time/context

A Slack message like "vendor deactivated" tells you nothing in 2 days when you're trying to figure out what happened.

---

## AI / Claude API

### Vendor auto-detect works. Invoice numbers, dates, totals do NOT.

Claude OCR is reliable for vendor identification (matching against a known vendor list). It is **unreliable** for extracting structured numeric fields - invoice number, invoice date, totals.

**Rule:** Always require manual entry for invoice number, date, and total. Treat AI extraction of these as a *suggestion to verify*, not a value to trust. Surface the AI confidence visibly.

### AI calls are slow - design for it

A single Claude OCR call can take 5–15 seconds. Don't freeze the UI. Use skeletons, progress states, or background processing patterns. The Railway nightly catalog match runs in 50-item batches for this reason.

---

## React & Components

### Never define a function component inside another component's render body

```javascript
// WRONG
function Parent({ data }) {
  const Inner = () => <div>{data}</div>;  // new component every render
  return <Inner />;
}
```

This creates a *new* component identity on every render of `Parent`, which causes React to unmount and remount the entire `Inner` subtree every time. Symptoms: state resets, focus jumps, infinite render loops.

**Fix:** Use a single `content` variable with `if/else`, or extract `Inner` to a top-level component.

```javascript
// RIGHT
function Parent({ data }) {
  let content;
  if (data) content = <div>{data}</div>;
  else      content = <div>Empty</div>;
  return content;
}
```

### The SC toast is per-page, not the shared component

`service-calendar/page.js` renders its own `.oh-toast` / `<SubmissionToast>` via a local `showToast(msgOrObj, type)` provider — it does **not** use `src/components/people/Toast.js`. The rich "recorded" variant is an object payload (`{ variant: "recorded", amount, meals, daysEntered, ... }`); plain toasts are still strings and route through the same `showToast`. Each top-level page owns its own toast provider — Ops has its own too, and their DOM containers are separate.

**Fix:** don't reach for the shared component when adding a new toast on SC. Add to `showToast`'s payload contract and render inside `page.js`. Same shape carries `.oh-toast-container` positioning via a modifier class (SC uses `--sc-center` to sit over the calendar; Ops keeps top-anchored).

### A cache-guarded fetch effect needs the cache in its deps

A `useEffect` whose guard reads a cache object but excludes that cache from its dep array reads a **stale closure**. When a sibling effect clears the cache (e.g. on account switch), the guarded effect re-runs with the OLD cache (key still present → skips refetch), then never re-runs when the cache actually clears (not a dep) → blank view.

```javascript
// WRONG
useEffect(() => {
  if (monthCache[monthKey]) return; // reads stale closure
  fetch(...).then(d => setMonthCache(prev => ({...prev, [monthKey]: d})));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedAccount, monthKey]);   // monthCache deliberately excluded
```

**Fix:** put the cache in the deps and drop the eslint-disable. The guard self-terminates (empty cache → fetch → populate → guard hits → stop), so no loop. SC account-switch blank, #332.

---

## Next.js App Router

### A heavy post-save refetch can race client navigation (nav dead right after a save)

Invalidating the **entire** month cache on save (`setMonthCache({})`) forces every cached month to refetch at once — and because the drill-in fetch effects have `monthCache` in their deps (#332), each write-back re-fires them, producing a burst of (often cancelled) `sc-load` requests. During that burst, `router.push` navigation clicks (`‹ Season`, the period/month stepper) are **intermittently lost** — the header renders and the buttons are enabled, but the click races the churn. Symptom: nav is dead *immediately after a save*, then works after a beat.

**Fix (#338):** scope save-invalidation to only the month(s) actually written, so the refetch is 1-2 months, not the whole cache and its cascade.

**Red herring on record:** a `<Suspense>` boundary around the `useSearchParams()` consumer was blamed for this first (#330 added it as "hygiene," #333 removed it). Removing it was fine — it was unnecessary for a fully-`"use client"` + `useSession` (already-dynamic) page — but it did **not** fix the nav. The cause was always the refetch burst above. Don't re-add the boundary expecting it to matter, and don't re-blame it.

### Same-route `router.push` preserves component state

`selectedAccount` on the Service Calendar (and any similar per-page state) survives an intra-route navigation because Next's App Router does **not** unmount the page component when you `router.push` to a same-route URL — it re-runs the effects with the new query but keeps the tree mounted. A drilled-in `?month=2026-08` view can therefore reset to the season overview by simply clearing the query (`router.push('/service-calendar')`); the URL-sync effect lands on the overview and the account persists.

**Fix:** don't lift `selectedAccount` out of the page or add a "restore account after nav" effect. Just clear the query. Wired on the Service TopNav item in #347 — same-route click on `/service-calendar` from a drilled-in view `preventDefault()`s and pushes the bare route.

### A stepper/nav gated on async-loaded data reads as "broken," not "loading"

A drill-in stepper disabled on `!periodRanges` (loaded at the end of an auth → account → `sc-year-summary` chain) looks dead on cold refresh — the header paints before the data lands, so the disabled arrows read as broken.

**Fix:** render a loading affordance (skeleton range/phase + `aria-busy` on the stepper wrapper) while the data is pending, so it reads "loading." SC nav-refresh, #330.

---

## Tooling & File Operations

### `str_replace` requires exact whitespace match

When using `str_replace` to edit code, the `old_str` must match character-for-character including indentation, tabs vs. spaces, and trailing whitespace. A mismatch fails silently or produces a "string not found" error.

**Fix:** Run `grep -n` to find the line, view the exact bytes, then construct `old_str` from that view. Don't reconstruct from memory.

For sweeping token replacements (e.g., renaming a variable across a file), `sed` is more reliable than repeated `str_replace`. Verify with `grep` after.

### Never move files via VS Code drag-and-drop when they have relative imports

Dragging a file in the VS Code explorer triggers automatic import-path updates that frequently miss cases - `../utils` becomes `./utils` cleanly, but cross-folder moves often break.

**Fix:** Use `mv` in the terminal, then `rm -rf .next` before `npm run dev` to clear Next.js's cached module graph.

```bash
mv src/components/old/Thing.js src/components/new/Thing.js
# manually update imports
rm -rf .next
npm run dev
```

### `rm -rf .next && npm run dev` is the rebuild incantation

When something is "stuck" - old code running, hot reload not picking up changes, weird import errors - clear the `.next` cache before suspecting a deeper bug. 80% of "this should work but doesn't" turns out to be stale build cache.

### Positional-arg drift on shared helpers rots silently

When a shared helper is called positionally from many sites, signature drift (caller adds an extra arg, or the helper drops one) does NOT throw. JavaScript silently maps args left-to-right and drops or undefines the extras. When the helper also (a) catches and returns `{success: false}` instead of throwing and (b) callers do `await Promise.all(...)` without inspecting returns, the silence becomes total. The bug lives in production for as long as the underlying state stays observable-only-after-effect.

**Canonical example**: pre-PR-#59, `dashboard/route.js` called `updateCell(token, COLLECTION, "news_interactions", \`C${row}\`, "TRUE")` against a 4-arg `updateCell(accessToken, spreadsheetId, range, value)`. The tab name landed in the `range` slot; the intended `C${row}` landed in the `value` slot; the real value was silently dropped as the unbound 5th arg. Every cell update wrote the intended range string into A1 of the tab. The bug lived in production for ~2 months. Full forensics in `docs/BUSINESS_NOTES.md` under the PR #59 entry.

**Defenses**:
- Prefer named-arg / object-arg calls for helpers with 3+ parameters: `updateCell({ accessToken, spreadsheetId, range, value })` is drift-resistant.
- Helpers that mutate production data must throw on error, not return a status object that callers can ignore.
- During helper consolidation, walk every call site and confirm signature alignment - do not trust grep counts alone.

**Lesson generalized 2026-05-29** during the `docs/folder-audit` cleanup; specific PR #59 incident captured in `BUSINESS_NOTES.md`.

---

## Auth & Permissions

### User OAuth tokens for Drive uploads is a security bug

If you use a user's OAuth token to upload a file to Drive, the upload only works if that user has Drive access to the target folder. In a multi-user system this means invoices uploaded by a chef and invoices uploaded by a director can land in different places, depending on who has what permission.

**Fix:** All Drive uploads use the service account. Always. There is no exception.

```javascript
// WRONG - uses user token
await drive.files.create({ auth: userOAuth, ... });

// RIGHT - uses service account (helper handles auth internally)
await uploadInvoiceImage(serviceAccountClient, ...);
```

### Drive API + shared drives requires `supportsAllDrives: true`

Any `drive.files.*` operation (copy, get, list, update, delete) against a file that lives in a shared drive - e.g., CJK Foods - silently returns `File not found` if `supportsAllDrives: true` is not set in the request options. The API returns 404 even when the calling principal has been shared as Editor or Content manager on both the source and the destination. The error message is identical to "the file genuinely doesn't exist," which is misleading.

This affects: anything using `google.drive()` directly. The Sheets API (`sheets.spreadsheets.*`) is unaffected - it has its own shared-drive handling internal to the call.

**Fix:** Add `supportsAllDrives: true` to every Drive API request.

```javascript
// WRONG - returns File not found on shared-drive files
await drive.files.copy({
  fileId: sheet.id,
  requestBody: { name, parents: [folderId] },
  fields: "id, name",
});

// RIGHT
await drive.files.copy({
  fileId: sheet.id,
  requestBody: { name, parents: [folderId] },
  fields: "id, name",
  supportsAllDrives: true,
});
```

**First seen:** 2026-05-13, building the `/api/cron/backup-sheets` route. Cost: ~30 min of "share dialog must be wrong" diagnosis before realizing the SA already had access and the flag was the issue.

### Historical: `SHEET_IDS.INVENTORY` was `process.env.INVENTORY_SHEET_ID || ""`

**Fixed 2026-05-13.** `SHEET_IDS.INVENTORY` is now a hardcoded literal matching the pattern of HUB, COLLECTION, GAME, GL_CODES, and AI_LINE_ITEMS.

The old pattern (`process.env.INVENTORY_SHEET_ID || ""`) created two issues: (1) running `node -e` to inspect `SHEET_IDS` outside Next.js produced an empty string because Node's `require` doesn't load `.env.local` - misleading anyone debugging; (2) routes that imported `SHEET_IDS.INVENTORY` directly worked in Next.js runtime but silently broke if the env var was missing.

**Fixed in PR #51 (2026-05-18):** `src/lib/inventoryActions.js` now imports `SHEET_IDS.INVENTORY` consistently. The local `const INVENTORY_SHEET_ID = process.env.INVENTORY_SHEET_ID;` shim at L12 was deleted; 94 call sites across the file were converted to `SHEET_IDS.INVENTORY`. Original-state note: prior to PR #51, this file reached the sheet via the env var directly (~80 call sites of inconsistency).

**Lesson worth keeping:** if you find a "weird empty string" while debugging, check whether you're inspecting code inside the framework's runtime context vs. a bare `node -e` shell.

// WRONG - uses user token
await drive.files.create({ auth: userOAuth, ... });

// RIGHT - uses service account (helper handles auth internally)
await uploadInvoiceImage(serviceAccountClient, ...);
```

### Token refresh sometimes returns a new refresh token, sometimes doesn't

Google's OAuth refresh response *may* include a new `refresh_token`, or it may not. The auth code in `src/lib/auth.js` handles this:

```javascript
refreshToken: refreshed.refresh_token ?? token.refreshToken,
```

If a user's session goes weird ("RefreshTokenError"), this is usually the cause. They should sign out and sign back in to re-issue both tokens.

### Conditional `CRON_SECRET` check fails open if the env var is unset

The cron auth pattern in `/api/cron/backup-sheets/route.js:70-75` gates the check on `CRON_SECRET` being defined:

```javascript
if (
  process.env.CRON_SECRET &&
  authHeader !== `Bearer ${process.env.CRON_SECRET}`
) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

If `CRON_SECRET` is missing from the environment, the auth check is skipped entirely and the route becomes publicly accessible. Production has the env var set so this is fine in practice, but it's a fail-open pattern that's easy to miss - any future env-var rotation that leaves a gap exposes the cron.

**Fix (for any new cron route):** prefer fail-closed.

```javascript
if (!process.env.CRON_SECRET) {
  return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
}
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**Surfaced:** Stage 0 audit of `backup-sheets`, 2026-05-15. Existing crons left as-is - not worth a defensive change for routes that work in prod today. Apply the fail-closed pattern to new cron routes.

---

## Git & Workflow

### `git checkout -b` failure leaves you on the previous branch - silently

If `git checkout -b newbranch` fails because the branch already exists, git stays on whatever branch you were on (usually `main`). The error scrolls off-screen mid-flow, and subsequent commits land on the wrong branch silently. You then `git push -u origin newbranch` - git happily pushes the *empty* feature branch (which still matches origin/main), while your real work sits orphaned on local main.

**Symptom:** PR opens with zero changes, or with the wrong commits. `git log --oneline --all` shows the feature branch pointing somewhere unexpected.

**Fix:** Always `git status` before `git commit`. The branch name is the first line - a one-second check that catches this and a dozen related footguns.

**Recovery if you've already committed to the wrong branch:**

```bash
# Move local branch pointer to current HEAD (where your commit lives)
git branch -f wrong-branch HEAD

# Reset main back to origin/main
git reset --hard origin/main

# Push the now-correct branch
git push --force-with-lease origin wrong-branch
```

**First seen:** 2026-05-13, mid-Phase-1 push day. Cost: ~10 min of git gymnastics. The lesson is cheap; the bug is annoying.

---

## Testing & CI

### Auth state is environment-scoped - cookies don't cross domains

A `tests/.auth/user.json` generated by signing in at `localhost:3000` will NOT authenticate against `kitchfix-intranet.vercel.app`. NextAuth session cookies have a domain attribute; the browser refuses to send `localhost`-scoped cookies to a `.vercel.app` host. Result: tests visit production, see no session, bounce to `/login`, and fail with "expected pattern: not /sign-?in|\/login|\/api\/auth/i".

**Fix:** Regenerate auth state against the actual target environment.

```bash
rm tests/.auth/user.json
PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app npm run test:e2e:setup -- --headed
# manually log in, click Resume in Inspector
```

The `auth.setup.ts` URL regex must also be flexible (matches any `^https?://[^/]+/` rather than hardcoded localhost), which it now is - but worth checking if regenerating future test environments.

**When this bites:** CI was previously green, now suddenly failing on the home dashboard test with login-redirect symptoms. Either the cookies expired (Google's schedule) or someone regenerated against the wrong environment.

## CSS

### Module prefix collisions are real - `oh-inv-` vs `oh-inv-mgmt-`

Two Ops Hub modules - Inventory (legacy) and Invoice Capture - both use the `oh-inv-` prefix. The newer Inventory Manager uses `oh-inv-mgmt-`. When working in any of these three, double-check which file your CSS is going into and whether your class name collides.

**Fix when adding new prefixes:** Make them clearly distinct (`oh-inv-mgmt-` not just `oh-im-`). Prefix collisions cause hard-to-debug visual bugs because the wrong module's styles win specificity battles.

### Print CSS strips document design unless you preserve color and claim every `@page` margin box

Two failure modes that together produce "print preview looks like raw unstyled data" in the doc-format arc:

1. **`color: #000` in the `@media print` block cascades to every heading** and kills the navy hierarchy. Headings collapse to flat black, the brand voice is gone.
2. **Browsers default to NOT printing background fills.** Callout boxes (the colored ANCHOR / NOTE / CRITICAL blockquotes) lose their fills entirely and survive only as a left border. Tables lose their header background.

**Fix:** never set `color: #000` on the print body - let the screen heading colors carry through. Add `print-color-adjust: exact` (plus the `-webkit-` prefix) to the body, every callout blockquote variant, and table headers:

```css
@media print {
  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  blockquote.callout-anchor,
  blockquote.callout-note,
  blockquote.callout-critical,
  blockquote.callout-warning,
  th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

**Related: Chrome's print header/footer (date, URL, page number) cannot be reliably killed from CSS.** Claiming all the standard `@page` margin boxes (including `@top-center` with `content: ""`) suppresses the defaults under normal conditions. But if the user toggles "Headers and footers" ON in the print dialog, Chrome injects them regardless of what the stylesheet says. There is no pure-CSS guaranteed kill switch.

**First seen:** 2026-06-17 doc-format arc (STD-001 v1.2 print/PDF pipeline). Cost: a full polish PR to find both rules.

### Tailwind is imported but is NOT the system

`globals.css` imports Tailwind v4 as a utility backstop. The primary styling system is vanilla CSS with prefix-isolated classes. Don't write Tailwind-first components - they break the prefix-isolation guarantee and create a mixed system.

---

## Service Calendar

### SC PDC phases: the "Camp Name" column is the source of truth, not meal-count inference
PDC developmental phases (Spring Training, Extended, ACL/FCL, Instructional, etc.) are RECORDED in a "Camp Name" column in the legacy SC spreadsheets, typed per-day by operators - for 3 of the 5 PDCs (CIN-AZ, TXR-AZ, TBR-FL, all CLEAN). Do NOT infer phases from meal-count step-changes for these accounts; read the recorded column. Two PDCs do NOT record (TBJ-FL uses the column for one-day event flags; STL-FL's "Homestand" column is blank) - those need inference + Kevin confirmation. The full recorded calendars + the alias->canonical vocabulary are in `SC_PDC_PHASES.md`. The naming is per-operator and inconsistent ("ACL" vs "FCL", "Instructs" vs "Camps"), so any phase model needs an alias->canonical map, not a clean enum.

### SC actuals revenue uses a per-account CONTRACTED discount, not the projected/sticker price
Do NOT assume one price per service. Each account's Actuals-tab prices differ from its Projections-tab prices by a contracted discount: CIN-AZ actuals = 70% of projected; TBR-FL MiLB actuals = 75% of projected (the 25% amortization discount, still active in 2026). Major League services are NOT discounted. Any revenue calc that needs to match the P&L or the invoice MUST apply the actuals (discounted) rate to actuals, not the projected rate. Using sticker prices for actuals overstates revenue and reproduces the exact "data doesn't match KPIs" failure of the old KPI tool. Detail in `SC_BILLING_MODEL_AUDIT.md`.

### SC flat-fee accounts: revenue is NOT per-meal, and the fee is phase-aware prorated
Flat-fee accounts (STL-FL, the MLB flat-fee accounts) do not compute revenue from headcount x price - their per-meal prices may be $0 by design (STL-FL flipped to $0 on 2026-06-16). STL-FL's $1.4M annual fee is spread PHASE-AWARE across the 13 periods in the P&L (peak in the Spring Training period, plateau through FCL, $0 offseason), NOT flat-monthly. Drive flat-fee revenue from the fee-schedule / P&L allocation, not from meal math. Detail in `SC_BILLING_MODEL_AUDIT.md` and `sc_fee_schedule`.

### SC role data lives in the `contacts` table, not in code (and not in the empty `users` table)
Intent-aware / role-based logic should read `contacts.role` (free-text job titles - Executive Chef, Sous Chef, CEO, VP Operations, Regional Director East/West, etc.), NOT the hardcoded `SC_ADMIN_EMAILS` list and NOT the `users` table (which exists but is EMPTY). All 8 hardcoded SC_ADMIN emails match their `contacts.role` exactly. `contacts.role` is free-text, so map known strings to a controlled vocabulary. `user_accounts` is 1-account-per-user (no multi-account rows); a director's "home" account is their `user_accounts` row, and role drives whether they land on that account (floor) or the year overview (leadership).

---

## Captain's log

*Add new entries here, dated, with symptom and fix.*

- **2026-05-05** - Initial gotchas captured from working memory: currency parsing, UTC dates, em-dashes, AI reliability ceiling, React inner components, str_replace whitespace, file moves, Drive auth boundary, prefix collisions.
- **2026-05-05** - Date helper note trimmed to a pointer to `CONVENTIONS.md` (the centralization rule lives there; this doc just flags the symptom).

- **2026-05-13** - Auth state from `storageState` is environment-scoped. NextAuth session cookies are domain-locked to the URL where login happened - a `user.json` generated against `localhost:3000` does NOT work when tests target `kitchfix-intranet.vercel.app`. The browser refuses to send cookies cross-domain, NextAuth sees no session, middleware bounces to `/login`. **Fix:** regenerate `tests/.auth/user.json` against the target environment using `PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app npm run test:e2e:setup -- --headed`. Cost: 30 minutes of CI failure debugging before realizing cookie domain was the issue. See `docs/TESTING.md` "Refreshing the auth state secret" for the full procedure.
- **2026-05-13** - Three new entries from Phase 1 push day: (1) Drive API + shared drives requires `supportsAllDrives: true` - found while building `/api/cron/backup-sheets`. (2) `SHEET_IDS.INVENTORY` is an empty string footgun - real ID resolves from env var. (3) New "Git & Workflow" section with `git checkout -b` silent-failure recovery - committed to main by accident mid-bump, ~10 min recovery.
- **2026-06-16** - Two entries surfaced during Phase A A4 (OPD projection executor) review: (1) projection swap is non-atomic - relationships + surfaces delete-then-insert can leave a table empty if the delete succeeds and the insert fails (Supabase REST has no `BEGIN..COMMIT`); local JSON backup is the rollback net. (2) `archive_document` re-archive behavior is unverified because the diff skips already-archived rows; not a current risk but worth knowing if future code bypasses the diff.
- **2026-06-16** - Phase A A7: SousAI Drive ingestion retired. A5 swapped `embedDocument` to read from resolved MDX (`extractMdx`) instead of the Drive Docs API; A7 deleted the now-orphaned Drive path (`src/lib/sousai/extract.js` + the Layer-2 dev rig `scripts/sousai-extract-and-chunk.mjs`). The `documents.readonly` and `drive.readonly` SA scopes leave the codebase with that delete. **Intentionally still present:** the `documents.source_drive_id`/`_es` columns and the reader's Drive iframe fallback in `SlideOverReader.js`/`route.js` - they back the reader until their own separate retirement (post-A7 doc-cleanup pass). The broad `drive` scope in `src/lib/sheets.js` and `src/lib/auth.js` is the standing scope-permissiveness finding, unrelated to A7.
- **2026-06-17** - Two entries from the doc-format arc + the OPD Command engine scoping: (1) Print CSS strips document design unless `color: #000` is avoided on the print body and `print-color-adjust: exact` is set on the body + callout variants + table headers; Chrome's print header/footer cannot be reliably killed from CSS when the user has "Headers and footers" toggled on. (2) `documents.status` is NOT NULL with no schema default, which breaks the preserve-by-omission pattern that works for the other overlay fields - fix is conditional include via `mdxToDocRow(fm, existing)` so MDX seeds on insert and the existing PG row preserves on update.
- **2026-06-24** - New Service Calendar section from the SC lens-vision investigation: (1) PDC phases are RECORDED in a "Camp Name" column for 3 of 5 PDCs - read it, do not infer (`SC_PDC_PHASES.md`). (2) Actuals use a per-account contracted discount (CIN-AZ 70%, TBR-FL MiLB 75%), not sticker price - matching the P&L requires applying the discount. (3) Flat-fee accounts (STL-FL, MLB flat-fees) drive revenue from the fee schedule / P&L allocation, not from per-meal math. (4) Role data lives in `contacts.role` (not the empty `users` table, not the hardcoded `SC_ADMIN_EMAILS`); intent-aware landing keys off that column.