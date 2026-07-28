# Sous Design Alignment - Ops Hub Shipped Design Language

> **Purpose (D0).** A read-only extraction of the intranet's actual shipped
> design language so the Sous surface can be designed to look and feel like it
> belongs to the Ops Hub rather than an OpenAI-style chat product. This is not
> a spec. It records what is on `main` today, with `[code-read]` file:line
> citations and doc-vs-code drift flagged as P2.
>
> **Scope.** Design principles + gates, palette + token architecture,
> typography, top-nav shell, four representative surface anatomies (Service
> Calendar day tile / cell states, SC command chrome, Playbook doc reader,
> shared `.oh-*` utility layer), layout facts, and Sous fit notes.
>
> **Method.** Every claim below is either `[code-read]` (file:line) or
> `[doc-read]` (doc path). Verbatim excerpts over paraphrase where the token
> value or class name is load-bearing.
>
> **Verdict.** The Ops Hub is a token-first, module-prefixed vanilla-CSS
> system with an intentional two-tier architecture (primitives -> semantics),
> a green-branded Service Calendar tool identity, a warm cream page ground,
> and a floor-first bias (dense on desktop, comfortable on mobile). Sous
> should read as an Ops-Hub tool - navy chrome + white surface + amber
> accent, module-prefixed CSS (`sa-` proposed), semantic tokens only, and
> its own tool-accent slot if it earns one. The current chat scaffold is
> off-system; four alignment moves close most of the gap.

---

## 1. Design principles + gates (canonical, from the three design docs)

**Floor-first design.** Every UX decision is gut-checked against: *"Does
this work for a chef on a phone in a 38 F walk-in cooler with wet hands?"*
The floor wins ties. Encoded in code as the density-mode override -
viewport <1024px flips `[data-density="compact"]` to the Comfortable value
set. `[doc-read] docs/DESIGN_PRINCIPLES.md:27-31`,
`[code-read] src/app/globals.css:1640-1662`.

**The Four Gates.** Any new pattern must pass all four: (1) Is this real?
(2) Will it work on the floor? (3) Will it scale and last? (4) Can we
sustain it (one-person dev shop)? `[doc-read] docs/DESIGN_PRINCIPLES.md:34-43`.

**EI lens - the KitchFix vibe.** Between MLB clubhouse-grade professionalism
and kitchen-line utility. Not SaaS-startup playful. Not enterprise-banking
sterile. Confident, dense, tactile. `[doc-read] docs/DESIGN_PRINCIPLES.md:44-48`.

**Density vs Comfortable is task-tuned, not user-tuned.** Lists and queues
take Density. Forms and entry take Comfortable. Mobile is always Comfortable.
`[doc-read] docs/DESIGN_PRINCIPLES.md:50-56`.

**Tokens are law.** Components consume semantic tokens only - never
primitives, never raw hex or px. Raw values in components are defects, not
style choices. `[doc-read] docs/DESIGN_PRINCIPLES.md:59-64`,
`[doc-read] docs/DESIGN_TOKENS.md:3-5`.

**WCAG 2.2 AA baseline.** Text contrast >=4.5, tap targets >=44x44,
never color-only signaling, visible focus-visible rings.
`[doc-read] docs/DESIGN_PRINCIPLES.md:82-92`.

**Severity ladder.** P0 broken on the floor / P1 friction / P2 polish /
P3 nice-to-have. Token conformance = High when violated.
`[doc-read] docs/DESIGN_REVIEW_PERSONA.md:20-32`.

---

## 2. Implemented token truth

### 2.1 Architecture

Two tiers at `:root` in `src/app/tokens.css`. Tier 1 = primitives (raw
values). Tier 2 = semantic (intent). Components consume Tier 2 only.
Density mode remaps Tier 2 only; primitives stay fixed.
`[code-read] src/app/tokens.css:8-9, 56, 153-157`.

Service Calendar carries a scoped v2 layer at `.scv2 { }` that publishes a
parallel `--sc2-*` token family. SC v2 is a self-contained theming surface
inside SC only. `[code-read] src/app/tokens.css:204-526`.

### 2.2 Palette primitives (Tier 1)

| Family | 700 role | Ramp anchor | Consumer intent |
|---|---|---|---|
| Navy | brand at 700 | `--navy-700: #153968` | Titles, primary action, focus ring, today ring |
| Amber | accent at 500 | `--amber-500: #D97706` | Ops accent, warnings, category-mlb chip |
| Green | success at 500; entered = 300/400 | `--green-500: #16A34A` | Success text, entered-cell strong border |
| Red | danger at 500; overdue = 200/300 | `--red-500: #DC2626` | Danger, feedback, badge dot |
| Neutral | warm cream -> cool ink | `--n-0: #FFFFFF` to `--n-900: #0A2548` | Surfaces, borders, ink |
| Mint | scoreboard-only | `--mint-300: #7FD3B4` | Reserved for DayDetail scoreboard "recorded" numeral |

`[code-read] src/app/tokens.css:11-26`. Each ramp has 10 steps
(50/100/.../900). Warmth: `--n-100: #F4F2EC` is the shipped page ground -
a warm cream, not a cool gray. `[code-read] src/app/tokens.css:23`.

Soft state fills (low-chroma, family-derived): `--fill-needs: #FCD9A0`,
`--fill-upcoming: #E2EFE4`, `--fill-off: #F1EEE7` + `-bd` borders.
`[code-read] src/app/tokens.css:28-29`.

### 2.3 Semantic tokens (Tier 2)

**Text.** `--text-heading` (n-900) / `--text-strong` (n-800) / `--text-default`
(n-700) / `--text-muted` (n-600) / `--text-subtle` (n-500) / `--text-inverse`
(n-0) / `--text-link` (navy-700) / `--text-success` (green-600) /
`--text-danger` (red-500). `[code-read] src/app/tokens.css:58-60`.
`--text-subtle` is UI/placeholder/border only - fails AA as body copy.
`[doc-read] docs/DESIGN_TOKENS.md:44-45`.

**Surface.** `--surface-page` (n-100 warm cream) / `--surface-card` (white) /
`--surface-sunken` (n-50) / `--surface-overlay` (white).
`[code-read] src/app/tokens.css:62`.

**Border.** `--border-subtle` (n-200) / `--border-default` (n-300) /
`--border-strong` (n-400). `[code-read] src/app/tokens.css:64`.

**Action.** Primary = navy-700 bg / white text / navy-800 hover; Secondary =
white bg / n-400 border / n-700 text. `[code-read] src/app/tokens.css:66-67`.

**Accent (contrast-split).** The amber accent fails white-on-amber AA, so
the token is deliberately split into four intents:
`--accent` (amber-500, fills with DARK text/borders/icons),
`--accent-solid` (amber-600, when WHITE text is required),
`--accent-text` (amber-700, amber-as-text on light),
`--accent-backplate` (amber-50, CTA wash).
`[code-read] src/app/tokens.css:73-77`,
`[doc-read] docs/DESIGN_TOKENS.md:49-51`.

**Tool accents (Tier 3, per-surface identity).**
`--accent-ops: var(--amber-500)`, `--accent-people: #7C3AED` (purple),
`--accent-directory: #C41E3A` (Cardinals red),
`--accent-playbook: #0F6E56` (playbook teal).
`[code-read] src/app/tokens.css:79`.

**Service Calendar `--accent-sc` family.**
`--accent-sc: #0F6E56` (primary interactive green; same hex as playbook,
intentional shared operational-green),
`--accent-sc-dark: #085041`,
`--accent-sc-subtle: #E1F5EE`,
`--accent-sc-tint: #F0FDF4`.
`[code-read] src/app/tokens.css:81`.

**Status family (cross-app, reusable).** Each status carries five slots:
`-bg / -bd / -fg / -subtle / -strong`. Every `-fg` is the darkest step
that passes AA on its fill. `[code-read] src/app/tokens.css:89-93`,
`[doc-read] docs/DESIGN_TOKENS.md:55-58`.

| State | bg | bd | fg | Consumer |
|---|---|---|---|---|
| entered | green-300 | green-400 | green-800 | DaySquare done cell |
| needs | fill-needs | fill-needs-bd | amber-700 | Needs-entry cell |
| overdue | red-200 | red-300 | red-700 | Overdue cell |
| upcoming | fill-upcoming | fill-upcoming-bd | n-700 | Scheduled cell |
| off | fill-off | fill-off-bd | n-700 | Off cell / off-season |
| today | (ring only) | navy-700 (2px) | navy-700 | Today outer ring |

**Feedback.** `--feedback-success` (green-600) / `--feedback-warning`
(amber-500) / `--feedback-danger` (red-500) / `--feedback-info: #2563EB`
with `-subtle: #f0f5ff`, `-border: #bfdbfe`.
`[code-read] src/app/tokens.css:96-97`.

**Category chips (SC classification, NOT status).** Deliberately hue-shifted
away from every status fill so classification never bleeds into
state-signaling. `[code-read] src/app/tokens.css:82-85`,
`[code-read] src/app/service-calendar/ops-sc.css:128-137`.
- `--cat-pdc-bg: #eff6ff`, `--cat-pdc-fg: #1e40af` (blue)
- `--cat-mlb-bg: #fef3c7`, `--cat-mlb-fg: var(--accent-text)` (amber)
- `--cat-milb-bg: #cffafe`, `--cat-milb-fg: #155e75` (cyan; moved off green
  after audit CC-8 to avoid overlap with the entered-state green)

### 2.4 Shape

Primitive radii: `--rad-4/6/10/14/pill/circle`.
Semantic roles: `--radius-cell: 4` (data cells / swatches),
`--radius-control: 10` and `--radius-container: 10` (buttons / inputs /
cards), `--radius-container-lg: 14` (large cards, hero, modals),
`--radius-pill` (toggles, chips, tags), `--radius-circle` (avatars, icon
buttons, dots). `[code-read] src/app/tokens.css:41, 108-109`.

Border widths: `--border-thin: 1px` / `--border-thick: 2px`.
`[code-read] src/app/tokens.css:43`.

### 2.5 Space

4px base: `--space-1: 4` -> `--space-8: 40`.
`[code-read] src/app/tokens.css:39`.

