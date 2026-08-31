# Section C: Writes and Integrity

## C11: Service Calendar F3 offline save queue

**Where it lives.** `src/app/service-calendar/saveQueue.js` (module), driven from `src/app/service-calendar/ServiceCalendar.js` (React consumer). [verified]

**Pattern.** localStorage-backed retry queue with same-tab timer scheduler + cross-tab lock + `online` / `storage` / `beforeunload` window listeners. Not IndexedDB, not a service worker, not in-memory-only. [verified]

Key anchors [verified]:

- `saveQueue.js:27` - storage key `kf_sc_save_queue_v1`.
- `saveQueue.js:33` - backoff schedule `[5s, 15s, 45s, 2m, 5m]`.
- `saveQueue.js:41` - `LOCK_TTL_MS = 60_000` multi-tab lock TTL.
- `saveQueue.js:48-74` - SSR-safe localStorage IO, guards on `typeof window`, swallows Safari private-mode SecurityError.
- `saveQueue.js:90-92` - key shape `${accountKey}|${date}`.
- `saveQueue.js:108-123` - `enqueue({accountKey, date, entries, auditNote, rideNote})`, entry carries `queuedAt`, `attempts`, `lockedAt`.
- `saveQueue.js:143-167` - `acquireLock` / `releaseLock` for multi-tab in-flight guard.
- `saveQueue.js:188-197` - `isNetworkError(err)`: **excludes AbortError, includes everything else that made `fetch` throw**. Server rejections (`result.success===false`) are NOT queued.

The React driver is one `useEffect` at `ServiceCalendar.js:1629-1820` (deliberately run-once with `// eslint-disable-next-line react-hooks/exhaustive-deps` at :1819). It owns a local `timers` Map, wires `online`/`storage`/`beforeunload` listeners, exposes `scheduleReplayRef.current` at :1800 so a fresh `handleSave` enqueue can kick a retry immediately. [verified]

Enqueue call sites: `ServiceCalendar.js:2076` (single-day `handleSave` after `scIsNetworkError`), `:2462` (bulk per-day), `:2616` (second bulk path). Notes deliberately do NOT queue - only `sc-submit-day` actuals. Rationale in header comment `saveQueue.js:3-18`: "notes fail loudly; counts are the critical data". [verified]

**Replay semantics.** Last-write-wins absolute counts per owner ruling 2026-07-09 (comment `saveQueue.js:14-17`). Rejected replays surface a bad-tier toast at `ServiceCalendar.js:1706-1712`. Successful replay dequeues + invalidates `monthCache` + bumps `reloadKey` (:1682-1700). [verified]

**Verdict on attestation reuse: DISQUALIFIED as-is.** [code-read]

The `sc_daily_actuals` write happens against a server via `POST /api/service-calendar` action `sc-submit-day`, and the queue is deliberately last-write-wins across tabs and against intervening writes - a semantic that fits actuals (numeric counts, easily overwritten, plus `sc_daily_actuals_history` receipts) but is directly wrong for attestations, which must be per-actor-per-event and immutable once persisted.

But the queue behaves TRUTHFULLY on the tile-status axis for the "not recorded until persisted" invariant:

- `DaySquare.js:143-149,360-365` - the SYNCING pill is amber (`--status-needs-subtle`), lives in the "needs attention" family, and per the atom's own comment "sits in the amber needs-attention family so it reads 'action pending' without claiming the entry succeeded. Underlying tile status stays truthful - the badge is additive, never a fill swap." (CSS at `DaySquare.css:714-720`). [verified]
- No `setYearData` / `setMonthCache` mutation flips `hasActuals` for a queued write; the two `setYearData` patches in `handleSave` (`ServiceCalendar.js:2023-2036, 2156-2169`) only touch `hasNoteEntries`. [verified]
- Modal close path on queued: `DayDetail.js:787-801` explicitly documents "the save is captured locally but the server has NOT echoed yet (network fail). Skip the success screen (which would show unconfirmed totals), and close the modal so the operator lands back on the grid where the tile SYNCING badge tells the story truthfully." [verified]

