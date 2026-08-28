# Purchasing CC handoff - 2026-08-28

> This is the code-side half of the Purchasing consolidation into the Master KPI chat. Chat-Claude has separately shipped the architecture, data-model, and reconciliation handoff at `~/Downloads/HANDOFF_PURCHASING_TO_MASTER_KPI.md`. This document is what only the coding CC can write: the engine, the derive, the ingest lane, the probe battery, the assertions, the migrations, and the operational reality.
>
> Audience: a competent engineer who has never seen this codebase.
>
> Written by the purchasing CC before rotating off. Assume anything below that says "we" means the intranet-repo maintainer (Kevin) and the purchasing CC together.

---

## 0. Where you are

**Repository:** `KitchFix-Intranet/kitchfix-intranet` (GitHub). Working checkout for this session: `/Users/kevinfietek/dev/kf-r15/`. Kevin's primary is `~/dev/kitchfix-intranet/`; audit clones sit under `~/dev/li-audit-2026-08-17/kitchfix-intranet/`. Do not touch the primary from a kf-r15 session unless you know why - the two share `.env.local` via symlink and touching branches in the primary can strand work.

**Stack:** Next.js 16 (Turbopack default), React 19, NextAuth v4, Supabase (Postgres), Vercel from `main`. There is no staging. Prod is a real business.

**The KPI Purchasing surface:** `/kpi/purchasing` route + `src/app/api/kpi/purchasing/route.js`. Fed nightly by two GitHub Actions (`.github/workflows/purchasing-sync.yml` at 07:30 UTC and `.github/workflows/purchasing-report-ingest.yml` at 06:00 UTC). Read-only from the operator's side; every write happens at derive time.

**Owner:** Kevin Fietek, sole committer, Director of Operations at KitchFix. Rules he expects you to know are in `CLAUDE.md`. Read that first. Two things worth pulling out here:
- **He merges. CC never does.** Push and open the PR in the same turn; report the PR number; wait.
- **Env-file discipline (`.env.local`)** - USE via `--env-file=.env.local` to a Node script; SEE (cat / head / grep / print value / print hash / print length) is never allowed. Presence via `process.env.NAME ? "PRESENT" : "ABSENT"` only.

---

## 1. The engine, file by file

Every file that matters at request time or write time. Line counts as of 2026-08-28.

### `src/app/api/kpi/purchasing/route.js` - 2,235 lines

The one handler for `/api/kpi/purchasing`. Three code paths, one file, same reason labor kept them side by side: the shape of the response differs between them and extracting shared helpers requires a threading pattern (`members` + `isAggregate` + `isPassThrough` + preview intersection) that already caused three sweeps.

- **GET** starts around L975. Auth gate (NextAuth session -> email), then `KPI_PREVIEW_ALLOWLIST` gate (`src/lib/kpi/roleGate.js`), then `resolvePreviewAccess` (shared with labor - see §1.8), then range resolution.
- **Aggregate path** (`ALL` / `EAST` / `WEST`). `resolvePortfolioMembers` returns the account list; `paginateActuals` + `paginateWeekly` walk `purchasing_actuals` + `v_purchasing_by_site_week` in 1000-row pages via `.in("account_key", memberChunk)` chunked at 100.
- **Single-account (at_risk) path.** Same `members` shape, single entry. Reads `purchasing_actuals` + weekly view + `rippling_report_only_pending_v1` + `card_charges` + four ledgers + vendor rollup + budget + freshness in one `Promise.all`.
- **Pass-through path** (`CIN - OH`, `STL - FL`, `STL - MO`). Renders a completely different board via `ManagementFeeCard`; still reads `purchasing_actuals` for the reimbursable / fun-money split. The management-fee model lives in the resolver, not the client.

**Named seams:**

- `loadPending(supa, {members, start, end})` around L760. Returns `{amount, line_count}` for uncoded rippling_spend rows. Merged with `loadReportOnlyPending` via `mergePending` from `src/app/kpi/purchasing/lib/precedence.js`; the merge implements the between-sources precedence rule.
- `loadCompliance(supa, {members, start, end, today})` around L975. PR 6 addition. Reads `rippling_report_txns_latest` sentinel-category rows, joins by `work_location` label to `spend_work_location_site_map` for account_key, filters to attributable sites. Returns the shape `CardCompliance` renders directly. Corp/Remote surface as a footer count only at aggregate scopes.
- `loadCardCharges` + `loadLedgerRows` + `loadVendorRollup` between L680 and L970. Every ledger is capped at ~25-50 rows; the drill table's `?drill=lines` path is off by default because the full FYTD payload was 12.7k rows / 4.5MB.
- `loadFreshness` at L599. Returns `{last_billcom_sync, last_rippling_sync, last_derive_at, cards_through, report_ingest_at, ...}`. The three-source freshness pill on the page reads this and marks the trailing source with a "· behind" chip.

**What this file does NOT do:** it never re-forks anything from labor. Periods come from `@/app/kpi/labor/lib/periods.js` via a barrel import - known debt, future file move, `CLAUDE.md` rule 4 forbids forking.

### `src/app/kpi/purchasing/page.js` - 1,386 lines

Client entry for `/kpi/purchasing`. Renders one of two boards depending on cost model:
- **At-risk board.** PeriodCard + three BucketCards + LedgerCards + PurchasingTable + CardPurchases + (2026-08-28) CardCompliance.
- **Pass-through board.** ManagementFeeCard alone at the top, then the same lower half.

Owns the URL state: `?account=<key>` + `?start=<iso>` + `?end=<iso>` + `?preset=<name>` + `?preview=<key>`. **The preset canonicalisation** at L160-173 was the R14 defect (`?preset=fytd` silently fell back to the current period for four weeks); read that block before touching URL handling. `presetResolved` writes explicit dates to state so the effect below can `router.replace` to a canonical URL.

Mounts the compliance card twice - once in the at-risk path (L1265) and once in the pass-through path (L1030). Both use the same component; the scope-label string differs.

### `src/app/kpi/purchasing/lib/board.js` - 1,138 lines

