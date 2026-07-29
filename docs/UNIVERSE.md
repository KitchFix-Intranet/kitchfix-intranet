# UNIVERSE.md - The Ops Hub design universe

> **Purpose.** The written spec for what SC, OPD, and Sous share. What is
> universe (every surface, non-negotiable), what is theme (each product owns),
> and what is fenced (do not touch). Builders read this before touching any
> reskin PR; reviewers grade against it.
>
> **Status.** Foundation - TRAIN 1 landed 2026-07-29. Trains 2, 3, 4
> reskin the products against this spec.
>
> **Companion docs.** [`DESIGN_PRINCIPLES.md`](DESIGN_PRINCIPLES.md) -
> philosophy (Floor-first, Four Gates, EI lens).
> [`DESIGN_SYSTEM_REFERENCE.md`](DESIGN_SYSTEM_REFERENCE.md) - token
> reference. [`DESIGN_REVIEW_PERSONA.md`](DESIGN_REVIEW_PERSONA.md) - the
> review persona and severity ladder.
> [`audits/SOUS_DESIGN_ALIGNMENT_2026-07-28.md`](audits/SOUS_DESIGN_ALIGNMENT_2026-07-28.md)
> - the measured-values audit (Appendices A and B) this spec is built on.

---

## 1. The seven universe rules

Every surface, non-negotiable. Ratified 2026-07-28.

1. **Semantic color meanings hold universally.** Green success/complete,
   amber needs-attention, red danger, navy informational. A color never
   means opposite things in two rooms.
2. **Focus-visible is ALWAYS 2px navy at 2px offset**, app-wide; white on
   navy fills. Tool accents never color focus. Consumer:
   `outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset)`
   where `--focus-ring-color = var(--navy-700) = #153968`
   [`src/app/tokens.css:113`].
3. **Actions are FILLED, statuses are OUTLINED.** A filled tool-accent
   button can never be confused with an outlined status pill. Solves the
   OPD teal-action vs green-pill adjacency.
4. **Nav is the universe constant.** `.kf-topnav-inner` widens to `1520px`
   [`src/components/TopNav.css:20`]. Shells are theme-level.
5. **Status displays are honest.** Visible legend always;
   missing / failed / zero render distinctly (never one blank cell for
   all three).
6. **Confirm in place; failure inline, specific, input-preserving.**
   Reduced motion enforced at the token layer -
   `@media (prefers-reduced-motion: reduce) { :root { --duration-*: 0ms } }`
   [`src/app/tokens.css:160-162`].
7. **Token discipline as practice.** Each product owns a declared ladder,
   zero raw hex or px in component CSS, grep-enforced in review.

---

## 2. Theme rulings (what each product owns)

### Colors

| Axis | Universe value | Theme override | Notes |
|---|---|---|---|
| Amber (digital) | `#D97706` | none | `--amber-500` [`src/app/tokens.css:15`]. Load-bearing across News, Playbook admin, ops shell, Vendor Portal, People, Financial, home. Consumer tokens: `--amber-500`, `--kf-ops-amber`, `--oh-mustard`, `--kf-mustard-text`. |
| Amber (brand collateral) | `#D9892F` | print / brand-book only | Zero code presence today (Appendix A A.4). If it ever ships to screen it is a deliberate print-parity match, not a general amber. |
| Operational green | `#0F6E56` (`--accent-sc` = `--accent-playbook` = `--kf-playbook-teal`) | SC + OPD share it as tool identity | Deliberate. Cell-state green comes from the `--status-*` family, never from the tool accent (Appendix A A.4). |
| Page ground | `#edeff2` (`--kf-bg`, `--surface-page`, `--sc2-canvas`) | none | Universe-wide cool grey [`src/app/globals.css:17`, `src/app/tokens.css:69, 150`]. |
| Warm cream `#F4F2EC` | retired from page ground | `--n-100` primitive stays available | `--surface-page` no longer points at `--n-100`; anything that still wants warm cream reads the primitive by name. |
| STD-001 sky-blue `#7DB9D5` | OPD | reader heading rules + cover accent | Exposed as `--opd-sky` [`src/app/tokens.css`]. |
| STD-001 anchor tint `#C4E3E8` | OPD | anchor-banner reader ground | Exposed as `--opd-anchor`. |
| Focus ring | `--focus-ring-color: --navy-700 = #153968` | none | Universe rule 2. |

### Per-hub tool accents (Tier 3, identity)

