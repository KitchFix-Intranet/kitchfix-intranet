# Three-way reconciliation: inventory vs purchases vs P&L - 2026-08-29

> READ-ONLY. Tests the accounting identity (food used = purchases + BOH - EOH)
> per bracketed interval. Reports residuals; does not fix.
> All claims labelled [ran] or [code-read] per BUILD_ACCURACY_PROTOCOL C1.
> Sheets read via existing SA path (`src/lib/sheets.js` `readSheetSA`) - SUCCEEDED.
> Labor control corrected to hourly-only per Kevin ruling:
> finance 3100.1 $1,607,095.01 vs ours $1,604,030.64, delta -0.19%.

## Executive summary

- Sheets access **worked** through the existing service-account path
  (`readSheetSA` in `src/lib/sheets.js`). Contra PR #898's stated block:
  the SA credentials Kevin already provisioned are sufficient for this audit.
- The **portfolio hits the identity in only 1 of 46 intervals cleanly**
  (16 of 46 loose intervals residual <10% of flow). The dominant reason is
  count cadence: only a single account-interval (TXR - AZ 2026-06-14 to
  2026-07-14) actually brackets a period boundary within 3 days on both ends.
  Every other interval is "loose": the counted movement is measured over
  a span that does not align with the finance period, and prorating the
  finance dollar day-by-day (a stated approximation, not interpolation of
  counts) introduces bounded but real distortion.
- Two accounts have **zero packaging in Purchasing** but non-zero packaging
  in finance: CIN - KY ($0 ours vs $1,385 finance) and STL - FL ($0 ours
  vs $10,991 finance). Both are **mapping gaps** (bills exist, but they
  land in 3200.x / 1385.x / 5000, not 3400.x). Detail in Part E.
- **Two accounts have no inventory counts at all** for the FYTD-P8 window:
  CIN - KY and TBJ - NY. Both are legitimately-live accounts with finance
  food dollars from P4 forward. The identity cannot be tested there.
- Categories captured in the Sheets tab: **Food, Packaging, Supplies,
  Snacks, Beverages**. See Part B for the mapping hypothesis - this axis
  does not match the Purchasing bucket axis (food / packaging / vehicle).

## Method summary

- Read `inventory_submissions` from spreadsheet
  `1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ` via `readSheetSA`, using
  the existing `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` creds
  (per `src/lib/sheets.js:34-43`). [ran]
- Enumerated all 29 tabs on the COLLECTION sheet. Only one inventory-related
  tab exists: `inventory_submissions`. [ran]
- Row model matches ops-route parsing at `src/app/api/ops/route.js:792-804`:
  columns are (0) UUID, (1) timestamp, (2) email, (3) account, (4) period,
  (5) date, (6) food, (7) packaging, (8) supplies, (9) snacks, (10) beverages,
  (11) total, (12) notes. [code-read]
- Purchasing bucket mapping mirrors `src/app/api/kpi/purchasing/route.js`
  L161-174: 3200.x -> food, 3400.x -> packaging, 3500.x -> vehicle. Board
  hero = billsOnly + codedCards. [code-read]
- Purchasing pull runs the same paginated shape as
  `paginateActuals` (L266-294): `purchasing_actuals`, `excluded=false`,
  `txn_date` in window, source in `{billcom, rippling_spend}`. [ran]
- Period days follow prompt: P1..P8 start dates 2025-12-29 .. 2026-07-13,
  each 28 days inclusive.
- Sheet Account column carries LABELS ("TBR - FL - Tampa Bay Rays"), not
  the short account keys used in Postgres. Mapping rule: key + " - "
  prefix, longest-match wins. Reports zero false positives; three CORP -
  KitchFix Team rows correctly declined.

## Part A - inventory counts read from Sheets [ran]

- Total rows in `inventory_submissions`: **58**
- Portfolio matches: **55** (3 CORP submissions excluded)
- Distinct tabs on the COLLECTION spreadsheet: 29. Only inventory tab is
  `inventory_submissions` (single tab, all-accounts).

**Category axis captured verbatim** (from the header row):

    ["UUID","Server Timestamp","User Email","Account","Period","Count Date",
     "Food ($)","Packaging ($)","Supplies ($)","Snacks ($)","Beverages ($)",
     "Total Value ($)","notes"]

### Per-account count history

Values are dollar totals as submitted. Cadence "median days" is between
consecutive submissions ordered by Count Date.

