# Service Calendar Spreadsheet -> Postgres Mapping

> **Money-model claims in this doc are SUPERSEDED by [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md)
> (2026-07-09 alignment).** The 2026-06-15 ruling that "the canonical `sc_service_prices`
> entry should be the projection-tab price (the bill rate)" - see line 66-area comment
> below - was correct-at-authoring against the sheet-era model, but became stale on
> 2026-06-16 when Kevin ran an out-of-band SQL correction (per Price Review v3, Joe-
> reviewed) moving `sc_service_prices` to the actuals-tab post-SF invoice rate. That is
> the current authoritative value. See SC_MONEY_MODEL.md §(a) + §(b) for the settled
> model and `SC_MONEY_ALIGNMENT_REPORT.md` Part 4 for the timeline. This doc remains
> authoritative for sheet layout, column indexes, and tab structure.

Review doc for the sc-1 Service Calendar import. Inspected 11 .xlsx files at
`/Users/kevinfietek/Documents/Claude /Service Calendars/` (note the trailing
space in the parent folder name). One section per `account_key`, sorted
alphabetically. No import script is included; this is a mapping reference
only.

**Pinned workbook hashes** (2026-09-02, for the seed + fill scripts in
`scripts/billing/`; workbooks copied into `scripts/billing/inputs/`):

- TBJ - FL (`tbj-fl-sc-2026-v5.xlsx`):
  `d153c4c6f52ec408185693d4b4489efe7a5df857d2ad45c573b7c50ee581e15a`
- TBR - FL (`tbr-fl-sc-2026-v5.xlsx`, **post-Kevin-rename of Projections tab
  Y2/AA2**):
  `540b9b7839c385a1dc1d1aa615251fcab1ba47b5d6f66734e4dbed55f1820fc5`
  (previous pre-rename value `c3466de84ffb42e104982d7e7aafdd9d7f8f99f461bebfef5fab9c37fa843dec` is stale)

Any script reading these workbooks must hash-gate on the pinned value and halt
on mismatch. If Kevin edits either workbook again (spreadsheet renames,
column shifts, cell corrections), the hash changes and the pinned constant
in the script must be bumped in the same PR that lands the edit.

## Conventions used throughout this doc

- Column letters refer to the Excel column letter (A, B, ..., AJ, AK, ...).
- Column index is 1-based to match `openpyxl.cell(row=r, column=c)`.
- Price cells appear in the column immediately to the right of the service-name
  cell on header row 2 (the price label IS the numeric price; not a header).
  The importer should treat each (name_col, price_col) as one service entry.
- "Period" column semantics differ between projections and actuals:
  - Projections sheets use integer or `N.0` periods (1, 2, 3, ... or 1.0, 2.0).
  - Actuals sheets use decimal periods (1.1, 1.2, 1.3, 1.4) representing the
    sub-week within period 1, etc. Confirmed across 9 of 11 accounts.
- Dates are Excel native datetimes (openpyxl returns `datetime.datetime`),
  not strings. They start at 2025-12-29 (a Monday) and run through 2026-12-20
  (357 days) for almost all sheets; TBR-FL B&G runs to 2026-12-29 (366 days).
- "Blank" placeholder columns at $0 in row 2 are deliberate spare slots the
  field teams can fill in mid-season. They should be detected and skipped
  by the importer.
- All accounts share the same calendar shell: **12 periods of 4 weeks + 1
  three-week P13 = 51 weeks = 357 days**, running 2025-12-29 through
  2026-12-20. The Week label resets to `Week 1` at the start of each Period.
  (Corrected 2026-08-01. The prior "13 periods of 4 weeks each = 52 weeks =
  364 days, padded to 357-366" line was internally inconsistent - measured
  P1-P12 are exactly 28 days each and P13 as authored on 10 accounts is
  21 days, summing to the doc's own 357-day total. TBR-FL's B&G subtab
  extension to 2026-12-29 is a workbook artifact, not a P13 length claim.
  See sc-25 migration + prior recon `SC_STATUS.md` P13-tail probe.)

---

## CIN - AZ

### 1. File identification

- Filename: `REDS AZ - Service Calendar 2026 (4).xlsx`
- Tab/sheet names:
  - `Goodyear, AZ - Projected Number` (projections)
  - `Goodyear, AZ - 2026 - Actuals` (actuals)
  - `Goodyear, AZ - 2026 - Clicker C` (clicker counts; empty in this file)
- Account key: `CIN - AZ` (Cincinnati Reds spring training, Goodyear, AZ; PDC,
  billing model `actuals_drive_invoice`)

### 2. Header structure

- Row 1: service GROUP headers (`Major League`, `Minor League`, `Rehab`,
  `TOTALS`). Title text `Cincinnati Reds @ Goodyear, AZ` sits in A1.
- Row 2: service NAMES + PRICES interleaved (name in col N, price in col N+1).
- Row 3: first data row (2025-12-29 Mon).
- Total header rows: 2.

### 3. Metadata columns (left side)

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day of week (`Mon`, `Tue`, ... `Thurs` w/ extra `s`) | string |
| 2 | B | Date | Excel datetime, 2025-12-29 .. 2026-12-20 |
| 3 | C | Period | int 1..13 in projections; float 1.1..13.4 in actuals |
| 4 | D | Week | string `Week 1` .. `Week 4`. One stray row has `Proposed Increase`. |
| 5 | E | Camp Name | string. Values: `OFF`, `MLB ST`, `ST`, `Early Camp`, `Bridge`, `Extended`, `Instructs/Camps`, `ACL`. Maps to `sc_day_metadata.event_label`. |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| F | Major League | Breakfast | 29.00888 | false | false | Projections-tab price = sticker rate = reference / planning only. Actuals-tab price ($20.31 for CIN-AZ MLB Breakfast) = post-SF invoice rate = what's billed per meal. **Note (2026-06-16): the "canonical `sc_service_prices` entry should be 29.00888" ruling below was SUPERSEDED by Price Review v3.** Today's canonical entry is $20.31 (post-SF invoice rate); see [SC_MONEY_MODEL.md](SC_MONEY_MODEL.md). The original text of this cell is retained above for archaeological reference; the historical mapping (column F -> 29.00888) still identifies the correct SHEET cell to read during a fresh import, but the value stored in PG post-correction is the actuals-tab rate. |
| H | Major League | Lunch | 29.00888 | false | false | same dual-price pattern |
| J | Major League | Dinner | 29.00888 | false | false | |
| L | Minor League | Breakfast | 18.42147 | false | false | distinct service from MLB Breakfast |
| N | Minor League | Lunch | 18.42147 | false | false | |
| P | Minor League | Dinner | 18.42147 | false | false | |
| R | Minor League | Pre-Game Snack | 7.31456 | false | false | |
| T | Minor League | Coffee Service (tax-free) | 511.05293 | true | true | bundled coffee service flat fee |
| V | Minor League | Fountain Bev (tax-free) | 283.91714 | true | true | bundled beverage flat fee |
| X | Rehab | Continental Plus | 9.08086 | false | false | |
| Z | Rehab | Breakfast | 18.42147 | false | false | distinct from MLB/MiLB Breakfast (same name, different group + same price as MiLB) |
| AB | Rehab | Lunch | 18.42147 | false | false | |
| AD | Rehab | Dinner | 18.42147 | false | false | |

