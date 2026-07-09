# Service Calendar - Section 3 audit (submissions + confirmations)

Read-only investigation against `origin/main @ 406e55c`. Findings only. No code changed.

Prefixes: `src/app/service-calendar/` shortened to `sc/`, `src/lib/dataStore/` shortened to `ds/`, `src/app/api/service-calendar/` shortened to `api/`.

---

## Part A - primary findings

### A1 (SC-051) - three totals for one save, and which is "true"

There are **three independent code paths** producing the four totals Kevin observed. Two share a source; two others each have their own math.

| # | Total | Source | Formula | Rounding | Fmt util |
|---|---|---|---|---|---|
| a | Bulk review header ($21,490) | `day.totals.projectedRevenue` from view `sc_daily_revenue` (per-day, pre-computed with **`price_at_date`** = effective-dated price) | `totRev += day.totals.projectedRevenue` across selected days | `Math.round` once on the aggregate | inline `fmt$` at `sc/ServiceCalendar.js:1647` (rounds whole $) |
| b | Bulk review per-row ($3,582 x 6) | Same as (a): `day.totals.projectedRevenue` per day | `r = day.totals.projectedRevenue` (single day) | `Math.round` **per day** | Same inline `fmt$`, called per row at `sc/ServiceCalendar.js:1695` |
| c | Post-save toast ($21,483.00) | **Recomputed client-side** from `data.serviceGroups[s].price` = **current catalog projected price** | `computeMealsAmount(entries)` = `sum(entry.value x priceByCol[colIndex])` at `sc/ServiceCalendar.js:801-816`, accumulated at `sc/ServiceCalendar.js:940-941` (bulk) | 2 dp via `Number.toLocaleString({min:2,max:2})` at `sc/season/SubmissionToast.js:5` | `fmt$` in `SubmissionToast.js` (with cents) |
| d | Week card (~$21,490) | Same as (a): `wm.projRev` accumulates `day.totals.projectedRevenue` at `sc/season/PeriodWorkspace.js:888-890`, prefixed `~` when actuals absent | `Math.round` once on the aggregate | Workspace `fmt$` |

**Where they diverge:**

- **(a) vs (b) is aggregate-vs-per-day rounding** on the SAME source. Per-day values are floats around `3,581.67`; six of them sum to `21,490.02` (header rounds down to `21,490`), while each one rounds up to `3,582` and the visible six-line sum reads `21,492`. Trivially fixable by aligning display: either round both places to whole $ and let the row sum equal the header, or show cents in the review.
- **(a) vs (c) is a different price source.** The view's `projected_revenue` is `projected_count x price_at_date` (effective-dated per row). The toast's `totalAmount` is `projected_count x data.serviceGroups[s].price` = the **current** catalog price loaded via `.eq("price_kind", "projected")` for the account (`ds/serviceCalendar.js:335, 480`). If today's catalog price differs from the price effective on the projection's date - which is exactly what price change events produce - the numbers drift. Kevin's $21,490 vs $21,483 = $7 over 6 days = ~$1.17/day, consistent with a small effective-dated / current split.
- **(a) vs (d) share source** and should always match on the same set of days.

**Which is the TRUE saved value?**

**None of them.** The server writes `actualCount` per (service, day) row (`api/route.js:571-590` -> `saveActuals` in `ds/serviceCalendar.js:1200`). The server does NOT store a total anywhere. Every dollar the operator sees is derived, and after the "Match projections" write, the **retroactively true** total (that the view will show on the next reload) is:

```
sum over (service, day) of actual_count x price_at_date
```

which is (a) again, not (c). The toast's $21,483 is a client-side re-estimate using current prices - honest enough for a momentum nudge, but it is NOT what `actual_revenue` will read as the moment the chef reloads.

**Single-day path ($3,947 vs $3,947.22):**

- Review total (`sc/DayDetail.js:135-141`, printed line 354): client-side `summary.revenue = sum(getVal x s.price)` from `data.serviceGroups`. Same current-catalog source as (c).
- Toast: same `computeMealsAmount(entries)` -> current-catalog source, with cents formatting (2 dp).

