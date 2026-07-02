# SC Design Token README (for chat-Claude, drill-in redesign)

**You are:** chat-Claude, doing design review + proposals for the Service Calendar drill-in redesign (part 2). The overview (part 2's peer, part 1) is shipped and clean, and it is the standard part 2 must match.

**This doc is:** the SC-specific design-token bible. Read it front-to-back before proposing anything. If it disagrees with the four canonical sources listed below, the sources win.

**Companion docs (read in this order):**
1. [`SC_REDESIGN_SPEC.md`](SC_REDESIGN_SPEC.md) - the 13-section spec. §13 is the drill-in alignment section. Ground truth for the redesign arc.
2. [`SC_DRILLIN_ALIGNMENT_AUDIT_CC.md`](SC_DRILLIN_ALIGNMENT_AUDIT_CC.md) - the drill-in audit. What's shipped, what's drifted, per-file findings.
3. [`DESIGN_REVIEW_PERSONA.md`](DESIGN_REVIEW_PERSONA.md) - the review lens (severity framework, artifact format).
4. This file - the token layer of the alignment work.

---

## 1. The four canonical sources - do not paraphrase, do not guess

| File | What it is | When you read it |
|---|---|---|
| `src/app/tokens.css` | THE code truth. Every semantic token, every primitive, the density remap. If this and any doc disagree, this wins. | Any time you need a token's real value. |
| `docs/DESIGN_TOKENS.md` | THE rules doc. Two-tier model, add-and-deprecate, contrast intent, tool-accent doctrine. Includes the full `--accent-sc*` family description. | Any time you need to know the RULE around a token (not just its value). |
| `docs/design-tokens.html` | Current visual INVENTORY. Every token rendered as a swatch / sample. Includes the SC family + tool accents. | Any time you need to see what a token LOOKS like. `open docs/design-tokens.html`. |
| `docs/design-tokens-v3.html` | Design-system NARRATIVE from the token audit. 3-tier architecture, WCAG Contrast Report, icon concept → glyph vocabulary, interactive states, composite screen demo. v3 predates the SC accent family. | Any time you need the WHY behind the system, or the WCAG matrix, or the icon vocabulary. |

**Do not** cite tokens from memory or from the v3 file alone. `src/app/tokens.css` is the truth; the two HTML files are visualizations of that truth.

---

## 2. The token model in 60 seconds

Two tiers, one rule.

- **Tier 1 - Primitives** (`--navy-700`, `--space-4`, `--rad-10`). Raw values. Generated, not hand-picked. Components NEVER touch these directly.
- **Tier 2 - Semantic** (`--text-default`, `--surface-page`, `--status-overdue-fg`, `--radius-control`). Names a JOB and points at a primitive. **This is what components use.**
- Theming (density, dark, rebrand) is a remap of Tier 2. Zero component edits.

Additional Tier 3: **Tool accents.** One per surface (`--accent-ops`, `--accent-people`, `--accent-directory`, `--accent-playbook`, plus the SC-specific `--accent-sc*` family in §3 below).

**The rule.** Components consume semantic tokens only. A raw color or pixel value in a component is a defect - not a style choice.

**Density mode.** `[data-density="compact"]` remaps six semantic tokens (`--space-stack`, `--space-card-pad`, `--space-inline`, `--control-height`, `--row-height`, `--cell-size`). The SC root already carries `data-density="compact"`; the DayDetail + bulk overlays override to `data-density="comfortable"`. Anything reading these tokens re-snaps automatically. See §5 below.

**Reduced motion.** `--duration-*` primitives zero out under `prefers-reduced-motion`. Motion is composed via `--motion-control` (120ms `--ease-standard`) or `--motion-surface` (180ms `--ease-emphasized`), so components inherit the pause without a media query.

---

## 3. The SC-specific tokens - the `--accent-sc*` family

The SC is a green-themed tool. Rather than force the SC surface to conform to the app's navy primary, the SC carries its own Tier-3 tool accent in four tiers.

| Token | Hex | Contrast | Use it for |
|---|---|---|---|
| `--accent-sc` | `#0F6E56` | AA on white (5.02); AA with white text (5.02) | Primary interactive green. Focus rings on SC interactives, `today` CTAs, `back` links, `on-track` check, `caption--done` tag, the workspace `Nav-today` pill, active/touched borders. |
| `--accent-sc-dark` | `#085041` | Deeper green | Hover state for `--accent-sc` (`Nav-today:hover`), phase-timeline title accents. |
| `--accent-sc-subtle` | `#E1F5EE` | Very light wash | Subtle hover backgrounds (pill hovers, spotlight fill under `--done` on the mobile card, back-link hovers). |
| `--accent-sc-tint` | `#F0FDF4` | Faintest wash | Bare backplates - MiLB `PhaseStrip` bare-rail gradient middle stop, subtle backdrops. |

**Sharing rule.** `--accent-sc` = `--accent-playbook` = `#0F6E56` intentionally. Same operational green identity, two tools, no conflict.

**Boundary.** Cell-state colors are SEPARATE. Any state-encoded color on a day tile / status badge / progress bar goes through the `--status-*` family (entered / needs / overdue / upcoming / off), regardless of surface. The `--accent-sc*` family is for **interactive identity**, not state.

**Anti-pattern.** Do NOT introduce a fifth SC accent variant. If a design decision seems to need one, that's a signal the design is off, not the tokens.

---

## 4. The alignment rules - "match the overview" in operational terms

The overview (Season shell, Calendar grid, Period grid, day-square atom, SeasonStepper, PhaseStrip, StateLegend, ChromeBar and their scoped CSS files) is the shipped standard. Part 2 (`PeriodWorkspace.js` + `DayDetail.js` + their CSS) must match on each of the following axes.

**Every design decision in the drill-in maps through one of these rules:**

| If the value expresses... | Consume this token family | Never consume |
|---|---|---|
| Text color (heading / body / muted / link) | `--text-heading / -strong / -default / -muted / -subtle / -inverse / -link / -success / -danger` | raw hex, `--n-*` primitives, `--navy-*` primitives |
| Surface background | `--surface-page / -card / -sunken / -overlay` | raw hex |
| Border | `--border-subtle / -default / -strong` | raw hex |
| Interactive green (hover, focus, active, "you clicked this") | `--accent-sc` (or `-dark` on hover; `-subtle` for backgrounds; `-tint` for faintest wash) | raw `#0F6E56`, `--green-*` primitives |
| Action button | `--action-primary-bg / -bg-hover / -text` or `--action-secondary-*` | raw hex, `--navy-*` |
| Amber accent (dark text) | `--accent`; use `--accent-solid` when the label must be white | raw amber hex |
| Amber text | `--accent-text` | raw `#8C3A00` |
| Day-cell state fill / badge / dot | `--status-{entered/needs/overdue/upcoming/off}-{bg/bd/fg/subtle/strong}` | raw hex, ad-hoc `--fill-*` primitives |
| Today marker | `--status-today-ring` (2px navy outer ring) and `--status-today-fg` for the number | raw hex |
| Feedback banner (success / warning / danger / info) | `--feedback-success / -warning / -danger / -info` (+ `--feedback-info-subtle / -border` for wash + border) | raw hex |
| Spacing between siblings | `--space-1..8` for absolute values; `--space-stack / --space-card-pad / --space-inline` for density-aware | raw px |
| Radius | `--radius-cell` (data cells 4px), `--radius-control` (buttons/inputs 10px), `--radius-container` (cards 10px), `--radius-container-lg` (hero/modals 14px), `--radius-pill`, `--radius-circle` | raw px |
| Elevation | `--elevation-card / -raised / -popover` | raw `box-shadow` |
| Motion (control-scale) | `transition: <prop> var(--motion-control)` (120ms standard) | raw ms, raw cubic-bezier |
| Motion (surface-scale) | `transition: <prop> var(--motion-surface)` (180ms emphasized) | raw ms |
| Focus ring | `outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset);` on every interactive | ad-hoc borders on focus |
| Z-index | `--z-dropdown / -sticky / -overlay / -popover / -toast` | raw number |
| Opacity | `--opacity-disabled` (0.45), `--opacity-muted` (0.6), `--opacity-scrim` (0.5) | raw decimal |
| Icon size | `--icon-sm` (16), `--icon-md` (20), `--icon-lg` (24) | raw px |

**One extra rule beyond tokens.** Every SC surface's styles live in its OWN scoped CSS file next to its JSX (`SeasonShell.js` → `season.css`, `ChromeBar.js` → `chromeBar.css`, `PhaseStrip.js` → `season.css` shared with strip rules, etc.). The DayDetail is the current exception - its `.sc-day-*` rules sit inside the shared `ops-sc.css` mega-file. Part of the drill-in alignment is scoping DayDetail OUT into its own `dayDetail.css`, mechanical relocation first, tokenization after.

---

## 5. Density mode - what the SC actually renders

- The SC root (`ServiceCalendar.js`) carries `data-density="compact"`. So the whole SC surface reads Compact spacing.
- The DayDetail overlay + the bulk overlay each carry `data-density="comfortable"` on their wrapper. So those two overlays read Comfortable.
- Mobile (<1024px) is Comfortable by app-wide policy, regardless of the module's default.

**What this means for design.** Any spacing / control-height / cell-size decision on the drill-in should use the density-aware semantic (`--space-stack / --space-card-pad / --space-inline / --control-height / --row-height / --cell-size`), not the raw `--space-*` primitive. That way the workspace inherits Compact on desktop, the DayDetail overlay inherits Comfortable, and mobile inherits Comfortable, all with zero component code.

**Anti-pattern.** Do NOT introduce new density-varying values via media queries on individual components. The token remap does the work; a component-level media query on space or size is drift.

---

## 6. The shipped overview - what each surface consumes

This is your reference. If the drill-in doesn't consume the same families for the same jobs, that's the drift to fix.

| Surface | Interactive identity | State encoding | Chrome |
|---|---|---|---|
| `.sc-chrome-bar` (`ChromeBar.js` / `chromeBar.css`) | `--accent-sc` (Today CTA, `Jump` counts colored by state family), `--accent-sc-subtle` (pill hover) | `--status-needs-fg / -bg / -bd`, `--status-overdue-fg / -bg / -bd` on Urgency counts | `--surface-card`, `--border-default`, `--radius-container` |
| `.sc-season-strip` (`PhaseStrip.js` / `season.css`) | `--accent-sc-tint` (bare-rail gradient middle), `--surface-page` (bare-rail ends), phase-domain palette (rich rail - NOT tokenized, intentional) | Today line = `--status-today-ring` (`--navy-700`) | `--surface-card`, `--border-default`, `--radius-container` |
| `.sc-stepper` (`SeasonStepper.js` / `seasonStepper.css`) | `--accent-sc` (caption `done` tag), `--accent-sc-subtle` (spotlight `done` fill), `--accent` (focus segment amber - **intentional, not SC green** because focus states are the "you're here now" amber accent) | Segment fills: `done` = `--action-primary-bg` (navy), `next` = `--border-default`, `focus` = `--accent` | `--surface-card`, `--border-default`, `--radius-container` |
| `.sc-season-month-card`, `.sc-season-period-card` (`MonthCard.js`, `PeriodCard.js` / `season.css`) | Focus ring = `--focus-ring-color` (`--navy-700`); phase-tinted headers via phase palette | Cell states via `--status-*` family through `DaySquare`; today via `--status-today-ring` | `--surface-card`, `--border-default`, `--radius-container` |
| `.sc-state-legend` (`StateLegend.js` / `stateLegend.css`) | `--accent-sc-subtle` (background wash for the shell) | Swatches mirror `--status-*` family exactly | `--surface-card`, `--border-default` |
| `.sc-daysq` (`DaySquare.js` / `DaySquare.css`) - the atom | Focus box-shadow tracks | `--status-*` bg / bd / fg per state; today = `--status-today-ring` (outermost); focused = navy inset track | `--surface-card`, `--border-default`, `--radius-control` |
| `.sc-workspace-*` (`PeriodWorkspace.js` / `periodWorkspace.css`) | `--accent-sc` (Today pill), `--accent-sc-subtle` (Today pill hover), progress-bar green = `--accent-sc`, progress-bar amber = `--status-needs-strong` (PR #313) | Frame stats consume `--status-*` for urgency counts | `--surface-sunken` (page), `--surface-card` (Nav step + cards), `--border-default` |
| `.sc-day-*` (`DayDetail.js` / `ops-sc.css`) - **drill-in scope, needs alignment** | Should be `--accent-sc` for interactive; **currently raw hex `#0F6E56` in the coaching banner** | Should be `--status-*-bg/-bd/-fg` for banner states; **currently 12 raw hex tuples per state** | Should be `--surface-*` + `--border-*`; currently drifts through `ops-sc.css` |

Read the last row against the row above it. The alignment work is one row's worth of drift.

---

## 7. The current alignment state (what shipped / what's next)

| Cluster | Status | Notes |
|---|---|---|
| Overview color, radius, elevation, focus | **DONE** | ~90% token-clean; documented rgba hairline exceptions on card headers (matched literal, in comment). |
| Overview icon consistency | **P2 backlog** | Each surface hand-rolls its inline `<svg>`. Codify a local `service-calendar/Icons.js` (§13.1 of `SC_REDESIGN_SPEC.md`) when the drill-in touches icons; adopt in overview at the same time. |
| PeriodWorkspace color tokenization | **DONE** (#313) | Progress-bar + delta colors moved from raw hex to `--status-needs-strong / --accent-sc / --text-success / --accent-text`. Dead `GREEN/RED/AMBER` constants removed from DayDetail top. |
| DayDetail coaching banner tokenization | **BACKLOG** | 12 inline-hex tuples at `DayDetail.js:226-241` become `.sc-day-coaching--{state}` modifier classes backed by `--status-*-bg/-bd/-fg`. |
| DayDetail CSS scope-out of `ops-sc.css` | **BACKLOG - do mechanical relocation FIRST** | Move `.sc-day-*` rules from `ops-sc.css` into a new `dayDetail.css`. NO tokenization on this move - reduces blast radius. Tokenize after. |
| SC icon canon | **BACKLOG** | New `src/app/service-calendar/Icons.js` per the concept → glyph map in `SC_REDESIGN_SPEC.md §13.1`. Adopt in the non-status icon sites (close, chevron, refresh, info, back). DaySquare's Unicode dingbats stay. |
| DayDetail overlay a11y | **BACKLOG** | `role="dialog"`, `aria-modal`, Escape-to-close, focus-trap, return-focus. |
| Overview `legendInfoPopup.css:9` scrim | **P2 backlog** | `rgba(15,23,42,0.45)` → `--opacity-scrim` or `--surface-overlay` + opacity. |
| Doc drift | **DONE** (#314) | `DESIGN_SYSTEM_REFERENCE.md` Lucide claim corrected; `SC_REDESIGN_SPEC.md §13` added. |

---

## 8. Chat-Claude's pre-flight checklist (run before any proposal)

Before you propose ANY change to a SC file, run this checklist against your proposed value / class / rule:

1. **Does the token exist?** Check `src/app/tokens.css`. If it doesn't and you think it should, that's a Kevin decision, not a Claude decision. Flag the gap; do not invent.
2. **Is there an SC-family token to use before falling back to app-wide?** If the value is interactive green, the answer is `--accent-sc*`. If it's a state color on a day tile, the answer is `--status-*`.
3. **Am I proposing raw hex or raw px in a component?** If yes: stop. That's a defect. Find the semantic token or flag the gap.
4. **Am I proposing an inline `style={{ color: ... }}` or `style={{ background: ... }}` with a color?** If yes: stop. Move it to a class + CSS custom property, or a class + modifier.
5. **Is the surface I'm touching in the density-aware layer?** If it consumes spacing, it should use `--space-stack / -card-pad / -inline` or `--control-height / --row-height / --cell-size`. Raw `--space-*` primitives only when the value must be viewport-invariant.
6. **Does the state I'm encoding have a non-color cue?** Rubric non-negotiable: never color-alone. Pair with glyph, label, shape, or ring.
7. **Is there a visible focus-visible ring?** Every interactive gets `outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset);` under `:focus-visible`.
8. **Am I touching `ops-sc.css`?** If yes: is it necessary, or can I scope to the component's own CSS file? Prefer scope-out unless the rule is genuinely shared.
9. **WCAG check.** Any new text-on-background pair: verify AA. The v3 Contrast Report (`docs/design-tokens-v3.html`) shows the computed matrix for the shipped pairs.
10. **Does my proposal fit `SC_REDESIGN_SPEC.md §13`?** If it introduces new structure, it's out of scope for the alignment work.

---

## 9. Anti-patterns (never do these)

- **Raw hex in JSX or CSS in a SC component.** The only accepted exceptions are the documented rgba hairline shadows (`rgba(0,0,0,0.06)`) and the intentional white-on-fill (`#fff` inside the amber focus segment of `seasonStepper.css`).
- **Raw px in a spacing / radius / elevation / motion decision.** Small typographic fine-tunes (1-4px microsizing) are the common exception; container padding / radius / gaps go through tokens.
- **Inline `style={{ }}` with a color value in JSX.** Move to a class.
- **New tokens that don't fit the existing family.** If you feel one is missing, name it as a "gap" question for Kevin, don't invent.
- **`--accent-sc*` outside the SC surface**, or `--accent-people / -directory / -playbook / -ops` inside the SC surface. Tool accents belong to their tool.
- **Mixing the accent family with the state family.** Green identity (`--accent-sc*`) and green state (`--status-entered-*`) are different jobs; do not substitute one for the other.
- **New density-varying values via component media queries.** Use the density-aware semantic aliases; let the token remap do the work.
- **Speculative dark-mode work.** Dark mode is in v3 as a demo but is not in production `tokens.css`. Do not consume dark-mode tokens.
- **Assuming a token exists because v3 shows it.** v3 predates the SC redesign - check `src/app/tokens.css` (or the inventory `design-tokens.html`) for the current shipping list.

---

## 10. What's a Claude question vs a Kevin question

You can answer without asking Kevin:
- Does token X exist? → check `tokens.css`.
- What's token X's value? → check `tokens.css`.
- What token should I use for this design decision? → run the §4 mapping table.
- What does this token look like? → open the visual guide.
- What's the AA-safe pair for this color? → v3 Contrast Report.
- Which SC surface is currently rendering this class? → grep the SC directory.

Ask Kevin (surface the question in your proposal, don't decide unilaterally):
- Should a new token exist? (naming, value, family placement.)
- Should the SC accent family expand? (fifth variant, sixth variant - almost always the answer is no.)
- Should a semantic role's value change? (e.g. bumping `--radius-container` from 10 to 12.)
- Is the drill-in redesign in scope beyond what's captured in `SC_REDESIGN_SPEC.md §13`?
- Any icon concept → glyph vocabulary decision beyond the ten in §13.1.
- Any density-mode assignment change (which surface renders which mode).
- Any accessibility-tradeoff decision (e.g. a color-alone state where the redundant cue isn't landing well).

---

## 11. Working style with chat-Claude

Read `DESIGN_REVIEW_PERSONA.md` for the full persona. The token-relevant bits:

- **Cite `file:line` on every factual claim.** No memory citations.
- **Three directions, not one.** When a redesign direction is in question, present three with trade-offs labeled.
- **Both viewports.** Every proposal covers 375px + desktop.
- **Under 4 hours implementable** unless explicitly flagged as bigger with clear ROI.
- **Surgical > sweeping.** A 4px tweak that fixes hierarchy beats a 4-day refactor.
- **Kevin merges.** All PRs stop before merge. Kevin reviews via deploy + screenshot.

---

## 12. Doc pointers - if you find these disagree with `tokens.css`, `tokens.css` wins

- `docs/DESIGN_TOKENS.md` - the rules doc.
- `docs/DESIGN_SYSTEM_REFERENCE.md` - system reference (Lucide install status now correct as of #314; density mode assignments).
- `docs/DESIGN_PRINCIPLES.md` - the philosophy (floor-first, Four Gates, tokens-are-law).
- `docs/DESIGN_REVIEW_PERSONA.md` - review persona + severity framework.
- `docs/SC_REDESIGN_SPEC.md` - the SC redesign north star + §13 drill-in alignment.
- `docs/SC_DRILLIN_ALIGNMENT_AUDIT_CC.md` - the drill-in audit.
- `docs/design-tokens.html` - visual inventory.
- `docs/design-tokens-v3.html` - v3 narrative + contrast report.

---

**One-line summary:** consume the semantic tokens the overview consumes; consume `--accent-sc*` for SC identity; consume `--status-*` for state; scope CSS per surface; never inline hex; the checklist in §8 catches the rest.