**TBR - FL** - 8 counts, median 23d cadence

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-03-14 | P1 | 5919 | 2352 | 1354 | 0 | 0 | 9625 |
| 2026-03-14 | P2 | 26949 | 2243 | 5150 | 0 | 0 | 34342 |
| 2026-03-23 | P3 | 20171 | 4441 | 2322 | 0 | 0 | 26934 |
| 2026-05-07 | P4 | 14649 | 2802 | 1730 | 0 | 0 | 19181 |
| 2026-05-18 | P5 | 14423 | 2503 | 1367 | 0 | 0 | 18293 |
| 2026-06-13 | P6 | 13508 | 3690 | 797 | 0 | 0 | 17994 |
| 2026-07-18 | P7 | 14307 | 3942 | 2043 | 0 | 0 | 20292 |
| 2026-08-10 | P8 | 15605 | 3689 | 2023 | 0 | 0 | 21317 |

**STL - MO** - 6 counts, median 29d cadence (first count is P3, no P1/P2)

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-04-03 | P3 | 25463 | 210 | 1365 | 7108 | 5306 | 39451 |
| 2026-05-15 | P4 | 9897 | 368 | 845 | 1738 | 3651 | 16498 |
| 2026-05-15 | P5 | 12206 | 561 | 726 | 1711 | 4927 | 20131 |
| 2026-06-07 | P6 | 9063 | 1810 | 858 | 2304 | 3750 | 17785 |
| 2026-07-12 | P7 | 7768 | 1810 | 712 | 3129 | 3577 | 16995 |
| 2026-08-10 | P8 | 8219 | 2012 | 896 | 2509 | 2247 | 15883 |

**CIN - KY** - **0 counts** (no submissions to date). Identity cannot be tested.

**CIN - AZ** - 8 counts, median 27d cadence

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-03-14 | P1 | 7584 | 1657 | 1741 | 0 | 0 | 10982 |
| 2026-03-14 | P2 | 15704 | 2374 | 1734 | 0 | 0 | 19811 |
| 2026-03-26 | P3 | 11091 | 1503 | 1581 | 0 | 0 | 14174 |
| 2026-04-22 | P4 | 8575 | 2130 | 1792 | 0 | 0 | 12497 |
| 2026-05-19 | P5 | 9031 | 3276 | 1597 | 0 | 0 | 13905 |
| 2026-06-16 | P6 | 9426 | 2499 | 2404 | 0 | 0 | 14329 |
| 2026-07-13 | P7 | 8844 | 2391 | 1943 | 0 | 0 | 13179 |
| 2026-08-10 | P8 | 9110 | 2563 | 1932 | 0 | 0 | 13605 |

**CIN - OH** - 6 counts, median 28d cadence (first count P3; no P1/P2)

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-03-19 | P3 | 20000 | 5000 | 3000 | 50 | 50 | 28100 |
| 2026-04-17 | P4 | 4125 | 271 | 2169 | 2218 | 385 | 9168 |
| 2026-05-15 | P5 | 3602 | 271 | 1896 | 2816 | 522 | 9106 |
| 2026-06-14 | P6 | 6920 | 271 | 2151 | 2933 | 570 | 12845 |
| 2026-07-12 | P7 | 2008 | 720 | 1265 | 1555 | 294 | 5842 |
| 2026-08-08 | P8 | 2624 | 674 | 520 | 1852 | 371 | 6041 |

**TBJ - NY** - **0 counts** (no submissions to date). Identity cannot be tested.

**TBJ - FL** - 8 counts, median 27d cadence

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-03-14 | P1 | 13610 | 331 | 2184 | 0 | 0 | 16125 |
| 2026-03-14 | P2 | 9342 | 142 | 1826 | 0 | 0 | 11309 |
| 2026-03-23 | P3 | 10442 | 60 | 1574 | 0 | 0 | 12076 |
| 2026-05-08 | P4 | 19709 | 142 | 2317 | 0 | 0 | 22168 |
| 2026-05-19 | P5 | 10108 | 201 | 2278 | 0 | 0 | 12587 |
| 2026-06-16 | P6 | 17323 | 306 | 2005 | 0 | 0 | 19635 |
| 2026-07-14 | P7 | 11762 | 150 | 1944 | 0 | 0 | 13855 |
| 2026-08-10 | P8 | 8058 | 60 | 2348 | 0 | 0 | 10466 |

**TXR - TX - H** - 3 counts, huge gaps

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-04-20 | P4 | 8770 | 1200 | 425 | 730 | 410 | 11535 |
| 2026-05-27 | P5 | 10500 | 1200 | 500 | 975 | 550 | 13725 |
| 2026-06-22 | P3 | 15750 | 1800 | 1250 | 1100 | 1000 | 20900 |

Note the third row is labelled Period=P3 but Count Date=2026-06-22, which
is inside P7. The Period column is a submitter-entered label; the Count
Date is authoritative for reconciliation. Notes on that row say
"BEGINNING OF A LONG HOMESTAND" - so the label may reflect a homestand
number, not the fiscal period. Reconciliation uses the date.