Same math, different display precision - review rounds via `fmt$` (whole $), toast shows cents. The **dollars** cannot fork on the same day at the same price, only the cents display. If the dollars fork, price_at_date differs from current catalog price for that service - a real signal, not a rounding artifact.

`sc/DayDetail.js:8` `fmt$` = `"$" + Math.round(n).toLocaleString("en-US")`
`sc/season/SubmissionToast.js:5` `fmt$` = `"$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })`

### A2 (SC-055) - in-flight guard on the money write

**Double-click:** PRESENT via `disabled={saving}` on all four primary buttons.

- Single-day "Confirm & save" (review overlay): `sc/DayDetail.js:393` - `disabled={saving}`, label switches to `"Saving..."`.
- Bulk entry "Save to N days": `sc/ServiceCalendar.js:1620` - `disabled={saving}`.
- Bulk review "Confirm & save" (match-projections path): `sc/ServiceCalendar.js:1707` - `disabled={saving}`.
- Confirm-as-projected single-day path (external caller): `saving` prop threaded through DayDetail.

`saving` is set by `setSaving(true)` at `sc/ServiceCalendar.js:841, 876, 916, 973` before the fetch, `setSaving(false)` in `finally`. The setter is synchronous so a rapid second click after the first paint cannot re-enter.

**Abort / unmount guard:** ABSENT. There is no `AbortController` on the save fetch, no cleanup effect that flips `saving` on unmount, and no ref-guard around `setToast` after resolve. If the operator navigates away or closes the overlay mid-write, the `fetch` still resolves and still calls `showToast(...)` on an unmounted parent. React 19 warns; nothing breaks in prod. Fix cost: one AbortController per handler + a `if (!mounted) return` gate around post-fetch state.

**Sequential-write bulk safety:** `handleBulkSave` and `handleBulkConfirm` run POSTs sequentially in a for-loop (`sc/ServiceCalendar.js:923-943`, `978-999`). No batching. Each individual POST is guarded by the disabled button, but a mid-loop close does NOT abort - the loop keeps firing. Same fix (AbortSignal threaded into the loop).

### A3 (SC-056) - empty-save gate

**PRESENT and belt-and-suspenders.**

- DayDetail "Review & save" button: `disabled={!hasTouchedAny || saving}` at `sc/DayDetail.js:569`. The operator cannot even OPEN the review overlay at 0-of-N entered.
- `executeSave` in DayDetail: after building `entries[]`, `if (entries.length === 0) { setShowReview(null); return; }` at `sc/DayDetail.js:180-183`. Defense in depth - if review were somehow entered with no touched services, no POST fires.
- Server: `api/route.js:573` rejects `!entries?.length` with `400 "Missing required fields"`.

Bulk entry path: `if (entries.length === 0) { showToast("Enter at least one value before bulk saving", "error"); return; }` at `sc/ServiceCalendar.js:912-915`. Same gate. `handleBulkConfirm` (match-projections) does not check emptiness because it hydrates entries from `day.projected` for EVERY selected day - so entries.length is always > 0 when `bulkSelected.size > 0`.

### A4 (SC-053) - day-notes lifecycle

**Notes are BLACK-HOLED.** Chef types, closes, gone.

- UI: `[notes, setNotes] = useState("")` at `sc/DayDetail.js:40`, textarea at `sc/DayDetail.js:560-564`, reset to `""` on day change at `sc/DayDetail.js:66`.
- Wire: `onSave(day, entries)` at `sc/DayDetail.js:187` - `notes` is NOT included in the payload. Same at `sc/ServiceCalendar.js:846` - the fetch body is `{ action, accountKey, date, entries }`.
- Server: `api/route.js:572-589` reads `entries`, calls `saveActuals(accountKey, date, touched, email)`. The `saveActuals` signature (`ds/serviceCalendar.js:41`) is `(accountKey, serviceDate, entries, email)` - no notes parameter, no notes write.
- DB schema: `sc_day_metadata.day_notes` column EXISTS (read at `ds/serviceCalendar.js:690` -> `dayNotes: r.day_notes || null`). But no code path in `src/` writes to `day_notes` from the DayDetail UI. Grep for `day_notes\|dayNotes` in src returns only READ paths + the read-only field in the load response.
- Review overlay: the review does not surface the notes textarea either, so the operator has no cue that what they typed just evaporated.
- Reopen: `setNotes("")` on `day.date` change (`sc/DayDetail.js:66`) - even if the DB row had notes, the textarea would start empty on every open.