Semantic (Comfortable defaults at `:root`):
`--space-stack: --space-6` (24), `--space-card-pad: --space-4` (16),
`--space-inline: --space-3` (12), `--control-height: 40px`,
`--control-pad-x: --space-4`, `--row-height: 48px`, `--cell-size: 34px`.
`[code-read] src/app/tokens.css:117-118`.

Compact branch (via `[data-density="compact"]`): `--space-stack: --space-4`
(16), `--space-card-pad: --space-3` (12), `--space-inline: --space-2` (8),
`--control-height: 32px`, `--row-height: 40px`, `--cell-size: 28px`.
`[code-read] src/app/tokens.css:154-157`.

### 2.6 Elevation, motion, focus, z, opacity, icon

- Shadows: `--sh-sm` / `--sh-md` / `--sh-lg` primitives.
  Semantic roles: `--elevation-card: --sh-sm`,
  `--elevation-raised: --sh-md`, `--elevation-popover: --sh-lg`.
  `[code-read] src/app/tokens.css:45, 111`.
- Motion: `--duration-fast: 120ms`, `--duration-base: 180ms`,
  `--duration-slow: 280ms`. Eases: `--ease-standard` /
  `--ease-emphasized` / `--ease-exit`. Roles: `--motion-control` (fast
  standard) and `--motion-surface` (base emphasized).
  `[code-read] src/app/tokens.css:47-48, 114`.
- Focus ring: 2px navy-700 with 2px offset.
  `[code-read] src/app/tokens.css:113`.
- Z-index: base 0 / dropdown 1000 / sticky 1100 / overlay 1200 /
  popover 1300 / toast 1400. `[code-read] src/app/tokens.css:50`.
- Opacity: disabled .45 / muted .6 / scrim .5.
  `[code-read] src/app/tokens.css:52`.
- Icon: sm 16 / md 20 / lg 24. `[code-read] src/app/tokens.css:54`.
  `docs/DESIGN_SYSTEM_REFERENCE.md` documents Lucide at 14/16/20/24/32
  with stroke 1.5.
- Reduced motion: zeros the three `--duration-*` at the token layer.
  `[code-read] src/app/tokens.css:160-162`.

---

## 3. Typography facts

### 3.1 What is actually loaded

Google Fonts import loads Inter, Oswald, and Mulish:
```
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Oswald:wght@500;600;700&family=Mulish:wght@400;700&display=swap');
```
`[code-read] src/app/globals.css:4`.

Header comment on the same file: "STD-001 v1.2 type system: Oswald
(display) + Inter (body), one system across screen + print. Mulish retained
as fallback for any remaining legacy references but is no longer required
by the standard." `[code-read] src/app/globals.css:1-3`.

### 3.2 Where each face is actually used

**Inter** - the workhorse. Every `.kf-topnav-*` class, the hero greeting,
launch cards, modal titles, form controls, login screen, playbook body
copy (h2 / h3 / p), the SC entire surface (via `--font-ui` on `.sc-daysq`
and everywhere it inherits). `[code-read] src/app/globals.css:77, 161,
240, 270, 338, 341, 347, 395, 401, 409, 417, 422, 457, 516, 540, 1280`.
Also declared as `--font-ui` and `--font-body` in tokens:
`--font-ui: 'Inter',-apple-system,system-ui,sans-serif`.
`[code-read] src/app/tokens.css:31`.

**Oswald** - screen use is scoped to the Playbook (OPD) doc reader.
Cover title (`.pb-fullpage-title`, 36/700), body H1 with `SECTION 01`
eyebrow, and a handful of print-adjacent labels.
`[code-read] src/app/playbook/playbook.css:2230-2302`. Oswald does NOT
appear in Service Calendar, People Portal, Vendor Portal, home, or nav.

**Mulish** - still applied to `body` and a handful of legacy sites:
```
body { font-family: 'Mulish', sans-serif; ... }
```
`[code-read] src/app/globals.css:41`. Legacy usages persist at
globals.css:423, 1333, 1451, 1463, 1511, 1550 (loading text, some auth
copy). `docs/DESIGN_TOKENS.md:92` says "Mulish is reserved for the
print/PDF pipeline and is not part of the screen token set."

**Bebas Neue** - NOT in the screen font stack. Loaded only inside
`src/lib/print/assets.js:31` and consumed by print/PDF classes
(`.band .bk`, `.mo`, `.yr`, `.smo h4`, `.ymo h5`) at
`src/lib/print/assets.js:106, 109, 110, 222, 250`. The Pre-Service
Materials pipeline is the only surface that reads it.

**JetBrains Mono** - `--font-mono: 'JetBrains Mono','SF Mono',Menlo,monospace`.
Doc IDs (e.g. `.pb-fullpage-id`), code blocks in Playbook body, tabular
numerals. `[code-read] src/app/tokens.css:32`,
`src/app/playbook/playbook.css:2261, 2325`.

### 3.3 Size + weight scale (from tokens.css)

Sizes: `--size-micro 10 / --size-caption 12 / --size-body 14 /
--size-subhead 17 / --size-h3 20 / --size-h2 24 / --size-h1 29 /
--size-display 35`. `[code-read] src/app/tokens.css:33-34`.

Weights: `--wt-regular 400 / --wt-medium 500 / --wt-semibold 600 /
--wt-bold 700 / --wt-display 800`. `[code-read] src/app/tokens.css:35`.

Leading: `--lead-tight 1.1 / --lead-snug 1.25 / --lead-normal 1.5`.
Tracking: `--track-tight -0.01em / --track-caps 0.06em`.
`--num-tabular` = `tabular-nums` for numeric data.
`[code-read] src/app/tokens.css:36-37`.

Role bindings (from `docs/DESIGN_TOKENS.md:94-96`): display 35/800,
h1 29/700, h2 24/700, h3 20/700, subhead 17/600, body 14/400, body-strong
14/600, caption 12/600, eyebrow 12/700 caps, micro 10/600.

### 3.4 Legacy type scale (still live via specificity)

`globals.css` publishes a parallel `--type-*` scale under the two
`[data-density]` blocks (compact and comfortable), plus a mobile-max-1023px
override that pins compact to the comfortable values. The MIGRATION NOTE
in `docs/DESIGN_TOKENS.md:126-128` admits these "win by specificity" and
"retire during the density refactor."
`[code-read] src/app/globals.css:1596-1662`.

- Compact: caption 11 / body-sm 13 / body 14 / emphasis 16 / h2 20 / h1 24;
  line-body 1.3; line-heading 1.15; space-1..6 = 4/8/12/16/20/24;
  radius-card 8 / radius-input 4.
- Comfortable: caption 12 / body-sm 14 / body 16 / emphasis 18 / h2 24 /
  h1 32; line-body 1.5; line-heading 1.2; space-1..6 = 8/12/16/24/32/48;
  radius-card 12 / radius-input 8.
- Mobile <1024px: compact re-remapped to the comfortable values (the
  floor-first override).

---

## 4. Shell facts (`TopNav`, page containers)

### 4.1 `.kf-topnav`

Sticky top bar, translucent white with blur. `[code-read] src/components/TopNav.css:5-14`.
```
position: sticky; top: 0; z-index: 1000;
background: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(12px);
border-bottom: 1px solid var(--kf-border);
box-shadow: 0 1px 3px rgba(15, 48, 87, 0.04);
```

`.kf-topnav-inner`: max-width 1200px, padding 0 20px, height 56px,
flex-between. `[code-read] src/components/TopNav.css:16-24`.

**Brand.** Logo: 32x32 navy tile at radius 10, Inter 800/16 white glyph,
soft navy shadow. Wordmark: Inter 800/17 navy, letter-spacing -0.3px.
`[code-read] src/components/TopNav.css:35-56`.

**Nav link.** Padding 8x14, radius 10, Inter 700/13. Default color
`#64748b` (slate-500). Hover: bg `#f1f5f9`, color navy. Active: bg
`rgba(37,99,235,0.08)`, color `--kf-blue` (blue-600), SVG opacity 1.
`[code-read] src/components/TopNav.css:72-108`.

**Icon buttons.** 36x36 square with radius 10. Same slate-500 default,
same `#f1f5f9` hover. Bell badge: red (`#ef4444`), 16px pill, Inter 800/10
white, animated `kf-badge-pop` cubic-bezier bounce.
`[code-read] src/components/TopNav.css:120-159`.

**Avatar.** 34x34 circle, 2px `#e2e8f0` border, navy fill, Inter 800/12
white. Hover: border shifts to blue-600, 2px blue glow, scale(1.05).
`[code-read] src/components/TopNav.css:167-190`.

**Separator.** 1px x 24px vertical divider (`--kf-border`) with 8px
horizontal margin. `[code-read] src/components/TopNav.css:110-117`.

### 4.2 Page containers

- `.kf-desktop-wrapper`: max-width **1024px**, padding 24 20 0 20 - the
  historical page shell. `[code-read] src/app/globals.css:48-52`.
- `.kf-body-card`: white card, radius **20px**, box-shadow soft, padding
  24, margin-bottom 40. `[code-read] src/app/globals.css:56-62`.
- `.kf-hero-container`: navy background, radius **14** mobile / **16**
  desktop, height 84 mobile / 96 desktop. Gradient overlay.
  `[code-read] src/app/globals.css:90-106`.
- `.pb-shell` (Playbook): max-width **1024px**, padding 16 14 80.
  `[code-read] src/app/playbook/playbook.css:8-10`.
- SC v2 shell width tokens (SC only): `--sc2-shell-max: 1520px`,
  `--sc2-entry-max: 1240px`. `[code-read] src/app/tokens.css:136-137`.

---

## 5. Component anatomy (from shipped surfaces)

### 5.1 SC day cell (`.sc-daysq-*`) - the atom the whole tool builds on

Container. White surface, 1px `--border-default` border,
`--radius-control` (10) corners, `--text-heading` (n-900) ink. No shadow
by default; box-shadow is the ring system.
`[code-read] src/app/service-calendar/DaySquare.css:18-31`.

Sizes. `.sc-daysq--sm` min-height 44px (mobile-safe tap target). `.sc-daysq--lg`
min-height 96px. `[code-read] src/app/service-calendar/DaySquare.css:49-58`.

Ghost tile (in-period date with no metadata). Dashed 1px `--border-subtle`,
inert, muted numeral. `[code-read] src/app/service-calendar/DaySquare.css:70-82`.

