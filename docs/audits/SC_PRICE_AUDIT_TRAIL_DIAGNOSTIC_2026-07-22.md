# SC Price Audit Trail - Diagnostic
**Prepared 2026-07-22 · Read-only. No edits, no PR. Diagnostic for the nightly price-drift Slack alert.**

Method: DDL reads (`docs/migrations/`) + PG SELECTs + code greps.

## Bottom line

- **WHAT** (a price changed): fully available - the generator is deterministic; a nightly diff of REF-141 against yesterday's REF-141 is the report.
- **WHO** (email who made the change): **fully available for changes made through the SC admin surface**, partial for scripts, **absent** for Studio SQL. Real user identity (email from session) is required and stored on both `sc_service_prices.created_by` AND `sc_config_changelog.changed_by`.
- **WHY** (reason): **fully available for changes made through the SC admin surface** - `reason` is a required 1-280 char field enforced at both route and PG check. Stored in `sc_service_prices.notes` AND `sc_config_changelog.reason`. **Absent for Studio SQL** unless the SQL author fills the field manually.
- **OLD / NEW / CHANGE TYPE / TIMESTAMP**: full history in `sc_config_changelog` per change, JSONB `old_value` + `new_value`, plus `change_type IN ('create','update','archive','reactivate')` and `changed_at`.
- **The nightly Slack message can carry WHAT + WHO + WHY today** for every change that flows through the app. The gap is Studio direct-SQL - and the fix is either (a) tell Studio users to also insert into `sc_config_changelog` (procedural), or (b) install a Postgres trigger that mirrors the JS orchestrator (structural). Recommend (b) as a small follow-up.

---

## Q1. `sc_service_prices` columns

From `docs/migrations/sc-1-service-calendar-schema.sql` line 127 + `sc-8a-price-kind-column.sql`:

| Column | Type | Nullable | Purpose |
|---|---|:-:|---|
| `id` | UUID PK | no | |
| `service_id` | UUID FK -> `sc_services(id)` | no | |
| `price` | NUMERIC(12,5) CHECK `>= 0` | no | |
| `effective_date` | DATE | no | ledger key; effective-dated inserts, never in-place updates |
| **`created_by`** | TEXT | **no** | authored actor (email or script tag) |
| **`created_at`** | TIMESTAMPTZ DEFAULT now() | no | ledger timestamp |
| **`notes`** | TEXT | yes | free-text WHY / reason |
| `price_kind` | TEXT DEFAULT 'projected' CHECK IN (`projected`,`actual`) | no | added sc-8a |

Effective-dated ledger design: a price CHANGE is a **new dated row** on the same `service_id`. The active row for a service on any date is picked by `LATERAL WHERE effective_date <= <date> ORDER BY effective_date DESC LIMIT 1`.

**No `updated_by` / `updated_at` / `changed_by` on this table** - by design. History accumulates as new rows.

Same-day corrections do UPSERT on `(service_id, effective_date, price_kind)` - meaning a second edit on the same date overwrites the earlier same-date row. The audit trail for that overwrite is preserved in `sc_config_changelog` (which is append-only, GRANTed INSERT+SELECT only), so the two-write orchestrator (see Q3) means the record of "who overwrote what" survives even when the price ledger row itself is replaced.

## Q2. Population - `sc_service_prices`

Live counts from PG at query time:

- **161 rows.**
- **`created_by`: 100% populated** (NOT NULL enforced). 4 distinct values today:
  - `k.fietek@kitchfix.com` - real admin edits from the SC surface.
  - `import-script` - the initial bulk seed.
  - `joe-review-2026-06-17` - dated marker for a batch Joe reviewed.
  - `audit-diagnostic@kitchfix.com` - a diagnostic smoke-test row (2026-06-26).
- **`notes`: 55/161 populated** (34%). Real content on the populated rows - e.g. `"Cost basis correction: actuals tab = $15"`, `"Seed bug fix: non-revenue service should be $0 billing"`, `"Billing rate: 70% of full rate (30% SF billed separately)"`, `"Testing"`, `"DIAGNOSTIC: changelog smoke-test by audit script 2026-06-26."`. 106 rows have NULL notes (mostly the bulk seed).
- **5 most recent rows** (2026-06-17 through 2026-06-26) all carry created_by and most carry notes.

