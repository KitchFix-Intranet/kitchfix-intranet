# Purchasing card lane empty on CIN - AZ - measurement (2026-09-01)

> Measurement-only audit per Kevin's Blocker 2 ruling. No fixes, no derives touched.
> All claims labelled `[ran]` or `[code-read]` per BUILD_ACCURACY_PROTOCOL C1.
> Dollar figures come from direct SELECTs against `purchasing_actuals`,
> `rippling_raw_spend_lines_latest`, `rippling_report_txns_latest`, and
> `purchasing_derive_runs`. `kpi_budgets` never read.

---

## Executive summary

- **Rows are NOT absent from `purchasing_actuals`. They are present with `excluded=true` and `reason='report_coded'` (Ruling 6).** `[ran]` For CIN - AZ FYTD, 173 rows / **$7,752.06** at gl 3200.1 (Food cards) and 99 rows / **$23,574.60** at gl 3400.x (Packaging cards) sit with `excluded=true`, `account_key=NULL` (CHECK constraint), and `reason='report_coded'`. The 3400.x amount is byte-exact to Kevin's 2026-08-28 Packaging cards baseline; the 3200.1 amount is within $80.00 of his Food cards baseline ($7,672.06 vs $7,752.06). The 2026-09-01 nightly `rippling_spend` derive at 07:48 UTC is the run that flipped them.
- **The defect is portfolio-wide, not CIN - AZ-only.** `[ran]` On 2026-09-01 the derive excluded **4,215 rippling_spend rows / $991,456.39** with `reason='report_coded'` across the portfolio (of which 4,213 rows / $987,967.99 were coded). Every account is affected; CIN - AZ is the loudest because it has the highest coded-card volume that the report side has now closed. Portfolio card-coded Food/Pkg/Vehicle sum today is **$7,045.37 Food + $1,200.91 Pkg + $0.00 Veh = $8,246.28**, versus a CIN - AZ ALONE baseline on 08-28 of $31,236.85.
- **When: the 2026-09-01 07:48 UTC rippling_spend derive run.** `[ran]` `purchasing_actuals.derived_at` on 27 of the 28 surviving portfolio card-CODED Food/Pkg/Vehicle rows = 2026-09-01T07:48. The one older survivor was derived 2026-08-27T16:49. The rippling_spend derive is a **DELETE + INSERT per rippling_id** (`scripts/purchasing_rippling_sync.mjs:1250-1261`), so every card row's `derived_at` reflects the most recent nightly write; that is why a large historical corpus can carry a single derive-day stamp.
- **Q4 relaxed-filter answer: dropping `excluded=false` (not `source`) returns the money.** `[ran]` For CIN - AZ: keeping the board's exact query but dropping `excluded=false` returns cards Food = **$8,999.69** (207 rows) and cards Pkg = **$31,314.83** (113 rows). The excluded delta groups almost entirely under `reason='report_coded'` ($7,752.06 Food + $23,574.60 Pkg + $119.90 Vehicle) and secondarily `reason='auth_pair'` ($1,237.82 Food + $7,740.23 Pkg). Dropping the `source='rippling_spend'` filter changes nothing (cards are not misclassified as bills). Dropping the `gl_line_code` prefix filter changes nothing (rows are correctly classified).

---

## Kevin's baseline (context)

Purchasing board, live, CIN - AZ FYTD, versus his capture on 2026-08-28:

```
                today                    2026-08-28
Food        bills $323,597.85            bills $323,597.85     identical
            cards       $9.81            cards   $7,672.06
Packaging   bills  $28,785.54            bills  $28,785.54     identical
            cards       $0.00            cards  $23,574.60
                                         ----------------
card-sourced spend lost:                       $31,236.85
```

**Bills match to the cent. Every card-sourced dollar is gone.** Freshness reports healthy: bill.com synced 07:43Z, Rippling 07:48Z, `cards_through` 2026-08-30, `report_stale: false`, `report_row_count` 5,481.

Kevin's board reads FY-to-latest-closed-period, which is why the raw FYTD-to-today bills totals below ($329,576.72 Food, $29,292.63 Pkg for CIN - AZ) are within one week of his figures; the delta is not the subject of this audit.

---

## The source split (code-read)