Cell state fills (game-day borders are 1.5px in green-500/700 so game days
read as the visually strongest state). `[code-read] src/app/service-calendar/DaySquare.css:398-402`.
```
.sc-daysq--entered      { background: var(--status-entered-bg); border: 1.5px solid var(--green-700); }
.sc-daysq--needs-entry  { background: var(--status-needs-bg); border-color: var(--status-needs-bd); }
.sc-daysq--overdue      { background: var(--status-overdue-bg); border-color: var(--status-overdue-bd); }
.sc-daysq--upcoming     { background: var(--status-upcoming-bg); border: 1.5px solid var(--green-500); }
.sc-daysq--off          { background: var(--status-off-bg); border-color: var(--status-off-bd); color: var(--text-muted); }
```

Rings (compose without collision on distinct radii - today outermost, then
selected, then focused). Today: 2px navy outer.
Focused today: today ring + inset 1.5px `--accent-sc`.
`[code-read] src/app/service-calendar/DaySquare.css:623-630`.

Hover motion. `translateY(-1px)` on interactive cells with
`--motion-control`; hover disabled under `prefers-reduced-motion`.
`[code-read] src/app/service-calendar/DaySquare.css:37-46`.

### 5.2 SC command chrome (`ops-sc.css`)

`.sc-root` is one elevated white card with `--radius-container-lg` (14)
corners and `--elevation-raised`.
`[code-read] src/app/service-calendar/ops-sc.css:13-17`.

`.sc-hero-admin` (circular lock, top-right of hero). 32x32 circle,
`rgba(255,255,255,0.15)` translucent-white on the navy hero photo, 1px
`rgba(255,255,255,0.3)` border. Focus-visible: 2px white ring.
`[code-read] src/app/service-calendar/ops-sc.css:32-57`. Raw rgba here is
called out in the comments as an accepted exception - the in-hero
translucent-white treatment is a shared local pattern.

`.sc-dropdown-trigger`. 1px `--border-default`, `--radius-control` (10),
`--size-body` 14, `--wt-semibold` 600, `--text-heading` ink, min-width 200,
padding v2 v3 (8 12). Hover: border shifts to `--accent-sc`.
`[code-read] src/app/service-calendar/ops-sc.css:116-119`.

`.sc-dropdown-menu`. `--radius-container` (10), `--elevation-popover`,
z-index `--z-dropdown` (1000), max-height 360, padding v1.
`[code-read] src/app/service-calendar/ops-sc.css:121`.

