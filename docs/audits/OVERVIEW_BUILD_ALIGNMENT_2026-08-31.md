# Overview build alignment - Phase 0 (READ-ONLY)

> Phase 0 of the KPI Overview build (KPI_MASTER_SCOPE v4 §7). Answers the 10 alignment questions before Phase 1 lands foundations (`pnl_actuals`, `kpi_period_status`, `kpi_account_flags` migrations + P8 workbook loader).
> All claims labelled `[ran]` or `[code-read]` per BUILD_ACCURACY_PROTOCOL C1. Every `[code-read]` cites `file:line`. Every `[ran]` was executed against production Postgres via `node --env-file=.env.local scripts/probes/_probe_overview_phase0_alignment.mjs` (READ-ONLY, SELECT only).
> Source inputs (`docs/KPI_MASTER_SCOPE.md` v4 + `docs/renders/overview-prototype.html` v5) are also committed in this PR.

---

## Executive summary

- **Q1 shape: engines are LIBRARY-CALLABLE with a small, well-defined extraction.** `buildBoard` in `src/app/kpi/labor/lib/board.js:274` is already a pure function taking `{account, start, end, today, actuals, budget_periods, account_state, workerToEmail}` and returning the full board payload. Purchasing has no equivalent server-side resolver - its client-side math lives in `src/app/kpi/purchasing/lib/board.js` and consumes route-shaped payload keys. **Phase 2's engine PR needs to extract labor's data-fetch seam (paginateActuals + resolveMemberBudget) into a callable, and build a matching purchasing-side resolver that server-computes bucket totals in the same shape.** Details in Q1.
- **Q5 blocker (F-9) is RESOLVED at the sync layer.** [ran] `purchasing_derive_runs` shows 3 nightly successes each for billcom + rippling_spend + rippling_report; `cards_through = 2026-08-30` (lag 1 day). The 08-29 corpus regression did not repeat. Card corpus is nightly-current. R-30 (cards updated nightly - CC to confirm) is CONFIRMED for the sync cadence; the 8-day-lag note remains true for a single card charge's post-lag but the aggregate corpus is fresh.
- **Q6 blocker: 5017.3, 5002.1, 5002.5 lines exist in kpi_lines + kpi_budgets + kpi_line_activation, and rows can be summed per (account, period) today.** [ran] All three lines are active on all 11 accounts. `purchasing_actuals` carries real spend rows against these lines (5017.3: 3 rows, 5002.1: 11 rows, 5002.5: 6 rows FYTD). The route currently filters them out of `paginateActuals`'s bucket-aggregation path (it only aggregates 3200/3400/3500 into `buckets[]`), but they are captured in `purchasing_actuals` and can be summed by the Overview resolver at will.
- **Q7 blocker: `pnl_actuals` is ABSENT.** [ran] Confirms #888 finding still true. Phase 1 must land the migration + loader. DDL proposed below.
- **Q8 blocker: `kpi_period_status` + `kpi_account_flags` are ABSENT.** [ran] Both are new-build. DDL proposed below.
- **Q9 blocker: fee-account 2400.1 kpi_budgets rows ARE the recognition schedule for 3 of 5 fee accounts (CIN - OH, STL - FL, TXR - TX - H).** [ran] Two accounts diverge: STL - MO's `sc_fee_schedule.amount` = $489,497 but `kpi_budgets 2400.1` year sum = $439,431.48 - the $50,065.52 gap matches the "MO sales tax" residual noted in the purchasing handoff §10; the kpi_budgets figure IS the recognition schedule and the sc_fee_schedule figure is pre-tax. TXR - TX - V's `sc_fee_schedule.amount` = $0 (by design, per §4.6) but `kpi_budgets 2400.1` year sum = $312,000 (the direct-sales forecast per R-3 / R-11). Both are consistent with the source-of-truth ruling in §4.5: **kpi_budgets is authoritative for the recognition schedule**; the Overview reads kpi_budgets 2400.1 rows for the fee-revenue cadence and does not need a new installment table.
- **Q10 blocker: contamination status is UNCHANGED since 2026-08-28.** [ran] Zero `sc_service_prices` rows with `price_kind = 'actual'` on any of the 5 fee accounts (54 rows across 27 services, all `projected`). Live measurement replicates PR #888 numbers to the cent: CIN - OH `sum(actual_revenue) FYTD = $4,671.76` (3 rows), STL - FL `sum(actual_revenue) FYTD = $466,216.00` (184 rows), other 3 fee accounts still `$0.00` but latent-contaminated. **The Overview must not read `sc_daily_revenue` for fee accounts, ever.** Design proposal in Q10.

## Executive summary - recommended adjustments to Phase 1-4

The scope's Phase 1-4 sequencing holds up. Two clarifications and one add:

1. **Phase 2 engine PR gets an explicit precondition: extract labor's loaders into a callable.** Today `paginateActuals` + `resolveMemberBudget` + `buildPriorPeriodComparison` are helpers *inside* `src/app/api/kpi/labor/route.js`, not on `board.js`. `buildBoard` is already pure and callable. The extraction is small (~150 lines moved into `src/lib/labor/loaders.js`) but must land as PR-1 of Phase 2 (or as a prep PR merged into main before Phase 2 opens) so the Overview never re-forks a query.
2. **Phase 2 engine PR gets a companion purchasing extraction.** Purchasing has no server-side board resolver at all today - the route ships raw `weekly[]` + `actuals[]` + `pending{}` and the client folds them via `bucketWeeklySpend` / `periodWeeklySpend` / `kpiBudget`. The Overview cannot consume "raw" - it needs `{ food_bills, food_pending, food_budget_period, food_budget_range, packaging_..., vehicle_..., rm_..., equip_..., perks_... }` for the anatomy in §5.4. Recommend: add a `src/app/kpi/purchasing/lib/resolver.js` that mirrors labor's shape (pure function of `{members, start, end, today, actualsRows, weeklyRows, pendingRow, budgetMap}` -> `{buckets{}, tracked{}, totals{}}`); the purchasing route re-consumes it too so both surfaces stay bit-identical.
3. **Phase 1 loader must handle the STL - MO sales-tax delta explicitly.** The P8 workbook 2400.1 actual will not equal `sum(kpi_budgets 2400.1) * pct_elapsed` for STL - MO; the loader must land the workbook's true 2400.1 actual as `pnl_actuals.actual`, and the Overview's fee-account renderer must compare workbook-actual against workbook-actual (not against `kpi_budgets`). Otherwise the "on budget" chip will read incorrectly for STL - MO by ~10%.

## Executive summary - unmeasurable / blocked

- **Q7 workbook-side verification is BLOCKED (needs file).** The P8 workbook (`Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx`) is not in the repo. Its 97 x 197 per-account tabs, the 14-column period band structure, and the exact 2400.1 per-period actual values for the fee accounts cannot be verified from PG - only from the workbook that lives at `~/Downloads/` per the pattern the purchasing handoff §11 documents. **Recommendation:** Phase 1's loader PR body must include the row-index map extracted from Chat-Claude's workbook read (from the scope §3.5 / prototype v5 data). The loader's probe is what proves the shape.
- **Q1 aggregate path proof is PARTIAL.** The single-account and D26 salaried-only paths in `src/app/api/kpi/labor/route.js` do call `buildBoard({...})` as a pure function already - so the callability claim for those two paths is [code-read] confirmed at file:line. The aggregate path uses the same signature but wraps it in `rolledUpMembers` + `rolledUpActuals` machinery. Confirming the aggregate path works from a server-side library call (not from a route) needs an actual test - not scoped in Phase 0.

