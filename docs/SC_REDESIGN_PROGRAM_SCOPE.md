# SC Redesign Program - "The Books Are Always Visible"

Status: proposal for green-light. Nothing goes to CC until the decision list (section 16) is answered.
Author: Chat-Claude (architect). Builder: CC. Merges + production actions: Kevin.
Companion doc: SC_ENTRY_V2_SCOPE.md (already written - slots in as Workstream W7).
Grounding: repo main @ 3ff579f, inspected 2026-07-17. Every file/line cited below was read from live main.

---

## 1. The one idea

The forming bill that made the entry redesign land becomes the whole app's skeleton: at every zoom
level, content on the left, the books on the right, one primary action. Season rail on the year
overview, period rail on the drill, homestand ledger on MLB, day bill on entry. The photo hero
collapses into a slim navy ribbon merged with the command bar. One design language, one anatomy,
desktop and mobile.

## 2. The discovery that shapes the entire program

**The current SC is already a componentized redesign.** Main contains an 8,928-line `season/` system
(Design Batches 1-2 + Redesign Stages 1-5): `SeasonShell.js` (323), `ChromeBar.js` (280),
`MonthCard.js` (532), `PeriodCard.js` (390), `PeriodWorkspace.js` (1,191), `PhaseStrip.js` (233),
`SeasonStepper.js` (183), `LegendInfoPopup.js` (308) + `legendItems.js` (196), `ExportControl.js`
(359), `phaseDerivation.js` (261), plus the `DaySquare` atom (761 js / 893 css) and `dayResolvers.js`
(152) - a pure status-mapping layer whose enum already includes `entered / needs-entry / overdue /
upcoming / off / off-season / loading / failed` with today/selected/focused overlays, and whose
comments encode both of Kevin's tracker non-negotiables (failed never renders as zero; off-season
hatched as a non-color cue).

**Consequence: this program is a reskin plus an additive rail layer over an existing atom
architecture - not a rebuild.** The v2 renders map nearly 1:1 onto existing components. That is why
this is feasible for a one-person shop, and it is the frame for every decision below.

Two more grounded facts that shape the plan:
- `ServiceCalendar.js` (2,572 lines) is the orchestrator and still renders the hero itself
  (Redesign PR 1A moved it there so the in-hero admin lock wires to handleAdminToggle; the as-of
  pill was also relocated INTO the hero per ChromeBar's header comment). Killing the hero therefore
  must rehome two live affordances: the admin entry and the as-of/sync pill.
- `page.js` gates the entire tool to `SC_ADMINS` (two emails; everyone else sees Coming Soon). The
  transition audience is Kevin + 1. This makes a lightweight flag strategy safe and makes NOW -
  before the site-lead rollout - the cheapest possible window to do this.

**Stranded branches to disposition in W0:** `feat/sc-month-view-redesign` and
`feat/sc-redesign-stage2-period-view` exist on origin. Period view is clearly merged into main
(`season/PeriodWorkspace.js`), so these are likely merged-and-undeleted or superseded - but CC must
confirm and either delete or fold, so the program starts from one truth.

## 3. Scope fences

**In scope (surfaces):** the SC ribbon/chrome; season overview Calendar mode + season rail; season
overview Period mode + rail; PeriodWorkspace drill + period rail + in-grid week bands; MLB fee-account
surface + homestand ledger rail; DayDetail -> Entry v2 (per its own scope doc); mobile inversions for
all of the above; the motion/positive-feedback layer; the v2 visual theme (tokens, type scale, cell
skins); code cleanup that these touches unlock.

**Out of scope (hard fences):**
- The engine. No schema, no view changes, no new endpoints unless W0 proves one is unavoidable
  (section 7 flags the single candidate). `sc_daily_revenue`, effective-dated prices, R13
  round-then-sum, save paths, saveQueue, notes/history ledgers: untouched.
- The Sheets dual-architecture, admin routes (`service-calendar/admin/`), auth/gating logic, the
  Ops Hub TopNav, other modules' heroes (ops/financial keep theirs; the ribbon is SC-only until
  Kevin says otherwise).