`.sc-dropdown-item--active`. Background `--accent-sc-subtle` (#E1F5EE),
color `--accent-sc-dark` (#085041), semibold. Item hover: `--accent-sc-tint`
(#F0FDF4). SVG on active tints to `--accent-sc`.
`[code-read] src/app/service-calendar/ops-sc.css:124-126`.

Category tag (`.sc-cat` + `--pdc / --mlb / --milb`). Font `--size-micro` 10,
`--wt-bold` 700, `--radius-cell` (4), padding 3px v2, letter-spacing 0.5px.
`[code-read] src/app/service-calendar/ops-sc.css:134-137`.

Button (`.sc-btn`). Min-height 40 (mobile bumps to >=48), padding v2 v5
(8 20), `--radius-control` (10), `--size-body` 14, `--wt-semibold`. Primary:
bg `--accent-sc`, white text, tinted rgba shadow `0 1px 2px
rgba(15,110,86,0.18)`. Hover: `--accent-sc-dark` with deeper shadow.
Focus-visible: 2px `--accent-sc` outer ring at 2px offset.
`[code-read] src/app/service-calendar/ops-sc.css:170-198`.

Overlay backdrop. `rgba(0,0,0,0.32)` + `blur(1.5px)`, padding v6 (24),
`--z-overlay` (1200), `scOverlayIn` 200ms ease.
`[code-read] src/app/service-calendar/ops-sc.css:142-149`.

Overlay card. Max-width 640, max-height 90vh, white,
`--radius-container-lg` (14), `--elevation-popover`, `scCardUp` 250ms
translateY(16)+scale(.98) entrance. `[code-read] src/app/service-calendar/ops-sc.css:150-158`.

### 5.3 SC v2 scoped theme (feature-gated, `.scv2`)

An entirely parallel `--sc2-*` token family scoped to the SC v2 root.
Sizes are FLUID via `clamp()` between 1024 and 1440 viewports, multiplied
by `--sc2-scale: 0.9` (SC-90 global 10% reduction, 2026-07-21).
`[code-read] src/app/tokens.css:212-226`.

V3 T-table ground layers:
- L0 canvas: `--sc2-canvas: #edeff2` (hoisted to `:root` so `.oh-app`
  ancestor can consume it via `:has(.scv2)`).
  `[code-read] src/app/tokens.css:150`.
- L1 widget surface: `--sc2-surface: #f7f8fa`.
- L2 card: `--sc2-surface-card: #ffffff`.
  `[code-read] src/app/tokens.css:295-296`.

Ink T-table (exactly three levels): `--sc2-ink-strong: #122238` /
`--sc2-ink: #1f2d3d` / `--sc2-ink-muted: #697077`. `--sc2-ink-soft`
retired, aliased to `--sc2-ink` during the sweep.
`[code-read] src/app/tokens.css:307-311`.

Command bar: navy `#1a3050` on `#122238` deep, white text (AAA 13.27),
pill borders `rgba(255,255,255,0.22)`.
`[code-read] src/app/tokens.css:314-321`.

Rail (navy right-hand panel): `#15273c` bg, `#23405f` track, `#2c4867`
border, seven contrast-verified text roles (text 12.86 / strong 14.48 /
item 10.36 / muted 5.98 / subtle 4.92 / section 5.92 / ghost 4.65).
`[code-read] src/app/tokens.css:324-347`.

SC v2 cell states (Option B, T-table, two-signal law - fill + border +
glyph or heavy numeral): entered `#a9dfc0/#5cbf8b/#14532d`, upcoming
`#dff2e7/#b9e2cc/#3e6b52` (light mint), needs `#fcecc7/#e4b45e/#7a5a17`
(heavy numeral `#5c4310`), overdue `#f8d9d3/#dd8a7b/#8a3a2c`, off
`#f1f0ec / transparent / #8f8b80`, away `#e3dded/#544e66`, failed dashed
brick. Rings: today navy `#1a3050`, selected green `#2f7d4f`, focus
navy `#1a3050`. `[code-read] src/app/tokens.css:361-411`.

SC v2 radii: cell 6 / control 9 / container 11 / card 12 / tile 8 /
modal 14 / pill 9999. `[code-read] src/app/tokens.css:245-270`.

SC v2 elevation trio: `--sc2-el-widget` (widget over canvas) /
`--sc2-el-card` (L2 at rest) / `--sc2-el-hover` (one tier up) /
`--sc2-el-inset` (half-step inset for OV-3 Wave 5a inner-card region).
`[code-read] src/app/tokens.css:476-483`.

### 5.4 Playbook doc reader (OPD)

Cover title. Oswald 36/700 navy, letter-spacing -0.2px, line-height 1.1,
margin bottom 8. `[code-read] src/app/playbook/playbook.css:2235-2243`.

Body H1. Oswald 26/700 navy with a `SECTION 01`-style eyebrow (Oswald
11/600 uppercase, 1.5px tracking, counter-reset per section). H1 has an
1.5pt sky-blue underline (`#7DB9D5`).
`[code-read] src/app/playbook/playbook.css:2279-2301`.

Body H2. Inter 18/700 navy, 0.75pt sky-blue underline. Body H3. Inter
15/700 navy, 0.5pt sky-blue underline. Body copy. Inter 15, line-height
1.6, `#1f2937`. `[code-read] src/app/playbook/playbook.css:2303-2321`.

Blockquote callout. 3px left border in `--kf-playbook-teal` (#0F6E56)
on `#f8fafc` wash, radius 4. Critical variant swaps to red `#B53030`
border and `#FCE4E4` wash. `[code-read] src/app/playbook/playbook.css:2331-2343`.

Code. JetBrains Mono 13, `#f1f5f9` background, radius 4.
`[code-read] src/app/playbook/playbook.css:2324-2330`.

### 5.5 Shared `.oh-*` utility layer (from `docs/CONVENTIONS.md`)

Module-prefixed CSS is the rule (`pp-`, `oh-vp-`, `oh-inv-mgmt-`, `sc-`,
`kf-news-`, `pb-`). Shared utility prefixes cross modules deliberately:
`oh-tool-`, `oh-btn-`, `oh-modal-`, `oh-input-`, `oh-popover-`,
`oh-widget-`, `oh-font-`, `oh-grey-`, `oh-mustard-`. Known collision:
`oh-inv-` is shared between Inventory and Invoice Capture (documented in
`GOTCHAS.md`). `[doc-read] docs/CONVENTIONS.md` (§CSS namespace prefixes).

---

## 6. Layout facts

- Container widths.
  - Legacy page shell: `.kf-desktop-wrapper` max-width **1024px**.
  - Top nav inner: **1200px**.
  - Playbook shell: **1024px**.
  - SC v2 shells (scoped): **1520px** overview / **1240px** entry.
- Page ground. `--surface-page` = `--n-100` = `#F4F2EC` (warm cream). White
  surfaces sit on the cream and read as the "card plane."
- Padding rhythm. Body card padding 24; hero content padding 10x18 mobile
  / 14x24 desktop; SC header padding v3 v4 (12 16); SC daysq --lg padding
  v2 v2 (8 8).
- Mobile handling. `<1024px` viewports get the Comfortable value set
  regardless of module. Hero drops from 96 to 84px, hero radius from 16
  to 14. `.sc-hero-asof` hides at `<=767px`.
  `[code-read] src/app/globals.css:1640-1662`,
  `src/app/service-calendar/ops-sc.css:111-113`.
- Sticky affordances. `.kf-topnav` sticks at top:0; SC hero admin lock
  and as-of pill are absolutely positioned within the hero (not sticky).

---

## 7. Sous fit notes (observations, not decisions)

Ten anchored observations on how Sous can read as an Ops Hub tool. These
are observations from the shipped design language; decisions are Kevin's.

1. **Sous should not invent a new page shell.** The Ops Hub has one
   sticky nav (`.kf-topnav`, 56px, translucent white on blur) and a
   1024px page container. Sous rendered inside that shell reads as a
   sibling to Playbook and News. Full-viewport chat UIs will feel like a
   separate product.
2. **Module prefix + tool accent.** Every module owns a CSS prefix
   (`pp-`, `sc-`, `pb-`) and one Tier-3 accent slot. If Sous earns tool
   status, the natural pattern is a new `--accent-sous` at whatever hue
   Kevin picks, and a `sa-` (or `sous-`) prefix on every class. Nothing
   in Sous should ship a raw hex.
3. **The composition Sous should mirror.** The SC card recipe -
   `.sc-root` = white surface + `--radius-container-lg` (14) +
   `--elevation-raised` on a warm-cream page - is the canonical
   "tool card." A Sous conversation surface built to that recipe will
   drop into the Ops Hub without a visual seam.
4. **Answer chrome should borrow the Playbook reader's typography.**
   Playbook doc reader is the shipped long-form-reading treatment (Inter
   body at 15/1.6, navy `#1f2937` ink, sky-blue rules under headings).
   Any long assistant answer that renders as prose belongs in that voice,
   not chat-bubble voice.
5. **Source chips deep-link into Playbook.** Sources are OPD documents
   with `docId` slugs. A "cite chip" mirroring `.pb-fullpage-id`
   (JetBrains Mono, navy, weight 700) will look native and confirm to
   the user that the source is a first-class Ops Hub artifact.
6. **State + response signaling uses the status family.** Loading,
   partial answer, error, and success states already have five-slot
   status tokens (`--status-*-bg / -bd / -fg / -subtle / -strong`).
   Reusing these means Sous inherits the AA-verified color pairs and
   never invents a fifth status hue.
7. **Focus behavior is load-bearing.** The Ops Hub uses a 2px navy
   focus-visible ring at 2px offset on every interactive element. SC
   further uses a 2px `--accent-sc` ring for its tool-scoped focus. Sous
   should pick one and be consistent - either the app-wide navy or a
   tool-scoped `--accent-sous` at the same width and offset.
8. **Density-mode assignment matters.** Sous is a single-task
   conversational surface. Per the design principles, single-task work
   takes Comfortable mode. It should ship `data-density="comfortable"`
   on its root and rely on the mobile override to keep it comfortable
   under 1024px too.
9. **Motion budget is small and honest.** The token layer sets three
   durations (120 / 180 / 280ms) and zeros them under
   `prefers-reduced-motion`. Streaming tokens is inherently motion-heavy;
   Sous should respect the reduced-motion cutoff by ceasing any
   non-content animation (cursor blink, skeleton shimmer, indicator
   pulse), not the stream itself.
10. **Amber is a signaling accent, not a chat accent.** The amber accent
    is contrast-split for a reason (white text fails on amber-500). If
    Sous needs amber (warning banner, throttled state), it uses
    `--accent-solid` for white-on-amber and `--accent-text` for amber
    text on light. It should never introduce a fifth amber to sit next
    to the four already tokenized.

---

## 8. Doc-vs-code drift (P2 findings per project rules)

- **P2 - Mulish still on `body`.** `docs/DESIGN_TOKENS.md:92` says
  "Mulish is reserved for the print/PDF pipeline and is not part of the
  screen token set." `src/app/globals.css:41` sets
  `body { font-family: 'Mulish', sans-serif }`, and Mulish is still
  applied at globals.css:423, 1333, 1451, 1463, 1511, 1550. The claim
  and the code disagree. Recommendation: flip `body` to `--font-body`
  (Inter) and sweep the residual `Mulish` calls.
- **P2 - Two parallel scales for `--type-*` and `--space-1..6`.**
  `docs/DESIGN_TOKENS.md:126-129` labels this a temporary migration
  note. `src/app/globals.css:1596-1662` still ships the legacy scale
  under `[data-density]` blocks; they win by specificity. Any new
  surface (Sous included) should consume the modern
  `--space-stack / --space-card-pad / --space-inline / --control-height`
  semantics from `tokens.css:117-118` and avoid `--type-body` / `--space-4`
  in the legacy sense.
- **P2 - STD-001 v1.2 header vs `DESIGN_TOKENS.md`.**
  `src/app/globals.css:1-3` states the type standard is "Oswald (display)
  + Inter (body)." `docs/DESIGN_TOKENS.md:91-92` states the screen font
  set is Inter only. Both are true in the shipped code (Oswald only in
  Playbook), but the two docs frame the boundary differently. Small
  language pass would help.
- **P2 - Density mode assignments.** `docs/DESIGN_SYSTEM_REFERENCE.md`
  lists Vendor Portal, Inventory Manager, SC month admin, Invoice
  Capture as Density defaults. This audit did not verify each module's
  emitted `data-density` attribute; a follow-up audit could confirm
  parity module-by-module.

---

## 9. Completeness map (BUILD_ACCURACY_PROTOCOL)

Files read verbatim (`[code-read]`):
- `src/app/tokens.css` (all 589 lines)
- `src/app/globals.css` (:1-200 verbatim + :1580-1662 verbatim + targeted
  greps for `font-family`, `Oswald`, `Bebas`, `--type-*`, `--space-*`,
  `--radius-*`)
- `src/components/TopNav.css` (:1-200 verbatim + targeted greps)
- `src/app/service-calendar/ops-sc.css` (:1-200 verbatim)
- `src/app/service-calendar/DaySquare.css` (:1-120 verbatim + targeted
  state grep :376-448, :623-630)
- `src/app/playbook/playbook.css` (:2225-2343 verbatim + targeted greps
  for font-family / max-width / padding)
- `src/lib/print/assets.js` (targeted grep for Bebas Neue)

Docs read verbatim (`[doc-read]`):
- `docs/DESIGN_PRINCIPLES.md` (all 207 lines)
- `docs/DESIGN_SYSTEM_REFERENCE.md` (all 313 lines, prior session)
- `docs/DESIGN_REVIEW_PERSONA.md` (all 126 lines)
- `docs/CONVENTIONS.md` (§CSS namespace prefixes, prior session)
- `docs/DESIGN_TOKENS.md` (all 129 lines)
- `CLAUDE.md` (referenced for safety rules, not quoted)

Not read (out of D0 scope; deferred to a future audit if Kevin asks):
- Per-module density-mode audit (Vendor Portal / Invoice Capture / etc.)
- People Portal Action Center split-panel anatomy
- Directory flip-card / Team Directory anatomy
- Home dashboard launchpad cards
- `.oh-*` shared-utility CSS bodies (referenced from
  `docs/CONVENTIONS.md` but not enumerated file-by-file)
- Full SC v2 CSS files under `src/app/service-calendar/v2/` (token
  usage was audited from `tokens.css` only)
- Any Sous route or component (would be forward-looking; D0 is a read
  of the Ops Hub only)

---

*Read-only extraction. No code changes. This document is D0 input for
the Sous design direction and is not itself a spec.*

---

# Appendix A - Measured values (2026-07-28)

> **Purpose.** Replace recalled or paraphrased design values with
> measurements taken directly from the source tree so the OPD reskin and
> Sous D0 work off numbers, not memory. Every value carries a `[code-read]`
> file:line. Runtime-computed values are shown as expression AND arithmetic
> at a viewport of 1440px with `--sc2-scale: 0.9`. Where a value cannot be
> determined statically it is called out - not estimated.
>
> Method note. SC v2 fluid sizes are `calc(clamp(min, calc(intercept +
> slope * vw), max) * scale)`. At viewport 1440 the linear branch equals
> the max value (slopes solved for value = max at 1440). So each token's
> effective value at 1440 is `max * scale`. That is the arithmetic path
> used below.

## A.1 Shell and layout (measured)

### SC v2 shell tokens

- `--sc2-shell-max: 1520px` (overview + drill two-pane shells).
  `[code-read] src/app/tokens.css:136`.
- `--sc2-entry-max: 1240px` (DayEntryV2 overlay - narrower because the
  modal is a focused billing surface, not a landing dashboard).
  `[code-read] src/app/tokens.css:137`.
- `--sc2-mobile-bar-h: 60px` (read-surface footer).
  `[code-read] src/app/tokens.css:524`.
- `--sc2-mobile-footer-h: 116px` (entry-surface footer: bar + Confirm CTA
  stacked). `[code-read] src/app/tokens.css:525`.
- `--sc2-canvas: #edeff2` (L0 canvas, hoisted to `:root` so `.oh-app`
  ancestor can consume it via `:has(.scv2)`).
  `[code-read] src/app/tokens.css:150`.
- SC v1 chrome bar and card sit inside `.sc-root`: `background:
  var(--surface-card)` (white), `border-radius: var(--radius-container-lg)`
  (14), `box-shadow: var(--elevation-raised)` (`--sh-md`).
  `[code-read] src/app/service-calendar/ops-sc.css:13-17`.

### OPD (Playbook) shells

- `.pb-shell` - the browsing shell: `max-width: 1024px; margin: 0 auto;
  padding: 16px 14px 80px`. `[code-read] src/app/playbook/playbook.css:8-10`.
- `.pb-fullpage-wrap` - the doc-reader shell: `max-width: 880px; margin:
  0 auto; padding: 16px 16px 80px; font-family: 'Inter', sans-serif;
  color: var(--kf-navy)`. `[code-read] src/app/playbook/playbook.css:2150-2156`.
- `.pb-fullpage-article` (the reader white card that holds the prose):
  `background: white; border-radius: 16px; border: 1px solid
  var(--kf-border); padding: 32px 36px; box-shadow: 0 2px 8px
  rgba(15, 48, 87, 0.04)`.
  `[code-read] src/app/playbook/playbook.css:2205-2211`.
  Mobile (max-width 768px): article padding drops to `20px 18px`, radius
  drops to `12px`. `[code-read] src/app/playbook/playbook.css:2402-2410`.

### Global shell

- `.kf-desktop-wrapper`: `max-width: 1024px; margin: 0 auto; padding:
  24px 20px 0 20px`. `[code-read] src/app/globals.css:48-52`.
- `.kf-topnav-inner`: `max-width: 1200px; padding: 0 20px; height: 56px;
  display: flex; align-items: center; justify-content: space-between`.
  Mobile (max-width `<=767px` per the query below): `padding: 0 12px;
  height: 52px`. `[code-read] src/components/TopNav.css:16-24, 477`.
- `.kf-topnav` outer: `position: sticky; top: 0; z-index: 1000; background:
  rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px); border-bottom:
  1px solid var(--kf-border); box-shadow: 0 1px 3px rgba(15, 48, 87,
  0.04)`. `[code-read] src/components/TopNav.css:5-14`.

### OPD hero total vertical cost (Playbook browsing shell)

`.pb-hero` block. `[code-read] src/app/playbook/playbook.css:90-98, 236-244`.
- Padding: mobile `20px 20px 14px`; `>=640px` bumps to `24px 28px 18px`.
- Min-height: `200px` (drives the empty-photo-well behavior).
- Content classes stacked inside: `.pb-hero-tag` (title, 26px mobile /
  36px `>=640px`), `.pb-hero-sub` (13px mobile / 15px `>=640px`, `margin:
  0 0 12px`), then `.pb-search-row` (48px search + Ask SousAI stub, `gap:
  10px`). Bottom accent rule: 3px teal via `::after`.
- Total vertical cost at `>=640px` = padding-top 24 + title h1 (~40 line
  box: 36px * 1.1 lead ~= 40 rounded) + `.pb-hero-tag` bottom margin 4 +
  subtitle line box 15 * 1.4 ~= 21 + subtitle bottom margin 12 + search
  row 48 + padding-bottom 18 + hero bottom margin 16 = **~183px content
  cost**. Because `.pb-hero` sets `min-height: 200px`, the actual painted
  hero always occupies at least 200px + 16px bottom margin = **216px** in
  the vertical rhythm before mobile queries. Mobile (`<640px`): padding
  20/20/14, title box ~29 (26 * 1.1), sub box ~18 (13 * 1.4) + 12,
  search row still 48, sum ~131 vs 200 min = **216px** still.

### OPD reader prose column effective width + CPL

- Reader shell inner width at desktop: `.pb-fullpage-wrap` = 880 outer,
  padding 16 each side, so inner = **848px**.
- Article inner text width at desktop: 848 - (article padding 36 * 2) =
  **776px**. `[code-read] src/app/playbook/playbook.css:2150-2156, 2205-2211`.
- Body typography: `.pb-fullpage-body { font-family: 'Inter'; font-size:
  15px; line-height: 1.6; color: #1f2937 }`.
  `[code-read] src/app/playbook/playbook.css:2270-2278`.

**Characters-per-line, method + result.** Inter's mean glyph advance for
mixed-case English body copy tracks around 0.5 to 0.55 em (Latin letters
of the "en" family, no italics). Method: take mid-range 0.52em * 15px =
7.8px per character. CPL desktop = 776 / 7.8 = **~99 characters**. Range
lookups at the two edges: 0.5em -> 15/2 = 7.5, CPL = **103**; 0.55em ->
8.25, CPL = **94**. All three are well above the 66-75-character
comfortable-reading window (Bringhurst, TypeWolf). Mobile (max-width 768):
outer 375, wrap inner = 375 - 32 = 343; article inner = 343 - 36 = 307;
body font drops to 14 at `<=768px`. Same method: 307 / (0.52 * 14) =
**~42 characters** - which is the opposite failure mode (below the
comfortable floor of 45-50). **The desktop reader runs long, the mobile
reader runs short.** Neither is a typo; both are values in the code today.

### Sous panel (coming-soon shell inside Playbook slide-over)

- `.pb-sous-panel`: fixed right, top-to-bottom, `width: 100%; max-width:
  480px; background: white; z-index: 4001; box-shadow: -8px 0 32px
  rgba(0, 0, 0, 0.18); animation: pb-slide-in 0.25s cubic-bezier(0.4, 0,
  0.2, 1)`. Mobile `<=1023px` widens to `max-width: 100vw`.
  `[code-read] src/app/playbook/playbook.css:2006-2022`.
- `.pb-sous-head`: header row `padding: 14px 16px; border-bottom: 1px
  solid var(--kf-border); flex-shrink: 0`.
  `[code-read] src/app/playbook/playbook.css:2023-2030`.
- `.pb-sous-title h2`: Inter 16 (weight not measured here; next line
  extends past the read window). `[code-read] src/app/playbook/playbook.css:2037-2039`.

### Coming-soon inline stub inside SlideOverReader

`.pb-sousai` - the "Ask SousAI about this doc" affordance rendered inside
the slide-over reader (`SlideOverReader.js:362-374`). Metrics:
`display: flex; padding: 10px 14px; background: rgba(15, 110, 86, 0.04)`
(teal wash at 4% alpha); `border: 1px dashed var(--kf-playbook-teal);
border-radius: 10px; cursor: not-allowed; margin-bottom: 18px`.
`[code-read] src/app/playbook/playbook.css:1678-1690`.

## A.2 SC report's *(recalled)* items - settled

### Card shadow claim (`0 3px 10px rgba(21,57,104,.08)`)

That shadow value exists in code exactly once, on the SC v2 accent-rail
card: `.sc-rail-accent-card { box-shadow: 0 3px 10px rgba(21, 57, 104,
0.08) }`. `[code-read] src/app/service-calendar/v2/accentRail.css:84`.

That is NOT the SC main card shadow. The main SC container `.sc-root`
consumes `--elevation-raised`, which resolves to `--sh-md: 0 4px 12px
rgba(15,23,42,0.08)`. `[code-read] src/app/tokens.css:45, 111`,
`src/app/service-calendar/ops-sc.css:16`.

The report treats accent-rail card shadow as if it were the general SC
card shadow; it is a specialized rail component's shadow. **Correct
values:**
- SC main card (`.sc-root`): `--sh-md` = `0 4px 12px rgba(15, 23, 42,
  0.08)` [`[code-read] src/app/tokens.css:45`].
- SC v2 accent rail card: `0 3px 10px rgba(21, 57, 104, 0.08)` [`[code-read]
  src/app/service-calendar/v2/accentRail.css:84`].
- SC v2 tiered T-table shadows:
  - widget over canvas (`--sc2-el-widget`): `0 2px 8px rgba(18,34,56,0.08),
    0 12px 32px rgba(18,34,56,0.06)`.
  - L2 card rest (`--sc2-el-card`): `0 1px 3px rgba(18,34,56,0.08),
    0 2px 8px rgba(18,34,56,0.05)`.
  - L2 card hover (`--sc2-el-hover`): `0 2px 6px rgba(18,34,56,0.10),
    0 6px 16px rgba(18,34,56,0.07)`.
  - Inset half-step (`--sc2-el-inset`): `0 1px 2px rgba(18,34,56,0.04),
    0 1px 4px rgba(18,34,56,0.03)`.
  `[code-read] src/app/tokens.css:476-483`.

### SC font family stack

Two-track reality:
- SC v1 CSS applies `font-family: inherit` on `.sc-daysq` and most
  `.sc-*` controls. `[code-read] src/app/service-calendar/DaySquare.css:25,
  src/app/service-calendar/ops-sc.css:116, 123, 181, 245`. The inherit
  chain resolves via `.oh-app` -> `--oh-font-body: "Mulish",
  -apple-system, sans-serif`.
  `[code-read] src/app/ops/css/ops-shared.css:30, 47`.
- SC v2 explicitly sets `font-family: var(--sc2-font-ui)` on the v2 root:
  `.sc-root.scv2 { font-family: var(--sc2-font-ui) }`, and `--sc2-font-ui:
  var(--font-ui)` = Inter.
  `[code-read] src/app/service-calendar/v2/overview.css:165,
  src/app/tokens.css:273`.

**Practical read.** SC v1 renders in Mulish (via `.oh-app` inheritance).
SC v2 renders in Inter (explicit set). This is one more instance of the
existing "Mulish on `body`" P2 already flagged in the D0 audit.

### Ops shell body vs head font stacks

- `--oh-font-body: "Mulish", -apple-system, sans-serif`.
- `--oh-font-head: "Inter", -apple-system, sans-serif`.
- Consumers: `.oh-app`, `.oh-tool-bar`, `.oh-card`, `.oh-modal`,
  `.oh-input`, `.oh-widget-body` etc. `[code-read] src/app/ops/css/ops-shared.css:30-31, 47, 150, 260, 271, 278, 295, 446, 555, 629`.

## A.3 Type, exact

### SC v1 primitive sizes (from `:root` `--size-*`)

Micro 10 / caption 12 / body 14 / subhead 17 / h3 20 / h2 24 / h1 29 /
display 35. `[code-read] src/app/tokens.css:33-34`.
Weights: 400 / 500 / 600 / 700 / 800.
`[code-read] src/app/tokens.css:35`.
Leading: tight 1.1 / snug 1.25 / normal 1.5.
`[code-read] src/app/tokens.css:36`.

### SC v2 Standard T-table scale under `--sc2-scale: 0.9`

Standard values (T-table, F5 correction): micro 11 / caption 12 / body 14
/ subhead 15 / h3 18 / h2 20 / h1 24 / display 30 / rail-total 30.
`[code-read] src/app/tokens.css:571-579`.
Controls: `--sc2-control-h: 36px * scale`, `--sc2-control-h-icon: 32px *
scale`. `[code-read] src/app/tokens.css:581-582`.

Effective values at `--sc2-scale: 0.9` (each is `base * 0.9`):
- micro 11 -> **9.9px**
- caption 12 -> **10.8px**
- body 14 -> **12.6px**
- subhead 15 -> **13.5px**
- h3 18 -> **16.2px**
- h2 20 -> **18px**
- h1 24 -> **21.6px**
- display 30 -> **27px**
- rail-total 30 -> **27px**
- control h 36 -> **32.4px**
- control h icon 32 -> **28.8px**

The fluid clamps at `:root` (`.scv2` :219-226) resolve at viewport 1440
to the max branch of each clamp AND are multiplied by scale. Standard
overrides at :571-582 pin explicit values above the fluid clamp for
consistency; the effective values above come from that Standard block.

Line heights consumed as literals in components stay at whatever the
component declared (owner-noted ratio drift at 0.9).
`[code-read] src/app/tokens.css:558-571`.

### OPD rendered sizes/weights (screen)

Cover title + shell (Playbook browsing):
- `.pb-hero-tag`: Inter 800, mobile 26px / letter-spacing -0.4px;
  `>=640px` 36px / -0.6px. `[code-read] src/app/playbook/playbook.css:141-148, 240`.
- `.pb-hero-sub`: 13px mobile / 15px `>=640px`, line-height 1.4, color
  `rgba(255,255,255,0.78)`, max-width 560px.
  `[code-read] src/app/playbook/playbook.css:149-155, 244`.
- `.pb-sous-btn` (Ask SousAI CTA): Inter 700 13px, letter-spacing 0.1px,
  min-height 48, padding 12/16, radius 12, teal fill white text.
  `[code-read] src/app/playbook/playbook.css:203-220`.
- `.pb-search-bar`: white, radius 12, padding 12/14, shadow `0 4px 14px
  rgba(0,0,0,0.18)`. `[code-read] src/app/playbook/playbook.css:167-177`.
- `.pb-search-input`: Inter 14, no border. `[code-read] src/app/playbook/playbook.css:179-188`.

Card grid + doc card:
- `.pb-card`: white, `border: 1px solid var(--kf-border)`, `border-radius:
  12px`, `padding: 14px 14px 12px`, `box-shadow: 0 1px 2px rgba(15, 48,
  87, 0.04)`, `min-height: 184px`, entrance `pb-card-in 200ms ease-out`.
  `[code-read] src/app/playbook/playbook.css:937-967`.
- Hover-alive: `translateY(-2px); box-shadow: 0 6px 14px rgba(15, 48, 87,
  0.1); border-color: var(--kf-playbook-teal)`.
  `[code-read] src/app/playbook/playbook.css:981-985`.
- Recessed: `opacity: 0.55; filter: saturate(0.7)`.
  `[code-read] src/app/playbook/playbook.css:992-1001`.
- Focus-visible: `outline: 2px solid var(--kf-playbook-teal); outline-offset:
  2px`. `[code-read] src/app/playbook/playbook.css:1003-1006`.
- `.pb-card-title`: Inter 800 14px navy, line-height 1.3.
  `[code-read] src/app/playbook/playbook.css:1114-1121`.
- `.pb-card-line`: 12.5px, `#64748b`, line-height 1.4, 2-line clamp.
  `[code-read] src/app/playbook/playbook.css:1122-1131`.
- `.pb-class-chip`: Inter 10/700, uppercase, letter-spacing 0.3px, padding
  2/7, radius 5, four family tints (gov navy / proc teal / tool sand /
  ref manila) at 10% alpha over white.
  `[code-read] src/app/playbook/playbook.css:1037-1055`.
- `.pb-class-chip--lg` (slide-over + reader header variant): 11/700,
  padding 3/9, letter-spacing 0.4px. `[code-read] src/app/playbook/playbook.css:1058-1063`.
- `.pb-status-pill`: Inter 10/700, padding 3/9, radius 999px, letter-spacing
  0.3px, border 1px transparent.
  `[code-read] src/app/playbook/playbook.css:1143-1150`.
- `.pb-status-pill--lg`: 11px, padding 4/11, letter-spacing 0.4px.
  `[code-read] src/app/playbook/playbook.css:1162-1166`.

Reader (`/playbook/d/[docId]`):
- `.pb-fullpage-title`: Oswald 36/700 navy, letter-spacing -0.2px,
  line-height 1.1. Mobile 22px.
  `[code-read] src/app/playbook/playbook.css:2235-2243, 2407`.
- `.pb-fullpage-cardline`: Inter 15 `#475569` line-height 1.5.
  `[code-read] src/app/playbook/playbook.css:2244-2250`.
- `.pb-fullpage-meta`: Inter 12 `#6B7785`.
  `[code-read] src/app/playbook/playbook.css:2251-2259`.
- `.pb-fullpage-id`: JetBrains Mono 700 navy.
  `[code-read] src/app/playbook/playbook.css:2260-2264`.
- `.pb-fullpage-head` bottom rule: `border-bottom: 1.5px solid #7DB9D5;
  margin-bottom: 28px; padding-bottom: 20px`.
  `[code-read] src/app/playbook/playbook.css:2218-2222`.
- `.pb-fullpage-body`: Inter 15, line-height **1.6**, `#1f2937`.
  Mobile 14. `[code-read] src/app/playbook/playbook.css:2270-2278, 2408`.
- H1 in body: Oswald 26/700 navy, `margin: 36px 0 10px`, letter-spacing
  -0.2px, line-height 1.1, `padding-bottom: 8px; border-bottom: 1.5pt
  solid #7DB9D5`. `[code-read] src/app/playbook/playbook.css:2279-2290`.
- H1 eyebrow (`::before`): Oswald 11/600 uppercase, letter-spacing 1.5px,
  navy, `SECTION 01` via counter.
  `[code-read] src/app/playbook/playbook.css:2291-2301`.
- H2 in body: Inter 18/700 navy, `margin: 28px 0 8px`, `border-bottom:
  0.75pt solid #7DB9D5; padding-bottom: 4px`.
  `[code-read] src/app/playbook/playbook.css:2303-2311`.
- H3 in body: Inter 15/700 navy, `margin: 20px 0 6px; border-bottom:
  0.5pt solid #7DB9D5; padding-bottom: 3px`.
  `[code-read] src/app/playbook/playbook.css:2312-2320`.
- Paragraph margin: `10px 0`.
  `[code-read] src/app/playbook/playbook.css:2321`.
- List margin: `10px 0 10px 24px`.
  `[code-read] src/app/playbook/playbook.css:2322`.
- Code: JetBrains Mono 13, `background: #f1f5f9`, `padding: 1px 5px`,
  `border-radius: 4px`.
  `[code-read] src/app/playbook/playbook.css:2324-2330`.
- Blockquote base: `margin: 14px 0; padding: 12px 16px; border-left: 3px
  solid var(--kf-playbook-teal); background: #f8fafc; border-radius: 4px`.
  `[code-read] src/app/playbook/playbook.css:2331-2337`.
- Callout variants:
  - `.callout` bumps left border to 4px. `[code-read] src/app/playbook/playbook.css:2338-2340`.
  - `.callout-critical`: `border-left-color: #B53030; background: #FCE4E4`.
    `[code-read] src/app/playbook/playbook.css:2341-2344`.
  - `.callout-anchor`: `border-left-color: var(--kf-navy); background:
    #C4E3E8`. `[code-read] src/app/playbook/playbook.css:2345-2348`.
  - `.callout-note`: `border-left-color: #2563eb; background: #eff6ff`.
    `[code-read] src/app/playbook/playbook.css:2349-2352`.
  - `.callout-warning`: `border-left-color: #d97706; background: #FBEFD0`.
    `[code-read] src/app/playbook/playbook.css:2353-2356`.
- Table: `border-collapse: collapse; width: 100%; margin: 14px 0;
  font-size: 14px`. Cells: `border: 1px solid var(--kf-border); padding:
  8px 10px; text-align: left; vertical-align: top`. TH: `background:
  #f8fafc; font-weight: 700; color: var(--kf-navy)`.
  `[code-read] src/app/playbook/playbook.css:2357-2374`.

### Body line-height, both products

- OPD reader body (`.pb-fullpage-body`): `line-height: 1.6`.
  `[code-read] src/app/playbook/playbook.css:2273`.
- SC v1: token roles `--lead-tight 1.1 / --lead-snug 1.25 / --lead-normal
  1.5`; consumers apply per-atom (e.g. `.sc-daysq-date` uses `--lead-tight`).
  `[code-read] src/app/tokens.css:36, src/app/service-calendar/DaySquare.css:115`.
- SC v2 body (from Standard T-table): body 14/20 = 1.43; caption 12/16 =
  1.33; the Standard block declares "Line-heights stay on the 4px grid".
  `[code-read] src/app/tokens.css:544-546`.

## A.4 Color inventory for the sweep

### `#0F6E56` (or its token) - action-vs-status classification

Every occurrence of the teal-green hex plus every token consumer.

- Raw hex declarations (the roots):
  - `--kf-playbook-teal: #0F6E56` [`[code-read] src/app/globals.css:32`].
  - `--kf-playbook-teal-dark: #0a5a45` [`[code-read] src/app/globals.css:33`].
  - `--kf-playbook-teal-light: #d4ebe2` [`[code-read] src/app/globals.css:34`].
  - `--accent-playbook: #0F6E56` [`[code-read] src/app/tokens.css:79`].
  - `--accent-sc: #0F6E56` [`[code-read] src/app/tokens.css:81`].
  - `--accent-sc-dark: #085041` [`[code-read] src/app/tokens.css:81`].
  - `--accent-sc-subtle: #E1F5EE` [`[code-read] src/app/tokens.css:81`].
  - `--accent-sc-tint: #F0FDF4` [`[code-read] src/app/tokens.css:81`].

- Consumer counts (`grep -rn "accent-sc\|kf-playbook-teal" src/`):
  - `--kf-playbook-teal*` (OPD only): **75+ usage sites** in
    `src/app/playbook/playbook.css` and `src/app/playbook/admin/admin.css`.
    Dominant intents: focus rings (`outline: 2px solid`), hover borders,
    active pill fill, chip active state, blockquote left-rail, dashed
    coming-soon border, teal accents on navy hero.
  - `--accent-sc*` (SC + its submission toast): **141 CSS-line hits**
    across `src/app/service-calendar/`. Dominant intents: focus rings,
    dropdown active bg, selected-cell inset ring, primary button fill
    (`.sc-btn--primary`), submission-toast gradient, chrome bar today
    CTA, back-link tint.

- Action-vs-status classification.
  - **Action / identity** (both surfaces): focus rings, primary buttons,
    hover borders, active nav / today CTA. The shared `#0F6E56` reads as
    the ops-hub operator-green.
  - **Status**: neither OPD nor SC uses `#0F6E56` for status. Status is
    always drawn from `--status-*` (SC) or the `.pb-status-pill--*`
    family (OPD).

- **Green-collision sweep count.** Rough gauge for scoping the sweep -
  the sweep touches everywhere OPD + SC currently paint operator-green
  and would need to keep that meaning in the reskin. Total unique
  consumers: **~216 lines** across two surfaces (75 OPD + 141 SC),
  before de-duplicating same-selector rules. That is the sweep size.

### Both ambers

- `#D97706` (`--amber-500`) - the canonical amber.
  Declarations:
  - `--amber-500: #D97706` [`[code-read] src/app/tokens.css:15`].
  - `--kf-ops-amber: #d97706` (Playbook admin) [`[code-read] src/app/playbook/admin/admin.css:34`].
  - `--oh-mustard: #d97706` (ops shell) [`[code-read] src/app/ops/css/ops-shared.css:17`].
  Consumer surfaces: News feed (bookmark), Playbook reader (callout-warning
  border), Playbook admin, Ops shared header/tickets, Ops Vendor Portal
  (heavy identity use), People Portal (pending chip), Financial tool,
  Incident-reminder email, home dashboard accent (`src/app/page.js:181
  accent: "#d97706"`). Also `nf-` news feed (globals.css:1004-1005,
  1153-1154, 1183).
- **`#D9892F` does not appear anywhere in the tree.** `grep -rn
  "D9892F\|d9892f\|D9890F\|d9890f" src/` returns zero hits. If a report
  cited that hex, it is a fabrication of memory - not present in code.
- Related ambers/mustards in globals (not the ops accent):
  - `--kf-mustard: #fbbf24` (bright yellow) [`[code-read] src/app/globals.css:21`].
  - `--kf-mustard-light: #fffbeb` [`[code-read] src/app/globals.css:22`].
  - `--kf-mustard-text: #92400e` [`[code-read] src/app/globals.css:23`].
  - `--kf-bronze: #b45309` [`[code-read] src/app/globals.css:27`].
  - `--kf-bronze-light: #fffbeb` [`[code-read] src/app/globals.css:28`].
  - `--oh-mustard-dark: #b45309` (implied from ops-vendor.css:2212).

### Page-ground usage map

Which route sits on which ground:
- `--surface-page: var(--n-100) = #F4F2EC` (warm cream) - token-declared.
  `[code-read] src/app/tokens.css:23, 62`. Consumers: any surface that
  reads `--surface-page`. Also embedded as raw hex in
  `src/lib/sousai/reports/formatDigests.js:228, 234` (report HTML).
- `--kf-bg: #f0f4f8` (cool grey-blue) - declared at
  `[code-read] src/app/globals.css:17` and applied by `body { background:
  var(--kf-bg) }` at `[code-read] src/app/globals.css:42`. **This is the
  actual site-wide page ground** because it is set on `body`. Also used
  by Directory pill fills (directory.css:594, 703, 839, 852) and People
  Portal skeleton bg (people.css:1680, 1805).
- `--n-50: #FAF9F5` (warm off-white) - the SC "sunken" surface.
  `[code-read] src/app/tokens.css:23, 62`. Consumer: `--surface-sunken`
  role.
- `--sc2-canvas: #edeff2` (cool grey L0) - SC v2 only, scoped via
  `.oh-app:has(.scv2) { background: var(--sc2-canvas) }`.
  `[code-read] src/app/tokens.css:150`,
  `src/app/service-calendar/v2/overview.css:78-102`.
- `--sc2-surface-page: #e8e3d8` - a legacy warm-cream SC v2 surface,
  labeled "legacy; scheduled for retirement in downstream V3 sweeps".
  `[code-read] src/app/tokens.css:297`.

**Practical read.** The site-wide page ground is `#f0f4f8` (cool
grey-blue), NOT `#F4F2EC` (warm cream). The token `--surface-page` at
`#F4F2EC` is defined but the `body` background overrides it globally via
`--kf-bg`. This is another P2 doc-vs-code drift: the token system's
`--surface-page` intent is warm cream, but the shipped page ground is
cool grey-blue.

## A.5 Spacing and radius ladders

### SC v1 space primitives (from tokens.css)

`--space-1 4 / --space-2 8 / --space-3 12 / --space-4 16 / --space-5 20
/ --space-6 24 / --space-7 32 / --space-8 40`.
`[code-read] src/app/tokens.css:39`.

### SC v2 fluid space at scale 0.9 (effective values at viewport 1440)

Each token is `calc(clamp(min, calc(intercept + slope * vw), max) *
--sc2-scale)`. At 1440 the linear branch equals the max; effective =
max * 0.9. `[code-read] src/app/tokens.css:235-242`.

- `--sc2-space-1` max 4 -> **3.6px**
- `--sc2-space-2` max 8 -> **7.2px**
- `--sc2-space-3` max 12 -> **10.8px**
- `--sc2-space-4` max 16 -> **14.4px**
- `--sc2-space-5` max 20 -> **18px**
- `--sc2-space-6` max 24 -> **21.6px**
- `--sc2-space-7` max 32 -> **28.8px**
- `--sc2-space-8` max 40 -> **36px**

SC's "six steps computed at 0.9" per the prompt = the six mid-band tokens
(1..6): **3.6, 7.2, 10.8, 14.4, 18, 21.6 px**.

### SC v1 radii

`--rad-4 4 / --rad-6 6 / --rad-10 10 / --rad-14 14 / --rad-pill 9999 /
--rad-circle 50%`. `[code-read] src/app/tokens.css:41`.
Semantic roles:
- `--radius-cell: var(--rad-4)` (4)
- `--radius-control: var(--rad-10)` (10)
- `--radius-container: var(--rad-10)` (10)
- `--radius-container-lg: var(--rad-14)` (14)
- `--radius-pill: var(--rad-pill)` (9999)
- `--radius-circle: var(--rad-circle)` (50%)
`[code-read] src/app/tokens.css:108-109`.

### SC v2 radii (static, not scaled)

`--sc2-radius-cell 6 / --sc2-radius-control 9 / --sc2-radius-container 11
/ --sc2-radius-card 12 / --sc2-radius-tile 8 / --sc2-radius-modal 14 /
--sc2-radius-pill 9999`. `[code-read] src/app/tokens.css:245-270`.

### OPD radii and card paddings as shipped

- `.pb-hero`: `border-radius: 20px; padding: 20px 20px 14px` (mobile) /
  `padding: 24px 28px 18px` (`>=640px`).
  `[code-read] src/app/playbook/playbook.css:90-98, 236-244`.
- `.pb-card`: `border-radius: 12px; padding: 14px 14px 12px`.
  `[code-read] src/app/playbook/playbook.css:937-949`.
- `.pb-card-grid`: `gap: 12px` at `>=640` (2 cols) / `>=960` (3 cols).
  `[code-read] src/app/playbook/playbook.css:829-835`.
- `.pb-search-bar`: `border-radius: 12px; padding: 12px 14px`.
  `[code-read] src/app/playbook/playbook.css:167-177`.
- `.pb-sous-btn`: `border-radius: 12px; padding: 12px 16px`.
  `[code-read] src/app/playbook/playbook.css:203-220`.
- `.pb-fullpage-article`: `border-radius: 16px; padding: 32px 36px`,
  mobile `padding: 20px 18px; border-radius: 12px`.
  `[code-read] src/app/playbook/playbook.css:2205-2211, 2402-2410`.
- `.pb-fullpage-back`: `border-radius: 8px; padding: 8px 12px`.
  `[code-read] src/app/playbook/playbook.css:2165-2178`.
- `.pb-fullpage-print`: `border-radius: 8px; padding: 9px 14px`.
  `[code-read] src/app/playbook/playbook.css:2189-2203`.
- `.pb-class-chip`: `border-radius: 5px; padding: 2px 7px`;
  `.pb-class-chip--lg` `padding: 3px 9px`.
  `[code-read] src/app/playbook/playbook.css:1037-1063`.
- `.pb-status-pill`: `border-radius: 999px; padding: 3px 9px`;
  `.pb-status-pill--lg` `padding: 4px 11px`.
  `[code-read] src/app/playbook/playbook.css:1143-1166`.
- `.pb-sousai` stub: `border-radius: 10px; padding: 10px 14px`.
  `[code-read] src/app/playbook/playbook.css:1678-1690`.
- Reader blockquote: `border-radius: 4px; padding: 12px 16px`.
  `[code-read] src/app/playbook/playbook.css:2331-2337`.
- Reader code: `border-radius: 4px; padding: 1px 5px`.
  `[code-read] src/app/playbook/playbook.css:2324-2330`.

## A.6 Motion constants

### SC Handoff beat table (code, not recall)

`BEAT_DELAYS` object at `[code-read] src/app/service-calendar/v2/handoff/coordinator.js:53-60`:
```
const BEAT_DELAYS = {
  1: 0,      // idle -> fadeSvc immediately
  2: 200,    // fadeSvc -> pillIn
  3: 660,    // pillIn -> pillFly + flip
  4: 1020,   // pillFly -> ringSweep + queue clear
  5: 1350,   // ringSweep -> slideNext
  0: 1850,   // slideNext -> idle (drop the sequence)
};
```

Companion CSS-side beat durations at
`[code-read] src/app/service-calendar/v2/handoff/handoff.css:5-14`
(comment table) and applied on classes:
- `sc-pillIn`: `.3s cubic-bezier(.34, 1.56, .64, 1) both` (overshoot).
  `[code-read] src/app/service-calendar/v2/handoff/handoff.css:35`.
- `sc-pillFade`: `.3s ease-out forwards`.
  `[code-read] src/app/service-calendar/v2/handoff/handoff.css:40`.
- `.sc-handoff-clone` (pillFly transition): `.55s cubic-bezier(.4, 0, .2,
  1)` for transform + opacity.
  `[code-read] src/app/service-calendar/v2/handoff/handoff.css:62-64`.
- `MonthCompleteCard.js:8` comment: `check draw .5s @1s per the render's
  beat table`.

### SC v1 base motion tokens

- `--duration-fast: 120ms`, `--duration-base: 180ms`, `--duration-slow:
  280ms`. `[code-read] src/app/tokens.css:47`.
- Eases: `--ease-standard: cubic-bezier(.2, 0, 0, 1)`,
  `--ease-emphasized: cubic-bezier(.3, 0, 0, 1)`, `--ease-exit:
  cubic-bezier(.4, 0, 1, 1)`.
  `[code-read] src/app/tokens.css:48`.
- Roles: `--motion-control: var(--duration-fast) var(--ease-standard)`,
  `--motion-surface: var(--duration-base) var(--ease-emphasized)`.
  `[code-read] src/app/tokens.css:114`.
- Reduced-motion collapses the three durations to 0ms at token layer.
  `[code-read] src/app/tokens.css:160-162`.

### SC overlay entrance

- `.sc-overlay-backdrop` `scOverlayIn 0.2s ease`.
  `[code-read] src/app/service-calendar/ops-sc.css:147`.
- `.sc-overlay-card` `scCardUp 0.25s ease` translateY(16)+scale(.98).
  `[code-read] src/app/service-calendar/ops-sc.css:156-158`.

### OPD transitions

- `.pb-card` transition: `all 0.15s`.
  `[code-read] src/app/playbook/playbook.css:948`.
- `.pb-sous-btn`: `transform 120ms ease, box-shadow 120ms ease`.
  `[code-read] src/app/playbook/playbook.css:218`.
- `.pb-sous-panel` slide-in: `pb-slide-in 0.25s cubic-bezier(0.4, 0, 0.2,
  1)`. `[code-read] src/app/playbook/playbook.css:2018`.
- `.pb-fullpage-back`: `border-color 120ms ease, background 120ms ease`.
  `[code-read] src/app/playbook/playbook.css:2178`.
- `.pb-fullpage-print`: `background 120ms ease`.
  `[code-read] src/app/playbook/playbook.css:2202`.
- Card entrance: `pb-card-in 200ms ease-out backwards` with staggered
  `--idx` delay capped at 12 * 30ms.
  `[code-read] src/app/playbook/playbook.css:966-967`.
- `.pb-sous-panel` overlay fade: `pb-fade-in 0.18s ease`.
  `[code-read] src/app/playbook/playbook.css:2004`.

## A.7 Component dimensions

### Nav

- `.kf-topnav` height 56 desktop / 52 mobile (`<=767px` per the query
  location); inner max-width 1200; padding 0 20 desktop / 0 12 mobile.
  `[code-read] src/components/TopNav.css:16-24, 477`.
- `.kf-topnav-logo`: 32x32, `border-radius: 10`, Inter 800/16, `box-shadow:
  0 2px 6px rgba(15, 48, 87, 0.2)`.
  `[code-read] src/components/TopNav.css:35-48`.
- `.kf-topnav-wordmark`: Inter 800/17, letter-spacing -0.3px.
  `[code-read] src/components/TopNav.css:50-56`.
- `.kf-topnav-link`: padding 8/14, radius 10, Inter 700/13,
  `color: #64748b`.
  `[code-read] src/components/TopNav.css:72-85`.
- `.kf-topnav-icon-btn`: 36x36, radius 10, transparent bg -> `#f1f5f9`
  hover. Bell badge: min-width 16, height 16, radius 8, red `#ef4444`,
  Inter 800/10 white.
  `[code-read] src/components/TopNav.css:120-159`.
- `.kf-topnav-avatar`: 34x34 circle, 2px `#e2e8f0` border, navy fill,
  Inter 800/12 white, hover scale(1.05) + blue glow.
  `[code-read] src/components/TopNav.css:167-190`.
- `.kf-topnav-separator`: 1x24 vertical rule, 8px horizontal margin.
  `[code-read] src/components/TopNav.css:110-117`.

### OPD doc card

- Padding 14 14 12; radius 12; box-shadow `0 1px 2px rgba(15, 48, 87,
  0.04)`; border 1px `--kf-border`; min-height 184.
  `[code-read] src/app/playbook/playbook.css:937-959`.
- Hover-alive: `translateY(-2px)` + `0 6px 14px rgba(15, 48, 87, 0.1)`
  shadow + teal border.
  `[code-read] src/app/playbook/playbook.css:981-985`.
- Recessed: `opacity: 0.55; filter: saturate(0.7)`.
  `[code-read] src/app/playbook/playbook.css:992-1001`.

### Status pill

- Base: Inter 10/700 uppercase-ish, padding 3/9, radius 999, letter-spacing
  0.3px, 1px transparent border.
  `[code-read] src/app/playbook/playbook.css:1143-1150`.
- Ghost variant: `border-color: #e2e8f0`.
  `[code-read] src/app/playbook/playbook.css:1155-1157`.
- Large variant (slide-over + reader header): 11px, padding 4/11,
  letter-spacing 0.4px.
  `[code-read] src/app/playbook/playbook.css:1162-1166`.

### Doc-class chip

- Base: Inter 10/700 uppercase, padding 2/7, radius 5, letter-spacing
  0.3px, bg `#f1f5f9`, color `#64748b`.
  `[code-read] src/app/playbook/playbook.css:1037-1048`.
- Family tints (all at 10% alpha over white):
  - `--gov`: `rgba(33, 78, 130, 0.10)` + `#214e82`.
  - `--proc`: `rgba(15, 110, 86, 0.10)` + `--kf-playbook-teal-dark`.
  - `--tool`: `rgba(193, 122, 35, 0.10)` + `#7a4a1a`.
  - `--ref`: `rgba(120, 80, 35, 0.10)` + `#6b4f25`.
  `[code-read] src/app/playbook/playbook.css:1052-1055`.
- Large variant: 11/700, padding 3/9, letter-spacing 0.4px.
  `[code-read] src/app/playbook/playbook.css:1058-1063`.

### Reader TOC card

- **No TOC card is shipped in the current reader.** Grep for `pb-toc`,
  `pb-fullpage-toc`, `pb-reader-toc`, `pb-fullpage-nav` returns zero
  matches across `src/app/playbook/`. The doc reader today is the wrap +
  toolbar + article; there is no side/inline TOC component to measure.
  If the reskin adds one, it is a new component - no existing metrics to
  match against.

### Anchor callout rail

- `.callout-anchor` in the reader: `border-left-color: var(--kf-navy);
  background: #C4E3E8`. Rail width comes from the base blockquote rule:
  `border-left: 3px solid ...` at the plain blockquote, bumped to `4px`
  by the `.callout` modifier. Padding `12px 16px`, radius `4px`, margin
  `14px 0`.
  `[code-read] src/app/playbook/playbook.css:2331-2348`.
- SlideOverReader mirror: `callout-anchor` at `[code-read]
  src/app/playbook/playbook.css:1559` uses `border-left-color:
  var(--kf-navy); background: #eef2f7`. Screen-and-slide-over grounds
  intentionally differ (reader `#C4E3E8` mid-teal vs slide-over `#eef2f7`
  soft blue).

## A.8 Completeness map (all seven groups)

- **Group 1 - Shell and layout.** Measured: SC v2 shell tokens (1520 /
  1240 / 60 / 116 / canvas), SC v1 root recipe (surface-card / radius 14
  / elevation-raised), `.pb-shell` 1024, `.pb-fullpage-wrap` 880,
  `.pb-fullpage-article` 32/36 padding + radius 16, `.kf-desktop-wrapper`
  1024, `.kf-topnav-inner` 1200 x 56 desktop / 52 mobile, OPD hero total
  vertical cost (200 min + margin), reader prose column effective width
  776 desktop / 307 mobile with method-noted CPL (99 desktop / 42
  mobile), coming-soon Sous panel width 480 / 100vw mobile. `[all
  code-read]`.
- **Group 2 - Recalled items.** Card shadow: the report's
  `0 3px 10px rgba(21,57,104,.08)` is real but scoped to
  `.sc-rail-accent-card` at `src/app/service-calendar/v2/accentRail.css:84`
  - not the general SC card shadow. General SC card `.sc-root` shadow is
  `--sh-md: 0 4px 12px rgba(15,23,42,0.08)`. SC font stack: v1 inherits
  Mulish through `.oh-app`, v2 explicitly reads `var(--sc2-font-ui)` =
  Inter. `[all code-read]`.
- **Group 3 - Type.** SC v1 primitive scale, SC v2 Standard T-table scale
  with scale-0.9 arithmetic for eight sizes + control heights, OPD
  browsing + reader typography (hero, card, chip, pill, cover title, H1
  with SECTION eyebrow, H2, H3, body, code, blockquote, callout family,
  table). Body line-height per product. `[all code-read]`.
- **Group 4 - Color.** `#0F6E56` inventory - all raw hex declarations
  (five in tokens + globals) plus consumer counts (75+ OPD + 141 SC =
  ~216 lines total). Both ambers: `#D97706` maps to five declared
  tokens across four files; `#D9892F` returns zero hits (not present).
  Page-ground map: `--surface-page` (#F4F2EC) declared but overridden by
  `body { background: var(--kf-bg) = #f0f4f8 }` for the site, `--sc2-canvas
  = #edeff2` for SC v2 via `:has()`. `[all code-read]`.
- **Group 5 - Spacing + radius.** SC v1 primitive ladder (4-40),
  SC v2 fluid ladder max * 0.9 six steps (3.6 / 7.2 / 10.8 / 14.4 / 18 /
  21.6 px), SC v1 semantic radius roles, SC v2 six-role radius set.
  OPD radii + paddings: hero 20 rad + 20/20/14, card 12 rad + 14/14/12,
  search-bar 12/12/14, article 16 rad + 32/36 (mobile 12 + 20/18),
  chip/pill/stub radii. `[all code-read]`.
- **Group 6 - Motion.** SC handoff `BEAT_DELAYS` object at coordinator.js
  :53-60 (0/200/660/1020/1350/1850), handoff.css duration values (.3s
  pillIn, .55s pillFly, .3s pillFade). SC base motion tokens
  (120/180/280). SC overlay .2s / .25s. OPD transitions: card .15s,
  sous-btn 120ms, sous-panel .25s + fade .18s, card entrance 200ms with
  30ms stagger cap. `[all code-read]`.
- **Group 7 - Component dimensions.** Nav (height / logo / wordmark /
  link / icon-btn / bell badge / avatar / separator). OPD doc card
  (padding + radius + shadow + hover), status pill (base / ghost / lg),
  doc-class chip (base + 4 family tints + lg). Reader TOC card: **not
  shipped**, called out. Anchor callout rail (3px base -> 4px `.callout`,
  navy border, `#C4E3E8` reader ground, padding 12/16, radius 4). `[all
  code-read]`.

All seven groups covered. Values computed rather than estimated wherever
runtime math applied; the CPL computation explicitly names its method
(0.5 to 0.55 em advance for Inter body Latin) and shows the range.
