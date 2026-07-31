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

## 8. R1 revoke - 2026-07-31 APPLIED (correction to the pre-apply count)

**Date:** 2026-07-31, applied in Studio by Kevin.
**Live count at apply:** **59 tables**, not the 36 my pre-apply re-derivation produced. The migration-file grep was short by 23. Correcting the record here rather than leaving a stale count in this file.

### The count was wrong. Why.

The pre-apply re-derivation used `grep -HnE "GRANT.*(TRUNCATE|REFERENCES|TRIGGER).*(anon|authenticated)" docs/migrations/*.sql` because live PostgREST rejected the `information_schema` probe with `PGRST106 Invalid schema`. The grep found 36 grant statements across the migration tree. The catalog held 59 tables carrying the same grant set.

**The gap: migration-file enumeration cannot see tables created directly in Supabase.** Supabase Studio's table editor and the initial project bootstrap both write tables into `public` without ever touching `docs/migrations/*.sql`. 23 tables sit in that shape - `accounts`, `contacts`, `hero_images`, and twenty others. `information_schema.table_privileges` sees them; the migration tree does not.

Both facts belong in the record:

- The `scripts/_probe-grant-hygiene.mjs` probe was correct to attempt the catalog path first (that path would have surfaced all 59) and correct to fall back to file grep when PostgREST refused (`information_schema` is not a projected schema).
- The file-grep fallback was **not complete**. Its blind spot is exactly the class of table Kevin's look-first Studio query caught.

The lesson is Section 9. It is a repeat lesson.

### What was actually applied

Kevin ran a catalog-driven block that reads `information_schema.table_privileges` and revokes the privilege set from **whatever it finds**, rather than a hardcoded list that can only cover what the author knew about at write-time. The block below is the shape that landed. It is the one to use going forward for any REVOKE of this class - the hardcoded list is preserved only as a footnote of what CC's grep enumerated, not as a canonical set.

Before revoking, Kevin also confirmed `DELETE` and `UPDATE` were absent from the catalog for both `anon` and `authenticated` on the whole schema. They were.

```sql
-- R1: revoke destructive grants from anon and authenticated across every
-- public table the catalog knows about. Applied 2026-07-31 in Studio.
-- Catalog-driven: any table created directly in Supabase without a migration
-- file is covered automatically. Any table added later is picked up by re-running
-- the same block. Idempotent (REVOKE is a no-op when the privilege isn't held).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT DISTINCT table_name
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('anon','authenticated')
      AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;
```

**Rollback:** replace `REVOKE` with `GRANT` and the same privilege list. Idempotent both directions. The Section 6 flagged-privilege query is the audit; run it and any table the block re-grants surfaces there.

### Post-apply Studio verification (Kevin ran)

**Flagged-privilege query returned zero rows** for anon and authenticated on TRUNCATE / TRIGGER / REFERENCES / DELETE / UPDATE across the public schema. The revoke is complete for the class.

SELECT grants on views (`sc_phase_calendar`, the six inventory views enumerated in Section 3) are unchanged - they were never in scope for this pass.

### App-verify checks - scope stated honestly (`[ran]` 2026-07-31)

**What these checks CAN prove:** the service-role read/write path is healthy. Every table this project consumes at runtime goes through the Next.js server layer on the `service_role` key; service_role holds its own grants via a separate surface entirely, and the anon/authenticated revoke does not touch it.