### 5. Totals / calculated columns to SKIP

- AF (32) Total Revenue
- AG (33) Total Meals
- AH (34) Total Bev Services
- AI (35) Total Charged Items
- AJ (36) Average $/Item

### 6. Data quality observations

- Projections sheet: actuals-flavored cells. 262 of 357 days have at least one
  non-zero projection. Sum of projected units = 77,702 across the year (plausible).
- Actuals sheet: 129 of 357 days have non-zero entries; last entry 2026-06-08.
  Imports through early June 2026 only.
- Clicker C sheet: zero data populated. Skip entirely or ignore unless field
  team starts using it.
- Note the day-of-week label is `Thurs` (5 letters) instead of `Thu` / `Thursday`.
  Not used downstream.

### 7. Row counts

- Projections data rows: 357. Rows with non-zero service data: 262. Date range
  2025-12-29 -> 2026-11-13 (last populated).
- Actuals data rows: 357 (rows exist). Rows with any value: 168. Rows with
  non-zero: 129. Last entry 2026-06-08.
- Clicker sheet: 357 rows, zero populated.

---

## CIN - KY

### 1. File identification

- Filename: `Louisville Bats Service Calendar - 2026 (2).xlsx`
- Tab/sheet names:
  - `Louisville - 2026 - Projections`
  - `Louisville - 2026 - Actuals`
- Account key: `CIN - KY` (Louisville Bats AAA affiliate; tier AAA,
  billing model `actuals_drive_invoice`) [updated 2026-06-15: moved from
  `projections_drive_invoice` after billing model review; the 11-account
  split is now 6/1/4]

### 2. Header structure

- Row 1: group headers (`Louisville Bats`, `TOTALS`). Title `Bats @ Louisville, KY` in A1.
- Row 2: service names + prices.
- Row 3: first data row (2025-12-29 Mon).
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | int 1..13 (both projections AND actuals; this account does NOT use the 1.1, 1.2 sub-period pattern) |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Homestand | string (largely blank in this 2026 cut); maps to `sc_day_metadata.week_label` or a homestand label - confirm intent |
| 6 | F | Game Type | string. Values: `OFF`, `NIGHT`, `DAY`. One stray lowercase `Night`. Maps to `sc_day_metadata.game_type`. |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| G | Louisville Bats | Breakfast | 25.95422 | false | false | |
| I | Louisville Bats | Lunch | 25.95422 | false | false | |
| K | Louisville Bats | Post-Game | 25.95422 | false | false | |
| M | Louisville Bats | Umpire | 25.95422 | false | false | |
| O | Louisville Bats | Snack | 8.64448 | false | false | |

### 5. Totals / calculated columns to SKIP

- Q (17) Total Revenue
- R (18) Total Meals
- S (19) Total Snacks
- T (20) Total Charged Items
- U (21) Average $/Item

### 6. Data quality observations

- Stray value `Night` (mixed case) in Game Type alongside `NIGHT`. Importer
  should uppercase-normalize before insert.
- Homestand column is empty for this 2026 cut; reserved space.
- Single group sheet (no MLB/MiLB split).

### 7. Row counts

- Projections data rows: 189 (note: only 189 not 357 - this file's data range
  is shorter than spring-training PDC accounts).
- Projections rows with non-zero values: 75. Date range 2025-12-29 .. 2026-09-13.
- Actuals data rows: 189. Rows with non-zero: 0. **No actuals entered for 2026.**

---

## CIN - OH

### 1. File identification

- Filename: `Cincinnati Reds MLB Service Calendar - 2026 (2).xlsx`
- Tab/sheet names:
  - `Cincinnati Reds - MLB - 2026 - ` (projections; trailing space)
  - `Sheet1` (duplicate of the projections sheet, blank service data)
- Account key: `CIN - OH` (Cincinnati Reds MLB; tier MLB, billing model
  `projections_drive_invoice`)

### 2. Header structure

- Row 1: group headers (`Cincinnati Reds`, `TOTALS`). Title `Cincinnati Reds @ Cincinnati, OH` in A1.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | int 1..13 (no actuals sub-period variant exists here) |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Game Type | string `Home`, `Away`, `OFF` (102 Away, 79 Home, 7 OFF) |
| 6 | F | Game Time | string (game start time when applicable) |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| G | Cincinnati Reds | Arrival | 25.95422 | false | false | |
| I | Cincinnati Reds | Post BP | 25.95422 | false | false | Post-batting-practice meal |
| K | Cincinnati Reds | Post-Game | 25.95422 | false | false | |
| M | Cincinnati Reds | Umpire | 25.95422 | false | false | |

### 5. Totals / calculated columns to SKIP

- Q (17) Total Revenue
- R (18) Total Meals
- S (19) Total Snacks
- T (20) Total Charged Items
- U (21) Average $/Item
- Cols O (15) and P (16) are blank gap-cells between services and totals - skip.

### 5b. Tabs to SKIP entirely

- `Sheet1` is an empty duplicate of the projections sheet, no service data.
  Treat as scratch; do not import.

### 6. Data quality observations

- No dedicated actuals tab exists for this account. Per billing model
  (`projections_drive_invoice`), actuals may not be required at all.
- Single sheet layout matches STL - MO, TXR - TX - H, TXR - TX - V (MLB
  accounts).

### 7. Row counts

- Projections data rows: 189. Rows with non-zero: 79. Date range
  2025-12-29 .. 2026-09-20. Reflects MLB regular-season window.
- No actuals sheet.

---

## STL - FL

### 1. File identification

- Filename: `STL - Jupiter, FL - Service Calendar - 2026 (4).xlsx`
- Tab/sheet names:
  - `Jupiter - 2026 - Projections` (primary projections tab)
  - `Jupiter - 2026 - Actuals`
  - `Jupiter - 2026 - Projections Br` (likely "Projections Breakdown" - alternate
    projection with renamed services; see notes)
