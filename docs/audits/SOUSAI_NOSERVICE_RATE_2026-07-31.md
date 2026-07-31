# SousAI no-service-day rate + collapse-pattern survey - 2026-07-31

**Trigger:** Kevin's 2026-07-30 finding that Sous reported CIN-AZ July as "27 of 31 service days entered, four days still unrecorded, the variance will close some." Service Calendar showed 24 of 24 - fully caught up. The gap is that a cancelled day is encoded as every-service-set-to-zero (there is no schema column for it), and the direct `sc_daily_revenue` reader (`scAccountWindow`) counted those as unentered service days awaiting an entry that already happened.

**Scope:** Two measurable questions per plan v2.62 Part 5. Investigation is read-only. **No schema changes proposed - that is Kevin's call.**

---

## Q1 - How often are days marked no-service?

Season YTD (2026-01-01 to 2026-07-31), across all 11 non-CORP accounts. Per-day classification uses the same `classifyDayStatus` rule the Service Calendar applies (`src/lib/dataStore/serviceCalendar.js:259`). Two shapes of no-service:

- **post-mark** — `hasAct && !anyNonZeroAct` — operator marked the day no-service after projections were set (a real cancellation)
- **planned** — `!hasAct && hasProj && !anyNonZeroProj` — projections went in as all zero (planned off-day)

| account | level | projected days | post-mark | planned | total cancelled | **rate** | actionable | entered |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CIN - AZ | PDC | 212 | 40 | 5 | 45 | **21.2%** | 167 | 167 |
| CIN - KY | AAA | 131 | 54 | 21 | 75 | **57.3%** | 56 | 52 |
| CIN - OH | MLB | 106 | 0 | 50 | 50 | **47.2%** | 56 | 16 |
| STL - FL | PDC | 212 | 39 | 10 | 49 | **23.1%** | 163 | 71 |
| STL - MO | MLB | 107 | 0 | 47 | 47 | **43.9%** | 60 | 0 |
| TBJ - FL | PDC | 212 | 11 | 11 | 22 | **10.4%** | 190 | 166 |
| TBJ - NY | AAA | 131 | 10 | 73 | 83 | **63.4%** | 48 | 38 |
| TBR - FL | PDC | 212 | 29 | 9 | 38 | **17.9%** | 174 | 172 |
| TXR - AZ | PDC | 198 | 25 | 5 | 30 | **15.2%** | 178 | 146 |
| TXR - TX - H | MLB | 101 | 0 | 48 | 48 | **47.5%** | 53 | 0 |
| TXR - TX - V | MLB | 101 | 0 | 48 | 48 | **47.5%** | 53 | 0 |

**Portfolio total:** 1,723 projected days; **535 cancelled (208 post-mark, 327 planned); overall rate 31.1%.**

**Reading the number:**

- **1 in 3 projected days becomes no-service.** That is not rare.
- MLB fee accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) show zero post-mark cancellations - their no-service is entirely planned (non-game homestand days set as all-zero projections). This is the "PREP / OPEN / CLOSE / CLEAN" schedule shape.
- PDC accounts show the mixed pattern - operators actively mark cancelled days via the UI (CIN-AZ 40 post-mark days, STL-FL 39).
- AAA accounts (CIN-KY, TBJ-NY) run high on planned (large blocks of the season are off-days at those levels).

**Verdict on the schema-column question:** the number supports the column. 31% is not the "rare edge" case where a heuristic is fine indefinitely; it is the case where every new consumer of `sc_daily_revenue` will hit the same bug the sweep exposed. This PR fixes `scAccountWindow` to match `classifyDayStatus`; the next consumer that reaches for the raw view will repeat the same fix or - as `scAccountWindow` did until yesterday - not fix it and publish wrong numbers.

**Not proposed here.** Kevin rules on his product.

---

## Q2 - Where is the collapse pattern already implemented?