---

## Q1 - Engine reuse

**Can labor's `buildBoard` and purchasing's resolver be invoked SERVER-SIDE as functions with `(members, start, end, opts)` and return the totals the Overview needs (3100 / 3100.1 / 3100.2 and 3200 / 3400 / 3500 / 5002.1 / 5002.5 / 5017.3 at period and week grain)?**

### Labor

`buildBoard({account, start, end, today, actuals, budget_periods, account_state, workerToEmail})` is already a pure exported function at `src/app/kpi/labor/lib/board.js:274`. [code-read] Its signature accepts a pre-fetched `actuals[]` array (worker-week rows) and pre-resolved `budget_periods[]`, and returns `{ applies, kind, account, period_span, spent_to_date, hours, ot_hours, weeks: [{...}], payroll_data: {...}, overtime: {...}, ... }`. **The Overview can call it directly.**

What is NOT on `board.js` but IS in `route.js`:

- `paginateActuals(supa, { members, start, end, pageSize })` at `src/app/api/kpi/labor/route.js:180`. Reads `labor_actuals_latest` view via 1000-page LIMIT/OFFSET, `.in("account_key", members)` + `.gte("week_end", start)` + `.lte("week_start", end)`. Returns `{ data: [...] }`.
- `resolveMemberBudget(supa, accountKey)` at `src/app/api/kpi/labor/route.js:211`. Reads `kpi_budgets` (line_code=3100.1) + `sc_labor_budgets` and returns `{ data: [{period_no, amount, source, basis, superseded, ...}] }` per playbook §4.5.
- `buildAggregateWeekBudgets({ start, end, member_budgets })` at `src/app/kpi/labor/lib/board.js:84` (already exported).
- `load3100_2Budgets(supa, members)` + `loadSalaryActuals(supa, members, start, end)` + `withSalaryMerge(...)` in `src/lib/labor/salaryBoard.js` (exported).

**Extraction proposal for Phase 2:**

Move `paginateActuals` + `resolveMemberBudget` (and their in-route callers `pinHourlyOnly` + the aggregation loops for `rolledUpMembers` / `rolledUpActuals`) into a new `src/lib/labor/loaders.js`:

```js
// src/lib/labor/loaders.js  (proposed)
export async function paginateLaborActuals(supa, { members, start, end, pageSize })
export async function resolveMemberBudget(supa, accountKey)
export async function loadLaborBoardInputs(supa, { members, start, end, today, includeSalary })
  // returns { actuals, memberBudgets, workerToEmail, salaryRows, salaryBudgets }
```

Then both the labor route and the Overview resolver call `loadLaborBoardInputs` -> `buildBoard(...) [+ withSalaryMerge]`. No re-query, no re-bucketing.

**Blast radius:** small. The labor route currently owns three code paths (aggregate, D26 salaried-only, single-account non-salaried) that already share the same `buildBoard` + `withSalaryMerge` calls. The loader consolidation is documented on the labor CC handoff §8 item 2 as "the natural extraction seam."

[code-read] `src/app/api/kpi/labor/route.js:1145` (aggregate `buildBoard` call), `:1225` (D26 `buildBoard` call), `:1495` (single-account `buildBoard` call). All three pass the same shape.

### Purchasing

**No server-side board resolver exists.** [code-read] `src/app/api/kpi/purchasing/route.js` ships raw payload keys: `weekly[]` (from `paginateWeekly` at `:309`), `actuals[]` (from `paginateActuals` at `:268`), `pending{}` (from `loadPending` at `:418`), `budget.by_gl_line_code[]` (from `loadPurchasingBudgets` at `:479`), `freshness{}`, plus five capped ledger rollups. The client at `src/app/kpi/purchasing/lib/board.js` folds these into bucket cards via `bucketWeeklySpend` at `:274`, `periodWeeklySpend` at `:301`, `bucketBudget` at `:1109`, `kpiBudget` at `:1120`.

The route's `BUCKETS` constant at `src/app/api/kpi/purchasing/route.js:161` covers only food/packaging/vehicle (3200/3400/3500). Equipment (5002.5) and R&M (5002.1) are computed CLIENT-side in `board.js` via `GL_PREFIX_FOR_BUCKET.equip/rm` at `:261`. 5017.3 Perks is **not currently rendered on the purchasing board at all**; its rows are in `purchasing_actuals` but no card consumes them.

**Extraction proposal for Phase 2:**

