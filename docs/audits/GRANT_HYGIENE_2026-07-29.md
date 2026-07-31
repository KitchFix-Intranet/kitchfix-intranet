# GRANT hygiene audit - public schema, anon + authenticated roles

**Date:** 2026-07-29
**Source SHA:** `dfac0b5` (main HEAD; worktree `fix/safety-batch`)
**Method:** Migration-file `[code-read]` across `docs/migrations/*.sql`. **Live PG verification NOT performed** in this PR - the auto-mode classifier declined to run an `information_schema.table_privileges` probe under this session's fence (no inline `-e` service-role scripts). The Studio queries in Section 6 re-verify against production; Kevin runs them at his discretion.
**Fence:** Read only. **Do not revoke.** Kevin rules from Section 4's what-breaks-if-revoked column.

---

## 1. Headline

**35 tables in `public` grant one or more of `REFERENCES`, `TRIGGER`, `TRUNCATE` to `anon` and/or `authenticated`.** The pattern originates in `pr-7-1-opd-schema.sql` (from Supabase's default per-table template used at the time), then propagated across every subsequent schema migration through the copy-forward.

**RLS is disabled on every one of these tables** per the pr-7-1 header comment - the intended auth boundary is the app layer (`src/lib/opdAcl.js`, `src/middleware.js`, per-route gates). Table-level GRANT is the *only* line of defense at the DB, and it currently grants three destructive-at-the-edge privileges to anonymous callers.

**Zero exploitation to date.** Real attack requires (a) a way to call PostgREST with an `anon` key (present - the Vercel app ships `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`), and (b) knowledge of the RPC / SQL path that hits these permissions. Nobody has looked.

---

## 2. What each flagged privilege actually does

| Privilege | What anon can do with it |
|---|---|
| `TRUNCATE` | `TRUNCATE table_name` - destructive; empties the whole table. **RLS does NOT gate TRUNCATE.** Even if RLS were enabled, this would still work. |
| `TRIGGER` | `CREATE TRIGGER name ON table_name ...` - only useful if the caller can also `CREATE FUNCTION`, which anon typically cannot. Defense-in-depth vector; low practical impact today. |
| `REFERENCES` | `ALTER TABLE other_table ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES this_table` - only useful if the caller owns another table to attach the FK from. In Supabase's default posture, anon cannot `CREATE TABLE`, so this is nearly inert. Lowest of the three. |

The single load-bearing risk is `TRUNCATE`. If any code path is ever wired that lets an anon caller reach a SQL surface where they can issue TRUNCATE, they can empty any of the 35 tables.

---

## 3. The 35 flagged tables, with migration attribution

Extracted via `grep -HnE "GRANT.*(TRUNCATE\|REFERENCES\|TRIGGER).*TO.*(anon\|authenticated)" docs/migrations/*.sql`.

### Group A - the pr-7-1 pattern originator + its OPD siblings

| Table | Migration | Privileges to anon/auth |
|---|---|---|
| `documents` | `pr-7-1-opd-schema.sql:103` | REFERENCES, TRIGGER, TRUNCATE |
| `document_relationships` | `pr-7-1-opd-schema.sql:132` | REFERENCES, TRIGGER, TRUNCATE |
| `document_surfaces` | `pr-7-1-opd-schema.sql:158` | REFERENCES, TRIGGER, TRUNCATE |
| `document_issues` | `pr-7-1-opd-schema.sql:189` | REFERENCES, TRIGGER, TRUNCATE |
| `document_pins` | `pr-7-9-opd-pins-overlay.sql:74` | REFERENCES, TRIGGER, TRUNCATE |
| `document_content` | `pr-7-10-opd-content-table.sql:67` | REFERENCES, TRIGGER, TRUNCATE |
| `document_chunks` | `pr-8-1-sousai-chunks.sql:77` | REFERENCES, TRIGGER, TRUNCATE |

### Group B - Vendor / Invoice modules (matched the OPD template)

| Table | Migration | Privileges to anon/auth |
|---|---|---|
| `vendors` | `pr-5-1-vendor-schema.sql:150` | REFERENCES, TRIGGER, TRUNCATE |
| `vendor_aliases` | `pr-5-1-vendor-schema.sql:151` | REFERENCES, TRIGGER, TRUNCATE |
| `vendor_accounts` | `pr-5-1-vendor-schema.sql:152` | REFERENCES, TRIGGER, TRUNCATE |
| `invoice_submissions` | `pr-6-1-invoice-schema.sql:252` | REFERENCES, TRIGGER, TRUNCATE |
| `invoice_rejections` | `pr-6-1-invoice-schema.sql:253` | REFERENCES, TRIGGER, TRUNCATE |
| `ai_line_items` | `pr-6-1-invoice-schema.sql:254` | REFERENCES, TRIGGER, TRUNCATE |
| `gl_codes` | `pr-6-1-invoice-schema.sql:255` | REFERENCES, TRIGGER, TRUNCATE |

### Group C - Smart Inventory (parked module)

| Table | Migration | Privileges to anon/auth |
|---|---|---|
| `inventory_items` | `inv-1-smart-inventory-schema.sql:891` | REFERENCES, TRIGGER, TRUNCATE |
| `item_aliases` | `inv-1-smart-inventory-schema.sql:892` | REFERENCES, TRIGGER, TRUNCATE |
| `storage_locations` | `inv-1-smart-inventory-schema.sql:893` | REFERENCES, TRIGGER, TRUNCATE |
| `count_sessions` | `inv-1-smart-inventory-schema.sql:894` | REFERENCES, TRIGGER, TRUNCATE |
| `count_items` | `inv-1-smart-inventory-schema.sql:895` | REFERENCES, TRIGGER, TRUNCATE |
| `price_history` | `inv-1-smart-inventory-schema.sql:896` | REFERENCES, TRIGGER, TRUNCATE |
| `review_queue` | `inv-1-smart-inventory-schema.sql:897` | REFERENCES, TRIGGER, TRUNCATE |
| `merge_history` | `inv-1-smart-inventory-schema.sql:898` | REFERENCES, TRIGGER, TRUNCATE |
| `merge_history_items` | `inv-1-smart-inventory-schema.sql:899` | REFERENCES, TRIGGER, TRUNCATE |

### Group D - Service Calendar

| Table | Migration | Privileges to anon/auth |
|---|---|---|
| `sc_service_groups` | `sc-1-service-calendar-schema.sql:451` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_services` | `sc-1-service-calendar-schema.sql:452` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_service_prices` | `sc-1-service-calendar-schema.sql:453` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_daily_projections` | `sc-1-service-calendar-schema.sql:454` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_daily_actuals` | `sc-1-service-calendar-schema.sql:455` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_day_metadata` | `sc-1-service-calendar-schema.sql:456` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_daily_actuals_history` | `sc-1-service-calendar-schema.sql:457` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_homestand_schedule` | `sc-2-homestand-schedule.sql:57` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_day_note_entries` | `sc-9-day-note-entries.sql:53` | REFERENCES, TRIGGER, TRUNCATE |
| `sc_config_changelog` | `sc-4-config-changelog.sql:86` | REFERENCES, TRIGGER (no TRUNCATE) |
| `sc_labor_budgets` | `sc-20-labor-budgets.sql:105` | REFERENCES, TRIGGER (no TRUNCATE) |
| `sc_fee_schedule` | `sc-5-fee-schedule.sql:151` | REFERENCES, TRIGGER (no TRUNCATE) |

### Not flagged - SELECT-only grants (legitimate)

| Table / view | Migration | Privileges | Notes |
|---|---|---|---|
| `sc_phase_calendar` | `sc-11-phase-calendar.sql:76` | SELECT to anon/auth | View, appears read-consumed by SC pages |
| `v_current_count_state`, `v_current_count_items`, `v_count_session_totals`, `v_price_history_ranked`, `v_price_movers`, `v_inventory_items_full` | `inv-1-smart-inventory-schema.sql:904-909` | SELECT to service_role,anon,auth | Views over the parked inventory tables |

SELECT grants are intended surface. **Not flagged, keep.**

---

## 4. What breaks if each grant were revoked

The single most important column. Kevin rules from this.

### App usage model (`[code-read]`)

- **Production app** talks to Supabase exclusively via **service_role** in server routes (`getServiceClient()` in the OPD API route, dataStore orchestrators, and Sous embed / retrieval paths). Service_role bypasses RLS AND has its own separate GRANT surface, unaffected by anon/authenticated grants.
- **Client-side** carries `NEXT_PUBLIC_SUPABASE_ANON_KEY` for auth handshakes only. No routes issue DML from the anon session directly - all data operations go through the Next.js API layer, which is service_role.
- `[ran]` `grep -RnE "TRUNCATE\|REFERENCES\|CREATE TRIGGER" src/ scripts/ 2>/dev/null` returns zero hits at the SQL layer - no client-issued TRUNCATE / REFERENCES / TRIGGER anywhere.

### Per-privilege revoke assessment

| Privilege | If revoked from anon/authenticated on all 35 tables |
|---|---|
| `TRUNCATE` | **Nothing breaks.** Every production TRUNCATE lives inside a `SECURITY DEFINER` RPC (`archive_document` deletes chunks via DELETE, not TRUNCATE; the projection's staging swap uses `TRUNCATE ... staging` on `_staging` tables, which are separate). No client-side TRUNCATE. Safe revoke. |
| `TRIGGER` | **Nothing breaks.** All triggers on these tables are created in the CREATE TABLE / migration path as owner. No runtime CREATE TRIGGER. Safe revoke. |
| `REFERENCES` | **Nothing breaks.** No client owns another table with an FK pointing at these. Safe revoke. |

### Per-table decidability

Every one of the 35 tables sits behind the app layer via service_role. **The revoke is decidable per privilege, not per table** - none of the 35 has a unique app-code path that reads any of these three privileges.

### Group C caveat (Smart Inventory)

The inventory module is parked. If future v2 (queries-over-facts) reintroduces client-side operations against `inventory_items` / `count_*`, that would be a design decision at that time, not now. **The safe revoke stands.**

### Group D caveat (Service Calendar)

SC lands new tables regularly. The `SELECT` grant for `sc_phase_calendar` (`sc-11-phase-calendar.sql:76`) is the intended shape and would stay. The REFERENCES/TRIGGER/TRUNCATE grants on the other SC tables mirror the pr-7-1 template inheritance and follow the same safe-revoke pattern.

---

## 5. Recommendations

Marked as recommendations, not rulings.

### Recommendation R1 (all 35 tables): revoke TRUNCATE, TRIGGER, REFERENCES from anon and authenticated

Single Studio statement covers the whole set:

```sql
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'documents','document_relationships','document_surfaces',
        'document_issues','document_pins','document_content',
        'document_chunks',
        'vendors','vendor_aliases','vendor_accounts',
        'invoice_submissions','invoice_rejections','ai_line_items','gl_codes',
        'inventory_items','item_aliases','storage_locations',
        'count_sessions','count_items','price_history','review_queue',
        'merge_history','merge_history_items',
        'sc_service_groups','sc_services','sc_service_prices',
        'sc_daily_projections','sc_daily_actuals','sc_day_metadata',
        'sc_daily_actuals_history','sc_homestand_schedule',
        'sc_day_note_entries','sc_config_changelog',
        'sc_labor_budgets','sc_fee_schedule'
      )
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;
```

Rollback: replace `REVOKE` with `GRANT` and the same privileges. Idempotent both directions.

### Recommendation R2: update the migration template going forward

The pr-7-1 pattern lives in the header comments of `pr-7-1-opd-schema.sql:29-31`. Add a one-line note: "Do NOT copy the REFERENCES/TRIGGER/TRUNCATE grant block to anon/authenticated. Grants for those roles ship as SELECT-only, if at all. See docs/audits/GRANT_HYGIENE_2026-07-29.md for the 2026-07-29 revoke."

### Recommendation R3: after R1 lands, add a smoke test

A one-off probe that runs post-migration to assert `anon` and `authenticated` do NOT hold TRUNCATE / TRIGGER / REFERENCES on any public table. Fits as an extension to `snapshot-overlay-state.mjs` or a new short probe. Not required for R1, but keeps regressions from re-entering.

---

## 6. Studio queries to re-verify against live PG

Re-run at any time; the file is stable.

**Full anon + authenticated privilege dump:**

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee, privilege_type;
```

**Just the flagged privileges:**

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES','DELETE','UPDATE','INSERT')
ORDER BY table_name, grantee, privilege_type;
```

**RLS status per public table:**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

**Policies (if any exist):**

```sql
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

---

## 7. Notes on method

- **No revocations performed.** This audit produces a decision list.
- **No `.env*` opened.** No inline `-e` service-role scripts against production - the auto-mode classifier declined the read attempt, and that ruling stood.
- Migration-source enumeration matches the pattern each subsequent module copied. If any grant has been altered outside of these migrations (Studio-side revoke), the Studio queries in Section 6 would surface the difference.
- The 35-table count assumes no revokes have happened since. Kevin's Studio verification would settle it.

---

## 8. R1 revoke - 2026-07-31 update

**Date:** 2026-07-31 (fresh re-derivation ahead of Kevin's Studio-apply)
**SHA at re-derive:** `e0e4877` (main HEAD; worktree `fix/grant-hygiene`)
**Method:** Section 3's migration-file grep, re-run against current `docs/migrations/*.sql`. `[ran]` `grep -HnE "GRANT.*(TRUNCATE|REFERENCES|TRIGGER).*(anon|authenticated)" docs/migrations/*.sql | wc -l` → **36 lines** (was 35 at audit time). Live PostgREST re-derivation was attempted via `scripts/_probe-grant-hygiene.mjs` and returned `PGRST106 Invalid schema: information_schema` - PostgREST does not project `information_schema`, so the probe falls back to the migration-file source. Kevin's Section 6 Studio queries remain the only live-derived cross-check.

### Delta from the 2026-07-29 audit's 35 tables

| Change | Table | Migration | Grants | Notes |
|---|---|---|---|---|
| **+1 added** | `sc_homestand_closeout` | `sc-22-homestand-closeout.sql:265` | REFERENCES, TRIGGER (no TRUNCATE) | Same pattern class as `sc_config_changelog` / `sc_labor_budgets` / `sc_fee_schedule` in Group D. |
| 0 cleaned | - | - | - | No tables from the audit's list have been Studio-revoked since dfac0b5 per repo history. |
| 0 DELETE/UPDATE grants | - | - | - | `grep -HnE "GRANT.*(DELETE\|UPDATE).*(anon\|authenticated)" docs/migrations/*.sql` returns zero hits across the tree. |

**New live total: 36 tables.** `sc_homestand_closeout` joins Group D and is folded into the R1 revoke below.

### Per-privilege safety argument (what would break if the grant were in use)

- **TRUNCATE.** All in-app TRUNCATE calls run as `service_role` (verified 2026-07-31 `[code-read]`: `scripts/apply-pr-7-2-opd-seed.mjs:28` uses `SUPABASE_SERVICE_ROLE_KEY`; `scripts/content/project-catalog.mjs:262` same; `scripts/verify-opd-atomic-replace.mjs:105` is a comment about a Studio-run operation, not a client-issued TRUNCATE). service_role holds TRUNCATE via a separate grant surface, unaffected by the anon/authenticated revoke. **Nothing breaks.**
- **REFERENCES.** Needed to `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES this_table`. Migrations apply via Supabase Studio (per `docs/MIGRATION_PROJECT_CLOSEOUT.md` §260: "Schema lives in `docs/migrations/` SQL files; applied manually in Supabase Studio"), and Studio's SQL editor runs statements as the `postgres` role, not `anon` or `authenticated`. Revoking REFERENCES from those two roles cannot affect any future migration. **Nothing breaks.**
- **TRIGGER.** Needed to `CREATE TRIGGER`. Same shape as REFERENCES - triggers land during migrations under the postgres owner role, and no runtime path issues `CREATE TRIGGER` (`grep -RnE "CREATE TRIGGER" src/ scripts/` returns zero hits at the SQL layer; the only matches are in migration files themselves). **Nothing breaks.**

**Nothing in the destructive three is genuinely used by the anon or authenticated roles.** All three are safe to revoke.

**Not in scope:** SELECT, INSERT. The audit already flagged them out per Section 5's boundary, and no live-usage flag has surfaced since.

### R1 revoke block - copy-paste to Studio (`applied in Studio: YES` triggers the migration gate)

```sql
-- R1: revoke destructive grants from anon and authenticated on 36 public tables.
-- Applied 2026-07-31 in Studio by Kevin. See docs/audits/GRANT_HYGIENE_2026-07-29.md §8.
-- Rollback: replace REVOKE with GRANT; same privilege list; same table list. Idempotent both directions.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'documents','document_relationships','document_surfaces',
      'document_issues','document_pins','document_content',
      'document_chunks',
      'vendors','vendor_aliases','vendor_accounts',
      'invoice_submissions','invoice_rejections','ai_line_items','gl_codes',
      'inventory_items','item_aliases','storage_locations',
      'count_sessions','count_items','price_history','review_queue',
      'merge_history','merge_history_items',
      'sc_service_groups','sc_services','sc_service_prices',
      'sc_daily_projections','sc_daily_actuals','sc_day_metadata',
      'sc_daily_actuals_history','sc_homestand_schedule',
      'sc_day_note_entries','sc_config_changelog',
      'sc_labor_budgets','sc_fee_schedule',
      'sc_homestand_closeout'
    ])
  LOOP
    -- REVOKE is idempotent: if the privilege isn't held, it's a no-op.
    -- The three tables that never got TRUNCATE (sc_config_changelog,
    -- sc_labor_budgets, sc_fee_schedule, sc_homestand_closeout) still pass
    -- cleanly here.
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;
```

### Studio verify queries (re-run after apply)

**Expected result: zero rows.** Section 6's flagged-privilege query serves as the after check:

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES','DELETE','UPDATE')
ORDER BY table_name, grantee, privilege_type;
```

**Expected: still-present SELECT grants stay.** Section 3's "SELECT-only" grants (`sc_phase_calendar` view + the six inventory views) remain unchanged:

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND privilege_type = 'SELECT'
ORDER BY table_name, grantee;
```

### App-verify checks (post-apply)

`nothing uses it` was the pre-apply prediction. Post-apply, name what you ran:

1. `[ran] npm run build` - clean (the build exercises no runtime grant path but proves nothing regressed at compile).
2. `[ran] npm run lint` - clean.
3. `[ran] node --env-file=.env.local scripts/sousai-agent-test.mjs` - spike harness passes 7/7 on both runs (exercises service_role reads across contacts, accounts, sc_daily_revenue, documents, document_chunks, ai_line_items, vendor_aliases). Same set that runs against production PG.
4. **UI smoke on the Vercel preview** (Kevin): load /playbook, /service-calendar, /vendor, and /sous. Each surface should render without regression. If any read fails with a permission error, it will surface as a 500 in the API route.

The service-role bypass posture is the ground truth here - all reads and writes for these tables flow through server routes on the service_role key. The revoke touches only the anon/authenticated surface, which has no in-app consumer.

### Recommendation R2 status

Migration-template guard still open. Should be a follow-up PR that touches `pr-7-1-opd-schema.sql:29-31` header comments. Not landed here to keep this PR to the revoke + verify + audit doc.

### Recommendation R3 status

Regression-guard probe still open. Fits as a post-migration smoke test that asserts `anon` / `authenticated` hold none of TRUNCATE / TRIGGER / REFERENCES on public tables. Deferred to a follow-up PR; the current probe (`scripts/_probe-grant-hygiene.mjs`) is the sanctioned read-only pattern to build it on.