Five distinct implementations, split into three roles:

### Role 1: Classify a day's STATE (the truth every rollup reads)

| file:line | rule | applies to |
|---|---|---|
| `src/lib/dataStore/serviceCalendar.js:326` | per-meal: `hasAct && !anyNonZeroAct` → "no-service" | PDC + MiLB + STL-FL |
| `src/lib/dataStore/serviceCalendar.js:333` | per-meal: `!hasAct && hasProj && !anyNonZeroProj` → "no-service" | PDC + MiLB + STL-FL |
| `src/lib/sousai/tools/data/scAccountWindow.js` (**new this PR**) | per-day reduce of `sc_daily_revenue` rows; identical predicates | scAccountWindow tool |

Fee accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) do NOT go through the collapse rule in `classifyDayStatus` - their non-service days are named by the schedule (dayType != GAME). Same outcome (day drops out of "N of M entered"), different code path.

### Role 2: Aggregate to "N of M entered" counts

| file:line | rule | applies to |
|---|---|---|
| `src/app/service-calendar/ServiceCalendar.js:216-222` | `isActionableTotal = day.status !== "no-service" && !== "off-season" && !== "prep" && !== "exhibition" && !== "away"`; `isDayEntered = day.status === "entered"` | week / period workspace metrics |
| `src/lib/dataStore/serviceCalendar.js:1777` | `if (d.status === "entered" \|\| d.status === "no-service") gameDaysEntered++` | fee-account MonthCard footer |

These two disagree slightly in what they include - the fee-account rollup at :1777 treats a no-service game day as "entered" (which for fee accounts is correct: it is a recorded cancellation, still tracked). The per-meal rollup at :216 excludes no-service days entirely from both sides. **Both correct for their branch;** the difference is documented in comments at both call sites but is not centralized.

### Role 3: Detect a mark-no-service EVENT (audit-log rendering)

| file:line | rule | applies to |
|---|---|---|
| `src/app/service-calendar/DayDetail.js:102` | `bucket.entries.length > 1 && bucket.entries.every(e => Number(e.newValue) === 0)` | Ledger row "Marked no service" system phrasing |

Different concern from Roles 1 and 2 - this detects the write event ("was this bucket a batch of zero-writes?"), not the current state. The `length > 1` guard prevents a single-service correction from N→0 being rendered as "Marked no service" (see DayDetail.js:95-101 comment). Correctly separate from the state predicates.

Downstream helpers that consume the state flag rather than compute it (BulkReview, SubmissionToast) are not implementations of the pattern; they read whatever the classifier / event-detector produced. Not counted.

### Cross-implementation agreement

The **state** implementations (Role 1) all agree by construction - `scAccountWindow` mirrors `classifyDayStatus` verbatim. The **aggregation** implementations (Role 2) disagree per-branch (per-meal excludes no-service; fee counts it as entered) - both correct for their billing model, but the disagreement is real and undocumented outside per-site comments.

**Argument for a schema column:** the "state" rule now lives in three files and any new consumer needs to reimplement it. Encoding no-service in a `sc_daily_revenue.day_status` column (or a `sc_daily_actuals.is_no_service` boolean set by `saveActuals`) would collapse Roles 1 and 3 to a lookup and reduce Role 2 to a filter. **31% cancellation rate says this is the common case, not the edge.**

**Argument against a schema column:** the rule is stable; adding a column requires a migration, a backfill, and a trigger on every write path that could create a no-service day. Two write paths exist (`saveActuals` for post-mark and initial projection entry for planned) so the trigger has to handle both cleanly. The classifier already produces the right status string; only new consumers of raw `sc_daily_revenue` (like `scAccountWindow`) hit the bug.

**Kevin decides.** The Part 2 fix in this PR unblocks Sous today with the heuristic-match approach; if Kevin greenlights a column later, `scAccountWindow` becomes a two-line filter instead of a per-day reduce.