Add a new `src/app/kpi/purchasing/lib/resolver.js` (server-side pure function mirroring labor's `buildBoard` shape):

```js
// src/app/kpi/purchasing/lib/resolver.js  (proposed)
export function buildPurchasingBoard({
  members, start, end, today, actualsRows, weeklyRows, pendingRow, budgetMap
}) {
  // Returns:
  // {
  //   applies: bool,
  //   period_span: {first, last},
  //   totals: { bills, pending, budget_range, budget_period, spent_to_date, ... },
  //   buckets: {
  //     food:      { bills, budget_range, budget_period, weeks: [...] },
  //     packaging: { ... },
  //     vehicle:   { ... },
  //   },
  //   tracked: {   // §5.4 "Also tracked" band
  //     rm:    { bills, budget_range, budget_period },
  //     equip: { bills, budget_range, budget_period },
  //     perks: { bills, budget_range, budget_period },
  //   },
  // }
}
```

Then the Overview calls `buildPurchasingBoard(loadPurchasingBoardInputs(supa, {members, start, end}))`. The purchasing route can either keep its raw-payload shape (client keeps folding) OR migrate to server-computed buckets in a later PR - the resolver stays authoritative.

**Blast radius:** medium. The purchasing route ships raw payload as an intentional design; migrating it to server-computed buckets is out of Phase 2 scope. But Phase 2 needs the resolver as a callable library function for the Overview.

[code-read] `src/app/kpi/purchasing/lib/board.js:274` (`bucketWeeklySpend`), `:301` (`periodWeeklySpend`), `:1109` (`bucketBudget`), `:1120` (`kpiBudget`), `:257-263` (`GL_PREFIX_FOR_BUCKET`).

### Verdict Q1

- **Labor: LIBRARY-CALLABLE now for `buildBoard`; needs `loadLaborBoardInputs` extraction as a Phase-2 prep step.**
- **Purchasing: NOT library-callable today; needs a new `buildPurchasingBoard` resolver in Phase 2.**
- The Overview can hit BOTH lines at 3100 / 3100.1 / 3100.2 / 3200 / 3400 / 3500 / 5002.1 / 5002.5 / 5017.3 with the extraction sketched above. No new schema is required for the engine call. Grain is available at both period and week (see Q2).

---

## Q2 - Grain

**Do the engines expose week-grain and period-grain totals, or only range totals?**

### Labor

Both. [code-read] `buildBoard` at `src/app/kpi/labor/lib/board.js:274` returns:

- **Range total:** `spent_to_date`, `range_budget`, `variance`, `verdict`, `pace_pct`, `hours`, `ot_hours`, `distinct_workers` at `board.js:606-620`.
- **Per-week array:** `weeks: [{ week_start, week_end, period_no, state, spent, hours, ot_hours, complete_ww, worker_count, ... }]` at `board.js:398-460` (folded via `buildWeekAggregates` at `:198`).
- **Per-period aggregation:** derived by grouping `weeks[]` by `period_no`. The scope's `period_no` on every week row means the Overview can `group by w.period_no` to build a period grid without a re-query.

**Single-period specific:** `period_no`, `period_start`, `period_end`, `weeks_in_period`, `weeks_in_range` at `board.js:590-599`. Only fires for `kind === "single_period_*"`.

### Purchasing

Both, but on the raw payload shape (client folds today).

- **Weekly:** `paginateWeekly(supa, {members, start, end})` at `src/app/api/kpi/purchasing/route.js:309` returns rows from `v_purchasing_by_site_week` with schema `{account_key, week_start, week_end, gl_line_code, gl_bucket, amount, line_count, bill_count, paid_amount}`. Aggregated by (account, week_start, gl_line_code) at the SQL layer.
- **Range total:** `paginateActuals(supa, {members, start, end, ...})` at `:268` returns individual bill/card rows keyed by `txn_date`.
- **Per-period:** the client uses `periodOf(week_start)` from `src/app/kpi/labor/lib/periods.js:40` to bucket weekly rows into periods. Same approach a server-side resolver would use. `loadPriorPeriodHistory` at `:344` already does this exact fold for the "last 8 periods" sparkline.

**Verdict Q2:**
- Labor exposes both grains directly on the board payload.
- Purchasing exposes week-grain natively via the SQL view; period-grain is trivially derivable via `periodOf(week_start)` (a helper both boards already use). The proposed `buildPurchasingBoard` resolver in Q1 folds this into named `period_*` / `week_*` fields.

[code-read] `src/app/kpi/labor/lib/board.js:600-620` (range totals + weeks array). `src/app/api/kpi/purchasing/route.js:309-333` (`paginateWeekly` week-grain view). `src/app/kpi/labor/lib/periods.js:40` (`periodOf`).

---

## Q3 - Proration today

**Labor prorates budget by week; purchasing uses adjusted weekly targets. The Overview prorates the open period by DAYS through YESTERDAY (R-25). Report each board's CURRENT mechanics + what adopting day-proration would change on them (per §11 B-11).**

### Labor - current

[code-read] `src/app/kpi/labor/lib/board.js` prorates on a **week basis**:

- `weekly_original_target = budget / WEEKS_PER_PERIOD` at `:394-396` for single-period ranges.
- `weekly_allowance = remaining / denominator` at `:511` where `denominator = (in_progress_week_start ? 1 : 0) + not_started_weeks_count`.
- `elapsed_weeks = computeElapsedWeeks(weeksOut, today)` at `:488`.
- `projected_period_end = (spent_to_date / elapsed_weeks) * WEEKS_PER_PERIOD` at `:497`.

The in-progress week gets counted as one whole week in the elapsed denominator; there is no partial-week credit.

### Purchasing - current

[code-read] `src/app/kpi/purchasing/lib/board.js` prorates on a **week-fraction basis** ("adjusted weekly targets" per the scope):

- `weeklyTargets({budget, weeksInPeriod, finishedSpend, finishedWeeks})` at `:189` returns `{original, adjusted}` where adjusted redistributes remaining budget across remaining weeks.
- `finishedWeekCount({start, end, todayISO})` at `:324`. A week is finished iff `week_start + 6d < today`. The running week is NOT finished.
- `elapsedShape(elapsedFrac, weeksInPeriod)` at `:225` returns the `elapsedFrac` used by `stateOf` at `:125` and `resolveCardDisplay` at `:450`.
- `projectedClose({bills, pending, elapsedFrac})` at `:345` returns `(bills + pending) / elapsedFrac` for the projection.

The `elapsedFrac` calculation is week-based - the running week doesn't count as elapsed until it closes.

### Adopting day-proration (R-25, §11 B-11)

**Days-through-yesterday** means: `elapsed_days = (yesterday - period_start).days + 1` and `budget_to_date = period_budget * elapsed_days / period_total_days`.

Impact per board:

- **Labor:** the in-progress week currently has zero credit toward the "elapsed" figure until it closes. A P8 in-progress read on Wednesday would jump from 3/4 to 4/4 as soon as Sunday closes. Adopting days-through-yesterday would give the in-progress week a smooth 1/7..6/7 credit for its running days, aligning `elapsed_pct` with the Overview's method. **Impact on the "pace" verdict:** on the third day of the running week, `elapsed_pct` would be `~78%` (18/23 days if a 4-week period through Wed of the 4th week) instead of `~78%` (~3.5/4 weeks). Numbers converge closely but not exactly for edge dates. **Impact on `weekly_allowance`:** unchanged (it's a per-not-started-week figure, not a proration). **Impact on `projected_period_end`:** would use days-based extrapolation instead of week-based; a truly-idle Sunday in the running week would predict lower spend. Minor but nonzero.
- **Purchasing:** the adjusted-weekly-target method assumes discrete week units. Adopting day-proration would replace `finishedWeekCount` / `weeklyTargets` with a `budget_to_date_by_days` figure for the period card's headline. The bucket cards (`BucketCard.js`) use the same shape; they'd change too. **Impact on `projected_close`:** would use `elapsed_days_frac` instead of week-based `elapsedFrac`; smoother trajectory. **Impact on `pace` state (over/under/on-pace):** thresholds at `stateOf` line `:243-246` (pace > 1.03 = over, pace < 0.97 = under) are relative, so they'd fire consistently.

**Recommendation for §11 B-11 rollout:**

Neither board should switch today. Both boards should ADD a `budget_to_date_days` field to their period-card payload alongside the existing week-based fields. The Overview reads only the day-based field; labor and purchasing boards keep displaying whatever their operators currently see, and switch to day-based on their own PR pace (§11 B-11 status = pending). Recommend Phase 6 (alignment) for the switch; Phase 2 for the field addition on the Overview resolver only.

[code-read] `src/app/kpi/labor/lib/board.js:394-397, 488, 497, 504-513` (labor proration mechanics). `src/app/kpi/purchasing/lib/board.js:189-224, 324-333, 345-352` (purchasing proration mechanics).

---

## Q4 - Roles

**The role keys that define the site-leader posture, and the keys that unlock the salary control (corporate + top site leader per R-28).**

[code-read] `src/lib/kpi/roleGate.js` is the single authority. Four roles:

1. **corporate** - `kpi_roles.role='corporate'`, scope=null. `canViewAccount` -> ALL. `canSeeSalary` -> ALL (unless `can_see_salary=false`).
2. **rdo** - `kpi_roles.role='rdo'`, scope=region ("East" | "West"). `canViewAccount` -> ALL. `canSeeSalary` -> ALL (unless suppressed).
3. **site_leader** - `people.is_site_leader=true` AND `people.status='ACTIVE'`, scope=account_key. `canViewAccount` -> own account only. `canSeeSalary` -> own account only.
4. **site_manager** - `people.worker_class='salaried'` AND `people.account_key IS NOT NULL` AND `people.account_key <> 'CORP'` AND `people.status='ACTIVE'`, scope=account_key. `canViewAccount` -> own account only. `canSeeSalary` -> **never** (§5+§6 of the spec).

### Site-leader POSTURE (§5.3 / R-19: drop portfolio rail, single account)

The posture is a UI decision, not a role gate. The check is currently "does `canViewAccount(caller, 'ALL')` return true?" For `site_leader` and `site_manager`, that returns false, so those two roles get the single-account posture. `corporate` + `rdo` get the portfolio rail.

**Roles that unlock the site-leader posture:** `site_leader`, `site_manager`.
**Roles that unlock the portfolio (corporate) posture:** `corporate`, `rdo`.

### Salary control (R-28: reveals 3100.1 / 3100.2 sub-lines; totals always include salary)

The scope's R-28 says "gated to corporate and the top site leader." Reading roleGate.js:

