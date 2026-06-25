# SC Redesign - Scope Audit

**Status:** Pre-build audit of the spec at `docs/SC_REDESIGN_SPEC.md` (and the
companion staged plan at `docs/SC_REDESIGN_PLAN.md` - reproduced inside this PR's
description; not committed). Read-only ground-truthing against the actual code
on `main` HEAD `88613d3`. The job: tell the redesign team what they cannot see
from outside.

This is honest due diligence, not validation. Findings are tied to specific
files and line ranges. Where the plan is right, it's noted briefly. Where the
plan is wrong or thin, that gets the page.

---

## TL;DR (the headline findings)

1. **Engine + API contract IS safe for the redesign**, except one small gap: for
   the Period view of the year (Stage 2), `sc-year-summary` ships `periodRanges`
   today (post-PR-B2a) but does NOT include `period` on each `months[].days[]`
   entry. Either accept client-side date-bucketing into periodRanges (works) or
   land a one-line engine extension to surface `day.period` in the year summary
   response. NOT a blocker.
2. **`lens` + `scope` are NOT cargo-cult, they are load-bearing.** The plan's
   Stage 4 ("remove dead lens/scope code") is the wrong frame: lens/scope is
   live state driving the year-summary effect guard, goToToday, render
   branching, and URL sync. A replacement drill-state model has to land FIRST
   (Stage 1), then ride alongside until polymorphism is verified, then the old
   code gets removed in a dedicated final stage. Three stages, not one.
3. **The admin surface (~2,272 lines across 12 files) is not in the plan.** The
   spec mentions "Admin entry" once; in reality the admin panel is an in-page
   view-mode (`isAdminView` gate) with its own AccountEditor, FeeAccountEditor,
   six write panels, and its own CSS file. The redesign must explicitly declare
   it OUT OF SCOPE and preserve the entry point + isAdminView gate.
4. **The bulk-entry flow has no home in the new design.** Bulk mode (select
   days -> apply one entry to all) lives entirely in today's month view; the
   Period workspace spec at section 5 doesn't mention bulk. Either spec a bulk
   surface in the Period workspace, or kill bulk explicitly.
5. **DayDetail is more coupled than "minor prop wiring."** It reads
   `homestandContext`, `monthRevenue` (used for "% of month"), and the day's
   `isFeeAccount` flag. Period workspace will pass DIFFERENT revenue scope
   (period instead of month) and possibly a different homestand window;
   semantics drift silently unless documented.
6. **Phase data for the operational strip (Stage 1) is incomplete.** Phases are
   RECORDED for 3 of 5 PDCs in `sc_day_metadata.event_label` (the "Camp Name"
   column - clean for CIN-AZ, TBR-FL; per-day game labels for TXR-AZ); INFERRED
   for 2 of 5 (TBJ-FL, STL-FL). There is no `sc_phases` table. The plan's
   "persistent phase strip" needs a phase-derivation helper + explicit fallback
   for accounts with no phase data.
