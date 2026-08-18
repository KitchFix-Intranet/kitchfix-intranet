# KPI V30 SPEC - THE FIX: one type role table, one control height, one card skin
# Derived from a live pixel audit of /kpi/labor on 2026-08-18. Locked on approval.

Scope: the KPI labor page only. Amends V29. Commit-safe. This is intended to be the LAST design
pass on labor before purchasing begins.

## 0. What the audit measured (218 text elements, 34 type combinations, every card and control)

The page is not inconsistent by accident in a hundred places - it is inconsistent in FOUR
specific ways, and each has a single mechanical cause. Fixing those four closes it.

FINDING 1 - THE TYPE SCALE HAS A CLIFF. V29 declares five steps: 10 / 11 / 12.5 / 20 / 30.
The ratio between 12.5 and 20 is 1.6x with nothing between. Every time a value or a caption
needs to be "medium", there is no step, so one gets invented: 16, 16.2, 18 and 19.44px all
exist on the page today, used by 1-8 elements each. That is why the count is 8 rendered sizes
instead of 5. A scale is only obeyed if it has the step people need.

FINDING 2 - ONE ROLE, SIX RENDERINGS. The LABEL role (uppercase tracked eyebrows) is rendered
six different ways on one page:
  folio title 11.25/800/0.675 · folio group 9.9/800/0.79 · spend eyebrow 9.9/700/0.79 ·
  signal eyebrow 9/800/0.72 · table header 9/800/0.63 · numbers label 9/800/0.81
Three sizes, two weights, five tracking values, for the same job. This is the single largest
contributor to "it feels off" - the eye reads the same kind of thing at different weights and
cannot settle. The tracking values are the tell: 0.63 / 0.675 / 0.72 / 0.79 / 0.81 are all
"about .07em" set by hand per component. Nobody decided them; they accreted.

FINDING 3 - FIVE CONTROL HEIGHTS. Measured: 25 / 27 / 28 / 30.6 / 39.6 / 46.8. The table
control bar alone has 27px chips beside 25px segmented controls. The command bar is 30.6, the
freshness pill 28. These are the small elements the eye lines up across a row, and none of them
share a height.

FINDING 4 - TWO CARD SKINS. The outer story card is radius 12; every other card on the page is
radius 10. The spend card's inner cells pad 10.8; the signal cards directly beneath pad 14.4.
The main column pads 12px, which is on neither the 10.8 nor the 14.4 step - a raw literal.

What is ALREADY RIGHT and must not be touched: the six-step spacing scale holds (3.6 / 7.2 /
10.8 / 14.4 / 18 measured, all on the 4px base); the board rhythm is a consistent 10.8 between
blocks; the signal-row lanes from V29-19 hold (hero tops 47.8 = 47.8); the folio and command
bar were approved and are the reference the rest is being aligned TO.

## 1. THE TYPE ROLE TABLE (V30-1) - replaces V29-1's five steps

Six steps, chosen so the ratios are smooth (1.10 -> 1.14 -> 1.20 -> 1.33 -> 1.40) and so there
is a real MEDIUM step, which is the missing rung that caused Finding 1. Every text element on
the page maps to exactly one row. Base px, then rendered at --kf-scale 0.9:

  ROLE     BASE  @0.9   WEIGHT  TRACK   CASE   USED FOR
  label    10    9.0    800     .08em   UPPER  every eyebrow, card title, table header, cell
                                               label, group label, tbar label, SYSTEM label
  meta     11    9.9    500     0       -      every sub-line, caption, axis, date, help text
  body     12.5  11.25  600     0       -      body text, control text, table cells, folio keys
  medium   15    13.5   800     -.005em -      secondary values: spent/left in the spend card,
                                               numbers-strip values, folio title, table total
  value    20    18.0   800     -.01em  -      tertiary hero: budget footer, big-but-not-hero
  hero     28    25.2   800     -.018em -      ONE per card: spend budget, signal heroes