Client-side board math. `resolveCardDisplay({cardKind, spent, budget, elapsedFrac, closed, isFutureRange})` is the ONE call every card makes to derive pill / hero / state colour. **§9B one-source rule:** four separate defects came from breaking this - keep it broken.

Also owns `fmt$`, `moneyArrow`, `fmtPct` (all inlined here because importing `src/lib/opsUtils.js` pulls googleapis into the client bundle and the build fails). Also owns `chartUnit(tier)` returning `'week'|'period'` so PeriodCard + BucketCard can never disagree on cadence.

**No fetch. No googleapis-touching helper. Never re-forks labor.** Range utilities come from `periods.js`.

### `src/app/kpi/purchasing/lib/precedence.js` - 155 lines

The precedence rule, as documented constants. Read the docblock verbatim; it's the source of truth for the API-vs-report merge.

Exports:
- `PRECEDENCE_RULE` - the human name, one string, greppable
- `REPORT_TXNS_LATEST_VIEW` / `REPORT_ONLY_PENDING_VIEW` - view names
- `JOIN_KEY` - the 24-char parent hex bridge between `report.parent_txn_id` and `substring(rippling_raw_spend_lines.external_id, 1, 24)`, with a `verified_by` pointing at `_probe_report_join_key.mjs` and a `verified_at` date
- `loadReportOnlyPending(supa, {members, start, end, IN_CHUNK})` - paginated read of `rippling_report_only_pending_v1` (the view; NOT a base table)
- `mergePending(apiRows, reportRows)` - the API-over-report merge that the route calls

**The 24-char parent-hex is the join key.** `purchasing_actuals.source_bill_id` (36-char UUID from spend_transaction.id) is NOT the join key. Comparing `source_bill_id` against `rippling_report_seen_txns.parent_txn_id` shows zero overlap and looks like a namespace mismatch - it's not. See `docs/GOTCHAS.md` (2026-08-28 entries) for the full description. **CC made this mistake and retracted before Kevin read it. The next CC will make it too if this section is not read.**

### `src/app/kpi/purchasing/lib/complianceAsserts.js` - 53 lines

Pure JS helpers. `assertSitePeopleParity(site_rows)` throws when a compliance-card site total doesn't equal the sum of its people rows. `assertRegionParity(region_split, total_count, total_amount)` throws when EAST + WEST != ALL. Extracted from `CardCompliance.js` so `scripts/probes/_probe_compliance_check3.mjs` can seed a mismatch and prove they fire.

### `src/app/kpi/purchasing/purchasing.css` - 2,305 lines

Card frames, states, chart bars, projection outline, freshness popover, compliance card. Prefix `.kpi-p-*`. Palette in `:root` at L26. All identity colours live here (`--kpi-p-food`, `--kpi-p-pkg`, `--kpi-p-veh`, `--kpi-p-equip`, `--kpi-p-rm`, `--kpi-p-steel`); state bars override identity via `.st-under` / `.st-over` / `.st-running`.

**R17 fix (2026-08-28):**
- `.kpi-p-bar.st-running` now overrides identity with `--kpi-p-steel` (deliberate neutral).
- `.kpi-p-proj` border colour moved `--n-500` -> `--n-700` (2.87:1 -> ~9.5:1 against white plot bg).
- Compliance card labels (`--n-500` -> `--n-600`), chevron (`--n-400` retired for text).
- `.kpi-p-mf-mini-avg` (mgmt-fee average line, information mark) `--n-400` -> `--n-700`.

**Do not author a raw px literal.** Every dimension is a token.

### Components (`src/app/kpi/purchasing/components/`)

- `PeriodCard.js` - 370 lines. Hero + budget/spent/remaining block + WeekChart at tier C. Owns "Bills / Cards / Pending" sub-rows and "Projected close" row. Reads `resolveCardDisplay` for pill+hero, `resolvePeriodCardDisplay` for the closed-period comparison + sparkline (R13).
- `BucketCard.js` - 246 lines. Food / Packaging / Vehicle. Same shape as PeriodCard but with a per-bucket WeekChart at tier A or B depending on range width.
- `LedgerCard.js` - 203 lines. Equipment / R&M / Reimbursable / Vehicle. Every purchase listed with a hard cap; footer states the cap explicitly (`Showing 25 of 87 lines · $X total`) or the count when uncapped. **Client-side Check 9 assert** throws when hero != ledger total.
- `ManagementFeeCard.js` - 270 lines. Pass-through only. Left pane = billed-back spend, right pane = annual goal + fun-money inline.
- `CardPurchases.js` - 174 lines. Uncoded card charges list with the "Pending" hero. Merges the report-only pending rows (source label `"report_only"`) alongside API rows so the hero and the list agree (R16 P0 fix).
- `CardCompliance.js` - 221 lines. PR 6, the last unbuilt piece of the board. Report-side uncoded (sentinel) at attributable sites, grouped by site then person. Auto-expands at single-account scope; Corp/Remote surface as a footer at aggregate scopes. Fires `runCheck2And3(data)` inline on every render.
- `PurchasingTable.js` - 723 lines. The drill-down table. Row modes: By transaction (default), By vendor (from `vendor_rollup`), By week. Loads bill lines on expand via a separate scoped GET, not on mount. Footer totals asserted to equal bucket card heroes.
- `WeekChart.js` - 553 lines. The chart used by PeriodCard + BucketCard. `buildWeekSlot` and `buildPeriodSlot` are the two per-unit slot builders; `PROJECTION_MIN_ELAPSED = 0.25` is the running-unit projection gate.
- `FailureCard.js`, `Pill.js`, `PurchasingHelpPops.js`, `SkeletonBoard.js` - support: error UI, tone pill, help-popover bodies, loading skeleton.

### Shared with labor (owner rule: change one, both boards move)

These live outside `src/app/kpi/purchasing/` and are imported by the purchasing route + page. **A change to any of these is a labor-and-purchasing change.**