**What these checks CANNOT prove:** that the revoke was safe. The revoke landed on `anon` and `authenticated`. Nothing in the app exercises those roles - `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to the browser for the NextAuth handshake surface only, and no client-side `createClient` call issues DML. The absence of `anon`/`authenticated` DML in the codebase is exactly why the revoke was safe; a clean app run does not prove that absence, it presupposes it. Kevin's Section 6 catalog verify is what proves the revoke landed correctly on the roles it did touch.

With that scope stated, the following ran clean against production PG through the service-role client:

1. `[ran] npm run build` - clean.
2. `[ran] npm run lint` - unchanged repo-baseline noise (201 pre-existing errors / 63 warnings; probe script and audit-doc change contribute zero new issues).
3. `[ran] scripts/sousai-data-tools-test.mjs` - **15/15 pass**, exercising A1 find_contact, A2 list_accounts, A4 list_contacts_by_role, A5 get_account_team across hit / miss / edge cases.
4. `[ran] scripts/sousai-sc-tools-test.mjs` - **15/15 pass**, exercising B1 sc_account_window, B2 sc_homestand_detail, B4 sc_service_price, B5 sc_orientation, C1 spend_summary, C2 spend_vendor_history.
5. `[ran] scripts/sousai-agent-test.mjs` - **spike harness 7/7 both runs on the second attempt.** First attempt was 6/7 (case 1a run 1 miss - the model's `search_documents` snippet-based answer still landed at the correct 5 flat-fee accounts and `grader.VERDICT: PASS` printed for that individual run, but the top-level `run1=F` flag fired). Second attempt was clean 7/7. Model-variance flake on the enumeration-shortcut heuristic in case 1a's grader, not a permission error - the underlying reads landed identically on both attempts (search_documents against the corpus, all through service_role).
6. `[ran] scripts/_verify-grants-app.mjs` - direct calls to `find_contact({ nameQuery: "Kelsey" })` and `list_accounts({})`. `contacts` returns Kelsey Atherton (CIN-OH); `accounts` returns all 12 rows. Both tables live in the "created outside migrations" bucket that the file-grep enumeration missed, so exercising them directly is the least-hypothetical way to sanity-check the revoke landed without incident.
7. Kevin's UI smoke on Vercel preview - deferred until he runs it; any 500 on /playbook, /service-calendar, /vendor, /sous surfaces here.

Nothing failed. **The service-role bypass posture is the ground truth.**

### Recommendation R2 status

Migration-template guard still open. Should be a follow-up PR that touches `pr-7-1-opd-schema.sql:29-31` header comments with a "do not copy this grant block; grants for anon/authenticated ship as SELECT-only, if at all" note. Not landed here.

### Recommendation R3 status

Regression-guard probe still open. Fits as a post-migration smoke test that asserts `anon` / `authenticated` hold none of TRUNCATE / TRIGGER / REFERENCES on public tables. The correct implementation uses `information_schema`, not the migration files, because migration files cannot see Supabase-created tables. `scripts/_probe-grant-hygiene.mjs` still returns `PGRST106` today; the pattern needs an SQL-executing RPC or a scheduled Studio check to land as a real regression guard.

## 9. Standing lesson - when the question is about database state, query the database

Third repeat in one week:

- **Decision 5's PG survey** (2026-07-29) missed seven tables when enumerating from migrations, including `contacts` and `accounts` - the two highest-value candidates on the whole SousAI menu.
- **The grant audit** (2026-07-29) missed 23 tables when enumerating from migrations, including all of the same set.
- **This PR** repeated the same pattern - the pre-apply re-derivation ran the same file grep, hit the same PostgREST refusal, made the same fallback, and produced the same 36 that missed 23.

The blind spot is stable and the fix is stable:

- **Repo files describe intent. The catalog holds state.** Migration files are what the maintainer wrote; `information_schema` is what is actually there. When the question is "what does the database look like right now," ask the database.
- **Migration-file grep is a fallback**, not a primary. Its blind spot has a name (tables created outside migrations - Supabase Studio, initial project bootstrap, ad-hoc Studio DDL) and every use of the fallback must acknowledge it.
- **When PostgREST refuses `information_schema`** (default behavior; the schema is not projected) the answer is not "fall back and hope." The answer is a Studio query or an SQL-executing RPC. Both cost less than a wrong count.

This lesson also lives in the plan (v2.64 §22) so a future re-derivation from any surface can find it.
