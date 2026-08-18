# NEXT PR QUEUE - items to fold into whichever KPI PR follows V30

## 1. Freshness popover - derive timestamp reads the wrong row (P1, trust)

Cause verified in source, do not re-diagnose. `src/app/api/kpi/labor/route.js` ~line 388:
    last_derive_at: actualsRows[0]?.derived_at || null
That is the `derived_at` of the FIRST ROW of the result set (sorted by week/account, not by
recency), not the last time the derive job ran. Derive is incremental and only rewrites rows
whose inputs changed, so settled weeks keep old timestamps and the popover shows "Aug 12" while
the walk shows "Aug 18" - reading as a five-day lag that does not exist. Verified live: the
current week (Aug 17-23) already carries rows, hours and dollars, which is impossible if derive
had stopped on Aug 12. Walk and derive run as ONE nightly job at 07:00 UTC
(.github/workflows/rippling-sync.yml, "walk 4 raw objects + derive labor_actuals").

Fix:
  - `last_derive_at` = MAX(derived_at) across the rows in scope, or better, the derive job's
    own recorded run timestamp if one exists (prefer the job timestamp; report which you used).
  - Plain-English labels in the popover, one line each:
      "Rippling data pulled"       -> the walk timestamp
      "Dashboard figures rebuilt"  -> the derive timestamp
  - Add one sentence to the popover so operators know the freshness contract:
      "Updates nightly around 2:00 AM CT. Hours land as timesheets are approved; dollars land
       when payroll processes, so the current week reads as partial until then."
  - The freshness chip's colour logic is unchanged.

Acceptance: on glass, the two timestamps in the popover are the same night (walk and derive
run together); the labels read as above; the sentence is present.

## 2. Two literals V30 missed - measured live after #698 (P1, gate)

The V30 audit script counted TOKENS; the live browser check counted PIXELS, and found two
classes that were never converted:
  - `.kpi-seg` (the Names/Numbers and Rows segmented controls in the table bar) renders 25px
    tall beside 27px chips - the exact pair the audit flagged. Convert its height to --kpi-ctl.
  - `.kpi-gcard` (folio cards) still carries a raw radius 10 while everything else is
    --kpi-card-r (10.8). Convert it.
Fix the audit script so it measures rendered pixels for control heights and radii, not token
references - otherwise this class of miss recurs.
Acceptance: live control-height set is exactly {27, 36, 43.2} and radius set is exactly {10.8}.

## 3. Signal cards - remove the visuals (approved treatment A) (P2, design)

Reference render: kitchfix-kpi-v36-signals-noviz.html, treatment A, LOCAL. Rulings:
  - Delete the diverging bar from Over/under, the arc from Overtime, and the worked/left bar
    from Hours. No SVG or bar element remains in any signal card.
  - Lanes are unchanged: head 20 / hero 38 / sub 16. Where the visual lane was, a FACTS ROW:
    a two-up (three-up on the double card) grid of label + medium-size value, separated from
    the lanes above by a hairline, pinned to the card foot.
      Over/under: Spent · Pace (pace value coloured by state)
      Overtime:   Watch line 8% · Vs last period (signed, arrowed, coloured)
      Hours:      Worked · Budget left · Blended rate
  - Every signed figure carries ▼/▲ and colour: green under, red over, amber for watch.
    Overtime's hero turns amber when it crosses the watch line, red at alarm.
  - The 12% alarm label is dropped from copy; only the 8% watch line is stated. Alarm still
    drives the pill and hero colour from config.
  - Pills and left-edge accent unchanged (state word only).
Acceptance: hero-top parity still holds across the three cards; zero <svg> or bar elements in
.kpi-sig; each card's facts row is present with the fields above.

## Chrome control height - OWNER DECISION PENDING
V30-2 pulled the command-bar controls from 34 to 30 base. Kevin to rule: keep 30 (one control
height, gate [b] = 2) or restore 34 (approved header exactly as signed, gate [b] = 3, passes).

