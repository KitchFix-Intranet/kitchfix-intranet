# V3 OVERVIEW SPEC - v3 LOCKED (the build bible)

Status: LOCKED 2026-07-18 · owner approved Render C-OV v2 with Option B palette
Scope: Service Calendar OVERVIEW (landing), desktop-first per owner ruling. Mobile excluded
(future intranet-wide overhaul). Drill / entry / DayDetail are later sections.
Flow completed: audit -> owner notes -> reconcile -> spec v1/v2 -> Render C-OV v1/v2 ->
owner approval + Option B ruling -> THIS LOCKED SPEC. CC build prompts cite items by number.
The render demonstrates; this document governs; measured acceptance decides.

Evidence base: V3-C desktop audit · owner V3-K notes · live measurements (dE / APCA /
computed colors / density captures) · final-palette matrix computed 2026-07-18 (results
baked into S7/S10).

---

## 0 · DESIGN THESIS (as amended by the Option B ruling)

1. **The green family is the service continuum; DONE owns its saturated pole.** Owner ruled
   Option B: upcoming wears light mint. The done/not-yet boundary therefore rides measured
   intensity within the family PLUS mandatory non-color carriers (border weight, numeral
   tone) - never hue position alone. Measured basis: entered vs upcoming dE 19.0; grayscale
   Y 0.65 vs 0.85 (boundary survives desaturation).
2. **Layer the world.** L0 canvas -> L1 widget surface -> L2 cards. Elevation is the layer
   separator; hairlines are in-card only.
3. **One home per fact.** Every number appears once per zoom level; context duplicates are
   demoted to ambient (bars) or deleted.
4. **Enterprise density at full fidelity.** The 80-percent feel at 100 percent zoom via the
   Standard scale. Floors are law: body >= 13px effective, targets >= 24px (>= 32px for
   frequent controls).

## LOCKED RULINGS LEDGER

| # | Ruling | Source |
|---|--------|--------|
| R1 | Density via token step-down (Standard scale), not zoom | owner + lean |
| R2 | Month footers demoted (bar + one figure), not deleted | owner accepted lean |
| R3 | Needs-entry chip conditional (renders only when rail not beside grid) | owner accepted lean |
| R4 | Upcoming = light mint (Option B); compensating two-carrier law active | OWNER RULING over lean |
| R5 | Corner markers retired; phase context at month level (tick) + ribbon | owner accepted lean |
| R6 | Default landing = Calendar; current-period indication in-grid | owner accepted advice |
| R7 | Progressive month detail: past + current + next full; beyond collapses slim | render lean approved |
| R8 | Month urgency chips: one system, amber/red, worst state wins | render lean approved |
| R9 | Rail future rows collapse ("Aug - Dec ~$X"), expand on click | render lean approved |
| R10 | Ribbon carries month scale + phase labels; true date proportions at build | render lean approved |
| R11 | ink-soft retired; exactly three text levels | S11.4 lean approved |
| R12 | Borders declared non-meaning-bearing-alone (documented exception) | audit C-024 resolution |

---

## T · TOKEN TABLE (complete; authoritative values)

All colors re-authored in OKLCH at build with these sRGB targets; hover/active derive per
S7.6. Names use the existing --sc2- namespace; NEW marks additions, CHANGED marks value
changes, RETIRED marks deletions.

GROUNDS
  --sc2-canvas            #edeff2   NEW (L0; replaces surface-app role on SC pages)
  --sc2-surface           #f7f8fa   NEW (L1; the one widget plane)
  --sc2-surface-card      #ffffff   (L2)
  RETIRED on overview: surface-page / surface-band / surface-sunken as grounds (sunken may
  survive ONLY as an input-well tint elsewhere; zero overview usage)
  L0/L1 note: measured dE 3.2 - elevation is the primary separator (1.4); dE informational.

