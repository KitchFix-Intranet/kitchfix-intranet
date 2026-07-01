# SC PDC Developmental Phases - Reference

**Status:** Reference data. This is the source-of-truth catalog of PDC developmental phases for the Service Calendar Phase lens (the PDC work-unit + season lens). It is the seed for the eventual `sc_phases` Postgres table. Strategy and rationale live in `SC_LENS_VISION.md`; this doc holds the facts.

**How this data was sourced:** Two read-only phase recons + a Camp-Name extraction across the legacy SC spreadsheets. The decisive finding: PDC phases are RECORDED in a "Camp Name" column in the spreadsheets, typed per-day by operators, for 3 of the 5 PDCs. Where recorded, read the column (do not infer). Where absent, fall back to meal-signal inference + Kevin confirmation.

---

## The headline finding

**Phases are recorded data for 3 of 5 PDCs.** The earlier meal-count inference work (step-changes in headcount) is REPLACED by reading the recorded Camp Name column for those 3 accounts. For the 2 that do not record, inference + confirmation still applies.

| Account | Phase source | Quality |
|---|---|---|
| CIN-AZ | Camp Name column (Projections + Actuals identical) | CLEAN - zero gaps, zero typos |
| TXR-AZ | Camp Name column (Projections only; Actuals tab lacks the column) | CLEAN macro phases; per-day game labels need normalization |
| TBR-FL | Camp Name column (Projections clean; Actuals adds per-game noise) | Projections CLEAN; use Projections as canonical |
| TBJ-FL | Confirmed simple calendar (meal-signal + TBR-FL peer arc) | CONFIRMED - Kevin-approved 2026-07 |
| STL-FL | Confirmed simple calendar (meal-signal + TBR-FL peer arc) | CONFIRMED - Kevin-approved 2026-07 |

---

## Recorded phase calendars (fiscal 2026)

### CIN-AZ (Cincinnati Reds, Goodyear AZ - Arizona Complex)
Projections and Actuals match exactly.

| start | end | days | camp name |
|---|---|---|---|
| 2025-12-29 | 2026-01-03 | 6 | OFF |
| 2026-01-04 | 2026-01-11 | 8 | Battery Camp |
| 2026-01-12 | 2026-01-18 | 7 | Fantasy Camp |
| 2026-01-19 | 2026-02-08 | 21 | Early Camp |
| 2026-02-09 | 2026-03-22 | 42 | MLB ST |
| 2026-03-23 | 2026-04-01 | 10 | ST |
| 2026-04-02 | 2026-05-17 | 46 | Extended |
| 2026-05-18 | 2026-07-15 | 59 | ACL |
| 2026-07-16 | 2026-07-20 | 5 | ACL/Draft |
| 2026-07-21 | 2026-07-26 | 6 | ACL |
| 2026-07-27 | 2026-08-23 | 28 | Bridge |
| 2026-08-24 | 2026-11-15 | 84 | Instructs/Camps |
| 2026-11-16 | 2026-12-20 | 35 | OFF |

### TXR-AZ (Texas Rangers, Surprise AZ - Arizona Complex)
Projections tab only (Actuals tab has no Camp Name column - phase truth lives on Projections). Uses macro-phase names plus per-day game labels during Spring Training.

| start | end | days | camp name |
|---|---|---|---|
| 2025-12-29 | 2026-02-08 | 42 | Staff/Rehab |
| 2026-02-09 | 2026-02-19 | 11 | ST Workouts |
| 2026-02-20 | 2026-03-22 | 31 | (per-day game labels: Home game, Away game, Split squad, Brazil-WBC, Away game @ KC, No game, OFF - 33 single-day runs) |
| 2026-03-23 | 2026-06-14 | 84 | Extended |
| 2026-06-15 | 2026-08-30 | 77 | ACL |
| 2026-08-31 | 2026-09-27 | 28 | Bridge |
| 2026-09-28 | 2026-11-15 | 49 | Instructs |
| 2026-11-16 | 2026-11-22 | 7 | OFF |
| 2026-11-23 | 2026-12-13 | 21 | Staff/Rehab |
| 2026-12-14 | 2026-12-20 | 7 | OFF |

Note: the Spring Training window (Feb 20 - Mar 22) is recorded as per-day game-type labels, not a single phase name. For phase-level reporting, treat that window as "Spring Training" and keep the game labels as a finer overlay if useful.

### TBR-FL (Tampa Bay Rays, Port Charlotte FL - Florida Complex)
Cleanest calendar of all 5. Projections tab is canonical (Actuals adds per-game-day FCL overlays with casing inconsistencies - e.g. "FCL/H/12pm" vs "FCLH/12pm" - unusable as-is for phase reporting).

| start | end | days | camp name |
|---|---|---|---|
| 2025-12-29 | 2026-01-04 | 7 | OFF |
| 2026-01-05 | 2026-02-08 | 35 | Camps |
| 2026-02-09 | 2026-03-29 | 49 | ST |
| 2026-03-30 | 2026-04-26 | 28 | Extended |
| 2026-04-27 | 2026-07-26 | 91 | FCL |
| 2026-07-27 | 2026-09-27 | 63 | Bridge |
| 2026-09-28 | 2026-10-11 | 14 | Rehab |
| 2026-10-12 | 2026-11-22 | 42 | Camps |
| 2026-11-23 | 2026-12-20 | 28 | OFF |