Verdict: severe data-loss vector. The textarea is a UI-only placeholder; the column is read but never written from the UI.

### A5 (SC-054) - delta availability at review

**Data IS available. UI does NOT render deltas.**

- Review overlay renders `getVal(sv.colIndex)` (the entered value) at `sc/DayDetail.js:382` and the per-group subtotal (`gs.meals`, `gs.revenue`) at `sc/DayDetail.js:385`.
- `day.projected` is still in scope (DayDetail prop, `sc/DayDetail.js:29`) throughout the review render. `getVal` sees the same `editValues`. The entry-row delta calc at `sc/DayDetail.js:294` (`delta = numVal - projVal`) uses only inputs available in review.
- To render deltas in review: copy the `sc/DayDetail.js:314-326` chip block into `sc/DayDetail.js:379-384`. Zero extra data plumbing.

Fix cost: low (one JSX block, no state changes).

### A6 (SC-052) - header total semantics + the $2,708 / $2,709 drift

**Header total does switch projection -> actuals** and the switch is instantaneous on first keystroke.

- `sc/DayDetail.js:458` - class flips on `hasTouchedAny` (`touched.size > 0`).
- Amount reads `fmt$(footerDisplay.revenue)`. `footerDisplay` at `sc/DayDetail.js:149-160`: `v = touched.has(colIndex) ? getVal(colIndex) : (day.projected[colIndex] ?? 0)`. So the total is a running mix of "entered" (touched) + "projected" (untouched) rows - it doesn't reset to zero.
- Visual distinction between the two states:
  - Projected: `.sc-day-sb-amount--projected { color: var(--scoreboard-text-muted); }` = `--navy-100` = `#D1DAE6` (light gray on navy).
  - Recorded: `.sc-day-sb-amount--recorded { color: var(--scoreboard-text); }` = white.
- `sc/DayDetail.js:116-124` in `dayDetail.css`.

**No `~` prefix, no "PROJECTED" chip, no tooltip.** Pre-entry, the operator reads `$2,709` in muted white - the only "this is a forecast" cue is the color shift. Not accessible via SR (both colors serialize as the same text node), not accessible via colorblind check. If the SC-052 ruling is "the number should carry a marker" - yes, add one; the code path is a single conditional at `sc/DayDetail.js:458-460`.

**$2,708 rail vs $2,709 modal:** two different source rows for the same day.

- Rail (Period workspace tile or aggregate): reads `day.totals.projectedRevenue` from the view (`ds/serviceCalendar.js:706`) = `sum(projected_count x price_at_date)`. Rounded once. Prefixed `~` in tile render at `sc/season/PeriodWorkspace.js:465`.
- Modal header (`footerDisplay.revenue`): CLIENT-computed `sum(projected_count x data.serviceGroups[s].price)`. `data.serviceGroups[s].price` is the CURRENT catalog projected price for that service (`ds/serviceCalendar.js:335`).

Same math on paper - `count x price`. Different price snapshot in practice: rail uses effective-dated `price_at_date`; modal uses current catalog `price`. Any price change since the projection was recorded will drift these apart. $1 across a full day = ~40-60c per service on 3 services = cents at typical rates.

**Not a rounding bug. A price-source-mismatch bug.** Verdict: the two figures should read from the same source. Cheapest fix: switch the modal footer to read `day.totals.projectedRevenue` for the untouched-services portion, keep the client recompute only for touched entries. Or: recompute both from the same catalog snapshot with `Math.round` at the end.

### A7 (SC-059 + SC-061) - measured contrast (WCAG AA vs 4.5:1)

Node throwaway on the token values; ratios rounded to 2 dp.