| Tool | Accent token | Value | Consumers |
|---|---|---|---|
| Ops shell | `--accent-ops` | `--amber-500` (`#D97706`) | Vendor Portal, Inventory, Invoice Capture identity chips |
| People Portal | `--accent-people` | `#7C3AED` (purple) | PP module theming |
| Directory | `--accent-directory` | `#C41E3A` (Cardinals red) | Directory cards |
| Playbook / SC (shared) | `--accent-playbook` / `--accent-sc` | `#0F6E56` | OPD reader interactives, SC v1 buttons + focus rings (before Train 1 sweep) |
| Sous | (Train 3) | (TBD Train 3) | To be added when the Sous surface lands. |

### Shells

Nav is 1520 (universe constant, rule 4). Product shells:

| Surface | Shell max-width | Source |
|---|---|---|
| Nav inner | **1520** | `src/components/TopNav.css:20` |
| Service Calendar v2 overview | **1520** | `--sc2-shell-max` [`src/app/tokens.css:136`] |
| Service Calendar v2 DayEntry | **1240** | `--sc2-entry-max` [`src/app/tokens.css:137`] |
| SC v1 `.oh-bound` | 1024 (legacy) | `src/app/ops/css/ops-shared.css` |
| OPD browsing shell (`.pb-shell`) | 1024 today - **1240 in Train 2** | `src/app/playbook/playbook.css:8-10` |
| OPD reader (`.pb-fullpage-wrap`) | 880 today - **1240 in Train 2** | `src/app/playbook/playbook.css:2150-2156` |
| OPD reader prose cap | 776 today - **~760 in Train 2** (72 CPL) | Appendix A A.1 CPL method |
| Sous page | rides OPD's shell (**1240**) | Train 3 |
| Global default (`.kf-desktop-wrapper`) | 1024 | `src/app/globals.css:48-52` |

Prose cap ~760 targets 72 CPL at Inter 15px body (0.55 em advance);
Appendix A A.1 documents the method.

### Type

- Screen body face: **Inter**. `body { font-family: var(--font-ui) }`
  [`src/app/globals.css:41`]. Mulish is print-collateral only. Ops shell
  `--oh-font-body` still resolves to Mulish - fenced open item, does not
  ship in Train 1 (see §5 fences).
- OPD display face: **Oswald** on OPD's declared ladder (STD-001 v1.3).
  Ladder tokenized as `--opd-display 36 / --opd-h1 26 / --opd-h2 18 /
  --opd-h3 16 / --opd-body 15 / --opd-caption 12.5 / --opd-micro 10`,
  weights 400/600/700/800, body leading 1.6
  [`src/app/tokens.css` OPD block].
- SC keeps its own type scale (SC v2 T-table Standard at
  `--sc2-scale: 0.9`, Appendix A A.3).

### Radius ladders

- Universe primitives at `:root`: `--rad-4 / --rad-6 / --rad-10 / --rad-14 / --rad-pill / --rad-circle`
  [`src/app/tokens.css:41`].
- Semantic roles: `--radius-cell 4 / --radius-control 10 / --radius-container 10 / --radius-container-lg 14 / --radius-pill / --radius-circle`
  [`src/app/tokens.css:108-109`].
- SC v2 ladder: `--sc2-radius-cell 6 / --sc2-radius-control 9 / --sc2-radius-container 11 / --sc2-radius-tile 8 / --sc2-radius-card 12 / --sc2-radius-modal 14`
  [`src/app/tokens.css:245-270`].
- **OPD ladder (Train 1): `--opd-r-1..5: 4/8/12/16/20` + `--opd-r-pill`**
  [`src/app/tokens.css` OPD block]. Chips migrate 5 -> 4, Sous stub
  10 -> 12 in Train 2. No consumers migrate this train.

### Motion

Universe primitives: `--duration-fast: 120ms / --duration-base: 180ms / --duration-slow: 280ms`
[`src/app/tokens.css:47`]. Roles: `--motion-control` (fast standard),
`--motion-surface` (base emphasized) [`src/app/tokens.css:114`].
Reduced-motion collapses all three durations to `0ms` at the token layer
[`src/app/tokens.css:160-162`].

**Motion budget by surface:**
- SC: SC v1 hover-lift (`translateY(-1px)`), overlay
  entrance (200-250ms), the Handoff sequence (SC v2, BEAT_DELAYS
  0/200/660/1020/1350/1850 at
  [`src/app/service-calendar/v2/handoff/coordinator.js:53-60`]). Handoff
  choreography is SC-only.
- OPD: card entrance `pb-card-in 200ms ease-out backwards` with staggered
  --idx delay capped at 12 * 30ms
  [`src/app/playbook/playbook.css:966-967`]. Slide-over
  `pb-slide-in 0.25s cubic-bezier(0.4, 0, 0.2, 1)` and overlay fade
  `pb-fade-in 0.18s ease` [`src/app/playbook/playbook.css:2004, 2018`].
