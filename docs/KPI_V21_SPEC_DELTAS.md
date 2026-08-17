# KPI V21 SPEC DELTAS - board simplification - approved 2026-08-17

Status: LOCKED. Amends KPI_V7_SPEC_DELTAS_BOARD.md (V8-1..V8-25). Reference render:
kitchfix-kpi-v20-board.html (Kevin's LOCAL file). IMPORTANT: that render was produced by
successive patching and carries known CSS defects - the 3px accent overlaps the half labels,
the budget label and value run together, and some sub-lines clip. Treat the render as LAYOUT
INTENT ONLY; this document carries the values. Where they disagree, this document wins.
Commit-safe: no client dollars.

## A. Deletions (V21-1..V21-4)

- V21-1  DELETE the sentence card (the verdict pill + plain-language line above the story
         block, V8-6). Its verdict survives per V21-5. The sentence copy helper is retired -
         remove it and its tests/usages.
- V21-2  DELETE the budget track from the spend card: the rail, the spent fill, the hatched
         projection, the TODAY marker, the PROJECTED PERIOD END label and the three-key row.
         `projected_period_end` remains in the payload and continues to render in ALL THE
         NUMBERS; it is only removed from this card.
- V21-3  DELETE the three-stat rail (Workers / Hours / Avg rate) from the spend card. Workers
         and Avg rate relocate per V21-11; Hours already lives in the table and is NOT
         duplicated.
- V21-4  DELETE from the week strip: the `original` and `rolling` legend pills, the `$ / hrs`
         lens toggle (dollars only from here), and the `?` help control. The lens state key is
         retired.

## B. The spend card (V21-5..V21-9)

- V21-5  Header row: `<PERIOD LABEL>` + resolved dates on the left, verdict pill right-aligned
         (this is where the deleted sentence card's verdict lands). Pill text
         `ON TRACK · $X UNDER` / `WATCH · ...` / `OVER BUDGET · $X OVER`, bands unchanged
         (V8-7).
- V21-6  SPLIT BLOCK: one bordered container, `1px var(--n-200)`, radius 10, two equal halves
         in a `1fr 1fr` grid with a `1px var(--n-200)` divider between them. Equal halves are
         the point - the two figures must never differ in height.
         Each half: padding 14 (scaled), `position: relative`, a 3px top accent, and content
         top-padded so the accent NEVER overlaps the label (this is a defect in the render).
         - Left half - neutral: accent `var(--n-300)`, background white.
           Label `Spent so far` / value / sub `<n>% of budget`.
         - Right half - tinted, carries the accent gradient:
           in-progress -> label `Left to spend`, value = budget minus spend to date, sub
           `<n> weeks remaining`; accent `linear-gradient(90deg, var(--navy-700), #2C5187)`,
           background `linear-gradient(180deg,#F2F6FC,var(--navy-100))`, text navy-700.
           closed + under -> label `Under budget`, green variants of accent, background and
           text (green-700 / green-100).
           closed + over  -> label `Over budget`, red variants (red-700 / red-100).
         Type: label 9.5px/800 tracking .1em uppercase; value 28px/800 letter-spacing -.012em
         tabular; sub 9.5px. All three nowrap; sub ellipses rather than wraps.
- V21-7  FOOTER row, anchored to the bottom of the card above a `1px var(--n-200)` rule:
         `Budget` label (9.5/800/.1em uppercase) + an explicit gap + value 17px/800 tabular +
         right-aligned context `<n>% of period gone` (closed ranges: `period closed`). The
         missing gap between label and value is a defect in the render - it is required here.
- V21-8  No bar, meter, ring or track of any kind on this card. The only marks are the split
         block's accents.
- V21-9  Envelope accounts (TXR - TX - V), salaried-only accounts and ranges with no budget:
         the right half renders a muted dash with the reason as its label (`no budget`,
         `envelope-based`); the footer shows a dash. Never a zero, never a fabricated figure.

## C. The week strip (V21-10)

- V21-10 One flat dashed target line at the ORIGINAL weekly budget, spanning the whole plot
         band continuously (not per-column segments), labeled ONCE at the right of the strip
         header: `╌ weekly target $X`. Per week:
         - closed: bar colored by strict sign vs its own weekly target, caption value, dates,
           and `▼ $X under` / `▲ $X over`.
         - in progress: AMBER hatched bar; caption value is spend so far; status line beneath
           the dates in amber reading `running · $<allowance> allowance`.
         - not started: thin base rule only; caption value is the allowance in navy with
           `to stay on budget` beneath.
         Tier B and Tier C (V8-21) are unchanged and carry no captions.

## D. Allowance math - SERVER DEFECT, currently wrong on production (V21-11..V21-12)

- V21-11 `rolling_weekly_target` (V8-3) divides by the wrong denominator. It currently uses
         WEEKS NOT STARTED, which silently assumes the running week will cost nothing. On
         CIN - AZ Period 9 that produces an allowance roughly 50% too high and tells operators
         they have room they do not have.
         CORRECT: remaining budget divided by every week that is NOT FINISHED - the running
         week plus the weeks not started.
           remaining = period budget - spend to date (all weeks, including the running one)
           denominator = 1 (if a week is in progress) + count(weeks not started)
         Verification identity that must hold: `spend to date + denominator x allowance =
         period budget`, to the cent. The probe asserts it.
         Clamp at zero with `budget_exhausted: true` when remaining is negative, unchanged.
- V21-12 The corrected allowance is the ONE allowance figure on the page. It appears in the
         in-progress week's status line, in the not-started weeks' captions, and in ALL THE
         NUMBERS as `Weekly allowance`. The old `Rolling target` label is retired.

## E. ALL THE NUMBERS (V21-13)

- V21-13 Two labeled groups side by side inside the existing strip, each four cells:
         BUDGET - Budget, Spent to date, Pace, Projected end.
         CREW   - Workers (distinct people), Avg rate (blended), Weekly allowance, Unpriced
                  hours.
         Group labels 9.5px/800 tracking .09em uppercase n-500. Collapsed-by-default and
         persistence unchanged (V8-12/S-12).

## F. Cross-cutting (V21-14..V21-16)

- V21-14 Every number on the board is stated ONCE. Specifically: the allowance appears in the
         strip captions and in CREW, never additionally as a legend pill or chip row; spent
         appears in the split block and the table, not in a third summary.
- V21-15 All new dimensions come from the `--kpi-*` token family through `--kf-scale` (S-2/S-6).
         No raw px for type, spacing, control or panel sizing.
- V21-16 Gates persist and add: zero references to the retired sentence card, the budget track,
         the stat rail, the lens toggle, and the `Rolling target` label.

## G. Signal cards - simplification (V21-17..V21-24) - approved 2026-08-17

Reference render: kitchfix-kpi-v22-signal-cards.html, treatment **B (viz-led)**, Kevin's LOCAL
file. Same warning as above: layout intent only, values below win.

- V21-17 DELETE the action link from every signal card (`See budget by week ›`, `See OT by
         worker ›`, `See hours by week ›`, `Pipeline details ›`) and the hairline rule above
         them. The card is a readout, not a navigation surface. Anything those links pointed
         to remains reachable from the table and the freshness-chip popover.
- V21-18 DELETE the prose sentence line from every card. No card contains a sentence. What
         survives is: eyebrow + state pill, one composed figure, and at most one short
         sub-line that is a label, not a clause.
- V21-19 Card anatomy, identical across all four: header lane (eyebrow left, state pill right,
         fixed height) then a centred content region that fills the remaining height. All four
         cards are equal height at every viewport - verify by computed style.
- V21-20 OVER / UNDER BUDGET: value = signed variance (28-30px/800, green under, red over);
         sub-line `of a $<budget> budget`; visual = diverging bar around a centred zero. The
         `$X remains vs pace.` line is deleted.
- V21-21 OVERTIME: the arc becomes the card's centrepiece - larger, horizontally centred, with
         the PERCENTAGE SET INSIDE the arc. Sub-line `<n> OT hrs of <n> worked`. The
         `8% watch` and `12% alarm` labels are deleted BUT the amber threshold band on the arc
         REMAINS, unlabeled (owner ruling): it is silent while the account is clear and becomes
         self-explanatory the moment the green arc reaches it. The band's start and end still
         come from the OT watch and alarm configuration, never hardcoded.
- V21-22 HOURS VS BUDGET: reads as a fraction - used over budgeted - `<used> of <budgeted>`
         with the numerator at value size and the denominator smaller, sub-line
         `budgeted hours used`, then the average rate as a pill beneath (`avg rate $X/hr`),
         then a bullet track with the elapsed marker. This replaces the previous value + unit +
         sentence stack.
- V21-23 PAYROLL DATA: value `<priced> of <total>`, sub-line `worker-weeks priced`, and a row
         of tick marks - one per week in range - beneath. CAP (owner ruling): the tick row
         renders only when the range holds 13 weeks or fewer. Above that it is omitted entirely
         and the card carries the value and sub-line alone; ticks past a dozen read as texture
         rather than a count. The `0.00 unpriced hrs` and `last feed` chips are deleted - both
         live in the SYSTEM strip and the freshness popover.
- V21-24 Colour discipline (V8-15) is unchanged and now matters more: with the prose gone, the
         state pill and the lead card's accent are the only colour a healthy board carries.
