# Section A: Identity and Auth

## A1: OAuth to user identifier

**Provider**: Google OAuth via NextAuth v5. Single provider, no local/credentials backup.

- `src/lib/auth.js:1-25` [verified] - `NextAuth({...})` exports `{ handlers, signIn, signOut, auth }`. Provider is `Google` with `clientId`/`clientSecret` from env, `access_type: "offline"`, `prompt: "consent"`, scopes: `openid email profile spreadsheets drive gmail.send`.

**JWT callback** at `src/lib/auth.js:27-84` [verified]:
- First sign-in: persists `accessToken`, `refreshToken`, `expiresAt` (Google seconds) onto the JWT.
- Subsequent requests: if `expiresAt * 1000 > Date.now()` return as-is; else `POST oauth2.googleapis.com/token` with `grant_type=refresh_token` to rotate `accessToken`.
- On refresh failure the token is returned with `error: "RefreshTokenError"` (not cleared) - the session survives with a poisoned Google token.
- No custom `token.id` / `token.sub` handling - NextAuth's defaults ride through.

**Session callback** at `src/lib/auth.js:85-89` [verified]:
```js
async session({ session, token }) {
  session.accessToken = token.accessToken;
  session.error = token.error;
  return session;
}
```
This is the entire session-shaping code. The callback does NOT touch `session.user` - so `session.user` is exactly whatever NextAuth builds from the Google `profile` (default fields: `name`, `email`, `image`) [code-read]. No `session.user.id` is populated; every downstream call site keys off `session.user.email` (16 hits verified via grep `session.user?.email` and `session.user.email`) [verified].

**Middleware gate** at `src/middleware.js:1-42` [verified]:
- `session = await auth()`; unauth requests to non-`/login`, non-`/api/auth`, non-`/api/cron` routes redirect to `/login`.
- `TEST_MODE=true` + `VERCEL !== "1"` bypasses auth entirely (Playwright hook, line 16-18).
- Matcher: `["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"]`.

**Server-side session resolution pattern**:
- `src/app/layout.js:26-30` [verified] - RootLayout calls `await auth()` on every render, extracts `email = session?.user?.email`, passes derived permissions (`canViewSousReports`, `canUseSous`) to `<TopNav>` as props. This is the ONLY place nav-visibility gates are resolved.
- Every API route follows the same pattern: `const session = await auth()` -> `const email = session.user?.email?.toLowerCase().trim()` (examples: `src/app/api/service-calendar/route.js:361-364`, `src/app/api/playbook/route.js:183-187`, `src/app/api/directory/route.js:113,139`, `src/app/api/kpi/labor/views/route.js:102-104`) [verified].

**Client-side session**: `src/app/providers.js:1-24` [verified] wraps children in `<SessionProvider>`; an `AuthSync` inner component mirrors `session.user.email` into `localStorage.kf_user_email` on every session change.

**Login page**: `src/app/login/page.js:48-53` [verified] - server-action form that calls `await signIn("google", { redirectTo: "/" })`.

**Bottom line - what identifies a user end-to-end**:
- Sole identifier: `session.user.email` (Google Workspace address).
- No opaque user id, no local `users` row link, no session-side `role`, no session-side `person_id`.
- Owner of this module: `src/lib/auth.js` (auth config), `src/middleware.js` (gate), `src/app/providers.js` (client mirror), `src/app/layout.js` (server layout that runs the nav-visibility resolvers).

## A2: Session to people row

**Verdict up front**: `people.work_email` IS the intended join key from session -> person, and it is the ONLY working join today. There is NO `user_id` mapping from session to people. For hourly staff it fails silently (no work_email -> no match -> resolved role = null / anonymous).

**Session -> person lookup, as implemented today**:

The canonical join is in `src/lib/kpi/roleGate.js:157-198` [verified]:

