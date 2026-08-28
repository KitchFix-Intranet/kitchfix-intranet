# Labor CC handoff - 2026-08-28

> This is the code-side half of the Labor / Purchasing consolidation into the Master KPI chat. Chat-Claude has separately shipped the design, data-model, and verification handoff. This document is what only the coding CC can write: the engine, the tooling, and the operational reality of running the intranet against Rippling + Supabase + Vercel.
>
> Audience: a competent engineer who has never seen this codebase.
>
> Written by the labor CC before rotating off. Assume anything below that says "we" means the intranet-repo maintainer (Kevin) and the labor CC together.

---

## 0. Where you are

**Repository:** `KitchFix-Intranet/kitchfix-intranet` (GitHub). Working checkout on this machine is `/Users/kevinfietek/dev/kf-cell-states/`. A second worktree exists at `~/dev/kitchfix-intranet/` and is Kevin's primary; audit clones live at `~/dev/li-audit-2026-08-17/kitchfix-intranet/` and similar. Do not touch `~/dev/kitchfix-intranet/` from a session that started in kf-cell-states unless you know why; the two share `.env.local` via symlink and touching branches in the primary can strand work Kevin was doing there.

**Stack:** Next.js 16 (Turbopack default), React 19, NextAuth v4, Supabase (Postgres). Deployed on Vercel from `main`; there is no staging. Prod is a real business with real users.

**The KPI Labor surface:** `/kpi/labor` route + `src/app/api/kpi/labor/route.js`. Fed nightly by GitHub Actions (`.github/workflows/rippling-sync.yml`) that walks four Rippling raw endpoints into Postgres and runs the labor + salary + people derives.

**Owner:** Kevin Fietek, sole committer, Director of Operations at KitchFix. Rules he expects you to know are in `CLAUDE.md` at the repo root. Read that first.

---

## 1. The engine, file by file

Everything the labor board reads at request time flows through this list. Line counts as of 2026-08-28 for scale sense.

### `src/app/api/kpi/labor/route.js` — 1,445 lines

The one handler for `/api/kpi/labor`. Three code paths, one file. The branches sit end-to-end rather than in helpers because the shape of the response differs materially between them and extracting shared helpers would require the exact `workerToEmail` / `salary_included` / `board.applies` threading that already caused three sweeps this month. Keep them side by side until the shapes converge, not before.

- **`GET`** starts at ~line 340. Auth gate first (NextAuth session -> email), then role gate (`src/lib/kpi/roleGate.js`), then preview-access intersection (`src/lib/kpi/previewAccess.js`), then range resolution (`src/app/kpi/labor/lib/periods.js`).
- **Aggregate path** (~line 880). Fires when `account` is a pseudo-key `ALL` / `EAST` / `WEST`. Uses `paginateActuals()` (a local helper) to walk `labor_actuals_latest` in 1000-row pages, then `resolveWorkerMeta`, then buildBoard + salary merge.
- **Salaried-only D26 path** (~line 1080). CIN - KY and TBJ - NY. Emits `account_state: "salaried_only"` when `?salary=1` is absent; on salary, hoists `bodyD26` to a full board via `withSalaryMerge`.
- **Single-account non-salaried path** (~line 1140). CIN - AZ, CIN - OH, STL - MO, STL - FL, TXR - AZ, TXR - TX - H, TXR - TX - V, TBJ - FL, TBR - FL. Uses `fetchAllOffset(supa, "labor_actuals_latest", ...)` for the range (paginated 2026-08-28 in the sweep - see §3), then `resolveWorkerMeta`, then buildBoard.

**Every path ends by calling `buildPriorPeriodComparison({supa, ...})` and threading the result through `prior_period_comparison` on the response.** After the swallowing-catch fix (2026-08-28), the helper returns `{ error, scope }` on DB error and the caller surfaces via `safeError`. `{ applies: false, reason }` remains for legitimate skip states (single-period range only, first period of the FY, insufficient data).

**Homestand block** (~line 510). Runs for the four accounts in `HOMESTAND_ACCOUNTS_FY2026` (`src/lib/labor/homestandResolver.js`). Loads all-history `labor_actuals_daily` + `sc_homestand_schedule` for the account, folds them into `homestand_splice` on the response. Feeds the day-strip UI. **This block is paginated** after 2026-08-28 - a mature account can exceed 1000 daily rows and pre-fix the tail silently dropped, affecting per-stand captions.

### The three-surface invariant

**`labor_actuals` writes have to stay coherent across three surfaces**:

1. The RPC insert list. `swap_labor_actuals_for_account(TEXT, JSONB, TEXT)` in `docs/migrations/v42-1b-rpc-rebind.sql` (the last binding rebind). Hardcoded column list; a new column has to be named here or it silently drops at the JSON->columns boundary.
2. The `labor_actuals_latest` view's select list. Same file names it. A new column has to appear here or the read side silently returns undefined for it.
3. The route's OWN wide select. `src/app/api/kpi/labor/route.js` lines ~144 (aggregate `paginateActuals`), ~1146 (single-account `fetchAllOffset`). A new column has to appear in the select string or the response drops it at the ORM boundary.

**v43-1 guarded the first two and the third silently dropped data.** The migration `v43-1-approvals-derive.sql` added `approved_hours`, `oldest_draft_date`, `still_costing_hours`; the RPC was rebound, the view was rebound, the `labor_actuals_coverage()` RPC probe passed. But the route's own select in `route.js` was hand-mirrored to the schema and had not been updated. `buildBoard`'s fold saw `undefined` on those three fields from every row and summed to zero. The Approvals card rendered zero-values against a database that held the correct numbers.

The recovery landed as `scripts/probes/_probe_labor_route_select_coverage.mjs` - it pulls the view's column set and asserts the response row shape carries every column the view exposes. **Run it any time you touch either the view or the route's select.**

### `src/lib/labor/deriveActuals.js` — 916 lines

The main derive. Reads presence + earning_type_map + rippling_department_map + the four `rippling_raw_*_latest` views; computes per-(account, worker, week, line_code) rows; upserts via the swap RPC.

- **`derive()`** entry point. Called by `scripts/derive_labor_actuals.mjs`.
- **§D26 gate** (line 53): `D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"])`. Their 3100.1 rows are NEVER emitted (owner rule; these accounts have no hourly labor - salary comes from `labor_salary_actuals` via `derive_salary_actuals.mjs`).
- **§D36 presence**: pay-segment reads FILTER on `rippling_current_presence` (kind='pay_segments'). If a rippling_id has been retired since the last walk, its row is dropped as an orphan. See `src/lib/labor/paySegmentDedupe.js` for the presence filter + external_id dedupe helper.
- **§D37 earning types**: left-join `earning_type_map` on `merged_earning_type_name`. Unmapped names route to `hours_premium_other` AND upsert to `earning_type_unmapped` for visibility. Full audit landed 2026-08-28 - 5 rows in the map, all 5 observed in `rippling_raw_pay_segments_latest`, table is definitionally complete. See `docs/BUSINESS_NOTES.md` "Labor earning-type bucket names are Rippling artifacts" for the mapping.
- **§D38 full re-derive**: every run rewrites every row via the swap RPC (`swap_labor_actuals_for_account`). No incremental logic. The RPC's per-account swap is atomic (BEGIN + DELETE-WHERE-account + INSERT + COMMIT inside `pl/pgsql`).
- **v43-1 approvals block** (~line 380): reads DRAFT + APPROVED time entries per bucket, emits `draft_entry_count`, `draft_hours`, `approved_hours`, `still_costing_hours`, `oldest_draft_date`, plus three per-row anomaly counters (`anomaly_no_clockout`, `anomaly_under_1h`, `anomaly_over_16h`).

