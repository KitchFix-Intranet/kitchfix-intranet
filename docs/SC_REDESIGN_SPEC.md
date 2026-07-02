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

---

## 11. Audit-driven revisions (post pre-build audit, PR #265)

The pre-build scope audit (`docs/SC_REDESIGN_AUDIT.md`) surfaced findings that
amend this spec. These supersede anything above that conflicts.

### 11.1 Admin surface - EXPLICITLY OUT OF SCOPE
~2,272 lines across ~12 files (AdminPanel, AccountEditor, FeeAccountEditor, and
6 write panels) live behind the `isAdminView` gate. The redesign is the
OPERATOR-FACING drill only (Season -> Period -> Day). The admin surface keeps
working UNTOUCHED behind its gate. No redesign stage edits admin code. The
`isAdminView` boolean and its branch are preserved as-is. If a stage finds itself
touching admin code, that is out of scope - STOP.

### 11.2 Bulk entry - SPEC IT INTO THE PERIOD WORKSPACE
The bulk-entry flow currently lives in the (being-removed) month view. It moves
to the Period workspace as a "bulk enter" affordance on the period day-grid:
- The period workspace gains a bulk-entry entry point (e.g. a "Bulk enter" button
  near the day grid, or multi-select on the day-squares -> enter many at once).
- It calls the EXISTING `sc-bulk-submit` action (engine untouched).
- This lands in the Period workspace stage (Stage 3). The day-square atom must
  support a "selected" visual state for multi-select (add to the Stage 0 atom
  spec: a selected/checked state, in addition to the 6 status states + today
  ring).
- Exact interaction (button-then-modal vs in-grid multi-select) is a Stage 3
  design sub-decision; the REQUIREMENT is that bulk entry has a real home in the
  new workspace and is not orphaned.

### 11.3 DayDetail coupling - MORE THAN "MINOR PROP WIRING" (Stage 3)
DayDetail is more coupled to the current view than the plan assumed:
- `monthRevenue` is passed as a denominator for a "% of month" readout. Called
  from the Period workspace, this silently becomes wrong (% of month when the
  context is now a period). Stage 3 must pass the correct denominator (period
  revenue) or remove/relabel the readout - do NOT let it silently misuse
  monthRevenue.
- `homestandContext`, `isFeeAccount`, and the `serviceGroups` fallback all need
  deliberate inheritance when DayDetail is opened from the new workspace.
- Treat DayDetail wiring as a real Stage 3 task with careful prop-contract
  review, not a trivial pass.

### 11.4 lens/scope are NOT dead code - removal is its OWN final stage
`lens` and `scope` drive the year-summary effect, goToToday, render branching,
and URL sync. They are load-bearing for the CURRENT (fallback) path. They must
NOT be removed mid-build. Removal is Stage 6 (its own isolated stage), executed
only after the new path fully replaces every job lens/scope did. The old path
stays as a working fallback through Stages 0-5.

### 11.5 Phase strip has a data-quality dependency (Stage 1/2)
Phases are RECORDED for 3/5 PDCs (CIN-AZ, TXR-AZ, TBR-FL) and INFERRED for 2/5
(TBJ-FL, STL-FL). No `sc_phases` table exists. The persistent phase strip needs
a derivation helper that reads recorded Camp Name data where present and falls
back to inference (or a graceful "phase data pending" state) where absent. The
strip must degrade gracefully for accounts without clean phase data - it cannot
assume every account has a clean phase timeline.

### 11.6 Stage 2 per-day-period gap - client-solvable, no engine change
`sc-year-summary.months[].days[]` does not carry per-day period labels, but
`periodRanges` IS already exposed. The period-cards (Stage 2) derive each day's
period client-side from periodRanges. NO engine/action change needed. (Confirms
the re-skin frame: the engine stays untouched.)

---

## 12. The build sequence (7 stages - audit-revised, LOCKED)

Supersedes the 6-stage sequence in SC_REDESIGN_PLAN.md.

- **Stage 0 - The day-square atom (SOLO).** The universal atom, every state
  (6 status + today-ring + SELECTED for bulk-entry multi-select), both size
  variants, the polymorphic content line. A state gallery proves every variant.
  No layout. Ships as the contract everything reuses.
- **Stage 1 - Season shell + Calendar view.** The new shell (account header,
  persistent phase strip with graceful degradation, Calendar/Period toggle with
  Period DISABLED, 4x3 month-grid using the atom). Re-creates the known-good
  heatmap in the new frame. Lands here.
- **Stage 2 - Period view of the year.** Enable the toggle. 4x3 period-cards
  (phase-tinted headers, human anchors, the atom, 13th-period + Full Season
  card). Per-day period derived client-side from periodRanges. Color-load audit.
- **Stage 3 - The Period workspace.** Financial frame (billing-model fork),
  today hero, all-weeks day grid (no week buttons/slide), bulk-entry affordance
  (sc-bulk-submit), DayDetail wiring with correct prop contract. Phase-straddle
  decision lands here.
- **Stage 4 - Drill wiring + landing + mobile (NO dead-code removal).** Connect
  Season card -> workspace, breadcrumb climb-up, intent-aware landing, mobile
  layout, motion pass. The old lens path STILL EXISTS as fallback.
- **Stage 5 - Polymorphism hardening (the safety net, MID not last).** Walk every
  account type (MLB-fee STL-MO, MiLB CIN-KY, PDC per-meal CIN-AZ, PDC-fee STL-FL)
  through every level. Fix the forks. Structure proven across all types BEFORE
  removal.
