# F-11: rippling_report_only_pending_v1 500 on ALL/FYTD (2026-09-01)

## Summary

`/api/kpi/purchasing?account=ALL` on the FYTD window has 500'd four times to date with scope `rippling_report_only_pending_v1`. Fourth recurrence of pattern-law instance #4 (measured in one context, assumed to hold in another).

**This PR ships route-side timeout guard + honest fallback surface only.** It does not touch the view, the derive job, or the schema. The cold-start-under-contention hypothesis for the timeout is unproven; the guard buys diagnostic time and turns a 500 into an honest "temporarily unavailable" on the surface Kevin operators actually watch.

## Prior migrations that were meant to fix this

- `purchasing-8-report-precedence.sql` (2026-08-26): shipped the view.
- `purchasing-9-external-id-prefix-index.sql` (2026-08-26): partial expression index on `SUBSTRING(external_id, 1, 24) WHERE external_id ~ '^[0-9a-f]{24}__'`.
- `purchasing-10-report-only-view-rewrite.sql` (2026-08-27): rewrote CTE anti-join as `WHERE NOT EXISTS` + `MATERIALIZED` label_to_account. Verified drop from 11,140ms to <200ms on the TBJ-FL FYTD shape at the time.

## Measurements this session

`scripts/probes/_probe_f11_report_only_view_timing.mjs` + `_probe_f11_view_row_count.mjs`:

| Shape | Cold | Warm |
|---|---|---|
| HEAD count on view | **5,654ms** | 825ms |
| S1: single account (TBR - FL) P9 | **8,112ms** | 208-339ms |
| S4: IN(11 accts), FYTD (the 500 case) | 227ms | 207-215ms |
| S8: route shape (chunked IN, FYTD) | 243ms | 214ms |

Base tables:
- rippling_raw_spend_lines: **32,991 rows** (was 21,578 when purchasing-9 verified 2026-08-26 - **+53% in 6 days**)
- rippling_report_txns_latest: 5,520 rows
- rippling_raw_spend_lines_latest: 11,803 rows

**View currently returns 0 rows.** The Ruling 6 fix (PR #931) restored 4,215 API rows so every report row now has an API twin; the NOT EXISTS excludes the whole population. Transient - repopulates the moment a new report parent lands ahead of an API row.

## Root cause (candidate, unproven)

The isolated timing measurements show the 500-case shape (S4/S8) as fast (207-243ms warm and cold). The narrow shape (S1) was slow on first run only (8,112ms), suggesting connection/planner cold cost, not query shape. HEAD count on the view cold cost 5,654ms.

Hypothesis: under `Promise.all` of 15 loaders in `src/app/api/kpi/purchasing/route.js:492-524`, the view's cold materialisation cost stacks with pool/planner contention and intermittently crosses Supabase's 8s statement_timeout on the first request after a lambda cold start.

**Kevin's ruling 2026-09-01: this is inferred from shapes measured in isolation. Same pattern law we cited. Ship the guard; reproduce with cold-lambda load before ordering the fix.**

## What this PR ships

### Route-side timeout guard, both call sites

1. `src/app/kpi/purchasing/lib/precedence.js:91` - `loadReportOnlyPending` wraps the paginated view walk in `Promise.race` against a **6-second** timeout. On trip, returns `{amount: 0, line_count: 0, by_account: {}, max_purchased_at: null, unavailable: true, unavailable_reason: 'timeout', unavailable_elapsed_ms}`. Logs `[F-11] loadReportOnlyPending TIMEOUT after Xms ...`.

2. `src/lib/purchasing/loaders.js:634` - the same view read inside `loadCardCharges` gets the identical 6s timeout. On trip, the report-only slice is empty and `report_only_unavailable: true` is bubbled up in the loader's return.

### Route + freshness updates

3. `src/app/api/kpi/purchasing/route.js:527` unchanged in behaviour but comment updated to name what constitutes a genuine SQL error vs a timeout (only the former still 500s).

4. `src/app/api/kpi/purchasing/route.js:553-570` - `freshness.cards_through_effective` no longer trusts `pending.report_only.max_purchased_at` when unavailable (falls back to `apiThrough` alone). Two new freshness fields added:
   - `report_only_unavailable: boolean`
   - `report_only_unavailable_reason: 'timeout' | null`

### Client surface

5. `src/app/kpi/purchasing/page.js` freshness popover renders "Report-only pending: temporarily unavailable" when the flag is true. The state intro ledes with the message so an operator reading the pop sees it before the freshness lane story. Hero + list + drill all read `pending.report_only.line_count === 0` in both the true-empty and unavailable cases; the flag is what distinguishes them.

### Why 6s and not 8s

Supabase statement_timeout is 8s. We need budget for connection setup + response parsing + the client-side merge. 6s gives 2s of margin before the platform cuts us off; warm reads are 200-250ms so no risk of false trips today.

### Why the guard is safe today

The view currently returns 0 rows. The fallback shows an empty slice. The guard cannot hide real money this week because there is no money to hide. That is exactly the property that makes now the right time to ship it.

## Firing counter

`console.warn` at both call sites emits `[F-11] ... TIMEOUT after Xms (limit 6000ms) members=N range=start..end`. In Vercel runtime logs this greps as `grep '[F-11]'`. That count is the reproduction data for step 2 below.

## What's next (Kevin's ordering, this PR does not do)

2. **Reproduce the 500 on cold Vercel lambdas** with repeated ALL/FYTD requests. Instrument the route so a failing request reports which loader timed out and at what elapsed time. Report count of 500s vs successes and which loader was implicated.
3. **Base-growth legitimacy check**: `rippling_raw_spend_lines` went 21,578 → 32,991 in 6 days. Ask whether that's legitimate or duplication. Measure by `external_id` distinctness and by ingest date. Report before (c).
4. **Then (c)** - materialised view refreshed by the derive - only if step 2 confirms cold-start materialisation and step 3 confirms the growth is legitimate.

## Non-goals in this PR

- No migration.
- No view change.
- No derive-job change.
- No reproduction of view semantics in Node (option (b) explicitly rejected in Kevin's ruling - loses the structurally-cannot-double-count property of migration-8).
