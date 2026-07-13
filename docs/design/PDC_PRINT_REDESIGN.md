# PDC Drill Print Redesign — Handoff Doc

> **Status**: **PARKED 2026-07-13** by Kevin's ruling. The current PDC/PDCO drill PDF (Sheet 6/7 of `SC_PRINT_SPEC_v2.html`) is gated behind Coming Soon on the Service Calendar release. Prototype (Option 4 "Two-Zone Poster") validated on real data and awaiting Kevin's design verdict. Kevin's full feedback on the proto sheets is pending as of this doc's date.
>
> **This doc is the resume state.** A future CC session with no memory of this arc reads this file top-to-bottom to pick up where it left off. Every open ruling is enumerated in the "Open rulings" section below; every artifact has a repo pointer.

---

## Why this doc exists

Kevin's ruling: the PDC drill print redesign continues, but it must not block the Service Calendar release. Rather than ship a sheet the redesign supersedes, the current drill PDF is gated visibly (menu greyed with `COMING SOON` tag + route returns 404) and this doc captures the full arc — audience research, the four options considered, the selected prototype, the doctrines already ruled, the open rulings for Kevin, and the resume procedure — so a fresh CC session can execute from cold.

Do NOT delete the current sheet code or the gen-all-pdfs.mjs entries. Proofs remain generatable internally. The park is a menu + route gate, not a deletion.

---

## Scope of the park

**GATED** (behind Coming Soon + route 404 for the release):
- PDF print, `scope=month` + `scope=period`, for PDC + PDCO variants only:
  - PDC: CIN - AZ, TXR - AZ, TBR - FL
  - PDCO: STL - FL, TBJ - FL