```js
const leadQ = await supa
  .from("people")
  .select("worker_id, account_key, status")
  .eq("status", "ACTIVE")
  .eq("is_site_leader", true)
  .ilike("work_email", e);   // e = normalized session email

const mgrQ = await supa
  .from("people")
  .select("worker_id, account_key")
  .eq("status", "ACTIVE")
  .eq("worker_class", "salaried")
  .not("account_key", "is", null)
  .neq("account_key", "CORP")
  .ilike("work_email", e);
```

The join uses `ilike("work_email", session_email)` with a `status = 'ACTIVE'` gate as belt-and-suspenders against seasonal-rehire duplicates. Comments at `src/lib/kpi/roleGate.js:26-33, 150-165` explicitly discuss the seasonal-rehire trap: seasonal staff get a new `worker_id` each rehire but keep the `work_email`, so `ACTIVE` is load-bearing; the resolver throws if it sees >1 active row for the same email [verified].

**The view that models the "session -> account" join**:

`docs/migrations/user-accounts-derived.sql:87-105` [verified]:

```sql
CREATE OR REPLACE VIEW user_accounts_derived AS
  SELECT work_email AS email, account_key AS account
  FROM people
  WHERE status = 'ACTIVE'
    AND work_email IS NOT NULL
    AND account_key IS NOT NULL
  UNION
  SELECT m.email, m.account
  FROM user_accounts_manual m
  WHERE NOT EXISTS (
    SELECT 1 FROM people p
    WHERE p.status = 'ACTIVE'
      AND p.work_email IS NOT NULL
      AND LOWER(p.work_email) = LOWER(m.email)
  );
```

Verified owner-recorded row count [verified from migration doc]: the derived view returned 35 rows as of 2026-08-28 (`user-accounts-table-drop.sql:8-14`) - 32 from `people.work_email + account_key` (ACTIVE) + 3 from the manual overlay (Kevin, Joe, Mariela - all CORP - `user-accounts-derived.sql:65-69`).

Read from `src/app/api/service-calendar/route.js:410-437` [verified] - single call site:
```js
supa.from("user_accounts_derived").select("account").ilike("email", email).limit(1)
```

**Trusted join spec (salaried)**:

```sql
SELECT p.worker_id, p.account_key, p.display_name, p.title, p.worker_class
FROM people p
WHERE p.status = 'ACTIVE'
  AND p.work_email IS NOT NULL
  AND LOWER(p.work_email) = LOWER(:session_email)
LIMIT 1;
```

Load-bearing filters (from `src/lib/kpi/roleGate.js:147-165` comments) [verified]:
- `status = 'ACTIVE'` - defeats seasonal-rehire and terminated-row shadowing.
- `work_email IS NOT NULL` - the column is nullable in `people-1-table.sql:72`.
- Case-insensitive (`ilike` / `LOWER=LOWER`) - the derive comment notes emails are typically lowercased by Rippling but callers must not assume.

**Where it breaks for hourly**:

The prompt's premise (only ~30 salaried carry `work_email`; all 105 active people carry `personal_email`) is consistent with `docs/migrations/people-1-table.sql:72-73, 118-121` [verified]:
- `work_email TEXT` (nullable).
- `personal_email TEXT` with column comment: `'PII. Stored for a future opt-in workflow; NEVER selected by any application route. work_email is the safe address for internal surfaces.'`

So for hourly staff:
1. `people.work_email IS NULL` -> the `ilike` join returns zero rows.
2. `resolveKpiRole()` in `src/lib/kpi/roleGate.js:198-202` returns `null` -> the caller treats them as "no access" [verified].
3. `user_accounts_derived` excludes them (WHERE clause requires `work_email IS NOT NULL`) [verified] -> SC `defaultAccount` falls back to `CIN-AZ` [verified from route.js:432-434 comment "user_accounts_derived / contacts missing or query failed - swallow. Frontend falls back to CIN-AZ + Season default landing"].
4. `personal_email` cannot substitute per its column comment ("NEVER selected by any application route") - that is a policy fence, not a technical one, but no code today does the substitution [code-read - grepped for `.eq("personal_email"`, `.ilike("personal_email"` - zero hits in `src/`].