### `src/lib/labor/salaryBoard.js` — 401 lines

Two loaders + one merge helper.

- `loadSalaryActuals(supa, members, start, end)` -> array of per-worker-per-week salary rows from `labor_salary_actuals`. Called from route.js all three paths + `dailyRangeBody.js`.
- `load3100_2Budgets(supa, members)` -> `Map<accountKey, Map<periodNo, amount>>`. Salary budget lines (line_code 3100.2).
- `withSalary(body, {...})` — the merge. Takes the default hourly response body, folds salary rows in as `salaried: true` extras (hours zero, coverage `complete`, dollars `w.slice`), reruns `buildBoard` on the merged actuals so the board math is one function not two. Returns a NEW body; NEVER mutates the input.

**All three route paths call this via `withSalaryMerge` when `?salary=1` is on.** The salary path 2026-08-28 refactor resolves salary worker_ids BEFORE the merge so `workerToEmail` covers both hourly + salary sides (previously salary names came AFTER the merge for display, and the merged board's person-counts missed salary rehires).

### `src/lib/labor/personCount.js` — 84 lines (2026-08-28, new)

`countDistinctPeople(rows, workerToEmail)` + `buildWorkerToEmail(workerMeta)`. Dedupes labor rows by person (work_email) not spell (worker_id). Rippling reissues worker_id on every rehire - Keith Gilman has 5 spells and used to read as 5 people at 7 counting sites. See `docs/BUSINESS_NOTES.md` for the full description or `docs/handoff/CC_STATE_2026-08-24.md` for the earlier state. The 21-assertion fixture-based probe (`scripts/probes/_probe_person_count.mjs`) covers empty inputs + the Keith Gilman synthetic case + unmapped-id fallback + object-form-of-map + round-trip via `buildWorkerToEmail`.

### `src/lib/labor/dailyRangeBody.js` — 200 lines

Body shape for the "daily" branch of the range resolver. Fires for partial-week ranges + homestand-view + any range whose grain the resolver decides is daily. Reads `labor_actuals_daily` in-range (paginated 2026-08-28), then computes per-(worker, line) aggregates, then salary pro-rate. Returns `{ body }` on success or `{ error }` on failure.

### `src/lib/labor/salaryProRate.js` — 131 lines

Pure function. Given `{ startISO, endISO, salaryRows }`, returns `{ workers, total, overlapped_weeks, overlapped_days }` where `workers` is per-spell (worker_id + account_key key) with each row's per-week amount pro-rated by day overlap into the range. The per-spell aggregation is CORRECT for pay-slice math (annual_comp_at_time can differ across spells; you can't sum comp figures across spells safely). The downstream COUNT is what was wrong - fixed 2026-08-28 at `dailyRangeBody.js:176` via `countDistinctPeople`.

### `src/lib/labor/homestandResolver.js` — ~500 lines

Owns everything about MLB stands. `listHomestands(supa, account, 2026, { includeSalary })` returns an array of `{ game_start, game_end, window_start, window_end, pre_floor, ... }` for the fiscal year. `HOMESTAND_ACCOUNTS_FY2026` is the hardcoded set (four accounts). `resolveDailyFloor(supa)` returns the earliest ISO date at which `labor_actuals_daily` has coverage - stands whose `game_end` predates the floor stay `pre_floor: true` and never fold an actual. Kevin's 2026-08-21 audit + owner ruling for the season-attribution model lives in the comments here.

### `src/lib/labor/rangeResolver.js` — 152 lines

Pure function. Takes `{ start, end, today, homestands }` and returns `{ kind, source, spanDays, isPartialWeek, dailyFloor, refused, message }`. `source` is `"weekly"` or `"daily"`; `refused: true` means the range is pre-floor and the daily branch would produce a lie (owner rule PR-3b). `kind` distinguishes single-period-in-progress / closed / multi-period / custom / homestand.

### `src/lib/labor/preFloorEstimator.js` — 384 lines

Estimates hourly labor for pre-floor stands (games completed before daily-grain coverage started). Reads the pre-floor bank + weekly totals + the week structure and shapes an estimate. Used by `homestandResolver.js`. Not called on any normal range.

### `src/lib/labor/staleness.js` — 63 lines

Pure function. Given `derive_freshness` (server) + `today`, returns `{ isStale, hoursSinceWalk, hoursSinceDerive }`. Drives the amber "Data is stale" banner on the board when the nightly derive hasn't run in > 30h (warn) or > 54h (bad). See the probe `_probe_labor_staleness.mjs`.

### `src/lib/labor/estimateUnpricedDollars.js`, `budgetProRate.js`, `paySegmentDedupe.js`, `salariedPredicate.js`, `approvalsTracking.js`, `dayRangeAggregate.js`

Small pure-function utilities. Each does one thing:
- `estimateUnpricedDollars.js` - dollars for hours whose pay-segment hasn't landed yet
- `budgetProRate.js` - pro-rate the period budget into a range window (integer-cent LRM)
- `paySegmentDedupe.js` - the presence filter + external_id dedupe (D36 rule)
- `salariedPredicate.js` - `isSalariedWorker(payload)` from workers-latest
- `approvalsTracking.js` - the two-dimensional approvals model (draft / approved x costed / uncosted)
- `dayRangeAggregate.js` - per-day fold for the day-strip

### `src/lib/kpi/roleGate.js` — 254 lines

The role gate. Reads `kpi_roles` (corporate / rdo / site) + `people` (site_leader lookup). Returns a caller shape `{ role, scope, email }` the route uses for `canViewAccount(caller, requestedAccount)` decisions. **This is the ONLY authority on who can see what.** Salary access is a further gate (`canSeeSalary`) inside the same file.

### `src/lib/kpi/previewAccess.js` — 161 lines (2026-08-28)

Preview mode + client-side account derivation + two decisions extracted for probe coverage. Pure functions:
- `resolvePreviewAccess({caller, canViewAccount, urlAccount, previewParam})` - intersection. Preview only NARROWS access; never grants. Empty intersection returns real access (silent, never a leak).
- `deriveClientAccount({urlAccount, previewAccount, landingAccount})` - client display precedence: preview -> URL -> landing -> "".
- `shouldRestoreLastAccount({urlAccount, urlPreview, saved, savedIsValidAccount})` - the localStorage restore skip when preview is set.
- `shouldAutoEnableSalary({accountState, salaryParam, autoSalaryForAccount, currentAccount})` - salary auto-on for salaried_only accounts (CIN - KY / TBJ - NY), respects opt-out.
- `shouldRenderLandingBridgeLoading({loadState, urlAccount, landingAccount, previewAccount})` - the stuck-skeleton fix (F1 finding, 2026-08-28).