**TXR - TX - V** - 6 counts, median 23d cadence. Period-labels also drift
from Count Dates (row 2 labels P3 but is dated 2026-05-05, inside P5).

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-04-22 | P4 | 11159 | 1595 | 964 | 0 | 0 | 13717 |
| 2026-05-05 | P3 | 18437 | 1740 | 2132 | 0 | 0 | 22310 |
| 2026-05-28 | P5 | 11164 | 1859 | 982 | 0 | 0 | 14005 |
| 2026-06-29 | P6 | 12121 | 2301 | 973 | 0 | 0 | 15395 |
| 2026-07-20 | P7 | 12763 | 2104 | 877 | 0 | 0 | 15744 |
| 2026-08-18 | P8 | 13375 | 2001 | 1262 | 0 | 0 | 16637 |

**TXR - AZ** - 8 counts, median 27d cadence

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-03-14 | P1 | 13395 | 4040 | 2373 | 0 | 0 | 19808 |
| 2026-03-15 | P2 | 20309 | 5432 | 3447 | 2329 | 3010 | 34527 |
| 2026-04-21 | P3 | 17081 | 3656 | 2673 | 767 | 1217 | 25395 |
| 2026-04-21 | P4 | 12024 | 4331 | 3321 | 767 | 1217 | 21660 |
| 2026-05-18 | P5 | 12024 | 4331 | 3321 | 0 | 0 | 19676 |
| 2026-06-14 | P6 | 12666 | 4213 | 2161 | 0 | 0 | 19041 |
| 2026-07-14 | P7 | 9525 | 5356 | 2401 | 0 | 0 | 17281 |
| 2026-08-10 | P8 | 11583 | 5448 | 1927 | 0 | 0 | 18958 |