**Is there a `user_id` mapping session -> person?** No.
- `people.user_id` exists as a column (`people-1-table.sql:63` [verified]) but it stores the Rippling user rippling_id, not the NextAuth/Google identity. It is used inside `src/lib/kpi/resolveWorkerMeta.js:49-59` to join `people`'s Rippling user_id to `rippling_raw_users_latest.rippling_id` for name resolution [verified], never against a session user id.
- Session has no id. The only path from a Google login to a `people` row is email.

**Additional consumers of the same email->people/contacts join**:
- `contacts` table: `src/lib/opdAcl.js:293-306` [verified] - `isCorporateEmail(email)` does `sb.from('contacts').select('team_key').ilike('email', email).limit(1)` and checks `team_key === 'CORP'`. This is the audience source of truth per opdAcl comment lines 22-23 (`SWAP POINT` calling out that today `contacts.team_key = 'CORP'` is the corp membership signal, to be swapped for `users.role` when `AUTH_MODEL.md` ships).
- SC route action `sc-accounts` also joins `contacts` by email to return the user's `role` array (free-text titles) - `src/app/api/service-calendar/route.js:421,426-430` [verified].

## A3: opdAcl.js gates

File: `src/lib/opdAcl.js` (315 lines) [verified read end-to-end].

Full inventory of exported predicates:

**1. `PLAYBOOK_OWNER` (constant, line 33)** [verified]
```js
export const PLAYBOOK_OWNER = 'k.fietek@kitchfix.com';
```

**2. `canViewPlaybook(actualEmail)` (line 35-37)** [verified]
```js
export function canViewPlaybook(actualEmail) {
  return (actualEmail || '').toLowerCase() === PLAYBOOK_OWNER;
}
```
Owner-only. Kevin's email exact match. Widen at launch per header comment. Callers: `src/app/api/playbook/route.js:188, 636`, `src/app/playbook/admin/AdminClient.js`, and delegated through `canUseSous(email, "panel")`.

**3. `SOUS_REPORTS_DEFAULT_VIEWERS` (constant, line 57)** [verified] - `['k.fietek@kitchfix.com']` as the fail-closed default when env is empty.

**4. `canViewSousReports(actualEmail)` (line 68-73)** [verified]
```js
export function canViewSousReports(actualEmail) {
  const email = (actualEmail || '').toLowerCase().trim();
  if (!email) return false;
  const allowlist = parseSousReportsViewers(process.env.SOUSAI_REPORTS_VIEWERS);
  return allowlist.includes(email);
}
```
Env-var allowlist (`SOUSAI_REPORTS_VIEWERS`, comma-separated), fail-closed to Kevin-only when unset/empty. Callers: `src/app/layout.js:29`, `src/app/sousai/reports/page.js:329`, `src/app/api/sousai/chips/route.js:79`.

**5. `SOUS_PREVIEW_ALLOWLIST` (mutable Set, line 137-139)** [verified]
```js
export const SOUS_PREVIEW_ALLOWLIST = new Set([
  'k.fietek@kitchfix.com',
]);
```
Live Set (exported deliberately mutable so tests can empty/restore per `opdAcl.test.js:28-30`). Kevin only, until SLT demo.

**6. `canUseSous(email, surfaceOrDeps, maybeDeps)` (line 141-176)** [verified]
Surface-aware. Two surfaces:
- `"panel"` (Playbook side-panel): delegates entirely to `canViewPlaybook(email)`. Same gate as the Playbook itself.
- `"page"` (default, `/sous` standalone): if `SOUS_PREVIEW_ALLOWLIST.size > 0`, only allowlist members pass; otherwise the pre-lock logic: `viewerTier(email) === 'slt' || await isCorporateEmail(email)`.

**7. `SLT_EMAILS` (Set, line 200-207)** [verified] - 6 members (Kevin, Josh, Joe, Britt, Mariela Chavez, Sebastian Castro). "6 members confirmed against contacts.team_key='CORP' 2026-06-16."