- Account key: `STL - FL` (St. Louis Cardinals Jupiter, FL spring training,
  PDC, billing model `flat_fee`)

### 2. Header structure

- Row 1: group headers (`MLB`, `MiLB`, `Palm Beach Cardinals`, `Fun Money`,
  `TOTALS`). Title `STL Cardinals @ Jupiter, FL` in A1.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | int 1..13 (projections); float 1.1..13.4 (actuals) |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Homestand | mostly blank in this 2026 cut |
| 6 | F | Game Type | mostly blank in this 2026 cut |

### 4. Service mapping table (Projections tab)

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| G | MLB | Breakfast - ST | 40 | false | false | "ST" = spring training |
| I | MLB | Lunch - ST | 40 | false | false | |
| K | MiLB | Breakfast - ST | 40 | false | false | |
| M | MiLB | Lunch - ST | 40 | false | false | |
| O | MiLB | Breakfast | 26 | false | false | post-ST minor league rate |
| Q | MiLB | Lunch | 26 | false | false | |
| S | MiLB | Snack | (blank price) | false | false | **price missing** - human decision needed |
| U | Palm Beach Cardinals | Arrival | 26 | false | false | (Actuals tab spells this `Breakfast` instead - service-name drift) |
| W | Palm Beach Cardinals | Pre-game | 26 | false | false | |
| Y | Palm Beach Cardinals | Post-Game | 26 | false | false | |
| AF | Fun Money | Fun Money allocation | 25000 | false | true | annual flat allocation budget |

### 4b. Service mapping addendum (Projections Br tab variant)

This third sheet uses slightly different service names for the right-half:

- col S "SNACK - FCL" instead of "Snack"
- col U "Arrivals " (trailing space) instead of "Arrival"
- col W "Pre-game/ SNACK" instead of "Pre-game"

Recommend importing only the primary `Jupiter - 2026 - Projections` tab and
ignoring `Projections Br` unless a human confirms it supersedes.

### 5. Totals / calculated columns to SKIP

- AG (33) Total Revenue
- AH (34) Total Meals
- AI (35) Total Snacks
- AJ (36) Total Charged Items
- AK (37) Average $/Item
- T (20), Z (26), AA (27), AB (28), AC (29), AD (30) - blank/gap columns
- AE (31) is the "Fun Money" group header but the price col is AF (32)

### 6. Data quality observations

- Service-name drift between Projections and Actuals tabs (`Arrival` vs
  `Breakfast` in column U). Use the projection tab as canonical for
  `sc_services`; map actuals col U to the same service_id regardless.
- Three projection-like tabs in one file. Confirm intent: is "Projections Br"
  a deprecated alternate, or the new canonical? Currently `Projections Br`
  has slightly higher unit totals (72,190 vs 65,740).
- Billing model is `flat_fee` per the account table - check whether anything
  beyond `Fun Money` needs to feed an invoice projection.
- Snack column S has no listed price in row 2.

### 7. Row counts

- Projections (primary): 357 data rows, 279 with non-zero, last 2026-11-20.
- Actuals: 357 data rows. Rows with non-zero: 65. Last entry 2026-05-31.
- Projections Br: 357 data rows, 281 with non-zero, last 2026-11-20.

---

## STL - MO

### 1. File identification

