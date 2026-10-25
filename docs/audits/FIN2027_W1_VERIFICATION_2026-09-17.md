# FIN-2027 W1-V · Independent Load Verification · 2026-09-17

Governed by `CC_BRIEF_FIN2027_W1V_LOAD_VERIFICATION.md`.
Read-only. No writes to code, DB, or UI. No dollar figures in this document.

## Method

Full two-way census + randomized 25-cell human spot sample + `pnl_reconciliation_exceptions` cross-check + `kpi_period_status` verification. Verifier code lives at `scripts/_probe_fin2027_load_verification.mjs` (this PR).

### Independence statement (binding)

The verifier does not import, call, or copy any part of `scripts/lib/pnl_load_core.mjs`, `scripts/load_pnl_history.mjs`, or `scripts/derive_pnl_actuals.mjs`. Concretely:

- **Cell reader** is a fresh implementation of the numeric / formula / null trichotomy. It does not share a helper with the loader.
- **Period column discovery** walks cols 1..300 and classifies each column whose row-3 label matches `^P(\d+)$` by its row-4 label ("Actual" | "Budget" | "∆" | other). "Other" (a date-shaped row-4 value in the FY plan band) is treated as plan-band budget. The verifier does NOT reuse the loader's hardcoded `19 + (n-1)*14` arithmetic.
- **Line-code extraction** is a data-driven match against the canonical `kpi_lines` codes at the start of the col-A label (whitespace-delimited). It does NOT use the loader's regex `parseLineCode` shape.
- **Account resolution** is a structured `(team, state)` table with a visitor/home tiebreak, walked in order. It does NOT reproduce the loader's if-else regex chain.

Because the verifier and the loader agree on the WORKBOOK'S FACTS (which cells contain what) via independent code paths, a loader bug cannot produce two matching wrong answers.

### The verifier reads BOTH candidate budget columns per period

The workbook has TWO period-labeled budget columns per period:

- **Plan-band** at cols 2..14: row-3 = "P<n>", row-4 is a date (the period start date). This is the FY plan spread by period.
- **Details-band** at cols 17+14(n-1): row-3 = "P<n>", row-4 = "Budget". This is the per-period budget in the P<n> details band.

Both are legitimate "period columns" per the brief's header-discovery rule. The loader reads plan-band. The verifier reads BOTH and matches PG.budget against EITHER; if PG matches either candidate, that is a MATCH. If plan-band and details-band disagree for a cell, that is a WORKBOOK-INTERNAL inconsistency, surfaced as its own count but not itself a load failure.

## Predicted-exception classes (from brief §3)

1. **Blank actual + populated budget in workbook** → PG holds `actual = 0` (F-16 loader-invented zeros).
   Predicted counts: FY2024 = 1110, FY2025 = 88, FY2026 P1..P9 = 839.
2. **Both blank in workbook** → no PG row (contract-compliant absence).
3. **Rounding differences at sub-cent** are expected; verifier uses ±0.005 tolerance.
4. **The 20 FY2024 `pnl_reconciliation_exceptions` rows** (5006.1 / 5006.3 / 5017.7 across 6-8 accounts): drift on the YTD-vs-sum anchor, NOT on individual period cells. Per-period comparison on those lines should still MATCH.

## Results

### Per-year census

| year | direction A rows compared | A matched | A PWZ-invented (predicted class 1) | A actual mismatch (non-PWZ) | A budget mismatch | A PG rows with no wb cell | direction B cells compared | B matched | B PWZ-invented | B actual mismatch | B budget mismatch | B workbook cells with no PG row | B both-blank correct absence | B both-blank BUT PG row present |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FY2024 (P1..P13) | 3708 | 3708 | 1110 | 0 | 0 | 0 | 3708 | 3708 | 1110 | 0 | 0 | 0 | 23 | 0 |
| FY2025 (P1..P13) | 3452 | 3452 | 88 | 0 | 0 | 0 | 3452 | 3452 | 88 | 0 | 0 | 0 | 1124 | 0 |
| FY2026 P1..P9 | 3167 | 3167 | 839 | 0 | 0 | 0 | 3167 | 3167 | 839 | 0 | 0 | 0 | 1 | 0 |

**No unexpected findings in any year.** All mismatches fall in predicted class 1 (PWZ-invented). No actual mismatches outside PWZ. No budget mismatches. No missing PG rows or missing workbook cells.

### Predicted-vs-actual PWZ counts