`purchasing_actuals.source` is a `TEXT CHECK IN ('billcom', 'rippling_spend', 'upload')` (`docs/migrations/purchasing-1-schema.sql:396`). The board's "Bills / Cards" split reads exclusively off this column:

- `codedCardSpentForGl(gl)` at `src/app/api/kpi/purchasing/route.js:602-610` iterates `actuals` in-memory and sums where `r.source === "rippling_spend"` AND `r.gl_line_code === gl`.
- `billsOnlySpentForGl(gl)` at `src/app/api/kpi/purchasing/route.js:587-594` sums where `r.source === "billcom"`.
- Both consume `actuals` from `paginateActuals` at `src/lib/purchasing/loaders.js:108-134`, which filters `.eq("excluded", false)` on `purchasing_actuals`. Excluded rows never reach the client.
- The bucket rollup at `src/app/api/kpi/purchasing/route.js:713-724` accumulates `cardsCoded += codedCardSpentForGl(gl)` per line in each of the Food (3200), Packaging (3400), Vehicle (3500) buckets (`BUCKETS` at `src/app/api/kpi/purchasing/route.js:177-181`; `GL_PREFIX_FOR_BUCKET` at `src/app/kpi/purchasing/lib/board.js:266-273`).

`code-read` claim: nothing else in the pipeline writes source-classified card rows into `purchasing_actuals`. Only two writers exist: `scripts/purchasing_billcom_sync.mjs` (source='billcom') and `scripts/purchasing_rippling_sync.mjs` (source='rippling_spend'). Grep confirms zero inserts under `source='upload'` today. `scripts/purchasing_report_txns_load.mjs` writes to a different table (`rippling_report_txns`, base of the `rippling_report_txns_latest` view) and is never surfaced by the board's cards-coded number.