**8. `RESTRICTED_EMAILS` (Set, line 213-217)** [verified] - 3 members (Ryan Moore, Shane Lynch, Dec Inthavone).

**9. `ACCESS_ORDER` (frozen numeric ranking, line 222-226)** [verified] - `{ unrestricted: 1, restricted: 2, slt: 3 }`.

**10. `viewerTier(email)` (line 236-241)** [verified]
```js
export function viewerTier(email) {
  const lower = (email || '').toLowerCase().trim();
  if (SLT_EMAILS.has(lower)) return 'slt';
  if (RESTRICTED_EMAILS.has(lower)) return 'restricted';
  return 'unrestricted';
}
```
Highest tier the email qualifies for; any authenticated `@kitchfix.com` user not in SLT/RESTRICTED defaults to `unrestricted`.

**11. `canSeeDoc(viewerT, docAccessLevel)` (line 254-260)** [verified] - hierarchical numeric compare; viewer rank >= doc rank -> allowed. Fail-closed on unknown values.

**12. `allowedAccessLevels(viewerT)` (line 267-271)** [verified] - returns array of `access_level` values the viewer may see, shaped for the `match_document_chunks` RPC's `allowed_levels TEXT[]` arg.

**13. `visibleStatuses(isCorporate)` (line 274-279)** [verified] - corporate: `['Live', 'In Build', 'Draft', 'Pending', 'Placeholder', 'Blocked']`; everyone else: `['Live']`. Retired always excluded (STD-005 §3.5 per comment line 12).

**14. `filterDocuments(documents, isCorporate)` (line 282-287)** [verified] - synchronous filter over a catalog row array based on `visibleStatuses`.

**15. `isCorporateEmail(email)` (line 293-306)** [verified] - async, single DB lookup:
```js
sb.from('contacts').select('team_key').ilike('email', email).limit(1);
```
Returns true iff `team_key === 'CORP'`. **Fails CLOSED** on lookup error. This is the one async predicate in the file.

**16. `visibleDocumentsForUser(email, documents)` (line 311-314)** [verified] - convenience wrapper: `filterDocuments(documents, await isCorporateEmail(email))`.

**Distinction owner-only vs role-based**:
- Owner-only: `canViewPlaybook`, `canViewSousReports` (default), and (via delegation) `canUseSous(_, "panel")`.
- Preview-locked (owner-only in effect today, mechanically an allowlist): `canUseSous(_, "page")` while `SOUS_PREVIEW_ALLOWLIST` is non-empty.
- Role/tier-based: `viewerTier` + `canSeeDoc` + `allowedAccessLevels` (3-tier: unrestricted/restricted/slt) with membership hardcoded in `SLT_EMAILS` (6) and `RESTRICTED_EMAILS` (3).
- Corporate-domain based: `visibleStatuses` + `filterDocuments` + `isCorporateEmail` (contacts.team_key=CORP).

## A4: user_accounts family

**Population**:
- `user_accounts` (the old hand-maintained table): originally seeded from `docs/migrations/sc-3-user-accounts-seed.sql` [verified], `INSERT INTO user_accounts (email, account) SELECT ...`. **The table has been DROPPED in production** per `docs/migrations/user-accounts-table-drop.sql` (owner-verified live 2026-08-28) [verified].
- `user_accounts_derived` (view): DERIVED at read time from (a) `people` ACTIVE rows with non-null `work_email + account_key`, UNION (b) `user_accounts_manual` overlay rows whose email isn't already in ACTIVE people. Auto-tracks Rippling. See `docs/migrations/user-accounts-derived.sql:87-105` [verified].
- `user_accounts_manual` (table): owner-maintained overlay. Three seeded rows [verified from `user-accounts-derived.sql:65-69`]: Joe, Kevin, Mariela - each mapped to `CORP` with a `reason` column. `email TEXT PRIMARY KEY`, plus `account`, `reason`, `added_at`, `added_by`. Writes are Studio-only today (no in-app write path found in grep).

