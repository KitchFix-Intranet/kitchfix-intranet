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