7. **The plan's recent ancestor (PR-B2a/B2b) shipped exactly the surfaces the
   redesign reverses.** The directional slide, week-pills, idle-prefetch, and
   save-animation (PR #262-#264, merged 2026-06-23 through 2026-06-24) are
   discarded by the new model ("NO week buttons. NO week-switching. NO
   directional slide" - spec §5). That's fine but worth naming: the redesign is
   a directional pivot, not an evolution.

The plan's bundling proposal (Stage 0+1 together; 4+5 together) is **the most
debatable structural call**: see §D for an honest pushback that argues for
**seven stages instead of six**.

---

## A. Engine contract reality

The plan claims the engine (`src/lib/dataStore/serviceCalendar.js`) and the API
actions can stay untouched. Validated: **yes, for Stage 1 and the bulk of the
redesign, this holds**. One small gap for Stage 2 below.

### What's already there (and stable)

- **`loadMonthData`** (dataStore L655-657) returns `{ month, days[] }` with
  each day carrying `meta.period`, `meta.week`, `meta.gameType`, `totals`
  (`projectedRevenue`, `actualRevenue`), `projected`/`actual` per-service maps,
  `isPast`, `isLocked`, `hasActuals`, plus `homestandMap` when present. The
  redesign's day-square atom can render entirely from this shape.
- **`loadYearSummary`** (dataStore L1036-1038) returns `{ year, months[], today,
  periodRanges }`. The `periodRanges` array is already in the response
  (post-B2a, route.js L390-405). Per-month: `totalDays`, `daysWithActuals`,
  `projectedRevenue`, `actualRevenue`, `projectedCovers`, `actualCovers`, plus
  `homestandSummary` (fee accounts) and per-day `{ date, status, gameType,
  actualMeals, homestandId?, dayType?, opponent? }`.
- **`sc_daily_revenue`** view applies the #257 `price_kind` (projected vs
  actual) fork correctly. Every `day.totals.actualRevenue` /
  `projectedRevenue` figure the UI displays is engine-computed from this view.
  The redesign must never recompute revenue client-side.
- **Save path** (`sc-submit-day`, `sc-bulk-submit`) is touched-only on the
  orchestrator (P0-1 pattern). The UI half (DayDetail sending only touched
  services) is in place.

### The one gap: per-day `period` in `sc-year-summary`

The redesign's Stage 2 Period view of the year needs to bucket days into
periods. `periodRanges: [{ period, start, end }]` is there; what's NOT there is
`period` on each `months[].days[]` entry. The redesign team has two paths:

- **Path A - client-side bucket by date.** Walk `months[].days[]`, derive each
  day's period by matching `day.date` against `periodRanges` date windows.
  Works. Zero engine touch. Cost: one extra date-range lookup per day during
  Season-Period grid rendering (~366 dates/year, trivial).
- **Path B - one-line engine extension.** Add `period` to the
  `transformDaysForMonth` projection in `loadYearSummaryPostgres` so each day
  carries its period label inline. This is the same query already running for
  `meta.period` on `loadMonthData`. The diff is small (~5 lines in dataStore,
  ~0 in the route).

**Recommendation: Path A first.** Ship Stage 2 with client-side bucketing -
keeps the engine contract literally untouched and avoids a dataStore PR riding
the redesign. If the bucketing becomes a hot spot (it won't, but never trust
intuition), do Path B in a follow-up.

### What's gone but never used

- `sc-day-override` (route.js L1033-1041) returns 501; DayDetail receives an
  `overrides` prop and filters it (DayDetail L532) but never renders. Dead
  field. The redesign can drop the prop wiring.
- `sc-submit-clickers` (route.js L1044-1050) returns 501. No UI ever. Out of
  scope.

### Confirms

- `data.account.billingModel` is `"flat_fee" | "actuals_drive_invoice" |
  "projections_drive_invoice" | null` - the redesign's billing-model fork in
  §6 maps cleanly to this field.
- `data.account.category` is `"MLB" | "MiLB" | "PDC" | "CORP" | "Other"` -
  drives the operational-shape branch (homestand vs phase).
- `homestandMap` only present for flat_fee accounts (PG check in
  loadMonthData). Per-meal accounts get no map at all.

### Stage 2 verdict

The plan's claim that Stage 2 might need "engine extension minimally" is
**already not needed**. periodRanges already ships. Per-day period bucketing
is client-side. Stage 2 is pure UI.

---

## B. What the plan is missing

### B.1 The admin surface (CRITICAL GAP)

The spec at §4 mentions "Admin entry" as part of the account header. It does
not address the substantial admin UI that already exists.

What's actually there (`src/app/service-calendar/admin/`, ~2,272 lines):

| File | Lines | Purpose |
|---|---|---|
| `AdminPanel.js` | 55 | View-mode router: overview / account drill / fee drill |
| `AccountsOverview.js` | 174 | List of 12 active accounts split per-meal vs fee |
| `AccountEditor.js` | 528 | Per-meal config editor (groups, services, prices, archive) |
| `FeeAccountEditor.js` | 196 | Flat-fee account editor (annual fee + scheduled changes) |
| `PriceEditPanel.js` | 285 | Inline price editor (Today/Future/Backdate radios) |
| `FeeEditPanel.js` | 256 | Fee amount editor (mirrors price editor) |
| `AddServicePanel.js` | 152 | Add service + initial price + flags |
| `AddGroupPanel.js` | 105 | Add group |
| `ArchiveServicePanel.js` | 196 | Archive service (sets `active_until`) |
| `ArchiveGroupPanel.js` | 203 | Archive group + cascade option |
| `ReactivatePanel.js` | 95 | Reactivate archived |
| `page.js` | 27 | Redirect `/service-calendar/admin` -> `?view=admin` |

Wired to **9 admin write actions** (route.js L698-1029): `sc-admin-fee-set`,
`sc-admin-add-service`, `sc-admin-add-group`, `sc-admin-archive-service`,
`sc-admin-reactivate-service`, `sc-admin-archive-group`,
`sc-admin-reactivate-group`, `sc-config-update`, `sc-config-request`.

Plus **4 admin read actions**: `sc-admin-all-config`, `sc-admin-account-config`,
`sc-admin-fee-list`, `sc-admin-fee-history`.

**Decisions the redesign must make explicitly:**

1. Is the admin surface in scope for the redesign? Spec implies no.
2. If out of scope, the redesign keeps `isAdminView` gate (ServiceCalendar.js
   L131) + the AdminPanel entry point. The new Calendar/Period toggle must
   coexist with an admin entry button somewhere in the chrome (the existing
   `.sc-admin-esc` button or equivalent).
3. URL sync (?view=admin) at ServiceCalendar.js L258-265 stays.
4. The admin CSS (`admin/ops-sc-admin.css`) stays untouched.

**Recommendation:** lock "admin surface is OUT of redesign scope; entry point
preserved; isAdminView state survives" in §9 of the spec. Currently the spec is
silent and a careful reader would infer "redesigned along with everything else"
- which would balloon the scope by ~2,300 lines.

### B.2 The bulk-entry flow (orphaned)

Bulk mode lives in today's month view: `bulkMode` state (ServiceCalendar.js
L163), `bulkSelected` set, `bulkPanelOpen` overlay (L1405-1454), and the bulk
action bar (L820-835). It's the "select these 5 game days; apply this entry to
all" path - useful for fee accounts entering repeating opponent meals.

