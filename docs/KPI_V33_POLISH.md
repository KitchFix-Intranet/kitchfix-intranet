# V33 QUEUE - final polish + one data finding (measured 2026-08-18)

## P0 REGRESSION - the facts grid is four columns, not two (measured on live #701)

`.kpi-sig-facts` renders `grid-template-columns: 57.625px 57.64px 57.625px 57.64px` - all four
facts side by side in a 294px card. Each cell gets 57.6px. Measured requirement: the widest
label `Dollars will rise` needs 101px and the widest value `▼$4,124.71` needs 96px. Result:
EIGHTEEN clipped elements across the row - `SHOULD ...`, `PROJECT...`, `LONGEST...`, `$3,43...`,
`$11,3...` on every card.

Fix: `grid-template-columns: repeat(2, minmax(0, 1fr))` so four facts wrap 2x2. At 294px cards
with 14.4px padding that gives ~124px per cell against the 101px needed. Verify by measuring
`scrollWidth <= clientWidth` on every `.kpi-sig-fact-lab` and `.kpi-sig-fact-val` at
1180 / 1280 / 1440 - zero clipped is the acceptance, not "looks better".

## P0 COPY DEFECT - the pace sub-line contradicts its own hero

CIN - AZ P9 renders hero `▼ $1,330.22` (green, under pace) with the sub-line "**ahead** of an
even burn, 32% into the period". Verified: spent 3,431.89 against a prorated 4,762.11, so the
account is BEHIND pace - spending less than planned. The arrow and colour are right; the words
say the opposite, and words win when someone reads them aloud on a call.
Fix: the sub-line follows the SIGN - negative variance reads `behind an even burn, <n>% into
the period`, positive reads `ahead of an even burn, <n>% into the period`. Add a probe
assertion tying sub-line wording to the sign so the two can never disagree again.


## P0 - the comparison strip is not part of the card family (owner ruling)

