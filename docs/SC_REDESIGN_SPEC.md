# Service Calendar Redesign - Design Spec & North Star

Status: APPROVED DIRECTION (validated via interactive prototype, 2026-06).
This is the canonical reference for the SC redesign. Every build stage points
back to this doc. If code and this doc disagree, flag it - do not silently pick.

---

## 1. The core frame

We are RE-SKINNING A SOUND ENGINE, not rebuilding the system. The data layer
(`src/lib/dataStore/serviceCalendar.js`) and the API actions (`sc-load`,
`sc-year-summary`, `sc-submit-day`, `sc-bulk-submit`, `sc-admin-*`) are correct
and STAY. The redesign replaces the presentation layer in
`src/app/service-calendar/*.js`.

`#257` revenue correctness (the price_kind projected/actual fork) is untouched.
The redesign changes how revenue is DISPLAYED, never how it is computed.

---

## 2. The mental model: drill, not toggle (with ONE local toggle)

The old model conflated two orthogonal axes (scope x lens) and leaked that
complexity into the UI - mutating segments, "Period/Period", a lens that did
nothing at year scope, a month-grid that became a period-strip. All of that is
REMOVED.

The new model is VERTICAL drill (in/out), with exactly ONE localized toggle:

- You LAND on the Season level (the year), in Calendar view.
- At the Season level ONLY, a Calendar / Period toggle chooses how the year is
  sliced: by calendar month (Calendar) or by fiscal period (Period). This is the
  ONE toggle in the whole tool. It does not follow you down; it is a view
  preference on a single screen, mapping to the two real mental models operators
  hold (line cook thinks in months; RDO/finance thinks in periods).
- You DRILL DOWN by clicking a month or a period card -> you land in that unit.
- You CLIMB UP via the breadcrumb / a climb button.
- The Gregorian month-grid as a separate navigable surface is GONE. The month
  view exists only as the Calendar slice of the Season level.

---

## 3. The universal atom: the day-square

ONE day-square component is the atom of the entire tool. It renders identically
(scaling in size, never changing shape or color language) at every level:
the Calendar grid, the Period grid, and the Period workspace.

Status states (lifted verbatim from the live legend):
- Entered (actuals in)         -> teal/green fill
- Needs entry                  -> amber fill
- Overdue                      -> red fill
- Upcoming service             -> pale teal fill
- Off / away                   -> grey fill
- Today                        -> NAVY fill + a RING (today is signalled by the
  ring, NOT by hue alone - colorblind-safe; the ring is the redundant cue)

Content slots (scale by context):
- Date number (always)
- Middle line (account-polymorphic - see section 6)
- Sub line (meals count, when entered/projected and space allows)

The atom is the SINGLE source of day rendering. No surface re-implements a day
tile inline.

---

## 4. The Season level (the landing)

Top to bottom:
1. Account header (account name, category chip, Admin entry).
2. The OPERATIONAL STRIP - the phase timeline (PDC) or homestand arc (MLB/MiLB),
   spanning the year. This is the operational shape and is CONSTANT regardless of
   the toggle. Polymorphic: phases for PDC, homestands for MLB/MiLB, (a pure-fee
   account with no operational structure shows a minimal/absent strip).