- `src/lib/kpi/classifyTier.js` - 31 lines. `classifyTier({weeksInRange, tierBreak})`. Purchasing calls with `tierBreak: 9`; labor calls with the default 13. **The constant is per-caller; the file is shared.**
- `src/lib/kpi/previewAccess.js` - 161 lines. `resolvePreviewAccess` + `deriveClientAccount` + `shouldRestoreLastAccount`. Preview only narrows access; never grants.
- `src/lib/kpi/roleGate.js` - 254 lines. Corporate / RDO / site role decisions. The ONLY authority on who sees what.
- `src/lib/kpi/portfolioMembers.js` - 43 lines. `resolvePortfolioMembers(supa, account)` for ALL / EAST / WEST. Order fixed by team_key.
- `src/lib/rippling/paginate.js` - 175 lines. `fetchAllOffset`, `fetchAllKeyset`, `fetchAllIn`, plus `chunkKeys`. **Header of the file names the two failure modes** (silent 1000-cap truncation vs 400 URL overflow). Read before writing pagination.
- `src/app/kpi/labor/lib/periods.js` - imported barrel path. Purchasing uses `FY_START_ISO`, `periodOf`, `periodStartISO`, `periodEndISO`, `weekStartsInRange`, `inferRangeSelection`, `currentPeriodNo`. **CLAUDE.md rule 4 forbids forking these.**
- `src/app/kpi/labor/components/Shell.js` + `FolioRail.js` + `HelpPop.js` + `RangeMenu.js` - purchasing imports the shell, the rail, and the popover portal. Design system is shared.

### `src/lib/accountModels.js` - 257 lines