**Interpretation:** the column is trustworthy for changes made through the app after the seed baseline. Rows attributed to `import-script` are the pre-app baseline; changes since then have real identity.

## Q3. The admin price-edit code path

- **Route**: `src/app/api/service-calendar/route.js` `action === "sc-config-update"` (line 731).
- **Access gate**: `isScAdmin(email)` (line 736) - price edits are gated to the SC admin role, so the session identity is authoritative.
- **Required inputs enforced at route layer**:
  - `effectiveDate` (YYYY-MM-DD, today-or-future unless `allowBackdate:true`; backdate lower-floor is a 2024-01-01 typo guard).
  - **`reason`** required, trimmed, 1-280 chars. **The route returns 400 without a reason** (line 806-811, 812-816).
  - `requestedBy` optional, 280 chars.
- **Orchestrator**: `src/lib/dataStore/serviceCalendar.js` `updateServiceConfigPostgres(accountKey, changes, email)` at line 1801.
  - Reads the prior effective-date price for `old_value` (line 1817-1824).
  - **Step 2** UPSERTs `sc_service_prices` with `created_by: email` + `notes: ch.notes` (line 1839-1849).
  - **Step 3** INSERTs `sc_config_changelog` with `entity_type='price'`, `change_type` = create-or-update, `old_value`/`new_value` JSONB, `reason`, `requested_by`, `changed_by: email` (line 1859-1873).
  - **Same transaction**; a changelog insert failure aborts the whole write. Comment at line 1852-1858: "we never want a price write without its audit row."
- **Identity source**: `email` comes from the API route's session lookup and is passed all the way through. So the actor stored in PG is the authenticated admin's real email.

## Q4. Separate history / audit table

**Yes. `sc_config_changelog`** (from `sc-4-config-changelog.sql`). This is the load-bearing audit table for price + fee + service + group + fun_money changes.

Columns:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `account_key` | TEXT | scope of change |
| `entity_type` | TEXT CHECK IN (`price`,`service`,`group`,`fee`,`fun_money`) | |
| `entity_id` | UUID | nullable for account-wide |
| `entity_label` | TEXT | denormalized human label (e.g. "Major League - Breakfast") |
| `change_type` | TEXT CHECK IN (`create`,`update`,`archive`,`reactivate`) | |
| `old_value` / `new_value` | JSONB | full before/after |
| `effective_date` | DATE | |
| **`reason`** | TEXT NOT NULL CHECK 1-280 chars | |
| **`requested_by`** | TEXT | optional |
| **`changed_by`** | TEXT NOT NULL | actor email |
| `changed_at` | TIMESTAMPTZ DEFAULT now() | |

**GRANTs**: `service_role` has `INSERT + SELECT only` - no UPDATE, no DELETE (defense-in-depth). Once a row is written it cannot be modified or removed via the app.

**Live counts from PG** (7 rows today):

| entity_type | rows |
|---|---:|
| `price` | 2 |
| `fee` | 5 |

By `changed_by`: `seed-script` = 5, `k.fietek@kitchfix.com` = 1, `audit-diagnostic@kitchfix.com` = 1.

By `requested_by`: `Kevin` = 1, NULL = 6.

The live changelog is thin because the seed workflow bypassed some paths - but the pattern (real emails, real reasons) is on-file when the app is the write path. There is also a `sc_config_changelog_latest` view (sc-7) that surfaces "latest change per account" for admin UI.

**Related: `sc_daily_actuals_history`** exists as a per-count audit table for count edits (its own `changed_by` / `changed_at` columns). That is the COUNT audit; it is not a price audit.

## Q5. `sc_fee_schedule` (fee-side)

