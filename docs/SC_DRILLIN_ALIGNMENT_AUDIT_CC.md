# SC Drill-in Design Alignment Audit (CC)

**Read against `origin/main` HEAD `ecb2d42`** (Merge PR #312 - SC FL phase calendars). Read-only; no code changes, no build, no commit, no PR.

## Executive summary
The overview (year/season) is **~90 % clean reference implementation**: tokens govern color everywhere except two intentional hairlines and one dead-code exception, and the JS files pass the token gate. The drill-in is **materially behind**: `DayDetail.js` opens with `const GREEN/RED/AMBER = "#..."` and has ~14 raw hex constants driving inline styles, its ~800-line stylesheet lives in `ops-sc.css` (the SC-shared file - also the largest raw-hex offender), `PeriodWorkspace.js` uses raw hex in inline styles for the progress bar and delta, and both drill-in files ship legacy Stage-3 patterns the overview redesign has since replaced. `DaySquare.js` + `DaySquare.css` are already solidly on tokens; they can stay.

**Three things chat-Claude needs to know before proposing anything:**
1. **The overview *is* the standard** - `MonthCard.js`, `PeriodCard.js`, `SeasonStepper.js`, and their CSS ship on semantic tokens with only surgical exceptions (rgba hairline shadow, white-on-inset for the amber focus segment). The drill-in has to match this bar, not another one.
2. **`ops-sc.css` is a shared danger zone.** It holds the `.sc-day-*`, `.sc-btn-*`, and account-context chrome for the whole SC surface and carries 17 raw hex/rgba lines + 76 raw px + a `#eff6ff / #1e40af / #cffafe / #155e75` account-category palette that no other surface tokens against. Any DayDetail refactor touches it.
3. **Icon canon is real but partial.** Lucide `1.14.0` is installed (`package.json:26`) - `DESIGN_SYSTEM_REFERENCE.md:171` still says "not yet installed." `Icons.js` re-exports 6 hand-rolled inline SVGs (still SVG, still not Lucide). Every SC file that draws an icon uses its own inline `<svg>` block or a Unicode text glyph (`✎` `!` `○` `⚠` `✓`). The drill-in redesign is the natural place to establish the "SC icon" canon for the module - if we don't, we'll drift again.

---

# Section 1 - Design canon ground truth

## 1a. Doc state

| Doc | Last verified | What it currently asserts (summary) | Stale claims (vs code) |
|---|---|---|---|
| `docs/DESIGN_REVIEW_PERSONA.md` | 2026-05-05 | Severity framework (P0/P1/P2/P3 + High for token conformance); 4-layer review (UX/UI/EI/operational); 3-options rule; both viewports; identify + verify density mode; ~4h implementable; no new deps beyond Lucide. | Lucide status - persona relies on `DESIGN_SYSTEM_REFERENCE.md`'s Iconography section, which is wrong. Persona itself is OK. |
| `docs/DESIGN_SYSTEM_REFERENCE.md` | 2026-05-05 | Stack; module CSS prefixes (`sc-` for SC); density-mode assignments (SC = **Density**; SC day detail entry = **Comfortable**; mobile <1024 = Comfortable, non-negotiable); Iconography (Lucide standard, install `npm install lucide-react`); browser matrix; SC data volume (~180 service days per MLB account). | **`Iconography > Migration status` line 171:** "Lucide is not yet installed" - **FALSE**. `package.json:26` has `"lucide-react": "1.14.0"`. Migration is "opportunistic, not sweeping" - still true (SC surface has zero Lucide imports; verify with `grep -rn "from ['\"]lucide-react['\"]" src/app/service-calendar/`). **Also stale:** the tables for spacing/radius/elevation/motion/z-index were converted to pointers ("Canonical values live in `src/app/tokens.css`") so anyone reading here for those tables needs to jump to `DESIGN_TOKENS.md` + `tokens.css`. Not stale but a signposting choice worth knowing. |
| `docs/DESIGN_PRINCIPLES.md` | 2026-05-05 | Floor-first; Four Gates; EI lens; density-vs-comfortable = task-tuned not user-tuned; tokens are law ("a raw color or pixel value in a component is a defect"); AA baseline; states; forms; IA; microcopy; mobile-specific (thumb zone, no hover-only); AI features (confidence, manual override); protected patterns. | No stale claims found. The "tokens are law" line at `line 61-64` is the ground the audit runs on. |
| `docs/DESIGN_TOKENS.md` | (no date - treated as living, `tokens.css` wins per governance section) | Two-tier model (primitive + semantic); components consume semantic tokens only; OKLCH-generated + AA-verified colors; status family shared cross-app; tool accents (Tier 3, `--accent-ops` `--accent-people` `--accent-directory` `--accent-playbook`); density mode via `[data-density="compact"]`; MIGRATION NOTE (temporary) that `--space-1..6` and `--radius-card/-input` still redefined in `globals.css` legacy density blocks that win by specificity - retire during density refactor. | The MIGRATION NOTE `line 79-83` is a self-flagged known deviation, so not stale per se. But it means the *drill-in redesign will inherit the globals.css legacy density blocks* until they're retired - a real constraint. |

**Additional doc-drift observations** (not in the four docs above but affects the audit lens):
- `docs/SC_REDESIGN_SPEC.md` and `docs/SC_REDESIGN_AUDIT.md` exist alongside these; the redesign persona should point at them for SC-specific mode assignments, but the review persona doesn't reference them. Not blocking; noting for chat-Claude.

## 1b. Token system reality

**Location:** `src/app/tokens.css` (109 lines, single file). Loaded page-wide via `globals.css`.

**Structure:** two tiers under `:root`.
- **Tier 1 - Primitives** (`tokens.css:9-52`): raw color ramps (navy/amber/green/red/neutral 50-900), soft state fills (`--fill-needs`, `--fill-upcoming`, `--fill-off`), type primitives (fonts, sizes, weights, tracking, tabular-nums), spacing (`--space-1..8`), radii (`--rad-4/-6/-10/-14/-pill/-circle`), border widths, elevations (`--sh-sm/-md/-lg`), motion (durations + eases), z-index, opacity, icon sizes (`--icon-sm/-md/-lg = 16/20/24px`).
- **Tier 2 - Semantic** (`tokens.css:54-97`): what components consume.
  - **Text:** `--text-heading/strong/default/muted/subtle/inverse/link/success/danger`.
  - **Surface:** `--surface-page/card/sunken/overlay`.
  - **Border:** `--border-subtle/default/strong`.
  - **Action:** `--action-primary-bg/-hover/-text`, `--action-secondary-bg/-border/-text`.
  - **Accent (contrast-split):** `--accent` (amber-500, dark text), `--accent-solid` (amber-600, white text), `--accent-text` (amber-700, amber as text), `--accent-backplate` (amber-50 CTA wash).
  - **Tool accents (Tier 3):** `--accent-ops`, `--accent-people`, `--accent-directory`, `--accent-playbook`.
  - **SC-specific:** `--accent-sc = #0F6E56`, `--accent-sc-dark = #085041`, `--accent-sc-subtle = #E1F5EE`, `--accent-sc-tint = #F0FDF4` (`tokens.css:74`). This is what marks SC's green identity apart from the amber Ops Hub - the drill-in redesign must consume these, not raw hex like `#0F6E56`.
  - **Status family:** `--status-entered-bg/-bd/-fg/-subtle/-strong`, `--status-needs-*`, `--status-overdue-*`, `--status-upcoming-*`, `--status-off-*`, plus `--status-today-ring` and `--status-today-fg` (`tokens.css:76-81`). The status family is designed to be shared cross-app (day cells, badges, dots, rows, bars) and is the vocabulary DayDetail and DaySquare should use for state.
  - **Feedback:** `--feedback-success/-warning/-danger/-info` (`tokens.css:83`).
  - **Radius roles:** `--radius-cell` (4px, data cells), `--radius-control` (10px, buttons/inputs), `--radius-container` (10px, cards), `--radius-container-lg` (14px, large cards), `--radius-pill`, `--radius-circle`.
  - **Elevation roles:** `--elevation-card/-raised/-popover`.
  - **Focus:** `--focus-ring-width`, `--focus-ring-offset`, `--focus-ring-color` (2px navy).
  - **Motion:** `--motion-control` (fast + standard ease), `--motion-surface` (base + emphasized).
  - **Density-aware:** `--space-stack`, `--space-card-pad`, `--space-inline`, `--control-height`, `--control-pad-x`, `--row-height`, `--cell-size` - defaults are Comfortable at `tokens.css:95-96`, remap to Compact at `tokens.css:100-103` under `[data-density="compact"]`.

**Reduced-motion** (`tokens.css:106-108`) zeroes duration primitives at the token layer.

**Known temporary deviations** (self-flagged in `DESIGN_TOKENS.md:79-83`): `globals.css` still has legacy `[data-density]` blocks that redefine `--space-1..6` and `--radius-card/-input` at higher specificity than `tokens.css`. These win when applied, so a drill-in redesign that uses the semantic density tokens (`--cell-size`, `--row-height`, `--space-card-pad`) will remap correctly, but a redesign that uses `--space-*` primitives will inherit the legacy behavior. **Take-away for chat-Claude:** consume the density-aware semantics, not the primitives.

## 1c. Icon system reality

### Lucide install
- **Installed:** `package.json:26` -> `"lucide-react": "1.14.0"` (exact-pinned).
- **Used anywhere in `src/app/service-calendar/`:** `grep -rn "from ['\"]lucide-react['\"]"` returns nothing across the SC surface. **Zero Lucide imports in SC.**
- Doc drift: `DESIGN_SYSTEM_REFERENCE.md:171` says "not yet installed" - false. The "opportunistic migration" line is still directionally correct (SC hasn't been touched for icons yet).

### `src/app/ops/components/shared/Icons.js`
6 named exports, all inline SVGs written by hand (24x24 viewBox, `stroke="currentColor"`, `strokeWidth="2"`, `fill="none"`). Not Lucide re-exports.

| Export | file:line | Size | Purpose |
|---|---|---|---|
| `ClipboardIcon` | `Icons.js:3-8` | 24 | Ops clipboard glyph |
| `UsersIcon` | `Icons.js:10-15` | 24 | Users pair |
| `InvoiceIcon` | `Icons.js:17-22` | 20 | Invoice document |
| `DollarIcon` | `Icons.js:24-28` | 20 | Dollar sign |
| `ChecklistIcon` | `Icons.js:30-34` | 20 | Task list |
| `ArrowRight` | `Icons.js:36-40` | 16 | Right arrow (2.5 stroke) |

None of these are imported into the SC surface (grep confirms). `Icons.js` is Ops-adjacent, not the SC canon.

### Inline glyph components + inline SVG usage across the SC surface

Every SC icon is either an inline `<svg>` block or a Unicode text glyph. **No component-level abstraction** other than DaySquare's `STATUS_META` map for status-badge glyphs.

**Inline `<svg>` sites in SC JSX** (from `grep -rn "<svg" src/app/service-calendar/`, excluding CSS):

| File:line | Size | Purpose | Notes |
|---|---|---|---|
| `page.js:71` | 48x48 | Empty state illustration | Stroke 1.5, non-`currentColor` likely, out of chrome scope |
| `ServiceCalendar.js:55` | 12x12 | Account-dropdown chevron | Stroke 2.5 |
| `ServiceCalendar.js:66` | 14x14 | Account-dropdown selected check | Stroke 3 |
| `ServiceCalendar.js:819` | 14x14 | (admin lock icon) | Stroke 2 |
| `ServiceCalendar.js:867` | 14x14 | (admin controls) | Stroke 2 |
| `ServiceCalendar.js:872` | 14x14 | (admin controls) | Stroke 2 |
| `ServiceCalendar.js:1062` | 16x16 | Day-detail overlay close X | Stroke 2 |
| `admin/AccountEditor.js:244` | 14x14 | (admin) | Stroke 2 |
| `admin/FeeAccountEditor.js:104` | 14x14 | (admin) | Stroke 2 |
| `season/StateLegend.js:86-90` | 14x14 | Info-circle (i in circle) | Stroke 2 |
| `season/LegendInfoPopup.js:96-99` | 16x16 | Popup close X | Stroke 2 |
| `season/PeriodWorkspace.js:298-311` | 14x14 | Breadcrumb back-arrow chevron | Stroke 2.4, `aria-hidden` |
| `season/ChromeBar.js:213-216` | 13x13 | On-track check | Stroke 2.4 |
| `season/ChromeBar.js:247-252` | 12x12 | As-of refresh | Stroke 2 |
| `season/MonthCard.js:231-233` | 13x13 | Card-done check (CollapsedSummary) | Stroke 3, `aria-hidden` |
| `season/MonthCard.js:252-254` | 13x13 | Card-done check (footer) | Stroke 3, `aria-hidden` |
| `season/MonthCard.js:266-289` | 14x14 | `ChevronGlyph` (open/close accordion) | Stroke 2.4, inline style-rotates 180deg |
| `DayDetail.js:371` | 16x16 | Header close X | Stroke 2 |

**Text-glyph icons** (Unicode symbols used as icons in JSX):
- `DaySquare.js:76-84` - `STATUS_META`: `"✎"` (needs-entry, `line 78`), `"!"` (overdue, `line 79`), `"○"` (upcoming, `line 80`), `"⚠"` (failed, `line 84`). Entered / off / off-season / loading carry no glyph.
- `StateLegend.js:36,41,54` - `"✎"`, `"!"`, `"○"` mirror DaySquare per state.
- `LegendInfoPopup.js:122,137,154` - same set inside the popup rows (three account branches).
- `DayDetail.js:276` - `"✓"` delta-match indicator (inline in `renderServiceRow`).
- `DayDetail.js:347` - `"✓"` success-state check (h3-adjacent visual).
- `DayDetail.js:417-425,441` - `"+"` / `"−"` for expand/collapse extras + inactive-groups.
- `DayDetail.js:367-369` - HTML entities `&#8249;` / `&#8250;` (< / >) for day prev/next arrows.
- `PeriodWorkspace.js:334,348` - same `&#8249;` / `&#8250;` for period prev/next arrows.

**Emoji audit:** searched `src/app/service-calendar/` for emoji characters in JSX. **None found** in the SC surface (DaySquare's Unicode symbols above are dingbats, not emoji per doc language).

### The SC icon canon as shipped
- **Info + close + refresh + expand + progress-arrow:** inline `<svg>` blocks, 12-16px, `stroke="currentColor"`, `strokeWidth="2` or `2.4"`, `strokeLinecap="round"`, `strokeLinejoin="round"`, always `aria-hidden="true"`.
- **State badges** (in a data cell): Unicode text symbol pulled from a lookup map (`DaySquare.js:76-84`), never SVG. The atom's constraint is *the map is the icon system*.
- **Confirm / navigate:** inline SVG for checks, chevrons; text HTML entities for `<` `>` day-nav.
- No Lucide anywhere in the module.

The redesign has to decide: **(a) codify the "inline `<svg>` blocks + Unicode text symbols" pattern by moving them into `sc/Icons.js` or similar**, **(b) migrate to Lucide** for the non-status icons (info, close, refresh, chevron, check), or **(c) do nothing and inherit the drift.** The rest of Ops Hub is at (c) too, so any decision made for SC will set a precedent.

---

# Section 2 - Overview drift audit

## Component inventory (overview)
- `SeasonShell.js` - the top-level shell (`SeasonShell.js:37-269`), plus the `useIsDesktop` hook (`SeasonShell.js:210-225`) and the inline `PeriodGrid` (`SeasonShell.js:231-269`).
- `MonthCard.js` - a single month card in calendar view.
- `PeriodCard.js` - a single period card in period view.
- `PhaseStrip.js` - the PDC / MiLB phase strip (rail + today line + optional mobile chip).
- `SeasonStepper.js` - the MLB fee-account homestand bar (replaces the phase strip for those accounts).
- `FullSeasonCard.js` - the last-tile summary card in the period view.
- `StateLegend.js` - the always-visible state key + info-popup trigger.
- `LegendInfoPopup.js` - the verbose account-aware legend popup.
- `ChromeBar.js` - the unified SC chrome (account + toggle + stats + as-of).
- `StickyContext.js` - the sticky-context chrome (not the workspace's).
- `season.css` (951 lines), `seasonStepper.css` (194 lines), `stateLegend.css` (226 lines), `chromeBar.css` (230 lines), `legendInfoPopup.css` (141 lines), `stickyContext.css`.

Plus the two shared-with-drill-in files that also render in overview: `DaySquare.js` + `DaySquare.css` (used by every card grid).

## Token conformance - overview CSS

Raw hex + rgba counts (`grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\([0-9]'`):

| File | Raw hex/rgba lines | Notes |
|---|---|---|
| `season.css` | **2 lines** | Both are `rgba(0,0,0,0.06)` header hairline shadows at `season.css:334` (`.sc-season-month-card-header`) and `season.css:650` (`.sc-season-period-card-header`). Intentional matched literal per inline comment at `season.css:330-333`: "Matched parity with .sc-season-period-card-header. rgba(0,0,0,0.06) is intentional - same literal value as the period card so the two surfaces share one hairline." Documented exception; both tokens for the same visual. |
| `seasonStepper.css` | **2 lines** | `line 178`: `box-shadow: 0 0 0 2px var(--status-needs-subtle), inset 0 0 0 1px rgba(255,255,255,0.4);` - inset white for the amber focus segment (documented purpose: white glaze on top of amber accent). `line 183`: `color: #fff;` - the segment label on the amber fill (the one intentional white-on-fill from the render-2 spec). |
| `stateLegend.css` | 0 | Fully tokenized on color. |
| `chromeBar.css` | 0 | Fully tokenized on color. |
| `legendInfoPopup.css` | 1 | `line 9`: `background: rgba(15, 23, 42, 0.45);` - popup backdrop scrim. Should use `--opacity-scrim` (or `--surface-overlay` + opacity). Not tokenized; **flag as P2 token-conformance**. |

**Raw px counts** (`grep -cE "\\b[0-9]+px\\b"`, all values including inside comments and `<xxx>px` fragments):

| File | Raw px | Notes |
|---|---|---|
| `season.css` | 93 | Bulk of them are hairline / fine-tune values (`1px`, `2px`, `-1px`, `3px`, `6px`, `14px`, `18px`, `20px`) - most are either token-aligned incidental values or the intentional `gap: 2px` on the titlecol / `border-bottom-left-radius` on the legend band. Not systematically raw px in body/padding contexts. |
| `seasonStepper.css` | 5 | Minor fine-tunes (`padding: 3px`, gap microsizing on caption). |
| `stateLegend.css` | 26 | Legacy fine-tunes (small-swatch widths, `gap: 3px`, etc.) - fine-grain typography spacing raw px. |
| `chromeBar.css` | 19 | Similar pattern: small spacing values raw. |
| `legendInfoPopup.css` | 11 | Popup-specific fine-tunes. |

**Verdict for overview CSS token conformance:** color is essentially fully tokenized (2 documented rgba exceptions + 1 flag in the legend popup backdrop + the intentional white-on-amber). Raw px are almost entirely small typographic spacing (1-4px) or documented microsizing; no card padding, border-radius, or larger-container value bypasses tokens.

## Token conformance - overview JS
- Reading `SeasonShell.js`, `MonthCard.js`, `PeriodCard.js`, `PhaseStrip.js`, `SeasonStepper.js`, `StateLegend.js`, `LegendInfoPopup.js`, `ChromeBar.js`:
  - `PhaseStrip.js:60` - the `--bare` fallback gradient uses `var(--surface-page)` and `var(--accent-sc-tint)` tokens inline. **Pass.**
  - `PhaseStrip.js:196-201` and `PhaseStrip.js:215-222` - `buildRailGradient` consumes `CANONICAL_PHASES.off.tint` and `b.tint` inline. These are raw hex from `phaseCalendar.js:32-40`. Documented at `PhaseStrip.js:187-198` as intentional phase-identity palette: "This is a phase-identity palette, not a token regression." **Documented exception.**
  - `PeriodCard.js:71-73` - `headerStyle` consumes `primaryPhase.tint` and `primaryPhase.textTint` inline for the phase-tinted header background. Same intentional phase-identity exception.
  - No other raw hex in overview JS.

## Icon consistency - overview
- Mixed. Info icon in StateLegend, close X in LegendInfoPopup, refresh in ChromeBar, check in ChromeBar + MonthCard, ChevronGlyph in MonthCard - each is its own inline SVG block with slightly different strokes (`2` vs `2.4` vs `3`) and no shared helper. This is not a P0 but it *is* the drift chat-Claude should call out - and the moment to codify. See Section 1c.

## System adherence + density mode - overview
- Assigned mode per `DESIGN_SYSTEM_REFERENCE.md:119`: **Service Calendar (month admin view) = Density.** Overview renders density-appropriate sizes (10-14px caption/body dominant, tight card padding, 4/8/12/16 space rhythm, `--radius-container` = 10px, small-multiples grid) - matches Density.
- `SeasonShell.js:210-225` `useIsDesktop` matches at 768px - so tablets get desktop density; mobile <768px collapses card interactions but the density tokens still resolve because no `data-density` attribute is applied at the SC root. **Potential mode-mismatch:** the SC root never sets `data-density="compact"`, so it inherits Comfortable defaults from `tokens.css:95-96`. If SC-year renders comfortably-tokenized despite being documented as Density, that's a P1 mode-mismatch across the whole module. Worth verifying with a live render inspection; the audit can't fully confirm without a browser check.
- The overlay for day detail *does* set `data-density="comfortable"` explicitly (`ServiceCalendar.js:1037`), which matches the surface-level override table (`DESIGN_SYSTEM_REFERENCE.md:142`: "Service Calendar day detail entry → Comfortable"). **Pass** for the overlay.

## Overview verdict
**~90% clean reference implementation.** Two documented rgba exceptions, one popup backdrop that should tokenize (`legendInfoPopup.css:9`), one JS-inline-style exception documented as intentional (phase-identity palette). Icon story is mixed but non-blocking. **Must-fix before we hold it up as the standard:**
- **P2** `legendInfoPopup.css:9` - tokenize the backdrop scrim.
- **P1 or P2 (verify)** - decide whether SC root should carry `data-density="compact"` and what breaks if it does.
- **P2** - decide on the SC icon canon (Section 1c) so the drill-in redesign has a rule to follow.

Nothing here should block the drill-in redesign. The overview is a legitimate standard to work against.

---

# Section 3 - Zoomed-in comprehensive audit

## 3a. Routing + data flow

The drill-in is URL-routed through `next/router` search-params. Confirmed from `ServiceCalendar.js:925-1050`:

- **Year view (`isYearView`):** `<SeasonShell/>` renders (`ServiceCalendar.js:934`) with `onMonthClick` (`ServiceCalendar.js:950-959`) and `onPeriodClick` (`ServiceCalendar.js:961-963`).
  - **Month click:** computes the month midpoint (`${year}-${MM}-15`), finds the `periodRange` containing that midpoint, and `router.push(?period=${next.period})` (`ServiceCalendar.js:950-959`). **There is no month view any more** - clicking a month drills you into the containing *period*. Documented at `ServiceCalendar.js:944-949`: "a month is just a slice of a period - clicking it drills DOWN into the operational scope, not sideways into a deprecated month view."
  - **Period click:** direct `router.push(?period=${periodLabel})` (`ServiceCalendar.js:961-963`).
- **Period view (`isPeriodView`):** `<PeriodWorkspace/>` renders (`ServiceCalendar.js:973`). Wired with:
  - Nav handlers: `onClimbToSeason` (`router.push("/service-calendar")` + reset focusDay/bulk), `onPrevPeriod`/`onNextPeriod` (clamped to `periodRanges` boundaries), `onTodayJump` (finds the period containing today).
  - Day click: `onDayClick={(date) => setFocusDay(date)}` (`ServiceCalendar.js:1004`).
  - Bulk mode: `bulkMode` + `bulkSelected` `Set`, plus 4 handlers (`toggleBulkSelect`, `handleBulkConfirm`, open-panel, cancel).
- **Day detail (`focusDay && focusDayData`):** renders as an **overlay** (`ServiceCalendar.js:1035-1048`) inside `<div className="sc-overlay-backdrop">` -> `<div className="sc-overlay-card" data-density="comfortable">`. DayDetail receives `scopeLabel="period"` + `monthRevenue={periodMetrics?.actRev || projRev}` so its "% of {scope}" readout reads correctly (documented at `DayDetail.js:33-38`).

**Data path per level:**
- Year: `yearData` (months[] shape from sc-year-summary), `yearBannerStats`, `periodRanges` - loaded upstream in `ServiceCalendar.js`.
- Period: `periodDays` + `periodMetrics` + `periodHomestandMap` (memos), loaded on period-view entry.
- Day: `focusDayData` derived from `data.serviceGroups || periodServiceGroups` + the day's projected/actual values.

**No month view in the shipped code.** The `onMonthClick` handler jumps to period; nothing renders a month-scope workspace. Any references to a "month workspace" or "month drill" in older docs are stale.

## 3b. Per-file audit

### `PeriodWorkspace.js` (850 lines)

**Structure:**
- Top-level: `NavRow` (breadcrumb Season / phase / P{n} + prev/next/today) → `StateLegend` (workspace-level, with `showDayNight=true`) → `WorkspaceHeader` (Period N + anchor + phase) → `FinancialFrame` (three forks by billing model) → `TodayHero` (conditional, current period only) → `BulkAffordance` (mode toggle) → `DayGrid` (week-aligned 7-wide grid, atom at `lg`) → `WeekSubtotals` (quiet footnote).
- Sub-components (all in this file, `PeriodWorkspace.js:287-799`): `NavRow`, `FinancialFrame`, `ProgressLine`, `TodayHero`, `BulkAffordance`, `DayGrid`, `WeekSubtotals`, `WorkspacePartialBanner`, `WorkspaceSkeleton`.

**Token conformance:**
- **Raw hex in inline JS styles - P0 High:**
  - `PeriodWorkspace.js:367`: `const progressColor = (m.needsEntry + m.overdue) > 0 ? "#EF9F27" : "#0F6E56";` - raw amber + SC green. Should be `var(--status-needs-strong)` (amber-500) and `var(--accent-sc)` respectively.
  - `PeriodWorkspace.js:450`: `const deltaColor = delta >= 0 ? "#047857" : "#B45309";` - raw green-800 + amber-700. Should be `var(--text-success)` and `var(--accent-text)`.
  - `PeriodWorkspace.js:486`: `<div className="sc-workspace-progress-bar-fill" style={{ width: pct + "%", background: color }} />` - `color` here is one of the two raw hex values above. Same violation.
  - `PeriodWorkspace.js:459`: `<div ... style={{ color: deltaColor }}>{deltaLabel}</div>` - inline-styled color from raw hex.
- `PeriodWorkspace.js:298-311` - inline SVG for the breadcrumb back chevron; 14x14, stroke `2.4`, `aria-hidden`. Matches ChromeBar/MonthCard stroke conventions but is its own separate block (Section 1c).
- No CSS-level raw hex in `periodWorkspace.css` (grep returned 0).

**CSS reality (`periodWorkspace.css` 802 lines):**
- **Zero raw hex.** All color values consume tokens (`var(--surface-sunken)`, `var(--surface-card)`, `var(--text-heading)`, `var(--accent-sc)`, `var(--focus-ring-*)`, etc.). This is genuinely good.
- 71 raw px hits, all in the small-typographic-spacing range from the file preview (`gap: 6px`, `padding: 3px`, `width: 32px`, `height: 32px`, `padding: 6px 14px`, `letter-spacing: 0.04em` etc.). No large uncontrolled px in card padding or radii.
- Density mode: workspace renders at `--space-3 --space-4 --space-7` container padding and Comfortable-ish sizes on the tokens (`--size-body` for climb, `--size-caption` for Today pill, `--size-subhead` for arrow). The overlay wrapper is `data-density="comfortable"` per `ServiceCalendar.js:1037` - that's the surface-level override per `DESIGN_SYSTEM_REFERENCE.md:142`. So the workspace itself sits at whatever density resolves at the outer level (probably Comfortable, since the SC root never sets `data-density`), and the overlay adds a second Comfortable declaration. Net effect: **the workspace renders Comfortable in practice.** That matches the documented day-detail override, but the workspace itself isn't documented as Comfortable-overridden - just the day-detail overlay is. Worth flagging: **is the workspace *supposed to be* Density or Comfortable?** The doc's surface-level override table (`DESIGN_SYSTEM_REFERENCE.md:142`) lists only "Service Calendar day detail entry" as Comfortable - the workspace is inside the module default (Density). If it's rendering Comfortable, that's a P1 mode-mismatch.

**Icon usage:** one inline SVG (back chevron `line 298-311`); the rest are text-glyph entities (`&#8249;` / `&#8250;`). Consistent-enough with the overview but see Section 1c.

**Structural / pattern debt:**
- `PeriodWorkspace.js:154-190` - three branches (loading skeleton / partial-error / no-periodRange) each independently render a `NavRow`. Some drift risk if any single Nav prop changes.
- `WorkspaceHeader` at `PeriodWorkspace.js:213-227` renders `Period {n} · {anchor} · {phase}` in a header block - **not the same shape** as `PeriodCard`'s header (which renders `P{n} · {anchor}` on line 1 + a subtitle line for the homestand/phase/off-season word). Two different header conventions for the same "period" concept.
- `FinancialFrame` uses class modifiers `sc-workspace-frame--upcoming` / `--fee` / `--operational` but the per-meal (default) has no modifier - implicit branch. Fine, not a defect.
- `NavRow` breadcrumb uses `phaseLabel` prop passed only in the `partialError` branch (`PeriodWorkspace.js:167`) and the `!periodRange` branch (`PeriodWorkspace.js:185`) - **not in the main render** (`PeriodWorkspace.js:204`). So the breadcrumb's phase chip renders only in error/empty states, not in the happy path. Design regression? Or intentional? Read as **P2 inconsistency**.

### `DayDetail.js` (487 lines)

**Structure:**
- Modal-ish component that renders inside the `.sc-overlay-card` overlay (`ServiceCalendar.js:1037`).
- Three top-level render branches: `.sc-day--review` (review overlay before save, `DayDetail.js:293-340`), `.sc-day--success` (post-save success card, `DayDetail.js:344-357`), and the main entry form (`DayDetail.js:359-486`).
- Main body: header (title + date + nav prev/next + close), coaching banner (bg/border/color inline-styled), body (active service groups + inactive service groups + notes textarea), footer (totals + actions).

**Token conformance - this is the big one:**
- **Module-level raw-hex constants at the top of the file** (`DayDetail.js:4-6`):
  ```js
  const GREEN = "#0F6E56";
  const RED = "#dc2626";
  const AMBER = "#EF9F27";
  ```
  These constants aren't even used by name in the file I read - they're stale dead-code declarations that violate the token gate at first glance. Grep confirms: `grep -n "GREEN\|RED\|AMBER" DayDetail.js` -> only the const declarations at lines 4-6. **Dead code + token violation.** Delete them.
- **Coaching banner - 14 raw hex values via inline style** (`DayDetail.js:229-244`):
  ```js
  { bg: "#f9fafb", border: "#e5e7eb", color: "#6b7280", ... }        // prep-day / upcoming
  { bg: "#E1F5EE", border: "#9FE1CB", color: "#085041", ... }        // entered (matches --accent-sc-subtle / --accent-sc-dark)
  { bg: "#fffbeb", border: "#fde68a", color: "#92400e", ... }        // needs-entry (amber ramp)
  { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", ... }        // overdue (red ramp)
  ```
  All 12 color values here should be `var(--status-*-bg/-bd/-fg)`. The status family in `tokens.css` already has entered/needs/overdue/upcoming/off with `-bg / -bd / -fg / -subtle / -strong` variants. This is a straight token substitution. **P0 High token-conformance.**
- Applied inline (`DayDetail.js:377`): `<div className="sc-day-coaching" style={{ background: coaching.bg, borderColor: coaching.border, color: coaching.color }}>`. Consumes the hex constants literally.
- **No CSS import** in `DayDetail.js` (verified with `grep`). The `.sc-day-*` and `.sc-btn-*` classes it renders are defined in `ops-sc.css` (89 `.sc-day` rules + 8 `.sc-btn` rules per grep). That means:
  - DayDetail's style is in the **module-shared** `ops-sc.css`, not a scoped `dayDetail.css` alongside the JSX.
  - `ops-sc.css` is the biggest raw-hex offender in the SC surface: **17 raw hex/rgba lines** including `.sc-cat--pdc { background: #eff6ff; color: #1e40af; }` (`ops-sc.css:134`), `.sc-cat--milb { background: #cffafe; color: #155e75; }` (`ops-sc.css:136`), plus a flagged comment `line 347`: "FLAGGED: #d1fae5 is a green-100 wash" and multiple `rgba(15, 110, 86, ...)` box-shadows at `line 311`, `509`, `514`. That file is a shared danger zone that touches the account category chips + day-detail chrome + several account-scoped hero styles simultaneously.
- **76 raw px in `ops-sc.css`** - not all bad, but this is the biggest single accumulation in the SC surface.

**Icon usage:**
- Close X: `DayDetail.js:371` - inline SVG 16x16 stroke 2.
- Day-nav arrows: `DayDetail.js:367-369` - HTML entities `&#8249;` / `&#8250;`.
- Group expand/collapse: `DayDetail.js:417-425` - `"+"` / `"−"` text glyphs.
- Delta match indicator: `DayDetail.js:276` - `"✓"` text glyph.
- Success check: `DayDetail.js:347` - `"✓"` text glyph.

**System adherence + density mode:**
- Overlay wrapper (`ServiceCalendar.js:1037`) sets `data-density="comfortable"` explicitly. **Correct per `DESIGN_SYSTEM_REFERENCE.md:142`.** So DayDetail renders Comfortable. Verified match.
- Type / spacing / radii in the inline styles is the token violation surface, not the size scale.

**Structural / pattern debt:**
- **Legacy Stage-3 patterns.** The file predates the current overview redesign - it uses:
  - Non-token color language (the hex constants at the top).
  - Inline styles for the coaching banner (should be `.sc-day-coaching--{state}` modifiers with token-backed CSS).
  - `sc-day-collapsed-icon` = "+" / "−" text (instead of chevron SVG - inconsistent with MonthCard's `ChevronGlyph`).
  - `sc-day-review` inner-shell rendered as a sibling render branch instead of a route/modal (`DayDetail.js:292-340`). Fine, but not the pattern used elsewhere.
  - No `data-density` self-declaration, no `sc-fade-in` animation entry.
- **Dead code:** the top-of-file `GREEN / RED / AMBER` constants aren't referenced (see above).
- **Massive coaching logic:** `DayDetail.js:226-245` fee-vs-per-meal fork + 5 status cases + inline hex tuple. This is what the token migration would collapse into a `.sc-day-coaching--needs-entry` etc. rule set.
- **Modal structure duplication:** `DayDetail.js:293-340` (review) and `DayDetail.js:344-357` (success) each rebuild the `.sc-day` wrapper independently. Not a defect; noting.

### `DaySquare.js` (340 lines) + `DaySquare.css` (290 lines)

**Structure:**
- The universal day atom, presentational. `STATUS_META` map (`DaySquare.js:76-84`) drives class + icon; sizes `sm` / `lg`; overlays `today` / `selected` / `focused` compose via layered box-shadow (documented at `DaySquare.css:1-15`).
- Polymorphic middle line per `kind` (per-meal / mlb-fee / milb / fee-no-dollar), rendered by dedicated `renderPerMeal` / `renderMlbFee` / `renderMilb` / `renderFeeNoDollar` functions at `DaySquare.js:215-279`.

**Token conformance:**
- `DaySquare.css`: **0 raw hex lines** (the one grep hit is inside a comment at `line 129`: "The pre-batch palette had entered #A8E5C9 vs upcoming #E0F1E7 at" - historical annotation, not a rule). Everything consumes `var(--surface-card)`, `var(--status-*-bg/-bd/-fg)`, `var(--focus-ring-*)`, `var(--motion-*)`.
- `DaySquare.js`: no inline styles at all. All state comes via className. **Pass.**
- 26 raw px in `DaySquare.css` - all fine-grain typographic values (`min-height: 44px` for sm tap target, `min-height: 96px` for lg, `width/height: 12/16px` badges, `padding: var(--space-1) 6px`). No large uncontrolled px.

**Icon usage:** Unicode text glyphs from `STATUS_META` - the module's canon. No SVG. **Pass.**

**System adherence + density mode:**
- `.sc-daysq--sm` at `DaySquare.css:49-53`: `min-height: 44px; padding: var(--space-1) 6px; font-size: var(--size-caption)` - meets tap target minimum (matches `DESIGN_PRINCIPLES.md` bullet `line 85`: "Tap targets ≥ 44×44pt iOS / 48×48dp Android"). **Pass.**
- `.sc-daysq--lg` at `DaySquare.css:54-58`: `min-height: 96px; padding: var(--space-2) var(--space-2); font-size: var(--size-body)`. Fine.
- Type mapping (`DaySquare.css:72-73`): `sm .sc-daysq-date = --size-body`, `lg .sc-daysq-date = --size-h3 --wt-display`. Tokens; **pass.**

**Structural / pattern debt:** none material. This is the cleanest file in the entire SC surface. It should be treated as the *floor* for the drill-in redesign.

## 3c. Rubric-lens observations (persona format)

Running the persona over PeriodWorkspace + DayDetail + DaySquare together (they compose the drill-in experience). Labeled as **observations/input** - chat-Claude grades.

### Drill-in composite

**Verdict:** refine → rework, depending on token conformance rigor. If we're strict about the "tokens are law" clause in `DESIGN_PRINCIPLES.md:61-64`, the DayDetail hex + PeriodWorkspace inline-style hex + `ops-sc.css` shared-file drift all read as **rework** (P0 High token-conformance, plural). If we're pragmatic and lump the JS-inline hex into a single week-of-work refactor, it's **refine (P1-P2)**.

**Density mode:**
- **PeriodWorkspace:** SC module documented as Density (`DESIGN_SYSTEM_REFERENCE.md:119`), but the SC root never sets `data-density="compact"`, so tokens resolve to Comfortable defaults (`tokens.css:95-96`). **P1 mode-mismatch candidate** (needs render inspection to confirm; may be resolved by the surface-level override rules).
- **DayDetail:** overlay-scoped `data-density="comfortable"` (`ServiceCalendar.js:1037`). **Documented override match** per `DESIGN_SYSTEM_REFERENCE.md:142`.
- **DaySquare:** density-agnostic in itself (uses `sm`/`lg` size modifiers, not density tokens). Wherever it renders, it picks up the resolved size tokens. **Pass.**

**What's working (protected):**
1. **DaySquare is a genuine atom.** ONE renderer, four kinds, three overlay composers, all tokenized. This is the model the drill-in should aspire to for other subcomponents.
2. **URL as source of truth for routing.** `router.push(?period=...)` for period-drill; `setFocusDay(date)` for day-drill inside the same period view. Back button works. Consistent with the overview's URL discipline.
3. **StateLegend renders at every level** (overview + workspace, with `showDayNight` at the workspace only) - rubric non-negotiable #1 preserved in the drill-in.
4. **DayDetail's actuals-first-class group split** (`DayDetail.js:110-122`, comment describes the bug that motivated it) - a hard-won correctness rule; don't touch.
5. **Bulk mode as a mode toggle** (`DayDetail`-adjacent, `PeriodWorkspace.js:573-625` + `ServiceCalendar` handlers) - prevents the tap-to-open vs tap-to-select conflict cleanly. Protect.

**P0 candidates:**
1. **DayDetail coaching banner - raw hex, inline styled** (`DayDetail.js:229-244`, applied `line 377`). Twelve raw color values driving one of the most operator-visible UI regions.
2. **PeriodWorkspace inline-styled progress bar + delta color** (`PeriodWorkspace.js:367, 450, 459, 486`). Four raw hex values applied via `style={{ background: ..., color: ... }}`.
3. **DayDetail top-of-file dead-code constants** (`DayDetail.js:4-6`). Not causing bugs but violates the token gate and confuses future readers.
4. **`ops-sc.css` shared file** carrying 17 raw hex/rgba lines including `.sc-cat--pdc/-mlb/-milb` account category chip colors (`ops-sc.css:134-136`). Not drill-in-only but the drill-in refactor will touch it.

**P1 candidates:**
1. **PeriodWorkspace `NavRow` breadcrumb phase chip renders only in error/empty branches** (`PeriodWorkspace.js:167, 185` but not `line 204`). Either wire it everywhere or drop it - the current state is inconsistent.
2. **PeriodWorkspace header shape ≠ PeriodCard header shape.** Same "period" concept, two ways of arranging title/anchor/phase. Pick one convention.
3. **DayDetail no CSS import - style debt lives in `ops-sc.css`.** Migrate DayDetail's `.sc-day-*` block into a scoped `dayDetail.css` (or `periodWorkspace.css` companion) as part of the redesign so the shared file shrinks.
4. **Verify SC density mode** at the DOM level. If the SC year page is not actually rendering the documented Density mode, that's a mode-mismatch across the entire module surface.
5. **Icon canon undefined.** Each SC file draws its own inline SVG. Not blocking but the moment to consolidate.

**P2 backlog:**
1. `legendInfoPopup.css:9` popup backdrop scrim - `rgba(15, 23, 42, 0.45)` → `--opacity-scrim` or `--surface-overlay` + opacity.
2. DayDetail expand/collapse indicators use `"+"` / `"−"` text glyphs (`DayDetail.js:417-425`) while MonthCard uses `ChevronGlyph` (`MonthCard.js:266-289`). Cross-module inconsistency.
3. PeriodWorkspace uses HTML entities `&#8249;` / `&#8250;` for prev/next arrows (`PeriodWorkspace.js:334, 348`); DayDetail also uses the same entities (`DayDetail.js:367-369`); PeriodCard doesn't have these arrows. Consistent but might be a Lucide-migration candidate.
4. DayDetail's dead `GREEN/RED/AMBER` constants - already tagged P0 above, but if we're staging a refactor these move down.

**Both viewports:**
- Desktop (director): the workspace displays comfortably at desktop widths. The FinancialFrame + Today Hero + DayGrid stack reads well.
- Mobile (chef): `PeriodWorkspace.js` has one explicit mobile rule (`periodWorkspace.css:29-34` tightens the NavRow); the rest inherits. The DayDetail modal is inside `.sc-overlay-card data-density="comfortable"` which gives it the right density. DayDetail service-row inputs (numeric, `inputmode="numeric"`, `pattern="[0-9]*"`) match `DESIGN_PRINCIPLES.md` mobile guidance (`line 108`). Coaching banner + `.sc-btn-*` buttons should meet 44px tap target - need to verify at DOM level. **Flag as verify-before-ship rather than P0.**

**Token conformance summary (High findings):**
- Raw hex in JSX inline styles: `DayDetail.js` (14 values + 3 dead constants), `PeriodWorkspace.js` (4 values). **The single biggest bucket of debt in the drill-in.**
- Raw hex in module-shared CSS: `ops-sc.css` 17 lines + comments flagging others as known-bad.
- Status not encoded by color alone: passed - DayDetail's coaching pairs bg+border+color+text, DaySquare pairs fill+glyph+label. Good.
- Focus-visible rings: DaySquare uses layered box-shadow overlays and the interactive variant has focus rings; workspace nav-arrow-btn and nav-climb have `:focus-visible` rules in `periodWorkspace.css:57-60, 90-92`. DayDetail's inputs/buttons need to be confirmed. **Assume pass, verify.**

**Open questions:**
- Is the SC page supposed to render Density or Comfortable at the root?
- Does the drill-in redesign consolidate the coaching banner into `.sc-day-coaching--{status}` modifiers, or is there operator research suggesting the compound message (bg + border + color) needs to stay flexibly configurable?
- Is `Icons.js` becoming the SC icon canon or is Lucide?

---

# Section 4 - Synthesis

## Biggest gaps between zoomed-in and shipped overview standard

1. **Inline-hex on operator-critical surfaces.** DayDetail's coaching banner and PeriodWorkspace's progress-bar color are inline hex, right in the JSX. The overview never does this. This is the single biggest visual+philosophical gap: the overview earns its "clean" verdict specifically because color moved out of the components; the drill-in still carries color in the components.
2. **DayDetail's stylesheet lives in the shared `ops-sc.css`.** The overview redesign moved every card / band / legend / chrome into scoped CSS files (`season.css`, `seasonStepper.css`, `stateLegend.css`, `chromeBar.css`, `legendInfoPopup.css`). DayDetail didn't get that scoping - it inherits ~800 lines of `ops-sc.css` shared with the account chrome and the admin panel. This makes tokenization high-risk: every fix ripples cross-surface.
3. **Two "period header" conventions.** PeriodWorkspace's header block (`P{n} · anchor · phase`) doesn't match PeriodCard's (`P{n} · anchor` + subtitle). Same concept, two shapes.
4. **PeriodWorkspace nav shape drift.** Breadcrumb phase chip renders in error branches but not the happy path.
5. **Icon canon undefined for the drill-in.** DayDetail uses `+/−`, PeriodWorkspace uses `&#8249;/&#8250;`, MonthCard uses ChevronGlyph SVG. Every surface picks its own glyph. The overview at least has some internal consistency (all check marks are 13-14px stroke-3 inline SVGs); the drill-in doesn't.

## Highest-leverage fixes (most consistency per hour)

1. **Delete `DayDetail.js:4-6` GREEN/RED/AMBER dead constants.** Zero risk; signals intent. (~5 min)
2. **Replace `PeriodWorkspace.js:367, 450` raw hex with tokens** (`--status-needs-strong` / `--accent-sc` / `--text-success` / `--accent-text`). The bar and delta color both consume these. Trivial token substitution once mapping is agreed. (~30 min)
3. **Migrate DayDetail's coaching banner from inline-styled hex to `.sc-day-coaching--{state}` modifier rules** in a new scoped `dayDetail.css` (or inside `periodWorkspace.css`). Twelve raw values → four token-backed modifier classes. Buys the biggest token-conformance win in the drill-in and reduces reliance on `ops-sc.css`. (~2-3 hours if it's just the banner; more if it drags in the rest of the DayDetail stylesheet.)
4. **Codify the SC icon canon.** Either create `src/app/service-calendar/Icons.js` with the ~6 unique SVGs currently inlined (chevron, close X, check, info-circle, refresh, back-chevron), or start the opportunistic Lucide migration on this module first. Rules of thumb: the atom keeps its Unicode dingbats; everything else moves to the chosen source. (~2 hours)
5. **Decide the SC root density.** Add `data-density="compact"` to the SC root (or `.sc-body`) and verify the whole surface still renders correctly. If it does, the drill-in workspace resolves to Density automatically (which is the documented mode); if it doesn't, we've flushed out a mode-mismatch we didn't know about. (~1 hour of investigation, 5 min of code.)

## Cross-cutting issues

- **`ops-sc.css` is a shared-file danger zone.** It carries the account-context chrome (`sc-cat--pdc/-mlb/-milb`), the day-detail chrome (`sc-day-*`), and the SC-side buttons (`sc-btn-*`). Any drill-in cleanup that touches it will affect the overview's chrome and the admin panels. Recommend: scope out the DayDetail-relevant chunk into a new `dayDetail.css` alongside the JSX, and defer the account-chip color tokenization to a separate PR.
- **Density mode inheritance is untested.** The SC root doesn't declare a mode. The overview may be rendering Comfortable-by-default despite being documented as Density. Any drill-in redesign that assumes Density on the workspace should first verify what's actually resolving.
- **Icon canon crosses overview and drill-in.** Whatever chat-Claude picks (Icons.js / Lucide / status quo) will apply to both, so the drill-in redesign is the moment to codify.
- **`docs/DESIGN_SYSTEM_REFERENCE.md:171` (Lucide "not yet installed")** is doc drift that touches every future SC decision on icons. Fix as part of the redesign closeout (~5 min).

## Recommended priority order (opinionated INPUT for chat-Claude)

1. **Pre-work: confirm density mode.** Spend an hour verifying whether SC actually renders Density or Comfortable on desktop. This decides the density-token behavior for the entire redesign; getting it wrong up front costs the most.
2. **Kill the dead constants + tokenize PeriodWorkspace inline hex.** Sub-2-hour surgical cleanup that lands the workspace on tokens end-to-end. Ship as one small PR.
3. **Codify the SC icon canon.** Land the file/pattern first, then use it in DayDetail's redesign. If the answer is Lucide, this is the SC surface where the "opportunistic migration" starts.
4. **Scope DayDetail's stylesheet into its own file.** Extract the `.sc-day-*` block from `ops-sc.css` into `dayDetail.css` alongside the JSX. No tokenization yet - just relocation. This makes the tokenization safer.
5. **Tokenize the coaching banner + review overlay + success overlay in DayDetail.** Modifier classes; kill the inline-style hex. This is the biggest visual win.
6. **Align the period-header shape (PeriodWorkspace ↔ PeriodCard).** Pick one arrangement; edit both.
7. **Fix the NavRow breadcrumb phase-chip consistency** (render in the happy path too, or drop it entirely).
8. **`legendInfoPopup.css:9` scrim → token.** Small, but closes the overview-side loop while we're in the neighborhood.
9. **Fix doc drift** on `DESIGN_SYSTEM_REFERENCE.md:171` (Lucide install status) and add a Captain's log entry for the icon canon decision.
10. **P2 backlog polish** (chevron consistency, expand/collapse glyphs, prev/next arrows) - batch together.

## Why this order

- **Density mode first**: it's an upstream decision that changes what "tokenized" even means for the drill-in. Wrong mode = re-tokenize twice.
- **Small surgical wins next** (constants + PeriodWorkspace hex): buys the token gate back for one whole file with sub-3-hour risk.
- **Icon canon before DayDetail refactor**: if we pick Lucide, we swap `+/−` and `&#8249;/&#8250;` while we're already opening DayDetail; if we pick Icons.js-style, we set the file up and consume it. Doing DayDetail first and icons later means opening DayDetail twice.
- **Scope before tokenize**: pulling DayDetail's CSS out of `ops-sc.css` is a mechanical move; tokenizing afterwards is a semantic move. Do the mechanical work first so the semantic work is unambiguous.
- **Header + breadcrumb alignment is cheap once the token/CSS work is done**, and it removes the last "these look like different components" complaint.
- **Doc drift closes the loop.**

---

## Method notes

- Read at `origin/main` HEAD `ecb2d42`.
- Files fully read (Section 1): `DESIGN_TOKENS.md`, `DESIGN_SYSTEM_REFERENCE.md`, `DESIGN_PRINCIPLES.md`, `DESIGN_REVIEW_PERSONA.md`, `tokens.css`, `Icons.js`, `package.json` (relevant deps section).
- Files fully read (Section 2): `SeasonShell.js`, `MonthCard.js`, `PeriodCard.js`, `PhaseStrip.js`, `SeasonStepper.js`, `StateLegend.js`, `LegendInfoPopup.js`, `ChromeBar.js`. CSS files audited via grep for hex/rgba + line-count for raw px + spot-read of anchor rules.
- Files fully read (Section 3): `PeriodWorkspace.js` (850 lines), `DayDetail.js` (487 lines), `DaySquare.js` (340 lines), routing block in `ServiceCalendar.js:925-1050`, prefix reads of `periodWorkspace.css` and `DaySquare.css`, grep audits of `ops-sc.css`.
- CSS token audit method: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\([0-9]"` for color; `grep -cE "\b[0-9]+px\b"` for raw px counts.
- Inline glyph audit: `grep -rn "<svg\|'✎'\|'✓'\|'○'\|'⚠'"` across `src/app/service-calendar/`.
- No code changes, no build, no commit, no PR - as briefed.
