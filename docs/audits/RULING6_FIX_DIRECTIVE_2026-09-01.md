# RULING - Ruling 6. Do not revert. Add the condition it shipped without.

Your measurement is right and the timeline correction is right - my capture at 19:33 UTC on
08-28 predates the first application at 07:41 UTC on 08-29, and the code was merged but had not
yet run against the corpus. Good catch on your own prior error, both counts.

**Your recommended fix is wrong, and it follows from a wrong reading of what Ruling 6 was for.**

## Ruling 6 was never about duplication

You wrote that it "was addressing a conceptual duplication (same charge in two feeds) that never
became an actual duplication." It was not. It was about **stale pending**.

The purchasing seat that made the ruling has given us its evidence. It measured the board-pending
set - `source='rippling_spend' AND gl_line_code IS NULL AND excluded IS NOT TRUE`, 249 rows - and
split it three ways:

```
parent hex in report, twin uncoded  - both agree pending      58
parent hex in report, twin coded    - board stale             56   <- Ruling 6's entire scope
parent hex not in report at all                              132   <- explicitly rejected
```

**The whole population was uncoded rows.** A coded API row was never in scope, never measured,
never ruled on. PR #885's own prediction was **56 rows / $17,863.01**. You measured **4,215 rows
/ $991,456.39** - 75x the rows, 55x the dollars.

The rule's own comment in the file says it plainly at `purchasing_rippling_sync.mjs:681-683`:
*"The API row sits on the board as pending even though the coder already dispositioned the
underlying charge on the report side."* Pending. Uncoded.

## The defect, confirmed in the shipped code

`reportCodedHit` at line 1039 is a bare set-membership test on the parent hex. It never examines
the API row's own coded state. And `glLine` is not computed until **line 1069** - after the
reason chain has already decided. The rule cannot see whether our row is coded, because at the
moment it fires, that has not been worked out yet.

So the ruling was correct and its implementation lost the scope that made it safe. Reverting
would throw away a correct ruling because of an implementation error.

## The fix

1. **Move the `glLine` computation above the reason chain**, so the exclusion decision can see it.
2. **Change the predicate to fire only on uncoded rows:** `reportCodedHit && !glLine`.
3. **Rewrite the comment to state the scope as a constraint**, not as intent - "excludes only rows
   uncoded on our side; a coded row is real spend and must never be excluded here" - so the next
   reader sees the boundary rather than the purpose.

Expected after the fix, from your own numbers: the intersection is 96.4% API-coded, so roughly
**190 rows should remain excluded**, not zero and not 4,215. Report the actual count. If it comes
back near zero, the condition is inverted; if it comes back in the thousands, it did not take.

Also confirm the pending figure moves as intended - those ~190 rows should leave "pending · card
not yet coded" on the board, which is the whole point of the ruling.

## The guard that would have caught this

Add to the derive's probe set, permanent, with a seeded failure:

> Every row excluded with `reason='report_coded'` must have `gl_line_code IS NULL`. If any coded
> row carries that reason, fail with the count and the dollar sum.

That single assertion turns this class of defect from invisible to loud. It is the same shape as
every other guard on this board and it is one query.

## Re-runs required in the same PR

- Purchasing reconciliation against the finance workbook - the 0.23% no longer describes the
  board and must be re-established.
- Food and packaging versus finance, per account, YTD-P8.
- Overview sentinels and parity - the Overview consumes these numbers.

## What remains after the fix, and what it is not

Packaging closes: portfolio -35.19% to +3.33%, every catastrophic delta in R898-2 resolved.
**R898-2 was a Ruling 6 artifact, not a mapping defect.** Close it as such in the ledger.

Food partially closes, and four accounts *overshoot* when the exclusion is dropped - CIN - AZ,
TBJ - FL, TXR - AZ, TXR - TX - V. Note carefully: that residual is **not** fixed by either the
revert or this fix, because those are coded rows in both cases. It is the P22 ex-accrual tilt,
and the purchasing seat has now characterised it: **it is bill.com, not cards** - they measured
card-sourced rows with no coded report twin at $1,393 against $35,099 of variance, 4% - and it
splits by regional distributor family, Sysco / Cheney / Ben E Keith positive, Shamrock /
Peddler's Son negative.

So the auth-versus-settled hypothesis is dead for the food tilt. Record that; it has been open
since the purchasing handoff. The residual is a bounded, characterised bill.com question, not a
mystery, and it is not part of this fix.

## One more thing worth knowing

`parent_txn_id` matches on only **47%** of API parents (5,318 of 11,215), because Rippling
assigns different hexes to auth and settlement on some charges - 132 of the original 249 had no
twin at any hex. The key is exact where it exists and absent where it does not. Do not build
anything else on it without that caveat in front of you.

## Then

Fix, re-run everything above, report with the excluded-row count and the reconciliation table.
Kevin merges. P2 items can continue in parallel.
