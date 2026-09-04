# Null-GL vendor credit standing probe · nightly gate

**Filed:** 2026-09-04, from R-71 Stage 2 followup.
**Status:** Deferred. Not scheduled.
**Trigger to unpark:** any operator report of a missing vendor credit;
or the next quarterly finance recon that surfaces credit dollars we
hold but do not display; or as soon as the R-71 arc calms.

---

## What is missing

`scripts/probes/audit_null_gl_credits.mjs` (landed on R-71 PR #1016)
counts vendor credits with `gl_line_code IS NULL` per account. It is a
one-shot script - run it on demand, read the output, move on. That
shape does not solve the problem R-71 uncovered.

The R-71 finding: a credit we hold but cannot place is worse than one
we never pulled, because nothing signals it exists. Today the exposure
on non-billed-back accounts is $-116 (TBJ - FL $-45, TXR - AZ $-71).
The day it is $-9,000, no one will be looking - unless the surface
looks by itself, on a schedule, and shouts.

## What to build

Add a nightly guard alongside `scripts/purchasing_billcom_credits_sync.mjs`
that runs immediately after the sync completes. It should:

1. Sum `abs(amount)` of `purchasing_actuals` rows where
   `source = 'billcom_credit'` and `gl_line_code IS NULL`, joined
   against `accounts` to filter OUT billed_back accounts (STL - FL,
   CIN - OH, STL - MO today - or whatever the current billed_back set
   is; do not hardcode).
2. If the non-billed-back total is `> $0`, emit a loud signal:
   - Slack post to the intranet ops channel with the per-account
     rollup and the top offenders.
   - Non-zero exit code from the sync job so any cron dashboard notices.
3. If the total is `$0`, log a one-line "null-gl guard: clean" and
   exit 0. Presence of the log line is the "the guard ran" health
   signal - a missing line means the guard itself failed to run.

Reference the invariant in the same log line: today's baseline is
`$0` on non-billed-back accounts. Any positive number is a defect.

## Why this specific shape

Two prior gotchas the shape guards against:

- **"Health signals survive the pipeline"** (feedback memory,
  2026-09-01). A signal that only updates when the pipeline runs
  cannot report on the pipeline stopping. Running the guard AS PART OF
  the sync inherits the same freshness weakness - if the sync stops,
  the guard stops. Mitigation: log a heartbeat on every run so cron
  monitoring can detect absence.
- **"Swallow-into-empty is error hiding"** (feedback memory). A guard
  that returns cleanly when a table is empty (e.g., because the derive
  step failed) would report `$0` when the real state is unknown. The
  guard MUST distinguish "no rows because clean" from "no rows because
  the query returned an error"; throw on any DB error rather than
  swallow.

## Cost estimate

Small. One SELECT + a threshold check + a Slack post. Probably 40
lines of code including the Slack payload and a smoke test. Half a day
if the account/billed_back mapping is easy to look up (should be, from
`accounts` table + existing `is_pass_through` predicate); more if the
Slack posting path needs a new webhook.

## Related

- `scripts/probes/audit_null_gl_credits.mjs` - the one-shot probe this
  replaces (keep the probe as an on-demand deep-dive tool).
- R-71 Stage 2 PR #1016 - the arc that surfaced this.
- FY26 exposure snapshot 2026-09-04: 113 lines, $-22,545 total,
  $-22,429 on billed_back accounts (masked), $-116 on non-billed-back
  (visible to this future guard as `> 0`).
