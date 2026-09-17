# R-115 · TXR - AZ 3100.2 salary · residual per-period wobble

Opened 2026-09-17 during the R-114 independent audit. Original ruling landed 2026-09-17 in three PRs:
- Anna Hughes hourly-week gate (#1174)
- Raise restatement (raw comps + effective-date pick) (#1176)
- R-115 seed (this) - `worker_dept_history.annual_comp` + Ryan Moore's pre-2026-05-04 TXR - AZ spell

## What R-115 closed

Before the fixes, the board's TXR - AZ CY 3100.2 read $102,306.71 against finance's $119,829.69 — an ~$17,500 gap. The break appeared at P5 (2026-04-20) and grew across the summer. Three separate defects contributed:

1. **Anna Hughes double-count** — 7 weeks of salary landing on TXR - AZ while she was still on hourly. `+$6,731`.
2. **Raise restatement** — e.randall + a.lacy pre-2026-09-07 weeks were being restated at their current post-raise rates ($85k / $72.5k) instead of the pre-raise $66,680 each. On `--window=fytd` this manifested as `+$13,463` on CY.
3. **Ryan Moore's missing history** — Rippling shows only his post-2026-05-04 CORP OPS state; the pre-move Exec Chef at TXR - AZ role and rate are not in our raw comp snapshots. `−$32,026` (missing) on CY across 18 weeks.

## Residual (what R-115 did NOT close)

After the three fixes and Ryan's spell seed at `$92,520/year`, the board's TXR - AZ CY 3100.2 lands at $124,352 against finance's $119,830 — **+$4,522 residual**.

Kevin's ruling (2026-09-17): the residual is real but not a data defect on our side. Ryan's implied per-period rate wobbles across P1-P4:

| period | finance $ | e.randall + a.lacy pre-raise | Ryan implied $ | Ryan implied annual (weekly × 52) |
|---|---:|---:|---:|---:|
| P1 | $16,856 | $10,258.48 | $6,598 | ~$85,774 |
| P2 | $16,606 | $10,258.48 | $6,348 | ~$82,524 |
| P3 | $16,679 | $10,258.48 | $6,421 | ~$83,473 |
| P4 | $16,752 | $10,258.48 | $6,494 | ~$84,422 |

The ~$3,900 wobble in Ryan's implied annualised rate across P1-P4 says **finance is charging a share, not a flat salary**. Our loader can't model a share allocation without knowing the allocation rule. That's a Sebastian question, not a tuning knob.

## Status

Open · question for Sebastian.

- LP P9 lands on finance to the cent ($10,258.48 = $10,258.48) — Ryan is fully CORP OPS by P9, and the two remaining TXR - AZ salaried workers (e.randall, a.lacy) at their post-raise rates match finance exactly.
- CY carries a $4,522 residual. Waiting on Sebastian to confirm the share-allocation basis for pre-P5 Ryan.

## What sits behind the residual

The seed row for Ryan uses a single flat rate ($92,520) applied to 18 weeks. That matches Ryan's actual pay stub but overshoots finance's book by ~$188/week for weeks P1-P4 (which is what a "share" allocation would do — finance carries less than a full FTE for his TXR - AZ time). Once Sebastian confirms the basis, we can either:
- Split Ryan's spell into multiple `worker_dept_history` rows with per-period annual_comp values, or
- Accept the residual as a share-allocation pattern and document it as "by design" alongside the pass-through R898-8 pattern.

Both are cheap to build; neither should be built until we know which one matches finance's real accounting.