**Consumption**:
- The ONLY runtime read site in `src/` is `src/app/api/service-calendar/route.js:420` [verified]:
  ```js
  supa.from("user_accounts_derived").select("account").ilike("email", email).limit(1)
  ```
- Returned to the SC client as `defaultAccount` (frontend auto-selects on mount, falls back to `CIN-AZ` when unmatched, see comments at route.js:390-393 and 432-434) [verified].
- The KPI role gate does NOT read from `user_accounts_derived` - it hits `people` directly (`src/lib/kpi/roleGate.js:157-190`) [verified]. There is a historical dependency: `docs/migrations/salary-1c-kpi-roles.sql:88-96` seeded initial `kpi_roles` rows from the (now-dropped) `user_accounts` table.
- `SousAI` code, `Playbook` code, `Directory` code, and every other route grep-hit is comment-only [verified].

**Verdict for Academy reuse**:

**Do not reuse `user_accounts_derived` as a scoping model for Academy.** It is a single-account-per-user projection (one row per email, one `account_key`) whose sole purpose is landing-account resolution for the Service Calendar. It cannot express multi-account assignment (Regional covering STL-MO + CIN-OH + CIN-KY), role identity, or capability. It IS the current mapping of who-lives-where and can be READ as a person's home account, but it is not a scoping spine.

**No conflict with `people.account_key` because `user_accounts_derived` IS `people.account_key`.** The view's ACTIVE branch literally selects `work_email AS email, account_key AS account FROM people WHERE status='ACTIVE'`. If Academy joins on `people` directly it gets the same data plus every other column (worker_class, is_site_leader, department_id, manager_worker_id, display_name, title, status). The overlay adds three CORP addresses that lack a Rippling worker.

**Recommendation call**: Academy should join on `people.work_email` (with the same `ilike + status='ACTIVE' + NOT NULL` discipline the KPI role gate uses) rather than the view. If Academy needs multi-account assignment it needs its own mapping table - none of `user_accounts`, `user_accounts_derived`, or `user_accounts_manual` supports multi-account rows today.

## A5: Role model

**What exists beyond owner-only**:

**1. KPI role gate (LOAD-BEARING, active).** `src/lib/kpi/roleGate.js:83-244` [verified]. This IS the real role model in production today. Four roles resolved with first-match-wins:

| Rank | Role | Source | Scope |
|------|------|--------|-------|
| 1 | `corporate` | `kpi_roles.role='corporate'` | none (`ALL`) |
| 2 | `rdo` | `kpi_roles.role='rdo'` | region (`East` / `West`) |
| 3 | `site_leader` | `people.is_site_leader=true` (owner-maintained flag) | `people.account_key` |
| 4 | `site_manager` | `people.worker_class='salaried'` + `ACTIVE` + `account_key IS NOT NULL` + `account_key <> 'CORP'` | `people.account_key` |
| - | null | otherwise | no access |

Backing tables:
- `kpi_roles(email PK, role CHECK IN corporate/rdo/site, scope, can_see_salary, created_by, created_at)` from `docs/migrations/salary-1c-kpi-roles.sql:62-68` [verified]. Note: the CHECK admits `'site'` but the resolver ignores it (comment at roleGate.js:103-106 explains "kpi_roles.role='site' is superseded by people. Ignore any residual rows before the cleanup migration runs").
- `people.is_site_leader BOOLEAN`, `people.worker_class TEXT`, `people.account_key TEXT`, `people.status TEXT` from `docs/migrations/people-1-table.sql:83-96` [verified].
- Salary suppression is a separate axis: `can_see_salary` column on `kpi_roles` (role-gates-2 per line 84-94 comments) [verified].

**PREVIEW FENCE**: `KPI_PREVIEW_ONLY = true` (`src/lib/kpi/roleGate.js:69-70`) [verified] - hardcoded constant currently gates the whole model to `KPI_PREVIEW_ALLOWLIST = ["k.fietek@kitchfix.com"]`. Kevin flips this to `false` to open the board. So the machinery is complete but not yet live for non-Kevin users.