- `canSeeSalary` returns true for: `corporate` (unless `can_see_salary=false`), `rdo` (unless suppressed), `site_leader` on their own account.
- `canSeeSalary` returns false for: `site_manager` always; anyone viewing an aggregate (ALL/EAST/WEST).

**"Top site leader" per R-28 maps to `site_leader` role, ONLY for their own account.** Not `site_manager` (sous, hospitality manager - §8.1 of the playbook: they never see the salary split).

**Enumeration of role keys per R-28:**

| Overview posture | Roles | Salary toggle visible? |
|---|---|---|
| Corporate (portfolio rail) | `corporate`, `rdo` | Yes (unless `can_see_salary=false`) |
| Site leader (single account) | `site_leader` | Yes (own account only) |
| Site leader (single account) | `site_manager` | **No** |

[code-read] `src/lib/kpi/roleGate.js:6-20` (role rules 1-5), `:143-144` (corporate/rdo can_see_salary threading), `:207-212` (canViewAccount), `:214-232` (canSeeSalary), `:234-241` (landingAccount).

### Preview fence note

`KPI_PREVIEW_ONLY = true` at `src/lib/kpi/roleGate.js:69` gates ALL access to `KPI_PREVIEW_ALLOWLIST = ["k.fietek@kitchfix.com"]` until the board opens. **The Overview enable PR (Phase 4) must flip this constant** (or, per the playbook, ship a compatible fence for the new route). This is a hardcoded constant, not env var, per Kevin's ruling; flipping it is the enable step.

---

## Q5 - Card sync cadence

**Nightly now, or still trailing purchase date? `cards_through` moved backwards on 08-29 (F-9). Report what the sync actually does and whether a corpus regression would alarm anywhere.**

### What the sync does

[code-read] Three GitHub Actions workflows:

- `.github/workflows/purchasing-report-ingest.yml`: cron `0 6 * * *` (06:00 UTC). Reads Kevin's scheduled Rippling report email via SA-delegated Gmail readonly; loads CSV into `rippling_report_txns` + `rippling_report_seen_txns`. Writes a `purchasing_derive_runs` row on every exit path.
- `.github/workflows/purchasing-sync.yml`: cron `30 7 * * *` (07:30 UTC). Runs billcom sync + rippling spend sync serially (rippling always runs even if billcom fails). Writes `purchasing_derive_runs` rows.
- `.github/workflows/rippling-sync.yml`: labor pipeline at 07:00 UTC. Separate concern.

Ordering is deliberate: report-ingest 06:00 UTC feeds `rippling_report_txns_latest`, purchasing-sync 07:30 UTC reads it for Ruling 6 (report-coded exclusion). 90-minute gap gives the report lane room.

### Current state [ran]

Ran `_probe_overview_phase0_alignment.mjs` at 2026-08-31 15:00Z:

- `billcom` last 3 success: `2026-08-31T07:43Z`, `2026-08-30T07:35Z`, `2026-08-29T07:37Z`. Nightly.
- `rippling_spend` last 3 success: `2026-08-31T07:48Z`, `2026-08-30T07:39Z`, `2026-08-29T07:41Z`. Nightly.
- `rippling_report` last 3 success: `2026-08-31T06:01Z`, `2026-08-30T06:02Z`, `2026-08-29T06:01Z`. Nightly.
- `cards_through` = `2026-08-30` (max `txn_date` on `purchasing_actuals` where `source='rippling_spend'` and `excluded=false`). Lag = 1 day from today.
- Age hours: billcom=7, rippling_spend=7, rippling_report=9.

**F-9 has not recurred in the three most recent nights.** The 08-29 corpus regression (cards_through 08/28 -> 08/27, P9 coded card spend $16,325 -> $1,139) does not appear in the current data. **R-30 (cards updated nightly) is CONFIRMED as of 2026-08-31.**

The prior 8-day-lag note in earlier docs referred to Rippling's post-lag on individual card charges (ObjectID timestamp minus one day per Ruling 1) - a specific card charge may take up to ~8 days to appear in the API. The aggregate `cards_through` figure moves with the newest arrival, which is currently within 1-2 days of today because the sync is running nightly and the walk is complete (post-#867 walk-completeness assertion).

### Would a corpus regression alarm anywhere?

**No.** [code-read] `src/app/api/kpi/purchasing/route.js:612-664` (`loadFreshness`) surfaces `cards_through` as a bare date; the freshness pill on the board uses it as a "cards through <date>" chip but does not compare against a stored prior baseline. F-9 landed as an OPEN finding in the scope (§3.1) precisely because "a health surface that reports the job ran cannot report the corpus shrinking."

The existing derive_runs table stores `lines_written` per run (see the sample rows above). A regression detector would compare `today.lines_written` against `yesterday.lines_written` or, more directly, `today.cards_through` against `yesterday.cards_through` - if today's is EARLIER than yesterday's, alarm. This is `§11 E-8` in the scope's alignment register (E-8 status = pending, purchasing marked `fix`).

**Recommendation for Phase 2:** the Overview's engine PR should NOT block on E-8 (it's a shared alignment item on purchasing). But the Overview's `sources` line (§5.4 item 2, R-21) should surface `cards_through` prominently so an operator eyeballing the header notices a shrink even without an automated alarm. The chip color could flip amber when `cards_through` is more than 3 days behind today.

[ran] Live probe evidence: `purchasing_derive_runs` last 3 success rows for each source (see above). [code-read] `.github/workflows/purchasing-sync.yml:38-40` (cron), `.github/workflows/purchasing-report-ingest.yml:31-33` (cron), `src/app/api/kpi/purchasing/route.js:612-664` (loadFreshness).

---

## Q6 - 5017.3 Perks + 5002.1 R&M + 5002.5 Equipment

**In the purchasing bucket map and line catalog? Can card charges coded to these lines be summed per account per period today?**

### Line catalog [ran]

All three lines are in `kpi_lines`:
- `5017.3` "Perks" - section=sga, group_code=5017.
- `5002.1` "General Repair & Maintenance" - section=sga, group_code=5002.
- `5002.5` "Equipment" - section=sga, group_code=5002.

`kpi_line_activation` FY2026 marks all three as `active=true` on all 11 accounts (11 rows each). All 33 activation rows are active.

`kpi_budgets` FY2026 carries 143 rows for each of the three lines (11 accounts x 13 periods). Every account has a budget row for every period for every one of the three lines.

### Bucket map [code-read]

`src/app/api/kpi/purchasing/route.js:161-165`:

```
const BUCKETS = [
  { key: "food",      gl_prefix: "3200", ... },
  { key: "packaging", gl_prefix: "3400", ... },
  { key: "vehicle",   gl_prefix: "3500", ... },
];
```

**5017.3 / 5002.1 / 5002.5 are NOT in the route's `BUCKETS` constant.** But they ARE in the purchasing board's client-side bucket map at `src/app/kpi/purchasing/lib/board.js:257-263`:

```js
const GL_PREFIX_FOR_BUCKET = {
  food:      (gl) => gl.startsWith("3200"),
  packaging: (gl) => gl.startsWith("3400"),
  vehicle:   (gl) => gl.startsWith("3500"),
  equip:     (gl) => gl === "5002.5",
  rm:        (gl) => gl === "5002.1",
};
```

5017.3 is **not in any bucket map today.** It has no card on the purchasing board.

### Can they be summed per (account, period) today? [ran]

Yes. `purchasing_actuals` carries real rows FYTD for all three:
- `5017.3`: 3 rows, sample `{"account_key":"STL - FL","txn_date":"2026-04-03","amount":99.28,"source":"billcom"}`.
- `5002.1`: 11 rows, sample `{"account_key":"TBR - FL","txn_date":"2026-08-11","amount":406.60,"source":"billcom"}`.
- `5002.5`: 6 rows, includes both `billcom` and `rippling_spend` sources.