`scripts/probes/_probe_preview_narrows_only.mjs` pins ALL of these with 255 assertions across 5 sections.

### `src/lib/kpi/resolveWorkerMeta.js` — 87 lines

`resolveWorkerMeta(supa, workerIds)` -> `{ workerMeta, resolvedNames, usersReachable }`. Reads `rippling_raw_workers_latest` + `rippling_raw_users_latest` via `fetchAllIn` (2026-08-28 sweep fix). Returns a dict keyed by rippling_id with `{ worker_id, number, display_name, title, status, email }`. The `email` field was added 2026-08-28 to bridge into `buildWorkerToEmail`.

### `src/lib/kpi/portfolioMembers.js` — 43 lines

`resolvePortfolioMembers(supa, account)` -> members list for aggregate keys (ALL / EAST / WEST). Reads `accounts` table with `.neq("team_key", "CORP").eq("region", ...)`. Order fixed by team_key so the export route's membership matches the read route's byte-for-byte (owner ruling 2026-08-24).

### `src/lib/kpi/classifyTier.js`, `dateResolve.js`, `floors.js`, `resolveName.js`

Small utilities. `classifyTier` decides floor / leadership from a role array (multi-role aware). `dateResolve` + `floors` are date helpers. `resolveName` picks the best name from workers.payload + users.payload.

### `src/lib/rippling/paginate.js` — 175 lines

The three shared pagination helpers, alongside a `chunkKeys` pure function. Written incrementally as the sweep found each new failure shape.

- `fetchAllOffset(supa, table, cols, filters)` - LIMIT/OFFSET on base tables + regular views. Safe as long as row count is bounded by `.eq` filters.
- `fetchAllKeyset(supa, view, cols, { keyCol, filters })` - keyset pagination via a monotonically ordered key. **Required on every `rippling_raw_*_latest` DISTINCT ON view** - LIMIT/OFFSET on those crosses the 60s statement timeout at deep pages.
- `fetchAllIn(supa, table, cols, { keyCol, keyValues, chunkSize=100, filters })` - `.in(keyCol, bigArray)` pagination. Chunks the KEY list at 100 by default (URL byte-limit safe for UUID keys), then paginates each chunk's response.

**The header of that file has the two-failure-modes note** (silent 1000-cap truncation vs 400 URL overflow). Read it before writing any new pagination code.

### `src/app/kpi/labor/lib/board.js` — 696 lines

Server-computed board payload. `buildBoard({...ctx, workerToEmail})` is the API. Every dollar number on the board comes from here; the client never recomputes dollars (V8-5 rule). Range interpretations: `single_period_in_progress` (full board), `single_period_closed` (variance + weeks, no projection), `multi_period`, custom, empty_range, no_budget, not_applicable. The `workerToEmail` param was added 2026-08-28 for person-key dedup and threads down into `sumRows(rows, workerToEmail)` for `worker_count` + `approval_people` and to the range-total `distinct_workers` count.

### `src/app/api/kpi/labor/export/route.js` — 709 lines

CSV export. Two shapes:
- Single-account (worker, week) rows
- Portfolio (account, week) rows

`GET` gated by `OPS_LEADERSHIP_EMAILS`. Uses `fetchAllOffset` for the actuals reads (2026-08-28 pagination sweep - the pre-fix bare selects capped at 1000 on the portfolio path, silently short-truncating the CSV Joe/Josh were downloading). Uses `fetchAllIn` for worker/user name resolution.

### The seams

- **Board math -> UI**: `buildBoard()` output IS the response body's `board` field. Client at `src/app/kpi/labor/page.js` reads `data.board.*` for every displayed number. Do NOT recompute on the client.
- **Response -> client cache**: fetch effect at `page.js` sets `data` state. `hasEverRenderedRef` tracks cold vs warm loads for skeleton behavior. The URL is the source of truth for `account`, `start`, `end`, `workers`, `redact`, `salary`, `preview`, `view`, `homestand`.
- **Client -> URL**: `setParam(key, value)` is the ONLY writer. `router.replace()` for silent updates (auto-enable salary, landing redirect); `router.push()` for user-driven changes (period picker, account switch).
- **Aggregate vs single**: the branch is decided by `isPseudoAccount(account)` at the top of the handler. Once branched, the paths do not share code beyond the utility imports - deliberately.

---

## 2. The derive pipeline

Runs at 07:00 UTC nightly via `.github/workflows/rippling-sync.yml` (`schedule: cron '0 7 * * *'`). Also `workflow_dispatch` for manual runs (with `source`, `dry_run` inputs).

### Sequence (all steps gated on prior success unless noted)

1. **Run rippling sync** (`scripts/rippling_sync.mjs`) - walks four raw endpoints:
   - `/time-entries` -> `rippling_raw_time_entries` (~200 pages, ~27 min)
   - `/custom-objects/time_entry_computed_pay_segment` -> `rippling_raw_pay_segments` (~80 pages, ~2 min)
   - `/workers` -> `rippling_raw_workers` (~12 pages, ~18s)
   - `/custom-objects/time_entry_zo` -> `rippling_raw_time_entry_zo` (~82 pages, ~65s)
   
   Total sync ~30 min. Content-hash uniqueness makes re-fetching cheap: unchanged records dropped by `ON CONFLICT DO NOTHING`. Also refreshes `rippling_current_presence` (the "which ids exist right now" set that D36 filters on).

2. **Derive labor actuals** (`scripts/derive_labor_actuals.mjs`) - the weekly derive. Reads `_latest` views + presence + earning_type_map + department_map. Emits per-(account, worker, week, line_code) rows. Writes via `swap_labor_actuals_for_account` RPC (atomic per-account). Also writes `labor_unattributed` + `earning_type_unmapped`. Exit 3 if duration > 10 min (D38 trigger to revisit); exit 2 for hard errors.

3. **Derive labor actuals daily** (`scripts/derive_labor_actuals_daily.mjs`) - same input, bucketed by `segment_date` (per-day, per-line, per-worker). Runs AFTER weekly so the D1 reconciliation probe (`_probe_daily_grain.mjs`) reads a stable weekly. `--window=trailing8` matches the salary derive default; `--window=fytd` is manual-only.

4. **Daily grain probes** (`scripts/probes/_probe_daily_grain.mjs`) - runs immediately after the daily derive. Asserts D1 reconciliation (weekly total == sum of daily rows per week per account), coverage sanity, presence-filter integrity.

5. **Derive salary actuals** (`scripts/derive_salary_actuals.mjs`) - rebuilds trailing 8 fiscal weeks of `labor_salary_actuals`. So a late-entered raise or backdated termination self-heals without touching a script. Runs after the daily so if THIS step fails, the log makes plain that hourly + daily already succeeded.

6. **Derive people** (`scripts/derive_people.mjs`) - **THE DECOUPLED STEP.** See below.