3. The Calendar / Period toggle.
4. The GRID (4x3 on desktop):
   - Calendar: 12 month-cards (the existing year heatmap, in the new shell).
     Off-season months show an italic "Off-season" label. Click a month -> the
     month (its days).
   - Period: 13 period-cards. Each card:
       - Phase-tinted header (the phase/homestand the period falls in echoes the
         operational strip's color down into the card).
       - Human anchor under the label ("P7 · mid Jun") so low-context users
         aren't lost on "P7".
       - The day-squares for that period (the atom).
       - Entered count + revenue (or completion, for fee accounts).
     The 13th period sits in row 4; the remaining 3 slots of row 4 hold a
     FULL SEASON summary card (entered YTD, projected, days entered,
     needs-attention count, overdue count).
     Off-season periods are RENDERED (as "Offseason" cards), not hidden.
     Click a period -> the Period workspace.

First-run / empty: future periods show PROJECTED data (projected $ +
upcoming-service squares). The grid is never blank for a configured account.

---

## 5. The Period workspace (where you live, 90% of usage)

Top to bottom:
1. Climb-to-phase button + prev/next-period arrows + a Today jump.
2. Human-anchored title ("Period 7 · mid Jun · Instructs phase", date range).
3. The FINANCIAL FRAME - forked by billing model (section 6).
4. The TODAY HERO - a prominent card: "TODAY · [date] · needs entry" + the
   meals/$ projection + an "Enter actuals" button. Kept deliberately for the
   low-attention 6am floor user (urgency wins over pure consistency here).
   Today is ALSO the ringed navy square in the grid (redundant, intentional).
5. The DAY GRID - the WHOLE period at once: 7 wide, 4 week-rows, all ~28 day-
   squares (the atom, large size). NO week buttons. NO week-switching. NO
   directional slide. (This replaces the old week-button + slide model, which
   felt clunky.) Week subtotals are a quiet footnote line, not interactive.
6. Click any day-square -> DayDetail (the existing entry modal, unchanged).

---

## 6. Account polymorphism (two independent axes)

The old design broke because one "view mode" tried to carry both axes. They are
INDEPENDENT and compose:

OPERATIONAL SHAPE (what the days ARE) - drives the Season strip + work-unit:
- MLB / MiLB -> homestands (game series). MiLB adds day/night.
- PDC        -> developmental phases (Camp / Extended / Instructs / Offseason,
                from the recorded "Camp Name" data).

FINANCIAL FRAME (where revenue comes from) - drives the Period header + the $ on
cards + the day-tile middle line:
- Per-meal (CIN-AZ, TXR-AZ, TBR-FL, MiLB): $ = meals x contracted rate. Header
  shows "$X of ~$Y projected". Day middle line: $ + meals.
- MLB flat-fee (STL-MO etc.): NO dollar hero. The fee bills regardless; the job
  is COMPLETENESS. Header shows "26/28 game-days entered". Day middle line:
  opponent + meals (no $).
- PDC flat-fee (STL-FL): phase-allocated CONTRACT $ (the P&L spread, not meal
  math - its per-meal prices are $0 by design). Header shows the period's
  contract allocation. Day middle line: served + meals.

STL-FL is the proof case: PDC operational shape + flat-fee financial frame -
the two axes independent and composed. The day-square atom is consistent across
all of these; only the middle CONTENT line adapts.

---

## 7. Locked decisions (the spec - do not relitigate)

1. The Calendar/Period toggle stays; both views are 4x3 on desktop.
2. Landing = Season level, Calendar view, toggle visible.
3. Today hero stays on the Period workspace.
4. Phases CAN span periods. A period belongs to whichever phase(s) overlap it.
   Straddle rule: tint the period card by the phase owning the MAJORITY of its
   days; name both phases in the period header subtitle. (Confirm at build.)
5. Off-season periods rendered as "Offseason" cards, not hidden.
6. Flat-fee accounts keep the toggle; their cards/headers show completion or
   contract allocation, not per-meal $.
7. First-run shows projected data; never an empty grid for a configured account.
8. Full Season card shows: entered YTD, projected, days entered, needs-attention,
   overdue.
9. Day-square = universal atom; today = ring (not hue-only); colorblind-safe.
10. Human anchors on periods ("P7 · mid Jun").

---

## 8. Still-open sub-decisions (resolve at the relevant stage)
- Phase-straddle tint rule - majority-phase default (section 7.4); confirm in the
  period-workspace stage with real straddle data.
- Color-load audit - 6 day-states + 4 phase tints; verify WCAG contrast +
  colorblind sim; phase tint may need to be label-weighted, not fill-heavy.
- "Period N" comprehension for low-context users - human anchor mitigates; watch
  in validation.
- Mobile hero loudness - A/B hero-vs-quiet on small screens.

---

## 9. What we keep / replace / build new

KEEP (untouched unless flagged): the engine (`serviceCalendar.js`), the API
actions, `#257` revenue, `DayDetail.js` (entry modal), the status color system,
homestand + phase data plumbing.

REPLACE: `ServiceCalendar.js` (orchestrator - reshaped, sheds lens/scope),
`LensBar.js` (deleted), `PeriodLensView.js` (becomes the new workspace),
`OperationalView.js` (folded/retired), `computeInitialView.js` (new landing).

NET-NEW: the Calendar/Period toggle, the period-sliced year grid + Full Season
card, the persistent operational strip, the all-weeks workspace grid, human
anchors, the account-polymorphic content layer.

---

## 10. Guardrails (every stage)
- Engine + API contract untouched. A stage needing an engine change STOPS and
  flags it as a separate scoped decision - never an inline edit.
- `#257` $ display stays penny-correct; re-verify against a known figure when
  touching $ display.
- No effect deps on derived booleans.
- prefers-reduced-motion honored on all motion.
- The day-square atom is the single source of day rendering.
- Each stage ships GREEN and is validated before the next.
- The old lens/scope code stays until the dedicated removal stage, so a working
  fallback exists throughout.