## 4. ALL THE NUMBERS - content jammed against the card edge (P2, measured)

Measured live: `.kpi-det-grp` pads `10.8 14.4 10.8 14.4`, putting the group label and the first
value 15px from the card edge with only 10.8 above - the content sits on the line. The header
`.kpi-det-h` pads 14.4, so the group is not even flush with it (0.6px offset). The signal cards
directly above pad 14.4 all round; the strip reads tighter than its neighbours.

Fix - one skin, same as every card (V30-3):
  - `.kpi-det-grp` padding: `var(--kpi-card-pad)` on all four sides (14.4 @0.9). Left group and
    right group identical; the right group's extra `--kpi-sp-6` left inset (V21-9, "clear the
    divider") is applied IN ADDITION to the pad, not instead of it.
  - Group label to first cell: `--kpi-sp-2` (7.2) below the label, so BUDGET has air under it.
  - Header content and group content align to the same left edge (both 14.4).
Acceptance on glass: distance from card edge to the group label and to the first value are
identical and equal to the header's inset; vertical pad above the group label equals the
horizontal pad; the strip's inner inset matches a signal card's inset to the pixel.

## 5. Folio account rows - no breathing room (P2, measured)

Measured: `.kpi-gcard` rows are 46.8px tall with `7.2px 10.8px` padding, and the two-line lockup
(key 12.5 + description 10) fills the row edge to edge - 11px of air below, effectively none
above the key. Reads cramped against the row dividers.
Fix: row padding `var(--kpi-sp-3) var(--kpi-sp-3)` (10.8 all round) - vertical goes 7.2 -> 10.8.
Row height is content-driven; do not fix it - the taller row is the intent. Keep the selected-row
inset accent. Acceptance: air above the key equals air below the description, both >= 10px.

## 6. Week strip - plot is centred in dead space instead of bottom-anchored (P1, measured)

Measured on the right panel of the story card at an FYTD range: panel 243px tall, plot fixed at
135px, sitting 44px from the top with **64px of empty space beneath it**. Because the tallest
bar is only 15% of the plot, the chart floats mid-panel over nothing.
Two rulings:
  a. BOTTOM-ANCHOR the plot: it sits at the panel foot (captions last), the header stays at the
     top, and any spare height goes ABOVE the plot, not below. Today the 64px gap is under the
     captions - it belongs above the bars.
  b. LET THE PLOT GROW: plot height = the panel height minus header minus captions minus gaps,
     with `--kpi-lane-viz + --kpi-sp-6` as the MINIMUM, not the fixed value. At FYTD that means
     the bars get roughly 135 + 64 = ~199px of headroom instead of 135. Bars scale into it
     (shared max unchanged, V8-22).
  Tier A / B / C keep their own caption rules; only the plot's anchoring and growth change.
Acceptance on glass: at FYTD, distance from the caption row's bottom to the panel's bottom
padding is 0 (+/- 1px); the plot is taller than 135px; at a single 4-week period the layout is
unchanged in reading order.

## 7. ALL THE NUMBERS - values touch the left rule (P2, measured) - extends item 4

Measured: in both groups the label sits 14px from the group's left edge and the first VALUE
sits 16px - both are inside `--kpi-card-pad` (14.4) and the value has its own 10.8 right-pad
but no left. On the right group the divider is at 21.6 and the value at 24 - 2.4px from the
line. That is the "text hitting the line" in the screenshot.
Fix (with item 4's padding change): every `.kpi-det-cell` gets `padding-left: var(--kpi-sp-3)`
so the value column starts 10.8 inside the group's own pad; the right group's divider inset
becomes pad + sp-3 + the extra sp-6, so the value never sits closer than ~25px to a rule.
Acceptance: horizontal distance from any divider (card edge or group rule) to the nearest
value's left edge is >= 24px, identical for both groups.