Rules that make it hold:
  R1  There is no seventh step. Nothing renders at 16, 16.2, 18 (except value), 19.44, 27, 30.
  R2  A hero string longer than 11 characters renders at VALUE, not at an invented size.
  R3  Glyphs inside a number (the ▼ ▲ arrows) render at the number's size and weight. Today
      the arrow is 19.44px inside a 27px figure - a broken lockup. The arrow is text, not an
      icon; it inherits.
  R4  Tracking is set ONCE per role in the token, never per component. The five hand-set
      tracking values collapse to two: .08em on label, negative on medium/value/hero.
  R5  The command bar and folio keep their approved values (title 18/700, meta 11, control
      12.5, folio key 12.5/700, folio desc 10) - those are the reference. Where a chrome value
      coincides with a role above it is the same token; where it does not, it stays as chrome.
  Tokens: --kpi-t-label / -meta / -body / -medium / -value / -hero, all calc(base * --kf-scale).

## 2. ONE CONTROL HEIGHT (V30-2)

Every control on a KPI surface is ONE of two heights, and the two have a defined relationship:
  --kpi-ctl      30px base (27 @0.9)   every button, chip, segmented control, pill-button,
                                        select, help control, on the command bar AND the table
                                        control bar AND anywhere else
  --kpi-row      40px base (36 @0.9)   every clickable ROW: folio account rows, table rows
The folio GROUP header row may be taller (it is a two-line lockup) but is a token, not a
literal: --kpi-row-2l 48px base. The freshness pill and state pills are --kpi-lane-head (20)
and are not controls - they are labels. Nothing else. The measured 25 / 27 / 28 / 30.6 collapse
to 27; 39.6 / 46.8 become 36 / 43.2.
Radius: every control 8px base (7.2 @0.9). The measured 0 / 7 / 8 / 50% / 999 collapse to
7.2, except pills (999) and circular help (50%), which are the two named exceptions.

## 3. ONE CARD SKIN (V30-3)

Every card on the page - story, spend inner cells, signal cards, numbers strip, folio cards,
the table container - shares:
  radius        12px base (10.8 @0.9)   [story was 12 raw, others 10 raw; both become 10.8]
  border        1px --n-300
  shadow        the existing --card-shadow token, no exceptions
  padding       16px base (14.4 @0.9) on every card that has padding [spend inner cells were
                10.8 - they become 14.4 like the signal cards beneath them]
  inner gap     12px base (10.8) between blocks inside a card
Nested cards (spend budget/cells inside story) use the same skin minus the shadow, so nesting
reads as depth, not as a different component.
Main column padding becomes 16px base (14.4) - the raw 12px is removed.

## 4. LANES GENERALISED (V30-4)

V29-19 gave the signal row four shared lanes. The same discipline applies to the SPEND CARD and
the NUMBERS STRIP so all three blocks in the board share a header lane:
  --kpi-lane-head 20 base: the first line of EVERY card - eyebrow left, pill/hint right - is
  this tall and its baseline is the same across the story card, every signal card, and the
  numbers strip header. Acceptance: computed top of the first text element in each of those
  five containers is identical to within 1px at 1180 / 1280 / 1440.

## 5. THE GATE (V30-5) - what stops it drifting again

Extends V29-4. Reported as numbers on every KPI PR from now on:
  a. distinct rendered font-sizes on /kpi/labor product surfaces (excluding topnav): target 6
     (+ the chrome's title 18) - anything above 7 is a bounce
  b. distinct control heights: target 2 (+ the folio 2-line row) - anything above 3 is a bounce
  c. distinct card radii: target 1
  d. raw px literals for type/spacing/height/radius outside the token block: target 0
  e. lane-head parity across story / signals / numbers: 5 values, identical within 1px
The measurement script that produced this audit is committed as
scripts/_audit_kpi_scale.mjs so the numbers are reproducible, not argued.

## 6. WHAT THIS IS NOT

Not a redesign. No layout changes, no new components, no rulings on content. Every element
stays where it is; it gets re-dressed onto six type roles, two control heights, one card skin,
one lane baseline. The page should look like a cleaner version of itself, not a different page.
