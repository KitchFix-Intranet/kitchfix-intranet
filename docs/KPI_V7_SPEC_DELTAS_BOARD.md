# KPI V7 SPEC DELTAS - THE BOARD (hero · signals · details) - approved 2026-08-17

Status: LOCKED. Amends KPI_V7_SPEC_DELTAS_SHELL.md (V7-1..V7-23) and supersedes the v6 card
grid for /kpi/labor. Visual oracle: kitchfix-kpi-v8.7-board.html (Kevin's LOCAL file, contains
client figures, NEVER committed). Renders win on visuals; this document wins on behavior.
Unchanged: the week table and worker drill (their own section), the nine states, motion
doctrine, URL contract, budget resolution (playbook 4.5/4.6/8.2). Commit-safe: no client
dollars below.

## A. Retired from the main column (V8-1)

- V8-1  The v6 metric-card grid is retired: no BUDGET/HOURS card rows, no section eyebrow
        chips, no Numbers|Visual toggle (delete the control and its persistence key). Every
        figure they carried survives in the board below. The trend chart component is replaced
        by the week strip (V8-8..V8-12).

## B. New derived values (SPEC ADDITIONS - announced, not silent)

- V8-2  `projected_period_end` = spend-to-date / elapsed-weeks x weeks-in-period, where
        elapsed-weeks counts closed weeks plus the in-progress week prorated by days elapsed.
        Renders only when the selected range is a single fiscal period that is in progress.
        Never renders for closed periods, multi-period ranges, or presets.
- V8-3  `rolling_weekly_target` = (period budget - spent in closed weeks - spend so far in the
        in-progress week) / count of weeks not yet started. Renders only for an in-progress
        single-period selection with at least one week not started. If the result is negative
        (already over budget), render $0 and the label "budget exhausted".
- V8-4  `unapproved_hours` signal for an open week = hours present with no dollars
        (hours_without_dollars > 0, or coverage_state in {partial, hours_only}) on a week whose
        end date is >= today. Surfaces as the week's warning flag and as the `>=` prefix on
        that week's value. Never applied to closed weeks (those are simply coverage states).
- V8-5  All three are computed server-side in the labor route and shipped in the payload; the
        client never recomputes money.

## C. The Sentence (V8-6, V8-7)

- V8-6  A single headline row above everything: verdict pill + one plain-language sentence +
        a circular `?` help control. Sentence template (single in-progress period):
        `<account> is <$X under | $X over | on pace with> its <period label> labor budget with
        <n of m weeks> in.` For closed periods: `... finished <$X under|over> its <period>
        labor budget.` For multi-period/preset ranges: `... is <$X under|over> budget across
        <range label>.` Salaried-only and no-budget accounts: the row renders the account and
        range with no verdict pill.
- V8-7  Verdict bands (canonical, one source of truth for every colored element on the page):
        spend% minus elapsed% within +/-2 = ON TRACK (green); +2 to +5 = WATCH (amber);
        greater than +5 = OVER (red); under by more than 2 = also ON TRACK (green, never a
        separate "under" color). The `?` popover states the bands and the current numbers.

## D. Story block (V8-8..V8-12)

- V8-8  One card, two panels: left = the money, right = the weeks; both panels bottom-align.
- V8-9  Left panel order: eyebrow `<PERIOD LABEL>  <date range>`; then the headline -
        value at 38px followed on ONE line (nowrap) by `TOTAL LABOR SPENT` at 10.5px/800
        tracked; then the three-stat rail in equal thirds with 1px dividers, each cell
        `value + LABEL` inline: Workers (DISTINCT people, not worker-weeks), Hours, Avg rate;
        then the budget track pinned to the panel floor.
- V8-10 Budget track: one horizontal rail - solid fill = spent, hatched extension = projection
        to period end (V8-2), a full-height `TODAY` marker at elapsed%, and the label
        `PROJECTED PERIOD END` in a reserved lane BELOW the rail (labels never share a lane
        with the today marker). Key row beneath, spread edge to edge: spent / projected /
        budget. When V8-2 does not apply, the hatched segment and its label are omitted.
- V8-11 Week strip header: title, then two legend PILLS - amber `original <weekly budget>` and
        navy `rolling <target>` - then the $/hrs lens toggle, then the `?` help. The rolling
        pill and its dashed lines appear only when V8-3 applies.
- V8-12 Week columns (one per fiscal week in the selected period): a plot band with headroom,
        the week's bar, and its dashed target line; then a caption of fixed shape - value,
        dates, status line. Rules:
        - Closed week: bar colored by STRICT SIGN vs its original weekly budget - green under,
          red over. Status line reads `▼ $X under` / `▲ $X over`. Dashed line = original.
        - In-progress week: hatched navy bar, value prefixed `>=` when V8-4 fires, status line
          carries the amber `<n> hrs awaiting approval` flag; otherwise `<d> of 7 days`.
          Dashed line = original.
        - Not-yet-started week: no bar - a thin base rule only; dashed line = rolling target
          (navy); caption shows the rolling figure with `to stay on budget`.
        - No per-week target chips (the legend pills carry the values).
        - Multi-period or preset ranges: the strip renders weeks of the range grouped by
          period, all closed-week rules; rolling/projection omitted.