**Single source of truth for cost model** (owner ruling 2026-08-20; documented in the file's docblock at length). Do not read `accounts.billing_model` for cost-model decisions - that column drifted in May 2026 and cannot be used as a predicate. Change an account's cost model here, in a PR, only when a contract renegotiates.

Exports:
- `PASS_THROUGH_ACCOUNTS = new Set(["CIN - OH", "STL - FL", "STL - MO"])` - the three management-fee accounts.
- `costModelFor(accountKey) -> "at_risk"|"pass_through"|"revenue_flex"` - the answer. `revenue_flex` is a named empty set reserved to 2027.
- `MANAGEMENT_FEE_GOALS` - annual goals + fun-money allowance per mgmt-fee account.
- `PURCHASING_ENVELOPE_EXCLUSIONS` - a named empty set (V6_ENVELOPE_ACCOUNTS retired; kept for readable call sites).

### `src/lib/purchasingSpendAsserts.js` - 243 lines

**Pre-write deterministic asserts run by `purchasing_rippling_sync.mjs` before it upserts.** Every one throws on flag; none silently corrects.

- `assertNoSupersededSplitParents(derivedRows, rawRowsByRippling)` - the coexisting-multi-set shape. INV-P8 exemplar parent `6a6c093207bd8eb94ef93ca4` carried three sets (`[311.40]`, `[155.70, 155.70]`, `[103.80, 103.80, 103.80]`), each summing to $311.40, stored total wrongly $934.20.
- `assertTxnDateHasMultipleValues(candidateRows)` - a date-window rule against a single-date table is meaningless. Fires when the pair-detection candidate set has ≤ 1 distinct `txn_date`. Caught the 2026-08-20 first-run defect where every row had `txn_date = '2026-08-19'` and Ruling 4 collapsed 2,767 parents on same-date pairs.
- `assertNoAuthPairSurvivors(nonExcludedDerived)` - post-Ruling-4 gate. Groups by `(merchant, cents)` on the non-excluded slice; fires if any adjacent pair is within 5 days. Defence in depth; only fires when a bug-shape row slipped past Ruling 4.
- `assertNoNonUsdAmountsSummed(derivedRows, rawRowsByRippling)` - any non-USD amount that would sum into a USD roll-up is a defect regardless of the FX rule.

### `src/lib/gmailReadReport.js` - service-account-impersonated read of the Rippling report email

**READ-ONLY BY CONSTRUCTION.** Scope is exactly `https://www.googleapis.com/auth/gmail.readonly`. The file never imports `gmail.users.messages.send`, `.modify`, `.trash`, `.delete`, or `.batchModify`; a future edit that adds any of those must also broaden the scope, which is a red flag to the reviewer.

- `checkFresh(internalDateMs, nowMs)` - pure function. Throws `REPORT_STALE` when the newest matching message is older than 26h. Null / undefined / unparseable timestamps all throw - a missing timestamp is unknown age, not fresh. `_probe_report_ingest_staleness.mjs` proves the throw fires 7 of 7 without a real Gmail message.
- `readScheduledReport({...})` - the orchestration wrapper. Impersonates `RIPPLING_REPORT_MAILBOX_ADDRESS` via SA delegation, runs the Gmail search filter, downloads the CSV attachment. Called only by `scripts/purchasing_report_ingest.mjs`.

### `src/lib/gmail.js` - 449 lines

The unrelated invoice email sender. Uses the operator's own OAuth token to send a submission email + PDF attachment. Called from the invoice capture flow (`/api/invoice-capture/*`), not from purchasing. Listed here because a search for "gmail" in this codebase surfaces both; do not confuse them. The report-ingest lane never touches this file.

---

## 2. The derive pipeline

Two sync scripts, one CSV loader, one report orchestrator, one report-txns loader. Sequenced by the workflows.

### `scripts/purchasing_billcom_sync.mjs` - 1,103 lines

C2 in the PHASE 1 spec. Three steps per invocation:

- **a. References.** `billcom_ref_accounts` (2 pages of 999), `billcom_ref_classes`, `billcom_ref_vendors` via full replace. Vendors are net-new per `purchasing-5` migration; INV-P10 found bill headers carry no vendor name (`organizationName` is our own company), so `/vendors` is the only source of a real vendor name for the By-vendor UI + miscoded-vendor search. `/vendors` uses the v3 envelope (`results` + `nextPage`), NOT v2 - do not mix parsers.
- **b. Bills.** `/bills/filtered` on `invoiceDate` window `[today - 45d, today]` with `start`/`max=500`. On the 1st of each fiscal period, also a full-FY pass filtered per period. Header + lines upserted by content hash (append-on-hash-change). **Bill lines are embedded in the v2 response;** do not re-fetch.
- **c. Derive.** Atomic per-bill: DELETE existing `purchasing_actuals` rows for `source_bill_id`, then INSERT the new set inside one Supabase call sequence guarded by a per-bill try/catch that keeps last-good state on failure.

**Walk-completeness assertion (#867):** three completeness checks were added to the bill.com walk after the sweep found 80%, 93%, 95% headroom. Any `nextPage` cursor that returns fewer rows than expected fails the pass, not silently continues.

### `scripts/purchasing_rippling_sync.mjs` - 1,603 lines

C3 in the PHASE 1 spec. Reads `rippling_raw_spend_lines_latest`, applies the six rulings, upserts `purchasing_actuals`.

**The six rulings in code order, with exactly what each groups on:**

- **Ruling 1** - `txn_date` derived from the parent ObjectID timestamp minus one day (owner ruling 2026-08-20). Fallback to `first_seen_at::date` when the ObjectID is missing (should not happen on the current corpus; counted for visibility). Measured exact against the report across 4,838 rows: zero landed on a different fiscal week.
- **Ruling 2** - duplicate-split parent exclusion. Two shapes: `bucketA` (all lines equal, N ≥ 2) and `bucketB` (≥ 2 amount buckets whose (amount × count) products sum to the same value). Excludes ALL lines under a flagged parent, sets `excluded=TRUE`, `reason='dup_split'`.
- **Ruling 3** - non-USD exclusion. `purchasing_actuals.amount` is a bare USD numeric with no currency column. Any non-USD row summing into it is a defect regardless of the FX rule. Excluded via `reason='non_usd'`.
- **Ruling 4** - auth-pair exclusion. **Grouped by `(merchant, exact cents)` within the API's own data**, within a 5-day window, adjacent-pair only. Precedences 1 (both in report → keep both) and 2 (earlier in report → keep earlier) require the parent hex to be present in `rippling_report_seen_txns`; Precedence 3 (default) keeps the later and excludes the earlier. **Ruling 4 CANNOT see cross-source pairs** - an auth on the API side and a settlement on the report side at the same underlying charge do not pair through this rule. That is what shipped Subset 1 (56 stale auths); see §5 GOTCHAS.
- **Ruling 5** - zero-amount exclusion.
- **Ruling 6** (#885, 2026-08-28) - same-parent-hex + coded-on-report. Per API row: if `rippling_report_txns_latest` has a non-sentinel `category` at the same `parent_txn_id`, exclude the API row with `reason='report_coded'`. **Exact-key match on the 24-char parent hex, no fuzzy join.** Closed 56 stale auths on the 2026-08-28 corpus. Precedence slot: before `auth_pair`, because "the coder actually closed the charge" is a stronger statement than "we suspect this is the earlier of a pair."

**Standing derive log for the 132-row observability (Ruling 6 addition):**

```
[ruling-6] report-coded parents loaded: <N>
[ruling-6] report-coded line exclusion: lines=<N> usd_amount=$<amt> ...
[ruling-6] cross-source parity: api_parents=<N> in_report=<N> not_in_report=<N> (<pct>% same-hex both sides)
```

The `not_in_report` count is what §2 of Chat-Claude's handoff calls "the 132 unbridged pending rows." If Rippling's rate of same-hex-both-sides drifts, this line moves.

**The stored decision (not a rule):** `scripts/purchasing_detect_truncation_pairs.mjs`. Prefix-tolerant pair detection; ruled parents live in `purchasing_truncation_pair_rulings` (migration `purchasing-12`, seeded 2026-08-27 with the 45 pairs Kevin read individually). The detector NEVER auto-excludes. On a new candidate:
- exit **0** = no new candidates
- exit **4** = new candidates found, workbook written to `~/Downloads/truncation_pair_candidates_<date>.xlsx`, Kevin rules

Same discipline as the report-only precedence rule: the derive refuses to guess which pair is the same vendor. The human rules.

### The derive-runs status row

Every derive script writes a row to `purchasing_derive_runs` at exit: source name, status, row count, error message on failure, timestamp. **This is what `loadFreshness` reads.** The freshness pill on the board splits three sources: bill.com sync, rippling sync, and the report ingest lane. If any source is missing or > 30h behind, the pill flips amber and marks that source with "· behind."

### `scripts/purchasing_report_load.mjs` - 174 lines

Ruling 4 seed loader. Two idempotent input paths:
- `--csv=<path>` - fresh Rippling CSV export.
- No `--csv=` - falls back to `data/rippling_report_seen_txns.txt` (repo-committed snapshot; pure 24-hex ObjectIDs, one per line). Any non-hex line refuses to seed and exits.

Both paths upsert with `ignoreDuplicates: true` so repeat runs are no-ops. Called by `purchasing_report_ingest.mjs` on the scheduled path.

### `scripts/purchasing_report_txns_load.mjs` - 344 lines

CSV -> `rippling_report_txns` loader (append-on-content-hash). The `rippling_report_txns_latest` view resolves newest-per-parent from this base table. This is the file the emailed-shape parser lives in; the header matcher is two-pass:
1. `normalise(header)` - lower, strip whitespace, drop punctuation.
2. `stripTrailingParenGroup(header)` - handles the manual-shape suffix (`Amount (by category) - Currency`) without breaking the emailed-shape suffix (`Amount (by category) (None)`).

**The loader only ever sees the emailed shape.** Do not "fix" the header matcher for a format the pipeline never encounters (28 columns emailed vs 29 columns manual, no preamble vs config preamble, amount column single vs split).

### `scripts/purchasing_report_ingest.mjs` - 200 lines

The nightly orchestrator. Called by `.github/workflows/purchasing-report-ingest.yml` at 06:00 UTC. Ordering:
1. Read the mailbox via `readScheduledReport` (SA-impersonated, `gmail.readonly` only). Fails loudly if the newest matching message is > 26h old, absent, or has no CSV attachment.
2. Write the CSV to `/tmp/rippling_report.csv` (or `--dest=<path>`).
3. Spawn `purchasing_report_load.mjs --csv=<path>`. That script is unchanged from the manual path.
4. Write a `purchasing_derive_runs` row - `source='rippling_report'`, status, row count, error message on failure. This is what the board's freshness pill reads.
5. Delete the downloaded CSV. **It carries employee names; must not persist on the runner and must never be committed.**

**Every failure exits non-zero AND writes a `status='failed'` derive-runs row before exiting.** The board sees the failure whether or not the workflow is visible.

**First-fire lag:** a newly-landed scheduled workflow does not fire on its first tick. `purchasing sync` took ~35 hours to first-fire; the report-ingest lane took ~40. **Not a bug. Wait a day before debugging the cron.** The first successful unattended fire on the report-ingest lane was 3:58am on 2026-08-28.

### Rollup: five other scripts under `scripts/`

- `purchasing_apply_category_rulings.mjs` (455 lines) - applies stored owner rulings from `spend_category_map`. Not run nightly; run when a new category needs a manual GL mapping.
- `purchasing_billcom_rederive.mjs` (247 lines) - forced re-derive of a bill-ID range. Ops tool, not scheduled.
- `purchasing_review_worksheet.mjs` (393 lines) - miscoded-vendor / miscategorised-line workbook for Sebastian.
- `purchasing_seed_truncation_pair_rulings.mjs` (138 lines) - one-shot seed of the initial 45 truncation-pair rulings. Idempotent.

---

## 3. The ingest lane, end to end

**The piece that took longest and is now the most reliable part of the system.** Rippling's API cannot deliver current card data (§2 of Chat-Claude's handoff explains why three routes closed). The answer is email.

1. **Rippling workflow.** Kevin's Rippling account owns `Spend Report Daily`, a Rippling-side workflow that emails the report nightly to `kitchfix.admin@kitchfix.com`.
2. **Mailbox.** The Google Workspace SA (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) is delegated `gmail.readonly` on that inbox via the Workspace admin panel (Kevin approved 2026-08-27). `RIPPLING_REPORT_MAILBOX_ADDRESS` names the mailbox; `RIPPLING_REPORT_SUBJECT_FILTER` names the Gmail search query.
3. **GitHub Action** at `.github/workflows/purchasing-report-ingest.yml`. Cron `0 6 * * *` (06:00 UTC = 00:00 CST / 01:00 CDT, inside Kevin's owner window of midnight to 2am Central). Runs `scripts/purchasing_report_ingest.mjs`.
4. **Staleness gate** at 26h. `checkFresh` throws `REPORT_STALE` when the newest matching message is older than the window. Absent / null / unparseable timestamps all throw. `_probe_report_ingest_staleness.mjs` proves 7 cases: fresh, 25h old, 26h + 1ms, ancient, missing, string number, string junk.
5. **Loader** at `scripts/purchasing_report_load.mjs` (Ruling 4 seed) AND `scripts/purchasing_report_txns_load.mjs` (the report_txns base table). Both are called by the orchestrator on the scheduled path.
6. **Base + latest views.** `rippling_report_txns` (append-on-content-hash) + `rippling_report_txns_latest` (newest per parent_txn_id, view). `rippling_report_seen_txns` (parent-hex set for Ruling 4).
7. **Derive** at `scripts/purchasing_rippling_sync.mjs` at 07:30 UTC (90 minutes after the ingest lane). Reads the seen-txns set + the report_txns latest, applies Ruling 6, upserts `purchasing_actuals`.
8. **Freshness row** to `purchasing_derive_runs`. Freshness pill on the board sees it.

**The failure surface, verbatim:**
- exit 2 = mailbox read failed (REPORT_STALE, NO_MATCH, NO_ATTACHMENT, NO_CSV_ATTACHMENT, or SA delegation not granted yet)
- exit 3 = loader script exited non-zero
- exit 4 = derive_runs write failed (very rare, service_role missing?)
- exit 5 = unhandled exception

Every non-zero fails the job. The orchestrator writes a `derive_runs` row with `status='failed'` before exiting.

---

## 4. The probe battery

Every probe under `scripts/probes/` that touches purchasing (23 files as of 2026-08-28). What each proves, and what it cannot.

### CI-wired

- `_probe_kpi_contrast.mjs` - text at 4.5:1, graphical (dashed/outline) at 3.0:1, across `kpi.css` + `purchasing.css`. **This gate is the one that shipped `--n-500` at 2.87:1 on `.kpi-p-proj` for eleven rounds because it read `kpi.css` only.** Extended in R17 (2026-08-28) to scan both files, extract dashed/dotted borders + outlines, and score at the graphical threshold. Add any new `src/app/kpi/*/*.css` to `CSS_PATHS` at add time.
- `_probe_r17_running_bar.mjs` - S2 sweep at 1680 / 1456 / 900 on both URL shapes with a range-parity assert before the visual comparison. DOM-sniffs the running-bar `background` and the projection `border` on every chart; asserts identity across all three.
- The **migration-gate** workflow at `.github/workflows/migration-gate.yml` - not a probe but functions as one. Job A on `pull_request` fails the PR if `docs/migrations/*.sql` is added; Job B on `issue_comment` matches `applied in Studio: YES` from the OWNER and emits a per-SHA success. Any push resets Job A - flip-and-merge cannot survive a push.

### Run-on-demand (not CI-wired; documented so the next person knows they exist)

- `_probe_p22_reconcile.mjs` - the P&L reconciliation. Rerunnable: `--workbook=<xlsx> --periods=1-8 [--exclude-buckets=repair,equipment]`. Thresholds live in the file (0.25% portfolio, $2,000 per account). Encodes Joe/Kevin's equipment-accrual ruling as `EQUIPMENT_ACCRUAL_ACCOUNTS_5002_5`; verdict uses ex-accrual arithmetic (labor's salary-line semantic).
- `_probe_p22_workbook_shape.mjs` + `_probe_p22_row3_detail.mjs` + `_probe_p22_tbrfl_shape.mjs` - shape probes for the P&L export. TBR-FL's 3500.1 vs 3500.2 finding was surfaced by these.
- `_probe_compliance_card.mjs` - S2 sweep on the compliance card at three widths + auto-expand + region parity.
- `_probe_compliance_check3.mjs` - seeds Check 2 and Check 3 mismatches, asserts each throws. Four seeds, four throws.
- `_probe_kpi_budgets.mjs` - budgets against the P&L. Pre-P22 tool; superseded but kept.
- `_probe_report_join_key.mjs` - 24-char parent-hex bridge measurement. Proved 21578 / 21578 rows carry a matching prefix on 2026-08-26. Referenced by `precedence.js` as `verified_by`.
- `_probe_report_purchased_at_vs_txn_date.mjs` - Ruling 1 measurement. Zero rows landed on a different fiscal week.
- `_probe_report_ingest_staleness.mjs` - 7 assertions on `checkFresh`. Proves the throw fires on missing / null / stale / edge-case timestamps.
- `_probe_report_hero_movement.mjs` - R16 P0 evidence. Report-only pending rows move the hero.
- `_probe_report_attribution.mjs`, `_probe_report_txns_verify.mjs`, `_probe_report_txns_mapping.mjs`, `_probe_r16_report_only_reach.mjs` - report-side sanity probes from the R16 arc.
- `_probe_rippling_report_txns_pii_audit.mjs` - names discipline. Confirms no rendered value in the report_txns table exposes a name where the board would render one.
- `_probe_rippling_spend_attribution_axes.mjs`, `_probe_rippling_spend_extra_fields.mjs`, `_probe_rippling_spend_payload.mjs` - API-side spend line probes.
- `_probe_inv_p12_45_pairs_report.mjs` - the 45-pair truncation report. One-time; kept in the tree for regression.
- `_probe_upload_compliance.mjs` - compliance card upload path check.
- `_probe_post_fix_report.mjs` - a post-fix verification from an earlier arc.
- `_probe_labor_budget_acceptance.mjs` - labor budget probe; here because purchasing's audit reused labor's budget-comparison scaffolding.

### Where the probes that pass on zero rows family lives

Two live examples this week:
- **`_probe_kpi_contrast.mjs` scanning `kpi.css` and not `purchasing.css` for eleven rounds.** The moment it read the right file it found 15 text failures and 6 graphical failures, including two I shipped in the previous commit.
- **The S2 screenshot sweep comparing two different ranges and reporting them consistent.** The `?preset=fytd` URL silently fell back to the current period; the sweep rendered `P9` under both URL shapes and reported them identical.

The standing rule is now `BUILD_ACCURACY_PROTOCOL.md` **S2**: sweep both URL shapes AND assert they resolve to the same range before comparing anything. And **S3** (2026-08-28): visual acceptance measures contrast against the surface behind the mark, not just DOM presence. Both classes have names now.

**A probe that only runs when someone remembers is a different kind of guarantee.** The 20 above are run on demand; the 3 in the CI-wired list are the ones you can count on without a human in the loop.

---

## 5. The assertions

Live gates that run on every request or every derive; the ones that name a numeric invariant. **What each compares, when it fires, and what can be wrong while it passes** - that last question is the one INV-P21 was built to answer.

- **R5 chart geometry** (client, `WeekChart.js`). `linePos / barHeight === target / spent` per bar. Passes when the chart draws to a consistent scale; can be wrong when the ratio is right but the scale is capped by `TARGET_CAP_MULT` (target line overflows the plot; caption still carries the number).
- **R6 ledger reconciliation** (client, `LedgerCard.js`). Check 9: hero != sum(ledgerRows) throws in dev, logs in prod. Passes when the ledger walks the same query the hero does; can be wrong when the cap silently truncates AND the totalCount is missing - PR-2 R6 Part B added the "showing N of M" footer so a capped list states its cap.
- **R10 state consistency** (client, `PeriodCard.js` + `BucketCard.js`). Every displayed value + every caption + pill tone comes from ONE `resolveCardDisplay` call per card. Passes when the resolver is the sole source; can be wrong when a component recomputes a derived value inline (this has happened four times; §9B of the spec codifies the rule).
- **Input-signature assertion** (server, in the derive: `purchasingSpendAsserts.js`). Every non-excluded slice sums to the shape the derive claims. Passes when the shape checks (superseded-split absent, non-USD absent, no auth-pair survivors); can be wrong when a NEW bug shape appears that no existing assert names.
- **Compliance Check 3** (client, `complianceAsserts.js`). Site totals sum to their people rows on both charges and amount. `_probe_compliance_check3.mjs` seeds four mismatches (site charges +1, site amount +$100, region east count +1, region east amount +$500) and asserts each throws with a clear message.
- **Compliance Check 2** (client, `complianceAsserts.js`). `region_split.east + region_split.west === total_count` on both count and amount. Server throws in the resolver if the split doesn't match; client is belt-and-braces.
- **Migration gate** (CI). Any added `docs/migrations/*.sql` fails the PR until Kevin comments `applied in Studio: YES` on the same SHA. Passes when no migration; can be wrong when the migration file is included but the code was already merged (order matters).
- **Purchasing derive `assertTxnDateHasMultipleValues`** (server, in the derive). Ruling 4 refuses to run if the candidate slice has ≤ 1 distinct `txn_date`. Passes when a normal corpus flows through; can be wrong when a corpus with one date is truly correct (edge case that would never happen in production).

**What can be wrong while all of these pass** - INV-P21's answer, condensed: **an accrual on the P&L side that never enters the pipeline.** Every assertion above measures the derive against itself or the client against its own resolver. None of them see the finance-side journal entries (equipment commitments, Missouri sales tax, Sebastian's reclassifications). The reconciliation probe at `_probe_p22_reconcile.mjs` is the ONE that measures the derive against an external source - and it's the ONE that runs on demand, not on CI.

---

## 6. Migrations

Twelve numbered migrations + one shared with labor. Ordered:

| # | file | what it did |
|---|---|---|
| 1 | `purchasing-1-schema.sql` | `purchasing_actuals` fact table; `purchasing_sync_locks`; `purchasing_derive_runs` |
| 2 | `purchasing-2-work-location-attribution.sql` | `spend_work_location_site_map` + the `excluded` boolean; Corp / Remote maps to `excluded=TRUE`, `account_key=NULL` |
| 3 | `purchasing_actuals`.`excluded` + `reason` columns + auth_pair state |
| 4 | `purchasing-4-category-mapping-provenance.sql` | `spend_category_map` + gl_line_code lookup |
| 5 | `purchasing-5-billcom-vendors.sql` | `billcom_ref_vendors` net-new; INV-P10 finding that bill headers carry no real vendor name |
| 6 | `purchasing-6-report-ingest-source.sql` | `rippling_report_seen_txns` for the Ruling 4 seed |
| 7 | `purchasing-7-report-txns.sql` | `rippling_report_txns` + `rippling_report_txns_latest` view (newest-per-parent) with append-on-content-hash |
| 8 | `purchasing-8-report-precedence.sql` | `rippling_report_only_pending_v1` view |
| 9 | `purchasing-9-external-id-prefix-index.sql` | expression index on `substring(external_id, 1, 24)` (the parent-hex bridge, indexed) |
| 10 | `purchasing-10-report-only-view-rewrite.sql` | `NOT EXISTS` rewrite of the report-only view + `MATERIALIZED` CTE; the 12.5s -> ~1.8s fix |
| 11 | `purchasing-11-vendor-or-merchant-comment.sql` | `COMMENT ON COLUMN purchasing_actuals.vendor_or_merchant` pointing at `v_purchasing_actuals_billcom_named` |
| 12 | `purchasing-12-truncation-pair-rulings.sql` | `purchasing_truncation_pair_rulings` stored-decision table |
| sc-37 | `sc-37-drop-joe-readonly.sql` | drops the dormant `joe_readonly` role (SC + purchasing both; shared cleanup) |

**Migration discipline (do this on every one, no exceptions):**

- Apply one statement at a time in Studio. The Supabase UI does not roll back partial batches; a mid-batch failure leaves the schema in an unknown state.
- **Grant-and-verify.** Grants are their own statements; run them AFTER the DDL and verify with `SELECT has_table_privilege(...)`, not with existence checks. `has_table_privilege` is what the reader will hit at request time.
- **Post-load row-count check.** `billcom_ref_vendors` (migration 5) passed six structural verifies while holding zero rows because the load hadn't run yet. Structural existence is not evidence a table has data - always follow with a `SELECT COUNT(*)` or a probe that reads a row.
- Draft the PR. Wait for the migration-gate check to fire. Comment `applied in Studio: YES` from the owner account on the same SHA. Only then is the PR mergeable.

---

## 7. Performance

Measured, not remembered.

**`loadCoverage` at 1,200ms with zero consumers.** Deleted 2026-08-25. Every request paid for a query no client called.

**The `rippling_report_only_pending_v1` timeout.** Measured ~250ms across an eight-period read at merge time; measured 12,500ms on a single filtered account query in production and 500-ed the portfolio view. **Three-step fix, order matters:**
1. Expression index on `substring(external_id, 1, 24)` (migration `purchasing-9`). The join expression is exactly the parent-hex bridge; the index makes the equijoin planable.
2. Rewrite the view with `NOT EXISTS` instead of `LEFT JOIN ... IS NULL` (migration `purchasing-10`). Made the index work AND doubled the runtime standalone.
3. `MATERIALIZED` the CTE that scopes the report_txns subset (also `purchasing-10`). Planner was rebuilding the sub-plan on every reader; materialising cut per-query overhead.

**Current numbers (2026-08-28):**
- Per-site request: ~579ms
- `ALL` FYTD: ~1.8s
- Remaining poles: `paginateActuals` (12.7k rows on FYTD) and `vendor_rollup` (12k+ vendor-scan across `billcom_ref_vendors`).

**Every paginated walk needs a completeness check.** Three in `purchasing_billcom_sync.mjs` were fixed in #867; headroom today is 80%, 93%, 95%. `purchasing_report_load.mjs` is a CSV parser, not a walk - no pagination surface.

---

## 8. What you would tell yourself on day one

**Free-form. Read this first if you're inheriting the seat.**

**Every wall was an assumption about the data.** Six explanations for one problem this week, five wrong. The Rippling API is not 8 days behind - our walk was reading 16.5% of it. Rippling doesn't truncate at 20 chars - the 45 pairs cluster at 18, 21, 22. The report doesn't exclude terminated employees - I misread a date-format difference between two CSV exports. When something doesn't reconcile, **the first move is to measure what the two sides actually contain, not to explain the gap.**

**Stopping to re-measure is the expected behaviour, not a failure.** I retracted two findings this week and both retractions were more useful than the original claims:
- **The namespace-mismatch diagnosis.** I told Kevin `rippling_report_seen_txns` and `purchasing_actuals` were in disjoint ID spaces after comparing against `source_bill_id` (36-char UUID). The correct join key is the 24-char hex extracted from `external_id`. **The retraction was the finding.** Precedences 1 and 2 do fire; the real defect (Ruling 4's within-API-only scope) is a different shape entirely.
- **"All 43 unmatched share the sentinel category."** True but not distinguishing - 174 of 176 matched rows ALSO share the sentinel. The sentinel is the state of nearly every board-pending row, not what separates the 43. **Kevin caught it with one comparison probe.** The retraction opened the auth-vs-settled measurement that led to Ruling 6.

**When a probe passes on a zero-row table, you have not verified anything.** `billcom_ref_vendors` passed six structural verifies while holding zero rows. Always follow structural existence with a `SELECT COUNT(*)` or a probe that reads a real row. Same rule for a probe that scans one CSS file when the defect lives in another: the "the probe passed" is a lie about what was measured.

**Trust the CSS comments AND the CSS. If they disagree, nobody read them together.** `.kpi-p-proj` had a three-line docblock saying "uses the identity colour of the running bar" and a `border` declaration using `--n-500`. That gap sat there through R13's acceptance battery and only surfaced when Kevin looked at the screen at 1680.

**"We record what was spent. The P&L records what was decided."** Kevin's sentence and it explains most of the reconciliation variance. The pipeline captures card auths and invoice bills as they arrive; Sebastian's P&L is those same charges re-attributed after close. Two accounting bases, both correct, measuring different things - that's the labor-salary caveat applied to the purchasing side. The `accrual_equipment_commitment` bucket in the reconciliation probe is where that lives on the code side; a future run will find that constant and know the answer.

**Never guess at which records are the same charge.** The truncation-pair rulings are stored decisions because Kevin read all 45 pairs. The 132 unbridged rows stay pending because a fuzzy rule (site + amount + date) would exclude real money. Both are the same ruling in different clothes. **If a rule tempts you to fold in a "within 3 days at same site" heuristic, that's the rule that excludes real money at a customer.**

**Kevin catches things by looking.** He noticed the freshness pill had no detail popover, the lower board was "a cluster," the running bar was three colours. Every one was real. If he says something looks wrong, it looks wrong - the "measure first" discipline says measure it, not argue.

**And I was wrong loudly.** I asserted card spend was 16x higher than the board showed and had him ready to warn his RDOs before CC's measurement killed it. I misread a date format and sent him to re-run a report for nothing. **Quote figures from reports verbatim or not at all.**

---

## 9. What I could not verify, and what I think is wrong in the architecture handoff

**Could not verify:**
- **Mobile at 375px.** Never tested purchasing. Kevin's rule says every UI change works at 375px "with wet hands" and I did not check.
- **Print / PDF.** Not tested for purchasing.
- **Keyboard navigation and focus order.** Not tested.
- **The compliance card in production.** It merged (#884) but no operator has opened it. Every defect this week was found by Kevin or by CC.
- **Contract-term math on the equipment accruals.** Joe named them as accruals; I confirmed via SQL that the amounts have zero raw-data matches. I did not verify the contract terms match the accrual pattern month over month - a re-run against a P9 export will be evidence one way or the other.

**Corrections to the architecture handoff:**
- **Portfolio ex-accrual is 1.591%, not 1.087%.** I quoted 1.087% at Kevin during the P22 arc; that was the pre-sign-fix number. The per-account rollup was always correct; the portfolio line had a sign bug in the ex-accrual denominator. Corrected 2026-08-28, in the workbook now, and the `_probe_p22_reconcile.mjs` output shows both raw (0.234% diagnostic) and ex-accrual (1.591% verdict) with the sign-corrected math.
- **The freshness pill splits three sources, not two.** Chat-Claude's handoff §3 names "bill.com sync" and "rippling sync"; the actual splits are `last_billcom_sync`, `cards_through` (max txn_date on rippling_spend, not sync completion), `report_ingest_at` (the report lane), and `last_derive_at`. Freshness pill's amber-behind marker fires on the trailing one.
- **The 45 truncation-pair total is $35,626.81, not "roughly $36k."** Kevin's number is exact; when he says a figure, it's from the workbook, not a round.
- **`rippling_report_txns_latest` is a VIEW, not a table.** `rippling_report_txns` is the base append-on-content-hash table. Every reader hits the view; the base table is only for the loader.

---

## 10. Open items

**On the board**
- The ex-accrual **1.591% portfolio tilt** at four accounts (TBR - FL, TBJ - FL, TXR - TX - H, TXR - TX - V) plus the residual on TXR - AZ Food. **Highest-value open question.** My working hypothesis: we record the authorisation amount and the P&L records the settled amount, and settled is usually lower. Not tested.
- **TXR - AZ's remaining $15,780** after the 5002.5 accrual is removed, dominated by `3200.1` Food. Unexplained by any named cause today.
- **132 unbridged pending rows.** Standing figure now logged per derive via `[ruling-6] cross-source parity: ... not_in_report=<N>`. Drift is observable.
- **`ALL` FYTD still ~1.8s.** Per-site is 579ms. `paginateActuals` and `vendor_rollup` are the poles.
- **Two labor selectors below graphical contrast** - `.kpi-sig-covers` (var(--n-300), 1.22:1) and `.kpi-hs-rail-bar-future` (var(--n-400), 1.42:1). Purchasing was blocked from touching labor per CLAUDE.md; both waived in `_probe_kpi_contrast.mjs` with the labor-follow-up note.

**Business questions**
- **Missouri sales tax rate.** STL - MO's annual goal is `$281,345.95 + $50,000` before MO sales tax. The 122% figure is provisional until Sebastian supplies the rate.
- **Three category rows attributed to the wrong site** - `1374.3` on STL - MO, `1385.1` on STL - FL, `1374` on CIN - OH. Small money; one per account suggests a pattern worth naming.
- **Rippling's `purchase_location` bug** on `spend_transaction_zo`. Nine request shapes, one error. Josh has the evidence.

**Deferred**
- **Rippling data audit** - a written model of how a charge is represented across both sources. Six explanations, five wrong; that document prevents the seventh.
- **Full INV-P21 matrix** - 70 combinations measured against a ~7,500-cell space; only the 10 named surfaces are gated today.
- **Scripts cleanup pass** - 77 untracked ad-hoc `scripts/*.mjs` from prior sessions live in Kevin's working tree. Triage into `scripts/probes/` or delete in a dedicated PR; do NOT bundle into a feature PR (owner rule).
- **Pagination sweep** - Supabase `.select()` silently caps at 1000. `paginateActuals` + the fixed billcom walks are the ones that were audited. Any unpaginated query against a > 1000-row table is truncating; the sweep after the rippling-sync timeout is owed (from feedback memory).

---

## 11. How to work with Kevin

Everything in labor's §11 holds. Shorthand, lead with the answer, layman's summary first, standing status report, he merges. Two things I would add from this side:

**He is right when he pushes on architecture.** He asked "why not just build option C" when I proposed the staged version, and made me argue it properly. **The staged answer was still right, but for a better reason than I originally gave.**

**Report before build.** When Kevin asks for a finding, rationale, or read before a build, the report IS the deliverable. Stop after the report; wait for his reply. I have been reminded of this twice.

---

## 12. The single most useful thing you can do first

**Not the Overview. Not architecture.**

**Get a chef onto one of these boards.**

Labor's handoff says the same thing and it is more true here. Two boards are complete, reconciled, and have been opened by exactly one person. Arizona training is two weeks out.

**Ninety seconds of a real operator using this will generate a better backlog than another week of auditing.** Everything either of us found, we found by looking hard at something we already understood. A chef will not do that. **They will do something neither of us thought of, and it will break.** That is the class of defect neither the CI nor the probes nor the assertions catch - the one where the user does something the code did not anticipate, and the response is `undefined` rendered as a currency.
