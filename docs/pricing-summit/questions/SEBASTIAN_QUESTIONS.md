# QUESTIONS FOR SEBASTIAN — pricing summit (invoicing / QuickBooks)
**Running list · started 2026-07-14 · Sebastian (invoicing, QuickBooks). Invoice-mechanics + tax-practice items; distinct from Joe's billing-logic/contract-intent list.**

---

## 1. STL - FL service-fee tax itemization *(A-6)*
On the STL - FL service-fee invoices (e.g. the $350K quarterly installment), contract §2.d calls for tax itemization but the line shows **TAX 0.00**. Is the service fee legitimately non-taxable in Florida (0.00 satisfies itemization), or is a step being skipped?
- *Why it matters*: no SC impact (R9 — SC emits pre-tax, tax applied in QB). Pure invoicing-compliance confirmation. Low probability of error, but worth confirming.

## 2. Memo template says "2025" on 2026 invoices *(D-2)*
TBR - FL invoice memos read "2025" on 2026 invoices — cosmetic year-rollover template bug. Flag for fix so client-facing memos show the correct season.

## 3. Missing invoice samples (golden-test coverage)
We have 9 invoice samples; missing per-meal invoices for: **CIN - KY · CIN - OH · STL - MO · TXR - TX - H · TXR - TX - V · TBJ - NY.** The golden test (Layer C) needs at least the per-meal ones (CIN - KY, TBJ - NY) to verify the export against real invoices. Request one recent example each where they exist.

## 4. (overlaps Joe #2) P&L 2300 computed-vs-billed for SF% sites
If Joe routes it to invoicing: for CIN - AZ + TXR - AZ, does the actual invoice ever carry a separate service-fee line, or is the client only ever billed per-meal (with the SF a computed/recognition figure)? A real SF invoice (or its absence) answers it.