**So**: the pattern's UI discipline (badge-not-fill-swap, no success screen, offline chip on ambient) is transferable to attestations and is exactly the right invariant. What is NOT transferable: (a) LWW replay semantics, (b) the storage-only single-writer assumption (localStorage can be cleared, tab closed without pushing, private-mode drops the queue), (c) key shape `${accountKey}|${date}` allows only one queued entry per day - a second attestation attempt while offline would REPLACE the first entry, not queue both. For attestations the queue would need per-attestation UUIDs (never replace) and a stronger persistence layer (IndexedDB or server-side hold-then-commit).

Also relevant: `beforeunload` guard at `ServiceCalendar.js:1767-1787` prompts on `anyQueued || anyInFlight`. Good pattern for attestations - the operator gets warned before closing a tab with unsent attestations - but the browser can override it. **Bottom line: the shape is a useful reference, but reusing the module as-is for attestations would violate "never show as recorded until persisted" via the LWW-replaces-second-attempt hole**, not the visible UI.

## C12: Migration convention

**Location.** `docs/migrations/*.sql` (119 files as of 2026-08-31). [verified] NOT `supabase/migrations/` - the `supabase/` directory only contains an empty `.temp/` subdirectory. [verified]

**Naming.** Free-form prefix + sequence + kebab description, e.g. `sc-25-period-lock.sql`, `pr-7-15-opd-atomic-replace-fns.sql`, `kpi-8bb-labor-actuals-and-derivation.sql`, `v43-1-approvals-derive.sql`. Prefixes track the module or arc (sc = Service Calendar, pr = production/product PR series, kpi = KPI cutover, purchasing, li = line items, salary, daily, inv, news, people, v42/v43 sequential recent). No zero-padding, no timestamps, no lockfile. [verified]

**Authoring template.** `docs/migrations/_GRANT_TEMPLATE.md` codifies the canonical grant block: `GRANT SELECT, INSERT, UPDATE ON <new_table> TO service_role;` post-sc-34, with `REVOKE TRUNCATE ON <new_table> FROM anon, authenticated;` as belt-and-suspenders on money-adjacent tables. Every migration ships with a verify probe block, most now include a `DO $$ ... RAISE EXCEPTION` post-flight self-test inside `BEGIN/COMMIT`. [verified]

**Apply process.** **Migrations do NOT auto-apply on Vercel deploy.** They are pasted manually into Supabase Studio's SQL editor. From `CLAUDE.md` (top-of-repo): "Migrations don't auto-apply on deploy. SQL files in `docs/migrations/` are not run by Vercel - they're applied manually in Supabase Studio. The 2026-06-12 silent-gap incident happened because Stage A code deployed before the matching pr-9-1 migration was applied." [verified]

