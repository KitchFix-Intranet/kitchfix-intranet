# Test suite has no CI runner

**Filed:** 2026-09-18, after two separate PRs broke the billing unit
suite silently and it stayed broken until Kevin ran `npm run test:unit`
against a clean main.
**Status:** Open. Priority elevated after the incident below.
**Owner:** Kevin. Wiring belongs in `.github/workflows/`.

---

## What went wrong

Between 2026-09-17 and 2026-09-18, two PRs each broke the billing
suite. Neither PR's author noticed:

- **#1161** (derive `salariedManagerEmails` from `people`): added
  a `.not("work_email", "is", null)` call the test mock never
  implemented. 11 of 12 `runFinalizeEffects.test.mjs` tests aborted
  at line 517 before reaching their own assertions.
- **#1159** (sc-45 `notify_operators`): added a `notifyOperators`
  key to the `resolverAccountMap` object; two `deepEqual`
  assertions were never updated. Silently masked by #1161's earlier
  break — 11/12 stayed 1/12 through #1159, so the second break
  looked like "no change."
- **#1164** (Joe + Josh dropped from N1): two other test files
  asserted Joe + Josh were on the N1 TO list. Neither uses
  `_supa-mock` so #1161 didn't hide these — the assertions just
  stayed red and nobody looked.

**Total**: 13 failures across 3 files. Undetected for ~24 hours.

---

## Why it went undetected

`npm run test:unit` is a documented script (see `package.json`) but
**no GitHub Actions workflow runs it on PR or on push**. Confirmed
by grepping `.github/workflows/*.yml` — the test runners present
are `e2e` (Playwright, hits the prod URL, doesn't cover unit
tests), migration-gate, and one-off derive workflows. Zero
workflow invokes `npm run test:unit` or the equivalent `node
--test` command.

**A test suite that runs on nobody's machine is documentation, not
verification.** The 191 tests currently in the tree are a costly
asset producing zero signal on incoming PRs.

---

## What to build

**A GitHub Actions workflow that runs `npm run test:unit` on every
`pull_request` and on push to `main`, blocking merge on failure.**

Shape (rough - the details matter and Kevin should walk them):

```yaml
name: unit-tests
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    name: Unit tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci
      - run: npm run test:unit
```

Add `Unit tests` to the `main protection` ruleset required-status
checks list. Same click Kevin used for `Migration gate` and
`Nav matrix (local build)`.

---

## Do NOT use `if: success()` on the test step

**When wired to CI, name a status function explicitly.**

The nine-day Rippling silence (2026-09-08 → 2026-09-17) was caused
by `.github/workflows/rippling-sync.yml`'s downstream steps
guarding on `if: success()` — when an upstream step failed, the
downstream steps skipped, the workflow reported "skipped" instead
of "failed," and the outer aggregate check on the PR looked
neutral instead of red.

For unit tests: use `if: always()` when a downstream step must run
regardless (e.g., "report the failure to Slack"), and explicitly
`if: ${{ needs.test.result == 'success' }}` when a job depends on
tests passing. Do not rely on the implicit `success()` default at
job boundaries.

Same shape the migration-gate workflow uses; the pattern is
already in-house.

---

## Cost estimate

- **Workflow file + main protection wire**: 1 hour. Copy-paste
  from `migration-gate.yml` with the two callouts above.
- **First-run breakage repair**: 0-2 hours. If any test is
  flaky on CI runners (network, timing, environment differences
  from local), triage.
- **Backfill**: none. Tests run against the current commit; no
  historical data.

---

## Paired doc-drift (P2, not this PR)

`CLAUDE.md:39` says:

> **Tests-first.** Phase 1's centerpiece is a Playwright test
> suite covering happy paths for every module. Until that suite is
> in place and CI is wired, every architectural change must be
> manually verified on a Vercel preview deploy before merging to
> main. No exceptions.

Two problems with that line as it stands today:

1. **"Until that suite is in place"** implies no test suite
   exists. There ARE 191 unit tests across 12 files under
   `src/lib/**/__tests__/`, `src/app/**/__tests__/`, and
   `scripts/content/__tests__/`. The Playwright suite is a
   different, still-unshipped thing.
2. **Anyone reading the line concludes there is nothing to run.**
   That is plausibly *why* nobody runs `npm run test:unit` before
   merging — the doc says there isn't a suite to run.

Update to something like:

> **Tests exist and must pass.** `npm run test:unit` runs 191
> node:test unit tests under `src/lib/**/__tests__/` and
> `scripts/content/__tests__/`. **The Playwright suite is
> separate and not yet built.** Every architectural change must
> pass the unit suite before merge, and (until Playwright ships)
> also be manually verified on a Vercel preview.

Small edit, big effect on the incentive.

---

## Ordering when this reopens

1. Add the workflow file + wire the main-protection required check.
2. Fix any CI-only flakes surfaced by the first-real-run.
3. Update `CLAUDE.md:39` with the corrected framing.
4. Add `unit-tests` to the standard PR test-plan checklist.

Not a training-week fix. But every PR that ships without CI running
these tests is a PR that could ship a silent regression the way
#1161 did. Priority scales with PR volume.