**2. Hardcoded allowlists for feature gates (all in `src/lib/admin.js`)** [verified]:
- `OPS_LEADERSHIP_EMAILS` (6 members: Kevin, Wasserman, Britt, Joe, Josh, Mariela) - line 5-12.
- `SC_ADMINS` (2 members: Kevin, Joe) - line 30-33.
- `SC_ADMIN_EMAILS` (frozen Set, 8 members: Kevin, Josh, Joe, Britt, Mariela, Sebastian, Ryan Moore, Shane Lynch) - line 60-69. With normalized helper `isScAdmin(email)` at line 77-78.
- `SC_LOCK_OVERRIDE` (frozen Set, 3 members: Kevin, Joe, Sebastian) - line 109-113. Helper `isScLockOverride(email)` at line 120-121.

**3. Hardcoded allowlists in `src/lib/opdAcl.js`** [verified]:
- `SLT_EMAILS` (6 members, same as SC_ADMIN_EMAILS minus RDOs and Wasserman).
- `RESTRICTED_EMAILS` (3 members: two RDOs + Inthavone).
- `PLAYBOOK_OWNER` (1 person).
- `SOUS_PREVIEW_ALLOWLIST` (1 person, mutable Set).

**4. Env-var allowlists** [verified]:
- `SOUSAI_REPORTS_VIEWERS` (comma-separated emails, parsed by `parseSousReportsViewers`, fail-closed to `SOUS_REPORTS_DEFAULT_VIEWERS = ['k.fietek@kitchfix.com']`).
- `DIRECTORY_ADMIN_EMAILS` (`src/app/api/directory/route.js:280-292`).

**5. `contacts` role field (free-text titles)** [verified]:
- `src/app/api/service-calendar/route.js:426-430` [verified] returns `contacts.role` as an array to the client. Free-text job titles (Executive Chef, Sous Chef, CEO, VP Operations, Regional Director East/West, etc. per `docs/GOTCHAS.md:854`). Comment at route.js:394-398 [verified]: "A user can have multiple contacts rows (one per role/account combo)... we return ALL roles and let the client apply the floor-wins tiebreaker via computeInitialView for intent-aware landing."
- `contacts.team_key = 'CORP'` is used by `opdAcl.isCorporateEmail()` as the corporate-domain signal (`src/lib/opdAcl.js:293-306`) [verified].

**Where site-leader / RDO / corporate distinctions come from today**:
- `site_leader`: `people.is_site_leader = true` (owner-maintained boolean, one leader per account enforced by partial unique index `people_one_leader_per_account`) [verified from `people-1-table.sql:92-93, 153-154`].
- `rdo` (Regional): `kpi_roles.role = 'rdo'` with `scope = 'East'|'West'` - 2 seeded rows (Shane Lynch, Ryan Moore) per `salary-1c-kpi-roles.sql:82-86` [verified].
- `corporate`: `kpi_roles.role = 'corporate'` - 3 seeded rows (Kevin, Josh/j.katt, Joe/j.lessard) per `salary-1c-kpi-roles.sql:73-79` [verified]. AND separately: `contacts.team_key = 'CORP'` for the opdAcl audience signal [verified].

**What DOES NOT exist**:
- No `users` table populated. `AUTH_MODEL.md` specs one, `docs/GOTCHAS.md:854` explicitly notes "the `users` table (which exists but is EMPTY)" [verified from GOTCHAS grep]. The spec-time three-table model (users, user_accounts, accounts) never got built as spec'd - what shipped is `people` + `kpi_roles` + the derived view.
- No session-side role field. `session.user` has no `role` / `is_admin` / `scope` - every consumer re-resolves from email on each request.
- No general-purpose `hasRole(email, role)` helper. The KPI gate is KPI-specific; the SC gates are SC-specific; opdAcl gates are OPD-specific.
- No RLS enforcement. Comment at `src/lib/opdAcl.js:11-12` [verified]: "all app-layer (Postgres uses the service-role client, which bypasses RLS - so RLS cannot be the boundary today)".

## Contradictions with the prompt's Section 1 facts

