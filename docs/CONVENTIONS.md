# Conventions — KitchFix Ops Hub

> **Purpose:** The non-obvious rules a contributor (human or AI) must follow to stay consistent with the existing codebase. If you're tempted to invent a new pattern, check here first.
>
> **Last verified:** 2026-05-05
> **Refresh cadence:** When a convention changes or a new one emerges

---

## API routes use action-dispatch, not REST

**The pattern.** Each module has a single route file (`src/app/api/{module}/route.js`) with one `GET` (and sometimes `POST`) handler. The handler reads `?action=...` from the query string and dispatches to logic blocks.

```javascript
const action = searchParams.get("action") || "bootstrap";

if (action === "bootstrap") { /* ... */ }
if (action === "history")   { /* ... */ }
if (action === "submit-paf") { /* ... */ }
// ...19+ more
```

**Don't invent REST endpoints.** Adding a new feature means adding a new `if (action === "...")` block, not creating `/api/people/paf/submit`. The action-dispatch pattern keeps:
- One file to find all module endpoints
- Shared imports, constants, and helpers in scope without re-importing
- A single auth check at the top of the handler
- The Sheet column index objects (`SUB`, `INCIDENT_COLUMNS`, etc.) defined once

**When to break the pattern.** Sub-routes like `/api/ops/inventory` exist when a sub-domain has enough actions to warrant its own file (~20+ actions or a clearly separable concern). If you find yourself adding the 25th action to a route file, consider splitting.

**Action naming.** Hyphenated lowercase: `submit-paf`, `mark-notification-read`, `admin-queue-closed`. Verb-first when the action mutates, noun-first when it reads (`history`, `library-list`).

---

## Service account for writes, user OAuth for identity

| Operation | Use |
|---|---|
| Reading sheets that need user permission | User OAuth (`readSheet(accessToken, ...)`) |
| Reading sheets the app needs regardless of user | Service account (`readSheetSA(...)`) |
| Writing to any sheet | **Always service account** (`appendRowSA`, `updateRangeSA`) |
| Uploading to Drive | **Always service account** |
| Sending email as the user | User OAuth (Gmail API) |
| Identifying the user | Session from `auth()` |

Functions ending in `SA` use the service account. Functions taking `accessToken` use user OAuth.

**Never** mix paths in a single feature flow without a clear reason. A submit-and-upload flow uses service account for both the sheet write and the Drive upload.

---

## Where files go

### Library helpers
`src/lib/{thing}.js`

One file per concern. Examples that work:
- `sheets.js` — all Sheets API calls
- `drive.js` — all Drive operations
- `opsUtils.js` — shared utilities (parseNum, formatCurrency, account/period helpers, Slack posting)
- `{module}Actions.js` — business logic for a single module (`incidentActions.js`, `invoiceActions.js`, `inventoryActions.js`)
- `{module}Schema.js` — column definitions, type constants, status flows (`incidentSchema.js`)

### API routes
`src/app/api/{module}/route.js`

One route file per module. Sub-routes only when a sub-domain warrants its own file.

### Components

**Current state — there are two patterns.** This is documented drift, not necessarily a final rule:

- `src/components/{module}/Component.js` — used for People Portal, Team Directory, Home Dashboard, shared components (TopNav, ProfileModal, WeatherBadge, HelpFAB)
- `src/app/{module}/components/...` — used only for Ops Hub (`src/app/ops/components/{tool}/Component.js`)

**Default rule going forward:** put new components in `src/components/{module}/` unless they are tightly coupled to a single Ops Hub tool, in which case follow the existing `src/app/ops/components/{tool}/` pattern.

If you have time, consolidating to one location is a P2 polish target.

### CSS
`src/app/{module}/{module}.css` — module-scoped CSS file with prefix-isolated class names.
`src/app/ops/css/ops-{tool}.css` — Ops Hub sub-tool CSS files.
`src/app/globals.css` — root variables, fonts, and Tailwind import. Don't add module-specific styles here.

---

## CSS namespace prefixes

### Module prefixes (intent: strict isolation per module)