- Filename: `St. Louis Cardinals MLB - Service Calendar - 2026 (3).xlsx`
- Tab/sheet names:
  - `St. Louis MLB - 2026 - Projecti` (projections; sheet name is truncated by Excel's 31-char limit)
  - `St. Louis MLB - 2026 - Actuals`
- Account key: `STL - MO` (St. Louis Cardinals MLB; tier MLB,
  billing model `projections_drive_invoice`)

### 2. Header structure

- Row 1: group headers (`St. Louis Cardinals`, `TOTALS`). Title `St. Louis Cardinals @ St. Louis, MO` in A1.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | int 1..13 (BOTH tabs use int - no decimal sub-period here) |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Game Type | `Home` (81), `Away` (103), `OFF` (5) |
| 6 | F | Game Time | string |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| G | St. Louis Cardinals | Arrival | 25.95422 | false | false | |
| I | St. Louis Cardinals | Post BP | 25.95422 | false | false | |
| K | St. Louis Cardinals | Post-Game | 25.95422 | false | false | |
| M | St. Louis Cardinals | Umpire | 25.95422 | false | false | |

### 5. Totals / calculated columns to SKIP

- Q (17) Total Revenue
- R (18) Total Meals
- S (19) Total Snacks
- T (20) Total Charged Items
- U (21) Average $/Item
- Cols O (15), P (16) blank gap columns.

### 6. Data quality observations

- Actuals tab has zero non-zero entries. Per `projections_drive_invoice`
  billing model, actuals may be intentionally unmaintained for STL - MO.
- Identical structural layout to CIN - OH, TXR - TX - H, TXR - TX - V.

### 7. Row counts

- Projections data rows: 189. Rows with non-zero: 81. Date range
  2025-12-29 .. 2026-09-20.
- Actuals data rows: 189. Rows with non-zero: 0.

---

## TBJ - FL

### 1. File identification

- Filename: `TBJ FL - Service Calendar - 2026 (4).xlsx`
- Tab/sheet names:
  - `TBJ - Projections - 2026`
  - `TBJ - Actuals - 2026`
  - `TBJ - Clicker Count - 2026`
- Account key: `TBJ - FL` (Toronto Blue Jays PDC Dunedin, FL; PDC,
  billing model `actuals_drive_invoice`)

### 2. Header structure

- Row 1: group headers (`Major League - PDC`, `Minor League - PDC`,
  `Single A Jays`, `SSM`, `Other`, `TOTALS`). Title `Toronto Blue Jays - PDC - Dunedin, FL` in A1.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | int 1..13 (projections); float 1.1..13.4 (actuals + clicker) |
| 4 | D | Week | `Week 1` .. `Week 4`; one row `Proposed Increase` |
| 5 | E | Camp Name | string |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| F | Major League - PDC | Breakfast | 23.11775 | false | false | |
| H | Major League - PDC | Lunch | 23.11775 | false | false | |
| J | Major League - PDC | Dinner | 23.11775 | false | false | |
| L | Major League - PDC | Umpire | 23.11775 | false | false | |
| N | Major League - PDC | Post Game Meal | 23.11775 | false | false | |
| P | Major League - PDC | Snack | 1.704 | false | false | |
| R | Minor League - PDC | Breakfast | 11.55368 | false | false | |
| T | Minor League - PDC | Lunch | 11.55368 | false | false | |
| V | Minor League - PDC | Dinner | 11.55368 | false | false | |
| X | (Single A Jays) | Blank | 0 | - | - | placeholder, DO NOT import |
| Z | (Single A Jays) | Blank | 0 | - | - | placeholder, DO NOT import |
| AB | (Single A Jays) | Blank | 0 | - | - | placeholder, DO NOT import |
| AD | Single A Jays | Breakfast | 16.50971 | false | false | |
| AF | Single A Jays | Pre-Game | 16.50971 | false | false | |
| AH | Single A Jays | Post-Game | 16.50971 | false | false | |
| AJ | SSM | Stadium Staff Meals | 16.50971 | false | false | |
| AL | Other | Fun $$$$ Allocated | 28472.756 | false | true | annual flat allocation |
| AN | Other | Media Meals | 16 | false | false | (projections only) |
| AP | Other | MLB G&G - Pantry | 1.704 | false | false | G&G = Grab & Go |
| AR | Other | MiLB G&G - Pantry | 1.704 | false | false | |
| AT | Other | MLB - Catering | 38 | false | false | |
| AV | Other | Team Canada | 11.55368 | false | false | |

### 4b. Actuals tab adds these services (not present in Projections)

| Column | Group Name | Service Name | Price | Notes |
|---|---|---|---|---|
| AL | Other | Florida Ops - PDC | 11.55 | actuals-only - confirm if real service or duplicate |
| AP | Other | Scout Meals | 11.55 | actuals-only |
| AR | Other | Media Meals | 15 | duplicates projections "Media Meals" at $16 but with different price - needs reconciliation |

Service set diverges between Projections and Actuals tabs - a single canonical
service list must be agreed before import.

### 5. Totals / calculated columns to SKIP

Projections tab (54 cols total):
- AX (50) Total Revenue
- AY (51) Total Meals
- AZ (52) Total Snacks
- BA (53) Total Charged Items
- BB (54) Average $/Item

Actuals tab (58 cols total):
- BB (54) Total Revenue
- BC (55) Total Meals
- BD (56) Total Snacks
- BE (57) Total Charged Items
- BF (58) Average $/Item

### 6. Data quality observations

- **Projections vs Actuals tab service definitions differ**. Actuals tab has
  4 extra service columns inserted in the "Other" group. Importer must map
  each tab's columns to canonical service IDs explicitly, not by position.
- Three "Blank" placeholder columns sit in the Single A Jays group (X, Z, AB).
- Most rows have empty `Camp Name`; only special days are labeled.
- "Fun $$$$ Allocated" is the same conceptual service as STL - FL's
  "Fun Money" allocation - both flat allocations.

### 7. Row counts

- Projections data rows: 357. Rows with non-zero: 289. Last entry 2026-12-11.
- Actuals data rows: 357. Rows with non-zero: 156. Last entry 2026-06-21
  (mid-season).
- Clicker Count data rows: 357. Rows with non-zero: 68. Last 2026-03-25
  (used for spring training only, then abandoned).

---

## TBJ - NY

### 1. File identification

- Filename: `TBJ BUF - Service Calendar - 2026 (1).xlsx`
- Tab/sheet names:
  - `Buffalo - Projections - 2026`
  - `Buffalo - Actuals - 2026`
- Account key: `TBJ - NY` (Buffalo Bisons; AAA affiliate of TBJ,
  billing model `actuals_drive_invoice`)

### 2. Header structure

- Row 1: group headers (`Buffalo Bisons`, `Other`, `TOTALS`). Title `Buffalo Bisons @ Buffalo, NY` in A1.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | float 1.0..13.0 (projections); float 1.1..13.4 (actuals) |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Game Type | `OFF` (110), `NIGHT` (45), `DAY` (30) |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| F | Buffalo Bisons | Breakfast | 27.34 | false | false | |
| H | Buffalo Bisons | Lunch | 27.34 | false | false | |
| J | Buffalo Bisons | Post-Game | 27.34 | false | false | |
| L | Buffalo Bisons | Umpire | 27.34 | false | false | |
| N | Buffalo Bisons | Snack | 0 | false | false | **price $0** - confirm whether real service or placeholder |
| P | Buffalo Bisons | Shake | 0 | false | false | **price $0** - confirm |
| R | (Other) | Blank | 0 | - | - | placeholder, DO NOT import |
| T | (Other) | Blank | 0 | - | - | placeholder, DO NOT import |
| V | (Other) | Blank | 0 | - | - | placeholder, DO NOT import |
| X | (Other) | Blank | 0 | - | - | placeholder, DO NOT import |
| Z | (Other) | Blank | 0 | - | - | placeholder, DO NOT import |
| AB | (Other) | Blank | 0 | - | - | placeholder, DO NOT import |

### 5. Totals / calculated columns to SKIP

- AD (30) Total Revenue
- AE (31) Total Meals
- AF (32) Total Snacks
- AG (33) Total Charged Items
- AH (34) Average $/Item

### 6. Data quality observations

- Snack and Shake have price 0 - data quality decision: import as services
  with `price = 0` (placeholders that may be priced later), or omit?
- Six "Blank" placeholder columns under `Other` group reserve future services.

### 7. Row counts

- Projections data rows: 189. Rows with non-zero: 63. Last entry 2026-09-19.
- Actuals data rows: 189. Rows with non-zero: 33. Last entry 2026-06-14.

---

## TBR - FL

### 1. File identification

- Filename: `Tampa Bay Rays Service Calendar - 2026 (3).xlsx`
- Tab/sheet names:
  - `Projections TBR-2026`
  - `TBR-2026 - Actuals`
  - `Clicker Count -2026 ` (trailing space)
  - `  Projections B&G-2026` (leading double space)
  - `B&G-2026 - Actuals`
- Account key: `TBR - FL` (Tampa Bay Rays PDC Port Charlotte, FL; PDC,
  billing model `actuals_drive_invoice`)

### 2. Header structure

- **Projections tab: 2 header rows.** Row 1 = group headers (`Major League`,
  `Minor League`, `Other`, `TOTALS`). Title `Tampa Bay Rays @ Port Charlotte,
  FL`. Row 2 = service names + prices interleaved. Row 3 = first data row.
- **Actuals tab: 3 header rows** (amendment 2026-09-02). Row 1 = group
  headers (same as projections). Row 2 = a stray real data row (a single
  out-of-order date sitting above the header block; Kevin ruled skip during
  the PR-S seed but the row IS real service data, so PR-V's fill loaded it
  explicitly for 2026-08-03). Row 3 = service names + prices (this is the
  header row the parser reads for name-to-column lookup). Row 4 = first
  normal-order data row (2025-12-29 Mon Week 1).
- **Actuals tab uses column A for Date, not column B**, and the Title text
  sits in C1, shifting all data left by 1 column compared to the Projections
  tab. Importer must use column-by-name lookup per tab AND must skip the
  right number of header rows per tab (2 for Projections, 3 for Actuals).
  The stray row 2 on the actuals tab is legitimate data - if a future re-import
  wants full coverage it needs a per-row date scan, not a "skip N header rows"
  shortcut.

**Amendment 2026-09-02 (Kevin's rename):** the Projections tab columns Y and
AA were originally labeled `Breakfast - MiLB ST` and `Lunch - MiLB ST` and
fed distinct "ST twin" `sc_services` rows. The ST twins were an import
artifact: the June 2026 bulk loader read the projections tab's names verbatim
and created `Breakfast - MiLB ST` + `Lunch - MiLB ST` alongside the actuals
tab's `Breakfast - MiLB` + `Lunch - MiLB`. The twins never received a field
count (actuals only ever flow to the non-ST rows). Kevin renamed the
Projections tab headers on 2026-09-02 - `Y2 = "Breakfast - MiLB"` at
`$17.8275`, `AA2 = "Lunch - MiLB"` at `$21.675` - so both tabs feed one
service per column. The ST twin `sc_services` rows are archived
(`active_until = 2026-01-01`) and their 714 orphaned `sc_daily_projections`
rows deleted 2026-09-02. Never re-create the twins on a future re-import.

### 3. Metadata columns (Projections tab)

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | int 1..13 (projections); decimal 1.1..13.4 (actuals); both formats present across the two tabs |
| 4 | D | (blank gap column - row 2 label is empty) | - |
| 5 | E | Week | `Week 1` .. `Week 4` |
| 6 | F | Camp Name | string. Values: `OFF`, `FCL`, `Camps`, `Bridge`, `ST`, `Extended`, `Rehab`, `FCL/C`. |

### 3b. Metadata columns (Actuals tab) - SHIFTED LAYOUT

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Date | (NOTE: not Day) |
| 2 | B | Period | float 1.1..13.4 |
| 3 | C | (title text in row 1, gap in rows 3+) | - |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Camp Name | |

### 4. Service mapping table (Projections tab)

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| G | Major League | Breakfast | 35.62731 | false | false | |
| I | Major League | Lunch | 39.482 | false | false | |
| K | Major League | Dinner | 39.482 | false | false | |
| M | Major League | Umpire Meal | 39.482 | false | false | |
| O | Major League | Extra Protein - Chicken/Pork | 111.83796 | false | true | per-pan flat add-on |
| Q | Major League | Extra Protein - Beef/Seafood | 162.16712 | false | true | per-pan flat add-on |
| S | Major League | MLB - Extra MTO - Sm | 5 | false | false | MTO = made-to-order |
| U | Major League | MLB - Extra MTO - Med | 10 | false | false | |
| W | Major League | MLB - Extra MTO - Lrg | 15 | false | false | |
| Y | Minor League | Breakfast - MiLB ST | 23.77 | false | false | spring training rate |
| AA | Minor League | Lunch - MiLB ST | 28.9 | false | false | |
| AC | Minor League | Road Sandwiches - MiLB | 15 | false | false | |
| AE | Minor League | Dinner | 27.94910 | false | false | post-ST MiLB rate |
| AG | Minor League | AFTER HOURS MEALS | 27.94910 | false | false | |
| AI | Minor League | Extra Protein - Chicken/Pork | 111.83796 | false | true | distinct from MLB protein |
| AK | Minor League | Extra Protein - Beef/Seafood | 162.16712 | false | true | |
| AM-AW | (Other) | Blank x 6 | 0 | - | - | placeholders, DO NOT import |

### 4b. Service mapping (Actuals tab - DIFFERENT layout)

The actuals tab uses slightly different services and different price columns
(actuals carries cost-basis pricing approx half of projection pricing for
MiLB items). Notable differences:

- "Umpire Meal" column from projections is NOT present in actuals.
- "Breakfast - MiLB ST" -> "Breakfast - MiLB" (no `ST`) at price 17.8275 (cost basis vs 23.77 retail).
- "Lunch - MiLB ST" -> "Lunch - MiLB" at price 21.675.
- "Dinner" MiLB at price 20.961825 (cost basis).
- New column "Extended Day labor" at $280 (flat fee, per-day allocation).

### 4c. B&G service mapping (separate revenue stream)

The `  Projections B&G-2026` and `B&G-2026 - Actuals` tabs cover the Charlotte
County Boys & Girls Club catering relationship - a separate revenue stream
from the Rays clubhouse operation. Layout:

| Col | Letter | Field | Notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | int 1..13 (additional 12 and 13 with 29-30 days each = full calendar year) |
| 4 | D | Lunch | service column |
| 5 | E | (price 6.5) | $6.50 per lunch |
| 6 | F | Total Revenue | SKIP (calculated) |
| 7 | G | Holiday | metadata field. Values: `Christmas`, blank, ... maps to `sc_day_metadata.event_label` |

Single service: `B&G Lunch` at $6.50, tax-free? Unclear, default false.

Recommendation: model B&G as its own service group (`Boys & Girls Club`)
under the same `account_key` `TBR - FL`, OR as a separate account_key. The
account_key table doesn't list one, so default to a separate group within
TBR - FL.

### 5. Totals / calculated columns to SKIP

Projections tab:
- AY (51) Total Revenue
- AZ (52) Total Meals
- BA (53) Total Extras
- BB (54) Total Charged Items
- BC (55) Average $/Item

Actuals tab:
- AX (50) Total Revenue
- AY (51) Total Meals
- AZ (52) Total Extras
- BA (53) Total Charged Items
- BB (54) Average $/Item

Clicker Count tab:
- Y (25) Total
- Plus 6 "Blank" placeholder columns (M-X)

B&G tabs:
- F (6) Total Revenue

### 6. Data quality observations

- **TBR-2026 Actuals: sum of "units" across rows = 1,435,964.77** which is
  wildly inflated for unit counts. Strongly suggests the actuals tab cells
  contain dollar revenue (price * qty) rather than unit counts. **Human
  decision required**: is the actuals tab storing units or revenue? If
  revenue, the importer cannot insert into `sc_daily_actuals.actual_count`
  without a divisor.
- Actuals tab has a SHIFTED column layout (Date in col A, not B) - must use
  per-tab column mapping, not a global one.
- Projections tab uses MiLB ST prices (23.77/28.9) while Actuals uses MiLB
  non-ST prices (17.83/21.68). Confirm whether these are distinct services
  or one service whose price changes mid-season.
- Clicker Count tab uses an entirely different service list (Breakfast,
  Lunch, Breakfast - Pavilion, Lunch - Pavilion, Breakfast - Dining Room,
  Lunch - Dining Room) - 6 services not present in either Projections or
  Actuals. Decision needed: ignore clicker tab, or add Pavilion / Dining
  Room services to the canonical service list?
- **B&G is a separate revenue stream** - separate Boys & Girls Club catering
  operation, distinct from the Rays clubhouse. Should be flagged as its
  own service group (or arguably its own customer entity).

### 7. Row counts

- Projections data rows: 357. Rows with non-zero: 259. Last entry 2026-11-20.
- Actuals data rows: 357. Rows with non-zero: 163. Last entry 2026-07-24.
- Clicker Count data rows: 357. Rows with non-zero: 8. Last 2026-01-30.
- B&G Projections data rows: 366 (full calendar year). Rows with non-zero: 107.
  Last 2026-12-17.
- B&G Actuals data rows: 366. Rows with non-zero: 60. Last 2026-05-28.

---

## TXR - AZ

### 1. File identification

- Filename: `TXR AZ - Service Calendar - 2026 (4).xlsx`
- Tab/sheet names:
  - `Projections - 2026`
  - `Actuals - 2026`
  - `Clicker Counts - 2026`
- Account key: `TXR - AZ` (Texas Rangers spring training, Surprise, AZ; PDC,
  billing model `actuals_drive_invoice`)

### 2. Header structure

- Row 1: group headers (`Major League`, `Minor League`, `Other`, `TOTALS`).
  Title `Texas Rangers @ Surprise, AZ`.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns (Projections tab)

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | float 1.0..13.0 (projections); float 1.1..13.4 (actuals) |
| 4 | D | Week | `Week 1` .. `Week 4`; one row `Proposed Increase` |
| 5 | E | Camp Name | string. Values: `Staff/Rehab`, `Extended`, `ACL`, `Instructs`, `Bridge`, `OFF`, `Home game`, `ST Workouts`. |

### 3b. Metadata columns (Actuals tab - DIFFERENT layout)

The actuals tab is structurally different - it has additional service columns
inserted (Extra Protein), and the Camp Name column E label was wiped to a
single space:

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 5 | E | (header label blank) | values present (Staff/Rehab etc.) - still the Camp Name field, just unlabeled |

### 4. Service mapping table (Projections tab)

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| F | Major League | Breakfast | 35.72125 | false | false | |
| H | Major League | Lunch | 35.72125 | false | false | |
| J | Major League | Dinner | 35.72125 | false | false | |
| L | Minor League | Breakfast | 17.86575 | false | false | |
| N | Minor League | Lunch | 17.86575 | false | false | |
| P | Minor League | Dinner | 17.86575 | false | false | |
| R | Minor League | Continental Breakfast | 8.2 | false | false | |
| T | Minor League | Pre-Game Hot Snack | 13.66325 | false | false | |
| V | Minor League | Regular Snack | 7.3595 | false | false | |
| X-AH | Other | Blank x 6 | 0 | - | - | placeholders, DO NOT import |

### 4b. Actuals tab adds these services (not in Projections)

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| L (Actuals) | Major League | Extra Protein - Chicken/Pork | 115 | false | true | |
| N (Actuals) | Major League | Extra Protein - Beef/Seafood | 165 | false | true | |
| V (Actuals) | Minor League | Extra Protein - Chicken/Pork | 115 | false | true | |
| X (Actuals) | Minor League | Extra Protein - Beef/Seafood | 165 | false | true | |

Actuals tab MLB prices are at cost basis (28.577 vs 35.72125 projection price)
and MiLB at cost basis (14.2926 vs 17.86575).

### 5. Totals / calculated columns to SKIP

Projections:
- AJ (36) Total Revenue
- AK (37) Total Meals
- AL (38) Total Snacks
- AM (39) Total Charged Items
- AN (40) Average $/Item

Actuals (51 cols, different layout):
- AR (44) Total Revenue
- AS (45) Total Meals
- AT (46) Total Snacks
- AU (47) Total Charged Items
- AV (48) Average $/Item

### 6. Data quality observations

- **Projections tab sum of units = 1,738,465** - clearly inflated, probably
  contains revenue or extra-protein per-pan dollar values mixed with meal
  counts. **Human decision required.**
- Actuals tab has DIFFERENT service column layout than projections (extra
  protein columns inserted into the MLB and MiLB groups). The importer must
  resolve each tab's columns to canonical service IDs separately.
- Actuals tab Camp Name column has a single-space header value - data is
  present but the label was wiped.
- Clicker Counts tab matches Projections layout but with cost-basis prices
  (28.577 etc.). Clicker has 137 non-zero rows.

### 7. Row counts

- Projections data rows: 357. Rows with non-zero: 269. Last entry 2026-11-20.
- Actuals data rows: 357. Rows with any value: 161. Rows with non-zero: 137.
  Last entry 2026-06-13.
- Clicker Counts data rows: 357. Rows with non-zero: 137. Last 2026-06-13.

---

## TXR - TX - H

### 1. File identification

- Filename: `Texas Rangers MLB - Home - Service Calendar - 2026 (2).xlsx`
- Tab/sheet names:
  - `Projections`
  - `Sheet1` (blank duplicate)
  - `Sheet2` (blank duplicate; uses integer period vs Projections' decimal)
- Account key: `TXR - TX - H` (Texas Rangers MLB Home; tier MLB,
  billing model `projections_drive_invoice`)

### 2. Header structure

- Row 1: group headers (`Texas Rangers`, `TOTALS`). Title `Texas Rangers - Home @ Arlington, TX`.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | float 1.1..13.4 in Projections (uses decimal sub-periods unlike other MLB accounts); int 1..13 in Sheet2 |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Game Type | `Home` (81), `Away` (95), `OFF` (6) |
| 6 | F | Game Time | string |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| G | Texas Rangers | Arrival | 25.95422 | false | false | |
| I | Texas Rangers | Post BP | 25.95422 | false | false | |
| K | Texas Rangers | Post-Game | 25.95422 | false | false | |
| M | Texas Rangers | Umpire | 25.95422 | false | false | |

### 5. Totals / calculated columns to SKIP

- Q (17) Total Revenue
- R (18) Total Meals
- S (19) Total Snacks
- T (20) Total Charged Items
- U (21) Average $/Item
- O (15), P (16) - blank gap columns

### 5b. Tabs to SKIP entirely

- `Sheet1` and `Sheet2` are empty duplicates. Only import `Projections`.

### 6. Data quality observations

- Identical service list to CIN - OH, STL - MO, TXR - TX - V (the four
  MLB-tier projections-driven accounts share template).
- Projections tab uses decimal `Period` (1.1, 1.2 ...) where the sister
  accounts use integer Period in projections. Importer should normalize.

### 7. Row counts

- Projections data rows: 182. Rows with non-zero: 81. Last entry 2026-09-24.
- No real actuals.

---

## TXR - TX - V

### 1. File identification

- Filename: `Texas Rangers MLB - Visitors - Service Calendar - 2026 (2).xlsx`
- Tab/sheet names:
  - `Texas Rangers MLB V - 2026 - Pr` (projections)
  - `Texas Rangers MLB V- 2026 - Act` (actuals, empty)
- Account key: `TXR - TX - V` (Texas Rangers MLB Visiting clubhouse,
  Arlington, TX; tier MLB, billing model `projections_drive_invoice`)

### 2. Header structure

- Row 1: group headers (`Texas Rangers`, `TOTALS`). Title `Texas Rangers - Visitors @ Arlington, TX`.
- Row 2: service names + prices.
- Row 3: first data row.
- Total header rows: 2.

### 3. Metadata columns

| Col | Letter | Field | Format / notes |
|---|---|---|---|
| 1 | A | Day | string |
| 2 | B | Date | Excel datetime |
| 3 | C | Period | float 1.0..13.0 (projections); float 1.1..13.4 (actuals) |
| 4 | D | Week | `Week 1` .. `Week 4` |
| 5 | E | Game Type | same `Home`/`Away`/`OFF` set as TXR - TX - H |
| 6 | F | Game Time | string |

### 4. Service mapping table

| Column | Group Name | Service Name | Price | is_tax_free | is_flat_fee | Notes |
|---|---|---|---|---|---|---|
| G | Texas Rangers | Arrival | 25.95422 | false | false | |
| I | Texas Rangers | Post BP | 25.95422 | false | false | |
| K | Texas Rangers | Post-Game | 25.95422 | false | false | |
| M | Texas Rangers | Umpire | 25.95422 | false | false | |

Identical to TXR - TX - H, CIN - OH, STL - MO. The group label is "Texas Rangers"
(same string) but the account_key disambiguates Home vs Visitors clubhouse.

### 5. Totals / calculated columns to SKIP

- Q (17) Total Revenue
- R (18) Total Meals
- S (19) Total Snacks
- T (20) Total Charged Items
- U (21) Average $/Item

### 6. Data quality observations

- Actuals tab has zero non-zero entries (per `projections_drive_invoice`
  billing model, actuals may not be required).
- The "Visitors" service group should arguably be named "Texas Rangers - Visitors"
  in PG to distinguish it from `TXR - TX - H`'s "Texas Rangers" group.
  **Human decision required**: rename group, or rely on account_key alone
  to disambiguate?

### 7. Row counts

- Projections data rows: 182. Rows with non-zero: 81. Last 2026-09-24.
- Actuals data rows: 182. Rows with non-zero: 0.

---

## Summary

### IMPORTER WARNING - skip calculated columns

**IMPORTER MUST SKIP calculated columns** (`Total Revenue`, `Total Meals`,
`Total Snacks`, `Total Charged Items`, `Average $/Item`). These contain
dollar amounts and aggregates, not service unit counts. Failure to skip
these was the source of the false blocker flags on TBR - FL and TXR - AZ
in the first pass of this audit (originally reported as "1.4M / 1.7M
sums" - actual service-column sums are 58,907 and 80,680). Column-by-column
inclusion in the import script must be label-driven (read the row-1+row-2
headers per tab and select only cells inside the named service columns).

### Billing model assignment (updated 2026-06-15)

The 11-account split is **6 / 1 / 4**:

- `actuals_drive_invoice` (6): `CIN - AZ`, `TXR - AZ`, `TBJ - FL`,
  `TBR - FL`, `TBJ - NY`, `CIN - KY`
- `flat_fee` (1): `STL - FL`
- `projections_drive_invoice` (4): `TXR - TX - H`, `TXR - TX - V`,
  `STL - MO`, `CIN - OH`

CIN - KY moved from `projections_drive_invoice` to `actuals_drive_invoice`
during the 2026-06-15 review. Update the `accounts.billing_model` seed
when re-running migrations.

### Totals across all 11 accounts

- Account-keys covered: 11 (all PG canonical keys).
- Source xlsx files: 11.
- Source tabs (sheets) across all files: 25 (excluding empty Sheet1/Sheet2
  duplicates: 21 unique data tabs).
- Distinct service groups (deduped by name within an account):
  - CIN - AZ: Major League, Minor League, Rehab = 3
  - CIN - KY: Louisville Bats = 1
  - CIN - OH: Cincinnati Reds = 1
  - STL - FL: MLB, MiLB, Palm Beach Cardinals, Fun Money = 4
  - STL - MO: St. Louis Cardinals = 1
  - TBJ - FL: Major League - PDC, Minor League - PDC, Single A Jays, SSM, Other = 5
  - TBJ - NY: Buffalo Bisons = 1 (Other contains only Blanks)
  - TBR - FL: Major League, Minor League, Other, Boys & Girls Club = 4
  - TXR - AZ: Major League, Minor League = 2 (Other contains only Blanks)
  - TXR - TX - H: Texas Rangers = 1
  - TXR - TX - V: Texas Rangers = 1
  - **Group rows expected in `sc_service_groups`: ~24**
- Distinct services across accounts (deduped within an account by name):
  - CIN - AZ: 13 services (3 MLB + 7 MiLB + 3 Rehab; same Breakfast/Lunch/Dinner
    triplet appears 3 times in different groups but each is its own service)
  - CIN - KY: 5
  - CIN - OH: 4
  - STL - FL: 10 (after dropping the "Snack" cell whose price is blank, 9)
  - STL - MO: 4
  - TBJ - FL: 19 in projections (more in actuals - decision pending)
  - TBJ - NY: 6 (Snack and Shake have $0 prices)
  - TBR - FL: 16 in MLB+MiLB projection tab + 1 B&G Lunch = 17. Actuals tab
    adds "Extended Day labor" so canonical may be 18 once reconciled.
  - TXR - AZ: 9 in projections; actuals adds 4 Extra Protein = canonical 13
    after reconciliation.
  - TXR - TX - H: 4
  - TXR - TX - V: 4
  - **Service rows expected in `sc_services`: ~95-100 once Projections+Actuals
    are reconciled.**

### Estimated row counts per PG table after import

Assumptions: import projections for ALL accounts; import actuals only where
non-zero data exists; one `sc_service_prices` row per service (current price
only).

| Table | Estimated rows | Reasoning |
|---|---|---|
| `sc_service_groups` | ~24 | sum of distinct groups above |
| `sc_services` | ~95-100 | sum of distinct services per account |
| `sc_service_prices` | ~95-100 | one current price per service |
| `sc_daily_projections` | ~22,000 | 11 accounts x ~250 days w/ projections x ~9 avg services per non-OFF day. PDC accounts: ~260 days x 13 svcs; MLB accounts: ~150 days x 4 svcs |
| `sc_daily_actuals` | ~6,000 | only 5 accounts have actuals entered (CIN - AZ, STL - FL, TBJ - FL, TBJ - NY, TBR - FL, TXR - AZ), all stopping mid-season (latest 2026-07-24) |
| `sc_day_metadata` | ~4,200 | 11 accounts x ~357 days = ~3,900-4,200; one row per (account, date) |

### Cross-account observations

- **Shared service-name patterns:** `Breakfast`, `Lunch`, `Dinner`, `Post-Game`,
  `Umpire`, `Arrival`, `Post BP`, `Snack`, `Continental Breakfast`,
  `Pre-Game Snack`, `Extra Protein - Chicken/Pork`, `Extra Protein - Beef/Seafood`.
  Same name often appears in BOTH a Major League AND a Minor League group of
  the same account (different price, distinct service row).
- **Shared group names:** `Major League`, `Minor League` (with and without
  `- PDC` suffix on TBJ - FL), `TOTALS`. The `Other` group is consistently
  used for catch-all flat-fee items or placeholder blanks.
- **Pricing pattern - MLB accounts:** all 4 MLB clubhouse accounts (CIN - OH,
  STL - MO, TXR - TX - H, TXR - TX - V) use IDENTICAL pricing
  ($25.95422 / meal) and IDENTICAL service set (Arrival / Post BP /
  Post-Game / Umpire). This is the standard MLB clubhouse contract.
- **Pricing pattern - AAA accounts:** CIN - KY (Louisville) uses the same
  $25.95422 base. TBJ - NY (Buffalo) uses $27.34. Different rates.
- **Pricing pattern - PDC spring training:** each PDC account has its own
  schedule (CIN - AZ MLB $29.01, TXR - AZ MLB $35.72, TBR - FL MLB $35.63
  & $39.48 mix, TBJ - FL MLB $23.12, STL - FL all $40 for spring training).
- **Projections vs Actuals price drift:** PDC accounts often have a
  cost-basis price on the Actuals tab and a retail-basis price on the
  Projections tab (CIN - AZ MLB $29.01 proj vs $20.31 actuals;
  TXR - AZ MLB $35.72 proj vs $28.58 actuals). The canonical price stored
  in `sc_service_prices` should be the projection (retail) price for
  invoicing; the cost basis is presumably for internal margin tracking
  and is not part of the SC schema.
- **Period semantics drift:** Projections sheets use `1, 2, 3, ...` integers
  (or `1.0`, `2.0` floats); Actuals sheets use `1.1, 1.2, 1.3, 1.4` decimals
  where the fractional part is the week within the period. This is a
  display/labeling convention, not real-time data - both should normalize to
  an integer `period` (1..13) in `sc_day_metadata.period`. The week index is
  redundant with `week_label` (`Week 1` .. `Week 4`).
- **Calendar shell:** All accounts share start date 2025-12-29 (Monday); end
  dates vary (most 2026-12-20, B&G goes to 2026-12-29).

### Issue resolutions (updated 2026-06-15)

All 17 issues are RESOLVED. The importer can proceed.

1. **RESOLVED - TBR - FL actuals are unit counts, not revenue.** The
   original analysis incorrectly summed the `Total Revenue` calculated
   column (col AX, $1,377,057) alongside service data columns. Actual
   service-column sum is 58,907 meal counts. Safe to import.
2. **RESOLVED - TXR - AZ projections sum to 80,680 counts** across
   service columns. The original 1.7M figure included the `Total Revenue`
   column ($1,491,672). Actuals sum to 56,715. Safe to import.
3. **RESOLVED - TBJ - FL service set:** import all services from both
   Projections and Actuals tabs, deduplicated by name within each group.
   `Fun $$$$ Allocated` is `is_non_revenue = true`.
4. **RESOLVED - TBR - FL Umpire vs Extended Day Labor:** both are real
   services. `Extended Day Labor` is `is_flat_fee = true`.
5. **RESOLVED - TXR - AZ Extra Protein:** add to canonical service list.
   These are per-pan charges (count = number of pans ordered).
   `is_flat_fee = true`.
6. **RESOLVED - STL - FL canonical tab:** use the primary
   `Jupiter - 2026 - Projections` tab only. Skip `Projections Br`.
7. **RESOLVED - STL - FL Snack price:** import `Snack` with `price = 0`.
8. **RESOLVED - TBJ - NY Snack and Shake:** import both with `price = 0`.
9. **RESOLVED - TBR - FL Boys & Girls Club:** model as a service group
   `Boys & Girls Club` under `TBR - FL`. Same `account_key`, separate
   billing stream. `B&G Lunch` at $6.50.
10. **RESOLVED - Clicker count data:** do NOT import clicker counts from
    any account.
11. **RESOLVED - TXR - TX - H vs - V group naming:** keep group name
    `Texas Rangers` for both. `account_key` disambiguates them.
12. **RESOLVED - Coffee Service + Fountain Bev:** both are
    `is_tax_free = true` AND `is_flat_fee = true`. The schema allows the
    combination.
13. **RESOLVED - Empty Sheet1 / Sheet2 tabs:** ignore.
14. **RESOLVED - CIN - AZ Clicker C tab:** ignore.
15. **RESOLVED - Period normalization:** normalize to integer (1-13).
    Drop decimal sub-periods. `week_label` carries the week information.
16. **RESOLVED - `Proposed Increase` stray rows:** skip (no valid date).
17. **RESOLVED - Column lookup:** the importer uses label-based column
    mapping per tab. Never hardcoded column letters.
