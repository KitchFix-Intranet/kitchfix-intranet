# Backlog · Guard 1 · TBR - FL Current Period $431

Opened 2026-09-14. Log-only. R-96 prevents the obvious fix.

## What

TBR - FL Current Period Guard 1 (labor closed-week revenue vs cost of goods envelope) reports a $431 gap. Kevin logged 2026-09-14 as a not-shipping-a-fix decision, not a symptom-of-something-broken decision.

## Root cause

Labor's post-#1049 accrual double-counts `2200` catering under R-96. R-96 governs that the service fee accrues to line `2300` **only** on running periods; `2200` catering comes from the Service Calendar as B&G Lunch and is already counted, and `2600` is similar. Never sum `2200 + 2300 + 2600` as revenue accrual - it double-counts on TBR-family accounts.

Labor's current formula pulls the pre-1049 accrual value, which is the double-counted sum. The obvious "fix" is Option A - swap Labor's post-1049 accrual for the same reference the Overview uses. **Do NOT ship Option A**: it re-lands the double-count elsewhere and the correction cascades into the closed-week Guard 0 assertion.

## The correct fix (when picked up)

Labor's closed-week revenue uses **fee/4**, not accrual/4. Same $ result on the healthy path, correct arithmetic on the divergent path. Requires touching `src/lib/labor/labor-batr.js` and re-anchoring the Guard 1 assertion.

## Not this PR

Ruling has been made (2026-09-14 · log-only). The queue position sits behind #489 (server-side spent) and the labor + purchasing walkthrough deferred defects (memory: `project_labor_purchasing_walkthrough.md`).

## Status

Open. Do not chase without re-reading R-96 first.