The Period workspace (spec §5) doesn't mention bulk. The Calendar grid in Season
view (spec §4) only shows whole-month cards; no per-day selection exists at the
Season level. So bulk would have to either:

- Live in the Period workspace (the most natural fit - it's a per-day surface),
- Or be retired entirely (write the decision down).

**Recommendation:** spec the bulk flow in the Period workspace. Otherwise it
silently dies in Stage 3 and a real workflow is lost.

### B.3 Loading / partial / error / empty / off-season states

The plan mentions "First-run shows projected data; never an empty grid" (§7.7)
and "Off-season periods rendered as 'Offseason' cards" (§7.5). The spec is thin
on:

- **Loading the Season grid** - skeleton matching the new 4x3 grid shape.
  Today's `loading` boolean + `oh-spinner` won't fit the new layout.
- **Partial data** (the B2a "couldn't load Jul 2026" pattern, PeriodLensView
  L108-119) - the Period workspace already does this. The Season grid needs the
  same discipline if one of the underlying month fetches fails.
- **No-config account** - if a new account hits the UI before catalog is
  seeded, `serviceGroups` is empty. Today's DayDetail shows an empty form;
  what does the new Season grid show?
- **A logged-in user with NO `user_accounts` mapping** - falls back to
  `CIN - AZ` today (ServiceCalendar.js L184). Stays the same?
- **Error states for the operational strip** - if phase data is missing for an
  account (TBJ-FL, STL-FL), what does the strip render? "Phase data not
  available" with which palette?

The spec doesn't have to enumerate, but a **state catalog at the Stage 1 / 2 /
3 build prompts** should.

### B.4 Phase-derivation utility (Stage 1+2)

The phase strip (spec §4.2) and the phase-tinted period cards (§4.4) need a
phase-derivation helper. Today there is:

- **NO `sc_phases` table** in the schema.
- Phase truth lives in `sc_day_metadata.event_label` for 3 PDCs (per
  `SC_PDC_PHASES.md`). Quality varies:
  - CIN-AZ: clean phase calendar in event_label.
  - TXR-AZ: clean macro phases EXCEPT the Spring Training window (Feb 20 -
    Mar 22) which is recorded as per-day game-type labels, not a phase name.
  - TBR-FL: clean on the Projections tab; Actuals tab adds per-game noise.
- TBJ-FL and STL-FL have NO recorded phases - inference + Kevin confirmation.

What the redesign needs:

- A `deriveAccountPhases(account, year)` helper that returns a normalized
  phase calendar `[{ phase, start, end, tintToken }, ...]`. Reads
  `sc_day_metadata.event_label` (via the existing route, or a new admin-style
  helper), groups consecutive same-label days into ranges, handles the TXR-AZ
  Spring Training window as a single derived phase, falls back to a
  documented "no phase data" rendering for TBJ-FL / STL-FL.
- An explicit "phase tint" token table - the 4 phase tints (per spec §8). Map
  Camp / Extended / Instructs / Offseason / Bridge to tokens.

The spec lists this as a still-open sub-decision (§8 "Color-load audit"). It
deserves a dedicated build helper in Stage 0 or 1, not deferred to "the build
will figure it out."

### B.5 The operational strip's homestand variant

For MLB / MiLB accounts, the strip is "homestand arc spanning the year." Today
the homestand data is per-day (`homestandMap` for fee accounts only, from
`sc_homestand_schedule`). There is **no current year-spanning homestand
visualization** - the month view shows the current month's homestand context;
the year heatmap colors game-days but doesn't render homestand bars.

The redesign's Stage 1 needs to build this from scratch. Spec §4.2 names it as
"homestand arc" but doesn't size it. Realistic scope: a year-wide ribbon
showing HS1 / HS2 / ... bars by date range, possibly with opponent labels at
each. Not trivial.

Worth flagging this as a Stage 1 subtask, not folded into "build the Season
shell."

### B.6 Hero image + Coming Soon gate (rollout)

`page.js` L23-29 fetches `sc-hero` for a random hero image. `SC_ADMINS` gate
at L54 hides the entire SC from non-admins (currently 2 hardcoded emails). The
spec doesn't address either:

- Does the new Season landing keep the hero image? Drop it?
- When does the SC_ADMINS gate widen? Is that a redesign concern or a separate
  rollout decision?

**Recommendation:** out of scope for the redesign. Document explicitly.

### B.7 Account-switch race / hover states / focus management

Detail-level missing from spec:

- **Account-switch invalidation** (ServiceCalendar.js L218-222 + the post-B2a
  monthCache/periodKey/weekKey clear) is correct today. The redesign must
  preserve the clear discipline on account change.
- **Focus management** when clicking from Season -> Period workspace. Today
  the click sets a state and the new body fades in; the spec mentions "fade-in"
  but not where focus lands after drill-down. WCAG-relevant.
- **Hover treatments** on the new period cards. The spec is silent.

Style nitpicks; the build prompts should pick them up. Surfaced for completeness.

---

## C. Hidden dependencies / entanglements

### C.1 Lens/scope is NOT dead code

The plan's Stage 4 says "remove all dead lens/scope code." This frame is
wrong. lens/scope is **live primary state** with the following dependents:

- **The year-summary effect's guard** (ServiceCalendar.js L237-265): the
  effect fires when `(isYearView) || (lens === "period")`. Removing lens/scope
  without a replacement gates the year-summary fetch incorrectly.
- **`goToToday`** (L591-595): explicitly sets `scope="month"` + `lens="calendar"`.
  Without lens/scope, this handler needs new state to set.
- **Render branching** (L753 `{isMonthView && ...}`, L1114 `{isYearView && ...}`,
  L1717 `{isPeriodView && ...}`): the only thing switching which body renders.
  Replacing lens/scope means replacing every render guard simultaneously.
- **URL sync** (L258-265): `?view=admin` writes when `isAdminView` flips.
  Doesn't depend on lens/scope, BUT the URL `?period=` sync at L438-450
  reads `lens` + `periodKey`. URL routing is tied to lens.
- **`computeInitialView`** L18-25: returns the initial scope+lens triple.
  Mount-time state derivation depends on these names.

**The correct sequencing:**

1. Stage 1 introduces a NEW drill-state model alongside lens/scope (`view:
   "season" | "calendar" | "period"`, `monthKey`, `periodKey`). The new model
   sits underneath; the old lens/scope state still drives effects + render.
2. Stages 2-3 build new surfaces gated on the NEW model; old surfaces remain
   under lens/scope.
3. Stage 4 wires drill-down: the new Season grid's click handlers set the new
   drill state. The old LensBar is no longer rendered. lens/scope state still
   exists but nothing sets it anymore.
4. **Stage 5 (NEW) - polymorphism hardening on the new model only**. Confirm
   per-meal, MLB-fee, MiLB, PDC-fee all work end-to-end on the new model.
5. **Stage 6 (NEW) - remove lens/scope, computeInitialView returns the new
   shape, URL sync rewired, year-summary effect guard rewritten**. Only after
   polymorphism is proven across accounts.

The plan compresses this into Stages 4+5. That's the riskiest bundling.

### C.2 monthCache and the period-data effect

PR-B2a introduced `monthCache` (ServiceCalendar.js L160), the period-data
effect (L320-363), and the save-invalidation effect (L431-439 - "clear
monthCache when reloadKey changes"). These were built specifically for the
Period lens that the redesign is replacing.

Question for Stage 3: does the new Period workspace reuse `monthCache` +
`monthsBetween` + the period-data effect verbatim? Or does it rebuild?

If reuse: Stage 4's "dead code removal" must NOT touch them.

If rebuild: Stage 3 has more lift than "replace PeriodLensView."

**Recommendation:** the build prompt for Stage 3 should explicitly say "reuse
the periodDays + periodMetrics + monthCache pipeline from PeriodLensView; the
day grid is the new rendering surface but the data path is preserved."

### C.3 DayDetail couplings

The spec says DayDetail stays unchanged ("minor prop wiring"). The reality:

- `monthRevenue={metrics.actRev || metrics.projRev}` (ServiceCalendar.js L1604).
  Used inside DayDetail to compute "% of month" for the saved day. If the
  Period workspace passes `periodRevenue` instead, the line silently means "%
  of period." That's probably what the redesign wants - but the variable name
  and the displayed copy ("% of month") need to change.
- `homestandContext={homestandMap[focusDay] || null}` - passes the per-day
  homestand context. Reads from data.homestandMap. Works for any account but
  is null for per-meal. Stays.
- `isFeeAccount` boolean - drives the coaching banner copy in DayDetail
  (L218-238). Stays.
- `serviceGroups={data?.serviceGroups || periodServiceGroups}` (L1601) - the
  B2a fallback to periodServiceGroups when the focused day belongs to a
  calendar month different from `data`. The redesign's Period workspace must
  preserve this fallback.

**Minimum** prop-wiring change for the redesign: rename `monthRevenue` ->
`scopeRevenue` and update DayDetail's "% of month" label to "% of period" when
called from Period workspace. Plus document the new wiring contract.

This is more than "minor" but not big. Worth being explicit in the Stage 3
prompt.

### C.4 OperationalView retirement scope

OperationalView (161 lines) is imported at ServiceCalendar.js L9-16 and used in
**6 call sites** in ServiceCalendar.js + 1 in PeriodLensView.js. The plan says
"folded into the new account-polymorphic tile/header logic or retired" (§9).

Reality: the spec's day-square atom (§3) plus the account-polymorphic content
layer (§6) absorbs OperationalView's six exports cleanly. The retirement is
clean IF the new atom enforces the no-$ discipline structurally (the
OperationalView pattern of "import GREEN + AMBER but NOT fmt$" so the
discipline shows up in code review).

**Recommendation:** Stage 0 (atom) explicitly documents the no-$ discipline for
the operational variant. Stage 5 polymorphism hardening verifies STL-FL renders
with zero $ tokens.

### C.5 React inner-component trap (GOTCHAS L164-186)

The day-square atom CANNOT be defined inside ServiceCalendar's render body or
a new Season component's render body. Today the same trap is already encoded:
ServiceCalendar.js's AccountDropdown (L61-97) is defined OUTSIDE the
ServiceCalendar component for exactly this reason.

The redesign's Stage 0 must put `<DaySquare>` in its own file
(`src/app/service-calendar/DaySquare.js`). And then the day-square stays at
module scope (not nested inside Season / Period / DayDetail). Worth calling
out in the Stage 0 prompt explicitly.

### C.6 UTC date handling for period boundaries (GOTCHAS L105-121)

Vercel runs in UTC. The redesign's phase-derivation, period-day bucketing, and
"is today inside this period" comparisons must normalize hours:

```javascript
const start = new Date(period.startDate);
start.setHours(0, 0, 0, 0);
const end = new Date(period.endDate);
end.setHours(23, 59, 59, 999);
```

The existing `today >= r.start && today <= r.end` pattern (ServiceCalendar.js
L373) compares strings (`"YYYY-MM-DD"`) lexicographically, which works because
ISO date strings sort correctly. That pattern is safe to keep. But any
`new Date(date)` comparison needs the normalization.

Worth surfacing in Stage 2 (where period bucketing lands).

---

## D. Stage boundaries + bundling - honest pushback

The chat-side proposed bundling: **0+1 together, 2 solo, 3 solo, 4+5
together**. My audit of the actual code disagrees.

### D.1 Bundle 0+1: SPLIT IT

Stage 0 (the day-square atom) is small (~one component, one CSS block,
~150 lines total). Self-contained. Could ship alone in a half-day PR.

Stage 1 (the Season shell + Calendar view + persistent operational strip + the
Calendar/Period toggle in disabled state + new landing) is BIG:

- New top-level Season component.
- The persistent phase strip is brand-new visual surface (B.5 above) - phases
  for PDC and the year-spanning homestand arc for MLB/MiLB.
- The Calendar/Period toggle as a new component (replaces LensBar).
- The 12-month calendar grid using the Stage 0 atom.
- Landing logic update (computeInitialView).
- Coexistence with the existing lens/scope state and the existing year/month
  bodies (per C.1, the old code stays).
- New CSS (~300-500 lines).

Bundling 0+1 means the atom + the shell ship as one PR. If the atom needs an
adjustment after seeing it in context (a common-good outcome), it ships behind
the shell PR's larger surface. If the shell breaks something, the atom is
revertible only by reverting the whole bundle.

**Recommendation: Stage 0 ships ALONE.** Land the atom in `DaySquare.js` with a
state gallery page (or storybook-style preview, even if just a dev-only
`/service-calendar/atom-test`). Get it visually right. Then Stage 1 builds on
proven primitive.

### D.2 Stage 2 (Period view of year) solo: AGREE

Period-card grid + Full Season summary card + phase tints + period bucketing.
Genuinely novel surface. Keep solo.

The plan calls this "Stage 2" but its scope as described maps to a couple
non-trivial Stage-internal sub-decisions:

- Period bucketing helper (per A above - client-side Path A recommended).
- Phase-derivation helper (per B.4 - including the TXR-AZ Spring-Training
  window and the TBJ-FL / STL-FL "no recorded phases" fallback).
- The Full Season summary card content + position (4th-row slots 2-4).
- Phase-tint token table + the straddle rule (majority-phase + name both in
  subtitle, per spec §7.4).

Big stage. Keep solo.

### D.3 Stage 3 (Period workspace) solo: AGREE

The biggest single-stage UI lift: full Period workspace including the today
hero, the all-weeks day grid, the financial-frame fork, the climb buttons.
Replaces PeriodLensView.js end-to-end (~548 lines today).

Per C.2, the data path (monthCache + period-data effect) should be reused
verbatim. The new rendering surface (the all-weeks 7-wide grid + the today
hero) is what changes.

Per C.3, DayDetail's prop wiring needs careful handling for the
month-revenue-vs-period-revenue swap.

Keep solo.

### D.4 Bundle 4+5: SPLIT INTO 4 + 5 + 6

The chat-side proposed bundling Stage 4 ("drill wiring + landing + mobile +
polish + dead-code removal") with Stage 5 ("account polymorphism hardening").

This is the **worst sequencing risk** of the whole plan. Per C.1, the
lens/scope removal CANNOT happen before polymorphism is proven on the new
model. Bundling polymorphism with dead-code removal means: if Stage 5 finds a
polymorphism bug, the old code is already deleted - no fallback path. The
plan's own §"ROLLBACK POSTURE" line ("The old lens code stays until Stage 4
specifically so there's a working fallback path") contradicts the bundling
proposal.

**Recommendation: three separate stages.**

- **Stage 4 - Drill wiring + landing + mobile + motion** (NO dead-code
  removal). The new Season clicks now drive the new drill state. The old
  LensBar can be hidden but the old code still exists.
- **Stage 5 - Account polymorphism hardening** on the new model. Walk every
  account type through every level. Per-meal (CIN-AZ), MLB-fee (STL-MO),
  MiLB (CIN-KY), PDC-fee (STL-FL). Fix the forks. STL-FL is the proof case.
  Ship.
- **Stage 6 - Dead-code removal**. Now that polymorphism is verified, delete
  lens/scope state, the year/month bodies in ServiceCalendar.js, LensBar.js,
  PeriodLensView.js's old surfaces. Update computeInitialView. Rewrite URL
  sync. Update the year-summary effect guard.

Three stages instead of one. Each is shippable + revertible. The polymorphism
stage in the middle is the safety net.

### D.5 Revised stage sequence (7 stages)

| Stage | Scope | Files | Risk |
|---|---|---|---|
| 0 | Day-square atom + state gallery | NEW DaySquare.js + small CSS | Low |
| 1 | Season shell + Calendar view + persistent phase strip + toggle (Period disabled) + new landing | NEW Season component, computeInitialView update, ServiceCalendar.js coexistence | Medium |
| 2 | Period view of year (4x3 period cards + Full Season summary) | NEW component, phase-derivation helper, period bucketing | Medium |
| 3 | Period workspace (replaces PeriodLensView) | Rebuild PeriodLensView, reuse monthCache + period-data effect, DayDetail prop wiring | Medium-High |
| 4 | Drill wiring + landing + mobile + motion (NO dead-code removal) | Cross-cutting wiring, URL sync extensions, motion pass | Medium |
| 5 | Account polymorphism hardening | Walk per-meal / MLB-fee / MiLB / PDC-fee through every level | High (catches latent bugs) |
| 6 | Dead-code removal (lens/scope, old bodies, LensBar) | ServiceCalendar.js sweeping cleanup, computeInitialView reshape, URL sync rewrite | Medium |

The chat-side's 6 stages become 7. The trade is more PRs vs more confidence at
each merge gate. The codebase shows the latter is the right call.

---

## E. Risk register

Top risks ranked, each with a concrete mitigation tied to specific code:

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Lens/scope removed before replacement is proven** -> year-summary effect, render branching, URL sync, goToToday all break simultaneously | P0 | Sequence per D.4 - new drill state in Stage 1, old code stays until Stage 6 (after polymorphism in Stage 5) |
| 2 | **Phase derivation gap** for TBJ-FL and STL-FL -> phase strip + period-card tints render incorrect data or fall through to default tints silently | P1 | Stage 0 or 1 ships `deriveAccountPhases()` with explicit "no phase data" branch + documented fallback rendering; TXR-AZ Spring-Training window handled per `SC_PDC_PHASES.md` |
| 3 | **STL-FL $ leak** -> a single $ token in the operational frame breaks the no-$ discipline | P1 | Stage 0 atom enforces no-$ structurally on the operational variant (import GREEN + AMBER but NOT fmt$); Stage 5 verifies STL-FL has zero $ tokens via DOM grep |
| 4 | **Admin surface treated as redesigned** -> spec is silent, ~2,272 lines of admin UI silently in scope | P1 | Spec §9 explicitly says "Admin surface untouched; isAdminView gate + AdminPanel entry point preserved; LensBar replaced by new chrome but admin button survives" |
| 5 | **Bulk-entry flow orphaned** -> the multi-day "apply same entry" path silently dies in Stage 3 | P2 | Decide and write down: bulk lives in Period workspace OR is retired explicitly; don't let Stage 3 drop it by omission |
| 6 | **DayDetail `monthRevenue` semantic drift** -> the "% of month" label reads as "% of period" silently when called from Period workspace | P2 | Stage 3 prompt renames the prop to `scopeRevenue`; DayDetail picks the label dynamically; old call site (if any) passes month value with month label |
| 7 | **Date-comparison in UTC** -> period boundary "is today inside" check off by one in Arizona evenings | P2 | Per GOTCHAS L105-121: normalize hours when constructing `new Date()` for boundary checks; keep ISO-string lexicographic comparison where possible |
| 8 | **React inner-component trap** -> day-square or sub-component defined inside render body, state resets every render | P1 | Stage 0 puts DaySquare at module scope, Stage 1's Season component does the same; per GOTCHAS L164-186 |
| 9 | **monthCache + save invalidation broken** -> Period workspace saves don't reflect in real time | P2 | Stage 3 prompt explicitly reuses the existing save-invalidation effect (ServiceCalendar.js L431-439, "clear monthCache when reloadKey changes") |
| 10 | **Account switch race** -> stale data from previous account briefly visible | P2 | Stage 4 verifies the existing account-switch invalidation effect (L218-228) survives the refactor |

### Other relevant GOTCHAS

- **UTC dates** (GOTCHAS L105-121): see #7 above.
- **React inner components** (GOTCHAS L164-186): see #8 above.
- **Currency parsing** (GOTCHAS L12-21): NOT applicable - SC reads day.totals as
  pre-parsed numbers from sc_daily_revenue view, not Sheets strings.
- **str_replace whitespace** (L192-198): not a SC concern but worth honoring
  during edits.

---

## F. Anything else (the value section)

These are findings the questions didn't ask for, but the actual code says we
should know.

### F.1 The redesign reverses PR-B2a/B2b work explicitly

PR #262 (B2a) + #263 (B2b) + #264 (hotfix) shipped between 2026-06-22 and
2026-06-24. They added: directional slide week-switch, mobile touch swipe,
keyboard nav, idle prefetch of adjacent periods, save-animation via
`useAnimatedNumber`. They are merged on main.

The redesign spec §5 explicitly removes them: "NO week buttons. NO
week-switching. NO directional slide."

This isn't a problem - the design pivoted. But it should be NAMED:

- `useAnimatedNumber.js` (68 lines) gets deleted in Stage 3 or 6.
- The week-pill CSS gets deleted in Stage 6.
- The touch-swipe handler in PeriodLensView gets deleted.
- The keyboard nav effect (ServiceCalendar.js, ~30 lines) gets deleted in
  Stage 6.
- The idle-prefetch effect gets deleted.

Total reversal: ~150-200 lines of code that landed last week. Worth being
explicit so reviewers don't think it's accidental loss.

### F.2 The CSS file is a 1,578-line single file

`ops-sc.css` is one file. The redesign touches it heavily:

- ~400 lines DELETED (lens-bar, week-pills, period-tile-track, slide track,
  month-ribbon).
- ~500 lines REWRITTEN (year heatmap recast as the Calendar grid, period-card
  styles, operational strip, today hero).
- ~700 lines KEPT (day-tile atom states, modal/overlay styles, admin CSS is in
  a separate file).

A "scope fence: only ops-sc.css" doesn't cap the diff because the rewrites
are intermingled with kept rules. The build prompts should warn this.

### F.3 The "Coming Soon" gate is the silent rollout blocker

`page.js` L54 gates the entire SC behind a 2-email `SC_ADMINS` allowlist
(`@/lib/admin`). Non-admins see a "Coming Soon" page (L58-92). Until that gate
widens, the redesign ships only to k.fietek + joe (per the audit elsewhere).

The redesign doesn't have to fix this. But the build prompts assume "operators
will see the new SC" - which is currently FALSE until the gate widens.
Stage 5 polymorphism hardening can only be validated by Kevin himself unless
the gate is widened first.

**Recommendation:** before Stage 5, decide the rollout. Either:

- Widen `SC_ADMINS` to include the floor leads who would validate STL-FL,
  TBR-FL, CIN-AZ, etc.
- Or run Stage 5 against the Vercel preview with explicit chef walkthroughs.

### F.4 The data-billing / data-category root attributes

`<div className="sc-root" data-density="compact" data-billing={isFeeAccount ?
"flat_fee" : "per_meal"} data-category={data?.account?.category || ""}>` at
ServiceCalendar.js L668. CSS uses these via `[data-billing="flat_fee"]
.sc-tile-state--prep { ... }` and similar attribute selectors throughout
ops-sc.css.

The redesign's new root must preserve these attributes if any old CSS rules
are reused (they should be, per F.2's "KEEP" list - the day-tile states use
them).

Easy to miss. Stage 1 should call it out.

### F.5 The reloadKey + monthCache invalidation chain is fragile but works

The save -> setReloadKey -> sc-load + sc-year-summary refire -> monthCache
clears -> period-data effect refires chain (ServiceCalendar.js L431-439 +
effects above) is a Rube Goldberg machine that nonetheless works. The redesign
needs to inherit it intact OR replace it explicitly.

The cleanest replacement is what's already there: bump reloadKey, let
downstream effects refetch. Stages 3 + 4 should not rebuild this chain.

### F.6 isPast / isLocked semantics are advisory, not authoritative

Per the engine audit + the existing dataStore comments: `day.isPast` and
`day.isLocked` are computed server-side from server-LOCAL UTC midnight, NOT
the operator's local clock. A CT/ET operator at 8pm Friday sees a Saturday
isPast=true server-side - 8 hours early.

This is **advisory UI coloring**. The actual lock cutoff for editing reads
the raw date, not isLocked. The redesign UI can use isPast/isLocked for status
colors (it already does, via dayStatus), but must not interpret them as
authoritative for "is the form editable."

The DayDetail entry form respects this today (it uses `isLocked` but not as
an editable gate). Stage 3 must preserve this discipline.

### F.7 sc-year-summary today block + periodRanges interplay

`sc-year-summary.today` returns `{ date, period, week }` for today (route.js
L403). `sc-year-summary.periodRanges` returns the per-period date windows.
These overlap; the redesign should pick ONE source of truth for "what period
is today in" and use it consistently.

**Recommendation:** use `today.period` from the response. It's already
authoritative (computed from `sc_daily_revenue.period` for today's date).
periodRanges is for the grid layout.

### F.8 `OperationalView`'s no-$ trick is the model

OperationalView.js imports only `GREEN` and `AMBER` from ServiceCalendar.js,
deliberately NOT importing `fmt$`. Adding a $ figure would require adding the
import - visible in code review. The redesign's account-polymorphic content
layer (spec §6) should use the same structural-isolation discipline for the
no-$ variant.

Not just a style nice-to-have: the STL-FL fee model has $0 per-meal prices, so
`fmt$(0)` would print "$0" forever for every service. The structural absence
of `fmt$` is the only thing preventing silent breakage.

### F.9 Mobile / floor-first reminder

The CLAUDE.md floor-first rule (`<1024px = Comfortable mode`) applies to the
redesign. The plan mentions mobile briefly. Spec §5 doesn't define the mobile
Period workspace. Per the existing PeriodLensView mobile pattern
(`ops-sc.css` L1671-1741), the Period view stacks day cards vertically and
the financial header sticks to top. The redesign Period workspace needs the
SAME pattern (or argue for a different one).

### F.10 A "ship green and validated" loop needs a localhost path

Today's SC requires a real Vercel preview deploy + Kevin's eyes (no
Playwright suite per CLAUDE.md). The 7-stage plan multiplies this
verification burden. **Recommendation:** the Stage 0 atom ships with a
dev-only `/service-calendar/atom-test` page that gallery-renders every state.
Subsequent stages get a similar dev-only preview where possible. The
verification load otherwise compounds.

---

## Closing

The redesign frame is sound: re-skin a stable engine, replace the lens/scope
two-axis mental model with vertical drill + one localized toggle. The data
contract supports it. The day-square atom is a high-leverage primitive. The
account-polymorphism axes are clearly drawn.

The plan's vulnerability is in **what it doesn't address**: admin surface,
bulk entry, phase derivation for non-recording PDCs, the operational strip's
data requirements, the lens/scope sequencing risk, and stage bundling. None
of these are dealbreakers. All of them are surface-able now, addressable in
the build prompts.

The seven-stage sequence in §D.5 reads as the safer path. The spec, with the
gaps noted, is buildable.

The audit ends here. The build, when it begins, begins with Stage 0 alone.