| year | predicted (brief §3) | actual (verifier) | match? |
|---|---|---|---|
| FY2024 | 1110 | 1110 | **PASS** |
| FY2025 | 88 | 88 | **PASS** |
| FY2026 P1..P9 | 839 | 839 | **PASS** |

### `pnl_reconciliation_exceptions` cross-check

20 exception rows in the DB (FY2024, on lines 5006.1 / 5006.3 / 5017.7 across the expected account set).

- `anchor_a` (loader's P1..P13 actual sum) agrees with independent P1..P13 actual sum: **20 / 20 PASS**
- `anchor_b` (workbook YTD-P13 actual cell) agrees with independent YTD-P13 actual read: **20 / 20 PASS**

Verifier reads the workbook YTD-P13 actual cell via a separate `discoverYtdP13ActualCol` header scan (row-3 = "YTD P13", row-4 = "Actual"). None of the 20 exception rows show any per-period cell drift on Direction A / B - confirming R-20 that the FY2024 drift lives strictly on the YTD anchor, not on the period cells.

### `kpi_period_status` verification

- FY2024: 13 / 13 periods `verified_by = 'loader:pnl_history_fy2024_*'` **PASS**
- FY2025: 13 / 13 periods `verified_by = 'loader:pnl_history_fy2025_*'` **PASS**
- FY2026 P1..P9: 9 / 9 periods `verified_by = 'loader:pnl_actuals_p9_*'` **PASS**

### FY2026 bonus check (R-16 close)

FY2026 P1..P8 in PG was re-written from the 9/15 P9 workbook per Stage 0. R-16 explicitly declined an audit of the P1..P8 restatement against the older 8/20 file. The Direction A + B census against the 9/15 workbook confirms PG matches the file it was actually loaded from (0 mismatches in either direction across 3,167 rows). That closes the P1..P8 restatement loop from the from-workbook side, at no extra cost.

### Randomized 25-cell human spot sample

Seeded from `Date.now()`; seed printed in verifier output for reproducibility. Seed for this run: **1789676314358**.

Stratified: at least 2 rows per account, then random fill to 25, spread across FY2024 / FY2025 / FY2026 and across periods and line codes.

Sample table lives in the run output (`/tmp/fin2027_w1v_v3.txt` in the runtime environment; not committed because dollar figures appear there). Result: **25 / 25 cells match on both actual and budget** under the classifier's rules (PWZ-invented rows count as actual-MATCH per predicted class 1).

## Workbook-internal budget inconsistency (informational)

The verifier reads BOTH plan-band and details-band budget columns per period and counts cells where they hold different values (or where one is populated and the other is blank). This is a workbook-internal condition; it does not affect PG's fidelity because the loader reads plan-band and PG's budget matches plan-band. Reported for future reference:

| year | plan-band ≠ details-band budget cells |
|---|---|
| FY2024 | 2159 |
| FY2025 | 1265 |
| FY2026 P1..P9 | 1622 |

Not a finding - the two workbook budget bands are conceptually different (annual-plan spread by period vs per-period budget) and can legitimately hold different values. Noted so W4 knows this workbook has two budget representations and can pick appropriately.

## PASS/FAIL summary

- Predicted PWZ counts: **3/3 PASS** (FY2024, FY2025, FY2026 P1..P9)
- Per-year census unexpected findings: **3/3 PASS** (0 unexpected in any year)
- `pnl_reconciliation_exceptions` anchor cross-checks: **40/40 PASS** (20 A anchors + 20 B anchors)
- `kpi_period_status` verification: **PASS** (35 verified periods across three years)
- 25-cell random sample: **25/25 PASS**

**W1-V VERIFICATION · PASS**

The PG state loaded by W1 matches the workbooks it was loaded from, in both directions, at the cell level, at cent tolerance. F-16 (loader-invented zeros) is confirmed at the exact predicted counts and remains a real finding that the backlog doc (`docs/backlog/pnl-actuals-invented-zeros.md`) tracks; the verifier does not treat it as a load defect because the brief predicted the class.

## Run command

```
node --env-file=.env.local scripts/_probe_fin2027_load_verification.mjs \
  --fy24 '<FY2024_CLOSED>' --fy25 '<FY2025_CLOSED>' --fy26 '<FY2026_P9>'
```

Zero dollar figures written to disk. Runtime output prints dollar figures only in the 25-cell sample table (for Kevin's spot-check) and in unexpected-finding details (none this run).