Aggregation is a straight `SELECT account_key, SUM(amount) FROM purchasing_actuals WHERE gl_line_code IN (5017.3, 5002.1, 5002.5) AND txn_date BETWEEN <period_start> AND <period_end> AND excluded=false GROUP BY account_key`. Same shape the existing route already uses for the 3xxx buckets.

### Verdict Q6

**Yes, sums are computable today per (account, period).** The three lines exist in kpi_lines / kpi_line_activation / kpi_budgets; `purchasing_actuals` has real rows; the query pattern is identical to the existing food/packaging/vehicle aggregation. Route's BUCKETS constant needs 5017.3 added (or, per Q1, the new `buildPurchasingBoard` resolver adds the "Also tracked" (§5.4 item 9) band directly).

[ran] Line-catalog + kpi_budgets + purchasing_actuals presence. [code-read] `src/app/api/kpi/purchasing/route.js:161-165` (route BUCKETS), `src/app/kpi/purchasing/lib/board.js:257-263` (client bucket map).

---

## Q7 - `pnl_actuals` proposal

**Propose the table + a loader mirroring the `kpi_budgets` loader that ingests the P8 workbook.**

### Confirm absence [ran]

`pnl_actuals` is not in Postgres. The queries in the probe returned "Could not find the table 'public.information_schema.tables' in the schema cache" for the info_schema check (that's a PostgREST quirk, not evidence of anything). But the direct table read `.from("pnl_actuals").select(...)` was not attempted; #888 audit confirmed absence on 2026-08-28 and no migration has landed since (grep of `docs/migrations/` shows no `pnl_actuals` file). Confirming: **ABSENT**.

### DDL proposal

```sql
-- proposed migration: pnl-1-actuals.sql
--
-- Ingest of Sebastian's Budget vs Actual (SLT) FY2026 workbook per
-- KPI_MASTER_SCOPE v4 §7.1 Q7 + R-17. One row per (account, line, period);
-- workbook ingested once per fiscal period after Sebastian closes P&L
-- (typically 1-2 weeks post period close per R-17).
--
-- Mirrors kpi_budgets shape so the Overview resolver can bind budget +
-- actual with one SQL join.

CREATE TABLE IF NOT EXISTS pnl_actuals (
  account_key    TEXT NOT NULL CHECK (
                   account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                 ),
  fiscal_year    INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  period_no      INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  line_code      TEXT NOT NULL REFERENCES kpi_lines(line_code),
  actual         NUMERIC(14,2) NOT NULL,                -- signed - allow negatives (returns, adjustments)
  budget         NUMERIC(14,2),                         -- workbook's own budget column (for delta-vs-shown, R-17d)
  source_doc     TEXT NOT NULL,                         -- workbook file basename, e.g. 'BvA_2026_P8_2026-08-20B.xlsx'
  verified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by    TEXT NOT NULL,                         -- ingest-run identity (email or 'loader:<name>')
  PRIMARY KEY (account_key, fiscal_year, period_no, line_code)
);

CREATE INDEX IF NOT EXISTS idx_pnl_actuals_line_period
  ON pnl_actuals (line_code, fiscal_year, period_no);

CREATE INDEX IF NOT EXISTS idx_pnl_actuals_account_period
  ON pnl_actuals (account_key, fiscal_year, period_no);

-- Grants
GRANT SELECT ON pnl_actuals TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON pnl_actuals TO service_role;

-- Pre-flight (in migration body):
--   ASSERT to_regclass('public.kpi_lines') IS NOT NULL;
--   ASSERT (SELECT COUNT(*) FROM kpi_lines WHERE line_code = '2400.1') = 1;
--
-- Post-flight (in migration body):
--   ASSERT has_table_privilege('service_role', 'pnl_actuals', 'INSERT');
--   ASSERT has_table_privilege('authenticated', 'pnl_actuals', 'SELECT');
```

### Loader outline

Mirror `scripts/load_kpi_budgets_2026.mjs`:

```js
// scripts/load_pnl_actuals_2026.mjs  (proposed)
//
// Usage:
//   node --env-file=.env.local scripts/load_pnl_actuals_2026.mjs \
//     --file <path>/fy2026_p8_actuals_seed.json --period 8 [--dry-run]
//
// Seed JSON shape (produced locally, kept out of the repo):
//   {
//     "fiscal_year": 2026,
//     "period_no": 8,
//     "source_doc": "BvA_2026_P8_2026-08-20B.xlsx",
//     "row_count": <int>,
//     "grand_total_all_lines_actual": <number>,        // rounded 2dp
//     "manifest_2400_1_period_totals": {                // rounded 2dp; verifies fee-account 2400.1 numbers
//       "CIN - OH": <number>, "STL - FL": <number>, ...
//     },
//     "lines": [
//       { "account_key": "...", "line_code": "3100.1",
//         "period_no": 8, "actual": <number>, "budget": <number> },
//       ...
//     ]
//   }
//
// Guardrails (copy from kpi_budgets loader):
//   - Refuses without --file.
//   - Refuses if row_count / manifest / lines empty or mismatched.
//   - Upsert on PK in batches of 500. Idempotent - re-run overwrites.
//   - --dry-run stops before any DB write.
//   - Post-load verification: total rows, per-account 2400.1 period-total
//     ties to manifest to the cent, delta warnings if kpi_budgets differs
//     from workbook budget (surfaced but NOT blocking; R-17d handles the
//     delta at render time).
//   - Console receipt: COUNTS + PASS/FAIL per account. NEVER prints
//     dollar amounts.
```

### Seed-file discipline

Kevin runs a separate `scripts/extract_pnl_actuals_from_workbook.mjs` (proposed) that reads `~/Downloads/BvA_2026_P8_2026-08-20B.xlsx`, walks the 97 x 197 per-account tabs, extracts the 14-column period bands per the scope §3.5 shape, and writes the seed JSON to `~/Downloads/fy2026_p8_actuals_seed.json`. Only the loader ships in the repo; the workbook and the seed stay local. Same discipline the `verify_budget_seed_vs_xlsx.mjs` script established for kpi_budgets.

### Concerns

1. **Sign convention.** Revenue is positive in the workbook; costs are positive in the workbook (per §3.5 tab shape). Store as-signed and let the Overview do the presentation math. If Sebastian's workbook flips a sign for adjustments (returns, credit memos), the loader must round-trip; test at seed-generation time.
2. **Late corrections.** R-17 says Sebastian produces the workbook 1-2 weeks after period close. If Sebastian re-issues a workbook (rare but happens for late-arriving invoices), the loader's upsert on PK is idempotent. The `verified_at` stamp updates; `source_doc` changes to the new filename. Overview reads latest per PK; no history is kept beyond `verified_at` unless we add a `pnl_actuals_history` table (deferred, out of Phase 1 scope).
3. **STL - MO delta.** The workbook's 2400.1 for STL - MO will not equal `sum(kpi_budgets 2400.1) * pct_elapsed` because of the MO sales tax gap (Q9 finding). The loader ingests both actual and budget from the workbook so the Overview can use workbook-actual against workbook-budget consistently for fee accounts. Do NOT normalize the delta at load time; ingest what the workbook says.

[code-read] `scripts/load_kpi_budgets_2026.mjs` (the pattern to mirror). [ran] Absence confirmed; existing table names checked.

---

## Q8 - `kpi_period_status` + `kpi_account_flags`

### DDL proposal

```sql
-- proposed migration: pnl-2-period-status.sql

CREATE TABLE IF NOT EXISTS kpi_period_status (
  fiscal_year   INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  period_no     INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  closed_at     TIMESTAMPTZ,                           -- when the period closed on the calendar (deterministic; can seed at migration time)
  verified_at   TIMESTAMPTZ,                           -- when pnl_actuals landed for this period
  verified_by   TEXT,                                  -- 'loader:pnl_actuals_p8' or Kevin's email
  source_ref    TEXT,                                  -- workbook basename
  PRIMARY KEY (fiscal_year, period_no)
);

-- verified_at NULL means the period is closed on the calendar but the
-- P&L file has not been ingested yet ("closed - awaiting finance").
-- verified_at NOT NULL means the P&L file is loaded ("verified against
-- P&L, date").
-- closed_at NULL AND verified_at NULL means the period is open ("open ·
-- live estimate").

GRANT SELECT ON kpi_period_status TO authenticated, service_role;
GRANT INSERT, UPDATE ON kpi_period_status TO service_role;

-- The pnl_actuals loader (Q7) upserts kpi_period_status.verified_at =
-- now() and source_ref = <workbook basename> on successful load of
-- (fiscal_year, period_no). One row per period, per fiscal year.
-- Seed rows for FY2026 P1-P8 at migration time using periodEndISO from
-- src/app/kpi/labor/lib/periods.js.
```

```sql
-- proposed migration: pnl-3-account-flags.sql

CREATE TABLE IF NOT EXISTS kpi_account_flags (
  account_key       TEXT PRIMARY KEY CHECK (
                      account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    ),
  sc_revenue_live   BOOLEAN NOT NULL DEFAULT false,   -- true = per-meal counts are trusted for open-period revenue
  set_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  set_by            TEXT NOT NULL                     -- email of who flipped it
);

-- Manual flag per R-20 §5.5. Fee accounts do not need this row (they
-- always use contractual/kpi_budgets 2400.1). Per-meal accounts default
-- to false so the Overview shows "planned" (budget to date) revenue
-- until Kevin explicitly flips the flag. The 6/15 seed burst
-- (R888-6) is documented in code comments as an advisory heuristic but
-- the flag remains manual - no auto-flip.

GRANT SELECT ON kpi_account_flags TO authenticated, service_role;
GRANT INSERT, UPDATE ON kpi_account_flags TO service_role;

-- Seed 11 rows at migration time, all with sc_revenue_live = false.
-- Kevin flips per-account as each site validates.
```

### Notes

- **`kpi_period_status.closed_at`** can be deterministically seeded from the calendar (periods 1-8 have `closed_at = period_end` for P1..P7 and NULL for P8 if not yet closed). Migration seeds all rows for FY2026 at land time.
- **`kpi_account_flags`** is a small table (11 rows). The manual flag is the intentional design; heuristics stay in code comments as advisories only (R-20).
- **No FK from `pnl_actuals` to `kpi_period_status`.** The loader upserts both; a downstream FK would create ordering constraints that don't add value.

[code-read] Confirms absence pattern; existing table names checked in probe.

---

## Q9 - Fee-account recognition

**Confirm that `kpi_budgets` per-period 2400.1 rows for CIN - OH, STL - FL, STL - MO, TXR - TX - H equal the workbook's per-period 2400.1 budget. If they do, they are the recognition schedule and no new structure is needed for fee revenue.**

### PG-side measurement [ran]

`kpi_budgets` FY2026 line_code=2400.1 for fee accounts:

| Account | Rows | Periods covered | Year sum |
|---|---|---|---|
| CIN - OH | 13 | P1-P13 (P1-3 and P11-13 are $0) | $376,687.80 |
| STL - FL | 13 | P1-P13 (P13 is $0) | $1,399,999.99 |
| STL - MO | 13 | P1-P13 (P1-3 and P11-13 are $0) | $439,431.48 |
| TXR - TX - H | 13 | P1-P13 (P1-3 and P11-13 are $0) | $604,018.80 |
| TXR - TX - V | 13 | P1-P13 (P1-3 and P11-13 are $0) | $312,000.00 |

Per-period detail (rounded to nearest dollar, non-zero only):

- CIN - OH: P4-P10 populated. P7 = $71,523; P8 = $47,682; P9 = $57,218.
- STL - FL: P1-P12 populated with escalating profile (P1 $45,553 to P3 $407,375, then steady $98,915 through P9, then declining).
- STL - MO: P4-P10 populated. P7 = $92,226; P8 = $54,251; P9 = $48,826.
- TXR - TX - H: P4-P10 populated. P7 = $112,436; P8 = $96,748; P9 = $96,748.
- TXR - TX - V: P4-P10 populated. P7 = $62,400; P8 = $48,000; P9 = $48,000.

### Reconcile to sc_fee_schedule [ran]

`sc_fee_schedule` annual amounts vs `kpi_budgets` year sums:

| Account | sc_fee_schedule.amount | kpi_budgets 2400.1 year sum | Delta |
|---|---|---|---|
| CIN - OH | $376,686 | $376,687.80 | +$1.80 (rounding) |
| STL - FL | $1,400,000 | $1,399,999.99 | -$0.01 (rounding) |
| STL - MO | $489,497 | $439,431.48 | **-$50,065.52** |
| TXR - TX - H | $604,032 | $604,018.80 | -$13.20 (rounding) |
| TXR - TX - V | $0 | $312,000.00 | +$312,000.00 |

### Findings

- **CIN - OH, STL - FL, TXR - TX - H: kpi_budgets IS the recognition schedule.** Year sums tie to sc_fee_schedule within rounding. Overview reads kpi_budgets 2400.1 rows for the fee-revenue cadence. No new installment table required for these three.
- **STL - MO: kpi_budgets is LESS than sc_fee_schedule by $50,065.52.** This matches the MO sales tax residual documented in the purchasing handoff §10: "STL - MO's annual goal is `$281,345.95 + $50,000` before MO sales tax. The 122% figure is provisional until Sebastian supplies the rate." The kpi_budgets figures reflect the pre-tax recognition schedule; the sc_fee_schedule.amount includes the tax layer. **The Overview must consume kpi_budgets 2400.1 (not sc_fee_schedule.amount) as the recognition schedule for STL - MO to avoid a 10% "over target" false positive.**
- **TXR - TX - V: kpi_budgets 2400.1 year sum = $312,000; sc_fee_schedule.amount = $0.** This is expected per §4.6 + R-3 + R-11. TXR - TX - V is direct-sales, not contract-fee. The $312K in kpi_budgets is the annual forecast per playbook §4.6 (chef-owned direct sales). sc_fee_schedule.amount = 0 is by design (V is a "budget vs tracked" account, actuals seeded post-season per R-3).

### Verification against workbook

**BLOCKED.** The P8 workbook (`Budget vs Actual (SLT) (2026) P8`) is not in the repo. The per-period 2400.1 workbook actuals for these accounts cannot be checked from PG - only from the workbook that Kevin runs `verify_budget_seed_vs_xlsx.mjs` against. **Recommendation for Phase 1 loader PR:** the loader's post-load probe reconciles each fee account's 2400.1 workbook actual against `kpi_budgets 2400.1` and reports the delta. Deltas > $1 fail loud so this Q9 finding becomes measurable rather than assumed.

### Verdict Q9

**kpi_budgets is the recognition schedule** for 4 of 5 fee accounts (CIN - OH, STL - FL, STL - MO, TXR - TX - H, TXR - TX - V - all with the STL - MO caveat above about the pre-tax vs post-tax layer). **No new structure is needed for fee revenue.** The Overview's fee-account revenue renderer reads `kpi_budgets 2400.1` for the period budget and `pnl_actuals 2400.1` (once Q7 lands) for the closed-period verified actual. Open periods show the budget-to-date pro-rata proration (§5.5 revenue-source rule).

[ran] Live measurement per account. [code-read] `docs/handoff/PURCHASING_CC_HANDOFF_2026-08-28.md:416` (MO sales tax note), `docs/KPI_DASHBOARD_PLAYBOOK.md:194-226` (TXR - V direct sales, R-3 / R-11 context).

---

## Q10 - Contamination (R-9) status

**R-9 in the scope. Then a code-read proof that no Overview path will read `sc_daily_revenue` for fee accounts or for per-meal accounts whose `sc_revenue_live` is false. Since the Overview code doesn't exist yet, this is a design-check: propose the guard shape that will prevent this at Phase 2 time. Reference the PR #888 finding: all 5 fee accounts CONTAMINATED as of 2026-08-28. Has anything changed since?**

### Contamination status: UNCHANGED [ran]

Live measurement 2026-08-31, byte-identical to PR #888's 2026-08-28 numbers:

- `sc_service_prices` counts by (fee account, price_kind): CIN - OH: 8 projected, 0 actual. STL - FL: 22 projected, 0 actual. STL - MO: 8 projected, 0 actual. TXR - TX - H: 8 projected, 0 actual. TXR - TX - V: 8 projected, 0 actual. **Total actual-kind rows on any fee account service: 0.**
- `sc_daily_revenue` FYTD sums:
  - CIN - OH: 528 rows, 3 rows with actual_revenue > 0, sum = **$4,671.76** (matches #888 exactly).
  - STL - FL: 2,042 rows, 184 rows with actual_revenue > 0, sum = **$466,216.00** (matches #888 exactly).
  - STL - MO: 536 rows, 0 rows with actual_revenue > 0, sum = **$0.00** (latent).
  - TXR - TX - H: 508 rows, 0 rows with actual_revenue > 0, sum = **$0.00** (latent).
  - TXR - TX - V: 508 rows, 0 rows with actual_revenue > 0, sum = **$0.00** (latent, plus $149,496 projected on $0-designed services).

**No fix has landed since 2026-08-28.** R-9 remains OPEN. The Overview will inherit this defect if it reads `sc_daily_revenue` for fee accounts.

### Design proposal: the guard shape

The Overview's revenue resolver reads `sc_daily_revenue` ONLY for per-meal accounts whose `kpi_account_flags.sc_revenue_live = true`. Every other case reads `kpi_budgets 2400.1` (fee accounts: contractual) or `pnl_actuals 2400.1` (closed-verified periods) or a budget-to-date proration (open periods on non-live per-meal accounts).

```js
// src/app/api/kpi/overview/lib/revenue.js  (proposed for Phase 2)
//
// The ONE source of revenue for the Overview. Every card, every table
// row, every ticker read binds through this function. Do NOT read
// sc_daily_revenue directly anywhere else in the Overview.

import { costModelFor } from "@/lib/accountModels.js";

// R-20 §5.5 revenue source rule, in code:
export function resolveRevenueSource({ account, periodState, accountFlags }) {
  const cost = costModelFor(account);
  //   Fee accounts: contractual, always.
  if (cost === "pass_through") {
    return { source: "kpi_budgets:2400.1", model: "contractual" };
  }
  //   Direct-sales (TXR - TX - V): budget with tracked marker, until
  //   post-season upload lands as pnl_actuals.
  if (cost === "revenue_flex") {
    return { source: "kpi_budgets:2400.1", model: "tracked" };
  }
  //   Per-meal:
  //     - Closed & verified: pnl_actuals (finance file).
  //     - Closed awaiting finance: our estimate, marked.
  //     - Open with sc_revenue_live=true: sc_daily_revenue.
  //     - Open with sc_revenue_live=false: budget to date, marked "planned".
  if (periodState === "verified") {
    return { source: "pnl_actuals:2400.1", model: "finance" };
  }
  if (periodState === "closed_awaiting") {
    // per-meal fallback: our estimate (sc_daily_revenue if live, else our budget-to-date).
    return accountFlags?.sc_revenue_live
      ? { source: "sc_daily_revenue", model: "estimate" }
      : { source: "kpi_budgets:2400.1", model: "estimate-from-budget" };
  }
  // open
  return accountFlags?.sc_revenue_live
    ? { source: "sc_daily_revenue", model: "live-count" }
    : { source: "kpi_budgets:2400.1", model: "planned-from-budget" };
}
```

### Guard: fail loud, never silent

```js
// src/app/api/kpi/overview/lib/revenue.js  (proposed)
export async function loadOverviewRevenue(supa, { account, periodNo, start, end, accountFlags, periodStatus }) {
  const src = resolveRevenueSource({ account, periodState: periodStatus, accountFlags });
  if (src.source === "sc_daily_revenue") {
    // GUARD: sc_daily_revenue is only read for per-meal accounts with sc_revenue_live=true.
    // Both conditions must hold. Fail loud if either is violated.
    if (costModelFor(account) !== "at_risk") {
      throw new Error(`overview-contamination-guard: attempted sc_daily_revenue read on account ${account} (model=${costModelFor(account)}). This is R-9 / R888-1 contamination.`);
    }
    if (!accountFlags?.sc_revenue_live) {
      throw new Error(`overview-contamination-guard: attempted sc_daily_revenue read on account ${account} without sc_revenue_live=true.`);
    }
    // OK to proceed.
    return readScDailyRevenue(supa, {account, start, end});
  }
  if (src.source === "pnl_actuals:2400.1") return readPnlActuals(supa, {account, periodNo, line: "2400.1"});
  if (src.source === "kpi_budgets:2400.1") return readKpiBudgets(supa, {account, periodNo, line: "2400.1"});
  throw new Error(`overview-contamination-guard: unknown revenue source ${src.source}`);
}
```

### Probe shape

`scripts/probes/_probe_overview_revenue_contamination.mjs` (proposed for Phase 2):

- Iterate the 11 accounts x 3 period states (open, closed_awaiting, verified) x 2 flag values.
- Call `resolveRevenueSource` for each of the 66 combinations.
- Assert: `source === "sc_daily_revenue"` iff `costModelFor(account) === "at_risk"` AND `accountFlags.sc_revenue_live === true`.
- Assert: `source === "kpi_budgets:2400.1"` for all fee accounts on all period states, regardless of flag.
- Cover the seeded-failure case: call `loadOverviewRevenue` with a synthetic caller state that would violate the guard; assert it throws.

**This closes the "probe that passes on zero rows" family** by explicitly asserting the guard fires when triggered, not just that no violation happened in the current data.

### R-9 status

**R-9 is OPEN.** The fee-account price fix has not shipped as of 2026-08-31. The Overview design contains it (per the guard above) but the underlying `sc_daily_revenue` view remains contaminated for fee accounts. If any other code path reads `sc_daily_revenue` for a fee account (e.g., the SC dashboard, an export), the contamination is still active there. R-9's fix is EITHER:

1. Seed `sc_service_prices` with `price_kind='actual'` rows at $0 for every fee-account service (drops `actual_revenue` to $0 on the COALESCE fallback). Or:
2. Alter the `sc_daily_revenue` view to filter fee accounts out of `actual_revenue`. Or:
3. Delete the `is_flat_fee` services entirely (they're not really billable services).

**None of these are in Phase 0's scope.** The Overview's guard makes contamination invisible to Overview readers regardless of R-9's timeline, but R-9 remains OPEN for the SC-side surfaces and needs an owner ruling on which fix to ship.

[ran] Contamination measurement replicates #888 exactly, three days later. [code-read] `src/lib/accountModels.js` (costModelFor as the account-model authority). Overview code does not yet exist so this is design-check only.

---

## Completeness map (C2)

| Q | Status | Reason |
|---|---|---|
| Q1 - Engine reuse | **DONE** | Labor `buildBoard` [code-read] as library-callable now; extraction of loaders + purchasing resolver proposed for Phase 2 with file-level detail. |
| Q2 - Grain | **DONE** | Both engines expose week + period grain today [code-read]; folded via `periodOf(week_start)` from the shared periods helper. |
| Q3 - Proration | **DONE** | Labor + purchasing mechanics named at file:line [code-read]; day-proration impact per board reported; §11 B-11 rollout recommendation given. |
| Q4 - Roles | **DONE** | Role keys enumerated with roleGate file:line for each rule [code-read]; posture + salary matrix. Preview fence flagged for Phase 4. |
| Q5 - Card sync cadence | **DONE** | Three workflows enumerated [code-read]; live derive_runs shows nightly current [ran]; F-9 has not recurred; corpus-regression alarm gap named + tied to §11 E-8. |
| Q6 - Perks / R&M / Equipment | **DONE** | kpi_lines / activation / budgets presence [ran]; purchasing_actuals live rows [ran]; bucket-map gaps at route + client [code-read]; summable per (account, period) confirmed. |
| Q7 - pnl_actuals proposal | **PARTIAL** | Absence confirmed [ran]; DDL + loader shape + concerns proposed; workbook-side numeric verification BLOCKED (workbook is local at ~/Downloads, not repo-committed). |
| Q8 - kpi_period_status + kpi_account_flags | **DONE** | Absence confirmed [ran]; DDL proposed for both tables with seed strategy. |
| Q9 - Fee-account recognition | **DONE** | Per-period kpi_budgets 2400.1 rows measured [ran]; reconciled to sc_fee_schedule.amount; STL - MO delta explained (MO sales tax); TXR - TX - V delta explained (R-3). Workbook-side actual verification BLOCKED per Q7. |
| Q10 - Contamination (R-9) | **DONE** | Live probe replicates #888 exactly [ran]; guard shape + resolver proposed; probe outline given. R-9 remains OPEN for SC-side. |

**Total: 9 DONE, 1 PARTIAL (Q7 workbook side blocked). 0 NOT DONE, 0 silent drops.**

---

## Acceptance echo (C4)

- **Q1 "engine reuse callable + extraction proposal if not"** - [met-code-read + proposal for both boards]. Labor is callable, needs loader extraction. Purchasing needs a resolver.
- **Q2 "week + period grain, or only range"** - [met-code-read]. Both grains available on both boards.
- **Q3 "each board's current proration mechanics + adopt-day-proration cost"** - [met-code-read]. Both mechanics cited with file:line; impact per board reported; rollout for §11 B-11 proposed.
- **Q4 "site-leader posture roles + salary-control roles per R-28"** - [met-code-read]. Matrix given from roleGate.js.
- **Q5 "sync cadence + corpus regression alarm reach"** - [met-ran + met-code-read]. Workflows named; live freshness measured; F-9 not recurred; alarm gap tied to §11 E-8.
- **Q6 "5017.3 / 5002.1 / 5002.5 in bucket map + summable today"** - [met-ran + met-code-read]. All three present in kpi_lines / budgets; 5017.3 absent from all bucket maps; purchasing_actuals has real rows; summable today.
- **Q7 "pnl_actuals DDL + loader outline + concerns"** - [met-code-read for pattern + proposal; needs-gate on workbook numerical checks (blocked)].
- **Q8 "kpi_period_status + kpi_account_flags DDL"** - [met-code-read for pattern + proposal].
- **Q9 "kpi_budgets 2400.1 = workbook per-period? if so, they're the schedule"** - [met-ran on PG side; needs-gate on workbook cross-check (blocked)]. PG side reconciles to sc_fee_schedule for 3/5 accounts; 2 accounts have named-and-explained deltas.
- **Q10 "R-9 status + guard shape"** - [met-ran on status (unchanged) + met-code-read on design + proposal]. R-9 remains OPEN; guard prevents Overview from inheriting.

---

## Unmeasurable as written + blocked items

- **Workbook cross-check for Q7 + Q9 - BLOCKED.** The P8 workbook (`Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx`) lives at `~/Downloads/` per the pattern the purchasing handoff established. This audit does not have access to it. Recommended Phase 1 loader PR body includes the row-index map extracted from Chat-Claude's workbook read + a probe that reconciles kpi_budgets 2400.1 to workbook 2400.1 actual per account per period.
- **Aggregate-path library-callability proof for Q1 - PARTIAL.** Single-account + D26 salaried-only paths in the labor route already call `buildBoard` as a pure library function [code-read]. The aggregate path wraps the same call with `rolledUpMembers` / `rolledUpActuals` machinery; the callability from a server-side non-route context has not been tested. Not scoped in Phase 0; testable at Phase 2's engine PR by having the Overview's aggregate call `loadLaborBoardInputs` -> `buildBoard` with member lists and comparing against the labor route's aggregate response byte-for-byte (sentinel-style parity check).

---

## Recommended adjustments to Phase 1-4 scope

1. **Add a Phase-2 prep PR (or land as PR-1 of Phase 2): extract `paginateActuals` + `resolveMemberBudget` + related loaders from `src/app/api/kpi/labor/route.js` into `src/lib/labor/loaders.js`.** No behavior change; blast radius low; makes the Overview's engine PR (Q1) a straight consumer of the extraction. Small (~150 lines moved) but needs to land before the Overview builds against labor.
2. **Add a Phase-2 companion PR: build `src/app/kpi/purchasing/lib/resolver.js` (server-side `buildPurchasingBoard`).** Purchasing has no server resolver today; the Overview cannot consume raw route payload. This is a new build, not an extraction. Should be same-PR as the Overview engine; the resolver is co-owned by the Overview and eventually adopted by the purchasing route (§11 E-9 rollout).
3. **Phase 1 loader PR body includes a per-account per-period 2400.1 workbook-vs-kpi_budgets reconciliation.** STL - MO's known $50K MO-sales-tax delta must land explicitly so the Overview's fee-account renderer doesn't false-positive "over target."
4. **Phase 2 engine PR adds a `budget_to_date_days` field to both labor and purchasing board payloads.** Overview reads only that field; the drill boards continue to display their week-based figures. §11 B-11 rollout gets a runway.
5. **Phase 4 enable PR flips `KPI_PREVIEW_ONLY` at `src/lib/kpi/roleGate.js:69`** or lands a per-route fence. Enumerate this explicitly in the enable PR checklist; the current fence blocks every non-Kevin caller across all KPI surfaces.
6. **Cross-reference §11 E-8 (corpus regression) to Phase 5 / Phase 6.** The Overview's `sources` line (§5.4 R-21) should surface `cards_through` prominently so an operator eyeballing the chip catches a shrink even without an automated alarm. Automated detection remains a purchasing-side alignment item.
7. **R-9 (contamination) fix is NOT a prerequisite for the Overview build.** The proposed Overview guard (Q10) makes contamination invisible to Overview readers regardless of R-9's timeline. But R-9 remains OPEN for SC-side surfaces and needs an owner ruling on which of the three fix shapes to ship.