| Pair | fg | bg | Ratio | Verdict |
|---|---|---|---|---|
| Ghost input placeholder (--text-subtle on --surface-sunken) | `#94A3B8` | `#FAF9F5` | **2.43** | **FAIL** |
| Notes textarea placeholder (--text-subtle on --surface-card) | `#94A3B8` | `#FFFFFF` | **2.56** | **FAIL** |
| Delta-big amber (--feedback-warning on white) | `#D97706` | `#FFFFFF` | **3.19** | FAIL for normal text; PASS for >=18px |
| Delta-minor (--text-subtle on white) | `#94A3B8` | `#FFFFFF` | **2.56** | **FAIL** |
| Cancel button rest (--text-subtle on surface-card) | `#94A3B8` | `#FFFFFF` | **2.56** | **FAIL** |
| Cancel button hover (--text-muted on --surface-sunken) | `#64748B` | `#FAF9F5` | 4.52 | PASS |
| Group price line (--text-muted on white) sanity | `#64748B` | `#FFFFFF` | 4.76 | PASS |
| Toast headline (white on --accent-sc) | `#FFFFFF` | `#0F6E56` | 6.20 | PASS |
| Toast meta (rgba(255,255,255,.85) on --accent-sc-dark) | `#D9D9D9` | `#085041` | 6.66 | PASS |
| Toast bar-fill (--mint-300 on gradient midpoint) | `#7FD3B4` | `#0B5F4C` | 4.31 | PASS for large; FAIL for normal (bar is large by definition) |

Note on delta-chip font size: `.sc-day-row-delta { font-size: var(--size-caption); }` = 12px (from `tokens.css:33`). 12px @ semibold is NOT WCAG "large" (>=18px normal or >=14px bold). So the amber `#D97706` delta at 3.19:1 is a **normal-text FAIL**.