- Sous: tool-progress line + live stream + rail/badge settle. Nothing
  flies, nothing celebrates.

---

## 3. Status-display non-negotiables

From rule 5, the details:

1. **Every status-bearing surface renders a visible legend.** Never a
   glyph-only or color-only display without the legend accessible on the
   surface (in-flow or in a popover invoked from the surface).
2. **Missing / failed / zero are three distinct visual states.** A blank
   cell for all three (or "-" for all three) hides the operational reality.
   SC v2 encodes this via the T-table state family (Appendix A A.3):
   entered has a saturated green pole; upcoming a light-mint step down;
   needs an amber pastel with a heavy numeral; overdue a brick fill with
   "!" glyph; off a warm neutral with no border; failed dashed brick;
   loading a neutral shimmer track.
3. **Every state carries at least two channels** (two-signal law):
   fill + border, or fill + glyph, or fill + heavy weight. Color alone is
   never a state. Sous surfaces this as: 4px accent rail + outlined badge
   + provenance line - three redundant channels.
4. **Confirm in place; failure inline, specific, input-preserving.**
   Confirm affordances render at the point the user acted. Failures show
   at the input, name the specific failure, keep the operator's input in
   the field.

---

## 4. Sous motion + surface spec (from Design Scope, for Train 3)

Recorded here so Train 2 and Train 4 do not accidentally cross into Sous
territory.

- **Answer card:** 4px accent rail (grounded green, partial amber,
  declined navy, failure red) + outlined badge + provenance line. Three
  redundant channels; never color alone.
- **Markdown renders** in the answer card. Sous writes bold, lists, line
  breaks natively (plan v2.32 requirement, `**$515,712**` in the field
  trace).
- **Source chips** styled as OPD `.pb-class-chip` (Appendix A A.5),
  deep-linking `/playbook/d/[docId]`.
- **Overlay panel:** 480px wide, full-bleed under 1024px viewport. Mobile
  is a full-screen sheet with the ask bar pinned to the BOTTOM.
- **Motion fence:** tool-progress line + live stream + rail/badge settle.
  Nothing flies, nothing celebrates. No pillFly clone, no confetti, no
  ring sweep. Handoff choreography is SC-only.

---

## 5. Fences (do not touch)

### Fence A - Print pipeline

The OPD reader print block and STD-001 v1.2 phase 2 cover page are the
STD-001 -> code coupling. Every reskin PR leaves these byte-identical
until STD-001 v1.4 sanctions a change. From Appendix B.10:

- `src/app/playbook/playbook.css:2412-2484` - `@media print` block for
  the reader (chrome stripped, wrap zeroed, `-webkit-print-color-adjust: exact`
  on callouts, print type sizes 22/16/13/11pt, page-break rules).
- `src/app/playbook/playbook.css:2486-2597` - `.pb-print-cover`,
  `.pb-print-cover-logo`, `-title`, `-sub`, `-rule`, `-meta`, `-row`,
  `-id`, `-class`. Oswald 44pt/700 navy cover title; frontmatter-driven
  metadata with em-dash for blanks.
- `src/app/playbook/d/[docId]/DocumentFullPageClient.js:321-334` -
  the `<section className="pb-print-cover pb-print-only">` consumer.
- `src/lib/print/assets.js` - the SC print pipeline. Bebas Neue lives
  here (`:31, 106, 109, 110, 222, 250`) and only here. Do not add it to
  the screen font stack.
- `src/lib/print/monthSheet.js`, `seasonSheet.js`, `opsCalendarSheet.js`,
  and every other `src/lib/print/*.js` file - SC print rendering. Not a
  screen concern.
- STD-001 v1.3 governs every rule inside these files
  [`content/documents/STD-001.mdx`].

### Fence B - STD-002 register

The Visual Communication Standard (STD-002 v0.3) governs POST, POSTER,
INFO, SIGN artifacts. These have a different visual register than body
docs (14pt body minimum, four-tier severity, tile-internal grammar).
Reskin PRs do NOT apply body-doc typography or radii to STD-002
artifacts. The reader may render them as body docs today; a per-class
reader treatment is deferred [`content/documents/STD-002.mdx`].

### Fence C - Handoff is SC-only

The Handoff sequence (fadeSvc / pillIn / pillFly / ringSweep / clearRow /
slideNext / closeRing / checkDraw) is the SC entry celebration. The
`BEAT_DELAYS` table at
[`src/app/service-calendar/v2/handoff/coordinator.js:53-60`] and every
`src/app/service-calendar/v2/handoff/*` file are SC exclusive. OPD and
Sous never emit Handoff-style animations.

