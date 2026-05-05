# Gotchas — KitchFix Ops Hub

> **Purpose:** Hard-won lessons from building this system. Every entry is a real bug or pitfall that has already cost time. Read before debugging anything that smells familiar.
>
> **Last verified:** 2026-05-05
> **How to add to this list:** When you spend more than an hour on a problem and the cause is non-obvious, add the lesson here. Date the entry and describe the symptom + fix.

---

## Data & Sheets

### Currency values from Sheets are strings, not numbers

Google Sheets returns currency as `"$20,309.00"` — a string with a `$` and commas. Doing arithmetic on it silently produces `NaN`.

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

### Vercel runs in UTC — date comparisons need normalization

Date comparisons that work locally fail in production because Vercel's UTC offset shifts day boundaries.

**Fix:** Normalize to start-of-day or end-of-day before comparing.

```javascript
const start = new Date(period.startDate);
start.setHours(0, 0, 0, 0);

const end = new Date(period.endDate);
end.setHours(23, 59, 59, 999);

if (eventDate >= start && eventDate <= end) { /* ... */ }
```

This bug shows up as "the period boundary cron sometimes catches things and sometimes doesn't" — classic timezone-edge symptom.

### Date helpers are duplicated across 10+ files

`formatDate`, `fmt`, `parseDate` are redefined in many files. See `CONVENTIONS.md` for the centralization rule (new code adds to `opsUtils.js`; existing duplicates migrate opportunistically).

---

## Email & Notifications

### Em-dashes in email subjects break encoding

Subject lines with `—` (em-dash) produce encoding artifacts in some email clients — the recipient sees `=?UTF-8?...` garbage in the subject.

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

Claude OCR is reliable for vendor identification (matching against a known vendor list). It is **unreliable** for extracting structured numeric fields — invoice number, invoice date, totals.

**Rule:** Always require manual entry for invoice number, date, and total. Treat AI extraction of these as a *suggestion to verify*, not a value to trust. Surface the AI confidence visibly.

### AI calls are slow — design for it

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

Dragging a file in the VS Code explorer triggers automatic import-path updates that frequently miss cases — `../utils` becomes `./utils` cleanly, but cross-folder moves often break.

**Fix:** Use `mv` in the terminal, then `rm -rf .next` before `npm run dev` to clear Next.js's cached module graph.

```bash
mv src/components/old/Thing.js src/components/new/Thing.js
# manually update imports
rm -rf .next
npm run dev
```

### `rm -rf .next && npm run dev` is the rebuild incantation

When something is "stuck" — old code running, hot reload not picking up changes, weird import errors — clear the `.next` cache before suspecting a deeper bug. 80% of "this should work but doesn't" turns out to be stale build cache.

---

## Auth & Permissions

### User OAuth tokens for Drive uploads is a security bug

If you use a user's OAuth token to upload a file to Drive, the upload only works if that user has Drive access to the target folder. In a multi-user system this means invoices uploaded by a chef and invoices uploaded by a director can land in different places, depending on who has what permission.

**Fix:** All Drive uploads use the service account. Always. There is no exception.

```javascript
// WRONG — uses user token
await drive.files.create({ auth: userOAuth, ... });

// RIGHT — uses service account (helper handles auth internally)
await uploadInvoiceImage(serviceAccountClient, ...);
```

### Token refresh sometimes returns a new refresh token, sometimes doesn't

Google's OAuth refresh response *may* include a new `refresh_token`, or it may not. The auth code in `src/lib/auth.js` handles this:

```javascript
refreshToken: refreshed.refresh_token ?? token.refreshToken,
```

If a user's session goes weird ("RefreshTokenError"), this is usually the cause. They should sign out and sign back in to re-issue both tokens.

---

## CSS

### Module prefix collisions are real — `oh-inv-` vs `oh-inv-mgmt-`

Two Ops Hub modules — Inventory (legacy) and Invoice Capture — both use the `oh-inv-` prefix. The newer Inventory Manager uses `oh-inv-mgmt-`. When working in any of these three, double-check which file your CSS is going into and whether your class name collides.

**Fix when adding new prefixes:** Make them clearly distinct (`oh-inv-mgmt-` not just `oh-im-`). Prefix collisions cause hard-to-debug visual bugs because the wrong module's styles win specificity battles.

### Tailwind is imported but is NOT the system

`globals.css` imports Tailwind v4 as a utility backstop. The primary styling system is vanilla CSS with prefix-isolated classes. Don't write Tailwind-first components — they break the prefix-isolation guarantee and create a mixed system.

---

## Captain's log

*Add new entries here, dated, with symptom and fix.*

- **2026-05-05** — Initial gotchas captured from working memory: currency parsing, UTC dates, em-dashes, AI reliability ceiling, React inner components, str_replace whitespace, file moves, Drive auth boundary, prefix collisions.
- **2026-05-05** — Date helper note trimmed to a pointer to `CONVENTIONS.md` (the centralization rule lives there; this doc just flags the symptom).