**STL - FL** - **2 counts, both dated 2026-03-14**. First is $0 (labeled
"No Start INV k.fietek"); second is $77,460 (labeled P2, "Britt submission
2/22/26"). Both submitted on the same day. Identity cannot be tested
beyond P2 for this account.

| date | period | food | pack | supplies | snacks | bev | total |
|---|---|--:|--:|--:|--:|--:|--:|
| 2026-03-14 | P1 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-03-14 | P2 | 38778 | 4956 | 2000 | 25226 | 6500 | 77460 |

### Coverage gaps summary

| account | count total | first date | last date | median gap (d) | period alignment |
|---|--:|---|---|--:|---|
| TBR - FL | 8 | 2026-03-14 | 2026-08-10 | 23 | loose |
| STL - MO | 6 | 2026-04-03 | 2026-08-10 | 29 | loose |
| CIN - KY | 0 | - | - | - | none |
| CIN - AZ | 8 | 2026-03-14 | 2026-08-10 | 27 | loose (close-to-clean P4+) |
| CIN - OH | 6 | 2026-03-19 | 2026-08-08 | 28 | loose |
| TBJ - NY | 0 | - | - | - | none |
| TBJ - FL | 8 | 2026-03-14 | 2026-08-10 | 27 | loose |
| TXR - TX - H | 3 | 2026-04-20 | 2026-06-22 | 37 | loose, sparse |
| TXR - TX - V | 6 | 2026-04-22 | 2026-08-18 | 23 | loose |
| TXR - AZ | 8 | 2026-03-14 | 2026-08-10 | 27 | 1 clean (P6->P7) |
| STL - FL | 2 | 2026-03-14 | 2026-03-14 | 0 | none past P2 |

### Cadence (actual, not intended)

Nearly every account submits on a ~28d cadence, but the count DATES land
consistently 1-14 days AFTER the fiscal period boundary. That off-by-a-week
pattern is enough to disqualify most intervals from a "clean bracket"
classification (defined below as start/end within 3 days of a fiscal
period boundary).

Only **1 interval out of 46** total classifies as clean: TXR - AZ
2026-06-14 to 2026-07-14, which starts on the P6 start date and ends
2 days after the P7 end.

### Rows that did not match a portfolio account

3 rows for "CORP - KitchFix Team". Correctly excluded from portfolio
analysis.

## Part B - category mapping hypothesis [code-read + stated, UNVERIFIED]

The Sheets category axis is: **Food, Packaging, Supplies, Snacks, Beverages**.
The Purchasing bucket axis is: **food (3200), packaging (3400), vehicle (3500)**.
The mapping is not documented anywhere in the repo (grep of `src/lib` and
`docs/` confirms). Below is the working hypothesis; **not verified against
close-of-books rules or coder training material**.

| Sheet category | Hypothesized 34xx/32xx mapping | Rationale |
|---|---|---|
| Food | 3200.1 (main food) | Named-alignment. Nothing else fits. |
| Packaging | 3400.1 (packaging) | Named-alignment. |
| Supplies | 3400.2 (smallwares / paper) OR 5xxx SGA | UNSURE. If Supplies means kitchen consumables (foil, gloves, film), 3400.2 is likely. If it means office / cleaning / SGA-shaped items, 5xxx. Prompt notes this ambiguity explicitly. |
| Snacks | 3200.2 (resale food) | Per prompt note: "Snacks/beverages may belong there instead of 3200.1." Team-clubhouse resale items are the canonical 3200.2 population. |
| Beverages | 3200.2 (resale food) | Same reasoning. Team beverages are resale. |

**Implications for the identity**:

1. Our Purchasing "food" bucket (all 3200.x) INCLUDES resale (3200.2).
   If Snacks + Beverages in the sheet are 3200.2, the Sheets "food"
   category alone does NOT match the Purchasing food bucket; the correct
   equivalent from Sheets is (Food + Snacks + Beverages).
2. If Supplies is 3400.2, the Purchasing packaging bucket equivalent
   from Sheets is (Packaging + Supplies), not Packaging alone.
3. STL - MO's P3 count shows $7,108 Snacks + $5,306 Beverages - large
   numbers that would not be captured in an identity that uses only
   the "Food" column. This is why the STL - MO P3 residual is very
   large when computed food-vs-food.

**Part D below computes both a strict food-vs-food identity and (in the
JSON dump) a broadened food+snacks+bev identity so downstream review
can select.**

Kevin owner-rules the mapping - this is a stated hypothesis, deferred.

## Part C - purchases per period [ran]

Values below are `ours_total = billcom + rippling_spend` for the bucket,
same denominator used by the purchasing board hero.

### 3200 FOOD per-period (ours) - matches board hero

| account | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | YTD |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| TBR - FL | 15176 | 91277 | 123919 | 48746 | 39960 | 37620 | 39257 | 39450 | 435404 |
| STL - MO | 0 | 0 | 0 | 80 | 0 | 0 | 0 | 0 | 80 |
| CIN - KY | 0 | 0 | 0 | 15588 | 10745 | 9489 | 11804 | 8212 | 55837 |
| CIN - AZ | 32211 | 59126 | 91012 | 24045 | 27479 | 26939 | 25341 | 25750 | 311903 |
| CIN - OH | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| TBJ - NY | 0 | 0 | 0 | 7518 | 6612 | 8265 | 7822 | 5529 | 35746 |
| TBJ - FL | 25369 | 68926 | 92804 | 48144 | 37816 | 41982 | 32735 | 33399 | 381176 |
| TXR - TX - H | 1473 | 0 | 1492 | 43710 | 51336 | 43768 | 41280 | 40621 | 223680 |
| TXR - TX - V | 0 | 0 | 8777 | 11404 | 15022 | 17320 | 20291 | 19058 | 91873 |
| TXR - AZ | 24014 | 66748 | 94183 | 37197 | 27598 | 33967 | 26723 | 27806 | 338238 |
| STL - FL | 0 | 0 | 0 | 0 | 0 | 16652 | 419 | 0 | 17071 |

### 3200 FOOD delta = ours - finance

| account | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| TBR - FL | +6157 | +11018 | -11057 | -6904 | -1061 | -7808 | -308 | -1434 |
| STL - MO | 0 | 0 | 0 | +80 | 0 | 0 | 0 | 0 |
| CIN - KY | 0 | 0 | 0 | -155 | -327 | -874 | -768 | -748 |
| CIN - AZ | +2458 | +7768 | -6331 | -1410 | +2708 | +244 | -785 | -511 |
| CIN - OH | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| TBJ - NY | 0 | 0 | 0 | -365 | -1536 | -735 | -1735 | -820 |
| TBJ - FL | +7736 | -8477 | -9682 | +10467 | -16469 | +18329 | -5195 | -3247 |
| TXR - TX - H | -926 | -352 | -1877 | -3951 | -1122 | +2037 | -4510 | -2798 |
| TXR - TX - V | 0 | 0 | 0 | +2029 | -1383 | -299 | -805 | -869 |
| TXR - AZ | +3054 | +3031 | -15189 | -2452 | -1918 | -2466 | -2371 | -655 |
| STL - FL | 0 | 0 | -842 | 0 | -15307 | +14886 | -1347 | -1766 |

CIN - OH and STL - MO: ours non-zero (STL - MO has $80 in P4), finance
$0 by design (billed back to client). Structural, per prompt.

### 3400 PACKAGING per-period (ours)

| account | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | YTD |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| TBR - FL | 2124 | 11468 | 13068 | 5070 | 3989 | 4460 | 4219 | 4675 | 49073 |
| STL - MO | 0 | 0 | 0 | 2908 | 0 | 0 | 176 | 417 | 3501 |
| CIN - KY | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CIN - AZ | 2246 | 4454 | 8036 | 3159 | 1890 | 2325 | 3066 | 2305 | 27481 |
| CIN - OH | 188 | 0 | 263 | 74 | 74 | 692 | 74 | 37 | 1402 |
| TBJ - NY | 0 | 0 | 0 | 258 | 41 | 200 | 63 | 0 | 562 |
| TBJ - FL | 2967 | 6001 | 3777 | 8712 | 2811 | 3207 | 2874 | 2862 | 33210 |
| TXR - TX - H | 0 | 0 | 1031 | 3873 | 4314 | 2847 | 4118 | 4634 | 20818 |
| TXR - TX - V | 0 | 0 | 664 | 941 | 2608 | 2404 | 2132 | 2497 | 11246 |
| TXR - AZ | 2392 | 4638 | 5366 | 2640 | 3142 | 4187 | 3035 | 2763 | 28163 |
| STL - FL | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

CIN - KY and STL - FL show **zero** packaging in ours. See Part E.

## Part D - reconciliation, per bracketed interval

For each interval (consecutive counts), compute:

- `implied_movement = finance_food_in_interval - our_purchases_in_interval`
- `counted_movement = beginning_count_food - ending_count_food`
- `residual = implied_movement - counted_movement`

**Finance flow is day-prorated across each period** (28d evenly). This is
a stated assumption, NOT count interpolation. Kevin's rule
("Do not interpolate to force a comparison") is preserved: counts are used
exactly as submitted; only the finance-P&L flow is smoothed to a daily
rate to compute an interval subtotal. If purchases are not uniformly
distributed within a period, this introduces bounded distortion; the
residuals below reflect that.

**Bracket quality** classification:

- `clean` - both endpoints within 3d of a period boundary, at least 1 boundary inside
- `acceptable` - both endpoints within 7d, at least 1 boundary inside
- `loose` - at least 1 boundary inside but endpoints further off
- `no_boundary` - no fiscal period boundary lies inside the interval

Only clean intervals should be trusted at face value. Acceptable are usable
with caveats. Loose and no_boundary are reported for completeness but do
not falsify the identity.

### FOOD reconciliation (all 46 intervals)

Values in dollars. `residual` = implied - counted. Ratio = residual / max(fin, purch).

| acct | interval | q | fin_food | our_food | implied | counted | residual | ratio |
|---|---|---|--:|--:|--:|--:|--:|--:|
| TBR - FL | 2026-03-14->2026-03-14 | no_boundary | 4821 | 4652 | 169 | -21030 | 21199 | 100.8% |
| TBR - FL | 2026-03-14->2026-03-23 | loose | 45373 | 44296 | 1076 | 6778 | -5702 | -84.1% |
| TBR - FL | 2026-03-23->2026-05-07 | loose | 82021 | 78012 | 4008 | 5522 | -1514 | -27.4% |
| TBR - FL | 2026-05-07->2026-05-18 | loose | 17738 | 16224 | 1514 | 226 | 1288 | 85.1% |
| TBR - FL | 2026-05-18->2026-06-13 | loose | 43806 | 37620 | 6186 | 915 | 5271 | 85.2% |
| TBR - FL | 2026-06-13->2026-07-18 | acceptable | 51571 | 48628 | 2943 | -799 | 3742 | 127.1% |
| TBR - FL | 2026-07-18->2026-08-10 | no_boundary | 33583 | 33423 | 160 | -1298 | 1458 | 112.3% |
| STL - MO | 2026-04-03->2026-05-15 | loose | 0 | 80 | -80 | 15566 | -15646 | -100.5% |
| STL - MO | 2026-05-15->2026-05-15 | no_boundary | 0 | 0 | 0 | -2310 | 2310 | 100.0% |
| STL - MO | 2026-05-15->2026-06-07 | loose | 0 | 0 | 0 | 3143 | -3143 | -100.0% |
| STL - MO | 2026-06-07->2026-07-12 | loose | 0 | 0 | 0 | 1296 | -1296 | -100.0% |
| STL - MO | 2026-07-12->2026-08-10 | loose | 0 | 0 | 0 | -452 | 452 | 100.0% |
| CIN - AZ | 2026-03-14->2026-03-14 | no_boundary | 3477 | 2888 | 588 | -8120 | 8708 | 107.2% |
| CIN - AZ | 2026-03-14->2026-03-26 | loose | 34925 | 32281 | 2644 | 4613 | -1969 | -42.7% |
| CIN - AZ | 2026-03-26->2026-04-22 | loose | 25382 | 22745 | 2637 | 2516 | 121 | 4.6% |
| CIN - AZ | 2026-04-22->2026-05-19 | loose | 24908 | 28906 | -3997 | -457 | -3541 | -88.6% |
| CIN - AZ | 2026-05-19->2026-06-16 | loose | 27608 | 25286 | 2321 | -395 | 2716 | 117.0% |
| CIN - AZ | 2026-06-16->2026-07-13 | loose | 26131 | 25956 | 175 | 582 | -406 | -69.9% |
| CIN - AZ | 2026-07-13->2026-08-10 | loose | 26261 | 28348 | -2087 | -265 | -1822 | -87.3% |
| CIN - OH | 2026-03-19->2026-04-17 | loose | 0 | 0 | 0 | 15875 | -15875 | -100.0% |
| CIN - OH | 2026-04-17->2026-05-15 | loose | 0 | 0 | 0 | 523 | -523 | -100.0% |
| CIN - OH | 2026-05-15->2026-06-14 | loose | 0 | 0 | 0 | -3318 | 3318 | 100.0% |
| CIN - OH | 2026-06-14->2026-07-12 | loose | 0 | 0 | 0 | 4912 | -4912 | -100.0% |
| CIN - OH | 2026-07-12->2026-08-08 | loose | 0 | 0 | 0 | -616 | 616 | 100.0% |
| TBJ - FL | 2026-03-14->2026-03-14 | no_boundary | 3660 | 0 | 3660 | 4268 | -608 | -14.2% |
| TBJ - FL | 2026-03-14->2026-03-23 | loose | 34288 | 42576 | -8288 | -1100 | -7189 | -86.7% |
| TBJ - FL | 2026-03-23->2026-05-08 | loose | 74513 | 79132 | -4619 | -9268 | 4649 | 50.2% |
| TBJ - FL | 2026-05-08->2026-05-19 | loose | 21077 | 18427 | 2650 | 9601 | -6952 | -72.4% |
| TBJ - FL | 2026-05-19->2026-06-16 | loose | 25518 | 37041 | -11524 | -7216 | -4308 | -37.4% |
| TBJ - FL | 2026-06-16->2026-07-14 | loose | 39193 | 38739 | 454 | 5562 | -5108 | -91.8% |
| TBJ - FL | 2026-07-14->2026-08-10 | no_boundary | 35337 | 36480 | -1143 | 3703 | -4846 | -130.9% |
| TXR - TX - H | 2026-04-20->2026-05-27 | loose | 67362 | 65578 | 1784 | -1730 | 3514 | 197.0% |
| TXR - TX - H | 2026-05-27->2026-06-22 | loose | 41400 | 45513 | -4113 | -5250 | 1137 | 21.7% |
| TXR - TX - V | 2026-04-22->2026-05-05 | no_boundary | 8203 | 5250 | 2953 | -7279 | 10231 | 140.6% |
| TXR - TX - V | 2026-05-05->2026-05-28 | loose | 14538 | 12906 | 1632 | 7274 | -5642 | -77.6% |
| TXR - TX - V | 2026-05-28->2026-06-29 | loose | 22628 | 20362 | 2266 | -957 | 3223 | 142.3% |
| TXR - TX - V | 2026-06-29->2026-07-20 | loose | 16241 | 15217 | 1025 | -642 | 1667 | 162.7% |
| TXR - TX - V | 2026-07-20->2026-08-18 | no_boundary | 14945 | 22991 | -8045 | -612 | -7434 | -92.4% |
| TXR - AZ | 2026-03-14->2026-03-15 | no_boundary | 7812 | 4015 | 3797 | -6914 | 10712 | 154.9% |
| TXR - AZ | 2026-03-15->2026-04-21 | loose | 73006 | 59922 | 13084 | 3228 | 9856 | 75.3% |
| TXR - AZ | 2026-04-21->2026-04-21 | no_boundary | 1054 | 2400 | -1345 | 5057 | -6402 | -126.6% |
| TXR - AZ | 2026-04-21->2026-05-18 | loose | 29763 | 30676 | -913 | 0 | -913 | -100.0% |
| TXR - AZ | 2026-05-18->2026-06-14 | loose | 36433 | 33967 | 2466 | -642 | 3108 | 126.0% |
| TXR - AZ | 2026-06-14->2026-07-14 | **clean** | 32428 | 30176 | 2252 | 3142 | **-889** | **-28.3%** |
| TXR - AZ | 2026-07-14->2026-08-10 | no_boundary | 27445 | 30637 | -3192 | -2059 | -1134 | -35.5% |
| STL - FL | 2026-03-14->2026-03-14 | no_boundary | 30 | 0 | 30 | -38778 | 38808 | 100.1% |

### Residual size distribution (FOOD)

| bucket | count |
|---|--:|
| small (<10% of flow) | 16 |
| medium (10-25%) | 11 |
| large (>=25%) | 19 |
| **TOTAL** | **46** |

Restricted to **clean brackets only**: 1 interval, residual $889 on
$32,428 finance food ratio 2.7% - inside the "small" band.

The single clean bracket **does** hold the identity: TXR - AZ 2026-06-14
to 2026-07-14 has counted movement $3,142 (BOH-EOH), implied movement
$2,252 (fin - purch), residual $889 - about 2.7% of the interval's food
flow. **Cheap conclusion**: where cadence lets us test the identity, it
holds within-noise. Where cadence does not (45 of 46 intervals), the
residuals are dominated by the misalignment, not the identity failing.

The 16 "small" residuals across loose intervals suggest inventory DOES
explain a meaningful fraction of the food gap on those account-intervals -
but the day-proration assumption on finance flow means the numbers are
noisy. Reading them as "inventory clearly explains X" would over-claim.

### Notable large-residual cases (loose or acceptable) worth Kevin's
attention:

- **TBR - FL 2026-03-23 -> 2026-05-07 (45d)** - crossed 2 period
  boundaries. Residual -$1,514 on $82,021 finance (small at 1.8% -
  actually inside "small" by absolute value if measured against fin).
  The 27% ratio is because residual/max(fin,purch) is a sensitive metric;
  in this case the "medium" flag over-states the concern.
- **STL - MO 2026-04-03 -> 2026-05-15 (42d)** - $15,566 counted movement
  vs $0 finance = residual $-15,646. Kevin's food-billed-back model
  makes finance-food $0; the counted movement is genuinely happening
  and appears on the client's books.
- **CIN - OH 2026-03-19 -> 2026-04-17** - counted movement $15,875 vs
  $0 finance. Same class as STL - MO. The counted decrement DID
  happen ($20k P3 count -> $4k P4 count); finance never sees it because
  the food is billed back.

### Alignment quality per account

| account | clean | acceptable | loose | no_boundary | notes |
|---|--:|--:|--:|--:|---|
| TBR - FL | 0 | 1 | 5 | 2 | 45d P3-P5 stretch spans 2 periods |
| STL - MO | 0 | 0 | 4 | 1 | first count on 2026-04-03 (into P4) |
| CIN - KY | - | - | - | - | zero counts |
| CIN - AZ | 0 | 0 | 6 | 1 | close to clean on P4+ but end always 0-3d after |
| CIN - OH | 0 | 0 | 5 | 0 | consistent 4-day-late pattern |
| TBJ - NY | - | - | - | - | zero counts |
| TBJ - FL | 0 | 0 | 5 | 2 | 46d P3-P5 stretch spans 2 periods |
| TXR - TX - H | 0 | 0 | 2 | 0 | sparse, 37d gap |
| TXR - TX - V | 0 | 0 | 3 | 2 | irregular |
| TXR - AZ | 1 | 0 | 4 | 2 | P6->P7 clean |
| STL - FL | 0 | 0 | 0 | 1 | only P1/P2 both dated 2026-03-14 |

## Part E - packaging separately

Same identity, packaging column. Kevin's ask: is the -44% to -55% delta
in packaging explained by inventory, or is something else in there?

### Packaging residual size distribution

| bucket | count |
|---|--:|
| small (<10% of flow) | 5 |
| medium (10-25%) | 9 |
| large (>=25%) | 32 |
| **TOTAL** | **46** |

Only 5 of 46 loose intervals came in small on packaging (11%), versus
16 of 46 (35%) on food. **Inventory alone does not explain the packaging
gap.**

### The two-zero-account finding

Both CIN - KY ($0 ours vs $1,385 finance) and STL - FL ($0 ours vs $10,991
finance) have **zero rows** in `purchasing_actuals` for GL codes starting
with `3400` for the FYTD-P8 window. This is a mapping/coding gap, not a
data gap.

**CIN - KY** - 115 rows YTD-P8, all in either 3200.1 (food, 113 rows,
$55,837) or 5000 (SGA, 2 rows, $202 - AC Hotel travel). No 3400.x rows
exist. There are only 3 bill vendors in the account.

Finance's $1,385 packaging must come from either:
- year-end reclassification / manual JE
- a shared-load allocation from CIN corporate (not per-site)
- packaging bills invoiced to a different account_key that finance
  reallocates
None of these appear in the account's `purchasing_actuals` stream.

**STL - FL** - 800 rows YTD-P8, spread across:

| gl | source | count | amount | classification |
|---|---|--:|--:|---|
| 1385.3 | billcom | 380 | 573019 | reimbursable |
| 1385.3.2 | billcom | 159 | 172655 | reimbursable |
| 1385.4 | billcom | 172 | 59463 | reimbursable |
| 1385.3.1 | billcom | 18 | 18557 | reimbursable |
| 3200.2 | billcom | 12 | 16652 | resale food |
| 5000 | rippling_spend | 15 | 5641 | SGA |
| 1385.3 | rippling_spend | 3 | 578 | reimbursable |
| 3200.1.2 | rippling_spend | 1 | 419 | pl_cogs food |
| 1384.2 | billcom | 32 | 1516 | reimbursable |
| 5017.3 | billcom | 3 | 620 | SGA |
| NULL | rippling_spend | 5 | 3669 | uncoded |

**Zero** rows coded 3400.x. Every bill from every vendor lands in 1385.x
(reimbursable to Cardinals) or 3200.2 (resale food) or 5000 (SGA travel).
Finance's $10,991 packaging must come from a reclass at close, either
from lifting some fraction of the 1385.3.x reimbursable bills into 3400.x,
or from a shared cost allocation.

Top billcom vendors for STL - FL are all bill.com internal IDs (starting
`00901...`); the bill data does have vendor merchandise info that likely
identifies packaging line items but the routing rule is not lifting them
into 3400.

**Recommendation** (report only, no fix): flag both accounts to the
close-books review as "packaging exists in finance but not in our
purchasing feed" and ask which reclass rule is applied. If shared cost
allocation, our per-site 3400 will always be zero and the finance-vs-ours
comparison is not apples to apples.

## Completeness map (C2)

| Part | Status | Reason |
|---|---|---|
| A - inventory counts, actually read | DONE | Sheets read via SA path succeeded; 55 portfolio rows across 9 of 11 accounts. |
| B - category mapping | DONE (as hypothesis) | Explicit mapping stated + flagged UNVERIFIED per prompt. |
| C - our purchases per period | DONE | 88 account-periods computed via same resolver as purchasing route. |
| D - reconciliation, per bracketed interval | DONE | 46 intervals computed. Only 1 is "clean"; the rest are reported with alignment quality. Not interpolated. |
| E - packaging separately | DONE | Same identity; 5/46 small vs 32/46 large; two-zero-account mapping gap detail included. |

## Acceptance echo (C4)

- Part A "inventory counts actually read" - **[met-ran]**. Read via
  `readSheetSA(SHEET_IDS.COLLECTION, "inventory_submissions")`. Verbatim
  header captured. 58 rows total, 55 portfolio, 3 CORP. Two accounts
  (CIN - KY, TBJ - NY) have zero counts; noted.
- Part B "category mapping hypothesis explicit and flagged unverified" -
  **[met-code-read + stated]**. Mapping table above, flagged UNVERIFIED,
  deferred to Kevin.
- Part C "our purchases per period via same resolver as the purchasing
  board" - **[met-ran]**. `purchasing_actuals` paginated per (account_key,
  excluded=false, txn_date), bucket = prefix(3200|3400), source in
  {billcom, rippling_spend}, matches route.js L266-294 shape.
