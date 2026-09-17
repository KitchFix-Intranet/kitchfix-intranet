# Backlog · INV6 · TBR - FL P10 3200 food · $115.27

Opened 2026-09-17. Logged in PR #1162 body, not diagnosed. Standing r109_guard3 probe fail.

## What

INV6 is one of six R-109 invariants asserted by `scripts/probes/_probe_r109_guard3_invariants.mjs`. It compares `purchasing.weekly[3200*] sum` for a running period against `Overview.statement_rows[3200].actual` for the same account × range. The two are supposed to be the same identity.

On TBR - FL Current Period (P10, 2026-09-07..2026-10-04) they diverge by exactly **$115.27** ($6,641.61 vs $6,526.34), on both the hourly and salary toggles. Two invariants (INV2 and INV6) surface the same defect from different angles - both fail with the same delta. Effectively one root cause producing four failure lines in the probe output.

TBJ - FL P10 3200 ties cleanly on both toggles. TBR - FL only.

## Discovered / logged

Surfaced in R-114 PR 1 (#1162) body during the coverage audit. Verified pre-existing on `origin/main` baseline before that PR - **not caused by any R-114 change**. Logged for the labor+purchasing walkthrough queue; no diagnosis attempted.

## Suspicions (not investigated)

- Excluded / non-excluded row edge case (billed-back?)
- Weekly aggregation gap that closes on non-CP ranges
- A single row landing on the wrong side of the Overview vs Purchasing predicate

None confirmed. The delta being _exactly_ $115.27 suggests a small number of rows or a single-row cause rather than percentage drift.

## Status

Open. Standing probe fail. TBR - FL only. Pick up during the labor+purchasing walkthrough queue - do not treat as blocking for other work.
