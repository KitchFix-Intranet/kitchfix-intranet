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

### Tailwind is imported but is NOT the system

`globals.css` imports Tailwind v4 as a utility backstop. The primary styling system is vanilla CSS with prefix-isolated classes. Don't write Tailwind-first components - they break the prefix-isolation guarantee and create a mixed system.

---

## Captain's log

*Add new entries here, dated, with symptom and fix.*

- **2026-05-05** - Initial gotchas captured from working memory: currency parsing, UTC dates, em-dashes, AI reliability ceiling, React inner components, str_replace whitespace, file moves, Drive auth boundary, prefix collisions.
- **2026-05-05** - Date helper note trimmed to a pointer to `CONVENTIONS.md` (the centralization rule lives there; this doc just flags the symptom).

- **2026-05-13** - Auth state from `storageState` is environment-scoped. NextAuth session cookies are domain-locked to the URL where login happened - a `user.json` generated against `localhost:3000` does NOT work when tests target `kitchfix-intranet.vercel.app`. The browser refuses to send cookies cross-domain, NextAuth sees no session, middleware bounces to `/login`. **Fix:** regenerate `tests/.auth/user.json` against the target environment using `PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app npm run test:e2e:setup -- --headed`. Cost: 30 minutes of CI failure debugging before realizing cookie domain was the issue. See `docs/TESTING.md` "Refreshing the auth state secret" for the full procedure.
- **2026-05-13** - Three new entries from Phase 1 push day: (1) Drive API + shared drives requires `supportsAllDrives: true` - found while building `/api/cron/backup-sheets`. (2) `SHEET_IDS.INVENTORY` is an empty string footgun - real ID resolves from env var. (3) New "Git & Workflow" section with `git checkout -b` silent-failure recovery - committed to main by accident mid-bump, ~10 min recovery.