7. **People probes** (`scripts/probes/_probe_people.mjs`) - P1..P6 invariants. FAIL fails the job. Runs the derive a second time internally (P3 dynamic + P6 idempotency); the earlier step is the first run.

8. **Post failure to Slack** - `if: failure()`. Posts one compact message to the SC channel naming the first failed step + a run URL. Fires on ANY prior step failure. Owner-added 2026-08-27 after the sync failed silently for six nights.

### The Derive people decoupling

Before 2026-08-27, `Derive people` was gated `if: success()` - which chained it behind every labor derive. On 2026-08-22 the labor derive hit a Postgres statement timeout; `Derive people` stopped running for six days. Directory went stale (Grant Lawson stayed accessible 46 days after termination; Claire Parry had no access despite 17 days as an active Performance Chef).

**Owner ruling 2026-08-27**: gate `Derive people` on `steps.sync.outcome == 'success'`, not `success()`. The two concerns are unrelated - People derive reads workers + users walks only, never labor tables. The coupling was the design flaw; the timeout just exposed it.

**Directory must not go stale behind a labor query.** Keep this decoupling even after the timeout is fixed. Same principle applies to any future step that reads only from raw Rippling walks: gate on `sync.outcome`, not on downstream labor.

### Why the sync + derive live in Actions, not a Vercel cron

Vercel functions cap at 300s. The sync alone is ~30 min. `timeout-minutes: 120` on the Actions job gives real headroom for in-season volume + derive; the whole run is comfortably inside that budget. Concurrency group `rippling-raw-sync` with `cancel-in-progress: false` prevents two runs from stomping on each other's `rippling_current_presence` writes.

---

## 3. The probe battery

`scripts/probes/` has 299 files as of 2026-08-28. Most are historical audit-trail scripts - written to prove one thing at one moment, then left as evidence. `scripts/probes/README.md` documents this: **"Not maintained. Not the derive. Read-only by default. Never commit credentials."** Deleting the whole tree would not change runtime behavior; the value is documentary.

**The labor-adjacent probes that MATTER for the next CC:**

### Wired to CI (run every relevant PR or every nightly sync)

| probe | runs when | asserts |
|---|---|---|
| `_probe_kpi_css_token_gate.mjs` | `.github/workflows/kpi-css-gate.yml` on any PR touching `src/app/kpi/kpi.css` | V30-5: no raw px literals in the KPI CSS block outside the token definitions. See §4. |
| `_probe_daily_grain.mjs` | `.github/workflows/rippling-sync.yml` after every nightly `derive_labor_actuals_daily` | D1 reconciliation (weekly = sum of daily per week/account), presence-filter integrity, coverage sanity |
| `_probe_people.mjs` | `rippling-sync.yml` after `derive_people` | P1..P6 people-table invariants (owner columns preserved, idempotency, no PII leak) |

### Ships with the code, run by hand (bugs live here)

The gap Kevin has been bit by five times: **a probe that a human runs when they remember to isn't running.** The distinction is invisible unless you've been chasing a silent regression that the probe would have caught.

The important by-hand probes:

| probe | run when |
|---|---|
| `_probe_labor_route_select_coverage.mjs` | any time you touch `route.js`'s wide select OR the `labor_actuals_latest` view. This is the guard that would have caught v43-1's third-surface silent drop. |
| `writes/_probe_labor_rpc_coverage.mjs` | any time you touch `labor_actuals` schema OR the swap RPC's INSERT list. Calls `labor_actuals_coverage()` RPC in Postgres. |
| `_probe_preview_narrows_only.mjs` | any time you touch `previewAccess.js` OR the route's preview intersection. 255 assertions across 5 sections. Ran 4 times this month. |
| `_probe_person_count.mjs` | 21 fixture-based assertions for the person-key helper. Standalone, no DB. Fast enough to run on save. |
| `_probe_pagination_helpers.mjs` | 12 assertions: `chunkKeys` pure boundary behavior + one live-DB test proving `fetchAllIn` returns the full set where bare `.in()` fails. |
| `_probe_labor_staleness.mjs` | after any change to `staleness.js` or the derive_freshness response fields |
| `_probe_kpi_role_gates.mjs` | after any change to `roleGate.js`. Note: line 174 nominally reads all ACTIVE people; not currently over the 1000 cap but close-ish. |
| `_probe_earning_types_unmapped_audit.mjs` | one-shot audit; run after any Rippling change that might introduce new earning types. Full-column scan of `rippling_raw_pay_segments_latest`. |
| `_probe_kpi_contrast.mjs` | after any color-token or `.kpi-*` selector change. See §4. |
| `_probe_rehire_double_count_canary.mjs` | **the canary.** Fires on the day a real mid-fiscal-year rehire appears. Person-key fix in #881 keeps counts right when it fires; keep the canary. |
| `_probe_user_accounts_derived.mjs` | verifies the derived-view shape after the cutover. Compare-live against a snapshot. |

### Where the "probes that pass on zero rows" family lives

If a probe iterates a set and reports pass when the set is empty, it's not passing - it's not testing. Multiple sightings of this class in the last two weeks. When you add a new probe, ask: "if my input is empty, does this assertion still evaluate?" If the answer is yes-and-passes, add an explicit `assert(rows.length > 0, 'expected non-empty input')` at the top.

### The scripts-cleanup pass owed

There are 77+ untracked ad-hoc `scripts/*.mjs` files from prior debugging sessions - `_g3_*`, `_pr2r*`, `_inv_p*`, etc. Kevin flagged this as project memory `scripts-cleanup-pass`. Triage into `scripts/probes/` (if useful once) or delete (if genuinely one-shot). Do NOT bundle into a feature PR; give it its own PR.

---

## 4. The gates

Five active gates + one deprecated. Each fires on a specific event, blocks something specific, and has a specific blind spot.

### V30-5 CSS static gate (`.github/workflows/kpi-css-gate.yml`)

- **What:** parses `src/app/kpi/kpi.css` and fails if a raw `px` literal for type or spacing appears outside the `.kpi-app` token block. Excludes borders (`px <= 3`) + the rad-pill sentinel (`px === 999`) + literals inside `@media` queries.
- **Fires on:** PRs touching `src/app/kpi/kpi.css`, the probe itself, or the workflow file. Also `push` to main on the same paths.
- **Blocks:** merge to main via a required check.
- **Blind spot:** static-only. A raw-px literal added to a NON-`kpi.css` file - e.g., a component's own scoped styles - is invisible to this gate. That's fine today because the KPI surface is single-file, but a component-scoped stylesheet under `src/app/kpi/*` would slip through. The gate also assumes the token block boundary is respected; a random `.kpi-*` selector defined outside the `.kpi-app` block would evaluate its px literal as "raw" and fire, which is intentional but has bitten refactors that hoisted a variable temporarily.

### Migration gate (`.github/workflows/migration-gate.yml`)