INK (exactly three levels - R11)
  --sc2-ink-strong  #122238 · --sc2-ink  #1f2d3d · --sc2-ink-muted  #697077
  --sc2-ink-soft    RETIRED (jobs move to ink)

STATE SYSTEM (fills / borders / numeral tones)
  entered   fill #a9dfc0  bd #5cbf8b  numeral #14532d (Lc 65.0)
  upcoming  fill #dff2e7  bd #b9e2cc  numeral #3e6b52 (Lc 70.0)   [Option B]
  needs     fill #fcecc7  bd #e4b45e  numeral #7a5a17 (Lc 70.9)  + GLYPH (S7.3)
  overdue   fill #f8d9d3  bd #dd8a7b  numeral #8a3a2c (Lc 67.8)  + "!" glyph
  off       fill #f1f0ec  numeral #8f8b80 (floor >= Lc 45; verify at build - prior #a9a69d
            measured 39.0 FAIL and is replaced)
  ghost     outline-only on L1 (unchanged role)
  today     ring 2px --sc2-navy, offset 1px
  period-wash rgba(26,48,80,0.05) inset (S6.7)

ANCHORS / CHROME
  --sc2-navy #1a3050 · --sc2-navy-deep #122238 · --sc2-green #2f7d4f · --sc2-green-deep #14532d
  chrome text #ffffff · chrome muted #c8d4e2 · category tag #c8a24a on #241d0c text

PHASE FAMILY (semantic slots; per-account phase NAMES map onto slots - CIN-AZ complex set,
STL-FL camps set, MLB homestand strip shares the family)
  ph-spring #d3b06a · ph-ext #9db8c9 · ph-complex #78a892 · ph-bridge #c9986f
  ph-instr #a58fc0 · ph-off #b9b3a6

RAIL
  rail-bg #122238 · rail-text-strong #eafff2 · rail-text-muted #aebfd4 CHANGED (Lc 64.6;
  closes audit C-022 - old #8fa4bd measured 48.7 FAIL) · rail-accent #5ad08a
  queue-dot-needs = needs-bd · queue-dot-overdue = overdue-bd

ELEVATION (exactly three on this screen)
  el-widget: 0 2px 8px rgba(18,34,56,.08), 0 12px 32px rgba(18,34,56,.06)
  el-card:   0 1px 3px rgba(18,34,56,.08), 0 2px 8px rgba(18,34,56,.05)
  el-hover:  0 2px 6px rgba(18,34,56,.10), 0 6px 16px rgba(18,34,56,.07)
  (overlay elevation exists globally; not this section)