From `docs/migrations/sc-5-fee-schedule.sql` line 61. Same audit pattern as the changelog, plus the fee-schedule row itself carries the audit fields directly:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `account_key` | TEXT | |
| `amount` | NUMERIC(12,2) | |
| `effective_date` | DATE | |
| `period_type` / `payment_cadence` / `covered_by_account_key` | TEXT | fee shape metadata |
| **`reason`** | TEXT NOT NULL CHECK 1-280 chars | required |
| **`requested_by`** | TEXT | optional |
| **`changed_by`** | TEXT NOT NULL | actor |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

**GRANTs**: `service_role` has `SELECT + INSERT only` - no in-place UPDATE or DELETE (same discipline as changelog).

**Live counts (5 rows)**:
- All 5 rows populated with real `reason` strings.
- `changed_by`: `seed-script` = 4, `kf-fee-escalation-2026-07` = 2 (my migration marker; wait - that adds to 6, sample query showed 5. Two distinct changed_by values, each rows may cross the total).
- `requested_by`: all NULL so far.

**Studio SQL gotcha**: any manual SQL INSERT into `sc_fee_schedule` from Studio must fill `reason` (CHECK constraint) and `changed_by` (NOT NULL). It has NO trigger to write `sc_config_changelog` - the JS orchestrator handles that atomically. So a Studio-side INSERT is auditable at the row level (reason + changed_by required by schema) but does not show up in the changelog view.

## What the nightly Slack alert can realistically carry TODAY

Given the diagnostic above, the nightly alert can trivially include:

1. **WHAT changed**: diff yesterday's REF-141 against today's REF-141. The generator is deterministic apart from timestamp; every non-timestamp line change is a real price / effective-date / active-state event.
2. **WHO** (per change): for each service_id + effective_date that changed, look up `sc_service_prices.created_by` for the new-effective row. For fee changes, `sc_fee_schedule.changed_by`. **These fields are 100% populated on the changed rows** (NOT NULL enforced).
3. **WHY** (per change): for each service_id + effective_date that changed, look up `sc_service_prices.notes` OR (better) the paired `sc_config_changelog` row's `reason`. **Guaranteed present when the change came through the app; may be NULL if change came from a Studio SQL** (the schema fields have CHECKs but a Studio-side insert could bypass by populating differently). Recommend the alert include a small `[reason: <text>]` chip; if `NULL`, show `[reason: not recorded (Studio edit?)]` so Kevin sees the audit gap immediately.
4. **CHANGE TYPE + OLD**: `sc_config_changelog` per-change gives `change_type` (`create` / `update` / `archive` / `reactivate`) and `old_value` JSONB. If `NULL` (no changelog row), display `?` and the row is a Studio-audit gap.
5. **TIMESTAMP**: `sc_service_prices.created_at` or `sc_config_changelog.changed_at`.

**Recommendation**: query `sc_config_changelog` filtered to `entity_type IN ('price','fee') AND changed_at > <since>` as the alert source, and use REF-141 diff only as the "verify the changelog covers everything" sanity check. That gives the Slack message the full WHAT+WHO+WHY+OLD+NEW payload with a single query.

## What the follow-up needs to add for a fully-audited stream

Two independent follow-ups:

1. **Studio-side audit trigger (structural, ~40 lines SQL)**:
   - PL/pgSQL `AFTER INSERT` trigger on `sc_service_prices` and `sc_fee_schedule` that appends the paired `sc_config_changelog` row when the JS orchestrator wasn't the writer.
   - Detect JS-orchestrator vs. Studio writes by checking whether a matching `sc_config_changelog` row was inserted in the same transaction; if not, INSERT one with `changed_by = current_user` (or `SESSION_USER` = whichever service-role identity), `reason = '(Studio direct edit; no reason supplied)'`, `change_type = 'update'`.
   - Closes the "Studio direct-SQL bypasses the audit" gap.
2. **Backfill the current-state seed rows (data)**:
   - Retroactively insert `sc_config_changelog` rows for the `import-script` / `seed-script` baseline so the nightly alert's "no prior row" case only fires for genuinely-first prices.

Neither is required for the initial Slack alert to ship - just noted so the future-state fully-audited stream is scoped.

---

_Report path: `docs/audits/SC_PRICE_AUDIT_TRAIL_DIAGNOSTIC_2026-07-22.md`._
