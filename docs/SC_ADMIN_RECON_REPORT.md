# Service Calendar Admin Dashboard - Recon Report

**To:** Chat-Claude (for the staged build prompt)
**From:** CC (read-only diagnostic)
**Date:** 2026-06-18
**Origin/main SHA:** `4c81363` (Merge PR #199 sc-month-view-redesign)
**Worktree:** `/Users/kevinfietek/dev/kitchfix-admin-recon` on `chore/sc-admin-recon`
**Live probe:** ran (`scripts/_probe_sc_admin_recon.mjs`, untracked)

This is a read-only recon. No edits, no commits, no migrations. Every claim is anchored to a file + line range or a probe result; live-only items are flagged in the gaps section.

---

## A. SC Postgres schema

### A.1 Table inventory (per `docs/migrations/sc-1-*` + `sc-2-*` + `sc-1b-*`)

| Table | Source | NOT NULL / no-default columns to watch |
|---|---|---|
| `sc_service_groups` | sc-1:62-78 | `account_key`, `group_name`, `created_by`. defaults exist for sort/active/timestamps. |
| `sc_services` | sc-1:90-109, +`is_non_revenue` in sc-1b:28 | `account_key`, `group_id`, `service_name`, `created_by`. defaults for flags/sort/active/timestamps. |
| `sc_service_prices` | sc-1:127-138 | `service_id`, `price`, `effective_date`, `created_by` - all NOT NULL no default. UNIQUE(service_id, effective_date). |
| `sc_daily_projections` | sc-1:155-171 | `account_key`, `service_id`, `service_date`, `projected_count`, `created_by`. CHECK projected_count >= 0. UNIQUE(account_key, service_id, service_date). |
| `sc_daily_actuals` | sc-1:198-214 | `account_key`, `service_id`, `service_date`, `actual_count`, `created_by`. CHECK actual_count >= 0. UNIQUE(account_key, service_id, service_date). |
| `sc_day_metadata` | sc-1:231-251 | `account_key`, `service_date`, `created_by`. UNIQUE(account_key, service_date). |
| `sc_daily_actuals_history` | sc-1:270-280 | append-only audit. `actual_id`, `account_key`, `service_id`, `service_date`, `old_count`, `new_count`, `changed_by`. Intentionally NOT a FK on actual_id (sc-1:272). |
| `sc_homestand_schedule` | sc-2:31-41 | `account_key`, `service_date`, `day_of_week`, `day_type`, `homestand_id`. CHECK day_type IN ('GAME','PREP','OPEN','CLOSE','CLEAN'). UNIQUE(account_key, service_date). |

### A.2 The audit trigger (HOW history is written)

`sc-1:295-316`. **DB-level**: `BEFORE UPDATE ON sc_daily_actuals FOR EACH ROW WHEN (OLD.actual_count IS DISTINCT FROM NEW.actual_count)`. The trigger function (`sc_daily_actuals_audit()`) inserts into `sc_daily_actuals_history`. App-layer code does not write history rows directly. First writes are NOT captured (the originating row has created_by + created_at + initial actual_count, sufficient per the doc comment at sc-1:262-268).

Live probe: `sc_daily_actuals_history` has 10 rows in production today.

### A.3 `accounts` table - LIVE introspection

DDL not in this repo (table predates SC migrations). **Live columns** (probe):

```
active, address, billing_model, city, created_at, drive_url, gmap_url, homestand_url,
lat, level, logo_url, longitude, name, region, season, service_calendars_url, sla_url,
stadium_header_url, stadium_name, state, team_key, timezone, updated_at
```

**`region` exists** and is populated `"East"` / `"West"` / `"CORP"` across all 12 rows. Probe:

```
CIN - AZ   region=West  level=PDC  bm=actuals_drive_invoice
CIN - KY   region=West  level=AAA  bm=actuals_drive_invoice
CIN - OH   region=West  level=MLB  bm=flat_fee
CORP       region=CORP  level=CORP bm=null
STL - FL   region=East  level=PDC  bm=flat_fee
STL - MO   region=East  level=MLB  bm=flat_fee
TBJ - FL   region=East  level=PDC  bm=actuals_drive_invoice
TBJ - NY   region=East  level=AAA  bm=actuals_drive_invoice
TBR - FL   region=East  level=PDC  bm=actuals_drive_invoice
TXR - AZ   region=West  level=PDC  bm=actuals_drive_invoice
TXR - TX - H region=West level=MLB  bm=flat_fee
TXR - TX - V region=West level=MLB  bm=flat_fee
```

`billing_model` is the `billing_model` enum from `sc-1:19-26` with values `actuals_drive_invoice` / `flat_fee` / `projections_drive_invoice`. **Live confirmation**: CIN-AZ, CIN-KY, TXR-AZ, TBJ-FL, TBJ-NY, TBR-FL = `actuals_drive_invoice`. STL-FL, STL-MO, CIN-OH, TXR-TX-H, TXR-TX-V = `flat_fee`. CORP = null.

Note: this drifts from the sc-1 seed at sc-1:44-54 which says `projections_drive_invoice` for TXR-TX-H, TXR-TX-V, STL-MO, CIN-OH, CIN-KY. **Someone (Kevin?) manually shifted those four fee accounts to `flat_fee` in Studio, and CIN-KY to `actuals_drive_invoice`.** The seed UPDATE has the `billing_model IS NULL` guard so re-applying sc-1 won't revert.

### A.4 `user_accounts` table - LIVE introspection

DDL not in this repo (referenced only by the sc-3 seed). **Live columns** (probe): `account`, `email`. **31 rows.** Simple junction. No region, no RDO assignment. Seeded from `contacts` per sc-3:18-21.

### A.5 `contacts` table - LIVE introspection

DDL not in this repo. **Live columns** (probe): `id, name, email, phone, role, team_key, slack_handle, slack_user_id, created_at, updated_at`. **30 rows total**, 9 with `team_key='CORP'` (the corporate roster, see section D).

### A.6 Views: full current SQL

**`sc_daily_revenue`** - sc-1b:55-105 (recreated to add is_non_revenue). The full body:

```sql
WITH service_days AS (
  SELECT account_key, service_id, service_date FROM sc_daily_projections
  UNION
  SELECT account_key, service_id, service_date FROM sc_daily_actuals
)
SELECT
  sd.account_key, sd.service_id, sd.service_date,
  s.service_name, s.is_flat_fee, s.is_tax_free, s.is_non_revenue,
  g.group_name,
  proj.projected_count, act.actual_count,
  COALESCE(pr.price, 0) AS price_at_date,
  pr.price_effective_date,
  COALESCE(proj.projected_count, 0) * COALESCE(pr.price, 0) AS projected_revenue,
  COALESCE(act.actual_count, 0) * COALESCE(pr.price, 0) AS actual_revenue,
  act.actual_count IS NOT NULL AS has_actuals,
  proj.projected_count IS NOT NULL AS has_projection,
  meta.period, meta.week_label, meta.event_label,
  meta.game_type, meta.game_time, meta.notes AS day_notes
FROM service_days sd
JOIN sc_services s ON s.id = sd.service_id AND s.deleted_at IS NULL
JOIN sc_service_groups g ON g.id = s.group_id AND g.deleted_at IS NULL
LEFT JOIN sc_daily_projections proj ON ...
LEFT JOIN sc_daily_actuals act ON ...
LEFT JOIN LATERAL (
  SELECT price, effective_date AS price_effective_date
  FROM sc_service_prices
  WHERE service_id = sd.service_id AND effective_date <= sd.service_date
  ORDER BY effective_date DESC
  LIMIT 1
) pr ON TRUE
LEFT JOIN sc_day_metadata meta ON ...
```

**`sc_month_summary`** - sc-1b:123-135. Aggregates the daily view by month with `FILTER (WHERE NOT is_non_revenue)` on the three revenue totals.

### A.7 No fee/flat-annual table exists - LIVE confirmed

Probe checked `sc_fee_schedule`, `fee_schedule`, `sc_flat_fees`, `sc_annual_fees` - all return "table not found". The flat-annual amounts for MLB fee accounts are NOT tracked in Postgres today.

### A.8 No config change-log / edit-audit table exists - LIVE confirmed

Probe checked `sc_config_changelog`, `sc_audit_log`, `sc_config_log`, `sc_service_audit`, `sc_config_history` - all not found. The only audit surface is `sc_daily_actuals_history` (operator data, not config). The `submissions` table (live columns: `action_type, admin_action_at, created_at, effective_date, employee_name, id, location, module, notes, payload, status, submitted_at, submitter_email, updated_at`) is where the gear-drawer's `sc-config-request` writes (`module='service_calendar'`) - **0 such rows in production today**.

---

## B. Price -> revenue computation (the data-integrity risk)

### B.1 The view IS effective-dated; the join is the LATERAL block above

`sc-1b:95-102` (or sc-1:373-380 pre-non-revenue): the LATERAL subquery selects the single price row whose `effective_date <= sd.service_date`, ordered DESC, LIMIT 1. So **`sc_daily_revenue` correctly picks the price active on each service date**. Historical revenue is anchored to the price that was active when the service happened.

### B.2 `sc_service_prices` is fully populated and dated - LIVE confirmed

```
total rows: 159
effective_date NULL: 0
distinct effective_date values (3): 2026-01-01, 2026-06-16, 2026-06-17
services with multiple price rows (>1): 53 of 105
```

**Effective-dated pricing is real and in use.** Half the services have multiple dated rows already. The `2026-01-01` value is the seed baseline. The `2026-06-16` and `2026-06-17` dates are recent corrections (matches the recent admin UI activity).

Type: `price NUMERIC(12,5) NOT NULL CHECK (price >= 0)` (sc-1:130). **Five decimal places stored.** This is the cause of the ServiceConfig:60 bug - see section C.4.

### B.3 The orchestrator's "current price" lookup diverges from the view

`src/lib/dataStore/serviceCalendar.js:213-224` (`loadAccountConfig`):

```js
const { data: priceRows } = await supa.from(SC_TABLES.prices)
  .select("service_id, price, effective_date")
  .in("service_id", serviceIds)
  .order("effective_date", { ascending: false });
for (const r of priceRows || []) {
  if (!priceByServiceId.has(r.service_id)) {
    priceByServiceId.set(r.service_id, Number(r.price));  // first row wins, latest by date
  }
}
```

**This picks the price with the latest effective_date overall, not "as of today".** If a future-dated row exists (effective_date > today), the editor will show the future price as the current price. The view is unaffected (it computes per service_date), but the gear drawer's per-service price chip and the daySummary client-side math both use this `loadAccountConfig` price.

Today this is benign because the live data shows 0 future-dated rows. The admin dashboard's "future" mode that schedules a price change for a date >today will trip this immediately on the editor side.

### B.4 Bottom line on the view change you asked about

"If we change the revenue view to 'price whose effective_date is the latest <= the service date,' what changes?" - **the view ALREADY does this.** No change needed. The risk is in the orchestrator's `loadAccountConfig` price lookup (section B.3), not the view.

For "do existing rows have the baseline effective_date so historical revenue does NOT silently shift": yes. Every row has effective_date NOT NULL. The earliest is `2026-01-01`, which precedes the seeded service dates, so the LATERAL pick always finds a row.

### B.5 The deactivate-doesn't-stop-billing wrinkle

The view JOINs `sc_services s ... s.deleted_at IS NULL` but does NOT filter `s.active`. **An inactive service whose actuals/projections rows still exist continues to contribute revenue to `sc_daily_revenue` and `sc_month_summary`.** Live probe shows 2 services in this state (`active=false, deleted_at=null`). Whether that's correct depends on intent:
- "Stop billing after I click Deactivate" - currently broken; you'd need an effective_until or deactivated_at column on sc_services and add it to the view's JOIN.
- "Stop entering new data after I click Deactivate but bill existing entries" - currently works (the dataStore still surfaces the service in the editor, the operator stops entering, future days have no rows).

The intended effective-dated archive model resolves this with a date-bounded `active_until`. See section G.2.

---

## C. Current config write path (the gear drawer's plumbing)

### C.1 Orchestrator signatures (`src/lib/dataStore/serviceCalendar.js`)

| Function | Lines | Inputs | Returns | SQL |
|---|---|---|---|---|
| `updateServiceConfig(accountKey, changes, email)` | 988-998 | `changes: [{type, serviceId, newPrice?, ...}]` where `type ∈ {"price","deactivate","reactivate"}`. Optional `effectiveDate` and `notes` are READ by the inner function (line 940) but **never passed by the route**. | `{success, applied}` | per-change. `price` -> `sc_service_prices.upsert(onConflict: 'service_id,effective_date')` (line 936-945). `deactivate`/`reactivate` -> `sc_services.update({active})` (line 949-963). |
| `addService(accountKey, groupName, serviceName, price, flags, email)` | 1119-1135 | `flags: {isFlatFee?, isTaxFree?, isNonRevenue?}` | `{success, serviceId, groupId, sortOrder}` | resolves/creates group (1019-1057), inserts service (1070-1085), inserts initial price row with `effective_date = today` (1087-1097). |
| `submitConfigRequest(accountKey, request, email)` | 1184-1186 | `request: {requestType, groupName?, serviceName?, currentPrice?, newPrice?, notes?}` | `{success}` | writes one row to `submissions` with `module='service_calendar'`, `action_type='config_request:${requestType}'`, payload=full request, status=`'pending'` (1158-1169). |

### C.2 Route POST actions (`src/app/api/service-calendar/route.js`)

| Action | Lines | Body shape | Gate |
|---|---|---|---|
| `sc-config-update` | 438-481 | `{accountKey, changes: [{type, groupName, serviceName, from?, to?}]}`. Route translates to orchestrator's `{type, serviceId, newPrice?}` via a `loadAccountConfig` lookup (457-477). | `SC_ADMINS.includes(email)` at line 439, returns 403 else. |
| `sc-config-add` | 484-514 | `{accountKey, groupName, serviceName, price, taxFree, flatFee, nonRevenue}` | `SC_ADMINS.includes(email)` at 485. |
| `sc-config-request` | 517-531 | `{accountKey, requestType, groupName, serviceName, newPrice, notes}` | NONE (any logged-in user, by design - this is the "site lead asks" path). |

**Important: the route's translation step at lines 467-477 does NOT pass `effectiveDate` or `notes` from the UI to the orchestrator.** The orchestrator's `effectiveDate || today` fallback at 940 means every write is "today" with no notes today. This is a real limitation for the future/backdate modes - the orchestrator already accepts the field, but the API surface throws it away. Easy fix when you build the new admin UI.

### C.3 Service account, not user OAuth - confirmed

The route uses `getServiceClient()` from `@/lib/supabase` (line 81 of route.js, line 174 of dataStore). All PG writes go through the service-role key. User OAuth is only used to identify the actor email (`session.user.email`) and gate via SC_ADMINS server-side.

### C.4 Price type end-to-end + the ServiceConfig:60 counter bug

- DB column type: `NUMERIC(12,5) NOT NULL CHECK (price >= 0)` (sc-1:130). Up to 5 decimal places stored.
- supabase-js serializes NUMERIC as a JS number (`Number(r.price)`, dataStore:222 and 233). So API sends `s.price` as a number.
- `ServiceConfig.js:33` hydrates `editPrices` as `String(Number(s.price).toFixed(2))` - **rounded to 2 decimals**.
- `ServiceConfig.js:57-58` reads `origPrice` from `serviceGroups` (the unrounded number) and `newPrice = Number(editPrices[key])` (the 2-decimal rounded value).
- `ServiceConfig.js:60` compares `newPrice !== origPrice` for the change counter.

**The bug**: if any price in PG has a 3rd / 4th / 5th decimal nonzero (legal per `NUMERIC(12,5)`), then `origPrice=19.005` rounds to `"19.01"`, parses back to `19.01`, and `19.01 !== 19.005` flags as a "change" on every render. The change counter inflates by one per such service.

Live data: I did not probe for specific 3-decimal prices, but the schema allows them. The fix is either:
- Match the rounding on both sides of the compare: `Number(Number(origPrice).toFixed(2)) !== newPrice`
- Round on the DB write side to 2 decimals always (NUMERIC(12,2))
- Round at the orchestrator's response serialization

Per the user's spec (effective-dated pricing is the spine), I'd lean toward "store with 5 decimals for engineering precision, render and compare at 2 decimals". The new admin UI should use a consistent rounding helper that both sides call.

### C.5 How "deactivate" is represented today

`sc_services.active BOOLEAN NOT NULL DEFAULT TRUE` (sc-1:101). The orchestrator flips it via `.update({active: false})` (dataStore:949-963). Live: 2 services currently have `active=false`. No `deleted_at` rows in `sc_services` (the soft-delete column was reserved but never used in practice - 0 rows have it set).

**There is no date-bounded archive today.** The transition to "effective-dated archive" must add a column (e.g. `active_until DATE`) or replace `active` with a status ledger pattern.

---

## D. Auth / routing / middleware / allowlists

### D.1 Middleware - `src/middleware.js` (28 lines)

```js
export async function middleware(request) {
  const session = await auth();
  const isLoggedIn = !!session;
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isAuthRoute = request.nextUrl.pathname.startsWith("/api/auth");
  const isCronRoute = request.nextUrl.pathname.startsWith("/api/cron");
  if (isAuthRoute || isCronRoute) return NextResponse.next();
  if (isLoginPage && isLoggedIn) return NextResponse.redirect(new URL("/", request.url));
  if (!isLoginPage && !isLoggedIn) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
```

**Middleware only checks "logged in" - it does NOT route-gate to corporate.** Per-route authorization happens in the page.js component (client-side) and in API handlers (server-side, via `auth()` + email check).

To add a new gated route: drop a `page.js` under `src/app/service-calendar/admin/` that does the corporate check before rendering the dashboard, plus add server-side gates on every API endpoint the page calls. The matcher does not need editing.

### D.2 SC dev-gate today

`src/app/service-calendar/page.js:54` - `const isDev = SC_ADMINS.includes(email)`. If not, renders `oh-sc-coming-soon` block (lines 56-93). If yes, mounts `<ServiceCalendar />`.

`SC_ADMINS` lives in `src/lib/admin.js:24-27`:

```js
export const SC_ADMINS = [
  "k.fietek@kitchfix.com",
  "joe@kitchfix.com",
];
```

The same constant is the API gate (route.js:439, 485) and the ServiceConfig in-component gate (ServiceConfig.js:3).

### D.3 OPS_LEADERSHIP_EMAILS - EXACT current list (`src/lib/admin.js:5-12`)

```js
export const OPS_LEADERSHIP_EMAILS = [
  "k.fietek@kitchfix.com",
  "a.wasserman@kitchfix.com",
  "britt@kitchfix.com",
  "joe@kitchfix.com",
  "josh@kitchfix.com",
  "m.chavez@kitchfix.com",
];
```

6 members. Missing from this list vs the intended corporate set: s.castro (Sebastian), r.moore (Ryan), s.lynch (Shane). Present in this list but NOT in the intended set: a.wasserman.

### D.4 Intended corporate set - resolved to actual emails

From the live `contacts` table where `team_key='CORP'`, matched against the user's spec:

| Spec name | Email | Role |
|---|---|---|
| Kevin Fietek | k.fietek@kitchfix.com | Director of Operations |
| Josh Katt | josh@kitchfix.com | CEO |
| Joe Lessard | joe@kitchfix.com | VP Operations |
| Britt Chernikovich | britt@kitchfix.com | Director of Culinary |
| Mariela Chavez | m.chavez@kitchfix.com | Human Resources |
| Sebastian Castro | s.castro@kitchfix.com | Staff Accountant |
| Ryan Moore | r.moore@kitchfix.com | Regional Director West |
| Shane Lynch | s.lynch@kitchfix.com | Regional Director East |

**Total: 8 emails.** Bonus row in contacts CORP not in the spec: `D.Inthavone@kitchfix.com` (Dec Inthavone, Corporate Field Chef) - decide whether to include or exclude.

### D.5 Existing pattern to copy: OPD's `opdAcl.js`

`src/lib/opdAcl.js:56-73` already implements this exact list shape, split into SLT (6) + RESTRICTED (3). Direct quote:

```js
export const SLT_EMAILS = Object.freeze(new Set([
  'k.fietek@kitchfix.com',  // Kevin Fietek
  'josh@kitchfix.com',       // Joshua Katt
  'joe@kitchfix.com',        // Joseph Lessard
  'britt@kitchfix.com',      // Brittany Chernikovich
  'm.chavez@kitchfix.com',   // Mariela Chavez
  's.castro@kitchfix.com',   // Sebastian Castro
]));
export const RESTRICTED_EMAILS = Object.freeze(new Set([
  'r.moore@kitchfix.com',    // Ryan Moore - Regional Director West
  's.lynch@kitchfix.com',    // Shane Lynch - Regional Director East
  'd.inthavone@kitchfix.com',// Dec Inthavone - Corporate Field Chef
]));
```

**The intended SC-admin corporate set is exactly the union of `SLT_EMAILS` and `RESTRICTED_EMAILS minus Dec Inthavone`**.

**Recommendation: build a new `SC_ADMIN_EMAILS` Set in `src/lib/admin.js`** rather than reuse `OPS_LEADERSHIP_EMAILS` or import from `opdAcl.js`:
- Reusing OPS_LEADERSHIP misses Castro + Moore + Lynch and includes Wasserman.
- Importing from opdAcl crosses the OPD/SC concern boundary - SC and OPD memberships will diverge over time. opdAcl is doc-access-tier-shaped (hierarchical), SC-admin is binary (can-edit-config or not).
- A new explicit list is the pattern Kevin already uses: `OPS_LEADERSHIP_EMAILS`, `SC_ADMINS`, `PLAYBOOK_OWNER` all live as their own constants.

Naming suggestion: `SC_ADMIN_EMAILS` for the corporate write set, keep `SC_ADMINS` as the existing dev-gate (k.fietek + joe) for the operator-view rollout - they answer different questions.

### D.6 API authz server-side pattern

`route.js:388-393`:

```js
const session = await auth();
if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
const email = session.user?.email?.toLowerCase().trim();
const body = await request.json();
const { action } = body;
```

Then per-action: `if (!SC_ADMINS.includes(email)) return ... 403` (route.js:439, 485). For the new admin actions, follow this exact pattern with `SC_ADMIN_EMAILS.has(email)`.

### D.7 App Router page.js pattern

The SC page is client-side gated (page.js is `"use client"` and uses `useSession()`). The OPD command page is the cleaner pattern for admin gating - `src/app/playbook/admin/page.js` is a server component that just renders `<AdminClient />`, and `AdminClient.js` fetches `/api/playbook?action=bootstrap` to get `{isOwner, ...}` and shows the cockpit only when `isOwner`. The server-side gate is INSIDE the bootstrap action (`src/app/api/playbook/route.js:167` - `if (!isOwner) return {isOwner:false, ...}`). The page itself does not block render; the bootstrap response does.

Two valid patterns. For SC admin, I'd recommend a hybrid:
- `src/app/service-calendar/admin/page.js`: server component, calls `auth()` server-side, redirects to `/service-calendar` (or 404) if email not in `SC_ADMIN_EMAILS`, else renders `<AdminClient />`.
- API actions (`sc-admin-*`): always re-check `SC_ADMIN_EMAILS` server-side. Hiding the page is NOT the gate.

This matches the user's stated requirement: "Hiding the link is NOT the gate".

---

## E. SC page structure + gear-removal surface

### E.1 Where the gear lives in ServiceCalendar.js (origin/main 4c81363)

| Element | Lines | Notes |
|---|---|---|
| `showConfig` state | 96 | `const [showConfig, setShowConfig] = useState(false);` |
| Gear button | 487-489 | `<button className="sc-cfg-gear" onClick={() => setShowConfig(true)} title="Service config">` inside `.sc-header-account`. The svg is the gear icon. |
| ServiceConfig import | 4 | `import ServiceConfig from "./ServiceConfig";` |
| ServiceConfig overlay render | ~1075 | Conditional render gated on `showConfig`. Modal-style. (Need to recheck line range vs latest main since the file grew; quick grep confirms one `<ServiceConfig ` instance.) |
| `onConfigChanged` callback | passed to ServiceConfig | reloads via the existing `reloadKey` bump. |

To replace: remove the gear button + state + import + modal render. Replace with a corporate-only header link to `/service-calendar/admin` rendered next to the existing account dropdown.

### E.2 Nothing else imports ServiceConfig.js

`grep "from \"./ServiceConfig\"\\|from '\\./ServiceConfig'" src/`: only `ServiceCalendar.js:4`. **ServiceConfig.js can be deleted cleanly** once the new admin page replaces it. Or left in place during a transition and removed after rollout. (I'd say delete - no other consumers.)

---

## F. Conventions / house patterns

### F.1 Migration file naming + application

`docs/migrations/{module-key}-{ordinal}-{description}.sql`. The Service Calendar uses `sc-N-name.sql` (sc-1, sc-1b, sc-2, sc-3). For new SC tables, follow `sc-4-...sql`, `sc-5-...sql`.

**Migrations do NOT auto-apply on deploy.** From `CLAUDE.md`: "SQL files in `docs/migrations/` are not run by Vercel - they're applied manually in Supabase Studio. The 2026-06-12 silent-gap incident happened because Stage A code deployed before the matching pr-9-1 migration was applied. **When shipping schema changes: apply in Studio first, verify via probe script, then ship the dependent code.**"

Existing safety practice (sc-1:9): every migration file ends with "Apply in Supabase Studio first, verify via probe, then ship code." Probe scripts go in `/scripts/_probe_*.mjs`.

### F.2 Action-dispatch API convention

From `CONVENTIONS.md:10-31`: "Each module has a single route file with one GET (and sometimes POST) handler. The handler reads `?action=...` and dispatches to logic blocks." Action names are hyphen-lowercase: `submit-paf`, `mark-notification-read`. The SC route already uses this: `sc-hero`, `sc-accounts`, `sc-load`, `sc-year-summary`, `sc-submit-day`, `sc-bulk-submit`, `sc-config-update`, `sc-config-add`, `sc-config-request`, `sc-day-override`, `sc-submit-clickers`.

For the admin dashboard add: `sc-admin-list-accounts`, `sc-admin-price-edit`, `sc-admin-service-archive`, `sc-admin-fee-set`, `sc-admin-changelog`, etc. **Do not split into sub-routes** like `/api/service-calendar/admin/route.js` - keep them in the existing route file.

### F.3 CSS prefix - reuse `sc-`

From `CONVENTIONS.md:100`: "Service Calendar / `sc-` / `src/app/service-calendar/ops-sc.css`". The admin page should reuse the `sc-` prefix and live in the same `ops-sc.css` (or a sibling `ops-sc-admin.css` imported alongside). Dual-density tokens: `data-density="compact"` on the root for the calendar view, `data-density="comfortable"` on overlays (e.g. DayDetail). Admin dashboard is likely `comfortable` throughout.

### F.4 GOTCHAS to call out

I did not read GOTCHAS.md cover-to-cover this pass (flag in gaps). Relevant ones I know of from prior sessions:
- The 1000-row PostgREST pagination footgun - `fetchAllPaginated` wrapper in `src/lib/dataStore/serviceCalendar.js:132-146`. Any new admin query that might exceed 1000 rows (e.g. dumping all price history across accounts) must use this wrapper.
- The route-renames-orchestrator-fields footgun documented in the SC handoff (`docs/SC_CC_HANDOFF.md` section 6.3): the route renames `totalServiceDays -> totalDays`, `totalActualMeals -> actualCovers`, etc. New admin endpoints should either NOT rename fields (cleaner) or document the rename next to the field.
- The Edit tool's str_replace whitespace strictness (general repo gotcha).
- Migration safety: "apply in Studio, verify, then ship code" (covered in F.1).

---

## G. Migration safety / backfill risk surface

### G.1 Effective-dated pricing - already done

Live verified: 159 price rows, 0 NULL effective_date, 3 distinct dates, 53 of 105 services have multiple price rows. **No backfill needed.** Historical revenue is already anchored.

The risk on the ADMIN side is the orchestrator's `loadAccountConfig` picking the latest-by-date price (B.3) rather than "as of today". The admin dashboard's "future" mode (scheduled price change) will trip this. Fix is one-line: filter `effective_date <= today` in the loadAccountConfig query and re-sort.

The "backdate" mode (recompute already-closed days) needs no schema change - it's just an insert of a price row with an old effective_date, and the LATERAL JOIN in the view picks it up. Sharp edge: if any consumer caches a prior `actual_revenue`, it will silently shift. The intranet does not cache revenue today (always re-derives), so this is a documentation flag, not a code change.

### G.2 Effective-dated archive - migration needed, two viable paths

**Current state**: `sc_services.active BOOLEAN NOT NULL DEFAULT TRUE`. No date.

**Path A: add `active_until DATE NULL` column.** Active iff `(active = true) AND (active_until IS NULL OR active_until > current_date)`. View JOIN gains the same filter. NOT NULL hazard: `active_until` MUST default NULL or NOT NULL DEFAULT '9999-12-31' - either works, NULL is more idiomatic for "no end". Active gets repurposed as a hard-archive flag (admin can reactivate by clearing active_until).

**Path B: state ledger pattern.** New table `sc_service_status` with `(service_id, status, effective_date, created_by)`. Active service = the latest status row before today with status='active'. More flexibility (archive/reactivate cycles all recorded) but more query overhead. Mirrors the price-history pattern exactly.

Either works. I'd pick A for symmetry with the existing simple `active` boolean and minimum view-refactor scope. The user spec says "Shares the same dated-status mechanism as pricing" which suggests B; flag for Kevin.

For service GROUPS - same pattern needed. `sc_service_groups.active BOOLEAN NOT NULL DEFAULT TRUE` and `deleted_at TIMESTAMPTZ` exist; both unused in any time-aware way today.

### G.3 New tables - the change-log + the fee schedule

**Change-log** - no precedent in the repo. Closest pattern is `sc_daily_actuals_history` (sc-1:270-280) - simple append-only with old/new + actor. The OPD `submissions` table is the audit-of-requests pattern. Suggested shape (Chat-Claude can scope):

```
sc_config_changelog (
  id UUID PK,
  account_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,   -- 'price' | 'service' | 'group' | 'fee' | 'fun_money'
  entity_id UUID,              -- service_id or fee_schedule_id, nullable if op is account-wide
  change_type TEXT NOT NULL,   -- 'create' | 'update' | 'archive' | 'reactivate'
  old_value JSONB,
  new_value JSONB,
  reason TEXT NOT NULL,
  requested_by TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Naming precedent: `sc_daily_actuals_history` and `inv_*_history` (Smart Inventory). Migration file: `sc-4-config-changelog.sql`. Same RLS-disabled + GRANT-to-service_role pattern as sc-1.

**Fee schedule** - flat annual amounts per fee account. Suggested shape:

```
sc_fee_schedule (
  id UUID PK,
  account_key TEXT NOT NULL,        -- one of the 4 fee accounts (or 5 with STL-FL)
  fee_amount NUMERIC(12,2) NOT NULL,
  effective_date DATE NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_key, effective_date)
)
```

Same LATERAL-JOIN-for-current-rate pattern as `sc_service_prices`. Migration file: `sc-5-fee-schedule.sql`.

### G.4 View dependencies a schema change would cascade into

`sc_daily_revenue` depends on: `sc_services`, `sc_service_groups`, `sc_daily_projections`, `sc_daily_actuals`, `sc_service_prices`, `sc_day_metadata`.
`sc_month_summary` depends on: `sc_daily_revenue`.

To add `active_until` to `sc_services` and use it in the view: **must `DROP VIEW IF EXISTS sc_month_summary; DROP VIEW IF EXISTS sc_daily_revenue;` first, then add the column, then recreate both views.** sc-1b:52-53 already documents this dependency-drop ordering. Migration file should be idempotent (same `IF EXISTS` guards).

GRANTs need to be re-issued on the recreated views (`GRANT SELECT ON sc_daily_revenue TO service_role;` and same for sc_month_summary). sc-1b:152-153 has the template.

### G.5 Adding effective-dated archive risks NOT NULL on backfill

If `active_until DATE NULL` is added with NULL default, existing rows get NULL (= never expires) - no backfill needed. If the choice is `NOT NULL DEFAULT '9999-12-31'`, the ALTER works for existing rows but writes are forever bound. NULL is the right call.

For the 2 currently-deactivated services (`active=false`): these should get `active_until = some past date` so the view filter "active=true OR active_until>today" works as expected. Alternative: redefine the filter as `active=true AND (active_until IS NULL OR active_until>today)` and let the existing inactive rows stay flagged via active=false. Probably cleaner.

---

## H. Other landmines / my read

### H.1 The route-rename footgun bites again

The route-rename pattern (handoff section 6.3 - the year-summary `totalServiceDays -> totalDays` etc) was the cause of the banner bug we just fixed. If the admin endpoints follow the same pattern, we'll trip it again. **Recommendation: in the admin actions, do NOT rename orchestrator fields at the route layer.** The admin UI can read the orchestrator-native names.

### H.2 The `ServiceConfig.js:33` rounding works around `loadAccountConfig` not rounding

The dataStore returns raw `Number(r.price)` from PG (line 222). The UI rounds to 2 decimals on display. If we wanted to fix the :60 bug structurally, the cleanest place is the **orchestrator** - serialize prices as 2-decimal numbers (or strings) and the UI doesn't need to round. Both sides comparing the same form. This also future-proofs the admin dashboard since multiple new surfaces will display prices.

### H.3 STL-FL is the trap case again

STL-FL is `billing_model = flat_fee` (live confirmed) but has zero `sc_homestand_schedule` rows. The existing UI fork treats it as per-meal because `homestandMap` is empty. The admin dashboard should NOT treat STL-FL as a fee account in the fee-schedule editor unless someone has explicitly opted in. Either:
- Drive the fee-schedule editor off `billing_model = 'flat_fee'` only (then STL-FL appears, even without a homestand schedule - might confuse).
- Drive it off `billing_model = 'flat_fee' AND has_homestand_schedule` (then STL-FL never appears in the fee editor, matching the current calendar behavior).

Recommend the latter. Same gate as the calendar's `isFeeAccount`. Live: that gives 4 fee accounts: CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V.

### H.4 The submissions table already has `effective_date`

Live probe showed `submissions` columns include `effective_date`. So the existing `sc-config-request` POST path already has a date column to write into when the request includes an effective-dated intent. Today, `submitConfigRequestPostgres` (`src/lib/dataStore/serviceCalendar.js:1158-1169`) does NOT write to `effective_date`; it only writes payload, action_type, etc. Easy extension when site leads file backdated/future requests.

### H.5 The contacts table has Dec Inthavone but the user's spec doesn't

Decision point for Chat-Claude's prompt: include or exclude Dec Inthavone (`d.inthavone@kitchfix.com`, Corporate Field Chef). The OPD ACL includes them in RESTRICTED. SC config edits are money-moving; the spec excluded them. **Default to exclude for SC-admin** unless Kevin says otherwise.

### H.6 No `submissions` rows with `module='service_calendar'` exist today

Live confirmed: 0 rows. The site-lead config-request feature has never been used. When the new admin dashboard ships with a "pending requests" panel, expect the inbox to be empty. Not a blocker - flag for product so the empty-state copy is honest.

### H.7 `accounts` table has a useful but unused billing_model fork

Live confirmed billing_model values match the SC fork. Three values exist in the enum (`actuals_drive_invoice`, `flat_fee`, `projections_drive_invoice`); only the first two are in active use. `projections_drive_invoice` was seeded for the 4 MLB fee accounts but they were all manually shifted to `flat_fee` in Studio. Worth confirming with Kevin: is `projections_drive_invoice` still a real billing model the business uses, or vestigial? Affects whether the admin dashboard's account-type filter needs to surface it.

---

## Gaps - needs live verification in Supabase Studio

These are items I could not confirm from the repo OR the SELECT-only probe. Chat-Claude should not include final shapes for these in the build prompt until Kevin verifies in Studio:

1. **DDL for `user_accounts`** - the column types and constraints. Probe shows `{account, email}` but not whether email or account is part of a PK/UNIQUE or whether nulls are allowed. sc-3:11-13 mentions: "Re-running is safe IFF a UNIQUE constraint on (email, account) was added separately; without one, this script creates duplicates on re-run." So a UNIQUE constraint may or may not exist - **verify in Studio**.
2. **DDL for `contacts`** - column types, PK, indexes, whether `team_key` is FK-checked against `accounts.team_key`.
3. **DDL for `accounts`** - including PK, indexes, and whether `region`, `level`, `billing_model` have any CHECK constraints. The CLAUDE.md doesn't say which migration created it (predates the SC bundle).
4. **Whether any `sc_service_prices` rows have effective_date > current_date today** - I confirmed 3 distinct dates (`2026-01-01`, `2026-06-16`, `2026-06-17`) all <= today, but the count of future-dated rows (if any) wasn't captured.
5. **Whether the 2 `active=false` services in `sc_services` are still being billed via the view** - probe row counts didn't confirm whether any `sc_daily_revenue` rows reference them. If they are, the deactivate-doesn't-stop-billing wrinkle (B.5) needs a product call.
6. **Multi-price service distribution** - I confirmed 53 of 105 services have >1 price row but did not extract per-account distribution. If almost all multi-price rows are concentrated in 1-2 accounts (the recent admin activity), the dashboard's "show price history" view will have an uneven row weight to surface.
7. **GOTCHAS.md unread this session** - I did not re-read it cover-to-cover. There may be SC-specific gotchas I missed.
8. **The `submissions` table DDL** - whether `effective_date` is NOT NULL or NULL, whether there's an `(module, status)` index, etc. Probe confirmed the columns exist but not their constraints.
9. **The exact line range of the ServiceConfig modal render in ServiceCalendar.js** - I confirmed only one consumer of ServiceConfig.js exists (line 4 import) but did not snapshot the full JSX overlay block. Read-only flag.
10. **GRANT inheritance on views when columns are added** - sc-1b regrants `SELECT` on both views explicitly after recreate. The pattern works but is worth a confirm-via-probe after any new view alteration.

---

## TL;DR for Chat-Claude

- Schema spine is solid: effective-dated pricing already works at the view layer (LATERAL JOIN). The admin dashboard's "today/future/backdate" pricing modes can ride on the existing view; only the orchestrator's `loadAccountConfig` needs a `<= today` filter to stop showing future prices as current.
- Effective-dated archive needs a new column on `sc_services` (recommend `active_until DATE NULL`) plus a view-recreate. NULL = never expires preserves backward compatibility.
- Two new tables: `sc_config_changelog` and `sc_fee_schedule`. Names follow the `sc_N_*.sql` migration convention. No fee table or change-log table exists today (live verified).
- Allowlist: build a new `SC_ADMIN_EMAILS = Set(...)` in `src/lib/admin.js` with 8 explicit emails. Do NOT reuse `OPS_LEADERSHIP_EMAILS` (miss Castro/Moore/Lynch, includes Wasserman). Do NOT import from `opdAcl` (different concern, different lifecycle).
- Gating: middleware stays as-is (it only does "logged in"). Per-page server-component gate at `src/app/service-calendar/admin/page.js` + per-action server-side `SC_ADMIN_EMAILS.has(email)` check on every new admin API action. Hiding the link is NOT the gate.
- Gear button removal: ServiceConfig.js has one consumer (`ServiceCalendar.js:4`); safe to delete after the admin page lands.
- The ServiceConfig:60 bug cause: `NUMERIC(12,5)` storage + `.toFixed(2)` hydrate = false-positive change counter for any price with 3+ decimal places. Structural fix: serialize prices as 2-decimal at the orchestrator boundary.
- The route-rename pattern that bit us on the year banner: don't repeat it on admin endpoints. Keep orchestrator field names through to the UI.

End of report.