RADIUS (scale consolidated: 8 / 12 / 16 + full)
  tiles+controls+chips-square 8 · cards 12 · widget 16 · pills/chips-round full
  (render's 7px tile radius corrected to 8 - scale compliance)

BORDERS (1px / 2px only)
  hairlines + state borders + chip outlines 1px · today ring + focus ring 2px
  (render's 1.5px away-chip outline corrected to 1px; fill-vs-outline remains the carrier)

TYPE SCALE (Standard; line-heights on the 4px grid)
  micro 11/14 · caption 12/16 · body 14/20 · month-name 15/20 · chrome-title 18/24
  rail-hero 30/36 tabular
  weights: 600 semibold · 700 bold · 800 display (exactly three)
  tabular figures on ALL data (S11.2)

SPACING (unchanged scale; Standard consumes)
  4 / 8 / 12 / 16 / 24 in this section (sp-1..sp-6 semantic names)

CONTROLS
  standard controls 36px · compact/icon buttons 32px (render's 30px icon buttons corrected
  to 32 - lock compliance) · frequent targets >= 36

MOTION
  hover/elevation transitions ride --duration-fast; slim-card expand rides --duration-base,
  RM-gated. (Global 3-vs-2 duration question = rider 9.7, token-layer decision.)

---

## S1 · FRAME AND SURFACE SYSTEM
1.1 Three layers exactly: canvas L0 -> surface L1 (ONE continuous plane behind ribbon,
    grid, legend, rail) -> card L2. No other grounds on this screen.
1.2 Widget: el-widget shadow, radius 16, margin-top sp-6 (24px) below site nav.
1.3 Cards: el-card default, el-hover on interactive hover (one tier step).
1.4 Separation strategy per level: L1->L2 by elevation+white only (no border); hairlines
    in-card only.
Acceptance: computed-background census = {canvas, surface, card} (+state fills) only;
shadow visibly renders at 1535; 24px nav gap present.

## S2 · EDGE AND ALIGNMENT SYSTEM
2.1 One edge: site-nav content adopts --sc2-shell-max on SC pages via the :has(.scv2)
    pattern (styling only). Direction validated by render (nav joins widget). Shell-max
    flexes per 6.1 square math; final value emerges from that equation at build.
2.2 Legend: left edge == month-grid left edge; right edge == rail right edge; sits on L2
    (white card) per render.
2.3 One vertical line: chrome content, ribbon, grid, legend, rail all share left alignment;
    verified by pixel overlay.

## S3 · CHROME (one row, locked inventory)
3.1 Left-to-right: title "Service Calendar" (18/800) · account pill · category tag ·
    Calendar|Period segmented · flex · TODAY {date} PERIOD {n} WEEK {n} cluster · export
    icon (32px) · as-of pill + refresh · density segmented (Standard|Comfortable) · admin
    lock (32px, admin only).
3.2 "Welcome back" string DELETED from DOM.
3.3 Needs-entry chip renders ONLY below the two-pane breakpoint (rail not beside grid).
3.4 1280 overflow order: density -> lock -> as-of collapse to icon; TODAY cluster never
    collapses.
3.5 Export single-home on overview = the chrome icon (cross-section placement strategy +
    byte-diff remain logged for the drill section).
3.6 Default landing = Calendar (recorded; no code change).
Acceptance: one row at >= 1280; welcome absent; chip absent at two-pane; every legacy
action reachable; icon buttons measure 32px.

## S4 · DENSITY (Standard scale)
4.1 Standard is default; values per token table. Comfortable survives as the larger option;
    the legacy Compact branch is recalibrated INTO Standard (no third mode).
4.2 Floors: body >= 13px effective; APCA floors re-verified at Standard sizes (done -
    matrix in S10); targets per CONTROLS.
4.3 Zero literal px in overview CSS post-build (system-trace enforceable).
Acceptance: side-by-side capture Standard vs old Comfortable matches the approved render
feel; trace passes.

## S5 · PHASE RIBBON (+ homestand strip grammar)
5.1 Structure: band 8px (phase-family tints, TRUE date proportions at build) -> month
    scale row (12 labels, 10px/700, #a4abb3-tone from ink-muted ramp) -> phase label row
    (11px/700, ink-muted; current phase = navy 800 + NOW dot). Today-line: 2px navy tick
    breaking the band. Total <= 44px.
5.2 Placement: under chrome, full inner width, part of the widget header zone.
5.3 The ribbon + month tick (7.4) are the ONLY phase homes at year zoom.
5.4 Homestand strip (MLB overviews): L2 card (white + el-card) directly above the grid;
    meta line (NEXT · HS{n} · opponents · dates · games · homestand n of 13, caption
    scale); block track - completed #2b466b, current #c8a24a with HS{n} label, future
    #e6e9ed; 16px block height, radius 8. Shares ribbon grammar; computed-ground check at
    build.
5.5 Per-account phase-name mapping: account phase sets (Complex set, Camps set, etc) map
    to the phase-family slots; no per-account colors.
Acceptance: height <= 44px; phase-label APCA >= 60 (measured 70.5 PASS at Standard);
squint - current phase reads; strip computes L2.

## S6 · MONTH CARD AND TILE SYSTEM
6.1 Square tiles: aspect-ratio 1. Geometry at 1520 shell: content pad 20 -> inner 1480;
    rail 336 + gap 16 -> grid 1128; 4 cols gap 12 -> card 273; card pad 12 -> inner 249;
    7 tiles gap 3 -> tile 33px. Shell-max flexes +-4px at build so tiles resolve to whole
    px (S2.1 interlock).
6.2 Numerals centered, 12/600 tabular, tone per state (token table).
6.3 Definition: 1px state border + fill; NO per-tile shadows; today ring per token; hover
    = el-hover on the CARD, tile hover = S7.6 delta.
6.4 Footer (per-meal): progress bar (5px, green fill, #e8ebee track) + ONE right-aligned
    compact figure - $ actual (12/800 ink-strong) for months with actuals, ~$ projection
    (12/700 ink-muted) otherwise. "N/N entered" text DELETED (bar encodes; rail holds
    exact counts).
6.5 Year-zoom alarm aggregation: zero per-cell urgency flags at year view. Month header
    carries ONE chip: red "N overdue" if any overdue else amber "N need entry" if any
    needs (worst wins, R8). Chip: fill/bd/text from the state tokens, 11/800, radius full.
6.6 Header row: 3px phase tick (left, full header height, radius 2) · month name 15/700 ·
    P{n} tag when month intersects current period (6.7) · right slot = urgency chip OR
    complete check (12/800 green) OR empty.
6.7 Current-period indication (candidate A LOCKED): in-period day tiles carry the
    period-wash inset; intersecting months show the P{n} tag (11/800 navy on
    rgba(26,48,80,.08), radius 8). Orientation, not alarm - must not compete with today
    ring or chips in the squint.
6.8 Fee/MLB footer: game-day progress bar (navy fill) + right figure "N homestands"
    (or "N of M game days" for non-homestand fee - STL-FL). Zero $ ever. "game days" text
    deleted where the bar encodes it.
6.9 Progressive detail (R7): months in [Jan .. current+1] render FULL cards; months beyond
    render SLIM rows (name 14/700 · optional AUTO-COLLAPSED hint 10px · right projection
    figure · bar). December off-season shows italic "Off-season". Slim rows expand to full
    on click (and collapse), RM-gated height transition; keyboard: slim row is a button,
    Enter expands. State is session-local (no persistence).
6.10 Off tiles: numeral #8f8b80 (>=Lc45 at build); off is non-actionable - no border.
Acceptance: tiles square whole-px; centered numerals; zero per-cell flags at year zoom;
footer = bar + one figure exactly; Feb/Mar squint reads calm; slim rows expand/collapse
with keyboard.

## S7 · STATE COLOR SYSTEM (Option B, measured + compensated)
7.1 All values OKLCH-authored at build to the sRGB targets in the token table; one neutral
    ramp for warm survivors (off).
7.2 Measured separation matrix (2026-07-18, locked baseline; build re-verifies):
    entered-upcoming dE 19.0 · entered-off 26.4 · entered-needs 27.1 · upcoming-needs 18.5
    · needs-overdue 17.1 · upcoming-off 8.0. Grayscale Y: entered .65 / overdue .74 /
    upcoming .850 / needs .848 / off .871.
    AMENDED TARGETS (B-aware): in-family entered-vs-upcoming >= dE 18 AND grayscale
    delta-Y >= 0.15 AND non-color carriers (border strength + numeral tone) - all three
    hold. Cross-family pairs >= dE 15 with glyph reinforcement where grayscale-Y collides
    (7.3).
7.3 **Two-signal law, extended (NEW - from the matrix):** upcoming-mint and needs-amber are
    grayscale-identical (Y .850 vs .848). Therefore NEEDS tiles carry a glyph - a 4px dot,
    top-right (mirrors overdue's "!" position), needs-bd color. Every actionable state is
    now fill + border + glyph; upcoming/off (non-actionable) are fill-led. Color is never
    the sole carrier anywhere in the system.
7.4 Corner markers retired; phase context = month tick (6.6) + ribbon (S5). Game-day
    marking merges into 7.5.
7.5 **Home/away, two zoom levels (resolves the render's open cell):**
    - Drill zoom: chips - home "VS XXX" navy fill white text; away "@ XXX" white fill navy
      text 1px navy outline. Radius full, 11-12/800.
    - Year zoom (32px tiles - chips do not fit): dot pair under the numeral - home = 5px
      FILLED navy dot; away = 5px navy OUTLINE dot (1px). Same filled-vs-outline carrier
      at both scales; grayscale-safe by construction. A `--home` state class is CREATED
      (audit finding: it never existed).
7.6 Interaction deltas: hover = OKLCH L -0.04; active = L -0.07; uniform system-wide.
7.7 Riders: ghost-placeholder pairing >= Lc 60 (C-023) re-lands with the token pass; off
    numeral fix (6.10).
Acceptance: build re-measures the full matrix vs 7.2 targets; grayscale screenshot of a
mixed month distinguishes all actionable states; home/away distinguishable in grayscale at
both zooms; needs-dot present.

## S8 · BOOKS RAIL
8.1 L2-equivalent elevation on rail-bg; width 336; radius 12.
8.2 rail-text-muted #aebfd4 (Lc 64.6 - C-022 CLOSED).
8.3 Sticky rail (top 16) on tall pages; NEEDS ENTRY section pinned above the season
    scroll region; season list inner-scrolls with fade affordance; current month
    auto-scrolled into view on load. STL-FL's 83-item queue = stress acceptance.
8.4 Hierarchy: label 11/800 tracked · hero 30/800 tabular · meta 12 muted · queue rows
    (dot 8px state-bd tone · date 13/700 · state caption 11 · chevron) >= 36px targets ·
    season rows (name 13 · count 11 muted tabular · $ 13/800 · check/chevron).
8.5 Season rows are the sole exact-count home ("17/17" + "$54K"); current month row
    carries a subtle highlight; future rows collapse to one "Aug - Dec ~$X" row (R9),
    click expands in place.
8.6 CTA "Enter oldest · {date}" - green fill, full width, 44px, 14/800.
8.7 Vocabulary per 9.1 (NEEDS ENTRY header; "entered" verb; comma dates).
Acceptance: APCA row green; sticky + pinned verified by scroll capture; collapse row
expands; top edge aligns to grid top in the overlay.

## S9 · RIDERS (closing inside this scope)
9.1 Vocabulary canon: state "Needs entry" · counts "N need entry" · rail header "NEEDS
    ENTRY" · verb "entered" everywhere ("recorded" dies) · dates "Tue, Jul 14" (comma).
    Entry-surface naming stays logged for its own section.
9.2 Failed-state: repair the ?debug=failed hook for the v2 overview fetch; failed cells
    render the failed atom (distinct from zero/off/empty); rail shows failed banner +
    retry. Doc-drift P2 closes with it.
9.3 Keyboard: month grid = ONE roving tabstop (arrows move months - left/right/up/down
    across the 4-col grid incl. slim rows; Enter drills or expands-slim; Home/End first/
    last month). Tab order: chrome -> grid(1) -> legend -> rail. Focus ring 2px navy,
    offset 2, one style (feeds the parallel C-012 unification).
9.4 Icons: one family, 16/20 sizes (export, refresh, lock, chevrons, check, info); tile
    glyphs (! and needs-dot) re-cut in state tones.
9.5 Skeletons: month-card skeleton (header line + 7x5 tile ghost grid + footer line) and
    rail skeleton (hero + section blocks) matching final layout; zero shift on data
    arrival (screenshot-diff acceptance).
9.6 Provenance: as-of pill = anchor; STALE presentation (pill turns amber + "stale" word
    past refresh interval) distinct from FAILED (9.2) and fresh; whole-surface
    missing/failed/zero/stale distinctness law applied.
9.7 Motion durations: token layer 3 vs standard 2 - collapse or document; one-line ruling
    in DESIGN_SYSTEM_REFERENCE (global, surfaced here).
9.8 Icon-button + radius + border corrections from the render (32px, radius 8, 1px)
    applied everywhere the render deviated.

## S11 · TYPOGRAPHY, HIERARCHY, SYMMETRY
11.1 Heading map: L1 chrome title (18/800) · L2 month names + rail hero label tier
     (15/700 · 11/800-tracked pairing) · L3 micro labels (11/800, tracked, ONLY all-caps
     tier). One case convention; tracking only at L3. Map lands in
     DESIGN_SYSTEM_REFERENCE.
11.2 Tabular figures on all data (tokens table); money emphasis <= 2 of {size, weight,
     color}; the rule is written into DESIGN_SYSTEM_REFERENCE.
11.3 Symmetry: card pad 12 uniform; rail section rhythm = card rhythm; every left edge on
     the S2.3 line; optical exceptions documented inline.
11.4 Three text levels exactly; ink-soft RETIRED (R11) - its consumers move to ink;
     grep-zero at build.

## S10 · VERIFICATION (locked baseline + build re-measure)
Baseline (this doc): the 7.2 dE/grayscale matrix · APCA passes: entered-numeral 65.0,
upcoming-numeral 70.0, needs 70.9, overdue 67.8, rail-muted 64.6, phase-labels 70.5, chips
67.8 · known fixes owed: off-numeral (>=45), ghost-placeholder (>=60).
Build re-measure (Chat-Claude sweep, per PR below): full dE matrix vs targets · full APCA
at Standard sizes · squint x3 (overview / Feb-Mar calm / mixed-state month) · grayscale
mixed-month + home/away proof · edge overlay (nav==widget==grid==legend, rail top-align) ·
tab walk (chrome -> 1 grid stop -> legend -> rail; arrows traverse incl. slim) · system
trace (zero literal px) · vocabulary grep (zero banned strings) · text-level count == 3 ·
homestand-strip ground · skeleton zero-shift diff · stale/failed/fresh pill states ·
progressive-detail expand/collapse incl. keyboard.

## PR SPLIT (build order)
**OV-A quick-strikes** (no visual dependency; CC-ready): 9.1 vocabulary · 3.2 welcome
delete · 3.3 chip conditional · 2.2 legend alignment · 8.2 rail-muted token · 6.4 + 6.8
footer demotion (both grammars) · 9.2 failed-state hook · 11.2 tabular sweep · 11.4
ink-soft retirement.
**OV-B frame + chrome + ribbon**: S1 · S2 · S3 · S4 (Standard scale + Compact
recalibration) · S5 (ribbon + homestand strip) · 9.8 corrections.
**OV-C grid + states + rail**: S6 (cards, tiles, chips, progressive detail, period
indication) · S7 (palette + glyph law + home/away both zooms + `--home` class creation) ·
S8 (rail polish + sticky + collapse) · 9.3 keyboard · 9.4 icons · 9.5 skeletons · 9.6
provenance.
Each PR: flag-safe within the live v2 world, zero engine/derive changes, drift log,
Chat-Claude re-measure of its S10 slice before Kevin's pass.

## OUT OF SCOPE
Engine/derives · drill/entry/DayDetail internals (own sections; DayDetail = C-001/D1) ·
mobile · nav IA beyond edge styling · data model.

## v4 - Owner Round OV-3 (2026-07-19) - DELTA (canon)

Round of 22 owner reversals against the v3 render (RENDER_OV3_v1.html + owner rulings).
This delta REPLACES the referenced v3 sections; v3 language remains for context. Where
the delta and v3 disagree, the delta wins.

### Removals
- **§6.9 Progressive detail (slim rows) - REMOVED.** No more `slimByDefault` prop, no
  more `data-slim` CSS state, no more slim-expand button, no more slim-list roving
  simplification. All 12 months render full. Roving keyboard reverts to the drill list.
  Rail's Sep-Dec fold is KEPT (owner explicitly kept it).
- **§6.6 P{n} MonthPeriodTag - REMOVED.** Component, CSS, and prop deleted. Period-index
  identity moves onto the ribbon phase title (P{n} lives on the ribbon in §S5 language).
- **§S5 NOW-dot - REMOVED.** No dot on the current-phase title. Current phase = navy +
  800 (weight) only.
- **§7.5 year-zoom home/away dot pair - REMOVED.** Zero glyphs on tiles across all
  zooms. The dot pair is replaced by tile state (see §7.5-v4). The
  `hasScheduleGame` emit that #474 landed is RETAINED for drill-surface use.
- **Comfortable density - REMOVED.** Standard is the only scale. The `useDensity`
  toggle, its Comfortable remap block, the ribbon control, and the density prop pass-
  through all come out. Every existing Comfortable-only token consumer moves to
  Standard tokens directly. No shim, no fallback path.

### Reversals + edits
- **§S5 ribbon layout - FLIPPED.** Months row sits ABOVE the phase band; phase titles
  sit BELOW. Current phase = navy + 800 with no dot. §5.4 homestand strip position
  unchanged.
- **§S3 chrome - COLLAPSED to a single-row header.** Title | separator | account
  selector | kind chip | Calendar|Period toggle | separator | TODAY {date} PERIOD {n}
  WEEK {n} | right cluster (as-of pill, admin lock, export). Export sits RIGHT of the
  admin lock, at the far edge. Responsive tripwires: `<=1360` the TODAY/PERIOD/WEEK
  group tightens (drop internal separators); `<=1280` the as-of pill collapses to its
  status dot + time. Item 22 acceptance: as-of failed state remains VISIBLE in every
  collapse.
- **§7.3 needs-entry second signal - CHANGED from dot to HEAVY NUMERAL.** The
  `::after` needs-dot glyph is deleted. The needs numeral bumps to the heaviest
  available weight and one darker step of `--sc2-needs-fg`. APCA re-verified on the
  amber fill. Two-signal law survives (color + weight/darkness), not (color + glyph).
- **§7.5 dual-zoom home/away - RESTYLED to tile state.** MLB + MiLB away days render
  as a ghost-purple tile. New tokens: `--sc2-state-away-bg: #e3dded` / `--sc2-state-
  away-fg: #544e66`. Delta from off-grey verified under grayscale simulation. Home
  days render as the base entered/needs/upcoming palette per §7.2 (no additional
  glyph, no home dot).
- **§8/rail null glyph - CHANGED em-dash "—" to hyphen "-"** at the three catalogued
  sites (`SeasonRail.js:286` / `:291` / `:390`) and the analogous OpsRail sites.
  December's null renders "-". House-rule hyphen policy over typographic convention.
- **§7 pill (rail meta / rows) - SEVERITY + SHORT COPY.** "{n} need" (amber) when
  only needs-entry present; "{n} overdue" (red) when any overdue exists. Worst-state
  wins; count shown = that state's count.
- **Hero line - REPLACED.** Inline: "$1.08M ENTERED YTD · ~$1.37M projected" (big
  figure + small label + muted projection on one baseline). "155 of 253 days entered"
  moves BELOW the progress line.

### Additions
- **§17 Inner-card region** (NEW). Calendar + Period surfaces both wrap in a defined
  inner card: hairline border (`--sc2-line`), radius 12, `--sc2-el-inset` half-step
  shadow (NEW token, lighter than `--sc2-el-card`; see tokens delta). Item-13 Period
  view sits inside the same region.
- **§6.4/6.5 wedges - ENLARGED.** Game-day (navy top-right) and spring-training
  (copper bottom-left) corner wedges grow well beyond the OV-2 size. Whole-pixel legs.
  Overlay dates (STL - FL / TBJ - FL AAA) unchanged - still get the game wedge.
- **§20 whole-pixel grid tiles** (NEW law). Tile inline-size and block-size land on
  whole pixels; sub-pixel widths are excluded.
- **§13 Period view - RESTYLED to month-card language.** PeriodCard: white card,
  `--sc2-el-card`, 3px phase tick, `P{n}` title at month-name scale, muted date-range
  caption, stats row (days entered / $ entered|projected), footer figure + progress
  bar. The v3 heavy full-color period headers are OUT.
- **§18 MiLB homestand strip** (NEW, ONE derive carve-out for OV-3). CIN-KY / TBJ-NY
  reuse the EXISTING MLB homestand grouping (consecutive GAME runs + opponents ->
  stands) and render the same polished strip (§12 hierarchy). Read-side only. Guards:
  fee footer + DayDetail untouched; MLB path unchanged; zero write-path. If MLB
  grouping cannot be reused cleanly, STOP.
- **§12 homestand strip hierarchy** (POLISHED). Meta row: NEXT as small navy chip |
  HS{n} bold 13px | dot-separated opponent · date · games | "homestand n of 13" right-
  aligned muted. Bar vertically centered with even padding (bottom-hug removed). Card
  height fits content.
- **Tokens delta.** ADD: `--sc2-state-away-bg: #e3dded`, `--sc2-state-away-fg:
  #544e66`, `--sc2-el-inset` (half-step shadow, lighter than `--sc2-el-card`).
  REMOVE: Comfortable-scale remap block + any Comfortable-only variable pairs.

### Bug + grounds law
- **Canvas ground reaches the top-nav boundary at every zoom** (Item 1). The white
  strip between the top nav and canvas at zoom-out is a root-level issue - diagnose at
  body/`.oh-app` boundary, not at widget level.
- **Calendar region computes the proper surface grey** (Item 2). The beige cast is a
  `--sc2-surface-page` family leak; fix at the leaking rule.
- **Today tile navy border** (Item 3). 2px navy outline, offset for breathing room,
  ALL account kinds. Acceptance-visible marker.
- **CalendarRail auto-scroll no-fire** (Item 5). OpsRail path verified working; per-
  meal path doesn't fire. DIAGNOSE before fixing; state the cause in the commit
  message.

### Wave map
- Wave 1: 1a canvas / 1b beige leak / 1c today border / 1d wedges / 1e whole-px /
  1f rail auto-scroll diagnose+fix
- Wave 2: 6/7 single-row header + Comfortable removal (+ item 22 acceptance)
- Wave 3: 3a ribbon flip / 3b needs numeral / 3c glyph purge / 3d ghost-purple away
  tile / 3e P{n} tag delete / 3f slim rows delete
- Wave 4: 4a hero inline / 4b pill severity / 4c hyphen rail nulls
- Wave 5: 5a inner card + `--sc2-el-inset` / 5b homestand meta polish
- Wave 6: 13 PeriodCard restyle (in the 5a container)
- Wave 7: 18 MiLB homestand grouping reuse (ONE derive carve-out)

## CHANGELOG
- v4 2026-07-19 DELTA (OV-3 owner round): 22-item reversal set - see §v4 block above.
  v3 language retained for context; delta wins where they disagree.
- v3 2026-07-18 LOCKED: owner approved render v2 + Option B. Every render-validated
  candidate hardened. Option B compensations codified (7.2 amended targets, 7.3 needs-dot
  two-signal law from the grayscale collision Y .850/.848). New: 7.5 home/away dual-zoom
  system (year-zoom dot pair - closes the render's open cell), 6.9 progressive detail as
  law, S5 month scale, R8 chip rule, R9 rail collapse, off-numeral fix, 9.8 lock
  corrections (32px icons, radius 8, 1px chips). Full token table added. PR split locked.
- v2 2026-07-18: second-pass diff vs owner dump (homestand strip restored, S11 added,
  riders 9.5-9.7, fee footer variant, rail placement).
- v1 2026-07-18: initial draft from the V3-OV reconcile.