## E. Signal cards (V8-13..V8-16)

- V8-13 Exactly four cards, one grammar, equal height, bottom-aligned lanes: eyebrow + state
        pill (20px lane) / value / unit line / one-sentence read (36px min) / viz row (64px
        fixed) / action link above a hairline.
- V8-14 The four, in order: (1) OVER / UNDER BUDGET - value = signed variance, viz = diverging
        bar around a centered zero with under|on budget|over labels, action opens the week
        table; (2) OVERTIME - value = OT hours, viz = gauge arc with the watch band and the
        value centered inside the arc, thresholds beside it, action = OT by worker; (3) HOURS
        VS BUDGET - value = hours of budgeted hours, viz = bullet with a today marker, action
        = hours by week; (4) PAYROLL DATA - value = `<priced> of <total>` worker-weeks, viz =
        two chips (unpriced hours, last feed), action = pipeline detail popover.
- V8-15 COLOR DISCIPLINE (binding): state pills are neutral grey by default. Color appears
        only on (a) the verdict pill, (b) the lead Over/under card's accent and value, (c) any
        card whose state is WATCH or worse (amber/red), (d) genuine warnings. A healthy page is
        calm; color means "look here". No viz element may stretch to fill its row - every viz
        sits in a fixed-height stack.
- V8-16 Thresholds shown in card copy (OT watch 8%, alarm 12%) come from configuration, not
        hardcoded strings, and the same values drive the gauge band.

## F. Details strip (V8-17)

- V8-17 One bordered strip titled ALL THE NUMBERS, six cells with vertical dividers (not six
        cards): Budget, Spent to date, Rolling target, Pace, Projected end, Unpriced hours.
        Cells whose value does not apply render a dash and mute the value color. Collapsible;
        state persisted.

## G. Cross-cutting (V8-18..V8-20)

- V8-18 One help pattern only: a 20px circular `?` opening a popover (verdict bands; budget
        lines). No dotted-underline help text anywhere.
- V8-19 Every number on the board traces to the payload; nothing is illustrative. Where a value
        cannot be computed (no budget, salaried-only, envelope account), the element is omitted
        or dashed with a stated reason - never a placeholder figure.
- V8-20 Gates persist and add: zero `Numbers|Visual` toggle references, zero retired metric-card
        component references, zero hardcoded threshold literals in card copy.

## H. Addendum - range-adaptive week strip (V8-21..V8-25, approved 2026-08-17)

V8-12's last clause under-specified multi-period ranges. FYTD produced 33+ week columns, the
strip wrapped to a multi-row grid, every row got its own baseline, and the story panel grew
past 1,500px. This addendum makes the strip range-adaptive; single-period behavior is
unchanged.

- V8-21 THREE TIERS chosen by week count in the visible range:
        - TIER A (<= 6 weeks · a single period or a short custom range): unchanged from
          V8-12. Per-week columns with captions, verdicts, rolling targets, in-progress
          treatment.
        - TIER B (7 to 13 weeks): ONE row of compact bars, no captions. Shared vertical scale
          across every bar. A stepped dashed budget line drawn over the bars (steps at period
          boundaries where the weekly budget changes). Week labels on alternating columns
          only. Per-bar detail on hover/focus: week dates, actual, budget, delta. Same color
          rules (green under, red over, hatched navy in progress).
        - TIER C (> 13 weeks): the strip CHANGES GRAIN to one bar per FISCAL PERIOD. Each bar
          carries its period budget as a dashed line and beneath each: period label, actual,
          and the delta with its arrow. Title changes to `THE RANGE · PERIOD BY PERIOD`.
          Week-level detail is not lost; it lives in the table below, where a period band
          expands to its weeks.
- V8-22 Scale + layout: ONE shared vertical scale per strip (max of actual, budget across the
        visible set, plus ~10% headroom). Never scale a bar against its own cell. The strip
        NEVER wraps to a second row. If the item count would not fit legibly, move up a tier
        (weeks -> periods). Tier B and C are single-row flex; bars shrink, they do not wrap.
        Strip has a bounded height (~150px plot + axis); story block stays under about 320px
        total at any range.
- V8-23 The left panel must not stretch. Remove the bottom-align coupling between the two
        panels. Left panel sizes to its own content (align-self: start) with a fixed internal
        rhythm - eyebrow, headline, stat rail, track. A tall right panel must never open a
        void in the left one.
- V8-24 Range-dependent elements switch off honestly. Rolling target, projected period end,
        and the in-progress week treatment apply to Tier A only. In Tiers B and C they are
        omitted, not zeroed, not dashed inside the strip. Legend pills follow: Tier A shows
        original + rolling; Tier B shows the weekly budget line; Tier C shows the period
        budget line.
- V8-25 Color weight. Over-budget bars use the lighter red (#DC5A5A family), not the darkest
        red. At Tier C a run of over periods reads as information, not as an alarm wall.
        Green, red and hatched-navy remain the only three bar states.