| Module | Prefix | CSS file |
|---|---|---|
| People Portal | `pp-` | `src/app/people/people.css` |
| Vendor Portal | `oh-vp-` | `src/app/ops/css/ops-vendor.css` |
| Inventory Manager | `oh-inv-mgmt-` | `src/app/ops/css/ops-inv-mgmt.css` |
| Inventory (legacy) | `oh-inv-` | `src/app/ops/css/ops-inventory.css` |
| Invoice Capture | `oh-inv-` (overlapping — be careful) | `src/app/ops/css/ops-invoice.css` |
| Labor / Season Planner | `oh-sp-` | `src/app/ops/css/ops-labor.css` |
| Executive | `oh-exec-` | `src/app/ops/css/ops-executive.css` |
| Service Calendar | `sc-` | `src/app/service-calendar/ops-sc.css` |
| Team Directory | (Cardinals red theme, no strict prefix yet) | `src/app/directory/directory.css` |
| Analytics | (varies) | `src/app/analytics/analytics.css` |
| News Feed | `kf-news-` | (in component file or globals) |
| Top Nav | (no prefix yet) | `src/components/TopNav.css` |

**Never cross-contaminate module prefixes.** A People Portal component should not use `oh-vp-` classes.

### Shared utility prefixes (deliberately cross modules)

The Ops Hub has a layer of utility classes that are shared across modules by design. These live alongside module CSS and are referenced from any Ops Hub tool that needs them.

| Prefix | Purpose |
|---|---|
| `oh-tool-` | Tool shell scaffolding (toolbar, view, account selector) |
| `oh-btn-` | Button utility variants |
| `oh-modal-` | Modal containers and structure |
| `oh-input-`, `oh-select-` | Form input utilities |
| `oh-popover-` | Popover positioning and chrome |
| `oh-widget-` | Generic widget container |
| `oh-font-` | Typography utilities |
| `oh-grey-`, `oh-mustard-` | Color/state utilities |
| `oh-history-`, `oh-hx-` | History view utilities |
| `oh-spinner` | Loading state utility |

When adding a new shared utility, prefix it `oh-{utility}-` and document it here. Don't reach for a module prefix from another module — promote the pattern to a utility instead.

### Known prefix issues (drift to be aware of)

- **`oh-inv-` collision.** Used by both legacy Inventory and Invoice Capture. New work in either module should be careful — class names can win specificity battles unexpectedly. The newer Inventory Manager uses `oh-inv-mgmt-` to avoid this.
- **Inventory Manager partial adoption.** Only `InventoryManager.js` and `QuickTour.js` use `oh-inv-mgmt-`. Other files in the module (notably `LocationSetup.js`) still use the legacy `oh-inv-` prefix. New files in the Inventory Manager folder should use `oh-inv-mgmt-`; legacy files migrate opportunistically when touched.

---

## Sheet column conventions

### Tab name constants

Define `SHEETS = { ... }` at the top of any route file that touches multiple tabs. Use SCREAMING_SNAKE_CASE keys, lowercase actual tab names:

```javascript
const SHEETS = {
  HERO: "hero_images",
  ACCOUNTS: "accounts",
  SUBMISSIONS: "submissions",
  // ...
};
```

### Column index constants

Define a column index object per tab when you read/write that tab in multiple places. Comment with the column letter:

```javascript
const SUB = {
  TIMESTAMP: 0,    // Col A (0-indexed for row arrays)
  SUBMITTER: 1,    // Col B
  MODULE: 2,       // Col C
  // ...
  // 1-indexed versions for updateCell API
  STATUS_COL: 9,   // Column I (1-indexed)
  NOTES_COL: 10,   // Column J (1-indexed)
};
```

**Two indexing conventions live side by side**: 0-indexed for row array access, 1-indexed for the `updateCell` API. Name them clearly.

### Anchoring `values.append`

Always anchor to `range: "tabname!A:A"` to prevent column-offset bugs when a tab has variable-width rows. This is non-obvious and has burned us before.

---

## Shared utilities — never reinvent

These live in `src/lib/opsUtils.js`. **Never redefine them locally.**