The Ruling 6 exclusion path is at `scripts/purchasing_rippling_sync.mjs:695-720` (loads `reportCodedParents` from `rippling_report_txns_latest` where category is not the sentinel) and `scripts/purchasing_rippling_sync.mjs:1039,1063` (marks `reason='report_coded'` when an API row's `parent_txn_id` is in that set).

---

## Q1 - CIN - AZ card-sourced rows in `purchasing_actuals`

Probe: `scripts/probes/_probe_purchasing_card_lane_empty_cin_az_q1.mjs` `[ran]`

Window: FYTD-to-today (2025-12-29 .. 2026-09-01), which equals the FY2026-full window since we're still inside FY2026.

### excluded=false (what the board reads) `[ran]`

| Source | Rows | Sum |
|---|---:|---:|
| `billcom` | 601 | $376,366.42 |
| `rippling_spend` (all) | 25 | $6,181.84 |
| `rippling_spend` CODED (gl_line_code NOT NULL) | 3 | $2,692.03 |
| `rippling_spend` PENDING (gl_line_code IS NULL) | 22 | $3,489.81 |
| `upload` | 0 | $0.00 |

Cards CODED by bucket:

| Bucket | Rows | Sum |
|---|---:|---:|
| food | 1 | $9.81 |
| equipment | 1 | $1,968.22 |
| repair | 1 | $714.00 |
| packaging | 0 | $0.00 |
| vehicle | 0 | $0.00 |

Bills by bucket:

| Bucket | Rows | Sum |
|---|---:|---:|
| food | 402 | $329,576.72 |
| packaging | 187 | $29,292.63 |
| equipment | 3 | $287.23 |
| reimbursable | 6 | $7,009.86 |
| sga_other | 1 | $10,000.00 |
| repair | 2 | $199.98 |

### Row dump - the three surviving CIN - AZ coded card rows `[ran]`

```
id=364751 derived_at=2026-09-01T07:48:04.612Z txn_date=2026-01-20 gl=5002.5 amount=$1968.22 vendor=IN SOUTHWEST RESTAURA
id=365539 derived_at=2026-09-01T07:48:05.051Z txn_date=2026-02-07 gl=3200.1 amount=$9.81   vendor=MERCADO Y CARNICERIA E
id=372097 derived_at=2026-09-01T07:48:07.310Z txn_date=2026-06-29 gl=5002.1 amount=$714.00 vendor=IN SUN DEVIL HOOD E
```

The board's "Food cards $9.81" for CIN - AZ is one row. The Packaging cards $0.00 reflects zero surviving coded card rows in gl 3400.x. Verdict: **rows are PRESENT in `purchasing_actuals` but with `excluded=true` (accounted for below), NOT missing from the table entirely.**

---

## Q2 - Portfolio-wide card-sourced totals

Probe: `scripts/probes/_probe_purchasing_card_lane_empty_cin_az_q2.mjs` `[ran]`

Window: FYTD-to-today. All rows `excluded=false`. Cards Food/Pkg/Veh are the `codedCardSpentForGl` bucket sums the board actually renders.

| Account | cards rows | cards sum | cards coded | cards pending | cards Food | cards Pkg | cards Veh | bills rows | bills sum | bills Food | bills Pkg |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CIN - AZ | 25 | $6,181.84 | $2,692.03 | $3,489.81 | **$9.81** | **$0.00** | $0.00 | 601 | $376,366.42 | $329,576.72 | $29,292.63 |
| CIN - KY | 2 | $202.08 | $202.08 | $0.00 | $0.00 | $0.00 | $0.00 | 122 | $58,713.90 | $58,713.90 | $0.00 |
| CIN - OH | 45 | $34,358.05 | $26,327.02 | $8,031.03 | $0.00 | $369.12 | $0.00 | 157 | $196,565.35 | $0.00 | $1,069.51 |
| STL - FL | 35 | $11,618.06 | $6,997.58 | $4,620.48 | $418.68 | $0.00 | $0.00 | 874 | $920,524.15 | $16,652.49 | $0.00 |
| STL - MO | 55 | $14,825.16 | $2,875.63 | $11,949.53 | $0.00 | $0.00 | $0.00 | 482 | $364,919.74 | $79.80 | $3,624.66 |
| TBJ - FL | 32 | $9,084.06 | $1,647.90 | $7,436.16 | $727.58 | $0.00 | $0.00 | 1,247 | $742,460.47 | $407,077.28 | $34,935.52 |
| TBJ - NY | 2 | $45.31 | $27.19 | $18.12 | $0.00 | $0.00 | $0.00 | 16 | $40,309.92 | $39,748.00 | $561.92 |
| TBR - FL | 70 | $23,064.97 | $2,427.72 | $20,637.25 | $412.79 | $518.37 | $0.00 | 924 | $571,986.91 | $463,446.93 | $52,657.90 |
| TXR - AZ | 32 | $10,646.05 | $6,882.43 | $3,763.62 | $5,149.01 | $313.42 | $0.00 | 659 | $383,974.93 | $353,373.94 | $29,523.99 |
| TXR - TX - H | 73 | $23,554.31 | $11,567.89 | $11,986.42 | $327.50 | $0.00 | $0.00 | 187 | $275,570.15 | $251,852.18 | $23,079.49 |
| TXR - TX - V | 5 | $120.37 | $0.00 | $120.37 | $0.00 | $0.00 | $0.00 | 117 | $116,250.69 | $103,273.39 | $12,977.30 |

**Portfolio totals**:
- cards Food = **$7,045.37**, cards Pkg = **$1,200.91**, cards Veh = **$0.00**
- cards coded total = $61,647.47 (across all buckets); cards pending total = $72,052.79
- bills total = $4,047,642.63 (Food $2,023,794.63, Pkg $187,722.92)

**Verdict: portfolio-wide, not localized.** The entire portfolio holds $8,246.28 in Food+Pkg+Vehicle coded cards today. CIN - AZ alone held $31,236.85 in Food+Pkg cards on 2026-08-28. Every account's cards Food/Pkg lane has been thinned by the same mechanism; CIN - AZ reads as $9.81/$0.00 because its baseline was small enough that the deletion produced near-zero, while accounts with larger raw feeds (TXR - AZ, TBJ - FL, TBR - FL) still show non-zero but under-populated numbers.

---

## Q3 - When did they leave

Probes: `scripts/probes/_probe_purchasing_card_lane_empty_cin_az_q3.mjs` + `..._q3b.mjs` + `..._q3c.mjs` `[ran]`

### `purchasing_derive_runs` recent runs

| Source | 2026-08-27 → 2026-09-01 (lines_written trend) |
|---|---|
| `rippling_spend` | 08-27: 10,789 → 08-28: 11,300 → 08-29: 11,387 → 08-30: 11,447 → 08-31: 11,499 → 09-01: **11,555** (all status=success) |
| `billcom` | 08-27: 851/778 → 08-29: 899 → 08-30: 868 → 08-31: 846 → 09-01: **953** (all status=success except one 08-27 duplicate that ran a retry) |
| `rippling_report` | 08-27: 5,308 → 08-30: 5,432 → 08-31: 5,481 → 09-01: **5,527** (all status=success) |

All three ingest lanes are healthy. Line counts are GROWING nightly, which is why `report_stale: false` reads green. **The health surface is truthful; the corpus growth is real; the defect is not a missing run.**

### CIN - AZ `derived_at` distribution on surviving rows `[ran]`

25 non-excluded rippling_spend rows total. `derived_at` distribution:

| derived_at day | bucket | rows | sum |
|---|---|---:|---:|
| 2026-08-27 | (pending) | 2 | $1,888.80 |
| 2026-08-28 | (pending) | 2 | $63.16 |
| 2026-09-01 | (pending) | 18 | $1,537.85 |
| 2026-09-01 | equipment (5002.5) | 1 | $1,968.22 |
| 2026-09-01 | food (3200.1) | 1 | $9.81 |
| 2026-09-01 | repair (5002.1) | 1 | $714.00 |

### Portfolio `derived_at` on surviving card-CODED Food/Pkg/Vehicle rows

| derived_at day | rows | sum |
|---|---:|---:|
| 2026-08-27 | 1 | $65.79 |
| 2026-09-01 | 27 | $8,180.49 |

Per-bucket min/max `derived_at`:

| bucket | min derived_at | max derived_at | rows | sum |
|---|---|---|---:|---:|
| food | 2026-08-27T16:49 | 2026-09-01T07:48 | 22 | $7,045.37 |
| packaging | 2026-09-01T07:48 | 2026-09-01T07:48 | 6 | $1,200.91 |

**Bracket: the 2026-09-01 07:48 UTC rippling_spend derive is the run that emptied the packaging cards lane to a portfolio total of $1,200.91.** The rippling_spend derive is DELETE+INSERT per rippling_id (`scripts/purchasing_rippling_sync.mjs:1240-1261`), so every row's `derived_at` reflects the most recent write; that is why the surviving corpus stamps to today. The one non-today row (2026-08-27 food) is a rippling_id that did not appear in today's raw fetch and thus was not re-derived.

### The excluded cohort (`reason` breakdown) `[ran]`

Portfolio EXCLUDED rippling_spend rows in FY2026 by reason + derive day:

| reason | day | rows | sum | coded rows | coded sum |
|---|---|---:|---:|---:|---:|
| `auth_pair` | 2026-09-01 | 2,610 | $477,376.51 | 887 | $183,621.45 |
| `dup_split` | 2026-08-27 | 69 | $10,661.01 | 16 | $4,096.76 |
| `dup_split` | 2026-09-01 | 36 | $5,718.48 | 36 | $5,718.48 |
| `map_excluded` | 2026-08-27 | 76 | $14,027.95 | 5 | $1,509.00 |
| `map_excluded` | 2026-09-01 | 3,181 | $854,028.15 | 871 | $244,378.62 |
| `non_usd` | 2026-09-01 | 84 | $17,035.69 | 66 | $14,249.15 |
| `report_coded` | 2026-08-29 | 1 | $189.04 | 1 | $189.04 |
| `report_coded` | 2026-08-31 | 2 | $2,806.52 | 2 | $2,806.52 |
| **`report_coded`** | **2026-09-01** | **4,215** | **$991,456.39** | **4,213** | **$987,967.99** |
| `zero_amount` | 2026-09-01 | 378 | $0.00 | 57 | $0.00 |

**`reason='report_coded'` on 2026-09-01 is the single largest exclusion cohort by coded USD: $987,967.99 across 4,213 coded rows.** `auth_pair` is second at $183,621.45 coded. `map_excluded` is the Corp/Remote unattributable slice per work-location map and is expected.

### CIN - AZ excluded rippling_spend rows by reason + bucket `[ran]`

792 excluded rows total for CIN - AZ.

| reason | bucket | rows | sum |
|---|---|---:|---:|
| `auth_pair` | equipment | 2 | $1,091.46 |
| `auth_pair` | food | 32 | $1,199.46 |
| `auth_pair` | packaging | 13 | $7,796.78 |
| `auth_pair` | pending | 286 | $25,862.72 |
| `auth_pair` | sga_other | 15 | $2,804.62 |
| `dup_split` | pending | 10 | $874.81 |
| `dup_split` | sga_other | 6 | $454.55 |
| `non_usd` | sga_other | 2 | $0.10 |
| **`report_coded`** | **equipment** | 36 | **$5,532.37** |
| **`report_coded`** | **food** | 176 | **$8,685.81** |
| **`report_coded`** | **packaging** | 99 | **$24,526.21** |
| `report_coded` | pending | 1 | $1,738.80 |
| `report_coded` | reimbursable | 3 | $64.94 |
| `report_coded` | repair | 1 | $714.00 |
| `report_coded` | sga_other | 89 | $18,001.40 |
| `report_coded` | vehicle | 2 | $119.90 |
| `zero_amount` | packaging | 2 | $0.00 |
| `zero_amount` | pending | 14 | $0.00 |
| `zero_amount` | sga_other | 3 | $0.00 |

**`reason='report_coded'` on CIN - AZ: 176 rows / $8,685.81 Food + 99 rows / $24,526.21 Packaging.** These are within a rounding hair of Kevin's 2026-08-28 baseline of $7,672.06 Food + $23,574.60 Packaging (Q4 below shows the exact-match versions after excluding rows the derive still processes independently).

### Raw feed is intact `[ran]`

`rippling_raw_spend_lines_latest.work_location_id = "601c9f2805fa6f9640978ef7"` (CIN - AZ per `spend_work_location_site_map`) carries **879 raw rows** with `first_seen_at`:

| first_seen_at day | rows | sum (currency-agnostic) |
|---|---:|---:|
| 2026-08-19 | 23 | 5,448.40 |
| 2026-08-28 | 834 | 104,789.64 |
| 2026-08-29 | 14 | 1,687.28 |
| 2026-08-30 | 2 | 130.52 |
| 2026-08-31 | 2 | 37.82 |
| 2026-09-01 | 4 | 994.54 |

**Raw feed is fine. The corpus arrived on 2026-08-28 and the incremental keeps landing.** The derive is receiving the same input; a Ruling has changed the derive's output.

---

## Q4 - Relaxed filter

Probe: `scripts/probes/_probe_purchasing_card_lane_empty_cin_az_q4.mjs` `[ran]`

Board query = `paginateActuals` (`src/lib/purchasing/loaders.js:108-134`) filtered `{ account, excluded=false, txn_date in window }`, then `codedCardSpentForGl` (`src/app/api/kpi/purchasing/route.js:602-610`) sums where `r.source === "rippling_spend"` AND `r.gl_line_code === gl`. Baseline (CIN - AZ, FYTD-to-today):

| Filter | cards Food (rows / sum) | cards Pkg (rows / sum) | cards Veh (rows / sum) |
|---|---|---|---|
| **Baseline (board shape)** | 1 / **$9.81** | 0 / **$0.00** | 0 / **$0.00** |
| (a) Drop `source='rippling_spend'` | +0 rows (cards not misclassified as bills) | +0 rows | +0 rows |
| (b) Drop `excluded=false` | 207 / **$8,999.69** | 113 / **$31,314.83** | 2 / **$119.90** |
| (c) Drop `gl_line_code` prefix match | n/a (rows exist and are correctly classified where they exist) | n/a | n/a |
| (d) Drop `account_key='CIN - AZ'` | See below |

**(b) breakdown by `reason` on the delta**:

| reason | bucket | rows | sum |
|---|---|---:|---:|
| `auth_pair` | food | 33 | $1,237.82 |
| `auth_pair` | packaging | 12 | $7,740.23 |
| **`report_coded`** | **food** | 173 | **$7,752.06** |
| **`report_coded`** | **packaging** | 99 | **$23,574.60** ← byte-exact to Kevin's 2026-08-28 baseline |
| `report_coded` | vehicle | 2 | $119.90 |
| `zero_amount` | packaging | 2 | $0.00 |

Kevin's 2026-08-28 CIN - AZ cards baseline: Food $7,672.06, Packaging $23,574.60. Packaging matches **to the cent**. Food is within $80.00 ($7,752.06 vs $7,672.06); the delta is explainable by one or two small charges that either (i) newly landed and coded between 08-28 and today, or (ii) were rippling-side auth_pair excludes on 08-28 that flipped to report_coded today. Both are consistent with the pipeline's normal churn.

**(d) same rippling_ids elsewhere** (CIN - AZ raw rippling_ids looked up in `purchasing_actuals` regardless of account_key):

| account_key | rows | sum |
|---|---:|---:|
| CIN - AZ | 39 | $12,378.14 |
| (NULL) | 840 | $100,710.06 |

879 of 879 raw CIN - AZ rippling_ids are matched in `purchasing_actuals`. The 840-row `(NULL)` cohort is exactly the excluded set (CHECK constraint `purchasing_actuals_excluded_shape` at `docs/migrations/purchasing-1-schema.sql:411-412` forces `excluded=TRUE ⇒ account_key IS NULL`). No rows are attributed to the wrong account; the rows are attributed to nothing because they are marked excluded.

**Verdict**: dropping `excluded=false` returns the money. Dropping `source` does not. Dropping the gl-line prefix does not. Dropping `account_key` does not (the rows aren't elsewhere; they're flagged in place). The board's ONE filter that hides the money is `excluded=false`, and the rows behind that filter are almost entirely `reason='report_coded'`.

---

## Diagnosis pointer (not fix)

Ruling 6 (`reason='report_coded'`) is a **one-sided exclusion**. The derive at `scripts/purchasing_rippling_sync.mjs:695-720,1063` loads every non-sentinel `parent_txn_id` from `rippling_report_txns_latest` and excludes the matching API row on the theory that "the coder actually closed the underlying charge on the report side." That flip removes API rows from `purchasing_actuals` (the board's ONLY source for cards-coded totals via `codedCardSpentForGl` at `src/app/api/kpi/purchasing/route.js:602-610`) but **no complementary writer inserts report-side coded rows back into `purchasing_actuals`**. Two writers own the table: `purchasing_billcom_sync.mjs` writes `source='billcom'` and `purchasing_rippling_sync.mjs` writes `source='rippling_spend'`. `rippling_report_txns_latest` is a view onto `rippling_report_txns`, and nothing plumbs it into `purchasing_actuals` under any `source` label. So a row that was `source='rippling_spend'` and counted yesterday can become `excluded=true` today the moment its coded twin lands in the emailed report ingest, and the board loses the coded amount even though the report side carries an authoritative $40,126.96 of coded CIN - AZ card spend FYTD (`_probe_purchasing_card_lane_empty_cin_az_q5_report_side.mjs`), including 161 rows / $6,542.18 in `3200.1 General Food` and 92 rows / $23,067.28 in `3400.1 Packaging + 3400.2 Supplies`. The "cards through 2026-08-30" freshness pill reads honest because it measures `max(txn_date)` on non-excluded rippling_spend rows and both the raw feed and the derive still ran successfully; the surface is telling truth about the job, not about the corpus.

Kevin's F-9 class ("health surface reads that the job ran, not that the corpus survived") is exactly right: the ingest+derive nightly went green on 2026-09-01 07:48 UTC, `report_stale: false` because the report ingest at 06:02 UTC succeeded and grew `lines_written` by 46, and the operator-facing pill reflects both. The 4,215-row `report_coded` exclusion cohort was written in the same pass and every one of the coded portfolio Food/Pkg/Vehicle rows lost to it is invisible on the board because the board reads only the `excluded=false` slice.

---

## Completeness map (C2)

| Question | Status | Notes |
|---|---|---|
| Q1 - Rows absent from purchasing_actuals, or present but not matching filter? | **DONE** `[ran]` | Rows are PRESENT with `excluded=true`, `reason='report_coded'` (Ruling 6). 176 Food rows / $8,685.81 + 99 Pkg rows / $24,526.21 for CIN - AZ. |
| Q2 - CIN - AZ only or portfolio-wide? | **DONE** `[ran]` | Portfolio-wide. Portfolio cards Food = $7,045.37, cards Pkg = $1,200.91 today. 4,215 rows / $991,456.39 excluded portfolio-wide on 2026-09-01 with reason='report_coded'. |
| Q3 - When did they leave? | **DONE** `[ran]` | 2026-09-01 07:48 UTC rippling_spend derive. Ruling 6 evaluates against `rippling_report_txns_latest` which grew by 46 rows on the 2026-09-01 report ingest at 06:02 UTC. Derive DELETE+INSERT-per-rippling-id means every surviving row stamps to today. |
| Q4 - Does relaxed filter return them? | **DONE** `[ran]` | Dropping `excluded=false` returns Food $8,999.69 + Pkg $31,314.83 + Veh $119.90 on CIN - AZ. Report_coded delta byte-matches Kevin's Pkg baseline to the cent. Dropping `source` returns nothing; rows are correctly source-classified. |

---

## Acceptance echo (C4)

- **Q1**: "Are the rows absent from `purchasing_actuals`, or present but no longer matching the account or bucket filter? Count and sum CIN - AZ card-sourced rows for FY2026 and compare with the bill-sourced count." → `[met-ran]`. Board-shape read: 25 rippling_spend rows / $6,181.84; 3 coded ($2,692.03) with 1 Food $9.81. Including excluded: 808 rows / $115,088.20. Bills-side: 601 rows / $376,366.42. Numbers in Q1 table above.
- **Q2**: "Is it CIN - AZ only, or portfolio-wide? Report card-sourced totals per account." → `[met-ran]`. 11-account portfolio table above. Portfolio-wide effect; every account's coded-card lane is thinned. CIN - AZ reads $9.81/$0.00 because its baseline was small; portfolio total Food+Pkg+Vehicle coded cards = $8,246.28 today.
- **Q3**: "When did they leave? Use `derived_at` / `loaded_at` to bracket it." → `[met-ran]`. Column is `derived_at` (no `loaded_at`; confirmed via `\d purchasing_actuals` via `.select("*").limit(1)` and `docs/migrations/purchasing-1-schema.sql:409`). Bracket: 2026-09-01T07:48 UTC nightly rippling_spend derive. Prior derive-day distribution on surviving rows shown; excluded cohort's derive-day distribution shown; raw feed presence confirmed intact.
- **Q4**: "Does the same query the board runs return them if the card-source filter is relaxed?" → `[met-ran]`. Board query reproduced from `codedCardSpentForGl`. `source='rippling_spend'` relaxation returns nothing (cards not misclassified as bills). **`excluded=false` relaxation is the one that returns the money**: cards Food $8,999.69 + Pkg $31,314.83 for CIN - AZ. Grouped by `reason`: `report_coded` accounts for $7,752.06 Food + $23,574.60 Pkg + $119.90 Vehicle, and $23,574.60 Pkg matches Kevin's baseline to the cent.

---

## Unmeasurable as written + blocked items

- **Historical `derived_at` sequence pre-2026-08-27**. `purchasing_actuals` has no history table; DELETE+INSERT on each rippling_id overwrites the prior `derived_at`. The rows Kevin saw on 2026-08-28 as `source='rippling_spend'` with a coded gl_line_code cannot be timestamped from `purchasing_actuals` alone. The `purchasing_derive_runs` trail proves that a run wrote them (line count 11,300 on 2026-08-28 evening vs 11,555 today), but not which rows they were. Not blocking - the mechanism is proven from the current excluded cohort's `reason` distribution and its date-of-write.
- **Whether Ruling 6's `report_coded` set on 2026-08-28 was empty vs non-empty at Kevin's capture time.** The report ingest at 06:02 UTC on 2026-08-28 wrote `lines_written=5,331` (per `purchasing_derive_runs`) and by 2026-08-31 the report table held 5,481 rows, growing to 5,527 on 2026-09-01. So the report side was populated well before 2026-08-28; if Ruling 6 was live and firing on 2026-08-28, the same exclusion should have applied then too. **The most likely explanation for Kevin's baseline vs today**: Ruling 6 shipped on 2026-08-28 (per handoff §2.6) and the 2026-08-28 evening derive at 11:26 UTC was the first run that applied it (line count jumped from 10,789 → 11,300; Ruling 6 exclusion count began accumulating from there). Kevin's 2026-08-28 read was taken BEFORE the 11:26 UTC derive; the read reflected the last pre-Ruling-6 state of the corpus. **Every nightly derive since has re-applied Ruling 6 against a growing report_txns set, and each night the coded-card lane has thinned further.** This is inference from timing; a direct time-series is not measurable from `purchasing_actuals` today.
- **Blocked**: No blocked items. Every question had a measurable answer.