### TBJ-FL (Toronto Blue Jays, Dunedin FL - Florida Complex) - Confirmed simple
The Camp Name column is mostly blank (146 consecutive blank days Feb 10 - Jul 5; 131 blank days Jul 15 - Nov 22). Used for one-day event flags only: "Early Camp" (Jan 26), "SPRING TRAINING" (Feb 9, all-caps, 1 day), "AllStar Break" (Jul 6), "Draft Dinner" (Jul 11), "New Drafted Players" (Jul 14), plus split-cell holiday annotations. Phases must be inferred + confirmed. From the meal-signal recon, TBJ runs a genuine early camp (Major League services active from ~Jan 12, the only PDC with January MLB activity), then Spring Training, then a summer plateau, then a fall taper.

### STL-FL (St Louis Cardinals, Jupiter FL - Florida Complex, flat-fee) - Confirmed simple
The phase column is labeled "Homestand" and is entirely blank. Phases must be inferred + confirmed. Operationally PDC-shaped (follows the developmental arc) despite flat-fee billing. From the meal-signal recon: cold January, Spring Training Feb-Mar, drop into Extended in April, FCL plateau through summer (heavily noised by weekly Palm Beach Cardinals home/away rotation), fall taper.

### Confirmed simple calendars - TBJ-FL + STL-FL (fiscal 2026, Kevin-approved)

Neither account records phases in a usable column, so these are a CONFIRMED simple calendar, not a column read. Method: TBR-FL's arc as the FL-peer skeleton, keeping the three boundaries each account's own covers actually show, TBR-anchoring the silent stretches, and collapsing every split the data cannot back. Both accounts run the same arc (TBJ ~2x STL volume), so the blocks are identical.

| start | end | camp name | basis |
|---|---|---|---|
| 2025-12-29 | 2026-01-04 | OFF | data (zero covers) |
| 2026-01-05 | 2026-02-08 | Camps | TBR-peer |
| 2026-02-09 | 2026-03-22 | ST | data (covers step + TBJ operator flag 2/9) |
| 2026-03-23 | 2026-04-26 | Extended | TBR-peer |
| 2026-04-27 | 2026-07-26 | FCL | TBR-peer |
| 2026-07-27 | 2026-09-27 | Bridge | TBR-peer |
| 2026-09-28 | 2026-11-22 | Camps | TBR-peer (collapsed TBR's Rehab+Camps fall split) |
| 2026-11-23 | 2026-12-20 | OFF | data (TBJ operator flag "CLOSED FOR THANKSGIVING" 11/23) |

Simplifications vs the raw draft: ST-end uses each account's own covers step (3/22), not TBR's 3/29; the fall Rehab+Camps split is collapsed to one Camps block; the Jan sub-camps (Battery/Fantasy/Early) are dropped to plain Camps. Known deviation: TBJ-FL shows two ~5-day windows of ~100 weekday covers in late Nov / early Dec that are folded into OFF here - revisit as a Staff/Rehab window if the tint should reflect that activity.

---

## Canonical vocabulary (alias -> canonical mapping needed)

The phase names are NOT standardized across operators. The `sc_phases` model needs an alias-to-canonical mapping. Observed values:

**Shared concepts (with per-account aliases):**
- **OFF** / offseason (CIN, TXR, TBR)
- **Extended** (Extended Spring) (CIN, TXR, TBR)
- **Bridge** (CIN, TXR, TBR)
- **Complex League** = **ACL** (Arizona: CIN, TXR) / **FCL** (Florida: TBR) - same concept, complex differs by state
- **Instructional** = "Instructs" (TXR) / "Instructs/Camps" (CIN) / "Camps" (TBR) - same concept, different naming
- **Spring Training** = "MLB ST" + "ST" (CIN) / "ST Workouts" + game labels (TXR) / "ST" (TBR)

**Account-specific (CIN-AZ early-camp arc):**
- Battery Camp, Fantasy Camp, Early Camp - distinct pre-Spring phases CIN records that others do not

**Proposed canonical set (to finalize when Stage 2 is scoped):**
OFF, Camps/Pre-Camp, Early Camp, Spring Training, Extended Spring, Complex League (ACL/FCL by location), Bridge, Instructional, Rehab/Staff.

The complex (ACL vs FCL) is determined by the account's state: AZ accounts -> ACL, FL accounts -> FCL.

---

## Build implications (for the eventual `sc_phases` table - not a task here)

- **Table shape:** per-account rows: `account_key, phase_name (canonical), phase_label (as-recorded alias), start_date, end_date, sort_order`. ~10-13 rows per PDC per year.
- **Seeding:** seed CIN-AZ, TXR-AZ, TBR-FL directly from the recorded Camp Name columns (tables above). For TBJ-FL and STL-FL, generate an inference draft from meal-signal, mark uncertainty, have Kevin confirm before recording.
- **Derive-then-record:** the recorded column (or the inference) seeds a DRAFT; Kevin confirms; Postgres stores the clean canonical truth. Do not bill or operate off an unconfirmed boundary.
- **Source going forward:** once recorded in PG, `sc_phases` is the source of truth. The spreadsheet Camp Name column was the bootstrap, not the permanent input path (operators will eventually set phases in the tool, same trajectory as the fiscal periods).
- **Data quality to handle:** TBR-FL Actuals per-game-day casing chaos (do not ingest Actuals overlays as phases - use Projections); TXR-AZ per-day game labels inside Spring Training (collapse to the macro phase).

---

## Open questions (Kevin / domain - for Stage 2 scoping)

- Finalize the canonical phase vocabulary + the alias map.
- RESOLVED (2026-07): TBJ-FL + STL-FL recorded with a Kevin-approved simple calendar (see above).
- Decide whether the Extended -> Complex-League distinction (recorded for the 3 clean accounts) should be a hard boundary operators plan around, or a softer label.
- Confirm the ACL/FCL-by-state rule holds for all current and future PDC accounts.