**CI enforcement.** `.github/workflows/migration-gate.yml` (shipped 2026-07-12 via PR #416). [verified]

- Job A ("Migration gate") runs on `pull_request` events. Diffs the PR head against `git merge-base BASE HEAD` for `--diff-filter=A -- 'docs/migrations/*.sql'` (added files only, not modifications). No new migration files -> passes instantly. New migration files -> FAILS with a step-summary that lists the files and prints the canonical confirmation phrase (`.github/workflows/migration-gate.yml:99-154`).
- Job B ("confirm-and-emit") runs on `issue_comment` events. Matches comments containing `applied in Studio: YES` from either `author_association === 'OWNER'` OR a login in the hardcoded `ALLOWED_CONFIRMERS = ['KitchFix-Intranet', 'k-fietek']` array. Resolves PR head SHA via `pulls.get`, emits a `Migration gate` check_run success on that SHA via the Checks API (`:168-299`).
- Per-SHA reset is deliberate: any push re-runs Job A on the new head, so a confirmation never outlives the code it confirmed. [verified]
- The workflow header comments at :26-42 flag a known issue: after PR #535 the check_run aggregation in GitHub's ruleset appears to group by `check_suite`, not name-latest-across-suites, and the required check has occasionally stayed red under Job B's success. That has NOT been fixed at HEAD; the ALLOWED_CONFIRMERS array is a defensive workaround, and the root fix is scoped as a follow-up. [verified]

There is **no CI dry-run** of migrations - no test-database apply, no diff, no plan output. The Studio-apply IS the run. [verified]

**Reviewer procedure.** `docs/RUNBOOK.md:197-207` "Confirming a migration-gated PR": (1) paste the file's `BEGIN`/`COMMIT` block in Studio, (2) run each commented verify probe individually, (3) post the canonical `applied in Studio: YES` comment on the PR, (4) wait for the `Migration gate` check to flip green, (5) merge. [verified]

**Recent example** (largest recent migration, 2026-08-26 arc): `docs/migrations/v43-1-approvals-derive.sql` - adds three nullable columns to `labor_actuals`, ships in five ordered steps (ALTER + self-test A + RPC rebind + view rebind + self-test B), each self-test is a `DO $$ ... RAISE EXCEPTION` inside the file so a mid-file failure halts the step but leaves the schema at a coherent state. NOT wrapped in `BEGIN/COMMIT` per its own comment (`:71-74`): "No enclosing transaction. Kevin applies statements sequentially in Supabase Studio; a self-test RAISE EXCEPTION halts THAT step but does NOT undo prior DDL (postgres implicit-commits after each DDL statement in autocommit mode, which Studio uses)." [verified]

## C13: Append-only / immutable protections

**Yes, at the grants layer for one family of tables; no RLS policies anywhere.** [verified]

**RLS.** Zero `CREATE POLICY` or `ENABLE ROW LEVEL SECURITY` statements exist in `docs/migrations/*.sql`. Every table that ships enables its access via `DISABLE ROW LEVEL SECURITY` explicitly (17 occurrences across the migrations, e.g. `pr-7-1-opd-schema.sql:100 ALTER TABLE documents DISABLE ROW LEVEL SECURITY;`, `sc-9-day-note-entries.sql:51`, `pr-6-1-invoice-schema.sql:231-234`). App writes as `service_role`, so RLS was affirmatively opted out of. **No RLS-based append-only protection exists.** [verified]

**Grants-layer append-only + post-flight assertion (the strong pattern).** Three rippling raw tables. From `docs/migrations/kpi-8a-rippling-raw.sql` [verified]:

```
-- kpi-8a-rippling-raw.sql:215-217
GRANT SELECT, INSERT         ON rippling_raw_time_entries  TO service_role;
GRANT SELECT, INSERT         ON rippling_raw_pay_segments  TO service_role;

-- kpi-8a-rippling-raw.sql:329-339
-- Negative-space grants: UPDATE and DELETE MUST NOT be present.
-- These tables are append-only; a mutation grant would silently
-- convert an audit trail into a mutable store.
IF te_upd THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_time_entries (must be append-only)'; END IF;
IF te_del THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_time_entries (must be append-only)'; END IF;
IF ps_upd THEN RAISE EXCEPTION 'post-flight: service_role has UPDATE on rippling_raw_pay_segments (must be append-only)'; END IF;
IF ps_del THEN RAISE EXCEPTION 'post-flight: service_role has DELETE on rippling_raw_pay_segments (must be append-only)'; END IF;
```

Same pattern extended to `rippling_raw_users` in `docs/migrations/kpi-c5-users-raw.sql:253-254`. [verified]

Tables under this rule:
- `rippling_raw_time_entries`
- `rippling_raw_pay_segments`
- `rippling_raw_users`

Mechanism: (1) `GRANT SELECT, INSERT` only (never UPDATE or DELETE), (2) a `DO $$ ... RAISE EXCEPTION` post-flight block that uses `has_table_privilege('service_role', ...)` to prove UPDATE and DELETE are absent - if either grant leaks in, applying the migration fails loudly. Discipline is documented at `kpi-8a-rippling-raw.sql:330-331`: "These tables are append-only; a mutation grant would silently convert an audit trail into a mutable store." [verified]

Note: this protection blocks `service_role` at the grants layer, not the postgres-superuser layer. A privileged Studio session can still mutate. It also does not use PG's `INSTEAD OF` triggers or CHECK-constraint-based row-lock; it's a positive-list grant + post-flight assertion. For an attestations table this is a strong first-line pattern.

**Trigger-based audit trails (not immutability, but adjacent).** [verified]

`sc_daily_actuals` writes are mutable via `service_role`, but every UPDATE and DELETE is captured to `sc_daily_actuals_history` via row triggers:
- `docs/migrations/sc-1-service-calendar-schema.sql:295-317` - `sc_daily_actuals_audit()` + BEFORE UPDATE trigger `sc_daily_actuals_audit_trigger` writes old + new to history.
- `docs/migrations/sc-25-period-lock.sql:209-231` - `sc_daily_actuals_delete_audit()` + BEFORE DELETE trigger `sc_daily_actuals_delete_trigger` writes a `change_type='delete'` row on every deletion. Header comment `:12-14`: "sc_daily_actuals BEFORE DELETE trigger + audit function that writes a history row on every deletion. Without this, a DELETE removes rows silently and undo has no receipt."
- `docs/migrations/sc-30b-week-finalize-touch.sql:31-63` - BEFORE UPDATE trigger `sc_week_finalize_touch_trigger` bumps `changed_at`.

These are `audit-trail-on-mutation`, not deny-mutation. The receipt table itself (`sc_daily_actuals_history`) is granted `SELECT, INSERT, UPDATE, DELETE` (`sc-1-service-calendar-schema.sql:448-449`), so the audit table itself is not append-only enforced at the grants layer.

**Weaker "append-only" tables in name only.** [verified]

Several migrations describe tables as "append-only" in comments but grant UPDATE:
- `sc-9-day-note-entries.sql:52` - `GRANT SELECT, INSERT ON sc_day_note_entries TO service_role;` (no UPDATE, no DELETE, close to the kpi-8a pattern - but no post-flight assertion to catch a future grant leak).
- `sc-36-week-chase-ledger.sql:229` - `GRANT SELECT, INSERT, UPDATE ON sc_week_chase_sent TO service_role;` despite being described as "append-only fact ledger" in the header (`:17`). Update is granted so the cron can stamp `email_result` and `slack_ok` post-send. This is a naming inconsistency in the codebase; the ledger is APPEND-ONLY-FOR-ROWS but the two status columns are updated after INSERT.

**Recommendation for the future `attestations` table (implied by C13's framing).** The kpi-8a / kpi-c5 pattern is the model: `GRANT SELECT, INSERT` only (no UPDATE, no DELETE) + a `DO $$ ... has_table_privilege ... RAISE EXCEPTION` post-flight block in the migration file. This is the only mechanism in the repo that is BOTH mechanically enforced at DB grants AND asserted at migration-apply time. RLS is not used and would be an unusual addition. If mutation is ever legitimately needed post-INSERT (e.g. a `revoked_at` stamp), it needs an explicit ruling and would break the pattern - the cleaner form would be a separate `attestation_revocations` companion table with its own INSERT-only grants, preserving the primary ledger's absolute append-only guarantee.

## Contradictions with the prompt's Section 1 facts

None to flag - Section 1's verified facts (people counts, obligations schema, canonical shelves) do not overlap with the writes/integrity subject matter surveyed here.

## Completeness map

| Question | Coverage | Method |
| --- | --- | --- |
| C11 module location | complete | [verified] |
| C11 pattern (localStorage + listeners) | complete | [verified] |
| C11 file:line anchors for enqueue/driver/UI | complete | [verified] |
| C11 "not recorded until persisted" - tile status stays truthful | complete | [verified] (DaySquare + DayDetail + CSS + no `hasActuals` optimism confirmed) |
| C11 attestation-reuse verdict | complete | [code-read] - inference from LWW + key-shape + no per-attestation UUID |
| C12 migration location | complete | [verified] |
| C12 naming | complete | [verified] (119-file directory listing) |
| C12 authoring template | complete | [verified] (`_GRANT_TEMPLATE.md` read) |
| C12 apply process (manual Studio) | complete | [verified] (CLAUDE.md + RUNBOOK.md read) |
| C12 CI gate (`migration-gate.yml`) | complete | [verified] (workflow read end-to-end) |
| C12 recent example (v43-1) | complete | [verified] (partial file read, structure + rationale confirmed) |
| C13 no RLS | complete | [verified] (`grep -c CREATE POLICY` returns 0; 17 explicit `DISABLE`) |
| C13 kpi-8a / kpi-c5 grants + post-flight append-only | complete | [verified] (both files' grant + assertion blocks quoted) |
| C13 audit-trail triggers on `sc_daily_actuals` | complete | [verified] (sc-1 + sc-25 read) |
| C13 attestation model recommendation | complete | [code-read] inference from the kpi-8a pattern |