- KPI Dashboard: not referenced, not wired, not considered.
- No new tooling, no design-system migrations, no test-framework introduction. Verification is the
  manual checklist + screenshot + audit model already in use.

## 4. Reuse inventory (what moves over untouched)

| Layer | Source | v2 status |
|---|---|---|
| Status semantics | `dayResolvers.js` enum + `isPastDate` read-time pastness (C1b) | reuse verbatim - the rail queue derives FROM these, never re-derives |
| Day-state atom | `DaySquare` | reuse; v2 is a skin (new tokens/geometry), not a new atom |
| Chrome contents | `ChromeBar.js` (account, tag, Cal/Period toggle, stats cluster) | reuse contents; restyle + merge into ribbon |
| Phase logic | `phaseDerivation.js`, `PhaseStrip.js` | reuse; strip restyled + now-tick added |
| Legend taxonomy | `legendItems.js`, `LegendInfoPopup.js` | reuse taxonomy; add compact inline band; popup stays for full taxonomy |
| Drill | `PeriodWorkspace.js` (incl. its existing week aggregation feeding the WEEK cards) | reuse data + handlers; reskin tiles; week cards become in-grid bands + rail lines |
| Export | `ExportControl.js` + `scWorkbook.js` (R13 already applied) | reuse; relocate trigger into rail footer |
| Entry engine | everything in SC_ENTRY_V2_SCOPE section 3 | reuse per that doc |
| Money formatting | `season/format.js` (`fmt$` 2dp, `fmt$K`, `round2`) | reuse; precision rules per surface (section 6) |
| Toasts, a11y, queue | `SubmissionToast`, `useDialogA11y`, `saveQueue`, `useAnimatedNumber` | reuse (`useAnimatedNumber` likely powers rail tick - W0 confirms) |
| Homestand context | the existing homestand strip + `sc_homestand_schedule` (408 rows) | reuse as the ledger's spine |

## 5. Genuinely new

1. **The Rail system** - one shared shell (`Rail`, `RailHero`, `RailQueueRow`, `RailLine`,
   `RailFooterAction`, scroll fade) themed per surface. The single biggest new component.
2. **Needs-attention queue** - client derivation over the already-classified days: filter
   `needs-entry` + `overdue`, sort oldest-first, compute aging ("oldest N days") from dates at read
   time (same C1b discipline). No engine change.
3. **The Ribbon** - hero replaced by identity row (title, welcome, as-of pill, admin lock) fused
   with the restyled ChromeBar.
