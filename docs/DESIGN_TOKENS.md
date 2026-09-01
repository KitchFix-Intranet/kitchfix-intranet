# Design Tokens - KitchFix (canonical)

`src/app/tokens.css` is the single source of truth for all design values. This document
explains the system and is the **rule**: components consume **semantic** tokens only -
never primitives, never raw hex/px. A raw color or pixel value in a component is a defect.

**Visual style guides** (two, complementary):
- [`docs/design-tokens.html`](design-tokens.html) - the CURRENT token INVENTORY.
  Every token in `src/app/tokens.css` rendered as a swatch / sample / spec (color
  ramps, semantic roles, status family, **tool accents including the SC family**,
  type scale, spacing, radii, elevation, motion, focus ring, density-mode compare,
  z / opacity / icons). Regenerate by copying `:root` from `src/app/tokens.css`.
- [`docs/design-tokens-v3.html`](design-tokens-v3.html) - the design-system
  NARRATIVE from the token audit. Adds the 3-tier architecture diagram, the WCAG
  Contrast Report table, the icon concept -> glyph vocabulary, the interactive-state
  pack (default / hover / focus / disabled / loading / empty), and a composite
  screen demo. v3 predates the SC-redesign token additions - the four `--accent-sc*`
  variants and the four tool accents (`--accent-ops/-people/-directory/-playbook`)
  are NOT in v3, but are in current `tokens.css` and are shown in `design-tokens.html`.

Rule of thumb: open the inventory when you need to know if a token exists / what its
value is / what it looks like; open v3 when you need to understand the SYSTEM (why
tokens are structured this way, contrast intent, icon vocabulary, state coverage).

**SC drill-in redesign context:** [`docs/SC_DESIGN_TOKEN_README.md`](SC_DESIGN_TOKEN_README.md)
is the SC-specific token bible for the drill-in alignment work - operational rules for
"match the overview," per-surface consumption reference, pre-flight checklist,
anti-patterns, and the Claude-vs-Kevin decision split.

## The model - two tiers, one rule
- **Tier 1 - Primitives** (`--navy-700`, `--space-4`, `--rad-10`): raw values. Generated,
  not hand-picked. Components NEVER reference these directly.
- **Tier 2 - Semantic** (`--text-default`, `--surface-page`, `--status-overdue-fg`,
  `--radius-control`): intent. Each points at a primitive. **This is what components use.**
- Theming (dark / density / rebrand) is a remap of Tier 2 only - zero component edits.

## Color (OKLCH-generated, AA-verified)
Ramps: `--navy-50..900` (brand 700), `--amber-50..900` (accent 500), `--green-50..900`
(success 500), `--red-50..900` (danger 500), `--n-0..900` (neutral - warm surfaces to
cool ink). Soft state fills: `--fill-needs`, `--fill-upcoming`, `--fill-off` (+ `-bd`).

Semantic color roles:
- Text: `--text-heading/strong/default/muted/subtle/inverse/link/success/danger`.
  `--text-subtle` (n-500) is UI/placeholder/border only - it fails AA as body text; never
  use it for body copy.