- **What:** on `pull_request`, diffs the PR head against merge-base for added `docs/migrations/*.sql` files. None found -> passes silently. One or more found -> FAILS with a summary and the canonical confirmation phrase. On `issue_comment`, matches `applied in Studio: YES` from OWNER (or allow-listed accounts) and emits a passing `Migration gate` check_run on the SHA the comment was posted for.
- **Fires on:** every PR; every comment.
- **Blocks:** merge until the owner has posted the confirmation on the current head SHA.
- **Blind spot (documented incident 2026-07-28):** the API-created check_run may live in a different check_suite than the pull_request scan check_run. GitHub's required-check aggregation appears to group by suite, not just by check-name-latest across suites. Kevin has bypassed this once by admin-merge; a follow-up needs to either update Job A's check_run in place or switch to the commit-status API. Until then: the confirmation posts, the workflow reports success, but the ruleset may stay red. If it does, that's the known aggregation quirk, not a workflow bug.

### Nav matrix / e2e (`.github/workflows/e2e.yml`)

- **What:** two jobs. `matrix` builds the PR's code as a production bundle in the runner, starts it with `TEST_MODE=true` middleware bypass, drives `tests/sc-nav-matrix.spec.ts`. `preview` runs on Vercel `deployment_status` events against the deployed preview URL.
- **Fires on:** every PR (`matrix`); every Vercel preview build (`preview`).
- **Blocks:** merge if `matrix` fails. `preview` is informational.
- **Blind spot:** the matrix spec stubs every data route via `page.route`, so it verifies the client + build produce the right shape given synthetic input. It does not verify server-side data-path changes. And it stopped catching auth issues once the storage-state guard landed - a session-expired storage state would be invisible to the matrix (see §6).
- **Named-and-tracked:** the older `preview` job was previously pointed at the hardcoded prod URL, meaning green = "prod is up" not "this PR works." Fixed. Grep for `PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app` - should be zero hits.

### KPI contrast probe (`_probe_kpi_contrast.mjs`)

- **What:** scans `src/app/kpi/kpi.css` for every `color:` declaration on light-surface selectors. Resolves CSS vars against the palette encoded in the probe. FAILs any color < 4.5:1 on white or `--n-50`. BORDERLINE 4.5-5.0:1 (pass with warning). Waiver list requires a comment saying why.
- **Fires on:** by hand only. NOT wired to CI as of 2026-08-28.
- **Blocks:** nothing mechanically. Kevin's judgment.
- **Blind spot:** the palette encoded in the probe MUST be kept in sync with `tokens.css` + `kpi.css :root` overrides. A token value change in tokens.css that isn't mirrored in the probe silently loses coverage. The probe's header calls this out but there's no meta-check.

### Viewport-clip spec (`tests/kpi-*.spec.ts` — several, but the pattern-defining one is the 1280 clip check)

- **What:** a Playwright spec that navigates to a KPI URL and checks that critical text (dollar figures, labels) is not clipped by container widths at 1280px.
- **Fires on:** by hand; part of the browser spec battery.
- **Blocks:** nothing mechanically. Discovered issues get their own PR.
- **Blind spot / OWNER RULING 2026-08-27:** the clip spec's wait selector was `.kpi-sig, .kpi-statebox-body`. When the shared `tests/.auth/user.json` expired, `page.goto` landed on the session-expired panel, which matched `.kpi-statebox-body` and satisfied the wait. Clip check ran on the state box, found nothing to clip, reported all clear. **The spec was vacuously green for 17 days.** See §6 for the fix (setup age guard + `assertBoardLoaded` helper + adoption sweep).

### Auth-adoption probe (`_probe_playwright_auth_guard_adoption.mjs`)

- **What:** walks every `tests/**/*.spec.ts`, asserts that any file containing `page.goto(` also imports `assertBoardLoaded`. Opt-out marker `// no-auth-guard: <reason>` on a comment line for genuinely-not-authed specs.
- **Fires on:** by hand. Should be in CI - flag for next CC.
- **Blocks:** nothing mechanically today.
- **Blind spot:** grep-based. A test that dynamically constructs `page['goto'](...)` would slip through. Not currently a real risk; note the shape.

---

## 5. Migration discipline

**Migrations do not auto-apply on deploy.** SQL files in `docs/migrations/` sit in git; Kevin pastes them into Supabase Studio one at a time. Vercel deploys the CODE that expects the schema; if the migration hasn't been applied yet, the code errors out.

The 2026-06-12 silent-gap incident is the reason for this discipline. Stage A code deployed before the matching pr-9-1 migration was applied. Migration-gated PRs open as **draft** since #416 to prevent flip-and-merge.

### The pre-flight / post-flight pattern

Every migration should have both, structured as `DO $$ BEGIN ... END $$` PL/pgSQL blocks.

**Pre-flight:** everything that would have caught a swap-and-forget defect goes here, not in a runbook. Not in the CI. **In the migration itself, before the DDL.** Examples:
- Dependent table exists (`to_regclass('public.dependent_table') IS NOT NULL`)
- Dependent view exists (`information_schema.views`)
- Grants resolve for service_role (`has_table_privilege('service_role', 'table', 'SELECT')`)
- No inbound FK constraints (would need CASCADE, refuse instead)
- No dependent views (would fail silently on DROP without CASCADE)
- Row-count sanity checks on replacement data (e.g., "the derived view has >= 20 rows before dropping the old table")

**The DDL itself:** small, atomic, no CASCADE unless the pre-flight verified nothing to cascade. `IF EXISTS` on drops for idempotency (re-run should be a no-op, not an error).

**Post-flight:** assert what stayed AND what left. Every claim the migration makes gets a check that would have caught it going wrong. This is where `has_table_privilege` assertions matter as much as existence checks - a table with no grant is functionally missing from the app's perspective, and existence-only checks don't catch it.

### Why has_table_privilege matters as much as existence