4. **In-grid week bands** in the drill (reusing PeriodWorkspace's existing week sums).
5. **Homestand ledger** rail for MLB (games + meals per homestand, entered/next/future states).
6. **v2 theme layer** - token additions + the type scale + cell/tile skins from the approved renders.
7. **Motion layer** - the approved v4 vocabulary (row flash, cascade, total pulse, shimmer,
   complete-stamp, confirm pulse), all `prefers-reduced-motion`-gated.
8. **Mobile inversions** - rail-as-header/sticky-bar + list rows per the approved mobile frames.

## 6. Architecture, theming, and conventions

- **Theme strategy: one root class, shared atoms.** v2 mounts under `.scv2` on the SC root;
  new/changed tokens live in a `scv2` block in `tokens.css`; atom CSS gains `.scv2`-scoped skins.
  Components are NOT forked for restyling - only structurally new pieces (Rail, Ribbon, week band)
  are new files, under `src/app/service-calendar/v2/` during coexistence, promoted into `season/`
  at decommission per CONVENTIONS file-placement rules.
- **Money precision law (program-wide, extends R13):** billing surfaces (period rail hero + lines,
  day bill) show exact 2dp and must equal their own line sums to the penny; overview surfaces
  (season rail, tiles, month footers) use compact `$K/$M` with ONE format per level. A hero may
  never disagree with its own list.
- **Rail interaction law:** rows navigate (chevron), exactly one footer button acts. Queue rows are
  whole-row targets.
- **CSS budget:** SC carries **5,919 CSS lines across 12 files** (W0 baseline per
  `SC_REDESIGN_AUDIT.md`): `dayDetail.css` 1,272, `season.css` 1,003, `DaySquare.css` 893,
  `periodWorkspace.css` 767, `ops-sc.css` 439, `chromeBar.css` 429, `stateLegend.css` 271,
  `legendInfoPopup.css` 237, `seasonStepper.css` 194, `exportControl.css` 181,
  `submissionToast.css` 150, `stickyContext.css` 83. Program exit criterion: net CSS does not
  exceed 5,919 after decommission - every skin added is paid for by dead rules removed.
- **No new dependencies.** Motion is CSS + rAF (as in the prototypes). Subgrid et al. are cleared by
  the Chrome-latest-2 + recent-mobile matrix already documented.
- **Accessibility floor:** WCAG 2.1/2.2 AA on every new surface; rail totals get `aria-live=polite`;
  grid keyboard nav specified in W5/W7; contrast verified numerically (the python method used for
  the pill fix) for the navy-rail palette before merge, not after.

## 7. Data derivations - every rail figure mapped to a source

| Figure | Source | Risk |
|---|---|---|
| Season rail total/projected/progress | the same per-month totals the year view already renders (dayResolvers' header cites `sc-year-summary`) | none - W0 confirms the exact payload field names |
| Season month lines | same source, formatted `$K` (compact surface - the parked `sc_month_summary` sum-then-round drift is invisible here by design; documented, not fixed) | none |
| Needs-attention queue + aging | client filter/sort over classified days + `isPastDate` | none |
| Period rail total + week lines | PeriodWorkspace's existing week sums (already R13 via #456's client aggregation) | low - W0 verifies the week sums flow through a round2 path |
| Homestand ledger (games, meal sums per HS, next/future) | client-side `deriveHomestands(days)` in `season/homestandDerivation.js`, bucketing already-loaded `days[]` on `homestandId` and summing `actualMeals` per bucket. AWAY rows carry `homestand_id=NULL` and EXH-prefixed IDs are excluded from homestand counts - both filters are **load-bearing** and must be reproduced by any new summation | **closed - program is zero-engine-change.** W0 audit Q5 confirmed the client-side derivation. Decision 3 pre-authorized a smallest read-only extension; not needed |
| Notes-this-period row | existing noteEntries in day payloads | none |

## 8. Flag + transition strategy (sized for a 2-person audience)

- One flag: `SC_V2` - default off in prod; enabled via env for preview deploys and a `?v2=1` query
  override persisted to localStorage for Kevin's daily driving. Because the page is SC_ADMINS-gated,
  there is no end-user exposure risk during coexistence.
- Per-workstream sub-toggles only where a surface can meaningfully ship alone (ribbon, overview,
  drill, MLB, entry) - a tiny flags object, not infrastructure.
- Old and new coexist until W9; rollback at any point = flag off. No data risk at any phase because
  no phase touches writes except W7, which inherits Entry v2's own Option-A safety case.
- The site-lead rollout (page.js comment: swap gate to SC_DEV_EMAILS later) should land AFTER W9 so
  new users only ever meet v2. Recommendation recorded as decision #5.

## 9. Workstreams

Each = 1-3 PRs, intent-first CC prompts, deploy-screenshot-grade loop, its own parity acceptance +
cleanup quota + rollback (flag off). Kevin merges everything.

**W0 - Audit + reconciliation (CC's expertise, front-loaded). Deliverable: `docs/SC_REDESIGN_AUDIT.md`.**
CC answers, code-cited: (1) exact component/ownership map of `ServiceCalendar.js`'s 2,572 lines -
what still lives there vs `season/` (hero, admin toggle, bulk update, DayDetail host, view routing,
MLB month view?); (2) disposition of the two stranded branches (merged? superseded? delete/fold);
(3) the season-summary payload shape the rail will consume; (4) whether PeriodWorkspace week sums
are round2-clean; (5) the homestand meal-sum derivation answer (section 7); (6) what "Period mode"
renders for MLB accounts today (unknown - my renders assumed Calendar-primary); (7) dead-CSS map
across the 8 files; (8) deep-link params inventory (`?account&month/period&...`) and any other
entry points (Today buttons, drill-ins from tiles, admin links); (9) hero dependencies (`sc-hero`
API consumers, admin lock, as-of) and safe retirement path; (10) anything in flight I have not seen.
Plus: baseline screenshot set of every current surface, and numeric contrast baselines.
Cleanup: delete/fold stranded branches; log program into `docs/PROJECT_DASHBOARD.md`.

**W1 - Theme foundation.** `.scv2` token block, type scale, cell/tile/pill skins for the DaySquare
atom, rail palette - applied nowhere yet except a flag-gated skin on the existing year grid to prove
the atom reskins cleanly. Acceptance: with flag on, year grid renders v2 cells with zero behavior
change; all state cues (incl. failed/loading/off-season hatch/ST corner/notes bubble) verified
against `legendItems.js`; contrast numbers pass. Cleanup: dead-rule sweep round 1 from W0's map.

**W2 - Ribbon.** Replace the in-`ServiceCalendar` hero with the ribbon fused to a restyled
ChromeBar; rehome the admin lock and as-of pill into the ribbon; retire the `sc-hero` fetch for SC
(API action retired only if W0 shows no other consumer). Acceptance: every ChromeBar affordance
present (account, tag, toggle, stats, export, Today), admin toggle works, as-of live, deep links
unaffected. Cleanup: hero JSX + hero CSS removed from the v2 path; ServiceCalendar sheds its first
layer.

**W3 - Season rail (Calendar mode).** Rail shell components + season derivations + queue + footer
action; two-pane shell layout with the 1280-min collapse rule. Acceptance: rail figures reconcile
with the month footers they summarize (derived, same source); queue rows open the correct day's
entry; legend band + failed-cell behavior intact; rail `aria-live` announced.

**W4 - Period mode + season rail.** PeriodCard reskin, phase strips, the aging queue framing,
retirement of the standalone Season Summary card into the rail. Acceptance: P-card footers derived;
overdue aging correct across month boundaries (C1b read-time dates); Season Summary parity - every
figure it showed exists in the rail.

**W5 - Drill workspace.** Tile reskin + hover-lift, in-grid week bands, period rail with exact-2dp
hero + week lines + notes row, Export relocated to rail footer, grid keyboard nav (arrows between
tiles, Enter opens day). Acceptance: hero equals sum of its own week lines to the penny; week bands
equal rail lines; tile click-through to DayDetail unchanged; bulk update reachable and unchanged;
export output byte-identical to pre-move.

**W6 - MLB surface.** Homestand ledger rail (client-side `deriveHomestands` per W0 Q5 - no engine
touch), strip restyle, month stepper, away/non-game quieting, MLB legend. "MLB Period mode" is
**feature-flag paths inside the shared `PeriodWorkspace`** (`hasHomestandSchedule` /
`isFeeAccount` / `isMilb`) per W0 Q6 - NOT a separate view. W6 applies to those flag paths.
Acceptance: fee-account discipline enforced in code review (no `$` formatting imports on this
surface's rail; no amber/red tokens); EXH display-only; 0/81 counter parity; **SC-073 week cards
stay HIDDEN for `hasHomestandSchedule` accounts** (owner ruling 2026-07-09; must not silently
return).

**W7 - Entry v2.** Executes SC_ENTRY_V2_SCOPE.md phases 0-6 as written (Option A save model, fee
accounts stay v1, behavior-parity list is that doc's section 7), now consuming the shared Rail from
W3 instead of building its own. Sequenced here deliberately: the rail pattern is proven on three
read-only surfaces before it touches the write path - the safety ordering.

**W8 - Mobile.** The inversions from the approved frames: season rail-as-header + month rows; drill
day-rows under sticky week bands + sticky total; MLB game rows + away-band compression; entry
mobile per Entry v2 Phase 5. One breakpoint system, `env(safe-area-inset)` respected, 44px targets.
Acceptance: no horizontal scroll anywhere; every desktop action reachable; the quick-edits-vs-full-
entry framing decision (Entry scope decision #4) honored.

**W9 - Decommission + cleanup (the phase that keeps us honest).** Flag defaults flip; one release of
soak; then: legacy hero/season-summary/old skins deleted; `v2/` promoted into `season/`;
ServiceCalendar.js decomposed to a thin router (target: **1,400-1,700 lines** per W0 Q1
ownership-map math - the bulk overlays stay in-file and a BulkModeProvider refactor is explicitly
out of scope); CSS net-zero-or-better vs the 5,919-line entry baseline verified by count;
`sc-day-group-price` retired once W7 ports bulk-review pricing; docs updated
(`DESIGN_SYSTEM_REFERENCE.md` tokens/roles, `ARCHITECTURE.md` component map, `GOTCHAS.md`
additions, `PROJECT_DASHBOARD.md` closeout, `DESIGN_AUDIT_LEDGER.md` SC-### entries for the
program). Acceptance: `grep` proves zero references to removed components; the 4-part design
audit run on the final system; stranded branches gone.

## 10. Behavior-parity master checklist (acceptance spine; W0 may extend, never shrink)

Chrome/global: account switcher incl. all 11 accounts; PDC/MLB/MiLB tag logic; Calendar/Period
toggle; Today; stats cluster; export; admin lock + admin routes untouched; deep links
(`?account`, month/period params) in and out; toast system incl. recorded-variant outside-click
dismiss (SC-068); Coming Soon gate untouched.
Day states: the full `dayResolvers` enum + overlays; failed NEVER zero; loading skeleton; off-season
hatch; ST corner; notes bubble at half opacity; game-day corner; today ring.
Overview: month/period footers derived-not-painted; phase strip accuracy from `phaseDerivation`;
legend popup + new band; stepper.
Drill: tile -> DayDetail open (incl. edit-today path); bulk update; week sums = rail = bands;
progress header semantics; period navigation.
MLB: homestand strip; day/night chips (`gameTimeFormat.js`); away/non-game/EXH; no-urgency rule;
counters.
Entry: SC_ENTRY_V2_SCOPE section 7 in full (ghost/0/entered, archived chip, mark-no-service,
discard guard, offline queue + SYNCING, noteFailed partial, ride-along + Activity composer +
merged ledger, day-nav reseed, focus management).
Cross-cutting: R13 footing on every money surface; keyboard + focus visible; reduced-motion;
contrast numbers on record.

Parity checklist additions (W0 findings):
- `?clientToday=YYYY-MM-DD` param is **load-bearing** for `isPast`/`isLocked` anchoring on the
  operator's local calendar. Any new data-fetch path introduced by a workstream must forward it
  intact on both `sc-load` and `sc-year-summary` (see GOTCHAS).
- `?reset=1` TopNav-intercept behavior (TopNav.js:429-430): clicking Service Calendar while
  already on SC pushes `?reset=1` instead of navigating. Any ribbon or shell rework in W2 must
  preserve this behavior.
- **SC-073 week-cards HIDDEN for `hasHomestandSchedule`** (season/PeriodWorkspace.js:1029, owner
  ruling 2026-07-09): must not silently return in W5 (drill) or W6 (MLB). The week grid still
  exists in `weekMetrics` and may resurface for a future dashboard - the removal is the *render*,
  not the data.
- **Account-switch abort semantics** (ServiceCalendar.js:489-505): six caches cleared as a unit
  plus `inFlightControllersRef.abort()`. Must move intact as one block if W9 splits fetches into
  a `useScData` hook (see GOTCHAS).
- **`?day=YYYY-MM-DD` tile-targeting param (W5)**: drill-only; scrolls the targeted tile into
  view and adopts it as the roving-focus target of the WAI-ARIA keyboard grid so keyboard Enter
  opens intentionally. **Never auto-opens DayDetail** - entry stays an explicit user action
  (click or Enter). Ignored in year view. Cleared by `?reset=1` and on leaving the drill. Any
  future rail source that targets a specific day (drill queue rows, notes line, cross-module
  deep links) MUST route through this param and honor its "target-only, never open" contract.

## 11. Cleanup ledger (specific, tracked per PR)

1. Stranded branches dispositioned (W0). 2. Hero JSX/CSS + `sc-hero` SC usage removed (W2/W9).
3. ServiceCalendar.js decomposed to router (W2 starts, W9 finishes; W0 sets the cut lines).
4. Dead-CSS sweep from W0's map, executed across W1-W9 with per-PR counts in the PR body.
   **Cadence expectation (revised at W1 per PR #460 correction):** interim workstream passes will
   harvest small (~50-line) batches - most of the W0 Q8 table was false positives from static-grep
   scanning that missed template-literal producers. The bulk of the net-count comes at W9 via
   whole-block deletions (legacy hero, retired skins, decommissioned overlays), not incremental
   class-by-class cleanup. Producer-grep verification before every deletion is mandatory (see
   `GOTCHAS.md` "CSS dead-class analysis MUST verify dynamic producers").
5. Legacy month-view remnants retired if W0 shows PeriodWorkspace superseded them.
6. `sc-day-group-price` + `/plate` literal retired after bulk-review ports (W7).
7. Duplicate local formatters (admin `fmtPrice` copies) consolidated onto `season/format.js` where
   safe (W9). 8. Docs updated as listed in W9. 9. CSS net-count exit criterion enforced.

## 12. Risk register (ranked)

- **R1 - God-component decomposition.** 2,572-line ServiceCalendar with hero/admin/bulk/routing
  interwoven. Mitigation: W0 ownership map first; decompose in slices attached to workstreams that
  need the slice; never a big-bang refactor PR.
- **R2 - Unknown MLB Period-mode semantics.** My renders assumed; W0 answers; W6 gated on it.
- **R3 - Homestand meal-sum derivation** (section 7). Gated decision before W6; the only place the
  program could touch a server action, and only with Kevin's explicit yes.
- **R4 - CSS collision under coexistence.** Mitigation: `.scv2` scoping discipline + W0 dead-rule
  map + the net-count criterion.
- **R5 - Entry v2 save-model decision** still open (its decision #1). W7 blocked until answered;
  everything W1-W6 proceeds regardless.
- **R6 - Motion cost on 365-cell grids.** Mitigation: motion only on interaction targets, none on
  idle grids; reduced-motion path; verify no layout-thrash in W1 skin PR.
- **R7 - Aging/midnight correctness** in the queue. Mitigation: reuse `isPastDate` read-time rule
  (C1b) - never trust payload `isPast`.
- **R8 - Scope creep into engine.** Fence in section 3; any exception is a named decision, never a
  drive-by.

## 13. CC leverage protocol

W0 is CC-led discovery with a numbered answer sheet (section 9) - the same pattern that produced
`SC_ALIGNMENT_REPORT.md` and worked. Every subsequent workstream prompt: intent + constraints +
parity list + cleanup quota; CC proposes the implementation and MUST surface drift between this doc
and code before building (doc yields to repo; drift logged, not silently absorbed). Three-way audit
each surface: CC measures parity in code, Chat-Claude grades renders + math + contrast, Kevin runs
the operator pass. CC never merges.

## 14. Verification model (no test suite, by policy)

Per-PR: build + the surface's parity checklist + screenshots (desktop min-width 1280 and typical
1440, plus mobile for W8) + derived-figure reconciliation (rail vs footers vs lines) + numeric
contrast for any new pairing + R13 penny checks on billing surfaces. Program-level: W0 baseline vs
W9 final audit; DESIGN_AUDIT_LEDGER entries closed.

## 15. Sequencing + sizing (logistics, not decision factors)

Order: W0 -> W1 -> W2 -> W3 -> W4 -> W5 -> W6 -> W7(6 sub-phases) -> W8 -> W9.
PR count: W0:1 · W1:1-2 · W2:1 · W3:1-2 · W4:1 · W5:1-2 · W6:1-2 · W7:6-7 · W8:2-3 · W9:1-2 =
roughly 17-22 PRs. Natural pause points after W2 (ribbon shippable alone), W5 (all PDC read
surfaces), W7 (entry). Recommended roadmap slot: after Stage 5 finance CSVs (short, finance-
unblocking) and before Admin Dashboard / Fun Money / Close Day - those three should be BUILT on the
v2 system rather than restyled after. OPD workstream unaffected and parallel.

## 16. Decisions for Kevin (the green-light gate)

1. Program approved as scoped (reskin-over-existing-atoms framing, W0-W9)?
2. Entry v2 decision set (its section 11, above all the Option-A save model) - required before W7,
   comfortable to answer now.
3. Homestand-ledger data path: pre-authorize "smallest read-only extension if W0 proves derivation
   impossible client-side," or hard-fence to client-only (ledger degrades to schedule-only)?
4. Ribbon replaces the hero on SC (admin lock + as-of rehomed) - confirm; and is the ribbon pattern
   SC-only for now (recommended) or a future site convention to note in docs?
5. Site-lead rollout holds until W9 so new users only ever meet v2 - confirm.
6. Roadmap slot: after Stage 5, before Admin Dashboard / Fun Money / Close Day - confirm or reorder.

## 17. Decision log (2026-07-17)

Section 16's decision list, resolved:

1. **Approved** as scoped. Program proceeds from W1.
2. **Entry v2 = Option A** save model. Coexists per-account via a per-account cutover; fee
   accounts stay on v1 (STL-FL flat_fee + fee-no-dollar preserves its discipline); mobile is
   framed as **quick-edits, not full entry** - W8 honors this (any full-entry mobile flow is
   parked).
3. **Homestand ledger derivation: closed as client-side.** W0 Q5 confirmed
   `deriveHomestands(days)` in `season/homestandDerivation.js` derives per-homestand sums
   from already-loaded `days[]`; no engine touch needed. AWAY (homestand_id=NULL) and EXH-prefixed
   IDs are load-bearing filters.
4. **Ribbon replaces the hero, SC-only.** Not a site-wide convention yet; other module heroes
   (ops, financial) keep theirs.
5. **Rollout holds until W9.** Site-lead flip in `page.js` (SC_ADMINS -> SC_DEV_EMAILS) happens
   only after decommission so new users only ever meet v2.
6. **Roadmap slot confirmed.** Program proceeds now; Stage 5 finance CSVs interleave in parallel
   (orthogonal - no shared surface).
7. **Display-scaling posture.** Absorb zoom, never counter it - no `zoom`/`transform` compensation
   hacks. W1 lands fluid `clamp()`-based type/spacing tokens plus a `--sc2-scale` variable and a
   `[data-density]` hook (Compact/Comfortable) *without* the toggle UI - the toggle ships with the
   ribbon in the W2-W4 bundle. Effective-viewport floor is ~1024px; layout compaction below it
   lands in W8. This is an accessibility posture, on record.

## TLDR

The repo revealed the decisive fact: SC already runs on a componentized redesign, so this program is
a theme + an additive Rail system + the Ribbon + Entry v2 + mobile - riding `dayResolvers`,
`DaySquare`, `SeasonShell`, `PeriodWorkspace`, and the R13 money engine untouched. Ten workstreams,
~17-22 PRs, one lightweight flag (safe because the audience is currently two admins), CC-led W0
audit before any pixel changes, cleanup enforced by a CSS net-count and a ServiceCalendar
decomposition target, and rollback at every step is a flag flip. Six decisions gate the start;
answer them and W0's CC prompt is the next artifact.