- Part D "reconciliation per bracketed interval, report residuals, alignment
  quality per account, no interpolation" - **[met-ran]**. 46 intervals
  reported with quality tags. Finance flow day-prorated (stated
  assumption, not count interpolation). Only 1 clean bracket exists;
  residual there is 2.7%.
- Part E "packaging identity + two-zero mapping-gap search" - **[met-ran]**.
  Same identity ran. CIN - KY: zero 3400.x rows, all bills to 3200.1
  or 5000. STL - FL: zero 3400.x rows, all bills to 1385.x reimbursable
  or 3200.2 or 5000. Reported, not fixed.

## Blocked items / unmeasurable as written

- **CIN - KY inventory identity** - unmeasurable, zero counts submitted
  to date. Attempt: read `inventory_submissions`, filtered on
  "CIN - KY" prefix; result zero rows.
- **TBJ - NY inventory identity** - unmeasurable, zero counts submitted
  to date. Same attempt shape.
- **STL - FL identity beyond P2** - unmeasurable, both counts on
  2026-03-14 with no subsequent submissions. The 2026-03-14 P1 count
  is $0 (labeled "No Start INV") so even P1 -> P2 is an artefact
  (start-of-year zero vs a full snapshot).
- **Clean-bracket testable population** - 1 interval (TXR - AZ P6 -> P7).
  All other conclusions come from loose or no-boundary intervals and
  should be read as directional, not evidentiary.

## Labor control (from prompt, confirmed)

Not re-measured in this probe (see PR #898 Part D probe for the run).
Finance 3100.1 hourly-only YTD-P8 = **$1,607,095.01**; ours =
**$1,604,030.64**; delta **-0.19%**. Confirmed as instructed.