### Fence D - Sous motion budget

Nothing in Sous flies, nothing celebrates. The motion budget is
tool-progress line + live text stream + rail/badge settle. This fence
exists so future PRs do not steal SC's celebration language for a chat
surface.

### Fence E - Train 1 in-scope surfaces (this PR)

Train 1 touches ONLY the surfaces the CC prompt named:
- `docs/UNIVERSE.md` (new)
- `src/app/tokens.css` - `--opd-*` block + `--surface-page` value flip
- `src/app/globals.css` - `--kf-bg` flip + `body` font + six residual
  Mulish sites
- `src/components/TopNav.css` - nav max-width
- SC v1 CSS - focus rule sweep to navy
- `src/app/playbook/playbook.css:1003-1006` - ONE declaration
  (`.pb-card:focus-visible`)

No other `playbook.css` change. No SC v2 change. No print pipeline touch.

### Fence F - OPD Build Dashboard (`playbook/admin/admin.css`)

The Build Dashboard is Train 4, deferred pending its rework
(`BUILD_DASHBOARD_AUDIT_CC.md` verdict was "rework"). Its focus-visible
sites at [`src/app/playbook/admin/admin.css`] still read
`var(--kf-ops-amber)` or `var(--kf-playbook-teal)`. Those sweep at Train
4, not now. Deliberate scope exclusion.

---

## 6. Named open items (not this train)

Items surfaced by Train 1 or by Appendix B that the reskin will need
Kevin's ruling on later. Recorded here so nothing gets silently absorbed.

1. **`--oh-font-body: "Mulish"`** at `src/app/ops/css/ops-shared.css:30`.
   Flipping it to Inter restyles SC v1, Vendor Portal, People Portal, and
   the entire ops shell. Out of Train 1 scope. Kevin ruling wanted:
   flip in a future train, or accept Mulish as the ops-shell body face.
2. **OPD reader focus sweep (11 sites) and OPD admin focus sweep
   (~11 sites).** Reader sites sweep in Train 2 alongside the reader
   work. Admin sites sweep in Train 4 alongside the admin rework.
3. **The `.sc-day-notes-input:focus-visible` still sets
   `border-color: var(--accent-sc)`.** The outline is now navy per rule
   2; the border-color hint at accent-sc remains as SC's input focus
   decoration. If Kevin wants that also navy, small follow-up sweep.
4. **`outline: none` + custom box-shadow / border patterns on inputs**
   (e.g. `.sc-day-activity-composer-input:focus-visible` uses
   `outline: none`; `.sc-admin-eff-date:focus` uses `:focus` not
   `:focus-visible` with a box-shadow-based ring). Rule 2 is about the
   `outline` property; these custom patterns are left alone in Train 1.
   If Kevin wants them normalized to `outline: 2px solid var(--focus-ring-color)`,
   small follow-up sweep.
5. **The submissionToast focus ring flipped white -> navy.** Amber gradient
   background reads with a navy ring. If Kevin dislikes the visual on the
   milestone celebration, roll back to white with a comment noting rule 2
   exception "toast celebrates over amber gradient."
6. **STD-001 v1.4 screen heading rules** (H1 2px / H2 1px / H3 1px at 60%
   opacity sky-blue) - Design Scope (5a) sanctions the rev. The reader
   currently ships H1/H2/H3 rules in `pt` (browsers render sub-1px pt
   unpredictably). Rev + reader sweep are Train 2 work.
7. **Amber fork `#D9892F`.** Design Scope rules `#D9892F` as brand-book
   print-collateral canonical; `#D97706` remains digital canonical. If
   `#D9892F` ever needs to appear on screen (e.g. a print-preview render
   inside the intranet), it enters as a scoped token then, not now.

---

## 7. Governance

- **`tokens.css` wins.** If this doc and `tokens.css` diverge, fix the
  doc. Every value cited here should trace to a file:line above.
- **Add-and-deprecate, never silently mutate a token's value.** If a
  universe token changes, cite the change here with the date and the
  rationale.
- **Grep-enforced discipline.** Reskin PR reviews grep for raw hex or px
  in component CSS. `outline: 2px solid var(--focus-ring-color)` is fine;
  `outline: 2px solid #153968` is a defect.
- **This doc is the spec builders read; it is not the artifact users see.**
  It is a design contract between Chat, CC, and Kevin.

---

## Captain's log

- **2026-07-29** - Initial spec, TRAIN 1 foundation PR. Seven universe
  rules ratified; `--opd-*` token layer + focus sweep + nav width + ground
  unification + globals-scope Mulish body sweep landed. Six named open
  items recorded.