- Surface: `--surface-page` (warm #F4F2EC) `/card` `/sunken` `/overlay`.
- Border: `--border-subtle/default/strong`.
- Action: `--action-primary-bg` (navy, white text) `/-bg-hover/-text`; `--action-secondary-*`.
- Accent (contrast-split): `--accent` (amber, dark text/icons), `--accent-solid` (amber-600,
  white text OK), `--accent-text` (amber-700, amber as text), `--accent-backplate` (CTA wash).
  Never put white text on `--accent`; use `--accent-solid`.
- Feedback: `--feedback-success/warning/danger/info`.

## Status family (cross-app, reuse everywhere - cell, badge, dot, row, bar)
Each status carries `-bg / -bd / -fg / -subtle / -strong`. The `-fg` values are the
computed darkest step that passes WCAG AA on the fill: entered green-800 (5.40), needs
amber-700 (5.72), overdue red-700 (4.83), upcoming/off n-700 (6.4+), today navy-700 ring.
Status is NOT calendar-only - use it in People, Vendor, dashboards.

## Tool accents (Tier 3 - per-surface identity)
Every module gets one Tier-3 slot for identity:
`--accent-ops` (amber, `--amber-500`), `--accent-people` (`#7C3AED`),
`--accent-directory` (`#C41E3A`), `--accent-playbook` (`#0F6E56`). These carry surface
identity; use the `--feedback-danger` token (not `--accent-directory`) for actual error
states.

**Service Calendar identity - the `--accent-sc` family.** The SC is a green-themed tool
(hover borders, focus rings, primary interactive accents, back-links, active/touched
states). Rather than force the SC surface to conform to the app's navy primary, the SC
carries its own tool-accent family in four tiers:
- `--accent-sc` (`#0F6E56`) - primary interactive green (chrome bar today CTA, back-link,
  focus rings, `.sc-workspace-nav-today`, `.sc-stepper-caption` "done" tag, on-track
  check). White text on this fill is AA (5.02).
- `--accent-sc-dark` (`#085041`) - deeper accent (`.sc-workspace-nav-today:hover`,
  phase timeline title text where applicable). White text still AA.
- `--accent-sc-subtle` (`#E1F5EE`) - hover backgrounds on subtle interactive elements
  (spotlight fill under the `--done` mobile card, pill hover backgrounds).
- `--accent-sc-tint` (`#F0FDF4`) - the softest wash (MiLB bare-strip gradient middle,
  faint backplates). Nearly-white green.
Note: `--accent-sc` shares its hex with `--accent-playbook` - same operational-green,
two surfaces, intentional. Cell-state colors are separate from `--accent-sc`; they come
from the status family (`--status-entered-*`, `--status-needs-*`, etc.), regardless of
which tool renders them.

**Rule for the SC:** any interactive-color decision on the SC surface (hover, focus,
active, "you clicked this") consumes an `--accent-sc*` token, not raw hex. The SC
overview is the shipped reference for this pattern; the drill-in redesign must match.

## Type - modular scale (ratio 1.2), roles lock size/weight/leading/tracking
Fonts: `--font-ui` (Inter) for all screen UI, headings, and body; `--font-mono`
(JetBrains Mono) for numeric/code. Mulish is reserved for the print/PDF pipeline
(Pre-Service Materials) and is not part of the screen token set.
Sizes: micro 10 / caption 12 / body 14 / subhead 17 / h3 20 / h2 24 / h1 29 / display 35.
Weights: 400/500/600/700/800. Roles: display 35/800, h1 29/700, h2 24/700, h3 20/700,
subhead 17/600, body 14/400, body-strong 14/600, caption 12/600, eyebrow 12/700
caps, micro 10/600. ALL numeric data uses `font-variant-numeric: var(--num-tabular)`.

## Shape - 6 radii + the rule
`--radius-cell` (4, data cells/swatches), `--radius-control` / `--radius-container` (10,
buttons/inputs/cards), `--radius-container-lg` (14, large cards/hero/modals),
`--radius-pill` (toggles/chips/tags), `--radius-circle` (avatars/icon-buttons/dots).
RULE: pills for controls, rounded-rect for containers, square-ish for data cells,
circles for avatars/icons/dots.

## Spacing, elevation, motion, focus, z, opacity
4px base: `--space-1..8`. Elevation: `--elevation-card/raised/popover`. Motion:
`--motion-control` (120ms) / `--motion-surface` (180ms), from `--duration-*` + `--ease-*`;
reduced-motion zeroes durations at the token layer. Focus: `--focus-ring-width/offset/color`
(2px navy ring) - apply a visible focus-visible ring on every interactive element. Z:
`--z-dropdown/sticky/overlay/popover/toast`. Opacity: `--opacity-disabled` (.45).

## Density mode
`[data-density="compact"]` remaps the semantic spacing/size tokens (`--space-stack`,
`--space-card-pad`, `--space-inline`, `--control-height`, `--row-height`, `--cell-size`).
Primitives stay fixed; only semantics remap. Components reading these re-snap automatically.

## Accessibility (constructed, not spot-checked)
Every text/background and status pair was computed against WCAG AA before shipping. The
amber accent fails white-text AA (3.19), which is why the accent is split. Status is never
encoded by color alone - always pair with glyph/label/shape.

## Governance
- `tokens.css` is canonical. If this doc and `tokens.css` ever diverge, `tokens.css` wins -
  fix the doc.
- Add-and-deprecate, never silently mutate a token's value.
- MIGRATION NOTE (temporary): `--space-1..6` and `--radius-card/-input` are still also
  defined in the `globals.css` `[data-density]` blocks (legacy primitive-remap density). They
  win by specificity, so current behavior is unchanged. They retire during the density
  refactor. The `.cs-root` inventory module keeps its own scoped tokens until Module 7.

<!-- GENERATED:tokens START - do not edit by hand, run scripts/gen_design_docs.mjs -->
> Generated from `src/app/tokens.css` (+ `src/app/kpi/kpi.css`, `src/app/opd/opd.css` where namespaced). Run `node scripts/gen_design_docs.mjs` to refresh. Prose outside this marker is hand-maintained.

### Color ramps

**Navy (brand, 700)**

| Token | Hex |
|---|---|
| `--navy-50` | #F4F7FC |
| `--navy-100` | #D1DAE6 |
| `--navy-200` | #AFBDD1 |
| `--navy-300` | #8FA2BC |
| `--navy-400` | #6F87A6 |
| `--navy-500` | #516C92 |
| `--navy-600` | #33527D |
| `--navy-700` | #153968 |
| `--navy-800` | #092B55 |
| `--navy-900` | #011D42 |

**Amber (accent, 500)**

| Token | Hex |
|---|---|
| `--amber-50` | #FFF2E2 |
| `--amber-100` | #FFDABE |
| `--amber-200` | #F7C299 |
| `--amber-300` | #EEA973 |
| `--amber-400` | #E4904B |
| `--amber-500` | #D97706 |
| `--amber-600` | #B25800 |
| `--amber-700` | #8C3A00 |
| `--amber-800` | #671C00 |
| `--amber-900` | #440000 |

**Green (success, 500)**

| Token | Hex |
|---|---|
| `--green-50` | #E9FDEC |
| `--green-100` | #C6EBCB |
| `--green-200` | #A2D9AB |
| `--green-300` | #7DC78B |
| `--green-400` | #54B56B |
| `--green-500` | #16A34A |
| `--green-600` | #008330 |
| `--green-700` | #006515 |
| `--green-800` | #004800 |
| `--green-900` | #002C00 |

**Red (danger, 500)**

| Token | Hex |
|---|---|
| `--red-50` | #FFEDE7 |
| `--red-100` | #FFCAC1 |
| `--red-200` | #FFA69B |
| `--red-300` | #F88276 |
| `--red-400` | #EB5B50 |
| `--red-500` | #DC2626 |
| `--red-600` | #B9000C |
| `--red-700` | #970000 |
| `--red-800` | #760000 |
| `--red-900` | #560000 |

**Neutral (n)**

| Token | Hex |
|---|---|
| `--n-0` | #FFFFFF |
| `--n-50` | #FAF9F5 |
| `--n-100` | #F4F2EC |
| `--n-200` | #F0EEE7 |
| `--n-300` | #E5E7EB |
| `--n-400` | #D3CFC4 |
| `--n-500` | #94A3B8 |
| `--n-600` | #64748B |
| `--n-700` | #475569 |
| `--n-800` | #334155 |
| `--n-900` | #0A2548 |

**Named neutrals / soft fills**

| Token | Value |
|---|---|
| `--mint-300` | #7FD3B4 |
| `--fill-needs` | #FCD9A0 |
| `--fill-needs-bd` | #E4AD84 |
| `--fill-upcoming` | #E2EFE4 |
| `--fill-upcoming-bd` | #C6D8C8 |
| `--fill-off` | #F1EEE7 |
| `--fill-off-bd` | #DDD7CA |

### Type scale

**Type sizes**

| Token | Value |
|---|---|
| `--size-micro` | 10px |
| `--size-caption` | 12px |
| `--size-body` | 14px |
| `--size-subhead` | 17px |
| `--size-h3` | 20px |
| `--size-h2` | 24px |
| `--size-h1` | 29px |
| `--size-display` | 35px |

**Weights**

| Token | Value |
|---|---|
| `--wt-regular` | 400 |
| `--wt-medium` | 500 |
| `--wt-semibold` | 600 |
| `--wt-bold` | 700 |
| `--wt-display` | 800 |

**Leading + tracking**

| Token | Declared | Resolved |
|---|---|---|
| `--lb-caption` | calc(16/12) | calc(16/12) |
| `--lb-h3` | calc(24/20) | calc(24/20) |
| `--lb-h2` | calc(32/24) | calc(32/24) |
| `--lb-hero` | calc(40/35) | calc(40/35) |
| `--lead-tight` | 1.1 | 1.1 |
| `--lead-snug` | 1.25 | 1.25 |
| `--lead-normal` | 1.5 | 1.5 |
| `--track-tight` | -0.01em | -0.01em |
| `--track-caps` | 0.06em | 0.06em |

### Spacing

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-7` | 32px |
| `--space-8` | 40px |

### Radius

| Token | Value |
|---|---|
| `--rad-4` | 4px |
| `--rad-6` | 6px |
| `--rad-10` | 10px |
| `--rad-14` | 14px |
| `--rad-pill` | 9999px |
| `--rad-circle` | 50% |

### Font stacks

| Token | Value |
|---|---|
| `--font-ui` | 'Inter',-apple-system,system-ui,sans-serif |
| `--font-body` | 'Inter',-apple-system,system-ui,sans-serif |
| `--font-mono` | 'JetBrains Mono','SF Mono',Menlo,monospace |

### Semantic tokens (Tier 2)

**Text**

| Token | Resolved |
|---|---|
| `--text-heading` | var(--n-900) → #0A2548 |
| `--text-strong` | var(--n-800) → #334155 |
| `--text-default` | var(--n-700) → #475569 |
| `--text-muted` | var(--n-600) → #64748B |
| `--text-subtle` | var(--n-600) → #64748B |
| `--text-inverse` | var(--n-0) → #FFFFFF |
| `--text-link` | var(--navy-700) → #153968 |
| `--text-success` | var(--green-600) → #008330 |
| `--text-danger` | var(--red-500) → #DC2626 |

**Surface**

| Token | Resolved |
|---|---|
| `--surface-page` | #edeff2 |
| `--surface-card` | var(--n-0) → #FFFFFF |
| `--surface-sunken` | var(--n-50) → #FAF9F5 |
| `--surface-overlay` | var(--n-0) → #FFFFFF |

**Border**

| Token | Resolved |
|---|---|
| `--border-thin` | 1px |
| `--border-thick` | 2px |
| `--border-subtle` | var(--n-200) → #F0EEE7 |
| `--border-default` | var(--n-300) → #E5E7EB |
| `--border-strong` | var(--n-400) → #D3CFC4 |

**Action**

| Token | Resolved |
|---|---|
| `--action-primary-bg` | var(--navy-700) → #153968 |
| `--action-primary-bg-hover` | var(--navy-800) → #092B55 |
| `--action-primary-text` | var(--n-0) → #FFFFFF |
| `--action-secondary-bg` | var(--n-0) → #FFFFFF |
| `--action-secondary-border` | var(--n-400) → #D3CFC4 |
| `--action-secondary-text` | var(--n-700) → #475569 |

**Accent**

| Token | Resolved |
|---|---|
| `--accent` | var(--amber-500) → #D97706 |
| `--accent-solid` | var(--amber-600) → #B25800 |
| `--accent-text` | var(--amber-700) → #8C3A00 |
| `--accent-backplate` | var(--amber-50) → #FFF2E2 |
| `--accent-ops` | var(--amber-500) → #D97706 |
| `--accent-people` | #7C3AED |
| `--accent-directory` | #C41E3A |
| `--accent-playbook` | #0F6E56 |
| `--accent-sc` | #0F6E56 |
| `--accent-sc-dark` | #085041 |
| `--accent-sc-subtle` | #E1F5EE |
| `--accent-sc-tint` | #F0FDF4 |
| `--accent-sous` | #0891B2 |
| `--accent-sous-deep` | #0E7490 |
| `--accent-sous-subtle` | #ECFEFF |
| `--accent-sous-line` | #A5F3FC |

**Feedback + status**

| Token | Resolved |
|---|---|
| `--status-entered-bg` | var(--green-300) → #7DC78B |
| `--status-entered-bd` | var(--green-400) → #54B56B |
| `--status-entered-fg` | var(--green-800) → #004800 |
| `--status-entered-subtle` | var(--green-100) → #C6EBCB |
| `--status-entered-strong` | var(--green-500) → #16A34A |
| `--status-needs-bg` | var(--fill-needs) → #FCD9A0 |
| `--status-needs-bd` | var(--fill-needs-bd) → #E4AD84 |
| `--status-needs-fg` | var(--amber-700) → #8C3A00 |
| `--status-needs-subtle` | var(--amber-100) → #FFDABE |
| `--status-needs-strong` | var(--amber-500) → #D97706 |
| `--status-overdue-bg` | var(--red-200) → #FFA69B |
| `--status-overdue-bd` | var(--red-300) → #F88276 |
| `--status-overdue-fg` | var(--red-700) → #970000 |
| `--status-overdue-subtle` | var(--red-100) → #FFCAC1 |
| `--status-overdue-strong` | var(--red-500) → #DC2626 |
| `--status-upcoming-bg` | var(--fill-upcoming) → #E2EFE4 |
| `--status-upcoming-bd` | var(--fill-upcoming-bd) → #C6D8C8 |
| `--status-upcoming-fg` | var(--n-700) → #475569 |
| `--status-upcoming-subtle` | var(--n-100) → #F4F2EC |
| `--status-upcoming-strong` | var(--n-500) → #94A3B8 |
| `--status-off-bg` | var(--fill-off) → #F1EEE7 |
| `--status-off-bd` | var(--fill-off-bd) → #DDD7CA |
| `--status-off-fg` | var(--n-700) → #475569 |
| `--status-off-subtle` | var(--n-50) → #FAF9F5 |
| `--status-off-strong` | var(--n-400) → #D3CFC4 |
| `--status-today-ring` | var(--navy-700) → #153968 |
| `--status-today-fg` | var(--navy-700) → #153968 |
| `--feedback-success` | var(--green-600) → #008330 |
| `--feedback-warning` | var(--amber-500) → #D97706 |
| `--feedback-danger` | var(--red-500) → #DC2626 |
| `--feedback-info` | #2563EB |
| `--feedback-info-subtle` | #f0f5ff |
| `--feedback-info-border` | #bfdbfe |
<!-- GENERATED:tokens END -->