`--text-subtle` (#94A3B8) is a systemic contrast miss - it's failing across placeholder, delta-minor, and cancel-rest. Any UI copy that consumes `--text-subtle` on light surfaces fails 4.5:1. Ledger candidate: bump `--text-subtle` to `--n-600` (`#64748B`, PASS at 4.5:1+) or add a body-text-only alias.

### A8 (SC-060) - modal + toast a11y inventory

**DayDetail entry / review / success (shared `.sc-overlay-card` wrapper):**

- Focus trap: **YES** via `useDialogA11y` hook at `sc/ServiceCalendar.js:1050`. Hook binds `keydown` for Tab/Shift+Tab containment (`sc/useDialogA11y.js:87-93`).
- Escape handling: **YES** at `sc/useDialogA11y.js:62-65`. Esc calls `onClose` = `setFocusDay(null)`. **DISCARDS SILENTLY** mid-entry - there is no "unsaved changes" prompt, no re-focus of the primary button, no state check. Chef with 3 of 4 services entered + Esc = 3 entries dropped, silently.
- Backdrop-click close: `sc/ServiceCalendar.js:1572, 1653` on backdrop `onClick` when `e.target === e.currentTarget`. **Also silent discard.**
- Return-focus on close: **YES** at `sc/useDialogA11y.js:44-45, 101-105` (captures `document.activeElement` on open, restores on unmount).
- Initial focus: TWO racers - `useDialogA11y` picks first focusable (`sc/useDialogA11y.js:52-59`, likely nav-Prev or Close button in the header); DayDetail's own `useEffect` at `sc/DayDetail.js:223-230` picks the first `.sc-day-input--ghost`. Both use `requestAnimationFrame`. In practice the ghost-input focus wins (later frame, or DOM order) - the operator lands on the first empty ghost input, which is the intended target. Fragile - relies on browser scheduling order.
- `role="dialog"` + `aria-modal="true"`: **YES** at `sc/ServiceCalendar.js:1577-1580, 1658-1661` on `.sc-overlay-card`.
- `aria-labelledby`: **YES** - `"sc-day-detail-title"` for day overlay (matches `sc/DayDetail.js:435`), `"sc-day-bulk-title"` for bulk entry, `"sc-bulk-review-title"` for bulk review.
- `aria-live` on "N of M entered" counter: **YES** at `sc/DayDetail.js:465-471` (`aria-live="polite"`).
- Review overlay is a state switch INSIDE the same DayDetail render (`sc/DayDetail.js:340-399`) - inherits the outer dialog wrapper but does NOT re-focus the new primary button ("Confirm & save"). Focus stays wherever it was (usually still on "Review & save" which has just unmounted - focus may end up on `document.body`). Minor a11y regression at state transitions.
- Success screen: same story - `sc/DayDetail.js:403-427` renders without focus management, no `aria-live`, no `role="status"`. Chef with SR gets no "recorded" announcement from the success view itself (the toast provides the announce, see below).

**SubmissionToast:**

- `role="status"` + `aria-live="polite"`: YES at `sc/season/SubmissionToast.js:27-28`.
- Auto-dismiss: 4500ms for "recorded" variant, 3500ms for plain (`sc/page.js:27, 30`).
- Manually dismissable: **NO** - no close button, no click-to-dismiss. The card is a passive announcer.
- Pointer events on grid beneath: `.oh-toast-container` (`ops-shared.css:461`) has NO `pointer-events: none`. Container is `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)` (with `--sc-center` modifier) and sized by its content (~320-420px wide, ~100px tall). Clicks within the toast footprint - the exact center of the viewport - are absorbed by the container / toast card. Grid tiles below the centered card are unclickable for the 4.5s toast lifetime. Not a full-viewport blocker; a rectangular ~420x100 dead zone at center-viewport.

**Bulk entry / bulk review overlays:** same `useDialogA11y` contract, same Esc-silent-discard, same backdrop-click-silent-discard.

### A9 (SC-058) - the double-PDC header

Group-price line composed as `{accountSegment} · {price}` in TWO places:

- Entry state: `sc/DayDetail.js:505-509`.
- Review state: `sc/DayDetail.js:373-377`.

Both read `accountSegment` from props (`sc/DayDetail.js:29`).

Passed by parent: `sc/ServiceCalendar.js:1561` -> `accountSegment={acctObj?.category || ""}`. `category` is the account's PG-side category field (per `sc/ServiceCalendar.js:1055` and account-load response, sorted at `sc/ServiceCalendar.js:283`).

**Where does the second "PDC" come from?** The group NAME itself. `data.serviceGroups[g].name` comes from PG `sc_service_groups.group_name` (`ds/serviceCalendar.js:294, 534, 690, 698`). For TBJ-FL (and any PDC-suffixed group), the DB has group names like `"Minor League - PDC"`. Render is then:

- Group-name span: `"Minor League - PDC"` at `sc/DayDetail.js:504`.
- Immediately-adjacent group-price span: `"PDC · $11.55/meal"` at `sc/DayDetail.js:505-509`.

Same line visually (both inside `.sc-day-group-header` = flexbox row per `dayDetail.css`). Result: `"Minor League - PDC · PDC · $11.55/meal"` reads as PDC-PDC.

Which accounts carry the suffix in the group name is a data question - grep of code shows no code composes `- PDC` into group.name at read time. The suffix lives in DB rows (`sc_service_groups.group_name`). Fix options: (a) strip the trailing `- SEGMENT` from group.name at render time if it duplicates `accountSegment`; (b) drop `{accountSegment}` from the price line when group.name already ends with it; (c) canonical: clean the DB rows.

### A10 (SC-062) - the "Enter custom values" bulk path

Two distinct bulk paths, both live in the bulk-mode affordance at `sc/season/PeriodWorkspace.js:180-200` (rendered inside `WorkspaceBulkBar`).

Wiring in ServiceCalendar (`sc/ServiceCalendar.js:1460-1502`):

| Prop | Meaning | Handler |
|---|---|---|
| `onBulkOpenPanel` | Open the multi-day custom-entry sheet | `() => setBulkPanelOpen(true)` -> renders the bulk-entry overlay at `sc/ServiceCalendar.js:1571-1628` |
| `onBulkReview` | Open "Match projections" review overlay | `() => setBulkReviewOpen(true)` -> renders at `sc/ServiceCalendar.js:1634-1718` |
| `onBulkConfirmAsProjected` | Legacy shortcut, no review | `handleBulkConfirm` at `sc/ServiceCalendar.js:971-1020` |
| `onBulkCancel` | Exit bulk mode | Clears `bulkMode`, `bulkSelected`, both panel flags |

The **"Enter custom values"** button text lives at `sc/season/PeriodWorkspace.js:596` inside the workspace-day bulk header - it opens the ONE-form panel via `onBulkOpenPanel`.

**Flow of the custom-entry path:**

1. User is in bulk mode, has selected N days via `bulkSelected: Set<dateISO>`.
2. Click "Enter custom values" -> `bulkPanelOpen = true`.
3. Overlay at `sc/ServiceCalendar.js:1571-1628` renders:
   - Header: `"Bulk entry — {N} days"` (uses em-dash literal at line 1585 - **candidate finding**, no-em-dashes policy)
   - Coaching: `"Enter values once, apply to all N selected days."`
   - Body: iterates `data.serviceGroups`, one input per service. Placeholder `"0"` (all rows), one shared value applied to every selected day per service.
   - Footer: Cancel + `"Save to N days"`.
4. Click "Save to N days" -> `handleBulkSave` at `sc/ServiceCalendar.js:898-968`:
   - Builds ONE `entries[]` from typed values (skips empty), guards `if (entries.length === 0)`.
   - Loops `bulkSelected`, POSTs `entries` per day (same payload each day).
   - `computeMealsAmount(entries)` runs once outside the loop; sums accumulate `perDay.meals x N`, `perDay.amount x N`.
   - Toast: `showToast(buildRecordedToast({ amount, meals, newlyEntered, isBulk: true, bulkDays: successCount }))`.

**Not sequenced DayDetails.** It's a single-form multi-day writer that fans out the same values across N days. **Not a bulk review step either** - "Enter custom values" writes directly on click; no review overlay before the write. That asymmetry (Match-projections has a review; Custom-values does not) is worth flagging when the fix phase looks at these paths together.

---

## Part B - fix-phase mapping

### B1 - file map

| Surface | File | Anchor |
|---|---|---|
| Day entry rows + review + success (component) | `sc/DayDetail.js` | 29-577 |
| Day save handler | `sc/ServiceCalendar.js` | 839-871 (`handleSave`) |
| Day confirm-as-projected | `sc/ServiceCalendar.js` | 873-895 |
| Bulk custom-entry overlay JSX | `sc/ServiceCalendar.js` | 1571-1628 |
| Bulk custom-entry save handler | `sc/ServiceCalendar.js` | 898-968 (`handleBulkSave`) |
| Bulk match-projections review overlay JSX | `sc/ServiceCalendar.js` | 1634-1718 |
| Bulk match-projections confirm handler | `sc/ServiceCalendar.js` | 971-1020 (`handleBulkConfirm`) |
| Bulk affordance (bar / triggers) | `sc/season/PeriodWorkspace.js` | 180-200; button copy line 596 |
| Toast render (rich variant) | `sc/season/SubmissionToast.js` | full file |
| Toast host + dismiss timer | `sc/page.js` | 21-32, 135-143 |
| Toast headline copy | `sc/season/submissionMessages.js` | `pickHeadline` (line 39) |
| Toast CSS (green card + progress) | `sc/submissionToast.css` | full file |
| Dialog a11y hook | `sc/useDialogA11y.js` | full file |
| Money math (client recompute) | `sc/ServiceCalendar.js` | 801-834 (`computeMealsAmount`, `buildRecordedToast`) |
| Money math (view-side pre-computed) | `ds/serviceCalendar.js` | 690-753 (per-day totals from `sc_daily_revenue`) |
| Server save action | `api/route.js` | 570-590 (`sc-submit-day`) -> `ds/serviceCalendar.js:1200` (`saveActuals`) |

### B2 - server save payload + response shape

**Request** (`sc-submit-day`):
```json
{ "action": "sc-submit-day",
  "accountKey": "TBJ-FL",
  "date": "2026-07-08",
  "entries": [ { "colIndex": "<service-uuid>", "value": 123 } ] }
```

**Server-side translation** at `api/route.js:584-587`:
```js
const touched = entries.map(e => ({ serviceId: e.colIndex, actualCount: Number(e.value) || 0 }));
const result = await saveActuals(accountKey, date, touched, email);
return NextResponse.json(result);
```

**Response shape**: whatever `saveActuals` returns. Grep of `saveActualsPostgres` at `ds/serviceCalendar.js:1153-1179` shows it does not return a `revenue` field - just success/error info. So **the toast has nothing to echo from the server** and MUST recompute client-side. Any fix that wants the toast to show the "true" saved dollars would need to change the return of `saveActualsPostgres` to include `{ meals, revenue }` computed via the same view snapshot the header reads from - or, cheapest, return `{ actualRevenue: sum(actual_count x price_at_date) }` per this write's rows.

### B3 - shared fmt utility?

**NO shared `fmt$`.** Three separate implementations:

- `sc/DayDetail.js:8` - `"$" + Math.round(n).toLocaleString("en-US")` (whole dollars).
- Inline `fmt$` at `sc/ServiceCalendar.js:1647` (in bulk-review IIFE) - same formula as DayDetail's.
- `sc/season/SubmissionToast.js:5` - `.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })` (cents).
- `sc/season/PeriodWorkspace.js` also has its own `fmt$` (found via multiple `fmt$` call sites; separate closure).

Fix cost: extract one shared util in `sc/season/format.js` (or existing `sc/` helper), thread precision as a parameter. Low.

---

## Flags

- **CANDIDATE**: Header dollar (`day.totals.projectedRevenue`) and toast dollar (`computeMealsAmount` with current catalog price) read from **different price snapshots**. Drift is silent and directional (any post-projection price change moves them apart). Single-source-of-truth pass needed. `sc/ServiceCalendar.js:801-816, 1647-1695` vs `ds/serviceCalendar.js:704-706`.
- **CANDIDATE**: Bulk review per-row rounds per-day, header rounds aggregate; the visible $2 mismatch is a rounding-display artifact only. Align by picking one rounding site.
- **CANDIDATE**: Day-notes textarea is orphaned. No wire, no persistence, resets on every open. `sc/DayDetail.js:40, 66, 560-564, 187`.
- **CANDIDATE**: No `AbortController` on any save fetch; mid-flight overlay-close still resolves and toasts on unmounted parent. `sc/ServiceCalendar.js:839-1020`.
- **CANDIDATE**: Esc + backdrop-click both silently discard mid-entry with no unsaved-changes prompt. `sc/useDialogA11y.js:62-65`; `sc/ServiceCalendar.js:1572, 1653`.
- **CANDIDATE**: Review overlay does not surface delta chips despite having the data. `sc/DayDetail.js:379-384`.
- **CANDIDATE**: `--text-subtle` (`#94A3B8`) fails WCAG AA 4.5:1 across placeholder, delta-minor, and cancel-rest on light surfaces. Systemic token issue, not per-component.
- **CANDIDATE**: Delta-big amber `#D97706` on white is 3.19:1 at 12px caption size - normal-text FAIL (passes only if the chip is upsized to >=14px bold or the color darkened).
- **CANDIDATE**: Toast container has no `pointer-events: none`; centered card blocks clicks on grid tiles beneath its footprint for 4.5s. `ops-shared.css:461`.
- **CANDIDATE**: DayDetail state transitions (entry -> review -> success) do not move focus to the new primary button; SR / keyboard users lose their place.
- **CANDIDATE**: Success screen has no `role="status"` / `aria-live`; only the toast announces success. `sc/DayDetail.js:403-427`.
- **CANDIDATE**: Group-price line composes `{accountSegment} · {price}` on TOP of a group name that already carries the segment suffix, producing "PDC · PDC" for TBJ-FL groups. Data-side or render-side dedupe. `sc/DayDetail.js:505-509, 373-377`.
- **CANDIDATE**: Toast not manually dismissable (no close button). Auto-dismiss at 4.5s only. `sc/season/SubmissionToast.js` + `sc/page.js:27`.
- **CANDIDATE**: Bulk entry overlay header `"Bulk entry — {N} days"` at `sc/ServiceCalendar.js:1585` uses em-dash - violates no-em-dashes policy.
- **CANDIDATE**: "Enter custom values" writes directly without a review step, while "Match projections" goes through a review overlay. Asymmetry worth flagging when the fix phase groups these paths.