```javascript
parseNum(v)            // "$20,309.00" → 20309 (handles Sheets currency strings)
formatCurrency(v)      // 20309 → "$20,309.00"
generateId(prefix)     // → unique ID with optional prefix
getAccountConfigs()    // accounts from HUB sheet (cached)
getPeriods()           // periods from HUB sheet (cached)
getCurrentPeriod()     // the active period
getAllVendors()        // vendor list (cached)
resolveVendorId(id)    // lookup vendor by ID
opsNotify({ ... })     // standardized email notification
postSlack(url, text)   // Slack webhook POST
cachedRead(...)        // sheet read with caching
batchRead(...)         // multiple sheet reads in parallel
```

**Date helpers are NOT yet centralized.** `formatDate`, `fmt`, `fmtDate`, `parseDate` are redefined in 10+ files. This is drift. **New code should add date helpers to `opsUtils.js`** and existing duplicates should be migrated opportunistically.

---

## Analytics event logging

Every meaningful user action gets logged via `logEventSA()` (or `logEvent()` if a token is on hand).

```javascript
logEventSA({
  email,                    // user email
  userName,                 // user display name
  category: "people",       // auth | ops | people | directory | home | system
  action: "submit_paf",     // verb_object, snake_case
  page: "/people",          // route path
  detail: { ... },          // structured object, JSON-stringified by helper
  durationMs: 234,          // optional, for API timings
  status: "success",        // success | error | warning
});
```

The `category` and `action` strings are not strictly typed but should follow the conventions above. Inconsistency here weakens analytics.

---

## File header style

Library files use a bordered comment block at the top:

```javascript
// ═══════════════════════════════════════════════════════════════
// INCIDENT CENTER - Backend business logic
// ID generation, Drive folder management, Slack notifications,
// tier-based escalation. Imported by app/api/people/route.js
// ═══════════════════════════════════════════════════════════════
```

Use this format for new lib files. Skip for short utility files.

---

## Cron jobs

All cron routes check `CRON_SECRET`:

```javascript
const authHeader = request.headers.get("authorization");
if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

When adding a cron, register the schedule in `vercel.json` and the auth check in the route. Log start and outcome via `logEventSA({ category: "system", action: "cron_start" })` so failures are visible in Analytics.

---

## React patterns

### Never define function components inside another component's render body

```javascript
// WRONG — causes infinite render loops
function Parent() {
  const Inner = () => <div>...</div>;
  return <Inner />;
}

// RIGHT — use a single content variable with if/else
function Parent() {
  let content;
  if (condition) content = <div>A</div>;
  else content = <div>B</div>;
  return content;
}
```

### Memoize derived arrays passed to children

When passing arrays from API config to child components, wrap in `useMemo` to avoid re-render churn. Pattern from `VendorPortal.js`:

```javascript
const accounts = useMemo(() => config?.accounts || [], [config?.accounts]);
```

### Form state lives in the component, drafts persist in Sheets

The People Portal pattern: the wizard has local React state, but partial drafts are saved to the `drafts` tab in the COLLECTION sheet so users don't lose work. New form-heavy modules should follow this pattern.

---

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| File names (JS) | PascalCase for components, camelCase for libs | `IncidentTool.js`, `incidentActions.js` |
| Route folders | kebab-case | `service-calendar` |
| Constants | SCREAMING_SNAKE_CASE | `INCIDENT_TYPES`, `OPS_LEADERSHIP_EMAILS` |
| Action strings | hyphen-lowercase | `submit-paf`, `mark-notification-read` |
| Analytics actions | snake_case | `submit_paf`, `page_view` |
| CSS classes | `{prefix}-component-name` | `pp-action-center`, `oh-vp-card` |
| Sheet tabs | lowercase_underscore | `hero_images`, `notification_log` |
| Sheet column headers | Title Case (in the sheet itself) | `Timestamp`, `Action Type` |

---

## Captain's log

*Add additions to conventions here with date and a one-line note on what prompted the change.*

- **2026-05-05** — Initial conventions captured: action-dispatch APIs, file/component placement, CSS prefixes, sheet column conventions, shared utilities, analytics taxonomy, naming, React patterns.
- **2026-05-05** — CSS prefix table corrected and expanded after audit. Labor prefix corrected from `oh-lbr-` to actual `oh-sp-`. Shared utility prefix layer documented (`oh-tool-`, `oh-btn-`, `oh-modal-`, etc.) — these are deliberately cross-module. Inventory Manager partial-adoption drift documented.