An object can exist and be unreadable. Existence checks confirm the object was created; they do NOT confirm anything can read it. A guard that passes while the thing it guards is broken is exactly the class of defect we hit repeatedly in August (Rippling-sync path fix's dropped grant analogue; the "guards need coverage" family). Belt AND suspenders: check both.

### Why Studio applies happen one statement at a time (except view DROP+CREATE)

Postgres autocommits after each DDL statement in Studio. A mid-file failure leaves the schema at whichever step passed last. That's usually recoverable - fix the underlying issue and re-run from the failing step. Each step should leave the schema in a coherent state:

Example (v43-1):
- After step 1 (ALTER): three NULL columns present, view + RPC hide them (v42 state, harmless).
- After step 2 (self-test A): proves the guards work. No schema change.
- After step 3 (RPC rebind): RPC writes the three columns; view still hides.
- After step 4 (view rebind): view exposes them.
- After step 5 (self-test B): confirms end state.

**Exception: view DROP+CREATE must go together.** Between the DROP and the CREATE, any read against the view fails. If Studio applies the DROP as its own commit, then hits a syntax error in the CREATE, the app is broken until the create lands. Wrap DROP+CREATE in a single transaction:

```sql
BEGIN;
DROP VIEW IF EXISTS my_view;
CREATE VIEW my_view AS SELECT ...;
COMMIT;
```

Or use `CREATE OR REPLACE VIEW` where the column set is compatible.

### Reference implementations

**Look at these two before writing your first migration:**

- **`docs/migrations/v43-1-approvals-derive.sql`** - the ALTER + RPC-rebind + view-rebind + self-tests pattern. Header comments walk through the apply discipline. Self-tests before AND after each rebind. This is the shape.
- **`docs/migrations/user-accounts-derived.sql`** + **`docs/migrations/user-accounts-table-drop.sql`** (PR #882) - a two-migration pair: build the replacement, verify it live, then drop the old. Both have thorough pre-flight AND post-flight. The DROP's pre-flight has 8 checks + the post-flight has 8 checks, mirroring exactly what the DERIVED view's post-flight asserts. If you're dropping ANY table in the future, this is the shape.

`v42-1b-rpc-rebind.sql` (the rebind that fixed v42-1's silent truncation of five columns) is another reference - it shows the RPC-rebind pattern specifically. But v43-1 supersedes it as the canonical shape.

---

## 6. The Playwright situation

**Read this section verbatim.** Every next CC will hit some version of it.

### The auth file

`tests/.auth/user.json` is a NextAuth storage state file with cookies for an authenticated session. Shared across every browser spec in `tests/`. Created interactively by running `npx playwright test tests/auth.setup.ts` and completing Google OAuth in the popped browser.

### The 30-day TTL / 25-day setup guard

**NextAuth session TTL is 30 days.** `tests/.auth/user.json` expires 30 days after creation. `tests/auth.setup.ts` fails at day 25 by design - so tests never run against a stale session, and the refresh happens predictably rather than costing an investigation.

The guard reads file mtime. If the file exists AND has cookies AND is older than 25 days, setup THROWS with a message spelling out the fix:

```
tests/.auth/user.json is 26.3 days old (max 25d before NextAuth session expires).
Refresh with: delete tests/.auth/user.json, then npx playwright test tests/auth.setup.ts (interactive Google login).
```

### The `assertBoardLoaded` helper (`tests/lib/board-loaded.ts`)

Runtime defense in depth for a session that expires mid-run. Races the concrete board selector (`.kpi-sig, .kpi-hs-*`) against three auth-failure markers (`.kpi-statebox` on labor, `text=Please sign in to access` on SC, `text=Your session expired`) - if any auth marker resolves first, the helper throws with the fix in the message.

Every KPI + SC spec should use this as the FIRST wait after `page.goto()`. If the auth state is stale mid-run, the spec fails with a message that names the fix.

### Adoption probe

`scripts/probes/_probe_playwright_auth_guard_adoption.mjs` walks every `tests/**/*.spec.ts`, asserts each file with a `page.goto(` also imports `assertBoardLoaded`. Opt-out with `// no-auth-guard: <reason>` comment. A new spec written next week with a `page.goto` and no guard fails this probe.

### **23 specs ran against a session-expired box for 17 days.**

Say this plainly. `tests/.auth/user.json` expired on 2026-08-10. Every spec's `page.goto('/kpi/labor?...')` landed on `StateSessionExpired`. Most specs failed loudly with `Timeout of 30000ms waiting for .kpi-sig` - but the failure message did NOT name the root cause, so every failed spec cost an investigation. The viewport-clip spec was even worse: its wait selector was `.kpi-sig, .kpi-statebox-body`, which the session-expired panel satisfied. It ran green for 17 days while checking a state box for clipping.

**A fresh `tests/.auth/user.json` is required before any browser spec means anything.** Not "before the browser specs give useful signal" - before they mean anything at all. A green spec on an expired auth state is not signal. It is noise indistinguishable from success.

The three-part fix (setup age guard + assertBoardLoaded + adoption probe) makes the failure loud and name-the-fix-visible. But the fix is only meaningful because you actually refresh the auth file every 25 days.

**Practical tip:** if you're about to run a browser spec after not touching this repo for a week, check the age of `tests/.auth/user.json` FIRST. `ls -la tests/.auth/user.json` shows mtime. If it's over 20 days, refresh preemptively. The 25-day guard will catch you at day 26, but you'd rather not lose 5 minutes to it.

---

## 7. Known-fragile areas

Places I would tell a new engineer to tread carefully, in rough order of frequency-of-getting-bitten.

### `src/app/api/kpi/labor/route.js` - the three-path branching

1445 lines and growing. Aggregate + salaried-only D26 + single-account paths are byte-similar in shape but different in signature. `withSalaryMerge` invocations are near-duplicate across all three. Extract with care - the last extraction attempt (V40 BUG 5) landed a name-resolution bug because the salaried path had a byte-identical inlined block that was NOT byte-identical to the aggregate one. Confirm the extract preserves every path's exact behavior before you land it.

### `labor_actuals_latest` view + the three-surface invariant

The view is a DISTINCT ON. Always paginate via `fetchAllKeyset` if reading the full set (which nothing at request time does today; `paginateActuals` uses OFFSET but with account-key filters small enough that deep pages never trigger). Any new column on `labor_actuals` has to land in three places (RPC insert, view select, route select) OR the probe `_probe_labor_route_select_coverage.mjs` fails. Run that probe.

### `fetchAllOffset` on `_latest` views

Do NOT do this. `fetchAllOffset` uses LIMIT/OFFSET; deep pages on DISTINCT ON views cross the 60s statement timeout. If you find yourself typing `fetchAllOffset(supa, "rippling_raw_*_latest", ...)`, use `fetchAllKeyset` instead. The header of `src/lib/rippling/paginate.js` documents the incident and the fix.

### The `.in()` two-failure-mode

Bare `.in("key", bigArray)` fails silently at 1000 rows (response cap) OR loudly at ~700 UUID keys (URL byte limit). Callers with try/catch turn the loud failure into "the feature just doesn't work". Use `fetchAllIn`. Read `paginate.js` header for the full note.

### Preview mode intersection

`resolvePreviewAccess` MUST NARROW never GRANT. Any refactor that adds a return path to the function needs to verify the exhaustive Cartesian in `_probe_preview_narrows_only.mjs` still passes. 96 cases covering `caller x preview x URL`. If you make it "N+1 cases so I get a shorter probe" you've missed the point.

### Person-count sites

Seven sites now dedupe by email via `countDistinctPeople` + `workerToEmail`. If you add an EIGHTH counting site, use the same helper. Do not add `new Set(rows.map(r => r.worker_id)).size` anywhere.

### The person-key extension

`resolveWorkerMeta` returns `email` (added 2026-08-28) preferring workers.work_email over users.email. If that ordering matters for anything (it doesn't today), notice this. Kevin's memory `worker-id-per-spell` is the load-bearing rule.

### Homestand block reads full history

`labor_actuals_daily` is read WITHOUT a date filter for CIN account. Currently 317 rows for CIN - OH. If that number ever exceeds 1000, the paginated read handles it; if it exceeds 5000 the response latency starts to matter. Consider a date filter (window_start of earliest homestand) if the perf becomes visible. Same for `sc_homestand_schedule`.

### Client-side effect chain

`page.js` has a delicate chain of `useEffect`s: landing redirect, localStorage restore, salary auto-enable, fetch effect, staleness check, cold-vs-warm skeleton. Adding an effect that touches URL params can create loops (each effect fires the fetch, fetch resolves, effect re-fires). Tests: the effects should converge in ONE navigation-tick, not chain-fire across renders. Look at how `shouldRestoreLastAccount` gates on `urlPreview` (via `searchParams.get("preview")` directly, since `urlPreview` is declared later in the file - order of declaration matters here).

### Client display precedence

`deriveClientAccount` is authoritative for what the chip shows. Server sends `preview_account`, `landing_account`; client applies the precedence. Do not add a fourth signal without extending the pure function first.

### Migration gate flip aggregation

See §5. Comment posts, workflow reports success, ruleset may stay red. Kevin has bypassed once; you may need to. Note it, don't panic.

### Slack failure webhook

`SLACK_SC_WEBHOOK_URL` is a shared secret used by three workflows (rippling-sync, schedule-drift, price-change-nightly). Rippling-sync's failure post is behind `continue-on-error: true` - a webhook failure does not turn a real workflow failure into a different-looking failure. Good pattern to copy.

### The Slack channel

Owner + a few named leadership. Do not add anything noisy to the SC channel. Every message posted to that channel is designed to be seen; the failure post is meant to be one line, name the failed step, link the run. Don't turn it into a firehose.

---

## 8. What I would do next if it were mine

Not a task list. My judgment call on what would move the ball most.

**1. Ship the discriminated-shape convention for Supabase reads.** The GOTCHAS entry on `swallow-into-empty` names three acceptable resolutions; the codebase currently uses two (throw + return `{error}`). The third (`{ok: true, data} | {ok: false, error}`) is what would make the whole class structurally impossible. Requires TypeScript adoption on the API surface at minimum; probably worth it as a Stage 2 refactor. Land it after any migration to TypeScript, not before.

**2. Extract a `resolveLaborContext(request)` helper.** Every KPI labor route path repeats the auth -> role gate -> preview intersection -> range resolution dance for ~200 lines each. That's the natural extraction seam. Prior attempts have failed because the paths differ in the SHAPE of `workerToEmail` propagation - but with the person-key helper landed, the shape is now uniform. Try it.

**3. Wire `_probe_labor_route_select_coverage.mjs` + `_probe_kpi_contrast.mjs` to CI.** Both catch shipped defects; both currently run by hand; both are cheap enough to run on every PR that touches the relevant surface. The `kpi-css-gate.yml` workflow is a copy-paste template.

**4. Retire the legacy inline salary-worker re-resolves.** After PR #881, salary workers are resolved BEFORE `withSalaryMerge` in all three route paths. The old "resolve after merge for display only" blocks are gone from aggregate + single-account but the "belt and braces" version stayed. Verify they're truly no-ops today and delete.

**5. Rename `worker_count` -> `person_count` in the response payload.** `worker_count` is now a person-count, not a worker_id count, and the field name lies about that. Change the server field, change the client references, done. Small-blast-radius rename that removes a landmine for the next engineer.

**6. Consolidate the salary + hourly render paths.** The two-dimensional approvals model (v43-1) rebuilt hourly but left salary on its own line. If salary is going to be a permanent surface, unify the render so `salary_included: true` doesn't require the client to know a different shape.

**7. Playwright: land the browser-spec run in CI with a fresh auth file per-run.** Today the auth file is a shared human-refreshed artifact. Kevin flagged this class as fragile. Landing an auto-refresh in CI (service-account OAuth flow with a bot Google account) removes the human-in-the-loop, and the age guard becomes a defense against local dev drift only.

**8. Retire `paginateActuals` in favor of `fetchAllOffset` with filters.** They're identical shapes with different signatures; `paginateActuals` predates the shared helper. Consolidation is trivial and removes a redundant maintenance surface.

---

## 9. The stranded-commit rule

Three times in one day, commits pushed after a PR was flipped to ready never made it into the merge. Kevin's rule after the third strike:

**Once a PR is ready, open a follow-up rather than adding to the branch.**

The mechanism is not "GitHub is broken" - it's the merge-time window. Owner reviews the PR body + diff, hits merge, GitHub squashes to a single commit. Any commit pushed AFTER owner clicked but BEFORE the squash lands is on the branch but not in the merge. The commit is stranded - visible in git log on the branch but never in main.

Signs you might be about to strand a commit:
- The PR is not draft.
- Owner has commented / reacted / paged.
- The Vercel preview is building.

If you notice a fix you want to add and any of those signs are true, open a follow-up branch. The tiny extra PR is cheaper than the "wait, why isn't my change in main?" debugging session.

If you HAVE stranded a commit and only notice post-merge: `git log origin/main -- <path/to/file>` will show the merged commit, and diffing against your local branch will show what's missing. Cherry-pick to a new branch off latest main, open follow-up.

**Preventive habit:** before pushing to a ready PR, `gh pr view <n> --json state,mergedAt` to confirm state is still OPEN. Adds ~1s to your workflow.

---

## 10. Where I was wrong and it mattered

Not for self-flagellation. Because the next CC will make the same mistakes unless the failure modes are written down.

### The vacuous-green Playwright run

**What happened:** I shipped a viewport-clip spec with wait selector `.kpi-sig, .kpi-statebox-body`. The spec passed in CI. `tests/.auth/user.json` had expired 17 days prior. Every run since had been checking a session-expired state box for clipping, finding nothing to clip, and reporting green.

**Why the failure was invisible:** the OR-fallback selector accepted the state box shell. The spec assertion (no clipping) was vacuously true against an element with no content to clip. Green = "the state box didn't clip", not "the board rendered correctly".

**What I should have done:** written the assertion positively (`expect(board_content_element).toBeVisible()`) instead of negatively (`expect(clip_indicator).not.toExist()`). Positive assertions on the actual thing you're checking fail loudly when the thing isn't there. Negative assertions fail silently when the thing is absent for the WRONG reason.

**Structural fix:** the setup age guard + assertBoardLoaded + adoption probe from §6.

### The D1 drift analysis that matched terminated spells

**What happened:** I wrote an audit script for the people table. It matched worker_ids one-to-one against `rippling_raw_workers_latest`. Kevin has three rehires - each with 3-5 worker_ids sharing an email. My audit reported them as terminated employees because I filtered on `status='ACTIVE'` per-worker_id row, and their earliest spell rows had `status='TERMINATED'`. The audit reported ~5 spells as "terminated but still in people table" when in fact the person had a later ACTIVE spell my query never saw.

**Why the failure was invisible:** the query looked correct in isolation. Each row matched some row in the workers-latest view. But the KEY was wrong - I was checking per-spell status, not per-person.

**What I should have done:** read Kevin's memory `worker-id-per-spell` before designing the audit. It literally says "Never dedupe or filter status by matching one worker_id row; check for ANY active spell." The rule was written down; I didn't check.

**Structural fix:** the person-key helper + person-count dedup. And: always email-search Kevin's memory files for keys I'm about to use as identifiers.

### The "build clean" report from before a rebase

**What happened:** I ran `npm run build` on a branch that was based on stale main. Reported "cacheless build clean" in a PR body. Merged. On main, the code failed because a peer PR had already merged that removed an export I was importing.

**Why the failure was invisible:** the build succeeded because the OLD export was still in my base. The rebase-then-rebuild step wasn't in my workflow.

**What I should have done:** rebase onto latest main BEFORE the final build check. The memory `local_build_not_ci_proxy` covers this but doesn't emphasize the rebase step.

**Structural fix:** always `git fetch origin main` + `git rebase origin/main` (or verify branch is already up to date) before the final build. And: if a peer PR merged during my work, re-run the build even if I haven't touched the file the peer changed. A named check would help; there isn't one today.

### The false-alarm regression report

**What happened:** Kevin reported a "regression" after #880 - CIN - OH P8 showed zero cards. I timed all the queries (fast) and reasoned that neither F fix nor G fix could produce the observed symptom (they only fire on error; a StateError panel would show, not blank). I proposed a revert. Kevin re-checked on a fresh tab, found the board was actually rendering correctly. The stuck tab was the bug, not the code.

**Why the false alarm was expensive:** I nearly reverted a shipped fix based on a single sample. If I had rushed the revert, we'd have shipped a change to prod that undid working code, chasing a phantom.

**What I did right:** pushed back with the reasoning ("G-fix only fires on error, cannot produce a hang; a 500 would show StateError, not blank"). Kevin explicitly called this out as the right call.

**Structural lesson:** when a report and my analysis don't reconcile, PUSH BACK BEFORE ACTING. The instinct is to trust the owner's report and act. Sometimes the owner's report is measured on a stuck tab. The cheapest thing you can do when you cannot reproduce is say "I cannot reproduce and here is why; please re-measure with X."

### Other things worth noting but shorter

- **I have run probes without setting `--env-file` more than once.** They fail loudly, which is fine, but the CI/hand-run distinction (§3) is the one that has bitten harder - probes I've written and never wired to anything.
- **I have committed too eagerly.** Kevin's stranded-commit rule (§9) is one shape of this; another is committing before running the build. Since committing hooks fire the build, this shows up as a slow commit rather than a broken PR, but it's the same tell: I'm reaching for `git commit` before I've verified the change works.
- **I have taken em-dashes out of documents I was editing but not always in freshly generated ones.** Kevin's memory `no-em-dashes` is durable; when composing prose (like this doc), remember the rule at write time not at review time.

---

## Appendix A - Files this doc references

If you want to open any file this handoff mentions, here they are grouped:

**Route + engine:**
- `src/app/api/kpi/labor/route.js`
- `src/app/api/kpi/labor/export/route.js`
- `src/app/kpi/labor/page.js` (client)
- `src/app/kpi/labor/lib/board.js`

**Server-side helpers:**
- `src/lib/labor/deriveActuals.js`
- `src/lib/labor/salaryBoard.js`
- `src/lib/labor/dailyRangeBody.js`
- `src/lib/labor/personCount.js`
- `src/lib/labor/salaryProRate.js`
- `src/lib/labor/homestandResolver.js`
- `src/lib/labor/rangeResolver.js`
- `src/lib/labor/preFloorEstimator.js`
- `src/lib/labor/staleness.js`
- `src/lib/labor/paySegmentDedupe.js`
- `src/lib/kpi/roleGate.js`
- `src/lib/kpi/previewAccess.js`
- `src/lib/kpi/resolveWorkerMeta.js`
- `src/lib/kpi/portfolioMembers.js`
- `src/lib/rippling/paginate.js`

**Derive scripts:**
- `scripts/derive_labor_actuals.mjs`
- `scripts/derive_labor_actuals_daily.mjs`
- `scripts/derive_salary_actuals.mjs`
- `scripts/derive_people.mjs`
- `scripts/rippling_sync.mjs`

**Probes named in this doc:**
- `scripts/probes/_probe_labor_route_select_coverage.mjs`
- `scripts/probes/writes/_probe_labor_rpc_coverage.mjs`
- `scripts/probes/_probe_preview_narrows_only.mjs`
- `scripts/probes/_probe_person_count.mjs`
- `scripts/probes/_probe_pagination_helpers.mjs`
- `scripts/probes/_probe_kpi_css_token_gate.mjs`
- `scripts/probes/_probe_kpi_contrast.mjs`
- `scripts/probes/_probe_daily_grain.mjs`
- `scripts/probes/_probe_people.mjs`
- `scripts/probes/_probe_labor_staleness.mjs`
- `scripts/probes/_probe_kpi_role_gates.mjs`
- `scripts/probes/_probe_earning_types_unmapped_audit.mjs`
- `scripts/probes/_probe_earning_type_map_double_time.mjs`
- `scripts/probes/_probe_rehire_double_count_canary.mjs`
- `scripts/probes/_probe_user_accounts_derived.mjs`
- `scripts/probes/_probe_playwright_auth_guard_adoption.mjs`

**Migrations:**
- `docs/migrations/v42-1b-rpc-rebind.sql`
- `docs/migrations/v43-1-approvals-derive.sql`
- `docs/migrations/user-accounts-derived.sql`
- `docs/migrations/user-accounts-table-drop.sql`
- `docs/migrations/salary-1c-kpi-roles.sql`

**Workflows:**
- `.github/workflows/rippling-sync.yml`
- `.github/workflows/kpi-css-gate.yml`
- `.github/workflows/migration-gate.yml`
- `.github/workflows/e2e.yml`

**Playwright:**
- `tests/auth.setup.ts`
- `tests/lib/board-loaded.ts`
- Plus every `tests/*.spec.ts`

**Docs to read alongside:**
- `CLAUDE.md`
- `docs/CONVENTIONS.md`
- `docs/GOTCHAS.md` (the swallow-into-empty entry is directly relevant to §5)
- `docs/BUSINESS_NOTES.md` (labor-earning-type-bucket entry + rules)
- `docs/handoff/CC_STATE_2026-08-24.md` (earlier state snapshot)

## Appendix B - Recent labor-adjacent PRs (context)

The last month has been dense. Chronological order, most recent last:

- **#873** - preview mode + hide portfolio rail on single-account access
- **#874** - #873 verify fix: chip renders preview account, not landing
- **#876** - salary auto-enable for salaried_only + preview URL cleanup
- **#877** - purchasing adopts preview + rail-hide + freshness popover (labor parity)
- **#878** - three findings sweep: stuck skeleton (F1) + Holiday 2x mapping note (F2) + SYSTEM strip prune (F3)
- **#879** - `fetchAllIn` helper + 11 unpaginated sites (pagination sweep first layer)
- **#880** - prior-period + period-bounds DB errors surface via safeError (swallowing-catch fix)
- **#881** - dedupe person counts by email (worker_id is per spell)
- **#882** - drop `user_accounts` table post-derived-view cutover

Every one of those has a PR body that names what changed and why. When in doubt about a specific behavior, `gh pr view <n>` before assuming.

---

*Last edit 2026-08-28. If this document has aged more than a fiscal quarter without an update, treat every named line number and file path as a starting point, not gospel. Grep first, trust second.*
