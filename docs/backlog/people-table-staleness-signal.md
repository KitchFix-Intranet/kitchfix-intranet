# people-table staleness signal

**Filed:** 2026-09-17.
**Trigger:** two stale-directory incidents 15 days apart, both surfaced by human observation because nothing asserted freshness independent of "did the sync report success."

## The gap

Both incidents were the same class:

- **2026-08-22**: Postgres statement timeout on labor derive cascaded via GitHub Actions' default `success()` gate. `Derive people` skipped for six days. Directory went stale; Kevin noticed via a symptom (a specific person's row disagreeing with a Rippling change).
- **2026-09-08 through 2026-09-16**: `Daily grain probes` failed on a legitimate probe-modeling gap (one worker's GL sub-code). `Derive people` skipped every night for nine days via the same `success()` mechanism. Kevin noticed via a symptom (Desiree Colone wrongly ACTIVE while chase emails threatened to fire, a new AHM at TXR "missing", four leadership users he wanted to grant absent).

The pipeline reported failure both times - the `Post failure to Slack` step fires on any step failure with a run URL. **But no step said "the people table is old."** The failure step reported "Daily grain probes failed" - a technically true message that reads as an unrelated labor probe issue, not a directory freshness issue. Kevin filtered on symptom instead.

## Shape A - shipped 2026-09-17

**A step inside `rippling-sync.yml`, at the end of the job, with `if: always()`.**

```yaml
- name: People freshness
  id: probe_freshness
  if: always() && (inputs.dry_run || 'false') != 'true'
  run: |
    node scripts/probes/_probe_people_freshness.mjs --max-hours=48
```

The probe reads `MAX(people.last_synced_at)` and fails when the newest row is >48h behind `NOW()`. Fires regardless of anything else in the job. The `Post failure to Slack` cascade names it explicitly ("People freshness (staleness > 48h)") so the surface message is about directory staleness, not the labor step that happened to fail first.

**What Shape A covers**: any run where the pipeline itself executes but `Derive people` skipped or failed. The 2026-09-08 incident would have been caught on 2026-09-10 (48h after the last successful people derive). The Aug 22 incident would have been caught on Aug 24.

**What Shape A does not cover**: the pipeline itself not running. If the workflow gets disabled, the cron gets removed, GHA is down, or the whole rippling-sync.yml file is edited to break, no signal fires. Shape A rides on the pipeline; when the pipeline is absent, the alarm is absent too.

## Shape B - backlog

**An independent Vercel cron that runs the same freshness check, hourly.**

- Endpoint: `/api/cron/people-freshness-check`
- Schedule: `0 * * * *` (hourly)
- Query: same as `_probe_people_freshness.mjs` - `SELECT MAX(last_synced_at) FROM people`
- Threshold: same 48h default, configurable via env
- Failure surface: same Slack webhook the rippling-sync workflow uses

**Why Shape B is worth having on top of Shape A**: independent from GHA. Catches the "pipeline disabled/missing" case Shape A can't. Hourly cadence surfaces staleness within a day rather than waiting for the next nightly.

**Why Shape B is not urgent**: Shape A closes the observed failure modes. Both incidents were "the pipeline runs but derive_people skips." Neither was "the pipeline stopped running entirely." Shape B is for a future failure class that hasn't happened yet.

**Why Shape B is not free**: adds a cron surface (Vercel doesn't currently run any Rippling-scoped code, so this adds a new domain of ownership). The cron itself is simple; the ops load of "here's another cron whose failure needs its own signal" is not. This is why the existing `project_cron_liveness_gap.md` backlog matters here - Shape B lands cleaner as part of that arc, when the cron-liveness ledger exists to catch its own failures.

## Pattern generalisation worth capturing

**Every derive whose staleness could mislead a decision needs a freshness signal that fires independent of "did the derive report success."** The list of candidates (not exhaustive; report before extending):

- `people` - shipped as Shape A.
- `labor_actuals` (weekly) - has `derived_at` per row; a max-derived_at freshness check is the same shape.
- `labor_actuals_daily` - same shape.
- `labor_salary_actuals` - same shape.
- `rippling_current_presence` - same shape.
- `sc_daily_projections` and `sc_daily_actuals` - freshness ties to workbook seeds, not a nightly derive. Different mechanism; separate ruling.

The class is: **any table whose consumers assume it reflects "up-to-date"** needs a maximum-age assertion **independent of whether the writer reported success**. The rippling-sync workflow reported success from the sync step on every one of the nine failed nights; only the aggregate-job failure exposed the problem, and the aggregate-job failure named the wrong step.

## Cross-references

- `docs/GOTCHAS.md` "An operation that reports success regardless of outcome" - Shape A's rationale sits in the same class as N1's `[N1 fired]` on invalid_grant and the AP-reminder cron's dedupe-before-send.
- `docs/GOTCHAS.md` "A step's `if:` gets `success()` prepended unless it names a status function" - the mechanism that made both stale-directory incidents possible.
- `docs/backlog/SILENT_FAILURE_SWEEP.md` (if it exists) - this is another instance of that pattern.
- `project_cron_liveness_gap.md` (memory) - Shape B lands cleanly as part of that arc.

## The durable lesson: a swap-and-replace table has no memory of being wrong

Filed 2026-09-17 alongside the second incident.

`sc_export_ledger` is append-only. Every push attempt records a row - test, failed, superseded, invoiced - with `qbo_doc_number` populated only when the push succeeded. When Kevin asked "was any CIN-AZ / TXR-AZ P8 invoice ever sent to a client" the answer was in the table: zero non-null `qbo_doc_number` values across every row for those accounts. The append-only shape let the reseed proceed safely, because the history proved no client had ever received an invoice from the system.

`labor_actuals` is swap-and-replace. Every derive fully replaces the account's rows in one transaction via `swap_labor_actuals_for_account`. When Kevin asked "what did TXR April look like in May" the answer is unrecoverable. Not a lookup problem: the row that was in the table in May was overwritten in June, and again in July, and again on 2026-09-16 when Anna's promotion propagated retroactively. There is no artifact.

Same class of decision - "should this table retain prior states or overwrite them" - and opposite outcome:

- `sc_export_ledger` retained history because AR/AP evidence needs a paper trail. The correctness question the PR-A reseed answered ("was anyone billed") required that trail.
- `labor_actuals` swapped because the design assumed "current derive is always right and history is noise." That assumption survived until a re-derive changed a closed period's number and no one could point to the prior number to say what changed.

**When designing a table whose rows are written by a periodic derive, the choice of append vs swap-and-replace is a load-bearing correctness decision, not a schema convenience.** If the numbers this table produces will EVER be quoted in a report, an email, a paystub, a P&L review, or a decision-making conversation - the table needs to retain enough history to answer "what did the report see when it was sent." The swap shape says nothing was ever wrong, because nothing that was ever true is still there.

Concrete asks for the post-training arc:

1. Add `labor_actuals_history` (or `labor_actuals` gets `derived_at` in its PK and stops swap-replacing). Every derive writes a new version rather than overwriting.
2. Retention policy: keep at least one version per fiscal-period-close. Kevin should be able to ask "what did TXR P5 labor look like at the moment P5 closed" and get the answer.
3. `labor_actuals_daily` and `labor_salary_actuals` follow the same rule.
4. Anywhere else that swap-replaces (grep for `swap_.*_for_account` and equivalents in the schema) - review each: does its output ever get read at a decision moment? If yes, append-only.

The rule name for the GOTCHAS entry when this arc lands: **"A derive-target table has memory or it has none - decide before it gets quoted."**

## Sequencing

- **Shape A**: shipped 2026-09-17 in `fix/rippling-sync-slack-guard-and-staleness-probe`.
- **Shape B**: post-training. Do not build in isolation - land it as part of the cron-liveness arc so the new Vercel cron gets a heartbeat check at birth.
- **Pattern generalisation** (freshness signals for the other derives listed above): open one small PR per derive after Shape A has proven stable for a week. No rush.
