# Service Calendar Admin Stage 2 (Price Editor) - Write-Path Recon

**To:** Chat-Claude (for the staged build prompt)
**From:** CC (read-only diagnostic)
**Date:** 2026-06-18
**Origin/main SHA:** `bdbde41` (Merge PR #205 sc-admin-stage1-gate)
**Worktree:** `/Users/kevinfietek/dev/kitchfix-sc-stage2-recon` on `chore/sc-stage2-recon`
**Live probe:** ran (`scripts/_probe_sc_stage2_writes.mjs`, untracked)

Scope of this recon: the WRITE path for price changes, the route's effective-date passthrough gap, the loadAccountConfig display-side bug, the rounding convention question, the gear-removal seam, and the feature surface ServiceConfig.js hosts that's about to disappear. Backdate is explicitly out of Stage 2 scope, so backdate semantics are not investigated.

---

## 1. updateServiceConfig - the price-write path, exactly

### 1.1 Exports + dispatch

`src/lib/dataStore/serviceCalendar.js:988-998`:

```js
export async function updateServiceConfig(accountKey, changes, email) {
  const result = await updateServiceConfigPostgres(accountKey, changes, email);
  if (
    isDualWrite(SC_TABLES.prices) ||
    isDualWrite(SC_TABLES.services)
  ) {
    // TODO: shadow validation may need to mirror price changes to the
    // legacy service_config tab. Not implemented; see header note.
  }
  return result;
}
```

The dual-write block is inert (no Sheets path implemented). PG is canonical.

### 1.2 The inner function - the SQL that runs for a price change

`src/lib/dataStore/serviceCalendar.js:922-972`. Inner price branch verbatim (930-947):

```js
for (const ch of changes) {
  if (ch.type === "price") {
    // Upsert (not insert) so a same-day re-correction updates the
    // existing row instead of failing on uq_sc_service_prices_service_date.
    // Admins routinely tweak a price more than once during config
    // setup; before this, the second tweak threw 23505 from PG.
    const { error } = await supa.from(SC_TABLES.prices).upsert(
      {
        service_id:     ch.serviceId,
        price:          Number(ch.newPrice),
        effective_date: ch.effectiveDate || today,
        created_by:     email,
        notes:          ch.notes || null,
      },
      { onConflict: "service_id,effective_date" }
    );
    throwOnError(error, `updateServiceConfig.price[${applied}]`);
    applied++;
  } else if (ch.type === "deactivate") {
    ...
```

Translated to SQL: PostgREST `.upsert(..., { onConflict: "service_id,effective_date" })` is:

```sql
INSERT INTO sc_service_prices (service_id, price, effective_date, created_by, notes)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (service_id, effective_date)
DO UPDATE SET
  price      = EXCLUDED.price,
  created_by = EXCLUDED.created_by,
  notes      = EXCLUDED.notes;
```

The unique constraint `uq_sc_service_prices_service_date` on `(service_id, effective_date)` (sc-1:136-137) is the conflict target.

### 1.3 Behavior on same-date vs different-date

- **Same `(service_id, effective_date)` as an existing row** -> UPDATE in place. Price overwritten, `created_by` and `notes` overwritten. The original is GONE - no audit trail.
- **Different `effective_date`** -> INSERT a new row. Original row preserved. The ledger grows; the view's LATERAL pick selects the right one for each historical service_date.

Confirmed by the upsert semantics; no separate INSERT path. **For Stage 2's "future" mode** (operator picks a date > today), this correctly inserts a NEW dated row.

### 1.4 Does the orchestrator accept effectiveDate today?

**Yes, the orchestrator already accepts it** at line 940: `effective_date: ch.effectiveDate || today`. The `today` fallback uses `isoDay(new Date())` from line 81-86 (see GOTCHA flag in section 6).

**The route does NOT pass it.** See section 2.

### 1.5 Change-log writes

`updateServiceConfigPostgres` writes ONLY to `sc_service_prices` (for price), `sc_services.active` (for deactivate/reactivate). **No change-log table is written.** The change-log table doesn't exist yet (live probe confirmed - no `sc_config_changelog`, `sc_audit_log`, etc.). Stage 2 builds price editing on top of this; the change-log table is a separate later-stage piece.

Per-row `created_by` + `notes` on `sc_service_prices` is the only audit trail today. Note that an UPDATE (same-date re-correction) **overwrites both** without trace - a real gap for a money-moving surface. Flag for Stage 2: at minimum log a change-log row even if the table is added in the same PR; or make the editor disallow same-date updates and require a new effective_date for any change.

---

## 2. Route effective-date passthrough gap

### 2.1 The action

`src/app/api/service-calendar/route.js:437-481`. Body + translation:

```js
if (action === "sc-config-update") {
  if (!SC_ADMINS.includes(email)) { ... 403 ... }
  const { accountKey, changes } = body;
  if (!accountKey || !changes?.length) { ... 400 ... }

  // UI sends changes as { type, groupName, serviceName, from?, to? }.
  // The orchestrator wants { type, serviceId, newPrice? }. Resolve
  // each (groupName, serviceName) to its serviceId via a single
  // config read so the route does not query per-change.
  const config = await loadAccountConfig(accountKey);
  const translated = changes.map((c) => {
    const svc = config.services.find(
      (s) => s.groupName === c.groupName && s.serviceName === c.serviceName
    );
    if (!svc) { throw new Error(...); }
    if (c.type === "price") {
      return { type: "price", serviceId: svc.id, newPrice: Number(c.to) };
    }
    if (c.type === "deactivate") {
      return { type: "deactivate", serviceId: svc.id };
    }
    if (c.type === "reactivate") {
      return { type: "reactivate", serviceId: svc.id };
    }
    throw new Error(`Unknown change type: ${c.type}`);
  });

  const result = await updateServiceConfig(accountKey, translated, email);
  return NextResponse.json({ success: true, updated: result.applied });
}
```

### 2.2 What it drops, precisely

The translated price object at **line 468** is exactly:

```js
return { type: "price", serviceId: svc.id, newPrice: Number(c.to) };
```

That's it. Three fields. **`effectiveDate` and `notes` are not present.** Even if the UI's `c` object carries them, they vanish at line 468. The orchestrator's `ch.effectiveDate || today` therefore always falls back to today.

Same goes for the gate at **line 439** - it gates on `SC_ADMINS` (the dev-view gate, k.fietek + joe), not `SC_ADMIN_EMAILS` (the corporate write set). Stage 2 needs to change this gate too: the admin page is opening to 8 corporate users, but the route still rejects them. **This is the blocker for Stage 2's first POST**: any of the 6 non-SC_ADMINS corporate users (josh, britt, m.chavez, s.castro, r.moore, s.lynch) will get a 403 from line 439 even though the admin page renders for them.

### 2.3 Minimal change to thread effectiveDate + reason/note

Two changes, both at route.js, both small:

1. **Swap the gate** at line 439 from `SC_ADMINS.includes(email)` to `isScAdmin(email)` (import `isScAdmin` from `@/lib/admin`). Keep the dev-view `SC_ADMINS` for the page-level gate as-is - it answers a different question.

2. **Pass through `effectiveDate` and `notes`** at line 468:

```js
if (c.type === "price") {
  return {
    type: "price",
    serviceId: svc.id,
    newPrice: Number(c.to),
    effectiveDate: c.effectiveDate || undefined,  // YYYY-MM-DD or absent
    notes:        c.notes || undefined,
  };
}
```

`undefined` means the orchestrator's `ch.effectiveDate || today` fallback fires, preserving current behavior when the UI doesn't send a date. Stage 2 always sends one.

### 2.4 Validation the route should add

The route currently does no shape validation on `c.effectiveDate`. Stage 2 should add:

- Format check: matches `^\d{4}-\d{2}-\d{2}$`.
- Range check: `effectiveDate >= today` (Stage 2 = today + future only; backdate is out of scope). Reject anything earlier with a 400 + clear error message.
- Notes length cap (e.g. 280 chars) so a malformed UI doesn't dump anything into the DB.

These belong in the route, not the orchestrator, so the orchestrator stays callable by future scripts that legitimately backdate (when that mode lands).

---

## 3. loadAccountConfig - how the editor reads the price to display

### 3.1 The lookup

`src/lib/dataStore/serviceCalendar.js:212-225`:

```js
const serviceIds = (servicesRes.data || []).map((s) => s.id);
let priceByServiceId = new Map();
if (serviceIds.length > 0) {
  const { data: priceRows, error: priceErr } = await supa
    .from(SC_TABLES.prices)
    .select("service_id, price, effective_date")
    .in("service_id", serviceIds)
    .order("effective_date", { ascending: false });
  throwOnError(priceErr, "loadAccountConfig.prices");
  for (const r of priceRows || []) {
    if (!priceByServiceId.has(r.service_id)) {
      // First row wins because we sorted desc; that's the latest price.
      priceByServiceId.set(r.service_id, Number(r.price));
    }
  }
}
```

**It picks the latest price by effective_date, period.** No `<= today` filter. The "first row wins" comment correctly describes the code - it's literally the highest effective_date overall, not the as-of-today price.

### 3.2 Concrete consequence

The instant Stage 2 inserts a future-dated row, this lookup will surface the future price as the current price. Live probe confirmed: **0 future-dated rows exist today**, so the bug is currently dormant. Stage 2 creating ANY future-dated row triggers it.

The line that causes it is **217**:

```js
.order("effective_date", { ascending: false });
```

It's the missing `<= today` filter on the .select that's the actual omission. Adding `.lte("effective_date", today)` before `.order(...)` fixes it.

### 3.3 Minimal fix

In `loadAccountConfigPostgres` at line 213-217:

```js
const today = isoDay(new Date());
const { data: priceRows, error: priceErr } = await supa
  .from(SC_TABLES.prices)
  .select("service_id, price, effective_date")
  .in("service_id", serviceIds)
  .lte("effective_date", today)            // NEW - filter future-dated out
  .order("effective_date", { ascending: false });
```

(`isoDay` is already defined in the same file at line 81-86.)

### 3.4 Other callers of this price map

`grep "priceByServiceId\|priceLookup" src/`:

- `loadAccountConfig` is the only place this Map is built. The output `services[].price` field flows to:
  - `src/app/api/service-calendar/route.js:280` - `transformServiceGroups(config)` builds the calendar payload.
  - `src/app/service-calendar/ServiceCalendar.js:170` - `priceLookup` for `metrics` useMemo (per-day revenue calc).
  - `src/app/service-calendar/ServiceCalendar.js:303` - `priceLookup` for `daySummary` (per-tile revenue display).
  - `src/app/service-calendar/ServiceConfig.js:57-58` - `origPrice` for the change comparator.

All of these want "as of today" - the calendar's revenue display should mirror what the DB view computes (which already uses `<= service_date`), and the editor should compare against "what is the current price". **The fix is non-breaking** for all four callers - they all want as-of-today, and only the editor case has been silently OK because no future rows exist yet.

One nuance: the calendar's per-day revenue computation in `metrics` and `daySummary` is JS-side using `priceLookup`. It treats EVERY day in the visible month as using "current price". The DB view treats each day correctly. **This is a known existing drift** (the JS layer compute is approximate, the DB is canonical). Today it happens to be right because there are no future-dated changes. Once a future-dated price exists, the JS layer would still be wrong for past days that span a price-change boundary - but that's the existing limitation, not introduced by my fix. Flag for the staged build prompt: the JS-side calendar revenue compute is best-effort and would need its own pass to be correct against effective-dated history. Stage 2 doesn't have to fix it.

---

## 4. Price type + rounding convention (the :60 question, end to end)

### 4.1 Storage + serialization - LIVE confirmed

- DB column: `price NUMERIC(12,5) NOT NULL CHECK (price >= 0)` (sc-1:130). **5 decimal places of storage.**
- supabase-js serialization (probe sample row): `price = 18.42147 (typeof = number)`. supabase-js returns NUMERIC as a JS number. Five-decimal-precise.

### 4.2 The :60 bug is live, not theoretical

**95 of 159 rows in production have > 2 decimal places** (live probe). Examples: `18.42147`, `25.95422`. These look like contract-derived prices (rounding artifacts of `contract_value / projected_count`).

The bug at `ServiceConfig.js:33` hydrates `String(Number(18.42147).toFixed(2)) = "18.42"`. Then at line 57-58, `origPrice = 18.42147` (raw from API), `newPrice = Number("18.42") = 18.42`. At line 60, `18.42 !== 18.42147` -> **always counts as a pending change**. So every time anyone opens the gear today, 95 services show as "dirty" on first render.

This is a real customer-facing-ish bug; the change-counter UI in the modal currently inflates whenever an admin opens it. It's been live since the gear shipped.

### 4.3 The cleanest convention for Stage 2

Pick ONE rounding form and use it everywhere - **on both the display and the compare**, and on **both the orchestrator's response and the editor's send**.

Recommendation:

- **Display + edit**: 2 decimal places, formatted as `"$18.42"` in the UI, and `18.42` as the JS number going into / out of the editor input.
- **Compare**: round both sides through the same helper before comparing.

The mechanic: add one helper in `src/lib/opsUtils.js` (or `src/app/service-calendar/_price.js`) - `roundCents(n) = Math.round(Number(n) * 100) / 100`. Use it:

1. In `loadAccountConfigPostgres` at line 222: `priceByServiceId.set(r.service_id, roundCents(r.price))`. Now `services[].price` returns 2-decimal numbers consistently.
2. In the new admin editor: hydrate the input from `roundCents(s.price).toFixed(2)`; on change, `Number(e.target.value)` for the in-memory new price.
3. On compare: `roundCents(origPrice) !== roundCents(newPrice)`. With the orchestrator change at step 1, both sides are already 2-decimal so the compare is degenerate, but the helper guards against future drift.
4. On write: `Number(ch.newPrice)` goes into `sc_service_prices.price` (NUMERIC(12,5) accepts it as `18.42`).

This makes the editor honest AND ALSO fixes the 95 currently-mis-displaying rows on the existing gear (whatever pass deletes the gear, this fix would be a one-line side benefit).

**Trade-off to flag**: the 5-decimal storage was deliberate - it lets contract math produce raw derived prices without precision loss. Rounding to 2 decimals at the API boundary means the editor cannot see or write 5-decimal prices. If contract-math precision matters anywhere, it's the seed script (`scripts/_seed_*`) and the import flow, not the live editor. The editor only ever displays 2-decimal prices because that's the canonical money format - the 5-decimal precision was for derivation, not human entry.

The seed script is presumably what produced the `18.42147` rows. Adding rounding at the editor boundary doesn't touch the seed. Good.

### 4.4 ServiceConfig.js:33 + :57-60 - the anti-pattern

Anti-pattern reference:

```js
// :33 - hydrate (rounds to 2 decimals as a STRING)
prices[`${grp.name}::${s.name}`] = String(Number(s.price).toFixed(2));

// :57-58 - read both sides at compare time, with mismatched precision
const origPrice = serviceGroups?.find(g => g.name === grp.name)
  ?.services.find(s => s.name === svc.name)?.price;          // 5-decimal raw
const newPrice = editPrices[key] !== undefined
  ? Number(editPrices[key]) : origPrice;                      // 2-decimal parsed

// :60 - compare
if (origPrice !== undefined && newPrice !== origPrice) {     // 18.42 !== 18.42147 -> always true
```

Don't replicate this in the new editor. Round at the orchestrator boundary so both sides of the compare are already in the same form.

---

## 5. Gear removal + ServiceConfig retirement seam (current main)

### 5.1 Anchored on origin/main `bdbde41`

| Element | Path | Lines | Notes |
|---|---|---|---|
| `ServiceConfig` import | `src/app/service-calendar/ServiceCalendar.js` | 5 | `import ServiceConfig from "./ServiceConfig";` |
| `isScAdmin` import (Stage 1) | same | 6 | Already in place. |
| `Link` import (Stage 1) | same | 4 | Already in place. |
| `showConfig` state | same | 98 | `const [showConfig, setShowConfig] = useState(false);` |
| Gear button JSX | same | 518-520 | `<button className="sc-cfg-gear" onClick={() => setShowConfig(true)} title="Service config">` |
| Stage 1 Admin link JSX | same | 521-528 | `{isScAdmin(session?.user?.email) && (<Link href="/service-calendar/admin" className="sc-admin-link" ...>Admin</Link>)}` |
| ServiceConfig overlay render | same | 1161-1175 | Conditional on `showConfig && data?.serviceGroups`, mounts inside `.sc-overlay-backdrop` / `.sc-overlay-card`. |
| `.sc-cfg-gear` CSS rules | `src/app/service-calendar/ops-sc.css` | 368-369 | The gear styles; safe to delete with the JSX. |
| `.sc-admin-link` CSS rules | same | 370-378 | Stage 1's Admin link styles; KEEP. |

### 5.2 Admin link is in place + cleanly separated

The `.sc-admin-link` block at ops-sc.css:370-378 sits immediately after `.sc-cfg-gear` at 368-369. They're separate selectors; removing the gear block doesn't touch the Admin link's styles. The JSX at ServiceCalendar.js:521-528 is structurally independent of the gear button at 518-520. **Clean removal seam.**

### 5.3 ServiceConfig.js consumers - LIVE grep'd

`grep -r "from .*ServiceConfig" src/`:

```
src/app/service-calendar/ServiceCalendar.js:5: import ServiceConfig from "./ServiceConfig";
```

**Exactly one consumer.** Same as the prior recon. Nothing new imports it.

### 5.4 What ServiceConfig.js actually hosts (all of it goes away when gear is removed)

ServiceConfig.js at HEAD bdbde41 hosts FOUR distinct flows, all forked on `isAdmin = SC_ADMINS.includes(email)` at line 9:

| Flow | Lines | Action | Status |
|---|---|---|---|
| Price edits | 39-43 (handler), 71-84 (save), 254 (Save button) | `sc-config-update` type=price | **Stage 2 owns this** - moves to admin page |
| Deactivate toggle | 45-50 (handler), 299 (button) | `sc-config-update` type=deactivate / reactivate | NOT in Stage 2 scope. Out of reach for SC_ADMINS until later stage. |
| Add new service | 86-101 (handler), 337 (Add button) | `sc-config-add` | NOT in Stage 2 scope. Out of reach for SC_ADMINS until later stage. |
| Site-lead change request | 103-115 (handler), 118-onwards (site-lead view) | `sc-config-request` -> writes to `submissions` table | NOT in Stage 2 scope. **But also unreachable in production today** - the SC page-level gate (page.js:54, `SC_ADMINS.includes(email)`) keeps non-admin users on the Coming Soon screen. So the site-lead view never renders. Confirmed by 0 rows in `submissions` where `module='service_calendar'` (prior recon, section A.8). |

### 5.5 Recommendation for Stage 2 deletes vs keeps

**Delete in Stage 2:**
- `showConfig` state at ServiceCalendar.js:98
- Gear button JSX at ServiceCalendar.js:518-520
- `ServiceConfig` import at ServiceCalendar.js:5
- ServiceConfig overlay render at ServiceCalendar.js:1161-1175
- `.sc-cfg-gear` CSS rules at ops-sc.css:368-369

**KEEP:**
- The `.sc-admin-link` JSX at ServiceCalendar.js:521-528 and CSS at ops-sc.css:370-378 (Stage 1's piece, the gate path forward).
- `SC_ADMINS` constant in `src/lib/admin.js` (still used by the SC page-level dev gate at page.js:54). Distinct from `SC_ADMIN_EMAILS`. Don't touch.

**ServiceConfig.js itself:** delete in Stage 2 as part of the same PR. Reasons:
- Only one consumer (ServiceCalendar.js:5), which is also being edited in this PR. Same blast radius window.
- Leaving it orphaned creates a "what's this file?" hazard on the next session. The recon-then-build cycles get harder with dead code lying around.
- The handle-add-service + handle-deactivate handlers are NOT being ported as-is to the admin page. The admin page will have its own editor surface; ServiceConfig.js is not the source of truth for any pattern beyond "fetch -> action-dispatch POST" which is already documented in CONVENTIONS.md.

**What removing the gear silently removes capability for (must call out in the PR description):**
- **For SC_ADMINS (k.fietek + joe) only**: deactivate / reactivate toggle and add-service flow. Both can come back as later admin-page stages. Until then, neither is reachable.
- **For non-admin users**: the change-request flow. Already unreachable in prod today (gated by the page-level Coming Soon screen, never used, 0 production rows). Removing the dead code is a net positive.

There's a parity concern worth surfacing: Stage 2 is "edit prices, today + future" but Stage 2 doesn't deliver deactivate, add-service, or change-request. So between Stage 2 merging and the later admin stages landing, those capabilities are gone for SC_ADMINS. Kevin and Joe will need to do any deactivate/add via SQL or a probe script during that window. **Acceptable if Stage 2's window is short; flag if not.**

---

## 6. Other things relevant to a price-editor build

### 6.1 All-accounts price overview - cost estimate

Live probe: SUM active services across all accounts = **103**. SUM total non-deleted = 105. The overview reads all services + their latest-as-of-today price across all 11 accounts.

Two viable shapes:

**Shape A: one orchestrator call per account.** Loop the 11 accounts, call `loadAccountConfig(accountKey)`, return shape `{ [accountKey]: { groups, services } }`. 11 round-trips, each ~3 queries inside. Workable, but chatty.

**Shape B: a new orchestrator function `loadAllAccountsConfig()`** that does:
- 1 query for `accounts` (active only)
- 1 query for `sc_service_groups` filtered by deleted_at IS NULL across all accounts
- 1 query for `sc_services` filtered by deleted_at IS NULL across all accounts
- 1 query for latest-as-of-today price per service across all 105 services

4 queries total. Total result set bounded by 11 + ~50 + 105 + 105 = ~270 rows. Comfortably under the 1000-row PostgREST page default. **No pagination needed.**

Recommend Shape B. Three reasons:
- Faster (4 RPCs vs 33).
- The latest-as-of-today price query needs the same `<= today` fix as section 3.3; build it correctly once.
- A new function leaves the existing `loadAccountConfig` untouched and unchanged in behavior (one-account read), reducing the diff and reducing blast radius on the calendar's read path.

Skeleton (don't implement; for Chat-Claude's planning):

```js
export async function loadAllAccountsConfigPostgres() {
  const supa = getServiceClient();
  const today = isoDay(new Date());
  const [accountsRes, groupsRes, servicesRes] = await Promise.all([
    supa.from("accounts").select("team_key, name, level, billing_model")
        .eq("active", true).neq("team_key", "CORP").order("team_key"),
    supa.from("sc_service_groups").select("id, account_key, group_name, sort_order, active")
        .is("deleted_at", null),
    supa.from("sc_services").select("id, account_key, group_id, service_name, " +
                                     "is_flat_fee, is_tax_free, is_non_revenue, sort_order, active")
        .is("deleted_at", null),
  ]);
  // ... validate, build per-service-id price map via one .in("service_id", ...) call
  //     with .lte("effective_date", today), order DESC, take first per service_id ...
  // ... assemble per-account groups + services array ...
  return { generatedAt: today, accounts: [{ key, name, level, billingModel, groups, services }, ...] };
}
```

### 6.2 Pagination footgun

- `sc_service_prices` total: 159 rows. Well under 1000.
- `sc_services` total: 105 rows. Well under 1000.
- A naive single-shot `loadAllAccountsConfig` price-map query is `.in("service_id", [105 uuids])` - PostgREST default limit 1000, returns at most 1000 rows. Today's 159 rows fit.

**Future-watch:** if `sc_service_prices` grows past 1000 rows (e.g. five years of effective-dated history accumulates), the bulk query becomes risky. The fix is `fetchAllPaginated` (already in the file at line 132-146). Not a Stage 2 problem; flag for the change-log stage when history starts being written aggressively.

### 6.3 GOTCHAS relevant to the price-editor

**6.3.1 - isoDay() uses LOCAL time, not UTC.**

`src/lib/dataStore/serviceCalendar.js:81-86`:

```js
function isoDay(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
```

`.getFullYear()` / `.getMonth()` / `.getDate()` return values in the local timezone. On Vercel servers, "local" is UTC. GOTCHAS.md:103-121 ("Vercel runs in UTC - date comparisons need normalization") is the documented hit pattern.

Concrete risk for Stage 2: an operator in Eastern time hits "Apply today" at 9pm local on June 18. That's June 19 02:00 UTC. The Vercel handler runs `isoDay(new Date())` = `2026-06-19`. The new price row gets `effective_date = 2026-06-19`. The operator thinks they just applied for June 18, but tomorrow's service days will pick up the new price instead of today's.

**Recommendation:** Stage 2's editor sends `effectiveDate` explicitly from the client (where local time is what the operator sees). Don't rely on the orchestrator's `isoDay(new Date())` fallback - it'll be UTC-today on Vercel. The client-side "today" is computed from `new Date().getFullYear()/getMonth()/getDate()` in the browser, which IS the operator's local clock.

Client-side, format the date as `YYYY-MM-DD` per the schema. Send that string. The server takes it verbatim.

**6.3.2 - Currency parsing from Sheets.** GOTCHAS.md:12-16. `parseNum()` in opsUtils. Not relevant for Stage 2 because the editor talks PG-direct, not Sheets, and the price arrives as a number. Mentioning for completeness.

**6.3.3 - Em-dashes in email subjects.** GOTCHAS.md:131. Not relevant; no email path in Stage 2.

**6.3.4 - The route-rename footgun.** Not in GOTCHAS.md yet (it's in the prior SC handoff). Stage 2 will write its own response shapes; don't rename orchestrator field names at the route layer. Pass through `effectiveDate` / `notes` / `serviceId` etc as-is.

### 6.4 The dual-write block is inert

Lines 990-996 of `updateServiceConfig` reference `isDualWrite(SC_TABLES.prices)`. Inert today (the body is empty - a TODO comment, no Sheets mirror code). Stage 2 should leave this alone. SC is fully PG-canonical; the cutover.js Sheets-write knob is irrelevant.

---

## Gaps - needs live verification in Supabase Studio

1. **Whether any existing `sc_service_prices` row has the `notes` column populated.** Probe sample row showed `notes = null`. If notes were never used in production, Stage 2 could surface "reason for change" as the first real consumer. Verify the population in Studio with `SELECT COUNT(*) FROM sc_service_prices WHERE notes IS NOT NULL`.

2. **The `submissions` table's `effective_date` column constraints.** Recon section A.7 flagged it as present; live verify the NOT NULL status and any indexes. Relevant if Stage 2's "future" mode wants to thread effective_date into a submissions row even when the path is the immediate-write admin flow (probably won't, but worth knowing).

3. **Whether `sc_service_prices.notes` has a CHECK length constraint.** Not visible in sc-1 schema (just `TEXT`). Stage 2 should still cap client-side; live verify there's no surprising DB-side guard.

4. **The handful of accounts at the bottom of the per-account active service counts**: 4 services for STL-MO, CIN-OH, TXR-TX-H, TXR-TX-V (all flat_fee MLB). Confirm that's expected - low-service flat-fee accounts may want a different editor layout (smaller table, no scrollbar) but that's a polish concern.

5. **What "today" is in Vercel's preview deployments**: should be UTC same as prod, but verify by running an isoDay-equivalent in a preview-only route if Stage 2 wants to cross-check the server's "today" matches a client expectation. Probably not necessary; client-supplied `effectiveDate` sidesteps this entirely.

---

## My read - the riskiest part of the Stage 2 write path

**Two things compete for "riskiest":**

### The orchestrator's "today" being UTC-today on Vercel (6.3.1)

If Stage 2 ever lets the operator hit "Apply today" without sending an explicit `effectiveDate`, the orchestrator's `today` fallback is UTC-today. An Eastern-time operator picking "today" at 8pm gets the price applied to TOMORROW. This is silent and money-moving. Mitigation: the editor MUST send `effectiveDate` explicitly, always. The orchestrator's `today` fallback should be treated as "no UI sent a date - something is wrong" and Stage 2's editor should never rely on it.

If you want belt-and-suspenders, the route can reject any `sc-config-update` price change that arrives without `effectiveDate`. Forces the UI to be explicit.

### The route's `SC_ADMINS` gate at line 439

Stage 1 added 6 corporate users who can reach the admin page. **They can't write yet** - line 439 will 403 them. The first PR that wires the admin editor must either change the gate to `isScAdmin` in the same commit, or carve a new `sc-admin-price-update` action that uses `isScAdmin`. Either works; don't ship the editor UI without one. Otherwise corporate users get a working editor that silently 403s on save and the only forensic trace is in the network tab. Build the action, ship the gate change in the same PR.

### Honourable mention: the same-date UPDATE silent overwrite

The upsert at line 936 UPDATEs an existing same-date row in place, losing the prior `price`, `created_by`, and `notes`. For a money-moving admin tool, that's a forensic gap. Two stage-2-scoped paths:

- **Soft:** the editor reject same-date re-edits, forcing operators to use a different effective date. Inconvenient but safe.
- **Hard:** Stage 2 adds the `sc_config_changelog` table + writes one row per upsert (old + new state). The trigger pattern at sc-1:295-316 is the template (BEFORE UPDATE writes to a history table) but doing it in app code is easier for one PR. The change-log table is on the Stage roadmap anyway; pulling it forward into Stage 2 means the surface is born with an audit trail.

I'd lean toward pulling the change-log forward into Stage 2. The trade is +1 migration + ~30 lines of orchestrator code + a TODO that becomes "done"; the upside is the surface is auditable from day one and same-date re-edits become safe.

End of report.
