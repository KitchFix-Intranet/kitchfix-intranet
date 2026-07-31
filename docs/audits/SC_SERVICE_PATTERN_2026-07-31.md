# SC service-pattern audit - day-of-week vs phase (read-only)

**Date:** 2026-07-31
**Source SHA:** `f619d5e` (main HEAD; worktree `docs/service-pattern-audit`)
**Method:** `scripts/_audit-service-pattern.mjs` + `scripts/_audit-actuals-contamination.mjs`. Reads sc_daily_projections, sc_phase_calendar, sc_daily_actuals, sc_daily_actuals_history via service-role client. **No writes.** Every number below carries the query that produced it.
**Scope:** Read-only. **No fix proposed. No schema change proposed.** Kevin rules.

---

## Task 1 - four answers, decisive datum first

### Q2 - CIN-AZ served Sundays cluster in ST / MLB ST (hypothesis holds)

**Query:** `sc_daily_projections` filtered to `account_key = 'CIN - AZ'` and `EXTRACT(dow FROM service_date) = 0` (Sunday), joined to `sc_phase_calendar` on the phase containing `service_date`. Served = any row with `projected_count > 0` on the date.

| Phase | Served Sundays | Total Sundays in phase |
|---|---:|---:|
| **MLB ST** | **6** | 6 |
| **ST** | **1** | 1 |
| ACL | 0 | 10 |
| ACL/Draft | 0 | 1 |
| Battery Camp | 0 | 2 |
| Bridge | 0 | 4 |
| Early Camp | 0 | 3 |
| Extended | 0 | 7 |
| Fantasy Camp | 0 | 1 |
| Instructs/Camps | 0 | 12 |
| OFF | 0 | 5 |
| **Total** | **7** | **51** |

**7 of 7 CIN-AZ served Sundays land in ST / MLB ST phases.** All 7 dates fall Feb 15 - Mar 29 2026 - the spring-training window. Every other Sunday across every other phase is dark.

**Verdict: closures on CIN-AZ Sundays are phase-shaped.** A day-of-week rule would have been silently wrong every spring.

### Q1 - phase-shaped for PDC, day-shaped (Mondays) for AAA

**Query:** for each account, cross-tab of DOW (Sun-Sat) x phase (where applicable) x served/not, over `sc_daily_projections`.

**PDC accounts (all five follow the same shape):**
- Sundays dark outside spring-training phases (ST / MLB ST / ST Workouts)
- Mon-Fri served across nearly every phase (OFF excepted, all-dark by design)
- Saturday sometimes dark in Camps/Instructs (mixed)
- OFF phase: everything dark (correct)

Per-account phase details in the run log at `/tmp/service_pattern_audit.log`; the shape summarizes to "one week of MLB ST plus early ST is when Sundays get served; every non-baseball phase closes Sundays."

**MLB fee accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V):**
- No phase table exists for these accounts
- Sunday served roughly as often as any other day (9/8 past-served/not on CIN-OH, similar across TXR-TX)
- **No day-of-week pattern in evidence.** Data distributes fairly evenly.

**AAA accounts (CIN-KY, TBJ-NY):**
- No phase table exists for these accounts
- **Mondays: 0 served out of 27 dates** on CIN-KY; **0 out of 27** on TBJ-NY
- Sundays and Tue-Sat show mixed served/not patterns typical of any AAA schedule
- **Day-of-week pattern: Mondays dark, uniformly.** Not exposed by any phase table.

### Q3 - yes, non-Sunday day dark within a specific phase

**Query:** DOW x phase cross-tab per account, looking for non-Sunday cells with served=0.

Non-Sunday dark cells observed within specific phases:
- **STL-FL, TBJ-FL, TBR-FL Saturdays in Camps** - dark almost universally (0/13, 0/13, 0/11 respectively). Mon-Fri in Camps are served; Saturday is dark. That is a Camps-phase Saturday rule.
- **CIN-AZ Saturday in Instructs/Camps** - 6/6 split, not uniformly dark, but distinct from the Mon-Fri all-served pattern.
- **TXR-AZ Saturday in Instructs** - 0/7 dark.
- **All accounts Saturday in OFF** - 0/x dark (consistent with OFF closing everything).

**Not just Sundays. Saturdays in Camps / Instructs are dark for several PDC accounts.** A day-of-week rule that special-cased Sunday would still miss this.

### Q4 - non-PDC day-of-week patterns

**Yes for AAA, no for MLB.** See Q1 above.

- **AAA Mondays dark** is a clear day-of-week signal not attached to any phase (the AAA accounts have no `sc_phase_calendar` rows at all).
- MLB fee accounts show no day-of-week pattern - days distribute evenly.

**If a rule is going to be derived from this data, the shape is:** phase-shaped for the five PDC accounts; day-shaped (Mondays) for the two AAA accounts; no clear pattern for the four MLB fee accounts.

---

## Task 2 - actuals contamination measurement

### Criterion stated

**Test signature:** `changed_by` (in `sc_daily_actuals_history`) OR `created_by` / `updated_by` (in `sc_daily_actuals`) matches the regex `/test|smoke|dev|localhost|@example\.|@test\.|kf-test/i`.

**Implausibility signature:** `new_count > 999` (per-service meal count above 1000).

Both are conservative - they catch obvious patterns and no more. State-below-the-catch cases are noted rather than assumed.

### What the criterion catches