Renders today as a two-line tinted grey block with no dividers and a stacked title - it reads as
a separate component sitting under the row rather than the last member of it. Rebuild per
kitchfix-kpi-v44-strip-facts.html:
  - white ground, `1px var(--n-300)` border, the standard card shadow, `--kpi-card-r` radius;
  - a 4px LEFT ACCENT in purple (--kpi-purple-600 #7A3E9D), matching the accent rule every
    signal card carries, so it reads as the same family;
  - ONE row at `--kpi-row` (36 rendered), not two lines;
  - HAIRLINE DIVIDERS after the title and between every measure - these are missing entirely
    today and are what makes it read as a list rather than a run-on;
  - the sub-label "same measures, scale-free" moves INTO the `?` popover;
  - the source note (`Period 7 · 4 wks closed`) sits right-aligned before the `?`.

## P0 - double negative in the strip

Blended rate renders `▼ -$1.21` - an arrow AND a minus sign. The arrow carries direction; the
value is ALWAYS absolute. Every other signed figure on the board already follows this rule
(V29-18). Apply it to every strip measure, not just this one.

## P1 - fact labels shortened, type size unchanged

Owner asked whether fact type should shrink. Ruling: NO - the clipping was a column-count
problem, fixed by the 2x2 grid above, and the type scale was settled in V30. Instead shorten
three labels that are inherently long:
  `Dollars will rise` -> `Will rise`
  `Longest OT week`   -> `Peak OT week`
  `Per worker/wk`     -> `Per worker`
If the row still reads heavy after 2x2, the ONLY sanctioned lever is stepping fact VALUES from
`--kpi-t-medium` to `--kpi-t-body` - an existing step. Do not invent a size.

## P1 - payroll sub-line runs together and clips

Renders `worker-weeks with pay data in· 14.98 hrs need approva` - missing space before the
middot separator, and truncated. Fix the separator spacing and let the line wrap to two lines
inside `--kpi-lane-sub` (or shorten to `14.98 hrs need approval in Rippling` on its own line).


## P0 DATA FINDING - not a code bug, needs an owner decision

STL - FL reads **187% of budget in P8 and 175% in P7**, and the cause is in the budget data,
not the board. Its FY2026 3100.1 budget by period:
  P1 10,021.70 · P2 49,250.68 · P3 111,072.62 · P4 29,206.09
  P5 21,761.40 · P6 21,761.40 · P7 21,761.40 · P8 21,761.40 · P9 21,761.40
  P10 12,598.71 · P11 11,453.37 · P12 8,590.03 · P13 0
Five consecutive periods at an identical figure, surrounded by periods that all differ - the
signature of a flat-lined allocation. STL - FL actually spends ~38-41k in those periods, so the
budget is roughly half of actual and the account will read 170-190% over for five straight
periods.

The board is faithfully reporting kpi_budgets. Two possibilities, both for Kevin/Sebastian:
  a. the FY2026 P&L budget for STL - FL P5-P9 is genuinely flat and genuinely low (an upstream
     budgeting decision or error), or
  b. the seed mapped those periods wrong.
Until it is resolved, STL - FL's board is not usable for pace decisions, and a permanently red
account trains operators to ignore red. NO CODE CHANGE proposed here - this is a data question.
Worth one line in the account-services brief once answered.

## What the math audit CLEARED (no action)

Reconciled to the cent across CIN - AZ, STL - FL, TBR - FL, TXR - TX - H, ALL and EAST for P8:
  board.spent_to_date == sum(actuals rows) == sum(week rows)        delta 0.00
  board.hours == sum(row hours)                                    delta 0.00
  board.ot_hours == sum(hours_overtime)                            delta 0.00
  avg_rate == amount / hours                                       exact
  variance == spent - budget                                       exact
  pace_pct == spent / budget x 100                                 exact
AGGREGATE: ALL P8 budget 161,570.95 / spent 176,541.44 / hours 7,969.43 / OT 781.13 each equal
the sum of the ten non-envelope members EXACTLY (all four deltas 0.00). The V25 population fix
holds. TXR - TX - V excluded from both sides per budget_notes.
Also confirm-on-glass item: CIN - KY and TBJ - NY return no budget and no spend for P8 (seasonal
MiLB sites out of season) - verify they render the omission state, never zeros.

## 1. Bottom-left corner is square (P2, measured)

`.kpi-folio` has `border-bottom-left-radius: 0px` and the app wrapper has `overflow: visible`,
so the folio's bottom-left corner is square while every other corner of the shell is rounded.
Measured: folio bottom 1263, app bottom 1296 - the folio also stops 33px short of the shell
foot, which is why the square corner is visible at all.
Fix: `.kpi-folio { border-bottom-left-radius: var(--kpi-card-r) }` AND the folio column stretches
to the shell foot so the radius sits on the actual corner. If the shell clips, set
`overflow: hidden` on the app wrapper instead - state which you used.

## 2. Hover and shadow audit (P2)

Present and correct: `.kpi-ctl`, `.kpi-fresh`, `.kpi-tbar-chip`, `.kpi-tbar-btn`, `.kpi-gcard`,
`.kpi-acct`, `.kpi-help`, `.kpi-pchip`, `.kpi-wk-item`, `.kpi-tbl-week`, `.kpi-rmenu-item`.
Gaps to close:
  a. `.kpi-seg button` has NO hover - the Names/Numbers and Comfortable/Dense controls give no
     feedback on the un-selected side. Add a hover on the inactive option only.
  b. `.kpi-det-h` (the ALL THE NUMBERS header) is a button with no hover, so a collapsible
     header looks inert. Add the same treatment as `.kpi-tbar-btn`.
  c. `tbody tr` on PERIOD BAND rows: week rows hover, band rows do not, yet both expand. Match.
  d. FOCUS-VISIBLE: only `.kpi-bB` declares one. Every interactive element needs a visible focus
     ring for keyboard use - add a single shared `:focus-visible` rule rather than per-component.
Shadows: `.kpi-sig`, `.kpi-gcard`, `.kpi-det`, `.kpi-story` all carry the same token - correct,
no change. Nested cards (spend budget/cells) correctly carry none.

## 3. ALL THE NUMBERS header is too tall (P2, measured)

Measured 48px with `var(--kpi-card-pad)` on all sides. It is a header, not a card body.
Fix: padding becomes `var(--kpi-sp-2) var(--kpi-card-pad)` -> about 36px tall, matching
`--kpi-row`. The label size is already `--kpi-t-label`; do not shrink type, only the box.

## 4. Last polish (P3, my own sweep)

  a. `Unpriced hours` still reads that way in ALL THE NUMBERS while the payroll card will say
     `Unapproved hrs` after V32 - the rename must be global (table column, numbers strip, week
     strip chip, popover) or the vocabulary fragments. Same call as V32-10.
  b. `Vs last period` on the Overtime card renders an em-dash because the payload has no
     prior-period OT figure. V32-7 removes the fact; make sure it is removed and not left
     dashing.
  c. `Weekly allowance` in ALL THE NUMBERS shows a bare dash with `does not apply` on closed
     periods. Correct behaviour, but the dash is `--kpi-t-medium` sized in a cell whose siblings
     carry real numbers - render it at the same size but in `--n-300` so it reads as absent
     rather than as a value.
  d. The week strip's `original $3,810.31` legend renders on a CLOSED period where there is no
     adjusted line to distinguish it from. On closed periods label it `weekly target` - the word
     "original" only means something when an adjusted line exists beside it.
  e. `TOTAL · PERIOD 8` in the table and `PERIOD 8` in the spend card eyebrow use different
     casings of the same label (`Period 8` vs `PERIOD 8`). Pick one - the label role is
     uppercase, so uppercase both.