**STAYS LIVE** on release:
- Those five accounts' **Season PDF** (approved product, portrait 3-col per polish wave, unaffected by redesign).
- Those five accounts' **Ops Calendar PDF** (overview surface, SERVICE DAY collapse per polish wave, unaffected).
- All **Excel exports** for all accounts and scopes (drill Excel is Kevin's operator workflow authority; wall poster is a separate audience).
- **All PDF scopes for MLB + AAA** — CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V (MLB) + CIN - KY, TBJ - NY (AAA) drill sheets remain live. Approved product per Sheet 5 grammar; outside the redesign.

The PDC/PDCO drill code paths continue to render locally via `scripts/sc-print/gen-all-pdfs.mjs` so the design side can regenerate proofs on-branch without touching the gate.

---

## The problem

### Audience

The PDC drill PDF is used at **poster distance** on a **kitchen wall**, viewed at **3-6 feet** by chefs mid-shift with wet or gloved hands. Letter-only paper. Full color available (kitchen laser).

The `SC_PRINT_SPEC_v2` drill sheet was designed as a **desk document** — small type, dense text, compliance vocabulary, single fixed hierarchy — and was carried forward to the wall use case unchanged. The mismatch is the whole problem.

### The four failures of the current drill (Sheet 6/7)

1. **Names repeat ~30 times per sheet at 7px**. The meal stack renders the full service name inside every cell that carries counts. On a 30-31 day month with a 5-service catalog that's 150+ repetitions of "Breakfast", "Lunch", etc. — an operator at 3-6 feet reads a wall of tiny black-on-green text with no pre-attentive load signal.
2. **Magnitude is encoded only in digits**. A day with `Breakfast 200` and a day with `Breakfast 25` render at the same visual weight in the stack. The reader has to decode digits to see load — which is what happens after they've walked to the wall and squinted, not the "how heavy is Wednesday" question they wanted answered from across the room.
3. **Single fixed hierarchy**. Every cell shows the same detail level: service name + count + hairline + total. There's no "eyeball day totals from six feet" summary and no "how many Breakfasts on Wednesday" audit-scale detail — just one middle-distance density that's wrong for both distances.
4. **Compliance vocabulary for the wrong audience**. The drill inherits the `SERVED / PROJECTED / NO ACTUALS / NO SERVICE` state model from the operator's on-screen compliance workflow. The wall reader doesn't need to know which days are compliance signals — they need to know how many meals go out. Compliance is an operator tool; the wall wants "what's happening this month."

The `PRINT_DATA_CENSUS.md` finding that MLB accounts don't need any state layer (R5 superseded) generalizes: the WALL doesn't need any state layer either. Best-available number, styled by source (confirmed vs projected), no compliance grammar.

---

## The research + four options

### Research corpus

Prep sheets, par sheets, and BEO (Banquet Event Order) conventions from the food-service industry — the genre operators already read at wall distance. Common patterns:
- Items in a column, counts as payload.
- Proportional bars behind numbers for load-at-a-glance.
- Full names in header once; not repeated per row.
- Weekend/weekday visual differentiation.
- Header-scale distinction between "the shape of this week" (day-over-day pattern) and "what's on Wednesday" (per-service detail).

Data-viz best practice adds: per-column bar normalization (each service's bars scale to its own monthly max — so `Extra Protein 1` and `Lunch 240` both fill 100% of their column's bar width, letting the reader see "was this day heavy for THIS service?" not "was this day the biggest number on the sheet?").

### The four directions considered

Pixel reference committed at `docs/design/sc-pdc-four-options.html`. All four sit on a shared vocabulary (deep green filled = CONFIRMED, sage outlined = PROJECTED; verbatim names; no compliance states).

1. **Option 1 - The Production Matrix**: par-sheet DNA + magnitude bars. Items in a column, counts as payload, proportional bar rides behind every number, per-column normalization. Full names once in the header; counts at 13px; whole month fits letter portrait. Very close to industry-standard prep sheet; utility-first.
2. **Option 2 - The Service Lanes**: per-service horizontal lanes across the month, count as pill inside each lane cell. Vertical scan = "how did Breakfast look this month"; horizontal scan = "what's on Tuesday". Column-per-day layout — high density.
3. **Option 3 - The Day Ledger**: per-day chip cards showing all services on that day as chips + a big day-total number. Chip layout foregrounds the day, not the service — closer to a daily order form than a monthly summary.
4. **Option 4 - The Two-Zone Poster**: **KEVIN SELECTED**. Transit-poster logic. TOP zone = the whole month as hero totals only (load shape, game dots, current-week ring) - legible across the kitchen. BOTTOM zone = full per-service matrix detail (Option 1 grammar). One page, two reading distances, honestly separated instead of compromised.

Kevin's rationale for Option 4: "the poster answers 'how heavy is this month' from six feet and 'how many Breakfasts Wednesday' from two." The other three options each optimize for one distance and compromise the other; the two-zone structure lets the sheet DO BOTH without middle-distance mush.

---

## The prototype

- **PR**: [#427](https://github.com/KitchFix-Intranet/kitchfix-intranet/pull/427) - "proto(sc-print): Option 4 prototype + redesign handoff [PARKED]" - branch `proto/pdc-option4`.
- **Script**: `scripts/sc-print/proto-pdc-option4.mjs` - PROTOTYPE-headed, read-only against the DB, no product files touched.
- **Output**: 15 sheets in `scripts/sc-print/artifacts-proto/` (gitignored per existing rule; regen via the script).
- **Coverage**: 5 PDC-level accounts × 3 months (2026-03, 2026-05, 2026-06) = 15 sheets.
  - Accounts: CIN - AZ, TXR - AZ, TBR - FL (plain PDCs) + STL - FL, TBJ - FL (PDCO overlays).
  - Months: March (spring peak + first 6-week-row month), May (mid-summer baseline), June (all-sage horizon-cliff on STL - FL).
- **Fidelity pass**: committed as `9ddb5ec` on the branch. Aligned prototype grammar to the mockup at `docs/design/sc-pdc-four-options.html` for zone structure, tokens, bar treatment, hero-total styling, footer, empty-cell placeholder, and NO SERVICE row collapse.
- **Fit protocol**: linear estimator flags `fits=false projected 905-958px @ floors > 792px`; puppeteer's actual layout compresses to 1 page on every sheet. Every PDF passes the standing page-count gate (`pdfinfo` reports 1 page per PDF).

### Three deliberate divergences from the mockup (kept per Kevin's brief)

1. **Zone 2 span**: mockup's `.cap` narrative described "this week + next" (14 days). Kevin's brief text explicitly said `Zone 2 'FULL MONTH - DETAIL': the whole month as the bar-matrix`. Brief overrides mockup narrative. Prototype renders the whole month.
2. **Zone 2 style grain**: mockup uses row-level `<tr class="c">` or `<tr class="p">` (entire row uniform). Kevin's brief text said `value = actualCount if that service-day has actuals, else projectedCount. Style follows the source` - which reads as per-cell. Row-level would collapse mixed-source days (some services actual, some projected on the same date). Prototype preserves per-cell grain.
3. **Zone 1 PROJECTED interpretation**: mockup uses default cell border + sage text (no fill, no distinct outline layer). Kevin's brief said `PROJECTED = sage, outlined` - my initial interpretation added a distinct outline color; fidelity pass removed the extra layer and now matches the mockup exactly. This is not a divergence anymore; recorded here so the reader doesn't chase it.

---

## Doctrines already ruled (binding on the future build)

These are Kevin-approved and DO NOT need re-ruling. A future CC session takes them as given.

### Best-available number, no compliance states on the wall

- Per (day, service) value = `actualCount` if the service-day has actuals, else `projectedCount`.
- Style follows source: **CONFIRMED** (deep green text `#33582B`, filled `#E4EDDA`) when actuals; **PROJECTED** (sage text `#7E9573`, outlined) when projection.
- **NO NO_ACTUALS / NO_SERVICE / compliance vocabulary** in the wall poster. Compliance is the operator tool (`resolveDayState()`), and it stays on the on-screen surface + the Excel export + AAA/MLB drill sheets. The wall renders numbers, not compliance signals.

### Redundant encoding, mono-safe

CONFIRMED vs PROJECTED reads via THREE simultaneous encodings: **color** (deep green vs sage), **weight** (700 vs 600), and **fill** (filled bar vs outlined). Grayscale-safe by construction — the fill/outline distinction survives when color drops out.

### Verbatim case-preserved names

Full service names in the Zone 2 header, ONCE (not repeated per row - that's the whole reason the current drill fails at wall distance). Case preserved as stored in `sc_services`. `Pre-game` (STL - FL FSL) stays distinct from `Pre-Game` (TBJ - FL PDC). The header wraps to two lines for the 28-char worst case (`Extra Protein - Chicken/Pork` on TBR - FL). Never clips.

### `is_non_revenue` only exclusion (pending contamination ruling)

R3 stands as of prototype: services with `is_non_revenue === true` are excluded from the wall. The name-based regex from the pre-corrective wave (`coffee|beverage|bev|fountain|water|hydration`) is retired.

The **wall-inclusion ruling** (see Open rulings below) may add a second exclusion axis for billing-atom services (count-1 flat-fee lines that render as full-normalized bars). Kevin has NOT ruled on this yet; prototype currently prints every non-`is_non_revenue` service that carries counts, including the tax-free and adder atoms.

### One page, letter portrait

The wall-poster format. `@page{size:letter portrait;margin:0}`. Density trades: cell heights auto-tighten from target toward floor; if a 31-day month still overflows at floors, render anyway and FLAG rather than compromise the design silently. Prototype's fit-flag on every sheet is transparent about the pessimistic linear estimate.

### Census-before-design, contact-sheet law, page-count gate

Standing laws from earlier waves apply to this redesign too:
- Before finalizing the build brief, verify data assumptions against `PRINT_DATA_CENSUS.md`. The wall design cannot invent columns, service names, or state values that don't exist in the data.
- Every print PR posts a paragraph-per-sheet contact sheet in the PR body. No verdict-target subsetting.
- Every PDF must render at 1 page per `pdfinfo`. Multi-page = hard failure.

---

## Open rulings — the resume checklist

**Do not proceed to the build brief until every open ruling below is closed.** These are what a future CC session needs from Kevin before writing the v3 spec.

### 1. Two-zone structure verdict on the real-data sheets

The prototype renders Kevin's Option 4 on 15 real-data sheets. Does the two-zone structure hold up? Specifically:
- Zone 1 hero totals: readable at 3-6 feet? Load pattern legible without decoding digits?
- Zone 2 matrix: per-column bar normalization delivering the "was this day heavy for THIS service" signal Kevin wanted?
- One-page letter portrait: reads as a poster, not a compromised handout?

### 2. All-sage month honesty (STL - FL June is the test card)

STL - FL's actuals stop end of May per census. June is 100% projected — every Zone 1 hero total is sage, every Zone 2 bar is outlined. Kevin's brief explicitly said "call it out in the contact sheet, don't 'fix' it" — the all-sage month IS the correct output.

Does the design read cleanly as "all-projected month" (informative) or does it read as "broken sheet" (design failure) to a chef at wall distance? Kevin rules on whether the design's projected treatment is legible enough to stand alone, or needs a secondary signal ("PROJECTED THROUGH MONTH-END" title chip or similar).

### 3. Wall-inclusion for the THREE contamination classes

The wall poster shows every service that carries a non-zero count and is not `is_non_revenue`. The prototype surfaces three contamination classes that render as full-normalized bars against real cover values in the per-column view. **Kevin rules which classes belong on the wall.**

**Class A - Labor / adder atoms** (count = 1 sustained across many days, represents a per-day billing atom not a cover):
- **TBR - FL `Extended Day labor`** — count=1 across 8 days May, 6 days June, ~26 days March (via inference from ST variant days).
- **TBR - FL `Extra Protein - Chicken/Pork`** — count=1 across 4 days May, 6 days June.
- **TBR - FL `Extra Protein - Beef/Seafood`** (not in the current May/June set, but present per census).

**Class B - Count-1 flat-fee beverage atoms** (`is_flat_fee=true, is_tax_free=true` per census; count=1 sustained; R3 ruled these IN for the compliance drill, but the wall audience may differ):
- **CIN - AZ `Coffee Service (tax-free)`** — count=1 across 4-5 days per month.
- **CIN - AZ `Fountain Bev (tax-free)`** — count=1 across 4-5 days per month.

**Class C - Low-count meal-named lines** (name reads like a cover service but sustained at billing-atom scale):
- **TBJ - FL June `Dinner`** — count=2-3 sustained across 21 days. Reads as per-camp headcount, not covers.
- **TBJ - FL March `Dinner`** — count=1-4 sustained across 30 days. Same pattern; NEW finding from the March addendum.

**R3 tension**: R3 ruled `is_non_revenue`-only exclusion for the compliance drill (removing the name regex). The wall may need different inclusion rules because the audience is different. Kevin rules for each class; the design executes.

**Full inventory table** (reproduced from PR #427 comment for the resume state):

| Account | Month | Service | Days | Value range | Style mix | Flag |
|---|---|---|---|---|---|---|
| CIN - AZ | 2026-03 | Lunch | 76 | 20-326 | confirmed |  |
| CIN - AZ | 2026-03 | Breakfast | 68 | 20-326 | confirmed |  |
| CIN - AZ | 2026-03 | Dinner | 8 | 85-200 | confirmed |  |
| CIN - AZ | 2026-03 | Pre-Game Snack | 2 | 200 | confirmed |  |
| CIN - AZ | 2026-03 | Coffee Service (tax-free) | 5 | 1 | confirmed | **BILLING UNIT** |
| CIN - AZ | 2026-03 | Fountain Bev (tax-free) | 5 | 1 | confirmed | **BILLING UNIT** |
| CIN - AZ | 2026-05 | Coffee Service (tax-free) | 4 | 1 | confirmed | **BILLING UNIT** |
| CIN - AZ | 2026-05 | Fountain Bev (tax-free) | 4 | 1 | confirmed | **BILLING UNIT** |
| CIN - AZ | 2026-06 | Lunch | 50 | 15-80 | 38c/12p |  |
| CIN - AZ | 2026-06 | Breakfast | 28 | 1-80 | 20c/8p |  |
| CIN - AZ | 2026-06 | Dinner | 17 | 77-80 | 13c/4p |  |
| CIN - AZ | 2026-06 | Pre-Game Snack | 17 | 50 | 13c/4p |  |
| CIN - AZ | 2026-06 | Continental Plus | 17 | 45-50 | 12c/5p |  |
| CIN - AZ | 2026-06 | Coffee Service (tax-free) | 5 | 1 | confirmed | **BILLING UNIT** |
| CIN - AZ | 2026-06 | Fountain Bev (tax-free) | 5 | 1 | confirmed | **BILLING UNIT** |
| TXR - AZ | 2026-03 | Lunch | 45 | 40-340 | confirmed |  |
| TXR - AZ | 2026-03 | Breakfast | 39 | 25-275 | confirmed |  |
| TXR - AZ | 2026-03 | Regular Snack | 21 | 90-150 | confirmed |  |
| TXR - AZ | 2026-03 | Dinner | 9 | 60-275 | confirmed |  |
| TXR - AZ | 2026-03 | Pre-Game Hot Snack | 6 | 15-300 | confirmed |  |
| TXR - AZ | 2026-05 | Lunch | 26 | 75-100 | confirmed |  |
| TXR - AZ | 2026-05 | Pre-Game Hot Snack | 17 | 100 | confirmed |  |
| TXR - AZ | 2026-05 | Dinner | 16 | 20-100 | confirmed |  |
| TXR - AZ | 2026-05 | Regular Snack | 9 | 55-120 | confirmed |  |
| TXR - AZ | 2026-05 | Breakfast | 7 | 100 | confirmed |  |
| TXR - AZ | 2026-06 | Dinner | 22 | 20-100 | 8c/14p |  |
| TXR - AZ | 2026-06 | Lunch | 21 | 75-100 | 11c/10p |  |
| TXR - AZ | 2026-06 | Pre-Game Hot Snack | 17 | 100 | 7c/10p |  |
| TXR - AZ | 2026-06 | Breakfast | 8 | 80-100 | 4c/4p |  |
| TXR - AZ | 2026-06 | Regular Snack | 9 | 50-65 | 5c/4p |  |
| TBR - FL | 2026-03 | Lunch - MiLB | 27 | 70-325 | confirmed |  |
| TBR - FL | 2026-03 | Breakfast - MiLB | 27 | 70-295 | confirmed |  |
| TBR - FL | 2026-03 | Breakfast - MiLB ST | 28 | 225-260 | projected | _spring variant_ |
| TBR - FL | 2026-03 | Lunch - MiLB ST | 28 | 225-260 | projected | _spring variant_ |
| TBR - FL | 2026-03 | Lunch | 22 | 80-160 | confirmed |  |
| TBR - FL | 2026-03 | Breakfast | 22 | 80-160 | confirmed |  |
| TBR - FL | 2026-03 | B&G Lunch | 10 | 115-135 | confirmed |  |
| TBR - FL | 2026-03 | Road Sandwiches - MiLB | 5 | 35-70 | confirmed |  |
| TBR - FL | 2026-05 | Lunch - MiLB | 25 | 92-212 | confirmed |  |
| TBR - FL | 2026-05 | Breakfast - MiLB ST | 26 | 125 | projected | _spring variant_ |
| TBR - FL | 2026-05 | Lunch - MiLB ST | 26 | 125 | projected | _spring variant_ |
| TBR - FL | 2026-05 | Breakfast - MiLB | 24 | 120 | confirmed |  |
| TBR - FL | 2026-05 | B&G Lunch | 12 | 135 | confirmed |  |
| TBR - FL | 2026-05 | Road Sandwiches - MiLB | 8 | 28 | confirmed |  |
| TBR - FL | 2026-05 | Extended Day labor | 8 | 1 | confirmed | **BILLING UNIT** |
| TBR - FL | 2026-05 | Extra Protein - Chicken/Pork | 4 | 1 | confirmed | **BILLING UNIT** |
| TBR - FL | 2026-06 | Lunch - MiLB | 26 | 92-240 | confirmed |  |
| TBR - FL | 2026-06 | Breakfast - MiLB ST | 26 | 125 | projected | _spring variant_ |
| TBR - FL | 2026-06 | Lunch - MiLB ST | 26 | 125 | projected | _spring variant_ |
| TBR - FL | 2026-06 | Breakfast - MiLB | 20 | 120 | confirmed |  |
| TBR - FL | 2026-06 | Road Sandwiches - MiLB | 9 | 28 | confirmed |  |
| TBR - FL | 2026-06 | Extra Protein - Chicken/Pork | 6 | 1 | confirmed | **BILLING UNIT** |
| TBR - FL | 2026-06 | Extended Day labor | 6 | 1 | confirmed | **BILLING UNIT** |
| STL - FL | 2026-03 | Breakfast - ST | 44 | 150-250 | projected | _spring variant_ |
| STL - FL | 2026-03 | Lunch - ST | 44 | 150-250 | projected | _spring variant_ |
| STL - FL | 2026-03 | Breakfast | 3 | 70-200 | 1c/2p |  |
| STL - FL | 2026-03 | Lunch | 3 | 70-200 | 1c/2p |  |
| STL - FL | 2026-03 | Post-Game | 1 | 50 | confirmed |  |
| STL - FL | 2026-05 | Lunch | 26 | 72-138 | confirmed |  |
| STL - FL | 2026-05 | Breakfast | 30 | 37-87 | confirmed |  |
| STL - FL | 2026-05 | Post-Game | 21 | 30-51 | 20c/1p |  |
| STL - FL | 2026-05 | Pre-game | 21 | 50 | projected |  |
| STL - FL | 2026-05 | Snack | 1 | 15 | confirmed |  |
| STL - FL | 2026-06 | Breakfast | 26 | 70 | projected |  |
| STL - FL | 2026-06 | Lunch | 26 | 70 | projected |  |
| STL - FL | 2026-06 | Pre-game | 18 | 50 | projected |  |
| STL - FL | 2026-06 | Post-Game | 18 | 50 | projected |  |
| TBJ - FL | 2026-03 | Lunch | 52 | 4-368 | 50c/2p |  |
| TBJ - FL | 2026-03 | Breakfast | 51 | 4-368 | 49c/2p |  |
| TBJ - FL | 2026-03 | MLB G&G - Pantry | 10 | 10-180 | confirmed |  |
| TBJ - FL | 2026-03 | Post Game Meal | 17 | 60-75 | 11c/6p |  |
| TBJ - FL | 2026-03 | MiLB G&G - Pantry | 4 | 180 | confirmed |  |
| TBJ - FL | 2026-03 | Post-Game | 2 | 65 | confirmed |  |
| TBJ - FL | 2026-03 | Pre-Game | 2 | 65 | confirmed |  |
| TBJ - FL | 2026-03 | Dinner | 30 | 1-4 | confirmed | **BILLING UNIT** (new class C) |
| TBJ - FL | 2026-05 | Breakfast | 30 | 2-150 | confirmed |  |
| TBJ - FL | 2026-05 | Lunch | 30 | 2-150 | confirmed |  |
| TBJ - FL | 2026-05 | Dinner | 23 | 2-50 | confirmed |  |
| TBJ - FL | 2026-05 | Post-Game | 12 | 50 | 9c/3p |  |
| TBJ - FL | 2026-05 | Pre-Game | 12 | 50 | confirmed |  |
| TBJ - FL | 2026-05 | MiLB G&G - Pantry | 2 | 180 | confirmed |  |
| TBJ - FL | 2026-05 | Stadium Staff Meals | 15 | 20-23 | 7c/8p |  |
| TBJ - FL | 2026-05 | Florida Ops - PDC | 5 | 4-16 | confirmed |  |
| TBJ - FL | 2026-06 | Breakfast | 29 | 3-155 | 27c/2p |  |
| TBJ - FL | 2026-06 | Lunch | 29 | 3-155 | 27c/2p |  |
| TBJ - FL | 2026-06 | Pre-Game | 14 | 50 | 5c/9p |  |
| TBJ - FL | 2026-06 | Post-Game | 12 | 50 | 3c/9p |  |
| TBJ - FL | 2026-06 | MiLB G&G - Pantry | 2 | 180 | confirmed |  |
| TBJ - FL | 2026-06 | Stadium Staff Meals | 14 | 19-21 | 5c/9p |  |
| TBJ - FL | 2026-06 | Scout Meals | 4 | 45 | confirmed |  |
| TBJ - FL | 2026-06 | Florida Ops - PDC | 4 | 16 | confirmed |  |
| TBJ - FL | 2026-06 | Dinner | 21 | 2-3 | confirmed | **BILLING UNIT** (class C) |

### 4. Archival months — does Zone 1 earn its keep?

When Kevin looks at a MONTH sheet at his desk (not the wall), Zone 1 shows day totals and Zone 2 shows the same day's service breakdown. Both zones show the SAME month. Zone 2 has more information than Zone 1; Zone 1 is a signal-first summary of Zone 2.

**Does Zone 1 earn the poster real estate at desk distance**, or does the archival use case want Zone 2 only (with the Zone 1 daily-totals row collapsed into Zone 2's TOTAL column)? Kevin rules — the resume state depends on whether the SAME sheet serves both the wall and the desk, or if the desk archive drops Zone 1.

### 5. Spring-block treatment

The prototype has NO spring-block treatment — no copper title chip, no `.spb` bar, no `ST` badge in the Zone 2 header. March renders spring-season data unlabeled: `Breakfast - MiLB ST` reads as just another service column with no visual cue that it's the spring variant. STL - FL's all-sage March could be read as "all-projected month" or "spring month" depending on which is dominant in the reader's mental model.

The polished product's month sheet has a `SPRING TRAINING` copper title chip via `.schip`. The Option 4 design needs a decision on:
- Replicate the `.schip` copper chip in the trow area?
- Add a per-row `ST` badge next to service names ending in ` - ST` / ` - MiLB ST`?
- Leave spring implicit and rely on the ST-suffixed service names + column mix to communicate context?

Kevin rules; the design executes.

### 6. Kevin's full feedback — PENDING

Kevin has reviewed all the prototype sheets (10-15 depending on when the March addendum landed) and is composing feedback on the design as a whole. **The resume procedure starts by collecting Kevin's feedback and consolidating it into a written spec.** No build brief is written before this happens.

---

## Schema gap

**Nothing in the schema distinguishes billing atoms from cover services.** If the contamination ruling filters out Class A / B / C lines, the flag needs a home.

Options:
1. **Reuse `is_flat_fee`**: Class B (Coffee Service tax-free, Fountain Bev tax-free) already have `is_flat_fee=true, is_tax_free=true`. If the rule is "flat-fee excludes from wall", Class B is filtered by existing schema. Class A (Extra Protein, Extended Day labor) do NOT have `is_flat_fee=true` in the data as of census — they're regular per-meal rows with count=1. This rule doesn't cover Class A.
2. **New boolean column** (e.g. `is_billing_atom` on `sc_services`): explicit tri-state (`is_non_revenue` = never appears; `is_billing_atom` = compliance drill yes, wall no; default = both). Requires a migration Kevin runs manually per `MIGRATION_STATUS.md` protocol.
3. **Content-based derivation at render time**: heuristic like `max(count over month) <= 5` derives the flag from data. Robust to name changes and new services; brittle to legitimate small-count services (a 5-cover B&G lunch on a slow Sunday would false-positive).

**Shared concern with roadmap item 3 - client bill export**: the bill export needs to distinguish billing atoms from cover services too (a "$X per Extra Protein" line item vs "$X per Lunch cover"). Whatever schema shape lands here informs the bill export. Discussion belongs on that ticket too.

Kevin has NOT ruled on the schema shape. The prototype doesn't need it (renders every service; contamination is visible for the ruling). The build brief needs it.

---

## Resume procedure

Future CC session with no memory of this arc does the following, in order:

1. **Read this doc top-to-bottom.** Nothing about the redesign lives outside it besides the mockup (`docs/design/sc-pdc-four-options.html`), the prototype script (`scripts/sc-print/proto-pdc-option4.mjs`), the AS-IS render dumps (`docs/design/renders/`), and the census (`docs/design/PRINT_DATA_CENSUS.md`).
2. **Collect Kevin's feedback + rulings** on the 6 open items above (esp. #6 - his full prototype feedback). Do not proceed until all 6 are closed.
3. **Write the v3 written spec** for the PDC/PDCO drill, superseding Sheet 6/7 in `SC_PRINT_SPEC_v2.html`. Include: zone structure (Zone 1 daily-totals grid + Zone 2 bar-matrix), tokens (deep green + sage + fill/outline redundant encoding), verbatim names, contamination rules per Kevin's ruling on the 3 classes, spring-block treatment per Kevin's ruling on #5, page-fit protocol (target → floor). New spec doc at `docs/design/SC_PRINT_SPEC_v3_PDC.md` (or committed as a HTML pixel reference alongside the mockup).
4. **Write the build brief** for the product-code implementation. Include: which files change (`src/lib/print/monthSheet.js` renderer for PDC/PDCO variants, `src/lib/print/assets.js` CSS tokens); which files DO NOT change (MLB + AAA drill remain untouched); the census-before-design check list; the contact-sheet + page-count gates.
5. **Implement in product code.** Land a fresh PR off `main` with the build. Contact-sheet law + page-count gate apply. Grayscale gate (Kevin prints physically) applies.
6. **Un-gate**: after Kevin approves the live rendered sheets, remove the ExportControl `COMING SOON` disabled state, remove the `/api/service-calendar/print` 404 for PDC/PDCO month/period, and update this doc's status line to SHIPPED with the merge date.

---

## Related context pointers

- **PDC drill cell-height 100px** in the current sheet is a page-fit accommodation from the polish wave (#426), not a design signal. When the redesign lands, this quirk goes away entirely because Option 4 is a different sheet.
- **Data curiosities the prototype surfaced**:
  - **TBR - FL runs `Breakfast - MiLB ST` variants in July** even though Spring Training officially ends earlier. May be a data-entry artifact or legitimate extended-camp spring workout carryover; census-check before designing around it.
  - **Jul 12 grace-day classifier behavior**: STL - FL's Jul 12 rendered as a projection anomaly in earlier waves due to the classifier's grace-day rule (past date but within the day's local sundown). Not a redesign concern but noted for anyone tracing classifier weirdness at prototype scale.
- **AS-IS render dumps**: `docs/design/renders/TBR-FL_Month_2026-07.html` + `docs/design/renders/TBJ-FL_Month_2026-07.html` are the pre-redesign snapshots kept for the design side. Base64 font-face + seal data URIs stripped; everything else verbatim.
- **The census document** (`docs/design/PRINT_DATA_CENSUS.md`) is the data authority. If this doc and the census disagree on a field name or observed value, the census wins.
- **The mockup** (`docs/design/sc-pdc-four-options.html`) is the pixel reference for Option 4 grammar (Zone 1 mini-cell shape, bar direction, hero-total type sizes, footer copy). Divergences kept in the prototype are documented in the "Three deliberate divergences" section above.