**`sc_daily_actuals_history`** (48 total rows):
- **All 48 rows** were written by `k.fietek@kitchfix.com`.
- **0 rows** match the test-signature regex.
- **0 rows** have `new_count > 999`.

**`sc_daily_actuals`** (7,728 total rows) - the primary table (history captures only VALUE CHANGES, not INSERTS):
- **6,839 rows** were created by `import-script`.
- **889 rows** were created by `k.fietek@kitchfix.com`.
- **0 rows** match the test-signature regex on `created_by` or `updated_by`.

### The 208 figure - honest answer

The 2026-07-31 grant/no-service audit reported **208 post-mark cancellations** derived from `hasAct && !anyNonZeroAct` on `sc_daily_actuals`. Today's count (probed 2026-07-31 evening): **214 post-mark cancellation days** across the portfolio (+6 in a day, consistent with accounts still active).

Of those 214 days:

| Creator (unique creators on each all-zero day) | Count |
|---|---:|
| `import-script` | **204** |
| `k.fietek@kitchfix.com` | 10 |

**204 of 214 post-mark cancellation days involve rows created by `import-script`.** The `import-script` identity is not a test signature - it is the bulk-load path that seeded `sc_daily_actuals` at initial ingest. Whether an import-script-created zero represents a real cancellation (imported from an operator's spreadsheet mark-no-service) or a bulk-populate-with-zeros artifact **cannot be distinguished from this table alone.**

**The specific "test inputs" Kevin cited are not visible in creator/updater identity.** The test-signature regex catches zero rows. Either (a) tests never wrote to production `sc_daily_actuals` under those identities, or (b) they wrote under one of the legitimate identities (`k.fietek@kitchfix.com` or `import-script`) and are indistinguishable.

**Effect on the 208 figure:** the number itself is measured correctly per the classifier. Its INTERPRETATION as "operator marked-no-service" is off - **95% of it (204/214) is import-script writes, not UI marks.** If the argument for a `no_service` schema column depends on "31% of days are being cancelled by operators via the mark-no-service UI," that argument is weaker than recorded. If the argument is "31% of days end up all-zero from any source and the classifier treats them uniformly," the number holds.

**"I cannot cleanly distinguish test-inserted from real from this table" is the honest answer.** The import-script vs UI split above is what can be measured; the test-vs-real split within import-script cannot.

---

## Task 3 - zero-projection dates per account (fragility, quantified)

**Query:** for each account, active window = `min(service_date) .. max(service_date)` in `sc_daily_projections`. Count dates within [min, max] that carry zero projection rows.

| account | window | with_proj | **zero-proj** | share |
|---|---|---:|---:|---:|
| CIN - AZ | 2025-12-29..2026-12-20 (357d) | 357 | **0** | 0.0% |
| CIN - KY | 2026-03-23..2026-09-27 (189d) | 189 | **0** | 0.0% |
| **CIN - OH** | 2026-03-26..2026-09-27 (186d) | 153 | **33** | **17.7%** |
| CORP | (no projection rows) | - | - | - |
| STL - FL | 2025-12-29..2026-12-20 (357d) | 357 | **0** | 0.0% |
| **STL - MO** | 2026-03-26..2026-09-27 (186d) | 156 | **30** | **16.1%** |
| TBJ - FL | 2025-12-29..2026-12-20 (357d) | 357 | **0** | 0.0% |
| TBJ - NY | 2026-03-23..2026-09-27 (189d) | 189 | **0** | 0.0% |
| TBR - FL | 2025-12-29..2026-12-29 (366d) | 366 | **0** | 0.0% |
| TXR - AZ | 2026-01-05..2026-11-22 (322d) | 322 | **10** | 3.1% |
| **TXR - TX - H** | 2026-03-30..2026-09-25 (180d) | 149 | **31** | **17.2%** |
| **TXR - TX - V** | 2026-03-30..2026-09-25 (180d) | 149 | **31** | **17.2%** |

**The four MLB fee-branch accounts each carry 30-33 dates with zero projection rows in-window - roughly 17% of the season.** These dates are already **invisible** to the `hasProj && !anyNonZeroProj` "planned no-service" signal: the signal requires at least one projection row to fire.

**TXR-AZ has 10 zero-projection dates (3.1%).** Every other account has zero gaps.

The MLB fee-branch accounts' pattern is: many days sit outside the sc_daily_projections coverage entirely. If an import pipeline change reduced or eliminated projection-row inserts elsewhere, more days would go dark to the signal in the same way.

---

## Method notes

- Scripts kept in-repo for re-run: `scripts/_audit-service-pattern.mjs`, `scripts/_audit-actuals-contamination.mjs`. Both read-only.
- **No .env* opened, no inline `-e` service-role scripts** - the sanctioned file-based `createClient` pattern with `--env-file=.env.local` on the runner.
- Every table read is against production PG via service_role.
- **No writes, no proposals, no fixes.** This measures; Kevin rules on what changes.

## What this audit did not answer

- Whether the AAA Monday-dark pattern is a business rule, an import artifact, or accidental. **The pattern exists** - the source of the pattern is a next question.
- Whether the MLB fee accounts' 17% zero-projection dates are (a) intentional gaps (game days imported later, off-days simply not inserted), (b) an import failure, or (c) something else. **The gaps exist and are invisible** - the source is a next question.
- Whether `import-script` is a single unified path or multiple import runs stamped with the same identity. `sc_daily_actuals.created_at` clustering could answer this; not probed here to keep the audit focused on the three tasks.
