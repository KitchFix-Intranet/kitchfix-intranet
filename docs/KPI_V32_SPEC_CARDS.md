# KPI V32 SPEC - signal cards, the pace card, and the comparison strip
# Approved 2026-08-18. Amends V21/V29/V31. Commit-safe: no client dollars.

Reference renders (Kevin's LOCAL files, layout intent only, never committed):
  kitchfix-kpi-v43-final-cards.html   - the four cards + the strip, with both OT states
  kitchfix-kpi-v41-four-plus-strip.html - the row/strip hierarchy and the strip's empty state
Where a render and this document disagree, this document wins.

## A. THE PACE CARD - it is currently mislabelled (V32-1..V32-4)

The card titled OVER / UNDER BUDGET shows `spent - budget x elapsed%`, which is a PACE figure.
On STL-FL P9 it reads `+$909.44` while the account is $13,833.91 UNDER budget with 36% of the
money spent. An operator reading that card concludes the budget is blown. Verified live:
  spent 7,927.49 - (21,761.40 x 32.25% elapsed = 7,018.05) = 909.44

- V32-1  TITLE IS STATE-DEPENDENT, because the underlying figure changes definition:
           in progress -> `Spending pace`      hero = spent - budget x elapsed_frac
           closed      -> `Final vs budget`    hero = spent - budget
         A card that keeps one title across that change is telling two stories with one label.
- V32-2  Hero carries an arrow and colour (V29-18). Sub-line:
           in progress -> `ahead of / behind an even burn, <n>% into the period`
           closed      -> `period closed`
- V32-3  FACTS ROW, in progress: `Spent` · `Should be at` · `Projected end` (signed vs budget)
         · `Left to spend`. `Should be at` is the subtrahend the card silently divides by -
         putting it on screen makes the hero self-evident and is the point of this ruling.
         FACTS ROW, closed: `Spent` · `Budget` · `Of budget used` · `Left unspent` (or `Overrun`
         when over).
- V32-4  The `Projected end` fact is SUPPRESSED until at least one week has closed, rendering a
         muted dash with `needs a closed week`. A run-rate from two days of data is noise.

## B. OVERTIME (V32-5..V32-7)

- V32-5  THRESHOLDS CHANGE (owner ruling, supersedes the 8% watch / 12% alarm pair):
           0%            -> on target   (green)
           above 0 to 8% -> warning     (amber)
           above 8%      -> off target  (red)
         Both bounds are stated on the card once, beside the hero, as
         `watch above 0 · off target above 8%`. Thresholds come from configuration; the copy
         renders whatever the config holds, never hardcoded numbers.
         Reclassification is expected and intended - sampled live, STL-FL P9 at 2.34% moves
         from "clear" to WARNING and ALL FYTD at 10.28% stays off target.
- V32-6  FACTS ROW: `OT cost` (the 1.5x spend, from `dollars_overtime` which already exists on
         every actuals row) · `Hrs to target` when at or under the off-target bound, flipping to
         `Hrs over target` above it · `OT workers` (`<n> of <total>`) · `Longest OT week`
         (`<date> · <hrs>`).
         `Premium paid` is explicitly NOT a fact - it is the same dollars already counted inside
         `OT cost`, and two facts describing one number is the redundancy this pass removes.
- V32-7  `Vs last period` is NOT a fact on this card. The payload does not ship a prior-period
         OT figure, and the comparison lives in the strip (section D). Do not reserve a slot.

## C. HOURS LEFT + PAYROLL (V32-8..V32-11)

- V32-8  The signal row is FOUR EQUAL CARDS on `repeat(4, minmax(0,1fr))`. The Hours card
         returns to single width; the Payroll card is restored (it was retired in V29-15 to
         widen Hours, and that trade is reversed). Lanes and hero-top parity from V29-19 hold.
- V32-9  HOURS LEFT facts: `Per week` (hours left / weeks not finished) · `Per worker/wk`
         (that figure / distinct workers) · `Budget left` · `Blended rate`. `Worked` comes off
         the card - it is already in ALL THE NUMBERS. Per-week facts render a muted dash on
         ranges with no meaningful weeks-remaining denominator (closed periods, FYTD,
         multi-period) - the same omission rule as V8-19.
- V32-10 PAYROLL DATA is an ACTION card, not a data-completeness note. Unapproved hours mean
         someone must approve them in Rippling or those people do not get paid - it affects
         payroll, not just our actuals. Copy reflects that:
           hero `<priced> of <total>` · sub `worker-weeks with pay data in`
           facts: `Unapproved hrs` · `Dollars will rise` · `Weeks affected` · `Last pulled`
           when unapproved > 0 the sub-line adds `<n> hrs need approval in Rippling`
         State: FINAL when zero unapproved, PARTIAL when any.
- V32-11 `Dollars will rise` is an ESTIMATE (`unapproved hrs x blended rate`) and is marked as
         one: a dotted-underline label with a hover reading "Estimate. <n> unapproved hrs x
         $<rate> blended rate. Unapproved hours skew to whoever has not been processed, so their
         true rate may differ from the blend." The tilde stays on the value.

## D. THE COMPARISON STRIP (V32-12..V32-15)

- V32-12 A strip BENEATH the signal row, at CONTEXT weight - tinted ground, `--kpi-t-body`
         figures, no card chrome, no shadow, one row. It is not a fifth card: a card implies
         "act on this", a comparison implies "is this normal". Five equal cards at 1180px would
         be ~215px each and the row is for triage.
- V32-13 MEASURES - all SCALE-FREE, because mid-period totals are not comparable (P9 is 1.29 of
         4 weeks; raw hours would read -79%, which is noise dressed as news):
           `Blended rate` (signed $/hr) · `Overtime` (signed points) · `Crew size` (signed
           workers) · `Spend / week` (signed %) · `Hours / week` (signed %) · `Cost / worker`
           (dollars per person per week, signed %)
         Unapproved hours is NOT in the strip - it is an action owed, not a trend.
         Every item carries an arrow and colour; green is the better direction for that measure.
- V32-14 A `?` control at the right end opens a concise definition list - one line per measure -
         plus a footer stating that only rates and ratios appear because the current period is
         part-run. Same popover pattern as V29-18's single help affordance.
- V32-15 The strip RENDERS NOTHING when there is no comparable prior period - a first period, a
         custom range not aligned to periods, or an account with no history. It does not fall
         back to a partial comparison; a wrong denominator here reads as a real trend. In that
         case the title row alone renders, muted, with the reason.
         DATA NOTE: this is the only item in V32 needing new data - one prior-period query.
         Everything else is display work on fields already shipped.

## E. Out of scope, recorded so it is not re-litigated (V32-16)

- V32-16 CLICKABLE CARDS ARE REJECTED. Filtering the table from a card was built and reviewed
         and the owner declined: it adds an interaction model to cards that were just
         simplified, and it competes with the jump chips and expand/collapse the table already
         has. Location is carried as TEXT instead (`Longest OT week`, `Weeks affected`).
         Also rejected: a Crew card (no meaningful state; the figures live in ALL THE NUMBERS),
         trend sparklines, OT-by-worker on a card, and a period countdown.