- **"Only 30 active salaried carry a `work_email`, while all 105 active people carry a `personal_email`"** - I could not verify these exact counts from source alone (no live DB access in this session). What I CAN verify:
  - The schema allows `work_email` to be null (`people-1-table.sql:72`) [verified].
  - `personal_email` exists with a "NEVER selected by any application route" policy comment (`people-1-table.sql:118-121`) [verified].
  - `user_accounts_derived` returned 35 rows at 2026-08-28 (32 from people + 3 from overlay), which is consistent with roughly-30-salaried-plus-a-handful, not with 105 [verified from `user-accounts-table-drop.sql:9-14`].
  - The KPI gate's `is_site_leader` count is 11 (`docs/migrations/salary-1c-kpi-roles.sql` comments at line 20 note "11 seeded site leaders"). If 11 site leaders exist and only ~30 rows total appear in the derived view, that's compatible with the prompt's premise. No contradiction, just no direct verification of the exact numbers.
- **"opdAcl.js" nomenclature** - the file exists at exactly `src/lib/opdAcl.js` [verified]; no `opd-acl.js` or `opdACL.js` variants found.
- **"user_accounts, user_accounts_derived, and user_accounts_manual"** - flag: `user_accounts` (the base hand-maintained table) was DROPPED in production per `user-accounts-table-drop.sql` (owner-verified 2026-08-28). Only the view and the manual overlay survive live. If the spec assumes all three exist, that assumption is stale.

## Completeness map

| Item | Status |
|------|--------|
| A1 auth.js contents + callbacks | [verified] - file read end-to-end. |
| A1 middleware gate | [verified] - file read end-to-end. |
| A1 layout.js session use | [verified] - file read end-to-end. |
| A1 providers.js client mirror | [verified] - file read end-to-end. |
| A1 session.user has no `id` field | [code-read] - inferred from the session callback body (only sets `accessToken` + `error`) plus 16-hit grep showing every call site keys on `email`; not proved by inspecting `next-auth` defaults. |
| A2 `people` join uses `ilike("work_email", session_email)` + `status='ACTIVE'` | [verified] - `src/lib/kpi/roleGate.js:157-198` read. |
| A2 `user_accounts_derived` view SQL | [verified] - migration file read. |
| A2 hourly staff lack `work_email` -> resolver returns null | [code-read] - schema allows nullable, no code substitutes personal_email. Not measured against a live DB. |
| A2 `personal_email` policy | [verified] - column comment read. |
| A2 no session -> user_id link | [verified] - grepped, no hits for user id lookup on session. |
| A3 all 16 opdAcl exports | [verified] - file read end-to-end. |
| A3 caller sites for each predicate | [verified] - grep confirmed each site. |
| A4 user_accounts_manual seed | [verified] - migration file read. |
| A4 user_accounts_derived view | [verified] - migration file read. |
| A4 user_accounts table dropped in prod | [verified] - drop migration file read, owner attestation in comments. |
| A4 sole read site is SC | [verified] - grep of `user_accounts_derived` across `src/`. |
| A4 verdict on Academy reuse | [code-read] - inferred from shape (one row per email, one account) and comments; not stress-tested against a spec document. |
| A5 KPI role gate model | [verified] - roleGate.js read end-to-end + migration read. |
| A5 KPI_PREVIEW_ONLY fence live | [verified] - constant at line 69 confirmed true in checked-out main. |
| A5 all admin.js allowlists | [verified] - file read end-to-end. |
| A5 no `users` table populated | [code-read] - relies on GOTCHAS.md note ("users table exists but is EMPTY"), grep found no writes to a `users` table anywhere in `src/`. Not measured against live DB. |
| A5 RLS not enforced | [verified] - opdAcl.js header comment explicit; service-role client bypasses RLS. |
| Exact salaried vs hourly counts (30/105) | not verified - would require live Supabase query. Would promote by running `SELECT COUNT(*) FROM people WHERE status='ACTIVE' AND work_email IS NOT NULL` and same with personal_email. |
