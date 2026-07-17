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

Subject lines with `—` (em-dash) produce encoding artifacts in some email clients - the recipient sees `=?UTF-8?...` garbage in the subject.

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

### Hook declaration order is a runtime-only failure class

A `useMemo` / `useCallback` / `useEffect` dep array that references a `useState` (or any `const`) declared later in the same component throws `ReferenceError: Cannot access '<name>' before initialization` on first render. Deps are evaluated during render in source order, and `const` bindings are in the temporal dead zone until their declaration line executes.

`next build` cannot catch this - client components are compiled at build but not executed. CI stays green if no Playwright spec loads the affected route. Type checks are silent for the same reason: it's a runtime access-before-init, not a static type error.

**Incident:** F3 save-queue (#378, 2026-07-10). `syncingDates` useMemo at ~:695 read `syncingKeys` in its dep array, but `const [syncingKeys, setSyncingKeys] = useState(...)` sat at ~:906. The route (`/service-calendar`) was down across three merges behind the Coming Soon gate before Kevin caught it in browser. Fix in `fix/sc-f3-tdz-hook-order` hoists the F3 state block to the main state section and adds a Playwright spec (`tests/sc-tdz-hotfix.spec.ts`) that intercepts `/api/auth/session` + the SC data actions so the ServiceCalendar body actually executes.

**Rules:**
- New hooks declare above first use. When inserting a hook, scan the component for existing references and place the declaration above all of them.
- Any hotfix touching `ServiceCalendar.js` requires a dev-server browser load as evidence, not just a passing build. State this explicitly in the PR body.
- The runtime-proof spec is now the guard - keep it green whenever this file changes.

### Extracted-function free variables are the same runtime-only class

Same failure family as the TDZ entry above: `next build` cannot catch it, CI stays green if no spec exercises the render path, and both a per-file grep and a type check look clean. The difference is that the reference lives in an EXTRACTED function - a module-level sibling of the component whose props it renders - and the "usage" and the "prop declaration" are in the same file but in different scopes.

Pattern: a prop added to a component and a usage added to a module-level inner function in the same file look complete when you grep. A per-file grep for `syncingDates` shows both the prop and the usage, seemingly wired. Only executing the render depth catches that the inner function's parameter list never received the prop, and the reference at the usage site is a free variable that throws `ReferenceError: <name> is not defined` the moment that render depth executes.

**Incident:** F3 save-queue DayGrid (#378, surfaced 2026-07-10). `PeriodWorkspace.js` added `syncingDates` to its component prop list (:79) and used it inside the DayGrid callsite (:834), but the `DayGrid` module-level sibling function's own destructure at :658 never received it. Every real-day cell crashed on first render of the drill-in. Masked until #382 unmasked it (the earlier TDZ killed the route before any drill was reachable), then surfaced on the first month click after #382 merged. Fix in `fix/sc-daygrid-syncing-thread` adds the prop to DayGrid's destructure + passes it at the parent callsite, and extends the guard spec past first render to include a MonthCard drill click that asserts `.sc-workspace-grid-row` appears with zero `ReferenceError` accumulated.

**Rules:**
- The guard spec must exercise every render depth a change touches. First render was never sufficient - the drill click is now part of the guard.
- When a prop is threaded to a component that renders sibling/extracted functions in the same file, trace it into each extracted function's own parameter list. Per-file grep for the identifier is necessary but not sufficient - the compilation is clean and the crash only appears at render.
- Route intercept stubs that mock a payload MUST include at least one entry that reaches the render path in question. An all-empty / all-ghost stub silently sails past the live bug and the guard spec is a lie. State the "must include a REAL day" requirement in a comment inside the spec so it can't be simplified into uselessness later.

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

`service-calendar/page.js` renders its own `.oh-toast` / `<SubmissionToast>` via a local `showToast(msgOrObj, type)` provider - it does **not** use `src/components/people/Toast.js`. The rich "recorded" variant is an object payload (`{ variant: "recorded", amount, meals, daysEntered, ... }`); plain toasts are still strings and route through the same `showToast`. Each top-level page owns its own toast provider - Ops has its own too, and their DOM containers are separate.

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

Invalidating the **entire** month cache on save (`setMonthCache({})`) forces every cached month to refetch at once - and because the drill-in fetch effects have `monthCache` in their deps (#332), each write-back re-fires them, producing a burst of (often cancelled) `sc-load` requests. During that burst, `router.push` navigation clicks (`‹ Season`, the period/month stepper) are **intermittently lost** - the header renders and the buttons are enabled, but the click races the churn. Symptom: nav is dead *immediately after a save*, then works after a beat.

**Fix (#338):** scope save-invalidation to only the month(s) actually written, so the refetch is 1-2 months, not the whole cache and its cascade.

**Red herring on record:** a `<Suspense>` boundary around the `useSearchParams()` consumer was blamed for this first (#330 added it as "hygiene," #333 removed it). Removing it was fine - it was unnecessary for a fully-`"use client"` + `useSession` (already-dynamic) page - but it did **not** fix the nav. The cause was always the refetch burst above. Don't re-add the boundary expecting it to matter, and don't re-blame it.

### Same-route `router.push` preserves component state

`selectedAccount` on the Service Calendar (and any similar per-page state) survives an intra-route navigation because Next's App Router does **not** unmount the page component when you `router.push` to a same-route URL - it re-runs the effects with the new query but keeps the tree mounted. A drilled-in `?month=2026-08` view can therefore reset to the season overview by simply clearing the query (`router.push('/service-calendar')`); the URL-sync effect lands on the overview and the account persists.

**Fix:** don't lift `selectedAccount` out of the page or add a "restore account after nav" effect. Just clear the query. Wired on the Service TopNav item in #347 - same-route click on `/service-calendar` from a drilled-in view `preventDefault()`s and pushes the bare route.

### A stepper/nav gated on async-loaded data reads as "broken," not "loading"

A drill-in stepper disabled on `!periodRanges` (loaded at the end of an auth → account → `sc-year-summary` chain) looks dead on cold refresh - the header paints before the data lands, so the disabled arrows read as broken.

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
Do NOT assume one price per service. Each account's Actuals-tab prices differ from its Projections-tab prices by a contracted discount: CIN-AZ actuals = 70% of projected; TBR-FL MiLB actuals = 75% of projected (the 25% amortization discount, still active in 2026). Major League services are NOT discounted. Any revenue calc that needs to match the P&L or the invoice MUST apply the actuals (discounted) rate to actuals, not the projected rate. Using sticker prices for actuals overstates revenue and reproduces the exact "data doesn't match KPIs" failure of the old KPI tool. Money-model authority: `SC_MONEY_MODEL.md`; per-account detail in `SC_BILLING_MODEL_AUDIT.md`; workbook evidence in `SC_REVENUE_LENSES_MEMO.md`.

### The shifted-input backfill trap
A data-transformation migration that computes new column values from an existing column MUST verify the existing column's SEMANTIC PROVENANCE at run time, not just its column name. sc-8b assumed sc_service_prices 'projected' rows held workbook sticker prices; between the docs' authoring and the migration's run, an out-of-band correction (2026-06-16 Price Review v3) had already moved those rows to the post-SF invoice rate. sc-8b's `projected × 0.70` therefore applied a SECOND SF discount, and every CIN-AZ / TXR-AZ / TBR-FL MiLB day since read 30/20/25% too low on actual_revenue for 15 days before detection. **Rule:** the migration should have opened with `SELECT price FROM sc_service_prices WHERE service_id = 'CIN-AZ-MiLB-Breakfast' AND effective_date = '2026-01-01'` and REFUSED to run unless the value matched the assumed sticker $18.42. Fix landed as `sc-8c`. Timeline: `SC_MONEY_ALIGNMENT_REPORT.md` Part 4.

### Out-of-band Supabase corrections MUST be recorded same-day in the repo
Manual SQL edits made directly against production Supabase (via Studio or CLI) must be captured the same day, either as a proper migration file OR as a dated note in a discoverable place (this doc, or a `docs/migrations/OUT_OF_BAND_CHANGES.md` register). The 2026-06-16 CIN-AZ price correction was correct and intentional, but it was documented only in a passing comment inside `_seed_sc_from_xlsx.mjs:440-450`. Nine days later a well-intentioned migration (sc-8b) ran a computation against the correction's target and produced a subtle 30%-of-revenue understatement that nobody caught for two weeks. **Rule:** if you SQL-edit a table that another process might read or transform, either land it as a migration (with a header explaining the intent) or add a `Captain's log` entry here dated + linked - do not leave the record in a script comment.

### CPI / escalation price updates land in PG via the admin backdate flow, never in sheets
The legacy Service Calendar workbooks carry in-cell escalation machinery (`=22.25*(1+$E$362)` in TBJ-FL, `=24.98*1.039` in CIN-KY, `=X * 0.7` on CIN-AZ actuals for the SF% mechanic, etc.). That was correct for the sheet era; PG is canonical now. A new CPI-escalated price is a NEW `sc_service_prices` row with a later `effective_date`, written via the admin price editor (fenced backdate mode landed PR #224). Do NOT copy escalated numbers from sheet cells and paste them into PG - the sheet numbers may already be double-escalated, mid-recalculation, or blocked by a formula error. Read the operative rate from Price Review v3 (or its successor doc) and enter via admin.

### SC flat-fee accounts: revenue is NOT per-meal, and the fee is phase-aware prorated
Flat-fee accounts (STL-FL, the MLB flat-fee accounts) do not compute revenue from headcount x price - their per-meal prices may be $0 by design (STL-FL flipped to $0 on 2026-06-16). STL-FL's $1.4M annual fee is spread PHASE-AWARE across the 13 periods in the P&L: **peak at P2 (not P3, as the earlier phrasing had it); FCL plateau across P4-P8; zero in the two offseason periods**. The full per-period vector lives in `docs/pricing-summit/PL_2026_APPENDIX.md` row R25 (STL-FL section §3.4) - source-of-truth for the vector, not repeated here. Directional correction per pricing-summit CONFLICT_REGISTER A-9 / D-3: the earlier "P1 $45,553 / P3 peak" phrasing had P1 wrong AND mislabeled the peak period. Drive flat-fee revenue from the fee-schedule / P&L allocation, not from meal math. Detail in `SC_BILLING_MODEL_AUDIT.md` and `sc_fee_schedule`.

### SC role data lives in the `contacts` table, not in code (and not in the empty `users` table)
Intent-aware / role-based logic should read `contacts.role` (free-text job titles - Executive Chef, Sous Chef, CEO, VP Operations, Regional Director East/West, etc.), NOT the hardcoded `SC_ADMIN_EMAILS` list and NOT the `users` table (which exists but is EMPTY). All 8 hardcoded SC_ADMIN emails match their `contacts.role` exactly. `contacts.role` is free-text, so map known strings to a controlled vocabulary. `user_accounts` is 1-account-per-user (no multi-account rows); a director's "home" account is their `user_accounts` row, and role drives whether they land on that account (floor) or the year overview (leadership).

### SC classifier: per-meal zero and homestand zero mean opposite things
Per `docs/SC_MONEY_MODEL.md` and owner ruling 2026-07-09, the `classifyDayStatus` function in `src/lib/dataStore/serviceCalendar.js:~183-216` treats a zero actual count differently depending on account shape - a **deliberate asymmetry**.

- **Per-meal accounts** (CIN-AZ / CIN-KY / TBJ-FL / TBJ-NY / TBR-FL PDC / TXR-AZ): all-zero actuals -> status `"no-service"` (planned off day; the classifier can't distinguish this from a Sunday that was never touched, and by ruling both read as beige/complete). Line 205: `if (s.hasAct && !s.anyNonZeroAct) return "no-service";`.
- **MLB homestand accounts** (CIN-OH / STL-MO / TXR-TX-H/V): all-zero actuals on a GAME day -> status `"entered"` (a zeroed game is a **recorded cancellation** - chef marked the game rained out, and that's operational data worth surfacing as green). Line 199-200: `if (hs.dayType === "GAME") { if (s.hasAct) return "entered"; ... }`.

Both branches were touched by SC-066/077/078 (mark-no-service + entry-aware classifier). The `s.hasAct` check discriminates in both branches; the semantic difference is what a saved zero MEANS on that account shape. Do NOT "harmonize" this - it's the correct model.

### SC uses silent `.catch(() => {})` / `catch {}` in specific tolerable-failure spots - do not extend
The Service Calendar has SEVEN sites intentionally swallowing errors with `.catch(() => {})`, `.catch(() => null)`, or a bare `catch { /* comment */ }`. Enumerated 2026-07-09:

- `src/app/service-calendar/page.js:60` - hero-image fetch (cosmetic; failure is OK).
- `src/app/service-calendar/ServiceCalendar.js:792` - month prefetch inner `.catch(() => null)` mapping per-fetch failures to a sentinel so `Promise.allSettled` can filter them out.
- `src/app/service-calendar/ServiceCalendar.js:806` - month prefetch outer `.catch` (best-effort; the real load fires on click regardless).
- `src/app/service-calendar/ServiceCalendar.js:809` - `catch { /* ignore */ }` around `cancel(idleId)` in the idle-callback cleanup (env-polyfill guard against a missing `cancelIdleCallback`).
- `src/app/service-calendar/ServiceCalendar.js:1029` - bulk-write per-day `catch { /* continue */ }` inside the `handleBulkSave` loop (one day failing shouldn't stop the N-1 others; failure surfaces via the successCount toast copy).
- `src/app/service-calendar/ServiceCalendar.js:1087` - second bulk-write per-day `catch { /* continue */ }` inside `handleBulkConfirm` (same rationale as :1029 for the custom-values path).
- `src/app/service-calendar/admin/AccountEditor.js:124` - admin config fetch on mount (cosmetic in an already-open modal).

These are **exceptions**, not the pattern. When you add a new fetch to SC, do NOT copy this pattern - the default is "surface the error via `showToast(err, 'error')`." The silent sites are the specific carve-outs above; anything new that catches silently needs a comment explaining why.

### SC migrations in `docs/migrations/*.sql` run at MERGE time (not deploy time), and Vercel does not run them for you
When a PR carrying a `docs/migrations/*.sql` file merges to main, Vercel builds + deploys the code that references the new table/view. **The SQL does NOT run automatically.** Kevin runs it manually in Supabase Studio.

**The #367 sc-9 incident (2026-07-09):** #367 landed `sc-9-day-note-entries.sql` (create the notes-ledger table) alongside the code that queries it. The code deployed immediately on merge; the SQL was run hours later. Between merge and `sc-9` apply, every SC month-load hit a 500 querying a missing table.

**Rule:** if your PR touches `docs/migrations/*.sql`, EITHER
- run the SQL in Supabase Studio BEFORE merging (safest); OR
- add a defensive feature flag / try-catch in the code that reads the new table, so the code degrades gracefully until the SQL runs; OR
- coordinate with Kevin so he runs the SQL immediately on merge.

The sc-1 silent-gap incident (2026-06-12) is the classic form of this class of failure - see `docs/MIGRATION_PROJECT_CLOSEOUT.md` §E. The sc-9 case is the same pattern in a smaller blast radius.

### Post-close-out sc- silent-gap history (2026-07-11, 2026-07-12) - the discipline broke around the rule

Two more incidents in the same class landed inside 48h. Both are captured here so the pattern is documented outside individual PR bodies.

- **sc-16 (2026-07-11)**: PR #403 landed the sc-16 reader (`SELECT ... has_homestand_schedule ... FROM accounts`) before the sc-16 migration ran in Studio. Every `accounts` SELECT returned 500 - the column didn't exist yet. Revert (PR #404) then reland (PR #406) after Kevin applied the SQL. **This incident triggered the CLAUDE.md rule "Migration-gated PRs open as DRAFT"** so a future migration-dependent PR cannot merge synchronously without Kevin confirming the SQL is applied.

- **sc-17 (2026-07-12)**: same failure class, but this time THROUGH the draft rule. The sc-17 PR opened as DRAFT correctly, but was flipped to ready-for-review and merged before the SQL had rolled in Studio. The draft state is discipline - flipping it is a one-click action; there's no mechanical check that the SQL is applied before the PR becomes mergeable.

**Migration gate SHIPPED (2026-07-12, PR #416)**: `.github/workflows/migration-gate.yml` emits a `Migration gate` status check on every PR. Job A (`pull_request`) diffs against the merge-base for added `docs/migrations/*.sql` - none -> pass instantly (common case, zero friction); any -> FAIL with a summary listing the files + the canonical confirmation phrase. Job B (`issue_comment`) matches any comment containing `applied in Studio: YES` from `author_association == 'OWNER'`, resolves the PR head SHA, and emits a `Migration gate` check_run as success on that SHA via the Checks API. Per-SHA reset: any subsequent push re-runs the scan on the new head, so a confirmation never outlives the code it confirmed. Once Kevin adds `Migration gate` as a required status check on the `main protection` ruleset, migration-bearing PRs are mechanically unmergeable until the canonical confirmation fires - flip-and-merge is dead as a failure class.

**Lesson**: a rule that depends on a single flip is a rule that will break exactly when it matters. Turn the check into something the CI can enforce.

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