- **Stage 6 - Dead-code removal (ISOLATED, last).** Remove lens/scope and the old
  month-grid surface, only after Stages 0-5 prove the new path replaces every job
  they did. The high-risk cleanup, alone, fully reversible.

Sequencing logic: atom before layouts; known-good (Calendar) before novel
(Period); drill source before target; polymorphism mid as the safety net before
cleanup; removal isolated last so the fallback survives the whole build.

---

## 13. Drill-in design-system alignment (post-overview, 2026-07)

Stages 0-2 (day-square atom, Season shell, Calendar + Period grids) shipped and
were polished into a clean, token-driven reference (phase/label grammar,
figures-win card labels, state legend, segmented stepper). The operator-facing
OVERVIEW is now the design-system standard for the module. Stage 3's screens
(`PeriodWorkspace.js` + `DayDetail.js`) were built earlier and predate that
polish, so the current work is bringing the DRILL-IN up to the overview's bar -
tokens, icons, a11y, CSS scoping. This is an alignment lens layered on Stage 3,
not new structure. Ground truth: `docs/SC_DRILLIN_ALIGNMENT_AUDIT_CC.md`.

**Source of truth for design values (SC and app-wide):**
- `src/app/tokens.css` - canonical semantic + primitive tokens; the code truth.
- `docs/DESIGN_TOKENS.md` - the rules doc (two-tier model, semantic-only, add-and-deprecate).
- `docs/design-tokens.html` - the VISUAL style guide, self-contained; open in a browser to see every token as a rendered sample. The `--accent-sc` family (the SC green identity - `--accent-sc / -dark / -subtle / -tint`) is documented in DESIGN_TOKENS.md and demonstrated in the visual guide's "Tool accents" section.

**What "match the overview" means for the drill-in (for chat-Claude working on part 2):** the OVERVIEW surface (Season shell, Calendar + Period grids, day-square atom, SeasonStepper, PhaseStrip, StateLegend, ChromeBar and their scoped CSS files) is the shipped design-system standard for this module. Every interactive green on the SC surface goes through an `--accent-sc*` token; every state color goes through the `--status-*` family; every surface color through `--surface-*`; every border through `--border-*`; every space through `--space-*` (or its density-aware semantic aliases `--space-stack / --space-card-pad / --space-inline / --control-height / --row-height / --cell-size`); every radius through `--radius-*`; every elevation through `--elevation-*`; every focus ring through `--focus-ring-*`. No raw hex, no raw px, no inline-styled JSX colors. Scoped CSS files per surface, not the shared `ops-sc.css`. Icons via a local `service-calendar/Icons.js` (per §13.1). If any of those rules breaks in the overview, that's overview drift and gets flagged before the drill-in mirrors it. If any of those rules breaks in the drill-in, that's the alignment work.

### 13.1 Settled facts (ground truth - do not relitigate)
- **Density is correct in code.** The SC root (`ServiceCalendar.js`) carries
  `data-density="compact"`; the DayDetail + bulk overlays override to
  `data-density="comfortable"`. The main surface renders Density and the entry
  overlays render Comfortable - matching the documented module mode + surface
  override. (This corrects the drill-in audit's note that the root never sets
  density; it does.)
- **Breakpoints (two intentional switches, not drift):** `SeasonShell`'s
  `useIsDesktop` (`matchMedia("(min-width: 768px)")`) drives card-grid layout +
  interactions; the operational strip `SeasonStepper` switches its own treatment
  at 1024 (`@media max-width: 1023px`, matching its `>=1024px` comment); the
  month/period grid steps 4-col >=1024 / 3-col 768-1023. Plus the app-wide <1024
  comfortable-flip. Each is consistent within its own component - there's no
  single global switch, and that's intentional.
- **The overview is the reference.** The drill-in matches the overview's bar:
  components consume semantic tokens only (no raw hex/px), scoped CSS per surface
  (not the shared `ops-sc.css` mega-file), status paired with glyph/label/shape.
- **SC icon target = the v3 concept -> glyph map**, delivered as a LOCAL
  `service-calendar/Icons.js` hand-rolling the glyphs (NOT a repo-wide Lucide
  migration; Lucide has zero adoption today). The day-square atom keeps its
  Unicode status dingbats. Map:
  Entered -> check-circle · Needs entry -> pencil · Overdue/alert ->
  alert-triangle · Upcoming -> clock · Off-season -> moon · Scheduled ->
  calendar · Revenue -> dollar-sign · Refresh -> refresh-cw · Admin -> lock ·
  Jump/next -> arrow-right. Sizes via `--icon-sm/md/lg`; color via currentColor;
  decorative icons `aria-hidden`, meaningful ones labelled; stroke ~1.75 at sm.

### 13.2 Drill-in alignment backlog (the design review makes the final calls)
- PeriodWorkspace color tokenized (#313). DONE.
- DayDetail coaching banner: the 12 inline-hex values become
  `.sc-day-coaching--{state}` token-backed modifier classes.
- DayDetail CSS: scope its `.sc-day-*` block out of the shared `ops-sc.css` into
  a scoped `dayDetail.css` (mechanical relocation FIRST, tokenize AFTER).
- SC icon file: create `service-calendar/Icons.js` per 13.1; adopt it in the
  non-status icon sites (close, chevron, refresh, info, back).
- DayDetail overlay a11y: add `role="dialog"`, `aria-modal`, Escape-to-close,
  focus-trap, and return-focus. (Currently thin - only a labelled close button.)
- The exact coaching-modifier shape, the a11y contract, and the `Icons.js`
  structure are finalized in the drill-in DESIGN REVIEW (persona format, three
  directions). This section is the settled base that review builds on.
