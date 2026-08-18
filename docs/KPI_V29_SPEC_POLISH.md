# KPI V29 SPEC - scale discipline + board polish - approved 2026-08-18

Status: LOCKED. Amends KPI_V21_SPEC_DELTAS.md and KPI_V25_SPEC_TABLE_LOADING.md. Reference
render: kitchfix-kpi-v28-board.html (Kevin's LOCAL file, layout intent only, never committed).
Where render and spec disagree, this document wins. Commit-safe: no client dollars.

## A. THE SCALE IS THE POINT (V29-1..V29-4)

The board currently renders ELEVEN distinct font sizes and THIRTEEN spacing values while the
approved chrome (command bar, folio) uses three of each. That mismatch - not any single
element - is why the page reads as two design systems stacked together. Fixing it is the
substance of this pass; everything in section B is secondary.

- V29-1  FIVE type steps for the KPI module, tokenised, and NOTHING may use a sixth:
           --kpi-t-label  10px   800  .09em  uppercase   every label, eyebrow, card title
           --kpi-t-meta   11px   500                      every sub-line, caption, axis
           --kpi-t-body   12.5px 600                      body text, controls, table cells
           --kpi-t-value  20px   800  -.01em              secondary values, numbers-strip cells
           --kpi-t-hero   30px   800  -.018em             ONE per card
         The chrome keeps its approved three (title 18, meta 11, control 12.5); those are
         already correct and are not re-derived here. All values pass through --kf-scale.
- V29-2  A hero value longer than 11 characters falls back to --kpi-t-value. There is no
         intermediate step and no fluid sizing - a millions figure renders at value size.
         This replaces any bespoke step-down. `$1,637,503.83` must render complete, never
         clipped, at every supported width.
- V29-3  SIX spacing steps on a 4px base - 4, 8, 12, 16, 20, 24 - and nothing may use a
         seventh. Every padding, margin and gap on a KPI surface resolves to one of them.
- V29-4  Component heights are NAMED tokens, not literals, so they are decisions rather than
         accidents: pill/lane 20, control 30, plot 84, arc 68, diverging track 12, bullet 8,
         signal-card min 168. One shared `lane` height (20) governs every pill, chip, state
         badge and label row so those elements share a baseline across all four cards.
         NEW PERMANENT GATE: zero raw type or spacing px literals on KPI product surfaces.
         Report the count; the target is zero, not "few".

## B. Board polish (V29-5..V29-10)

- V29-5  STATUS PILL: state word only - `ON TRACK` / `WATCH` / `OVER BUDGET`. The dollar
         figure is removed; it already appears in the Over/under card. Pill height = lane
         token, type = label step.
- V29-6  SPEND CARD - BUDGET LEADS. Order becomes: eyebrow row (period + dates + pill), then
         a BUDGET card carrying the period budget at HERO size with a navy accent bar and the
         sub-line `FY2026 budget · <n>% of period gone`, then a paired row beneath holding
         `Spent so far` and `Left to spend` at VALUE size, the latter tinted navy. Budget is
         the dominant figure on the card; spent and left are secondary. Closed periods keep
         the existing under/over treatment on the right cell of the pair.
- V29-7  ADJUSTED TARGET LINE. The week strip carries TWO dashed lines, each labeled once in
         the strip header:
           - ORIGINAL weekly target, amber, on closed and in-progress weeks;
           - ADJUSTED target (the weekly allowance from V21-11), LIGHT BLUE (--kpi-blue-500
             family, #3E97D1), on weeks that have not started.
         Each week carries only the line that applies to it. When the two are equal (a period
         exactly on pace) both still render - the colours carry the meaning. When no allowance
         applies (closed period, multi-period range) the adjusted line and its legend entry
         are omitted entirely.
- V29-8  SIGNAL CARDS take the v28 treatments: diverging bar with a real centre marker and
         UNDER / ON BUDGET / OVER labels; overtime arc centred with the value inside and the
         amber threshold band rendering (it is currently absent - see V29-11); hours as a
         fraction `<used> of <budgeted>` with the rate as a chip; payroll ticks with any
         unpriced worker-week rendered AMBER rather than only stated in the count.
- V29-9  ALL THE NUMBERS: the second group gets --kpi-sp-6 of left padding so its labels clear
         the divider instead of hugging it. No cell may truncate at any supported width.
- V29-10 WORKER ROWS - NAMES MODE IS BROKEN. It currently renders `#1042 Cook`, which is
         number + job title. That is the NUMBERS-mode presentation. Correct behaviour:
           Names mode:   `<display_name>` at 700 weight, then `#<number>` at label size, then
                         `<title>` at label size - descending weight, three elements.
           Numbers mode: `#<number>` then `<title>`. The name is the only thing removed.
         The title is a stand-in for the name when names are hidden; it must never replace the
         name when names are shown.

## C. Defects found in the same pass (V29-11..V29-14)

- V29-11 The overtime arc's amber threshold band is not rendering in any state. It was ruled
         to stay (V21-21). Restore it, geometry from the OT watch/alarm configuration.
- V29-12 `running · $4,938.70allowance` - missing space before `allowance`.
- V29-13 `of budget · 100% elaps…` truncates in the numbers strip. Shorten the caption to
         `<n>% elapsed`; no cell truncates.
- V29-14 A period with $0 spend renders a floating dashed target line with no bar beneath it,
         which reads as broken. A zero week renders a flat baseline rule and no target line.
         Also: `period closed` must read `range closed` when the range is not a single period.
